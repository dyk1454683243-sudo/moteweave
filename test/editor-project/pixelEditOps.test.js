import assert from 'node:assert/strict'
import test from 'node:test'

import { createPixelEditCandidate } from '../../src/editor-project/pixelEditOps.js'
import { createPixelStroke, createPixelLine, createPixelRectangle, createPixelFill } from '../../src/editor-project/pixelDrawingTools.js'
import { createPixelWorkingCopy, modifyPixelWorkingCopy, undoPixelWorkingCopy, redoPixelWorkingCopy } from '../../src/editor-project/pixelWorkingCopy.js'

const full = { x: 0, y: 0, w: 3, h: 2 }
const corner = { x: 1, y: 1, w: 2, h: 1 }

test('human and AI geometry use byte-identical shared drawing commands', () => {
  const input = { width: 8, height: 8, rgba: new Uint8Array(256) }
  const rect = { x: 0, y: 0, w: 8, h: 8 }, color = [20, 40, 60, 128]
  const start = { x: 1, y: 2 }, end = { x: 6, y: 5 }, points = [start, end]
  for (const [type, factory] of [['line', createPixelLine], ['rectangle', createPixelRectangle]]) {
    const human = factory(input, color, start); human.point(end)
    assert.deepEqual(createPixelEditCandidate(input, { type, rect, start, end, color }, rect).rgba, human.bytes)
  }
  const human = createPixelStroke(input, color); points.forEach(p => human.point(p))
  assert.deepEqual(createPixelEditCandidate(input, { type: 'pencil', rect, points, color }, rect).rgba, human.bytes)
  const eraseInput = { ...input, rgba: human.bytes }, eraser = createPixelStroke(eraseInput, [0, 0, 0, 0]); points.forEach(p => eraser.point(p))
  assert.deepEqual(createPixelEditCandidate(eraseInput, { type: 'eraser', rect, points }, rect).rgba, eraser.bytes)
  assert.deepEqual(createPixelEditCandidate(input, { type: 'flood-fill', rect, seed: start, color }, rect).rgba, createPixelFill(input, color, start).bytes)
  assert.equal(input.rgba.some(Boolean), false)
})

test('shared drawing owns its bytes even when the source is a Buffer view', () => {
  const backing = Buffer.alloc(72, 9), input = { width: 4, height: 4, rgba: backing.subarray(4, 68) }
  const rect = { x: 0, y: 0, w: 4, h: 4 }
  const result = createPixelEditCandidate(input, { type: 'line', rect, start: { x: 0, y: 0 }, end: { x: 3, y: 3 }, color: [255, 0, 0, 255] }, rect)
  assert.deepEqual(backing, Buffer.alloc(72, 9))
  assert.notEqual(result.rgba.buffer, backing.buffer)
})

test('scoped flood fill cannot escape and geometry rejects invalid points before drawing', () => {
  const input = { width: 4, height: 4, rgba: new Uint8Array(64) }, rect = { x: 1, y: 1, w: 2, h: 2 }
  const candidate = createPixelEditCandidate(input, { type: 'flood-fill', rect, seed: { x: 1, y: 1 }, color: [1, 2, 3, 255] }, rect)
  assert.equal(candidate.rgba.filter(v => v === 255).length, 4)
  const op = { type: 'pencil', rect, points: [{ x: 1, y: 1 }], color: [1, 2, 3, 255] }
  for (const points of [[], new Array(1), [{ x: 0, y: 1 }], [{ x: 1.5, y: 1 }], Array(2049).fill({ x: 1, y: 1 })]) {
    assert.throws(() => createPixelEditCandidate(input, { ...op, points }, rect), { code: 'invalid_request' })
  }
  let read = false
  const point = { x: 1, get y() { read = true; return 1 } }
  assert.throws(() => createPixelEditCandidate(input, { ...op, points: [point] }, rect), { code: 'invalid_request' })
  assert.equal(read, false)
})

function source() {
  return Object.freeze({
    width: 3, height: 2,
    rgba: Uint8Array.of(11, 22, 33, 0, 11, 22, 33, 128, 11, 22, 33, 255,
      11, 22, 33, 0, 11, 22, 33, 128, 11, 22, 33, 255),
  })
}

test('fill replaces exactly the allowed rectangle, including straight alpha, without changing source', () => {
  const input = source()
  const before = input.rgba.slice()
  const color = Object.freeze([91, 82, 73, 0])
  const op = Object.freeze({ type: 'fill-rect', rect: Object.freeze({ ...corner }), color })
  const candidate = createPixelEditCandidate(input, op, Object.freeze({ ...corner }))
  assert.equal(candidate.width, 3)
  assert.equal(candidate.height, 2)
  assert.deepEqual([...candidate.rgba], [11, 22, 33, 0, 11, 22, 33, 128, 11, 22, 33, 255,
    11, 22, 33, 0, 91, 82, 73, 0, 91, 82, 73, 0])
  assert.deepEqual(input.rgba, before)
  assert.notEqual(candidate.rgba.buffer, input.rgba.buffer)
})

