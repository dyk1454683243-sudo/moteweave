import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeFlatBackgroundV2,
  applyDeterministicPixelMatteV2,
  assertBackgroundMatteV2ImageBudget,
  assertFrozenBackgroundContractMasks,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  BACKGROUND_MATTE_V2_ALGORITHM,
  buildVisibleBackgroundResidueDiagnostics,
  buildBackgroundMatteV2ArtifactBundle,
  evaluateBackgroundScopeIntegrity,
  freezeBackgroundContractMasks,
  hardenBackgroundAlpha,
  hashBackgroundContractMask,
  renderBackgroundSpillOverlay,
  renderSixBackgroundPreview,
} from '../../src/character-pack/backgroundMatteV2.js'

function solid(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset)
  return { width, height, data }
}

function setPixel(image, x, y, color) {
  image.data.set(color, (y * image.width + x) * 4)
}

function pixel(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [...image.data.slice(offset, offset + 4)]
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) setPixel(image, x, y, color)
  }
}

function flatCharacter(background) {
  const image = solid(32, 32, [...background, 255])
  paintRect(image, { x: 9, y: 5, w: 14, h: 23 }, [30, 70, 140, 255])
  paintRect(image, { x: 11, y: 7, w: 10, h: 4 }, [245, 245, 245, 255])
  setPixel(image, 13, 12, [255, 255, 255, 255])
  setPixel(image, 19, 12, [255, 255, 255, 255])
  setPixel(image, 27, 18, [120, 90, 40, 255])
  return image
}

function shoulderSingletonFixture({ rightExteriorPath = true, adjacentShoulder = false } = {}) {
  const source = solid(24, 24, [255, 255, 255, 255])
  paintRect(source, { x: 3, y: 3, w: 18, h: 18 }, [30, 70, 150, 255])
  for (let x = 3; x <= 10; x += 1) setPixel(source, x, 12, [245, 245, 245, 255])
  if (rightExteriorPath) {
    for (let x = 12; x <= 20; x += 1) setPixel(source, x, 12, [245, 245, 245, 255])
  }
  setPixel(source, 11, 12, [241, 241, 241, 255])
  if (adjacentShoulder) {
    for (let x = 3; x <= 10; x += 1) setPixel(source, x, 13, [245, 245, 245, 255])
    for (let x = 12; x <= 20; x += 1) setPixel(source, x, 13, [245, 245, 245, 255])
    setPixel(source, 11, 13, [241, 241, 241, 255])
  }
  return source
}

function analyzableShoulderSingletonFixture(candidateAlpha) {
  const source = shoulderSingletonFixture()
  let edgeIndex = 0
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (x >= 2 && y >= 2 && x < source.width - 2 && y < source.height - 2) continue
      if (edgeIndex % 10 === 0) setPixel(source, x, y, [254, 254, 254, 255])
      edgeIndex++
    }
  }
  setPixel(source, 11, 12, [241, 241, 241, candidateAlpha])
  return source
}

function analyzableFringeHardClearFixture(candidateAlpha) {
  const source = analyzableShoulderSingletonFixture(candidateAlpha)
  setPixel(source, 11, 12, [238, 238, 238, candidateAlpha])
  return source
}

function syntheticShoulderAnalysis() {
  return {
    eligible: true,
    background_oklab: [1, 0, 0],
    oklab_p95_distance: 0.004,
    thresholds: { oklab_p95_max_distance: 0.04 },
    sha256: 'synthetic-shoulder-analysis',
  }
}

function linearToSrgbByte(value) {
  const output = value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, output)) * 255)
}

function srgbToLinearByte(value) {
  const input = value / 255
  return input <= 0.04045 ? input / 12.92 : ((input + 0.055) / 1.055) ** 2.4
}

function composite(foreground, background, alpha) {
  return foreground.map((value, channel) => linearToSrgbByte(
    srgbToLinearByte(value) * alpha + srgbToLinearByte(background[channel]) * (1 - alpha),
  ))
}

for (const [name, background] of [
  ['white', [255, 255, 255]],
  ['off-white', [238, 239, 240]],
  ['black', [0, 0, 0]],
  ['gray', [128, 128, 128]],
  ['magenta', [255, 0, 255]],
  ['green', [0, 255, 0]],
]) {
  test(`V2 removes a high-confidence ${name} background without changing sure foreground`, () => {
    const source = flatCharacter(background)
    const result = applyDeterministicPixelMatteV2(source, {
      decode: { format: 'png', lossy: false, source_has_alpha: true },
    })

    assert.equal(result.mode, BACKGROUND_MATTE_V2_ALGORITHM)
    assert.equal(result.analysis.eligible, true)
    assert.equal(result.scope.status, 'pass')
    assert.equal(result.scope.metrics.sure_foreground_changed_pixels, 0)
    assert.equal(result.scope.metrics.outside_allowed_mutation_mask_changed_pixels, 0)
    assert.deepEqual(pixel(result.image, 0, 0), [0, 0, 0, 0])
    assert.deepEqual(pixel(result.image, 13, 12), [255, 255, 255, 255])
    assert.deepEqual(pixel(result.image, 19, 12), [255, 255, 255, 255])
    assert.deepEqual(pixel(result.image, 27, 18), [120, 90, 40, 255])
    assert.equal(assertFrozenBackgroundContractMasks(source, result.masks), true)
  })
}

