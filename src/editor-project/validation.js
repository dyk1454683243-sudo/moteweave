import {
  ACTION_TYPES,
  ASSET_KIND_REQUIREMENTS,
  ASSET_KINDS,
  BACKGROUND_MODES,
  BLEND_MODES,
  CHARACTER_PROCESSING_CONTRACT,
  CHARACTER_RECIPE_INPUT_BACKGROUND_MODES,
  CHARACTER_REPAIR_OUTPUT_FRAME_SIZES,
  COORDINATE_SPACES,
  EDITOR_INTERACTION_VERSION,
  EDITOR_PROJECT_VERSION,
  EDITOR_SCENE_VERSION,
  ENTITY_TYPES,
  IMPLEMENTATION_REVISION_PATTERN,
  LAYER_TYPES,
  LOOP_MODES,
  OUTLINE_MODES,
  PIVOT_MODES,
  PLAYBACK_ACTIVATIONS,
  PROCESSING_RECIPE_VERSION,
  PROCESSING_TARGET_PIPELINES,
  PRODUCTION_STATUSES,
  PROVENANCE_SOURCE_TYPES,
  QUALITY_STATUSES,
  RESERVED_ASSET_KINDS,
  TRIGGER_TYPES,
  ZONE_COORDINATE_SPACES,
} from './constants.js'
import {
  getAnyRequiredArtifactKeys,
  getAssetClip,
  getRequiredArtifactKeys,
} from './assets.js'
import {
  findBase64PayloadPaths,
  findSecretLikePaths,
  isFiniteNumber,
  isIsoTimestamp,
  isNonNegativeFiniteNumber,
  isNonNegativeInteger,
  isObjectMap,
  isPlainObject,
  isPositiveFiniteNumber,
  isPositiveInteger,
  isSafeRelativePath,
  isValidId,
  isValidJobId,
  isValidKeyCode,
  isValidStateKey,
} from './safety.js'
import { TOPDOWN_RPG_SOURCE_LAYOUT_ID, FIXED_REGION_MOTION_LAYOUT_ID, LEGACY_OCAD_MOTION_LAYOUT_ID } from '../character-pack/sourceLayoutIds.js'

const SOURCE_LAYOUT_IDS = new Set([
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
])

function pushUnique(list, code) {
  if (!list.includes(code)) list.push(code)
}

function makeResult(blocking_errors, warnings = [], metrics = {}) {
  return {
    status: blocking_errors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors,
    warnings,
    metrics,
  }
}

function addJsonSafetyErrors(value, errors) {
  if (findBase64PayloadPaths(value).length) pushUnique(errors, 'embedded_base64_payload')
  if (findSecretLikePaths(value).length) pushUnique(errors, 'secret_like_field')
}

function validatePath(value, errors, code = 'unsafe_relative_path') {
  if (value != null && !isSafeRelativePath(value)) pushUnique(errors, code)
}

function validatePositiveDimensions(value, errors, code) {
  if (!isPositiveInteger(value?.w) || !isPositiveInteger(value?.h)) pushUnique(errors, code)
}

function validateRevisionGraph(revisions, errors) {
  for (const [key, revision] of Object.entries(revisions ?? {})) {
    if (key !== revision?.id) pushUnique(errors, 'revision_key_id_mismatch')
    if (!isValidId(revision?.id)) pushUnique(errors, 'malformed_revision_id')
    if (!isIsoTimestamp(revision?.created_at)) pushUnique(errors, 'invalid_revision_created_at')
    if (!QUALITY_STATUSES.includes(revision?.quality_status)) pushUnique(errors, 'unknown_quality_status')
    if (!PRODUCTION_STATUSES.includes(revision?.production_status)) pushUnique(errors, 'unknown_production_status')
    if (!isValidJobId(revision?.source_job_id)) pushUnique(errors, 'malformed_source_job_id')
    if (revision?.parent_revision_id != null && !revisions[revision.parent_revision_id]) {
      pushUnique(errors, 'missing_parent_revision')
    }
    validatePath(revision?.processing_recipe_ref, errors, 'unsafe_processing_recipe_ref')
    for (const path of Object.values(revision?.artifacts ?? {})) {
      validatePath(path, errors, 'unsafe_artifact_path')
    }
    if (
      ['warning', 'fail', 'unknown'].includes(revision?.quality_status) &&
      revision?.production_status === 'ready' &&
      (!revision?.override?.reason || !isIsoTimestamp(revision?.override?.created_at))
    ) {
      pushUnique(errors, 'ready_override_missing')
    }
  }

  for (const id of Object.keys(revisions ?? {})) {
    const seen = new Set()
    let cursor = id
    while (cursor) {
      if (seen.has(cursor)) {
        pushUnique(errors, 'revision_parent_cycle')
        break
      }
      seen.add(cursor)
      cursor = revisions[cursor]?.parent_revision_id ?? null
      if (cursor && !revisions[cursor]) break
    }
  }
}

