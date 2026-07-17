import { pixelOffset } from './imageMath.js'
import { detectAlphaBBox, detectFootAnchor } from './normalizer.js'

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

function canShiftBBox(bbox, profile, dx, dy) {
  return bbox.x + dx >= 0 && bbox.y + dy >= 0 && bbox.right + dx < profile.frame.w && bbox.bottom + dy < profile.frame.h
}

function clampAdjustment(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(-16, Math.min(16, Math.round(number)))
}

function normalizeAdjustments(adjustments) {
  if (!adjustments) return []
  if (Array.isArray(adjustments)) return adjustments
  return Object.entries(adjustments).map(([frame, value]) => ({ frame: Number(frame), ...value }))
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

export function applyManualFrameAdjustments(frames, profile, options = {}) {
  const adjustments = normalizeAdjustments(options.adjustments)
    .map((item) => ({
      frame: Number(item.frame ?? item.index),
      dx: clampAdjustment(item.dx),
      dy: clampAdjustment(item.dy),
    }))
    .filter((item) => Number.isInteger(item.frame) && (item.dx || item.dy))

  const byFrame = new Map(adjustments.map((item) => [item.frame, item]))
  const corrections = []
  const nextFrames = frames.map((frame) => {
    const adjustment = byFrame.get(frame.index)
    if (!adjustment) return { ...frame, manual_adjustment: { applied: false } }
    if (!frame.normalized_bbox) {
      return { ...frame, manual_adjustment: { applied: false, reason: 'empty_frame', dx: adjustment.dx, dy: adjustment.dy } }
    }
    if (!canShiftBBox(frame.normalized_bbox, profile, adjustment.dx, adjustment.dy)) {
      return { ...frame, manual_adjustment: { applied: false, reason: 'would_crop', dx: adjustment.dx, dy: adjustment.dy } }
    }
    const shifted = shiftFrame(frame, adjustment.dx, adjustment.dy)
    const correction = {
      frame: frame.index,
      dx: adjustment.dx,
      dy: adjustment.dy,
      before_bbox: frame.normalized_bbox,
      after_bbox: shifted.normalized_bbox,
      before_anchor: frame.normalized_anchor ?? null,
      after_anchor: shifted.normalized_anchor ?? null,
    }
    corrections.push(correction)
    return {
      ...shifted,
      manual_adjustment: { applied: true, dx: adjustment.dx, dy: adjustment.dy },
    }
  })

  return {
    enabled: true,
    requested_count: adjustments.length,
    applied_count: corrections.length,
    corrections,
    frames: nextFrames,
  }
}
