import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { editorFetch } from '../helpers/editorFetch.js'
import { handleEditorProjectApi, createEditorArtifactAccessRegistry } from '../../src/editor-project/index.js'
import { buildQualityCharacterPrompt } from '../../src/character-pack/textToImagePrompt.js'
import {
  detectAutomaticBackground,
  prepareGeneralAssetFrame,
  prepareGeneralSequence,
  proposedBackgroundCells,
  readEncodedImageDimensions,
  restoreBackgroundCells,
} from '../../src/character-pack/generalAssetFrames.js'
import { staticImageRequest } from '../../src/ui/vnext/vnext-static-image.js'
import {
  changeWorkingStructure,
  createBlankSpriteDocument,
  createEditorProjectV1,
  createSpriteDocumentFromGeneralSequence,
  createSpriteDocumentFromUploadedPng,
  deriveWorkingSpriteDocument,
  encodeRgbaPng,
  getSpriteDocument,
  readSpriteBlock,
  restoreWorkingSpriteDocument,
  writeWorkingPixels,
} from '../../src/editor-project/spriteDocumentStore.js'
import { sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'
import { compositePixelFrame } from '../../src/editor-project/pixelStructure.js'
import { WORKING_PIXELS_MAX_BYTES, diffPixelRect, splitPixelRectStrips } from '../../src/ui/vnext/vnext-pixel-copy.js'
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { encodeGifFromRgbaFrames, writeGifFrameFromRgba } from '../../src/character-pack/gifExport.js'
import gifenc from 'gifenc'
const { GIFEncoder, quantize } = gifenc
import { buildFrameGifFromImages, MAX_FRAME_GIF_FRAMES, MAX_FRAME_GIF_EDGE, MAX_FRAME_GIF_UNCOMPRESSED_BYTES } from '../../src/frameGif.js'
import { processSheetBuffer } from '../../src/character-pack/processSheet.js'
import { buildEngineExportArtifacts } from '../../src/character-pack/processArtifacts.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayouts.js'
import { createImageGeneration } from '../../src/editor-project/imageGeneration.js'
import { prepareNativeImage } from '../../src/editor-project/imageAntigravity.js'
import JSZip from 'jszip'
import { assertSequencePreviewBudget, assertSequenceSourceSizes, classifySequenceImage, encodeGeneralSequenceBody, decodeGeneralSequenceBody, maskSelectionFromBitMasks, packBitMask, partitionSequenceSourceBatches, prepareSequenceSourceHandles, readSequenceHandleBatch, readSequenceSources, sequenceDisplayScale, GENERAL_SEQUENCE_MAX_BODY_BYTES, GENERAL_SEQUENCE_MAX_EXPANDED_RGBA_BYTES, GENERAL_SEQUENCE_MAX_FRAMES, GENERAL_SEQUENCE_MAX_FRAME_BYTES, GENERAL_SEQUENCE_MAX_GROUP_BYTES, GENERAL_SEQUENCE_MAX_PACKAGE_OVERHEAD_BYTES, SEQUENCE_EXPANDED_LIMIT_MESSAGE, SEQUENCE_FRAME_LIMIT_MESSAGE, SEQUENCE_GROUP_LIMIT_MESSAGE } from '../../src/editor-project/generalSequenceBody.js'

const now = '2026-10-13T00:00:00.000Z'
const tempDir = async (prefix) => realpath(await mkdtemp(path.join(os.tmpdir(), prefix)))

function paint(width, height, draw) {
  const rgba = Buffer.alloc(width * height * 4, 0)
  draw((x, y, r, g, b, a = 255) => {
    const offset = (y * width + x) * 4
    rgba[offset] = r
    rgba[offset + 1] = g
    rgba[offset + 2] = b
    rgba[offset + 3] = a
  })
  return rgba
}

function png(width, height, rgba) {
  return encodeRgbaPng(width, height, rgba)
}

test('general asset mask keeps C bytes, tolerates slight border color variation, protects same-color subject, and skips transparent sources', async () => {
  const rgba = paint(8, 8, (set) => {
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 0, 255, 0)
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) set(x, y, 120, 70, 20)
    set(3, 3, 0, 255, 0)
    set(1, 1, 0, 255, 0)
    set(0, 1, 0, 254, 0)
    set(0, 5, 120, 70, 20)
  })
  const island = proposedBackgroundCells(rgba, 8, 8)
  assert.equal(island.some(([x, y]) => x === 3 && y === 3), false)
  assert.equal(island.some(([x, y]) => x === 0 && y === 1), true)
  assert.equal(island.some(([x, y]) => x === 0 && y === 5), false)
  assert.ok(island.some(([x, y]) => x === 0 && y === 0))
  const prepared = await prepareGeneralAssetFrame(png(8, 8, rgba))
  assert.equal(prepared.recovery.method, 'global_median_v1')
  assert.equal(prepared.transparentSource, false)
  assert.equal(prepared.background, 'green')
  assert.equal(prepared.backgroundStatus, 'omitted')
  for (const [x, y] of prepared.proposed) {
    const offset = (y * prepared.width + x) * 4
    assert.equal(prepared.cRgba[offset], 0)
    assert.ok(prepared.cRgba[offset + 1] >= 254)
    assert.equal(prepared.cRgba[offset + 2], 0)
    assert.equal(prepared.cRgba[offset + 3], 255)
  }
  const protectedFrame = await prepareGeneralAssetFrame(png(8, 8, rgba), {
    protect: [[1, 1]],
  })
  const kept = (x, y) => {
    const offset = (y * 8 + x) * 4
    assert.equal(protectedFrame.working[offset], protectedFrame.cRgba[offset])
    assert.equal(protectedFrame.working[offset + 1], protectedFrame.cRgba[offset + 1])
    assert.equal(protectedFrame.working[offset + 2], protectedFrame.cRgba[offset + 2])
    assert.equal(protectedFrame.working[offset + 3], protectedFrame.cRgba[offset + 3])
  }
  kept(3, 3)
  kept(1, 1)
  kept(0, 5)
  kept(2, 2)
  assert.equal(protectedFrame.working[(1 * 8 + 0) * 4 + 3], 0)
  const border = 0
  assert.equal(protectedFrame.working[border + 3], 0)
  const restored = restoreBackgroundCells(protectedFrame.working, protectedFrame.cRgba, [[0, 0]], 8, 8)
  assert.equal(restored[1], protectedFrame.cRgba[1])
  assert.equal(restored[3], protectedFrame.cRgba[3])
  const clear = paint(4, 4, (set) => {
    set(1, 1, 20, 40, 60, 255)
  })
  const transparent = await prepareGeneralAssetFrame(png(4, 4, clear), { omit: [[0, 0]] })
  assert.equal(transparent.transparentSource, true)
  assert.deepEqual(transparent.omitted, [])
  assert.equal(transparent.working[7], transparent.cRgba[7])
})

test('sequence placement pads to one canvas and does not scale frames', async () => {
  const wide = paint(8, 4, (set) => { set(1, 1, 10, 20, 30) })
  const tall = paint(4, 6, (set) => { set(2, 2, 9, 8, 7) })
  const sequence = await prepareGeneralSequence([
    { bytes: png(8, 4, wide) },
    { bytes: png(4, 6, tall) },
  ], { background: 'magenta' })
  assert.equal(sequence.scaled, false)
  assert.deepEqual(sequence.anchor, { x: 0, y: 0 })
  assert.equal(sequence.width, 8)
  assert.equal(sequence.height, 6)
  assert.equal(sequence.gridConsistent, false)
  assert.equal(sequence.gridReason, 'passthrough_or_unconfirmed_grid')
  assert.equal(sequence.canvasUniform, true)
  assert.equal(sequence.frames[0].placed.length, 8 * 6 * 4)
  assert.equal(sequence.frames[0].placed[(1 * 8 + 1) * 4], sequence.frames[0].working[(1 * 8 + 1) * 4])
  assert.equal(sequence.frames[0].placed[(5 * 8 + 0) * 4 + 3], 0)
  assert.equal(sequence.frames[1].placed[(2 * 8 + 2) * 4], sequence.frames[1].working[(2 * 4 + 2) * 4])
  assert.equal(sequence.frames[1].width, 4)
  assert.equal(sequence.frames[1].height, 6)
})

test('general image request binds a flat background without changing the character prompt', () => {
  const preset = { id: 'grok-native', provider: 'grok', model: 'native-imagine' }
  const request = staticImageRequest({ description: 'a wooden crate', preset })
  assert.match(request.description, /pure green #00ff00/)
  assert.deepEqual(Object.keys(request).sort(), ['description', 'operation_id', 'provider'])
  const purple = staticImageRequest({ description: 'a wooden crate', preset, background: 'purple' })
  assert.match(purple.description, /pure purple #8000ff/)
  assert.match(buildQualityCharacterPrompt({ description: 'guard' }), /pure white #ffffff/)
  const image = png(1, 1, paint(1, 1, (set) => set(0, 0, 1, 2, 3)))
  const packed = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'delta', removed: [], added: [[0, 0]] } }])
  const decoded = decodeGeneralSequenceBody(packed)
  assert.equal(decoded[0].selection.mode, 'delta')
  assert.deepEqual(decoded[0].selection.added, [[0, 0]])
  assert.equal(classifySequenceImage(image), 'png')
  assert.equal(classifySequenceImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])), null)
  assert.equal(packBitMask(252, 252, [[0, 0], [251, 251]]).length, Math.ceil(252 * 252 / 8))
  assert.equal(sequenceDisplayScale(252, 252), 2)
  assert.equal(sequenceDisplayScale(1024, 1024), 1)
  assert.throws(() => decodeGeneralSequenceBody(packed.subarray(0, packed.length - 1)))
})

test('sequence import saves ordered frames, keeps sources, and playback reads the edited pixels', async () => {
  const root = await tempDir('general-sequence-')
  const createOp = randomUUID()
  const importOp = randomUUID()
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })
  const first = paint(4, 4, (set) => { set(1, 1, 30, 40, 50) })
  const second = paint(4, 4, (set) => { set(2, 2, 60, 70, 80) })
  const frames = [{ bytes: png(4, 4, first), omit: [], protect: [] }, { bytes: png(4, 4, second), omit: [], protect: [] }]
  const body = encodeGeneralSequenceBody(frames)
  const imported = await createSpriteDocumentFromGeneralSequence({
    projectId: created.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: sha256Bytes(body),
    frames,
    background: 'green',
    name: 'Crate',
    payload: {
      action: 'import_general_sequence',
      operation_id: importOp,
      expected_revision: 1,
      expected_sha256: sha256Bytes(body),
      background: 'green',
      name: 'Crate',
    },
    projectRoot: root,
    now,
  })
  assert.equal(imported.replayed, false)
  assert.deepEqual(imported.document.frame_order, ['frame_1', 'frame_2'])
  assert.equal(imported.document.frames.frame_1.duration_ms, 125)
  assert.deepEqual(imported.document.canvas, { w: 4, h: 4 })
  const asset = Object.values(imported.project.assets)[0]
  const revision = Object.values(asset.revisions)[0]
  assert.equal(revision.quality_status, 'unknown')
  assert.equal(revision.production_status, 'review_required')
  const sequence = JSON.parse(await readFile(path.join(root, revision.artifacts.sequence), 'utf8'))
  assert.equal(sequence.scaled, false)
  assert.equal(sequence.accepted, false)
  assert.equal(sequence.frames.length, 2)
  const original = await readFile(path.join(root, revision.artifacts.frame_0_original))
  assert.equal(sha256Bytes(original), sha256Bytes(frames[0].bytes))
  const canvas = Object.values(imported.project.canvases)[0]
  const derived = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: randomUUID(),
    expectedRevision: imported.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: imported.document.document_id,
    sourceRevision: 1,
    payload: { action: 'derive_working', operation_id: 'derive' },
    projectRoot: root,
    now,
  })
  const cel = Object.values(derived.document.cels).find((item) => item.frame_id === 'frame_1')
  const patch = Buffer.from([0, 0, 0, 0])
  const writeOp = randomUUID()
  const wrote = await writeWorkingPixels({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: writeOp,
    expectedRevision: derived.project.revision,
    expectedWorkingRevision: 1,
    rect: { x: 1, y: 1, w: 1, h: 1 },
    rgba: patch,
    expectedSha256: sha256Bytes(patch),
    target: { frame_id: 'frame_1', layer_id: 'layer_1', cel_id: cel.id },
    payload: { action: 'working_pixels', operation_id: writeOp },
    projectRoot: root,
    now,
  })
  const read = async (block) => (await readFile(path.join(root, 'workspace', 'projects', imported.project.id, 'sprite-documents', derived.document.document_id, 'blocks', `${block.sha256}.rgba`)))
  const played = Buffer.from(await compositePixelFrame(wrote.document, 'frame_1', read))
  assert.equal(played[(1 * 4 + 1) * 4 + 3], 0)
  assert.equal(first[(1 * 4 + 1) * 4 + 3], 255)
  const restoreOp = randomUUID()
  const restored = await restoreWorkingSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: restoreOp,
    expectedRevision: wrote.project.revision,
    expectedWorkingRevision: 2,
    targetRevision: 1,
    mode: 'structure',
    payload: { action: 'restore_working', operation_id: restoreOp },
    projectRoot: root,
    now,
  })
  const restoredPlay = Buffer.from(await compositePixelFrame(restored.document, 'frame_1', read))
  assert.equal(restoredPlay[(1 * 4 + 1) * 4], 30)
  assert.equal(restoredPlay[(1 * 4 + 1) * 4 + 3], 255)
  const moveOp = randomUUID()
  const moved = await changeWorkingStructure({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: moveOp,
    expectedRevision: restored.project.revision,
    expectedWorkingRevision: restored.document.revision,
    command: { type: 'move-frame', frame_id: 'frame_2', index: 0 },
    payload: { action: 'working_structure', operation_id: moveOp },
    projectRoot: root,
    now,
  })
  const durationOp = randomUUID()
  const timed = await changeWorkingStructure({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    operationId: durationOp,
    expectedRevision: moved.project.revision,
    expectedWorkingRevision: moved.document.revision,
    command: { type: 'set-duration', frame_id: 'frame_1', duration_ms: 200 },
    payload: { action: 'working_structure', operation_id: durationOp },
    projectRoot: root,
    now,
  })
  const reopened = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: derived.document.document_id,
    projectRoot: root,
  })
  assert.deepEqual(reopened.manifest.frame_order, timed.document.frame_order)
  assert.equal(reopened.manifest.frame_order[0], 'frame_2')
  assert.equal(reopened.manifest.frames.frame_1.duration_ms, 200)
  assert.equal(reopened.manifest.canvas.w, 4)
  assert.equal(reopened.manifest.canvas.h, 4)
  const reopenedPlay = Buffer.from(await compositePixelFrame(reopened.manifest, 'frame_2', async (block) => readFile(path.join(root, 'workspace', 'projects', imported.project.id, 'sprite-documents', derived.document.document_id, 'blocks', `${block.sha256}.rgba`))))
  assert.equal(reopenedPlay[(2 * 4 + 2) * 4], 60)
  assert.equal(reopenedPlay[(2 * 4 + 2) * 4 + 3], 255)
})

