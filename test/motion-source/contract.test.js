import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOTION_SOURCE_CONTRACT_VERSION,
  createMotionSourceContract,
  validateMotionSourceContract,
} from '../../src/motion-source/contract.js'

test('createMotionSourceContract returns motion source v1 defaults', () => {
  const contract = createMotionSourceContract()

  assert.equal(contract.contract_version, MOTION_SOURCE_CONTRACT_VERSION)
  assert.equal(contract.contract_version, 'motion_source_contract_v1')
  assert.equal(contract.source_kind, 'gif')
  assert.equal(contract.runtime_action, 'walk_down')
  assert.equal(contract.target_frame_count, 8)
  assert.deepEqual(contract.frame_size.normalized_cell, [96, 96])
  assert.equal(contract.frame_size.strip_layout, 'horizontal')
  assert.equal(contract.anchor_policy.pivot, 'bottom_center')
  assert.equal(contract.anchor_policy.baseline, 'global_bbox_bottom')
  assert.equal(contract.anchor_policy.static_offset_y, 0)
  assert.equal(contract.anchor_policy.max_anchor_drift_px, 2)
  assert.equal(contract.background.source_requirement, 'flat_solid_key_color_or_alpha')
  assert.deepEqual(contract.background.key_color, [255, 255, 255])
  assert.equal(contract.background.tolerance, 24)
  assert.equal(contract.background.defringe, true)
  assert.equal(contract.output_profile.resample_strategy, 'reject_mismatch')
  assert.deepEqual(contract.motion_selection, {
    recipe: 'motion_selection_v1_compat',
    loop_expectation: 'auto',
    temporal_matte: 'disabled',
  })
})

test('createMotionSourceContract preserves valid overrides', () => {
  const contract = createMotionSourceContract({
    source_kind: 'video_file',
    runtime_action: 'jump_right',
    target_frame_count: 12,
    frame_size: { normalized_cell: [128, 96] },
    anchor_policy: { baseline: 'manual_static', static_offset_y: -4 },
    background: {
      source_requirement: 'transparent_alpha',
      key_color: [0, 255, 0],
      tolerance: 32,
      defringe: false,
    },
    output_profile: { resample_strategy: 'nearest_keyframes' },
    motion_selection: {
      recipe: 'motion_selection_recipe_v2',
      loop_expectation: 'once',
      temporal_matte: 'evidence_only',
    },
  })

  assert.equal(contract.source_kind, 'video_file')
  assert.equal(contract.runtime_action, 'jump_right')
  assert.equal(contract.target_frame_count, 12)
  assert.deepEqual(contract.frame_size.normalized_cell, [128, 96])
  assert.equal(contract.anchor_policy.baseline, 'manual_static')
  assert.equal(contract.anchor_policy.static_offset_y, -4)
  assert.equal(contract.background.source_requirement, 'transparent_alpha')
  assert.deepEqual(contract.background.key_color, [0, 255, 0])
  assert.equal(contract.background.tolerance, 32)
  assert.equal(contract.background.defringe, false)
  assert.equal(contract.output_profile.resample_strategy, 'nearest_keyframes')
  assert.equal(contract.motion_selection.recipe, 'motion_selection_recipe_v2')
  assert.equal(contract.motion_selection.loop_expectation, 'once')
  assert.equal(contract.motion_selection.temporal_matte, 'evidence_only')
})

test('validateMotionSourceContract rejects unsupported source kinds and frame counts', () => {
  assert.throws(
    () => createMotionSourceContract({ source_kind: 'sprite_sheet' }),
    /unsupported_motion_source_kind/
  )
  assert.throws(
    () => createMotionSourceContract({ target_frame_count: 0 }),
    /invalid_target_frame_count/
  )
  assert.throws(
    () => createMotionSourceContract({ target_frame_count: 2.5 }),
    /invalid_target_frame_count/
  )
})

test('validateMotionSourceContract rejects malformed cell, baseline, background, and resample values', () => {
  assert.throws(
    () => createMotionSourceContract({ frame_size: { normalized_cell: [96] } }),
    /invalid_normalized_cell/
  )
  assert.throws(
    () => createMotionSourceContract({ anchor_policy: { baseline: 'per_frame_auto_feet' } }),
    /unsupported_anchor_baseline/
  )
  assert.throws(
    () => createMotionSourceContract({ background: { source_requirement: 'busy_scene' } }),
    /unsupported_background_source_requirement/
  )
  assert.throws(
    () => createMotionSourceContract({ background: { key_color: [0, 255] } }),
    /invalid_background_key_color/
  )
  assert.throws(
    () => createMotionSourceContract({ output_profile: { resample_strategy: 'blend' } }),
    /unsupported_resample_strategy/
  )
})

test('validateMotionSourceContract accepts an already built contract object', () => {
  const contract = createMotionSourceContract({ source_kind: 'single_image' })
  assert.doesNotThrow(() => validateMotionSourceContract(contract))

  const camelContract = {
    ...contract,
    motionSelection: {
      recipe: 'motion_selection_recipe_v2',
      loopExpectation: 'once',
      temporalMatte: 'disabled',
    },
  }
  delete camelContract.motion_selection
  assert.doesNotThrow(() => validateMotionSourceContract(camelContract))
})

test('motion source contract rejects unknown or conflicting selection recipes', () => {
  assert.throws(
    () => createMotionSourceContract({
      motion_selection: { recipe: 'future_motion_selection_recipe' },
    }),
    /Unsupported motion selection recipe/
  )
  assert.throws(
    () => createMotionSourceContract({
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'loop',
      },
      motionSelection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'once',
      },
    }),
    /conflicting_motion_selection_contract_options/
  )
})
