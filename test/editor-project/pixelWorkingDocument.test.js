import test from 'node:test'
import { inlineHistoryFixture } from '../helpers/projectHistoryFixture.js'
import { lookupProjectRevision } from '../../src/editor-project/projectHistoryStore.js'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { changeWorkingStructure } from '../../src/editor-project/spriteDocumentStore.js'
import { parseWorkingStructureRequest, parseRestoreWorkingRequest } from '../../src/editor-project/spriteDocumentValidation.js'
import { compositePixelFrame, compositePixelBuffers, applyStructureCommand } from '../../src/editor-project/pixelStructure.js'
import { createAssistantConversations, ASSISTANT_MODELS } from '../../src/editor-project/assistantConversation.js'
import { pixelLinkScope } from '../../src/editor-project/pixelLinks.js'

import {
  createEditorArtifactAccessRegistry,
  createEditorProjectV1,
  createPixelScopeGrant,
  createSpriteDocumentFromUploadedPng,
  deriveWorkingSpriteDocument,
  encodeRgbaPng,
  getSpriteDocument,
  handleEditorProjectApi,
  readSpriteBlock,
  restoreWorkingSpriteDocument,
  saveCanvasLayout,
  sha256Bytes,
  spriteDocumentRevisionPath,
  resolveSpriteDocumentPaths,
  setTrustedPersistObserver,
  writeWorkingPixels,
  parseWorkingPixelsQuery,
} from '../../src/editor-project/index.js'

const now = '2026-09-28T00:00:00.000Z'
const createOp = '66666666-6666-4666-8666-666666666661'
const importOp = '66666666-6666-4666-8666-666666666662'
const layoutOp = '66666666-6666-4666-8666-666666666663'
const deriveOp = '66666666-6666-4666-8666-666666666664'
const deriveReplayOp = '66666666-6666-4666-8666-666666666665'
const writeOp = '66666666-6666-4666-8666-666666666666'
const restoreOp = '66666666-6666-4666-8666-666666666667'
const conflictOp = '66666666-6666-4666-8666-666666666668'
const otherCreateOp = '66666666-6666-4666-8666-666666666669'

test('live empty-cel candidates preserve visible layers and structure caps are resource limits', async () => {
  const make = (layerCount, frameCount) => {
    const m = { canvas: { w: 1, h: 1 }, derived_from: {}, layer_order: [], frame_order: [], layers: {}, frames: {}, cels: {} }
    for (let i = 0; i < layerCount; i++) { const id = `l${i}`; m.layer_order.push(id); m.layers[id] = { id, name: id, kind: 'raster', visible: true, locked: false } }
    for (let i = 0; i < frameCount; i++) {
      const id = `f${i}`; m.frame_order.push(id); m.frames[id] = { id, duration_ms: 125 }
      for (const layer_id of m.layer_order) { const cid = `${id}_${layer_id}`; m.cels[cid] = { id: cid, frame_id: id, layer_id, block: null } }
    }
    return m
  }
  const m = make(2, 1), blue = Uint8Array.of(0, 0, 255, 255), red = Uint8Array.of(255, 0, 0, 128)
  m.cels.f0_l1.block = { sha256: sha256Bytes(blue), w: 1, h: 1 }
  assert.deepEqual(await compositePixelFrame(m, 'f0', async () => blue), blue)
  assert.deepEqual([...compositePixelBuffers(m, 'f0', new Map([['f0_l1', blue], ['f0_l0', red]]))], [128, 0, 127, 255])
  m.layers.l0.visible = false
  assert.deepEqual(compositePixelBuffers(m, 'f0', new Map([['f0_l1', blue], ['f0_l0', red]])), blue)
  assert.deepEqual([...red], [255, 0, 0, 128]); assert.deepEqual([...blue], [0, 0, 255, 255])
  assert.throws(() => applyStructureCommand(make(32, 1), { type: 'add-layer', name: 'extra' }, () => 'new'), { code: 'resource_limit' })
  assert.throws(() => applyStructureCommand(make(1, 256), { type: 'add-frame' }, () => 'new'), { code: 'resource_limit' })
})

test('assistant scope grants reject missing, foreign, stale and out-of-range authority without a live provider', async () => {
  const root = await tempRoot(), { imported, canvas } = await importedProject(root)
  let project = imported.project
  const manifest = (await getSpriteDocument({ projectId: project.id, documentId: canvas.document_id, revision: 1, projectRoot: root })).manifest
  const cel = Object.values(manifest.cels)[0], rect = { x: 1, y: 1, w: 1, h: 1 }
  const scope = { projectId: project.id, projectRoot: root, workspaceRoot: path.join(root, 'workspace') }
  const grant = await createPixelScopeGrant({ ...scope, documentId: manifest.document_id, body: { operation_id: randomUUID(), expected_revision: project.revision,
    expected_working_revision: 1, frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id, rect, allowed_operations: ['fill-rect'] } })
  let calls = 0, operation = { type: 'fill-rect', rect, color: [255, 0, 0, 255] }
  const service = createAssistantConversations({ load: async () => ({ project }), readDocument: async () => ({ manifest }), adapters: { codex: async request => {
    calls++; assert.match(request.message, /allowed_rect/)
    return { reply: JSON.stringify({ reply: 'proposal', operation }), threadId: 'native', status: 'completed', provider: 'codex', model: ASSISTANT_MODELS.codex, requestedModel: ASSISTANT_MODELS.codex, naturalExit: true }
  } } })
  async function send(grantId = grant.grant_id) {
    const { conversation } = await service.open(scope, { provider: 'codex' })
    return service.send(scope, { conversation, operation_id: randomUUID(), message: 'Fill the selection', expected_revision: project.revision,
      canvas_id: canvas.id, expected_working_revision: 1, grant_id: grantId })
  }
  await assert.rejects(send('grant_' + '0'.repeat(32)), { code: 'invalid_request' }); assert.equal(calls, 0)
  assert.deepEqual((await send()).pixel_edit, operation); assert.equal(calls, 1)
  operation = { ...operation, rect: { x: 0, y: 0, w: 2, h: 2 } }
  await assert.rejects(send()); assert.equal(calls, 2)
  const originalId = project.id
  project = { ...project, id: 'foreign' }
  await assert.rejects(send()); assert.equal(calls, 2)
  project = { ...project, id: originalId, revision: project.revision + 1 }
  await assert.rejects(send(), { code: 'stale_revision' }); assert.equal(calls, 2)
})

