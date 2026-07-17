import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeRepairDifferencePixels,
  buildDifferencePixels,
  buildRepairOverlayCommands,
  computeRepairViewport,
  createRepairComparisonRenderer,
  createRepairDifferenceSource,
  getRepairComparisonAvailability,
  readRepairFramePixels,
  renderRepairComparisonFrame,
  resolveSheetFrameRect,
} from '../../src/ui/editor/repairComparisonRenderer.js'
import { normalizeRepairEvidence } from '../../src/ui/editor/repairEvidence.js'

function createOffscreenDocument() {
  const calls = []
  const context = {
    imageSmoothingEnabled: true,
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    getImageData: (...args) => {
      calls.push(['getImageData', ...args])
      return { width: args[2], height: args[3], data: new Uint8ClampedArray(args[2] * args[3] * 4) }
    },
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  return {
    calls,
    context,
    canvas,
    documentRef: {
      createElement(tag) {
        assert.equal(tag, 'canvas')
        return canvas
      },
    },
  }
}

test('sprite frame extraction resolves the real frame crop from decoded sheet dimensions', () => {
  assert.deepEqual(resolveSheetFrameRect({
    frameIndex: 10,
    frameSize: { w: 96, h: 96 },
    sheetSize: { w: 768, h: 768 },
  }), { sx: 192, sy: 96, sw: 96, sh: 96 })
})

test('sprite frame extraction rejects invalid indices and unusable geometry', () => {
  for (const input of [
    { frameIndex: -1, frameSize: { w: 96, h: 96 }, sheetSize: { w: 768, h: 768 } },
    { frameIndex: 64, frameSize: { w: 96, h: 96 }, sheetSize: { w: 768, h: 768 } },
    { frameIndex: 1.5, frameSize: { w: 96, h: 96 }, sheetSize: { w: 768, h: 768 } },
    { frameIndex: 0, frameSize: { w: 0, h: 96 }, sheetSize: { w: 768, h: 768 } },
    { frameIndex: 0, frameSize: { w: 96, h: 96 }, sheetSize: { w: 767, h: 768 } },
    { frameIndex: 0, frameSize: { w: 96.5, h: 96 }, sheetSize: { w: 768, h: 768 } },
    { frameIndex: 0, frameSize: { w: 96, h: 96 }, sheetSize: { w: Number.NaN, h: 768 } },
    { frameIndex: 0, frameSize: { w: 96, h: 96 }, sheetSize: { w: 64, h: 64 } },
  ]) {
    assert.throws(() => resolveSheetFrameRect(input), RangeError)
  }
})

test('frame pixel extraction crops one real frame with nearest-neighbor sampling', () => {
  const source = { id: 'managed-active-revision-sheet', width: 768, height: 768 }
  const rect = { sx: 192, sy: 96, sw: 96, sh: 96 }
  const offscreen = createOffscreenDocument()

  const pixels = readRepairFramePixels(source, rect, offscreen.documentRef)

  assert.equal(offscreen.canvas.width, 96)
  assert.equal(offscreen.canvas.height, 96)
  assert.equal(offscreen.context.imageSmoothingEnabled, false)
  assert.deepEqual(offscreen.calls[0], ['drawImage', source, 192, 96, 96, 96, 0, 0, 96, 96])
  assert.deepEqual(offscreen.calls[1], ['getImageData', 0, 0, 96, 96])
  assert.equal(pixels.width, 96)
  assert.equal(pixels.height, 96)
})

test('overlay commands retain nudge-adjusted anchor, cuts, baseline, bbox, and debug evidence', () => {
  const baseAnchor = { x: 48, y: 88 }
  const perFrameNudge = { dx: 4, dy: -2 }
  const commands = buildRepairOverlayCommands({
    anchor: {
      x: baseAnchor.x + perFrameNudge.dx,
      y: baseAnchor.y + perFrameNudge.dy,
    },
    baselineY: 88 + perFrameNudge.dy,
    bbox: { x: 2, y: 4, w: 90, h: 90 },
    cutColumns: [0, 96],
    cutRows: [0, 96],
  })
  const debug = { type: 'anchor', x: 47, y: 87, style: 'debug', overlay: 'debug' }

  assert.deepEqual(commands, [
    { type: 'line', x1: 0, y1: 0, x2: 0, y2: 'height', style: 'cut' },
    { type: 'line', x1: 96, y1: 0, x2: 96, y2: 'height', style: 'cut' },
    { type: 'line', x1: 0, y1: 0, x2: 'width', y2: 0, style: 'cut' },
    { type: 'line', x1: 0, y1: 96, x2: 'width', y2: 96, style: 'cut' },
    { type: 'anchor', x: 52, y: 86 },
    { type: 'line', x1: 0, y1: 86, x2: 'width', y2: 86, style: 'baseline' },
    { type: 'rect', x: 2, y: 4, w: 90, h: 90, style: 'bbox' },
  ])
  assert.deepEqual([...commands, debug].at(-1), debug)
})

test('overlay command geometry filters malformed values, preserves zero, and does not fabricate fixed-region cuts', () => {
  assert.deepEqual(buildRepairOverlayCommands({
    anchor: { x: Number.NaN, y: 0 },
    baselineY: '0',
    bbox: { x: 0, y: 0, w: Number.NaN, h: 12 },
    cutColumns: [0, Number.NaN, '12'],
    cutRows: [],
  }), [
    { type: 'line', x1: 0, y1: 0, x2: 0, y2: 'height', style: 'cut' },
  ])
  assert.deepEqual(buildRepairOverlayCommands({
    anchor: { x: 0, y: 0 },
    baselineY: 0,
    bbox: { x: 0, y: 0, w: 12, h: 12 },
    cutColumns: [],
    cutRows: [],
  }), [
    { type: 'anchor', x: 0, y: 0 },
    { type: 'line', x1: 0, y1: 0, x2: 'width', y2: 0, style: 'baseline' },
    { type: 'rect', x: 0, y: 0, w: 12, h: 12, style: 'bbox' },
  ])
})

function createRenderContext(width = 960, height = 600) {
  const calls = []
  const stack = []
  const context = {
    canvas: { width, height },
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '',
    textAlign: '',
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillText: (...args) => calls.push(['fillText', context.fillStyle, context.textAlign, ...args]),
    save: () => {
      stack.push({ globalAlpha: context.globalAlpha })
      calls.push(['save'])
    },
    restore: () => {
      const previous = stack.pop()
      if (previous) context.globalAlpha = previous.globalAlpha
      calls.push(['restore'])
    },
    beginPath: () => calls.push(['beginPath']),
    rect: (...args) => calls.push(['rect', ...args]),
    clip: () => calls.push(['clip']),
    drawImage: (...args) => calls.push(['drawImage', context.globalAlpha, ...args]),
  }
  return { context, calls }
}

function comparisonFrame(overrides = {}) {
  const before = { id: 'managed-before-sheet', width: 768, height: 768 }
  const after = { id: 'preview-normalized-sheet', width: 768, height: 768 }
  const rect = { sx: 192, sy: 96, sw: 96, sh: 96 }
  return {
    mode: 'before',
    before,
    after,
    beforeRect: rect,
    afterRect: rect,
    split: 0.5,
    onionAlpha: 0.35,
    viewport: { x: 192, y: 12, w: 576, h: 576 },
    differenceSource: null,
    emptyMessage: 'comparison frame unavailable',
    overlayCommands: [],
    drawOverlay: () => {},
    ...overrides,
  }
}

test('comparison availability requires each real selected frame and equal crop dimensions', () => {
  const before = { width: 768, height: 768 }
  const after = { width: 384, height: 384 }
  const beforeRect = { sx: 0, sy: 0, sw: 96, sh: 96 }
  const afterRect = { sx: 0, sy: 0, sw: 96, sh: 96 }

  assert.deepEqual(getRepairComparisonAvailability({ before: null, after: null }), {
    before: { enabled: false, reason: 'before_frame_unavailable' },
    after: { enabled: false, reason: 'after_frame_unavailable' },
    split: { enabled: false, reason: 'comparison_size_mismatch' },
    difference: { enabled: false, reason: 'comparison_size_mismatch' },
    onion: { enabled: false, reason: 'comparison_size_mismatch' },
  })
  assert.deepEqual(getRepairComparisonAvailability({ before, after: null, beforeRect }), {
    before: { enabled: true, reason: null },
    after: { enabled: false, reason: 'after_frame_unavailable' },
    split: { enabled: false, reason: 'comparison_size_mismatch' },
    difference: { enabled: false, reason: 'comparison_size_mismatch' },
    onion: { enabled: false, reason: 'comparison_size_mismatch' },
  })

  const alignedSelectedFrames = getRepairComparisonAvailability({ before, after, beforeRect, afterRect })
  assert.ok(alignedSelectedFrames.before.enabled)
  assert.ok(alignedSelectedFrames.after.enabled)
  assert.ok(alignedSelectedFrames.split.enabled)
  assert.ok(alignedSelectedFrames.difference.enabled)
  assert.ok(alignedSelectedFrames.onion.enabled)

  const incompatible = getRepairComparisonAvailability({
    before,
    after,
    beforeRect,
    afterRect: { ...afterRect, sw: 64 },
  })
  assert.ok(incompatible.before.enabled)
  assert.ok(incompatible.after.enabled)
  assert.equal(incompatible.split.enabled, false)
  assert.equal(incompatible.difference.enabled, false)
  assert.equal(incompatible.onion.enabled, false)
})

test('difference pixels are real absolute RGB deltas with an opaque evidence alpha', () => {
  const before = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([10, 80, 250, 255, 100, 20, 40, 255]),
  }
  const after = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([30, 20, 200, 255, 90, 80, 10, 255]),
  }
  const result = buildDifferencePixels(
    before,
    after,
    (data, width, height) => ({ data, width, height }),
  )

  assert.deepEqual([...result.data], [20, 60, 50, 255, 10, 60, 30, 255])
  assert.equal(result.width, 2)
  assert.equal(result.height, 1)
  assert.deepEqual([...before.data], [10, 80, 250, 255, 100, 20, 40, 255])
  assert.deepEqual([...after.data], [30, 20, 200, 255, 90, 80, 10, 255])
})

