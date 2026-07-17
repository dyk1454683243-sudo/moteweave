import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import { JOB_ID_PATTERN } from './constants.js'
import {
  frameRepairProviderOutputRetryHint,
  FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS,
  isFrameRepairProviderDiagnostic,
} from './frameRepairProviderDiagnostics.js'
import { resolveGeneratedJobDir } from './paths.js'
import { isIsoTimestamp } from './safety.js'

export const FRAME_REPAIR_PROVIDER_FAILURE_FILES = Object.freeze({
  diagnostic: 'provider_failure.json',
  preview: 'provider_failure_preview.png',
})

const FAILURE_VERSION = 'frame_repair_provider_failure_v2'
const MAX_PROVIDER_BYTES = 32 * 1024 * 1024
const MAX_INPUT_PIXELS = 4096 * 4096
const MAX_PREVIEW_EDGE = 1024
const MAX_PREVIEW_BYTES = 16 * 1024 * 1024
const NO_FOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function artifactError() {
  const error = new Error('frame repair provider failure artifact integrity failed')
  error.code = 'provider_failure_artifact_integrity_failed'
  return error
}

function fail() {
  throw artifactError()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hasParentEscape(relative) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function sameFileIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

async function assertJobDirectory(generatedDir, jobId) {
  if (typeof generatedDir !== 'string' || generatedDir.length === 0 ||
      typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) fail()
  let jobDir
  let rootLexical
  let jobLexical
  let rootReal
  let jobReal
  try {
    jobDir = resolveGeneratedJobDir(jobId, { generatedDir })
    ;[rootLexical, jobLexical, rootReal, jobReal] = await Promise.all([
      lstat(generatedDir),
      lstat(jobDir),
      realpath(generatedDir),
      realpath(jobDir),
    ])
  } catch {
    fail()
  }
  if (rootLexical.isSymbolicLink() || !rootLexical.isDirectory() ||
      jobLexical.isSymbolicLink() || !jobLexical.isDirectory()) fail()
  const relative = path.relative(rootReal, jobReal)
  if (relative !== jobId || hasParentEscape(relative)) fail()
  let jobStats
  try {
    jobStats = await stat(jobReal)
  } catch {
    fail()
  }
  if (!jobStats.isDirectory() || jobLexical.dev !== jobStats.dev || jobLexical.ino !== jobStats.ino) fail()
  return Object.freeze({ path: jobReal, dev: jobStats.dev, ino: jobStats.ino })
}

async function assertSameJobDirectory(identity) {
  let lexical
  let current
  try {
    ;[lexical, current] = await Promise.all([lstat(identity.path), stat(identity.path)])
  } catch {
    fail()
  }
  if (lexical.isSymbolicLink() || !lexical.isDirectory() || !current.isDirectory() ||
      !sameFileIdentity(lexical, identity) || !sameFileIdentity(current, identity)) fail()
}

async function writeExclusive(identity, fileName, content) {
  if (!Object.values(FRAME_REPAIR_PROVIDER_FAILURE_FILES).includes(fileName) ||
      !Buffer.isBuffer(content) || content.length === 0) fail()
  await assertSameJobDirectory(identity)
  const filePath = path.join(identity.path, fileName)
  if (path.dirname(filePath) !== identity.path) fail()
  let handle
  try {
    handle = await open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW_FLAG,
      0o600,
    )
    await assertSameJobDirectory(identity)
    const before = await handle.stat()
    if (!before.isFile() || before.size !== 0) fail()
    await handle.writeFile(Buffer.from(content))
    const after = await handle.stat()
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
        after.size !== content.length) fail()
    await assertSameJobDirectory(identity)
    await handle.close()
    handle = null
  } catch (error) {
    if (error?.code === 'provider_failure_artifact_integrity_failed') throw error
    fail()
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The caller receives only the fixed integrity error.
      }
    }
  }
}

