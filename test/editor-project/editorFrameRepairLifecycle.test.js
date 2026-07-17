import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EditorApiError,
  acceptCharacterFrameRepair,
  finalizeFrameRepairQualityGate,
  fetchCharacterProviderState,
  fetchFrameRepairQualityGate,
  generateCharacterFrameRepair,
  planCharacterFrameRepair,
  planFrameRepairQualityGate,
  recordFrameRepairQualityGateOutcome,
  recordFrameRepairQualityGateReview,
  recoverCharacterFrameRepair,
  setupFrameRepairQualityGate,
  startFrameRepairQualityGate,
} from '../../src/ui/editor/api.js'
import {
  FRAME_REPAIR_RECOVERY_STORAGE_KEY,
  createFrameRepairLifecycle,
} from '../../src/ui/editor/frameRepairLifecycle.js'

const PLAN_HASH = 'a'.repeat(64)
const OPERATION_ID = 'fr_0123456789abcdef'

function response({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function installFetch(t, implementation) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  t.after(() => {
    globalThis.fetch = original
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

function memorySessionStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null
    },
    setItem(key, value) {
      entries.set(key, String(value))
    },
    removeItem(key) {
      entries.delete(key)
    },
    value(key = FRAME_REPAIR_RECOVERY_STORAGE_KEY) {
      const raw = entries.get(key)
      return raw == null ? null : JSON.parse(raw)
    },
  }
}

function createTimerHarness() {
  let nextId = 1
  let maximumPending = 0
  const pending = new Map()
  const cancelled = []
  return {
    schedule(callback) {
      const id = nextId++
      pending.set(id, callback)
      maximumPending = Math.max(maximumPending, pending.size)
      return id
    },
    cancel(id) {
      cancelled.push(id)
      pending.delete(id)
    },
    runNext() {
      const entry = pending.entries().next().value
      assert.ok(entry, 'expected one scheduled callback')
      const [id, callback] = entry
      pending.delete(id)
      callback()
    },
    get size() {
      return pending.size
    },
    get maximumPending() {
      return maximumPending
    },
    cancelled,
  }
}

function selection(overrides = {}) {
  return {
    projectId: 'project_demo',
    projectRevision: 4,
    assetId: 'asset_hero',
    revisionId: 'rev_003',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 33,
    ...overrides,
  }
}

function planInput(overrides = {}) {
  return {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: {
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      clipId: 'walk_down',
      clipFramePosition: 1,
      sheetFrameIndex: 33,
      instruction: 'repair the hand',
      maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
      providerPresetId: 'gemini_pixel_default',
      imageConfig: { image_size: '1K' },
    },
    ...overrides,
  }
}

function liveInput(overrides = {}) {
  const planned = planInput()
  return {
    ...planned,
    body: {
      ...planned.body,
      expectedPlanHash: PLAN_HASH,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    },
    ...overrides,
  }
}

function acceptInput(overrides = {}) {
  return {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    jobId: 'job_frame',
    body: {
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      expectedPlanHash: PLAN_HASH,
      warningConfirmed: true,
    },
    ...overrides,
  }
}

function job(status, overrides = {}) {
  return {
    id: 'job_frame',
    status,
    project_id: 'project_demo',
    project_revision: 4,
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_003',
    operation_id: OPERATION_ID,
    plan_hash: PLAN_HASH,
    recovery_state: null,
    ...overrides,
  }
}

function abortError() {
  const error = new Error('operation aborted')
  error.name = 'AbortError'
  return error
}

test('Frame Repair browser API uses exact encoded routes, bodies, methods, and signals', async (t) => {
  const requests = []
  installFetch(t, async (url, options) => {
    requests.push({ url, options })
    return response({ body: { ok: true } })
  })
  const controller = new AbortController()

  await planCharacterFrameRepair({ projectId: 'project/demo', assetId: 'asset hero?', body: { type: 'plan' } }, { signal: controller.signal })
  await generateCharacterFrameRepair({ projectId: 'project/demo', assetId: 'asset hero?', body: { type: 'live' } }, { signal: controller.signal })
  await recoverCharacterFrameRepair({ projectId: 'project/demo', assetId: 'asset hero?', operationId: 'fr/operation?' }, { signal: controller.signal })
  await acceptCharacterFrameRepair({ projectId: 'project/demo', assetId: 'asset hero?', jobId: 'job/frame?', body: { type: 'accept' } }, { signal: controller.signal })
  await fetchCharacterProviderState({ signal: controller.signal })

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/frame-repair/plan',
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/frame-repair',
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/frame-repair/operations/fr%2Foperation%3F',
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/frame-repair/job%2Fframe%3F/accept',
    '/api/gemini-state',
  ])
  assert.deepEqual(requests.map(({ options }) => options.method), ['POST', 'POST', 'GET', 'POST', 'GET'])
  assert.deepEqual(requests.slice(0, 4).map(({ options }) => options.signal), Array(4).fill(controller.signal))
  assert.equal(requests[4].options.signal, controller.signal)
  assert.deepEqual(requests.map(({ options }) => options.body && JSON.parse(options.body)), [
    { type: 'plan' },
    { type: 'live' },
    undefined,
    { type: 'accept' },
    undefined,
  ])
})

