import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import sharp from 'sharp'

import {
  buildTiledJson,
  buildTiledTsx,
  writeTwoPointFiveDTilesetArtifacts,
} from '../../src/two-point-five-d/atlasExporter.js'
import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function rgbaAt(rawImage, x, y) {
  const index = (y * rawImage.info.width + x) * rawImage.info.channels
  return Array.from(rawImage.data.subarray(index, index + 4))
}

async function buildManualMaterialSource() {
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
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function buildStripedManualMaterialSource() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="170" height="512" fill="#aa2233"/>',
    '<rect x="170" y="0" width="172" height="512" fill="#2f8f3f"/>',
    '<rect x="342" y="0" width="341" height="512" fill="#7a5435"/>',
    '<rect x="390" y="40" width="48" height="48" fill="#3f2d21"/>',
    '<rect x="683" y="0" width="341" height="512" fill="#b6d46d"/>',
    '<rect x="732" y="42" width="48" height="48" fill="#eff0a0"/>',
    '<rect x="0" y="512" width="342" height="512" fill="#67b04f"/>',
    '<rect x="36" y="560" width="48" height="48" fill="#376a30"/>',
    '<rect x="342" y="512" width="341" height="512" fill="#8f7f45"/>',
    '<rect x="390" y="560" width="48" height="48" fill="#c7d66c"/>',
    '<rect x="683" y="512" width="341" height="512" fill="#1d2119"/>',
    '<rect x="732" y="560" width="48" height="48" fill="#4c5640"/>',
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).png().toBuffer()
}

