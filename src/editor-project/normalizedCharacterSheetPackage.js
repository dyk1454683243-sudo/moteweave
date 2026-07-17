import sharp from 'sharp'

import {
  renderDebugOverlayPng,
  renderOnionSkinOverlayPng,
  renderSourceLayoutOverlayPng,
} from '../character-pack/debugOverlay.js'
import { encodeGifFromRgbaFrames } from '../character-pack/gifExport.js'
import { loadRgba } from '../character-pack/imageCodec.js'
import { buildInspectionPreviewArtifacts } from '../character-pack/inspectionPreview.js'
import { buildMultiResolutionArtifacts } from '../character-pack/multiResolution.js'
import { detectAlphaBBox, detectFootAnchor } from '../character-pack/normalizer.js'
import {
  buildAnimationsJson,
  buildEditorMetadataJson,
  buildMetadataJson,
  buildPackageId,
} from '../character-pack/packageBuilder.js'
import { buildEngineExportArtifacts } from '../character-pack/processArtifacts.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { buildCharacterQualityClosure } from '../character-pack/qualityClosureGate.js'
import { buildRowPreviewIndex } from '../character-pack/rowPreview.js'
import { computeGridBoundaries, sliceRgbaCells } from '../character-pack/sheetSlicer.js'
import {
  getRuntimeAnimationSemantics,
  getSourceLayoutActions,
  resolveSourceLayout,
} from '../character-pack/sourceLayouts.js'
import { validateNormalizedFrames } from '../character-pack/validator.js'
import { buildCharacterPackZip } from '../character-pack/zipExport.js'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const MAX_MANAGED_NORMALIZED_PNG_BYTES = 16 * 1024 * 1024
const REGISTERED_SHEET_PIXEL_LIMIT = TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h
const GENERATION_KEYS = Object.freeze([
  'mode',
  'provider',
  'provider_preset_id',
  'provider_label',
  'model',
  'image_config',
])
const GENERATION_SCALAR_KEYS = Object.freeze([
  'provider',
  'provider_preset_id',
  'provider_label',
  'model',
])
const LINEAGE_KEYS = Object.freeze([
  'project_id',
  'asset_id',
  'parent_revision_id',
  'parent_job_id',
  'parent_processing_recipe_ref',
])
const PARENT_ANIMATION_KEYS = Object.freeze([
  'version',
  'profile',
  'source_layout',
  'sheet',
  'frame_size',
  'sheet_size',
  'anchor',
  'animations',
])
const PARENT_ANIMATION_REQUIRED_KEYS = Object.freeze([
  'version',
  'profile',
  'sheet',
  'frame_size',
  'sheet_size',
  'anchor',
  'animations',
])
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/
const SECRET_VALUE_PATTERN = /\b(Bearer\s+[A-Za-z0-9._~+/-]+|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/

function invalidManagedSource() {
  const error = new Error('managed normalized sheet package input is invalid')
  error.code = 'invalid_managed_source'
  return error
}

function failInvalidManagedSource() {
  throw invalidManagedSource()
}

function isExactPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    if (Object.keys(left).length !== Object.keys(right).length) return false
    for (let index = 0; index < left.length; index += 1) {
      const leftOwnsIndex = Object.hasOwn(left, index)
      const rightOwnsIndex = Object.hasOwn(right, index)
      if (leftOwnsIndex !== rightOwnsIndex) return false
      if (leftOwnsIndex && !sameJsonValue(left[index], right[index])) return false
    }
    return true
  }
  if (!isExactPlainObject(left) || !isExactPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function isPngBuffer(value) {
  return Buffer.isBuffer(value) &&
    value.length > PNG_SIGNATURE.length &&
    value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

function looksLikeBase64(value) {
  const compact = value.replaceAll(/\s/g, '')
  return compact.length >= 64 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
}

function isUnsafeManagedString(value) {
  const normalized = value.trim()
  return !normalized ||
    normalized !== value ||
    CONTROL_PATTERN.test(value) ||
    SECRET_VALUE_PATTERN.test(value) ||
    /^data:[^;]+;base64,/i.test(value) ||
    looksLikeBase64(value) ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    WINDOWS_ABSOLUTE_PATTERN.test(value) ||
    URL_SCHEME_PATTERN.test(value) ||
    value.split(/[\\/]/).includes('..')
}

function safeText(value, { required = false, maxLength = 500 } = {}) {
  if (value == null && !required) return null
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    CONTROL_PATTERN.test(value) ||
    SECRET_VALUE_PATTERN.test(value)
  ) {
    failInvalidManagedSource()
  }
  if (required && !value.trim()) failInvalidManagedSource()
  return value
}

function assertRegisteredProfile(profile) {
  if (!sameJsonValue(profile, TOPDOWN_RPG_V0)) failInvalidManagedSource()
  return profile
}

function registeredSourceLayoutSummary(sourceLayout, profile) {
  return {
    id: sourceLayout.id,
    kind: sourceLayout.kind,
    label: sourceLayout.label,
    target_profile: profile.id,
    actions: getSourceLayoutActions(sourceLayout),
  }
}

function sameAnimationSet(actual, expected) {
  if (!isExactPlainObject(actual) || !isExactPlainObject(expected)) return false
  const actualNames = Object.keys(actual)
  const expectedNames = Object.keys(expected)
  if (actualNames.length !== expectedNames.length ||
      expectedNames.some((name) => !Object.hasOwn(actual, name))) return false
  for (const name of expectedNames) {
    const actualClip = actual[name]
    const expectedClip = expected[name]
    if (!isExactPlainObject(actualClip) || !isExactPlainObject(expectedClip)) return false
    const actualKeys = Object.keys(actualClip)
    const expectedKeys = Object.keys(expectedClip)
    if (actualKeys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !Object.hasOwn(actualClip, key))) return false
    if (!Array.isArray(actualClip.frames) ||
        Object.keys(actualClip.frames).length !== actualClip.frames.length ||
        actualClip.frames.length !== expectedClip.frames.length) return false
    let previous = -1
    for (const frame of actualClip.frames) {
      if (!Number.isSafeInteger(frame) || frame < previous || !expectedClip.frames.includes(frame)) {
        return false
      }
      previous = frame
    }
    for (const key of expectedKeys) {
      if (key !== 'frames' && !sameJsonValue(actualClip[key], expectedClip[key])) return false
    }
  }
  return true
}

