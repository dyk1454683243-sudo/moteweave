const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/
const PROJECT_ID_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/

const RUNNING_JOB_STATUSES = new Set(['queued', 'post_processing'])
const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_project_pack',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

const PROJECT_ARTIFACT_FIELDS = Object.freeze({
  project_manifest_url: 'project_manifest.json',
  project_validation_url: 'project_validation.json',
  project_pack_zip_url: 'project_pack.zip',
  zip_url: 'project_pack.zip',
})

export const PROJECT_REQUEST_TIMEOUT_MS = 15_000
export const PROJECT_ARTIFACT_TIMEOUT_MS = 20_000
export const PROJECT_POLL_INTERVAL_MS = 500
export const PROJECT_POLL_LIMIT = 160

export class StudioProjectApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioProjectApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

function projectError(code, message, options) {
  return new StudioProjectApiError(code, message, options)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw projectError('fetch_unavailable', 'fetch is unavailable')
  return fetchImpl
}

export function safeProjectJobId(value, label = 'Job id') {
  const id = String(value ?? '').trim()
  if (!SAFE_JOB_ID_PATTERN.test(id) || id.includes('..')) {
    throw projectError('invalid_project_input', `${label} is invalid`)
  }
  return id
}

export function safeProjectId(value) {
  const id = String(value ?? '').trim()
  if (!id || id.length > 160 || PROJECT_ID_CONTROL_PATTERN.test(id)) {
    throw projectError('invalid_project_input', 'Project id must contain 1 to 160 printable characters')
  }
  return id
}

export function normalizeProjectInputs(values = {}) {
  return Object.freeze({
    projectId: safeProjectId(values.projectId),
    characterJobId: safeProjectJobId(values.characterJobId, 'Character Job id'),
    sceneJobId: safeProjectJobId(values.sceneJobId, 'Scene Job id'),
    strictStyleContract: Boolean(values.strictStyleContract),
  })
}

function abortError(signal) {
  const error = signal?.reason instanceof Error ? signal.reason : new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

async function withDeadline(operation, {
  signal,
  timeoutMs,
  timeoutCode = 'request_timeout',
  timeoutMessage = 'Request timed out',
} = {}) {
  throwIfAborted(signal)
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => {
      controller.abort(signal?.reason)
      finish(reject, abortError(signal))
    }
    const timer = setTimeout(() => {
      controller.abort()
      finish(reject, projectError(timeoutCode, timeoutMessage))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, signal?.aborted ? abortError(signal) : error),
      )
  })
}

async function readBytesBounded(response, limit, label, signal) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    throw projectError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw projectError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw projectError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const { signal, timeoutMs = PROJECT_REQUEST_TIMEOUT_MS, ...requestOptions } = options
  return withDeadline(async (effectiveSignal) => {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        ...requestOptions,
        signal: effectiveSignal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof StudioProjectApiError) throw error
      throw projectError('request_failed', `${url} request failed`, { cause: error })
    }
    let payload
    try {
      const bytes = await readBytesBounded(response, 4 * 1024 * 1024, `${url} response`, effectiveSignal)
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof StudioProjectApiError) throw error
      throw projectError('invalid_json_response', `${url} returned invalid JSON`, {
        status: response.status,
        cause: error,
      })
    }
    if (!response.ok) {
      throw projectError(
        String(payload?.error || payload?.code || 'request_rejected'),
        String(payload?.reason || `${url} returned ${response.status}`),
        { status: response.status, payload },
      )
    }
    if (!isRecord(payload)) throw projectError('invalid_json_response', `${url} returned an invalid object`)
    return payload
  }, {
    signal,
    timeoutMs,
    timeoutMessage: `${url} did not complete before the deadline`,
  })
}

