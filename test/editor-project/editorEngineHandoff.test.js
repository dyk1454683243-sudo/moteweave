import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import {
  buildEditorProjectPack,
  buildEngineHandoffManifest,
  buildGodotSceneHandoff,
  buildLdtkSceneHandoff,
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createInteractionDocument,
  createLayerDocument,
  createSceneDocument,
  ENGINE_CONSUMER_VALIDATION_VERSION,
  ENGINE_HANDOFF_MANIFEST_VERSION,
  ENGINE_MANUAL_IMPORT_EVIDENCE_VERSION,
  GODOT_SCENE_HANDOFF_VERSION,
  LDTK_SCENE_HANDOFF_VERSION,
  listEngineActionMappings,
  validateEngineHandoffManifest,
  writeEditorProjectPackArtifacts,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-23T00:00:00.000Z'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-engine-handoff-'))
}

async function writeManagedFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

function managedPath(assetId, revisionId, fileName) {
  return `workspace/projects/project_demo/assets/${assetId}/${revisionId}/${fileName}`
}

function makeCharacterAsset() {
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_hero',
    createdAt: timestamp,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      sheet: managedPath('asset_hero', 'rev_001', 'normalized_sheet.png'),
      animations: managedPath('asset_hero', 'rev_001', 'animations.json'),
      metadata: managedPath('asset_hero', 'rev_001', 'metadata.json'),
      editor_metadata: managedPath('asset_hero', 'rev_001', 'editor_metadata.json'),
      debug_report: managedPath('asset_hero', 'rev_001', 'debug_report.json'),
      godot_npc_zip: managedPath('asset_hero', 'rev_001', 'godot_npc_pack.zip'),
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

function makeProject({ unsupportedActions = false, missingAsset = false } = {}) {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const asset = makeCharacterAsset()
  if (!missingAsset) project.assets[asset.id] = asset
  project.scenes.scene_room = createSceneDocument({
    id: 'scene_room',
    name: 'Room',
    createdAt: timestamp,
    updatedAt: timestamp,
    entities: [{ id: 'spawn_room', type: 'spawn_point', position: { x: 120, y: 144 } }],
  })
  project.scene_flow.nodes.scene_room = { x: 460, y: 60, w: 320, h: 180 }
  project.scene_flow.links.push({
    id: 'link_scene_main_to_room',
    from_scene_id: 'scene_main',
    to_scene_id: 'scene_room',
    label: 'Door',
  })
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_hero',
    name: 'Hero',
    type: 'character',
    assetId: 'asset_hero',
    clipId: 'walk_down',
    transform: {
      position: { x: 640, y: 480 },
      scale: { x: 1, y: 1 },
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
    interaction: createInteractionDocument({
      trigger: { type: 'near_key', key: 'KeyE', radius: 64 },
      actions: unsupportedActions
        ? [
            { type: 'set_state', key: 'door_open', value: true },
            { type: 'pickup_item', item_id: 'rusty_key', quantity: 1, hide_layer_id: 'layer_hero' },
          ]
        : [
            { type: 'show_text', text: 'Enter room', duration_ms: 1000 },
            { type: 'scene_link', target_scene_id: 'scene_room', target_spawn_id: 'spawn_room' },
          ],
    }),
  }))
  return project
}

async function writeProjectFiles(root, project) {
  for (const asset of Object.values(project.assets)) {
    const revision = asset.revisions[asset.active_revision_id]
    for (const [key, relativePath] of Object.entries(revision.artifacts)) {
      await writeManagedFile(root, relativePath, key === 'godot_npc_zip' ? 'godot zip bytes' : `${key} file`)
    }
  }
}

test('engine handoff manifest records mapping, pivots, anchors, and supported actions', () => {
  const manifest = buildEngineHandoffManifest(makeProject(), { createdAt: timestamp })
  const validation = validateEngineHandoffManifest(manifest)

  assert.equal(manifest.version, ENGINE_HANDOFF_MANIFEST_VERSION)
  assert.equal(validation.status, 'pass')
  assert.equal(manifest.status, 'pass')
  assert.equal(manifest.coordinate_model.layer_position_semantics, 'position_is_layer_pivot')
  assert.equal(manifest.capability_profiles.godot.status, 'preview_review')
  assert.equal(manifest.capability_profiles.ldtk.coordinate_mapping.world, 'entity px coordinates store the editor pivot point')
  assert.equal(manifest.unsupported_items.length, 0)

  const layer = manifest.scenes[0].layers[0]
  assert.deepEqual(layer.transform.pivot_position, { x: 640, y: 480 })
  assert.deepEqual(layer.transform.top_left_position, { x: 592, y: 392 })
  assert.deepEqual(layer.transform.pivot, {
    mode: 'artifact_anchor',
    name: 'feet',
    x: 48,
    y: 88,
    source: 'clip_anchor',
  })
  assert.equal(layer.interaction.actions[0].engine_support.godot.status, 'supported_metadata')
  assert.equal(layer.interaction.actions[1].engine_support.ldtk.status, 'supported_metadata')

  const mappings = listEngineActionMappings()
  assert.equal(mappings.emit_event.godot.status, 'unsupported')
  assert.equal(mappings.set_flag.ldtk.status, 'unsupported')
})

