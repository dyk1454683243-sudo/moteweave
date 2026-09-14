import sharp from 'sharp'

const GENERATION_IMAGE_SIZES = Object.freeze({
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
})

const FIXED_REGION_TEMPLATE_SIZE = 256

export function sniffProviderImageMimeType(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? [])
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return 'image/gif'
  }
  return null
}

export function imageToDataUrl(image) {
  if (!image?.buffer) return null
  const mimeType = image.mimeType || image.mime_type || 'image/png'
  return `data:${mimeType};base64,${Buffer.from(image.buffer).toString('base64')}`
}

export function imageToInlineDataPart(image) {
  if (!image?.buffer) return null
  return {
    inline_data: {
      mime_type: image.mimeType || image.mime_type || 'image/png',
      data: Buffer.from(image.buffer).toString('base64'),
    },
  }
}

function parseGenerationImageSizePx(imageSize) {
  const normalized = String(imageSize || '')
    .trim()
    .toUpperCase()
  if (GENERATION_IMAGE_SIZES[normalized]) return GENERATION_IMAGE_SIZES[normalized]
  const kMatch = normalized.match(/^([1-9]\d*)K$/)
  if (kMatch) return Number(kMatch[1]) * 1024
  const numeric = Number.parseInt(normalized, 10)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function isFixedRegionTemplateContract(contract) {
  return contract?.layout_contract?.kind === 'fixed_regions' || contract?.promptContract?.layout_kind === 'fixed_regions'
}

async function prepareFixedRegionTemplate(templateImage) {
  const source = Buffer.from(templateImage.buffer)
  const metadata = await sharp(source).metadata()

  if (metadata.width === FIXED_REGION_TEMPLATE_SIZE && metadata.height === FIXED_REGION_TEMPLATE_SIZE) {
    return {
      ...templateImage,
      mimeType: 'image/png',
      mime_type: 'image/png',
      buffer: await sharp(source).png().toBuffer(),
    }
  }

  const pipeline = sharp(source).ensureAlpha()
  const buffer =
    metadata.width === 252 && metadata.height === 252
      ? await pipeline
        .extend({
          right: FIXED_REGION_TEMPLATE_SIZE - metadata.width,
          bottom: FIXED_REGION_TEMPLATE_SIZE - metadata.height,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()
      : await pipeline
        .resize(FIXED_REGION_TEMPLATE_SIZE, FIXED_REGION_TEMPLATE_SIZE, {
          fit: 'fill',
          kernel: sharp.kernel.nearest,
        })
        .png()
        .toBuffer()

  return {
    ...templateImage,
    mimeType: 'image/png',
    mime_type: 'image/png',
    buffer,
  }
}

export async function prepareTemplateImageForProvider(templateImage, { imageConfig, contract } = {}) {
  if (!templateImage?.buffer) return templateImage
  if (isFixedRegionTemplateContract(contract)) return prepareFixedRegionTemplate(templateImage)

  const targetSize = parseGenerationImageSizePx(imageConfig?.image_size)
  if (!targetSize) return templateImage

  const source = Buffer.from(templateImage.buffer)
  const metadata = await sharp(source).metadata()
  if (metadata.width === targetSize && metadata.height === targetSize) return templateImage

  const buffer = await sharp(source)
    .resize(targetSize, targetSize, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .png()
    .toBuffer()

  return {
    ...templateImage,
    mimeType: 'image/png',
    mime_type: 'image/png',
    buffer,
  }
}
