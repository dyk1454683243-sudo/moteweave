import test from 'node:test'
import assert from 'node:assert/strict'

import { validateNormalizedFrames } from '../../src/character-pack/validator.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

test('validator fails missing frames and passes stable complete frames', () => {
  assert.equal(validateNormalizedFrames([], TOPDOWN_RPG_V0).status, 'fail')
  const frames = Array.from({ length: 64 }, (_, i) => ({
    index: i,
    normalized_bbox: { x: 40, y: 30, w: 16, h: 58, right: 55, bottom: 88, centerX: 48, centerY: 59 },
    warnings: [],
  }))
  const report = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)
  assert.equal(report.status, 'pass')
  assert.equal(report.frame_count, 64)
  assert.deepEqual(report.blocking_errors, [])
})

function makeFrame(index, color = [40, 60, 80, 255]) {
  const width = TOPDOWN_RPG_V0.frame.w
  const height = TOPDOWN_RPG_V0.frame.h
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 40; y <= 88; y++) {
    for (let x = 42; x <= 54; x++) {
      const offset = (y * width + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = color[3]
    }
  }
  return {
    index,
    normalized_bbox: { x: 42, y: 40, w: 13, h: 49, right: 54, bottom: 88, centerX: 48.5, centerY: 64.5 },
    image: { width, height, data },
    warnings: [],
  }
}

test('validator reports exact duplicate frames and low-motion walk cycles', () => {
  const frames = Array.from({ length: 64 }, (_, i) => makeFrame(i, [40 + (i % 7), 60, 80, 255]))
  for (const index of [16, 17, 18, 19]) frames[index] = makeFrame(index, [12, 20, 30, 255])

  const report = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  assert.equal(report.status, 'warning')
  assert.ok(report.warnings.includes('walk_down_low_motion'))
  assert.deepEqual(report.metrics.walk_cycles.walk_down, { unique_frames: 1, passed: false })
  assert.ok(report.metrics.duplicate_frames.some((group) => group.frames.includes(16) && group.frames.includes(19)))
})

test('validator reports edge halo score for white fringe pixels', () => {
  const frames = Array.from({ length: 64 }, (_, i) => makeFrame(i, [40 + (i % 7), 60, 80, 255]))
  const frame = frames[0]
  for (let y = 40; y <= 88; y++) {
    const offset = (y * frame.image.width + 41) * 4
    frame.image.data[offset] = 250
    frame.image.data[offset + 1] = 250
    frame.image.data[offset + 2] = 250
    frame.image.data[offset + 3] = 210
  }
  frame.normalized_bbox = { x: 41, y: 40, w: 14, h: 49, right: 54, bottom: 88, centerX: 48, centerY: 64.5 }

  const report = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  assert.ok(report.metrics.halo_score > 0)
  assert.ok(report.warnings.includes('halo_score_high'))
})

test('validator reports direction consistency, action motion, residue, and export fit metrics', () => {
  const frames = Array.from({ length: 64 }, (_, i) => makeFrame(i, [40 + (i % 7), 60, 80, 255]))
  frames[0].image.data[0] = 250
  frames[0].image.data[1] = 250
  frames[0].image.data[2] = 250
  frames[0].image.data[3] = 255

  const result = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  assert.equal(typeof result.metrics.direction_consistency.walk.horizontal_bbox_delta, 'number')
  assert.equal(typeof result.metrics.action_motion.walk_down.mean_delta, 'number')
  assert.equal(typeof result.metrics.background_residue.near_white_edge_pixels, 'number')
  assert.equal(result.metrics.export_fit.rpgmaker_v0.target_frame.w, 48)
  assert.equal(result.metrics.export_fit.ocad_v0.target_sheet.w, 252)
})

test('validator records half-pixel center jitter without warning by itself', () => {
  const frames = Array.from({ length: 64 }, (_, i) => makeFrame(i, [40 + (i % 17), 60, 80, 255]))
  const centers = [48, 48.5, 48, 48.5]
  for (const [offset, centerX] of centers.entries()) {
    const index = 16 + offset
    const w = centerX % 1 === 0 ? 16 : 17
    const x = 40
    frames[index].normalized_bbox = { x, y: 40, w, h: 49, right: x + w - 1, bottom: 88, centerX, centerY: 64.5 }
  }

  const result = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)
  const jitter = result.metrics.subpixel_jitter.animations.walk_down

  assert.deepEqual(jitter.center_x_values, [48, 48.5, 48, 48.5])
  assert.equal(jitter.center_x_spread, 0.5)
  assert.deepEqual(jitter.fractional_x_values, [0, 0.5])
  assert.equal(jitter.half_pixel_x_transitions, 3)
  assert.equal(result.warnings.some((warning) => warning.includes('subpixel_jitter')), false)
})

test('validator warns when many frames appear horizontally cut by wrong grid slicing', () => {
  const frames = Array.from({ length: 64 }, (_, i) => makeFrame(i, [40 + (i % 7), 60, 80, 255]))
  for (const frame of frames.slice(0, 12)) {
    frame.normalized_bbox = { x: 5, y: 24, w: 86, h: 64, right: 90, bottom: 88, centerX: 47.5, centerY: 56 }
  }

  const result = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  assert.equal(result.status, 'warning')
  assert.ok(result.warnings.includes('edge_pressure_high'))
  assert.equal(result.metrics.edge_pressure.severe_frame_count, 12)
  assert.equal(result.metrics.edge_pressure.passed, false)
})