function validateClipDescriptors(asset, errors) {
  for (const [key, clip] of Object.entries(asset?.clips ?? {})) {
    if (key !== clip?.id) pushUnique(errors, 'clip_key_id_mismatch')
    if (!isValidId(clip?.id)) pushUnique(errors, 'malformed_clip_id')
    if (!Array.isArray(clip?.frames) || !clip.frames.every(isNonNegativeInteger)) {
      pushUnique(errors, 'invalid_clip_frames')
    }
    if (!isPositiveFiniteNumber(clip?.fps)) pushUnique(errors, 'invalid_clip_fps')
    validatePositiveDimensions(clip?.frame_size, errors, 'invalid_clip_frame_size')
    if (!isFiniteNumber(clip?.anchor?.x) || !isFiniteNumber(clip?.anchor?.y)) {
      pushUnique(errors, 'invalid_clip_anchor')
    }
    if (clip?.loop_mode != null && !LOOP_MODES.includes(clip.loop_mode)) {
      pushUnique(errors, 'unknown_clip_loop_mode')
    }
  }
}

export function validateAssetRef(asset) {
  const errors = []
  const warnings = []
  addJsonSafetyErrors(asset, errors)

  if (!isPlainObject(asset)) {
    pushUnique(errors, 'asset_ref_not_object')
    return makeResult(errors, warnings)
  }

  if (!isValidId(asset.id)) pushUnique(errors, 'malformed_asset_id')
  if (RESERVED_ASSET_KINDS.includes(asset.kind)) pushUnique(errors, 'reserved_asset_kind')
  if (!ASSET_KINDS.includes(asset.kind)) pushUnique(errors, 'unknown_asset_kind')
  if (!isObjectMap(asset.revisions) || !Object.keys(asset.revisions).length) {
    pushUnique(errors, 'missing_asset_revisions')
  }
  if (!asset.active_revision_id || !asset.revisions?.[asset.active_revision_id]) {
    pushUnique(errors, 'missing_active_revision')
  }

  const requirements = ASSET_KIND_REQUIREMENTS[asset.kind]
  if (requirements?.profile === 'required' && !asset.profile) pushUnique(errors, 'missing_asset_profile')
  if (requirements?.clips === 'required' && (!isObjectMap(asset.clips) || !Object.keys(asset.clips).length)) {
    pushUnique(errors, 'missing_required_clips')
  }
  if (requirements?.clips === 'none' && asset.clips && Object.keys(asset.clips).length) {
    pushUnique(errors, 'unexpected_asset_clips')
  }

  validateRevisionGraph(asset.revisions, errors)
  validateClipDescriptors(asset, errors)

  for (const revision of Object.values(asset.revisions ?? {})) {
    if (requirements?.sourceJobId === 'required' && !revision.source_job_id) {
      pushUnique(errors, 'missing_source_job_id')
    }
    for (const key of getRequiredArtifactKeys(asset.kind)) {
      if (!revision?.artifacts?.[key]) pushUnique(errors, `missing_required_artifact_${key}`)
    }
    const anyArtifacts = getAnyRequiredArtifactKeys(asset.kind)
    if (anyArtifacts.length && !anyArtifacts.some((key) => revision?.artifacts?.[key])) {
      pushUnique(errors, `missing_required_artifact_${anyArtifacts.join('_or_')}`)
    }
  }

  if (asset.provenance?.source_type && !PROVENANCE_SOURCE_TYPES.includes(asset.provenance.source_type)) {
    pushUnique(errors, 'unknown_provenance_source_type')
  }

  return makeResult(errors, warnings, {
    revision_count: Object.keys(asset.revisions ?? {}).length,
    clip_count: Object.keys(asset.clips ?? {}).length,
  })
}

