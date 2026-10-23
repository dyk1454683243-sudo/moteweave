import { constants as fsConstants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { isSafeRelativePath, isValidId, isValidJobId } from './safety.js'

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function codedPathError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function assertContained(rootPath, candidatePath, code) {
  const relative = path.relative(rootPath, candidatePath)
  const escapesRoot = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  if (!escapesRoot) return candidatePath
  throw codedPathError(code, 'artifact escapes its controlled root')
}

function unsafeArtifactPath(message = 'artifact path is unsafe') {
  return codedPathError('unsafe_artifact_path', message)
}

export async function resolveContainedRegularFile({
  controlledRootPath,
  rootPath,
  candidatePath,
  errorCode,
}) {
  const lexicalControlledRoot = path.resolve(controlledRootPath)
  const lexicalRoot = assertContained(lexicalControlledRoot, path.resolve(rootPath), errorCode)
  const lexicalCandidate = assertContained(lexicalRoot, path.resolve(candidatePath), errorCode)
  let realControlledRoot
  let realRoot
  let realCandidate
  try {
    ;[realControlledRoot, realRoot, realCandidate] = await Promise.all([
      realpath(lexicalControlledRoot),
      realpath(lexicalRoot),
      realpath(lexicalCandidate),
    ])
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw codedPathError('artifact_not_found', 'artifact file does not exist')
    }
    throw codedPathError(errorCode, 'artifact file could not be safely resolved')
  }
  assertContained(realControlledRoot, realRoot, errorCode)
  assertContained(realRoot, realCandidate, errorCode)
  let fileStat
  try {
    fileStat = await stat(realCandidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw codedPathError('artifact_not_found', 'artifact file does not exist')
    }
    throw codedPathError(errorCode, 'artifact file could not be safely inspected')
  }
  if (!fileStat.isFile()) throw codedPathError(errorCode, 'artifact must be a regular file')
  return realCandidate
}

export function sanitizeEditorId(value, fallback = 'item') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const id = normalized || fallback
  return isValidId(id) ? id : fallback
}

export function assertSafePathSegment(value, label = 'path segment') {
  const segment = String(value ?? '')
  if (!PATH_SEGMENT_PATTERN.test(segment) || segment.includes('..')) {
    throw new Error(`${label} is unsafe: ${segment || '(empty)'}`)
  }
  return segment
}

export function resolveEditorProjectPaths({
  projectId,
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
} = {}) {
  const safeProjectId = sanitizeEditorId(projectId, 'project_demo')
  if (safeProjectId !== projectId) throw new Error(`project id is unsafe: ${projectId || '(empty)'}`)
  const root = path.resolve(projectRoot)
  const workspace = path.resolve(workspaceRoot)
  const projectsDir = path.join(workspace, 'projects')
  const projectDir = path.join(projectsDir, safeProjectId)
  return {
    projectRoot: root,
    workspaceRoot: workspace,
    projectsDir,
    projectDir,
    projectJson: path.join(projectDir, 'project.json'),
    backupJson: path.join(projectDir, 'project.backup.json'),
    autosaveJson: path.join(projectDir, 'autosave.json'),
    assetsDir: path.join(projectDir, 'assets'),
    exportsDir: path.join(projectDir, 'exports'),
    recipesDir: path.join(projectDir, 'recipes'),
    spriteDocumentsDir: path.join(projectDir, 'sprite-documents'),
  }
}

export function resolveSpriteDocumentPaths({
  projectId,
  documentId,
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
} = {}) {
  const paths = resolveEditorProjectPaths({ projectId, projectRoot, workspaceRoot })
  const safeDocumentId = sanitizeEditorId(documentId, 'document')
  if (safeDocumentId !== documentId) throw new Error(`document id is unsafe: ${documentId || '(empty)'}`)
  const documentDir = path.join(paths.spriteDocumentsDir, safeDocumentId)
  return {
    ...paths,
    documentDir,
    revisionsDir: path.join(documentDir, 'revisions'),
    blocksDir: path.join(documentDir, 'blocks'),
  }
}