test('replace-color matches all four channels and does not replace matches outside the operation', () => {
  const input = source()
  const candidate = createPixelEditCandidate(input, {
    type: 'replace-color', rect: { x: 0, y: 1, w: 3, h: 1 },
    from: [11, 22, 33, 128], to: [4, 5, 6, 7],
  }, full)
  const expected = input.rgba.slice()
  expected.set([4, 5, 6, 7], 16)
  assert.deepEqual(candidate.rgba, expected)
  const transparent = createPixelEditCandidate(input, {
    type: 'replace-color', rect: full, from: [11, 22, 33, 0], to: [90, 80, 70, 0],
  }, full)
  const expectedTransparent = input.rgba.slice()
  expectedTransparent.set([90, 80, 70, 0], 0)
  expectedTransparent.set([90, 80, 70, 0], 12)
  assert.deepEqual(transparent.rgba, expectedTransparent)
})

test('erase zeroes RGBA only inside its rectangle and preserves hidden RGB elsewhere', () => {
  const input = source()
  const candidate = createPixelEditCandidate(input, { type: 'erase', rect: corner }, full)
  const expected = input.rgba.slice()
  expected.fill(0, 16)
  assert.deepEqual(candidate.rgba, expected)
  assert.deepEqual([...input.rgba.slice(16)], [11, 22, 33, 128, 11, 22, 33, 255])
})

test('no-match and same-color candidates are byte exact and independently owned on every call', () => {
  const input = source()
  for (const from of [[0, 0, 0, 0], [11, 22, 33, 128]]) {
    const op = { type: 'replace-color', rect: full, from, to: from }
    const first = createPixelEditCandidate(input, op, full)
    const second = createPixelEditCandidate(input, op, full)
    assert.deepEqual(first.rgba, input.rgba)
    assert.deepEqual(second.rgba, input.rgba)
    first.rgba.fill(255)
    assert.deepEqual(second.rgba, input.rgba)
    input.rgba[0] = 0
    assert.equal(second.rgba[0], 11)
    input.rgba[0] = 11
  }
})

test('Buffer subviews use only their visible bytes and do not alias the backing storage', () => {
  const backing = Buffer.from([200, 201, 1, 2, 3, 4, 202, 203])
  const input = { width: 1, height: 1, rgba: backing.subarray(2, 6) }
  const rect = { x: 0, y: 0, w: 1, h: 1 }
  const candidate = createPixelEditCandidate(input, { type: 'fill-rect', rect, color: [5, 6, 7, 128] }, rect)
  assert.deepEqual([...candidate.rgba], [5, 6, 7, 128])
  assert.deepEqual([...backing], [200, 201, 1, 2, 3, 4, 202, 203])
  backing.fill(99)
  assert.deepEqual([...candidate.rgba], [5, 6, 7, 128])
})

