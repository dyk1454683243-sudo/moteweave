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
export const MANUAL_REVIEW_ARTIFACT_DISPOSITION = 'review_required'
export const MANUAL_REVIEW_STATUS = 'awaiting_human_review'
export const FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL = 'full_sheet_manual_acceptance_v1'
export const FULL_SHEET_DYNAMIC_STANDALONE_PUBLICATION_FILES = Object.freeze([
  'character_pack.zip',
  'generation.json',
  'generation_release_gate.json',
  'manual_acceptance.json',
  'metadata.json',
])
export const FULL_SHEET_DYNAMIC_CHARACTER_PACK_ENTRIES = Object.freeze([
  'generation.json',
  'generation_release_gate.json',
  'manual_acceptance.json',
  'metadata.json',
])

const STRICT_FULL_SHEET_PROFILE_IDS = new Set([
  'full_sheet_fixed_region_v1',
  'full_sheet_topdown_v1',
])

const REQUIRED_SUBJECT_COUNT_STAGES = Object.freeze([
  'pre_calibration_source',
  'calibrated_source',
  'normalized_frames',
])
const PRODUCTION_EVIDENCE_STATUSES = new Set(['pass', 'warning', 'fail'])
const SUBJECT_COUNT_EVIDENCE_STATUSES = new Set(['pass', 'needs_review', 'blocked', 'empty'])
const MAX_PUBLICATION_EVIDENCE_FILES = 1024
const DYNAMIC_STANDALONE_PUBLICATION_FILES = new Set(
  FULL_SHEET_DYNAMIC_STANDALONE_PUBLICATION_FILES,
)
const FORBIDDEN_CHARACTER_PACK_ENTRIES = new Set([
  ...FULL_SHEET_DYNAMIC_CHARACTER_PACK_ENTRIES,
  'character_pack.zip',
])

function safePublicationArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false
  if (
    value.startsWith('/') ||
    value.startsWith('~') ||
    value.includes('\\') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isCanonicalPublicationEvidenceList(value, forbiddenFiles) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PUBLICATION_EVIDENCE_FILES) {
    return false
  }
  let previousFile = null
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    if (Object.keys(entry).sort().join(',') !== 'byte_length,file,sha256') return false
    if (!safePublicationArtifactPath(entry.file) || forbiddenFiles.has(entry.file)) return false
    if (previousFile !== null && entry.file <= previousFile) return false
    previousFile = entry.file
    return /^[a-f0-9]{64}$/.test(String(entry.sha256 ?? '')) &&
      Number.isSafeInteger(entry.byte_length) && entry.byte_length > 0
  })
}

export function isCanonicalGenerationReleaseGate(gate) {
  if (!gate || typeof gate !== 'object') return false
  const policyMatchesMode =
    (gate.generation_mode === TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET && gate.policy === PRODUCTION_RELEASE_POLICY) ||
    (gate.generation_mode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER && gate.policy === QUALITY_CHARACTER_RELEASE_POLICY)
  return (
    gate.schema_version === 1 &&
    gate.mode === GENERATION_RELEASE_GATE_MODE &&
    policyMatchesMode &&
    (
      gate.status === 'pass' ||
      gate.status === 'fail' ||
      (
        gate.status === 'needs_review' &&
        gate.manual_review_required === true &&
        gate.human_decision_status === 'pending' &&
        Array.isArray(gate.automated_review_findings)
      ) ||
      (
        gate.status === 'accepted' &&
        gate.generation_mode === TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET &&
        gate.release_ready === true &&
        gate.manual_review_required === false &&
        gate.human_decision_status === 'accepted' &&
        STRICT_FULL_SHEET_PROFILE_IDS.has(gate.generation_profile_id) &&
        gate.prompt_contract_version === 'character_prompt_contract_v1_18' &&
        Array.isArray(gate.automated_review_findings) &&
        isCanonicalFullSheetManualAcceptance(gate.manual_acceptance) &&
        gate.manual_acceptance.generation_profile_id === gate.generation_profile_id &&
        gate.manual_acceptance.prompt_contract_version === gate.prompt_contract_version
      )
    ) &&
    typeof gate.release_ready === 'boolean' &&
    Array.isArray(gate.blocking_errors) &&
    Array.isArray(gate.warnings) &&
    gate.evidence != null &&
    typeof gate.evidence === 'object' &&
    !Array.isArray(gate.evidence)
  )
}

