import { buildSpriteIndex, normalizeExportParams } from '../../pixelPipeline.js'

const FILE_NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
})

function sequenceFileName(file) {
  return String(file?.name ?? file?.file?.name ?? '')
}

export function naturalSortSequenceFiles(files) {
  return Array.from(files ?? [])
    .map((file, originalIndex) => ({ file, originalIndex }))
    .sort((left, right) => (
      FILE_NAME_COLLATOR.compare(sequenceFileName(left.file), sequenceFileName(right.file)) ||
      left.originalIndex - right.originalIndex
    ))
    .map(({ file }) => file)
}

const SEQUENCE_FRAME_EDIT_ACTIONS = new Set(['move_up', 'move_down', 'remove'])

export function editSequenceFrames(frames, { action, index } = {}) {
  const currentFrames = Array.isArray(frames) ? frames : Array.from(frames ?? [])
  const currentIndex = Number.isSafeInteger(index) ? index : -1
  const unchanged = {
    changed: false,
    frames: currentFrames,
    removedFrame: null,
    focusIndex: currentIndex,
  }

  if (
    !SEQUENCE_FRAME_EDIT_ACTIONS.has(action) ||
    currentIndex < 0 ||
    currentIndex >= currentFrames.length
  ) return unchanged

  if (action === 'move_up' && currentIndex === 0) return unchanged
  if (action === 'move_down' && currentIndex === currentFrames.length - 1) return unchanged

  const nextFrames = [...currentFrames]
  if (action === 'remove') {
    const [removedFrame] = nextFrames.splice(currentIndex, 1)
    return {
      changed: true,
      frames: nextFrames,
      removedFrame,
      focusIndex: nextFrames.length ? Math.min(currentIndex, nextFrames.length - 1) : -1,
    }
  }

  const nextIndex = action === 'move_up' ? currentIndex - 1 : currentIndex + 1
  const currentFrame = nextFrames[currentIndex]
  nextFrames[currentIndex] = nextFrames[nextIndex]
  nextFrames[nextIndex] = currentFrame
  return {
    changed: true,
    frames: nextFrames,
    removedFrame: null,
    focusIndex: nextIndex,
  }
}

export function normalizeSequenceOptions(values = {}) {
  const normalized = normalizeExportParams(values)
  const maxPadding = Math.max(
    0,
    Math.floor((Math.min(normalized.targetW, normalized.targetH) - 1) / 2),
  )
  return {
    ...normalized,
    padding: Math.min(normalized.padding, maxPadding),
  }
}

export function sequenceOptionsKey(options = {}) {
  return JSON.stringify(normalizeSequenceOptions(options))
}

export function buildSequencePlan({ frameCount = 0, options = {} } = {}) {
  const normalizedOptions = normalizeSequenceOptions(options)
  const index = buildSpriteIndex({
    frameCount,
    targetW: normalizedOptions.targetW,
    targetH: normalizedOptions.targetH,
    spacing: normalizedOptions.spacing,
    columns: normalizedOptions.columns,
    fps: normalizedOptions.fps,
  })
  return {
    frameCount: index.frames.length,
    rows: index.frames.length === 0
      ? 0
      : Math.ceil(index.frames.length / normalizedOptions.columns),
    options: normalizedOptions,
    optionsKey: sequenceOptionsKey(normalizedOptions),
    index,
  }
}

function validSourceEpoch(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validOptionsKey(value) {
  return typeof value === 'string' && value.length > 0
}

export function createSequenceBinding({ sourceEpoch, optionsKey } = {}) {
  if (!validSourceEpoch(sourceEpoch) || !validOptionsKey(optionsKey)) {
    throw new TypeError('A non-negative sourceEpoch and optionsKey are required')
  }
  return Object.freeze({ sourceEpoch, optionsKey })
}

export function sequenceBindingIsCurrent(binding, { sourceEpoch, optionsKey } = {}) {
  return Boolean(
    validSourceEpoch(binding?.sourceEpoch) &&
    validOptionsKey(binding?.optionsKey) &&
    binding.sourceEpoch === sourceEpoch &&
    binding.optionsKey === optionsKey
  )
}

function crc32Table() {
  return Array.from({ length: 256 }, (_, n) => {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    return value >>> 0
  })
}

const CRC32_TABLE = crc32Table()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function concatBytes(chunks) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function makeStoredZip(entries) {
  const encoder = new TextEncoder()
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = entry.data
    const checksum = crc32(data)
    const local = new Uint8Array(30 + name.length)
    writeUint32(local, 0, 0x04034b50)
    writeUint16(local, 4, 20)
    writeUint16(local, 6, 0x0800)
    writeUint16(local, 8, 0)
    writeUint32(local, 10, 0)
    writeUint32(local, 14, checksum)
    writeUint32(local, 18, data.length)
    writeUint32(local, 22, data.length)
    writeUint16(local, 26, name.length)
    local.set(name, 30)
    localParts.push(local, data)

    const central = new Uint8Array(46 + name.length)
    writeUint32(central, 0, 0x02014b50)
    writeUint16(central, 4, 20)
    writeUint16(central, 6, 20)
    writeUint16(central, 8, 0x0800)
    writeUint16(central, 10, 0)
    writeUint32(central, 12, 0)
    writeUint32(central, 16, checksum)
    writeUint32(central, 20, data.length)
    writeUint32(central, 24, data.length)
    writeUint16(central, 28, name.length)
    writeUint32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length + data.length
  }

  const centralDirectory = concatBytes(centralParts)
  const end = new Uint8Array(22)
  writeUint32(end, 0, 0x06054b50)
  writeUint16(end, 8, entries.length)
  writeUint16(end, 10, entries.length)
  writeUint32(end, 12, centralDirectory.length)
  writeUint32(end, 16, offset)
  return new Blob([concatBytes(localParts), centralDirectory, end], {
    type: 'application/zip',
  })
}

async function blobBytes(value, label) {
  if (!value || typeof value.arrayBuffer !== 'function') {
    throw new TypeError(`${label} must be a Blob-like value`)
  }
  return new Uint8Array(await value.arrayBuffer())
}

export async function makeSpriteZip({ sheetBlob, index, gifBlob = null } = {}) {
  if (!index || typeof index !== 'object') {
    throw new TypeError('index must be an object')
  }
  const encoder = new TextEncoder()
  const entries = [
    { name: 'sprite.png', data: await blobBytes(sheetBlob, 'sheetBlob') },
    { name: 'index.json', data: encoder.encode(JSON.stringify(index, null, 2)) },
  ]
  if (gifBlob !== null && gifBlob !== undefined) {
    entries.push({ name: 'preview.gif', data: await blobBytes(gifBlob, 'gifBlob') })
  }
  return makeStoredZip(entries)
}
