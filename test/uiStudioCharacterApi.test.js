import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isRecoverableStrictPendingRestoreError,
  parseStrictAcceptedPublicationSelector,
  parseStrictPendingGenerationSelector,
  pollStrictGenerationJob,
  postStrictManualAcceptance,
  prepareStrictManualAcceptance,
  prepareStrictManualAcceptanceEvidence,
  replayStrictAcceptedPublication,
  requestStrictFixedRegionReview,
  restoreStrictReviewRequiredGeneration,
  sha256Bytes,
  startStrictLiveGeneration,
  STRICT_ACCEPT_REQUEST_TIMEOUT_MS,
  STRICT_ACCEPT_REQUEST_FIELDS,
  STRICT_ACCEPT_URL_FIELDS,
  STRICT_FIXED_REGION_PROFILE,
  STRICT_POLL_INTERVAL_MS,
  STRICT_POLL_LIMIT,
  STRICT_V2_URL_FIELDS,
  validateStrictAcceptedPublicationCache,
} from '../src/ui/studio/characterApi.js'

const PLAN_HASH = '1'.repeat(64)
const REFERENCE_HASH = '2'.repeat(64)
const REVIEW_ID = 'generation_review_client_test'
const JOB_ID = 'job_strict_client_test'
const GEMINI_PRESET_ID = 'gemini-native-test'
const textEncoder = new TextEncoder()

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bytesResponse(value) {
  const bytes = value instanceof Uint8Array ? value : textEncoder.encode(value)
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  })
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function strictGeminiState({ includeGemini = true } = {}) {
  const presets = [{
    id: 'openrouter-image-test',
    available: true,
    provider: 'openrouter',
    route_kind: 'openrouter',
    supports_image_size: true,
    image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
  }]
  if (includeGemini) {
    presets.push({
      id: GEMINI_PRESET_ID,
      available: true,
      provider: 'gemini',
      route_kind: 'google_native',
      supports_image_size: true,
      image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    })
  }
  return {
    status: 'ready',
    active_preset_id: 'openrouter-image-test',
    presets,
  }
}

function sealedReview() {
  return {
    mode: 'provider_free_generation_review',
    status: 'done',
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    review_id: REVIEW_ID,
    reviewed_run_id: REVIEW_ID,
    plan_hash: PLAN_HASH,
    reference_manifest_sha256: REFERENCE_HASH,
    provider: {
      provider: 'gemini',
      route_kind: 'google_native',
      model: 'gemini-test-model',
    },
    model: 'gemini-test-model',
    image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    candidate_count: 1,
    estimated_provider_calls: 1,
    provider_calls_used: 0,
    max_provider_calls: 1,
    generation_review_url: `/generated/${REVIEW_ID}/generation_review.json`,
    generation_request_manifest_url: `/generated/${REVIEW_ID}/generation_request_manifest.json`,
    generation_reference_manifest_url: `/generated/${REVIEW_ID}/generation_reference_manifest.json`,
    generation_prompt_url: `/generated/${REVIEW_ID}/generation_prompt.txt`,
    reference_urls: [{
      name: 'generation_structure.png',
      role: 'structure',
      url: `/generated/${REVIEW_ID}/generation_structure.png`,
    }],
  }
}

function reviewRequiredJob() {
  return {
    id: JOB_ID,
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
    generation_url: `/generated/${JOB_ID}/generation.json`,
    raw_provider_output_url: `/generated/${JOB_ID}/raw_provider_output.png`,
    source_url: `/generated/${JOB_ID}/source.png`,
    normalized_sheet_url: `/generated/${JOB_ID}/normalized_sheet.png`,
    ...Object.fromEntries(Object.entries(STRICT_V2_URL_FIELDS).map(([field, file]) => [
      field,
      `/generated/${JOB_ID}/${file}`,
    ])),
  }
}

