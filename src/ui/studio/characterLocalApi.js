import { assertRelativeGeneratedUrl } from './characterApi.js'
import {
  buildAdvancedLocalCharacterOptions,
  validateAdvancedLocalSourceFile,
} from './characterAdvancedLocal.js'

const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const LOCAL_FILE_TYPES = new Set(['image/png', 'image/webp'])
const LOCAL_FILE_NAME_PATTERN = /\.(?:png|webp)$/i

export const LOCAL_CHARACTER_FILE_LIMIT_BYTES = 32 * 1024 * 1024
export const LOCAL_CHARACTER_POLL_LIMIT = 240
export const LOCAL_CHARACTER_POLL_INTERVAL_MS = 500
export const LOCAL_CHARACTER_REQUEST_TIMEOUT_MS = 15_000
export const LOCAL_CHARACTER_ARTIFACT_LIMIT_BYTES = 16 * 1024 * 1024

export const LOCAL_CHARACTER_DEFAULTS = Object.freeze({
  sourceLayout: 'topdown_rpg_v0',
  description: '',
  backgroundMode: 'auto',
  backgroundTolerance: 24,
  anchorOffset: Object.freeze({ x: 0, y: 0 }),
  frameAdjustments: Object.freeze([]),
  lockedAnimations: Object.freeze([]),
  manualOverrides: null,
  autoCorrect: true,
  componentCleanup: true,
  minAlpha: 18,
  minArea: 4,
  minAreaRatio: 0,
  motionStabilize: true,
  motionMaxShift: 2,
  pixelFinishing: false,
  pixelFinishingMaxColors: 16,
  pixelFinishingOutline: true,
  pixelFinishingOutlineMode: 'outer',
  styleReport: false,
  styleMaxColors: 16,
  export1x: true,
  export2x: true,
  export3x: false,
  export4x: false,
})

export const LOCAL_CHARACTER_RELEASE_URLS = Object.freeze({
  source_url: 'source.png',
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

const LOCAL_TERMINAL_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

const LOCAL_ACTIVE_STATUSES = new Set(['queued', 'post_processing'])

export class StudioCharacterLocalApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioCharacterLocalApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

function localError(code, message, options) {
  return new StudioCharacterLocalApiError(code, message, options)
}

function abortError(signal) {
  if (signal?.reason?.name === 'AbortError') return signal.reason
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw localError('fetch_unavailable', 'fetch is unavailable')
  }
  return fetchImpl
}

function assertSafeJobId(value) {
  const jobId = String(value ?? '')
  if (!SAFE_JOB_ID_PATTERN.test(jobId) || jobId.includes('..')) {
    throw localError('invalid_job_receipt', 'Local Character Job id is invalid')
  }
  return jobId
}

async function readResponseBytes(response, label, {
  signal,
  callerSignal,
  didTimeout = () => false,
  maxBytes = LOCAL_CHARACTER_ARTIFACT_LIMIT_BYTES,
} = {}) {
  throwIfAborted(callerSignal)
  if (didTimeout()) throw localError('request_timeout', `${label} timed out`)
  if (signal?.aborted) throw localError('request_failed', `${label} response body read failed`)
  const declared = response.headers?.get?.('content-length')
  if (declared != null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw localError('response_size_exceeded', `${label} exceeds its size limit`)
    }
  }
  let bytes
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (callerSignal?.aborted) throw abortError(callerSignal)
    if (didTimeout()) throw localError('request_timeout', `${label} timed out`, { cause: error })
    if (signal?.aborted) throw localError('request_failed', `${label} response body read failed`, { cause: error })
    throw localError('invalid_json_response', `${label} could not be read`, { cause: error })
  }
  if (callerSignal?.aborted) throw abortError(callerSignal)
  if (didTimeout()) throw localError('request_timeout', `${label} timed out`)
  if (signal?.aborted) throw localError('request_failed', `${label} response body read failed`)
  if (!bytes.length || bytes.length > maxBytes) {
    throw localError('response_size_exceeded', `${label} is empty or exceeds its size limit`)
  }
  return bytes
}