function assertParentAnimations(parentAnimations, profile) {
  if (
    !isExactPlainObject(parentAnimations) ||
    !hasOnlyKeys(parentAnimations, PARENT_ANIMATION_KEYS) ||
    !PARENT_ANIMATION_REQUIRED_KEYS.every((key) => Object.hasOwn(parentAnimations, key)) ||
    !isExactPlainObject(parentAnimations.animations) ||
    !isExactPlainObject(parentAnimations.anchor) ||
    !hasOnlyKeys(parentAnimations.anchor, ['x', 'y', 'mode']) ||
    !Object.hasOwn(parentAnimations.anchor, 'x') ||
    !Object.hasOwn(parentAnimations.anchor, 'y')
  ) {
    failInvalidManagedSource()
  }
  if (
    parentAnimations.version !== profile.version ||
    parentAnimations.profile !== profile.id ||
    parentAnimations.sheet !== 'normalized_sheet.png' ||
    !sameJsonValue(parentAnimations.frame_size, profile.frame) ||
    !sameJsonValue(parentAnimations.sheet_size, profile.sheet) ||
    parentAnimations.anchor.x !== profile.anchor.x ||
    parentAnimations.anchor.y !== profile.anchor.y ||
    (parentAnimations.anchor.mode != null && parentAnimations.anchor.mode !== profile.anchor.mode)
  ) {
    failInvalidManagedSource()
  }

  let parentSourceLayout
  let sourceLayoutSummary = null
  try {
    parentSourceLayout = resolveSourceLayout(parentAnimations.source_layout?.id ?? profile.id)
    if (Object.hasOwn(parentAnimations, 'source_layout')) {
      sourceLayoutSummary = registeredSourceLayoutSummary(parentSourceLayout, profile)
      if (!sameJsonValue(parentAnimations.source_layout, sourceLayoutSummary)) {
        failInvalidManagedSource()
      }
    }
  } catch (error) {
    if (error?.code === 'invalid_managed_source') throw error
    failInvalidManagedSource()
  }

  const expectedAnimations = buildAnimationsJson(profile, {
    ...(sourceLayoutSummary ? { sourceLayout: sourceLayoutSummary } : {}),
    animationSemantics: getRuntimeAnimationSemantics(parentSourceLayout, profile),
  }).animations
  if (!sameAnimationSet(parentAnimations.animations, expectedAnimations)) {
    failInvalidManagedSource()
  }
}

