import test from 'node:test'
import assert from 'node:assert/strict'

import { applyTopdownRepairCells } from '../../src/character-pack/benchmark/topdownRepairApply.js'
import { buildTopdownRepairTask } from '../../src/character-pack/benchmark/topdownRepairManifest.js'
import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function paintRect(image, rect, color = [40, 90, 180, 255]) {
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

function makeCell(rect) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, rect)
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

async function makeSheetPng({ croppedFrame = 40, croppedFrames = null, wideFrames = [] } = {}) {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const compactCell = makeCell({ x: 24, y: 17, w: 48, h: 72 })
  const croppedCell = makeCell({ x: 0, y: 17, w: 72, h: 72 })
  const wideCell = makeCell({ x: 9, y: 13, w: 82, h: 76 })
  const croppedSet = new Set(croppedFrames ?? [croppedFrame])
  const wideSet = new Set(wideFrames)
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    const cell = croppedSet.has(frame) ? croppedCell : wideSet.has(frame) ? wideCell : compactCell
    pasteCell(sheet, frame, cell)
  }
  return encodeRgbaPng(sheet)
}

function makeRepairTask(frame) {
  return buildTopdownRepairTask({
    runId: 'repair_apply_unit',
    item: {
      case: { id: 'blue_wizard', description: 'a small blue wizard' },
      variant: 1,
      validation: { status: 'fail', blocking_errors: [`frame_${frame}_cropped`], warnings: [] },
    },
    issue: {
      message: `frame_${frame}_cropped`,
      issue: 'cropped_frame',
      frame,
      row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
      col: frame % TOPDOWN_RPG_V0.grid.columns,
      animation: 'attack_left',
      frame_in_animation: frame - 40,
      repair_scope: 'single_cell',
      strategy: 'regenerate_pose_with_more_padding',
    },
  })
}

test('applyTopdownRepairCells pastes one repaired cell and reruns validation plus row gifs', async () => {
  const normalizedSheetBuffer = await makeSheetPng({ croppedFrame: 40 })
  const repairedCellBuffer = await encodeRgbaPng(makeCell({ x: 26, y: 17, w: 44, h: 72 }))
  const task = makeRepairTask(40)

  const result = await applyTopdownRepairCells({
    normalizedSheetBuffer,
    repairs: [{ task, cellBuffer: repairedCellBuffer }],
  })

  assert.equal(result.applied_tasks.length, 1)
  assert.equal(result.target_results[0].task_id, 'blue_wizard_v1_frame_40_cropped')
  assert.equal(result.target_results[0].before_has_issue, true)
  assert.equal(result.target_results[0].after_has_issue, false)
  assert.equal(result.validation_before.blocking_errors.includes('frame_40_cropped'), true)
  assert.equal(result.validation_after.blocking_errors.includes('frame_40_cropped'), false)
  assert.equal(Buffer.isBuffer(result.repaired_normalized_sheet_png), true)
  assert.equal(Object.keys(result.row_gif_buffers).length, 16)
  assert.equal(Buffer.isBuffer(result.row_gif_buffers['attack_left.gif']), true)
})

test('applyTopdownRepairCells nudges repaired cells toward the profile anchor without cropping', async () => {
  const normalizedSheetBuffer = await makeSheetPng({ croppedFrame: 40 })
  const repairedCellBuffer = await encodeRgbaPng(makeCell({ x: 8, y: 12, w: 48, h: 68 }))
  const task = makeRepairTask(40)

  const result = await applyTopdownRepairCells({
    normalizedSheetBuffer,
    repairs: [{ task, cellBuffer: repairedCellBuffer }],
  })

  const alignment = result.applied_tasks[0].cell_alignment
  assert.equal(alignment.applied, true)
  assert.equal(alignment.after_anchor.y, TOPDOWN_RPG_V0.anchor.y)
  assert.equal(result.validation_after.blocking_errors.includes('frame_40_cropped'), false)
  assert.equal(result.validation_after.warnings.includes('frame_40_baseline_drift'), false)
})

test('applyTopdownRepairCells compacts oversized repaired cells before they trip edge pressure', async () => {
  const normalizedSheetBuffer = await makeSheetPng({
    croppedFrames: [40, 41, 42],
    wideFrames: [52, 53, 54, 55],
  })
  const wideRepairCellBuffer = await encodeRgbaPng(makeCell({ x: 4, y: 7, w: 88, h: 82 }))

  const result = await applyTopdownRepairCells({
    normalizedSheetBuffer,
    repairs: [40, 41, 42].map((frame) => ({ task: makeRepairTask(frame), cellBuffer: wideRepairCellBuffer })),
  })

  assert.equal(result.applied_tasks.every((task) => task.cell_compaction.applied), true)
  assert.equal(result.applied_tasks.every((task) => task.cell_compaction.after_bbox.w <= 78), true)
  assert.equal(result.validation_after.blocking_errors.length, 0)
  assert.equal(result.validation_after.warnings.includes('edge_pressure_high'), false)
})

test('applyTopdownRepairCells fits oversized repaired cells to the original target frame scale', async () => {
  const normalizedSheetBuffer = await makeSheetPng({ croppedFrame: 40 })
  const hugeRepairCellBuffer = await encodeRgbaPng(makeCell({ x: 2, y: 2, w: 92, h: 92 }))

  const result = await applyTopdownRepairCells({
    normalizedSheetBuffer,
    repairs: [{ task: makeRepairTask(40), cellBuffer: hugeRepairCellBuffer }],
  })

  const referenceFit = result.applied_tasks[0].cell_reference_fit
  assert.equal(referenceFit.applied, true)
  assert.ok(referenceFit.scale < 1)
  assert.ok(referenceFit.after_bbox.w <= Math.ceil(referenceFit.reference_bbox.w * 1.12))
  assert.ok(referenceFit.after_bbox.h <= Math.ceil(referenceFit.reference_bbox.h * 1.12))
  assert.equal(result.validation_after.blocking_errors.includes('frame_40_cropped'), false)
})

test('applyTopdownRepairCells rejects non-96x96 repair cells', async () => {
  const normalizedSheetBuffer = await makeSheetPng({ croppedFrame: 40 })
  const invalidCellBuffer = await encodeRgbaPng({
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4),
  })
  const task = makeRepairTask(40)

  await assert.rejects(
    applyTopdownRepairCells({
      normalizedSheetBuffer,
      repairs: [{ task, cellBuffer: invalidCellBuffer }],
    }),
    /repair cell must be 96x96, got 64x64/
  )
})
