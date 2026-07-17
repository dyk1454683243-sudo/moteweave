import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { buildCharacterPackArtifactManifest } from '../character-pack/artifactManifest.js'
import { ID_PATTERN, JOB_ID_PATTERN } from './constants.js'
import { resolveGeneratedJobArtifactFile, resolveGeneratedJobDir } from './paths.js'
import {
  isIsoTimestamp,
  isSafeRelativePath,
  isSecretLikeKey,
  isSecretLikeValue,
} from './safety.js'

export const FRAME_REPAIR_INTEGRITY_FILES = Object.freeze({
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
  inspection_index: 'inspection_index.json',
  inspection_sheet: 'inspection_sheet.png',
  godot_npc_zip: 'godot_npc_pack.zip',
  rpgmaker_zip: 'rpgmaker_pack.zip',
  ocad_zip: 'ocad_pack.zip',
  zip: 'character_pack.zip',
  frame_repair_plan: 'frame_repair_plan.json',
  frame_repair_context: 'editor_frame_repair_context.json',
  target_before: 'target_before.png',
  frame_repair_mask: 'frame_repair_mask.png',
  frame_repair_context_image: 'frame_repair_context.png',
  raw_provider_output: 'raw_provider_output.png',
  normalized_candidate_frame: 'normalized_candidate_frame.png',
  composited_candidate_frame: 'composited_candidate_frame.png',
  frame_repair_difference: 'frame_repair_difference.png',
  frame_repair_quality: 'frame_repair_quality.json',
  frame_repair_prompt: 'frame_repair_prompt.txt',
  patched_normalized_sheet: 'patched_normalized_sheet.png',
})

const FRAME_REPAIR_EVIDENCE_INPUT_KEYS = Object.freeze([
  'frame_repair_plan',
  'frame_repair_context_base',
  'target_before',
  'frame_repair_mask',
  'frame_repair_context_image',
  'raw_provider_output',
  'normalized_candidate_frame',
  'composited_candidate_frame',
  'frame_repair_difference',
  'frame_repair_quality',
  'frame_repair_prompt',
  'patched_normalized_sheet',
])

const FRAME_REPAIR_CONTEXT_KEYS = Object.freeze([
  'version', 'job_type', 'job_id', 'operation_id', 'submitted_at',
  'project_id', 'project_revision', 'asset_id', 'parent_revision_id',
  'parent_sheet_ref', 'parent_sheet_sha256', 'parent_processing_recipe_ref',
  'profile', 'frame_size', 'sheet_size', 'clip_id', 'clip_frame_position',
  'sheet_frame_index', 'target_frame_sha256', 'context_frames',
  'reference_context_sha256', 'mask_sha256', 'plan_hash', 'provider_preset',
  'provider_call_budget', 'provider_calls_used', 'implementation_revision',
  'input_reference_roles',
])
const PROVIDER_PRESET_KEYS = Object.freeze(['id', 'provider', 'label', 'model', 'image_config'])
const CONTEXT_FRAME_KEYS = Object.freeze(['position', 'sheet_frame_index', 'sha256'])
const IMAGE_CONFIG_KEYS = Object.freeze(['image_size', 'aspect_ratio'])
const REFERENCE_ROLE_ORDER = Object.freeze([
  'target_enlarged', 'mask_visualization', 'clip_context', 'full_sheet',
])
const PNG_EVIDENCE_KEYS = Object.freeze([
  'target_before', 'frame_repair_mask', 'frame_repair_context_image',
  'raw_provider_output', 'normalized_candidate_frame', 'composited_candidate_frame',
  'frame_repair_difference', 'patched_normalized_sheet',
])
const STANDARD_FIXED_KEYS = Object.freeze([
  'source', 'source_layout_overlay', 'sheet', 'multi_resolution',
  'sheet_96', 'sheet_64', 'sheet_48', 'sheet_32', 'sheet_16',
  'animations', 'metadata', 'editor_metadata', 'debug_report', 'debug_overlay',
  'onion_skin_overlay', 'inspection_index', 'inspection_sheet',
  'godot_npc_zip', 'rpgmaker_zip', 'ocad_zip', 'zip',
])
const ALLOWED_NESTED_PREVIEW_DIRS = new Set(['inspection_gifs', 'inspection_strips'])
const SAFE_FILE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/
const DATA_URL_PATTERN = /data:[^,\s]*;base64,/i
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/
const EXTERNAL_URL_PATTERN = /(?:^|\s)(?:https?|ftp|file):\/\//i
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)(?:\/{1,2}(?=\S)|~\/(?=\S)|[A-Za-z]:[\\/](?=\S)|\\\\(?=\S))/
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_STANDARD_FILE_BYTES = 64 * 1024 * 1024
const MAX_STANDARD_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_EVIDENCE_PNG_BYTES = 32 * 1024 * 1024
const MAX_EVIDENCE_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_CAPTURE_TOTAL_BYTES = 384 * 1024 * 1024
const MAX_CONTEXT_BYTES = 4 * 1024 * 1024
const MAX_PLAN_JSON_BYTES = 1 * 1024 * 1024
const MAX_QUALITY_JSON_BYTES = 4 * 1024 * 1024
const MAX_PROMPT_BYTES = 64 * 1024
const MAX_JSON_NODES = 20_000
const MAX_JSON_DEPTH = 32
const MAX_JSON_KEY_LENGTH = 240
const NO_FOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0

