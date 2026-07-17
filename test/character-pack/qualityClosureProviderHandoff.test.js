import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQualityClosureProviderHandoff,
  rankQualityClosureProviderRepairTasks,
  renderQualityClosureProviderHandoffMarkdown,
} from '../../src/character-pack/benchmark/qualityClosureProviderHandoff.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function task(taskId, itemId, animation, { action = 'semantic_frame_repair', issue = 'prop_side_flip_suspected' } = {}) {
  const animationDef = TOPDOWN_RPG_V0.animations.find((entry) => entry.name === animation)
  const frames = Array.from({ length: animationDef.count }, (_, offset) => {
    const frame = animationDef.row * TOPDOWN_RPG_V0.grid.columns + animationDef.startCol + offset
    return {
      frame,
      row: animationDef.row,
      col: animationDef.startCol + offset,
      animation,
      rect: {
        x: (animationDef.startCol + offset) * TOPDOWN_RPG_V0.frame.w,
        y: animationDef.row * TOPDOWN_RPG_V0.frame.h,
        w: TOPDOWN_RPG_V0.frame.w,
        h: TOPDOWN_RPG_V0.frame.h,
      },
    }
  })
  return {
    task_id: taskId,
    item_id: itemId,
    provider_required: true,
    action,
    issue: { type: issue },
    target: { animation, frames },
    artifacts: { normalized_sheet: `generated/${itemId}/normalized_sheet.png` },
    provider_payload: {
      prompt: `Repair ${animation}`,
      output: { cell_count: frames.length, cell_width: TOPDOWN_RPG_V0.frame.w, cell_height: TOPDOWN_RPG_V0.frame.h },
    },
  }
}

function manifest() {
  return {
    schema_version: 1,
    mode: 'character_quality_closure_repair_manifest_v1',
    run_id: 'quality_handoff_unit',
    preset: TOPDOWN_RPG_V0.id,
    tasks: [
      task('busy_item_repair_semantic_side_walk_left', 'busy_item', 'walk_left'),
      task('busy_item_repair_semantic_side_walk_right', 'busy_item', 'walk_right'),
      task('busy_item_repair_semantic_side_attack_left', 'busy_item', 'attack_left'),
      task('near_pass_repair_semantic_side_walk_right', 'near_pass_item', 'walk_right'),
      task('near_pass_repair_semantic_side_walk_left', 'near_pass_item', 'walk_left'),
    ],
  }
}

test('rankQualityClosureProviderRepairTasks favors near-pass walk semantic repairs', () => {
  const ranked = rankQualityClosureProviderRepairTasks(manifest())

  assert.equal(ranked[0].task.task_id, 'near_pass_repair_semantic_side_walk_left')
  assert.equal(ranked[0].rank.item_provider_task_count, 2)
  assert.equal(ranked[0].rank.rationale.some((item) => item.includes('near-pass item')), true)
  assert.equal(ranked[1].task.task_id, 'near_pass_repair_semantic_side_walk_right')
})

test('buildQualityClosureProviderHandoff writes one strict horizontal strip prompt', () => {
  const handoff = buildQualityClosureProviderHandoff(manifest(), {
    manifestPath: 'generated/quality_handoff_unit/quality_closure_repair_manifest.json',
    outputDir: 'generated/quality_handoff_unit/provider_handoff',
  })
  const markdown = renderQualityClosureProviderHandoffMarkdown(handoff)

  assert.equal(handoff.status, 'needs_provider_or_manual_strip')
  assert.equal(handoff.selected.task_id, 'near_pass_repair_semantic_side_walk_left')
  assert.equal(handoff.selected.expected_output.width, 384)
  assert.equal(handoff.selected.expected_output.height, 96)
  assert.match(handoff.selected.prompt, /one horizontal transparent PNG strip, 384x96px/)
  assert.match(handoff.selected.prompt, /Do not output a full sheet/)
  assert.match(handoff.selected.next_apply_command, /quality-closure-apply-provider-repair/)
  assert.match(markdown, /Candidate Ranking/)
})

test('buildQualityClosureProviderHandoff can target an explicit provider task', () => {
  const handoff = buildQualityClosureProviderHandoff(manifest(), {
    taskId: 'busy_item_repair_semantic_side_attack_left',
  })

  assert.equal(handoff.selected.task_id, 'busy_item_repair_semantic_side_attack_left')
  assert.equal(handoff.selected.animation, 'attack_left')
})
