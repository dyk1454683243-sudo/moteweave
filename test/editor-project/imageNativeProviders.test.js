import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { runCodexImage } from '../../src/editor-project/imageCodex.js'
import { CODEX_ASSISTANT_PROFILE } from '../../src/editor-project/assistantCodex.js'
import { createGrokImageReceipt, grokImageArguments } from '../../src/editor-project/imageGrok.js'
import { createImageGeneration } from '../../src/editor-project/imageGeneration.js'

const id = '12345678-1234-4234-8234-123456789abc'
test('Codex image reads only the exact native thread/call artifact and never assistant text paths', async () => {
  const file = path.join(CODEX_ASSISTANT_PROFILE, 'generated_images', id, 'call_1.png')
  let reads = 0
  const native = { threadId: id, imageCallId: 'call_1', savedPath: file, observedToolCalls: 1 }
  const deps = { runNative: async input => { assert.equal(input.image, true); assert.match(input.message, /image_gen.imagegen/); return native },
    readImage: async input => { reads++; assert.equal(input.file, file); return { bytes: Buffer.from('png'), mimeType: 'image/png', width: 1, height: 1 } } }
  assert.equal((await runCodexImage({ operationId: id, description: 'guard' }, deps)).provider, 'codex')
  native.savedPath = '/tmp/other.png'
  await assert.rejects(runCodexImage({ operationId: id, description: 'guard' }, deps), { code: 'image_unsafe_output' })
  assert.equal(reads, 1)
})

test('Grok image permissions allow only image_gen and receipts bind a single tool and native session', () => {
  const args = grokImageArguments('/private/prompt.txt', id)
  for (const value of ['dontAsk', 'image_gen', '--no-auto-update', '--no-subagents', '--disable-web-search']) assert.ok(args.includes(value))
  assert.equal(args[args.indexOf('--tools') + 1], 'image_gen')
  assert.equal(args[args.indexOf('--session-id') + 1], id)
  const receipt = createGrokImageReceipt(id)
  const value = { type: 'ImageGen', path: '/native/images/1.jpg', filename: '1.jpg', session_folder: 'images' }
  receipt.consume({ type: 'thought', data: 'native progress' })
  receipt.consume({ type: 'available_commands', commands: [] })
  receipt.consume({ type: 'tool_call', toolName: 'image_gen', toolCallId: 'image-1' })
  assert.equal(receipt.consume({ type: 'tool_call_update', toolCallId: 'image-1', status: 'completed', rawOutput: value }), true)
  assert.deepEqual(receipt.result(), value)
  receipt.consume({ type: 'end', sessionId: id, stopReason: 'end_turn', num_turns: 1 })
  assert.deepEqual(receipt.result(), value)
  for (const event of [
    { type: 'tool_call', toolName: 'read_file', toolCallId: 'bad' },
    { type: 'tool_call_update', toolCallId: 'other', status: 'completed', rawOutput: value },
    { type: 'end', sessionId: 'other', stopReason: 'end_turn', num_turns: 1 },
  ]) assert.throws(() => createGrokImageReceipt(id).consume(event))
  const twice = createGrokImageReceipt(id)
  twice.consume({ type: 'tool_call', toolName: 'image_gen', toolCallId: 'one' })
  assert.throws(() => twice.consume({ type: 'tool_call', toolName: 'image_gen', toolCallId: 'two' }), { code: 'image_tool_limit' })
})

test('each selected native provider is fingerprint-bound with trusted provenance and no fallback', async () => {
  const calls = []
  const providers = Object.fromEntries(['codex', 'grok', 'antigravity'].map(provider => [provider, {
    enabled: true, installed: async () => true, generate: async () => { calls.push(provider); return { bytes: Buffer.from('png'), mimeType: 'image/png', width: 1, height: 1 } },
  }]))
  const service = createImageGeneration({ providers, load: async () => ({ project: { version: 'editor_project_v1' } }) })
  const scope = { workspaceRoot: '/tmp/native-image', projectId: 'project' }
  const capability = await service.capabilities(scope)
  assert.equal(capability.providers.length, 3)
  assert.equal(capability.providers.find(x => x.provider === 'grok').extra_credits, 'native_account_policy')
  for (const [index, provider] of ['codex', 'grok', 'antigravity'].entries()) {
    const operation_id = id.slice(0, -1) + index
    const request = { operation_id, provider, description: 'guard' }
    await service.start(scope, request)
    await new Promise(resolve => setImmediate(resolve))
    const status = await service.status(scope, operation_id)
    assert.equal(status.status, 'done'); assert.equal(status.provider, provider)
    assert.equal((await service.source(scope, operation_id)).provenance.provider, provider)
    await service.start(scope, request)
    await assert.rejects(service.start(scope, { ...request, provider: provider === 'codex' ? 'grok' : 'codex' }), { code: 'image_operation_conflict' })
  }
  assert.deepEqual(calls, ['codex', 'grok', 'antigravity'])
  for (const provider of ['unknown', 'toString', null]) await assert.rejects(service.start(scope, { operation_id: id, provider, description: 'guard' }), { code: 'invalid_image_request' })
})

