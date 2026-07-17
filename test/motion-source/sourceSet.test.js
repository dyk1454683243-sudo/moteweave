import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOTION_SOURCE_SET_CONTRACT_VERSION,
  validateMotionSourceSetManifest,
} from '../../src/motion-source/sourceSet.js'

function validManifest(overrides = {}) {
  const hasBackground = Object.hasOwn(overrides, 'background')
  return {
    contract_version: MOTION_SOURCE_SET_CONTRACT_VERSION,
    identity_anchor: {
      source_id: 'idle_down',
      description: 'same character reference used for all action sources',
      ...overrides.identity_anchor,
    },
    background: hasBackground ? overrides.background : {
      source_requirement: 'flat_solid_key_color',
      key_color: [255, 255, 255],
    },
    sources: overrides.sources ?? [
      {
        id: 'idle_down',
        runtime_action: 'idle_down',
        source: 'idle_down.png',
        target_frame_count: 4,
        recommended_duration_sec: [0.6, 1.1],
        facing_direction: 'down',
      },
      {
        id: 'walk_down',
        runtime_action: 'walk_down',
        source: 'walk_down.png',
        target_frame_count: 8,
        recommended_duration_sec: [0.8, 1.4],
        facing_direction: 'down',
      },
    ],
  }
}

test('motion_source_set_v1 requires one identity anchor', () => {
  const result = validateMotionSourceSetManifest({
    ...validManifest(),
    identity_anchor: undefined,
  })

  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('identity_anchor_required'))
  assert.equal(result.normalized_manifest, null)
})

test('motion source set accepts a valid manifest and normalizes source records', () => {
  const result = validateMotionSourceSetManifest(validManifest())

  assert.equal(result.status, 'pass')
  assert.deepEqual(result.blocking_errors, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.normalized_manifest.contract_version, MOTION_SOURCE_SET_CONTRACT_VERSION)
  assert.equal(result.normalized_manifest.sources.length, 2)
  assert.equal(result.normalized_manifest.sources[0].runtime_action, 'idle_down')
  assert.equal(result.normalized_manifest.sources[1].target_frame_count, 8)
  assert.equal(result.normalized_manifest.sources[0].loop_expectation, 'auto')
})

test('motion source set rejects malformed source records and duplicate actions', () => {
  const result = validateMotionSourceSetManifest(validManifest({
    sources: [
      { id: 'bad-a', source: 'a.png', target_frame_count: 4 },
      { id: 'bad-b', runtime_action: 'walk_down', target_frame_count: 0, source: '' },
      { id: 'walk-a', runtime_action: 'walk_left', source: 'walk_a.png', target_frame_count: 4 },
      { id: 'walk-b', runtime_action: 'walk_left', source: 'walk_b.png', target_frame_count: 4 },
    ],
  }))

  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('source_runtime_action_required:0'))
  assert.ok(result.blocking_errors.includes('source_source_required:1'))
  assert.ok(result.blocking_errors.includes('source_target_frame_count_invalid:1'))
  assert.ok(result.blocking_errors.includes('duplicate_runtime_action:walk_left'))
})

test('motion source set rejects unordered recommended duration tuples', () => {
  const result = validateMotionSourceSetManifest(validManifest({
    sources: [
      {
        id: 'walk_down',
        runtime_action: 'walk_down',
        source: 'walk_down.png',
        target_frame_count: 8,
        recommended_duration_sec: [1.2, 0.8],
      },
    ],
  }))

  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('recommended_duration_invalid:0'))
})

test('motion source set warns when background requirements are missing or ambiguous', () => {
  const missing = validateMotionSourceSetManifest(validManifest({
    background: undefined,
    sources: [
      {
        id: 'walk_down',
        runtime_action: 'walk_down',
        source: 'walk_down.png',
        target_frame_count: 8,
      },
    ],
  }))
  const ambiguous = validateMotionSourceSetManifest(validManifest({
    background: {
      source_requirement: 'flat_solid_key_color_or_alpha',
      key_color: [255, 255, 255],
    },
    sources: [
      {
        id: 'walk_down',
        runtime_action: 'walk_down',
        source: 'walk_down.png',
        target_frame_count: 8,
      },
    ],
  }))

  assert.equal(missing.status, 'warning')
  assert.ok(missing.warnings.includes('background_requirement_missing:walk_down'))
  assert.equal(ambiguous.status, 'warning')
  assert.ok(ambiguous.warnings.includes('background_requirement_ambiguous:walk_down'))
})

test('motion source set preserves legacy and explicit loop expectations', () => {
  const result = validateMotionSourceSetManifest(validManifest({
    sources: [
      {
        id: 'idle_down',
        runtime_action: 'idle_down',
        source: 'idle.gif',
        target_frame_count: 4,
        loop_expected: true,
      },
      {
        id: 'hurt_down',
        runtime_action: 'hurt_down',
        source: 'hurt.gif',
        target_frame_count: 3,
        loop_expected: false,
      },
      {
        id: 'attack_down',
        runtime_action: 'attack_down',
        source: 'attack.gif',
        target_frame_count: 5,
        loop_expectation: 'once',
      },
    ],
  }))

  assert.equal(result.status, 'pass')
  assert.deepEqual(
    result.normalized_manifest.sources.map((source) => source.loop_expectation),
    ['loop', 'once', 'once']
  )
  assert.equal(result.normalized_manifest.sources[0].loop_expected, true)
  assert.equal(result.normalized_manifest.sources[1].loop_expected, false)
})

test('motion source set rejects malformed or conflicting loop expectations', () => {
  const malformed = validateMotionSourceSetManifest(validManifest({
    sources: [{
      id: 'idle_down',
      runtime_action: 'idle_down',
      source: 'idle.gif',
      target_frame_count: 4,
      loop_expected: 'yes',
    }],
  }))
  const conflict = validateMotionSourceSetManifest(validManifest({
    sources: [{
      id: 'idle_down',
      runtime_action: 'idle_down',
      source: 'idle.gif',
      target_frame_count: 4,
      loop_expected: true,
      loop_expectation: 'once',
    }],
  }))

  assert.ok(malformed.blocking_errors.includes('loop_expected_invalid:0'))
  assert.ok(conflict.blocking_errors.includes('loop_expectation_conflict:0'))
})
