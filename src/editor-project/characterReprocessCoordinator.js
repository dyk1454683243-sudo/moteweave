import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { resolveSourceLayout } from '../character-pack/sourceLayouts.js'
import { importAcceptedCharacterReprocessAsAsset } from './artifactRegistry.js'
import {
  CHARACTER_REPROCESS_INTEGRITY_FILES,
  CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
} from './characterReprocessService.js'
import { IMPLEMENTATION_REVISION_PATTERN } from './constants.js'
import {
  resolveGeneratedJobArtifactFile,
  resolveManagedRevisionArtifactFile,
} from './paths.js'
import {
  EditorProjectStoreError,
  loadEditorProject,
  mutateEditorProject,
} from './projectStore.js'
import {
  canonicalizeRepairRecipe,
  createRepairRecipeDraft,
  validateRepairRecipeDraft,
  withRepairImplementationRevision,
} from './repairRecipe.js'
import { hashRepairRecipe } from './repairRecipeHash.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from './repairRecipeSerialization.js'
import { recipeToCharacterProcessingOptions } from './recipes.js'
import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isIsoTimestamp,
  isPlainObject,
  isSafeRelativePath,
  isValidId,
  isValidJobId,
} from './safety.js'
import {
  validateCharacterWorkbenchRecipe,
  validateProcessingRecipe,
} from './validation.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const SAFE_GENERATION_FIELDS = Object.freeze({
  scalar: Object.freeze(['mode', 'provider', 'provider_preset_id', 'provider_label', 'model']),
  image_config: Object.freeze(['image_size', 'aspect_ratio']),
  files: Object.freeze(['template_file', 'reference_file', 'palette_file']),
  prompt_contract: Object.freeze(['contract_version', 'layout_id', 'profile', 'profile_id', 'mode']),
})

export class CharacterReprocessError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CharacterReprocessError'
    this.code = code
    this.details = details
  }
}

export function assertExactKeys(value, allowed, code) {
  if (!isPlainObject(value)) {
    throw new CharacterReprocessError(code, 'expected a plain JSON object')
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) {
    throw new CharacterReprocessError(
      'unexpected_request_field',
      'request contains unsupported fields',
      { fields: unexpected },
    )
  }
  return value
}

export function assertRepairRecipeExactKeys(recipe) {
  assertExactKeys(recipe, [
    'version',
    'target_pipeline',
    'pipeline_contract',
    'implementation_revision',
    'source',
    'background',
    'cleanup',
    'fixed_region_staging',
    'grid',
    'anchor_offset',
    'frame_adjustments',
    'locked_animations',
    'correction',
    'pixel_finishing',
    'style_report',
    'outputs',
  ], 'invalid_recipe')
  assertExactKeys(recipe.source, [
    'file_name',
    'source_layout',
    'source_job_id',
    'asset_id',
    'black_matte_artifact_ref',
  ], 'invalid_recipe')
  assertExactKeys(recipe.background, ['mode', 'tolerance'], 'invalid_recipe')
  assertExactKeys(recipe.cleanup, ['component_cleanup', 'min_alpha', 'min_area', 'min_area_ratio'], 'invalid_recipe')
  assertExactKeys(recipe.fixed_region_staging, [
    'enabled',
    'mode',
    'stage_size',
    'crop_right',
    'crop_bottom',
    'matte_tolerance',
  ], 'invalid_recipe')
  assertExactKeys(recipe.grid, ['manual_overrides'], 'invalid_recipe')
  assertExactKeys(recipe.anchor_offset, ['x', 'y'], 'invalid_recipe')
  assertExactKeys(recipe.frame_adjustments, Object.keys(recipe.frame_adjustments ?? {}), 'invalid_recipe')
  for (const item of Object.values(recipe.frame_adjustments)) {
    assertExactKeys(item, ['dx', 'dy'], 'invalid_recipe')
  }
  if (recipe.grid.manual_overrides != null) {
    assertExactKeys(recipe.grid.manual_overrides, ['columns', 'rows'], 'invalid_recipe')
  }
  if (!Array.isArray(recipe.locked_animations)) {
    throw new CharacterReprocessError('invalid_recipe', 'locked_animations must be an array')
  }
  assertExactKeys(recipe.correction, ['auto_correct', 'motion_stabilize', 'motion_max_shift'], 'invalid_recipe')
  assertExactKeys(recipe.pixel_finishing, ['enabled', 'max_colors', 'outline', 'outline_mode'], 'invalid_recipe')
  assertExactKeys(recipe.style_report, ['enabled', 'max_colors'], 'invalid_recipe')
  assertExactKeys(recipe.outputs, ['frame_sizes'], 'invalid_recipe')
  return recipe
}

export function assertPreviewRequest(body) {
  assertExactKeys(body, ['expectedRevision', 'expectedAssetRevisionId', 'recipe'], 'invalid_reprocess_request')
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new CharacterReprocessError('invalid_reprocess_request', 'expectedRevision must be a non-negative integer')
  }
  if (!isValidId(body.expectedAssetRevisionId)) {
    throw new CharacterReprocessError('invalid_reprocess_request', 'expectedAssetRevisionId is invalid')
  }
  if (findBase64PayloadPaths(body).length || findSecretLikePaths(body).length) {
    throw new CharacterReprocessError(
      'invalid_reprocess_request',
      'embedded binary or secret-like fields are forbidden',
    )
  }
  assertRepairRecipeExactKeys(body.recipe)
  if (body.recipe.implementation_revision !== null) {
    throw new CharacterReprocessError('invalid_recipe', 'implementation_revision must be null')
  }
  return clonePlain(body)
}