function artifactIntegrityError() {
  const error = new Error('frame repair artifact integrity failed')
  error.code = 'artifact_integrity_failed'
  return error
}

function failIntegrity() {
  throw artifactIntegrityError()
}

function isStrictPlainObject(value) {
  return Boolean(value) && typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, keys) {
  if (!isStrictPlainObject(value)) return false
  const actual = Object.keys(value)
  const ownKeys = Reflect.ownKeys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)) &&
    ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string')
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isSafePublicString(value, { maxLength = 500, allowManagedRef = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength ||
      value.trim() !== value || CONTROL_PATTERN.test(value) || DATA_URL_PATTERN.test(value) ||
      isSecretLikeValue(value)) return false
  if (allowManagedRef) return isSafeRelativePath(value) && !value.includes('\\') && !value.includes('%')
  return !WINDOWS_ABSOLUTE_PATTERN.test(value) && !EXTERNAL_URL_PATTERN.test(value) &&
    !ABSOLUTE_PATH_PATTERN.test(value) &&
    !value.split(/[\\/]/).includes('..')
}

function reserveJsonBytes(state, value, maxBytes) {
  state.bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (state.bytes > maxBytes) failIntegrity()
}

function snapshotSafeJson(value, {
  depth = 0,
  state = { nodes: 0, bytes: 0 },
  seen = new Set(),
  maxBytes = MAX_STANDARD_FILE_BYTES,
} = {}) {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) failIntegrity()
  if (value === null || typeof value === 'boolean') {
    reserveJsonBytes(state, value, maxBytes)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failIntegrity()
    reserveJsonBytes(state, value, maxBytes)
    return value
  }
  if (typeof value === 'string') {
    if (!isSafePublicString(value, { maxLength: 20_000 })) failIntegrity()
    reserveJsonBytes(state, value, maxBytes)
    return value
  }
  if (!value || typeof value !== 'object' || seen.has(value)) failIntegrity()
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (!isDenseArray(value)) failIntegrity()
      return value.map((item) => snapshotSafeJson(item, {
        depth: depth + 1,
        state,
        seen,
        maxBytes,
      }))
    }
    if (!isStrictPlainObject(value)) failIntegrity()
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string') ||
        keys.some((key) => key.length === 0 || key.length > MAX_JSON_KEY_LENGTH ||
          isSecretLikeKey(key) || CONTROL_PATTERN.test(key))) failIntegrity()
    for (const key of keys) reserveJsonBytes(state, key, maxBytes)
    return Object.fromEntries(keys.map((key) => [
      key,
      snapshotSafeJson(value[key], { depth: depth + 1, state, seen, maxBytes }),
    ]))
  } finally {
    seen.delete(value)
  }
}

function sortStable(value) {
  if (Array.isArray(value)) return value.map(sortStable)
  if (!isStrictPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortStable(value[key])]))
}

function stableBytes(value) {
  return Buffer.from(JSON.stringify(sortStable(value)), 'utf8')
}

function formattedJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function pendingFile(content) {
  if (!Buffer.isBuffer(content) || content.length === 0) failIntegrity()
  return Object.freeze({
    content,
    size: content.length,
    sha256: sha256(content),
  })
}

