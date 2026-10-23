import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { SERVICE_UNAVAILABLE_TOAST, assistantErrorCopy, createVnextAssistantClient, nativeCandidateRestoreBlock } from '../../src/ui/vnext/vnext-assistant-client.js'

const json = (body, status = 200) => ({ ok: status === 200, json: async () => body })

test('Astra client accepts verified native pixels, rejects tampering and never sends pixel bytes to the provider route', async () => {
  for (const tamper of [false, true]) {
    const bytes = Buffer.alloc(64 * 64 * 4), hash = createHash('sha256').update(bytes).digest('hex')
    const f = fixture(body => json({ reply: 'Ready', provider: 'astra', requestedModel: 'gpt-6-astra', completed: true, termination: 'managed',
      context: { project_id: 'project_a', project_revision: 1, canvas_id: 'canvas_a', working_revision: 2, width: 64, height: 64, pixel_tools: true },
      pixel_candidate: { width: 64, height: 64, rgba_hex: bytes.toString('hex'), source_sha256: hash,
        sha256: tamper ? 'a'.repeat(64) : hash, drawing_batches: 1, tool_calls: 2 } }))
    f.client.select('astra')
    const pending = f.client.send({ message: 'draw', revision: 1, canvasId: 'canvas_a', workingRevision: 2, width: 64, height: 64, pixelTools: true })
    if (tamper) await assert.rejects(pending, { code: 'assistant_response_failed' })
    else assert.deepEqual((await pending).pixelCandidateBytes, new Uint8Array(bytes))
    assert.equal(f.calls[1].body.pixel_tools, true)
    assert.equal(JSON.stringify(f.calls[1].body).includes('rgba_hex'), false)
    assert.equal(f.calls.length, 2)
  }
})

test('tool rejection does not advise checking login or quota', () => {
  const blocked = assistantErrorCopy('assistant_tool_blocked', 'astra')
  assert.equal(blocked.includes('login'), false)
  assert.equal(blocked.includes('quota'), false)
  assert.match(assistantErrorCopy('assistant_tool_blocked', 'astra', { reason: 'budget' }), /tool limit/)
  assert.match(assistantErrorCopy('assistant_context_changed', 'astra', { reason: 'source_alpha' }), /transparency/)
  assert.match(assistantErrorCopy('assistant_login_required', 'astra', { reason: 'authorization' }), /native login/)
  const versionCopy = assistantErrorCopy('assistant_version_unverified', 'astra', { reason: 'authorization', rule: 'internal' })
  assert.match(versionCopy, /CLI version is not verified/)
  assert.doesNotMatch(versionCopy, /That tool call was not authorized/)
  const configCopy = assistantErrorCopy('assistant_configuration_changed', 'astra', { reason: 'authorization', rule: 'internal' })
  assert.match(configCopy, /connection settings need attention/)
  assert.doesNotMatch(configCopy, /That tool call was not authorized/)
  const modelCopy = assistantErrorCopy('assistant_model_unavailable', 'astra', { reason: 'authorization', rule: 'internal' })
  assert.match(modelCopy, /is unavailable/)
  assert.doesNotMatch(modelCopy, /That tool call was not authorized/)
  assert.equal(assistantErrorCopy('assistant_protocol_timeout', 'astra', { reason: 'internal', rule: 'internal' }).includes('180 second'), false)
})
test('offline history is identified as a local service failure and never sends or blames model login', async () => {
  let calls = 0, online = false
  const client = createVnextAssistantClient({ fetchImpl: async (url) => {
    calls++
    if (!online) throw Error('Failed to fetch')
    const provider = new URL(url, 'http://local').searchParams.get('provider') || 'grok'
    const model = provider === 'codex' ? 'gpt-6.1-sol' : 'grok-4.7'
    return json({ conversation: `${provider}-native`, discussion: 'shared-1', provider, model, blocked: false, turns: [] })
  } })
  client.bind('project_a')
  await assert.rejects(client.restore(), { code: 'assistant_service_unavailable' })
  assert.equal(client.blocked, true); assert.equal(client.errorCode, 'assistant_service_unavailable')
  assert.equal(client.serviceUnavailable, true)
  client.select('codex')
  assert.equal(client.blocked, true, 'service unavailability applies across model channels while offline')
  assert.equal(client.errorCode, 'assistant_service_unavailable')
  assert.equal(SERVICE_UNAVAILABLE_TOAST.title, 'Local service unavailable')
  assert.equal(SERVICE_UNAVAILABLE_TOAST.body, 'Draft kept. No message sent. Restart the service, then reload.')
  const copy = assistantErrorCopy(client.errorCode)
  assert.match(copy, /local service is unavailable/); assert.match(copy, /No message sent/)
  assert.doesNotMatch(copy, /login|quota|New conversation/)
  assert.equal(calls, 1)
  online = true
  await client.restore()
  assert.equal(client.serviceUnavailable, false)
  assert.equal(client.blocked, false)
})