export function validateManagedParentAnimations(
  parentAnimations,
  profile = TOPDOWN_RPG_V0,
) {
  const managedProfile = assertRegisteredProfile(profile)
  assertParentAnimations(parentAnimations, managedProfile)
  return structuredClone(parentAnimations)
}

function hasAnimatedPngChunks(buffer) {
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    if (length > buffer.length - offset - 12) return false
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return true
    offset += length + 12
    if (type === 'IEND') return false
  }
  return false
}

async function assertManagedPngMetadata(buffer, profile) {
  const expectedPixels = profile.sheet.w * profile.sheet.h
  let metadata
  try {
    metadata = await sharp(buffer, {
      animated: true,
      limitInputPixels: REGISTERED_SHEET_PIXEL_LIMIT,
    }).metadata()
  } catch {
    failInvalidManagedSource()
  }
  const pages = metadata.pages ?? 1
  const pixels = metadata.width * metadata.height
  if (
    metadata.format !== 'png' ||
    pages !== 1 ||
    metadata.width !== profile.sheet.w ||
    metadata.height !== profile.sheet.h ||
    !Number.isSafeInteger(pixels) ||
    pixels !== expectedPixels ||
    pixels > REGISTERED_SHEET_PIXEL_LIMIT ||
    hasAnimatedPngChunks(buffer)
  ) {
    failInvalidManagedSource()
  }
}

function sanitizeLineage(lineage) {
  if (
    !isExactPlainObject(lineage) ||
    Object.keys(lineage).length !== LINEAGE_KEYS.length ||
    !hasOnlyKeys(lineage, LINEAGE_KEYS) ||
    !SAFE_ID_PATTERN.test(lineage.project_id) ||
    !SAFE_ID_PATTERN.test(lineage.asset_id) ||
    !SAFE_ID_PATTERN.test(lineage.parent_revision_id) ||
    !SAFE_JOB_ID_PATTERN.test(lineage.parent_job_id) ||
    (lineage.parent_processing_recipe_ref !== null &&
      (typeof lineage.parent_processing_recipe_ref !== 'string' ||
        lineage.parent_processing_recipe_ref.length > 1000 ||
        isUnsafeManagedString(lineage.parent_processing_recipe_ref) ||
        lineage.parent_processing_recipe_ref !==
          `workspace/projects/${lineage.project_id}/assets/${lineage.asset_id}/${lineage.parent_revision_id}/processing_recipe.json`))
  ) {
    failInvalidManagedSource()
  }
  return Object.fromEntries(LINEAGE_KEYS.map((key) => [key, lineage[key]]))
}

function sanitizeParentMetadata(parentMetadata, profile) {
  if (!isExactPlainObject(parentMetadata) || parentMetadata.profile !== profile.id) {
    failInvalidManagedSource()
  }
  return {
    name: safeText(parentMetadata.name, { required: true, maxLength: 160 }),
    description: safeText(parentMetadata.description, { maxLength: 1000 }) ?? '',
  }
}