function sameJson(left, right) {
  return stableBytes(left).equals(stableBytes(right))
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function safeManifestName(value) {
  if (typeof value !== 'string' || value.length > 240 || value.includes('\\') ||
      value.includes('%') || CONTROL_PATTERN.test(value) || !isSafeRelativePath(value) ||
      path.posix.normalize(value) !== value) return false
  const segments = value.split('/')
  if (segments.some((segment) => !SAFE_FILE_SEGMENT_PATTERN.test(segment) ||
      segment === '.' || segment === '..')) return false
  if (segments.length === 1) return true
  return segments.length === 2 && ALLOWED_NESTED_PREVIEW_DIRS.has(segments[0])
}

function generatedUrl(jobId, fileName) {
  return `/generated/${jobId}/${fileName}`
}

function urlsForJob(jobId) {
  return Object.fromEntries(Object.entries(FRAME_REPAIR_INTEGRITY_FILES).map(([key, fileName]) => [
    `${key}_url`, generatedUrl(jobId, fileName),
  ]))
}

function validateJobIdentity(job) {
  if (!isStrictPlainObject(job) || typeof job.id !== 'string' || !JOB_ID_PATTERN.test(job.id) ||
      !isIsoTimestamp(job.created_at)) failIntegrity()
  return { id: job.id, created_at: job.created_at }
}

function validateManagedRef(value, context, expectedName, { nullable = false } = {}) {
  if (nullable && value === null) return null
  if (!isSafePublicString(value, { maxLength: 800, allowManagedRef: true })) failIntegrity()
  const prefix = `workspace/projects/${context.project_id}/assets/${context.asset_id}/${context.parent_revision_id}/`
  if (value !== `${prefix}${expectedName}`) failIntegrity()
  return value
}

function validateProviderPreset(value) {
  if (!hasExactKeys(value, PROVIDER_PRESET_KEYS) ||
      !ID_PATTERN.test(value.id) || !ID_PATTERN.test(value.provider) ||
      !isSafePublicString(value.label, { maxLength: 240 }) ||
      !isSafePublicString(value.model, { maxLength: 240 }) ||
      !hasExactKeys(value.image_config, IMAGE_CONFIG_KEYS) ||
      !['1K', '2K'].includes(value.image_config.image_size) ||
      !isSafePublicString(value.image_config.aspect_ratio, { maxLength: 80 })) failIntegrity()
  return snapshotSafeJson(value, { maxBytes: MAX_CONTEXT_BYTES })
}

function validateContextBase(value, jobIdentity) {
  if (!hasExactKeys(value, FRAME_REPAIR_CONTEXT_KEYS) ||
      value.version !== 'editor_frame_repair_context_v1' ||
      value.job_type !== 'editor_character_frame_repair' || value.job_id !== jobIdentity.id ||
      !OPERATION_ID_PATTERN.test(value.operation_id) ||
      !isIsoTimestamp(value.submitted_at) || value.submitted_at !== jobIdentity.created_at ||
      !ID_PATTERN.test(value.project_id) || !isNonNegativeInteger(value.project_revision) ||
      !ID_PATTERN.test(value.asset_id) || !ID_PATTERN.test(value.parent_revision_id) ||
      !SHA256_PATTERN.test(value.parent_sheet_sha256) || !ID_PATTERN.test(value.profile) ||
      !hasExactKeys(value.frame_size, ['w', 'h']) ||
      !isPositiveInteger(value.frame_size.w) || !isPositiveInteger(value.frame_size.h) ||
      !hasExactKeys(value.sheet_size, ['w', 'h']) ||
      !isPositiveInteger(value.sheet_size.w) || !isPositiveInteger(value.sheet_size.h) ||
      !ID_PATTERN.test(value.clip_id) || !isNonNegativeInteger(value.clip_frame_position) ||
      !isNonNegativeInteger(value.sheet_frame_index) ||
      !SHA256_PATTERN.test(value.target_frame_sha256) ||
      !SHA256_PATTERN.test(value.reference_context_sha256) ||
      !SHA256_PATTERN.test(value.mask_sha256) || !SHA256_PATTERN.test(value.plan_hash) ||
      value.provider_call_budget !== 1 || value.provider_calls_used !== 1 ||
      !isSafePublicString(value.implementation_revision, { maxLength: 160 })) failIntegrity()
  validateManagedRef(value.parent_sheet_ref, value, 'normalized_sheet.png')
  validateManagedRef(value.parent_processing_recipe_ref, value, 'processing_recipe.json', { nullable: true })
  validateProviderPreset(value.provider_preset)
  if (!isDenseArray(value.context_frames) || value.context_frames.length > 2) failIntegrity()
  let priorPosition = -1
  for (const frame of value.context_frames) {
    if (!hasExactKeys(frame, CONTEXT_FRAME_KEYS) ||
        !isNonNegativeInteger(frame.position) || frame.position <= priorPosition ||
        frame.position === value.clip_frame_position ||
        !isNonNegativeInteger(frame.sheet_frame_index) || !SHA256_PATTERN.test(frame.sha256)) failIntegrity()
    priorPosition = frame.position
  }
  if (!isDenseArray(value.input_reference_roles) ||
      (value.input_reference_roles.length !== 3 && value.input_reference_roles.length !== 4)) failIntegrity()
  for (let index = 0; index < value.input_reference_roles.length; index += 1) {
    if (value.input_reference_roles[index] !== REFERENCE_ROLE_ORDER[index]) failIntegrity()
  }
  return snapshotSafeJson(value, { maxBytes: MAX_CONTEXT_BYTES })
}

function validatePngBuffer(value) {
  if (!Buffer.isBuffer(value) || value.length <= PNG_SIGNATURE.length ||
      value.length > MAX_EVIDENCE_PNG_BYTES ||
      !value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) failIntegrity()
  return value
}

function validatePromptBuffer(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > MAX_PROMPT_BYTES) failIntegrity()
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    failIntegrity()
  }
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
      DATA_URL_PATTERN.test(text) || isSecretLikeValue(text) ||
      ABSOLUTE_PATH_PATTERN.test(text)) failIntegrity()
  return value
}

