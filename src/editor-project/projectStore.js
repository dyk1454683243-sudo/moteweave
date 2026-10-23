import { constants as fsConstants, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, open, opendir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  EDITOR_PROJECT_LIST_LIMITS,
  EDITOR_PROJECT_V1_VERSION,
  EDITOR_PROJECT_V2_VERSION,
  EDITOR_PROJECT_VERSION,
} from './constants.js'
import { createDefaultEditorProject } from './defaults.js'
import { resolveEditorProjectPaths } from './paths.js'
import { clonePlain, isIsoTimestamp, isPlainObject, isPositiveInteger, isValidId } from './safety.js'
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

function rejectLegacyV1Write(project, current = null) {
  if ((current && current.version !== EDITOR_PROJECT_VERSION) || (project && project.version !== EDITOR_PROJECT_VERSION)) {
    throw new EditorProjectStoreError(
      'unsupported_project_writer',
      'legacy editor project writers only support editor_project_v0',
      { project_id: current?.id ?? project?.id ?? null },
    )
  }
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

function listStoreError(code, message) {
  return new EditorProjectStoreError(code, message)
}

function listResourceLimit() {
  return listStoreError('resource_limit', 'editor project list exceeds its resource limit')
}

function listRootUnsafe() {
  return listStoreError('artifact_integrity_failed', 'editor project list root is unsafe')
}

function listRootUnreadable() {
  return listStoreError('storage_commit_failed', 'editor project list root could not be read')
}

function configuredListWorkspaceRoot({ projectRoot = process.cwd(), workspaceRoot } = {}) {
  return path.resolve(workspaceRoot ?? path.join(projectRoot, 'workspace'))
}

async function emitListReadEvent(listener, event) {
  if (typeof listener !== 'function') return event
  await listener(event)
  return event
}

async function captureListDirectoryIdentity(directoryPath) {
  let lexicalStat
  try {
    lexicalStat = await lstat(directoryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable' }
  }
  if (lexicalStat.isSymbolicLink()) return { kind: 'unsafe' }
  if (!lexicalStat.isDirectory()) return { kind: 'not-directory' }
  let resolvedPath
  let resolvedStat
  try {
    resolvedPath = await realpath(directoryPath)
    resolvedStat = await stat(resolvedPath)
  } catch {
    return { kind: 'unreadable' }
  }
  if (!resolvedStat.isDirectory() || !sameFilesystemIdentity(lexicalStat, resolvedStat)) {
    return { kind: 'unsafe' }
  }
  return {
    kind: 'ok',
    identity: Object.freeze({
      path: path.resolve(directoryPath),
      realPath: resolvedPath,
      dev: resolvedStat.dev,
      ino: resolvedStat.ino,
    }),
  }
}

async function assertListRootIdentity(workspace, projectsDir, workspaceIdentity, projectsIdentity) {
  const workspaceNow = await captureListDirectoryIdentity(workspace)
  if (workspaceNow.kind === 'unreadable') throw listRootUnreadable()
  if (
    workspaceNow.kind !== 'ok'
    || workspaceNow.identity.realPath !== workspaceIdentity.realPath
    || !sameFilesystemIdentity(workspaceNow.identity, workspaceIdentity)
  ) {
    throw listRootUnsafe()
  }
  const projectsNow = await captureListDirectoryIdentity(projectsDir)
  if (projectsNow.kind === 'unreadable') throw listRootUnreadable()
  if (
    projectsNow.kind !== 'ok'
    || projectsNow.identity.realPath !== projectsIdentity.realPath
    || !sameFilesystemIdentity(projectsNow.identity, projectsIdentity)
    || path.join(workspaceNow.identity.realPath, 'projects') !== projectsNow.identity.realPath
  ) {
    throw listRootUnsafe()
  }
}

function projectDirectoryStillTrusted(current, expected, projectsIdentity, projectId, paths) {
  return current?.kind === 'ok'
    && current.identity.realPath === expected.realPath
    && sameFilesystemIdentity(current.identity, expected)
    && path.join(projectsIdentity.realPath, projectId) === current.identity.realPath
    && path.join(paths.projectDir, 'project.json') === paths.projectJson
}

function projectListSummary(value, expectedId) {
  if (!isPlainObject(value)) return null
  const { id, name, version, revision, updated_at } = value
  if (id !== expectedId || !isValidId(id)) return null
  if (![EDITOR_PROJECT_VERSION, EDITOR_PROJECT_V1_VERSION, EDITOR_PROJECT_V2_VERSION].includes(version)) return null
  if (typeof name !== 'string') return null
  if (!isPositiveInteger(revision)) return null
  if (!isIsoTimestamp(updated_at)) return null
  return { id, name, version, revision, updated_at }
}

async function classifyListedProjectEntry(paths) {
  const directory = await captureListDirectoryIdentity(paths.projectDir)
  if (directory.kind === 'missing' || directory.kind === 'not-directory') return { kind: 'ignore' }
  if (directory.kind !== 'ok') return { kind: 'omit' }

  let fileStat
  try {
    fileStat = await lstat(paths.projectJson)
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'ignore' }
    return { kind: 'omit' }
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) return { kind: 'omit' }
  if (fileStat.size > EDITOR_PROJECT_LIST_LIMITS.maxIndexBytes) return { kind: 'omit' }
  return {
    kind: 'index',
    size: fileStat.size,
    identity: { dev: fileStat.dev, ino: fileStat.ino },
    directoryIdentity: directory.identity,
  }
}

async function readListedFileHandleBytes(fileHandle, size) {
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await fileHandle.read(bytes, offset, size - offset, offset)
    if (!bytesRead) throw new Error('listed project read ended early')
    offset += bytesRead
  }
  return bytes
}

