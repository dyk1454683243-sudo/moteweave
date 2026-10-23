import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VNEXT_WHEEL_ZOOM_DOUBLING_PX,
  VNEXT_WHEEL_ZOOM_LINE_PX,
  VNEXT_WHEEL_ZOOM_MAX_DELTA_PX,
  VNEXT_WHEEL_ZOOM_PAGE_PX,
  VNEXT_ZOOM_MAX,
  VNEXT_ZOOM_MIN,
  VNEXT_ZOOM_STEPS,
  createVnextCanvasView,
  nextZoomStep,
  normalizeWheelZoomDelta,
  snapZoomDown,
} from '../../src/ui/vnext/vnext-canvas-view.js'

test('keyboard and button zoom step along a whole-number ladder and snap off-ladder continuous zoom back to whole-pixel pan', () => {
  assert.equal(nextZoomStep(1, 1), 2); assert.equal(nextZoomStep(2, 1), 3); assert.equal(nextZoomStep(8, 1), 12)
  assert.equal(nextZoomStep(VNEXT_ZOOM_MAX, 1), VNEXT_ZOOM_MAX); assert.equal(nextZoomStep(VNEXT_ZOOM_MIN, -1), VNEXT_ZOOM_MIN)
  assert.equal(nextZoomStep(3.73, 1), 4, 'an off-ladder zoom snaps to the next step'); assert.equal(nextZoomStep(3.73, -1), 3)
  assert.equal(snapZoomDown(5.8125), 4); assert.equal(snapZoomDown(0.9), 0.75); assert.equal(snapZoomDown(64), VNEXT_ZOOM_MAX)
  const view = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
  view.setCanvases([{ id: 'a', x: 0, y: 0, width: 16, height: 16 }])
  const host = { left: 100, top: 50 }

  // Continuous wheel zoom places view on an off-ladder float zoom and float pan
  view.wheelZoom({ clientX: 277, clientY: 193, deltaY: -40, deltaMode: 0 }, host)
  assert.ok(Math.abs(view.zoom - Math.pow(2, 40 / VNEXT_WHEEL_ZOOM_DOUBLING_PX)) <= 1e-9)
  assert.equal(VNEXT_ZOOM_STEPS.includes(view.zoom), false)

  // Discrete zoomAt snaps from off-ladder ~1.3195 up to 2 and rounds panX/panY to integers
  view.zoomAt(277, 193, 1.1, host)
  assert.equal(view.zoom, 2, 'stepping up from ~1.32x snaps to 2x on the ladder')
  assert.equal(Number.isInteger(view.panX) && Number.isInteger(view.panY), true)

  // Step down from an off-ladder zoom ~1.3195 snaps to 1x and rounds panX/panY to integers
  view.wheelZoom({ clientX: 277, clientY: 193, deltaY: 60, deltaMode: 0 }, host)
  assert.ok(view.zoom > 1 && view.zoom < 2)
  view.zoomAt(277, 193, 0.9, host)
  assert.equal(view.zoom, 1, 'stepping down from ~1.32x snaps to 1x on the ladder')
  assert.equal(Number.isInteger(view.panX) && Number.isInteger(view.panY), true)

  view.zoomTo(8, 5, 5, { left: 0, top: 0 })
  assert.equal(view.zoom, 8); assert.equal(Number.isInteger(view.panX) && Number.isInteger(view.panY), true)
  view.panBy(0.4, 0.6); assert.equal(Number.isInteger(view.panX) && Number.isInteger(view.panY), true)
  view.fitAll(1100, 900, 32)
  assert.ok(VNEXT_ZOOM_STEPS.includes(view.zoom), `fit lands on the ladder (${view.zoom})`)
  assert.equal(view.zoom, VNEXT_ZOOM_MAX)
  assert.equal(Number.isInteger(view.panX) && Number.isInteger(view.panY), true)
})

