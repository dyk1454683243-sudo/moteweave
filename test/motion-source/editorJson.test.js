import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEditorFramesJson } from '../../src/motion-source/editorJson.js'

test('buildEditorFramesJson emits json-array frames for a horizontal strip', () => {
  const result = buildEditorFramesJson({
    image: 'normalized_motion_strip.png',
    action: 'walk_down',
    frameCount: 8,
    cellSize: [96, 96],
    durationMs: 83,
  })

  assert.ok(Array.isArray(result.frames))
  assert.equal(result.frames.length, 8)
  assert.deepEqual(result.frames[0].frame, { x: 0, y: 0, w: 96, h: 96 })
  assert.deepEqual(result.frames[7].frame, { x: 672, y: 0, w: 96, h: 96 })
  assert.equal(result.frames[0].duration, 83)
  assert.equal(result.frames[0].rotated, false)
  assert.equal(result.frames[0].trimmed, false)
})

test('buildEditorFramesJson records sheet size and frame tags', () => {
  const result = buildEditorFramesJson({
    image: 'walk_right_strip.png',
    action: 'walk_right',
    sheetSize: { w: 384, h: 96 },
    cellSize: { w: 96, h: 96 },
  })

  assert.deepEqual(result.meta.size, { w: 384, h: 96 })
  assert.equal(result.meta.image, 'walk_right_strip.png')
  assert.ok(result.meta.frameTags.some((tag) => (
    tag.name === 'walk_right' &&
    tag.from === 0 &&
    tag.to === 3 &&
    tag.direction === 'forward'
  )))
})

test('buildEditorFramesJson rejects malformed strip geometry', () => {
  assert.throws(
    () => buildEditorFramesJson({ action: 'idle_down', sheetSize: { w: 250, h: 96 }, cellSize: [96, 96] }),
    /editor_sheet_width_not_divisible_by_cell_width/
  )
  assert.throws(
    () => buildEditorFramesJson({ action: 'idle_down', frameCount: 0 }),
    /invalid_editor_frame_count/
  )
})
