import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'
import { createPixelToolSession } from '../../src/editor-project/pixelToolSession.js'
import { CODEX_ASSISTANT_MODEL, CODEX_ASSISTANT_PROFILE, codexAssistantArguments,
  codexAssistantEnvironment, runCodexAssistant, runCodexNative, CODEX_ASSISTANT_VERSION,
  CODEX_ASSISTANT_SUPPORTED_VERSIONS, codexCliVersionSupported, ASTRA_PIXEL_MODEL } from '../../src/editor-project/assistantCodex.js'

function fixture(options = {}) {
  const calls = [], requests = [], children = []
  function spawnImpl(command, args, settings) {
    calls.push({ command, args, settings })
    const child = new EventEmitter()
    children.push(child)
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    child.kill = () => {
      if (!child.killed) { child.killed = true; queueMicrotask(() => child.emit('close', options.closeCode ?? 143)) }
      return true
    }
    const send = event => child.stdout.write(`${JSON.stringify(event)}\n`)
    child.stdin = new Writable({ write(chunk, encoding, done) {
      for (const line of chunk.toString().trim().split('\n')) {
        if (!line) continue
        const request = JSON.parse(line)
        requests.push(request)
        queueMicrotask(() => {
          if (child.killed || request.id === undefined) return
          const respond = result => send({ id: request.id, result })
          if (options.intercept?.({ request, send, child, respond })) return
          if (request.method === 'initialize') respond({})
          if (request.method === 'account/read') respond({ account: { type: options.account || 'chatgpt' } })
          if (request.method === 'model/list') respond({ data: [{ model: options.model || CODEX_ASSISTANT_MODEL }] })
          if (request.method === 'modelProvider/capabilities/read') respond({ imageGeneration: options.imageAvailable !== false })
          if (request.method === 'thread/start' || request.method === 'thread/resume') {
            respond({ model: options.model || CODEX_ASSISTANT_MODEL, thread: { id: 'thread-1' } })
          }
          if (request.method === 'turn/start') {
            respond({ turn: { id: 'turn-1' } })
            setImmediate(() => {
              send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
                item: { type: 'agentMessage', text: JSON.stringify(options.reply || { reply: '连接成功' }) } } })
              send({ method: 'turn/completed', params: { threadId: 'thread-1',
                turn: { id: 'turn-1', status: 'completed' } } })
            })
          }
        })
      }
      done()
    } })
    if (args.at(-1) === '--version') queueMicrotask(() => {
      child.stdout.write(options.version || `codex-cli ${CODEX_ASSISTANT_VERSION}\n`)
      child.emit('close', 0)
    })
    return child
  }
  return { calls, requests, children, dependencies: { spawnImpl, checkProfile: async () => {} } }
}

test('Astra receives only native pixel tools; host returns tool images and no fallback is allowed', async () => {
  const seen = []
  const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, child }) {
    if (request.method === 'turn/start') {
      // Exercise response + first tool call coalesced in one operating-system read.
      child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
        { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1',
          callId: 'draw-1', namespace: null, tool: 'draw_pixels', arguments: { operations: [] } } }].map(JSON.stringify).join('\n') + '\n')
      return true
    }
    if (request.id === 300) {
      assert.equal(request.result.success, true)
      send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: '{"reply":"Preview ready"}' } } })
      send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })
      return true
    }
  } })
  const result = await runCodexAssistant({ message: 'draw', pixelTools: { call: async (...args) => {
    seen.push(args); return { success: true, contentItems: [{ type: 'inputImage', imageUrl: 'data:image/png;base64,cG5n' }] }
  } } }, f.dependencies)
  assert.equal(result.model, ASTRA_PIXEL_MODEL); assert.equal(result.observedToolCalls, 1)
  assert.deepEqual(seen, [['draw_pixels', { operations: [] }]])
  const thread = f.requests.find(r => r.method === 'thread/start').params
  assert.equal(thread.ephemeral, true); assert.equal(thread.allowProviderModelFallback, false)
  assert.deepEqual(thread.dynamicTools.map(t => t.name), ['read_canvas', 'read_region', 'patch_region', 'draw_pixels', 'undo_pixels'])
  assert.deepEqual(thread.environments, []); assert.ok(f.calls[1].args.includes('180000'))
})