test('general-sequence HTTP checks version, hash, truncation, replay, and payload conflict', async (t) => {
  const projectRoot = await tempDir('general-sequence-http-')
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'),
    generatedDir: path.join(projectRoot, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const created = await editorFetch(`${base}/api/editor/projects/v1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID() }),
  })
  const project = (await created.json()).project
  const image = png(4, 4, paint(4, 4, (set) => set(1, 1, 8, 9, 10)))
  const body = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'proposal' } }])
  const operationId = randomUUID()
  const query = (hash, background = 'green') => new URLSearchParams({
    operation_id: operationId, expected_revision: '1', expected_sha256: hash, background, name: 'Crate',
  })
  const post = (hash, bytes, headers = {}) => editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${query(hash)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body: bytes,
  })
  const missingVersion = await globalThis.fetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${query(sha256Bytes(body))}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(missingVersion.status, 409)
  assert.equal((await missingVersion.json()).error, 'unsupported_project_writer')
  const mismatch = await post('0'.repeat(64), body)
  assert.equal(mismatch.status, 422)
  const truncated = body.subarray(0, 12)
  const cut = await post(sha256Bytes(truncated), truncated)
  assert.equal(cut.status, 400)
  const saved = await post(sha256Bytes(body), body)
  assert.equal(saved.status, 201)
  const savedBody = await saved.json()
  assert.equal(savedBody.receipt.operation_id, operationId)
  assert.equal(savedBody.receipt.project_id, project.id)
  const replay = await post(sha256Bytes(body), body)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).receipt.project_revision, savedBody.receipt.project_revision)
  const conflict = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${query(sha256Bytes(body), 'purple')}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).error, 'operation_conflict')
})

test('a slow sequence read is dropped when a newer selection wins', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let serial = 1
  const slow = { arrayBuffer: () => gate.then(() => Uint8Array.of(1, 2, 3).buffer) }
  const pending = readSequenceSources([slow], { serial: 1 }, (token) => token.serial === serial)
  serial = 2
  release()
  assert.equal(await pending, null)
  const kept = await readSequenceSources([{ arrayBuffer: async () => Uint8Array.of(9).buffer }], { serial: 2 }, (token) => token.serial === serial)
  assert.deepEqual([...kept[0].bytes], [9])
})

test('dense background at a normal logical size uses a proposal mask, not a coordinate table', async (t) => {
  const width = 160
  const height = 160
  const rgba = paint(width, height, (set) => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, 0, 255, 0)
    set(20, 30, 90, 40, 20)
    set(21, 30, 90, 40, 20)
    set(20, 31, 40, 20, 10)
  })
  const image = png(width, height, rgba)
  const body = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'proposal' } }])
  const decoded = decodeGeneralSequenceBody(body)
  assert.equal(decoded[0].selection.mode, 'proposal')
  assert.equal(body.length, 7 + 4 + image.length + 1)
  const prepared = await prepareGeneralAssetFrame(image, { background: 'green' })
  assert.equal(prepared.width, width)
  assert.equal(prepared.height, height)
  assert.ok(prepared.proposed.length * 4 > 64 * 1024)
  const projectRoot = await tempDir('general-sequence-dense-')
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'),
    generatedDir: path.join(projectRoot, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const created = await editorFetch(`${base}/api/editor/projects/v1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID() }),
  })
  const project = (await created.json()).project
  const previewQuery = new URLSearchParams({
    operation_id: randomUUID(), expected_revision: '1', expected_sha256: sha256Bytes(body), background: 'green', preview: '1',
  })
  const preview = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${previewQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(preview.status, 200)
  const previewBody = await preview.json()
  assert.equal(Object.hasOwn(previewBody.frames[0], 'proposed'), false)
  assert.equal(previewBody.frames[0].width, width)
  assert.equal(previewBody.frames[0].height, height)
  const mask = Buffer.from(previewBody.frames[0].proposal_mask_base64, 'base64')
  assert.equal(mask.length, Math.ceil((width * height) / 8))
  assert.ok(mask.length < 64 * 1024)
  const commit = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'proposal' } }])
  const commitQuery = new URLSearchParams({
    operation_id: randomUUID(), expected_revision: '1', expected_sha256: sha256Bytes(commit), background: 'green', name: 'Dense', preview: '0',
  })
  const saved = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${commitQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: commit,
  })
  assert.equal(saved.status, 201)
  const savedBody = await saved.json()
  const reopened = await getSpriteDocument({
    projectId: project.id,
    documentId: savedBody.document.document_id,
    projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'),
  })
  const cel = Object.values(reopened.manifest.cels)[0]
  const block = await readFile(path.join(projectRoot, 'workspace', 'projects', project.id, 'sprite-documents', savedBody.document.document_id, 'blocks', `${cel.block.sha256}.rgba`))
  assert.deepEqual([...block.subarray(0, 4)], [0, 0, 0, 0])
  const subject = (30 * width + 20) * 4
  assert.equal(block[subject + 3], 255)
  assert.notDeepEqual([...block.subarray(subject, subject + 3)], [0, 255, 0])
})

test('sequence limits reject oversized files before reading and keep legal package overhead', async () => {
  const overhead = 7 + GENERAL_SEQUENCE_MAX_FRAMES * (4 + 1 + (2 + 2048 * 4) + (2 + 2048 * 4))
  assert.equal(overhead, 7 + 256 * 16393)
  assert.equal(GENERAL_SEQUENCE_MAX_PACKAGE_OVERHEAD_BYTES, overhead)
  assert.equal(GENERAL_SEQUENCE_MAX_FRAME_BYTES, 32 * 1024 * 1024)
  assert.equal(GENERAL_SEQUENCE_MAX_GROUP_BYTES, 64 * 1024 * 1024)
  assert.equal(GENERAL_SEQUENCE_MAX_BODY_BYTES, GENERAL_SEQUENCE_MAX_GROUP_BYTES + overhead)
  const unread = { size: GENERAL_SEQUENCE_MAX_FRAME_BYTES + 1, arrayBuffer() { throw new Error('read') } }
  assert.throws(() => assertSequenceSourceSizes([unread]), { message: SEQUENCE_FRAME_LIMIT_MESSAGE })
  const group = [
    { size: GENERAL_SEQUENCE_MAX_FRAME_BYTES, arrayBuffer() { throw new Error('read') } },
    { size: GENERAL_SEQUENCE_MAX_FRAME_BYTES, arrayBuffer() { throw new Error('read') } },
    { size: 1, arrayBuffer() { throw new Error('read') } },
  ]
  assert.throws(() => assertSequenceSourceSizes(group), { message: SEQUENCE_GROUP_LIMIT_MESSAGE })
  assert.doesNotThrow(() => assertSequenceSourceSizes([{ size: GENERAL_SEQUENCE_MAX_FRAME_BYTES }, { size: GENERAL_SEQUENCE_MAX_GROUP_BYTES - GENERAL_SEQUENCE_MAX_FRAME_BYTES }]))
  const cells = Array.from({ length: 2048 }, (_, index) => [index, 0])
  const tiny = png(2, 2, paint(2, 2, (set) => set(0, 0, 1, 2, 3)))
  const packed = encodeGeneralSequenceBody(Array.from({ length: 8 }, () => ({ bytes: tiny, selection: { mode: 'delta', removed: cells, added: cells } })))
  assert.equal(packed.length - tiny.length * 8, 7 + 8 * 16393)
  assert.ok(packed.length <= GENERAL_SEQUENCE_MAX_BODY_BYTES)
  assert.equal(decodeGeneralSequenceBody(packed).length, 8)
  const declared = new Uint8Array(15)
  declared.set([0x47, 0x54, 0x41, 0x53, 2])
  const view = new DataView(declared.buffer)
  view.setUint16(5, 1, false)
  view.setUint32(7, GENERAL_SEQUENCE_MAX_FRAME_BYTES + 1, false)
  assert.throws(() => decodeGeneralSequenceBody(declared), { message: SEQUENCE_FRAME_LIMIT_MESSAGE })
})

