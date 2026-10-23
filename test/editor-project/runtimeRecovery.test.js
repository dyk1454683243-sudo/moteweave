import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRuntimeRecords } from '../../src/editor-project/runtimeRecords.js'
import { createImageGeneration } from '../../src/editor-project/imageGeneration.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gametool-recovery-'))
  const scope = { projectId: 'project_a', projectRoot: root, workspaceRoot: root }
  const project = { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {}, assets: {} }
  return { scope, project, records: createRuntimeRecords(), load: async () => ({ project }) }
}
async function finish(service, scope, id) {
  for (let count = 0; count < 100; count++) {
    const job = await service.status(scope, id)
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('local task did not settle')
}
test('image results survive restart/eviction, preserve bytes and do not resubmit', async () => {
  const f = await fixture(); let calls = 0
  const options = { ...f, maxJobs: 2, generate: async () => { calls++; return { bytes: Buffer.from('image'), mimeType: 'image/png', width: 1, height: 1 } } }
  const service = createImageGeneration(options)
  const first = { operation_id: randomUUID(), description: 'first' }
  await service.start(f.scope, first); assert.equal((await finish(service, f.scope, first.operation_id)).status, 'done')
  for (let index = 0; index < 16; index++) {
    const body = { operation_id: randomUUID(), description: String(index) }
    await service.start(f.scope, body); assert.equal((await finish(service, f.scope, body.operation_id)).status, 'done')
  }
  const restarted = createImageGeneration(options)
  assert.equal((await restarted.start(f.scope, first)).status, 'done')
  assert.equal((await restarted.source(f.scope, first.operation_id)).bytes.toString(), 'image')
  assert.equal(calls, 17)
  assert.equal((await restarted.list(f.scope)).jobs.length, 17)
  const unknown = randomUUID()
  await f.records.put(f.scope, 'images', unknown, { version: 1, id: unknown, projectId: f.scope.projectId,
    provider: 'antigravity', model: 'old-exact-model', fingerprint: 'x', status: 'running' })
  assert.equal((await restarted.status(f.scope, unknown)).status, 'unknown')
  assert.equal((await restarted.status(f.scope, unknown)).model, 'old-exact-model')
  assert.equal(calls, 17)
  await f.records.putBytes(f.scope, first.operation_id, Buffer.from('tampered'))
  const corrupt = createImageGeneration(options)
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(corrupt.source(f.scope, first.operation_id), { code: 'image_storage_failed' })
})
test('image index write failure does not call provider or leave an eternal running task', async () => {
  const f = await fixture(); let calls = 0
  const records = { ...f.records, put: async (...args) => { if (args[2] === 'recent') throw new Error('disk full'); return f.records.put(...args) } }
  const service = createImageGeneration({ ...f, records, generate: async () => { calls++ } })
  const body = { operation_id: randomUUID(), description: 'guard' }
  await assert.rejects(service.start(f.scope, body))
  assert.equal((await service.status(f.scope, body.operation_id)).status, 'failed')
  assert.equal((await service.start(f.scope, body)).status, 'failed')
  assert.equal(calls, 0)
})
test('conversation persists, hydrates once under concurrency and replays receipts without native calls', async () => {
  const f = await fixture(); let calls = 0
  const run = async () => { calls++; return { reply: 'saved reply', threadId: 'thread_1', naturalExit: true } }
  const options = { ...f, run }
  const service = createAssistantConversations(options)
  const opened = await service.open(f.scope, { provider: 'grok' })
  const body = { conversation: opened.conversation, operation_id: randomUUID(), message: 'hello', expected_revision: 1, canvas_id: null }
  const reply = await service.send(f.scope, body)
  const restarted = createAssistantConversations(options)
  const [history, replay] = await Promise.all([restarted.history(f.scope, 'grok'), restarted.send(f.scope, body)])
  assert.equal(history.turns[0].reply, 'saved reply')
  assert.deepEqual(replay, reply); assert.equal(calls, 1)
  await restarted.send(f.scope, { ...body, operation_id: randomUUID(), message: 'continue' })
  assert.equal(calls, 2)
  assert.equal((await restarted.history(f.scope, 'grok')).turns.length, 2)
  assert.equal((await restarted.history({ ...f.scope, projectId: 'project_b' }, 'grok')).turns.length, 0)
  const stored = await f.records.get(f.scope, 'conversations', opened.conversation)
  stored.receipts.push([randomUUID(), { fingerprint: 'pending', message: 'unfinished', status: 'pending' }])
  await f.records.put(f.scope, 'conversations', opened.conversation, stored)
  const crashed = createAssistantConversations(options)
  const restored = await crashed.history(f.scope, 'grok')
  assert.equal(restored.blocked, true); assert.equal(restored.turns.at(-1).status, 'unknown')
  await assert.rejects(crashed.send(f.scope, { ...body, operation_id: randomUUID() }), { code: 'assistant_session_interrupted' })
  assert.equal(calls, 2)
  const next = await crashed.open(f.scope, { provider: 'grok' })
  assert.notEqual(next.conversation, opened.conversation)
  assert.ok(await f.records.get(f.scope, 'conversations', opened.conversation))
})
test('definitive native failure remains in history without blocking the next message', async () => {
  const f = await fixture(); let calls = 0
  const service = createAssistantConversations({ ...f, run: async () => {
    if (++calls === 1) throw Object.assign(new Error(), { code: 'assistant_response_failed', definitive: true })
    return { reply: 'next works', threadId: 'thread_1', naturalExit: true }
  } })
  const { conversation } = await service.open(f.scope, { provider: 'grok' })
  const body = { conversation, operation_id: randomUUID(), message: 'hello', expected_revision: 1, canvas_id: null }
  await assert.rejects(service.send(f.scope, body), { assistantBlocked: false })
  assert.equal((await service.send(f.scope, { ...body, operation_id: randomUUID() })).reply, 'next works')
  assert.equal((await service.history(f.scope, 'grok')).turns[0].status, 'failed')
})

test('failed durable reply write retains known output and reports storage failure', async () => {
  const f = await fixture(); let calls = 0, fault = true
  const records = { ...f.records, put: async (...args) => {
    if (fault && args[3].receipts?.some(([, receipt]) => receipt.status === 'done')) {
      fault = false; throw new Error('disk full')
    }
    return f.records.put(...args)
  } }
  const service = createAssistantConversations({ ...f, records, run: async () => {
    calls++; return { reply: 'known result', threadId: 'thread_1', naturalExit: true }
  } })
  const { conversation } = await service.open(f.scope, { provider: 'grok' })
  const body = { conversation, operation_id: randomUUID(), message: 'hello', expected_revision: 1, canvas_id: null }
  await assert.rejects(service.send(f.scope, body), { code: 'assistant_storage_failed', assistantBlocked: true })
  const history = await service.history(f.scope, 'grok')
  assert.equal(history.turns[0].reply, 'known result'); assert.equal(history.blocked, true)
  assert.equal((await f.records.get(f.scope, 'conversations', conversation)).receipts[0][1].result.reply, 'known result')
  assert.equal(calls, 1)
})

test('native pixel diagnostics survive a fresh record reload and replay without another model call', async () => {
  const f = await fixture()
  f.project.revision = 2
  f.project.canvases = { canvas_a: { id: 'canvas_a', document_id: 'doc_a' } }
  f.project.sprite_documents = { doc_a: { working_revision: 1 } }
  const manifest = { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: { locked: false, visible: true } }, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: { sha256: 'abc', w: 64, h: 64 } } } }
  const paint = { type: 'fill-rect', rect: { x: 1, y: 1, w: 2, h: 2 }, color: [9, 8, 7, 255] }
  const source = new Uint8Array(64 * 64 * 4)
  source[7] = 128
  let runs = 0
  const sourceOptions = { ...f, readDocument: async () => ({ manifest }), readBlock: async () => ({ bytes: source }),
    adapters: { astra: async () => { runs++; throw new Error('model') } } }
  const sourceService = createAssistantConversations(sourceOptions)
  const sourceOpened = await sourceService.open(f.scope, { provider: 'astra' })
  const sourceBody = { conversation: sourceOpened.conversation, operation_id: randomUUID(), message: 'Draw a flame',
    expected_revision: 2, canvas_id: 'canvas_a', expected_working_revision: 1, pixel_tools: true }
  await assert.rejects(sourceService.send(f.scope, sourceBody), error => error.diagnostic?.reason === 'source_alpha')
  const sourceRestarted = createAssistantConversations(sourceOptions)
  const sourceHistory = await sourceRestarted.history(f.scope, 'astra')
  assert.equal(sourceHistory.turns[0].diagnostic.reason, 'source_alpha')
  assert.ok(Buffer.byteLength(JSON.stringify(sourceHistory.turns[0].diagnostic)) <= 1024)
  await assert.rejects(sourceRestarted.send(f.scope, sourceBody), error => error.diagnostic?.reason === 'source_alpha')
  assert.equal(runs, 0)
  assert.equal(f.project.revision, 2)

  const clear = new Uint8Array(64 * 64 * 4)
  let toolRuns = 0
  const toolOptions = { ...f, readDocument: async () => ({ manifest: { ...manifest, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: null } } } }),
    readBlock: async () => ({ bytes: clear }),
    adapters: { astra: async ({ pixelTools }) => {
      toolRuns++
      await assert.rejects(pixelTools.call('draw_pixels', { operations: [{ ...paint, color: [9, 8, 7, 128] }] }), error => error.recoverable === true)
      for (let i = 0; i < 3; i++) await pixelTools.call('draw_pixels', { operations: [paint] })
      await pixelTools.call('draw_pixels', null)
      throw new Error('must not complete')
    } } }
  const toolService = createAssistantConversations(toolOptions)
  const toolOpened = await toolService.open(f.scope, { provider: 'astra' })
  const toolBody = { conversation: toolOpened.conversation, operation_id: randomUUID(), message: 'Draw again',
    expected_revision: 2, canvas_id: 'canvas_a', expected_working_revision: 1, pixel_tools: true }
  await assert.rejects(toolService.send(f.scope, toolBody), error => error.code === 'assistant_tool_blocked' && error.diagnostic?.reason === 'budget' && error.diagnostic?.rule === 'batch_limit')
  const toolRestarted = createAssistantConversations(toolOptions)
  const toolHistory = await toolRestarted.history(f.scope, 'astra')
  assert.equal(toolHistory.turns.at(-1).diagnostic.reason, 'budget')
  assert.deepEqual(toolHistory.turns.at(-1).diagnostic.last_argument_rejection, { tool: 'draw_pixels', rule: 'alpha', operation_index: 0,
    field: 'operations[0].color', issue: 'invalid_value', expected: 'rgba' })
  assert.ok(Buffer.byteLength(JSON.stringify(toolHistory.turns.at(-1).diagnostic)) <= 1024)
  await assert.rejects(toolRestarted.send(f.scope, toolBody), error => error.diagnostic?.rule === 'batch_limit'
    && error.diagnostic.last_argument_rejection?.rule === 'alpha')
  assert.equal(toolRuns, 1)
  assert.equal(f.project.revision, 2)

  let fallbackRuns = 0
  const fallbackOptions = { ...toolOptions, adapters: { astra: async ({ pixelTools }) => {
    fallbackRuns++
    await assert.rejects(pixelTools.call('draw_pixels', { operations: [paint, { ...paint, private: 'private-secret' }] }))
    // Response validation/storage/candidate failures can lack an adapter diagnostic.
    throw Object.assign(new Error('private-secret'), { code: 'assistant_response_failed' })
  } } }
  const fallbackService = createAssistantConversations(fallbackOptions)
  const fallbackOpened = await fallbackService.open(f.scope, { provider: 'astra' })
  const fallbackBody = { ...toolBody, conversation: fallbackOpened.conversation, operation_id: randomUUID() }
  const checkFallback = error => {
    assert.equal(error.code, 'assistant_response_failed')
    assert.equal(error.diagnostic.rule, 'internal')
    assert.equal(error.diagnostic.calls, 1)
    assert.equal(error.diagnostic.drawing_batches, 0)
    assert.equal(error.diagnostic.argument_corrections, 1)
    assert.deepEqual(error.diagnostic.last_argument_rejection, { tool: 'draw_pixels', rule: 'argument_shape', operation_index: 1,
      field: 'operations[1]', issue: 'unexpected_field', expected: 'operation_fill-rect' })
    assert.equal(JSON.stringify(error.diagnostic).includes('private-secret'), false)
    assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) <= 1024)
    return true
  }
  await assert.rejects(fallbackService.send(f.scope, fallbackBody), checkFallback)
  const fallbackRestarted = createAssistantConversations(fallbackOptions)
  const fallbackHistory = await fallbackRestarted.history(f.scope, 'astra')
  assert.equal(fallbackHistory.turns.at(-1).diagnostic.last_argument_rejection.operation_index, 1)
  assert.equal(fallbackHistory.turns.at(-1).diagnostic.last_argument_rejection.field, 'operations[1]')
  assert.equal(fallbackHistory.turns.at(-1).diagnostic.last_argument_rejection.expected, 'operation_fill-rect')
  await assert.rejects(fallbackRestarted.send(f.scope, fallbackBody), checkFallback)
  assert.equal(fallbackRuns, 1)
  assert.equal(f.project.revision, 2)
})
test('conversation storage reserve blocks before a provider call, without truncation', async () => {
  const f = await fixture(); let calls = 0
  const service = createAssistantConversations({ ...f, run: async () => { calls++; throw new Error('must not call') } })
  const { conversation } = await service.open(f.scope, { provider: 'grok' })
  const stored = await f.records.get(f.scope, 'conversations', conversation)
  stored.receipts = Array.from({ length: 42 }, () => [randomUUID(), { status: 'done', message: '中'.repeat(4000), result: { reply: '中'.repeat(12000) } }])
  await f.records.put(f.scope, 'conversations', conversation, stored)
  const restarted = createAssistantConversations({ ...f, run: async () => { calls++; throw new Error('must not call') } })
  await assert.rejects(restarted.send(f.scope, { conversation, operation_id: randomUUID(), message: 'next', expected_revision: 1, canvas_id: null }), { code: 'assistant_session_limit' })
  assert.equal(calls, 0)
  assert.equal((await restarted.history(f.scope, 'grok')).turns[0].reply.length, 12000)
})

