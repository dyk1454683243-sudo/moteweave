import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHARACTER_QUALITY_CLOSURE_REPAIR_MANIFEST_MODE,
  buildCharacterQualityClosureRepairManifestForDebugReport,
  renderCharacterQualityClosureRepairManifestMarkdown,
} from '../../src/character-pack/benchmark/qualityClosureRepairManifest.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { CHARACTER_QUALITY_CLOSURE_MODE } from '../../src/character-pack/qualityClosureGate.js'

function frame(index, sourceAction = null) {
  return {
    index,
    runtime_action: sourceAction,
    source_frame: {
      layout: 'topdown_rpg_v0',
      row: Math.floor(index / TOPDOWN_RPG_V0.grid.columns),
      col: index % TOPDOWN_RPG_V0.grid.columns,
      rect: { x: 0, y: 0, w: 192, h: 192 },
    },
    normalized_bbox: { x: 34, y: 30, w: 28, h: 58, right: 61, bottom: 87 },
    normalized_anchor: TOPDOWN_RPG_V0.anchor,
    warnings: [],
  }
}

function debugReportWithClosure() {
  return {
    profile: 'topdown_rpg_v0',
    validation: {
      status: 'warning',
      warnings: ['walk_left_low_motion'],
      blocking_errors: [],
    },
    frames: [
      frame(0, 'idle_down'),
      frame(24, 'walk_left'),
      frame(25, 'walk_left'),
      frame(26, 'walk_left'),
      frame(27, 'walk_left'),
    ],
    quality_closure: {
      mode: CHARACTER_QUALITY_CLOSURE_MODE,
      status: 'warning',
      release_ready: false,
      repair_tasks: [
        {
          id: 'local_halo_cleanup',
          provider_required: false,
          action: 'local_halo_cleanup',
          frames: [0],
          rationale: 'white edge pixels remain after background cleanup',
        },
        {
          id: 'repair_semantic_side_walk_left',
          provider_required: true,
          action: 'semantic_frame_repair',
          animation: 'walk_left',
          frames: [24, 25, 26, 27],
          rationale: 'held prop or accessory appears to switch sides inside the animation group',
        },
      ],
    },
  }
}

test('quality closure repair manifest separates local and provider repair tasks', () => {
  const manifest = buildCharacterQualityClosureRepairManifestForDebugReport(debugReportWithClosure(), {
    runId: 'elder_quality_repair',
    itemId: 'village_elder_v1',
    artifactDir: 'generated/live/items/village_elder_v1',
    item: {
      case: {
        id: 'village_elder',
        description: 'an elderly village leader with a wooden cane',
      },
      variant: 1,
    },
  })

  assert.equal(manifest.mode, CHARACTER_QUALITY_CLOSURE_REPAIR_MANIFEST_MODE)
  assert.equal(manifest.status, 'needs_repair')
  assert.equal(manifest.release_ready, false)
  assert.equal(manifest.summary.task_count, 2)
  assert.equal(manifest.summary.local_task_count, 1)
  assert.equal(manifest.summary.provider_task_count, 1)
  assert.equal(manifest.summary.estimated_provider_calls, 1)

  const localTask = manifest.tasks.find((task) => task.action === 'local_halo_cleanup')
  assert.equal(localTask.stage, 'local')
  assert.equal(localTask.provider_required, false)
  assert.equal(localTask.local_payload.input_images.normalized_sheet, 'generated/live/items/village_elder_v1/normalized_sheet.png')
  assert.deepEqual(localTask.target.frames.map((item) => item.frame), [0])

  const providerTask = manifest.tasks.find((task) => task.action === 'semantic_frame_repair')
  assert.equal(providerTask.stage, 'provider')
  assert.equal(providerTask.provider_required, true)
  assert.equal(providerTask.target.animation, 'walk_left')
  assert.deepEqual(providerTask.target.frames.map((item) => item.frame), [24, 25, 26, 27])
  assert.deepEqual(providerTask.target.frames[0].rect, { x: 0, y: 288, w: 96, h: 96 })
  assert.match(providerTask.provider_payload.prompt, /Target animation: walk_left/)
  assert.match(providerTask.provider_payload.prompt, /held props, accessories, silhouette side/)
  assert.equal(providerTask.provider_payload.output.cell_count, 4)
})

test('quality closure repair manifest marks reports without closure as blocked', () => {
  const manifest = buildCharacterQualityClosureRepairManifestForDebugReport({
    profile: 'topdown_rpg_v0',
    validation: { status: 'warning', warnings: [], blocking_errors: [] },
    frames: [],
  }, {
    itemId: 'old_report_v1',
    debugReportPath: 'generated/live/items/old_report_v1/debug_report.json',
  })

  assert.equal(manifest.status, 'blocked')
  assert.equal(manifest.summary.task_count, 0)
  assert.equal(manifest.summary.blocker_count, 1)
  assert.match(manifest.blockers[0].reason, /missing quality_closure/)
})

test('quality closure repair manifest blocks stale animation-only local anchor tasks', () => {
  const manifest = buildCharacterQualityClosureRepairManifestForDebugReport({
    profile: 'topdown_rpg_v0',
    validation: { status: 'pass', warnings: [], blocking_errors: [] },
    frames: [
      frame(16, 'walk_down'),
      frame(17, 'walk_down'),
      frame(18, 'walk_down'),
      frame(19, 'walk_down'),
    ],
    quality_closure: {
      mode: CHARACTER_QUALITY_CLOSURE_MODE,
      status: 'warning',
      release_ready: false,
      repair_tasks: [
        {
          id: 'local_anchor_stabilization',
          provider_required: false,
          action: 'local_anchor_stabilization',
          frames: [],
          animations: ['walk_down'],
          rationale: 'older closure treated half-pixel bbox jitter as a local anchor task',
        },
      ],
    },
  }, {
    itemId: 'stale_anchor_report_v1',
    debugReportPath: 'generated/live/items/stale_anchor_report_v1/debug_report.json',
  })

  assert.equal(manifest.status, 'blocked')
  assert.equal(manifest.summary.task_count, 0)
  assert.equal(manifest.summary.blocker_count, 1)
  assert.match(manifest.blockers[0].reason, /animation-only local anchor semantics/)
})

test('quality closure repair manifest markdown summarizes quota boundary', () => {
  const manifest = buildCharacterQualityClosureRepairManifestForDebugReport(debugReportWithClosure(), {
    runId: 'elder_quality_repair',
    itemId: 'village_elder_v1',
  })
  const markdown = renderCharacterQualityClosureRepairManifestMarkdown(manifest)

  assert.match(markdown, /Estimated provider calls: 1/)
  assert.match(markdown, /village_elder_v1_repair_semantic_side_walk_left/)
  assert.match(markdown, /This manifest converts local quality-closure evidence/)
})
