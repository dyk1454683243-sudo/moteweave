import test from 'node:test'
import { lookupProjectReceipt } from '../../src/editor-project/projectHistoryStore.js'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import {
  createEditorProjectV1,
  createSpriteDocumentFromUploadedPng,
  encodeRgbaPng,
  getSpriteDocument,
  loadEditorProject,
  readSpriteBlock,
  resolveManagedRevisionArtifactFile,
  saveCanvasLayout,
  sha256Bytes,
} from '../../src/editor-project/index.js'

const now = '2026-09-18T00:00:00.000Z'
const createOp = '55555555-5555-4555-8555-555555555551'
const importOp = '55555555-5555-4555-8555-555555555552'
const importOpTwo = '55555555-5555-4555-8555-555555555553'
const layoutOp = '55555555-5555-4555-8555-555555555554'
const layoutOpTwo = '55555555-5555-4555-8555-555555555555'
const otherOp = '55555555-5555-4555-8555-555555555556'
const layoutAckOp = '55555555-5555-4555-8555-555555555557'
const layoutStaleOp = '55555555-5555-4555-8555-555555555558'
const altCreateOp = '55555555-5555-4555-8555-555555555559'
const altImportOp = '55555555-5555-4555-8555-55555555555a'
const ctorOp = '55555555-5555-4555-8555-55555555555b'

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  CRC_TABLE[index] = crc >>> 0
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function insertChunk(png, type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  const chunk = Buffer.concat([length, typeBytes, data, crc])
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)])
}

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'p2-03-canvas-'))
}

function miniPixels() {
  return Buffer.from([
    10, 20, 30, 0,
    40, 50, 60, 128,
    70, 80, 90, 255,
    1, 2, 3, 0,
  ])
}

function importPayload(operationId, expectedRevision, digest, name = null) {
  return {
    action: 'import_png',
    operation_id: operationId,
    expected_revision: expectedRevision,
    expected_sha256: digest,
    name,
  }
}

function layoutPayload(operationId, expectedRevision, positions) {
  return {
    action: 'save_canvas_layout',
    operation_id: operationId,
    expected_revision: expectedRevision,
    positions: [...positions].sort((left, right) => left.canvas_id.localeCompare(right.canvas_id)),
  }
}

async function emptyV1(root, operationId = createOp, workspaceRoot) {
  return createEditorProjectV1({
    operationId,
    payload: { operation_id: operationId, name: null },
    projectRoot: root,
    workspaceRoot,
    now,
  })
}

function canvasForDocument(project, documentId) {
  return Object.values(project.canvases).find((item) => item.document_id === documentId)
}

