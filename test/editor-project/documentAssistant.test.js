import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { handleEditorProjectApi } from '../../src/editor-project/apiHandler.js'
import { createDocumentToolSession, documentHash } from '../../src/editor-project/documentToolSession.js'
import { createDocumentAssistant } from '../../src/editor-project/documentAssistant.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'
import { createEditorProjectV1, createSpriteDocumentFromUploadedPng, encodeRgbaPng, getSpriteDocument, readSpriteBlock, acceptDocumentCandidate, restoreWorkingSpriteDocument, changeWorkingStructure, writeWorkingPixels, detachCanvas, promoteProjectReference, revokeProjectReference, readVerifiedProjectReference, readProjectReferencePng } from '../../src/editor-project/spriteDocumentStore.js'
import { loadEditorProject } from '../../src/editor-project/projectStore.js'
import { validateEditorProject } from '../../src/editor-project/validation.js'
import { parsePromoteProjectReferenceRequest, parseRevokeProjectReferenceRequest, payloadSha256 } from '../../src/editor-project/spriteDocumentValidation.js'

function fixture() {
  const bytes = Uint8Array.from([10,20,30,255, 40,50,60,0, 70,80,90,128, 100,110,120,255])
  const hash = documentHash(bytes)
  const manifest = { document_id: 'd', revision: 1, canvas: { w: 4, h: 1 }, frame_order: ['f'], layer_order: ['l'],
    frames: { f: { id: 'f', duration_ms: 100 } }, layers: { l: { id: 'l', name: 'Source', kind: 'raster', visible: true, locked: false } },
    cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: { sha256: hash, w: 4, h: 1 } } }, tags: [], anchors: [] }
  return { manifest, bytes, blocks: new Map([[hash, bytes]]) }
}
const makeSession = (f, extra = {}) => createDocumentToolSession({ ...f, encodePng: encodeRgbaPng, ...extra })
const observe = (s, f = 'f') => s.call('read_image', { from: 'source', frame_id: f, layer_id: null, rect: null })
function split(manifest) {
  const frame_id = manifest.frame_order[0], layer_id = manifest.layer_order[0]
  return { canvas: { w: 3, h: 2 }, layers: [{ id: 'body', name: 'Body', visible: true }, { id: 'effects', name: 'Effects', visible: true }],
    frames: [0, 1].map(i => ({ id: `walk${i}`, duration_ms: 120 + 40 * i, cels: [{ layer_id: 'body', parts: [
      { from: 'source', frame_id, layer_id, rect: { x: i * 2, y: 0, w: 2, h: 1 }, at: { x: 1, y: 1 } },
    ] }] })) }
}
const request = (summary, action = 'read', operation_id = randomUUID()) => ({ action, candidate_id: summary.candidate_id, sha256: summary.sha256,
  canvas_id: summary.canvas_id, document_id: summary.document_id, expected_revision: summary.project_revision,
  expected_working_revision: summary.working_revision, operation_id })

test('AI composes exact crops and offsets into ordered frames/layers without changing source; failed batches are atomic', async () => {
  const f = fixture(), before = structuredClone(f.manifest), original = [...f.bytes], s = makeSession(f)
  assert.equal((await s.call('compose_document', split(f.manifest))).success, false, 'must inspect actual image first')
  assert.equal((await observe(s)).success, true)
  assert.equal((await s.call('compose_document', split(f.manifest))).success, true)
  const c = await s.candidate(), cell = Object.values(c.document.cels).find(c => c.frame_id === 'walk0' && c.layer_id === 'body')
  assert.deepEqual([...c.blocks.get(cell.block.sha256)], [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, ...original.slice(0, 8)])
  assert.deepEqual(c.document.frame_order, ['walk0', 'walk1']); assert.deepEqual(c.document.layer_order, ['body', 'effects'])
  assert.equal(c.document.frames.walk1.duration_ms, 160)
  const bad = split(f.manifest); bad.frames[1].cels[0].parts[0].at.x = 3
  assert.equal((await s.call('compose_document', bad)).success, false)
  assert.deepEqual((await s.candidate()).document, c.document)
  assert.equal((await s.call('edit_structure', { commands: JSON.stringify([{ type: 'move-frame', frame_id: 'walk1', index: 0 }, { type: 'rename-layer', layer_id: 'effects', name: 'FX' }]) })).success, true)
  assert.deepEqual((await s.candidate()).document.frame_order, ['walk1', 'walk0'])
  assert.deepEqual(f.manifest, before); assert.deepEqual([...f.bytes], original)
})

test('locks, budget, cancellation and source-version changes cannot be bypassed', async () => {
  const f = fixture(); f.manifest.layers.l.locked = true
  const locked = makeSession(f); await observe(locked)
  assert.equal((await locked.call('edit_structure', { commands: JSON.stringify([{ type: 'set-locked', layer_id: 'l', value: false }]) })).success, false)
  assert.equal((await locked.call('compose_document', split(f.manifest))).success, false)
  assert.equal(await locked.candidate(), null)
  const s = makeSession(fixture()); await observe(s)
  const big = split(fixture().manifest); big.canvas = { w: 1024, h: 1024 }; big.frames.push({ ...big.frames[0], id: 'third' })
  assert.equal((await s.call('compose_document', big)).success, false)
  for (let i = 2; i < 9; i++) await s.call('read_document', {})
  await assert.rejects(s.call('read_document', {}), { code: 'assistant_tool_blocked' })
  const controller = new AbortController(), aborted = makeSession(fixture(), { signal: controller.signal }); controller.abort()
  await assert.rejects(observe(aborted), { code: 'assistant_cancelled' })
  const changed = makeSession(fixture(), { checkCurrent: async () => { throw Object.assign(Error('changed'), { code: 'assistant_context_changed' }) } })
  await assert.rejects(observe(changed), { code: 'assistant_context_changed' })
})

function memoryService(extra = {}) {
  const f = fixture(), project = { id: 'p', revision: 1, canvases: { c: { document_id: 'd' } }, sprite_documents: { d: { working_revision: 1 } } }
  const scope = { projectId: 'p', workspaceRoot: '/document-fixture' }, body = { canvas_id: 'c', expected_revision: 1, expected_working_revision: 1 }
  const service = createDocumentAssistant({ load: async () => ({ project }), readDocument: async () => ({ manifest: f.manifest }), readBlock: async () => ({ bytes: f.bytes }), ...extra })
  const candidate = async () => { const grant = await service.prepare(scope, body), run = await service.begin(scope, { ...body, document_grant: grant.grant_id }); await observe(run.session); await run.session.call('compose_document', split(f.manifest)); return run.finish() }
  return { ...f, project, scope, body, service, candidate }
}
test('whole-document grants are single use and scoped; candidate limit is checked before a model session', async () => {
  const f = memoryService(), grant = await f.service.prepare(f.scope, f.body)
  await assert.rejects(f.service.begin({ ...f.scope, projectId: 'other' }, { ...f.body, document_grant: grant.grant_id }), { code: 'assistant_context_changed' })
  await f.service.begin(f.scope, { ...f.body, document_grant: grant.grant_id })
  await assert.rejects(f.service.begin(f.scope, { ...f.body, document_grant: grant.grant_id }), { code: 'assistant_context_changed' })
  let last
  for (let i = 0; i < 4; i++) last = await f.candidate()
  const fresh = await f.service.prepare(f.scope, f.body)
  await assert.rejects(f.service.begin(f.scope, { ...f.body, document_grant: fresh.grant_id }), { code: 'assistant_candidate_limit' })
  await f.service.candidate(f.scope, request(last, 'discard'))
  assert.ok(await f.service.begin(f.scope, { ...f.body, document_grant: fresh.grant_id }))
})
test('candidate ownership, hash, discard, expiry and definite/unknown save failures remain distinct', async () => {
  let time = 0, code = 'stale_revision'
  const f = memoryService({ now: () => time, accept: async () => { throw Object.assign(Error(code), { code }) } })
  let candidate = await f.candidate(), req = request(candidate, 'accept')
  await assert.rejects(f.service.candidate({ ...f.scope, projectId: 'other' }, req), { code: 'assistant_context_changed' })
  await assert.rejects(f.service.candidate(f.scope, { ...req, sha256: '0'.repeat(64) }), { code: 'assistant_context_changed' })
  await assert.rejects(f.service.candidate(f.scope, req), { code })
  assert.equal((await f.service.candidate(f.scope, { ...req, action: 'discard' })).discarded, true)
  candidate = await f.candidate(); req = request(candidate, 'accept'); code = 'storage_commit_failed'
  await assert.rejects(f.service.candidate(f.scope, req), { code })
  await assert.rejects(f.service.candidate(f.scope, { ...req, action: 'discard' }), { code: 'assistant_result_unknown' })
  await assert.rejects(f.service.candidate(f.scope, { ...req, operation_id: randomUUID() }), { code: 'assistant_operation_conflict' })
  candidate = await f.candidate(); time += 30 * 60 * 1000 + 1
  await assert.rejects(f.service.candidate(f.scope, request(candidate)), { code: 'candidate_expired' })
})