export function assertProjectArtifactUrl(value, expectedFile, {
  jobId,
  locationValue = globalThis.location,
} = {}) {
  const text = String(value ?? '')
  if (!text) throw projectError('artifact_missing', `Required artifact ${expectedFile} is missing`)
  const rootRelative = text.startsWith('/generated/')
  const absoluteHttp = /^https?:\/\//i.test(text)
  if (!rootRelative && !absoluteHttp) {
    throw projectError('artifact_url_invalid', `Artifact URL must be root-relative or same-origin HTTP(S): ${text}`)
  }
  let parsed
  try {
    parsed = new URL(text, locationValue?.origin || 'http://local.invalid')
  } catch (error) {
    throw projectError('artifact_url_invalid', `Artifact URL is invalid: ${text}`, { cause: error })
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.startsWith('/generated/')
  ) {
    throw projectError('artifact_url_invalid', `Artifact URL is outside /generated/: ${text}`)
  }
  if (absoluteHttp && locationValue?.origin && parsed.origin !== locationValue.origin) {
    throw projectError('artifact_origin_mismatch', `Artifact URL is not same-origin: ${text}`)
  }
  const expectedPath = `/generated/${safeProjectJobId(jobId)}/${expectedFile}`
  if (parsed.pathname !== expectedPath) {
    throw projectError('artifact_binding_mismatch', `Artifact URL is not bound to ${expectedPath}`)
  }
  return parsed.pathname
}

function validateArtifactFields(job) {
  const safeJob = { ...job }
  const jobId = safeProjectJobId(job.id)
  for (const [field, file] of Object.entries(PROJECT_ARTIFACT_FIELDS)) {
    if (!job[field]) continue
    safeJob[field] = assertProjectArtifactUrl(job[field], file, { jobId })
  }
  return safeJob
}

function assertExpectedBinding(job, expectedInputs) {
  if (!expectedInputs) return
  const inputs = normalizeProjectInputs(expectedInputs)
  if (
    job.project_id !== inputs.projectId ||
    job.character_job_id !== inputs.characterJobId ||
    job.scene_job_id !== inputs.sceneJobId
  ) {
    throw projectError('job_binding_mismatch', 'Project Job does not match the submitted project and child Job ids')
  }
}

export function assertProjectJob(job, { terminal = false, expectedInputs = null } = {}) {
  if (!isRecord(job)) throw projectError('invalid_job', 'Project API returned an invalid Job')
  if (job.status === 'not_found') throw projectError('job_not_found', 'The current server session no longer has this Project Job')
  safeProjectJobId(job.id)
  if (!RUNNING_JOB_STATUSES.has(job.status) && !TERMINAL_JOB_STATUSES.has(job.status)) {
    throw projectError('invalid_job_status', `Unsupported Project Job status: ${String(job.status ?? '')}`)
  }
  if (job.type !== undefined && job.type !== 'project_pack') {
    throw projectError('job_binding_mismatch', `Expected a Project Pack Job, received ${String(job.type)}`)
  }
  assertExpectedBinding(job, expectedInputs)
  const safeJob = validateArtifactFields(job)
  if (terminal && safeJob.status === 'done') {
    for (const field of ['project_manifest_url', 'project_validation_url']) {
      if (!safeJob[field]) throw projectError('artifact_missing', `Done Project Job omitted ${field}`, { payload: { job: safeJob } })
    }
    if (!safeJob.project_pack_zip_url && !safeJob.zip_url) {
      throw projectError('artifact_missing', 'Done Project Job omitted project_pack.zip', { payload: { job: safeJob } })
    }
  }
  if (terminal && safeJob.status === 'failed_project_pack') {
    for (const field of ['project_manifest_url', 'project_validation_url']) {
      if (!safeJob[field]) throw projectError('artifact_missing', `Failed Project Job omitted diagnostic ${field}`, { payload: { job: safeJob } })
    }
  }
  return Object.freeze(safeJob)
}

export async function postProjectPack(inputs, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const normalized = normalizeProjectInputs(inputs)
  const job = await requestJson('/api/project-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(normalized),
    signal,
  }, fetchImpl)
  return assertProjectJob(job, { expectedInputs: normalized })
}

