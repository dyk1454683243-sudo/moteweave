import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'

import {
  CHARACTER_PACK_FROM_JOB_FILES,
  assertGeneratedJobNotSpecialized,
  characterPackFromJobAllowedFiles,
  clipsFromCharacterAnimations,
  provenanceSourceTypeFromMetadata,
  qualityStatusFromReport,
} from './artifactRegistry.js'
import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { resolveGeneratedJobArtifactFile } from './paths.js'
import { isPlainObject } from './safety.js'
import { createSpriteDocumentFromProcessedJob } from './spriteDocumentStore.js'
import { SpriteDocumentError, spriteDocumentError } from './spriteDocumentValidation.js'

const PROCESS_JOB_TYPE = /^(process[-_]?sheet|character[-_]?pack([-_]?process)?)$/i
const FORBIDDEN_JOB_TYPE = /repair|reprocess|generate|t2i|scene|motion|fixed_region|action.?repair/i
const PROCESS_ARTIFACTS = Object.freeze({
  normalized_sheet_url: 'normalized_sheet.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  debug_report_url: 'debug_report.json',
})

function isGeneratedProcessJobShape(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || job.generation_url) return false
  return Object.entries(PROCESS_ARTIFACTS).every(([key, file]) => (
    job[key] === `/generated/${job.id}/${file}`
  ))
}

function mapGeneratedPathError(error) {
  if (error instanceof SpriteDocumentError) throw error
  if (error?.code === 'specialized_accept_required') {
    throw spriteDocumentError('specialized_accept_required', 'specialized jobs require sealed specialized acceptance')
  }
  if (error?.code === 'artifact_not_found') {
    throw spriteDocumentError('artifact_not_found', 'required process job artifact was not found')
  }
  if (error?.code === 'unsafe_artifact_path') {
    throw spriteDocumentError('invalid_request', 'source path is unsafe')
  }
  throw spriteDocumentError('artifact_integrity_failed', 'job artifact could not be resolved')
}

export function assertCharacterPackProcessJob(job) {
  if (!job) throw spriteDocumentError('job_not_found', 'generated job was not found')
  if (job.status !== 'done') {
    throw spriteDocumentError('job_not_ready', 'job is not a completed character-pack process job')
  }
  const type = String(job.type ?? job.job_type ?? '').trim()
  const typedProcessJob = Boolean(type) && !FORBIDDEN_JOB_TYPE.test(type) && PROCESS_JOB_TYPE.test(type)
  if (!typedProcessJob && !isGeneratedProcessJobShape(job)) {
    throw spriteDocumentError('unsupported_input', 'job is not a completed character-pack process job')
  }
  if (job.requires_user_confirmation === true || job.human_decision_status === 'pending') {
    throw spriteDocumentError('unsupported_input', 'generation jobs cannot be promoted')
  }
  if (typeof job.failure_status === 'string' && job.failure_status) {
    throw spriteDocumentError('unsupported_input', 'job is not a completed character-pack process job')
  }
  return job
}

