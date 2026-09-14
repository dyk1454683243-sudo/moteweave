const HASH_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const SAFE_GENERATED_ID_PATTERN = /^[A-Za-z0-9._-]{1,132}$/
const RAW_PROVIDER_FILE_PATTERN = /^raw_provider_output\.(?:png|jpg|webp|gif|bin)$/
const ACCEPTED_PUBLICATION_PREFIX = 'accepted_v1_'

export const STRICT_FIXED_REGION_PROFILE = Object.freeze({
  generationProfileId: 'full_sheet_fixed_region_v1',
  mode: 'production_sheet_v0',
  imageConfig: Object.freeze({ image_size: '2K', aspect_ratio: '1:1' }),
  generationOptions: Object.freeze({ candidateCount: 1 }),
  maxProviderCalls: 1,
  backgroundMode: 'deterministic_pixel_matte_v2',
})

export const STRICT_POLL_LIMIT = 240
export const STRICT_POLL_INTERVAL_MS = 500
export const STRICT_REQUEST_TIMEOUT_MS = 15_000
export const STRICT_ACCEPT_REQUEST_TIMEOUT_MS = 60_000
export const STRICT_ARTIFACT_TIMEOUT_MS = 30_000
export const STRICT_POLL_WALL_TIMEOUT_MS =
  STRICT_POLL_LIMIT * STRICT_POLL_INTERVAL_MS + STRICT_REQUEST_TIMEOUT_MS * 2

export const STRICT_JOB_STATUS = Object.freeze({
  queued: Object.freeze({ terminal: false, outcome: 'queued' }),
  generating: Object.freeze({ terminal: false, outcome: 'generating' }),
  post_processing: Object.freeze({ terminal: false, outcome: 'post_processing' }),
  done: Object.freeze({ terminal: true, outcome: 'done' }),
  failed_quality_gate: Object.freeze({ terminal: true, outcome: 'failed' }),
  failed_safety_filter: Object.freeze({ terminal: true, outcome: 'failed' }),
  failed_model_error: Object.freeze({ terminal: true, outcome: 'failed' }),
  failed_post_processing: Object.freeze({ terminal: true, outcome: 'failed' }),
  not_found: Object.freeze({ terminal: true, outcome: 'not_found' }),
})

export const STRICT_ARTIFACT_BYTE_LIMITS = Object.freeze({
  apiJson: 4 * 1024 * 1024,
  json: 16 * 1024 * 1024,
  image: 64 * 1024 * 1024,
})

export const STRICT_V2_URL_FIELDS = Object.freeze({
  background_removed_provider_output_url: 'background_removed_provider_output.png',
  background_quality_url: 'background_quality.json',
  background_review_url: 'background_review.json',
  background_contract_masks_url: 'background_contract_masks.json',
  background_preview_url: 'background_preview.png',
  background_spill_overlay_url: 'background_spill_overlay.png',
  background_sure_background_mask_url: 'background_sure_background_mask.png',
  background_unknown_band_mask_url: 'background_unknown_band_mask.png',
  background_sure_foreground_mask_url: 'background_sure_foreground_mask.png',
  background_alpha_estimate_url: 'background_alpha_estimate.png',
  background_foreground_reconstruction_url: 'background_foreground_reconstruction.png',
})

const STRICT_V2_JSON_FILES = new Set([
  STRICT_V2_URL_FIELDS.background_quality_url,
  STRICT_V2_URL_FIELDS.background_review_url,
  STRICT_V2_URL_FIELDS.background_contract_masks_url,
])

export const STRICT_ACCEPT_REQUEST_FIELDS = Object.freeze([
  'confirmManualAcceptance',
  'expectedPlanHash',
  'expectedReferenceManifestSha256',
  'expectedRawProviderOutputSha256',
  'expectedBackgroundRemovedProviderOutputSha256',
  'expectedSourceSha256',
  'expectedNormalizedSheetSha256',
  'humanReviewedIssueCount',
])

export const STRICT_ACCEPT_URL_FIELDS = Object.freeze({
  result_url: 'metadata.json',
  raw_provider_output_url: null,
  background_removed_provider_output_url: 'background_removed_provider_output.png',
  ...Object.fromEntries(Object.entries(STRICT_V2_URL_FIELDS).filter(([field]) => (
    field !== 'background_removed_provider_output_url'
  ))),
  source_url: 'source.png',
  normalized_sheet_url: 'normalized_sheet.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  generation_release_gate_url: 'generation_release_gate.json',
  manual_acceptance_url: 'manual_acceptance.json',
  generation_url: 'generation.json',
  zip_url: 'character_pack.zip',
  godot_npc_zip_url: 'godot_npc_pack.zip',
  rpgmaker_zip_url: 'rpgmaker_pack.zip',
  ocad_zip_url: 'ocad_pack.zip',
})

export class StudioCharacterApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioCharacterApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function strictError(code, message, options) {
  return new StudioCharacterApiError(code, message, options)
}

function assertSafeId(value, label) {
  const id = String(value ?? '')
  if (!SAFE_ID_PATTERN.test(id) || id.includes('..')) {
    throw strictError('invalid_client_contract', `${label} is invalid`)
  }
  return id
}

function assertHash(value, label) {
  const hash = String(value ?? '')
  if (!HASH_PATTERN.test(hash)) {
    throw strictError('invalid_client_contract', `${label} must be a lowercase SHA-256 hash`)
  }
  return hash
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw strictError('fetch_unavailable', 'fetch is unavailable')
  }
  return fetchImpl
}

function abortError(signal) {
  if (signal?.reason?.name === 'AbortError') return signal.reason
  return new DOMException('Aborted', 'AbortError')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

function runWithDeadline(operation, {
  signal,
  timeoutMs,
  timeoutCode,
  timeoutMessage,
}) {
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
      finish(reject, strictError(timeoutCode, timeoutMessage))
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

async function requestJson(url, options, fetchImpl) {
  const {
    signal,
    timeoutMs = STRICT_REQUEST_TIMEOUT_MS,
    ...requestOptions
  } = options ?? {}
  return runWithDeadline(async (effectiveSignal) => {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        ...requestOptions,
        signal: effectiveSignal,
        redirect: 'error',
      })
    } catch (error) {
      throw strictError('request_failed', `${url} request failed`, { cause: error })
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw strictError('invalid_json_response', `${url} returned no JSON response`)
    }
    let payload
    try {
      const bytes = await readResponseBytesBounded(
        response,
        STRICT_ARTIFACT_BYTE_LIMITS.apiJson,
        `${url} JSON response`,
        effectiveSignal,
      )
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof StudioCharacterApiError) throw error
      throw strictError('invalid_json_response', `${url} returned invalid JSON`, {
        status: response.status,
        cause: error,
      })
    }
    if (!response.ok) {
      throw strictError(
        payload?.error || 'request_failed',
        payload?.reason || `${url} failed: ${response.status}`,
        { status: response.status, payload },
      )
    }
    return payload
  }, {
    signal,
    timeoutMs,
    timeoutCode: 'request_timeout',
    timeoutMessage: `${url} request timed out`,
  })
}