export function isCanonicalFullSheetManualAcceptance(acceptance) {
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
  const publicationArtifacts = acceptance?.publication_artifacts
  const releaseFiles = publicationArtifacts?.release_files
  const characterPackEntries = publicationArtifacts?.character_pack_entries
  const releaseEvidenceByFile = new Map(
    Array.isArray(releaseFiles) ? releaseFiles.map((entry) => [entry?.file, entry]) : [],
  )
  const engineZip = (key, file) => {
    const value = publicationArtifacts?.engine_zips?.[key]
    const releaseEvidence = releaseEvidenceByFile.get(file)
    return value != null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === 'byte_length,file,sha256' &&
      value.file === file && hash(value.sha256) &&
      Number.isSafeInteger(value.byte_length) && value.byte_length > 0 &&
      releaseEvidence?.sha256 === value.sha256 &&
      releaseEvidence?.byte_length === value.byte_length
  }
  return (
    acceptance != null &&
    typeof acceptance === 'object' &&
    !Array.isArray(acceptance) &&
    acceptance.schema_version === 1 &&
    acceptance.protocol === FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL &&
    acceptance.decision === 'accepted' &&
    acceptance.decision_authority === 'human' &&
    STRICT_FULL_SHEET_PROFILE_IDS.has(acceptance.generation_profile_id) &&
    acceptance.prompt_contract_version === 'character_prompt_contract_v1_18' &&
    typeof acceptance.acceptance_id === 'string' &&
    acceptance.acceptance_id.length > 0 &&
    typeof acceptance.source_job_id === 'string' &&
    acceptance.source_job_id.length > 0 &&
    typeof acceptance.published_job_id === 'string' &&
    acceptance.published_job_id.length > 0 &&
    typeof acceptance.accepted_at === 'string' &&
    Number.isFinite(Date.parse(acceptance.accepted_at)) &&
    Number.isInteger(acceptance.human_reviewed_issue_count) &&
    acceptance.human_reviewed_issue_count >= 0 &&
    acceptance.provider_calls_used === 0 &&
    typeof acceptance.generation_review?.reviewed_run_id === 'string' &&
    /^[A-Za-z0-9._-]{1,120}$/.test(acceptance.generation_review.reviewed_run_id) &&
    !acceptance.generation_review.reviewed_run_id.includes('..') &&
    hash(acceptance.generation_review?.plan_hash) &&
    hash(acceptance.generation_review?.reference_manifest_sha256) &&
    hash(acceptance.generation_review?.prompt_text_sha256) &&
    typeof acceptance.source_artifacts?.raw_provider_output_file === 'string' &&
    /^raw_provider_output\.(?:png|jpg|webp|gif|bin)$/.test(
      acceptance.source_artifacts.raw_provider_output_file,
    ) &&
    hash(acceptance.source_artifacts?.raw_provider_output_sha256) &&
    Number.isSafeInteger(acceptance.source_artifacts?.raw_provider_output_byte_length) &&
    acceptance.source_artifacts.raw_provider_output_byte_length > 0 &&
    hash(acceptance.source_artifacts?.source_sha256) &&
    Number.isSafeInteger(acceptance.source_artifacts?.source_byte_length) &&
    acceptance.source_artifacts.source_byte_length > 0 &&
    hash(acceptance.source_artifacts?.normalized_sheet_sha256) &&
    Number.isSafeInteger(acceptance.source_artifacts?.normalized_sheet_byte_length) &&
    acceptance.source_artifacts.normalized_sheet_byte_length > 0 &&
    hash(acceptance.source_artifacts?.prompt_sha256) &&
    acceptance.source_artifacts.prompt_sha256 ===
      acceptance.generation_review.prompt_text_sha256 &&
    Number.isSafeInteger(acceptance.source_artifacts?.prompt_byte_length) &&
    acceptance.source_artifacts.prompt_byte_length > 0 &&
    hash(acceptance.source_artifacts?.generation_release_gate_sha256) &&
    publicationArtifacts != null &&
    typeof publicationArtifacts === 'object' &&
    !Array.isArray(publicationArtifacts) &&
    Object.keys(publicationArtifacts).sort().join(',') ===
      'character_pack_entries,engine_zips,metadata_without_generation_sha256,release_files' &&
    publicationArtifacts.engine_zips != null &&
    typeof publicationArtifacts.engine_zips === 'object' &&
    !Array.isArray(publicationArtifacts.engine_zips) &&
    Object.keys(publicationArtifacts.engine_zips).sort().join(',') ===
      'godot_npc,ocad,rpgmaker' &&
    isCanonicalPublicationEvidenceList(
      releaseFiles,
      DYNAMIC_STANDALONE_PUBLICATION_FILES,
    ) &&
    isCanonicalPublicationEvidenceList(
      characterPackEntries,
      FORBIDDEN_CHARACTER_PACK_ENTRIES,
    ) &&
    hash(publicationArtifacts.metadata_without_generation_sha256) &&
    engineZip('godot_npc', 'godot_npc_pack.zip') &&
    engineZip('rpgmaker', 'rpgmaker_pack.zip') &&
    engineZip('ocad', 'ocad_pack.zip')
  )
}

