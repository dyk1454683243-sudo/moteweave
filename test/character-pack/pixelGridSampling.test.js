import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { fractionalSearch, latticeBoundaries, recoverPixelGrid, sampleCells } from '../../src/character-pack/pixelGridSampling.js'
import { prepareSourcePixelRecovery } from '../../src/character-pack/sourcePixelRecovery.js'
import { processSheetBuffer } from '../../src/character-pack/processSheet.js'
import { buildCharacterPackArtifactManifest } from '../../src/character-pack/artifactManifest.js'
import { VNEXT_PROCESS_OPTIONS } from '../../src/ui/vnext/vnext-generation-client.js'
import { OCAD_REGIONS } from '../../src/character-pack/exporters/ocadExport.js'

// This accepted historical source is private and is intentionally not distributed.
const knightPath = process.env.GAMETOOL_PRIVATE_KNIGHT_FIXTURE
const privateFixture = { skip: !knightPath && 'Set GAMETOOL_PRIVATE_KNIGHT_FIXTURE to the exact private accepted source.' }
// Accepted C native RGBA, 20261013-edge-resample-r2/knight-global-0.png.
const acceptedHash = 'f03f3440f41ecfd3c75be2fad6f0a1ea565761b1190b0f2ffedb2193e32a26ec'
const hash = data => createHash('sha256').update(data).digest('hex')
async function readPrivateKnight() {
  assert.ok(path.isAbsolute(knightPath), 'The private fixture must use an absolute path')
  const bytes = await readFile(knightPath)
  assert.equal(hash(bytes), '262d86c2cda1a5a0c45e873e8487d163dd2ef8615c1c52493290a7eabd0eb3fe', 'The private input must match the accepted source; no substitute is allowed')
  return bytes
}

function blockImage(columns, rows, period, phase = 0) {
  const edges = n => Array.from({ length: n + 1 }, (_, i) => Math.floor(i * period + phase))
  const x = edges(columns), y = edges(rows)
  const image = { width: x.at(-1), height: y.at(-1), data: new Uint8ClampedArray(x.at(-1) * y.at(-1) * 4) }
  const logical = { width: columns, height: rows, data: new Uint8ClampedArray(columns * rows * 4) }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const color = [(col * 71 + row * 37) % 256, (row * 97 + col * 13) % 256, (col * 31 + row * 83) % 256, 255]
    logical.data.set(color, (row * columns + col) * 4)
    for (let py = y[row]; py < y[row + 1]; py++) for (let px = x[col]; px < x[col + 1]; px++) image.data.set(color, (py * image.width + px) * 4)
  }
  return { image, logical, x, y }
}

test('live source initializer reproduces the user-accepted C exactly without cached parameters', privateFixture, async () => {
  const bytes = await readPrivateKnight()
  assert.equal(hash(bytes), '262d86c2cda1a5a0c45e873e8487d163dd2ef8615c1c52493290a7eabd0eb3fe')
  const before = hash(bytes)
  const actual = await prepareSourcePixelRecovery(bytes, VNEXT_PROCESS_OPTIONS)
  assert.equal(actual.report.status, 'resampled')
  assert.deepEqual(actual.report.output, { width: 252, height: 252 })
  assert.equal(actual.report.output_rgba_sha256, acceptedHash)
  assert.equal(hash(bytes), before)
  assert.equal(actual.loadedRaw.width, 1024)
  assert.equal(actual.report.exact_recovery, false)
  assert.equal(actual.report.palette_reduction, false)
  assert.equal(hash((await loadRgba(actual.png)).data), acceptedHash)
})

test('clean integer/fractional cells and a 150-cell axis preserve every color and boundary', () => {
  for (const [columns, period, phase] of [[24, 4, 0], [24, 2.5, 0], [24, 5.82, 0.5], [150, 4.6875, 0]]) {
    const fixture = blockImage(columns, 20, period, phase)
    const before = hash(fixture.image.data)
    const result = recoverPixelGrid(fixture.image)
    assert.equal(result.report.status, 'resampled')
    assert.deepEqual(result.image, fixture.logical)
    assert.equal(hash(fixture.image.data), before)
    assert.deepEqual(latticeBoundaries(result.report.axes.x.period, result.report.axes.x.phase, fixture.image.width), fixture.x.slice(1, -1))
  }
})

