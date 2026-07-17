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
  return (
    bbox.x + dx > 0 &&
    bbox.y + dy > 0 &&
    bbox.right + dx < profile.frame.w - 1 &&
    bbox.bottom + dy < profile.frame.h - 1
  )
}

function frameCorrectionDelta(frame, profile) {
  const bbox = frame.normalized_bbox
  if (!bbox) return { dx: 0, dy: 0 }
  const anchor = frame.normalized_anchor ?? { x: bbox.centerX, y: bbox.bottom }
  const centerDrift = profile.anchor.x - anchor.x
  const baselineDrift = profile.anchor.y - anchor.y
  return {
    dx: Math.abs(centerDrift) > profile.thresholds.anchorDriftPx ? Math.round(centerDrift) : 0,
    dy: Math.abs(baselineDrift) > profile.thresholds.baselineDriftPx ? Math.round(baselineDrift) : 0,
  }
}

export function autoCorrectNormalizedFrames(frames, profile, options = {}) {
  const enabled = options.enabled !== false
  if (!enabled) {
    return { enabled, applied_count: 0, corrections: [], frames }
  }

  const corrections = []
  const correctedFrames = frames.map((frame) => {
    const bbox = frame.normalized_bbox
    if (!bbox) return { ...frame, auto_correction: { applied: false, reason: 'empty_frame' } }

    const { dx, dy } = frameCorrectionDelta(frame, profile)
    if (!dx && !dy) return { ...frame, auto_correction: { applied: false } }
    if (!canShiftBBox(bbox, profile, dx, dy)) {
      return { ...frame, auto_correction: { applied: false, reason: 'would_crop', dx, dy } }
    }

    const image = translateImage(frame.image, dx, dy)
    const normalized_bbox = detectAlphaBBox(image)
    const normalized_anchor = frame.normalized_anchor
      ? { ...frame.normalized_anchor, x: frame.normalized_anchor.x + dx, y: frame.normalized_anchor.y + dy }
      : detectFootAnchor(image, normalized_bbox)
    const correction = {
      frame: frame.index,
      dx,
      dy,
      before_bbox: bbox,
      after_bbox: normalized_bbox,
      before_anchor: frame.normalized_anchor ?? null,
      after_anchor: normalized_anchor,
    }
    corrections.push(correction)
    return {
      ...frame,
      image,
      normalized_bbox,
      normalized_anchor,
      auto_correction: { applied: true, dx, dy },
    }
  })

  return {
    enabled,
    applied_count: corrections.length,
    corrections,
    frames: correctedFrames,
  }
}
