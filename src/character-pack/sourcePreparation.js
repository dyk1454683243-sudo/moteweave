import {
  cleanupAlphaArtifactsFromRgba,
  cleanupEdgeMatteResidueFromRgba,
  cleanupSmallAlphaComponentsFromRgba,
  decontaminateEdgeColorsFromRgba,
  detectEdgeBackgroundPalette,
  dualMatteFromRgba,
  edgePaletteRemoveBackgroundFromRgba,
  floodRemoveBackgroundFromRgba,
  passthroughRgba,
} from './backgroundRemoval.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from './imageCodec.js'
import { cloneRgba, colorDistanceSq as pixelColorDistanceSq, pixelOffset } from './imageMath.js'
import { resolveBackgroundOptions, resolveComponentCleanupOptions, resolveFixedRegionSourceStagingOptions } from './processingOptions.js'

export async function preprocessSourceForLayout(raw, sourceLayout, options = {}) {
  const target = sourceLayout.sheet
  const baseReport = {
    applied: false,
    method: 'none',
    input_size: { w: raw.width, h: raw.height },
    output_size: { w: raw.width, h: raw.height },
    source_layout: sourceLayout.id,
  }
  if (options.sourcePreprocess === false || options.source_preprocess === false) {
    return { image: raw, report: { ...baseReport, disabled: true } }
  }
  if (sourceLayout.kind !== 'fixed_regions' || !target) return { image: raw, report: baseReport }
  if (raw.width === target.w && raw.height === target.h) return { image: raw, report: baseReport }

  const image = await resizeRgbaNearest(raw, target)
  return {
    image,
    report: {
      applied: true,
      method: 'fixed_region_resize',
      input_size: { w: raw.width, h: raw.height },
      output_size: { w: image.width, h: image.height },
      source_layout: sourceLayout.id,
    },
  }
}

function cropRgba(image, crop) {
  const width = image.width - crop.right
  const height = image.height - crop.bottom
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceStart = pixelOffset(image.width, 0, y)
    const targetStart = pixelOffset(width, 0, y)
    data.set(image.data.slice(sourceStart, sourceStart + width * 4), targetStart)
  }
  return { width, height, data }
}

function rgbAtCanvasLike(image, offset) {
  if (image.data[offset + 3] === 0) return [0, 0, 0]
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
}

function topLeftConnectedMatte(image, { tolerance = 80 } = {}) {
  const out = cloneRgba(image)
  const threshold = tolerance * tolerance
  const key = rgbAtCanvasLike(out, 0)
  const seen = new Uint8Array(out.width * out.height)
  const stack = [[0, 0]]
  let removedPixels = 0

  const matches = (offset) => {
    if (out.data[offset + 3] === 0) return true
    return pixelColorDistanceSq(out.data, offset, key) <= threshold
  }
  if (!matches(0)) return { image: out, removedPixels }

  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) continue
    const index = y * out.width + x
    if (seen[index]) continue
    seen[index] = 1
    const offset = pixelOffset(out.width, x, y)
    if (!matches(offset)) continue

    if (out.data[offset + 3] !== 0) removedPixels++
    out.data[offset + 3] = 0
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  return { image: out, removedPixels }
}

export async function stageFixedRegionSource(raw, sourceLayout, options = {}) {
  const staging = resolveFixedRegionSourceStagingOptions(options)
  const baseReport = {
    applied: false,
    method: 'none',
    input_size: { w: raw.width, h: raw.height },
    output_size: { w: raw.width, h: raw.height },
    source_layout: sourceLayout.id,
  }
  if (!staging.enabled || sourceLayout.kind !== 'fixed_regions') return { image: raw, report: baseReport }

  const resized = await resizeRgbaNearest(raw, { w: staging.stage_size, h: staging.stage_size })
  const matte = topLeftConnectedMatte(resized, { tolerance: staging.matte_tolerance })
  const cropped = cropRgba(matte.image, {
    right: staging.crop_right,
    bottom: staging.crop_bottom,
  })
  return {
    image: cropped,
    report: {
      applied: true,
      method: staging.mode,
      input_size: { w: raw.width, h: raw.height },
      stage_size: { w: resized.width, h: resized.height },
      output_size: { w: cropped.width, h: cropped.height },
      source_layout: sourceLayout.id,
      matte: {
        method: 'top_left_connected',
        tolerance: staging.matte_tolerance,
        removed_pixels: matte.removedPixels,
      },
      crop: {
        right: staging.crop_right,
        bottom: staging.crop_bottom,
      },
    },
  }
}

