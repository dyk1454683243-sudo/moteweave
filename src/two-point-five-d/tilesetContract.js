export const TWO_POINT_FIVE_D_CONTRACT_VERSION = 'two_point_five_d_tileset_contract_v1'

export const REQUIRED_TILE_SCHEMA_PARTS = Object.freeze([
  'top_face',
  'front_face',
  'side_face',
  'outer_corner',
  'inner_corner',
  'edge_trim',
  'transition_overlay',
])

export const REQUIRED_MATERIAL_SLOTS = Object.freeze([
  'top_material',
  'side_material',
  'edge_material',
  'corner_material',
  'transition_detail',
  'shadow_material',
])

export const DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT = Object.freeze({
  schema_version: 1,
  contract_version: TWO_POINT_FIVE_D_CONTRACT_VERSION,
  id: 'two_point_five_d_block_autotile_v1',
  canvas: Object.freeze({
    width: 1024,
    height: 1024,
  }),
  atlas: Object.freeze({
    mode: 'strict_atlas',
    strict_size: Object.freeze([1024, 1024]),
    tile_cell_size: Object.freeze([64, 64]),
    allow_padding_in_strict_atlas: false,
    runtime_extrude_padding: 1,
  }),
  rule_profile: Object.freeze({
    id: 'corner_mask_16',
    type: 'corner_mask',
    occupied_grid: Object.freeze({ columns: 4, rows: 4 }),
    masks: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    empty_mask: 0,
    solid_mask: 15,
    transition_masks: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    connectable_edges: Object.freeze(['north', 'east', 'south', 'west']),
    tile_classes: Object.freeze(['empty', 'solid', 'transition', 'decoration']),
  }),
  projection: Object.freeze({
    type: 'orthographic_2_5d',
    logical_tile_size: Object.freeze([32, 32]),
    sprite_cell_size: Object.freeze([64, 64]),
    pivot: 'bottom_center',
    fixed_height_px: 24,
    height_levels: Object.freeze([1]),
  }),
  schema: Object.freeze({
    name: 'two_point_five_d_block_autotile',
    version: 1,
    supports: Object.freeze([
      'top_face',
      'front_face',
      'side_face',
      'outer_corner',
      'inner_corner',
      'edge_trim',
      'transition_overlay',
      'decals',
    ]),
  }),
  terrain_types: Object.freeze(['grass', 'dirt', 'stone', 'snow', 'sand', 'water']),
  materials: Object.freeze({
    mode: 'procedural',
    slots: Object.freeze({
      top_material: 'grass_top',
      side_material: 'dirt_side',
      edge_material: 'grass_edge',
      corner_material: 'grass_corner',
      transition_detail: 'grass_to_dirt_edge',
      shadow_material: 'soft_contact_shadow',
      decal_material: 'optional_decal',
    }),
    procedural_profile: Object.freeze({
      id: 'local_grass_block_materials_v0',
      generator: 'procedural_material_v0',
      seed: 170617,
      pattern_size: Object.freeze([16, 16]),
      materials: Object.freeze({
        grass_top: Object.freeze({
          role: 'top',
          base: '#5f9f4c',
          highlight: '#8fca63',
          shadow: '#3f7438',
          detail: '#c7d66c',
        }),
        dirt_side: Object.freeze({
          role: 'side',
          base: '#6e4b32',
          highlight: '#8d6844',
          shadow: '#4a3024',
          detail: '#b08455',
        }),
        grass_edge: Object.freeze({
          role: 'edge',
          base: '#b6d46d',
          highlight: '#d7e88b',
          shadow: '#719b45',
          detail: '#f0f0a0',
        }),
        grass_corner: Object.freeze({
          role: 'corner',
          base: '#79b957',
          highlight: '#a6d96a',
          shadow: '#4b7f3b',
          detail: '#d7e88b',
        }),
        grass_to_dirt_edge: Object.freeze({
          role: 'transition',
          base: '#8f7f45',
          highlight: '#c7d66c',
          shadow: '#5f4a32',
          detail: '#6e4b32',
        }),
        soft_contact_shadow: Object.freeze({
          role: 'shadow',
          base: '#242820',
          highlight: '#303528',
          shadow: '#161a15',
          detail: '#1d2119',
        }),
        optional_decal: Object.freeze({
          role: 'decal',
          base: '#d7e88b',
          highlight: '#f0f0a0',
          shadow: '#8fca63',
          detail: '#ffffff',
        }),
      }),
    }),
  }),
  palette: Object.freeze({
    mode: 'limited',
    max_colors: 32,
    allow_semi_transparent_pixels: false,
  }),
  collision: Object.freeze({
    mode: 'logical_footprint',
    shape: 'rect',
    size: Object.freeze([32, 32]),
    visual_outline_drives_collision: false,
  }),
  exports: Object.freeze({
    strict_atlas_png: true,
    runtime_padded_atlas_png: true,
    metadata_json: true,
    tiled_json: true,
    tiled_tsx: true,
    map_rule_profile_json: true,
    tile_map_json: true,
    map_editor_workflow_json: true,
    ldtk_project_json: true,
    ldtk_auto_layer_rules_json: true,
    ldtk_workflow_validation_json: true,
    workflow_release_evidence_json: true,
    consumer_package_audit_json: true,
    import_validation_json: true,
    release_demo_manifest_json: true,
    release_demo_readme_md: true,
    release_demo_pack_zip: true,
    external_tool_probe_json: true,
    external_import_smoke_json: true,
    external_roundtrip_validation_json: true,
    external_roundtrip_checklist_md: true,
    validation_report: true,
    preview_map: true,
  }),
})