async function buildAcceptanceFixture() {
  const review = sealedReview()
  const job = reviewRequiredJob()
  const raw = textEncoder.encode('raw-provider-bytes')
  const source = textEncoder.encode('source-bytes')
  const normalized = textEncoder.encode('normalized-bytes')
  const rawHash = await sha256Bytes(raw)
  const v2Bytes = new Map()
  const v2Artifacts = {}
  const payloads = new Map()

  for (const [field, file] of Object.entries(STRICT_V2_URL_FIELDS)) {
    const bytes = textEncoder.encode(`sealed-v2-artifact:${file}`)
    const sha256 = await sha256Bytes(bytes)
    v2Bytes.set(file, bytes)
    v2Artifacts[file] = {
      file,
      mime_type: file.endsWith('.json') ? 'application/json' : 'image/png',
      byte_length: bytes.byteLength,
      sha256,
    }
    payloads.set(job[field], bytes)
  }

  const backgroundFile = STRICT_V2_URL_FIELDS.background_removed_provider_output_url
  const background = v2Bytes.get(backgroundFile)
  const backgroundArtifact = v2Artifacts[backgroundFile]
  const generation = {
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    generation_review: {
      reviewed_run_id: REVIEW_ID,
      plan_hash: PLAN_HASH,
      reference_manifest_sha256: REFERENCE_HASH,
    },
    background_matte_v2: {
      schema_version: 1,
      recipe_id: STRICT_FIXED_REGION_PROFILE.backgroundMode,
      provider_calls_used: 0,
      source_rgba_sha256: '8'.repeat(64),
      output_rgba_sha256: '9'.repeat(64),
      artifacts: v2Artifacts,
    },
    raw_provider_output: {
      file: 'raw_provider_output.png',
      detected_mime_type: 'image/png',
      processing: 'none',
      byte_length: raw.byteLength,
      sha256: rawHash,
    },
    background_removed_provider_output: {
      file: backgroundFile,
      mime_type: backgroundArtifact.mime_type,
      processing: 'background_removal_only',
      byte_length: background.byteLength,
      sha256: backgroundArtifact.sha256,
      source_file: 'raw_provider_output.png',
      source_sha256: rawHash,
    },
  }
  payloads.set(job.generation_url, textEncoder.encode(JSON.stringify(generation)))
  payloads.set(job.raw_provider_output_url, raw)
  payloads.set(job.source_url, source)
  payloads.set(job.normalized_sheet_url, normalized)

  return {
    review,
    job,
    raw,
    source,
    normalized,
    rawHash,
    background,
    backgroundHash: backgroundArtifact.sha256,
    v2Artifacts,
    payloads,
    expectedFetchUrls: [
      job.generation_url,
      job.raw_provider_output_url,
      ...Object.keys(STRICT_V2_URL_FIELDS).map((field) => job[field]),
      job.source_url,
      job.normalized_sheet_url,
    ],
  }
}