export function sanitizeFrameRepairGeneration(generation) {
  if (
    !isExactPlainObject(generation) ||
    Object.keys(generation).length !== GENERATION_KEYS.length ||
    !hasOnlyKeys(generation, GENERATION_KEYS) ||
    !GENERATION_KEYS.every((key) => Object.hasOwn(generation, key)) ||
    generation.mode !== 'editor_targeted_frame_repair'
  ) {
    failInvalidManagedSource()
  }
  const safe = { mode: 'editor_targeted_frame_repair' }
  for (const key of GENERATION_SCALAR_KEYS) {
    if (typeof generation[key] !== 'string' || generation[key].length > 240 || isUnsafeManagedString(generation[key])) {
      failInvalidManagedSource()
    }
    safe[key] = generation[key]
  }
  const imageConfig = generation.image_config
  if (
    !isExactPlainObject(imageConfig) ||
    Object.keys(imageConfig).length !== 2 ||
    !hasOnlyKeys(imageConfig, ['image_size', 'aspect_ratio']) ||
    !Object.hasOwn(imageConfig, 'image_size') ||
    !Object.hasOwn(imageConfig, 'aspect_ratio') ||
    !['1K', '2K'].includes(imageConfig.image_size) ||
    typeof imageConfig.aspect_ratio !== 'string' ||
    imageConfig.aspect_ratio.length > 80 ||
    isUnsafeManagedString(imageConfig.aspect_ratio)
  ) {
    failInvalidManagedSource()
  }
  safe.image_config = {
    image_size: imageConfig.image_size,
    aspect_ratio: imageConfig.aspect_ratio,
  }
  return safe
}

function runtimeActionForFrame(index, profile) {
  return profile.animations.find((animation) => {
    const first = animation.row * profile.grid.columns + animation.startCol
    return index >= first && index < first + animation.count
  })?.name ?? null
}

function framesFromExactSheet(sheet, profile) {
  const grid = computeGridBoundaries({
    width: sheet.width,
    height: sheet.height,
    columns: profile.grid.columns,
    rows: profile.grid.rows,
  })
  return sliceRgbaCells(sheet, grid).map((cell, index) => {
    if (cell.image.width !== profile.frame.w || cell.image.height !== profile.frame.h) {
      failInvalidManagedSource()
    }
    const bbox = detectAlphaBBox(cell.image)
    const anchor = detectFootAnchor(cell.image, bbox)
    return {
      index,
      source_meta: {
        ...cell.meta,
        source_layout: profile.id,
        runtime_action: runtimeActionForFrame(index, profile),
      },
      source_bbox: bbox ? { ...bbox } : null,
      source_anchor: anchor ? { ...anchor } : null,
      normalized_bbox: bbox ? { ...bbox } : null,
      normalized_anchor: anchor ? { ...anchor } : null,
      image: cell.image,
      warnings: bbox ? [] : ['empty_frame'],
    }
  })
}

function skippedTransform() {
  return { applied: false, reason: 'already_normalized_input' }
}

function buildAlreadyNormalizedDebugReport({ profile, frames, validation, lineage, inspection }) {
  return {
    version: profile.version,
    profile: profile.id,
    source_layout: {
      id: profile.id,
      kind: 'uniform_grid',
      target_profile: profile.id,
    },
    lineage: { ...lineage },
    grid: {
      columns: profile.grid.columns,
      rows: profile.grid.rows,
      source_cell_size: { ...profile.frame },
      target_cell_size: { ...profile.frame },
      correction: skippedTransform(),
    },
    normalization: {
      mode: 'already_normalized',
      ...skippedTransform(),
      source_preparation: skippedTransform(),
      background_removal: skippedTransform(),
      grid_correction: skippedTransform(),
      cell_normalization: skippedTransform(),
      anchor_offset: skippedTransform(),
      auto_correction: skippedTransform(),
      motion_stabilization: skippedTransform(),
      manual_adjustments: skippedTransform(),
      pixel_finishing: skippedTransform(),
      palette_mutation: skippedTransform(),
      resizing: skippedTransform(),
      per_frame_nudge: skippedTransform(),
    },
    inspection_preview: structuredClone(inspection),
    validation,
    quality_closure: buildCharacterQualityClosure({ frames, profile, validation }),
    frames: frames.map((frame) => ({
      index: frame.index,
      runtime_action: frame.source_meta.runtime_action,
      source_bbox: frame.source_bbox ? { ...frame.source_bbox } : null,
      source_anchor: frame.source_anchor ? { ...frame.source_anchor } : null,
      normalized_bbox: frame.normalized_bbox ? { ...frame.normalized_bbox } : null,
      normalized_anchor: frame.normalized_anchor ? { ...frame.normalized_anchor } : null,
      warnings: [...frame.warnings],
    })),
  }
}

