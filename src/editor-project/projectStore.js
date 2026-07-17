import { constants as fsConstants, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createDefaultEditorProject } from './defaults.js'
import { resolveEditorProjectPaths } from './paths.js'
import { clonePlain } from './safety.js'
import { parseEditorProjectJson, serializeEditorProject } from './serializer.js'

const projectMutationTails = new Map()
const TRUSTED_PREPARE_ERROR_CODES = new Set([
  'artifact_integrity_failed',
  'unsafe_artifact_path',
  'asset_revision_conflict',
  'evidence_conflict',
  'evidence_integrity_failed',
  'invalid_quality_gate_evidence',
  'quality_gate_identity_mismatch',
])

export class EditorProjectStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'EditorProjectStoreError'
    this.code = code
    this.details = details
  }
}

async function atomicWriteFile(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await writeFile(tempPath, content)
  await rename(tempPath, filePath)
}

async function readProjectFile(filePath) {
  if (!existsSync(filePath)) return null
  return parseEditorProjectJson(await readFile(filePath, 'utf8'))
}

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function invalidMutationResult(projectId) {
  return new EditorProjectStoreError(
    'invalid_mutation_result',
    'editor project mutation must return a project object',
    { project_id: projectId },
  )
}

function invalidPrepareResult(projectId, details = {}) {
  return new EditorProjectStoreError(
    'invalid_prepare_result',
    'editor project preparation must return a valid project object',
    { project_id: projectId, ...details },
  )
}

function projectExists(projectId) {
  return new EditorProjectStoreError(
    'project_exists',
    `editor project already exists: ${projectId}`,
    { project_id: projectId },
  )
}

function projectStoreFailure(code, message, projectId) {
  return new EditorProjectStoreError(code, message, { project_id: projectId })
}

function storageBoundaryFailure(code, projectId) {
  return projectStoreFailure(
    code,
    code === 'project_create_failed'
      ? 'editor project storage boundary is unsafe'
      : 'editor project directory identity changed before publication',
    projectId,
  )
}

function sameFilesystemIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

async function captureWorkspaceIdentity(paths, projectId, code) {
  try {
    const resolvedPath = await realpath(paths.workspaceRoot)
    const resolvedStat = await stat(resolvedPath)
    if (!resolvedStat.isDirectory()) throw storageBoundaryFailure(code, projectId)
    return Object.freeze({
      realPath: resolvedPath,
      dev: resolvedStat.dev,
      ino: resolvedStat.ino,
    })
  } catch (error) {
    if (error instanceof EditorProjectStoreError) throw error
    throw storageBoundaryFailure(code, projectId)
  }
}

async function captureTrustedChildDirectory({
  directoryPath,
  expectedRealPath,
  projectId,
  code,
}) {
  try {
    const lexicalStat = await lstat(directoryPath)
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) {
      throw storageBoundaryFailure(code, projectId)
    }
    const resolvedPath = await realpath(directoryPath)
    const resolvedStat = await stat(resolvedPath)
    if (resolvedPath !== expectedRealPath || !resolvedStat.isDirectory() ||
        !sameFilesystemIdentity(lexicalStat, resolvedStat)) {
      throw storageBoundaryFailure(code, projectId)
    }
    return Object.freeze({
      realPath: resolvedPath,
      dev: resolvedStat.dev,
      ino: resolvedStat.ino,
    })
  } catch (error) {
    if (error instanceof EditorProjectStoreError) throw error
    throw storageBoundaryFailure(code, projectId)
  }
}

async function ensureTrustedProjectsDirectory(paths, workspaceIdentity, projectId) {
  try {
    await lstat(paths.projectsDir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw storageBoundaryFailure('project_create_failed', projectId)
    try {
      await mkdir(paths.projectsDir)
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') {
        throw storageBoundaryFailure('project_create_failed', projectId)
      }
    }
  }
  return captureTrustedChildDirectory({
    directoryPath: paths.projectsDir,
    expectedRealPath: path.join(workspaceIdentity.realPath, 'projects'),
    projectId,
    code: 'project_create_failed',
  })
}

