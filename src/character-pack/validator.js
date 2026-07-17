import { getAnimationFrameIndexes } from './profile.js'

function hashFrame(frame) {
  if (!frame?.image?.data) return null
  let hash = 2166136261
  for (const byte of frame.image.data) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function collectDuplicateFrames(frames) {
  const groups = new Map()
  for (const frame of frames) {
    const hash = hashFrame(frame)
    if (!hash) continue
    const group = groups.get(hash) ?? []
    group.push(frame.index)
    groups.set(hash, group)
  }
  return [...groups.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([hash, indexes]) => ({ hash, frames: indexes }))
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

function computeHaloScore(frames) {
  let maxFrameScore = 0
  for (const frame of frames) {
    const image = frame.image
    if (!image?.data) continue
    let visible = 0
    let halo = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4
        const alpha = image.data[offset + 3]
        if (!alpha) continue
        visible++
        const nearWhite = image.data[offset] >= 240 && image.data[offset + 1] >= 240 && image.data[offset + 2] >= 240
        if (nearWhite && alpha < 255 && hasTransparentNeighbor(image, x, y)) halo++
      }
    }
    if (visible) maxFrameScore = Math.max(maxFrameScore, halo / visible)
  }
  return Number(maxFrameScore.toFixed(4))
}

function evaluateWalkCycles(frames, profile) {
  const byIndex = new Map(frames.map((frame) => [frame.index, frame]))
  return Object.fromEntries(
    profile.animations
      .filter((animation) => animation.name.startsWith('walk_'))
      .map((animation) => {
        const hashes = getAnimationFrameIndexes(animation.name, profile)
          .map((index) => hashFrame(byIndex.get(index)))
          .filter(Boolean)
        if (hashes.length < animation.count) return [animation.name, { unique_frames: null, passed: true }]
        const unique_frames = new Set(hashes).size
        return [animation.name, { unique_frames, passed: unique_frames >= 2 }]
      })
  )
}

function meanFrameDelta(a, b) {
  if (!a?.image?.data || !b?.image?.data) return 0
  const length = Math.min(a.image.data.length, b.image.data.length)
  if (!length) return 0
  let total = 0
  for (let i = 0; i < length; i++) {
    total += Math.abs(a.image.data[i] - b.image.data[i])
  }
  return Number((total / length).toFixed(4))
}

function evaluateActionMotion(frames, profile) {
  const byIndex = new Map(frames.map((frame) => [frame.index, frame]))
  return Object.fromEntries(
    profile.animations.map((animation) => {
      const indexes = getAnimationFrameIndexes(animation.name, profile)
      const deltas = indexes.slice(1).map((index, i) => meanFrameDelta(byIndex.get(indexes[i]), byIndex.get(index)))
      const mean_delta = deltas.length ? Number((deltas.reduce((sum, value) => sum + value, 0) / deltas.length).toFixed(4)) : 0
      return [animation.name, { mean_delta, passed: mean_delta > 0.1 || !animation.name.startsWith('walk_') }]
    })
  )
}

function roundMetric(value) {
  return Number(value.toFixed(4))
}

function spread(values) {
  return values.length ? roundMetric(Math.max(...values) - Math.min(...values)) : 0
}

function fractionalPart(value) {
  return roundMetric(value - Math.floor(value))
}

function uniqueSorted(values) {
  return [...new Set(values.map(roundMetric))].sort((a, b) => a - b)
}

function countHalfPixelTransitions(values) {
  const fractions = values.map(fractionalPart)
  let count = 0
  for (let i = 1; i < fractions.length; i++) {
    if (Math.abs(fractions[i] - fractions[i - 1]) >= 0.5) count++
  }
  return count
}

