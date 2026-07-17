import { getAnimationFrameIndexes } from './profile.js'

export const CHARACTER_QUALITY_CLOSURE_MODE = 'character_frame_quality_closure_v1'

const DEFAULTS = Object.freeze({
  haloScoreWarning: 0.01,
  haloPixelWarning: 8,
  motionMeanDeltaWarning: 0.1,
  sideFlipWarning: 0.18,
  minPeripheralPixels: 18,
  coreHalfWidthPx: 10,
})

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function statusRank(status) {
  return ({ pass: 0, warning: 1, fail: 2 }[status] ?? 1)
}

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => (statusRank(status) > statusRank(worst) ? status : worst), 'pass')
}

function frameByIndex(frames = []) {
  return new Map(frames.map((frame) => [frame.index, frame]))
}

function animationForFrame(index, profile) {
  for (const animation of profile.animations ?? []) {
    const indexes = getAnimationFrameIndexes(animation.name, profile)
    if (indexes.includes(index)) return animation.name
  }
  return null
}

function hasTransparentNeighbor(image, x, y) {
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]
  return offsets.some(([dx, dy]) => {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return true
    return image.data[(ny * image.width + nx) * 4 + 3] === 0
  })
}

function measureFrameHalo(frame) {
  const image = frame?.image
  if (!image?.data) {
    return {
      frame: frame?.index ?? null,
      visible_pixel_count: 0,
      white_edge_pixel_count: 0,
      semi_transparent_white_edge_pixel_count: 0,
      halo_score: 0,
    }
  }
  let visiblePixelCount = 0
  let whiteEdgePixelCount = 0
  let semiTransparentWhiteEdgePixelCount = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      const alpha = image.data[offset + 3]
      if (!alpha) continue
      visiblePixelCount++
      const nearWhite = image.data[offset] >= 240 && image.data[offset + 1] >= 240 && image.data[offset + 2] >= 240
      if (!nearWhite || !hasTransparentNeighbor(image, x, y)) continue
      whiteEdgePixelCount++
      if (alpha < 255) semiTransparentWhiteEdgePixelCount++
    }
  }
  return {
    frame: frame.index,
    visible_pixel_count: visiblePixelCount,
    white_edge_pixel_count: whiteEdgePixelCount,
    semi_transparent_white_edge_pixel_count: semiTransparentWhiteEdgePixelCount,
    halo_score: visiblePixelCount ? round(whiteEdgePixelCount / visiblePixelCount) : 0,
  }
}

function buildHaloGate(frames, profile, validation, thresholds) {
  const perFrame = frames.map(measureFrameHalo)
  const affected = perFrame.filter((item) => (
    item.white_edge_pixel_count >= thresholds.haloPixelWarning ||
    item.halo_score >= thresholds.haloScoreWarning
  ))
  const validationMetrics = validation?.metrics ?? {}
  const nearWhiteEdgePixels = Number(validationMetrics.background_residue?.near_white_edge_pixels ?? 0)
  const validatorHaloScore = Number(validationMetrics.halo_score ?? 0)
  const status = affected.length || nearWhiteEdgePixels > 0 || validatorHaloScore > thresholds.haloScoreWarning
    ? 'warning'
    : 'pass'
  return {
    gate: {
      id: 'background_halo',
      status,
      action: status === 'pass' ? 'none' : 'local_halo_cleanup',
      message: status === 'pass'
        ? 'No frame-level white-edge halo evidence found.'
        : 'White or near-white edge pixels are present around visible silhouettes; run local cleanup before judging semantic quality.',
      metrics: {
        max_frame_halo_score: round(Math.max(0, ...perFrame.map((item) => item.halo_score))),
        affected_frame_count: affected.length,
        validator_halo_score: validatorHaloScore,
        near_white_edge_pixels: nearWhiteEdgePixels,
      },
      frames: affected.map((item) => ({
        frame: item.frame,
        animation: animationForFrame(item.frame, profile),
        halo_score: item.halo_score,
        white_edge_pixel_count: item.white_edge_pixel_count,
        semi_transparent_white_edge_pixel_count: item.semi_transparent_white_edge_pixel_count,
      })),
    },
    frameIssues: affected.map((item) => ({
      frame: item.frame,
      animation: animationForFrame(item.frame, profile),
      issue: 'white_edge_halo',
      severity: 'warning',
      action: 'local_halo_cleanup',
      metrics: {
        halo_score: item.halo_score,
        white_edge_pixel_count: item.white_edge_pixel_count,
        semi_transparent_white_edge_pixel_count: item.semi_transparent_white_edge_pixel_count,
      },
    })),
  }
}

