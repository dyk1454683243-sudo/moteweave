import { createHash } from 'node:crypto'

import { FrameRepairError } from './frameRepairProtocol.js'
import { applyFrameRepairMaskEdits, maskBitsToRuns } from './frameRepairMask.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const MASK_SOURCES = new Set(['localized_diagnostic', 'localized_plus_user_edits', 'user_scoped'])
const MASK_CONFIDENCES = new Set(['high', 'needs_scope', 'user_confirmed'])

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sortPlain(value) {
  if (Array.isArray(value)) return value.map(sortPlain)
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortPlain(value[key])]),
  )
}

function invalidPlan(message) {
  return new FrameRepairError('invalid_frame_repair_plan', message)
}

function assertPositiveInteger(value, message) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidPlan(message)
}

function assertNonNegativeInteger(value, message) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidPlan(message)
}

function assertString(value, message) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw invalidPlan(message)
  }
  return value
}

function assertSha256(value, message) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw invalidPlan(message)
  return value
}

function projectReferenceRecords(referenceImages) {
  if (!Array.isArray(referenceImages)) throw invalidPlan('reference images are invalid')
  return referenceImages.map((item) => {
    if (!isPlainRecord(item)) throw invalidPlan('reference image is invalid')
    const role = assertString(item.role, 'reference role is invalid')
    const name = assertString(item.name, 'reference name is invalid')
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw invalidPlan('reference name is invalid')
    }
    return { role, name, sha256: assertSha256(item.sha256, 'reference digest is invalid') }
  })
}

function projectCanonicalMask(mask) {
  if (!isPlainRecord(mask)) throw invalidPlan('canonical mask is invalid')
  assertPositiveInteger(mask.width, 'canonical mask width is invalid')
  assertPositiveInteger(mask.height, 'canonical mask height is invalid')
  const pixelCount = mask.width * mask.height
  if (!Number.isSafeInteger(pixelCount) ||
      !MASK_SOURCES.has(mask.source) ||
      !MASK_CONFIDENCES.has(mask.confidence) ||
      !Array.isArray(mask.runs)) {
    throw invalidPlan('canonical mask fields are invalid')
  }

  let previousEnd = null
  let activePixelCount = 0
  const runs = mask.runs.map((run) => {
    if (!isPlainRecord(run)) throw invalidPlan('canonical mask run is invalid')
    assertNonNegativeInteger(run.start, 'canonical mask run start is invalid')
    assertPositiveInteger(run.length, 'canonical mask run length is invalid')
    if (run.start >= pixelCount ||
        run.length > pixelCount - run.start ||
        (previousEnd != null && run.start <= previousEnd + 1)) {
      throw invalidPlan('canonical mask runs are not canonical')
    }
    previousEnd = run.start + run.length - 1
    activePixelCount += run.length
    return { start: run.start, length: run.length }
  })
  if (!Number.isSafeInteger(activePixelCount) || mask.activePixelCount !== activePixelCount) {
    throw invalidPlan('canonical mask pixel count is invalid')
  }
  const sha256 = hashFrameRepairPlan({ width: mask.width, height: mask.height, runs })
  return {
    width: mask.width,
    height: mask.height,
    source: mask.source,
    confidence: mask.confidence,
    runs,
    activePixelCount,
    sha256,
  }
}

function projectContextFrames(contextFrames) {
  if (!Array.isArray(contextFrames)) throw invalidPlan('context frames are invalid')
  return contextFrames.map((item) => {
    if (!isPlainRecord(item)) throw invalidPlan('context frame is invalid')
    assertNonNegativeInteger(item.position, 'context frame position is invalid')
    assertNonNegativeInteger(item.sheet_frame_index, 'context sheet frame is invalid')
    return {
      position: item.position,
      sheet_frame_index: item.sheet_frame_index,
      sha256: assertSha256(item.sha256, 'context frame digest is invalid'),
    }
  })
}

export function serializeFrameRepairPlan(plan) {
  return Buffer.from(JSON.stringify(sortPlain(plan)), 'utf8')
}

export function hashFrameRepairPlan(plan) {
  return createHash('sha256').update(serializeFrameRepairPlan(plan)).digest('hex')
}

export function hashFrameRepairReferenceContext(referenceImages) {
  return hashFrameRepairPlan(projectReferenceRecords(referenceImages))
}

export function buildCanonicalFrameRepairMask({ baseMask, width, height, edits }) {
  if (!isPlainRecord(baseMask) ||
      (baseMask.mode !== 'localized_diagnostic' && baseMask.mode !== 'needs_scope')) {
    throw invalidPlan('base mask is invalid')
  }
  const finalBits = applyFrameRepairMaskEdits(baseMask.bits, width, height, edits)
  const baseActivePixelCount = baseMask.bits.reduce((sum, value) => sum + value, 0)
  if (baseMask.activePixelCount !== baseActivePixelCount ||
      (baseMask.mode === 'localized_diagnostic') !== (baseActivePixelCount > 0)) {
    throw invalidPlan('base mask state is invalid')
  }
  const runs = maskBitsToRuns(finalBits)
  const activePixelCount = runs.reduce((sum, run) => sum + run.length, 0)
  const hasDiagnosticBase = baseActivePixelCount > 0
  const hasEdits = edits.length > 0
  const source = hasDiagnosticBase
    ? (hasEdits ? 'localized_plus_user_edits' : 'localized_diagnostic')
    : 'user_scoped'
  const confidence = hasDiagnosticBase
    ? (hasEdits ? 'user_confirmed' : 'high')
    : (activePixelCount > 0 ? 'user_confirmed' : 'needs_scope')
  return {
    width,
    height,
    source,
    confidence,
    runs,
    activePixelCount,
    sha256: hashFrameRepairPlan({ width, height, runs }),
  }
}

