import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { buildManualMaterialProfileFromSource } from '../../src/two-point-five-d/manualMaterialBuilder.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../src/two-point-five-d/tilesetContract.js'

async function buildSixRegionSource() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="342" height="512" fill="#2f8f3f"/>',
    '<rect x="32" y="32" width="48" height="48" fill="#9edb75"/>',
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

async function buildFourByFourTileSource() {
  const cell = 256
  const fills = [
    ['#2f8f3f', '#7a5435', '#b6d46d', '#1d2119'],
    ['#67b04f', '#8f7f45', '#405b8c', '#c9b15a'],
    ['#5f6f3c', '#60432c', '#273445', '#d7d2b0'],
    ['#395f2e', '#966c3f', '#788944', '#202426'],
  ]
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect width="1024" height="1024" fill="#111111"/>',
  ]
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * cell
      const y = row * cell
      const fill = fills[row][col]
      parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`)
      for (let offset = 0; offset < cell; offset += 32) {
        parts.push(`<rect x="${x + offset}" y="${y + ((row + col) % 2) * 8}" width="16" height="${cell}" fill="rgba(255,255,255,0.12)"/>`)
        parts.push(`<rect x="${x}" y="${y + offset}" width="${cell}" height="8" fill="rgba(0,0,0,0.18)"/>`)
      }
    }
  }
  parts.push('</svg>')
  return sharp(Buffer.from(parts.join(''))).png().toBuffer()
}

test('buildManualMaterialProfileFromSource extracts deterministic material slots from normalized source art', async () => {
  const source = await buildSixRegionSource()
  const result = await buildManualMaterialProfileFromSource({
    normalizedSourcePng: source,
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    sourceNormalization: { source_id: 'six_region_fixture' },
  })

  assert.equal(result.report.mode, 'two_point_five_d_manual_material_extraction_v1')
  assert.equal(result.report.status, 'pass')
  assert.equal(result.report.layout_selection.mode, 'semantic_material_layout_assist_v1')
  assert.equal(result.report.layout_selection.selected.id, 'six_region_material_grid_v0')
  assert.equal(result.report.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.equal(result.report.semantic_slot_selection.slots.length, 7)
  assert.ok(result.report.semantic_slot_selection.candidate_count >= 6)
  assert.equal(result.report.semantic_slot_selection.slots.find((slot) => slot.slot === 'top_material').selected.candidate_id, 'layout_top_material')
  assert.equal(result.report.slot_separation.mode, 'material_slot_separation_v1')
  assert.equal(result.report.slot_separation.status, 'pass')
  assert.equal(result.report.slot_separation.initial_warning_count, 0)
  assert.equal(result.report.slot_separation.remaining_warning_count, 0)
  assert.equal(result.report.layout_selection.candidates.length, 3)
  assert.ok(result.report.layout_selection.rejected.some((candidate) => candidate.id === 'tile_sheet_4x4_center_patches_v0'))
  assert.equal(result.materialProfile.generator, 'manual_material_extraction_v1')
  assert.equal(result.materialProfile.layout_selection.selected_id, 'six_region_material_grid_v0')
  assert.equal(result.materialProfile.source_id, 'six_region_fixture')
  assert.equal(result.materialProfile.slots.top_material.material_id, 'grass_top')
  assert.match(result.materialProfile.slots.top_material.patch_id, /^patch_top_material_/)
  assert.equal(result.materialProfile.materials.grass_top.base, '#2f8f3f')
  assert.equal(result.materialProfile.materials.grass_top.patch.mode, 'material_patch_v1')
  assert.deepEqual(result.materialProfile.materials.grass_top.patch.size, { width: 16, height: 16 })
  assert.match(result.materialProfile.materials.grass_top.patch.image_data_url, /^data:image\/png;base64,/)
  assert.equal(result.materialProfile.materials.dirt_side.base, '#7a5435')
  assert.equal(result.materialProfile.materials.soft_contact_shadow.base, '#1d2119')
  assert.equal(result.report.extraction.mode, 'material_patch_extraction_v1')
  assert.equal(result.report.extraction.palette_limit.status, 'active')
  assert.equal(result.report.extraction.palette_limit.patch_color_budget, 4)
  assert.equal(result.report.extraction.patch_count, 7)
  assert.equal(result.report.extraction.warning_patch_count, 0)
  assert.equal(result.report.sampling.samples.length, 7)
  assert.equal(result.report.palette.color_count, 6)
  assert.equal(result.report.quality_gates.warning_sample_count, 0)
  assert.equal(result.report.quality_gates.warning_patch_count, 0)
  assert.ok(result.report.sampling.samples.every((sample) => sample.diagnostics.metrics.luma_range >= 8))
  assert.ok(result.report.sampling.samples.every((sample) => sample.patch_diagnostics.metrics.unique_color_count >= 2))
})

test('buildManualMaterialProfileFromSource selects a 4x4 tile-sheet layout candidate when it scores better', async () => {
  const source = await buildFourByFourTileSource()
  const result = await buildManualMaterialProfileFromSource({
    normalizedSourcePng: source,
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    sourceNormalization: { source_id: 'four_by_four_fixture' },
  })

  assert.equal(result.report.layout_selection.mode, 'semantic_material_layout_assist_v1')
  assert.equal(result.report.layout_selection.selected.id, 'tile_sheet_4x4_center_patches_v0')
  assert.equal(result.report.semantic_slot_selection.mode, 'semantic_slot_extraction_v1')
  assert.ok(result.report.semantic_slot_selection.candidate_count > 7)
  assert.equal(result.report.sampling.layout, 'tile_sheet_4x4_center_patches_v0')
  assert.equal(result.materialProfile.layout_selection.selected_id, 'tile_sheet_4x4_center_patches_v0')
  assert.equal(result.report.sampling.samples.find((sample) => sample.slot === 'top_material').sample_region.x, 64)
  assert.equal(result.report.sampling.samples.find((sample) => sample.slot === 'top_material').sample_region.w, 128)
  assert.ok(result.report.layout_selection.rejected.some((candidate) => candidate.id === 'six_region_material_grid_v0'))
  assert.ok(result.report.layout_selection.candidates.every((candidate) => Number.isFinite(candidate.score)))
  assert.ok(result.report.layout_selection.candidates.find((candidate) => candidate.id === 'six_region_material_grid_v0').score > result.report.layout_selection.selected.score)
  assert.ok(result.report.layout_selection.selected.score_reasons.some((reason) => reason.includes('patch warnings')))
})

test('buildManualMaterialProfileFromSource warns for low-detail sample regions', async () => {
  const source = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: '#777777ff',
    },
  })
    .png()
    .toBuffer()
  const result = await buildManualMaterialProfileFromSource({
    normalizedSourcePng: source,
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    sourceNormalization: { source_id: 'flat_fixture' },
  })

  assert.equal(result.report.status, 'warning')
  assert.equal(result.report.quality_gates.warning_sample_count, 7)
  assert.equal(result.report.quality_gates.warning_patch_count, 7)
  assert.equal(result.report.quality_gates.slot_distinction_warning_count, 0)
  assert.equal(result.report.slot_separation.status, 'active')
  assert.equal(result.report.slot_separation.initial_warning_count, 15)
  assert.equal(result.report.slot_separation.remaining_warning_count, 0)
  assert.equal(result.report.slot_separation.changed_slot_count, 7)
  assert.ok(result.report.warnings.includes('sample_region_low_contrast_top_material'))
  assert.ok(result.report.warnings.includes('material_patch_low_color_variety_top_material'))
  assert.equal(result.report.warnings.some((warning) => warning.startsWith('material_slot_low_distinction_')), false)
  assert.equal(result.materialProfile.materials.grass_top.source_colors.base, '#777777')
  assert.notEqual(result.materialProfile.materials.grass_top.base, '#777777')
  assert.equal(result.materialProfile.slot_separation.remaining_warning_count, 0)
})

test('buildManualMaterialProfileFromSource accepts configurable sample layouts', async () => {
  const source = await buildSixRegionSource()
  const result = await buildManualMaterialProfileFromSource({
    normalizedSourcePng: source,
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    sourceNormalization: { source_id: 'custom_layout_fixture' },
    sampleLayout: {
      top_material: { role: 'top', x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 2 },
    },
  })

  assert.equal(result.report.layout_selection.mode, 'explicit_material_layout_v1')
  assert.equal(result.report.layout_selection.selected.id, 'explicit_material_layout')
  assert.equal(result.report.semantic_slot_selection.mode, 'explicit_slot_regions_v1')
  assert.equal(result.report.slot_separation.status, 'disabled')
  assert.equal(result.report.slot_separation.reason, 'explicit_layout_preserves_user_slot_colors')
  assert.equal(result.materialProfile.materials.grass_top.base, '#7a5435')
  assert.deepEqual(result.report.sampling.samples.find((sample) => sample.slot === 'top_material').sample_region, {
    x: 341,
    y: 0,
    w: 341,
    h: 512,
  })
  assert.deepEqual(result.materialProfile.materials.grass_top.patch.source_rect, {
    x: 341,
    y: 0,
    w: 341,
    h: 512,
  })
})
