import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

import { writeProjectPackArtifacts } from '../../src/project-pack/artifactWriter.js'
import { buildProjectPack } from '../../src/project-pack/projectPack.js'
import { buildProjectPackZip } from '../../src/project-pack/zipExport.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function makeCharacterResult(status = 'pass') {
  return {
    metadataJson: {
      id: 'hero_pack',
      profile: 'topdown_rpg_v0',
      quality: { status },
    },
    animationsJson: { profile: 'topdown_rpg_v0', animations: {} },
    editorMetadataJson: { profile: 'topdown_rpg_v0' },
    debugReport: {
      profile: 'topdown_rpg_v0',
      pixel_style: {
        mode: 'report_only',
        output_mutation: 'none',
        palette: {
          max_colors: 2,
          colors: [{ hex: '#102030', rgb: [16, 32, 48], count: 10, ratio: 1 }],
        },
      },
      validation: {
        status,
        warnings: status === 'warning' ? ['edge_pressure_high'] : [],
        blocking_errors: status === 'fail' ? ['frame_0_empty'] : [],
      },
    },
    files: {
      sourcePng: Buffer.from('source'),
      normalizedSheetPng: Buffer.from('sheet'),
      zipBuffer: Buffer.from('character-zip'),
    },
  }
}

function makeSceneResult(status = 'pass') {
  return {
    sceneJson: { identifier: 'meadow_scene' },
    tileAtlasMetadata: { profile: 'topdown_tile_dual_grid_v0' },
    tileMap: { profile: 'topdown_tile_dual_grid_v0', width: 1, height: 1, cells: [] },
    qualityGate: {
      profile: 'topdown_tile_dual_grid_v0',
      status,
      warnings: status === 'warning' ? ['tile.duplicate_runtime_tile'] : [],
      blocking_errors: status === 'fail' ? ['tile.visual_seam_mismatch'] : [],
    },
    ldtkProjectJson: { jsonVersion: '1.5.3', levels: [] },
    styleCorrection: {
      mode: 'palette_snap',
      palette: {
        max_colors: 2,
        colors: [{ hex: '#102030', rgb: [16, 32, 48], count: 10, ratio: 1 }],
      },
      metrics: {
        before: { off_palette_ratio: 0 },
        after: { off_palette_ratio: 0 },
      },
    },
    files: {
      tilesetPng: Buffer.from('tileset'),
      zipBuffer: Buffer.from('scene-zip'),
    },
  }
}

