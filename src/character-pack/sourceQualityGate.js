import { pixelOffset } from './imageMath.js'
import { detectAlphaBBox } from './normalizer.js'
import { describeOcadRegionKey, isFixedRegionMotionLayout } from './sourceLayouts.js'

const EXPECTED_MOTION_ACTIONS = new Set([
  'walkdown',
  'walkup',
  'walkL',
  'rundown',
  'runup',
  'runL',
  'climb',
  'attractL',
  'jump',
  'item',
])

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function scaledRegion(region, image, layout) {
  const scaleX = image.width / layout.sheet.w
  const scaleY = image.height / layout.sheet.h
  const x = Math.round(region.x * scaleX)
  const y = Math.round(region.y * scaleY)
  const right = Math.round((region.x + region.w) * scaleX)
  const bottom = Math.round((region.y + region.h) * scaleY)
  return {
    x: Math.max(0, Math.min(image.width - 1, x)),
    y: Math.max(0, Math.min(image.height - 1, y)),
    w: Math.max(1, Math.min(image.width - x, right - x)),
    h: Math.max(1, Math.min(image.height - y, bottom - y)),
  }
}

function copyRegion(image, region) {
  const out = { width: region.w, height: region.h, data: new Uint8ClampedArray(region.w * region.h * 4) }
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const src = pixelOffset(image.width, region.x + x, region.y + y)
      const dst = pixelOffset(out.width, x, y)
      out.data[dst] = image.data[src]
      out.data[dst + 1] = image.data[src + 1]
      out.data[dst + 2] = image.data[src + 2]
      out.data[dst + 3] = image.data[src + 3]
    }
  }
  return out
}

function visibleMetrics(image) {
  let visiblePixelCount = 0
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] > 0) visiblePixelCount++
  }
  return {
    visible_pixel_count: visiblePixelCount,
    occupancy_ratio: round(visiblePixelCount / (image.width * image.height)),
  }
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
    return image.data[pixelOffset(image.width, nx, ny) + 3] === 0
  })
}

function backgroundResidueMetrics(image, visiblePixelCount) {
  let nearWhiteEdgePixels = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] === 0) continue
      const nearWhite = image.data[offset] >= 240 && image.data[offset + 1] >= 240 && image.data[offset + 2] >= 240
      if (nearWhite && hasTransparentNeighbor(image, x, y)) nearWhiteEdgePixels++
    }
  }
  return {
    near_white_edge_pixels: nearWhiteEdgePixels,
    halo_score: visiblePixelCount ? round(nearWhiteEdgePixels / visiblePixelCount) : 0,
    passed: nearWhiteEdgePixels === 0,
  }
}

function edgePressureMetrics(regionImage, bbox, { warningMarginPx, severeMarginPx }) {
  if (!bbox) {
    return {
      passed: true,
      severity: 'none',
      min_margin: null,
      margins: null,
      edges: [],
    }
  }
  const margins = {
    left: bbox.x,
    top: bbox.y,
    right: regionImage.width - 1 - bbox.right,
    bottom: regionImage.height - 1 - bbox.bottom,
  }
  const minMargin = Math.min(margins.left, margins.top, margins.right, margins.bottom)
  const severity = minMargin <= severeMarginPx ? 'severe' : minMargin <= warningMarginPx ? 'warning' : 'none'
  const threshold = severity === 'severe' ? severeMarginPx : warningMarginPx
  return {
    passed: severity === 'none',
    severity,
    min_margin: minMargin,
    margins,
    edges: severity === 'none'
      ? []
      : Object.entries(margins).filter(([, value]) => value <= threshold).map(([edge]) => edge),
  }
}