export function assertAcceptRequest(body) {
  assertExactKeys(body, [
    'expectedRevision',
    'expectedAssetRevisionId',
    'expectedRecipeHash',
    'warningConfirmed',
  ], 'invalid_accept_request')
  if (
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    !isValidId(body.expectedAssetRevisionId) ||
    typeof body.expectedRecipeHash !== 'string' ||
    !SHA256_PATTERN.test(body.expectedRecipeHash) ||
    typeof body.warningConfirmed !== 'boolean'
  ) {
    throw new CharacterReprocessError('invalid_accept_request', 'accept request fields are invalid')
  }
  return clonePlain(body)
}

function safeBasename(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('/') ||
    value.includes('\\') ||
    value !== path.posix.basename(value) ||
    !isSafeRelativePath(value) ||
    value === '.' ||
    value === '..'
  ) return null
  return value
}

function copyStringFields(source, keys, label) {
  const result = {}
  for (const key of keys) {
    if (source?.[key] == null) continue
    if (typeof source[key] !== 'string') {
      throw new CharacterReprocessError(
        'invalid_managed_metadata',
        `managed generation ${label}.${key} is invalid`,
      )
    }
    result[key] = source[key]
  }
  return result
}

export function sanitizeParentGeneration(metadata) {
  if (!isPlainObject(metadata) || findSecretLikePaths(metadata).length || findBase64PayloadPaths(metadata).length) {
    throw new CharacterReprocessError(
      'invalid_managed_metadata',
      'managed metadata is not a safe plain object',
    )
  }
  const source = metadata.generation == null ? {} : metadata.generation
  if (!isPlainObject(source)) {
    throw new CharacterReprocessError('invalid_managed_metadata', 'managed generation provenance is invalid')
  }
  for (const key of ['image_config', 'prompt_contract']) {
    if (source[key] != null && !isPlainObject(source[key])) {
      throw new CharacterReprocessError('invalid_managed_metadata', `managed generation ${key} is invalid`)
    }
  }
  const result = copyStringFields(source, SAFE_GENERATION_FIELDS.scalar, 'scalar')
  result.image_config = copyStringFields(
    source.image_config,
    SAFE_GENERATION_FIELDS.image_config,
    'image_config',
  )
  for (const key of SAFE_GENERATION_FIELDS.files) {
    if (source[key] == null) continue
    const file = safeBasename(source[key])
    if (!file) {
      throw new CharacterReprocessError('invalid_managed_metadata', `managed generation ${key} is invalid`)
    }
    result[key] = file
  }
  result.prompt_contract = copyStringFields(
    source.prompt_contract,
    SAFE_GENERATION_FIELDS.prompt_contract,
    'prompt_contract',
  )
  return result
}

function validInputArtifactRef(context) {
  if (!isSafeRelativePath(context.input_artifact_ref)) return false
  const parts = context.input_artifact_ref.replaceAll('\\', '/').split('/')
  const expected = [
    'projects',
    context.project_id,
    'assets',
    context.asset_id,
    context.parent_revision_id,
    context.input_artifact_key === 'source' ? 'source.png' : 'normalized_sheet.png',
  ]
  return parts.length >= expected.length &&
    expected.every((part, index) => parts[parts.length - expected.length + index] === part)
}

function isRegisteredLayout(value) {
  if (typeof value !== 'string') return false
  try {
    return resolveSourceLayout(value).id === value
  } catch {
    return false
  }
}

export function validateEditorReprocessContext(value) {
  const keys = [
    'version',
    'job_type',
    'preview_job_id',
    'submitted_at',
    'project_id',
    'project_revision',
    'asset_id',
    'parent_revision_id',
    'input_mode',
    'input_artifact_key',
    'input_artifact_ref',
    'input_artifact_sha256',
    'black_matte_artifact_sha256',
    'authoritative_source_layout',
    'recipe_hash',
    'draft_settings_hash',
    'implementation_revision',
  ]
  assertExactKeys(value, keys, 'invalid_reprocess_context')
  const expectedInputKey = value.input_mode === 'managed_source'
    ? 'source'
    : value.input_mode === 'normalized_sheet_fallback'
      ? 'sheet'
      : null
  if (
    value.version !== 'editor_reprocess_context_v0' ||
    value.job_type !== 'editor_character_reprocess' ||
    typeof value.preview_job_id !== 'string' ||
    !isValidJobId(value.preview_job_id) ||
    !isIsoTimestamp(value.submitted_at) ||
    !isValidId(value.project_id) ||
    !Number.isInteger(value.project_revision) ||
    value.project_revision < 0 ||
    !isValidId(value.asset_id) ||
    !isValidId(value.parent_revision_id) ||
    !expectedInputKey ||
    value.input_artifact_key !== expectedInputKey ||
    !validInputArtifactRef(value) ||
    typeof value.input_artifact_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.input_artifact_sha256) ||
    !(
      value.black_matte_artifact_sha256 === null ||
      (typeof value.black_matte_artifact_sha256 === 'string' && SHA256_PATTERN.test(value.black_matte_artifact_sha256))
    ) ||
    (value.input_mode === 'normalized_sheet_fallback' && value.black_matte_artifact_sha256 !== null) ||
    (
      value.input_mode === 'normalized_sheet_fallback' &&
      value.authoritative_source_layout !== TOPDOWN_RPG_V0.id
    ) ||
    !isRegisteredLayout(value.authoritative_source_layout) ||
    typeof value.recipe_hash !== 'string' ||
    !SHA256_PATTERN.test(value.recipe_hash) ||
    typeof value.draft_settings_hash !== 'string' ||
    !SHA256_PATTERN.test(value.draft_settings_hash) ||
    typeof value.implementation_revision !== 'string' ||
    !IMPLEMENTATION_REVISION_PATTERN.test(value.implementation_revision)
  ) {
    throw new CharacterReprocessError('invalid_reprocess_context', 'reprocess context failed validation')
  }
  return clonePlain(value)
}

