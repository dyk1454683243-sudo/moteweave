import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { buildTwoPointFiveDAtlasPlan } from './terrainAutotileBuilder.js'
import { normalizeTwoPointFiveDTilesetContract } from './tilesetContract.js'
import {
  buildManualMaterialProfileFromSource,
  renderMaterialLayoutCandidatesPreviewPng,
  renderMaterialSlotCandidatesPreviewPng,
  renderMaterialSourceSamplesPreviewPng,
} from './manualMaterialBuilder.js'
import { renderMaterialPatchSheetPng } from './materialPatchExtractor.js'
import {
  buildMaterialSourceAuthoringGuidance,
  renderMaterialSourceAuthoringGuidanceMarkdown,
} from './materialSourceGuidance.js'
import { normalizeTwoPointFiveDMaterialSource } from './sourceNormalizer.js'
import { buildTwoPointFiveDValidationReport, validateRenderedTilesetPng } from './tilesetPixelValidator.js'
import { renderCollisionOverlayPng, renderGridOverlayPng, renderRandomMapPreviewPng, renderRuleMapPreviewPng } from './tilesetPreviewGenerator.js'
import { materialFill, renderProceduralMaterialDefs } from './proceduralMaterials.js'
import {
  buildTwoPointFiveDGuardedRuleMap,
  buildTwoPointFiveDMapRuleProfile,
  solveTwoPointFiveDConstraintMap,
  validateTwoPointFiveDRuleMap,
} from './terrainRuleMapBuilder.js'
import {
  buildTwoPointFiveDLdtkAutoLayerRules,
  buildTwoPointFiveDLdtkProjectJson,
  validateTwoPointFiveDLdtkProjectJson,
  validateTwoPointFiveDLdtkWorkflowReadiness,
} from './ldtkProjectExporter.js'
import { applyTwoPointFiveDMapEditorWorkflow } from './mapEditorWorkflow.js'
import {
  buildTwoPointFiveDWorkflowReleaseEvidence,
  renderTwoPointFiveDWorkflowReleaseEvidenceMarkdown,
} from './workflowReleaseEvidence.js'
import {
  buildTwoPointFiveDConsumerPackageAudit,
  buildTwoPointFiveDPracticalImportValidation,
  buildTwoPointFiveDReleaseDemoManifest,
  buildTwoPointFiveDReleaseDemoZip,
  renderTwoPointFiveDReleaseDemoReadme,
} from './consumerPackage.js'
import {
  buildTwoPointFiveDExternalImportSmoke,
  buildTwoPointFiveDExternalRoundtripValidation,
  buildTwoPointFiveDExternalToolProbe,
  renderTwoPointFiveDExternalRoundtripChecklistMarkdown,
} from './externalRoundtripValidation.js'

function svgBuffer(svg) {
  return Buffer.from(svg)
}

