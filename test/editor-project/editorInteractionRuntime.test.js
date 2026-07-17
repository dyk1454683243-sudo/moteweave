import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyPlaytestLayerOverrides,
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createInteractionDocument,
  createInteractionRuntimeState,
  createLayerDocument,
  createSceneDocument,
  interactionZoneRect,
  shouldTriggerInteraction,
  triggerInteractions,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeAsset() {
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_interaction_hero',
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
  })
  return createAssetRef({
    id: 'asset_hero',
    kind: 'character_pack',
    name: 'Hero',
    profile: 'topdown_rpg_v0',
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
    clips: {
      idle_down: {
        id: 'idle_down',
        source: 'animations.json',
        frames: [0, 1],
        fps: 4,
        loop_mode: 'loop',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
      open: {
        id: 'open',
        source: 'animations.json',
        frames: [2, 3],
        fps: 4,
        loop_mode: 'once',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
    },
  })
}

function makeLayer(id, overrides = {}) {
  return createLayerDocument({
    id,
    name: id,
    type: 'character',
    assetId: 'asset_hero',
    clipId: 'idle_down',
    transform: {
      position: { x: 100, y: 120 },
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: { mode: 'artifact_anchor', name: 'feet', x: null, y: null },
      coordinate_space: 'world',
      flip_x: false,
      flip_y: false,
    },
    render: { z_index: 10, opacity: 1, parallax: 1, blend_mode: 'normal' },
    playback: {
      activation: 'manual',
      loop_mode: 'loop',
      rate: 1,
      start_offset_ms: 0,
      initially_paused: false,
    },
    ...overrides,
  })
}

function makeProject() {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  project.assets.asset_hero = makeAsset()
  project.scenes.scene_main.layers.push(
    makeLayer('layer_player', { transform: { position: { x: 100, y: 120 } } }),
    makeLayer('layer_door', { transform: { position: { x: 128, y: 120 } } }),
    makeLayer('layer_key', { transform: { position: { x: 110, y: 120 } } }),
  )
  project.scenes.scene_main.layers[1].interaction = createInteractionDocument({
    trigger: {
      type: 'near_key',
      key: 'KeyE',
      radius: 96,
      zone: { coordinate_space: 'owner_local', x: -32, y: -32, w: 64, h: 64 },
    },
    actions: [
      { type: 'show_text', text: 'Door opens', duration_ms: 1200 },
      { type: 'set_state', key: 'door_open', value: true },
      { type: 'toggle_layer', target_layer_id: 'layer_key', visible: false },
      { type: 'play_animation', target_layer_id: 'layer_door', clip_id: 'open', restart: true },
      { type: 'pickup_item', item_id: 'rusty_key', quantity: 1, hide_layer_id: 'layer_key' },
      { type: 'scene_link', target_scene_id: 'scene_room', target_spawn_id: 'spawn_room' },
    ],
  })
  project.scenes.scene_room = createSceneDocument({
    id: 'scene_room',
    name: 'Room',
    createdAt: timestamp,
    updatedAt: timestamp,
    entities: [{ id: 'spawn_room', type: 'spawn_point', position: { x: 24, y: 32 } }],
  })
  project.scene_flow.nodes.scene_room = { x: 420, y: 60, w: 320, h: 180 }
  return project
}

test('interaction runtime triggers near-key actions without mutating project state', () => {
  const project = makeProject()
  assert.equal(validateEditorProject(project).status, 'pass')
  const runtime = createInteractionRuntimeState({ project, playerLayerId: 'layer_player' })
  const door = project.scenes.scene_main.layers[1]

  assert.deepEqual(interactionZoneRect(door, door.interaction), {
    x: 96,
    y: 88,
    w: 64,
    h: 64,
    coordinate_space: 'world',
  })
  assert.equal(shouldTriggerInteraction(project, runtime, door, { type: 'near_key', key: 'KeyQ', point: { x: 120, y: 120 } }), false)
  assert.equal(shouldTriggerInteraction(project, runtime, door, { type: 'near_key', key: 'KeyE', point: { x: 10, y: 10 } }), false)

  const result = triggerInteractions(project, runtime, { type: 'near_key', key: 'KeyE', point: { x: 120, y: 120 } })
  assert.deepEqual(result.events.map((event) => event.type), [
    'show_text',
    'set_state',
    'toggle_layer',
    'play_animation',
    'pickup_item',
    'scene_link',
  ])
  assert.equal(result.runtime.flags.door_open, true)
  assert.deepEqual(result.runtime.inventory, [{ item_id: 'rusty_key', quantity: 1 }])
  assert.equal(result.runtime.layerOverrides.layer_key.visible, false)
  assert.equal(result.runtime.layerOverrides.layer_door.clip_id, 'open')
  assert.equal(result.runtime.activeSceneId, 'scene_room')
  assert.deepEqual(result.runtime.player, { layer_id: 'layer_player', x: 24, y: 32 })
  assert.equal(result.runtime.messages[0].text, 'Door opens')
  assert.equal(project.scenes.scene_main.layers[2].visible, true)
})

test('playtest layer overrides return a runtime scene clone', () => {
  const project = makeProject()
  const runtime = createInteractionRuntimeState({ project })
  runtime.layerOverrides.layer_key = { visible: false }
  runtime.layerOverrides.layer_door = { clip_id: 'open' }

  const scene = applyPlaytestLayerOverrides(project.scenes.scene_main, runtime)

  assert.equal(scene.layers.find((layer) => layer.id === 'layer_key').visible, false)
  assert.equal(scene.layers.find((layer) => layer.id === 'layer_door').clip_id, 'open')
  assert.equal(project.scenes.scene_main.layers.find((layer) => layer.id === 'layer_key').visible, true)
  assert.equal(project.scenes.scene_main.layers.find((layer) => layer.id === 'layer_door').clip_id, 'idle_down')
})

test('state triggers can consume runtime flags on a later tick', () => {
  const project = makeProject()
  project.scenes.scene_main.layers[0].interaction = createInteractionDocument({
    trigger: {
      type: 'state',
      condition: { state_key: 'door_open', equals: true },
    },
    actions: [{ type: 'show_text', text: 'State matched' }],
  })
  let runtime = createInteractionRuntimeState({ project })

  let result = triggerInteractions(project, runtime, { type: 'state' })
  assert.deepEqual(result.events, [])

  runtime = { ...runtime, flags: { door_open: true } }
  result = triggerInteractions(project, runtime, { type: 'state' })
  assert.equal(result.events[0].text, 'State matched')
})

test('runtime stops an interaction on missing action targets', () => {
  const project = makeProject()
  project.scenes.scene_main.layers[0].interaction = createInteractionDocument({
    trigger: { type: 'auto' },
    actions: [
      { type: 'toggle_layer', target_layer_id: 'missing_layer', visible: false },
      { type: 'set_state', key: 'should_not_run', value: true },
    ],
  })
  const runtime = createInteractionRuntimeState({ project })
  const result = triggerInteractions(project, runtime, { type: 'auto' })

  assert.deepEqual(result.events.map((event) => event.type), ['error'])
  assert.equal(result.runtime.flags.should_not_run, undefined)
})