function assertLockedValue(actual, expected, label) {
  if (actual !== undefined && actual !== null && actual !== expected) {
    throw strictError('strict_profile_override', `${label} cannot override the strict Profile`)
  }
}

function reviewImageFields(prefix, image) {
  if (image == null) return {}
  if (!isRecord(image) || typeof image.base64 !== 'string' || !image.base64) {
    throw strictError('invalid_review_input', `${prefix} image is invalid`)
  }
  return {
    [`${prefix}_image_base64`]: image.base64,
    [`${prefix}_image_mime`]: image.mimeType || 'image/png',
    [`${prefix}_image_name`]: image.name || `${prefix}.png`,
  }
}

export function buildStrictFixedRegionReviewRequest(input = {}) {
  if (!isRecord(input)) throw strictError('invalid_review_input', 'Review input must be an object')
  const allowedInputFields = new Set([
    'runId',
    'generationProfileId',
    'providerPresetId',
    'description',
    't2iMode',
    'mode',
    'imageConfig',
    'generationOptions',
    'maxProviderCalls',
    'backgroundMode',
    'promptFields',
    'characterPreset',
    'referenceImage',
    'paletteImage',
  ])
  const unknownField = Object.keys(input).find((field) => !allowedInputFields.has(field))
  if (unknownField) {
    throw strictError('invalid_review_input', `Unsupported Review input field: ${unknownField}`)
  }
  assertLockedValue(
    input.generationProfileId,
    STRICT_FIXED_REGION_PROFILE.generationProfileId,
    'generationProfileId',
  )
  assertLockedValue(input.t2iMode ?? input.mode, STRICT_FIXED_REGION_PROFILE.mode, 't2iMode')
  assertLockedValue(
    input.maxProviderCalls,
    STRICT_FIXED_REGION_PROFILE.maxProviderCalls,
    'maxProviderCalls',
  )
  assertLockedValue(
    input.backgroundMode,
    STRICT_FIXED_REGION_PROFILE.backgroundMode,
    'backgroundMode',
  )
  assertLockedValue(
    input.imageConfig?.image_size ?? input.imageConfig?.imageSize,
    STRICT_FIXED_REGION_PROFILE.imageConfig.image_size,
    'image size',
  )
  assertLockedValue(
    input.imageConfig?.aspect_ratio ?? input.imageConfig?.aspectRatio,
    STRICT_FIXED_REGION_PROFILE.imageConfig.aspect_ratio,
    'aspect ratio',
  )
  assertLockedValue(
    input.generationOptions?.candidateCount ?? input.generationOptions?.candidate_count,
    1,
    'candidate count',
  )

  const generationOptions = { candidateCount: 1 }
  for (const key of ['seed', 'temperature', 'topP', 'topK', 'qualityTier']) {
    if (input.generationOptions?.[key] !== undefined) {
      generationOptions[key] = input.generationOptions[key]
    }
  }
  const request = {
    ...(input.runId ? { runId: assertSafeId(input.runId, 'runId') } : {}),
    generationProfileId: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    ...(input.providerPresetId ? { providerPresetId: String(input.providerPresetId) } : {}),
    description: String(input.description ?? ''),
    t2iMode: STRICT_FIXED_REGION_PROFILE.mode,
    imageConfig: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    generationOptions,
    maxProviderCalls: STRICT_FIXED_REGION_PROFILE.maxProviderCalls,
    backgroundMode: STRICT_FIXED_REGION_PROFILE.backgroundMode,
    ...(input.promptFields !== undefined ? { promptFields: input.promptFields } : {}),
    ...(input.characterPreset !== undefined ? { characterPreset: input.characterPreset } : {}),
    ...reviewImageFields('reference', input.referenceImage),
    ...reviewImageFields('palette', input.paletteImage),
  }
  return request
}

export function assertSealedStrictReview(review) {
  if (
    !isRecord(review) ||
    review.mode !== 'provider_free_generation_review' ||
    review.status !== 'done' ||
    review.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    review.candidate_count !== 1 ||
    review.estimated_provider_calls !== 1 ||
    review.provider_calls_used !== 0 ||
    review.max_provider_calls !== 1 ||
    review.provider?.provider !== 'gemini' ||
    review.provider?.route_kind !== 'google_native' ||
    review.provider?.model !== review.model ||
    review.image_config?.image_size !== STRICT_FIXED_REGION_PROFILE.imageConfig.image_size ||
    review.image_config?.aspect_ratio !== STRICT_FIXED_REGION_PROFILE.imageConfig.aspect_ratio
  ) {
    throw strictError('invalid_review_response', 'Provider-free Review response violates the strict Profile')
  }
  const reviewedRunId = assertSafeId(review.reviewed_run_id, 'reviewed_run_id')
  if (review.review_id !== reviewedRunId) {
    throw strictError('invalid_review_response', 'Review identifiers do not match')
  }
  assertHash(review.plan_hash, 'plan_hash')
  assertHash(review.reference_manifest_sha256, 'reference_manifest_sha256')
  for (const [field, fileName] of Object.entries({
    generation_review_url: 'generation_review.json',
    generation_request_manifest_url: 'generation_request_manifest.json',
    generation_reference_manifest_url: 'generation_reference_manifest.json',
    generation_prompt_url: 'generation_prompt.txt',
  })) {
    assertRelativeGeneratedUrl(review[field], { jobId: reviewedRunId, fileName })
  }
  if (
    !Array.isArray(review.reference_urls) ||
    review.reference_urls.length === 0 ||
    review.reference_urls[0]?.role !== 'structure'
  ) {
    throw strictError('invalid_review_response', 'Review reference URLs are missing')
  }
  const roleOrder = ['structure', 'identity', 'palette']
  let previousRoleIndex = -1
  for (const reference of review.reference_urls) {
    if (!isRecord(reference) || typeof reference.name !== 'string' || typeof reference.role !== 'string') {
      throw strictError('invalid_review_response', 'Review reference URL is malformed')
    }
    const roleIndex = roleOrder.indexOf(reference.role)
    if (roleIndex <= previousRoleIndex) {
      throw strictError('invalid_review_response', 'Review reference role order is invalid')
    }
    previousRoleIndex = roleIndex
    assertRelativeGeneratedUrl(reference.url, { jobId: reviewedRunId, fileName: reference.name })
  }
  return review
}

