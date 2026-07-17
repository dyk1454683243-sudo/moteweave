import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import sharp from 'sharp'

import { buildCharacterPackArtifactManifest } from '../../src/character-pack/artifactManifest.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../../src/character-pack/imageCodec.js'
import { buildAnimationsJson } from '../../src/character-pack/packageBuilder.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { computeGridBoundaries, sliceRgbaCells } from '../../src/character-pack/sheetSlicer.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  getRuntimeAnimationSemantics,
  getSourceLayoutActions,
  resolveSourceLayout,
} from '../../src/character-pack/sourceLayouts.js'
import { validateNormalizedFrames } from '../../src/character-pack/validator.js'
import {
  packageNormalizedCharacterSheet,
  sanitizeFrameRepairGeneration,
} from '../../src/editor-project/normalizedCharacterSheetPackage.js'

const TEST_MAX_MANAGED_NORMALIZED_PNG_BYTES = 16 * 1024 * 1024
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

function sourceLayoutSummary(id) {
  const layout = resolveSourceLayout(id)
  return {
    id: layout.id,
    kind: layout.kind,
    label: layout.label,
    target_profile: TOPDOWN_RPG_V0.id,
    actions: getSourceLayoutActions(layout),
  }
}

function parentAnimations(sourceLayoutId = null) {
  const layout = sourceLayoutId ? resolveSourceLayout(sourceLayoutId) : null
  return buildAnimationsJson(TOPDOWN_RPG_V0, {
    ...(layout ? { sourceLayout: sourceLayoutSummary(layout.id) } : {}),
    animationSemantics: layout ? getRuntimeAnimationSemantics(layout, TOPDOWN_RPG_V0) : {},
  })
}

async function exactSheetPng() {
  const image = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  for (let frame = 0; frame < 64; frame += 1) {
    const x = (frame % 8) * 96 + 47
    const y = Math.floor(frame / 8) * 96 + 80
    const offset = (y * image.width + x) * 4
    image.data.set([32 + frame, 96, 144, 255], offset)
  }
  return { image, png: await encodeRgbaPng(image) }
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function compressedPngFrame(image) {
  const rowLength = image.width * 4 + 1
  const scanlines = Buffer.alloc(rowLength * image.height)
  const pixels = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  for (let y = 0; y < image.height; y += 1) {
    pixels.copy(scanlines, y * rowLength + 1, y * image.width * 4, (y + 1) * image.width * 4)
  }
  return deflateSync(scanlines)
}

function apngFrameControl(sequence, image) {
  const data = Buffer.alloc(26)
  data.writeUInt32BE(sequence, 0)
  data.writeUInt32BE(image.width, 4)
  data.writeUInt32BE(image.height, 8)
  data.writeUInt16BE(1, 20)
  data.writeUInt16BE(10, 22)
  return data
}

function animatedSheetPng(image) {
  const alternate = { ...image, data: new Uint8ClampedArray(image.data) }
  alternate.data.set([220, 40, 90, 255], (80 * image.width + 48) * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const animation = Buffer.alloc(8)
  animation.writeUInt32BE(2, 0)
  const secondFrame = compressedPngFrame(alternate)
  const secondFrameData = Buffer.alloc(secondFrame.length + 4)
  secondFrameData.writeUInt32BE(2, 0)
  secondFrame.copy(secondFrameData, 4)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('acTL', animation),
    pngChunk('fcTL', apngFrameControl(0, image)),
    pngChunk('IDAT', compressedPngFrame(image)),
    pngChunk('fcTL', apngFrameControl(1, image)),
    pngChunk('fdAT', secondFrameData),
    pngChunk('IEND'),
  ])
}

function pngAnimationFrameCount(buffer) {
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'acTL' && length === 8) return buffer.readUInt32BE(offset + 8)
    offset += length + 12
  }
  return 1
}

function pngWithAncillaryChunkAtLength(png, targetLength) {
  let iendOffset = -1
  let offset = 8
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IEND') {
      iendOffset = offset
      break
    }
    offset += length + 12
  }
  assert.ok(iendOffset >= 0)
  const payloadLength = targetLength - png.length - 12
  assert.ok(payloadLength > 0)
  return Buffer.concat([
    png.subarray(0, iendOffset),
    pngChunk('ruSt', Buffer.alloc(payloadLength)),
    png.subarray(iendOffset),
  ])
}