function prepareEvidence(evidence, jobIdentity) {
  if (!hasExactKeys(evidence, FRAME_REPAIR_EVIDENCE_INPUT_KEYS)) failIntegrity()
  const plan = snapshotSafeJson(evidence.frame_repair_plan, { maxBytes: MAX_PLAN_JSON_BYTES })
  if (!isStrictPlainObject(plan) || plan.version !== 'frame_repair_plan_v1') failIntegrity()
  const serializedPlan = stableBytes(plan)
  const formattedPlan = formattedJsonBytes(plan)
  if (serializedPlan.length > MAX_PLAN_JSON_BYTES || formattedPlan.length > MAX_PLAN_JSON_BYTES) {
    failIntegrity()
  }
  const planHash = sha256(serializedPlan)
  const contextBase = validateContextBase(evidence.frame_repair_context_base, jobIdentity)
  if (contextBase.plan_hash !== planHash) failIntegrity()
  validatePlanContextBindings(plan, contextBase)
  const quality = snapshotSafeJson(evidence.frame_repair_quality, {
    maxBytes: MAX_QUALITY_JSON_BYTES,
  })
  if (!isStrictPlainObject(quality)) failIntegrity()
  const formattedQuality = formattedJsonBytes(quality)
  if (formattedQuality.length > MAX_QUALITY_JSON_BYTES) failIntegrity()
  const buffers = {}
  let evidenceBytes = formattedPlan.length + formattedQuality.length
  for (const key of PNG_EVIDENCE_KEYS) {
    buffers[key] = validatePngBuffer(evidence[key])
    evidenceBytes += buffers[key].length
  }
  buffers.frame_repair_prompt = validatePromptBuffer(evidence.frame_repair_prompt)
  evidenceBytes += buffers.frame_repair_prompt.length
  if (evidenceBytes > MAX_EVIDENCE_TOTAL_BYTES) failIntegrity()
  return {
    contextBase,
    files: new Map([
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_plan, pendingFile(formattedPlan)],
      [FRAME_REPAIR_INTEGRITY_FILES.target_before, pendingFile(buffers.target_before)],
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_mask, pendingFile(buffers.frame_repair_mask)],
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context_image, pendingFile(buffers.frame_repair_context_image)],
      [FRAME_REPAIR_INTEGRITY_FILES.raw_provider_output, pendingFile(buffers.raw_provider_output)],
      [FRAME_REPAIR_INTEGRITY_FILES.normalized_candidate_frame, pendingFile(buffers.normalized_candidate_frame)],
      [FRAME_REPAIR_INTEGRITY_FILES.composited_candidate_frame, pendingFile(buffers.composited_candidate_frame)],
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_difference, pendingFile(buffers.frame_repair_difference)],
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_quality, pendingFile(formattedQuality)],
      [FRAME_REPAIR_INTEGRITY_FILES.frame_repair_prompt, pendingFile(buffers.frame_repair_prompt)],
      [FRAME_REPAIR_INTEGRITY_FILES.patched_normalized_sheet, pendingFile(buffers.patched_normalized_sheet)],
    ]),
  }
}

