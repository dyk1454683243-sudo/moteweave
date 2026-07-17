import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDebugReport } from '../../src/character-pack/processReport.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  CHARACTER_QUALITY_CLOSURE_GATE_IDS,
  CHARACTER_QUALITY_CLOSURE_MODE,
  buildCharacterQualityClosure,
} from '../../src/character-pack/qualityClosureGate.js'
import { validateNormalizedFrames } from '../../src/character-pack/validator.js'

function drawRect(image, rect, color = [40, 60, 80, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function bboxFromRects(rects) {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.w - 1))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h - 1))
  const w = right - x + 1
  const h = bottom - y + 1
  return {
    x,
    y,
    w,
    h,
    right,
    bottom,
    centerX: x + (w - 1) / 2,
    centerY: y + (h - 1) / 2,
  }
}

function makeFrame(index, {
  color = [40 + (index % 37), 60, 80, 255],
  propSide = null,
  whiteEdge = false,
} = {}) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  const rects = [{ x: 42, y: 40, w: 13, h: 49 }]
  drawRect(image, rects[0], color)
  if (whiteEdge) {
    const edge = { x: 41, y: 40, w: 1, h: 49 }
    drawRect(image, edge, [250, 250, 250, 255])
    rects.push(edge)
  }
  if (propSide === 'left') {
    const staff = { x: 25, y: 35, w: 3, h: 54 }
    drawRect(image, staff, [120, 80, 40, 255])
    rects.push(staff)
  } else if (propSide === 'right') {
    const staff = { x: 69, y: 35, w: 3, h: 54 }
    drawRect(image, staff, [120, 80, 40, 255])
    rects.push(staff)
  }
  return {
    index,
    image,
    normalized_bbox: bboxFromRects(rects),
    normalized_anchor: { x: TOPDOWN_RPG_V0.anchor.x, y: TOPDOWN_RPG_V0.anchor.y },
    warnings: [],
  }
}

function makeFrames() {
  return Array.from({ length: 64 }, (_, index) => makeFrame(index))
}

test('character quality closure localizes opaque white-edge halo frames', () => {
  const frames = makeFrames()
  frames[0] = makeFrame(0, { whiteEdge: true })
  const validation = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  const closure = buildCharacterQualityClosure({ frames, profile: TOPDOWN_RPG_V0, validation })
  const haloGate = closure.gates.find((gate) => gate.id === 'background_halo')

  assert.equal(closure.mode, CHARACTER_QUALITY_CLOSURE_MODE)
  assert.equal(closure.status, 'warning')
  assert.equal(closure.release_ready, false)
  assert.deepEqual(closure.gates.map((gate) => gate.id), CHARACTER_QUALITY_CLOSURE_GATE_IDS)
  assert.equal(haloGate.status, 'warning')
  assert.equal(haloGate.action, 'local_halo_cleanup')
  assert.deepEqual(haloGate.frames.map((item) => item.frame), [0])
  assert.ok(closure.frame_issues.some((item) => item.frame === 0 && item.issue === 'white_edge_halo'))
  assert.ok(closure.repair_tasks.some((task) => task.id === 'local_halo_cleanup' && task.provider_required === false))
})

test('character quality closure keeps bbox half-pixel jitter as non-repair advisory', () => {
  const frames = makeFrames()
  const validation = {
    status: 'pass',
    warnings: [],
    blocking_errors: [],
    metrics: {
      walk_cycles: {},
      action_motion: {},
      subpixel_jitter: {
        max_center_x_fractional_spread: 0.5,
        max_center_y_fractional_spread: 0,
        max_half_pixel_x_transitions: 3,
        max_half_pixel_y_transitions: 0,
        animations: {
          walk_down: {
            frames: [16, 17, 18, 19],
            half_pixel_x_transitions: 3,
            half_pixel_y_transitions: 0,
            center_x_spread: 0.5,
            center_y_spread: 0,
          },
        },
      },
      background_residue: { near_white_edge_pixels: 0, passed: true },
      halo_score: 0,
    },
  }

  const closure = buildCharacterQualityClosure({ frames, profile: TOPDOWN_RPG_V0, validation })
  const alignmentGate = closure.gates.find((gate) => gate.id === 'alignment_consistency')

  assert.equal(alignmentGate.status, 'pass')
  assert.equal(alignmentGate.action, 'none')
  assert.equal(alignmentGate.metrics.subpixel_advisory_animation_count, 1)
  assert.deepEqual(alignmentGate.subpixel_advisories.map((item) => item.animation), ['walk_down'])
  assert.equal(closure.repair_tasks.some((task) => task.action === 'local_anchor_stabilization'), false)
})