test('difference pixels use raw RGB channel deltas regardless of source alpha', () => {
  const before = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 10, 0,
      100, 50, 20, 128,
      12, 34, 56, 255,
    ]),
  }
  const after = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 200, 30, 0,
      20, 80, 40, 64,
      12, 34, 56, 0,
    ]),
  }

  const result = buildDifferencePixels(before, after, (data, width, height) => ({ data, width, height }))

  assert.deepEqual([...result.data], [
    255, 200, 20, 255,
    80, 30, 20, 255,
    0, 0, 0, 255,
  ])
})

test('difference transparency sidecar reports alpha-only changes without altering raw Difference', () => {
  const before = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255]),
  }
  const after = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 0]),
  }

  const raw = buildDifferencePixels(before, after, (data, width, height) => ({ data, width, height }))
  assert.deepEqual([...raw.data], [0, 0, 0, 255])
  assert.deepEqual(analyzeRepairDifferencePixels(before, after), {
    alphaChangedPixelCount: 1,
    alphaOnlyChangedPixelCount: 1,
    transparentRgbOnlyChangedPixelCount: 0,
    diagnostics: [{ code: 'difference_alpha_only_change', pixelCount: 1 }],
  })
})

test('difference transparency sidecar reports hidden RGB changes between fully transparent pixels', () => {
  const before = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 10, 0]),
  }
  const after = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 200, 30, 0]),
  }

  const raw = buildDifferencePixels(before, after, (data, width, height) => ({ data, width, height }))
  assert.deepEqual([...raw.data], [255, 200, 20, 255])
  assert.deepEqual(analyzeRepairDifferencePixels(before, after), {
    alphaChangedPixelCount: 0,
    alphaOnlyChangedPixelCount: 0,
    transparentRgbOnlyChangedPixelCount: 1,
    diagnostics: [{ code: 'difference_transparent_rgb_only', pixelCount: 1 }],
  })
})

