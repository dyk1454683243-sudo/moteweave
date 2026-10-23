import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createEditorProjectV1,
  encodeRgbaPng,
  getSpriteDocument,
  loadEditorProject,
  parseFromJobRequest,
  readSpriteBlock,
  sha256Bytes,
} from '../../src/editor-project/index.js'
import { assertCharacterPackProcessJob, createSpriteDocumentFromJob } from '../../src/editor-project/spriteDocumentFromJob.js'
import { SPRITE_DOCUMENT_LIMITS } from '../../src/editor-project/constants.js'

const now = '2026-09-20T00:00:00.000Z'
const createOp = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fromJobOp = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherOp = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

test('real process jobs retain their kind even with generation provenance', async () => {
  const source = await readFile('server.js', 'utf8')
  assert.match(source, /async function handleProcessSheet\(req, res\) \{\s*const job = createJob\(\{ status: JOB_STATUS.QUEUED, type: 'process_sheet' \}\)/)
  const processed = { id: 'job_processed', status: 'done', type: 'process_sheet', generation_url: '/generated/job_processed/generation.json' }
  assert.equal(assertCharacterPackProcessJob(processed), processed)
  assert.throws(() => assertCharacterPackProcessJob({ ...processed, type: 'generate' }), /not a completed/)
  assert.throws(() => assertCharacterPackProcessJob({ ...processed, type: undefined }), /not a completed/)
  assert.throws(() => assertCharacterPackProcessJob({ ...processed, requires_user_confirmation: true }), /cannot be promoted/)
})

function sheetPixels() {
  return Buffer.from([
    10, 20, 30, 0, 40, 50, 60, 128, 4, 5, 6, 0, 7, 8, 9, 255,
    70, 80, 90, 255, 1, 2, 3, 0, 11, 12, 13, 128, 14, 15, 16, 0,
  ])
}

function processArtifacts() {
  const png = encodeRgbaPng(4, 2, sheetPixels())
  return {
    png,
    digest: sha256Bytes(png),
    animations: {
      profile: 'topdown_rpg_v0',
      frame_size: { w: 2, h: 2 },
      anchor: { x: 1, y: 1 },
      animations: {
        idle: { frames: [0, 1], fps: 8, mode: 'loop' },
      },
    },
    metadata: { name: 'From Job Sheet', profile: 'topdown_rpg_v0' },
    editorMetadata: {
      frames: {
        frame_1: { index: 0, frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 110 },
        frame_2: { index: 1, frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 220 },
      },
    },
    debugReport: { status: 'pass' },
  }
}

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'p2-07-from-job-'))
}

async function writeJobFiles(generatedDir, jobId, artifacts, extras = {}) {
  const jobDir = path.join(generatedDir, jobId)
  await mkdir(jobDir, { recursive: true })
  await writeFile(path.join(jobDir, 'normalized_sheet.png'), artifacts.png)
  await writeFile(path.join(jobDir, 'animations.json'), `${JSON.stringify(artifacts.animations)}\n`)
  await writeFile(path.join(jobDir, 'metadata.json'), `${JSON.stringify(artifacts.metadata)}\n`)
  await writeFile(path.join(jobDir, 'editor_metadata.json'), `${JSON.stringify(artifacts.editorMetadata)}\n`)
  await writeFile(path.join(jobDir, 'debug_report.json'), `${JSON.stringify(artifacts.debugReport)}\n`)
  for (const [fileName, bytes] of Object.entries(extras)) {
    await writeFile(path.join(jobDir, fileName), bytes)
  }
  return jobDir
}

function payloadFor(expectedRevision, jobId, digest, name = null) {
  return {
    operation_id: fromJobOp,
    expected_revision: expectedRevision,
    source: { job_id: jobId, artifact: 'sheet', expected_sha256: digest },
    name,
  }
}

test('from-job request rejects unknown fields and non-sheet artifacts', () => {
  const digest = 'a'.repeat(64)
  const parsed = parseFromJobRequest({
    operation_id: fromJobOp,
    expected_revision: 1,
    source: { job_id: 'job_ok', artifact: 'sheet', expected_sha256: digest },
    name: null,
  })
  assert.equal(parsed.source.artifact, 'sheet')
  assert.throws(
    () => parseFromJobRequest({
      operation_id: fromJobOp,
      expected_revision: 1,
      source: { job_id: 'job_ok', artifact: 'sheet', expected_sha256: digest },
      extra: true,
    }),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseFromJobRequest({
      operation_id: fromJobOp,
      expected_revision: 1,
      source: { job_id: 'job_ok', artifact: 'image', expected_sha256: digest },
      name: null,
    }),
    (error) => error.code === 'invalid_request',
  )
})