function buildSceneContext(scene, { assets = {}, scenes = {} } = {}) {
  return {
    assets,
    scenes,
    layersById: new Map((scene?.layers ?? []).map((layer) => [layer.id, layer])),
    entitiesById: new Map((scene?.entities ?? []).map((entity) => [entity.id, entity])),
  }
}

function validateLayerTransform(layer, errors) {
  const transform = layer?.transform
  if (!isFiniteNumber(transform?.position?.x) || !isFiniteNumber(transform?.position?.y)) {
    pushUnique(errors, 'invalid_layer_position')
  }
  if (!isPositiveFiniteNumber(transform?.scale?.x) || !isPositiveFiniteNumber(transform?.scale?.y)) {
    pushUnique(errors, 'invalid_layer_scale')
  }
  if (!isFiniteNumber(transform?.rotation_deg)) pushUnique(errors, 'invalid_layer_rotation')
  if (!COORDINATE_SPACES.includes(transform?.coordinate_space)) pushUnique(errors, 'unknown_coordinate_space')
  if (!PIVOT_MODES.includes(transform?.pivot?.mode)) pushUnique(errors, 'unknown_pivot_mode')
  if (transform?.pivot?.mode === 'explicit' && (!isFiniteNumber(transform?.pivot?.x) || !isFiniteNumber(transform?.pivot?.y))) {
    pushUnique(errors, 'invalid_explicit_pivot')
  }
  if (typeof transform?.flip_x !== 'boolean' || typeof transform?.flip_y !== 'boolean') {
    pushUnique(errors, 'invalid_layer_flip')
  }
}

function validateLayerRender(layer, errors) {
  const render = layer?.render
  if (!Number.isInteger(render?.z_index)) pushUnique(errors, 'invalid_z_index')
  if (!isFiniteNumber(render?.opacity) || render.opacity < 0 || render.opacity > 1) {
    pushUnique(errors, 'invalid_opacity')
  }
  if (!isFiniteNumber(render?.parallax) || render.parallax < 0) pushUnique(errors, 'invalid_parallax')
  if (render?.blend_mode != null && !BLEND_MODES.includes(render.blend_mode)) pushUnique(errors, 'unknown_blend_mode')
  if (layer?.transform?.coordinate_space === 'viewport' && render?.parallax !== 1) {
    pushUnique(errors, 'viewport_layer_uses_world_parallax')
  }
}

function validateLayerPlayback(layer, asset, errors) {
  const playback = layer?.playback
  if (!playback) return
  if (!PLAYBACK_ACTIVATIONS.includes(playback.activation)) pushUnique(errors, 'unknown_playback_activation')
  if (!LOOP_MODES.includes(playback.loop_mode)) pushUnique(errors, 'unknown_loop_mode')
  if (!isPositiveFiniteNumber(playback.rate)) pushUnique(errors, 'invalid_playback_rate')
  if (!isNonNegativeFiniteNumber(playback.start_offset_ms)) pushUnique(errors, 'invalid_start_offset_ms')
  if (typeof playback.initially_paused !== 'boolean') pushUnique(errors, 'invalid_initially_paused')

  const resolvedClip = getAssetClip(asset, layer?.clip_id)
  const hasAnyClips = Boolean(Object.keys(asset?.clips ?? {}).length)
  const autoLoops = playback.activation === 'auto' && playback.loop_mode !== 'once'
  if (!resolvedClip && (autoLoops || playback.rate !== 1 || playback.start_offset_ms > 0)) {
    pushUnique(errors, 'animated_playback_without_clip')
  }
  if (!hasAnyClips && autoLoops) pushUnique(errors, 'static_asset_auto_loop')
}

