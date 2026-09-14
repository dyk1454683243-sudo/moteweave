import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import {
  FIXED_REGION_ACTION_REPAIR_JOB_TYPE,
  FIXED_REGION_ACTION_REPAIR_MANAGED_FILES,
  FIXED_REGION_ACTION_REPAIR_REVIEW_FILE,
  assertFixedRegionActionRepairAcceptanceManifest,
  assertFixedRegionActionRepairReviewContract,
  fixedRegionActionRepairArtifactKey,
} from '../character-pack/fixedRegionActionRepairReview.js'
import {
  createAssetRef,
  createAssetRevision,
  getDefaultProductionStatus,
} from './assets.js'
import {
  resolveGeneratedJobArtifactFile,
  resolveGeneratedJobDir,
  resolveManagedAssetRevisionPaths,
  resolveManagedRevisionArtifactFile,
  sanitizeEditorId,
} from './paths.js'
import {
  clonePlain,
  isPlainObject,
  isSafeRelativePath,
  isValidId,
  isValidJobId,
} from './safety.js'
import {
  validateAssetRef,
  validateEditorProject,
} from './validation.js'

const CHARACTER_ARTIFACT_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  source_quality_report: 'source_quality_report.json',
  sheet: 'normalized_sheet.png',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  inspection_index: 'inspection_index.json',
  inspection_sheet: 'inspection_sheet.png',
  prompt: 'prompt.txt',
  generation: 'generation.json',
  godot_npc_zip: 'godot_npc_pack.zip',
  rpgmaker_zip: 'rpgmaker_pack.zip',
  ocad_zip: 'ocad_pack.zip',
  zip: 'character_pack.zip',
})

const SPECIALIZED_CONTEXT_FILES = Object.freeze([
  // Historical reprocess evidence remains blocked from the general importer.
  Object.freeze(['editor_reprocess_context.json', 'editor_character_reprocess']),
  Object.freeze([FIXED_REGION_ACTION_REPAIR_REVIEW_FILE, FIXED_REGION_ACTION_REPAIR_JOB_TYPE]),
])

const FIXED_REGION_ACTION_REPAIR_REQUIRED_MANAGED_KEYS = Object.freeze([
  'source',
  'sheet',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
  'zip',
  'action_repair_plan',
  'action_repair_review',
  'action_repair_summary',
  'action_repair_identity_anchor_atlas',
  'action_repair_pose_guide_atlas',
  'action_repair_empty_output_atlas',
  'action_repair_raw_provider_output',
  'action_repair_atlas_extraction',
  'action_repair_provider_source',
  'action_repair_repaired_source',
  'action_repair_review_candidate',
  'action_repair_candidate_validation',
  'action_repair_scope',
  'action_repair_equipment_quality',
  'action_repair_equipment_overlay',
  'action_repair_acceptance_manifest',
])

const SCENE_ARTIFACT_FILES = Object.freeze({
  scene: 'scene.json',
  tile_map: 'tile_map.json',
  tile_atlas: 'tile_atlas.json',
  validation: 'quality_gate.json',
  preview: 'tileset.png',
  tileset: 'tileset.png',
  ldtk_project: 'project.ldtk',
  zip: 'scene_pack.zip',
})

const IMPORT_SPECS = Object.freeze({
  character_pack: Object.freeze({
    kind: 'character_pack',
    required: Object.freeze(['sheet', 'animations', 'metadata', 'editor_metadata', 'debug_report']),
    artifacts: CHARACTER_ARTIFACT_FILES,
  }),
  scene_pack: Object.freeze({
    kind: 'scene_pack',
    required: Object.freeze(['scene', 'tile_map', 'tile_atlas', 'validation', 'preview']),
    artifacts: SCENE_ARTIFACT_FILES,
  }),
})

function readJson(filePath) {
  return readFile(filePath, 'utf8').then((text) => JSON.parse(text))
}

function codedArtifactError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

async function resolveOptionalGeneratedArtifact({ jobId, fileName, allowedFiles, generatedDir }) {
  try {
    return await resolveGeneratedJobArtifactFile({ jobId, fileName, allowedFiles, generatedDir })
  } catch (error) {
    if (error?.code === 'artifact_not_found') return null
    throw error
  }
}

