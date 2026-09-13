import { fileToBase64 } from '../dom.js'

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/
const RUNNING_JOB_STATUSES = new Set(['queued', 'generating', 'post_processing'])
const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])

export const SCENE_REQUEST_TIMEOUT_MS = 15_000
export const SCENE_ARTIFACT_TIMEOUT_MS = 20_000
export const SCENE_POLL_INTERVAL_MS = 500
export const SCENE_POLL_LIMIT = 240
export const SCENE_SOURCE_MAX_BYTES = 8 * 1024 * 1024
export const SCENE_MAX_CANDIDATES = 8

export const SCENE_ARTIFACT_FIELDS = Object.freeze({
  scene_url: 'scene.json',
  tile_atlas_url: 'tile_atlas.json',
  tile_map_url: 'tile_map.json',
  quality_gate_url: 'quality_gate.json',
  ldtk_project_url: 'project.ldtk',
  tileset_url: 'tileset.png',
  scene_pack_zip_url: 'scene_pack.zip',
  zip_url: 'scene_pack.zip',
  style_correction_url: 'style_correction.json',
  edge_conditioning_url: 'edge_conditioning.json',
  tile_conditioning_review_url: 'tile_conditioning_review.json',
  tile_conditioning_review_image_url: 'tile_conditioning_review.png',
  prompt_url: 'prompt.txt',
  generation_url: 'generation.json',
  candidate_selection_url: 'candidate_selection.json',
})

const RELEASE_FIELDS = Object.freeze([
  'scene_pack_zip_url',
  'zip_url',
  'ldtk_project_url',
  'tileset_url',
  'scene_url',
  'tile_atlas_url',
  'tile_map_url',
  'quality_gate_url',
])

const DIAGNOSTIC_FIELDS = Object.freeze([
  'quality_gate_url',
  'tile_conditioning_review_url',
  'tile_conditioning_review_image_url',
  'style_correction_url',
  'edge_conditioning_url',
  'generation_url',
  'candidate_selection_url',
  'prompt_url',
])

export class StudioSceneApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioSceneApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

function sceneError(code, message, options) {
  return new StudioSceneApiError(code, message, options)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeId(value, label) {
  const id = String(value ?? '')
  if (!SAFE_ID_PATTERN.test(id) || id.includes('..')) {
    throw sceneError('invalid_client_contract', `${label} is invalid`)
  }
  return id
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw sceneError('fetch_unavailable', 'fetch is unavailable')
  return fetchImpl
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
      finish(reject, sceneError(timeoutCode, timeoutMessage))
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
    throw sceneError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw sceneError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
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
      if (length > limit) throw sceneError('response_too_large', `${label} exceeds the ${limit}-byte limit`)
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
  const { signal, timeoutMs = SCENE_REQUEST_TIMEOUT_MS, ...requestOptions } = options
  return withDeadline(async (effectiveSignal) => {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        ...requestOptions,
        signal: effectiveSignal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof StudioSceneApiError) throw error
      throw sceneError('request_failed', `${url} request failed`, { cause: error })
    }
    let payload
    try {
      const bytes = await readBytesBounded(response, 4 * 1024 * 1024, `${url} response`, effectiveSignal)
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof StudioSceneApiError) throw error
      throw sceneError('invalid_json_response', `${url} returned invalid JSON`, {
        status: response.status,
        cause: error,
      })
    }
    if (!response.ok) {
      throw sceneError(
        String(payload?.error || payload?.code || 'request_rejected'),
        String(payload?.reason || `${url} returned ${response.status}`),
        { status: response.status, payload },
      )
    }
    if (!isRecord(payload)) throw sceneError('invalid_json_response', `${url} returned an invalid object`)
    return payload
  }, {
    signal,
    timeoutMs,
    timeoutMessage: `${url} did not complete before the deadline`,
  })
}

function integerOption(value, name, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw sceneError('invalid_scene_options', `${name} must be an integer from ${min} to ${max}`)
  }
  return number
}

function densityOption(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw sceneError('invalid_scene_options', 'density must be between 0 and 1')
  }
  return number
}

export function normalizeSceneOptions(values = {}) {
  const pattern = String(values.pattern ?? 'island')
  if (!['island', 'path', 'solid', 'rule'].includes(pattern)) {
    throw sceneError('invalid_scene_options', 'pattern is invalid')
  }
  const styleSnap = Boolean(values.styleSnap)
  const edgeCondition = Boolean(values.edgeCondition)
  const rawTilePolicy = String(values.rawTilePolicy ?? 'warn') === 'strict' ? 'strict' : 'warn'
  return Object.freeze({
    projectId: 'scene_studio_project',
    identifier: 'scene_studio',
    width: integerOption(values.width ?? 6, 'width', 1, 16),
    height: integerOption(values.height ?? 4, 'height', 1, 16),
    pattern,
    seed: integerOption(values.seed ?? 1, 'seed', -2_147_483_648, 2_147_483_647),
    density: densityOption(values.density ?? 0.5),
    styleSnap,
    styleMaxColors: integerOption(values.styleMaxColors ?? 16, 'styleMaxColors', 1, 64),
    edgeCondition,
    edgeBand: integerOption(values.edgeBand ?? 3, 'edgeBand', 1, 8),
    edgeConditionMode: String(values.edgeConditionMode ?? 'edge-aware-v1') === 'global-v0'
      ? 'global-v0'
      : 'edge-aware-v1',
    rawTilePolicy,
    tilesetRelPath: 'tileset.png',
  })
}

