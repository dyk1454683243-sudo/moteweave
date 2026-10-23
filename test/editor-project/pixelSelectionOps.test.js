import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampPixelBlockPosition, clampPixelMove, deletePixelRect, extractPixelBlock, flipPixelRect,
  movePixelRect, pastePixelBlock, pixelPointInRect, pixelUnionRect,
} from '../../src/editor-project/pixelSelectionOps.js'

// 4×3 image; pixel (x, y) is [x, y, 10*x + y, 255], with (3,2) transparent but colored.
function image() {
  const rgba = new Uint8Array(4 * 3 * 4)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) rgba.set([x, y, 10 * x + y, 255], (y * 4 + x) * 4)
  rgba.set([9, 9, 9, 0], (2 * 4 + 3) * 4)
  return { width: 4, height: 3, rgba }
}
const px = (bytes, x, y, width = 4) => [...bytes.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]
const snapshot = source => [...source.rgba]

test('extract copies exact RGBA rows and remembers the origin', () => {
  const s = image(), before = snapshot(s)
  const block = extractPixelBlock(s, { x: 1, y: 1, w: 3, h: 2 })
  assert.equal(block.width, 3); assert.equal(block.height, 2); assert.deepEqual(block.origin, { x: 1, y: 1 })
  assert.deepEqual([...block.rgba.slice(0, 4)], [1, 1, 11, 255])
  assert.deepEqual([...block.rgba.slice(20, 24)], [9, 9, 9, 0], 'transparent pixel keeps its hidden RGB')
  assert.deepEqual(snapshot(s), before)
  assert.throws(() => extractPixelBlock(s, { x: 2, y: 0, w: 3, h: 1 }), /inside the image/)
  assert.throws(() => extractPixelBlock(s, { x: 0, y: 0, w: 0, h: 1 }), /inside the image/)
})

test('delete clears only the selection to fully transparent zeros', () => {
  const s = image(), before = snapshot(s)
  const r = deletePixelRect(s, { x: 1, y: 0, w: 2, h: 2 })
  assert.equal(r.changed, true); assert.deepEqual(r.writeRect, { x: 1, y: 0, w: 2, h: 2 })
  for (const [x, y] of [[1, 0], [2, 0], [1, 1], [2, 1]]) assert.deepEqual(px(r.bytes, x, y), [0, 0, 0, 0])
  for (const [x, y] of [[0, 0], [3, 0], [0, 2], [3, 2]]) assert.deepEqual(px(r.bytes, x, y), px(s.rgba, x, y))
  assert.deepEqual(snapshot(s), before)
  const empty = { width: 2, height: 2, rgba: new Uint8Array(16) }
  assert.equal(deletePixelRect(empty, { x: 0, y: 0, w: 2, h: 2 }).changed, false)
})

test('flip mirrors pixels inside the selection and leaves the rest byte-identical', () => {
  const s = image()
  const h = flipPixelRect(s, { x: 1, y: 1, w: 3, h: 2 }, 'horizontal')
  assert.deepEqual(px(h.bytes, 1, 1), px(s.rgba, 3, 1)); assert.deepEqual(px(h.bytes, 3, 1), px(s.rgba, 1, 1))
  assert.deepEqual(px(h.bytes, 2, 2), px(s.rgba, 2, 2)); assert.deepEqual(px(h.bytes, 1, 2), [9, 9, 9, 0])
  assert.deepEqual(px(h.bytes, 0, 1), px(s.rgba, 0, 1)); assert.deepEqual(px(h.bytes, 1, 0), px(s.rgba, 1, 0))
  const v = flipPixelRect(s, { x: 0, y: 0, w: 2, h: 3 }, 'vertical')
  assert.deepEqual(px(v.bytes, 0, 0), px(s.rgba, 0, 2)); assert.deepEqual(px(v.bytes, 1, 2), px(s.rgba, 1, 0))
  assert.deepEqual(px(v.bytes, 1, 1), px(s.rgba, 1, 1)); assert.deepEqual(px(v.bytes, 3, 0), px(s.rgba, 3, 0))
  assert.equal(flipPixelRect(s, { x: 2, y: 1, w: 1, h: 1 }, 'horizontal').changed, false, 'one pixel cannot change')
  assert.throws(() => flipPixelRect(s, { x: 0, y: 0, w: 1, h: 1 }, 'diagonal'), /horizontal or vertical/)
  const twice = flipPixelRect({ ...s, rgba: h.bytes }, { x: 1, y: 1, w: 3, h: 2 }, 'horizontal')
  assert.deepEqual([...twice.bytes], [...s.rgba], 'flipping twice restores the original bytes')
})

