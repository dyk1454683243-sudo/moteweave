import {
  ACTION_TYPES,
} from './constants.js'
import {
  getActiveAssetRevision,
  getAssetClip,
} from './assets.js'
import { layerPivotToTopLeft } from './coordinates.js'
import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isPlainObject,
  isPositiveInteger,
  isSafeRelativePath,
  isValidId,
} from './safety.js'
import { validateEditorProject } from './validation.js'

export const ENGINE_EXPORT_MAPPING_VERSION = 'editor_engine_export_mapping_v1'
export const ENGINE_HANDOFF_MANIFEST_VERSION = 'engine_handoff_manifest_v1'
export const GODOT_SCENE_HANDOFF_VERSION = 'godot_scene_handoff_v1'
export const LDTK_SCENE_HANDOFF_VERSION = 'ldtk_scene_handoff_v1'

const SUPPORTED_ACTIONS = Object.freeze({
  godot: Object.freeze({
    show_text: 'metadata_for_dialogue_runtime',
    play_animation: 'metadata_for_animation_runtime',
    toggle_layer: 'metadata_for_visibility_runtime',
    set_state: 'metadata_for_state_runtime',
    scene_link: 'metadata_for_scene_transition',
  }),
  ldtk: Object.freeze({
    show_text: 'custom_field_metadata',
    scene_link: 'custom_field_metadata',
  }),
})

const UNSUPPORTED_ACTIONS = Object.freeze({
  godot: Object.freeze({
    pickup_item: 'requires_inventory_runtime_contract',
    emit_event: 'reserved_action_not_in_editor_interaction_v0',
    set_flag: 'reserved_action_use_set_state_until_protocol_adds_alias',
  }),
  ldtk: Object.freeze({
    play_animation: 'requires_runtime_animation_script',
    toggle_layer: 'requires_runtime_visibility_script',
    set_state: 'requires_runtime_state_script',
    pickup_item: 'requires_inventory_runtime_contract',
    emit_event: 'reserved_action_not_in_editor_interaction_v0',
    set_flag: 'reserved_action_use_set_state_until_protocol_adds_alias',
  }),
})

export const ENGINE_EXPORT_MAPPING = Object.freeze({
  version: ENGINE_EXPORT_MAPPING_VERSION,
  coordinate_model: Object.freeze({
    origin: 'top_left',
    unit: 'world_pixel',
    x_axis: 'right',
    y_axis: 'down',
    layer_position_semantics: 'position_is_layer_pivot',
    viewport_space: 'not_camera_or_parallax_adjusted',
    rotation: 'degrees_clockwise_in_editor',
    scale: 'positive_axis_scale_with_flip_flags',
  }),
  engines: Object.freeze({
    godot: Object.freeze({
      status: 'preview_review',
      scene_file: 'engines/godot/scene_handoff.json',
      coordinate_mapping: Object.freeze({
        world: 'Node2D global position stores the editor pivot point',
        viewport: 'Canvas/UI metadata stores the editor viewport-space pivot point',
        pivot: 'sprite offset or importer logic compensates from texture top-left to editor pivot',
        anchor: 'character feet anchors are carried from clip metadata and never inferred silently',
        parallax: 'parallax is metadata for future Parallax2D import, not a generated node tree',
        flip: 'flip_x and flip_y remain explicit booleans for importer mapping',
        rotation: 'degrees are recorded; a consumer may convert to radians',
      }),
      supported_actions: SUPPORTED_ACTIONS.godot,
      unsupported_actions: UNSUPPORTED_ACTIONS.godot,
    }),
    ldtk: Object.freeze({
      status: 'preview_review',
      scene_file: 'engines/ldtk/scene_handoff.json',
      coordinate_mapping: Object.freeze({
        world: 'entity px coordinates store the editor pivot point',
        viewport: 'viewport-space UI layers are recorded as unsupported for level placement',
        pivot: 'custom fields retain pivot and top-left offset metadata',
        anchor: 'character feet anchors are carried as custom fields',
        parallax: 'parallax is metadata only and not an auto-layer rule',
        flip: 'flip_x and flip_y remain explicit custom fields',
        rotation: 'degrees are recorded as custom fields',
      }),
      supported_actions: SUPPORTED_ACTIONS.ldtk,
      unsupported_actions: UNSUPPORTED_ACTIONS.ldtk,
    }),
  }),
})

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function unique(values) {
  return [...new Set(values)]
}