const ALLOWED_ATLAS_MODES = new Set(['strict_atlas', 'runtime_padded_atlas'])
const ALLOWED_PROJECTIONS = new Set(['orthographic_2_5d', 'topdown_2_5d', 'pseudo_isometric', 'future_sideview_2d'])
const ALLOWED_PIVOTS = new Set(['bottom_center', 'top_left', 'center'])
const ALLOWED_RULE_PROFILE_IDS = new Set(['corner_mask_16'])
const ALLOWED_RULE_PROFILE_TYPES = new Set(['corner_mask'])
const ALLOWED_MATERIAL_MODES = new Set(['procedural'])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item))
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  return value
}

function mergeContract(base, override) {
  if (!isPlainObject(override)) return clone(base)
  const merged = clone(base)
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) merged[key] = mergeContract(merged[key], value)
    else merged[key] = clone(value)
  }
  return merged
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isPositivePair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(positiveInteger)
}

function isPositiveGrid(value) {
  return isPlainObject(value) && positiveInteger(value.columns) && positiveInteger(value.rows)
}

function hasUniqueIntegerList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(Number.isInteger) && new Set(value).size === value.length
}

function hasStringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim())
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function collectMaterialColors(proceduralMaterials = {}) {
  const colors = new Set()
  for (const material of Object.values(proceduralMaterials)) {
    if (!isPlainObject(material)) continue
    for (const key of ['base', 'highlight', 'shadow', 'detail']) {
      if (material[key]) colors.add(String(material[key]).toLowerCase())
    }
  }
  return colors
}

export function normalizeTwoPointFiveDTilesetContract(contract = {}) {
  return mergeContract(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT, contract)
}