test('model switch keeps the shared discussion and view; New conversation resets cached native channels', async () => {
  const calls = [], group = 'shared-discussion'
  let fresh = false
  const client = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, body })
    if (body?.fresh) fresh = true
    const provider = body?.provider || new URL(url, 'http://local').searchParams.get('provider')
    const model = { grok: 'grok-4.7', codex: 'gpt-6.1-sol' }[provider]
    return json({ conversation: fresh ? null : `${provider}-native`, discussion: fresh ? 'new-discussion' : group,
      provider, model, blocked: false, turns: [{ provider: 'grok', message: 'same question', reply: 'same answer', status: 'done' }] })
  } })
  client.bind('project_a')
  assert.equal((await client.restore()).preserveView, false)
  client.select('codex')
  const switched = await client.restore()
  assert.equal(switched.discussion, group); assert.equal(switched.preserveView, true)
  assert.equal(switched.turns[0].provider, 'grok')
  await client.restore({ fresh: true }); client.select('grok'); await client.restore()
  assert.ok(calls.at(-1).url.includes('provider=grok&shared=true'))
  assert.deepEqual(calls.find(c => c.body?.fresh).body, { provider: 'codex', model: 'gpt-6.1-sol', shared: true, fresh: true })
})
for (const changedDuring of ['restore', 'open']) test(`discussion changing during ${changedDuring} never pairs old messages with a new discussion`, async () => {
  const requests = []
  let changed = false
  const client = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null; requests.push({ url, body })
    if (url.endsWith('/messages')) return json({ reply: 'Still A', provider: 'grok', requestedModel: 'grok-4.7', completed: true,
      termination: 'natural', context: { project_id: 'project_a', project_revision: 1, canvas_id: null } })
    const provider = body?.provider || new URL(url, 'http://local').searchParams.get('provider')
    return json({ provider, model: provider === 'grok' ? 'grok-4.7' : 'gpt-6.1-sol', discussion: changed ? 'B' : 'A',
      conversation: init.method === 'GET' && provider === 'codex' ? null : `${provider}-native`, turns: [], blocked: false })
  } })
  client.bind('project_a'); await client.restore(); client.select('codex')
  if (changedDuring === 'open') await client.restore()
  changed = true
  await assert.rejects(changedDuring === 'restore' ? client.restore() : client.send({ message: 'keep draft', revision: 1 }), { code: 'assistant_discussion_changed' })
  assert.equal(client.blocked, true); assert.equal(client.errorCode, 'assistant_discussion_changed')
  assert.equal(requests.filter(r => r.url.endsWith('/messages')).length, 0)
  assert.match(assistantErrorCopy(client.errorCode), /Draft kept; reload/)
  client.select('grok'); await client.send({ message: 'Continue known A', revision: 1 })
  assert.equal(requests.at(-1).body.discussion, 'A', 'a rejected restore/open did not change existing channel bindings')
})
test('restore only reads saved text, and read failure requires explicit new discussion', async () => {
  const calls = []
  let failRead = false
  const client = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method })
    if (init.method === 'GET') return failRead ? json({ error: 'assistant_storage_failed' }, 500)
      : json({ conversation: 'saved', provider: 'grok', model: 'grok-4.7', blocked: false,
        turns: [{ message: 'old question', reply: 'old reply', status: 'done' }] })
    return json({ conversation: 'new', provider: 'grok', model: 'grok-4.7' })
  } })
  client.bind('project_a')
  assert.equal((await client.restore()).turns[0].reply, 'old reply')
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET')
  client.bind('project_b'); failRead = true
  await assert.rejects(client.restore())
  await assert.rejects(client.send({ message: 'draft', revision: 1 }))
  assert.equal(calls.length, 2)
  assert.equal(client.blocked, true)
  await client.restore({ fresh: true })
  assert.equal(client.blocked, false)
  assert.equal(calls.at(-1).method, 'POST')
})
function fixture(handler) {
  const calls = []
  const client = createVnextAssistantClient({ operationId: () => 'test-operation', fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body, signal: init.signal })
    if (url.endsWith('/session')) return json({ conversation: `opaque-${body.provider}`, provider: body.provider, model: body.model })
    const provider = body.conversation.slice('opaque-'.length)
    return handler ? handler(body, init.signal) : json({ reply: '你好', provider, completed: true,
      requestedModel: { codex: 'gpt-6.1-sol', grok: 'grok-4.7', antigravity: 'gemini-3.8-flash-low' }[provider],
      termination: provider === 'codex' ? 'managed' : 'natural',
      context: { project_id: 'project_a', project_revision: body.expected_revision, canvas_id: body.canvas_id } })
  } })
  client.bind('project_a')
  return { client, calls }
}