function rect({ x, y, w, h }, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`
}

function materialSourceId(materialSource) {
  if (materialSource?.id) return materialSource.id
  if (materialSource?.path) return path.basename(materialSource.path)
  return 'manual_material_source'
}

function renderTransitionOverlay(tile, top, { offsetX, offsetY, materialProfile }) {
  if (tile.transition.tile_class !== 'transition') return ''
  const transitionFill = materialFill(materialProfile, 'transition_detail', '#8f7f45')
  const cornerFill = materialFill(materialProfile, 'corner_material', '#79b957')
  const cornerSize = 6
  const parts = []
  const corners = tile.transition.corners
  if (!corners.nw) parts.push(rect({ x: offsetX + top.x, y: offsetY + top.y, w: cornerSize, h: cornerSize }, cornerFill))
  if (!corners.ne) parts.push(rect({ x: offsetX + top.x + top.w - cornerSize, y: offsetY + top.y, w: cornerSize, h: cornerSize }, cornerFill))
  if (!corners.se) parts.push(rect({ x: offsetX + top.x + top.w - cornerSize, y: offsetY + top.y + top.h - cornerSize, w: cornerSize, h: cornerSize }, cornerFill))
  if (!corners.sw) parts.push(rect({ x: offsetX + top.x, y: offsetY + top.y + top.h - cornerSize, w: cornerSize, h: cornerSize }, cornerFill))

  if (corners.nw !== corners.ne) parts.push(rect({ x: offsetX + top.x, y: offsetY + top.y, w: top.w, h: 2 }, transitionFill))
  if (corners.sw !== corners.se) parts.push(rect({ x: offsetX + top.x, y: offsetY + top.y + top.h - 2, w: top.w, h: 2 }, transitionFill))
  if (corners.nw !== corners.sw) parts.push(rect({ x: offsetX + top.x, y: offsetY + top.y, w: 2, h: top.h }, transitionFill))
  if (corners.ne !== corners.se) parts.push(rect({ x: offsetX + top.x + top.w - 2, y: offsetY + top.y, w: 2, h: top.h }, transitionFill))
  return parts.join('')
}

function renderTileSvg(tile, { offsetX = tile.cell.x, offsetY = tile.cell.y, preview = false, materialProfile } = {}) {
  if (tile.transition.tile_class === 'empty' && !preview) return ''
  const top = tile.layers.top_face
  const front = tile.layers.front_face
  const left = tile.layers.left_side_face
  const right = tile.layers.right_side_face
  const edge = tile.layers.edge_trim
  const shadow = tile.layers.shadow
  const topFill = tile.transition.tile_class === 'empty' ? '#2f3a3b' : materialFill(materialProfile, 'top_material', '#5f9f4c')
  const sideFill = tile.transition.tile_class === 'empty' ? '#283033' : materialFill(materialProfile, 'side_material', '#6e4b32')
  const trimFill = tile.transition.tile_class === 'empty' ? '#2f3a3b' : materialFill(materialProfile, 'edge_material', '#b6d46d')
  const shadowFill = tile.transition.tile_class === 'empty' ? '#202426' : materialFill(materialProfile, 'shadow_material', '#242820')
  const anchor = preview
    ? `<circle cx="${offsetX + tile.pivot.x}" cy="${offsetY + tile.pivot.y}" r="2" fill="#ff3355"/>`
    : ''
  return [
    '<g>',
    rect({ x: offsetX + shadow.x, y: offsetY + shadow.y, w: shadow.w, h: shadow.h }, shadowFill),
    rect({ x: offsetX + left.x, y: offsetY + left.y, w: left.w, h: left.h }, sideFill),
    rect({ x: offsetX + right.x, y: offsetY + right.y, w: right.w, h: right.h }, sideFill),
    rect({ x: offsetX + front.x, y: offsetY + front.y, w: front.w, h: front.h }, sideFill),
    rect({ x: offsetX + top.x, y: offsetY + top.y, w: top.w, h: top.h }, topFill),
    renderTransitionOverlay(tile, top, { offsetX, offsetY, materialProfile }),
    rect({ x: offsetX + edge.x, y: offsetY + edge.y, w: edge.w, h: edge.h }, trimFill),
    rect({ x: offsetX + top.x, y: offsetY + top.y, w: top.w, h: top.h + front.h }, 'none', 'stroke="#1b2420" stroke-width="1"'),
    anchor,
    '</g>',
  ].join('')
}

async function pngFromSvg(svg) {
  return sharp(svgBuffer(svg)).png().toBuffer()
}

export async function renderStrictAtlasPng(plan) {
  const { width, height } = plan.atlas.strict_atlas_size
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    renderProceduralMaterialDefs(plan.material_profile),
    '<rect width="100%" height="100%" fill="transparent"/>',
    ...plan.tiles.map((tile) => renderTileSvg(tile, { materialProfile: plan.material_profile })),
    '</svg>',
  ].join('')
  return pngFromSvg(svg)
}

export async function renderRuntimePaddedAtlasPng(plan, strictAtlasPng) {
  const pad = plan.atlas.runtime_padding_policy.runtime_padded_atlas.padding_px
  const [cellW, cellH] = plan.atlas.tile_cell_size
  const runtimeCellW = cellW + pad * 2
  const runtimeCellH = cellH + pad * 2
  const width = plan.atlas.grid.columns * runtimeCellW
  const height = plan.atlas.grid.rows * runtimeCellH
  const strictPng = strictAtlasPng ?? await renderStrictAtlasPng(plan)
  const base = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#00000000',
    },
  })
    .png()
    .toBuffer()
  const composites = []
  for (let row = 0; row < plan.atlas.grid.rows; row += 1) {
    for (let col = 0; col < plan.atlas.grid.columns; col += 1) {
      let cellImage = sharp(strictPng).extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
      if (pad > 0) {
        cellImage = cellImage.extend({ top: pad, right: pad, bottom: pad, left: pad, extendWith: 'copy' })
      }
      composites.push({
        input: await cellImage.png().toBuffer(),
        left: col * runtimeCellW,
        top: row * runtimeCellH,
      })
    }
  }
  return sharp(base).composite(composites).png().toBuffer()
}

export async function renderPreviewPng(plan) {
  const cellW = plan.atlas.tile_cell_size[0]
  const cellH = plan.atlas.tile_cell_size[1]
  const previewGrid = plan.atlas.occupied_grid
  const gap = 6
  const width = previewGrid.columns * cellW + (previewGrid.columns + 1) * gap
  const height = previewGrid.rows * cellH + (previewGrid.rows + 1) * gap
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    renderProceduralMaterialDefs(plan.material_profile),
    '<rect width="100%" height="100%" fill="#202426"/>',
    ...plan.tiles.map((tile) => {
      const x = gap + tile.col * (cellW + gap)
      const y = gap + tile.row * (cellH + gap)
      return [
        rect({ x, y, w: cellW, h: cellH }, '#111516', 'stroke="#3b4448" stroke-width="1"'),
        renderTileSvg(tile, { offsetX: x, offsetY: y, preview: true, materialProfile: plan.material_profile }),
      ].join('')
    }),
    '</svg>',
  ].join('')
  return pngFromSvg(svg)
}

export async function renderMaterialSwatchesPng(plan) {
  const slots = Object.values(plan.material_profile.slots)
  const swatch = 40
  const gap = 8
  const width = slots.length * (swatch + gap) + gap
  const height = swatch + gap * 2
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    renderProceduralMaterialDefs(plan.material_profile),
    '<rect width="100%" height="100%" fill="#202426"/>',
    ...slots.map((slot, index) => {
      const x = gap + index * (swatch + gap)
      const y = gap
      return [
        rect({ x, y, w: swatch, h: swatch }, `url(#${slot.pattern_id})`),
        rect({ x, y, w: swatch, h: swatch }, 'none', 'stroke="#3b4448" stroke-width="1"'),
      ].join('')
    }),
    '</svg>',
  ].join('')
  return pngFromSvg(svg)
}

function tileDiagnosticsById(validationReport) {
  return new Map((validationReport?.per_tile_diagnostics ?? []).map((tile) => [tile.id, tile]))
}

function validationStatusForTile(tile, diagnosticsById) {
  const diagnostic = diagnosticsById.get(tile.id)
  if (!diagnostic) {
    return {
      status: 'not_run',
      errors: [],
      warnings: [],
      pixel_metrics: null,
    }
  }
  return {
    status: diagnostic.status,
    errors: [...diagnostic.errors],
    warnings: [...diagnostic.warnings],
    pixel_metrics: {
      visible_pixel_count: diagnostic.visible_bounds.visible_pixel_count,
      semi_transparent_pixel_count: diagnostic.visible_bounds.semi_transparent_pixel_count,
      actual_visible_bounds: diagnostic.visible_bounds.relative,
    },
  }
}

function mapEditorWorkflowArtifact(mapEditorWorkflow) {
  return {
    ...mapEditorWorkflow,
    map: {
      mode: mapEditorWorkflow.map.mode,
      arrangement: mapEditorWorkflow.map.arrangement,
      width: mapEditorWorkflow.map.width,
      height: mapEditorWorkflow.map.height,
      metrics: mapEditorWorkflow.map.metrics,
    },
  }
}