export function validateTwoPointFiveDTilesetContract(input = {}) {
  const contract = normalizeTwoPointFiveDTilesetContract(input)
  const blocking_errors = []
  const warnings = []

  if (contract.schema_version !== 1) blocking_errors.push('schema_version_unsupported')
  if (contract.contract_version !== TWO_POINT_FIVE_D_CONTRACT_VERSION) blocking_errors.push('contract_version_unsupported')

  if (!positiveInteger(contract.canvas?.width) || !positiveInteger(contract.canvas?.height)) {
    blocking_errors.push('canvas_size_invalid')
  }

  if (!ALLOWED_ATLAS_MODES.has(contract.atlas?.mode)) blocking_errors.push('atlas_mode_unsupported')
  if (!isPositivePair(contract.atlas?.strict_size)) blocking_errors.push('strict_atlas_size_invalid')
  if (!isPositivePair(contract.atlas?.tile_cell_size)) blocking_errors.push('atlas_tile_cell_size_invalid')
  if (!nonNegativeInteger(contract.atlas?.runtime_extrude_padding)) blocking_errors.push('runtime_extrude_padding_invalid')
  if (contract.atlas?.mode === 'strict_atlas' && contract.atlas?.allow_padding_in_strict_atlas) {
    blocking_errors.push('strict_atlas_must_not_include_padding')
  }

  if (!ALLOWED_PROJECTIONS.has(contract.projection?.type)) blocking_errors.push('projection_type_unsupported')
  if (!isPositivePair(contract.projection?.logical_tile_size)) blocking_errors.push('logical_tile_size_invalid')
  if (!isPositivePair(contract.projection?.sprite_cell_size)) blocking_errors.push('sprite_cell_size_invalid')
  if (!ALLOWED_PIVOTS.has(contract.projection?.pivot)) blocking_errors.push('tile_pivot_unsupported')
  if (!positiveInteger(contract.projection?.fixed_height_px)) blocking_errors.push('fixed_height_invalid')
  if (!Array.isArray(contract.projection?.height_levels) || !contract.projection.height_levels.every(positiveInteger)) {
    blocking_errors.push('height_levels_invalid')
  }

  const [tileCellW = 0, tileCellH = 0] = contract.atlas?.tile_cell_size ?? []
  const [strictW = 0, strictH = 0] = contract.atlas?.strict_size ?? []
  const [logicalW = 0, logicalH = 0] = contract.projection?.logical_tile_size ?? []
  const [spriteW = 0, spriteH = 0] = contract.projection?.sprite_cell_size ?? []
  if (spriteW < logicalW || spriteH < logicalH) blocking_errors.push('sprite_cell_smaller_than_logical_tile')
  if (tileCellW !== spriteW || tileCellH !== spriteH) blocking_errors.push('atlas_cell_must_match_sprite_cell')
  if (contract.projection?.fixed_height_px + logicalH > spriteH) blocking_errors.push('fixed_height_exceeds_sprite_cell')

  const fullAtlasGrid = {
    columns: tileCellW > 0 && strictW % tileCellW === 0 ? strictW / tileCellW : 0,
    rows: tileCellH > 0 && strictH % tileCellH === 0 ? strictH / tileCellH : 0,
  }
  if (isPositivePair(contract.atlas?.strict_size) && isPositivePair(contract.atlas?.tile_cell_size)) {
    if (strictW % tileCellW !== 0 || strictH % tileCellH !== 0) blocking_errors.push('strict_atlas_size_must_align_to_tile_cell')
  }

  const ruleProfile = contract.rule_profile ?? {}
  if (!ALLOWED_RULE_PROFILE_IDS.has(ruleProfile.id)) blocking_errors.push('rule_profile_unsupported')
  if (!ALLOWED_RULE_PROFILE_TYPES.has(ruleProfile.type)) blocking_errors.push('rule_profile_type_unsupported')
  if (!isPositiveGrid(ruleProfile.occupied_grid)) blocking_errors.push('rule_profile_occupied_grid_invalid')
  else if (
    fullAtlasGrid.columns > 0 &&
    fullAtlasGrid.rows > 0 &&
    (ruleProfile.occupied_grid.columns > fullAtlasGrid.columns || ruleProfile.occupied_grid.rows > fullAtlasGrid.rows)
  ) {
    blocking_errors.push('rule_profile_exceeds_strict_atlas_grid')
  }
  if (!hasUniqueIntegerList(ruleProfile.masks)) blocking_errors.push('rule_profile_masks_invalid')
  if (ruleProfile.id === 'corner_mask_16') {
    const expectedMasks = Array.from({ length: 16 }, (_, index) => index)
    if (!Array.isArray(ruleProfile.masks) || ruleProfile.masks.length !== expectedMasks.length) {
      blocking_errors.push('corner_mask_16_requires_sixteen_masks')
    } else if (expectedMasks.some((mask) => !ruleProfile.masks.includes(mask))) {
      blocking_errors.push('corner_mask_16_masks_must_cover_zero_to_fifteen')
    }
    if (isPositiveGrid(ruleProfile.occupied_grid) && ruleProfile.occupied_grid.columns * ruleProfile.occupied_grid.rows < 16) {
      blocking_errors.push('corner_mask_16_occupied_grid_too_small')
    }
  }

  if (!hasStringList(contract.schema?.supports)) blocking_errors.push('tile_schema_supports_missing')
  else {
    for (const part of REQUIRED_TILE_SCHEMA_PARTS) {
      if (!contract.schema.supports.includes(part)) blocking_errors.push(`tile_schema_missing_${part}`)
    }
  }

  if (!hasStringList(contract.terrain_types)) blocking_errors.push('terrain_types_missing')
  if (!ALLOWED_MATERIAL_MODES.has(contract.materials?.mode)) blocking_errors.push('material_mode_unsupported')
  if (!isPlainObject(contract.materials?.slots)) blocking_errors.push('material_slots_missing')
  else {
    for (const slot of REQUIRED_MATERIAL_SLOTS) {
      if (typeof contract.materials.slots[slot] !== 'string' || !contract.materials.slots[slot].trim()) {
        blocking_errors.push(`material_slot_missing_${slot}`)
      }
    }
  }
  const proceduralProfile = contract.materials?.procedural_profile ?? {}
  const proceduralMaterials = proceduralProfile.materials ?? {}
  if (contract.materials?.mode === 'procedural') {
    if (typeof proceduralProfile.id !== 'string' || !proceduralProfile.id.trim()) blocking_errors.push('procedural_material_profile_id_missing')
    if (proceduralProfile.generator !== 'procedural_material_v0') blocking_errors.push('procedural_material_generator_unsupported')
    if (!nonNegativeInteger(proceduralProfile.seed)) blocking_errors.push('procedural_material_seed_invalid')
    if (!isPositivePair(proceduralProfile.pattern_size)) blocking_errors.push('procedural_material_pattern_size_invalid')
    if (!isPlainObject(proceduralMaterials)) blocking_errors.push('procedural_materials_missing')
    if (isPlainObject(contract.materials?.slots) && isPlainObject(proceduralMaterials)) {
      for (const slot of REQUIRED_MATERIAL_SLOTS) {
        const materialId = contract.materials.slots[slot]
        const material = proceduralMaterials[materialId]
        if (!isPlainObject(material)) {
          blocking_errors.push(`procedural_material_missing_${slot}`)
          continue
        }
        if (!material.base) blocking_errors.push(`procedural_material_${materialId}_base_invalid`)
        for (const colorKey of ['base', 'highlight', 'shadow', 'detail']) {
          if (material[colorKey] && !isHexColor(material[colorKey])) {
            blocking_errors.push(`procedural_material_${materialId}_${colorKey}_invalid`)
          }
        }
      }
    }
  }

  if (contract.palette?.mode !== 'limited') warnings.push('palette_mode_not_limited')
  if (!positiveInteger(contract.palette?.max_colors)) blocking_errors.push('palette_max_colors_invalid')
  if (contract.palette?.allow_semi_transparent_pixels) warnings.push('semi_transparent_pixels_enabled')
  const proceduralColorCount = collectMaterialColors(proceduralMaterials).size
  if (positiveInteger(contract.palette?.max_colors) && proceduralColorCount > contract.palette.max_colors) {
    warnings.push('procedural_material_palette_exceeds_max_colors')
  }

  if (ruleProfile.empty_mask !== 0) blocking_errors.push('empty_mask_must_be_zero')
  if (ruleProfile.solid_mask !== 15) blocking_errors.push('solid_mask_must_be_fifteen')
  if (!Array.isArray(ruleProfile.transition_masks) || ruleProfile.transition_masks.length !== 14) {
    blocking_errors.push('transition_masks_invalid')
  }

  if (contract.collision?.mode !== 'logical_footprint') blocking_errors.push('collision_mode_must_use_logical_footprint')
  if (!isPositivePair(contract.collision?.size)) blocking_errors.push('collision_size_invalid')
  if (contract.collision?.visual_outline_drives_collision) blocking_errors.push('collision_must_not_follow_visual_outline')
  if (isPositivePair(contract.collision?.size) && (contract.collision.size[0] !== logicalW || contract.collision.size[1] !== logicalH)) {
    warnings.push('collision_size_differs_from_logical_tile')
  }

  if (!contract.exports?.metadata_json) blocking_errors.push('metadata_export_required')
  if (!contract.exports?.validation_report) blocking_errors.push('validation_report_required')
  if (!contract.exports?.map_rule_profile_json) blocking_errors.push('map_rule_profile_export_required')
  if (!contract.exports?.tile_map_json) blocking_errors.push('tile_map_export_required')
  if (!contract.exports?.map_editor_workflow_json) blocking_errors.push('map_editor_workflow_export_required')
  if (!contract.exports?.ldtk_project_json) blocking_errors.push('ldtk_project_export_required')
  if (!contract.exports?.ldtk_auto_layer_rules_json) blocking_errors.push('ldtk_auto_layer_rules_export_required')
  if (!contract.exports?.ldtk_workflow_validation_json) blocking_errors.push('ldtk_workflow_validation_export_required')
  if (!contract.exports?.workflow_release_evidence_json) blocking_errors.push('workflow_release_evidence_export_required')
  if (!contract.exports?.consumer_package_audit_json) blocking_errors.push('consumer_package_audit_export_required')
  if (!contract.exports?.import_validation_json) blocking_errors.push('import_validation_export_required')
  if (!contract.exports?.release_demo_manifest_json) blocking_errors.push('release_demo_manifest_export_required')
  if (!contract.exports?.release_demo_readme_md) blocking_errors.push('release_demo_readme_export_required')
  if (!contract.exports?.release_demo_pack_zip) blocking_errors.push('release_demo_pack_export_required')
  if (!contract.exports?.external_tool_probe_json) blocking_errors.push('external_tool_probe_export_required')
  if (!contract.exports?.external_import_smoke_json) blocking_errors.push('external_import_smoke_export_required')
  if (!contract.exports?.external_roundtrip_validation_json) blocking_errors.push('external_roundtrip_validation_export_required')
  if (!contract.exports?.external_roundtrip_checklist_md) blocking_errors.push('external_roundtrip_checklist_export_required')

  return {
    status: blocking_errors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors,
    warnings,
    metrics: {
      strict_atlas_size: { width: strictW, height: strictH },
      derived_strict_atlas_size: { width: strictW, height: strictH },
      full_atlas_grid: fullAtlasGrid,
      occupied_rule_grid: isPositiveGrid(ruleProfile.occupied_grid)
        ? { columns: ruleProfile.occupied_grid.columns, rows: ruleProfile.occupied_grid.rows }
        : { columns: 0, rows: 0 },
      logical_tile_size: { width: logicalW, height: logicalH },
      sprite_cell_size: { width: spriteW, height: spriteH },
      fixed_height_px: contract.projection.fixed_height_px,
      available_cell_count: fullAtlasGrid.columns * fullAtlasGrid.rows,
      tile_count: Array.isArray(ruleProfile.masks) ? ruleProfile.masks.length : 0,
      rule_profile_id: ruleProfile.id,
      material_mode: contract.materials.mode,
      material_profile_id: proceduralProfile.id,
      procedural_material_color_count: proceduralColorCount,
    },
    contract,
  }
}