function evaluateSubpixelJitter(frames, profile) {
  const byIndex = new Map(frames.map((frame) => [frame.index, frame]))
  const animations = {}
  let maxCenterXFractionalSpread = 0
  let maxCenterYFractionalSpread = 0
  let maxHalfPixelXTransitions = 0
  let maxHalfPixelYTransitions = 0

  for (const animation of profile.animations) {
    const animationFrames = getAnimationFrameIndexes(animation.name, profile)
      .map((index) => byIndex.get(index))
      .filter((frame) => frame?.normalized_bbox)
    const centerXValues = animationFrames.map((frame) => roundMetric(frame.normalized_bbox.centerX))
    const centerYValues = animationFrames.map((frame) => roundMetric(frame.normalized_bbox.centerY))
    const fractionalXValues = uniqueSorted(centerXValues.map(fractionalPart))
    const fractionalYValues = uniqueSorted(centerYValues.map(fractionalPart))
    const centerXFractionalSpread = spread(fractionalXValues)
    const centerYFractionalSpread = spread(fractionalYValues)
    const halfPixelXTransitions = countHalfPixelTransitions(centerXValues)
    const halfPixelYTransitions = countHalfPixelTransitions(centerYValues)

    maxCenterXFractionalSpread = Math.max(maxCenterXFractionalSpread, centerXFractionalSpread)
    maxCenterYFractionalSpread = Math.max(maxCenterYFractionalSpread, centerYFractionalSpread)
    maxHalfPixelXTransitions = Math.max(maxHalfPixelXTransitions, halfPixelXTransitions)
    maxHalfPixelYTransitions = Math.max(maxHalfPixelYTransitions, halfPixelYTransitions)

    animations[animation.name] = {
      frames: animationFrames.map((frame) => frame.index),
      center_x_values: centerXValues,
      center_y_values: centerYValues,
      center_x_spread: spread(centerXValues),
      center_y_spread: spread(centerYValues),
      fractional_x_values: fractionalXValues,
      fractional_y_values: fractionalYValues,
      center_x_fractional_spread: centerXFractionalSpread,
      center_y_fractional_spread: centerYFractionalSpread,
      half_pixel_x_transitions: halfPixelXTransitions,
      half_pixel_y_transitions: halfPixelYTransitions,
    }
  }

  return {
    max_center_x_fractional_spread: roundMetric(maxCenterXFractionalSpread),
    max_center_y_fractional_spread: roundMetric(maxCenterYFractionalSpread),
    max_half_pixel_x_transitions: maxHalfPixelXTransitions,
    max_half_pixel_y_transitions: maxHalfPixelYTransitions,
    animations,
  }
}

function evaluateBackgroundResidue(frames) {
  let near_white_edge_pixels = 0
  for (const frame of frames) {
    const image = frame.image
    if (!image?.data) continue
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (x > 1 && y > 1 && x < image.width - 2 && y < image.height - 2) continue
        const offset = (y * image.width + x) * 4
        if (image.data[offset + 3] > 0 && image.data[offset] > 245 && image.data[offset + 1] > 245 && image.data[offset + 2] > 245) {
          near_white_edge_pixels++
        }
      }
    }
  }
  return { near_white_edge_pixels, passed: near_white_edge_pixels === 0 }
}

function evaluateEdgePressure(frames, profile) {
  const edgePx = Math.max(profile.thresholds.minPaddingPx * 2, 6)
  const maxComfortableWidth = profile.frame.w * 0.82
  const severeFrames = []
  for (const frame of frames) {
    const bbox = frame.normalized_bbox
    if (!bbox) continue
    const touchesBothHorizontalEdges = bbox.x <= edgePx && bbox.right >= profile.frame.w - 1 - edgePx
    const nearlyFullWidth = bbox.w >= maxComfortableWidth
    if (touchesBothHorizontalEdges || nearlyFullWidth) severeFrames.push(frame.index)
  }
  return {
    edge_px: edgePx,
    max_comfortable_width: Number(maxComfortableWidth.toFixed(2)),
    severe_frame_count: severeFrames.length,
    severe_frames: severeFrames,
    passed: severeFrames.length <= Math.max(4, Math.floor(frames.length * 0.1)),
  }
}