function resultFrom(blockingErrors, warnings, metrics = {}) {
  return {
    status: blockingErrors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: unique(blockingErrors),
    warnings: unique(warnings),
    metrics,
  }
}

function supportForAction(engine, actionType) {
  const mapping = ENGINE_EXPORT_MAPPING.engines[engine]
  if (mapping.supported_actions[actionType]) {
    return {
      status: 'supported_metadata',
      mapping: mapping.supported_actions[actionType],
    }
  }
  return {
    status: 'unsupported',
    reason: mapping.unsupported_actions[actionType] ?? 'no_mapping_declared',
  }
}

function artifactSummary(asset) {
  const revision = getActiveAssetRevision(asset)
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    profile: asset.profile ?? null,
    active_revision_id: asset.active_revision_id,
    active_revision: revision
      ? {
          id: revision.id,
          quality_status: revision.quality_status,
          production_status: revision.production_status,
          source_job_id: revision.source_job_id,
          artifacts: clonePlain(revision.artifacts ?? {}),
        }
      : null,
    clip_ids: Object.keys(asset.clips ?? {}),
  }
}

function resolvedPivot(layer, clip) {
  const pivot = layer?.transform?.pivot ?? { mode: 'top_left' }
  if (pivot.mode !== 'artifact_anchor') return clonePlain(pivot)
  return {
    mode: 'artifact_anchor',
    name: pivot.name ?? 'artifact_anchor',
    x: pivot.x ?? clip?.anchor?.x ?? null,
    y: pivot.y ?? clip?.anchor?.y ?? null,
    source: clip?.anchor ? 'clip_anchor' : 'layer_pivot',
  }
}

function layerTransformSummary(layer, asset) {
  const clip = getAssetClip(asset, layer?.clip_id)
  const frameSize = clip?.frame_size ?? null
  const pivot = resolvedPivot(layer, clip)
  const position = clonePlain(layer?.transform?.position ?? { x: 0, y: 0 })
  const scale = clonePlain(layer?.transform?.scale ?? { x: 1, y: 1 })
  const topLeft = frameSize
    ? layerPivotToTopLeft(position, {
        frameSize,
        pivot,
        scale,
        flipX: layer?.transform?.flip_x === true,
        flipY: layer?.transform?.flip_y === true,
      })
    : null
  return {
    coordinate_space: layer?.transform?.coordinate_space ?? 'world',
    pivot_position: position,
    top_left_position: topLeft,
    frame_size: frameSize ? clonePlain(frameSize) : null,
    pivot,
    scale,
    rotation_deg: layer?.transform?.rotation_deg ?? 0,
    flip_x: layer?.transform?.flip_x === true,
    flip_y: layer?.transform?.flip_y === true,
  }
}

function interactionSummary(interaction, owner, unsupportedItems) {
  if (!interaction) return null
  const actions = (interaction.actions ?? []).map((action, index) => {
    const engine_support = {
      godot: supportForAction('godot', action.type),
      ldtk: supportForAction('ldtk', action.type),
    }
    for (const [engine, support] of Object.entries(engine_support)) {
      if (support.status !== 'unsupported') continue
      unsupportedItems.push({
        engine,
        item_type: 'interaction_action',
        scene_id: owner.scene_id,
        owner_type: owner.owner_type,
        owner_id: owner.owner_id,
        action_index: index,
        action_type: action.type,
        reason: support.reason,
        omitted_from: ENGINE_EXPORT_MAPPING.engines[engine].scene_file,
      })
    }
    return {
      index,
      type: action.type,
      payload: clonePlain(action),
      engine_support,
    }
  })
  return {
    version: interaction.version,
    enabled: interaction.enabled,
    trigger: clonePlain(interaction.trigger),
    actions,
  }
}

function layerSummary(project, scene, layer, unsupportedItems) {
  const asset = project.assets?.[layer.asset_id] ?? null
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    asset_id: layer.asset_id,
    asset_kind: asset?.kind ?? null,
    active_revision_id: asset?.active_revision_id ?? null,
    clip_id: layer.clip_id ?? null,
    visible: layer.visible !== false,
    locked: layer.locked === true,
    transform: layerTransformSummary(layer, asset),
    render: clonePlain(layer.render ?? {}),
    playback: layer.playback ? clonePlain(layer.playback) : null,
    interaction: interactionSummary(layer.interaction, {
      scene_id: scene.id,
      owner_type: 'layer',
      owner_id: layer.id,
    }, unsupportedItems),
  }
}

