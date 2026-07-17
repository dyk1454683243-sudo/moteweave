const jobs = new Map()

export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  GENERATING: 'generating',
  POST_PROCESSING: 'post_processing',
  DONE: 'done',
  FAILED_QUALITY_GATE: 'failed_quality_gate',
  FAILED_SAFETY_FILTER: 'failed_safety_filter',
  FAILED_MODEL_ERROR: 'failed_model_error',
  FAILED_POST_PROCESSING: 'failed_post_processing',
})

export function createJob(initial = {}) {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const job = { id, status: JOB_STATUS.QUEUED, created_at: new Date().toISOString(), ...initial }
  jobs.set(id, job)
  return job
}

export function updateJob(id, patch) {
  const current = jobs.get(id)
  if (!current) return null
  const next = { ...current, ...patch, updated_at: new Date().toISOString() }
  jobs.set(id, next)
  return next
}

export function getJob(id) {
  return jobs.get(id) ?? null
}