function validateLayer(layer, context, errors) {
  if (!isValidId(layer?.id)) pushUnique(errors, 'malformed_layer_id')
  if (!LAYER_TYPES.includes(layer?.type)) pushUnique(errors, 'unknown_layer_type')
  if (typeof layer?.visible !== 'boolean') pushUnique(errors, 'invalid_layer_visible')
  if (typeof layer?.locked !== 'boolean') pushUnique(errors, 'invalid_layer_locked')

  const asset = context.assets[layer?.asset_id]
  if (!layer?.asset_id) pushUnique(errors, 'missing_layer_asset_id')
  else if (!asset) pushUnique(errors, 'missing_layer_asset')
  else if (layer?.clip_id && !getAssetClip(asset, layer.clip_id)) pushUnique(errors, 'missing_layer_clip')

  validateLayerTransform(layer, errors)
  validateLayerRender(layer, errors)
  validateLayerPlayback(layer, asset, errors)
  if (layer?.interaction != null) {
    const interaction = validateInteractionDocument(layer.interaction, {
      ...context,
      visualOwner: true,
      ownerLayerId: layer.id,
    })
    for (const error of interaction.blocking_errors) pushUnique(errors, error)
  }
}

function validateEntity(entity, context, errors) {
  if (!isValidId(entity?.id)) pushUnique(errors, 'malformed_entity_id')
  if (!ENTITY_TYPES.includes(entity?.type)) pushUnique(errors, 'unknown_entity_type')
  if (entity?.position && (!isFiniteNumber(entity.position.x) || !isFiniteNumber(entity.position.y))) {
    pushUnique(errors, 'invalid_entity_position')
  }
  if (entity?.interaction != null) {
    const interaction = validateInteractionDocument(entity.interaction, {
      ...context,
      visualOwner: false,
      ownerEntityId: entity.id,
    })
    for (const error of interaction.blocking_errors) pushUnique(errors, error)
  }
}

export function validateSceneDocument(scene, { assets = {}, scenes = {} } = {}) {
  const errors = []
  const warnings = []
  addJsonSafetyErrors(scene, errors)

  if (!isPlainObject(scene)) {
    pushUnique(errors, 'scene_not_object')
    return makeResult(errors, warnings)
  }

  if (scene.version !== EDITOR_SCENE_VERSION) pushUnique(errors, 'unknown_scene_version')
  if (!isValidId(scene.id)) pushUnique(errors, 'malformed_scene_id')
  validatePositiveDimensions(scene.world, errors, 'invalid_world_dimensions')
  validatePositiveDimensions(scene.viewport, errors, 'invalid_viewport_dimensions')
  if (!isFiniteNumber(scene.camera?.x) || !isFiniteNumber(scene.camera?.y) || !isPositiveFiniteNumber(scene.camera?.zoom)) {
    pushUnique(errors, 'invalid_camera')
  }
  if (!Array.isArray(scene.layers)) pushUnique(errors, 'scene_layers_not_array')
  if (!Array.isArray(scene.entities)) pushUnique(errors, 'scene_entities_not_array')
  if (!isIsoTimestamp(scene.created_at)) pushUnique(errors, 'invalid_scene_created_at')
  if (!isIsoTimestamp(scene.updated_at)) pushUnique(errors, 'invalid_scene_updated_at')

  const layerIds = new Set()
  for (const layer of scene.layers ?? []) {
    if (layerIds.has(layer?.id)) pushUnique(errors, 'duplicate_layer_id')
    layerIds.add(layer?.id)
  }
  const entityIds = new Set()
  for (const entity of scene.entities ?? []) {
    if (entityIds.has(entity?.id)) pushUnique(errors, 'duplicate_entity_id')
    entityIds.add(entity?.id)
  }

  const context = buildSceneContext(scene, { assets, scenes })
  for (const layer of scene.layers ?? []) validateLayer(layer, context, errors)
  for (const entity of scene.entities ?? []) validateEntity(entity, context, errors)

  return makeResult(errors, warnings, {
    layer_count: scene.layers?.length ?? 0,
    entity_count: scene.entities?.length ?? 0,
  })
}

function validateCondition(condition, errors) {
  if (!condition) return
  if (!isValidStateKey(condition.state_key)) pushUnique(errors, 'malformed_state_key')
  if (condition.equals === undefined) pushUnique(errors, 'missing_condition_value')
}

function validateZone(zone, { visualOwner }, errors) {
  if (!zone) return
  if (!ZONE_COORDINATE_SPACES.includes(zone.coordinate_space)) pushUnique(errors, 'unknown_zone_coordinate_space')
  if (zone.coordinate_space === 'owner_local' && !visualOwner) pushUnique(errors, 'owner_local_zone_without_owner')
  if (!isFiniteNumber(zone.x) || !isFiniteNumber(zone.y) || !isPositiveFiniteNumber(zone.w) || !isPositiveFiniteNumber(zone.h)) {
    pushUnique(errors, 'invalid_zone_dimensions')
  }
}

