import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'

import { encodeRgbaPng, resizeRgbaNearest } from '../character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { getProviderPresets } from '../character-pack/providers/providerConfig.js'
import {
  buildFrameRepairMaskVisualization,
  buildFrameRepairQualityReport,
  extractFrameRgba,
  runsToBitset,
  verifyFrameRepairIntegrity,
} from './frameRepairComposite.js'
import { importAcceptedFrameRepairAsAsset } from './artifactRegistry.js'
import {
  FRAME_REPAIR_INTEGRITY_FILES,
  recoverSealedFrameRepairArtifacts,
  verifySealedFrameRepairArtifacts,
} from './frameRepairArtifacts.js'
import { deriveFrameRepairBaseMask } from './frameRepairMask.js'
import {
  buildCanonicalFrameRepairMask,
  createCanonicalFrameRepairPlan,
  hashFrameRepairPlan,
} from './frameRepairPlan.js'
import { resolveExactFrameRepairProvider } from './frameRepairProvider.js'
import {
  assertFrameRepairLiveRequest,
  assertFrameRepairPlanRequest,
  assertFrameRepairAcceptRequest,
  FrameRepairError,
  isFrameRepairOperationId,
} from './frameRepairProtocol.js'
import {
  resolveGeneratedJobArtifactFile,
  resolveManagedRevisionArtifactFile,
} from './paths.js'
import {
  EditorProjectStoreError,
  loadEditorProject,
  mutateEditorProject,
} from './projectStore.js'
import { validateManagedParentAnimations } from './normalizedCharacterSheetPackage.js'
import {
  clonePlain,
  isBase64Payload,
  isPlainObject,
  isSecretLikeValue,
  isValidId,
  isValidJobId,
} from './safety.js'