async function buildPendingRecoveryFixture() {
  const fixture = await buildAcceptanceFixture()
  const planHash = 'a'.repeat(64)
  const referenceManifest = {
    protocol: 'generation_reference_manifest_v1',
    schema_version: 1,
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    reference_size: { w: 1024, h: 1024 },
    items: [{
      order: 1,
      name: 'structure_reference.png',
      role: 'structure',
      width: 1024,
      height: 1024,
      mime_type: 'image/png',
      byte_length: 4,
      sha256: 'b'.repeat(64),
    }],
  }
  const referenceBytes = textEncoder.encode(JSON.stringify(referenceManifest))
  const referenceHash = await sha256Bytes(textEncoder.encode(JSON.stringify(canonicalize(referenceManifest))))
  const reviewArtifact = {
    protocol: 'full_sheet_generation_review_v1',
    review_id: REVIEW_ID,
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    plan_hash: planHash,
    reference_manifest_sha256: referenceHash,
    estimated_provider_calls: 1,
    provider_calls_used: 0,
    request_manifest_file: 'generation_request_manifest.json',
    reference_manifest_file: 'generation_reference_manifest.json',
    prompt_file: 'generation_prompt.txt',
  }
  const requestManifest = {
    protocol: 'full_sheet_generation_review_v1',
    schema_version: 1,
    review_id: REVIEW_ID,
    plan_hash: planHash,
    reference_manifest_sha256: referenceHash,
    generation_profile: {
      id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
      source_layout: 'fixed_region_motion_v0',
      background_recipe_id: STRICT_FIXED_REGION_PROFILE.backgroundMode,
    },
    provider: {
      preset_id: GEMINI_PRESET_ID,
      provider: 'gemini',
      route_kind: 'google_native',
      model: 'gemini-test-model',
    },
    image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    generation_options: { candidateCount: 1 },
    max_provider_calls: 1,
    automatic_retry: false,
    provider_fallback: false,
    model_fallback: false,
  }
  const generation = JSON.parse(new TextDecoder().decode(fixture.payloads.get(fixture.job.generation_url)))
  generation.generation_review = {
    reviewed_run_id: REVIEW_ID,
    plan_hash: planHash,
    reference_manifest_sha256: referenceHash,
  }
  generation.candidate_selection = {
    candidate_count: 1,
    artifact_disposition: 'review_required',
    release_ready: false,
    manual_review_required: true,
    human_decision_status: 'pending',
    review_status: 'awaiting_human_review',
    candidates: [{
      status: 'pass',
      failure_status: null,
      release_ready: false,
      manual_review_required: true,
      human_decision_status: 'pending',
      provider_attempts: [{
        provider: 'gemini',
        route_kind: 'google_native',
        status: 'success',
        provider_call_budget_before: { used_provider_calls: 0, max_provider_calls: 1 },
        provider_call_budget_after: { used_provider_calls: 1, max_provider_calls: 1 },
      }],
    }],
  }
  const releaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: STRICT_FIXED_REGION_PROFILE.mode,
    policy: 'strict_live_generation_v1',
    status: 'needs_review',
    release_ready: false,
    manual_review_required: true,
    human_decision_status: 'pending',
    blocking_errors: [],
  }
  const recoveryUrls = {
    review: `/generated/${REVIEW_ID}/generation_review.json`,
    request: `/generated/${REVIEW_ID}/generation_request_manifest.json`,
    references: `/generated/${REVIEW_ID}/generation_reference_manifest.json`,
    generation: fixture.job.generation_url,
    gate: `/generated/${JOB_ID}/generation_release_gate.json`,
  }
  fixture.payloads.set(recoveryUrls.review, textEncoder.encode(JSON.stringify(reviewArtifact)))
  fixture.payloads.set(recoveryUrls.request, textEncoder.encode(JSON.stringify(requestManifest)))
  fixture.payloads.set(recoveryUrls.references, referenceBytes)
  fixture.payloads.set(recoveryUrls.generation, textEncoder.encode(JSON.stringify(generation)))
  fixture.payloads.set(recoveryUrls.gate, textEncoder.encode(JSON.stringify(releaseGate)))
  return {
    ...fixture,
    planHash,
    referenceHash,
    generation,
    releaseGate,
    recoveryUrls,
  }
}