function targetLayer(context, id) {
  return context?.layersById?.get(id) ?? null
}

function targetScene(context, id) {
  return context?.scenes?.[id] ?? null
}

function validateInteractionAction(action, index, actions, context, errors) {
  if (!ACTION_TYPES.includes(action?.type)) {
    pushUnique(errors, 'unknown_action_type')
    return
  }

  if (action.type === 'show_text') {
    if (typeof action.text !== 'string' || !action.text.trim()) pushUnique(errors, 'empty_show_text')
    if (action.duration_ms != null && !isNonNegativeFiniteNumber(action.duration_ms)) {
      pushUnique(errors, 'invalid_show_text_duration')
    }
  }

  if (action.type === 'play_animation') {
    const layer = targetLayer(context, action.target_layer_id)
    if (!layer) pushUnique(errors, 'missing_target_layer')
    const asset = context?.assets?.[layer?.asset_id]
    if (!asset || !getAssetClip(asset, action.clip_id)) pushUnique(errors, 'missing_target_clip')
    if (typeof action.restart !== 'boolean') pushUnique(errors, 'invalid_restart_flag')
  }

  if (action.type === 'toggle_layer') {
    if (!targetLayer(context, action.target_layer_id)) pushUnique(errors, 'missing_target_layer')
    if (typeof action.visible !== 'boolean') pushUnique(errors, 'invalid_toggle_visible')
  }

  if (action.type === 'set_state') {
    if (!isValidStateKey(action.key)) pushUnique(errors, 'malformed_state_key')
    addJsonSafetyErrors({ value: action.value }, errors)
  }

  if (action.type === 'pickup_item') {
    if (!isValidId(action.item_id)) pushUnique(errors, 'malformed_item_id')
    if (!isPositiveInteger(action.quantity)) pushUnique(errors, 'invalid_pickup_quantity')
    if (action.hide_layer_id && !targetLayer(context, action.hide_layer_id)) pushUnique(errors, 'missing_target_layer')
  }

  if (action.type === 'scene_link') {
    const scene = targetScene(context, action.target_scene_id)
    if (!scene) pushUnique(errors, 'missing_target_scene')
    const spawn = scene?.entities?.find((entity) => entity.id === action.target_spawn_id && entity.type === 'spawn_point')
    if (!spawn) pushUnique(errors, 'missing_target_spawn')
    if (index !== actions.length - 1) pushUnique(errors, 'scene_link_not_last')
  }
}

export function validateInteractionDocument(interaction, context = {}) {
  const errors = []
  const warnings = []
  addJsonSafetyErrors(interaction, errors)

  if (!isPlainObject(interaction)) {
    pushUnique(errors, 'interaction_not_object')
    return makeResult(errors, warnings)
  }
  if (interaction.version !== EDITOR_INTERACTION_VERSION) pushUnique(errors, 'unknown_interaction_version')
  if (typeof interaction.enabled !== 'boolean') pushUnique(errors, 'invalid_interaction_enabled')
  if (!TRIGGER_TYPES.includes(interaction.trigger?.type)) pushUnique(errors, 'unknown_trigger_type')
  if (interaction.trigger?.type === 'near_key' && !isValidKeyCode(interaction.trigger?.key)) {
    pushUnique(errors, 'malformed_key_code')
  }
  if (interaction.trigger?.radius != null && !isNonNegativeFiniteNumber(interaction.trigger.radius)) {
    pushUnique(errors, 'invalid_trigger_radius')
  }
  validateZone(interaction.trigger?.zone, context, errors)
  validateCondition(interaction.trigger?.condition, errors)
  if (!Array.isArray(interaction.actions)) pushUnique(errors, 'interaction_actions_not_array')
  for (const [index, action] of (interaction.actions ?? []).entries()) {
    validateInteractionAction(action, index, interaction.actions, context, errors)
  }

  return makeResult(errors, warnings, {
    action_count: interaction.actions?.length ?? 0,
  })
}