test('ordinary opaque RGB Difference produces no transparency diagnostics', () => {
  const before = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 255]),
  }
  const after = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([20, 10, 90, 255]),
  }

  assert.deepEqual(analyzeRepairDifferencePixels(before, after), {
    alphaChangedPixelCount: 0,
    alphaOnlyChangedPixelCount: 0,
    transparentRgbOnlyChangedPixelCount: 0,
    diagnostics: [],
  })
})

test('difference transparency sidecar counts multiple pixels and keeps diagnostics non-blocking', () => {
  const before = {
    width: 5,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      10, 20, 30, 128,
      255, 0, 10, 0,
      1, 2, 3, 255,
      0, 0, 0, 64,
    ]),
  }
  const after = {
    width: 5,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 0,
      90, 20, 30, 64,
      0, 200, 30, 0,
      1, 2, 3, 255,
      0, 0, 0, 0,
    ]),
  }

  assert.deepEqual(analyzeRepairDifferencePixels(before, after), {
    alphaChangedPixelCount: 3,
    alphaOnlyChangedPixelCount: 2,
    transparentRgbOnlyChangedPixelCount: 1,
    diagnostics: [
      { code: 'difference_alpha_only_change', pixelCount: 2 },
      { code: 'difference_transparent_rgb_only', pixelCount: 1 },
    ],
  })
})

test('difference transparency sidecar shares strict dimension and data validation', () => {
  const valid = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  for (const [before, after] of [
    [valid, { width: 2, height: 1, data: new Uint8ClampedArray(8) }],
    [valid, { width: 1, height: 1, data: new Uint8ClampedArray(3) }],
    [{ width: 1, height: 1, data: [0, 0, 0, 0] }, valid],
    [{ width: 0, height: 1, data: new Uint8ClampedArray(0) }, valid],
  ]) {
    assert.throws(() => analyzeRepairDifferencePixels(before, after), /comparison_size_mismatch/)
  }
})

test('difference pixels reject dimension and backing-data mismatches', () => {
  const valid = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  for (const other of [
    { width: 2, height: 1, data: new Uint8ClampedArray(8) },
    { width: 1, height: 1, data: new Uint8ClampedArray(3) },
    { width: 1, height: 1, data: [0, 0, 0, 0] },
  ]) {
    assert.throws(
      () => buildDifferencePixels(valid, other, (data, width, height) => ({ data, width, height })),
      /comparison_size_mismatch/,
    )
  }
})