async function readListedProjectIndex(filePath, expected, onListReadEvent) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) return { kind: 'omit', consumed: 0 }
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  let fileHandle
  try {
    fileHandle = await open(filePath, flags)
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'ignore', consumed: 0 }
    return { kind: 'omit', consumed: 0 }
  }
  let billedSize = 0
  try {
    const openedStat = await fileHandle.stat()
    if (
      !openedStat.isFile()
      || openedStat.size !== expected.size
      || openedStat.size > EDITOR_PROJECT_LIST_LIMITS.maxIndexBytes
      || !sameFilesystemIdentity(openedStat, expected.identity)
    ) {
      return { kind: 'omit', consumed: 0 }
    }
    billedSize = openedStat.size
    await emitListReadEvent(onListReadEvent, {
      stage: 'before-index-read',
      filePath,
      size: openedStat.size,
    })
    const bytes = await readListedFileHandleBytes(fileHandle, openedStat.size)
    const afterStat = await fileHandle.stat()
    if (
      !afterStat.isFile()
      || afterStat.size !== openedStat.size
      || !sameFilesystemIdentity(afterStat, expected.identity)
    ) {
      return { kind: 'omit', consumed: billedSize }
    }
    return { kind: 'bytes', bytes, consumed: billedSize }
  } catch (error) {
    if (error instanceof EditorProjectStoreError) throw error
    return { kind: 'omit', consumed: billedSize }
  } finally {
    try {
      await fileHandle.close()
    } catch {
      // List reads must always release the handle.
    }
  }
}

