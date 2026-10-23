import test from 'node:test'
import assert from 'node:assert/strict'
import { brushCursorMask, brushCursorPixels, brushCursorPath } from '../../src/ui/vnext/vnext-brush-cursor.js'
import { createPixelStroke } from '../../src/editor-project/pixelDrawingTools.js'

test('brush cursor coverage equals the unchanged drawing kernel for sizes, tips, edges and selections', () => {
  const pattern = { width: 4, height: 3, rgba: new Uint8Array(48) }
  for (const i of [0, 2, 3, 4, 7, 8, 9, 11]) pattern.rgba.set([1, 2, 3, 128], i * 4)
  const brushes = [{ shape: 'pattern', pattern }]
  for (let size = 1; size <= 64; size++) for (const shape of ['square', 'round']) brushes.push({ size, shape })
  const width = 80, height = 80
  for (const brush of brushes) for (const point of [{ x: 38, y: 38 }, { x: 0, y: 0 }, { x: 79, y: 79 }, { x: 80, y: 0 }]) {
    const source = { width, height, rgba: new Uint8Array(width * height * 4) }
    const stroke = createPixelStroke(source, [1, 2, 3, 255], brush)
    stroke.point(point)
    for (const rect of [null, { x: 35, y: 36, w: 3, h: 2 }]) {
      const expected = []
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (stroke.bytes[(y * width + x) * 4 + 3] && (!rect || (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h))) expected.push([x, y])
      }
      assert.deepEqual(brushCursorPixels(brushCursorMask(brush), point, width, height, rect), expected)
    }
  }
})

test('brush cursor contour removes internal edges while preserving a transparent hole', () => {
  const pixels = []
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) pixels.push([x, y])
  const path = brushCursorPath(pixels)
  assert.equal((path.match(/M/g) || []).length, 16)
  for (const edge of ['M1 1h1', 'M2 1v1', 'M1 2h1', 'M1 1v1']) assert.ok(path.includes(edge))
  assert.equal(brushCursorPath([]), '')
  assert.deepEqual(brushCursorMask({ size: 65 }), [])
})