const IMPLEMENTATION_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const REQUIRED_ARTIFACT_KEYS = Object.freeze([
  'sheet',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
])
const MANAGED_ARTIFACT_FILES = Object.freeze({
  sheet: 'normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  processing_recipe: 'processing_recipe.json',
})
const JSON_ARTIFACT_LIMIT = 4 * 1024 * 1024
const SHEET_ARTIFACT_LIMIT = 32 * 1024 * 1024
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'([{])(?:\/{1,2}(?=\S)|~\/(?=\S)|[A-Za-z]:[\\/](?=\S)|\\\\(?=\S))/
const EXTERNAL_URL_PATTERN = /\b(?:https?|ftp|file):\/\/\S+/i
const RELATIVE_ESCAPE_PATTERN = /(?:^|[\s"'([{\\/])\.\.(?:[\\/]|$)/
const BASE64_TEXT_PATTERN = /(?:^|\s)[A-Za-z0-9+/]{64,}={0,2}(?:$|\s)/
const PNG_MIME_TYPE = 'image/png'
const FRAME_REPAIR_CONTEXT_FILE = FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context
const RECOVERY_CONTEXT_LIMIT = 128 * 1024
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RECOVERY_CONTEXT_KEYS = Object.freeze([
  'version', 'job_type', 'job_id', 'operation_id', 'submitted_at',
  'project_id', 'project_revision', 'asset_id', 'parent_revision_id',
  'parent_sheet_ref', 'parent_sheet_sha256', 'parent_processing_recipe_ref',
  'profile', 'frame_size', 'sheet_size', 'clip_id', 'clip_frame_position',
  'sheet_frame_index', 'target_frame_sha256', 'context_frames',
  'reference_context_sha256', 'mask_sha256', 'plan_hash', 'provider_preset',
  'provider_call_budget', 'provider_calls_used', 'implementation_revision',
  'input_reference_roles', 'sealed_artifacts',
])

function coordinatorError(code, message, details = null) {
  return new FrameRepairError(code, message, details)
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function rgbaBytes(image) {
  return Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function exactPoint(value, expected) {
  return isPlainObject(value) && value.x === expected.x && value.y === expected.y
}

function exactSize(value, expected) {
  return isPlainObject(value) && value.w === expected.w && value.h === expected.h
}

function assertSafeRouteIds(projectId, assetId) {
  if (!isValidId(projectId) || !isValidId(assetId)) {
    throw coordinatorError('invalid_frame_repair_request', 'Frame Repair route ids are invalid')
  }
}

function assertSafeInstruction(instruction) {
  if (typeof instruction !== 'string' || CONTROL_CHARACTER_PATTERN.test(instruction) ||
      ABSOLUTE_PATH_PATTERN.test(instruction) || EXTERNAL_URL_PATTERN.test(instruction) ||
      RELATIVE_ESCAPE_PATTERN.test(instruction) || BASE64_TEXT_PATTERN.test(instruction) ||
      isBase64Payload(instruction) || isSecretLikeValue(instruction)) {
    throw coordinatorError(
      'invalid_frame_repair_request',
      'repair instruction contains an unsafe value',
    )
  }
}

function artifactCaptureError(error, artifactKey) {
  if (error?.code === 'artifact_not_found' || error?.code === 'unsafe_artifact_path') return error
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
    return coordinatorError('artifact_not_found', `${artifactKey} disappeared before capture`)
  }
  return coordinatorError('unsafe_artifact_path', `${artifactKey} could not be safely captured`)
}

async function captureManagedArtifact({
  project,
  asset,
  revision,
  artifactKey,
  projectRoot,
  workspaceRoot,
  maxBytes,
}) {
  const recorded = artifactKey === 'processing_recipe'
    ? revision.processing_recipe_ref
    : revision.artifacts?.[artifactKey]
  const lexical = path.resolve(projectRoot, recorded)
  let lexicalStat
  let resolved
  let handle
  try {
    lexicalStat = await lstat(lexical, { bigint: true })
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) {
      throw coordinatorError('unsafe_artifact_path', `${artifactKey} must be a non-symlink file`)
    }
    resolved = await resolveManagedRevisionArtifactFile({
      projectId: project.id,
      assetId: asset.id,
      revision,
      artifactKey,
      projectRoot,
      workspaceRoot,
    })
    handle = await open(resolved, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const openedStat = await handle.stat({ bigint: true })
    if (!openedStat.isFile() || openedStat.dev !== lexicalStat.dev ||
        openedStat.ino !== lexicalStat.ino || openedStat.size !== lexicalStat.size ||
        openedStat.mtimeNs !== lexicalStat.mtimeNs || openedStat.ctimeNs !== lexicalStat.ctimeNs ||
        openedStat.size <= 0n || openedStat.size > BigInt(maxBytes)) {
      throw coordinatorError('unsafe_artifact_path', `${artifactKey} changed or exceeds its size limit`)
    }
    const buffer = await handle.readFile()
    const afterStat = await handle.stat({ bigint: true })
    if (BigInt(buffer.length) !== openedStat.size ||
        afterStat.dev !== openedStat.dev || afterStat.ino !== openedStat.ino ||
        afterStat.size !== openedStat.size || afterStat.mtimeNs !== openedStat.mtimeNs ||
        afterStat.ctimeNs !== openedStat.ctimeNs) {
      throw coordinatorError('unsafe_artifact_path', `${artifactKey} changed during capture`)
    }
    return Object.freeze({
      artifactKey,
      recorded,
      resolved,
      buffer: Buffer.from(buffer),
      sha256: sha256(buffer),
    })
  } catch (error) {
    throw artifactCaptureError(error, artifactKey)
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

function parseManagedJson(capture) {
  let value
  try {
    value = JSON.parse(capture.buffer.toString('utf8'))
  } catch {
    throw coordinatorError(
      'invalid_managed_metadata',
      `${capture.artifactKey} is not valid JSON`,
    )
  }
  if (!isPlainObject(value) || !isBoundedSafeJson(value)) {
    throw coordinatorError(
      'invalid_managed_metadata',
      `${capture.artifactKey} is not safe managed JSON`,
    )
  }
  return value
}

function isBoundedSafeJson(root) {
  const stack = [{ value: root, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const { value, depth } = stack.pop()
    nodes += 1
    if (nodes > 100_000 || depth > 64) return false
    if (value === null || typeof value === 'boolean' || typeof value === 'number') continue
    if (typeof value === 'string') {
      if (value.length > 100_000 || isBase64Payload(value) || isSecretLikeValue(value) ||
          /data:[^,\s]*;base64,/i.test(value)) return false
      continue
    }
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return false
      for (const item of value) stack.push({ value: item, depth: depth + 1 })
      continue
    }
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
      return false
    }
    const entries = Object.entries(value)
    if (entries.length > 20_000) return false
    for (const [key, child] of entries) {
      if (key.length === 0 || key.length > 240 ||
          /(^|_)(api[_-]?key|provider[_-]?key|token|secret|password|credential|authorization|bearer)($|_)/i.test(key)) {
        return false
      }
      stack.push({ value: child, depth: depth + 1 })
    }
  }
  return true
}

async function decodeManagedSheet(buffer) {
  try {
    const pipeline = sharp(buffer, {
      animated: true,
      failOn: 'error',
      limitInputPixels: TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h,
    }).ensureAlpha()
    const metadata = await pipeline.metadata()
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 ||
        metadata.width !== TOPDOWN_RPG_V0.sheet.w ||
        metadata.height !== TOPDOWN_RPG_V0.sheet.h) {
      throw new Error('geometry')
    }
    const decoded = await pipeline.raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== TOPDOWN_RPG_V0.sheet.w ||
        decoded.info.height !== TOPDOWN_RPG_V0.sheet.h || decoded.info.channels !== 4 ||
        decoded.data.length !== TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4) {
      throw new Error('decoded geometry')
    }
    return {
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8ClampedArray(decoded.data),
    }
  } catch {
    throw coordinatorError(
      'invalid_managed_sheet',
      'managed normalized sheet must be one 768×768 PNG',
    )
  }
}

function assertManagedAnimationDocuments({ asset, animations, metadata, editorMetadata, debugReport }) {
  if (asset.profile !== TOPDOWN_RPG_V0.id || metadata.profile !== TOPDOWN_RPG_V0.id ||
      animations.profile !== TOPDOWN_RPG_V0.id || editorMetadata.profile !== TOPDOWN_RPG_V0.id ||
      debugReport.profile !== TOPDOWN_RPG_V0.id) {
    throw coordinatorError('profile_conflict', 'managed Character Pack profiles disagree')
  }
  if (animations.version !== TOPDOWN_RPG_V0.version ||
      animations.sheet !== 'normalized_sheet.png' ||
      !exactSize(animations.frame_size, TOPDOWN_RPG_V0.frame) ||
      !exactSize(animations.sheet_size, TOPDOWN_RPG_V0.sheet) ||
      !exactPoint(animations.anchor, TOPDOWN_RPG_V0.anchor) ||
      !isPlainObject(animations.animations) || Object.keys(animations.animations).length === 0 ||
      editorMetadata.version !== TOPDOWN_RPG_V0.version ||
      editorMetadata.sheet !== 'normalized_sheet.png' ||
      !exactSize(editorMetadata.frame_size, TOPDOWN_RPG_V0.frame) ||
      !exactSize(editorMetadata.sheet_size, TOPDOWN_RPG_V0.sheet) ||
      typeof metadata.name !== 'string' || metadata.name.trim().length === 0 ||
      metadata.name.length > 160 ||
      (metadata.description != null &&
        (typeof metadata.description !== 'string' || metadata.description.length > 1000)) ||
      !isPlainObject(debugReport.validation)) {
    throw coordinatorError('invalid_managed_metadata', 'managed Character Pack documents are malformed')
  }
  const frameCount = TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows
  for (const [clipId, clip] of Object.entries(animations.animations)) {
    if (!isValidId(clipId) || !isPlainObject(clip) ||
        !Array.isArray(clip.frames) || clip.frames.length === 0 || clip.frames.length > frameCount ||
        clip.frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0 || frame >= frameCount) ||
        !Number.isFinite(clip.fps) || clip.fps <= 0 || clip.fps > 120 ||
        typeof clip.loop !== 'boolean' || !['loop', 'once', 'ping_pong'].includes(clip.mode)) {
      throw coordinatorError('invalid_managed_metadata', 'managed animation clips are malformed')
    }
  }
  try {
    validateManagedParentAnimations(animations, TOPDOWN_RPG_V0)
  } catch {
    throw coordinatorError('invalid_managed_metadata', 'managed animation authority is invalid')
  }
}

function resolveManagedClip({ asset, animations, request }) {
  const animation = animations.animations[request.clipId]
  const assetClip = asset.clips?.[request.clipId]
  if (!animation || !assetClip || assetClip.id !== request.clipId ||
      assetClip.source !== 'animations.json' || !sameJson(assetClip.frames, animation.frames) ||
      assetClip.fps !== animation.fps || assetClip.loop_mode !== animation.mode ||
      !exactSize(assetClip.frame_size, TOPDOWN_RPG_V0.frame) ||
      !exactPoint(assetClip.anchor, TOPDOWN_RPG_V0.anchor)) {
    throw coordinatorError('invalid_managed_metadata', 'requested animation clip is not authoritative')
  }
  if (request.clipFramePosition >= animation.frames.length ||
      animation.frames[request.clipFramePosition] !== request.sheetFrameIndex) {
    throw coordinatorError(
      'frame_identity_mismatch',
      'clip position does not resolve to the submitted sheet frame',
    )
  }
  return animation
}

function contextFrameRecords(parentSheet, clipFrames, targetPosition) {
  const records = []
  for (const position of [targetPosition - 1, targetPosition + 1]) {
    if (position < 0 || position >= clipFrames.length) continue
    const frame = extractFrameRgba(parentSheet, clipFrames[position], TOPDOWN_RPG_V0.frame)
    records.push({
      position,
      sheet_frame_index: clipFrames[position],
      sha256: sha256(rgbaBytes(frame)),
      frame,
    })
  }
  return records
}

async function buildReferenceImages({ targetFrame, contextFrames, mask, targetPosition }) {
  const previous = contextFrames.find((item) => item.position < targetPosition)?.frame ?? null
  const next = contextFrames.find((item) => item.position > targetPosition)?.frame ?? null
  const adjacent = previous ?? next ?? targetFrame
  const enlarged = await resizeRgbaNearest(targetFrame, {
    w: TOPDOWN_RPG_V0.authoringCell.w,
    h: TOPDOWN_RPG_V0.authoringCell.h,
  })
  const enlargedMask = await resizeRgbaNearest(buildFrameRepairMaskVisualization(targetFrame, mask), {
    w: TOPDOWN_RPG_V0.authoringCell.w,
    h: TOPDOWN_RPG_V0.authoringCell.h,
  })
  const enlargedAdjacent = await resizeRgbaNearest(adjacent, {
    w: TOPDOWN_RPG_V0.authoringCell.w,
    h: TOPDOWN_RPG_V0.authoringCell.h,
  })
  const references = [
    {
      role: 'target_enlarged',
      name: 'target.png',
      mimeType: PNG_MIME_TYPE,
      buffer: await encodeRgbaPng(enlarged),
    },
    {
      role: 'mask_visualization',
      name: 'mask.png',
      mimeType: PNG_MIME_TYPE,
      buffer: await encodeRgbaPng(enlargedMask),
    },
    {
      role: 'clip_context',
      name: 'adjacent_context.png',
      mimeType: PNG_MIME_TYPE,
      buffer: await encodeRgbaPng(enlargedAdjacent),
    },
  ]
  return references.map((reference) => Object.freeze({
    ...reference,
    buffer: Buffer.from(reference.buffer),
    sha256: sha256(reference.buffer),
  }))
}

function safeProviderText(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 240 ||
      CONTROL_CHARACTER_PATTERN.test(value) || isSecretLikeValue(value) || isBase64Payload(value) ||
      /data:[^,\s]*;base64,/i.test(value) || BASE64_TEXT_PATTERN.test(value) ||
      ABSOLUTE_PATH_PATTERN.test(value) || EXTERNAL_URL_PATTERN.test(value) ||
      RELATIVE_ESCAPE_PATTERN.test(value)) {
    throw coordinatorError('provider_configuration_error', `${label} is invalid`)
  }
  return value
}