test('a PNG over 1 MiB previews and imports without changing recovered color', async (t) => {
  const width = 512
  const height = 512
  const rgba = paint(width, height, (set) => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, 0, 255, 0)
    set(4, 4, 90, 40, 20)
  })
  const image = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer()
  assert.ok(image.length > 1024 * 1024)
  assert.equal(classifySequenceImage(image), 'png')
  const body = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'proposal' } }])
  const declared = new Uint8Array(11)
  declared.set([0x47, 0x54, 0x41, 0x53, 2])
  new DataView(declared.buffer).setUint16(5, 1, false)
  new DataView(declared.buffer).setUint32(7, GENERAL_SEQUENCE_MAX_FRAME_BYTES + 1, false)
  const projectRoot = await tempDir('general-sequence-large-')
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'),
    generatedDir: path.join(projectRoot, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const created = await editorFetch(`${base}/api/editor/projects/v1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID() }),
  })
  const project = (await created.json()).project
  const rejectedQuery = new URLSearchParams({
    operation_id: randomUUID(), expected_revision: '1', expected_sha256: sha256Bytes(declared), background: 'green', preview: '1',
  })
  const rejected = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${rejectedQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: declared,
  })
  assert.equal(rejected.status, 413)
  assert.equal((await rejected.json()).error, 'resource_limit')
  const previewQuery = new URLSearchParams({
    operation_id: randomUUID(), expected_revision: '1', expected_sha256: sha256Bytes(body), background: 'green', preview: '1',
  })
  const preview = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${previewQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(preview.status, 200)
  const previewBody = await preview.json()
  assert.equal(previewBody.frames[0].width, width)
  assert.equal(previewBody.frames[0].height, height)
  const commitQuery = new URLSearchParams({
    operation_id: randomUUID(), expected_revision: '1', expected_sha256: sha256Bytes(body), background: 'green', name: 'Large', preview: '0',
  })
  const saved = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${commitQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(saved.status, 201)
  const savedBody = await saved.json()
  const replay = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${commitQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).receipt.operation_id, commitQuery.get('operation_id'))
  const reopened = await getSpriteDocument({
    projectId: project.id,
    documentId: savedBody.document.document_id,
    projectRoot,
    workspaceRoot: path.join(projectRoot, 'workspace'),
  })
  const cel = Object.values(reopened.manifest.cels)[0]
  const block = await readFile(path.join(projectRoot, 'workspace', 'projects', project.id, 'sprite-documents', savedBody.document.document_id, 'blocks', `${cel.block.sha256}.rgba`))
  assert.deepEqual([...block.subarray(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...block.subarray((4 * width + 4) * 4, (4 * width + 4) * 4 + 3)], [90, 40, 20])
})

test('automatic background detection handles white/non-three-color backgrounds and keeps original pixels when ambiguous', async () => {
  const whiteBg = paint(8, 8, (set) => {
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 255, 254, 252)
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) set(x, y, 40, 80, 180)
  })
  const whitePrepared = await prepareGeneralAssetFrame(png(8, 8, whiteBg))
  assert.equal(whitePrepared.background, 'white')
  assert.equal(whitePrepared.backgroundStatus, 'omitted')
  assert.equal(whitePrepared.working[3], 0)
  assert.equal(whitePrepared.working[(3 * 8 + 3) * 4 + 3], 255)

  const skyBg = paint(8, 8, (set) => {
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 30, 140, 210)
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) set(x, y, 220, 90, 40)
  })
  const skyPrepared = await prepareGeneralAssetFrame(png(8, 8, skyBg))
  assert.equal(skyPrepared.background, 'auto')
  assert.equal(skyPrepared.backgroundStatus, 'omitted')
  assert.equal(skyPrepared.working[3], 0)
  assert.equal(skyPrepared.working[(3 * 8 + 3) * 4 + 3], 255)

  const solid = paint(8, 8, (set) => {
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 0, 255, 0)
  })
  const solidDetection = detectAutomaticBackground(solid, 8, 8)
  assert.equal(solidDetection.status, 'kept_original')
  assert.equal(solidDetection.reason, 'single_color_or_no_foreground')

  const ambiguous = paint(8, 8, (set) => {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        set(x, y, (x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256)
      }
    }
  })
  const ambiguousPrepared = await prepareGeneralAssetFrame(png(8, 8, ambiguous))
  assert.equal(ambiguousPrepared.backgroundStatus, 'kept_original')
  assert.equal(ambiguousPrepared.proposedCount, 0)
  assert.deepEqual([...ambiguousPrepared.working], [...ambiguousPrepared.cRgba])
})

test('9 frames and multi-batch append import into one sequence document and support compact mask selection', async () => {
  const projectRoot = await tempDir('general-sequence-nine-')
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const createOp = randomUUID()
  const project = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot,
    workspaceRoot,
    now,
  })
  const frames = Array.from({ length: 9 }, (_, index) => {
    const rgba = paint(4, 4, (set) => {
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) set(x, y, 255, 0, 255)
      set(1, 1, 20 + index * 10, 80, 140)
    })
    return png(4, 4, rgba)
  })
  const firstBatch = frames.slice(0, 5).map((bytes) => ({ bytes, selection: { mode: 'proposal' } }))
  const firstBody = encodeGeneralSequenceBody(firstBatch)
  const firstOp = randomUUID()
  const created = await createSpriteDocumentFromGeneralSequence({
    projectId: project.project.id,
    operationId: firstOp,
    expectedRevision: 1,
    expectedSha256: sha256Bytes(firstBody),
    name: 'NineTorch',
    frames: firstBatch,
    payload: {
      action: 'import_general_sequence',
      operation_id: firstOp,
      expected_revision: 1,
      expected_sha256: sha256Bytes(firstBody),
      background: 'auto',
      name: 'NineTorch',
      append_document_id: null,
    },
    projectRoot,
    workspaceRoot,
    now,
  })
  assert.equal(created.document.frame_order.length, 5)
  const maskBits = packBitMask(4, 4, [[0, 0], [3, 3]])
  const appendedFrames = frames.slice(5).map((bytes, idx) => ({
    bytes,
    selection: idx === 0 ? { mode: 'mask', mask: maskBits } : { mode: 'proposal' },
  }))
  const encodedMask = encodeGeneralSequenceBody(appendedFrames)
  const decodedMask = decodeGeneralSequenceBody(encodedMask)
  assert.equal(decodedMask[0].selection.mode, 'mask')
  const appendOp = randomUUID()
  const appended = await createSpriteDocumentFromGeneralSequence({
    projectId: project.project.id,
    operationId: appendOp,
    expectedRevision: created.receipt.project_revision,
    expectedSha256: sha256Bytes(encodedMask),
    appendDocumentId: created.document.document_id,
    name: 'NineTorch',
    frames: decodedMask,
    payload: {
      action: 'import_general_sequence',
      operation_id: appendOp,
      expected_revision: created.receipt.project_revision,
      expected_sha256: sha256Bytes(encodedMask),
      background: 'auto',
      name: 'NineTorch',
      append_document_id: created.document.document_id,
    },
    projectRoot,
    workspaceRoot,
    now,
  })
  assert.equal(appended.document.document_id, created.document.document_id)
  assert.equal(appended.document.frame_order.length, 9)
  const selection = maskSelectionFromBitMasks(maskBits, maskBits, 4, 4)
  assert.equal(selection.mode, 'proposal')
  const batches = partitionSequenceSourceBatches([
    { size: 30 * 1024 * 1024 },
    { size: 30 * 1024 * 1024 },
    { size: 20 * 1024 * 1024 },
  ])
  assert.equal(batches.length, 2)
  assert.equal(batches[0].length, 2)
  assert.equal(batches[1].length, 1)
})

const privateFireFixtureDir = process.env.GAMETOOL_PRIVATE_FIRE_FIXTURE_DIR
test('4 original 1254x1254 fire PNGs preview, recover logical grid, auto-omit noisy magenta background, edit, play back, and reopen with original hashes intact', {
  skip: !privateFireFixtureDir && 'Set GAMETOOL_PRIVATE_FIRE_FIXTURE_DIR to the original private fire trial.',
}, async (t) => {
  const trialDir = privateFireFixtureDir
  assert.ok(path.isAbsolute(trialDir), 'private fire fixture path must be absolute')
  const manifestBytes = await readFile(path.join(trialDir, 'generation.json'))
  assert.equal(sha256Bytes(manifestBytes), '7cd3511c0f18db63b8ac4ce65cfe8567c56f7d88f50ac2c8f8596e4a3d6974ff', 'private fire fixture must be the original accepted trial')
  const generation = JSON.parse(manifestBytes.toString('utf8'))
  const files = await Promise.all(generation.files.map(async (entry) => {
    const filePath = path.join(trialDir, entry.name)
    const bytes = await readFile(filePath)
    assert.equal(sha256Bytes(bytes), entry.sha256)
    return { entry, bytes }
  }))
  const projectRoot = await tempDir('general-sequence-fire-')
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot,
    workspaceRoot,
    generatedDir: path.join(projectRoot, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const createdResp = await editorFetch(`${base}/api/editor/projects/v1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID() }),
  })
  const project = (await createdResp.json()).project
  let revision = project.revision

  // Preview all 4 frames without pre-selecting background
  const previewBody = encodeGeneralSequenceBody(files.map(({ bytes }) => ({ bytes, selection: { mode: 'proposal' } })))
  const previewQuery = new URLSearchParams({
    operation_id: randomUUID(),
    expected_revision: String(revision),
    expected_sha256: sha256Bytes(previewBody),
    preview: '1',
  })
  const previewResp = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${previewQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: previewBody,
  })
  assert.equal(previewResp.status, 200)
  const previewJson = await previewResp.json()
  assert.equal(previewJson.frames.length, 4)
  assert.equal(previewJson.frames[0].recovery_status, 'resampled')
  assert.equal(previewJson.frames[0].width, 65)
  assert.equal(previewJson.frames[0].height, 66)
  assert.ok(previewJson.frames.some((frame) => frame.recovery_status === 'passthrough' && frame.width === 1254 && frame.height === 1254))
  for (const frame of previewJson.frames) {
    assert.ok(frame.recovery_status === 'resampled' || frame.recovery_status === 'passthrough')
    assert.equal(frame.background, 'magenta')
    assert.equal(frame.background_status, 'omitted')
    assert.ok(frame.proposal_count > 1000)
  }

  // Verify C byte identity on unomitted cells of frame 1
  const prepared0 = await prepareGeneralAssetFrame(files[0].bytes)
  assert.equal(prepared0.background, 'magenta')
  assert.equal(prepared0.backgroundStatus, 'omitted')
  let unomittedChecked = 0
  for (let i = 0; i < prepared0.width * prepared0.height; i += 1) {
    if (prepared0.omittedMask[i]) {
      assert.equal(prepared0.working[i * 4 + 3], 0)
    } else {
      assert.deepEqual(
        [...prepared0.working.subarray(i * 4, i * 4 + 4)],
        [...prepared0.cRgba.subarray(i * 4, i * 4 + 4)],
      )
      unomittedChecked += 1
    }
  }
  assert.ok(unomittedChecked > 200)

  // Import all 4 frames into a sprite document
  const commitQuery = new URLSearchParams({
    operation_id: randomUUID(),
    expected_revision: String(revision),
    expected_sha256: sha256Bytes(previewBody),
    name: 'FireMagenta',
    preview: '0',
  })
  const commitResp = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${commitQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: previewBody,
  })
  assert.equal(commitResp.status, 201)
  const commitJson = await commitResp.json()
  revision = commitJson.receipt.project_revision
  const documentId = commitJson.document.document_id
  assert.equal(commitJson.document.frame_order.length, 4)

  const canvas = Object.values(commitJson.project.canvases)[0]
  const deriveOp = randomUUID()
  const derived = await deriveWorkingSpriteDocument({
    projectId: project.id,
    operationId: deriveOp,
    expectedRevision: revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: documentId,
    sourceRevision: 1,
    payload: { action: 'derive_working', operation_id: deriveOp },
    projectRoot,
    workspaceRoot,
    now,
  })
  revision = derived.project.revision
  const workingDocId = derived.document.document_id
  const cel0 = Object.values(derived.document.cels).find((item) => item.frame_id === 'frame_1')
  const patchBytes = Buffer.alloc(4, 0)
  const writeOp = randomUUID()
  const wrote = await writeWorkingPixels({
    projectId: project.id,
    documentId: workingDocId,
    operationId: writeOp,
    expectedRevision: revision,
    expectedWorkingRevision: 1,
    rect: { x: 32, y: 35, w: 1, h: 1 },
    rgba: patchBytes,
    expectedSha256: sha256Bytes(patchBytes),
    target: { frame_id: 'frame_1', layer_id: 'layer_1', cel_id: cel0.id },
    payload: { action: 'working_pixels', operation_id: writeOp },
    projectRoot,
    workspaceRoot,
    now,
  })
  const readBlock = async (block) => readFile(path.join(workspaceRoot, 'projects', project.id, 'sprite-documents', workingDocId, 'blocks', `${block.sha256}.rgba`))
  const played = Buffer.from(await compositePixelFrame(wrote.document, 'frame_1', readBlock))
  assert.equal(played[(35 * wrote.document.canvas.w + 32) * 4 + 3], 0)

  const reopened = await getSpriteDocument({
    projectId: project.id,
    documentId: workingDocId,
    projectRoot,
    workspaceRoot,
  })
  assert.equal(reopened.manifest.frame_order.length, 4)

  // Verify original trial files on disk were never mutated
  for (const { entry } of files) {
    const currentBytes = await readFile(path.join(trialDir, entry.name))
    assert.equal(sha256Bytes(currentBytes), entry.sha256)
  }
})