function buildReleaseDemoPackageEntries({
  normalizedContract,
  plan,
  metadata,
  validationReport,
  strictAtlasPng,
  runtimePaddedAtlasPng,
  materialSwatchesPng,
  previewPng,
  gridOverlayPng,
  collisionOverlayPng,
  randomMapPreviewPng,
  ruleMapPreviewPng,
  mapEditorPreviewPng,
  tiledJson,
  tiledTsx,
  ldtkProject,
  ldtkAutoLayerRules,
  ldtkProjectValidation,
  ldtkWorkflowValidation,
  workflowReleaseEvidence,
  mapRuleProfile,
  tileMap,
  tileMapValidation,
  constraintSolverReport,
  mapEditorWorkflow,
}) {
  return [
    { key: 'strict_atlas_png', packagePath: 'strict_atlas.png', type: 'png', required: true, content: strictAtlasPng },
    { key: 'runtime_padded_atlas_png', packagePath: 'runtime_padded_atlas.png', type: 'png', required: true, content: runtimePaddedAtlasPng },
    { key: 'tiled_json', packagePath: 'tileset.tiled.json', type: 'json', required: true, content: tiledJson },
    { key: 'tiled_tsx', packagePath: 'tileset.tsx', type: 'text', required: true, content: tiledTsx },
    { key: 'ldtk_project', packagePath: 'project.ldtk', type: 'json', required: true, content: ldtkProject },
    { key: 'map_editor_preview_png', packagePath: 'previews/map_editor_preview.png', type: 'png', required: true, content: mapEditorPreviewPng },
    { key: 'rule_map_preview_png', packagePath: 'previews/rule_map_preview.png', type: 'png', required: false, content: ruleMapPreviewPng },
    { key: 'random_map_preview_png', packagePath: 'previews/random_map_preview.png', type: 'png', required: false, content: randomMapPreviewPng },
    { key: 'grid_overlay_png', packagePath: 'previews/grid_overlay.png', type: 'png', required: false, content: gridOverlayPng },
    { key: 'collision_overlay_png', packagePath: 'previews/collision_overlay.png', type: 'png', required: false, content: collisionOverlayPng },
    { key: 'preview_png', packagePath: 'previews/atlas_preview.png', type: 'png', required: false, content: previewPng },
    { key: 'material_swatches_png', packagePath: 'previews/material_swatches.png', type: 'png', required: false, content: materialSwatchesPng },
    { key: 'metadata', packagePath: 'metadata/metadata.json', type: 'json', required: true, content: metadata },
    { key: 'contract', packagePath: 'metadata/tileset_contract.json', type: 'json', required: true, content: normalizedContract },
    { key: 'atlas_plan', packagePath: 'metadata/atlas_plan.json', type: 'json', required: false, content: plan },
    { key: 'material_profile', packagePath: 'metadata/material_profile.json', type: 'json', required: false, content: plan.material_profile },
    { key: 'map_rule_profile', packagePath: 'maps/map_rule_profile.json', type: 'json', required: false, content: mapRuleProfile },
    { key: 'tile_map', packagePath: 'maps/tile_map.json', type: 'json', required: true, content: tileMap },
    { key: 'tile_map_validation', packagePath: 'validation/tile_map_validation.json', type: 'json', required: true, content: tileMapValidation },
    { key: 'map_editor_workflow', packagePath: 'maps/map_editor_workflow.json', type: 'json', required: true, content: mapEditorWorkflowArtifact(mapEditorWorkflow) },
    { key: 'constraint_solver_report', packagePath: 'validation/constraint_solver_report.json', type: 'json', required: false, content: constraintSolverReport },
    { key: 'validation_report', packagePath: 'validation/validation_report.json', type: 'json', required: true, content: validationReport },
    { key: 'ldtk_auto_layer_rules', packagePath: 'editor/ldtk/ldtk_auto_layer_rules.json', type: 'json', required: true, content: ldtkAutoLayerRules },
    { key: 'ldtk_project_validation', packagePath: 'validation/ldtk_project_validation.json', type: 'json', required: true, content: ldtkProjectValidation },
    { key: 'ldtk_workflow_validation', packagePath: 'validation/ldtk_workflow_validation.json', type: 'json', required: true, content: ldtkWorkflowValidation },
    { key: 'workflow_release_evidence', packagePath: 'validation/workflow_release_evidence.json', type: 'json', required: true, content: workflowReleaseEvidence },
    { key: 'workflow_release_evidence_md', packagePath: 'validation/workflow_release_evidence.md', type: 'text', required: false, content: renderTwoPointFiveDWorkflowReleaseEvidenceMarkdown(workflowReleaseEvidence) },
  ].filter((entry) => entry.content !== undefined && entry.content !== null)
}