test('Quality Gate browser API uses seven exact one-shot routes and forwards AbortSignal', async (t) => {
  const requests = []
  installFetch(t, async (url, options) => {
    requests.push({ url, options })
    return response({ body: { ok: true } })
  })
  const controller = new AbortController()
  const body = { exact: true }
  const common = { projectId: 'project/demo', sessionId: 'frqg/session?', caseId: 'case/name?' }
  await setupFrameRepairQualityGate({ sourceProjectId: 'source/demo', body }, { signal: controller.signal })
  await planFrameRepairQualityGate({ projectId: common.projectId, body }, { signal: controller.signal })
  await startFrameRepairQualityGate({ projectId: common.projectId, body }, { signal: controller.signal })
  await fetchFrameRepairQualityGate(common, { signal: controller.signal })
  await recordFrameRepairQualityGateReview({ ...common, body }, { signal: controller.signal })
  await recordFrameRepairQualityGateOutcome({ ...common, body }, { signal: controller.signal })
  await finalizeFrameRepairQualityGate({ ...common, body }, { signal: controller.signal })

  assert.deepEqual(requests.map((item) => item.url), [
    '/api/editor/projects/source%2Fdemo/frame-repair-quality-gates/setup',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates/plan',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates/frqg%2Fsession%3F',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates/frqg%2Fsession%3F/cases/case%2Fname%3F/review',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates/frqg%2Fsession%3F/cases/case%2Fname%3F/outcome',
    '/api/editor/projects/project%2Fdemo/frame-repair-quality-gates/frqg%2Fsession%3F/finalize',
  ])
  assert.deepEqual(requests.map((item) => item.options.method),
    ['POST', 'POST', 'POST', 'GET', 'POST', 'POST', 'POST'])
  assert.equal(requests.every((item) => item.options.signal === controller.signal), true)
  assert.equal(requests.filter((item) => item.options.body).every((item) => (
    JSON.stringify(JSON.parse(item.options.body)) === JSON.stringify(body)
  )), true)
})

test('Frame Repair server errors remain controlled while unknown strings collapse', async (t) => {
  const codes = [
    'invalid_frame_repair_request',
    'invalid_frame_repair_plan',
    'invalid_frame_repair_mask',
    'invalid_frame_repair_reference',
    'invalid_frame_repair_service_input',
    'frame_identity_mismatch',
    'invalid_operation_identity',
    'invalid_operation_lookup',
    'operation_not_found',
    'stale_plan',
    'operation_conflict',
    'job_not_ready',
    'frame_repair_unavailable',
    'provider_unavailable',
    'provider_configuration_error',
  ]
  const replies = [
    ...codes.map((code) => response({ status: code.includes('unavailable') || code === 'provider_configuration_error' ? 503 : 400, body: { error: code, reason: `${code} reason` } })),
    response({ status: 500, body: { error: 'private_internal_marker', reason: 'request failed internally' } }),
  ]
  let index = 0
  installFetch(t, async () => replies[index++])

  for (const code of codes) {
    await assert.rejects(planCharacterFrameRepair(planInput()), (error) => {
      assert.ok(error instanceof EditorApiError)
      assert.equal(error.code, code)
      assert.equal(error.message, `${code} reason`)
      return true
    })
  }
  await assert.rejects(planCharacterFrameRepair(planInput()), (error) => {
    assert.equal(error.code, 'editor_request_failed')
    assert.equal(error.message, 'request failed internally')
    return true
  })
})

