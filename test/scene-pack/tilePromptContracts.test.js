import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCENE_TILE_PROMPT_CONTRACT_VERSION,
  buildSceneTilePromptContract,
  compileSceneTilePromptContract,
  summarizeSceneTilePromptContract,
} from '../../src/scene-pack/tilePromptContracts.js'

test('scene tile prompt contract locks the padded dual-grid source sheet layout', () => {
  const contract = buildSceneTilePromptContract({ description: 'mossy grass path and stone corners' })
  const prompt = compileSceneTilePromptContract(contract)

  assert.equal(contract.contract_version, SCENE_TILE_PROMPT_CONTRACT_VERSION)
  assert.equal(contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.equal(contract.profile, 'topdown_tile_dual_grid_v0')
  assert.deepEqual(contract.atlas_contract.grid, { columns: 4, rows: 4 })
  assert.deepEqual(contract.atlas_contract.tile, { w: 32, h: 32 })
  assert.deepEqual(contract.atlas_contract.source.cell, { w: 48, h: 48, padding: 8 })
  assert.ok(contract.validation_contract.expectations.includes('exact_16_tile_dual_grid_atlas'))
  assert.ok(contract.validation_contract.expectations.includes('source_padding_preserved'))
  assert.ok(contract.validation_contract.expectations.includes('visual_seam_ready_edges'))
  assert.ok(contract.validation_contract.expectations.includes('self_loop_ready_tiles'))
  assert.ok(contract.validation_contract.expectations.includes('loopable_runtime_border_bands'))
  assert.ok(contract.validation_contract.expectations.includes('shared_edge_signature_continuity'))
  assert.ok(contract.validation_contract.expectations.includes('raw_tile_structure_independent_cells'))
  assert.ok(contract.validation_contract.expectations.includes('source_atlas_not_single_scene'))
  assert.ok(contract.validation_contract.expectations.includes('source_cells_independent_after_shuffle'))
  assert.ok(contract.validation_contract.expectations.includes('no_cross_cell_terrain_continuity'))
  assert.ok(contract.validation_contract.expectations.includes('self_loop_edges_visible_in_each_tile'))
  assert.ok(contract.validation_contract.expectations.includes('no_atlas_scale_composition'))
  assert.ok(contract.validation_contract.expectations.includes('edge_signature_motifs_repeated_not_continued'))
  assert.ok(contract.validation_contract.expectations.includes('self_loop_edges_have_no_unique_marks'))
  assert.ok(contract.validation_contract.expectations.includes('true_png_192_source_sheet'))
  assert.ok(contract.validation_contract.expectations.includes('no_preview_scale_or_jpeg_encoded_png'))
  assert.ok(contract.validation_contract.expectations.includes('no_visible_mask_coordinates_or_labels'))

  assert.match(prompt, /192x192/i)
  assert.match(prompt, /4 columns by 4 rows/i)
  assert.match(prompt, /exactly 16 source cells/i)
  assert.match(prompt, /48x48 source cell/i)
  assert.match(prompt, /8 px padding/i)
  assert.match(prompt, /central 32x32 tile/i)
  assert.match(prompt, /row-major dual-grid mask order 0-15/i)
  assert.doesNotMatch(prompt, /Mask placement/i)
  assert.doesNotMatch(prompt, /mask 0:\s*row/i)
  assert.doesNotMatch(prompt, /mask 15:\s*row/i)
  assert.match(prompt, /compatible edges must visually match/i)
  assert.match(prompt, /self-loop/i)
  assert.match(prompt, /outer 3 px border band/i)
  assert.match(prompt, /first and last pixel columns/i)
  assert.match(prompt, /first and last pixel rows/i)
  assert.match(prompt, /same edge signature/i)
  assert.match(prompt, /not separate mini-scenes/i)
  assert.match(prompt, /tile inventory sheet/i)
  assert.match(prompt, /not a continuous scene sliced into cells/i)
  assert.match(prompt, /Each runtime tile must read as a complete standalone tile/i)
  assert.match(prompt, /Do not paint paths, rivers, cliffs, shadows, or texture strokes across source-cell boundaries/i)
  assert.match(prompt, /would still read correctly if the 16 cells were shuffled/i)
  assert.match(prompt, /no terrain stroke may continue from one source cell into the neighboring source cell/i)
  assert.match(prompt, /prove self-loop readiness inside each tile/i)
  assert.match(prompt, /Do not use the 4x4 atlas position to create gradients, lighting, camera depth, or composition across rows or columns/i)
  assert.match(prompt, /repeat the same edge motif on every tile with the same compatible edge signature/i)
  assert.match(prompt, /no unique edge marks, corners, or color jumps on opposite borders/i)
  assert.match(prompt, /no diagonal path or rock vein may terminate at a tile edge/i)
  assert.match(prompt, /true PNG image at exactly 192x192 pixels/i)
  assert.match(prompt, /Do not export or upscale the sheet to 1024x1024/i)
  assert.match(prompt, /Do not save JPEG image data with a \.png filename/i)
  assert.match(prompt, /row labels, column labels, or coordinates/i)
  assert.match(prompt, /mossy grass path and stone corners/i)
  assert.match(prompt, /Only output the tile source sheet image/i)
  assert.doesNotMatch(prompt, /character sprite sheet/i)
})

test('scene tile prompt summary is compact for dry-run metadata', () => {
  const contract = buildSceneTilePromptContract({ description: 'snowy cliff tiles' })

  assert.deepEqual(summarizeSceneTilePromptContract(contract), {
    schema_version: 1,
    contract_version: 'scene_tile_prompt_contract_v0_6',
    profile: 'topdown_tile_dual_grid_v0',
    layout_kind: 'padded_dual_grid_tile_atlas',
    tile_count: 16,
    validation_expectations: contract.validation_contract.expectations,
  })
})
