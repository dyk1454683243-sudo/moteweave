import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE,
  FIXED_REGION_ACTION_REPAIR_JOB_TYPE,
  assertFixedRegionActionRepairAcceptanceManifest,
  assertFixedRegionActionRepairReviewContract,
  fixedRegionActionRepairArtifactKey,
  sha256ActionRepairBytes,
} from '../character-pack/fixedRegionActionRepairReview.js'
import { EDITOR_PROJECT_VERSION, SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { createDefaultEditorProject } from './defaults.js'
import { upgradeEditorProjectCopy } from './projectUpgrade.js'
import { createSpriteDocumentFromJob } from './spriteDocumentFromJob.js'
import {
  createEditorProjectV1,
  createBlankSpriteDocument,
  createSpriteDocumentFromManagedSource,
  createSpriteDocumentFromGeneralSequence,
  createSpriteDocumentFromMotionTimeline,
  createSpriteDocumentFromUploadedJpeg,
  createSpriteDocumentFromUploadedPng,
  encodeRgbaPng,
  createV1ApiReceipt,
  deriveWorkingSpriteDocument,
  getSpriteDocument,
  listSpriteDocuments,
  readSpriteBlock,
  detachCanvas,
  renameCanvas,
  resetCanvasName,
  restoreCanvas,
  promoteProjectReference,
  revokeProjectReference,
  readProjectReferencePng,
  restoreWorkingSpriteDocument,
  saveCanvasLayout,
  saveProjectPalette,
  writeWorkingPixels,
  createPixelScopeGrant,
  changeWorkingStructure,
} from './spriteDocumentStore.js'
import {
  SpriteDocumentError,
  isPixelEditorProject,
  parseCanvasLayoutRequest,
  parseProjectPaletteRequest,
  parseCreateDocumentRequest,
  parseCreateBlankRequest,
  parseCreateProjectRequest,
  parseDeriveWorkingRequest,
  parseFromJobRequest,
  parseGeneralSequenceQuery,
  parseMotionImportQuery,
  parseImportJpegQuery,
  parseImportPngQuery,
  parseDetachCanvasRequest,
  parseRenameCanvasRequest,
  parseResetCanvasNameRequest,
  parseRestoreCanvasRequest,
  parsePromoteProjectReferenceRequest,
  parseRevokeProjectReferenceRequest,
  parseRestoreWorkingRequest,
  parseWorkingStructureRequest,
  parseUpgradeCopyRequest,
  parseWorkingPixelsQuery,
  sha256Bytes,
  spriteDocumentError,
  WORKING_PIXELS_MAX_BYTES,
} from './spriteDocumentValidation.js'
import {
  MAX_MOTION_GIF_BYTES,
  MAX_MOTION_VIDEO_BYTES,
  stageMotionSource,
  probeVideoFile,
  resolveStagedMotionExtraction,
  formatMotionPreviewResponse,
} from './motionTimelineImport.js'
import {
  importAcceptedFixedRegionActionRepairAsAsset,
  importGeneratedJobAsAsset,
} from './artifactRegistry.js'
import {
  EditorAssetLibraryError,
  removeAssetFromProject,
  unlinkAssetFromScenes,
} from './assetLibrary.js'
import {
  createEditorProject,
  EditorProjectStoreError,
  listEditorProjects,
  loadEditorProject,
  mutateEditorProject,
  saveEditorProject,
} from './projectStore.js'
import { writeEditorProjectPackArtifacts } from './editorProjectPackWriter.js'
import {
  projectRelativePath,
  resolveContainedRegularFile,
  resolveEditorProjectPaths,
  resolveGeneratedJobArtifactFile,
  resolveManagedRevisionArtifactFile,
} from './paths.js'
import { isSafeRelativePath, isValidId } from './safety.js'
import { assistantConversations, safeAssistantFailure } from './assistantConversation.js'
import { externalBridgeService } from './externalBridgeService.js'
import { externalPixelSessions } from './externalPixelSession.js'
import { imageGeneration, safeImageFailure } from './imageGeneration.js'
import { subscriptionSheet, safeSubscriptionFailure } from './subscriptionSheet.js'
import { decodeGeneralSequenceBody, GENERAL_SEQUENCE_MAX_BODY_BYTES, packBitMask } from './generalSequenceBody.js'
import { assertLocalRequest, assertApiRequest, readBoundedBody, mediaType } from '../server/localRequest.js'

const ARTIFACT_CONTENT_TYPES = Object.freeze({
  '.avi': 'video/x-msvideo',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.m4v': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
})

async function readBody(req, { maxBytes } = {}) {
  return readBoundedBody(req, maxBytes)
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendBinary(res, status, contentType, bytes, headers = {}) {
  res.writeHead(status, { 'content-type': contentType, ...headers })
  res.end(bytes)
}

function sendFile(res, filePath) {
  res.writeHead(200, { 'content-type': ARTIFACT_CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

async function readJsonBody(req, { maxBytes } = {}) {
  try {
    const raw = (await readBody(req, { maxBytes })).toString('utf8')
    return raw ? JSON.parse(raw) : {}
  } catch (error) {
    if (error?.code === 'request_too_large') throw error
    const wrapped = new Error(`invalid JSON: ${error.message}`)
    wrapped.code = 'invalid_json'
    throw wrapped
  }
}

function expectedRevisionFromBody(body) {
  const value = body.expectedRevision ?? body.expected_revision
  return value == null ? null : Number(value)
}

const EDITOR_OPERATION_ERROR_STATUS = Object.freeze({
  invalid_recipe: 400,
  invalid_accept_request: 400,
  unexpected_request_field: 400,
  identity_mismatch: 400,
  unsafe_artifact_path: 400,
  specialized_accept_required: 400,
  invalid_managed_metadata: 400,
  invalid_managed_sheet: 400,
  invalid_managed_source: 400,
  unsupported_profile: 400,
  profile_conflict: 400,
  missing_source_layout: 400,
  invalid_implementation_revision: 400,
  project_not_found: 404,
  asset_not_found: 404,
  revision_not_found: 404,
  job_not_found: 404,
  artifact_not_found: 404,
  revision_conflict: 409,
  asset_revision_conflict: 409,
  accept_conflict: 409,
  stale_plan: 409,
  job_not_ready: 409,
  quality_blocked: 422,
  artifact_integrity_failed: 422,
  action_repair_unavailable: 503,
  provider_unavailable: 503,
  provider_configuration_error: 503,
  invalid_request: 400,
  forbidden_origin: 403,
  not_found: 404,
  stale_revision: 409,
  operation_conflict: 409,
  unsupported_project_writer: 409,
  resource_limit: 413,
  unsupported_input: 422,
  storage_commit_failed: 500,
})

function statusForError(error) {
  if (EDITOR_OPERATION_ERROR_STATUS[error?.code]) {
    return EDITOR_OPERATION_ERROR_STATUS[error.code]
  }
  if (error?.code === 'invalid_json') return 400
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_not_found') return 404
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_in_use') return 409
  if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') return 404
  if (error instanceof EditorProjectStoreError && error.code === 'revision_conflict') return 409
  return 400
}

function errorBody(error) {
  return {
    error: error.code ?? 'editor_project_error',
    reason: String(error.message || error),
    ...(error.details ? { details: error.details } : {}),
  }
}

function assertLocalV1Access(req) {
  assertLocalRequest(req)
}

function rejectProjectListPayload() {
  return spriteDocumentError('invalid_request', 'editor project list does not accept query or a request body')
}

function readFirstProjectListChunk(req) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded) {
      resolve({ chunk: null })
      return
    }
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      resolve(value)
    }
    const onData = (chunk) => {
      req.pause()
      finish({ chunk })
    }
    const onEnd = () => finish({ chunk: null })
    const onError = (error) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      reject(error)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

async function parseProjectListCursor(req, url) {
  let cursor = null
  if (url.search !== '') {
    const params = [...url.searchParams.entries()]
    if (params.length !== 1 || params[0][0] !== 'cursor' || !isValidId(params[0][1])) {
      throw rejectProjectListPayload()
    }
    cursor = params[0][1]
  }
  const declaredLength = req.headers?.['content-length']
  if (declaredLength != null && declaredLength !== '' && Number(declaredLength) !== 0) {
    throw rejectProjectListPayload()
  }
  const first = await readFirstProjectListChunk(req)
  if (first.chunk && first.chunk.length > 0) {
    req.resume()
    throw rejectProjectListPayload()
  }
  return cursor
}

function reasonLeaksPath(value) {
  const reason = String(value ?? '')
  return reason.includes('/') || reason.includes('\\')
}

function v1StatusForError(error) {
  if (error?.code === 'request_too_large') return 413
  if (error?.code === 'invalid_json') return 400
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 404
  if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EISDIR') return 422
  if (EDITOR_OPERATION_ERROR_STATUS[error?.code]) {
    return EDITOR_OPERATION_ERROR_STATUS[error.code]
  }
  if (error instanceof SpriteDocumentError) return EDITOR_OPERATION_ERROR_STATUS[error.code] ?? 400
  if (error instanceof EditorAssetLibraryError && error.code === 'unsupported_project_writer') return 409
  if (error instanceof EditorProjectStoreError && error.code === 'unsupported_project_writer') return 409
  if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') return 404
  if (error instanceof EditorProjectStoreError && error.code === 'revision_conflict') return 409
  return 500
}

function v1SafeErrorBody(error) {
  if (error?.code === 'invalid_json') {
    return { error: 'invalid_request', reason: 'v1 request is not valid JSON' }
  }
  if (error?.code === 'request_too_large') {
    return { error: 'resource_limit', reason: 'v1 request exceeds its byte limit' }
  }
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
    return { error: 'not_found', reason: 'v1 resource was not found' }
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EISDIR') {
    return { error: 'artifact_integrity_failed', reason: 'v1 resource could not be read' }
  }
  const approved = Boolean(EDITOR_OPERATION_ERROR_STATUS[error?.code])
    && (
      error instanceof SpriteDocumentError
      || error instanceof EditorProjectStoreError
      || error instanceof EditorAssetLibraryError
    )
  if (approved && !reasonLeaksPath(error.message)) {
    return {
      error: error.code,
      reason: String(error.message || error),
    }
  }
  return {
    error: approved ? error.code : 'storage_commit_failed',
    reason: 'v1 request failed',
  }
}

async function rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot, incomingProject = null) {
  if (incomingProject && incomingProject.version !== EDITOR_PROJECT_VERSION) {
    throw spriteDocumentError('unsupported_project_writer', 'legacy editor project writers cannot write editor_project_v1')
  }
  try {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    if (loaded.project.version !== EDITOR_PROJECT_VERSION) {
      throw spriteDocumentError('unsupported_project_writer', 'legacy editor project writers cannot write editor_project_v1')
    }
    return loaded
  } catch (error) {
    if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') return null
    throw error
  }
}

function sendBlock(res, block) {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': block.bytes.length,
    'x-sprite-block-sha256': block.sha256,
    'x-sprite-block-width': String(block.width),
    'x-sprite-block-height': String(block.height),
  })
  res.end(block.bytes)
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean)
}