async function buildNormalizedPackageFiles({
  sheet,
  managedPng,
  profile,
  frames,
  animationsJson,
  metadataJson,
  editorMetadataJson,
  debugReport,
  safeGeneration,
  rowGifBuffers,
  inspection,
}) {
  const sourcePng = Buffer.from(managedPng)
  const normalizedSheetPng = Buffer.from(managedPng)
  const multiResolution = await buildMultiResolutionArtifacts({
    normalizedSheet: sheet,
    normalizedSheetPng,
    profile,
  })
  const sourceLayout = resolveSourceLayout(profile.id)
  const engine = await buildEngineExportArtifacts({
    metadataJson,
    frames,
    profile,
    normalizedSheetPng,
    sourcePng,
    sourceLayout,
  })
  const debugOverlayPng = await renderDebugOverlayPng({
    profile,
    frames,
    baseSheet: normalizedSheetPng,
  })
  const onionSkinOverlayPng = await renderOnionSkinOverlayPng({ profile, frames })
  const sourceLayoutOverlayPng = await renderSourceLayoutOverlayPng({
    sourcePng,
    width: sheet.width,
    height: sheet.height,
    grid: computeGridBoundaries({
      width: sheet.width,
      height: sheet.height,
      columns: profile.grid.columns,
      rows: profile.grid.rows,
    }),
    title: 'already_normalized_uniform_sheet',
  })
  const generationJson = Buffer.from(JSON.stringify(safeGeneration, null, 2), 'utf8')
  const zipBuffer = await buildCharacterPackZip({
    'source.png': sourcePng,
    'source_layout_overlay.png': sourceLayoutOverlayPng,
    'normalized_sheet.png': normalizedSheetPng,
    'multi_resolution.json': multiResolution.manifest,
    ...Object.fromEntries(
      multiResolution.manifest.sheets.map((item) => [
        item.file,
        multiResolution.sheets[item.frame_size],
      ]),
    ),
    'debug_overlay.png': debugOverlayPng,
    'onion_skin_overlay.png': onionSkinOverlayPng,
    'animations.json': animationsJson,
    'metadata.json': metadataJson,
    'editor_metadata.json': editorMetadataJson,
    'debug_report.json': debugReport,
    'generation.json': generationJson,
    'inspection_index.json': inspection.indexJson,
    'inspection_sheet.png': inspection.sheetPng,
    ...inspection.gifBuffers,
    ...inspection.stripPngBuffers,
    ...rowGifBuffers,
    ...engine.godotNpcExport.files,
    ...engine.rpgmakerExport.files,
    ...engine.ocadExport.files,
  })
  return {
    sourcePng,
    editorMetadataJson,
    sourceLayoutOverlayPng,
    sourceQualityReportJson: null,
    normalizedSheetPng,
    multiResolutionManifest: multiResolution.manifest,
    multiResolutionSheets: multiResolution.sheets,
    debugOverlayPng,
    onionSkinOverlayPng,
    godotNpcThumbPng: engine.godotNpcThumbPng,
    godotNpcZipBuffer: engine.godotNpcZipBuffer,
    godotNpcJson: engine.godotNpcExport.npcJson,
    rpgmakerZipBuffer: engine.rpgmakerZipBuffer,
    rpgmakerJson: engine.rpgmakerExport.npcJson,
    rpgmakerSpritePng: engine.rpgmakerExport.spritePng,
    rpgmakerThumbPng: engine.rpgmakerExport.thumbPng,
    ocadZipBuffer: engine.ocadZipBuffer,
    ocadJson: engine.ocadExport.npcJson,
    ocadSpritePng: engine.ocadExport.spritePng,
    ocadThumbPng: engine.ocadExport.thumbPng,
    promptTxt: null,
    generationJson,
    inspectionIndexJson: inspection.indexJson,
    inspectionSheetPng: inspection.sheetPng,
    inspectionGifBuffers: inspection.gifBuffers,
    inspectionStripPngBuffers: inspection.stripPngBuffers,
    rowGifBuffers,
    zipBuffer,
  }
}

