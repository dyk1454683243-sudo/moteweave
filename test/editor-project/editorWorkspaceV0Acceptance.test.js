import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import {
  createInteractionDocument,
  createLayerDocument,
  createSceneDocument,
  createEditorArtifactAccessRegistry,
  handleEditorProjectApi,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-23T00:00:00.000Z'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-workspace-v0-acceptance-'))
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {},
  }
}

async function startEditorApiServer(root) {
  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeCharacterJob(root, jobId) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'normalized_sheet.png'), 'character sheet')
  await writeFile(path.join(dir, 'godot_npc_pack.zip'), 'godot character zip')
  await writeFile(path.join(dir, 'rpgmaker_pack.zip'), 'rpgmaker character zip')
  await writeFile(path.join(dir, 'ocad_pack.zip'), 'ocad character zip')
  await writeJson(path.join(dir, 'animations.json'), {
    version: '0.1',
    profile: 'topdown_rpg_v0',
    frame_size: { w: 96, h: 96 },
    anchor: { x: 48, y: 88 },
    animations: {
      walk_down: { frames: [0, 1, 2, 3], fps: 8, mode: 'loop', loop: true },
    },
  })
  await writeJson(path.join(dir, 'metadata.json'), {
    id: 'hero',
    name: 'Hero',
    profile: 'topdown_rpg_v0',
    source: { type: 'upload' },
    quality: { status: 'pass' },
  })
  await writeJson(path.join(dir, 'editor_metadata.json'), { version: '0.1', frames: {} })
  await writeJson(path.join(dir, 'debug_report.json'), {
    validation: { status: 'pass', warnings: [], blocking_errors: [] },
  })
}

async function writeSceneJob(root, jobId) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'tileset.png'), 'scene tileset')
  await writeFile(path.join(dir, 'project.ldtk'), '{"levels":[]}')
  await writeJson(path.join(dir, 'scene.json'), {
    version: 'scene_pack_v0',
    id: 'forest',
    name: 'Forest',
    profile: 'topdown_tile_dual_grid_v0',
  })
  await writeJson(path.join(dir, 'tile_map.json'), {
    profile: 'topdown_tile_dual_grid_v0',
    width: 2,
    height: 2,
    cells: [],
  })
  await writeJson(path.join(dir, 'tile_atlas.json'), {
    profile: 'topdown_tile_dual_grid_v0',
    tiles: [],
  })
  await writeJson(path.join(dir, 'quality_gate.json'), {
    status: 'pass',
    warnings: [],
    blocking_errors: [],
  })
}

test('editor workspace v0 acceptance creates, imports, authors, playtest-links, and exports a pack', async (t) => {
  const root = await tempRoot()
  await writeCharacterJob(root, 'job_hero')
  await writeSceneJob(root, 'job_forest')
  const { server, baseUrl } = await startEditorApiServer(root)
  t.after(() => server.close())

  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'project_demo',
      name: 'Demo Project',
      now: timestamp,
    }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.project.revision, 1)

  const heroImport = await fetchJson(baseUrl, '/api/editor/projects/project_demo/import-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      kind: 'character_pack',
      jobId: 'job_hero',
      assetId: 'asset_hero',
    }),
  })
  assert.equal(heroImport.status, 200)
  assert.equal(heroImport.json.project.revision, 2)

  const sceneImport = await fetchJson(baseUrl, '/api/editor/projects/project_demo/import-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 2,
      kind: 'scene_pack',
      jobId: 'job_forest',
      assetId: 'asset_forest',
    }),
  })
  assert.equal(sceneImport.status, 200)
  assert.equal(sceneImport.json.project.revision, 3)

  const project = sceneImport.json.project
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
      position: { x: 128, y: 160 },
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: { mode: 'artifact_anchor', name: 'feet', x: null, y: null },
      coordinate_space: 'world',
      flip_x: false,
      flip_y: false,
    },
    render: { z_index: 10, opacity: 1, parallax: 1, blend_mode: 'normal' },
    playback: {
      activation: 'auto',
      loop_mode: 'loop',
      rate: 1,
      start_offset_ms: 0,
      initially_paused: false,
    },
    interaction: createInteractionDocument({
      trigger: { type: 'near_key', key: 'KeyE', radius: 64 },
      actions: [
        { type: 'show_text', text: 'Enter room', duration_ms: 1000 },
        { type: 'scene_link', target_scene_id: 'scene_room', target_spawn_id: 'spawn_room' },
      ],
    }),
  }))
  assert.equal(validateEditorProject(project).status, 'pass')

  const saved = await fetchJson(baseUrl, '/api/editor/projects/project_demo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, expectedRevision: 3 }),
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.project.revision, 4)

  const exported = await fetchJson(baseUrl, '/api/editor/projects/project_demo/export-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 4,
      exportId: 'acceptance_export',
      now: timestamp,
    }),
  })
  assert.equal(exported.status, 200)
  assert.equal(exported.json.export.status, 'pass')
  assert.equal(exported.json.export.validation.metrics.scene_count, 2)
  assert.equal(exported.json.export.validation.metrics.engine_payload_count, 4)

  const zipResponse = await fetch(new URL(exported.json.export.urls.zip_url, baseUrl))
  assert.equal(zipResponse.status, 200)
  const zip = await JSZip.loadAsync(Buffer.from(await zipResponse.arrayBuffer()))
  assert.equal(JSON.parse(await zip.file('project.json').async('string')).scene_flow.links[0].id, 'link_scene_main_to_room')
  assert.equal(JSON.parse(await zip.file('scenes/scene_main.json').async('string')).layers[0].playback.activation, 'auto')
  assert.equal(JSON.parse(await zip.file('asset_references.json').async('string')).assets.asset_forest.kind, 'scene_pack')
  assert.equal(await zip.file('engines/godot/asset_hero_rev_001.zip').async('string'), 'godot character zip')
  assert.equal(await zip.file('engines/ldtk/asset_forest_rev_001.ldtk').async('string'), '{"levels":[]}')
})
