import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQualityClosureRepairLoopPlan,
  runQualityClosureRepairLoop,
} from '../../src/character-pack/benchmark/qualityClosureRepairLoop.js'
import { buildCharacterQualityClosureRepairManifestForDebugReport } from '../../src/character-pack/benchmark/qualityClosureRepairManifest.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { CHARACTER_QUALITY_CLOSURE_MODE } from '../../src/character-pack/qualityClosureGate.js'

function paintRect(image, rect, color = [60, 120, 200, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeCell({ rect = { x: 40, y: 40, w: 17, h: 49 }, halo = false } = {}) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, rect)
  if (halo) paintRect(image, { x: rect.x - 1, y: rect.y, w: 1, h: rect.h }, [250, 250, 250, 255])
  return image
}

function pasteCell(sheet, frame, cell) {
  const col = frame % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frame / TOPDOWN_RPG_V0.grid.columns)
  for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
    for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
      const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
      sheet.data[dst] = cell.data[src]
      sheet.data[dst + 1] = cell.data[src + 1]
      sheet.data[dst + 2] = cell.data[src + 2]
      sheet.data[dst + 3] = cell.data[src + 3]
    }
  }
}

async function makeQualityClosureSheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const normal = makeCell()
  const halo = makeCell({ halo: true })
  const drifted = makeCell({ rect: { x: 34, y: 34, w: 17, h: 49 } })
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteCell(sheet, frame, frame === 0 ? halo : frame === 1 ? drifted : normal)
  }
  return encodeRgbaPng(sheet)
}

function frameReport(index) {
  return {
    index,
    runtime_action: index >= 24 && index <= 27 ? 'walk_left' : null,
    source_frame: {
      layout: 'topdown_rpg_v0',
      row: Math.floor(index / TOPDOWN_RPG_V0.grid.columns),
      col: index % TOPDOWN_RPG_V0.grid.columns,
      rect: { x: 0, y: 0, w: 192, h: 192 },
    },
    normalized_bbox: null,
    normalized_anchor: null,
    warnings: [],
  }
}

function makeManifest() {
  return buildCharacterQualityClosureRepairManifestForDebugReport({
    profile: 'topdown_rpg_v0',
    validation: {
      status: 'warning',
      warnings: ['frame_1_anchor_drift'],
      blocking_errors: [],
    },
    frames: Array.from({ length: 64 }, (_, index) => frameReport(index)),
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
          rationale: 'white edge pixels remain',
        },
        {
          id: 'local_anchor_stabilization',
          provider_required: false,
          action: 'local_anchor_stabilization',
          frames: [1],
          animations: [],
          rationale: 'frame anchor drift remains',
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
  }, {
    runId: 'quality_closure_loop_unit',
    itemId: 'village_elder_v1',
    artifactDir: 'generated/unit/items/village_elder_v1',
    item: {
      case: { id: 'village_elder', description: 'an elderly village leader with a wooden cane' },
      variant: 1,
    },
  })
}

test('quality closure repair loop applies local repairs, revalidates, and emits provider dry-run evidence', async () => {
  const manifest = makeManifest()
  const plan = buildQualityClosureRepairLoopPlan({
    manifest,
    outputDir: 'generated/unit/quality-closure-repair-loop',
  })
  const result = await runQualityClosureRepairLoop({
    plan,
    normalizedSheetBuffer: await makeQualityClosureSheetPng(),
  })
  const beforeAfter = await loadRgba(result.before_after_preview_png)
  const repairedSheet = await loadRgba(result.repaired_normalized_sheet_png)

  assert.equal(plan.can_run, true)
  assert.equal(plan.local_task_count, 2)
  assert.equal(plan.provider_task_count, 1)
  assert.equal(plan.estimated_provider_calls, 1)
  assert.equal(result.summary.local_task_count, 2)
  assert.equal(result.summary.local_applied_count, 2)
  assert.equal(result.provider_dry_run.tasks.length, 1)
  assert.equal(result.provider_dry_run.tasks[0].quota.dry_run_only, true)
  assert.match(result.provider_dry_run.tasks[0].provider_payload.prompt, /Target animation: walk_left/)
  assert.ok(result.local_target_results.some((item) => item.action === 'local_halo_cleanup' && item.resolved))
  assert.ok(result.local_target_results.some((item) => item.action === 'local_anchor_stabilization' && item.resolved))
  assert.equal(result.quality_closure_after.repair_tasks.some((task) => task.action === 'local_halo_cleanup'), false)
  assert.equal(result.quality_closure_after.repair_tasks.some((task) => task.action === 'local_anchor_stabilization'), false)
  assert.equal(beforeAfter.width, TOPDOWN_RPG_V0.sheet.w * 2 + 4)
  assert.equal(beforeAfter.height, TOPDOWN_RPG_V0.sheet.h)
  assert.deepEqual({ w: repairedSheet.width, h: repairedSheet.height }, TOPDOWN_RPG_V0.sheet)
  assert.match(result.markdown, /Provider Dry-Run Tasks/)
})

test('quality closure repair loop rejects stale local anchor tasks without validator drift warnings', () => {
  const manifest = makeManifest()
  const staleTask = manifest.tasks.find((task) => task.action === 'local_anchor_stabilization')
  staleTask.context.original_warnings = []
  const plan = buildQualityClosureRepairLoopPlan({
    manifest,
    outputDir: 'generated/unit/stale-quality-closure-repair-loop',
  })

  assert.equal(plan.can_run, false)
  assert.deepEqual(plan.preflight.stale_local_anchor_tasks, [staleTask.task_id])
  assert.match(plan.preflight.errors.join('\n'), /require validator anchor\/baseline drift warnings/)
})