async function readJsonResponse(response, label, options) {
  const bytes = await readResponseBytes(response, label, options)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw localError('invalid_json_response', `${label} returned invalid JSON`, { cause: error })
  }
}

async function readTextResponse(response, label, options) {
  const bytes = await readResponseBytes(response, label, options)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw localError('invalid_text_response', `${label} returned invalid UTF-8 text`, { cause: error })
  }
}

async function requestStudioCharacterValue(url, options, fetchImpl, readResponse) {
  const {
    signal,
    timeoutMs = LOCAL_CHARACTER_REQUEST_TIMEOUT_MS,
    maxBytes = LOCAL_CHARACTER_ARTIFACT_LIMIT_BYTES,
    ...requestOptions
  } = options
  throwIfAborted(signal)
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        ...requestOptions,
        signal: controller.signal,
        redirect: 'error',
      })
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (timedOut) throw localError('request_timeout', `${url} timed out`, { cause: error })
      throw localError('request_failed', `${url} request failed`, { cause: error })
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw localError('invalid_json_response', `${url} returned no response`)
    }
    const payload = await readResponse(response, url, {
      signal: controller.signal,
      callerSignal: signal,
      didTimeout: () => timedOut,
      maxBytes,
    })
    if (!response.ok) {
      throw localError(
        response.status === 404 ? 'job_not_found' : 'http_error',
        `${url} returned HTTP ${response.status}`,
        { status: response.status, payload },
      )
    }
    return payload
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function requestStudioCharacterJson(url, options = {}, fetchImpl = globalThis.fetch) {
  return requestStudioCharacterValue(url, options, fetchImpl, readJsonResponse)
}

export async function requestStudioCharacterText(url, options = {}, fetchImpl = globalThis.fetch) {
  return requestStudioCharacterValue(url, options, fetchImpl, readTextResponse)
}

function fileNameStem(name) {
  const stem = String(name ?? '').replace(/\.[^.]*$/, '').trim()
  return stem.slice(0, 64) || 'character'
}

export function validateLocalCharacterFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw localError('source_required', 'Choose a PNG or WebP sprite sheet')
  }
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > LOCAL_CHARACTER_FILE_LIMIT_BYTES) {
    throw localError('source_size_invalid', 'Source must be between 1 byte and 32 MiB')
  }
  const type = String(file.type ?? '').toLowerCase()
  const name = String(file.name ?? '')
  if (!(LOCAL_FILE_TYPES.has(type) || (!type && LOCAL_FILE_NAME_PATTERN.test(name)))) {
    throw localError('source_type_invalid', 'Source must be PNG or WebP')
  }
  return file
}

export function normalizeLocalCharacterName(value, fileName = '') {
  const name = String(value ?? '').trim() || fileNameStem(fileName)
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw localError('name_invalid', 'Resource name must contain 1–64 visible characters')
  }
  return name
}

export function buildLocalCharacterOptions({ file, name }) {
  validateLocalCharacterFile(file)
  return {
    ...LOCAL_CHARACTER_DEFAULTS,
    anchorOffset: { ...LOCAL_CHARACTER_DEFAULTS.anchorOffset },
    frameAdjustments: [],
    lockedAnimations: [],
    name: normalizeLocalCharacterName(name, file.name),
    sourceFileName: String(file.name ?? ''),
  }
}

