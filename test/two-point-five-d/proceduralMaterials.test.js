import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildProceduralMaterialProfile,
  collectProceduralMaterialColors,
  materialFill,
  renderProceduralMaterialDefs,
} from '../../src/two-point-five-d/proceduralMaterials.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../src/two-point-five-d/tilesetContract.js'

test('buildProceduralMaterialProfile maps material slots to deterministic pattern ids', () => {
  const profile = buildProceduralMaterialProfile(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT.materials)

  assert.equal(profile.id, 'local_grass_block_materials_v0')
  assert.equal(profile.generator, 'procedural_material_v0')
  assert.equal(profile.slots.top_material.material_id, 'grass_top')
  assert.equal(profile.slots.top_material.pattern_id, 'mat_grass_top')
  assert.equal(profile.slots.corner_material.material_id, 'grass_corner')
  assert.equal(materialFill(profile, 'side_material'), 'url(#mat_dirt_side)')
  assert.ok(renderProceduralMaterialDefs(profile).includes('<pattern id="mat_grass_top"'))
  assert.ok(collectProceduralMaterialColors(profile).includes('#5f9f4c'))
})
