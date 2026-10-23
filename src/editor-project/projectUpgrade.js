import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { EDITOR_PROJECT_VERSION, SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { createDefaultEditorProjectV1 } from './defaults.js'
import {
  copyTrustedRegularFile,
  ensureTrustedContainedDirectory,
  fsyncTrustedDirectory,
  resolveContainedRegularFile,
  resolveEditorProjectPaths,
  writeTrustedRegularFile,
} from './paths.js'
import { loadEditorProject, withEditorProjectMutationLock } from './projectStore.js'
import { clonePlain, isSafeRelativePath } from './safety.js'
import { parseEditorProjectJson, serializeEditorProject } from './serializer.js'
import { lookupProjectReceipt } from './projectHistoryStore.js'
import {
  SpriteDocumentError,
  assertJsonByteLimit,
  deriveStableId,
  payloadSha256,
  sha256Bytes,
  spriteDocumentError,
} from './spriteDocumentValidation.js'

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function collectManagedRefs(project) {
  const refs = []
  for (const asset of Object.values(project?.assets ?? {})) {
    for (const revision of Object.values(asset?.revisions ?? {})) {
      if (typeof revision?.processing_recipe_ref === 'string') refs.push(revision.processing_recipe_ref)
      for (const artifactPath of Object.values(revision?.artifacts ?? {})) {
        if (typeof artifactPath === 'string') refs.push(artifactPath)
      }
    }
  }
  return refs
}

function rewriteManagedPath(value, sourceId, targetId) {
  const prefix = `workspace/projects/${sourceId}/`
  const nextPrefix = `workspace/projects/${targetId}/`
  if (typeof value !== 'string') return value
  if (value.startsWith(prefix)) return `${nextPrefix}${value.slice(prefix.length)}`
  return value
}

function rewriteProjectRefs(project, sourceId, targetId) {
  const next = clonePlain(project)
  for (const asset of Object.values(next.assets ?? {})) {
    for (const revision of Object.values(asset.revisions ?? {})) {
      if (typeof revision.processing_recipe_ref === 'string') {
        revision.processing_recipe_ref = rewriteManagedPath(revision.processing_recipe_ref, sourceId, targetId)
      }
      for (const [key, artifactPath] of Object.entries(revision.artifacts ?? {})) {
        revision.artifacts[key] = rewriteManagedPath(artifactPath, sourceId, targetId)
      }
    }
  }
  return next
}

async function receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot) {
  const receipt = await lookupProjectReceipt(project, operationId, { projectRoot, workspaceRoot })
  if (!receipt) return null
  if (receipt.payload_sha256 !== payloadSha256(payload)) {
    throw spriteDocumentError('operation_conflict', 'operation payload does not match the committed receipt')
  }
  return receipt
}

async function withOrderedProjectLocks(projectIds, workspaceRoot, task) {
  const ordered = [...new Set(projectIds)].sort()
  const run = async (index) => {
    if (index >= ordered.length) return task()
    return withEditorProjectMutationLock({ projectId: ordered[index], workspaceRoot }, () => run(index + 1))
  }
  return run(0)
}

async function readCommittedTarget(targetPaths) {
  try {
    const identity = await lstat(targetPaths.projectJson)
    if (identity.isSymbolicLink() || !identity.isFile()) {
      throw spriteDocumentError('storage_commit_failed', 'target project identity is unsafe')
    }
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    if (error?.code === 'ENOENT') return null
    throw spriteDocumentError('storage_commit_failed', 'target project could not be inspected')
  }
  try {
    return parseEditorProjectJson(await readFile(targetPaths.projectJson, 'utf8'))
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    throw spriteDocumentError('storage_commit_failed', 'target project could not be read')
  }
}

async function confirmPublishedDurability(paths, extraDirectories = []) {
  const directories = [paths.projectDir, paths.projectsDir, ...extraDirectories]
  for (const directoryPath of directories) {
    try {
      await fsyncTrustedDirectory(directoryPath)
    } catch {
      throw spriteDocumentError('storage_commit_failed', 'project directory could not be synchronized', {
        committed: true,
      })
    }
  }
}

async function persistCopiedRefs(targetPaths, planned, projectRoot, { fault = null } = {}) {
  try {
    await ensureTrustedContainedDirectory({
      controlledRootPath: targetPaths.workspaceRoot,
      directoryPath: targetPaths.projectsDir,
    })
    await ensureTrustedContainedDirectory({
      controlledRootPath: targetPaths.workspaceRoot,
      directoryPath: targetPaths.projectDir,
      syncFault: fault === 'dirsync' ? 'parent' : null,
    })
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    throw spriteDocumentError('storage_commit_failed', 'target directory could not be created safely')
  }
  const directories = new Set()
  for (const file of planned) {
    const destination = path.resolve(projectRoot, file.nextRelative)
    try {
      await copyTrustedRegularFile({
        controlledRootPath: targetPaths.workspaceRoot,
        sourcePath: file.resolved,
        destinationPath: destination,
      })
    } catch (error) {
      if (error instanceof SpriteDocumentError) throw error
      throw spriteDocumentError('storage_commit_failed', 'managed file could not be copied safely')
    }
    directories.add(path.dirname(destination))
    const sourceHash = sha256Bytes(await readFile(file.resolved))
    const copiedHash = sha256Bytes(await readFile(destination))
    if (sourceHash !== copiedHash) {
      throw spriteDocumentError('artifact_integrity_failed', 'copied managed file hash mismatch')
    }
  }
  for (const directoryPath of directories) {
    try {
      await fsyncTrustedDirectory(directoryPath)
    } catch {
      throw spriteDocumentError('storage_commit_failed', 'copied directory could not be synchronized')
    }
  }
}