export async function encodeLocalCharacterFile(file, {
  signal,
  validate = validateLocalCharacterFile,
} = {}) {
  validate(file)
  throwIfAborted(signal)
  const bytes = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(signal)
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

export function assertLocalCharacterJob(job, { terminal = false } = {}) {
  if (!isRecord(job)) throw localError('invalid_job_receipt', 'Local Character Job is missing')
  const id = assertSafeJobId(job.id)
  const status = String(job.status ?? '')
  if (!LOCAL_ACTIVE_STATUSES.has(status) && !LOCAL_TERMINAL_STATUSES.has(status)) {
    throw localError('invalid_job_receipt', `Unexpected local Character Job status: ${status}`)
  }
  if (terminal && !LOCAL_TERMINAL_STATUSES.has(status)) {
    throw localError('job_not_terminal', 'Local Character Job did not reach a terminal status')
  }
  for (const [field, fileName] of Object.entries(LOCAL_CHARACTER_RELEASE_URLS)) {
    if (status === 'done') {
      assertRelativeGeneratedUrl(job[field], { jobId: id, fileName })
    } else if (job[field] != null) {
      assertRelativeGeneratedUrl(job[field], { jobId: id, fileName })
    }
  }
  return job
}

export async function submitLocalCharacterJob({ file, name }, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const options = buildLocalCharacterOptions({ file, name })
  const sourceBase64 = await encodeLocalCharacterFile(file, { signal })
  const job = await requestStudioCharacterJson('/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: sourceBase64,
      source_black_base64: null,
      options,
    }),
    signal,
    maxBytes: 4 * 1024 * 1024,
  }, fetchImpl)
  return assertLocalCharacterJob(job)
}

export async function submitAdvancedLocalCharacterJob({
  file,
  blackFile = null,
  blackDimensions = null,
  dimensions,
  name,
  settings,
}, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const options = buildAdvancedLocalCharacterOptions({
    file,
    blackFile,
    blackDimensions,
    dimensions,
    name,
    settings,
  })
  validateAdvancedLocalSourceFile(file)
  const sourceBase64 = await encodeLocalCharacterFile(file, {
    signal,
    validate: validateAdvancedLocalSourceFile,
  })
  const blackSourceBase64 = options.backgroundMode === 'dual_matte'
    ? await encodeLocalCharacterFile(blackFile, {
        signal,
        validate: (value) => validateAdvancedLocalSourceFile(value, { label: 'Black-matte pairing' }),
      })
    : null
  const job = await requestStudioCharacterJson('/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: sourceBase64,
      source_black_base64: blackSourceBase64,
      options,
    }),
    signal,
    maxBytes: 4 * 1024 * 1024,
  }, fetchImpl)
  return assertLocalCharacterJob(job)
}