export async function pollProjectJob(job, {
  expectedInputs,
  fetchImpl = globalThis.fetch,
  signal,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onUpdate = () => {},
  limit = PROJECT_POLL_LIMIT,
  intervalMs = PROJECT_POLL_INTERVAL_MS,
} = {}) {
  const inputs = normalizeProjectInputs(expectedInputs)
  let current = assertProjectJob(job, { expectedInputs: inputs })
  const observedJobId = safeProjectJobId(current.id)
  onUpdate(current)
  for (let index = 0; RUNNING_JOB_STATUSES.has(current.status) && index < limit; index += 1) {
    throwIfAborted(signal)
    await sleepImpl(intervalMs)
    try {
      const nextPayload = await requestJson(`/api/jobs/${observedJobId}`, {
        method: 'GET',
        signal,
      }, fetchImpl)
      const next = assertProjectJob(nextPayload, { terminal: true, expectedInputs: inputs })
      if (next.id !== observedJobId) {
        throw projectError('job_binding_mismatch', `Project Job observation changed from ${observedJobId} to ${next.id}`)
      }
      current = next
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      if (error instanceof StudioProjectApiError && error.code === 'job_not_found') {
        throw projectError('job_not_found', 'The current server session no longer has this Project Job', {
          payload: { job: current },
          cause: error,
        })
      }
      if (error instanceof StudioProjectApiError && [
        'artifact_missing',
        'artifact_url_invalid',
        'artifact_origin_mismatch',
        'artifact_binding_mismatch',
        'job_binding_mismatch',
        'invalid_job',
        'invalid_job_status',
      ].includes(error.code)) throw error
      throw projectError('poll_interrupted', 'Observation of the existing Project Job was interrupted', {
        payload: { job: current, cause_code: error?.code ?? null },
        cause: error,
      })
    }
    onUpdate(current)
  }
  if (RUNNING_JOB_STATUSES.has(current.status)) {
    throw projectError('poll_interrupted', 'Project Job observation deadline reached; resume this same Job', {
      payload: { job: current },
    })
  }
  return assertProjectJob(current, { terminal: true, expectedInputs: inputs })
}

