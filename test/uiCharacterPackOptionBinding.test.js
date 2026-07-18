import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHARACTER_OUTPUT_FRAME_SIZES,
  buildCharacterProcessingRequestOptions,
  normalizeCharacterBackgroundMode,
} from '../src/ui/characterPack/processingRequestOptions.js'

test('Character UI background values map to implemented processing modes', () => {
  assert.equal(normalizeCharacterBackgroundMode('flood_edge'), 'auto')
  assert.equal(normalizeCharacterBackgroundMode('alpha'), 'passthrough')
  assert.equal(normalizeCharacterBackgroundMode('auto'), 'auto')
  assert.equal(normalizeCharacterBackgroundMode('passthrough'), 'passthrough')
  assert.equal(normalizeCharacterBackgroundMode('dual_matte'), 'dual_matte')
  assert.equal(
    normalizeCharacterBackgroundMode('dual_matte', { generation: true }),
    'flood'
  )
  assert.throws(
    () => normalizeCharacterBackgroundMode('future_background'),
    /Unsupported Character background mode/
  )
})

test('Character UI request options use canonical fields and implemented limits', () => {
  const options = buildCharacterProcessingRequestOptions({
    backgroundMode: 'alpha',
    cleanupMinAlpha: '27',
    componentCleanupMinArea: '9',
    componentCleanupMinAreaRatio: '0.12',
    motionStabilizationMaxShift: '8',
  })

  assert.deepEqual(options, {
    backgroundMode: 'passthrough',
    cleanupMinAlpha: 27,
    componentCleanupMinArea: 9,
    componentCleanupMinAreaRatio: 0.12,
    motionStabilizationMaxShift: 4,
    outputFrameSizes: [96, 64, 48, 32, 16],
  })
  assert.deepEqual(CHARACTER_OUTPUT_FRAME_SIZES, [96, 64, 48, 32, 16])
  for (const disconnected of [
    'minAlpha',
    'minArea',
    'minAreaRatio',
    'motionMaxShift',
    'export1x',
    'export2x',
    'export3x',
    'export4x',
  ]) {
    assert.equal(Object.hasOwn(options, disconnected), false, disconnected)
  }
})

test('Character UI request options clamp cleanup fields deterministically', () => {
  assert.deepEqual(
    buildCharacterProcessingRequestOptions({
      cleanupMinAlpha: -1,
      componentCleanupMinArea: 100,
      componentCleanupMinAreaRatio: 1,
      motionStabilizationMaxShift: -4,
    }),
    {
      backgroundMode: 'auto',
      cleanupMinAlpha: 0,
      componentCleanupMinArea: 64,
      componentCleanupMinAreaRatio: 0.25,
      motionStabilizationMaxShift: 0,
      outputFrameSizes: [96, 64, 48, 32, 16],
    }
  )
})

test('Character UI blank numeric fields use documented fallbacks', () => {
  assert.deepEqual(buildCharacterProcessingRequestOptions({
    cleanupMinAlpha: '',
    componentCleanupMinArea: '   ',
    componentCleanupMinAreaRatio: null,
    motionStabilizationMaxShift: undefined,
  }), {
    backgroundMode: 'auto',
    cleanupMinAlpha: 18,
    componentCleanupMinArea: 4,
    componentCleanupMinAreaRatio: 0,
    motionStabilizationMaxShift: 2,
    outputFrameSizes: [96, 64, 48, 32, 16],
  })
})
