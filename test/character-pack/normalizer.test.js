import test from 'node:test'
import assert from 'node:assert/strict'

import { detectAlphaBBox, normalizeCells } from '../../src/character-pack/normalizer.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

test('detectAlphaBBox returns visible bounds', () => {
  const image = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }
  image.data[((1 * 4 + 2) * 4) + 3] = 255
  image.data[((3 * 4 + 1) * 4) + 3] = 255
  assert.deepEqual(detectAlphaBBox(image), { x: 1, y: 1, w: 2, h: 3, right: 2, bottom: 3, centerX: 2, centerY: 2.5 })
})

test('normalizeCells creates 96x96 frames using a shared foot anchor', () => {
  const cell = { image: { width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) }, meta: { index: 0, row: 0, col: 0 } }
  for (let y = 2; y <= 8; y++) {
    for (let x = 4; x <= 6; x++) cell.image.data[((y * 10 + x) * 4) + 3] = 255
  }
  const out = normalizeCells([cell], TOPDOWN_RPG_V0)
  assert.equal(out.frames.length, 1)
  assert.equal(out.frames[0].image.width, 96)
  assert.equal(out.frames[0].image.height, 96)
  assert.equal(out.frames[0].normalized_bbox.bottom, 88)
})

test('normalizeCells aligns lower-body anchor instead of full bbox center', () => {
  const cell = { image: { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) }, meta: { index: 0, row: 0, col: 0 } }
  for (let y = 8; y <= 34; y++) {
    for (let x = 18; x <= 24; x++) cell.image.data[((y * 40 + x) * 4) + 3] = 255
  }
  for (let y = 16; y <= 22; y++) {
    for (let x = 4; x <= 17; x++) cell.image.data[((y * 40 + x) * 4) + 3] = 255
  }

  const out = normalizeCells([cell], TOPDOWN_RPG_V0)
  const frame = out.frames[0]

  assert.equal(frame.normalized_anchor.x, TOPDOWN_RPG_V0.anchor.x)
  assert.equal(frame.normalized_anchor.y, TOPDOWN_RPG_V0.anchor.y)
  assert.ok(frame.normalized_bbox.centerX < TOPDOWN_RPG_V0.anchor.x)
})

test('normalizeCells uses template anchor hints before silhouette-derived anchors', () => {
  const cell = {
    image: { width: 21, height: 42, data: new Uint8ClampedArray(21 * 42 * 4) },
    meta: {
      index: 0,
      template_anchor: { x: 10, y: 41, mode: 'template-foot-center', source: 'fixed_region_motion_v0_template' },
    },
  }
  for (let y = 8; y <= 41; y++) {
    for (let x = 8; x <= 12; x++) cell.image.data[((y * 21 + x) * 4) + 3] = 255
  }
  for (let y = 15; y <= 22; y++) {
    for (let x = 0; x <= 7; x++) cell.image.data[((y * 21 + x) * 4) + 3] = 255
  }

  const out = normalizeCells([cell], TOPDOWN_RPG_V0)
  const frame = out.frames[0]

  assert.deepEqual(frame.source_anchor, cell.meta.template_anchor)
  assert.equal(frame.normalized_anchor.x, TOPDOWN_RPG_V0.anchor.x)
  assert.equal(frame.normalized_anchor.y, TOPDOWN_RPG_V0.anchor.y)
  assert.equal(frame.normalized_bbox.x, TOPDOWN_RPG_V0.anchor.x - 10)
})