test('difference source creation performs the only raw pixel write on an offscreen canvas', () => {
  const writes = []
  const context = { putImageData: (...args) => writes.push(args) }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const documentRef = { createElement: () => canvas }
  const imageData = { width: 96, height: 96, data: new Uint8ClampedArray(96 * 96 * 4) }

  assert.equal(createRepairDifferenceSource(imageData, documentRef), canvas)
  assert.equal(canvas.width, 96)
  assert.equal(canvas.height, 96)
  assert.deepEqual(writes, [[imageData, 0, 0]])
})

test('large comparison workspace centers and scales the frame without the empty-space regression', () => {
  assert.deepEqual(computeRepairViewport({
    canvasWidth: 960,
    canvasHeight: 600,
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }), { x: 192, y: 12, w: 576, h: 576 })
  assert.deepEqual(computeRepairViewport({
    canvasWidth: 960,
    canvasHeight: 600,
    frameSize: { w: 96, h: 96 },
    zoom: 0.5,
    pan: { x: 7, y: -5 },
  }), { x: 343, y: 151, w: 288, h: 288 })
})

test('Before and After draw only their real source frame through the centered scaled path', () => {
  for (const mode of ['before', 'after']) {
    const { context, calls } = createRenderContext()
    const frame = comparisonFrame({ mode })

    renderRepairComparisonFrame(context, frame)

    const draws = calls.filter(([name]) => name === 'drawImage')
    const source = mode === 'before' ? frame.before : frame.after
    assert.deepEqual(draws, [[
      'drawImage', 1, source, 192, 96, 96, 96, 192, 12, 576, 576,
    ]])
    assert.equal(context.imageSmoothingEnabled, false)
    assert.deepEqual(calls[0], ['clearRect', 0, 0, 960, 600])
  }
})

test('full-frame and wrapped frame descriptors use one availability and rendering contract', () => {
  const before = { id: 'before-frame', width: 96, height: 96 }
  const afterImage = { id: 'after-sheet', width: 192, height: 96 }
  const after = {
    source: afterImage,
    rect: { sx: 96, sy: 0, sw: 96, sh: 96 },
  }
  const availability = getRepairComparisonAvailability({ before, after })
  assert.ok(availability.before.enabled)
  assert.ok(availability.after.enabled)
  assert.ok(availability.split.enabled)

  const { beforeRect: _beforeRect, afterRect: _afterRect, ...fullFrame } = comparisonFrame()
  const { context, calls } = createRenderContext(192, 192)
  renderRepairComparisonFrame(context, {
    ...fullFrame,
    mode: 'split',
    before,
    after,
    viewport: { x: 0, y: 0, w: 192, h: 192 },
  })

  assert.deepEqual(calls.filter(([name]) => name === 'drawImage'), [
    ['drawImage', 1, before, 0, 0, 96, 96, 0, 0, 192, 192],
    ['drawImage', 1, afterImage, 96, 0, 96, 96, 0, 0, 192, 192],
  ])
})

test('explicit null or undefined frame rect is unavailable while an omitted rect means full-frame', () => {
  const before = { id: 'before-frame', width: 96, height: 96 }
  const after = { id: 'after-frame', width: 96, height: 96 }
  assert.ok(getRepairComparisonAvailability({ before, after }).before.enabled)
  assert.equal(getRepairComparisonAvailability({ before, after, beforeRect: null }).before.enabled, false)
  assert.equal(getRepairComparisonAvailability({ before, after, beforeRect: undefined }).before.enabled, false)
  assert.equal(getRepairComparisonAvailability({ before: { source: before, rect: null }, after }).before.enabled, false)
  assert.equal(getRepairComparisonAvailability({ before: { source: before, rect: undefined }, after }).before.enabled, false)
  assert.ok(getRepairComparisonAvailability({ before: { source: before }, after }).before.enabled)

  const explicit = getRepairComparisonAvailability({
    before,
    after,
    beforeRect: { sx: 0, sy: 0, sw: 96, sh: 96 },
    afterRect: { sx: 0, sy: 0, sw: 96, sh: 96 },
  })
  assert.ok(explicit.before.enabled)
  assert.ok(explicit.after.enabled)
  assert.ok(explicit.split.enabled)

  const { beforeRect: _beforeRect, ...withoutTopLevelBeforeRect } = comparisonFrame({ mode: 'before' })
  for (const frame of [
    comparisonFrame({ mode: 'before', beforeRect: null }),
    comparisonFrame({ mode: 'before', beforeRect: undefined }),
    { ...withoutTopLevelBeforeRect, before: { source: before, rect: null } },
    { ...withoutTopLevelBeforeRect, before: { source: before, rect: undefined } },
  ]) {
    const { context, calls } = createRenderContext()
    renderRepairComparisonFrame(context, frame)
    assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0)
    assert.equal(calls.filter(([name]) => name === 'fillText').length, 1)
  }
})