function validateSceneFlow(sceneFlow, scenes, errors) {
  if (!sceneFlow) return
  if (!isObjectMap(sceneFlow.nodes)) {
    pushUnique(errors, 'scene_flow_nodes_not_object')
    return
  }
  if (!Array.isArray(sceneFlow.links)) {
    pushUnique(errors, 'scene_flow_links_not_array')
    return
  }
  for (const key of Object.keys(sceneFlow.nodes ?? {})) {
    if (!scenes[key]) pushUnique(errors, 'scene_flow_node_missing_scene')
    const node = sceneFlow.nodes[key]
    if (!isFiniteNumber(node?.x) || !isFiniteNumber(node?.y) || !isPositiveFiniteNumber(node?.w) || !isPositiveFiniteNumber(node?.h)) {
      pushUnique(errors, 'invalid_scene_flow_node')
    }
  }
  const linkIds = new Set()
  for (const link of sceneFlow.links ?? []) {
    if (!isValidId(link?.id)) pushUnique(errors, 'malformed_scene_flow_link_id')
    if (linkIds.has(link?.id)) pushUnique(errors, 'duplicate_scene_flow_link_id')
    linkIds.add(link?.id)
    if (!scenes[link?.from_scene_id] || !scenes[link?.to_scene_id]) {
      pushUnique(errors, 'scene_flow_link_missing_scene')
    }
    if (link?.label != null && typeof link.label !== 'string') pushUnique(errors, 'invalid_scene_flow_link_label')
  }
}

export function validateEditorProject(project) {
  const errors = []
  const warnings = []
  addJsonSafetyErrors(project, errors)

  if (!isPlainObject(project)) {
    pushUnique(errors, 'project_not_object')
    return makeResult(errors, warnings)
  }

  if (project.version !== EDITOR_PROJECT_VERSION) pushUnique(errors, 'unknown_project_version')
  if (!isValidId(project.id)) pushUnique(errors, 'malformed_project_id')
  if (!project.name) pushUnique(errors, 'missing_project_name')
  if (!isPositiveInteger(project.revision)) pushUnique(errors, 'invalid_project_revision')
  if (!isIsoTimestamp(project.created_at)) pushUnique(errors, 'invalid_project_created_at')
  if (!isIsoTimestamp(project.updated_at)) pushUnique(errors, 'invalid_project_updated_at')
  if (!isObjectMap(project.assets)) pushUnique(errors, 'project_assets_not_object')
  if (!isObjectMap(project.scenes)) pushUnique(errors, 'project_scenes_not_object')
  if (!project.scenes?.[project.active_scene_id]) pushUnique(errors, 'missing_active_scene')
  if (!isPositiveInteger(project.settings?.default_snap)) pushUnique(errors, 'invalid_default_snap')
  validatePositiveDimensions(project.settings?.default_viewport, errors, 'invalid_default_viewport')

  for (const [key, asset] of Object.entries(project.assets ?? {})) {
    if (key !== asset?.id) pushUnique(errors, 'asset_key_id_mismatch')
    const result = validateAssetRef(asset)
    for (const error of result.blocking_errors) pushUnique(errors, error)
  }

  for (const [key, scene] of Object.entries(project.scenes ?? {})) {
    if (key !== scene?.id) pushUnique(errors, 'scene_key_id_mismatch')
    const result = validateSceneDocument(scene, { assets: project.assets, scenes: project.scenes })
    for (const error of result.blocking_errors) pushUnique(errors, error)
  }

  validateSceneFlow(project.scene_flow, project.scenes ?? {}, errors)

  const layer_count = Object.values(project.scenes ?? {}).reduce((sum, scene) => sum + (scene.layers?.length ?? 0), 0)
  return makeResult(errors, warnings, {
    asset_count: Object.keys(project.assets ?? {}).length,
    scene_count: Object.keys(project.scenes ?? {}).length,
    layer_count,
  })
}

function allNestedNumbersFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(allNestedNumbersFinite)
  if (isPlainObject(value)) return Object.values(value).every(allNestedNumbersFinite)
  return true
}