const REPROCESS_CONTEXT_BASE_KEYS = Object.freeze([
  'version',
  'project_id',
  'project_revision',
  'asset_id',
  'parent_revision_id',
  'input_mode',
  'input_artifact_key',
  'input_artifact_ref',
  'input_artifact_sha256',
  'black_matte_artifact_sha256',
  'authoritative_source_layout',
  'recipe_hash',
  'draft_settings_hash',
  'implementation_revision',
])

export function validateEditorReprocessContextBase(value) {
  assertExactKeys(value, REPROCESS_CONTEXT_BASE_KEYS, 'invalid_reprocess_context')
  const full = {
    ...clonePlain(value),
    job_type: 'editor_character_reprocess',
    preview_job_id: 'validation_job',
    submitted_at: '2000-01-01T00:00:00.000Z',
  }
  validateEditorReprocessContext(full)
  return clonePlain(value)
}

export function resolveImplementationRevision({ env = process.env, packageVersion }) {
  const configuredKey = env.GAMETOOL_BUILD_REVISION != null
    ? 'GAMETOOL_BUILD_REVISION'
    : env.GIT_COMMIT_SHA != null
      ? 'GIT_COMMIT_SHA'
      : null
  if (!configuredKey && (typeof packageVersion !== 'string' || !packageVersion.trim())) {
    throw new CharacterReprocessError(
      'invalid_implementation_revision',
      'package version is invalid',
    )
  }
  const raw = configuredKey ? env[configuredKey] : `package-${packageVersion}`
  const value = String(raw).trim()
  if (!IMPLEMENTATION_REVISION_PATTERN.test(value)) {
    throw new CharacterReprocessError(
      'invalid_implementation_revision',
      `${configuredKey ?? 'package version'} is invalid`,
    )
  }
  return value
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function managedJsonError(artifactKey) {
  return new CharacterReprocessError(
    'invalid_managed_metadata',
    `${artifactKey} is not valid JSON`,
  )
}

async function readManagedJson({ project, asset, revision, artifactKey, paths }) {
  const filePath = await resolveManagedRevisionArtifactFile({
    projectId: project.id,
    assetId: asset.id,
    revision,
    artifactKey,
    ...paths,
  })
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new CharacterReprocessError('artifact_not_found', `${artifactKey} disappeared before capture`)
    }
    throw new CharacterReprocessError('unsafe_artifact_path', `${artifactKey} could not be safely captured`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw managedJsonError(artifactKey)
  }
}

async function loadOptionalManagedJson(input) {
  const recorded = input.artifactKey === 'processing_recipe'
    ? input.revision.processing_recipe_ref
    : input.revision.artifacts?.[input.artifactKey]
  if (!recorded) {
    return {
      present: false,
      value: undefined,
      diagnostic: `${input.artifactKey}_missing`,
    }
  }
  try {
    return {
      present: true,
      value: await readManagedJson(input),
      diagnostic: null,
    }
  } catch (error) {
    if (!['artifact_not_found', 'invalid_managed_metadata'].includes(error?.code)) throw error
    return {
      present: true,
      value: undefined,
      diagnostic: `${input.artifactKey}_${error.code}`,
    }
  }
}

function registeredLayoutCandidate(layoutId, { inputMode, profile }) {
  if (typeof layoutId !== 'string' || !layoutId) return null
  try {
    const layout = resolveSourceLayout(layoutId)
    if (layout.profile && layout.profile !== profile.id) return null
    if (inputMode === 'normalized_sheet_fallback' && layout.id !== TOPDOWN_RPG_V0.id) return null
    return layout
  } catch {
    return null
  }
}

function optionalRecipeExact(value) {
  try {
    assertRepairRecipeExactKeys(value)
    return true
  } catch {
    return false
  }
}