test('layer/frame commands preserve identities, isolate cel writes, compose and restore locked history', async () => {
  const root = await tempRoot(), { imported, canvas } = await importedProject(root)
  const projectId = imported.project.id, originalId = canvas.document_id
  let result = await deriveWorkingSpriteDocument({ projectId, operationId: deriveOp, expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id, sourceDocumentId: originalId, sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, originalId, 1), projectRoot: root, now })
  const documentId = result.document.document_id, originalLayer = result.document.layer_order[0], firstFrame = result.document.frame_order[0]
  async function command(value) {
    const body = { operation_id: randomUUID(), expected_revision: result.project.revision, expected_working_revision: result.document.revision, command: value }
    const p = parseWorkingStructureRequest(body, documentId)
    const request = { projectId, documentId, projectRoot: root, operationId: p.operation_id, expectedRevision: p.expected_revision, expectedWorkingRevision: p.expected_working_revision, command: p.command, payload: p.payload }
    result = await changeWorkingStructure(request)
    assert.equal((await changeWorkingStructure(request)).replayed, true)
    await assert.rejects(changeWorkingStructure({ ...request, payload: { ...p.payload, command: { type: 'set-duration', frame_id: 'missing', duration_ms: 1 } } }), { code: 'operation_conflict' })
    return result
  }
  await command({ type: 'add-layer', name: 'Ink' })
  const top = result.document.layer_order[0]
  assert.equal(result.document.layer_order[1], originalLayer)
  assert.equal(Object.values(result.document.cels).find(c => c.layer_id === top).block, null)
  await command({ type: 'add-frame' })
  const blank = result.document.frame_order.at(-1)
  assert.equal(result.document.frames[blank].duration_ms, 125)
  assert.ok(Object.values(result.document.cels).filter(c => c.frame_id === blank).every(c => c.block === null))
  await command({ type: 'copy-frame', frame_id: firstFrame })
  const copiedFrame = result.document.frame_order.at(-1), doc = result.document
  assert.equal(doc.frames[copiedFrame].duration_ms, doc.frames[firstFrame].duration_ms)
  const sourceCel = Object.values(doc.cels).find(c => c.frame_id === firstFrame && c.layer_id === originalLayer)
  const copyCel = Object.values(doc.cels).find(c => c.frame_id === copiedFrame && c.layer_id === originalLayer)
  assert.notEqual(copyCel.id, sourceCel.id); assert.deepEqual(copyCel.block, sourceCel.block)
  const target = { frame_id: copiedFrame, layer_id: top, cel_id: Object.values(doc.cels).find(c => c.frame_id === copiedFrame && c.layer_id === top).id }
  const rgba = Uint8Array.of(100, 120, 140, 128), operation = randomUUID(), digest = sha256Bytes(rgba)
  const query = new URLSearchParams({ operation_id: operation, expected_revision: result.project.revision, expected_working_revision: doc.revision, x: 1, y: 0, w: 1, h: 1, expected_sha256: digest, ...target })
  const p = parseWorkingPixelsQuery(query, query.toString(), documentId)
  const write = { projectId, documentId, projectRoot: root, operationId: operation, expectedRevision: p.expected_revision,
    expectedWorkingRevision: p.expected_working_revision, rect: { x: 1, y: 0, w: 1, h: 1 }, rgba, expectedSha256: digest, payload: p.payload, target }
  await assert.rejects(writeWorkingPixels({ ...write, target: undefined }), { code: 'unsupported_input' })
  await assert.rejects(writeWorkingPixels({ ...write, target: { ...target, cel_id: sourceCel.id } }), { code: 'unsupported_input' })
  result = await writeWorkingPixels(write)
  assert.deepEqual(result.document.cels[sourceCel.id], doc.cels[sourceCel.id])
  assert.deepEqual(result.document.cels[copyCel.id], doc.cels[copyCel.id])
  const read = async block => (await readSpriteBlock({ projectId, documentId, sha256: block.sha256, projectRoot: root })).bytes
  const composite = await compositePixelFrame(result.document, copiedFrame, read)
  assert.deepEqual([...composite.subarray(4, 8)], [51, 61, 72, 255])
  await command({ type: 'set-visible', layer_id: top, value: false })
  assert.deepEqual(Buffer.from(await compositePixelFrame(result.document, copiedFrame, read)), pixels())
  const unlocked = result.document.revision
  await command({ type: 'set-locked', layer_id: top, value: true })
  await assert.rejects(writeWorkingPixels({ ...write, operationId: randomUUID(), expectedRevision: result.project.revision, expectedWorkingRevision: result.document.revision, payload: {} }), { code: 'unsupported_input' })
  const restoreBody = { operation_id: randomUUID(), expected_revision: result.project.revision, expected_working_revision: result.document.revision, target_revision: unlocked, mode: 'structure' }
  const restore = parseRestoreWorkingRequest(restoreBody, documentId)
  result = await restoreWorkingSpriteDocument({ projectId, documentId, operationId: restore.operation_id, expectedRevision: restore.expected_revision, expectedWorkingRevision: restore.expected_working_revision, targetRevision: unlocked, mode: 'structure', payload: restore.payload, projectRoot: root })
  assert.equal(result.document.layers[top].locked, false)
  await command({ type: 'set-duration', frame_id: copiedFrame, duration_ms: 240 })
  await command({ type: 'rename-layer', layer_id: top, name: 'Highlights' })
  // The same maintained writer/replay/history path owns deletion and ordering.
  await command({ type: 'move-frame', frame_id: copiedFrame, index: 0 })
  await command({ type: 'move-layer', layer_id: top, index: 1 })
  const beforeDelete = structuredClone(result.document)
  assert.equal(beforeDelete.frames[copiedFrame].duration_ms, 240)
  await command({ type: 'delete-frame', frame_id: blank })
  await command({ type: 'delete-layer', layer_id: top })
  const deleted = structuredClone(result.document)
  assert.deepEqual(deleted.frame_order, [copiedFrame, firstFrame])
  assert.deepEqual(deleted.layer_order, [originalLayer])
  const reloaded = await getSpriteDocument({ projectId, documentId, revision: deleted.revision, projectRoot: root })
  assert.deepEqual(reloaded.manifest, deleted)
  for (const snapshot of [beforeDelete, deleted]) {
    const body = parseRestoreWorkingRequest({ operation_id: randomUUID(), expected_revision: result.project.revision,
      expected_working_revision: result.document.revision, target_revision: snapshot.revision, mode: 'structure' }, documentId)
    result = await restoreWorkingSpriteDocument({ projectId, documentId, operationId: body.operation_id, expectedRevision: body.expected_revision,
      expectedWorkingRevision: body.expected_working_revision, targetRevision: snapshot.revision, mode: 'structure', payload: body.payload, projectRoot: root })
    for (const key of ['frames', 'layers', 'cels', 'frame_order', 'layer_order']) assert.deepEqual(result.document[key], snapshot[key])
  }
  assert.deepEqual((await getSpriteDocument({ projectId, documentId, revision: beforeDelete.revision, projectRoot: root })).manifest, beforeDelete)
  assert.deepEqual(Buffer.from(await compositePixelFrame(beforeDelete, copiedFrame, read)), pixels())
  const fullCopy = await deriveWorkingSpriteDocument({ projectId, operationId: randomUUID(), expectedRevision: result.project.revision,
    sourceCanvasId: Object.values(result.project.canvases).find(c => c.document_id === documentId).id, sourceDocumentId: documentId, sourceRevision: result.document.revision, payload: { action: 'test-full-copy' }, projectRoot: root })
  for (const key of ['frames', 'layers', 'cels', 'frame_order', 'layer_order', 'palette', 'tags', 'anchors']) assert.deepEqual(fullCopy.document[key], result.document[key])
  assert.deepEqual((await readCommittedBinding(root, projectId, originalId)).blockBytes, pixels())
  assert.equal(result.project.sprite_documents[documentId].accepted_revision, null)
  assert.throws(() => parseWorkingStructureRequest({ ...restoreBody, mode: undefined, command: { type: 'delete-layer' } }, documentId))
})