async function assertGeneralImportAllowed({ jobId, generatedDir }) {
  const allowedFiles = new Set(SPECIALIZED_CONTEXT_FILES.map(([fileName]) => fileName))
  for (const [fileName, jobType] of SPECIALIZED_CONTEXT_FILES) {
    const contextPath = await resolveOptionalGeneratedArtifact({
      jobId,
      fileName,
      allowedFiles,
      generatedDir,
    })
    if (!contextPath) continue
    if (fileName === FIXED_REGION_ACTION_REPAIR_REVIEW_FILE) {
      throw codedArtifactError(
        'specialized_accept_required',
        'fixed-region action repair jobs require sealed specialized acceptance',
      )
    }
    const context = await readJson(contextPath)
    if (context?.job_type === jobType) {
      throw codedArtifactError(
        'specialized_accept_required',
        'editor character jobs with sealed context require specialized acceptance',
      )
    }
  }
}

async function resolveKnownArtifactEntries({ spec, jobId, generatedDir }) {
  const allowedFiles = new Set(Object.values(spec.artifacts))
  const entries = []
  for (const [key, fileName] of Object.entries(spec.artifacts)) {
    const sourcePath = await resolveOptionalGeneratedArtifact({ jobId, fileName, allowedFiles, generatedDir })
    if (sourcePath) entries.push({ key, fileName, sourcePath })
  }
  return entries
}

function assertRequiredArtifacts(spec, entries) {
  const present = new Set(entries.map((entry) => entry.key))
  const missing = spec.required.filter((key) => !present.has(key))
  if (missing.length) throw new Error(`generated job is missing required ${spec.kind} artifacts: ${missing.join(', ')}`)
}

function statusFromReport(value) {
  const status = value?.status ?? value?.validation?.status ?? value?.quality?.status
  return ['pass', 'warning', 'fail', 'unknown'].includes(status) ? status : 'unknown'
}

function provenanceSourceType(metadata = {}) {
  const raw = String(metadata.source?.type ?? '').trim()
  if (['upload', 'provider', 'manual_import', 'local_procedural', 'derived_revision'].includes(raw)) return raw
  if (/repair|derived/i.test(raw)) return 'derived_revision'
  if (/provider|t2i|openrouter|gemini|generation/i.test(raw) || metadata.generation?.provider) return 'provider'
  return 'manual_import'
}

