import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import {
  FRAME_REPAIR_PROVIDER_FAILURE_FILES,
  writeFrameRepairProviderFailureArtifacts,
} from '../../src/editor-project/frameRepairProviderFailureArtifacts.js'
import { buildFrameRepairProviderDiagnostic } from '../../src/editor-project/frameRepairProviderDiagnostics.js'

const CREATED_AT = '2026-07-14T00:00:00.000Z'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-provider-failure-'))
  const generatedDir = path.join(root, 'generated')
  const jobId = 'job_provider_failure_001'
  const jobDir = path.join(generatedDir, jobId)
  await mkdir(jobDir, { recursive: true })
  return { generatedDir, jobId, jobDir }
}

async function visibleProviderPng() {
  const image = {
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(8 * 8 * 4),
  }
  for (let y = 2; y < 7; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      image.data.set([24, 148, 112, 255], (y * image.width + x) * 4)
    }
  }
  return encodeRgbaPng(image)
}

test('provider failure artifacts persist only fixed safe JSON and a re-encoded PNG preview', async () => {
  const { generatedDir, jobId, jobDir } = await fixture()
  const providerBuffer = await visibleProviderPng()
  const written = await writeFrameRepairProviderFailureArtifacts({
    generatedDir,
    job: { id: jobId, created_at: CREATED_AT },
    normalizationCode: 'provider_output_multiple_subjects',
    providerBuffer,
  })

  assert.equal(written.job_id, jobId)
  assert.equal(written.normalization_code, 'provider_output_multiple_subjects')
  assert.equal(written.retry_hint, 'inspect_provider_output_multiple_subjects')
  assert.equal(written.preview?.file_name, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview)

  const diagnosticBytes = await readFile(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic))
  const diagnostic = JSON.parse(diagnosticBytes.toString('utf8'))
  assert.deepEqual(Object.keys(diagnostic), [
    'version', 'job_id', 'created_at', 'failure_stage', 'reason', 'provider_outcome',
    'error_name', 'connection_code', 'http_status', 'normalization_code',
    'raw_provider_payload_persisted', 'preview',
  ])
  assert.equal(diagnostic.version, 'frame_repair_provider_failure_v2')
  assert.equal(diagnostic.failure_stage, 'normalization')
  assert.equal(diagnostic.provider_outcome, 'known')
  assert.equal(diagnostic.error_name, null)
  assert.equal(diagnostic.connection_code, null)
  assert.equal(diagnostic.http_status, null)
  assert.equal(diagnostic.raw_provider_payload_persisted, false)
  assert.equal(diagnostic.preview.sha256, sha256(await readFile(path.join(jobDir, diagnostic.preview.file_name))))
  assert.equal(diagnostic.preview.size > 0, true)
  assert.equal(diagnostic.preview.width, 8)
  assert.equal(diagnostic.preview.height, 8)
  assert.equal(diagnostic.preview.mime_type, 'image/png')

  const previewBytes = await readFile(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview))
  const metadata = await sharp(previewBytes).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 8)
  assert.equal(metadata.height, 8)
  const previewStats = await lstat(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview))
  const diagnosticStats = await lstat(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic))
  assert.equal(previewStats.isFile(), true)
  assert.equal(previewStats.mode & 0o777, 0o600)
  assert.equal(diagnosticStats.mode & 0o777, 0o600)
  assert.doesNotMatch(diagnosticBytes.toString('utf8'), /api[_-]?key|authorization|bearer|data:image|providerBuffer/i)
})

test('provider request failures persist only the controlled connection code or HTTP status', async () => {
  const transportFixture = await fixture()
  const transportError = Object.assign(new TypeError('Bearer private.token'), {
    cause: { code: 'ECONNRESET', message: 'Bearer private.token' },
    request_path: '/Users/private/request.json',
  })
  const transport = buildFrameRepairProviderDiagnostic(transportError)
  const transportWritten = await writeFrameRepairProviderFailureArtifacts({
    generatedDir: transportFixture.generatedDir,
    job: { id: transportFixture.jobId, created_at: CREATED_AT },
    providerDiagnostic: transport,
  })
  assert.equal(transportWritten.reason, 'transport_outcome_unknown')
  assert.equal(transportWritten.provider_outcome, 'unknown')
  assert.equal(transportWritten.connection_code, 'ECONNRESET')
  assert.equal(transportWritten.http_status, null)
  assert.equal(transportWritten.preview, null)
  const transportDiagnostic = JSON.parse(await readFile(path.join(
    transportFixture.jobDir,
    FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic,
  ), 'utf8'))
  assert.deepEqual(transportDiagnostic, {
    version: 'frame_repair_provider_failure_v2',
    job_id: transportFixture.jobId,
    created_at: CREATED_AT,
    failure_stage: 'provider',
    reason: 'transport_outcome_unknown',
    provider_outcome: 'unknown',
    error_name: 'TypeError',
    connection_code: 'ECONNRESET',
    http_status: null,
    normalization_code: null,
    raw_provider_payload_persisted: false,
    preview: null,
  })
  assert.doesNotMatch(JSON.stringify(transportDiagnostic), /Bearer|private\.token|\/Users\/private/)

  const httpFixture = await fixture()
  const http = buildFrameRepairProviderDiagnostic({
    name: 'Error',
    http_status: 503,
    response_body: 'private provider response',
  })
  await writeFrameRepairProviderFailureArtifacts({
    generatedDir: httpFixture.generatedDir,
    job: { id: httpFixture.jobId, created_at: CREATED_AT },
    providerDiagnostic: http,
  })
  const httpDiagnostic = JSON.parse(await readFile(path.join(
    httpFixture.jobDir,
    FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic,
  ), 'utf8'))
  assert.equal(httpDiagnostic.reason, 'provider_service_unavailable')
  assert.equal(httpDiagnostic.provider_outcome, 'known')
  assert.equal(httpDiagnostic.connection_code, null)
  assert.equal(httpDiagnostic.http_status, 503)
  assert.doesNotMatch(JSON.stringify(httpDiagnostic), /private provider response/)
})

