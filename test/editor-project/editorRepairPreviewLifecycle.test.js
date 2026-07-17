import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EditorApiError,
  acceptCharacterReprocessPreview,
  buildCharacterReprocessPreview,
  fetchJob,
} from '../../src/ui/editor/api.js'
import { createRepairPreviewLifecycle } from '../../src/ui/editor/repairPreviewLifecycle.js'

const RECIPE_HASH = 'b'.repeat(64)

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

function repairSelection(overrides = {}) {
  return {
    projectId: 'project_demo',
    projectRevision: 4,
    assetId: 'asset_hero',
    revisionId: 'rev_003',
    ...overrides,
  }
}

async function flushMicrotasks(count = 6) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
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
      assert.ok(entry, 'expected a scheduled poll')
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

function abortError() {
  const error = new Error('operation aborted')
  error.name = 'AbortError'
  return error
}

test('reprocess Preview and Accept use encoded routes and exact request bodies', async (t) => {
  const requests = []
  installFetch(t, async (url, options) => {
    requests.push({ url, options })
    return response({ body: { id: requests.length === 1 ? 'job_preview' : undefined, project: {} } })
  })
  const recipe = {
    schema_version: 'processing_recipe_v0',
    implementation_revision: null,
    background: { mode: 'auto', tolerance: 24 },
  }

  await buildCharacterReprocessPreview({
    projectId: 'project/demo',
    assetId: 'asset hero?',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    recipe,
  })
  await acceptCharacterReprocessPreview({
    projectId: 'project/demo',
    assetId: 'asset hero?',
    jobId: 'job/preview?',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    expectedRecipeHash: RECIPE_HASH,
    warningConfirmed: true,
  })

  assert.equal(requests.length, 2)
  assert.equal(
    requests[0].url,
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/reprocess',
  )
  assert.equal(requests[0].options.method, 'POST')
  assert.deepEqual(requests[0].options.headers, { 'content-type': 'application/json' })
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    recipe,
  })
  assert.equal(
    requests[1].url,
    '/api/editor/projects/project%2Fdemo/assets/asset%20hero%3F/reprocess/job%2Fpreview%3F/accept',
  )
  assert.equal(requests[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    expectedRecipeHash: RECIPE_HASH,
    warningConfirmed: true,
  })
})

test('reprocess requests forward Build signals but omit an Accept signal unless provided', async (t) => {
  const requests = []
  installFetch(t, async (_url, options) => {
    requests.push(options)
    return response()
  })
  const controller = new AbortController()
  const input = {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    recipe: { implementation_revision: null },
  }

  await buildCharacterReprocessPreview(input, { signal: controller.signal })
  await acceptCharacterReprocessPreview({
    ...input,
    jobId: 'job_preview',
    expectedRecipeHash: RECIPE_HASH,
  })

  assert.equal(requests[0].signal, controller.signal)
  assert.equal(requests[1].signal, undefined)
  assert.equal(JSON.parse(requests[1].body).warningConfirmed, false)
})

test('job polling forwards a lifecycle AbortSignal without changing its route', async (t) => {
  const requests = []
  installFetch(t, async (url, options) => {
    requests.push({ url, options })
    return response({ body: { id: 'job/preview', status: 'queued' } })
  })
  const controller = new AbortController()

  await fetchJob('job/preview', { signal: controller.signal })

  assert.equal(requests[0].url, '/api/jobs/job%2Fpreview')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal(requests[0].options.signal, controller.signal)
})

test('EditorApiError preserves controlled status, code, reason, and details', async (t) => {
  const details = { expected_revision: 4, actual_revision: 5 }
  installFetch(t, async () => response({
    status: 409,
    body: {
      error: 'revision_conflict',
      reason: 'project revision changed',
      details,
    },
  }))

  await assert.rejects(
    buildCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      recipe: { implementation_revision: null },
    }),
    (error) => {
      assert.ok(error instanceof EditorApiError)
      assert.equal(error.name, 'EditorApiError')
      assert.equal(error.message, 'project revision changed')
      assert.equal(error.status, 409)
      assert.equal(error.code, 'revision_conflict')
      assert.deepEqual(error.details, details)
      return true
    },
  )
})