test('an invalid drawing batch can be corrected in the same Astra turn without committing pixels', async () => {
  const session = createPixelToolSession({ rgba: new Uint8Array(64 * 64 * 4) })
  const before = (await session.candidate()).sha256
  const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, child }) {
    if (request.method === 'turn/start') {
      child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
        { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'bad', namespace: null,
          tool: 'draw_pixels', arguments: { operations: [{ type: 'fill-rect', rect: { x: 1, y: 1, w: 2, h: 2 } }] } } },
      ].map(JSON.stringify).join('\n') + '\n')
      return true
    }
    if (request.id === 300) {
      assert.equal(request.result.success, false)
      assert.match(request.result.contentItems[0].text, /field=operations\[0\]\.color issue=missing_field/)
      assert.match(request.result.contentItems[0].text, /exactly 4 integer RGBA channels/)
      assert.match(request.result.contentItems[0].text, /remaining_tool_calls=8/)
      assert.equal(request.result.contentItems.some(item => item.imageUrl), false)
      send({ id: 301, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'good', namespace: null,
        tool: 'draw_pixels', arguments: { operations: [{ type: 'fill-rect', rect: { x: 1, y: 1, w: 2, h: 2 }, color: [9, 8, 7, 255] }] } } })
      return true
    }
    if (request.id === 301) {
      assert.equal(request.result.success, true)
      send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: '{"reply":"Corrected"}' } } })
      send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })
      return true
    }
  } })
  const result = await runCodexAssistant({ message: 'draw', pixelTools: session }, f.dependencies)
  const after = await session.candidate()
  assert.equal(result.observedToolCalls, 2)
  assert.equal(after.tool_calls, 2)
  assert.equal(after.drawing_batches, 1)
  assert.equal(after.source_sha256, before)
  assert.notEqual(after.sha256, before)
})
test('call-limit exhaustion is a budget failure and a plan event stays prohibited', async () => {
  let calls = 0
  const session = { call: async () => { calls++; return { success: true, contentItems: [{ type: 'inputText', text: '{}' }] } }, status: () => ({ calls, drawing_batches: 0, argument_corrections: 0 }) }
  const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, child, respond }) {
    if (request.method === 'turn/start') {
      child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
        { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'c0', namespace: null, tool: 'read_canvas', arguments: {} } },
      ].map(JSON.stringify).join('\n') + '\n')
      return true
    }
    if (request.id >= 300 && request.result?.success === true) {
      const next = request.id + 1
      send({ id: next, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: `c${next}`, namespace: null, tool: 'read_canvas', arguments: {} } })
      return true
    }
    if (request.error) return true
    return false
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: session }, f.dependencies), error => {
    assert.equal(error.code, 'assistant_tool_blocked')
    assert.equal(error.diagnostic.reason, 'budget')
    assert.equal(error.diagnostic.rule, 'call_limit')
    assert.equal(calls, 9)
    return true
  })
  const planned = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, respond }) {
    if (request.method !== 'turn/start') return false
    respond({ turn: { id: 'turn-1' } })
    setImmediate(() => send({ method: 'turn/plan/updated', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'not-a-real-item' } } }))
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: session }, planned.dependencies), error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'prohibited' && error.diagnostic.item_type === 'other')
})
test('exhausted batches and stale context stop the adapter without a correction response', async () => {
  const paint = { type: 'fill-rect', rect: { x: 1, y: 1, w: 2, h: 2 }, color: [9, 8, 7, 255] }
  const session = createPixelToolSession({ rgba: new Uint8Array(64 * 64 * 4) })
  for (let i = 0; i < 3; i++) await session.call('draw_pixels', { operations: [paint] })
  const before = await session.candidate()
  const corrections = []
  const exhausted = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, child }) {
    if (request.method !== 'turn/start') {
      if (request.result?.success === false) corrections.push(request.result)
      return false
    }
    child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
      { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'bad', namespace: null, tool: 'draw_pixels', arguments: null } },
    ].map(JSON.stringify).join('\n') + '\n')
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: session }, exhausted.dependencies), error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'budget' && error.diagnostic.rule === 'batch_limit')
  assert.equal(corrections.length, 0)
  const after = await session.candidate()
  assert.equal(after.sha256, before.sha256)
  assert.equal(after.drawing_batches, 3)
  const stale = createPixelToolSession({ rgba: new Uint8Array(64 * 64 * 4), checkCurrent: async () => { throw Object.assign(new Error('stale'), { code: 'assistant_context_changed' }) } })
  const staleRun = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, child }) {
    if (request.method !== 'turn/start') {
      if (request.result?.success === false) corrections.push(request.result)
      return false
    }
    child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
      { id: 301, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'stale', namespace: null, tool: 'draw_pixels', arguments: null } },
    ].map(JSON.stringify).join('\n') + '\n')
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: stale }, staleRun.dependencies), { code: 'assistant_context_changed' })
  assert.equal(corrections.length, 0)
  assert.equal(stale.status().drawing_batches, 0)
  assert.equal(stale.status().calls, 1)
})
test('native tool request from another turn or unapproved tool aborts without executing it', async () => {
  for (const params of [{ turnId: 'old', tool: 'read_canvas' }, { turnId: 'turn-1', tool: 'shell' }]) {
    let ran = false
    const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, respond }) {
      if (request.method !== 'turn/start') return false
      respond({ turn: { id: 'turn-1' } })
      setImmediate(() => send({ id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', callId: 'x', namespace: null, arguments: {}, ...params } }))
      return true
    } })
    await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: { call: async () => { ran = true } } }, f.dependencies), { code: 'assistant_tool_blocked' })
    assert.equal(ran, false)
  }
})

