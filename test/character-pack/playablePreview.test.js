import test from 'node:test'
import assert from 'node:assert/strict'

import { getAnimationNameForIntent, getMovementIntent, movePreviewActor } from '../../src/character-pack/playablePreview.js'

test('getMovementIntent maps WASD and arrow keys to cardinal directions', () => {
  assert.deepEqual(getMovementIntent(new Set(['d'])), { dx: 1, dy: 0, direction: 'right', moving: true })
  assert.deepEqual(getMovementIntent(new Set(['ArrowLeft'])), { dx: -1, dy: 0, direction: 'left', moving: true })
  assert.deepEqual(getMovementIntent(new Set(['w', 'd'])), { dx: 1, dy: -1, direction: 'up', moving: true })
  assert.deepEqual(getMovementIntent(new Set()), { dx: 0, dy: 0, direction: 'down', moving: false })
})

test('getAnimationNameForIntent chooses walk while moving and idle when stopped', () => {
  assert.equal(getAnimationNameForIntent({ moving: true, direction: 'left' }, 'down'), 'walk_left')
  assert.equal(getAnimationNameForIntent({ moving: false, direction: 'left' }, 'left'), 'idle_left')
})

test('movePreviewActor clamps actor position inside the preview canvas', () => {
  assert.deepEqual(
    movePreviewActor({ x: 10, y: 10 }, { dx: -1, dy: -1 }, { deltaMs: 1000, speed: 80, minX: 0, maxX: 200, minY: 0, maxY: 100 }),
    { x: 0, y: 0 }
  )
  assert.deepEqual(
    movePreviewActor({ x: 190, y: 90 }, { dx: 1, dy: 1 }, { deltaMs: 1000, speed: 80, minX: 0, maxX: 200, minY: 0, maxY: 100 }),
    { x: 200, y: 100 }
  )
})
