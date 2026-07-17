export const EDITOR_PROJECT_VERSION = 'editor_project_v0'
export const EDITOR_SCENE_VERSION = 'editor_scene_v0'
export const EDITOR_INTERACTION_VERSION = 'editor_interaction_v0'
export const PROCESSING_RECIPE_VERSION = 'processing_recipe_v0'

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
export const KEY_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*$/
export const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

export const ASSET_KINDS = Object.freeze([
  'character_pack',
  'scene_pack',
  'tilemap',
  'static_image',
  'spritesheet',
  'effect',
  'ui',
])

export const RESERVED_ASSET_KINDS = Object.freeze(['audio_future'])

export const ASSET_KIND_REQUIREMENTS = Object.freeze({
  character_pack: Object.freeze({
    sourceJobId: 'required',
    profile: 'required',
    clips: 'required',
    artifacts: Object.freeze(['sheet', 'animations', 'metadata', 'editor_metadata', 'debug_report']),
  }),
  scene_pack: Object.freeze({
    sourceJobId: 'required',
    profile: 'required',
    clips: 'optional',
    artifacts: Object.freeze(['scene', 'tile_map', 'tile_atlas', 'validation', 'preview']),
  }),
  tilemap: Object.freeze({
    sourceJobId: 'optional',
    profile: 'required',
    clips: 'none',
    artifacts: Object.freeze(['tile_map', 'tileset']),
  }),
  static_image: Object.freeze({
    sourceJobId: 'optional',
    profile: 'optional',
    clips: 'none',
    artifacts: Object.freeze(['image']),
  }),
  spritesheet: Object.freeze({
    sourceJobId: 'optional',
    profile: 'optional',
    clips: 'required',
    artifacts: Object.freeze(['sheet', 'clip_metadata']),
  }),
  effect: Object.freeze({
    sourceJobId: 'optional',
    profile: 'optional',
    clips: 'optional',
    anyArtifacts: Object.freeze(['image', 'sheet']),
  }),
  ui: Object.freeze({
    sourceJobId: 'optional',
    profile: 'optional',
    clips: 'optional',
    anyArtifacts: Object.freeze(['image', 'sheet']),
  }),
})

export const QUALITY_STATUSES = Object.freeze(['pass', 'warning', 'fail', 'unknown'])
export const PRODUCTION_STATUSES = Object.freeze(['ready', 'review_required', 'blocked'])
export const DEFAULT_PRODUCTION_STATUS_BY_QUALITY = Object.freeze({
  pass: 'ready',
  warning: 'review_required',
  fail: 'blocked',
  unknown: 'review_required',
})

export const LAYER_TYPES = Object.freeze([
  'background',
  'tilemap',
  'character',
  'prop',
  'effect',
  'foreground',
  'ui',
])

export const ENTITY_TYPES = Object.freeze(['spawn_point', 'hotspot'])
export const COORDINATE_SPACES = Object.freeze(['world', 'viewport'])
export const PIVOT_MODES = Object.freeze(['artifact_anchor', 'explicit', 'top_left', 'center'])
export const BLEND_MODES = Object.freeze(['normal', 'multiply', 'screen', 'overlay'])
export const PLAYBACK_ACTIVATIONS = Object.freeze(['auto', 'manual'])
export const LOOP_MODES = Object.freeze(['loop', 'once', 'ping_pong'])

export const TRIGGER_TYPES = Object.freeze(['auto', 'near_click', 'near_key', 'state'])
export const ACTION_TYPES = Object.freeze([
  'show_text',
  'play_animation',
  'toggle_layer',
  'set_state',
  'pickup_item',
  'scene_link',
])

export const ZONE_COORDINATE_SPACES = Object.freeze(['owner_local', 'world'])
export const PROVENANCE_SOURCE_TYPES = Object.freeze([
  'upload',
  'provider',
  'manual_import',
  'local_procedural',
  'derived_revision',
])

export const PROCESSING_TARGET_PIPELINES = Object.freeze([
  'character_pack',
  'motion_source',
  'scene_pack',
  'two_point_five_d',
])

export const CHARACTER_PROCESSING_CONTRACT = 'character_pack_process_v1'
export const CHARACTER_REPAIR_OUTPUT_FRAME_SIZES = Object.freeze([96, 64, 48, 32, 16])
export const CHARACTER_RECIPE_INPUT_BACKGROUND_MODES = Object.freeze([
  'auto',
  'passthrough',
  'flood',
  'dual_matte',
  'edge_palette',
])
export const IMPLEMENTATION_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export const BACKGROUND_MODES = Object.freeze(['auto', 'passthrough', 'flood', 'dual_matte', 'edge_palette', 'alpha_cleanup'])
export const OUTLINE_MODES = Object.freeze(['outer', 'inner', 'both', 'none'])