function entitySummary(scene, entity, unsupportedItems) {
  return {
    id: entity.id,
    type: entity.type,
    position: clonePlain(entity.position ?? null),
    interaction: interactionSummary(entity.interaction, {
      scene_id: scene.id,
      owner_type: 'entity',
      owner_id: entity.id,
    }, unsupportedItems),
  }
}

function sceneSummary(project, scene, unsupportedItems) {
  const layers = (scene.layers ?? []).map((layer) => layerSummary(project, scene, layer, unsupportedItems))
  const entities = (scene.entities ?? []).map((entity) => entitySummary(scene, entity, unsupportedItems))
  return {
    id: scene.id,
    name: scene.name,
    world: clonePlain(scene.world),
    viewport: clonePlain(scene.viewport),
    camera: clonePlain(scene.camera),
    background: scene.background,
    state_defaults: clonePlain(scene.state_defaults ?? {}),
    file: `scenes/${scene.id}.json`,
    layers,
    entities,
  }
}

export function buildEngineHandoffManifest(project, { createdAt = new Date() } = {}) {
  const unsupportedItems = []
  const projectValidation = validateEditorProject(project)
  const scenes = Object.values(project.scenes ?? {}).map((scene) => sceneSummary(project, scene, unsupportedItems))
  const assets = Object.values(project.assets ?? {}).map(artifactSummary)
  const validation = resultFrom(
    projectValidation.blocking_errors ?? [],
    [
      ...(projectValidation.warnings ?? []),
      ...(unsupportedItems.length ? ['engine_handoff_contains_unsupported_items'] : []),
    ],
    {
      asset_count: assets.length,
      scene_count: scenes.length,
      layer_count: scenes.reduce((sum, scene) => sum + scene.layers.length, 0),
      entity_count: scenes.reduce((sum, scene) => sum + scene.entities.length, 0),
      unsupported_item_count: unsupportedItems.length,
    }
  )
  return {
    version: ENGINE_HANDOFF_MANIFEST_VERSION,
    mapping_version: ENGINE_EXPORT_MAPPING_VERSION,
    project_id: project.id,
    project_name: project.name,
    project_revision: project.revision,
    created_at: timestamp(createdAt),
    status: validation.status,
    files: {
      godot_scene_handoff: ENGINE_EXPORT_MAPPING.engines.godot.scene_file,
      ldtk_scene_handoff: ENGINE_EXPORT_MAPPING.engines.ldtk.scene_file,
    },
    coordinate_model: clonePlain(ENGINE_EXPORT_MAPPING.coordinate_model),
    capability_profiles: clonePlain(ENGINE_EXPORT_MAPPING.engines),
    assets,
    scenes,
    scene_flow: clonePlain(project.scene_flow ?? { nodes: {}, links: [] }),
    unsupported_items: unsupportedItems,
    validation,
  }
}

function handoffStatus(unsupportedItems) {
  return unsupportedItems.length ? 'warning' : 'pass'
}

function godotLayerNode(layer) {
  const isViewport = layer.transform.coordinate_space === 'viewport'
  return {
    name: layer.id,
    node_type: isViewport ? 'ControlMetadata' : 'Node2DMetadata',
    layer_id: layer.id,
    layer_type: layer.type,
    asset_id: layer.asset_id,
    asset_kind: layer.asset_kind,
    active_revision_id: layer.active_revision_id,
    clip_id: layer.clip_id,
    visible: layer.visible,
    transform: {
      position: clonePlain(layer.transform.pivot_position),
      coordinate_space: layer.transform.coordinate_space,
      scale: clonePlain(layer.transform.scale),
      rotation_degrees: layer.transform.rotation_deg,
      pivot: clonePlain(layer.transform.pivot),
      frame_size: clonePlain(layer.transform.frame_size),
      top_left_position: clonePlain(layer.transform.top_left_position),
      flip_x: layer.transform.flip_x,
      flip_y: layer.transform.flip_y,
    },
    render: clonePlain(layer.render),
    playback: clonePlain(layer.playback),
    interaction_metadata: layer.interaction ? clonePlain(layer.interaction) : null,
  }
}

