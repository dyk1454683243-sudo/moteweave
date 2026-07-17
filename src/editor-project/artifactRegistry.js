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
import { isDeepStrictEqual, TextDecoder } from 'node:util'
import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
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
import { FRAME_REPAIR_INTEGRITY_FILES } from './frameRepairArtifacts.js'
import { hashFrameRepairPlan } from './frameRepairPlan.js'
import { hashFrameRepairQualityGateValue } from './frameRepairQualityGatePlan.js'
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
  validateProcessingRecipe,
} from './validation.js'

export const QUALITY_GATE_CHARACTER_ARTIFACT_KEYS = Object.freeze([
  'sheet',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
])

const QUALITY_GATE_CHARACTER_ARTIFACT_FILES = Object.freeze({
  sheet: 'normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  processing_recipe: 'processing_recipe.json',
})
const QUALITY_GATE_SHEET_BYTES_LIMIT = 32 * 1024 * 1024
const QUALITY_GATE_JSON_BYTES_LIMIT = 4 * 1024 * 1024
const QUALITY_GATE_SHEET_SIZE = 768
const QUALITY_GATE_FRAME_SIZE = 96
const QUALITY_GATE_FRAME_COUNT = 64
const QUALITY_GATE_DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const QUALITY_GATE_FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

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

const CHARACTER_REPROCESS_ARTIFACT_FILES = Object.freeze({
  ...CHARACTER_ARTIFACT_FILES,
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  black_matte: 'input_black_matte.png',
  processing_recipe: 'processing_recipe.json',
  reprocess_context: 'editor_reprocess_context.json',
})

const CHARACTER_REPROCESS_REQUIRED_KEYS = Object.freeze([
  'source',
  'source_layout_overlay',
  'sheet',
  'debug_overlay',
  'onion_skin_overlay',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
  'multi_resolution',
  'sheet_96',
  'sheet_64',
  'sheet_48',
  'sheet_32',
  'sheet_16',
  'processing_recipe',
  'reprocess_context',
  'zip',
])

const SPECIALIZED_CONTEXT_FILES = Object.freeze([
  Object.freeze(['editor_reprocess_context.json', 'editor_character_reprocess']),
  Object.freeze(['editor_frame_repair_context.json', 'editor_character_frame_repair']),
])

const FRAME_REPAIR_MANAGED_COPY_KEYS = Object.freeze([
  'source',
  'source_layout_overlay',
  'sheet',
  'multi_resolution',
  'sheet_96',
  'sheet_64',
  'sheet_48',
  'sheet_32',
  'sheet_16',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
  'debug_overlay',
  'onion_skin_overlay',
  'inspection_index',
  'inspection_sheet',
  'godot_npc_zip',
  'rpgmaker_zip',
  'ocad_zip',
  'zip',
  'frame_repair_plan',
  'frame_repair_context',
  'frame_repair_mask',
  'normalized_candidate_frame',
  'composited_candidate_frame',
  'frame_repair_difference',
  'frame_repair_quality',
  'patched_normalized_sheet',
])

const QUALITY_GATE_KNOWN_CHARACTER_ARTIFACT_KEYS = new Set([
  ...Object.keys(CHARACTER_REPROCESS_ARTIFACT_FILES),
  ...FRAME_REPAIR_MANAGED_COPY_KEYS,
])
const QUALITY_GATE_CHARACTER_PREVIEW_ARTIFACT_KEY =
  /^(?:row_gif|inspection_gif|inspection_strip)_[a-z0-9][a-z0-9_-]*$/

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

function qualityGateArtifactError(message, cause = null) {
  return codedArtifactError('artifact_integrity_failed', message, cause)
}

function assertQualityGatePlainRecord(value, message) {
  const prototype = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.getPrototypeOf(value)
    : null
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (prototype !== Object.prototype && prototype !== null)) {
    throw qualityGateArtifactError(message)
  }
  return value
}

function assertQualityGateExactKeys(value, expectedKeys, message) {
  const record = assertQualityGatePlainRecord(value, message)
  const keys = Object.keys(record)
  if (keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(record, key))) {
    throw qualityGateArtifactError(message)
  }
  return record
}

function assertQualityGateSafeJson(value, label) {
  const queue = [{ value, depth: 0 }]
  let nodes = 0
  while (queue.length) {
    const current = queue.pop()
    nodes += 1
    if (nodes > 100_000 || current.depth > 64) {
      throw qualityGateArtifactError(`${label} JSON is too complex`)
    }
    if (current.value == null || ['string', 'boolean', 'number'].includes(typeof current.value)) {
      if (typeof current.value === 'number' && !Number.isFinite(current.value)) {
        throw qualityGateArtifactError(`${label} JSON contains an invalid number`)
      }
      continue
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) queue.push({ value: child, depth: current.depth + 1 })
      continue
    }
    const record = assertQualityGatePlainRecord(current.value, `${label} JSON is malformed`)
    for (const [key, child] of Object.entries(record)) {
      if (QUALITY_GATE_DANGEROUS_KEYS.has(key)) {
        throw qualityGateArtifactError(`${label} JSON contains an unsafe key`)
      }
      queue.push({ value: child, depth: current.depth + 1 })
    }
  }
  return value
}

function parseQualityGateJson(content, key) {
  let parsed
  try {
    parsed = JSON.parse(QUALITY_GATE_FATAL_UTF8_DECODER.decode(content))
  } catch (error) {
    throw qualityGateArtifactError(`${key} is malformed JSON`)
  }
  assertQualityGatePlainRecord(parsed, `${key} must contain one JSON object`)
  return assertQualityGateSafeJson(parsed, key)
}