export function buildTwoPointFiveDMetadata(plan, {
  validationReport,
  materialSourceBridge = null,
  mapRuleProfile = null,
  tileMap = null,
  tileMapValidation = null,
  constraintSolverReport = null,
  mapEditorWorkflow = null,
  ldtkAutoLayerRules = null,
  ldtkProjectValidation = null,
  ldtkWorkflowValidation = null,
  workflowReleaseEvidence = null,
} = {}) {
  const diagnosticsById = tileDiagnosticsById(validationReport)
  return {
    schema_version: 1,
    mode: 'two_point_five_d_tileset_metadata_v0',
    contract_id: plan.contract_id,
    contract_version: plan.contract_version,
    projection: plan.projection,
    atlas: plan.atlas,
    rule_profile: plan.rule_profile,
    material_profile: plan.material_profile,
    source_normalization: plan.source_normalization,
    material_source: plan.material_source,
    material_source_guidance: plan.material_source_guidance,
    material_source_bridge: materialSourceBridge
      ? {
          mode: materialSourceBridge.mode,
          status: materialSourceBridge.status,
          source_role: materialSourceBridge.source_role,
          provider: materialSourceBridge.provider,
          provider_preset_id: materialSourceBridge.provider_preset_id,
          provider_label: materialSourceBridge.provider_label,
          model: materialSourceBridge.model,
          image_config: materialSourceBridge.image_config,
          provider_call_budget: materialSourceBridge.provider_call_budget,
          prompt_contract: materialSourceBridge.prompt_contract,
          generated_source: materialSourceBridge.generated_source,
          pipeline_handoff: materialSourceBridge.pipeline_handoff,
          claim_boundary: materialSourceBridge.claim_boundary,
        }
      : null,
    map_rule_profile: mapRuleProfile
      ? {
          mode: mapRuleProfile.mode,
          rule_profile_id: mapRuleProfile.rule_profile_id,
          wfc_scope: mapRuleProfile.wfc_scope,
          mask_count: mapRuleProfile.masks.length,
        }
      : null,
    tile_map: tileMap
      ? {
          mode: tileMap.mode,
          rule_profile_id: tileMap.rule_profile_id,
          width: tileMap.width,
          height: tileMap.height,
          arrangement: tileMap.arrangement,
          validation_status: tileMapValidation?.status ?? 'not_run',
          metrics: tileMap.metrics,
        }
      : null,
    constraint_solver: constraintSolverReport
      ? {
          mode: constraintSolverReport.mode,
          status: constraintSolverReport.status,
          algorithm: constraintSolverReport.algorithm,
          decision_count: constraintSolverReport.decision_count,
          backtrack_count: constraintSolverReport.backtrack_count,
          propagation_step_count: constraintSolverReport.propagation_step_count,
          search_node_count: constraintSolverReport.search_node_count,
      }
      : null,
    map_editor_workflow: mapEditorWorkflow
      ? {
          mode: mapEditorWorkflow.mode,
          status: mapEditorWorkflow.status,
          operation_count: mapEditorWorkflow.operations.length,
          changed_cell_count: mapEditorWorkflow.changed_cell_count,
          claim_boundary: mapEditorWorkflow.claim_boundary,
        }
      : null,
    ldtk_project: ldtkProjectValidation
      ? {
          mode: ldtkProjectValidation.mode,
          status: ldtkProjectValidation.status,
          metrics: ldtkProjectValidation.metrics,
          workflow_validation: ldtkWorkflowValidation
            ? {
                mode: ldtkWorkflowValidation.mode,
                status: ldtkWorkflowValidation.status,
                metrics: ldtkWorkflowValidation.metrics,
                claim_boundary: ldtkWorkflowValidation.claim_boundary,
              }
            : null,
          auto_layer_rules: ldtkAutoLayerRules
            ? {
                mode: ldtkAutoLayerRules.mode,
                layer_identifier: ldtkAutoLayerRules.layer_identifier,
                rule_group_count: ldtkAutoLayerRules.auto_rule_groups.length,
                rule_count: ldtkAutoLayerRules.auto_rule_groups.reduce((total, group) => total + group.rules.length, 0),
                int_grid_value_count: ldtkAutoLayerRules.int_grid_values.length,
              }
            : null,
          claim_boundary: 'Concrete single-level LDtk project export plus LDtk-style auto-layer rule authoring; no editor round-trip evaluation or full WFC solver are claimed.',
        }
      : null,
    workflow_release_evidence: workflowReleaseEvidence
      ? {
          mode: workflowReleaseEvidence.mode,
          status: workflowReleaseEvidence.status,
          release_ready: workflowReleaseEvidence.release_ready,
          summary: workflowReleaseEvidence.summary,
          claim_boundary: workflowReleaseEvidence.claim_boundary,
        }
      : null,
    terrain_types: plan.terrain_types,
    export_policy: {
      strict_atlas: plan.atlas.runtime_padding_policy.strict_atlas,
      runtime_padded_atlas: plan.atlas.runtime_padding_policy.runtime_padded_atlas,
      coordinate_mapping: plan.atlas.runtime_padding_policy.coordinate_mapping,
    },
    tiles: plan.tiles.map((tile) => ({
      id: tile.id,
      rule_profile_id: tile.rule_profile_id,
      rule_index: tile.rule_index,
      mask: tile.mask,
      atlas_tile_id: tile.atlas_tile_id,
      tile_role: tile.tile_role,
      role_tags: tile.role_tags,
      terrain_type: tile.terrain_type,
      transition_to_terrain_type: tile.transition_to_terrain_type,
      cell: tile.cell,
      source_rect: tile.source_rect,
      runtime_source_rect: tile.runtime_source_rect,
      runtime_inner_rect: tile.runtime_inner_rect,
      pivot: tile.pivot,
      logical_footprint: tile.logical_footprint,
      collision: tile.collision,
      visual_bounds: tile.visual_bounds,
      z_order_hint: tile.z_order_hint,
      validation_status: validationStatusForTile(tile, diagnosticsById),
      transition: tile.transition,
      layers: tile.layers,
      material_slots: tile.material_slots,
    })),
    pipeline_stages: plan.pipeline_stages,
  }
}

function rectProperties(prefix, rect) {
  if (!rect) return []
  return [
    { name: `${prefix}_x`, type: 'int', value: rect.x },
    { name: `${prefix}_y`, type: 'int', value: rect.y },
    { name: `${prefix}_w`, type: 'int', value: rect.w },
    { name: `${prefix}_h`, type: 'int', value: rect.h },
  ]
}

function tiledTileProperties(tile) {
  return [
    { name: 'mask', type: 'int', value: tile.mask },
    { name: 'rule_profile', type: 'string', value: tile.rule_profile_id },
    { name: 'tile_class', type: 'string', value: tile.transition.tile_class },
    { name: 'tile_role', type: 'string', value: tile.tile_role },
    { name: 'role_tags', type: 'string', value: tile.role_tags.join(',') },
    { name: 'terrain_type', type: 'string', value: tile.terrain_type },
    { name: 'transition_to_terrain_type', type: 'string', value: tile.transition_to_terrain_type ?? '' },
    { name: 'active_corner_count', type: 'int', value: tile.transition.active_corner_count },
    { name: 'pivot_x', type: 'float', value: tile.pivot.x },
    { name: 'pivot_y', type: 'float', value: tile.pivot.y },
    { name: 'collision_x', type: 'int', value: tile.collision.x },
    { name: 'collision_y', type: 'int', value: tile.collision.y },
    { name: 'collision_w', type: 'int', value: tile.collision.w },
    { name: 'collision_h', type: 'int', value: tile.collision.h },
    ...rectProperties('source_rect', tile.source_rect),
    ...rectProperties('runtime_source_rect', tile.runtime_source_rect),
    ...rectProperties('runtime_inner_rect', tile.runtime_inner_rect),
    ...rectProperties('visual_bounds', tile.visual_bounds),
    { name: 'z_order_mode', type: 'string', value: tile.z_order_hint.mode },
    { name: 'z_order_draw_layer', type: 'string', value: tile.z_order_hint.draw_layer },
    { name: 'z_order_sort_x', type: 'float', value: tile.z_order_hint.sort_x },
    { name: 'z_order_sort_y', type: 'float', value: tile.z_order_hint.sort_y },
  ]
}

