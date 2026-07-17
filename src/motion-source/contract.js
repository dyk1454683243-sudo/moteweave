import { normalizeMotionSelectionOptions } from './frameSelector.js'

export const MOTION_SOURCE_CONTRACT_VERSION = 'motion_source_contract_v1'

const SOURCE_KINDS = new Set(['gif', 'frame_sequence_zip', 'single_image', 'video_file'])
const BASELINES = new Set(['global_bbox_bottom', 'manual_static'])
const BACKGROUND_SOURCE_REQUIREMENTS = new Set([
  'flat_solid_key_color_or_alpha',
  'transparent_alpha',
  'flat_solid_key_color',
])
const RESAMPLE_STRATEGIES = new Set(['reject_mismatch', 'nearest_keyframes'])

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validColorChannel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

function validateTuple(name, value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(positiveInteger)) {
    throw new Error(`invalid_${name}`)
  }
}

function validateRgb(name, value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(validColorChannel)) {
    throw new Error(`invalid_${name}`)
  }
}

export function validateMotionSourceContract(contract) {
  if (!contract || typeof contract !== 'object') throw new Error('invalid_motion_source_contract')
  if (contract.contract_version !== MOTION_SOURCE_CONTRACT_VERSION) throw new Error('unsupported_motion_source_contract_version')
  if (!SOURCE_KINDS.has(contract.source_kind)) throw new Error('unsupported_motion_source_kind')
  if (typeof contract.runtime_action !== 'string' || !contract.runtime_action.trim()) throw new Error('invalid_runtime_action')
  if (!positiveInteger(contract.target_frame_count)) throw new Error('invalid_target_frame_count')

  validateTuple('normalized_cell', contract.frame_size?.normalized_cell)
  if (contract.frame_size?.strip_layout !== 'horizontal') throw new Error('unsupported_strip_layout')

  const baseline = contract.anchor_policy?.baseline
  if (!BASELINES.has(baseline)) throw new Error('unsupported_anchor_baseline')
  if (!Number.isFinite(Number(contract.anchor_policy?.static_offset_y))) throw new Error('invalid_static_offset_y')
  if (!positiveInteger(contract.anchor_policy?.padding_px)) throw new Error('invalid_padding_px')
  if (!Number.isFinite(Number(contract.anchor_policy?.max_anchor_drift_px))) throw new Error('invalid_max_anchor_drift_px')

  const sourceRequirement = contract.background?.source_requirement
  if (!BACKGROUND_SOURCE_REQUIREMENTS.has(sourceRequirement)) throw new Error('unsupported_background_source_requirement')
  validateRgb('background_key_color', contract.background?.key_color)
  if (!Number.isFinite(Number(contract.background?.tolerance)) || Number(contract.background.tolerance) < 0) {
    throw new Error('invalid_background_tolerance')
  }

  if (!positiveInteger(contract.pixel_style?.max_colors)) throw new Error('invalid_max_colors')
  if (!RESAMPLE_STRATEGIES.has(contract.output_profile?.resample_strategy)) throw new Error('unsupported_resample_strategy')
  const hasSnakeSelection = Object.prototype.hasOwnProperty.call(contract, 'motion_selection')
  const hasCamelSelection = Object.prototype.hasOwnProperty.call(contract, 'motionSelection')
  if (
    hasSnakeSelection &&
    hasCamelSelection &&
    JSON.stringify(contract.motion_selection) !== JSON.stringify(contract.motionSelection)
  ) {
    throw new Error('conflicting_motion_selection_contract_options')
  }
  if (hasSnakeSelection || hasCamelSelection) {
    normalizeMotionSelectionOptions(
      hasSnakeSelection ? contract.motion_selection : contract.motionSelection
    )
  }
  return contract
}

export function createMotionSourceContract(overrides = {}) {
  const hasSnakeSelection = Object.prototype.hasOwnProperty.call(overrides, 'motion_selection')
  const hasCamelSelection = Object.prototype.hasOwnProperty.call(overrides, 'motionSelection')
  if (
    hasSnakeSelection &&
    hasCamelSelection &&
    JSON.stringify(overrides.motion_selection) !== JSON.stringify(overrides.motionSelection)
  ) {
    throw new Error('conflicting_motion_selection_contract_options')
  }
  const motionSelection = normalizeMotionSelectionOptions(
    hasSnakeSelection
      ? overrides.motion_selection
      : hasCamelSelection
        ? overrides.motionSelection
        : false
  )
  const contract = {
    contract_version: MOTION_SOURCE_CONTRACT_VERSION,
    source_kind: overrides.source_kind ?? 'gif',
    runtime_action: overrides.runtime_action ?? 'walk_down',
    target_frame_count: overrides.target_frame_count ?? 8,
    sampling: {
      fps: overrides.sampling?.fps ?? 12,
      stride: overrides.sampling?.stride ?? 1,
      max_frames: overrides.sampling?.max_frames ?? 64,
      start_sec: overrides.sampling?.start_sec ?? 0,
      end_sec: overrides.sampling?.end_sec ?? null,
    },
    frame_size: {
      normalized_cell: overrides.frame_size?.normalized_cell ?? [96, 96],
      strip_layout: overrides.frame_size?.strip_layout ?? 'horizontal',
    },
    anchor_policy: {
      pivot: overrides.anchor_policy?.pivot ?? 'bottom_center',
      baseline: overrides.anchor_policy?.baseline ?? 'global_bbox_bottom',
      static_offset_y: overrides.anchor_policy?.static_offset_y ?? 0,
      padding_px: overrides.anchor_policy?.padding_px ?? 6,
      max_anchor_drift_px: overrides.anchor_policy?.max_anchor_drift_px ?? 2,
    },
    background: {
      mode: overrides.background?.mode ?? 'auto_flood',
      source_requirement: overrides.background?.source_requirement ?? 'flat_solid_key_color_or_alpha',
      key_color: overrides.background?.key_color ?? [255, 255, 255],
      tolerance: overrides.background?.tolerance ?? 24,
      defringe: overrides.background?.defringe ?? true,
      protect_internal_light_pixels: overrides.background?.protect_internal_light_pixels ?? true,
    },
    pixel_style: {
      palette_snap: overrides.pixel_style?.palette_snap ?? false,
      max_colors: overrides.pixel_style?.max_colors ?? 32,
      nearest_resize: overrides.pixel_style?.nearest_resize ?? true,
    },
    output_profile: {
      target_profile: overrides.output_profile?.target_profile ?? 'topdown_rpg_v0',
      apply_mode: overrides.output_profile?.apply_mode ?? 'single_action_strip',
      resample_strategy: overrides.output_profile?.resample_strategy ?? 'reject_mismatch',
    },
    motion_selection: motionSelection,
  }
  validateMotionSourceContract(contract)
  return contract
}
