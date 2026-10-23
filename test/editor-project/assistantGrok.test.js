import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import { GROK_ASSISTANT_PROFILE, grokAssistantArguments, grokAssistantEnvironment, runGrokAssistant } from '../../src/editor-project/assistantGrok.js'
import { ASSISTANT_MODELS, createAssistantConversations, safeAssistantFailure } from '../../src/editor-project/assistantConversation.js'
import { runGrokImage } from '../../src/editor-project/imageGrok.js'

const nativeId = '11111111-1111-4111-8111-111111111111'
const op = '22222222-2222-4222-8222-222222222222'
function fixture(options = {}) {
  const calls = [], removed = [], written = []
  let active
  const discovery = { grokVersion: '1.0.40', cwd: path.join(GROK_ASSISTANT_PROFILE, 'workdir'), projectRoot: null,
    hooks: [], plugins: [], skills: [], lspServers: [], projectInstructions: [], marketplaces: [],
    configWarnings: [], mcpConfigProblems: [], mcpServers: [{ disabled: true }],
    configSources: { layers: [{ path: path.join(GROK_ASSISTANT_PROFILE, 'config.toml') }] }, ...options.discovery }
  function spawnImpl(command, args, settings) {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kills = []
    child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', 143, null)); return true }
    calls.push({ command, args, settings, child })
    queueMicrotask(() => {
      if (args.includes('inspect')) {
        child.stdout.write(JSON.stringify(discovery)); child.emit('close', 0, null); return
      }
      active = child
      const send = event => child.stdout.write(`${JSON.stringify(event)}\n`)
      if (options.emit) { options.emit(child, send, args); return }
      const bytes = Buffer.from(`${JSON.stringify({ type: 'text', data: '你好，连接正常。' })}\n`)
      child.stdout.write(bytes.subarray(0, 27)); child.stdout.write(bytes.subarray(27))
      send({ type: 'end', stopReason: 'end_turn', num_turns: 1, sessionId: nativeId, modelUsage: options.modelUsage })
      if (!options.hold) child.emit('close', options.exitCode ?? 0, null)
    })
    return child
  }
  return { calls, removed, written, get active() { return active }, dependencies: {
    spawnImpl, prepareProfile: async () => {}, writePrompt: async file => written.push(file), removePrompt: async file => removed.push(file),
  } }
}

test('image branch reads its own native receipt, kills the tree before another turn and cleans only its prompt', async () => {
  let expectedFile
  const f = fixture({ emit(_child, send, args) {
    const sessionId = args[args.indexOf('--session-id') + 1]
    expectedFile = path.join(GROK_ASSISTANT_PROFILE, 'sessions', encodeURIComponent(path.join(GROK_ASSISTANT_PROFILE, 'workdir')), sessionId, 'images/1.jpg')
    send({ type: 'available_commands', commands: [] })
    send({ type: 'thought', data: 'generate' })
    send({ type: 'usage', usage: {} })
    send({ type: 'tool_call', toolName: 'image_gen', toolCallId: 'call-1' })
    send({ type: 'tool_call_update', toolCallId: 'call-1', status: 'completed',
      rawOutput: { type: 'ImageGen', path: expectedFile, filename: '1.jpg', session_folder: 'images' } })
  } })
  const result = await runGrokImage({ description: 'guard', operationId: op }, { ...f.dependencies,
    readImage: async input => { assert.equal(input.file, expectedFile); return { bytes: Buffer.from('jpeg'), mimeType: 'image/jpeg', width: 1, height: 1 } } })
  assert.equal(result.provider, 'grok'); assert.equal(result.observedToolCalls, 1)
  assert.equal(f.calls.length, 2); assert.deepEqual(f.active.kills, ['SIGTERM'])
  assert.deepEqual(f.removed, f.written)
  assert.ok(f.calls[1].args.includes('search_tool,use_tool,Agent'))
})

