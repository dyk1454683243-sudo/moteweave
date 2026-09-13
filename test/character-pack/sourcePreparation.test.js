import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  prepareSourceForProcessing,
  removeBackground,
  shouldPreferExistingAlpha,
} from '../../src/character-pack/sourcePreparation.js'

function rgba(width, height, pixels) {
  return { width, height, data: Uint8ClampedArray.from(pixels.flat(2)) }
}

function offset(width, x, y) {
  return (y * width + x) * 4
}

test('reference-board alpha preference requires the configured non-opaque coverage', () => {
  const image = rgba(10, 10, Array.from({ length: 10 }, () => (
    Array.from({ length: 10 }, () => [0, 0, 0, 255])
  )))
  image.data[3] = 128
  assert.equal(shouldPreferExistingAlpha(image, { minCoverage: 0.02 }), false)

  image.data[7] = 0
  assert.equal(shouldPreferExistingAlpha(image, { minCoverage: 0.02 }), true)
})

test('ordinary fixed-region upload preserves geometry-first background processing', async () => {
  const source = rgba(4, 4, Array.from({ length: 4 }, () => (
    Array.from({ length: 4 }, () => [255, 255, 255, 255])
  )))
  const prepared = await prepareSourceForProcessing(
    await encodeRgbaPng(source),
    {
      id: 'fixed_region_upload_test_v0',
      kind: 'fixed_regions',
      sheet: { w: 2, h: 2 },
    },
    {
      backgroundMode: 'flood',
      backgroundTolerance: 0,
    },
  )

  assert.deepEqual(prepared.sourcePreprocess.report, {
    applied: true,
    method: 'fixed_region_resize',
    input_size: { w: 4, h: 4 },
    output_size: { w: 2, h: 2 },
    source_layout: 'fixed_region_upload_test_v0',
  })
  assert.equal(prepared.background.processed_before_geometry, false)
  assert.equal(prepared.background.alpha_provenance, 'staging')

  const stagedSource = await loadRgba(prepared.sourcePng)
  assert.deepEqual({ width: stagedSource.width, height: stagedSource.height }, { width: 2, height: 2 })
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => stagedSource.data[index * 4 + 3]),
    [255, 255, 255, 255],
  )
  assert.deepEqual(
    { width: prepared.transparent.width, height: prepared.transparent.height },
    { width: 2, height: 2 },
  )
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => prepared.transparent.data[index * 4 + 3]),
    [0, 0, 0, 0],
  )
})

test('removeBackground preserves an approved calibrated alpha provenance', async () => {
  const image = rgba(1, 1, [[[20, 30, 40, 128]]])
  const result = await removeBackground(image, {
    backgroundMode: 'alpha',
    inputAlphaProvenance: 'calibrated',
  })

  assert.equal(result.input_alpha.provenance, 'calibrated')
  assert.equal(result.alpha_provenance, 'calibrated')
})

test('fixed-region staging alpha remains attributed to staging after geometry', async () => {
  const source = rgba(4, 4, Array.from({ length: 4 }, () => (
    Array.from({ length: 4 }, () => [255, 255, 255, 255])
  )))
  const prepared = await prepareSourceForProcessing(
    await encodeRgbaPng(source),
    {
      id: 'fixed_region_staging_provenance_v0',
      kind: 'fixed_regions',
      sheet: { w: 252, h: 252 },
    },
    {
      backgroundMode: 'auto',
      fixedRegionSourceStaging: 'fixed_region_256_crop',
    },
  )

  assert.equal(prepared.sourceStaging.report.applied, true)
  assert.equal(prepared.background.input_alpha.provenance, 'staging')
  assert.equal(prepared.background.alpha_provenance, 'staging')
  assert.deepEqual(
    { width: prepared.transparent.width, height: prepared.transparent.height },
    { width: 252, height: 252 },
  )
})

test('removeBackground flood path clears opaque white matte fringe without deleting enclosed whites', async () => {
  const pixels = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => [255, 255, 255, 255]))
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [30, 70, 120, 255]
  }
  pixels[1][3] = [236, 238, 241, 255]
  pixels[3][3] = [248, 248, 248, 255]

  const result = await removeBackground(rgba(7, 7, pixels), {
    backgroundMode: 'flood',
    backgroundTolerance: 18,
    matteResidueTolerance: 40,
  })

  assert.equal(result.mode, 'flood')
  assert.equal(result.image.data[offset(7, 0, 0) + 3], 0)
  assert.equal(result.image.data[offset(7, 3, 1) + 3], 0)
  assert.equal(result.image.data[offset(7, 3, 3) + 3], 255)
  assert.deepEqual([...result.image.data.slice(offset(7, 3, 3), offset(7, 3, 3) + 3)], [248, 248, 248])
})

test('removeBackground flood path decontaminates retained light edge pixels while protecting near-white costume pixels', async () => {
  const pixels = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [255, 255, 255, 255]))
  for (let y = 1; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [25, 65, 125, 255]
  }
  pixels[2][1] = [205, 216, 232, 255]
  pixels[3][3] = [250, 250, 250, 255]

  const result = await removeBackground(rgba(6, 6, pixels), {
    backgroundMode: 'flood',
    backgroundTolerance: 18,
    matteResidueTolerance: 40,
    edgeDecontaminationMaxDistance: 92,
    edgeDecontaminationStrength: 0.6,
  })

  const stainedOffset = offset(6, 1, 2)
  assert.equal(result.image.data[stainedOffset + 3], 255)
  assert.ok(result.image.data[stainedOffset] < 120)
  assert.ok(result.image.data[stainedOffset + 1] < 150)
  assert.ok(result.image.data[stainedOffset + 2] < 195)

  const costumeOffset = offset(6, 3, 3)
  assert.equal(result.image.data[costumeOffset + 3], 255)
  assert.deepEqual([...result.image.data.slice(costumeOffset, costumeOffset + 3)], [250, 250, 250])
})
