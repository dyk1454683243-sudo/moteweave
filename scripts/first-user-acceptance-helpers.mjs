import JSZip from 'jszip'
import sharp from 'sharp'

export const MOTION_SOURCE_FRAME_INDEXES = Object.freeze([16, 17, 18, 19, 16, 18])
export const MOTION_TARGET_FRAME_INDEXES = Object.freeze([16, 17, 18, 19])

const FRAME_SIZE = 96
const SHEET_COLUMNS = 8
const SHEET_ROWS = 8
const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z')
const RGB_OFFSETS = Object.freeze([
  [31, 17, 23],
  [47, 29, 37],
  [63, 41, 51],
  [79, 53, 65],
  [95, 65, 79],
  [111, 77, 93],
])
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function acceptanceAssert(condition, message) {
  if (!condition) throw new Error(message)
}

export function acceptanceLoopbackUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value))
  acceptanceAssert(
    url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname),
    `First-user acceptance requires an HTTP loopback origin: ${url.origin}`
  )
  acceptanceAssert(
    !url.username && !url.password,
    'First-user acceptance loopback URL must not contain credentials'
  )
  return url
}

export async function decodePngRgba(png) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    data: Buffer.from(data),
    width: info.width,
    height: info.height,
  }
}

function framePosition(index) {
  return {
    left: (index % SHEET_COLUMNS) * FRAME_SIZE,
    top: Math.floor(index / SHEET_COLUMNS) * FRAME_SIZE,
  }
}

function mutateForeground(data, frameIndex) {
  const [dr, dg, db] = RGB_OFFSETS[frameIndex]
  let changedPixels = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue
    data[offset] = (data[offset] + dr) & 255
    data[offset + 1] = (data[offset + 1] + dg) & 255
    data[offset + 2] = (data[offset + 2] + db) & 255
    changedPixels += 1
  }
  acceptanceAssert(changedPixels > 0, `Motion source frame ${frameIndex + 1} has no foreground pixels`)
}

export async function buildDeterministicMotionZip(normalizedSheetPng) {
  const metadata = await sharp(normalizedSheetPng).metadata()
  acceptanceAssert(
    metadata.width === FRAME_SIZE * SHEET_COLUMNS &&
      metadata.height === FRAME_SIZE * SHEET_ROWS,
    `Expected a 768x768 normalized sheet, received ${metadata.width}x${metadata.height}`
  )

  const zip = new JSZip()
  for (const [outputIndex, sourceFrameIndex] of MOTION_SOURCE_FRAME_INDEXES.entries()) {
    const position = framePosition(sourceFrameIndex)
    const { data, info } = await sharp(normalizedSheetPng)
      .ensureAlpha()
      .extract({ ...position, width: FRAME_SIZE, height: FRAME_SIZE })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixels = Buffer.from(data)
    const alphaBefore = Buffer.from(
      Array.from({ length: FRAME_SIZE * FRAME_SIZE }, (_, index) => pixels[index * 4 + 3])
    )
    mutateForeground(pixels, outputIndex)
    const alphaAfter = Buffer.from(
      Array.from({ length: FRAME_SIZE * FRAME_SIZE }, (_, index) => pixels[index * 4 + 3])
    )
    acceptanceAssert(alphaBefore.equals(alphaAfter), 'Motion source mutation changed alpha')
    const framePng = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer()
    zip.file(`frame_${String(outputIndex + 1).padStart(2, '0')}.png`, framePng, {
      date: FIXED_ZIP_DATE,
      createFolders: false,
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    platform: 'DOS',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    streamFiles: false,
  })
}

function cellEqual(first, second, frameIndex) {
  const { left, top } = framePosition(frameIndex)
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const offset = ((top + y) * first.width + left) * 4
    const length = FRAME_SIZE * 4
    if (!first.data.subarray(offset, offset + length).equals(
      second.data.subarray(offset, offset + length)
    )) return false
  }
  return true
}

