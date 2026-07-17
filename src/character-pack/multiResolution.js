import { encodeRgbaPng, resizeRgbaNearest } from './imageCodec.js'

export const DEFAULT_OUTPUT_FRAME_SIZES = Object.freeze([96, 64, 48, 32, 16])

export function resolveOutputFrameSizes(value = DEFAULT_OUTPUT_FRAME_SIZES) {
  const input = Array.isArray(value) ? value : DEFAULT_OUTPUT_FRAME_SIZES
  const sizes = input
    .map((size) => Number(size))
    .filter((size) => Number.isInteger(size) && size > 0)
  return [...new Set(sizes)].sort((a, b) => b - a)
}

function sheetSpec(profile, frameSize) {
  const frame = {
    w: frameSize,
    h: Math.round((frameSize * profile.frame.h) / profile.frame.w),
  }
  return {
    frame_size: frameSize,
    frame,
    sheet: {
      w: frame.w * profile.grid.columns,
      h: frame.h * profile.grid.rows,
    },
    file: `normalized_sheet_${frameSize}.png`,
  }
}

export function buildMultiResolutionManifest(profile, sizes = DEFAULT_OUTPUT_FRAME_SIZES) {
  return {
    version: 1,
    profile: profile.id,
    source_sheet: 'normalized_sheet.png',
    sheets: resolveOutputFrameSizes(sizes).map((size) => sheetSpec(profile, size)),
  }
}

export async function buildMultiResolutionArtifacts({ normalizedSheet, normalizedSheetPng, profile, sizes = DEFAULT_OUTPUT_FRAME_SIZES } = {}) {
  const manifest = buildMultiResolutionManifest(profile, sizes)
  const sheets = {}
  for (const spec of manifest.sheets) {
    if (spec.sheet.w === normalizedSheet.width && spec.sheet.h === normalizedSheet.height && normalizedSheetPng) {
      sheets[spec.frame_size] = normalizedSheetPng
      continue
    }
    const resized = await resizeRgbaNearest(normalizedSheet, { w: spec.sheet.w, h: spec.sheet.h })
    sheets[spec.frame_size] = await encodeRgbaPng(resized)
  }
  return { manifest, sheets }
}