test('Build serialization never mutates the editable null implementation revision', async (t) => {
  const bodies = []
  installFetch(t, async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    return response({
      body: {
        id: `job_${bodies.length}`,
        canonical_recipe: { implementation_revision: 'server-build-revision' },
      },
    })
  })
  const editableRecipe = {
    schema_version: 'processing_recipe_v0',
    implementation_revision: null,
    background: { mode: 'auto', tolerance: 24 },
  }
  const request = {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    recipe: editableRecipe,
  }

  const first = await buildCharacterReprocessPreview(request)
  const second = await buildCharacterReprocessPreview(request)

  assert.equal(first.canonical_recipe.implementation_revision, 'server-build-revision')
  assert.equal(second.canonical_recipe.implementation_revision, 'server-build-revision')
  assert.equal(editableRecipe.implementation_revision, null)
  assert.deepEqual(bodies.map((body) => body.recipe.implementation_revision), [null, null])
})

test('EditorApiError collapses unknown server codes and normalizes malformed error bodies', async (t) => {
  const replies = [
    response({
      status: 500,
      body: { error: 'internal_stack_marker', reason: 'internal request failed', details: { request_id: 'req_1' } },
    }),
    {
      ok: false,
      status: 502,
      text: async () => '<html>bad gateway</html>',
    },
    {
      ok: false,
      status: 503,
      text: async () => 'null',
    },
    response({
      status: 409,
      body: { error: 'revision_conflict', reason: 'revision changed', details: ['not', 'an', 'object'] },
    }),
    response({
      status: 500,
      body: { error: 'internal_stack_marker' },
    }),
  ]
  let index = 0
  installFetch(t, async () => replies[index++])
  const request = {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    recipe: { implementation_revision: null },
  }

  await assert.rejects(buildCharacterReprocessPreview(request), (error) => {
    assert.ok(error instanceof EditorApiError)
    assert.equal(error.status, 500)
    assert.equal(error.code, 'editor_request_failed')
    assert.equal(error.message, 'internal request failed')
    assert.deepEqual(error.details, { request_id: 'req_1' })
    return true
  })
  await assert.rejects(buildCharacterReprocessPreview(request), (error) => {
    assert.ok(error instanceof EditorApiError)
    assert.equal(error.status, 502)
    assert.equal(error.code, 'editor_request_failed')
    assert.equal(error.details, null)
    return true
  })
  await assert.rejects(buildCharacterReprocessPreview(request), (error) => {
    assert.ok(error instanceof EditorApiError)
    assert.equal(error.status, 503)
    assert.equal(error.code, 'editor_request_failed')
    assert.equal(error.details, null)
    return true
  })
  await assert.rejects(buildCharacterReprocessPreview(request), (error) => {
    assert.ok(error instanceof EditorApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'revision_conflict')
    assert.equal(error.details, null)
    return true
  })
  await assert.rejects(buildCharacterReprocessPreview(request), (error) => {
    assert.ok(error instanceof EditorApiError)
    assert.equal(error.status, 500)
    assert.equal(error.code, 'editor_request_failed')
    assert.equal(error.message, 'request failed: 500')
    return true
  })
})

test('Build allocates generations before fetch and adopts only the newest out-of-order result', async () => {
  const requestA = deferred()
  const requestB = deferred()
  const calls = []
  const updates = []
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview(payload, options) {
      calls.push({ payload, options })
      return payload.label === 'A' ? requestA.promise : requestB.promise
    },
    acceptPreview: async () => ({}),
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(repairSelection())

  const buildA = lifecycle.build({ label: 'A' })
  const buildB = lifecycle.build({ label: 'B' })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].options.signal.aborted, true)
  assert.equal(calls[1].options.signal.aborted, false)
  requestB.resolve({ id: 'job_b', status: 'done' })
  assert.deepEqual(await buildB, { id: 'job_b', status: 'done' })
  requestA.resolve({ id: 'job_a', status: 'done' })
  assert.equal(await buildA, null)
  assert.deepEqual(
    updates.filter((event) => event.type === 'preview_created').map((event) => event.preview.id),
    ['job_b'],
  )
  assert.equal(updates.find((event) => event.type === 'preview_created').buildGeneration, 3)
})

