import { createReadStream } from 'node:fs'
import path from 'node:path'

import { createDefaultEditorProject } from './defaults.js'
import { importGeneratedJobAsAsset } from './artifactRegistry.js'
import {
  EditorAssetLibraryError,
  removeAssetFromProject,
  unlinkAssetFromScenes,
} from './assetLibrary.js'
import {
  createEditorProject,
  EditorProjectStoreError,
  loadEditorProject,
  mutateEditorProject,
  saveEditorProject,
} from './projectStore.js'
import { writeEditorProjectPackArtifacts } from './editorProjectPackWriter.js'
import {
  projectRelativePath,
  resolveContainedRegularFile,
  resolveEditorProjectPaths,
  resolveManagedRevisionArtifactFile,
} from './paths.js'
import { isSafeRelativePath } from './safety.js'

const ARTIFACT_CONTENT_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
})

async function readBody(req, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
  const chunks = []
  let total = 0
  let exceeded = false
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      exceeded = true
      chunks.length = 0
      continue
    }
    if (!exceeded) chunks.push(chunk)
  }
  if (exceeded) {
    const error = new Error('quality gate request exceeds its byte limit')
    error.code = 'request_too_large'
    throw error
  }
  return Buffer.concat(chunks)
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
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

const CHARACTER_REPROCESS_ERROR_STATUS = Object.freeze({
  invalid_frame_repair_request: 400,
  invalid_frame_repair_plan: 400,
  invalid_frame_repair_mask: 400,
  invalid_frame_repair_reference: 400,
  invalid_frame_repair_service_input: 400,
  frame_identity_mismatch: 400,
  invalid_operation_identity: 400,
  invalid_operation_lookup: 400,
  invalid_reprocess_request: 400,
  invalid_recipe: 400,
  invalid_accept_request: 400,
  noncanonical_recipe: 400,
  invalid_reprocess_context: 400,
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
  operation_not_found: 404,
  revision_conflict: 409,
  asset_revision_conflict: 409,
  preview_stale: 409,
  accept_conflict: 409,
  stale_plan: 409,
  operation_conflict: 409,
  job_not_ready: 409,
  quality_blocked: 422,
  warning_confirmation_required: 422,
  artifact_integrity_failed: 422,
  reprocess_unavailable: 503,
  frame_repair_unavailable: 503,
  provider_unavailable: 503,
  provider_configuration_error: 503,
})

const FRAME_REPAIR_QUALITY_GATE_ERROR_STATUS = Object.freeze({
  invalid_quality_gate_request: 400,
  invalid_quality_gate_plan: 400,
  invalid_quality_gate_review: 400,
  invalid_quality_gate_outcome: 400,
  invalid_quality_gate_evidence: 400,
  unexpected_request_field: 400,
  unsafe_artifact_path: 400,
  request_too_large: 413,
  project_not_found: 404,
  asset_not_found: 404,
  revision_not_found: 404,
  job_not_found: 404,
  artifact_not_found: 404,
  setup_manifest_not_found: 404,
  session_not_found: 404,
  case_not_found: 404,
  operation_not_found: 404,
  project_exists: 409,
  revision_conflict: 409,
  asset_revision_conflict: 409,
  stale_quality_gate_plan: 409,
  session_id_conflict: 409,
  quality_gate_identity_mismatch: 409,
  accept_outcome_ambiguous: 409,
  evidence_conflict: 409,
  evidence_integrity_failed: 409,
  artifact_integrity_failed: 422,
  quality_gate_hard_gate_failed: 422,
  quality_gate_paused: 422,
  quality_gate_finalized: 422,
  provider_unavailable: 503,
  provider_configuration_error: 503,
})

function statusForError(error, { frameRepairRoute = false, qualityGateRoute = false } = {}) {
  if (qualityGateRoute && FRAME_REPAIR_QUALITY_GATE_ERROR_STATUS[error?.code]) {
    return FRAME_REPAIR_QUALITY_GATE_ERROR_STATUS[error.code]
  }
  if (frameRepairRoute && error?.code === 'identity_mismatch') return 409
  if (CHARACTER_REPROCESS_ERROR_STATUS[error?.code]) {
    return CHARACTER_REPROCESS_ERROR_STATUS[error.code]
  }
  if (error?.code === 'invalid_json') return 400
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_not_found') return 404
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_in_use') return 409
  if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') return 404
  if (error instanceof EditorProjectStoreError && error.code === 'revision_conflict') return 409
  return 400
}

function safeQualityGateDetails(value, depth = 0) {
  if (depth > 3 || value == null ||
      (typeof value === 'number' && !Number.isFinite(value))) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value) ? value : null
  }
  if (Array.isArray(value)) {
    if (value.length > 32) return null
    const items = value.map((item) => safeQualityGateDetails(item, depth + 1))
    return items.some((item) => item === null) ? null : items
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null
  const entries = []
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
        /(?:path|secret|token|key|header|stack|cause|buffer|base64|env)/i.test(key)) continue
    const safe = safeQualityGateDetails(item, depth + 1)
    if (safe !== null) entries.push([key, safe])
  }
  return entries.length > 0 && entries.length <= 32 ? Object.fromEntries(entries) : null
}