test('pixel proposals use their own closed schema and preserve the complete structured response', async () => {
  for (const operation of [null, { type: 'fill-rect', rect: { x: 0, y: 0, w: 2, h: 2 }, color: [1, 2, 3, 255] }]) {
    const reply = { reply: 'Proposal only', operation }
    const f = fixture({ reply })
    const result = await runCodexAssistant({ message: 'Fill the rectangle', pixelProposal: true }, f.dependencies)
    assert.deepEqual(JSON.parse(result.reply), reply)
    const schema = f.requests.find(r => r.method === 'turn/start').params.outputSchema
    assert.deepEqual(schema.required, ['reply', 'operation'])
    assert.equal(schema.additionalProperties, false)
    assert.equal(schema.properties.operation.anyOf.length, 10)
  }
  for (const reply of [{ reply: 'x', operation: null, path: 'x' },
    { reply: 'x', operation: { type: 'erase', rect: { x: 0, y: 0, w: 1, h: 1 }, extra: true } }]) {
    await assert.rejects(runCodexAssistant({ message: 'edit', pixelProposal: true }, fixture({ reply }).dependencies), { code: 'assistant_response_failed' })
  }
})

test('official profile reuses native login without inheriting keys or provider overrides', () => {
  const env = codexAssistantEnvironment({ PATH: '/bin', HOME: '/user', TMPDIR: '/tmp',
    OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'untrusted', CODEX_HOME: '/other' })
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR'])
  assert.equal(env.CODEX_HOME, CODEX_ASSISTANT_PROFILE)
  assert.equal(JSON.stringify(env).includes('secret'), false)
  const args = codexAssistantArguments().join(' ')
  for (const value of ['cloud.skills.enabled=false', 'features.unbounded_connection_retries=false',
    'request_max_retries=0', 'stream_max_retries=0', 'features.shell_tool=false', 'features.plugins=false']) {
    assert.ok(args.includes(value), value)
  }
})