test('resolve waits for an in-flight save that loses its ACK, then verifies its receipt without another write', async () => {
  let finish, writes = 0, checks = 0
  const f = memoryService({ accept: async args => {
    if (!args.candidate) { checks++; return { receipt: f.project.operation_receipts[args.operationId] } }
    writes++; await new Promise(resolve => { finish = resolve })
    f.project.operation_receipts = { [args.operationId]: { payload_sha256: payloadSha256(args.payload) } }
    throw Object.assign(Error('Lost ACK'), { code: 'storage_commit_failed' })
  } })
  const candidate = await f.candidate(), req = request(candidate, 'accept')
  const saving = assert.rejects(f.service.candidate(f.scope, req), { code: 'storage_commit_failed' })
  await new Promise(resolve => setImmediate(resolve))
  const resolving = f.service.candidate(f.scope, { ...req, action: 'resolve' })
  finish(); await saving
  assert.equal((await resolving).saved, true); assert.equal(writes, 1); assert.equal(checks, 1)
})

test('linked cells cannot be split into inconsistent pixels and editable text is rejected before the model', async () => {
  const f = fixture(), m = f.manifest
  m.frame_order.push('f2'); m.frames.f2 = { id: 'f2', duration_ms: 100 }
  m.cels.c2 = { ...m.cels.c, id: 'c2', frame_id: 'f2' }; m.links = { copy_layers: ['l'], groups: { group: ['c', 'c2'] } }
  const s = makeSession(f); await observe(s)
  assert.equal((await s.call('compose_document', split(m))).success, false)
  assert.equal(await s.candidate(), null)
  const text = fixture(); text.manifest.text_objects = { version: 1, items: [{ id: 'text', frame_id: 'f', layer_id: 'l', text: 'A', x: 0, y: 0, size: 16,
    font: { kind: 'generic', name: 'sans-serif' }, color: '#fa0000ff', bold: false, italic: false, antialias: false, mode: 'fill', stroke_width: 1 }] }
  assert.throws(() => makeSession(text), { code: 'assistant_document_text_unsupported' })
})

async function storedFixture() {
  const projectRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gametool-document-ai-'))), operationId = randomUUID()
  const created = await createEditorProjectV1({ projectRoot, operationId, payload: { operation_id: operationId, name: 'Local candidate test' } })
  const scope = { projectRoot, workspaceRoot: path.join(projectRoot, 'workspace'), projectId: created.project.id }
  const bytes = fixture().bytes, pngBytes = encodeRgbaPng(4, 1, Buffer.from(bytes))
  const imported = await createSpriteDocumentFromUploadedPng({ ...scope, operationId: randomUUID(), expectedRevision: 1, expectedSha256: documentHash(pngBytes), pngBytes, name: 'Source', payload: { input: 'local fixture' } })
  const canvasId = Object.values(imported.project.canvases).find(c => c.document_id === imported.document.document_id).id
  return { scope, imported, canvasId, bytes }
}
test('original is preserved; one atomic candidate save, ACK replay after service restart, editable resize and undo/redo', async () => {
  const f = await storedFixture(), m = f.imported.document
  const scope = f.scope, body = { canvas_id: f.canvasId, expected_revision: 2, expected_working_revision: 1 }
  const service = createDocumentAssistant({ accept: args => acceptDocumentCandidate({ ...args, fault: 'ack' }) })
  const grant = await service.prepare(scope, body), run = await service.begin(scope, { ...body, document_grant: grant.grant_id })
  await observe(run.session, m.frame_order[0]); assert.equal((await run.session.call('compose_document', split(m))).success, true)
  const summary = await run.finish(), req = request(summary, 'accept')
  assert.equal((await loadEditorProject(scope)).project.revision, 2, 'candidate preview writes no project data')
  await assert.rejects(service.candidate(scope, req), { code: 'storage_commit_failed' })
  const restarted = createDocumentAssistant(), saved = await restarted.candidate(scope, req)
  assert.equal(saved.replayed, true); assert.equal(saved.project.revision, 3)
  assert.equal(Object.keys(saved.project.canvases).length, 2)
  assert.notEqual(saved.document.document_id, m.document_id)
  assert.deepEqual((await getSpriteDocument({ ...scope, documentId: m.document_id })).manifest, m)
  const originalCel = Object.values(m.cels)[0]
  assert.deepEqual([...(await readSpriteBlock({ ...scope, documentId: m.document_id, sha256: originalCel.block.sha256 })).bytes], [...f.bytes])
  assert.equal((await restarted.candidate(scope, { ...req, action: 'resolve' })).saved, true)
  const doc = saved.document, blocks = new Map()
  for (const cel of Object.values(doc.cels)) if (cel.block) blocks.set(cel.block.sha256, (await readSpriteBlock({ ...scope, documentId: doc.document_id, sha256: cel.block.sha256 })).bytes)
  const s = makeSession({ manifest: doc, blocks }); await observe(s, doc.frame_order[0])
  const resize = { canvas: { w: 4, h: 2 }, layers: doc.layer_order.map(id => ({ id, name: doc.layers[id].name, visible: true })), frames: doc.frame_order.map(id => ({ id, duration_ms: doc.frames[id].duration_ms, cels: doc.layer_order.map(layer_id => ({ layer_id, parts: [{ from: 'source', frame_id: id, layer_id, rect: { x: 0, y: 0, w: 3, h: 2 }, at: { x: 0, y: 0 } }] })) })) }
  assert.equal((await s.call('compose_document', resize)).success, true)
  const edited = await acceptDocumentCandidate({ ...scope, documentId: doc.document_id, canvasId: saved.canvas.id, operationId: randomUUID(), expectedRevision: 3, expectedWorkingRevision: 1, payload: { edit: 'resize' }, candidate: await s.candidate() })
  assert.equal(edited.document.revision, 2); assert.equal(edited.project.revision, 4); assert.equal(Object.keys(edited.project.canvases).length, 2)
  const undo = await restoreWorkingSpriteDocument({ ...scope, documentId: doc.document_id, operationId: randomUUID(), expectedRevision: 4, expectedWorkingRevision: 2, targetRevision: 1, mode: 'structure', payload: { undo: true } })
  assert.deepEqual(undo.document.canvas, { w: 3, h: 2 }); assert.deepEqual(undo.document.cels, doc.cels)
  const redo = await restoreWorkingSpriteDocument({ ...scope, documentId: doc.document_id, operationId: randomUUID(), expectedRevision: 5, expectedWorkingRevision: 3, targetRevision: 2, mode: 'structure', payload: { redo: true } })
  assert.deepEqual(redo.document.canvas, { w: 4, h: 2 }); assert.deepEqual(redo.document.cels, edited.document.cels)
})