function sourceTypeAccepted(file) {
  const type = String(file?.type ?? '').toLowerCase()
  if (['image/png', 'image/webp', 'image/jpeg'].includes(type)) return true
  return /\.(?:png|webp|jpe?g)$/i.test(String(file?.name ?? ''))
}

async function validatedSourceBase64(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw sceneError('source_required', 'A PNG, WebP, or JPEG tile sheet is required')
  }
  if (!sourceTypeAccepted(file)) {
    throw sceneError('source_type_invalid', 'Scene tile sheets must be PNG, WebP, or JPEG')
  }
  const declaredSize = Number(file.size)
  if (Number.isFinite(declaredSize) && declaredSize > SCENE_SOURCE_MAX_BYTES) {
    throw sceneError('source_too_large', 'Scene tile sheets must be 8 MiB or smaller')
  }
  const base64 = await fileToBase64(file)
  const approximateBytes = Math.floor(base64.length * 3 / 4)
  if (approximateBytes > SCENE_SOURCE_MAX_BYTES) {
    throw sceneError('source_too_large', 'Scene tile sheets must be 8 MiB or smaller')
  }
  return base64
}

function candidateCount(value) {
  return integerOption(value ?? 1, 'candidateCount', 1, SCENE_MAX_CANDIDATES)
}

export function sceneSubmissionIsDefiniteRejection(error) {
  const status = Number(error?.status)
  return Number.isInteger(status) && status >= 400 && status < 500
}