test('native image branch gates capability and terminates the supervised process after one image receipt', async () => {
  const f = fixture({ intercept({ request, respond, send }) {
    if (request.method !== 'turn/start') return false
    respond({ turn: { id: 'turn-1' } })
    setImmediate(() => send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
      item: { type: 'imageGeneration', id: 'call_1', status: 'completed', result: '', savedPath: '/native/call_1.png' } } }))
    return true
  } })
  const result = await runCodexNative({ image: true, message: 'Generate a guard', referenceDataUrl: 'data:image/png;base64,cG5n' }, f.dependencies)
  assert.equal(result.model, 'gpt-image-2')
  assert.equal(result.turnStartRequests, 1)
  assert.equal(result.savedPath, '/native/call_1.png')
  assert.equal(f.children[1].killed, true)
  assert.ok(f.calls[1].args.includes('features.image_generation=true'))
  assert.ok(f.calls[1].args.includes('features.omit_app_server_notification_media=true'))
  assert.equal(f.requests.find(r => r.method === 'turn/start').params.outputSchema, undefined)
  const turn = f.requests.find(r => r.method === 'turn/start').params
  assert.deepEqual(turn.environments, [])
  assert.deepEqual(turn.input[1], { type: 'image', url: 'data:image/png;base64,cG5n' })
  await assert.rejects(runCodexNative({ image: false, message: 'hello', referenceDataUrl: 'data:image/png;base64,cG5n' }, f.dependencies), { code: 'invalid_image_request' })
  const unavailable = fixture({ imageAvailable: false })
  await assert.rejects(runCodexNative({ image: true, message: 'guard' }, unavailable.dependencies), { code: 'image_unavailable' })
  assert.equal(unavailable.requests.some(r => r.method === 'turn/start'), false)
})

test('pixel drawing can see inline saved pixels without enabling image generation or other tools', async () => {
  const f = fixture({ reply: { reply: 'Which region?', drawing: null } })
  await runCodexAssistant({ message: 'Draw using strict pixel data', pixelDrawing: true, referenceDataUrl: 'data:image/png;base64,cG5n' }, f.dependencies)
  const turn = f.requests.find(r => r.method === 'turn/start').params
  assert.deepEqual(turn.input[1], { type: 'image', url: 'data:image/png;base64,cG5n' })
  assert.ok(turn.outputSchema)
  assert.deepEqual(turn.environments, [])
  assert.ok(f.calls[1].args.includes('features.image_generation=false'))
  assert.ok(f.calls[1].args.includes('features.omit_app_server_notification_media=true'))
  assert.equal(f.requests.some(r => r.method === 'thread/resume'), false)
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelDrawing: true, threadId: 'old' }, f.dependencies), { code: 'invalid_image_request' })
})

test('image branch rejects a second image, forbidden tools and unsuppressed image bytes', async () => {
  for (const kind of ['second', 'tool', 'base64']) {
    const f = fixture({ intercept({ request, respond, send }) {
      if (request.method !== 'turn/start') return false
      respond({ turn: { id: 'turn-1' } })
      setImmediate(() => {
        const event = (method, item) => send({ method, params: { threadId: 'thread-1', turnId: 'turn-1', item } })
        if (kind === 'tool') event('item/started', { type: 'commandExecution' })
        else if (kind === 'base64') event('item/completed', { type: 'imageGeneration', id: 'call_1', status: 'completed', result: 'bytes', savedPath: '/native.png' })
        else { event('item/started', { type: 'imageGeneration', id: 'call_1' }); event('item/started', { type: 'imageGeneration', id: 'call_2' }) }
      })
      return true
    } })
    await assert.rejects(runCodexNative({ image: true, message: 'guard' }, f.dependencies), {
      code: kind === 'second' ? 'image_tool_limit' : kind === 'tool' ? 'assistant_tool_blocked' : 'image_native_failed',
    })
    assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
  }
})

test('status reads native account and model metadata, sends no model turn, and exits', async () => {
  const f = fixture()
  assert.deepEqual(await runCodexAssistant({}, f.dependencies), {
    status: 'ready', provider: 'codex', model: CODEX_ASSISTANT_MODEL, turnStartRequests: 0,
  })
  assert.deepEqual(f.requests.filter(r => r.id).map(r => r.method), ['initialize', 'account/read', 'model/list'])
  assert.equal(f.children[1].killed, true)
  assert.ok(f.calls[1].args.includes('25000'))
  assert.ok(f.calls[1].args.includes('1536'))
})

