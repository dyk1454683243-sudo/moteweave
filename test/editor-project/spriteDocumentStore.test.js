import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import {
  createAssetRef,
  createAssetRevision,
  createEditorProject,
  createEditorProjectV1,
  createSpriteDocumentFromManagedSource,
  deriveStableId,
  decodePngToRgba,
  encodeRgbaPng,
  getSpriteDocument,
  listSpriteDocuments,
  loadEditorProject,
  readSpriteBlock,
  resetSpritePixelCache,
  saveEditorProject,
  serializeEditorProject,
  sha256Bytes,
  setTrustedPersistObserver,
  writeTrustedRegularFile,
} from '../../src/editor-project/index.js'

const now = '2026-09-18T00:00:00.000Z'
const createOp = '11111111-1111-4111-8111-111111111111'
const docOp = '22222222-2222-4222-8222-222222222222'
const docOpTwo = '33333333-3333-4333-8333-333333333333'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'p2-02-store-'))
}

function rgbaFixture() {
  return Buffer.from([
    10, 20, 30, 0,
    40, 50, 60, 128,
    70, 80, 90, 255,
    1, 2, 3, 0,
  ])
}

async function seedManagedImage(root, {
  projectId = 'project_source',
  pixels = rgbaFixture(),
  width = 2,
  height = 2,
  artifact = 'image',
  metadata = null,
  clips = {},
  kind = 'static_image',
} = {}) {
  const created = await createEditorProject({
    id: projectId,
    name: 'Source Project',
    projectRoot: root,
    now,
  })
  const png = encodeRgbaPng(width, height, pixels)
  const digest = sha256Bytes(png)
  const assetId = 'asset_source'
  const revisionId = 'rev_001'
  const revisionDir = path.join(root, 'workspace', 'projects', projectId, 'assets', assetId, revisionId)
  await mkdir(revisionDir, { recursive: true })
  const fileName = artifact === 'sheet' ? 'normalized_sheet.png' : 'image.png'
  await writeFile(path.join(revisionDir, fileName), png)
  const artifacts = { [artifact]: `workspace/projects/${projectId}/assets/${assetId}/${revisionId}/${fileName}` }
  if (artifact === 'sheet') {
    await writeFile(path.join(revisionDir, 'clip_metadata.json'), '{"ok":true}\n')
    artifacts.clip_metadata = `workspace/projects/${projectId}/assets/${assetId}/${revisionId}/clip_metadata.json`
  }
  if (metadata) {
    await writeFile(path.join(revisionDir, 'editor_metadata.json'), `${JSON.stringify(metadata)}\n`)
    artifacts.editor_metadata = `workspace/projects/${projectId}/assets/${assetId}/${revisionId}/editor_metadata.json`
  }
  const project = created.project
  project.assets[assetId] = createAssetRef({
    id: assetId,
    kind,
    name: 'Source Image',
    revision: createAssetRevision({
      id: revisionId,
      createdAt: now,
      qualityStatus: 'pass',
      productionStatus: 'ready',
      artifacts,
    }),
    clips,
  })
  const saved = await saveEditorProject({
    project,
    projectRoot: root,
    expectedRevision: 1,
    now,
  })
  return { project: saved.project, digest, png, pixels, width, height }
}

async function v1WithManagedSource(root, options) {
  const seeded = await seedManagedImage(root, options)
  const { upgradeEditorProjectCopy } = await import('../../src/editor-project/index.js')
  const upgraded = await upgradeEditorProjectCopy({
    sourceProjectId: seeded.project.id,
    operationId: createOp,
    expectedRevision: seeded.project.revision,
    payload: { operation_id: createOp, expected_revision: seeded.project.revision, name: null },
    projectRoot: root,
    now,
  })
  return { ...seeded, v1: upgraded.project }
}

test('PNG encode/decode preserves alpha=0 RGB and semi-transparent bytes', () => {
  const pixels = rgbaFixture()
  const decoded = decodePngToRgba(encodeRgbaPng(2, 2, pixels))
  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 2)
  assert.deepEqual(Buffer.from(decoded.rgba), pixels)
})

