import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import {
  createDefaultEditorProject,
  importGeneratedJobAsAsset,
  validateEditorProject,
} from '../../src/editor-project/index.js'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-artifact-registry-'))
}

async function tinyPng(seed = 20) {
  return encodeRgbaPng({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      seed, 30, 40, 255, 30, 40, 50, 255,
      40, 50, 60, 255, 50, 60, 70, 255,
    ]),
  })
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeCharacterJob(root, jobId, { status = 'pass', sourceType = 'upload' } = {}) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'source.png'), await tinyPng())
  await writeFile(path.join(dir, 'normalized_sheet.png'), await tinyPng(30))
  await writeJson(path.join(dir, 'animations.json'), {
    version: '0.1',
    profile: 'topdown_rpg_v0',
    sheet: 'normalized_sheet.png',
    frame_size: { w: 96, h: 96 },
    anchor: { x: 48, y: 88 },
    animations: { walk_down: { fps: 10, loop: true, mode: 'loop', frames: [16, 17, 18, 19] } },
  })
  await writeJson(path.join(dir, 'metadata.json'), {
    version: '0.1',
    id: 'hero',
    name: 'Hero',
    profile: 'topdown_rpg_v0',
    source: { type: sourceType },
    generation: { provider: null, model: null },
    quality: { status },
  })
  await writeJson(path.join(dir, 'editor_metadata.json'), { version: '0.1', frames: {} })
  await writeJson(path.join(dir, 'debug_report.json'), { validation: { status, warnings: [], blocking_errors: [] } })
  return dir
}

async function writeSceneJob(root, jobId, { status = 'pass' } = {}) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await writeJson(path.join(dir, 'scene.json'), {
    version: 'scene_pack_v0', id: 'forest_scene', name: 'Forest Scene', profile: 'topdown_tile_dual_grid_v0',
  })
  await writeJson(path.join(dir, 'tile_map.json'), { profile: 'topdown_tile_dual_grid_v0', width: 2, height: 2, tiles: [] })
  await writeJson(path.join(dir, 'tile_atlas.json'), { profile: 'topdown_tile_dual_grid_v0', tiles: [] })
  await writeJson(path.join(dir, 'quality_gate.json'), { status, warnings: [], blocking_errors: status === 'fail' ? ['seam'] : [] })
  await writeFile(path.join(dir, 'tileset.png'), await tinyPng())
  return dir
}

function project() {
  return createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
}

test('artifact registry imports explicit character artifacts as immutable managed revisions', async () => {
  const root = await tempRoot()
  await writeCharacterJob(root, 'job_hero')
  const result = await importGeneratedJobAsAsset({
    project: project(),
    kind: 'character_pack',
    jobId: 'job_hero',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    assetId: 'asset_hero',
  })

  assert.equal(result.revision.id, 'rev_001')
  assert.equal(result.asset.active_revision_id, 'rev_001')
  assert.deepEqual(result.asset.clips.walk_down.frames, [16, 17, 18, 19])
  assert.equal(existsSync(path.join(root, result.revision.artifacts.sheet)), true)
  assert.equal(validateEditorProject(result.project).status, 'pass')
})

test('artifact registry creates a parented revision when the same character asset is imported again', async () => {
  const root = await tempRoot()
  await writeCharacterJob(root, 'job_first')
  await writeCharacterJob(root, 'job_second', { status: 'warning', sourceType: 'derived_revision' })
  const first = await importGeneratedJobAsAsset({
    project: project(), kind: 'character_pack', jobId: 'job_first', generatedDir: path.join(root, 'generated'),
    projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: 'asset_hero',
  })
  const second = await importGeneratedJobAsAsset({
    project: first.project, kind: 'character_pack', jobId: 'job_second', generatedDir: path.join(root, 'generated'),
    projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: 'asset_hero',
  })

  assert.equal(second.revision.id, 'rev_002')
  assert.equal(second.revision.parent_revision_id, 'rev_001')
  assert.equal(second.revision.quality_status, 'warning')
  assert.equal(first.project.assets.asset_hero.active_revision_id, 'rev_001')
})

test('artifact registry imports failed scene packs as blocked and rejects unsafe job ids', async () => {
  const root = await tempRoot()
  await writeSceneJob(root, 'job_scene_fail', { status: 'fail' })
  const failedScene = await importGeneratedJobAsAsset({
    project: project(), kind: 'scene_pack', jobId: 'job_scene_fail', generatedDir: path.join(root, 'generated'),
    projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: 'asset_scene',
  })
  assert.equal(failedScene.revision.production_status, 'blocked')
  assert.equal(failedScene.revision.quality_status, 'fail')
  await assert.rejects(
    importGeneratedJobAsAsset({
      project: project(), kind: 'character_pack', jobId: '../escape', generatedDir: path.join(root, 'generated'),
      projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: 'asset_escape',
    }),
    /job id is unsafe/i,
  )
})

test('general importer blocks both retired reprocess evidence and current action-repair Review evidence', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const retired = await writeCharacterJob(root, 'job_retired_reprocess')
  await writeJson(path.join(retired, 'editor_reprocess_context.json'), { job_type: 'editor_character_reprocess' })
  const current = await writeCharacterJob(root, 'job_action_repair')
  await writeJson(path.join(current, 'fixed_region_action_repair_review.json'), { job_type: 'fixed_region_source_provider_repair' })

  for (const jobId of ['job_retired_reprocess', 'job_action_repair']) {
    await assert.rejects(
      importGeneratedJobAsAsset({
        project: project(), kind: 'character_pack', jobId, generatedDir,
        specializedContextGeneratedDir: generatedDir,
        projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: `asset_${jobId}`,
      }),
      (error) => error?.code === 'specialized_accept_required',
    )
  }
})

test('artifact registry rejects generated artifact symlink escapes', async () => {
  const root = await tempRoot()
  const outside = path.join(await tempRoot(), 'outside.png')
  await writeFile(outside, await tinyPng(90))
  const dir = await writeCharacterJob(root, 'job_symlink_escape')
  const sheet = path.join(dir, 'normalized_sheet.png')
  await writeFile(sheet, await tinyPng(70))
  await symlink(outside, path.join(dir, 'source_layout_overlay.png'))

  await assert.rejects(
    importGeneratedJobAsAsset({
      project: project(), kind: 'character_pack', jobId: 'job_symlink_escape', generatedDir: path.join(root, 'generated'),
      projectRoot: root, workspaceRoot: path.join(root, 'workspace'), assetId: 'asset_escape',
    }),
    (error) => ['unsafe_artifact_path', 'artifact_integrity_failed'].includes(error?.code),
  )
})
