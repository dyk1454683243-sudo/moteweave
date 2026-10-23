import test from 'node:test'
import { editorFetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { handleEditorProjectApi } from '../../src/editor-project/apiHandler.js'
import { createEditorArtifactAccessRegistry } from '../../src/editor-project/index.js'
import { createBlankSpriteDocument, createEditorProjectV1, encodeRgbaPng } from '../../src/editor-project/spriteDocumentStore.js'
import { parseCreateBlankRequest, validateSpriteDocument, sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'
import { isBlankSpriteDocument } from '../../src/editor-project/pixelDocumentOrigin.js'

test('blank request is closed, bounded and cannot fabricate uploaded provenance', () => {
  const body = { operation_id: randomUUID(), expected_revision: 1, width: 64, height: 64, name: 'Canvas' }
  const parsed = parseCreateBlankRequest(body)
  assert.equal(parsed.width, 64)
  for (const extra of [{ origin: { type: 'blank' } }, { source_ref: null }, { document_id: 'd_fake' }]) {
    assert.throws(() => parseCreateBlankRequest({ ...body, ...extra }))
  }
  for (const width of [0, -1, 1.5, '64', 1025, Infinity]) assert.throws(() => parseCreateBlankRequest({ ...body, width }))
  assert.equal(parseCreateBlankRequest({ ...body, width: 1, height: 1024 }).height, 1024)
  assert.equal(isBlankSpriteDocument({ source_ref: {}, origin: { type: 'blank' } }), false)
  assert.equal(isBlankSpriteDocument({ source_ref: null, origin: { type: 'blank', source: 'upload' } }), false)
})

test('blank creation has a durable replay after an acknowledgement failure', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'gametool-blank-ack-'))
  const operationId = randomUUID()
  const created = await createEditorProjectV1({ operationId, payload: { operation_id: operationId, name: null }, projectRoot })
  const request = parseCreateBlankRequest({ operation_id: randomUUID(), expected_revision: 1, width: 1, height: 1 })
  const args = { ...request, operationId: request.operation_id, expectedRevision: request.expected_revision, projectId: created.project.id, projectRoot }
  await assert.rejects(createBlankSpriteDocument({ ...args, fault: 'ack' }), e => e.code === 'storage_commit_failed')
  const replay = await createBlankSpriteDocument(args)
  assert.equal(replay.replayed, true)
  assert.equal(replay.project.revision, 2)
  assert.equal(Object.keys(replay.project.canvases).length, 1)
  assert.equal(replay.document.source_ref, null)
  assert.deepEqual(replay.document.origin, { type: 'blank' })
  assert.equal(replay.project.sprite_documents[replay.document.document_id].accepted_revision, null)
  assert.equal(validateSpriteDocument({ ...replay.document, origin: { type: 'blank', extra: true } }).status, 'fail')
})