function actionMotionWarnings(validation, thresholds) {
  return Object.entries(validation?.metrics?.action_motion ?? {})
    .filter(([, item]) => item?.passed === false)
    .map(([animation, item]) => ({ animation, mean_delta: Number(item?.mean_delta ?? 0), reason: 'low_action_delta' }))
}

function walkCycleWarnings(validation) {
  return Object.entries(validation?.metrics?.walk_cycles ?? {})
    .filter(([, item]) => item?.passed === false)
    .map(([animation, item]) => ({ animation, unique_frames: item?.unique_frames ?? null, reason: 'low_unique_walk_frames' }))
}

function buildMotionGate(profile, validation, thresholds) {
  const lowMotion = [...walkCycleWarnings(validation), ...actionMotionWarnings(validation, thresholds)]
  const byAnimation = new Map()
  for (const item of lowMotion) {
    const existing = byAnimation.get(item.animation) ?? { animation: item.animation, reasons: [], metrics: {} }
    if (!existing.reasons.includes(item.reason)) existing.reasons.push(item.reason)
    existing.metrics = { ...existing.metrics, ...item }
    byAnimation.set(item.animation, existing)
  }
  const animations = [...byAnimation.values()]
  const status = animations.length ? 'warning' : 'pass'
  return {
    gate: {
      id: 'motion_consistency',
      status,
      action: status === 'pass' ? 'none' : 'single_animation_repair',
      message: status === 'pass'
        ? 'Animation groups have enough local motion evidence.'
        : 'At least one animation group has weak or repeated motion; prefer targeted animation repair over full-sheet regeneration.',
      animations: animations.map((item) => ({
        animation: item.animation,
        frames: getAnimationFrameIndexes(item.animation, profile),
        reasons: item.reasons,
        metrics: item.metrics,
      })),
    },
    frameIssues: animations.flatMap((item) => getAnimationFrameIndexes(item.animation, profile).map((frame) => ({
      frame,
      animation: item.animation,
      issue: 'motion_inconsistent',
      severity: 'warning',
      action: 'single_animation_repair',
      metrics: item.metrics,
    }))),
  }
}

function parseFrameWarning(message, suffix) {
  const match = String(message || '').match(new RegExp(`^frame_(\\d+)_${suffix}$`))
  return match ? Number(match[1]) : null
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))]
}

