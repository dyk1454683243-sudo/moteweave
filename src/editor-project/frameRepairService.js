import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { MAX_MANAGED_NORMALIZED_PNG_BYTES } from './normalizedCharacterSheetPackage.js'
import {
  FRAME_REPAIR_INTEGRITY_FILES,
  recoverSealedFrameRepairArtifacts,
} from './frameRepairArtifacts.js'
import {
  buildFrameRepairMaskVisualization,
  buildFrameRepairQualityReport,
  extractFrameRgba,
  runsToBitset,
  verifyFrameRepairIntegrity,
} from './frameRepairComposite.js'
import { hashFrameRepairPlan, hashFrameRepairReferenceContext } from './frameRepairPlan.js'
import { buildFrameRepairPrompt } from './frameRepairProvider.js'
import {
  buildFrameRepairProviderDiagnostic,
  classifyFrameRepairProviderFailure,
  frameRepairProviderOutputCode,
  isFrameRepairProviderOutputFailure,
} from './frameRepairProviderDiagnostics.js'
import { writeFrameRepairProviderFailureArtifacts } from './frameRepairProviderFailureArtifacts.js'
import { isFrameRepairOperationId } from './frameRepairProtocol.js'
import { resolveGeneratedJobDir } from './paths.js'
import { ID_PATTERN, JOB_ID_PATTERN } from './constants.js'
import { isBase64Payload, isIsoTimestamp, isSafeRelativePath, isSecretLikeValue } from './safety.js'