test('native blank HTTP lifecycle: replay, first stroke, transparent undo, structure and original protection', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'gametool-blank-http-'))
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, { projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'), generatedDir: path.join(projectRoot, 'generated'), artifactAccessRegistry: createEditorArtifactAccessRegistry() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (url, body, type = 'application/json') => {
    const response = await editorFetch(base + url, { method: 'POST', headers: { 'content-type': type }, body: type === 'application/json' ? JSON.stringify(body) : body })
    return { status: response.status, body: await response.json() }
  }
  const created = await post('/api/editor/projects/v1', { operation_id: randomUUID() })
  assert.equal(created.status, 201)
  const pid = created.body.project.id, prefix = `/api/editor/projects/${pid}`
  const request = { operation_id: randomUUID(), expected_revision: 1, width: 2, height: 2, name: 'From zero' }
  const blank = await post(prefix + '/sprite-documents/blank', request)
  assert.equal(blank.status, 201)
  const doc = blank.body.document, did = doc.document_id
  assert.equal(Object.keys(blank.body.project.canvases).length, 1)
  assert.equal(Object.keys(doc.cels).length, 1)
  assert.equal(Object.values(doc.cels)[0].block, null)
  assert.deepEqual(doc.frame_order, ['frame_1'])
  assert.deepEqual(doc.layer_order, ['layer_1'])
  const replay = await post(prefix + '/sprite-documents/blank', request)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.project.revision, 2)
  assert.equal((await post(prefix + '/sprite-documents/blank', { ...request, width: 3 })).status, 409)
  assert.equal((await post(prefix + '/sprite-documents/blank', { ...request, operation_id: randomUUID() })).status, 409)
  // No pixel blocks exist yet: structure and restore must still replay durably.
  const structureRequest = { operation_id: randomUUID(), expected_revision: 2, expected_working_revision: 1, command: { type: 'rename-layer', layer_id: 'layer_1', name: 'Ink' } }
  const structure = await post(`${prefix}/sprite-documents/${did}/working-structure`, structureRequest)
  assert.equal(structure.status, 200, JSON.stringify(structure.body))
  assert.equal((await post(`${prefix}/sprite-documents/${did}/working-structure`, structureRequest)).body.project.revision, 3)
  const restoreRequest = { operation_id: randomUUID(), expected_revision: 3, expected_working_revision: 2, target_revision: 1, mode: 'structure' }
  const restore = await post(`${prefix}/sprite-documents/${did}/restore-working`, restoreRequest)
  assert.equal(restore.status, 200, JSON.stringify(restore.body))
  assert.equal((await post(`${prefix}/sprite-documents/${did}/restore-working`, restoreRequest)).body.project.revision, 4)
  const bytes = Buffer.from([255, 0, 0, 255])
  const query = new URLSearchParams({ operation_id: randomUUID(), expected_revision: '4', expected_working_revision: '3', x: '0', y: '0', w: '1', h: '1', expected_sha256: sha256Bytes(bytes) })
  const write = await post(`${prefix}/sprite-documents/${did}/working-pixels?${query}`, bytes, 'application/octet-stream')
  assert.equal(write.status, 200, JSON.stringify(write.body))
  assert.equal(Object.keys(write.body.project.canvases).length, 1)
  const block = Object.values(write.body.document.cels)[0].block
  const saved = Buffer.from(await (await fetch(`${base}${prefix}/sprite-documents/${did}/blocks/${block.sha256}`)).arrayBuffer())
  assert.deepEqual(saved, Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
  const undone = await post(`${prefix}/sprite-documents/${did}/restore-working`, { operation_id: randomUUID(), expected_revision: 5, expected_working_revision: 4, target_revision: 1 })
  assert.equal(undone.status, 200, JSON.stringify(undone.body))
  const emptyBlock = Object.values(undone.body.document.cels)[0].block
  const emptyBytes = Buffer.from(await (await fetch(`${base}${prefix}/sprite-documents/${did}/blocks/${emptyBlock.sha256}`)).arrayBuffer())
  assert.deepEqual(emptyBytes, Buffer.alloc(16))
  const reopened = await (await fetch(`${base}${prefix}/sprite-documents/${did}`)).json()
  assert.deepEqual(reopened.document.origin, { type: 'blank' })
  // Imported input remains an Original. It cannot be edited through blank's exception.
  const png = encodeRgbaPng(1, 1, bytes)
  const importQuery = new URLSearchParams({ operation_id: randomUUID(), expected_revision: '6', expected_sha256: sha256Bytes(png) })
  const imported = await post(`${prefix}/sprite-documents/import-png?${importQuery}`, png, 'image/png')
  assert.equal(imported.status, 201)
  assert.equal(imported.body.document.origin, undefined)
  const originalId = imported.body.document.document_id
  query.set('operation_id', randomUUID()); query.set('expected_revision', '7'); query.set('expected_working_revision', '1')
  assert.equal((await post(`${prefix}/sprite-documents/${originalId}/working-pixels?${query}`, bytes, 'application/octet-stream')).status, 422)
})
