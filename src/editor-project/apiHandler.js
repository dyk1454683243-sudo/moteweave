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
import { createDefaultEditorProject } from './defaults.js'
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
    const error = new Error('editor request exceeds its byte limit')
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
    return sendJson(res, statusForError(error), errorBody(error))
  }
}

export function editorProjectApiPaths(options = {}) {
  return resolveEditorProjectPaths(options)
}
