import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { handleEditorProjectApi } from '../../src/editor-project/apiHandler.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'
import { createVnextAssistantClient } from '../../src/ui/vnext/vnext-assistant-client.js'

test('real shared-history HTTP route lets the client restore, switch models and send with shared context', async () => {
  const calls = []
  const service = createAssistantConversations({
    load: async scope => ({ project: { id: scope.projectId, version: 'editor_project_v1', revision: 1, canvases: {} } }),
    adapters: {
      grok: async input => { calls.push(input); return { reply: 'Grok remembers the shield', threadId: 'grok-thread', naturalExit: true } },
      codex: async input => { calls.push(input); return { reply: 'GPT remembers it too', threadId: 'codex-thread', status: 'completed', provider: 'codex', model: 'gpt-6.1-sol' } },
    },
  })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: '/safe', workspaceRoot: '/safe/workspace', assistantConversations: service,
    artifactAccessRegistry: { register() {}, has() {} },
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const client = createVnextAssistantClient({ operationId: randomUUID, fetchImpl: (url, init) => fetch(`${origin}${url}`, init) })
  try {
    client.bind('project_a')
    assert.deepEqual((await client.restore()).turns, []); assert.equal(client.blocked, false)
    await client.send({ message: 'A blue shield', revision: 1 })
    client.select('codex')
    const history = await client.restore()
    assert.equal(history.turns[0].reply, 'Grok remembers the shield'); assert.equal(history.preserveView, true)
    await client.send({ message: 'What color?', revision: 1 })
    assert.match(calls[1].message, /A blue shield/); assert.equal(calls[1].threadId, null)
    for (const query of ['shared=false', 'shared=true&shared=true', 'shared=true&extra=1']) {
      assert.equal((await fetch(`${origin}/api/editor/projects/project_a/assistant/history?${query}`)).status, 404)
    }
    assert.equal(calls.length, 2)
    // The explicit recovery route: only an exact channel body; an unpaused channel is left as it is.
    const saved = await (await fetch(`${origin}/api/editor/projects/project_a/assistant/history?provider=codex&shared=true`)).json()
    const resolve = body => fetch(`${origin}/api/editor/projects/project_a/assistant/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await resolve({ provider: 'codex', conversation: saved.conversation, extra: true })).status, 400)
    const unpaused = await resolve({ provider: 'codex', conversation: saved.conversation, discussion: saved.discussion })
    assert.equal(unpaused.status, 200)
    assert.deepEqual(await unpaused.json(), { conversation: saved.conversation, provider: 'codex', model: 'gpt-6.1-sol', blocked: false, resolved: false })
    assert.equal(calls.length, 2, 'recovery never calls a model')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('assistant HTTP boundary rejects foreign origins, paths and oversized input before service dispatch', async () => {
  const calls = []
  const service = { async open(scope, body) { calls.push({ scope, body }); return { conversation: 'opaque' } },
    async send() { throw new Error('/private/credentials must not appear') } }
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: '/safe', workspaceRoot: '/safe/workspace', assistantConversations: service,
    artifactAccessRegistry: { register() {}, has() { return false } },
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = (suffix, body = '{}', headers = {}) => fetch(`${origin}/api/editor/projects/project_a/assistant/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  })
  try {
    assert.equal((await post('session', '{}', { origin: 'https://untrusted.example' })).status, 403)
    assert.equal((await post('session', '{}', { origin: 'null' })).status, 403)
    assert.equal((await post('session', JSON.stringify({ message: 'a'.repeat(21000) }))).status, 413)
    assert.equal((await post('session', '{}', { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post('other')).status, 404); assert.equal(calls.length, 0)
    assert.equal((await post('session')).status, 200); assert.equal(calls.length, 1)
    assert.equal(calls[0].scope.projectId, 'project_a')
    const failure = await post('messages')
    assert.equal(failure.status, 500)
    assert.deepEqual(await failure.json(), { error: 'assistant_unavailable' })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('disconnect aborts the model operation and no late response is written', async () => {
  let started, finish
  const ready = new Promise(resolve => { started = resolve })
  const cancelled = new Promise(resolve => { finish = resolve })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: '/safe', workspaceRoot: '/safe/workspace', artifactAccessRegistry: { register() {}, has() {} },
    assistantConversations: { async send(scope, body, signal) {
      started(); return new Promise(resolve => signal.addEventListener('abort', () => { finish(); resolve({ reply: 'late' }) }))
    } },
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const controller = new AbortController()
  try {
    const pending = fetch(`http://127.0.0.1:${server.address().port}/api/editor/projects/project_a/assistant/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal,
    }).catch(error => error)
    await ready; controller.abort(); await pending; await cancelled
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