function freezeQualityGateJson(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freezeQualityGateJson(child)
  }
  return Object.freeze(value)
}

function cloneQualityGateJson(value, label) {
  let cloned
  try {
    cloned = JSON.parse(JSON.stringify(value))
  } catch (error) {
    throw qualityGateArtifactError(`${label} is not canonical JSON`, error)
  }
  assertQualityGateSafeJson(cloned, label)
  return cloned
}

function qualityGateArtifactKeysForRevision(revision) {
  const artifacts = assertQualityGatePlainRecord(
    revision?.artifacts,
    'quality-gate revision artifact authority is malformed',
  )
  const recipeRef = revision.processing_recipe_ref ?? null
  const artifactRecipeRef = Object.hasOwn(artifacts, 'processing_recipe')
    ? artifacts.processing_recipe
    : null
  if ((recipeRef == null) !== (artifactRecipeRef == null) ||
      (recipeRef != null && (recipeRef !== artifactRecipeRef || !isSafeRelativePath(recipeRef)))) {
    throw qualityGateArtifactError('quality-gate processing Recipe authority is inconsistent')
  }
  const expectedKeys = [
    ...QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
    ...(recipeRef == null ? [] : ['processing_recipe']),
  ]
  if (expectedKeys.some((key) => !Object.hasOwn(artifacts, key))) {
    throw qualityGateArtifactError('quality-gate revision artifact authority is incomplete')
  }
  for (const [key, recorded] of Object.entries(artifacts)) {
    if (!QUALITY_GATE_KNOWN_CHARACTER_ARTIFACT_KEYS.has(key) &&
        !QUALITY_GATE_CHARACTER_PREVIEW_ARTIFACT_KEY.test(key)) {
      throw qualityGateArtifactError('quality-gate revision artifact authority contains an unsupported key')
    }
    if (!isSafeRelativePath(recorded)) {
      throw qualityGateArtifactError('quality-gate revision artifact path is unsafe')
    }
  }
  return expectedKeys
}

function assertQualityGateQualityAuthority({ asset, revision, metadata, debugReport }) {
  const expectedProduction = revision.quality_status === 'pass'
    ? 'ready'
    : revision.quality_status === 'warning'
      ? 'review_required'
      : null
  if (!expectedProduction || revision.production_status !== expectedProduction) {
    throw qualityGateArtifactError('quality-gate source quality is not eligible')
  }
  const expectedQuality = revision.quality_status
  const metadataQuality = metadata?.quality
  const validation = debugReport?.validation
  if (!isPlainObject(metadataQuality) || metadataQuality.status !== expectedQuality ||
      !Array.isArray(metadataQuality.blocking_errors) || metadataQuality.blocking_errors.length !== 0 ||
      !isPlainObject(validation) || validation.status !== expectedQuality ||
      !Array.isArray(validation.blocking_errors) || validation.blocking_errors.length !== 0) {
    throw qualityGateArtifactError('quality-gate Character validation state is inconsistent')
  }
  const hasTopLevelStatus = Object.hasOwn(debugReport, 'status')
  const hasTopLevelBlocking = Object.hasOwn(debugReport, 'blocking_errors')
  if ((hasTopLevelStatus || hasTopLevelBlocking) &&
      (!hasTopLevelStatus || !hasTopLevelBlocking || debugReport.status !== expectedQuality ||
       !Array.isArray(debugReport.blocking_errors) || debugReport.blocking_errors.length !== 0)) {
    throw qualityGateArtifactError('quality-gate Character validation state is inconsistent')
  }
  if (Object.hasOwn(debugReport, 'quality')) {
    const quality = debugReport.quality
    if (!isPlainObject(quality) || quality.status !== expectedQuality ||
        !Array.isArray(quality.blocking_errors) || quality.blocking_errors.length !== 0) {
      throw qualityGateArtifactError('quality-gate Character validation state is inconsistent')
    }
  }
  if (asset.revisions &&
      (asset.revisions[revision.id]?.quality_status !== revision.quality_status ||
       asset.revisions[revision.id]?.production_status !== revision.production_status)) {
    throw qualityGateArtifactError('quality-gate revision authority changed')
  }
}

