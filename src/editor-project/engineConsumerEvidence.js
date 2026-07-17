import {
  ENGINE_HANDOFF_MANIFEST_VERSION,
  GODOT_SCENE_HANDOFF_VERSION,
  LDTK_SCENE_HANDOFF_VERSION,
} from './engineHandoff.js'
import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isPlainObject,
  isSafeRelativePath,
} from './safety.js'

export const ENGINE_CONSUMER_VALIDATION_VERSION = 'engine_consumer_validation_v1'
export const ENGINE_EXPORT_REVIEW_STATUS_VERSION = 'engine_export_review_status_v1'
export const ENGINE_MANUAL_IMPORT_EVIDENCE_VERSION = 'engine_manual_import_evidence_v1'

const GODOT_CLAIM_BOUNDARY = 'preview_metadata_only_no_godot_plugin_or_scene_file_generated'
const LDTK_CLAIM_BOUNDARY = 'single_level_preview_metadata_not_complete_ldtk_world_export'
const REVIEW_CLAIM_BOUNDARY = 'preview_metadata_only_no_engine_native_scene_files_generated'

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function resultFrom(blockingErrors, warnings, metrics = {}) {
  const blocking = unique(blockingErrors)
  const advisory = unique(warnings)
  return {
    status: blocking.length ? 'fail' : advisory.length ? 'warning' : 'pass',
    blocking_errors: blocking,
    warnings: advisory,
    metrics,
  }
}

function byId(items, key = 'id') {
  return new Map((items ?? []).map((item) => [item?.[key], item]))
}

function signatureUnsupportedItem(item) {
  return [
    item?.engine,
    item?.scene_id,
    item?.owner_type,
    item?.owner_id,
    item?.action_index,
    item?.action_type,
    item?.omitted_from,
  ].join('|')
}

function compareSets({
  expected,
  actual,
  missingCode,
  extraCode,
  errors,
}) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  for (const value of expectedSet) {
    if (!actualSet.has(value)) errors.push(`${missingCode}:${value}`)
  }
  for (const value of actualSet) {
    if (!expectedSet.has(value)) errors.push(`${extraCode}:${value}`)
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key)
}

function validateJsonSafety(label, value, errors) {
  if (findBase64PayloadPaths(value).length) errors.push(`${label}_contains_base64_payload`)
  if (findSecretLikePaths(value).length) errors.push(`${label}_contains_secret_like_field`)
}

function validateUnsupportedItems({ engine, manifest, handoff, errors }) {
  const expected = (manifest.unsupported_items ?? [])
    .filter((item) => item.engine === engine)
    .map(signatureUnsupportedItem)
  const actual = (handoff.unsupported_items ?? []).map(signatureUnsupportedItem)
  compareSets({
    expected,
    actual,
    missingCode: `${engine}_handoff_missing_unsupported_item`,
    extraCode: `${engine}_handoff_extra_unsupported_item`,
    errors,
  })
}