function assertProviderProjectionCredentialBoundary(provider, apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) return
  const projected = [
    provider.id,
    provider.label,
    provider.provider,
    provider.model,
    provider.image_config.image_size,
    provider.image_config.aspect_ratio,
  ]
  if (projected.some((value) => typeof value === 'string' && value.includes(apiKey))) {
    throw coordinatorError('provider_configuration_error', 'public provider metadata is invalid')
  }
}

function resolveProviderAuthority({ getProviderEnv, request }) {
  let providerPreset
  let runtimePreset = null
  try {
    const source = getProviderEnv()
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('invalid env')
    const env = { ...source }
    const presets = getProviderPresets(env)
    if (!Array.isArray(presets)) throw new Error('invalid preset list')
    const ids = new Set()
    for (const preset of presets) {
      if (!preset || typeof preset.id !== 'string' || ids.has(preset.id)) {
        throw new Error('ambiguous preset list')
      }
      ids.add(preset.id)
    }
    providerPreset = presets.find((preset) => preset.id === request.providerPresetId)
    if (!providerPreset) {
      throw coordinatorError('provider_unavailable', 'selected provider preset is unavailable')
    }
    if (providerPreset.available === true) {
      runtimePreset = resolveExactFrameRepairProvider(env, request.providerPresetId)
    }
  } catch (error) {
    if (error instanceof FrameRepairError) throw error
    throw coordinatorError('provider_configuration_error', 'provider preset configuration is invalid')
  }
  const imageConfig = {
    image_size: request.imageConfig.image_size,
    aspect_ratio: safeProviderText(providerPreset.imageConfig?.aspect_ratio, 'provider aspect ratio'),
  }
  const publicProvider = Object.freeze({
    id: safeProviderText(providerPreset.id, 'provider preset id'),
    label: safeProviderText(providerPreset.label, 'provider label'),
    provider: safeProviderText(providerPreset.provider, 'provider adapter'),
    model: safeProviderText(providerPreset.model, 'provider model'),
    available: providerPreset.available === true,
    image_config: Object.freeze({ ...imageConfig }),
  })
  assertProviderProjectionCredentialBoundary(publicProvider, providerPreset.apiKey)
  const runtimeProvider = runtimePreset
    ? Object.freeze({
        id: publicProvider.id,
        label: publicProvider.label,
        provider: publicProvider.provider,
        apiKey: runtimePreset.apiKey,
        apiKeyEnv: runtimePreset.apiKeyEnv,
        baseUrl: runtimePreset.baseUrl,
        model: publicProvider.model,
        imageConfig: Object.freeze({ ...imageConfig }),
        siteUrl: runtimePreset.siteUrl,
        appName: runtimePreset.appName,
        available: true,
      })
    : null
  return { publicProvider, runtimeProvider }
}

function assertAuthorityIdentity({ project, asset, revision, request }) {
  if (project.revision !== request.expectedRevision) {
    throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
      expected_revision: request.expectedRevision,
      current_revision: project.revision,
    })
  }
  if (!asset || asset.kind !== 'character_pack') {
    throw coordinatorError('asset_not_found', 'character asset not found')
  }
  if (asset.active_revision_id !== request.expectedAssetRevisionId) {
    throw coordinatorError('asset_revision_conflict', 'active asset revision changed')
  }
  if (!revision || revision.id !== request.expectedAssetRevisionId) {
    throw coordinatorError('revision_not_found', 'active character revision not found')
  }
  if (!isValidJobId(revision.source_job_id) || revision.source_job_id == null) {
    throw coordinatorError('invalid_managed_metadata', 'parent source job identity is invalid')
  }
  for (const artifactKey of REQUIRED_ARTIFACT_KEYS) {
    const recorded = revision.artifacts?.[artifactKey]
    if (typeof recorded !== 'string') {
      throw coordinatorError('artifact_not_found', `managed ${artifactKey} artifact is missing`)
    }
    const expected = `workspace/projects/${project.id}/assets/${asset.id}/${revision.id}/${MANAGED_ARTIFACT_FILES[artifactKey]}`
    if (recorded.replaceAll('\\', '/') !== expected) {
      throw coordinatorError('invalid_managed_metadata', `managed ${artifactKey} identity is invalid`)
    }
  }
  if (revision.processing_recipe_ref != null &&
      (typeof revision.processing_recipe_ref !== 'string' ||
        revision.processing_recipe_ref.replaceAll('\\', '/') !==
          `workspace/projects/${project.id}/assets/${asset.id}/${revision.id}/${MANAGED_ARTIFACT_FILES.processing_recipe}`)) {
    throw coordinatorError('invalid_managed_metadata', 'managed Processing Recipe identity is invalid')
  }
}

