import { classifyValidationMessages } from './failureTaxonomy.js'
import { resolveBackgroundOptions } from './processingOptions.js'
import { buildCharacterQualityClosure } from './qualityClosureGate.js'
import { canonicalSourceLayoutId, isFixedRegionMotionLayoutId } from './sourceLayouts.js'
import { validateNormalizedFrames } from './validator.js'

export function buildValidationStage({ frames, profile, sourceRegionEdgePressure, sourceQualityReport, backgroundWarnings = [] } = {}) {
  const rawValidation = validateNormalizedFrames(frames, profile)
  const runtimeEdgeRisk =
    rawValidation.warnings.includes('edge_pressure_high') ||
    rawValidation.blocking_errors.some((message) => /^frame_\d+_cropped$/.test(message))
  const sourceLayoutWarnings =
    sourceRegionEdgePressure?.passed === false && runtimeEdgeRisk ? ['source_region_edge_pressure_high'] : []
  const sourceQualityWarnings = sourceQualityReport?.warnings ?? []
  const sourceQualityBlockingErrors = sourceQualityReport?.blocking_errors ?? []
  const combinedBlockingErrors = [...sourceQualityBlockingErrors, ...rawValidation.blocking_errors]
  const combinedWarnings = [...sourceQualityWarnings, ...rawValidation.warnings, ...sourceLayoutWarnings, ...backgroundWarnings]
  const status = combinedBlockingErrors.length ? 'fail' : rawValidation.status === 'pass' && combinedWarnings.length ? 'warning' : rawValidation.status
  const validation = {
    ...rawValidation,
    status,
    blocking_errors: combinedBlockingErrors,
    warnings: combinedWarnings,
    metrics: {
      ...rawValidation.metrics,
      ...(sourceRegionEdgePressure ? { source_region_edge_pressure: sourceRegionEdgePressure } : {}),
      ...(sourceQualityReport ? { source_quality: sourceQualityReport.summary } : {}),
    },
    dual_matte_inconsistent: backgroundWarnings.includes('dual_matte_inconsistent'),
  }
  validation.failure_taxonomy = classifyValidationMessages(validation)
  return { rawValidation, validation }
}

export function buildFrameSourceReport(frame) {
  const meta = frame.source_meta
  if (!meta) return null
  if (isFixedRegionMotionLayoutId(meta.source_layout)) {
    return {
      layout: canonicalSourceLayoutId(meta.source_layout),
      action: meta.source_action,
      label: meta.source_action_label,
      zh: meta.source_action_zh,
      frame: meta.source_frame,
      region_key: meta.source_region_key,
      display_label: meta.source_display_label,
      flip_h: meta.flip_h,
      template_anchor: meta.template_anchor,
      template_motion: meta.template_motion,
      rect: { x: meta.x, y: meta.y, w: meta.w, h: meta.h },
    }
  }
  return {
    layout: meta.source_layout ?? 'topdown_rpg_v0',
    row: meta.row,
    col: meta.col,
    rect: { x: meta.x, y: meta.y, w: meta.w, h: meta.h },
  }
}

export function buildDebugReport({
  profile,
  sourceLayoutSummary,
  sourceRegionEdgePressure,
  sourceQualityReport,
  sourceStagingReport,
  sourcePreprocessReport,
  grid,
  fixedSource,
  options = {},
  background,
  componentCleanup,
  anchorOffset,
  baseProfile,
  normalized,
  autoCorrection,
  lockedAnimations,
  motionStabilization,
  manualAdjustments,
  validation,
  frames,
  pixelStyleReport,
  inspectionPreview,
} = {}) {
  return {
    version: profile.version,
    profile: profile.id,
    source_layout: {
      ...sourceLayoutSummary,
      edge_pressure: sourceRegionEdgePressure,
    },
    source_quality: sourceQualityReport,
    source_staging: sourceStagingReport,
    source_preprocess: sourcePreprocessReport,
    grid: {
      columns: profile.grid.columns,
      rows: profile.grid.rows,
      source_cell_size: grid.columns[0] && grid.rows[0] ? { w: grid.columns[0].w, h: grid.rows[0].h } : fixedSource?.cells?.[0]?.meta ? { w: fixedSource.cells[0].meta.w, h: fixedSource.cells[0].meta.h } : null,
      target_cell_size: profile.frame,
      correction: grid.correction ?? { applied: false, rows_corrected: [], columns_corrected: [], method: null },
      fixed_regions: grid.fixed_regions,
      manual_overrides: options.manualOverrides ?? [],
    },
    requested_background_mode: options.backgroundMode ?? 'auto',
    background_mode: background.mode,
    background_options: background.options ?? resolveBackgroundOptions(options),
    background_selection: background.selection ?? null,
    background_warnings: background.warnings,
    component_cleanup: componentCleanup.summary,
    anchor_tuning: {
      offset: anchorOffset,
      base_anchor: baseProfile.anchor,
      effective_anchor: profile.anchor,
    },
    normalization: {
      scale: normalized.scale,
      auto_correction: {
        enabled: autoCorrection.enabled,
        applied_count: autoCorrection.applied_count,
        corrections: autoCorrection.corrections,
      },
      motion_stabilization: {
        enabled: motionStabilization.enabled,
        locked_animations: lockedAnimations,
        applied_count: motionStabilization.applied_count,
        corrections: motionStabilization.corrections,
      },
      manual_adjustments: {
        enabled: manualAdjustments.enabled,
        requested_count: manualAdjustments.requested_count,
        applied_count: manualAdjustments.applied_count,
        corrections: manualAdjustments.corrections,
      },
    },
    ...(pixelStyleReport ? { pixel_style: pixelStyleReport } : {}),
    ...(inspectionPreview ? { inspection_preview: inspectionPreview } : {}),
    validation,
    quality_closure: buildCharacterQualityClosure({ frames, profile, validation }),
    frames: frames.map((frame) => ({
      index: frame.index,
      runtime_action: frame.source_meta?.runtime_action ?? null,
      source_frame: buildFrameSourceReport(frame),
      source_bbox: frame.source_bbox,
      source_anchor: frame.source_anchor,
      normalized_bbox: frame.normalized_bbox,
      normalized_anchor: frame.normalized_anchor,
      warnings: frame.warnings,
      auto_correction: frame.auto_correction,
      motion_stabilization: frame.motion_stabilization,
      manual_adjustment: frame.manual_adjustment,
    })),
  }
}