test('median excludes hidden RGB, keeps alpha and handles incomplete boundary cells', () => {
  const image = { width: 3, height: 1, data: Uint8ClampedArray.from([255, 0, 255, 0, 12, 24, 48, 128, 18, 30, 60, 255]) }
  assert.deepEqual([...sampleCells(image, { x: [0, 3], y: [0, 1] }).data], [12, 24, 48, 128])
  assert.deepEqual([...sampleCells(image, { x: [0, 1, 3], y: [0, 1] }).data], [0, 0, 0, 0, 12, 24, 48, 128])
})

test('flat/gradient sources pass through honestly and bounded search cannot return a truncated candidate', () => {
  const blank = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  assert.equal(recoverPixelGrid(blank).image, blank)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) blank.data.set([x * 4, y * 4, (x + y) * 2, 255], (y * 64 + x) * 4)
  assert.equal(recoverPixelGrid(blank).report.status, 'passthrough')
  const profile = new Float64Array(800)
  for (const b of latticeBoundaries(4.6875, 0, 800)) profile[b] = 100
  const truncated = fractionalSearch(profile, { supportCap: 10 })
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.period, null)
  assert.ok(truncated.support_constraint_checks <= 10)
  assert.throws(() => recoverPixelGrid({ width: 4097, height: 1, data: new Uint8ClampedArray(4097 * 4) }), /oversized/)
})

test('recovery is opt-in and rejects an unsupported mode or conflicting finishing', async () => {
  assert.equal(await prepareSourcePixelRecovery(Buffer.alloc(0)), null)
  assert.equal(await prepareSourcePixelRecovery(Buffer.alloc(0), { sourcePixelRecovery: false }), null)
  await assert.rejects(prepareSourcePixelRecovery(Buffer.alloc(0), { sourcePixelRecovery: true }), /Unsupported/)
  await assert.rejects(prepareSourcePixelRecovery(Buffer.alloc(0), { ...VNEXT_PROCESS_OPTIONS, pixelFinishing: true }), /finishing/)
  await assert.rejects(prepareSourcePixelRecovery(Buffer.alloc(0), { ...VNEXT_PROCESS_OPTIONS, pixel_finishing: true }), /finishing/)
  await assert.rejects(prepareSourcePixelRecovery(Buffer.alloc(0), { ...VNEXT_PROCESS_OPTIONS, backgroundMode: ' DUAL_MATTE ' }), /paired dual matte/)
})

test('canonical background aliases keep V2 behavior and already-hard alpha remains intact', async () => {
  const image = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) }
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) image.data.set([90, 45, 20, 255], (y * 8 + x) * 4)
  const png = await encodeRgbaPng(image)
  const actual = await prepareSourcePixelRecovery(png, { ...VNEXT_PROCESS_OPTIONS, backgroundMode: ' MATTE_V2 ' })
  assert.equal(actual.background.canonical_mode, 'deterministic_pixel_matte_v2')
  assert.equal(actual.background.quality.status, 'pass')
  assert.deepEqual(actual.background.image.data, image.data)
})

test('native fixed-region sources retain one-pixel details instead of being pixelized again', async () => {
  const image = blockImage(18, 18, 6).image
  const input = await encodeRgbaPng(image)
  const native = await prepareSourcePixelRecovery(input, { sourcePixelRecovery: 'global_median_v1' }, { kind: 'fixed_regions', sheet: { w: 252, h: 252 } })
  assert.equal(native.report.reason, 'already_at_layout_resolution')
  assert.equal(native.png, null)
  assert.deepEqual(native.image.data, image.data)
})