function artifactUrls(artifacts = {}) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [
      `${key}_url`,
      `/api/editor/artifact?path=${encodeURIComponent(value)}`,
    ])
  )
}

function artifactPathError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createEditorArtifactAccessRegistry() {
  const registeredPaths = new Set()
  return Object.freeze({
    register(values) {
      const entries = typeof values === 'string' ? [values] : values ?? []
      for (const value of entries) registeredPaths.add(String(value))
    },
    has(value) {
      return registeredPaths.has(String(value))
    },
  })
}

export function findRecordedAssetArtifact(project, claimedPath) {
  for (const [assetId, asset] of Object.entries(project?.assets ?? {})) {
    for (const [revisionId, revision] of Object.entries(asset?.revisions ?? {})) {
      if (String(revision?.processing_recipe_ref ?? '').replaceAll('\\', '/') === claimedPath) {
        return { asset, assetId, revision, revisionId, artifactKey: 'processing_recipe' }
      }
      for (const [artifactKey, recordedPath] of Object.entries(revision?.artifacts ?? {})) {
        if (String(recordedPath ?? '').replaceAll('\\', '/') === claimedPath) {
          return { asset, assetId, revision, revisionId, artifactKey }
        }
      }
    }
  }
  return null
}

export async function resolveRegisteredWorkspaceArtifact(rawPath, {
  projectRoot,
  workspaceRoot,
  artifactAccessRegistry,
}) {
  const artifactPath = String(rawPath ?? '').replaceAll('\\', '/')
  if (!isSafeRelativePath(artifactPath)) {
    throw artifactPathError('unsafe_artifact_path', 'artifact path must be a safe relative project path')
  }

  const resolvedProjectRoot = path.resolve(projectRoot)
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  let workspacePrefix
  try {
    workspacePrefix = projectRelativePath(resolvedWorkspaceRoot, { projectRoot: resolvedProjectRoot })
  } catch {
    throw artifactPathError('unsafe_artifact_path', 'editor workspace must stay inside the project root')
  }
  const prefixParts = workspacePrefix.split('/')
  const artifactParts = artifactPath.split('/')
  const projectOffset = prefixParts.length
  if (
    !prefixParts.every((part, index) => artifactParts[index] === part) ||
    artifactParts[projectOffset] !== 'projects' ||
    !artifactParts[projectOffset + 1] ||
    artifactParts.length <= projectOffset + 2
  ) {
    throw artifactPathError('unsafe_artifact_path', 'artifact path must identify an editor project')
  }

  const projectId = artifactParts[projectOffset + 1]
  let loaded
  try {
    loaded = await loadEditorProject({ projectId, projectRoot: resolvedProjectRoot, workspaceRoot: resolvedWorkspaceRoot })
  } catch (error) {
    if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') throw error
    throw artifactPathError('unsafe_artifact_path', 'artifact project identity is invalid')
  }
  if (loaded.project.id !== projectId) {
    throw artifactPathError('unsafe_artifact_path', 'artifact project identity does not match its record')
  }

  const recorded = findRecordedAssetArtifact(loaded.project, artifactPath)
  if (recorded) {
    if (recorded.asset?.id !== recorded.assetId || recorded.revision?.id !== recorded.revisionId) {
      throw artifactPathError('unsafe_artifact_path', 'artifact asset identity does not match its record')
    }
    return resolveManagedRevisionArtifactFile({
      projectId,
      assetId: recorded.assetId,
      revision: recorded.revision,
      artifactKey: recorded.artifactKey,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
    })
  }

  if (!artifactAccessRegistry.has(artifactPath)) {
    throw artifactPathError('artifact_not_found', 'editor artifact not found')
  }
  return resolveContainedRegularFile({
    controlledRootPath: resolvedWorkspaceRoot,
    rootPath: resolvedWorkspaceRoot,
    candidatePath: path.resolve(resolvedProjectRoot, artifactPath),
    errorCode: 'unsafe_artifact_path',
  })
}

function actionRepairApiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function parseFixedRegionActionRepairAcceptRequest(body) {
  const expectedKeys = ['expectedAssetRevisionId', 'expectedPlanHash', 'expectedRevision']
  const keys = Object.keys(body ?? {}).sort()
  if (keys.length !== expectedKeys.length || expectedKeys.some((key, index) => keys[index] !== key)) {
    throw actionRepairApiError('invalid_accept_request', 'action repair Accept request has unexpected fields')
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      typeof body.expectedAssetRevisionId !== 'string' || !body.expectedAssetRevisionId ||
      !/^[A-Za-z0-9._-]{1,120}$/.test(body.expectedAssetRevisionId) ||
      body.expectedAssetRevisionId.includes('..') ||
      typeof body.expectedPlanHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedPlanHash)) {
    throw actionRepairApiError('invalid_accept_request', 'action repair Accept request is invalid')
  }
  return body
}