async function loadValidOptionalParentRecipe({
  project,
  asset,
  revision,
  paths,
  input,
  blackMatteRef,
}) {
  const loaded = await loadOptionalManagedJson({
    project,
    asset,
    revision,
    artifactKey: 'processing_recipe',
    paths,
  })
  if (!loaded.present) return { value: null, layout: null, diagnostic: loaded.diagnostic }
  if (loaded.value === undefined) return { value: null, layout: null, diagnostic: loaded.diagnostic }
  if (!isPlainObject(loaded.value)) {
    return { value: null, layout: null, diagnostic: 'processing_recipe_invalid' }
  }
  if (!optionalRecipeExact(loaded.value)) {
    return { value: null, layout: null, diagnostic: 'processing_recipe_exact_schema_invalid' }
  }
  if (findBase64PayloadPaths(loaded.value).length || findSecretLikePaths(loaded.value).length) {
    return { value: null, layout: null, diagnostic: 'processing_recipe_invalid' }
  }
  if (validateProcessingRecipe(loaded.value).status === 'fail') {
    return { value: null, layout: null, diagnostic: 'processing_recipe_invalid' }
  }
  if (validateCharacterWorkbenchRecipe(loaded.value).status === 'fail') {
    return { value: null, layout: null, diagnostic: 'processing_recipe_workbench_invalid' }
  }
  const layout = registeredLayoutCandidate(loaded.value.source?.source_layout, {
    inputMode: input.inputMode,
    profile: TOPDOWN_RPG_V0,
  })
  if (!layout) {
    return { value: null, layout: null, diagnostic: 'processing_recipe_layout_invalid' }
  }
  const sourceContext = {
    inputMode: input.inputMode,
    sourceLayout: layout.id,
    sourceLayoutKind: layout.kind,
    sourceFileName: path.posix.basename(input.artifactRef),
    sourceSize: input.sourceSize,
    blackMatteArtifactRef: blackMatteRef,
  }
  const reboundDraft = createRepairRecipeDraft({
    asset,
    revision,
    loadedRecipe: loaded.value,
    sourceContext,
  })
  const strict = validateRepairRecipeDraft(reboundDraft, {
    profile: TOPDOWN_RPG_V0,
    sourceSize: input.sourceSize,
    inputMode: input.inputMode,
    sourceLayoutKind: layout.kind,
    hasBlackMatte: Boolean(blackMatteRef),
    implementationRevision: null,
  })
  if (strict.status === 'fail') {
    return { value: null, layout: null, diagnostic: 'processing_recipe_workbench_invalid' }
  }
  return { value: loaded.value, layout, diagnostic: null }
}

function assertRequiredManagedDocuments(metadata, animations) {
  if (
    !isPlainObject(metadata) ||
    !isPlainObject(animations) ||
    findBase64PayloadPaths(metadata).length ||
    findSecretLikePaths(metadata).length ||
    findBase64PayloadPaths(animations).length ||
    findSecretLikePaths(animations).length ||
    typeof metadata.profile !== 'string' ||
    (metadata.description != null && typeof metadata.description !== 'string') ||
    (metadata.name != null && typeof metadata.name !== 'string') ||
    (metadata.generation != null && !isPlainObject(metadata.generation)) ||
    typeof animations.profile !== 'string' ||
    !isPlainObject(animations.animations) ||
    (animations.source_layout != null && !isPlainObject(animations.source_layout)) ||
    (animations.source_layout?.id != null && typeof animations.source_layout.id !== 'string')
  ) {
    throw new CharacterReprocessError(
      'invalid_managed_metadata',
      'managed Character metadata or animations are malformed',
    )
  }
}

function debugLayoutCandidate(value, authority) {
  if (!isPlainObject(value) || !isPlainObject(value.source_layout)) {
    return { layout: null, diagnostic: 'debug_report_layout_invalid' }
  }
  const layout = registeredLayoutCandidate(value.source_layout.id, authority)
  return layout
    ? { layout, diagnostic: null }
    : { layout: null, diagnostic: 'debug_report_layout_unregistered' }
}

async function resolveAuthoritativeLayout({
  project,
  asset,
  revision,
  paths,
  input,
  parentRecipeLoad,
  animations,
}) {
  const diagnostics = [parentRecipeLoad.diagnostic].filter(Boolean)
  if (input.inputMode === 'normalized_sheet_fallback') {
    return { layout: resolveSourceLayout(TOPDOWN_RPG_V0.id), diagnostics }
  }
  if (parentRecipeLoad.layout) return { layout: parentRecipeLoad.layout, diagnostics }

  const debugLoad = await loadOptionalManagedJson({
    project,
    asset,
    revision,
    artifactKey: 'debug_report',
    paths,
  })
  if (debugLoad.value !== undefined) {
    const debug = debugLayoutCandidate(debugLoad.value, {
      inputMode: input.inputMode,
      profile: TOPDOWN_RPG_V0,
    })
    if (debug.layout) return { layout: debug.layout, diagnostics }
    diagnostics.push(debug.diagnostic)
  } else if (debugLoad.diagnostic) {
    diagnostics.push(debugLoad.diagnostic)
  }

  const animationLayout = registeredLayoutCandidate(animations.source_layout?.id, {
    inputMode: input.inputMode,
    profile: TOPDOWN_RPG_V0,
  })
  if (animationLayout) return { layout: animationLayout, diagnostics }
  diagnostics.push('animations_layout_unregistered')
  throw new CharacterReprocessError(
    'missing_source_layout',
    'no registered compatible source-layout authority is available',
    { diagnostics },
  )
}

async function resolveManagedReprocessInput({ project, asset, revision, paths }) {
  let inputMode = 'managed_source'
  let artifactKey = 'source'
  if (!revision.artifacts?.source) {
    inputMode = 'normalized_sheet_fallback'
    artifactKey = 'sheet'
  }
  if (!revision.artifacts?.[artifactKey]) {
    throw new CharacterReprocessError('artifact_not_found', 'no managed reprocess input is available')
  }
  const filePath = await resolveManagedRevisionArtifactFile({
    projectId: project.id,
    assetId: asset.id,
    revision,
    artifactKey,
    ...paths,
  })
  let sourceBuffer
  try {
    sourceBuffer = await readFile(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new CharacterReprocessError('artifact_not_found', 'managed input disappeared before capture')
    }
    throw new CharacterReprocessError('unsafe_artifact_path', 'managed input could not be safely captured')
  }
  let image
  try {
    image = await sharp(sourceBuffer).metadata()
  } catch {
    throw new CharacterReprocessError('invalid_managed_source', 'managed input is not a supported image')
  }
  if (!image.width || !image.height) {
    throw new CharacterReprocessError('invalid_managed_source', 'managed input has no image dimensions')
  }
  return {
    inputMode,
    artifactKey,
    artifactRef: revision.artifacts[artifactKey],
    sourceBuffer,
    sha256: sha256(sourceBuffer),
    sourceSize: { width: image.width, height: image.height },
  }
}

