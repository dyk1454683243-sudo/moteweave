import { buildManualOverrides } from '../../character-pack/gridAdjustment.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from '../../character-pack/sourceLayoutIds.js'

const ADVANCED_SOURCE_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg'])
const ADVANCED_SOURCE_NAME = /\.(?:png|webp|jpe?g)$/i
const BACKGROUND_MODES = new Set(['auto', 'flood', 'edge_palette', 'alpha', 'dual_matte'])
const OUTLINE_MODES = new Set(['outer', 'inner', 'both'])
const SOURCE_LAYOUTS = new Set([TOPDOWN_RPG_SOURCE_LAYOUT_ID, FIXED_REGION_MOTION_LAYOUT_ID])
const LOCKABLE_ANIMATIONS = new Set([
  'idle_down', 'idle_up', 'idle_left', 'idle_right',
  'walk_down', 'walk_up', 'walk_left', 'walk_right',
  'attack_down', 'attack_up', 'attack_left', 'attack_right',
  'hurt', 'happy', 'sit', 'talk',
])

export const ADVANCED_LOCAL_SOURCE_LIMIT_BYTES = 32 * 1024 * 1024
export const ADVANCED_LOCAL_TARGET_FRAME_SIZE = 96

export class StudioCharacterAdvancedLocalError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StudioCharacterAdvancedLocalError'
    this.code = code
  }
}

function advancedError(code, message) {
  return new StudioCharacterAdvancedLocalError(code, message)
}

function finiteNumber(value, { min, max, integer = false, code = 'advanced_option_invalid' } = {}) {
  const number = Number(value)
  if (
    !Number.isFinite(number) ||
    (integer && !Number.isInteger(number)) ||
    (min != null && number < min) ||
    (max != null && number > max)
  ) throw advancedError(code, `Advanced local value must be between ${min} and ${max}`)
  return number
}

function normalizedFileKey(file) {
  if (!file) return null
  return {
    name: String(file.name ?? ''),
    type: String(file.type ?? ''),
    size: Number(file.size),
    lastModified: Number(file.lastModified ?? 0),
  }
}

export function validateAdvancedLocalSourceFile(file, { label = 'Source' } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw advancedError('source_required', `${label} image is required`)
  }
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > ADVANCED_LOCAL_SOURCE_LIMIT_BYTES) {
    throw advancedError('source_size_invalid', `${label} image must be between 1 byte and 32 MiB`)
  }
  const type = String(file.type ?? '').toLowerCase()
  const name = String(file.name ?? '')
  if (!(ADVANCED_SOURCE_TYPES.has(type) || (!type && ADVANCED_SOURCE_NAME.test(name)))) {
    throw advancedError('source_type_invalid', `${label} image must be PNG, WebP, or JPEG`)
  }
  return file
}

export function makeEvenAdvancedCutLines(width, height) {
  const w = finiteNumber(width, { min: 8, max: 32768, integer: true, code: 'cut_line_size_invalid' })
  const h = finiteNumber(height, { min: 8, max: 32768, integer: true, code: 'cut_line_size_invalid' })
  return {
    width: w,
    height: h,
    verticalLines: Array.from({ length: 7 }, (_, index) => Math.round(((index + 1) * w) / 8)),
    horizontalLines: Array.from({ length: 7 }, (_, index) => Math.round(((index + 1) * h) / 8)),
  }
}

function normalizeAxisLines(lines, limit, axis) {
  if (!Array.isArray(lines) || lines.length !== 7) {
    throw advancedError('cut_line_count_invalid', `${axis} cut lines must contain exactly seven positions`)
  }
  const normalized = lines.map((line) => finiteNumber(line, {
    min: 1,
    max: limit - 1,
    integer: true,
    code: 'cut_line_position_invalid',
  }))
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] <= normalized[index - 1]) {
      throw advancedError('cut_line_order_invalid', `${axis} cut lines must be strictly ordered`)
    }
  }
  return normalized
}

export function normalizeAdvancedCutLines(cutLines) {
  if (!cutLines || typeof cutLines !== 'object') {
    throw advancedError('cut_line_required', 'Manual cut lines are missing')
  }
  const width = finiteNumber(cutLines.width, { min: 8, max: 32768, integer: true, code: 'cut_line_size_invalid' })
  const height = finiteNumber(cutLines.height, { min: 8, max: 32768, integer: true, code: 'cut_line_size_invalid' })
  return {
    width,
    height,
    verticalLines: normalizeAxisLines(cutLines.verticalLines, width, 'Vertical'),
    horizontalLines: normalizeAxisLines(cutLines.horizontalLines, height, 'Horizontal'),
  }
}