export function spriteDocumentRevisionPath(paths, revision) {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`document revision is unsafe: ${revision}`)
  }
  return path.join(paths.revisionsDir, `${revision}.json`)
}

export function spriteDocumentBlockPath(paths, sha256) {
  const digest = String(sha256 ?? '')
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`block hash is unsafe: ${digest || '(empty)'}`)
  return path.join(paths.blocksDir, `${digest}.rgba`)
}

export function projectRelativePath(filePath, { projectRoot = process.cwd() } = {}) {
  const relative = toPosix(path.relative(path.resolve(projectRoot), path.resolve(filePath)))
  if (!isSafeRelativePath(relative)) throw new Error(`resolved path is not project-relative safe: ${relative}`)
  return relative
}

export function resolveManagedAssetRevisionPaths({
  projectId,
  assetId,
  revisionId,
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
} = {}) {
  const paths = resolveEditorProjectPaths({ projectId, projectRoot, workspaceRoot })
  const safeAssetId = sanitizeEditorId(assetId, 'asset')
  const safeRevisionId = sanitizeEditorId(revisionId, 'rev_001')
  if (safeAssetId !== assetId) throw new Error(`asset id is unsafe: ${assetId || '(empty)'}`)
  if (safeRevisionId !== revisionId) throw new Error(`revision id is unsafe: ${revisionId || '(empty)'}`)
  const revisionDir = path.join(paths.assetsDir, safeAssetId, safeRevisionId)
  return {
    ...paths,
    assetDir: path.join(paths.assetsDir, safeAssetId),
    revisionDir,
    relativeRevisionDir: projectRelativePath(revisionDir, { projectRoot }),
  }
}

export function resolveGeneratedJobDir(jobId, { generatedDir } = {}) {
  if (typeof jobId !== 'string' || !jobId || !isValidJobId(jobId)) {
    throw new Error(`generated job id is unsafe: ${jobId || '(empty)'}`)
  }
  const safeJobId = assertSafePathSegment(jobId, 'generated job id')
  const root = path.resolve(generatedDir ?? path.join(process.cwd(), 'generated'))
  const jobDir = path.resolve(root, safeJobId)
  const relative = path.relative(root, jobDir)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`generated job id escapes generated root: ${jobId}`)
  }
  return jobDir
}