const INPUT_KEYS = Object.freeze([
  'identity', 'plan', 'providerPreset', 'parentSheetBuffer', 'targetFrame',
  'referenceImages', 'parentAnimations', 'parentMetadata', 'lineage',
])
const IDENTITY_KEYS = Object.freeze([
  'project_id', 'project_revision', 'asset_id', 'parent_revision_id', 'operation_id', 'plan_hash',
])
const PLAN_KEYS = Object.freeze([
  'version', 'project', 'asset', 'profile', 'clip', 'parent_sheet_sha256',
  'target_frame_sha256', 'references', 'mask', 'instruction', 'provider',
  'estimated_provider_calls', 'max_provider_calls', 'implementation_revision',
])
const PLAN_CLIP_KEYS = Object.freeze([
  'id', 'frames', 'position', 'sheet_frame_index', 'context_frames',
])
const PLAN_MASK_KEYS = Object.freeze([
  'width', 'height', 'source', 'confidence', 'runs', 'activePixelCount', 'sha256',
])
const REFERENCE_KEYS = Object.freeze(['role', 'name', 'mimeType', 'buffer'])
const REFERENCE_ROLE_ORDER = Object.freeze([
  'target_enlarged', 'mask_visualization', 'clip_context', 'full_sheet',
])
const LINEAGE_KEYS = Object.freeze([
  'project_id', 'asset_id', 'parent_revision_id', 'parent_job_id',
  'parent_processing_recipe_ref',
])
const DIRECT_COMPOSITE_KEYS = Object.freeze(['sheet', 'before', 'after', 'integrity'])
const PUBLIC_SCALARS = Object.freeze([
  'id', 'status', 'created_at', 'updated_at', 'type',
  'project_id', 'project_revision', 'asset_id', 'parent_revision_id',
  'operation_id', 'plan_hash', 'implementation_revision',
  'provider_call_budget', 'provider_calls_used', 'generated_candidate_count',
  'quality_status', 'reason', 'retry_hint', 'recovery_state',
  'artifact_manifest_sha256',
])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const QUALITY_STATUSES = new Set(['pass', 'warning', 'fail', 'unknown'])
const MAX_PROVIDER_BYTES = 32 * 1024 * 1024
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024
const MAX_PRIVATE_BYTES = 128 * 1024 * 1024
const MAX_PRIVATE_NODES = 30_000
const MAX_PRIVATE_DEPTH = 32
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'([{])(?:\/{1,2}(?=\S)|~\/(?=\S)|[A-Za-z]:[\\/](?=\S)|\\\\(?=\S))/
const EXTERNAL_URL_PATTERN = /\b(?:https?|ftp|file):\/\/\S+/i
const RELATIVE_ESCAPE_PATTERN = /(?:^|[\s"'([{\\/])\.\.(?:[\\/]|$)/
const BASE64_TEXT_PATTERN = /(?:^|\s)[A-Za-z0-9+/]{64,}={0,2}(?:$|\s)/

function serviceError(code, message) {
  return Object.assign(new Error(message), { code })
}

function fail(code, message) {
  throw serviceError(code, message)
}

function isStrictPlainObject(value) {
  return Boolean(value) && typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, keys) {
  if (!isStrictPlainObject(value)) return false
  const enumerable = Object.keys(value)
  const own = Reflect.ownKeys(value)
  return enumerable.length === keys.length && own.length === keys.length &&
    own.every((key) => typeof key === 'string') && keys.every((key) => Object.hasOwn(value, key))
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function validId(value) {
  return typeof value === 'string' && value.length <= 128 && ID_PATTERN.test(value)
}

function validJobId(value) {
  return typeof value === 'string' && value.length <= 128 && JOB_ID_PATTERN.test(value)
}

function isPngBuffer(value) {
  return Buffer.isBuffer(value) && value.length > PNG_SIGNATURE.length &&
    value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function snapshotPrivate(value, {
  state = { nodes: 0, bytes: 0 },
  depth = 0,
  seen = new Set(),
} = {}) {
  state.nodes += 1
  if (state.nodes > MAX_PRIVATE_NODES || depth > MAX_PRIVATE_DEPTH) {
    fail('invalid_frame_repair_service_input', 'frame repair private input exceeds its structural limit')
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_frame_repair_service_input', 'non-finite values are forbidden')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      fail('invalid_frame_repair_service_input', 'unsafe string value is forbidden')
    }
    state.bytes += Buffer.byteLength(value, 'utf8')
    if (state.bytes > MAX_PRIVATE_BYTES) fail('invalid_frame_repair_service_input', 'private input is too large')
    return value
  }
  if (Buffer.isBuffer(value)) {
    state.bytes += value.length
    if (state.bytes > MAX_PRIVATE_BYTES) fail('invalid_frame_repair_service_input', 'private input is too large')
    return Buffer.from(value)
  }
  if (value instanceof Uint8ClampedArray || value instanceof Uint8Array) {
    state.bytes += value.byteLength
    if (state.bytes > MAX_PRIVATE_BYTES) fail('invalid_frame_repair_service_input', 'private input is too large')
    return new value.constructor(value)
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    fail('invalid_frame_repair_service_input', 'private input is not snapshot-safe')
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (!isDenseArray(value)) fail('invalid_frame_repair_service_input', 'sparse arrays are forbidden')
      const descriptors = Object.getOwnPropertyDescriptors(value)
      if (Object.entries(descriptors).some(([key, descriptor]) =>
        key !== 'length' && (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true))) {
        fail('invalid_frame_repair_service_input', 'array accessors are forbidden')
      }
      return value.map((item) => snapshotPrivate(item, { state, depth: depth + 1, seen }))
    }
    if (!isStrictPlainObject(value)) fail('invalid_frame_repair_service_input', 'plain input is required')
    const keys = Reflect.ownKeys(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (keys.some((key) => typeof key !== 'string') || Object.keys(value).length !== keys.length ||
        keys.some((key) => key.length === 0 || key.length > 240) ||
        keys.some((key) => !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) {
      fail('invalid_frame_repair_service_input', 'private input keys are invalid')
    }
    return Object.fromEntries(keys.map((key) => [
      key,
      snapshotPrivate(value[key], { state, depth: depth + 1, seen }),
    ]))
  } finally {
    seen.delete(value)
  }
}

function clonePlainInput(value) {
  const cloned = snapshotPrivate(value)
  if (!isStrictPlainObject(cloned)) fail('invalid_frame_repair_service_input', 'plain input is required')
  return cloned
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isStrictPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

function stableBytes(value) {
  return Buffer.from(JSON.stringify(stableValue(value)), 'utf8')
}

function sameJson(left, right) {
  return stableBytes(left).equals(stableBytes(right))
}

function validateReferences(referenceImages, plan) {
  if (!isDenseArray(referenceImages) || referenceImages.length < 3 || referenceImages.length > 4 ||
      !isDenseArray(plan?.references?.items) ||
      plan.references.items.length !== referenceImages.length ||
      !isDenseArray(plan.references.input_reference_roles) ||
      plan.references.input_reference_roles.length !== referenceImages.length) {
    fail('invalid_frame_repair_service_input', 'frame repair references are invalid')
  }
  let totalBytes = 0
  return referenceImages.map((image, index) => {
    const planItem = plan.references.items[index]
    if (!hasExactKeys(image, REFERENCE_KEYS) || typeof image.role !== 'string' ||
        image.role !== REFERENCE_ROLE_ORDER[index] ||
        image.role !== plan.references.input_reference_roles[index] ||
        typeof image.name !== 'string' || !SAFE_NAME_PATTERN.test(image.name) ||
        !MIME_TYPES.has(image.mimeType) || image.mimeType !== 'image/png' ||
        !isPngBuffer(image.buffer) ||
        !isStrictPlainObject(planItem) || planItem.role !== image.role || planItem.name !== image.name ||
        !SHA256_PATTERN.test(planItem.sha256) || sha256(image.buffer) !== planItem.sha256) {
      fail('invalid_frame_repair_service_input', 'frame repair reference authority is invalid')
    }
    totalBytes += image.buffer.length
    if (image.buffer.length > MAX_REFERENCE_BYTES || totalBytes > MAX_REFERENCE_BYTES) {
      fail('invalid_frame_repair_service_input', 'frame repair references exceed their byte limit')
    }
    return Object.freeze({
      role: image.role,
      name: image.name,
      mimeType: image.mimeType,
      buffer: Buffer.from(image.buffer),
    })
  })
}

function validateCanonicalMask(mask, frameSize) {
  if (!hasExactKeys(mask, PLAN_MASK_KEYS) || mask.width !== frameSize.w ||
      mask.height !== frameSize.h ||
      !['localized_diagnostic', 'localized_plus_user_edits', 'user_scoped'].includes(mask.source) ||
      !['high', 'needs_scope', 'user_confirmed'].includes(mask.confidence) ||
      !isDenseArray(mask.runs) || mask.runs.length === 0) return false
  const pixelCount = mask.width * mask.height
  let previousEnd = -2
  let activePixelCount = 0
  for (const run of mask.runs) {
    if (!hasExactKeys(run, ['start', 'length']) ||
        !Number.isSafeInteger(run.start) || run.start < 0 ||
        !Number.isSafeInteger(run.length) || run.length <= 0 ||
        run.start <= previousEnd + 1 || run.start >= pixelCount ||
        run.length > pixelCount - run.start) return false
    previousEnd = run.start + run.length - 1
    activePixelCount += run.length
  }
  return activePixelCount > 0 && mask.activePixelCount === activePixelCount &&
    mask.sha256 === hashFrameRepairPlan({ width: mask.width, height: mask.height, runs: mask.runs })
}

function validateCanonicalPlan(plan, identity, snapshot) {
  if (!hasExactKeys(plan, PLAN_KEYS) || plan.version !== 'frame_repair_plan_v1' ||
      !hasExactKeys(plan.project, ['id', 'revision']) ||
      !hasExactKeys(plan.asset, ['id', 'parent_revision_id']) ||
      !hasExactKeys(plan.profile, ['id', 'frame_size']) ||
      !hasExactKeys(plan.profile.frame_size, ['w', 'h']) ||
      !hasExactKeys(plan.clip, PLAN_CLIP_KEYS) || !hasExactKeys(plan.references, [
        'input_reference_roles', 'context_sha256', 'items',
      ]) || !hasExactKeys(plan.provider, ['id', 'provider', 'label', 'model', 'image_config']) ||
      !hasExactKeys(plan.provider.image_config, ['image_size', 'aspect_ratio'])) return false
  const normalizedInstruction = typeof plan.instruction === 'string'
    ? plan.instruction.normalize('NFC').trim()
    : null
  if (normalizedInstruction === null || normalizedInstruction !== plan.instruction ||
      [...normalizedInstruction].length === 0 || [...normalizedInstruction].length > 500 ||
      /\p{Cc}/u.test(normalizedInstruction) || ABSOLUTE_PATH_PATTERN.test(normalizedInstruction) ||
      EXTERNAL_URL_PATTERN.test(normalizedInstruction) ||
      RELATIVE_ESCAPE_PATTERN.test(normalizedInstruction) ||
      BASE64_TEXT_PATTERN.test(normalizedInstruction) || isBase64Payload(normalizedInstruction) ||
      isSecretLikeValue(normalizedInstruction) ||
      typeof plan.provider.label !== 'string' || plan.provider.label.trim() !== plan.provider.label ||
      plan.provider.label.length === 0 || /\p{Cc}/u.test(plan.provider.label) ||
      typeof plan.provider.model !== 'string' || plan.provider.model.trim() !== plan.provider.model ||
      plan.provider.model.length === 0 || /\p{Cc}/u.test(plan.provider.model) ||
      typeof plan.provider.image_config.aspect_ratio !== 'string' ||
      plan.provider.image_config.aspect_ratio.trim() !== plan.provider.image_config.aspect_ratio ||
      plan.provider.image_config.aspect_ratio.length === 0 ||
      /\p{Cc}/u.test(plan.provider.image_config.aspect_ratio)) return false
  if (!isDenseArray(plan.clip.frames) || plan.clip.frames.length === 0 ||
      plan.clip.frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0) ||
      !Number.isSafeInteger(plan.clip.position) || plan.clip.position < 0 ||
      plan.clip.position >= plan.clip.frames.length ||
      plan.clip.frames[plan.clip.position] !== plan.clip.sheet_frame_index ||
      !isDenseArray(plan.clip.context_frames) || plan.clip.context_frames.length > 2) return false
  let priorPosition = -1
  for (const item of plan.clip.context_frames) {
    if (!hasExactKeys(item, ['position', 'sheet_frame_index', 'sha256']) ||
        !Number.isSafeInteger(item.position) || item.position <= priorPosition ||
        item.position === plan.clip.position || item.position >= plan.clip.frames.length ||
        item.sheet_frame_index !== plan.clip.frames[item.position] ||
        !SHA256_PATTERN.test(item.sha256)) return false
    priorPosition = item.position
  }
  if (!isDenseArray(plan.references.items) || !isDenseArray(plan.references.input_reference_roles) ||
      plan.references.items.length < 3 || plan.references.items.length > 4 ||
      plan.references.items.length !== plan.references.input_reference_roles.length) return false
  for (let index = 0; index < plan.references.items.length; index += 1) {
    const item = plan.references.items[index]
    if (!hasExactKeys(item, ['role', 'name', 'sha256']) ||
        item.role !== REFERENCE_ROLE_ORDER[index] ||
        plan.references.input_reference_roles[index] !== item.role ||
        !SAFE_NAME_PATTERN.test(item.name) || !SHA256_PATTERN.test(item.sha256)) return false
  }
  const targetBytes = Buffer.from(
    snapshot.targetFrame.data.buffer,
    snapshot.targetFrame.data.byteOffset,
    snapshot.targetFrame.data.byteLength,
  )
  return validateCanonicalMask(plan.mask, plan.profile.frame_size) &&
    hashFrameRepairPlan(plan) === identity.plan_hash &&
    sha256(snapshot.parentSheetBuffer) === plan.parent_sheet_sha256 &&
    sha256(targetBytes) === plan.target_frame_sha256 &&
    hashFrameRepairReferenceContext(plan.references.items) === plan.references.context_sha256
}

function validatePrivateInput(value) {
  if (!hasExactKeys(value, INPUT_KEYS)) {
    fail('invalid_frame_repair_service_input', 'frame repair private input fields are invalid')
  }
  const snapshot = clonePlainInput(value)
  const { identity, plan, providerPreset } = snapshot
  const runtimeImageConfig = isStrictPlainObject(providerPreset?.imageConfig)
    ? providerPreset.imageConfig
    : providerPreset?.image_config
  if (!hasExactKeys(identity, IDENTITY_KEYS) || !validId(identity.project_id) ||
      !Number.isSafeInteger(identity.project_revision) || identity.project_revision < 0 ||
      !validId(identity.asset_id) || !validId(identity.parent_revision_id) ||
      !isFrameRepairOperationId(identity.operation_id) || !SHA256_PATTERN.test(identity.plan_hash) ||
      !isStrictPlainObject(plan) || plan.version !== 'frame_repair_plan_v1' ||
      !isStrictPlainObject(plan.project) || !isStrictPlainObject(plan.asset) ||
      !isStrictPlainObject(plan.profile) || !isStrictPlainObject(plan.profile.frame_size) ||
      plan.profile.id !== TOPDOWN_RPG_V0.id ||
      !sameJson(plan.profile.frame_size, TOPDOWN_RPG_V0.frame) ||
      !Number.isSafeInteger(plan.profile.frame_size.w) || plan.profile.frame_size.w <= 0 ||
      !Number.isSafeInteger(plan.profile.frame_size.h) || plan.profile.frame_size.h <= 0 ||
      !isStrictPlainObject(plan.clip) || !isDenseArray(plan.clip.context_frames) ||
      !validId(plan.clip.id) || !Number.isSafeInteger(plan.clip.position) || plan.clip.position < 0 ||
      !Number.isSafeInteger(plan.clip.sheet_frame_index) || plan.clip.sheet_frame_index < 0 ||
      !isStrictPlainObject(plan.references) || !isStrictPlainObject(plan.mask) ||
      !isStrictPlainObject(plan.provider) || !isStrictPlainObject(plan.provider.image_config) ||
      !hasExactKeys(plan.provider.image_config, ['image_size', 'aspect_ratio']) ||
      !['1K', '2K'].includes(plan.provider.image_config.image_size) ||
      typeof plan.provider.image_config.aspect_ratio !== 'string' ||
      plan.provider.image_config.aspect_ratio.length === 0 ||
      plan.provider.image_config.aspect_ratio.length > 80 ||
      !validId(plan.provider.id) || !validId(plan.provider.provider) ||
      typeof plan.provider.label !== 'string' || plan.provider.label.length === 0 ||
      plan.provider.label.length > 240 || typeof plan.provider.model !== 'string' ||
      plan.provider.model.length === 0 || plan.provider.model.length > 240 ||
      typeof plan.implementation_revision !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(plan.implementation_revision) ||
      plan.mask.width !== plan.profile.frame_size.w ||
      plan.mask.height !== plan.profile.frame_size.h ||
      plan?.project?.id !== identity.project_id || plan.project.revision !== identity.project_revision ||
      plan?.asset?.id !== identity.asset_id ||
      plan.asset.parent_revision_id !== identity.parent_revision_id ||
      plan.max_provider_calls !== 1 || plan.estimated_provider_calls !== 1 ||
      !isStrictPlainObject(providerPreset) || providerPreset.available !== true ||
      typeof providerPreset.apiKey !== 'string' || providerPreset.apiKey.length === 0 ||
      providerPreset.id !== plan?.provider?.id || providerPreset.provider !== plan.provider.provider ||
      providerPreset.label !== plan.provider.label || providerPreset.model !== plan.provider.model ||
      !isStrictPlainObject(runtimeImageConfig) ||
      !sameJson(runtimeImageConfig, plan.provider.image_config) ||
      !isPngBuffer(snapshot.parentSheetBuffer) ||
      snapshot.parentSheetBuffer.length > MAX_MANAGED_NORMALIZED_PNG_BYTES ||
      !hasExactKeys(snapshot.targetFrame, ['width', 'height', 'data']) ||
      snapshot.targetFrame.width !== plan.profile.frame_size.w ||
      snapshot.targetFrame.height !== plan.profile.frame_size.h ||
      !(snapshot.targetFrame.data instanceof Uint8ClampedArray) ||
      snapshot.targetFrame.data.length !== snapshot.targetFrame.width * snapshot.targetFrame.height * 4 ||
      !isStrictPlainObject(snapshot.parentAnimations) ||
      !isStrictPlainObject(snapshot.parentMetadata) ||
      snapshot.parentMetadata.profile !== TOPDOWN_RPG_V0.id ||
      typeof snapshot.parentMetadata.name !== 'string' ||
      snapshot.parentMetadata.name.trim().length === 0 || snapshot.parentMetadata.name.length > 160 ||
      (snapshot.parentMetadata.description != null &&
        (typeof snapshot.parentMetadata.description !== 'string' ||
          snapshot.parentMetadata.description.length > 1000)) ||
      !hasExactKeys(snapshot.lineage, LINEAGE_KEYS) ||
      snapshot.lineage.project_id !== identity.project_id ||
      snapshot.lineage.asset_id !== identity.asset_id ||
      snapshot.lineage.parent_revision_id !== identity.parent_revision_id ||
      !validJobId(snapshot.lineage.parent_job_id) ||
      (snapshot.lineage.parent_processing_recipe_ref !== null &&
        (typeof snapshot.lineage.parent_processing_recipe_ref !== 'string' ||
          snapshot.lineage.parent_processing_recipe_ref.length > 1000 ||
          !isSafeRelativePath(snapshot.lineage.parent_processing_recipe_ref) ||
          snapshot.lineage.parent_processing_recipe_ref !==
            `workspace/projects/${identity.project_id}/assets/${identity.asset_id}/${identity.parent_revision_id}/processing_recipe.json`))) {
    fail('invalid_frame_repair_service_input', 'frame repair private authority is invalid')
  }
  if (!validateCanonicalPlan(plan, identity, snapshot)) {
    fail('invalid_frame_repair_service_input', 'frame repair canonical plan authority is invalid')
  }
  const references = validateReferences(snapshot.referenceImages, plan)
  if (!isStrictPlainObject(snapshot.parentAnimations.sheet_size) ||
      !Number.isSafeInteger(snapshot.parentAnimations.sheet_size.w) ||
      snapshot.parentAnimations.sheet_size.w <= 0 ||
      !Number.isSafeInteger(snapshot.parentAnimations.sheet_size.h) ||
      snapshot.parentAnimations.sheet_size.h <= 0) {
    fail('invalid_frame_repair_service_input', 'parent sheet geometry is invalid')
  }
  const generation = Object.freeze({
    mode: 'editor_targeted_frame_repair',
    provider: plan.provider.provider,
    provider_preset_id: plan.provider.id,
    provider_label: plan.provider.label,
    model: plan.provider.model,
    image_config: Object.freeze({ ...plan.provider.image_config }),
  })
  const lookup = Object.freeze({
    project_id: identity.project_id,
    asset_id: identity.asset_id,
    operation_id: identity.operation_id,
  })
  return Object.freeze({ ...snapshot, referenceImages: Object.freeze(references), generation, lookup })
}

function validateCandidate(value, generation, plan) {
  const candidate = clonePlainInput(value)
  if (!Buffer.isBuffer(candidate.buffer) || candidate.buffer.length === 0 ||
      candidate.buffer.length > MAX_PROVIDER_BYTES ||
      candidate.prompt !== buildFrameRepairPrompt(plan) ||
      Buffer.byteLength(candidate.prompt, 'utf8') > 64 * 1024 ||
      candidate.provider !== generation.provider ||
      candidate.provider_preset_id !== generation.provider_preset_id ||
      candidate.provider_label !== generation.provider_label || candidate.model !== generation.model ||
      !sameJson(candidate.image_config, generation.image_config)) {
    fail('provider_candidate_invalid', 'frame repair provider result is invalid')
  }
  return candidate
}

function validateCompositeIntegrity(value) {
  if (!isStrictPlainObject(value) || value.non_target_equal !== true ||
      value.target_outside_mask_equal !== true ||
      !Number.isSafeInteger(value.actual_non_target_changed) || value.actual_non_target_changed !== 0 ||
      !Number.isSafeInteger(value.actual_outside_mask_changed) || value.actual_outside_mask_changed !== 0 ||
      !Number.isSafeInteger(value.attempted_outside_mask_changed) ||
      value.attempted_outside_mask_changed < 0 ||
      !Number.isSafeInteger(value.changed_inside_mask) || value.changed_inside_mask < 0) {
    fail('frame_repair_composite_integrity_failed', 'frame repair composite integrity is invalid')
  }
  return clonePlainInput(value)
}

function validateRgba(value, expectedSize = null) {
  const width = expectedSize?.w ?? value?.width
  const height = expectedSize?.h ?? value?.height
  if (!isStrictPlainObject(value) || !Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 || value.width !== width || value.height !== height ||
      !(value.data instanceof Uint8ClampedArray) || value.data.length !== width * height * 4) {
    fail('frame_repair_composite_integrity_failed', 'frame repair RGBA evidence is invalid')
  }
  return Object.freeze({ width, height, data: new Uint8ClampedArray(value.data) })
}

function cloneRgba(value) {
  return {
    width: value.width,
    height: value.height,
    data: new Uint8ClampedArray(value.data),
  }
}

function sameRgba(left, right) {
  return left.width === right.width && left.height === right.height &&
    left.data.length === right.data.length &&
    left.data.every((value, index) => value === right.data[index])
}

function differenceRgba(before, after) {
  const data = new Uint8ClampedArray(before.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      data[offset + channel] = Math.abs(before.data[offset + channel] - after.data[offset + channel])
      changed ||= data[offset + channel] !== 0
    }
    if (changed && data[offset + 3] === 0) data[offset + 3] = 255
  }
  return { width: before.width, height: before.height, data }
}

function referencePng(captured, role) {
  const reference = captured.referenceImages.find((item) => item.role === role)
  if (!reference || reference.mimeType !== 'image/png' || !isPngBuffer(reference.buffer)) {
    fail('frame_repair_composite_integrity_failed', 'frame repair reference PNG is unavailable')
  }
  return Buffer.from(reference.buffer)
}

async function validateComposite(value, { candidateFrame, parentSheet, captured }) {
  if (!hasExactKeys(value, DIRECT_COMPOSITE_KEYS)) {
    fail('frame_repair_composite_integrity_failed', 'frame repair composite result is invalid')
  }
  const frameSize = captured.plan.profile.frame_size
  const sheetSize = { w: parentSheet.width, h: parentSheet.height }
  const sheet = validateRgba(value.sheet, sheetSize)
  const before = validateRgba(value.before, frameSize)
  const after = validateRgba(value.after, frameSize)
  const candidate = validateRgba(candidateFrame, frameSize)
  const expectedBefore = extractFrameRgba(parentSheet, captured.plan.clip.sheet_frame_index, frameSize)
  const expectedAfter = extractFrameRgba(sheet, captured.plan.clip.sheet_frame_index, frameSize)
  if (!sameRgba(before, expectedBefore) || !sameRgba(after, expectedAfter)) {
    fail('frame_repair_composite_integrity_failed', 'frame repair composite frames are not sheet-bound')
  }
  const active = runsToBitset(captured.plan.mask.runs, frameSize.w * frameSize.h)
  const verified = verifyFrameRepairIntegrity({
    parentSheet,
    patchedSheet: sheet,
    candidateFrame: candidate,
    sheetFrameIndex: captured.plan.clip.sheet_frame_index,
    frameSize,
    active,
  })
  let changedInsideMask = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const offset = pixel * 4
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      changed ||= before.data[offset + channel] !== after.data[offset + channel]
    }
    if (changed) changedInsideMask += 1
  }
  const authoritativeIntegrity = { ...verified, changed_inside_mask: changedInsideMask }
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const offset = pixel * 4
    for (let channel = 0; channel < 4; channel += 1) {
      if (after.data[offset + channel] !== candidate.data[offset + channel]) {
        fail('frame_repair_composite_integrity_failed',
          'frame repair masked pixels do not match the normalized candidate')
      }
    }
  }
  if (!sameJson(value.integrity, authoritativeIntegrity)) {
    fail('frame_repair_composite_integrity_failed', 'frame repair composite counters are not authoritative')
  }
  const integrity = validateCompositeIntegrity(authoritativeIntegrity)
  const adjacentClipFrames = captured.plan.clip.context_frames.map((item) => ({
    role: item.position < captured.plan.clip.position ? 'previous' : 'next',
    frame: extractFrameRgba(parentSheet, item.sheet_frame_index, frameSize),
  }))
  const evidence = Object.freeze({
    target_before: await encodeRgbaPng(before),
    frame_repair_mask: await encodeRgbaPng(buildFrameRepairMaskVisualization(before, captured.plan.mask)),
    frame_repair_context_image: referencePng(captured, 'clip_context'),
    normalized_candidate_frame: await encodeRgbaPng(candidate),
    composited_candidate_frame: await encodeRgbaPng(after),
    frame_repair_difference: await encodeRgbaPng(differenceRgba(before, after)),
    patched_normalized_sheet: await encodeRgbaPng(sheet),
  })
  return Object.freeze({
    integrity,
    quality_inputs: Object.freeze({ before, after, candidate, adjacentClipFrames }),
    evidence,
  })
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function expectedUrls(jobId) {
  return Object.fromEntries(Object.entries(FRAME_REPAIR_INTEGRITY_FILES).map(([key, fileName]) => [
    `${key}_url`, `/generated/${jobId}/${fileName}`,
  ]))
}

function sanitizeManifest(value) {
  const expected = Object.entries(FRAME_REPAIR_INTEGRITY_FILES)
  if (!isDenseArray(value) || value.length !== expected.length) {
    fail('artifact_integrity_failed', 'frame repair artifact manifest is incomplete')
  }
  return Object.freeze(value.map((entry, index) => {
    const [key, fileName] = expected[index]
    if (!hasExactKeys(entry, ['key', 'file_name', 'size', 'sha256']) ||
        entry.key !== key || entry.file_name !== fileName ||
        !Number.isSafeInteger(entry.size) || entry.size <= 0 || !SHA256_PATTERN.test(entry.sha256)) {
      fail('artifact_integrity_failed', 'frame repair artifact manifest is invalid')
    }
    return Object.freeze({ key, file_name: fileName, size: entry.size, sha256: entry.sha256 })
  }))
}

function sanitizeWritten(value, jobId, createdAt) {
  if (!isStrictPlainObject(value) || value.status !== 'done' ||
      value.reason !== null || value.retry_hint !== null ||
      value.job_id !== jobId || value.created_at !== createdAt ||
      !SHA256_PATTERN.test(value.artifact_manifest_sha256)) {
    fail('artifact_integrity_failed', 'frame repair artifact result is invalid')
  }
  const urls = expectedUrls(jobId)
  for (const [key, expected] of Object.entries(urls)) {
    if (value[key] !== expected) fail('artifact_integrity_failed', 'frame repair artifact URL is invalid')
  }
  const manifest = sanitizeManifest(value.artifact_integrity_manifest)
  if (sha256(stableBytes(manifest)) !== value.artifact_manifest_sha256) {
    fail('artifact_integrity_failed', 'frame repair artifact manifest digest is invalid')
  }
  return deepFreeze({
    ...urls,
    artifact_integrity_manifest: manifest,
    artifact_manifest_sha256: value.artifact_manifest_sha256,
    reason: null,
    retry_hint: null,
  })
}

function sanitizeRecoveredArtifacts(value, jobId, expectedDigest) {
  if (!isStrictPlainObject(value) || value.job_id !== jobId ||
      value.artifact_manifest_sha256 !== expectedDigest) {
    fail('artifact_integrity_failed', 'recovered frame repair artifacts are invalid')
  }
  const urls = expectedUrls(jobId)
  for (const [key, expected] of Object.entries(urls)) {
    if (value[key] !== expected) fail('artifact_integrity_failed', 'recovered artifact URL is invalid')
  }
  const manifest = sanitizeManifest(value.manifest)
  if (sha256(stableBytes(manifest)) !== expectedDigest) {
    fail('artifact_integrity_failed', 'recovered artifact manifest digest is invalid')
  }
  return deepFreeze({
    ...urls,
    artifact_integrity_manifest: manifest,
    artifact_manifest_sha256: expectedDigest,
  })
}

function publicJob(value) {
  if (!isStrictPlainObject(value) || !validJobId(value.id)) return null
  const result = {}
  for (const key of PUBLIC_SCALARS) {
    if (!Object.hasOwn(value, key)) continue
    const item = value[key]
    if (item === null || typeof item === 'string' || typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))) result[key] = item
  }
  const urls = expectedUrls(value.id)
  for (const [key, expected] of Object.entries(urls)) {
    if (value[key] === expected) result[key] = expected
  }
  if (Object.hasOwn(value, 'artifact_integrity_manifest')) {
    try {
      result.artifact_integrity_manifest = sanitizeManifest(value.artifact_integrity_manifest)
    } catch {
      return null
    }
  }
  const validStatus = new Set([
    'queued', 'generating', 'post_processing', 'done',
    'failed_safety_filter', 'failed_model_error', 'failed_post_processing',
  ])
  const validRecovery = new Set([null, 'terminal', 'outcome_unknown', 'interrupted_before_dispatch'])
  const validReason = result.reason === null ||
    (typeof result.reason === 'string' && /^[a-z][a-z0-9_]{0,119}$/.test(result.reason))
  const validRetry = result.retry_hint === null ||
    (typeof result.retry_hint === 'string' && /^[a-z][a-z0-9_]{0,159}$/.test(result.retry_hint))
  if (result.type !== 'editor_character_frame_repair' || !validStatus.has(result.status) ||
      !validId(result.project_id) || !validId(result.asset_id) ||
      !validId(result.parent_revision_id) || !isFrameRepairOperationId(result.operation_id) ||
      !SHA256_PATTERN.test(result.plan_hash) || !isIsoTimestamp(result.created_at) ||
      (Object.hasOwn(result, 'updated_at') && !isIsoTimestamp(result.updated_at)) ||
      (Object.hasOwn(result, 'project_revision') &&
        (!Number.isSafeInteger(result.project_revision) || result.project_revision < 0)) ||
      (Object.hasOwn(result, 'implementation_revision') &&
        (typeof result.implementation_revision !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(result.implementation_revision))) ||
      result.provider_call_budget !== 1 ||
      (result.provider_calls_used !== 0 && result.provider_calls_used !== 1) ||
      (result.generated_candidate_count !== 0 && result.generated_candidate_count !== 1) ||
      !QUALITY_STATUSES.has(result.quality_status) || !validReason || !validRetry ||
      !validRecovery.has(result.recovery_state) ||
      (result.artifact_manifest_sha256 !== null &&
        !SHA256_PATTERN.test(result.artifact_manifest_sha256))) return null
  if (result.status === 'queued' &&
      (result.provider_calls_used !== 0 || result.generated_candidate_count !== 0)) return null
  if ((result.status === 'generating' || result.status === 'post_processing' || result.status === 'done') &&
      result.provider_calls_used !== 1) return null
  if ((result.status === 'post_processing' || result.status === 'done') &&
      result.generated_candidate_count !== 1) return null
  if (result.status === 'done' &&
      (!SHA256_PATTERN.test(result.artifact_manifest_sha256) ||
        !Array.isArray(result.artifact_integrity_manifest) ||
        sha256(stableBytes(result.artifact_integrity_manifest)) !== result.artifact_manifest_sha256 ||
        Object.keys(urls).some((key) => !Object.hasOwn(result, key)))) return null
  return deepFreeze(result)
}

