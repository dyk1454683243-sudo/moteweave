import { fileToBase64 } from '../dom.js'
import { normalizeTwoPointFiveDOptions } from '../twoPointFiveD/core.js'

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/
const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])
const RUNNING_JOB_STATUSES = new Set(['queued', 'generating', 'post_processing'])

export const TILES_REQUEST_TIMEOUT_MS = 15_000
export const TILES_ARTIFACT_TIMEOUT_MS = 20_000
export const TILES_POLL_INTERVAL_MS = 500
export const TILES_POLL_LIMIT = 240
export const TILES_BENCHMARK_MAX_CALLS = 4
export const TILES_MATERIAL_SOURCE_MAX_BYTES = 32 * 1024 * 1024

export const TILES_LOCAL_ARTIFACT_FIELDS = Object.freeze({
  strict_atlas_png_url: 'strict_atlas.png',
  runtime_padded_atlas_png_url: 'runtime_padded_atlas.png',
  map_editor_preview_png_url: 'map_editor_preview.png',
  tiled_json_url: 'tileset.tiled.json',
  tiled_tsx_url: 'tileset.tsx',
  ldtk_project_url: 'project.ldtk',
  ldtk_workflow_validation_url: 'ldtk_workflow_validation.json',
  workflow_release_evidence_url: 'workflow_release_evidence.json',
  workflow_release_evidence_md_url: 'workflow_release_evidence.md',
  consumer_package_audit_url: 'consumer_package_audit.json',
  import_validation_url: 'import_validation.json',
  release_demo_manifest_url: 'release_demo_manifest.json',
  release_demo_readme_url: 'release_demo_README.md',
  release_demo_pack_zip_url: 'release_demo_pack.zip',
  external_tool_probe_url: 'external_tool_probe.json',
  external_import_smoke_url: 'external_import_smoke.json',
  external_roundtrip_validation_url: 'external_roundtrip_validation.json',
  external_roundtrip_checklist_md_url: 'external_roundtrip_checklist.md',
})

export const TILES_BENCHMARK_ARTIFACT_FIELDS = Object.freeze({
  material_source_benchmark_plan_url: 'material_source_benchmark_plan.json',
  material_source_benchmark_url: 'material_source_benchmark.json',
  material_source_benchmark_md_url: 'material_source_benchmark.md',
})