test('Codex is enabled with an explicit reference capability; unsupported providers never drop a reference', async () => {
  let calls = 0
  const service = createImageGeneration({ load: async () => ({ project: { version: 'editor_project_v1' } }),
    providers: { codex: { installed: async () => true, generate: async () => { calls++ } } } })
  const scope = { workspaceRoot: '/tmp/native-image', projectId: 'project' }
  const choice = (await service.capabilities(scope)).providers.find(x => x.provider === 'codex')
  assert.equal(choice.available, true); assert.equal(choice.reference_upload, true)
  const reference = { canvas_id: 'canvas', document_id: 'doc', expected_revision: 2, working_revision: 1 }
  await assert.rejects(service.start(scope, { operation_id: id, description: 'guard', provider: 'grok', reference }), { code: 'image_reference_unsupported' })
  assert.equal(calls, 0)
})

test('reference pixels bind saved project/canvas/version; replay and stale references cannot invoke again', async () => {
  const project = { id: 'project', version: 'editor_project_v1', revision: 2,
    canvases: { canvas: { document_id: 'doc' } }, sprite_documents: { doc: { working_revision: 1 } } }
  let calls = 0, input
  const service = createImageGeneration({ load: async () => ({ project }),
    readDocument: async () => ({ manifest: { revision: 1, canvas: { w: 1, h: 1 }, frame_order: ['f'], layer_order: ['l'], cels: { c: { block: { w: 1, h: 1, sha256: 'hash' } } } } }),
    readBlock: async () => ({ bytes: Buffer.from([255, 0, 0, 255]) }),
    providers: { codex: { generate: async args => { calls++; input = args; return { bytes: Buffer.from('png'), mimeType: 'image/png' } } } } })
  const scope = { workspaceRoot: '/tmp/ref', projectId: 'project' }
  const reference = { canvas_id: 'canvas', document_id: 'doc', expected_revision: 2, working_revision: 1 }
  const request = { operation_id: id, description: 'redraw', provider: 'codex', reference }
  await service.start(scope, request)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.status(scope, id)).status, 'done')
  assert.equal(input.reference.mimeType, 'image/png'); assert.equal(input.reference.bytes.toString('hex', 0, 8), '89504e470d0a1a0a')
  project.revision = 3
  await service.start(scope, request)
  assert.equal(calls, 1)
  await assert.rejects(service.start(scope, { ...request, reference: { ...reference, canvas_id: 'other' } }), { code: 'image_operation_conflict' })
  const another = id.slice(0, -1) + 'd'
  await service.start(scope, { ...request, operation_id: another })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.status(scope, another)).reason, 'image_reference_changed')
  assert.equal(calls, 1)
  await assert.rejects(service.start(scope, { ...request, reference: { ...reference, path: '/private/file' } }), { code: 'invalid_image_request' })
  project.revision = 2; project.canvases.canvas.document_id = 'other'
  const third = id.slice(0, -1) + 'e'
  await service.start(scope, { ...request, operation_id: third }); await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.status(scope, third)).reason, 'image_reference_changed'); assert.equal(calls, 1)
})

test('Codex reference is passed as a single inline PNG, not a native filesystem path', async () => {
  let input
  const native = { threadId: id, imageCallId: 'ref', savedPath: path.join(CODEX_ASSISTANT_PROFILE, 'generated_images', id, 'ref.png') }
  await runCodexImage({ operationId: id, description: 'redraw', reference: { bytes: Buffer.from('png'), mimeType: 'image/png' } }, {
    runNative: async args => { input = args; return native }, readImage: async () => ({ bytes: Buffer.from('output') }),
  })
  assert.equal(input.referenceDataUrl, 'data:image/png;base64,cG5n')
  assert.match(input.message, /num_last_images_to_include: 1/)
  assert.match(input.message, /Never use referenced_image_paths/)
})