async function resolveFrameRepairAuthority({
  projectId,
  assetId,
  request,
  projectRoot,
  workspaceRoot,
  implementationRevision,
  getProviderEnv,
}) {
  assertSafeRouteIds(projectId, assetId)
  assertSafeInstruction(request.instruction)
  const { project } = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
  const asset = project.assets?.[assetId]
  const revision = asset?.revisions?.[asset?.active_revision_id]
  assertAuthorityIdentity({ project, asset, revision, request })

  const captures = {}
  for (const artifactKey of REQUIRED_ARTIFACT_KEYS) {
    captures[artifactKey] = await captureManagedArtifact({
      project,
      asset,
      revision,
      artifactKey,
      projectRoot,
      workspaceRoot,
      maxBytes: artifactKey === 'sheet' ? SHEET_ARTIFACT_LIMIT : JSON_ARTIFACT_LIMIT,
    })
  }
  let parentProcessingRecipeRef = null
  if (revision.processing_recipe_ref != null) {
    await captureManagedArtifact({
      project,
      asset,
      revision,
      artifactKey: 'processing_recipe',
      projectRoot,
      workspaceRoot,
      maxBytes: JSON_ARTIFACT_LIMIT,
    })
    parentProcessingRecipeRef = revision.processing_recipe_ref
  }
  const animations = parseManagedJson(captures.animations)
  const metadata = parseManagedJson(captures.metadata)
  const editorMetadata = parseManagedJson(captures.editor_metadata)
  const debugReport = parseManagedJson(captures.debug_report)
  assertManagedAnimationDocuments({ asset, animations, metadata, editorMetadata, debugReport })
  const clip = resolveManagedClip({ asset, animations, request })
  const parentSheet = await decodeManagedSheet(captures.sheet.buffer)
  const targetFrame = extractFrameRgba(parentSheet, request.sheetFrameIndex, TOPDOWN_RPG_V0.frame)
  const contextFrames = contextFrameRecords(parentSheet, clip.frames, request.clipFramePosition)
  const baseMask = deriveFrameRepairBaseMask(targetFrame)
  const mask = buildCanonicalFrameRepairMask({
    baseMask,
    width: targetFrame.width,
    height: targetFrame.height,
    edits: request.maskEdits,
  })
  const providerAuthority = resolveProviderAuthority({ getProviderEnv, request })
  const referenceImages = await buildReferenceImages({
    targetFrame,
    contextFrames,
    mask,
    targetPosition: request.clipFramePosition,
  })
  const authority = {
    projectId: project.id,
    projectRevision: project.revision,
    assetId: asset.id,
    parentRevisionId: revision.id,
    profileId: TOPDOWN_RPG_V0.id,
    frameSize: { ...TOPDOWN_RPG_V0.frame },
    clipFrames: [...clip.frames],
    parentSheetSha256: captures.sheet.sha256,
    targetFrameSha256: sha256(rgbaBytes(targetFrame)),
    contextFrames: contextFrames.map(({ frame: _frame, ...record }) => record),
    referenceImages: referenceImages.map(({ role, name, sha256: digest }) => ({
      role,
      name,
      sha256: digest,
    })),
  }
  const canonical = createCanonicalFrameRepairPlan({
    request,
    authority,
    mask,
    provider: providerAuthority.publicProvider,
    implementationRevision,
  })
  return Object.freeze({
    canonical,
    project,
    asset,
    revision,
    parentSheetBuffer: Buffer.from(captures.sheet.buffer),
    targetFrame: {
      width: targetFrame.width,
      height: targetFrame.height,
      data: new Uint8ClampedArray(targetFrame.data),
    },
    referenceImages,
    parentAnimations: animations,
    parentMetadata: metadata,
    parentProcessingRecipeRef,
    runtimeProvider: providerAuthority.runtimeProvider,
  })
}

function publicPlanResult(canonical) {
  const result = {
    plan: canonical.plan,
    plan_hash: canonical.plan_hash,
    can_run: canonical.can_run,
    diagnostics: [...canonical.diagnostics],
    estimated_provider_calls: canonical.plan.estimated_provider_calls,
    max_provider_calls: canonical.plan.max_provider_calls,
  }
  return clonePlain(result)
}

function sanitizePublicServiceResult(value) {
  if (!isPlainObject(value) || !isBoundedPublicResult(value)) {
    throw coordinatorError('invalid_frame_repair_job', 'frame repair service returned unsafe data')
  }
  return clonePlain(value)
}

function isBoundedPublicResult(root) {
  const stack = [{ value: root, depth: 0 }]
  const seen = new Set()
  let nodes = 0
  while (stack.length > 0) {
    const { value, depth } = stack.pop()
    nodes += 1
    if (nodes > 100_000 || depth > 64) return false
    if (value === null || typeof value === 'boolean') continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false
      continue
    }
    if (typeof value === 'string') {
      if (value.length > 1_000_000 || isBase64Payload(value) || isSecretLikeValue(value) ||
          /data:[^,\s]*;base64,/i.test(value)) return false
      continue
    }
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value) ||
        ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return false
      for (const item of value) stack.push({ value: item, depth: depth + 1 })
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    for (const [key, child] of Object.entries(value)) {
      if (key.length === 0 || key.length > 240 ||
          /(^|_)(api[_-]?key|provider[_-]?key|token|secret|password|credential|authorization|bearer)($|_)/i.test(key)) {
        return false
      }
      stack.push({ value: child, depth: depth + 1 })
    }
  }
  return true
}