export function validateProcessingRecipe(recipe) {
  const errors = []
  const warnings = []
  addJsonSafetyErrors(recipe, errors)

  if (!isPlainObject(recipe)) {
    pushUnique(errors, 'recipe_not_object')
    return makeResult(errors, warnings)
  }

  if (recipe.version !== PROCESSING_RECIPE_VERSION) pushUnique(errors, 'unknown_recipe_version')
  if (!PROCESSING_TARGET_PIPELINES.includes(recipe.target_pipeline)) pushUnique(errors, 'unknown_target_pipeline')
  if (!SOURCE_LAYOUT_IDS.has(recipe.source?.source_layout)) pushUnique(errors, 'unknown_source_layout')
  validatePath(recipe.source?.file_name, errors, 'unsafe_source_file_name')
  validatePath(recipe.source?.black_matte_artifact_ref, errors, 'unsafe_black_matte_artifact_ref')
  if (recipe.source?.source_job_id != null && !isValidJobId(recipe.source.source_job_id)) pushUnique(errors, 'malformed_source_job_id')
  if (recipe.source?.asset_id != null && !isValidId(recipe.source.asset_id)) pushUnique(errors, 'malformed_asset_id')

  if (!BACKGROUND_MODES.includes(recipe.background?.mode)) pushUnique(errors, 'unknown_background_mode')
  if (!isFiniteNumber(recipe.background?.tolerance) || recipe.background.tolerance < 0 || recipe.background.tolerance > 255) {
    pushUnique(errors, 'invalid_background_tolerance')
  }

  if (typeof recipe.cleanup?.component_cleanup !== 'boolean') pushUnique(errors, 'invalid_component_cleanup')
  if (!isFiniteNumber(recipe.cleanup?.min_alpha) || recipe.cleanup.min_alpha < 0 || recipe.cleanup.min_alpha > 255) {
    pushUnique(errors, 'invalid_cleanup_min_alpha')
  }
  if (!isPositiveFiniteNumber(recipe.cleanup?.min_area)) pushUnique(errors, 'invalid_cleanup_min_area')
  if (!isFiniteNumber(recipe.cleanup?.min_area_ratio) || recipe.cleanup.min_area_ratio < 0 || recipe.cleanup.min_area_ratio > 1) {
    pushUnique(errors, 'invalid_cleanup_min_area_ratio')
  }

  const staging = recipe.fixed_region_staging
  if (staging != null) {
    if (typeof staging.enabled !== 'boolean') pushUnique(errors, 'invalid_fixed_region_staging_enabled')
    if (staging.enabled) {
      if (!staging.mode) pushUnique(errors, 'missing_fixed_region_staging_mode')
      if (!isPositiveInteger(staging.stage_size)) pushUnique(errors, 'invalid_fixed_region_stage_size')
      if (!isNonNegativeInteger(staging.crop_right) || !isNonNegativeInteger(staging.crop_bottom)) {
        pushUnique(errors, 'invalid_fixed_region_crop')
      }
      if (!isFiniteNumber(staging.matte_tolerance) || staging.matte_tolerance < 0 || staging.matte_tolerance > 255) {
        pushUnique(errors, 'invalid_fixed_region_matte_tolerance')
      }
    }
  }

  if (!isFiniteNumber(recipe.anchor_offset?.x) || !isFiniteNumber(recipe.anchor_offset?.y)) {
    pushUnique(errors, 'invalid_anchor_offset')
  }
  if (!allNestedNumbersFinite(recipe.frame_adjustments ?? {})) pushUnique(errors, 'invalid_frame_adjustments')
  if (!Array.isArray(recipe.locked_animations) || !recipe.locked_animations.every((id) => typeof id === 'string')) {
    pushUnique(errors, 'invalid_locked_animations')
  }
  if (typeof recipe.correction?.auto_correct !== 'boolean') pushUnique(errors, 'invalid_auto_correct')
  if (typeof recipe.correction?.motion_stabilize !== 'boolean') pushUnique(errors, 'invalid_motion_stabilize')
  if (!isNonNegativeFiniteNumber(recipe.correction?.motion_max_shift)) pushUnique(errors, 'invalid_motion_max_shift')
  if (typeof recipe.pixel_finishing?.enabled !== 'boolean') pushUnique(errors, 'invalid_pixel_finishing_enabled')
  if (!isPositiveInteger(recipe.pixel_finishing?.max_colors) || recipe.pixel_finishing.max_colors > 256) {
    pushUnique(errors, 'invalid_pixel_finishing_max_colors')
  }
  if (typeof recipe.pixel_finishing?.outline !== 'boolean') pushUnique(errors, 'invalid_pixel_finishing_outline')
  if (!OUTLINE_MODES.includes(recipe.pixel_finishing?.outline_mode)) pushUnique(errors, 'unknown_outline_mode')
  if (recipe.style_report != null) {
    if (typeof recipe.style_report.enabled !== 'boolean') pushUnique(errors, 'invalid_style_report_enabled')
    if (!isPositiveInteger(recipe.style_report.max_colors) || recipe.style_report.max_colors > 256) {
      pushUnique(errors, 'invalid_style_report_max_colors')
    }
  }

  const hasLegacyScales = Array.isArray(recipe.outputs?.scales) && recipe.outputs.scales.every(isPositiveInteger)
  const hasFrameSizes = Array.isArray(recipe.outputs?.frame_sizes) && recipe.outputs.frame_sizes.every(isPositiveInteger)
  if (!hasLegacyScales && !hasFrameSizes) pushUnique(errors, 'invalid_output_scales')

  return makeResult(errors, warnings, {
    output_scale_count: hasLegacyScales ? recipe.outputs.scales.length : 0,
    output_frame_size_count: hasFrameSizes ? recipe.outputs.frame_sizes.length : 0,
  })
}

