import test from 'node:test'
import assert from 'node:assert/strict'

import { applyQualityClosureProviderRepairs } from '../../src/character-pack/benchmark/qualityClosureRepairApply.js'
import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

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

function makeCell(index, { propSide = null } = {}) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, { x: 42, y: 40, w: 13, h: 49 }, [40 + (index % 80), 90, 160, 255])
  if (propSide === 'left') paintRect(image, { x: 25, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
  if (propSide === 'right') paintRect(image, { x: 69, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
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

async function makeSemanticWarningSheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const propSides = new Map([
    [24, 'left'],
    [25, 'left'],
    [26, 'right'],
    [27, 'right'],
  ])
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteCell(sheet, frame, makeCell(frame, { propSide: propSides.get(frame) }))
  }
  return encodeRgbaPng(sheet)
}

async function makeRepairStripPng(frames, { propSide = 'left', sourceCellSize = TOPDOWN_RPG_V0.frame.w } = {}) {
  const scale = sourceCellSize / TOPDOWN_RPG_V0.frame.w
  const width = sourceCellSize * frames.length
  const height = sourceCellSize
  const strip = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }
  for (const [index, frame] of frames.entries()) {
    const cell = makeCell(frame, { propSide })
    for (let y = 0; y < sourceCellSize; y++) {
      for (let x = 0; x < sourceCellSize; x++) {
        const sx = Math.min(TOPDOWN_RPG_V0.frame.w - 1, Math.floor(x / scale))
        const sy = Math.min(TOPDOWN_RPG_V0.frame.h - 1, Math.floor(y / scale))
        const src = (sy * TOPDOWN_RPG_V0.frame.w + sx) * 4
        const dst = (y * width + index * sourceCellSize + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return encodeRgbaPng(strip)
}

function semanticTask() {
  const frames = [24, 25, 26, 27]
  return {
    task_id: 'village_elder_v1_repair_semantic_side_walk_left',
    item_id: 'village_elder_v1',
    preset: TOPDOWN_RPG_V0.id,
    stage: 'provider',
    provider_required: true,
    action: 'semantic_frame_repair',
    target: {
      animation: 'walk_left',
      frames: frames.map((frame) => ({
        frame,
        animation: 'walk_left',
        rect: {
          x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
          y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
          w: TOPDOWN_RPG_V0.frame.w,
          h: TOPDOWN_RPG_V0.frame.h,
        },
      })),
    },
  }
}

test('applyQualityClosureProviderRepairs pastes a repaired animation strip and reruns closure', async () => {
  const result = await applyQualityClosureProviderRepairs({
    normalizedSheetBuffer: await makeSemanticWarningSheetPng(),
    repairs: [{
      task: semanticTask(),
      stripBuffer: await makeRepairStripPng([24, 25, 26, 27]),
    }],
  })

  assert.equal(result.applied_tasks.length, 1)
  assert.equal(result.applied_tasks[0].strip.resized, false)
  assert.equal(result.semantic_target_results[0].before_has_task, true)
  assert.equal(result.semantic_target_results[0].after_has_task, false)
  assert.equal(result.semantic_target_results[0].resolved, true)
  assert.equal(result.quality_closure_after.repair_tasks.some((task) => task.id === 'repair_semantic_side_walk_left'), false)
  assert.equal(Buffer.isBuffer(result.repaired_normalized_sheet_png), true)
  assert.equal(Object.keys(result.row_gif_buffers).length, 16)
})

test('applyQualityClosureProviderRepairs normalizes a non-exact provider strip before paste', async () => {
  const result = await applyQualityClosureProviderRepairs({
    normalizedSheetBuffer: await makeSemanticWarningSheetPng(),
    repairs: [{
      task: semanticTask(),
      stripBuffer: await makeRepairStripPng([24, 25, 26, 27], { sourceCellSize: 128 }),
    }],
  })

  assert.equal(result.applied_tasks[0].strip.resized, true)
  assert.deepEqual(result.applied_tasks[0].strip.original_size, { w: 512, h: 128 })
  assert.deepEqual(result.applied_tasks[0].strip.normalized_size, { w: 384, h: 96 })
  assert.equal(result.semantic_target_results[0].resolved, true)
})