test('one strict text turn returns only a validated reply and preserves tool restrictions', async () => {
  const f = fixture()
  const result = await runCodexAssistant({ message: '连接测试' }, f.dependencies)
  assert.equal(result.reply, '连接成功')
  assert.equal(result.turnStartRequests, 1)
  const start = f.requests.find(r => r.method === 'thread/start').params
  assert.deepEqual(start.environments, [])
  assert.deepEqual(start.dynamicTools, [])
  assert.deepEqual(start.selectedCapabilityRoots, [])
  assert.equal(start.allowProviderModelFallback, false)
  const turn = f.requests.find(r => r.method === 'turn/start').params
  assert.deepEqual(turn.environments, [])
  assert.equal(turn.outputSchema.additionalProperties, false)
  assert.equal(f.children[1].killed, true)
  assert.ok(f.calls[1].args.includes('90000'))
})

test('accepts bounded host metadata around a maximum browser message, without increasing the browser limit', async () => {
  const f = fixture()
  const result = await runCodexAssistant({ message: `Selected-object metadata: {}\nUser message:\n${'x'.repeat(4000)}` }, f.dependencies)
  assert.equal(result.reply, '连接成功')
  await assert.rejects(runCodexAssistant({ message: 'x'.repeat(6001) }, f.dependencies), { code: 'invalid_assistant_message' })
})

test('supported CLI versions stay explicit and unknown banners never start a turn', async () => {
  assert.deepEqual([...CODEX_ASSISTANT_SUPPORTED_VERSIONS], ['0.160.0', '0.162.0-alpha.2', '0.162.0-alpha.17.2', '0.163.0-alpha.10.2', '0.163.0-alpha.11.1'])
  assert.equal(CODEX_ASSISTANT_VERSION, '0.160.0')
  assert.equal(codexCliVersionSupported('codex-cli 0.160.0'), true)
  assert.equal(codexCliVersionSupported('codex-cli 0.162.0-alpha.2\n'), true)
  assert.equal(codexCliVersionSupported('codex-cli 0.162.0-alpha.17.2\n'), true)
  assert.equal(codexCliVersionSupported('codex-cli 0.163.0-alpha.10.2\n'), true)
  assert.equal(codexCliVersionSupported('codex-cli 0.163.0-alpha.11.1\n'), true)
  assert.equal(codexCliVersionSupported('codex-cli 0.163.0-alpha.11'), false)
  assert.equal(codexCliVersionSupported('codex-cli 0.163.0-alpha.11.2'), false)
  assert.equal(codexCliVersionSupported('codex-cli 0.162.0'), false)
  assert.equal(codexCliVersionSupported('codex-cli 0.162.0-alpha.3'), false)
  for (const ver of ['codex-cli 0.162.0-alpha.2', 'codex-cli 0.162.0-alpha.17.2', 'codex-cli 0.163.0-alpha.10.2', 'codex-cli 0.163.0-alpha.11.1']) {
    const accepted = fixture({ version: ver })
    assert.deepEqual(await runCodexNative({ image: true }, accepted.dependencies), {
      status: 'ready', provider: 'codex', model: CODEX_ASSISTANT_MODEL, turnStartRequests: 0,
    })
    assert.deepEqual(accepted.requests.filter(request => request.id).map(request => request.method), [
      'initialize', 'account/read', 'model/list', 'modelProvider/capabilities/read',
    ])
    assert.equal(accepted.requests.some(request => request.method === 'turn/start'), false)
  }
  const astra = fixture({ version: 'codex-cli 0.163.0-alpha.11.1', model: ASTRA_PIXEL_MODEL })
  assert.deepEqual(await runCodexNative({ model: ASTRA_PIXEL_MODEL, pixelTools: { call() {} } }, astra.dependencies), {
    status: 'ready', provider: 'codex', model: ASTRA_PIXEL_MODEL, turnStartRequests: 0,
  })
  assert.equal(astra.requests.some(request => request.method === 'turn/start'), false)
  const rejected = fixture({ version: 'codex-cli 0.161.0' })
  await assert.rejects(runCodexNative({ image: true }, rejected.dependencies), { code: 'assistant_version_unverified' })
  assert.equal(rejected.requests.length, 0)
})