export function selectStrictGeminiPreset(providerState) {
  if (!isRecord(providerState) || providerState.status !== 'ready' || !Array.isArray(providerState.presets)) {
    throw strictError(
      'gemini_not_ready',
      'Gemini is not configured for Studio. Configure the shared Gemini session in Settings first.',
    )
  }
  const supportsStrictProfile = (preset) => (
    isRecord(preset) &&
    preset.available === true &&
    preset.provider === 'gemini' &&
    preset.route_kind === 'google_native' &&
    preset.supports_image_size === true &&
    preset.image_config?.image_size === STRICT_FIXED_REGION_PROFILE.imageConfig.image_size &&
    preset.image_config?.aspect_ratio === STRICT_FIXED_REGION_PROFILE.imageConfig.aspect_ratio &&
    SAFE_ID_PATTERN.test(String(preset.id ?? '')) &&
    !String(preset.id).includes('..')
  )
  const active = providerState.presets.find((preset) => (
    preset?.id === providerState.active_preset_id && supportsStrictProfile(preset)
  ))
  const selected = active ?? providerState.presets.find(supportsStrictProfile)
  if (!selected) {
    throw strictError(
      'gemini_not_ready',
      'No available native Gemini preset satisfies the locked 2K · 1:1 Studio Profile.',
    )
  }
  return selected
}

export async function requestStrictFixedRegionReview(input, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const requestedBody = buildStrictFixedRegionReviewRequest(input)
  const providerState = await requestJson('/api/gemini-state', {
    method: 'GET',
    signal,
  }, fetchImpl)
  const providerPreset = selectStrictGeminiPreset(providerState)
  if (requestedBody.providerPresetId && requestedBody.providerPresetId !== providerPreset.id) {
    throw strictError('strict_profile_override', 'providerPresetId must match the active strict Gemini preset')
  }
  const body = { ...requestedBody, providerPresetId: providerPreset.id }
  const review = await requestJson('/api/generate-character/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  return assertSealedStrictReview(review)
}

export function buildStrictLiveGenerationRequest(review) {
  const sealed = assertSealedStrictReview(review)
  return {
    generationProfileId: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    reviewedRunId: sealed.reviewed_run_id,
    expectedPlanHash: sealed.plan_hash,
    expectedReferenceManifestSha256: sealed.reference_manifest_sha256,
    confirmLiveGeneration: true,
    maxProviderCalls: STRICT_FIXED_REGION_PROFILE.maxProviderCalls,
  }
}

export async function startStrictLiveGeneration(review, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const job = await requestJson('/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildStrictLiveGenerationRequest(review)),
    signal,
  }, fetchImpl)
  assertSafeId(job?.id, 'Job id')
  mapStrictJobStatus(job)
  return job
}

export function mapStrictJobStatus(job) {
  const status = String(job?.status ?? '')
  const mapped = STRICT_JOB_STATUS[status]
  if (!mapped) throw strictError('unknown_job_status', `Unknown strict generation Job status: ${status || '(empty)'}`)
  return mapped
}

export function delayWithSignal(milliseconds, { signal } = {}) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollStrictGenerationJob(initialJob, {
  fetchImpl = globalThis.fetch,
  delayImpl = delayWithSignal,
  onUpdate = () => {},
  signal,
} = {}) {
  return runWithDeadline(async (pollSignal) => {
    if (typeof onUpdate !== 'function') {
      throw strictError('invalid_poll_callback', 'Job update callback must be a function')
    }
    const jobId = assertSafeId(initialJob?.id, 'Job id')
    let current = initialJob
    let mappedStatus = mapStrictJobStatus(current)
    onUpdate(current)
    if (mappedStatus.terminal) return current

    for (let poll = 0; poll < STRICT_POLL_LIMIT; poll += 1) {
      throwIfAborted(pollSignal)
      await delayImpl(STRICT_POLL_INTERVAL_MS, { signal: pollSignal })
      throwIfAborted(pollSignal)
      current = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        signal: pollSignal,
      }, fetchImpl)
      if (current.status !== 'not_found' && current.id !== jobId) {
        throw strictError('job_binding_mismatch', 'Polled Job does not match the requested Job id')
      }
      mappedStatus = mapStrictJobStatus(current)
      onUpdate(current)
      if (mappedStatus.terminal) return current
    }
    throw strictError('job_poll_timeout', 'Strict generation Job polling reached its fixed limit', {
      payload: current,
    })
  }, {
    signal,
    timeoutMs: STRICT_POLL_WALL_TIMEOUT_MS,
    timeoutCode: 'job_poll_timeout',
    timeoutMessage: 'Strict generation Job observation reached its wall-clock limit',
  })
}

export function assertRelativeGeneratedUrl(value, {
  jobId = null,
  fileName = null,
  filePattern = null,
} = {}) {
  if (typeof value !== 'string' || !value.startsWith('/generated/') || /[?#\\]/.test(value)) {
    throw strictError('invalid_artifact_url', 'Artifact URL must be a relative /generated path')
  }
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw strictError('invalid_artifact_url', 'Artifact URL encoding is invalid')
  }
  if (decoded !== value || decoded.includes('//')) {
    throw strictError('invalid_artifact_url', 'Artifact URL must use a canonical relative path')
  }
  const segments = decoded.split('/')
  if (segments.length !== 4 || segments[0] !== '' || segments[1] !== 'generated') {
    throw strictError('invalid_artifact_url', 'Artifact URL shape is invalid')
  }
  const actualJobId = segments[2]
  if (!SAFE_GENERATED_ID_PATTERN.test(actualJobId) || actualJobId.includes('..')) {
    throw strictError('invalid_artifact_url', 'Artifact Job id is invalid')
  }
  const actualFileName = segments[3]
  if (!actualFileName || actualFileName === '.' || actualFileName === '..') {
    throw strictError('invalid_artifact_url', 'Artifact file name is invalid')
  }
  if (
    jobId !== null &&
    (!SAFE_GENERATED_ID_PATTERN.test(String(jobId)) || String(jobId).includes('..') || actualJobId !== String(jobId))
  ) {
    throw strictError('artifact_binding_mismatch', 'Artifact URL belongs to another Job')
  }
  if (fileName !== null && actualFileName !== fileName) {
    throw strictError('artifact_binding_mismatch', `Expected Artifact ${fileName}`)
  }
  if (filePattern !== null && !filePattern.test(actualFileName)) {
    throw strictError('artifact_binding_mismatch', 'Artifact file name violates its contract')
  }
  return value
}

