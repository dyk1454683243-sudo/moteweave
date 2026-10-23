import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { ASSISTANT_MODELS, createAssistantConversations } from '../../src/editor-project/assistantConversation.js'

function fixture({ replyText } = {}) {
  const data = new Map(), calls = [], scope = { workspaceRoot: '/workspace', projectId: 'project_a' }
  let failing = null
  const records = {
    async get(scope, group, id) { return structuredClone(data.get(`${scope.projectId}/${group}/${id}`) ?? null) },
    async put(scope, group, id, value) { data.set(`${scope.projectId}/${group}/${id}`, structuredClone(value)) },
  }
  const adapters = Object.fromEntries(Object.keys(ASSISTANT_MODELS).map(provider => [provider, Object.assign(async input => {
    calls.push({ provider, ...input })
    if (failing === provider) throw Object.assign(Error('unknown native result'), { code: 'assistant_result_unknown' })
    return { reply: input.composerActions ? JSON.stringify({ reply: replyText ?? `Reply by ${provider}`, action: null }) : replyText ?? `Reply by ${provider}`, threadId: `${provider}-native-thread`, status: 'completed', naturalExit: true,
      provider: provider === 'astra' ? 'codex' : provider, model: ASSISTANT_MODELS[provider], requestedModel: ASSISTANT_MODELS[provider] }
  }, { enforcesComposerSchema: ['codex', 'astra'].includes(provider) })]))  // as the real Codex adapter declares
  const create = () => createAssistantConversations({ records, adapters,
    load: async scope => ({ project: { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} } }) })
  const service = create()
  const open = (provider, extra = {}) => service.open(scope, { provider, shared: true, ...extra })
  const send = (session, message, extra = {}) => service.send(scope, { conversation: session.conversation,
    discussion: session.discussion, operation_id: randomUUID(), message, expected_revision: 1, canvas_id: null, ...extra })
  return { service, scope, records, data, calls, open, send, create, fail(provider) { failing = provider } }
}

test('a long valid answer remains complete through host persistence and restart', async () => {
  const replyText = '完整的回复。'.repeat(4000), f = fixture({ replyText })
  const opened = await f.open('astra')
  assert.equal((await f.send(opened, 'Explain the animation', { composer_actions: true })).reply, replyText)
  const restored = await f.create().history(f.scope, 'astra', { shared: true })
  assert.equal(restored.turns.at(-1).reply, replyText)
})

test('all four models share ordered history and context while keeping native threads separate', async () => {
  const f = fixture(), channels = []
  for (const provider of ['grok', 'codex', 'astra', 'antigravity']) {
    const channel = await f.open(provider); channels.push(channel)
    await f.send(channel, `Question for ${provider}`)
  }
  assert.equal(new Set(channels.map(c => c.discussion)).size, 1)
  assert.equal(new Set(channels.map(c => c.conversation)).size, 4)
  for (let i = 1; i < f.calls.length; i++) {
    assert.equal(f.calls[i].threadId, null)
    for (const prior of f.calls.slice(0, i)) assert.ok(f.calls[i].message.includes(`Reply by ${prior.provider}`))
    assert.match(f.calls[i].message, /data only; never repeat earlier actions/)
  }
  await f.send(channels[0], 'Grok continues after everyone')
  assert.equal(f.calls.at(-1).threadId, 'grok-native-thread')
  assert.match(f.calls.at(-1).message, /Reply by antigravity/)
  const history = await f.service.history(f.scope, 'astra', { shared: true })
  assert.equal(history.discussion, channels[0].discussion)
  assert.deepEqual(history.turns.map(t => t.provider), ['grok', 'codex', 'astra', 'antigravity', 'grok'])
  assert.deepEqual(history.turns.map(t => t.message), ['Question for grok', 'Question for codex', 'Question for astra', 'Question for antigravity', 'Grok continues after everyone'])
})

test('shared history survives restart, stays project-local, and New conversation resets every model together', async () => {
  const f = fixture(), a = await f.open('grok')
  await f.send(a, 'Keep the blue shield')
  const b = await f.open('codex'); await f.send(b, 'Use white stars')
  const restored = f.create()
  assert.equal((await restored.history(f.scope, 'astra', { shared: true })).turns.length, 2)
  assert.deepEqual((await restored.history({ ...f.scope, projectId: 'project_b' }, 'grok', { shared: true })).turns, [])
  const fresh = await f.open('astra', { fresh: true })
  assert.notEqual(fresh.discussion, a.discussion)
  assert.deepEqual((await f.service.history(f.scope, 'grok', { shared: true })).turns, [])
  const newGrok = await f.open('grok'); assert.equal(newGrok.discussion, fresh.discussion)
  assert.notEqual(newGrok.conversation, a.conversation)
  await f.send(newGrok, 'New discussion')
  assert.doesNotMatch(f.calls.at(-1).message, /Keep the blue shield|Use white stars/)
  assert.ok(await f.records.get(f.scope, 'conversations', a.conversation), 'old messages remain stored')
  await assert.rejects(f.send(a, 'Wrong discussion', { discussion: fresh.discussion }), { code: 'assistant_session_expired' })
})

