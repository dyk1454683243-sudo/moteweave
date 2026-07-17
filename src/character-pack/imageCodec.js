import sharp from 'sharp'

export async function loadRgba(buffer) {
  const image = sharp(buffer).ensureAlpha()
  const meta = await image.metadata()
  const data = await image.raw().toBuffer()
  return { width: meta.width, height: meta.height, data: new Uint8ClampedArray(data) }
}

export async function encodeRgbaPng(image) {
  return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer()
}

export async function resizeRgbaNearest(image, size) {
  const { data, info } = await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize(size.w, size.h, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
}