test('provider-free Review locks the fixed-region contract and reports zero Provider calls', async () => {
  assert.equal(Object.isFrozen(STRICT_FIXED_REGION_PROFILE), true)
  assert.equal(Object.isFrozen(STRICT_FIXED_REGION_PROFILE.imageConfig), true)
  assert.equal(Object.isFrozen(STRICT_FIXED_REGION_PROFILE.generationOptions), true)
  const calls = []
  const review = await requestStrictFixedRegionReview({
    runId: REVIEW_ID,
    description: 'one original forest ranger',
    generationOptions: { candidateCount: 1, seed: 7 },
  }, {
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        method: options.method,
        body: options.body ? JSON.parse(options.body) : null,
      })
      if (url === '/api/gemini-state') return jsonResponse(strictGeminiState())
      if (url === '/api/generate-character/review') return jsonResponse(sealedReview())
      throw new Error(`unexpected request: ${url}`)
    },
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    url: '/api/gemini-state',
    method: 'GET',
    body: null,
  })
  assert.equal(calls[1].url, '/api/generate-character/review')
  assert.equal(calls[1].method, 'POST')
  assert.deepEqual(calls[1].body, {
    runId: REVIEW_ID,
    generationProfileId: 'full_sheet_fixed_region_v1',
    providerPresetId: GEMINI_PRESET_ID,
    description: 'one original forest ranger',
    t2iMode: 'production_sheet_v0',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 1, seed: 7 },
    maxProviderCalls: 1,
    backgroundMode: 'deterministic_pixel_matte_v2',
  })
  assert.equal(review.provider_calls_used, 0)
})

test('provider-free Review fails closed before POST when no strict native Gemini preset is ready', async () => {
  const calls = []
  await assert.rejects(
    requestStrictFixedRegionReview({ description: 'one original forest ranger' }, {
      fetchImpl: async (url) => {
        calls.push(url)
        return jsonResponse(strictGeminiState({ includeGemini: false }))
      },
    }),
    (error) => error?.code === 'gemini_not_ready',
  )
  assert.deepEqual(calls, ['/api/gemini-state'])
})

test('live start sends only the six sealed confirmation fields', async () => {
  const calls = []
  const initial = await startStrictLiveGeneration(sealedReview(), {
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return jsonResponse({ id: JOB_ID, status: 'queued' }, 202)
    },
  })

  assert.deepEqual(initial, { id: JOB_ID, status: 'queued' })
  assert.deepEqual(calls, [{
    url: '/api/generate-character',
    body: {
      generationProfileId: 'full_sheet_fixed_region_v1',
      reviewedRunId: REVIEW_ID,
      expectedPlanHash: PLAN_HASH,
      expectedReferenceManifestSha256: REFERENCE_HASH,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    },
  }])
})

test('polling uses fixed 500 ms intervals, stops on terminal state, and times out at 240 polls', async () => {
  const delays = []
  const updates = []
  let pollCount = 0
  const terminal = await pollStrictGenerationJob({ id: JOB_ID, status: 'queued' }, {
    delayImpl: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async () => {
      pollCount += 1
      return jsonResponse(pollCount === 1
        ? { id: JOB_ID, status: 'generating' }
        : { id: JOB_ID, status: 'failed_model_error', reason: 'sealed failure' })
    },
    onUpdate: (job) => updates.push(job.status),
  })
  assert.equal(terminal.status, 'failed_model_error')
  assert.deepEqual(delays, [STRICT_POLL_INTERVAL_MS, STRICT_POLL_INTERVAL_MS])
  assert.deepEqual(updates, ['queued', 'generating', 'failed_model_error'])

  let timeoutPolls = 0
  await assert.rejects(
    pollStrictGenerationJob({ id: JOB_ID, status: 'queued' }, {
      delayImpl: async (milliseconds) => assert.equal(milliseconds, STRICT_POLL_INTERVAL_MS),
      fetchImpl: async () => {
        timeoutPolls += 1
        return jsonResponse({ id: JOB_ID, status: 'post_processing' })
      },
    }),
    (error) => error?.code === 'job_poll_timeout',
  )
  assert.equal(timeoutPolls, STRICT_POLL_LIMIT)
})

