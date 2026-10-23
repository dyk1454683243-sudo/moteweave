import test from 'node:test'
import assert from 'node:assert/strict'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createEditorProjectV1, createEditorArtifactAccessRegistry, encodeRgbaPng, handleEditorProjectApi } from '../../src/editor-project/index.js'
import { createRuntimeRecords } from '../../src/editor-project/runtimeRecords.js'
import { createSubscriptionSheet } from '../../src/editor-project/subscriptionSheet.js'
import { recoverSubscriptionProcessJob } from '../../src/editor-project/subscriptionSheetRecovery.js'

test('accepted subscription processing recovers without a job map and imports idempotently', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'subscription-recovery-'))
  const workspaceRoot = path.join(projectRoot, 'workspace')
  const generatedDir = path.join(projectRoot, 'generated')
  const operationId = randomUUID()
  const { project } = await createEditorProjectV1({ projectRoot, workspaceRoot, operationId,
    payload: { operation_id: operationId, name: null } })
  const scope = { projectId: project.id, projectRoot, workspaceRoot }
  const id = randomUUID(), jobId = 'job_subscription_recovery'
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const png = encodeRgbaPng(4, 2, Buffer.alloc(32, 128))
  const candidate = { version: 1, id, projectId: project.id, status: 'accepted', accepted: true,
    accepted_sha256: 'a'.repeat(64), original: { sha256: 'a'.repeat(64) }, derived: { sha256: digest(png) },
    process_attempted: true, process_job_id: jobId, native_thread_id: 'thread_fixture', image_call_id: 'image_fixture' }
  candidate.derivation = { report: { background_removal: { mode: 'deterministic_pixel_matte_v2', quality_status: 'pass' } } }
  candidate.process_binding = { candidate_id: id, project_id: project.id, process_job_id: jobId,
    original_sha256: candidate.original.sha256, native_thread_id: candidate.native_thread_id, image_call_id: candidate.image_call_id }
  const metadata = { profile: 'topdown_rpg_v0', source: { type: 'subscription_sheet', candidate_id: id,
    project_id: project.id, original_sha256: candidate.original.sha256, derived_sha256: candidate.derived.sha256 },
  generation: { provider: 'subscription', channel: 'subscription_native', candidate_id: id,
    original_sha256: candidate.original.sha256, native_thread_id: candidate.native_thread_id, image_call_id: candidate.image_call_id } }
  const debug = { validation: { status: 'pass' }, subject_count: { required: true, status: 'pass' } }
  const jobDir = path.join(generatedDir, jobId)
  await mkdir(jobDir, { recursive: true })
  const json = (file, value) => writeFile(path.join(jobDir, file), JSON.stringify(value))
  await writeFile(path.join(jobDir, 'source.png'), png)
  await writeFile(path.join(jobDir, 'normalized_sheet.png'), png)
  await json('metadata.json', metadata)
  await json('debug_report.json', debug)
  await json('animations.json', { profile: 'topdown_rpg_v0', frame_size: { w: 2, h: 2 }, anchor: { x: 1, y: 1 }, animations: { idle: { frames: [0, 1], fps: 8, mode: 'loop' } } })
  await json('editor_metadata.json', { frames: {
    frame_1: { index: 0, frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 110 },
    frame_2: { index: 1, frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 220 },
  } })
  const recover = (changes = {}) => recoverSubscriptionProcessJob({ projectId: project.id, jobId, generatedDir,
    readCandidate: async candidateId => candidateId === id ? candidate : null, ...changes })
  assert.equal((await recover()).recovered_from_artifacts, true)
  assert.equal(await recover({ projectId: 'another_project' }), null)
  assert.equal(await recover({ candidateId: randomUUID() }), null)
  for (const changes of [{ accepted: false }, { status: 'ready' }, { accepted_sha256: 'b'.repeat(64) },
    { process_job_id: 'job_other' }, { process_binding: {} }, { derived: { sha256: 'b'.repeat(64) } },
    { derivation: { report: { background_removal: { mode: 'passthrough_review', quality_status: 'passthrough_review' } } } }]) {
    assert.equal(await recover({ readCandidate: async () => ({ ...candidate, ...changes }) }), null)
  }
  await json('debug_report.json', { ...debug, subject_count: { required: false, status: 'pass' } })
  assert.equal(await recover(), null)
  await json('debug_report.json', { ...debug, validation: { status: 'fail' } })
  assert.equal(await recover(), null)
  await json('debug_report.json', debug)
  await writeFile(path.join(jobDir, 'normalized_sheet.png'), Buffer.from('not a PNG'))
  assert.equal(await recover(), null)
  await writeFile(path.join(jobDir, 'normalized_sheet.png'), png)
  await json('metadata.json', { ...metadata, source: { type: 'manual_import' } })
  assert.equal(await recover(), null)
  await json('metadata.json', metadata)
  assert.equal(await recover({ jobId: 'job_absent' }), null)
  const legacyJob = { id: jobId, status: 'done', type: 'process_sheet' }
  assert.equal(await recover({ currentJob: legacyJob, readCandidate: async () => ({ ...candidate, derivation: null }) }), null)
  const records = createRuntimeRecords()
  await records.put(scope, 'sheets', id, candidate)
  const service = createSubscriptionSheet({ records, generate: async () => { throw new Error('must not generate') } })
  let currentJob = { id: jobId, status: 'failed_post_processing' }
  assert.equal((await service.processingJob(scope, id, { generatedDir, getGeneratedJob: () => currentJob })).status, 'failed_post_processing')
  currentJob = null
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, generatedDir, subscriptionSheet: service, getGeneratedJob: () => currentJob,
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
  }).catch(error => { res.writeHead(500); res.end(String(error)) }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}/api/editor/projects/${project.id}`
  const recoveredResponse = await fetch(`${base}/subscription-sheet-candidates/${id}/processing`, { signal: AbortSignal.timeout(5000) })
  assert.equal(recoveredResponse.status, 200)
  assert.equal((await recoveredResponse.json()).recovered_from_artifacts, true)
  const payload = { operation_id: randomUUID(), expected_revision: 1,
    source: { job_id: jobId, artifact: 'sheet', expected_sha256: digest(png) }, name: 'Recovery fixture' }
  const post = () => fetch(`${base}/sprite-documents/from-job`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) })
  const first = await post()
  assert.equal(first.status, 201)
  const imported = await first.json()
  assert.equal(imported.document.frame_order.length, 2)
  await json('metadata.json', {}) // Existing operation replays before any job/artifact lookup.
  const replay = await post()
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).receipt.document_id, imported.receipt.document_id)
})
