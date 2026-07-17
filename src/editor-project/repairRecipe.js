import { CHARACTER_REPAIR_OUTPUT_FRAME_SIZES } from './constants.js'
import { createDefaultCharacterProcessingRecipe } from './recipes.js'
import { clonePlain, isPlainObject } from './safety.js'
import { validateCharacterWorkbenchRecipe } from './validation.js'

const NORMALIZED_SHEET_LAYOUT = 'topdown_rpg_v0'

const FORCED_STAGING_OFF = Object.freeze({
  enabled: false,
  mode: null,
  stage_size: null,
  crop_right: null,
  crop_bottom: null,
  matte_tolerance: null,
})

const EDITABLE_INHERIT_PATHS = Object.freeze([
  'background.mode',
  'background.tolerance',
  'cleanup.component_cleanup',
  'cleanup.min_alpha',
  'cleanup.min_area',
  'cleanup.min_area_ratio',
  'grid.manual_overrides',
  'anchor_offset.x',
  'anchor_offset.y',
  'frame_adjustments',
  'locked_animations',
  'correction.auto_correct',
  'correction.motion_stabilize',
  'correction.motion_max_shift',
  'pixel_finishing.enabled',
  'pixel_finishing.max_colors',
  'pixel_finishing.outline',
  'pixel_finishing.outline_mode',
  'style_report.max_colors',
])

const VISIBLE_REPAIR_PATHS = Object.freeze([
  'source.source_layout',
  'background.mode',
  'background.tolerance',
  'cleanup.component_cleanup',
  'cleanup.min_alpha',
  'cleanup.min_area',
  'cleanup.min_area_ratio',
  'fixed_region_staging',
  'grid.manual_overrides',
  'anchor_offset.x',
  'anchor_offset.y',
  'frame_adjustments',
  'locked_animations',
  'correction.auto_correct',
  'correction.motion_stabilize',
  'correction.motion_max_shift',
  'pixel_finishing.enabled',
  'pixel_finishing.max_colors',
  'pixel_finishing.outline',
  'pixel_finishing.outline_mode',
  'style_report.enabled',
  'style_report.max_colors',
  'outputs.frame_sizes',
])

const EDITABLE_REPAIR_PATH = /^(background\.(mode|tolerance)|cleanup\.(component_cleanup|min_alpha|min_area|min_area_ratio)|grid\.manual_overrides|anchor_offset\.(x|y)|frame_adjustments\.[0-9]+\.(dx|dy)|locked_animations|correction\.(auto_correct|motion_stabilize|motion_max_shift)|pixel_finishing\.(enabled|max_colors|outline|outline_mode)|style_report\.max_colors)$/

function hasOwnPath(value, pathValue) {
  let cursor = value
  for (const part of pathValue.split('.')) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, part)) return false
    cursor = cursor[part]
  }
  return true
}

function projectEditableRecipe(source) {
  const projected = {}
  for (const pathValue of EDITABLE_INHERIT_PATHS) {
    if (!hasOwnPath(source, pathValue)) continue
    const parts = pathValue.split('.')
    const value = parts.reduce((cursor, part) => cursor[part], source)
    let target = projected
    for (const part of parts.slice(0, -1)) target = target[part] ??= {}
    target[parts.at(-1)] = clonePlain(value)
  }
  return projected
}

function isValidPaletteBudget(value) {
  return Number.isInteger(value) && value >= 1 && value <= 256
}

function freezeClone(value) {
  const cloned = clonePlain(value)
  const visit = (item) => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item
    for (const child of Object.values(item)) visit(child)
    return Object.freeze(item)
  }
  return visit(cloned)
}

function setPlainPath(target, pathValue, value) {
  const parts = pathValue.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts.at(-1)] = clonePlain(value)
}

export function migrateCharacterProcessingRecipe(recipe) {
  const source = isPlainObject(recipe) ? clonePlain(recipe) : {}
  const diagnostics = []
  if (Array.isArray(source.outputs?.scales) && !Array.isArray(source.outputs?.frame_sizes)) {
    diagnostics.push('legacy_output_scales_migrated')
  }
  let inheritedPaths = EDITABLE_INHERIT_PATHS.filter((pathValue) => hasOwnPath(source, pathValue))
  const migrated = createDefaultCharacterProcessingRecipe({ createdFrom: projectEditableRecipe(source) })
  migrated.implementation_revision = null
  migrated.fixed_region_staging = clonePlain(FORCED_STAGING_OFF)

  const hasHistoricalStyleBudget = hasOwnPath(source, 'style_report.max_colors')
  const historicalStyleBudget = source.style_report?.max_colors
  if (hasHistoricalStyleBudget && !isValidPaletteBudget(historicalStyleBudget)) {
    inheritedPaths = inheritedPaths.filter((pathValue) => pathValue !== 'style_report.max_colors')
  }
  const inheritedStyleBudget = isValidPaletteBudget(historicalStyleBudget)
    ? historicalStyleBudget
    : migrated.pixel_finishing.max_colors
  let styleBudget = inheritedStyleBudget
  if (migrated.pixel_finishing.enabled === true) {
    styleBudget = migrated.pixel_finishing.max_colors
    if (hasHistoricalStyleBudget && historicalStyleBudget !== styleBudget) {
      diagnostics.push('style_report_budget_synced_to_pixel_finishing')
    }
  }
  migrated.style_report = { enabled: true, max_colors: styleBudget }
  migrated.outputs = { frame_sizes: [...CHARACTER_REPAIR_OUTPUT_FRAME_SIZES] }
  return { recipe: migrated, diagnostics, inheritedPaths }
}

