function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function assertFrameGeometry(frameSize, sheetSize) {
  if (!positiveInteger(frameSize?.w) || !positiveInteger(frameSize?.h) ||
      !positiveInteger(sheetSize?.w) || !positiveInteger(sheetSize?.h) ||
      sheetSize.w < frameSize.w || sheetSize.h < frameSize.h ||
      sheetSize.w % frameSize.w !== 0 || sheetSize.h % frameSize.h !== 0) {
    throw new RangeError('sheet dimensions must contain a whole frame grid')
  }
}

export function resolveSheetFrameRect({ frameIndex, frameSize, sheetSize }) {
  assertFrameGeometry(frameSize, sheetSize)
  const columns = sheetSize.w / frameSize.w
  const rows = sheetSize.h / frameSize.h
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= columns * rows) {
    throw new RangeError('frame index is outside the sheet')
  }
  return {
    sx: (frameIndex % columns) * frameSize.w,
    sy: Math.floor(frameIndex / columns) * frameSize.h,
    sw: frameSize.w,
    sh: frameSize.h,
  }
}

function assertFrameRect(source, rect) {
  if (!source || !positiveInteger(source.width) || !positiveInteger(source.height) ||
      !Number.isInteger(rect?.sx) || rect.sx < 0 ||
      !Number.isInteger(rect?.sy) || rect.sy < 0 ||
      !positiveInteger(rect?.sw) || !positiveInteger(rect?.sh) ||
      rect.sx + rect.sw > source.width || rect.sy + rect.sh > source.height) {
    throw new RangeError('frame rect is outside the source')
  }
}

export function readRepairFramePixels(source, rect, documentRef = globalThis.document) {
  assertFrameRect(source, rect)
  const canvas = documentRef?.createElement?.('canvas')
  if (!canvas) throw new Error('canvas document is unavailable')
  canvas.width = rect.sw
  canvas.height = rect.sh
  const ctx = canvas.getContext?.('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas context is unavailable')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
  return ctx.getImageData(0, 0, rect.sw, rect.sh)
}

export function buildRepairOverlayCommands({
  anchor,
  baselineY,
  bbox,
  cutColumns = [],
  cutRows = [],
} = {}) {
  const columns = Array.isArray(cutColumns) ? cutColumns.filter(Number.isFinite) : []
  const rows = Array.isArray(cutRows) ? cutRows.filter(Number.isFinite) : []
  const validAnchor = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)
  const validBbox = Number.isFinite(bbox?.x) && Number.isFinite(bbox?.y) &&
    Number.isFinite(bbox?.w) && bbox.w > 0 && Number.isFinite(bbox?.h) && bbox.h > 0
  return [
    ...columns.map((x) => ({ type: 'line', x1: x, y1: 0, x2: x, y2: 'height', style: 'cut' })),
    ...rows.map((y) => ({ type: 'line', x1: 0, y1: y, x2: 'width', y2: y, style: 'cut' })),
    ...(validAnchor ? [{ type: 'anchor', x: anchor.x, y: anchor.y }] : []),
    ...(Number.isFinite(baselineY)
      ? [{ type: 'line', x1: 0, y1: baselineY, x2: 'width', y2: baselineY, style: 'baseline' }]
      : []),
    ...(validBbox ? [{ type: 'rect', ...bbox, style: 'bbox' }] : []),
  ]
}

function repairFrameDescriptor(source, explicitRect, explicitRectProvided = false) {
  const wrapper = Boolean(source) && typeof source === 'object' &&
    (Object.hasOwn(source, 'source') || Object.hasOwn(source, 'image'))
  const actualSource = wrapper
    ? Object.hasOwn(source, 'source') ? source.source : source.image
    : source
  if (!actualSource || !positiveInteger(actualSource.width) || !positiveInteger(actualSource.height)) {
    return null
  }
  const wrapperRectProvided = wrapper && Object.hasOwn(source, 'rect')
  const actualRect = explicitRectProvided
    ? explicitRect
    : wrapperRectProvided
      ? source.rect
      : { sx: 0, sy: 0, sw: actualSource.width, sh: actualSource.height }
  if (actualRect == null) return null
  try {
    assertFrameRect(actualSource, actualRect)
  } catch {
    return null
  }
  return { source: actualSource, rect: actualRect, width: actualRect.sw, height: actualRect.sh }
}

export function getRepairComparisonAvailability(input = {}) {
  const value = input && typeof input === 'object' ? input : {}
  const beforeFrame = repairFrameDescriptor(
    value.before,
    value.beforeRect,
    Object.hasOwn(value, 'beforeRect'),
  )
  const afterFrame = repairFrameDescriptor(
    value.after,
    value.afterRect,
    Object.hasOwn(value, 'afterRect'),
  )
  const sameSize = Boolean(
    beforeFrame && afterFrame &&
    beforeFrame.width === afterFrame.width && beforeFrame.height === afterFrame.height,
  )
  return {
    before: { enabled: Boolean(beforeFrame), reason: beforeFrame ? null : 'before_frame_unavailable' },
    after: { enabled: Boolean(afterFrame), reason: afterFrame ? null : 'after_frame_unavailable' },
    split: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
    difference: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
    onion: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
  }
}