test('existing Job observation aborts its in-flight GET without starting another generation', async () => {
  const controller = new AbortController()
  const updates = []
  let observedRequest = null
  let resolveFetchStarted
  const fetchStarted = new Promise((resolve) => {
    resolveFetchStarted = resolve
  })
  const polling = pollStrictGenerationJob({ id: JOB_ID, status: 'generating' }, {
    signal: controller.signal,
    delayImpl: async (milliseconds) => assert.equal(milliseconds, STRICT_POLL_INTERVAL_MS),
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      observedRequest = { url, method: options.method }
      options.signal.addEventListener('abort', () => {
        reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'))
      }, { once: true })
      resolveFetchStarted()
    }),
    onUpdate: (job) => updates.push(job.status),
  })

  await fetchStarted
  controller.abort()
  await assert.rejects(polling, (error) => error?.name === 'AbortError')
  assert.deepEqual(observedRequest, {
    url: `/api/jobs/${JOB_ID}`,
    method: 'GET',
  })
  assert.deepEqual(updates, ['generating'])
})

test('sealed pending deep link restores the exact review-required Job without a Provider request', async () => {
  assert.deepEqual(
    parseStrictPendingGenerationSelector({ jobId: JOB_ID, reviewId: REVIEW_ID }),
    { jobId: JOB_ID, reviewId: REVIEW_ID },
  )
  assert.throws(
    () => parseStrictPendingGenerationSelector({ jobId: '../job', reviewId: REVIEW_ID }),
    (error) => error?.code === 'invalid_client_contract',
  )
  const fixture = await buildPendingRecoveryFixture()
  const requested = []
  const fetchImpl = async (url, options) => {
    requested.push({ url, method: options?.method })
    assert.match(url, /^\/generated\//)
    const bytes = fixture.payloads.get(url)
    assert.ok(bytes, `unexpected recovery request: ${url}`)
    return bytesResponse(bytes)
  }
  const restored = await restoreStrictReviewRequiredGeneration({
    jobId: JOB_ID,
    reviewId: REVIEW_ID,
  }, { fetchImpl })
  assert.deepEqual(
    requested.map(({ url }) => url).sort(),
    Object.values(fixture.recoveryUrls).sort(),
  )
  assert.equal(requested.length, 5)
  assert.ok(requested.every(({ method }) => method === 'GET'))
  assert.equal(requested.filter(({ url }) => url === '/api/generate-character/review').length, 0)
  assert.equal(requested.filter(({ url }) => url === '/api/generate-character').length, 0)
  assert.equal(restored.job.id, JOB_ID)
  assert.equal(restored.job.status, 'done')
  assert.equal(restored.job.artifact_disposition, 'review_required')
  assert.deepEqual(restored.job.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.equal(restored.review.reviewed_run_id, REVIEW_ID)
  assert.equal(restored.review.plan_hash, fixture.planHash)
  assert.equal(restored.review.reference_manifest_sha256, fixture.referenceHash)

  requested.length = 0
  const prepared = await prepareStrictManualAcceptanceEvidence({
    job: restored.job,
    review: restored.review,
    humanReviewedIssueCount: 0,
  }, { fetchImpl })
  assert.equal(prepared.acceptanceBody.expectedPlanHash, fixture.planHash)
  assert.equal(prepared.acceptanceBody.expectedReferenceManifestSha256, fixture.referenceHash)
  assert.ok(requested.every(({ method }) => method === 'GET'))
})

test('pending deep-link recovery fails closed on changed Review bytes or a blocked gate', async () => {
  const changedReview = await buildPendingRecoveryFixture()
  changedReview.payloads.set(
    changedReview.recoveryUrls.references,
    textEncoder.encode(JSON.stringify({ changed: true })),
  )
  await assert.rejects(
    restoreStrictReviewRequiredGeneration({ jobId: JOB_ID, reviewId: REVIEW_ID }, {
      fetchImpl: async (url) => bytesResponse(changedReview.payloads.get(url)),
    }),
    (error) => error?.code === 'pending_review_mismatch',
  )

  const blocked = await buildPendingRecoveryFixture()
  blocked.payloads.set(blocked.recoveryUrls.gate, textEncoder.encode(JSON.stringify({
    ...blocked.releaseGate,
    status: 'failed',
    blocking_errors: ['changed_gate'],
  })))
  await assert.rejects(
    restoreStrictReviewRequiredGeneration({ jobId: JOB_ID, reviewId: REVIEW_ID }, {
      fetchImpl: async (url) => bytesResponse(blocked.payloads.get(url)),
    }),
    (error) => error?.code === 'pending_job_not_reviewable',
  )
})

test('pending deep-link recovery rejects changed bindings and non-1/1 Provider evidence', async () => {
  const staleBinding = await buildPendingRecoveryFixture()
  staleBinding.payloads.set(staleBinding.recoveryUrls.generation, textEncoder.encode(JSON.stringify({
    ...staleBinding.generation,
    generation_review: {
      ...staleBinding.generation.generation_review,
      plan_hash: 'f'.repeat(64),
    },
  })))
  await assert.rejects(
    restoreStrictReviewRequiredGeneration({ jobId: JOB_ID, reviewId: REVIEW_ID }, {
      fetchImpl: async (url) => bytesResponse(staleBinding.payloads.get(url)),
    }),
    (error) => error?.code === 'pending_job_not_reviewable',
  )

  const changedBudget = await buildPendingRecoveryFixture()
  const changedGeneration = structuredClone(changedBudget.generation)
  changedGeneration.candidate_selection.candidates[0]
    .provider_attempts[0].provider_call_budget_after.used_provider_calls = 2
  changedBudget.payloads.set(
    changedBudget.recoveryUrls.generation,
    textEncoder.encode(JSON.stringify(changedGeneration)),
  )
  await assert.rejects(
    restoreStrictReviewRequiredGeneration({ jobId: JOB_ID, reviewId: REVIEW_ID }, {
      fetchImpl: async (url) => bytesResponse(changedBudget.payloads.get(url)),
    }),
    (error) => error?.code === 'pending_job_not_reviewable',
  )
})

test('pending restore recovery classifies only transient reads as retryable', () => {
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'fetch_unavailable' }), true)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'artifact_fetch_timeout' }), true)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'artifact_fetch_failed' }), true)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'artifact_fetch_failed', status: 503 }), true)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'artifact_fetch_failed', status: 404 }), false)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'pending_review_mismatch' }), false)
  assert.equal(isRecoverableStrictPendingRestoreError({ code: 'pending_job_not_reviewable' }), false)
})