test('selection and local edits never submit Plan or live generation', async () => {
  const calls = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async (payload) => { calls.push(['plan', payload]); return { plan_hash: PLAN_HASH } },
    generate: async (payload) => { calls.push(['generate', payload]); return job('done') },
    recover: async (payload) => { calls.push(['recover', payload]); return job('done') },
    fetchJob: async () => job('done'),
    accept: async () => ({ accepted: true }),
    storage: memorySessionStorage(),
    createOperationId: () => OPERATION_ID,
    schedule: (callback) => { callback(); return 1 },
    cancel: () => undefined,
  })
  lifecycle.setSelection(selection())
  lifecycle.invalidatePlan('mask_edit')
  lifecycle.invalidatePlan('instruction_edit')
  assert.deepEqual(calls, [])
  await lifecycle.plan({ request: 'plan' })
  assert.deepEqual(calls.map(([type]) => type), ['plan'])
  await lifecycle.generate({ request: 'live' })
  assert.equal(calls.filter(([type]) => type === 'generate').length, 1)
})

test('Plan invalidation aborts older work and only the newest selection may adopt a result', async () => {
  const first = deferred()
  const second = deferred()
  const calls = []
  const updates = []
  const lifecycle = createFrameRepairLifecycle({
    plan(payload, options) {
      calls.push({ payload, options })
      return payload.label === 'first' ? first.promise : second.promise
    },
    generate: async () => job('done'),
    recover: async () => job('done'),
    fetchJob: async () => job('done'),
    accept: async () => ({ accepted: true }),
    storage: memorySessionStorage(),
    createOperationId: () => OPERATION_ID,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())

  const oldPlan = lifecycle.plan({ label: 'first' })
  const newPlan = lifecycle.plan({ label: 'second' })
  assert.equal(calls[0].options.signal.aborted, true)
  assert.equal(calls[1].options.signal.aborted, false)
  second.resolve({ plan_hash: PLAN_HASH, can_run: true })
  assert.equal((await newPlan).plan_hash, PLAN_HASH)
  first.resolve({ plan_hash: 'b'.repeat(64), can_run: true })
  assert.equal(await oldPlan, null)
  assert.deepEqual(updates.filter((event) => event.type === 'planned').map((event) => event.plan.plan_hash), [PLAN_HASH])

  lifecycle.invalidatePlan('mask_edit')
  assert.equal(lifecycle.capture().planHash, null)
  const generateCalls = calls.filter((entry) => entry.payload?.body?.confirmLiveGeneration)
  assert.equal(await lifecycle.generate(liveInput()), null)
  assert.equal(generateCalls.length, 0)
})

test('Generate allocates one operation synchronously, deduplicates clicks, stores a minimal handle, and polls one job', async () => {
  const submitted = deferred()
  const timers = createTimerHarness()
  const storage = memorySessionStorage()
  const generateCalls = []
  const fetchCalls = []
  const updates = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate(payload, options) {
      generateCalls.push({ payload, options })
      return submitted.promise
    },
    recover: async () => job('done'),
    fetchJob(jobId, options) {
      fetchCalls.push({ jobId, options })
      return job('done')
    },
    accept: async () => ({ accepted: true }),
    storage,
    createOperationId: () => OPERATION_ID,
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())

  const first = lifecycle.generate(liveInput())
  const duplicate = lifecycle.generate(liveInput())
  assert.equal(duplicate, first)
  assert.equal(lifecycle.capture().liveInFlight, true)
  assert.equal(generateCalls.length, 1)
  assert.equal(generateCalls[0].payload.body.operationId, OPERATION_ID)
  assert.equal(generateCalls[0].options.signal.aborted, false)
  assert.deepEqual(storage.value(), {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    operationId: OPERATION_ID,
    jobId: null,
    planHash: PLAN_HASH,
  })

  submitted.resolve(job('queued'))
  await flushMicrotasks()
  assert.equal(timers.size, 1)
  assert.deepEqual(storage.value(), {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    operationId: OPERATION_ID,
    jobId: 'job_frame',
    planHash: PLAN_HASH,
  })
  timers.runNext()
  assert.deepEqual(await first, job('done'))
  assert.deepEqual(fetchCalls.map((call) => call.jobId), ['job_frame'])
  assert.equal(fetchCalls[0].options.signal, generateCalls[0].options.signal)
  assert.equal(timers.size, 0)
  assert.equal(timers.maximumPending, 1)
  assert.deepEqual(updates.filter((event) => event.type === 'generation_started').map((event) => event.operationId), [OPERATION_ID])
})