test('an old Build rejection after a newer Build cannot enter the active error state', async () => {
  const requestA = deferred()
  const requestB = deferred()
  const updates = []
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: ({ label }) => label === 'A' ? requestA.promise : requestB.promise,
    acceptPreview: async () => ({}),
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(repairSelection())

  const buildA = lifecycle.build({ label: 'A' })
  const buildB = lifecycle.build({ label: 'B' })
  requestB.resolve({ id: 'job_b', status: 'done' })
  await buildB
  requestA.reject(Object.assign(new Error('old request failed late'), { code: 'network_failed' }))

  assert.equal(await buildA, null)
  assert.deepEqual(
    updates.filter((event) => event.type === 'error'),
    [],
  )
})

test('selection switches guard initial Build, in-flight poll, and artifact adoption boundaries', async () => {
  const initial = deferred()
  const updates = []
  const timers = createTimerHarness()
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: () => initial.promise,
    acceptPreview: async () => ({}),
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  const selectionA = repairSelection()
  const tokenA = lifecycle.setSelection(selectionA)
  const build = lifecycle.build({ label: 'A' })
  const captureA = lifecycle.capture()
  assert.equal(lifecycle.isCurrentBuild(captureA.token, captureA.buildGeneration, selectionA), true)
  const image = deferred()
  const imageUpdates = []
  const guardedImage = image.promise.then(
    (value) => {
      if (lifecycle.isCurrentBuild(captureA.token, captureA.buildGeneration, selectionA)) imageUpdates.push(value)
    },
    (error) => {
      if (lifecycle.isCurrentBuild(captureA.token, captureA.buildGeneration, selectionA)) imageUpdates.push(error)
    },
  )

  lifecycle.setSelection(repairSelection({ projectId: 'project_other' }))
  initial.resolve({ id: 'job_a', status: 'queued' })

  assert.equal(await build, null)
  assert.equal(lifecycle.isCurrent(tokenA, selectionA), false)
  assert.equal(lifecycle.isCurrentBuild(captureA.token, captureA.buildGeneration, selectionA), false)
  assert.equal(timers.size, 0)
  assert.deepEqual(updates.filter((event) => event.type === 'preview_created'), [])

  image.reject(new Error('old image load failed'))
  await guardedImage
  assert.deepEqual(imageUpdates, [])
})

test('an in-flight poll is abortable and cannot report into a switched selection', async () => {
  const pollResult = deferred()
  const timers = createTimerHarness()
  const updates = []
  let pollOptions
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({ id: 'job_a', status: 'queued' }),
    acceptPreview: async () => ({}),
    fetchJob(_jobId, options) {
      pollOptions = options
      return pollResult.promise
    },
    hashDraft: async () => '',
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(repairSelection())
  const build = lifecycle.build({ label: 'A' })
  await flushMicrotasks()
  timers.runNext()
  await flushMicrotasks()

  lifecycle.setSelection(repairSelection({ assetId: 'asset_other', revisionId: 'rev_other' }))
  assert.equal(pollOptions.signal.aborted, true)
  pollResult.reject(abortError())

  assert.equal(await build, null)
  assert.deepEqual(updates.filter((event) => event.type === 'error'), [])
})

test('only one poll timer is active and stop clears it while aborting Build and poll fetches', async () => {
  const timers = createTimerHarness()
  const pollResult = deferred()
  const buildSignals = []
  let pollSignal
  let buildCount = 0
  const updates = []
  const lifecycle = createRepairPreviewLifecycle({
    async buildPreview(_payload, { signal }) {
      buildSignals.push(signal)
      buildCount += 1
      return { id: `job_${buildCount}`, status: 'queued' }
    },
    acceptPreview: async () => ({}),
    fetchJob(_jobId, { signal }) {
      pollSignal = signal
      return pollResult.promise
    },
    hashDraft: async () => '',
    schedule: timers.schedule,
    cancel: timers.cancel,
    onUpdate: (event) => updates.push(event),
  })
  lifecycle.setSelection(repairSelection())
  const first = lifecycle.build({ build: 1 })
  await flushMicrotasks()
  assert.equal(timers.size, 1)
  const second = lifecycle.build({ build: 2 })
  await flushMicrotasks()
  assert.equal(timers.size, 1)
  assert.equal(timers.maximumPending, 1)
  assert.equal(buildSignals[0].aborted, true)

  timers.runNext()
  await flushMicrotasks()
  lifecycle.stop()
  assert.equal(timers.size, 0)
  assert.equal(buildSignals[1].aborted, true)
  assert.equal(pollSignal.aborted, true)
  pollResult.reject(abortError())
  assert.deepEqual(await first, { id: 'job_1', status: 'queued' })
  assert.equal(await second, null)
  assert.deepEqual(updates.filter((event) => event.type === 'error'), [])
})