test('manual Accept preparation verifies the exact eleven-file V2 ledger byte-for-byte', async () => {
  const fixture = await buildAcceptanceFixture()
  const fetchedUrls = []
  const prepared = await prepareStrictManualAcceptanceEvidence({
    job: fixture.job,
    review: fixture.review,
    humanReviewedIssueCount: 2,
  }, {
    fetchImpl: async (url) => {
      fetchedUrls.push(url)
      const bytes = fixture.payloads.get(url)
      assert.ok(bytes, `unexpected Artifact request: ${url}`)
      return bytesResponse(bytes)
    },
  })

  assert.equal(Object.keys(fixture.v2Artifacts).length, 11)
  assert.deepEqual(fetchedUrls, fixture.expectedFetchUrls)
  assert.equal(prepared.verifiedArtifacts.length, 15)
  for (const [field, file] of Object.entries(STRICT_V2_URL_FIELDS)) {
    assert.deepEqual(
      prepared.verifiedArtifacts.find((artifact) => artifact.field === field),
      {
        field,
        url: fixture.job[field],
        ...fixture.v2Artifacts[file],
      },
    )
  }
  assert.deepEqual(Object.keys(prepared.acceptanceBody), STRICT_ACCEPT_REQUEST_FIELDS)
  assert.deepEqual(prepared.acceptanceBody, {
    confirmManualAcceptance: true,
    expectedPlanHash: PLAN_HASH,
    expectedReferenceManifestSha256: REFERENCE_HASH,
    expectedRawProviderOutputSha256: fixture.rawHash,
    expectedBackgroundRemovedProviderOutputSha256: fixture.backgroundHash,
    expectedSourceSha256: await sha256Bytes(fixture.source),
    expectedNormalizedSheetSha256: await sha256Bytes(fixture.normalized),
    humanReviewedIssueCount: 2,
  })
})

