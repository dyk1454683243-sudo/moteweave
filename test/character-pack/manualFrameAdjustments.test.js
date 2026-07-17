import test from 'node:test'
import assert from 'node:assert/strict'

import { applyManualFrameAdjustments } from '../../src/character-pack/manualFrameAdjustments.js'
import { detectAlphaBBox } from '../../src/character-pack/normalizer.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function makeFrame(index, rect) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = 20
      image.data[offset + 1] = 80
      image.data[offset + 2] = 100
      image.data[offset + 3] = 255
    }
  }
  return {
    index,
    image,
    normalized_bbox: detectAlphaBBox(image),
    normalized_anchor: { x: 48, y: 88, mode: 'template-foot-center' },
    warnings: [],
  }
}

test('applyManualFrameAdjustments shifts selected frames and records safe corrections', () => {
  const frames = [makeFrame(0, { x: 40, y: 30, w: 12, h: 50 }), makeFrame(1, { x: 40, y: 30, w: 12, h: 50 })]

  const result = applyManualFrameAdjustments(frames, TOPDOWN_RPG_V0, {
    adjustments: [{ frame: 1, dx: -2, dy: 1 }],
  })

  assert.equal(result.applied_count, 1)
  assert.deepEqual(result.corrections.map(({ frame, dx, dy }) => ({ frame, dx, dy })), [{ frame: 1, dx: -2, dy: 1 }])
  assert.equal(result.frames[1].normalized_bbox.x, 38)
  assert.equal(result.frames[1].normalized_anchor.x, 46)
  assert.equal(result.frames[1].normalized_anchor.y, 89)
  assert.equal(result.frames[1].manual_adjustment.applied, true)
})

test('applyManualFrameAdjustments skips corrections that would crop visible pixels', () => {
  const frames = [makeFrame(2, { x: 0, y: 30, w: 12, h: 50 })]

  const result = applyManualFrameAdjustments(frames, TOPDOWN_RPG_V0, {
    adjustments: [{ frame: 2, dx: -2, dy: 0 }],
  })

  assert.equal(result.applied_count, 0)
  assert.equal(result.frames[0].manual_adjustment.applied, false)
  assert.equal(result.frames[0].manual_adjustment.reason, 'would_crop')
})