test('managed RGBA document survives restart, hash reload, and source timing', async () => {
  const root = await tempRoot()
  const pixels = Buffer.concat([
    Buffer.from([11, 22, 33, 0, 44, 55, 66, 128]),
    Buffer.from([77, 88, 99, 255, 12, 13, 14, 0]),
  ])
  const seeded = await v1WithManagedSource(root, {
    pixels,
    width: 2,
    height: 2,
    artifact: 'sheet',
    kind: 'spritesheet',
    clips: {
      idle: {
        id: 'idle',
        frames: [0, 1],
        fps: 8,
        frame_size: { w: 2, h: 1 },
        anchor: { x: 0, y: 0 },
      },
    },
    metadata: {
      frames: {
        frame_1: { index: 0, frame: { x: 0, y: 0, w: 2, h: 1 }, duration: 110 },
        frame_2: { index: 1, frame: { x: 0, y: 1, w: 2, h: 1 }, duration: 220 },
      },
    },
  })
  const created = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOp,
    expectedRevision: 1,
    source: {
      asset_id: 'asset_source',
      revision_id: 'rev_001',
      artifact: 'sheet',
      expected_sha256: seeded.digest,
    },
    payload: {
      operation_id: docOp,
      expected_revision: 1,
      source: {
        asset_id: 'asset_source',
        revision_id: 'rev_001',
        artifact: 'sheet',
        expected_sha256: seeded.digest,
      },
      name: null,
    },
    projectRoot: root,
    now,
  })
  assert.equal(created.document.frames.frame_1.duration_ms, 110)
  assert.equal(created.document.frames.frame_2.duration_ms, 220)
  resetSpritePixelCache()
  const reloaded = await loadEditorProject({ projectId: seeded.v1.id, projectRoot: root })
  const listed = await listSpriteDocuments({ projectId: seeded.v1.id, projectRoot: root })
  const manifest = await getSpriteDocument({
    projectId: seeded.v1.id,
    documentId: created.receipt.document_id,
    projectRoot: root,
  })
  assert.equal(reloaded.project.revision, created.project.revision)
  assert.equal(listed.documents.length, 1)
  assert.equal(manifest.manifest_sha256, created.project.sprite_documents[created.receipt.document_id].working.manifest_sha256)
  const first = await readSpriteBlock({
    projectId: seeded.v1.id,
    documentId: created.receipt.document_id,
    sha256: created.document.cels.cel_frame_1_layer_1.block.sha256,
    projectRoot: root,
  })
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from([11, 22, 33, 0, 44, 55, 66, 128]))
})

test('two documents stay isolated and stale/idempotent operations keep the authoritative revision', async () => {
  const root = await tempRoot()
  const firstPixels = Buffer.from([9, 8, 7, 0, 6, 5, 4, 255, 3, 2, 1, 128, 0, 0, 0, 0])
  const seeded = await v1WithManagedSource(root, { pixels: firstPixels })
  const payload = {
    operation_id: docOp,
    expected_revision: 1,
    source: {
      asset_id: 'asset_source',
      revision_id: 'rev_001',
      artifact: 'image',
      expected_sha256: seeded.digest,
    },
    name: null,
  }
  const first = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    projectRoot: root,
    now,
  })
  const replay = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    projectRoot: root,
    now,
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.project.revision, first.project.revision)
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: docOp,
      expectedRevision: 1,
      source: payload.source,
      payload: { ...payload, name: 'Other' },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'operation_conflict',
  )
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: docOpTwo,
      expectedRevision: 1,
      source: payload.source,
      payload: { ...payload, operation_id: docOpTwo },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'stale_revision',
  )
  const secondPixels = Buffer.from([1, 1, 1, 0, 2, 2, 2, 255, 3, 3, 3, 128, 4, 4, 4, 0])
  const secondPng = encodeRgbaPng(2, 2, secondPixels)
  const secondDigest = sha256Bytes(secondPng)
  const secondAssetDir = path.join(root, 'workspace', 'projects', seeded.v1.id, 'assets', 'asset_second', 'rev_001')
  await mkdir(secondAssetDir, { recursive: true })
  await writeFile(path.join(secondAssetDir, 'image.png'), secondPng)
  const loaded = await loadEditorProject({ projectId: seeded.v1.id, projectRoot: root })
  const nextProject = loaded.project
  nextProject.assets.asset_second = createAssetRef({
    id: 'asset_second',
    kind: 'static_image',
    name: 'Second',
    revision: createAssetRevision({
      id: 'rev_001',
      createdAt: now,
      qualityStatus: 'pass',
      productionStatus: 'ready',
      artifacts: {
        image: `workspace/projects/${seeded.v1.id}/assets/asset_second/rev_001/image.png`,
      },
    }),
  })
  await writeFile(loaded.paths.projectJson, serializeEditorProject(nextProject))
  const second = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOpTwo,
    expectedRevision: first.project.revision,
    source: {
      asset_id: 'asset_second',
      revision_id: 'rev_001',
      artifact: 'image',
      expected_sha256: secondDigest,
    },
    payload: {
      operation_id: docOpTwo,
      expected_revision: first.project.revision,
      source: {
        asset_id: 'asset_second',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: secondDigest,
      },
      name: null,
    },
    projectRoot: root,
    now,
  })
  const firstBlock = await readSpriteBlock({
    projectId: seeded.v1.id,
    documentId: first.receipt.document_id,
    sha256: first.document.cels.cel_frame_1_layer_1.block.sha256,
    projectRoot: root,
  })
  const secondBlock = await readSpriteBlock({
    projectId: seeded.v1.id,
    documentId: second.receipt.document_id,
    sha256: second.document.cels.cel_frame_1_layer_1.block.sha256,
    projectRoot: root,
  })
  assert.deepEqual(Buffer.from(firstBlock.bytes), firstPixels)
  assert.deepEqual(Buffer.from(secondBlock.bytes), secondPixels)
  assert.notEqual(first.receipt.document_id, second.receipt.document_id)
})