function assertPixelBuffer(value) {
  return positiveInteger(value?.width) && positiveInteger(value?.height) &&
    value.data instanceof Uint8ClampedArray && value.data.length === value.width * value.height * 4
}

function assertComparablePixelBuffers(before, after) {
  if (!assertPixelBuffer(before) || !assertPixelBuffer(after) ||
      before.width !== after.width || before.height !== after.height) {
    throw new Error('comparison_size_mismatch')
  }
}

export function buildDifferencePixels(
  before,
  after,
  createImageData = (data, width, height) => new ImageData(data, width, height),
) {
  assertComparablePixelBuffers(before, after)
  const data = new Uint8ClampedArray(before.data.length)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.abs(before.data[index] - after.data[index])
    data[index + 1] = Math.abs(before.data[index + 1] - after.data[index + 1])
    data[index + 2] = Math.abs(before.data[index + 2] - after.data[index + 2])
    data[index + 3] = 255
  }
  return createImageData(data, before.width, before.height)
}

export function analyzeRepairDifferencePixels(before, after) {
  assertComparablePixelBuffers(before, after)
  let alphaChangedPixelCount = 0
  let alphaOnlyChangedPixelCount = 0
  let transparentRgbOnlyChangedPixelCount = 0
  for (let index = 0; index < before.data.length; index += 4) {
    const rgbChanged = before.data[index] !== after.data[index] ||
      before.data[index + 1] !== after.data[index + 1] ||
      before.data[index + 2] !== after.data[index + 2]
    const alphaChanged = before.data[index + 3] !== after.data[index + 3]
    if (alphaChanged) alphaChangedPixelCount += 1
    if (alphaChanged && !rgbChanged) alphaOnlyChangedPixelCount += 1
    if (!alphaChanged && before.data[index + 3] === 0 && rgbChanged) {
      transparentRgbOnlyChangedPixelCount += 1
    }
  }
  const diagnostics = []
  if (alphaOnlyChangedPixelCount > 0) {
    diagnostics.push({
      code: 'difference_alpha_only_change',
      pixelCount: alphaOnlyChangedPixelCount,
    })
  }
  if (transparentRgbOnlyChangedPixelCount > 0) {
    diagnostics.push({
      code: 'difference_transparent_rgb_only',
      pixelCount: transparentRgbOnlyChangedPixelCount,
    })
  }
  return {
    alphaChangedPixelCount,
    alphaOnlyChangedPixelCount,
    transparentRgbOnlyChangedPixelCount,
    diagnostics,
  }
}

export function createRepairDifferenceSource(imageData, documentRef = globalThis.document) {
  if (!assertPixelBuffer(imageData)) throw new Error('comparison_size_mismatch')
  const canvas = documentRef?.createElement?.('canvas')
  if (!canvas) throw new Error('canvas document is unavailable')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext?.('2d')
  if (!context) throw new Error('canvas context is unavailable')
  context.putImageData(imageData, 0, 0)
  return canvas
}

export function computeRepairViewport({
  canvasWidth,
  canvasHeight,
  frameSize,
  zoom = 1,
  pan = { x: 0, y: 0 },
}) {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 ||
      !Number.isFinite(canvasHeight) || canvasHeight <= 0 ||
      !positiveInteger(frameSize?.w) || !positiveInteger(frameSize?.h)) {
    throw new RangeError('comparison viewport dimensions must be positive')
  }
  const fitScale = Math.max(1, Math.floor(Math.min(canvasWidth / frameSize.w, canvasHeight / frameSize.h)))
  const normalizedZoom = Number.isFinite(zoom) ? Math.max(0.25, Math.min(4, zoom)) : 1
  const scale = Math.max(1, Math.floor(fitScale * normalizedZoom))
  const w = frameSize.w * scale
  const h = frameSize.h * scale
  const panX = Number.isFinite(pan?.x) ? pan.x : 0
  const panY = Number.isFinite(pan?.y) ? pan.y : 0
  return {
    x: Math.round((canvasWidth - w) / 2 + panX),
    y: Math.round((canvasHeight - h) / 2 + panY),
    w,
    h,
  }
}

function clampUnit(value, fallback) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : fallback))
}

function comparisonModeReady(frame, beforeFrame, afterFrame) {
  const sameSize = Boolean(
    beforeFrame && afterFrame &&
    beforeFrame.width === afterFrame.width && beforeFrame.height === afterFrame.height,
  )
  const availability = {
    before: Boolean(beforeFrame),
    after: Boolean(afterFrame),
    split: sameSize,
    difference: sameSize,
    onion: sameSize,
  }
  if (frame.mode === 'difference' && availability.difference) {
    return Boolean(
      frame.differenceSource &&
      frame.differenceSource.width === beforeFrame.width &&
      frame.differenceSource.height === beforeFrame.height,
    )
  }
  return availability[frame.mode] === true
}