test('Split clamps its divider and Onion clamps configured opacity', () => {
  for (const [split, expectedDivider] of [[0.25, 240], [-10, 0], [10, 960], [Number.NaN, 480]]) {
    const { context, calls } = createRenderContext()
    renderRepairComparisonFrame(context, comparisonFrame({ mode: 'split', split }))
    const clipRects = calls.filter(([name]) => name === 'rect')
    assert.deepEqual(clipRects, [
      ['rect', 0, 0, expectedDivider, 600],
      ['rect', expectedDivider, 0, 960 - expectedDivider, 600],
    ])
    assert.equal(calls.filter(([name]) => name === 'drawImage').length, 2)
  }

  for (const [onionAlpha, expected] of [[0.35, 0.35], [-1, 0], [2, 1], [Number.NaN, 0.5]]) {
    const { context, calls } = createRenderContext()
    renderRepairComparisonFrame(context, comparisonFrame({ mode: 'onion', onionAlpha }))
    assert.deepEqual(
      calls.filter(([name]) => name === 'drawImage').map((call) => call[1]),
      [1, expected],
    )
  }
})

test('Difference is drawn with drawImage through the same viewport and never put on the visible origin', () => {
  const { context, calls } = createRenderContext()
  context.putImageData = () => assert.fail('visible comparison Canvas must not receive raw difference pixels')
  const differenceSource = { id: 'difference-offscreen', width: 96, height: 96 }

  renderRepairComparisonFrame(context, comparisonFrame({ mode: 'difference', differenceSource }))

  assert.deepEqual(calls.filter(([name]) => name === 'drawImage'), [[
    'drawImage', 1, differenceSource, 0, 0, 96, 96, 192, 12, 576, 576,
  ]])
})

test('overlay drawing receives the backing-store pixel ratio for DPR-equivalent CSS geometry', () => {
  const { context } = createRenderContext(960, 600)
  const captures = []
  renderRepairComparisonFrame(context, comparisonFrame({
    mode: 'before',
    pixelRatio: 2,
    viewport: { x: 206, y: 2, w: 576, h: 576 },
    overlayCommands: [{ type: 'anchor', x: 48, y: 88 }],
    drawOverlay: (_ctx, command, viewport, pixelRatio) => {
      captures.push({ command, viewport, pixelRatio })
    },
  }))

  assert.deepEqual(captures, [{
    command: { type: 'anchor', x: 48, y: 88 },
    viewport: { x: 206, y: 2, w: 576, h: 576 },
    pixelRatio: 2,
  }])
  assert.deepEqual(
    Object.fromEntries(Object.entries(captures[0].viewport).map(([key, value]) => [key, value / captures[0].pixelRatio])),
    { x: 103, y: 1, w: 288, h: 288 },
  )
})

function captureFractionalDprViewport(pixelRatio) {
  const scheduled = []
  let resize
  const { context, calls } = createRenderContext(1, 1)
  const canvas = { width: 1, height: 1, getContext: () => context }
  context.canvas = canvas
  const renderer = createRepairComparisonRenderer({
    canvas,
    pixelRatio,
    requestFrame(callback) {
      scheduled.push(callback)
      return scheduled.length
    },
    cancelFrame() {},
    observeResize(callback) {
      resize = callback
      return { disconnect() {} }
    },
  })
  resize({ width: 480.5, height: 300.5 })
  renderer.render({
    ...comparisonFrame({ mode: 'before' }),
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 7, y: -5 },
    playing: false,
  })
  scheduled.shift()()
  const viewport = calls.filter(([name]) => name === 'drawImage').at(-1).slice(-4)
  const backingSize = { width: canvas.width, height: canvas.height }
  renderer.destroy()
  return { viewport, backingSize }
}

test('fractional DPR computes one CSS viewport before controlled backing-store rounding', () => {
  const cssViewport = [103, 1, 288, 288]
  for (const pixelRatio of [1, 1.25, 1.5, 2]) {
    const result = captureFractionalDprViewport(pixelRatio)
    assert.deepEqual(result.backingSize, {
      width: Math.round(480.5 * pixelRatio),
      height: Math.round(300.5 * pixelRatio),
    })
    assert.deepEqual(result.viewport, cssViewport.map((value) => Math.round(value * pixelRatio)))
    result.viewport.forEach((value, index) => {
      assert.ok(
        Math.abs(value / pixelRatio - cssViewport[index]) <= 0.5 / pixelRatio,
        `DPR ${pixelRatio} changed CSS viewport component ${index}`,
      )
    })
  }
})