function compareProjectListSummaries(left, right) {
  if (left.updated_at !== right.updated_at) {
    return left.updated_at < right.updated_at ? 1 : -1
  }
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

export async function listEditorProjects({
  projectRoot = process.cwd(),
  workspaceRoot,
  cursor = null,
  paginate = false,
  onListReadEvent,
} = {}) {
  if (cursor != null && (typeof cursor !== 'string' || !isValidId(cursor))) {
    throw listStoreError('invalid_request', 'editor project list cursor is invalid')
  }
  const paged = Boolean(paginate || cursor != null)
  const workspace = configuredListWorkspaceRoot({ projectRoot, workspaceRoot })
  const projectsDir = path.join(workspace, 'projects')

  const workspaceCaptured = await captureListDirectoryIdentity(workspace)
  if (workspaceCaptured.kind === 'missing') {
    return { projects: [], omitted_count: 0, ...(cursor != null ? { has_more: false, next_cursor: null } : {}) }
  }
  if (workspaceCaptured.kind === 'unreadable') throw listRootUnreadable()
  if (workspaceCaptured.kind !== 'ok') throw listRootUnsafe()

  const projectsCaptured = await captureListDirectoryIdentity(projectsDir)
  if (projectsCaptured.kind === 'missing') {
    return { projects: [], omitted_count: 0, ...(cursor != null ? { has_more: false, next_cursor: null } : {}) }
  }
  if (projectsCaptured.kind === 'unreadable') throw listRootUnreadable()
  if (projectsCaptured.kind !== 'ok') throw listRootUnsafe()
  if (path.join(workspaceCaptured.identity.realPath, 'projects') !== projectsCaptured.identity.realPath) {
    throw listRootUnsafe()
  }

  await emitListReadEvent(onListReadEvent, {
    stage: 'after-root-identity',
    workspace,
    projectsDir,
  })
  await assertListRootIdentity(
    workspace,
    projectsDir,
    workspaceCaptured.identity,
    projectsCaptured.identity,
  )

  let directory
  try {
    directory = await opendir(projectsDir)
  } catch {
    throw listRootUnreadable()
  }

  const entryNames = []
  try {
    while (true) {
      const dirent = await directory.read()
      if (!dirent) break
      entryNames.push(dirent.name)
      if (entryNames.length > EDITOR_PROJECT_LIST_LIMITS.maxFirstLevelEntries) {
        throw listResourceLimit()
      }
    }
  } catch (error) {
    if (error instanceof EditorProjectStoreError) throw error
    throw listRootUnreadable()
  } finally {
    try {
      await directory.close()
    } catch {
      // Directory iteration may already have closed the handle.
    }
  }
  entryNames.sort()

  await assertListRootIdentity(
    workspace,
    projectsDir,
    workspaceCaptured.identity,
    projectsCaptured.identity,
  )

  const summaries = []
  let omittedCount = 0
  let candidateCount = 0
  let cumulativeReadBytes = 0
  let lastCompletedEntryName = null
  let hasMore = false
  let nextCursor = null

  for (const entryName of entryNames) {
    if (!isValidId(entryName)) continue
    if (cursor != null && entryName <= cursor) continue

    await assertListRootIdentity(
      workspace,
      projectsDir,
      workspaceCaptured.identity,
      projectsCaptured.identity,
    )

    let paths
    try {
      paths = resolveEditorProjectPaths({
        projectId: entryName,
        projectRoot,
        workspaceRoot: workspace,
      })
    } catch {
      continue
    }

    const classified = await classifyListedProjectEntry(paths)
    if (classified.kind === 'ignore') continue

    if (paged && candidateCount >= EDITOR_PROJECT_LIST_LIMITS.maxCandidates && lastCompletedEntryName != null) {
      hasMore = true
      nextCursor = lastCompletedEntryName
      break
    }
    candidateCount += 1
    if (candidateCount > EDITOR_PROJECT_LIST_LIMITS.maxCandidates) throw listResourceLimit()
    if (classified.kind === 'omit') {
      omittedCount += 1
      lastCompletedEntryName = entryName
      continue
    }

    if (cumulativeReadBytes + classified.size > EDITOR_PROJECT_LIST_LIMITS.maxCumulativeReadBytes) {
      if (paged && lastCompletedEntryName != null) {
        candidateCount -= 1
        hasMore = true
        nextCursor = lastCompletedEntryName
        break
      }
      throw listResourceLimit()
    }

    await emitListReadEvent(onListReadEvent, {
      stage: 'after-project-identity',
      projectId: entryName,
      projectDir: paths.projectDir,
    })
    const directoryNow = await captureListDirectoryIdentity(paths.projectDir)
    if (!projectDirectoryStillTrusted(
      directoryNow,
      classified.directoryIdentity,
      projectsCaptured.identity,
      entryName,
      paths,
    )) {
      omittedCount += 1
      lastCompletedEntryName = entryName
      continue
    }

    cumulativeReadBytes += classified.size

    const read = await readListedProjectIndex(paths.projectJson, classified, onListReadEvent)
    if (read.consumed > classified.size) {
      const extra = read.consumed - classified.size
      if (cumulativeReadBytes + extra > EDITOR_PROJECT_LIST_LIMITS.maxCumulativeReadBytes) {
        throw listResourceLimit()
      }
      cumulativeReadBytes += extra
    }
    if (read.kind === 'ignore') {
      candidateCount -= 1
      lastCompletedEntryName = entryName
      continue
    }
    if (read.kind !== 'bytes') {
      omittedCount += 1
      lastCompletedEntryName = entryName
      continue
    }

    let parsed
    try {
      parsed = JSON.parse(read.bytes.toString('utf8'))
    } catch {
      omittedCount += 1
      lastCompletedEntryName = entryName
      continue
    }
    const summary = projectListSummary(parsed, entryName)
    if (!summary) {
      omittedCount += 1
      lastCompletedEntryName = entryName
      continue
    }
    summaries.push(summary)
    lastCompletedEntryName = entryName
  }

  summaries.sort(compareProjectListSummaries)
  const result = {
    projects: summaries,
    omitted_count: omittedCount,
    ...(hasMore
      ? { has_more: true, next_cursor: nextCursor }
      : (cursor != null ? { has_more: false, next_cursor: null } : {})),
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > EDITOR_PROJECT_LIST_LIMITS.maxResponseBytes) {
    throw listResourceLimit()
  }
  return result
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
  rejectLegacyV1Write(project, current)
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
  rejectLegacyV1Write(project)
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
    rejectLegacyV1Write(loaded.project)
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