test('contract masks are a frozen complete partition with stable dimension-bound hashes', () => {
  const source = flatCharacter([255, 255, 255])
  const result = applyDeterministicPixelMatteV2(source)
  const total = source.width * source.height
  for (let index = 0; index < total; index += 1) {
    const classes = result.masks.sureBackground[index] +
      result.masks.unknownBand[index] + result.masks.sureForeground[index]
    assert.equal(classes, 1)
    assert.equal(
      result.masks.allowedMutation[index],
      result.masks.sureBackground[index] || result.masks.unknownBand[index] ? 1 : 0,
    )
  }
  const hash = hashBackgroundContractMask(result.masks.sureBackground, source.width, source.height)
  assert.equal(hash, result.masks.report.masks.sure_background.sha256)
  assert.equal(
    result.masks.report.classification_revision,
    'exterior_background_reachability_v1_shoulder_singleton_v1_fringe_hard_clear_v1',
  )
  assert.equal(
    hashBackgroundContractMask(
      result.masks.exteriorBackgroundCandidate,
      source.width,
      source.height,
    ),
    result.masks.report.derived_masks.exterior_background_candidate.sha256,
  )
  assert.equal(
    hashBackgroundContractMask(
      result.masks.backgroundSupportedClear,
      source.width,
      source.height,
    ),
    result.masks.report.derived_masks.background_supported_clear.sha256,
  )
  assert.equal(
    hashBackgroundContractMask(
      result.masks.exteriorShoulderSingleton,
      source.width,
      source.height,
    ),
    result.masks.report.derived_masks.exterior_shoulder_singleton.sha256,
  )
  assert.equal(
    hashBackgroundContractMask(
      result.masks.exteriorFringeHardClear,
      source.width,
      source.height,
    ),
    result.masks.report.derived_masks.exterior_fringe_hard_clear.sha256,
  )
  assert.equal(
    hashBackgroundContractMask(
      result.masks.foregroundSamplingAuthority,
      source.width,
      source.height,
    ),
    result.masks.report.derived_masks.foreground_sampling_authority.sha256,
  )
  assert.equal(
    result.masks.report.foreground_sampling_revision,
    'provisional_sure_foreground_snapshot_v1',
  )
  assert.notEqual(
    hash,
    hashBackgroundContractMask(new Uint8Array(result.masks.sureBackground), 16, 64),
  )

  const tampered = { ...result.masks, sureForeground: new Uint8Array(result.masks.sureForeground) }
  tampered.sureForeground[0] = tampered.sureForeground[0] ? 0 : 1
  assert.throws(
    () => evaluateBackgroundScopeIntegrity(source, result.image, tampered),
    /mask hash changed/,
  )

  const tamperedDerived = {
    ...result.masks,
    backgroundSupportedClear: new Uint8Array(result.masks.backgroundSupportedClear),
  }
  tamperedDerived.backgroundSupportedClear[0] ^= 1
  assert.throws(
    () => evaluateBackgroundScopeIntegrity(source, result.image, tamperedDerived),
    /derived mask hash changed/,
  )

  const tamperedShoulder = {
    ...result.masks,
    exteriorShoulderSingleton: new Uint8Array(result.masks.exteriorShoulderSingleton),
  }
  tamperedShoulder.exteriorShoulderSingleton[0] ^= 1
  assert.throws(
    () => evaluateBackgroundScopeIntegrity(source, result.image, tamperedShoulder),
    /derived mask hash changed/,
  )

  const tamperedFringe = {
    ...result.masks,
    exteriorFringeHardClear: new Uint8Array(result.masks.exteriorFringeHardClear),
  }
  tamperedFringe.exteriorFringeHardClear[0] ^= 1
  assert.throws(
    () => evaluateBackgroundScopeIntegrity(source, result.image, tamperedFringe),
    /derived mask hash changed/,
  )

  const tamperedSamplingAuthority = {
    ...result.masks,
    foregroundSamplingAuthority: new Uint8Array(result.masks.foregroundSamplingAuthority),
  }
  tamperedSamplingAuthority.foregroundSamplingAuthority[0] ^= 1
  assert.throws(
    () => evaluateBackgroundScopeIntegrity(source, result.image, tamperedSamplingAuthority),
    /derived mask hash changed/,
  )

  const coordinatedSamplingAuthority = new Uint8Array(result.masks.foregroundSamplingAuthority)
  const samplingForegroundIndex = result.masks.sureForeground.findIndex((value) => value === 1)
  const samplingBackgroundIndex = result.masks.sureBackground.findIndex((value) => value === 1)
  coordinatedSamplingAuthority[samplingForegroundIndex] = 0
  coordinatedSamplingAuthority[samplingBackgroundIndex] = 1
  const coordinatedSamplingReport = {
    ...result.masks.report,
    derived_masks: {
      ...result.masks.report.derived_masks,
      foreground_sampling_authority: {
        pixel_count: result.masks.report.derived_masks.foreground_sampling_authority.pixel_count,
        sha256: hashBackgroundContractMask(
          coordinatedSamplingAuthority,
          source.width,
          source.height,
        ),
      },
    },
  }
  assert.throws(
    () => assertFrozenBackgroundContractMasks(source, {
      ...result.masks,
      foregroundSamplingAuthority: coordinatedSamplingAuthority,
      report: coordinatedSamplingReport,
    }),
    /foreground sampling authority changed/,
  )
})

test('pre-freeze Shoulder Singleton reclassifies only a one-pixel 8-component with two base-exterior ring pixels', () => {
  const source = shoulderSingletonFixture()
  const analysis = syntheticShoulderAnalysis()
  const masks = freezeBackgroundContractMasks(source, analysis)
  const index = 12 * source.width + 11

  assert.equal(masks.exteriorBackgroundCandidate[index], 0)
  assert.equal(masks.exteriorUnknown[index], 0)
  assert.equal(masks.exteriorShoulderSingleton[index], 1)
  assert.equal(masks.unknownBand[index], 1)
  assert.equal(masks.sureForeground[index], 0)
  assert.equal(masks.foregroundSamplingAuthority[index], 1)
  assert.equal(masks.allowedMutation[index], 1)
  assert.equal(masks.backgroundSupportedClear[index], 1)
  assert.equal(masks.protectedLightForeground[index], 0)
  assert.equal(masks.report.shoulder_background_distance, 0.044)
  assert.equal(masks.report.shoulder_component_connectivity, 8)
  assert.equal(masks.report.shoulder_component_pixel_count, 1)
  assert.equal(masks.report.shoulder_min_base_exterior_ring_pixels, 2)
  assert.equal(masks.report.shoulder_nonrecursive, true)
  assert.equal(masks.report.derived_masks.exterior_shoulder_singleton.pixel_count, 1)
  assert.equal(
    masks.report.derived_masks.foreground_sampling_authority.pixel_count,
    masks.report.masks.sure_foreground.pixel_count + 1,
  )
  assert.equal(assertFrozenBackgroundContractMasks(source, masks, { analysis }), true)
  const empty = new Uint8Array(source.width * source.height)
  const overlay = renderBackgroundSpillOverlay(source, {
    visibleBackgroundLikeMask: empty,
    spillMask: empty,
    lowConfidenceMask: empty,
    solvedUnknownMask: empty,
    masks,
  })
  assert.deepEqual(pixel(overlay, 11, 12), [0, 255, 128, 255])
})