test('Grok connector fixes model, removes tools, isolates environment and never exposes message in argv', async () => {
  const f = fixture({ discovery: { configWarnings: undefined, mcpConfigProblems: undefined } })
  const result = await runGrokAssistant({ message: 'secret prompt' }, f.dependencies)
  assert.equal(result.reply, '你好，连接正常。'); assert.equal(result.naturalExit, true)
  assert.deepEqual(f.removed, f.written)
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].child.kills.length, 0)
  assert.equal(f.calls[1].args.includes('secret prompt'), false)
  assert.ok(f.calls[1].args.includes('90000')); assert.ok(f.calls[1].args.includes('1536'))
  const args = grokAssistantArguments('/controlled/prompt.txt')
  assert.ok(args.includes('grok-4.7')); assert.ok(args.includes('read_file,search_tool,use_tool,Agent'))
  assert.equal(args.includes('--yolo'), false)
  const env = grokAssistantEnvironment({ HOME: '/user', PATH: '/bin', GROK_HOME: '/other', GROK_API_KEY: 'secret', NODE_OPTIONS: 'inject' })
  assert.equal(env.GROK_HOME, GROK_ASSISTANT_PROFILE)
  assert.equal(JSON.stringify(env).includes('secret'), false); assert.equal(env.NODE_OPTIONS, undefined)
})

test('long streamed Grok answers and discarded diagnostics do not hit an output cap', async () => {
  const reply = 'A detailed answer. '.repeat(32000)
  const f = fixture({ emit(child, send) {
    child.stderr.write('diagnostic'.repeat(8000))
    send({ type: 'text', data: reply })
    send({ type: 'end', stopReason: 'end_turn', num_turns: 1, sessionId: nativeId })
    child.emit('close', 0, null)
  } })
  assert.equal((await runGrokAssistant({ message: 'hello' }, f.dependencies)).reply, reply)
})

test('optional accounting never terminates a valid reply; end waits for natural exit', async () => {
  for (const modelUsage of [undefined, null, {}, [], { unknown: true }]) {
    const f = fixture({ modelUsage, hold: true })
    let done = false
    const pending = runGrokAssistant({ message: 'test' }, f.dependencies).then(value => { done = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(done, false); assert.deepEqual(f.active.kills, [])
    f.active.emit('close', 0, null)
    assert.equal((await pending).naturalExit, true)
  }
})

test('version/config drift rejects before a model process; nonzero exit does not pass', async () => {
  for (const discovery of [{ grokVersion: 'changed' }, { hooks: [{}] }, { mcpServers: [{}] }, { projectRoot: '/project' }]) {
    const f = fixture({ discovery })
    await assert.rejects(runGrokAssistant({ message: 'test' }, f.dependencies), { code: 'assistant_configuration_changed' })
    assert.equal(f.calls.length, 1); assert.deepEqual(f.written, [])
  }
  const f = fixture({ exitCode: 143 })
  await assert.rejects(runGrokAssistant({ message: 'test' }, f.dependencies), { code: 'assistant_request_failed' })
  assert.deepEqual(f.removed, f.written)
})

test('tool event and cancellation terminate supervised process, never retry', async () => {
  const f = fixture({ emit: (child, send) => send({ type: 'tool_call', rawInput: 'must not be exposed' }) })
  await assert.rejects(runGrokAssistant({ message: 'test' }, f.dependencies), { code: 'assistant_tool_blocked' })
  assert.deepEqual(f.active.kills, ['SIGTERM']); assert.equal(f.calls.length, 2)
  const held = fixture({ hold: true }), abort = new AbortController()
  const pending = runGrokAssistant({ message: 'test', signal: abort.signal }, held.dependencies)
  await new Promise(resolve => setImmediate(resolve)); abort.abort()
  await assert.rejects(pending, { code: 'assistant_cancelled' }); assert.deepEqual(held.removed, held.written)
})

function serviceFixture(runOverride) {
  const calls = []
  const current = { id: 'project_a', version: 'editor_project_v1', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a' } } }
  const scope = { projectId: current.id, projectRoot: '/project', workspaceRoot: '/project/workspace' }
  const service = createAssistantConversations({ load: async ({ projectId }) => ({ project: { ...current, id: projectId } }),
    run: async request => { calls.push(request); return runOverride ? runOverride(request) : { reply: 'reply', threadId: nativeId, naturalExit: true } } })
  return { service, current, scope, calls, body: { operation_id: op, message: 'hello', expected_revision: 2, canvas_id: 'canvas_a' } }
}

test('project binding, server-only native session, idempotency and context validation', async () => {
  const f = serviceFixture(), opened = await f.service.open(f.scope, {})
  const body = { ...f.body, conversation: opened.conversation }
  const one = await f.service.send(f.scope, body)
  assert.deepEqual(await f.service.send(f.scope, body), one); assert.equal(f.calls.length, 1)
  assert.equal(one.threadId, undefined)
  await f.service.send(f.scope, { ...body, operation_id: nativeId, message: 'second' })
  assert.equal(f.calls[1].threadId, nativeId)
  assert.ok(f.calls[0].message.includes('"document_id":"doc_a"'))
  assert.equal(f.calls[0].message.includes('/project'), false)
  await assert.rejects(f.service.send({ ...f.scope, projectId: 'project_b' }, body), { code: 'assistant_session_expired' })
  await assert.rejects(f.service.send(f.scope, { ...body, message: 'changed' }), { code: 'assistant_operation_conflict' })
  await assert.rejects(f.service.send(f.scope, { ...body, model: 'other' }), { code: 'invalid_assistant_message' })
})

test('one native operation at a time; stale context never dispatches', async () => {
  let finish
  const f = serviceFixture(() => new Promise(resolve => { finish = resolve }))
  const { conversation } = await f.service.open(f.scope, {})
  const pending = f.service.send(f.scope, { ...f.body, conversation })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation, operation_id: nativeId }), { code: 'assistant_busy' })
  finish({ reply: 'reply', threadId: nativeId, naturalExit: true }); await pending
  f.current.revision = 3
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation, operation_id: nativeId }), { code: 'assistant_context_changed' })
  assert.equal(f.calls.length, 1)
  assert.deepEqual(safeAssistantFailure(new Error('/private/token')), { status: 500, body: { error: 'assistant_unavailable' } })
})