function renderEmptyComparison(ctx, frame, width, height) {
  const message = frame.emptyMessage || `${frame.mode || 'comparison'}_frame_unavailable`
  ctx.fillStyle = '#8b93a7'
  ctx.textAlign = 'center'
  ctx.fillText(message, width / 2, height / 2)
}

export function renderRepairComparisonFrame(ctx, frame = {}) {
  const { width, height } = ctx.canvas
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  const beforeFrame = repairFrameDescriptor(
    frame.before,
    frame.beforeRect,
    Object.hasOwn(frame, 'beforeRect'),
  )
  const afterFrame = repairFrameDescriptor(
    frame.after,
    frame.afterRect,
    Object.hasOwn(frame, 'afterRect'),
  )
  if (!comparisonModeReady(frame, beforeFrame, afterFrame)) {
    renderEmptyComparison(ctx, frame, width, height)
    return
  }

  const draw = (source, rect, { alpha = 1, clipX = 0, clipWidth = width } = {}) => {
    ctx.save()
    ctx.globalAlpha = clampUnit(alpha, 1)
    ctx.beginPath()
    ctx.rect(clipX, 0, clipWidth, height)
    ctx.clip()
    ctx.drawImage(
      source,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      frame.viewport.x,
      frame.viewport.y,
      frame.viewport.w,
      frame.viewport.h,
    )
    ctx.restore()
  }

  if (frame.mode === 'before') draw(beforeFrame.source, beforeFrame.rect)
  if (frame.mode === 'after') draw(afterFrame.source, afterFrame.rect)
  if (frame.mode === 'split') {
    const divider = clampUnit(frame.split, 0.5) * width
    draw(beforeFrame.source, beforeFrame.rect, { clipWidth: divider })
    draw(afterFrame.source, afterFrame.rect, { clipX: divider, clipWidth: width - divider })
  }
  if (frame.mode === 'onion') {
    draw(beforeFrame.source, beforeFrame.rect)
    draw(afterFrame.source, afterFrame.rect, { alpha: clampUnit(frame.onionAlpha, 0.5) })
  }
  if (frame.mode === 'difference') {
    draw(frame.differenceSource, {
      sx: 0,
      sy: 0,
      sw: frame.differenceSource.width,
      sh: frame.differenceSource.height,
    })
  }
  if (Array.isArray(frame.overlayCommands) && typeof frame.drawOverlay === 'function') {
    const pixelRatio = normalizedPixelRatio(frame.pixelRatio)
    for (const command of frame.overlayCommands) {
      frame.drawOverlay(ctx, command, frame.viewport, pixelRatio)
    }
  }
}

function normalizedPixelRatio(value) {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function createRepairComparisonRenderer({
  canvas,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  observeResize,
  pixelRatio = globalThis.devicePixelRatio ?? 1,
} = {}) {
  const ctx = canvas?.getContext?.('2d')
  if (!ctx) throw new Error('comparison canvas context is unavailable')
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('comparison animation callbacks are required')
  }
  const ratio = normalizedPixelRatio(pixelRatio)
  let cssWidth = canvas.width / ratio
  let cssHeight = canvas.height / ratio
  let model = null
  let raf = null
  let destroyed = false

  const withViewport = (next) => {
    const snapshot = { ...next }
    const cssPan = snapshot.pan ?? { x: 0, y: 0 }
    const cssViewport = computeRepairViewport({
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      frameSize: snapshot.frameSize,
      zoom: snapshot.zoom,
      pan: {
        x: Number.isFinite(cssPan.x) ? cssPan.x : 0,
        y: Number.isFinite(cssPan.y) ? cssPan.y : 0,
      },
    })
    snapshot.viewport = Object.fromEntries(
      Object.entries(cssViewport).map(([key, value]) => [key, Math.round(value * ratio)]),
    )
    snapshot.pixelRatio = ratio
    return snapshot
  }
  const draw = () => {
    raf = null
    if (destroyed || !model) return
    renderRepairComparisonFrame(ctx, model)
    if (model.playing && !destroyed) raf = requestFrame(draw)
  }
  const schedule = () => {
    if (!destroyed && model && raf == null) raf = requestFrame(draw)
  }
  const onResize = ({ width, height } = {}) => {
    if (destroyed || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return
    cssWidth = width
    cssHeight = height
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    if (model) model = withViewport(model)
    schedule()
  }
  const startObserver = typeof observeResize === 'function'
    ? observeResize
    : (callback) => {
        if (typeof globalThis.ResizeObserver !== 'function') return { disconnect() {} }
        const observer = new globalThis.ResizeObserver((entries) => callback(entries[0]?.contentRect))
        observer.observe(canvas)
        return observer
      }
  const resizeObserver = startObserver(onResize)
  if (!resizeObserver || typeof resizeObserver.disconnect !== 'function') {
    throw new TypeError('comparison resize observer must be disconnectable')
  }

  return Object.freeze({
    render(next) {
      if (destroyed) return
      model = withViewport(next)
      schedule()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (raf != null) cancelFrame(raf)
      raf = null
      resizeObserver.disconnect()
      model = null
    },
  })
}