export class StudioTilesApiError extends Error {
  constructor(code, message, { status = null, payload = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'StudioTilesApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

export function tilesBenchmarkSubmissionIsDefiniteRejection(error) {
  const status = Number(error?.status)
  return Number.isInteger(status) && status >= 400 && status < 500
}

function tilesError(code, message, options) {
  return new StudioTilesApiError(code, message, options)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw tilesError('fetch_unavailable', 'fetch is unavailable')
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
      finish(reject, tilesError(timeoutCode, timeoutMessage))
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
    throw tilesError('artifact_too_large', `${label} exceeds the ${limit}-byte limit`)
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw tilesError('artifact_too_large', `${label} exceeds the ${limit}-byte limit`)
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
      if (length > limit) throw tilesError('artifact_too_large', `${label} exceeds the ${limit}-byte limit`)
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
  const { signal, timeoutMs = TILES_REQUEST_TIMEOUT_MS, ...requestOptions } = options
  return withDeadline(async (effectiveSignal) => {
    let response
    try {
      response = await assertFetch(fetchImpl)(url, {
        ...requestOptions,
        signal: effectiveSignal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof StudioTilesApiError) throw error
      throw tilesError('request_failed', `${url} request failed`, { cause: error })
    }
    let payload
    try {
      const bytes = await readBytesBounded(response, 4 * 1024 * 1024, `${url} response`, effectiveSignal)
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (error instanceof StudioTilesApiError) throw error
      throw tilesError('invalid_json_response', `${url} returned invalid JSON`, {
        status: response.status,
        cause: error,
      })
    }
    if (!response.ok) {
      throw tilesError(
        String(payload?.error || payload?.code || 'request_rejected'),
        String(payload?.reason || `${url} returned ${response.status}`),
        { status: response.status, payload },
      )
    }
    if (!isRecord(payload)) throw tilesError('invalid_json_response', `${url} returned an invalid object`)
    return payload
  }, {
    signal,
    timeoutMs,
    timeoutMessage: `${url} did not complete before the deadline`,
  })
}

function safeId(value, label) {
  const id = String(value ?? '')
  if (!SAFE_ID_PATTERN.test(id) || id.includes('..')) throw tilesError('invalid_client_contract', `${label} is invalid`)
  return id
}

export function assertTilesArtifactUrl(value, expectedFile = null, {
  locationValue = globalThis.location,
  exactPath = null,
} = {}) {
  const text = String(value ?? '')
  if (!text) throw tilesError('artifact_missing', `Required artifact ${expectedFile ?? 'URL'} is missing`)
  const rootRelative = text.startsWith('/generated/')
  const absoluteHttp = /^https?:\/\//i.test(text)
  if (!rootRelative && !absoluteHttp) {
    throw tilesError('artifact_url_invalid', `Artifact URL must be root-relative or same-origin HTTP(S): ${text}`)
  }
  let parsed
  try {
    parsed = new URL(text, locationValue?.origin || 'http://local.invalid')
  } catch (error) {
    throw tilesError('artifact_url_invalid', `Artifact URL is invalid: ${text}`, { cause: error })
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.startsWith('/generated/')
  ) {
    throw tilesError('artifact_url_invalid', `Artifact URL is outside /generated/: ${text}`)
  }
  if (absoluteHttp && locationValue?.origin && parsed.origin !== locationValue.origin) {
    throw tilesError('artifact_origin_mismatch', `Artifact URL is not same-origin: ${text}`)
  }
  if (expectedFile && !parsed.pathname.endsWith(`/${expectedFile}`)) {
    throw tilesError('artifact_binding_mismatch', `Artifact URL does not end with ${expectedFile}`)
  }
  if (exactPath && parsed.pathname !== exactPath) {
    throw tilesError('artifact_binding_mismatch', `Artifact URL is not bound to ${exactPath}`)
  }
  return `${parsed.pathname}${parsed.search}`
}

export function selectEligibleTilesGeminiPreset(providerState = {}) {
  const presets = Array.isArray(providerState.presets) ? providerState.presets : []
  const eligible = presets.filter((preset) => (
    preset?.available === true &&
    preset.provider === 'gemini' &&
    preset.route_kind === 'google_native' &&
    preset.supports_image_size === true &&
    typeof preset.model === 'string' && preset.model.length > 0 &&
    SAFE_ID_PATTERN.test(String(preset.id ?? ''))
  ))
  const selected = eligible.find((preset) => preset.id === providerState.active_preset_id) ?? eligible[0]
  if (!selected) {
    throw tilesError('gemini_not_ready', 'No eligible native Gemini image preset is configured')
  }
  return Object.freeze({
    id: selected.id,
    model: selected.model,
    routeKind: selected.route_kind,
    label: selected.label ?? selected.id,
  })
}

export async function fetchTilesGeminiPreset({
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const state = await requestJson('/api/gemini-state', { method: 'GET', signal }, fetchImpl)
  return selectEligibleTilesGeminiPreset(state)
}

function publicTilesOptions(values = {}) {
  const options = normalizeTwoPointFiveDOptions(values)
  return Object.freeze({
    mapSolver: options.mapSolver,
    mapBorder: options.mapBorder,
    mapWidth: options.mapWidth,
    mapHeight: options.mapHeight,
    mapSeed: options.mapSeed,
    mapDensity: options.mapDensity,
    editorOperations: Object.freeze(options.editorOperations.map((operation) => Object.freeze({ ...operation }))),
  })
}

function assertJobEnvelope(job, expectedType) {
  if (!isRecord(job)) throw tilesError('invalid_job', 'Tiles API returned an invalid Job')
  safeId(job.id, 'Job id')
  if (expectedType && job.type !== expectedType) {
    throw tilesError('job_binding_mismatch', `Expected ${expectedType} Job, received ${String(job.type ?? 'unknown')}`)
  }
  if (!RUNNING_JOB_STATUSES.has(job.status) && !TERMINAL_JOB_STATUSES.has(job.status)) {
    throw tilesError('invalid_job_status', `Unsupported Job status: ${String(job.status ?? '')}`)
  }
  return job
}

export function assertLocalTilesJob(job, { terminal = false } = {}) {
  const bound = assertJobEnvelope(job, 'two_point_five_d_tileset')
  const safeJob = { ...bound }
  const budget = bound.provider_call_budget
  if (budget && ['planned_provider_calls', 'max_provider_calls', 'used_provider_calls'].some((field) => Number(budget[field]) !== 0)) {
    throw tilesError('provider_budget_mismatch', 'Local tiles build unexpectedly used Provider calls')
  }
  if (terminal && bound.status === 'done') {
    for (const [field, file] of Object.entries(TILES_LOCAL_ARTIFACT_FIELDS)) {
      safeJob[field] = assertTilesArtifactUrl(bound[field], file, {
        exactPath: `/generated/${safeId(bound.id, 'Job id')}/${file}`,
      })
    }
    const invalid = []
    for (const field of [
      'validation_status',
      'tile_map_status',
      'map_editor_workflow_status',
      'ldtk_project_status',
      'ldtk_workflow_validation_status',
      'consumer_package_audit_status',
      'external_import_smoke_status',
    ]) {
      if (bound[field] !== 'pass') invalid.push(`${field}:${String(bound[field] ?? 'missing')}`)
    }
    for (const field of ['workflow_release_evidence_status', 'import_validation_status', 'release_demo_pack_status']) {
      if (!['pass', 'warning'].includes(bound[field])) invalid.push(`${field}:${String(bound[field] ?? 'missing')}`)
    }
    for (const field of ['workflow_release_ready', 'release_demo_release_ready', 'external_roundtrip_ready']) {
      if (bound[field] !== true) invalid.push(`${field}:${String(bound[field] ?? 'missing')}`)
    }
    if (!['not_run', 'pass'].includes(bound.external_roundtrip_validation_status)) {
      invalid.push(`external_roundtrip_validation_status:${String(bound.external_roundtrip_validation_status ?? 'missing')}`)
    }
    if (invalid.length) {
      throw tilesError('local_validation_failed', `Tiles completion gate failed: ${invalid.join(', ')}`, {
        payload: { job: Object.freeze(safeJob), invalid: Object.freeze(invalid) },
      })
    }
  }
  return Object.freeze(safeJob)
}

export function assertTilesBenchmarkJob(job, {
  maxProviderCalls = TILES_BENCHMARK_MAX_CALLS,
  terminal = false,
  expectedRunId = null,
  providerPresetId = null,
  expectedProviderConfig = null,
  candidateCount = null,
} = {}) {
  const bound = assertJobEnvelope(job, 'two_point_five_d_material_source_benchmark')
  const safeJob = { ...bound }
  const budget = bound.provider_call_budget
  if (!isRecord(budget)) throw tilesError('provider_budget_missing', 'Benchmark Job omitted provider_call_budget')
  const planned = Number(budget.planned_provider_calls)
  const max = Number(budget.max_provider_calls)
  const used = Number(budget.used_provider_calls)
  if (planned !== maxProviderCalls || max !== maxProviderCalls || !Number.isInteger(used) || used < 0 || used > maxProviderCalls) {
    throw tilesError('provider_budget_mismatch', 'Benchmark Job Provider budget does not match the confirmed plan')
  }
  const runId = expectedRunId === null ? null : safeId(expectedRunId, 'Benchmark run id')
  if (runId && bound.run_id !== undefined && bound.run_id !== runId) {
    throw tilesError('benchmark_job_binding_mismatch', 'Benchmark Job run id does not match the sealed plan')
  }
  if (runId && terminal && bound.status === 'done' && bound.run_id !== runId) {
    throw tilesError('benchmark_job_binding_mismatch', 'Terminal benchmark Job omitted the sealed run id')
  }
  if (providerPresetId !== null) {
    const presetId = safeId(providerPresetId, 'Provider preset id')
    if (bound.provider_config?.selected_preset_id !== presetId) {
      throw tilesError('benchmark_job_binding_mismatch', 'Benchmark Job Provider preset does not match the sealed plan')
    }
  }
  if (expectedProviderConfig !== null) {
    let jobProvider
    let sealedProvider
    try {
      jobProvider = sealedTilesGeminiProvider(bound.provider_config, providerPresetId)
      sealedProvider = sealedTilesGeminiProvider({
        ...expectedProviderConfig,
        selected_available: true,
      }, providerPresetId)
    } catch (error) {
      if (error instanceof StudioTilesApiError) {
        throw tilesError('benchmark_job_binding_mismatch', 'Benchmark Job Provider model or route does not match the sealed plan', {
          cause: error,
        })
      }
      throw error
    }
    if (!jsonValuesEqual(jobProvider, sealedProvider)) {
      throw tilesError('benchmark_job_binding_mismatch', 'Benchmark Job Provider model or route does not match the sealed plan')
    }
  }
  if (candidateCount !== null && Number(bound.candidate_count) !== Number(candidateCount)) {
    throw tilesError('benchmark_job_binding_mismatch', 'Benchmark Job candidate count does not match the sealed plan')
  }
  if (terminal && bound.status === 'done') {
    for (const [field, file] of Object.entries(TILES_BENCHMARK_ARTIFACT_FIELDS)) {
      safeJob[field] = assertTilesArtifactUrl(bound[field], file, runId ? {
        exactPath: `/generated/two-point-five-d-material-source-benchmarks/${runId}/${file}`,
      } : undefined)
    }
  }
  return Object.freeze(safeJob)
}

export async function postLocalTilesBuild({
  materialSourceFile = null,
  options = {},
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (Number.isFinite(Number(materialSourceFile?.size)) && Number(materialSourceFile.size) > TILES_MATERIAL_SOURCE_MAX_BYTES) {
    throw tilesError('material_source_too_large', 'Material source image exceeds the 32 MiB limit')
  }
  const materialSourceBase64 = materialSourceFile ? await fileToBase64(materialSourceFile) : null
  const body = {
    material_source_base64: materialSourceBase64,
    material_source_name: materialSourceFile?.name ?? null,
    options: publicTilesOptions(options),
  }
  const job = await requestJson('/api/build-two-point-five-d-tileset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  return assertLocalTilesJob(job)
}

export function buildTilesBenchmarkRequest({
  description,
  candidateCount = TILES_BENCHMARK_MAX_CALLS,
  maxProviderCalls = candidateCount,
  providerPresetId,
  options = {},
} = {}) {
  const cleanDescription = String(description ?? '').trim()
  if (!cleanDescription) throw tilesError('description_required', 'A material description is required')
  const candidates = Number(candidateCount)
  const maxCalls = Number(maxProviderCalls)
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > TILES_BENCHMARK_MAX_CALLS) {
    throw tilesError('candidate_count_invalid', 'Candidate count must be between 1 and 4')
  }
  if (maxCalls !== candidates) {
    throw tilesError('provider_budget_mismatch', 'Max Provider calls must equal the candidate count')
  }
  const presetId = safeId(providerPresetId, 'Provider preset id')
  return Object.freeze({
    description: cleanDescription,
    providerPresetId: presetId,
    candidateCount: candidates,
    imageConfig: Object.freeze({ image_size: '1K', aspect_ratio: '1:1' }),
    maxProviderCalls: maxCalls,
    options: Object.freeze(publicTilesOptions(options)),
  })
}

function jsonValuesEqual(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]))
}

function sealedTilesGeminiProvider(value, expectedPresetId = null) {
  if (
    !isRecord(value) ||
    value.selected_available !== true ||
    value.provider !== 'gemini' ||
    value.route_kind !== 'google_native' ||
    typeof value.model !== 'string' ||
    !value.model ||
    !SAFE_ID_PATTERN.test(String(value.selected_preset_id ?? '')) ||
    (expectedPresetId !== null && value.selected_preset_id !== expectedPresetId)
  ) {
    throw tilesError('gemini_plan_mismatch', 'Benchmark evidence did not seal the selected native Gemini model and route')
  }
  return Object.freeze({
    selected_available: true,
    selected_preset_id: value.selected_preset_id,
    provider: value.provider,
    route_kind: value.route_kind,
    model: value.model,
  })
}

function expectedBenchmarkMapOptions(request) {
  const options = request?.options
  if (!isRecord(options)) return null
  return {
    solver: options.mapSolver,
    width: options.mapWidth,
    height: options.mapHeight,
    seed: options.mapSeed,
    density: options.mapDensity,
    border: options.mapBorder,
    fixedMasks: [],
    editorOperations: options.editorOperations,
  }
}

function benchmarkPlanMatchesRequest(plan, request) {
  const cases = plan?.cases
  return isRecord(plan) &&
    typeof request?.description === 'string' &&
    Array.isArray(cases) &&
    cases.length === 1 &&
    cases[0]?.id === 'custom_material_source' &&
    cases[0]?.description === request.description &&
    jsonValuesEqual(plan.map_options, expectedBenchmarkMapOptions(request))
}

function assertBenchmarkPlan(response, artifact, request, planUrl) {
  if (response.mode !== 'dry_run_plan' || response.status !== 'done') {
    throw tilesError('benchmark_plan_invalid', 'Benchmark plan response is invalid')
  }
  if (Number(response.candidate_count) !== request.candidateCount || Number(response.estimated_provider_calls) !== request.maxProviderCalls) {
    throw tilesError('provider_budget_mismatch', 'Benchmark plan call estimate does not match the request')
  }
  const responseProvider = sealedTilesGeminiProvider(response.provider_config, request.providerPresetId)
  const artifactProvider = sealedTilesGeminiProvider(artifact.provider_config, request.providerPresetId)
  if (!jsonValuesEqual(responseProvider, artifactProvider)) {
    throw tilesError('gemini_plan_mismatch', 'Benchmark response and persisted plan sealed different Gemini configurations')
  }
  if (
    artifact.mode !== 'two_point_five_d_material_source_benchmark_v1_plan' ||
    artifact.run_id !== response.run_id ||
    artifact.provider_preset_id !== request.providerPresetId ||
    Number(artifact.candidate_count) !== request.candidateCount ||
    Number(artifact.estimated_provider_calls) !== request.maxProviderCalls ||
    artifact.image_config?.image_size !== '1K' ||
    artifact.image_config?.aspect_ratio !== '1:1' ||
    !benchmarkPlanMatchesRequest(artifact, request)
  ) {
    throw tilesError('benchmark_plan_binding_mismatch', 'Persisted benchmark plan does not match the confirmed request')
  }
  return Object.freeze({
    ...response,
    plan_url: planUrl,
    sealed_plan: artifact,
    sealed_provider_config: responseProvider,
    request,
  })
}

function reportStatusCounts(items) {
  const counts = { pass: 0, warning: 0, fail: 0, error: 0 }
  for (const item of items) counts[item.status] += 1
  return counts
}

function reportStatusCountsMatch(value, expected) {
  return isRecord(value) && Object.entries(expected).every(([field, count]) => (
    Number.isInteger(Number(value[field])) && Number(value[field]) === count
  ))
}

function benchmarkFailureTaxonomy(candidates) {
  const issues = new Map()
  for (const candidate of candidates) {
    for (const issueValue of [...candidate.warnings, ...candidate.blocking_errors]) {
      const id = String(issueValue)
      const entry = issues.get(id) ?? { id, count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(`${candidate.case_id}/${candidate.id}`)
      issues.set(id, entry)
    }
  }
  return [...issues.values()].sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
}

function assertBenchmarkReportCases(report, request) {
  if (!Array.isArray(report.cases) || report.cases.length !== 1) {
    throw tilesError('benchmark_report_invalid', 'Benchmark report must contain the one sealed material-source case')
  }
  const item = report.cases[0]
  const candidates = item?.candidates
  const selection = item?.candidate_selection
  if (
    !isRecord(item) ||
    item.id !== 'custom_material_source' ||
    item.item_id !== 'custom_material_source_v1' ||
    item.description !== request.description ||
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > request.candidateCount ||
    !isRecord(selection) ||
    selection.mode !== 'two_point_five_d_material_source_candidate_selection_v1' ||
    Number(selection.candidate_count) !== candidates.length ||
    !Array.isArray(selection.ranking) ||
    selection.ranking.length !== candidates.length
  ) {
    throw tilesError('benchmark_report_invalid', 'Benchmark report case or candidate selection is incomplete')
  }
  const allowedStatuses = new Set(['pass', 'warning', 'fail', 'error'])
  const ids = new Set()
  for (const [index, candidate] of candidates.entries()) {
    if (
      !isRecord(candidate) ||
      candidate.id !== `candidate_${String(index + 1).padStart(2, '0')}` ||
      candidate.case_id !== item.id ||
      Number(candidate.index) !== index ||
      !allowedStatuses.has(candidate.status) ||
      !Array.isArray(candidate.warnings) ||
      !Array.isArray(candidate.blocking_errors) ||
      ids.has(candidate.id)
    ) {
      throw tilesError('benchmark_report_invalid', 'Benchmark report contains an invalid candidate record')
    }
    ids.add(candidate.id)
  }
  const rankingIds = selection.ranking.map((candidate) => candidate?.id)
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  if (
    rankingIds.some((id) => !ids.has(id)) ||
    new Set(rankingIds).size !== candidates.length ||
    selection.ranking.some((candidate) => {
      const source = candidatesById.get(candidate?.id)
      return !source || !jsonValuesEqual(candidate, source)
    }) ||
    selection.selected_candidate_id !== rankingIds[0] ||
    selection.selected_candidate_index !== selection.ranking[0]?.index ||
    selection.selected_status !== selection.ranking[0]?.status
  ) {
    throw tilesError('benchmark_report_invalid', 'Benchmark report candidate ranking is inconsistent')
  }
  const selectedStatus = selection.ranking[0].status
  const expectedStoppedEarly = candidates.length < request.candidateCount
  const expectedSummaryStatus = expectedStoppedEarly || ['fail', 'error'].includes(selectedStatus)
    ? 'fail'
    : selectedStatus === 'warning' ? 'warning' : 'pass'
  const selectedPassRate = selectedStatus === 'pass' ? 1 : 0
  const selectedUsableRate = ['pass', 'warning'].includes(selectedStatus) ? 1 : 0
  if (
    !isRecord(report.summary) ||
    Number(report.summary.case_count) !== 1 ||
    Number(report.summary.candidate_count) !== candidates.length ||
    report.summary.status !== report.status ||
    report.status !== expectedSummaryStatus ||
    Number(report.summary.selected_pass_rate) !== selectedPassRate ||
    Number(report.summary.selected_usable_rate) !== selectedUsableRate ||
    !reportStatusCountsMatch(report.summary.selected_validation, reportStatusCounts([selection.ranking[0]])) ||
    !reportStatusCountsMatch(report.summary.candidate_validation, reportStatusCounts(candidates)) ||
    Boolean(report.summary.stopped_early) !== expectedStoppedEarly ||
    !jsonValuesEqual(report.summary.failure_taxonomy?.top_categories, benchmarkFailureTaxonomy(candidates))
  ) {
    throw tilesError('benchmark_report_invalid', 'Benchmark report summary counts are inconsistent')
  }
}

export function assertTilesBenchmarkReport(report, {
  job,
  request,
  runId,
  sealedProviderConfig = null,
} = {}) {
  if (!isRecord(report) || report.mode !== 'two_point_five_d_material_source_benchmark_v1') {
    throw tilesError('benchmark_report_invalid', 'Benchmark report schema is invalid')
  }
  const expectedRunId = safeId(runId, 'Benchmark run id')
  if (report.run_id !== expectedRunId || job?.run_id !== expectedRunId) {
    throw tilesError('benchmark_report_binding_mismatch', 'Benchmark report does not match the current Job and plan')
  }
  if (
    report.plan?.run_id !== expectedRunId ||
    report.plan?.provider_preset_id !== request?.providerPresetId ||
    Number(report.plan?.candidate_count) !== Number(request?.candidateCount) ||
    Number(report.plan?.estimated_provider_calls) !== Number(request?.maxProviderCalls) ||
    !benchmarkPlanMatchesRequest(report.plan, request)
  ) {
    throw tilesError('benchmark_report_binding_mismatch', 'Benchmark report plan does not match the confirmed request')
  }
  let expectedProvider
  let jobProvider
  let reportProvider
  try {
    expectedProvider = sealedProviderConfig === null
      ? sealedTilesGeminiProvider(job?.provider_config, request?.providerPresetId)
      : sealedTilesGeminiProvider({ ...sealedProviderConfig, selected_available: true }, request?.providerPresetId)
    jobProvider = sealedTilesGeminiProvider(job?.provider_config, request?.providerPresetId)
    reportProvider = sealedTilesGeminiProvider(report.plan?.provider_config, request?.providerPresetId)
  } catch (error) {
    throw tilesError('benchmark_report_binding_mismatch', 'Benchmark report omitted the sealed Gemini model or route', {
      cause: error,
    })
  }
  if (!jsonValuesEqual(expectedProvider, jobProvider) || !jsonValuesEqual(expectedProvider, reportProvider)) {
    throw tilesError('benchmark_report_binding_mismatch', 'Benchmark report Gemini model or route differs from the sealed plan')
  }
  const reportBudget = report.summary?.provider_call_budget
  const jobBudget = job?.provider_call_budget
  for (const field of ['planned_provider_calls', 'max_provider_calls', 'used_provider_calls']) {
    if (!Number.isInteger(Number(reportBudget?.[field])) || Number(reportBudget[field]) !== Number(jobBudget?.[field])) {
      throw tilesError('benchmark_report_binding_mismatch', 'Benchmark report Provider budget does not match the current Job')
    }
  }
  assertBenchmarkReportCases(report, request)
  return report
}

export async function postTilesBenchmarkPlan(request, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const body = { ...request, dryRunPlan: true }
  const response = await requestJson('/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  const runId = safeId(response.run_id, 'Benchmark run id')
  const planUrl = assertTilesArtifactUrl(response.plan_url, 'material_source_benchmark_plan.json', {
    exactPath: `/generated/two-point-five-d-material-source-benchmarks/${runId}/material_source_benchmark_plan.json`,
  })
  const artifact = await fetchTilesJsonArtifact(planUrl, { fetchImpl, signal })
  return assertBenchmarkPlan(response, artifact, request, planUrl)
}

export async function postTilesBenchmarkRun(plan, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!isRecord(plan?.request) || !isRecord(plan?.sealed_plan) || !isRecord(plan?.sealed_provider_config)) {
    throw tilesError('benchmark_plan_required', 'A validated zero-call plan is required')
  }
  const request = plan.request
  const body = {
    ...request,
    runId: plan.sealed_plan.run_id,
    expectedProviderConfig: plan.sealed_provider_config,
    confirm_live_generation: true,
    maxProviderCalls: request.maxProviderCalls,
  }
  const job = await requestJson('/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, fetchImpl)
  return assertTilesBenchmarkJob(job, {
    maxProviderCalls: request.maxProviderCalls,
    expectedRunId: plan.sealed_plan.run_id,
    providerPresetId: request.providerPresetId,
    expectedProviderConfig: plan.sealed_provider_config,
    candidateCount: request.candidateCount,
  })
}

export async function pollTilesJob(job, {
  kind = 'local',
  maxProviderCalls = TILES_BENCHMARK_MAX_CALLS,
  expectedBenchmark = null,
  fetchImpl = globalThis.fetch,
  signal,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onUpdate = () => {},
  limit = TILES_POLL_LIMIT,
  intervalMs = TILES_POLL_INTERVAL_MS,
} = {}) {
  const assertJob = kind === 'benchmark'
    ? (value, options) => assertTilesBenchmarkJob(value, { maxProviderCalls, ...expectedBenchmark, ...options })
    : assertLocalTilesJob
  let current = assertJob(job)
  onUpdate(current)
  for (let index = 0; RUNNING_JOB_STATUSES.has(current.status) && index < limit; index += 1) {
    throwIfAborted(signal)
    await sleepImpl(intervalMs)
    try {
      current = assertJob(await requestJson(`/api/jobs/${safeId(current.id, 'Job id')}`, {
        method: 'GET',
        signal,
      }, fetchImpl), { terminal: true })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      if (error?.status === 404 || error?.code === 'job_not_found' || error?.code === 'not_found') {
        throw tilesError('job_not_found', 'The current server session no longer has this Job', {
          status: error.status,
          payload: { job: current },
          cause: error,
        })
      }
      if (error instanceof StudioTilesApiError && [
        'artifact_missing',
        'artifact_url_invalid',
        'artifact_origin_mismatch',
        'artifact_binding_mismatch',
        'provider_budget_mismatch',
        'job_binding_mismatch',
        'benchmark_job_binding_mismatch',
        'invalid_job',
        'invalid_job_status',
        'local_validation_failed',
      ].includes(error.code)) {
        throw error
      }
      throw tilesError('poll_interrupted', 'Observation of the existing Job was interrupted', {
        payload: { job: current, cause_code: error?.code ?? null },
        cause: error,
      })
    }
    onUpdate(current)
  }
  if (RUNNING_JOB_STATUSES.has(current.status)) {
    throw tilesError('poll_interrupted', 'Observation deadline reached; resume this same Job', {
      payload: { job: current },
    })
  }
  return assertJob(current, { terminal: true })
}

export async function fetchTilesJsonArtifact(url, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const safeUrl = assertTilesArtifactUrl(url)
  return requestJson(safeUrl, {
    method: 'GET',
    signal,
    timeoutMs: TILES_ARTIFACT_TIMEOUT_MS,
  }, fetchImpl)
}
