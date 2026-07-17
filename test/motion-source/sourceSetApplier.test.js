import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { applyMotionSourceSet } from '../../src/motion-source/sourceSetApplier.js'

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

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

function makeSheet() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 40, y: 40, w: 16, h: 49 }, [60, 60, 60, 255])
  for (let frameIndex = 0; frameIndex < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frameIndex += 1) {
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
  return sheet
}

function makeStrip({
  color = [120, 80, 160, 255],
  frameCount = 4,
  cellWidth = TOPDOWN_RPG_V0.frame.w,
  cellHeight = TOPDOWN_RPG_V0.frame.h,
  y = 42,
  facingDirection = 'down',
} = {}) {
  const strip = blankImage(cellWidth * frameCount, cellHeight)
  for (let index = 0; index < frameCount; index += 1) {
    const dx = index % 2 ? 2 : -2
    paintRect(strip, { x: index * cellWidth + 39 + dx, y, w: 18, h: 46 }, color)
    paintRect(strip, { x: index * cellWidth + 43 - dx, y: y + 43, w: 4, h: 3 }, color)
  }
  return {
    id: 'strip',
    runtime_action: 'strip',
    image: strip,
    facing_direction: facingDirection,
  }
}

function manifest() {
  return {
    contract_version: 'motion_source_set_v1',
    identity_anchor: { source_id: 'idle_down', facing_direction: 'down' },
    background: { source_requirement: 'flat_solid_key_color', key_color: [255, 255, 255] },
    sources: [
      { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 4, facing_direction: 'down' },
      { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 4, facing_direction: 'down' },
    ],
  }
}

test('applies identity-passing strips in manifest order', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip({ color: [120, 80, 160, 255] }), id: 'idle_down', runtime_action: 'idle_down' },
      { ...makeStrip({ color: [124, 82, 158, 255] }), id: 'walk_down', runtime_action: 'walk_down' },
    ],
  })

  assert.equal(result.report.status, 'done')
  assert.equal(result.report.can_apply_multi_strip, true)
  assert.deepEqual(result.report.blocking_errors, [])
  assert.deepEqual(result.report.applied_actions.map((item) => item.runtime_action), ['idle_down', 'walk_down'])
  assert.equal(result.appliedSheet.width, TOPDOWN_RPG_V0.sheet.w)
  assert.equal(result.appliedSheet.height, TOPDOWN_RPG_V0.sheet.h)
})

test('does not apply when identity consistency fails', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip({ color: [120, 80, 160, 255] }), id: 'idle_down', runtime_action: 'idle_down' },
      { ...makeStrip({ color: [20, 220, 40, 255] }), id: 'walk_down', runtime_action: 'walk_down' },
    ],
    identityThresholds: { max_palette_delta: 24 },
  })

  assert.equal(result.report.status, 'fail')
  assert.equal(result.report.can_apply_multi_strip, false)
  assert.ok(result.report.blocking_errors.includes('identity_mismatch:walk_down'))
  assert.deepEqual(result.report.applied_actions, [])
})

test('reports missing strips by source id before applying anything', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip(), id: 'idle_down', runtime_action: 'idle_down' },
    ],
  })

  assert.equal(result.report.status, 'fail')
  assert.ok(result.report.blocking_errors.includes('missing_motion_strip:walk_down'))
  assert.deepEqual(result.report.applied_actions, [])
})

test('reports per-action apply failures without returning a partial sheet', async () => {
  const sheet = makeSheet()
  const result = await applyMotionSourceSet({
    sheet,
    manifest: manifest(),
    strips: [
      { ...makeStrip({ color: [120, 80, 160, 255] }), id: 'idle_down', runtime_action: 'idle_down' },
      { ...makeStrip({ color: [124, 82, 158, 255], frameCount: 8 }), id: 'walk_down', runtime_action: 'walk_down' },
    ],
  })

  assert.equal(result.report.status, 'fail')
  assert.equal(result.report.can_apply_multi_strip, false)
  assert.ok(result.report.blocking_errors.some((error) => error.startsWith('apply_motion_strip_failed:walk_down:')))
  assert.deepEqual(result.report.applied_actions, [])
  assert.strictEqual(result.appliedSheet, sheet)
})