test('polling restores a missing job id and retains exact terminal reason and retry hint', async (t) => {
  for (const terminal of [
    { status: 'failed_model_error', reason: 'model unavailable', retry_hint: 'retry later' },
    { status: 'failed_safety_filter', reason: 'safety policy blocked output', retry_hint: null },
    { status: 'not_found' },
    { status: 'failed_post_processing', reason: 'quality gate failed', retry_hint: 'edit the Recipe' },
  ]) {
    await t.test(terminal.status, async () => {
      const timers = createTimerHarness()
      const updates = []
      let requestedJobId
      let pollSignal
      const lifecycle = createRepairPreviewLifecycle({
        buildPreview: async () => ({ id: 'job_preview', status: 'queued' }),
        acceptPreview: async () => ({}),
        fetchJob(jobId, { signal }) {
          requestedJobId = jobId
          pollSignal = signal
          return structuredClone(terminal)
        },
        hashDraft: async () => '',
        schedule: timers.schedule,
        cancel: timers.cancel,
        onUpdate: (event) => updates.push(event),
      })
      lifecycle.setSelection(repairSelection())
      const build = lifecycle.build({})
      await flushMicrotasks()
      timers.runNext()
      await build

      const event = updates.find((entry) => entry.type === 'job')
      assert.equal(requestedJobId, 'job_preview')
      assert.equal(pollSignal.aborted, false)
      assert.equal(event.job.id, 'job_preview')
      assert.equal(event.job.status, terminal.status)
      assert.equal(event.job.reason, terminal.reason ?? null)
      assert.equal(event.job.retry_hint, terminal.retry_hint ?? null)
      assert.deepEqual(updates.filter((entry) => entry.type === 'error'), [])
    })
  }
})

test('draft hash generations adopt only the latest digest and invalid edits invalidate old hashes', async () => {
  const hashA = deferred()
  const hashB = deferred()
  const updates = []
  let currentDraftSettingsHash = 'opening-hash'
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview: async () => ({}),
    fetchJob: async () => ({}),
    hashDraft: (bytes) => bytes === 'A' ? hashA.promise : hashB.promise,
    onUpdate(event) {
      updates.push(event)
      if (event.type === 'draft_optimistically_stale') currentDraftSettingsHash = event.currentDraftSettingsHash
      if (event.type === 'draft_hash') currentDraftSettingsHash = event.hash
    },
  })
  lifecycle.setSelection(repairSelection())
  const generationA = lifecycle.invalidateDraft()
  const digestA = lifecycle.digestDraft('A', { generation: generationA })
  const generationB = lifecycle.invalidateDraft()
  const digestB = lifecycle.digestDraft('B', { generation: generationB })

  assert.equal(currentDraftSettingsHash, null)
  hashB.resolve('hash-b')
  assert.equal(await digestB, 'hash-b')
  hashA.resolve('hash-a')
  assert.equal(await digestA, null)
  assert.equal(currentDraftSettingsHash, 'hash-b')
  assert.deepEqual(updates.filter((event) => event.type === 'draft_hash').map((event) => event.hash), ['hash-b'])

  const oldValidHash = deferred()
  const lifecycleAfterInvalidEdit = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview: async () => ({}),
    fetchJob: async () => ({}),
    hashDraft: () => oldValidHash.promise,
    onUpdate: (event) => updates.push(event),
  })
  lifecycleAfterInvalidEdit.setSelection(repairSelection())
  const validGeneration = lifecycleAfterInvalidEdit.invalidateDraft()
  const oldDigest = lifecycleAfterInvalidEdit.digestDraft('valid', { generation: validGeneration })
  lifecycleAfterInvalidEdit.invalidateDraft()
  oldValidHash.resolve('old-valid-hash')
  assert.equal(await oldDigest, null)
  assert.equal(updates.some((event) => event.type === 'draft_hash' && event.hash === 'old-valid-hash'), false)
})