function assertQualityGateDocumentAuthority({ asset, revision, documents }) {
  const { animations, metadata, editorMetadata, debugReport, recipe } = documents
  const profile = asset.profile
  if (profile !== TOPDOWN_RPG_V0.id ||
      animations.profile !== profile || metadata.profile !== profile ||
      editorMetadata.profile !== profile || debugReport.profile !== profile) {
    throw qualityGateArtifactError('quality-gate Character profile authority is inconsistent')
  }
  if (animations.version !== TOPDOWN_RPG_V0.version ||
      animations.sheet !== 'normalized_sheet.png' ||
      animations.frame_size?.w !== QUALITY_GATE_FRAME_SIZE ||
      animations.frame_size?.h !== QUALITY_GATE_FRAME_SIZE ||
      animations.sheet_size?.w !== QUALITY_GATE_SHEET_SIZE ||
      animations.sheet_size?.h !== QUALITY_GATE_SHEET_SIZE ||
      animations.anchor?.x !== TOPDOWN_RPG_V0.anchor.x ||
      animations.anchor?.y !== TOPDOWN_RPG_V0.anchor.y ||
      editorMetadata.version !== TOPDOWN_RPG_V0.version ||
      editorMetadata.sheet !== 'normalized_sheet.png' ||
      editorMetadata.frame_size?.w !== QUALITY_GATE_FRAME_SIZE ||
      editorMetadata.frame_size?.h !== QUALITY_GATE_FRAME_SIZE ||
      editorMetadata.sheet_size?.w !== QUALITY_GATE_SHEET_SIZE ||
      editorMetadata.sheet_size?.h !== QUALITY_GATE_SHEET_SIZE ||
      typeof metadata.name !== 'string' || !metadata.name.trim() || metadata.name.length > 160 ||
      (metadata.description != null &&
       (typeof metadata.description !== 'string' || metadata.description.length > 1_000)) ||
      !isPlainObject(animations.animations) || !Object.keys(animations.animations).length) {
    throw qualityGateArtifactError('quality-gate Character document geometry is inconsistent')
  }
  for (const [clipId, animation] of Object.entries(animations.animations)) {
    if (!isValidId(clipId) || !isPlainObject(animation) ||
        !Array.isArray(animation.frames) || !animation.frames.length ||
        animation.frames.length > QUALITY_GATE_FRAME_COUNT ||
        animation.frames.some((index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= QUALITY_GATE_FRAME_COUNT) ||
        typeof animation.fps !== 'number' || !Number.isFinite(animation.fps) ||
        animation.fps <= 0 || animation.fps > 120 ||
        typeof animation.loop !== 'boolean' ||
        !['loop', 'once', 'ping_pong'].includes(animation.mode)) {
      throw qualityGateArtifactError('quality-gate Character animation authority is invalid')
    }
  }
  const derivedClips = deriveCharacterClips(animations)
  const frameIndexes = Object.values(derivedClips).flatMap((clip) => clip.frames)
  if (!Object.keys(derivedClips).length ||
      frameIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= QUALITY_GATE_FRAME_COUNT) ||
      !isDeepStrictEqual(derivedClips, asset.clips)) {
    throw qualityGateArtifactError('quality-gate Character clip authority is inconsistent')
  }
  assertQualityGateQualityAuthority({ asset, revision, metadata, debugReport })
  if (revision.processing_recipe_ref == null) {
    if (recipe != null) throw qualityGateArtifactError('quality-gate processing Recipe is undeclared')
    return
  }
  const recipeValidation = validateProcessingRecipe(recipe)
  if (recipeValidation.blocking_errors.length || recipe.target_pipeline !== 'character_pack' ||
      recipe.source?.asset_id !== asset.id ||
      recipe.source?.source_job_id !== revision.source_job_id ||
      recipe.source?.source_layout !== profile) {
    throw qualityGateArtifactError('quality-gate processing Recipe authority is inconsistent')
  }
}

async function assertQualityGateSheet(content) {
  let metadata
  try {
    const image = sharp(content, { limitInputPixels: QUALITY_GATE_SHEET_SIZE * QUALITY_GATE_SHEET_SIZE })
    metadata = await image.metadata()
    if (metadata.format !== 'png' || metadata.width !== QUALITY_GATE_SHEET_SIZE ||
        metadata.height !== QUALITY_GATE_SHEET_SIZE || metadata.channels !== 4 ||
        metadata.hasAlpha !== true || (metadata.pages ?? 1) !== 1) {
      throw new Error('invalid PNG metadata')
    }
    const decoded = await image.raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== QUALITY_GATE_SHEET_SIZE ||
        decoded.info.height !== QUALITY_GATE_SHEET_SIZE || decoded.info.channels !== 4 ||
        decoded.data.length !== QUALITY_GATE_SHEET_SIZE * QUALITY_GATE_SHEET_SIZE * 4) {
      throw new Error('invalid PNG pixels')
    }
  } catch (error) {
    throw qualityGateArtifactError('quality-gate sheet must be one 768×768 RGBA PNG', error)
  }
  return metadata
}

function qualityGateCaptureProjection({ asset, revision, entries, sourceSha256 }) {
  const projectedAsset = freezeQualityGateJson({
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    profile: asset.profile,
    provenance: cloneQualityGateJson(asset.provenance, 'quality-gate provenance'),
    clips: cloneQualityGateJson(asset.clips, 'quality-gate clips'),
    tags: cloneQualityGateJson(asset.tags, 'quality-gate tags'),
  })
  const projectedRevision = Object.freeze({
    id: revision.id,
    source_job_id: revision.source_job_id,
    quality_status: revision.quality_status,
    production_status: revision.production_status,
    has_processing_recipe: revision.processing_recipe_ref != null,
  })
  return Object.freeze({
    asset: projectedAsset,
    revision: projectedRevision,
    artifacts: Object.freeze(entries),
    source_sha256: sourceSha256,
  })
}

async function verifyQualityGateCharacterSnapshot({ asset, revision, entries }) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  await assertQualityGateSheet(byKey.get('sheet').content)
  const documents = {
    animations: parseQualityGateJson(byKey.get('animations').content, 'animations'),
    metadata: parseQualityGateJson(byKey.get('metadata').content, 'metadata'),
    editorMetadata: parseQualityGateJson(byKey.get('editor_metadata').content, 'editor_metadata'),
    debugReport: parseQualityGateJson(byKey.get('debug_report').content, 'debug_report'),
    recipe: byKey.has('processing_recipe')
      ? parseQualityGateJson(byKey.get('processing_recipe').content, 'processing_recipe')
      : null,
  }
  assertQualityGateDocumentAuthority({ asset, revision, documents })
}