test('normalizeWheelZoomDelta normalizes pixel, line, and page modes and ignores 0 or non-finite deltas', () => {
  assert.equal(normalizeWheelZoomDelta(-12, 0), -12)
  assert.equal(normalizeWheelZoomDelta(-2, 1), -2 * VNEXT_WHEEL_ZOOM_LINE_PX)
  assert.equal(normalizeWheelZoomDelta(1.5, 2), 1.5 * VNEXT_WHEEL_ZOOM_PAGE_PX)
  for (const invalid of [0, -0, NaN, Infinity, -Infinity, null, undefined, 'bad']) {
    assert.equal(normalizeWheelZoomDelta(invalid, 0), 0)
  }
})

test('wheelZoom responds continuously on every event, preserves scoped split-event invariance, and keeps pointer anchor drift-free', () => {
  const host = { left: 100, top: 50 }
  const anchor = { clientX: 277, clientY: 193 }

  // 1. Immediate continuous response on first sub-pixel and small trackpad deltas (no dead-zone threshold)
  const immediate = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
  const worldBefore = immediate.screenToWorld(anchor.clientX, anchor.clientY, host)
  assert.equal(immediate.wheelZoom({ ...anchor, deltaY: -0.4, deltaMode: 0 }, host), true)
  assert.ok(Math.abs(immediate.zoom - Math.pow(2, 0.4 / VNEXT_WHEEL_ZOOM_DOUBLING_PX)) <= 1e-9)
  // Immediate direction reversal without dead zone
  assert.equal(immediate.wheelZoom({ ...anchor, deltaY: 0.4, deltaMode: 0 }, host), true)
  assert.ok(Math.abs(immediate.zoom - 1) <= 1e-9)
  assert.ok(Math.abs(immediate.panX - 40) <= 1e-6)
  assert.ok(Math.abs(immediate.panY - 30) <= 1e-6)

  // 2. Scoped split-event invariance (all per-event |deltaPx| <= VNEXT_WHEEL_ZOOM_MAX_DELTA_PX and zoom within [0.1, 32]):
  // 100 × -0.4, 8 × -5, 2 × -20, and 1 × -40 at the same anchor produce equivalent zoom, pan, and world anchor
  const runSequence = (deltas) => {
    const v = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
    for (const deltaY of deltas) {
      assert.equal(v.wheelZoom({ ...anchor, deltaY, deltaMode: 0 }, host), true)
    }
    return v
  }
  const seqSubPixel = runSequence(Array.from({ length: 100 }, () => -0.4))
  const seqFine = runSequence(Array.from({ length: 8 }, () => -5))
  const seqCoarse = runSequence([-20, -20])
  const seqSingle = runSequence([-40])
  const expectedZoom40 = Math.pow(2, 40 / VNEXT_WHEEL_ZOOM_DOUBLING_PX)

  for (const candidate of [seqSubPixel, seqFine, seqCoarse, seqSingle]) {
    assert.ok(Math.abs(candidate.zoom - expectedZoom40) <= 1e-9)
    assert.ok(Math.abs(candidate.panX - seqSingle.panX) <= 1e-6)
    assert.ok(Math.abs(candidate.panY - seqSingle.panY) <= 1e-6)
    const worldAfter = candidate.screenToWorld(anchor.clientX, anchor.clientY, host)
    assert.ok(Math.abs(worldAfter.x - worldBefore.x) <= 1e-6)
    assert.ok(Math.abs(worldAfter.y - worldBefore.y) <= 1e-6)
  }

  // Scoped split-event invariance for 3 × -30 vs 1 × -90 (within [-120, 120] per-event clip)
  const seq3x30 = runSequence([-30, -30, -30])
  const seq1x90 = runSequence([-90])
  assert.ok(Math.abs(seq3x30.zoom - seq1x90.zoom) <= 1e-9)
  assert.ok(Math.abs(seq3x30.panX - seq1x90.panX) <= 1e-6)
  assert.ok(Math.abs(seq3x30.panY - seq1x90.panY) <= 1e-6)

  // 3. Multi-step continuous stream (120 events × -1.73 px) maintains exact pointer anchor at every step
  const stream = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
  const streamWorld0 = stream.screenToWorld(anchor.clientX, anchor.clientY, host)
  for (let i = 0; i < 120; i += 1) {
    assert.equal(stream.wheelZoom({ ...anchor, deltaY: -1.73, deltaMode: 0 }, host), true)
    const worldNow = stream.screenToWorld(anchor.clientX, anchor.clientY, host)
    assert.ok(Math.abs(worldNow.x - streamWorld0.x) <= 1e-6)
    assert.ok(Math.abs(worldNow.y - streamWorld0.y) <= 1e-6)
    const screenNow = stream.worldToScreen(streamWorld0.x, streamWorld0.y, host)
    assert.ok(Math.abs(screenNow.x - anchor.clientX) <= 1e-6)
    assert.ok(Math.abs(screenNow.y - anchor.clientY) <= 1e-6)
  }
})

