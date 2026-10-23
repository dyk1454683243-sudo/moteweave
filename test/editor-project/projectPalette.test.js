import test from 'node:test'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createEditorProjectV1, createSpriteDocumentFromUploadedPng, encodeRgbaPng, saveProjectPalette, getSpriteDocument } from '../../src/editor-project/spriteDocumentStore.js'
import { loadEditorProject, createEditorProject } from '../../src/editor-project/projectStore.js'
import { parseProjectPaletteRequest, sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'
import { handleEditorProjectApi } from '../../src/editor-project/apiHandler.js'
import { validateEditorProject as validateProject } from '../../src/editor-project/validation.js'
import { createEditorArtifactAccessRegistry } from '../../src/editor-project/index.js'

async function fixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-palette-')), operationId = randomUUID()
  const created = await createEditorProjectV1({ projectRoot, operationId, payload: { operation_id: operationId, name: null } })
  return { projectRoot, projectId: created.project.id, operationId: randomUUID(), expectedRevision: 1, colors: [[10, 20, 30, 0], [40, 50, 60, 128]] }
}
test('palette validates exact RGBA, capacity, empty and absent; copies input', async () => {
  const body = { operation_id: randomUUID(), expected_revision: 1, colors: [[1, 2, 3, 0]] }
  const parsed = parseProjectPaletteRequest(body); body.colors[0][0] = 90
  assert.equal(parsed.colors[0][0], 1)
  for (const colors of [[[0, 0, 0]], [[0, 0, 0, 256]], [[0, 0, 0, -1]], [[0, 0, 0, .5]], [['1', 0, 0, 0]], null]) {
    assert.throws(() => parseProjectPaletteRequest({ ...body, colors }), { code: 'invalid_request' })
  }
  assert.throws(() => parseProjectPaletteRequest({ ...body, extra: true }), { code: 'invalid_request' })
  assert.throws(() => parseProjectPaletteRequest({ ...body, colors: Array(257).fill([0, 0, 0, 0]) }), { code: 'resource_limit' })
  assert.equal(parseProjectPaletteRequest({ ...body, colors: Array(256).fill([0, 0, 0, 0]) }).colors.length, 256)
  const f = await fixture(), old = (await loadEditorProject(f)).project
  assert.equal(Object.hasOwn(old.settings, 'palette'), false)
  assert.equal(validateProject({ ...old, settings: { ...old.settings, palette: { colors: [], extra: true } } }).blocking_errors.includes('invalid_project_palette'), true)
  const saved = await saveProjectPalette({ ...f, colors: [] })
  assert.deepEqual(saved.project.settings.palette, { colors: [] })
})
test('palette persists only metadata; lost ACK replays exactly once; stale/conflicting writes reject', async () => {
  const f = await fixture(), pngBytes = encodeRgbaPng(1, 1, Buffer.from([20, 30, 40, 128])), expectedSha256 = sha256Bytes(pngBytes)
  const imported = await createSpriteDocumentFromUploadedPng({ ...f, operationId: randomUUID(), expectedSha256, pngBytes, payload: { action: 'palette_test_import', expectedSha256 } })
  const before = structuredClone(imported.project), doc = await getSpriteDocument({ ...f, documentId: imported.document.document_id })
  f.expectedRevision = 2
  await assert.rejects(saveProjectPalette({ ...f, fault: 'ack' }), { code: 'storage_commit_failed' })
  const result = await saveProjectPalette(f), reopened = (await loadEditorProject(f)).project
  assert.equal(result.replayed, true); assert.equal(reopened.revision, 3)
  assert.deepEqual(reopened.settings.palette.colors, f.colors)
  for (const key of ['canvases', 'pages', 'assets', 'sprite_documents']) assert.deepEqual(reopened[key], before[key])
  assert.deepEqual(await getSpriteDocument({ ...f, documentId: imported.document.document_id }), doc)
  await assert.rejects(saveProjectPalette({ ...f, colors: [] }), { code: 'operation_conflict' })
  await assert.rejects(saveProjectPalette({ ...f, operationId: randomUUID() }), { code: 'stale_revision' })
  assert.equal((await loadEditorProject(f)).project.revision, 3)
})
test('palette HTTP route applies Origin, size, v1 and exact payload guards', async () => {
  const f = await fixture(), artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => {
    handleEditorProjectApi(req, res, { projectRoot: f.projectRoot, workspaceRoot: path.join(f.projectRoot, 'workspace'), artifactAccessRegistry }).catch(error => res.destroy(error))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`, body = { operation_id: f.operationId, expected_revision: 1, colors: f.colors }
  const post = (data, headers = {}, id = f.projectId) => fetch(`${base}/api/editor/projects/${id}/palette`, {
    method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', ...headers }, body: typeof data === 'string' ? data : JSON.stringify(data) })
  try {
    assert.equal((await post(body, { Origin: 'https://example.com' })).status, 403)
    assert.equal((await post({ ...body, extra: 1 })).status, 400)
    assert.equal((await post(' '.repeat(256 * 1024 + 1))).status, 413)
    const v0 = await createEditorProject({ id: 'old_palette', projectRoot: f.projectRoot })
    assert.equal((await post(body, {}, v0.project.id)).status, 422)
    const response = await post(body), data = await response.json()
    assert.equal(response.status, 200); assert.equal(data.receipt.operation_id, f.operationId)
    assert.deepEqual(data.project.settings.palette.colors, f.colors)
    assert.equal((await (await post(body)).json()).project.revision, 2)
    const maxColors = Array.from({ length: 256 }, (_, idx) => [200 + (idx % 55), 100 + (idx % 155), 100 + ((idx * 3) % 155), 255])
    const maxItems = Array.from({ length: 16 }, (_, idx) => ({
      id: `palette_${idx + 1}`,
      name: `Palette Collection Entry ${idx + 1}`,
      colors: maxColors,
    }))
    const maxPayload = JSON.stringify({
      operation_id: randomUUID(),
      expected_revision: 2,
      colors: maxColors,
      active_id: 'palette_16',
      items: maxItems,
    })
    assert.ok(Buffer.byteLength(maxPayload, 'utf8') > 64 * 1024, '16x256 compact palette payload exceeds 64 KiB')
    assert.ok(Buffer.byteLength(maxPayload, 'utf8') <= 256 * 1024, '16x256 compact palette payload fits within 256 KiB')
    const maxRes = await post(maxPayload)
    const maxData = await maxRes.json()
    assert.equal(maxRes.status, 200)
    assert.equal(maxData.project.settings.palette.items.length, 16)
    assert.equal(maxData.project.settings.palette.active_id, 'palette_16')
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)) }
})
test('multiple named palettes validate active selection, persist items, preserve collection on legacy colors-only save, and keep top-level colors synchronized', async () => {
  const f = await fixture()
  const items = [
    { id: 'pal_default', name: 'Project Default', colors: [[10, 20, 30, 255]] },
    { id: 'pal_warm', name: 'Warm Arcade', colors: [[240, 120, 40, 255], [180, 40, 20, 255]] },
  ]
  const saved = await saveProjectPalette({
    ...f,
    colors: items[1].colors,
    active_id: 'pal_warm',
    items,
  })
  assert.deepEqual(saved.project.settings.palette, {
    colors: items[1].colors,
    active_id: 'pal_warm',
    items,
  })
  assert.equal(validateProject(saved.project).status, 'pass')
  // Legacy colors-only save updates the active palette item's colors while preserving items and active_id
  const updatedWarmColors = [[255, 200, 80, 255]]
  const legacySaved = await saveProjectPalette({
    projectRoot: f.projectRoot,
    projectId: f.projectId,
    operationId: randomUUID(),
    expectedRevision: saved.project.revision,
    colors: updatedWarmColors,
  })
  assert.deepEqual(legacySaved.project.settings.palette, {
    colors: updatedWarmColors,
    active_id: 'pal_warm',
    items: [
      items[0],
      { id: 'pal_warm', name: 'Warm Arcade', colors: updatedWarmColors },
    ],
  })
  assert.equal(validateProject(legacySaved.project).status, 'pass')
  // Mismatched top-level colors or unknown active_id fail validation
  assert.throws(() => parseProjectPaletteRequest({
    operation_id: randomUUID(),
    expected_revision: 2,
    colors: items[0].colors,
    active_id: 'pal_warm',
    items,
  }), { code: 'invalid_request' })
  assert.throws(() => parseProjectPaletteRequest({
    operation_id: randomUUID(),
    expected_revision: 2,
    colors: items[1].colors,
    active_id: 'pal_missing',
    items,
  }), { code: 'invalid_request' })
})
