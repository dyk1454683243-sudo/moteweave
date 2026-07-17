import {
  canonicalSourceLayoutId,
  isFixedRegionMotionLayoutId,
  SOURCE_LAYOUTS,
} from './sourceLayouts.js'
import {
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
} from './textToImagePrompt.js'
import {
  CHARACTER_QUALITY_CLOSURE_GATE_IDS,
  CHARACTER_QUALITY_CLOSURE_MODE,
} from './qualityClosureGate.js'

export const GENERATION_RELEASE_GATE_MODE = 'generation_release_gate_v1'

export const QUALITY_CHARACTER_RELEASE_THRESHOLDS = Object.freeze({
  usable_score: 615,
  warning_score: 600,
  target_usable_rate: 0.8,
  min_visible_pixel_count: 1000,
  min_unique_color_count: 8,
  max_palette_changed_pixel_ratio: 0.7,
  max_outline_pixel_ratio: 0.08,
  max_visible_pixel_count: 220000,
  max_bbox_width_ratio: 0.72,
  max_bbox_height_ratio: 0.86,
  max_bbox_area_ratio: 0.42,
  max_center_offset_ratio: 0.1,
  min_edge_margin_ratio: 0.035,
})

export const PRODUCTION_RELEASE_POLICY = 'strict_live_generation_v1'
export const QUALITY_CHARACTER_RELEASE_POLICY = 'golden_review_hard_thresholds_v1'

export function isCanonicalGenerationReleaseGate(gate) {
  if (!gate || typeof gate !== 'object') return false
  const policyMatchesMode =
    (gate.generation_mode === TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET && gate.policy === PRODUCTION_RELEASE_POLICY) ||
    (gate.generation_mode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER && gate.policy === QUALITY_CHARACTER_RELEASE_POLICY)
  return (
    gate.schema_version === 1 &&
    gate.mode === GENERATION_RELEASE_GATE_MODE &&
    policyMatchesMode &&
    (gate.status === 'pass' || gate.status === 'fail') &&
    typeof gate.release_ready === 'boolean' &&
    Array.isArray(gate.blocking_errors) &&
    Array.isArray(gate.warnings) &&
    gate.evidence != null &&
    typeof gate.evidence === 'object' &&
    !Array.isArray(gate.evidence)
  )
}

export function resolveGenerationArtifactDisposition(result = {}) {
  const gate = result.generationReleaseGate
  if (!gate) return null
  const releaseReady =
    isCanonicalGenerationReleaseGate(gate) &&
    gate.status === 'pass' &&
    gate.release_ready === true &&
    Array.isArray(gate.blocking_errors) &&
    gate.blocking_errors.length === 0 &&
    result.releaseReady === true &&
    result.artifactDisposition === 'release'
  return releaseReady ? 'release' : 'diagnostic_only'
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : null
}

function productionStageEvidence(stage, id, blockingErrors, warnings) {
  if (!stage || typeof stage !== 'object') {
    blockingErrors.push(`${id}.evidence_missing`)
    return {
      present: false,
      status: null,
      warnings: null,
      blocking_errors: null,
    }
  }

  const stageWarnings = stringArray(stage.warnings)
  const stageBlockingErrors = stringArray(stage.blocking_errors)
  const status = typeof stage.status === 'string' ? stage.status : null

  if (status === null) blockingErrors.push(`${id}.status_missing`)
  else if (status !== 'pass') blockingErrors.push(`${id}.status_not_pass`)

  if (stageWarnings === null) blockingErrors.push(`${id}.warnings_missing`)
  else if (stageWarnings.length) {
    blockingErrors.push(`${id}.warnings_present`)
    warnings.push(...stageWarnings.map((warning) => `${id}:${warning}`))
  }

  if (stageBlockingErrors === null) blockingErrors.push(`${id}.blocking_errors_missing`)
  else if (stageBlockingErrors.length) {
    blockingErrors.push(`${id}.blocking_errors_present`)
  }

  return {
    present: true,
    status,
    warnings: stageWarnings,
    blocking_errors: stageBlockingErrors,
  }
}

function debugReportSourceLayoutId(debugReport) {
  const sourceLayout = debugReport?.source_layout
  if (typeof sourceLayout === 'string') return sourceLayout || null
  return sourceLayout?.id ?? null
}