function snapshotQualityGateArtifactBuffers({ artifacts, expectedKeys, copyBuffers }) {
  assertQualityGateExactKeys(
    artifacts,
    expectedKeys,
    'quality-gate captured artifact bytes must contain only controlled keys',
  )
  const entries = []
  for (const key of expectedKeys) {
    const original = artifacts[key]
    const limit = key === 'sheet' ? QUALITY_GATE_SHEET_BYTES_LIMIT : QUALITY_GATE_JSON_BYTES_LIMIT
    if (!Buffer.isBuffer(original) || original.length <= 0 || original.length > limit) {
      throw qualityGateArtifactError(`quality-gate ${key} bytes are invalid`)
    }
    const content = copyBuffers ? Buffer.from(original) : original
    entries.push(Object.freeze({
      key,
      fileName: QUALITY_GATE_CHARACTER_ARTIFACT_FILES[key],
      content,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    }))
  }
  return entries
}

async function createVerifiedCharacterRevisionCapture({
  asset,
  revision,
  artifacts,
}, { copyBuffers }) {
  const assetSnapshot = cloneQualityGateJson(asset, 'quality-gate asset')
  const revisionSnapshot = cloneQualityGateJson(revision, 'quality-gate revision')
  assertQualityGateExactKeys(
    assetSnapshot,
    ['id', 'kind', 'name', 'profile', 'active_revision_id', 'revisions', 'provenance', 'clips', 'tags'],
    'quality-gate source asset authority is malformed',
  )
  assertQualityGateExactKeys(
    revisionSnapshot,
    [
      'id',
      'source_job_id',
      'parent_revision_id',
      'created_at',
      'quality_status',
      'production_status',
      'processing_recipe_ref',
      'artifacts',
    ],
    'quality-gate source revision authority is malformed',
  )
  if (assetSnapshot.kind !== 'character_pack' || !isValidId(assetSnapshot.id) ||
      assetSnapshot.active_revision_id !== revisionSnapshot.id ||
      !isDeepStrictEqual(assetSnapshot.revisions?.[revisionSnapshot.id], revisionSnapshot) ||
      !isValidJobId(revisionSnapshot.source_job_id) || revisionSnapshot.source_job_id == null ||
      validateAssetRef(assetSnapshot).blocking_errors.length) {
    throw qualityGateArtifactError('quality-gate source is not one valid active Character Pack revision')
  }
  const expectedKeys = qualityGateArtifactKeysForRevision(revisionSnapshot)
  const entries = snapshotQualityGateArtifactBuffers({ artifacts, expectedKeys, copyBuffers })
  await verifyQualityGateCharacterSnapshot({
    asset: assetSnapshot,
    revision: revisionSnapshot,
    entries,
  })
  const digestRecords = entries.map(({ key, size, sha256 }) => ({ key, size, sha256 }))
  const sourceSha256 = hashFrameRepairQualityGateValue(digestRecords)
  return qualityGateCaptureProjection({
    asset: assetSnapshot,
    revision: revisionSnapshot,
    entries,
    sourceSha256,
  })
}

export async function createVerifiedCharacterRevisionCaptureForQualityGate(input = {}) {
  return createVerifiedCharacterRevisionCapture(input, { copyBuffers: true })
}

function sameQualityGateFileIdentity(left, right, { includeTimes = false } = {}) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size &&
    (!includeTimes || (left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs))
}

function captureQualityGateManagedPathAuthority({ workspaceRoot, candidatePath }) {
  const lexicalWorkspaceRoot = path.resolve(workspaceRoot)
  const lexicalCandidate = path.resolve(candidatePath)
  const relative = path.relative(lexicalWorkspaceRoot, lexicalCandidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    throw qualityGateArtifactError('quality-gate managed artifact escapes its workspace')
  }
  const segments = relative.split(path.sep)
  if (relative.length > 4_096 || segments.length > 32 ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw qualityGateArtifactError('quality-gate managed artifact path is too complex')
  }
  let cursor = lexicalWorkspaceRoot
  const components = []
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      cursor = path.join(cursor, segment)
      const stat = lstatSync(cursor)
      const isLast = index === segments.length - 1
      if (stat.isSymbolicLink() || (!isLast && !stat.isDirectory()) ||
          (isLast && !stat.isFile())) {
        throw qualityGateArtifactError('quality-gate managed artifact path contains a symlink')
      }
      components.push(Object.freeze({
        lexicalPath: cursor,
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        isFile: isLast,
      }))
    }
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    throw qualityGateArtifactError('quality-gate managed artifact is unavailable')
  }
  return Object.freeze({
    components: Object.freeze(components),
    file: components.at(-1),
  })
}

function recheckQualityGateManagedPathAuthority(authority) {
  try {
    for (const expected of authority.components) {
      const actual = lstatSync(expected.lexicalPath)
      if (actual.isSymbolicLink() ||
          (expected.isFile ? !actual.isFile() : !actual.isDirectory()) ||
          !sameQualityGateFileIdentity(expected, actual, { includeTimes: expected.isFile })) {
        throw qualityGateArtifactError('quality-gate managed artifact identity changed')
      }
    }
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    throw qualityGateArtifactError('quality-gate managed artifact identity changed')
  }
}