async function resolveReprocessAuthority({ project, asset, revision, paths }) {
  if (asset.kind !== 'character_pack') {
    throw new CharacterReprocessError('asset_not_found', 'character asset not found')
  }
  if (asset.profile !== TOPDOWN_RPG_V0.id) {
    throw new CharacterReprocessError('unsupported_profile', 'Workbench v1 requires topdown_rpg_v0')
  }

  const input = await resolveManagedReprocessInput({ project, asset, revision, paths })
  const metadata = await readManagedJson({ project, asset, revision, artifactKey: 'metadata', paths })
  const animations = await readManagedJson({ project, asset, revision, artifactKey: 'animations', paths })
  assertRequiredManagedDocuments(metadata, animations)
  if (metadata.profile !== asset.profile || animations.profile !== asset.profile) {
    throw new CharacterReprocessError(
      'profile_conflict',
      'asset and managed metadata profiles disagree',
    )
  }
  const generation = sanitizeParentGeneration(metadata)

  let blackMatteRef = null
  let blackSourceBuffer = null
  const diagnostics = input.inputMode === 'normalized_sheet_fallback'
    ? ['normalized_sheet_fallback']
    : []
  if (input.inputMode === 'managed_source' && revision.artifacts?.black_matte) {
    blackMatteRef = revision.artifacts.black_matte
    const blackPath = await resolveManagedRevisionArtifactFile({
      projectId: project.id,
      assetId: asset.id,
      revision,
      artifactKey: 'black_matte',
      ...paths,
    })
    try {
      blackSourceBuffer = await readFile(blackPath)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new CharacterReprocessError('artifact_not_found', 'black matte disappeared before capture')
      }
      throw new CharacterReprocessError('unsafe_artifact_path', 'black matte could not be safely captured')
    }
  } else if (input.inputMode === 'normalized_sheet_fallback' && revision.artifacts?.black_matte) {
    diagnostics.push('black_matte_unavailable_for_normalized_sheet_fallback')
  }

  const parentRecipeLoad = await loadValidOptionalParentRecipe({
    project,
    asset,
    revision,
    paths,
    input,
    blackMatteRef,
  })
  const sourceLayoutResult = await resolveAuthoritativeLayout({
    project,
    asset,
    revision,
    paths,
    input,
    parentRecipeLoad,
    animations,
  })
  return {
    input,
    sourceLayout: sourceLayoutResult.layout,
    profile: TOPDOWN_RPG_V0,
    metadata,
    animations,
    blackMatteRef,
    blackSourceBuffer,
    blackMatteSha256: blackSourceBuffer ? sha256(blackSourceBuffer) : null,
    diagnostics: [...diagnostics, ...sourceLayoutResult.diagnostics],
    generation,
  }
}

function parseManifestJson(manifest, key) {
  const entry = manifest.find((item) => item.key === key)
  if (!entry) {
    throw new CharacterReprocessError('artifact_integrity_failed', `${key} is missing`)
  }
  try {
    const value = JSON.parse(entry.content.toString('utf8'))
    if (!isPlainObject(value)) throw new TypeError('not a plain object')
    return value
  } catch {
    throw new CharacterReprocessError(
      'artifact_integrity_failed',
      `${key} is not valid plain JSON`,
    )
  }
}

function exactManifestEntry(entry) {
  return isPlainObject(entry) &&
    Object.keys(entry).sort().join(',') === 'file_name,key,sha256,size'
}