function buildResult({ generationMode, policy, blockingErrors, warnings, evidence }) {
  const normalizedBlockingErrors = [...new Set(blockingErrors)]
  const normalizedWarnings = [...new Set(warnings)]
  const releaseReady = normalizedBlockingErrors.length === 0
  return {
    schema_version: 1,
    mode: GENERATION_RELEASE_GATE_MODE,
    generation_mode: generationMode,
    policy,
    status: releaseReady ? 'pass' : 'fail',
    release_ready: releaseReady,
    blocking_errors: normalizedBlockingErrors,
    warnings: normalizedWarnings,
    evidence,
  }
}

export function evaluateProductionSheetReleaseGate({ debugReport } = {}) {
  const blockingErrors = []
  const warnings = []
  const rawSourceLayoutId = debugReportSourceLayoutId(debugReport)
  const sourceLayoutId = rawSourceLayoutId ? canonicalSourceLayoutId(rawSourceLayoutId) : null
  const knownSourceLayout = Boolean(sourceLayoutId && SOURCE_LAYOUTS[sourceLayoutId])
  if (!sourceLayoutId) blockingErrors.push('source_layout.evidence_missing')
  else if (!knownSourceLayout) blockingErrors.push('source_layout.unsupported')
  const fixedRegionSource = knownSourceLayout && isFixedRegionMotionLayoutId(sourceLayoutId)

  const validation = productionStageEvidence(
    debugReport?.validation,
    'validation',
    blockingErrors,
    warnings
  )

  const sourceQuality = fixedRegionSource
    ? {
        applicable: true,
        required: true,
        ...productionStageEvidence(
          debugReport?.source_quality,
          'source_quality',
          blockingErrors,
          warnings
        ),
      }
    : {
        applicable: false,
        required: false,
        present: debugReport?.source_quality != null,
        status: 'not_applicable',
        warnings: [],
        blocking_errors: [],
      }

  const qualityClosure = debugReport?.quality_closure
  let qualityClosureEvidence
  if (!qualityClosure || typeof qualityClosure !== 'object') {
    blockingErrors.push('quality_closure.evidence_missing')
    qualityClosureEvidence = {
      present: false,
      status: null,
      release_ready: null,
    }
  } else {
    const mode = typeof qualityClosure.mode === 'string' ? qualityClosure.mode : null
    const status = typeof qualityClosure.status === 'string' ? qualityClosure.status : null
    const gates = Array.isArray(qualityClosure.gates) ? qualityClosure.gates : null
    const gateIds = gates?.map((gate) => gate?.id ?? null) ?? null
    const canonicalGateIds = gates !== null &&
      gates.length === CHARACTER_QUALITY_CLOSURE_GATE_IDS.length &&
      new Set(gateIds).size === CHARACTER_QUALITY_CLOSURE_GATE_IDS.length &&
      CHARACTER_QUALITY_CLOSURE_GATE_IDS.every((id) => gateIds.includes(id))
    if (mode === null) blockingErrors.push('quality_closure.mode_missing')
    else if (mode !== CHARACTER_QUALITY_CLOSURE_MODE) blockingErrors.push('quality_closure.mode_unsupported')
    if (status === null) blockingErrors.push('quality_closure.status_missing')
    else if (status !== 'pass') blockingErrors.push('quality_closure.status_not_pass')
    if (qualityClosure.release_ready !== true) blockingErrors.push('quality_closure.not_release_ready')
    if (gates === null) blockingErrors.push('quality_closure.gates_missing')
    else if (!canonicalGateIds) blockingErrors.push('quality_closure.gates_invalid')
    if (gates?.some((gate) => gate?.status !== 'pass')) {
      blockingErrors.push('quality_closure.gates_not_pass')
    }
    qualityClosureEvidence = {
      present: true,
      mode,
      status,
      release_ready: qualityClosure.release_ready === true,
      gate_statuses: gates?.map((gate) => ({ id: gate?.id ?? null, status: gate?.status ?? null })) ?? null,
    }
  }

  return buildResult({
    generationMode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
    policy: PRODUCTION_RELEASE_POLICY,
    blockingErrors,
    warnings,
    evidence: {
      source_layout_id: sourceLayoutId,
      fixed_region_source: fixedRegionSource,
      validation,
      source_quality: sourceQuality,
      quality_closure: qualityClosureEvidence,
    },
  })
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function requiredMetric(metrics, key, blockingErrors) {
  const value = finiteNumber(metrics?.[key])
  if (value === null) blockingErrors.push(`quality_character_metrics_missing:${key}`)
  return value
}

function optionalMetric(metrics, key) {
  return finiteNumber(metrics?.[key])
}

export function evaluateQualityCharacterReleaseGate({ score, metrics = {}, bbox } = {}) {
  const thresholds = QUALITY_CHARACTER_RELEASE_THRESHOLDS
  const blockingErrors = []
  const warnings = []
  const normalizedScore = finiteNumber(score)
  const visiblePixels = requiredMetric(metrics, 'visible_pixel_count', blockingErrors)
  const bboxWidth = requiredMetric(metrics, 'bbox_width_ratio', blockingErrors)
  const bboxHeight = requiredMetric(metrics, 'bbox_height_ratio', blockingErrors)
  const bboxArea = requiredMetric(metrics, 'bbox_area_ratio', blockingErrors)
  const centerOffset = requiredMetric(metrics, 'center_offset_ratio', blockingErrors)
  const edgeMargin = requiredMetric(metrics, 'edge_margin_ratio', blockingErrors)
  const uniqueColors = optionalMetric(metrics, 'unique_color_count')
  const paletteChange = optionalMetric(metrics, 'palette_changed_pixel_ratio')
  const outlineRatio = optionalMetric(metrics, 'outline_pixel_ratio')

  if (bbox == null) blockingErrors.push('quality_character_empty')
  if (normalizedScore === null) blockingErrors.push('quality_character_score_missing')
  else if (normalizedScore < thresholds.warning_score) blockingErrors.push('quality_character_score_below_warning')
  if (visiblePixels === 0 && !blockingErrors.includes('quality_character_empty')) blockingErrors.push('quality_character_empty')
  else if (visiblePixels !== null && visiblePixels > thresholds.max_visible_pixel_count) {
    blockingErrors.push('quality_character_visible_area_too_large')
  }
  if (bboxWidth !== null && bboxWidth > thresholds.max_bbox_width_ratio) {
    blockingErrors.push('quality_character_bbox_too_wide')
  }
  if (bboxHeight !== null && bboxHeight > thresholds.max_bbox_height_ratio) {
    blockingErrors.push('quality_character_bbox_too_tall')
  }
  if (bboxArea !== null && bboxArea > thresholds.max_bbox_area_ratio) {
    blockingErrors.push('quality_character_bbox_too_large')
  }
  if (centerOffset !== null && centerOffset > thresholds.max_center_offset_ratio) {
    blockingErrors.push('quality_character_off_center')
  }
  if (edgeMargin !== null && edgeMargin < thresholds.min_edge_margin_ratio) {
    blockingErrors.push('quality_character_edge_margin_too_small')
  }

  if (normalizedScore !== null && normalizedScore < thresholds.usable_score) {
    warnings.push('quality_character.score_below_usable')
  }
  if (visiblePixels !== null && visiblePixels > 0 && visiblePixels < thresholds.min_visible_pixel_count) {
    warnings.push('quality_character.visible_pixels_below_preferred')
  }
  if (uniqueColors !== null && uniqueColors < thresholds.min_unique_color_count) {
    warnings.push('quality_character.unique_colors_below_preferred')
  }
  if (paletteChange !== null && paletteChange > thresholds.max_palette_changed_pixel_ratio) {
    warnings.push('quality_character.palette_change_above_preferred')
  }
  if (outlineRatio !== null && outlineRatio > thresholds.max_outline_pixel_ratio) {
    warnings.push('quality_character.outline_ratio_above_preferred')
  }

  return buildResult({
    generationMode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
    policy: QUALITY_CHARACTER_RELEASE_POLICY,
    blockingErrors,
    warnings,
    evidence: {
      bbox_present: bbox != null,
      bbox: bbox ?? null,
      score: normalizedScore,
      metrics: {
        visible_pixel_count: visiblePixels,
        unique_color_count: uniqueColors,
        palette_changed_pixel_ratio: paletteChange,
        outline_pixel_ratio: outlineRatio,
        bbox_width_ratio: bboxWidth,
        bbox_height_ratio: bboxHeight,
        bbox_area_ratio: bboxArea,
        center_offset_ratio: centerOffset,
        edge_margin_ratio: edgeMargin,
      },
      thresholds,
    },
  })
}