export function addAdvancedCutLine(cutLines, axis) {
  if (!cutLines || !['vertical', 'horizontal'].includes(axis)) return cutLines
  const field = axis === 'vertical' ? 'verticalLines' : 'horizontalLines'
  const limit = axis === 'vertical' ? cutLines.width : cutLines.height
  const existing = Array.isArray(cutLines[field]) ? [...cutLines[field]].sort((a, b) => a - b) : []
  if (existing.length >= 7) return cutLines
  const boundaries = [0, ...existing, limit]
  let largest = { size: -1, start: 0, end: limit }
  for (let index = 1; index < boundaries.length; index += 1) {
    const size = boundaries[index] - boundaries[index - 1]
    if (size > largest.size) largest = { size, start: boundaries[index - 1], end: boundaries[index] }
  }
  const next = Math.max(largest.start + 1, Math.min(largest.end - 1, Math.round((largest.start + largest.end) / 2)))
  return { ...cutLines, [field]: [...existing, next].sort((a, b) => a - b) }
}

export function moveAdvancedCutLine(cutLines, axis, index, position) {
  const field = axis === 'vertical' ? 'verticalLines' : 'horizontalLines'
  const limit = axis === 'vertical' ? cutLines?.width : cutLines?.height
  const lines = Array.isArray(cutLines?.[field]) ? [...cutLines[field]] : []
  if (!Number.isInteger(index) || index < 0 || index >= lines.length || !Number.isFinite(Number(position))) return cutLines
  const previous = index === 0 ? 0 : lines[index - 1]
  const next = index === lines.length - 1 ? limit : lines[index + 1]
  lines[index] = Math.max(previous + 1, Math.min(next - 1, Math.round(Number(position))))
  return { ...cutLines, [field]: lines }
}

export function createAdvancedLocalSettings(dimensions = null) {
  return {
    sourceLayout: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
    backgroundMode: 'auto',
    backgroundTolerance: 24,
    componentCleanup: true,
    minAlpha: 18,
    minArea: 4,
    minAreaRatio: 0,
    pixelFinishing: false,
    pixelFinishingMaxColors: 16,
    pixelFinishingOutline: true,
    pixelFinishingOutlineMode: 'outer',
    anchorOffset: { x: 0, y: 0 },
    frameAdjustments: {},
    lockedAnimations: [],
    manualCutLinesEnabled: false,
    manualCutLines: dimensions
      ? makeEvenAdvancedCutLines(dimensions.width, dimensions.height)
      : null,
    autoCorrect: true,
    motionStabilize: true,
    motionMaxShift: 2,
    exportScales: [1, 2],
  }
}

export function bindAdvancedBlackMatteSettings(settings) {
  return {
    ...settings,
    backgroundMode: 'dual_matte',
  }
}

export function canCommitAdvancedBlackMatteSelection({
  selectionEpoch,
  currentSelectionEpoch,
  backgroundMode,
}) {
  return (
    Number.isInteger(selectionEpoch) &&
    selectionEpoch === currentSelectionEpoch &&
    backgroundMode === 'dual_matte'
  )
}

export function invalidateAdvancedLocalResultState(value, patch = {}) {
  const next = { ...value, ...patch }
  return {
    ...next,
    phase: next.file ? 'ready' : 'empty',
    busy: null,
    inputEpoch: Number(value?.inputEpoch ?? 0) + 1,
    binding: null,
    job: null,
    result: null,
    failureReport: null,
    error: null,
  }
}

function normalizeFrameAdjustments(value) {
  const entries = Array.isArray(value) ? value.map((item) => [item?.frame, item]) : Object.entries(value ?? {})
  return entries
    .map(([frameKey, adjustment]) => ({
      frame: finiteNumber(adjustment?.frame ?? frameKey, { min: 0, max: 63, integer: true }),
      dx: finiteNumber(adjustment?.dx ?? 0, { min: -16, max: 16, integer: true }),
      dy: finiteNumber(adjustment?.dy ?? 0, { min: -16, max: 16, integer: true }),
    }))
    .filter((adjustment) => adjustment.dx || adjustment.dy)
    .sort((a, b) => a.frame - b.frame)
}

function normalizeExportScales(value) {
  const scales = [...new Set((Array.isArray(value) ? value : []).map(Number))]
    .filter((scale) => Number.isInteger(scale) && scale >= 1 && scale <= 4)
    .sort((a, b) => a - b)
  if (!scales.length) throw advancedError('export_scale_required', 'Choose at least one export scale')
  return scales
}