test('block, manifest, and index faults leave the authoritative version unchanged, and ack loss replays', async () => {
  const root = await tempRoot()
  const seeded = await v1WithManagedSource(root)
  const source = {
    asset_id: 'asset_source',
    revision_id: 'rev_001',
    artifact: 'image',
    expected_sha256: seeded.digest,
  }
  const payloadFor = (operationId) => ({
    operation_id: operationId,
    expected_revision: 1,
    source,
    name: null,
  })
  for (const fault of ['block', 'manifest', 'index']) {
    const operationId = fault === 'block'
      ? '44444444-4444-4444-8444-444444444444'
      : fault === 'manifest'
        ? '55555555-5555-4555-8555-555555555555'
        : '66666666-6666-4666-8666-666666666666'
    await assert.rejects(
      createSpriteDocumentFromManagedSource({
        projectId: seeded.v1.id,
        operationId,
        expectedRevision: 1,
        source,
        payload: payloadFor(operationId),
        projectRoot: root,
        now,
        fault,
      }),
      (error) => error.code === 'storage_commit_failed',
    )
    const loaded = await loadEditorProject({ projectId: seeded.v1.id, projectRoot: root })
    assert.equal(loaded.project.revision, 1)
    assert.deepEqual(loaded.project.sprite_documents, {})
  }
  const ackOp = '77777777-7777-4777-8777-777777777777'
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: ackOp,
      expectedRevision: 1,
      source,
      payload: payloadFor(ackOp),
      projectRoot: root,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const afterAck = await loadEditorProject({ projectId: seeded.v1.id, projectRoot: root })
  assert.equal(afterAck.project.revision, 2)
  const replayed = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: ackOp,
    expectedRevision: 1,
    source,
    payload: payloadFor(ackOp),
    projectRoot: root,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.project.revision, 2)
})

