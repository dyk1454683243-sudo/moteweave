import { pixelOffset } from '../character-pack/imageMath.js'
import { detectAlphaBBox } from '../character-pack/normalizer.js'

const DEFAULT_THRESHOLDS = {
  max_palette_delta: 42,
  max_silhouette_ratio_delta: 0.16,
  max_bbox_delta_ratio: 0.28,
  max_baseline_delta_px: 5,
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function assertRgbaImage(image, name) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error(`invalid_${name}`)
  }
  if (!image.data || image.data.length !== image.width * image.height * 4) throw new Error(`invalid_${name}`)
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function resolveImage(entry) {
  return entry?.image ?? entry?.strip ?? entry
}

function resolveCellSize(entry, image) {
  const tuple = entry?.frame_size ?? entry?.normalized_cell
  if (Array.isArray(tuple) && tuple.length === 2 && tuple.every(positiveInteger)) {
    if (image.width % tuple[0] !== 0 || image.height !== tuple[1]) throw new Error('invalid_strip_cell_size')
    return { w: tuple[0], h: tuple[1], count: image.width / tuple[0] }
  }
  if (positiveInteger(entry?.target_frame_count) && image.width % entry.target_frame_count === 0) {
    return { w: image.width / entry.target_frame_count, h: image.height, count: entry.target_frame_count }
  }
  if (image.width % image.height === 0) return { w: image.height, h: image.height, count: image.width / image.height }
  throw new Error('invalid_strip_cell_size')
}

function copyFrameCell(image, cell, index) {
  const frame = { width: cell.w, height: cell.h, data: new Uint8ClampedArray(cell.w * cell.h * 4) }
  const sourceX = index * cell.w
  for (let y = 0; y < cell.h; y += 1) {
    for (let x = 0; x < cell.w; x += 1) {
      const src = pixelOffset(image.width, sourceX + x, y)
      const dst = pixelOffset(frame.width, x, y)
      frame.data[dst] = image.data[src]
      frame.data[dst + 1] = image.data[src + 1]
      frame.data[dst + 2] = image.data[src + 2]
      frame.data[dst + 3] = image.data[src + 3]
    }
  }
  return frame
}

function dominantColor(frames) {
  const buckets = new Map()
  let total = 0
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const offset = pixelOffset(frame.width, x, y)
        const alpha = frame.data[offset + 3]
        if (!alpha) continue
        total += alpha
        const key = [
          Math.round(frame.data[offset] / 8) * 8,
          Math.round(frame.data[offset + 1] / 8) * 8,
          Math.round(frame.data[offset + 2] / 8) * 8,
        ].join(',')
        buckets.set(key, (buckets.get(key) ?? 0) + alpha)
      }
    }
  }
  let bestKey = '0,0,0'
  let bestWeight = -1
  for (const [key, weight] of buckets.entries()) {
    if (weight <= bestWeight) continue
    bestKey = key
    bestWeight = weight
  }
  const rgb = bestKey.split(',').map(Number)
  return {
    rgb,
    share: total ? round(bestWeight / total) : 0,
  }
}