export function buildAdvancedLocalCharacterOptions({ file, blackFile = null, blackDimensions = null, dimensions, name, settings }) {
  validateAdvancedLocalSourceFile(file)
  const sourceLayout = String(settings?.sourceLayout ?? '')
  if (!SOURCE_LAYOUTS.has(sourceLayout)) throw advancedError('source_layout_invalid', 'Choose a maintained source layout')
  const backgroundMode = String(settings?.backgroundMode ?? '')
  if (!BACKGROUND_MODES.has(backgroundMode)) throw advancedError('background_mode_invalid', 'Choose a maintained background mode')
  if (backgroundMode === 'dual_matte') {
    validateAdvancedLocalSourceFile(blackFile, { label: 'Black-matte pairing' })
    if (
      !dimensions || !blackDimensions ||
      dimensions.width !== blackDimensions.width || dimensions.height !== blackDimensions.height
    ) throw advancedError('black_matte_dimensions_mismatch', 'Black-matte pairing dimensions must match the source')
  }
  const outlineMode = String(settings?.pixelFinishingOutlineMode ?? '')
  if (!OUTLINE_MODES.has(outlineMode)) throw advancedError('outline_mode_invalid', 'Choose a maintained outline mode')
  const exportScales = normalizeExportScales(settings?.exportScales)
  const lockedAnimations = [...new Set((Array.isArray(settings?.lockedAnimations) ? settings.lockedAnimations : []).map(String))]
  if (lockedAnimations.some((animation) => !LOCKABLE_ANIMATIONS.has(animation))) {
    throw advancedError('animation_lock_invalid', 'Animation lock contains an unsupported animation')
  }
  let manualOverrides = null
  if (settings?.manualCutLinesEnabled) {
    if (sourceLayout !== TOPDOWN_RPG_SOURCE_LAYOUT_ID) {
      throw advancedError('cut_line_layout_invalid', 'Manual cut lines are available only for the 8 × 8 layout')
    }
    const cutLines = normalizeAdvancedCutLines(settings.manualCutLines)
    if (!dimensions || cutLines.width !== dimensions.width || cutLines.height !== dimensions.height) {
      throw advancedError('cut_line_binding_mismatch', 'Manual cut lines do not match the current source dimensions')
    }
    manualOverrides = buildManualOverrides(cutLines)
  }
  const anchorOffset = {
    x: finiteNumber(settings?.anchorOffset?.x ?? 0, { min: -16, max: 16, integer: true }),
    y: finiteNumber(settings?.anchorOffset?.y ?? 0, { min: -16, max: 16, integer: true }),
  }
  const frameAdjustments = normalizeFrameAdjustments(settings?.frameAdjustments)
  const motionMaxShift = finiteNumber(settings?.motionMaxShift ?? 2, { min: 0, max: 8, integer: true })
  const pixelFinishingMaxColors = finiteNumber(settings?.pixelFinishingMaxColors ?? 16, { min: 2, max: 64, integer: true })
  const options = {
    sourceLayout,
    description: '',
    backgroundMode,
    backgroundTolerance: finiteNumber(settings?.backgroundTolerance ?? 24, { min: 0, max: 80, integer: true }),
    anchorOffset,
    frameAdjustments,
    lockedAnimations,
    manualOverrides,
    autoCorrect: settings?.autoCorrect !== false,
    componentCleanup: settings?.componentCleanup !== false,
    minAlpha: finiteNumber(settings?.minAlpha ?? 18, { min: 0, max: 80, integer: true }),
    minArea: finiteNumber(settings?.minArea ?? 4, { min: 1, max: 64, integer: true }),
    minAreaRatio: finiteNumber(settings?.minAreaRatio ?? 0, { min: 0, max: 0.25 }),
    motionStabilize: settings?.motionStabilize !== false,
    motionStabilizationMaxShift: motionMaxShift,
    motionMaxShift,
    pixelFinishing: settings?.pixelFinishing === true,
    pixelFinishingMaxColors,
    pixelFinishingOutline: settings?.pixelFinishingOutline !== false,
    pixelFinishingOutlineMode: outlineMode,
    styleReport: settings?.pixelFinishing === true,
    styleMaxColors: pixelFinishingMaxColors,
    export1x: exportScales.includes(1),
    export2x: exportScales.includes(2),
    export3x: exportScales.includes(3),
    export4x: exportScales.includes(4),
    outputFrameSizes: exportScales.map((scale) => ADVANCED_LOCAL_TARGET_FRAME_SIZE * scale),
    name: String(name ?? '').trim(),
    sourceFileName: String(file.name ?? ''),
  }
  if (!options.name || options.name.length > 64 || /[\u0000-\u001f\u007f]/.test(options.name)) {
    throw advancedError('name_invalid', 'Resource name must contain 1–64 visible characters')
  }
  if (sourceLayout === FIXED_REGION_MOTION_LAYOUT_ID) {
    Object.assign(options, {
      fixedRegionSourceStaging: 'fixed_region_256_crop',
      fixedRegionStageSize: 256,
      fixedRegionCropRight: 4,
      fixedRegionCropBottom: 4,
      fixedRegionMatteTolerance: 80,
    })
  }
  return options
}

export function advancedLocalInputFingerprint({ file, blackFile = null, options, inputEpoch = null }) {
  return JSON.stringify({
    inputEpoch,
    file: normalizedFileKey(file),
    blackFile: normalizedFileKey(blackFile),
    options,
  })
}