test('every unavailable mode draws one textual diagnostic and zero fabricated pixels', () => {
  const cases = [
    comparisonFrame({ mode: 'before', before: null }),
    comparisonFrame({ mode: 'after', after: null }),
    comparisonFrame({ mode: 'split', after: null }),
    comparisonFrame({ mode: 'onion', afterRect: null }),
    comparisonFrame({ mode: 'difference', afterRect: { sx: 0, sy: 0, sw: 64, sh: 96 }, differenceSource: { width: 96, height: 96 } }),
  ]
  for (const frame of cases) {
    const { context, calls } = createRenderContext()
    renderRepairComparisonFrame(context, frame)
    assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0)
    assert.deepEqual(calls.filter(([name]) => name === 'fillText'), [[
      'fillText', '#8b93a7', 'center', 'comparison frame unavailable', 480, 300,
    ]])
  }
})

test('renderer caches viewport inputs outside RAF and keeps all I/O, decode, and layout work out of draw', () => {
  const scheduled = new Map()
  const cancelled = []
  let nextId = 1
  let resizeCallback
  let observeCalls = 0
  let disconnectCalls = 0
  let phase = 'setup'
  let viewReads = 0
  const { context, calls } = createRenderContext(1, 1)
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => context,
    getBoundingClientRect: () => assert.fail('RAF must not read DOM layout'),
    get offsetWidth() { return assert.fail('RAF must not read offsetWidth') },
  }
  context.canvas = canvas
  const renderer = createRepairComparisonRenderer({
    canvas,
    pixelRatio: 2,
    requestFrame(callback) {
      const id = nextId++
      scheduled.set(id, callback)
      return id
    },
    cancelFrame(id) {
      cancelled.push(id)
      scheduled.delete(id)
    },
    observeResize(callback) {
      assert.equal(phase, 'setup')
      observeCalls += 1
      resizeCallback = callback
      return { disconnect: () => { disconnectCalls += 1 } }
    },
  })
  resizeCallback({ width: 480, height: 300 })
  assert.equal(canvas.width, 960)
  assert.equal(canvas.height, 600)

  const model = comparisonFrame({
    get zoom() {
      viewReads += 1
      assert.notEqual(phase, 'raf')
      return 1
    },
    get pan() {
      viewReads += 1
      assert.notEqual(phase, 'raf')
      return { x: 0, y: 0 }
    },
    frameSize: { w: 96, h: 96 },
    playing: false,
  })
  renderer.render(model)
  assert.equal(scheduled.size, 1)
  assert.equal(viewReads, 2)
  const [[id, draw]] = scheduled
  scheduled.delete(id)
  phase = 'raf'
  draw()
  phase = 'idle'

  assert.equal(viewReads, 2)
  assert.equal(observeCalls, 1)
  assert.equal(scheduled.size, 0)
  assert.deepEqual(calls.filter(([name]) => name === 'drawImage').at(-1).slice(-4), [192, 12, 576, 576])

  renderer.render({ ...comparisonFrame(), frameSize: { w: 96, h: 96 }, zoom: 0.5, pan: { x: 7, y: -5 }, playing: true })
  const [[playingId, playingDraw]] = scheduled
  scheduled.delete(playingId)
  phase = 'raf'
  playingDraw()
  phase = 'idle'
  assert.equal(scheduled.size, 1, 'only a playing selected sequence schedules another draw')
  assert.deepEqual(calls.filter(([name]) => name === 'drawImage').at(-1).slice(-4), [398, 194, 192, 192])

  const [pendingId] = scheduled.keys()
  renderer.destroy()
  assert.deepEqual(cancelled, [pendingId])
  assert.equal(disconnectCalls, 1)
  resizeCallback({ width: 700, height: 500 })
  renderer.render(comparisonFrame())
  assert.equal(scheduled.size, 0)
})

