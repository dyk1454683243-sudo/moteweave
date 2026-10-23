import test from 'node:test'
import assert from 'node:assert/strict'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { handleEditorProjectApi, createEditorArtifactAccessRegistry } from '../../src/editor-project/index.js'
import { createRuntimeRecords } from '../../src/editor-project/runtimeRecords.js'
import { createSubscriptionSheet, verifyOriginalSheetPng, SUBSCRIPTION_SOURCE_SHA256, SUBSCRIPTION_STRUCTURE_SHA256 } from '../../src/editor-project/subscriptionSheet.js'
import { provenanceSourceTypeFromMetadata } from '../../src/editor-project/artifactRegistry.js'

async function png(width, height) {
  return sharp({ create: { width, height, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer()
}

test('subscription sheet preserves native dimensions and requires explicit acceptance, including old size refusals', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'subscription-sheet-'))
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const records = createRuntimeRecords()
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const small = await png(8, 9)
  const sheet = await png(1254, 1254)
  const service = createSubscriptionSheet({ records, generate: async ({ operationId, structure }) => {
    calls += 1
    assert.equal(structure.buffer.length > 0, true)
    const stored = await records.get({ projectId, workspaceRoot, projectRoot }, 'sheets', operationId)
    assert.equal(stored.status, 'running')
    assert.equal(stored.turn_start_requests, null)
    assert.equal(stored.structure.structure_sha256, SUBSCRIPTION_STRUCTURE_SHA256)
    assert.equal(stored.structure.source_sha256, SUBSCRIPTION_SOURCE_SHA256)
    assert.equal(stored.structure.identity_authority, false)
    await gate
    return { bytes: calls === 1 ? small : sheet, turnStartRequests: 1, observedToolCalls: 1, model: 'gpt-image-2', providerCalls: 9 }
  } })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), subscriptionSheet: service,
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async (url, body, headers = {}) => {
    const response = await fetch(base + url, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const parsed = response.headers.get('content-type')?.includes('json') ? await response.json() : null
    return { status: response.status, body: parsed, bytes: parsed ? null : Buffer.from(await response.arrayBuffer()) }
  }
  const created = await json('/api/editor/projects/v1', { operation_id: randomUUID() })
  assert.equal(created.status, 201)
  const projectId = created.body.project.id
  const endpoint = `/api/editor/projects/${projectId}/subscription-sheet-candidates`
  const operationId = randomUUID()
  const request = { operation_id: operationId, expected_revision: created.body.project.revision, description: 'a new ranger' }
  const started = await json(endpoint, request)
  assert.equal(started.status, 202)
  assert.equal(started.body.status, 'running')
  assert.equal(started.body.image_model, null)
  assert.equal(started.body.provider_calls, null)
  assert.equal(calls, 1)
  assert.equal((await json(endpoint, request)).body.status, 'running')
  assert.equal(calls, 1)
  assert.equal((await json(endpoint, { ...request, description: 'different' })).status, 409)
  assert.equal(calls, 1)
  const revived = createSubscriptionSheet({ records, generate: async () => { throw new Error('refresh must not generate') } })
  const revivedServer = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), subscriptionSheet: revived,
  }))
  await new Promise(resolve => revivedServer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => revivedServer.close(resolve)))
  const revivedBase = `http://127.0.0.1:${revivedServer.address().port}`
  const revivedStatus = await fetch(`${revivedBase}${endpoint}/${operationId}`)
  const revivedBody = await revivedStatus.json()
  assert.equal(revivedStatus.status, 200)
  assert.equal(revivedBody.status, 'unknown')
  assert.equal(revivedBody.provider_calls, null)
  release()
  let settled
  for (let i = 0; i < 20; i += 1) {
    settled = await json(`${endpoint}/${operationId}`)
    if (settled.body.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(settled.body.status, 'rejected_size')
  assert.equal(settled.body.original.width, 8)
  assert.notEqual(settled.body.original.sha256, createHash('sha256').update(sheet).digest('hex'))
  const rejected = await json(`${endpoint}/${operationId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: settled.body.original.sha256 })
  assert.equal(rejected.status, 422)
  const original = await fetch(`${base}${endpoint}/${operationId}/original`)
  assert.equal(original.headers.get('content-type'), 'image/png')
  assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'), settled.body.original.sha256)
  await new Promise(resolve => setTimeout(resolve, 50))

  const readyId = randomUUID()
  const ready = await json(endpoint, { operation_id: readyId, expected_revision: created.body.project.revision, description: 'a ready ranger' })
  assert.equal(ready.status, 202)
  let done
  for (let i = 0; i < 20; i += 1) {
    done = await json(`${endpoint}/${readyId}`)
    if (done.body.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(done.body.status, 'ready')
  assert.equal(done.body.original.width, 1254)
  assert.equal(done.body.original.height, 1254)
  assert.equal(done.body.original.sha256, createHash('sha256').update(sheet).digest('hex'))
  assert.equal(done.body.reviewable_original, true)
  assert.equal(done.body.accepted, false)
  assert.equal(done.body.image_model, null)
  assert.equal(done.body.provider_calls, null)
  assert.equal(done.body.turn_start_requests, 1)
  assert.equal(done.body.observed_tool_calls, 1)
  assert.equal(done.body.orchestrator_model, 'gpt-6.1-sol')
  const scope = { projectId, workspaceRoot, projectRoot }
  const legacyId = randomUUID()
  const legacy = { ...(await records.get(scope, 'sheets', readyId)), id: legacyId, status: 'rejected_size', reason: 'subscription_sheet_rejected_size' }
  await records.put(scope, 'sheets', legacyId, legacy)
  await records.putGroupBytes(scope, 'sheets', legacyId, sheet)
  const oldBefore = await revived.status(scope, legacyId)
  assert.equal(oldBefore.status, 'rejected_size')
  assert.equal(oldBefore.reviewable_original, true)
  assert.equal(oldBefore.accepted, false)
  assert.equal(oldBefore.process_attempted, false)
  assert.equal((await records.get(scope, 'sheets', legacyId)).status, 'rejected_size')
  await assert.rejects(() => revived.accept(scope, legacyId, { confirm_manual_acceptance: false, expected_original_sha256: oldBefore.original.sha256 }), { code: 'invalid_subscription_sheet_request' })
  await assert.rejects(() => revived.accept(scope, legacyId, { confirm_manual_acceptance: true, expected_original_sha256: 'a'.repeat(64) }), { code: 'subscription_sheet_sha256_mismatch' })
  const oldAccepted = await revived.accept(scope, legacyId, { confirm_manual_acceptance: true, expected_original_sha256: oldBefore.original.sha256 })
  assert.equal(oldAccepted.status, 'accepted')
  assert.equal(oldAccepted.reason, null)
  assert.equal((await records.get(scope, 'sheets', legacyId)).previous_rejection.status, 'rejected_size')
  assert.deepEqual((await revived.original(scope, legacyId)).bytes, sheet)

  const corruptId = randomUUID()
  const corrupt = sheet.subarray(0, 40)
  const corruptSha = createHash('sha256').update(corrupt).digest('hex')
  await records.put(scope, 'sheets', corruptId, { ...legacy, id: corruptId, original: { ...legacy.original, sha256: corruptSha } })
  await records.putGroupBytes(scope, 'sheets', corruptId, corrupt)
  await assert.rejects(() => revived.accept(scope, corruptId, { confirm_manual_acceptance: true, expected_original_sha256: corruptSha }), { code: 'subscription_sheet_unsupported' })
  assert.equal((await revived.status(scope, corruptId)).status, 'rejected_size')
  assert.equal((await revived.status(scope, corruptId)).accepted, false)
  const mismatch = await json(`${endpoint}/${readyId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: 'a'.repeat(64) })
  assert.equal(mismatch.status, 409)
  const badBasis = await json(`${endpoint}/${readyId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: done.body.original.sha256, acceptance_basis: 'looked_at_it' })
  assert.equal(badBasis.status, 400, 'only the defined acceptance bases are accepted')
  const accepted = await json(`${endpoint}/${readyId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: done.body.original.sha256, acceptance_basis: 'user_request' })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.accepted, true)
  assert.equal(accepted.body.acceptance_basis, 'user_request', 'a request-based acceptance is recorded as such')
  const acceptedAgain = await json(`${endpoint}/${readyId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: done.body.original.sha256, acceptance_basis: 'visual_inspection' })
  assert.equal(acceptedAgain.body.acceptance_basis, 'user_request', 'an accepted original keeps the basis it was accepted with')
  assert.equal(Object.hasOwn(oldAccepted, 'acceptance_basis'), false, 'a request without a basis records none')
  assert.equal(accepted.body.process_sheet.options.subjectCountGate, true)
  assert.equal(accepted.body.process_sheet.options.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(accepted.body.process_sheet.options.backgroundMode, 'already_processed')
  assert.equal(accepted.body.process_sheet.options.backgroundRequestMode, 'deterministic_pixel_matte_v2')
  assert.equal(accepted.body.process_sheet.options.source.type, 'subscription_sheet')
  assert.equal(accepted.body.process_sheet.options.generation.model, null)
  assert.equal(provenanceSourceTypeFromMetadata({ source: accepted.body.process_sheet.options.source, generation: accepted.body.process_sheet.options.generation }), 'subscription_sheet')
  assert.notEqual(Buffer.from(accepted.body.process_sheet.source_base64, 'base64').length, sheet.length)
  assert.equal(calls, 2)
  assert.equal(accepted.body.process_sheet.options.source.candidate_id, readyId)
  assert.equal(accepted.body.process_sheet.options.generation.image_model, null)
  assert.equal(accepted.body.process_sheet.options.generation.provider_calls, null)

  // A non-uniform opaque fixture must remain blocked after the matte requests review,
  // including a cold service restart. It is not a subscription-generated image.
  const reviewId = randomUUID()
  const pixels = Buffer.alloc(16 * 16 * 4)
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const offset = (y * 16 + x) * 4
    pixels.set([x * 16, y * 16, 128, 255], offset)
  }
  const reviewPng = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer()
  const reviewSha = createHash('sha256').update(reviewPng).digest('hex')
  await records.put(scope, 'sheets', reviewId, { ...legacy, id: reviewId, status: 'ready', reason: null,
    original: { sha256: reviewSha, width: 16, height: 16 } })
  await records.putGroupBytes(scope, 'sheets', reviewId, reviewPng)
  const reviewBody = { confirm_manual_acceptance: true, expected_original_sha256: reviewSha }
  await assert.rejects(() => revived.accept(scope, reviewId, reviewBody), { code: 'subscription_sheet_background_review_required' })
  const cold = createSubscriptionSheet({ records, generate: async () => { throw new Error('must not regenerate') } })
  const reviewState = await cold.status(scope, reviewId)
  assert.equal(reviewState.accepted, true)
  assert.equal(reviewState.background_review_required, true)
  assert.equal(reviewState.process_attempted, false)
  await assert.rejects(() => cold.accept(scope, reviewId, reviewBody), { code: 'subscription_sheet_background_review_required' })
  await assert.rejects(() => cold.bindProcessing(scope, reviewId, { process_attempted: true }), { code: 'subscription_sheet_background_review_required' })
  assert.deepEqual((await cold.original(scope, reviewId)).bytes, reviewPng)
  assert.equal(calls, 2)
})

test('subscription storage failure and larger native original do not regenerate or pretend accepted', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'subscription-sheet-fail-'))
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const records = createRuntimeRecords()
  const realPut = records.put.bind(records)
  let failPut = false
  records.put = async (...args) => { if (failPut) throw new Error('disk'); return realPut(...args) }
  let calls = 0
  const service = createSubscriptionSheet({ records, generate: async () => {
    calls += 1
    const error = new Error('read failed')
    error.nativeAttempt = { executed: true, threadId: '11111111-1111-4111-8111-111111111111', imageCallId: 'call-1', turnStartRequests: 1, observedToolCalls: 1 }
    throw error
  } })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), subscriptionSheet: service,
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const created = await json('/api/editor/projects/v1', { operation_id: randomUUID() })
  const projectId = created.body.project.id
  const endpoint = `/api/editor/projects/${projectId}/subscription-sheet-candidates`
  failPut = true
  const blocked = await json(endpoint, { operation_id: randomUUID(), expected_revision: created.body.project.revision, description: 'blocked' })
  assert.equal(blocked.status, 500)
  assert.equal(calls, 0)
  failPut = false
  const operationId = randomUUID()
  const started = await json(endpoint, { operation_id: operationId, expected_revision: created.body.project.revision, description: 'read failed' })
  assert.equal(started.status, 202)
  let settled
  for (let i = 0; i < 20; i += 1) {
    settled = await json(`${endpoint}/${operationId}`)
    if (settled.body.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(settled.body.status, 'unknown')
  assert.equal(settled.body.turn_start_requests, 1)
  assert.equal(settled.body.observed_tool_calls, 1)
  assert.equal(settled.body.native_thread_id, '11111111-1111-4111-8111-111111111111')
  assert.equal(settled.body.image_model, null)
  assert.equal(settled.body.provider_calls, null)
  assert.equal((await json(endpoint, { operation_id: operationId, expected_revision: created.body.project.revision, description: 'read failed' })).body.status, 'unknown')
  assert.equal(calls, 1)

  const wide = createSubscriptionSheet({ records, generate: async () => ({ bytes: await png(2300, 2300), turnStartRequests: 1, observedToolCalls: 1, threadId: 'wide', imageCallId: 'wide' }) })
  const wideServer = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), subscriptionSheet: wide,
  }))
  await new Promise(resolve => wideServer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => wideServer.close(resolve)))
  const wideBase = `http://127.0.0.1:${wideServer.address().port}`
  const wideJson = async (url, body) => {
    const response = await fetch(wideBase + url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const wideId = randomUUID()
  await wideJson(endpoint, { operation_id: wideId, expected_revision: created.body.project.revision, description: 'larger native original' })
  let wideSettled
  for (let i = 0; i < 20; i += 1) {
    wideSettled = await wideJson(`${endpoint}/${wideId}`)
    if (wideSettled.body.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(wideSettled.body.status, 'ready')
  assert.equal(wideSettled.body.original.width, 2300)
  assert.equal(wideSettled.body.accepted, false)
  assert.equal(wideSettled.body.process_attempted, false)
  const wideBytes = Buffer.from(await (await fetch(`${wideBase}${endpoint}/${wideId}/original`)).arrayBuffer())
  assert.equal(createHash('sha256').update(wideBytes).digest('hex'), wideSettled.body.original.sha256)
})

test('native-size policy retains PNG decoding, square layout, byte and per-edge safety limits', async () => {
  const original = await png(4096, 4096)
  const verified = await verifyOriginalSheetPng(original)
  assert.equal(verified.bytes, original)
  assert.equal(verified.width, 4096)
  await assert.rejects(() => verifyOriginalSheetPng(Buffer.from('not a PNG')), { code: 'subscription_sheet_unsupported' })
  for (const [width, height] of [[4097, 1], [1, 4097], [1254, 1000]]) {
    const bytes = await png(width, height)
    await assert.rejects(() => verifyOriginalSheetPng(bytes), { code: 'subscription_sheet_rejected_size' })
  }
  await assert.rejects(() => verifyOriginalSheetPng(Buffer.alloc(8 * 1024 * 1024 + 1)), { code: 'subscription_sheet_unsupported' })
  await assert.rejects(() => verifyOriginalSheetPng(original.subarray(0, 40)), { code: 'subscription_sheet_unsupported' })
})

test('subscription derived bytes stay in the side file and a second processing claim does not acquire', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'subscription-sheet-restart-'))
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const records = createRuntimeRecords()
  const sheet = await png(2048, 2048)
  const service = createSubscriptionSheet({ records, generate: async () => ({ bytes: sheet, turnStartRequests: 1, observedToolCalls: 1 }) })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), subscriptionSheet: service,
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const created = await json('/api/editor/projects/v1', { operation_id: randomUUID() })
  const projectId = created.body.project.id
  const scope = { projectId, projectRoot, workspaceRoot }
  const endpoint = `/api/editor/projects/${projectId}/subscription-sheet-candidates`
  const operationId = randomUUID()
  await json(endpoint, { operation_id: operationId, expected_revision: created.body.project.revision, description: 'restart' })
  let ready
  for (let i = 0; i < 20; i += 1) {
    ready = await json(`${endpoint}/${operationId}`)
    if (ready.body.status === 'ready') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const accepted = await json(`${endpoint}/${operationId}/accept`, { confirm_manual_acceptance: true, expected_original_sha256: ready.body.original.sha256 })
  assert.equal(accepted.status, 200)
  const stored = await records.get(scope, 'sheets', operationId)
  assert.equal(stored.derivedBytes, undefined)
  assert.equal(stored.structureBuffer, undefined)
  const side = await records.getGroupBytes(scope, 'sheets', `${operationId}-derived`)
  assert.equal(createHash('sha256').update(side).digest('hex'), stored.derived.sha256)
  const restarted = createSubscriptionSheet({ records, generate: async () => { throw new Error('restart must not generate') } })
  const again = await restarted.accept(scope, operationId, { confirm_manual_acceptance: true, expected_original_sha256: ready.body.original.sha256 })
  assert.equal(again.process_sheet.source_base64, side.toString('base64'))
  const cold = createSubscriptionSheet({ records, generate: async () => { throw new Error('no regeneration') } })
  const claims = await Promise.all([
    cold.bindProcessing(scope, operationId, { process_attempted: true }),
    cold.start(scope, { operation_id: operationId, expected_revision: created.body.project.revision, description: 'restart' }),
    cold.bindProcessing(scope, operationId, { process_attempted: true }),
  ])
  assert.deepEqual([claims[0].processing_acquired, claims[2].processing_acquired], [true, false])
  assert.equal(claims[1].process_attempted, true)
  await cold.bindProcessing(scope, operationId, { process_job_id: 'job_restart' })
  const addedBody = { operation_id: randomUUID(), document_id: 'doc_restart', project_revision: 2 }
  const originalPut = records.put.bind(records)
  let releaseWrite, signalWrite
  const writeStarted = new Promise(resolve => { signalWrite = resolve })
  const writeReleased = new Promise(resolve => { releaseWrite = resolve })
  records.put = async (...args) => {
    if (args[3]?.added) { signalWrite(); await writeReleased; throw new Error('disk') }
    return originalPut(...args)
  }
  let duplicateSettled = false
  const first = cold.recordAdded(scope, operationId, addedBody)
  const second = cold.recordAdded(scope, operationId, addedBody)
  second.then(() => { duplicateSettled = true }, () => { duplicateSettled = true })
  const outcomes = Promise.allSettled([first, second])
  await writeStarted
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(duplicateSettled, false)
  releaseWrite()
  assert.deepEqual((await outcomes).map(result => result.status), ['rejected', 'rejected'])
  assert.equal(Boolean((await records.get(scope, 'sheets', operationId)).added), false)
  records.put = originalPut
  const recorded = await cold.recordAdded(scope, operationId, addedBody)
  assert.equal(recorded.reload_pending, true)
  assert.equal(recorded.added.document_id, 'doc_restart')
})
