import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFrameRepairMaskEdits,
  deriveFrameRepairBaseMask,
  maskBitsToRuns,
} from '../../src/editor-project/frameRepairMask.js'

function frame(width = 6, height = 6) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function setPixel(image, x, y, rgba) {
  image.data.set(rgba, (y * image.width + x) * 4)
}

function assertMaskError(fn) {
  assert.throws(fn, (error) => error?.code === 'invalid_frame_repair_mask')
}

test('diagnostic mask localizes fringe pixels and ordered rectangle edits are canonical', () => {
  const image = frame()
  const offset = (2 * image.width + 2) * 4
  image.data.set([248, 248, 248, 120], offset)

  const base = deriveFrameRepairBaseMask(image)

  assert.equal(base.mode, 'localized_diagnostic')
  assert.equal(base.activePixelCount, 9)
  const edited = applyFrameRepairMaskEdits(base.bits, image.width, image.height, [
    { op: 'add_rectangle', x: 1, y: 1, width: 3, height: 3 },
    { op: 'remove_rectangle', x: 1, y: 1, width: 1, height: 1 },
  ])
  assert.deepEqual(maskBitsToRuns(edited), [
    { start: 8, length: 2 },
    { start: 13, length: 3 },
    { start: 19, length: 3 },
  ])
})

test('diagnostic mask includes detached components of at least two pixels but excludes the largest subject and singletons', () => {
  const image = frame(8, 5)
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    setPixel(image, x, y, [30, 40, 50, 255])
  }
  for (const [x, y] of [[6, 1], [6, 2]]) {
    setPixel(image, x, y, [40, 50, 60, 255])
  }
  setPixel(image, 4, 4, [50, 60, 70, 255])

  const result = deriveFrameRepairBaseMask(image)

  assert.equal(result.mode, 'localized_diagnostic')
  assert.equal(result.activePixelCount, 12)
  assert.equal(result.bits[1 * image.width + 1], 0)
  assert.equal(result.bits[2 * image.width + 2], 0)
  assert.equal(result.bits[4 * image.width + 4], 0)
  assert.deepEqual(maskBitsToRuns(result.bits), [
    { start: 5, length: 3 },
    { start: 13, length: 3 },
    { start: 21, length: 3 },
    { start: 29, length: 3 },
  ])
})

test('needs_scope keeps bits empty and returns only a display subject bbox suggestion', () => {
  const image = frame()
  for (const [x, y] of [[2, 1], [3, 1], [2, 2], [3, 2]]) {
    setPixel(image, x, y, [30, 40, 50, 255])
  }
  const before = new Uint8ClampedArray(image.data)

  const result = deriveFrameRepairBaseMask(image)

  assert.equal(result.mode, 'needs_scope')
  assert.equal(result.activePixelCount, 0)
  assert.deepEqual([...result.bits], Array(image.width * image.height).fill(0))
  assert.deepEqual(result.suggestedRectangle, { x: 2, y: 1, width: 2, height: 2 })
  assert.deepEqual(image.data, before)

  const empty = deriveFrameRepairBaseMask(frame(2, 2))
  assert.equal(empty.suggestedRectangle, null)
  assert.deepEqual([...empty.bits], [0, 0, 0, 0])
})

test('rectangle edits apply strictly in order without mutating bits or edit records', () => {
  const base = new Uint8Array(12)
  base[0] = 1
  const edits = [
    { op: 'add_rectangle', x: 0, y: 0, width: 3, height: 2 },
    { op: 'remove_rectangle', x: 1, y: 0, width: 2, height: 1 },
    { op: 'add_rectangle', x: 2, y: 0, width: 1, height: 1 },
  ]
  const editsBefore = structuredClone(edits)

  const result = applyFrameRepairMaskEdits(base, 4, 3, edits)

  assert.deepEqual([...base], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(edits, editsBefore)
  assert.deepEqual(maskBitsToRuns(result), [
    { start: 0, length: 1 },
    { start: 2, length: 1 },
    { start: 4, length: 3 },
  ])
})

test('mask operations reject invalid dimensions, RGBA inputs, bitsets, edits, and bounds with a stable code', () => {
  assertMaskError(() => deriveFrameRepairBaseMask({ width: 0, height: 1, data: new Uint8ClampedArray(0) }))
  assertMaskError(() => deriveFrameRepairBaseMask({ width: 1, height: 0, data: new Uint8ClampedArray(0) }))
  assertMaskError(() => deriveFrameRepairBaseMask({ width: 1, height: 1, data: new Uint8Array(4) }))
  assertMaskError(() => deriveFrameRepairBaseMask({ width: 1, height: 1, data: new Uint8ClampedArray(3) }))

  assertMaskError(() => applyFrameRepairMaskEdits(new Uint8Array(5), 3, 2, []))
  assertMaskError(() => applyFrameRepairMaskEdits(Uint8Array.of(0, 0, 2, 0, 0, 0), 3, 2, []))
  assertMaskError(() => applyFrameRepairMaskEdits(new Uint8Array(6), 3, 2, null))
  for (const edit of [
    null,
    { op: 'paint', x: 0, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: -1, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0.5, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0, y: 0, width: 0, height: 1 },
    { op: 'remove_rectangle', x: 0, y: 0, width: 1, height: 1, extra: true },
    { op: 'add_rectangle', x: 2, y: 0, width: 2, height: 1 },
    { op: 'remove_rectangle', x: 0, y: 1, width: 1, height: 2 },
  ]) {
    assertMaskError(() => applyFrameRepairMaskEdits(new Uint8Array(6), 3, 2, [edit]))
  }
  assertMaskError(() => applyFrameRepairMaskEdits(
    new Uint8Array(6),
    3,
    2,
    Array.from({ length: 65 }, () => ({ op: 'add_rectangle', x: 0, y: 0, width: 1, height: 1 })),
  ))
})

test('maskBitsToRuns emits stable sorted non-overlapping runs and validates binary input', () => {
  const bits = Uint8Array.of(0, 1, 1, 0, 1, 1, 1, 0)
  const before = new Uint8Array(bits)

  assert.deepEqual(maskBitsToRuns(bits), [
    { start: 1, length: 2 },
    { start: 4, length: 3 },
  ])
  assert.deepEqual(bits, before)
  assert.deepEqual(maskBitsToRuns(new Uint8Array()), [])
  assertMaskError(() => maskBitsToRuns([0, 1]))
  assertMaskError(() => maskBitsToRuns(Uint8Array.of(0, 2)))
})