function errorBody(error, { qualityGateRoute = false } = {}) {
  if (qualityGateRoute) {
    const details = safeQualityGateDetails(error?.details)
    return {
      error: error?.code ?? 'frame_repair_quality_gate_error',
      reason: 'frame repair quality gate request failed',
      ...(details ? { details } : {}),
    }
  }
  return {
    error: error.code ?? 'editor_project_error',
    reason: String(error.message || error),
    ...(error.details ? { details: error.details } : {}),
  }
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

export async function handleEditorProjectApi(req, res, options = {}) {
  const {
    projectRoot = process.cwd(),
    workspaceRoot = path.join(projectRoot, 'workspace'),
    generatedDir = path.join(projectRoot, 'generated'),
    reprocessGeneratedDir = path.join(projectRoot, 'generated'),
    artifactAccessRegistry,
    characterReprocessCoordinator = null,
    reprocessService = null,
    frameRepairCoordinator = null,
    frameRepairService = null,
    frameRepairQualityGateCoordinator = null,
  } = options
  void reprocessGeneratedDir
  if (
    !artifactAccessRegistry ||
    typeof artifactAccessRegistry.register !== 'function' ||
    typeof artifactAccessRegistry.has !== 'function'
  ) {
    throw new TypeError('artifactAccessRegistry is required')
  }
  const url = new URL(req.url, 'http://localhost')
  const parts = routeParts(url.pathname)

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
      if (req.method === 'GET' && parts.length === 4) {
        const result = await loadEditorProject({ projectId, projectRoot, workspaceRoot, autosave: url.searchParams.get('autosave') === 'true' })
        return sendJson(res, 200, { project: result.project })
      }

      if (req.method === 'PUT' && parts.length === 4) {
        const body = await readJsonBody(req)
        if (!body.project) return sendJson(res, 400, { error: 'missing_project', reason: 'project is required' })
        if (body.project.id !== projectId) return sendJson(res, 400, { error: 'project_id_mismatch', reason: 'path project id must match project.id' })
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
        const result = await saveEditorProject({ project: body.project, projectRoot, workspaceRoot, autosave: true })
        return sendJson(res, 200, { project: result.project, saved: result.saved })
      }

      if (req.method === 'POST' && parts[4] === 'import-job' && parts.length === 5) {
        const body = await readJsonBody(req)
        const jobId = body.jobId ?? body.job_id
        const recordedJob = reprocessService?.getJob?.(jobId)
        const recordedFrameRepairJob = frameRepairService?.getJob?.(jobId)
        if (recordedJob?.type === 'editor_character_reprocess' ||
            recordedFrameRepairJob?.type === 'editor_character_frame_repair') {
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
            imported = await importGeneratedJobAsAsset({
              project,
              kind: body.kind,
              jobId,
              generatedDir,
              projectRoot,
              workspaceRoot,
              assetId: body.assetId ?? body.asset_id,
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

      if (parts[4] === 'frame-repair-quality-gates') {
        const knownRoute = (
          req.method === 'POST' && parts.length === 5
        ) || (
          req.method === 'POST' && parts.length === 6 && ['setup', 'plan'].includes(parts[5])
        ) || (
          req.method === 'GET' && parts.length === 6
        ) || (
          req.method === 'POST' && parts.length === 7 && parts[6] === 'finalize'
        ) || (
          req.method === 'POST' && parts.length === 9 && parts[6] === 'cases' &&
          ['review', 'outcome'].includes(parts[8])
        )
        if (!knownRoute) return sendJson(res, 404, { error: 'not_found' })
        if (!frameRepairQualityGateCoordinator) {
          return sendJson(res, 503, {
            error: 'frame_repair_quality_gate_unavailable',
            reason: 'frame repair quality gate is unavailable',
          })
        }
        const readQualityGateBody = () => readJsonBody(req, { maxBytes: 128 * 1024 })
        if (req.method === 'POST' && parts[5] === 'setup' && parts.length === 6) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.setupQualityGate({
            sourceProjectId: projectId,
            body,
          })
          return sendJson(res, 201, result)
        }
        if (req.method === 'POST' && parts[5] === 'plan' && parts.length === 6) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.planQualityGate({ projectId, body })
          return sendJson(res, 200, result)
        }
        if (req.method === 'POST' && parts.length === 5) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.startQualityGate({ projectId, body })
          return sendJson(res, 201, result)
        }
        if (req.method === 'GET' && parts[5] && parts.length === 6) {
          const result = await frameRepairQualityGateCoordinator.getQualityGate({
            projectId,
            sessionId: parts[5],
          })
          return sendJson(res, 200, result)
        }
        if (req.method === 'POST' && parts[5] && parts[6] === 'cases' && parts[7] &&
            parts[8] === 'review' && parts.length === 9) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.recordQualityGateReview({
            projectId,
            sessionId: parts[5],
            caseId: parts[7],
            body,
          })
          return sendJson(res, 200, result)
        }
        if (req.method === 'POST' && parts[5] && parts[6] === 'cases' && parts[7] &&
            parts[8] === 'outcome' && parts.length === 9) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.recordQualityGateOutcome({
            projectId,
            sessionId: parts[5],
            caseId: parts[7],
            body,
          })
          return sendJson(res, 200, result)
        }
        if (req.method === 'POST' && parts[5] && parts[6] === 'finalize' && parts.length === 7) {
          const body = await readQualityGateBody()
          const result = await frameRepairQualityGateCoordinator.finalizeQualityGate({
            projectId,
            sessionId: parts[5],
            body,
          })
          return sendJson(res, 200, result)
        }
      }

      if (parts[4] === 'assets' && parts[5]) {
        const assetId = parts[5]

        if (req.method === 'POST' && parts[6] === 'frame-repair' &&
            parts[7] === 'plan' && parts.length === 8) {
          if (!frameRepairCoordinator) {
            return sendJson(res, 503, {
              error: 'frame_repair_unavailable',
              reason: 'targeted frame repair is unavailable',
            })
          }
          const body = await readJsonBody(req)
          const result = await frameRepairCoordinator.planFrameRepair({ projectId, assetId, body })
          return sendJson(res, 200, result)
        }

        if (req.method === 'POST' && parts[6] === 'frame-repair' && parts.length === 7) {
          if (!frameRepairCoordinator) {
            return sendJson(res, 503, {
              error: 'frame_repair_unavailable',
              reason: 'targeted frame repair is unavailable',
            })
          }
          const body = await readJsonBody(req)
          const result = await frameRepairCoordinator.submitFrameRepair({ projectId, assetId, body })
          return sendJson(res, 202, result)
        }

        if (req.method === 'GET' && parts[6] === 'frame-repair' &&
            parts[7] === 'operations' && parts[8] && parts.length === 9) {
          if (!frameRepairCoordinator) {
            return sendJson(res, 503, {
              error: 'frame_repair_unavailable',
              reason: 'targeted frame repair is unavailable',
            })
          }
          const result = await frameRepairCoordinator.getFrameRepairOperation({
            projectId,
            assetId,
            operationId: parts[8],
          })
          return sendJson(res, 200, result)
        }

        if (req.method === 'POST' && parts[6] === 'frame-repair' && parts[7] &&
            parts[8] === 'accept' && parts.length === 9) {
          if (!frameRepairCoordinator) {
            return sendJson(res, 503, {
              error: 'frame_repair_unavailable',
              reason: 'targeted frame repair is unavailable',
            })
          }
          const body = await readJsonBody(req)
          const result = await frameRepairCoordinator.acceptFrameRepair({
            projectId,
            assetId,
            jobId: parts[7],
            body,
          })
          return sendJson(res, 200, result)
        }

        if (req.method === 'POST' && parts[6] === 'reprocess' && parts.length === 7) {
          if (!characterReprocessCoordinator) {
            return sendJson(res, 503, {
              error: 'reprocess_unavailable',
              reason: 'local character reprocess is unavailable',
            })
          }
          const body = await readJsonBody(req)
          const result = await characterReprocessCoordinator.submitCharacterReprocessPreview({
            projectId,
            assetId,
            body,
          })
          return sendJson(res, 202, result)
        }

        if (
          req.method === 'POST' &&
          parts[6] === 'reprocess' &&
          parts[7] &&
          parts[8] === 'accept' &&
          parts.length === 9
        ) {
          if (!characterReprocessCoordinator) {
            return sendJson(res, 503, {
              error: 'reprocess_unavailable',
              reason: 'local character reprocess is unavailable',
            })
          }
          const body = await readJsonBody(req)
          const result = await characterReprocessCoordinator.acceptCharacterReprocessPreview({
            projectId,
            assetId,
            jobId: parts[7],
            body,
          })
          return sendJson(res, 200, result)
        }

        if (req.method === 'POST' && parts[6] === 'unlink' && parts.length === 7) {
          const body = await readJsonBody(req)
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
    const qualityGateRoute = parts[4] === 'frame-repair-quality-gates'
    return sendJson(res, statusForError(error, {
      frameRepairRoute: parts[6] === 'frame-repair',
      qualityGateRoute,
    }), errorBody(error, { qualityGateRoute }))
  }
}

export function editorProjectApiPaths(options = {}) {
  return resolveEditorProjectPaths(options)
}
