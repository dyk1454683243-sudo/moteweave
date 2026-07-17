import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultCharacterProcessingRecipe,
  createDefaultEditorProject,
  createInteractionDocument,
  createLayerDocument,
  getActiveAssetRevision,
  getAssetClip,
  migrateEditorProject,
  recipeToCharacterProcessingOptions,
  roundTripEditorProject,
  serializeEditorProject,
  validateAssetRef,
  validateEditorProject,
  validateInteractionDocument,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeCharacterAsset(overrides = {}) {
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_hero',
    createdAt: timestamp,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      sheet: 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png',
      animations: 'workspace/projects/project_demo/assets/asset_hero/rev_001/animations.json',
      metadata: 'workspace/projects/project_demo/assets/asset_hero/rev_001/metadata.json',
      editor_metadata: 'workspace/projects/project_demo/assets/asset_hero/rev_001/editor_metadata.json',
      debug_report: 'workspace/projects/project_demo/assets/asset_hero/rev_001/debug_report.json',
    },
    ...overrides.revision,
  })

  return createAssetRef({
    id: 'asset_hero',
    kind: 'character_pack',
    name: 'Hero',
    profile: 'topdown_rpg_v0',
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
    clips: {
      walk_down: {
        id: 'walk_down',
        source: 'animations.json',
        frames: [0, 1, 2, 3],
        fps: 8,
        loop_mode: 'loop',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
    },
    ...overrides.asset,
  })
}

function makeProjectWithCharacterLayer() {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const asset = makeCharacterAsset()
  project.assets[asset.id] = asset
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_hero',
    name: 'Hero',
    type: 'character',
    assetId: asset.id,
    clipId: 'walk_down',
    transform: {
      position: { x: 640, y: 480 },
      scale: { x: 2, y: 2 },
      rotation_deg: 0,
      pivot: { mode: 'artifact_anchor', name: 'feet', x: null, y: null },
      coordinate_space: 'world',
      flip_x: false,
      flip_y: false,
    },
    render: { z_index: 20, opacity: 1, parallax: 1, blend_mode: 'normal' },
    playback: {
      activation: 'auto',
      loop_mode: 'loop',
      rate: 1,
      start_offset_ms: 0,
      initially_paused: false,
    },
  }))
  return project
}

test('default editor project validates and round-trips without mutating input', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const result = validateEditorProject(project)

  assert.equal(result.status, 'pass')
  assert.deepEqual(result.blocking_errors, [])
  assert.equal(result.metrics.scene_count, 1)

  const json = serializeEditorProject(project)
  assert.equal(json.endsWith('\n'), true)
  assert.deepEqual(roundTripEditorProject(project), project)
})

test('migration is an identity migration for editor_project_v0 with diagnostics', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const migrated = migrateEditorProject(project)

  assert.deepEqual(migrated.project, project)
  assert.deepEqual(migrated.diagnostics, {
    original_version: 'editor_project_v0',
    target_version: 'editor_project_v0',
    migrated: false,
    blocking_errors: [],
  })

  const unknown = migrateEditorProject({ version: 'future_project_v1' })
  assert.equal(unknown.project, null)
  assert.deepEqual(unknown.diagnostics.blocking_errors, ['unknown_project_version'])
})

test('asset reference helpers resolve active revisions and clips', () => {
  const asset = makeCharacterAsset()
  const result = validateAssetRef(asset)

  assert.equal(result.status, 'pass')
  assert.equal(getActiveAssetRevision(asset).id, 'rev_001')
  assert.deepEqual(getAssetClip(asset, 'walk_down').frames, [0, 1, 2, 3])
})

test('project validation rejects unsafe paths, map mismatches, and dangling references', () => {
  const project = makeProjectWithCharacterLayer()
  project.assets.asset_hero.revisions.rev_001.artifacts.sheet = '../outside.png'
  project.scenes.scene_main.layers.push({
    ...project.scenes.scene_main.layers[0],
    id: 'layer_missing',
    asset_id: 'asset_missing',
  })
  project.scene_flow.links.push({
    id: 'link_missing',
    from_scene_id: 'scene_main',
    to_scene_id: 'scene_missing',
    label: 'Door',
  })

  const result = validateEditorProject(project)
  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('unsafe_artifact_path'))
  assert.ok(result.blocking_errors.includes('missing_layer_asset'))
  assert.ok(result.blocking_errors.includes('scene_flow_link_missing_scene'))

  const mismatched = makeProjectWithCharacterLayer()
  mismatched.assets.asset_wrong = mismatched.assets.asset_hero
  delete mismatched.assets.asset_hero
  const mismatchResult = validateEditorProject(mismatched)
  assert.ok(mismatchResult.blocking_errors.includes('asset_key_id_mismatch'))
  assert.ok(mismatchResult.blocking_errors.includes('missing_layer_asset'))
})