test('undecodable provider output records the safe subtype without persisting raw bytes', async () => {
  const { generatedDir, jobId, jobDir } = await fixture()
  const raw = Buffer.from('Bearer private.token data:image/png;base64,AAAA')
  const written = await writeFrameRepairProviderFailureArtifacts({
    generatedDir,
    job: { id: jobId, created_at: CREATED_AT },
    normalizationCode: 'provider_output_invalid',
    providerBuffer: raw,
  })

  assert.equal(written.retry_hint, 'inspect_provider_output_invalid')
  assert.equal(written.preview, null)
  const diagnostic = JSON.parse(await readFile(
    path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic),
    'utf8',
  ))
  assert.equal(diagnostic.preview, null)
  assert.equal(diagnostic.raw_provider_payload_persisted, false)
  assert.doesNotMatch(JSON.stringify(diagnostic), /Bearer|private\.token|data:image|base64/)
  await assert.rejects(
    lstat(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview)),
    { code: 'ENOENT' },
  )
})

test('provider failure artifacts reject unknown output codes and unsafe job scope', async () => {
  const { generatedDir, jobId } = await fixture()
  const providerBuffer = await visibleProviderPng()
  await assert.rejects(
    writeFrameRepairProviderFailureArtifacts({
      generatedDir,
      job: { id: jobId, created_at: CREATED_AT },
      normalizationCode: 'provider_output_private_marker',
      providerBuffer,
    }),
    /provider failure artifact integrity/i,
  )
  await assert.rejects(
    writeFrameRepairProviderFailureArtifacts({
      generatedDir,
      job: { id: jobId, created_at: CREATED_AT },
      providerDiagnostic: {
        reason: 'private_provider_marker',
        provider_outcome: 'unknown',
        error_name: 'Error',
        connection_code: null,
        http_status: null,
      },
    }),
    /provider failure artifact integrity/i,
  )
  await assert.rejects(
    writeFrameRepairProviderFailureArtifacts({
      generatedDir,
      job: { id: '../unsafe', created_at: CREATED_AT },
      normalizationCode: 'provider_output_empty',
      providerBuffer,
    }),
    /provider failure artifact integrity/i,
  )
})

test('provider failure artifacts reject a symlinked job directory and never overwrite fixed evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-provider-failure-symlink-'))
  const generatedDir = path.join(root, 'generated')
  const outsideDir = path.join(root, 'outside')
  const jobId = 'job_provider_failure_symlink'
  await mkdir(generatedDir)
  await mkdir(outsideDir)
  await symlink(outsideDir, path.join(generatedDir, jobId), 'dir')
  await assert.rejects(
    writeFrameRepairProviderFailureArtifacts({
      generatedDir,
      job: { id: jobId, created_at: CREATED_AT },
      normalizationCode: 'provider_output_empty',
      providerBuffer: await visibleProviderPng(),
    }),
    /provider failure artifact integrity/i,
  )

  const fixtureValue = await fixture()
  const sentinel = Buffer.from('existing operator evidence')
  const previewPath = path.join(
    fixtureValue.jobDir,
    FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview,
  )
  await writeFile(previewPath, sentinel, { mode: 0o600 })
  await assert.rejects(
    writeFrameRepairProviderFailureArtifacts({
      generatedDir: fixtureValue.generatedDir,
      job: { id: fixtureValue.jobId, created_at: CREATED_AT },
      normalizationCode: 'provider_output_multiple_subjects',
      providerBuffer: await visibleProviderPng(),
    }),
    /provider failure artifact integrity/i,
  )
  assert.deepEqual(await readFile(previewPath), sentinel)
  await assert.rejects(
    lstat(path.join(fixtureValue.jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic)),
    { code: 'ENOENT' },
  )
})