test('linked writes require complete group grants, commit once, recover receipts, derive locally and restore all relationships', async () => {
  const root = await tempRoot(), { imported, canvas } = await importedProject(root), projectId = imported.project.id
  let result = await deriveWorkingSpriteDocument({ projectId, operationId: deriveOp, expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id, sourceDocumentId: canvas.document_id, sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, canvas.document_id, 1), projectRoot: root })
  const documentId = result.document.document_id, scope = { projectId, documentId, projectRoot: root }, initial = structuredClone(result.document)
  const sourceCel = Object.values(initial.cels)[0], target = { frame_id: sourceCel.frame_id, layer_id: sourceCel.layer_id, cel_id: sourceCel.id }
  const rect = { x: 1, y: 0, w: 1, h: 1 }, rgba = Uint8Array.of(7, 8, 9, 128), digest = sha256Bytes(rgba)
  const grantBody = () => ({ operation_id: randomUUID(), expected_revision: result.project.revision, expected_working_revision: result.document.revision,
    ...target, rect, allowed_operations: ['working_pixels'], command: { rect, sha256: digest } })
  const legacy = await createPixelScopeGrant({ ...scope, body: grantBody() })
  async function command(value) {
    const p = parseWorkingStructureRequest({ operation_id: randomUUID(), expected_revision: result.project.revision, expected_working_revision: result.document.revision, command: value }, documentId)
    result = await changeWorkingStructure({ ...scope, operationId: p.operation_id, expectedRevision: p.expected_revision, expectedWorkingRevision: p.expected_working_revision, command: p.command, payload: p.payload })
  }
  await command({ type: 'copy-frame', frame_id: target.frame_id }); const independent = Object.values(result.document.cels).find(c => c.id !== sourceCel.id)
  await command({ type: 'set-layer-link-copies', layer_id: target.layer_id, value: true })
  await command({ type: 'copy-frame', frame_id: target.frame_id })
  const linked = pixelLinkScope(result.document, target.cel_id), before = structuredClone(result.document)
  assert.equal(linked.cel_ids.length, 2)
  await assert.rejects(createPixelScopeGrant({ ...scope, body: grantBody() }), /complete linked group/)
  await assert.rejects(createPixelScopeGrant({ ...scope, body: { ...grantBody(), link_scope: { ...linked, cel_ids: [target.cel_id] } } }), /complete linked group/)
  const body = { ...grantBody(), link_scope: linked }, grant = await createPixelScopeGrant({ ...scope, body })
  assert.deepEqual(grant.link_scope, linked); assert.equal(grant.read_dependencies.length, 2)
  assert.deepEqual(await createPixelScopeGrant({ ...scope, body }), grant)
  const request = (g = grant, explicit = true) => {
    const q = new URLSearchParams({ operation_id: randomUUID(), expected_revision: result.project.revision, expected_working_revision: result.document.revision,
      x: rect.x, y: rect.y, w: rect.w, h: rect.h, expected_sha256: digest, ...(explicit ? target : {}), ...(g ? { grant_id: g.grant_id, command_sha256: g.command_sha256 } : {}) })
    const p = parseWorkingPixelsQuery(q, q.toString(), documentId)
    return { ...scope, operationId: p.operation_id, expectedRevision: p.expected_revision, expectedWorkingRevision: p.expected_working_revision, rect, rgba,
      expectedSha256: digest, payload: p.payload, ...(explicit ? { target } : {}), ...(g ? { grantId: g.grant_id, commandSha256: g.command_sha256 } : {}) }
  }
  await assert.rejects(writeWorkingPixels(request(null)), { code: 'invalid_request' })
  await assert.rejects(writeWorkingPixels(request(null, false)), { code: 'unsupported_input' })
  await assert.rejects(writeWorkingPixels(request(legacy)), { code: 'stale_revision' })
  const write = request()
  await assert.rejects(writeWorkingPixels({ ...write, commandSha256: '0'.repeat(64) }), { code: 'invalid_request' })
  await assert.rejects(writeWorkingPixels({ ...write, fault: 'index' }), { code: 'storage_commit_failed' })
  assert.deepEqual((await getSpriteDocument(scope)).manifest, before, 'rejected requests and failed publication do not change the committed document')
  await assert.rejects(writeWorkingPixels({ ...write, fault: 'ack' }))
  result = await writeWorkingPixels(write); assert.equal(result.replayed, true)
  assert.equal(result.project.revision, write.expectedRevision + 1)
  const after = structuredClone(result.document), peer = linked.cel_ids.find(id => id !== sourceCel.id)
  assert.deepEqual(after.cels[peer].block, after.cels[sourceCel.id].block)
  assert.notDeepEqual(after.cels[sourceCel.id].block, before.cels[sourceCel.id].block)
  assert.deepEqual(after.cels[independent.id], before.cels[independent.id])
  const bytes = (await readSpriteBlock({ ...scope, sha256: after.cels[sourceCel.id].block.sha256 })).bytes, expected = pixels(); expected.set(rgba, 4)
  assert.deepEqual(bytes, expected)
  const copied = await deriveWorkingSpriteDocument({ projectId, projectRoot: root, operationId: randomUUID(), expectedRevision: result.project.revision,
    sourceCanvasId: Object.values(result.project.canvases).find(c => c.document_id === documentId).id, sourceDocumentId: documentId,
    sourceRevision: after.revision, payload: { action: 'linked-derive-test' } })
  assert.deepEqual(copied.document.links, after.links); assert.notEqual(copied.document.document_id, documentId)
  result.project = copied.project
  async function restore(snapshot, mode = 'structure') {
    const p = parseRestoreWorkingRequest({ operation_id: randomUUID(), expected_revision: result.project.revision,
      expected_working_revision: result.document.revision, target_revision: snapshot.revision, ...(mode ? { mode } : {}) }, documentId)
    const restored = await restoreWorkingSpriteDocument({ ...scope, operationId: p.operation_id, expectedRevision: p.expected_revision,
      expectedWorkingRevision: p.expected_working_revision, targetRevision: snapshot.revision, mode, payload: p.payload })
    result = restored; return restored
  }
  await assert.rejects(restore(initial, null), { code: 'unsupported_input' })
  for (const snapshot of [before, after, initial, after]) {
    await restore(snapshot)
    for (const key of ['frames', 'layers', 'cels', 'frame_order', 'layer_order', 'links']) assert.deepEqual(result.document[key], snapshot[key])
  }
  await command({ type: 'delete-frame', frame_id: result.document.cels[peer].frame_id })
  await command({ type: 'delete-frame', frame_id: independent.frame_id })
  assert.equal(result.document.frame_order.length, 1); assert.equal(pixelLinkScope(result.document, target.cel_id).cel_ids.length, 1)
  await assert.rejects(writeWorkingPixels(request(null)), { code: 'invalid_request' })
  await assert.rejects(writeWorkingPixels(request(null, false)), { code: 'unsupported_input' })
  await assert.rejects(restore(initial, null), { code: 'unsupported_input' })
  await assert.rejects(writeWorkingPixels(request(grant)), { code: 'stale_revision' })
  const singleGrant = await createPixelScopeGrant({ ...scope, body: { ...grantBody(), link_scope: pixelLinkScope(result.document, target.cel_id) } })
  assert.equal(singleGrant.read_dependencies.length, 1)
  result = await writeWorkingPixels(request(singleGrant)); assert.equal(result.document.frame_order.length, 1)
  assert.deepEqual((await getSpriteDocument({ ...scope, documentId: copied.document.document_id })).manifest, copied.document)
  assert.deepEqual((await readCommittedBinding(root, projectId, canvas.document_id)).blockBytes, pixels())
  assert.equal(result.project.sprite_documents[documentId].accepted_revision, null)
})