function planRequestFromLive(live) {
  return {
    expectedRevision: live.expectedRevision,
    expectedAssetRevisionId: live.expectedAssetRevisionId,
    clipId: live.clipId,
    clipFramePosition: live.clipFramePosition,
    sheetFrameIndex: live.sheetFrameIndex,
    instruction: live.instruction,
    maskEdits: live.maskEdits,
    providerPresetId: live.providerPresetId,
    imageConfig: live.imageConfig,
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

function capturedEntry(entries, key) {
  const entry = entries.find((candidate) => candidate.key === key)
  if (!entry || entry.file_name !== FRAME_REPAIR_INTEGRITY_FILES[key] ||
      !Buffer.isBuffer(entry.content)) {
    throw coordinatorError('artifact_integrity_failed', 'sealed Frame Repair artifact is missing')
  }
  return entry
}

function parseCapturedJson(entries, key) {
  const entry = capturedEntry(entries, key)
  let value
  try {
    value = JSON.parse(entry.content.toString('utf8'))
  } catch {
    throw coordinatorError('artifact_integrity_failed', 'sealed Frame Repair JSON is invalid')
  }
  if (!isPlainObject(value) || !isBoundedSafeJson(value)) {
    throw coordinatorError('artifact_integrity_failed', 'sealed Frame Repair JSON is unsafe')
  }
  return value
}

async function decodeExactPng(buffer, expectedSize) {
  try {
    const expectedPixels = expectedSize.w * expectedSize.h
    const pipeline = sharp(buffer, {
      animated: true,
      failOn: 'error',
      limitInputPixels: expectedPixels,
    }).ensureAlpha()
    const metadata = await pipeline.metadata()
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 ||
        metadata.width !== expectedSize.w || metadata.height !== expectedSize.h) {
      throw new Error('invalid PNG geometry')
    }
    const decoded = await pipeline.raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== expectedSize.w || decoded.info.height !== expectedSize.h ||
        decoded.info.channels !== 4 || decoded.data.length !== expectedPixels * 4) {
      throw new Error('invalid decoded geometry')
    }
    return {
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8ClampedArray(decoded.data),
    }
  } catch {
    throw coordinatorError('artifact_integrity_failed', 'sealed Frame Repair PNG is invalid')
  }
}