export function createCanonicalFrameRepairPlan({
  request,
  authority,
  mask,
  provider,
  implementationRevision,
}) {
  if (!isPlainRecord(request) || !isPlainRecord(authority) || !isPlainRecord(provider)) {
    throw invalidPlan('canonical Plan input is invalid')
  }
  if (!Array.isArray(authority.clipFrames) ||
      authority.clipFrames[request.clipFramePosition] !== request.sheetFrameIndex) {
    throw new FrameRepairError(
      'frame_identity_mismatch',
      'clip position does not resolve to the submitted sheet frame',
    )
  }

  const clipFrames = authority.clipFrames.map((frameIndex) => {
    assertNonNegativeInteger(frameIndex, 'clip frame is invalid')
    return frameIndex
  })
  assertNonNegativeInteger(request.clipFramePosition, 'clip position is invalid')
  assertNonNegativeInteger(request.sheetFrameIndex, 'sheet frame is invalid')
  const normalizedInstruction = assertString(request.instruction, 'instruction is invalid').normalize('NFC').trim()
  if (normalizedInstruction.length === 0 || [...normalizedInstruction].length > 500) {
    throw invalidPlan('instruction is invalid')
  }

  const frameSize = authority.frameSize
  if (!isPlainRecord(frameSize)) throw invalidPlan('profile frame size is invalid')
  assertPositiveInteger(frameSize.w, 'profile frame width is invalid')
  assertPositiveInteger(frameSize.h, 'profile frame height is invalid')
  const canonicalMask = projectCanonicalMask(mask)
  if (canonicalMask.width !== frameSize.w || canonicalMask.height !== frameSize.h) {
    throw invalidPlan('canonical mask dimensions do not match the profile')
  }

  const referenceItems = projectReferenceRecords(authority.referenceImages)
  const providerImageConfig = provider.image_config
  if (!isPlainRecord(providerImageConfig) || !isPlainRecord(request.imageConfig)) {
    throw invalidPlan('provider image configuration is invalid')
  }
  const requestProviderPresetId = assertString(request.providerPresetId, 'provider preset id is invalid')
  const resolvedProviderPresetId = assertString(provider.id, 'provider preset id is invalid')
  if (requestProviderPresetId !== resolvedProviderPresetId) {
    throw invalidPlan('resolved provider preset does not match the request')
  }
  const requestImageSize = request.imageConfig.image_size
  const resolvedImageSize = providerImageConfig.image_size
  if ((resolvedImageSize !== '1K' && resolvedImageSize !== '2K') ||
      (requestImageSize !== '1K' && requestImageSize !== '2K') ||
      requestImageSize !== resolvedImageSize) {
    throw invalidPlan('resolved provider image configuration does not match the request')
  }
  const resolvedAspectRatio = assertString(
    providerImageConfig.aspect_ratio,
    'provider aspect ratio is invalid',
  ).trim()
  if (resolvedAspectRatio.length === 0) throw invalidPlan('provider aspect ratio is invalid')
  const imageConfig = {
    image_size: resolvedImageSize,
    aspect_ratio: resolvedAspectRatio,
  }

  const plan = {
    version: 'frame_repair_plan_v1',
    project: {
      id: assertString(authority.projectId, 'project id is invalid'),
      revision: authority.projectRevision,
    },
    asset: {
      id: assertString(authority.assetId, 'asset id is invalid'),
      parent_revision_id: assertString(authority.parentRevisionId, 'parent revision id is invalid'),
    },
    profile: {
      id: assertString(authority.profileId, 'profile id is invalid'),
      frame_size: { w: frameSize.w, h: frameSize.h },
    },
    clip: {
      id: assertString(request.clipId, 'clip id is invalid'),
      frames: clipFrames,
      position: request.clipFramePosition,
      sheet_frame_index: request.sheetFrameIndex,
      context_frames: projectContextFrames(authority.contextFrames),
    },
    parent_sheet_sha256: assertSha256(authority.parentSheetSha256, 'parent sheet digest is invalid'),
    target_frame_sha256: assertSha256(authority.targetFrameSha256, 'target frame digest is invalid'),
    references: {
      input_reference_roles: referenceItems.map((item) => item.role),
      context_sha256: hashFrameRepairReferenceContext(referenceItems),
      items: referenceItems,
    },
    mask: canonicalMask,
    instruction: normalizedInstruction,
    provider: {
      id: resolvedProviderPresetId,
      provider: assertString(provider.provider, 'provider id is invalid'),
      label: assertString(provider.label, 'provider label is invalid'),
      model: assertString(provider.model, 'provider model is invalid'),
      image_config: imageConfig,
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    implementation_revision: assertString(implementationRevision, 'implementation revision is invalid'),
  }
  assertNonNegativeInteger(plan.project.revision, 'project revision is invalid')

  const plan_hash = hashFrameRepairPlan(plan)
  const diagnostics = [
    ...(canonicalMask.activePixelCount > 0 ? [] : ['invalid_mask']),
    ...(provider.available === true ? [] : ['provider_unavailable']),
  ]
  return {
    plan,
    plan_hash,
    can_run: canonicalMask.activePixelCount > 0 && provider.available === true,
    diagnostics,
  }
}