function readQualityGateManagedFileSnapshot({ workspaceRoot, candidatePath, byteLimit }) {
  const authority = captureQualityGateManagedPathAuthority({ workspaceRoot, candidatePath })
  let fileDescriptor = null
  let failure = null
  let content = null
  try {
    if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
      throw qualityGateArtifactError('quality-gate no-follow file access is unavailable')
    }
    fileDescriptor = openSync(
      path.resolve(candidatePath),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    )
    const before = fstatSync(fileDescriptor)
    if (!before.isFile() || before.size <= 0 || before.size > byteLimit ||
        !sameQualityGateFileIdentity(authority.file, before, { includeTimes: true })) {
      throw qualityGateArtifactError('quality-gate managed artifact identity changed')
    }
    recheckQualityGateManagedPathAuthority(authority)
    content = Buffer.alloc(before.size)
    let offset = 0
    while (offset < before.size) {
      const bytesRead = readSync(
        fileDescriptor,
        content,
        offset,
        before.size - offset,
        offset,
      )
      if (bytesRead <= 0) {
        throw qualityGateArtifactError('quality-gate managed artifact read was incomplete')
      }
      offset += bytesRead
    }
    const after = fstatSync(fileDescriptor)
    if (!sameQualityGateFileIdentity(before, after, { includeTimes: true })) {
      throw qualityGateArtifactError('quality-gate managed artifact changed while being captured')
    }
    recheckQualityGateManagedPathAuthority(authority)
  } catch (error) {
    failure = error?.code === 'artifact_integrity_failed'
      ? error
      : qualityGateArtifactError('quality-gate managed artifact could not be captured')
  } finally {
    if (fileDescriptor != null) {
      try {
        closeSync(fileDescriptor)
      } catch {
        if (!failure) {
          failure = qualityGateArtifactError('quality-gate managed artifact could not be closed')
        }
      }
    }
  }
  if (failure) throw failure
  return Object.freeze({ content, authority })
}

export async function captureManagedCharacterRevisionForQualityGate({
  project,
  assetId,
  expectedAssetRevisionId,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  const projectSnapshot = cloneQualityGateJson(project, 'quality-gate source project')
  if (validateEditorProject(projectSnapshot).blocking_errors.length) {
    throw qualityGateArtifactError('quality-gate source project is invalid')
  }
  const asset = projectSnapshot.assets?.[assetId]
  if (!asset || asset.kind !== 'character_pack' ||
      asset.active_revision_id !== expectedAssetRevisionId ||
      !asset.revisions?.[expectedAssetRevisionId]) {
    throw codedArtifactError('asset_revision_conflict', 'quality-gate active Character revision changed')
  }
  const revision = asset.revisions[expectedAssetRevisionId]
  const expectedKeys = qualityGateArtifactKeysForRevision(revision)
  const configuredWorkspaceRoot = path.resolve(
    workspaceRoot ?? path.join(projectRoot, 'workspace'),
  )
  const artifacts = {}
  const authorities = []
  for (const key of expectedKeys) {
    const recorded = key === 'processing_recipe'
      ? revision.processing_recipe_ref
      : revision.artifacts[key]
    if (!isSafeRelativePath(recorded)) {
      throw qualityGateArtifactError('quality-gate managed artifact path is unsafe')
    }
    const lexicalPath = path.resolve(projectRoot, recorded)
    const limit = key === 'sheet' ? QUALITY_GATE_SHEET_BYTES_LIMIT : QUALITY_GATE_JSON_BYTES_LIMIT
    try {
      await resolveManagedRevisionArtifactFile({
        projectId: projectSnapshot.id,
        assetId,
        revision,
        artifactKey: key,
        projectRoot,
        workspaceRoot,
      })
    } catch {
      throw codedArtifactError('unsafe_artifact_path', 'quality-gate managed artifact containment failed')
    }
    const sealed = readQualityGateManagedFileSnapshot({
      workspaceRoot: configuredWorkspaceRoot,
      candidatePath: lexicalPath,
      byteLimit: limit,
    })
    artifacts[key] = sealed.content
    authorities.push(sealed.authority)
  }
  const captured = await createVerifiedCharacterRevisionCapture(
    { asset, revision, artifacts },
    { copyBuffers: false },
  )
  for (const authority of authorities) recheckQualityGateManagedPathAuthority(authority)
  return captured
}

async function snapshotVerifiedQualityGateCapture(captured) {
  const source = assertQualityGateExactKeys(
    captured,
    ['asset', 'revision', 'artifacts', 'source_sha256'],
    'quality-gate capture is malformed',
  )
  const asset = cloneQualityGateJson(source.asset, 'quality-gate captured asset')
  const revision = cloneQualityGateJson(source.revision, 'quality-gate captured revision')
  assertQualityGateExactKeys(
    asset,
    ['id', 'kind', 'name', 'profile', 'provenance', 'clips', 'tags'],
    'quality-gate captured asset is malformed',
  )
  assertQualityGateExactKeys(
    revision,
    ['id', 'source_job_id', 'quality_status', 'production_status', 'has_processing_recipe'],
    'quality-gate captured revision is malformed',
  )
  if (asset.kind !== 'character_pack' || !isValidId(asset.id) ||
      !isValidId(revision.id) || !isValidJobId(revision.source_job_id) ||
      revision.source_job_id == null || typeof asset.name !== 'string' || !asset.name.trim() ||
      typeof asset.profile !== 'string' || !asset.profile ||
      !isPlainObject(asset.provenance) || !isPlainObject(asset.clips) ||
      !Array.isArray(asset.tags) || typeof revision.has_processing_recipe !== 'boolean') {
    throw qualityGateArtifactError('quality-gate capture identity is invalid')
  }
  const expectedKeys = [
    ...QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
    ...(revision.has_processing_recipe ? ['processing_recipe'] : []),
  ]
  if (!Array.isArray(source.artifacts) || source.artifacts.length !== expectedKeys.length) {
    throw qualityGateArtifactError('quality-gate captured artifacts are incomplete')
  }
  const entries = []
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const original = assertQualityGateExactKeys(
      source.artifacts[index],
      ['key', 'fileName', 'content', 'size', 'sha256'],
      'quality-gate captured artifact entry is malformed',
    )
    const expectedKey = expectedKeys[index]
    const limit = expectedKey === 'sheet' ? QUALITY_GATE_SHEET_BYTES_LIMIT : QUALITY_GATE_JSON_BYTES_LIMIT
    if (original.key !== expectedKey ||
        original.fileName !== QUALITY_GATE_CHARACTER_ARTIFACT_FILES[expectedKey] ||
        !Buffer.isBuffer(original.content) || !Number.isSafeInteger(original.size) ||
        original.size <= 0 || original.size > limit || original.content.length !== original.size ||
        typeof original.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(original.sha256)) {
      throw qualityGateArtifactError('quality-gate captured artifact entry is invalid')
    }
    const content = Buffer.from(original.content)
    if (createHash('sha256').update(content).digest('hex') !== original.sha256) {
      throw qualityGateArtifactError('quality-gate captured artifact hash changed')
    }
    entries.push(Object.freeze({
      key: expectedKey,
      fileName: original.fileName,
      content,
      size: original.size,
      sha256: original.sha256,
    }))
  }
  const digestRecords = entries.map(({ key, size, sha256 }) => ({ key, size, sha256 }))
  const aggregate = hashFrameRepairQualityGateValue(digestRecords)
  if (typeof source.source_sha256 !== 'string' || source.source_sha256 !== aggregate) {
    throw qualityGateArtifactError('quality-gate capture aggregate hash changed')
  }
  const validationRevision = {
    id: revision.id,
    source_job_id: revision.source_job_id,
    quality_status: revision.quality_status,
    production_status: revision.production_status,
    processing_recipe_ref: revision.has_processing_recipe
      ? 'managed/processing_recipe.json'
      : null,
  }
  await verifyQualityGateCharacterSnapshot({ asset, revision: validationRevision, entries })
  return Object.freeze({
    asset: freezeQualityGateJson(asset),
    revision: Object.freeze(revision),
    artifacts: Object.freeze(entries),
    source_sha256: aggregate,
    digest_records: Object.freeze(digestRecords.map((entry) => Object.freeze(entry))),
  })
}