function expectedMemoryStatus(record) {
  if (record.operation_status === 'reserved') return 'queued'
  if (record.operation_status === 'dispatched') return 'generating'
  if (record.operation_status === 'post_processing') return 'post_processing'
  return record.job_status
}

function recordPublicBase(record) {
  return {
    id: record.job_id,
    type: 'editor_character_frame_repair',
    project_id: record.project_id,
    asset_id: record.asset_id,
    parent_revision_id: record.parent_revision_id,
    operation_id: record.operation_id,
    plan_hash: record.plan_hash,
    created_at: record.created_at,
    updated_at: record.updated_at,
    provider_call_budget: 1,
    provider_calls_used: record.provider_calls_used,
  }
}

function buildContextBase({ captured, job, providerCallsUsed }) {
  const { identity, plan, parentAnimations } = captured
  return {
    version: 'editor_frame_repair_context_v1',
    job_type: 'editor_character_frame_repair',
    job_id: job.id,
    operation_id: identity.operation_id,
    submitted_at: job.created_at,
    project_id: identity.project_id,
    project_revision: identity.project_revision,
    asset_id: identity.asset_id,
    parent_revision_id: identity.parent_revision_id,
    parent_sheet_ref: `workspace/projects/${identity.project_id}/assets/${identity.asset_id}/${identity.parent_revision_id}/normalized_sheet.png`,
    parent_sheet_sha256: plan.parent_sheet_sha256,
    parent_processing_recipe_ref: captured.lineage.parent_processing_recipe_ref,
    profile: plan.profile.id,
    frame_size: { ...plan.profile.frame_size },
    sheet_size: { ...parentAnimations.sheet_size },
    clip_id: plan.clip.id,
    clip_frame_position: plan.clip.position,
    sheet_frame_index: plan.clip.sheet_frame_index,
    target_frame_sha256: plan.target_frame_sha256,
    context_frames: plan.clip.context_frames.map((item) => ({ ...item })),
    reference_context_sha256: plan.references.context_sha256,
    mask_sha256: plan.mask.sha256,
    plan_hash: identity.plan_hash,
    provider_preset: {
      id: plan.provider.id,
      provider: plan.provider.provider,
      label: plan.provider.label,
      model: plan.provider.model,
      image_config: { ...plan.provider.image_config },
    },
    provider_call_budget: 1,
    provider_calls_used: providerCallsUsed,
    implementation_revision: plan.implementation_revision,
    input_reference_roles: [...plan.references.input_reference_roles],
  }
}