test('buildProjectPack joins character and scene outputs under a shared project manifest', () => {
  const result = buildProjectPack({
    projectId: 'demo_project',
    createdAt: '2026-06-06T00:00:00.000Z',
    characterResult: makeCharacterResult(),
    sceneResult: makeSceneResult(),
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.validation.status, 'pass')
  assert.equal(result.projectManifest.project_id, 'demo_project')
  assert.equal(result.projectManifest.packs.character.id, 'hero_pack')
  assert.equal(result.projectManifest.packs.scene.id, 'meadow_scene')
  assert.equal(result.projectManifest.style_contract.source, 'character_pixel_style_report')
  assert.equal(result.projectManifest.packs.character.artifacts.sheet, 'character/normalized_sheet.png')
  assert.equal(result.projectManifest.packs.scene.artifacts.ldtk_project, 'scene/project.ldtk')
})

test('buildProjectPack warns when shared style evidence is missing or mismatched', () => {
  const sceneResult = makeSceneResult()
  sceneResult.styleCorrection = {
    mode: 'palette_snap',
    palette: {
      max_colors: 1,
      colors: [{ hex: '#ffffff', rgb: [255, 255, 255], count: 10, ratio: 1 }],
    },
  }
  const result = buildProjectPack({
    projectId: 'style_warning_project',
    characterResult: makeCharacterResult(),
    sceneResult,
  })

  assert.equal(result.status, 'warning')
  assert.equal(result.validation.style_contract.status, 'warning')
  assert.ok(result.validation.warnings.includes('scene_style_palette_mismatch'))
  assert.equal(result.validation.metrics.style_character_palette_overlap_ratio, 1)
  assert.equal(result.validation.metrics.style_scene_palette_overlap_ratio, 0)
})

test('buildProjectPack can enforce shared style warnings as strict failures', () => {
  const sceneResult = makeSceneResult()
  sceneResult.styleCorrection = {
    mode: 'palette_snap',
    palette: {
      max_colors: 1,
      colors: [{ hex: '#ffffff', rgb: [255, 255, 255], count: 10, ratio: 1 }],
    },
  }
  const result = buildProjectPack({
    projectId: 'style_strict_project',
    characterResult: makeCharacterResult(),
    sceneResult,
    stylePolicy: 'strict',
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.validation.style_contract.policy, 'strict')
  assert.ok(result.validation.blocking_errors.includes('style_contract_failed'))
  assert.ok(result.validation.warnings.includes('scene_style_palette_mismatch'))
})

test('buildProjectPack ignores unknown style policy values and keeps warn mode', () => {
  const sceneResult = makeSceneResult()
  sceneResult.styleCorrection = null
  const result = buildProjectPack({
    projectId: 'style_policy_fallback_project',
    characterResult: makeCharacterResult(),
    sceneResult,
    stylePolicy: 'loud',
  })

  assert.equal(result.status, 'warning')
  assert.equal(result.validation.style_contract.policy, 'warn')
  assert.deepEqual(result.validation.blocking_errors, [])
  assert.ok(result.validation.warnings.includes('scene_style_report_missing'))
})

test('buildProjectPack warns when style reports are not available for enforcement', () => {
  const characterResult = makeCharacterResult()
  delete characterResult.debugReport.pixel_style
  const sceneResult = makeSceneResult()
  delete sceneResult.styleCorrection
  const result = buildProjectPack({
    projectId: 'style_missing_project',
    characterResult,
    sceneResult,
  })

  assert.equal(result.status, 'warning')
  assert.ok(result.validation.warnings.includes('style_contract_palette_empty'))
  assert.ok(result.validation.warnings.includes('character_style_report_missing'))
  assert.ok(result.validation.warnings.includes('scene_style_report_missing'))
  assert.equal(result.validation.metrics.style_has_character_style_report, false)
  assert.equal(result.validation.metrics.style_has_scene_style_report, false)
})

test('buildProjectPack surfaces child package failures before export', () => {
  const result = buildProjectPack({
    projectId: 'broken_project',
    characterResult: makeCharacterResult('fail'),
    sceneResult: makeSceneResult('fail'),
  })

  assert.equal(result.status, 'fail')
  assert.deepEqual(result.validation.blocking_errors, [
    'character_pack_failed_validation',
    'scene_pack_failed_quality_gate',
  ])
})

test('buildProjectPack fails when child artifact directories are incomplete', () => {
  const characterResult = makeCharacterResult()
  delete characterResult.files.zipBuffer
  const sceneResult = makeSceneResult()
  delete sceneResult.files.tilesetPng
  const result = buildProjectPack({
    projectId: 'incomplete_project',
    characterResult,
    sceneResult,
  })

  assert.equal(result.status, 'fail')
  assert.deepEqual(result.validation.blocking_errors, [
    'character_artifacts_incomplete',
    'scene_artifacts_incomplete',
  ])
  assert.equal(result.validation.metrics.has_character_artifacts, false)
  assert.equal(result.validation.metrics.has_scene_artifacts, false)
})

test('buildProjectPackZip keeps character and scene artifacts in separate folders', async () => {
  const result = buildProjectPack({
    projectId: 'demo_project',
    characterResult: makeCharacterResult(),
    sceneResult: makeSceneResult(),
  })
  const zipBuffer = await buildProjectPackZip(result)
  const zip = await JSZip.loadAsync(zipBuffer)

  assert.equal(JSON.parse(await zip.file('project_manifest.json').async('string')).project_id, 'demo_project')
  assert.equal(await zip.file('character/normalized_sheet.png').async('string'), 'sheet')
  assert.equal(JSON.parse(await zip.file('character/metadata.json').async('string')).id, 'hero_pack')
  assert.equal(await zip.file('character/character_pack.zip').async('string'), 'character-zip')
  assert.equal(JSON.parse(await zip.file('scene/scene.json').async('string')).identifier, 'meadow_scene')
  assert.equal(await zip.file('scene/tileset.png').async('string'), 'tileset')
  assert.equal(await zip.file('scene/scene_pack.zip').async('string'), 'scene-zip')
})

test('writeProjectPackArtifacts writes project manifest, validation, and zip', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'project-pack-artifact-writer-'))
  const result = buildProjectPack({
    projectId: 'demo_project',
    characterResult: makeCharacterResult(),
    sceneResult: makeSceneResult(),
  })
  const summary = await writeProjectPackArtifacts({
    jobId: 'project_pack',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'done')
  assert.equal(summary.reason, null)
  assert.equal(summary.urls.project_pack_zip_url, '/generated/project_pack/project_pack.zip')
  assert.equal(await exists(path.join(outputDir, 'project_pack', 'project_manifest.json')), true)
  assert.equal(await exists(path.join(outputDir, 'project_pack', 'project_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'project_pack', 'project_pack.zip')), true)
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'project_pack', 'project_validation.json'), 'utf8')).status, 'pass')
})