test('unsupported action mappings become warnings and explicit LDtk omissions', () => {
  const manifest = buildEngineHandoffManifest(makeProject({ unsupportedActions: true }), { createdAt: timestamp })
  const validation = validateEngineHandoffManifest(manifest)
  const godot = buildGodotSceneHandoff(manifest)
  const ldtk = buildLdtkSceneHandoff(manifest)

  assert.equal(validation.status, 'warning')
  assert.equal(manifest.status, 'warning')
  assert.ok(manifest.unsupported_items.some((item) => item.engine === 'ldtk' && item.action_type === 'set_state'))
  assert.ok(manifest.unsupported_items.some((item) => item.engine === 'godot' && item.action_type === 'pickup_item'))
  assert.equal(godot.status, 'warning')
  assert.equal(ldtk.status, 'warning')
  assert.equal(godot.unsupported_items.length, 1)
  assert.equal(ldtk.unsupported_items.length, 2)

  const ldtkEntity = ldtk.levels[0].layer_instances[0].entity_instances[0]
  assert.deepEqual(ldtkEntity.custom_fields.actions, [])

  const pack = buildEditorProjectPack(makeProject({ unsupportedActions: true }), { createdAt: timestamp })
  assert.equal(pack.reviewStatus.status, 'warning')
  assert.equal(pack.reviewStatus.consumer_readiness, 'preview_metadata_only')
  assert.equal(pack.reviewStatus.unsupported_items_status, 'unsupported_items_present')
  assert.ok(pack.engineConsumerValidation.warnings.includes('engine_consumer_unsupported_items_present'))
})

test('engine handoff validation rejects dangling manifest references before export', () => {
  const manifest = buildEngineHandoffManifest(makeProject({ missingAsset: true }), { createdAt: timestamp })
  const validation = validateEngineHandoffManifest(manifest)

  assert.equal(manifest.validation.status, 'fail')
  assert.ok(manifest.validation.blocking_errors.includes('missing_layer_asset'))
  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('missing_manifest_layer_asset'))
})

test('editor project pack includes handoff files and preserves existing engine payloads', async () => {
  const root = await tempRoot()
  const project = makeProject()
  await writeProjectFiles(root, project)

  const pack = buildEditorProjectPack(project, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    createdAt: timestamp,
  })
  assert.equal(pack.status, 'pass')
  assert.equal(pack.engineHandoffManifest.version, ENGINE_HANDOFF_MANIFEST_VERSION)
  assert.equal(pack.godotSceneHandoff.version, GODOT_SCENE_HANDOFF_VERSION)
  assert.equal(pack.ldtkSceneHandoff.version, LDTK_SCENE_HANDOFF_VERSION)
  assert.equal(pack.engineConsumerValidation.version, ENGINE_CONSUMER_VALIDATION_VERSION)
  assert.equal(pack.engineConsumerValidation.status, 'pass')
  assert.equal(pack.reviewStatus.status, 'pass')
  assert.equal(pack.reviewStatus.consumer_readiness, 'preview_metadata_only')
  assert.equal(pack.reviewStatus.unsupported_items_status, 'pass')
  assert.equal(pack.manualImportEvidence.version, ENGINE_MANUAL_IMPORT_EVIDENCE_VERSION)
  assert.match(pack.manualImportChecklist, /Engine Consumer Manual Import Checklist/)

  const written = await writeEditorProjectPackArtifacts({
    project,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    exportId: 'export_handoff',
    now: timestamp,
  })
  assert.equal(written.status, 'pass')
  assert.equal(written.artifacts.engine_handoff_manifest, 'workspace/projects/project_demo/exports/export_handoff/engine_handoff_manifest.json')
  assert.equal(written.artifacts.godot_scene_handoff, 'workspace/projects/project_demo/exports/export_handoff/engines/godot/scene_handoff.json')
  assert.equal(written.artifacts.ldtk_scene_handoff, 'workspace/projects/project_demo/exports/export_handoff/engines/ldtk/scene_handoff.json')
  assert.equal(written.artifacts.engine_consumer_validation, 'workspace/projects/project_demo/exports/export_handoff/consumer_evidence/engine_consumer_validation.json')
  assert.equal(written.artifacts.manual_import_evidence, 'workspace/projects/project_demo/exports/export_handoff/consumer_evidence/manual_import_evidence.json')
  assert.equal(written.artifacts.manual_import_checklist, 'workspace/projects/project_demo/exports/export_handoff/consumer_evidence/manual_import_checklist.md')

  const zip = await JSZip.loadAsync(await readFile(path.join(root, written.artifacts.zip)))
  assert.equal(JSON.parse(await zip.file('engine_handoff_manifest.json').async('string')).version, ENGINE_HANDOFF_MANIFEST_VERSION)
  assert.equal(JSON.parse(await zip.file('engines/godot/scene_handoff.json').async('string')).claim_boundary, 'preview_metadata_only_no_godot_plugin_or_scene_file_generated')
  assert.equal(JSON.parse(await zip.file('engines/ldtk/scene_handoff.json').async('string')).existing_scene_pack_payload_policy, 'preserve_existing_scene_pack_ldtk_payloads')
  assert.equal(JSON.parse(await zip.file('consumer_evidence/engine_consumer_validation.json').async('string')).version, ENGINE_CONSUMER_VALIDATION_VERSION)
  assert.equal(JSON.parse(await zip.file('consumer_evidence/manual_import_evidence.json').async('string')).review_status.consumer_readiness, 'preview_metadata_only')
  assert.match(await zip.file('consumer_evidence/manual_import_checklist.md').async('string'), /Godot Preview Metadata/)
  assert.equal(JSON.parse(await zip.file('engine_payloads.json').async('string')).policy, 'reference_existing_supported_payloads_only')
  assert.equal(await zip.file('engines/godot/asset_hero_rev_001.zip').async('string'), 'godot zip bytes')
})
