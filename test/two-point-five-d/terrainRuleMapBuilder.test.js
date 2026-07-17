import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'
import {
  areTwoPointFiveDMaskEdgesCompatible,
  buildTwoPointFiveDGuardedRuleMap,
  buildTwoPointFiveDMapFromMasks,
  buildTwoPointFiveDMapRuleProfile,
  solveTwoPointFiveDConstraintMap,
  validateTwoPointFiveDRuleMap,
} from '../../src/two-point-five-d/terrainRuleMapBuilder.js'

test('map rule profile records compatible corner-mask neighbors', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const profile = buildTwoPointFiveDMapRuleProfile(plan)

  assert.equal(profile.mode, 'two_point_five_d_map_rule_profile_v1')
  assert.equal(profile.rule_profile_id, 'corner_mask_16')
  assert.equal(profile.wfc_scope, 'guarded_constraint_profile_not_full_wfc_solver')
  assert.equal(profile.masks.length, 16)
  const solid = profile.masks.find((item) => item.mask === 15)
  assert.deepEqual(solid.edges, { north: '11', east: '11', south: '11', west: '11' })
  assert.ok(solid.compatible_neighbors.east.includes(15))
  assert.equal(areTwoPointFiveDMaskEdgesCompatible(15, 0, 'east'), false)
})

test('guarded rule map generates a validated seeded corner-grid map', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const map = buildTwoPointFiveDGuardedRuleMap({ plan, width: 5, height: 4, seed: 7, density: 0.6 })
  const validation = validateTwoPointFiveDRuleMap(map, { plan })

  assert.equal(map.mode, 'two_point_five_d_guarded_rule_map_v1')
  assert.equal(map.arrangement.mode, 'guarded_seeded_corner_grid_v1')
  assert.equal(map.arrangement.wfc_scope, 'constraint_validated_seeded_map_not_full_wfc_solver')
  assert.deepEqual(map.tile_size.logical, { width: 32, height: 32 })
  assert.deepEqual(map.tile_size.sprite, { width: 64, height: 64 })
  assert.equal(map.cells.length, 20)
  assert.equal(validation.status, 'pass')
  assert.equal(validation.metrics.checked_adjacencies, 31)
  assert.equal(validation.metrics.edge_mismatch_count, 0)
  assert.ok(validation.metrics.distinct_mask_count > 1)
})

test('constraint solver honors border and fixed mask constraints', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const solved = solveTwoPointFiveDConstraintMap({
    plan,
    width: 5,
    height: 5,
    seed: 23,
    density: 0.65,
    constraints: {
      border: 'empty',
      fixed_masks: [{ x: 2, y: 2, mask: 15 }],
    },
  })
  const validation = validateTwoPointFiveDRuleMap(solved.map, { plan })

  assert.equal(solved.status, 'pass')
  assert.equal(solved.report.mode, 'two_point_five_d_constraint_map_solver_v1')
  assert.equal(solved.report.algorithm, 'ac3_backtracking_constraint_solver')
  assert.equal(solved.report.constraints.border, 'empty')
  assert.equal(solved.report.constraints.fixed_masks.length, 1)
  assert.equal(solved.map.arrangement.mode, 'constraint_solved_corner_mask_v1')
  assert.equal(solved.map.cells.find((cell) => cell.x === 2 && cell.y === 2).mask, 15)
  assert.equal(solved.map.cells.filter((cell) => cell.x === 0 || cell.y === 0 || cell.x === 4 || cell.y === 4).every((cell) => cell.mask === 0), true)
  assert.equal(validation.status, 'pass')
  assert.equal(validation.metrics.edge_mismatch_count, 0)
})

test('constraint solver reports impossible fixed mask constraints', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const solved = solveTwoPointFiveDConstraintMap({
    plan,
    width: 3,
    height: 3,
    constraints: {
      border: 'empty',
      fixed_masks: [{ x: 0, y: 0, mask: 15 }],
    },
  })

  assert.equal(solved.status, 'fail')
  assert.equal(solved.map, null)
  assert.equal(solved.report.status, 'fail')
  assert.ok(solved.report.contradictions.some((item) => item.reason === 'fixed_mask_not_in_domain'))
})

test('rule map validation catches incompatible explicit masks', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const map = buildTwoPointFiveDMapFromMasks({
    plan,
    width: 2,
    height: 1,
    masks: [15, 0],
  })
  const validation = validateTwoPointFiveDRuleMap(map, { plan })

  assert.equal(validation.status, 'fail')
  assert.ok(validation.blocking_errors.includes('map_edge_constraint_mismatch'))
  assert.equal(validation.edge_mismatches.length, 1)
  assert.deepEqual(validation.edge_mismatches[0].at, { x: 0, y: 0, index: 0, mask: 15 })
})