async function validPackageInput() {
  const { image, png } = await exactSheetPng()
  return {
    image,
    input: {
      normalizedSheetPng: png,
      profile: TOPDOWN_RPG_V0,
      parentAnimations: parentAnimations(),
      parentMetadata: {
        version: TOPDOWN_RPG_V0.version,
        id: 'parent_pack',
        name: 'Hero',
        description: 'Managed hero',
        profile: TOPDOWN_RPG_V0.id,
        source: { type: 'upload', file_name: 'old_source.png', private_path: '/private/old_source.png' },
        generation: { provider: 'old-provider', apiKey: 'parent-only-secret' },
        normalization: { mode: 'old_pipeline', applied: true },
      },
      createdAt: '2026-07-11T00:00:00.000Z',
      lineage: {
        project_id: 'project_demo',
        asset_id: 'asset_hero',
        parent_revision_id: 'rev_003',
        parent_job_id: 'job_parent',
        parent_processing_recipe_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_003/processing_recipe.json',
      },
      generation: {
        mode: 'editor_targeted_frame_repair',
        provider: 'gemini',
        provider_preset_id: 'gemini-default',
        provider_label: 'Gemini Default',
        model: 'image-model',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
      },
    },
  }
}

function clonePackageInput(input) {
  return {
    normalizedSheetPng: Buffer.from(input.normalizedSheetPng),
    profile: structuredClone(input.profile),
    parentAnimations: structuredClone(input.parentAnimations),
    parentMetadata: structuredClone(input.parentMetadata),
    createdAt: input.createdAt,
    lineage: structuredClone(input.lineage),
    generation: structuredClone(input.generation),
  }
}

let packageFixturePromise

async function packagedFixture() {
  packageFixturePromise ??= (async () => {
    const fixture = await validPackageInput()
    const snapshots = {
      png: Buffer.from(fixture.input.normalizedSheetPng),
      profile: structuredClone(fixture.input.profile),
      parentAnimations: structuredClone(fixture.input.parentAnimations),
      parentMetadata: structuredClone(fixture.input.parentMetadata),
      lineage: structuredClone(fixture.input.lineage),
      generation: structuredClone(fixture.input.generation),
    }
    const result = await packageNormalizedCharacterSheet(fixture.input)
    return { ...fixture, snapshots, result }
  })()
  return packageFixturePromise
}

function isInvalidManagedSource(error) {
  assert.equal(error?.code, 'invalid_managed_source')
  assert.equal(error?.message, 'managed normalized sheet package input is invalid')
  return true
}

async function managedSourceOutcome(input) {
  try {
    await packageNormalizedCharacterSheet(input)
    return 'accepted'
  } catch (error) {
    isInvalidManagedSource(error)
    return 'rejected'
  }
}

test('packager preserves the exact normalized pixels and records no normalization Recipe', async () => {
  const { image, input, snapshots, result } = await packagedFixture()

  assert.deepEqual((await loadRgba(result.files.sourcePng)).data, image.data)
  assert.deepEqual((await loadRgba(result.files.normalizedSheetPng)).data, image.data)
  assert.deepEqual(result.files.sourcePng, snapshots.png)
  assert.deepEqual(result.files.normalizedSheetPng, snapshots.png)
  assert.notStrictEqual(result.files.sourcePng, input.normalizedSheetPng)
  assert.notStrictEqual(result.files.normalizedSheetPng, input.normalizedSheetPng)
  assert.notStrictEqual(result.files.sourcePng, result.files.normalizedSheetPng)
  assert.equal(result.metadataJson.source.type, 'derived_revision')
  assert.equal(result.metadataJson.generation.mode, 'editor_targeted_frame_repair')
  assert.equal(result.metadataJson.generation.provider_preset_id, 'gemini-default')
  assert.equal(result.processingRecipe, null)
  assert.equal(result.debugReport.normalization.mode, 'already_normalized')

  assert.deepEqual(input.normalizedSheetPng, snapshots.png)
  assert.deepEqual(input.profile, snapshots.profile)
  assert.deepEqual(input.parentAnimations, snapshots.parentAnimations)
  assert.deepEqual(input.parentMetadata, snapshots.parentMetadata)
  assert.deepEqual(input.lineage, snapshots.lineage)
  assert.deepEqual(input.generation, snapshots.generation)

  assert.equal(result.frames.length, 64)
  const expectedCells = sliceRgbaCells(image, computeGridBoundaries({
    width: image.width,
    height: image.height,
    columns: TOPDOWN_RPG_V0.grid.columns,
    rows: TOPDOWN_RPG_V0.grid.rows,
  }))
  for (const [index, frame] of result.frames.entries()) {
    assert.deepEqual(frame.image.data, expectedCells[index].image.data)
    assert.deepEqual(frame.source_bbox, frame.normalized_bbox)
    assert.deepEqual(frame.source_anchor, frame.normalized_anchor)
    assert.equal(Object.hasOwn(frame, 'normalization_recipe'), false)
    assert.equal(Object.hasOwn(frame, 'stabilization_recipe'), false)
  }
})

