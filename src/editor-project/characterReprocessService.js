import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { resolveGeneratedJobDir } from './paths.js'

export const CHARACTER_REPROCESS_INTEGRITY_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  sheet: 'normalized_sheet.png',
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  processing_recipe: 'processing_recipe.json',
  reprocess_context: 'editor_reprocess_context.json',
  zip: 'character_pack.zip',
})

export const CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES = Object.freeze({
  black_matte: 'input_black_matte.png',
})

const SERVER_CONTEXT_KEYS = Object.freeze(['job_type', 'preview_job_id', 'submitted_at'])
const TERMINAL_STATUSES = new Set(['done', 'failed_post_processing'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const GENERATED_URL_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const ARTIFACT_URL_FILES = Object.freeze({
  result_url: 'metadata.json',
  source_url: 'source.png',
  source_layout_overlay_url: 'source_layout_overlay.png',
  source_quality_report_url: 'source_quality_report.json',
  debug_report_url: 'debug_report.json',
  normalized_sheet_url: 'normalized_sheet.png',
  multi_resolution_manifest_url: 'multi_resolution.json',
  debug_overlay_url: 'debug_overlay.png',
  onion_skin_overlay_url: 'onion_skin_overlay.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  inspection_index_url: 'inspection_index.json',
  inspection_sheet_url: 'inspection_sheet.png',
  godot_npc_zip_url: 'godot_npc_pack.zip',
  rpgmaker_zip_url: 'rpgmaker_pack.zip',
  ocad_zip_url: 'ocad_pack.zip',
  zip_url: 'character_pack.zip',
})

const PUBLIC_JOB_SCALARS = Object.freeze([
  'id',
  'status',
  'created_at',
  'updated_at',
  'type',
  'project_id',
  'project_revision',
  'asset_id',
  'parent_revision_id',
  'recipe_hash',
  'draft_settings_hash',
  'implementation_revision',
  'reason',
  'retry_hint',
])

function codedError(code, message) {
  return Object.assign(new Error(message), { code })
}

function isStrictPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function snapshotValue(value, { allowBuffers = false, seen = new Set() } = {}) {
  if (value == null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return value
  if (Buffer.isBuffer(value)) {
    if (!allowBuffers) throw new TypeError('binary values are not allowed here')
    return Buffer.from(value)
  }
  if (typeof value !== 'object') throw new TypeError('value is not plain data')
  if (seen.has(value)) throw new TypeError('cyclic values are not allowed')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => snapshotValue(item, { allowBuffers, seen }))
    }
    if (!isStrictPlainObject(value)) throw new TypeError('value is not a plain object')
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('symbol keys are not allowed')
    return Object.fromEntries(keys
      .filter((key) => Object.prototype.propertyIsEnumerable.call(value, key))
      .map((key) => [key, snapshotValue(value[key], { allowBuffers, seen })]))
  } finally {
    seen.delete(value)
  }
}

function snapshotObject(value, options) {
  if (!isStrictPlainObject(value)) throw new TypeError('expected a plain object')
  return snapshotValue(value, options)
}

function hasParentEscape(relative) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function sameDirectoryIdentity(left, right) {
  return Boolean(left && right) &&
    left.real_path === right.real_path &&
    left.dev === right.dev &&
    left.ino === right.ino
}

async function lexicalDirectoryStats(jobDir) {
  let value
  try {
    value = await lstat(jobDir)
  } catch {
    throw codedError('unsafe_artifact_path', 'job directory could not be safely inspected')
  }
  if (value.isSymbolicLink() || !value.isDirectory()) {
    throw codedError('unsafe_artifact_path', 'job path is not a direct directory')
  }
  return value
}

