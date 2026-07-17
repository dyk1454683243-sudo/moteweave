import { pixelOffset } from './imageMath.js'

export function detectAlphaBBox(image) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[pixelOffset(image.width, x, y) + 3] > 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX < 0) return null
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  return { x: minX, y: minY, w, h, right: maxX, bottom: maxY, centerX: minX + w / 2, centerY: minY + h / 2 }
}

export function detectFootAnchor(image, bbox = detectAlphaBBox(image)) {
  if (!bbox) return null
  const bandHeight = Math.max(3, Math.round(bbox.h * 0.22))
  const startY = Math.max(bbox.y, bbox.bottom - bandHeight + 1)
  let total = 0
  let weightedX = 0
  for (let y = startY; y <= bbox.bottom; y++) {
    for (let x = bbox.x; x <= bbox.right; x++) {
      const offset = pixelOffset(image.width, x, y)
      const alpha = image.data[offset + 3]
      if (!alpha) continue
      total += alpha
      weightedX += x * alpha
    }
  }
  const x = total ? Math.round(weightedX / total) : Math.round(bbox.centerX)
  return { x, y: bbox.bottom, mode: 'lower-body-foot' }
}

function pasteNearest(src, dst, srcBox, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(srcBox.w * scale))
  const outH = Math.max(1, Math.round(srcBox.h * scale))
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = srcBox.x + Math.min(srcBox.w - 1, Math.floor(x / scale))
      const sy = srcBox.y + Math.min(srcBox.h - 1, Math.floor(y / scale))
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const s = pixelOffset(src.width, sx, sy)
      const d = pixelOffset(dst.width, tx, ty)
      dst.data[d] = src.data[s]
      dst.data[d + 1] = src.data[s + 1]
      dst.data[d + 2] = src.data[s + 2]
      dst.data[d + 3] = src.data[s + 3]
    }
  }
}

function resolveSourceAnchor(cell, bbox) {
  const templateAnchor = cell.meta?.template_anchor
  if (templateAnchor && Number.isFinite(templateAnchor.x) && Number.isFinite(templateAnchor.y)) return templateAnchor
  return detectFootAnchor(cell.image, bbox)
}

export function normalizeCells(cells, profile) {
  const bboxes = cells.map((cell) => detectAlphaBBox(cell.image))
  const anchors = cells.map((cell, index) => resolveSourceAnchor(cell, bboxes[index]))
  const maxH = Math.max(1, ...bboxes.filter(Boolean).map((bbox) => bbox.h))
  const maxW = Math.max(1, ...bboxes.filter(Boolean).map((bbox) => bbox.w))
  const scale = Math.min(1, (profile.frame.h - 8) / maxH, (profile.frame.w - 8) / maxW)
  const frames = cells.map((cell, index) => {
    const bbox = bboxes[index]
    const sourceAnchor = anchors[index]
    const image = { width: profile.frame.w, height: profile.frame.h, data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4) }
    if (!bbox) return { index, source_meta: cell.meta ?? null, source_bbox: null, source_anchor: null, normalized_bbox: null, normalized_anchor: null, image, warnings: ['empty_frame'] }
    const scaledW = Math.round(bbox.w * scale)
    const scaledH = Math.round(bbox.h * scale)
    const anchorOffsetX = sourceAnchor ? (sourceAnchor.x - bbox.x) * scale : scaledW / 2
    const anchorOffsetY = sourceAnchor ? (sourceAnchor.y - bbox.y) * scale : scaledH - 1
    const dstX = Math.round(profile.anchor.x - anchorOffsetX)
    const dstY = Math.round(profile.anchor.y - anchorOffsetY)
    pasteNearest(cell.image, image, bbox, dstX, dstY, scale)
    const normalized_bbox = detectAlphaBBox(image)
    return {
      index,
      source_meta: cell.meta ?? null,
      source_bbox: bbox,
      source_anchor: sourceAnchor,
      normalized_bbox,
      normalized_anchor: detectFootAnchor(image, normalized_bbox),
      image,
      warnings: [],
    }
  })
  return { frames, scale }
}