function nextRevisionId(asset) {
  const ids = Object.keys(asset?.revisions ?? {})
  const max = ids.reduce((highest, id) => {
    const match = id.match(/^rev_(\d+)$/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `rev_${String(max + 1).padStart(3, '0')}`
}

function deriveCharacterClips(animationsJson = {}) {
  const frameSize = animationsJson.frame_size ?? { w: 96, h: 96 }
  const anchor = animationsJson.anchor ?? { x: 48, y: 88 }
  return Object.fromEntries(
    Object.entries(animationsJson.animations ?? {}).map(([id, animation]) => [
      id,
      {
        id,
        source: 'animations.json',
        frames: [...(animation.frames ?? [])],
        fps: animation.fps ?? 8,
        loop_mode: animation.mode ?? (animation.loop ? 'loop' : 'once'),
        frame_size: { ...frameSize },
        anchor: { ...anchor },
      },
    ])
  )
}

function artifactKey(prefix, value) {
  return `${prefix}_${sanitizeEditorId(value, 'item')}`
}

function safeArtifactFile(value) {
  const file = String(value ?? '').replaceAll('\\', '/')
  if (!file || file.startsWith('/') || file.startsWith('~') || file.split('/').some((part) => part === '..')) return null
  return file
}

function explicitCharacterPreviewFiles(metadata = {}) {
  const files = []
  const clips = Object.keys(metadata.clips ?? {})
  for (const clipId of clips) {
    files.push([artifactKey('row_gif', clipId), `${clipId}.gif`])
  }
  for (const action of metadata.inspection_index?.actions ?? []) {
    const name = action.name ?? action.label ?? 'action'
    files.push([artifactKey('inspection_gif', name), action.file])
    files.push([artifactKey('inspection_strip', name), action.strip_file])
  }
  return files
    .map(([key, fileName]) => [key, safeArtifactFile(fileName)])
    .filter(([, fileName]) => Boolean(fileName))
}

async function resolveExplicitCharacterPreviewEntries({ metadata, jobId, generatedDir }) {
  const previews = explicitCharacterPreviewFiles(metadata)
  const allowedFiles = new Set(previews.map(([, fileName]) => fileName))
  const entries = []
  for (const [key, fileName] of previews) {
    const sourcePath = await resolveOptionalGeneratedArtifact({ jobId, fileName, allowedFiles, generatedDir })
    if (sourcePath) entries.push({ key, fileName, sourcePath })
  }
  return entries
}

function profileForKind(kind, metadata = {}) {
  if (kind === 'character_pack') return metadata.metadata?.profile ?? metadata.animations?.profile ?? 'topdown_rpg_v0'
  return metadata.tile_atlas?.profile ?? metadata.tile_map?.profile ?? metadata.scene?.profile ?? 'topdown_tile_dual_grid_v0'
}

async function copyArtifactFiles({ projectId, assetId, revisionId, projectRoot, workspaceRoot, entries }) {
  const paths = resolveManagedAssetRevisionPaths({ projectId, assetId, revisionId, projectRoot, workspaceRoot })
  await mkdir(paths.revisionDir, { recursive: true })
  const copiedBySourceName = new Map()
  const artifacts = {}

  for (const { key, fileName, sourcePath } of entries) {
    const targetPath = path.join(paths.revisionDir, fileName)
    if (!copiedBySourceName.has(fileName)) {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
      copiedBySourceName.set(fileName, targetPath)
    }
    artifacts[key] = `${paths.relativeRevisionDir}/${fileName}`
  }

  return artifacts
}

function artifactPathByKey(entries) {
  return new Map(entries.map((entry) => [entry.key, entry.sourcePath]))
}

async function readImportMetadata(kind, entries) {
  const files = artifactPathByKey(entries)
  if (kind === 'character_pack') {
    const animations = await readJson(files.get('animations'))
    const metadata = await readJson(files.get('metadata'))
    const debugReport = await readJson(files.get('debug_report'))
    const inspectionIndex = files.has('inspection_index')
      ? await readJson(files.get('inspection_index'))
      : null
    return {
      animations,
      metadata,
      debug_report: debugReport,
      inspection_index: inspectionIndex,
      quality_status: statusFromReport(debugReport),
      profile: profileForKind(kind, { animations, metadata }),
      name: metadata.name ?? metadata.id ?? null,
      provenance: {
        source_type: provenanceSourceType(metadata),
        provider: metadata.generation?.provider ?? null,
        model: metadata.generation?.model ?? null,
      },
      clips: deriveCharacterClips(animations),
    }
  }

  const scene = await readJson(files.get('scene'))
  const tileMap = await readJson(files.get('tile_map'))
  const tileAtlas = await readJson(files.get('tile_atlas'))
  const validation = await readJson(files.get('validation'))
  return {
    scene,
    tile_map: tileMap,
    tile_atlas: tileAtlas,
    validation,
    quality_status: statusFromReport(validation),
    profile: profileForKind(kind, { scene, tile_map: tileMap, tile_atlas: tileAtlas }),
    name: scene.name ?? scene.identifier ?? scene.id ?? null,
    provenance: {
      source_type: 'local_procedural',
      provider: null,
      model: null,
    },
    clips: {},
  }
}

function sameDirectoryIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

function assertOwnedPrivateDirectoryStat(value) {
  if (!value.isDirectory() || value.isSymbolicLink()) {
    throw codedArtifactError('unsafe_artifact_path', 'managed path must be a real directory')
  }
  // POSIX owner/mode checks exclude other-user replacement races. On platforms
  // without getuid(), the configured workspace root remains the explicit
  // single-user trust anchor and synchronous identity checks still prevent
  // interleaving by this Node process.
  if (typeof process.getuid === 'function' &&
      (value.uid !== process.getuid() || (value.mode & 0o022) !== 0)) {
    throw codedArtifactError('unsafe_artifact_path', 'managed directory permissions are unsafe')
  }
  return value
}

function assertContainedRealDirectorySync({ controlledRoot, directory }) {
  let lexicalStat
  let realDirectory
  let realStat
  try {
    lexicalStat = lstatSync(directory)
    if (lexicalStat.isSymbolicLink()) {
      throw codedArtifactError('unsafe_artifact_path', 'managed path must not be a symlink')
    }
    realDirectory = realpathSync(directory)
    realStat = statSync(realDirectory)
  } catch (error) {
    if (error?.code === 'unsafe_artifact_path') throw error
    throw codedArtifactError('unsafe_artifact_path', 'managed directory could not be safely inspected', error)
  }
  assertOwnedPrivateDirectoryStat(lexicalStat)
  assertOwnedPrivateDirectoryStat(realStat)
  if (!sameDirectoryIdentity(lexicalStat, realStat)) {
    throw codedArtifactError('unsafe_artifact_path', 'managed directory identity changed')
  }
  const relative = path.relative(controlledRoot, realDirectory)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw codedArtifactError('unsafe_artifact_path', 'managed directory escapes workspace')
  }
  return { realDirectory, identity: realStat }
}

function captureWorkspaceTrustAnchorSync(workspaceAlias) {
  let realWorkspaceRoot
  let rootStat
  try {
    realWorkspaceRoot = realpathSync(workspaceAlias)
    rootStat = statSync(realWorkspaceRoot)
  } catch (error) {
    throw codedArtifactError('unsafe_artifact_path', 'workspace root could not be safely resolved', error)
  }
  assertOwnedPrivateDirectoryStat(rootStat)
  return { realWorkspaceRoot, identity: rootStat }
}

function ensureManagedChildDirectorySync({ controlledRoot, parentDirectory, directory }) {
  const lexicalParent = path.resolve(parentDirectory)
  const lexicalDirectory = path.resolve(directory)
  if (path.dirname(lexicalDirectory) !== lexicalParent) {
    throw codedArtifactError('unsafe_artifact_path', 'managed directory is not an immediate child')
  }
  const parentBefore = assertContainedRealDirectorySync({
    controlledRoot,
    directory: lexicalParent,
  })
  try {
    mkdirSync(lexicalDirectory, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw codedArtifactError('unsafe_artifact_path', 'managed directory could not be created', error)
    }
  }
  const parentAfter = assertContainedRealDirectorySync({
    controlledRoot,
    directory: lexicalParent,
  })
  if (!sameDirectoryIdentity(parentBefore.identity, parentAfter.identity)) {
    throw codedArtifactError('unsafe_artifact_path', 'managed parent directory changed')
  }
  return assertContainedRealDirectorySync({ controlledRoot, directory: lexicalDirectory })
}

async function reserveRevisionDirectory({
  project,
  asset,
  projectRoot,
  workspaceRoot,
  requiredRevisionId = null,
}) {
  const protocolPaths = resolveManagedAssetRevisionPaths({
    projectId: project.id,
    assetId: asset.id,
    revisionId: 'rev_001',
    projectRoot,
    workspaceRoot,
  })
  const { realWorkspaceRoot } = captureWorkspaceTrustAnchorSync(protocolPaths.workspaceRoot)
  const physicalBase = {
    workspaceRoot: realWorkspaceRoot,
    projectsDir: path.join(realWorkspaceRoot, 'projects'),
    projectDir: path.join(realWorkspaceRoot, 'projects', project.id),
    assetsDir: path.join(realWorkspaceRoot, 'projects', project.id, 'assets'),
    assetDir: path.join(realWorkspaceRoot, 'projects', project.id, 'assets', asset.id),
  }
  const managedHierarchy = [
    physicalBase.projectsDir,
    physicalBase.projectDir,
    physicalBase.assetsDir,
    physicalBase.assetDir,
  ]
  let parentDirectory = realWorkspaceRoot
  for (const directory of managedHierarchy) {
    ensureManagedChildDirectorySync({
      controlledRoot: realWorkspaceRoot,
      parentDirectory,
      directory,
    })
    parentDirectory = directory
  }

  for (let number = 1; number < 1_000_000; number += 1) {
    const revisionId = `rev_${String(number).padStart(3, '0')}`
    if (requiredRevisionId && revisionId !== requiredRevisionId) {
      if (number === 1) {
        throw codedArtifactError('asset_revision_conflict', 'required managed revision is unavailable')
      }
      break
    }
    if (asset.revisions?.[revisionId]) continue
    const protocolRevisionPaths = resolveManagedAssetRevisionPaths({
      projectId: project.id,
      assetId: asset.id,
      revisionId,
      projectRoot,
      workspaceRoot: protocolPaths.workspaceRoot,
    })
    const revisionDir = path.join(physicalBase.assetDir, revisionId)
    const parentBefore = assertContainedRealDirectorySync({
      controlledRoot: realWorkspaceRoot,
      directory: physicalBase.assetDir,
    })
    try {
      mkdirSync(revisionDir, { mode: 0o700 })
    } catch (error) {
      if (error?.code === 'EEXIST' && !requiredRevisionId) continue
      if (error?.code === 'EEXIST') {
        throw codedArtifactError('asset_revision_conflict', 'required managed revision already exists', error)
      }
      throw codedArtifactError('unsafe_artifact_path', 'managed revision could not be reserved', error)
    }
    const parentAfter = assertContainedRealDirectorySync({
      controlledRoot: realWorkspaceRoot,
      directory: physicalBase.assetDir,
    })
    if (!sameDirectoryIdentity(parentBefore.identity, parentAfter.identity)) {
      throw codedArtifactError('unsafe_artifact_path', 'managed asset directory changed')
    }
    assertContainedRealDirectorySync({ controlledRoot: realWorkspaceRoot, directory: revisionDir })
    return {
      revisionId,
      paths: {
        ...protocolRevisionPaths,
        ...physicalBase,
        revisionDir,
        relativeRevisionDir: protocolRevisionPaths.relativeRevisionDir,
      },
    }
  }
  throw codedArtifactError('revision_id_exhausted', 'no revision id is available')
}

function normalizeVerifiedEvidence(value) {
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') throw new TypeError('not JSON')
    return JSON.parse(serialized)
  } catch {
    throw codedArtifactError('identity_mismatch', 'verified evidence is not canonical JSON')
  }
}

function parseCapturedEvidence(entries, key) {
  const entry = entries.find((candidate) => candidate.key === key)
  try {
    return JSON.parse(entry.content.toString('utf8'))
  } catch {
    throw codedArtifactError('artifact_integrity_failed', 'captured evidence is invalid')
  }
}

async function copyVerifiedManifest({ entries, paths }) {
  const artifacts = {}
  const resolvedEntries = []
  const capturedRevision = assertContainedRealDirectorySync({
    controlledRoot: paths.workspaceRoot,
    directory: paths.revisionDir,
  })
  const realRevisionDir = capturedRevision.realDirectory
  const revisionIdentity = capturedRevision.identity
  for (const entry of entries) {
    const targetPath = path.join(realRevisionDir, entry.fileName)
    let fileDescriptor = null
    try {
      const parentBefore = lstatSync(realRevisionDir)
      if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory() ||
          parentBefore.dev !== revisionIdentity.dev || parentBefore.ino !== revisionIdentity.ino) {
        throw codedArtifactError('artifact_integrity_failed', 'managed revision directory changed')
      }
      fileDescriptor = openSync(
        targetPath,
        fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0),
        0o600,
      )
      const parentOpened = lstatSync(realRevisionDir)
      if (parentOpened.isSymbolicLink() || !parentOpened.isDirectory() ||
          parentOpened.dev !== revisionIdentity.dev || parentOpened.ino !== revisionIdentity.ino) {
        throw codedArtifactError('artifact_integrity_failed', 'managed revision directory changed')
      }
      const before = fstatSync(fileDescriptor)
      if (!before.isFile() || before.size !== 0) {
        throw codedArtifactError('artifact_integrity_failed', 'managed artifact target is invalid')
      }
      writeFileSync(fileDescriptor, entry.content)
      const after = fstatSync(fileDescriptor)
      const verification = Buffer.alloc(entry.size)
      let offset = 0
      while (offset < verification.length) {
        const bytesRead = readSync(
          fileDescriptor,
          verification,
          offset,
          verification.length - offset,
          offset,
        )
        if (bytesRead <= 0) break
        offset += bytesRead
      }
      const realTarget = realpathSync(targetPath)
      const targetStat = statSync(targetPath)
      const parentAfter = lstatSync(realRevisionDir)
      if (!parentAfter.isDirectory() || parentAfter.isSymbolicLink() ||
          parentAfter.dev !== revisionIdentity.dev || parentAfter.ino !== revisionIdentity.ino ||
          path.dirname(realTarget) !== realRevisionDir || !targetStat.isFile() ||
          targetStat.dev !== after.dev || targetStat.ino !== after.ino ||
          before.dev !== after.dev || before.ino !== after.ino || after.size !== entry.size ||
          offset !== entry.size ||
          createHash('sha256').update(verification).digest('hex') !== entry.sha256) {
        throw codedArtifactError('artifact_integrity_failed', 'copied artifact hash mismatch')
      }
      closeSync(fileDescriptor)
      fileDescriptor = null
    } catch (error) {
      if (error?.code === 'artifact_integrity_failed') throw error
      throw codedArtifactError('artifact_integrity_failed', `could not copy captured artifact: ${entry.key}`, error)
    } finally {
      if (fileDescriptor != null) {
        try {
          closeSync(fileDescriptor)
        } catch {}
      }
    }
    artifacts[entry.key] = `${paths.relativeRevisionDir}/${entry.fileName}`
    resolvedEntries.push({ key: entry.key, fileName: entry.fileName, sourcePath: targetPath })
  }
  return { artifacts, resolvedEntries }
}

