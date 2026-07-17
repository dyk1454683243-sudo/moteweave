import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import sharp from 'sharp'

const execFileAsync = promisify(execFile)
const cliPath = path.resolve('scripts/character-pack-cli.mjs')

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startMockOpenRouter(imageBuffer) {
  const responses = Array.isArray(imageBuffer) ? imageBuffer : [imageBuffer]
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'application/json' })
    const responseBuffer = responses[Math.min(requests.length - 1, responses.length - 1)]
    res.end(JSON.stringify({
      choices: [{
        message: {
          images: [{
            image_url: {
              url: `data:image/png;base64,${responseBuffer.toString('base64')}`,
            },
          }],
        },
      }],
    }))
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1/chat/completions` }
}

async function runCli(args, env = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function runCliError(args, env = {}) {
  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    return error
  }
  throw new Error(`Expected CLI command to fail: ${args.join(' ')}`)
}

function cleanMaterialSourceBenchmarkReport(runId) {
  return {
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1',
    status: 'pass',
    run_id: runId,
    summary: {
      status: 'pass',
      case_count: 1,
      candidate_count: 1,
      selected_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      stopped_early: false,
      failure_taxonomy: { top_categories: [] },
    },
    cases: [{
      id: 'mossy_cliff',
      candidates: [{
        id: 'candidate_01',
        case_id: 'mossy_cliff',
        status: 'pass',
        warnings: [],
        blocking_errors: [],
        output_dir: 'items/mossy_cliff_v1/candidate_01',
      }],
      candidate_selection: {
        selected_candidate_id: 'candidate_01',
        selected_status: 'pass',
        selection_reason: 'candidate_01 selected as the only completed candidate; passed local validation',
        ranking: [{
          id: 'candidate_01',
          case_id: 'mossy_cliff',
          status: 'pass',
          warnings: [],
          blocking_errors: [],
          output_dir: 'items/mossy_cliff_v1/candidate_01',
        }],
      },
    }],
    claim_boundary: 'Provider output is raw material source only.',
  }
}

async function writeManualMaterialSource(dir) {
  const sourcePath = path.join(dir, 'manual-material-source.png')
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="170" height="128" fill="#2f8f3f"/>',
    '<rect x="170" y="0" width="171" height="128" fill="#7a5435"/>',
    '<rect x="341" y="0" width="171" height="128" fill="#b6d46d"/>',
    '<rect x="0" y="128" width="170" height="128" fill="#67b04f"/>',
    '<rect x="170" y="128" width="171" height="128" fill="#8f7f45"/>',
    '<rect x="341" y="128" width="171" height="128" fill="#1d2119"/>',
    '</svg>',
  ].join('')
  await writeFile(sourcePath, svg)
  return sourcePath
}

async function makeProviderMaterialSourcePng() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect width="1024" height="1024" fill="#1d2119"/>',
    '<rect x="0" y="0" width="512" height="342" fill="#4f9a45"/>',
    '<rect x="512" y="0" width="512" height="342" fill="#765235"/>',
    '<rect x="0" y="342" width="512" height="341" fill="#b6d46d"/>',
    '<rect x="512" y="342" width="512" height="341" fill="#77b457"/>',
    '<rect x="0" y="683" width="512" height="341" fill="#8c7c43"/>',
    '<rect x="512" y="683" width="512" height="341" fill="#242820"/>',
    '<rect x="96" y="88" width="48" height="48" fill="#8fca63"/>',
    '<rect x="624" y="112" width="64" height="48" fill="#8d6844"/>',
    '<rect x="184" y="486" width="80" height="24" fill="#d7e88b"/>',
    '<rect x="616" y="506" width="32" height="32" fill="#a6d96a"/>',
    '<rect x="132" y="812" width="90" height="28" fill="#c7d66c"/>',
    '<rect x="678" y="820" width="100" height="36" fill="#303528"/>',
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function writeMaterialSourceEvidenceManifest(dir) {
  const sourcePath = path.join(dir, 'flat-material-source.png')
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: '#777777ff',
    },
  })
    .png()
    .toFile(sourcePath)
  const manifestPath = path.join(dir, 'material-source-manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'cli_material_source_evidence',
      samples: [{
        id: 'flat_source',
        file: 'flat-material-source.png',
        source_rights: 'test_generated',
        expected_status: 'warning',
      }],
    })
  )
  return manifestPath
}

test('tileset build-two-point-five-d writes schema-first local artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-'))
  const result = await runCli([
    'tileset',
    'build-two-point-five-d',
    '--contract',
    'configs/two_point_five_d/block_autotile_v1.json',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_tileset',
  ])

  assert.equal(result.command, 'tileset build-two-point-five-d')
  assert.equal(result.status, 'pass')
  assert.equal(result.contract_id, 'two_point_five_d_block_autotile_v1')
  assert.equal(result.validation.metrics.tile_count, 16)
  assert.equal(result.validation.metrics.available_cell_count, 256)
  assert.deepEqual(result.validation.metrics.strict_atlas_size, { width: 1024, height: 1024 })
  assert.deepEqual(result.validation.metrics.full_atlas_grid, { columns: 16, rows: 16 })
  assert.deepEqual(result.validation.metrics.occupied_rule_grid, { columns: 4, rows: 4 })
  assert.equal(result.validation.metrics.rule_profile_id, 'corner_mask_16')
  assert.equal(result.validation.metrics.material_mode, 'procedural')
  assert.equal(result.validation.metrics.material_profile_id, 'local_grass_block_materials_v0')
  assert.equal(result.validation.metrics.pixel_validation.image_size.width, 1024)
  assert.equal(result.validation.metrics.pixel_validation.outside_rule_cell_pixel_count, 0)
  assert.equal(result.pipeline_stages.source_normalizer, 'planned')
  assert.equal(result.pipeline_stages.material_builder, 'procedural_material_v0')
  assert.equal(result.pipeline_stages.validator, 'pixel_validation_v0')
  assert.equal(result.pipeline_stages.exporter, 'metadata_export_hardening_v0')
  assert.equal(result.pipeline_stages.preview_generator, 'preview_artifacts_v0')
  assert.equal(result.pipeline_stages.map_rule_builder, 'constraint_map_solver_v1')
  assert.equal(result.pipeline_stages.map_exporter, 'ldtk_project_export_v1')
  assert.equal(result.map_rule.mode, 'two_point_five_d_map_rule_profile_v1')
  assert.equal(result.map_rule.validation.status, 'pass')
  assert.equal(result.map_rule.validation.metrics.edge_mismatch_count, 0)
  assert.equal(result.map_rule.arrangement.mode, 'constraint_solved_corner_mask_v1')
  assert.equal(result.map_rule.arrangement.wfc_scope, 'local_constraint_solver_not_full_wfc_productization')
  assert.equal(result.map_rule.constraint_solver.status, 'pass')
  assert.equal(result.map_rule.constraint_solver.algorithm, 'ac3_backtracking_constraint_solver')
  assert.equal(result.ldtk_project.status, 'pass')
  assert.equal(result.ldtk_project.metrics.default_grid_size, 32)
  assert.equal(result.ldtk_project.metrics.tileset_tile_grid_size, 64)
  assert.equal(result.ldtk_project.auto_layer_rules.rule_count, 16)
  assert.equal(result.ldtk_project.metrics.auto_layer_rule_count, 16)
  assert.equal(result.ldtk_project.workflow_validation.status, 'pass')
  assert.equal(result.ldtk_project.workflow_validation.metrics.auto_rule_count, 16)
  assert.equal(result.map_editor_workflow.status, 'pass')
  assert.equal(result.map_editor_workflow.operation_count, 0)
  assert.equal(result.workflow_release_evidence.status, 'warning')
  assert.equal(result.workflow_release_evidence.release_ready, true)
  assert.equal(result.consumer_package_audit.status, 'pass')
  assert.ok(result.consumer_package_audit.metrics.package_entry_count >= 20)
  assert.equal(result.import_validation.status, 'pass')
  assert.equal(result.import_validation.static_checks.tiled.status, 'pass')
  assert.equal(result.import_validation.static_checks.ldtk.status, 'pass')
  assert.ok(['not_run', 'pass'].includes(result.import_validation.external_editor_probe.status))
  assert.equal(result.release_demo_pack.status, 'warning')
  assert.equal(result.release_demo_pack.release_ready, true)
  assert.equal(result.release_demo_pack.primary_files.strict_atlas, 'strict_atlas.png')
  assert.ok(['not_run', 'pass'].includes(result.external_tool_probe.status))
  assert.ok(result.external_tool_probe.availability.supported_tool_count >= 2)
  assert.equal(result.external_import_smoke.status, 'pass')
  assert.equal(result.external_import_smoke.static_package.status, 'pass')
  assert.equal(result.external_roundtrip_validation.status, 'not_run')
  assert.equal(result.external_roundtrip_validation.ready_for_manual_roundtrip, true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'strict_atlas.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'runtime_padded_atlas.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'map_rule_profile.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'constraint_solver_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'tile_map.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'tile_map_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'map_editor_workflow.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'material_profile.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'material_swatches.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'grid_overlay.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'collision_overlay.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'random_map_preview.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'rule_map_preview.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'map_editor_preview.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'metadata.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'tileset.tsx')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'project.ldtk')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'ldtk_auto_layer_rules.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'ldtk_project_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'ldtk_workflow_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'workflow_release_evidence.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'workflow_release_evidence.md')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'consumer_package_audit.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'import_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'release_demo_manifest.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'release_demo_README.md')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'release_demo_pack.zip')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'external_tool_probe.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'external_import_smoke.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'external_roundtrip_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_tileset', 'external_roundtrip_checklist.md')), true)

  const metadata = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'metadata.json'), 'utf8'))
  const consumerPackageAudit = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'consumer_package_audit.json'), 'utf8'))
  const importValidation = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'import_validation.json'), 'utf8'))
  const releaseDemoManifest = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'release_demo_manifest.json'), 'utf8'))
  const externalImportSmoke = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'external_import_smoke.json'), 'utf8'))
  const externalRoundtripValidation = JSON.parse(await readFile(path.join(outputDir, 'cli_tileset', 'external_roundtrip_validation.json'), 'utf8'))
  assert.equal(metadata.export_policy.runtime_padded_atlas.padding_px, 1)
  assert.equal(metadata.tile_map.validation_status, 'pass')
  assert.equal(metadata.map_editor_workflow.status, 'pass')
  assert.equal(metadata.ldtk_project.status, 'pass')
  assert.equal(metadata.workflow_release_evidence.release_ready, true)
  assert.equal(metadata.tiles.find((tile) => tile.mask === 15).validation_status.status, 'pass')
  assert.deepEqual(metadata.tiles.find((tile) => tile.mask === 15).runtime_inner_rect, { x: 199, y: 199, w: 64, h: 64 })
  assert.equal(consumerPackageAudit.status, 'pass')
  assert.equal(importValidation.status, 'pass')
  assert.equal(releaseDemoManifest.release_ready, true)
  assert.equal(externalImportSmoke.static_package.status, 'pass')
  assert.equal(externalRoundtripValidation.ready_for_manual_roundtrip, true)
})

test('tileset build-two-point-five-d can apply headless map editor operations through the CLI', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-map-edit-'))
  const result = await runCli([
    'tileset',
    'build-two-point-five-d',
    '--contract',
    'configs/two_point_five_d/block_autotile_v1.json',
    '--map-width',
    '6',
    '--map-height',
    '5',
    '--map-edit',
    'paint:2,2,2,1',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_map_edit_tileset',
  ])

  assert.equal(result.status, 'pass')
  assert.equal(result.map_editor_workflow.status, 'pass')
  assert.equal(result.map_editor_workflow.operation_count, 1)
  assert.ok(result.map_editor_workflow.changed_cell_count > 0)
  assert.equal(result.workflow_release_evidence.release_ready, true)
  assert.equal(result.map_rule.validation.status, 'pass')

  const workflow = JSON.parse(await readFile(path.join(outputDir, 'cli_map_edit_tileset', 'map_editor_workflow.json'), 'utf8'))
  const tileMap = JSON.parse(await readFile(path.join(outputDir, 'cli_map_edit_tileset', 'tile_map.json'), 'utf8'))
  assert.equal(workflow.operations[0].type, 'paint_terrain_rect')
  assert.equal(tileMap.arrangement.mode, 'map_editor_corner_workflow_v1')
  assert.equal(tileMap.arrangement.operation_count, 1)
})

test('tileset build-two-point-five-d can normalize a manual material source through the CLI', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-'))
  const sourcePath = await writeManualMaterialSource(outputDir)
  const layoutPath = path.join(outputDir, 'material-layout.json')
  await writeFile(
    layoutPath,
    JSON.stringify({
      top_material: { role: 'top', x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 2 },
    })
  )
  const result = await runCli([
    'tileset',
    'build-two-point-five-d',
    '--contract',
    'configs/two_point_five_d/block_autotile_v1.json',
    '--material-source',
    sourcePath,
    '--material-layout',
    layoutPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_source_tileset',
  ])

  assert.equal(result.status, 'pass')
  assert.equal(result.pipeline_stages.source_normalizer, 'source_normalizer_v0')
  assert.equal(result.pipeline_stages.material_builder, 'manual_material_extraction_v1')
  assert.equal(result.pipeline_stages.rule_aware_composer, 'patch_texture_geometry_v1')
  assert.equal(result.source_normalization.status, 'warning')
  assert.equal(result.material_source.status, 'warning')
  assert.equal(result.material_source.extraction.mode, 'material_patch_extraction_v1')
  assert.equal(result.material_source.extraction.palette_limit.status, 'active')
  assert.equal(result.material_source.extraction.tileability.status, 'active')
  assert.equal(result.material_source.extraction.patch_count, 7)
  assert.equal(result.material_source.semantic_slot_selection.mode, 'explicit_slot_regions_v1')
  assert.equal(result.material_source.semantic_slot_selection.candidate_count, 7)
  assert.equal(result.material_source.slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(result.material_source.slot_separation.status, 'disabled')
  assert.equal(result.material_source.layout_selection.mode, 'explicit_material_layout_v1')
  assert.equal(result.material_source.layout_selection.selected_id, 'explicit_material_layout')
  assert.equal(result.material_source.quality_gates.warning_sample_count, 7)
  assert.equal(result.material_source.quality_gates.warning_patch_count, 7)
  assert.equal(result.material_source_guidance.status, 'warning')
  assert.ok(result.material_source_guidance.issue_count > 0)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'normalized_material_source.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'source_normalization.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_source_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_source_guidance.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_source_guidance.md')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_source_samples.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_layout_candidates.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_slot_candidates.png')), false)
  assert.equal(await exists(path.join(outputDir, 'cli_source_tileset', 'material_patches.png')), true)
  const materialProfile = JSON.parse(await readFile(path.join(outputDir, 'cli_source_tileset', 'material_profile.json'), 'utf8'))
  const guidance = JSON.parse(await readFile(path.join(outputDir, 'cli_source_tileset', 'material_source_guidance.json'), 'utf8'))
  assert.equal(materialProfile.generator, 'manual_material_extraction_v1')
  assert.equal(materialProfile.extraction.patch_count, 7)
  assert.equal(materialProfile.materials.grass_top.base, '#7a5435')
  assert.match(materialProfile.materials.grass_top.patch.image_data_url, /^data:image\/png;base64,/)
  assert.ok(guidance.issues.some((issue) => issue.code === 'sample_region_low_contrast_top_material'))
})

test('tileset build-two-point-five-d can generate a raw provider material source before local composition', async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-ai-source-'))
  const providerPng = await makeProviderMaterialSourcePng()
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const result = await runCli([
    'tileset',
    'build-two-point-five-d',
    '--contract',
    'configs/two_point_five_d/block_autotile_v1.json',
    '--generate-source',
    'mossy cliff grass blocks with cool stone side walls',
    '--source-image-size',
    '1K',
    '--source-seed',
    '7',
    '--temperature',
    '0.5',
    '--max-provider-calls',
    '1',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_ai_source_tileset',
  ], {
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_BASE_URL: mock.url,
    OPENROUTER_IMAGE_MODEL: 'mock/material-source',
    OPENROUTER_IMAGE_SIZE: '1K',
    OPENROUTER_IMAGE_ASPECT_RATIO: '1:1',
    CHARACTER_PROVIDER_PRESETS: '[]',
    CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
  })

  assert.equal(result.status, 'pass')
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.equal(result.ai_material_source_bridge.status, 'pass')
  assert.equal(result.ai_material_source_bridge.source_role, 'raw_material_source_not_clean_atlas')
  assert.equal(result.ai_material_source_bridge.provider, 'openrouter')
  assert.equal(result.ai_material_source_bridge.model, 'mock/material-source')
  assert.equal(result.ai_material_source_bridge.prompt_contract.contract_version, 'two_point_five_d_material_source_prompt_contract_v1_0')
  assert.equal(result.ai_material_source_bridge.generated_source.direct_asset_use_allowed, false)
  assert.equal(result.ai_material_source_bridge.pipeline_handoff.final_atlas_structure_owner, 'local_deterministic_pipeline')
  assert.equal(result.pipeline_stages.source_normalizer, 'source_normalizer_v0')
  assert.equal(result.pipeline_stages.material_builder, 'manual_material_extraction_v1')
  assert.equal(result.pipeline_stages.rule_aware_composer, 'patch_texture_geometry_v1')
  assert.ok(['pass', 'warning'].includes(result.source_normalization.status))
  assert.ok(['pass', 'warning'].includes(result.material_source.status))
  assert.equal(await exists(path.join(outputDir, 'cli_ai_source_tileset', 'ai_material_source_bridge.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_ai_source_tileset', 'ai_material_source_prompt.txt')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_ai_source_tileset', 'provider_material_source.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_ai_source_tileset', 'normalized_material_source.png')), true)

  assert.equal(mock.requests.length, 1)
  const request = mock.requests[0]
  assert.equal(request.model, 'mock/material-source')
  assert.deepEqual(request.image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.equal(request.seed, 7)
  assert.equal(request.temperature, 0.5)
  assert.equal(typeof request.messages[0].content, 'string')
  assert.match(request.messages[0].content, /raw material source image/)
  assert.match(request.messages[0].content, /Do not create a strict atlas/)
  assert.match(request.messages[0].content, /local deterministic code will crop\/sample materials/i)

  const bridge = JSON.parse(await readFile(path.join(outputDir, 'cli_ai_source_tileset', 'ai_material_source_bridge.json'), 'utf8'))
  const metadata = JSON.parse(await readFile(path.join(outputDir, 'cli_ai_source_tileset', 'metadata.json'), 'utf8'))
  assert.equal(bridge.prompt_contract.source_role, 'raw_material_source_not_clean_atlas')
  assert.equal(metadata.material_source_bridge.source_role, 'raw_material_source_not_clean_atlas')
  assert.equal(metadata.material_source_bridge.pipeline_handoff.final_atlas_structure_owner, 'local_deterministic_pipeline')
})

test('tileset material-source-benchmark writes a dry-run provider call plan', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-plan-'))
  const result = await runCli([
    'tileset',
    'material-source-benchmark',
    '--description',
    'mossy cliff grass block material source',
    '--candidate-count',
    '2',
    '--source-image-size',
    '1K',
    '--dry-run-plan',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_source_benchmark_plan',
  ])

  assert.equal(result.command, 'tileset material-source-benchmark')
  assert.equal(result.mode, 'dry_run_plan')
  assert.equal(result.estimated_provider_calls, 2)
  assert.equal(result.candidate_count, 2)
  assert.equal(result.provider_config.image_config.image_size, '1K')
  assert.deepEqual(result.case_ids, ['custom_material_source'])
  assert.equal(await exists(path.join(outputDir, 'cli_source_benchmark_plan', 'material_source_benchmark_plan.json')), true)
  const plan = JSON.parse(await readFile(path.join(outputDir, 'cli_source_benchmark_plan', 'material_source_benchmark_plan.json'), 'utf8'))
  assert.equal(plan.provider_config.image_config.image_size, '1K')
  assert.equal(plan.image_config.image_size, '1K')
})

test('tileset material-source-benchmark selects the best provider raw source candidate', async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-'))
  const providerPng = await makeProviderMaterialSourcePng()
  const mock = await startMockOpenRouter([Buffer.from('not a png'), providerPng])
  t.after(() => mock.server.close())

  const result = await runCli([
    'tileset',
    'material-source-benchmark',
    '--description',
    'mossy cliff grass blocks with cool stone side walls',
    '--source-image-size',
    '1K',
    '--seed',
    '9',
    '--candidate-count',
    '2',
    '--yes',
    '--max-provider-calls',
    '2',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_source_benchmark',
  ], {
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_BASE_URL: mock.url,
    OPENROUTER_IMAGE_MODEL: 'mock/material-source',
    OPENROUTER_IMAGE_SIZE: '1K',
    OPENROUTER_IMAGE_ASPECT_RATIO: '1:1',
    CHARACTER_PROVIDER_PRESETS: '[]',
    CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
  })

  assert.equal(result.command, 'tileset material-source-benchmark')
  assert.equal(result.mode, 'live')
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(result.summary.candidate_count, 2)
  assert.equal(result.cases.length, 1)
  assert.equal(result.cases[0].selected_candidate_id, 'candidate_02')
  assert.notEqual(result.cases[0].selected_status, 'error')
  assert.equal(await exists(path.join(outputDir, 'cli_source_benchmark', 'material_source_benchmark.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_benchmark', 'material_source_benchmark.md')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_source_benchmark', 'items/custom_material_source_v1/candidate_02/ai_material_source_bridge.json')), true)

  assert.equal(mock.requests.length, 2)
  assert.equal(mock.requests[0].model, 'mock/material-source')
  assert.equal(mock.requests[0].seed, 9)
  assert.equal(mock.requests[1].seed, 10)
  assert.match(mock.requests[0].messages[0].content, /raw material source image/)

  const report = JSON.parse(await readFile(path.join(outputDir, 'cli_source_benchmark', 'material_source_benchmark.json'), 'utf8'))
  assert.equal(report.cases[0].candidates[0].status, 'error')
  assert.equal(report.cases[0].candidate_selection.selected_candidate_id, 'candidate_02')
  assert.match(report.claim_boundary, /does not claim providers can emit final strict atlases/)
})

test('tileset material-source-benchmark-review writes provider-free review artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-review-'))
  const reportPath = path.join(outputDir, 'material_source_benchmark.json')
  await writeFile(reportPath, JSON.stringify({
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1',
    status: 'warning',
    run_id: 'manual_live_handoff',
    summary: {
      status: 'warning',
      case_count: 1,
      candidate_count: 2,
      selected_validation: { pass: 0, warning: 1, fail: 0, error: 0 },
      candidate_validation: { pass: 0, warning: 1, fail: 0, error: 1 },
      selected_pass_rate: 0,
      selected_usable_rate: 1,
      stopped_early: false,
      failure_taxonomy: {
        top_categories: [
          { id: 'material_source.low_contrast', count: 1, examples: ['mossy_cliff/candidate_02'] },
        ],
      },
    },
    cases: [{
      id: 'mossy_cliff',
      item_id: 'mossy_cliff_v1',
      description: 'mossy cliff material source',
      output_dir: 'items/mossy_cliff_v1',
      candidates: [
        {
          id: 'candidate_01',
          case_id: 'mossy_cliff',
          index: 0,
          status: 'error',
          warnings: [],
          blocking_errors: ['provider_material_source_generation_failed'],
          output_dir: null,
          score: { status_rank: 3, deterministic_blocking_error_count: 1, total_warning_count: 0, candidate_index: 0 },
        },
        {
          id: 'candidate_02',
          case_id: 'mossy_cliff',
          index: 1,
          status: 'warning',
          warnings: ['material_source.low_contrast'],
          blocking_errors: [],
          output_dir: 'items/mossy_cliff_v1/candidate_02',
          score: { status_rank: 1, deterministic_blocking_error_count: 0, total_warning_count: 1, candidate_index: 1 },
        },
      ],
      candidate_selection: {
        schema_version: 1,
        mode: 'two_point_five_d_material_source_candidate_selection_v1',
        candidate_count: 2,
        selected_candidate_id: 'candidate_02',
        selected_candidate_index: 1,
        selected_status: 'warning',
        selection_reason: 'candidate_02 selected from 2 candidates; had the lowest local warning score',
        ranking: [{
          id: 'candidate_02',
          case_id: 'mossy_cliff',
          index: 1,
          status: 'warning',
          warnings: ['material_source.low_contrast'],
          blocking_errors: [],
          output_dir: 'items/mossy_cliff_v1/candidate_02',
          score: { status_rank: 1, deterministic_blocking_error_count: 0, total_warning_count: 1, candidate_index: 1 },
        }],
      },
    }],
    claim_boundary: 'Provider output is raw material source only.',
  }, null, 2))

  const result = await runCli([
    'tileset',
    'material-source-benchmark-review',
    '--report',
    reportPath,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'tileset material-source-benchmark-review')
  assert.equal(result.mode, 'provider_free_review')
  assert.equal(result.review_status, 'review_warnings')
  assert.equal(result.release_ready, false)
  assert.equal(result.next_action, 'improve_material_extraction')
  assert.equal(result.summary.provider_error_count, 0)
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.json')), true)
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.md')), true)
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.html')), true)
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.png')), true)

  const review = JSON.parse(await readFile(path.join(outputDir, 'material_source_benchmark_review.json'), 'utf8'))
  const markdown = await readFile(path.join(outputDir, 'material_source_benchmark_review.md'), 'utf8')
  const html = await readFile(path.join(outputDir, 'material_source_benchmark_review.html'), 'utf8')
  const pngMetadata = await sharp(path.join(outputDir, 'material_source_benchmark_review.png')).metadata()
  assert.equal(review.selected_cases[0].selected_candidate_id, 'candidate_02')
  assert.match(markdown, /Next action: improve_material_extraction/)
  assert.match(markdown, /material_source\.low_contrast: 1/)
  assert.match(html, /2\.5D Material Source Benchmark Review/)
  assert.match(html, /improve_material_extraction/)
  assert.equal(pngMetadata.format, 'png')
  assert.equal(pngMetadata.width, 1440)
})

test('tileset material-source-benchmark-review accepts a benchmark run dir', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-review-run-dir-'))
  await writeFile(path.join(outputDir, 'material_source_benchmark.json'), JSON.stringify({
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1',
    status: 'pass',
    run_id: 'manual_live_clean',
    summary: {
      status: 'pass',
      case_count: 1,
      candidate_count: 1,
      selected_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      stopped_early: false,
      failure_taxonomy: { top_categories: [] },
    },
    cases: [{
      id: 'mossy_cliff',
      candidates: [{
        id: 'candidate_01',
        case_id: 'mossy_cliff',
        status: 'pass',
        warnings: [],
        blocking_errors: [],
        output_dir: 'items/mossy_cliff_v1/candidate_01',
      }],
      candidate_selection: {
        selected_candidate_id: 'candidate_01',
        selected_status: 'pass',
        selection_reason: 'candidate_01 selected as the only completed candidate; passed local validation',
        ranking: [{
          id: 'candidate_01',
          case_id: 'mossy_cliff',
          status: 'pass',
          warnings: [],
          blocking_errors: [],
          output_dir: 'items/mossy_cliff_v1/candidate_01',
        }],
      },
    }],
    claim_boundary: 'Provider output is raw material source only.',
  }, null, 2))

  const result = await runCli([
    'tileset',
    'material-source-benchmark-review',
    '--run-dir',
    outputDir,
  ])

  assert.equal(result.command, 'tileset material-source-benchmark-review')
  assert.equal(result.source_report, path.join(outputDir, 'material_source_benchmark.json'))
  assert.equal(result.review_status, 'ready_to_expand')
  assert.equal(result.release_ready, true)
  assert.equal(result.artifacts.review_html, path.join(outputDir, 'material_source_benchmark_review.html'))
  assert.equal(result.artifacts.review_png, path.join(outputDir, 'material_source_benchmark_review.png'))
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.html')), true)
  assert.equal(await exists(path.join(outputDir, 'material_source_benchmark_review.png')), true)
})

test('tileset material-source-benchmark-review can review the latest completed run', async () => {
  const benchmarkRoot = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-review-latest-'))
  const oldRun = path.join(benchmarkRoot, 'aaa_old_run')
  const latestRun = path.join(benchmarkRoot, 'zzz_latest_run')
  await mkdir(oldRun)
  await mkdir(latestRun)
  const oldReport = path.join(oldRun, 'material_source_benchmark.json')
  const latestReport = path.join(latestRun, 'material_source_benchmark.json')
  await writeFile(oldReport, JSON.stringify(cleanMaterialSourceBenchmarkReport('old_run'), null, 2))
  await writeFile(latestReport, JSON.stringify(cleanMaterialSourceBenchmarkReport('latest_run'), null, 2))
  const oldTime = new Date('2026-06-17T00:00:00Z')
  const latestTime = new Date('2026-06-18T00:00:00Z')
  await utimes(oldReport, oldTime, oldTime)
  await utimes(latestReport, latestTime, latestTime)

  const result = await runCli([
    'tileset',
    'material-source-benchmark-review',
    '--latest',
    '--benchmark-root',
    benchmarkRoot,
  ])

  assert.equal(result.command, 'tileset material-source-benchmark-review')
  assert.equal(result.source_report, latestReport)
  assert.equal(result.output_dir, latestRun)
  assert.equal(result.review_status, 'ready_to_expand')
  assert.equal(await exists(path.join(latestRun, 'material_source_benchmark_review.png')), true)
})

test('tileset material-source-benchmark-review explains dry-run-only run dirs', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-review-plan-only-'))
  await writeFile(path.join(outputDir, 'material_source_benchmark_plan.json'), JSON.stringify({
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1_plan',
    run_id: 'dry_run_only',
    estimated_provider_calls: 1,
  }, null, 2))

  const error = await runCliError([
    'tileset',
    'material-source-benchmark-review',
    '--run-dir',
    outputDir,
  ])

  assert.match(error.stderr, /found only a dry-run plan/)
  assert.match(error.stderr, /run the live material-source benchmark first/)
})

test('tileset material-source-benchmark-review explains latest dry-run-only roots', async () => {
  const benchmarkRoot = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-source-benchmark-review-latest-plan-only-'))
  const planRun = path.join(benchmarkRoot, 'plan_only')
  await mkdir(planRun)
  await writeFile(path.join(planRun, 'material_source_benchmark_plan.json'), JSON.stringify({
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1_plan',
    run_id: 'dry_run_only',
    estimated_provider_calls: 1,
  }, null, 2))

  const error = await runCliError([
    'tileset',
    'material-source-benchmark-review',
    '--latest',
    '--benchmark-root',
    benchmarkRoot,
  ])

  assert.match(error.stderr, /found 1 dry-run plan/)
  assert.match(error.stderr, /no material_source_benchmark\.json/)
})

test('tileset material-source-evidence runs reviewed manual source gate from a manifest', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-cli-evidence-'))
  const manifestPath = await writeMaterialSourceEvidenceManifest(outputDir)
  const result = await runCli([
    'tileset',
    'material-source-evidence',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_evidence_gate',
  ])

  assert.equal(result.command, 'tileset material-source-evidence')
  assert.equal(result.status, 'warning')
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.validation.warning, 1)
  assert.equal(result.quality_closure.status, 'not_ready')
  assert.equal(result.quality_closure.release_ready, false)
  assert.equal(result.items[0].id, 'flat_source')
  assert.equal(result.items[0].status, 'warning')
  assert.equal(result.items[0].patch_count, 7)
  assert.ok(result.items[0].layout_selected_id)
  assert.equal(result.items[0].semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.ok(result.items[0].semantic_slot_selection.candidate_count >= 6)
  assert.equal(result.items[0].slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(result.items[0].slot_separation.status, 'active')
  assert.equal(result.items[0].slot_separation.remaining_warning_count, 0)
  assert.equal(await exists(path.join(outputDir, 'cli_evidence_gate', 'material_source_evidence_gate.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_evidence_gate', 'material_source_evidence_gate.md')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_evidence_gate', result.items[0].contact_sheet)), true)
})