async function captureRecoveryContext({ generatedDir, jobId }) {
  const lexical = path.join(path.resolve(generatedDir), jobId, FRAME_REPAIR_CONTEXT_FILE)
  let lexicalStat
  let resolved
  let handle
  try {
    lexicalStat = await lstat(lexical, { bigint: true })
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile() ||
        lexicalStat.size <= 0n || lexicalStat.size > BigInt(RECOVERY_CONTEXT_LIMIT)) {
      throw new Error('unsafe recovery context')
    }
    resolved = await resolveGeneratedJobArtifactFile({
      jobId,
      fileName: FRAME_REPAIR_CONTEXT_FILE,
      allowedFiles: new Set([FRAME_REPAIR_CONTEXT_FILE]),
      generatedDir,
    })
    handle = await open(resolved, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.dev !== lexicalStat.dev || opened.ino !== lexicalStat.ino ||
        opened.size !== lexicalStat.size || opened.mtimeNs !== lexicalStat.mtimeNs ||
        opened.ctimeNs !== lexicalStat.ctimeNs) throw new Error('recovery context changed')
    const content = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (BigInt(content.length) !== opened.size || after.dev !== opened.dev ||
        after.ino !== opened.ino || after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      throw new Error('recovery context changed during capture')
    }
    return Buffer.from(content)
  } catch {
    throw coordinatorError('artifact_integrity_failed', 'Frame Repair recovery context is invalid')
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

function parseRecoveryContext(content) {
  let context
  try {
    context = JSON.parse(content.toString('utf8'))
  } catch {
    throw coordinatorError('artifact_integrity_failed', 'Frame Repair recovery context is invalid')
  }
  const keys = Object.keys(context ?? {})
  if (!isPlainObject(context) || keys.length !== RECOVERY_CONTEXT_KEYS.length ||
      RECOVERY_CONTEXT_KEYS.some((key) => !Object.hasOwn(context, key)) ||
      !isBoundedSafeJson(context) || context.version !== 'editor_frame_repair_context_v1' ||
      context.job_type !== 'editor_character_frame_repair' ||
      !JOB_ID_PATTERN.test(context.job_id) || !isFrameRepairOperationId(context.operation_id) ||
      !isValidId(context.project_id) || !isValidId(context.asset_id) ||
      !isValidId(context.parent_revision_id) || !SHA256_PATTERN.test(context.plan_hash) ||
      !SHA256_PATTERN.test(context.parent_sheet_sha256) || !isIsoTimestamp(context.submitted_at)) {
    throw coordinatorError('artifact_integrity_failed', 'Frame Repair recovery context is invalid')
  }
  return context
}

async function resolveAcceptanceJob({
  frameRepairService,
  generatedDir,
  projectId,
  assetId,
  jobId,
}) {
  const inMemory = await frameRepairService.getJob(jobId)
  if (inMemory != null) {
    if (!isFrameRepairOperationId(inMemory.operation_id)) {
      throw coordinatorError('identity_mismatch', 'Frame Repair operation identity is invalid')
    }
    const winner = await frameRepairService.getOperation({
      project_id: projectId,
      asset_id: assetId,
      operation_id: inMemory.operation_id,
    })
    if (winner?.id !== inMemory.id || winner.parent_revision_id !== inMemory.parent_revision_id ||
        winner.plan_hash !== inMemory.plan_hash ||
        winner.artifact_manifest_sha256 !== inMemory.artifact_manifest_sha256) {
      throw coordinatorError('identity_mismatch', 'Frame Repair operation winner changed')
    }
    return inMemory
  }
  const context = parseRecoveryContext(await captureRecoveryContext({ generatedDir, jobId }))
  if (context.job_id !== jobId || context.project_id !== projectId || context.asset_id !== assetId) {
    throw coordinatorError('identity_mismatch', 'Frame Repair recovery identity changed')
  }
  const winner = await frameRepairService.getOperation({
    project_id: projectId,
    asset_id: assetId,
    operation_id: context.operation_id,
  })
  if (winner?.id !== jobId || winner.parent_revision_id !== context.parent_revision_id ||
      winner.plan_hash !== context.plan_hash ||
      winner.artifact_manifest_sha256 == null ||
      (Object.hasOwn(winner, 'project_revision') &&
        winner.project_revision !== context.project_revision) ||
      (Object.hasOwn(winner, 'implementation_revision') &&
        winner.implementation_revision !== context.implementation_revision)) {
    throw coordinatorError('identity_mismatch', 'Frame Repair operation winner changed')
  }
  const recovered = await recoverSealedFrameRepairArtifacts({
    generatedDir,
    jobId,
    expectedManifestSha256: winner.artifact_manifest_sha256,
  })
  if (recovered.job_id !== winner.id ||
      recovered.artifact_manifest_sha256 !== winner.artifact_manifest_sha256 ||
      !isDeepStrictEqual(recovered.manifest, winner.artifact_integrity_manifest)) {
    throw coordinatorError('artifact_integrity_failed', 'Frame Repair recovery manifest changed')
  }
  return Object.freeze({
    ...winner,
    created_at: context.submitted_at,
    project_revision: context.project_revision,
    implementation_revision: context.implementation_revision,
  })
}

function assertCompletedAcceptanceJob({ job, project, asset, parentRevision, jobId, request, implementationRevision }) {
  if (!isPlainObject(job) || job.id !== jobId || job.type !== 'editor_character_frame_repair' ||
      job.status !== 'done' || job.project_id !== project.id ||
      job.project_revision !== project.revision || job.asset_id !== asset.id ||
      job.parent_revision_id !== parentRevision.id || job.plan_hash !== request.expectedPlanHash ||
      job.implementation_revision !== implementationRevision || job.provider_call_budget !== 1 ||
      job.provider_calls_used !== 1 || job.generated_candidate_count !== 1 ||
      !['pass', 'warning', 'fail', 'unknown'].includes(job.quality_status) || job.reason !== null ||
      job.retry_hint !== null || !SHA256_PATTERN.test(job.artifact_manifest_sha256)) {
    throw coordinatorError('job_not_ready', 'Frame Repair job is not an exact completed candidate')
  }
}

function assertAcceptanceIdentity({
  plan,
  context,
  quality,
  job,
  project,
  asset,
  parentRevision,
  request,
  implementationRevision,
}) {
  if (hashFrameRepairPlan(plan) !== request.expectedPlanHash ||
      context.job_type !== 'editor_character_frame_repair' || context.job_id !== job.id ||
      context.operation_id !== job.operation_id || context.submitted_at !== job.created_at ||
      context.project_id !== project.id || context.project_revision !== project.revision ||
      context.asset_id !== asset.id || context.parent_revision_id !== parentRevision.id ||
      context.parent_sheet_ref !== parentRevision.artifacts?.sheet ||
      context.parent_processing_recipe_ref !== (parentRevision.processing_recipe_ref ?? null) ||
      context.parent_sheet_sha256 !== plan.parent_sheet_sha256 ||
      context.profile !== plan.profile?.id ||
      !isDeepStrictEqual(context.frame_size, plan.profile?.frame_size) ||
      context.clip_id !== plan.clip?.id ||
      context.clip_frame_position !== plan.clip?.position ||
      context.sheet_frame_index !== plan.clip?.sheet_frame_index ||
      !isDeepStrictEqual(context.context_frames, plan.clip?.context_frames) ||
      context.target_frame_sha256 !== plan.target_frame_sha256 ||
      context.reference_context_sha256 !== plan.references?.context_sha256 ||
      context.mask_sha256 !== plan.mask?.sha256 ||
      context.plan_hash !== request.expectedPlanHash ||
      context.implementation_revision !== implementationRevision ||
      context.provider_call_budget !== job.provider_call_budget ||
      context.provider_call_budget !== plan.max_provider_calls ||
      context.provider_calls_used !== job.provider_calls_used ||
      plan.project?.id !== project.id || plan.project.revision !== project.revision ||
      plan.asset?.id !== asset.id || plan.asset.parent_revision_id !== parentRevision.id ||
      plan.implementation_revision !== implementationRevision ||
      plan.estimated_provider_calls !== 1 || plan.max_provider_calls !== 1 ||
      plan.clip?.frames?.[plan.clip.position] !== plan.clip.sheet_frame_index ||
      !Array.isArray(plan.references?.items) ||
      !isDeepStrictEqual(
        plan.references.items.map((item) => item?.role),
        plan.references.input_reference_roles,
      ) ||
      !isDeepStrictEqual(plan.references?.input_reference_roles, context.input_reference_roles) ||
      !isDeepStrictEqual(plan.provider, context.provider_preset) ||
      (job.quality_status !== 'unknown' && quality.status !== job.quality_status)) {
    throw coordinatorError('identity_mismatch', 'Frame Repair acceptance identity changed')
  }
}

function assertQualityPolicy(quality, request) {
  const recomputed = buildFrameRepairQualityReport({
    complete: quality.complete,
    before: quality.before,
    after: quality.after,
    integrity: quality.integrity,
    halo: quality.halo,
    alpha: quality.alpha,
    significant_components: quality.significant_components,
    continuity: quality.continuity,
    validation: quality.validation,
  })
  if (!isDeepStrictEqual(recomputed, quality) || quality.complete !== true ||
      quality.completeness?.complete !== true ||
      !Array.isArray(quality.completeness.missing) || quality.completeness.missing.length !== 0) {
    throw coordinatorError('quality_blocked', 'Frame Repair quality evidence is incomplete')
  }
  if (quality.status === 'fail' || quality.status === 'unknown') {
    throw coordinatorError('quality_blocked', 'Frame Repair quality blocks acceptance')
  }
  if (quality.status === 'warning' && request.warningConfirmed !== true) {
    throw coordinatorError('warning_confirmation_required', 'Frame Repair warning requires confirmation')
  }
}

async function assertAcceptancePackageDocuments({
  entries,
  plan,
  context,
  quality,
  project,
  asset,
  parentRevision,
  projectRoot,
  workspaceRoot,
}) {
  const animations = parseCapturedJson(entries, 'animations')
  const metadata = parseCapturedJson(entries, 'metadata')
  const debugReport = parseCapturedJson(entries, 'debug_report')
  try {
    validateManagedParentAnimations(animations, TOPDOWN_RPG_V0)
  } catch {
    throw coordinatorError('artifact_integrity_failed', 'sealed animations are invalid')
  }
  const selectedClip = animations.animations?.[plan.clip.id]
  const expectedGeneration = {
    mode: 'editor_targeted_frame_repair',
    provider: plan.provider.provider,
    provider_preset_id: plan.provider.id,
    provider_label: plan.provider.label,
    model: plan.provider.model,
    image_config: { ...plan.provider.image_config },
  }
  const expectedValidation = {
    status: quality.validation?.status,
    warnings: quality.validation?.warnings,
    blocking_errors: quality.validation?.blocking_errors,
  }
  if (!isPlainObject(selectedClip) || !isDeepStrictEqual(selectedClip.frames, plan.clip.frames) ||
      animations.profile !== plan.profile.id ||
      !isDeepStrictEqual(animations.frame_size, plan.profile.frame_size) ||
      !isDeepStrictEqual(animations.sheet_size, context.sheet_size) ||
      metadata.profile !== plan.profile.id || typeof metadata.name !== 'string' ||
      metadata.name.trim().length === 0 || metadata.source?.type !== 'derived_revision' ||
      metadata.source.parent_project_id !== project.id ||
      metadata.source.parent_asset_id !== asset.id ||
      metadata.source.parent_revision_id !== parentRevision.id ||
      metadata.source.parent_job_id !== parentRevision.source_job_id ||
      !isDeepStrictEqual(metadata.generation, expectedGeneration) ||
      !isPlainObject(metadata.quality) ||
      !isDeepStrictEqual({
        status: metadata.quality.status,
        warnings: metadata.quality.warnings,
        blocking_errors: metadata.quality.blocking_errors,
      }, expectedValidation) ||
      !isPlainObject(debugReport) || !isPlainObject(debugReport.validation) ||
      !isDeepStrictEqual({
        status: debugReport.validation.status,
        warnings: debugReport.validation.warnings,
        blocking_errors: debugReport.validation.blocking_errors,
      }, expectedValidation)) {
    throw coordinatorError('identity_mismatch', 'sealed Character package identity changed')
  }
  const expectedAnimationsRef =
    `workspace/projects/${project.id}/assets/${asset.id}/${parentRevision.id}/animations.json`
  if (parentRevision.artifacts?.animations !== expectedAnimationsRef) {
    throw coordinatorError('identity_mismatch', 'managed parent animations identity changed')
  }
  const capturedParentAnimations = await captureManagedArtifact({
    project,
    asset,
    revision: parentRevision,
    artifactKey: 'animations',
    projectRoot,
    workspaceRoot,
    maxBytes: JSON_ARTIFACT_LIMIT,
  })
  const parentAnimations = parseManagedJson(capturedParentAnimations)
  if (!isDeepStrictEqual(parentAnimations, animations)) {
    throw coordinatorError('identity_mismatch', 'managed parent animations changed')
  }
  return { animations, metadata }
}

async function verifyAcceptancePixels({
  entries,
  plan,
  quality,
  project,
  asset,
  parentRevision,
  projectRoot,
  workspaceRoot,
}) {
  const expectedSheetRef = `workspace/projects/${project.id}/assets/${asset.id}/${parentRevision.id}/normalized_sheet.png`
  if (parentRevision.artifacts?.sheet !== expectedSheetRef) {
    throw coordinatorError('identity_mismatch', 'managed parent sheet identity changed')
  }
  const capturedParent = await captureManagedArtifact({
    project,
    asset,
    revision: parentRevision,
    artifactKey: 'sheet',
    projectRoot,
    workspaceRoot,
    maxBytes: SHEET_ARTIFACT_LIMIT,
  })
  if (capturedParent.sha256 !== plan.parent_sheet_sha256) {
    throw coordinatorError('identity_mismatch', 'managed parent sheet changed')
  }
  const frameSize = plan.profile.frame_size
  const parentSheet = await decodeManagedSheet(capturedParent.buffer)
  const patchedSheet = await decodeManagedSheet(capturedEntry(entries, 'patched_normalized_sheet').content)
  const packagedSheet = await decodeManagedSheet(capturedEntry(entries, 'sheet').content)
  const packagedSource = await decodeManagedSheet(capturedEntry(entries, 'source').content)
  if (!sameRgba(patchedSheet, packagedSheet) || !sameRgba(patchedSheet, packagedSource)) {
    throw coordinatorError('artifact_integrity_failed', 'packaged patched sheets disagree')
  }
  const expectedBefore = extractFrameRgba(parentSheet, plan.clip.sheet_frame_index, frameSize)
  if (sha256(rgbaBytes(expectedBefore)) !== plan.target_frame_sha256) {
    throw coordinatorError('identity_mismatch', 'managed target frame changed')
  }
  const sealedBefore = await decodeExactPng(capturedEntry(entries, 'target_before').content, frameSize)
  const sealedAfter = await decodeExactPng(
    capturedEntry(entries, 'composited_candidate_frame').content,
    frameSize,
  )
  const maskEntry = capturedEntry(entries, 'frame_repair_mask')
  const maskReferences = plan.references.items.filter((item) => item?.role === 'mask_visualization')
  if (maskReferences.length !== 1 || maskReferences[0].name !== 'mask.png') {
    throw coordinatorError('artifact_integrity_failed', 'sealed mask visualization changed')
  }
  const sealedMask = await decodeExactPng(maskEntry.content, frameSize)
  const expectedMask = buildFrameRepairMaskVisualization(expectedBefore, plan.mask)
  if (!sameRgba(sealedMask, expectedMask)) {
    throw coordinatorError('artifact_integrity_failed', 'sealed mask visualization changed')
  }
  const normalizedCandidate = await decodeExactPng(
    capturedEntry(entries, 'normalized_candidate_frame').content,
    frameSize,
  )
  const sealedDifference = await decodeExactPng(
    capturedEntry(entries, 'frame_repair_difference').content,
    frameSize,
  )
  const expectedAfter = extractFrameRgba(patchedSheet, plan.clip.sheet_frame_index, frameSize)
  if (!sameRgba(sealedBefore, expectedBefore) || !sameRgba(sealedAfter, expectedAfter)) {
    throw coordinatorError('artifact_integrity_failed', 'sealed target frames are not sheet-bound')
  }
  if (!sameRgba(sealedDifference, differenceRgba(sealedBefore, sealedAfter))) {
    throw coordinatorError('artifact_integrity_failed', 'sealed difference visualization changed')
  }
  const active = runsToBitset(plan.mask.runs, frameSize.w * frameSize.h)
  if (!active.some(Boolean)) {
    throw coordinatorError('artifact_integrity_failed', 'sealed Frame Repair mask is empty')
  }
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const offset = pixel * 4
    for (let channel = 0; channel < 4; channel += 1) {
      if (sealedAfter.data[offset + channel] !== normalizedCandidate.data[offset + channel]) {
        throw coordinatorError('artifact_integrity_failed', 'masked pixels do not match the candidate')
      }
    }
  }
  const integrity = verifyFrameRepairIntegrity({
    parentSheet,
    patchedSheet,
    candidateFrame: sealedAfter,
    sheetFrameIndex: plan.clip.sheet_frame_index,
    frameSize,
    active,
  })
  let changedInsideMask = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const offset = pixel * 4
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      changed ||= sealedBefore.data[offset + channel] !== sealedAfter.data[offset + channel]
    }
    if (changed) changedInsideMask += 1
  }
  if (integrity.non_target_equal !== true || integrity.target_outside_mask_equal !== true ||
      integrity.actual_non_target_changed !== 0 || integrity.actual_outside_mask_changed !== 0 ||
      quality.integrity?.non_target_equal !== true ||
      quality.integrity?.target_outside_mask_equal !== true ||
      quality.integrity.actual_non_target_changed !== 0 ||
      quality.integrity.actual_outside_mask_changed !== 0 ||
      quality.integrity.changed_inside_mask !== changedInsideMask) {
    throw coordinatorError('artifact_integrity_failed', 'Frame Repair pixel integrity failed')
  }
}