test('normalized packager source does not import or call the normal processing entry', async () => {
  const source = await readFile('src/editor-project/normalizedCharacterSheetPackage.js', 'utf8')
  assert.doesNotMatch(
    source,
    /processSheetBuffer|prepareSourceForProcessing|normalizeCells|applyAnchorOffset|motionStabil/i,
  )
})

test('packager rejects unregistered profiles, layout-changing animations, corrupt PNGs, and wrong dimensions', async () => {
  const fixture = await validPackageInput()

  const wrongProfile = clonePackageInput(fixture.input)
  wrongProfile.profile.sheet.w = 96
  await assert.rejects(() => packageNormalizedCharacterSheet(wrongProfile), isInvalidManagedSource)

  const animationMutations = [
    (value) => { value.version = '9.9' },
    (value) => { value.profile = 'other_profile' },
    (value) => { value.sheet = 'other_sheet.png' },
    (value) => { value.frame_size.w = 48 },
    (value) => { value.sheet_size.h = 96 },
    (value) => { value.anchor.x += 1 },
    (value) => { value.animations.walk_down.frames = [17, 16, 18, 19] },
    (value) => { value.animations.walk_down.fps += 1 },
    (value) => { value.animations.walk_down.loop = false },
    (value) => { value.animations.walk_down.mode = 'once' },
    (value) => { value.source_layout = { id: 'fixed_region_motion_v1', kind: 'fixed_regions' } },
  ]
  for (const mutate of animationMutations) {
    const invalid = clonePackageInput(fixture.input)
    mutate(invalid.parentAnimations)
    await assert.rejects(() => packageNormalizedCharacterSheet(invalid), isInvalidManagedSource)
  }

  for (const invalidPng of [
    Buffer.alloc(0),
    Buffer.from('/private/managed/source.png'),
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('private-bytes')]),
  ]) {
    const invalid = clonePackageInput(fixture.input)
    invalid.normalizedSheetPng = invalidPng
    await assert.rejects(() => packageNormalizedCharacterSheet(invalid), isInvalidManagedSource)
  }

  const small = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  const wrongDimensions = clonePackageInput(fixture.input)
  wrongDimensions.normalizedSheetPng = await encodeRgbaPng(small)
  await assert.rejects(() => packageNormalizedCharacterSheet(wrongDimensions), isInvalidManagedSource)
})

test('packager rejects sparse registered profiles and sparse parent frame arrays', async () => {
  const fixture = await validPackageInput()
  const sparseProfile = clonePackageInput(fixture.input)
  delete sparseProfile.profile.animations[0]
  const sparseFrames = clonePackageInput(fixture.input)
  delete sparseFrames.parentAnimations.animations.walk_down.frames[1]

  const outcomes = []
  for (const input of [sparseProfile, sparseFrames]) outcomes.push(await managedSourceOutcome(input))
  assert.deepEqual(outcomes, ['rejected', 'rejected'])
})

test('packager preserves ordered repeated frame positions inside the registered clip region', async () => {
  const fixture = await validPackageInput()
  fixture.input.parentAnimations.animations.walk_down.frames = [16, 17, 17, 18]
  const result = await packageNormalizedCharacterSheet(fixture.input)
  assert.deepEqual(result.animationsJson.animations.walk_down.frames, [16, 17, 17, 18])
})