export function getEditorArtifactImportSpec(kind) {
  return IMPORT_SPECS[kind] ?? null
}

function snapshotFixedRegionActionRepairManifest({
  manifest,
  verifiedReviewContract,
  verifiedAcceptanceManifest,
}) {
  const review = assertFixedRegionActionRepairReviewContract(
    normalizeVerifiedEvidence(verifiedReviewContract),
  )
  const acceptance = assertFixedRegionActionRepairAcceptanceManifest(
    normalizeVerifiedEvidence(verifiedAcceptanceManifest),
  )
  if (!Array.isArray(manifest) || !manifest.length) {
    throw codedArtifactError('artifact_integrity_failed', 'captured action repair manifest is incomplete')
  }
  const entries = []
  const seenKeys = new Set()
  const seenNames = new Set()
  for (const original of manifest) {
    const key = original?.key
    const fileName = original?.fileName ?? original?.file_name
    const content = Buffer.isBuffer(original?.content) ? Buffer.from(original.content) : null
    const size = original?.size ?? original?.byte_length
    const sha256 = original?.sha256
    if (key !== fixedRegionActionRepairArtifactKey(fileName) || !content ||
        !Number.isSafeInteger(size) || size <= 0 || content.byteLength !== size ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        createHash('sha256').update(content).digest('hex') !== sha256 ||
        seenKeys.has(key) || seenNames.has(fileName)) {
      throw codedArtifactError('artifact_integrity_failed', 'captured action repair artifact is invalid')
    }
    seenKeys.add(key)
    seenNames.add(fileName)
    entries.push(Object.freeze({ key, fileName, content, size, sha256 }))
  }
  const capturedByName = new Map(entries.map((entry) => [entry.fileName, entry]))
  if (acceptance.artifacts.length !== entries.length - 1) {
    throw codedArtifactError('artifact_integrity_failed', 'captured action repair artifact count changed')
  }
  for (const recorded of acceptance.artifacts) {
    const captured = capturedByName.get(recorded.file_name)
    if (!captured || captured.key !== recorded.key || captured.size !== recorded.byte_length ||
        captured.sha256 !== recorded.sha256) {
      throw codedArtifactError('artifact_integrity_failed', 'captured action repair artifact manifest changed')
    }
  }
  const reviewEntry = capturedByName.get(FIXED_REGION_ACTION_REPAIR_REVIEW_FILE)
  const acceptanceEntry = capturedByName.get(FIXED_REGION_ACTION_REPAIR_MANAGED_FILES.action_repair_acceptance_manifest)
  if (!reviewEntry || !acceptanceEntry) {
    throw codedArtifactError('artifact_integrity_failed', 'captured action repair sealed evidence is missing')
  }
  const capturedReview = parseCapturedEvidence(entries, 'action_repair_review')
  const capturedAcceptance = parseCapturedEvidence(entries, 'action_repair_acceptance_manifest')
  if (!isDeepStrictEqual(capturedReview, review) || !isDeepStrictEqual(capturedAcceptance, acceptance)) {
    throw codedArtifactError('identity_mismatch', 'captured action repair sealed evidence changed')
  }
  const managedKeys = new Set(Object.keys(FIXED_REGION_ACTION_REPAIR_MANAGED_FILES))
  const presentManagedKeys = new Set(entries.filter((entry) => managedKeys.has(entry.key)).map((entry) => entry.key))
  const missing = FIXED_REGION_ACTION_REPAIR_REQUIRED_MANAGED_KEYS.filter((key) => !presentManagedKeys.has(key))
  if (missing.length) {
    throw codedArtifactError('artifact_integrity_failed', 'captured action repair managed artifacts are incomplete')
  }
  for (const entry of entries) {
    if (!managedKeys.has(entry.key)) continue
    if (FIXED_REGION_ACTION_REPAIR_MANAGED_FILES[entry.key] !== entry.fileName) {
      throw codedArtifactError('artifact_integrity_failed', 'captured action repair managed artifact target changed')
    }
  }
  const copyEntries = entries.map((entry) => {
    if (managedKeys.has(entry.key)) return entry
    return Object.freeze({
      ...entry,
      fileName: `${entry.key}${path.extname(entry.fileName)}`,
    })
  })
  return Object.freeze({
    entries: Object.freeze(entries),
    copyEntries: Object.freeze(copyEntries),
    review,
    acceptance,
  })
}