function colorDistanceSq(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function hasMultiColorEdgeBackground(raw) {
  const palette = detectEdgeBackgroundPalette(raw, { maxColors: 4 })
  return palette.some((color, index) => index > 0 && colorDistanceSq(color, palette[0]) > 30 * 30)
}

function edgePaletteOptions(backgroundOptions) {
  return {
    tolerance: backgroundOptions.tolerance,
    matteResidueCleanup: backgroundOptions.matte_residue_cleanup,
    residueTolerance: backgroundOptions.matte_residue_tolerance,
    residuePasses: backgroundOptions.matte_residue_passes,
    edgeDecontamination: backgroundOptions.edge_decontamination,
    edgeDecontaminationMaxDistance: backgroundOptions.edge_decontamination_max_distance,
    edgeDecontaminationStrength: backgroundOptions.edge_decontamination_strength,
  }
}

function dedupeColors(colors) {
  const seen = new Set()
  const result = []
  for (const color of colors) {
    if (!Array.isArray(color) || color.length < 3) continue
    const normalized = color.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
    const key = normalized.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function floodBackgroundPalette(raw, color) {
  return dedupeColors([
    color,
    ...detectEdgeBackgroundPalette(raw, { maxColors: 4 }),
  ])
}

function cleanFloodBackgroundResult(raw, backgroundOptions, { color = [255, 255, 255] } = {}) {
  const colors = floodBackgroundPalette(raw, color)
  const flooded = floodRemoveBackgroundFromRgba(raw, {
    color,
    tolerance: backgroundOptions.tolerance,
  })
  const residueCleaned = backgroundOptions.matte_residue_cleanup
    ? cleanupEdgeMatteResidueFromRgba(flooded, {
      colors,
      tolerance: backgroundOptions.tolerance,
      minDistance: backgroundOptions.tolerance,
      residueTolerance: backgroundOptions.matte_residue_tolerance,
      passes: backgroundOptions.matte_residue_passes,
    })
    : flooded
  const decontaminated = backgroundOptions.edge_decontamination
    ? decontaminateEdgeColorsFromRgba(residueCleaned, {
      colors,
      tolerance: backgroundOptions.tolerance,
      maxBackgroundDistance: backgroundOptions.edge_decontamination_max_distance,
      strength: backgroundOptions.edge_decontamination_strength,
    })
    : residueCleaned
  return cleanupAlphaArtifactsFromRgba(decontaminated, { minAlpha: backgroundOptions.cleanup_min_alpha })
}

export async function removeBackground(raw, options = {}) {
  const backgroundOptions = resolveBackgroundOptions(options)
  const requested = options.backgroundMode ?? 'auto'
  if (requested === 'passthrough') return { image: passthroughRgba(raw), mode: 'passthrough', warnings: [] }
  if (requested === 'edge_palette') {
    return {
      image: cleanupAlphaArtifactsFromRgba(edgePaletteRemoveBackgroundFromRgba(raw, edgePaletteOptions(backgroundOptions)), { minAlpha: backgroundOptions.cleanup_min_alpha }),
      mode: 'edge_palette',
      warnings: [],
      options: backgroundOptions,
    }
  }

  if (requested === 'dual_matte') {
    if (!options.blackSourceBuffer) {
      return {
        image: cleanFloodBackgroundResult(raw, backgroundOptions),
        mode: 'flood',
        warnings: ['dual_matte_missing_source'],
        options: backgroundOptions,
      }
    }
    const black = await loadRgba(options.blackSourceBuffer)
    const result = dualMatteFromRgba(raw, black)
    if (result.warnings.includes('dual_matte_inconsistent')) {
      return {
        image: cleanFloodBackgroundResult(raw, backgroundOptions),
        mode: 'flood',
        warnings: result.warnings,
        options: backgroundOptions,
      }
    }
    return { image: cleanupAlphaArtifactsFromRgba(result.image, { minAlpha: backgroundOptions.cleanup_min_alpha }), mode: 'dual_matte', warnings: result.warnings, options: backgroundOptions }
  }

  if (requested === 'auto' && raw.data.some((_, i) => i % 4 === 3 && raw.data[i] < 255)) {
    return { image: cleanupAlphaArtifactsFromRgba(raw, { minAlpha: backgroundOptions.cleanup_min_alpha }), mode: 'alpha_cleanup', warnings: [], options: backgroundOptions }
  }

  if (requested === 'auto' && hasMultiColorEdgeBackground(raw)) {
    return {
      image: cleanupAlphaArtifactsFromRgba(edgePaletteRemoveBackgroundFromRgba(raw, edgePaletteOptions(backgroundOptions)), { minAlpha: backgroundOptions.cleanup_min_alpha }),
      mode: 'edge_palette',
      warnings: [],
      options: backgroundOptions,
    }
  }

  return {
    image: cleanFloodBackgroundResult(raw, backgroundOptions),
    mode: 'flood',
    warnings: [],
    options: backgroundOptions,
  }
}

export function cleanupCellComponents(cells, options = {}) {
  const cleanupOptions = resolveComponentCleanupOptions(options)
  if (!cleanupOptions.enabled) {
    return {
      cells,
      summary: {
        enabled: false,
        min_area: cleanupOptions.min_area,
        min_area_ratio: cleanupOptions.min_area_ratio,
        cells_changed: 0,
        removed_components: 0,
        removed_pixels: 0,
      },
    }
  }

  let cellsChanged = 0
  let removedComponents = 0
  let removedPixels = 0
  const cleanedCells = cells.map((cell) => {
    const result = cleanupSmallAlphaComponentsFromRgba(cell.image, {
      minArea: cleanupOptions.min_area,
      minAreaRatio: cleanupOptions.min_area_ratio,
    })
    if (result.stats.removed_pixels > 0) cellsChanged++
    removedComponents += result.stats.removed_components
    removedPixels += result.stats.removed_pixels
    return { ...cell, image: result.image }
  })

  return {
    cells: cleanedCells,
    summary: {
      enabled: true,
      min_area: cleanupOptions.min_area,
      min_area_ratio: cleanupOptions.min_area_ratio,
      cells_changed: cellsChanged,
      removed_components: removedComponents,
      removed_pixels: removedPixels,
    },
  }
}

export async function prepareSourceForProcessing(buffer, sourceLayout, options = {}) {
  const loadedRaw = await loadRgba(buffer)
  const sourceStaging = await stageFixedRegionSource(loadedRaw, sourceLayout, options)
  const sourcePreprocess = await preprocessSourceForLayout(sourceStaging.image, sourceLayout, options)
  const raw = sourcePreprocess.image
  const sourcePng = await encodeRgbaPng(raw)
  const background = await removeBackground(raw, options)
  return {
    loadedRaw,
    sourceStaging,
    sourcePreprocess,
    raw,
    sourcePng,
    background,
    backgroundMode: background.mode,
    transparent: background.image,
  }
}