test('formal assistant dispatch uses new tools and permission, yields a candidate, and never runs twice for the same operation', async () => {
  const f = await storedFixture(), service = createAssistantConversations({ records: null, adapters: { astra: async ({ pixelTools, message }) => {
    runs++; assert.match(message, /compose_document/); assert.equal(pixelTools.tools.length, 5)
    await observe(pixelTools, f.imported.document.frame_order[0]); assert.equal((await pixelTools.call('compose_document', split(f.imported.document))).success, true)
    return { status: 'completed', provider: 'codex', model: 'gpt-6-astra', threadId: 'local-test', reply: 'Two frames; timing is provisional.' }
  } } })
  let runs = 0
  const opened = await service.open(f.scope, { provider: 'astra' })
  const body = { canvas_id: f.canvasId, expected_revision: 2, expected_working_revision: 1 }
  const grant = await service.prepareDocument(f.scope, body)
  const req = { ...body, conversation: opened.conversation, operation_id: randomUUID(), message: 'Split into two frames.', document_mode: true, document_grant: grant.grant_id }
  await assert.rejects(service.send(f.scope, { ...req, document_grant: 'old_grant' }), { code: 'invalid_assistant_message' })
  const result = await service.send(f.scope, req)
  assert.equal(result.document_candidate.frames, 2); assert.equal(result.document_candidate.saved, false)
  assert.deepEqual((await service.send(f.scope, req)).document_candidate, result.document_candidate); assert.equal(runs, 1)
  assert.equal((await loadEditorProject(f.scope)).project.revision, 2)
})

test('N4 scoped frame revisions lock non-selected frames, reject cross-scope linked cel groups, and support structure Undo', async () => {
  const f = fixture(), m = f.manifest
  const f2Bytes = Uint8Array.from([200, 10, 10, 255, 0, 200, 10, 255, 10, 10, 200, 255, 255, 255, 0, 255])
  const f2Hash = documentHash(f2Bytes)
  m.frame_order.push('f2', 'f3')
  m.frames.f2 = { id: 'f2', duration_ms: 140 }
  m.frames.f3 = { id: 'f3', duration_ms: 180 }
  m.cels.c2 = { id: 'c2', frame_id: 'f2', layer_id: 'l', block: { sha256: f2Hash, w: 4, h: 1 } }
  m.cels.c3 = { id: 'c3', frame_id: 'f3', layer_id: 'l', block: null }
  f.blocks.set(f2Hash, f2Bytes)

  // Cross-scope linked cel group (f and f2 linked while only f is editable) must be rejected with unsupported_input
  const crossLinked = structuredClone(m)
  crossLinked.cels.c2.block = structuredClone(crossLinked.cels.c.block)
  crossLinked.links = { copy_layers: ['l'], groups: { g1: ['c', 'c2'] } }
  assert.throws(
    () => makeSession({ manifest: crossLinked, blocks: f.blocks }, { editableFrameIds: ['f'] }),
    err => err.code === 'unsupported_input' && /span selected and locked frames/i.test(err.message) && /Source/.test(err.message),
  )

  // Scoped session with editable_frame_ids: ['f2'] locks 'f' and 'f3'
  const scoped = makeSession(f, { editableFrameIds: ['f2'] })
  const docRead = JSON.parse((await scoped.call('read_document', {})).contentItems[0].text)
  assert.deepEqual(docRead.editable_frame_ids, ['f2'])
  assert.deepEqual(docRead.locked_frame_ids, ['f', 'f3'])
  await observe(scoped, 'f2')

  // Reject structural commands that resize, reorder, add/delete frames or layers, or modify locked frame duration
  assert.equal((await scoped.call('edit_structure', { commands: JSON.stringify([{ type: 'add-frame' }]) })).success, false)
  assert.equal((await scoped.call('edit_structure', { commands: JSON.stringify([{ type: 'move-frame', frame_id: 'f2', index: 0 }]) })).success, false)
  assert.equal((await scoped.call('edit_structure', { commands: JSON.stringify([{ type: 'set-duration', frame_id: 'f', duration_ms: 250 }]) })).success, false)

  // Reject compose_document that alters locked frame 'f' pixels or locked frame 'f3' null cel
  const badLockedPixels = {
    canvas: { w: 4, h: 1 },
    layers: [{ id: 'l', name: 'Source', visible: true }],
    frames: [
      { id: 'f', duration_ms: 100, cels: [{ layer_id: 'l', parts: [] }] },
      { id: 'f2', duration_ms: 160, cels: [{ layer_id: 'l', parts: null }] },
      { id: 'f3', duration_ms: 180, cels: [{ layer_id: 'l', parts: null }] },
    ],
  }
  assert.equal((await scoped.call('compose_document', badLockedPixels)).success, false)

  // Allow compose_document that retains locked frames ('f' and 'f3') with parts:null and edits 'f2'
  const validScopedCompose = {
    canvas: { w: 4, h: 1 },
    layers: [{ id: 'l', name: 'Source', visible: true }],
    frames: [
      { id: 'f', duration_ms: 100, cels: [{ layer_id: 'l', parts: null }] },
      { id: 'f2', duration_ms: 220, cels: [{ layer_id: 'l', parts: [{ from: 'source', frame_id: 'f', layer_id: 'l', rect: { x: 0, y: 0, w: 2, h: 1 }, at: { x: 2, y: 0 } }] }] },
      { id: 'f3', duration_ms: 180, cels: [{ layer_id: 'l', parts: null }] },
    ],
  }
  assert.equal((await scoped.call('compose_document', validScopedCompose)).success, true)
  const cand = await scoped.candidate()
  assert.deepEqual(cand.editableFrameIds, ['f2'])
  assert.deepEqual(cand.document.cels.c, m.cels.c)
  assert.equal(cand.document.cels.c3.block, null)
  assert.equal(cand.document.frames.f2.duration_ms, 220)
  assert.notEqual(cand.document.cels.c2.block.sha256, f2Hash)
})