export async function importAcceptedFixedRegionActionRepairAsAsset({
  project,
  assetId,
  jobId,
  projectRoot = process.cwd(),
  workspaceRoot,
  verifiedReviewContract,
  verifiedAcceptanceManifest,
  verifiedArtifactManifest,
  now = new Date(),
} = {}) {
  const nextProject = clonePlain(project)
  const asset = nextProject.assets?.[assetId]
  if (!asset || asset.kind !== 'character_pack') {
    throw codedArtifactError('asset_not_found', 'character asset not found')
  }
  if (Object.values(asset.revisions ?? {}).some((revision) => revision.source_job_id === jobId)) {
    throw codedArtifactError('accept_conflict', 'action repair candidate was already accepted')
  }
  const snapshot = snapshotFixedRegionActionRepairManifest({
    manifest: verifiedArtifactManifest,
    verifiedReviewContract,
    verifiedAcceptanceManifest,
  })
  const parentRevision = asset.revisions?.[asset.active_revision_id]
  const identity = snapshot.acceptance.identity
  if (!parentRevision || snapshot.acceptance.job_id !== jobId ||
      identity.project_id !== nextProject.id || identity.asset_id !== asset.id ||
      identity.parent_revision_id !== parentRevision.id ||
      identity.source_job_id !== parentRevision.source_job_id ||
      snapshot.review.plan_hash !== snapshot.acceptance.review.plan_hash ||
      snapshot.review.references.manifest_sha256 !== snapshot.acceptance.review.reference_manifest_sha256) {
    throw codedArtifactError('asset_revision_conflict', 'action repair candidate parent identity changed')
  }
  const reserved = await reserveRevisionDirectory({
    project: nextProject,
    asset,
    projectRoot,
    workspaceRoot,
  })
  const { artifacts, resolvedEntries } = await copyVerifiedManifest({
    entries: snapshot.copyEntries,
    paths: reserved.paths,
  })
  let metadata
  try {
    metadata = await readImportMetadata('character_pack', resolvedEntries)
  } catch (error) {
    throw codedArtifactError('artifact_integrity_failed', 'accepted action repair metadata is invalid', error)
  }
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const revision = createAssetRevision({
    id: reserved.revisionId,
    sourceJobId: jobId,
    parentRevisionId: parentRevision.id,
    createdAt,
    qualityStatus: metadata.quality_status,
    productionStatus: metadata.quality_status === 'pass' ? 'ready' : 'review_required',
    artifacts,
    processingRecipeRef: null,
  })
  asset.active_revision_id = revision.id
  asset.revisions[revision.id] = revision
  asset.clips = metadata.clips
  return {
    project: nextProject,
    asset,
    revision,
    source_dir: reserved.paths.revisionDir,
  }
}