function validatePlanContextBindings(plan, context) {
  const bindingsMatch = plan?.project?.id === context.project_id &&
    plan.project.revision === context.project_revision &&
    plan?.asset?.id === context.asset_id &&
    plan.asset.parent_revision_id === context.parent_revision_id &&
    plan?.profile?.id === context.profile &&
    sameJson(plan.profile.frame_size, context.frame_size) &&
    plan?.clip?.id === context.clip_id &&
    plan.clip.position === context.clip_frame_position &&
    plan.clip.sheet_frame_index === context.sheet_frame_index &&
    sameJson(plan.clip.context_frames, context.context_frames) &&
    plan.parent_sheet_sha256 === context.parent_sheet_sha256 &&
    plan.target_frame_sha256 === context.target_frame_sha256 &&
    plan?.references?.context_sha256 === context.reference_context_sha256 &&
    sameJson(plan.references.input_reference_roles, context.input_reference_roles) &&
    plan?.mask?.sha256 === context.mask_sha256 &&
    sameJson(plan.provider, context.provider_preset) &&
    plan.max_provider_calls === context.provider_call_budget &&
    plan.implementation_revision === context.implementation_revision
  if (!bindingsMatch) failIntegrity()
}

function standardContentBytes(content) {
  const bytes = Buffer.isBuffer(content)
    ? content
    : formattedJsonBytes(snapshotSafeJson(content, { maxBytes: MAX_STANDARD_FILE_BYTES }))
  if (bytes.length === 0 || bytes.length > MAX_STANDARD_FILE_BYTES) failIntegrity()
  return bytes
}

function prepareStandardFiles(jobId, characterResult) {
  let manifest
  try {
    manifest = buildCharacterPackArtifactManifest(jobId, characterResult)
  } catch {
    failIntegrity()
  }
  if (!isStrictPlainObject(manifest) || !Array.isArray(manifest.files)) failIntegrity()
  const files = new Map()
  let totalBytes = 0
  for (const file of manifest.files) {
    if (!isStrictPlainObject(file) || !safeManifestName(file.name) || files.has(file.name)) failIntegrity()
    const bytes = standardContentBytes(file.content)
    totalBytes += bytes.length
    if (totalBytes > MAX_STANDARD_TOTAL_BYTES) failIntegrity()
    files.set(file.name, pendingFile(bytes))
  }
  for (const key of STANDARD_FIXED_KEYS) {
    if (!files.has(FRAME_REPAIR_INTEGRITY_FILES[key])) failIntegrity()
  }
  return files
}

function hasParentEscape(relative) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function sameIdentity(left, right) {
  return Boolean(left && right) && left.realPath === right.realPath &&
    left.dev === right.dev && left.ino === right.ino
}

function sameFileIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

async function assertJobDirectory(generatedDir, jobDir, jobId, expectedIdentity = null) {
  let rootStats
  let jobStats
  let realRoot
  let realJob
  try {
    ;[rootStats, jobStats] = await Promise.all([lstat(generatedDir), lstat(jobDir)])
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory() ||
        jobStats.isSymbolicLink() || !jobStats.isDirectory()) failIntegrity()
    ;[realRoot, realJob] = await Promise.all([realpath(generatedDir), realpath(jobDir)])
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    failIntegrity()
  }
  const relative = path.relative(realRoot, realJob)
  if (relative !== jobId || hasParentEscape(relative)) failIntegrity()
  let realJobStats
  try {
    realJobStats = await stat(realJob)
  } catch {
    failIntegrity()
  }
  if (jobStats.dev !== realJobStats.dev || jobStats.ino !== realJobStats.ino) failIntegrity()
  const identity = Object.freeze({ realPath: realJob, dev: realJobStats.dev, ino: realJobStats.ino })
  if (expectedIdentity && !sameIdentity(identity, expectedIdentity)) failIntegrity()
  return identity
}