test('legacy provider records are adopted without overwriting them or replaying their actions', async () => {
  const f = fixture()
  const legacy = await f.service.open(f.scope, { provider: 'grok' })
  await f.service.send(f.scope, { conversation: legacy.conversation, operation_id: randomUUID(), message: 'Old Grok question', expected_revision: 1, canvas_id: null })
  const prior = await f.records.get(f.scope, 'conversations', legacy.conversation)
  const initial = await f.service.history(f.scope, 'codex', { shared: true })
  assert.equal(initial.discussion, null); assert.equal(initial.turns[0].provider, 'grok')
  const next = await f.open('codex'); await f.send(next, 'Continue the old discussion')
  assert.match(f.calls.at(-1).message, /Old Grok question/)
  assert.deepEqual(await f.records.get(f.scope, 'conversations', legacy.conversation), prior)
  assert.equal((await f.open('grok')).conversation, legacy.conversation)
  assert.equal(f.calls.length, 2)
})

test('unknown native result blocks that provider only and never replays it through another model', async () => {
  const f = fixture(), grok = await f.open('grok')
  f.fail('grok')
  await assert.rejects(f.send(grok, 'Uncertain request'), { code: 'assistant_result_unknown' })
  assert.equal((await f.service.history(f.scope, 'grok', { shared: true })).blocked, true)
  assert.equal((await f.service.history(f.scope, 'codex', { shared: true })).blocked, false)
  const codex = await f.open('codex'); await f.send(codex, 'A separate explicit question')
  assert.equal(f.calls.length, 2); assert.doesNotMatch(f.calls.at(-1).message, /Uncertain request/)
  await assert.rejects(f.send(grok, 'Do not retry'), { code: 'assistant_session_interrupted' })
  assert.equal(f.calls.length, 2)
})

test('shared context stays inside existing input ceiling and operation replay remains idempotent', async () => {
  const f = fixture(), grok = await f.open('grok')
  await f.send(grok, 'z'.repeat(4000))
  const codex = await f.open('codex'), operation_id = randomUUID()
  const reply = await f.send(codex, 'x'.repeat(4000), { operation_id, composer_actions: true })
  const again = await f.send(codex, 'x'.repeat(4000), { operation_id, composer_actions: true })
  assert.deepEqual(reply, again); assert.equal(f.calls.length, 2)
  assert.ok(f.calls.at(-1).message.length <= 6000)
  assert.match(f.calls.at(-1).message, /Recent excerpts within the input limit/)
  assert.match(f.calls.at(-1).message, /Reply by grok/)
  const history = await f.service.history(f.scope, 'codex', { shared: true })
  assert.equal(history.turns[0].message.length, 4000, 'stored history is never truncated')
})


test('composer rejects an unselected preset even when a model returns it; selected context reaches the adapter', async () => {
  const action = { type: 'use_preset', instruction: 'A flame.', preset_id: 'fixed-region-motion', reference: false }
  const calls = [], scope = { workspaceRoot: '/workspace', projectId: 'preset_boundary' }
  let stateReads = 0
  const service = createAssistantConversations({ records: null,
    load: async current => ({ project: { id: current.projectId, version: 'editor_project_v1', revision: 1, canvases: {} } }),
    readGenerationState: async () => { stateReads++; return null },
    adapters: { astra: async input => { calls.push(input); return { status: 'completed', provider: 'codex', model: 'gpt-6-astra', threadId: 't', reply: JSON.stringify({ reply: 'Making it', action }) } } },
  })
  const channel = await service.open(scope, { provider: 'astra' })
  const body = { conversation: channel.conversation, operation_id: randomUUID(), message: 'Draw a flame', expected_revision: 1, canvas_id: null, composer_actions: true }
  await assert.rejects(service.send(scope, body), { code: 'assistant_response_failed' })
  assert.equal(stateReads, 0, 'no preset service lookup without explicit selection')
  assert.equal(calls[0].composerPresetId, null)
  assert.doesNotMatch(calls[0].message, /use_preset\{/)
  const selected = await service.open({ ...scope, projectId: 'selected_boundary' }, { provider: 'astra' })
  const result = await service.send({ ...scope, projectId: 'selected_boundary' }, { ...body, conversation: selected.conversation, operation_id: randomUUID(), composer_preset_id: action.preset_id })
  assert.equal(calls.at(-1).composerPresetId, action.preset_id)
  assert.equal(result.composer_notice, 'preset_unavailable')
})