test('manual Accept preparation fails closed on a missing V2 URL or an auxiliary evidence hash mismatch', async () => {
  const missing = reviewRequiredJob()
  delete missing.background_review_url
  await assert.rejects(
    prepareStrictManualAcceptance({
      job: missing,
      review: sealedReview(),
      humanReviewedIssueCount: 0,
    }, {
      fetchImpl: async () => {
        throw new Error('fetch must not run')
      },
    }),
    (error) => error?.code === 'invalid_artifact_url',
  )

  const fixture = await buildAcceptanceFixture()
  const tamperedField = 'background_spill_overlay_url'
  const tamperedFile = STRICT_V2_URL_FIELDS[tamperedField]
  fixture.payloads.set(fixture.job[tamperedField], textEncoder.encode('tampered auxiliary evidence'))
  await assert.rejects(
    prepareStrictManualAcceptance({
      job: fixture.job,
      review: fixture.review,
      humanReviewedIssueCount: 0,
    }, {
      fetchImpl: async (url) => bytesResponse(fixture.payloads.get(url)),
    }),
    (error) => (
      error?.code === 'artifact_hash_mismatch' &&
      error.message.includes(tamperedFile)
    ),
  )
})

test('manual Accept posts the exact body and accepts only a zero-Provider response', async () => {
  assert.equal(STRICT_ACCEPT_REQUEST_TIMEOUT_MS, 60_000)
  const body = {
    confirmManualAcceptance: true,
    expectedPlanHash: PLAN_HASH,
    expectedReferenceManifestSha256: REFERENCE_HASH,
    expectedRawProviderOutputSha256: '3'.repeat(64),
    expectedBackgroundRemovedProviderOutputSha256: '4'.repeat(64),
    expectedSourceSha256: '5'.repeat(64),
    expectedNormalizedSheetSha256: '6'.repeat(64),
    humanReviewedIssueCount: 0,
  }
  const calls = []
  const publicationId = `accepted_v1_${JOB_ID}`
  const acceptedUrls = Object.fromEntries(Object.entries(STRICT_ACCEPT_URL_FIELDS).map(([field, file]) => [
    field,
    `/generated/${publicationId}/${field === 'raw_provider_output_url' ? 'raw_provider_output.png' : file}`,
  ]))
  const accepted = await postStrictManualAcceptance(JOB_ID, body, {
    fetchImpl: async (url, options) => {
      assert.equal(Object.hasOwn(options, 'timeoutMs'), false)
      calls.push({ url, body: JSON.parse(options.body) })
      return jsonResponse({
        mode: 'full_sheet_manual_acceptance_v1',
        status: 'done',
        saved: 'accepted',
        source_job_id: JOB_ID,
        publication_id: publicationId,
        manual_acceptance_status: 'accepted',
        human_reviewed_issue_count: 0,
        manual_acceptance_sha256: '7'.repeat(64),
        provider_calls_used: 0,
        provider_call_budget: {
          planned_provider_calls: 0,
          max_provider_calls: 0,
          used_provider_calls: 0,
        },
        ...acceptedUrls,
      })
    },
  })

  assert.equal(accepted.provider_calls_used, 0)
  assert.deepEqual(calls, [{
    url: `/api/generate-character/${JOB_ID}/accept`,
    body,
  }])
})