async function createPreviewDirectories(jobDir, fileNames) {
  const directories = [...new Set(fileNames
    .map((fileName) => path.posix.dirname(fileName))
    .filter((directory) => directory !== '.'))].sort()
  for (const directory of directories) {
    if (!ALLOWED_NESTED_PREVIEW_DIRS.has(directory)) failIntegrity()
    try {
      await mkdir(path.join(jobDir, directory))
    } catch {
      failIntegrity()
    }
    let value
    try {
      value = await lstat(path.join(jobDir, directory))
    } catch {
      failIntegrity()
    }
    if (value.isSymbolicLink() || !value.isDirectory()) failIntegrity()
  }
}

async function writeExclusive(jobDir, fileName, pending) {
  let handle
  try {
    if (!hasExactKeys(pending, ['content', 'size', 'sha256']) ||
        !Buffer.isBuffer(pending.content) || !isPositiveInteger(pending.size) ||
        !SHA256_PATTERN.test(pending.sha256)) failIntegrity()
    const writeSnapshot = Buffer.from(pending.content)
    if (writeSnapshot.length !== pending.size || sha256(writeSnapshot) !== pending.sha256) failIntegrity()
    const parentPath = path.dirname(path.join(jobDir, fileName))
    const parentBefore = await lstat(parentPath)
    if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) failIntegrity()
    handle = await open(
      path.join(jobDir, fileName),
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW_FLAG,
      0o600,
    )
    const parentOpened = await lstat(parentPath)
    if (parentOpened.isSymbolicLink() || !parentOpened.isDirectory() ||
        !sameFileIdentity(parentBefore, parentOpened)) failIntegrity()
    const before = await handle.stat()
    if (!before.isFile() || before.size !== 0) failIntegrity()
    await handle.writeFile(writeSnapshot)
    const after = await handle.stat()
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
        after.size !== writeSnapshot.length) failIntegrity()
    const parentAfter = await lstat(parentPath)
    if (parentAfter.isSymbolicLink() || !parentAfter.isDirectory() ||
        !sameFileIdentity(parentBefore, parentAfter)) failIntegrity()
    await handle.close()
    handle = null
  } catch {
    failIntegrity()
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The public error is intentionally normalized by the caller.
      }
    }
  }
}

function manifestFromCaptured(captured) {
  return captured.map((entry) => Object.freeze({
    key: entry.key,
    file_name: entry.file_name,
    size: entry.content.length,
    sha256: sha256(entry.content),
  }))
}

function maxCapturedFileBytes(key) {
  if (key === 'frame_repair_context') return MAX_CONTEXT_BYTES
  if (key === 'frame_repair_plan') return MAX_PLAN_JSON_BYTES
  if (key === 'frame_repair_quality') return MAX_QUALITY_JSON_BYTES
  if (key === 'frame_repair_prompt') return MAX_PROMPT_BYTES
  if (PNG_EVIDENCE_KEYS.includes(key)) return MAX_EVIDENCE_PNG_BYTES
  return MAX_STANDARD_FILE_BYTES
}

async function captureFixedArtifacts(generatedDir, jobId, keys = Object.keys(FRAME_REPAIR_INTEGRITY_FILES)) {
  const allowedFiles = new Set(Object.values(FRAME_REPAIR_INTEGRITY_FILES))
  let jobDir
  try {
    jobDir = resolveGeneratedJobDir(jobId, { generatedDir })
  } catch {
    failIntegrity()
  }
  const captured = []
  let capturedBytes = 0
  for (const key of keys) {
    const fileName = FRAME_REPAIR_INTEGRITY_FILES[key]
    let filePath
    let lexicalStats
    let fileStats
    let content
    let handle
    try {
      lexicalStats = await lstat(path.join(jobDir, fileName))
      if (lexicalStats.isSymbolicLink() || !lexicalStats.isFile()) failIntegrity()
      filePath = await resolveGeneratedJobArtifactFile({
        jobId,
        fileName,
        allowedFiles,
        generatedDir,
      })
      handle = await open(filePath, fsConstants.O_RDONLY | NO_FOLLOW_FLAG)
      fileStats = await handle.stat()
      if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > maxCapturedFileBytes(key)) {
        failIntegrity()
      }
      if (lexicalStats.dev !== fileStats.dev || lexicalStats.ino !== fileStats.ino) failIntegrity()
      content = await handle.readFile()
      const [finalHandleStats, finalLexicalStats] = await Promise.all([
        handle.stat(),
        lstat(path.join(jobDir, fileName)),
      ])
      if (finalLexicalStats.isSymbolicLink() || !finalLexicalStats.isFile() ||
          finalLexicalStats.dev !== fileStats.dev || finalLexicalStats.ino !== fileStats.ino ||
          finalHandleStats.dev !== fileStats.dev || finalHandleStats.ino !== fileStats.ino ||
          finalHandleStats.size !== fileStats.size || finalHandleStats.mtimeMs !== fileStats.mtimeMs ||
          finalHandleStats.ctimeMs !== fileStats.ctimeMs) failIntegrity()
      await handle.close()
      handle = null
    } catch (error) {
      if (error?.code === 'artifact_integrity_failed') throw error
      failIntegrity()
    } finally {
      if (handle) {
        try {
          await handle.close()
        } catch {
          // The public error is intentionally normalized by the caller.
        }
      }
    }
    if (content.length !== fileStats.size) failIntegrity()
    capturedBytes += content.length
    if (capturedBytes > MAX_CAPTURE_TOTAL_BYTES) failIntegrity()
    captured.push(Object.freeze({ key, file_name: fileName, content }))
  }
  return captured
}

