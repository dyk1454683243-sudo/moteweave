import test from 'node:test'
import assert from 'node:assert/strict'

import { stabilizeAnimationGroups } from '../../src/character-pack/motionStabilizer.js'
import { detectAlphaBBox } from '../../src/character-pack/normalizer.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function makeImage(rects) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const offset = (y * image.width + x) * 4
        image.data[offset] = 38
        image.data[offset + 1] = 104
        image.data[offset + 2] = 68
        image.data[offset + 3] = 255
      }
    }
  }
  return image
}

function shiftRects(rects, dx, dy = 0) {
  return rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy }))
}

function makeFrame(index, rects) {
  const image = makeImage(rects)
  return {
    index,
    normalized_bbox: detectAlphaBBox(image),
    normalized_anchor: { x: TOPDOWN_RPG_V0.anchor.x, y: TOPDOWN_RPG_V0.anchor.y },
    image,
    warnings: [],
  }
}

function makeTemplateFrame(index, rects, stabilizable) {
  return {
    ...makeFrame(index, rects),
    source_meta: {
      template_motion: { action: 'sitdown', family: 'sit', direction: 'down', stabilizable },
    },
  }
}

test('stabilizeAnimationGroups removes 1px visual drift even when anchors already match', () => {
  const baseRects = [
    { x: 43, y: 31, w: 11, h: 42 },
    { x: 40, y: 73, w: 6, h: 16 },
    { x: 51, y: 73, w: 6, h: 16 },
  ]
  const frames = [
    makeFrame(0, baseRects),
    makeFrame(1, shiftRects(baseRects, 1)),
    makeFrame(2, baseRects),
    makeFrame(3, shiftRects(baseRects, 1)),
  ]

  const result = stabilizeAnimationGroups(frames, TOPDOWN_RPG_V0, { maxShift: 2 })

  assert.equal(result.applied_count, 2)
  assert.deepEqual(result.corrections.map(({ frame, animation, dx, dy }) => ({ frame, animation, dx, dy })), [
    { frame: 1, animation: 'idle_down', dx: -1, dy: 0 },
    { frame: 3, animation: 'idle_down', dx: -1, dy: 0 },
  ])
  assert.equal(result.frames[1].normalized_bbox.x, result.frames[0].normalized_bbox.x)
  assert.equal(result.frames[3].normalized_bbox.x, result.frames[0].normalized_bbox.x)
  assert.equal(result.frames[1].motion_stabilization.applied, true)
})

test('stabilizeAnimationGroups respects non-stabilizable template actions', () => {
  const baseRects = [{ x: 43, y: 31, w: 11, h: 58 }]
  const frames = [
    makeTemplateFrame(56, baseRects, false),
    makeTemplateFrame(57, shiftRects(baseRects, 1), false),
    makeTemplateFrame(58, baseRects, false),
    makeTemplateFrame(59, shiftRects(baseRects, 1), false),
  ]

  const result = stabilizeAnimationGroups(frames, TOPDOWN_RPG_V0, { maxShift: 2 })

  assert.equal(result.applied_count, 0)
  assert.equal(result.frames[1].motion_stabilization.applied, false)
  assert.equal(result.frames[1].normalized_bbox.x, frames[1].normalized_bbox.x)
})

test('stabilizeAnimationGroups skips user-locked animation groups', () => {
  const baseRects = [
    { x: 43, y: 31, w: 11, h: 42 },
    { x: 40, y: 73, w: 6, h: 16 },
    { x: 51, y: 73, w: 6, h: 16 },
  ]
  const frames = [
    makeFrame(0, baseRects),
    makeFrame(1, shiftRects(baseRects, 1)),
    makeFrame(2, baseRects),
    makeFrame(3, shiftRects(baseRects, 1)),
  ]

  const result = stabilizeAnimationGroups(frames, TOPDOWN_RPG_V0, {
    maxShift: 2,
    lockedAnimations: ['idle_down'],
  })

  assert.equal(result.applied_count, 0)
  assert.equal(result.frames[1].motion_stabilization.reason, 'locked_animation')
  assert.equal(result.frames[1].normalized_bbox.x, frames[1].normalized_bbox.x)
})