export function createRepairRecipeDraft({ asset, revision, loadedRecipe, sourceContext }) {
  const migrated = migrateCharacterProcessingRecipe(loadedRecipe)
  const recipe = migrated.recipe
  const normalizedFallback = sourceContext.inputMode === 'normalized_sheet_fallback'
  recipe.source = {
    file_name: sourceContext.sourceFileName,
    source_layout: normalizedFallback ? NORMALIZED_SHEET_LAYOUT : sourceContext.sourceLayout,
    source_job_id: revision.source_job_id,
    asset_id: asset.id,
    black_matte_artifact_ref: sourceContext.blackMatteArtifactRef ?? null,
  }

  const inheritedManualGrid = clonePlain(recipe.grid.manual_overrides)
  const manualGridAvailable = sourceContext.inputMode === 'managed_source' &&
    sourceContext.sourceLayoutKind === 'uniform_grid'
  recipe.grid.manual_overrides = manualGridAvailable ? inheritedManualGrid : null
  if (normalizedFallback) migrated.diagnostics.push('normalized_sheet_fallback')
  if (inheritedManualGrid != null && !manualGridAvailable) {
    migrated.diagnostics.push('manual_grid_unavailable_for_fixed_regions')
  }
  if (recipe.background.mode === 'dual_matte' &&
      (sourceContext.inputMode !== 'managed_source' || !sourceContext.blackMatteArtifactRef)) {
    recipe.background.mode = 'auto'
    migrated.diagnostics.push('dual_matte_unavailable_for_input')
  }

  const inheritedPaths = new Set(migrated.inheritedPaths)
  const fieldOrigins = Object.fromEntries(
    VISIBLE_REPAIR_PATHS.map((path) => [path, inheritedPaths.has(path) ? 'inherited' : 'default']),
  )
  fieldOrigins['style_report.enabled'] = 'forced'
  fieldOrigins['outputs.frame_sizes'] = 'forced'
  fieldOrigins.fixed_region_staging = 'provenance'
  fieldOrigins['source.source_layout'] = 'provenance'
  if (recipe.pixel_finishing.enabled === true) fieldOrigins['style_report.max_colors'] = 'derived'

  const openingRecipe = freezeClone(recipe)
  return {
    recipe: clonePlain(openingRecipe),
    openingRecipe,
    fieldOrigins: freezeClone(fieldOrigins),
    provenance: freezeClone({ fixedRegionStaging: loadedRecipe?.fixed_region_staging ?? null }),
    diagnostics: [...migrated.diagnostics],
    dirty: false,
    hashStatus: 'pending',
    openingDraftSettingsHash: null,
    currentDraftSettingsHash: null,
  }
}

export function updateRepairRecipeDraft(draft, patch) {
  const patchKeys = isPlainObject(patch) ? Object.keys(patch).sort() : []
  if (patchKeys.join(',') !== 'path,value' || !EDITABLE_REPAIR_PATH.test(String(patch?.path ?? ''))) {
    throw new TypeError('repair patch path is not editable')
  }
  if (patch.path === 'style_report.max_colors' && draft.recipe?.pixel_finishing?.enabled === true) {
    throw new TypeError('style_report.max_colors is derived while Pixel Finishing is enabled')
  }

  const recipe = clonePlain(draft.recipe)
  const fieldOrigins = clonePlain(draft.fieldOrigins ?? {})
  const frameMatch = String(patch.path).match(/^frame_adjustments\.([0-9]+)\.(dx|dy)$/)
  if (frameMatch) {
    if (!isPlainObject(recipe.frame_adjustments)) recipe.frame_adjustments = {}
    if (!isPlainObject(recipe.frame_adjustments[frameMatch[1]])) {
      recipe.frame_adjustments[frameMatch[1]] = { dx: 0, dy: 0 }
    }
  }
  setPlainPath(recipe, patch.path, patch.value)
  if (recipe.pixel_finishing.enabled === true &&
      (patch.path === 'pixel_finishing.enabled' || patch.path === 'pixel_finishing.max_colors')) {
    recipe.style_report.max_colors = recipe.pixel_finishing.max_colors
    fieldOrigins['style_report.max_colors'] = 'derived'
  }
  if (patch.path === 'style_report.max_colors') fieldOrigins['style_report.max_colors'] = 'edited'
  recipe.implementation_revision = null
  return {
    ...draft,
    recipe,
    fieldOrigins: freezeClone(fieldOrigins),
    dirty: true,
    hashStatus: 'pending',
    currentDraftSettingsHash: null,
  }
}