function hashImage(image) {
  let hash = 2166136261
  for (const byte of image.data) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function meanRegionDelta(a, b) {
  const length = Math.min(a.data.length, b.data.length)
  if (!length) return 0
  let total = 0
  for (let i = 0; i < length; i++) total += Math.abs(a.data[i] - b.data[i])
  return round(total / length)
}

function motionReportForAction(action, entries, { minMeanDelta }) {
  const expectedMotion = EXPECTED_MOTION_ACTIONS.has(action) && entries.length > 1
  const hashes = entries.map((entry) => entry.hash)
  const uniqueFrameHashCount = new Set(hashes).size
  const deltas = entries.slice(1).map((entry, index) => meanRegionDelta(entries[index].image, entry.image))
  const meanDelta = deltas.length ? round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : 0
  const passed = !expectedMotion || (uniqueFrameHashCount >= 2 && meanDelta >= minMeanDelta)
  return {
    action,
    expected_motion: expectedMotion,
    region_keys: entries.map((entry) => entry.region_key),
    frame_count: entries.length,
    unique_frame_hash_count: uniqueFrameHashCount,
    mean_delta: meanDelta,
    min_delta: deltas.length ? Math.min(...deltas) : 0,
    passed,
  }
}

function buildActionMotionReport(regionEntries, options) {
  const byAction = new Map()
  for (const entry of regionEntries) {
    const group = byAction.get(entry.action) ?? []
    group.push(entry)
    byAction.set(entry.action, group)
  }

  const actions = [...byAction.entries()]
    .map(([action, entries]) => motionReportForAction(action, entries, options))
    .sort((a, b) => a.action.localeCompare(b.action))
  return {
    actions,
    expected_static_reuse: actions.filter((item) => !item.expected_motion),
    duplicate_motion_actions: actions.filter((item) => item.expected_motion && !item.passed).map((item) => item.action),
  }
}

function layoutAlignment(image, sourceLayout) {
  const expectedSize = sourceLayout.sheet
  const outOfBounds = []
  for (const [key, region] of Object.entries(sourceLayout.regions)) {
    if (region.x < 0 || region.y < 0 || region.x + region.w > expectedSize.w || region.y + region.h > expectedSize.h) {
      outOfBounds.push(key)
    }
  }
  const exactSizeMatch = image.width === expectedSize.w && image.height === expectedSize.h
  return {
    expected_size: { w: expectedSize.w, h: expectedSize.h },
    actual_size: { w: image.width, h: image.height },
    scale: { x: round(image.width / expectedSize.w), y: round(image.height / expectedSize.h) },
    exact_size_match: exactSizeMatch,
    out_of_bounds_regions: outOfBounds,
    passed: exactSizeMatch && outOfBounds.length === 0,
  }
}

export function evaluateFixedRegionSourceQuality(image, sourceLayout, options = {}) {
  if (!image?.data || !isFixedRegionMotionLayout(sourceLayout)) return null
  const minOccupancyRatio = Number.isFinite(options.minOccupancyRatio) ? options.minOccupancyRatio : 0.01
  const haloScoreThreshold = Number.isFinite(options.haloScoreThreshold) ? options.haloScoreThreshold : 0.01
  const warningMarginPx = Number.isFinite(options.warningMarginPx) ? options.warningMarginPx : 1
  const severeMarginPx = Number.isFinite(options.severeMarginPx) ? options.severeMarginPx : 0
  const minMeanDelta = Number.isFinite(options.minMeanDelta) ? options.minMeanDelta : 0.1

  const blockingErrors = []
  const warnings = []
  const motionEntries = []
  const regions = Object.entries(sourceLayout.regions).map(([key, sourceRegion]) => {
    const description = describeOcadRegionKey(key)
    const rect = scaledRegion(sourceRegion, image, sourceLayout)
    const regionImage = copyRegion(image, rect)
    const bbox = detectAlphaBBox(regionImage)
    const visible = visibleMetrics(regionImage)
    const occupancy = {
      ...visible,
      min_ratio: minOccupancyRatio,
      passed: visible.visible_pixel_count > 0 && visible.occupancy_ratio >= minOccupancyRatio,
    }
    const backgroundResidue = backgroundResidueMetrics(regionImage, visible.visible_pixel_count)
    const edgePressure = edgePressureMetrics(regionImage, bbox, { warningMarginPx, severeMarginPx })

    if (visible.visible_pixel_count === 0) blockingErrors.push(`source_region_empty:${key}`)
    else if (!occupancy.passed) warnings.push(`source_region_low_occupancy:${key}`)
    if (backgroundResidue.halo_score > haloScoreThreshold) warnings.push(`source_region_halo:${key}`)
    if (!edgePressure.passed) warnings.push(`source_region_edge_pressure:${key}`)

    motionEntries.push({
      region_key: key,
      action: description.action,
      image: regionImage,
      hash: hashImage(regionImage),
    })

    return {
      region_key: key,
      action: description.action,
      frame: description.frame,
      label: description.display_label,
      rect,
      bbox: bbox ? { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, right: bbox.right, bottom: bbox.bottom } : null,
      occupancy,
      visible_bounds: bbox ? { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, right: bbox.right, bottom: bbox.bottom } : null,
      edge_pressure: edgePressure,
      background_residue: backgroundResidue,
    }
  })

  const actionMotion = buildActionMotionReport(motionEntries, { minMeanDelta })
  for (const action of actionMotion.duplicate_motion_actions) warnings.push(`source_action_low_motion:${action}`)

  const alignment = layoutAlignment(image, sourceLayout)
  if (!alignment.passed) warnings.push('source_layout_alignment_mismatch')

  const uniqueWarnings = [...new Set(warnings)]
  const uniqueBlockingErrors = [...new Set(blockingErrors)]
  const status = uniqueBlockingErrors.length ? 'fail' : uniqueWarnings.length ? 'warning' : 'pass'
  const emptyRegions = regions.filter((region) => region.occupancy.visible_pixel_count === 0)
  const lowOccupancyRegions = regions.filter((region) => region.occupancy.visible_pixel_count > 0 && !region.occupancy.passed)
  const haloRegions = regions.filter((region) => !region.background_residue.passed)
  const edgePressureRegions = regions.filter((region) => !region.edge_pressure.passed)
  const severeEdgePressureRegions = regions.filter((region) => region.edge_pressure.severity === 'severe')

  return {
    mode: 'fixed_region_source_quality_v1',
    source_layout: sourceLayout.id,
    status,
    blocking_errors: uniqueBlockingErrors,
    warnings: uniqueWarnings,
    layout_alignment: alignment,
    summary: {
      region_count: regions.length,
      empty_region_count: emptyRegions.length,
      low_occupancy_region_count: lowOccupancyRegions.length,
      halo_region_count: haloRegions.length,
      edge_pressure_region_count: edgePressureRegions.length,
      edge_pressure_severe_region_count: severeEdgePressureRegions.length,
      expected_static_action_count: actionMotion.expected_static_reuse.length,
      duplicate_motion_action_count: actionMotion.duplicate_motion_actions.length,
    },
    action_motion: actionMotion,
    regions,
  }
}