export async function resolveManagedRevisionArtifactFile({
  projectId,
  assetId,
  revision,
  artifactKey,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  if (!revision || typeof revision !== 'object' || typeof artifactKey !== 'string') {
    throw unsafeArtifactPath()
  }
  const recorded = artifactKey === 'processing_recipe'
    ? revision.processing_recipe_ref
    : Object.hasOwn(revision.artifacts ?? {}, artifactKey)
      ? revision.artifacts[artifactKey]
      : null
  if (typeof recorded !== 'string' || !isSafeRelativePath(recorded)) {
    throw unsafeArtifactPath()
  }

  let paths
  try {
    paths = resolveManagedAssetRevisionPaths({
      projectId,
      assetId,
      revisionId: revision.id,
      projectRoot,
      workspaceRoot,
    })
  } catch {
    throw unsafeArtifactPath()
  }

  const normalizedRecorded = recorded.replaceAll('\\', '/')
  const revisionPrefix = `${paths.relativeRevisionDir}/`
  const relativeArtifactPath = normalizedRecorded.startsWith(revisionPrefix)
    ? normalizedRecorded.slice(revisionPrefix.length)
    : null
  if (!relativeArtifactPath || !isSafeRelativePath(relativeArtifactPath)) {
    throw unsafeArtifactPath('recorded artifact identity does not match its revision')
  }

  return resolveContainedRegularFile({
    controlledRootPath: paths.workspaceRoot,
    rootPath: paths.revisionDir,
    candidatePath: path.resolve(projectRoot, normalizedRecorded),
    errorCode: 'unsafe_artifact_path',
  })
}

export async function resolveGeneratedJobArtifactFile({
  jobId,
  fileName,
  allowedFiles,
  generatedDir,
} = {}) {
  if (
    typeof fileName !== 'string' ||
    typeof allowedFiles?.has !== 'function' ||
    !allowedFiles.has(fileName) ||
    !isSafeRelativePath(fileName)
  ) {
    throw unsafeArtifactPath()
  }

  const generatedRoot = path.resolve(generatedDir ?? path.join(process.cwd(), 'generated'))
  let jobDir
  try {
    jobDir = resolveGeneratedJobDir(jobId, { generatedDir: generatedRoot })
  } catch {
    throw unsafeArtifactPath()
  }
  const normalizedFileName = fileName.replaceAll('\\', '/')
  return resolveContainedRegularFile({
    controlledRootPath: generatedRoot,
    rootPath: jobDir,
    candidatePath: path.resolve(jobDir, normalizedFileName),
    errorCode: 'unsafe_artifact_path',
  })
}

function sameFilesystemIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

async function fsyncDirectory(directoryPath) {
  const handle = await open(directoryPath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

let persistObserver = null

function recordTrustedPersist(action, targetPath) {
  if (!persistObserver) return
  persistObserver.push({
    action,
    path: path.resolve(targetPath),
  })
}

export function setTrustedPersistObserver(observer = null) {
  persistObserver = observer
}

function directoryIdentityFrom(statResult, realPath) {
  return Object.freeze({
    realPath,
    dev: statResult.dev,
    ino: statResult.ino,
  })
}

async function inspectTrustedDirectory(directoryPath, errorCode) {
  const lexicalStat = await lstat(directoryPath)
  if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) {
    throw codedPathError(errorCode, 'directory identity is unsafe')
  }
  const realPath = await realpath(directoryPath)
  const resolvedStat = await stat(realPath)
  if (!sameFilesystemIdentity(lexicalStat, resolvedStat)) {
    throw codedPathError(errorCode, 'directory identity is unsafe')
  }
  return directoryIdentityFrom(lexicalStat, realPath)
}

async function persistNewDirectoryEntry(parentPath, createdPath, errorCode, syncFault = null) {
  const createdStat = await lstat(createdPath)
  if (createdStat.isSymbolicLink() || !createdStat.isDirectory()) {
    throw codedPathError(errorCode, 'directory identity is unsafe')
  }
  await fsyncDirectory(createdPath)
  recordTrustedPersist('fsync-directory', createdPath)
  if (syncFault === 'parent') {
    throw codedPathError(errorCode, 'directory could not be synchronized')
  }
  await fsyncDirectory(parentPath)
  recordTrustedPersist('fsync-parent', parentPath)
}

async function persistContainedDirectoryChain(rootPath, directoryPath, errorCode, syncFault = null) {
  const lexicalRoot = path.resolve(rootPath)
  const lexicalDir = path.resolve(directoryPath)
  const leafParent = path.dirname(lexicalDir)
  const relative = path.relative(lexicalRoot, lexicalDir)
  const parts = relative === '' ? [] : relative.split(path.sep).filter(Boolean)
  const nodes = [lexicalRoot]
  let current = lexicalRoot
  for (const part of parts) {
    current = path.join(current, part)
    nodes.push(current)
  }
  for (const dir of nodes) {
    await inspectTrustedDirectory(dir, errorCode)
    const parentPath = path.dirname(dir)
    const isLeaf = path.resolve(dir) === lexicalDir
    const isLeafParent = !isLeaf && path.resolve(dir) === path.resolve(leafParent)
    if (syncFault === 'parent' && isLeafParent) {
      await fsyncDirectory(parentPath)
      recordTrustedPersist('fsync-parent', parentPath)
      continue
    }
    await fsyncDirectory(dir)
    recordTrustedPersist('fsync-directory', dir)
    if (syncFault === 'parent' && isLeaf) {
      throw codedPathError(errorCode, 'directory could not be synchronized')
    }
    await fsyncDirectory(parentPath)
    recordTrustedPersist('fsync-parent', parentPath)
  }
}

async function persistDirectoryIdentity(directoryPath, expected, errorCode, { published = false, failBeforeSync = false } = {}) {
  const current = await inspectTrustedDirectory(directoryPath, errorCode)
  if (!sameFilesystemIdentity(expected, current) || current.realPath !== expected.realPath) {
    throw codedPathError(errorCode, 'directory identity is unsafe')
  }
  if (failBeforeSync) {
    const error = codedPathError(errorCode, 'directory could not be synchronized')
    error.published = published
    throw error
  }
  try {
    await fsyncDirectory(directoryPath)
  } catch {
    const error = codedPathError(errorCode, 'directory could not be synchronized')
    error.published = published
    throw error
  }
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath)
  } catch {
    // Temp cleanup is best-effort and must not hide the publish result.
  }
}

