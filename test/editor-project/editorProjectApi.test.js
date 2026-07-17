import { spawn } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createEditorArtifactAccessRegistry,
  createLayerDocument,
  handleEditorProjectApi,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-project-api-'))
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {},
  }
}

async function fetchText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl))
  return {
    status: response.status,
    text: await response.text(),
  }
}

async function startEditorApiServer(root, extraOptions = {}) {
  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry,
    ...extraOptions,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}`, artifactAccessRegistry }
}

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
      godot_npc_zip: 'workspace/projects/project_demo/assets/asset_hero/rev_001/godot_npc_pack.zip',
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

function makeProjectWithAssetLayer() {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  project.assets.asset_hero = makeCharacterAsset()
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_hero',
    name: 'Hero',
    type: 'character',
    assetId: 'asset_hero',
    clipId: 'walk_down',
    transform: {
      position: { x: 64, y: 96 },
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
  }))
  return project
}

function makeStaticArtifactProject({
  projectId,
  assetId,
  artifactPath,
  additionalArtifacts = {},
}) {
  const project = createDefaultEditorProject({
    id: projectId,
    name: projectId,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const revision = createAssetRevision({
    id: 'rev_001',
    createdAt: timestamp,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      image: artifactPath,
      ...additionalArtifacts,
    },
  })
  project.assets[assetId] = createAssetRef({
    id: assetId,
    kind: 'static_image',
    name: assetId,
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
  })
  return project
}

async function writeProjectAssetFiles(root, project) {
  for (const asset of Object.values(project.assets ?? {})) {
    for (const revision of Object.values(asset.revisions ?? {})) {
      for (const [key, relativePath] of Object.entries(revision.artifacts ?? {})) {
        const filePath = path.join(root, relativePath)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, `${key} file`)
      }
    }
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      if (output.includes('Character tool running')) resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => reject(new Error(`server exited before ready: ${code}\n${output}`)))
  })
}

test('editor project API creates, loads, saves, and rejects stale revisions', async (t) => {
  const root = await tempRoot()
  const { server, baseUrl } = await startEditorApiServer(root)
  t.after(() => server.close())

  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'project_demo',
      name: 'Demo Project',
      now: '2026-06-22T00:00:00.000Z',
    }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.project.revision, 1)

  const loaded = await fetchJson(baseUrl, '/api/editor/projects/project_demo')
  assert.equal(loaded.status, 200)
  assert.equal(loaded.json.project.name, 'Demo Project')

  const edited = {
    ...loaded.json.project,
    name: 'Renamed Project',
  }
  const saved = await fetchJson(baseUrl, '/api/editor/projects/project_demo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: edited, expectedRevision: 1 }),
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.project.revision, 2)

  const stale = await fetchJson(baseUrl, '/api/editor/projects/project_demo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: saved.json.project, expectedRevision: 1 }),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'revision_conflict')
})

test('editor project API serializes concurrent formal saves at one revision', async (t) => {
  const root = await tempRoot()
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

  const save = (name) => fetchJson(baseUrl, '/api/editor/projects/project_demo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project: { ...created.json.project, name },
      expectedRevision: 1,
    }),
  })
  const responses = await Promise.all([save('Rename A'), save('Rename B')])

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  assert.equal(responses.find((response) => response.status === 409).json.error, 'revision_conflict')
  const loaded = await fetchJson(baseUrl, '/api/editor/projects/project_demo')
  assert.equal(loaded.status, 200)
  assert.equal(loaded.json.project.revision, 2)
  assert.ok(['Rename A', 'Rename B'].includes(loaded.json.project.name))
})

test('editor artifact access registry is frozen and matches only exact string paths', () => {
  const registry = createEditorArtifactAccessRegistry()
  assert.equal(Object.isFrozen(registry), true)
  registry.register(['workspace/projects/project_demo/exports/export_demo/manifest.json', 42])
  assert.equal(registry.has('workspace/projects/project_demo/exports/export_demo/manifest.json'), true)
  assert.equal(registry.has('workspace/projects/project_demo/exports/export_demo/manifest.json/extra'), false)
  assert.equal(registry.has('42'), true)
})

test('editor project API requires an artifact access registry', async () => {
  await assert.rejects(
    () => handleEditorProjectApi({ url: '/api/editor/health' }, {}, {}),
    TypeError,
  )
})

test('editor project API serves only exact recorded or registered workspace artifacts', async (t) => {
  const root = await tempRoot()
  const revisionDir = path.join(root, 'workspace', 'projects', 'project_demo', 'assets', 'asset_hero', 'rev_001')
  const evidencePath = path.join(revisionDir, 'evidence.txt')
  const unrecordedPath = path.join(revisionDir, 'unrecorded.txt')
  const wrongAssetPath = path.join(root, 'workspace', 'projects', 'project_demo', 'assets', 'asset_forged', 'rev_001', 'wrong-asset.txt')
  const wrongRevisionPath = path.join(root, 'workspace', 'projects', 'project_demo', 'assets', 'asset_hero', 'rev_forged', 'wrong-revision.txt')
  await mkdir(revisionDir, { recursive: true })
  await mkdir(path.dirname(wrongAssetPath), { recursive: true })
  await mkdir(path.dirname(wrongRevisionPath), { recursive: true })
  await writeFile(evidencePath, 'managed evidence')
  await writeFile(unrecordedPath, 'unrecorded')
  await writeFile(wrongAssetPath, 'wrong asset')
  await writeFile(wrongRevisionPath, 'wrong revision')
  await writeFile(path.join(root, 'outside.txt'), 'outside')
  const { server, baseUrl } = await startEditorApiServer(root)
  t.after(() => server.close())

  const project = makeStaticArtifactProject({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    artifactPath: 'workspace/projects/project_demo/assets/asset_hero/rev_001/evidence.txt',
    additionalArtifacts: {
      wrong_asset: 'workspace/projects/project_demo/assets/asset_forged/rev_001/wrong-asset.txt',
      wrong_revision: 'workspace/projects/project_demo/assets/asset_hero/rev_forged/wrong-revision.txt',
    },
  })
  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  })
  assert.equal(created.status, 201)

  const saved = await fetchJson(baseUrl, '/api/editor/projects/project_demo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: created.json.project, expectedRevision: 1 }),
  })
  assert.equal(saved.status, 200)
  const autosaved = await fetchJson(baseUrl, '/api/editor/projects/project_demo/autosave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: saved.json.project }),
  })
  assert.equal(autosaved.status, 200)

  const artifact = await fetchText(
    baseUrl,
    '/api/editor/artifact?path=workspace%2Fprojects%2Fproject_demo%2Fassets%2Fasset_hero%2Frev_001%2Fevidence.txt',
  )
  assert.equal(artifact.status, 200)
  assert.equal(artifact.text, 'managed evidence')

  const unsafeClaims = [
    'outside.txt',
    'workspace/../outside.txt',
    path.join(root, 'outside.txt'),
  ]
  for (const claimedPath of unsafeClaims) {
    const response = await fetchText(baseUrl, `/api/editor/artifact?path=${encodeURIComponent(claimedPath)}`)
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.text).error, 'unsafe_artifact_path')
    assert.equal(response.text.includes(root), false)
  }

  const unrecordedClaims = [
    'workspace/projects/project_demo/project.json',
    'workspace/projects/project_demo/project.backup.json',
    'workspace/projects/project_demo/autosave.json',
    'workspace/projects/project_demo/assets/asset_hero/rev_001/unrecorded.txt',
    'workspace/projects/project_demo/assets/asset_hero/rev_forged/unrecorded.txt',
    'workspace/projects/project_forged/assets/asset_hero/rev_001/evidence.txt',
  ]
  for (const claimedPath of unrecordedClaims) {
    const response = await fetchText(baseUrl, `/api/editor/artifact?path=${encodeURIComponent(claimedPath)}`)
    assert.equal(response.status, 404)
    assert.equal(response.text.includes(root), false)
  }

  for (const claimedPath of [
    'workspace/projects/project_demo/assets/asset_forged/rev_001/wrong-asset.txt',
    'workspace/projects/project_demo/assets/asset_hero/rev_forged/wrong-revision.txt',
  ]) {
    const response = await fetchText(baseUrl, `/api/editor/artifact?path=${encodeURIComponent(claimedPath)}`)
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.text).error, 'unsafe_artifact_path')
    assert.equal(response.text.includes(root), false)
  }

  const forgedProjectPath = 'workspace/projects/project_forged/assets/asset_hero/rev_001/forged.txt'
  const forgedProject = makeStaticArtifactProject({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    artifactPath: forgedProjectPath,
  })
  const forgedProjectJson = path.join(root, 'workspace', 'projects', 'project_forged', 'project.json')
  await mkdir(path.dirname(forgedProjectJson), { recursive: true })
  await mkdir(path.join(root, path.dirname(forgedProjectPath)), { recursive: true })
  await writeFile(forgedProjectJson, JSON.stringify(forgedProject))
  await writeFile(path.join(root, forgedProjectPath), 'forged')
  const forgedIdentity = await fetchText(baseUrl, `/api/editor/artifact?path=${encodeURIComponent(forgedProjectPath)}`)
  assert.equal(forgedIdentity.status, 400)
  assert.equal(JSON.parse(forgedIdentity.text).error, 'unsafe_artifact_path')
  assert.equal(forgedIdentity.text.includes(root), false)

  const otherArtifactPath = 'workspace/projects/project_other/assets/asset_other/rev_001/evidence.txt'
  await mkdir(path.dirname(path.join(root, otherArtifactPath)), { recursive: true })
  await writeFile(path.join(root, otherArtifactPath), 'other project evidence')
  const otherProject = makeStaticArtifactProject({
    projectId: 'project_other',
    assetId: 'asset_other',
    artifactPath: otherArtifactPath,
  })
  const otherCreated = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: otherProject }),
  })
  assert.equal(otherCreated.status, 201)
  const otherArtifact = await fetchText(baseUrl, `/api/editor/artifact?path=${encodeURIComponent(otherArtifactPath)}`)
  assert.equal(otherArtifact.status, 200)
  assert.equal(otherArtifact.text, 'other project evidence')
})

test('editor project API safely unlinks and deletes project assets', async (t) => {
  const root = await tempRoot()
  const { server, baseUrl } = await startEditorApiServer(root)
  t.after(() => server.close())

  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: makeProjectWithAssetLayer() }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.project.revision, 1)

  const blocked = await fetchJson(baseUrl, '/api/editor/projects/project_demo/assets/asset_hero', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1 }),
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error, 'asset_in_use')
  assert.equal(blocked.json.details.layer_count, 1)

  const unlinked = await fetchJson(baseUrl, '/api/editor/projects/project_demo/assets/asset_hero/unlink', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1 }),
  })
  assert.equal(unlinked.status, 200)
  assert.equal(unlinked.json.project.revision, 2)
  assert.equal(unlinked.json.asset.id, 'asset_hero')
  assert.deepEqual(unlinked.json.removed_layers.map((item) => item.layer_id), ['layer_hero'])
  assert.deepEqual(unlinked.json.project.scenes.scene_main.layers, [])

  const removed = await fetchJson(baseUrl, '/api/editor/projects/project_demo/assets/asset_hero', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2 }),
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.json.project.revision, 3)
  assert.equal(removed.json.asset.id, 'asset_hero')
  assert.equal(removed.json.project.assets.asset_hero, undefined)
})

test('editor project API exports project pack artifacts from the editor namespace', async (t) => {
  const root = await tempRoot()
  const { server, baseUrl } = await startEditorApiServer(root)
  t.after(() => server.close())
  const project = makeProjectWithAssetLayer()
  await writeProjectAssetFiles(root, project)

  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.project.revision, 1)

  const exported = await fetchJson(baseUrl, '/api/editor/projects/project_demo/export-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      exportId: 'api_export',
      now: '2026-06-22T00:10:00.000Z',
    }),
  })
  assert.equal(exported.status, 200)
  assert.equal(exported.json.export.id, 'api_export')
  assert.equal(exported.json.export.status, 'pass')
  assert.equal(exported.json.export.artifacts.zip, 'workspace/projects/project_demo/exports/api_export/editor_project_pack.zip')
  assert.equal(exported.json.export.artifacts.engine_handoff_manifest, 'workspace/projects/project_demo/exports/api_export/engine_handoff_manifest.json')
  assert.equal(exported.json.export.artifacts.godot_scene_handoff, 'workspace/projects/project_demo/exports/api_export/engines/godot/scene_handoff.json')
  assert.equal(exported.json.export.artifacts.ldtk_scene_handoff, 'workspace/projects/project_demo/exports/api_export/engines/ldtk/scene_handoff.json')
  assert.equal(exported.json.export.artifacts.engine_consumer_validation, 'workspace/projects/project_demo/exports/api_export/consumer_evidence/engine_consumer_validation.json')
  assert.equal(exported.json.export.artifacts.manual_import_checklist, 'workspace/projects/project_demo/exports/api_export/consumer_evidence/manual_import_checklist.md')
  assert.equal(exported.json.export.review_status.status, 'pass')
  assert.equal(exported.json.export.review_status.consumer_readiness, 'preview_metadata_only')

  const manifest = await fetchJson(baseUrl, exported.json.export.urls.manifest_url)
  assert.equal(manifest.status, 200)
  assert.equal(manifest.json.version, 'editor_project_pack_v1')
  assert.equal(manifest.json.project_id, 'project_demo')
  assert.equal(manifest.json.review_status.consumer_readiness, 'preview_metadata_only')

  const handoff = await fetchJson(baseUrl, exported.json.export.urls.engine_handoff_manifest_url)
  assert.equal(handoff.status, 200)
  assert.equal(handoff.json.version, 'engine_handoff_manifest_v1')
  assert.equal(handoff.json.validation.status, 'pass')

  const consumerValidation = await fetchJson(baseUrl, exported.json.export.urls.engine_consumer_validation_url)
  assert.equal(consumerValidation.status, 200)
  assert.equal(consumerValidation.json.version, 'engine_consumer_validation_v1')
  assert.equal(consumerValidation.json.status, 'pass')

  const checklistResponse = await fetch(new URL(exported.json.export.urls.manual_import_checklist_url, baseUrl))
  assert.equal(checklistResponse.status, 200)
  assert.equal(checklistResponse.headers.get('content-type'), 'text/markdown; charset=utf-8')
  assert.match(await checklistResponse.text(), /Engine Consumer Manual Import Checklist/)

  const zipResponse = await fetch(new URL(exported.json.export.urls.zip_url, baseUrl))
  assert.equal(zipResponse.status, 200)
  assert.equal(zipResponse.headers.get('content-type'), 'application/zip')

  const stale = await fetchJson(baseUrl, '/api/editor/projects/project_demo/export-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0 }),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'revision_conflict')
})

test('general import rejects reprocess jobs from the injected store before context or copy', async (t) => {
  const root = await tempRoot()
  const generated = path.join(root, 'generated')
  const specializedDir = path.join(generated, 'job_specialized')
  const tamperedDir = path.join(generated, 'job_tampered_context')
  const legacyDir = path.join(generated, 'job_legacy')
  for (const directory of [specializedDir, tamperedDir, legacyDir]) {
    await mkdir(directory, { recursive: true })
  }
  await writeFile(
    path.join(tamperedDir, 'editor_reprocess_context.json'),
    JSON.stringify({ job_type: 'legacy_character_pack' }),
  )
  await writeFile(path.join(legacyDir, 'normalized_sheet.png'), 'sheet')
  await writeFile(path.join(legacyDir, 'animations.json'), JSON.stringify({
    profile: 'topdown_rpg_v0',
    frame_size: { w: 96, h: 96 },
    anchor: { x: 48, y: 88 },
    animations: { walk_down: { frames: [0], fps: 8, loop: true, mode: 'loop' } },
  }))
  await writeFile(path.join(legacyDir, 'metadata.json'), JSON.stringify({
    id: 'legacy',
    name: 'Legacy',
    profile: 'topdown_rpg_v0',
    source: { type: 'upload' },
    generation: {},
  }))
  await writeFile(path.join(legacyDir, 'editor_metadata.json'), JSON.stringify({ version: '0.1', frames: {} }))
  await writeFile(path.join(legacyDir, 'debug_report.json'), JSON.stringify({ validation: { status: 'pass' } }))

  const reprocessService = Object.freeze({
    enqueue() {},
    getJob(id) {
      if (['job_specialized', 'job_tampered_context'].includes(id)) {
        return { id, type: 'editor_character_reprocess' }
      }
      return id === 'job_legacy' ? { id, type: 'character_pack' } : null
    },
  })
  const { server, baseUrl } = await startEditorApiServer(root, { reprocessService })
  t.after(() => server.close())
  const created = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'project_demo', name: 'Demo Project', now: timestamp }),
  })
  assert.equal(created.status, 201)

  for (const jobId of ['job_specialized', 'job_tampered_context']) {
    const response = await fetchJson(baseUrl, '/api/editor/projects/project_demo/import-job', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 1,
        kind: 'character_pack',
        jobId,
        assetId: 'asset_forbidden',
      }),
    })
    assert.equal(response.status, 400)
    assert.equal(response.json.error, 'specialized_accept_required')
  }

  const legacy = await fetchJson(baseUrl, '/api/editor/projects/project_demo/import-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      kind: 'character_pack',
      jobId: 'job_legacy',
      assetId: 'asset_legacy',
    }),
  })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.json.revision.source_job_id, 'job_legacy')
})

test('server delegates /api/editor namespace to editor API handler', async (t) => {
  const root = await tempRoot()
  await mkdir(path.join(root, 'generated'), { recursive: true })
  const probeServer = http.createServer()
  const port = await listen(probeServer)
  probeServer.close()
  await once(probeServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      EDITOR_WORKSPACE_ROOT: path.join(root, 'workspace'),
      EDITOR_GENERATED_DIR: path.join(root, 'generated'),
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const response = await fetchJson(`http://127.0.0.1:${port}`, '/api/editor/health')
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.version, 'editor_project_api_v0')

  const editorResponse = await fetchText(`http://127.0.0.1:${port}`, '/editor')
  assert.equal(editorResponse.status, 200)
  assert.match(editorResponse.text, /data-editor-shell/)
  assert.match(editorResponse.text, /src\/editor-app\.js/)
  assert.match(editorResponse.text, /editor-export-project-pack/)

  await writeFile(path.join(root, 'generated', 'keep.txt'), 'source remains explicit')
})