test('Shoulder Singleton requires hard-visible source Alpha and zero adaptive range routes eligible spill fringe to hard clear', () => {
  const alphaSource = shoulderSingletonFixture()
  setPixel(alphaSource, 11, 12, [241, 241, 241, 127])
  const analysis = syntheticShoulderAnalysis()
  const alphaMasks = freezeBackgroundContractMasks(alphaSource, analysis)
  const index = 12 * alphaSource.width + 11
  assert.equal(alphaMasks.exteriorShoulderSingleton[index], 0)
  assert.equal(alphaMasks.sureForeground[index], 1)

  const zeroRangeAnalysis = { ...analysis, oklab_p95_distance: 0 }
  const zeroRangeMasks = freezeBackgroundContractMasks(
    shoulderSingletonFixture(),
    zeroRangeAnalysis,
  )
  assert.equal(zeroRangeMasks.report.shoulder_background_distance, 0.04)
  assert.equal(zeroRangeMasks.exteriorShoulderSingleton[index], 0)
  assert.equal(zeroRangeMasks.exteriorFringeHardClear[index], 1)
  assert.equal(zeroRangeMasks.unknownBand[index], 1)
  assert.equal(zeroRangeMasks.sureForeground[index], 0)
  assert.equal(zeroRangeMasks.backgroundSupportedClear[index], 1)
})

test('Fringe Hard Clear reclassifies the approved spill-range exterior ring beyond Shoulder', () => {
  const source = shoulderSingletonFixture()
  setPixel(source, 11, 12, [238, 238, 238, 255])
  const masks = freezeBackgroundContractMasks(source, syntheticShoulderAnalysis())
  const index = 12 * source.width + 11

  assert.equal(masks.exteriorShoulderSingleton[index], 0)
  assert.equal(masks.exteriorFringeHardClear[index], 1)
  assert.equal(masks.unknownBand[index], 1)
  assert.equal(masks.sureForeground[index], 0)
  assert.equal(masks.allowedMutation[index], 1)
  assert.equal(masks.backgroundSupportedClear[index], 1)
  assert.equal(masks.foregroundSamplingAuthority[index], 1)
  assert.equal(masks.report.fringe_background_distance, 0.08)
  assert.equal(masks.report.fringe_ring_connectivity, 8)
  assert.equal(masks.report.fringe_min_base_exterior_ring_pixels, 1)
  assert.equal(masks.report.fringe_nonrecursive, true)
  assert.equal(masks.report.derived_masks.exterior_fringe_hard_clear.pixel_count, 1)
  assert.equal(assertFrozenBackgroundContractMasks(source, masks, {
    analysis: syntheticShoulderAnalysis(),
  }), true)

  const empty = new Uint8Array(source.width * source.height)
  const overlay = renderBackgroundSpillOverlay(source, {
    visibleBackgroundLikeMask: empty,
    spillMask: empty,
    lowConfidenceMask: empty,
    solvedUnknownMask: empty,
    masks,
  })
  assert.deepEqual(pixel(overlay, 11, 12), [64, 128, 255, 255])

  assert.throws(
    () => assertFrozenBackgroundContractMasks(source, {
      ...masks,
      report: { ...masks.report, fringe_background_distance: 0.07 },
    }, { analysis: syntheticShoulderAnalysis() }),
    /Fringe Hard Clear distance formula changed/,
  )
})

test('Fringe Hard Clear requires hard source Alpha and preserves pixels beyond spill distance', () => {
  const lowAlpha = shoulderSingletonFixture()
  setPixel(lowAlpha, 11, 12, [238, 238, 238, 127])
  const lowAlphaMasks = freezeBackgroundContractMasks(lowAlpha, syntheticShoulderAnalysis())
  const index = 12 * lowAlpha.width + 11
  assert.equal(lowAlphaMasks.exteriorFringeHardClear[index], 0)
  assert.equal(lowAlphaMasks.sureForeground[index], 1)

  const beyondSpill = shoulderSingletonFixture()
  setPixel(beyondSpill, 11, 12, [220, 220, 220, 255])
  const beyondSpillMasks = freezeBackgroundContractMasks(
    beyondSpill,
    syntheticShoulderAnalysis(),
  )
  assert.equal(beyondSpillMasks.exteriorFringeHardClear[index], 0)
  assert.equal(beyondSpillMasks.sureForeground[index], 1)
})

test('Fringe Hard Clear requires the immutable base Exterior ring and is nonrecursive', () => {
  const noRing = solid(24, 24, [255, 255, 255, 255])
  paintRect(noRing, { x: 3, y: 3, w: 18, h: 18 }, [30, 70, 150, 255])
  setPixel(noRing, 12, 12, [238, 238, 238, 255])
  const noRingMasks = freezeBackgroundContractMasks(noRing, syntheticShoulderAnalysis())
  const noRingIndex = 12 * noRing.width + 12
  assert.equal(noRingMasks.exteriorFringeHardClear[noRingIndex], 0)
  assert.equal(noRingMasks.sureForeground[noRingIndex], 1)

  const chain = solid(24, 24, [255, 255, 255, 255])
  paintRect(chain, { x: 3, y: 3, w: 18, h: 18 }, [30, 70, 150, 255])
  for (let x = 3; x <= 10; x += 1) setPixel(chain, x, 12, [245, 245, 245, 255])
  setPixel(chain, 11, 12, [238, 238, 238, 255])
  setPixel(chain, 12, 12, [238, 238, 238, 255])
  const chainMasks = freezeBackgroundContractMasks(chain, syntheticShoulderAnalysis())
  const selectedIndex = 12 * chain.width + 11
  const downstreamIndex = 12 * chain.width + 12
  assert.equal(chainMasks.exteriorFringeHardClear[selectedIndex], 1)
  assert.equal(chainMasks.exteriorFringeHardClear[downstreamIndex], 0)
  assert.equal(chainMasks.sureForeground[downstreamIndex], 1)
  assert.equal(chainMasks.exteriorBackgroundCandidate[selectedIndex], 0)
  assert.equal(chainMasks.exteriorBackgroundCandidate[downstreamIndex], 0)
})