test('one reviewed Plan can authorize only one generation operation', async () => {
  let planCount = 0
  let generateCount = 0
  let operationCount = 0
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true, review: ++planCount }),
    generate: async (payload) => {
      generateCount += 1
      return job('done', {
        id: `job_frame_${generateCount}`,
        operation_id: payload.body.operationId,
      })
    },
    recover: async () => job('done'),
    fetchJob: async () => job('done'),
    accept: async () => ({ accepted: true }),
    storage: memorySessionStorage(),
    createOperationId: () => `fr_0123456789abcde${++operationCount}`,
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())

  assert.equal((await lifecycle.generate(liveInput())).id, 'job_frame_1')
  assert.equal(await lifecycle.generate(liveInput()), null)
  assert.equal(generateCount, 1)

  await lifecycle.plan(planInput())
  assert.equal((await lifecycle.generate(liveInput())).id, 'job_frame_2')
  assert.equal(generateCount, 2)
})

test('close invalidates an unspent Plan authorization without clearing its draft hash', async () => {
  let generateCount = 0
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async () => { generateCount += 1; return job('done') },
    recover: async () => job('done'),
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage: memorySessionStorage(),
    createOperationId: () => OPERATION_ID,
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  lifecycle.stop('close')

  assert.equal(lifecycle.capture().planHash, PLAN_HASH)
  assert.equal(await lifecycle.generate(liveInput()), null)
  assert.equal(generateCount, 0)
})

test('lost live response performs one operation lookup and never repeats generation', async () => {
  const storage = memorySessionStorage()
  const calls = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async (payload) => {
      calls.push(['generate', payload])
      throw new TypeError('connection lost after submit')
    },
    recover: async (payload) => {
      calls.push(['recover', payload])
      return job('done')
    },
    fetchJob: async () => { throw new Error('terminal operation must not poll') },
    accept: async () => ({ accepted: true }),
    storage,
    createOperationId: () => OPERATION_ID,
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())

  assert.deepEqual(await lifecycle.generate(liveInput()), job('done'))
  assert.deepEqual(calls.map(([type]) => type), ['generate', 'recover'])
  assert.deepEqual(calls[1][1], {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    operationId: OPERATION_ID,
  })
  assert.equal(storage.value().jobId, 'job_frame')
})

test('operation recovery preserves an unknown outcome and never polls or retries', async () => {
  const storage = memorySessionStorage()
  const calls = []
  const updates = []
  const unknown = job('generating', { recovery_state: 'outcome_unknown' })
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async () => {
      calls.push('generate')
      throw Object.assign(new Error('gateway lost response'), { status: 503 })
    },
    recover: async () => {
      calls.push('recover')
      return unknown
    },
    fetchJob: async () => { calls.push('fetch'); return job('done') },
    accept: async () => ({ accepted: true }),
    storage,
    createOperationId: () => OPERATION_ID,
    schedule: (callback) => { callback(); return 1 },
    cancel: () => undefined,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())

  assert.deepEqual(await lifecycle.generate(liveInput()), unknown)
  assert.deepEqual(calls, ['generate', 'recover'])
  assert.equal(storage.value().operationId, OPERATION_ID)
  assert.equal(updates.at(-1).type, 'outcome_unknown')
})