test('project validation catches duplicate scene-local ids and missing clips', () => {
  const project = makeProjectWithCharacterLayer()
  project.scenes.scene_main.layers.push({
    ...project.scenes.scene_main.layers[0],
    clip_id: 'missing_clip',
  })

  const result = validateEditorProject(project)
  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('duplicate_layer_id'))
  assert.ok(result.blocking_errors.includes('missing_layer_clip'))
})

test('interaction validation checks owner zones, action targets, and scene-link ordering', () => {
  const project = makeProjectWithCharacterLayer()
  project.scenes.scene_room = {
    ...project.scenes.scene_main,
    id: 'scene_room',
    name: 'Room',
    layers: [],
    entities: [{ id: 'spawn_room', type: 'spawn_point', position: { x: 24, y: 32 } }],
  }
  const context = {
    assets: project.assets,
    scenes: project.scenes,
    layersById: new Map(project.scenes.scene_main.layers.map((layer) => [layer.id, layer])),
    entitiesById: new Map(project.scenes.scene_main.entities.map((entity) => [entity.id, entity])),
    visualOwner: true,
  }

  const valid = createInteractionDocument({
    trigger: {
      type: 'near_key',
      key: 'KeyE',
      radius: 96,
      zone: { coordinate_space: 'owner_local', x: -16, y: -24, w: 32, h: 48 },
      condition: { state_key: 'has_key', equals: true },
    },
    actions: [
      { type: 'play_animation', target_layer_id: 'layer_hero', clip_id: 'walk_down', restart: true },
      { type: 'set_state', key: 'door_open', value: true },
    ],
  })
  assert.equal(validateInteractionDocument(valid, context).status, 'pass')

  const invalid = createInteractionDocument({
    trigger: {
      type: 'near_click',
      zone: { coordinate_space: 'owner_local', x: 0, y: 0, w: 20, h: 20 },
    },
    actions: [
      { type: 'scene_link', target_scene_id: 'scene_room', target_spawn_id: 'spawn_room' },
      { type: 'show_text', text: 'after link' },
      { type: 'play_animation', target_layer_id: 'layer_hero', clip_id: 'missing_clip', restart: true },
    ],
  })
  const result = validateInteractionDocument(invalid, { ...context, visualOwner: false })

  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('owner_local_zone_without_owner'))
  assert.ok(result.blocking_errors.includes('scene_link_not_last'))
  assert.ok(result.blocking_errors.includes('missing_target_clip'))
})

test('Workbench Recipe maps canonical fields and fixed defaults to live processing options', () => {
  const blackSourceBuffer = Buffer.from('managed-black-matte')
  const recipe = createDefaultCharacterProcessingRecipe({
    sourceJobId: 'job_hero',
    assetId: 'asset_hero',
    createdFrom: {
      correction: { motion_max_shift: 3 },
      outputs: { frame_sizes: [96, 64, 48, 32, 16] },
    },
  })
  const options = recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer })

  assert.deepEqual(recipe.outputs, { frame_sizes: [96, 64, 48, 32, 16] })
  assert.equal(recipe.style_report.enabled, true)
  assert.equal(options.motionStabilizationMaxShift, 3)
  assert.deepEqual(options.outputFrameSizes, [96, 64, 48, 32, 16])
  assert.equal(options.blackSourceBuffer, blackSourceBuffer)
  assert.deepEqual(options.pixelFinishingOutlineColor, [24, 24, 32])
  assert.equal(options.matteResidueCleanup, true)
  assert.equal(options.matteResidueTolerance, 40)
  assert.equal(options.matteResiduePasses, 2)
  assert.equal(options.edgeDecontamination, true)
  assert.equal(options.edgeDecontaminationMaxDistance, 112)
  assert.equal(options.edgeDecontaminationStrength, 0.55)
  assert.equal(options.sourcePreprocess, true)
  assert.equal(options.promptText, undefined)
  assert.equal('motionMaxShift' in options, false)
  assert.equal('outputScales' in options, false)
})
