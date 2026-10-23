import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { runAntigravityImage, readNativeImage, prepareNativeImage, assertImageConfiguration, IMAGE_AGENT, IMAGE_WORKDIR, IMAGE_MODEL } from '../../src/editor-project/imageAntigravity.js'
import { createImageGeneration } from '../../src/editor-project/imageGeneration.js'

const id = '12345678-1234-4234-8234-123456789abc'
const config = { status: 'SUCCESS', num_turns: 0, command: { name: 'config', data: { config: { useG1Credits: false, modelProvider: '' } } } }
const hooks = { status: 'SUCCESS', num_turns: 0, command: { name: 'hooks', data: { hooks: [] } } }
function fixture(override = {}) {
  const calls = [], prompts = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { queueMicrotask(() => child.emit('close', 143)); return true }
    const send = event => child.stdout.write(JSON.stringify(event) + '\n')
    child.stdin = new Writable({ write(chunk, encoding, done) {
      prompts.push(JSON.parse(chunk.toString()))
      queueMicrotask(() => {
        send({ event: 'step_update', step_update: { conversation_id: id, step_type: 'tool', tool_name: override.tool || 'generate_image', step_index: 1 } })
        if (override.extraTool) send({ event: 'step_update', step_update: { conversation_id: id, step_type: 'tool', tool_name: 'generate_image', step_index: 2 } })
        send({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', num_turns: 1, response: '/native/output.jpg' } })
        child.emit('close', 0)
      }); done()
    } })
    queueMicrotask(() => {
      const value = args.includes('--version') ? '1.2.14' : args.includes('/config') ? JSON.stringify(override.config || config) : args.includes('/hooks') ? JSON.stringify(hooks) : null
      if (value) { child.stdout.write(value); child.emit('close', 0) }
      else send({ event: 'init', conversation_id: id, init: { agent: IMAGE_AGENT, cwd: IMAGE_WORKDIR, model: IMAGE_MODEL, permission_mode: 'request-review' } })
    })
    return child
  }
  return { calls, prompts, dependencies: { spawnImpl, prepareProfile: async () => {}, readImage: async () => ({ bytes: Buffer.from('jpeg'), mimeType: 'image/jpeg' }) } }
}
test('native image uses one private stdin prompt, guarded official CLI and no API override', async () => {
  const f = fixture()
  const result = await runAntigravityImage({ description: 'private guard', operationId: id }, f.dependencies)
  assert.equal(result.mimeType, 'image/jpeg'); assert.equal(result.observedToolCalls, 1)
  assert.equal(f.calls.length, 4); assert.equal(f.prompts.length, 1)
  assert.equal(JSON.stringify(f.calls).includes('private guard'), false)
  for (const call of f.calls) {
    assert.ok(call.args.includes('1536')); assert.ok(call.args.includes('--timeout-ms'))
    assert.equal(call.options.env.GEMINI_API_KEY, undefined)
    assert.equal(call.args.includes('--conversation'), false)
  }
  assert.equal(result.useG1Credits, false)
})
test('native image blocks credit fallback, other tools and extra observed calls without retry', async () => {
  assert.throws(() => assertImageConfiguration({ ...config, command: { name: 'config', data: { config: { useG1Credits: true, modelProvider: '' } } } }), { code: 'image_credits_blocked' })
  for (const [options, code, count] of [[{ config: {} }, 'image_credits_blocked', 2], [{ tool: 'run_command' }, 'image_tool_blocked', 4], [{ extraTool: true }, 'image_tool_limit', 4]]) {
    const f = fixture(options)
    await assert.rejects(runAntigravityImage({ description: 'guard', operationId: id }, f.dependencies), { code })
    assert.equal(f.calls.length, count)
  }
})
test('native artifact reader accepts original PNG/JPEG and rejects foreign or linked output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-image-test-'))
  const dir = path.join(root, id); await mkdir(dir)
  const startedAt = Date.now()
  for (const format of ['png', 'jpeg']) {
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'red' } })[format]().toBuffer()
    const file = path.join(dir, `guard_1.${format === 'jpeg' ? 'jpg' : 'png'}`)
    await writeFile(file, bytes)
    const output = await readNativeImage({ brainRoot: root, conversationId: id, imageName: 'guard', startedAt, response: file })
    assert.deepEqual(output.bytes, bytes); assert.equal(output.width, 4)
  }
  const target = path.join(root, 'outside.png'); await writeFile(target, 'not image')
  const link = path.join(dir, 'linked_1.png'); await symlink(target, link)
  await assert.rejects(readNativeImage({ brainRoot: root, conversationId: id, imageName: 'linked', startedAt, response: link }), { code: 'image_unsafe_output' })
  await assert.rejects(readNativeImage({ brainRoot: root, conversationId: id, imageName: 'guard', startedAt, response: target }), { code: 'image_unsafe_output' })
})
test('image jobs are project-scoped, bounded, single-run and keep receipts for identical replay', async () => {
  let calls = 0, resolve
  const image = { bytes: Buffer.from('original'), mimeType: 'image/jpeg', width: 1, height: 1 }
  const service = createImageGeneration({ load: async () => ({ project: { version: 'editor_project_v1' } }), installed: async () => true, maxJobs: 1,
    generate: async () => { calls++; return new Promise(r => { resolve = r }) } })
  const scope = { projectId: 'p', workspaceRoot: '/tmp/workspace' }
  const request = { operation_id: id, description: 'guard' }
  const a = await service.start(scope, request)
  assert.equal((await service.start(scope, request)).id, a.id)
  await assert.rejects(service.start(scope, { ...request, description: 'other' }), { code: 'image_operation_conflict' })
  await assert.rejects(service.status({ ...scope, projectId: 'other' }, id), { code: 'image_not_found' })
  await assert.rejects(service.start(scope, { ...request, operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), { code: 'image_busy' })
  resolve(image); await new Promise(r => setImmediate(r))
  const done = await service.status(scope, id)
  assert.equal(done.status, 'done'); assert.equal(done.mime_type, 'image/jpeg')
  assert.equal((await service.source(scope, id)).provenance.provider, 'antigravity')
  await service.start(scope, request); assert.equal(calls, 1)
  await assert.rejects(service.start(scope, { ...request, operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), { code: 'image_session_full' })
})

test('native oversized output fits without cropping, keeps alpha/orientation and exact original bytes', async () => {
  for (const spec of [
    { width: 1254, height: 1254, format: 'png', orientation: 1, expected: [1024, 1024] },
    { width: 1536, height: 768, format: 'png', orientation: 1, expected: [1024, 512] },
    { width: 1536, height: 768, format: 'jpeg', orientation: 6, expected: [512, 1024] },
  ]) {
    let pipeline = sharp({ create: { width: spec.width, height: spec.height, channels: 4, background: { r: 0, g: 100, b: 0, alpha: 0.5 } } })
    if (spec.orientation !== 1) pipeline = pipeline.withMetadata({ orientation: spec.orientation })
    const bytes = await pipeline[spec.format]().toBuffer()
    const result = await prepareNativeImage(bytes)
    assert.deepEqual([result.width, result.height], spec.expected)
    assert.equal(result.mimeType, 'image/png')
    assert.deepEqual(result.original.bytes, bytes)
    assert.equal(result.original.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(result.transformation.kernel, 'nearest')
    const decoded = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true })
    assert.equal(decoded.info.channels, 4)
    if (spec.format === 'png') assert.equal(decoded.data[3], 128)
    else assert.deepEqual([result.original.width, result.original.height], [768, 1536])
  }
  const small = await sharp({ create: { width: 32, height: 16, channels: 3, background: 'red' } }).jpeg().toBuffer()
  const unchanged = await prepareNativeImage(small)
  assert.deepEqual(unchanged.bytes, small)
  assert.equal(unchanged.original, undefined)
  assert.deepEqual([unchanged.width, unchanged.height], [32, 16])
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
  await assert.rejects(prepareNativeImage(tooWide), { code: 'image_unsupported_output' })
  await assert.rejects(prepareNativeImage(Buffer.alloc(8 * 1024 * 1024 + 1)), { code: 'image_output_limit' })
  await assert.rejects(prepareNativeImage(small.subarray(0, small.length - 50)))
})