export function validateCharacterWorkbenchRecipe(recipe) {
  const protocol = validateProcessingRecipe(recipe)
  const errors = [...protocol.blocking_errors]
  const warnings = [...protocol.warnings]
  if (recipe?.target_pipeline !== 'character_pack') pushUnique(errors, 'workbench_requires_character_pack')
  if (recipe?.pipeline_contract !== CHARACTER_PROCESSING_CONTRACT) pushUnique(errors, 'unknown_pipeline_contract')
  const implementationRevision = recipe?.implementation_revision
  if (implementationRevision !== null && (typeof implementationRevision !== 'string' || !IMPLEMENTATION_REVISION_PATTERN.test(implementationRevision))) pushUnique(errors, 'invalid_implementation_revision')
  if (!CHARACTER_RECIPE_INPUT_BACKGROUND_MODES.includes(recipe?.background?.mode)) pushUnique(errors, 'unsupported_workbench_background_mode')
  if (!Number.isInteger(recipe?.background?.tolerance) || recipe.background.tolerance < 0 || recipe.background.tolerance > 80) pushUnique(errors, 'invalid_background_tolerance')
  if (!Number.isInteger(recipe?.cleanup?.min_alpha) || recipe.cleanup.min_alpha < 0 || recipe.cleanup.min_alpha > 80) pushUnique(errors, 'invalid_cleanup_min_alpha')
  if (!Number.isInteger(recipe?.cleanup?.min_area) || recipe.cleanup.min_area < 1 || recipe.cleanup.min_area > 64) pushUnique(errors, 'invalid_cleanup_min_area')
  if (!isFiniteNumber(recipe?.cleanup?.min_area_ratio) || recipe.cleanup.min_area_ratio < 0 || recipe.cleanup.min_area_ratio > 0.25) pushUnique(errors, 'invalid_cleanup_min_area_ratio')
  if (!Number.isInteger(recipe?.correction?.motion_max_shift) || recipe.correction.motion_max_shift < 0 || recipe.correction.motion_max_shift > 4) pushUnique(errors, 'invalid_motion_max_shift')
  const staging = recipe?.fixed_region_staging
  if (staging?.enabled !== false || staging?.mode !== null || staging?.stage_size !== null || staging?.crop_right !== null || staging?.crop_bottom !== null || staging?.matte_tolerance !== null) pushUnique(errors, 'workbench_staging_must_be_disabled')
  for (const axis of ['x', 'y']) {
    const value = recipe?.anchor_offset?.[axis]
    if (!Number.isInteger(value) || value < -16 || value > 16) pushUnique(errors, `invalid_anchor_${axis}`)
  }
  if (recipe?.style_report?.enabled !== true) pushUnique(errors, 'style_report_required')
  if (recipe?.pixel_finishing?.enabled === true && recipe?.style_report?.max_colors !== recipe?.pixel_finishing?.max_colors) pushUnique(errors, 'style_report_budget_must_match_pixel_finishing')
  if (JSON.stringify(recipe?.outputs?.frame_sizes) !== JSON.stringify(CHARACTER_REPAIR_OUTPUT_FRAME_SIZES)) pushUnique(errors, 'invalid_output_frame_sizes')
  return makeResult(errors, warnings, { output_frame_size_count: recipe?.outputs?.frame_sizes?.length ?? 0 })
}