test('polling is pinned to the original job id even when later responses omit or change it', async () => {
  const timers = createTimerHarness()
  const requested = []
  const updates = []
  const replies = [
    { id: 'job_wrong', status: 'generating', recovery_state: null },
    { status: 'done', recovery_state: null },
  ]
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async () => job('queued'),
    recover: async () => job('done'),
    fetchJob(jobId) {
      requested.push(jobId)
      return replies.shift()
    },
    accept: async () => ({ accepted: true }),
    storage: memorySessionStorage(),
    createOperationId: () => OPERATION_ID,
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  const operation = lifecycle.generate(liveInput())
  await flushMicrotasks()

  timers.runNext()
  await flushMicrotasks()
  assert.equal(timers.size, 1)
  timers.runNext()
  assert.deepEqual(await operation, job('done'))
  assert.deepEqual(requested, ['job_frame', 'job_frame'])
  assert.deepEqual(updates.filter((event) => event.type === 'job').map((event) => event.job.id), [
    'job_frame', 'job_frame', 'job_frame',
  ])
})

test('refresh recovery accepts only the exact minimal session handle and performs no POST', async (t) => {
  const validHandle = {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    operationId: OPERATION_ID,
    jobId: null,
    planHash: PLAN_HASH,
  }
  const invalidHandles = [
    { ...validHandle, instruction: 'must never persist' },
    { ...validHandle, operationId: 'short' },
    { ...validHandle, jobId: '../job' },
    { ...validHandle, planHash: 'A'.repeat(64) },
    { projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID, planHash: PLAN_HASH },
  ]

  for (const [index, handle] of invalidHandles.entries()) {
    await t.test(`rejects invalid handle ${index + 1}`, async () => {
      const storage = memorySessionStorage({
        [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify(handle),
      })
      let recoverCalls = 0
      const lifecycle = createFrameRepairLifecycle({
        plan: async () => { throw new Error('no Plan POST') },
        generate: async () => { throw new Error('no live POST') },
        recover: async () => { recoverCalls += 1; return job('done') },
        fetchJob: async () => job('done'),
        accept: async () => { throw new Error('no Accept POST') },
        storage,
      })
      lifecycle.setSelection(selection())
      assert.equal(await lifecycle.recoverFromSession(), null)
      assert.equal(recoverCalls, 0)
      assert.equal(storage.value(), null)
    })
  }

  const timers = createTimerHarness()
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify(validHandle),
  })
  const calls = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => { calls.push('plan') },
    generate: async () => { calls.push('generate') },
    recover: async (payload) => { calls.push(['recover', payload]); return job('queued') },
    fetchJob: async (jobId) => { calls.push(['fetch', jobId]); return job('done') },
    accept: async () => { calls.push('accept') },
    storage,
    schedule: timers.schedule,
    cancel: timers.cancel,
  })
  lifecycle.setSelection(selection())
  const recovery = lifecycle.recoverFromSession()
  await flushMicrotasks()
  assert.equal(timers.size, 1)
  timers.runNext()
  assert.deepEqual(await recovery, job('done'))
  assert.deepEqual(calls, [
    ['recover', { projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID }],
    ['fetch', 'job_frame'],
  ])
})

test('refresh recovery is scoped to the selected project and asset', async () => {
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify({
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: null, planHash: PLAN_HASH,
    }),
  })
  let recoverCalls = 0
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => { recoverCalls += 1; return job('done') },
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage,
  })
  lifecycle.setSelection(selection({ assetId: 'asset_other' }))

  assert.equal(await lifecycle.recoverFromSession(), null)
  assert.equal(recoverCalls, 0)
  assert.notEqual(storage.value(), null)
})

test('refresh recovery rejects an operation bound to a different parent revision', async () => {
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify({
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: null, planHash: PLAN_HASH,
    }),
  })
  const updates = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => job('done', { parent_revision_id: 'rev_003' }),
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection({ revisionId: 'rev_004' }))

  assert.equal(await lifecycle.recoverFromSession(), null)
  assert.equal(updates.some((event) => event.type === 'job'), false)
  assert.equal(updates.at(-1).error.code, 'identity_mismatch')
  assert.notEqual(storage.value(), null)
})

test('controlled operation not-found remains recoverable until explicit acknowledgement', async () => {
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify({
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: null, planHash: PLAN_HASH,
    }),
  })
  const updates = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => {
      throw Object.assign(new Error('operation not found'), {
        name: 'EditorApiError', status: 404, code: 'operation_not_found',
      })
    },
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())

  assert.equal(await lifecycle.recoverFromSession(), null)
  assert.notEqual(storage.value(), null)
  assert.equal(updates.at(-1).controlledNotFound, true)
  lifecycle.stop('close')
  assert.notEqual(storage.value(), null)
  lifecycle.stop('not_found_acknowledged')
  assert.equal(storage.value(), null)
})