async function assertStablePreparedProjectDirectories({
  paths,
  projectId,
  workspaceIdentity,
  projectsIdentity,
  projectIdentity = null,
  code,
}) {
  const currentWorkspace = await captureWorkspaceIdentity(paths, projectId, code)
  if (currentWorkspace.realPath !== workspaceIdentity.realPath ||
      !sameFilesystemIdentity(currentWorkspace, workspaceIdentity)) {
    throw storageBoundaryFailure(code, projectId)
  }
  const currentProjects = await captureTrustedChildDirectory({
    directoryPath: paths.projectsDir,
    expectedRealPath: projectsIdentity.realPath,
    projectId,
    code,
  })
  if (!sameFilesystemIdentity(currentProjects, projectsIdentity)) {
    throw storageBoundaryFailure(code, projectId)
  }
  if (!projectIdentity) return
  const currentProject = await captureTrustedChildDirectory({
    directoryPath: paths.projectDir,
    expectedRealPath: projectIdentity.realPath,
    projectId,
    code,
  })
  if (!sameFilesystemIdentity(currentProject, projectIdentity)) {
    throw storageBoundaryFailure(code, projectId)
  }
}

async function assertProjectTargetAbsent(paths, projectId) {
  try {
    await lstat(paths.projectDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw projectStoreFailure(
      'project_create_failed',
      'editor project target could not be safely inspected',
      projectId,
    )
  }
  throw projectExists(projectId)
}

async function createExclusiveProjectDirectory(paths, projectId) {
  try {
    await mkdir(paths.projectDir)
  } catch (error) {
    if (error?.code === 'EEXIST') throw projectExists(projectId)
    throw projectStoreFailure(
      'project_create_failed',
      'editor project target directory could not be created',
      projectId,
    )
  }
}

function clonePreparedProject(value, projectId) {
  let prepared
  try {
    prepared = clonePlain(value)
  } catch {
    throw invalidPrepareResult(projectId)
  }
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
    throw invalidPrepareResult(projectId)
  }
  if (prepared.id !== projectId) {
    throw invalidPrepareResult(projectId, {
      expected_project_id: projectId,
      actual_project_id: typeof prepared.id === 'string' ? prepared.id : null,
    })
  }
  return prepared
}

function normalizePrepareProjectError(error, projectId) {
  if (error instanceof EditorProjectStoreError) return error
  const code = typeof error?.code === 'string' ? error.code.trim() : ''
  return projectStoreFailure(
    TRUSTED_PREPARE_ERROR_CODES.has(code) ? code : 'project_prepare_failed',
    'editor project preparation failed',
    projectId,
  )
}

function safeProjectPublishFailure(projectId) {
  return projectStoreFailure(
    'project_publish_failed',
    'editor project JSON could not be safely published',
    projectId,
  )
}

async function writeExactFileHandleBytes(fileHandle, bytes) {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await fileHandle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    )
    if (!bytesWritten) throw new Error('prepared project write made no progress')
    offset += bytesWritten
  }
}

async function readExactFileHandleBytes(fileHandle, size) {
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await fileHandle.read(bytes, offset, size - offset, offset)
    if (!bytesRead) throw new Error('prepared project read ended early')
    offset += bytesRead
  }
  const trailing = Buffer.alloc(1)
  const { bytesRead: trailingBytes } = await fileHandle.read(trailing, 0, 1, size)
  if (trailingBytes !== 0) throw new Error('prepared project read exceeded expected size')
  return bytes
}