// DIRECT-ACTIONS r4 (R3): Continue here holds the same boundary as send until its own write ends.
test('Continue-here reconciliation is serialized with send: no send or second resolve races its write, and the next send keeps a durable pending receipt', async () => {
  for (const outcome of ['saved', 'failed']) {
    const f = await fixture()
    let calls = 0, armed = false, held = null, pendingSeen = null, threadSeen = 'unset'
    const records = { ...f.records, put: async (...args) => {
      if (armed && args[1] === 'conversations' && Array.isArray(args[3]?.receipts)) {
        armed = false
        let release
        held = { gate: new Promise(resolve => { release = resolve }), release: () => release() }
        await held.gate
        if (outcome === 'failed') throw new Error('disk full')
      }
      return f.records.put(...args)
    } }
    const options = { ...f, records, run: async input => {
      calls++
      if (calls === 1) threadSeen = input.threadId ?? null
      // The request's pending receipt is on disk before the native call starts.
      const stored = await f.records.get(f.scope, 'conversations', conversation)
      pendingSeen = stored.receipts.find(([, receipt]) => receipt.status === 'pending')?.[1] || null
      return { reply: 'after continue', threadId: 'thread_2', naturalExit: true }
    } }
    const first = createAssistantConversations(options)
    const { conversation } = await first.open(f.scope, { provider: 'grok' })
    const stored = await f.records.get(f.scope, 'conversations', conversation)
    stored.receipts.push([randomUUID(), { fingerprint: 'pending', message: 'stopped turn', status: 'pending' }])
    stored.threadId = 'paused-thread'
    await f.records.put(f.scope, 'conversations', conversation, stored)
    const service = createAssistantConversations(options)
    assert.equal((await service.history(f.scope, 'grok')).blocked, true, `${outcome}: a stopped turn pauses the channel`)
    const body = { conversation, operation_id: randomUUID(), message: 'continue here', expected_revision: 1, canvas_id: null }
    armed = true
    const resolving = service.resolve(f.scope, { provider: 'grok', conversation })
    for (let i = 0; i < 200 && !held; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(held, `${outcome}: the resolve write is in flight`)
    assert.equal((await service.history(f.scope, 'grok')).blocked, true, `${outcome}: no reader sees the channel unpaused before it is on disk`)
    await assert.rejects(service.send(f.scope, body), { code: 'assistant_busy' }, `${outcome}: a send cannot start while Continue here is being written`)
    await assert.rejects(service.resolve(f.scope, { provider: 'grok', conversation }), { code: 'assistant_busy' }, `${outcome}: a second resolve waits too`)
    assert.equal(calls, 0)
    assert.equal((await service.history(f.scope, 'grok')).turns.length, 1, `${outcome}: the refused send left no receipt`)
    held.release()
    if (outcome === 'saved') {
      assert.equal((await resolving).resolved, true)
    } else {
      await assert.rejects(resolving, { code: 'assistant_storage_failed' })
      assert.equal((await service.history(f.scope, 'grok')).blocked, true, 'a failed write rolls the pause back')
      const onDisk = await f.records.get(f.scope, 'conversations', conversation)
      assert.equal(onDisk.blocked, true, 'nothing unpaused reached disk')
      assert.equal(onDisk.receipts[0][1].acknowledged, undefined, 'the stopped turn is not marked acknowledged by a failed write')
      await assert.rejects(service.send(f.scope, body), { code: 'assistant_session_interrupted' })
      assert.equal(calls, 0)
      assert.equal((await service.resolve(f.scope, { provider: 'grok', conversation })).resolved, true, 'a later Continue here succeeds')
    }
    const reply = await service.send(f.scope, body)
    assert.equal(reply.reply, 'after continue')
    assert.equal(calls, 1, `${outcome}: exactly one request starts`)
    assert.equal(pendingSeen?.message, 'continue here', `${outcome}: its pending receipt was durable before the call`)
    const final = await f.records.get(f.scope, 'conversations', conversation)
    assert.equal(final.blocked, false)
    const turns = final.receipts.map(([, receipt]) => receipt)
    assert.deepEqual(turns.map(receipt => receipt.status), ['unknown', 'done'], `${outcome}: the stopped turn stays unknown and is not replayed`)
    assert.equal(turns[0].acknowledged, true)
    assert.equal(turns[1].message, 'continue here')
    assert.equal(threadSeen, null, `${outcome}: the next message starts a fresh native thread`)
    assert.equal((await service.send(f.scope, { ...body, operation_id: randomUUID(), message: 'next' })).reply, 'after continue')
    assert.equal(calls, 2, 'later sends are unaffected')
  }
})