test('selection grants are immutable, versioned and restrict exact pixel writes without changing other bytes', async () => {
  const root = await tempRoot(), { imported, canvas } = await importedProject(root)
  const projectId = imported.project.id, sourceDocumentId = canvas.document_id
  const derived = await deriveWorkingSpriteDocument({ projectId, operationId: deriveOp, expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id, sourceDocumentId, sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceDocumentId, 1), projectRoot: root, now })
  const doc = derived.document, documentId = doc.document_id, cel = Object.values(doc.cels)[0]
  const target = { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id }, rect = { x: 1, y: 1, w: 1, h: 1 }
  const rgba = Uint8Array.of(30, 40, 50, 255), hash = sha256Bytes(rgba)
  const body = { operation_id: restoreOp, expected_revision: derived.project.revision, expected_working_revision: doc.revision,
    ...target, rect, allowed_operations: ['working_pixels'], command: { rect, sha256: hash } }
  const scope = { projectId, documentId, projectRoot: root }
  const grant = await createPixelScopeGrant({ ...scope, body })
  assert.deepEqual(await createPixelScopeGrant({ ...scope, body }), grant)
  await assert.rejects(createPixelScopeGrant({ ...scope, body: { ...body, rect: { x: 0, y: 0, w: 2, h: 2 } } }), { code: 'operation_conflict' })
  const before = await readCommittedBinding(root, projectId, documentId)
  assert.equal(before.projectRevision, derived.project.revision)
  function request(x = 1, commandSha256 = grant.command_sha256) {
    const query = new URLSearchParams({ operation_id: writeOp, expected_revision: derived.project.revision,
      expected_working_revision: doc.revision, x, y: 1, w: 1, h: 1, expected_sha256: hash,
      ...target, grant_id: grant.grant_id, command_sha256: commandSha256 })
    const parsed = parseWorkingPixelsQuery(query, query.toString(), documentId)
    return { ...scope, operationId: writeOp, expectedRevision: parsed.expected_revision,
      expectedWorkingRevision: parsed.expected_working_revision, rect: { x, y: 1, w: 1, h: 1 }, rgba,
      target, grantId: grant.grant_id, commandSha256, expectedSha256: hash, payload: parsed.payload }
  }
  await assert.rejects(writeWorkingPixels(request(0)), { code: 'invalid_request' })
  await assert.rejects(writeWorkingPixels(request(1, '0'.repeat(64))), { code: 'invalid_request' })
  await assert.rejects(writeWorkingPixels({ ...request(), grantId: 'grant_' + '1'.repeat(32) }), { code: 'invalid_request' })
  const written = await writeWorkingPixels(request())
  const after = await readCommittedBinding(root, projectId, documentId)
  assert.deepEqual([...after.blockBytes.subarray(0, 12)], [...before.blockBytes.subarray(0, 12)])
  assert.deepEqual([...after.blockBytes.subarray(12)], [...rgba])
  assert.equal((await writeWorkingPixels(request())).replayed, true)
  await assert.rejects(writeWorkingPixels({ ...request(), operationId: conflictOp, expectedRevision: written.project.revision,
    expectedWorkingRevision: written.document.revision, payload: { ...request().payload, operation_id: conflictOp } }), { code: 'stale_revision' })
  const original = await readCommittedBinding(root, projectId, sourceDocumentId)
  assert.deepEqual(original.blockBytes, pixels())
})

function pixels() {
  return Buffer.from([
    9, 8, 7, 0,
    1, 2, 3, 255,
    4, 5, 6, 0,
    7, 8, 9, 128,
  ])
}

function importPayload(operationId, expectedRevision, digest) {
  return {
    action: 'import_png',
    operation_id: operationId,
    expected_revision: expectedRevision,
    expected_sha256: digest,
    name: null,
  }
}

function derivePayload(operationId, expectedRevision, canvasId, documentId, sourceRevision) {
  return {
    action: 'derive_working',
    operation_id: operationId,
    expected_revision: expectedRevision,
    source_canvas_id: canvasId,
    source_document_id: documentId,
    source_revision: sourceRevision,
    name: null,
  }
}

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'pixel-working-doc-'))
}

async function importedProject(root) {
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })
  const png = encodeRgbaPng(2, 2, pixels())
  const digest = sha256Bytes(png)
  const imported = await createSpriteDocumentFromUploadedPng({
    projectId: created.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload: importPayload(importOp, 1, digest),
    projectRoot: root,
    now,
  })
  const canvas = Object.values(imported.project.canvases)[0]
  return { created, imported, canvas, digest, png }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function readCommittedBinding(root, projectId, documentId) {
  const projectPath = path.join(root, 'workspace', 'projects', projectId, 'project.json')
  const project = JSON.parse(await readFile(projectPath, 'utf8'))
  const revision = project.sprite_documents[documentId].working_revision
  const manifestPath = path.join(
    root,
    'workspace',
    'projects',
    projectId,
    'sprite-documents',
    documentId,
    'revisions',
    `${revision}.json`,
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const cel = Object.values(manifest.cels)[0]
  const blockPath = path.join(
    root,
    'workspace',
    'projects',
    projectId,
    'sprite-documents',
    documentId,
    'blocks',
    `${cel.block.sha256}.rgba`,
  )
  const bytes = await readFile(blockPath)
  return {
    projectRevision: project.revision,
    workingRevision: revision,
    blockHash: sha256Bytes(bytes),
    blockBytes: Buffer.from(bytes),
  }
}

function assertBindingUnchanged(before, after) {
  assert.equal(after.projectRevision, before.projectRevision)
  assert.equal(after.workingRevision, before.workingRevision)
  assert.equal(after.blockHash, before.blockHash)
  assert.deepEqual([...after.blockBytes], [...before.blockBytes])
}

function hasPersistAction(records, action, targetPath) {
  const resolved = path.resolve(targetPath)
  return records.some((item) => item.action === action && item.path === resolved)
}

function persistActionIndex(records, action, targetPath) {
  const resolved = path.resolve(targetPath)
  return records.findIndex((item) => item.action === action && item.path === resolved)
}

const CROSS_ORIGIN_PROBE_DEADLINE_MS = 1000

function rejectCrossOriginBeforeBody(baseUrl, targetPath, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetPath, baseUrl)
    let settled = false
    let response = null
    let ended = false
    let wroteBody = false
    const req = http.request({
      // This probe deliberately never finishes its body; use one owned socket.
      agent: false,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        ...headers,
        origin: 'https://evil.example',
        'content-length': '8',
      },
    }, (res) => {
      response = res
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('error', (error) => fail(error))
      res.on('aborted', () => fail(Object.assign(new Error('cross-origin response aborted'), { code: 'response_aborted' })))
      res.on('close', () => {
        if (!ended) fail(Object.assign(new Error('cross-origin response closed'), { code: 'response_closed' }))
      })
      res.on('end', () => {
        ended = true
        const text = Buffer.concat(chunks).toString('utf8')
        let json = {}
        if (text) {
          try {
            json = JSON.parse(text)
          } catch (error) {
            fail(error)
            return
          }
        }
        finish(() => resolve({
          status: res.statusCode,
          json,
          wroteBody,
          bodyCompleted: req.writableEnded,
          destroyed: req.destroyed,
        }))
      })
    })
    const timer = setTimeout(() => {
      fail(Object.assign(new Error(`cross-origin probe deadline exceeded: ${url.pathname}; socket=${Boolean(req.socket)}; response=${Boolean(response)}`), { code: 'request_deadline' }))
    }, CROSS_ORIGIN_PROBE_DEADLINE_MS)
    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const socket = req.socket
      response?.destroy()
      req.destroy()
      error.requestDestroyed = req.destroyed
      error.responseDestroyed = response ? response.destroyed : Boolean(socket?.destroyed)
      reject(error)
    }
    function finish(action) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.destroy()
      action()
    }
    req.on('error', (error) => fail(error))
    req.flushHeaders()
    wroteBody = req.writableEnded
  })
}

