import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMaterialSourceAuthoringGuidance,
  renderMaterialSourceAuthoringGuidanceMarkdown,
} from '../../src/two-point-five-d/materialSourceGuidance.js'

function sample(slot, warnings = []) {
  return {
    slot,
    material_id: slot === 'top_material' ? 'grass_top' : 'dirt_side',
    role: slot === 'top_material' ? 'top' : 'side',
    sample_region: { x: 0, y: 0, w: 256, h: 256 },
    diagnostics: {
      status: warnings.length ? 'warning' : 'pass',
      warnings,
      metrics: {
        visible_coverage_ratio: 1,
        mean_alpha: 255,
        luma_min: 80,
        luma_max: warnings.length ? 82 : 128,
        luma_range: warnings.length ? 2 : 48,
        luma_median: 81,
      },
    },
    colors: {
      base: '#507a35',
      highlight: '#78a64d',
      shadow: '#28411f',
      detail: '#5f8b42',
    },
  }
}

test('buildMaterialSourceAuthoringGuidance turns diagnostics into authoring guidance', () => {
  const guidance = buildMaterialSourceAuthoringGuidance({
    sourceNormalization: {
      status: 'warning',
      warnings: ['source_size_normalized_to_target_canvas'],
      output: {
        width: 1024,
        height: 1024,
        artifact: 'normalized_material_source.png',
      },
    },
    materialSourceReport: {
      source_id: 'manual_source_fixture.png',
      material_profile_id: 'manual_material_profile_fixture',
      sampling: {
        layout: 'six_region_material_grid_v0',
        source_size: { width: 1024, height: 1024 },
        samples: [
          sample('top_material', ['sample_region_low_contrast_top_material']),
          sample('side_material'),
        ],
      },
      slot_separation: {
        mode: 'material_slot_separation_v1',
        status: 'active',
        threshold: 18,
        initial_warning_count: 1,
        remaining_warning_count: 0,
        changed_slot_count: 2,
        changed_slots: [],
      },
    },
  })

  assert.equal(guidance.mode, 'two_point_five_d_material_source_authoring_guidance_v0')
  assert.equal(guidance.status, 'warning')
  assert.equal(guidance.source_canvas.expected_width, 1024)
  assert.equal(guidance.slot_separation.status, 'active')
  assert.equal(guidance.slot_separation.remaining_warning_count, 0)
  assert.equal(guidance.sampling_layout.slots[0].target_content.includes('walkable surface'), true)
  assert.deepEqual(guidance.sampling_layout.slots[0].normalized_region, { x: 0, y: 0, w: 0.25, h: 0.25 })
  assert.ok(guidance.issues.some((issue) => issue.code === 'source_size_normalized_to_target_canvas'))
  assert.ok(guidance.issues.some((issue) => issue.code === 'sample_region_low_contrast_top_material'))

  const markdown = renderMaterialSourceAuthoringGuidanceMarkdown(guidance)
  assert.match(markdown, /# 2\.5D Material Source Guidance/)
  assert.match(markdown, /sample_region_low_contrast_top_material/)
  assert.match(markdown, /## Slot Separation/)
  assert.match(markdown, /Expected canvas: 1024 x 1024/)
})
