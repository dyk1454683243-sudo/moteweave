import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createInteractionDocument,
  validateEditorProject,
} from '../../src/editor-project/index.js'
import {
  appendLayerToScene,
  canAddAssetToScene,
  clampPositionToScene,
  createLayerFromAsset,
  fitSceneToStage,
  interactionZoneBoxInView,
  layerBoxInView,
  layerTypeForAsset,
  moveSceneLayer,
  snapPoint,
  updateSceneLayer,
} from '../../src/ui/editor/sceneCanvas.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeCharacterAsset(revisionOverrides = {}) {
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_canvas_hero',
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
    ...revisionOverrides,
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
  })
}

function makeStaticImageAsset(tags = []) {
  const revision = createAssetRevision({
    id: 'rev_001',
    createdAt: timestamp,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      image: 'workspace/projects/project_demo/assets/asset_backdrop/rev_001/backdrop.png',
    },
  })
  return createAssetRef({
    id: 'asset_backdrop',
    kind: 'static_image',
    name: 'Backdrop',
    revision,
    provenance: { source_type: 'manual_import', provider: null, model: null },
    tags,
  })
}

test('scene canvas creates a validator-safe layer from a real project asset', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const asset = makeCharacterAsset()
  project.assets[asset.id] = asset
  const scene = project.scenes.scene_main
  const layer = createLayerFromAsset(asset, scene, { snapSize: 16 })

  assert.equal(layer.type, 'character')
  assert.equal(layer.asset_id, asset.id)
  assert.equal(layer.clip_id, 'walk_down')
  assert.deepEqual(layer.transform.position, { x: 640, y: 368 })
  assert.equal(layer.playback.activation, 'auto')

  project.scenes.scene_main = appendLayerToScene(scene, layer, timestamp)
  const result = validateEditorProject(project)
  assert.equal(result.status, 'pass')
  assert.equal(result.metrics.layer_count, 1)
})

test('scene canvas maps project asset kinds to authoring layer types', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const background = makeStaticImageAsset(['background'])
  const scene = project.scenes.scene_main
  project.assets[background.id] = background

  assert.equal(layerTypeForAsset({ kind: 'character_pack' }), 'character')
  assert.equal(layerTypeForAsset({ kind: 'tilemap' }), 'tilemap')
  assert.equal(layerTypeForAsset({ kind: 'spritesheet' }), 'prop')
  assert.equal(layerTypeForAsset({ kind: 'effect' }), 'effect')
  assert.equal(layerTypeForAsset({ kind: 'ui' }), 'ui')
  assert.equal(layerTypeForAsset(background), 'background')

  const layer = createLayerFromAsset(background, scene, { snapSize: 16 })
  assert.equal(layer.type, 'background')
  assert.equal(layer.transform.pivot.mode, 'top_left')
  project.scenes.scene_main = appendLayerToScene(scene, layer, timestamp)
  assert.equal(validateEditorProject(project).status, 'pass')
})

test('scene canvas blocks failed or production-blocked assets by default', () => {
  const scene = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp }).scenes.scene_main
  const failed = makeCharacterAsset({ qualityStatus: 'fail', productionStatus: 'blocked' })

  assert.equal(canAddAssetToScene(failed), false)
  assert.equal(createLayerFromAsset(failed, scene), null)
})

test('scene canvas snaps, clamps, renders boxes, and reorders layers deterministically', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  const asset = makeCharacterAsset()
  const scene = project.scenes.scene_main
  const layer = createLayerFromAsset(asset, scene, { snapSize: 16 })
  const withLayer = appendLayerToScene(scene, layer, timestamp)
  const moved = updateSceneLayer(withLayer, layer.id, (draft) => ({
    ...draft,
    transform: {
      ...draft.transform,
      position: clampPositionToScene(snapPoint({ x: 17, y: 9999 }, { snapSize: 16 }), withLayer, draft),
    },
  }), timestamp)

  assert.deepEqual(moved.layers[0].transform.position, { x: 16, y: 720 })

  const view = fitSceneToStage(withLayer, { width: 640, height: 360 })
  const box = layerBoxInView(layer, withLayer, asset, view)
  assert.ok(box.width > 0)
  assert.ok(box.height > 0)
  assert.ok(box.anchorY > box.anchorX)

  const interactiveLayer = {
    ...layer,
    interaction: createInteractionDocument({
      trigger: {
        type: 'near_click',
        zone: { coordinate_space: 'owner_local', x: -16, y: -32, w: 32, h: 48 },
      },
    }),
  }
  const zoneBox = interactionZoneBoxInView(interactiveLayer, withLayer, view)
  assert.ok(zoneBox.width > 0)
  assert.ok(zoneBox.height > 0)

  const second = { ...layer, id: 'layer_second', render: { ...layer.render, z_index: 20 } }
  const twoLayers = appendLayerToScene(withLayer, second, timestamp)
  const reordered = moveSceneLayer(twoLayers, second.id, -1, timestamp)
  assert.deepEqual(reordered.layers.map((item) => item.id), ['layer_second', layer.id])
})