test('move lifts to transparent, lands opaque pixels exactly, and reports the union write area', () => {
  const s = image(), before = snapshot(s)
  const r = movePixelRect(s, { x: 0, y: 0, w: 2, h: 1 }, { x: 2, y: 2 })
  assert.deepEqual(r.rect, { x: 2, y: 2, w: 2, h: 1 }); assert.deepEqual(r.writeRect, { x: 0, y: 0, w: 4, h: 3 })
  assert.deepEqual(px(r.bytes, 0, 0), [0, 0, 0, 0]); assert.deepEqual(px(r.bytes, 1, 0), [0, 0, 0, 0])
  assert.deepEqual(px(r.bytes, 2, 2), [0, 0, 0, 255]); assert.deepEqual(px(r.bytes, 3, 2), [1, 0, 10, 255])
  assert.deepEqual(px(r.bytes, 2, 0), px(s.rgba, 2, 0)); assert.deepEqual(px(r.bytes, 1, 1), px(s.rgba, 1, 1))
  assert.deepEqual(snapshot(s), before)
  assert.throws(() => movePixelRect(s, { x: 0, y: 0, w: 2, h: 1 }, { x: 3, y: 0 }), /inside the image/)
  assert.throws(() => movePixelRect(s, { x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0 }), /whole pixels/)
  assert.equal(movePixelRect(s, { x: 1, y: 1, w: 1, h: 1 }, { x: 0, y: 0 }).changed, false)
})

test('transparent pixels in a moved or pasted block do not cover what is underneath', () => {
  const s = image()
  // Block with (0,0) opaque red and (1,0) fully transparent; destination keeps its pixel there.
  const block = { width: 2, height: 1, rgba: Uint8Array.of(255, 0, 0, 255, 7, 7, 7, 0) }
  const p = pastePixelBlock(s, block, { x: 1, y: 2 })
  assert.deepEqual(p.rect, { x: 1, y: 2, w: 2, h: 1 })
  assert.deepEqual(px(p.bytes, 1, 2), [255, 0, 0, 255]); assert.deepEqual(px(p.bytes, 2, 2), px(s.rgba, 2, 2))
  const half = { width: 1, height: 1, rgba: Uint8Array.of(10, 20, 30, 128) }
  assert.deepEqual(px(pastePixelBlock(s, half, { x: 0, y: 0 }).bytes, 0, 0), [10, 20, 30, 128], 'partial alpha replaces exactly, no blend')
  // Moving a block whose right pixel is transparent over existing art keeps that art.
  const m = movePixelRect(s, { x: 2, y: 2, w: 2, h: 1 }, { x: -2, y: 0 })
  assert.deepEqual(px(m.bytes, 0, 2), [2, 2, 22, 255]); assert.deepEqual(px(m.bytes, 1, 2), px(s.rgba, 1, 2))
  assert.deepEqual(px(m.bytes, 2, 2), [0, 0, 0, 0]); assert.deepEqual(px(m.bytes, 3, 2), [0, 0, 0, 0])
  assert.equal(pastePixelBlock(s, extractPixelBlock(s, { x: 0, y: 0, w: 2, h: 2 }), { x: 0, y: 0 }).changed, false, 'paste in place is a no-op')
  assert.throws(() => pastePixelBlock(s, block, { x: 3, y: 0 }), /inside the image/)
})

test('position helpers keep blocks inside the image and reject oversized pastes', () => {
  const s = image()
  assert.deepEqual(clampPixelBlockPosition(s, { width: 2, height: 2 }, { x: 9, y: -4 }), { x: 2, y: 0 })
  assert.deepEqual(clampPixelBlockPosition(s, { width: 4, height: 3 }, { x: 1, y: 1 }), { x: 0, y: 0 })
  assert.throws(() => clampPixelBlockPosition(s, { width: 5, height: 1 }, { x: 0, y: 0 }), /larger than this image/)
  assert.deepEqual(clampPixelMove(s, { x: 1, y: 1, w: 2, h: 2 }, { x: 5, y: -5 }), { x: 1, y: -1 })
  assert.deepEqual(clampPixelMove(s, { x: 1, y: 1, w: 2, h: 2 }, { x: -1, y: 0 }), { x: -1, y: 0 })
  assert.deepEqual(clampPixelMove({ width: 4, height: 3 }, { x: 0, y: 0, w: 1, h: 1 }, { x: -3, y: 9 }), { x: 0, y: 2 }, 'size alone is enough before pixels load')
  assert.throws(() => clampPixelMove({ width: 4, height: 3 }, { x: 3, y: 0, w: 2, h: 1 }, { x: 0, y: 0 }), /inside the image/)
  assert.equal(pixelPointInRect({ x: 2, y: 1 }, { x: 1, y: 1, w: 2, h: 1 }), true)
  assert.equal(pixelPointInRect({ x: 3, y: 1 }, { x: 1, y: 1, w: 2, h: 1 }), false)
  assert.deepEqual(pixelUnionRect({ x: 1, y: 2, w: 1, h: 1 }, { x: 3, y: 0, w: 2, h: 1 }), { x: 1, y: 0, w: 4, h: 3 })
})

test('candidate buffers can be reused and the 1024² bound holds', () => {
  const s = image(), into = new Uint8Array(s.rgba.length)
  assert.equal(movePixelRect(s, { x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0 }, into).bytes, into)
  assert.equal(flipPixelRect(s, { x: 0, y: 0, w: 2, h: 1 }, 'horizontal', s.rgba).bytes === s.rgba, false, 'never writes into the source')
  const big = { width: 1024, height: 1024, rgba: new Uint8Array(1024 * 1024 * 4) }
  assert.equal(deletePixelRect(big, { x: 0, y: 0, w: 1024, h: 1024 }).changed, false)
  assert.throws(() => deletePixelRect({ width: 4097, height: 1, rgba: new Uint8Array(4097 * 4) }, { x: 0, y: 0, w: 1, h: 1 }), /Unsupported/)
})