test('bad hash, unsafe path, and over-limit sources are rejected', async () => {
  const root = await tempRoot()
  const seeded = await v1WithManagedSource(root)
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: docOp,
      expectedRevision: 1,
      source: {
        asset_id: 'asset_source',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: 'd'.repeat(64),
      },
      payload: {
        operation_id: docOp,
        expected_revision: 1,
        source: {
          asset_id: 'asset_source',
          revision_id: 'rev_001',
          artifact: 'image',
          expected_sha256: 'd'.repeat(64),
        },
        name: null,
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'artifact_integrity_failed',
  )
  const wide = Buffer.alloc(4097 * 2 * 4, 1)
  const widePng = encodeRgbaPng(4097, 2, wide)
  const wideDir = path.join(root, 'workspace', 'projects', seeded.v1.id, 'assets', 'asset_wide', 'rev_001')
  await mkdir(wideDir, { recursive: true })
  await writeFile(path.join(wideDir, 'image.png'), widePng)
  const loaded = await loadEditorProject({ projectId: seeded.v1.id, projectRoot: root })
  loaded.project.assets.asset_wide = createAssetRef({
    id: 'asset_wide',
    kind: 'static_image',
    name: 'Wide',
    revision: createAssetRevision({
      id: 'rev_001',
      createdAt: now,
      qualityStatus: 'pass',
      productionStatus: 'ready',
      artifacts: { image: `workspace/projects/${seeded.v1.id}/assets/asset_wide/rev_001/image.png` },
    }),
  })
  await writeFile(loaded.paths.projectJson, serializeEditorProject(loaded.project))
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: '88888888-8888-4888-8888-888888888888',
      expectedRevision: 1,
      source: {
        asset_id: 'asset_wide',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: sha256Bytes(widePng),
      },
      payload: {
        operation_id: '88888888-8888-4888-8888-888888888888',
        expected_revision: 1,
        source: {
          asset_id: 'asset_wide',
          revision_id: 'rev_001',
          artifact: 'image',
          expected_sha256: sha256Bytes(widePng),
        },
        name: null,
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'resource_limit',
  )
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: seeded.v1.id,
      operationId: '99999999-9999-4999-8999-999999999999',
      expectedRevision: 1,
      source: {
        asset_id: 'missing_asset',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: 'e'.repeat(64),
      },
      payload: {
        operation_id: '99999999-9999-4999-8999-999999999999',
        expected_revision: 1,
        source: {
          asset_id: 'missing_asset',
          revision_id: 'rev_001',
          artifact: 'image',
          expected_sha256: 'e'.repeat(64),
        },
        name: null,
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'not_found',
  )
  const empty = await createEditorProjectV1({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: null },
    projectRoot: root,
    now,
  })
  assert.equal(empty.project.version, 'editor_project_v2')
  const restart = await loadEditorProject({ projectId: empty.project.id, projectRoot: root })
  assert.equal(restart.project.revision, 1)
})

function crc32(bytes) {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    table[index] = crc >>> 0
  }
  let crc = 0xffffffff
  for (const value of bytes) crc = table[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

test('tiny 1x1 PNG with oversized deflate payload is rejected without inflating it', () => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const bomb = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(64 * 1024, 0))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  assert.equal(bomb.length < 2048, true)
  assert.throws(
    () => decodePngToRgba(bomb),
    (error) => error.code === 'unsupported_input' && String(error.message).includes('scanline budget'),
  )
})