test('repair evidence maps real finishing report fields and keeps would_crop visible but non-blocking', () => {
  const report = {
    pixel_style: {
      metrics: { after: { unique_color_count: 12 } },
      palette_snap: { changed_pixel_ratio: 0.125 },
      halo_residue: {
        before: { near_white_edge_pixels: 7, semi_transparent_edge_pixels: 5 },
        after: { near_white_edge_pixels: 1, semi_transparent_edge_pixels: 2 },
      },
      outline: { outline_pixel_ratio: 0.04 },
      component_cleanup: { removed_components: 3, removed_pixels: 14 },
    },
    component_cleanup: { removed_components: 1, removed_pixels: 2 },
    anchor_tuning: {
      base_anchor: { x: 48, y: 88 },
      effective_anchor: { x: 49, y: 87 },
    },
    normalization: {
      motion_stabilization: { enabled: true, applied_count: 2, corrections: [] },
      manual_adjustments: { enabled: true, requested_count: 1, applied_count: 0, corrections: [] },
    },
    source_staging: { applied: false, method: null },
    validation: {
      status: 'warning',
      blocking_errors: [],
      warnings: ['dual_matte_inconsistent'],
      failure_taxonomy: { categories: [{ id: 'background.dual_matte' }] },
    },
    frames: [{
      index: 3,
      normalized_bbox: { x: 2, y: 4, w: 90, h: 90 },
      normalized_anchor: { x: 47, y: 88 },
      warnings: [],
      manual_adjustment: { applied: false, reason: 'would_crop', dx: 4, dy: 0 },
    }],
  }

  const evidence = normalizeRepairEvidence(report)

  assert.equal(evidence.validationStatus, 'warning')
  assert.equal(evidence.uniqueColors, 12)
  assert.equal(evidence.paletteChangedRatio, 0.125)
  assert.equal(evidence.haloBefore, 7)
  assert.equal(evidence.haloAfter, 1)
  assert.equal(evidence.residueBefore, 5)
  assert.equal(evidence.residueAfter, 2)
  assert.equal(evidence.outlineRatio, 0.04)
  assert.deepEqual(evidence.failureTaxonomy, ['background.dual_matte'])
  assert.deepEqual(evidence.framesByIndex['3'].anchor, { x: 47, y: 88 })
  assert.deepEqual(evidence.framesByIndex['3'].bbox, { x: 2, y: 4, w: 90, h: 90 })
  assert.deepEqual(evidence.manualAdjustments.wouldCrop, [
    { frame: 3, dx: 4, dy: 0, reason: 'would_crop' },
  ])
  assert.equal(evidence.validationStatus, 'warning', 'would_crop evidence must not become a validation failure')
  assert.ok(!evidence.failureTaxonomy.includes('structure.cropped'))
  assert.deepEqual(evidence.componentCleanup, { removed_components: 3, removed_pixels: 14 })
  assert.deepEqual(evidence.componentCleanupStages, {
    normalization: { removed_components: 1, removed_pixels: 2 },
    pixelFinishing: { removed_components: 3, removed_pixels: 14 },
  })
  assert.deepEqual(evidence.anchor, report.anchor_tuning)
  assert.equal(evidence.baseline, 87)
  assert.deepEqual(evidence.motionStabilization, report.normalization.motion_stabilization)
  assert.deepEqual(evidence.sourceStaging, report.source_staging)
  assert.deepEqual(evidence.warnings, ['dual_matte_inconsistent'])
  assert.deepEqual(evidence.missingMetrics, [])
})

test('repair evidence preserves a real blocking crop taxonomy and original blocking message', () => {
  const evidence = normalizeRepairEvidence({
    validation: {
      status: 'fail',
      blocking_errors: ['frame_3_cropped'],
      warnings: [],
      failure_taxonomy: { categories: [{ id: 'structure.cropped' }] },
    },
  })

  assert.equal(evidence.validationStatus, 'fail')
  assert.deepEqual(evidence.failureTaxonomy, ['structure.cropped', 'frame_3_cropped'])
})

test('empty taxonomy categories cannot erase blocking errors', () => {
  const evidence = normalizeRepairEvidence({
    validation: {
      status: 'fail',
      blocking_errors: ['frame_count_mismatch'],
      failure_taxonomy: { categories: [] },
    },
  })

  assert.deepEqual(evidence.failureTaxonomy, ['frame_count_mismatch'])
})

test('report-only pixel style uses its flat real metrics and preserves explicit zero', () => {
  const evidence = normalizeRepairEvidence({
    pixel_style: {
      mode: 'report_only',
      metrics: { unique_color_count: 0 },
      changed_pixel_ratio: 0,
      palette_snap: { changed_pixel_ratio: 0 },
      halo_residue: {
        before: { near_white_edge_pixels: 0, semi_transparent_edge_pixels: 0 },
        after: { near_white_edge_pixels: 0, semi_transparent_edge_pixels: 0 },
      },
      outline: { outline_pixel_ratio: 0 },
      component_cleanup: { removed_components: 0 },
    },
    anchor_tuning: { base_anchor: { x: 0, y: 0 }, effective_anchor: { x: 0, y: 0 } },
    component_cleanup: { removed_components: 0 },
    normalization: { motion_stabilization: { enabled: false, applied_count: 0 } },
    source_staging: { applied: false },
    validation: { status: 'pass', warnings: [], blocking_errors: [] },
  })

  assert.equal(evidence.uniqueColors, 0)
  assert.equal(evidence.paletteChangedRatio, 0)
  assert.equal(evidence.haloBefore, 0)
  assert.equal(evidence.haloAfter, 0)
  assert.equal(evidence.residueBefore, 0)
  assert.equal(evidence.residueAfter, 0)
  assert.equal(evidence.outlineRatio, 0)
  assert.equal(evidence.baseline, 0)
  assert.equal(evidence.missingMetrics.length, 0)
})

