import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAssistantConversations, ASSISTANT_MODELS } from '../../src/editor-project/assistantConversation.js'
import { parsePixelEditProposal, PIXEL_PROPOSAL_INSTRUCTIONS } from '../../src/editor-project/pixelEditProposal.js'

const fill = { type: 'fill-rect', rect: { x: 0, y: 0, w: 2, h: 2 }, color: [255, 0, 0, 255] }
test('proposal commentary has no character cap while operation validation remains enforced', () => {
  const reply = 'Description. '.repeat(2000)
  assert.equal(parsePixelEditProposal(JSON.stringify({ reply, operation: fill }), 8, 8).reply, reply)
})

test('strict proposal parser accepts three operations and clarification, rejects extra authority and bounds', () => {
  for (const operation of [null, fill, { type: 'erase', rect: fill.rect },
    { type: 'replace-color', rect: fill.rect, from: [1, 2, 3, 255], to: [0, 0, 0, 0] }]) {
    assert.deepEqual(parsePixelEditProposal(JSON.stringify({ reply: 'proposal', operation }), 2, 2), { reply: 'proposal', operation })
  }
  for (const value of [
    { reply: 'x', operation: fill, target: '/private' },
    { reply: 'x', operation: { ...fill, path: '/tmp/image.png' } },
    { reply: 'x', operation: { ...fill, rect: { x: 1, y: 0, w: 2, h: 2 } } },
    { reply: 'x', operation: [fill] }, { reply: 'x', operation: { ...fill, color: [0, 0, 0, 256] } },
  ]) assert.throws(() => parsePixelEditProposal(JSON.stringify(value), 2, 2), { code: 'assistant_response_failed' })
  assert.throws(() => parsePixelEditProposal('```json\n{}\n```', 2, 2), { code: 'assistant_response_failed' })
  assert.match(PIXEL_PROPOSAL_INSTRUCTIONS, /clarification/)
})

test('all three adapters use server-bound dimensions and one parsed proposal; no source bytes or target authority sent', async () => {
  const calls = []
  const project = { id: 'project_a', version: 'editor_project_v1', revision: 2,
    canvases: { c_a: { id: 'c_a', document_id: 'd_a' } }, sprite_documents: { d_a: { working_revision: 3 } } }
  const manifest = { revision: 3, canvas: { w: 2, h: 2 }, frame_order: ['f'], layer_order: ['l'] }
  // Astra is a native-tool session, not a one-shot pixel-proposal adapter.
  const adapters = Object.fromEntries(['grok', 'codex', 'antigravity'].map(provider => [provider, async request => {
    calls.push({ provider, ...request })
    return { reply: JSON.stringify({ reply: '提议填成红色。', operation: fill }), threadId: 'native', status: 'completed',
      provider, model: ASSISTANT_MODELS[provider], requestedModel: ASSISTANT_MODELS[provider], naturalExit: true }
  }]))
  const service = createAssistantConversations({ load: async () => ({ project }),
    readDocument: async request => { assert.equal(request.documentId, 'd_a'); assert.equal(request.revision, 3); return { manifest } }, adapters })
  const scope = { projectId: project.id, workspaceRoot: '/not-sent' }
  for (const provider of Object.keys(adapters)) {
    const { conversation } = await service.open(scope, { provider })
    const body = { conversation, operation_id: randomUUID(), message: 'a'.repeat(4000), expected_revision: 2,
      canvas_id: 'c_a', expected_working_revision: 3 }
    const result = await service.send(scope, body)
    assert.equal(result.context.width, 2); assert.equal(result.context.working_revision, 3)
    assert.deepEqual(result.pixel_edit, fill)
    assert.deepEqual(await service.send(scope, body), result)
    await assert.rejects(service.send(scope, { ...body, expected_working_revision: 2 }), { code: 'assistant_operation_conflict' })
    await assert.rejects(service.send(scope, { ...body, operation_id: randomUUID(), expected_working_revision: 2 }), { code: 'assistant_context_changed' })
  }
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.pixelProposal, true)
    assert.ok(call.message.length <= 6000, `adapter input ${call.message.length} exceeds fixed limit`)
    assert.ok(!call.message.includes('/not-sent'))
    assert.match(call.message, /"width":2/)
  }
})