export async function postSceneImport({
  file,
  options = {},
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const body = {
    source_base64: await validatedSourceBase64(file),
    source_name: String(file.name || 'scene_tiles.png'),
    options: normalizeSceneOptions(options),
  }
  const job = await requestJson('/api/process-scene-tiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  return assertSceneJob(job)
}

export async function postSceneGeneration({
  description,
  candidateCount: requestedCandidates = 1,
  confirmed = false,
  options = {},
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const cleanDescription = String(description ?? '').trim()
  if (!cleanDescription) throw sceneError('description_required', 'A scene tile description is required')
  if (!confirmed) throw sceneError('live_confirmation_required', 'Live Scene generation requires explicit confirmation')
  const count = candidateCount(requestedCandidates)
  const body = {
    confirm_live_generation: true,
    description: cleanDescription,
    options: {
      ...normalizeSceneOptions(options),
      candidateCount: count,
    },
  }
  const job = await requestJson('/api/generate-scene-tiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  return assertSceneJob(job, { expectedMode: 'live' })
}

export function assertSceneArtifactUrl(value, expectedFile = null, {
  locationValue = globalThis.location,
  exactPath = null,
} = {}) {
  const text = String(value ?? '')
  if (!text) throw sceneError('artifact_missing', `Required artifact ${expectedFile ?? 'URL'} is missing`)
  const rootRelative = text.startsWith('/generated/')
  const absoluteHttp = /^https?:\/\//i.test(text)
  if (!rootRelative && !absoluteHttp) {
    throw sceneError('artifact_url_invalid', `Artifact URL must be root-relative or same-origin HTTP(S): ${text}`)
  }
  let parsed
  try {
    parsed = new URL(text, locationValue?.origin || 'http://local.invalid')
  } catch (error) {
    throw sceneError('artifact_url_invalid', `Artifact URL is invalid: ${text}`, { cause: error })
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.startsWith('/generated/')
  ) {
    throw sceneError('artifact_url_invalid', `Artifact URL is outside /generated/: ${text}`)
  }
  if (absoluteHttp && locationValue?.origin && parsed.origin !== locationValue.origin) {
    throw sceneError('artifact_origin_mismatch', `Artifact URL is not same-origin: ${text}`)
  }
  if (expectedFile && !parsed.pathname.endsWith(`/${expectedFile}`)) {
    throw sceneError('artifact_binding_mismatch', `Artifact URL does not end with ${expectedFile}`)
  }
  if (exactPath && parsed.pathname !== exactPath) {
    throw sceneError('artifact_binding_mismatch', `Artifact URL is not bound to ${exactPath}`)
  }
  return parsed.pathname
}

function validateArtifactFields(job) {
  const safeJob = { ...job }
  const jobId = safeId(job.id, 'Job id')
  for (const [field, file] of Object.entries(SCENE_ARTIFACT_FIELDS)) {
    if (!job[field]) continue
    safeJob[field] = assertSceneArtifactUrl(job[field], file, {
      exactPath: `/generated/${jobId}/${file}`,
    })
  }
  return safeJob
}

export function assertSceneJob(job, { terminal = false, expectedMode = null } = {}) {
  if (!isRecord(job)) throw sceneError('invalid_job', 'Scene API returned an invalid Job')
  safeId(job.id, 'Job id')
  if (!RUNNING_JOB_STATUSES.has(job.status) && !TERMINAL_JOB_STATUSES.has(job.status)) {
    throw sceneError('invalid_job_status', `Unsupported Scene Job status: ${String(job.status ?? '')}`)
  }
  if (expectedMode === 'live' && job.type !== undefined && job.type !== 'scene_tile_generation') {
    throw sceneError('job_binding_mismatch', `Expected a Scene generation Job, received ${String(job.type)}`)
  }
  const safeJob = validateArtifactFields(job)
  if (terminal && job.status === 'done') {
    for (const field of ['scene_url', 'tile_atlas_url', 'tile_map_url', 'quality_gate_url', 'ldtk_project_url']) {
      if (!safeJob[field]) throw sceneError('artifact_missing', `Done Scene Job omitted ${field}`, { payload: { job: safeJob } })
    }
    if (!safeJob.scene_pack_zip_url && !safeJob.zip_url) {
      throw sceneError('artifact_missing', 'Done Scene Job omitted scene_pack.zip', { payload: { job: safeJob } })
    }
  }
  return Object.freeze(safeJob)
}

export async function pollSceneJob(job, {
  expectedMode = null,
  fetchImpl = globalThis.fetch,
  signal,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onUpdate = () => {},
  limit = SCENE_POLL_LIMIT,
  intervalMs = SCENE_POLL_INTERVAL_MS,
} = {}) {
  let current = assertSceneJob(job, { expectedMode })
  const observedJobId = safeId(current.id, 'Job id')
  onUpdate(current)
  for (let index = 0; RUNNING_JOB_STATUSES.has(current.status) && index < limit; index += 1) {
    throwIfAborted(signal)
    await sleepImpl(intervalMs)
    try {
      const next = assertSceneJob(await requestJson(`/api/jobs/${observedJobId}`, {
        method: 'GET',
        signal,
      }, fetchImpl), { terminal: true, expectedMode })
      if (next.id !== observedJobId) {
        throw sceneError('job_binding_mismatch', `Scene Job observation changed from ${observedJobId} to ${next.id}`)
      }
      current = next
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      if (error?.status === 404 || error?.code === 'job_not_found' || error?.code === 'not_found') {
        throw sceneError('job_not_found', 'The current server session no longer has this Scene Job', {
          status: error.status,
          payload: { job: current },
          cause: error,
        })
      }
      if (error instanceof StudioSceneApiError && [
        'artifact_missing',
        'artifact_url_invalid',
        'artifact_origin_mismatch',
        'artifact_binding_mismatch',
        'job_binding_mismatch',
        'invalid_job',
        'invalid_job_status',
      ].includes(error.code)) throw error
      throw sceneError('poll_interrupted', 'Observation of the existing Scene Job was interrupted', {
        payload: { job: current, cause_code: error?.code ?? null },
        cause: error,
      })
    }
    onUpdate(current)
  }
  if (RUNNING_JOB_STATUSES.has(current.status)) {
    throw sceneError('poll_interrupted', 'Scene Job observation deadline reached; resume this same Job', {
      payload: { job: current },
    })
  }
  return assertSceneJob(current, { terminal: true, expectedMode })
}

function artifactRows(job, fields) {
  const safeJob = assertSceneJob(job, { terminal: TERMINAL_JOB_STATUSES.has(job?.status) })
  const seen = new Set()
  return Object.freeze(fields.flatMap((field) => {
    const url = safeJob[field]
    const file = SCENE_ARTIFACT_FIELDS[field]
    if (!url || seen.has(url)) return []
    seen.add(url)
    return [Object.freeze({ field, file, url })]
  }))
}

export function releaseSceneArtifacts(job) {
  if (job?.status !== 'done') return Object.freeze([])
  return artifactRows(job, RELEASE_FIELDS)
}

export function diagnosticSceneArtifacts(job) {
  if (!job?.id) return Object.freeze([])
  return artifactRows(job, DIAGNOSTIC_FIELDS)
}

export async function fetchSceneJsonArtifact(url, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const safeUrl = assertSceneArtifactUrl(url)
  return requestJson(safeUrl, {
    method: 'GET',
    signal,
    timeoutMs: SCENE_ARTIFACT_TIMEOUT_MS,
  }, fetchImpl)
}

export function isSceneRunningStatus(status) {
  return RUNNING_JOB_STATUSES.has(status)
}

export function isSceneTerminalStatus(status) {
  return TERMINAL_JOB_STATUSES.has(status)
}