test('missing account, model, or changed binary fails closed without starting a turn', async () => {
  for (const [options, code] of [
    [{ account: 'apiKey' }, 'assistant_login_required'],
    [{ model: 'other' }, 'assistant_model_unavailable'],
    [{ version: 'codex-cli 0.142.2' }, 'assistant_version_unverified'],
  ]) {
    const f = fixture(options)
    await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), { code })
    assert.equal(f.requests.some(r => r.method === 'turn/start'), false)
  }
})

test('invalid input and already-cancelled requests spawn nothing', async () => {
  const f = fixture()
  for (const message of ['', null, 'a'.repeat(6001)]) {
    await assert.rejects(runCodexAssistant({ message }, f.dependencies), { code: 'invalid_assistant_message' })
  }
  await assert.rejects(runCodexAssistant({ threadId: '../path' }, f.dependencies), { code: 'invalid_assistant_thread' })
  await assert.rejects(runCodexAssistant({ signal: AbortSignal.abort() }, f.dependencies), { code: 'assistant_cancelled' })
  assert.equal(f.calls.length, 0)
})

test('RPC errors expose neither provider error text nor credentials and are not retried', async () => {
  const f = fixture({ intercept: ({ request, send }) => {
    if (request.method !== 'turn/start') return false
    send({ id: request.id, error: { message: 'SECRET token=private' } })
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), error => {
    assert.equal(error.code, 'assistant_request_failed')
    assert.equal(error.message.includes('SECRET'), false)
    return true
  })
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
})

test('server tool requests are refused and end the supervised process', async () => {
  const f = fixture({ intercept: ({ request, send }) => {
    if (request.method !== 'turn/start') return false
    send({ id: 900, method: 'item/commandExecution/requestApproval', params: {} })
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), { code: 'assistant_tool_blocked' })
  assert.equal(f.children[1].killed, true)
  assert.equal(f.requests.find(r => r.id === 900).error.code, -32601)
})

test('tool execution notifications cannot be mistaken for a text response', async () => {
  const f = fixture({ intercept: ({ request, send }) => {
    if (request.method !== 'turn/start') return false
    send({ method: 'item/started', params: { threadId: 'thread-1', item: { type: 'commandExecution' } } })
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), { code: 'assistant_tool_blocked' })
})

test('cancelled in-flight requests terminate without sending another turn', async () => {
  const controller = new AbortController()
  const f = fixture({ intercept: ({ request }) => {
    if (request.method !== 'turn/start') return false
    controller.abort()
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'hello', signal: controller.signal }, f.dependencies), { code: 'assistant_cancelled' })
  assert.equal(f.children[1].killed, true)
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
})

test('Astra cancellation retains the latest argument rejection without retry or raw parameters', async () => {
  const controller = new AbortController(), session = createPixelToolSession({ rgba: new Uint8Array(64 * 64 * 4), signal: controller.signal })
  const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, child }) {
    if (request.method === 'turn/start') {
      child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
        { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'bad', namespace: null,
          tool: 'draw_pixels', arguments: { operations: [{ type: 'fill-rect', rect: { x: 63, y: 0, w: 2, h: 1 }, color: [1, 2, 3, 255], private: 'private-secret' }] } } },
      ].map(JSON.stringify).join('\n') + '\n')
      return true
    }
    if (request.id === 300) { assert.equal(request.result.success, false); controller.abort(); return true }
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', signal: controller.signal, pixelTools: session }, f.dependencies), error => {
    assert.equal(error.code, 'assistant_cancelled')
    assert.equal(error.diagnostic.rule, 'internal')
    assert.equal(error.diagnostic.terminal, true)
    assert.deepEqual(error.diagnostic.last_argument_rejection, { tool: 'draw_pixels', rule: 'argument_shape', operation_index: 0,
      field: 'operations[0]', issue: 'unexpected_field', expected: 'operation_fill-rect' })
    assert.equal(error.diagnostic.calls, 1)
    assert.equal(error.diagnostic.drawing_batches, 0)
    assert.equal(error.diagnostic.argument_corrections, 1)
    assert.equal(JSON.stringify(error.diagnostic).includes('private-secret'), false)
    assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) <= 1024)
    return true
  })
  assert.equal(f.children[1].killed, true)
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
})