test('packager accepts only standard public animation provenance and rejects private or preview fields', async () => {
  const fixture = await validPackageInput()
  const mutations = [
    (value) => { value.normalization = { mode: 'old_pipeline', applied: true } },
    (value) => { value.anchor.apiKey = 'private-anchor-key' },
    (value) => {
      value.source_layout = sourceLayoutSummary(TOPDOWN_RPG_V0.id)
      value.source_layout.private_path = '/private/source.png'
    },
    (value) => {
      value.animations.walk_down.secret = 'private-animation-secret'
      value.animations.walk_down.preview_hidden = true
      value.animations.walk_down.preview_file_base = 'redirected_preview'
    },
  ]
  const outcomes = []
  for (const mutate of mutations) {
    const invalid = clonePackageInput(fixture.input)
    mutate(invalid.parentAnimations)
    outcomes.push(await managedSourceOutcome(invalid))
  }
  assert.deepEqual(outcomes, mutations.map(() => 'rejected'))

  for (const sourceLayoutId of [TOPDOWN_RPG_V0.id, FIXED_REGION_MOTION_LAYOUT_ID]) {
    const accepted = clonePackageInput(fixture.input)
    accepted.parentAnimations = parentAnimations(sourceLayoutId)
    const result = await packageNormalizedCharacterSheet(accepted)
    assert.deepEqual(result.animationsJson, accepted.parentAnimations)
    assert.notStrictEqual(result.animationsJson, accepted.parentAnimations)
  }
})

