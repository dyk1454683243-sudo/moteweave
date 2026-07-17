import { realpath, stat } from 'node:fs/promises'
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
  }
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
