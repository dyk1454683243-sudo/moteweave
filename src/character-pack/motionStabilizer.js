import { pixelOffset } from './imageMath.js'
import { detectAlphaBBox, detectFootAnchor } from './normalizer.js'
import { getAnimationFrameIndexes } from './profile.js'

function translateImage(image, dx, dy) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.length) }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const targetX = x + dx
      const targetY = y + dy
      if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) continue
      const src = pixelOffset(image.width, x, y)
      if (!image.data[src + 3]) continue
      const dst = pixelOffset(out.width, targetX, targetY)
      out.data[dst] = image.data[src]
      out.data[dst + 1] = image.data[src + 1]
      out.data[dst + 2] = image.data[src + 2]
      out.data[dst + 3] = image.data[src + 3]
    }
  }
  return out
}

function canShiftBBox(bbox, frameSize, dx, dy) {
  return bbox.x + dx >= 0 && bbox.y + dy >= 0 && bbox.right + dx < frameSize.w && bbox.bottom + dy < frameSize.h
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function chooseReferenceFrame(groupFrames) {
  const target = {
    x: median(groupFrames.map((frame) => frame.normalized_bbox?.x)),
    y: median(groupFrames.map((frame) => frame.normalized_bbox?.y)),
    w: median(groupFrames.map((frame) => frame.normalized_bbox?.w)),
    h: median(groupFrames.map((frame) => frame.normalized_bbox?.h)),
  }
  return groupFrames.reduce((best, frame) => {
    const bbox = frame.normalized_bbox
    if (!bbox) return best
    const score = Math.abs(bbox.x - target.x) + Math.abs(bbox.y - target.y) + Math.abs(bbox.w - target.w) + Math.abs(bbox.h - target.h)
    if (!best || score < best.score) return { frame, score }
    return best
  }, null)?.frame ?? groupFrames[0]
}

function alphaAt(image, x, y) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0
  return image.data[pixelOffset(image.width, x, y) + 3]
}

function shiftedAlphaError(frame, reference, dx, dy) {
  const frameBox = frame.normalized_bbox
  const referenceBox = reference.normalized_bbox
  if (!frameBox || !referenceBox) return Number.POSITIVE_INFINITY

  const minX = Math.max(0, Math.min(referenceBox.x, frameBox.x + dx) - 1)
  const minY = Math.max(0, Math.min(referenceBox.y, frameBox.y + dy) - 1)
  const maxX = Math.min(frame.image.width - 1, Math.max(referenceBox.right, frameBox.right + dx) + 1)
  const maxY = Math.min(frame.image.height - 1, Math.max(referenceBox.bottom, frameBox.bottom + dy) + 1)
  let error = 0
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const shifted = alphaAt(frame.image, x - dx, y - dy)
      const anchor = alphaAt(reference.image, x, y)
      error += Math.abs(shifted - anchor)
    }
  }
  return error
}

function bestMicroShift(frame, reference, profile, maxShift) {
  if (!frame.normalized_bbox || frame === reference) return { dx: 0, dy: 0, error: 0, base_error: 0 }
  const baseError = shiftedAlphaError(frame, reference, 0, 0)
  let best = { dx: 0, dy: 0, error: baseError, base_error: baseError }
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      if (!dx && !dy) continue
      if (!canShiftBBox(frame.normalized_bbox, profile.frame, dx, dy)) continue
      const error = shiftedAlphaError(frame, reference, dx, dy)
      const improves = error < best.error
      const equalButSmaller = error === best.error && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy)
      if (improves || equalButSmaller) best = { dx, dy, error, base_error: baseError }
    }
  }
  return best
}

function shiftFrame(frame, dx, dy) {
  const image = translateImage(frame.image, dx, dy)
  const normalized_bbox = detectAlphaBBox(image)
  const normalized_anchor = frame.normalized_anchor
    ? { ...frame.normalized_anchor, x: frame.normalized_anchor.x + dx, y: frame.normalized_anchor.y + dy }
    : detectFootAnchor(image, normalized_bbox)
  return {
    ...frame,
    image,
    normalized_bbox,
    normalized_anchor,
  }
}

function isStabilizedAnimation(animation) {
  return animation.loop !== false
}

function allowsTemplateStabilization(frame) {
  return frame.source_meta?.template_motion?.stabilizable !== false
}

export function stabilizeAnimationGroups(frames, profile, options = {}) {
  const enabled = options.enabled !== false
  if (!enabled) {
    return { enabled, applied_count: 0, corrections: [], frames }
  }

  const maxShift = Math.max(0, Math.min(4, Math.round(options.maxShift ?? profile.thresholds?.onionSkinDriftPx ?? 2)))
  const lockedAnimations = new Set((options.lockedAnimations ?? options.locked_animations ?? []).map(String))
  if (!maxShift) {
    return { enabled, applied_count: 0, corrections: [], frames }
  }

  const byIndex = new Map(frames.map((frame, order) => [frame.index, { frame, order }]))
  const nextFrames = frames.map((frame) => ({ ...frame, motion_stabilization: { applied: false } }))
  const corrections = []

  for (const animation of profile.animations.filter(isStabilizedAnimation)) {
    const entries = getAnimationFrameIndexes(animation.name, profile)
      .map((index) => byIndex.get(index))
      .filter(Boolean)
    const groupFrames = entries.map((entry) => nextFrames[entry.order]).filter((frame) => frame.normalized_bbox)
    if (groupFrames.length < 2) continue
    if (lockedAnimations.has(animation.name)) {
      for (const entry of entries) {
        nextFrames[entry.order] = {
          ...nextFrames[entry.order],
          motion_stabilization: { applied: false, reason: 'locked_animation', animation: animation.name },
        }
      }
      continue
    }
    if (groupFrames.some((frame) => !allowsTemplateStabilization(frame))) continue

    const reference = chooseReferenceFrame(groupFrames)
    for (const entry of entries) {
      const frame = nextFrames[entry.order]
      if (!frame.normalized_bbox || frame === reference) continue
      const shift = bestMicroShift(frame, reference, profile, maxShift)
      if (!shift.dx && !shift.dy) continue
      if (shift.error >= shift.base_error) continue

      const shifted = shiftFrame(frame, shift.dx, shift.dy)
      const correction = {
        frame: frame.index,
        animation: animation.name,
        dx: shift.dx,
        dy: shift.dy,
        base_error: shift.base_error,
        after_error: shift.error,
        reference_frame: reference.index,
      }
      corrections.push(correction)
      nextFrames[entry.order] = {
        ...shifted,
        motion_stabilization: { applied: true, dx: shift.dx, dy: shift.dy, animation: animation.name, reference_frame: reference.index },
      }
    }
  }

  return {
    enabled,
    applied_count: corrections.length,
    corrections,
    frames: nextFrames,
  }
}