function wait(ms, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function fetchLocalCharacterJob(jobId, {
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = LOCAL_CHARACTER_REQUEST_TIMEOUT_MS,
} = {}) {
  const id = assertSafeJobId(jobId)
  const job = await requestStudioCharacterJson(`/api/jobs/${encodeURIComponent(id)}`, {
    signal,
    timeoutMs,
    maxBytes: 4 * 1024 * 1024,
  }, fetchImpl)
  if (String(job?.id ?? '') !== id) {
    throw localError('job_binding_mismatch', 'Polled Job does not match the submitted Job')
  }
  return assertLocalCharacterJob(job)
}

export async function pollLocalCharacterJob(initialJob, {
  signal,
  fetchImpl = globalThis.fetch,
  intervalMs = LOCAL_CHARACTER_POLL_INTERVAL_MS,
  pollLimit = LOCAL_CHARACTER_POLL_LIMIT,
  onUpdate = () => {},
} = {}) {
  let current = assertLocalCharacterJob(initialJob)
  onUpdate(current)
  for (let index = 0; !LOCAL_TERMINAL_STATUSES.has(current.status) && index < pollLimit; index += 1) {
    await wait(intervalMs, signal)
    current = await fetchLocalCharacterJob(current.id, { signal, fetchImpl })
    onUpdate(current)
  }
  if (!LOCAL_TERMINAL_STATUSES.has(current.status)) {
    throw localError('poll_interrupted', 'Local Character Job observation reached its fixed limit', {
      payload: current,
    })
  }
  return assertLocalCharacterJob(current, { terminal: true })
}

export function assertLocalCharacterDebugReport(report, { requireRelease = false } = {}) {
  const validation = report?.validation
  if (
    !isRecord(report) ||
    !isRecord(validation) ||
    !['pass', 'warning', 'fail'].includes(validation.status) ||
    !Array.isArray(validation.warnings) ||
    !Array.isArray(validation.blocking_errors)
  ) {
    throw localError('invalid_quality_report', 'Quality Report is malformed')
  }
  if (
    requireRelease &&
    (!['pass', 'warning'].includes(validation.status) || validation.blocking_errors.length !== 0)
  ) {
    throw localError('quality_gate_blocked', 'Quality Report does not permit verified downloads', { payload: report })
  }
  return report
}

export function assertLocalCharacterAnimations(animations, { expectedSourceLayout = null } = {}) {
  if (
    !isRecord(animations) ||
    animations.profile !== LOCAL_CHARACTER_DEFAULTS.sourceLayout ||
    !isRecord(animations.frame_size) ||
    !isRecord(animations.sheet_size) ||
    !isRecord(animations.animations) ||
    Object.keys(animations.animations).length === 0
  ) {
    throw localError('invalid_animations', 'Animations manifest is malformed')
  }
  for (const dimension of [
    animations.frame_size.w,
    animations.frame_size.h,
    animations.sheet_size.w,
    animations.sheet_size.h,
  ]) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw localError('invalid_animations', 'Animations dimensions are invalid')
    }
  }
  for (const animation of Object.values(animations.animations)) {
    if (
      !isRecord(animation) ||
      !Array.isArray(animation.frames) ||
      animation.frames.length === 0 ||
      animation.frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0)
    ) {
      throw localError('invalid_animations', 'Animation frames are invalid')
    }
  }
  if (
    expectedSourceLayout &&
    String(animations.source_layout?.id ?? '') !== String(expectedSourceLayout)
  ) {
    throw localError('source_layout_binding_mismatch', 'Animations source layout does not match the submitted input')
  }
  return animations
}

export async function fetchLocalCharacterArtifact(url, {
  jobId,
  fileName,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRelativeGeneratedUrl(url, { jobId: assertSafeJobId(jobId), fileName })
  return requestStudioCharacterJson(url, { signal }, fetchImpl)
}

export async function verifyLocalCharacterResult(job, {
  signal,
  fetchImpl = globalThis.fetch,
  expectedSourceLayout = null,
} = {}) {
  const terminal = assertLocalCharacterJob(job, { terminal: true })
  if (terminal.status !== 'done') {
    throw localError('job_failed', `Local Character Job ended as ${terminal.status}`, { payload: terminal })
  }
  const [debugReport, animations] = await Promise.all([
    fetchLocalCharacterArtifact(terminal.debug_report_url, {
      jobId: terminal.id,
      fileName: LOCAL_CHARACTER_RELEASE_URLS.debug_report_url,
      signal,
      fetchImpl,
    }),
    fetchLocalCharacterArtifact(terminal.animations_url, {
      jobId: terminal.id,
      fileName: LOCAL_CHARACTER_RELEASE_URLS.animations_url,
      signal,
      fetchImpl,
    }),
  ])
  return Object.freeze({
    job: terminal,
    debugReport: assertLocalCharacterDebugReport(debugReport, { requireRelease: true }),
    animations: assertLocalCharacterAnimations(animations, { expectedSourceLayout }),
  })
}

export async function fetchLocalCharacterFailureReport(job, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const terminal = assertLocalCharacterJob(job, { terminal: true })
  if (!terminal.debug_report_url) return null
  const report = await fetchLocalCharacterArtifact(terminal.debug_report_url, {
    jobId: terminal.id,
    fileName: LOCAL_CHARACTER_RELEASE_URLS.debug_report_url,
    signal,
    fetchImpl,
  })
  return assertLocalCharacterDebugReport(report)
}

export function isRecoverableLocalCharacterObservationError(error) {
  if (['request_failed', 'request_timeout', 'poll_interrupted', 'fetch_unavailable'].includes(error?.code)) {
    return true
  }
  return error?.code === 'http_error' && Number(error?.status) >= 500
}
