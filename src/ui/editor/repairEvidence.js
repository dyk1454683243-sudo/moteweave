const VALIDATION_STATUSES = new Set(['pass', 'warning', 'fail'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.length > 0)
    : []
}

function unique(values) {
  return [...new Set(values)]
}

function metric(value, missingMetrics, name, valid) {
  if (!valid(value)) {
    missingMetrics.push(name)
    return null
  }
  return value
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function unitRatio(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function validFrameIndex(value) {
  return Number.isInteger(value) && value >= 0
}

function frameAdjustment(value) {
  return isRecord(value) && value.applied === false && value.reason === 'would_crop' &&
    Number.isInteger(value.dx) && value.dx >= -16 && value.dx <= 16 &&
    Number.isInteger(value.dy) && value.dy >= -16 && value.dy <= 16
}

function optionalRecord(value, missingMetrics, name, valid = isRecord) {
  if (!valid(value)) {
    missingMetrics.push(name)
    return null
  }
  return value
}

function point(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function bbox(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.w) && value.w > 0 && Number.isFinite(value.h) && value.h > 0
}

function cleanupReport(value) {
  return isRecord(value) && nonnegativeInteger(value.removed_components)
}

function anchorReport(value) {
  return isRecord(value) && (point(value.effective_anchor) || point(value.base_anchor))
}

function motionReport(value) {
  return isRecord(value) && nonnegativeInteger(value.applied_count)
}

function stagingReport(value) {
  return isRecord(value) && typeof value.applied === 'boolean'
}

export function normalizeRepairEvidence(input = {}) {
  const report = isRecord(input) ? input : {}
  const style = isRecord(report.pixel_style) ? report.pixel_style : {}
  const validation = isRecord(report.validation) ? report.validation : {}
  const normalization = isRecord(report.normalization) ? report.normalization : {}
  const manual = isRecord(normalization.manual_adjustments) ? normalization.manual_adjustments : {}
  const frames = Array.isArray(report.frames) ? report.frames.filter(isRecord) : []
  const missingMetrics = []

  const rawStyleMetrics = isRecord(style.metrics) ? style.metrics : {}
  const styleMetrics = isRecord(rawStyleMetrics.after) ? rawStyleMetrics.after : rawStyleMetrics
  const halo = isRecord(style.halo_residue) ? style.halo_residue : {}
  const haloBeforeReport = isRecord(halo.before) ? halo.before : {}
  const haloAfterReport = isRecord(halo.after) ? halo.after : {}
  const paletteSnap = isRecord(style.palette_snap) ? style.palette_snap : {}
  const outline = isRecord(style.outline) ? style.outline : {}

  const categoryIds = Array.isArray(validation.failure_taxonomy?.categories)
    ? validation.failure_taxonomy.categories
      .filter(isRecord)
      .map((item) => item.id)
      .filter((id) => typeof id === 'string' && id.length > 0)
    : []
  const blockingErrors = stringList(validation.blocking_errors)

  const framesByIndex = {}
  for (const frame of frames) {
    if (!validFrameIndex(frame.index) || Object.hasOwn(framesByIndex, String(frame.index))) continue
    framesByIndex[String(frame.index)] = {
      bbox: bbox(frame.normalized_bbox) ? frame.normalized_bbox : null,
      anchor: point(frame.normalized_anchor) ? frame.normalized_anchor : null,
      warnings: stringList(frame.warnings),
    }
  }
  const wouldCrop = frames
    .filter((frame) => validFrameIndex(frame.index) && frameAdjustment(frame.manual_adjustment))
    .map((frame) => ({
      frame: frame.index,
      dx: frame.manual_adjustment.dx,
      dy: frame.manual_adjustment.dy,
      reason: 'would_crop',
    }))

  const normalizationCleanup = cleanupReport(report.component_cleanup) ? report.component_cleanup : null
  const pixelFinishingCleanup = cleanupReport(style.component_cleanup) ? style.component_cleanup : null
  const componentCleanup = optionalRecord(
    pixelFinishingCleanup ?? normalizationCleanup,
    missingMetrics,
    'component_cleanup',
    cleanupReport,
  )
  const anchor = optionalRecord(report.anchor_tuning, missingMetrics, 'anchor_tuning', anchorReport)
  const baselineValue = Number.isFinite(anchor?.effective_anchor?.y)
    ? anchor.effective_anchor.y
    : Number.isFinite(anchor?.base_anchor?.y)
      ? anchor.base_anchor.y
      : null
  const baseline = metric(baselineValue, missingMetrics, 'baseline', Number.isFinite)
  const motionStabilization = optionalRecord(
    normalization.motion_stabilization,
    missingMetrics,
    'motion_stabilization',
    motionReport,
  )
  if (isRecord(normalization.motion_stabilization) && !motionStabilization) {
    missingMetrics.push('motion_stabilization_applied_count')
  }
  const sourceStaging = optionalRecord(report.source_staging, missingMetrics, 'source_staging', stagingReport)

  return {
    validationStatus: VALIDATION_STATUSES.has(validation.status) ? validation.status : 'unknown',
    failureTaxonomy: unique([...categoryIds, ...blockingErrors]),
    uniqueColors: metric(
      styleMetrics.unique_color_count,
      missingMetrics,
      'unique_color_count',
      nonnegativeInteger,
    ),
    paletteChangedRatio: metric(
      paletteSnap.changed_pixel_ratio ?? style.changed_pixel_ratio,
      missingMetrics,
      'palette_changed_pixel_ratio',
      unitRatio,
    ),
    haloBefore: metric(
      haloBeforeReport.near_white_edge_pixels,
      missingMetrics,
      'halo_before',
      nonnegativeInteger,
    ),
    haloAfter: metric(
      haloAfterReport.near_white_edge_pixels,
      missingMetrics,
      'halo_after',
      nonnegativeInteger,
    ),
    residueBefore: metric(
      haloBeforeReport.semi_transparent_edge_pixels,
      missingMetrics,
      'residue_before',
      nonnegativeInteger,
    ),
    residueAfter: metric(
      haloAfterReport.semi_transparent_edge_pixels,
      missingMetrics,
      'residue_after',
      nonnegativeInteger,
    ),
    outlineRatio: metric(
      outline.outline_pixel_ratio,
      missingMetrics,
      'outline_ratio',
      unitRatio,
    ),
    componentCleanup,
    componentCleanupStages: {
      normalization: normalizationCleanup,
      pixelFinishing: pixelFinishingCleanup,
    },
    anchor,
    baseline,
    motionStabilization,
    sourceStaging,
    framesByIndex,
    manualAdjustments: { ...manual, wouldCrop },
    warnings: unique([
      ...stringList(validation.warnings),
      ...stringList(report.background_warnings),
    ]),
    missingMetrics: unique(missingMetrics).map((name) => ({
      code: 'metric_unavailable',
      metric: name,
    })),
  }
}
