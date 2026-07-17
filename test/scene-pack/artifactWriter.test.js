import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import { buildScenePackArtifactManifest } from '../../src/scene-pack/artifactManifest.js'
import { writeScenePackArtifacts } from '../../src/scene-pack/artifactWriter.js'
import { buildScenePackZip } from '../../src/scene-pack/zipExport.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function makeResult(qualityStatus = 'pass') {
  return {
    sceneJson: { format: 'ldtk_style_scene_pack_v0', identifier: 'smoke_scene' },
    tileAtlasMetadata: { profile: 'topdown_tile_dual_grid_v0', tiles: [] },
    tileMap: { profile: 'topdown_tile_dual_grid_v0', width: 1, height: 1, cells: [] },
    qualityGate: {
      schema_version: 1,
      profile: 'topdown_tile_dual_grid_v0',
      status: qualityStatus,
      blocking_errors: qualityStatus === 'fail' ? ['tile.visual_seam_mismatch'] : [],
    },
    ldtkProjectJson: { jsonVersion: '1.5.3', iid: 'iid_project', levels: [] },
    projectManifest: { version: 'scene_character_project_v0', project_id: 'smoke_project' },
    files: {
      tilesetPng: Buffer.from('tileset'),
      promptTxt: Buffer.from('prompt'),
      generationJson: { mode: 'dry_run_prompt' },
      zipBuffer: Buffer.from('zip'),
    },
  }
}

test('buildScenePackZip includes scene, tile, quality, project, and prompt artifacts', async () => {
  const result = makeResult()
  const zipBuffer = await buildScenePackZip(result)
  const zip = await JSZip.loadAsync(zipBuffer)

  assert.ok(Buffer.isBuffer(zipBuffer))
  assert.equal(JSON.parse(await zip.file('scene.json').async('string')).identifier, 'smoke_scene')
  assert.equal(JSON.parse(await zip.file('tile_atlas.json').async('string')).profile, 'topdown_tile_dual_grid_v0')
  assert.equal(JSON.parse(await zip.file('quality_gate.json').async('string')).status, 'pass')
  assert.equal(JSON.parse(await zip.file('project_manifest.json').async('string')).project_id, 'smoke_project')
  assert.equal(JSON.parse(await zip.file('project.ldtk').async('string')).jsonVersion, '1.5.3')
  assert.equal(await zip.file('prompt.txt').async('string'), 'prompt')
  assert.equal(await zip.file('tileset.png').async('string'), 'tileset')
})

test('buildScenePackArtifactManifest maps scene files to generated URLs', () => {
  const manifest = buildScenePackArtifactManifest('scene_job', makeResult())

  assert.deepEqual(manifest.files.map((file) => file.name), [
    'scene.json',
    'tile_atlas.json',
    'tile_map.json',
    'quality_gate.json',
    'project.ldtk',
    'project_manifest.json',
    'tileset.png',
    'prompt.txt',
    'generation.json',
    'scene_pack.zip',
  ])
  assert.equal(manifest.urls.scene_url, '/generated/scene_job/scene.json')
  assert.equal(manifest.urls.quality_gate_url, '/generated/scene_job/quality_gate.json')
  assert.equal(manifest.urls.ldtk_project_url, '/generated/scene_job/project.ldtk')
  assert.equal(manifest.urls.zip_url, '/generated/scene_job/scene_pack.zip')
})