export async function changedSheetCellIndexes(firstPng, secondPng) {
  const [first, second] = await Promise.all([
    decodePngRgba(firstPng),
    decodePngRgba(secondPng),
  ])
  acceptanceAssert(
    first.width === second.width && first.height === second.height,
    'Sheet dimensions changed during cell comparison'
  )
  acceptanceAssert(
    first.width === FRAME_SIZE * SHEET_COLUMNS &&
      first.height === FRAME_SIZE * SHEET_ROWS,
    'Cell comparison requires a 768x768 topdown sheet'
  )
  const changed = []
  for (let index = 0; index < SHEET_COLUMNS * SHEET_ROWS; index += 1) {
    if (!cellEqual(first, second, index)) changed.push(index)
  }
  return changed
}

export async function pngRgbaEqual(firstPng, secondPng) {
  const [first, second] = await Promise.all([
    decodePngRgba(firstPng),
    decodePngRgba(secondPng),
  ])
  return first.width === second.width &&
    first.height === second.height &&
    first.data.equals(second.data)
}

async function openZip(bytes, label) {
  acceptanceAssert(Buffer.isBuffer(bytes), `${label} did not return bytes`)
  acceptanceAssert(bytes.subarray(0, 2).toString('ascii') === 'PK', `${label} is not a ZIP`)
  return JSZip.loadAsync(bytes)
}

function realFiles(zip) {
  return Object.values(zip.files).filter((entry) => !entry.dir)
}

function requiredFile(zip, fileName, label) {
  const file = zip.file(fileName)
  acceptanceAssert(file, `${label} is missing ${fileName}`)
  return file
}

function uniqueSuffixFile(zip, suffix, label) {
  const matches = realFiles(zip).filter((entry) => entry.name.endsWith(`/${suffix}`))
  acceptanceAssert(matches.length === 1, `${label} expected one ${suffix}, received ${matches.length}`)
  return matches[0]
}