test('ambiguous native failure is not retried or resumed automatically', async () => {
  const f = serviceFixture(async () => { throw new Error('private failure') })
  const { conversation } = await f.service.open(f.scope, {})
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation }))
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation }))
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation, operation_id: nativeId }), { code: 'assistant_session_interrupted' })
  assert.equal(f.calls.length, 1)
})

test('prototype canvas keys reject before inference and known preflight errors permit explicit retry', async () => {
  let failFirst = true
  const f = serviceFixture(async () => {
    if (failFirst) { failFirst = false; throw Object.assign(new Error(), { code: 'assistant_configuration_changed' }) }
    return { reply: 'reply', threadId: nativeId, naturalExit: true }
  })
  const { conversation } = await f.service.open(f.scope, {})
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation, canvas_id: '__proto__' }), { code: 'assistant_context_changed' })
  assert.equal(f.calls.length, 0)
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation, operation_id: nativeId }), { code: 'assistant_configuration_changed' })
  const result = await f.service.send(f.scope, { ...f.body, conversation, operation_id: '33333333-3333-4333-8333-333333333333' })
  assert.equal(result.reply, 'reply'); assert.equal(f.calls.length, 2)
})

test('provider is frozen on open and native threads never cross providers', async () => {
  const calls = [], scope = { workspaceRoot: '/workspace', projectId: 'project_a' }
  const current = { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} }
  const service = createAssistantConversations({ load: async () => ({ project: current }), adapters: {
    grok: async input => { calls.push(['grok', input.threadId]); return { reply: 'Grok', threadId: 'grok-thread', naturalExit: true } },
    codex: async input => { calls.push(['codex', input.threadId]); return { reply: 'GPT', threadId: 'codex-thread',
      status: 'completed', provider: 'codex', model: 'gpt-6.1-sol' } },
    antigravity: async input => { calls.push(['antigravity', input.threadId]); return { reply: 'Gemini', threadId: nativeId,
      status: 'completed', provider: 'antigravity', requestedModel: 'gemini-3.8-flash-low', naturalExit: true } },
  } })
  const a = await service.open(scope, { provider: 'grok', model: 'grok-4.7' })
  const b = await service.open(scope, { provider: 'codex', model: 'gpt-6.1-sol' })
  const c = await service.open(scope, { provider: 'antigravity', model: 'gemini-3.8-flash-low' })
  const body = { operation_id: op, message: 'hello', expected_revision: 1, canvas_id: null }
  await service.send(scope, { ...body, conversation: a.conversation })
  const gpt = await service.send(scope, { ...body, conversation: b.conversation })
  const gemini = await service.send(scope, { ...body, conversation: c.conversation })
  await service.send(scope, { ...body, conversation: c.conversation, operation_id: nativeId })
  await service.send(scope, { ...body, conversation: a.conversation, operation_id: nativeId })
  assert.deepEqual(calls, [['grok', null], ['codex', null], ['antigravity', null], ['antigravity', nativeId], ['grok', 'grok-thread']])
  assert.equal(gemini.provider, 'antigravity'); assert.equal(gemini.termination, 'natural')
  assert.equal(gemini.threadId, undefined)
  assert.equal(gpt.provider, 'codex'); assert.equal(gpt.requestedModel, 'gpt-6.1-sol')
  assert.equal(gpt.completed, true); assert.equal(gpt.termination, 'managed')
  assert.equal(gpt.naturalExit, undefined); assert.equal(gpt.threadId, undefined)
  await assert.rejects(service.open(scope, { provider: 'codex', model: 'fallback' }), { code: 'assistant_model_unavailable' })
  await assert.rejects(service.open(scope, { provider: '__proto__' }), { code: 'assistant_model_unavailable' })
  for (const provider of [['codex'], ['grok'], {}, null]) {
    await assert.rejects(service.open(scope, { provider }), { code: 'assistant_model_unavailable' })
  }
  assert.equal(calls.length, 5)
  await assert.rejects(service.open(scope, { provider: 'unknown' }), { code: 'assistant_model_unavailable' })
  await assert.rejects(service.send(scope, { ...body, conversation: a.conversation, provider: 'codex' }), { code: 'invalid_assistant_message' })
  await assert.rejects(service.send({ ...scope, workspaceRoot: '/other' }, { ...body, conversation: a.conversation }), { code: 'assistant_session_expired' })
})