export function assertReviewRequiredStrictJob(job) {
  const jobId = assertSafeId(job?.id, 'Job id')
  if (
    job.status !== 'done' ||
    job.artifact_disposition !== 'review_required' ||
    job.release_ready !== false ||
    job.manual_review_required !== true ||
    job.review_status !== 'awaiting_human_review' ||
    job.human_decision_status !== 'pending' ||
    job.failure_status !== null ||
    job.reason !== null ||
    job.provider_call_budget?.planned_provider_calls !== 1 ||
    job.provider_call_budget?.max_provider_calls !== 1 ||
    job.provider_call_budget?.used_provider_calls !== 1
  ) {
    throw strictError('job_not_reviewable', 'Job is not an exact strict full-sheet review candidate')
  }
  assertRelativeGeneratedUrl(job.generation_url, { jobId, fileName: 'generation.json' })
  assertRelativeGeneratedUrl(job.raw_provider_output_url, {
    jobId,
    filePattern: RAW_PROVIDER_FILE_PATTERN,
  })
  assertRelativeGeneratedUrl(job.source_url, { jobId, fileName: 'source.png' })
  assertRelativeGeneratedUrl(job.normalized_sheet_url, { jobId, fileName: 'normalized_sheet.png' })
  for (const [field, fileName] of Object.entries(STRICT_V2_URL_FIELDS)) {
    assertRelativeGeneratedUrl(job[field], { jobId, fileName })
  }
  return job
}

async function readResponseBytesBounded(response, maxBytes, label, signal) {
  throwIfAborted(signal)
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength != null) {
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maxBytes) {
      throw strictError('artifact_size_exceeded', `${label} exceeds its file-size contract`)
    }
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      throwIfAborted(signal)
      const { value, done } = await reader.read()
      throwIfAborted(signal)
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw strictError('artifact_size_exceeded', `${label} exceeds its file-size contract`)
      }
      chunks.push(value)
    }
    if (total <= 0) throw strictError('artifact_empty', `${label} is empty`)
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  throw strictError('artifact_stream_unavailable', `${label} cannot be read with a bounded stream`)
}

async function fetchArtifactBytes(url, {
  fetchImpl,
  signal,
  maxBytes,
  label,
}) {
  return runWithDeadline(async (effectiveSignal) => {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        method: 'GET',
        signal: effectiveSignal,
        redirect: 'error',
      })
    } catch (error) {
      throw strictError('artifact_fetch_failed', `${label} fetch failed`, { cause: error })
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw strictError('artifact_fetch_failed', `${label} returned no response`)
    }
    if (!response.ok) {
      throw strictError('artifact_fetch_failed', `${label} fetch failed: ${response.status}`, {
        status: response.status,
      })
    }
    return readResponseBytesBounded(response, maxBytes, label, effectiveSignal)
  }, {
    signal,
    timeoutMs: STRICT_ARTIFACT_TIMEOUT_MS,
    timeoutCode: 'artifact_fetch_timeout',
    timeoutMessage: `${label} fetch timed out`,
  })
}

export async function sha256Bytes(value, { cryptoImpl = globalThis.crypto } = {}) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  if (!cryptoImpl?.subtle?.digest) {
    throw strictError('crypto_unavailable', 'Web Crypto SHA-256 is unavailable')
  }
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseGenerationJson(bytes) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isRecord(value)) throw new Error('generation JSON must be an object')
    return value
  } catch (error) {
    throw strictError('invalid_generation_artifact', 'generation.json is malformed', { cause: error })
  }
}

function parseStrictJsonArtifact(bytes, label, code = 'invalid_generation_artifact') {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    return value
  } catch (error) {
    throw strictError(code, `${label} is malformed`, { cause: error })
  }
}

function canonicalizeStrictJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeStrictJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalizeStrictJson(value[key])]),
  )
}

async function hashStrictJsonValue(value, { cryptoImpl = globalThis.crypto } = {}) {
  return sha256Bytes(
    new TextEncoder().encode(JSON.stringify(canonicalizeStrictJson(value))),
    { cryptoImpl },
  )
}

function strictGeneratedArtifactUrl(generatedId, fileName) {
  const id = assertSafeId(generatedId, 'Generated artifact id')
  const url = `/generated/${id}/${fileName}`
  return assertRelativeGeneratedUrl(url, { jobId: id, fileName })
}

export function parseStrictPendingGenerationSelector(value) {
  if (!isRecord(value)) {
    throw strictError('invalid_pending_selector', 'Pending generation selector must be an object')
  }
  const jobId = assertSafeId(value.jobId ?? value.job_id, 'Pending Job id')
  const reviewId = assertSafeId(value.reviewId ?? value.review_id, 'Pending Review id')
  if (!jobId.startsWith('job_') || !reviewId.startsWith('generation_review_')) {
    throw strictError('invalid_pending_selector', 'Pending generation selector uses an unsupported id kind')
  }
  return Object.freeze({ jobId, reviewId })
}

export function isRecoverableStrictPendingRestoreError(error) {
  if (error?.code === 'fetch_unavailable' || error?.code === 'artifact_fetch_timeout') return true
  if (error?.code !== 'artifact_fetch_failed') return false
  return error.status == null || error.status >= 500
}