async function reserveJobDirectory(generatedDir, jobId) {
  let jobDir
  try {
    await mkdir(generatedDir, { recursive: true })
    const rootStats = await lstat(generatedDir)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail('job_directory_collision', 'job root is unsafe')
    const realRoot = await realpath(generatedDir)
    jobDir = resolveGeneratedJobDir(jobId, { generatedDir })
    await mkdir(jobDir)
    const lexical = await lstat(jobDir)
    const realJob = await realpath(jobDir)
    const realJobStats = await stat(realJob)
    if (lexical.isSymbolicLink() || !lexical.isDirectory() ||
        path.dirname(realJob) !== realRoot || path.basename(realJob) !== jobId ||
        lexical.dev !== realJobStats.dev || lexical.ino !== realJobStats.ino) {
      fail('job_directory_collision', 'job directory is unsafe')
    }
    return jobDir
  } catch (error) {
    if (error?.code === 'job_directory_collision') throw error
    fail('job_directory_collision', 'job directory could not be reserved')
  }
}

function failureForPhase(phase, error) {
  const unusableProviderOutput = phase === 'normalization' &&
    isFrameRepairProviderOutputFailure(error)
  if (phase === 'provider' || unusableProviderOutput) {
    const classified = classifyFrameRepairProviderFailure(error, { unusableProviderOutput })
    const providerDiagnostic = phase === 'provider'
      ? buildFrameRepairProviderDiagnostic(error)
      : null
    return {
      status: classified.jobStatus,
      reason: classified.reason,
      retry_hint: classified.retryHint,
      providerOutcome: classified.providerOutcome,
      recoveryState: classified.recoveryState,
      providerDiagnostic:
        providerDiagnostic?.reason === classified.reason &&
        providerDiagnostic?.provider_outcome === classified.providerOutcome
          ? providerDiagnostic
          : null,
    }
  }
  const reasonByPhase = {
    reservation: 'job_directory_collision',
    preflight: 'managed_authority_invalid',
    normalization: 'normalization_failed',
    composite: 'composite_integrity_failed',
    package: 'package_failed',
    writer: 'artifact_integrity_failed',
    queue: 'queue_failed',
  }
  return {
    status: 'failed_post_processing',
    reason: reasonByPhase[phase] ?? 'post_processing_failed',
    retry_hint: 'inspect_editor_character_frame_repair',
    providerOutcome: null,
    recoveryState: null,
    providerDiagnostic: null,
  }
}