export async function fetchProjectJsonArtifact(url, {
  expectedFile,
  jobId,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const safeUrl = assertProjectArtifactUrl(url, expectedFile, { jobId })
  return requestJson(safeUrl, {
    method: 'GET',
    signal,
    timeoutMs: PROJECT_ARTIFACT_TIMEOUT_MS,
  }, fetchImpl)
}

function validateProjectManifest(manifest, inputs) {
  if (
    !isRecord(manifest) ||
    manifest.version !== 'scene_character_project_v0' ||
    manifest.project_id !== inputs.projectId ||
    !manifest.packs?.character?.id ||
    !manifest.packs?.character?.profile ||
    !manifest.packs?.scene?.id ||
    !manifest.packs?.scene?.profile ||
    !manifest.style_contract?.mode ||
    !manifest.style_contract?.palette
  ) {
    throw projectError('manifest_binding_mismatch', 'Project manifest does not match the submitted Project binding')
  }
  return manifest
}

function validateProjectValidation(validation, inputs) {
  const expectedPolicy = inputs.strictStyleContract ? 'strict' : 'warn'
  if (
    !isRecord(validation) ||
    !['pass', 'warning'].includes(validation.status) ||
    !Array.isArray(validation.blocking_errors) ||
    validation.blocking_errors.length > 0 ||
    !Array.isArray(validation.warnings) ||
    validation.style_contract?.policy !== expectedPolicy
  ) {
    throw projectError('validation_binding_mismatch', 'Project validation does not unlock verified download for the submitted policy')
  }
  return validation
}

function validateProjectFailureValidation(validation, inputs) {
  const expectedPolicy = inputs.strictStyleContract ? 'strict' : 'warn'
  if (
    !isRecord(validation) ||
    validation.status !== 'fail' ||
    !Array.isArray(validation.blocking_errors) ||
    validation.blocking_errors.length === 0 ||
    !Array.isArray(validation.warnings) ||
    validation.style_contract?.policy !== expectedPolicy
  ) {
    throw projectError('validation_binding_mismatch', 'Project failure diagnostics do not match the submitted policy')
  }
  return validation
}

export async function verifyProjectResult(job, expectedInputs, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const inputs = normalizeProjectInputs(expectedInputs)
  const safeJob = assertProjectJob(job, { terminal: true, expectedInputs: inputs })
  if (safeJob.status !== 'done') {
    throw projectError('release_locked', 'Only a done Project Job can unlock verified download', { payload: { job: safeJob } })
  }
  const [manifest, validation] = await Promise.all([
    fetchProjectJsonArtifact(safeJob.project_manifest_url, {
      expectedFile: 'project_manifest.json',
      jobId: safeJob.id,
      fetchImpl,
      signal,
    }),
    fetchProjectJsonArtifact(safeJob.project_validation_url, {
      expectedFile: 'project_validation.json',
      jobId: safeJob.id,
      fetchImpl,
      signal,
    }),
  ])
  return Object.freeze({
    job: safeJob,
    manifest: Object.freeze(validateProjectManifest(manifest, inputs)),
    validation: Object.freeze(validateProjectValidation(validation, inputs)),
    artifacts: Object.freeze(releaseProjectArtifacts(safeJob)),
  })
}

export async function verifyProjectFailureDiagnostics(job, expectedInputs, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const inputs = normalizeProjectInputs(expectedInputs)
  const safeJob = assertProjectJob(job, { terminal: true, expectedInputs: inputs })
  if (safeJob.status !== 'failed_project_pack') {
    throw projectError('diagnostics_locked', 'Only a failed Project Pack Job can expose failure diagnostics', {
      payload: { job: safeJob },
    })
  }
  const [manifest, validation] = await Promise.all([
    fetchProjectJsonArtifact(safeJob.project_manifest_url, {
      expectedFile: 'project_manifest.json',
      jobId: safeJob.id,
      fetchImpl,
      signal,
    }),
    fetchProjectJsonArtifact(safeJob.project_validation_url, {
      expectedFile: 'project_validation.json',
      jobId: safeJob.id,
      fetchImpl,
      signal,
    }),
  ])
  return Object.freeze({
    job: safeJob,
    manifest: Object.freeze(validateProjectManifest(manifest, inputs)),
    validation: Object.freeze(validateProjectFailureValidation(validation, inputs)),
    artifacts: Object.freeze(diagnosticProjectArtifacts(safeJob)),
  })
}

function artifactRows(job, fields) {
  const safeJob = assertProjectJob(job, { terminal: TERMINAL_JOB_STATUSES.has(job?.status) })
  const rows = []
  const seen = new Set()
  for (const field of fields) {
    const file = PROJECT_ARTIFACT_FIELDS[field]
    const url = safeJob[field]
    if (!file || !url || seen.has(file)) continue
    seen.add(file)
    rows.push(Object.freeze({ field, file, url }))
  }
  return rows
}

export function releaseProjectArtifacts(job) {
  if (job?.status !== 'done') return []
  return artifactRows(job, [
    'project_pack_zip_url',
    'zip_url',
    'project_manifest_url',
    'project_validation_url',
  ])
}

export function diagnosticProjectArtifacts(job) {
  if (job?.status !== 'failed_project_pack') return []
  return artifactRows(job, ['project_manifest_url', 'project_validation_url'])
}

export function projectSubmissionIsDefiniteRejection(error) {
  const status = Number(error?.status)
  return Number.isInteger(status) && status >= 400 && status < 500
}

export function projectObservationCanResume(error) {
  if (['request_failed', 'request_timeout', 'poll_interrupted', 'fetch_unavailable'].includes(error?.code)) {
    return true
  }
  const status = Number(error?.status)
  return Number.isInteger(status) && status >= 500
}