test('N4 persistent project references: promote, reopen, verify after source detach, consume in Canvas & timeline, revoke, and enforce limits', async () => {
  const f = await storedFixture()
  const { scope, canvasId } = f
  const sourceDoc = f.imported.document
  const sourceDocId = sourceDoc.document_id

  // Promote a working copy with 2 frames so we can test both scoped frame revision and reference promotion
  const splitCand = makeSession({ manifest: f.imported.document, blocks: new Map([[Object.values(f.imported.document.cels)[0].block.sha256, f.bytes]]) })
  await observe(splitCand, f.imported.document.frame_order[0])
  assert.equal((await splitCand.call('compose_document', split(f.imported.document))).success, true)
  const derived = await acceptDocumentCandidate({
    ...scope,
    documentId: sourceDocId,
    canvasId,
    operationId: randomUUID(),
    expectedRevision: 2,
    expectedWorkingRevision: 1,
    payload: { action: 'derive' },
    candidate: await splitCand.candidate(),
  })
  const workingCanvasId = derived.canvas.id
  const workingDocId = derived.document.document_id

  // Promote frame_composite reference from working document frame walk0
  const promoteOpId = randomUUID()
  const promoteBody = parsePromoteProjectReferenceRequest({
    operation_id: promoteOpId,
    expected_revision: derived.project.revision,
    canvas_id: workingCanvasId,
    document_id: workingDocId,
    working_revision: derived.document.revision,
    frame_id: 'walk0',
    source_kind: 'frame_composite',
    purpose: 'character',
    name: 'Hero Idle Ref',
  })
  const promoted = await promoteProjectReference({
    ...scope,
    operationId: promoteBody.operation_id,
    expectedRevision: promoteBody.expected_revision,
    canvasId: promoteBody.canvas_id,
    documentId: promoteBody.document_id,
    workingRevision: promoteBody.working_revision,
    frameId: promoteBody.frame_id,
    layerId: promoteBody.layer_id,
    sourceKind: promoteBody.source_kind,
    purpose: promoteBody.purpose,
    name: promoteBody.name,
    payload: promoteBody.payload,
  })
  assert.equal(promoted.replayed, false)
  assert.equal(promoted.reference.status, 'active')
  assert.equal(promoted.reference.purpose, 'character')
  assert.equal(promoted.reference.name, 'Hero Idle Ref')
  assert.equal(validateEditorProject(promoted.project).status, 'pass')

  // Idempotent replay of the same operation_id returns replayed: true without adding a duplicate
  const replayedPromote = await promoteProjectReference({
    ...scope,
    operationId: promoteBody.operation_id,
    expectedRevision: promoteBody.expected_revision,
    canvasId: promoteBody.canvas_id,
    documentId: promoteBody.document_id,
    workingRevision: promoteBody.working_revision,
    frameId: promoteBody.frame_id,
    layerId: promoteBody.layer_id,
    sourceKind: promoteBody.source_kind,
    purpose: promoteBody.purpose,
    name: promoteBody.name,
    payload: promoteBody.payload,
  })
  assert.equal(replayedPromote.replayed, true)
  assert.equal(replayedPromote.project.references.length, 1)

  // Promote cel reference from frame walk1 layer body
  const celPromoteBody = parsePromoteProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: promoted.project.revision,
    canvas_id: workingCanvasId,
    document_id: workingDocId,
    working_revision: derived.document.revision,
    frame_id: 'walk1',
    layer_id: 'body',
    source_kind: 'cel',
    purpose: 'cel',
    name: 'Walk1 Body Cel',
  })
  const promotedCel = await promoteProjectReference({
    ...scope,
    operationId: celPromoteBody.operation_id,
    expectedRevision: celPromoteBody.expected_revision,
    canvasId: celPromoteBody.canvas_id,
    documentId: celPromoteBody.document_id,
    workingRevision: celPromoteBody.working_revision,
    frameId: celPromoteBody.frame_id,
    layerId: celPromoteBody.layer_id,
    sourceKind: celPromoteBody.source_kind,
    purpose: celPromoteBody.purpose,
    name: celPromoteBody.name,
    payload: celPromoteBody.payload,
  })
  assert.equal(promotedCel.project.references.length, 2)

  // Promote reference from the original imported canvasId, then detach canvasId and verify the reference still loads and works in Canvas & timeline
  const sourcePromoteBody = parsePromoteProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: promotedCel.project.revision,
    canvas_id: canvasId,
    document_id: sourceDoc.document_id,
    working_revision: sourceDoc.revision,
    frame_id: sourceDoc.frame_order[0],
    source_kind: 'frame_composite',
    purpose: 'palette',
    name: 'Detached Source Canvas Ref',
  })
  const promotedSource = await promoteProjectReference({
    ...scope,
    operationId: sourcePromoteBody.operation_id,
    expectedRevision: sourcePromoteBody.expected_revision,
    canvasId: sourcePromoteBody.canvas_id,
    documentId: sourcePromoteBody.document_id,
    workingRevision: sourcePromoteBody.working_revision,
    frameId: sourcePromoteBody.frame_id,
    layerId: sourcePromoteBody.layer_id,
    sourceKind: sourcePromoteBody.source_kind,
    purpose: sourcePromoteBody.purpose,
    name: sourcePromoteBody.name,
    payload: sourcePromoteBody.payload,
  })
  assert.equal(promotedSource.project.references.length, 3)

  const detached = await detachCanvas({
    ...scope,
    canvasId,
    operationId: randomUUID(),
    expectedRevision: promotedSource.project.revision,
    payload: { action: 'detach_source' },
  })
  assert.equal(detached.project.canvases[canvasId], undefined)
  const reopened = await loadEditorProject(scope)
  assert.equal(reopened.project.references.length, 3)
  const pngResult = await readProjectReferencePng({ ...scope, referenceId: promoted.reference.id })
  assert.equal(pngResult.sha256, promoted.reference.rgba_sha256)
  assert.ok(pngResult.pngBytes.length > 0)
  const detachedSourcePng = await readProjectReferencePng({ ...scope, referenceId: promotedSource.reference.id })
  assert.equal(detachedSourcePng.sha256, promotedSource.reference.rgba_sha256)
  assert.ok(detachedSourcePng.pngBytes.length > 0)

  // Consume selected references (including detached source canvas ref) + scoped editable_frame_ids in a formal Canvas & timeline turn
  let observedRefs = null
  let adapterCallCount = 0
  let injectAckFault = false
  const service = createAssistantConversations({
    records: null,
    documentAssistant: createDocumentAssistant({
      accept: args => acceptDocumentCandidate({ ...args, fault: injectAckFault ? 'ack' : null }),
    }),
    adapters: {
      astra: async ({ pixelTools, message }) => {
        adapterCallCount += 1
        assert.match(message, /editable_frame_ids/)
        assert.match(message, /Hero Idle Ref/)
        assert.match(message, /Detached Source Canvas Ref/)
        const docInfo = JSON.parse((await pixelTools.call('read_document', {})).contentItems[0].text)
        observedRefs = docInfo.references
        assert.deepEqual(docInfo.editable_frame_ids, ['walk1'])
        assert.deepEqual(docInfo.locked_frame_ids, ['walk0'])
        const refImg = await pixelTools.call('read_image', { from: 'reference', frame_id: promoted.reference.id, layer_id: null, rect: null })
        assert.equal(refImg.success, true)
        const detachedRefImg = await pixelTools.call('read_image', { from: 'reference', frame_id: promotedSource.reference.id, layer_id: null, rect: null })
        assert.equal(detachedRefImg.success, true)
        const composed = await pixelTools.call('compose_document', {
          canvas: { w: 3, h: 2 },
          layers: [
            { id: 'body', name: 'Body', visible: true },
            { id: 'effects', name: 'Effects', visible: true },
          ],
          frames: [
            { id: 'walk0', duration_ms: 120, cels: [{ layer_id: 'body', parts: null }, { layer_id: 'effects', parts: null }] },
            {
              id: 'walk1',
              duration_ms: 180,
              cels: [
                { layer_id: 'body', parts: [{ from: 'reference', frame_id: promoted.reference.id, layer_id: null, rect: { x: 0, y: 0, w: 3, h: 2 }, at: { x: 0, y: 0 } }] },
                { layer_id: 'effects', parts: null },
              ],
            },
          ],
        })
        assert.equal(composed.success, true)
        return { status: 'completed', provider: 'codex', model: 'gpt-6-astra', threadId: 'local-n4', reply: 'Copied reference into walk1 while keeping walk0 locked.' }
      },
    },
  })
  const opened = await service.open(scope, { provider: 'astra' })
  const prepBody = {
    canvas_id: workingCanvasId,
    expected_revision: detached.project.revision,
    expected_working_revision: derived.document.revision,
    editable_frame_ids: ['walk1'],
    reference_ids: [promoted.reference.id, promotedSource.reference.id],
  }
  const grant = await service.prepareDocument(scope, prepBody)
  assert.deepEqual(grant.editable_frame_ids, ['walk1'])
  assert.deepEqual(grant.locked_frame_ids, ['walk0'])
  assert.deepEqual(grant.reference_ids, [promoted.reference.id, promotedSource.reference.id])

  const turnRes = await service.send(scope, {
    ...prepBody,
    conversation: opened.conversation,
    operation_id: randomUUID(),
    message: 'Copy the Hero Idle Ref into frame walk1.',
    document_mode: true,
    document_grant: grant.grant_id,
  })
  assert.equal(observedRefs?.length, 2)
  assert.equal(observedRefs[0].id, promoted.reference.id)
  assert.equal(observedRefs[1].id, promotedSource.reference.id)
  assert.deepEqual(turnRes.document_candidate.editable_frame_ids, ['walk1'])
  assert.deepEqual(turnRes.document_candidate.used_reference_ids, [promoted.reference.id, promotedSource.reference.id])

  // R3: Omitting expected_editable_frame_ids on a scoped candidate accept/resolve is rejected BEFORE first write
  await assert.rejects(
    service.documentCandidate(scope, { ...request(turnRes.document_candidate, 'accept') }),
    { code: 'assistant_context_changed' },
  )
  await assert.rejects(
    service.documentCandidate(scope, { ...request(turnRes.document_candidate, 'resolve') }),
    { code: 'assistant_context_changed' },
  )
  await assert.rejects(
    service.documentCandidate(scope, { ...request(turnRes.document_candidate, 'read'), expected_editable_frame_ids: ['walk0'] }),
    { code: 'assistant_context_changed' },
  )
  const readScoped = await service.documentCandidate(scope, { ...request(turnRes.document_candidate, 'read'), expected_editable_frame_ids: ['walk1'] })
  assert.deepEqual(readScoped.editable_frame_ids, ['walk1'])

  // R3: Accept commits once; then after candidate cache is lost / service recreated,
  // replaying the same operation_id + expected_editable_frame_ids via accept and resolve returns the committed receipt with 0 extra revisions or model calls
  const acceptReq = { ...request(turnRes.document_candidate, 'accept'), expected_editable_frame_ids: ['walk1'] }
  const firstAccepted = await service.documentCandidate(scope, acceptReq)
  assert.equal(firstAccepted.replayed, false)
  assert.equal(firstAccepted.document.revision, 2)
  const restartedService = createAssistantConversations({
    records: null,
    adapters: {
      astra: async () => {
        adapterCallCount += 1
        throw new Error('Must not call model during candidate recovery')
      },
    },
  })
  const accepted = await restartedService.documentCandidate(scope, acceptReq)
  assert.equal(accepted.replayed, true)
  assert.equal(accepted.project.revision, firstAccepted.project.revision)
  assert.equal(accepted.document.revision, 2)
  const resolvedReplay = await restartedService.documentCandidate(scope, { ...acceptReq, action: 'resolve' })
  assert.equal(resolvedReplay.saved, true)
  assert.equal(resolvedReplay.receipt.document_revision, 2)
  assert.equal(adapterCallCount, 1)

  // R3: Direct documentAssistant scoped candidate with ACK loss (fault: 'ack') + cache wipe / restart recovery
  const ackFaultAssistant = createDocumentAssistant({
    accept: args => acceptDocumentCandidate({ ...args, fault: 'ack' }),
  })
  const ackPrepBody = {
    canvas_id: workingCanvasId,
    expected_revision: accepted.project.revision,
    expected_working_revision: accepted.document.revision,
    editable_frame_ids: ['walk1'],
  }
  const ackGrant = await ackFaultAssistant.prepare(scope, ackPrepBody)
  const ackRun = await ackFaultAssistant.begin(scope, { ...ackPrepBody, document_grant: ackGrant.grant_id })
  await observe(ackRun.session, 'walk1')
  assert.equal((await ackRun.session.call('edit_structure', {
    commands: JSON.stringify([{ type: 'set-duration', frame_id: 'walk1', duration_ms: 180 }]),
  })).success, true)
  const ackSummary = await ackRun.finish()
  const ackReq = { ...request(ackSummary, 'accept'), expected_editable_frame_ids: ['walk1'] }
  await assert.rejects(
    ackFaultAssistant.candidate(scope, ackReq),
    err => err.code === 'storage_commit_failed',
  )
  const recoveredAssistant = createDocumentAssistant()
  await assert.rejects(
    recoveredAssistant.candidate(scope, request(ackSummary, 'accept', ackReq.operation_id)),
    { code: 'operation_conflict' },
  )
  const recoveredAccept = await recoveredAssistant.candidate(scope, ackReq)
  assert.equal(recoveredAccept.replayed, true)
  const recoveredResolve = await recoveredAssistant.candidate(scope, { ...ackReq, action: 'resolve' })
  assert.equal(recoveredResolve.saved, true)
  accepted.project = recoveredAccept.project
  accepted.document = recoveredAccept.document
  const walk0CelAfter = Object.values(accepted.document.cels).find(c => c.frame_id === 'walk0' && c.layer_id === 'body')
  const walk1CelAfter = Object.values(accepted.document.cels).find(c => c.frame_id === 'walk1' && c.layer_id === 'body')
  const walk0CelBefore = Object.values(derived.document.cels).find(c => c.frame_id === 'walk0' && c.layer_id === 'body')
  assert.deepEqual(walk0CelAfter, walk0CelBefore)
  assert.equal(walk1CelAfter.block.sha256, promoted.reference.rgba_sha256)

  // Undo restores revision 1 structure and pixels
  const undone = await restoreWorkingSpriteDocument({
    ...scope,
    documentId: workingDocId,
    operationId: randomUUID(),
    expectedRevision: accepted.project.revision,
    expectedWorkingRevision: accepted.document.revision,
    targetRevision: 1,
    mode: 'structure',
    payload: { action: 'undo_scoped' },
  })
  assert.deepEqual(undone.document.cels, derived.document.cels)

  // Revoke reference and verify revoked reference is rejected when selected in prepareDocument
  const revokeBody = parseRevokeProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: undone.project.revision,
  }, promoted.reference.id)
  const revoked = await revokeProjectReference({
    ...scope,
    referenceId: promoted.reference.id,
    operationId: revokeBody.operation_id,
    expectedRevision: revokeBody.expected_revision,
    payload: revokeBody.payload,
  })
  assert.equal(revoked.reference.status, 'revoked')
  await assert.rejects(
    service.prepareDocument(scope, {
      canvas_id: workingCanvasId,
      expected_revision: revoked.project.revision,
      expected_working_revision: undone.document.revision,
      reference_ids: [promoted.reference.id],
    }),
    err => err.code === 'unsupported_input' && /revoked/i.test(err.message),
  )
})