test('passthrough image larger than 1024 (1254x1254) previews, imports at original size, supports narrowed/strip edits, and reopens', async (t) => {
  const width = 1254
  const height = 1254
  const rgba = paint(width, height, (set) => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, 255, 0, 255)
    // 1-pixel stair-step diagonal line in the center so C returns passthrough (no coarse grid)
    for (let i = 0; i < 40; i += 1) {
      set(600 + i, 600 + i, 240, 120, 30)
    }
  })
  const image = png(width, height, rgba)
  const projectRoot = await tempDir('general-sequence-passthrough-1254-')
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot,
    workspaceRoot,
    generatedDir: path.join(projectRoot, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const createdResp = await editorFetch(`${base}/api/editor/projects/v1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID() }),
  })
  const project = (await createdResp.json()).project
  let revision = project.revision

  const body = encodeGeneralSequenceBody([{ bytes: image, selection: { mode: 'proposal' } }])
  const previewQuery = new URLSearchParams({
    operation_id: randomUUID(),
    expected_revision: String(revision),
    expected_sha256: sha256Bytes(body),
    preview: '1',
  })
  const previewResp = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${previewQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(previewResp.status, 200)
  const previewJson = await previewResp.json()
  assert.equal(previewJson.frames[0].width, 1254)
  assert.equal(previewJson.frames[0].height, 1254)
  assert.equal(previewJson.frames[0].recovery_status, 'passthrough')
  assert.equal(previewJson.frames[0].background, 'magenta')
  assert.equal(previewJson.frames[0].background_status, 'omitted')

  const commitQuery = new URLSearchParams({
    operation_id: randomUUID(),
    expected_revision: String(revision),
    expected_sha256: sha256Bytes(body),
    name: 'LargePassthrough',
    preview: '0',
  })
  const commitResp = await editorFetch(`${base}/api/editor/projects/${project.id}/sprite-documents/general-sequence?${commitQuery}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  })
  assert.equal(commitResp.status, 201)
  const commitJson = await commitResp.json()
  revision = commitJson.receipt.project_revision
  const documentId = commitJson.document.document_id
  assert.equal(commitJson.document.canvas.w, 1254)
  assert.equal(commitJson.document.canvas.h, 1254)

  const canvas = Object.values(commitJson.project.canvases)[0]
  const deriveOp = randomUUID()
  const derived = await deriveWorkingSpriteDocument({
    projectId: project.id,
    operationId: deriveOp,
    expectedRevision: revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: documentId,
    sourceRevision: 1,
    payload: { action: 'derive_working', operation_id: deriveOp },
    projectRoot,
    workspaceRoot,
    now,
  })
  revision = derived.project.revision
  const workingDocId = derived.document.document_id
  const cel0 = Object.values(derived.document.cels).find((item) => item.frame_id === 'frame_1')
  const block0Path = path.join(workspaceRoot, 'projects', project.id, 'sprite-documents', workingDocId, 'blocks', `${cel0.block.sha256}.rgba`)
  const beforeRgba = new Uint8Array(await readFile(block0Path))
  const afterRgba = beforeRgba.slice()
  const patchX = 600
  const patchY = 600
  for (let y = patchY; y < patchY + 10; y += 1) {
    for (let x = patchX; x < patchX + 10; x += 1) {
      const offset = (y * 1254 + x) * 4
      afterRgba[offset] = 0
      afterRgba[offset + 1] = 0
      afterRgba[offset + 2] = 0
      afterRgba[offset + 3] = 0
    }
  }
  const narrowed = diffPixelRect(beforeRgba, afterRgba, 1254, 1254, { x: 0, y: 0, w: 1254, h: 1254 })
  assert.deepEqual(narrowed, { x: patchX, y: patchY, w: 10, h: 10 })
  assert.ok(narrowed.w * narrowed.h * 4 <= WORKING_PIXELS_MAX_BYTES)
  const strips = splitPixelRectStrips({ x: 0, y: 0, w: 1254, h: 1254 }, WORKING_PIXELS_MAX_BYTES)
  assert.equal(strips.length, 2)
  assert.ok(strips[0].w * strips[0].h * 4 <= WORKING_PIXELS_MAX_BYTES)
  assert.ok(strips[1].w * strips[1].h * 4 <= WORKING_PIXELS_MAX_BYTES)

  const patchBytes = Buffer.alloc(10 * 10 * 4, 0)
  const writeOp = randomUUID()
  await writeWorkingPixels({
    projectId: project.id,
    documentId: workingDocId,
    operationId: writeOp,
    expectedRevision: revision,
    expectedWorkingRevision: 1,
    rect: narrowed,
    rgba: patchBytes,
    expectedSha256: sha256Bytes(patchBytes),
    target: { frame_id: 'frame_1', layer_id: 'layer_1', cel_id: cel0.id },
    payload: { action: 'working_pixels', operation_id: writeOp },
    projectRoot,
    workspaceRoot,
    now,
  })

  const reopened = await getSpriteDocument({
    projectId: project.id,
    documentId: workingDocId,
    projectRoot,
    workspaceRoot,
  })
  const reopenedCel0 = Object.values(reopened.manifest.cels).find((item) => item.frame_id === 'frame_1')
  const reopenedBlock0 = await readFile(path.join(workspaceRoot, 'projects', project.id, 'sprite-documents', workingDocId, 'blocks', `${reopenedCel0.block.sha256}.rgba`))
  assert.equal(reopenedBlock0[(605 * 1254 + 605) * 4 + 3], 0)
})

test('pre-decode header check rejects >4096 edges and >128 MiB sequence budgets before decoding, and keeps proposed/omitted non-enumerable', async () => {
  // Craft a valid-looking PNG header with 4097x16 IHDR but invalid/empty IDAT so sharp decode would fail with a decode error if reached
  const fakePng4097 = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 16, 1, // width = 4097
    0, 0, 0, 16, // height = 16
    8, 6, 0, 0, 0, 0, 0, 0, 0,
  ])
  assert.deepEqual(readEncodedImageDimensions(fakePng4097), { kind: 'png', width: 4097, height: 16 })
  await assert.rejects(
    () => prepareGeneralAssetFrame(fakePng4097),
    (err) => err?.code === 'resource_limit' && /exceeds 4096/.test(err.message)
  )

  // Craft a PNG header with 4096x4096 (each frame = 64 MiB RGBA; 3 frames = 192 MiB > 128 MiB budget)
  const fakePng4096 = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 16, 0, // width = 4096
    0, 0, 16, 0, // height = 4096
    8, 6, 0, 0, 0, 0, 0, 0, 0,
  ])
  assert.deepEqual(readEncodedImageDimensions(fakePng4096), { kind: 'png', width: 4096, height: 4096 })
  await assert.rejects(
    () => prepareGeneralSequence([{ bytes: fakePng4096 }, { bytes: fakePng4096 }, { bytes: fakePng4096 }]),
    (err) => err?.code === 'resource_limit' && /128 MiB/.test(err.message)
  )
  // Also rejects when existingFrameCount pushes total frames over 128 MiB
  await assert.rejects(
    () => prepareGeneralSequence([{ bytes: fakePng4096 }], { existingFrameCount: 2 }),
    (err) => err?.code === 'resource_limit' && /128 MiB/.test(err.message)
  )

  // Non-enumerable proposed/omitted getters are not materialized during object spread
  const smallRgba = paint(6, 6, (set) => {
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < 6; x += 1) set(x, y, 0, 255, 0)
    set(2, 2, 200, 40, 40)
  })
  const smallPng = png(6, 6, smallRgba)
  const seq = await prepareGeneralSequence([{ bytes: smallPng }])
  assert.equal(Object.keys(seq.frames[0]).includes('proposed'), false)
  assert.equal(Object.keys(seq.frames[0]).includes('omitted'), false)
  assert.ok(Array.isArray(seq.frames[0].proposed))
  assert.ok(Array.isArray(seq.frames[0].omitted))
  assert.equal(seq.frames[0].proposed.length, 35)
})

test('prepareGeneralSequence honors AbortSignal and prepareSequenceSourceHandles reads batches on demand', async () => {
  const rgba = paint(4, 4, (set) => set(1, 1, 255, 0, 0))
  const framePng = png(4, 4, rgba)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => prepareGeneralSequence([{ bytes: framePng }], { signal: controller.signal }),
    (err) => err?.name === 'AbortError' || err?.code === 'ABORT_ERR'
  )

  let readCalls = 0
  const files = [0, 1, 2].map((i) => ({
    name: `f${i}.png`,
    size: framePng.byteLength,
    arrayBuffer: async () => {
      readCalls += 1
      return framePng.buffer.slice(framePng.byteOffset, framePng.byteOffset + framePng.byteLength)
    },
  }))
  const handles = prepareSequenceSourceHandles(files)
  assert.equal(readCalls, 0, 'prepareSequenceSourceHandles must not read file bytes up front')
  assert.equal(handles.length, 3)

  const progressEvents = []
  const batch0 = await readSequenceHandleBatch([handles[0], handles[1]], { ok: true }, (t) => t.ok, {
    onProgress: (info, current, total) => progressEvents.push({ info, current, total }),
  })
  assert.equal(readCalls, 2)
  assert.equal(batch0.length, 2)
  assert.equal(progressEvents.length, 2)
  assert.equal(progressEvents[0].current, 1)
  assert.equal(progressEvents[1].current, 2)
})

test('append sequence is atomic across faults, validates append target constraints, and updates prior working_sha256 when canvas expands', async () => {
  const root = await tempDir('gt-seq-atomic-')
  const createOp = randomUUID()
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: 'Atomic Append' },
    projectRoot: root,
    now,
  })
  let project = created.project

  // 1. Reject invalid append targets: blank canvas and single-PNG static import
  const blankOp = randomUUID()
  const blankRes = await createBlankSpriteDocument({
    projectId: project.id,
    operationId: blankOp,
    expectedRevision: project.revision,
    name: 'Blank',
    width: 8,
    height: 8,
    payload: { action: 'create_blank', operation_id: blankOp },
    projectRoot: root,
    now,
  })
  project = blankRes.project

  const f1Rgba = paint(4, 4, (set) => set(1, 1, 220, 30, 40))
  const f1Png = png(4, 4, f1Rgba)
  const staticOp = randomUUID()
  const staticRes = await createSpriteDocumentFromUploadedPng({
    projectId: project.id,
    operationId: staticOp,
    expectedRevision: project.revision,
    name: 'Static',
    pngBytes: f1Png,
    expectedSha256: sha256Bytes(f1Png),
    payload: { action: 'import_png', operation_id: staticOp },
    projectRoot: root,
    now,
  })
  project = staticRes.project

  const appendFrames1 = [{ bytes: f1Png, omit: [], protect: [] }]
  const appendSha1 = sha256Bytes(encodeGeneralSequenceBody(appendFrames1))
  for (const invalidTargetId of [blankRes.document.document_id, staticRes.document.document_id]) {
    const badOp = randomUUID()
    await assert.rejects(
      () => createSpriteDocumentFromGeneralSequence({
        projectId: project.id,
        operationId: badOp,
        expectedRevision: project.revision,
        name: 'AppendInvalid',
        frames: appendFrames1,
        expectedSha256: appendSha1,
        background: 'auto',
        appendDocumentId: invalidTargetId,
        payload: { action: 'import_general_sequence', operation_id: badOp, append_document_id: invalidTargetId },
        projectRoot: root,
        now,
      }),
      (err) => err?.code === 'unsupported_input'
    )
  }

  // 2. Create a valid 2-frame 4x4 sequence document (revision 1)
  const f2Rgba = paint(4, 4, (set) => set(2, 2, 40, 180, 220))
  const f2Png = png(4, 4, f2Rgba)
  const batch1Frames = [
    { bytes: f1Png, omit: [], protect: [] },
    { bytes: f2Png, omit: [], protect: [] },
  ]
  const batch1Sha = sha256Bytes(encodeGeneralSequenceBody(batch1Frames))
  const op1 = randomUUID()
  const batch1Res = await createSpriteDocumentFromGeneralSequence({
    projectId: project.id,
    operationId: op1,
    expectedRevision: project.revision,
    name: 'SeqDoc',
    frames: batch1Frames,
    expectedSha256: batch1Sha,
    background: 'auto',
    payload: { action: 'import_general_sequence', operation_id: op1 },
    projectRoot: root,
    now,
  })
  project = batch1Res.project
  const seqDocId = batch1Res.document.document_id
  const seqAssetId = batch1Res.document.source_ref.asset_id
  const rev1Id = batch1Res.document.source_ref.revision_id
  assert.ok(seqAssetId && rev1Id)

  // Also reject appending to a derived working copy of that sequence document
  const seqCanvas = Object.values(project.canvases).find((c) => c.document_id === seqDocId)
  assert.ok(seqCanvas?.id)
  const deriveOp = randomUUID()
  const derivedRes = await deriveWorkingSpriteDocument({
    projectId: project.id,
    sourceCanvasId: seqCanvas.id,
    sourceDocumentId: seqDocId,
    sourceRevision: 1,
    operationId: deriveOp,
    expectedRevision: project.revision,
    payload: { action: 'derive_working', operation_id: deriveOp },
    projectRoot: root,
    now,
  })
  project = derivedRes.project
  const badDerivedOp = randomUUID()
  await assert.rejects(
    () => createSpriteDocumentFromGeneralSequence({
      projectId: project.id,
      operationId: badDerivedOp,
      expectedRevision: project.revision,
      name: 'AppendDerived',
      frames: appendFrames1,
      expectedSha256: appendSha1,
      background: 'auto',
      appendDocumentId: derivedRes.document.document_id,
      payload: { action: 'import_general_sequence', operation_id: badDerivedOp, append_document_id: derivedRes.document.document_id },
      projectRoot: root,
      now,
    }),
    (err) => err?.code === 'unsupported_input'
  )

  // 3. Append a larger 8x6 frame (expands canvas from 4x4 to 8x6) with fault injection on 'manifest' and 'index' first
  const f3Rgba = paint(8, 6, (set) => set(5, 4, 250, 200, 20))
  const f3Png = png(8, 6, f3Rgba)
  const batch2Frames = [{ bytes: f3Png, omit: [], protect: [] }]
  const batch2Sha = sha256Bytes(encodeGeneralSequenceBody(batch2Frames))
  const op2 = randomUUID()

  for (const faultStage of ['manifest', 'index']) {
    await assert.rejects(
      () => createSpriteDocumentFromGeneralSequence({
        projectId: project.id,
        operationId: op2,
        expectedRevision: project.revision,
        name: 'SeqDoc',
        frames: batch2Frames,
        expectedSha256: batch2Sha,
        background: 'auto',
        appendDocumentId: seqDocId,
        payload: { action: 'import_general_sequence', operation_id: op2, append_document_id: seqDocId },
        projectRoot: root,
        now,
        fault: faultStage,
      }),
      (err) => err?.code === 'storage_commit_failed'
    )
    // Verify published project still points to sequence.json with 2 frames (atomic, never mutated in place)
    const afterFaultProject = JSON.parse(await readFile(path.join(root, 'workspace', 'projects', project.id, 'project.json'), 'utf8'))
    const rev1Entry = afterFaultProject.assets[seqAssetId].revisions[rev1Id]
    const rev1Seq = JSON.parse(await readFile(path.join(root, rev1Entry.artifacts.sequence), 'utf8'))
    assert.equal(rev1Seq.frames.length, 2)
  }

  // 4. Retry with the SAME operationId op2 (no fault) -> succeeds cleanly with 3 frames and updated working_sha256 for padded frames 0 & 1
  const batch2Res = await createSpriteDocumentFromGeneralSequence({
    projectId: project.id,
    operationId: op2,
    expectedRevision: project.revision,
    name: 'SeqDoc',
    frames: batch2Frames,
    expectedSha256: batch2Sha,
    background: 'auto',
    appendDocumentId: seqDocId,
    payload: { action: 'import_general_sequence', operation_id: op2, append_document_id: seqDocId },
    projectRoot: root,
    now,
  })
  assert.equal(batch2Res.document.frame_order.length, 3)
  assert.deepEqual(batch2Res.document.canvas, { w: 8, h: 6 })
  const committedProject = JSON.parse(await readFile(path.join(root, 'workspace', 'projects', project.id, 'project.json'), 'utf8'))
  const latestRevId = batch2Res.document.source_ref.revision_id
  const latestSeqRel = committedProject.assets[seqAssetId].revisions[latestRevId].artifacts.sequence
  assert.match(latestSeqRel, new RegExp(`sequence-r${batch2Res.document.revision}-[0-9a-f]{12}\\.json$`))
  const latestSeq = JSON.parse(await readFile(path.join(root, latestSeqRel), 'utf8'))
  assert.equal(latestSeq.frames.length, 3)
  assert.equal(latestSeq.frames[0].padded, true)
  assert.equal(latestSeq.frames[0].placed_width, 8)
  assert.equal(latestSeq.frames[0].placed_height, 6)
  const cel1 = Object.values(batch2Res.document.cels).find((c) => c.frame_id === 'frame_1')
  assert.equal(latestSeq.frames[0].working_sha256, cel1.block.sha256)

  // 5. §18.12 Item 4: Pre-manifest append failure followed by a DIFFERENT valid operation succeeds without 409 immutable file conflict
  const opFailed = randomUUID()
  const failedPng = png(8, 6, paint(8, 6, (set) => {
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 0, 255, 0)
    set(2, 2, 180, 40, 90)
  }))
  const failedFrames = [{ bytes: failedPng, omit: [], protect: [] }]
  const failedBody = encodeGeneralSequenceBody(failedFrames)
  await assert.rejects(
    () => createSpriteDocumentFromGeneralSequence({
      projectId: project.id,
      operationId: opFailed,
      expectedRevision: batch2Res.project.revision,
      name: 'SeqDoc',
      frames: failedFrames,
      expectedSha256: sha256Bytes(failedBody),
      background: 'auto',
      appendDocumentId: seqDocId,
      payload: { action: 'import_general_sequence', operation_id: opFailed, append_document_id: seqDocId },
      projectRoot: root,
      now,
      fault: 'manifest',
    }),
    (err) => err?.code === 'storage_commit_failed'
  )

  const opDifferent = randomUUID()
  const differentPng = png(8, 6, paint(8, 6, (set) => {
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < 8; x += 1) set(x, y, 0, 255, 0)
    set(5, 4, 20, 120, 220)
  }))
  const differentFrames = [{ bytes: differentPng, omit: [], protect: [] }]
  const differentBody = encodeGeneralSequenceBody(differentFrames)
  const batch3Res = await createSpriteDocumentFromGeneralSequence({
    projectId: project.id,
    operationId: opDifferent,
    expectedRevision: batch2Res.project.revision,
    name: 'SeqDoc',
    frames: differentFrames,
    expectedSha256: sha256Bytes(differentBody),
    background: 'auto',
    appendDocumentId: seqDocId,
    payload: { action: 'import_general_sequence', operation_id: opDifferent, append_document_id: seqDocId },
    projectRoot: root,
    now,
  })
  assert.equal(batch3Res.document.frame_order.length, 4)
  const docAfterDifferent = await getSpriteDocument({ projectId: project.id, documentId: seqDocId, projectRoot: root })
  assert.equal(docAfterDifferent.manifest.frame_order.length, 4)
})

