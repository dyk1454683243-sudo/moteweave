import gifenc from 'gifenc'
import sharp from 'sharp'

import { writeGifFrameFromRgba } from './character-pack/gifExport.js'
import { normalizeExportParams } from './pixelPipeline.js'

const { GIFEncoder } = gifenc

export const MAX_FRAME_GIF_FRAMES = 256
export const MAX_FRAME_GIF_EDGE = 4096
export const MAX_FRAME_GIF_UNCOMPRESSED_BYTES = 128 * 1024 * 1024

function readPngHeaderDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) return null
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (bytes.length < 24) return null
  if (
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
    || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

async function inspectFrameDimensions(buffer) {
  const pngDims = readPngHeaderDimensions(buffer)
  if (pngDims) return pngDims
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

async function imageBufferToFrame(buffer, normalized, sourceDimensions = null) {
  const image = sharp(buffer).ensureAlpha()
  const metadata = sourceDimensions || await image.metadata()
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
  if (imageBuffers.length > MAX_FRAME_GIF_FRAMES) {
    throw new Error(`GIF frame count exceeds maximum of ${MAX_FRAME_GIF_FRAMES}`)
  }
  const budgetBytes = Number.isInteger(params?.maxUncompressedBytes) && params.maxUncompressedBytes > 0
    ? Math.min(params.maxUncompressedBytes, MAX_FRAME_GIF_UNCOMPRESSED_BYTES)
    : MAX_FRAME_GIF_UNCOMPRESSED_BYTES
  const normalized = normalizeExportParams(params)
  if (normalized.targetW > MAX_FRAME_GIF_EDGE || normalized.targetH > MAX_FRAME_GIF_EDGE) {
    throw new Error(`GIF dimensions exceed maximum edge of ${MAX_FRAME_GIF_EDGE}`)
  }
  const targetFrameBytes = normalized.targetW * normalized.targetH * 4
  if (imageBuffers.length * targetFrameBytes > budgetBytes) {
    throw new Error('GIF frames exceed the 128 MiB uncompressed RGBA budget')
  }
  const inspectedDimensions = []
  let cumulativeSourceBytes = 0
  let cumulativeExpandedBytes = 0
  for (const buffer of imageBuffers) {
    const dims = await inspectFrameDimensions(buffer)
    if (!Number.isInteger(dims.width) || !Number.isInteger(dims.height) || dims.width < 1 || dims.height < 1) {
      throw new Error('Invalid frame dimensions for GIF export')
    }
    if (dims.width > MAX_FRAME_GIF_EDGE || dims.height > MAX_FRAME_GIF_EDGE) {
      throw new Error(`GIF source frame dimensions exceed maximum edge of ${MAX_FRAME_GIF_EDGE}`)
    }
    const sourceFrameBytes = dims.width * dims.height * 4
    cumulativeSourceBytes += sourceFrameBytes
    cumulativeExpandedBytes += Math.max(sourceFrameBytes, targetFrameBytes)
    if (cumulativeSourceBytes > budgetBytes || cumulativeExpandedBytes > budgetBytes) {
      throw new Error('GIF frames exceed the 128 MiB uncompressed RGBA budget')
    }
    inspectedDimensions.push(dims)
  }
  const delay = Math.round(1000 / normalized.fps)
  const gif = GIFEncoder()
  for (let i = 0; i < imageBuffers.length; i += 1) {
    params?.onFrameDecode?.(i, inspectedDimensions[i])
    const frame = await imageBufferToFrame(imageBuffers[i], normalized, inspectedDimensions[i])
    writeGifFrameFromRgba(gif, frame, { delay })
  }
  gif.finish()
  return Buffer.from(gif.bytes())
}