function validateCreatedJob(value) {
  if (!isStrictPlainObject(value) || !validJobId(value.id) || !isIsoTimestamp(value.created_at)) {
    fail('invalid_frame_repair_job', 'created frame repair job identity is invalid')
  }
  return Object.freeze({ id: value.id, created_at: value.created_at })
}

function publicJobMatchesRecord(job, record) {
  const baseMatches = Boolean(job) && job.type === 'editor_character_frame_repair' &&
    job.project_id === record.project_id && job.asset_id === record.asset_id &&
    job.parent_revision_id === record.parent_revision_id &&
    job.operation_id === record.operation_id && job.plan_hash === record.plan_hash &&
    job.status === expectedMemoryStatus(record) &&
    job.provider_call_budget === 1 && job.provider_calls_used === record.provider_calls_used &&
    job.reason === record.reason && job.retry_hint === record.retry_hint &&
    (record.operation_status !== 'done' ||
      job.artifact_manifest_sha256 === record.artifact_manifest_sha256)
  if (!baseMatches || record.operation_status !== 'done') return baseMatches
  return Array.isArray(job.artifact_integrity_manifest) &&
    Object.keys(expectedUrls(record.job_id)).every((key) => Object.hasOwn(job, key))
}

function publicJobIdentityMatchesRecord(job, record) {
  return Boolean(job) && job.type === 'editor_character_frame_repair' &&
    job.project_id === record.project_id && job.asset_id === record.asset_id &&
    job.parent_revision_id === record.parent_revision_id &&
    job.operation_id === record.operation_id && job.plan_hash === record.plan_hash &&
    job.provider_call_budget === 1
}

