import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createLayerDocument,
} from '../../src/editor-project/index.js'
import {
  createAnimationRuntimeState,
  frameStateForLayer,
  resetLayerElapsed,
  resolveFrameIndex,
  resolveLayerClip,
  setLayerClockPlaying,
  setLayerElapsed,
  setRuntimePlaying,
  syncAnimationRuntime,
  tickAnimationRuntime,
  runtimeHasActiveClocks,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeAsset() {
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_runtime_hero',
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
      walk_down: {
        id: 'walk_down',
        source: 'animations.json',
        frames: [0, 1, 2, 3],
        fps: 4,
        loop_mode: 'loop',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
      idle_down: {
        id: 'idle_down',
        source: 'animations.json',
        frames: [8, 9],
        fps: 2,
        loop_mode: 'ping_pong',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
    },
  })
}

function makeSceneWithLayers() {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const asset = makeAsset()
  project.assets[asset.id] = asset
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_walk',
    name: 'Walk',
    type: 'character',
    assetId: asset.id,
    clipId: 'walk_down',
    playback: {
      activation: 'auto',
      loop_mode: 'loop',
      rate: 1,
      start_offset_ms: 0,
      initially_paused: false,
    },
  }))
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_idle',
    name: 'Idle',
    type: 'character',
    assetId: asset.id,
    clipId: 'idle_down',
    playback: {
      activation: 'manual',
      loop_mode: 'ping_pong',
      rate: 1,
      start_offset_ms: 250,
      initially_paused: false,
    },
  }))
  return { project, asset, scene: project.scenes.scene_main }
}

test('animation runtime resolves clips and keeps independent layer clocks', () => {
  const { asset, scene } = makeSceneWithLayers()
  const assets = { [asset.id]: asset }
  let runtime = syncAnimationRuntime(createAnimationRuntimeState(0), scene, assets, 0)
  runtime = setRuntimePlaying(runtime, true, 0)
  runtime = tickAnimationRuntime(runtime, scene, assets, 500)

  const walk = frameStateForLayer(runtime, scene.layers[0], asset)
  const idle = frameStateForLayer(runtime, scene.layers[1], asset)

  assert.equal(walk.frame_index, 2)
  assert.equal(walk.frame_number, 2)
  assert.equal(idle.frame_index, 0)
  assert.equal(idle.frame_number, 8)

  runtime = setLayerClockPlaying(runtime, 'layer_idle', true)
  runtime = tickAnimationRuntime(runtime, scene, assets, 1000)
  const advancedIdle = frameStateForLayer(runtime, scene.layers[1], asset)
  assert.equal(advancedIdle.frame_number, 9)
})

test('animation runtime supports scrub, reset, once, loop, and ping-pong mapping', () => {
  const { asset, scene } = makeSceneWithLayers()
  const assets = { [asset.id]: asset }
  let runtime = syncAnimationRuntime(createAnimationRuntimeState(0), scene, assets, 0)
  runtime = setLayerElapsed(runtime, 'layer_walk', 750)
  assert.equal(frameStateForLayer(runtime, scene.layers[0], asset).frame_number, 3)
  runtime = resetLayerElapsed(runtime, 'layer_walk', scene.layers[0].playback)
  assert.equal(frameStateForLayer(runtime, scene.layers[0], asset).frame_number, 0)

  const resolved = resolveLayerClip(scene.layers[0], asset)
  assert.equal(resolveFrameIndex({ ...resolved, playback: { ...resolved.playback, loop_mode: 'once' } }, 9999), 3)
  assert.equal(resolveFrameIndex({ ...resolved, playback: { ...resolved.playback, loop_mode: 'loop' } }, 1000), 0)

  const pingPong = resolveLayerClip(scene.layers[1], asset)
  assert.equal(resolveFrameIndex(pingPong, 0), 0)
  assert.equal(resolveFrameIndex(pingPong, 500), 1)
  assert.equal(resolveFrameIndex(pingPong, 1000), 0)
})

test('animation runtime only auto-runs layers with auto activation', () => {
  const { asset, scene } = makeSceneWithLayers()
  const assets = { [asset.id]: asset }
  let runtime = syncAnimationRuntime(createAnimationRuntimeState(0), scene, assets, 0)

  assert.equal(runtimeHasActiveClocks(runtime, scene, assets), false)
  runtime = setRuntimePlaying(runtime, true, 0)
  assert.equal(runtimeHasActiveClocks(runtime, scene, assets), true)

  const manualOnlyScene = {
    ...scene,
    layers: [scene.layers[1]],
  }
  assert.equal(runtimeHasActiveClocks(runtime, manualOnlyScene, assets), false)

  runtime = setLayerClockPlaying(runtime, 'layer_idle', true)
  assert.equal(runtimeHasActiveClocks(runtime, manualOnlyScene, assets), true)
})
