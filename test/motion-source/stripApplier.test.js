import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from '../../src/character-pack/profile.js'
import { validateNormalizedFrames } from '../../src/character-pack/validator.js'
import { applyMotionStrip } from '../../src/motion-source/stripApplier.js'

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function compactCell(color, dx = 0) {
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 40 + dx, y: 40, w: 16, h: 49 }, color)
  return cell
}

function pasteCell(sheet, frameIndex, cell) {
  const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
  for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
    for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
      const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
      sheet.data[dst] = cell.data[src]
      sheet.data[dst + 1] = cell.data[src + 1]
      sheet.data[dst + 2] = cell.data[src + 2]
      sheet.data[dst + 3] = cell.data[src + 3]
    }
  }
}

function makeSheet() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  for (let index = 0; index < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; index += 1) {
    pasteCell(sheet, index, compactCell([60, 60, 60, 255]))
  }
  return sheet
}

function makeStrip(colors) {
  const strip = blankImage(TOPDOWN_RPG_V0.frame.w * colors.length, TOPDOWN_RPG_V0.frame.h)
  for (const [index, color] of colors.entries()) {
    const cell = compactCell(color, index % 2)
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = (y * strip.width + index * TOPDOWN_RPG_V0.frame.w + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return strip
}

function sampleCellColor(sheet, frameIndex) {
  const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
  const x = col * TOPDOWN_RPG_V0.frame.w + 44
  const y = row * TOPDOWN_RPG_V0.frame.h + 44
  const offset = (y * sheet.width + x) * 4
  return [...sheet.data.slice(offset, offset + 4)]
}

test('applyMotionStrip replaces one 4-frame runtime action', async () => {
  const sheet = makeSheet()
  const strip = makeStrip([
    [220, 40, 40, 255],
    [40, 220, 40, 255],
    [40, 40, 220, 255],
    [220, 220, 40, 255],
  ])

  const result = await applyMotionStrip({ sheet, strip, action: 'walk_down' })
  const applied = await loadRgba(result.appliedNormalizedSheetPng)
  const targetIndexes = getAnimationFrameIndexes('walk_down')

  assert.deepEqual(sampleCellColor(applied, targetIndexes[0]), [220, 40, 40, 255])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[1]), [40, 220, 40, 255])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[2]), [40, 40, 220, 255])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[3]), [220, 220, 40, 255])
  assert.deepEqual(sampleCellColor(applied, 0), [60, 60, 60, 255])
  assert.equal(result.report.status, 'done')
  assert.equal(result.report.resample_strategy, 'exact')
})

test('applyMotionStrip rejects 8-frame strips targeting 4-frame actions by default', async () => {
  const sheet = makeSheet()
  const strip = makeStrip(Array.from({ length: 8 }, (_, index) => [20 + index, 80, 160, 255]))

  await assert.rejects(
    () => applyMotionStrip({ sheet, strip, action: 'walk_down' }),
    /target_frame_count_mismatch/
  )
})

test('applyMotionStrip nearest-keyframe resampling maps source frames without blending', async () => {
  const sheet = makeSheet()
  const colors = Array.from({ length: 8 }, (_, index) => [20 + index * 20, 90, 160, 255])
  const strip = makeStrip(colors)

  const result = await applyMotionStrip({
    sheet,
    strip,
    action: 'walk_down',
    resampleStrategy: 'nearest_keyframes',
  })
  const applied = await loadRgba(result.appliedNormalizedSheetPng)
  const targetIndexes = getAnimationFrameIndexes('walk_down')
  const mapped = result.report.resample_mapping.map((item) => item.source_frame_index)

  assert.deepEqual(mapped, [0, 2, 5, 7])
  assert.equal(result.report.resample_strategy, 'nearest_keyframes')
  assert.deepEqual(sampleCellColor(applied, targetIndexes[0]), colors[0])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[1]), colors[2])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[2]), colors[5])
  assert.deepEqual(sampleCellColor(applied, targetIndexes[3]), colors[7])
})

test('applyMotionStrip output sheet dimensions match the source profile', async () => {
  const result = await applyMotionStrip({
    sheet: makeSheet(),
    strip: makeStrip([[220, 40, 40, 255], [40, 220, 40, 255], [40, 40, 220, 255], [220, 220, 40, 255]]),
    action: 'idle_down',
  })
  const applied = await loadRgba(result.appliedNormalizedSheetPng)

  assert.equal(applied.width, TOPDOWN_RPG_V0.sheet.w)
  assert.equal(applied.height, TOPDOWN_RPG_V0.sheet.h)
})

test('applyMotionStrip exposes frames that existing character-pack validation can inspect', async () => {
  const result = await applyMotionStrip({
    sheet: makeSheet(),
    strip: makeStrip([[220, 40, 40, 255], [40, 220, 40, 255], [40, 40, 220, 255], [220, 220, 40, 255]]),
    action: 'walk_down',
  })
  const validation = validateNormalizedFrames(result.frames, TOPDOWN_RPG_V0)

  assert.equal(validation.frame_count, 64)
  assert.deepEqual(validation.blocking_errors, [])
})

test('applyMotionStrip returns JSON-safe report and a PNG buffer', async () => {
  const result = await applyMotionStrip({
    sheet: makeSheet(),
    strip: makeStrip([[220, 40, 40, 255], [40, 220, 40, 255], [40, 40, 220, 255], [220, 220, 40, 255]]),
    action: 'walk_down',
  })

  assert.ok(Buffer.isBuffer(result.appliedNormalizedSheetPng))
  assert.ok(Buffer.isBuffer(await encodeRgbaPng(result.appliedSheet)))
  assert.equal(JSON.parse(JSON.stringify(result.report)).action, 'walk_down')
})