test('accepted publication restore replays only the existing zero-Provider Accept binding', async () => {
  const publicationId = `accepted_v1_${JOB_ID}`
  const body = {
    confirmManualAcceptance: true,
    expectedPlanHash: PLAN_HASH,
    expectedReferenceManifestSha256: REFERENCE_HASH,
    expectedRawProviderOutputSha256: '3'.repeat(64),
    expectedBackgroundRemovedProviderOutputSha256: '4'.repeat(64),
    expectedSourceSha256: '5'.repeat(64),
    expectedNormalizedSheetSha256: '6'.repeat(64),
    humanReviewedIssueCount: 0,
  }
  const manifestBytes = textEncoder.encode(JSON.stringify({
    schema_version: 1,
    protocol: 'full_sheet_manual_acceptance_v1',
    acceptance_id: publicationId,
    source_job_id: JOB_ID,
    published_job_id: publicationId,
    decision: 'accepted',
    decision_authority: 'human',
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    provider_calls_used: 0,
    human_reviewed_issue_count: 0,
    generation_review: {
      plan_hash: PLAN_HASH,
      reference_manifest_sha256: REFERENCE_HASH,
    },
    source_artifacts: {
      raw_provider_output_file: 'raw_provider_output.png',
      raw_provider_output_sha256: body.expectedRawProviderOutputSha256,
      background_removed_provider_output_file:
        STRICT_V2_URL_FIELDS.background_removed_provider_output_url,
      background_removed_provider_output_sha256:
        body.expectedBackgroundRemovedProviderOutputSha256,
      source_sha256: body.expectedSourceSha256,
      normalized_sheet_sha256: body.expectedNormalizedSheetSha256,
    },
  }))
  const manifestSha256 = await sha256Bytes(manifestBytes)
  const acceptedUrls = Object.fromEntries(Object.entries(STRICT_ACCEPT_URL_FIELDS).map(([field, file]) => [
    field,
    `/generated/${publicationId}/${field === 'raw_provider_output_url' ? 'raw_provider_output.png' : file}`,
  ]))
  const response = {
    mode: 'full_sheet_manual_acceptance_v1',
    status: 'done',
    saved: 'already_accepted',
    source_job_id: JOB_ID,
    publication_id: publicationId,
    manual_acceptance_status: 'accepted',
    human_reviewed_issue_count: 0,
    manual_acceptance_sha256: manifestSha256,
    provider_calls_used: 0,
    provider_call_budget: {
      planned_provider_calls: 0,
      max_provider_calls: 0,
      used_provider_calls: 0,
    },
    ...acceptedUrls,
  }
  const calls = []
  const restored = await replayStrictAcceptedPublication(publicationId, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' })
      if (url === `/generated/${publicationId}/manual_acceptance.json`) {
        return bytesResponse(manifestBytes)
      }
      assert.equal(url, `/api/generate-character/${JOB_ID}/accept`)
      assert.deepEqual(JSON.parse(options.body), body)
      return jsonResponse(response)
    },
  })

  assert.deepEqual(calls, [
    { url: `/generated/${publicationId}/manual_acceptance.json`, method: 'GET' },
    { url: `/api/generate-character/${JOB_ID}/accept`, method: 'POST' },
  ])
  assert.equal(calls.some(({ url }) => /(?:\/api\/gemini-state|\/api\/jobs\/|\/api\/generate-character$)/.test(url)), false)
  assert.equal(restored.response.saved, 'already_accepted')
  assert.deepEqual(validateStrictAcceptedPublicationCache(restored, publicationId).response, response)
  assert.deepEqual(parseStrictAcceptedPublicationSelector(publicationId), { publicationId, sourceJobId: JOB_ID })
})

test('accepted publication restore rejects unsafe selectors before fetching', async () => {
  let calls = 0
  await assert.rejects(
    replayStrictAcceptedPublication('accepted_v1_../job', {
      fetchImpl: async () => {
        calls += 1
        throw new Error('unexpected fetch')
      },
    }),
    /selector is invalid/,
  )
  assert.equal(calls, 0)
})
