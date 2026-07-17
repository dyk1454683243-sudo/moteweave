import {
  normalizeTwoPointFiveDTilesetContract,
  validateTwoPointFiveDTilesetContract,
} from './tilesetContract.js'
import { buildProceduralMaterialProfile } from './proceduralMaterials.js'

const CORNER_BITS = Object.freeze({
  nw: 1,
  ne: 2,
  se: 4,
  sw: 8,
})

const SIDE_TO_CORNERS = Object.freeze({
  north: ['nw', 'ne'],
  east: ['ne', 'se'],
  south: ['sw', 'se'],
  west: ['nw', 'sw'],
})

function cornersForMask(mask) {
  return Object.fromEntries(Object.entries(CORNER_BITS).map(([key, bit]) => [key, Boolean(mask & bit)]))
}

function edgesForCorners(corners) {
  return Object.fromEntries(
    Object.entries(SIDE_TO_CORNERS).map(([side, keys]) => [side, keys.map((key) => corners[key])])
  )
}

function tileClassForMask(mask, solidMask) {
  if (mask === 0) return 'empty'
  if (mask === solidMask) return 'solid'
  return 'transition'
}

function tileRoleForTransition(transition) {
  if (transition.tile_class === 'empty') return 'empty'
  if (transition.tile_class === 'solid') return 'solid'
  if (transition.active_corner_count === 1) return 'outer_corner'
  if (transition.active_corner_count === 3) return 'inner_corner'
  if (transition.active_corner_count === 2) {
    const active = new Set(transition.active_corners)
    const adjacent =
      (active.has('nw') && active.has('ne')) ||
      (active.has('ne') && active.has('se')) ||
      (active.has('se') && active.has('sw')) ||
      (active.has('sw') && active.has('nw'))
    return adjacent ? 'edge' : 'diagonal_transition'
  }
  return 'transition'
}

function roleTagsForTransition(transition, tileRole) {
  const tags = new Set([tileRole])
  if (transition.tile_class === 'transition') tags.add('transition')
  if (transition.active_corner_count === 1) tags.add('isolated_block')
  if (transition.active_corner_count > 0 && transition.active_corner_count < 4) tags.add('autotile_variant')
  return [...tags]
}

function anchorForPivot(pivot, spriteW, spriteH) {
  if (pivot === 'top_left') return { x: 0, y: 0 }
  if (pivot === 'center') return { x: spriteW / 2, y: spriteH / 2 }
  return { x: spriteW / 2, y: spriteH }
}

function buildLayerGeometry(contract) {
  const [spriteW, spriteH] = contract.projection.sprite_cell_size
  const [logicalW, logicalH] = contract.projection.logical_tile_size
  const height = contract.projection.fixed_height_px
  const top = {
    x: Math.floor((spriteW - logicalW) / 2),
    y: spriteH - logicalH - height,
    w: logicalW,
    h: logicalH,
  }
  return {
    top_face: top,
    front_face: { x: top.x, y: top.y + top.h, w: top.w, h: height },
    left_side_face: { x: Math.max(0, top.x - 8), y: top.y + top.h, w: 8, h: height },
    right_side_face: { x: top.x + top.w, y: top.y + top.h, w: 8, h: height },
    edge_trim: { x: top.x, y: top.y + top.h - 2, w: top.w, h: 2 },
    shadow: { x: Math.max(0, top.x - 4), y: spriteH - 8, w: Math.min(spriteW, top.w + 8), h: 6 },
  }
}

