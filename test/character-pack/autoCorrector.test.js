import test from 'node:test'
import assert from 'node:assert/strict'

import { autoCorrectNormalizedFrames } from '../../src/character-pack/autoCorrector.js'
import { detectAlphaBBox } from '../../src/character-pack/normalizer.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { validateNormalizedFrames } from '../../src/character-pack/validator.js'

function makeFrame(index, rect) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = 32
      image.data[offset + 1] = 96
      image.data[offset + 2] = 180
      image.data[offset + 3] = 255
    }
  }
  return {
    index,
    source_bbox: rect,
    normalized_bbox: detectAlphaBBox(image),
    image,
    warnings: [],
  }
}

test('autoCorrectNormalizedFrames recenters safe anchor drift without changing baseline', () => {
  const drifting = makeFrame(42, { x: 10, y: 21, w: 54, h: 68 })
  const before = validateNormalizedFrames([drifting], { ...TOPDOWN_RPG_V0, grid: { columns: 1, rows: 1 } })
  assert.ok(before.warnings.includes('frame_42_anchor_drift'))

  const result = autoCorrectNormalizedFrames([drifting], TOPDOWN_RPG_V0)
  assert.equal(result.applied_count, 1)
  assert.deepEqual(result.corrections.map(({ frame, dx, dy }) => ({ frame, dx, dy })), [{ frame: 42, dx: 11, dy: 0 }])

  const corrected = result.frames[0]
  assert.equal(corrected.normalized_bbox.centerX, 48)
  assert.equal(corrected.normalized_bbox.bottom, TOPDOWN_RPG_V0.anchor.y)
  assert.equal(corrected.auto_correction.applied, true)
})