test('resampled transparent source passes real Process validation and its export retains the recovered pixels', async () => {
  const native = { width: 252, height: 252, data: new Uint8ClampedArray(252 * 252 * 4) }
  for (const [index, [key, r]] of Object.entries(OCAD_REGIONS).entries()) {
    const seed = [...key].reduce((sum, c) => sum + c.charCodeAt(0), 0) + index * 19
    const padding = r.w >= 42 ? 4 : 2
    for (let y = r.y + 3; y < r.y + r.h - 3; y++) for (let x = r.x + padding; x < r.x + r.w - padding; x++) {
      native.data.set([(seed * 3) % 192 + (x % 2) * 32, (seed * 5) % 192 + (y % 2) * 32, (seed * 7) % 192 + ((x + y) % 2) * 32, 255], (y * 252 + x) * 4)
    }
  }
  const enlarged = { width: 1008, height: 1008, data: new Uint8ClampedArray(1008 * 1008 * 4) }
  for (let y = 0; y < 1008; y++) for (let x = 0; x < 1008; x++) {
    const offset = (Math.floor(y / 4) * 252 + Math.floor(x / 4)) * 4
    enlarged.data.set(native.data.subarray(offset, offset + 4), (y * 1008 + x) * 4)
  }
  const result = await processSheetBuffer(await encodeRgbaPng(enlarged), {
    ...VNEXT_PROCESS_OPTIONS, name: 'pixel_recovery_success_control', backgroundMatteV2ArtifactUrlPrefix: '/generated/pixel_control',
  })
  assert.equal(result.debugReport.source_pixel_recovery.status, 'resampled')
  assert.equal(result.debugReport.source_pixel_recovery.output_rgba_sha256, hash(native.data))
  assert.equal(result.debugReport.source_background.quality.status, 'pass')
  assert.equal(result.debugReport.validation.status, 'pass', JSON.stringify(result.debugReport.validation))
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  const recovered = await loadRgba(await zip.file('source_pixel_recovery.png').async('nodebuffer'))
  assert.equal(hash(recovered.data), hash(native.data))
  const normalized = await zip.file('normalized_sheet.png').async('nodebuffer')
  assert.deepEqual(normalized, result.files.normalizedSheetPng)
})

test('real VNext Process keeps C before geometry, preserves provenance and packages a distinct recovery artifact', privateFixture, async () => {
  const bytes = await readPrivateKnight()
  const result = await processSheetBuffer(bytes, { ...VNEXT_PROCESS_OPTIONS, name: 'pixel_recovery_regression', backgroundMatteV2ArtifactUrlPrefix: '/generated/pixel_test' })
  assert.equal(result.debugReport.source_pixel_recovery.output_rgba_sha256, acceptedHash)
  assert.equal(result.debugReport.source_pixel_recovery.original_encoded_sha256, hash(bytes))
  assert.equal(hash((await loadRgba(result.files.sourcePixelRecoveryPng)).data), acceptedHash)
  assert.equal(hash((await loadRgba(result.files.sourcePng)).data), acceptedHash)
  assert.equal(result.debugReport.background_processed_before_geometry, true)
  assert.equal(result.debugReport.source_preprocess.applied, false)
  assert.equal(result.debugReport.canonical_background_mode, 'deterministic_pixel_matte_v2')
  assert.equal(result.debugReport.source_background.metadata.source_rgba_sha256, result.debugReport.source_background.quality.source_sha256)
  assert.equal((await loadRgba(result.files.normalizedSheetPng)).width, 768)
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.deepEqual(await zip.file('source_pixel_recovery.png').async('nodebuffer'), result.files.sourcePixelRecoveryPng)
  const manifest = buildCharacterPackArtifactManifest('pixel_test', result)
  assert.ok(manifest.files.some(file => file.name === 'source_pixel_recovery.png'))
  assert.equal(manifest.urls.background_quality_url, '/generated/pixel_test/background_quality.json')
  const review = JSON.parse(result.files.backgroundMatteV2ArtifactBuffers['background_review.json'])
  assert.equal(review.urls.background_preview_url, '/generated/pixel_test/background_preview.png')
  assert.deepEqual(await zip.file('background_quality.json').async('nodebuffer'), result.files.backgroundMatteV2ArtifactBuffers['background_quality.json'])
  assert.notEqual(result.debugReport.source_background.quality.status, 'pass')
  assert.equal(result.debugReport.validation.status, 'fail')
  assert.ok(result.debugReport.validation.blocking_errors.some(error => error.startsWith('background_v2_')))
  assert.equal(result.debugReport.pixel_style?.method === 'pixel_finishing_v1', false)
})