function validateGodotSceneHandoff(manifest, godot) {
  const errors = []
  const warnings = []
  validateJsonSafety('godot_scene_handoff', godot, errors)
  if (!isPlainObject(godot)) {
    return resultFrom(['godot_scene_handoff_not_object'], [], {})
  }
  if (godot.version !== GODOT_SCENE_HANDOFF_VERSION) errors.push('godot_unknown_scene_handoff_version')
  if (godot.source_manifest_version !== ENGINE_HANDOFF_MANIFEST_VERSION) errors.push('godot_source_manifest_version_mismatch')
  if (godot.project_id !== manifest.project_id) errors.push('godot_project_id_mismatch')
  if (godot.project_revision !== manifest.project_revision) errors.push('godot_project_revision_mismatch')
  if (godot.claim_boundary !== GODOT_CLAIM_BOUNDARY) errors.push('godot_claim_boundary_mismatch')
  if (!Array.isArray(godot.scenes)) errors.push('godot_scenes_not_array')
  if (!Array.isArray(godot.unsupported_items)) errors.push('godot_unsupported_items_not_array')
  validateUnsupportedItems({ engine: 'godot', manifest, handoff: godot, errors })

  const expectedScenes = byId(manifest.scenes ?? [])
  const actualScenes = byId(godot.scenes ?? [])
  compareSets({
    expected: [...expectedScenes.keys()],
    actual: [...actualScenes.keys()],
    missingCode: 'godot_missing_scene',
    extraCode: 'godot_extra_scene',
    errors,
  })

  let nodeCount = 0
  let uiNodeCount = 0
  let entityNodeCount = 0
  for (const [sceneId, scene] of expectedScenes) {
    const actualScene = actualScenes.get(sceneId)
    if (!actualScene) continue
    const worldLayers = (scene.layers ?? []).filter((layer) => layer.transform?.coordinate_space !== 'viewport')
    const viewportLayers = (scene.layers ?? []).filter((layer) => layer.transform?.coordinate_space === 'viewport')
    const nodeIds = (actualScene.nodes ?? []).map((node) => node.layer_id)
    const uiNodeIds = (actualScene.ui_nodes ?? []).map((node) => node.layer_id)
    const entityIds = (actualScene.entity_nodes ?? []).map((node) => node.entity_id)
    nodeCount += nodeIds.length
    uiNodeCount += uiNodeIds.length
    entityNodeCount += entityIds.length
    compareSets({
      expected: worldLayers.map((layer) => layer.id),
      actual: nodeIds,
      missingCode: `godot_missing_world_layer:${sceneId}`,
      extraCode: `godot_extra_world_layer:${sceneId}`,
      errors,
    })
    compareSets({
      expected: viewportLayers.map((layer) => layer.id),
      actual: uiNodeIds,
      missingCode: `godot_missing_viewport_layer:${sceneId}`,
      extraCode: `godot_extra_viewport_layer:${sceneId}`,
      errors,
    })
    compareSets({
      expected: (scene.entities ?? []).map((entity) => entity.id),
      actual: entityIds,
      missingCode: `godot_missing_entity:${sceneId}`,
      extraCode: `godot_extra_entity:${sceneId}`,
      errors,
    })
    for (const node of [...(actualScene.nodes ?? []), ...(actualScene.ui_nodes ?? [])]) {
      const layer = (scene.layers ?? []).find((item) => item.id === node.layer_id)
      if (!layer) continue
      if (JSON.stringify(node.transform?.position) !== JSON.stringify(layer.transform?.pivot_position)) {
        errors.push(`godot_layer_position_mismatch:${sceneId}:${layer.id}`)
      }
      for (const key of ['pivot', 'frame_size', 'top_left_position', 'flip_x', 'flip_y']) {
        if (!hasOwn(node.transform, key)) errors.push(`godot_layer_missing_transform_field:${sceneId}:${layer.id}:${key}`)
      }
    }
  }

  if ((godot.unsupported_items ?? []).length) warnings.push('godot_preview_has_unsupported_items')
  return resultFrom(errors, warnings, {
    scene_count: actualScenes.size,
    node_count: nodeCount,
    ui_node_count: uiNodeCount,
    entity_node_count: entityNodeCount,
    unsupported_item_count: godot.unsupported_items?.length ?? 0,
  })
}

function ldtkEntityInstances(level) {
  return (level?.layer_instances ?? []).flatMap((layer) => layer.entity_instances ?? [])
}