async function buildVerifiedArtifactManifest(job, generatedDir) {
  if (!Array.isArray(job.artifact_integrity_manifest)) {
    throw new CharacterReprocessError(
      'artifact_integrity_failed',
      'sealed artifact manifest is missing',
    )
  }
  const sealed = new Map()
  for (const entry of job.artifact_integrity_manifest) {
    if (!exactManifestEntry(entry) || typeof entry.key !== 'string' || sealed.has(entry.key)) {
      throw new CharacterReprocessError(
        'artifact_integrity_failed',
        'sealed artifact manifest entry is invalid',
      )
    }
    sealed.set(entry.key, entry)
  }
  const hasBlackMatte = sealed.has('black_matte')
  const expectedFiles = hasBlackMatte
    ? {
        ...CHARACTER_REPROCESS_INTEGRITY_FILES,
        ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
      }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  if (
    sealed.size !== Object.keys(expectedFiles).length ||
    [...sealed.keys()].some((key) => !Object.hasOwn(expectedFiles, key))
  ) {
    throw new CharacterReprocessError(
      'artifact_integrity_failed',
      'sealed artifact manifest is incomplete',
    )
  }

  const allowedFiles = new Set(Object.values(expectedFiles))
  const manifest = []
  for (const [key, fileName] of Object.entries(expectedFiles)) {
    const expected = sealed.get(key)
    if (
      expected?.file_name !== fileName ||
      !Number.isSafeInteger(expected.size) ||
      expected.size < 0 ||
      typeof expected.sha256 !== 'string' ||
      !SHA256_PATTERN.test(expected.sha256)
    ) {
      throw new CharacterReprocessError(
        'artifact_integrity_failed',
        'sealed artifact entry is invalid',
      )
    }
    let sourcePath
    try {
      sourcePath = await resolveGeneratedJobArtifactFile({
        jobId: job.id,
        fileName,
        allowedFiles,
        generatedDir,
      })
    } catch (error) {
      if (error?.code === 'unsafe_artifact_path') throw error
      throw new CharacterReprocessError(
        'artifact_integrity_failed',
        `${fileName} is unavailable`,
      )
    }
    let content
    try {
      content = await readFile(sourcePath)
    } catch {
      throw new CharacterReprocessError(
        'artifact_integrity_failed',
        `${fileName} changed before capture`,
      )
    }
    const digest = sha256(content)
    if (content.byteLength !== expected.size || digest !== expected.sha256) {
      throw new CharacterReprocessError(
        'artifact_integrity_failed',
        `${fileName} changed after job completion`,
      )
    }
    manifest.push(Object.freeze({
      key,
      content,
      size: expected.size,
      sha256: expected.sha256,
    }))
  }
  return Object.freeze(manifest)
}

function validateDebugQualityReport(report) {
  const validation = report?.validation
  if (
    !isPlainObject(report) ||
    !isPlainObject(validation) ||
    !['pass', 'warning', 'fail', 'unknown'].includes(validation.status) ||
    !Array.isArray(validation.warnings) ||
    !validation.warnings.every((item) => typeof item === 'string') ||
    !Array.isArray(validation.blocking_errors) ||
    !validation.blocking_errors.every((item) => typeof item === 'string') ||
    (validation.status === 'pass' && validation.warnings.length > 0) ||
    (validation.status === 'pass' && validation.blocking_errors.length > 0) ||
    (validation.status === 'warning' && validation.blocking_errors.length > 0)
  ) {
    throw new CharacterReprocessError(
      'artifact_integrity_failed',
      'debug quality report is malformed',
    )
  }
  return validation.status
}

function sameCanonicalRecipeBytes(left, right) {
  return Buffer.compare(
    Buffer.from(serializeCanonicalRecipe(left)),
    Buffer.from(serializeCanonicalRecipe(right)),
  ) === 0
}