async function publishPreparedProjectJson({
  paths,
  projectId,
  serialized,
  workspaceIdentity,
  projectsIdentity,
  projectIdentity,
}) {
  await assertStablePreparedProjectDirectories({
    paths,
    projectId,
    workspaceIdentity,
    projectsIdentity,
    projectIdentity,
    code: 'project_publish_failed',
  })
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) throw safeProjectPublishFailure(projectId)

  const flags = fsConstants.O_RDWR |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_NOFOLLOW
  let fileHandle
  try {
    fileHandle = await open(paths.projectJson, flags, 0o600)
  } catch (error) {
    if (['EEXIST', 'ELOOP', 'EISDIR'].includes(error?.code)) throw projectExists(projectId)
    throw safeProjectPublishFailure(projectId)
  }

  let publishedProject = null
  let failure = null
  try {
    const openedStat = await fileHandle.stat()
    if (!openedStat.isFile() || openedStat.size !== 0) throw safeProjectPublishFailure(projectId)
    const fileIdentity = { dev: openedStat.dev, ino: openedStat.ino }
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
      code: 'project_publish_failed',
    })

    const serializedBytes = Buffer.from(serialized, 'utf8')
    await writeExactFileHandleBytes(fileHandle, serializedBytes)
    await fileHandle.sync()
    const writtenStat = await fileHandle.stat()
    if (!writtenStat.isFile() ||
        !sameFilesystemIdentity(writtenStat, fileIdentity) ||
        writtenStat.size !== serializedBytes.byteLength) {
      throw safeProjectPublishFailure(projectId)
    }
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
      code: 'project_publish_failed',
    })

    const verifiedBytes = await readExactFileHandleBytes(fileHandle, serializedBytes.byteLength)
    if (!verifiedBytes.equals(serializedBytes)) throw safeProjectPublishFailure(projectId)
    publishedProject = parseEditorProjectJson(verifiedBytes.toString('utf8'))
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
      code: 'project_publish_failed',
    })
  } catch (error) {
    failure = error instanceof EditorProjectStoreError
      ? error
      : safeProjectPublishFailure(projectId)
  } finally {
    try {
      await fileHandle.close()
    } catch {
      if (!failure) failure = safeProjectPublishFailure(projectId)
    }
  }
  if (failure) throw failure
  return publishedProject
}

export async function loadEditorProject({
  projectId,
  projectRoot = process.cwd(),
  workspaceRoot,
  autosave = false,
} = {}) {
  const paths = resolveEditorProjectPaths({ projectId, projectRoot, workspaceRoot })
  const filePath = autosave ? paths.autosaveJson : paths.projectJson
  const project = await readProjectFile(filePath)
  if (!project) {
    throw new EditorProjectStoreError('project_not_found', `editor project not found: ${projectId}`)
  }
  return { project, paths }
}

async function saveEditorProjectUnlocked({
  project,
  projectRoot = process.cwd(),
  workspaceRoot,
  expectedRevision = null,
  autosave = false,
  now = new Date(),
} = {}) {
  const paths = resolveEditorProjectPaths({ projectId: project?.id, projectRoot, workspaceRoot })
  await mkdir(paths.projectDir, { recursive: true })

  const current = await readProjectFile(paths.projectJson)
  if (!autosave && current && expectedRevision !== current.revision) {
    throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
      expected_revision: expectedRevision,
      current_revision: current.revision,
    })
  }

  const nextProject = clonePlain(project)
  nextProject.updated_at = timestamp(now)
  if (!autosave) {
    nextProject.revision = current ? current.revision + 1 : Math.max(1, Number(nextProject.revision) || 1)
  }

  const serialized = serializeEditorProject(nextProject)
  if (autosave) {
    await atomicWriteFile(paths.autosaveJson, serialized)
    return { project: nextProject, paths, saved: 'autosave' }
  }

  if (current && existsSync(paths.projectJson)) {
    await copyFile(paths.projectJson, paths.backupJson)
  }
  await atomicWriteFile(paths.projectJson, serialized)
  return { project: nextProject, paths, saved: 'formal' }
}

export async function withEditorProjectMutationLock({ projectId, workspaceRoot }, task) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  await mkdir(resolvedWorkspaceRoot, { recursive: true })
  const key = `${await realpath(resolvedWorkspaceRoot)}\0${projectId}`
  const previous = projectMutationTails.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  projectMutationTails.set(key, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (projectMutationTails.get(key) === tail) projectMutationTails.delete(key)
  }
}