async function parseJsonFile(file, label) {
  try {
    return JSON.parse(await file.async('string'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

async function inspectCharacterPack(bytes, finalNormalizedSheetPng) {
  const zip = await openZip(bytes, 'Character Pack')
  for (const name of [
    'normalized_sheet.png',
    'animations.json',
    'metadata.json',
    'editor_metadata.json',
    'multi_resolution.json',
    'normalized_sheet_96.png',
    'normalized_sheet_64.png',
    'normalized_sheet_48.png',
    'normalized_sheet_32.png',
    'normalized_sheet_16.png',
  ]) requiredFile(zip, name, 'Character Pack')
  const animations = await parseJsonFile(zip.file('animations.json'), 'animations.json')
  const multiResolution = await parseJsonFile(zip.file('multi_resolution.json'), 'multi_resolution.json')
  acceptanceAssert(animations.profile === 'topdown_rpg_v0', 'Character Pack profile is not topdown_rpg_v0')
  acceptanceAssert(
    JSON.stringify(multiResolution.sheets.map((sheet) => sheet.frame_size)) ===
      JSON.stringify([96, 64, 48, 32, 16]),
    'Character Pack multi-resolution sizes are not canonical'
  )
  const packedSheet = await zip.file('normalized_sheet.png').async('nodebuffer')
  acceptanceAssert(
    await pngRgbaEqual(packedSheet, finalNormalizedSheetPng),
    'Character Pack normalized sheet does not match the final artifact'
  )
  return { file_count: realFiles(zip).length }
}

async function inspectGodotPack(bytes, finalNormalizedSheetPng) {
  const zip = await openZip(bytes, 'Godot package')
  const files = realFiles(zip)
  acceptanceAssert(files.length === 3, `Godot package expected 3 files, received ${files.length}`)
  const npcFile = uniqueSuffixFile(zip, 'npc.json', 'Godot package')
  const basePath = npcFile.name.slice(0, -'npc.json'.length)
  const npc = await parseJsonFile(npcFile, 'Godot npc.json')
  const sprite = await requiredFile(zip, `${basePath}sprite.png`, 'Godot package').async('nodebuffer')
  requiredFile(zip, `${basePath}thumb.png`, 'Godot package')
  const metadata = await sharp(sprite).metadata()
  acceptanceAssert(npc.assets?.spritePath === './sprite.png', 'Godot spritePath is not relative')
  acceptanceAssert(npc.spritesheet?.layoutVersion === 'json_grid', 'Godot layout is not json_grid')
  acceptanceAssert(npc.spritesheet?.animations?.walk_down?.row === 2, 'Godot walk_down row is not 2')
  acceptanceAssert(metadata.width === 768 && metadata.height === 768, 'Godot sprite is not 768x768')
  acceptanceAssert(sprite.equals(finalNormalizedSheetPng), 'Godot sprite bytes do not match the final sheet')
  return { file_count: files.length, sprite_bytes_match: true }
}

async function inspectRpgMakerPack(bytes) {
  const zip = await openZip(bytes, 'RPG Maker package')
  const files = realFiles(zip)
  acceptanceAssert(files.length === 3, `RPG Maker package expected 3 files, received ${files.length}`)
  const npcFile = uniqueSuffixFile(zip, 'NPC.json', 'RPG Maker package')
  const basePath = npcFile.name.slice(0, -'NPC.json'.length)
  const npc = await parseJsonFile(npcFile, 'RPG Maker NPC.json')
  const sprite = await requiredFile(zip, `${basePath}sprite.png`, 'RPG Maker package').async('nodebuffer')
  requiredFile(zip, `${basePath}thumb.png`, 'RPG Maker package')
  const metadata = await sharp(sprite).metadata()
  acceptanceAssert(npc.spritesheet?.layoutVersion === 'rpgmaker_v1', 'RPG Maker layout is not rpgmaker_v1')
  acceptanceAssert(npc.spritesheet?.frameWidth === 48, 'RPG Maker frame width is not 48')
  acceptanceAssert(npc.spritesheet?.frameHeight === 48, 'RPG Maker frame height is not 48')
  acceptanceAssert(npc.spritesheet?.columns === 3 && npc.spritesheet?.rows === 4, 'RPG Maker grid is not 3x4')
  acceptanceAssert(metadata.width === 144 && metadata.height === 192, 'RPG Maker sprite is not 144x192')
  return { file_count: files.length, sprite: { width: metadata.width, height: metadata.height } }
}

async function inspectOcadPack(bytes) {
  const zip = await openZip(bytes, 'OCAD package')
  const files = realFiles(zip)
  acceptanceAssert(files.length === 3, `OCAD package expected 3 files, received ${files.length}`)
  const npcFile = uniqueSuffixFile(zip, 'npc.json', 'OCAD package')
  const basePath = npcFile.name.slice(0, -'npc.json'.length)
  const npc = await parseJsonFile(npcFile, 'OCAD npc.json')
  const sprite = await requiredFile(zip, `${basePath}sprite.png`, 'OCAD package').async('nodebuffer')
  requiredFile(zip, `${basePath}thumb.png`, 'OCAD package')
  const metadata = await sharp(sprite).metadata()
  acceptanceAssert(npc.spritesheet?.layoutVersion === 'yituquan_v1', 'OCAD layout is not yituquan_v1')
  acceptanceAssert(npc.spritesheet?.frameWidth === 252, 'OCAD frame width is not 252')
  acceptanceAssert(npc.spritesheet?.frameHeight === 252, 'OCAD frame height is not 252')
  acceptanceAssert(metadata.width === 252 && metadata.height === 252, 'OCAD sprite is not 252x252')
  return { file_count: files.length, sprite: { width: metadata.width, height: metadata.height } }
}

export async function inspectAcceptancePackages({
  characterZip,
  godotZip,
  rpgMakerZip,
  ocadZip,
  finalNormalizedSheetPng,
} = {}) {
  return {
    character: await inspectCharacterPack(characterZip, finalNormalizedSheetPng),
    godot: await inspectGodotPack(godotZip, finalNormalizedSheetPng),
    rpg_maker: await inspectRpgMakerPack(rpgMakerZip),
    ocad: await inspectOcadPack(ocadZip),
  }
}