test('different providers share one busy lock and preflight login failure does not block a session', async () => {
  const scope = { workspaceRoot: '/workspace', projectId: 'project_a' }
  const current = { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} }
  let finish, calls = 0, loggedIn = false
  const service = createAssistantConversations({ load: async () => ({ project: current }), adapters: {
    grok: async () => new Promise(resolve => { finish = resolve }),
    codex: async () => { calls++; if (!loggedIn) throw Object.assign(new Error(), { code: 'assistant_login_required' })
      return { status: 'completed', provider: 'codex', model: 'gpt-6.1-sol', reply: 'GPT', threadId: 'codex-thread' } },
  } })
  const a = await service.open(scope, { provider: 'grok' }), b = await service.open(scope, { provider: 'codex' })
  const body = { operation_id: op, message: 'hello', expected_revision: 1, canvas_id: null }
  const pending = service.send(scope, { ...body, conversation: a.conversation })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(service.send(scope, { ...body, conversation: b.conversation }), { code: 'assistant_busy' })
  assert.equal(calls, 0)
  finish({ reply: 'Grok', threadId: 'grok-thread', naturalExit: true }); await pending
  await assert.rejects(service.send(scope, { ...body, conversation: b.conversation }), { code: 'assistant_login_required' })
  loggedIn = true
  const result = await service.send(scope, { ...body, conversation: b.conversation, operation_id: nativeId })
  assert.equal(result.reply, 'GPT'); assert.equal(calls, 2)
  assert.deepEqual(safeAssistantFailure({ code: 'assistant_login_required' }), {
    status: 503, body: { error: 'assistant_login_required' },
  })
})


test('Astra ordinary chat preserves a separate thread without reading or granting canvas edits', async () => {
  const calls = [], scope = { workspaceRoot: '/workspace', projectId: 'project_a' }
  const current = { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} }
  const unexpected = () => { throw new Error('ordinary discussion must not access pixel data or grants') }
  const service = createAssistantConversations({ load: async () => ({ project: current }),
    readDocument: unexpected, readBlock: unexpected, readGrant: unexpected,
    adapters: { astra: async input => { calls.push(input); return {
      reply: 'Let us discuss it.', threadId: 'astra-chat', status: 'completed', provider: 'codex', model: 'gpt-6-astra',
    } } },
  })
  const opened = await service.open(scope, { provider: 'astra', model: 'gpt-6-astra' })
  for (const operation_id of [op, nativeId]) {
    const result = await service.send(scope, { conversation: opened.conversation, operation_id, message: 'Hello', expected_revision: 1, canvas_id: null })
    assert.equal(result.termination, 'managed'); assert.equal(result.requestedModel, 'gpt-6-astra')
    assert.equal(result.naturalExit, undefined); assert.equal(result.pixel_candidate, undefined)
  }
  assert.deepEqual(calls.map(c => c.threadId), [null, 'astra-chat'])
  for (const input of calls) { assert.equal(input.model, 'gpt-6-astra'); assert.equal(input.pixelTools, undefined); assert.equal(input.referenceDataUrl, undefined) }
  assert.equal((await service.history(scope, 'astra')).turns.length, 2)
  assert.equal(current.revision, 1)
})