function acceptPayload(overrides = {}) {
  return {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    jobId: 'job_preview',
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    expectedRecipeHash: RECIPE_HASH,
    warningConfirmed: true,
    ...overrides,
  }
}

test('Accept starts synchronously, snapshots warning confirmation, and deduplicates one exact operation', async () => {
  const accepted = deferred()
  const posts = []
  const updates = []
  let warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  let acceptInFlight = false
  let projectAcceptedCalls = 0
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview(payload, options) {
      posts.push({ payload, options })
      return accepted.promise
    },
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onInvalidate: () => { warningConfirmation = null },
    onUpdate(event) {
      updates.push(event)
      if (event.type === 'accept_started') acceptInFlight = true
      if (event.type === 'accepted') {
        acceptInFlight = false
        projectAcceptedCalls += 1
      }
    },
  })
  lifecycle.setSelection(repairSelection())
  warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  const payload = acceptPayload()

  const first = lifecycle.accept(payload)
  assert.equal(acceptInFlight, true)
  assert.equal(warningConfirmation, null)
  const sameOperation = lifecycle.accept({ ...payload })
  assert.equal(sameOperation, first)
  payload.warningConfirmed = false
  const panelHandler = () => acceptInFlight ? null : lifecycle.accept(payload)
  assert.equal(panelHandler(), null)
  await flushMicrotasks()

  assert.equal(posts.length, 1)
  assert.equal(posts[0].payload.warningConfirmed, true)
  assert.equal(posts[0].options, undefined)
  accepted.resolve({ project: { id: 'project_demo', revision: 5 } })
  assert.deepEqual(await first, { project: { id: 'project_demo', revision: 5 } })
  assert.equal(projectAcceptedCalls, 1)
  assert.equal(updates.filter((event) => event.type === 'accept_started').length, 1)
})

test('Accept dedupe covers the complete selection and payload and deletes settled entries', async () => {
  const operations = []
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview(payload) {
      const operation = deferred()
      operations.push({ payload, operation })
      return operation.promise
    },
    fetchJob: async () => ({}),
    hashDraft: async () => '',
  })
  lifecycle.setSelection(repairSelection())

  const base = lifecycle.accept(acceptPayload())
  const warningChanged = lifecycle.accept(acceptPayload({ warningConfirmed: false }))
  const revisionChanged = lifecycle.accept(acceptPayload({ expectedRevision: 5 }))
  const assetRevisionChanged = lifecycle.accept(acceptPayload({ expectedAssetRevisionId: 'rev_004' }))
  assert.notEqual(base, warningChanged)
  assert.notEqual(base, revisionChanged)
  assert.notEqual(base, assetRevisionChanged)
  await flushMicrotasks()
  assert.equal(operations.length, 4)

  operations[3].operation.resolve({ accepted: 'asset-revision' })
  operations[2].operation.resolve({ accepted: 'revision' })
  operations[1].operation.resolve({ accepted: 'warning' })
  operations[0].operation.resolve({ accepted: 'base' })
  await Promise.all([base, warningChanged, revisionChanged, assetRevisionChanged])
  await flushMicrotasks()

  const retried = lifecycle.accept(acceptPayload())
  assert.notEqual(retried, base)
  await flushMicrotasks()
  assert.equal(operations.length, 5)
  operations[4].operation.resolve({ accepted: 'retry' })
  await retried
})