function sanitizeManifest(value, { includeContext }) {
  const expectedKeys = Object.keys(FRAME_REPAIR_INTEGRITY_FILES)
    .filter((key) => includeContext || key !== 'frame_repair_context')
  if (!isDenseArray(value) || value.length !== expectedKeys.length) failIntegrity()
  return Object.freeze(value.map((entry, index) => {
    const key = expectedKeys[index]
    if (!hasExactKeys(entry, ['key', 'file_name', 'size', 'sha256']) ||
        entry.key !== key || entry.file_name !== FRAME_REPAIR_INTEGRITY_FILES[key] ||
        !isPositiveInteger(entry.size) || !SHA256_PATTERN.test(entry.sha256)) failIntegrity()
    return Object.freeze({ key, file_name: entry.file_name, size: entry.size, sha256: entry.sha256 })
  }))
}

function parseContext(content, jobIdentity) {
  if (!Buffer.isBuffer(content) || content.length === 0 || content.length > MAX_CONTEXT_BYTES) failIntegrity()
  let parsed
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch {
    failIntegrity()
  }
  if (!isStrictPlainObject(parsed) || !Object.hasOwn(parsed, 'sealed_artifacts')) failIntegrity()
  const base = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'sealed_artifacts'))
  const validatedBase = validateContextBase(base, jobIdentity)
  const sealed = sanitizeManifest(parsed.sealed_artifacts, { includeContext: false })
  return { base: validatedBase, sealed }
}

function validateJobUrls(job, jobId) {
  const expected = urlsForJob(jobId)
  const expectedKeys = new Set(Object.keys(expected))
  for (const [key, value] of Object.entries(expected)) {
    if (job[key] !== value) failIntegrity()
  }
  for (const key of Object.keys(job)) {
    if (key.endsWith('_url') && !expectedKeys.has(key)) failIntegrity()
  }
  return expected
}

async function reconstructActualManifest({ generatedDir, jobId, jobIdentity = null }) {
  const captured = await captureFixedArtifacts(generatedDir, jobId)
  const manifest = Object.freeze(manifestFromCaptured(captured))
  const contextEntry = captured.find((entry) => entry.key === 'frame_repair_context')
  let resolvedJobIdentity = jobIdentity
  if (!resolvedJobIdentity) {
    let rawContext
    try {
      rawContext = JSON.parse(contextEntry.content.toString('utf8'))
    } catch {
      failIntegrity()
    }
    resolvedJobIdentity = validateJobIdentity({ id: jobId, created_at: rawContext?.submitted_at })
  }
  const context = parseContext(contextEntry.content, resolvedJobIdentity)
  const inner = Object.freeze(manifest.filter((entry) => entry.key !== 'frame_repair_context'))
  if (!sameJson(context.sealed, inner)) failIntegrity()
  return { captured, manifest, context, jobIdentity: resolvedJobIdentity }
}