export function applyRepairDraftSettingsHash(draft, hash, { initialize = false } = {}) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new TypeError('draft settings hash is invalid')
  }
  const openingDraftSettingsHash = initialize ? hash : draft.openingDraftSettingsHash
  if (!openingDraftSettingsHash) {
    throw new TypeError('opening draft settings hash is not initialized')
  }
  return {
    ...draft,
    openingDraftSettingsHash,
    currentDraftSettingsHash: hash,
    dirty: hash !== openingDraftSettingsHash,
    hashStatus: 'ready',
  }
}

export class RepairRecipeError extends Error {
  constructor(codes) {
    super(codes.join(','))
    this.name = 'RepairRecipeError'
    this.code = 'invalid_recipe'
    this.codes = [...codes]
  }
}

function canonicalGrid(value, { sourceSize, profile, inputMode, sourceLayoutKind }) {
  if (inputMode !== 'managed_source' || sourceLayoutKind !== 'uniform_grid') {
    if (value != null) throw new RepairRecipeError(['manual_grid_unavailable_for_fixed_regions'])
    return null
  }
  if (value == null) return null
  const axes = [
    ['columns', profile.grid.columns, sourceSize.width],
    ['rows', profile.grid.rows, sourceSize.height],
  ]
  for (const [key, count, end] of axes) {
    const points = value[key]
    if (!Array.isArray(points) || points.length !== count + 1 || points[0] !== 0 || points.at(-1) !== end) {
      throw new RepairRecipeError([`invalid_manual_${key}`])
    }
    if (!points.every(Number.isInteger) ||
        points.some((point, index) => index && point <= points[index - 1])) {
      throw new RepairRecipeError([`invalid_manual_${key}`])
    }
  }
  return { columns: [...value.columns], rows: [...value.rows] }
}

function canonicalFrameAdjustments(value, frameCount) {
  if (value != null && !isPlainObject(value)) {
    throw new RepairRecipeError(['invalid_frame_adjustments'])
  }
  const entries = []
  for (const [key, item] of Object.entries(value ?? {})) {
    if (!/^(0|[1-9][0-9]*)$/.test(key)) {
      throw new RepairRecipeError(['invalid_frame_adjustments'])
    }
    const frame = Number(key)
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount || !isPlainObject(item)) {
      throw new RepairRecipeError(['invalid_frame_adjustments'])
    }
    const keys = Object.keys(item).sort()
    if (keys.join(',') !== 'dx,dy' ||
        !Number.isInteger(item.dx) ||
        !Number.isInteger(item.dy) ||
        Math.abs(item.dx) > 16 ||
        Math.abs(item.dy) > 16) {
      throw new RepairRecipeError(['invalid_frame_adjustments'])
    }
    if (item.dx || item.dy) entries.push([String(frame), { dx: item.dx, dy: item.dy }])
  }
  return Object.fromEntries(entries.sort((left, right) => Number(left[0]) - Number(right[0])))
}

function throwStrictRecipeErrors(recipe) {
  const validation = validateCharacterWorkbenchRecipe(recipe)
  if (validation.status === 'fail') throw new RepairRecipeError(validation.blocking_errors)
}

export function canonicalizeRepairRecipe(recipe, context) {
  const next = clonePlain(recipe)
  throwStrictRecipeErrors(next)
  if (!isPlainObject(next.grid)) throw new RepairRecipeError(['invalid_recipe'])
  next.grid.manual_overrides = canonicalGrid(next.grid.manual_overrides, context)
  next.frame_adjustments = canonicalFrameAdjustments(
    next.frame_adjustments,
    context.profile.grid.columns * context.profile.grid.rows,
  )
  if (!Array.isArray(next.locked_animations)) {
    throwStrictRecipeErrors(next)
  }
  const requestedLocks = new Set(next.locked_animations)
  const orderedIds = context.profile.animations.map((animation) => animation.name)
  if ([...requestedLocks].some((id) => !orderedIds.includes(id))) {
    throw new RepairRecipeError(['unknown_locked_animation'])
  }
  next.locked_animations = orderedIds.filter((id) => requestedLocks.has(id))
  if (next.background?.mode === 'dual_matte' &&
      (context.inputMode !== 'managed_source' || !context.hasBlackMatte)) {
    throw new RepairRecipeError(['dual_matte_requires_managed_black_matte'])
  }
  throwStrictRecipeErrors(next)
  return next
}

export function withRepairImplementationRevision(canonicalDraftRecipe, implementationRevision) {
  if (canonicalDraftRecipe?.implementation_revision !== null) {
    throw new RepairRecipeError(['draft_implementation_revision_must_be_null'])
  }
  const next = clonePlain(canonicalDraftRecipe)
  next.implementation_revision = implementationRevision
  throwStrictRecipeErrors(next)
  return next
}

export function validateRepairRecipeDraft(draft, context) {
  try {
    return {
      status: 'pass',
      blocking_errors: [],
      canonical: canonicalizeRepairRecipe(draft.recipe, context),
    }
  } catch (error) {
    if (!(error instanceof RepairRecipeError)) throw error
    return { status: 'fail', blocking_errors: [...error.codes], canonical: null }
  }
}