export function buildGodotSceneHandoff(manifest) {
  const unsupportedItems = (manifest.unsupported_items ?? []).filter((item) => item.engine === 'godot')
  return {
    version: GODOT_SCENE_HANDOFF_VERSION,
    source_manifest_version: manifest.version,
    project_id: manifest.project_id,
    project_revision: manifest.project_revision,
    status: handoffStatus(unsupportedItems),
    claim_boundary: 'preview_metadata_only_no_godot_plugin_or_scene_file_generated',
    coordinate_mapping: clonePlain(ENGINE_EXPORT_MAPPING.engines.godot.coordinate_mapping),
    scenes: (manifest.scenes ?? []).map((scene) => ({
      id: scene.id,
      name: scene.name,
      root_node: {
        name: scene.id,
        node_type: 'Node2D',
        world: clonePlain(scene.world),
        viewport: clonePlain(scene.viewport),
        background: scene.background,
      },
      nodes: scene.layers
        .filter((layer) => layer.transform.coordinate_space !== 'viewport')
        .map(godotLayerNode),
      ui_nodes: scene.layers
        .filter((layer) => layer.transform.coordinate_space === 'viewport')
        .map(godotLayerNode),
      entity_nodes: scene.entities.map((entity) => ({
        name: entity.id,
        node_type: `${entity.type}_metadata`,
        entity_id: entity.id,
        entity_type: entity.type,
        position: clonePlain(entity.position),
        interaction_metadata: entity.interaction ? clonePlain(entity.interaction) : null,
      })),
    })),
    unsupported_items: unsupportedItems,
  }
}

function supportedLdtkActions(interaction) {
  if (!interaction) return []
  return interaction.actions
    .filter((action) => action.engine_support?.ldtk?.status !== 'unsupported')
    .map((action) => ({
      index: action.index,
      type: action.type,
      payload: clonePlain(action.payload),
      mapping: action.engine_support.ldtk.mapping,
    }))
}

function ldtkLayerEntity(layer) {
  return {
    identifier: layer.id,
    entity_type: `Editor${layer.type[0].toUpperCase()}${layer.type.slice(1)}`,
    asset_id: layer.asset_id,
    asset_kind: layer.asset_kind,
    active_revision_id: layer.active_revision_id,
    px: clonePlain(layer.transform.pivot_position),
    custom_fields: {
      editor_layer_id: layer.id,
      editor_layer_type: layer.type,
      coordinate_space: layer.transform.coordinate_space,
      clip_id: layer.clip_id,
      pivot: clonePlain(layer.transform.pivot),
      frame_size: clonePlain(layer.transform.frame_size),
      top_left_position: clonePlain(layer.transform.top_left_position),
      scale: clonePlain(layer.transform.scale),
      rotation_deg: layer.transform.rotation_deg,
      flip_x: layer.transform.flip_x,
      flip_y: layer.transform.flip_y,
      parallax: layer.render?.parallax ?? 1,
      z_index: layer.render?.z_index ?? 0,
      playback: clonePlain(layer.playback),
      actions: supportedLdtkActions(layer.interaction),
    },
  }
}

export function buildLdtkSceneHandoff(manifest) {
  const unsupportedItems = (manifest.unsupported_items ?? []).filter((item) => item.engine === 'ldtk')
  return {
    version: LDTK_SCENE_HANDOFF_VERSION,
    source_manifest_version: manifest.version,
    project_id: manifest.project_id,
    project_revision: manifest.project_revision,
    status: handoffStatus(unsupportedItems),
    claim_boundary: 'single_level_preview_metadata_not_complete_ldtk_world_export',
    existing_scene_pack_payload_policy: 'preserve_existing_scene_pack_ldtk_payloads',
    coordinate_mapping: clonePlain(ENGINE_EXPORT_MAPPING.engines.ldtk.coordinate_mapping),
    levels: (manifest.scenes ?? []).map((scene) => ({
      identifier: scene.id,
      px_wid: scene.world?.w,
      px_hei: scene.world?.h,
      bg_color: scene.background,
      layer_instances: [
        {
          identifier: 'EditorEntities',
          layer_type: 'Entities',
          entity_instances: [
            ...scene.layers
              .filter((layer) => layer.transform.coordinate_space === 'world')
              .map(ldtkLayerEntity),
            ...scene.entities.map((entity) => ({
              identifier: entity.id,
              entity_type: `Editor${entity.type[0].toUpperCase()}${entity.type.slice(1)}`,
              px: clonePlain(entity.position),
              custom_fields: {
                editor_entity_id: entity.id,
                editor_entity_type: entity.type,
                actions: supportedLdtkActions(entity.interaction),
              },
            })),
          ],
        },
      ],
      omitted_layers: scene.layers
        .filter((layer) => layer.transform.coordinate_space !== 'world')
        .map((layer) => ({
          layer_id: layer.id,
          reason: 'viewport_space_layer_not_exported_to_ldtk_level_entities',
        })),
    })),
    unsupported_items: unsupportedItems,
  }
}