function recoveredCandidateCount(record) {
  if (record.operation_status === 'done' || record.operation_status === 'post_processing') return 1
  if (record.reason === 'provider_candidate_invalid') return 1
  if (record.job_status === 'failed_post_processing' && record.provider_calls_used === 1 &&
      record.provider_outcome === 'known') return 1
  return 0
}

async function decodeComparableManagedPng(buffer) {
  try {
    const pipeline = sharp(Buffer.from(buffer), {
      animated: true,
      failOn: 'error',
      limitInputPixels: 4_194_304,
    })
    const metadata = await pipeline.metadata()
    const pixels = metadata.width * metadata.height
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 ||
        !Number.isSafeInteger(pixels) || pixels <= 0 || pixels > 4_194_304) {
      fail('frame_repair_package_invalid', 'managed sheet PNG metadata is invalid')
    }
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== metadata.width || info.height !== metadata.height || info.channels !== 4 ||
        data.length !== pixels * 4) {
      fail('frame_repair_package_invalid', 'managed sheet PNG decode is invalid')
    }
    return Object.freeze({ width: info.width, height: info.height, data })
  } catch (error) {
    if (error?.code === 'frame_repair_package_invalid') throw error
    fail('frame_repair_package_invalid', 'managed sheet PNG decode failed')
  }
}

function validateDecodedParentAuthority(captured, parentSheet) {
  const { plan, parentAnimations, targetFrame } = captured
  const frameSize = plan.profile.frame_size
  const parentClip = parentAnimations.animations?.[plan.clip.id]
  if (parentAnimations.profile !== plan.profile.id ||
      !sameJson(parentAnimations.frame_size, frameSize) ||
      !isStrictPlainObject(parentClip) || !sameJson(parentClip.frames, plan.clip.frames) ||
      parentSheet.width !== parentAnimations.sheet_size.w ||
      parentSheet.height !== parentAnimations.sheet_size.h ||
      parentSheet.width % frameSize.w !== 0 || parentSheet.height % frameSize.h !== 0) {
    fail('invalid_frame_repair_service_input', 'decoded parent sheet geometry is invalid')
  }
  let resolvedTarget
  try {
    resolvedTarget = extractFrameRgba(parentSheet, plan.clip.sheet_frame_index, frameSize)
  } catch {
    fail('invalid_frame_repair_service_input', 'target frame is outside the parent sheet')
  }
  const targetBytes = Buffer.from(
    resolvedTarget.data.buffer,
    resolvedTarget.data.byteOffset,
    resolvedTarget.data.byteLength,
  )
  if (!resolvedTarget.data.every((value, index) => value === targetFrame.data[index]) ||
      sha256(targetBytes) !== plan.target_frame_sha256) {
    fail('invalid_frame_repair_service_input', 'target frame does not match parent sheet authority')
  }
  for (const item of plan.clip.context_frames) {
    let frame
    try {
      frame = extractFrameRgba(parentSheet, item.sheet_frame_index, frameSize)
    } catch {
      fail('invalid_frame_repair_service_input', 'context frame is outside the parent sheet')
    }
    const bytes = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
    if (sha256(bytes) !== item.sha256) {
      fail('invalid_frame_repair_service_input', 'context frame digest does not match parent sheet')
    }
  }
}

async function validateCharacterResult(value, patchedSheetPng) {
  if (!isStrictPlainObject(value) || !isStrictPlainObject(value.files) ||
      !isPngBuffer(value.files.sourcePng) || !isPngBuffer(value.files.normalizedSheetPng) ||
      value.files.sourcePng.length > MAX_MANAGED_NORMALIZED_PNG_BYTES ||
      value.files.normalizedSheetPng.length > MAX_MANAGED_NORMALIZED_PNG_BYTES) {
    fail('frame_repair_package_invalid', 'frame repair package does not preserve the patched sheet')
  }
  const expected = await decodeComparableManagedPng(patchedSheetPng)
  for (const buffer of [value.files.sourcePng, value.files.normalizedSheetPng]) {
    const actual = await decodeComparableManagedPng(buffer)
    if (actual.width !== expected.width || actual.height !== expected.height ||
        !actual.data.equals(expected.data)) {
      fail('frame_repair_package_invalid', 'frame repair package does not preserve patched pixels')
    }
  }
  return value
}

function stringArray(value) {
  return isDenseArray(value) && value.every((item) => typeof item === 'string')
}

function differenceStrings(left, right) {
  const other = new Set(right)
  return left.filter((item) => !other.has(item))
}

function validationEvidence(characterResult, parentMetadata) {
  const after = characterResult?.debugReport?.validation
  if (!isStrictPlainObject(after) || !['pass', 'warning', 'fail'].includes(after.status) ||
      !stringArray(after.warnings) || !stringArray(after.blocking_errors)) return null
  const parentQuality = isStrictPlainObject(parentMetadata?.quality) ? parentMetadata.quality : {}
  const beforeWarnings = stringArray(parentQuality.warnings) ? parentQuality.warnings : []
  const beforeBlocking = stringArray(parentQuality.blocking_errors) ? parentQuality.blocking_errors : []
  return {
    status: after.status,
    warnings: [...after.warnings],
    blocking_errors: [...after.blocking_errors],
    deltas: {
      warnings_added: differenceStrings(after.warnings, beforeWarnings),
      warnings_removed: differenceStrings(beforeWarnings, after.warnings),
      blocking_errors_added: differenceStrings(after.blocking_errors, beforeBlocking),
      blocking_errors_removed: differenceStrings(beforeBlocking, after.blocking_errors),
    },
  }
}