test('the assistant client keeps a complete reply beyond the former 12000-character cap', async () => {
  const reply = '完整回复。'.repeat(4000)
  const f = fixture(body => json({ reply, provider: 'grok', requestedModel: 'grok-4.7', completed: true, termination: 'natural',
    context: { project_id: 'project_a', project_revision: body.expected_revision, canvas_id: body.canvas_id } }))
  assert.equal((await f.client.send({ message: 'hello', revision: 1, canvasId: null })).reply, reply)
})

test('assistant sends bounded text and metadata only; session reused within project', async () => {
  const f = fixture()
  assert.equal((await f.client.send({ message: 'hi', revision: 1, canvasId: 'canvas_a', image: 'never sent' })).reply, '你好')
  await f.client.send({ message: 'next', revision: 2 })
  assert.equal(f.calls.filter(call => call.url.endsWith('/session')).length, 1)
  assert.deepEqual(Object.keys(f.calls[1].body).sort(), ['canvas_id', 'conversation', 'expected_revision', 'message', 'operation_id'])
  assert.equal(JSON.stringify(f.calls).includes('never sent'), false)
})

test('cross-project late result cannot bind old session or reply to new project', async () => {
  let finish
  const f = fixture(() => new Promise(resolve => { finish = resolve }))
  const pending = f.client.send({ message: 'hi', revision: 1 })
  await new Promise(resolve => setImmediate(resolve))
  f.client.bind('project_b')
  finish(json({ reply: 'old', provider: 'grok', naturalExit: true, context: { project_id: 'project_a', project_revision: 1, canvas_id: null } }))
  await assert.rejects(pending, { code: 'assistant_cancelled' })
  assert.equal(f.calls[1].signal.aborted, true); assert.equal(f.client.blocked, false)
})

