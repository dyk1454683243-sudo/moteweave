import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_GENERATION_PRESET } from '../../src/character-pack/generationDefaults.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  resolveSourceLayout,
  sliceCellsForSourceLayout,
} from '../../src/character-pack/sourceLayouts.js'

function makeTransparentOcadImage() {
  return {
    width: 252,
    height: 252,
    data: new Uint8ClampedArray(252 * 252 * 4),
  }
}

test('fixed-region motion layout is the canonical generation default while legacy id remains readable', () => {
  const canonical = resolveSourceLayout(FIXED_REGION_MOTION_LAYOUT_ID)
  const legacy = resolveSourceLayout(LEGACY_OCAD_MOTION_LAYOUT_ID)

  assert.equal(DEFAULT_GENERATION_PRESET, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(canonical.id, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(legacy.id, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(canonical.kind, 'fixed_regions')
  assert.equal(legacy, canonical)
})

test('sliceCellsForSourceLayout attaches fixed-region template anchors and motion semantics', () => {
  const layout = resolveSourceLayout(FIXED_REGION_MOTION_LAYOUT_ID)
  const result = sliceCellsForSourceLayout(makeTransparentOcadImage(), TOPDOWN_RPG_V0, layout)
  const idleDown = result.cells[0]
  const attackLeft = result.cells[40]

  assert.deepEqual(idleDown.meta.template_anchor, {
    x: 10,
    y: 41,
    mode: 'template-foot-center',
    source: 'fixed_region_motion_v0_template',
  })
  assert.deepEqual(idleDown.meta.template_motion, {
    action: 'idledown',
    family: 'idle',
    direction: 'down',
    stabilizable: true,
  })
  assert.deepEqual(attackLeft.meta.template_motion, {
    action: 'attractL',
    family: 'interact',
    direction: 'left',
    stabilizable: false,
  })
})