test('Fringe Hard Clear accepts a diagonal-only 8-neighbor base Exterior contact', () => {
  const source = solid(24, 24, [255, 255, 255, 255])
  paintRect(source, { x: 3, y: 3, w: 18, h: 18 }, [30, 70, 150, 255])
  for (let x = 3; x <= 10; x += 1) setPixel(source, x, 11, [245, 245, 245, 255])
  setPixel(source, 11, 12, [238, 238, 238, 255])

  const masks = freezeBackgroundContractMasks(source, syntheticShoulderAnalysis())
  const candidateIndex = 12 * source.width + 11
  const diagonalExteriorIndex = 11 * source.width + 10
  const orthogonalIndexes = [
    candidateIndex - 1,
    candidateIndex + 1,
    candidateIndex - source.width,
    candidateIndex + source.width,
  ]

  assert.equal(masks.exteriorBackgroundCandidate[diagonalExteriorIndex], 1)
  for (const index of orthogonalIndexes) {
    assert.equal(masks.exteriorBackgroundCandidate[index], 0)
  }
  assert.equal(masks.exteriorFringeHardClear[candidateIndex], 1)
  assert.equal(masks.backgroundSupportedClear[candidateIndex], 1)
})

test('Fringe Hard Clear selects every eligible pixel in a multi-pixel component', () => {
  const source = shoulderSingletonFixture({ adjacentShoulder: true })
  setPixel(source, 11, 12, [238, 238, 238, 255])
  setPixel(source, 11, 13, [238, 238, 238, 255])
  const masks = freezeBackgroundContractMasks(source, syntheticShoulderAnalysis())

  for (const index of [12 * source.width + 11, 13 * source.width + 11]) {
    assert.equal(masks.exteriorShoulderSingleton[index], 0)
    assert.equal(masks.exteriorFringeHardClear[index], 1)
    assert.equal(masks.unknownBand[index], 1)
    assert.equal(masks.backgroundSupportedClear[index], 1)
  }
  assert.equal(masks.report.derived_masks.exterior_fringe_hard_clear.pixel_count, 2)
})

test('Shoulder Singleton is nonrecursive and cannot change the base Exterior flood', () => {
  const shoulderSource = shoulderSingletonFixture()
  const ordinaryForegroundSource = shoulderSingletonFixture()
  setPixel(ordinaryForegroundSource, 11, 12, [30, 70, 150, 255])
  const analysis = syntheticShoulderAnalysis()
  const shoulderMasks = freezeBackgroundContractMasks(shoulderSource, analysis)
  const ordinaryMasks = freezeBackgroundContractMasks(ordinaryForegroundSource, analysis)

  assert.equal(shoulderMasks.report.derived_masks.exterior_shoulder_singleton.pixel_count, 1)
  assert.equal(ordinaryMasks.report.derived_masks.exterior_shoulder_singleton.pixel_count, 0)
  assert.equal(
    shoulderMasks.report.derived_masks.core_sure_background.sha256,
    ordinaryMasks.report.derived_masks.core_sure_background.sha256,
  )
  assert.equal(
    shoulderMasks.report.derived_masks.exterior_background_candidate.sha256,
    ordinaryMasks.report.derived_masks.exterior_background_candidate.sha256,
  )
  assert.equal(
    shoulderMasks.report.derived_masks.exterior_unknown.sha256,
    ordinaryMasks.report.derived_masks.exterior_unknown.sha256,
  )
  for (let index = 0; index < shoulderSource.width * shoulderSource.height; index += 1) {
    assert.equal(
      shoulderMasks.foregroundSamplingAuthority[index],
      shoulderMasks.sureForeground[index] ||
        shoulderMasks.exteriorShoulderSingleton[index] ||
        shoulderMasks.exteriorFringeHardClear[index] ? 1 : 0,
    )
  }

  const changedDistanceReport = {
    ...shoulderMasks.report,
    shoulder_background_distance: 0.045,
  }
  assert.throws(
    () => assertFrozenBackgroundContractMasks(
      shoulderSource,
      { ...shoulderMasks, report: changedDistanceReport },
      { analysis },
    ),
    /Shoulder distance formula changed/,
  )
})

test('Shoulder reclassification changes only its selected output pixel and preserves every ordinary Alpha solve', () => {
  const baselineSource = analyzableShoulderSingletonFixture(127)
  const shoulderSource = analyzableShoulderSingletonFixture(255)
  const baseline = applyDeterministicPixelMatteV2(baselineSource)
  const shoulder = applyDeterministicPixelMatteV2(shoulderSource)
  const shoulderIndex = 12 * shoulderSource.width + 11

  assert.equal(baseline.analysis.oklab_p95_distance > 0, true)
  assert.equal(baseline.masks.exteriorShoulderSingleton[shoulderIndex], 0)
  assert.equal(shoulder.masks.exteriorShoulderSingleton[shoulderIndex], 1)
  assert.equal(
    baseline.masks.report.derived_masks.foreground_sampling_authority.sha256,
    shoulder.masks.report.derived_masks.foreground_sampling_authority.sha256,
  )
  assert.deepEqual([...baseline.solvedUnknownMask], [...shoulder.solvedUnknownMask])
  assert.deepEqual([...baseline.lowConfidenceMask], [...shoulder.lowConfidenceMask])
  assert.deepEqual([...baseline.alphaEstimate.data], [...shoulder.alphaEstimate.data])
  assert.deepEqual(
    [...baseline.foregroundReconstruction.data],
    [...shoulder.foregroundReconstruction.data],
  )

  const changedOutputPixels = []
  for (let index = 0; index < baselineSource.width * baselineSource.height; index += 1) {
    const offset = index * 4
    if (
      baseline.image.data[offset] !== shoulder.image.data[offset] ||
      baseline.image.data[offset + 1] !== shoulder.image.data[offset + 1] ||
      baseline.image.data[offset + 2] !== shoulder.image.data[offset + 2] ||
      baseline.image.data[offset + 3] !== shoulder.image.data[offset + 3]
    ) {
      changedOutputPixels.push(index)
    }
  }
  assert.deepEqual(changedOutputPixels, [shoulderIndex])
  assert.deepEqual(pixel(shoulder.image, 11, 12), [0, 0, 0, 0])
})

