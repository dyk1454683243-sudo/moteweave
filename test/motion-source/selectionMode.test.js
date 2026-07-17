import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOTION_SELECTION_MODE_AUTO,
  MOTION_SELECTION_INDEX_LIMIT,
  MOTION_SELECTION_MODE_MANUAL,
  MotionSelectionModeError,
  normalizeMotionSelectionRequest,
} from '../../src/motion-source/selectionMode.js'

function assertSelectionError(input, code) {
  assert.throws(
    () => normalizeMotionSelectionRequest(input),
    (error) => {
      assert.ok(error instanceof MotionSelectionModeError)
      assert.equal(error.code, code)
      assert.equal(error.status, 400)
      return true
    }
  )
}

test('normalizeMotionSelectionRequest accepts explicit auto without manual indexes', () => {
  const result = normalizeMotionSelectionRequest({
    selectionMode: MOTION_SELECTION_MODE_AUTO,
    selectedFrameIndexes: null,
    frameCount: 5,
  })

  assert.deepEqual(result, {
    requestedSelectionMode: 'auto',
    effectiveSelectionMode: 'auto',
    selectedFrameIndexes: null,
    inferredFromLegacy: false,
  })
})

test('normalizeMotionSelectionRequest accepts explicit manual and preserves requested order', () => {
  const result = normalizeMotionSelectionRequest({
    selectionMode: MOTION_SELECTION_MODE_MANUAL,
    selectedFrameIndexes: [4, 1, 0],
    frameCount: 5,
  })

  assert.equal(result.requestedSelectionMode, 'manual')
  assert.equal(result.effectiveSelectionMode, 'manual')
  assert.deepEqual(result.selectedFrameIndexes, [4, 1, 0])
  assert.equal(result.inferredFromLegacy, false)
})

test('normalizeMotionSelectionRequest infers auto for a legacy request without indexes', () => {
  const result = normalizeMotionSelectionRequest({
    selectedFrameIndexes: [],
    frameCount: 5,
  })

  assert.deepEqual(result, {
    requestedSelectionMode: null,
    effectiveSelectionMode: 'auto',
    selectedFrameIndexes: null,
    inferredFromLegacy: true,
  })
})

test('normalizeMotionSelectionRequest infers manual for a legacy request with indexes', () => {
  const result = normalizeMotionSelectionRequest({
    selectedFrameIndexes: [3, 0, 2],
    frameCount: 4,
  })

  assert.equal(result.requestedSelectionMode, null)
  assert.equal(result.effectiveSelectionMode, 'manual')
  assert.deepEqual(result.selectedFrameIndexes, [3, 0, 2])
  assert.equal(result.inferredFromLegacy, true)
})

test('normalizeMotionSelectionRequest rejects unsupported and contradictory modes', () => {
  assertSelectionError({
    selectionMode: 'automatic',
    frameCount: 4,
  }, 'invalid_motion_selection_mode')
  assertSelectionError({
    selectionMode: 'auto',
    selectedFrameIndexes: [0],
    frameCount: 4,
  }, 'auto_selection_conflicts_with_frame_indexes')
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [],
    frameCount: 4,
  }, 'manual_selection_requires_frame_indexes')
})

test('normalizeMotionSelectionRequest rejects invalid index containers and values', () => {
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: '0,1',
    frameCount: 4,
  }, 'invalid_selected_frame_indexes')
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [0, 1.5],
    frameCount: 4,
  }, 'invalid_selected_frame_index')
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [0, '1'],
    frameCount: 4,
  }, 'invalid_selected_frame_index')
})

test('normalizeMotionSelectionRequest rejects duplicate and out-of-range indexes', () => {
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [0, 2, 2],
    frameCount: 4,
  }, 'duplicate_selected_frame_index')
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [-1, 0],
    frameCount: 4,
  }, 'selected_frame_index_out_of_range')
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: [0, 4],
    frameCount: 4,
  }, 'selected_frame_index_out_of_range')
})

test('normalizeMotionSelectionRequest rejects oversized manual index lists before Set allocation', () => {
  assertSelectionError({
    selectionMode: 'manual',
    selectedFrameIndexes: Array.from(
      { length: MOTION_SELECTION_INDEX_LIMIT + 1 },
      (_, index) => index
    ),
    frameCount: null,
  }, 'too_many_selected_frame_indexes')
})