test('invalid or oversized dimensions and non-RGBA sources are rejected before producing pixels', () => {
  const input = source()
  const op = { type: 'erase', rect: full }
  for (const bad of [null, [], 'image.png', { ...input, path: 'image.png' },
    { ...input, frame_order: ['one', 'two'] }, { ...input, width: 0 }, { ...input, height: -1 },
    { ...input, width: 1.5 }, { ...input, height: NaN }, { ...input, width: '3' },
    { ...input, rgba: [1, 2, 3, 4] }, { ...input, rgba: 'image.png' },
    { ...input, rgba: new Uint8Array(23) }, { ...input, rgba: new Uint8Array(25) },
    { ...input, rgba: new Uint16Array(12) },
    { ...input, rgba: new Uint8Array(new SharedArrayBuffer(24)) }]) {
    assert.throws(() => createPixelEditCandidate(bad, op, full), { code: 'invalid_request' })
  }
  for (const bad of [{ ...input, width: 4097 }, { ...input, height: 4097 }, { ...input, width: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => createPixelEditCandidate(bad, op, full), { code: 'resource_limit' })
  }
})

test('both rectangles must be valid and an operation cannot expand its separately supplied allowed region', () => {
  const input = source()
  const before = input.rgba.slice()
  const badRects = [undefined, null, [], {}, { ...full, x: -1 }, { ...full, w: 0 },
    { ...full, h: -1 }, { ...full, y: 0.5 }, { ...full, x: '0' }, { ...full, x: 1 },
    { ...full, y: 1 }, { ...full, h: Number.MAX_SAFE_INTEGER }, { ...full, x: NaN },
    { ...full, extra: true }]
  for (const rect of badRects) {
    assert.throws(() => createPixelEditCandidate(input, { type: 'erase', rect }, full), { code: 'invalid_request' })
    assert.throws(() => createPixelEditCandidate(input, { type: 'erase', rect: corner }, rect), { code: 'invalid_request' })
  }
  assert.throws(() => createPixelEditCandidate(input, { type: 'erase', rect: full }, corner), { code: 'invalid_request' })
  assert.deepEqual(input.rgba, before)
})

test('unknown operations/fields and invalid color channels are rejected rather than coerced', () => {
  const input = source()
  const before = input.rgba.slice()
  for (const op of [null, [], {}, 'make prettier', { type: 'blur', rect: full },
    { type: 'erase', rect: full, path: '/tmp/out.png' }, { type: 'erase' },
    { type: 'fill-rect', rect: full }, { type: 'replace-color', rect: full, from: [0, 0, 0, 0] }]) {
    assert.throws(() => createPixelEditCandidate(input, op, full), { code: 'invalid_request' })
  }
  for (const color of [null, '#ffffff', new Uint8Array(4), [], [0, 0, 0], [0, 0, 0, 0, 0],
    new Array(4), [0, 0, , 0], [-1, 0, 0, 0], [0, 256, 0, 0], [0, 0, 1.2, 0],
    [0, 0, 0, '255'], [0, 0, 0, NaN], [0, 0, 0, Infinity]]) {
    for (const op of [{ type: 'fill-rect', rect: full, color },
      { type: 'replace-color', rect: full, from: color, to: [0, 0, 0, 0] },
      { type: 'replace-color', rect: full, from: [0, 0, 0, 0], to: color }]) {
      assert.throws(() => createPixelEditCandidate(input, op, full), { code: 'invalid_request' })
    }
  }
  let reads = 0
  const getter = { ...input, get rgba() { reads += 1; return input.rgba } }
  assert.throws(() => createPixelEditCandidate(getter, { type: 'erase', rect: full }, full), { code: 'invalid_request' })
  assert.equal(reads, 0)
  assert.deepEqual(input.rgba, before)
})

test('maximum 1024-square source produces exactly a 4 MiB candidate and preserves edge pixels', () => {
  const input = { width: 1024, height: 1024, rgba: new Uint8Array(4 * 1024 * 1024) }
  input.rgba.set([7, 8, 9, 0])
  const rect = { x: 1023, y: 1023, w: 1, h: 1 }
  const candidate = createPixelEditCandidate(input, { type: 'fill-rect', rect, color: [255, 0, 128, 255] }, rect)
  assert.equal(candidate.rgba.byteLength, 4 * 1024 * 1024)
  assert.deepEqual([...candidate.rgba.slice(0, 4)], [7, 8, 9, 0])
  assert.deepEqual([...candidate.rgba.slice(-4)], [255, 0, 128, 255])
  assert.deepEqual([...input.rgba.slice(-4)], [0, 0, 0, 0])
})

test('color accessors and shadowed typed-array metadata cannot run or bypass source validation', () => {
  const input = source()
  const before = input.rgba.slice()
  let reads = 0
  const color = [0, 0, 0, 0]
  Object.defineProperty(color, '0', { get() { reads += 1; input.rgba.fill(255); return 0 } })
  assert.throws(() => createPixelEditCandidate(input, { type: 'fill-rect', rect: full, color }, full), { code: 'invalid_request' })
  for (const [rgba, key, value] of [
    [new Uint8Array(4), 'byteLength', 24],
    [new Uint8Array(new SharedArrayBuffer(24)), 'buffer', new ArrayBuffer(24)],
  ]) {
    Object.defineProperty(rgba, key, { value })
    assert.throws(() => createPixelEditCandidate({ ...input, rgba }, { type: 'erase', rect: full }, full), { code: 'invalid_request' })
  }
  for (const key of ['byteLength', 'buffer']) {
    const rgba = input.rgba.slice()
    Object.defineProperty(rgba, key, { get() { reads += 1; input.rgba.fill(255); return null } })
    assert.throws(() => createPixelEditCandidate({ ...input, rgba }, { type: 'erase', rect: full }, full), { code: 'invalid_request' })
  }
  assert.equal(reads, 0)
  assert.deepEqual(input.rgba, before)
})

test('candidate creation is separate from explicit working-copy application and existing undo/redo', () => {
  const input = source()
  const working = createPixelWorkingCopy(input)
  const candidate = createPixelEditCandidate(input, { type: 'fill-rect', rect: corner, color: [100, 50, 25, 128] }, full)
  assert.deepEqual(working.pixels(), input.rgba)
  modifyPixelWorkingCopy(working, full, candidate.rgba)
  assert.deepEqual(working.pixels(), candidate.rgba)
  undoPixelWorkingCopy(working)
  assert.deepEqual(working.pixels(), input.rgba)
  redoPixelWorkingCopy(working)
  assert.deepEqual(working.pixels(), candidate.rgba)
  assert.deepEqual(input, source())
})