test('Fringe Hard Clear changes only its selected output pixel and preserves every ordinary Alpha solve', () => {
  const baselineSource = analyzableFringeHardClearFixture(127)
  const fringeSource = analyzableFringeHardClearFixture(255)
  const baseline = applyDeterministicPixelMatteV2(baselineSource)
  const fringe = applyDeterministicPixelMatteV2(fringeSource)
  const fringeIndex = 12 * fringeSource.width + 11

  assert.equal(baseline.masks.exteriorFringeHardClear[fringeIndex], 0)
  assert.equal(fringe.masks.exteriorFringeHardClear[fringeIndex], 1)
  assert.equal(
    baseline.masks.report.derived_masks.foreground_sampling_authority.sha256,
    fringe.masks.report.derived_masks.foreground_sampling_authority.sha256,
  )
  assert.deepEqual([...baseline.solvedUnknownMask], [...fringe.solvedUnknownMask])
  assert.deepEqual([...baseline.lowConfidenceMask], [...fringe.lowConfidenceMask])
  assert.deepEqual([...baseline.alphaEstimate.data], [...fringe.alphaEstimate.data])
  assert.deepEqual(
    [...baseline.foregroundReconstruction.data],
    [...fringe.foregroundReconstruction.data],
  )

  const changedOutputPixels = []
  for (let index = 0; index < baselineSource.width * baselineSource.height; index += 1) {
    const offset = index * 4
    if (
      baseline.image.data[offset] !== fringe.image.data[offset] ||
      baseline.image.data[offset + 1] !== fringe.image.data[offset + 1] ||
      baseline.image.data[offset + 2] !== fringe.image.data[offset + 2] ||
      baseline.image.data[offset + 3] !== fringe.image.data[offset + 3]
    ) {
      changedOutputPixels.push(index)
    }
  }
  assert.deepEqual(changedOutputPixels, [fringeIndex])
  assert.deepEqual(pixel(fringe.image, 11, 12), [0, 0, 0, 0])
  assert.equal(fringe.quality.background_residue.visible_pixel_count, 0)
  assert.equal(
    fringe.quality.unknown_pixels.background_supported_cleared_breakdown
      .exterior_fringe_hard_clear,
    1,
  )

  const leakedFringe = {
    width: fringe.image.width,
    height: fringe.image.height,
    data: new Uint8ClampedArray(fringe.image.data),
  }
  setPixel(leakedFringe, 11, 12, [238, 238, 238, 255])
  const leakedScope = evaluateBackgroundScopeIntegrity(
    fringeSource,
    leakedFringe,
    fringe.masks,
    { analysis: fringe.analysis },
  )
  assert.equal(leakedScope.status, 'fail')
  assert.equal(leakedScope.metrics.background_supported_clear_remaining_visible_pixels, 1)
  assert.equal(leakedScope.metrics.background_supported_clear_nonzero_rgb_pixels, 1)
})

test('Shoulder Singleton preserves a one-pixel candidate with only one base-exterior ring pixel', () => {
  const source = shoulderSingletonFixture({ rightExteriorPath: false })
  const masks = freezeBackgroundContractMasks(source, syntheticShoulderAnalysis())
  const index = 12 * source.width + 11

  assert.equal(masks.exteriorShoulderSingleton[index], 0)
  assert.equal(masks.unknownBand[index], 0)
  assert.equal(masks.sureForeground[index], 1)
  assert.equal(masks.allowedMutation[index], 0)
  assert.equal(masks.backgroundSupportedClear[index], 0)
})

test('Shoulder Singleton preserves every pixel in an adjacent 8-connected shoulder component', () => {
  const source = shoulderSingletonFixture({ adjacentShoulder: true })
  const masks = freezeBackgroundContractMasks(source, syntheticShoulderAnalysis())
  for (const index of [12 * source.width + 11, 13 * source.width + 11]) {
    assert.equal(masks.exteriorShoulderSingleton[index], 0)
    assert.equal(masks.unknownBand[index], 0)
    assert.equal(masks.sureForeground[index], 1)
    assert.equal(masks.backgroundSupportedClear[index], 0)
  }
  assert.equal(masks.report.derived_masks.exterior_shoulder_singleton.pixel_count, 0)
})

test('exterior-reachable weak background is reclassified before Mask freeze and safely cleared', () => {
  const source = solid(40, 32, [255, 255, 255, 255])
  paintRect(source, { x: 4, y: 9, w: 8, h: 8 }, [245, 245, 245, 255])
  paintRect(source, { x: 24, y: 5, w: 12, h: 23 }, [30, 70, 150, 255])
  setPixel(source, 30, 13, [245, 245, 245, 255])
  const before = new Uint8ClampedArray(source.data)

  const result = applyDeterministicPixelMatteV2(source)
  const pocketIndex = 12 * source.width + 7
  const protectedIndex = 13 * source.width + 30

  assert.equal(result.masks.sureBackground[pocketIndex], 0)
  assert.equal(result.masks.exteriorBackgroundCandidate[pocketIndex], 1)
  assert.equal(result.masks.exteriorUnknown[pocketIndex], 1)
  assert.equal(result.masks.unknownBand[pocketIndex], 1)
  assert.equal(result.masks.sureForeground[pocketIndex], 0)
  assert.equal(result.masks.backgroundSupportedClear[pocketIndex], 1)
  assert.deepEqual(pixel(result.image, 7, 12), [0, 0, 0, 0])

  assert.equal(result.masks.exteriorBackgroundCandidate[protectedIndex], 0)
  assert.equal(result.masks.protectedLightForeground[protectedIndex], 1)
  assert.equal(result.masks.sureForeground[protectedIndex], 1)
  assert.equal(result.masks.allowedMutation[protectedIndex], 0)
  assert.deepEqual(pixel(result.image, 30, 13), [245, 245, 245, 255])
  assert.deepEqual([...source.data], [...before])
  assert.equal(result.scope.metrics.sure_foreground_changed_pixels, 0)
  assert.equal(result.scope.metrics.outside_allowed_mutation_mask_changed_pixels, 0)
  assert.equal(result.quality.background_residue.visible_pixel_count, 0)
  assert.equal(result.quality.background_residue.component_count_8, 0)
  assert.equal(
    result.quality.unknown_pixels.total,
    result.quality.unknown_pixels.solved +
      result.quality.unknown_pixels.background_supported_cleared +
      result.quality.unknown_pixels.low_confidence,
  )

  const leakedClear = {
    width: result.image.width,
    height: result.image.height,
    data: new Uint8ClampedArray(result.image.data),
  }
  setPixel(leakedClear, 7, 12, [245, 245, 245, 255])
  const leakedScope = evaluateBackgroundScopeIntegrity(source, leakedClear, result.masks)
  assert.equal(leakedScope.status, 'fail')
  assert.equal(leakedScope.metrics.background_supported_clear_remaining_visible_pixels, 1)
  assert.equal(leakedScope.metrics.background_supported_clear_nonzero_rgb_pixels, 1)
})