export async function importCapturedCharacterRevisionForQualityGate({
  project,
  targetAssetId,
  captured,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
} = {}) {
  const nextProject = cloneQualityGateJson(project, 'quality-gate target project')
  if (validateEditorProject(nextProject).blocking_errors.length) {
    throw qualityGateArtifactError('quality-gate target project is invalid')
  }
  if (!isValidId(targetAssetId) || sanitizeEditorId(targetAssetId, 'asset') !== targetAssetId) {
    throw codedArtifactError('unsafe_artifact_path', 'quality-gate target asset id is unsafe')
  }
  if (nextProject.assets?.[targetAssetId]) {
    throw codedArtifactError('asset_revision_conflict', 'quality-gate target asset already exists')
  }
  let createdAt
  try {
    createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  } catch (error) {
    throw qualityGateArtifactError('quality-gate target timestamp is invalid', error)
  }
  const snapshot = await snapshotVerifiedQualityGateCapture(captured)
  const targetAuthority = { id: targetAssetId, revisions: {} }
  const reserved = await reserveRevisionDirectory({
    project: nextProject,
    asset: targetAuthority,
    projectRoot,
    workspaceRoot,
    requiredRevisionId: 'rev_001',
  })
  const { artifacts } = await copyVerifiedManifest({
    entries: snapshot.artifacts,
    paths: reserved.paths,
  })
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: snapshot.revision.source_job_id,
    parentRevisionId: null,
    createdAt,
    qualityStatus: snapshot.revision.quality_status,
    productionStatus: snapshot.revision.production_status,
    artifacts,
    processingRecipeRef: snapshot.revision.has_processing_recipe
      ? artifacts.processing_recipe
      : null,
  })
  const asset = createAssetRef({
    id: targetAssetId,
    kind: 'character_pack',
    name: snapshot.asset.name,
    profile: snapshot.asset.profile,
    revision,
    provenance: snapshot.asset.provenance,
    clips: snapshot.asset.clips,
    tags: snapshot.asset.tags,
  })
  nextProject.assets = {
    ...(nextProject.assets ?? {}),
    [targetAssetId]: asset,
  }
  if (validateAssetRef(asset).blocking_errors.length ||
      validateEditorProject(nextProject).blocking_errors.length) {
    throw qualityGateArtifactError('quality-gate imported Character Pack is invalid')
  }
  const sourceManifest = Object.freeze({
    asset_id: snapshot.asset.id,
    revision_id: snapshot.revision.id,
    source_sha256: snapshot.source_sha256,
    artifacts: snapshot.digest_records,
  })
  const targetManifest = Object.freeze({
    asset_id: targetAssetId,
    revision_id: 'rev_001',
    source_sha256: snapshot.source_sha256,
    artifacts: snapshot.digest_records,
  })
  return {
    project: nextProject,
    asset,
    revision,
    mapping: Object.freeze({ source: sourceManifest, target: targetManifest }),
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

function snapshotVerifiedManifest({ manifest, verifiedRecipe, verifiedContext }) {
  if (!Array.isArray(manifest)) {
    throw codedArtifactError('artifact_integrity_failed', 'captured artifact manifest must be an array')
  }
  const entries = []
  const seenKeys = new Set()
  const seenFileNames = new Set()
  for (const originalEntry of manifest) {
    let key
    let rawContent
    let content
    let size
    let sha256
    try {
      key = originalEntry.key
      rawContent = originalEntry.content
      content = Buffer.isBuffer(rawContent) ? Buffer.from(rawContent) : null
      size = originalEntry.size
      sha256 = originalEntry.sha256
    } catch {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact entry is unreadable')
    }
    if (typeof key !== 'string' || !Object.hasOwn(CHARACTER_REPROCESS_ARTIFACT_FILES, key)) {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact key is invalid')
    }
    const fileName = CHARACTER_REPROCESS_ARTIFACT_FILES[key]
    if (seenKeys.has(key) || seenFileNames.has(fileName)) {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact target is duplicated')
    }
    if (!content || !Number.isSafeInteger(size) || size < 0 || content.byteLength !== size) {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact size mismatch')
    }
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact hash is invalid')
    }
    if (createHash('sha256').update(content).digest('hex') !== sha256) {
      throw codedArtifactError('artifact_integrity_failed', 'captured artifact hash mismatch')
    }
    seenKeys.add(key)
    seenFileNames.add(fileName)
    entries.push(Object.freeze({ key, fileName, content, size, sha256 }))
  }
  const missing = CHARACTER_REPROCESS_REQUIRED_KEYS.filter((key) => !seenKeys.has(key))
  if (missing.length) {
    throw codedArtifactError('artifact_integrity_failed', 'captured artifact manifest is incomplete')
  }

  const capturedRecipe = parseCapturedEvidence(entries, 'processing_recipe')
  const capturedContext = parseCapturedEvidence(entries, 'reprocess_context')
  const normalizedVerifiedRecipe = normalizeVerifiedEvidence(verifiedRecipe)
  const normalizedVerifiedContext = normalizeVerifiedEvidence(verifiedContext)
  if (
    !isDeepStrictEqual(capturedRecipe, normalizedVerifiedRecipe) ||
    !isDeepStrictEqual(capturedContext, normalizedVerifiedContext)
  ) {
    throw codedArtifactError('identity_mismatch', 'captured evidence does not match verified evidence')
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    recipe: capturedRecipe,
    context: capturedContext,
  })
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