test('assertSequencePreviewBudget enforces 128 MiB whole-sequence expanded RGBA ceiling (§18.12 Item 1)', () => {
  assert.equal(GENERAL_SEQUENCE_MAX_EXPANDED_RGBA_BYTES, 128 * 1024 * 1024)
  const within = assertSequencePreviewBudget(4, 1254, 1254)
  assert.equal(within.expandedRgbaBytes, 4 * 1254 * 1254 * 4)
  assert.throws(
    () => assertSequencePreviewBudget(3, 4096, 4096),
    (err) => err?.code === 'resource_limit' && err?.message === SEQUENCE_EXPANDED_LIMIT_MESSAGE
  )
})

test('GIF export matches gifenc oneBitAlpha=128 quantization threshold and preserves decoded pixel alpha across 0/127/128/129/255 (§18.12 Item 6)', async () => {
  async function decodeGifRgba(gifBytes) {
    const { data, info } = await sharp(gifBytes, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  }

  // 1. Single-color opaque (alpha = 255): palette has 1 color at index 0; must stay opaque after decode
  const singleColorOpaque = {
    width: 2,
    height: 2,
    data: Uint8Array.from([
      180, 60, 40, 255,
      180, 60, 40, 255,
      180, 60, 40, 255,
      180, 60, 40, 255,
    ]),
  }
  const singleColorGif = encodeGifFromRgbaFrames([singleColorOpaque], { delay: 100 })
  const decodedSingle = await decodeGifRgba(singleColorGif)
  for (let i = 0; i < 4; i += 1) {
    assert.equal(decodedSingle.data[i * 4 + 3], 255, `single-color opaque pixel ${i} must have decoded alpha 255`)
    assert.equal(decodedSingle.data[i * 4] > 150, true)
  }

  // 2. Two-color opaque (alpha = 255): both palette index 0 and index 1 must stay opaque after decode
  const twoColorOpaque = {
    width: 2,
    height: 1,
    data: Uint8Array.from([
      20, 180, 60, 255,
      200, 40, 160, 255,
    ]),
  }
  const twoColorGif = encodeGifFromRgbaFrames([twoColorOpaque], { delay: 100 })
  const decodedTwo = await decodeGifRgba(twoColorGif)
  assert.equal(decodedTwo.data[3], 255, 'two-color opaque pixel 0 must have decoded alpha 255')
  assert.equal(decodedTwo.data[7], 255, 'two-color opaque pixel 1 must have decoded alpha 255')

  // 3. Alpha boundary: alpha = 127 (transparent), alpha = 128 (transparent per oneBitAlpha=128), alpha = 129 (opaque), alpha = 0 (transparent)
  for (const [alphaValue, expectedDecodedAlpha] of [
    [0, 0],
    [127, 0],
    [128, 0],
    [129, 255],
  ]) {
    const boundaryFrame = {
      width: 2,
      height: 1,
      data: Uint8Array.from([
        220, 100, 50, alphaValue,
        40, 160, 220, 255,
      ]),
    }
    const encoder = GIFEncoder()
    const writeRes = writeGifFrameFromRgba(encoder, boundaryFrame, { delay: 100 })
    assert.equal(writeRes.hasTransparency, expectedDecodedAlpha === 0, `alpha=${alphaValue} hasTransparency mismatch`)
    const gifBytes = encodeGifFromRgbaFrames([boundaryFrame], { delay: 100 })
    const decoded = await decodeGifRgba(gifBytes)
    assert.equal(
      decoded.data[3],
      expectedDecodedAlpha,
      `pixel with alpha=${alphaValue} must decode to alpha=${expectedDecodedAlpha} (got RGBA ${[...decoded.data.slice(0, 4)]})`
    )
    if (expectedDecodedAlpha === 255) {
      assert.equal(decoded.data[0] > 180, true, 'alpha=129 must preserve non-black RGB')
    }
    assert.equal(decoded.data[7], 255, `companion opaque pixel for alpha=${alphaValue} must decode to alpha=255`)
  }
})

test('buildFrameGifFromImages clamps maxUncompressedBytes to 128 MiB and rejects small-PNG + 4096x4096 target before decode (§18.12 Item 7)', async () => {
  assert.equal(MAX_FRAME_GIF_FRAMES, 256)
  assert.equal(MAX_FRAME_GIF_EDGE, 4096)
  assert.equal(MAX_FRAME_GIF_UNCOMPRESSED_BYTES, 128 * 1024 * 1024)

  const tinyPng = png(4, 4, paint(4, 4, (set) => set(1, 1, 200, 100, 50)))
  const tooManyFrames = Array.from({ length: 257 }, () => tinyPng)
  let decodedCount = 0
  await assert.rejects(
    () => buildFrameGifFromImages(tooManyFrames, { onFrameDecode: () => { decodedCount += 1 } }),
    (err) => /256/.test(err.message)
  )
  assert.equal(decodedCount, 0)

  // Construct a minimal PNG header with IHDR dimensions 4096x4096 without allocating a 64 MiB image
  function fakePngHeader(width, height) {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(13, 8)
    buf.write('IHDR', 12, 'ascii')
    buf.writeUInt32BE(width, 16)
    buf.writeUInt32BE(height, 20)
    buf[24] = 8
    buf[25] = 6
    return buf
  }

  // 3 frames of 4096x4096 = 192 MiB > 128 MiB budget -> rejected before decoding any frame,
  // even when caller passes an oversized maxUncompressedBytes (clamped at 128 MiB)
  const overBudgetFrames = [
    fakePngHeader(4096, 4096),
    fakePngHeader(4096, 4096),
    fakePngHeader(4096, 4096),
  ]
  await assert.rejects(
    () => buildFrameGifFromImages(overBudgetFrames, {
      maxUncompressedBytes: 1024 * 1024 * 1024,
      onFrameDecode: () => { decodedCount += 1 },
    }),
    (err) => /128 MiB/.test(err.message)
  )
  assert.equal(decodedCount, 0, 'caller must not be able to raise the 128 MiB cap')

  // Small 4x4 PNG frames + 4096x4096 target (3 * 4096 * 4096 * 4 = 192 MiB > 128 MiB) -> rejected before decode
  await assert.rejects(
    () => buildFrameGifFromImages([tinyPng, tinyPng, tinyPng], {
      targetW: 4096,
      targetH: 4096,
      maxUncompressedBytes: 1024 * 1024 * 1024,
      onFrameDecode: () => { decodedCount += 1 },
    }),
    (err) => /128 MiB/.test(err.message)
  )
  assert.equal(decodedCount, 0, 'small PNGs with 4096x4096 target must reject before decoding any frame')

  // Lowering maxUncompressedBytes for small-fixture testing is still honored
  await assert.rejects(
    () => buildFrameGifFromImages([tinyPng, tinyPng], {
      targetW: 4,
      targetH: 4,
      maxUncompressedBytes: 64,
      onFrameDecode: () => { decodedCount += 1 },
    }),
    (err) => /128 MiB/.test(err.message)
  )
  assert.equal(decodedCount, 0)

  // Edge > 4096 -> rejected before decoding any frame
  await assert.rejects(
    () => buildFrameGifFromImages([fakePngHeader(4097, 16)], { onFrameDecode: () => { decodedCount += 1 } }),
    (err) => /4096/.test(err.message)
  )
  assert.equal(decodedCount, 0)

  // Valid opaque frames produce GIF whose decoded pixels are all opaque (alpha === 255)
  const opaquePng = png(4, 4, paint(4, 4, (set) => {
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) set(x, y, 30 + x * 10, 60 + y * 10, 90, 255)
  }))
  const built = await buildFrameGifFromImages([opaquePng, opaquePng], {
    targetW: 4,
    targetH: 4,
    padding: 0,
    onFrameDecode: () => { decodedCount += 1 },
  })
  assert.equal(decodedCount, 2)
  const decodedBuilt = await sharp(built, { animated: true }).ensureAlpha().raw().toBuffer()
  for (let i = 3; i < decodedBuilt.length; i += 4) {
    assert.equal(decodedBuilt[i], 255, 'all pixels across both opaque frames must decode with alpha 255')
  }
})