function assertCoordinatorDependencies({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  getProviderEnv,
  frameRepairService,
}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0 ||
      typeof workspaceRoot !== 'string' || workspaceRoot.length === 0 ||
      typeof generatedDir !== 'string' || generatedDir.length === 0 ||
      typeof implementationRevision !== 'string' ||
      !IMPLEMENTATION_REVISION_PATTERN.test(implementationRevision) ||
      typeof getProviderEnv !== 'function' || !frameRepairService ||
      typeof frameRepairService.enqueue !== 'function' ||
      typeof frameRepairService.getOperation !== 'function' ||
      typeof frameRepairService.getJob !== 'function') {
    throw new TypeError('frame repair coordinator dependencies are invalid')
  }
}

export function createFrameRepairCoordinator({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  getProviderEnv,
  frameRepairService,
} = {}) {
  assertCoordinatorDependencies({
    projectRoot,
    workspaceRoot,
    generatedDir,
    implementationRevision,
    getProviderEnv,
    frameRepairService,
  })
  const authorityDependencies = {
    projectRoot,
    workspaceRoot,
    implementationRevision,
    getProviderEnv,
  }

  async function planFrameRepair({ projectId, assetId, body } = {}) {
    assertSafeRouteIds(projectId, assetId)
    const request = assertFrameRepairPlanRequest(body)
    const resolved = await resolveFrameRepairAuthority({
      projectId,
      assetId,
      request,
      ...authorityDependencies,
    })
    return publicPlanResult(resolved.canonical)
  }

  async function submitFrameRepair({ projectId, assetId, body } = {}) {
    assertSafeRouteIds(projectId, assetId)
    const live = assertFrameRepairLiveRequest(body)
    const request = planRequestFromLive(live)
    const resolved = await resolveFrameRepairAuthority({
      projectId,
      assetId,
      request,
      ...authorityDependencies,
    })
    if (resolved.canonical.plan_hash !== live.expectedPlanHash) {
      throw coordinatorError('stale_plan', 'Frame Repair plan changed before submission')
    }
    if (!resolved.canonical.can_run) {
      if (resolved.canonical.diagnostics.includes('provider_unavailable')) {
        throw coordinatorError('provider_unavailable', 'selected provider preset is unavailable')
      }
      throw coordinatorError('invalid_frame_repair_mask', 'Frame Repair plan cannot run')
    }
    const result = await frameRepairService.enqueue({
      identity: {
        project_id: resolved.project.id,
        project_revision: resolved.project.revision,
        asset_id: resolved.asset.id,
        parent_revision_id: resolved.revision.id,
        operation_id: live.operationId,
        plan_hash: resolved.canonical.plan_hash,
      },
      plan: clonePlain(resolved.canonical.plan),
      providerPreset: {
        ...resolved.runtimeProvider,
        imageConfig: { ...resolved.runtimeProvider.imageConfig },
      },
      parentSheetBuffer: Buffer.from(resolved.parentSheetBuffer),
      targetFrame: {
        width: resolved.targetFrame.width,
        height: resolved.targetFrame.height,
        data: new Uint8ClampedArray(resolved.targetFrame.data),
      },
      referenceImages: resolved.referenceImages.map((reference) => ({
        role: reference.role,
        name: reference.name,
        mimeType: reference.mimeType,
        buffer: Buffer.from(reference.buffer),
      })),
      parentAnimations: clonePlain(resolved.parentAnimations),
      parentMetadata: clonePlain(resolved.parentMetadata),
      lineage: {
        project_id: resolved.project.id,
        asset_id: resolved.asset.id,
        parent_revision_id: resolved.revision.id,
        parent_job_id: resolved.revision.source_job_id,
        parent_processing_recipe_ref: resolved.parentProcessingRecipeRef,
      },
    })
    return sanitizePublicServiceResult(result)
  }

  async function getFrameRepairOperation({ projectId, assetId, operationId } = {}) {
    assertSafeRouteIds(projectId, assetId)
    if (!isFrameRepairOperationId(operationId)) {
      throw coordinatorError('invalid_frame_repair_request', 'Frame Repair operation id is invalid')
    }
    const result = await frameRepairService.getOperation({
      project_id: projectId,
      asset_id: assetId,
      operation_id: operationId,
    })
    return sanitizePublicServiceResult(result)
  }

  async function acceptFrameRepair({ projectId, assetId, jobId, body } = {}) {
    assertSafeRouteIds(projectId, assetId)
    if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) {
      throw coordinatorError('invalid_accept_request', 'Frame Repair job id is invalid')
    }
    const request = assertFrameRepairAcceptRequest(body)
    let acceptedRevisionId = null
    const saved = await mutateEditorProject({
      projectId,
      expectedRevision: request.expectedRevision,
      projectRoot,
      workspaceRoot,
      mutate: async (project) => {
        const asset = project.assets?.[assetId]
        if (!asset || asset.kind !== 'character_pack') {
          throw coordinatorError('asset_not_found', 'character asset not found')
        }
        if (asset.active_revision_id !== request.expectedAssetRevisionId) {
          throw coordinatorError('asset_revision_conflict', 'active character revision changed')
        }
        const parentRevision = asset.revisions?.[asset.active_revision_id]
        if (!parentRevision) {
          throw coordinatorError('asset_revision_conflict', 'active character revision no longer exists')
        }
        const job = await resolveAcceptanceJob({
          frameRepairService,
          generatedDir,
          projectId,
          assetId,
          jobId,
        })
        assertCompletedAcceptanceJob({
          job,
          project,
          asset,
          parentRevision,
          jobId,
          request,
          implementationRevision,
        })
        const entries = await verifySealedFrameRepairArtifacts({ generatedDir, job })
        const plan = parseCapturedJson(entries, 'frame_repair_plan')
        const context = parseCapturedJson(entries, 'frame_repair_context')
        const quality = parseCapturedJson(entries, 'frame_repair_quality')
        assertAcceptanceIdentity({
          plan,
          context,
          quality,
          job,
          project,
          asset,
          parentRevision,
          request,
          implementationRevision,
        })
        await assertAcceptancePackageDocuments({
          entries,
          plan,
          context,
          quality,
          project,
          asset,
          parentRevision,
          projectRoot,
          workspaceRoot,
        })
        await verifyAcceptancePixels({
          entries,
          plan,
          quality,
          project,
          asset,
          parentRevision,
          projectRoot,
          workspaceRoot,
        })
        assertQualityPolicy(quality, request)
        const imported = await importAcceptedFrameRepairAsAsset({
          project,
          assetId,
          jobId,
          projectRoot,
          workspaceRoot,
          verifiedPlan: plan,
          verifiedContext: context,
          verifiedQuality: quality,
          verifiedArtifactManifest: entries,
        })
        acceptedRevisionId = imported.revision.id
        return imported.project
      },
    })
    const acceptedAsset = saved.project.assets[assetId]
    return {
      project: saved.project,
      asset: acceptedAsset,
      revision: acceptedAsset.revisions[acceptedRevisionId],
      accepted: true,
    }
  }

  return Object.freeze({
    planFrameRepair,
    submitFrameRepair,
    getFrameRepairOperation,
    acceptFrameRepair,
  })
}