function assertSpecializedIdentity({ project, asset, jobId, context, recipe, entries }) {
  if (
    context?.job_type !== 'editor_character_reprocess' ||
    context?.project_id !== project.id ||
    context?.asset_id !== asset.id
  ) {
    throw codedArtifactError('identity_mismatch', 'verified reprocess context identity changed')
  }
  if (
    asset.active_revision_id !== context.parent_revision_id ||
    jobId !== context.preview_job_id
  ) {
    throw codedArtifactError('asset_revision_conflict', 'accepted job identity changed')
  }
  const parentRevision = asset.revisions?.[asset.active_revision_id]
  if (!parentRevision) {
    throw codedArtifactError('asset_revision_conflict', 'active character revision no longer exists')
  }
  if (
    recipe?.source?.asset_id !== asset.id ||
    recipe?.source?.source_job_id !== parentRevision.source_job_id ||
    recipe?.source?.source_layout !== context.authoritative_source_layout
  ) {
    throw codedArtifactError('identity_mismatch', 'verified Recipe identity changed')
  }

  const parentBlackMatte = parentRevision.artifacts?.black_matte ?? null
  const recipeBlackMatte = recipe.source.black_matte_artifact_ref ?? null
  const manifestHasBlackMatte = entries.some((entry) => entry.key === 'black_matte')
  if (parentBlackMatte !== recipeBlackMatte) {
    throw codedArtifactError('identity_mismatch', 'verified black matte authority changed')
  }
  if (Boolean(parentBlackMatte) !== manifestHasBlackMatte) {
    throw codedArtifactError('artifact_integrity_failed', 'captured black matte does not match Recipe authority')
  }
  return parentRevision
}

export function getEditorArtifactImportSpec(kind) {
  return IMPORT_SPECS[kind] ?? null
}

