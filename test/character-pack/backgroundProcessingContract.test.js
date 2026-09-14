import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import {
  ALPHA_PROVENANCE,
  BACKGROUND_MODES,
  BACKGROUND_RECIPE_IDS,
  inspectDecodedAlpha,
  resolveBackgroundMode,
  zeroTransparentRgbFromRgba,
} from '../../src/character-pack/backgroundProcessingContract.js'
import { loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  resolveBackgroundOptions,
  resolveComponentCleanupOptions,
} from '../../src/character-pack/processingOptions.js'
import { removeBackground } from '../../src/character-pack/sourcePreparation.js'

function rgba(width, height, values) {
  return { width, height, data: Uint8ClampedArray.from(values) }
}

test('background mode parser preserves legacy aliases and rejects unknown values', () => {
  assert.equal(resolveBackgroundMode(undefined).canonical, BACKGROUND_MODES.AUTO)
  assert.equal(resolveBackgroundMode('flood_edge').canonical, BACKGROUND_MODES.AUTO)
  assert.equal(resolveBackgroundMode('flood').canonical, BACKGROUND_MODES.LEGACY_FLOOD)
  assert.equal(resolveBackgroundMode('legacy_edge_palette').canonical, BACKGROUND_MODES.LEGACY_EDGE_PALETTE)
  assert.equal(resolveBackgroundMode('transparent').canonical, BACKGROUND_MODES.ALPHA)
  assert.equal(resolveBackgroundMode('alpha_cleanup').recipe_id, BACKGROUND_RECIPE_IDS.NATIVE_ALPHA)
  assert.throws(() => resolveBackgroundMode('not-a-mode'), /unknown background mode/)
  assert.throws(
    () => resolveBackgroundMode('deterministic_pixel_matte_v2'),
    /not enabled for this path/,
  )
  assert.throws(() => resolveBackgroundMode('already_processed'), /not enabled for this path/)
})

test('alpha mode uses native alpha and minAlpha instead of falling into flood', async () => {
  const source = rgba(2, 1, [255, 255, 255, 10, 40, 60, 80, 255])
  const result = await removeBackground(source, {
    backgroundMode: 'alpha',
    minAlpha: 20,
  })

  assert.equal(result.mode, 'alpha_cleanup')
  assert.equal(result.canonical_mode, BACKGROUND_MODES.ALPHA)
  assert.equal(result.recipe_id, BACKGROUND_RECIPE_IDS.NATIVE_ALPHA)
  assert.equal(result.alpha_provenance, ALPHA_PROVENANCE.NATIVE)
  assert.deepEqual([...result.image.data.slice(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...result.image.data.slice(4, 8)], [40, 60, 80, 255])
})

test('public minAlpha minArea and minAreaRatio aliases bind to canonical options', () => {
  assert.equal(resolveBackgroundOptions({ minAlpha: 7 }).cleanup_min_alpha, 7)
  assert.deepEqual(resolveComponentCleanupOptions({ minArea: 9, minAreaRatio: 0.1 }), {
    enabled: true,
    min_area: 9,
    min_area_ratio: 0.1,
  })
})

test('decode and alpha evidence distinguish opaque PNG, native PNG, and lossy JPEG', async () => {
  const opaque = await loadRgba(await sharp({
    create: { width: 2, height: 2, channels: 4, background: [10, 20, 30, 255] },
  }).png().toBuffer())
  const native = await loadRgba(await sharp(Buffer.from([
    10, 20, 30, 0,
    40, 50, 60, 128,
  ]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer())
  const jpeg = await loadRgba(await sharp({
    create: { width: 2, height: 2, channels: 3, background: [10, 20, 30] },
  }).jpeg().toBuffer())

  assert.equal(opaque.decode.format, 'png')
  assert.equal(opaque.decode.lossy, false)
  assert.equal(inspectDecodedAlpha(opaque).provenance, ALPHA_PROVENANCE.OPAQUE)
  assert.equal(native.decode.source_has_alpha, true)
  assert.equal(inspectDecodedAlpha(native).provenance, ALPHA_PROVENANCE.NATIVE)
  assert.equal(inspectDecodedAlpha(native).has_partial_alpha, true)
  assert.equal(jpeg.decode.format, 'jpeg')
  assert.equal(jpeg.decode.lossy, true)
  assert.equal(jpeg.decode.source_has_alpha, false)
})

test('already_processed only zeroes hidden RGB and does not segment visible pixels', async () => {
  const source = rgba(2, 1, [200, 210, 220, 0, 255, 255, 255, 255])
  const result = await removeBackground(source, { backgroundMode: 'already_processed' })
  assert.equal(result.mode, 'already_processed')
  assert.equal(result.alpha_provenance, ALPHA_PROVENANCE.ALREADY_PROCESSED)
  assert.deepEqual([...result.image.data], [0, 0, 0, 0, 255, 255, 255, 255])

  const direct = zeroTransparentRgbFromRgba(source)
  assert.equal(direct.changed_pixels, 1)
  assert.deepEqual([...direct.image.data], [...result.image.data])
})
