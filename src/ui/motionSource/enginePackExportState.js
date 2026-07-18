const REQUIRED_ENGINE_PACK_ARTIFACTS = Object.freeze({
  debug_report_url: 'debug_report.json',
  normalized_sheet_url: 'normalized_sheet.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  zip_url: 'character_pack.zip',
  godot_npc_zip_url: 'godot_npc_pack.zip',
  rpgmaker_zip_url: 'rpgmaker_pack.zip',
  ocad_zip_url: 'ocad_pack.zip',
})
const EXPORTABLE_VALIDATION_STATUSES = new Set(['pass', 'warning'])

function exportStateError(code, message) {
  return Object.assign(new Error(message), { code })
}

function managedArtifactUrl(jobId, fileName) {
  return `/generated/${jobId}/${fileName}`
}

function validationAllowsExport(report) {
  const validation = report?.validation
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    return false
  }
  if (!EXPORTABLE_VALIDATION_STATUSES.has(validation.status)) return false
  if (!Array.isArray(validation.blocking_errors) || validation.blocking_errors.length > 0) {
    return false
  }
  if (!Array.isArray(validation.warnings)) return false
  if (report.blocking_errors !== undefined) {
    if (!Array.isArray(report.blocking_errors) || report.blocking_errors.length > 0) {
      return false
    }
  }
  return true
}

function preservationEvidenceMatches(report) {
  return Boolean(
    report?.profile === 'topdown_rpg_v0' &&
    report?.source_layout?.id === 'topdown_rpg_v0' &&
    report?.requested_background_mode === 'passthrough' &&
    report?.component_cleanup?.enabled === false &&
    report?.normalization?.auto_correction?.enabled === false &&
    report?.normalization?.motion_stabilization?.enabled === false &&
    report?.pixel_style?.mode === 'report_only'
  )
}

export function buildMotionApplyContextCommit(motionSource, {
  kind,
  job,
  report,
} = {}) {
  if (!motionSource?.jobs || !motionSource?.reports) {
    throw exportStateError(
      'motion_apply_context_invalid',
      'Motion apply state is unavailable.'
    )
  }
  if (!['single', 'set'].includes(kind) || !job || !report) {
    throw exportStateError(
      'motion_apply_context_invalid',
      'Motion apply context is incomplete.'
    )
  }
  const single = kind === 'single'
  return {
    jobs: {
      ...motionSource.jobs,
      apply: single ? job : null,
      setApply: single ? null : job,
      enginePacks: null,
    },
    reports: {
      ...motionSource.reports,
      apply: single ? report : null,
      setApply: single ? null : report,
      enginePacks: null,
    },
    applyResultStale: false,
    enginePackBinding: null,
  }
}

export function buildMotionEnginePackProcessingOptions() {
  return {
    name: 'motion_applied_character',
    description: 'Character packages reprocessed from a Motion Source applied sheet',
    sourceType: 'motion_source_apply',
    sourceFileName: 'applied_normalized_sheet.png',
    sourceLayout: 'topdown_rpg_v0',
    backgroundMode: 'passthrough',
    autoCorrect: false,
    motionStabilize: false,
    componentCleanup: false,
    pixelFinishing: false,
    styleReport: true,
    outputFrameSizes: [96, 64, 48, 32, 16],
  }
}

export function motionEnginePackExportReadiness({
  applyJob = null,
  applyReport = null,
  applyResultStale = false,
  applyArtifactError = null,
  enginePackBinding = null,
  enginePackJob = null,
} = {}) {
  if (applyResultStale) return { ready: false, reason: 'apply_result_stale' }
  if (applyArtifactError) return { ready: false, reason: 'apply_artifact_error' }
  if (!applyJob?.id || applyJob.status !== 'done') {
    return { ready: false, reason: 'apply_job_not_done' }
  }
  const appliedSheetUrl = managedArtifactUrl(
    applyJob.id,
    'applied_normalized_sheet.png'
  )
  if (applyJob.applied_normalized_sheet_url !== appliedSheetUrl) {
    return { ready: false, reason: 'apply_artifact_unbound' }
  }
  if (
    applyJob.apply_motion_strip_report_url !==
    managedArtifactUrl(applyJob.id, 'apply_motion_strip_report.json')
  ) {
    return { ready: false, reason: 'apply_report_unbound' }
  }
  if (
    applyReport?.schema_version !== 1 ||
    applyReport?.mode !== 'apply_motion_strip_report_v1' ||
    applyReport?.profile_id !== 'topdown_rpg_v0'
  ) {
    return { ready: false, reason: 'apply_report_invalid' }
  }
  if (applyReport.status !== 'done' || !validationAllowsExport(applyReport)) {
    return { ready: false, reason: 'apply_report_blocked' }
  }

  const binding = {
    apply_job_id: applyJob.id,
    applied_sheet_url: appliedSheetUrl,
  }
  if (
    enginePackJob?.status === 'done' &&
    enginePackBinding?.apply_job_id === binding.apply_job_id &&
    enginePackBinding?.applied_sheet_url === binding.applied_sheet_url &&
    enginePackBinding?.engine_pack_job_id === enginePackJob.id
  ) {
    return { ready: false, reason: 'engine_packs_current', binding }
  }
  return { ready: true, reason: null, binding }
}

export function assertMotionEnginePackResult({
  job,
  debugReport,
  inputBinding,
} = {}) {
  if (!job?.id || job.status !== 'done') {
    throw exportStateError(
      'engine_pack_job_not_done',
      'Engine package processing did not complete successfully.'
    )
  }
  if (!inputBinding?.apply_job_id || !inputBinding?.applied_sheet_url) {
    throw exportStateError(
      'engine_pack_input_unbound',
      'Engine package input is not bound to an applied sheet.'
    )
  }
  for (const [field, fileName] of Object.entries(REQUIRED_ENGINE_PACK_ARTIFACTS)) {
    if (job[field] !== managedArtifactUrl(job.id, fileName)) {
      throw exportStateError(
        'engine_pack_artifact_unbound',
        `Engine package processing completed without a bound ${field}.`
      )
    }
  }
  if (
    !validationAllowsExport(debugReport)
  ) {
    throw exportStateError(
      'engine_pack_validation_blocked',
      'Engine package validation contains blocking errors.'
    )
  }
  if (!preservationEvidenceMatches(debugReport)) {
    throw exportStateError(
      'engine_pack_processing_evidence_mismatch',
      'Engine package processing evidence does not match the preservation recipe.'
    )
  }
  return {
    ...inputBinding,
    engine_pack_job_id: job.id,
  }
}

export function motionEnginePackBindingCurrent(binding, {
  applyJob = null,
  applyResultStale = false,
  enginePackJob = null,
} = {}) {
  return Boolean(
    !applyResultStale &&
    binding?.apply_job_id &&
    binding.apply_job_id === applyJob?.id &&
    binding.applied_sheet_url === applyJob?.applied_normalized_sheet_url &&
    binding.engine_pack_job_id === enginePackJob?.id &&
    enginePackJob?.status === 'done'
  )
}
