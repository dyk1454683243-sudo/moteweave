import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clientPointToFramePoint,
  createFrameRepairMaskSource,
  drawFrameRepairOverlay,
  rectangleFromFramePoints,
} from '../../src/ui/editor/frameRepairCanvas.js'

function fakeCanvasDocument() {
  const canvases = []
  return {
    canvases,
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const operations = []
      const context = {
        fillStyle: '',
        fillRect(...args) { operations.push(['fillRect', this.fillStyle, ...args]) },
      }
      const canvas = {
        width: 0,
        height: 0,
        operations,
        getContext(type) {
          assert.equal(type, '2d')
          return context
        },
      }
      canvases.push(canvas)
      return canvas
    },
  }
}

function drawContext() {
  const operations = []
  return {
    operations,
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    save() { operations.push(['save']) },
    restore() { operations.push(['restore']) },
    drawImage(...args) { operations.push(['drawImage', ...args]) },
    setLineDash(value) { operations.push(['setLineDash', ...value]) },
    strokeRect(...args) { operations.push(['strokeRect', ...args]) },
    fillRect(...args) { operations.push(['fillRect', ...args]) },
  }
}

test('Canvas pointer coordinates map through the current fit, zoom, and pan viewport', () => {
  assert.deepEqual(clientPointToFramePoint({
    clientX: 150,
    clientY: 90,
    canvasRect: { left: 10, top: 10, width: 280, height: 160 },
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }), { x: 48, y: 48 })

  assert.deepEqual(clientPointToFramePoint({
    clientX: 102,
    clientY: 42,
    canvasRect: { left: 10, top: 10, width: 280, height: 160 },
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }), { x: 0, y: 0 })

  assert.equal(clientPointToFramePoint({
    clientX: 20,
    clientY: 20,
    canvasRect: { left: 10, top: 10, width: 280, height: 160 },
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }), null)
})

test('drag endpoints produce one inclusive, normalized frame rectangle', () => {
  assert.deepEqual(rectangleFromFramePoints({ x: 20, y: 30 }, { x: 10, y: 25 }), {
    x: 10,
    y: 25,
    width: 11,
    height: 6,
  })
  assert.deepEqual(rectangleFromFramePoints({ x: 4, y: 7 }, { x: 4, y: 7 }), {
    x: 4,
    y: 7,
    width: 1,
    height: 1,
  })
  assert.throws(
    () => rectangleFromFramePoints({ x: 1.5, y: 0 }, { x: 2, y: 2 }),
    /integer/,
  )
})

test('mask sources are cached by canonical run signature and rasterized outside visible draw', () => {
  const documentRef = fakeCanvasDocument()
  const mask = {
    width: 4,
    height: 3,
    sha256: 'a'.repeat(64),
    runs: [{ start: 1, length: 2 }, { start: 8, length: 1 }],
  }
  const first = createFrameRepairMaskSource(mask, documentRef)
  const same = createFrameRepairMaskSource(structuredClone(mask), documentRef)

  assert.equal(first, same)
  assert.equal(documentRef.canvases.length, 1)
  assert.deepEqual([first.width, first.height], [4, 3])
  assert.equal(first.operations.filter(([type]) => type === 'fillRect').length, 3)

  const changed = createFrameRepairMaskSource({
    ...mask,
    sha256: 'b'.repeat(64),
    runs: [{ start: 0, length: 1 }],
  }, documentRef)
  assert.notEqual(changed, first)
  assert.equal(documentRef.canvases.length, 2)
})

test('mask source cache evicts old entries instead of growing for the lifetime of the document', () => {
  const documentRef = fakeCanvasDocument()
  const firstMask = {
    width: 2,
    height: 2,
    sha256: 'first',
    runs: [{ start: 0, length: 1 }],
  }
  const first = createFrameRepairMaskSource(firstMask, documentRef)

  for (let index = 0; index < 128; index += 1) {
    createFrameRepairMaskSource({
      width: 2,
      height: 2,
      sha256: `mask-${index}`,
      runs: [{ start: index % 4, length: 1 }],
    }, documentRef)
  }

  assert.notEqual(createFrameRepairMaskSource(firstMask, documentRef), first)
  assert.equal(documentRef.canvases.length, 130)
})

test('visible overlay draw uses cached mask pixels and distinct Add/Remove rectangle styles', () => {
  const source = { width: 96, height: 96 }
  const viewport = { x: 20, y: 30, w: 192, h: 192 }
  const context = drawContext()

  drawFrameRepairOverlay(context, { type: 'frame_repair_mask', source }, viewport, 2)
  drawFrameRepairOverlay(context, {
    type: 'frame_repair_rectangle',
    op: 'add_rectangle',
    rectangle: { x: 10, y: 12, width: 8, height: 6 },
    selected: true,
  }, viewport, 2)
  drawFrameRepairOverlay(context, {
    type: 'frame_repair_rectangle',
    op: 'remove_rectangle',
    rectangle: { x: 2, y: 3, width: 4, height: 5 },
  }, viewport, 2)

  assert.equal(context.imageSmoothingEnabled, false)
  assert.equal(context.operations.filter(([type]) => type === 'drawImage').length, 1)
  assert.deepEqual(
    context.operations.filter(([type]) => type === 'setLineDash').map((entry) => entry.slice(1)),
    [[], [8, 4]],
  )
  assert.equal(context.operations.filter(([type]) => type === 'strokeRect').length, 2)
})

test('Frame Repair overlay module does no fetch, decode, hash, or layout read inside draw', async () => {
  const source = await readFile('src/ui/editor/frameRepairCanvas.js', 'utf8')
  assert.doesNotMatch(source, /fetch\s*\(|createImageBitmap|subtle\.digest|getBoundingClientRect|offset(?:Width|Height)/)
  assert.match(source, /imageSmoothingEnabled\s*=\s*false/)
})
