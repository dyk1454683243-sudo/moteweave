import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import {
  buildEditorProjectPack,
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  EDITOR_PROJECT_PACK_VERSION,
  writeEditorProjectPackArtifacts,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-project-pack-'))
}

async function writeManagedFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

function managedPath(fileName) {
  return `workspace/projects/project_demo/assets/asset_hero/rev_001/${fileName}`
}

function makeProject() {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_hero',
    createdAt: timestamp,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      sheet: managedPath('normalized_sheet.png'),
      animations: managedPath('animations.json'),
      metadata: managedPath('metadata.json'),
      editor_metadata: managedPath('editor_metadata.json'),
      debug_report: managedPath('debug_report.json'),
      godot_npc_zip: managedPath('godot_npc_pack.zip'),
    },
  })
  project.assets.asset_hero = createAssetRef({
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
  return project
}

async function writeProjectFiles(root, project) {
  const revision = project.assets.asset_hero.revisions.rev_001
  for (const [key, relativePath] of Object.entries(revision.artifacts)) {
    await writeManagedFile(root, relativePath, key === 'godot_npc_zip' ? 'godot zip bytes' : `${key} file`)
  }
}

test('editor project pack writes project docs, managed assets, and supported engine payloads', async () => {
  const root = await tempRoot()
  const project = makeProject()
  await writeProjectFiles(root, project)

  const written = await writeEditorProjectPackArtifacts({
    project,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    exportId: 'export_unit',
    now: timestamp,
  })

  assert.equal(written.status, 'pass')
  assert.equal(written.artifacts.zip, 'workspace/projects/project_demo/exports/export_unit/editor_project_pack.zip')
  assert.equal(written.artifacts.engine_consumer_validation, 'workspace/projects/project_demo/exports/export_unit/consumer_evidence/engine_consumer_validation.json')
  assert.equal(written.artifacts.manual_import_checklist, 'workspace/projects/project_demo/exports/export_unit/consumer_evidence/manual_import_checklist.md')

  const manifest = JSON.parse(await readFile(path.join(root, written.artifacts.manifest), 'utf8'))
  assert.equal(manifest.version, EDITOR_PROJECT_PACK_VERSION)
  assert.equal(manifest.counts.engine_payloads, 1)
  assert.equal(manifest.review_status.status, 'pass')
  assert.equal(manifest.review_status.consumer_readiness, 'preview_metadata_only')

  const zip = await JSZip.loadAsync(await readFile(path.join(root, written.artifacts.zip)))
  assert.equal(JSON.parse(await zip.file('project.json').async('string')).version, 'editor_project_v0')
  assert.equal(JSON.parse(await zip.file('editor_project_validation.json').async('string')).status, 'pass')
  assert.equal(JSON.parse(await zip.file('asset_references.json').async('string')).assets.asset_hero.active_revision.artifacts.sheet.pack_path, 'assets/asset_hero/rev_001/normalized_sheet.png')
  assert.equal(JSON.parse(await zip.file('consumer_evidence/engine_consumer_validation.json').async('string')).status, 'pass')
  assert.equal(JSON.parse(await zip.file('consumer_evidence/manual_import_evidence.json').async('string')).review_status.consumer_readiness, 'preview_metadata_only')
  assert.match(await zip.file('consumer_evidence/manual_import_checklist.md').async('string'), /LDtk Preview Metadata/)
  assert.equal(JSON.parse(await zip.file('scenes/scene_main.json').async('string')).version, 'editor_scene_v0')
  assert.equal(await zip.file('assets/asset_hero/rev_001/normalized_sheet.png').async('string'), 'sheet file')
  assert.equal(await zip.file('engines/godot/asset_hero_rev_001.zip').async('string'), 'godot zip bytes')
})

test('editor project pack validation fails when managed artifact files are missing', async () => {
  const root = await tempRoot()
  const project = makeProject()
  const pack = buildEditorProjectPack(project, { projectRoot: root, createdAt: timestamp })

  assert.equal(pack.status, 'fail')
  assert.ok(pack.validationReport.blocking_errors.includes('asset_artifact_file_missing'))
  assert.ok(pack.validationReport.diagnostics.missing_artifacts.includes('asset_hero:rev_001:sheet'))
})

test('editor project pack rejects artifact files outside the editor workspace', async () => {
  const root = await tempRoot()
  const project = makeProject()
  project.assets.asset_hero.revisions.rev_001.artifacts.sheet = 'loose_sheet.png'
  await writeProjectFiles(root, project)

  const pack = buildEditorProjectPack(project, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    createdAt: timestamp,
  })

  assert.equal(pack.status, 'fail')
  assert.ok(pack.validationReport.blocking_errors.includes('unsafe_asset_artifact_path'))
  assert.ok(pack.validationReport.diagnostics.unsafe_artifacts.includes('asset_hero:rev_001:sheet'))
})

test('editor project pack rejects cross-project workspace artifact references', async () => {
  const root = await tempRoot()
  const project = makeProject()
  project.assets.asset_hero.revisions.rev_001.artifacts.sheet = 'workspace/projects/other_project/assets/asset_hero/rev_001/normalized_sheet.png'
  await writeProjectFiles(root, project)

  const pack = buildEditorProjectPack(project, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    createdAt: timestamp,
  })

  assert.equal(pack.status, 'fail')
  assert.ok(pack.validationReport.blocking_errors.includes('unsafe_asset_artifact_path'))
  assert.ok(pack.validationReport.diagnostics.unsafe_artifacts.includes('asset_hero:rev_001:sheet'))
})