test('N4 store-level locked frame check, reference HTTP routes, provenance integrity checks, and 64/8 limits', async () => {
  const f = await storedFixture()
  const { scope, canvasId } = f
  const sourceDoc = f.imported.document

  // Derive 2-frame working document
  const splitCand = makeSession({ manifest: sourceDoc, blocks: new Map([[Object.values(sourceDoc.cels)[0].block.sha256, f.bytes]]) })
  await observe(splitCand, sourceDoc.frame_order[0])
  await splitCand.call('compose_document', split(sourceDoc))
  const derived = await acceptDocumentCandidate({
    ...scope,
    documentId: sourceDoc.document_id,
    canvasId,
    operationId: randomUUID(),
    expectedRevision: 2,
    expectedWorkingRevision: 1,
    payload: { action: 'derive' },
    candidate: await splitCand.candidate(),
  })

  // Tampered candidate that modifies locked frame walk0 is rejected by acceptDocumentCandidate
  const tamperedDoc = structuredClone(derived.document)
  tamperedDoc.frames.walk0.duration_ms = 999
  const tamperedCandidate = {
    document: tamperedDoc,
    blocks: new Map(),
    editableFrameIds: ['walk1'],
  }
  await assert.rejects(
    acceptDocumentCandidate({
      ...scope,
      documentId: derived.document.document_id,
      canvasId: derived.canvas.id,
      operationId: randomUUID(),
      expectedRevision: derived.project.revision,
      expectedWorkingRevision: derived.document.revision,
      payload: { action: 'tampered' },
      candidate: tamperedCandidate,
    }),
    err => err.code === 'unsupported_input' && /Locked frame walk0/i.test(err.message),
  )

  // HTTP route helper
  async function callApi(method, urlPath, bodyObj = null) {
    const raw = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : Buffer.alloc(0)
    const req = Object.assign(Readable.from(raw.length ? [raw] : []), {
      method,
      url: urlPath,
      headers: {
        host: '127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
        'x-editor-storage-version': '2',
        ...(bodyObj ? { 'content-type': 'application/json', 'content-length': String(raw.length) } : {}),
      },
      socket: { remoteAddress: '127.0.0.1' },
    })
    let status = 200
    let headers = {}
    const chunks = []
    const res = {
      writeHead(code, hdrs = {}) { status = code; headers = hdrs },
      end(chunk) { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) },
    }
    await handleEditorProjectApi(req, res, {
      projectRoot: scope.projectRoot,
      workspaceRoot: scope.workspaceRoot,
      artifactAccessRegistry: { register: () => {}, has: () => false },
    })
    const buf = Buffer.concat(chunks)
    return {
      status,
      headers,
      buffer: buf,
      json: String(headers['content-type'] || '').includes('application/json') ? JSON.parse(buf.toString('utf8')) : null,
    }
  }

  const createRefRes = await callApi('POST', `/api/editor/projects/${scope.projectId}/references`, {
    operation_id: randomUUID(),
    expected_revision: derived.project.revision,
    canvas_id: derived.canvas.id,
    document_id: derived.document.document_id,
    working_revision: derived.document.revision,
    frame_id: 'walk0',
    source_kind: 'frame_composite',
    purpose: 'style',
    name: 'HTTP Style Ref',
  })
  assert.equal(createRefRes.status, 201)
  assert.equal(createRefRes.json.reference.purpose, 'style')

  const pngRes = await callApi('GET', `/api/editor/projects/${scope.projectId}/references/${createRefRes.json.reference.id}/png`)
  assert.equal(pngRes.status, 200)
  assert.equal(pngRes.headers['content-type'], 'image/png')
  assert.equal(pngRes.headers['X-Reference-Sha256'], createRefRes.json.reference.rgba_sha256)

  // Turn reference limit > 8 is rejected with resource_limit
  const assistant = createDocumentAssistant()
  await assert.rejects(
    assistant.prepare(scope, {
      canvas_id: derived.canvas.id,
      expected_revision: createRefRes.json.project.revision,
      expected_working_revision: derived.document.revision,
      reference_ids: Array.from({ length: 9 }, (_, i) => `ref_${i}`),
    }),
    { code: 'resource_limit' },
  )

  // Corrupting the reference block on disk triggers artifact_integrity_failed
  const refBlockPath = path.join(
    scope.workspaceRoot,
    'projects',
    scope.projectId,
    'sprite-documents',
    derived.document.document_id,
    'blocks',
    `${createRefRes.json.reference.rgba_sha256}.rgba`,
  )
  await writeFile(refBlockPath, Buffer.alloc(24, 0xff))
  await assert.rejects(
    readVerifiedProjectReference({ ...scope, referenceId: createRefRes.json.reference.id }),
    { code: 'artifact_integrity_failed' },
  )

  // Revoke via HTTP route
  const revokeRes = await callApi('POST', `/api/editor/projects/${scope.projectId}/references/${createRefRes.json.reference.id}/revoke`, {
    operation_id: randomUUID(),
    expected_revision: createRefRes.json.project.revision,
  })
  assert.equal(revokeRes.status, 200)
  assert.equal(revokeRes.json.reference.status, 'revoked')
})