async function acceptVerifiedCharacterReprocess({
  projectId,
  assetId,
  jobId,
  body,
  projectRoot,
  workspaceRoot,
  generatedDir,
  reprocessService,
}) {
  assertAcceptRequest(body)
  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    throw new CharacterReprocessError('invalid_accept_request', 'accept job id is invalid')
  }
  if (!isValidId(projectId) || !isValidId(assetId)) {
    throw new CharacterReprocessError('invalid_accept_request', 'accept route identity is invalid')
  }

  let acceptedRevisionId = null
  const saved = await mutateEditorProject({
    projectId,
    expectedRevision: body.expectedRevision,
    projectRoot,
    workspaceRoot,
    mutate: async (project) => {
      const asset = project.assets?.[assetId]
      if (!asset || asset.kind !== 'character_pack') {
        throw new CharacterReprocessError('asset_not_found', 'character asset not found')
      }
      if (asset.active_revision_id !== body.expectedAssetRevisionId) {
        throw new CharacterReprocessError('asset_revision_conflict', 'active revision changed')
      }
      const parentRevision = asset.revisions?.[asset.active_revision_id]
      if (!parentRevision) {
        throw new CharacterReprocessError('revision_not_found', 'active character revision not found')
      }

      const job = reprocessService.getJob(jobId)
      if (
        !isPlainObject(job) ||
        job.id !== jobId ||
        job.type !== 'editor_character_reprocess'
      ) {
        throw new CharacterReprocessError('job_not_found', 'reprocess job not found')
      }
      if (job.status !== 'done') {
        throw new CharacterReprocessError(
          'quality_blocked',
          'only a completed pass or warning job can be accepted',
        )
      }
      if (
        job.project_id !== projectId ||
        job.asset_id !== assetId ||
        job.parent_revision_id !== asset.active_revision_id ||
        typeof job.recipe_hash !== 'string' ||
        !SHA256_PATTERN.test(job.recipe_hash) ||
        typeof job.draft_settings_hash !== 'string' ||
        !SHA256_PATTERN.test(job.draft_settings_hash) ||
        typeof job.implementation_revision !== 'string' ||
        !IMPLEMENTATION_REVISION_PATTERN.test(job.implementation_revision) ||
        !isIsoTimestamp(job.created_at)
      ) {
        throw new CharacterReprocessError(
          'identity_mismatch',
          'job identity does not match the active asset',
        )
      }

      const manifest = await buildVerifiedArtifactManifest(job, generatedDir)
      const recipe = parseManifestJson(manifest, 'processing_recipe')
      const context = parseManifestJson(manifest, 'reprocess_context')
      const report = parseManifestJson(manifest, 'debug_report')
      const metadata = parseManifestJson(manifest, 'metadata')
      const hasCapturedBlackMatte = manifest.some((entry) => entry.key === 'black_matte')
      const capturedBlackMatte = manifest.find((entry) => entry.key === 'black_matte') ?? null
      if (Boolean(recipe.source?.black_matte_artifact_ref) !== hasCapturedBlackMatte) {
        throw new CharacterReprocessError(
          'artifact_integrity_failed',
          'Recipe black matte authority does not match captured artifacts',
        )
      }

      validateEditorReprocessContext(context)
      if (
        (capturedBlackMatte && capturedBlackMatte.sha256 !== context.black_matte_artifact_sha256) ||
        (!capturedBlackMatte && context.black_matte_artifact_sha256 !== null)
      ) {
        throw new CharacterReprocessError(
          'artifact_integrity_failed',
          'captured black matte does not match context authority',
        )
      }
      assertRepairRecipeExactKeys(recipe)
      if (
        context.preview_job_id !== jobId ||
        context.submitted_at !== job.created_at ||
        context.project_id !== projectId ||
        context.project_revision !== project.revision ||
        context.asset_id !== assetId ||
        context.parent_revision_id !== asset.active_revision_id ||
        context.recipe_hash !== job.recipe_hash ||
        context.draft_settings_hash !== job.draft_settings_hash ||
        context.implementation_revision !== job.implementation_revision ||
        context.recipe_hash !== body.expectedRecipeHash
      ) {
        throw new CharacterReprocessError(
          'preview_stale',
          'job context no longer matches the project',
        )
      }
      if (
        !isIsoTimestamp(metadata.created_at) ||
        metadata.created_at !== job.created_at ||
        metadata.created_at !== context.submitted_at
      ) {
        throw new CharacterReprocessError(
          'artifact_integrity_failed',
          'metadata timestamp does not match job authority',
        )
      }

      const authority = await resolveReprocessAuthority({
        project,
        asset,
        revision: parentRevision,
        paths: { projectRoot, workspaceRoot },
      })
      let canonical
      try {
        canonical = canonicalizeRepairRecipe(recipe, {
          profile: authority.profile,
          sourceSize: authority.input.sourceSize,
          inputMode: authority.input.inputMode,
          sourceLayoutKind: authority.sourceLayout.kind,
          hasBlackMatte: Boolean(authority.blackSourceBuffer),
        })
      } catch (error) {
        throw new CharacterReprocessError(
          'noncanonical_recipe',
          'stored Recipe cannot be canonicalized',
          { cause_code: error?.code ?? null },
        )
      }
      if (
        canonical.implementation_revision !== context.implementation_revision ||
        context.input_mode !== authority.input.inputMode ||
        context.input_artifact_key !== authority.input.artifactKey ||
        context.input_artifact_ref !== authority.input.artifactRef ||
        context.input_artifact_sha256 !== authority.input.sha256 ||
        context.black_matte_artifact_sha256 !== authority.blackMatteSha256 ||
        context.authoritative_source_layout !== authority.sourceLayout.id ||
        canonical.source.asset_id !== asset.id ||
        canonical.source.source_job_id !== parentRevision.source_job_id ||
        canonical.source.source_layout !== authority.sourceLayout.id ||
        canonical.source.file_name !== path.posix.basename(authority.input.artifactRef) ||
        canonical.source.black_matte_artifact_ref !== authority.blackMatteRef
      ) {
        throw new CharacterReprocessError(
          'identity_mismatch',
          'stored input identity changed',
        )
      }
      if (!sameCanonicalRecipeBytes(recipe, canonical)) {
        throw new CharacterReprocessError('noncanonical_recipe', 'stored Recipe is not canonical')
      }
      const recipeHash = hashRepairRecipe(serializeCanonicalRecipe(canonical))
      const settingsHash = hashRepairRecipe(serializeCanonicalRecipe(
        createDraftSettingsHashInput(canonical),
      ))
      if (
        recipeHash !== context.recipe_hash ||
        settingsHash !== context.draft_settings_hash ||
        recipeHash !== body.expectedRecipeHash
      ) {
        throw new CharacterReprocessError(
          'artifact_integrity_failed',
          'Recipe hashes do not match',
        )
      }

      const quality = validateDebugQualityReport(report)
      if (quality === 'warning' && body.warningConfirmed !== true) {
        throw new CharacterReprocessError(
          'warning_confirmation_required',
          'warning confirmation is required',
        )
      }
      if (!['pass', 'warning'].includes(quality)) {
        throw new CharacterReprocessError(
          'quality_blocked',
          'quality does not allow acceptance',
        )
      }

      const imported = await importAcceptedCharacterReprocessAsAsset({
        project,
        assetId,
        jobId,
        projectRoot,
        workspaceRoot,
        verifiedContext: context,
        verifiedRecipe: canonical,
        verifiedArtifactManifest: manifest,
      })
      acceptedRevisionId = imported.revision.id
      return imported.project
    },
  })
  const asset = saved.project.assets[assetId]
  return {
    project: saved.project,
    asset,
    revision: asset.revisions[acceptedRevisionId],
    accepted: true,
  }
}

function assertCoordinatorDependencies({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  reprocessService,
}) {
  if (
    typeof projectRoot !== 'string' ||
    typeof workspaceRoot !== 'string' ||
    typeof generatedDir !== 'string' ||
    typeof implementationRevision !== 'string' ||
    !IMPLEMENTATION_REVISION_PATTERN.test(implementationRevision) ||
    !reprocessService ||
    typeof reprocessService.enqueue !== 'function' ||
    typeof reprocessService.getJob !== 'function'
  ) {
    throw new TypeError('character reprocess coordinator dependencies are invalid')
  }
}