test('network ambiguity blocks new sends, keeps caller draft and never retries', async () => {
  const f = fixture(async () => { throw new Error('network') })
  await assert.rejects(f.client.send({ message: 'keep draft', revision: 1 }))
  assert.equal(f.client.blocked, true)
  await assert.rejects(f.client.send({ message: 'keep draft', revision: 1 }))
  assert.equal(f.calls.length, 2)
})

test('known preflight failure permits explicit correction; stop blocks resume', async () => {
  const f = fixture(async () => json({ error: 'assistant_context_changed' }, 409))
  await assert.rejects(f.client.send({ message: 'hi', revision: 1 }), { code: 'assistant_context_changed' })
  assert.equal(f.client.blocked, false)
  f.client.stop(); assert.equal(f.client.blocked, true)
})

test('explicit provider selection isolates native sessions and connected status without fallback', async () => {
  const f = fixture()
  assert.equal(f.client.connection, 'not_checked')
  await f.client.send({ message: 'Grok one', revision: 1 })
  assert.equal(f.client.connection, 'connected')
  assert.equal(f.client.select('codex'), true)
  assert.equal(f.client.connection, 'not_checked')
  const gpt = await f.client.send({ message: 'GPT one', revision: 1 })
  assert.equal(gpt.provider, 'codex')
  assert.equal(f.client.select('antigravity'), true)
  assert.equal(f.client.connection, 'not_checked')
  assert.equal((await f.client.send({ message: 'Gemini one', revision: 1 })).provider, 'antigravity')
  assert.equal(f.client.select('grok'), true)
  assert.equal(f.client.connection, 'connected')
  await f.client.send({ message: 'Grok two', revision: 1 })
  assert.equal(f.calls.filter(c => c.url.endsWith('/session')).length, 3)
  assert.deepEqual(f.calls.filter(c => c.url.endsWith('/messages')).map(c => c.body.conversation), ['opaque-grok', 'opaque-codex', 'opaque-antigravity', 'opaque-grok'])
  for (const invalid of ['unknown', '__proto__', ['codex'], null]) assert.equal(f.client.select(invalid), false)
  assert.equal(f.client.provider, 'grok')
})

test('cannot switch while sending or cancelling; failure remains scoped to its provider', async () => {
  let finish
  const f = fixture(() => new Promise(resolve => { finish = resolve }))
  const pending = f.client.send({ message: 'Grok one', revision: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.client.select('codex'), false)
  f.client.stop()
  assert.equal(f.client.select('codex'), false)
  finish(json({ error: 'assistant_cancelled' }, 409))
  await assert.rejects(pending)
  assert.equal(f.client.select('codex'), true)
  assert.equal(f.client.blocked, false); assert.equal(f.client.connection, 'not_checked')
  assert.equal(f.client.select('grok'), true); assert.equal(f.client.blocked, true)
})

test('native candidate restoration rejects another canvas, an unsupported scope, and a saved operation', () => {
  const context = { pixel_tools: true, project_id: 'proj', project_revision: 2, canvas_id: 'canvas-a', document_id: 'doc-a', working_revision: 1 }
  const source = { projectId: 'proj', sourceCanvasId: 'canvas-a', sourceDocumentId: 'doc-a', projectRevision: 2, sourceRevision: 1, width: 64, height: 64 }
  assert.equal(nativeCandidateRestoreBlock({ source, context, operationId: 'op-1', receipts: {} }), null)
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, sourceCanvasId: 'canvas-b', sourceDocumentId: 'doc-b' }, context, operationId: 'op-1', receipts: {} }), 'target')
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, projectRevision: 3 }, context, operationId: 'op-1', receipts: {} }), 'target')
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, multiCel: true }, context, operationId: 'op-1', receipts: {} }), 'scope')
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, allowedRect: { x: 0, y: 0, w: 8, h: 8 } }, context, operationId: 'op-1', receipts: {} }), 'scope')
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, allowedRect: { x: 2, y: 3, w: 4, h: 5 } }, context: { ...context, allowed_rect: { x: 2, y: 3, w: 4, h: 5 } }, operationId: 'op-1', receipts: {} }), null)
  assert.equal(nativeCandidateRestoreBlock({ source: { ...source, allowedRect: { x: 2, y: 3, w: 4, h: 5 } }, context: { ...context, allowed_rect: { x: 2, y: 3, w: 4, h: 6 } }, operationId: 'op-1', receipts: {} }), 'scope')
  assert.equal(nativeCandidateRestoreBlock({ source, context, operationId: 'op-1', receipts: { 'op-1': { document_id: 'copy' } } }), 'saved')
  assert.match(assistantErrorCopy('assistant_tool_blocked', 'astra', { reason: 'unsupported', rule: 'codebook_limit' }), /62 colors/)
  assert.match(assistantErrorCopy('assistant_context_changed', 'astra', { reason: 'context', rule: 'candidate_hash' }), /candidate baseline hash changed/)
})