function buildAlignmentGate(profile, validation) {
  const warnings = validation?.warnings ?? []
  const anchorFrames = warnings.map((item) => parseFrameWarning(item, 'anchor_drift')).filter(Number.isFinite)
  const baselineFrames = warnings.map((item) => parseFrameWarning(item, 'baseline_drift')).filter(Number.isFinite)
  const jitter = validation?.metrics?.subpixel_jitter ?? {}
  const subpixelAdvisories = Object.entries(jitter.animations ?? {})
    .filter(([, item]) => Number(item?.half_pixel_x_transitions ?? 0) > 0 || Number(item?.half_pixel_y_transitions ?? 0) > 0)
    .map(([animation, item]) => ({
      animation,
      frames: item.frames ?? getAnimationFrameIndexes(animation, profile),
      half_pixel_x_transitions: Number(item.half_pixel_x_transitions ?? 0),
      half_pixel_y_transitions: Number(item.half_pixel_y_transitions ?? 0),
      center_x_spread: Number(item.center_x_spread ?? 0),
      center_y_spread: Number(item.center_y_spread ?? 0),
    }))
  const driftFrames = [...new Set([...anchorFrames, ...baselineFrames])].sort((a, b) => a - b)
  const driftAnimations = unique(driftFrames.map((frame) => animationForFrame(frame, profile))).map((animation) => ({
    animation,
    frames: driftFrames.filter((frame) => animationForFrame(frame, profile) === animation),
  }))
  const status = driftFrames.length ? 'warning' : 'pass'
  return {
    gate: {
      id: 'alignment_consistency',
      status,
      action: status === 'pass' ? 'none' : 'local_anchor_stabilization',
      message: status === 'pass'
        ? 'Frame anchors and baselines are within local thresholds; bbox center half-pixel transitions are retained as advisory metrics only.'
        : 'Frame anchors or baselines need local stabilization before semantic repair.',
      metrics: {
        subpixel_advisory_animation_count: subpixelAdvisories.length,
        max_half_pixel_x_transitions: Number(jitter.max_half_pixel_x_transitions ?? 0),
        max_half_pixel_y_transitions: Number(jitter.max_half_pixel_y_transitions ?? 0),
        max_center_x_fractional_spread: Number(jitter.max_center_x_fractional_spread ?? 0),
        max_center_y_fractional_spread: Number(jitter.max_center_y_fractional_spread ?? 0),
      },
      frames: driftFrames.map((frame) => ({
        frame,
        animation: animationForFrame(frame, profile),
        anchor_drift: anchorFrames.includes(frame),
        baseline_drift: baselineFrames.includes(frame),
      })),
      animations: driftAnimations,
      subpixel_advisories: subpixelAdvisories,
    },
    frameIssues: driftFrames.map((frame) => ({
      frame,
      animation: animationForFrame(frame, profile),
      issue: 'anchor_or_baseline_drift',
      severity: 'warning',
      action: 'local_anchor_stabilization',
    })),
  }
}

function measureLateralPeripheralBalance(frame, profile, thresholds) {
  const image = frame?.image
  const bbox = frame?.normalized_bbox
  if (!image?.data || !bbox) return null
  const anchorX = frame.normalized_anchor?.x ?? profile.anchor?.x ?? bbox.centerX
  const coreLeft = anchorX - thresholds.coreHalfWidthPx
  const coreRight = anchorX + thresholds.coreHalfWidthPx
  let left = 0
  let right = 0
  for (let y = bbox.y; y <= bbox.bottom; y++) {
    for (let x = bbox.x; x <= bbox.right; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]
      if (!alpha) continue
      if (x < coreLeft) left++
      else if (x > coreRight) right++
    }
  }
  const total = left + right
  return {
    frame: frame.index,
    left_peripheral_pixels: left,
    right_peripheral_pixels: right,
    peripheral_pixel_count: total,
    side_balance: total ? round((right - left) / total) : 0,
    dominant_side: total < thresholds.minPeripheralPixels
      ? 'none'
      : right - left > thresholds.minPeripheralPixels ? 'right'
        : left - right > thresholds.minPeripheralPixels ? 'left' : 'balanced',
  }
}

function buildPropSideGate(frames, profile, thresholds) {
  const byIndex = frameByIndex(frames)
  const animations = []
  for (const animation of profile.animations ?? []) {
    const measurements = getAnimationFrameIndexes(animation.name, profile)
      .map((index) => measureLateralPeripheralBalance(byIndex.get(index), profile, thresholds))
      .filter(Boolean)
    const leftCount = measurements.filter((item) => item.side_balance <= -thresholds.sideFlipWarning).length
    const rightCount = measurements.filter((item) => item.side_balance >= thresholds.sideFlipWarning).length
    const balanceSpread = measurements.length
      ? round(Math.max(...measurements.map((item) => item.side_balance)) - Math.min(...measurements.map((item) => item.side_balance)))
      : 0
    if (leftCount > 0 && rightCount > 0) {
      animations.push({
        animation: animation.name,
        frames: measurements.map((item) => item.frame),
        left_count: leftCount,
        right_count: rightCount,
        side_balance_spread: balanceSpread,
        measurements,
      })
    }
  }
  const status = animations.length ? 'warning' : 'pass'
  return {
    gate: {
      id: 'prop_side_consistency',
      status,
      action: status === 'pass' ? 'none' : 'semantic_frame_repair',
      message: status === 'pass'
        ? 'No strong lateral side flips detected inside a single animation group.'
        : 'One or more animation groups show left/right peripheral silhouette flips; this is a semantic consistency warning for held props or accessories.',
      animations,
    },
    frameIssues: animations.flatMap((item) => item.measurements.map((measurement) => ({
      frame: measurement.frame,
      animation: item.animation,
      issue: 'prop_side_flip_suspected',
      severity: 'warning',
      action: 'semantic_frame_repair',
      metrics: {
        side_balance: measurement.side_balance,
        dominant_side: measurement.dominant_side,
        left_peripheral_pixels: measurement.left_peripheral_pixels,
        right_peripheral_pixels: measurement.right_peripheral_pixels,
      },
    }))),
  }
}