async function captureFixedRegionActionRepairAcceptance({ job, generatedDir }) {
  const manifestPath = await resolveGeneratedJobArtifactFile({
    jobId: job.id,
    fileName: FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE,
    allowedFiles: new Set([FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE]),
    generatedDir,
  })
  const manifestBuffer = await readFile(manifestPath)
  if (manifestBuffer.byteLength <= 0 || manifestBuffer.byteLength > 4 * 1024 * 1024 ||
      sha256ActionRepairBytes(manifestBuffer) !== job.action_repair_manifest_sha256) {
    throw actionRepairApiError('artifact_integrity_failed', 'action repair acceptance manifest changed')
  }
  let manifest
  try {
    manifest = assertFixedRegionActionRepairAcceptanceManifest(
      JSON.parse(manifestBuffer.toString('utf8')),
    )
  } catch {
    throw actionRepairApiError('artifact_integrity_failed', 'action repair acceptance manifest is invalid')
  }
  const allowedFiles = new Set(manifest.artifacts.map((entry) => entry.file_name))
  const captured = []
  let totalBytes = 0
  for (const entry of manifest.artifacts) {
    const filePath = await resolveGeneratedJobArtifactFile({
      jobId: job.id,
      fileName: entry.file_name,
      allowedFiles,
      generatedDir,
    })
    const content = await readFile(filePath)
    totalBytes += content.byteLength
    if (content.byteLength !== entry.byte_length || content.byteLength <= 0 ||
        totalBytes > 512 * 1024 * 1024 || sha256ActionRepairBytes(content) !== entry.sha256) {
      throw actionRepairApiError('artifact_integrity_failed', 'action repair candidate artifact changed')
    }
    captured.push({
      key: entry.key,
      fileName: entry.file_name,
      content,
      size: content.byteLength,
      sha256: entry.sha256,
    })
  }
  captured.push({
    key: fixedRegionActionRepairArtifactKey(FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE),
    fileName: FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE,
    content: manifestBuffer,
    size: manifestBuffer.byteLength,
    sha256: job.action_repair_manifest_sha256,
  })
  const reviewEntry = captured.find((entry) => entry.key === 'action_repair_review')
  if (!reviewEntry) throw actionRepairApiError('artifact_integrity_failed', 'action repair review contract is missing')
  let reviewContract
  try {
    reviewContract = assertFixedRegionActionRepairReviewContract(
      JSON.parse(reviewEntry.content.toString('utf8')),
    )
  } catch {
    throw actionRepairApiError('artifact_integrity_failed', 'action repair review contract is invalid')
  }
  return { manifest, manifestBuffer, reviewContract, captured }
}

function acceptedActionRepairRevision(project, assetId, jobId) {
  const asset = project?.assets?.[assetId]
  if (!asset) return null
  const revision = Object.values(asset.revisions ?? {}).find((item) => item.source_job_id === jobId)
  return revision ? { asset, revision } : null
}