test('foreground proximity cannot override proven exterior background reachability', () => {
  const source = solid(24, 24, [255, 255, 255, 255])
  paintRect(source, { x: 10, y: 8, w: 5, h: 5 }, [30, 70, 150, 255])
  setPixel(source, 9, 10, [245, 245, 245, 255])

  const result = applyDeterministicPixelMatteV2(source)
  const index = 10 * source.width + 9

  assert.equal(result.masks.exteriorBackgroundCandidate[index], 1)
  assert.equal(result.masks.exteriorUnknown[index], 1)
  assert.equal(result.masks.backgroundSupportedClear[index], 1)
  assert.equal(result.lowConfidenceMask[index], 0)
  assert.deepEqual(pixel(result.image, 9, 10), [0, 0, 0, 0])
  assert.equal(result.quality.background_residue.status, 'pass')
  assert.equal(result.quality.background_residue.visible_pixel_count, 0)
  assert.equal(result.review.reasons.includes('visible_exterior_background_residue'), false)
})

test('exterior background clears before a soft Alpha solve even with enough foreground samples', () => {
  const source = solid(32, 24, [255, 255, 255, 255])
  paintRect(source, { x: 12, y: 5, w: 9, h: 14 }, [30, 70, 150, 255])
  setPixel(source, 11, 11, [245, 245, 245, 255])

  const result = applyDeterministicPixelMatteV2(source)
  const index = 11 * source.width + 11

  assert.equal(result.masks.exteriorUnknown[index], 1)
  assert.equal(result.masks.backgroundSupportedClear[index], 1)
  assert.equal(result.solvedUnknownMask[index], 0)
  assert.equal(result.lowConfidenceMask[index], 0)
  assert.deepEqual(pixel(result.image, 11, 11), [0, 0, 0, 0])
  assert.equal(result.quality.background_residue.visible_pixel_count, 0)
})

test('visible background residue diagnostics can flag adjacent Sure Foreground without mutating it', () => {
  const source = solid(32, 32, [255, 255, 255, 255])
  const output = solid(32, 32, [0, 0, 0, 0])
  const { analysis } = analyzeFlatBackgroundV2(source)
  const total = source.width * source.height
  const candidateIndex = 1 * source.width + 1
  const exteriorIndex = 0
  const protectedIndex = 28 * source.width + 28
  const masks = {
    sureBackground: new Uint8Array(total),
    unknownBand: new Uint8Array(total),
    sureForeground: new Uint8Array(total),
    exteriorBackgroundCandidate: new Uint8Array(total),
    exteriorShoulderSingleton: new Uint8Array(total),
    backgroundSupportedClear: new Uint8Array(total),
    protectedLightForeground: new Uint8Array(total),
  }
  masks.sureForeground[candidateIndex] = 1
  masks.sureForeground[protectedIndex] = 1
  masks.exteriorBackgroundCandidate[exteriorIndex] = 1
  masks.protectedLightForeground[protectedIndex] = 1
  setPixel(source, 1, 1, [254, 254, 254, 255])
  setPixel(output, 1, 1, [254, 254, 254, 255])
  setPixel(source, 28, 28, [245, 245, 245, 255])
  setPixel(output, 28, 28, [245, 245, 245, 255])

  const diagnostics = buildVisibleBackgroundResidueDiagnostics(
    source,
    output,
    masks,
    analysis,
  )

  assert.equal(diagnostics.evidence.status, 'needs_review')
  assert.equal(diagnostics.evidence.visible_pixel_count, 1)
  assert.equal(diagnostics.evidence.alpha_ge_128_pixel_count, 1)
  assert.equal(diagnostics.evidence.direct_exterior_visible_pixel_count, 0)
  assert.equal(diagnostics.evidence.adjacent_sure_foreground_pixel_count, 1)
  assert.equal(diagnostics.evidence.protected_light_overlap_pixel_count, 0)
  assert.equal(diagnostics.evidence.component_count_8, 1)
  assert.equal(diagnostics.evidence.by_contract_class.sure_foreground, 1)
  assert.equal(diagnostics.visibleBackgroundLikeMask[candidateIndex], 1)
  assert.equal(diagnostics.visibleBackgroundLikeMask[protectedIndex], 0)
  assert.deepEqual(pixel(output, 1, 1), [254, 254, 254, 255])
  assert.deepEqual(pixel(output, 28, 28), [245, 245, 245, 255])

  const empty = new Uint8Array(total)
  const overlay = renderBackgroundSpillOverlay(source, {
    visibleBackgroundLikeMask: diagnostics.visibleBackgroundLikeMask,
    spillMask: empty,
    lowConfidenceMask: empty,
    solvedUnknownMask: empty,
    masks,
  })
  assert.deepEqual(pixel(overlay, 1, 1), [255, 0, 255, 255])
  assert.deepEqual(pixel(overlay, 28, 28), [255, 224, 0, 255])
})

