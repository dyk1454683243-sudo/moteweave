import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTransitionMaskMetadata,
  buildTwoPointFiveDAtlasPlan,
} from '../../src/two-point-five-d/terrainAutotileBuilder.js'

test('buildTransitionMaskMetadata exposes corner mask signatures', () => {
  const metadata = buildTransitionMaskMetadata(0b1010)

  assert.equal(metadata.tile_class, 'transition')
  assert.equal(metadata.active_corner_count, 2)
  assert.deepEqual(metadata.active_corners, ['ne', 'sw'])
  assert.deepEqual(metadata.edges.east, [true, false])
  assert.deepEqual(metadata.edges.west, [false, true])
})

test('buildTwoPointFiveDAtlasPlan creates deterministic 16-mask 2.5D cells', () => {
  const plan = buildTwoPointFiveDAtlasPlan()

  assert.equal(plan.mode, 'two_point_five_d_atlas_plan_v0')
  assert.equal(plan.tiles.length, 16)
  assert.deepEqual(plan.atlas.strict_atlas_size, { width: 1024, height: 1024 })
  assert.deepEqual(plan.atlas.grid, { columns: 16, rows: 16 })
  assert.deepEqual(plan.atlas.occupied_grid, { columns: 4, rows: 4 })
  assert.equal(plan.atlas.available_cell_count, 256)
  assert.equal(plan.rule_profile.id, 'corner_mask_16')
  assert.equal(plan.material_profile.id, 'local_grass_block_materials_v0')
  assert.equal(plan.material_profile.slots.top_material.pattern_id, 'mat_grass_top')
  assert.equal(plan.pipeline_stages.source_normalizer, 'planned')
  assert.equal(plan.pipeline_stages.material_builder, 'procedural_material_v0')
  assert.equal(plan.pipeline_stages.rule_aware_composer, 'procedural_geometry_v0')
  assert.equal(plan.pipeline_stages.validator, 'pixel_validation_v0')
  assert.equal(plan.pipeline_stages.exporter, 'metadata_export_hardening_v0')
  assert.equal(plan.pipeline_stages.preview_generator, 'preview_artifacts_v0')
  assert.equal(plan.pipeline_stages.map_rule_builder, 'constraint_map_solver_v1')
  assert.equal(plan.pipeline_stages.map_exporter, 'ldtk_project_export_v1')
  assert.equal(plan.atlas.runtime_padding_policy.mode, 'extruded_runtime_atlas')
  assert.deepEqual(plan.atlas.runtime_padding_policy.strict_atlas.cell_size, { width: 64, height: 64 })
  assert.deepEqual(plan.atlas.runtime_padding_policy.runtime_padded_atlas.cell_size, { width: 66, height: 66 })
  assert.equal(plan.atlas.runtime_padding_policy.runtime_padded_atlas.extrude_mode, 'copy_edge_pixels')

  assert.deepEqual(plan.tiles[0].cell, { x: 0, y: 0, w: 64, h: 64 })
  assert.equal(plan.tiles[0].tile_role, 'empty')
  assert.equal(plan.tiles[1].tile_role, 'outer_corner')
  assert.ok(plan.tiles[1].role_tags.includes('isolated_block'))
  assert.deepEqual(plan.tiles[15].cell, { x: 192, y: 192, w: 64, h: 64 })
  assert.equal(plan.tiles[15].atlas_tile_id, 51)
  assert.equal(plan.tiles[15].tile_role, 'solid')
  assert.equal(plan.tiles[15].terrain_type, 'grass')
  assert.deepEqual(plan.tiles[15].role_tags, ['solid'])
  assert.deepEqual(plan.tiles[15].source_rect, { x: 192, y: 192, w: 64, h: 64 })
  assert.deepEqual(plan.tiles[15].runtime_source_rect, { x: 198, y: 198, w: 66, h: 66 })
  assert.deepEqual(plan.tiles[15].runtime_inner_rect, { x: 199, y: 199, w: 64, h: 64 })
  assert.deepEqual(plan.tiles[15].pivot, { x: 32, y: 64, mode: 'bottom_center' })
  assert.deepEqual(plan.tiles[15].logical_footprint, { x: 16, y: 32, w: 32, h: 32 })
  assert.deepEqual(plan.tiles[15].collision, {
    mode: 'logical_footprint',
    shape: 'rect',
    x: 16,
    y: 32,
    w: 32,
    h: 32,
  })
  assert.deepEqual(plan.tiles[15].visual_bounds, { x: 8, y: 8, w: 48, h: 56 })
  assert.deepEqual(plan.tiles[15].z_order_hint, {
    mode: 'bottom_center_pivot',
    draw_layer: 'terrain',
    sort_x: 32,
    sort_y: 64,
  })
  assert.deepEqual(plan.tiles[15].layers.top_face, { x: 16, y: 8, w: 32, h: 32 })
  assert.deepEqual(plan.tiles[15].layers.front_face, { x: 16, y: 40, w: 32, h: 24 })
})