test('an existing terminal diagnostic does not hide the latest argument rejection', async () => {
  let stale = false
  const session = createPixelToolSession({ rgba: new Uint8Array(64 * 64 * 4), checkCurrent: async () => {
    if (stale) throw Object.assign(new Error('private-secret'), { code: 'assistant_context_changed',
      diagnostic: { reason: 'authorization', rule: 'turn_identity', terminal: true } })
  } })
  await assert.rejects(session.call('draw_pixels', { operations: [{ type: 'fill-rect', rect: { x: 1, y: 1, w: 1, h: 1 }, color: [1, 2, 3, 128] }] }))
  stale = true
  const f = fixture({ model: ASTRA_PIXEL_MODEL, intercept({ request, send, child }) {
    if (request.method !== 'turn/start') return false
    child.stdout.write([{ id: request.id, result: { turn: { id: 'turn-1' } } },
      { id: 300, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'stale', namespace: null, tool: 'read_canvas', arguments: {} } },
    ].map(JSON.stringify).join('\n') + '\n')
    return true
  } })
  await assert.rejects(runCodexAssistant({ message: 'draw', pixelTools: session }, f.dependencies), error => {
    assert.equal(error.code, 'assistant_context_changed')
    assert.equal(error.diagnostic.rule, 'turn_identity')
    assert.deepEqual(error.diagnostic.last_argument_rejection, { tool: 'draw_pixels', rule: 'alpha', operation_index: 0,
      field: 'operations[0].color', issue: 'invalid_value', expected: 'rgba' })
    assert.equal(error.diagnostic.calls, 2)
    assert.equal(JSON.stringify(error.diagnostic).includes('private-secret'), false)
    return true
  })
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
})

test('structured-reply violations still fail closed', async () => {
    const f = fixture({ intercept: ({ request, send, child, respond }) => {
      if (request.method !== 'turn/start') return false
        respond({ turn: { id: 'turn-1' } })
        setImmediate(() => {
          send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: '{"reply":"ok","command":"unsafe"}' } } })
          send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: 'completed' } } })
        })
      return true
    } })
    await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), { code: 'assistant_response_failed' })
})

test('Astra and Codex stream verbose progress and long replies without output-length rejection', async () => {
  const reply = '火苗说明。'.repeat(4000)
  for (const model of [CODEX_ASSISTANT_MODEL, ASTRA_PIXEL_MODEL]) {
    const f = fixture({ model, intercept: ({ request, send, child, respond }) => {
      if (request.method !== 'turn/start') return false
      respond({ turn: { id: 'turn-1' } })
      child.stderr.write('diagnostic'.repeat(8000))
      for (let i = 0; i < 20; i++) send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: 'x'.repeat(65536) } })
      send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'agentMessage', text: JSON.stringify({ reply }) } } })
      send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: 'completed' } } })
      return true
    } })
    assert.equal((await runCodexAssistant({ message: 'hello', model }, f.dependencies)).reply, reply)
    assert.ok(f.calls.at(-1).args.includes('--max-rss-mib'))
  }
})

test('resource-guard failure cannot be reported as a completed response', async () => {
  for (const closeCode of [124, 125, 137, 70]) {
    const f = fixture({ closeCode })
    await assert.rejects(runCodexAssistant({ message: 'hello' }, f.dependencies), { code: 'assistant_unavailable' })
  }
})