export async function importAcceptedCharacterReprocessAsAsset({
  project,
  assetId,
  jobId,
  projectRoot = process.cwd(),
  workspaceRoot,
  verifiedContext,
  verifiedRecipe,
  verifiedArtifactManifest,
  now = new Date(),
}) {
  const nextProject = clonePlain(project)
  const asset = nextProject.assets?.[assetId]
  if (!asset || asset.kind !== 'character_pack') {
    throw codedArtifactError('asset_not_found', 'character asset not found')
  }
  const snapshot = snapshotVerifiedManifest({
    manifest: verifiedArtifactManifest,
    verifiedRecipe,
    verifiedContext,
  })
  assertSpecializedIdentity({
    project: nextProject,
    asset,
    jobId,
    context: snapshot.context,
    recipe: snapshot.recipe,
    entries: snapshot.entries,
  })

  const reserved = await reserveRevisionDirectory({
    project: nextProject,
    asset,
    projectRoot,
    workspaceRoot,
  })
  const { artifacts, resolvedEntries } = await copyVerifiedManifest({
    entries: snapshot.entries,
    paths: reserved.paths,
  })
  let metadata
  try {
    metadata = await readImportMetadata('character_pack', resolvedEntries)
  } catch (error) {
    throw codedArtifactError('artifact_integrity_failed', 'copied Character metadata is invalid', error)
  }
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const revision = createAssetRevision({
    id: reserved.revisionId,
    sourceJobId: jobId,
    parentRevisionId: asset.active_revision_id,
    createdAt,
    qualityStatus: metadata.quality_status,
    productionStatus: metadata.quality_status === 'pass' ? 'ready' : 'review_required',
    artifacts,
    processingRecipeRef: artifacts.processing_recipe,
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

function snapshotFrameRepairManifest({
  manifest,
  verifiedPlan,
  verifiedContext,
  verifiedQuality,
}) {
  const expected = Object.entries(FRAME_REPAIR_INTEGRITY_FILES)
  if (!Array.isArray(manifest) || manifest.length !== expected.length) {
    throw codedArtifactError('artifact_integrity_failed', 'captured Frame Repair manifest is incomplete')
  }
  const entries = []
  for (let index = 0; index < expected.length; index += 1) {
    const [expectedKey, expectedFileName] = expected[index]
    const original = manifest[index]
    let key
    let fileName
    let rawContent
    let size
    let sha256
    try {
      key = original.key
      fileName = original.file_name
      rawContent = original.content
      size = original.size
      sha256 = original.sha256
    } catch {
      throw codedArtifactError('artifact_integrity_failed', 'captured Frame Repair entry is unreadable')
    }
    const content = Buffer.isBuffer(rawContent) ? Buffer.from(rawContent) : null
    if (key !== expectedKey || fileName !== expectedFileName || !content ||
        !Number.isSafeInteger(size) || size <= 0 || content.length !== size ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        createHash('sha256').update(content).digest('hex') !== sha256) {
      throw codedArtifactError('artifact_integrity_failed', 'captured Frame Repair entry is invalid')
    }
    entries.push(Object.freeze({ key, fileName, content, size, sha256 }))
  }
  const plan = parseCapturedEvidence(entries, 'frame_repair_plan')
  const context = parseCapturedEvidence(entries, 'frame_repair_context')
  const quality = parseCapturedEvidence(entries, 'frame_repair_quality')
  const normalizedPlan = normalizeVerifiedEvidence(verifiedPlan)
  const normalizedContext = normalizeVerifiedEvidence(verifiedContext)
  const normalizedQuality = normalizeVerifiedEvidence(verifiedQuality)
  if (!isDeepStrictEqual(plan, normalizedPlan) ||
      !isDeepStrictEqual(context, normalizedContext) ||
      !isDeepStrictEqual(quality, normalizedQuality)) {
    throw codedArtifactError('identity_mismatch', 'captured Frame Repair evidence changed')
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    plan,
    context,
    quality,
    animations: parseCapturedEvidence(entries, 'animations'),
    metadata: parseCapturedEvidence(entries, 'metadata'),
  })
}

function assertFrameRepairSpecializedIdentity({ project, asset, jobId, snapshot }) {
  const { plan, context, quality, animations, metadata } = snapshot
  const parentRevision = asset.revisions?.[asset.active_revision_id]
  if (!parentRevision) {
    throw codedArtifactError('asset_revision_conflict', 'active character revision no longer exists')
  }
  if (context?.job_type !== 'editor_character_frame_repair' || context.job_id !== jobId ||
      context.project_id !== project.id || context.project_revision !== project.revision ||
      context.asset_id !== asset.id || context.parent_revision_id !== parentRevision.id ||
      context.parent_sheet_ref !== parentRevision.artifacts?.sheet ||
      context.parent_processing_recipe_ref !== (parentRevision.processing_recipe_ref ?? null) ||
      plan?.version !== 'frame_repair_plan_v1' || plan.project?.id !== project.id ||
      plan.project.revision !== project.revision || plan.asset?.id !== asset.id ||
      plan.asset.parent_revision_id !== parentRevision.id ||
      hashFrameRepairPlan(plan) !== context.plan_hash) {
    throw codedArtifactError('identity_mismatch', 'verified Frame Repair identity changed')
  }
  if (!['pass', 'warning'].includes(quality?.status) || quality.complete !== true ||
      quality.completeness?.complete !== true ||
      !Array.isArray(quality.completeness.missing) || quality.completeness.missing.length !== 0 ||
      animations?.profile !== plan.profile?.id || metadata?.profile !== plan.profile?.id ||
      typeof metadata.name !== 'string' || metadata.name.trim().length === 0) {
    throw codedArtifactError('artifact_integrity_failed', 'verified Frame Repair package metadata is invalid')
  }
  return parentRevision
}

export async function importAcceptedFrameRepairAsAsset({
  project,
  assetId,
  jobId,
  projectRoot = process.cwd(),
  workspaceRoot,
  verifiedPlan,
  verifiedContext,
  verifiedQuality,
  verifiedArtifactManifest,
  now = new Date(),
}) {
  const nextProject = clonePlain(project)
  const asset = nextProject.assets?.[assetId]
  if (!asset || asset.kind !== 'character_pack') {
    throw codedArtifactError('asset_not_found', 'character asset not found')
  }
  const snapshot = snapshotFrameRepairManifest({
    manifest: verifiedArtifactManifest,
    verifiedPlan,
    verifiedContext,
    verifiedQuality,
  })
  const parentRevision = assertFrameRepairSpecializedIdentity({
    project: nextProject,
    asset,
    jobId,
    snapshot,
  })
  const copiedKeys = new Set(FRAME_REPAIR_MANAGED_COPY_KEYS)
  const copyEntries = snapshot.entries.filter((entry) => copiedKeys.has(entry.key))
  if (copyEntries.length !== FRAME_REPAIR_MANAGED_COPY_KEYS.length) {
    throw codedArtifactError('artifact_integrity_failed', 'managed Frame Repair artifact set is incomplete')
  }
  const reserved = await reserveRevisionDirectory({
    project: nextProject,
    asset,
    projectRoot,
    workspaceRoot,
  })
  const { artifacts } = await copyVerifiedManifest({
    entries: copyEntries,
    paths: reserved.paths,
  })
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const revision = createAssetRevision({
    id: reserved.revisionId,
    sourceJobId: jobId,
    parentRevisionId: parentRevision.id,
    createdAt,
    qualityStatus: snapshot.quality.status,
    productionStatus: snapshot.quality.status === 'pass' ? 'ready' : 'review_required',
    artifacts,
    processingRecipeRef: null,
  })
  asset.active_revision_id = revision.id
  asset.revisions[revision.id] = revision
  asset.clips = deriveCharacterClips(snapshot.animations)
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