function validateLdtkSceneHandoff(manifest, ldtk) {
  const errors = []
  const warnings = []
  validateJsonSafety('ldtk_scene_handoff', ldtk, errors)
  if (!isPlainObject(ldtk)) {
    return resultFrom(['ldtk_scene_handoff_not_object'], [], {})
  }
  if (ldtk.version !== LDTK_SCENE_HANDOFF_VERSION) errors.push('ldtk_unknown_scene_handoff_version')
  if (ldtk.source_manifest_version !== ENGINE_HANDOFF_MANIFEST_VERSION) errors.push('ldtk_source_manifest_version_mismatch')
  if (ldtk.project_id !== manifest.project_id) errors.push('ldtk_project_id_mismatch')
  if (ldtk.project_revision !== manifest.project_revision) errors.push('ldtk_project_revision_mismatch')
  if (ldtk.claim_boundary !== LDTK_CLAIM_BOUNDARY) errors.push('ldtk_claim_boundary_mismatch')
  if (!Array.isArray(ldtk.levels)) errors.push('ldtk_levels_not_array')
  if (!Array.isArray(ldtk.unsupported_items)) errors.push('ldtk_unsupported_items_not_array')
  validateUnsupportedItems({ engine: 'ldtk', manifest, handoff: ldtk, errors })

  const expectedScenes = byId(manifest.scenes ?? [])
  const actualLevels = byId(ldtk.levels ?? [], 'identifier')
  compareSets({
    expected: [...expectedScenes.keys()],
    actual: [...actualLevels.keys()],
    missingCode: 'ldtk_missing_level',
    extraCode: 'ldtk_extra_level',
    errors,
  })

  let entityInstanceCount = 0
  let omittedLayerCount = 0
  for (const [sceneId, scene] of expectedScenes) {
    const level = actualLevels.get(sceneId)
    if (!level) continue
    const instances = ldtkEntityInstances(level)
    entityInstanceCount += instances.length
    const omittedLayerIds = (level.omitted_layers ?? []).map((item) => item.layer_id)
    omittedLayerCount += omittedLayerIds.length
    const expectedWorldLayerIds = (scene.layers ?? [])
      .filter((layer) => layer.transform?.coordinate_space === 'world')
      .map((layer) => layer.id)
    const expectedEntityIds = (scene.entities ?? []).map((entity) => entity.id)
    const actualWorldLayerIds = instances
      .filter((instance) => instance.custom_fields?.editor_layer_id)
      .map((instance) => instance.custom_fields.editor_layer_id)
    const actualEntityIds = instances
      .filter((instance) => instance.custom_fields?.editor_entity_id)
      .map((instance) => instance.custom_fields.editor_entity_id)
    compareSets({
      expected: expectedWorldLayerIds,
      actual: actualWorldLayerIds,
      missingCode: `ldtk_missing_world_layer:${sceneId}`,
      extraCode: `ldtk_extra_world_layer:${sceneId}`,
      errors,
    })
    compareSets({
      expected: expectedEntityIds,
      actual: actualEntityIds,
      missingCode: `ldtk_missing_entity:${sceneId}`,
      extraCode: `ldtk_extra_entity:${sceneId}`,
      errors,
    })
    compareSets({
      expected: (scene.layers ?? []).filter((layer) => layer.transform?.coordinate_space !== 'world').map((layer) => layer.id),
      actual: omittedLayerIds,
      missingCode: `ldtk_missing_omitted_layer:${sceneId}`,
      extraCode: `ldtk_extra_omitted_layer:${sceneId}`,
      errors,
    })
    for (const instance of instances.filter((item) => item.custom_fields?.editor_layer_id)) {
      const layerId = instance.custom_fields.editor_layer_id
      const fields = instance.custom_fields ?? {}
      for (const key of ['pivot', 'frame_size', 'top_left_position', 'flip_x', 'flip_y', 'parallax', 'z_index', 'playback', 'actions']) {
        if (!hasOwn(fields, key)) errors.push(`ldtk_layer_missing_custom_field:${sceneId}:${layerId}:${key}`)
      }
    }
  }

  if ((ldtk.unsupported_items ?? []).length) warnings.push('ldtk_preview_has_unsupported_items')
  return resultFrom(errors, warnings, {
    level_count: actualLevels.size,
    entity_instance_count: entityInstanceCount,
    omitted_layer_count: omittedLayerCount,
    unsupported_item_count: ldtk.unsupported_items?.length ?? 0,
  })
}

function validateEnginePayloads(enginePayloads) {
  const errors = []
  const warnings = []
  validateJsonSafety('engine_payloads', enginePayloads, errors)
  if (!isPlainObject(enginePayloads)) {
    return resultFrom(['engine_payloads_not_object'], [], {})
  }
  if (enginePayloads.policy !== 'reference_existing_supported_payloads_only') {
    errors.push('engine_payload_policy_mismatch')
  }
  for (const payload of enginePayloads.payloads ?? []) {
    if (!isSafeRelativePath(payload.pack_path)) errors.push(`unsafe_engine_payload_pack_path:${payload.asset_id}:${payload.artifact_key}`)
    if (payload.included !== true) warnings.push(`engine_payload_not_included:${payload.asset_id}:${payload.artifact_key}`)
  }
  return resultFrom(errors, warnings, {
    payload_count: enginePayloads.payloads?.length ?? 0,
    supported_engine_count: enginePayloads.supported_engines?.length ?? 0,
  })
}