test('Astra client sends grant_id and allowed_colors and verifies returned allowed_rect', async () => {
  const bytes = Buffer.alloc(64 * 64 * 4), hash = createHash('sha256').update(bytes).digest('hex')
  const rect = { x: 4, y: 6, w: 8, h: 8 }
  const f = fixture(() => json({
    reply: 'Patched region',
    provider: 'astra',
    requestedModel: 'gpt-6-astra',
    completed: true,
    termination: 'managed',
    context: { project_id: 'project_a', project_revision: 1, canvas_id: 'canvas_a', working_revision: 2, width: 64, height: 64, pixel_tools: true, allowed_rect: rect },
    pixel_candidate: { width: 64, height: 64, rgba_hex: bytes.toString('hex'), source_sha256: hash, sha256: hash, drawing_batches: 1, tool_calls: 2, allowed_rect: rect },
  }))
  f.client.select('astra')
  const res = await f.client.send({
    message: 'patch region',
    revision: 1,
    canvasId: 'canvas_a',
    workingRevision: 2,
    width: 64,
    height: 64,
    pixelTools: true,
    grantId: 'grant-123',
    allowedRect: rect,
    allowedColors: [[255, 0, 0, 255]],
  })
  assert.equal(f.calls[1].body.grant_id, 'grant-123')
  assert.deepEqual(f.calls[1].body.allowed_colors, [[255, 0, 0, 255]])
  assert.deepEqual(res.context.allowed_rect, rect)
})

test('wrong supplier or model result cannot become connected', async () => {
  const f = fixture(body => json({ reply: 'bad', provider: 'codex', requestedModel: 'gpt-6.1-sol', completed: true,
    termination: 'managed', context: { project_id: 'project_a', project_revision: body.expected_revision, canvas_id: body.canvas_id } }))
  await assert.rejects(f.client.send({ message: 'hello', revision: 1 }), { code: 'assistant_response_failed' })
  assert.equal(f.client.connection, 'unavailable'); assert.equal(f.client.blocked, true)
  assert.equal(f.calls.length, 2)
})