test('cross-origin probe rejects and destroys the request on deadline, error, or response close', async () => {
  const silent = http.createServer(() => {})
  const silentPort = await listen(silent)
  const started = Date.now()
  try {
    await assert.rejects(
      () => rejectCrossOriginBeforeBody(`http://127.0.0.1:${silentPort}`, '/unused', {
        'content-type': 'application/octet-stream',
      }),
      (error) => error.code === 'request_deadline'
        && error.requestDestroyed === true
        && error.responseDestroyed === true
        && Date.now() - started < CROSS_ORIGIN_PROBE_DEADLINE_MS + 1000,
    )
  } finally {
    silent.closeAllConnections?.()
    silent.close()
  }
  const dropped = http.createServer((req) => {
    req.destroy()
  })
  const droppedPort = await listen(dropped)
  try {
    await assert.rejects(
      () => rejectCrossOriginBeforeBody(`http://127.0.0.1:${droppedPort}`, '/unused', {
        'content-type': 'application/octet-stream',
      }),
      (error) => error.requestDestroyed === true && error.code !== 'request_deadline',
    )
  } finally {
    dropped.closeAllConnections?.()
    dropped.close()
  }
  const interrupted = http.createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.destroy()
  })
  const interruptedPort = await listen(interrupted)
  try {
    await assert.rejects(
      () => rejectCrossOriginBeforeBody(`http://127.0.0.1:${interruptedPort}`, '/unused', {
        'content-type': 'application/json',
      }),
      (error) => error.requestDestroyed === true
        && error.responseDestroyed === true
        && error.code !== 'request_deadline',
    )
  } finally {
    interrupted.closeAllConnections?.()
    interrupted.close()
  }
})

test('derive-working HTTP route returns 201 and replays 200 without moving the source', async () => {
  const root = await tempRoot()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    const created = await fetch(new URL('/api/editor/projects/v1', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    const createdJson = await created.json()
    const png = encodeRgbaPng(2, 2, pixels())
    const digest = sha256Bytes(png)
    const query = new URLSearchParams({
      operation_id: importOp,
      expected_revision: '1',
      expected_sha256: digest,
    })
    const imported = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/import-png?${query}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })
    const importedJson = await imported.json()
    const canvasId = Object.keys(importedJson.project.canvases)[0]
    const deriveBody = JSON.stringify({
      operation_id: deriveOp,
      expected_revision: importedJson.project.revision,
      source_canvas_id: canvasId,
      source_document_id: importedJson.document.document_id,
      source_revision: 1,
    })
    const derived = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/derive-working`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: deriveBody,
    })
    const derivedJson = await derived.json()
    assert.equal(derived.status, 201)
    assert.equal(derivedJson.canvas.x, importedJson.project.canvases[canvasId].x + 2)
    assert.equal(derivedJson.project.canvases[canvasId].x, importedJson.project.canvases[canvasId].x)
    const replay = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/derive-working`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: deriveBody,
    })
    assert.equal(replay.status, 200)
  } finally {
    server.close()
  }
})

test('working-pixels and restore HTTP routes replay, reject, and leave pixels unchanged on refusal', async () => {
  const root = await tempRoot()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    const created = await fetch(new URL('/api/editor/projects/v1', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    const createdJson = await created.json()
    const png = encodeRgbaPng(2, 2, pixels())
    const digest = sha256Bytes(png)
    const importQuery = new URLSearchParams({
      operation_id: importOp,
      expected_revision: '1',
      expected_sha256: digest,
    })
    const imported = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/import-png?${importQuery}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })
    const importedJson = await imported.json()
    const canvasId = Object.keys(importedJson.project.canvases)[0]
    const deriveBody = JSON.stringify({
      operation_id: deriveOp,
      expected_revision: importedJson.project.revision,
      source_canvas_id: canvasId,
      source_document_id: importedJson.document.document_id,
      source_revision: 1,
    })
    const derived = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/derive-working`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/json' }, body: deriveBody })
    const derivedJson = await derived.json()
    const patch = Buffer.from([9, 9, 9, 0])
    const query = new URLSearchParams({
      operation_id: writeOp,
      expected_revision: String(derivedJson.project.revision),
      expected_working_revision: '1',
      x: '1',
      y: '0',
      w: '1',
      h: '1',
      expected_sha256: sha256Bytes(patch),
    })
    const writeUrl = `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/working-pixels?${query}`
    const wrote = await fetch(new URL(writeUrl, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: patch,
    })
    const wroteJson = await wrote.json()
    assert.equal(wrote.status, 200)
    assert.equal(wroteJson.document.revision, 2)
    const replay = await fetch(new URL(writeUrl, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: patch,
    })
    assert.equal(replay.status, 200)
    const bound = await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id)
    const sourceBound = await readCommittedBinding(root, createdJson.project.id, importedJson.document.document_id)
    const conflict = await fetch(new URL(writeUrl, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from([1, 1, 1, 1]),
    })
    const conflictJson = await conflict.json()
    assert.equal(conflict.status, 422)
    assert.equal(conflictJson.error, 'artifact_integrity_failed')
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const crossOriginPixels = await rejectCrossOriginBeforeBody(baseUrl, writeUrl, {
      'content-type': 'application/octet-stream',
    })
    assert.equal(crossOriginPixels.status, 403)
    assert.equal(crossOriginPixels.json.error, 'forbidden_origin')
    assert.equal(crossOriginPixels.wroteBody, false)
    assert.equal(crossOriginPixels.bodyCompleted, false)
    assert.equal(crossOriginPixels.destroyed, true)
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const crossOriginRestore = await rejectCrossOriginBeforeBody(
      baseUrl,
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/restore-working`,
      { 'content-type': 'application/json' },
    )
    assert.equal(crossOriginRestore.status, 403)
    assert.equal(crossOriginRestore.json.error, 'forbidden_origin')
    assert.equal(crossOriginRestore.wroteBody, false)
    assert.equal(crossOriginRestore.bodyCompleted, false)
    assert.equal(crossOriginRestore.destroyed, true)
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const otherPatch = Buffer.from([3, 3, 3, 255])
    const payloadConflict = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/working-pixels?${new URLSearchParams({
        operation_id: writeOp,
        expected_revision: String(bound.projectRevision),
        expected_working_revision: String(bound.workingRevision),
        x: '0',
        y: '1',
        w: '1',
        h: '1',
        expected_sha256: sha256Bytes(otherPatch),
      })}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: otherPatch })
    const payloadConflictJson = await payloadConflict.json()
    assert.equal(payloadConflict.status, 409)
    assert.equal(payloadConflictJson.error, 'operation_conflict')
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const wrongType = await fetch(new URL(writeUrl, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: patch,
    })
    assert.equal(wrongType.status, 400)
    const badQuery = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/working-pixels?${new URLSearchParams({
        operation_id: '66666666-6666-4666-8666-66666666666e',
        expected_revision: String(bound.projectRevision),
        expected_working_revision: String(bound.workingRevision),
        x: '0',
        y: '0',
        w: '1',
        h: '1',
        expected_sha256: sha256Bytes(patch),
        extra: '1',
      })}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: patch })
    assert.equal(badQuery.status, 400)
    assert.equal((await badQuery.json()).error, 'invalid_request')
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const shortBody = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    const lengthMismatch = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/working-pixels?${new URLSearchParams({
        operation_id: '66666666-6666-4666-8666-66666666666f',
        expected_revision: String(bound.projectRevision),
        expected_working_revision: String(bound.workingRevision),
        x: '0',
        y: '0',
        w: '1',
        h: '1',
        expected_sha256: sha256Bytes(shortBody),
      })}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: shortBody })
    assert.equal(lengthMismatch.status, 400)
    assert.equal((await lengthMismatch.json()).error, 'invalid_request')
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const sourceWrite = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${importedJson.document.document_id}/working-pixels?${new URLSearchParams({
        operation_id: '66666666-6666-4666-8666-66666666666d',
        expected_revision: String(sourceBound.projectRevision),
        expected_working_revision: String(sourceBound.workingRevision),
        x: '0',
        y: '0',
        w: '1',
        h: '1',
        expected_sha256: sha256Bytes(patch),
      })}`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: patch })
    assert.equal(sourceWrite.status, 422)
    assert.equal((await sourceWrite.json()).error, 'unsupported_input')
    assertBindingUnchanged(sourceBound, await readCommittedBinding(root, createdJson.project.id, importedJson.document.document_id))
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const oversized = await new Promise((resolve, reject) => {
      const url = new URL(
        `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/working-pixels?${query}`,
        baseUrl,
      )
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'transfer-encoding': 'chunked',
          'X-Editor-Storage-Version': '2',
        },
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode, json: text ? JSON.parse(text) : {} })
        })
      })
      req.on('error', reject)
      req.write(Buffer.alloc(4 * 1024 * 1024 + 1))
      req.end()
    })
    assert.equal(oversized.status, 413)
    assertBindingUnchanged(bound, await readCommittedBinding(root, createdJson.project.id, derivedJson.document.document_id))
    const restoreBody = JSON.stringify({
      operation_id: restoreOp,
      expected_revision: wroteJson.project.revision,
      expected_working_revision: 2,
      target_revision: 1,
    })
    const restored = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/restore-working`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/json' }, body: restoreBody })
    const restoredJson = await restored.json()
    assert.equal(restored.status, 200)
    assert.equal(restoredJson.document.revision, 3)
    const restoreReplay = await fetch(new URL(
      `/api/editor/projects/${createdJson.project.id}/sprite-documents/${derivedJson.document.document_id}/restore-working`,
      baseUrl,
    ), { method: 'POST', headers: { 'content-type': 'application/json' }, body: restoreBody })
    assert.equal(restoreReplay.status, 200)
    assert.equal(restoredJson.project.sprite_documents[importedJson.document.document_id].working_revision, 1)
    assert.equal(conflictJson.error, 'artifact_integrity_failed')
  } finally {
    server.close()
  }
})