test('selection switches, teardown, and late results abort local observation without clearing recovery', async () => {
  const latePlan = deferred()
  const storage = memorySessionStorage()
  const updates = []
  let planSignal
  const lifecycle = createFrameRepairLifecycle({
    plan(_payload, { signal }) {
      planSignal = signal
      return latePlan.promise
    },
    generate: async () => job('queued'),
    recover: async () => job('done'),
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage,
    createOperationId: () => OPERATION_ID,
    schedule: (callback) => { callback(); return 1 },
    cancel: () => undefined,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  const planning = lifecycle.plan(planInput())
  lifecycle.setSelection(selection({ revisionId: 'rev_004' }))
  assert.equal(planSignal.aborted, true)
  latePlan.resolve({ plan_hash: PLAN_HASH })
  assert.equal(await planning, null)
  assert.equal(updates.some((event) => event.type === 'planned'), false)

  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  await lifecycle.generate(liveInput())
  assert.notEqual(storage.value(), null)
  lifecycle.stop('teardown')
  assert.notEqual(storage.value(), null)
  const capture = lifecycle.capture()
  assert.deepEqual(capture.selection, selection())
  assert.equal(capture.planHash, PLAN_HASH)
  assert.equal(capture.planInFlight, false)
  assert.equal(capture.liveInFlight, false)
  assert.equal(capture.pollScheduled, false)
  assert.equal(capture.acceptOperationCount, 0)
  assert.deepEqual(capture.recoveryHandle, storage.value())
})

test('close detaches an abort-ignoring live request so the original operation can recover', async () => {
  const lateLive = deferred()
  const storage = memorySessionStorage()
  const calls = []
  const updates = []
  let liveSignal
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate(_payload, { signal }) {
      calls.push('generate')
      liveSignal = signal
      return lateLive.promise
    },
    recover: async () => {
      calls.push('recover')
      return job('done')
    },
    fetchJob: async () => job('done'),
    accept: async () => ({}),
    storage,
    createOperationId: () => OPERATION_ID,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  const oldRequest = lifecycle.generate(liveInput())
  assert.deepEqual(calls, ['generate'])

  lifecycle.stop('close')
  assert.equal(liveSignal.aborted, true)
  assert.equal(lifecycle.capture().liveInFlight, false)
  assert.deepEqual(await lifecycle.recoverFromSession(), job('done'))
  assert.deepEqual(calls, ['generate', 'recover'])

  lateLive.resolve(job('done'))
  assert.equal(await oldRequest, null)
  assert.equal(updates.filter((event) => event.type === 'job').length, 1)
})

test('stop aborts an in-flight poll and removes its one timer without reporting a late error', async () => {
  const timers = createTimerHarness()
  const pendingPoll = deferred()
  const updates = []
  let pollSignal
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async () => job('queued'),
    recover: async () => job('done'),
    fetchJob(_jobId, { signal }) {
      pollSignal = signal
      return pendingPoll.promise
    },
    accept: async () => ({}),
    storage: memorySessionStorage(),
    createOperationId: () => OPERATION_ID,
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  const operation = lifecycle.generate(liveInput())
  await flushMicrotasks()
  timers.runNext()
  await flushMicrotasks()

  lifecycle.stop('blur')
  assert.equal(pollSignal.aborted, true)
  assert.equal(timers.size, 0)
  pendingPoll.reject(abortError())
  assert.equal(await operation, null)
  assert.deepEqual(updates.filter((event) => event.type === 'error'), [])
  assert.equal(lifecycle.capture().liveInFlight, false)
})

test('Accept snapshots identity, deduplicates exact requests, guards late results, and clears recovery only on current success', async () => {
  const accepted = deferred()
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify({
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: 'job_frame', planHash: PLAN_HASH,
    }),
  })
  const calls = []
  const updates = []
  const late = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH }),
    generate: async () => job('done'),
    recover: async () => job('done'),
    fetchJob: async () => job('done'),
    accept(payload) {
      calls.push(payload)
      return accepted.promise
    },
    storage,
    onUpdate: (event) => updates.push(event),
    onLateAccept: (event) => late.push(event),
  })
  lifecycle.setSelection(selection())
  const payload = acceptInput()
  const first = lifecycle.accept(payload)
  const duplicate = lifecycle.accept(structuredClone(payload))
  assert.equal(duplicate, first)
  assert.equal(lifecycle.capture().acceptOperationCount, 1)
  assert.equal(calls.length, 1)
  payload.body.warningConfirmed = false
  assert.equal(calls[0].body.warningConfirmed, true)

  accepted.resolve({ accepted: true, project: { id: 'project_demo', revision: 5 } })
  assert.deepEqual(await first, { accepted: true, project: { id: 'project_demo', revision: 5 } })
  assert.equal(storage.value(), null)
  assert.equal(updates.filter((event) => event.type === 'accepted').length, 1)
  assert.deepEqual(late, [])

  const oldResult = deferred()
  const lifecycleLate = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => ({}),
    fetchJob: async () => ({}),
    accept: () => oldResult.promise,
    storage: memorySessionStorage(),
    onUpdate: (event) => updates.push(event),
    onLateAccept: (event) => late.push(event),
  })
  const oldSelection = selection()
  lifecycleLate.setSelection(oldSelection)
  const oldAccept = lifecycleLate.accept(acceptInput())
  lifecycleLate.setSelection(selection({ projectId: 'project_other', projectRevision: 1 }))
  oldResult.resolve({ accepted: true })
  assert.equal(await oldAccept, null)
  assert.deepEqual(late.at(-1).selection, oldSelection)
  assert.equal(updates.filter((event) => event.type === 'accepted').length, 1)
})

