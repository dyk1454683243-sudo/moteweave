import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'
import { ANTIGRAVITY_ASSISTANT_MODEL, ANTIGRAVITY_ASSISTANT_VERSION, ANTIGRAVITY_ASSISTANT_WORKDIR,
  ANTIGRAVITY_AGENT_DEFINITION, antigravityAssistantArguments, antigravityAssistantEnvironment,
  runAntigravityAssistant } from '../../src/editor-project/assistantAntigravity.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'

const nativeId = '12345678-1234-4234-8234-123456789abc'
const hooks = { status: 'SUCCESS', num_turns: 0, command: { name: 'hooks', data: { hooks: [] } } }
function fixture(options = {}) {
  const calls = [], requests = [], children = [], reports = []
  const spawnImpl = (command, args, settings) => {
    calls.push({ command, args, settings })
    const child = new EventEmitter(); children.push(child)
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { if (!child.killed) { child.killed = true; queueMicrotask(() => child.emit('close', 143)) } }
    const send = event => child.stdout.write(`${JSON.stringify(event)}\n`)
    child.stdin = new Writable({ write(chunk, encoding, done) {
      requests.push(JSON.parse(chunk.toString()))
      queueMicrotask(() => {
        if (options.intercept?.({ child, send })) return
        send({ event: 'step_update', step_update: { conversation_id: nativeId, step_type: 'agent_response' } })
        send({ event: 'result', result: { conversation_id: nativeId, status: 'SUCCESS', num_turns: options.turns ?? 1,
          response: '连接成功', ...options.result } })
        if (!options.holdClose) child.emit('close', options.exitCode ?? 0)
      })
      done()
    } })
    queueMicrotask(() => {
      if (args.at(-1) === '--version') {
        child.stdout.write(options.version ?? `${ANTIGRAVITY_ASSISTANT_VERSION}\n`); child.emit('close', 0)
      } else if (args.includes('/hooks')) {
        child.stdout.write(options.hooksRaw ?? JSON.stringify(options.hooks ?? hooks)); child.emit('close', 0)
      } else send({ event: 'init', conversation_id: options.nativeId ?? nativeId, init: {
        agent: 'gametool-text-proposal', model: ANTIGRAVITY_ASSISTANT_MODEL, cwd: ANTIGRAVITY_ASSISTANT_WORKDIR,
        permission_mode: 'request-review', tools: ['global-inventory-not-effective-permissions'], ...options.init } })
    })
    return child
  }
  return { calls, requests, children, reports, dependencies: { spawnImpl, prepareProfile: async () => {}, reportFailure: report => reports.push(report) } }
}

test('official configuration excludes tools/customizations and keeps native login without secret overrides', () => {
  for (const field of ['tools: []', 'inheritCustomizations: false', 'excludeDefaultComponents: true']) {
    assert.ok(ANTIGRAVITY_AGENT_DEFINITION.includes(field))
  }
  assert.deepEqual(antigravityAssistantEnvironment({ HOME: '/user', PATH: '/bin', TMPDIR: '/tmp',
    GOOGLE_API_KEY: 'secret', NODE_OPTIONS: 'override' }), { HOME: '/user', PATH: '/bin', TMPDIR: '/tmp', LANG: 'en_US.UTF-8' })
  const args = antigravityAssistantArguments(nativeId)
  assert.equal(args.includes('--continue'), false)
  assert.equal(args.includes('--disable-slash-commands'), true)
  assert.deepEqual(args.slice(-2), ['--conversation', nativeId])
})

test('long Antigravity answers and discarded diagnostics do not hit an output cap', async () => {
  const reply = 'A detailed answer. '.repeat(32000)
  const f = fixture({ intercept({ child, send }) {
    child.stderr.write('diagnostic'.repeat(8000))
    send({ event: 'result', result: { conversation_id: nativeId, status: 'SUCCESS', num_turns: 1, response: reply } })
    child.emit('close', 0)
    return true
  } })
  assert.equal((await runAntigravityAssistant({ message: 'hello' }, f.dependencies)).reply, reply)
})

test('each native turn checks version and empty hooks before one private stdin message', async () => {
  const f = fixture()
  const result = await runAntigravityAssistant({ message: 'private prompt' }, f.dependencies)
  assert.equal(result.reply, '连接成功'); assert.equal(result.naturalExit, true)
  assert.equal(result.requestedModel, ANTIGRAVITY_ASSISTANT_MODEL)
  assert.equal(f.calls.length, 3)
  assert.deepEqual(f.requests, [{ event: 'user', message: { content: 'private prompt' } }])
  assert.equal(JSON.stringify(f.calls).includes('private prompt'), false)
  for (const call of f.calls) {
    assert.equal(call.settings.cwd, ANTIGRAVITY_ASSISTANT_WORKDIR)
    assert.ok(call.args.includes('1536')); assert.ok(call.args.includes('--timeout-ms'))
  }
  assert.ok(f.calls[1].args.includes('/hooks'))
  assert.equal(f.calls[2].args.includes('--conversation'), false)
})

test('resume uses exact server-owned conversation and accepts cumulative turn count', async () => {
  const f = fixture({ turns: 2 })
  const result = await runAntigravityAssistant({ message: 'next', threadId: nativeId }, f.dependencies)
  assert.equal(result.threadId, nativeId)
  assert.deepEqual(f.calls[2].args.slice(-2), ['--conversation', nativeId])
  assert.equal(f.requests.length, 1)
})