export async function ensureTrustedContainedDirectory({
  controlledRootPath,
  directoryPath,
  errorCode = 'unsafe_artifact_path',
  syncFault = null,
}) {
  const lexicalRoot = path.resolve(controlledRootPath)
  const lexicalDir = path.resolve(directoryPath)
  assertContained(lexicalRoot, lexicalDir, errorCode)
  let rootStat
  try {
    rootStat = await lstat(lexicalRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw codedPathError(errorCode, 'controlled root is unsafe')
    }
    const parentPath = path.dirname(lexicalRoot)
    const parentStat = await lstat(parentPath).catch(() => null)
    if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
      throw codedPathError(errorCode, 'controlled root is unsafe')
    }
    try {
      await mkdir(lexicalRoot)
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') {
        throw codedPathError(errorCode, 'controlled root is unsafe')
      }
    }
    await persistNewDirectoryEntry(parentPath, lexicalRoot, errorCode, syncFault)
    rootStat = await lstat(lexicalRoot)
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw codedPathError(errorCode, 'controlled root must be a real directory')
  }
  const relative = path.relative(lexicalRoot, lexicalDir)
  const parts = relative === '' ? [] : relative.split(path.sep).filter(Boolean)
  let current = lexicalRoot
  for (const part of parts) {
    const parentPath = current
    current = path.join(current, part)
    try {
      const currentStat = await lstat(current)
      if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
        throw codedPathError(errorCode, 'directory identity is unsafe')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error?.code === errorCode) throw error
        throw codedPathError(errorCode, 'directory could not be safely created')
      }
      try {
        await mkdir(current)
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') {
          throw codedPathError(errorCode, 'directory could not be safely created')
        }
      }
      await persistNewDirectoryEntry(parentPath, current, errorCode, syncFault)
    }
  }
  const realRoot = await realpath(lexicalRoot)
  const identity = await inspectTrustedDirectory(lexicalDir, errorCode)
  assertContained(realRoot, identity.realPath, errorCode)
  await persistContainedDirectoryChain(lexicalRoot, lexicalDir, errorCode, syncFault)
  return identity
}

async function writeExactHandle(handle, bytes) {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset)
    if (!bytesWritten) throw codedPathError('unsafe_artifact_path', 'trusted write made no progress')
    offset += bytesWritten
  }
}