function buildRepairTasks(gates) {
  const tasks = []
  for (const gate of gates) {
    if (gate.status === 'pass') continue
    if (gate.id === 'background_halo') {
      tasks.push({
        id: 'local_halo_cleanup',
        provider_required: false,
        action: 'local_halo_cleanup',
        frames: gate.frames.map((item) => item.frame),
        rationale: gate.message,
      })
    } else if (gate.id === 'alignment_consistency') {
      tasks.push({
        id: 'local_anchor_stabilization',
        provider_required: false,
        action: 'local_anchor_stabilization',
        frames: gate.frames.map((item) => item.frame),
        animations: gate.animations.map((item) => item.animation),
        rationale: gate.message,
      })
    } else if (gate.id === 'motion_consistency') {
      for (const item of gate.animations) {
        tasks.push({
          id: `repair_motion_${item.animation}`,
          provider_required: true,
          action: 'single_animation_repair',
          animation: item.animation,
          frames: item.frames,
          rationale: item.reasons.join(', '),
        })
      }
    } else if (gate.id === 'prop_side_consistency') {
      for (const item of gate.animations) {
        tasks.push({
          id: `repair_semantic_side_${item.animation}`,
          provider_required: true,
          action: 'semantic_frame_repair',
          animation: item.animation,
          frames: item.frames,
          rationale: 'held prop or accessory appears to switch sides inside the animation group',
        })
      }
    }
  }
  return tasks
}

export function buildCharacterQualityClosure({ frames = [], profile, validation = {}, thresholds = {} } = {}) {
  const resolvedThresholds = { ...DEFAULTS, ...thresholds }
  const halo = buildHaloGate(frames, profile, validation, resolvedThresholds)
  const alignment = buildAlignmentGate(profile, validation)
  const motion = buildMotionGate(profile, validation, resolvedThresholds)
  const propSide = buildPropSideGate(frames, profile, resolvedThresholds)
  const gates = [halo.gate, alignment.gate, motion.gate, propSide.gate]
  const frameIssues = [...halo.frameIssues, ...alignment.frameIssues, ...motion.frameIssues, ...propSide.frameIssues]
  const repairTasks = buildRepairTasks(gates)
  return {
    mode: CHARACTER_QUALITY_CLOSURE_MODE,
    status: worstStatus(gates.map((gate) => gate.status)),
    release_ready: gates.every((gate) => gate.status === 'pass'),
    summary: {
      gate_count: gates.length,
      warning_gate_count: gates.filter((gate) => gate.status === 'warning').length,
      fail_gate_count: gates.filter((gate) => gate.status === 'fail').length,
      frame_issue_count: frameIssues.length,
      provider_repair_task_count: repairTasks.filter((task) => task.provider_required).length,
      local_repair_task_count: repairTasks.filter((task) => !task.provider_required).length,
    },
    gates,
    frame_issues: frameIssues.sort((a, b) => a.frame - b.frame || a.issue.localeCompare(b.issue)),
    repair_tasks: repairTasks,
    claim_boundary: 'Provider output is not judged as production-ready until local halo, alignment, motion, and semantic consistency gates are reviewed.',
  }
}