test('scope gate detects sure-foreground and allowed-mask violations', () => {
  const source = flatCharacter([255, 255, 255])
  const result = applyDeterministicPixelMatteV2(source)
  const changed = {
    width: result.image.width,
    height: result.image.height,
    data: new Uint8ClampedArray(result.image.data),
  }
  const index = result.masks.sureForeground.findIndex((value) => value === 1)
  changed.data[index * 4] ^= 1
  const scope = evaluateBackgroundScopeIntegrity(source, changed, result.masks)
  assert.equal(scope.status, 'fail')
  assert.equal(scope.metrics.sure_foreground_changed_pixels, 1)
  assert.equal(scope.metrics.outside_allowed_mutation_mask_changed_pixels, 1)
})

test('linear-RGB solve recovers a known soft edge and foreground color', () => {
  const background = [255, 255, 255]
  const foreground = [40, 80, 160]
  const source = solid(20, 20, [...background, 255])
  paintRect(source, { x: 6, y: 4, w: 8, h: 12 }, [...foreground, 255])
  const mixed = composite(foreground, background, 0.5)
  setPixel(source, 5, 9, [...mixed, 255])

  const result = applyDeterministicPixelMatteV2(source)
  const output = pixel(result.image, 5, 9)
  assert.ok(Math.abs(output[3] - 128) <= 4, `alpha=${output[3]}`)
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(output[channel] - foreground[channel]) <= 6, `channel ${channel}=${output[channel]}`)
  }
  assert.equal(result.quality.unknown_pixels.solved > 0, true)
})

test('low-confidence unknown pixels preserve original RGBA and emit review evidence', () => {
  const source = solid(20, 20, [255, 255, 255, 255])
  setPixel(source, 10, 10, [60, 90, 160, 255])
  const result = applyDeterministicPixelMatteV2(source)

  assert.deepEqual(pixel(result.image, 10, 10), [60, 90, 160, 255])
  assert.equal(result.quality.unknown_pixels.low_confidence, 1)
  assert.equal(result.review.review_recommendation, 'inspect_low_confidence_boundary')
  assert.ok(result.review.reasons.includes('low_confidence_unknown_pixels'))
})

test('complex checkerboard background is an unchanged passthrough with review reasons', () => {
  const source = solid(24, 24, [0, 0, 0, 255])
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      setPixel(source, x, y, (x + y) % 2
        ? [210, 210, 210, 255]
        : [245, 245, 245, 255])
    }
  }
  const before = new Uint8ClampedArray(source.data)
  const result = applyDeterministicPixelMatteV2(source)

  assert.equal(result.mode, 'passthrough_review')
  assert.equal(result.analysis.eligible, false)
  assert.deepEqual([...result.image.data], [...before])
  assert.equal(result.scope.status, 'pass')
  assert.equal(result.review.review_recommendation, 'inspect_passthrough')
})

test('V2 rejects transparent pixels with hidden RGB as an Alpha Integrity failure', () => {
  const source = solid(16, 16, [245, 245, 245, 255])
  setPixel(source, 0, 0, [255, 255, 255, 0])
  assert.throws(
    () => applyDeterministicPixelMatteV2(source),
    /alpha integrity failed/,
  )
})

test('hard alpha is deterministic, clears transparent RGB, and V2 hard output is idempotent', () => {
  const soft = solid(2, 1, [20, 40, 60, 127])
  setPixel(soft, 1, 0, [80, 100, 120, 128])
  const hard = hardenBackgroundAlpha(soft)
  assert.deepEqual([...hard.image.data], [0, 0, 0, 0, 80, 100, 120, 255])
  assert.deepEqual(
    [...hardenBackgroundAlpha(hard.image).image.data],
    [...hard.image.data],
  )

  const source = flatCharacter([255, 255, 255])
  const first = hardenBackgroundAlpha(applyDeterministicPixelMatteV2(source).image).image
  const second = hardenBackgroundAlpha(applyDeterministicPixelMatteV2(first).image).image
  assert.deepEqual([...second.data], [...first.data])
})

test('hard-pixel re-entry preserves foreground that touches corners, edges, and transparent holes', () => {
  const hard = solid(24, 24, [0, 0, 0, 0])
  paintRect(hard, { x: 0, y: 0, w: 6, h: 18 }, [40, 90, 170, 255])
  paintRect(hard, { x: 18, y: 0, w: 6, h: 6 }, [220, 180, 40, 255])
  paintRect(hard, { x: 18, y: 18, w: 6, h: 6 }, [90, 40, 150, 255])
  for (let x = 6; x < 24; x += 1) setPixel(hard, x, 12, [120, 80, 30, 255])
  setPixel(hard, 2, 2, [0, 0, 0, 0])
  const before = new Uint8ClampedArray(hard.data)

  const result = applyDeterministicPixelMatteV2(hard)

  assert.equal(result.analysis.status, 'already_processed_hard_alpha')
  assert.equal(result.quality.status, 'pass')
  assert.deepEqual([...result.image.data], [...before])
})

test('hard alpha rejects invalid thresholds instead of clearing the image', () => {
  const source = solid(1, 1, [20, 40, 60, 255])
  for (const threshold of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
    assert.throws(
      () => hardenBackgroundAlpha(source, { threshold }),
      /finite number from 0 to 1/,
    )
  }
  const boundary = solid(2, 1, [20, 40, 60, 0])
  setPixel(boundary, 1, 0, [80, 100, 120, 255])
  assert.deepEqual(
    [...hardenBackgroundAlpha(boundary, { threshold: 0 }).image.data],
    [0, 0, 0, 0, 80, 100, 120, 255],
  )
  assert.deepEqual(
    [...hardenBackgroundAlpha(boundary, { threshold: 1 }).image.data],
    [0, 0, 0, 0, 80, 100, 120, 255],
  )
})