export function validateEngineHandoffManifest(manifest) {
  const errors = []
  const warnings = []
  if (findBase64PayloadPaths(manifest).length) errors.push('embedded_base64_payload')
  if (findSecretLikePaths(manifest).length) errors.push('secret_like_field')
  if (!isPlainObject(manifest)) {
    return resultFrom(['manifest_not_object'], [], {})
  }
  if (manifest.version !== ENGINE_HANDOFF_MANIFEST_VERSION) errors.push('unknown_engine_handoff_manifest_version')
  if (!isValidId(manifest.project_id)) errors.push('malformed_project_id')
  if (!isPositiveInteger(manifest.project_revision)) errors.push('invalid_project_revision')
  if (!Array.isArray(manifest.assets)) errors.push('manifest_assets_not_array')
  if (!Array.isArray(manifest.scenes)) errors.push('manifest_scenes_not_array')
  if (!Array.isArray(manifest.unsupported_items)) errors.push('manifest_unsupported_items_not_array')
  if (manifest.unsupported_items?.length) warnings.push('engine_handoff_contains_unsupported_items')

  const assetIds = new Set()
  for (const asset of manifest.assets ?? []) {
    if (!isValidId(asset?.id)) errors.push('malformed_manifest_asset_id')
    if (assetIds.has(asset?.id)) errors.push('duplicate_manifest_asset_id')
    assetIds.add(asset?.id)
    for (const artifactPath of Object.values(asset?.active_revision?.artifacts ?? {})) {
      if (!isSafeRelativePath(artifactPath)) errors.push('unsafe_manifest_artifact_path')
    }
  }

  const sceneIds = new Set()
  let layerCount = 0
  let entityCount = 0
  for (const scene of manifest.scenes ?? []) {
    if (!isValidId(scene?.id)) errors.push('malformed_manifest_scene_id')
    if (sceneIds.has(scene?.id)) errors.push('duplicate_manifest_scene_id')
    sceneIds.add(scene?.id)
    const layerIds = new Set()
    for (const layer of scene?.layers ?? []) {
      layerCount += 1
      if (!isValidId(layer?.id)) errors.push('malformed_manifest_layer_id')
      if (layerIds.has(layer?.id)) errors.push('duplicate_manifest_layer_id')
      layerIds.add(layer?.id)
      if (layer.asset_id && !assetIds.has(layer.asset_id)) errors.push('missing_manifest_layer_asset')
    }
    for (const entity of scene?.entities ?? []) {
      entityCount += 1
      if (!isValidId(entity?.id)) errors.push('malformed_manifest_entity_id')
    }
  }

  for (const link of manifest.scene_flow?.links ?? []) {
    if (!sceneIds.has(link.from_scene_id) || !sceneIds.has(link.to_scene_id)) {
      errors.push('manifest_scene_flow_link_missing_scene')
    }
  }

  return resultFrom(errors, warnings, {
    asset_count: assetIds.size,
    scene_count: sceneIds.size,
    layer_count: layerCount,
    entity_count: entityCount,
    unsupported_item_count: manifest.unsupported_items?.length ?? 0,
  })
}

export function listEngineActionMappings() {
  return ACTION_TYPES.reduce((mappings, actionType) => ({
    ...mappings,
    [actionType]: {
      godot: supportForAction('godot', actionType),
      ldtk: supportForAction('ldtk', actionType),
    },
  }), {
    emit_event: {
      godot: supportForAction('godot', 'emit_event'),
      ldtk: supportForAction('ldtk', 'emit_event'),
    },
    set_flag: {
      godot: supportForAction('godot', 'set_flag'),
      ldtk: supportForAction('ldtk', 'set_flag'),
    },
  })
}
