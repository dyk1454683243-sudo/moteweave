const FAILED_JOB_STATUSES = new Set([
  'failed',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

function nonEmptyStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item)
    : []
}

function releaseReadiness(job) {
  const values = [
    job.release_ready,
    job.release_gate?.release_ready,
    job.candidate_selection?.release_ready,
  ].filter((value) => typeof value === 'boolean')
  if (values.includes(false)) return false
  if (values.includes(true)) return true
  return null
}

function artifactDisposition(job) {
  const values = [
    job.artifact_disposition,
    job.candidate_selection?.artifact_disposition,
  ].filter((value) => typeof value === 'string' && value)
  if (values.includes('diagnostic_only')) return 'diagnostic_only'
  return values[0] ?? null
}

export function characterPackQualityReportNeedsReview(report) {
  const validation = report?.validation
  if (validation?.status !== 'pass') return true
  return Boolean(
    nonEmptyStrings(validation.warnings).length
    || nonEmptyStrings(validation.blocking_errors).length
  )
}

export function characterPackResultState(
  job,
  { releaseBlocked = false, reviewRequired = false } = {},
) {
  if (!job || typeof job !== 'object') return null
  const statuses = [job.status, job.failure_status].filter(Boolean)
  if (statuses.some((status) => (
    FAILED_JOB_STATUSES.has(status) || String(status).startsWith('failed_')
  ))) {
    return 'failed'
  }
  if (job.status !== 'done') return null

  const warnings = [
    ...nonEmptyStrings(job.warnings),
    ...nonEmptyStrings(job.release_gate?.warnings),
  ]
  const blockers = [
    ...nonEmptyStrings(job.blocking_errors),
    ...nonEmptyStrings(job.release_gate?.blocking_errors),
  ]
  if (
    releaseBlocked
    || reviewRequired
    || releaseReadiness(job) === false
    || artifactDisposition(job) === 'diagnostic_only'
    || job.review_only === true
    || (job.release_gate != null && job.release_gate.status !== 'pass')
    || warnings.length
    || blockers.length
  ) {
    return 'needs_review'
  }
  return 'ready'
}

export function characterPackResultStatusKey(state) {
  return {
    ready: 'character.result.ready.title',
    needs_review: 'character.result.needsReview.title',
    failed: 'character.result.failed.title',
  }[state] ?? null
}

export function characterPackResultToastKey(state) {
  return {
    ready: 'character.toast.ready',
    needs_review: 'character.toast.needsReview',
    failed: 'character.toast.failed',
  }[state] ?? null
}

export function characterPackJobStatusKey(job, options = {}) {
  if (!job) return 'character.job.status.idle'
  const resultState = characterPackResultState(job, options)
  if (resultState && resultState !== 'ready') {
    return characterPackResultStatusKey(resultState)
  }
  if (
    resultState === 'ready'
    && job.debug_report_url
    && !Object.hasOwn(options, 'reviewRequired')
  ) {
    return 'character.job.status.postProcessing'
  }
  if (resultState) return characterPackResultStatusKey(resultState)
  return {
    queued: 'character.job.status.queued',
    generating: 'character.job.status.generating',
    post_processing: 'character.job.status.postProcessing',
  }[job.status] ?? 'character.job.status.postProcessing'
}