test('writeTwoPointFiveDTilesetArtifacts writes atlas, metadata, validation, preview, and Tiled exports', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-export-'))
  const result = await writeTwoPointFiveDTilesetArtifacts({
    outputDir,
    runId: 'terrain_autotile_builder_smoke',
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.plan.tiles.length, 16)
  assert.equal(await exists(result.artifacts.contract), true)
  assert.equal(await exists(result.artifacts.map_rule_profile), true)
  assert.equal(await exists(result.artifacts.constraint_solver_report), true)
  assert.equal(await exists(result.artifacts.tile_map), true)
  assert.equal(await exists(result.artifacts.tile_map_validation), true)
  assert.equal(await exists(result.artifacts.map_editor_workflow), true)
  assert.equal(await exists(result.artifacts.material_profile), true)
  assert.equal(await exists(result.artifacts.metadata), true)
  assert.equal(await exists(result.artifacts.validation_report), true)
  assert.equal(await exists(result.artifacts.strict_atlas_png), true)
  assert.equal(await exists(result.artifacts.runtime_padded_atlas_png), true)
  assert.equal(await exists(result.artifacts.material_swatches_png), true)
  assert.equal(await exists(result.artifacts.preview_png), true)
  assert.equal(await exists(result.artifacts.grid_overlay_png), true)
  assert.equal(await exists(result.artifacts.collision_overlay_png), true)
  assert.equal(await exists(result.artifacts.random_map_preview_png), true)
  assert.equal(await exists(result.artifacts.rule_map_preview_png), true)
  assert.equal(await exists(result.artifacts.map_editor_preview_png), true)
  assert.equal(await exists(result.artifacts.tiled_json), true)
  assert.equal(await exists(result.artifacts.tiled_tsx), true)
  assert.equal(await exists(result.artifacts.ldtk_project), true)
  assert.equal(await exists(result.artifacts.ldtk_auto_layer_rules), true)
  assert.equal(await exists(result.artifacts.ldtk_project_validation), true)
  assert.equal(await exists(result.artifacts.ldtk_workflow_validation), true)
  assert.equal(await exists(result.artifacts.workflow_release_evidence), true)
  assert.equal(await exists(result.artifacts.workflow_release_evidence_md), true)
  assert.equal(await exists(result.artifacts.consumer_package_audit), true)
  assert.equal(await exists(result.artifacts.import_validation), true)
  assert.equal(await exists(result.artifacts.release_demo_manifest), true)
  assert.equal(await exists(result.artifacts.release_demo_readme), true)
  assert.equal(await exists(result.artifacts.release_demo_pack_zip), true)
  assert.equal(await exists(result.artifacts.external_tool_probe), true)
  assert.equal(await exists(result.artifacts.external_import_smoke), true)
  assert.equal(await exists(result.artifacts.external_roundtrip_validation), true)
  assert.equal(await exists(result.artifacts.external_roundtrip_checklist_md), true)

  const strictMeta = await sharp(result.artifacts.strict_atlas_png).metadata()
  const runtimeMeta = await sharp(result.artifacts.runtime_padded_atlas_png).metadata()
  const swatchesMeta = await sharp(result.artifacts.material_swatches_png).metadata()
  const previewMeta = await sharp(result.artifacts.preview_png).metadata()
  const gridOverlayMeta = await sharp(result.artifacts.grid_overlay_png).metadata()
  const collisionOverlayMeta = await sharp(result.artifacts.collision_overlay_png).metadata()
  const randomMapMeta = await sharp(result.artifacts.random_map_preview_png).metadata()
  const ruleMapMeta = await sharp(result.artifacts.rule_map_preview_png).metadata()
  assert.deepEqual({ width: strictMeta.width, height: strictMeta.height }, { width: 1024, height: 1024 })
  assert.deepEqual({ width: runtimeMeta.width, height: runtimeMeta.height }, { width: 1056, height: 1056 })
  assert.equal(swatchesMeta.format, 'png')
  assert.deepEqual({ width: previewMeta.width, height: previewMeta.height, format: previewMeta.format }, { width: 286, height: 286, format: 'png' })
  assert.deepEqual({ width: gridOverlayMeta.width, height: gridOverlayMeta.height }, { width: 1024, height: 1024 })
  assert.deepEqual({ width: collisionOverlayMeta.width, height: collisionOverlayMeta.height }, { width: 1024, height: 1024 })
  assert.deepEqual({ width: randomMapMeta.width, height: randomMapMeta.height }, { width: 384, height: 272 })
  assert.deepEqual({ width: ruleMapMeta.width, height: ruleMapMeta.height }, { width: 384, height: 272 })
  const strictRaw = await sharp(result.artifacts.strict_atlas_png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const runtimeRaw = await sharp(result.artifacts.runtime_padded_atlas_png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(rgbaAt(runtimeRaw, 215, 263), rgbaAt(strictRaw, 208, 255))

  const materialProfile = JSON.parse(await readFile(result.artifacts.material_profile, 'utf8'))
  assert.equal(materialProfile.id, 'local_grass_block_materials_v0')
  assert.equal(materialProfile.slots.transition_detail.pattern_id, 'mat_grass_to_dirt_edge')

  const metadata = JSON.parse(await readFile(result.artifacts.metadata, 'utf8'))
  assert.equal(metadata.mode, 'two_point_five_d_tileset_metadata_v0')
  assert.equal(metadata.rule_profile.id, 'corner_mask_16')
  assert.equal(metadata.map_rule_profile.mode, 'two_point_five_d_map_rule_profile_v1')
  assert.equal(metadata.tile_map.validation_status, 'pass')
  assert.equal(metadata.tile_map.arrangement.mode, 'constraint_solved_corner_mask_v1')
  assert.equal(metadata.tile_map.arrangement.wfc_scope, 'local_constraint_solver_not_full_wfc_productization')
  assert.equal(metadata.constraint_solver.status, 'pass')
  assert.equal(metadata.constraint_solver.algorithm, 'ac3_backtracking_constraint_solver')
  assert.equal(metadata.map_editor_workflow.status, 'pass')
  assert.equal(metadata.map_editor_workflow.operation_count, 0)
  assert.equal(metadata.ldtk_project.status, 'pass')
  assert.equal(metadata.ldtk_project.workflow_validation.status, 'pass')
  assert.equal(metadata.ldtk_project.auto_layer_rules.rule_count, 16)
  assert.equal(metadata.workflow_release_evidence.status, 'warning')
  assert.equal(metadata.workflow_release_evidence.release_ready, true)
  assert.equal(metadata.material_profile.id, 'local_grass_block_materials_v0')
  assert.equal(metadata.export_policy.runtime_padded_atlas.padding_px, 1)
  assert.equal(metadata.export_policy.runtime_padded_atlas.extrude_mode, 'copy_edge_pixels')
  assert.equal(metadata.export_policy.coordinate_mapping.runtime_inner_rect_field, 'runtime_inner_rect')
  assert.equal(metadata.tiles[15].transition.tile_class, 'solid')
  assert.equal(metadata.tiles[15].atlas_tile_id, 51)
  assert.equal(metadata.tiles[15].tile_role, 'solid')
  assert.equal(metadata.tiles[15].terrain_type, 'grass')
  assert.deepEqual(metadata.tiles[15].visual_bounds, { x: 8, y: 8, w: 48, h: 56 })
  assert.deepEqual(metadata.tiles[15].runtime_source_rect, { x: 198, y: 198, w: 66, h: 66 })
  assert.deepEqual(metadata.tiles[15].runtime_inner_rect, { x: 199, y: 199, w: 64, h: 64 })
  assert.equal(metadata.tiles[15].z_order_hint.mode, 'bottom_center_pivot')
  assert.equal(metadata.tiles[15].validation_status.status, 'pass')
  assert.ok(metadata.tiles[15].validation_status.pixel_metrics.visible_pixel_count > 0)

  const validationReport = JSON.parse(await readFile(result.artifacts.validation_report, 'utf8'))
  const tileMap = JSON.parse(await readFile(result.artifacts.tile_map, 'utf8'))
  const tileMapValidation = JSON.parse(await readFile(result.artifacts.tile_map_validation, 'utf8'))
  const mapEditorWorkflow = JSON.parse(await readFile(result.artifacts.map_editor_workflow, 'utf8'))
  const constraintSolverReport = JSON.parse(await readFile(result.artifacts.constraint_solver_report, 'utf8'))
  const ldtkProject = JSON.parse(await readFile(result.artifacts.ldtk_project, 'utf8'))
  const ldtkAutoLayerRules = JSON.parse(await readFile(result.artifacts.ldtk_auto_layer_rules, 'utf8'))
  const ldtkValidation = JSON.parse(await readFile(result.artifacts.ldtk_project_validation, 'utf8'))
  const ldtkWorkflowValidation = JSON.parse(await readFile(result.artifacts.ldtk_workflow_validation, 'utf8'))
  const workflowEvidence = JSON.parse(await readFile(result.artifacts.workflow_release_evidence, 'utf8'))
  const workflowEvidenceMd = await readFile(result.artifacts.workflow_release_evidence_md, 'utf8')
  const consumerPackageAudit = JSON.parse(await readFile(result.artifacts.consumer_package_audit, 'utf8'))
  const importValidation = JSON.parse(await readFile(result.artifacts.import_validation, 'utf8'))
  const releaseDemoManifest = JSON.parse(await readFile(result.artifacts.release_demo_manifest, 'utf8'))
  const releaseDemoReadme = await readFile(result.artifacts.release_demo_readme, 'utf8')
  const releaseDemoZip = await JSZip.loadAsync(await readFile(result.artifacts.release_demo_pack_zip))
  const externalToolProbe = JSON.parse(await readFile(result.artifacts.external_tool_probe, 'utf8'))
  const externalImportSmoke = JSON.parse(await readFile(result.artifacts.external_import_smoke, 'utf8'))
  const externalRoundtripValidation = JSON.parse(await readFile(result.artifacts.external_roundtrip_validation, 'utf8'))
  const externalRoundtripChecklist = await readFile(result.artifacts.external_roundtrip_checklist_md, 'utf8')
  assert.equal(validationReport.mode, 'two_point_five_d_validation_report_v0')
  assert.equal(validationReport.status, 'pass')
  assert.equal(validationReport.metrics.pixel_validation.image_size.width, 1024)
  assert.equal(validationReport.metrics.pixel_validation.semi_transparent_pixel_count, 0)
  assert.equal(validationReport.per_tile_diagnostics.length, 16)
  assert.equal(tileMap.mode, 'two_point_five_d_guarded_rule_map_v1')
  assert.equal(tileMap.arrangement.mode, 'constraint_solved_corner_mask_v1')
  assert.equal(constraintSolverReport.mode, 'two_point_five_d_constraint_map_solver_v1')
  assert.equal(constraintSolverReport.status, 'pass')
  assert.equal(mapEditorWorkflow.mode, 'two_point_five_d_map_editor_workflow_v1')
  assert.equal(mapEditorWorkflow.status, 'pass')
  assert.equal(mapEditorWorkflow.operations.length, 0)
  assert.equal(tileMapValidation.status, 'pass')
  assert.equal(tileMapValidation.metrics.edge_mismatch_count, 0)
  assert.equal(ldtkProject.twoPointFiveD.mode, 'two_point_five_d_ldtk_project_export_v1')
  assert.equal(ldtkAutoLayerRules.mode, 'two_point_five_d_ldtk_auto_layer_rules_v1')
  assert.equal(ldtkAutoLayerRules.auto_rule_groups[0].rules.length, 16)
  assert.equal(ldtkValidation.status, 'pass')
  assert.equal(ldtkValidation.metrics.auto_layer_rule_count, 16)
  assert.equal(ldtkWorkflowValidation.status, 'pass')
  assert.equal(ldtkWorkflowValidation.metrics.auto_rule_count, 16)
  assert.equal(ldtkWorkflowValidation.metrics.grid_tile_count, 48)
  assert.equal(workflowEvidence.mode, 'two_point_five_d_workflow_release_evidence_v1')
  assert.equal(workflowEvidence.status, 'warning')
  assert.equal(workflowEvidence.release_ready, true)
  assert.ok(workflowEvidence.checklist.some((item) => item.id === 'ldtk_import_readiness' && item.status === 'pass'))
  assert.match(workflowEvidenceMd, /# 2\.5D Workflow Release Evidence/)
  assert.equal(consumerPackageAudit.mode, 'two_point_five_d_consumer_package_audit_v1')
  assert.equal(consumerPackageAudit.status, 'pass')
  assert.equal(consumerPackageAudit.reference_checks.every((item) => item.status === 'pass'), true)
  assert.equal(importValidation.mode, 'two_point_five_d_practical_import_validation_v1')
  assert.equal(importValidation.status, 'pass')
  assert.equal(importValidation.static_checks.tiled.status, 'pass')
  assert.equal(importValidation.static_checks.ldtk.status, 'pass')
  assert.ok(['not_run', 'pass'].includes(importValidation.external_editor_probe.status))
  assert.equal(releaseDemoManifest.mode, 'two_point_five_d_release_demo_pack_v1')
  assert.equal(releaseDemoManifest.status, 'warning')
  assert.equal(releaseDemoManifest.release_ready, true)
  assert.equal(releaseDemoManifest.primary_files.ldtk_project, 'project.ldtk')
  assert.match(releaseDemoReadme, /# 2\.5D Tileset Release Demo Pack/)
  assert.ok(releaseDemoZip.file('README.md'))
  assert.ok(releaseDemoZip.file('strict_atlas.png'))
  assert.ok(releaseDemoZip.file('runtime_padded_atlas.png'))
  assert.ok(releaseDemoZip.file('project.ldtk'))
  assert.ok(releaseDemoZip.file('tileset.tiled.json'))
  assert.ok(releaseDemoZip.file('tileset.tsx'))
  assert.equal(JSON.parse(await releaseDemoZip.file('validation/import_validation.json').async('string')).status, 'pass')
  assert.equal(JSON.parse(await releaseDemoZip.file('release_demo_manifest.json').async('string')).release_ready, true)
  assert.equal(externalToolProbe.mode, 'two_point_five_d_external_tool_probe_v1')
  assert.ok(['not_run', 'pass'].includes(externalToolProbe.status))
  assert.ok(externalToolProbe.availability.supported_tool_count >= 2)
  assert.equal(externalImportSmoke.mode, 'two_point_five_d_external_import_smoke_v1')
  assert.equal(externalImportSmoke.status, 'pass')
  assert.equal(externalImportSmoke.static_package.status, 'pass')
  assert.equal(externalImportSmoke.static_package.reference_checks.every((item) => item.status === 'pass'), true)
  assert.equal(externalRoundtripValidation.mode, 'two_point_five_d_external_roundtrip_validation_v1')
  assert.equal(externalRoundtripValidation.status, 'not_run')
  assert.equal(externalRoundtripValidation.ready_for_manual_roundtrip, true)
  assert.equal(externalRoundtripValidation.release_blocking, false)
  assert.match(externalRoundtripChecklist, /# External Editor Round-trip Checklist/)
})

test('Tiled exports preserve logical tile metadata without claiming visual collision', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const tiledJson = buildTiledJson(plan)
  const tsx = buildTiledTsx(plan)

  assert.equal(tiledJson.tilewidth, 64)
  assert.equal(tiledJson.tileheight, 64)
  assert.equal(tiledJson.tilecount, 256)
  assert.equal(tiledJson.columns, 16)
  assert.equal(tiledJson.tiles.find((tile) => tile.properties.some((property) => property.name === 'mask' && property.value === 15)).id, 51)
  assert.equal(tiledJson.properties.find((item) => item.name === 'logical_tile_width').value, 32)
  assert.equal(tiledJson.properties.find((item) => item.name === 'rule_profile').value, 'corner_mask_16')
  assert.equal(tiledJson.properties.find((item) => item.name === 'runtime_padding_px').value, 1)
  assert.equal(tiledJson.properties.find((item) => item.name === 'runtime_tile_width').value, 66)
  const solidTile = tiledJson.tiles.find((tile) => tile.id === 51)
  assert.equal(solidTile.properties.find((property) => property.name === 'tile_role').value, 'solid')
  assert.equal(solidTile.properties.find((property) => property.name === 'terrain_type').value, 'grass')
  assert.equal(solidTile.properties.find((property) => property.name === 'runtime_inner_rect_x').value, 199)
  assert.equal(solidTile.properties.find((property) => property.name === 'visual_bounds_h').value, 56)
  assert.match(tsx, /logical_tile_width/)
  assert.match(tsx, /fixed_height_px/)
  assert.match(tsx, /runtime_padding_px/)
  assert.match(tsx, /<tile id="51">/)
  assert.match(tsx, /tile_role/)
  assert.match(tsx, /tilecount="256"/)
})

test('writeTwoPointFiveDTilesetArtifacts can derive materials from a normalized manual source image', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-source-export-'))
  const materialSource = await buildManualMaterialSource()
  const result = await writeTwoPointFiveDTilesetArtifacts({
    outputDir,
    runId: 'terrain_autotile_manual_source',
    materialSource: { id: 'manual_source_fixture.png', buffer: materialSource },
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.plan.pipeline_stages.source_normalizer, 'source_normalizer_v0')
  assert.equal(result.plan.pipeline_stages.material_builder, 'manual_material_extraction_v1')
  assert.equal(result.plan.pipeline_stages.rule_aware_composer, 'patch_texture_geometry_v1')
  assert.equal(result.plan.material_profile.generator, 'manual_material_extraction_v1')
  assert.equal(result.plan.material_profile.materials.grass_top.base, '#2f8f3f')
  assert.equal(result.plan.material_profile.extraction.patch_count, 7)
  assert.equal(result.metadata.source_normalization.status, 'warning')
  assert.equal(result.metadata.material_source.status, 'warning')
  assert.equal(result.metadata.material_source_guidance.status, 'warning')
  assert.equal(result.consumer_package_audit.status, 'pass')
  assert.equal(result.import_validation.status, 'pass')
  assert.equal(result.release_demo_manifest.release_ready, true)
  assert.ok(result.metadata.material_source.warnings.includes('sample_region_low_contrast_top_material'))
  assert.ok(result.metadata.material_source_guidance.issues.some((issue) => issue.code === 'sample_region_low_contrast_top_material'))
  assert.equal(await exists(result.artifacts.normalized_material_source_png), true)
  assert.equal(await exists(result.artifacts.source_normalization_report), true)
  assert.equal(await exists(result.artifacts.material_source_report), true)
  assert.equal(await exists(result.artifacts.material_source_guidance_json), true)
  assert.equal(await exists(result.artifacts.material_source_guidance_md), true)
  assert.equal(await exists(result.artifacts.material_source_samples_png), true)
  assert.equal(await exists(result.artifacts.material_layout_candidates_png), true)
  assert.equal(await exists(result.artifacts.material_slot_candidates_png), true)
  assert.equal(await exists(result.artifacts.material_patches_png), true)

  const normalizedMeta = await sharp(result.artifacts.normalized_material_source_png).metadata()
  const samplesMeta = await sharp(result.artifacts.material_source_samples_png).metadata()
  const layoutCandidatesMeta = await sharp(result.artifacts.material_layout_candidates_png).metadata()
  const slotCandidatesMeta = await sharp(result.artifacts.material_slot_candidates_png).metadata()
  const patchesMeta = await sharp(result.artifacts.material_patches_png).metadata()
  assert.deepEqual({ width: normalizedMeta.width, height: normalizedMeta.height, format: normalizedMeta.format }, { width: 1024, height: 1024, format: 'png' })
  assert.deepEqual({ width: samplesMeta.width, height: samplesMeta.height, format: samplesMeta.format }, { width: 1024, height: 1024, format: 'png' })
  assert.deepEqual({ width: layoutCandidatesMeta.width, height: layoutCandidatesMeta.height, format: layoutCandidatesMeta.format }, { width: 752, height: 302, format: 'png' })
  assert.deepEqual({ width: slotCandidatesMeta.width, height: slotCandidatesMeta.height, format: slotCandidatesMeta.format }, { width: 1184, height: 226, format: 'png' })
  assert.equal(patchesMeta.format, 'png')
  const sourceReport = JSON.parse(await readFile(result.artifacts.source_normalization_report, 'utf8'))
  const materialReport = JSON.parse(await readFile(result.artifacts.material_source_report, 'utf8'))
  const guidance = JSON.parse(await readFile(result.artifacts.material_source_guidance_json, 'utf8'))
  const guidanceMarkdown = await readFile(result.artifacts.material_source_guidance_md, 'utf8')
  assert.equal(sourceReport.mode, 'two_point_five_d_source_normalization_v0')
  assert.equal(materialReport.mode, 'two_point_five_d_manual_material_extraction_v1')
  assert.equal(materialReport.layout_selection.mode, 'semantic_material_layout_assist_v1')
  assert.equal(materialReport.layout_selection.selected.id, 'six_region_material_grid_v0')
  assert.equal(materialReport.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.equal(materialReport.slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(materialReport.slot_separation.status, 'pass')
  assert.equal(materialReport.extraction.mode, 'material_patch_extraction_v1')
  assert.equal(materialReport.extraction.palette_limit.status, 'active')
  assert.equal(materialReport.extraction.tileability.status, 'active')
  assert.equal(materialReport.extraction.patch_count, 7)
  assert.equal(materialReport.quality_gates.warning_sample_count, 7)
  assert.equal(materialReport.quality_gates.warning_patch_count, 7)
  assert.equal(guidance.mode, 'two_point_five_d_material_source_authoring_guidance_v0')
  assert.equal(guidance.layout_selection.selected_id, 'six_region_material_grid_v0')
  assert.equal(guidance.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.equal(guidance.slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(guidance.slot_separation.status, 'pass')
  assert.equal(guidance.extraction.mode, 'material_patch_extraction_v1')
  assert.equal(guidance.extraction.palette_limit.status, 'active')
  assert.equal(guidance.extraction.tileability.status, 'active')
  assert.ok(guidance.sampling_layout.slots.find((slot) => slot.slot === 'top_material').target_content.includes('walkable surface'))
  assert.match(guidanceMarkdown, /# 2\.5D Material Source Guidance/)
  assert.match(guidanceMarkdown, /## Layout Selection/)
  assert.match(guidanceMarkdown, /## Slot Selection/)
  assert.match(guidanceMarkdown, /## Slot Separation/)
  assert.match(guidanceMarkdown, /Palette limit: active/)
  assert.match(guidanceMarkdown, /Tileability: active/)
  assert.match(guidanceMarkdown, /material_patch_low_color_variety_top_material/)
  assert.match(guidanceMarkdown, /sample_region_low_contrast_top_material/)
})

test('manual material extraction renders final atlas tiles from extracted source patches', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-patch-render-'))
  const materialSource = await buildStripedManualMaterialSource()
  const result = await writeTwoPointFiveDTilesetArtifacts({
    outputDir,
    runId: 'terrain_autotile_patch_texture',
    materialSource: { id: 'striped_material_source.png', buffer: materialSource },
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.plan.material_profile.generator, 'manual_material_extraction_v1')
  assert.equal(result.plan.pipeline_stages.rule_aware_composer, 'patch_texture_geometry_v1')
  assert.ok(result.plan.material_profile.materials.grass_top.patch.image_data_url)

  const strictRaw = await sharp(result.artifacts.strict_atlas_png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(rgbaAt(strictRaw, 210, 202), [170, 34, 51, 255])
  assert.deepEqual(rgbaAt(strictRaw, 218, 202), [47, 143, 63, 255])
})
