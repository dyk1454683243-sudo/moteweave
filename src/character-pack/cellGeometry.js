import { pixelOffset } from './imageMath.js'

function copyPixel(srcImage, dstImage, sx, sy, dx, dy) {
  if (sx < 0 || sy < 0 || sx >= srcImage.width || sy >= srcImage.height) return
  if (dx < 0 || dy < 0 || dx >= dstImage.width || dy >= dstImage.height) return
  const src = pixelOffset(srcImage.width, sx, sy)
  const dst = pixelOffset(dstImage.width, dx, dy)
  dstImage.data[dst] = srcImage.data[src]
  dstImage.data[dst + 1] = srcImage.data[src + 1]
  dstImage.data[dst + 2] = srcImage.data[src + 2]
  dstImage.data[dst + 3] = srcImage.data[src + 3]
}

export function expandCellCanvas(cell, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const width = cell.width + left + right
  const height = cell.height + top + bottom
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) copyPixel(cell, out, x, y, x + left, y + top)
  }
  return out
}

export function centerCropCell(cell, { width, height }) {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const srcX = Math.floor((cell.width - width) / 2)
  const srcY = Math.floor((cell.height - height) / 2)
  const dstX = Math.max(0, Math.floor((width - cell.width) / 2))
  const dstY = Math.max(0, Math.floor((height - cell.height) / 2))
  const copyW = Math.min(width, cell.width)
  const copyH = Math.min(height, cell.height)
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) copyPixel(cell, out, Math.max(0, srcX) + x, Math.max(0, srcY) + y, dstX + x, dstY + y)
  }
  return out
}