test('model actions preserve chat, expose only selected metadata and cannot grant tools', async () => {
  const scope = { workspaceRoot: '/workspace', projectId: 'project_a' }, calls = []
  const current = { id: scope.projectId, version: 'editor_project_v2', revision: 1,
    canvases: { c: { id: 'c', document_id: 'd' } }, sprite_documents: { d: { working_revision: 1 } } }
  let action = null
  const service = createAssistantConversations({ load: async () => ({ project: current }),
    readDocument: async () => ({ manifest: { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['a','b'] } }),
    readBlock: () => { throw Error('chat must not read pixels') }, readGrant: () => { throw Error('model request is not a grant') },
    adapters: { astra: async input => { calls.push(input); return { reply: JSON.stringify({ reply: 'Understood', action }),
      threadId: 'astra-chat', status: 'completed', provider: 'codex', model: 'gpt-6-astra' } } },
  })
  const opened = await service.open(scope, { provider: 'astra', model: 'gpt-6-astra' })
  const body = { conversation: opened.conversation, message: 'continue drawing', expected_revision: 1, canvas_id: 'c', composer_actions: true }
  const first = await service.send(scope, { ...body, operation_id: op })
  assert.equal(first.composer_action, null)
  action = { type: 'edit_document', instruction: 'Use the blue palette we discussed, align both layers.' }
  const second = await service.send(scope, { ...body, operation_id: nativeId })
  assert.deepEqual(second.composer_action, action)
  assert.equal(second.pixel_candidate, undefined)
  assert.deepEqual(calls.map(c => c.threadId), [null, 'astra-chat'])
  assert.match(calls[0].message, /"width":64.*"frames":1,"layers":2/)
  assert.equal(calls[1].pixelTools, undefined)
  assert.equal((await service.history(scope, 'astra')).turns.length, 2)
  for (const illegal of [{ expected_working_revision: 1 }, { grant_id: 'grant_' + 'a'.repeat(32) }, { pixel_tools: true }]) {
    await assert.rejects(service.send(scope, { ...body, ...illegal, operation_id: '33333333-3333-4333-8333-333333333333' }), { code: 'invalid_assistant_message' })
  }
  assert.equal(calls.length, 2)
})


