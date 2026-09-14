import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MOTION_OPTIONS_MODEL,
  formatMotionKeyColor,
  createMotionOptionsModel,
  parseMotionKeyColor,
  serializeMotionOptions,
  serializeMotionPixelGridRecipe,
  snapshotMotionOptions,
  updateMotionOptionsModel,
} from '../src/ui/motionSource/optionsModel.js'

test('temporary invalid RGB text is not accepted by the options model boundary', () => {
  assert.equal(parseMotionKeyColor('255, nope, 0'), null)
  assert.equal(parseMotionKeyColor('255,,'), null)
  assert.equal(parseMotionKeyColor('255, 0'), null)
})

test('RGB presets format numerically equivalent text canonically', () => {
  const preset = parseMotionKeyColor('0255, 000, 255')
  assert.deepEqual(preset, [255, 0, 255])
  assert.equal(formatMotionKeyColor(preset), '255,0,255')
})

function legacyPayload(model, frameSelection = []) {
  const selectedIndexes = frameSelection
    .filter((frame) => frame.selected)
    .map((frame) => frame.source_index)
  const options = {
    action: model.action,
    frames: Number(model.targetFrameCount),
    selection_mode: model.selectionMode === 'manual' ? 'manual' : 'auto',
    motion_selection: {
      recipe: model.selectionRecipe,
      loop_expectation: model.loopExpectation,
      temporal_matte: model.temporalMatte,
    },
    stride: Number(model.stride),
    fps: Number(model.fps),
    maxFrames: Number(model.maxFrames),
    startSec: Number(model.startSec || 0),
    endSec: model.endSec === '' || model.endSec === null
      ? null
      : Number(model.endSec),
    background: {
      method: model.backgroundMethod,
      key_color: model.keyColor.map((channel) => Number(channel)),
      tolerance: Number(model.backgroundTolerance),
      defringe: Boolean(model.defringe),
    },
    anchor_policy: {
      static_offset_y: Number(model.staticOffsetY),
    },
    output_profile: {
      resample_strategy: model.resampleStrategy,
    },
  }
  if (model.pixelGridRecipe !== 'disabled') {
    options.pixel_grid_refinement = { recipe: model.pixelGridRecipe }
  }
  if (options.selection_mode === 'manual') {
    options.selected_frame_indexes = selectedIndexes
  }
  return options
}

function assertPayloadEquivalent(model, frameSelection = []) {
  const expected = legacyPayload(model, frameSelection)
  const actual = serializeMotionOptions(model, { frameSelection })
  assert.deepEqual(actual, expected)
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

test('Motion options model exposes the exact baseline defaults', () => {
  const model = createMotionOptionsModel()
  assert.deepEqual(model, DEFAULT_MOTION_OPTIONS_MODEL)
  assertPayloadEquivalent(model)
  assert.equal('pixel_grid_refinement' in serializeMotionOptions(model), false)
  assert.equal('selected_frame_indexes' in serializeMotionOptions(model), false)
})

test('Motion options model updates immutably and fails closed on unknown fields', () => {
  const original = createMotionOptionsModel()
  const updated = updateMotionOptionsModel(original, {
    action: 'walk_up',
    targetFrameCount: 8,
    keyColor: [0, 255, 0],
  })
  assert.notEqual(updated, original)
  assert.deepEqual(original.keyColor, [255, 255, 255])
  assert.deepEqual(updated.keyColor, [0, 255, 0])
  assert.equal(Object.isFrozen(updated), true)
  assert.equal(Object.isFrozen(updated.keyColor), true)
  assert.throws(
    () => updateMotionOptionsModel(original, { futureOption: true }),
    /Unknown Motion options model field/
  )
})

test('Motion selection v1 dependency normalization stays Auto and Disabled', () => {
  const model = createMotionOptionsModel({
    selectionRecipe: 'motion_selection_v1_compat',
    loopExpectation: 'loop',
    temporalMatte: 'evidence_only',
  })
  assert.equal(model.loopExpectation, 'auto')
  assert.equal(model.temporalMatte, 'disabled')
  assertPayloadEquivalent(model)
})

test('Motion options serializer preserves the complete legacy payload matrix', () => {
  const cases = [
    createMotionOptionsModel({
      stride: 2,
      fps: 8,
      maxFrames: 32,
      startSec: 0.5,
      endSec: 2.25,
    }),
    createMotionOptionsModel({
      loopExpectation: 'loop',
      temporalMatte: 'evidence_only',
    }),
    createMotionOptionsModel({
      backgroundMethod: 'external_rembg',
      keyColor: [0, 255, 0],
      backgroundTolerance: 12,
      defringe: false,
      staticOffsetY: -2,
    }),
    createMotionOptionsModel({
      resampleStrategy: 'nearest_keyframes',
    }),
    createMotionOptionsModel({
      endSec: '',
    }),
  ]
  for (const model of cases) assertPayloadEquivalent(model)
})

test('manual selection preserves ordered indexes and auto selection omits them', () => {
  const frameSelection = [
    { source_index: 3, selected: true },
    { source_index: 1, selected: false },
    { source_index: 0, selected: true },
  ]
  const manual = createMotionOptionsModel({ selectionMode: 'manual' })
  assertPayloadEquivalent(manual, frameSelection)
  assert.deepEqual(
    serializeMotionOptions(manual, { frameSelection }).selected_frame_indexes,
    [3, 0]
  )
  const auto = updateMotionOptionsModel(manual, { selectionMode: 'auto' })
  assertPayloadEquivalent(auto, frameSelection)
  assert.equal(
    'selected_frame_indexes' in serializeMotionOptions(auto, { frameSelection }),
    false
  )
})

test('Motion Pixel Grid serializer preserves every supported recipe and omission', () => {
  assert.equal(serializeMotionPixelGridRecipe('disabled'), null)
  for (const recipe of [
    'pixel_grid_v2_balanced',
    'pixel_grid_v2_detail_safe',
    'pixel_grid_v2_oklab',
  ]) {
    assert.deepEqual(serializeMotionPixelGridRecipe(recipe), { recipe })
    assertPayloadEquivalent(createMotionOptionsModel({ pixelGridRecipe: recipe }))
  }
  assert.throws(
    () => serializeMotionPixelGridRecipe('pixel_grid_future'),
    /Unsupported Motion Pixel Grid recipe/
  )
})

test('Motion options snapshots are JSON-safe and detached from later models', () => {
  const original = createMotionOptionsModel({
    selectionMode: 'manual',
    pixelGridRecipe: 'pixel_grid_v2_balanced',
  })
  const snapshot = snapshotMotionOptions(original, {
    frameSelection: [{ source_index: 2, selected: true }],
  })
  const updated = updateMotionOptionsModel(original, {
    targetFrameCount: 6,
    keyColor: [255, 0, 255],
  })
  assert.equal(snapshot.frames, 4)
  assert.deepEqual(snapshot.background.key_color, [255, 255, 255])
  assert.deepEqual(snapshot.selected_frame_indexes, [2])
  assert.equal(updated.targetFrameCount, 6)
})