test('Chinese text split between UTF-8 stream chunks is preserved', async () => {
  const f = fixture({ intercept: ({ request, respond, child, send }) => {
    if (request.method !== 'turn/start') return false
    respond({ turn: { id: 'turn-1' } })
    setImmediate(() => {
      const bytes = Buffer.from(JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1',
        item: { type: 'agentMessage', text: JSON.stringify({ reply: '连接成功' }) } } }) + '\n')
      for (const byte of bytes) child.stdout.write(Buffer.from([byte]))
      send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: 'completed' } } })
    })
    return true
  } })
  assert.equal((await runCodexAssistant({ message: 'hello' }, f.dependencies)).reply, '连接成功')
})

test('malformed JSON values and colliding server request IDs are rejected', async () => {
  for (const malformed of [true, false]) {
    const f = fixture({ intercept: ({ request, send }) => {
      if (request.method !== 'initialize') return false
      send(malformed ? null : { id: request.id, method: 'tool/call', params: {} })
      return true
    } })
    await assert.rejects(runCodexAssistant({}, f.dependencies), {
      code: malformed ? 'assistant_invalid_protocol' : 'assistant_tool_blocked',
    })
  }
})


test('Astra ordinary text uses its own model and resumes a tool-free discussion', async () => {
  for (const threadId of [null, 'thread-1']) {
    const f = fixture({ model: ASTRA_PIXEL_MODEL })
    const result = await runCodexAssistant({ message: 'Hello; let us discuss this idea.', model: ASTRA_PIXEL_MODEL, threadId }, f.dependencies)
    assert.equal(result.model, ASTRA_PIXEL_MODEL)
    assert.ok(f.calls[1].args.includes(`model="${ASTRA_PIXEL_MODEL}"`))
    const request = f.requests.find(r => r.method === (threadId ? 'thread/resume' : 'thread/start')).params
    assert.equal(request.model, ASTRA_PIXEL_MODEL)
    assert.equal(request.approvalPolicy, 'never')
    assert.equal(request.sandbox, 'read-only')
    assert.equal(request.allowProviderModelFallback, false)
    if (!threadId) { assert.deepEqual(request.dynamicTools, []); assert.equal(request.ephemeral, false) }
    assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1)
  }
  const f = fixture()
  await assert.rejects(runCodexAssistant({ message: 'hello', model: 'arbitrary' }, f.dependencies), { code: 'invalid_assistant_message' })
  assert.equal(f.calls.length, 0)
})


test('composer action replies retain their schema while Astra chats read-only on its persistent thread', async () => {
  const reply = { reply: 'Let us discuss the color first.', action: null }
  const f = fixture({ model: ASTRA_PIXEL_MODEL, reply })
  const result = await runCodexAssistant({ message: 'Continue', model: ASTRA_PIXEL_MODEL, composerActions: true, threadId: 'thread-1' }, f.dependencies)
  assert.deepEqual(JSON.parse(result.reply), reply)
  const turn = f.requests.find(r => r.method === 'turn/start').params
  assert.deepEqual(turn.outputSchema.required, ['reply', 'action'])
  assert.ok(f.requests.some(r => r.method === 'thread/resume'))
  assert.equal(f.requests.some(r => r.method === 'item/tool/call'), false)
})


test('native composer schema carries only the explicitly selected Skill', async () => {
  for (const composerPresetId of [null, 'fixed-region-motion']) {
    const action = composerPresetId ? { type: 'use_preset', instruction: 'A knight.', preset_id: composerPresetId, reference: false } : { type: 'edit_document', instruction: 'Draw a flame animation.' }
    const reply = { reply: 'Drawing.', action }
    const f = fixture({ model: ASTRA_PIXEL_MODEL, reply })
    const result = await runCodexAssistant({ message: 'Draw', model: ASTRA_PIXEL_MODEL, composerActions: true, composerPresetId }, f.dependencies)
    assert.deepEqual(JSON.parse(result.reply), reply)
    const variants = f.requests.find(r => r.method === 'turn/start').params.outputSchema.properties.action.anyOf
    const preset = variants.find(v => v.properties?.type.enum[0] === 'use_preset')
    if (composerPresetId) assert.deepEqual(preset.properties.preset_id.enum, [composerPresetId])
    else assert.equal(preset, undefined)
  }
})