export async function importGeneratedJobAsAsset({
  project,
  kind,
  jobId,
  generatedDir,
  specializedContextGeneratedDir = null,
  projectRoot = process.cwd(),
  workspaceRoot,
  assetId,
  name,
  revisionId,
  now = new Date(),
  productionStatus = null,
  readyOverrideReason = null,
} = {}) {
  const spec = getEditorArtifactImportSpec(kind)
  if (!spec) throw new Error(`unsupported editor artifact import kind: ${kind}`)
  const sourceDir = resolveGeneratedJobDir(jobId, { generatedDir })
  await assertGeneralImportAllowed({ jobId, generatedDir })
  if (specializedContextGeneratedDir &&
      path.resolve(specializedContextGeneratedDir) !==
        path.resolve(generatedDir ?? path.join(projectRoot, 'generated'))) {
    await assertGeneralImportAllowed({ jobId, generatedDir: specializedContextGeneratedDir })
  }
  const knownEntries = await resolveKnownArtifactEntries({ spec, jobId, generatedDir })
  assertRequiredArtifacts(spec, knownEntries)

  const nextProject = clonePlain(project)
  const resolvedAssetId = sanitizeEditorId(assetId ?? `asset_${kind}_${jobId}`, `asset_${kind}`)
  const existingAsset = nextProject.assets?.[resolvedAssetId] ?? null
  if (existingAsset && existingAsset.kind !== kind) {
    throw new Error(`asset ${resolvedAssetId} already exists with kind ${existingAsset.kind}`)
  }
  const resolvedRevisionId = revisionId ?? nextRevisionId(existingAsset)
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const metadata = await readImportMetadata(kind, knownEntries)
  const previewEntries = kind === 'character_pack'
    ? await resolveExplicitCharacterPreviewEntries({ metadata, jobId, generatedDir })
    : []
  const qualityStatus = metadata.quality_status
  const resolvedProductionStatus = productionStatus ?? getDefaultProductionStatus(qualityStatus)
  const override = resolvedProductionStatus === 'ready' && qualityStatus !== 'pass'
    ? {
        reason: readyOverrideReason,
        created_at: createdAt,
      }
    : null
  if (override && !override.reason) throw new Error('ready override reason is required for warning, fail, or unknown assets')

  const artifacts = await copyArtifactFiles({
    projectId: nextProject.id,
    assetId: resolvedAssetId,
    revisionId: resolvedRevisionId,
    projectRoot,
    workspaceRoot,
    entries: [...knownEntries, ...previewEntries],
  })
  const revision = createAssetRevision({
    id: resolvedRevisionId,
    sourceJobId: jobId,
    parentRevisionId: existingAsset?.active_revision_id ?? null,
    createdAt,
    qualityStatus,
    productionStatus: resolvedProductionStatus,
    artifacts,
    override,
  })

  const asset = existingAsset
    ? {
        ...existingAsset,
        name: name ?? existingAsset.name,
        profile: existingAsset.profile ?? metadata.profile,
        active_revision_id: resolvedRevisionId,
        revisions: {
          ...existingAsset.revisions,
          [resolvedRevisionId]: revision,
        },
        clips: Object.keys(metadata.clips).length ? metadata.clips : existingAsset.clips,
      }
    : createAssetRef({
        id: resolvedAssetId,
        kind,
        name: name ?? metadata.name ?? resolvedAssetId,
        profile: metadata.profile,
        revision,
        provenance: metadata.provenance,
        clips: metadata.clips,
      })

  nextProject.assets = {
    ...(nextProject.assets ?? {}),
    [resolvedAssetId]: asset,
  }

  return {
    project: nextProject,
    asset,
    revision,
    source_dir: sourceDir,
  }
}