test('derive-working copies RGBA beside the source and leaves the source hash in place', async () => {
  const root = await tempRoot()
  const { imported, canvas, digest } = await importedProject(root)
  const sourceId = imported.document.document_id
  const asset = imported.project.assets[imported.document.source_ref.asset_id]
  const sourcePngPath = path.join(root, asset.revisions[asset.active_revision_id].artifacts.image)
  const before = sha256Bytes(await readFile(sourcePngPath))
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  assert.equal(derived.replayed, false)
  assert.equal(derived.document.revision, 1)
  assert.equal(derived.document.parent_revision, null)
  assert.equal(derived.document.source_ref.expected_sha256, digest)
  assert.equal(derived.document.derived_from.document_id, sourceId)
  assert.equal(derived.document.derived_from.revision, 1)
  assert.equal(derived.canvas.x, canvas.x + 2)
  assert.equal(derived.canvas.y, canvas.y)
  assert.equal(derived.project.canvases[canvas.id].x, canvas.x)
  assert.equal(derived.project.sprite_documents[sourceId].working_revision, 1)
  assert.equal(derived.project.sprite_documents[derived.document.document_id].accepted_revision, null)
  const block = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    sha256: derived.document.cels[Object.keys(derived.document.cels)[0]].block.sha256,
    projectRoot: root,
  })
  assert.deepEqual([...block.bytes], [...pixels()])
  assert.equal(sha256Bytes(await readFile(sourcePngPath)), before)
  const replay = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: 1,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.canvas.x, derived.canvas.x)
  assert.equal(replay.project.revision, derived.project.revision)
})

test('working-pixels and restore keep accepted, source, and history, and reject the wrong target', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  const patch = Buffer.from([9, 9, 9, 0])
  const patchHash = sha256Bytes(patch)
  const wrote = await writeWorkingPixels({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: writeOp,
    expectedRevision: derived.project.revision,
    expectedWorkingRevision: 1,
    rect: { x: 1, y: 0, w: 1, h: 1 },
    rgba: patch,
    expectedSha256: patchHash,
    payload: {
      action: 'working_pixels',
      operation_id: writeOp,
      expected_revision: derived.project.revision,
      expected_working_revision: 1,
      document_id: derived.document.document_id,
      x: 1,
      y: 0,
      w: 1,
      h: 1,
      expected_sha256: patchHash,
    },
    projectRoot: root,
    now,
  })
  assert.equal(wrote.document.revision, 2)
  assert.equal(wrote.document.parent_revision, 1)
  const written = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    revision: 2,
    projectRoot: root,
  })
  const writtenHash = written.manifest.cels[Object.keys(written.manifest.cels)[0]].block.sha256
  const writtenBytes = await readFile(path.join(
    root,
    'workspace',
    'projects',
    imported.project.id,
    'sprite-documents',
    derived.document.document_id,
    'blocks',
    `${writtenHash}.rgba`,
  ))
  assert.equal(sha256Bytes(writtenBytes), writtenHash)
  assert.deepEqual([...writtenBytes.subarray(4, 8)], [...patch])
  assert.deepEqual([...writtenBytes.subarray(0, 4)], [9, 8, 7, 0])
  assert.deepEqual([...writtenBytes.subarray(8)], [4, 5, 6, 0, 7, 8, 9, 128])
  assert.equal(wrote.document.derived_from.document_id, sourceId)
  assert.equal(wrote.project.sprite_documents[sourceId].working_revision, 1)
  assert.equal(wrote.project.canvases[derived.canvas.id].x, derived.canvas.x)
  assert.equal(wrote.project.sprite_documents[derived.document.document_id].accepted_revision, null)
  const restored = await restoreWorkingSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: restoreOp,
    expectedRevision: wrote.project.revision,
    expectedWorkingRevision: 2,
    targetRevision: 1,
    payload: {
      action: 'restore_working',
      operation_id: restoreOp,
      expected_revision: wrote.project.revision,
      expected_working_revision: 2,
      document_id: derived.document.document_id,
      target_revision: 1,
    },
    projectRoot: root,
    now,
  })
  assert.equal(restored.document.revision, 3)
  assert.equal(restored.document.parent_revision, 2)
  assert.equal((await lookupProjectRevision(restored.project, derived.document.document_id, 2, { projectRoot: root })).parent_revision, 1)
  const reopened = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    projectRoot: root,
  })
  const reopenedBlock = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    sha256: reopened.manifest.cels[Object.keys(reopened.manifest.cels)[0]].block.sha256,
    projectRoot: root,
  })
  assert.deepEqual([...reopenedBlock.bytes], [...pixels()])
  const old = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    revision: 2,
    projectRoot: root,
  })
  assert.equal(old.manifest.revision, 2)
  const historical = await readFile(path.join(
    root,
    'workspace',
    'projects',
    imported.project.id,
    'sprite-documents',
    derived.document.document_id,
    'blocks',
    `${old.manifest.cels[Object.keys(old.manifest.cels)[0]].block.sha256}.rgba`,
  ))
  assert.deepEqual([...historical.subarray(4, 8)], [...patch])
  const sourceAfter = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: sourceId,
    projectRoot: root,
  })
  assert.equal(sourceAfter.manifest_sha256, imported.project.sprite_documents[sourceId].working.manifest_sha256)
  assert.equal(restored.project.sprite_documents[sourceId].accepted_revision, null)
  assert.equal(restored.project.sprite_documents[derived.document.document_id].accepted_revision, null)
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: sourceId,
      operationId: '66666666-6666-4666-8666-66666666666a',
      expectedRevision: restored.project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      rgba: Buffer.from([1, 1, 1, 1]),
      expectedSha256: sha256Bytes(Buffer.from([1, 1, 1, 1])),
      payload: {
        action: 'working_pixels',
        operation_id: '66666666-6666-4666-8666-66666666666a',
        expected_revision: restored.project.revision,
        expected_working_revision: 1,
        document_id: sourceId,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        expected_sha256: sha256Bytes(Buffer.from([1, 1, 1, 1])),
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'unsupported_input',
  )
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: '66666666-6666-4666-8666-66666666666b',
      expectedRevision: restored.project.revision,
      expectedWorkingRevision: 3,
      rect: { x: 2, y: 0, w: 1, h: 1 },
      rgba: Buffer.from([1, 1, 1, 1]),
      expectedSha256: sha256Bytes(Buffer.from([1, 1, 1, 1])),
      payload: {
        action: 'working_pixels',
        operation_id: '66666666-6666-4666-8666-66666666666b',
        expected_revision: restored.project.revision,
        expected_working_revision: 3,
        document_id: derived.document.document_id,
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        expected_sha256: sha256Bytes(Buffer.from([1, 1, 1, 1])),
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'invalid_request',
  )
})

