import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAssetLibraryEntry,
  buildAssetLibrary,
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createLayerDocument,
  createSceneDocument,
  listAssetUsage,
  removeAssetFromProject,
  summarizeAssetUsage,
  unlinkAssetFromScenes,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeCharacterAsset() {
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

function makeStaticPropAsset() {
  const revision = createAssetRevision({
    id: 'rev_001',
    createdAt: timestamp,
    qualityStatus: 'warning',
    productionStatus: 'review_required',
    artifacts: {
      image: 'workspace/projects/project_demo/assets/asset_crate/rev_001/crate.png',
    },
  })
  return createAssetRef({
    id: 'asset_crate',
    kind: 'static_image',
    name: 'Crate',
    revision,
    provenance: { source_type: 'manual_import', provider: null, model: null },
  })
}

function makeCharacterLayer(id, sceneIndex = 0) {
  return createLayerDocument({
    id,
    name: `Hero ${sceneIndex}`,
    type: 'character',
    assetId: 'asset_hero',
    clipId: 'walk_down',
    transform: {
      position: { x: 64 + sceneIndex, y: 96 },
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: { mode: 'artifact_anchor', name: 'feet', x: null, y: null },
      coordinate_space: 'world',
      flip_x: false,
      flip_y: false,
    },
    render: { z_index: 10 + sceneIndex, opacity: 1, parallax: 1, blend_mode: 'normal' },
    playback: {
      activation: 'auto',
      loop_mode: 'loop',
      rate: 1,
      start_offset_ms: 0,
      initially_paused: false,
    },
  })
}

function makeProjectWithAssets() {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  project.assets.asset_hero = makeCharacterAsset()
  project.assets.asset_crate = makeStaticPropAsset()
  project.scenes.scene_main.layers.push(makeCharacterLayer('layer_hero_main', 0))
  project.scenes.scene_room = createSceneDocument({
    id: 'scene_room',
    name: 'Room',
    createdAt: timestamp,
    updatedAt: timestamp,
    layers: [makeCharacterLayer('layer_hero_room', 1)],
  })
  project.scene_flow.nodes.scene_room = { x: 440, y: 60, w: 320, h: 180 }
  return project
}

test('asset library tracks scene and layer usage for each asset', () => {
  const project = makeProjectWithAssets()
  const usage = listAssetUsage(project, 'asset_hero')
  const summary = summarizeAssetUsage(project, 'asset_hero')
  const entry = buildAssetLibraryEntry(project, project.assets.asset_hero)
  const library = buildAssetLibrary(project)

  assert.deepEqual(usage.map((item) => item.layer_id), ['layer_hero_main', 'layer_hero_room'])
  assert.equal(summary.scene_count, 2)
  assert.equal(summary.layer_count, 2)
  assert.equal(entry.thumbnail_artifact, 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png')
  assert.equal(entry.clip_count, 1)
  assert.equal(entry.can_delete, false)
  assert.deepEqual(library.map((item) => item.id), ['asset_crate', 'asset_hero'])
})

test('asset deletion is blocked while scene layers still reference it', () => {
  const project = makeProjectWithAssets()

  assert.throws(
    () => removeAssetFromProject(project, 'asset_hero', { now: timestamp }),
    /asset is still used by scene layers/,
  )

  const removed = removeAssetFromProject(project, 'asset_crate', { now: timestamp })
  assert.equal(removed.asset.id, 'asset_crate')
  assert.equal(removed.usage.layer_count, 0)
  assert.equal(removed.project.assets.asset_crate, undefined)
  assert.equal(validateEditorProject(removed.project).status, 'pass')
})

test('asset unlink removes scene references without deleting the asset record', () => {
  const project = makeProjectWithAssets()
  const unlinked = unlinkAssetFromScenes(project, 'asset_hero', { now: timestamp })

  assert.equal(unlinked.asset.id, 'asset_hero')
  assert.deepEqual(unlinked.removed_layers.map((item) => item.layer_id), ['layer_hero_main', 'layer_hero_room'])
  assert.equal(unlinked.project.assets.asset_hero.name, 'Hero')
  assert.deepEqual(unlinked.project.scenes.scene_main.layers, [])
  assert.deepEqual(unlinked.project.scenes.scene_room.layers, [])
  assert.equal(validateEditorProject(unlinked.project).status, 'pass')

  const removed = removeAssetFromProject(unlinked.project, 'asset_hero', { now: timestamp })
  assert.equal(removed.project.assets.asset_hero, undefined)
  assert.equal(validateEditorProject(removed.project).status, 'pass')
})