export function buildEngineConsumerValidation({
  manifest,
  godotSceneHandoff,
  ldtkSceneHandoff,
  enginePayloads,
  createdAt = new Date(),
} = {}) {
  const errors = []
  const warnings = []
  validateJsonSafety('engine_handoff_manifest', manifest, errors)
  if (!isPlainObject(manifest)) errors.push('engine_handoff_manifest_not_object')
  if (manifest?.version !== ENGINE_HANDOFF_MANIFEST_VERSION) errors.push('engine_handoff_manifest_version_mismatch')

  const godot = validateGodotSceneHandoff(manifest ?? {}, godotSceneHandoff)
  const ldtk = validateLdtkSceneHandoff(manifest ?? {}, ldtkSceneHandoff)
  const payloads = validateEnginePayloads(enginePayloads)
  for (const error of [...godot.blocking_errors, ...ldtk.blocking_errors, ...payloads.blocking_errors]) errors.push(error)
  for (const warning of [...godot.warnings, ...ldtk.warnings, ...payloads.warnings]) warnings.push(warning)

  const unsupportedItemCount = manifest?.unsupported_items?.length ?? 0
  if (unsupportedItemCount) warnings.push('engine_consumer_unsupported_items_present')

  return {
    version: ENGINE_CONSUMER_VALIDATION_VERSION,
    project_id: manifest?.project_id ?? null,
    project_revision: manifest?.project_revision ?? null,
    created_at: timestamp(createdAt),
    claim_boundary: REVIEW_CLAIM_BOUNDARY,
    ...resultFrom(errors, warnings, {
      scene_count: manifest?.scenes?.length ?? 0,
      asset_count: manifest?.assets?.length ?? 0,
      engine_payload_count: enginePayloads?.payloads?.length ?? 0,
      unsupported_item_count: unsupportedItemCount,
    }),
    engines: {
      godot,
      ldtk,
    },
    engine_payloads: payloads,
  }
}

export function buildEngineExportReviewStatus({
  validationStatus,
  consumerValidation,
  unsupportedItemCount = 0,
} = {}) {
  const validation = validationStatus ?? 'unknown'
  const consumer = consumerValidation?.status ?? 'unknown'
  const hasFailure = validation === 'fail' || consumer === 'fail'
  const hasWarning = validation === 'warning' || consumer === 'warning' || unsupportedItemCount > 0
  const flags = ['preview_metadata_only']
  if (unsupportedItemCount > 0) flags.push('unsupported_items_present')
  return {
    version: ENGINE_EXPORT_REVIEW_STATUS_VERSION,
    status: hasFailure ? 'fail' : hasWarning ? 'warning' : 'pass',
    validation_status: validation,
    consumer_validation_status: consumer,
    consumer_readiness: 'preview_metadata_only',
    unsupported_items_status: unsupportedItemCount > 0 ? 'unsupported_items_present' : 'pass',
    unsupported_item_count: unsupportedItemCount,
    flags,
    manual_review_required: true,
    claim_boundary: REVIEW_CLAIM_BOUNDARY,
  }
}

