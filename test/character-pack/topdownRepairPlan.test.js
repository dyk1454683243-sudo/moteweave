import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTopdownRepairPlan, summarizeTopdownRepairPlans } from '../../src/character-pack/benchmark/topdownRepairPlan.js'

test('buildTopdownRepairPlan maps empty and cropped validation errors to frame semantics', () => {
  const plan = buildTopdownRepairPlan({
    itemId: 'frog_knight_v1',
    caseId: 'frog_knight',
    validation: {
      status: 'fail',
      blocking_errors: ['frame_6_empty', 'frame_14_empty', 'frame_24_cropped', 'halo_score_high'],
      warnings: [],
    },
  })

  assert.equal(plan.item_id, 'frog_knight_v1')
  assert.equal(plan.case_id, 'frog_knight')
  assert.equal(plan.issue_count, 3)
  assert.deepEqual(
    plan.issues.map((issue) => ({
      message: issue.message,
      issue: issue.issue,
      frame: issue.frame,
      row: issue.row,
      col: issue.col,
      animation: issue.animation,
      frame_in_animation: issue.frame_in_animation,
      repair_scope: issue.repair_scope,
      strategy: issue.strategy,
    })),
    [
      {
        message: 'frame_6_empty',
        issue: 'empty_frame',
        frame: 6,
        row: 0,
        col: 6,
        animation: 'idle_up',
        frame_in_animation: 2,
        repair_scope: 'single_cell',
        strategy: 'regenerate_missing_pose_in_cell',
      },
      {
        message: 'frame_14_empty',
        issue: 'empty_frame',
        frame: 14,
        row: 1,
        col: 6,
        animation: 'idle_right',
        frame_in_animation: 2,
        repair_scope: 'single_cell',
        strategy: 'regenerate_missing_pose_in_cell',
      },
      {
        message: 'frame_24_cropped',
        issue: 'cropped_frame',
        frame: 24,
        row: 3,
        col: 0,
        animation: 'walk_left',
        frame_in_animation: 0,
        repair_scope: 'single_cell',
        strategy: 'regenerate_pose_with_more_padding',
      },
    ]
  )
  assert.deepEqual(plan.groups_by_action, {
    idle_up: { empty_frame: 1, cropped_frame: 0, frames: [6] },
    idle_right: { empty_frame: 1, cropped_frame: 0, frames: [14] },
    walk_left: { empty_frame: 0, cropped_frame: 1, frames: [24] },
  })
})

test('summarizeTopdownRepairPlans aggregates frames and actions across items', () => {
  const summary = summarizeTopdownRepairPlans([
    buildTopdownRepairPlan({
      itemId: 'frog_knight_v1',
      validation: { blocking_errors: ['frame_6_empty', 'frame_24_cropped'] },
    }),
    buildTopdownRepairPlan({
      itemId: 'blue_wizard_v1',
      validation: { blocking_errors: ['frame_6_empty', 'frame_24_cropped', 'frame_61_cropped'] },
    }),
  ])

  assert.equal(summary.item_count, 2)
  assert.equal(summary.items_with_repairs, 2)
  assert.equal(summary.issue_count, 5)
  assert.deepEqual(summary.by_issue, { empty_frame: 2, cropped_frame: 3 })
  assert.deepEqual(summary.top_frames.slice(0, 2), [
    { frame: 6, count: 2 },
    { frame: 24, count: 2 },
  ])
  assert.equal(summary.by_action.walk_left.cropped_frame, 2)
  assert.equal(summary.by_action.talk.cropped_frame, 1)
})