test('boundary diagnostics mark background-colored visible spill without changing protected foreground', () => {
  const source = solid(24, 24, [255, 255, 255, 255])
  paintRect(source, { x: 7, y: 5, w: 10, h: 15 }, [30, 70, 150, 255])
  setPixel(source, 6, 12, [238, 238, 238, 255])

  const result = applyDeterministicPixelMatteV2(source)

  assert.equal(result.scope.metrics.sure_foreground_changed_pixels, 0)
  assert.equal(result.quality.boundary_diagnostics.participates_in_scope_gate, false)
  assert.equal(result.quality.boundary_diagnostics.possible_spill_pixel_count > 0, true)
  assert.ok(result.review.reasons.includes('possible_background_spill'))
})

test('one-pixel hair, shoe tip, and weapon contours remain visible and are reported', () => {
  const source = solid(32, 32, [255, 255, 255, 255])
  paintRect(source, { x: 12, y: 8, w: 8, h: 18 }, [30, 70, 150, 255])
  setPixel(source, 15, 7, [30, 70, 150, 255])
  setPixel(source, 11, 25, [30, 70, 150, 255])
  for (let x = 20; x <= 27; x += 1) setPixel(source, x, 16, [120, 80, 30, 255])

  const result = applyDeterministicPixelMatteV2(source)

  assert.deepEqual(pixel(result.image, 15, 7), [30, 70, 150, 255])
  assert.deepEqual(pixel(result.image, 11, 25), [30, 70, 150, 255])
  assert.deepEqual(pixel(result.image, 27, 16), [120, 80, 30, 255])
  assert.equal(result.quality.boundary_diagnostics.contour.unknown_band_lost_pixel_count, 0)
  assert.equal(result.quality.boundary_diagnostics.protected_foreground_changed_pixels, 0)
})

test('V2 enforces its image budget before allocating processing copies', () => {
  assert.throws(
    () => assertBackgroundMatteV2ImageBudget({
      width: 4097,
      height: 1,
      data: new Uint8ClampedArray(4097 * 4),
    }),
    /exceeds .* pixel budget/,
  )
})

test('six-background preview has fixed 2x3 panel order and opaque review pixels', () => {
  const image = solid(4, 3, [20, 40, 80, 128])
  const preview = renderSixBackgroundPreview(image)
  assert.deepEqual({ width: preview.image.width, height: preview.image.height }, { width: 12, height: 6 })
  assert.deepEqual(preview.panels.map((panel) => panel.id), [
    'checker', 'white', 'black', 'gray', 'magenta', 'green',
  ])
  for (let offset = 3; offset < preview.image.data.length; offset += 4) {
    assert.equal(preview.image.data[offset], 255)
  }
})

test('artifact bundle publishes review evidence without a second human-decision state', async () => {
  const source = flatCharacter([255, 255, 255])
  const result = applyDeterministicPixelMatteV2(source)
  const bundle = await buildBackgroundMatteV2ArtifactBundle(result, {
    rawSource: source,
    previewMaxPanelSize: 16,
    artifactUrlPrefix: '/generated/cli/matte_artifact_test',
  })
  assert.deepEqual(
    new Set(Object.keys(bundle.files)),
    new Set(Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)),
  )
  assert.equal(bundle.metadata.provider_calls_used, 0)
  assert.deepEqual(bundle.quality.preview_layout.panels.map((panel) => panel.id), [
    'checker', 'white', 'black', 'gray', 'magenta', 'green',
  ])
  assert.deepEqual(Object.keys(bundle.review).sort(), [
    'affected_regions',
    'algorithm',
    'artifacts',
    'confidence',
    'hashes',
    'reasons',
    'review_recommendation',
    'schema_version',
    'spill_overlay_legend',
    'urls',
  ])
  const forbidden = new Set([
    'acceptance_status',
    'human_decision_status',
    'accepted_at',
    'rejected_at',
  ])
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `forbidden review key: ${key}`)
      visit(child)
    }
  }
  visit(bundle.review)
  assert.equal(
    bundle.review.urls.background_preview_url,
    '/generated/cli/matte_artifact_test/background_preview.png',
  )
})

test('artifact bundle fails closed when source, output, or frozen masks change', async () => {
  const source = flatCharacter([255, 255, 255])

  const changedSource = flatCharacter([255, 255, 255])
  const sourceResult = applyDeterministicPixelMatteV2(source)
  setPixel(changedSource, 0, 0, [254, 255, 255, 255])
  await assert.rejects(
    buildBackgroundMatteV2ArtifactBundle(sourceResult, {
      rawSource: changedSource,
      artifactUrlPrefix: '/generated/matte_changed_source',
    }),
    /source hash changed/,
  )

  const outputResult = applyDeterministicPixelMatteV2(source)
  outputResult.image.data[0] ^= 1
  await assert.rejects(
    buildBackgroundMatteV2ArtifactBundle(outputResult, {
      rawSource: source,
      artifactUrlPrefix: '/generated/matte_changed_output',
    }),
    /Scope evidence changed|scope integrity failed/,
  )

  const maskResult = applyDeterministicPixelMatteV2(source)
  maskResult.masks.sureForeground[0] ^= 1
  await assert.rejects(
    buildBackgroundMatteV2ArtifactBundle(maskResult, {
      rawSource: source,
      artifactUrlPrefix: '/generated/matte_changed_mask',
    }),
    /mask hash changed/,
  )

  for (const [name, tamper] of [
    ['alpha_estimate', (result) => { result.alphaEstimate.data[0] ^= 1 }],
    ['foreground_reconstruction', (result) => { result.foregroundReconstruction.data[0] ^= 1 }],
    ['spill_mask', (result) => { result.spillMask[0] ^= 1 }],
    ['boundary_mask', (result) => { result.boundaryMask[0] ^= 1 }],
    ['visible_background_like_mask', (result) => { result.visibleBackgroundLikeMask[0] ^= 1 }],
    ['boundary_report', (result) => { result.quality.boundary_diagnostics.boundary_pixel_count += 1 }],
  ]) {
    const result = applyDeterministicPixelMatteV2(source)
    tamper(result)
    await assert.rejects(
      buildBackgroundMatteV2ArtifactBundle(result, {
        rawSource: source,
        artifactUrlPrefix: `/generated/matte_changed_${name}`,
      }),
      /diagnostic evidence changed/,
    )
  }
})