function qualityEvidenceForComposite(composite, characterResult, captured) {
  const validation = validationEvidence(characterResult, captured.parentMetadata)
  const inputs = composite.quality_inputs
  if (!inputs) fail('invalid_frame_repair_quality', 'frame repair quality inputs are unavailable')
  return {
    complete: validation !== null,
    parentFrame: inputs.before,
    compositedFrame: inputs.after,
    normalizedProviderFrame: inputs.candidate,
    adjacentClipFrames: inputs.adjacentClipFrames,
    mask: captured.plan.mask,
    integrity: composite.integrity,
    continuity: { status: 'measured', warnings: [] },
    validation,
  }
}

function rawProviderPng(normalized, candidate) {
  if (isStrictPlainObject(normalized) && isPngBuffer(normalized.raw_provider_png) &&
      normalized.raw_provider_png.length <= MAX_PROVIDER_BYTES) {
    return Buffer.from(normalized.raw_provider_png)
  }
  if (isPngBuffer(candidate.buffer)) return Buffer.from(candidate.buffer)
  fail('provider_output_invalid', 'normalized raw provider evidence is missing')
}

function sanitizedRecoveryJob(record, recovered, artifacts = null) {
  const value = {
    ...recordPublicBase(record),
    status: recovered.job_status,
    generated_candidate_count: recoveredCandidateCount(record),
    quality_status: 'unknown',
    reason: recovered.reason,
    retry_hint: recovered.retry_hint,
    recovery_state: recovered.recovery_state ?? null,
    artifact_manifest_sha256: record.artifact_manifest_sha256,
    ...(artifacts ?? {}),
  }
  const result = publicJob(value)
  if (!result) fail('frame_repair_recovery_invalid', 'recovered frame repair job is invalid')
  return result
}

