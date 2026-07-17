import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { evaluateIdentityConsistency } from '../../src/motion-source/identityConsistencyGate.js'

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeStrip({ bodyColor = [120, 80, 160, 255], frameCount = 4, width = 18, height = 46, x = 39, y = 42, legShift = 1 } = {}) {
  const cellW = TOPDOWN_RPG_V0.frame.w
  const cellH = TOPDOWN_RPG_V0.frame.h
  const strip = blankImage(cellW * frameCount, cellH)
  for (let index = 0; index < frameCount; index += 1) {
    const dx = index % 2 ? legShift : -legShift
    paintRect(strip, { x: index * cellW + x + dx, y, w: width, h: height }, bodyColor)
    paintRect(strip, { x: index * cellW + x + 4 - dx, y: y + height - 3, w: 4, h: 3 }, bodyColor)
    paintRect(strip, { x: index * cellW + x + width - 8 + dx, y: y + height - 3, w: 4, h: 3 }, bodyColor)
  }
  return strip
}

test('identity consistency gate passes visually consistent strips', () => {
  const result = evaluateIdentityConsistency([
    {
      id: 'idle_down',
      runtime_action: 'idle_down',
      image: makeStrip({ bodyColor: [120, 80, 160, 255], legShift: 0 }),
      facing_direction: 'down',
    },
    {
      id: 'walk_down',
      runtime_action: 'walk_down',
      image: makeStrip({ bodyColor: [124, 82, 158, 255], legShift: 2 }),
      facing_direction: 'down',
    },
  ], {
    identityAnchor: { source_id: 'idle_down', facing_direction: 'down' },
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.can_apply_multi_strip, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.equal(result.per_strip.length, 2)
  assert.equal(result.per_strip[1].status, 'pass')
  assert.equal(result.per_strip[1].direction_check.status, 'pass')
  assert.ok(result.per_strip[1].metrics.palette_delta >= 0)
  assert.ok(result.per_strip[1].metrics.silhouette_ratio_delta >= 0)
  assert.ok(result.per_strip[1].metrics.bbox_width_delta_ratio >= 0)
  assert.ok(result.per_strip[1].metrics.bbox_height_delta_ratio >= 0)
  assert.ok(result.per_strip[1].metrics.baseline_delta_px >= 0)
})

test('identity consistency gate fails when dominant colors drift too far', () => {
  const result = evaluateIdentityConsistency([
    {
      id: 'idle_down',
      runtime_action: 'idle_down',
      image: makeStrip({ bodyColor: [120, 80, 160, 255] }),
      facing_direction: 'down',
    },
    {
      id: 'walk_down',
      runtime_action: 'walk_down',
      image: makeStrip({ bodyColor: [20, 220, 40, 255] }),
      facing_direction: 'down',
    },
  ], {
    identityAnchor: { source_id: 'idle_down', facing_direction: 'down' },
    thresholds: { max_palette_delta: 36 },
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.can_apply_multi_strip, false)
  assert.ok(result.blocking_errors.includes('identity_mismatch:walk_down'))
  assert.ok(result.per_strip[1].failures.includes('palette_delta_exceeded'))
  assert.ok(result.per_strip[1].metrics.palette_delta > 36)
})

test('identity consistency gate fails when silhouette or bbox changes too much', () => {
  const result = evaluateIdentityConsistency([
    {
      id: 'idle_down',
      runtime_action: 'idle_down',
      image: makeStrip({ bodyColor: [120, 80, 160, 255], width: 18, height: 46 }),
      facing_direction: 'down',
    },
    {
      id: 'walk_down',
      runtime_action: 'walk_down',
      image: makeStrip({ bodyColor: [122, 81, 158, 255], width: 34, height: 30, x: 31, y: 58 }),
      facing_direction: 'down',
    },
  ], {
    identityAnchor: { source_id: 'idle_down', facing_direction: 'down' },
    thresholds: {
      max_palette_delta: 36,
      max_silhouette_ratio_delta: 0.12,
      max_bbox_delta_ratio: 0.22,
      max_baseline_delta_px: 4,
    },
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.can_apply_multi_strip, false)
  assert.ok(result.blocking_errors.includes('identity_mismatch:walk_down'))
  assert.ok(result.per_strip[1].failures.some((failure) => failure.endsWith('_exceeded')))
})

test('identity consistency gate reports direction mismatches', () => {
  const result = evaluateIdentityConsistency([
    {
      id: 'idle_down',
      runtime_action: 'idle_down',
      image: makeStrip({ bodyColor: [120, 80, 160, 255] }),
      facing_direction: 'down',
    },
    {
      id: 'walk_right',
      runtime_action: 'walk_right',
      image: makeStrip({ bodyColor: [122, 81, 158, 255] }),
      facing_direction: 'right',
    },
  ], {
    identityAnchor: { source_id: 'idle_down', facing_direction: 'down' },
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.can_apply_multi_strip, false)
  assert.equal(result.per_strip[1].direction_check.status, 'mismatch')
  assert.ok(result.blocking_errors.includes('identity_mismatch:walk_right'))
})
