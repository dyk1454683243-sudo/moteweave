import { computeRepairViewport } from './repairComparisonRenderer.js'

const maskSourcesByDocument = new WeakMap()
const MASK_SOURCE_CACHE_LIMIT = 128

function integerPoint(value) {
  return Number.isInteger(value?.x) && Number.isInteger(value?.y)
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function canonicalRuns(mask) {
  if (!positiveInteger(mask?.width) || !positiveInteger(mask?.height) || !Array.isArray(mask.runs)) {
    throw new TypeError('Frame Repair mask dimensions and runs are required')
  }
  const pixelCount = mask.width * mask.height
  let previousEnd = -1
  return mask.runs.map((run) => {
    if (!Number.isInteger(run?.start) || run.start < 0 ||
        !positiveInteger(run?.length) || run.start >= pixelCount ||
        run.length > pixelCount - run.start || run.start <= previousEnd) {
      throw new RangeError('Frame Repair mask runs are invalid')
    }
    previousEnd = run.start + run.length - 1
    return { start: run.start, length: run.length }
  })
}

export function clientPointToFramePoint({
  clientX,
  clientY,
  canvasRect,
  frameSize,
  zoom,
  pan,
}) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) ||
      !Number.isFinite(canvasRect?.left) || !Number.isFinite(canvasRect?.top) ||
      !Number.isFinite(canvasRect?.width) || !Number.isFinite(canvasRect?.height)) {
    return null
  }
  const viewport = computeRepairViewport({
    canvasWidth: canvasRect.width,
    canvasHeight: canvasRect.height,
    frameSize,
    zoom,
    pan,
  })
  const x = Math.floor(((clientX - canvasRect.left - viewport.x) / viewport.w) * frameSize.w)
  const y = Math.floor(((clientY - canvasRect.top - viewport.y) / viewport.h) * frameSize.h)
  if (x < 0 || y < 0 || x >= frameSize.w || y >= frameSize.h) return null
  return { x, y }
}

export function rectangleFromFramePoints(start, end) {
  if (!integerPoint(start) || !integerPoint(end)) {
    throw new TypeError('Frame Repair rectangle points must use integer coordinates')
  }
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x) + 1,
    height: Math.abs(start.y - end.y) + 1,
  }
}

export function createFrameRepairMaskSource(mask, documentRef = globalThis.document) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('Frame Repair mask Canvas document is unavailable')
  }
  const runs = canonicalRuns(mask)
  const signature = `${mask.width}x${mask.height}:${mask.sha256 ?? ''}:${JSON.stringify(runs)}`
  if (!maskSourcesByDocument.has(documentRef)) maskSourcesByDocument.set(documentRef, new Map())
  const sources = maskSourcesByDocument.get(documentRef)
  if (sources.has(signature)) {
    const source = sources.get(signature)
    sources.delete(signature)
    sources.set(signature, source)
    return source
  }

  const canvas = documentRef.createElement('canvas')
  canvas.width = mask.width
  canvas.height = mask.height
  const context = canvas.getContext?.('2d')
  if (!context) throw new Error('Frame Repair mask Canvas context is unavailable')
  for (const run of runs) {
    for (let index = run.start; index < run.start + run.length; index += 1) {
      const x = index % mask.width
      const y = Math.floor(index / mask.width)
      context.fillStyle = (x + y) % 2 === 0
        ? 'rgba(117, 240, 211, 0.42)'
        : 'rgba(117, 240, 211, 0.28)'
      context.fillRect(x, y, 1, 1)
    }
  }
  if (sources.size >= MASK_SOURCE_CACHE_LIMIT) {
    sources.delete(sources.keys().next().value)
  }
  sources.set(signature, canvas)
  return canvas
}

export function drawFrameRepairOverlay(ctx, command, viewport, suppliedPixelRatio = 1) {
  if (!ctx || !command || !viewport) return
  const pixelRatio = Number.isFinite(suppliedPixelRatio) && suppliedPixelRatio > 0
    ? suppliedPixelRatio
    : 1
  if (command.type === 'frame_repair_mask' && command.source) {
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = 1
    ctx.drawImage(command.source, viewport.x, viewport.y, viewport.w, viewport.h)
    ctx.restore()
    return
  }
  if (command.type !== 'frame_repair_rectangle' || !command.rectangle) return
  const frameSize = command.frameSize ?? { w: 96, h: 96 }
  if (!positiveInteger(frameSize.w) || !positiveInteger(frameSize.h)) return
  const rectangle = command.rectangle
  if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite)) return
  const scaleX = viewport.w / frameSize.w
  const scaleY = viewport.h / frameSize.h
  const x = viewport.x + rectangle.x * scaleX
  const y = viewport.y + rectangle.y * scaleY
  const width = rectangle.width * scaleX
  const height = rectangle.height * scaleY
  const removing = command.op === 'remove_rectangle'

  ctx.save()
  ctx.strokeStyle = removing ? '#ffaaa4' : '#75f0d3'
  ctx.fillStyle = removing ? 'rgba(255, 170, 164, 0.08)' : 'rgba(117, 240, 211, 0.08)'
  ctx.lineWidth = (command.selected ? 2 : 1) * pixelRatio
  ctx.setLineDash(removing ? [4 * pixelRatio, 2 * pixelRatio] : [])
  ctx.fillRect(x, y, width, height)
  ctx.strokeRect(x, y, width, height)
  ctx.restore()
}