test('Accept uncertainty retains recovery while acknowledged discard clears it', async () => {
  const initialHandle = {
    projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
    jobId: 'job_frame', planHash: PLAN_HASH,
  }
  const storage = memorySessionStorage({
    [FRAME_REPAIR_RECOVERY_STORAGE_KEY]: JSON.stringify(initialHandle),
  })
  const updates = []
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => ({}),
    fetchJob: async () => ({}),
    accept: async () => { throw new TypeError('connection reset after Accept') },
    storage,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())

  assert.equal(await lifecycle.accept(acceptInput()), null)
  assert.deepEqual(storage.value(), initialHandle)
  assert.equal(updates.at(-1).outcomeUnknown, true)
  lifecycle.stop('discarded')
  assert.equal(storage.value(), null)
})

test('a valid locked operation id is reused while invalid or absent ids retain random identity', async () => {
  const generated = []
  let randomCalls = 0
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({ plan_hash: PLAN_HASH, can_run: true }),
    generate: async (payload) => {
      generated.push(structuredClone(payload))
      return job('done', { operation_id: payload.body.operationId })
    },
    recover: async () => null,
    fetchJob: async () => null,
    accept: async () => null,
    storage: memorySessionStorage(),
    createOperationId: () => {
      randomCalls += 1
      return OPERATION_ID
    },
  })
  lifecycle.setSelection(selection())
  await lifecycle.plan(planInput())
  const lockedId = 'frqgop_' + 'b'.repeat(48)
  await lifecycle.generate({ ...liveInput(), operationId: lockedId })
  assert.equal(generated[0].body.operationId, lockedId)
  assert.equal(randomCalls, 0)

  lifecycle.invalidatePlan('new_case')
  await lifecycle.plan(planInput())
  await lifecycle.generate({ ...liveInput(), operationId: 'invalid' })
  assert.equal(generated[1].body.operationId, OPERATION_ID)
  assert.equal(randomCalls, 1)
})

test('deferred Accept preserves the result and emits no adoption event', async () => {
  const updates = []
  const accepted = { project: { id: 'project_demo', revision: 5 }, revision: { id: 'rev_004' } }
  const lifecycle = createFrameRepairLifecycle({
    plan: async () => ({}),
    generate: async () => ({}),
    recover: async () => ({}),
    fetchJob: async () => ({}),
    accept: async () => accepted,
    storage: memorySessionStorage(),
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(selection())
  assert.equal(await lifecycle.accept(acceptInput(), { deferProjectAdoption: true }), accepted)
  assert.equal(updates.some((event) => event.type === 'accepted'), false)
  assert.equal(updates.filter((event) => event.type === 'accepted_deferred').length, 1)
})