test('R1 & R5: shared layer metadata, locked-frame tags, link-copy policy, and 64-record reference cap', async () => {
  const f = await storedFixture()
  const { scope, canvasId } = f
  const sourceDoc = f.imported.document

  // Create a 3-frame (walk0, walk1, walk2) working document with 2 layers (body, effects)
  const initSession = makeSession({
    manifest: sourceDoc,
    blocks: new Map([[Object.values(sourceDoc.cels)[0].block.sha256, f.bytes]]),
  })
  await observe(initSession, sourceDoc.frame_order[0])
  const srcFrame = sourceDoc.frame_order[0]
  const srcLayer = sourceDoc.layer_order[0]
  assert.equal((await initSession.call('compose_document', {
    canvas: { w: 3, h: 2 },
    layers: [
      { id: 'body', name: 'Body', visible: true },
      { id: 'effects', name: 'Effects', visible: true },
    ],
    frames: ['walk0', 'walk1', 'walk2'].map((fid, idx) => ({
      id: fid,
      duration_ms: 100 + idx * 20,
      cels: [
        {
          layer_id: 'body',
          parts: [{ from: 'source', frame_id: srcFrame, layer_id: srcLayer, rect: { x: 0, y: 0, w: 2, h: 1 }, at: { x: 1, y: 1 } }],
        },
      ],
    })),
  })).success, true)

  const derived = await acceptDocumentCandidate({
    ...scope,
    documentId: sourceDoc.document_id,
    canvasId,
    operationId: randomUUID(),
    expectedRevision: 2,
    expectedWorkingRevision: 1,
    payload: { action: 'derive_3frame' },
    candidate: await initSession.candidate(),
  })
  const docId = derived.document.document_id
  const workCanvasId = derived.canvas.id
  let projRev = derived.project.revision
  let workRev = derived.document.revision

  // Add tags ('idle' covering walk0..walk1, 'fx' covering walk1..walk1), enable link copies on 'body', and link walk0 + walk2 on 'body'
  for (const command of [
    { type: 'add-tag', name: 'idle', from_frame_id: 'walk0', to_frame_id: 'walk1', direction: 'forward' },
    { type: 'add-tag', name: 'fx', from_frame_id: 'walk1', to_frame_id: 'walk1', direction: 'forward' },
    { type: 'set-layer-link-copies', layer_id: 'body', value: true },
    { type: 'link-cels', layer_id: 'body', source_frame_id: 'walk0', target_frame_id: 'walk2' },
  ]) {
    const res = await changeWorkingStructure({
      ...scope,
      documentId: docId,
      operationId: randomUUID(),
      expectedRevision: projRev,
      expectedWorkingRevision: workRev,
      command,
      payload: { command },
    })
    projRev = res.project.revision
    workRev = res.document.revision
  }
  const baseDoc = (await getSpriteDocument({ ...scope, documentId: docId, revision: workRev })).manifest
  const idleTag = baseDoc.tags.find(t => t.name === 'idle')
  const fxTag = baseDoc.tags.find(t => t.name === 'fx')
  assert.ok(idleTag && fxTag)
  const baseBlocks = new Map()
  for (const cel of Object.values(baseDoc.cels)) {
    if (cel.block && !baseBlocks.has(cel.block.sha256)) {
      const b = await readSpriteBlock({ ...scope, documentId: docId, sha256: cel.block.sha256 })
      baseBlocks.set(cel.block.sha256, b.bytes)
    }
  }

  // Scoped tool session: only walk1 is editable; walk0 and walk2 are locked
  const scopedSession = makeSession(
    { manifest: baseDoc, blocks: baseBlocks },
    { editableFrameIds: ['walk1'] },
  )
  await observe(scopedSession, 'walk1')

  // 1. Structure commands mutating shared layer metadata, link-copy policy, or locked-frame tags are rejected
  for (const badCmd of [
    { type: 'set-visible', layer_id: 'body', value: false },
    { type: 'set-locked', layer_id: 'body', value: true },
    { type: 'rename-layer', layer_id: 'body', name: 'HiddenBody' },
    { type: 'set-layer-link-copies', layer_id: 'body', value: false },
    { type: 'update-tag', tag_id: idleTag.id, name: 'idle-mod', from_frame_id: 'walk0', to_frame_id: 'walk1', direction: 'forward' },
    { type: 'delete-tag', tag_id: idleTag.id },
    { type: 'add-tag', name: 'bad-span', from_frame_id: 'walk1', to_frame_id: 'walk2', direction: 'forward' },
  ]) {
    const res = await scopedSession.call('edit_structure', { commands: JSON.stringify([badCmd]) })
    assert.equal(res.success, false, `Expected ${badCmd.type} to be rejected in scoped mode`)
  }

  // 2. compose_document attempting to hide or rename shared layer 'body' is rejected
  const hideLayerCompose = await scopedSession.call('compose_document', {
    canvas: { w: 3, h: 2 },
    layers: [
      { id: 'body', name: 'Body', visible: false },
      { id: 'effects', name: 'Effects', visible: true },
    ],
    frames: ['walk0', 'walk1', 'walk2'].map(fid => ({
      id: fid,
      duration_ms: baseDoc.frames[fid].duration_ms,
      cels: [
        { layer_id: 'body', parts: [{ from: 'source', frame_id: fid, layer_id: 'body', rect: { x: 0, y: 0, w: 3, h: 2 }, at: { x: 0, y: 0 } }] },
      ],
    })),
  })
  assert.equal(hideLayerCompose.success, false)
  assert.match(hideLayerCompose.contentItems[0].text, /Shared layer/i)

  // 3. Bypassing tool layer and submitting tampered candidates directly to acceptDocumentCandidate is rejected
  const tamperChecks = [
    {
      label: 'hide shared layer',
      mutate(doc) { doc.layers.body.visible = false },
      match: /Shared layer/i,
    },
    {
      label: 'rename shared layer',
      mutate(doc) { doc.layers.body.name = 'Renamed' },
      match: /Shared layer/i,
    },
    {
      label: 'lock shared layer',
      mutate(doc) { doc.layers.body.locked = true },
      match: /Shared layer/i,
    },
    {
      label: 'change link-copy policy',
      mutate(doc) { doc.links.copy_layers = [] },
      match: /link-copy policy cannot be changed/i,
    },
    {
      label: 'unlink locked frames walk0 and walk2',
      mutate(doc) { doc.links.groups = {} },
      match: /Locked frame walk0 linked cel membership/i,
    },
    {
      label: 'modify tag covering locked frame walk0',
      mutate(doc) {
        const t = doc.tags.find(item => item.id === idleTag.id)
        t.name = 'tampered'
      },
      match: /Animation tags that cover locked frames cannot be/i,
    },
  ]
  for (const check of tamperChecks) {
    const docCopy = structuredClone(baseDoc)
    check.mutate(docCopy)
    await assert.rejects(
      acceptDocumentCandidate({
        ...scope,
        documentId: docId,
        canvasId: workCanvasId,
        operationId: randomUUID(),
        expectedRevision: projRev,
        expectedWorkingRevision: workRev,
        expectedEditableFrameIds: ['walk1'],
        payload: { action: check.label },
        candidate: { document: docCopy, blocks: new Map(baseBlocks), editableFrameIds: ['walk1'] },
      }),
      err => err.code === 'unsupported_input' && check.match.test(err.message),
      `Expected store to reject tampered candidate: ${check.label}`,
    )
  }

  // 4. Valid scoped modification on walk1 (pixels, duration, and fx tag on walk1..walk1) succeeds, and single-step Undo restores everything
  const validScopedSession = makeSession(
    { manifest: baseDoc, blocks: baseBlocks },
    { editableFrameIds: ['walk1'] },
  )
  await observe(validScopedSession, 'walk1')
  assert.equal((await validScopedSession.call('compose_document', {
    canvas: { w: 3, h: 2 },
    layers: [
      { id: 'body', name: 'Body', visible: true },
      { id: 'effects', name: 'Effects', visible: true },
    ],
    frames: [
      {
        id: 'walk0',
        duration_ms: baseDoc.frames.walk0.duration_ms,
        cels: [
          { layer_id: 'body', parts: [{ from: 'source', frame_id: 'walk0', layer_id: 'body', rect: { x: 0, y: 0, w: 3, h: 2 }, at: { x: 0, y: 0 } }] },
        ],
      },
      {
        id: 'walk1',
        duration_ms: 240,
        cels: [
          { layer_id: 'body', parts: [{ from: 'source', frame_id: 'walk1', layer_id: 'body', rect: { x: 1, y: 1, w: 1, h: 1 }, at: { x: 0, y: 0 } }] },
          { layer_id: 'effects', parts: [{ from: 'source', frame_id: 'walk1', layer_id: 'body', rect: { x: 1, y: 1, w: 1, h: 1 }, at: { x: 2, y: 1 } }] },
        ],
      },
      {
        id: 'walk2',
        duration_ms: baseDoc.frames.walk2.duration_ms,
        cels: [
          { layer_id: 'body', parts: [{ from: 'source', frame_id: 'walk2', layer_id: 'body', rect: { x: 0, y: 0, w: 3, h: 2 }, at: { x: 0, y: 0 } }] },
        ],
      },
    ],
  })).success, true)
  assert.equal((await validScopedSession.call('edit_structure', {
    commands: JSON.stringify([
      { type: 'update-tag', tag_id: fxTag.id, name: 'fx-burst', from_frame_id: 'walk1', to_frame_id: 'walk1', direction: 'pingpong' },
    ]),
  })).success, true)

  const validCandidate = await validScopedSession.candidate()
  const scopedAccepted = await acceptDocumentCandidate({
    ...scope,
    documentId: docId,
    canvasId: workCanvasId,
    operationId: randomUUID(),
    expectedRevision: projRev,
    expectedWorkingRevision: workRev,
    expectedEditableFrameIds: ['walk1'],
    payload: { action: 'accept_valid_scoped' },
    candidate: validCandidate,
  })
  assert.equal(scopedAccepted.document.frames.walk1.duration_ms, 240)
  assert.equal(scopedAccepted.document.tags.find(t => t.id === fxTag.id)?.name, 'fx-burst')
  assert.deepEqual(scopedAccepted.document.layers, baseDoc.layers)
  assert.deepEqual(scopedAccepted.document.links, baseDoc.links)

  const restored = await restoreWorkingSpriteDocument({
    ...scope,
    documentId: docId,
    operationId: randomUUID(),
    expectedRevision: scopedAccepted.project.revision,
    expectedWorkingRevision: scopedAccepted.document.revision,
    targetRevision: workRev,
    mode: 'structure',
    payload: { action: 'undo_valid_scoped' },
  })
  assert.deepEqual(restored.document.frames, baseDoc.frames)
  assert.deepEqual(restored.document.layers, baseDoc.layers)
  assert.deepEqual(restored.document.cels, baseDoc.cels)
  assert.deepEqual(restored.document.tags, baseDoc.tags)
  assert.deepEqual(restored.document.links, baseDoc.links)

  // 5. R5: Promote up to 64 references, reject the 65th, revoke 1, and verify the 64-record limit still rejects new promotions
  let refProjRev = restored.project.revision
  let firstRefId = null
  for (let i = 1; i <= 64; i += 1) {
    const reqBody = parsePromoteProjectReferenceRequest({
      operation_id: randomUUID(),
      expected_revision: refProjRev,
      canvas_id: workCanvasId,
      document_id: docId,
      working_revision: restored.document.revision,
      frame_id: 'walk0',
      source_kind: 'frame_composite',
      purpose: 'frame',
      name: `Ref ${i}`,
    })
    const res = await promoteProjectReference({
      ...scope,
      operationId: reqBody.operation_id,
      expectedRevision: reqBody.expected_revision,
      canvasId: reqBody.canvas_id,
      documentId: reqBody.document_id,
      workingRevision: reqBody.working_revision,
      frameId: reqBody.frame_id,
      layerId: reqBody.layer_id,
      sourceKind: reqBody.source_kind,
      purpose: reqBody.purpose,
      name: reqBody.name,
      payload: reqBody.payload,
    })
    refProjRev = res.project.revision
    if (i === 1) firstRefId = res.reference.id
    if (i === 64) assert.equal(res.project.references.length, 64)
  }
  const overLimitBody = parsePromoteProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: refProjRev,
    canvas_id: workCanvasId,
    document_id: docId,
    working_revision: restored.document.revision,
    frame_id: 'walk0',
    source_kind: 'frame_composite',
    purpose: 'frame',
    name: 'Ref 65',
  })
  await assert.rejects(
    promoteProjectReference({
      ...scope,
      operationId: overLimitBody.operation_id,
      expectedRevision: overLimitBody.expected_revision,
      canvasId: overLimitBody.canvas_id,
      documentId: overLimitBody.document_id,
      workingRevision: overLimitBody.working_revision,
      frameId: overLimitBody.frame_id,
      layerId: overLimitBody.layer_id,
      sourceKind: overLimitBody.source_kind,
      purpose: overLimitBody.purpose,
      name: overLimitBody.name,
      payload: overLimitBody.payload,
    }),
    err => err.code === 'resource_limit' && /64/i.test(err.message),
  )
  const revokeOneBody = parseRevokeProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: refProjRev,
  }, firstRefId)
  const afterRevokeOne = await revokeProjectReference({
    ...scope,
    referenceId: firstRefId,
    operationId: revokeOneBody.operation_id,
    expectedRevision: revokeOneBody.expected_revision,
    payload: revokeOneBody.payload,
  })
  assert.equal(afterRevokeOne.project.references.length, 64)
  assert.equal(afterRevokeOne.project.references.filter(r => r.status === 'active').length, 63)
  const afterRevokePromote = parsePromoteProjectReferenceRequest({
    operation_id: randomUUID(),
    expected_revision: afterRevokeOne.project.revision,
    canvas_id: workCanvasId,
    document_id: docId,
    working_revision: restored.document.revision,
    frame_id: 'walk0',
    source_kind: 'frame_composite',
    purpose: 'frame',
    name: 'Ref After Revoke',
  })
  await assert.rejects(
    promoteProjectReference({
      ...scope,
      operationId: afterRevokePromote.operation_id,
      expectedRevision: afterRevokePromote.expected_revision,
      canvasId: afterRevokePromote.canvas_id,
      documentId: afterRevokePromote.document_id,
      workingRevision: afterRevokePromote.working_revision,
      frameId: afterRevokePromote.frame_id,
      layerId: afterRevokePromote.layer_id,
      sourceKind: afterRevokePromote.source_kind,
      purpose: afterRevokePromote.purpose,
      name: afterRevokePromote.name,
      payload: afterRevokePromote.payload,
    }),
    err => err.code === 'resource_limit' && /64/i.test(err.message),
  )
})