export async function readBoundedJobFile(filePath, maxBytes) {
  let handle = null
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    handle = await open(filePath, flags)
    const initial = await handle.stat()
    if (!initial.isFile()) {
      throw spriteDocumentError('invalid_request', 'job artifact is not a regular file')
    }
    if (!Number.isSafeInteger(initial.size) || initial.size > maxBytes) {
      throw spriteDocumentError('resource_limit', 'job artifact exceeds its size limit', { limit: maxBytes })
    }
    const bytes = Buffer.allocUnsafe(initial.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!result.bytesRead) {
        throw spriteDocumentError('artifact_integrity_failed', 'job artifact changed while reading')
      }
      offset += result.bytesRead
    }
    const final = await handle.stat()
    if (final.size !== initial.size) {
      if (!Number.isSafeInteger(final.size) || final.size > maxBytes) {
        throw spriteDocumentError('resource_limit', 'job artifact exceeds its size limit', { limit: maxBytes })
      }
      throw spriteDocumentError('artifact_integrity_failed', 'job artifact changed while reading')
    }
    return bytes
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw spriteDocumentError('artifact_not_found', 'required process job artifact was not found')
    }
    if (error?.code === 'ELOOP') {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    throw spriteDocumentError('artifact_integrity_failed', 'job artifact could not be read safely')
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function readRequiredJobFile(jobId, key, generatedDir) {
  const fileName = CHARACTER_PACK_FROM_JOB_FILES[key]
  let filePath
  try {
    filePath = await resolveGeneratedJobArtifactFile({
      jobId,
      fileName,
      allowedFiles: characterPackFromJobAllowedFiles(),
      generatedDir,
    })
  } catch (error) {
    mapGeneratedPathError(error)
  }
  const maxBytes = key === 'sheet'
    ? SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes
    : SPRITE_DOCUMENT_LIMITS.maxManifestBytes
  const bytes = await readBoundedJobFile(filePath, maxBytes)
  if (!bytes.length) {
    throw spriteDocumentError('artifact_not_found', 'required process job artifact was not found')
  }
  return { fileName, bytes }
}

export async function readRequiredJobJson(jobId, key, generatedDir) {
  const loaded = await readRequiredJobFile(jobId, key, generatedDir)
  let value
  try {
    value = JSON.parse(loaded.bytes.toString('utf8'))
  } catch {
    throw spriteDocumentError('unsupported_input', 'job metadata is not valid JSON')
  }
  if (!isPlainObject(value)) {
    throw spriteDocumentError('unsupported_input', 'job metadata is not valid JSON')
  }
  return { ...loaded, value }
}

export async function captureCharacterPackProcessJob({
  jobId,
  expectedSha256,
  getGeneratedJob,
  generatedDir,
} = {}) {
  if (typeof getGeneratedJob !== 'function') {
    throw spriteDocumentError('job_not_found', 'generated job was not found')
  }
  const job = assertCharacterPackProcessJob(await getGeneratedJob(jobId))
  try {
    await assertGeneratedJobNotSpecialized({ jobId, generatedDir })
  } catch (error) {
    mapGeneratedPathError(error)
  }
  const sheet = await readRequiredJobFile(jobId, 'sheet', generatedDir)
  const animations = await readRequiredJobJson(jobId, 'animations', generatedDir)
  const metadata = await readRequiredJobJson(jobId, 'metadata', generatedDir)
  const editorMetadata = await readRequiredJobJson(jobId, 'editor_metadata', generatedDir)
  const debugReport = await readRequiredJobJson(jobId, 'debug_report', generatedDir)
  if (qualityStatusFromReport(debugReport.value) !== 'pass') {
    throw spriteDocumentError('quality_blocked', 'process job quality did not pass')
  }
  const clips = clipsFromCharacterAnimations(animations.value)
  if (!Object.keys(clips).length) {
    throw spriteDocumentError('unsupported_input', 'sheet metadata has no reliable frame layout')
  }
  return {
    pngBytes: sheet.bytes,
    expectedSha256,
    animationsBytes: animations.bytes,
    metadataBytes: metadata.bytes,
    editorMetadataBytes: editorMetadata.bytes,
    debugReportBytes: debugReport.bytes,
    editorMetadata: editorMetadata.value,
    clips,
    profile: metadata.value.profile ?? animations.value.profile ?? 'topdown_rpg_v0',
    name: metadata.value.name ?? metadata.value.id ?? null,
    provenance: {
      source_type: provenanceSourceTypeFromMetadata(metadata.value),
      provider: metadata.value.generation?.provider ?? null,
      model: metadata.value.generation?.model ?? null,
    },
  }
}

export async function createSpriteDocumentFromJob({
  projectId,
  operationId,
  expectedRevision,
  source,
  name,
  payload,
  getGeneratedJob,
  generatedDir,
  projectRoot,
  workspaceRoot,
  now,
  fault = null,
} = {}) {
  return createSpriteDocumentFromProcessedJob({
    projectId,
    operationId,
    expectedRevision,
    source,
    name,
    payload,
    projectRoot,
    workspaceRoot,
    now,
    fault,
    loadCaptured: () => captureCharacterPackProcessJob({
      jobId: source.job_id,
      expectedSha256: source.expected_sha256,
      getGeneratedJob,
      generatedDir,
    }),
  })
}
