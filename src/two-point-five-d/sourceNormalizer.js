import sharp from 'sharp'

function sanitizeId(value) {
  return String(value || 'manual_material_source').replace(/[^a-zA-Z0-9_-]/g, '_')
}

export async function normalizeTwoPointFiveDMaterialSource({
  sourceBuffer,
  sourceId = 'manual_material_source',
  targetSize = [1024, 1024],
} = {}) {
  if (!Buffer.isBuffer(sourceBuffer)) {
    throw new Error('sourceBuffer is required for 2.5D material source normalization')
  }
  const [targetWidth, targetHeight] = targetSize
  const inputMetadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata()
  const normalizedPng = await sharp(sourceBuffer, { failOn: 'none' })
    .rotate()
    .ensureAlpha()
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'fill',
      kernel: 'nearest',
    })
    .png()
    .toBuffer()
  const warnings = []
  if (inputMetadata.format !== 'png') warnings.push('source_format_normalized_to_png')
  if (inputMetadata.width !== targetWidth || inputMetadata.height !== targetHeight) warnings.push('source_size_normalized_to_target_canvas')

  return {
    normalizedPng,
    report: {
      schema_version: 1,
      mode: 'two_point_five_d_source_normalization_v0',
      status: warnings.length ? 'warning' : 'pass',
      source_id: sanitizeId(sourceId),
      input: {
        format: inputMetadata.format ?? 'unknown',
        width: inputMetadata.width ?? 0,
        height: inputMetadata.height ?? 0,
        has_alpha: Boolean(inputMetadata.hasAlpha),
        space: inputMetadata.space ?? 'unknown',
      },
      output: {
        artifact: 'normalized_material_source.png',
        format: 'png',
        width: targetWidth,
        height: targetHeight,
        channels: 4,
      },
      transform: {
        fit: 'fill',
        resize_kernel: 'nearest',
        alpha: 'ensure_alpha',
      },
      warnings,
    },
  }
}