test('same operation with a different payload conflicts before a stale revision, and a failed manifest write can be retried', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const payload = derivePayload(conflictOp, imported.project.revision, canvas.id, sourceId, 1)
  await assert.rejects(
    () => deriveWorkingSpriteDocument({
      projectId: imported.project.id,
      operationId: conflictOp,
      expectedRevision: imported.project.revision,
      sourceCanvasId: canvas.id,
      sourceDocumentId: sourceId,
      sourceRevision: 1,
      payload,
      projectRoot: root,
      now,
      fault: 'manifest',
    }),
    (error) => error.code === 'storage_commit_failed',
  )
  const retried = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: conflictOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload,
    projectRoot: root,
    now,
  })
  assert.equal(retried.replayed, false)
  await assert.rejects(
    () => deriveWorkingSpriteDocument({
      projectId: imported.project.id,
      operationId: conflictOp,
      expectedRevision: 1,
      sourceCanvasId: canvas.id,
      sourceDocumentId: sourceId,
      sourceRevision: 99,
      payload: derivePayload(conflictOp, 1, canvas.id, sourceId, 99),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'operation_conflict',
  )
  const other = await createEditorProjectV1({
    operationId: otherCreateOp,
    payload: { operation_id: otherCreateOp, name: null },
    projectRoot: root,
    now,
  })
  await assert.rejects(
    () => deriveWorkingSpriteDocument({
      projectId: other.project.id,
      operationId: deriveReplayOp,
      expectedRevision: 1,
      sourceCanvasId: canvas.id,
      sourceDocumentId: sourceId,
      sourceRevision: 1,
      payload: derivePayload(deriveReplayOp, 1, canvas.id, sourceId, 1),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'not_found',
  )
  const moved = await saveCanvasLayout({
    projectId: imported.project.id,
    operationId: layoutOp,
    expectedRevision: retried.project.revision,
    positions: [{ canvas_id: canvas.id, x: 3, y: 4 }],
    payload: {
      action: 'save_canvas_layout',
      operation_id: layoutOp,
      expected_revision: retried.project.revision,
      positions: [{ canvas_id: canvas.id, x: 3, y: 4 }],
    },
    projectRoot: root,
    now,
  })
  assert.equal(moved.project.canvases[canvas.id].x, 3)
  assert.equal(moved.project.sprite_documents[retried.document.document_id].working_revision, 1)
  const patch = Buffer.from([3, 3, 3, 0])
  const patchHash = sha256Bytes(patch)
  const writePayload = {
    action: 'working_pixels',
    operation_id: writeOp,
    expected_revision: moved.project.revision,
    expected_working_revision: 1,
    document_id: retried.document.document_id,
    x: 0,
    y: 1,
    w: 1,
    h: 1,
    expected_sha256: patchHash,
  }
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: retried.document.document_id,
      operationId: writeOp,
      expectedRevision: moved.project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 0, y: 1, w: 1, h: 1 },
      rgba: patch,
      expectedSha256: patchHash,
      payload: writePayload,
      projectRoot: root,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const acked = await writeWorkingPixels({
    projectId: imported.project.id,
    documentId: retried.document.document_id,
    operationId: writeOp,
    expectedRevision: 1,
    expectedWorkingRevision: 1,
    rect: { x: 0, y: 1, w: 1, h: 1 },
    rgba: patch,
    expectedSha256: patchHash,
    payload: writePayload,
    projectRoot: root,
    now,
  })
  assert.equal(acked.replayed, true)
  assert.equal(acked.document.revision, 2)
  assert.equal(acked.project.revision, moved.project.revision + 1)
})

test('an uncommitted revision slot does not block the same operation or a different legal write', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  const sourceHash = derived.project.sprite_documents[sourceId].working.manifest_sha256
  const first = Buffer.from([2, 2, 2, 0])
  const firstHash = sha256Bytes(first)
  const firstPayload = {
    action: 'working_pixels',
    operation_id: writeOp,
    expected_revision: derived.project.revision,
    expected_working_revision: 1,
    document_id: derived.document.document_id,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    expected_sha256: firstHash,
  }
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: writeOp,
      expectedRevision: derived.project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      rgba: first,
      expectedSha256: firstHash,
      payload: firstPayload,
      projectRoot: root,
      now,
      fault: 'index',
    }),
    (error) => error.code === 'storage_commit_failed',
  )
  const orphan = path.join(
    root,
    'workspace',
    'projects',
    imported.project.id,
    'sprite-documents',
    derived.document.document_id,
    'revisions',
    '2.json',
  )
  const orphanBytes = await readFile(orphan)
  const resumed = await writeWorkingPixels({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: writeOp,
    expectedRevision: derived.project.revision,
    expectedWorkingRevision: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    rgba: first,
    expectedSha256: firstHash,
    payload: firstPayload,
    projectRoot: root,
    now,
  })
  assert.equal(resumed.document.revision, 2)
  assert.equal(resumed.project.sprite_documents[sourceId].working.manifest_sha256, sourceHash)
  assert.equal(resumed.project.sprite_documents[derived.document.document_id].accepted_revision, null)
  const second = Buffer.from([5, 5, 5, 255])
  const secondHash = sha256Bytes(second)
  const secondPayload = {
    action: 'working_pixels',
    operation_id: '66666666-6666-4666-8666-66666666666c',
    expected_revision: resumed.project.revision,
    expected_working_revision: 2,
    document_id: derived.document.document_id,
    x: 1,
    y: 1,
    w: 1,
    h: 1,
    expected_sha256: secondHash,
  }
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: secondPayload.operation_id,
      expectedRevision: resumed.project.revision,
      expectedWorkingRevision: 2,
      rect: { x: 1, y: 1, w: 1, h: 1 },
      rgba: second,
      expectedSha256: secondHash,
      payload: secondPayload,
      projectRoot: root,
      now,
      fault: 'index',
    }),
    (error) => error.code === 'storage_commit_failed',
  )
  const skipped = path.join(
    root,
    'workspace',
    'projects',
    imported.project.id,
    'sprite-documents',
    derived.document.document_id,
    'revisions',
    '3.json',
  )
  const skippedBytes = await readFile(skipped)
  const continued = await restoreWorkingSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: restoreOp,
    expectedRevision: resumed.project.revision,
    expectedWorkingRevision: 2,
    targetRevision: 1,
    payload: {
      action: 'restore_working',
      operation_id: restoreOp,
      expected_revision: resumed.project.revision,
      expected_working_revision: 2,
      document_id: derived.document.document_id,
      target_revision: 1,
    },
    projectRoot: root,
    now,
  })
  assert.equal(continued.document.revision, 4)
  assert.equal(await lookupProjectRevision(continued.project, derived.document.document_id, 3, { projectRoot: root }), null)
  assert.equal((await lookupProjectRevision(continued.project, derived.document.document_id, 1, { projectRoot: root })).manifest_sha256, derived.project.sprite_documents[derived.document.document_id].working.manifest_sha256)
  assert.equal(continued.project.sprite_documents[sourceId].working.manifest_sha256, sourceHash)
  assert.equal(continued.project.sprite_documents[derived.document.document_id].accepted_revision, null)
  assert.equal(sha256Bytes(await readFile(orphan)), sha256Bytes(orphanBytes))
  assert.equal(sha256Bytes(await readFile(skipped)), sha256Bytes(skippedBytes))
})

