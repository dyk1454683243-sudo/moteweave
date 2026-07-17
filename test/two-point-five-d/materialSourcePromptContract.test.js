import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTwoPointFiveDMaterialSourcePromptContract,
  compileTwoPointFiveDMaterialSourcePromptContract,
  summarizeTwoPointFiveDMaterialSourcePromptContract,
  TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_CONTRACT_VERSION,
} from '../../src/two-point-five-d/materialSourcePromptContract.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../src/two-point-five-d/tilesetContract.js'

test('2.5D material source prompt contract keeps provider output as raw source only', () => {
  const contract = buildTwoPointFiveDMaterialSourcePromptContract({
    description: 'mossy cliff grass blocks with damp stone sides',
    promptFields: {
      topMaterial: 'lush moss and short grass',
      sideMaterial: 'cool grey stone and dark soil',
      style: 'readable chunky pixel clusters',
    },
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
  })
  const summary = summarizeTwoPointFiveDMaterialSourcePromptContract(contract)
  const prompt = compileTwoPointFiveDMaterialSourcePromptContract(contract)

  assert.equal(summary.contract_version, TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_CONTRACT_VERSION)
  assert.equal(summary.source_role, 'raw_material_source_not_clean_atlas')
  assert.deepEqual(summary.projection.logical_tile_size, [32, 32])
  assert.deepEqual(summary.projection.sprite_cell_size, [64, 64])
  assert.equal(summary.material_slots.top_material, 'grass_top')
  assert.ok(summary.validation_expectations.includes('no_final_atlas_grid'))
  assert.match(prompt, /This is not the final tileset asset/)
  assert.match(prompt, /Do not create a strict atlas/)
  assert.match(prompt, /exact pixel dimensions are not required/i)
  assert.match(prompt, /local deterministic code will crop\/sample materials/i)
  assert.doesNotMatch(prompt, /mask coordinate list/i)
})