test('wheelZoom clips per-event spikes to VNEXT_WHEEL_ZOOM_MAX_DELTA_PX and clamps cleanly at min and max zoom bounds', () => {
  const host = { left: 100, top: 50 }
  const anchor = { clientX: 320, clientY: 240 }

  // 1. Per-event spike clipping: a single -240px event is clipped to -120px (VNEXT_WHEEL_ZOOM_MAX_DELTA_PX),
  // whereas 4 × -60px events are unclipped and reach 2^(240/100)
  const spikedIn = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
  assert.equal(spikedIn.wheelZoom({ ...anchor, deltaY: -240, deltaMode: 0 }, host), true)
  assert.ok(Math.abs(spikedIn.zoom - Math.pow(2, VNEXT_WHEEL_ZOOM_MAX_DELTA_PX / VNEXT_WHEEL_ZOOM_DOUBLING_PX)) <= 1e-9)

  const unclipped4x60 = createVnextCanvasView({ zoom: 1, panX: 40, panY: 30 })
  for (let i = 0; i < 4; i += 1) {
    unclipped4x60.wheelZoom({ ...anchor, deltaY: -60, deltaMode: 0 }, host)
  }
  assert.ok(Math.abs(unclipped4x60.zoom - Math.pow(2, 240 / VNEXT_WHEEL_ZOOM_DOUBLING_PX)) <= 1e-9)
  assert.ok(unclipped4x60.zoom > spikedIn.zoom, 'single spike is bounded by per-event clip while split in-range events are not')

  const spikedOut = createVnextCanvasView({ zoom: 4, panX: 40, panY: 30 })
  assert.equal(spikedOut.wheelZoom({ ...anchor, deltaY: 300, deltaMode: 0 }, host), true)
  assert.ok(Math.abs(spikedOut.zoom - 4 * Math.pow(2, -VNEXT_WHEEL_ZOOM_MAX_DELTA_PX / VNEXT_WHEEL_ZOOM_DOUBLING_PX)) <= 1e-9)

  // 2. Min and max zoom bounds clamping
  const atMax = createVnextCanvasView({ zoom: 28, panX: 0, panY: 0 })
  assert.equal(atMax.wheelZoom({ ...anchor, deltaY: -120, deltaMode: 0 }, host), true)
  assert.equal(atMax.zoom, VNEXT_ZOOM_MAX)
  assert.equal(atMax.wheelZoom({ ...anchor, deltaY: -30, deltaMode: 0 }, host), false, 'already at VNEXT_ZOOM_MAX returns false')

  const atMin = createVnextCanvasView({ zoom: 0.12, panX: 0, panY: 0 })
  assert.equal(atMin.wheelZoom({ ...anchor, deltaY: 120, deltaMode: 0 }, host), true)
  assert.equal(atMin.zoom, VNEXT_ZOOM_MIN)
  assert.equal(atMin.wheelZoom({ ...anchor, deltaY: 30, deltaMode: 0 }, host), false, 'already at VNEXT_ZOOM_MIN returns false')
})