test('from-job commits multi-frame transparent RGBA and replays without the job', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const artifacts = processArtifacts()
  const jobId = 'job_process_ok'
  const jobDir = await writeJobFiles(generatedDir, jobId, artifacts)
  const jobs = new Map([[jobId, { id: jobId, status: 'done', type: 'process-sheet' }]])
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })
  const payload = payloadFor(1, jobId, artifacts.digest)
  const result = await createSpriteDocumentFromJob({
    projectId: created.project.id,
    operationId: fromJobOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    getGeneratedJob: (id) => jobs.get(id) ?? null,
    generatedDir,
    projectRoot: root,
    now,
  })
  assert.equal(result.replayed, false)
  assert.equal(result.project.revision, 2)
  assert.equal(result.document.frame_order.length, 2)
  assert.equal(result.document.frames.frame_1.duration_ms, 110)
  assert.equal(result.document.frames.frame_2.duration_ms, 220)
  assert.equal(result.document.source_ref.artifact, 'sheet')
  assert.equal(result.document.source_ref.expected_sha256, artifacts.digest)
  const assetId = result.document.source_ref.asset_id
  assert.equal(result.project.assets[assetId].kind, 'character_pack')
  assert.equal(result.project.assets[assetId].revisions.rev_001.source_job_id, jobId)
  assert.equal(result.project.assets[assetId].provenance.source_type, 'manual_import')
  const documentId = result.receipt.document_id
  const canvas = Object.values(result.project.canvases)[0]
  assert.equal(canvas.x, 0)
  assert.equal(canvas.y, 0)
  assert.equal(result.project.sprite_documents[documentId].working_revision, 1)
  assert.equal(result.project.sprite_documents[documentId].accepted_revision, null)
  const firstBlock = await readSpriteBlock({
    projectId: created.project.id,
    documentId,
    sha256: result.document.cels.cel_frame_1_layer_1.block.sha256,
    projectRoot: root,
  })
  assert.deepEqual(Buffer.from(firstBlock.bytes), Buffer.from([
    10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255, 1, 2, 3, 0,
  ]))
  const originalSheet = await readFile(path.join(jobDir, 'normalized_sheet.png'))
  assert.deepEqual(originalSheet, artifacts.png)

  const replayed = await createSpriteDocumentFromJob({
    projectId: created.project.id,
    operationId: fromJobOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    getGeneratedJob: () => {
      throw new Error('job must not be read on replay')
    },
    generatedDir,
    projectRoot: root,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.receipt.operation_id, fromJobOp)
  assert.equal(replayed.project.revision, 2)
  const reloaded = await getSpriteDocument({
    projectId: created.project.id,
    documentId,
    projectRoot: root,
  })
  assert.equal(reloaded.manifest.frames.frame_2.duration_ms, 220)
})

test('from-job rejects generation, specialized, failed QA, and stale revisions', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const artifacts = processArtifacts()
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })

  async function rejectJob(jobId, job, extras, expectedCode) {
    await writeJobFiles(generatedDir, jobId, artifacts, extras)
    const payload = payloadFor(1, jobId, artifacts.digest)
    await assert.rejects(
      createSpriteDocumentFromJob({
        projectId: created.project.id,
        operationId: fromJobOp,
        expectedRevision: 1,
        source: payload.source,
        payload,
        getGeneratedJob: (id) => (id === jobId ? job : null),
        generatedDir,
        projectRoot: root,
        now,
      }),
      (error) => error.code === expectedCode,
    )
    const loaded = await loadEditorProject({ projectId: created.project.id, projectRoot: root })
    assert.equal(loaded.project.revision, 1)
    assert.equal(Object.keys(loaded.project.sprite_documents).length, 0)
  }

  await rejectJob('job_generate', { id: 'job_generate', status: 'done', type: 'generate-character' }, {}, 'unsupported_input')
  await rejectJob('job_missing_type', { id: 'job_missing_type', status: 'done' }, {}, 'unsupported_input')
  await rejectJob(
    'job_repair',
    { id: 'job_repair', status: 'done', type: 'fixed_region_source_provider_repair' },
    {},
    'unsupported_input',
  )
  await rejectJob(
    'job_special',
    { id: 'job_special', status: 'done', type: 'process-sheet' },
    { 'fixed_region_action_repair_review.json': '{"job_type":"fixed_region_source_provider_repair"}\n' },
    'specialized_accept_required',
  )
  const failArtifacts = { ...artifacts, debugReport: { status: 'fail' } }
  await writeJobFiles(generatedDir, 'job_fail_qa', failArtifacts)
  const failPayload = payloadFor(1, 'job_fail_qa', artifacts.digest)
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: created.project.id,
      operationId: fromJobOp,
      expectedRevision: 1,
      source: failPayload.source,
      payload: failPayload,
      getGeneratedJob: () => ({ id: 'job_fail_qa', status: 'done', type: 'process-sheet' }),
      generatedDir,
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'quality_blocked',
  )

  const okId = 'job_stale'
  await writeJobFiles(generatedDir, okId, artifacts)
  const stalePayload = payloadFor(9, okId, artifacts.digest)
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: created.project.id,
      operationId: fromJobOp,
      expectedRevision: 9,
      source: stalePayload.source,
      payload: stalePayload,
      getGeneratedJob: () => ({ id: okId, status: 'done', type: 'process-sheet' }),
      generatedDir,
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'stale_revision',
  )
})

