import sharp from 'sharp'

import { encodeGifFromRgbaFrames } from './character-pack/gifExport.js'
import { normalizeExportParams } from './pixelPipeline.js'

async function imageBufferToFrame(buffer, params) {
  const normalized = normalizeExportParams(params)
  const image = sharp(buffer).ensureAlpha()
  const metadata = await image.metadata()
  const sourceW = metadata.width || normalized.targetW
  const sourceH = metadata.height || normalized.targetH
  const innerW = Math.max(1, normalized.targetW - normalized.padding * 2)
  const innerH = Math.max(1, normalized.targetH - normalized.padding * 2)
  const scale = Math.min(innerW / sourceW, innerH / sourceH, 1)
  const resizedW = Math.max(1, Math.round(sourceW * scale))
  const resizedH = Math.max(1, Math.round(sourceH * scale))
  const resized = await image
    .resize(resizedW, resizedH, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .png()
    .toBuffer()
  const left = normalized.padding + Math.round((innerW - resizedW) / 2)
  const top = normalized.padding + Math.round((innerH - resizedH) / 2)
  const raw = await sharp({
    create: {
      width: normalized.targetW,
      height: normalized.targetH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .raw()
    .toBuffer()
  return {
    width: normalized.targetW,
    height: normalized.targetH,
    data: new Uint8ClampedArray(raw),
  }
}

export async function buildFrameGifFromImages(imageBuffers, params = {}) {
  if (!Array.isArray(imageBuffers) || imageBuffers.length === 0) {
    throw new Error('At least one frame is required to build a GIF')
  }
  const normalized = normalizeExportParams(params)
  const frames = []
  for (const buffer of imageBuffers) {
    frames.push(await imageBufferToFrame(buffer, normalized))
  }
  return encodeGifFromRgbaFrames(frames, { delay: Math.round(1000 / normalized.fps) })
}