async function reencodePreview(providerBuffer) {
  if (!Buffer.isBuffer(providerBuffer) || providerBuffer.length === 0 ||
      providerBuffer.length > MAX_PROVIDER_BYTES) return null
  try {
    const { data, info } = await sharp(providerBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: MAX_PREVIEW_EDGE,
        height: MAX_PREVIEW_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.nearest,
      })
      .ensureAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: false, force: true })
      .toBuffer({ resolveWithObject: true })
    if (!Buffer.isBuffer(data) || data.length <= PNG_SIGNATURE.length ||
        data.length > MAX_PREVIEW_BYTES || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        info.format !== 'png' || !Number.isSafeInteger(info.width) || info.width <= 0 ||
        !Number.isSafeInteger(info.height) || info.height <= 0 ||
        info.width > MAX_PREVIEW_EDGE || info.height > MAX_PREVIEW_EDGE) return null
    return Object.freeze({
      content: Buffer.from(data),
      metadata: Object.freeze({
        file_name: FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview,
        mime_type: 'image/png',
        width: info.width,
        height: info.height,
        size: data.length,
        sha256: sha256(data),
      }),
    })
  } catch {
    return null
  }
}

export async function writeFrameRepairProviderFailureArtifacts({
  generatedDir,
  job,
  normalizationCode,
  providerBuffer,
  providerDiagnostic,
} = {}) {
  try {
    const normalizationRequested = normalizationCode !== undefined || providerBuffer !== undefined
    const providerRequested = providerDiagnostic !== undefined
    if (!job || typeof job !== 'object' || Array.isArray(job) ||
        typeof job.id !== 'string' || !JOB_ID_PATTERN.test(job.id) ||
        !isIsoTimestamp(job.created_at) || normalizationRequested === providerRequested) fail()
    if (normalizationRequested &&
        !Object.hasOwn(FRAME_REPAIR_PROVIDER_OUTPUT_RETRY_HINTS, normalizationCode)) fail()
    if (providerRequested && !isFrameRepairProviderDiagnostic(providerDiagnostic)) fail()
    const retryHint = normalizationRequested
      ? frameRepairProviderOutputRetryHint(normalizationCode)
      : null
    if (normalizationRequested && !retryHint) fail()
    const identity = await assertJobDirectory(generatedDir, job.id)
    const preview = normalizationRequested ? await reencodePreview(providerBuffer) : null
    if (preview) await writeExclusive(identity, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview, preview.content)
    const diagnostic = {
      version: FAILURE_VERSION,
      job_id: job.id,
      created_at: job.created_at,
      failure_stage: normalizationRequested ? 'normalization' : 'provider',
      reason: normalizationRequested ? 'provider_candidate_invalid' : providerDiagnostic.reason,
      provider_outcome: normalizationRequested ? 'known' : providerDiagnostic.provider_outcome,
      error_name: normalizationRequested ? null : providerDiagnostic.error_name,
      connection_code: normalizationRequested ? null : providerDiagnostic.connection_code,
      http_status: normalizationRequested ? null : providerDiagnostic.http_status,
      normalization_code: normalizationRequested ? normalizationCode : null,
      raw_provider_payload_persisted: false,
      preview: preview?.metadata ?? null,
    }
    const diagnosticBytes = Buffer.from(`${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8')
    await writeExclusive(identity, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic, diagnosticBytes)
    return Object.freeze({
      job_id: job.id,
      reason: diagnostic.reason,
      provider_outcome: diagnostic.provider_outcome,
      connection_code: diagnostic.connection_code,
      http_status: diagnostic.http_status,
      normalization_code: diagnostic.normalization_code,
      retry_hint: retryHint,
      diagnostic: Object.freeze({
        file_name: FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic,
        size: diagnosticBytes.length,
        sha256: sha256(diagnosticBytes),
      }),
      preview: preview?.metadata ?? null,
    })
  } catch (error) {
    if (error?.code === 'provider_failure_artifact_integrity_failed') throw error
    throw artifactError()
  }
}