test('scene pack artifacts include candidate selection evidence', async () => {
  const result = makeResult()
  result.candidateSelection = {
    schema_version: 1,
    mode: 'scene_tile_candidate_selection_v0',
    candidate_count: 2,
    selected_candidate_id: 'candidate_02',
    selected_status: 'pass',
    selection_reason: 'candidate_02 selected from 2 candidates; passed strict quality gate',
    ranking: [],
  }
  result.files.candidateArtifacts = [
    { name: 'candidates/candidate_01/quality_gate.json', content: { status: 'fail' } },
    { name: 'candidates/candidate_02/tileset.png', content: Buffer.from('candidate-two') },
  ]

  const manifest = buildScenePackArtifactManifest('scene_job', result)
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'scene-artifact-candidates-'))
  await writeScenePackArtifacts({ jobId: 'scene_job', outputDir, result })
  const zip = await JSZip.loadAsync(await buildScenePackZip(result))

  assert.equal(manifest.urls.candidate_selection_url, '/generated/scene_job/candidate_selection.json')
  assert.equal(
    manifest.urls.candidate_artifact_urls['candidates/candidate_01/quality_gate.json'],
    '/generated/scene_job/candidates/candidate_01/quality_gate.json'
  )
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'scene_job', 'candidate_selection.json'), 'utf8')).selected_candidate_id, 'candidate_02')
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'scene_job', 'candidates', 'candidate_01', 'quality_gate.json'), 'utf8')).status, 'fail')
  assert.equal(JSON.parse(await zip.file('candidate_selection.json').async('string')).candidate_count, 2)
  assert.equal(await zip.file('candidates/candidate_02/tileset.png').async('string'), 'candidate-two')
})

test('scene pack artifacts include optional tile conditioning review outputs', async () => {
  const result = makeResult()
  result.tileConditioningReview = {
    schema_version: 1,
    mode: 'tile_conditioning_review_v0',
    status: 'warning',
    warnings: ['tile.edge_conditioning_visible_mutation'],
  }
  result.files.tileConditioningReviewPng = Buffer.from('review-png')

  const manifest = buildScenePackArtifactManifest('scene_job', result)
  const zip = await JSZip.loadAsync(await buildScenePackZip(result))

  assert.equal(manifest.urls.tile_conditioning_review_url, '/generated/scene_job/tile_conditioning_review.json')
  assert.equal(manifest.urls.tile_conditioning_review_image_url, '/generated/scene_job/tile_conditioning_review.png')
  assert.equal(JSON.parse(await zip.file('tile_conditioning_review.json').async('string')).status, 'warning')
  assert.equal(await zip.file('tile_conditioning_review.png').async('string'), 'review-png')
})

test('scene pack artifacts include optional style correction outputs', async () => {
  const result = makeResult()
  result.styleCorrection = {
    mode: 'palette_snap',
    output_mutation: 'palette_snap',
    changed_pixel_count: 8,
    changed_pixel_ratio: 0.125,
  }

  const manifest = buildScenePackArtifactManifest('scene_job', result)
  const zip = await JSZip.loadAsync(await buildScenePackZip(result))

  assert.equal(manifest.urls.style_correction_url, '/generated/scene_job/style_correction.json')
  assert.equal(JSON.parse(await zip.file('style_correction.json').async('string')).mode, 'palette_snap')
})

test('writeScenePackArtifacts writes files and returns quality status summary', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'scene-artifact-writer-'))
  const summary = await writeScenePackArtifacts({
    jobId: 'scene_job',
    outputDir,
    result: makeResult('pass'),
  })

  assert.equal(summary.status, 'done')
  assert.equal(summary.reason, null)
  assert.equal(summary.urls.scene_pack_zip_url, '/generated/scene_job/scene_pack.zip')
  assert.equal(await exists(path.join(outputDir, 'scene_job', 'scene_pack.zip')), true)
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'scene_job', 'quality_gate.json'), 'utf8')).status, 'pass')
})

test('writeScenePackArtifacts builds scene zip when the result has no prebuilt buffer', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'scene-artifact-writer-build-zip-'))
  const result = makeResult('pass')
  delete result.files.zipBuffer

  await writeScenePackArtifacts({
    jobId: 'scene_zip',
    outputDir,
    result,
  })

  const zip = await JSZip.loadAsync(await readFile(path.join(outputDir, 'scene_zip', 'scene_pack.zip')))
  assert.equal(JSON.parse(await zip.file('scene.json').async('string')).identifier, 'smoke_scene')
})

test('writeScenePackArtifacts reports failed tile quality gate', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'scene-artifact-writer-fail-'))
  const summary = await writeScenePackArtifacts({
    jobId: 'scene_fail',
    outputDir,
    result: makeResult('fail'),
  })

  assert.equal(summary.status, 'failed_quality_gate')
  assert.equal(summary.reason, 'tile.visual_seam_mismatch')
  assert.equal(summary.retry_hint, 'inspect_tile_quality_gate')
})