export async function packageNormalizedCharacterSheet({
  normalizedSheetPng,
  profile,
  parentAnimations,
  parentMetadata,
  createdAt,
  lineage,
  generation,
} = {}) {
  if (
    !isPngBuffer(normalizedSheetPng) ||
    normalizedSheetPng.length > MAX_MANAGED_NORMALIZED_PNG_BYTES
  ) {
    failInvalidManagedSource()
  }
  assertRegisteredProfile(profile)
  const managedProfile = TOPDOWN_RPG_V0
  assertParentAnimations(parentAnimations, managedProfile)
  if (!isIsoTimestamp(createdAt)) failInvalidManagedSource()
  const safeParentMetadata = sanitizeParentMetadata(parentMetadata, managedProfile)
  const safeLineage = sanitizeLineage(lineage)
  const safeGeneration = sanitizeFrameRepairGeneration(generation)
  let animationsJson
  try {
    animationsJson = structuredClone(parentAnimations)
  } catch {
    failInvalidManagedSource()
  }
  const managedPng = Buffer.from(normalizedSheetPng)
  await assertManagedPngMetadata(managedPng, managedProfile)
  let sheet
  try {
    sheet = await loadRgba(managedPng)
  } catch {
    failInvalidManagedSource()
  }
  if (sheet.width !== managedProfile.sheet.w || sheet.height !== managedProfile.sheet.h) {
    failInvalidManagedSource()
  }
  const frames = framesFromExactSheet(sheet, managedProfile)
  const validation = validateNormalizedFrames(frames, managedProfile)
  const metadataJson = buildMetadataJson({
    id: buildPackageId(safeParentMetadata.name, createdAt),
    name: safeParentMetadata.name,
    description: safeParentMetadata.description,
    createdAt,
    source: {
      type: 'derived_revision',
      file_name: 'source.png',
      parent_project_id: safeLineage.project_id,
      parent_asset_id: safeLineage.asset_id,
      parent_revision_id: safeLineage.parent_revision_id,
      parent_job_id: safeLineage.parent_job_id,
    },
    generation: safeGeneration,
    quality: {
      status: validation.status,
      warnings: [...validation.warnings],
      blocking_errors: [...validation.blocking_errors],
    },
    profile: managedProfile,
  })
  const editorMetadataJson = buildEditorMetadataJson({
    metadata: metadataJson,
    animationsJson,
    frames,
    profile: managedProfile,
  })
  const rowPreviews = buildRowPreviewIndex(managedProfile, animationsJson.animations)
  const rowGifBuffers = Object.fromEntries(rowPreviews.map((preview) => [
    preview.fileName,
    encodeGifFromRgbaFrames(
      preview.frames.map((index) => frames[index].image),
      { delay: Math.round(1000 / preview.fps) },
    ),
  ]))
  const inspection = await buildInspectionPreviewArtifacts({
    rowPreviews,
    rowPreviewFrames: frames,
  })
  const debugReport = buildAlreadyNormalizedDebugReport({
    profile: managedProfile,
    frames,
    validation,
    lineage: safeLineage,
    inspection: inspection.report,
  })
  const files = await buildNormalizedPackageFiles({
    sheet,
    managedPng,
    profile: managedProfile,
    frames,
    animationsJson,
    metadataJson,
    editorMetadataJson,
    debugReport,
    safeGeneration,
    rowGifBuffers,
    inspection,
  })

  return {
    id: metadataJson.id,
    animationsJson,
    metadataJson,
    editorMetadataJson,
    debugReport,
    frames,
    rowPreviews,
    inspectionPreviews: inspection.previews,
    processingRecipe: null,
    files,
  }
}
