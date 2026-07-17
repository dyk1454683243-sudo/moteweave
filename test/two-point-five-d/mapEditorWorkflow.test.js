import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'
import { solveTwoPointFiveDConstraintMap } from '../../src/two-point-five-d/terrainRuleMapBuilder.js'
import {
  applyTwoPointFiveDMapEditorWorkflow,
  buildTwoPointFiveDMapEditorBrushPalette,
} from '../../src/two-point-five-d/mapEditorWorkflow.js'

test('map editor workflow exposes terrain brushes and mask palette', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const palette = buildTwoPointFiveDMapEditorBrushPalette(plan)

  assert.equal(palette.terrain_brushes.length, 3)
  assert.equal(palette.mask_palette.length, 16)
  assert.equal(palette.mask_palette.find((item) => item.mask === 15).atlas_tile_id, 51)
})

test('map editor workflow applies rule-safe terrain rectangle edits', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const solved = solveTwoPointFiveDConstraintMap({ plan, width: 6, height: 5, seed: 5, density: 0.35 })
  const workflow = applyTwoPointFiveDMapEditorWorkflow({
    plan,
    map: solved.map,
    sessionId: 'editor_workflow_test',
    operations: [
      { type: 'paint_terrain_rect', x: 2, y: 2, w: 2, h: 1 },
      { type: 'erase_terrain_rect', x: 3, y: 2, w: 1, h: 1 },
      { type: 'set_corner', x: 2, y: 2, solid: true },
    ],
  })

  assert.equal(workflow.mode, 'two_point_five_d_map_editor_workflow_v1')
  assert.equal(workflow.status, 'pass')
  assert.equal(workflow.operations.length, 3)
  assert.ok(workflow.changed_cell_count > 0)
  assert.equal(workflow.validation.metrics.edge_mismatch_count, 0)
  assert.equal(workflow.map.arrangement.mode, 'map_editor_corner_workflow_v1')
  assert.equal(workflow.map.arrangement.operation_count, 3)
})

test('map editor workflow rejects out-of-bounds operations', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const solved = solveTwoPointFiveDConstraintMap({ plan, width: 4, height: 4 })

  assert.throws(
    () => applyTwoPointFiveDMapEditorWorkflow({
      plan,
      map: solved.map,
      operations: [{ type: 'paint_terrain_rect', x: 3, y: 3, w: 2, h: 1 }],
    }),
    /outside the map/
  )
})