test('trusted writes reject symlink or directory identity and never overwrite different immutable bytes', async () => {
  const root = await tempRoot()
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  await mkdir(path.join(root, 'outside'))
  await symlink(path.join(root, 'outside'), path.join(workspace, 'projects'))
  await assert.rejects(
    createEditorProjectV1({
      operationId: createOp,
      payload: { operation_id: createOp, name: null },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'storage_commit_failed',
  )
  await unlink(path.join(workspace, 'projects'))
  const filePath = path.join(workspace, 'projects', 'locked.bin')
  const first = await writeTrustedRegularFile({
    controlledRootPath: workspace,
    filePath,
    bytes: Buffer.from('same-bytes'),
    exclusive: true,
  })
  assert.equal(first.reused, false)
  const reused = await writeTrustedRegularFile({
    controlledRootPath: workspace,
    filePath,
    bytes: Buffer.from('same-bytes'),
    exclusive: true,
  })
  assert.equal(reused.reused, true)
  await assert.rejects(
    writeTrustedRegularFile({
      controlledRootPath: workspace,
      filePath,
      bytes: Buffer.from('other-bytes'),
      exclusive: true,
    }),
    (error) => error.code === 'unsafe_artifact_path',
  )
  assert.equal(await readFile(filePath, 'utf8'), 'same-bytes')
  const replaced = path.join(workspace, 'projects', 'dir-target')
  await mkdir(replaced)
  await assert.rejects(
    writeTrustedRegularFile({
      controlledRootPath: workspace,
      filePath: replaced,
      bytes: Buffer.from('nope'),
      exclusive: true,
    }),
    (error) => error.code === 'unsafe_artifact_path',
  )

  const outside = path.join(root, 'outside.bin')
  await writeFile(outside, 'keep-root-file')
  const racePath = path.join(workspace, 'projects', 'race.bin')
  const [firstRace, secondRace] = await Promise.allSettled([
    writeTrustedRegularFile({
      controlledRootPath: workspace,
      filePath: racePath,
      bytes: Buffer.from('alpha-bytes'),
      exclusive: true,
    }),
    writeTrustedRegularFile({
      controlledRootPath: workspace,
      filePath: racePath,
      bytes: Buffer.from('beta-bytes'),
      exclusive: true,
    }),
  ])
  const winner = [firstRace, secondRace].filter((item) => item.status === 'fulfilled')
  const loser = [firstRace, secondRace].filter((item) => item.status === 'rejected')
  assert.equal(winner.length, 1)
  assert.equal(loser.length, 1)
  const published = await readFile(racePath)
  assert.equal(
    published.equals(Buffer.from('alpha-bytes')) || published.equals(Buffer.from('beta-bytes')),
    true,
  )
  assert.equal(await readFile(outside, 'utf8'), 'keep-root-file')

  const swappedParent = path.join(workspace, 'projects', 'swapped')
  const keptParent = path.join(workspace, 'projects', 'swapped.kept')
  const outsideDir = path.join(root, 'outside-swap')
  await mkdir(swappedParent)
  await mkdir(outsideDir)
  await writeFile(path.join(outsideDir, 'keep.txt'), 'outside-dir')
  await assert.rejects(
    writeTrustedRegularFile({
      controlledRootPath: workspace,
      filePath: path.join(swappedParent, 'immut.bin'),
      bytes: Buffer.from('payload'),
      exclusive: true,
      beforePublish: async () => {
        await rename(swappedParent, keptParent)
        await symlink(outsideDir, swappedParent)
      },
    }),
    (error) => error.code === 'unsafe_artifact_path',
  )
  assert.equal(await readFile(path.join(outsideDir, 'keep.txt'), 'utf8'), 'outside-dir')
  assert.equal(existsSync(path.join(outsideDir, 'immut.bin')), false)
  assert.equal(existsSync(path.join(keptParent, 'immut.bin')), false)
})

test('manifest or block replaced by a directory returns a path-free integrity error', async () => {
  const root = await tempRoot()
  const seeded = await v1WithManagedSource(root)
  const created = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOp,
    expectedRevision: 1,
    source: {
      asset_id: 'asset_source',
      revision_id: 'rev_001',
      artifact: 'image',
      expected_sha256: seeded.digest,
    },
    payload: {
      operation_id: docOp,
      expected_revision: 1,
      source: {
        asset_id: 'asset_source',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: seeded.digest,
      },
      name: null,
    },
    projectRoot: root,
    now,
  })
  const manifestPath = path.join(
    root,
    'workspace',
    'projects',
    seeded.v1.id,
    'sprite-documents',
    created.receipt.document_id,
    'revisions',
    '1.json',
  )
  await unlink(manifestPath)
  await mkdir(manifestPath)
  await assert.rejects(
    getSpriteDocument({
      projectId: seeded.v1.id,
      documentId: created.receipt.document_id,
      projectRoot: root,
    }),
    (error) => error.code === 'artifact_integrity_failed'
      && !String(error.message).includes(root)
      && !String(error.message).includes('/'),
  )
})