test('late Accept success and failures stay scoped and classify only uncertain outcomes as unknown', async () => {
  const acceptOperations = []
  const late = []
  const updates = []
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview() {
      const operation = deferred()
      acceptOperations.push(operation)
      return operation.promise
    },
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onUpdate: (event) => updates.push(event),
    onLateAccept: (event) => late.push(event),
  })

  const selectionA = repairSelection()
  lifecycle.setSelection(selectionA)
  const acceptedA = lifecycle.accept(acceptPayload())
  await flushMicrotasks()
  lifecycle.setSelection(repairSelection({ projectId: 'project_b', projectRevision: 1 }))
  acceptOperations[0].resolve({ project: { id: 'project_demo', revision: 5 } })
  assert.equal(await acceptedA, null)
  assert.equal(late[0].outcomeUnknown, false)
  assert.deepEqual(late[0].selection, selectionA)
  assert.equal(late[0].result.project.id, 'project_demo')

  const selectionC = repairSelection({ projectId: 'project_c', projectRevision: 2 })
  lifecycle.setSelection(selectionC)
  const controlledFailure = lifecycle.accept(acceptPayload({ projectId: 'project_c', expectedRevision: 2 }))
  await flushMicrotasks()
  lifecycle.setSelection(repairSelection({ projectId: 'project_d', projectRevision: 1 }))
  acceptOperations[1].reject(Object.assign(new Error('revision changed'), {
    name: 'EditorApiError',
    status: 409,
    code: 'revision_conflict',
  }))
  assert.equal(await controlledFailure, null)
  assert.equal(late[1].outcomeUnknown, false)
  assert.equal(late[1].error.code, 'revision_conflict')

  const selectionE = repairSelection({ projectId: 'project_e', projectRevision: 3 })
  lifecycle.setSelection(selectionE)
  const networkFailure = lifecycle.accept(acceptPayload({ projectId: 'project_e', expectedRevision: 3 }))
  await flushMicrotasks()
  lifecycle.stop()
  acceptOperations[2].reject(new TypeError('connection reset'))
  assert.equal(await networkFailure, null)
  assert.equal(late[2].outcomeUnknown, true)
  assert.deepEqual(late[2].selection, selectionE)
  assert.equal(late[2].error.message, 'connection reset')
  assert.equal(updates.some((event) => event.type === 'accepted'), false)
})

test('an active Accept network failure announces an unknown outcome while controlled failure stays local', async () => {
  const operations = []
  const late = []
  const updates = []
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({}),
    acceptPreview() {
      const operation = deferred()
      operations.push(operation)
      return operation.promise
    },
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onUpdate: (event) => updates.push(event),
    onLateAccept: (event) => late.push(event),
  })
  lifecycle.setSelection(repairSelection())

  const networkFailure = lifecycle.accept(acceptPayload())
  await flushMicrotasks()
  operations[0].reject(new TypeError('network disconnected after request'))
  assert.equal(await networkFailure, null)
  assert.equal(late.length, 1)
  assert.equal(late[0].outcomeUnknown, true)
  assert.equal(updates.at(-1).type, 'error')
  assert.equal(updates.at(-1).phase, 'accept')

  const controlledFailure = lifecycle.accept(acceptPayload({ expectedRevision: 5 }))
  await flushMicrotasks()
  operations[1].reject(Object.assign(new Error('revision changed'), {
    name: 'EditorApiError',
    status: 409,
    code: 'revision_conflict',
  }))
  assert.equal(await controlledFailure, null)
  assert.equal(late.length, 1)
  assert.equal(updates.at(-1).error.code, 'revision_conflict')
})

test('selection, edit, Build, Accept, and stop synchronously invalidate warning identity', async () => {
  let warningConfirmation = { jobId: 'old', recipeHash: 'a'.repeat(64), confirmed: true }
  const accepted = deferred()
  const lifecycle = createRepairPreviewLifecycle({
    buildPreview: async () => ({ id: 'job_preview', status: 'done' }),
    acceptPreview: () => accepted.promise,
    fetchJob: async () => ({}),
    hashDraft: async () => '',
    onInvalidate: () => { warningConfirmation = null },
  })

  lifecycle.setSelection(repairSelection())
  assert.equal(warningConfirmation, null)
  warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  lifecycle.invalidateDraft()
  assert.equal(warningConfirmation, null)
  warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  await lifecycle.build({})
  assert.equal(warningConfirmation, null)
  warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  const accept = lifecycle.accept(acceptPayload())
  assert.equal(warningConfirmation, null)
  accepted.resolve({ accepted: true })
  await accept
  warningConfirmation = { jobId: 'job_preview', recipeHash: RECIPE_HASH, confirmed: true }
  lifecycle.stop()
  assert.equal(warningConfirmation, null)
})