test('fixed-region processSheetBuffer exports background-removed OCAD and RPGMaker sheets, thumbs, and ZIPs while preserving raw source.png and normalized fallback (§18.12 Item 9)', async () => {
  const sheetW = 252
  const sheetH = 252
  const rawSheet = png(sheetW, sheetH, paint(sheetW, sheetH, (set) => {
    // Solid green background across the 252x252 sheet
    for (let y = 0; y < sheetH; y += 1) {
      for (let x = 0; x < sheetW; x += 1) {
        set(x, y, 0, 255, 0, 255)
      }
    }
    // idledown region in FIXED_REGION_SOURCE_REGIONS: x=189, y=126, width=21, height=42
    for (let y = 136; y < 156; y += 1) {
      for (let x = 194; x < 204; x += 1) {
        set(x, y, 200, 60, 40, 255)
      }
    }
    // walkdown0..2: x=126..188, y=0, width=21, height=42 each
    for (let col = 0; col < 3; col += 1) {
      const ox = 126 + col * 21
      for (let y = 10; y < 30; y += 1) {
        for (let x = ox + 5; x < ox + 15; x += 1) {
          set(x, y, 40, 120, 220, 255)
        }
      }
    }
    // walkL0..2: x=0..62, y=84, width=21, height=42 each — asymmetric left/right colors to verify horizontal flip
    for (let col = 0; col < 3; col += 1) {
      const ox = col * 21
      for (let y = 96; y < 112; y += 1) {
        for (let x = ox + 2; x < ox + 7; x += 1) set(x, y, 240, 180, 20, 255) // gold on left side of region
        for (let x = ox + 14; x < ox + 19; x += 1) set(x, y, 20, 180, 240, 255) // cyan on right side of region
      }
    }
    // walkup0..2: x=126..188, y=42, width=21, height=42 each
    for (let col = 0; col < 3; col += 1) {
      const ox = 126 + col * 21
      for (let y = 52; y < 72; y += 1) {
        for (let x = ox + 5; x < ox + 15; x += 1) {
          set(x, y, 180, 50, 200, 255)
        }
      }
    }
  }))

  const rawSheetSha = sha256Bytes(rawSheet)
  const processed = await processSheetBuffer(rawSheet, {
    name: 'fixed-bg-check',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
    sourcePixelRecovery: 'global_median_v1',
    backgroundMode: 'deterministic_pixel_matte_v2',
    backgroundMatteV2ArtifactUrlPrefix: 'file:///tmp/test-matte',
  })

  // 1. Original encoded sha256 is recorded and source.png retains the pre-matte working source with green background
  assert.equal(processed.debugReport.source_pixel_recovery.original_encoded_sha256, rawSheetSha, 'original encoded sha256 must match raw input')
  const sourceDecoded = await sharp(processed.files.sourcePng).ensureAlpha().raw().toBuffer()
  assert.deepEqual([...sourceDecoded.slice(0, 4)], [0, 255, 0, 255], 'source.png working source retains pre-matte background')

  // 2. OCAD sprite.png (252x252) has transparent background and preserves idledown subject RGBA at (198, 145)
  const ocadSprite = await sharp(processed.files.ocadSpritePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(ocadSprite.info.width, 252)
  assert.equal(ocadSprite.info.height, 252)
  assert.equal(ocadSprite.data[3], 0, 'OCAD sprite.png top-left background must be transparent')
  const idleSubjectIdx = (145 * 252 + 198) * 4
  assert.deepEqual([...ocadSprite.data.slice(idleSubjectIdx, idleSubjectIdx + 4)], [200, 60, 40, 255])

  // 3. OCAD thumb.png (21x42 sliced from idledown [189, 126, 21, 42]) has transparent background and subject RGBA at (9, 19)
  const ocadThumb = await sharp(processed.files.ocadThumbPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(ocadThumb.info.width, 21)
  assert.equal(ocadThumb.info.height, 42)
  assert.equal(ocadThumb.data[3], 0, 'OCAD thumb.png top-left background must be transparent')
  const thumbSubjectIdx = (19 * 21 + 9) * 4
  assert.deepEqual([...ocadThumb.data.slice(thumbSubjectIdx, thumbSubjectIdx + 4)], [200, 60, 40, 255])

  // 4. RPGMaker sprite.png (144x192, 3x4 cells of 48x48) has transparent background, walk subjects, and row 2 mirrors row 1 horizontally
  const rpgSprite = await sharp(processed.files.rpgmakerSpritePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(rpgSprite.info.width, 144)
  assert.equal(rpgSprite.info.height, 192)
  assert.equal(rpgSprite.data[3], 0, 'RPGMaker sprite.png top-left background must be transparent')
  // Check row 0 (walk_down) subject at cell (0,0) center (x=24, y=20)
  const row0Idx = (20 * 144 + 24) * 4
  assert.deepEqual([...rpgSprite.data.slice(row0Idx, row0Idx + 4)], [40, 120, 220, 255])
  // Check row 1 (walk_left, y=48..95) vs row 2 (walk_right, y=96..143) horizontal flip across all 3 columns
  let sawGold = false
  let sawCyan = false
  for (let col = 0; col < 3; col += 1) {
    const cellX = col * 48
    for (let ry = 0; ry < 48; ry += 1) {
      for (let rx = 0; rx < 48; rx += 1) {
        const leftIdx = ((48 + ry) * 144 + (cellX + rx)) * 4
        const rightIdx = ((96 + ry) * 144 + (cellX + (47 - rx))) * 4
        const leftRgba = [...rpgSprite.data.slice(leftIdx, leftIdx + 4)]
        const rightRgba = [...rpgSprite.data.slice(rightIdx, rightIdx + 4)]
        assert.deepEqual(rightRgba, leftRgba, `RPGMaker row 2 pixel (${rx},${ry}) must mirror row 1 pixel (${47 - rx},${ry})`)
        if (leftRgba[0] === 240 && leftRgba[1] === 180 && leftRgba[2] === 20 && leftRgba[3] === 255) sawGold = true
        if (leftRgba[0] === 20 && leftRgba[1] === 180 && leftRgba[2] === 240 && leftRgba[3] === 255) sawCyan = true
      }
    }
  }
  assert.equal(sawGold && sawCyan, true, 'RPGMaker walk_left and mirrored walk_right must contain both asymmetric subject colors')
  // Check row 3 (walk_up, y=144..191) subject at cell (0,3) center (x=24, y=164)
  const row3Idx = (164 * 144 + 24) * 4
  assert.deepEqual([...rpgSprite.data.slice(row3Idx, row3Idx + 4)], [180, 50, 200, 255])

  // 5. RPGMaker thumb.png (48x48) has transparent background and walk_down subject
  const rpgThumb = await sharp(processed.files.rpgmakerThumbPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(rpgThumb.info.width, 48)
  assert.equal(rpgThumb.info.height, 48)
  assert.equal(rpgThumb.data[3], 0, 'RPGMaker thumb.png top-left background must be transparent')
  const rpgThumbIdx = (20 * 48 + 24) * 4
  assert.deepEqual([...rpgThumb.data.slice(rpgThumbIdx, rpgThumbIdx + 4)], [40, 120, 220, 255])

  // 6. Verify ZIP contents in zipBuffer, ocadZipBuffer, and rpgmakerZipBuffer match the files byte-for-byte
  const mainZip = await JSZip.loadAsync(processed.files.zipBuffer)
  const ocadZip = await JSZip.loadAsync(processed.files.ocadZipBuffer)
  const rpgZip = await JSZip.loadAsync(processed.files.rpgmakerZipBuffer)
  const findZipEntry = (zip, suffix) => {
    const match = Object.keys(zip.files).find((name) => name.endsWith(suffix))
    assert.ok(match, `expected zip entry ending with ${suffix}`)
    return zip.files[match].async('nodebuffer')
  }
  assert.equal(Buffer.compare(await findZipEntry(mainZip, 'source.png'), processed.files.sourcePng), 0)
  assert.equal(Buffer.compare(await findZipEntry(mainZip, '_ocad/sprite.png'), processed.files.ocadSpritePng), 0)
  assert.equal(Buffer.compare(await findZipEntry(mainZip, '_ocad/thumb.png'), processed.files.ocadThumbPng), 0)
  assert.equal(Buffer.compare(await findZipEntry(mainZip, '_rpgmaker/sprite.png'), processed.files.rpgmakerSpritePng), 0)
  assert.equal(Buffer.compare(await findZipEntry(mainZip, '_rpgmaker/thumb.png'), processed.files.rpgmakerThumbPng), 0)
  assert.equal(Buffer.compare(await findZipEntry(ocadZip, '_ocad/sprite.png'), processed.files.ocadSpritePng), 0)
  assert.equal(Buffer.compare(await findZipEntry(ocadZip, '_ocad/thumb.png'), processed.files.ocadThumbPng), 0)
  assert.equal(Buffer.compare(await findZipEntry(rpgZip, '_rpgmaker/sprite.png'), processed.files.rpgmakerSpritePng), 0)
  assert.equal(Buffer.compare(await findZipEntry(rpgZip, '_rpgmaker/thumb.png'), processed.files.rpgmakerThumbPng), 0)

  // 7. Passthrough positive case: backgroundMode: 'passthrough' keeps green background [0, 255, 0, 255]
  const passthroughProcessed = await processSheetBuffer(rawSheet, {
    name: 'fixed-passthrough-check',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
    backgroundMode: 'passthrough',
  })
  const passthroughOcad = await sharp(passthroughProcessed.files.ocadSpritePng).ensureAlpha().raw().toBuffer()
  assert.deepEqual([...passthroughOcad.slice(0, 4)], [0, 255, 0, 255], 'passthrough mode must preserve background color')

  // 8. Normalized-only fallback (sourcePng: null) still builds valid OCAD and RPGMaker assets from normalized runtime frames
  const normDecoded = await sharp(processed.files.normalizedSheetPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cols = TOPDOWN_RPG_V0.grid.columns
  const rows = TOPDOWN_RPG_V0.grid.rows
  const fw = TOPDOWN_RPG_V0.frame.w
  const fh = TOPDOWN_RPG_V0.frame.h
  const runtimeFrames = Array.from({ length: cols * rows }, (_, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const data = new Uint8ClampedArray(fw * fh * 4)
    for (let y = 0; y < fh; y += 1) {
      for (let x = 0; x < fw; x += 1) {
        const src = ((row * fh + y) * normDecoded.info.width + (col * fw + x)) * 4
        const dst = (y * fw + x) * 4
        data[dst] = normDecoded.data[src]
        data[dst + 1] = normDecoded.data[src + 1]
        data[dst + 2] = normDecoded.data[src + 2]
        data[dst + 3] = normDecoded.data[src + 3]
      }
    }
    return { index, image: { width: fw, height: fh, data } }
  })
  const fallbackExports = await buildEngineExportArtifacts({
    metadataJson: processed.metadataJson,
    frames: runtimeFrames,
    profile: TOPDOWN_RPG_V0,
    normalizedSheetPng: processed.files.normalizedSheetPng,
    sourcePng: null,
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
  })
  const fbOcadSprite = Object.entries(fallbackExports.ocadExport.files).find(([k]) => k.endsWith('/sprite.png'))[1]
  const fbRpgSprite = Object.entries(fallbackExports.rpgmakerExport.files).find(([k]) => k.endsWith('/sprite.png'))[1]
  const fbOcadDecoded = await sharp(fbOcadSprite).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const fbRpgDecoded = await sharp(fbRpgSprite).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(fbOcadDecoded.info.width, 252)
  assert.equal(fbOcadDecoded.info.height, 252)
  assert.equal(fbOcadDecoded.data[(130 * 252 + 130) * 4 + 3], 0)
  assert.deepEqual([...fbOcadDecoded.data.slice((20 * 252 + 10) * 4, (20 * 252 + 10) * 4 + 4)], [40, 120, 220, 255])
  assert.equal(fbRpgDecoded.info.width, 144)
  assert.equal(fbRpgDecoded.info.height, 192)
  assert.equal(fbRpgDecoded.data[3], 0)
})

test('general-sequence HTTP endpoint rejects Content-Length > GENERAL_SEQUENCE_MAX_BODY_BYTES (71,305,479 B) with 413 before body allocation and preserves fitted native original metadata, /recent, reopen, and cross-project/forgery defenses (§18.12 Items 8 & 10)', async () => {
  const root = await tempDir('gametool-seq-provenance-')
  const { project } = await createEditorProjectV1({
    operationId: randomUUID(),
    name: 'GenSeqProj',
    payload: { action: 'create_project' },
    projectRoot: root,
    now,
  })
  const { project: otherProject } = await createEditorProjectV1({
    operationId: randomUUID(),
    name: 'OtherProj',
    payload: { action: 'create_project' },
    projectRoot: root,
    now,
  })

  // Create a 1254x1254 native image and run real prepareNativeImage to fit it to 1024x1024 while retaining 1254x1254 original
  const native1254 = await sharp({
    create: { width: 1254, height: 1254, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  })
    .composite([{
      input: await sharp({
        create: { width: 300, height: 300, channels: 4, background: { r: 220, g: 80, b: 40, alpha: 1 } },
      }).png().toBuffer(),
      left: 400,
      top: 400,
    }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  const preparedFitted = await prepareNativeImage(native1254)
  const fittedSha = sha256Bytes(preparedFitted.bytes)
  assert.equal(preparedFitted.transformation.type, 'fit')
  assert.equal(preparedFitted.width, 1024)
  assert.equal(preparedFitted.height, 1024)
  assert.equal(preparedFitted.original.width, 1254)
  assert.equal(preparedFitted.original.height, 1254)

  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const imageGeneration = createImageGeneration({
    providers: {
      grok: {
        async installed() {
          return true
        },
        async generate() {
          return {
            ...preparedFitted,
          }
        },
      },
    },
  })

  const server = http.createServer((req, res) =>
    handleEditorProjectApi(req, res, {
      projectRoot: root,
      artifactAccessRegistry,
      imageGeneration,
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    // Item 8: Formal HTTP Content-Length boundary check (GENERAL_SEQUENCE_MAX_BODY_BYTES + 1 = 71,305,480 B rejected with 413 without allocating body)
    const status413 = await new Promise((resolve, reject) => {
      const req = http.request(
        `${baseUrl}/api/editor/projects/${project.id}/sprite-documents/general-sequence?operation_id=${randomUUID()}&expected_revision=${project.revision}&expected_sha256=${'0'.repeat(64)}&name=TooBig&background=auto`,
        {
          method: 'POST',
          headers: {
            Origin: baseUrl,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(GENERAL_SEQUENCE_MAX_BODY_BYTES + 1),
            'X-Editor-Storage-Version': '2',
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk.toString() })
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }))
        }
      )
      req.on('error', reject)
      req.write(Buffer.alloc(64))
      req.end()
    })
    assert.equal(status413.status, 413)
    assert.equal(status413.body.error, 'resource_limit')

    // Start an offline job in project A via real createImageGeneration
    const job1Op = randomUUID()
    const start1 = await editorFetch(`${baseUrl}/api/editor/projects/${project.id}/image-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Editor-Storage-Version': '2' },
      body: JSON.stringify({ operation_id: job1Op, provider: 'grok', description: 'knight on pure green #00ff00' }),
    })
    assert.equal(start1.status, 202)
    let job1 = await start1.json()
    while (job1.status === 'queued' || job1.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const poll = await editorFetch(`${baseUrl}/api/editor/projects/${project.id}/image-generation/${job1.id}`)
      job1 = await poll.json()
    }
    assert.equal(job1.status, 'done')
    assert.equal(job1.fitted, true)

    // Verify /recent initially lists job1 with imported: false
    const recentBefore = await (await editorFetch(`${baseUrl}/api/editor/projects/${project.id}/image-generation/recent`)).json()
    const job1Before = recentBefore.jobs.find((j) => j.id === job1.id)
    assert.ok(job1Before)
    assert.equal(job1Before.imported, false)

    // Download fitted source bytes (1024x1024) and adopt via general-sequence with a mask delta
    // so working PNG differs from frame_0_original
    const sourceRes = await editorFetch(`${baseUrl}${job1.source_url}`)
    assert.equal(sourceRes.status, 200)
    const fittedSourceBytes = Buffer.from(await sourceRes.arrayBuffer())
    assert.equal(sha256Bytes(fittedSourceBytes), fittedSha)

    // Cross-project defense: project B cannot adopt project A's jobId
    const crossBody = encodeGeneralSequenceBody([{ bytes: fittedSourceBytes, selection: { mode: 'proposal' } }])
    const crossRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${otherProject.id}/sprite-documents/general-sequence?operation_id=${randomUUID()}&expected_revision=${otherProject.revision}&expected_sha256=${sha256Bytes(crossBody)}&name=Cross&background=green&source_job_id=${job1.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Editor-Storage-Version': '2' },
        body: crossBody,
      }
    )
    assert.equal(crossRes.status, 404, 'cross-project source_job_id adoption must be rejected with 404')

    // Forgery defense: tampered bytes with project A's job1.id must be rejected with 422 artifact_integrity_failed
    const tamperedPng = png(8, 8, paint(8, 8, (set) => set(0, 0, 12, 34, 56)))
    const tamperedBody = encodeGeneralSequenceBody([{ bytes: tamperedPng, selection: { mode: 'proposal' } }])
    const tamperedRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${project.id}/sprite-documents/general-sequence?operation_id=${randomUUID()}&expected_revision=${project.revision}&expected_sha256=${sha256Bytes(tamperedBody)}&name=Tampered&background=green&source_job_id=${job1.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Editor-Storage-Version': '2' },
        body: tamperedBody,
      }
    )
    assert.equal(tamperedRes.status, 422, 'forged bytes not matching source_job_id must be rejected with 422')

    // Baseline proposal preview on fittedSourceBytes to identify recovered grid dimensions and subject cell
    const proposalPreview = await prepareGeneralSequence(
      [{ bytes: fittedSourceBytes, selection: { mode: 'proposal' } }],
      { background: 'green' }
    )
    const recW = proposalPreview.width
    const recH = proposalPreview.height
    const propRgba = proposalPreview.frames[0].working
    const subjX = Math.floor(recW * 0.45)
    const subjY = Math.floor(recH * 0.45)
    const subjOff = (subjY * recW + subjX) * 4
    const subjNextOff = (subjY * recW + (subjX + 1)) * 4
    assert.deepEqual([...propRgba.slice(0, 4)], [0, 0, 0, 0], 'proposal omits top-left green background cell [0,0]')
    assert.deepEqual([...propRgba.slice(subjOff, subjOff + 4)], [220, 80, 40, 255], 'proposal keeps interior subject cell [subjX,subjY]')
    assert.deepEqual([...propRgba.slice(subjNextOff, subjNextOff + 4)], [220, 80, 40, 255], 'proposal keeps neighboring subject cell [subjX+1,subjY]')

    // Legitimate adoption of fitted job1 with valid manual delta selection:
    // removed: [[0, 0]] restores cell [0, 0] to opaque green; added: [[subjX, subjY]] omits subject cell [subjX, subjY] to transparent
    const manualSelection = { mode: 'delta', removed: [[0, 0]], added: [[subjX, subjY]] }
    const seqBody = encodeGeneralSequenceBody([
      {
        bytes: fittedSourceBytes,
        selection: manualSelection,
      },
    ])
    const decodedBody = decodeGeneralSequenceBody(seqBody)
    assert.deepEqual(decodedBody[0].selection, manualSelection, 'codec encodes and decodes removed/added delta cells')

    const seqSha = sha256Bytes(seqBody)
    const op1 = randomUUID()
    const res1 = await editorFetch(
      `${baseUrl}/api/editor/projects/${project.id}/sprite-documents/general-sequence?operation_id=${op1}&expected_revision=${project.revision}&expected_sha256=${seqSha}&name=Knight&background=green&source_job_id=${job1.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Editor-Storage-Version': '2',
        },
        body: seqBody,
      }
    )
    assert.equal(res1.status, 201)
    const body1 = await res1.json()
    const assetEntry = Object.values(body1.project.assets).find((a) =>
      Object.values(a.revisions || {}).some((r) => r.source_job_id === job1.id)
    )
    assert.ok(assetEntry, 'asset revision must record source_job_id')
    assert.equal(assetEntry.provenance.source_type, 'provider')
    assert.equal(assetEntry.provenance.provider, 'grok')
    assert.equal(assetEntry.provenance.model, 'native-imagine')
    const revEntry = Object.values(assetEntry.revisions)[0]
    assert.ok(revEntry.artifacts.native_original)
    assert.ok(revEntry.artifacts.generation_metadata)
    assert.ok(revEntry.artifacts.frame_0_original)
    assert.ok(revEntry.artifacts.sequence)

    // Verify generation-metadata.json binds native_original (1254x1254) -> frame_0_original (1024x1024 fitted input),
    // while sequence.json and on-disk working block PNG reflect C recovery + manual delta mask
    const genMeta = JSON.parse(await readFile(path.join(root, revEntry.artifacts.generation_metadata), 'utf8'))
    const seqMeta = JSON.parse(await readFile(path.join(root, revEntry.artifacts.sequence), 'utf8'))
    const diskNativeOriginal = await readFile(path.join(root, revEntry.artifacts.native_original))
    const diskFrame0Original = await readFile(path.join(root, revEntry.artifacts.frame_0_original))
    const celBlockSha = Object.values(body1.document.cels)[0].block.sha256
    const diskWorkingRgba = new Uint8Array(
      await readFile(
        path.join(root, 'workspace', 'projects', project.id, 'sprite-documents', body1.document.document_id, 'blocks', `${celBlockSha}.rgba`)
      )
    )

    assert.equal(genMeta.source_job_id, job1.id)
    assert.deepEqual(genMeta.original, {
      artifact: 'native_original',
      sha256: preparedFitted.original.sha256,
      mime_type: 'image/png',
      width: 1254,
      height: 1254,
    })
    assert.equal(sha256Bytes(diskNativeOriginal), genMeta.original.sha256)
    assert.deepEqual(genMeta.image, {
      artifact: 'frame_0_original',
      sha256: fittedSha,
      mime_type: 'image/png',
      width: 1024,
      height: 1024,
    })
    assert.equal(sha256Bytes(diskFrame0Original), genMeta.image.sha256)
    assert.equal(seqMeta.frames[0].original_sha256, fittedSha)
    assert.equal(seqMeta.frames[0].working_sha256, sha256Bytes(diskWorkingRgba), 'sequence working_sha256 matches decoded on-disk working RGBA')
    assert.notEqual(seqMeta.frames[0].working_sha256, sha256Bytes(propRgba), 'manual delta mask changes working RGBA compared to automatic proposal RGBA')
    assert.deepEqual([...diskWorkingRgba.slice(0, 4)], [0, 255, 0, 255], 'removed: [[0,0]] restores top-left cell to opaque green on disk')
    assert.deepEqual([...diskWorkingRgba.slice(4, 8)], [0, 0, 0, 0], 'neighboring background cell [1,0] remains omitted transparent on disk')
    assert.deepEqual([...diskWorkingRgba.slice(subjOff, subjOff + 4)], [0, 0, 0, 0], 'added: [[subjX,subjY]] omits interior subject cell to transparent on disk')
    assert.deepEqual([...diskWorkingRgba.slice(subjNextOff, subjNextOff + 4)], [220, 80, 40, 255], 'neighboring subject cell [subjX+1,subjY] remains opaque orange on disk')

    // Verify /recent now marks job1 imported: true and project reopen preserves everything
    const recentAfter = await (await editorFetch(`${baseUrl}/api/editor/projects/${project.id}/image-generation/recent`)).json()
    const job1After = recentAfter.jobs.find((j) => j.id === job1.id)
    assert.ok(job1After)
    assert.equal(job1After.imported, true)

    const reopened = await (await editorFetch(`${baseUrl}/api/editor/projects/${project.id}`)).json()
    assert.equal(reopened.project.revision, body1.project.revision)
    assert.ok(reopened.project.assets[assetEntry.id])

    // Second import attempt of the same source_job_id with a new operation_id returns 200 already_imported: true
    const op2 = randomUUID()
    const res2 = await editorFetch(
      `${baseUrl}/api/editor/projects/${project.id}/sprite-documents/general-sequence?operation_id=${op2}&expected_revision=${body1.project.revision}&expected_sha256=${seqSha}&name=Knight&background=green&source_job_id=${job1.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Editor-Storage-Version': '2',
        },
        body: seqBody,
      }
    )
    assert.equal(res2.status, 200)
    const body2 = await res2.json()
    assert.equal(body2.already_imported, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('server.js rejects non-object JSON payloads on /api/project-pack and /api/build-frame-gif with 400 invalid_json and stays healthy (§18.12 Item 5)', async () => {
  const freePort = await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(freePort),
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderrText = ''
  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString()
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server start timeout')), 8000)
      child.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('Character tool running')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`server exited early: ${code}`))
      })
    })
    const baseUrl = `http://127.0.0.1:${freePort}`
    const endpoints = [
      ['/api/project-pack', 'invalid_json'],
      ['/api/build-two-point-five-d-tileset', 'invalid_json'],
      ['/api/two-point-five-d-material-source-benchmark', 'invalid_json'],
      ['/api/build-frame-gif', 'gif_build_failed'],
    ]
    for (const [endpoint, expectedError] of endpoints) {
      for (const rawPayload of ['null', '[]', '123', '"str"']) {
        const res = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            Origin: baseUrl,
            'Content-Type': 'application/json',
          },
          body: rawPayload,
        })
        assert.equal(res.status, 400, `${endpoint} with ${rawPayload} must return 400`)
        const json = await res.json()
        assert.equal(json.error, expectedError)
      }
    }
    // Also verify /api/build-frame-gif ignores oversized maxUncompressedBytes option on 3 tiny frames + 4096x4096 target
    const tinyPngBase64 = png(4, 4, paint(4, 4, (set) => set(1, 1, 200, 100, 50))).toString('base64')
    const overGifRes = await fetch(`${baseUrl}/api/build-frame-gif`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frames_base64: [tinyPngBase64, tinyPngBase64, tinyPngBase64],
        options: {
          targetW: 4096,
          targetH: 4096,
          maxUncompressedBytes: 1024 * 1024 * 1024,
        },
      }),
    })
    assert.equal(overGifRes.status, 400)
    const overGifJson = await overGifRes.json()
    assert.equal(overGifJson.error, 'gif_build_failed')
    assert.match(overGifJson.reason, /128 MiB/)

    assert.equal(child.exitCode, null, 'server process must remain alive')
    assert.equal(stderrText.includes('UnhandledPromiseRejection'), false)

    // Subsequent valid request on /api/gemini-state still succeeds
    const healthRes = await fetch(`${baseUrl}/api/gemini-state`, {
      headers: { Origin: baseUrl },
    })
    assert.equal(healthRes.status, 200)
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }
})