export function resolveGenerationArtifactDisposition(result = {}) {
  const gate = result.generationReleaseGate
  if (!gate) return null
  const reviewRequired =
    isCanonicalGenerationReleaseGate(gate) &&
    gate.status === 'needs_review' &&
    gate.release_ready === false &&
    gate.manual_review_required === true &&
    gate.human_decision_status === 'pending' &&
    gate.blocking_errors.length === 0 &&
    result.manualReviewRequired === true &&
    result.artifactDisposition === MANUAL_REVIEW_ARTIFACT_DISPOSITION
  if (reviewRequired) return MANUAL_REVIEW_ARTIFACT_DISPOSITION
  const releaseReady =
    isCanonicalGenerationReleaseGate(gate) &&
    (gate.status === 'pass' || gate.status === 'accepted') &&
    gate.release_ready === true &&
    Array.isArray(gate.blocking_errors) &&
    gate.blocking_errors.length === 0 &&
    result.releaseReady === true &&
    result.artifactDisposition === 'release' &&
    (
      gate.status !== 'accepted' ||
      (
        result.manualReviewRequired === false &&
        result.humanDecisionStatus === 'accepted' &&
        result.generationProfileId === gate.generation_profile_id &&
        result.promptContractVersion === gate.prompt_contract_version
      )
    )
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
  else if (!PRODUCTION_EVIDENCE_STATUSES.has(status)) blockingErrors.push(`${id}.status_invalid`)
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

function isReviewEvidenceIntegrityError(value) {
  const code = String(value || '')
  return /(?:missing|duplicate|invalid|unsupported)$/.test(code)
}

function buildResult({
  generationMode,
  policy,
  blockingErrors,
  warnings,
  evidence,
  manualReviewRequired = false,
}) {
  const normalizedBlockingErrors = [...new Set(blockingErrors)]
  const normalizedWarnings = [...new Set(warnings)]
  if (manualReviewRequired) {
    const integrityErrors = normalizedBlockingErrors.filter(isReviewEvidenceIntegrityError)
    const automatedReviewFindings = normalizedBlockingErrors.filter(
      (value) => !isReviewEvidenceIntegrityError(value),
    )
    if (integrityErrors.length === 0) {
      return {
        schema_version: 1,
        mode: GENERATION_RELEASE_GATE_MODE,
        generation_mode: generationMode,
        policy,
        status: 'needs_review',
        release_ready: false,
        manual_review_required: true,
        human_decision_status: 'pending',
        blocking_errors: [],
        automated_review_findings: automatedReviewFindings,
        warnings: normalizedWarnings,
        evidence,
      }
    }
    return {
      schema_version: 1,
      mode: GENERATION_RELEASE_GATE_MODE,
      generation_mode: generationMode,
      policy,
      status: 'fail',
      release_ready: false,
      manual_review_required: false,
      human_decision_status: 'unavailable',
      blocking_errors: integrityErrors,
      automated_review_findings: automatedReviewFindings,
      warnings: normalizedWarnings,
      evidence,
    }
  }
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

function subjectCountStageStatuses(subjectCount, blockingErrors) {
  const sourceStages = Array.isArray(subjectCount?.source?.stages) ? subjectCount.source.stages : []
  const reports = [...sourceStages, subjectCount?.normalized].filter((report) => report && typeof report === 'object')
  const statuses = {}
  for (const stageId of REQUIRED_SUBJECT_COUNT_STAGES) {
    const matches = reports.filter((report) => report.stage === stageId)
    if (matches.length === 0) {
      blockingErrors.push(`subject_count.${stageId}_missing`)
      statuses[stageId] = null
      continue
    }
    if (matches.length > 1) blockingErrors.push(`subject_count.${stageId}_duplicate`)
    const status = typeof matches[0]?.status === 'string' ? matches[0].status : null
    statuses[stageId] = status
    if (status === null) blockingErrors.push(`subject_count.${stageId}_status_missing`)
    else if (!SUBJECT_COUNT_EVIDENCE_STATUSES.has(status)) {
      blockingErrors.push(`subject_count.${stageId}_status_invalid`)
    } else if (status !== 'pass') blockingErrors.push(`subject_count.${stageId}_not_pass`)
  }
  return statuses
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

  const subjectCountRequired = debugReport?.subject_count?.required === true ||
    String(debugReport?.generation_profile?.id ?? '').startsWith('full_sheet_')
  const subjectCount = debugReport?.subject_count
  const subjectCountStageStatus = subjectCountRequired && subjectCount && typeof subjectCount === 'object'
    ? subjectCountStageStatuses(subjectCount, blockingErrors)
    : Object.fromEntries(REQUIRED_SUBJECT_COUNT_STAGES.map((stageId) => [stageId, null]))
  const subjectCountEvidence = {
    required: subjectCountRequired,
    present: subjectCount != null,
    status: subjectCount?.status ?? null,
    source_status: subjectCount?.source?.status ?? null,
    normalized_status: subjectCount?.normalized?.status ?? null,
    suggested_region_keys: subjectCount?.suggested_region_keys ?? [],
    needs_review_region_keys: subjectCount?.needs_review_region_keys ?? [],
    advisory_region_keys: subjectCount?.advisory_region_keys ?? [],
    stage_statuses: subjectCountStageStatus,
  }
  if (subjectCountRequired) {
    if (!subjectCount || typeof subjectCount !== 'object') {
      blockingErrors.push('subject_count.evidence_missing')
    } else {
      if (subjectCount.status === 'blocked') blockingErrors.push('subject_count.multiple_subjects_blocked')
      else if (subjectCount.status === 'needs_review') blockingErrors.push('subject_count.needs_review')
      else if (subjectCount.status === 'empty') blockingErrors.push('subject_count.empty')
      else if (subjectCount.status !== 'pass') blockingErrors.push('subject_count.status_invalid')
      for (const [id, report] of [
        ['source', subjectCount.source],
        ['normalized', subjectCount.normalized],
      ]) {
        const status = typeof report?.status === 'string' ? report.status : null
        if (status === null) blockingErrors.push(`subject_count.${id}_status_missing`)
        else if (!SUBJECT_COUNT_EVIDENCE_STATUSES.has(status)) {
          blockingErrors.push(`subject_count.${id}_status_invalid`)
        } else if (status !== 'pass') blockingErrors.push(`subject_count.${id}_not_pass`)
      }
      if ((subjectCount.advisory_region_keys ?? []).length) {
        warnings.push(...subjectCount.advisory_region_keys.map((key) => `subject_count:accessory_edge_advisory:${key}`))
      }
    }
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
    const hasReleaseReady = Object.hasOwn(qualityClosure, 'release_ready')
    const releaseReady = hasReleaseReady && typeof qualityClosure.release_ready === 'boolean'
      ? qualityClosure.release_ready
      : null
    const gateIds = gates?.map((gate) => gate?.id ?? null) ?? null
    const canonicalGateIds = gates !== null &&
      gates.length === CHARACTER_QUALITY_CLOSURE_GATE_IDS.length &&
      new Set(gateIds).size === CHARACTER_QUALITY_CLOSURE_GATE_IDS.length &&
      CHARACTER_QUALITY_CLOSURE_GATE_IDS.every((id) => gateIds.includes(id))
    if (mode === null) blockingErrors.push('quality_closure.mode_missing')
    else if (mode !== CHARACTER_QUALITY_CLOSURE_MODE) blockingErrors.push('quality_closure.mode_unsupported')
    if (status === null) blockingErrors.push('quality_closure.status_missing')
    else if (!PRODUCTION_EVIDENCE_STATUSES.has(status)) blockingErrors.push('quality_closure.status_invalid')
    else if (status !== 'pass') blockingErrors.push('quality_closure.status_not_pass')
    if (!hasReleaseReady) blockingErrors.push('quality_closure.release_ready_missing')
    else if (releaseReady === null) blockingErrors.push('quality_closure.release_ready_invalid')
    else if (!releaseReady) blockingErrors.push('quality_closure.not_release_ready')
    if (gates === null) blockingErrors.push('quality_closure.gates_missing')
    else if (!canonicalGateIds) blockingErrors.push('quality_closure.gates_invalid')
    if (gates?.some((gate) => typeof gate?.status !== 'string')) {
      blockingErrors.push('quality_closure.gate_status_missing')
    } else if (gates?.some((gate) => !PRODUCTION_EVIDENCE_STATUSES.has(gate.status))) {
      blockingErrors.push('quality_closure.gate_status_invalid')
    }
    if (gates?.some((gate) => gate?.status !== 'pass')) {
      blockingErrors.push('quality_closure.gates_not_pass')
    }
    qualityClosureEvidence = {
      present: true,
      mode,
      status,
      release_ready: releaseReady,
      gate_statuses: gates?.map((gate) => ({ id: gate?.id ?? null, status: gate?.status ?? null })) ?? null,
    }
  }

  return buildResult({
    generationMode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
    policy: PRODUCTION_RELEASE_POLICY,
    blockingErrors,
    warnings,
    manualReviewRequired: String(debugReport?.generation_profile?.id ?? '').startsWith('full_sheet_'),
    evidence: {
      source_layout_id: sourceLayoutId,
      fixed_region_source: fixedRegionSource,
      validation,
      source_quality: sourceQuality,
      subject_count: subjectCountEvidence,
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