export async function createPreparedEditorProject({
  project,
  projectRoot = process.cwd(),
  workspaceRoot,
  prepareProject,
  now = new Date(),
} = {}) {
  const projectId = project?.id
  const paths = resolveEditorProjectPaths({ projectId, projectRoot, workspaceRoot })
  return withEditorProjectMutationLock({ projectId, workspaceRoot: paths.workspaceRoot }, async () => {
    const workspaceIdentity = await captureWorkspaceIdentity(
      paths,
      projectId,
      'project_create_failed',
    )
    const projectsIdentity = await ensureTrustedProjectsDirectory(
      paths,
      workspaceIdentity,
      projectId,
    )
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      code: 'project_create_failed',
    })
    await assertProjectTargetAbsent(paths, projectId)
    await createExclusiveProjectDirectory(paths, projectId)
    const projectIdentity = await captureTrustedChildDirectory({
      directoryPath: paths.projectDir,
      expectedRealPath: path.join(projectsIdentity.realPath, projectId),
      projectId,
      code: 'project_create_failed',
    })
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
      code: 'project_create_failed',
    })

    let callbackProject
    try {
      callbackProject = clonePlain(project)
    } catch {
      throw invalidPrepareResult(projectId)
    }
    if (!callbackProject || typeof callbackProject !== 'object' || Array.isArray(callbackProject)) {
      throw invalidPrepareResult(projectId)
    }
    if (typeof prepareProject !== 'function') throw invalidPrepareResult(projectId)

    let preparedResult
    try {
      preparedResult = await prepareProject({
        project: callbackProject,
        paths: Object.freeze({ ...paths }),
      })
    } catch (error) {
      throw normalizePrepareProjectError(error, projectId)
    }
    await assertStablePreparedProjectDirectories({
      paths,
      projectId,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
      code: 'project_publish_failed',
    })
    const nextProject = clonePreparedProject(preparedResult, projectId)
    let publishedAt
    try {
      publishedAt = timestamp(now)
    } catch {
      throw invalidPrepareResult(projectId)
    }
    nextProject.revision = 1
    nextProject.created_at = publishedAt
    nextProject.updated_at = publishedAt

    let serialized
    try {
      serialized = serializeEditorProject(nextProject)
    } catch (error) {
      throw invalidPrepareResult(projectId, {
        blocking_errors: Array.isArray(error?.validation?.blocking_errors)
          ? [...error.validation.blocking_errors]
          : [],
      })
    }

    const publishedProject = await publishPreparedProjectJson({
      paths,
      projectId,
      serialized,
      workspaceIdentity,
      projectsIdentity,
      projectIdentity,
    })
    return { project: publishedProject, paths }
  })
}

export async function mutateEditorProject({
  projectId,
  expectedRevision,
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
  now = new Date(),
  mutate,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    if (loaded.project.revision !== expectedRevision) {
      throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
        expected_revision: expectedRevision,
        current_revision: loaded.project.revision,
      })
    }
    const mutationResult = await mutate(clonePlain(loaded.project))
    let nextProject
    try {
      nextProject = clonePlain(mutationResult)
    } catch {
      throw invalidMutationResult(projectId)
    }
    if (!nextProject || typeof nextProject !== 'object' || Array.isArray(nextProject)) {
      throw invalidMutationResult(projectId)
    }
    if (nextProject.id !== projectId) {
      throw new EditorProjectStoreError(
        'mutation_project_id_mismatch',
        'editor project mutation must preserve project id',
        {
          expected_project_id: projectId,
          actual_project_id: typeof nextProject.id === 'string' ? nextProject.id : null,
        },
      )
    }
    return saveEditorProjectUnlocked({
      project: nextProject,
      projectRoot,
      workspaceRoot,
      expectedRevision,
      now,
    })
  })
}

export async function saveEditorProject({
  project,
  projectRoot = process.cwd(),
  workspaceRoot,
  expectedRevision = null,
  autosave = false,
  now = new Date(),
} = {}) {
  if (autosave) {
    return saveEditorProjectUnlocked({
      project,
      projectRoot,
      workspaceRoot,
      expectedRevision,
      autosave,
      now,
    })
  }

  const paths = resolveEditorProjectPaths({ projectId: project?.id, projectRoot, workspaceRoot })
  return withEditorProjectMutationLock({ projectId: project.id, workspaceRoot: paths.workspaceRoot }, () => (
    saveEditorProjectUnlocked({
      project,
      projectRoot,
      workspaceRoot: paths.workspaceRoot,
      expectedRevision,
      now,
    })
  ))
}

export async function createEditorProject({
  id,
  name,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  settings,
} = {}) {
  const createdAt = timestamp(now)
  const project = createDefaultEditorProject({
    id,
    name,
    createdAt,
    updatedAt: createdAt,
    settings,
  })
  return saveEditorProject({ project, projectRoot, workspaceRoot, now })
}