async function assertGeneratedJobDirectory(generatedDir, jobDir, jobId, expectedIdentity = null) {
  const before = await lexicalDirectoryStats(jobDir)
  let realGenerated
  let realJob
  try {
    ;[realGenerated, realJob] = await Promise.all([realpath(generatedDir), realpath(jobDir)])
  } catch {
    throw codedError('unsafe_artifact_path', 'job directory could not be safely resolved')
  }
  const relative = path.relative(realGenerated, realJob)
  if (hasParentEscape(relative) || relative !== jobId) {
    throw codedError('unsafe_artifact_path', 'job directory does not match its exact generated identity')
  }
  const after = await lexicalDirectoryStats(jobDir)
  let realStats
  try {
    realStats = await stat(realJob)
  } catch {
    throw codedError('unsafe_artifact_path', 'job directory identity could not be verified')
  }
  if (before.dev !== after.dev || before.ino !== after.ino ||
      after.dev !== realStats.dev || after.ino !== realStats.ino) {
    throw codedError('unsafe_artifact_path', 'job directory changed during identity verification')
  }
  const identity = Object.freeze({ real_path: realJob, dev: after.dev, ino: after.ino })
  if (expectedIdentity && !sameDirectoryIdentity(identity, expectedIdentity)) {
    throw codedError('unsafe_artifact_path', 'reserved job directory identity changed')
  }
  return identity
}