function rectUnion(rects) {
  const valid = rects.filter((rect) => rect && rect.w > 0 && rect.h > 0)
  if (!valid.length) return null
  const minX = Math.min(...valid.map((rect) => rect.x))
  const minY = Math.min(...valid.map((rect) => rect.y))
  const maxX = Math.max(...valid.map((rect) => rect.x + rect.w))
  const maxY = Math.max(...valid.map((rect) => rect.y + rect.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function buildRuntimePaddingPolicy(contract, fullGrid, strictAtlasSize) {
  const padding = contract.atlas.runtime_extrude_padding
  const [cellW, cellH] = contract.atlas.tile_cell_size
  const runtimeCellW = cellW + padding * 2
  const runtimeCellH = cellH + padding * 2
  return {
    mode: padding > 0 ? 'extruded_runtime_atlas' : 'no_runtime_padding',
    strict_atlas: {
      image: 'strict_atlas.png',
      size: { ...strictAtlasSize },
      cell_size: { width: cellW, height: cellH },
      padding_px: 0,
      margin_px: 0,
      spacing_px: 0,
    },
    runtime_padded_atlas: {
      image: 'runtime_padded_atlas.png',
      size: {
        width: fullGrid.columns * runtimeCellW,
        height: fullGrid.rows * runtimeCellH,
      },
      cell_size: { width: runtimeCellW, height: runtimeCellH },
      inner_cell_size: { width: cellW, height: cellH },
      padding_px: padding,
      margin_px: 0,
      spacing_px: 0,
      extrude_mode: padding > 0 ? 'copy_edge_pixels' : 'none',
    },
    coordinate_mapping: {
      preserves_atlas_tile_id: true,
      strict_rect_field: 'source_rect',
      runtime_rect_field: 'runtime_source_rect',
      runtime_inner_rect_field: 'runtime_inner_rect',
    },
  }
}

export function buildTransitionMaskMetadata(mask, { solidMask = 15 } = {}) {
  const corners = cornersForMask(mask)
  const activeCorners = Object.entries(corners).filter(([, value]) => value).map(([key]) => key)
  return {
    mask,
    tile_class: tileClassForMask(mask, solidMask),
    active_corner_count: activeCorners.length,
    active_corners: activeCorners,
    corners,
    edges: edgesForCorners(corners),
  }
}

export function buildTwoPointFiveDAtlasPlan(input = {}, {
  materialProfile = null,
  sourceNormalization = null,
  materialSourceReport = null,
  materialSourceGuidance = null,
} = {}) {
  const validation = validateTwoPointFiveDTilesetContract(input)
  if (validation.status === 'fail') {
    throw new Error(`Cannot build invalid 2.5D tileset contract: ${validation.blocking_errors.join(', ')}`)
  }
  const contract = normalizeTwoPointFiveDTilesetContract(input)
  const [cellW, cellH] = contract.atlas.tile_cell_size
  const [logicalW, logicalH] = contract.projection.logical_tile_size
  const layers = buildLayerGeometry(contract)
  const fullGrid = validation.metrics.full_atlas_grid
  const occupiedGrid = contract.rule_profile.occupied_grid
  const masks = [...contract.rule_profile.masks]
  const solidMask = contract.rule_profile.solid_mask
  const pivot = anchorForPivot(contract.projection.pivot, cellW, cellH)
  const effectiveMaterialProfile = materialProfile ?? buildProceduralMaterialProfile(contract.materials)
  const usesManualMaterialSource = effectiveMaterialProfile.generator?.startsWith('manual_material_') ?? false
  const effectiveValidation = {
    ...validation,
    metrics: {
      ...validation.metrics,
      material_mode: usesManualMaterialSource ? 'manual_source' : validation.metrics.material_mode,
      material_profile_id: effectiveMaterialProfile.id,
    },
  }
  const runtimePaddingPolicy = buildRuntimePaddingPolicy(contract, fullGrid, validation.metrics.strict_atlas_size)
  const runtimeCell = runtimePaddingPolicy.runtime_padded_atlas.cell_size
  const runtimePadding = runtimePaddingPolicy.runtime_padded_atlas.padding_px
  const primaryTerrain = contract.terrain_types[0]
  const transitionTerrain = contract.terrain_types[1] ?? primaryTerrain

  const tiles = masks.map((mask, index) => {
    const row = Math.floor(index / occupiedGrid.columns)
    const col = index % occupiedGrid.columns
    const cell = { x: col * cellW, y: row * cellH, w: cellW, h: cellH }
    const runtimeSourceRect = { x: col * runtimeCell.width, y: row * runtimeCell.height, w: runtimeCell.width, h: runtimeCell.height }
    const transition = buildTransitionMaskMetadata(mask, { solidMask })
    const tileRole = tileRoleForTransition(transition)
    const visualBounds = transition.tile_class === 'empty'
      ? null
      : rectUnion([layers.shadow, layers.left_side_face, layers.right_side_face, layers.front_face, layers.top_face, layers.edge_trim])
    return {
      id: `mask_${mask}`,
      rule_profile_id: contract.rule_profile.id,
      rule_index: index,
      mask,
      row,
      col,
      atlas_tile_id: row * fullGrid.columns + col,
      tile_role: tileRole,
      role_tags: roleTagsForTransition(transition, tileRole),
      terrain_type: transition.tile_class === 'empty' ? 'empty' : primaryTerrain,
      transition_to_terrain_type: transition.tile_class === 'transition' ? transitionTerrain : null,
      cell,
      source_rect: { ...cell },
      runtime_source_rect: runtimeSourceRect,
      runtime_inner_rect: { x: runtimeSourceRect.x + runtimePadding, y: runtimeSourceRect.y + runtimePadding, w: cellW, h: cellH },
      pivot: { ...pivot, mode: contract.projection.pivot },
      logical_footprint: {
        x: layers.top_face.x,
        y: cellH - logicalH,
        w: logicalW,
        h: logicalH,
      },
      collision: {
        mode: contract.collision.mode,
        shape: contract.collision.shape,
        x: layers.top_face.x,
        y: cellH - logicalH,
        w: contract.collision.size[0],
        h: contract.collision.size[1],
      },
      visual_bounds: visualBounds,
      z_order_hint: {
        mode: 'bottom_center_pivot',
        draw_layer: transition.tile_class === 'empty' ? 'empty' : 'terrain',
        sort_x: pivot.x,
        sort_y: pivot.y,
      },
      transition,
      layers,
      material_slots: { ...contract.materials.slots },
    }
  })

  return {
    schema_version: 1,
    mode: 'two_point_five_d_atlas_plan_v0',
    contract_id: contract.id,
    contract_version: contract.contract_version,
    projection: { ...contract.projection },
    atlas: {
      mode: contract.atlas.mode,
      grid: { ...fullGrid },
      occupied_grid: { ...occupiedGrid },
      tile_cell_size: [...contract.atlas.tile_cell_size],
      strict_atlas_size: validation.metrics.strict_atlas_size,
      runtime_extrude_padding: contract.atlas.runtime_extrude_padding,
      runtime_padding_policy: runtimePaddingPolicy,
      available_cell_count: validation.metrics.available_cell_count,
    },
    rule_profile: {
      id: contract.rule_profile.id,
      type: contract.rule_profile.type,
      occupied_grid: { ...contract.rule_profile.occupied_grid },
      masks,
      empty_mask: contract.rule_profile.empty_mask,
      solid_mask: contract.rule_profile.solid_mask,
      transition_masks: [...contract.rule_profile.transition_masks],
      connectable_edges: [...contract.rule_profile.connectable_edges],
      tile_classes: [...contract.rule_profile.tile_classes],
    },
    terrain_types: [...contract.terrain_types],
    material_profile: effectiveMaterialProfile,
    source_normalization: sourceNormalization,
    material_source: materialSourceReport,
    material_source_guidance: materialSourceGuidance,
    tiles,
    validation: effectiveValidation,
    pipeline_stages: {
      source_normalizer: usesManualMaterialSource ? 'source_normalizer_v0' : 'planned',
      material_builder: usesManualMaterialSource ? effectiveMaterialProfile.generator : 'procedural_material_v0',
      rule_aware_composer: usesManualMaterialSource ? 'patch_texture_geometry_v1' : 'procedural_geometry_v0',
      validator: 'pixel_validation_v0',
      exporter: 'metadata_export_hardening_v0',
      preview_generator: 'preview_artifacts_v0',
      map_rule_builder: 'constraint_map_solver_v1',
      map_exporter: 'ldtk_project_export_v1',
    },
  }
}