export async function handleEditorProjectApi(req, res, options = {}) {
  const {
    projectRoot = process.cwd(),
    workspaceRoot = path.join(projectRoot, 'workspace'),
    generatedDir = path.join(projectRoot, 'generated'),
    specializedGeneratedDir = path.join(projectRoot, 'generated'),
    artifactAccessRegistry,
    getGeneratedJob = null,
    updateGeneratedJob = null,
    v1CommitFault = null,
  } = options
  if (
    !artifactAccessRegistry ||
    typeof artifactAccessRegistry.register !== 'function' ||
    typeof artifactAccessRegistry.has !== 'function'
  ) {
    throw new TypeError('artifactAccessRegistry is required')
  }
  const url = new URL(req.url, 'http://localhost')
  const parts = routeParts(url.pathname)
  if (url.pathname.startsWith('/api/editor/')) {
    try { assertApiRequest(req, url.pathname) } catch (error) {
      req.resume?.()
      return sendJson(res, error.http_status || 403, { error: error.code || 'forbidden_origin' })
    }
  }
  let v1Guarded = false
  const guardV1 = () => {
    assertLocalV1Access(req)
    v1Guarded = true
    if (req.method !== 'GET' && parts[4] !== 'upgrade-copy' && req.headers?.['x-editor-storage-version'] !== '2') {
      throw spriteDocumentError('unsupported_project_writer', 'Update the editor client before saving this project.')
    }
  }

  if (parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects' && parts[4] === 'pixel-tools') {
    try {
      assertLocalV1Access(req)
      const scope = { projectId: parts[3], projectRoot, workspaceRoot }
      const service = options.externalPixelSessions || externalPixelSessions
      if (url.search) return sendJson(res, 400, { error: 'invalid_pixel_tool_request' })
      if (req.method === 'GET' && parts.length === 6) return sendJson(res, 200, await service.review(scope, parts[5]))
      if (req.method === 'POST' && [5, 6].includes(parts.length)) {
        const body = await readJsonBody(req, { maxBytes: 68 * 1024 })
        return sendJson(res, 200, parts.length === 5 ? await service.create(scope, body) : await service.call(scope, parts[5], body))
      }
      return sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      const code = /^(pixel_tool_|invalid_pixel_tool_|assistant_)/.test(error.code || '') ? error.code : 'pixel_tool_request_failed'
      return sendJson(res, error.http_status || 422, { error: code, saved: false, ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) })
    }
  }

  if (parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects' && parts[4] === 'external-bridge') {
    try {
      assertLocalV1Access(req)
      const scope = { projectId: parts[3], projectRoot, workspaceRoot }
      const service = options.externalBridgeService || externalBridgeService
      if (req.method === 'GET' && parts.length === 5) {
        if (![...url.searchParams.keys()].every(key => key === 'canvas_id' || key === 'grant_id')) {
          return sendJson(res, 400, { error: 'invalid_pixel_tool_request' })
        }
        return sendJson(res, 200, await service.status(scope, {
          canvasId: url.searchParams.get('canvas_id') || null,
          grantId: url.searchParams.get('grant_id') || null,
        }))
      }
      if (req.method === 'POST' && !url.search) {
        const body = await readJsonBody(req, { maxBytes: 16 * 1024 })
        if (parts.length === 6 && parts[5] === 'connect') {
          const origin = `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers?.host || '127.0.0.1:4173'}`
          return sendJson(res, 200, await service.connect(scope, body, { origin }))
        }
        if (parts.length === 6 && parts[5] === 'revoke') {
          return sendJson(res, 200, await service.revoke(scope, body))
        }
        if (parts.length === 7 && parts[5] === 'aseprite' && parts[6] === 'checkout') {
          return sendJson(res, 200, await service.createAsepriteCheckout(scope, body))
        }
        if (parts.length === 9 && parts[5] === 'aseprite' && parts[6] === 'checkouts' && parts[8] === 'return') {
          return sendJson(res, 200, await service.returnAsepriteCheckout(scope, parts[7], body))
        }
      }
      return sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      const code = /^(pixel_tool_|invalid_pixel_tool_|aseprite_|runtime_storage_failed)/.test(error.code || '')
        ? error.code
        : 'pixel_tool_request_failed'
      return sendJson(res, error.http_status || 422, {
        error: code,
        reason: String(error.message || code),
        saved: false,
        ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      })
    }
  }

  if (parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects' && parts[4] === 'image-generation') {
    try {
      assertLocalV1Access(req)
      const scope = { projectId: parts[3], projectRoot, workspaceRoot }
      const service = options.imageGeneration || imageGeneration
      if (parts.length === 5 && !url.search) {
        if (req.method === 'GET') return sendJson(res, 200, await service.capabilities(scope))
        if (req.method === 'POST') {
          if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return sendJson(res, 415, { error: 'invalid_image_request' })
          return sendJson(res, 202, await service.start(scope, await readJsonBody(req, { maxBytes: 20 * 1024 })))
        }
      }
      if (req.method === 'GET' && parts.length === 6 && parts[5] === 'recent' && !url.search) return sendJson(res, 200, await service.list(scope))
      if (req.method === 'GET' && parts.length === 6 && !url.search) return sendJson(res, 200, await service.status(scope, parts[5]))
      if (req.method === 'GET' && parts.length === 7 && parts[6] === 'source' && !url.search) {
        const source = await service.source(scope, parts[5])
        res.writeHead(200, { 'Content-Type': source.mimeType, 'Content-Length': source.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        return res.end(source.bytes)
      }
      if (req.method === 'POST' && parts.length === 7 && parts[6] === 'import') {
        guardV1()
        if ((await readBody(req, { maxBytes: 1 })).length) return sendJson(res, 400, { error: 'invalid_image_request' })
        const source = await service.source(scope, parts[5])
        const parseQuery = source.mimeType === 'image/jpeg' ? parseImportJpegQuery : parseImportPngQuery
        const parsed = parseQuery(url.searchParams, url.search)
        const importer = source.mimeType === 'image/jpeg' ? createSpriteDocumentFromUploadedJpeg : createSpriteDocumentFromUploadedPng
        const result = await importer({ ...scope, operationId: parsed.operation_id, expectedRevision: parsed.expected_revision,
          expectedSha256: parsed.expected_sha256, name: parsed.name ?? undefined,
          pngBytes: source.bytes, jpegBytes: source.bytes, generatedSource: source.provenance,
          generatedOriginal: source.original, generatedTransformation: source.transformation,
          payload: { ...parsed.payload, generated_job_id: parts[5] }, fault: v1CommitFault })
        if (result.alreadyImported) return sendJson(res, 200, { project: result.project, already_imported: true })
        return sendJson(res, result.replayed ? 200 : 201, { project: result.project, document: result.document, receipt: createV1ApiReceipt(result.receipt) })
      }
      return sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      if (error instanceof SpriteDocumentError || error instanceof EditorProjectStoreError
        || ['invalid_json', 'request_too_large'].includes(error?.code)) return sendJson(res, v1StatusForError(error), v1SafeErrorBody(error))
      const safe = safeImageFailure(error)
      return sendJson(res, safe.status, safe.body)
    }
  }

  if (parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects' && parts[4] === 'subscription-sheet-candidates') {
    try {
      assertLocalV1Access(req)
      const scope = { projectId: parts[3], projectRoot, workspaceRoot }
      const service = options.subscriptionSheet || subscriptionSheet
      if (req.method === 'GET' && parts.length === 7 && parts[6] === 'processing' && !url.search) {
        return sendJson(res, 200, await service.processingJob(scope, parts[5], { getGeneratedJob, generatedDir }))
      }
      if (req.method === 'GET' && parts.length === 6 && parts[5] === 'current' && !url.search) return sendJson(res, 200, await service.current(scope))
      if (parts.length === 5 && !url.search && req.method === 'POST') {
        if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return sendJson(res, 415, { error: 'invalid_subscription_sheet_request' })
        return sendJson(res, 202, await service.start(scope, await readJsonBody(req, { maxBytes: 20 * 1024 })))
      }
      if (req.method === 'GET' && parts.length === 6 && !url.search) return sendJson(res, 200, await service.status(scope, parts[5]))
      if (req.method === 'GET' && parts.length === 7 && parts[6] === 'original' && !url.search) {
        const source = await service.original(scope, parts[5])
        res.writeHead(200, { 'Content-Type': source.mimeType, 'Content-Length': source.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        return res.end(source.bytes)
      }
      if (req.method === 'POST' && parts.length === 7 && ['accept', 'processing', 'add', 'added', 'reload'].includes(parts[6]) && !url.search) {
        if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return sendJson(res, 415, { error: 'invalid_subscription_sheet_request' })
        const body = await readJsonBody(req, { maxBytes: 8 * 1024 })
        const result = parts[6] === 'accept' ? await service.accept(scope, parts[5], body)
          : parts[6] === 'processing' ? await service.bindProcessing(scope, parts[5], body)
          : parts[6] === 'add' ? await service.reserveAdd(scope, parts[5], body)
          : parts[6] === 'added' ? await service.recordAdded(scope, parts[5], body)
          : await service.noteReload(scope, parts[5], body)
        return sendJson(res, 200, result)
      }
      return sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      const safe = safeSubscriptionFailure(error)
      return sendJson(res, safe.status, safe.body)
    }
  }

  if (parts.length === 6 && parts[0] === 'api' && parts[1] === 'editor'
    && parts[2] === 'projects' && parts[4] === 'assistant') {
    try {
      assertLocalV1Access(req)
      const scope = { projectId: parts[3], projectRoot, workspaceRoot }
      const service = options.assistantConversations || assistantConversations
      if (req.method === 'GET' && parts[5] === 'history'
        && [...url.searchParams.keys()].every(key => ['provider', 'shared'].includes(key))
        && url.searchParams.getAll('provider').length <= 1 && url.searchParams.getAll('shared').length <= 1
        && (!url.searchParams.has('shared') || url.searchParams.get('shared') === 'true')) {
        return sendJson(res, 200, await service.history(scope, url.searchParams.get('provider') || 'grok', { shared: url.searchParams.get('shared') === 'true' }))
      }
      if (req.method !== 'POST' || !['session', 'messages', 'resolve', 'document-grant', 'document-candidate', 'document-process'].includes(parts[5]) || url.search) {
        return sendJson(res, 404, { error: 'not_found' })
      }
      if (mediaType(req) !== 'application/json') {
        return sendJson(res, 415, { error: 'invalid_assistant_message' })
      }
      const body = await readJsonBody(req, { maxBytes: 20 * 1024 })
      const controller = new AbortController()
      const disconnected = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', disconnected)
      if (req.aborted || res.destroyed) controller.abort()
      try {
        const result = parts[5] === 'document-process' ? await service.processDocument(scope, body, controller.signal)
          : parts[5] === 'document-grant' ? await service.prepareDocument(scope, body)
          : parts[5] === 'document-candidate' ? await service.documentCandidate(scope, body)
          : parts[5] === 'session' ? await service.open(scope, body)
          : parts[5] === 'resolve' ? await service.resolve(scope, body)
          : await service.send(scope, body, controller.signal)
        if (!controller.signal.aborted) sendJson(res, 200, result)
      } finally { res.removeListener('close', disconnected) }
      return
    } catch (error) {
      const safe = safeAssistantFailure(error)
      if (!res.destroyed) return sendJson(res, safe.status, safe.body)
      return
    }
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/editor/health') {
      return sendJson(res, 200, { ok: true, version: 'editor_project_api_v0' })
    }

    if (req.method === 'GET' && url.pathname === '/api/editor/artifact') {
      const filePath = await resolveRegisteredWorkspaceArtifact(url.searchParams.get('path'), {
        projectRoot,
        workspaceRoot,
        artifactAccessRegistry,
      })
      return sendFile(res, filePath)
    }

    if (req.method === 'POST' && url.pathname === '/api/editor/projects/v1') {
      guardV1()
      const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
      const parsed = parseCreateProjectRequest(body)
      const result = await createEditorProjectV1({
        operationId: parsed.operation_id,
        name: parsed.name,
        payload: parsed.payload,
        projectRoot,
        workspaceRoot,
        fault: v1CommitFault,
      })
      return sendJson(res, result.replayed ? 200 : 201, {
        project: result.project,
        receipt: createV1ApiReceipt(result.receipt),
      })
    }

    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects') {
      guardV1()
      const cursor = await parseProjectListCursor(req, url)
      const listed = await listEditorProjects({ projectRoot, workspaceRoot, cursor, paginate: true })
      return sendJson(res, 200, listed)
    }

    if (req.method === 'POST' && url.pathname === '/api/editor/projects') {
      const body = await readJsonBody(req)
      const now = body.now ? new Date(body.now) : new Date()
      const project = body.project ?? createDefaultEditorProject({
        id: body.id ?? 'project_demo',
        name: body.name ?? 'Demo Project',
        createdAt: now,
        updatedAt: now,
        settings: body.settings,
      })
      await rejectLegacyWriteIfStoredV1(project.id, projectRoot, workspaceRoot, body.project ?? null)
      const result = body.project
        ? await saveEditorProject({ project, projectRoot, workspaceRoot, now })
        : await createEditorProject({ id: project.id, name: project.name, projectRoot, workspaceRoot, now, settings: project.settings })
      return sendJson(res, 201, {
        project: result.project,
        saved: result.saved,
      })
    }

    if (parts[0] === 'api' && parts[1] === 'editor' && parts[2] === 'projects' && parts[3]) {
      const projectId = parts[3]
      if (req.method === 'POST' && parts[4] === 'upgrade-copy' && parts.length === 5) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseUpgradeCopyRequest(body)
        const result = await upgradeEditorProjectCopy({
          sourceProjectId: projectId,
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          name: parsed.name ?? undefined,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, result.replayed ? 200 : 201, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (req.method === 'POST' && parts[4] === 'canvas-layout' && parts.length === 5) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseCanvasLayoutRequest(body)
        const result = await saveCanvasLayout({
          projectId,
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          positions: parsed.positions,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, 200, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (req.method === 'POST' && parts[4] === 'palette' && parts.length === 5) {
        guardV1()
        const parsed = parseProjectPaletteRequest(await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxPaletteRequestBytes }))
        const result = await saveProjectPalette({ projectId, operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision, colors: parsed.colors,
          ...(parsed.items ? { active_id: parsed.active_id, items: parsed.items } : {}),
          projectRoot, workspaceRoot, fault: v1CommitFault })
        return sendJson(res, 200, { project: result.project, receipt: createV1ApiReceipt(result.receipt) })
      }

      if (req.method === 'POST' && parts[4] === 'canvases' && parts[6] === 'rename' && parts.length === 7) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseRenameCanvasRequest(body, parts[5])
        const result = await renameCanvas({
          projectId,
          canvasId: parts[5],
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          displayName: parsed.display_name,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, 200, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (req.method === 'POST' && parts[4] === 'canvases' && parts[6] === 'reset-name' && parts.length === 7) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseResetCanvasNameRequest(body, parts[5])
        const result = await resetCanvasName({
          projectId,
          canvasId: parts[5],
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, 200, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (req.method === 'POST' && parts[4] === 'canvases' && parts[6] === 'detach' && parts.length === 7) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseDetachCanvasRequest(body, parts[5])
        const result = await detachCanvas({
          projectId,
          canvasId: parts[5],
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, 200, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (req.method === 'POST' && parts[4] === 'canvases' && parts[6] === 'restore' && parts.length === 7) {
        guardV1()
        const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
        const parsed = parseRestoreCanvasRequest(body, parts[5])
        const result = await restoreCanvas({
          projectId,
          canvasId: parts[5],
          operationId: parsed.operation_id,
          expectedRevision: parsed.expected_revision,
          detachOperationId: parsed.detach_operation_id,
          payload: parsed.payload,
          projectRoot,
          workspaceRoot,
          fault: v1CommitFault,
        })
        return sendJson(res, 200, {
          project: result.project,
          receipt: createV1ApiReceipt(result.receipt),
        })
      }

      if (parts[4] === 'references') {
        guardV1()
        if (req.method === 'POST' && parts.length === 5 && !url.search) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parsePromoteProjectReferenceRequest(body)
          const result = await promoteProjectReference({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            canvasId: parsed.canvas_id,
            documentId: parsed.document_id,
            workingRevision: parsed.working_revision,
            frameId: parsed.frame_id,
            layerId: parsed.layer_id,
            sourceKind: parsed.source_kind,
            purpose: parsed.purpose,
            name: parsed.name,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            reference: result.reference,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[6] === 'revoke' && parts.length === 7 && !url.search) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseRevokeProjectReferenceRequest(body, parts[5])
          const result = await revokeProjectReference({
            projectId,
            referenceId: parsed.reference_id,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, 200, {
            project: result.project,
            reference: result.reference,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'GET' && parts[6] === 'png' && parts.length === 7) {
          const result = await readProjectReferencePng({
            projectId,
            referenceId: parts[5],
            projectRoot,
            workspaceRoot,
          })
          return sendBinary(res, 200, 'image/png', result.pngBytes, {
            'Cache-Control': 'no-store',
            'X-Reference-Sha256': result.sha256,
          })
        }
      }

      if (parts[4] === 'sprite-documents') {
        guardV1()
        if (req.method === 'POST' && parts[5] === 'blank' && parts.length === 6) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseCreateBlankRequest(body)
          const result = await createBlankSpriteDocument({ projectId, operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision, width: parsed.width, height: parsed.height,
            name: parsed.name ?? undefined, payload: parsed.payload, projectRoot, workspaceRoot, fault: v1CommitFault })
          return sendJson(res, result.replayed ? 200 : 201, { project: result.project, document: result.document,
            canvas: result.canvas, receipt: createV1ApiReceipt(result.receipt) })
        }
        if (req.method === 'POST' && parts[5] === 'derive-working' && parts.length === 6) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseDeriveWorkingRequest(body)
          const result = await deriveWorkingSpriteDocument({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            sourceCanvasId: parsed.source_canvas_id,
            sourceDocumentId: parsed.source_document_id,
            sourceRevision: parsed.source_revision,
            name: parsed.name ?? undefined,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            canvas: result.canvas,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[5] === 'from-job' && parts.length === 6) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseFromJobRequest(body)
          const result = await createSpriteDocumentFromJob({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            source: parsed.source,
            name: parsed.name ?? undefined,
            payload: parsed.payload,
            getGeneratedJob: async jobId => (options.subscriptionSheet || subscriptionSheet).recoverProcessJob(
              { projectId, projectRoot, workspaceRoot }, jobId, { generatedDir, currentJob: await getGeneratedJob?.(jobId) }),
            generatedDir,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[5] === 'general-sequence' && parts.length === 6) {
          const parsed = parseGeneralSequenceQuery(url.searchParams, url.search)
          const mediaTypeName = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (mediaTypeName !== 'application/octet-stream') {
            throw spriteDocumentError('invalid_request', 'general-sequence requires Content-Type application/octet-stream')
          }
          const body = await readBody(req, { maxBytes: GENERAL_SEQUENCE_MAX_BODY_BYTES })
          const digest = sha256Bytes(body)
          if (digest !== parsed.expected_sha256) {
            throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
          }
          let frames
          try { frames = decodeGeneralSequenceBody(body) } catch (error) {
            throw spriteDocumentError(error.code || 'invalid_request', error.message)
          }
          let generatedSource = null
          let generatedOriginal = null
          let generatedTransformation = null
          if (parsed.source_job_id) {
            if (frames.length !== 1) {
              throw spriteDocumentError('invalid_request', 'source_job_id requires a single-frame sequence')
            }
            const service = options.imageGeneration || imageGeneration
            let genSource
            try {
              genSource = await service.source({ projectId, projectRoot, workspaceRoot }, parsed.source_job_id)
            } catch (error) {
              const safe = safeImageFailure(error)
              return sendJson(res, safe.status, safe.body)
            }
            if (sha256Bytes(frames[0].bytes) !== sha256Bytes(genSource.bytes)) {
              throw spriteDocumentError('artifact_integrity_failed', 'generated source bytes do not match source_job_id')
            }
            generatedSource = genSource.provenance
            generatedOriginal = genSource.original ?? null
            generatedTransformation = genSource.transformation ?? null
          }
          const reqAbort = parsed.preview ? new AbortController() : null
          if (reqAbort) {
            const onAbort = () => {
              if (!res.writableEnded) reqAbort.abort()
            }
            req.on('aborted', onAbort)
            res.on('close', onAbort)
          }
          let result
          try {
            result = await createSpriteDocumentFromGeneralSequence({
              projectId,
              operationId: parsed.operation_id,
              expectedRevision: parsed.expected_revision,
              expectedSha256: parsed.expected_sha256,
              frames,
              background: parsed.background,
              name: parsed.name ?? undefined,
              payload: parsed.payload,
              preview: parsed.preview,
              appendDocumentId: parsed.append_document_id,
              generatedSource,
              generatedOriginal,
              generatedTransformation,
              signal: reqAbort?.signal ?? null,
              projectRoot,
              workspaceRoot,
              fault: v1CommitFault,
            })
          } catch (error) {
            if (error?.name === 'AbortError' || error?.code === 'aborted') {
              if (!res.writableEnded) res.destroy()
              return
            }
            throw error
          }
          if (result.preview) {
            return sendJson(res, 200, {
              preview: true,
              background: result.sequence.background,
              canvas: { w: result.sequence.width, h: result.sequence.height },
              anchor: result.sequence.anchor,
              scaled: false,
              canvas_uniform: result.sequence.canvasUniform === true,
              grid_consistent: result.sequence.gridConsistent === true,
              grid_reason: result.sequence.gridReason,
              frames: result.sequence.frames.map((frame) => ({
                width: frame.width,
                height: frame.height,
                placed_width: result.sequence.width,
                placed_height: result.sequence.height,
                padded: frame.width !== result.sequence.width || frame.height !== result.sequence.height,
                transparent_source: frame.transparentSource,
                background: frame.background,
                background_status: frame.backgroundStatus,
                background_reason: frame.backgroundReason,
                background_color: frame.backgroundColor,
                recovery_status: frame.recovery.status,
                recovery_reason: frame.recovery.reason,
                step_x: frame.recovery.step_x ?? null,
                step_y: frame.recovery.step_y ?? null,
                exact_recovery: frame.recovery.exact_recovery,
                proposal_count: frame.proposedCount ?? frame.proposed.length,
                proposal_mask_base64: Buffer.from(packBitMask(frame.width, frame.height, frame.proposedMask || frame.proposed)).toString('base64'),
                c_png_base64: encodeRgbaPng(frame.width, frame.height, frame.cRgba).toString('base64'),
              })),
            })
          }
          if (result.alreadyImported) {
            return sendJson(res, 200, { project: result.project, already_imported: true })
          }
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[5] === 'motion-import' && parts.length === 6) {
          const parsed = parseMotionImportQuery(url.searchParams, url.search)
          const maxBytes = parsed.kind === 'gif' ? MAX_MOTION_GIF_BYTES : MAX_MOTION_VIDEO_BYTES
          const body = await readBody(req, { maxBytes })
          const reqAbort = parsed.action !== 'commit' ? new AbortController() : null
          if (reqAbort) {
            const onAbort = () => {
              if (!res.writableEnded) reqAbort.abort()
            }
            req.on('aborted', onAbort)
            res.on('close', onAbort)
          }
          try {
            if (parsed.action === 'probe') {
              const entry = await stageMotionSource({
                projectId,
                expectedSha256: parsed.expected_sha256,
                sourceBytes: body.length > 0 ? body : null,
                fileName: parsed.file_name,
              })
              if (entry.kind !== 'video') {
                throw spriteDocumentError('invalid_request', 'probe action is only supported for video sources')
              }
              if (!entry.probe) {
                entry.probe = await probeVideoFile(entry.filePath, { signal: reqAbort?.signal ?? null })
              }
              return sendJson(res, 200, {
                probe: true,
                kind: 'video',
                source_sha256: entry.sha256,
                file_name: entry.fileName,
                ...entry.probe,
              })
            }
            if (parsed.action === 'preview') {
              const entry = await stageMotionSource({
                projectId,
                expectedSha256: parsed.expected_sha256,
                sourceBytes: body.length > 0 ? body : null,
                fileName: parsed.file_name,
              })
              const extracted = await resolveStagedMotionExtraction(entry, parsed, {
                signal: reqAbort?.signal ?? null,
              })
              const previewPayload = await formatMotionPreviewResponse(entry, extracted, {
                signal: reqAbort?.signal ?? null,
              })
              return sendJson(res, 200, previewPayload)
            }
            let entry = null
            let extracted = null
            try {
              entry = await stageMotionSource({
                projectId,
                expectedSha256: parsed.expected_sha256,
                sourceBytes: body.length > 0 ? body : null,
                fileName: parsed.file_name,
              })
            } catch (stageError) {
              if (body.length > 0) throw stageError
            }
            if (entry) {
              extracted = await resolveStagedMotionExtraction(entry, parsed)
            }
            const result = await createSpriteDocumentFromMotionTimeline({
              projectId,
              operationId: parsed.operation_id,
              expectedRevision: parsed.expected_revision,
              expectedSha256: parsed.expected_sha256,
              sourceBytes: entry?.bytes || (body.length > 0 ? body : null),
              sourceFilePath: entry?.filePath || null,
              sourceKind: entry?.kind || parsed.kind || 'gif',
              sourceExt: entry?.ext || (parsed.kind === 'video' ? 'mp4' : 'gif'),
              sourceMimeType: entry?.mimeType || (parsed.kind === 'video' ? 'video/mp4' : 'image/gif'),
              sourceFileName: entry?.fileName || parsed.file_name || 'source',
              extracted,
              name: parsed.name ?? undefined,
              payload: parsed.payload,
              projectRoot,
              workspaceRoot,
              fault: v1CommitFault,
            })
            return sendJson(res, result.replayed ? 200 : 201, {
              project: result.project,
              document: result.document,
              canvas: result.canvas,
              receipt: createV1ApiReceipt(result.receipt),
            })
          } catch (error) {
            if (error?.name === 'AbortError' || error?.code === 'aborted') {
              if (!res.writableEnded) res.destroy()
              return
            }
            throw error
          }
        }
        if (req.method === 'POST' && parts[5] === 'import-png' && parts.length === 6) {
          const parsed = parseImportPngQuery(url.searchParams, url.search)
          const mediaType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (mediaType !== 'image/png') {
            throw spriteDocumentError('invalid_request', 'import-png requires Content-Type image/png')
          }
          const pngBytes = await readBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes })
          const result = await createSpriteDocumentFromUploadedPng({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            expectedSha256: parsed.expected_sha256,
            pngBytes,
            name: parsed.name ?? undefined,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[5] === 'import-jpeg' && parts.length === 6) {
          const parsed = parseImportJpegQuery(url.searchParams, url.search)
          const mediaType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (mediaType !== 'image/jpeg') {
            throw spriteDocumentError('invalid_request', 'import-jpeg requires Content-Type image/jpeg')
          }
          const jpegBytes = await readBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes })
          const result = await createSpriteDocumentFromUploadedJpeg({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            expectedSha256: parsed.expected_sha256,
            jpegBytes,
            name: parsed.name ?? undefined,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[6] === 'scope-grants' && parts.length === 7 && !url.search) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const grant = await createPixelScopeGrant({ projectId, documentId: parts[5], body, projectRoot, workspaceRoot })
          return sendJson(res, 200, { grant })
        }
        if (req.method === 'POST' && parts[6] === 'working-pixels' && parts.length === 7) {
          const parsed = parseWorkingPixelsQuery(url.searchParams, url.search, parts[5])
          const mediaType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (mediaType !== 'application/octet-stream') {
            throw spriteDocumentError('invalid_request', 'working-pixels requires Content-Type application/octet-stream')
          }
          const expectedLength = parsed.w * parsed.h * 4
          const rgba = await readBody(req, { maxBytes: WORKING_PIXELS_MAX_BYTES })
          if (expectedLength > WORKING_PIXELS_MAX_BYTES) {
            throw spriteDocumentError('resource_limit', 'working pixels exceed 4MiB', {
              limit: WORKING_PIXELS_MAX_BYTES,
            })
          }
          const result = await writeWorkingPixels({
            projectId,
            documentId: parts[5],
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            expectedWorkingRevision: parsed.expected_working_revision,
            rect: { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h },
            rgba,
            expectedSha256: parsed.expected_sha256,
            target: parsed.frame_id ? { frame_id: parsed.frame_id, layer_id: parsed.layer_id, cel_id: parsed.cel_id } : undefined,
            grantId: parsed.grant_id,
            commandSha256: parsed.command_sha256,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, 200, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts[6] === 'working-structure' && parts.length === 7) {
          if (url.search) throw spriteDocumentError('invalid_request', 'query parameters are not supported')
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseWorkingStructureRequest(body, parts[5])
          const result = await changeWorkingStructure({ projectId, documentId: parts[5], operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision, expectedWorkingRevision: parsed.expected_working_revision,
            command: parsed.command, payload: parsed.payload, projectRoot, workspaceRoot, fault: v1CommitFault })
          return sendJson(res, 200, { project: result.project, document: result.document, receipt: createV1ApiReceipt(result.receipt) })
        }
        if (req.method === 'POST' && parts[6] === 'restore-working' && parts.length === 7) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseRestoreWorkingRequest(body, parts[5])
          const result = await restoreWorkingSpriteDocument({
            projectId,
            documentId: parts[5],
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            expectedWorkingRevision: parsed.expected_working_revision,
            targetRevision: parsed.target_revision,
            mode: parsed.mode,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, 200, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'POST' && parts.length === 5) {
          const body = await readJsonBody(req, { maxBytes: SPRITE_DOCUMENT_LIMITS.maxJsonRequestBytes })
          const parsed = parseCreateDocumentRequest(body)
          const result = await createSpriteDocumentFromManagedSource({
            projectId,
            operationId: parsed.operation_id,
            expectedRevision: parsed.expected_revision,
            source: parsed.source,
            name: parsed.name ?? undefined,
            payload: parsed.payload,
            projectRoot,
            workspaceRoot,
            fault: v1CommitFault,
          })
          return sendJson(res, result.replayed ? 200 : 201, {
            project: result.project,
            document: result.document,
            receipt: createV1ApiReceipt(result.receipt),
          })
        }
        if (req.method === 'GET' && parts.length === 5) {
          const result = await listSpriteDocuments({ projectId, projectRoot, workspaceRoot })
          return sendJson(res, 200, { documents: result.documents })
        }
        if (req.method === 'GET' && parts.length === 6) {
          const revisionParam = url.searchParams.get('revision')
          const revision = revisionParam == null ? null : Number(revisionParam)
          if (revisionParam != null && !Number.isInteger(revision)) {
            throw spriteDocumentError('invalid_request', 'revision must be an integer')
          }
          const result = await getSpriteDocument({
            projectId,
            documentId: parts[5],
            revision,
            projectRoot,
            workspaceRoot,
          })
          return sendJson(res, 200, {
            document: result.manifest,
            revision: result.revision,
            manifest_sha256: result.manifest_sha256,
          })
        }
        if (req.method === 'GET' && parts[6] === 'blocks' && parts.length === 8) {
          const block = await readSpriteBlock({
            projectId,
            documentId: parts[5],
            sha256: parts[7],
            projectRoot,
            workspaceRoot,
          })
          return sendBlock(res, block)
        }
      }

      if (req.method === 'GET' && parts.length === 4) {
        const result = await loadEditorProject({ projectId, projectRoot, workspaceRoot, autosave: url.searchParams.get('autosave') === 'true' })
        if (isPixelEditorProject(result.project)) guardV1()
        return sendJson(res, 200, { project: result.project })
      }

      if (req.method === 'PUT' && parts.length === 4) {
        const body = await readJsonBody(req)
        if (!body.project) return sendJson(res, 400, { error: 'missing_project', reason: 'project is required' })
        if (body.project.id !== projectId) return sendJson(res, 400, { error: 'project_id_mismatch', reason: 'path project id must match project.id' })
        await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot, body.project)
        const expectedRevision = expectedRevisionFromBody(body)
        if (expectedRevision == null) return sendJson(res, 400, { error: 'missing_expected_revision', reason: 'expectedRevision is required for formal saves' })
        const result = await mutateEditorProject({
          projectId,
          expectedRevision,
          projectRoot,
          workspaceRoot,
          mutate: () => body.project,
        })
        return sendJson(res, 200, { project: result.project, saved: result.saved })
      }

      if (req.method === 'POST' && parts[4] === 'autosave' && parts.length === 5) {
        const body = await readJsonBody(req)
        if (!body.project) return sendJson(res, 400, { error: 'missing_project', reason: 'project is required' })
        if (body.project.id !== projectId) return sendJson(res, 400, { error: 'project_id_mismatch', reason: 'path project id must match project.id' })
        await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot, body.project)
        const result = await saveEditorProject({ project: body.project, projectRoot, workspaceRoot, autosave: true })
        return sendJson(res, 200, { project: result.project, saved: result.saved })
      }

      if (req.method === 'POST' && parts[4] === 'import-job' && parts.length === 5) {
        const body = await readJsonBody(req)
        await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot)
        const jobId = body.jobId ?? body.job_id
        const recordedGeneratedJob = getGeneratedJob?.(jobId)
        if (recordedGeneratedJob?.type === 'fixed_region_source_provider_repair') {
          const error = new Error('specialized editor jobs require specialized acceptance')
          error.code = 'specialized_accept_required'
          throw error
        }
        const expectedRevision = expectedRevisionFromBody(body)
        if (expectedRevision == null) return sendJson(res, 400, { error: 'missing_expected_revision', reason: 'expectedRevision is required for artifact imports' })
        let imported
        const saved = await mutateEditorProject({
          projectId,
          expectedRevision,
          projectRoot,
          workspaceRoot,
          mutate: async (project) => {
            const assetId = body.assetId ?? body.asset_id
            const expectedAssetRevisionId = body.expectedAssetRevisionId ?? body.expected_asset_revision_id
            if (expectedAssetRevisionId != null) {
              if (typeof expectedAssetRevisionId !== 'string' || !expectedAssetRevisionId.trim()) {
                const error = new Error('expectedAssetRevisionId must be a non-empty string')
                error.code = 'invalid_accept_request'
                throw error
              }
              const targetAsset = project.assets?.[assetId]
              if (!targetAsset || targetAsset.active_revision_id !== expectedAssetRevisionId ||
                  !targetAsset.revisions?.[expectedAssetRevisionId]) {
                const error = new Error('active asset revision changed before candidate acceptance')
                error.code = 'asset_revision_conflict'
                throw error
              }
            }
            imported = await importGeneratedJobAsAsset({
              project,
              kind: body.kind,
              jobId,
              generatedDir,
              specializedContextGeneratedDir: specializedGeneratedDir,
              projectRoot,
              workspaceRoot,
              assetId,
              name: body.name,
              productionStatus: body.productionStatus ?? body.production_status,
              readyOverrideReason: body.readyOverrideReason ?? body.ready_override_reason,
            })
            return imported.project
          },
        })
        return sendJson(res, 200, {
          project: saved.project,
          asset: saved.project.assets[imported.asset.id],
          revision: imported.revision,
          saved: saved.saved,
        })
      }

      if (req.method === 'POST' && parts[4] === 'export-pack' && parts.length === 5) {
        const body = await readJsonBody(req)
        const expectedRevision = expectedRevisionFromBody(body)
        if (expectedRevision == null) return sendJson(res, 400, { error: 'missing_expected_revision', reason: 'expectedRevision is required for project pack exports' })
        const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
        if (loaded.project.version !== EDITOR_PROJECT_VERSION) {
          throw spriteDocumentError('unsupported_input', 'editor_project_v1 export-pack is unsupported')
        }
        if (loaded.project.revision !== expectedRevision) {
          throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
            expected_revision: expectedRevision,
            current_revision: loaded.project.revision,
          })
        }
        const now = body.now ? new Date(body.now) : new Date()
        const exported = await writeEditorProjectPackArtifacts({
          project: loaded.project,
          projectRoot,
          workspaceRoot,
          exportId: body.exportId ?? body.export_id,
          now,
        })
        artifactAccessRegistry.register(Object.values(exported.artifacts))
        return sendJson(res, 200, {
          export: {
            id: exported.export_id,
            status: exported.status,
            artifacts: exported.artifacts,
            urls: artifactUrls(exported.artifacts),
            validation: exported.pack.validationReport,
            review_status: exported.pack.reviewStatus,
          },
        })
      }

      if (parts[4] === 'assets' && parts[5]) {
        const assetId = parts[5]

        if (req.method === 'POST' && parts[6] === 'action-repair' && parts[7] &&
            parts[8] === 'accept' && parts.length === 9) {
          if (typeof getGeneratedJob !== 'function' || typeof updateGeneratedJob !== 'function') {
            return sendJson(res, 503, {
              error: 'action_repair_unavailable',
              reason: 'action repair acceptance is unavailable',
            })
          }
          await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot)
          const body = parseFixedRegionActionRepairAcceptRequest(await readJsonBody(req, { maxBytes: 32 * 1024 }))
          const jobId = parts[7]
          const job = getGeneratedJob(jobId)
          if (!job) throw actionRepairApiError('job_not_found', 'action repair candidate job not found')
          if (job.type !== 'fixed_region_source_provider_repair') {
            throw actionRepairApiError('identity_mismatch', 'candidate is not a three-atlas action repair job')
          }
          if (job.status !== 'done') {
            throw actionRepairApiError('job_not_ready', 'action repair candidate is not ready for acceptance')
          }
          if (job.project_id !== projectId || job.asset_id !== assetId ||
              job.parent_revision_id !== body.expectedAssetRevisionId ||
              job.action_repair_plan_hash !== body.expectedPlanHash ||
              job.provider_call_budget?.used_provider_calls !== 1 ||
              job.repair_status !== 'source_repaired' || job.source_scope_status !== 'scope_pass' ||
              job.outside_selected_changed_pixels !== 0 ||
              typeof job.action_repair_manifest_sha256 !== 'string' ||
              !/^[a-f0-9]{64}$/.test(job.action_repair_manifest_sha256)) {
            throw actionRepairApiError('identity_mismatch', 'action repair candidate job identity is incomplete')
          }
          if (job.accepted === true) {
            const current = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
            const accepted = acceptedActionRepairRevision(current.project, assetId, jobId)
            if (!accepted || accepted.revision.parent_revision_id !== job.parent_revision_id ||
                accepted.revision.id !== job.accepted_revision_id) {
              throw actionRepairApiError('accept_conflict', 'accepted action repair revision identity changed')
            }
            return sendJson(res, 200, {
              project: current.project,
              asset: accepted.asset,
              revision: accepted.revision,
              saved: 'already_accepted',
            })
          }
          const captured = await captureFixedRegionActionRepairAcceptance({
            job,
            generatedDir: specializedGeneratedDir,
          })
          const manifest = captured.manifest
          if (manifest.job_id !== job.id || manifest.identity.project_id !== projectId ||
              manifest.identity.asset_id !== assetId ||
              manifest.identity.parent_revision_id !== body.expectedAssetRevisionId ||
              manifest.identity.source_job_id !== job.source_job_id ||
              manifest.review.plan_hash !== body.expectedPlanHash ||
              manifest.review.review_id !== job.action_repair_review_id ||
              manifest.review.reference_manifest_sha256 !== job.action_repair_reference_manifest_sha256 ||
              captured.reviewContract.plan_hash !== body.expectedPlanHash) {
            throw actionRepairApiError('identity_mismatch', 'sealed action repair candidate identity changed')
          }

          const existingLoaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
          const existing = acceptedActionRepairRevision(existingLoaded.project, assetId, jobId)
          if (existing) {
            if (existing.revision.parent_revision_id !== manifest.identity.parent_revision_id) {
              throw actionRepairApiError('accept_conflict', 'accepted action repair revision identity changed')
            }
            await updateGeneratedJob(jobId, {
              accepted: true,
              requires_user_confirmation: false,
              accepted_revision_id: existing.revision.id,
            })
            return sendJson(res, 200, {
              project: existingLoaded.project,
              asset: existing.asset,
              revision: existing.revision,
              saved: 'already_accepted',
            })
          }

          let imported
          let saved
          try {
            saved = await mutateEditorProject({
              projectId,
              expectedRevision: body.expectedRevision,
              projectRoot,
              workspaceRoot,
              mutate: async (project) => {
                const asset = project.assets?.[assetId]
                if (!asset || asset.active_revision_id !== body.expectedAssetRevisionId ||
                    !asset.revisions?.[body.expectedAssetRevisionId]) {
                  throw actionRepairApiError('asset_revision_conflict', 'active asset revision changed before action repair acceptance')
                }
                imported = await importAcceptedFixedRegionActionRepairAsAsset({
                  project,
                  assetId,
                  jobId,
                  projectRoot,
                  workspaceRoot,
                  verifiedReviewContract: captured.reviewContract,
                  verifiedAcceptanceManifest: manifest,
                  verifiedArtifactManifest: captured.captured,
                })
                return imported.project
              },
            })
          } catch (error) {
            if (['revision_conflict', 'accept_conflict'].includes(error?.code)) {
              const current = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
              const accepted = acceptedActionRepairRevision(current.project, assetId, jobId)
              if (accepted && accepted.revision.parent_revision_id === manifest.identity.parent_revision_id) {
                await updateGeneratedJob(jobId, {
                  accepted: true,
                  requires_user_confirmation: false,
                  accepted_revision_id: accepted.revision.id,
                })
                return sendJson(res, 200, {
                  project: current.project,
                  asset: accepted.asset,
                  revision: accepted.revision,
                  saved: 'already_accepted',
                })
              }
            }
            throw error
          }
          await updateGeneratedJob(jobId, {
            accepted: true,
            requires_user_confirmation: false,
            accepted_revision_id: imported.revision.id,
          })
          return sendJson(res, 200, {
            project: saved.project,
            asset: saved.project.assets[assetId],
            revision: imported.revision,
            saved: saved.saved,
          })
        }

        if (req.method === 'POST' && parts[6] === 'unlink' && parts.length === 7) {
          const body = await readJsonBody(req)
          await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot)
          const expectedRevision = expectedRevisionFromBody(body)
          if (expectedRevision == null) {
            return sendJson(res, 400, {
              error: 'missing_expected_revision',
              reason: 'expectedRevision is required for asset unlink',
            })
          }
          let unlinked
          const saved = await mutateEditorProject({
            projectId,
            expectedRevision,
            projectRoot,
            workspaceRoot,
            mutate: (project) => {
              unlinked = unlinkAssetFromScenes(project, assetId)
              return unlinked.project
            },
          })
          return sendJson(res, 200, {
            project: saved.project,
            asset: saved.project.assets[assetId],
            usage: unlinked.usage,
            removed_layers: unlinked.removed_layers,
            saved: saved.saved,
          })
        }

        if (req.method === 'DELETE' && parts.length === 6) {
          const body = await readJsonBody(req)
          await rejectLegacyWriteIfStoredV1(projectId, projectRoot, workspaceRoot)
          const expectedRevision = expectedRevisionFromBody(body)
          if (expectedRevision == null) {
            return sendJson(res, 400, {
              error: 'missing_expected_revision',
              reason: 'expectedRevision is required for asset deletion',
            })
          }
          let removed
          const saved = await mutateEditorProject({
            projectId,
            expectedRevision,
            projectRoot,
            workspaceRoot,
            mutate: (project) => {
              removed = removeAssetFromProject(project, assetId)
              return removed.project
            },
          })
          return sendJson(res, 200, {
            project: saved.project,
            asset: removed.asset,
            usage: removed.usage,
            saved: saved.saved,
          })
        }
      }
    }

    return sendJson(res, 404, { error: 'not_found' })
  } catch (error) {
    if (v1Guarded) {
      return sendJson(res, v1StatusForError(error), v1SafeErrorBody(error))
    }
    return sendJson(res, statusForError(error), errorBody(error))
  }
}

export function editorProjectApiPaths(options = {}) {
  return resolveEditorProjectPaths(options)
}
