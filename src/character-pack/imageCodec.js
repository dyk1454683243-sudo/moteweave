import sharp from 'sharp'

export async function loadRgba(buffer, { limitInputPixels } = {}) {
  const image = sharp(
    buffer,
    Number.isSafeInteger(limitInputPixels) && limitInputPixels > 0
      ? { failOn: 'error', limitInputPixels }
      : undefined,
  ).ensureAlpha()
  const meta = await image.metadata()
  const data = await image.raw().toBuffer()
  const format = String(meta.format ?? 'unknown').toLowerCase()
  return {
    width: meta.width,
    height: meta.height,
    data: new Uint8ClampedArray(data),
    decode: {
      format,
      width: meta.width,
      height: meta.height,
      source_channels: meta.channels ?? null,
      source_has_alpha: meta.hasAlpha === true,
      lossy: format === 'jpeg' ? true : format === 'png' ? false : null,
    },
  }
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