export function buildTiledJson(plan, { image = 'strict_atlas.png' } = {}) {
  const [cellW, cellH] = plan.atlas.tile_cell_size
  const runtimePolicy = plan.atlas.runtime_padding_policy.runtime_padded_atlas
  return {
    type: 'tileset',
    tiledversion: '1.10.2',
    name: plan.contract_id,
    tilewidth: cellW,
    tileheight: cellH,
    tilecount: plan.atlas.available_cell_count,
    columns: plan.atlas.grid.columns,
    image,
    imagewidth: plan.atlas.strict_atlas_size.width,
    imageheight: plan.atlas.strict_atlas_size.height,
    properties: [
      { name: 'projection', type: 'string', value: plan.projection.type },
      { name: 'rule_profile', type: 'string', value: plan.rule_profile.id },
      { name: 'logical_tile_width', type: 'int', value: plan.projection.logical_tile_size[0] },
      { name: 'logical_tile_height', type: 'int', value: plan.projection.logical_tile_size[1] },
      { name: 'pivot', type: 'string', value: plan.projection.pivot },
      { name: 'fixed_height_px', type: 'int', value: plan.projection.fixed_height_px },
      { name: 'runtime_padding_mode', type: 'string', value: plan.atlas.runtime_padding_policy.mode },
      { name: 'runtime_padding_px', type: 'int', value: runtimePolicy.padding_px },
      { name: 'runtime_tile_width', type: 'int', value: runtimePolicy.cell_size.width },
      { name: 'runtime_tile_height', type: 'int', value: runtimePolicy.cell_size.height },
      { name: 'runtime_margin_px', type: 'int', value: runtimePolicy.margin_px },
      { name: 'runtime_spacing_px', type: 'int', value: runtimePolicy.spacing_px },
    ],
    tiles: plan.tiles.map((tile) => ({
      id: tile.atlas_tile_id,
      properties: tiledTileProperties(tile),
    })),
  }
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildTiledTsx(plan, { image = 'strict_atlas.png' } = {}) {
  const [cellW, cellH] = plan.atlas.tile_cell_size
  const runtimePolicy = plan.atlas.runtime_padding_policy.runtime_padded_atlas
  const properties = [
    `<property name="projection" value="${xmlEscape(plan.projection.type)}"/>`,
    `<property name="rule_profile" value="${xmlEscape(plan.rule_profile.id)}"/>`,
    `<property name="logical_tile_width" type="int" value="${plan.projection.logical_tile_size[0]}"/>`,
    `<property name="logical_tile_height" type="int" value="${plan.projection.logical_tile_size[1]}"/>`,
    `<property name="pivot" value="${xmlEscape(plan.projection.pivot)}"/>`,
    `<property name="fixed_height_px" type="int" value="${plan.projection.fixed_height_px}"/>`,
    `<property name="runtime_padding_mode" value="${xmlEscape(plan.atlas.runtime_padding_policy.mode)}"/>`,
    `<property name="runtime_padding_px" type="int" value="${runtimePolicy.padding_px}"/>`,
    `<property name="runtime_tile_width" type="int" value="${runtimePolicy.cell_size.width}"/>`,
    `<property name="runtime_tile_height" type="int" value="${runtimePolicy.cell_size.height}"/>`,
    `<property name="runtime_margin_px" type="int" value="${runtimePolicy.margin_px}"/>`,
    `<property name="runtime_spacing_px" type="int" value="${runtimePolicy.spacing_px}"/>`,
  ].join('')
  const tiles = plan.tiles
    .map((tile) => {
      const tileProperties = tiledTileProperties(tile)
        .map((property) => {
          const type = property.type === 'string' ? '' : ` type="${property.type}"`
          return `<property name="${xmlEscape(property.name)}"${type} value="${xmlEscape(property.value)}"/>`
        })
        .join('')
      return `<tile id="${tile.atlas_tile_id}"><properties>${tileProperties}</properties></tile>`
    })
    .join('')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="1.10" tiledversion="1.10.2" name="${xmlEscape(plan.contract_id)}" tilewidth="${cellW}" tileheight="${cellH}" tilecount="${plan.atlas.available_cell_count}" columns="${plan.atlas.grid.columns}">`,
    `<properties>${properties}</properties>`,
    `<image source="${xmlEscape(image)}" width="${plan.atlas.strict_atlas_size.width}" height="${plan.atlas.strict_atlas_size.height}"/>`,
    tiles,
    '</tileset>',
  ].join('')
}

export async function writeTwoPointFiveDTilesetArtifacts({
  contract = {},
  materialSource = null,
  materialSourceBridge = null,
  materialSampleLayout = null,
  mapOptions = {},
  outputDir = 'generated/two-point-five-d-tilesets',
  runId = 'two_point_five_d_tileset',
} = {}) {
  const normalizedContract = normalizeTwoPointFiveDTilesetContract(contract)
  let normalizedMaterialSourcePng = null
  let sourceNormalization = null
  let materialSourceReport = null
  let materialSourceGuidance = null
  let materialSourceGuidanceMarkdown = null
  let materialSourceSamplesPreviewPng = null
  let materialLayoutCandidatesPreviewPng = null
  let materialSlotCandidatesPreviewPng = null
  let materialPatchSheetPng = null
  let materialProfile = null
  const materialSourceBuffer = Buffer.isBuffer(materialSource) ? materialSource : materialSource?.buffer
  if (materialSourceBuffer) {
    const normalized = await normalizeTwoPointFiveDMaterialSource({
      sourceBuffer: materialSourceBuffer,
      sourceId: materialSourceId(materialSource),
      targetSize: [normalizedContract.canvas.width, normalizedContract.canvas.height],
    })
    normalizedMaterialSourcePng = normalized.normalizedPng
    sourceNormalization = normalized.report
    const materialBuild = await buildManualMaterialProfileFromSource({
      normalizedSourcePng: normalizedMaterialSourcePng,
      contract: normalizedContract,
      sourceNormalization,
      sampleLayout: materialSampleLayout ?? undefined,
    })
    materialProfile = materialBuild.materialProfile
    materialSourceReport = materialBuild.report
    materialSourceGuidance = buildMaterialSourceAuthoringGuidance({
      sourceNormalization,
      materialSourceReport,
    })
    materialSourceGuidanceMarkdown = renderMaterialSourceAuthoringGuidanceMarkdown(materialSourceGuidance)
    materialSourceSamplesPreviewPng = await renderMaterialSourceSamplesPreviewPng(normalizedMaterialSourcePng, materialSourceReport)
    materialLayoutCandidatesPreviewPng = await renderMaterialLayoutCandidatesPreviewPng(normalizedMaterialSourcePng, materialSourceReport)
    materialSlotCandidatesPreviewPng = await renderMaterialSlotCandidatesPreviewPng(normalizedMaterialSourcePng, materialSourceReport)
    materialPatchSheetPng = await renderMaterialPatchSheetPng(materialProfile)
  }
  const plan = buildTwoPointFiveDAtlasPlan(normalizedContract, {
    materialProfile,
    sourceNormalization,
    materialSourceReport,
    materialSourceGuidance,
  })
  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })

  const strictAtlasPng = await renderStrictAtlasPng(plan)
  const runtimePaddedAtlasPng = await renderRuntimePaddedAtlasPng(plan, strictAtlasPng)
  const previewPng = await renderPreviewPng(plan)
  const materialSwatchesPng = await renderMaterialSwatchesPng(plan)
  const pixelValidation = await validateRenderedTilesetPng({ plan, strictAtlasPng })
  const validationReport = buildTwoPointFiveDValidationReport({ plan, pixelValidation })
  const mapRuleProfile = buildTwoPointFiveDMapRuleProfile(plan)
  let constraintSolverReport = null
  let tileMap = null
  if (mapOptions.solver === 'seeded') {
    tileMap = buildTwoPointFiveDGuardedRuleMap({
      plan,
      width: mapOptions.width ?? 8,
      height: mapOptions.height ?? 6,
      seed: mapOptions.seed ?? plan.material_profile.seed,
      density: mapOptions.density ?? 0.55,
    })
  } else {
    const solved = solveTwoPointFiveDConstraintMap({
      plan,
      width: mapOptions.width ?? 8,
      height: mapOptions.height ?? 6,
      seed: mapOptions.seed ?? plan.material_profile.seed,
      density: mapOptions.density ?? 0.55,
      constraints: {
        border: mapOptions.border ?? 'empty',
        fixed_masks: mapOptions.fixedMasks ?? [],
        allowed_masks: mapOptions.allowedMasks,
      },
    })
    if (solved.status !== 'pass') {
      throw new Error(`2.5D constraint solver failed: ${solved.report.contradictions.map((item) => item.reason).join(', ')}`)
    }
    tileMap = solved.map
    constraintSolverReport = solved.report
  }
  const mapEditorWorkflow = applyTwoPointFiveDMapEditorWorkflow({
    plan,
    map: tileMap,
    operations: mapOptions.editorOperations ?? [],
    sessionId: `${runId}_map_editor`,
  })
  tileMap = mapEditorWorkflow.map
  const tileMapValidation = validateTwoPointFiveDRuleMap(tileMap, { plan })
  if (tileMapValidation.status === 'fail') {
    throw new Error(`2.5D rule map validation failed: ${tileMapValidation.blocking_errors.join(', ')}`)
  }
  const ldtkAutoLayerRules = buildTwoPointFiveDLdtkAutoLayerRules({ plan })
  const ldtkProject = buildTwoPointFiveDLdtkProjectJson({
    plan,
    map: tileMap,
    projectId: plan.contract_id,
    identifier: runId,
    tilesetRelPath: 'strict_atlas.png',
  })
  const ldtkProjectValidation = validateTwoPointFiveDLdtkProjectJson(ldtkProject)
  if (ldtkProjectValidation.status === 'fail') {
    throw new Error(`2.5D LDtk project validation failed: ${ldtkProjectValidation.blocking_errors.join(', ')}`)
  }
  const ldtkWorkflowValidation = validateTwoPointFiveDLdtkWorkflowReadiness(ldtkProject, {
    expectedTilesetRelPath: 'strict_atlas.png',
  })
  if (ldtkWorkflowValidation.status === 'fail') {
    throw new Error(`2.5D LDtk workflow validation failed: ${ldtkWorkflowValidation.blocking_errors.join(', ')}`)
  }
  const tiledJson = buildTiledJson(plan)
  const tiledTsx = buildTiledTsx(plan)
  const gridOverlayPng = await renderGridOverlayPng(plan, strictAtlasPng)
  const collisionOverlayPng = await renderCollisionOverlayPng(plan, strictAtlasPng)
  const randomMapPreviewPng = await renderRandomMapPreviewPng(plan, strictAtlasPng)
  const ruleMapPreviewPng = await renderRuleMapPreviewPng(plan, strictAtlasPng, tileMap)
  const mapEditorPreviewPng = ruleMapPreviewPng

  const files = {
    contract: path.join(runDir, 'tileset_contract.json'),
    atlas_plan: path.join(runDir, 'atlas_plan.json'),
    map_rule_profile: path.join(runDir, 'map_rule_profile.json'),
    tile_map: path.join(runDir, 'tile_map.json'),
    tile_map_validation: path.join(runDir, 'tile_map_validation.json'),
    map_editor_workflow: path.join(runDir, 'map_editor_workflow.json'),
    material_profile: path.join(runDir, 'material_profile.json'),
    metadata: path.join(runDir, 'metadata.json'),
    validation_report: path.join(runDir, 'validation_report.json'),
    strict_atlas_png: path.join(runDir, 'strict_atlas.png'),
    runtime_padded_atlas_png: path.join(runDir, 'runtime_padded_atlas.png'),
    material_swatches_png: path.join(runDir, 'material_swatches.png'),
    preview_png: path.join(runDir, 'preview.png'),
    grid_overlay_png: path.join(runDir, 'grid_overlay.png'),
    collision_overlay_png: path.join(runDir, 'collision_overlay.png'),
    random_map_preview_png: path.join(runDir, 'random_map_preview.png'),
    rule_map_preview_png: path.join(runDir, 'rule_map_preview.png'),
    map_editor_preview_png: path.join(runDir, 'map_editor_preview.png'),
    tiled_json: path.join(runDir, 'tileset.tiled.json'),
    tiled_tsx: path.join(runDir, 'tileset.tsx'),
    ldtk_project: path.join(runDir, 'project.ldtk'),
    ldtk_auto_layer_rules: path.join(runDir, 'ldtk_auto_layer_rules.json'),
    ldtk_project_validation: path.join(runDir, 'ldtk_project_validation.json'),
    ldtk_workflow_validation: path.join(runDir, 'ldtk_workflow_validation.json'),
    workflow_release_evidence: path.join(runDir, 'workflow_release_evidence.json'),
    workflow_release_evidence_md: path.join(runDir, 'workflow_release_evidence.md'),
    consumer_package_audit: path.join(runDir, 'consumer_package_audit.json'),
    import_validation: path.join(runDir, 'import_validation.json'),
    release_demo_manifest: path.join(runDir, 'release_demo_manifest.json'),
    release_demo_readme: path.join(runDir, 'release_demo_README.md'),
    release_demo_pack_zip: path.join(runDir, 'release_demo_pack.zip'),
    external_tool_probe: path.join(runDir, 'external_tool_probe.json'),
    external_import_smoke: path.join(runDir, 'external_import_smoke.json'),
    external_roundtrip_validation: path.join(runDir, 'external_roundtrip_validation.json'),
    external_roundtrip_checklist_md: path.join(runDir, 'external_roundtrip_checklist.md'),
  }
  if (materialSourceBridge) {
    files.ai_material_source_bridge = path.join(runDir, 'ai_material_source_bridge.json')
    files.ai_material_source_prompt = path.join(runDir, 'ai_material_source_prompt.txt')
    if (materialSourceBuffer) files.provider_material_source_png = path.join(runDir, 'provider_material_source.png')
  }
  if (constraintSolverReport) files.constraint_solver_report = path.join(runDir, 'constraint_solver_report.json')
  if (normalizedMaterialSourcePng && sourceNormalization && materialSourceReport) {
    files.normalized_material_source_png = path.join(runDir, 'normalized_material_source.png')
    files.source_normalization_report = path.join(runDir, 'source_normalization.json')
    files.material_source_report = path.join(runDir, 'material_source_report.json')
    files.material_source_guidance_json = path.join(runDir, 'material_source_guidance.json')
    files.material_source_guidance_md = path.join(runDir, 'material_source_guidance.md')
    files.material_source_samples_png = path.join(runDir, 'material_source_samples.png')
    files.material_layout_candidates_png = path.join(runDir, 'material_layout_candidates.png')
    if (materialSlotCandidatesPreviewPng) files.material_slot_candidates_png = path.join(runDir, 'material_slot_candidates.png')
    files.material_patches_png = path.join(runDir, 'material_patches.png')
  }
  const workflowReleaseEvidence = buildTwoPointFiveDWorkflowReleaseEvidence({
    plan,
    validationReport,
    sourceNormalization,
    materialSourceReport,
    tileMap,
    tileMapValidation,
    constraintSolverReport,
    mapEditorWorkflow,
    ldtkProjectValidation,
    ldtkWorkflowValidation,
    artifacts: files,
  })
  const metadata = buildTwoPointFiveDMetadata(plan, {
    validationReport,
    materialSourceBridge,
    mapRuleProfile,
    tileMap,
    tileMapValidation,
    constraintSolverReport,
    mapEditorWorkflow,
    ldtkAutoLayerRules,
    ldtkProjectValidation,
    ldtkWorkflowValidation,
    workflowReleaseEvidence,
  })
  const baseReleaseDemoEntries = buildReleaseDemoPackageEntries({
    normalizedContract,
    plan,
    metadata,
    validationReport,
    strictAtlasPng,
    runtimePaddedAtlasPng,
    materialSwatchesPng,
    previewPng,
    gridOverlayPng,
    collisionOverlayPng,
    randomMapPreviewPng,
    ruleMapPreviewPng,
    mapEditorPreviewPng,
    tiledJson,
    tiledTsx,
    ldtkProject,
    ldtkAutoLayerRules,
    ldtkProjectValidation,
    ldtkWorkflowValidation,
    workflowReleaseEvidence,
    mapRuleProfile,
    tileMap,
    tileMapValidation,
    constraintSolverReport,
    mapEditorWorkflow,
  })
  const requiredReleaseDemoKeys = [
    'strict_atlas_png',
    'runtime_padded_atlas_png',
    'tiled_json',
    'tiled_tsx',
    'ldtk_project',
    'map_editor_preview_png',
    'metadata',
    'contract',
    'tile_map',
    'tile_map_validation',
    'map_editor_workflow',
    'validation_report',
    'ldtk_auto_layer_rules',
    'ldtk_project_validation',
    'ldtk_workflow_validation',
    'workflow_release_evidence',
    'consumer_package_audit',
    'import_validation',
    'release_demo_manifest',
    'release_demo_readme',
  ]
  const packageAuditPlaceholderEntries = [
    ...baseReleaseDemoEntries,
    { key: 'consumer_package_audit', packagePath: 'validation/consumer_package_audit.json', type: 'json', required: true, content: {} },
    { key: 'import_validation', packagePath: 'validation/import_validation.json', type: 'json', required: true, content: {} },
    { key: 'release_demo_manifest', packagePath: 'release_demo_manifest.json', type: 'json', required: true, content: {} },
    { key: 'release_demo_readme', packagePath: 'README.md', type: 'text', required: true, content: '' },
  ]
  const consumerPackageAudit = buildTwoPointFiveDConsumerPackageAudit({
    entries: packageAuditPlaceholderEntries,
    requiredKeys: requiredReleaseDemoKeys,
    tiledJson,
    tiledTsx,
    ldtkProject,
    metadata,
  })
  const externalToolProbe = await buildTwoPointFiveDExternalToolProbe()
  const importValidation = buildTwoPointFiveDPracticalImportValidation({
    plan,
    tiledJson,
    tiledTsx,
    ldtkProject,
    ldtkProjectValidation,
    ldtkWorkflowValidation,
    packageAudit: consumerPackageAudit,
    externalEditorProbe: externalToolProbe,
  })
  const releaseDemoManifest = buildTwoPointFiveDReleaseDemoManifest({
    runId,
    plan,
    packageAudit: consumerPackageAudit,
    importValidation,
    workflowReleaseEvidence,
    entries: packageAuditPlaceholderEntries,
  })
  const releaseDemoReadme = renderTwoPointFiveDReleaseDemoReadme({
    manifest: releaseDemoManifest,
    packageAudit: consumerPackageAudit,
    importValidation,
    workflowReleaseEvidence,
  })
  const releaseDemoEntries = [
    ...baseReleaseDemoEntries,
    { key: 'consumer_package_audit', packagePath: 'validation/consumer_package_audit.json', type: 'json', required: true, content: consumerPackageAudit },
    { key: 'import_validation', packagePath: 'validation/import_validation.json', type: 'json', required: true, content: importValidation },
    { key: 'release_demo_manifest', packagePath: 'release_demo_manifest.json', type: 'json', required: true, content: releaseDemoManifest },
    { key: 'release_demo_readme', packagePath: 'README.md', type: 'text', required: true, content: releaseDemoReadme },
  ]
  const releaseDemoPackZip = await buildTwoPointFiveDReleaseDemoZip(releaseDemoEntries)
  const externalImportSmoke = await buildTwoPointFiveDExternalImportSmoke({
    releaseDemoPackZip,
    externalToolProbe,
  })
  const externalRoundtripValidation = buildTwoPointFiveDExternalRoundtripValidation({
    externalToolProbe,
    externalImportSmoke,
    packageAudit: consumerPackageAudit,
    importValidation,
  })
  const externalRoundtripChecklistMarkdown = renderTwoPointFiveDExternalRoundtripChecklistMarkdown(externalRoundtripValidation)

  await writeFile(files.contract, JSON.stringify(normalizedContract, null, 2))
  await writeFile(files.atlas_plan, JSON.stringify(plan, null, 2))
  await writeFile(files.map_rule_profile, JSON.stringify(mapRuleProfile, null, 2))
  if (constraintSolverReport) await writeFile(files.constraint_solver_report, JSON.stringify(constraintSolverReport, null, 2))
  await writeFile(files.tile_map, JSON.stringify(tileMap, null, 2))
  await writeFile(files.tile_map_validation, JSON.stringify(tileMapValidation, null, 2))
  await writeFile(files.map_editor_workflow, JSON.stringify({
    ...mapEditorWorkflow,
    map: {
      mode: mapEditorWorkflow.map.mode,
      arrangement: mapEditorWorkflow.map.arrangement,
      width: mapEditorWorkflow.map.width,
      height: mapEditorWorkflow.map.height,
      metrics: mapEditorWorkflow.map.metrics,
    },
  }, null, 2))
  await writeFile(files.material_profile, JSON.stringify(plan.material_profile, null, 2))
  await writeFile(files.metadata, JSON.stringify(metadata, null, 2))
  await writeFile(files.validation_report, JSON.stringify(validationReport, null, 2))
  await writeFile(files.strict_atlas_png, strictAtlasPng)
  await writeFile(files.runtime_padded_atlas_png, runtimePaddedAtlasPng)
  await writeFile(files.material_swatches_png, materialSwatchesPng)
  await writeFile(files.preview_png, previewPng)
  await writeFile(files.grid_overlay_png, gridOverlayPng)
  await writeFile(files.collision_overlay_png, collisionOverlayPng)
  await writeFile(files.random_map_preview_png, randomMapPreviewPng)
  await writeFile(files.rule_map_preview_png, ruleMapPreviewPng)
  await writeFile(files.map_editor_preview_png, mapEditorPreviewPng)
  await writeFile(files.tiled_json, JSON.stringify(tiledJson, null, 2))
  await writeFile(files.tiled_tsx, tiledTsx)
  await writeFile(files.ldtk_project, JSON.stringify(ldtkProject, null, 2))
  await writeFile(files.ldtk_auto_layer_rules, JSON.stringify(ldtkAutoLayerRules, null, 2))
  await writeFile(files.ldtk_project_validation, JSON.stringify(ldtkProjectValidation, null, 2))
  await writeFile(files.ldtk_workflow_validation, JSON.stringify(ldtkWorkflowValidation, null, 2))
  await writeFile(files.workflow_release_evidence, JSON.stringify(workflowReleaseEvidence, null, 2))
  await writeFile(files.workflow_release_evidence_md, renderTwoPointFiveDWorkflowReleaseEvidenceMarkdown(workflowReleaseEvidence))
  await writeFile(files.consumer_package_audit, JSON.stringify(consumerPackageAudit, null, 2))
  await writeFile(files.import_validation, JSON.stringify(importValidation, null, 2))
  await writeFile(files.release_demo_manifest, JSON.stringify(releaseDemoManifest, null, 2))
  await writeFile(files.release_demo_readme, releaseDemoReadme)
  await writeFile(files.release_demo_pack_zip, releaseDemoPackZip)
  await writeFile(files.external_tool_probe, JSON.stringify(externalToolProbe, null, 2))
  await writeFile(files.external_import_smoke, JSON.stringify(externalImportSmoke, null, 2))
  await writeFile(files.external_roundtrip_validation, JSON.stringify(externalRoundtripValidation, null, 2))
  await writeFile(files.external_roundtrip_checklist_md, externalRoundtripChecklistMarkdown)
  if (materialSourceBridge) {
    await writeFile(files.ai_material_source_bridge, JSON.stringify(materialSourceBridge, null, 2))
    await writeFile(files.ai_material_source_prompt, materialSourceBridge.prompt ?? '')
    if (materialSourceBuffer) await writeFile(files.provider_material_source_png, materialSourceBuffer)
  }
  if (normalizedMaterialSourcePng && sourceNormalization && materialSourceReport) {
    await writeFile(files.normalized_material_source_png, normalizedMaterialSourcePng)
    await writeFile(files.source_normalization_report, JSON.stringify(sourceNormalization, null, 2))
    await writeFile(files.material_source_report, JSON.stringify(materialSourceReport, null, 2))
    await writeFile(files.material_source_guidance_json, JSON.stringify(materialSourceGuidance, null, 2))
    await writeFile(files.material_source_guidance_md, materialSourceGuidanceMarkdown)
    await writeFile(files.material_source_samples_png, materialSourceSamplesPreviewPng)
    if (materialLayoutCandidatesPreviewPng) await writeFile(files.material_layout_candidates_png, materialLayoutCandidatesPreviewPng)
    if (materialSlotCandidatesPreviewPng) await writeFile(files.material_slot_candidates_png, materialSlotCandidatesPreviewPng)
    await writeFile(files.material_patches_png, materialPatchSheetPng)
  }

  return {
    status: validationReport.status,
    run_id: runId,
    output_dir: runDir,
    contract: normalizedContract,
    validation: validationReport,
    plan,
    metadata,
    map_rule_profile: mapRuleProfile,
    tile_map: tileMap,
    tile_map_validation: tileMapValidation,
    constraint_solver_report: constraintSolverReport,
    map_editor_workflow: mapEditorWorkflow,
    ldtk_auto_layer_rules: ldtkAutoLayerRules,
    ldtk_project: ldtkProject,
    ldtk_project_validation: ldtkProjectValidation,
    ldtk_workflow_validation: ldtkWorkflowValidation,
    workflow_release_evidence: workflowReleaseEvidence,
    ai_material_source_bridge: materialSourceBridge,
    consumer_package_audit: consumerPackageAudit,
    import_validation: importValidation,
    release_demo_manifest: releaseDemoManifest,
    external_tool_probe: externalToolProbe,
    external_import_smoke: externalImportSmoke,
    external_roundtrip_validation: externalRoundtripValidation,
    artifacts: files,
  }
}