test('missing and malformed evidence stays null with metric_unavailable diagnostics, never fabricated zero', () => {
  for (const report of [undefined, null, false, 3, 'report', []]) {
    const evidence = normalizeRepairEvidence(report)
    assert.equal(evidence.validationStatus, 'unknown')
    assert.deepEqual(evidence.failureTaxonomy, [])
    assert.equal(evidence.uniqueColors, null)
    assert.equal(evidence.paletteChangedRatio, null)
    assert.equal(evidence.haloBefore, null)
    assert.equal(evidence.haloAfter, null)
    assert.equal(evidence.residueBefore, null)
    assert.equal(evidence.residueAfter, null)
    assert.equal(evidence.outlineRatio, null)
    assert.equal(evidence.componentCleanup, null)
    assert.equal(evidence.anchor, null)
    assert.equal(evidence.baseline, null)
    assert.equal(evidence.motionStabilization, null)
    assert.equal(evidence.sourceStaging, null)
    assert.ok(evidence.missingMetrics.length >= 12)
    assert.ok(evidence.missingMetrics.every((item) => item.code === 'metric_unavailable'))
    assert.equal(new Set(evidence.missingMetrics.map((item) => item.metric)).size, evidence.missingMetrics.length)
  }

  const invalid = normalizeRepairEvidence({
    pixel_style: {
      metrics: { after: { unique_color_count: -1 } },
      palette_snap: { changed_pixel_ratio: 1.1 },
      halo_residue: {
        before: { near_white_edge_pixels: '7', semi_transparent_edge_pixels: -2 },
        after: { near_white_edge_pixels: Number.NaN, semi_transparent_edge_pixels: 1.5 },
      },
      outline: { outline_pixel_ratio: -0.1 },
    },
    validation: { status: 'maybe', warnings: 'warning', blocking_errors: {} },
    frames: {},
  })
  assert.equal(invalid.validationStatus, 'unknown')
  assert.equal(invalid.uniqueColors, null)
  assert.equal(invalid.paletteChangedRatio, null)
  assert.equal(invalid.haloBefore, null)
  assert.equal(invalid.haloAfter, null)
  assert.equal(invalid.residueBefore, null)
  assert.equal(invalid.residueAfter, null)
  assert.equal(invalid.outlineRatio, null)
  assert.deepEqual(invalid.warnings, [])
  assert.deepEqual(invalid.framesByIndex, {})
})

test('empty evidence objects are unavailable rather than truthy fabricated structures', () => {
  const evidence = normalizeRepairEvidence({
    component_cleanup: {},
    anchor_tuning: {},
    normalization: { motion_stabilization: {} },
    source_staging: {},
  })

  assert.equal(evidence.componentCleanup, null)
  assert.equal(evidence.anchor, null)
  assert.equal(evidence.baseline, null)
  assert.equal(evidence.motionStabilization, null)
  assert.equal(evidence.sourceStaging, null)
  const missing = new Set(evidence.missingMetrics.map((item) => item.metric))
  for (const metric of [
    'component_cleanup',
    'anchor_tuning',
    'baseline',
    'motion_stabilization',
    'source_staging',
  ]) assert.ok(missing.has(metric))
})

test('would_crop normalization accepts only real unapplied integer requests and valid frame identities', () => {
  const evidence = normalizeRepairEvidence({
    frames: [
      { index: 0, manual_adjustment: { applied: false, reason: 'would_crop', dx: 0, dy: -1 } },
      { index: 1, manual_adjustment: { applied: true, reason: 'would_crop', dx: 1, dy: 0 } },
      { index: 2, manual_adjustment: { applied: false, reason: 'would_crop', dx: 1.5, dy: 0 } },
      { index: -1, manual_adjustment: { applied: false, reason: 'would_crop', dx: 1, dy: 0 } },
      { index: 3, manual_adjustment: { applied: false, reason: 'would_crop', dx: 17, dy: 0 } },
      { index: 4, manual_adjustment: { applied: false, reason: 'empty_frame', dx: 1, dy: 0 } },
    ],
  })

  assert.deepEqual(evidence.manualAdjustments.wouldCrop, [
    { frame: 0, dx: 0, dy: -1, reason: 'would_crop' },
  ])
})

test('frame evidence ignores malformed indices, keeps the first unique real frame, and sanitizes warnings', () => {
  const evidence = normalizeRepairEvidence({
    frames: [
      { index: 3, normalized_bbox: { x: 1, y: 2, w: 3, h: 4 }, normalized_anchor: { x: 2, y: 3 }, warnings: ['one', '', 3] },
      { index: 3, normalized_bbox: { x: 9 }, normalized_anchor: { x: 9 }, warnings: ['duplicate'] },
      { index: -1, warnings: ['negative'] },
      { index: '4', warnings: ['string'] },
      null,
    ],
    validation: { warnings: ['one', 'one'], blocking_errors: [] },
    background_warnings: ['two', 'one', null],
  })

  assert.deepEqual(evidence.framesByIndex, {
    3: {
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      anchor: { x: 2, y: 3 },
      warnings: ['one'],
    },
  })
  assert.deepEqual(evidence.warnings, ['one', 'two'])
})