test('general-sequence document supports direct in-place writeWorkingPixels, changeWorkingStructure, and restoreWorkingSpriteDocument without derive-working while preserving retained originals', async () => {
  const root = await tempDir('general-sequence-inplace-edit-')
  const now = new Date('2026-10-14T12:00:00.000Z')
  const created = await createEditorProjectV1({
    operationId: randomUUID(),
    name: 'Direct Sequence Edit',
    payload: { action: 'create' },
    projectRoot: root,
    now,
  })
  const first = paint(4, 4, (set) => {
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) set(x, y, 0, 255, 0)
    set(1, 1, 200, 40, 20)
  })
  const second = paint(4, 4, (set) => {
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) set(x, y, 0, 255, 0)
    set(2, 2, 40, 120, 220)
  })
  const frames = [
    { bytes: png(4, 4, first), selection: { mode: 'proposal' } },
    { bytes: png(4, 4, second), selection: { mode: 'proposal' } },
  ]
  const body = encodeGeneralSequenceBody(frames)
  const importOp = randomUUID()
  const imported = await createSpriteDocumentFromGeneralSequence({
    projectId: created.project.id,
    operationId: importOp,
    expectedRevision: created.project.revision,
    expectedSha256: sha256Bytes(body),
    frames,
    background: 'green',
    name: 'FlameSeq',
    payload: { action: 'import_general_sequence', operation_id: importOp },
    projectRoot: root,
    now,
  })
  const docId = imported.document.document_id
  const canvas = Object.values(imported.project.canvases)[0]
  assert.equal(imported.document.derived_from ?? null, null, 'general-sequence document starts without derived_from')
  assert.equal(Object.keys(imported.project.canvases).length, 1)

  const asset = Object.values(imported.project.assets)[0]
  const assetRev = Object.values(asset.revisions)[0]
  const origFrame0Path = path.join(root, assetRev.artifacts.frame_0_original)
  const origFrame1Path = path.join(root, assetRev.artifacts.frame_1_original)
  const recFrame0Path = path.join(root, assetRev.artifacts.frame_0_recovered)
  const recFrame1Path = path.join(root, assetRev.artifacts.frame_1_recovered)
  const seqJsonPath = path.join(root, assetRev.artifacts.sequence)
  const origFrame0Sha = sha256Bytes(await readFile(origFrame0Path))
  const origFrame1Sha = sha256Bytes(await readFile(origFrame1Path))
  const recFrame0Sha = sha256Bytes(await readFile(recFrame0Path))
  const recFrame1Sha = sha256Bytes(await readFile(recFrame1Path))
  const seqJsonSha = sha256Bytes(await readFile(seqJsonPath))

  const celFrame1 = Object.values(imported.document.cels).find((item) => item.frame_id === 'frame_1' && item.layer_id === 'layer_1')
  const celFrame2 = Object.values(imported.document.cels).find((item) => item.frame_id === 'frame_2' && item.layer_id === 'layer_1')
  const initialFrame1Sha = celFrame1.block.sha256
  const initialFrame2Sha = celFrame2.block.sha256
  const initialFrame2Block = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: docId,
    sha256: initialFrame2Sha,
    projectRoot: root,
  })
  assert.deepEqual([...initialFrame2Block.bytes.subarray(0, 4)], [0, 0, 0, 0], 'initial frame_2 (0,0) is transparent after green background removal')
  assert.deepEqual([...initialFrame2Block.bytes.subarray((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 4)], [40, 120, 220, 255], 'initial frame_2 (2,2) foreground pixel preserved')

  // 1. Direct in-place pixel edit on frame_2 of the general-sequence document (no deriveWorkingSpriteDocument)
  const patch = Buffer.from([255, 220, 0, 255])
  const writeOp = randomUUID()
  const wrote = await writeWorkingPixels({
    projectId: imported.project.id,
    documentId: docId,
    operationId: writeOp,
    expectedRevision: imported.project.revision,
    expectedWorkingRevision: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    rgba: patch,
    expectedSha256: sha256Bytes(patch),
    target: { frame_id: 'frame_2', layer_id: 'layer_1', cel_id: celFrame2.id },
    payload: { action: 'working_pixels', operation_id: writeOp },
    projectRoot: root,
    now,
  })
  assert.equal(wrote.document.document_id, docId)
  assert.equal(wrote.document.revision, 2)
  assert.equal(wrote.document.derived_from ?? null, null, 'in-place edit does not forge derived_from')
  assert.equal(Object.keys(wrote.project.canvases).length, 1, 'in-place edit does not create a new canvas')
  assert.equal(wrote.document.cels[celFrame1.id].block.sha256, initialFrame1Sha, 'non-target frame_1 block sha256 is untouched')
  const editedFrame2Sha = wrote.document.cels[celFrame2.id].block.sha256
  assert.notEqual(editedFrame2Sha, initialFrame2Sha, 'target frame_2 block sha256 updated on disk')
  const editedFrame2Block = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: docId,
    sha256: editedFrame2Sha,
    projectRoot: root,
  })
  assert.deepEqual([...editedFrame2Block.bytes.subarray(0, 4)], [255, 220, 0, 255], 'on-disk working block for frame_2 has edited pixel at (0,0)')
  assert.deepEqual([...editedFrame2Block.bytes.subarray((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 4)], [40, 120, 220, 255], 'on-disk working block for frame_2 preserves untouched pixel at (2,2)')

  // 2. Direct in-place structure changes (add-layer + upsert-text) on the same general-sequence document
  const layerOp = randomUUID()
  const layered = await changeWorkingStructure({
    projectId: imported.project.id,
    documentId: docId,
    operationId: layerOp,
    expectedRevision: wrote.project.revision,
    expectedWorkingRevision: wrote.document.revision,
    command: { type: 'add-layer', name: 'Overlay' },
    payload: { action: 'working_structure', operation_id: layerOp },
    projectRoot: root,
    now,
  })
  assert.equal(layered.document.revision, 3)
  assert.equal(layered.document.layer_order.length, 2)
  assert.equal(Object.keys(layered.project.canvases).length, 1)

  const overlayLayerId = layered.document.layer_order[0]
  const textOp = randomUUID()
  const texted = await changeWorkingStructure({
    projectId: imported.project.id,
    documentId: docId,
    operationId: textOp,
    expectedRevision: layered.project.revision,
    expectedWorkingRevision: layered.document.revision,
    command: {
      type: 'upsert-text',
      id: 'text_seq_1',
      frame_id: 'frame_2',
      layer_id: overlayLayerId,
      text: 'F2',
      x: 0,
      y: 0,
      size: 6,
      font: { kind: 'generic', name: 'monospace' },
      bold: false,
      italic: false,
      antialias: false,
      mode: 'fill',
      stroke_width: 1,
      color: '#ffffffff',
    },
    payload: { action: 'working_structure', operation_id: textOp },
    projectRoot: root,
    now,
  })
  assert.equal(texted.document.revision, 4)
  assert.equal(texted.document.text_objects?.items?.length, 1)
  assert.equal(texted.document.text_objects.items[0].id, 'text_seq_1')

  // 3. Undo back to revision 1 in place via restoreWorkingSpriteDocument, then Redo back to revision 2
  const restoreUndoOp = randomUUID()
  const restoredUndo = await restoreWorkingSpriteDocument({
    projectId: imported.project.id,
    documentId: docId,
    operationId: restoreUndoOp,
    expectedRevision: texted.project.revision,
    expectedWorkingRevision: texted.document.revision,
    targetRevision: 1,
    mode: 'structure',
    payload: { action: 'restore_working', operation_id: restoreUndoOp },
    projectRoot: root,
    now,
  })
  assert.equal(restoredUndo.document.revision, 5)
  assert.equal(restoredUndo.document.layer_order.length, 1)
  assert.equal(restoredUndo.document.cels[celFrame2.id].block.sha256, initialFrame2Sha, 'Undo to rev 1 restores original frame_2 working block sha256')
  const undoBlock = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: docId,
    sha256: restoredUndo.document.cels[celFrame2.id].block.sha256,
    projectRoot: root,
  })
  assert.deepEqual([...undoBlock.bytes.subarray(0, 4)], [0, 0, 0, 0], 'Undo to rev 1 restores transparent pixel at frame_2 (0,0)')

  const restoreRedoOp = randomUUID()
  const restoredRedo = await restoreWorkingSpriteDocument({
    projectId: imported.project.id,
    documentId: docId,
    operationId: restoreRedoOp,
    expectedRevision: restoredUndo.project.revision,
    expectedWorkingRevision: restoredUndo.document.revision,
    targetRevision: 2,
    mode: 'structure',
    payload: { action: 'restore_working', operation_id: restoreRedoOp },
    projectRoot: root,
    now,
  })
  assert.equal(restoredRedo.document.revision, 6)
  assert.equal(restoredRedo.document.cels[celFrame2.id].block.sha256, editedFrame2Sha, 'Redo to rev 2 restores edited frame_2 working block sha256')

  // 4. Reopen from disk via getSpriteDocument + readSpriteBlock and verify persisted working pixels and retained originals
  const reopened = await getSpriteDocument({
    projectId: imported.project.id,
    documentId: docId,
    projectRoot: root,
  })
  assert.equal(reopened.manifest.revision, 6)
  assert.equal(reopened.manifest.derived_from ?? null, null)
  assert.equal(reopened.manifest.cels[celFrame1.id].block.sha256, initialFrame1Sha)
  assert.equal(reopened.manifest.cels[celFrame2.id].block.sha256, editedFrame2Sha)
  const reopenedFrame2Block = await readSpriteBlock({
    projectId: imported.project.id,
    documentId: docId,
    sha256: reopened.manifest.cels[celFrame2.id].block.sha256,
    projectRoot: root,
  })
  assert.deepEqual([...reopenedFrame2Block.bytes.subarray(0, 4)], [255, 220, 0, 255], 'Reopened document from disk preserves edited working pixel at frame_2 (0,0)')

  // Retained original files and sequence record are untouched
  assert.equal(sha256Bytes(await readFile(origFrame0Path)), origFrame0Sha)
  assert.equal(sha256Bytes(await readFile(origFrame1Path)), origFrame1Sha)
  assert.equal(sha256Bytes(await readFile(recFrame0Path)), recFrame0Sha)
  assert.equal(sha256Bytes(await readFile(recFrame1Path)), recFrame1Sha)
  assert.equal(sha256Bytes(await readFile(seqJsonPath)), seqJsonSha)

  // 5. Explicit deriveWorkingSpriteDocument still works when user or AI explicitly requests a copy
  const deriveOp = randomUUID()
  const copied = await deriveWorkingSpriteDocument({
    projectId: imported.project.id,
    operationId: deriveOp,
    expectedRevision: restoredRedo.project.revision,
    sourceCanvasId: canvas.id,
    sourceDocumentId: docId,
    sourceRevision: restoredRedo.document.revision,
    name: 'FlameSeq · copy',
    payload: { action: 'derive_working', operation_id: deriveOp },
    projectRoot: root,
    now,
  })
  assert.notEqual(copied.document.document_id, docId)
  assert.equal(copied.document.derived_from.document_id, docId)
  assert.equal(Object.keys(copied.project.canvases).length, 2)
  assert.equal(copied.document.cels[celFrame1.id].block.sha256, initialFrame1Sha)
  assert.equal(copied.document.cels[celFrame2.id].block.sha256, editedFrame2Sha)
})