export function createCharacterReprocessCoordinator({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  reprocessService,
} = {}) {
  assertCoordinatorDependencies({
    projectRoot,
    workspaceRoot,
    generatedDir,
    implementationRevision,
    reprocessService,
  })
  const paths = { projectRoot, workspaceRoot }

  async function submitCharacterReprocessPreview({ projectId, assetId, body }) {
    assertPreviewRequest(body)
    const { project } = await loadEditorProject({ projectId, ...paths })
    if (project.revision !== body.expectedRevision) {
      throw new EditorProjectStoreError(
        'revision_conflict',
        'editor project revision conflict',
        {
          expected_revision: body.expectedRevision,
          current_revision: project.revision,
        },
      )
    }
    const asset = project.assets?.[assetId]
    if (!asset || asset.kind !== 'character_pack') {
      throw new CharacterReprocessError('asset_not_found', 'character asset not found')
    }
    if (typeof asset.name !== 'string' || !asset.name.trim()) {
      throw new CharacterReprocessError(
        'invalid_managed_metadata',
        'character asset name must be a non-empty string',
      )
    }
    if (asset.active_revision_id !== body.expectedAssetRevisionId) {
      throw new CharacterReprocessError('asset_revision_conflict', 'active asset revision changed')
    }
    const revision = asset.revisions?.[asset.active_revision_id]
    if (!revision) {
      throw new CharacterReprocessError('revision_not_found', 'active character revision not found')
    }

    const authority = await resolveReprocessAuthority({ project, asset, revision, paths })
    const expectedSource = {
      asset_id: asset.id,
      source_job_id: revision.source_job_id,
      source_layout: authority.sourceLayout.id,
      file_name: path.posix.basename(authority.input.artifactRef),
      black_matte_artifact_ref: authority.blackMatteRef,
    }
    for (const [key, expected] of Object.entries(expectedSource)) {
      if (body.recipe.source[key] !== expected) {
        throw new CharacterReprocessError('identity_mismatch', `Recipe source.${key} changed`)
      }
    }

    const canonicalDraftRecipe = canonicalizeRepairRecipe(body.recipe, {
      profile: authority.profile,
      sourceSize: authority.input.sourceSize,
      inputMode: authority.input.inputMode,
      sourceLayoutKind: authority.sourceLayout.kind,
      hasBlackMatte: Boolean(authority.blackSourceBuffer),
    })
    if (canonicalDraftRecipe.implementation_revision !== null) {
      throw new CharacterReprocessError(
        'invalid_recipe',
        'Preview draft implementation_revision must be null',
      )
    }
    const canonicalRecipe = withRepairImplementationRevision(
      canonicalDraftRecipe,
      implementationRevision,
    )
    const recipeHash = hashRepairRecipe(serializeCanonicalRecipe(canonicalRecipe))
    const draftSettingsHash = hashRepairRecipe(serializeCanonicalRecipe(
      createDraftSettingsHashInput(canonicalRecipe),
    ))
    const processOptions = {
      ...recipeToCharacterProcessingOptions(canonicalRecipe, {
        blackSourceBuffer: authority.blackSourceBuffer,
      }),
      name: asset.name,
      description: authority.metadata.description ?? '',
      profile: authority.profile,
      sourceFileName: path.posix.basename(authority.input.artifactRef),
      source: {
        type: 'derived_revision',
        file_name: path.posix.basename(authority.input.artifactRef),
        parent_project_id: project.id,
        parent_asset_id: asset.id,
        parent_revision_id: revision.id,
        parent_job_id: revision.source_job_id,
      },
      generation: authority.generation,
    }
    const reprocessContextBase = validateEditorReprocessContextBase({
      version: 'editor_reprocess_context_v0',
      project_id: project.id,
      project_revision: project.revision,
      asset_id: asset.id,
      parent_revision_id: revision.id,
      input_mode: authority.input.inputMode,
      input_artifact_key: authority.input.artifactKey,
      input_artifact_ref: authority.input.artifactRef,
      input_artifact_sha256: authority.input.sha256,
      black_matte_artifact_sha256: authority.blackMatteSha256,
      authoritative_source_layout: authority.sourceLayout.id,
      recipe_hash: recipeHash,
      draft_settings_hash: draftSettingsHash,
      implementation_revision: implementationRevision,
    })
    const job = reprocessService.enqueue({
      sourceBuffer: authority.input.sourceBuffer,
      blackSourceBuffer: authority.blackSourceBuffer,
      processOptions,
      canonicalRecipe,
      reprocessContextBase,
    })
    if (!isPlainObject(job) || typeof job.id !== 'string' || !isValidJobId(job.id)) {
      throw new CharacterReprocessError('invalid_reprocess_request', 'reprocess service returned an invalid job')
    }
    return {
      ...clonePlain(job),
      recipe_hash: recipeHash,
      draft_settings_hash: draftSettingsHash,
      canonical_recipe: canonicalRecipe,
      diagnostics: [...authority.diagnostics],
    }
  }

  async function acceptCharacterReprocessPreview(request) {
    return acceptVerifiedCharacterReprocess({
      ...request,
      projectRoot,
      workspaceRoot,
      generatedDir,
      reprocessService,
    })
  }

  return Object.freeze({
    submitCharacterReprocessPreview,
    acceptCharacterReprocessPreview,
  })
}