test('stale project and out-of-order requests cannot lock a newly bound project or clear a newer service-unavailable lock', async () => {
  const pendingGates = []
  const signals = []
  const client = createVnextAssistantClient({
    fetchImpl: async (url, init) => {
      signals.push({ url, signal: init.signal })
      return new Promise((resolve, reject) => {
        pendingGates.push({ url, resolve, reject, signal: init.signal })
      })
    },
  })

  // 1) Old project request failing late after bind('project_b') must not lock project_b.
  client.bind('project_a')
  const candidateA = client.documentCandidate({ action: 'read', candidate_id: 'cand_a' }, 'project_a')
  assert.equal(pendingGates.length, 1)
  client.bind('project_b')
  assert.equal(signals[0].signal.aborted, true, 'bind aborts in-flight documentCandidate of previous project')
  pendingGates[0].reject(new Error('late network failure from project_a'))
  await assert.rejects(candidateA)
  assert.equal(client.serviceUnavailable, false, 'late failure from project_a never locks project_b')
  assert.equal(client.blocked, false)

  // 2) Old project request succeeding late after project_b fails must not clear project_b lock.
  const lateSuccessFromB = client.documentCandidate({ action: 'read', candidate_id: 'cand_b' }, 'project_b')
  assert.equal(pendingGates.length, 2)
  client.bind('project_c')
  assert.equal(signals[1].signal.aborted, true, 'bind aborts in-flight request from project_b')
  const restoreC = client.restore()
  assert.equal(pendingGates.length, 3)
  pendingGates[2].reject(new Error('project_c offline'))
  await assert.rejects(restoreC, { code: 'assistant_service_unavailable' })
  assert.equal(client.serviceUnavailable, true)
  assert.equal(client.blocked, true)
  pendingGates[1].resolve(json({ ok: true }))
  await assert.rejects(lateSuccessFromB, { code: 'assistant_cancelled' })
  assert.equal(client.serviceUnavailable, true, 'late success from old project never clears project_c lock')
  assert.equal(client.blocked, true)

  // 3) Same-project older request finishing after a newer failure must not clear the newer failure lock.
  client.bind('project_d')
  const olderReq = client.prepareDocument({ canvas_id: 'c1' }, 'project_d')
  const newerRestore = client.restore()
  assert.equal(pendingGates.length, 5)
  pendingGates[4].reject(new Error('newer restore failed'))
  await assert.rejects(newerRestore, { code: 'assistant_service_unavailable' })
  assert.equal(client.serviceUnavailable, true)
  pendingGates[3].resolve(json({ grant_id: 'g1', frames: 1, layers: 1 }))
  await olderReq
  assert.equal(client.serviceUnavailable, true, 'older in-flight request finishing late cannot clear newer failure lock')

  // A new request started after the failure succeeds and clears the lock.
  const reconnectD = client.restore({ refresh: true })
  assert.equal(pendingGates.length, 6)
  pendingGates[5].resolve(json({ conversation: 'grok-1', discussion: 'disc-d', provider: 'grok', model: 'grok-4.7', blocked: false, turns: [] }))
  await reconnectD
  assert.equal(client.serviceUnavailable, false)
  assert.equal(client.blocked, false)
})

test('concurrent same-project requests update connectivity strictly by owning request sequence across all four completion orders', async () => {
  for (const mode of [
    'older-success-then-newer-failure',
    'older-failure-then-newer-success',
    'newer-failure-then-older-late-success',
    'newer-success-then-older-late-failure',
  ]) {
    const pending = []
    const client = createVnextAssistantClient({
      fetchImpl: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    })
    client.bind('project_seq')
    const first = client.documentCandidate({ action: 'read', candidate_id: 'cand_1' }).catch(error => error.code)
    const second = client.documentCandidate({ action: 'read', candidate_id: 'cand_2' }).catch(error => error.code)
    assert.equal(pending.length, 2, `${mode}: two overlapping requests started`)
    const ok = json({ candidate: null })

    if (mode === 'older-success-then-newer-failure') {
      pending[0].resolve(ok); await first
      assert.equal(client.serviceUnavailable, false)
      pending[1].reject(new Error('offline on newer B')); await second
      assert.equal(client.serviceUnavailable, true, 'newer B failure after older A success sets offline')
      assert.equal(client.blocked, true)
    } else if (mode === 'older-failure-then-newer-success') {
      pending[0].reject(new Error('offline on older A')); await first
      assert.equal(client.serviceUnavailable, true)
      pending[1].resolve(ok); await second
      assert.equal(client.serviceUnavailable, false, 'newer B success after older A failure clears offline')
      assert.equal(client.blocked, false)
    } else if (mode === 'newer-failure-then-older-late-success') {
      pending[1].reject(new Error('offline on newer B')); await second
      assert.equal(client.serviceUnavailable, true)
      pending[0].resolve(ok); await first
      assert.equal(client.serviceUnavailable, true, 'older A late success cannot clear newer B failure')
      assert.equal(client.blocked, true)
    } else if (mode === 'newer-success-then-older-late-failure') {
      // Seed offline first so we verify B clears it and A late failure cannot re-lock it.
      const seed = client.documentCandidate({ action: 'read', candidate_id: 'seed' }).catch(error => error.code)
      pending[2].reject(new Error('seed offline')); await seed
      const olderA = client.documentCandidate({ action: 'read', candidate_id: 'cand_a' }).catch(error => error.code)
      const newerB = client.documentCandidate({ action: 'read', candidate_id: 'cand_b' }).catch(error => error.code)
      pending[4].resolve(ok); await newerB
      assert.equal(client.serviceUnavailable, false, 'newer B success clears offline')
      pending[3].reject(new Error('late failure on older A')); await olderA
      assert.equal(client.serviceUnavailable, false, 'older A late failure cannot overwrite newer B success')
      assert.equal(client.blocked, false)
      pending[0].resolve(ok); pending[1].resolve(ok); await first; await second
    }
  }
})

