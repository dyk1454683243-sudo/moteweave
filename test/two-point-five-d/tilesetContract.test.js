import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
  normalizeTwoPointFiveDTilesetContract,
  validateTwoPointFiveDTilesetContract,
} from '../../src/two-point-five-d/tilesetContract.js'

test('default 2.5D tileset contract separates logical tile and sprite cell size', () => {
  const validation = validateTwoPointFiveDTilesetContract()

  assert.equal(validation.status, 'pass')
  assert.deepEqual(validation.blocking_errors, [])
  assert.deepEqual(validation.metrics.logical_tile_size, { width: 32, height: 32 })
  assert.deepEqual(validation.metrics.sprite_cell_size, { width: 64, height: 64 })
  assert.deepEqual(validation.metrics.strict_atlas_size, { width: 1024, height: 1024 })
  assert.deepEqual(validation.metrics.derived_strict_atlas_size, { width: 1024, height: 1024 })
  assert.deepEqual(validation.metrics.full_atlas_grid, { columns: 16, rows: 16 })
  assert.deepEqual(validation.metrics.occupied_rule_grid, { columns: 4, rows: 4 })
  assert.equal(validation.metrics.fixed_height_px, 24)
  assert.equal(validation.metrics.available_cell_count, 256)
  assert.equal(validation.metrics.tile_count, 16)
  assert.equal(validation.metrics.rule_profile_id, 'corner_mask_16')
  assert.equal(validation.metrics.material_mode, 'procedural')
  assert.equal(validation.metrics.material_profile_id, 'local_grass_block_materials_v0')
  assert.ok(validation.metrics.procedural_material_color_count <= DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.palette.max_colors)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.consumer_package_audit_json, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.import_validation_json, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.release_demo_pack_zip, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.external_tool_probe_json, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.external_import_smoke_json, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.external_roundtrip_validation_json, true)
  assert.equal(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.exports.external_roundtrip_checklist_md, true)
})

test('contract validation rejects visual-collision coupling and undersized sprite cells', () => {
  const contract = normalizeTwoPointFiveDTilesetContract({
    projection: {
      sprite_cell_size: [24, 24],
    },
    atlas: {
      tile_cell_size: [24, 24],
    },
    collision: {
      visual_outline_drives_collision: true,
    },
  })
  const validation = validateTwoPointFiveDTilesetContract(contract)

  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('sprite_cell_smaller_than_logical_tile'))
  assert.ok(validation.blocking_errors.includes('fixed_height_exceeds_sprite_cell'))
  assert.ok(validation.blocking_errors.includes('collision_must_not_follow_visual_outline'))
})

test('contract validation keeps strict atlas size and occupied rule profile separate', () => {
  const misalignedAtlas = validateTwoPointFiveDTilesetContract({
    atlas: {
      strict_size: [1025, 1024],
    },
  })
  assert.equal(misalignedAtlas.status, 'fail')
  assert.ok(misalignedAtlas.blocking_errors.includes('strict_atlas_size_must_align_to_tile_cell'))

  const oversizedProfile = validateTwoPointFiveDTilesetContract({
    atlas: {
      strict_size: [128, 128],
    },
    rule_profile: {
      occupied_grid: { columns: 4, rows: 4 },
    },
  })
  assert.equal(oversizedProfile.status, 'fail')
  assert.ok(oversizedProfile.blocking_errors.includes('rule_profile_exceeds_strict_atlas_grid'))
})

test('contract validation rejects unsupported rule profiles without relying on legacy mode names', () => {
  const validation = validateTwoPointFiveDTilesetContract({
    rule_profile: {
      id: 'dual_grid_corners',
    },
  })

  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('rule_profile_unsupported'))
})

test('contract validation requires procedural materials for required render slots', () => {
  const validation = validateTwoPointFiveDTilesetContract({
    materials: {
      slots: {
        top_material: 'missing_top',
      },
    },
  })

  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('procedural_material_missing_top_material'))
})

test('contract validation rejects malformed procedural material colors', () => {
  const validation = validateTwoPointFiveDTilesetContract({
    materials: {
      procedural_profile: {
        materials: {
          grass_top: {
            base: 'green',
          },
        },
      },
    },
  })

  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('procedural_material_grass_top_base_invalid'))
})

test('contract merge preserves defaults while allowing material overrides', () => {
  const contract = normalizeTwoPointFiveDTilesetContract({
    materials: {
      slots: {
        top_material: 'snow_top',
      },
      procedural_profile: {
        materials: {
          snow_top: {
            role: 'top',
            base: '#dbe8f2',
            highlight: '#ffffff',
            shadow: '#a8c0d8',
            detail: '#eef7ff',
          },
        },
      },
    },
  })

  assert.equal(contract.materials.slots.top_material, 'snow_top')
  assert.equal(contract.materials.slots.side_material, DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.materials.slots.side_material)
  assert.equal(validateTwoPointFiveDTilesetContract(contract).status, 'pass')
})