test('from-job rejects oversized artifacts before allocating their contents', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const artifacts = processArtifacts()
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })

  const metadataJob = 'job_oversized_metadata'
  const metadataDir = await writeJobFiles(generatedDir, metadataJob, artifacts)
  await truncate(path.join(metadataDir, 'metadata.json'), SPRITE_DOCUMENT_LIMITS.maxManifestBytes + 1)
  const metadataPayload = payloadFor(1, metadataJob, artifacts.digest)
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: created.project.id,
      operationId: fromJobOp,
      expectedRevision: 1,
      source: metadataPayload.source,
      payload: metadataPayload,
      getGeneratedJob: () => ({ id: metadataJob, status: 'done', type: 'process-sheet' }),
      generatedDir,
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'resource_limit',
  )

  const sheetJob = 'job_oversized_sheet'
  const sheetDir = await writeJobFiles(generatedDir, sheetJob, artifacts)
  await truncate(path.join(sheetDir, 'normalized_sheet.png'), SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes + 1)
  const sheetPayload = payloadFor(1, sheetJob, artifacts.digest)
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: created.project.id,
      operationId: fromJobOp,
      expectedRevision: 1,
      source: sheetPayload.source,
      payload: sheetPayload,
      getGeneratedJob: () => ({ id: sheetJob, status: 'done', type: 'process-sheet' }),
      generatedDir,
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'resource_limit',
  )

  const loaded = await loadEditorProject({ projectId: created.project.id, projectRoot: root })
  assert.equal(loaded.project.revision, 1)
  assert.equal(Object.keys(loaded.project.sprite_documents).length, 0)
})

test('from-job same-op payload conflict and post-commit unknown keep the original op', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const artifacts = processArtifacts()
  const jobId = 'job_conflict'
  await writeJobFiles(generatedDir, jobId, artifacts)
  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })
  const payload = payloadFor(1, jobId, artifacts.digest)
  await createSpriteDocumentFromJob({
    projectId: created.project.id,
    operationId: fromJobOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    getGeneratedJob: () => ({ id: jobId, status: 'done', type: 'process-sheet' }),
    generatedDir,
    projectRoot: root,
    now,
  })
  const otherPayload = payloadFor(1, jobId, artifacts.digest, 'Other Name')
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: created.project.id,
      operationId: fromJobOp,
      expectedRevision: 2,
      source: otherPayload.source,
      name: 'Other Name',
      payload: otherPayload,
      getGeneratedJob: () => ({ id: jobId, status: 'done', type: 'process-sheet' }),
      generatedDir,
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'operation_conflict',
  )

  const ackRoot = await tempRoot()
  const ackGenerated = path.join(ackRoot, 'generated')
  await writeJobFiles(ackGenerated, jobId, artifacts)
  const ackProject = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: ackRoot,
    now,
  })
  await assert.rejects(
    createSpriteDocumentFromJob({
      projectId: ackProject.project.id,
      operationId: fromJobOp,
      expectedRevision: 1,
      source: payload.source,
      payload,
      getGeneratedJob: () => ({ id: jobId, status: 'done', type: 'process-sheet' }),
      generatedDir: ackGenerated,
      projectRoot: ackRoot,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const recovered = await createSpriteDocumentFromJob({
    projectId: ackProject.project.id,
    operationId: fromJobOp,
    expectedRevision: 1,
    source: payload.source,
    payload,
    getGeneratedJob: () => null,
    generatedDir: ackGenerated,
    projectRoot: ackRoot,
    now,
  })
  assert.equal(recovered.replayed, true)
  assert.equal(recovered.project.revision, 2)
})