export async function writeTrustedRegularFile({
  controlledRootPath,
  filePath,
  bytes,
  exclusive = false,
  errorCode = 'unsafe_artifact_path',
  syncFault = null,
  beforePublish = null,
}) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw codedPathError(errorCode, 'trusted write requires no-follow support')
  }
  const lexicalFile = path.resolve(filePath)
  const directoryPath = path.dirname(lexicalFile)
  const directoryIdentity = await ensureTrustedContainedDirectory({
    controlledRootPath,
    directoryPath,
    errorCode,
    syncFault: syncFault === 'parent' ? 'parent' : null,
  })
  try {
    const existing = await lstat(lexicalFile)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw codedPathError(errorCode, 'target file identity is unsafe')
    }
    if (exclusive) {
      const current = await readFile(lexicalFile)
      if (current.equals(bytes)) {
        await persistDirectoryIdentity(directoryPath, directoryIdentity, errorCode)
        return { reused: true }
      }
      throw codedPathError(errorCode, 'immutable file already exists')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const tempPath = `${lexicalFile}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const flags = fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW
  let handle
  try {
    handle = await open(tempPath, flags, 0o600)
  } catch {
    throw codedPathError(errorCode, 'trusted temp file could not be created')
  }
  try {
    const openedStat = await handle.stat()
    if (!openedStat.isFile() || openedStat.size !== 0) {
      throw codedPathError(errorCode, 'trusted temp file identity is unsafe')
    }
    await writeExactHandle(handle, bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const verified = await readFile(tempPath)
  if (!verified.equals(bytes)) {
    await safeUnlink(tempPath)
    throw codedPathError(errorCode, 'trusted file failed verification')
  }
  let currentDirectory
  try {
    if (typeof beforePublish === 'function') {
      await beforePublish({
        directoryPath,
        directoryIdentity,
        tempPath,
        filePath: lexicalFile,
      })
    }
    currentDirectory = await ensureTrustedContainedDirectory({
      controlledRootPath,
      directoryPath,
      errorCode,
    })
  } catch (error) {
    await safeUnlink(tempPath)
    await safeUnlink(path.join(directoryIdentity.realPath, path.basename(tempPath)))
    throw error
  }
  if (!sameFilesystemIdentity(directoryIdentity, currentDirectory) || currentDirectory.realPath !== directoryIdentity.realPath) {
    await safeUnlink(tempPath)
    await safeUnlink(path.join(directoryIdentity.realPath, path.basename(tempPath)))
    throw codedPathError(errorCode, 'directory identity is unsafe')
  }

  if (exclusive) {
    try {
      await link(tempPath, lexicalFile)
    } catch (error) {
      await safeUnlink(tempPath)
      if (error?.code === 'EEXIST') {
        const raced = await lstat(lexicalFile)
        if (raced.isSymbolicLink() || !raced.isFile()) {
          throw codedPathError(errorCode, 'target file identity is unsafe')
        }
        const current = await readFile(lexicalFile)
        if (current.equals(bytes)) {
          await persistDirectoryIdentity(directoryPath, directoryIdentity, errorCode)
          return { reused: true }
        }
        throw codedPathError(errorCode, 'immutable file already exists')
      }
      throw codedPathError(errorCode, 'immutable file could not be published')
    }
    await safeUnlink(tempPath)
  } else {
    await rename(tempPath, lexicalFile)
  }

  const published = await lstat(lexicalFile)
  if (published.isSymbolicLink() || !published.isFile()) {
    throw codedPathError(errorCode, 'published file identity is unsafe')
  }
  recordTrustedPersist('publish-file', lexicalFile)
  await persistDirectoryIdentity(directoryPath, directoryIdentity, errorCode, {
    published: true,
    failBeforeSync: syncFault === 'publish',
  })
  return { reused: false }
}

export async function copyTrustedRegularFile({
  controlledRootPath,
  sourcePath,
  destinationPath,
  errorCode = 'unsafe_artifact_path',
}) {
  const bytes = await readFile(sourcePath)
  return writeTrustedRegularFile({
    controlledRootPath,
    filePath: destinationPath,
    bytes,
    exclusive: true,
    errorCode,
  })
}

export async function fsyncTrustedDirectory(directoryPath, { errorCode = 'unsafe_artifact_path' } = {}) {
  try {
    const lexicalStat = await lstat(directoryPath)
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) {
      throw codedPathError(errorCode, 'directory identity is unsafe')
    }
    await fsyncDirectory(directoryPath)
  } catch (error) {
    if (error?.code === errorCode) throw error
    throw codedPathError(errorCode, 'directory could not be synchronized')
  }
}