function colorDistance(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function summarizeStrip(entry) {
  const image = resolveImage(entry)
  assertRgbaImage(image, 'identity_strip')
  const cell = resolveCellSize(entry, image)
  const frames = Array.from({ length: cell.count }, (_, index) => copyFrameCell(image, cell, index))
  const frameMeasures = frames.map((frame) => {
    const box = detectAlphaBBox(frame)
    if (!box) return { box: null, visible_pixels: 0, bbox_area: 0 }
    let count = 0
    for (let y = box.y; y <= box.bottom; y += 1) {
      for (let x = box.x; x <= box.right; x += 1) {
        if (frame.data[pixelOffset(frame.width, x, y) + 3] > 0) count += 1
      }
    }
    return { box, visible_pixels: count, bbox_area: box.w * box.h }
  })
  const boxes = frameMeasures.map((measure) => measure.box).filter(Boolean)
  const visiblePixels = frameMeasures.reduce((sum, measure) => sum + measure.visible_pixels, 0)
  const bboxArea = frameMeasures.reduce((sum, measure) => sum + measure.bbox_area, 0)
  const averages = boxes.length
    ? {
      bbox_width: boxes.reduce((sum, box) => sum + box.w, 0) / boxes.length,
      bbox_height: boxes.reduce((sum, box) => sum + box.h, 0) / boxes.length,
      baseline_y: boxes.reduce((sum, box) => sum + box.bottom, 0) / boxes.length,
      silhouette_ratio: bboxArea ? visiblePixels / bboxArea : 0,
    }
    : {
      bbox_width: 0,
      bbox_height: 0,
      baseline_y: 0,
      silhouette_ratio: 0,
    }
  return {
    id: entry?.id ?? entry?.runtime_action ?? 'strip',
    runtime_action: entry?.runtime_action ?? entry?.id ?? 'strip',
    facing_direction: entry?.facing_direction ?? null,
    frame_count: cell.count,
    cell_size: { w: cell.w, h: cell.h },
    visible_frame_count: boxes.length,
    dominant_palette: dominantColor(frames),
    bbox_width: round(averages.bbox_width, 4),
    bbox_height: round(averages.bbox_height, 4),
    baseline_y: round(averages.baseline_y, 4),
    silhouette_ratio: round(averages.silhouette_ratio, 6),
  }
}

function findAnchor(summaries, identityAnchor = {}) {
  if (identityAnchor?.source_id) {
    const found = summaries.find((summary) => summary.id === identityAnchor.source_id || summary.runtime_action === identityAnchor.source_id)
    if (found) return found
  }
  return summaries[0] ?? null
}

function ratioDelta(a, b) {
  const denominator = Math.max(1, Math.abs(a))
  return Math.abs(a - b) / denominator
}

function compareToAnchor(summary, anchor, identityAnchor, thresholds) {
  const metrics = {
    palette_delta: round(colorDistance(summary.dominant_palette.rgb, anchor.dominant_palette.rgb), 4),
    silhouette_ratio_delta: round(Math.abs(summary.silhouette_ratio - anchor.silhouette_ratio), 6),
    bbox_width_delta_ratio: round(ratioDelta(anchor.bbox_width, summary.bbox_width), 6),
    bbox_height_delta_ratio: round(ratioDelta(anchor.bbox_height, summary.bbox_height), 6),
    baseline_delta_px: round(Math.abs(summary.baseline_y - anchor.baseline_y), 4),
  }
  const failures = []
  if (metrics.palette_delta > thresholds.max_palette_delta) failures.push('palette_delta_exceeded')
  if (metrics.silhouette_ratio_delta > thresholds.max_silhouette_ratio_delta) failures.push('silhouette_ratio_delta_exceeded')
  if (metrics.bbox_width_delta_ratio > thresholds.max_bbox_delta_ratio) failures.push('bbox_width_delta_exceeded')
  if (metrics.bbox_height_delta_ratio > thresholds.max_bbox_delta_ratio) failures.push('bbox_height_delta_exceeded')
  if (metrics.baseline_delta_px > thresholds.max_baseline_delta_px) failures.push('baseline_delta_exceeded')

  const expectedDirection = identityAnchor?.facing_direction ?? anchor.facing_direction
  let directionCheck = { status: 'not_provided', expected: expectedDirection ?? null, actual: summary.facing_direction ?? null }
  if (expectedDirection && summary.facing_direction) {
    directionCheck = {
      status: expectedDirection === summary.facing_direction ? 'pass' : 'mismatch',
      expected: expectedDirection,
      actual: summary.facing_direction,
    }
    if (directionCheck.status === 'mismatch') failures.push('direction_mismatch')
  }

  return {
    id: summary.id,
    runtime_action: summary.runtime_action,
    status: failures.length ? 'fail' : 'pass',
    metrics,
    direction_check: directionCheck,
    failures,
    summary,
  }
}

export function evaluateIdentityConsistency(strips, { identityAnchor, thresholds } = {}) {
  if (!Array.isArray(strips) || strips.length < 1) throw new Error('identity_strips_required')
  const resolvedThresholds = { ...DEFAULT_THRESHOLDS, ...(thresholds ?? {}) }
  const summaries = strips.map((strip) => summarizeStrip(strip))
  const anchor = findAnchor(summaries, identityAnchor)
  if (!anchor) throw new Error('identity_anchor_not_found')
  const perStrip = summaries.map((summary) => compareToAnchor(summary, anchor, identityAnchor, resolvedThresholds))
  const warnings = []
  if (perStrip.some((item) => item.summary.visible_frame_count < item.summary.frame_count)) warnings.push('empty_identity_frames_detected')
  const blockingErrors = perStrip
    .filter((item) => item.status === 'fail')
    .map((item) => `identity_mismatch:${item.runtime_action}`)

  return {
    schema_version: 1,
    mode: 'identity_consistency_report_v1',
    status: blockingErrors.length ? 'fail' : 'pass',
    can_apply_multi_strip: blockingErrors.length === 0,
    identity_anchor: {
      id: anchor.id,
      runtime_action: anchor.runtime_action,
      facing_direction: identityAnchor?.facing_direction ?? anchor.facing_direction ?? null,
    },
    thresholds: resolvedThresholds,
    metrics: {
      anchor_summary: anchor,
      strip_count: summaries.length,
    },
    warnings,
    blocking_errors: blockingErrors,
    per_strip: perStrip,
  }
}