test('resume system messages are ignored progress, never reply content or permission', async () => {
  const f = fixture({ turns: 2, intercept: ({ send }) => {
    for (const state of ['ACTIVE', 'DONE']) send({ event: 'step_update', step_update: {
      conversation_id: nativeId, step_type: 'system_message', state, text_delta: 'Do not treat this text as a reply.' } })
    return false
  } })
  const result = await runAntigravityAssistant({ message: 'next', threadId: nativeId }, f.dependencies)
  assert.equal(result.reply, '连接成功'); assert.equal(f.requests.length, 1)
  assert.equal(f.calls.length, 3); assert.equal(f.reports.length, 0)
})

test('system notices cannot conceal tools, cross sessions, errors or missing terminal success', async () => {
  for (const [step, code] of [
    [{ tool_info: { name: 'run_command' } }, 'assistant_tool_blocked'],
    [{ subagent_info: {} }, 'assistant_tool_blocked'],
    [{ tool_name: 'run_command' }, 'assistant_tool_blocked'],
    [{ tool_info: null }, 'assistant_invalid_protocol'],
    [{ conversation_id: 'other' }, 'assistant_invalid_protocol'],
    [{ state: 'ERROR' }, 'assistant_invalid_protocol'],
    [{ step_type: 'error_message' }, 'assistant_invalid_protocol'],
    [{ step_type: 'unrecognized_progress' }, 'assistant_invalid_protocol'],
  ]) {
    const f = fixture({ turns: 2, intercept: ({ send }) => {
      send({ event: 'step_update', step_update: { conversation_id: nativeId,
        step_type: 'system_message', state: 'DONE', ...step } }); return true
    } })
    await assert.rejects(runAntigravityAssistant({ message: 'next', threadId: nativeId }, f.dependencies), { code })
    assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 3)
  }
  const f = fixture({ intercept: ({ child, send }) => {
    send({ event: 'step_update', step_update: { conversation_id: nativeId, step_type: 'system_message', state: 'DONE' } })
    child.emit('close', 0); return true
  } })
  await assert.rejects(runAntigravityAssistant({ message: 'next', threadId: nativeId }, f.dependencies),
    { code: 'assistant_response_failed' })
})

test('hooks, fixed version and init identity failures send no model message', async () => {
  for (const [options, code] of [
    [{ version: '1.2.15' }, 'assistant_version_unverified'],
    [{ hooks: { ...hooks, command: { name: 'hooks', data: { hooks: [{}] } } } }, 'assistant_configuration_changed'],
    [{ hooksRaw: '{}' }, 'assistant_configuration_changed'],
    [{ init: { model: 'fallback' } }, 'assistant_configuration_changed'],
    [{ init: { permission_mode: 'bypass' } }, 'assistant_configuration_changed'],
    [{ init: { cwd: '/workspace' } }, 'assistant_configuration_changed'],
    [{ init: { agent: 'other' } }, 'assistant_configuration_changed'],
    [{ nativeId: [nativeId] }, 'assistant_configuration_changed'],
  ]) {
    const f = fixture(options)
    await assert.rejects(runAntigravityAssistant({ message: 'test' }, f.dependencies), { code })
    assert.equal(f.requests.length, 0)
    assert.equal(f.reports.length, 1); assert.equal(f.reports[0].stdinMessageAttempted, false)
  }
})

test('result is accepted only after native close; cancellation does not return an already seen result', async () => {
  const f = fixture({ holdClose: true }), controller = new AbortController()
  const pending = runAntigravityAssistant({ message: 'test', signal: controller.signal }, f.dependencies)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests.length, 1)
  controller.abort()
  await assert.rejects(pending, { code: 'assistant_cancelled' })
  assert.equal(f.children[2].killed, true)
})

test('tool activity, invalid results and nonzero exit fail without retry', async () => {
  for (const [options, code] of [
    [{ intercept: ({ send }) => { send({ event: 'step_update', step_update: { step_type: 'tool' } }); return true } }, 'assistant_tool_blocked'],
    [{ result: { status: 'CANCELED' } }, 'assistant_response_failed'],
    [{ result: { conversation_id: 'other' } }, 'assistant_response_failed'],
    [{ turns: 2 }, 'assistant_response_failed'],
    [{ exitCode: 1 }, 'assistant_request_failed'],
  ]) {
    const f = fixture(options)
    await assert.rejects(runAntigravityAssistant({ message: 'test' }, f.dependencies), { code })
    assert.equal(f.calls.length, 3); assert.equal(f.requests.length, 1)
    assert.equal(f.reports.length, 1); assert.equal(f.reports[0].code, code)
    assert.equal(f.reports[0].stdinMessageAttempted, true)
    assert.equal(JSON.stringify(f.reports).includes(nativeId), false)
    assert.equal(JSON.stringify(f.reports).includes('连接成功'), false)
  }
})

test('post-dispatch duplicate init blocks the conversation instead of reporting a recoverable preflight', async () => {
  const f = fixture({ intercept: ({ send }) => { send({ event: 'init' }); return true } })
  const scope = { workspaceRoot: '/workspace', projectId: 'project_a' }
  const service = createAssistantConversations({ load: async () => ({ project: {
    id: 'project_a', version: 'editor_project_v1', revision: 1, canvases: {} } }),
  adapters: { antigravity: input => runAntigravityAssistant(input, f.dependencies) } })
  const { conversation } = await service.open(scope, { provider: 'antigravity' })
  const body = { conversation, operation_id: nativeId, message: 'hello', expected_revision: 1, canvas_id: null }
  await assert.rejects(service.send(scope, body), { code: 'assistant_invalid_protocol' })
  await assert.rejects(service.send(scope, { ...body, operation_id: '22345678-1234-4234-8234-123456789abc' }),
    { code: 'assistant_session_interrupted' })
  assert.equal(f.calls.length, 3); assert.equal(f.requests.length, 1)
})