// The real client and the real conversation service, connected by an in-process transport that
// behaves like the HTTP route (a client abort also aborts the server request). No provider is
// reachable: the grok adapter is a local fake.
async function stopAndContinueFixture() {
  const { createAssistantConversations, safeAssistantFailure } = await import('../../src/editor-project/assistantConversation.js')
  const data = new Map(), adapterCalls = []
  const records = {
    async get(scope, group, id) { return structuredClone(data.get(`${scope.projectId}/${group}/${id}`) ?? null) },
    async put(scope, group, id, value) { data.set(`${scope.projectId}/${group}/${id}`, structuredClone(value)) },
  }
  let hold = null
  const run = async input => {
    adapterCalls.push({ message: input.message, threadId: input.threadId })
    if (hold) {
      const gate = hold
      // A delayed native reply: it ends only when stopped (or released while still running).
      return new Promise((resolve, reject) => {
        gate.release = () => reject(Object.assign(new Error('stopped'), { code: 'assistant_cancelled' }))
        if (!gate.ignoreAbort) input.signal?.addEventListener('abort', gate.release, { once: true })
      })
    }
    return { reply: `Reply ${adapterCalls.length}`, threadId: `grok-thread-${adapterCalls.length}`, naturalExit: true }
  }
  const load = async scope => ({ project: { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} } })
  let service = createAssistantConversations({ run, records, load })
  const transportCalls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url, 'http://local')
    const parts = parsed.pathname.split('/')
    const endpoint = parts[6], scope = { projectId: decodeURIComponent(parts[4]), workspaceRoot: '/workspace' }
    const body = init.body && init.body !== 'undefined' ? JSON.parse(init.body) : undefined
    transportCalls.push(endpoint)
    const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    // Like fetch, an aborted request rejects at once; the server request keeps running until it ends.
    const aborted = new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(abortError()), { once: true }))
    try {
      const work = endpoint === 'history' ? service.history(scope, parsed.searchParams.get('provider'), { shared: true })
        : endpoint === 'session' ? service.open(scope, body)
          : endpoint === 'resolve' ? service.resolve(scope, body)
            : service.send(scope, body, init.signal)
      work.catch(() => {})
      const value = await Promise.race([work, aborted])
      if (init.signal?.aborted) throw abortError()
      return { ok: true, json: async () => value }
    } catch (error) {
      if (init.signal?.aborted) throw abortError()
      const safe = safeAssistantFailure(error)
      return { ok: false, json: async () => safe.body }
    }
  }
  const client = createVnextAssistantClient({ fetchImpl })
  client.bind('project_a')
  return { client, adapterCalls, transportCalls, data, fetchImpl,
    holdNext(options = {}) { hold = { ...options }; return hold },
    release() { const gate = hold; hold = null; return gate },
    restartService() { service = createAssistantConversations({ run, records, load }) } }
}