test('PNG metadata preflight rejects animation and oversized dimensions before raw decode', async () => {
  const fixture = await validPackageInput()
  const animatedPng = animatedSheetPng(fixture.image)
  const animatedMetadata = await sharp(animatedPng, { animated: true }).metadata()
  assert.equal(animatedMetadata.format, 'png')
  assert.equal(animatedMetadata.width, TOPDOWN_RPG_V0.sheet.w)
  assert.equal(animatedMetadata.height, TOPDOWN_RPG_V0.sheet.h)
  assert.equal(pngAnimationFrameCount(animatedPng), 2)

  const animatedInput = clonePackageInput(fixture.input)
  animatedInput.normalizedSheetPng = animatedPng
  const animatedOutcome = await managedSourceOutcome(animatedInput)

  const oversizedInput = clonePackageInput(fixture.input)
  oversizedInput.normalizedSheetPng = await sharp({
    create: {
      width: TOPDOWN_RPG_V0.sheet.w + 1,
      height: TOPDOWN_RPG_V0.sheet.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer()
  const oversizedOutcome = await managedSourceOutcome(oversizedInput)

  const source = await readFile('src/editor-project/normalizedCharacterSheetPackage.js', 'utf8')
  const packageBody = source.slice(source.indexOf('export async function packageNormalizedCharacterSheet'))
  const metadataGate = packageBody.indexOf('await assertManagedPngMetadata(managedPng, managedProfile)')
  const rawDecode = packageBody.indexOf('await loadRgba(managedPng)')
  assert.deepEqual(
    {
      animatedOutcome,
      oversizedOutcome,
      metadataGateBeforeRawDecode: metadataGate >= 0 && rawDecode > metadataGate,
    },
    {
      animatedOutcome: 'rejected',
      oversizedOutcome: 'rejected',
      metadataGateBeforeRawDecode: true,
    },
  )
})

test('managed PNG byte cap rejects a decodable ancillary payload before copy or decode', async () => {
  const fixture = await validPackageInput()
  assert.ok(fixture.input.normalizedSheetPng.length < TEST_MAX_MANAGED_NORMALIZED_PNG_BYTES)
  const oversizedPng = pngWithAncillaryChunkAtLength(
    fixture.input.normalizedSheetPng,
    TEST_MAX_MANAGED_NORMALIZED_PNG_BYTES + 1,
  )
  assert.equal(oversizedPng.length, TEST_MAX_MANAGED_NORMALIZED_PNG_BYTES + 1)
  const decoded = await loadRgba(oversizedPng)
  assert.deepEqual(
    { width: decoded.width, height: decoded.height },
    { width: TOPDOWN_RPG_V0.sheet.w, height: TOPDOWN_RPG_V0.sheet.h },
  )

  const input = clonePackageInput(fixture.input)
  input.normalizedSheetPng = oversizedPng
  const outcome = await managedSourceOutcome(input)
  const source = await readFile('src/editor-project/normalizedCharacterSheetPackage.js', 'utf8')
  const packageBody = source.slice(source.indexOf('export async function packageNormalizedCharacterSheet'))
  const byteGate = packageBody.indexOf('normalizedSheetPng.length > MAX_MANAGED_NORMALIZED_PNG_BYTES')
  const firstCopy = packageBody.indexOf('Buffer.from(normalizedSheetPng)')
  const metadataGate = packageBody.indexOf('await assertManagedPngMetadata')
  assert.deepEqual(
    {
      outcome,
      byteGateBeforeCopyAndMetadata: byteGate >= 0 && firstCopy > byteGate && metadataGate > byteGate,
    },
    {
      outcome: 'rejected',
      byteGateBeforeCopyAndMetadata: true,
    },
  )
})

test('generation sanitizer is exact, detached, and rejects private or unsafe data without echoing it', () => {
  const generation = {
    mode: 'editor_targeted_frame_repair',
    provider: 'gemini',
    provider_preset_id: 'preset-safe',
    provider_label: 'Safe preset',
    model: 'provider/image-model',
    image_config: { image_size: '2K', aspect_ratio: '16:9' },
  }
  const snapshot = structuredClone(generation)
  const safe = sanitizeFrameRepairGeneration(generation)
  assert.deepEqual(safe, snapshot)
  assert.notStrictEqual(safe, generation)
  assert.notStrictEqual(safe.image_config, generation.image_config)
  assert.deepEqual(generation, snapshot)

  const invalidValues = [
    Object.assign(Object.create(null), snapshot),
    { ...snapshot, mode: 'other_mode' },
    { ...snapshot, apiKey: 'private-key' },
    { ...snapshot, baseUrl: 'https://private.example' },
    { ...snapshot, adapter: () => null },
    { ...snapshot, secret: 'do-not-echo' },
    { ...snapshot, path: '/private/model.bin' },
    { ...snapshot, image_base64: 'data:image/png;base64,cHJpdmF0ZQ==' },
    { ...snapshot, provider: () => 'private' },
    { ...snapshot, model: 'sk-abcdefghijklmnop' },
    { ...snapshot, model: '/Users/private/model.bin' },
    { ...snapshot, provider_label: `data:image/png;base64,${'A'.repeat(64)}` },
    { ...snapshot, image_config: { image_size: '4K', aspect_ratio: '1:1' } },
    { ...snapshot, image_config: { image_size: '1K' } },
    { ...snapshot, image_config: { image_size: '1K', aspect_ratio: '1:1\nprivate' } },
    { ...snapshot, image_config: { image_size: '1K', aspect_ratio: '1:1', apiKey: 'private' } },
  ]
  for (const value of invalidValues) {
    assert.throws(() => sanitizeFrameRepairGeneration(value), isInvalidManagedSource)
  }
})

test('generation sanitizer requires the complete six-field public snapshot', () => {
  const generation = {
    mode: 'editor_targeted_frame_repair',
    provider: 'gemini',
    provider_preset_id: 'preset-safe',
    provider_label: 'Safe preset',
    model: 'provider/image-model',
    image_config: { image_size: '2K', aspect_ratio: '16:9' },
  }
  for (const key of Object.keys(generation)) {
    const incomplete = structuredClone(generation)
    delete incomplete[key]
    assert.throws(() => sanitizeFrameRepairGeneration(incomplete), isInvalidManagedSource)
  }
})

test('parent metadata rejects secret-shaped name and description without echoing values', async () => {
  const fixture = await validPackageInput()
  const cases = [
    { field: 'name', secret: 'Hero sk-abcdefghijklmnop' },
    { field: 'description', secret: 'Bearer private.token-123' },
    { field: 'description', secret: 'AIza1234567890abcdefghijkl' },
  ]
  const outcomes = []
  for (const item of cases) {
    const input = clonePackageInput(fixture.input)
    input.parentMetadata[item.field] = item.secret
    try {
      await packageNormalizedCharacterSheet(input)
      outcomes.push('accepted')
    } catch (error) {
      isInvalidManagedSource(error)
      const serialized = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details,
      })
      assert.equal(serialized.includes(item.secret), false)
      outcomes.push('rejected')
    }
  }
  assert.deepEqual(outcomes, cases.map(() => 'rejected'))
})

test('metadata, debug evidence, and parent animations preserve safe lineage without old claims', async () => {
  const { input, snapshots, result } = await packagedFixture()
  assert.equal(result.id, 'npc_20260711_000000_hero')
  assert.equal(result.metadataJson.created_at, input.createdAt)
  assert.deepEqual(result.metadataJson.source, {
    type: 'derived_revision',
    file_name: 'source.png',
    parent_project_id: input.lineage.project_id,
    parent_asset_id: input.lineage.asset_id,
    parent_revision_id: input.lineage.parent_revision_id,
    parent_job_id: input.lineage.parent_job_id,
  })
  assert.equal(JSON.stringify(result.metadataJson).includes('parent-only-secret'), false)
  assert.equal(JSON.stringify(result.metadataJson).includes('/private/old_source.png'), false)
  assert.equal(JSON.stringify(result.debugReport).includes('old_pipeline'), false)

  assert.deepEqual(result.animationsJson, snapshots.parentAnimations)
  assert.notStrictEqual(result.animationsJson, input.parentAnimations)
  assert.notStrictEqual(result.animationsJson.animations, input.parentAnimations.animations)
  assert.notStrictEqual(result.animationsJson.animations.walk_down, input.parentAnimations.animations.walk_down)
  assert.notStrictEqual(result.animationsJson.animations.walk_down.frames, input.parentAnimations.animations.walk_down.frames)

  assert.deepEqual(result.debugReport.lineage, input.lineage)
  const skipped = result.debugReport.normalization
  for (const key of [
    'source_preparation',
    'background_removal',
    'grid_correction',
    'cell_normalization',
    'anchor_offset',
    'auto_correction',
    'motion_stabilization',
    'manual_adjustments',
    'pixel_finishing',
    'palette_mutation',
    'resizing',
    'per_frame_nudge',
  ]) {
    assert.deepEqual(skipped[key], { applied: false, reason: 'already_normalized_input' })
  }
  const validation = validateNormalizedFrames(result.frames, TOPDOWN_RPG_V0)
  assert.deepEqual(result.debugReport.validation, validation)
  assert.equal(result.debugReport.quality_closure.mode, 'character_frame_quality_closure_v1')
  assert.deepEqual(result.metadataJson.quality, {
    status: validation.status,
    warnings: validation.warnings,
    blocking_errors: validation.blocking_errors,
  })
  assert.equal(result.processingRecipe, null)
})

test('packager builds real previews, nearest sheets, engine exports, main ZIP, and manifest entries', async () => {
  const { image, snapshots, result } = await packagedFixture()

  assert.equal(result.rowPreviews.length, TOPDOWN_RPG_V0.animations.length)
  assert.equal(Object.keys(result.files.rowGifBuffers).length, TOPDOWN_RPG_V0.animations.length)
  for (const buffer of Object.values(result.files.rowGifBuffers)) {
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 20)
    assert.match(buffer.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/)
  }

  assert.equal(result.inspectionPreviews.length, TOPDOWN_RPG_V0.animations.length)
  assert.equal(result.files.inspectionIndexJson.mode, 'inspection_preview_v1')
  assert.equal(result.files.inspectionIndexJson.actions.length, TOPDOWN_RPG_V0.animations.length)
  assert.ok(result.files.inspectionSheetPng.length > 20)
  assert.equal(Object.keys(result.files.inspectionGifBuffers).length, TOPDOWN_RPG_V0.animations.length)
  assert.equal(Object.keys(result.files.inspectionStripPngBuffers).length, TOPDOWN_RPG_V0.animations.length)
  assert.deepEqual(result.debugReport.inspection_preview, {
    ...result.debugReport.inspection_preview,
    mode: 'inspection_preview_v1',
    action_count: TOPDOWN_RPG_V0.animations.length,
  })

  assert.deepEqual(
    result.files.multiResolutionManifest.sheets.map((sheet) => sheet.frame_size),
    [96, 64, 48, 32, 16],
  )
  for (const item of result.files.multiResolutionManifest.sheets) {
    assert.ok(Buffer.isBuffer(result.files.multiResolutionSheets[item.frame_size]))
    const decoded = await loadRgba(result.files.multiResolutionSheets[item.frame_size])
    assert.deepEqual({ w: decoded.width, h: decoded.height }, item.sheet)
  }
  const expected64 = await resizeRgbaNearest(image, { w: 512, h: 512 })
  assert.deepEqual((await loadRgba(result.files.multiResolutionSheets[64])).data, expected64.data)

  for (const buffer of [
    result.files.sourceLayoutOverlayPng,
    result.files.debugOverlayPng,
    result.files.onionSkinOverlayPng,
    result.files.godotNpcZipBuffer,
    result.files.rpgmakerZipBuffer,
    result.files.ocadZipBuffer,
    result.files.zipBuffer,
  ]) {
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 20)
  }

  const engineZips = await Promise.all([
    JSZip.loadAsync(result.files.godotNpcZipBuffer),
    JSZip.loadAsync(result.files.rpgmakerZipBuffer),
    JSZip.loadAsync(result.files.ocadZipBuffer),
  ])
  assert.ok(engineZips[0].file(`AI资源库/一图全动作/${result.id}/npc.json`))
  assert.ok(engineZips[0].file(`AI资源库/一图全动作/${result.id}/sprite.png`))
  assert.ok(engineZips[1].file(`AI资源库/RPGMAKER/${result.id}_rpgmaker/NPC.json`))
  assert.ok(engineZips[1].file(`AI资源库/RPGMAKER/${result.id}_rpgmaker/sprite.png`))
  assert.ok(engineZips[2].file(`AI资源库/一图全动作/${result.id}_ocad/npc.json`))
  assert.ok(engineZips[2].file(`AI资源库/一图全动作/${result.id}_ocad/sprite.png`))

  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  for (const name of [
    'source.png',
    'normalized_sheet.png',
    'source_layout_overlay.png',
    'multi_resolution.json',
    'normalized_sheet_64.png',
    'debug_overlay.png',
    'onion_skin_overlay.png',
    'animations.json',
    'metadata.json',
    'editor_metadata.json',
    'debug_report.json',
    'generation.json',
    'inspection_index.json',
    'inspection_sheet.png',
    'walk_down.gif',
    'inspection_gifs/walk_down.gif',
    'inspection_strips/walk_down.png',
    `AI资源库/一图全动作/${result.id}/npc.json`,
    `AI资源库/RPGMAKER/${result.id}_rpgmaker/NPC.json`,
    `AI资源库/一图全动作/${result.id}_ocad/npc.json`,
  ]) {
    assert.ok(zip.file(name), `missing ${name}`)
  }
  assert.equal(zip.file('processing_recipe.json'), null)
  assert.deepEqual(await zip.file('source.png').async('nodebuffer'), snapshots.png)
  assert.deepEqual(await zip.file('normalized_sheet.png').async('nodebuffer'), snapshots.png)
  assert.deepEqual(
    JSON.parse(await zip.file('generation.json').async('string')),
    result.metadataJson.generation,
  )

  const manifest = buildCharacterPackArtifactManifest('job_repair', result)
  const manifestNames = new Set(manifest.files.map((file) => file.name))
  for (const name of [
    'source.png',
    'normalized_sheet.png',
    'multi_resolution.json',
    'inspection_index.json',
    'godot_npc_pack.zip',
    'rpgmaker_pack.zip',
    'ocad_pack.zip',
    'character_pack.zip',
  ]) {
    assert.equal(manifestNames.has(name), true, `manifest missing ${name}`)
  }
  for (const file of manifest.files) {
    assert.notEqual(file.content, null)
    assert.notEqual(file.content, undefined)
    if (Buffer.isBuffer(file.content)) assert.ok(file.content.length > 0)
  }
})