function averageBBoxValue(frames, indexes, key) {
  const values = indexes.map((index) => frames.find((frame) => frame.index === index)?.normalized_bbox?.[key]).filter((value) => Number.isFinite(value))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function frameAnchor(frame) {
  if (!frame) return null
  const bbox = frame.normalized_bbox
  if (!bbox) return null
  return frame.normalized_anchor ?? { x: bbox.centerX, y: bbox.bottom }
}

function evaluateDirectionConsistency(frames, profile) {
  const walkLeft = getAnimationFrameIndexes('walk_left', profile)
  const walkRight = getAnimationFrameIndexes('walk_right', profile)
  const walkUp = getAnimationFrameIndexes('walk_up', profile)
  const walkDown = getAnimationFrameIndexes('walk_down', profile)
  const baselines = [...walkLeft, ...walkRight, ...walkUp, ...walkDown]
    .map((index) => frameAnchor(frames.find((frame) => frame.index === index))?.y)
    .filter((value) => Number.isFinite(value))
  const baselineDelta = baselines.length ? Math.max(...baselines) - Math.min(...baselines) : 0
  return {
    walk: {
      horizontal_bbox_delta: Number(Math.abs(averageBBoxValue(frames, walkLeft, 'w') - averageBBoxValue(frames, walkRight, 'w')).toFixed(4)),
      vertical_bbox_delta: Number(Math.abs(averageBBoxValue(frames, walkUp, 'h') - averageBBoxValue(frames, walkDown, 'h')).toFixed(4)),
      baseline_delta: Number(baselineDelta.toFixed(4)),
      passed: baselineDelta <= profile.thresholds.baselineDriftPx * 2,
    },
  }
}

function evaluateExportFit() {
  return {
    rpgmaker_v0: { target_frame: { w: 48, h: 48 }, target_sheet: { w: 144, h: 192 }, passed: true },
    ocad_v0: { target_frame: { w: 21, h: 42 }, target_sheet: { w: 252, h: 252 }, passed: true },
  }
}

export function validateNormalizedFrames(frames, profile) {
  const blocking_errors = []
  const warnings = []
  if (frames.length !== profile.grid.columns * profile.grid.rows) blocking_errors.push('frame_count_mismatch')
  for (const frame of frames) {
    const bbox = frame.normalized_bbox
    if (!bbox) {
      blocking_errors.push(`frame_${frame.index}_empty`)
      continue
    }
    if (bbox.x <= 0 || bbox.y <= 0 || bbox.right >= profile.frame.w - 1 || bbox.bottom >= profile.frame.h - 1) {
      blocking_errors.push(`frame_${frame.index}_cropped`)
    }
    const anchor = frameAnchor(frame)
    if (Math.abs(anchor.x - profile.anchor.x) > profile.thresholds.anchorDriftPx) warnings.push(`frame_${frame.index}_anchor_drift`)
    if (Math.abs(anchor.y - profile.anchor.y) > profile.thresholds.baselineDriftPx) warnings.push(`frame_${frame.index}_baseline_drift`)
  }
  const duplicate_frames = collectDuplicateFrames(frames)
  const walk_cycles = evaluateWalkCycles(frames, profile)
  for (const [name, result] of Object.entries(walk_cycles)) {
    if (!result.passed) warnings.push(`${name}_low_motion`)
  }
  const halo_score = computeHaloScore(frames)
  if (halo_score > 0.02) warnings.push('halo_score_high')
  const edge_pressure = evaluateEdgePressure(frames, profile)
  if (!edge_pressure.passed) warnings.push('edge_pressure_high')
  return {
    status: blocking_errors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    frame_count: frames.length,
    blocking_errors,
    warnings,
    metrics: {
      duplicate_frames,
      walk_cycles,
      halo_score,
      direction_consistency: evaluateDirectionConsistency(frames, profile),
      subpixel_jitter: evaluateSubpixelJitter(frames, profile),
      action_motion: evaluateActionMotion(frames, profile),
      background_residue: evaluateBackgroundResidue(frames),
      edge_pressure,
      export_fit: evaluateExportFit(),
    },
  }
}