test('same-op replay works after independent subprocess reload and concurrent in-process callers', async () => {
  const root = await tempRoot()
  const pixels = Buffer.concat([
    Buffer.from([11, 22, 33, 0, 44, 55, 66, 128]),
    Buffer.from([77, 88, 99, 255, 12, 13, 14, 0]),
  ])
  const seeded = await v1WithManagedSource(root, {
    pixels,
    width: 2,
    height: 2,
    artifact: 'sheet',
    kind: 'spritesheet',
    clips: {
      idle: {
        id: 'idle',
        frames: [0, 1],
        fps: 8,
        frame_size: { w: 2, h: 1 },
        anchor: { x: 0, y: 0 },
      },
    },
    metadata: {
      frames: {
        frame_1: { index: 0, frame: { x: 0, y: 0, w: 2, h: 1 }, duration: 110 },
        frame_2: { index: 1, frame: { x: 0, y: 1, w: 2, h: 1 }, duration: 220 },
      },
    },
  })
  const source = {
    asset_id: 'asset_source',
    revision_id: 'rev_001',
    artifact: 'sheet',
    expected_sha256: seeded.digest,
  }
  const payload = {
    operation_id: docOp,
    expected_revision: 1,
    source,
    name: null,
  }
  const created = await createSpriteDocumentFromManagedSource({
    projectId: seeded.v1.id,
    operationId: docOp,
    expectedRevision: 1,
    source,
    payload,
    projectRoot: root,
    now,
  })
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const childScript = `
    import { getSpriteDocument, readSpriteBlock } from ${JSON.stringify(path.join(repoRoot, 'src/editor-project/index.js'))};
    const loaded = await getSpriteDocument({
      projectId: ${JSON.stringify(seeded.v1.id)},
      documentId: ${JSON.stringify(created.receipt.document_id)},
      projectRoot: ${JSON.stringify(root)},
    });
    const first = await readSpriteBlock({
      projectId: ${JSON.stringify(seeded.v1.id)},
      documentId: ${JSON.stringify(created.receipt.document_id)},
      sha256: loaded.manifest.cels.cel_frame_1_layer_1.block.sha256,
      projectRoot: ${JSON.stringify(root)},
    });
    const second = await readSpriteBlock({
      projectId: ${JSON.stringify(seeded.v1.id)},
      documentId: ${JSON.stringify(created.receipt.document_id)},
      sha256: loaded.manifest.cels.cel_frame_2_layer_1.block.sha256,
      projectRoot: ${JSON.stringify(root)},
    });
    process.stdout.write(JSON.stringify({
      duration1: loaded.manifest.frames.frame_1.duration_ms,
      duration2: loaded.manifest.frames.frame_2.duration_ms,
      first: Buffer.from(first.bytes).toString('hex'),
      second: Buffer.from(second.bytes).toString('hex'),
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
  assert.equal(child.duration1, 110)
  assert.equal(child.duration2, 220)
  assert.equal(child.first, Buffer.from([11, 22, 33, 0, 44, 55, 66, 128]).toString('hex'))
  assert.equal(child.second, Buffer.from([77, 88, 99, 255, 12, 13, 14, 0]).toString('hex'))

  const openRoot = await tempRoot()
  const openSeeded = await v1WithManagedSource(openRoot)
  const openSource = {
    asset_id: 'asset_source',
    revision_id: 'rev_001',
    artifact: 'image',
    expected_sha256: openSeeded.digest,
  }
  const openPayload = {
    operation_id: docOpTwo,
    expected_revision: 1,
    source: openSource,
    name: null,
  }
  const [left, right] = await Promise.all([
    createSpriteDocumentFromManagedSource({
      projectId: openSeeded.v1.id,
      operationId: docOpTwo,
      expectedRevision: 1,
      source: openSource,
      payload: openPayload,
      projectRoot: openRoot,
      now,
    }),
    createSpriteDocumentFromManagedSource({
      projectId: openSeeded.v1.id,
      operationId: docOpTwo,
      expectedRevision: 1,
      source: openSource,
      payload: openPayload,
      projectRoot: openRoot,
      now,
    }),
  ])
  assert.equal(left.receipt.document_id, right.receipt.document_id)
  assert.equal(left.project.revision, 2)
  assert.equal(right.project.revision, 2)
  assert.equal(left.replayed !== right.replayed, true)
  await assert.rejects(
    createSpriteDocumentFromManagedSource({
      projectId: openSeeded.v1.id,
      operationId: '44444444-4444-4444-8444-444444444441',
      expectedRevision: 1,
      source: openSource,
      payload: {
        operation_id: '44444444-4444-4444-8444-444444444441',
        expected_revision: 1,
        source: openSource,
        name: null,
      },
      projectRoot: openRoot,
      now,
    }),
    (error) => error.code === 'stale_revision',
  )
  const replayed = await createSpriteDocumentFromManagedSource({
    projectId: openSeeded.v1.id,
    operationId: docOpTwo,
    expectedRevision: 1,
    source: openSource,
    payload: openPayload,
    projectRoot: openRoot,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.project.revision, 2)
})

function hasPersistAction(records, action, targetPath) {
  const resolved = path.resolve(targetPath)
  return records.some((item) => item.action === action && item.path === resolved)
}

function persistActionIndex(records, action, targetPath) {
  const resolved = path.resolve(targetPath)
  return records.findIndex((item) => item.action === action && item.path === resolved)
}

test('directory parent sync and index durability faults recover without a new protocol', async () => {
  const dirRoot = await tempRoot()
  const dirOp = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
  const dirId = deriveStableId('p', `create-v1:${dirOp}`)
  const dirProjects = path.join(dirRoot, 'workspace', 'projects')
  const dirProjectJson = path.join(dirProjects, dirId, 'project.json')
  const quietRoot = await tempRoot()
  const quietWorkspace = path.join(quietRoot, 'workspace')
  await writeTrustedRegularFile({
    controlledRootPath: quietWorkspace,
    filePath: path.join(quietWorkspace, 'quiet.bin'),
    bytes: Buffer.from('quiet'),
  })
  const records = []
  setTrustedPersistObserver(records)
  assert.equal(records.length, 0)
  try {
    await assert.rejects(
      createEditorProjectV1({
        operationId: dirOp,
        payload: { operation_id: dirOp, name: null },
        projectRoot: dirRoot,
        now,
        fault: 'dirsync',
      }),
      (error) => error.code === 'storage_commit_failed' && error.details?.committed !== true,
    )
    const firstDirsync = records.splice(0, records.length)
    assert.equal(existsSync(dirProjectJson), false)
    assert.equal(hasPersistAction(firstDirsync, 'fsync-parent', dirProjects), false)
    assert.equal(hasPersistAction(firstDirsync, 'publish-file', dirProjectJson), false)
    await assert.rejects(
      createEditorProjectV1({
        operationId: dirOp,
        payload: { operation_id: dirOp, name: null },
        projectRoot: dirRoot,
        now,
        fault: 'dirsync',
      }),
      (error) => error.code === 'storage_commit_failed' && error.details?.committed !== true,
    )
    const retryDirsync = records.splice(0, records.length)
    assert.equal(existsSync(dirProjectJson), false)
    assert.equal(hasPersistAction(retryDirsync, 'fsync-parent', dirProjects), false)
    assert.equal(hasPersistAction(retryDirsync, 'publish-file', dirProjectJson), false)
    const created = await createEditorProjectV1({
      operationId: dirOp,
      payload: { operation_id: dirOp, name: null },
      projectRoot: dirRoot,
      now,
    })
    const recoveredDirsync = records.splice(0, records.length)
    assert.equal(created.replayed, false)
    assert.equal(created.project.id, dirId)
    assert.equal(existsSync(dirProjectJson), true)
    const parentSyncAt = persistActionIndex(recoveredDirsync, 'fsync-parent', dirProjects)
    const publishAt = persistActionIndex(recoveredDirsync, 'publish-file', dirProjectJson)
    assert.ok(parentSyncAt >= 0)
    assert.ok(publishAt > parentSyncAt)
    assert.ok(recoveredDirsync.length > 0)
  } finally {
    setTrustedPersistObserver(null)
  }
  const frozen = records.length
  await writeTrustedRegularFile({
    controlledRootPath: quietWorkspace,
    filePath: path.join(quietWorkspace, 'after.bin'),
    bytes: Buffer.from('after'),
  })
  assert.equal(records.length, frozen)

  const syncRoot = await tempRoot()
  const syncOp = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'
  const syncId = deriveStableId('p', `create-v1:${syncOp}`)
  await assert.rejects(
    createEditorProjectV1({
      operationId: syncOp,
      payload: { operation_id: syncOp, name: null },
      projectRoot: syncRoot,
      now,
      fault: 'index_sync',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  assert.equal(existsSync(path.join(syncRoot, 'workspace', 'projects', syncId, 'project.json')), true)
  const recovered = await createEditorProjectV1({
    operationId: syncOp,
    payload: { operation_id: syncOp, name: null },
    projectRoot: syncRoot,
    now,
  })
  assert.equal(recovered.replayed, true)
  assert.equal(recovered.project.id, syncId)
})