export async function writeFrameRepairArtifacts({
  generatedDir,
  job,
  characterResult,
  evidence,
} = {}) {
  try {
    const jobIdentity = validateJobIdentity(job)
    let jobDir
    try {
      jobDir = resolveGeneratedJobDir(jobIdentity.id, { generatedDir })
    } catch {
      failIntegrity()
    }
    const standardFiles = prepareStandardFiles(jobIdentity.id, characterResult)
    const preparedEvidence = prepareEvidence(evidence, jobIdentity)
    const directoryIdentity = await assertJobDirectory(generatedDir, jobDir, jobIdentity.id)
    for (const fileName of preparedEvidence.files.keys()) {
      if (standardFiles.has(fileName)) failIntegrity()
    }
    const allWritable = new Map([...standardFiles, ...preparedEvidence.files])
    if (allWritable.has(FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context)) failIntegrity()
    await createPreviewDirectories(jobDir, [...allWritable.keys()])
    await assertJobDirectory(generatedDir, jobDir, jobIdentity.id, directoryIdentity)
    for (const [fileName, pending] of allWritable) {
      await assertJobDirectory(generatedDir, jobDir, jobIdentity.id, directoryIdentity)
      await writeExclusive(jobDir, fileName, pending)
    }
    allWritable.clear()
    standardFiles.clear()
    preparedEvidence.files.clear()
    const innerKeys = Object.keys(FRAME_REPAIR_INTEGRITY_FILES)
      .filter((key) => key !== 'frame_repair_context')
    const innerCaptured = await captureFixedArtifacts(generatedDir, jobIdentity.id, innerKeys)
    const innerManifest = Object.freeze(manifestFromCaptured(innerCaptured))
    innerCaptured.length = 0
    const context = { ...preparedEvidence.contextBase, sealed_artifacts: innerManifest }
    const contextBytes = formattedJsonBytes(context)
    if (contextBytes.length > MAX_CONTEXT_BYTES) failIntegrity()
    await writeExclusive(
      jobDir,
      FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context,
      pendingFile(contextBytes),
    )
    await assertJobDirectory(generatedDir, jobDir, jobIdentity.id, directoryIdentity)
    const outerCaptured = await captureFixedArtifacts(generatedDir, jobIdentity.id)
    const outerManifest = Object.freeze(manifestFromCaptured(outerCaptured))
    outerCaptured.length = 0
    const outerWithoutContext = outerManifest.filter((entry) => entry.key !== 'frame_repair_context')
    if (!sameJson(outerWithoutContext, innerManifest)) failIntegrity()
    const artifactManifestSha256 = sha256(stableBytes(outerManifest))
    return deepFreeze({
      job_id: jobIdentity.id,
      created_at: jobIdentity.created_at,
      status: 'done',
      reason: null,
      retry_hint: null,
      ...urlsForJob(jobIdentity.id),
      artifact_integrity_manifest: outerManifest,
      artifact_manifest_sha256: artifactManifestSha256,
    })
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    throw artifactIntegrityError()
  }
}

export async function verifySealedFrameRepairArtifacts({ generatedDir, job } = {}) {
  try {
    const jobIdentity = validateJobIdentity(job)
    validateJobUrls(job, jobIdentity.id)
    const expectedManifest = sanitizeManifest(job.artifact_integrity_manifest, { includeContext: true })
    if (!SHA256_PATTERN.test(job.artifact_manifest_sha256) ||
        sha256(stableBytes(expectedManifest)) !== job.artifact_manifest_sha256) failIntegrity()
    const actual = await reconstructActualManifest({ generatedDir, jobId: jobIdentity.id, jobIdentity })
    if (!sameJson(actual.manifest, expectedManifest)) failIntegrity()
    return Object.freeze(actual.captured.map((entry) => Object.freeze({
      key: entry.key,
      file_name: entry.file_name,
      size: entry.content.length,
      sha256: sha256(entry.content),
      content: Buffer.from(entry.content),
    })))
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    throw artifactIntegrityError()
  }
}

export async function recoverSealedFrameRepairArtifacts({
  generatedDir,
  jobId,
  expectedManifestSha256,
} = {}) {
  try {
    if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId) ||
        !SHA256_PATTERN.test(expectedManifestSha256)) failIntegrity()
    const actual = await reconstructActualManifest({ generatedDir, jobId })
    const digest = sha256(stableBytes(actual.manifest))
    if (digest !== expectedManifestSha256) failIntegrity()
    return deepFreeze({
      job_id: jobId,
      artifact_manifest_sha256: digest,
      manifest: actual.manifest,
      ...urlsForJob(jobId),
    })
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    throw artifactIntegrityError()
  }
}
