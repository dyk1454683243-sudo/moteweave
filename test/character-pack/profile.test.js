import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0, getFrameIndex, getAnimationFrameIndexes, getNearestCardinalDirection } from '../../src/character-pack/profile.js'
import { buildAnimations } from '../../src/character-pack/animations.js'

test('topdown_rpg_v0 defines a 64-frame four-direction profile', () => {
  assert.equal(TOPDOWN_RPG_V0.id, 'topdown_rpg_v0')
  assert.equal(TOPDOWN_RPG_V0.grid.columns, 8)
  assert.equal(TOPDOWN_RPG_V0.grid.rows, 8)
  assert.equal(TOPDOWN_RPG_V0.frame.w, 96)
  assert.equal(TOPDOWN_RPG_V0.frame.h, 96)
  assert.deepEqual(TOPDOWN_RPG_V0.anchor, { x: 48, y: 88, mode: 'feet-center' })
  assert.equal(TOPDOWN_RPG_V0.animations.length, 16)
})

test('frame layout maps row-major animation ranges', () => {
  assert.equal(getFrameIndex(0, 0), 0)
  assert.equal(getFrameIndex(5, 7), 47)
  assert.deepEqual(getAnimationFrameIndexes('attack_right'), [44, 45, 46, 47])
  assert.deepEqual(getAnimationFrameIndexes('talk'), [60, 61, 62, 63])
})

test('animations json entries include flip_h false and four frames', () => {
  const animations = buildAnimations()
  assert.deepEqual(Object.keys(animations), TOPDOWN_RPG_V0.animations.map((a) => a.name))
  assert.deepEqual(animations.walk_left.frames, [24, 25, 26, 27])
  assert.equal(animations.walk_left.mode, 'loop')
  assert.equal(animations.walk_left.flip_h, false)
  assert.equal(animations.hurt.mode, 'once')
  assert.deepEqual(animations.hurt.frames, [48, 49, 50, 51])
})

test('diagonal input resolves to nearest cardinal animation direction', () => {
  assert.equal(getNearestCardinalDirection(0, 0, 'down'), 'down')
  assert.equal(getNearestCardinalDirection(10, 2, 'down'), 'right')
  assert.equal(getNearestCardinalDirection(-10, 2, 'down'), 'left')
  assert.equal(getNearestCardinalDirection(2, -10, 'down'), 'up')
  assert.equal(getNearestCardinalDirection(2, 10, 'up'), 'down')
})
