import test from 'node:test'
import assert from 'node:assert/strict'
import { ONION_DEFAULTS, onionFrames, tintOnionPixels } from '../../src/ui/vnext/vnext-onion-skin.js'

test('onion range follows stable frame order, stops at ends, and is bounded to three each side', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const options = { ...ONION_DEFAULTS, previous: 3, next: 3 }
  assert.deepEqual(onionFrames(order, 'd', options).map(f => [f.id, f.distance]), [['a', 3], ['b', 2], ['c', 1], ['g', 3], ['f', 2], ['e', 1]])
  assert.deepEqual(onionFrames(order, 'a', options).map(f => f.id), ['d', 'c', 'b'])
  assert.deepEqual(onionFrames(order, 'h', options).map(f => f.id), ['e', 'f', 'g'])
  assert.deepEqual(onionFrames(order, 'missing', options), [])
  assert.equal(onionFrames(order, 'd', { ...options, previous: 999, next: 999 }).length, 6)
  assert.deepEqual(onionFrames(order, 'd', { ...options, previous: 0, next: 0 }), [])
  assert.deepEqual(onionFrames(['d', 'a', 'b'], 'a', options).map(f => f.id), ['d', 'b'])
})

test('onion tint and distance opacity operate on fresh bytes, retaining source alpha without changing source', () => {
  const bytes = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128, 5, 7, 9, 0), saved = bytes.slice()
  assert.deepEqual([...tintOnionPixels(bytes, '#de9693', 35)], [222, 150, 147, 89, 222, 150, 147, 45, 222, 150, 147, 0])
  assert.deepEqual(bytes, saved)
  assert.equal(tintOnionPixels(bytes, '#82a8c8', 100)[3], 255)
  assert.equal(tintOnionPixels(bytes, '#82a8c8', 0)[3], 0)
  const frames = onionFrames(['a', 'b', 'c'], 'c', { ...ONION_DEFAULTS, previous: 2 })
  assert.equal(tintOnionPixels(bytes, frames[0].tint, frames[0].opacity)[3], 45)
  assert.equal(ONION_DEFAULTS.enabled, false)
})