test('native multi-frame painting creates distinct timed frames atomically and preserves protected contents', async () => {
  const f = fixture(), session = makeSession(f)
  await observe(session)
  assert.equal((await session.call('compose_document', { canvas: { w: 4, h: 4 }, layers: [{ id: 'paint', name: 'Flame', visible: true }], frames: [0,1,2].map(i => ({ id: `f${i}`, duration_ms: 100 + i * 20, cels: [{ layer_id: 'paint', parts: [] }] })) })).success, true)
  const cels = [0,1,2].map(i => ({ frame_id: `f${i}`, layer_id: 'paint', operations: [{ type: 'fill-rect', rect: { x: i, y: 1, w: 1, h: 2 }, color: [255, 80 + i * 40, 0, 255] }] }))
  assert.equal((await session.call('draw_frames', { cels })).success, true)
  const candidate = await session.candidate()
  assert.equal(new Set(Object.values(candidate.document.cels).map(c => c.block.sha256)).size, 3)
  assert.deepEqual(candidate.document.frame_order.map(id => candidate.document.frames[id].duration_ms), [100,120,140])
  assert.deepEqual(f.bytes, fixture().bytes, 'source was not mutated')
  const before = documentHash(candidate.document)
  assert.equal((await session.call('draw_frames', { cels: [cels[0], { ...cels[1], operations: [{ type: 'erase', rect: { x: 0, y: 0, w: 5, h: 1 } }] }] })).success, false)
  assert.equal(documentHash((await session.candidate()).document), before, 'late invalid operation publishes no partial pixels')
  const locked = fixture(); locked.manifest.layers.l.locked = true
  const lockedSession = makeSession(locked); await observe(lockedSession)
  assert.equal((await lockedSession.call('draw_frames', { cels: [{ ...cels[0], frame_id: 'f', layer_id: 'l' }] })).success, false)
  assert.equal(await lockedSession.candidate(), null)
})

test('native drawing rejects out-of-scope frames and linked cels without changing the candidate', async () => {
  const f = fixture(); const original = f.manifest.cels.c
  f.manifest.frame_order.push('f2'); f.manifest.frames.f2 = { id: 'f2', duration_ms: 100 }
  f.manifest.cels.c2 = { ...original, id: 'c2', frame_id: 'f2' }
  const paint = frame_id => ({ cels: [{ frame_id, layer_id: 'l', operations: [{ type: 'fill-rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: [255, 0, 0, 255] }] }] })
  const scoped = makeSession(f, { editableFrameIds: ['f2'] }); await observe(scoped)
  assert.equal((await scoped.call('draw_frames', paint('f'))).success, false)
  assert.equal((await scoped.call('draw_frames', paint('f2'))).success, true)
  assert.deepEqual((await scoped.candidate()).document.cels.c, original)
  f.manifest.links = { groups: { linked: ['c','c2'] }, copy_layers: [] }
  const linked = makeSession(f); await observe(linked)
  assert.equal((await linked.call('draw_frames', paint('f2'))).success, false)
  assert.equal(await linked.candidate(), null)
})