test('PNG import commits original bytes, RGBA, and canvas once, and layout restores only listed positions', async () => {
  const root = await tempRoot()
  const created = await emptyV1(root)
  const pixels = miniPixels()
  const png = encodeRgbaPng(2, 2, pixels)
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
  assert.equal(imported.replayed, false)
  assert.equal(imported.project.revision, 2)
  assert.equal(imported.document.frames.frame_1.duration_ms, 1000)
  assert.equal(imported.document.layers.layer_1.kind, 'raster')
  assert.equal(imported.project.sprite_documents[imported.document.document_id].working_revision, 1)
  assert.equal(imported.project.sprite_documents[imported.document.document_id].accepted_revision, null)
  const asset = imported.project.assets[imported.document.source_ref.asset_id]
  assert.equal(asset.kind, 'static_image')
  assert.equal(asset.provenance.source_type, 'upload')
  assert.equal(asset.revisions[asset.active_revision_id].source_job_id, null)
  const storedPng = await readFile(path.join(root, asset.revisions[asset.active_revision_id].artifacts.image))
  assert.equal(sha256Bytes(storedPng), digest)
  const canvas = canvasForDocument(imported.project, imported.document.document_id)
  assert.equal(canvas.x, 0)
  assert.equal(canvas.y, 0)
  assert.deepEqual(imported.project.pages[0].canvas_order, [canvas.id])

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const childScript = `
    import { getSpriteDocument, readSpriteBlock } from ${JSON.stringify(path.join(repoRoot, 'src/editor-project/index.js'))};
    const loaded = await getSpriteDocument({
      projectId: ${JSON.stringify(created.project.id)},
      documentId: ${JSON.stringify(imported.document.document_id)},
      projectRoot: ${JSON.stringify(root)},
    });
    const block = await readSpriteBlock({
      projectId: ${JSON.stringify(created.project.id)},
      documentId: ${JSON.stringify(imported.document.document_id)},
      sha256: loaded.manifest.cels.cel_frame_1_layer_1.block.sha256,
      projectRoot: ${JSON.stringify(root)},
    });
    process.stdout.write(JSON.stringify({
      duration: loaded.manifest.frames.frame_1.duration_ms,
      pixels: Buffer.from(block.bytes).toString('hex'),
    }));
  `
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || stdout || `exit ${code}`))
      else resolve(JSON.parse(stdout))
    })
  })
  assert.equal(child.duration, 1000)
  assert.equal(child.pixels, pixels.toString('hex'))

  const secondPng = encodeRgbaPng(2, 2, Buffer.from([9, 8, 7, 0, 6, 5, 4, 128, 3, 2, 1, 255, 0, 0, 0, 0]))
  const secondDigest = sha256Bytes(secondPng)
  const second = await createSpriteDocumentFromUploadedPng({
    projectId: created.project.id,
    operationId: importOpTwo,
    expectedRevision: 2,
    expectedSha256: secondDigest,
    pngBytes: secondPng,
    payload: importPayload(importOpTwo, 2, secondDigest),
    projectRoot: root,
    now,
  })
  const firstCanvas = canvasForDocument(second.project, imported.document.document_id)
  const secondCanvas = canvasForDocument(second.project, second.document.document_id)
  const firstManifestSha = second.project.sprite_documents[imported.document.document_id].working.manifest_sha256
  const firstBlock = imported.document.cels.cel_frame_1_layer_1.block.sha256
  const moved = await saveCanvasLayout({
    projectId: created.project.id,
    operationId: layoutOp,
    expectedRevision: 3,
    positions: [{ canvas_id: firstCanvas.id, x: 16, y: -8 }],
    payload: layoutPayload(layoutOp, 3, [{ canvas_id: firstCanvas.id, x: 16, y: -8 }]),
    projectRoot: root,
    now,
  })
  assert.equal(moved.replayed, false)
  assert.equal(moved.project.revision, 4)
  assert.equal(moved.receipt.document_id, null)
  assert.equal(moved.project.canvases[firstCanvas.id].x, 16)
  assert.equal(moved.project.canvases[firstCanvas.id].y, -8)
  assert.equal(moved.project.canvases[secondCanvas.id].x, 0)
  assert.equal(moved.project.canvases[secondCanvas.id].y, 0)
  assert.deepEqual(moved.project.pages[0].canvas_order, [firstCanvas.id, secondCanvas.id])
  assert.equal(moved.project.sprite_documents[imported.document.document_id].working_revision, 1)
  assert.equal(moved.project.sprite_documents[imported.document.document_id].accepted_revision, null)
  assert.equal(
    moved.project.sprite_documents[imported.document.document_id].working.manifest_sha256,
    firstManifestSha,
  )
  const still = await getSpriteDocument({
    projectId: created.project.id,
    documentId: imported.document.document_id,
    projectRoot: root,
  })
  assert.equal(still.manifest.revision, 1)
  assert.equal(still.manifest.cels.cel_frame_1_layer_1.block.sha256, firstBlock)
  const pixelsAgain = await readSpriteBlock({
    projectId: created.project.id,
    documentId: imported.document.document_id,
    sha256: firstBlock,
    projectRoot: root,
  })
  assert.deepEqual(Buffer.from(pixelsAgain.bytes), pixels)

  const layoutChildScript = `
    import { getSpriteDocument, loadEditorProject, readSpriteBlock } from ${JSON.stringify(path.join(repoRoot, 'src/editor-project/index.js'))};
    const loaded = await loadEditorProject({
      projectId: ${JSON.stringify(created.project.id)},
      projectRoot: ${JSON.stringify(root)},
    });
    const doc = await getSpriteDocument({
      projectId: ${JSON.stringify(created.project.id)},
      documentId: ${JSON.stringify(imported.document.document_id)},
      projectRoot: ${JSON.stringify(root)},
    });
    const block = await readSpriteBlock({
      projectId: ${JSON.stringify(created.project.id)},
      documentId: ${JSON.stringify(imported.document.document_id)},
      sha256: ${JSON.stringify(firstBlock)},
      projectRoot: ${JSON.stringify(root)},
    });
    process.stdout.write(JSON.stringify({
      revision: loaded.project.revision,
      saved: loaded.project.canvases[${JSON.stringify(firstCanvas.id)}],
      unlisted: loaded.project.canvases[${JSON.stringify(secondCanvas.id)}],
      order: loaded.project.pages[0].canvas_order,
      working: loaded.project.sprite_documents[${JSON.stringify(imported.document.document_id)}].working_revision,
      accepted: loaded.project.sprite_documents[${JSON.stringify(imported.document.document_id)}].accepted_revision,
      manifestSha: loaded.project.sprite_documents[${JSON.stringify(imported.document.document_id)}].working.manifest_sha256,
      documentId: doc.manifest.document_id,
      block: Buffer.from(block.bytes).toString('hex'),
    }));
  `
  const layoutChild = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', layoutChildScript], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || stdout || `exit ${code}`))
      else resolve(JSON.parse(stdout))
    })
  })
  assert.equal(layoutChild.revision, 4)
  assert.equal(layoutChild.saved.x, 16)
  assert.equal(layoutChild.saved.y, -8)
  assert.equal(layoutChild.saved.document_id, imported.document.document_id)
  assert.equal(layoutChild.unlisted.x, 0)
  assert.equal(layoutChild.unlisted.y, 0)
  assert.equal(layoutChild.unlisted.document_id, second.document.document_id)
  assert.deepEqual(layoutChild.order, [firstCanvas.id, secondCanvas.id])
  assert.equal(layoutChild.working, 1)
  assert.equal(layoutChild.accepted, null)
  assert.equal(layoutChild.manifestSha, firstManifestSha)
  assert.equal(layoutChild.documentId, imported.document.document_id)
  assert.equal(layoutChild.block, pixels.toString('hex'))
})

