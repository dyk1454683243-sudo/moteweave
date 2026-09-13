import { serializeMotionSelectionOptions } from './guidedState.js'

const MOTION_PIXEL_GRID_RECIPES = new Set([
  'pixel_grid_v2_balanced',
  'pixel_grid_v2_detail_safe',
  'pixel_grid_v2_oklab',
])

const MODEL_FIELDS = new Set([
  'action',
  'targetFrameCount',
  'selectionMode',
  'selectionRecipe',
  'loopExpectation',
  'temporalMatte',
  'stride',
  'fps',
  'maxFrames',
  'startSec',
  'endSec',
  'backgroundMethod',
  'keyColor',
  'backgroundTolerance',
  'defringe',
  'staticOffsetY',
  'pixelGridRecipe',
  'resampleStrategy',
])

export const DEFAULT_MOTION_OPTIONS_MODEL = Object.freeze({
  action: 'walk_down',
  targetFrameCount: 4,
  selectionMode: 'auto',
  selectionRecipe: 'motion_selection_recipe_v2',
  loopExpectation: 'auto',
  temporalMatte: 'disabled',
  stride: 1,
  fps: 12,
  maxFrames: 64,
  startSec: 0,
  endSec: null,
  backgroundMethod: 'key_color',
  keyColor: Object.freeze([255, 255, 255]),
  backgroundTolerance: 24,
  defringe: true,
  staticOffsetY: 0,
  pixelGridRecipe: 'disabled',
  resampleStrategy: 'reject_mismatch',
})

function freezeModel(value) {
  return Object.freeze({
    ...value,
    keyColor: Object.freeze([...value.keyColor]),
  })
}

function normalizeDependencies(value) {
  if (value.selectionRecipe !== 'motion_selection_v1_compat') return value
  return {
    ...value,
    loopExpectation: 'auto',
    temporalMatte: 'disabled',
  }
}

function assertKnownFields(patch) {
  for (const field of Object.keys(patch)) {
    if (!MODEL_FIELDS.has(field)) {
      throw new Error(`Unknown Motion options model field: ${field}`)
    }
  }
}

export function createMotionOptionsModel(overrides = {}) {
  return updateMotionOptionsModel(DEFAULT_MOTION_OPTIONS_MODEL, overrides)
}

export function updateMotionOptionsModel(model, patch = {}) {
  assertKnownFields(patch)
  return freezeModel(normalizeDependencies({
    ...model,
    ...patch,
    keyColor: patch.keyColor ? [...patch.keyColor] : [...model.keyColor],
  }))
}

export function parseMotionKeyColor(value) {
  const parts = String(value).split(',')
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) return null
  const channels = parts.map((part) => Number(part.trim()))
  return channels.every(Number.isFinite) ? channels : null
}

export function formatMotionKeyColor(value) {
  return value.join(',')
}

export function serializeMotionPixelGridRecipe(value) {
  if (value === 'disabled') return null
  if (!MOTION_PIXEL_GRID_RECIPES.has(value)) {
    throw new Error(`Unsupported Motion Pixel Grid recipe: ${value}`)
  }
  return { recipe: value }
}

export function serializeMotionOptions(model, { frameSelection = [] } = {}) {
  const motionSelection = serializeMotionSelectionOptions({
    recipe: model.selectionRecipe,
    loopExpectation: model.loopExpectation,
    temporalMatte: model.temporalMatte,
  })
  const pixelGridRefinement = serializeMotionPixelGridRecipe(
    model.pixelGridRecipe
  )
  const options = {
    action: model.action,
    frames: Number(model.targetFrameCount),
    selection_mode: model.selectionMode === 'manual' ? 'manual' : 'auto',
    motion_selection: motionSelection,
    stride: Number(model.stride),
    fps: Number(model.fps),
    maxFrames: Number(model.maxFrames),
    startSec: Number(model.startSec || 0),
    endSec: model.endSec === '' || model.endSec === null
      ? null
      : Number(model.endSec),
    background: {
      method: model.backgroundMethod,
      key_color: model.keyColor.map((channel) => Number(channel)),
      tolerance: Number(model.backgroundTolerance),
      defringe: Boolean(model.defringe),
    },
    anchor_policy: {
      static_offset_y: Number(model.staticOffsetY),
    },
    output_profile: {
      resample_strategy: model.resampleStrategy,
    },
  }
  if (pixelGridRefinement) {
    options.pixel_grid_refinement = pixelGridRefinement
  }
  if (options.selection_mode === 'manual') {
    options.selected_frame_indexes = frameSelection
      .filter((frame) => frame.selected)
      .map((frame) => frame.source_index)
  }
  return options
}

export function snapshotMotionOptions(model, context) {
  return JSON.parse(JSON.stringify(serializeMotionOptions(model, context)))
}