function assertRecoverableReviewArtifacts({
  reviewId,
  reviewArtifact,
  requestManifest,
  referenceManifest,
  referenceManifestSha256,
}) {
  if (
    reviewArtifact.protocol !== 'full_sheet_generation_review_v1' ||
    reviewArtifact.review_id !== reviewId ||
    reviewArtifact.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    reviewArtifact.estimated_provider_calls !== 1 ||
    reviewArtifact.provider_calls_used !== 0 ||
    requestManifest.protocol !== 'full_sheet_generation_review_v1' ||
    requestManifest.schema_version !== 1 ||
    requestManifest.review_id !== reviewId ||
    requestManifest.plan_hash !== reviewArtifact.plan_hash ||
    requestManifest.reference_manifest_sha256 !== referenceManifestSha256 ||
    reviewArtifact.reference_manifest_sha256 !== referenceManifestSha256 ||
    requestManifest.generation_profile?.id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    requestManifest.generation_profile?.source_layout !== 'fixed_region_motion_v0' ||
    requestManifest.generation_profile?.background_recipe_id !== STRICT_FIXED_REGION_PROFILE.backgroundMode ||
    requestManifest.provider?.provider !== 'gemini' ||
    requestManifest.provider?.route_kind !== 'google_native' ||
    typeof requestManifest.provider?.model !== 'string' ||
    !requestManifest.provider.model.trim() ||
    requestManifest.image_config?.image_size !== STRICT_FIXED_REGION_PROFILE.imageConfig.image_size ||
    requestManifest.image_config?.aspect_ratio !== STRICT_FIXED_REGION_PROFILE.imageConfig.aspect_ratio ||
    requestManifest.generation_options?.candidateCount !== 1 ||
    requestManifest.max_provider_calls !== 1 ||
    requestManifest.automatic_retry !== false ||
    requestManifest.provider_fallback !== false ||
    requestManifest.model_fallback !== false ||
    referenceManifest.protocol !== 'generation_reference_manifest_v1' ||
    referenceManifest.schema_version !== 1 ||
    referenceManifest.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    !Array.isArray(referenceManifest.items) ||
    referenceManifest.items.length === 0
  ) {
    throw strictError('pending_review_mismatch', 'Pending Review artifacts violate the sealed strict Profile')
  }
  const referenceUrls = referenceManifest.items.map((item, index) => {
    if (
      !isRecord(item) ||
      item.order !== index + 1 ||
      !SAFE_ID_PATTERN.test(String(item.name ?? '')) ||
      String(item.name).includes('..') ||
      !['structure', 'identity', 'palette'].includes(item.role)
    ) {
      throw strictError('pending_review_mismatch', 'Pending Review reference manifest is malformed')
    }
    return {
      name: item.name,
      role: item.role,
      url: strictGeneratedArtifactUrl(reviewId, item.name),
    }
  })
  return assertSealedStrictReview({
    mode: 'provider_free_generation_review',
    status: 'done',
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    review_id: reviewId,
    reviewed_run_id: reviewId,
    plan_hash: reviewArtifact.plan_hash,
    reference_manifest_sha256: referenceManifestSha256,
    provider: requestManifest.provider,
    model: requestManifest.provider.model,
    image_config: requestManifest.image_config,
    candidate_count: 1,
    estimated_provider_calls: 1,
    provider_calls_used: 0,
    max_provider_calls: 1,
    references: referenceManifest.items,
    generation_review_url: strictGeneratedArtifactUrl(reviewId, 'generation_review.json'),
    generation_request_manifest_url: strictGeneratedArtifactUrl(reviewId, 'generation_request_manifest.json'),
    generation_reference_manifest_url: strictGeneratedArtifactUrl(reviewId, 'generation_reference_manifest.json'),
    generation_prompt_url: strictGeneratedArtifactUrl(reviewId, 'generation_prompt.txt'),
    reference_urls: referenceUrls,
  })
}

function assertRecoverableGenerationArtifacts({ jobId, review, generation, releaseGate }) {
  const selection = generation.candidate_selection
  const candidate = Array.isArray(selection?.candidates) && selection.candidates.length === 1
    ? selection.candidates[0]
    : null
  const attempt = Array.isArray(candidate?.provider_attempts) && candidate.provider_attempts.length === 1
    ? candidate.provider_attempts[0]
    : null
  if (
    generation.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    generation.generation_review?.reviewed_run_id !== review.reviewed_run_id ||
    generation.generation_review?.plan_hash !== review.plan_hash ||
    generation.generation_review?.reference_manifest_sha256 !== review.reference_manifest_sha256 ||
    selection?.artifact_disposition !== 'review_required' ||
    selection?.release_ready !== false ||
    selection?.manual_review_required !== true ||
    selection?.human_decision_status !== 'pending' ||
    selection?.review_status !== 'awaiting_human_review' ||
    selection?.candidate_count !== 1 ||
    candidate?.status !== 'pass' ||
    candidate?.failure_status !== null ||
    candidate?.release_ready !== false ||
    candidate?.manual_review_required !== true ||
    candidate?.human_decision_status !== 'pending' ||
    attempt?.provider !== 'gemini' ||
    attempt?.route_kind !== 'google_native' ||
    attempt?.status !== 'success' ||
    attempt?.provider_call_budget_before?.used_provider_calls !== 0 ||
    attempt?.provider_call_budget_before?.max_provider_calls !== 1 ||
    attempt?.provider_call_budget_after?.used_provider_calls !== 1 ||
    attempt?.provider_call_budget_after?.max_provider_calls !== 1 ||
    releaseGate.schema_version !== 1 ||
    releaseGate.mode !== 'generation_release_gate_v1' ||
    releaseGate.generation_mode !== STRICT_FIXED_REGION_PROFILE.mode ||
    releaseGate.policy !== 'strict_live_generation_v1' ||
    releaseGate.status !== 'needs_review' ||
    releaseGate.release_ready !== false ||
    releaseGate.manual_review_required !== true ||
    releaseGate.human_decision_status !== 'pending' ||
    !Array.isArray(releaseGate.blocking_errors) ||
    releaseGate.blocking_errors.length !== 0
  ) {
    throw strictError('pending_job_not_reviewable', 'Pending Job artifacts are not an exact review-required candidate')
  }
  assertV2ArtifactManifest(generation)
  const rawFileName = String(generation.raw_provider_output?.file ?? '')
  if (!RAW_PROVIDER_FILE_PATTERN.test(rawFileName)) {
    throw strictError('pending_job_not_reviewable', 'Pending Job Raw artifact identity is invalid')
  }
  return assertReviewRequiredStrictJob({
    id: jobId,
    status: 'done',
    artifact_disposition: 'review_required',
    release_ready: false,
    manual_review_required: true,
    review_status: 'awaiting_human_review',
    human_decision_status: 'pending',
    failure_status: null,
    reason: null,
    provider_call_budget: {
      planned_provider_calls: 1,
      max_provider_calls: 1,
      used_provider_calls: 1,
    },
    generation_url: strictGeneratedArtifactUrl(jobId, 'generation.json'),
    generation_release_gate_url: strictGeneratedArtifactUrl(jobId, 'generation_release_gate.json'),
    debug_report_url: strictGeneratedArtifactUrl(jobId, 'debug_report.json'),
    source_subject_count_report_url: strictGeneratedArtifactUrl(jobId, 'source_subject_count_report.json'),
    normalized_subject_count_report_url: strictGeneratedArtifactUrl(jobId, 'normalized_subject_count_report.json'),
    raw_provider_output_url: strictGeneratedArtifactUrl(jobId, rawFileName),
    source_url: strictGeneratedArtifactUrl(jobId, 'source.png'),
    normalized_sheet_url: strictGeneratedArtifactUrl(jobId, 'normalized_sheet.png'),
    ...Object.fromEntries(Object.entries(STRICT_V2_URL_FIELDS).map(([field, fileName]) => [
      field,
      strictGeneratedArtifactUrl(jobId, fileName),
    ])),
  })
}