test('character quality closure turns validator anchor drift into local stabilization task', () => {
  const frames = makeFrames()
  const validation = {
    status: 'warning',
    warnings: ['frame_1_anchor_drift', 'frame_1_baseline_drift'],
    blocking_errors: [],
    metrics: {
      walk_cycles: {},
      action_motion: {},
      subpixel_jitter: { animations: {} },
      background_residue: { near_white_edge_pixels: 0, passed: true },
      halo_score: 0,
    },
  }

  const closure = buildCharacterQualityClosure({ frames, profile: TOPDOWN_RPG_V0, validation })
  const alignmentGate = closure.gates.find((gate) => gate.id === 'alignment_consistency')
  const repairTask = closure.repair_tasks.find((task) => task.action === 'local_anchor_stabilization')

  assert.equal(alignmentGate.status, 'warning')
  assert.deepEqual(alignmentGate.frames.map((item) => item.frame), [1])
  assert.equal(repairTask.provider_required, false)
  assert.deepEqual(repairTask.frames, [1])
})

test('character quality closure flags left-right prop side flips as semantic repair tasks', () => {
  const frames = makeFrames()
  frames[16] = makeFrame(16, { propSide: 'left' })
  frames[17] = makeFrame(17, { propSide: 'left' })
  frames[18] = makeFrame(18, { propSide: 'right' })
  frames[19] = makeFrame(19, { propSide: 'right' })
  const validation = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  const closure = buildCharacterQualityClosure({ frames, profile: TOPDOWN_RPG_V0, validation })
  const propGate = closure.gates.find((gate) => gate.id === 'prop_side_consistency')

  assert.equal(propGate.status, 'warning')
  assert.equal(propGate.action, 'semantic_frame_repair')
  assert.deepEqual(propGate.animations.map((item) => item.animation), ['walk_down'])
  assert.ok(propGate.animations[0].measurements.some((item) => item.dominant_side === 'left'))
  assert.ok(propGate.animations[0].measurements.some((item) => item.dominant_side === 'right'))
  assert.ok(closure.repair_tasks.some((task) => (
    task.id === 'repair_semantic_side_walk_down' &&
    task.provider_required === true &&
    task.frames.includes(16) &&
    task.frames.includes(19)
  )))
})

test('character quality closure converts weak motion signals into animation repair tasks', () => {
  const frames = makeFrames()
  const validation = {
    status: 'warning',
    warnings: ['walk_down_low_motion'],
    blocking_errors: [],
    metrics: {
      walk_cycles: {
        walk_down: { unique_frames: 1, passed: false },
      },
      action_motion: {},
      subpixel_jitter: { animations: {} },
      background_residue: { near_white_edge_pixels: 0, passed: true },
      halo_score: 0,
    },
  }

  const closure = buildCharacterQualityClosure({ frames, profile: TOPDOWN_RPG_V0, validation })
  const motionGate = closure.gates.find((gate) => gate.id === 'motion_consistency')

  assert.equal(motionGate.status, 'warning')
  assert.deepEqual(motionGate.animations[0].frames, [16, 17, 18, 19])
  assert.ok(closure.repair_tasks.some((task) => task.id === 'repair_motion_walk_down'))
})

test('debug report includes provider-free character quality closure evidence', () => {
  const frames = makeFrames()
  frames[0] = makeFrame(0, { whiteEdge: true })
  const validation = validateNormalizedFrames(frames, TOPDOWN_RPG_V0)

  const report = buildDebugReport({
    profile: TOPDOWN_RPG_V0,
    sourceLayoutSummary: { id: 'topdown_rpg_v0', kind: 'uniform_grid', label: '8x8 uniform grid', target_profile: TOPDOWN_RPG_V0.id },
    grid: { columns: [{ w: 96 }], rows: [{ h: 96 }], correction: null, fixed_regions: null },
    fixedSource: null,
    options: {},
    background: { mode: 'auto', options: {}, warnings: [], selection: null },
    componentCleanup: { summary: {} },
    anchorOffset: { x: 0, y: 0 },
    baseProfile: TOPDOWN_RPG_V0,
    normalized: { scale: 1 },
    autoCorrection: { enabled: true, applied_count: 0, corrections: [] },
    lockedAnimations: [],
    motionStabilization: { enabled: true, applied_count: 0, corrections: [] },
    manualAdjustments: { enabled: true, requested_count: 0, applied_count: 0, corrections: [] },
    validation,
    frames,
  })

  assert.equal(report.quality_closure.mode, CHARACTER_QUALITY_CLOSURE_MODE)
  assert.equal(report.quality_closure.gates.find((gate) => gate.id === 'background_halo').status, 'warning')
})