test('a published manifest whose directory sync failed is confirmed before index commit on reuse', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  const paths = resolveSpriteDocumentPaths({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    projectRoot: root,
  })
  const revisionPath = spriteDocumentRevisionPath(paths, 2)
  const projectJson = path.join(root, 'workspace', 'projects', imported.project.id, 'project.json')
  const patch = Buffer.from([4, 4, 4, 255])
  const patchHash = sha256Bytes(patch)
  const payload = {
    action: 'working_pixels',
    operation_id: '66666666-6666-4666-8666-666666666670',
    expected_revision: derived.project.revision,
    expected_working_revision: 1,
    document_id: derived.document.document_id,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    expected_sha256: patchHash,
  }
  const records = []
  setTrustedPersistObserver(records)
  try {
    await assert.rejects(
      () => writeWorkingPixels({
        projectId: imported.project.id,
        documentId: derived.document.document_id,
        operationId: payload.operation_id,
        expectedRevision: derived.project.revision,
        expectedWorkingRevision: 1,
        rect: { x: 0, y: 0, w: 1, h: 1 },
        rgba: patch,
        expectedSha256: patchHash,
        payload,
        projectRoot: root,
        now,
        fault: 'manifest_sync',
      }),
      (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
    )
    const failed = records.splice(0, records.length)
    const published = await readFile(revisionPath)
    const identity = await stat(revisionPath)
    assert.equal(hasPersistAction(failed, 'publish-file', revisionPath), true)
    assert.equal(hasPersistAction(failed, 'publish-file', projectJson), false)
    assert.equal(JSON.parse(await readFile(projectJson, 'utf8')).revision, derived.project.revision)
    const recovered = await writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: payload.operation_id,
      expectedRevision: derived.project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      rgba: patch,
      expectedSha256: patchHash,
      payload,
      projectRoot: root,
      now,
    })
    const retry = records.splice(0, records.length)
    const syncAt = persistActionIndex(retry, 'fsync-directory', paths.revisionsDir)
    const indexAt = persistActionIndex(retry, 'publish-file', projectJson)
    const after = await stat(revisionPath)
    assert.equal(recovered.replayed, false)
    assert.equal(recovered.document.revision, 2)
    assert.equal(recovered.project.revision, derived.project.revision + 1)
    assert.equal(hasPersistAction(retry, 'publish-file', revisionPath), false)
    assert.ok(syncAt >= 0)
    assert.ok(indexAt > syncAt)
    assert.equal(after.dev, identity.dev)
    assert.equal(after.ino, identity.ino)
    assert.equal(sha256Bytes(await readFile(revisionPath)), sha256Bytes(published))
  } finally {
    setTrustedPersistObserver(null)
  }
})

test('a published block whose directory sync failed is confirmed before index commit on reuse', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  const paths = resolveSpriteDocumentPaths({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    projectRoot: root,
  })
  const projectJson = path.join(root, 'workspace', 'projects', imported.project.id, 'project.json')
  const patch = Buffer.from([6, 6, 6, 255])
  const patchHash = sha256Bytes(patch)
  const payload = {
    action: 'working_pixels',
    operation_id: '66666666-6666-4666-8666-666666666671',
    expected_revision: derived.project.revision,
    expected_working_revision: 1,
    document_id: derived.document.document_id,
    x: 1,
    y: 1,
    w: 1,
    h: 1,
    expected_sha256: patchHash,
  }
  const records = []
  setTrustedPersistObserver(records)
  try {
    await assert.rejects(
      () => writeWorkingPixels({
        projectId: imported.project.id,
        documentId: derived.document.document_id,
        operationId: payload.operation_id,
        expectedRevision: derived.project.revision,
        expectedWorkingRevision: 1,
        rect: { x: 1, y: 1, w: 1, h: 1 },
        rgba: patch,
        expectedSha256: patchHash,
        payload,
        projectRoot: root,
        now,
        fault: 'block_sync',
      }),
      (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
    )
    const failed = records.splice(0, records.length)
    const blockPath = failed.find((item) => item.action === 'publish-file' && item.path.startsWith(path.resolve(paths.blocksDir)))?.path
    assert.equal(typeof blockPath, 'string')
    const published = await readFile(blockPath)
    const identity = await stat(blockPath)
    assert.equal(hasPersistAction(failed, 'publish-file', projectJson), false)
    assert.equal(JSON.parse(await readFile(projectJson, 'utf8')).revision, derived.project.revision)
    const recovered = await writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: payload.operation_id,
      expectedRevision: derived.project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 1, y: 1, w: 1, h: 1 },
      rgba: patch,
      expectedSha256: patchHash,
      payload,
      projectRoot: root,
      now,
    })
    const retry = records.splice(0, records.length)
    const syncAt = persistActionIndex(retry, 'fsync-directory', paths.blocksDir)
    const indexAt = persistActionIndex(retry, 'publish-file', projectJson)
    const after = await stat(blockPath)
    assert.equal(recovered.replayed, false)
    assert.equal(recovered.document.revision, 2)
    assert.equal(recovered.project.revision, derived.project.revision + 1)
    assert.equal(hasPersistAction(retry, 'publish-file', blockPath), false)
    assert.ok(syncAt >= 0)
    assert.ok(indexAt > syncAt)
    assert.equal(after.dev, identity.dev)
    assert.equal(after.ino, identity.ino)
    assert.equal(sha256Bytes(await readFile(blockPath)), sha256Bytes(published))
  } finally {
    setTrustedPersistObserver(null)
  }
})

test('a locked derived layer is rejected and an acknowledgement failure replays the committed write', async () => {
  const root = await tempRoot()
  const { imported, canvas } = await importedProject(root)
  const sourceId = imported.document.document_id
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: sourceId,
    sourceRevision: 1,
    payload: derivePayload(deriveOp, imported.project.revision, canvas.id, sourceId, 1),
    projectRoot: root,
    now,
  })
  const paths = resolveSpriteDocumentPaths({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    projectRoot: root,
  })
  const revisionPath = spriteDocumentRevisionPath(paths, 1)
  const manifest = JSON.parse(await readFile(revisionPath, 'utf8'))
  manifest.layers[manifest.layer_order[0]].locked = true
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(revisionPath, bytes)
  const projectPath = path.join(root, 'workspace', 'projects', imported.project.id, 'project.json')
  const project = await inlineHistoryFixture(JSON.parse(await readFile(projectPath, 'utf8')), root)
  project.sprite_documents[derived.document.document_id].revisions['1'].manifest_sha256 = sha256Bytes(bytes)
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`)
  const patch = Buffer.from([1, 2, 3, 4])
  await assert.rejects(
    () => writeWorkingPixels({
      projectId: imported.project.id,
      documentId: derived.document.document_id,
      operationId: writeOp,
      expectedRevision: project.revision,
      expectedWorkingRevision: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      rgba: patch,
      expectedSha256: sha256Bytes(patch),
      payload: {
        action: 'working_pixels',
        operation_id: writeOp,
        expected_revision: project.revision,
        expected_working_revision: 1,
        document_id: derived.document.document_id,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        expected_sha256: sha256Bytes(patch),
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'unsupported_input',
  )
})