export function buildEngineManualImportEvidence({
  manifest,
  godotSceneHandoff,
  ldtkSceneHandoff,
  enginePayloads,
  consumerValidation,
  reviewStatus,
  files,
  createdAt = new Date(),
} = {}) {
  return {
    version: ENGINE_MANUAL_IMPORT_EVIDENCE_VERSION,
    project_id: manifest.project_id,
    project_name: manifest.project_name,
    project_revision: manifest.project_revision,
    created_at: timestamp(createdAt),
    review_status: clonePlain(reviewStatus),
    claim_boundary: REVIEW_CLAIM_BOUNDARY,
    required_artifacts: [
      {
        path: files.engineHandoffManifest,
        purpose: 'Neutral engine handoff manifest',
        validation_status: consumerValidation.status,
      },
      {
        path: files.godotSceneHandoff,
        purpose: 'Godot-oriented preview metadata',
        validation_status: consumerValidation.engines.godot.status,
      },
      {
        path: files.ldtkSceneHandoff,
        purpose: 'LDtk-oriented single-level preview metadata',
        validation_status: consumerValidation.engines.ldtk.status,
      },
      {
        path: files.engineConsumerValidation,
        purpose: 'Static consumer validation report',
        validation_status: consumerValidation.status,
      },
      {
        path: files.manualImportChecklist,
        purpose: 'Manual consumer review checklist',
        validation_status: 'review_required',
      },
    ],
    engines: {
      godot: {
        handoff_path: files.godotSceneHandoff,
        claim_boundary: godotSceneHandoff.claim_boundary,
        static_validation_status: consumerValidation.engines.godot.status,
        manual_review_goal: 'Use metadata to recreate one scene manually or to design a future importer; do not treat this as a generated scene file.',
      },
      ldtk: {
        handoff_path: files.ldtkSceneHandoff,
        claim_boundary: ldtkSceneHandoff.claim_boundary,
        static_validation_status: consumerValidation.engines.ldtk.status,
        manual_review_goal: 'Use metadata to recreate one level manually or to design a future importer; do not treat this as complete world export.',
      },
    },
    payload_summary: {
      policy: enginePayloads.policy,
      supported_engines: [...(enginePayloads.supported_engines ?? [])],
      payload_count: enginePayloads.payloads?.length ?? 0,
      payloads: (enginePayloads.payloads ?? []).map((payload) => ({
        engine: payload.engine,
        payload_type: payload.payload_type,
        asset_id: payload.asset_id,
        revision_id: payload.revision_id,
        pack_path: payload.pack_path,
        included: payload.included,
      })),
    },
    stop_rules: [
      'Do not add copied engine plugin code, templates, binaries, or generated native scene files during review.',
      'Do not claim production-ready engine-native scenes from preview metadata.',
      'Record unsupported items as future importer/runtime requirements instead of editing them out.',
      'Keep legacy project-pack and copied engine payload behavior unchanged.',
    ],
    manual_result_template: {
      reviewer: '',
      reviewed_at: '',
      godot_result: 'not_run',
      ldtk_result: 'not_run',
      missing_importer_requirements: [],
      notes: '',
    },
  }
}

export function buildEngineManualImportChecklist(evidence) {
  const lines = [
    '# Engine Consumer Manual Import Checklist',
    '',
    `Project: ${evidence.project_id} / rev ${evidence.project_revision}`,
    `Review status: ${evidence.review_status.status}`,
    `Consumer readiness: ${evidence.review_status.consumer_readiness}`,
    `Unsupported items: ${evidence.review_status.unsupported_items_status}`,
    '',
    '## Stop Rules',
    '',
    ...evidence.stop_rules.map((rule) => `- [ ] ${rule}`),
    '',
    '## Static Evidence',
    '',
    ...evidence.required_artifacts.map((artifact) => `- [ ] ${artifact.path} is present and matches ${artifact.validation_status}.`),
    '',
    '## Godot Preview Metadata',
    '',
    `- [ ] Open ${evidence.engines.godot.handoff_path}.`,
    '- [ ] Confirm the claim boundary is preview metadata only.',
    '- [ ] Confirm world layers, UI layers, entities, pivots, top-left positions, flip flags, playback, and supported interactions are visible as metadata.',
    '- [ ] Record missing importer or runtime requirements as follow-up work.',
    '',
    '## LDtk Preview Metadata',
    '',
    `- [ ] Open ${evidence.engines.ldtk.handoff_path}.`,
    '- [ ] Confirm the claim boundary says this is not a complete world export.',
    '- [ ] Confirm levels, entity metadata, omitted viewport layers, custom fields, and supported actions are visible.',
    '- [ ] Record missing importer or runtime requirements as follow-up work.',
    '',
    '## Result',
    '',
    '- Reviewer:',
    '- Reviewed at:',
    '- Godot result: not_run / pass / warning / blocked',
    '- LDtk result: not_run / pass / warning / blocked',
    '- Missing importer requirements:',
    '- Notes:',
    '',
  ]
  return lines.join('\n')
}