test('import and layout recover same-op races, stale/conflict, and pre/post index faults', async () => {
  const root = await tempRoot()
  const created = await emptyV1(root)
  const png = encodeRgbaPng(2, 2, miniPixels())
  const digest = sha256Bytes(png)
  const payload = importPayload(importOp, 1, digest)
  const [left, right] = await Promise.all([
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: root,
      now,
    }),
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: root,
      now,
    }),
  ])
  assert.equal(left.receipt.document_id, right.receipt.document_id)
  assert.equal(left.project.revision, 2)
  assert.equal(right.project.revision, 2)
  assert.equal(left.replayed !== right.replayed, true)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      name: 'Other',
      payload: importPayload(importOp, 1, digest, 'Other'),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'operation_conflict',
  )
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOpTwo,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload: importPayload(importOpTwo, 1, digest),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'stale_revision',
  )

  const canvasId = canvasForDocument(left.project, left.document.document_id).id
  const layoutBody = [{ canvas_id: canvasId, x: 4, y: 5 }]
  const layoutPay = layoutPayload(layoutOp, 2, layoutBody)
  const [layoutLeft, layoutRight] = await Promise.all([
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: layoutOp,
      expectedRevision: 2,
      positions: layoutBody,
      payload: layoutPay,
      projectRoot: root,
      now,
    }),
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: layoutOp,
      expectedRevision: 2,
      positions: layoutBody,
      payload: layoutPay,
      projectRoot: root,
      now,
    }),
  ])
  assert.equal(layoutLeft.replayed !== layoutRight.replayed, true)
  assert.equal(layoutLeft.project.revision, 3)
  await assert.rejects(
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: layoutOp,
      expectedRevision: 2,
      positions: [{ canvas_id: canvasId, x: 9, y: 9 }],
      payload: layoutPayload(layoutOp, 2, [{ canvas_id: canvasId, x: 9, y: 9 }]),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'operation_conflict',
  )
  await assert.rejects(
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: layoutStaleOp,
      expectedRevision: 2,
      positions: [{ canvas_id: canvasId, x: 1, y: 1 }],
      payload: layoutPayload(layoutStaleOp, 2, [{ canvas_id: canvasId, x: 1, y: 1 }]),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'stale_revision',
  )

  const failRoot = await tempRoot()
  const failProject = await emptyV1(failRoot, otherOp)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: failProject.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: failRoot,
      now,
      fault: 'asset',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed !== true,
  )
  const before = await loadEditorProject({ projectId: failProject.project.id, projectRoot: failRoot })
  assert.equal(before.project.revision, 1)
  assert.equal(Object.keys(before.project.canvases).length, 0)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: failProject.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: failRoot,
      now,
      fault: 'index',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed !== true,
  )
  const stillEmpty = await loadEditorProject({ projectId: failProject.project.id, projectRoot: failRoot })
  assert.equal(stillEmpty.project.revision, 1)

  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: failProject.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: failRoot,
      now,
      fault: 'index_sync',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const recovered = await createSpriteDocumentFromUploadedPng({
    projectId: failProject.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: failRoot,
    now,
  })
  assert.equal(recovered.replayed, true)
  assert.equal(recovered.project.revision, 2)

  const ackRoot = await tempRoot()
  const ackProject = await emptyV1(ackRoot, otherOp)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: ackProject.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: digest,
      pngBytes: png,
      payload,
      projectRoot: ackRoot,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const ackReplay = await createSpriteDocumentFromUploadedPng({
    projectId: ackProject.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: ackRoot,
    now,
  })
  assert.equal(ackReplay.replayed, true)

  const layoutFail = await tempRoot()
  const layoutProject = await emptyV1(layoutFail, otherOp)
  const ready = await createSpriteDocumentFromUploadedPng({
    projectId: layoutProject.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: layoutFail,
    now,
  })
  const readyCanvas = canvasForDocument(ready.project, ready.document.document_id).id
  await assert.rejects(
    saveCanvasLayout({
      projectId: layoutProject.project.id,
      operationId: layoutOpTwo,
      expectedRevision: 2,
      positions: [{ canvas_id: readyCanvas, x: 1, y: 1 }],
      payload: layoutPayload(layoutOpTwo, 2, [{ canvas_id: readyCanvas, x: 1, y: 1 }]),
      projectRoot: layoutFail,
      now,
      fault: 'index',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed !== true,
  )
  const unmoved = await loadEditorProject({ projectId: layoutProject.project.id, projectRoot: layoutFail })
  assert.equal(unmoved.project.revision, 2)
  assert.equal(unmoved.project.canvases[readyCanvas].x, 0)
  await assert.rejects(
    saveCanvasLayout({
      projectId: layoutProject.project.id,
      operationId: layoutOpTwo,
      expectedRevision: 2,
      positions: [{ canvas_id: readyCanvas, x: 1, y: 1 }],
      payload: layoutPayload(layoutOpTwo, 2, [{ canvas_id: readyCanvas, x: 1, y: 1 }]),
      projectRoot: layoutFail,
      now,
      fault: 'index_sync',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const layoutReplay = await saveCanvasLayout({
    projectId: layoutProject.project.id,
    operationId: layoutOpTwo,
    expectedRevision: 2,
    positions: [{ canvas_id: readyCanvas, x: 1, y: 1 }],
    payload: layoutPayload(layoutOpTwo, 2, [{ canvas_id: readyCanvas, x: 1, y: 1 }]),
    projectRoot: layoutFail,
    now,
  })
  assert.equal(layoutReplay.replayed, true)
  assert.equal(layoutReplay.project.canvases[readyCanvas].x, 1)

  const ackLayoutRoot = await tempRoot()
  const ackLayoutProject = await emptyV1(ackLayoutRoot, otherOp)
  const ackReady = await createSpriteDocumentFromUploadedPng({
    projectId: ackLayoutProject.project.id,
    operationId: importOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: ackLayoutRoot,
    now,
  })
  const ackCanvas = canvasForDocument(ackReady.project, ackReady.document.document_id).id
  await assert.rejects(
    saveCanvasLayout({
      projectId: ackLayoutProject.project.id,
      operationId: layoutAckOp,
      expectedRevision: 2,
      positions: [{ canvas_id: ackCanvas, x: 7, y: 3 }],
      payload: layoutPayload(layoutAckOp, 2, [{ canvas_id: ackCanvas, x: 7, y: 3 }]),
      projectRoot: ackLayoutRoot,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const ackLayoutReplay = await saveCanvasLayout({
    projectId: ackLayoutProject.project.id,
    operationId: layoutAckOp,
    expectedRevision: 2,
    positions: [{ canvas_id: ackCanvas, x: 7, y: 3 }],
    payload: layoutPayload(layoutAckOp, 2, [{ canvas_id: ackCanvas, x: 7, y: 3 }]),
    projectRoot: ackLayoutRoot,
    now,
  })
  assert.equal(ackLayoutReplay.replayed, true)
  assert.equal(ackLayoutReplay.project.canvases[ackCanvas].x, 7)
  assert.equal(ackLayoutReplay.project.canvases[ackCanvas].y, 3)
})

test('illegal PNG, hash, and foreign canvas ids leave the authoritative index unchanged', async () => {
  const root = await tempRoot()
  const created = await emptyV1(root)
  const png = encodeRgbaPng(2, 2, miniPixels())
  const digest = sha256Bytes(png)
  const before = await readFile(path.join(root, 'workspace', 'projects', created.project.id, 'project.json'))

  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: 'c'.repeat(64),
      pngBytes: png,
      payload: importPayload(importOp, 1, 'c'.repeat(64)),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'artifact_integrity_failed',
  )

  const actl = Buffer.alloc(8)
  actl.writeUInt32BE(2, 0)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: sha256Bytes(insertChunk(png, 'acTL', actl)),
      pngBytes: insertChunk(png, 'acTL', actl),
      payload: importPayload(importOp, 1, sha256Bytes(insertChunk(png, 'acTL', actl))),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'unsupported_input',
  )

  const icc = Buffer.concat([Buffer.from('icc\u0000'), Buffer.from([0]), deflateSync(Buffer.from('x'))])
  const iccPng = insertChunk(png, 'iCCP', icc)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: sha256Bytes(iccPng),
      pngBytes: iccPng,
      payload: importPayload(importOp, 1, sha256Bytes(iccPng)),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'unsupported_input',
  )

  const gama = Buffer.alloc(4)
  gama.writeUInt32BE(45455, 0)
  const gamaPng = insertChunk(png, 'gAMA', gama)
  await assert.rejects(
    createSpriteDocumentFromUploadedPng({
      projectId: created.project.id,
      operationId: importOp,
      expectedRevision: 1,
      expectedSha256: sha256Bytes(gamaPng),
      pngBytes: gamaPng,
      payload: importPayload(importOp, 1, sha256Bytes(gamaPng)),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'unsupported_input',
  )

  await assert.rejects(
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: layoutOp,
      expectedRevision: 1,
      positions: [{ canvas_id: 'cnotbelongshere1', x: 1, y: 1 }],
      payload: layoutPayload(layoutOp, 1, [{ canvas_id: 'cnotbelongshere1', x: 1, y: 1 }]),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'not_found',
  )

  const after = await readFile(path.join(root, 'workspace', 'projects', created.project.id, 'project.json'))
  assert.deepEqual(after, before)
  assert.equal(existsSync(path.join(root, 'workspace', 'projects', created.project.id, 'assets')), false)
})

test('uploaded PNG uses the configured workspaceRoot for write, relative ref, replay, and managed resolve', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace-alt')
  const created = await emptyV1(root, altCreateOp, workspaceRoot)
  const png = encodeRgbaPng(2, 2, miniPixels())
  const digest = sha256Bytes(png)
  const payload = importPayload(altImportOp, 1, digest)
  const imported = await createSpriteDocumentFromUploadedPng({
    projectId: created.project.id,
    operationId: altImportOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: root,
    workspaceRoot,
    now,
  })
  const asset = imported.project.assets[imported.document.source_ref.asset_id]
  const revision = asset.revisions[asset.active_revision_id]
  assert.equal(revision.artifacts.image.startsWith('workspace-alt/projects/'), true)
  assert.equal(revision.artifacts.image.includes('workspace/projects/'), false)
  assert.equal(existsSync(path.join(root, revision.artifacts.image)), true)
  assert.equal(existsSync(path.join(root, 'workspace', 'projects', created.project.id)), false)
  assert.equal(sha256Bytes(await readFile(path.join(root, revision.artifacts.image))), digest)
  const resolved = await resolveManagedRevisionArtifactFile({
    projectId: created.project.id,
    assetId: asset.id,
    revision,
    artifactKey: 'image',
    projectRoot: root,
    workspaceRoot,
  })
  assert.equal(resolved.includes(`${path.sep}workspace-alt${path.sep}projects${path.sep}`), true)
  assert.equal(resolved.includes(`${path.sep}workspace${path.sep}projects${path.sep}`), false)
  assert.equal(resolved.endsWith(`${path.sep}image.png`), true)
  assert.equal(sha256Bytes(await readFile(resolved)), digest)
  assert.equal(existsSync(path.join(root, 'workspace', 'projects', created.project.id, 'assets')), false)
  const replayed = await createSpriteDocumentFromUploadedPng({
    projectId: created.project.id,
    operationId: altImportOp,
    expectedRevision: 1,
    expectedSha256: digest,
    pngBytes: png,
    payload,
    projectRoot: root,
    workspaceRoot,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.project.revision, 2)
})

test('inherited constructor canvas id is rejected without mutating Object or the project index', async () => {
  const root = await tempRoot()
  const created = await emptyV1(root)
  const projectJson = path.join(root, 'workspace', 'projects', created.project.id, 'project.json')
  const before = await readFile(projectJson)
  const beforeX = Object.x
  const beforeY = Object.y
  await assert.rejects(
    saveCanvasLayout({
      projectId: created.project.id,
      operationId: ctorOp,
      expectedRevision: 1,
      positions: [{ canvas_id: 'constructor', x: 99, y: 88 }],
      payload: layoutPayload(ctorOp, 1, [{ canvas_id: 'constructor', x: 99, y: 88 }]),
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'not_found',
  )
  assert.deepEqual(await readFile(projectJson), before)
  assert.equal(Object.x, beforeX)
  assert.equal(Object.y, beforeY)
  assert.equal(Object.hasOwn(Object, 'x'), false)
  assert.equal(Object.hasOwn(Object, 'y'), false)
  const loaded = await loadEditorProject({ projectId: created.project.id, projectRoot: root })
  assert.equal(loaded.project.revision, 1)
  assert.equal(await lookupProjectReceipt(loaded.project, ctorOp, { projectRoot: root }), null)
  assert.equal(Object.hasOwn(loaded.project.canvases, 'constructor'), false)
})