async function sealCharacterReprocessArtifacts(jobDir, { hasBlackMatte }) {
  const files = hasBlackMatte
    ? { ...CHARACTER_REPROCESS_INTEGRITY_FILES, ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  const entries = []
  for (const [key, fileName] of Object.entries(files)) {
    const content = await readFile(path.join(jobDir, fileName))
    entries.push(Object.freeze({
      key,
      file_name: fileName,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    }))
  }
  return Object.freeze(entries)
}

function generatedUrl(jobId, fileName) {
  return `/generated/${jobId}/${fileName}`
}

function isSafeGeneratedUrl(value, jobId, expectedFileName = null) {
  if (typeof value !== 'string') return false
  if (value.includes('%') || value.includes('\\')) return false
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (decoded !== value || path.posix.normalize(value) !== value) return false
  const prefix = `/generated/${jobId}/`
  if (!value.startsWith(prefix)) return false
  const fileName = value.slice(prefix.length)
  if (!fileName || fileName.startsWith('/') || fileName.includes('?') || fileName.includes('#')) return false
  const segments = fileName.split('/')
  if (segments.some((part) => !GENERATED_URL_SEGMENT_PATTERN.test(part) || part === '..' || part === '.')) return false
  return expectedFileName == null ? true : fileName === expectedFileName
}

function sanitizeUrlList(value, jobId) {
  if (!Array.isArray(value)) return null
  const result = []
  for (const url of value) {
    if (!isSafeGeneratedUrl(url, jobId)) return null
    result.push(url)
  }
  return result
}

function sanitizeMultiResolutionUrls(value, jobId) {
  if (!Array.isArray(value)) return null
  const result = []
  for (const item of value) {
    if (!isStrictPlainObject(item) || !Number.isInteger(item.frame_size) || item.frame_size <= 0) return null
    const expected = `normalized_sheet_${item.frame_size}.png`
    if (!isSafeGeneratedUrl(item.url, jobId, expected)) return null
    result.push({ frame_size: item.frame_size, url: item.url })
  }
  return result
}

function sanitizePreviewList(value, jobId) {
  if (!Array.isArray(value)) return null
  const result = []
  const scalarKeys = ['name', 'file', 'animation', 'label', 'frame_count', 'fps', 'mode']
  for (const item of value) {
    if (!isStrictPlainObject(item)) return null
    const next = {}
    for (const key of scalarKeys) {
      if (['string', 'number'].includes(typeof item[key]) || item[key] === null) next[key] = item[key]
    }
    if (isStrictPlainObject(item.frame_size) && Number.isFinite(item.frame_size.w) && Number.isFinite(item.frame_size.h)) {
      next.frame_size = { w: item.frame_size.w, h: item.frame_size.h }
    }
    for (const key of ['url', 'runtime_url', 'strip_url']) {
      if (item[key] == null) {
        if (item[key] === null) next[key] = null
        continue
      }
      if (!isSafeGeneratedUrl(item[key], jobId)) return null
      next[key] = item[key]
    }
    result.push(next)
  }
  return result
}

function sanitizeArtifactUrls(value, jobId) {
  if (!isStrictPlainObject(value)) throw codedError('artifact_integrity_failed', 'artifact writer URLs are invalid')
  const urls = {}
  for (const [key, fileName] of Object.entries(ARTIFACT_URL_FILES)) {
    if (!Object.hasOwn(value, key)) continue
    if (!isSafeGeneratedUrl(value[key], jobId, fileName)) {
      throw codedError('artifact_integrity_failed', `artifact writer URL is invalid: ${key}`)
    }
    urls[key] = value[key]
  }
  const simpleLists = ['inspection_gif_urls', 'row_gif_urls']
  for (const key of simpleLists) {
    if (!Object.hasOwn(value, key)) continue
    const sanitized = sanitizeUrlList(value[key], jobId)
    if (!sanitized) throw codedError('artifact_integrity_failed', `artifact writer URL list is invalid: ${key}`)
    urls[key] = sanitized
  }
  if (Object.hasOwn(value, 'multi_resolution_sheet_urls')) {
    const sanitized = sanitizeMultiResolutionUrls(value.multi_resolution_sheet_urls, jobId)
    if (!sanitized) throw codedError('artifact_integrity_failed', 'multi-resolution URLs are invalid')
    urls.multi_resolution_sheet_urls = sanitized
  }
  for (const key of ['inspection_gif_previews', 'row_gif_previews']) {
    if (!Object.hasOwn(value, key)) continue
    const sanitized = sanitizePreviewList(value[key], jobId)
    if (!sanitized) throw codedError('artifact_integrity_failed', `artifact previews are invalid: ${key}`)
    urls[key] = sanitized
  }
  return urls
}

function sanitizeIntegrityManifest(value, { hasBlackMatte }) {
  if (!Array.isArray(value)) throw codedError('artifact_integrity_failed', 'artifact integrity manifest is invalid')
  const files = hasBlackMatte
    ? { ...CHARACTER_REPROCESS_INTEGRITY_FILES, ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  const expectedKeys = Object.keys(files)
  if (value.length !== expectedKeys.length) {
    throw codedError('artifact_integrity_failed', 'artifact integrity manifest is incomplete')
  }
  const byKey = new Map()
  for (const entry of value) {
    if (!isStrictPlainObject(entry) || typeof entry.key !== 'string' || byKey.has(entry.key)) {
      throw codedError('artifact_integrity_failed', 'artifact integrity manifest entry is invalid')
    }
    if (!Object.hasOwn(files, entry.key) || entry.file_name !== files[entry.key]) {
      throw codedError('artifact_integrity_failed', 'artifact integrity manifest identity is invalid')
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !SHA256_PATTERN.test(entry.sha256)) {
      throw codedError('artifact_integrity_failed', 'artifact integrity manifest digest is invalid')
    }
    byKey.set(entry.key, Object.freeze({
      key: entry.key,
      file_name: entry.file_name,
      size: entry.size,
      sha256: entry.sha256,
    }))
  }
  return Object.freeze(expectedKeys.map((key) => byKey.get(key)))
}

function sanitizeWrittenResult(value, jobId) {
  if (!isStrictPlainObject(value) || !TERMINAL_STATUSES.has(value.status)) {
    throw codedError('artifact_integrity_failed', 'artifact writer terminal result is invalid')
  }
  const reason = value.reason == null ? null : typeof value.reason === 'string' ? value.reason : null
  const retryHint = value.retry_hint == null ? null : typeof value.retry_hint === 'string' ? value.retry_hint : null
  return Object.freeze({
    status: value.status,
    urls: Object.freeze(sanitizeArtifactUrls(value.urls ?? {}, jobId)),
    reason,
    retry_hint: retryHint,
  })
}

function sanitizeEvidenceResult(value, jobId, { hasBlackMatte }) {
  if (!isStrictPlainObject(value) ||
      value.processing_recipe_url !== generatedUrl(jobId, CHARACTER_REPROCESS_INTEGRITY_FILES.processing_recipe) ||
      value.reprocess_context_url !== generatedUrl(jobId, CHARACTER_REPROCESS_INTEGRITY_FILES.reprocess_context)) {
    throw codedError('artifact_integrity_failed', 'reprocess evidence URLs are invalid')
  }
  return Object.freeze({
    processing_recipe_url: value.processing_recipe_url,
    reprocess_context_url: value.reprocess_context_url,
    artifact_integrity_manifest: sanitizeIntegrityManifest(value.artifact_integrity_manifest, { hasBlackMatte }),
  })
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function sanitizePublicJob(value) {
  if (!isStrictPlainObject(value)) return null
  const job = {}
  for (const key of PUBLIC_JOB_SCALARS) {
    const item = value[key]
    if (item == null || ['string', 'number', 'boolean'].includes(typeof item)) {
      if (Object.hasOwn(value, key)) job[key] = item
    }
  }
  if (typeof job.id !== 'string') return null
  for (const [key, fileName] of Object.entries(ARTIFACT_URL_FILES)) {
    if (isSafeGeneratedUrl(value[key], job.id, fileName)) job[key] = value[key]
  }
  for (const key of ['processing_recipe_url', 'reprocess_context_url']) {
    const expected = key === 'processing_recipe_url'
      ? CHARACTER_REPROCESS_INTEGRITY_FILES.processing_recipe
      : CHARACTER_REPROCESS_INTEGRITY_FILES.reprocess_context
    if (isSafeGeneratedUrl(value[key], job.id, expected)) job[key] = value[key]
  }
  for (const key of ['inspection_gif_urls', 'row_gif_urls']) {
    const sanitized = sanitizeUrlList(value[key], job.id)
    if (sanitized) job[key] = sanitized
  }
  const multiResolution = sanitizeMultiResolutionUrls(value.multi_resolution_sheet_urls, job.id)
  if (multiResolution) job.multi_resolution_sheet_urls = multiResolution
  for (const key of ['inspection_gif_previews', 'row_gif_previews']) {
    const sanitized = sanitizePreviewList(value[key], job.id)
    if (sanitized) job[key] = sanitized
  }
  if (Array.isArray(value.artifact_integrity_manifest)) {
    const manifest = []
    for (const entry of value.artifact_integrity_manifest) {
      if (!isStrictPlainObject(entry) || typeof entry.key !== 'string' || typeof entry.file_name !== 'string' ||
          !Number.isSafeInteger(entry.size) || entry.size < 0 || !SHA256_PATTERN.test(entry.sha256)) {
        continue
      }
      manifest.push({ key: entry.key, file_name: entry.file_name, size: entry.size, sha256: entry.sha256 })
    }
    if (manifest.length === value.artifact_integrity_manifest.length) job.artifact_integrity_manifest = manifest
  }
  return deepFreeze(job)
}

export async function writeCharacterReprocessEvidence({
  generatedDir,
  job,
  canonicalRecipe,
  reprocessContext,
  blackSourceBuffer = null,
}) {
  let jobDir
  try {
    jobDir = resolveGeneratedJobDir(job?.id, { generatedDir })
  } catch {
    throw codedError('unsafe_artifact_path', 'generated job identity is invalid')
  }
  await assertGeneratedJobDirectory(generatedDir, jobDir, job.id)
  const hasBlackMatteRef = Boolean(canonicalRecipe?.source?.black_matte_artifact_ref)
  if (hasBlackMatteRef !== Buffer.isBuffer(blackSourceBuffer)) {
    throw codedError('artifact_integrity_failed', 'black matte evidence does not match Recipe authority')
  }
  const blackDigest = Buffer.isBuffer(blackSourceBuffer)
    ? createHash('sha256').update(blackSourceBuffer).digest('hex')
    : null
  if (hasBlackMatteRef
    ? reprocessContext?.black_matte_artifact_sha256 !== blackDigest
    : reprocessContext?.black_matte_artifact_sha256 !== null) {
    throw codedError('artifact_integrity_failed', 'black matte evidence digest does not match context authority')
  }
  if (hasBlackMatteRef) {
    await writeFile(
      path.join(jobDir, CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES.black_matte),
      blackSourceBuffer,
      { flag: 'wx' },
    )
  }
  await writeFile(
    path.join(jobDir, CHARACTER_REPROCESS_INTEGRITY_FILES.processing_recipe),
    `${JSON.stringify(canonicalRecipe, null, 2)}\n`,
    { flag: 'wx' },
  )
  await writeFile(
    path.join(jobDir, CHARACTER_REPROCESS_INTEGRITY_FILES.reprocess_context),
    `${JSON.stringify(reprocessContext, null, 2)}\n`,
    { flag: 'wx' },
  )
  return Object.freeze({
    processing_recipe_url: generatedUrl(job.id, CHARACTER_REPROCESS_INTEGRITY_FILES.processing_recipe),
    reprocess_context_url: generatedUrl(job.id, CHARACTER_REPROCESS_INTEGRITY_FILES.reprocess_context),
    artifact_integrity_manifest: await sealCharacterReprocessArtifacts(jobDir, { hasBlackMatte: hasBlackMatteRef }),
  })
}

export function createCharacterReprocessService({
  generatedDir,
  jobQueue,
  createJob,
  getJob,
  updateJob,
  processSheet,
  writeCharacterArtifacts,
  writeEvidence,
}) {
  const functions = [createJob, getJob, updateJob, processSheet, writeCharacterArtifacts, writeEvidence]
  if (!jobQueue || typeof jobQueue.enqueue !== 'function' || functions.some((value) => typeof value !== 'function')) {
    throw new TypeError('character reprocess service dependencies are invalid')
  }

  function publicGetJob(jobId) {
    return sanitizePublicJob(getJob(jobId))
  }

  function enqueue(input) {
    if (!isStrictPlainObject(input)) {
      throw codedError('invalid_reprocess_request', 'reprocess input must be a plain object')
    }
    const {
      sourceBuffer,
      processOptions,
      canonicalRecipe,
      reprocessContextBase,
      blackSourceBuffer = null,
    } = input
    if (!Buffer.isBuffer(sourceBuffer) ||
        !isStrictPlainObject(processOptions) ||
        !isStrictPlainObject(canonicalRecipe) ||
        !isStrictPlainObject(reprocessContextBase)) {
      throw codedError('invalid_reprocess_request', 'reprocess private inputs are invalid')
    }
    if (SERVER_CONTEXT_KEYS.some((key) => Object.hasOwn(reprocessContextBase, key))) {
      throw codedError('invalid_reprocess_request', 'server-owned reprocess context fields are forbidden')
    }

    let privateSourceBuffer
    let optionsSnapshot
    let recipeSnapshot
    let contextSnapshot
    try {
      privateSourceBuffer = Buffer.from(sourceBuffer)
      optionsSnapshot = snapshotObject(processOptions, { allowBuffers: true })
      recipeSnapshot = snapshotObject(canonicalRecipe, { allowBuffers: false })
      contextSnapshot = snapshotObject(reprocessContextBase, { allowBuffers: false })
    } catch {
      throw codedError('invalid_reprocess_request', 'reprocess private inputs are not snapshot-safe')
    }

    const sourceDigest = createHash('sha256').update(privateSourceBuffer).digest('hex')
    if (!SHA256_PATTERN.test(contextSnapshot.input_artifact_sha256) ||
        contextSnapshot.input_artifact_sha256 !== sourceDigest) {
      throw codedError('invalid_reprocess_request', 'source bytes do not match reprocess context authority')
    }

    const hasBlackMatteRef = Boolean(recipeSnapshot.source?.black_matte_artifact_ref)
    const optionBlack = optionsSnapshot.blackSourceBuffer ?? null
    const suppliedBlack = Buffer.isBuffer(blackSourceBuffer) ? Buffer.from(blackSourceBuffer) : null
    const suppliedBlackDigest = suppliedBlack
      ? createHash('sha256').update(suppliedBlack).digest('hex')
      : null
    const blackAuthorityMatches = hasBlackMatteRef
      ? Buffer.isBuffer(optionBlack) &&
        suppliedBlack &&
        Buffer.compare(optionBlack, suppliedBlack) === 0 &&
        SHA256_PATTERN.test(contextSnapshot.black_matte_artifact_sha256) &&
        contextSnapshot.black_matte_artifact_sha256 === suppliedBlackDigest
      : blackSourceBuffer == null &&
        optionBlack == null &&
        contextSnapshot.black_matte_artifact_sha256 === null
    if (!blackAuthorityMatches) {
      throw codedError('invalid_recipe', 'black matte input does not match Recipe authority')
    }

    const job = createJob({
      type: 'editor_character_reprocess',
      project_id: contextSnapshot.project_id,
      asset_id: contextSnapshot.asset_id,
      parent_revision_id: contextSnapshot.parent_revision_id,
      recipe_hash: contextSnapshot.recipe_hash,
      draft_settings_hash: contextSnapshot.draft_settings_hash,
      implementation_revision: contextSnapshot.implementation_revision,
    })
    if (!isStrictPlainObject(job) || typeof job.id !== 'string' || typeof job.created_at !== 'string') {
      throw codedError('invalid_reprocess_request', 'created reprocess job identity is invalid')
    }

    const jobIdentity = Object.freeze({ id: job.id, created_at: job.created_at })
    const processingBlackBuffer = suppliedBlack ? Buffer.from(suppliedBlack) : null
    const evidenceBlackBuffer = suppliedBlack ? Buffer.from(suppliedBlack) : null
    const effectiveOptions = {
      ...optionsSnapshot,
      blackSourceBuffer: processingBlackBuffer,
      createdAt: jobIdentity.created_at,
    }
    const reprocessContext = {
      ...contextSnapshot,
      job_type: 'editor_character_reprocess',
      preview_job_id: jobIdentity.id,
      submitted_at: jobIdentity.created_at,
    }
    const jobForWriters = deepFreeze(sanitizePublicJob(job))

    jobQueue.enqueue(async () => {
      updateJob(jobIdentity.id, { status: 'post_processing' })
      let phase = 'reservation'
      try {
        const jobDir = resolveGeneratedJobDir(jobIdentity.id, { generatedDir })
        await mkdir(generatedDir, { recursive: true })
        await mkdir(jobDir)
        const reservation = await assertGeneratedJobDirectory(generatedDir, jobDir, jobIdentity.id)
        phase = 'processing'
        const result = await processSheet(privateSourceBuffer, effectiveOptions)
        await assertGeneratedJobDirectory(generatedDir, jobDir, jobIdentity.id, reservation)
        phase = 'artifacts'
        const writtenResult = await writeCharacterArtifacts({ job: jobForWriters, result })
        await assertGeneratedJobDirectory(generatedDir, jobDir, jobIdentity.id, reservation)
        const written = sanitizeWrittenResult(writtenResult, jobIdentity.id)
        phase = 'evidence'
        const evidenceResult = await writeEvidence({
          job: jobForWriters,
          canonicalRecipe: recipeSnapshot,
          reprocessContext,
          blackSourceBuffer: evidenceBlackBuffer,
        })
        await assertGeneratedJobDirectory(generatedDir, jobDir, jobIdentity.id, reservation)
        const evidence = sanitizeEvidenceResult(evidenceResult, jobIdentity.id, { hasBlackMatte: hasBlackMatteRef })
        phase = 'publication'
        updateJob(jobIdentity.id, {
          status: written.status,
          ...written.urls,
          ...evidence,
          reason: written.reason,
          retry_hint: written.retry_hint,
        })
      } catch {
        updateJob(jobIdentity.id, {
          status: 'failed_post_processing',
          reason: phase === 'evidence' ? 'artifact_integrity_failed' : `${phase}_failed`,
          retry_hint: 'inspect_editor_character_reprocess',
        })
      }
    }, () => {
      updateJob(jobIdentity.id, {
        status: 'failed_post_processing',
        reason: 'queue_failed',
        retry_hint: 'inspect_editor_character_reprocess',
      })
    })
    return publicGetJob(jobIdentity.id)
  }

  return Object.freeze({ enqueue, getJob: publicGetJob })
}