test('real client: a delayed reply, Stop, then explicit Continue here keeps the discussion and never replays the stopped request', async () => {
  const f = await stopAndContinueFixture()
  assert.equal((await f.client.send({ message: 'hello there', revision: 1 })).reply, 'Reply 1')
  const discussionBefore = (await f.client.restore({ refresh: true })).discussion
  f.holdNext()
  const pending = f.client.send({ message: 'draw something slow', revision: 1 })
  for (let i = 0; i < 20 && f.adapterCalls.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.adapterCalls.length, 2, 'the delayed request reached the adapter once')
  f.client.stop()
  await assert.rejects(pending)
  f.release()
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)) // the server request finishes ending
  assert.equal(f.client.blocked, true, 'an unknown result pauses this channel')
  assert.equal(f.client.interrupted, true)
  await assert.rejects(f.client.send({ message: 'next idea', revision: 1 }), { code: 'assistant_busy' })
  assert.equal(f.adapterCalls.length, 2, 'a paused channel sends nothing')

  const resumed = await f.client.resume()
  assert.equal(f.client.blocked, false)
  assert.equal(f.client.interrupted, false)
  assert.equal(resumed.discussion, discussionBefore, 'the same discussion continues')
  assert.deepEqual(resumed.turns.map(turn => [turn.message, turn.status]), [['hello there', 'done'], ['draw something slow', 'unknown']],
    'history keeps the stopped turn as unknown; nothing was rewritten')
  assert.equal(f.adapterCalls.length, 2, 'recovery itself makes no model call')
  assert.deepEqual(f.transportCalls.filter(call => call === 'resolve').length, 1)

  assert.equal((await f.client.send({ message: 'next idea', revision: 1 })).reply, 'Reply 3')
  assert.equal(f.adapterCalls.length, 3, 'only the new message was sent')
  assert.equal(f.adapterCalls[2].threadId, null, 'the paused native thread is not continued')
  assert.match(f.adapterCalls[2].message, /next idea/)
  assert.match(f.adapterCalls[2].message, /hello there/, 'shared history still travels with the new message')
  assert.doesNotMatch(f.adapterCalls[2].message, /draw something slow/, 'the stopped request is never replayed')
  const history = await f.client.restore({ refresh: true })
  assert.equal(history.discussion, discussionBefore)
  assert.deepEqual(history.turns.map(turn => turn.status), ['done', 'unknown', 'done'])
})

test('real client: Continue here waits while the stopped request is still ending and after a restart reads the paused state first', async () => {
  const f = await stopAndContinueFixture()
  await f.client.send({ message: 'hello there', revision: 1 })
  f.holdNext({ ignoreAbort: true })
  const pending = f.client.send({ message: 'slow request', revision: 1 })
  for (let i = 0; i < 20 && f.adapterCalls.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
  f.client.stop()
  await assert.rejects(pending)
  await assert.rejects(f.client.resume(), { code: 'assistant_busy' }, 'the server still owns the channel')
  assert.equal(f.client.blocked, true)
  f.release().release()
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
  // A restart: the saved channel is paused; a fresh client restores it as paused and recovers explicitly.
  f.restartService()
  const fresh = createVnextAssistantClient({ fetchImpl: f.fetchImpl })
  fresh.bind('project_a')
  const restored = await fresh.restore()
  assert.equal(fresh.blocked, true); assert.equal(fresh.interrupted, true)
  assert.equal(restored.blocked, true)
  await fresh.resume()
  assert.equal(fresh.blocked, false)
  assert.equal((await fresh.send({ message: 'after restart', revision: 1 })).reply, 'Reply 3')
  assert.equal(f.adapterCalls.length, 3)
  assert.doesNotMatch(f.adapterCalls[2].message, /slow request/)
})
