import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createEditorProjectV1, createSpriteDocumentFromUploadedPng, deriveWorkingSpriteDocument,
  encodeRgbaPng, writeWorkingPixels } from '../../src/editor-project/spriteDocumentStore.js'
import { sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'

export async function historyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'history-fixture-'))
  const createId = randomUUID(), createPayload = { operation_id: createId, name: null }
  const created = await createEditorProjectV1({ projectRoot: root, operationId: createId, payload: createPayload })
  const png = encodeRgbaPng(2, 2, Buffer.alloc(16))
  const importId = randomUUID(), digest = sha256Bytes(png)
  const imported = await createSpriteDocumentFromUploadedPng({ projectRoot: root, projectId: created.project.id,
    operationId: importId, expectedRevision: 1, expectedSha256: digest, pngBytes: png,
    payload: { operation_id: importId, expected_revision: 1, expected_sha256: digest, name: null } })
  const source = Object.values(imported.project.canvases)[0]
  const operationId = randomUUID()
  const derived = await deriveWorkingSpriteDocument({ projectRoot: root, projectId: created.project.id, operationId,
    expectedRevision: imported.project.revision, sourceCanvasId: source.id, sourceDocumentId: source.document_id, sourceRevision: 1,
    payload: { operation_id: operationId, expected_revision: imported.project.revision, source_canvas_id: source.id,
      source_document_id: source.document_id, source_revision: 1, name: null } })
  return { root, result: derived, createId, createPayload, created }
}
export function pixelRequest(root, result, value) {
  const operationId = randomUUID(), rgba = Buffer.from([value % 256, Math.floor(value / 256) % 256, 102, 255])
  const documentId = result.document.document_id, projectId = result.project.id, rect = { x: 0, y: 0, w: 1, h: 1 }
  const expectedSha256 = sha256Bytes(rgba)
  const payload = { action: 'working_pixels', operation_id: operationId, expected_revision: result.project.revision,
    expected_working_revision: result.document.revision, document_id: documentId, ...rect, expected_sha256: expectedSha256 }
  return { projectRoot: root, projectId, documentId, operationId, expectedRevision: result.project.revision,
    expectedWorkingRevision: result.document.revision, rect, rgba, expectedSha256, payload }
}
export { writeWorkingPixels }

export async function inlineHistoryFixture(project, projectRoot) {
  if (project.version === 'editor_project_v1') return structuredClone(project)
  const { createProjectHistoryIndex, documentHistoryKey, readHistoryReceiptRecord } = await import('../../src/editor-project/projectHistoryIndex.js')
  const { resolveEditorProjectPaths } = await import('../../src/editor-project/paths.js')
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot })
  const copy = structuredClone(project)
  const revisionEntries = new Map()
  for await (const [key, hash] of createProjectHistoryIndex(paths, 'revisions').entries(project.history.revisions)) {
    revisionEntries.set(key, await readHistoryReceiptRecord(paths, hash))
  }
  for (const [id, doc] of Object.entries(copy.sprite_documents)) {
    const revisions = {}
    for (let revision = 1; revision <= doc.max_revision; revision++) {
      const metadata = revisionEntries.get(documentHistoryKey(id, revision))
      if (metadata) revisions[revision] = metadata
    }
    copy.sprite_documents[id] = { id, working_revision: doc.working_revision, accepted_revision: doc.accepted_revision, revisions }
  }
  copy.operation_receipts = {}
  for await (const [id, hash] of createProjectHistoryIndex(paths, 'receipts').entries(project.history.receipts)) {
    copy.operation_receipts[id] = await readHistoryReceiptRecord(paths, hash)
  }
  copy.version = 'editor_project_v1'
  delete copy.history
  return copy
}