export function createFrameRepairService({
  generatedDir,
  jobQueue,
  createJob,
  getJob,
  updateJob,
  ledger,
  generateCandidate,
  normalizeCandidate,
  compositeCandidate,
  packageSheet,
  writeArtifacts,
  writeProviderFailureArtifacts = writeFrameRepairProviderFailureArtifacts,
  recoverArtifacts = recoverSealedFrameRepairArtifacts,
} = {}) {
  const functions = [
    createJob, getJob, updateJob, generateCandidate, normalizeCandidate,
    compositeCandidate, packageSheet, writeArtifacts, writeProviderFailureArtifacts, recoverArtifacts,
  ]
  if (typeof generatedDir !== 'string' || generatedDir.length === 0 ||
      !jobQueue || typeof jobQueue.enqueue !== 'function' ||
      !ledger || ['reserve', 'transition', 'get', 'recover'].some((key) =>
        typeof ledger[key] !== 'function') ||
      functions.some((value) => typeof value !== 'function')) {
    throw new TypeError('frame repair service dependencies are invalid')
  }
  const activeJobIds = new Set()

  function readMemoryJob(jobId) {
    if (!validJobId(jobId)) return null
    try {
      return getJob(jobId)
    } catch {
      return null
    }
  }

  function getPublicJob(jobId) {
    return publicJob(readMemoryJob(jobId))
  }

  async function getOperation(lookup) {
    const record = await ledger.get(lookup)
    const rawMemory = readMemoryJob(record.job_id)
    const memory = publicJob(rawMemory)
    const nonTerminal = ['reserved', 'dispatched', 'post_processing'].includes(record.operation_status)
    if (publicJobMatchesRecord(memory, record) &&
        (!nonTerminal || activeJobIds.has(record.job_id))) return memory
    if (activeJobIds.has(record.job_id) &&
        ['reserved', 'dispatched', 'post_processing'].includes(record.operation_status) &&
        publicJobIdentityMatchesRecord(rawMemory, record)) {
      const projected = publicJob({
        ...rawMemory,
        status: expectedMemoryStatus(record),
        provider_calls_used: record.provider_calls_used,
        generated_candidate_count: record.operation_status === 'post_processing'
          ? 1
          : rawMemory.generated_candidate_count,
        reason: record.reason,
        retry_hint: record.retry_hint,
        artifact_manifest_sha256: null,
      })
      if (projected) return projected
    }

    const recovered = await ledger.recover(lookup)
    if (recovered.operation_status !== 'done') {
      return sanitizedRecoveryJob(recovered, recovered)
    }
    const artifacts = sanitizeRecoveredArtifacts(await recoverArtifacts({
      generatedDir,
      jobId: recovered.job_id,
      expectedManifestSha256: recovered.artifact_manifest_sha256,
    }), recovered.job_id, recovered.artifact_manifest_sha256)
    return sanitizedRecoveryJob(recovered, recovered, artifacts)
  }

  function safeUpdate(jobId, patch) {
    try {
      return getPublicJob(updateJob(jobId, patch)?.id ?? jobId)
    } catch {
      return null
    }
  }

  async function enqueue(input) {
    const captured = validatePrivateInput(input)
    const { identity, lookup, plan } = captured

    try {
      const existing = await ledger.get(lookup)
      if (existing.parent_revision_id !== identity.parent_revision_id ||
          existing.plan_hash !== identity.plan_hash) {
        fail('operation_conflict', 'frame repair operation identity conflicts with the persisted operation')
      }
      return getOperation(lookup)
    } catch (error) {
      if (error?.code !== 'operation_not_found') throw error
    }

    const created = createJob({
      status: 'queued',
      type: 'editor_character_frame_repair',
      project_id: identity.project_id,
      project_revision: identity.project_revision,
      asset_id: identity.asset_id,
      parent_revision_id: identity.parent_revision_id,
      operation_id: identity.operation_id,
      plan_hash: identity.plan_hash,
      implementation_revision: plan.implementation_revision,
      provider_call_budget: 1,
      provider_calls_used: 0,
      generated_candidate_count: 0,
      quality_status: 'unknown',
      reason: null,
      retry_hint: null,
      recovery_state: null,
      artifact_manifest_sha256: null,
    })
    const jobIdentity = validateCreatedJob(created)
    let reservation
    try {
      reservation = await ledger.reserve({
        project_id: identity.project_id,
        asset_id: identity.asset_id,
        parent_revision_id: identity.parent_revision_id,
        operation_id: identity.operation_id,
        plan_hash: identity.plan_hash,
        job_id: jobIdentity.id,
      })
    } catch (error) {
      safeUpdate(jobIdentity.id, {
        status: 'failed_post_processing',
        reason: error?.code === 'operation_conflict'
          ? 'operation_conflict'
          : 'operation_reservation_failed',
        retry_hint: null,
      })
      throw error
    }
    if (!reservation.created) {
      safeUpdate(jobIdentity.id, {
        status: 'failed_post_processing',
        reason: 'operation_deduplicated',
        retry_hint: null,
      })
      return getOperation(lookup)
    }

    let operationState = 'reserved'
    let providerCallsUsed = 0
    let providerOutcome = 'not_dispatched'
    let generatedCandidateCount = 0
    let taskStarted = false
    let terminalPublished = false

    async function publishFailure(phase, error) {
      if (terminalPublished) return
      const failure = failureForPhase(phase, error)
      const terminalOutcome = failure.providerOutcome ?? providerOutcome
      if (failure.providerDiagnostic) {
        try {
          await writeProviderFailureArtifacts({
            generatedDir,
            job: jobIdentity,
            providerDiagnostic: failure.providerDiagnostic,
          })
        } catch {
          // Diagnostic capture is best-effort and never changes the one-call terminal outcome.
        }
      }
      let persisted
      try {
        persisted = await ledger.transition(lookup, {
          from: [operationState],
          operation_status: 'failed',
          job_status: failure.status,
          provider_calls_used: providerCallsUsed,
          provider_outcome: terminalOutcome,
          reason: failure.reason,
          retry_hint: failure.retry_hint,
          artifact_manifest_sha256: null,
        })
      } catch {
        safeUpdate(jobIdentity.id, {
          recovery_state: providerCallsUsed === 0
            ? 'interrupted_before_dispatch'
            : 'outcome_unknown',
        })
        return
      }
      operationState = persisted.operation_status
      providerOutcome = persisted.provider_outcome
      terminalPublished = true
      safeUpdate(jobIdentity.id, {
        status: failure.status,
        provider_calls_used: providerCallsUsed,
        generated_candidate_count: generatedCandidateCount,
        quality_status: 'unknown',
        reason: failure.reason,
        retry_hint: failure.retry_hint,
        recovery_state: failure.recoveryState,
        artifact_manifest_sha256: null,
      })
    }

    async function runTask() {
      if (taskStarted) return
      taskStarted = true
      let phase = 'reservation'
      let writerCompleted = false
      try {
        await reserveJobDirectory(generatedDir, jobIdentity.id)
        phase = 'preflight'
        const decodedParent = await decodeComparableManagedPng(captured.parentSheetBuffer)
        const parentSheet = {
          width: decodedParent.width,
          height: decodedParent.height,
          data: new Uint8ClampedArray(decodedParent.data),
        }
        validateDecodedParentAuthority(captured, parentSheet)
        safeUpdate(jobIdentity.id, { status: 'generating' })

        let dispatched
        try {
          dispatched = await ledger.transition(lookup, {
            from: ['reserved'],
            operation_status: 'dispatched',
            job_status: 'generating',
            provider_calls_used: 1,
            provider_outcome: 'unknown',
          })
        } catch {
          return
        }
        operationState = dispatched.operation_status
        providerCallsUsed = dispatched.provider_calls_used
        providerOutcome = dispatched.provider_outcome
        safeUpdate(jobIdentity.id, { provider_calls_used: 1 })

        phase = 'provider'
        const generated = await generateCandidate({
          providerPreset: snapshotPrivate(captured.providerPreset),
          plan: clonePlainInput(captured.plan),
          referenceImages: captured.referenceImages.map((item) => ({
            role: item.role,
            name: item.name,
            mimeType: item.mimeType,
            buffer: Buffer.from(item.buffer),
          })),
        })
        generatedCandidateCount = 1
        let known
        try {
          known = await ledger.transition(lookup, {
            from: ['dispatched'],
            operation_status: 'dispatched',
            job_status: 'generating',
            provider_calls_used: 1,
            provider_outcome: 'known',
          })
        } catch {
          return
        }
        operationState = known.operation_status
        providerOutcome = known.provider_outcome
        const candidate = validateCandidate(generated, captured.generation, captured.plan)
        safeUpdate(jobIdentity.id, { generated_candidate_count: 1 })

        let post
        try {
          post = await ledger.transition(lookup, {
            from: ['dispatched'],
            operation_status: 'post_processing',
            job_status: 'post_processing',
            provider_calls_used: 1,
            provider_outcome: 'known',
          })
        } catch {
          return
        }
        operationState = post.operation_status
        safeUpdate(jobIdentity.id, { status: 'post_processing' })

        phase = 'normalization'
        let normalized
        try {
          normalized = await normalizeCandidate({
            providerBuffer: Buffer.from(candidate.buffer),
            parentFrame: cloneRgba(captured.targetFrame),
            parentSheet: cloneRgba(parentSheet),
            frameSize: { ...plan.profile.frame_size },
          })
        } catch (error) {
          const normalizationCode = frameRepairProviderOutputCode(error)
          if (normalizationCode) {
            try {
              await writeProviderFailureArtifacts({
                generatedDir,
                job: jobIdentity,
                normalizationCode,
                providerBuffer: Buffer.from(candidate.buffer),
              })
            } catch {
              // Diagnostic capture is best-effort and never changes the one-call terminal outcome.
            }
          }
          throw error
        }
        const normalizedCandidateFrame = validateRgba(
          normalized?.normalized_candidate_frame,
          plan.profile.frame_size,
        )
        const normalizedRawProviderPng = rawProviderPng(normalized, candidate)

        phase = 'composite'
        const composite = await validateComposite(await compositeCandidate({
          parentSheet: cloneRgba(parentSheet),
          candidateFrame: cloneRgba(normalizedCandidateFrame),
          sheetFrameIndex: plan.clip.sheet_frame_index,
          frameSize: { ...plan.profile.frame_size },
          mask: clonePlainInput(captured.plan.mask),
        }), { candidateFrame: normalizedCandidateFrame, parentSheet, captured })

        phase = 'package'
        const patchedSheetPng = composite.evidence.patched_normalized_sheet
        const characterResult = await validateCharacterResult(await packageSheet({
          normalizedSheetPng: Buffer.from(patchedSheetPng),
          profile: TOPDOWN_RPG_V0,
          parentAnimations: clonePlainInput(captured.parentAnimations),
          parentMetadata: clonePlainInput(captured.parentMetadata),
          createdAt: jobIdentity.created_at,
          lineage: clonePlainInput(captured.lineage),
          generation: clonePlainInput(captured.generation),
        }), patchedSheetPng)
        const quality = deepFreeze(buildFrameRepairQualityReport(
          qualityEvidenceForComposite(composite, characterResult, captured),
        ))
        if (!QUALITY_STATUSES.has(quality.status)) {
          fail('invalid_frame_repair_quality', 'frame repair quality status is invalid')
        }

        phase = 'writer'
        const contextBase = buildContextBase({ captured, job: jobIdentity, providerCallsUsed: 1 })
        const evidence = {
          frame_repair_plan: clonePlainInput(captured.plan),
          frame_repair_context_base: clonePlainInput(contextBase),
          target_before: Buffer.from(composite.evidence.target_before),
          frame_repair_mask: Buffer.from(composite.evidence.frame_repair_mask),
          frame_repair_context_image: Buffer.from(composite.evidence.frame_repair_context_image),
          raw_provider_output: Buffer.from(normalizedRawProviderPng),
          normalized_candidate_frame: Buffer.from(composite.evidence.normalized_candidate_frame),
          composited_candidate_frame: Buffer.from(composite.evidence.composited_candidate_frame),
          frame_repair_difference: Buffer.from(composite.evidence.frame_repair_difference),
          frame_repair_quality: clonePlainInput(quality),
          frame_repair_prompt: Buffer.from(candidate.prompt, 'utf8'),
          patched_normalized_sheet: Buffer.from(patchedSheetPng),
        }
        const written = sanitizeWritten(await writeArtifacts({
          generatedDir,
          job: jobIdentity,
          characterResult,
          evidence,
        }), jobIdentity.id, jobIdentity.created_at)
        writerCompleted = true

        let done
        try {
          done = await ledger.transition(lookup, {
            from: ['post_processing'],
            operation_status: 'done',
            job_status: 'done',
            provider_calls_used: 1,
            provider_outcome: 'known',
            reason: null,
            retry_hint: null,
            artifact_manifest_sha256: written.artifact_manifest_sha256,
          })
        } catch {
          safeUpdate(jobIdentity.id, { recovery_state: 'outcome_unknown' })
          return
        }
        operationState = done.operation_status
        terminalPublished = true
        safeUpdate(jobIdentity.id, {
          status: 'done',
          provider_calls_used: 1,
          generated_candidate_count: 1,
          quality_status: quality.status,
          reason: null,
          retry_hint: null,
          recovery_state: null,
          ...written,
        })
      } catch (error) {
        if (!writerCompleted) await publishFailure(phase, error)
      } finally {
        activeJobIds.delete(jobIdentity.id)
      }
    }

    const onQueueError = async (error) => {
      if (!taskStarted) {
        try {
          await publishFailure('queue', error)
        } finally {
          activeJobIds.delete(jobIdentity.id)
        }
      }
    }
    activeJobIds.add(jobIdentity.id)
    try {
      jobQueue.enqueue(runTask, onQueueError)
    } catch (error) {
      try {
        await publishFailure('queue', error)
      } finally {
        activeJobIds.delete(jobIdentity.id)
      }
    }
    return getOperation(lookup)
  }

  return Object.freeze({ enqueue, getOperation, getJob: getPublicJob })
}
