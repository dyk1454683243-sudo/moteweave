import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parsePixelDrawing, renderPixelDrawing, validatePixelDrawing } from '../../src/editor-project/pixelDrawing.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'

const drawing = { size: 32, palette: ['#ff0000ff', '#abcdef00'], rects: [[1, 2, 3, 4, 0], [2, 3, 1, 1, 1]] }
test('bounded pixel data renders exact ordered pixels and preserves untouched edit pixels', () => {
  const original = Buffer.alloc(32 * 32 * 4, 255)
  const rgba = renderPixelDrawing(drawing, 32, original)
  assert.deepEqual([...rgba.slice((2 * 32 + 1) * 4, (2 * 32 + 1) * 4 + 4)], [255, 0, 0, 255])
  assert.deepEqual([...rgba.slice((3 * 32 + 2) * 4, (3 * 32 + 2) * 4 + 4)], [0, 0, 0, 0])
  assert.deepEqual([...rgba.slice(0, 4)], [255, 255, 255, 255])
  assert.ok(original.every(v => v === 255))
  const result = parsePixelDrawing(JSON.stringify({ reply: '画好了', drawing }), 32)
  assert.deepEqual(result.drawing, drawing)
  assert.deepEqual(parsePixelDrawing('{"reply":"哪里？","drawing":null}', 32).drawing, null)
  assert.throws(() => renderPixelDrawing(drawing, 32, rgba), { code: 'pixel_no_change' })
  assert.throws(() => renderPixelDrawing({ ...drawing, rects: [[0, 0, 32, 32, 1]] }, 32), { code: 'pixel_no_change' })
})

test('drawing commentary has no character cap while pixel-operation bounds remain enforced', () => {
  const reply = 'Description. '.repeat(2000)
  assert.equal(parsePixelDrawing(JSON.stringify({ reply, drawing }), 32).reply, reply)
})

test('pixel data rejects paths, extra keys, noninteger or outside pixels, alpha and excessive operations', () => {
  for (const value of [
    { ...drawing, path: '/private' }, { ...drawing, size: 64 }, { ...drawing, palette: ['#ffff007f'] },
    { ...drawing, rects: [[31, 0, 2, 1, 0]] }, { ...drawing, rects: [[0, 0, 1.5, 1, 0]] },
    { ...drawing, rects: [[0, 0, 1, 1, 2]] }, { ...drawing, rects: Array(513).fill([0, 0, 1, 1, 0]) },
  ]) assert.throws(() => validatePixelDrawing(value, 32), { code: 'assistant_response_failed' })
  for (const text of ['```json\n{}\n```', 'x'.repeat(12001), JSON.stringify({ reply: 'x', drawing, code: 'bad' })]) {
    assert.throws(() => parsePixelDrawing(text, 32), { code: 'assistant_response_failed' })
  }
})

function fixture({ changeDuringRead = false, badOutput = false } = {}) {
  const calls = []
  const project = { id: 'p', version: 'editor_project_v1', revision: 2,
    canvases: { c: { id: 'c', document_id: 'd' } }, sprite_documents: { d: { working_revision: 3 } } }
  const manifest = { revision: 3, canvas: { w: 32, h: 32 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: {} }, cels: { c: { block: { w: 32, h: 32, sha256: 'host-block' } } } }
  const service = createAssistantConversations({ load: async () => ({ project }),
    readDocument: async () => ({ manifest }), readBlock: async input => {
      assert.equal(input.documentId, 'd'); assert.equal(input.sha256, 'host-block')
      if (changeDuringRead) project.revision++
      return { bytes: Buffer.alloc(32 * 32 * 4, 255) }
    }, adapters: { codex: async request => {
      calls.push(request)
      return { reply: badOutput ? '{"reply":"x","drawing":{"code":"bad"}}' : JSON.stringify({ reply: '像素绘制', drawing }),
        threadId: 'native', status: 'completed', provider: 'codex', model: 'gpt-6.1-sol' }
    } } })
  return { calls, project, service, scope: { projectId: 'p', workspaceRoot: '/private/not-sent' },
    body: { operation_id: randomUUID(), message: 'x'.repeat(4000), expected_revision: 2, canvas_id: 'c', expected_working_revision: 3,
      pixel_drawing: { size: 32, kind: 'edit', reference: true } } }
}

test('drawing uses only server-bound saved pixels, fixed model and fresh no-tools turns with idempotency', async () => {
  const f = fixture()
  const { conversation } = await f.service.open(f.scope, { provider: 'codex' })
  const body = { ...f.body, conversation }
  const result = await f.service.send(f.scope, body)
  assert.deepEqual(result.pixel_drawing, drawing)
  assert.deepEqual(await f.service.send(f.scope, body), result)
  await f.service.send(f.scope, { ...body, operation_id: randomUUID() })
  assert.equal(f.calls.length, 2)
  for (const request of f.calls) {
    assert.equal(request.pixelDrawing, true); assert.equal(request.threadId, null)
    assert.match(request.referenceDataUrl, /^data:image\/png;base64,/)
    assert.ok(request.message.length <= 6000, `input length ${request.message.length}`)
    assert.ok(!request.message.includes('/private'))
  }
  assert.equal(f.project.revision, 2)
})

test('drawing rejects changed source and unsupported providers before any external call', async () => {
  const f = fixture({ changeDuringRead: true })
  const { conversation } = await f.service.open(f.scope, { provider: 'codex' })
  await assert.rejects(f.service.send(f.scope, { ...f.body, conversation }), { code: 'assistant_context_changed' })
  assert.equal(f.calls.length, 0)
  for (const provider of ['grok', 'antigravity']) {
    const g = fixture(), opened = await g.service.open(g.scope, { provider })
    await assert.rejects(g.service.send(g.scope, { ...g.body, conversation: opened.conversation }), { code: 'assistant_drawing_unavailable' })
    assert.equal(g.calls.length, 0)
  }
  const g = fixture({ badOutput: true }), opened = await g.service.open(g.scope, { provider: 'codex' })
  await assert.rejects(g.service.send(g.scope, { ...g.body, conversation: opened.conversation }), { code: 'assistant_response_failed' })
  await assert.rejects(g.service.send(g.scope, { ...g.body, conversation: opened.conversation }), { code: 'assistant_response_failed' })
  assert.equal(g.calls.length, 1)
  assert.equal((await g.service.history(g.scope, 'codex')).blocked, false,
    'A completed but invalid drawing is a definite failure, not an unknown call')
  await assert.rejects(g.service.send(g.scope, { ...g.body, operation_id: randomUUID(), conversation: opened.conversation }), { code: 'assistant_response_failed' })
  assert.equal(g.calls.length, 2, 'Only a new explicit operation calls the adapter again')
})