async function publishTargetProject(paths, project, { fault = null } = {}) {
  if (fault === 'index') {
    throw spriteDocumentError('storage_commit_failed', 'index commit failed')
  }
  const serialized = serializeEditorProject(project)
  assertJsonByteLimit(serialized, SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes, 'project JSON')
  try {
    await writeTrustedRegularFile({
      controlledRootPath: paths.workspaceRoot,
      filePath: paths.projectJson,
      bytes: Buffer.from(serialized, 'utf8'),
      syncFault: fault === 'index_sync' ? 'publish' : null,
    })
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    if (error?.published) {
      throw spriteDocumentError('storage_commit_failed', 'project index durability is unconfirmed', {
        committed: true,
      })
    }
    throw spriteDocumentError('storage_commit_failed', 'project index could not be committed')
  }
}

export async function upgradeEditorProjectCopy({
  sourceProjectId,
  operationId,
  expectedRevision,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  const targetId = deriveStableId('p', `upgrade-copy:${sourceProjectId}:${operationId}`)
  const sourcePaths = resolveEditorProjectPaths({ projectId: sourceProjectId, projectRoot, workspaceRoot })
  const targetPaths = resolveEditorProjectPaths({ projectId: targetId, projectRoot, workspaceRoot })
  return withOrderedProjectLocks(
    [sourceProjectId, targetId],
    targetPaths.workspaceRoot,
    async () => {
      const existing = await readCommittedTarget(targetPaths)
      if (existing) {
        const receipt = await receiptFromProject(existing, operationId, payload, projectRoot, workspaceRoot)
        if (!receipt) throw spriteDocumentError('operation_conflict', 'target project already exists')
        await confirmPublishedDurability(targetPaths)
        return { project: existing, receipt, replayed: true, source: null }
      }

      const sourceLoaded = await loadEditorProject({
        projectId: sourceProjectId,
        projectRoot,
        workspaceRoot,
      })
      if (sourceLoaded.project.version !== EDITOR_PROJECT_VERSION) {
        throw spriteDocumentError('unsupported_input', 'upgrade-copy only reads editor_project_v0')
      }
      if (sourceLoaded.project.revision !== expectedRevision) {
        throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
          expected_revision: expectedRevision,
          current_revision: sourceLoaded.project.revision,
        })
      }

      const refs = collectManagedRefs(sourceLoaded.project)
      const planned = []
      let totalBytes = 0
      for (const relative of refs) {
        if (!isSafeRelativePath(relative) || relative.split('/').includes('generated')) {
          throw spriteDocumentError('unsupported_input', 'upgrade-copy refuses generated or unsafe source paths')
        }
        const expectedPrefix = `workspace/projects/${sourceProjectId}/`
        if (!relative.startsWith(expectedPrefix)) {
          throw spriteDocumentError('unsupported_input', 'upgrade-copy only copies managed project files')
        }
        const candidate = path.resolve(projectRoot, relative)
        let resolved
        try {
          resolved = await resolveContainedRegularFile({
            controlledRootPath: sourcePaths.workspaceRoot,
            rootPath: sourcePaths.projectDir,
            candidatePath: candidate,
            errorCode: 'unsafe_artifact_path',
          })
        } catch (error) {
          if (error?.code === 'artifact_not_found') {
            throw spriteDocumentError('not_found', 'managed source artifact was not found')
          }
          throw spriteDocumentError('invalid_request', 'upgrade-copy source path is unsafe')
        }
        const fileStat = await lstat(resolved)
        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
          throw spriteDocumentError('invalid_request', 'upgrade-copy source path is unsafe')
        }
        totalBytes += fileStat.size
        if (planned.length + 1 > SPRITE_DOCUMENT_LIMITS.maxCopyManagedFiles
          || totalBytes > SPRITE_DOCUMENT_LIMITS.maxCopyBytes) {
          throw spriteDocumentError('resource_limit', 'upgrade-copy exceeds copy limits', {
            files: planned.length + 1,
            bytes: totalBytes,
          })
        }
        planned.push({
          relative,
          resolved,
          nextRelative: rewriteManagedPath(relative, sourceProjectId, targetId),
        })
      }

      await persistCopiedRefs(targetPaths, planned, projectRoot, { fault })

      const createdAt = timestamp(now)
      const rewritten = rewriteProjectRefs(sourceLoaded.project, sourceProjectId, targetId)
      const project = createDefaultEditorProjectV1({
        id: targetId,
        name: name ?? sourceLoaded.project.name,
        createdAt,
        updatedAt: createdAt,
        settings: rewritten.settings,
        upgradedFrom: {
          project_id: sourceProjectId,
          revision: sourceLoaded.project.revision,
        },
      })
      project.assets = rewritten.assets
      project.scenes = rewritten.scenes
      project.scene_flow = rewritten.scene_flow
      project.active_scene_id = rewritten.active_scene_id
      project.revision = 1
      const receipt = {
        operation_id: operationId,
        payload_sha256: payloadSha256(payload),
        project_id: project.id,
        project_revision: project.revision,
        document_id: null,
        document_revision: null,
      }
      project.operation_receipts[operationId] = receipt
      await publishTargetProject(targetPaths, project, { fault })
      if (fault === 'ack') {
        throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
      }
      return { project, receipt, replayed: false, source: sourceLoaded.project }
    },
  )
}