export async function restoreStrictReviewRequiredGeneration(selector, {
  fetchImpl = globalThis.fetch,
  signal,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const { jobId, reviewId } = parseStrictPendingGenerationSelector(selector)
  const urls = {
    review: strictGeneratedArtifactUrl(reviewId, 'generation_review.json'),
    request: strictGeneratedArtifactUrl(reviewId, 'generation_request_manifest.json'),
    references: strictGeneratedArtifactUrl(reviewId, 'generation_reference_manifest.json'),
    generation: strictGeneratedArtifactUrl(jobId, 'generation.json'),
    gate: strictGeneratedArtifactUrl(jobId, 'generation_release_gate.json'),
  }
  const [reviewBytes, requestBytes, referenceBytes, generationBytes, gateBytes] = await Promise.all([
    fetchArtifactBytes(urls.review, { fetchImpl, signal, maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json, label: 'generation_review.json' }),
    fetchArtifactBytes(urls.request, { fetchImpl, signal, maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json, label: 'generation_request_manifest.json' }),
    fetchArtifactBytes(urls.references, { fetchImpl, signal, maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json, label: 'generation_reference_manifest.json' }),
    fetchArtifactBytes(urls.generation, { fetchImpl, signal, maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json, label: 'generation.json' }),
    fetchArtifactBytes(urls.gate, { fetchImpl, signal, maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json, label: 'generation_release_gate.json' }),
  ])
  const referenceManifest = parseStrictJsonArtifact(
    referenceBytes,
    'generation_reference_manifest.json',
    'invalid_pending_review',
  )
  const referenceManifestSha256 = await hashStrictJsonValue(referenceManifest, { cryptoImpl })
  const review = assertRecoverableReviewArtifacts({
    reviewId,
    reviewArtifact: parseStrictJsonArtifact(reviewBytes, 'generation_review.json', 'invalid_pending_review'),
    requestManifest: parseStrictJsonArtifact(requestBytes, 'generation_request_manifest.json', 'invalid_pending_review'),
    referenceManifest,
    referenceManifestSha256,
  })
  const job = assertRecoverableGenerationArtifacts({
    jobId,
    review,
    generation: parseGenerationJson(generationBytes),
    releaseGate: parseStrictJsonArtifact(gateBytes, 'generation_release_gate.json', 'invalid_pending_gate'),
  })
  return Object.freeze({ job: Object.freeze(job), review: Object.freeze(review) })
}

function assertV2ArtifactManifest(generation) {
  const evidence = generation?.background_matte_v2
  const files = Object.values(STRICT_V2_URL_FIELDS)
  if (
    !isRecord(evidence) ||
    evidence.schema_version !== 1 ||
    evidence.recipe_id !== STRICT_FIXED_REGION_PROFILE.backgroundMode ||
    evidence.provider_calls_used !== 0 ||
    !HASH_PATTERN.test(String(evidence.source_rgba_sha256 ?? '')) ||
    !HASH_PATTERN.test(String(evidence.output_rgba_sha256 ?? '')) ||
    !hasExactKeys(evidence.artifacts, files)
  ) {
    throw strictError('artifact_hash_mismatch', 'Background Matte V2 evidence manifest is malformed')
  }
  for (const file of files) {
    const entry = evidence.artifacts[file]
    const expectedMimeType = STRICT_V2_JSON_FILES.has(file) ? 'application/json' : 'image/png'
    if (
      !isRecord(entry) ||
      entry.file !== file ||
      entry.mime_type !== expectedMimeType ||
      !Number.isSafeInteger(entry.byte_length) ||
      entry.byte_length <= 0 ||
      !HASH_PATTERN.test(String(entry.sha256 ?? ''))
    ) {
      throw strictError('artifact_hash_mismatch', `Background Matte V2 evidence is malformed: ${file}`)
    }
  }
  return evidence.artifacts
}

function assertGenerationEvidence(generation, review, {
  rawFileName,
  rawByteLength,
  rawSha256,
  backgroundSha256,
}) {
  const artifacts = assertV2ArtifactManifest(generation)
  const outputArtifact = artifacts[STRICT_V2_URL_FIELDS.background_removed_provider_output_url]
  if (
    generation.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    generation.generation_review?.reviewed_run_id !== review.reviewed_run_id ||
    generation.generation_review?.plan_hash !== review.plan_hash ||
    generation.generation_review?.reference_manifest_sha256 !== review.reference_manifest_sha256 ||
    generation.background_matte_v2?.recipe_id !== STRICT_FIXED_REGION_PROFILE.backgroundMode ||
    generation.raw_provider_output?.file !== rawFileName ||
    generation.raw_provider_output?.processing !== 'none' ||
    generation.raw_provider_output?.byte_length !== rawByteLength ||
    generation.raw_provider_output?.sha256 !== rawSha256 ||
    generation.background_removed_provider_output?.file !==
      STRICT_V2_URL_FIELDS.background_removed_provider_output_url ||
    generation.background_removed_provider_output?.processing !== 'background_removal_only' ||
    generation.background_removed_provider_output?.sha256 !== backgroundSha256 ||
    generation.background_removed_provider_output?.sha256 !== outputArtifact.sha256 ||
    generation.background_removed_provider_output?.byte_length !== outputArtifact.byte_length ||
    generation.background_removed_provider_output?.mime_type !== outputArtifact.mime_type ||
    generation.background_removed_provider_output?.source_file !== rawFileName ||
    generation.background_removed_provider_output?.source_sha256 !== rawSha256
  ) {
    throw strictError('artifact_hash_mismatch', 'Generation evidence does not match the reviewed Artifact bytes')
  }
}

function exactAcceptBody(body) {
  if (!isRecord(body)) throw strictError('invalid_accept_body', 'Accept body must be an object')
  const keys = Object.keys(body)
  if (
    keys.length !== STRICT_ACCEPT_REQUEST_FIELDS.length ||
    STRICT_ACCEPT_REQUEST_FIELDS.some((field) => !Object.hasOwn(body, field))
  ) {
    throw strictError('invalid_accept_body', 'Accept body must contain exactly the eight sealed fields')
  }
  if (body.confirmManualAcceptance !== true) {
    throw strictError('invalid_accept_body', 'confirmManualAcceptance must be true')
  }
  for (const field of STRICT_ACCEPT_REQUEST_FIELDS.filter((field) => field.startsWith('expected'))) {
    assertHash(body[field], field)
  }
  if (!Number.isInteger(body.humanReviewedIssueCount) || body.humanReviewedIssueCount < 0) {
    throw strictError('invalid_accept_body', 'humanReviewedIssueCount must be a non-negative integer')
  }
  return body
}

export async function prepareStrictManualAcceptanceEvidence({
  job,
  review,
  humanReviewedIssueCount,
}, {
  fetchImpl = globalThis.fetch,
  signal,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const sealedJob = assertReviewRequiredStrictJob(job)
  const sealedReview = assertSealedStrictReview(review)
  if (!Number.isInteger(humanReviewedIssueCount) || humanReviewedIssueCount < 0) {
    throw strictError('invalid_accept_body', 'humanReviewedIssueCount must be a non-negative integer')
  }

  const generationBytes = await fetchArtifactBytes(sealedJob.generation_url, {
    fetchImpl,
    signal,
    maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.json,
    label: 'generation.json',
  })
  const generation = parseGenerationJson(generationBytes)
  const v2ArtifactManifest = assertV2ArtifactManifest(generation)
  const verifiedArtifacts = [{
    field: 'generation_url',
    file: 'generation.json',
    url: sealedJob.generation_url,
    byte_length: generationBytes.byteLength,
    sha256: await sha256Bytes(generationBytes, { cryptoImpl }),
    mime_type: 'application/json',
  }]
  const rawFileName = sealedJob.raw_provider_output_url.split('/').at(-1)
  const rawBytes = await fetchArtifactBytes(sealedJob.raw_provider_output_url, {
    fetchImpl,
    signal,
    maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.image,
    label: 'raw Provider output',
  })
  const rawSha256 = await sha256Bytes(rawBytes, { cryptoImpl })
  verifiedArtifacts.push({
    field: 'raw_provider_output_url',
    file: rawFileName,
    url: sealedJob.raw_provider_output_url,
    byte_length: rawBytes.byteLength,
    sha256: rawSha256,
    mime_type: generation.raw_provider_output?.detected_mime_type ?? null,
  })
  let backgroundBytes = null
  let backgroundSha256 = null
  for (const [field, file] of Object.entries(STRICT_V2_URL_FIELDS)) {
    const maxBytes = STRICT_V2_JSON_FILES.has(file)
      ? STRICT_ARTIFACT_BYTE_LIMITS.json
      : STRICT_ARTIFACT_BYTE_LIMITS.image
    const bytes = await fetchArtifactBytes(sealedJob[field], {
      fetchImpl,
      signal,
      maxBytes,
      label: file,
    })
    const expected = v2ArtifactManifest[file]
    const actualSha256 = await sha256Bytes(bytes, { cryptoImpl })
    if (bytes.byteLength !== expected.byte_length || actualSha256 !== expected.sha256) {
      throw strictError('artifact_hash_mismatch', `Background Matte V2 Artifact bytes changed: ${file}`)
    }
    verifiedArtifacts.push({ field, url: sealedJob[field], ...expected })
    if (file === STRICT_V2_URL_FIELDS.background_removed_provider_output_url) {
      backgroundBytes = bytes
      backgroundSha256 = actualSha256
    }
  }
  if (!backgroundBytes || !backgroundSha256) {
    throw strictError('artifact_hash_mismatch', 'Background Matte V2 output evidence is missing')
  }
  const sourceBytes = await fetchArtifactBytes(sealedJob.source_url, {
    fetchImpl,
    signal,
    maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.image,
    label: 'source image',
  })
  const normalizedBytes = await fetchArtifactBytes(sealedJob.normalized_sheet_url, {
    fetchImpl,
    signal,
    maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.image,
    label: 'normalized sheet',
  })
  const [sourceSha256, normalizedSha256] = await Promise.all([
    sha256Bytes(sourceBytes, { cryptoImpl }),
    sha256Bytes(normalizedBytes, { cryptoImpl }),
  ])
  verifiedArtifacts.push(
    {
      field: 'source_url',
      file: 'source.png',
      url: sealedJob.source_url,
      byte_length: sourceBytes.byteLength,
      sha256: sourceSha256,
      mime_type: 'image/png',
    },
    {
      field: 'normalized_sheet_url',
      file: 'normalized_sheet.png',
      url: sealedJob.normalized_sheet_url,
      byte_length: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      mime_type: 'image/png',
    },
  )
  assertGenerationEvidence(generation, sealedReview, {
    rawFileName,
    rawByteLength: rawBytes.byteLength,
    rawSha256,
    backgroundSha256,
  })

  const acceptanceBody = exactAcceptBody({
    confirmManualAcceptance: true,
    expectedPlanHash: sealedReview.plan_hash,
    expectedReferenceManifestSha256: sealedReview.reference_manifest_sha256,
    expectedRawProviderOutputSha256: rawSha256,
    expectedBackgroundRemovedProviderOutputSha256: backgroundSha256,
    expectedSourceSha256: sourceSha256,
    expectedNormalizedSheetSha256: normalizedSha256,
    humanReviewedIssueCount,
  })
  return {
    acceptanceBody,
    verifiedArtifacts: Object.freeze(verifiedArtifacts.map((artifact) => Object.freeze({ ...artifact }))),
  }
}

export async function prepareStrictManualAcceptance(input, options) {
  const prepared = await prepareStrictManualAcceptanceEvidence(input, options)
  return prepared.acceptanceBody
}

function assertAcceptResponse(response, sourceJobId, humanReviewedIssueCount) {
  const publicationId = `accepted_v1_${sourceJobId}`
  if (
    !isRecord(response) ||
    response.mode !== 'full_sheet_manual_acceptance_v1' ||
    response.status !== 'done' ||
    !['accepted', 'already_accepted'].includes(response.saved) ||
    response.source_job_id !== sourceJobId ||
    response.publication_id !== publicationId ||
    response.manual_acceptance_status !== 'accepted' ||
    response.human_reviewed_issue_count !== humanReviewedIssueCount ||
    response.provider_call_budget?.planned_provider_calls !== 0 ||
    response.provider_call_budget?.max_provider_calls !== 0 ||
    response.provider_call_budget?.used_provider_calls !== 0 ||
    (response.provider_calls_used !== undefined && response.provider_calls_used !== 0)
  ) {
    throw strictError('invalid_accept_response', 'Manual Accept response violates the zero-Provider contract')
  }
  assertHash(response.manual_acceptance_sha256, 'manual_acceptance_sha256')
  for (const [field, fileName] of Object.entries(STRICT_ACCEPT_URL_FIELDS)) {
    const value = response[field]
    if (field === 'raw_provider_output_url') {
      assertRelativeGeneratedUrl(value, { jobId: publicationId, filePattern: RAW_PROVIDER_FILE_PATTERN })
    } else {
      assertRelativeGeneratedUrl(value, { jobId: publicationId, fileName })
    }
  }
  for (const [field, value] of Object.entries(response)) {
    if (field.endsWith('_url') && !Object.hasOwn(STRICT_ACCEPT_URL_FIELDS, field)) {
      assertRelativeGeneratedUrl(value, { jobId: publicationId })
    }
  }
  return response
}

export async function postStrictManualAcceptance(sourceJobId, body, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const jobId = assertSafeId(sourceJobId, 'source Job id')
  const request = exactAcceptBody(body)
  const response = await requestJson(
    `/api/generate-character/${encodeURIComponent(jobId)}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
      timeoutMs: STRICT_ACCEPT_REQUEST_TIMEOUT_MS,
    },
    fetchImpl,
  )
  return assertAcceptResponse(response, jobId, request.humanReviewedIssueCount)
}

export function parseStrictAcceptedPublicationSelector(value) {
  const publicationId = String(value ?? '')
  if (
    !publicationId.startsWith(ACCEPTED_PUBLICATION_PREFIX) ||
    !SAFE_GENERATED_ID_PATTERN.test(publicationId) ||
    publicationId.includes('..')
  ) {
    throw strictError('invalid_publication_selector', 'Accepted download selector is invalid')
  }
  const sourceJobId = assertSafeId(
    publicationId.slice(ACCEPTED_PUBLICATION_PREFIX.length),
    'accepted download source Job id',
  )
  if (`${ACCEPTED_PUBLICATION_PREFIX}${sourceJobId}` !== publicationId) {
    throw strictError('invalid_publication_selector', 'Accepted download selector is invalid')
  }
  return Object.freeze({ publicationId, sourceJobId })
}

function parseStrictManualAcceptanceManifest(bytes, { publicationId, sourceJobId }) {
  let manifest
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw strictError('invalid_acceptance_manifest', 'manual_acceptance.json is malformed', { cause: error })
  }
  const review = manifest?.generation_review
  const artifacts = manifest?.source_artifacts
  if (
    !isRecord(manifest) ||
    manifest.schema_version !== 1 ||
    manifest.protocol !== 'full_sheet_manual_acceptance_v1' ||
    manifest.acceptance_id !== publicationId ||
    manifest.published_job_id !== publicationId ||
    manifest.source_job_id !== sourceJobId ||
    manifest.decision !== 'accepted' ||
    manifest.decision_authority !== 'human' ||
    manifest.generation_profile_id !== STRICT_FIXED_REGION_PROFILE.generationProfileId ||
    manifest.provider_calls_used !== 0 ||
    !Number.isInteger(manifest.human_reviewed_issue_count) ||
    manifest.human_reviewed_issue_count < 0 ||
    !isRecord(review) ||
    !isRecord(artifacts) ||
    !RAW_PROVIDER_FILE_PATTERN.test(String(artifacts.raw_provider_output_file ?? '')) ||
    artifacts.background_removed_provider_output_file !==
      STRICT_V2_URL_FIELDS.background_removed_provider_output_url
  ) {
    throw strictError(
      'invalid_acceptance_manifest',
      'manual_acceptance.json violates the accepted download contract',
    )
  }
  return exactAcceptBody({
    confirmManualAcceptance: true,
    expectedPlanHash: review.plan_hash,
    expectedReferenceManifestSha256: review.reference_manifest_sha256,
    expectedRawProviderOutputSha256: artifacts.raw_provider_output_sha256,
    expectedBackgroundRemovedProviderOutputSha256:
      artifacts.background_removed_provider_output_sha256,
    expectedSourceSha256: artifacts.source_sha256,
    expectedNormalizedSheetSha256: artifacts.normalized_sheet_sha256,
    humanReviewedIssueCount: manifest.human_reviewed_issue_count,
  })
}

export async function replayStrictAcceptedPublication(value, {
  fetchImpl = globalThis.fetch,
  signal,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const { publicationId, sourceJobId } = parseStrictAcceptedPublicationSelector(value)
  const manualAcceptanceUrl = `/generated/${publicationId}/manual_acceptance.json`
  assertRelativeGeneratedUrl(manualAcceptanceUrl, {
    jobId: publicationId,
    fileName: STRICT_ACCEPT_URL_FIELDS.manual_acceptance_url,
  })
  const manifestBytes = await fetchArtifactBytes(manualAcceptanceUrl, {
    fetchImpl,
    signal,
    maxBytes: STRICT_ARTIFACT_BYTE_LIMITS.apiJson,
    label: 'accepted manual acceptance manifest',
  })
  const body = parseStrictManualAcceptanceManifest(manifestBytes, { publicationId, sourceJobId })
  const manifestSha256 = await sha256Bytes(manifestBytes, { cryptoImpl })
  const response = await postStrictManualAcceptance(sourceJobId, body, { fetchImpl, signal })
  if (response.manual_acceptance_sha256 !== manifestSha256) {
    throw strictError(
      'acceptance_binding_stale',
      'Accepted download changed while it was being restored',
    )
  }
  return Object.freeze({
    version: 1,
    publicationId,
    sourceJobId,
    body: Object.freeze({ ...body }),
    response,
  })
}

export function validateStrictAcceptedPublicationCache(value, selectorValue) {
  const { publicationId, sourceJobId } = parseStrictAcceptedPublicationSelector(selectorValue)
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.publicationId !== publicationId ||
    value.sourceJobId !== sourceJobId ||
    !isRecord(value.body) ||
    !isRecord(value.response)
  ) {
    throw strictError('invalid_acceptance_cache', 'Accepted download cache is invalid')
  }
  const body = exactAcceptBody(value.body)
  const response = assertAcceptResponse(
    value.response,
    sourceJobId,
    body.humanReviewedIssueCount,
  )
  return Object.freeze({
    version: 1,
    publicationId,
    sourceJobId,
    body: Object.freeze({ ...body }),
    response,
  })
}