test('isolated pixel execution returns bounded truthful facts to the original persistent discussion', async () => {
  const scope = { workspaceRoot: '/fixture', projectId: 'project_a' }, calls = []
  const current = { id: scope.projectId, version: 'editor_project_v2', revision: 1,
    canvases: { c: { id: 'c', document_id: 'd' } }, sprite_documents: { d: { working_revision: 1 } } }
  const manifest = { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: { locked: false } }, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: null } } }
  const service = createAssistantConversations({ load: async () => ({ project: current }), readDocument: async () => ({ manifest }),
    adapters: { astra: async input => {
      calls.push(input)
      if (input.pixelTools) await input.pixelTools.call('draw_pixels', { operations: [{ type: 'fill-rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: [0, 0, 255, 255] }] })
      return { reply: input.pixelTools ? 'Blue preview ready.' : JSON.stringify({ reply: 'Understood.', action: null }),
        threadId: input.pixelTools ? 'isolated-tool' : 'original-chat', status: 'completed', provider: 'codex', model: 'gpt-6-astra' }
    } },
  })
  const opened = await service.open(scope, { provider: 'astra', model: 'gpt-6-astra' })
  const common = { conversation: opened.conversation, expected_revision: 1, canvas_id: 'c' }
  await service.send(scope, { ...common, message: 'Use blue later.', composer_actions: true, operation_id: op })
  await service.send(scope, { ...common, message: 'Use the blue palette from our discussion.', expected_working_revision: 1, pixel_tools: true, operation_id: nativeId })
  await service.send(scope, { ...common, message: 'What did you propose?', composer_actions: true, operation_id: '33333333-3333-4333-8333-333333333333' })
  assert.deepEqual(calls.map(c => c.threadId), [null, null, 'original-chat'])
  assert.match(calls[2].message, /Blue preview ready/)
  assert.match(calls[2].message, /handed to the app to apply; outcome not recorded here/, 'the service never claims an outcome it did not observe')
  assert.equal(current.revision, 1)
  await service.send(scope, { ...common, message: 'x'.repeat(4000), composer_actions: true, composer_preset_id: 'fixed-region-motion', composer_workflow: 'review', operation_id: '44444444-4444-4444-8444-444444444444' })
  assert.ok(calls[3].message.length <= 6000)
  assert.equal((await service.history(scope, 'astra')).turns.length, 4)
  assert.equal(calls.length, 4, 'reading history does not replay proposed actions')
})


test('composer shares the real ready preset catalog; an unavailable preset keeps the reply and runs nothing', async () => {
  const scope = { workspaceRoot: '/fixture', projectId: 'project_a' }, calls = []
  const current = { id: scope.projectId, version: 'editor_project_v2', revision: 1, canvases: {}, sprite_documents: {} }
  let ready = true, action = null
  const service = createAssistantConversations({ load: async () => ({ project: current }),
    readGenerationState: async () => ({ presets: [{ id: 'native', provider: 'gemini', available: ready, route_kind: 'google_native',
      supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }] }),
    adapters: { grok: async input => { calls.push(input); return { reply: JSON.stringify({ reply: 'Review first.', action }), threadId: 'chat', status: 'completed', naturalExit: true } } },
  })
  const opened = await service.open(scope, { provider: 'grok' })
  const common = { conversation: opened.conversation, expected_revision: 1, canvas_id: null, composer_actions: true,
    composer_preset_id: 'fixed-region-motion', composer_workflow: 'idle' }
  await service.send(scope, { ...common, message: 'x'.repeat(4000), operation_id: op })
  assert.ok(calls[0].message.length <= 6000); assert.match(calls[0].message, /fixed-region-motion \(Fixed-region motion\): [^\n]*; ready\./)
  assert.match(calls[0].message, /"selected_preset_id":"fixed-region-motion"/)
  action = { type: 'use_preset', instruction: 'A blue knight.', preset_id: 'fixed-region-motion', reference: false }
  assert.deepEqual((await service.send(scope, { ...common, message: 'Use it.', operation_id: nativeId })).composer_action, action)
  ready = false
  const unavailable = await service.send(scope, { ...common, message: 'Use it.', operation_id: '33333333-3333-4333-8333-333333333333' })
  assert.equal(unavailable.reply, 'Review first.')
  assert.equal(unavailable.composer_action, null, 'an unready preset is never handed to the app')
  assert.equal(unavailable.composer_notice, 'preset_unavailable')
  await assert.rejects(service.send(scope, { ...common, composer_preset_id: 'rpg-8x8', message: 'Use it.', operation_id: '44444444-4444-4444-8444-444444444444' }), { code: 'invalid_assistant_message' })
})


// Reads the assembled request the way a model without a schema must: only the text it received.
function actionsFromContract(message) {
  const lines = message.split('\n')
  const fieldsLine = lines.find(line => line.startsWith('Fields: '))
  const types = Object.fromEntries(fieldsLine.slice(8, -1).split('; ').map(entry => {
    const [, name, type] = entry.match(/^(\w+)=([^ ]+)/)
    return [name, type]
  }))
  const literal = type => type.startsWith('text') ? ['A small knight, details inferred.'] : type.split('|').map(value => JSON.parse(value))
  const actions = []
  for (const line of lines) {
    const match = line.match(/^(\w+)\{([^}]*)\}: /)
    if (!match) continue
    const fields = match[2].split(',').map(field => field.split('='))
    const base = Object.fromEntries([['type', match[1]], ...fields.map(([name, fixed]) => [name, fixed === undefined ? literal(types[name])[0] : JSON.parse(fixed)])])
    actions.push(base)
    for (const [name, fixed] of fields) {
      if (fixed !== undefined) continue
      for (const value of literal(types[name]).slice(1)) actions.push({ ...base, [name]: value })
    }
  }
  return { actions, types }
}

test('Grok and Antigravity receive the complete generated action contract in the assembled request, and replies built from it are accepted', async () => {
  const { COMPOSER_PARAMS, composerActionsFor } = await import('../../src/editor-project/composerCapabilities.js')
  const scope = { workspaceRoot: '/fixture', projectId: 'project_a' }
  const current = { id: scope.projectId, version: 'editor_project_v2', revision: 1,
    canvases: { canvas_selected_long_id: { id: 'canvas_selected_long_id', document_id: 'document_selected_long_id' } },
    sprite_documents: { document_selected_long_id: { working_revision: 12 } } }
  const manifest = { revision: 12, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'], layers: { l: {} }, cels: { c: { block: null } } }
  for (const provider of ['grok', 'antigravity']) {
    const calls = []
    let reply = { reply: 'Sure.', action: null }
    const service = createAssistantConversations({ load: async () => ({ project: current }), readDocument: async () => ({ manifest }),
      readGenerationState: async () => ({ active_preset_id: 'native', presets: [{ id: 'native', provider: 'gemini', available: true, route_kind: 'google_native',
        supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }] }),
      adapters: { [provider]: async input => { calls.push(input); return { reply: JSON.stringify(reply), threadId: `${provider}-chat`, status: 'completed', naturalExit: true,
        provider, requestedModel: ASSISTANT_MODELS[provider] } } },
    })
    const opened = await service.open(scope, { provider })
    const common = { conversation: opened.conversation, expected_revision: 1, canvas_id: 'canvas_selected_long_id', composer_actions: true,
      composer_preset_id: 'fixed-region-motion', composer_workflow: 'idle' }
    let n = 0
    const operation = () => `${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000`
    await service.send(scope, { ...common, message: 'x'.repeat(4000), operation_id: operation() })
    const message = calls[0].message
    assert.ok(message.length <= 6000, `${provider}: a maximum message with selected-canvas metadata still fits`)
    assert.match(message, /"type":id, every listed field, nothing else/, 'the discriminator and closed shape are stated')
    assert.match(message, /Example: \{"type":"generate_image"/)
    const { actions, types } = actionsFromContract(message)
    assert.deepEqual([...new Set(actions.map(action => action.type))], composerActionsFor(provider, { selectedPresetId: common.composer_preset_id }).map(action => action.id), 'only this provider\'s actions are offered')
    for (const [name, type] of Object.entries(types)) {
      const schema = COMPOSER_PARAMS[name].schema
      if (schema.enum) assert.deepEqual(type.split('|').map(value => JSON.parse(value)), schema.enum, `${name}: every allowed value is listed`)
    }
    for (const action of actions) {
      reply = { reply: 'Making it now.', action }
      const result = await service.send(scope, { ...common, message: 'Make it.', operation_id: operation() })
      assert.deepEqual(result.composer_action, action, `${provider}: ${JSON.stringify(action)} built from the text is accepted`)
    }
    assert.ok(actions.some(action => action.type === 'generate_image' && action.background === 'white'), 'enum alternatives are exercised')
    reply = { reply: 'Uploading it.', action: { type: 'generate_image', instruction: 'Redraw it.', reference: true, background: 'green' } }
    await assert.rejects(service.send(scope, { ...common, message: 'Use this image.', operation_id: operation() }), 'the contract says reference=false here and the validator agrees')
  }
})

test('a provider whose adapter enforces the reply schema gets field meanings without restated values', async () => {
  const scope = { workspaceRoot: '/fixture', projectId: 'project_a' }, calls = []
  const current = { id: scope.projectId, version: 'editor_project_v2', revision: 1, canvases: {}, sprite_documents: {} }
  const codex = async input => { calls.push(input); return { reply: JSON.stringify({ reply: 'Sure.', action: null }), threadId: 'codex-chat', status: 'completed', provider: 'codex', model: input.model } }
  codex.enforcesComposerSchema = true
  const service = createAssistantConversations({ load: async () => ({ project: current }), adapters: { codex } })
  const opened = await service.open(scope, { provider: 'codex' })
  await service.send(scope, { conversation: opened.conversation, expected_revision: 1, canvas_id: null, composer_actions: true, message: 'Hello', operation_id: op })
  assert.equal(calls[0].composerActions, true, 'the adapter is asked for structured composer output')
  assert.match(calls[0].message, /Enforced JSON reply; action is null or one object/)
  assert.match(calls[0].message, /draw_pixels\{instruction,size,kind,reference\}/)
  assert.doesNotMatch(calls[0].message, /Example:/)
  const { runCodexAssistant } = await import('../../src/editor-project/assistantCodex.js')
  assert.equal(runCodexAssistant.enforcesComposerSchema, true, 'the real Codex adapter declares the schema it passes')
})
