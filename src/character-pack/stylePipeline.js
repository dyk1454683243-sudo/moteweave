import { cleanupAlphaArtifactsFromRgba, cleanupSmallAlphaComponentsFromRgba } from './backgroundRemoval.js'
import { cloneRgba, colorDistanceSq, pixelOffset } from './imageMath.js'

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function hexForRgb(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function normalizePaletteColor(color) {
  const rgb = color?.rgb ?? color
  if (!Array.isArray(rgb) || rgb.length < 3) throw new Error('palette colors must include rgb values')
  return [rgb[0], rgb[1], rgb[2]].map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
}

function collectVisibleColors(image, { alphaThreshold = 1 } = {}) {
  const counts = new Map()
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] < alphaThreshold) continue
      const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([key, count]) => {
    const [r, g, b] = key.split(',').map(Number)
    return { rgb: [r, g, b], count }
  })
}

function channelRange(colors, channel) {
  if (!colors.length) return 0
  let min = colors[0].rgb[channel]
  let max = min
  for (let i = 1; i < colors.length; i++) {
    const value = colors[i].rgb[channel]
    if (value < min) min = value
    if (value > max) max = value
  }
  return max - min
}

function widestChannel(colors) {
  const ranges = [0, 1, 2].map((channel) => ({ channel, range: channelRange(colors, channel) }))
  ranges.sort((a, b) => b.range - a.range || a.channel - b.channel)
  return ranges[0].channel
}

function totalCount(colors) {
  return colors.reduce((sum, color) => sum + color.count, 0)
}

function splitBox(colors) {
  const channel = widestChannel(colors)
  const sorted = colors
    .slice()
    .sort((a, b) => a.rgb[channel] - b.rgb[channel] || a.rgb[0] - b.rgb[0] || a.rgb[1] - b.rgb[1] || a.rgb[2] - b.rgb[2])
  const half = totalCount(sorted) / 2
  let running = 0
  let splitIndex = 1
  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].count
    if (running >= half) {
      splitIndex = i + 1
      break
    }
  }
  return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)]
}

function representativeColor(colors, visibleCount) {
  const count = totalCount(colors)
  const rgb = [0, 1, 2].map((channel) => Math.round(colors.reduce((sum, color) => sum + color.rgb[channel] * color.count, 0) / count))
  return {
    hex: hexForRgb(rgb),
    rgb,
    count,
    ratio: visibleCount ? round(count / visibleCount) : 0,
  }
}

export function extractPalette(image, { maxColors = 16, alphaThreshold = 1 } = {}) {
  const limit = Number(maxColors)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('maxColors must be a positive integer')
  const colors = collectVisibleColors(image, { alphaThreshold })
  const visibleCount = totalCount(colors)
  if (!colors.length) return []

  let boxes = [colors]
  while (boxes.length < limit) {
    const candidates = boxes
      .map((colors, index) => ({ index, colors, range: Math.max(channelRange(colors, 0), channelRange(colors, 1), channelRange(colors, 2)), count: totalCount(colors) }))
      .filter((box) => box.colors.length > 1)
      .sort((a, b) => b.range - a.range || b.count - a.count || a.index - b.index)
    if (!candidates.length) break
    const target = candidates[0]
    const [left, right] = splitBox(target.colors)
    boxes = boxes.flatMap((colors, index) => (index === target.index ? [left, right].filter((box) => box.length) : [colors]))
  }

  return boxes
    .map((box) => representativeColor(box, visibleCount))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}

function nearestPaletteColor(data, offset, palette) {
  let best = palette[0]
  let bestDistance = colorDistanceSq(data, offset, best)
  for (let i = 1; i < palette.length; i++) {
    const distance = colorDistanceSq(data, offset, palette[i])
    if (distance < bestDistance) {
      best = palette[i]
      bestDistance = distance
    }
  }
  return best
}

function countChangedPixels(before, after) {
  const length = Math.min(before.data.length, after.data.length)
  let total = 0
  let changed = 0
  for (let offset = 0; offset < length; offset += 4) {
    total += 1
    if (
      before.data[offset] !== after.data[offset] ||
      before.data[offset + 1] !== after.data[offset + 1] ||
      before.data[offset + 2] !== after.data[offset + 2] ||
      before.data[offset + 3] !== after.data[offset + 3]
    ) {
      changed += 1
    }
  }
  return { total, changed }
}

export function snapToPalette(image, { palette, alphaThreshold = 1 } = {}) {
  const colors = (palette ?? []).map(normalizePaletteColor)
  if (!colors.length) throw new Error('palette is required')
  const output = cloneRgba(image)
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const offset = pixelOffset(output.width, x, y)
      if (output.data[offset + 3] < alphaThreshold) continue
      const rgb = nearestPaletteColor(output.data, offset, colors)
      output.data[offset] = rgb[0]
      output.data[offset + 1] = rgb[1]
      output.data[offset + 2] = rgb[2]
    }
  }
  return output
}

export function applyPixelStyleCorrection(image, {
  mode = 'palette_snap',
  palette,
  maxColors = 16,
  alphaThreshold = 1,
} = {}) {
  if (mode !== 'palette_snap') throw new Error(`Unsupported pixel style correction mode: ${mode}`)
  const hasProvidedPalette = Array.isArray(palette) && palette.length > 0
  const colors = hasProvidedPalette
    ? palette.map((color) => {
      const rgb = normalizePaletteColor(color)
      return { hex: hexForRgb(rgb), rgb }
    })
    : extractPalette(image, { maxColors, alphaThreshold })
  if (!colors.length) {
    return {
      image: cloneRgba(image),
      report: {
        mode,
        output_mutation: 'none',
        palette: {
          source: hasProvidedPalette ? 'provided' : 'extracted',
          max_colors: maxColors,
          colors,
        },
        metrics: { before: null, after: null },
        changed_pixel_count: 0,
        changed_pixel_ratio: 0,
      },
    }
  }

  const before = measureStyleDrift(image, { palette: colors, alphaThreshold })
  const corrected = snapToPalette(image, { palette: colors, alphaThreshold })
  const after = measureStyleDrift(corrected, { palette: colors, alphaThreshold })
  const changed = countChangedPixels(image, corrected)
  return {
    image: corrected,
    report: {
      mode,
      output_mutation: 'palette_snap',
      palette: {
        source: hasProvidedPalette ? 'provided' : 'extracted',
        max_colors: maxColors,
        colors,
      },
      metrics: { before, after },
      changed_pixel_count: changed.changed,
      changed_pixel_ratio: changed.total ? round(changed.changed / changed.total) : 0,
    },
  }
}

export function downsampleNearest(image, { factor } = {}) {
  const scale = Number(factor)
  if (!Number.isInteger(scale) || scale < 1) throw new Error('downsampleNearest requires a positive integer factor')
  if (image.width % scale !== 0 || image.height % scale !== 0) throw new Error('image dimensions must be divisible by the integer factor')
  const width = image.width / scale
  const height = image.height / scale
  const output = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = pixelOffset(image.width, x * scale, y * scale)
      const dst = pixelOffset(width, x, y)
      output.data[dst] = image.data[src]
      output.data[dst + 1] = image.data[src + 1]
      output.data[dst + 2] = image.data[src + 2]
      output.data[dst + 3] = image.data[src + 3]
    }
  }
  return output
}

function visibleAt(image, x, y, alphaThreshold) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
  return image.data[pixelOffset(image.width, x, y) + 3] >= alphaThreshold
}

export function strengthenAlphaOutline(image, {
  color = [24, 24, 32],
  alpha = 255,
  alphaThreshold = 1,
} = {}) {
  const output = cloneRgba(image)
  let changed = 0
  const rgb = color.map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] >= alphaThreshold) continue
      const touchesVisible =
        visibleAt(image, x - 1, y, alphaThreshold) ||
        visibleAt(image, x + 1, y, alphaThreshold) ||
        visibleAt(image, x, y - 1, alphaThreshold) ||
        visibleAt(image, x, y + 1, alphaThreshold)
      if (!touchesVisible) continue
      output.data[offset] = rgb[0]
      output.data[offset + 1] = rgb[1]
      output.data[offset + 2] = rgb[2]
      output.data[offset + 3] = Math.max(0, Math.min(255, Math.round(Number(alpha) || 255)))
      changed += 1
    }
  }
  return {
    image: output,
    report: {
      mode: 'alpha_outline',
      output_mutation: changed ? 'outline_strengthen' : 'none',
      outline_pixel_count: changed,
      outline_pixel_ratio: image.width * image.height ? round(changed / (image.width * image.height)) : 0,
      color: rgb,
    },
  }
}

export function strengthenInnerAlphaOutline(image, {
  color = [24, 24, 32],
  alphaThreshold = 1,
} = {}) {
  const output = cloneRgba(image)
  let changed = 0
  const rgb = color.map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] < alphaThreshold) continue
      const touchesTransparent =
        !visibleAt(image, x - 1, y, alphaThreshold) ||
        !visibleAt(image, x + 1, y, alphaThreshold) ||
        !visibleAt(image, x, y - 1, alphaThreshold) ||
        !visibleAt(image, x, y + 1, alphaThreshold)
      if (!touchesTransparent) continue
      output.data[offset] = rgb[0]
      output.data[offset + 1] = rgb[1]
      output.data[offset + 2] = rgb[2]
      changed += 1
    }
  }
  return {
    image: output,
    report: {
      mode: 'inner_alpha_outline',
      output_mutation: changed ? 'inner_outline_strengthen' : 'none',
      outline_pixel_count: changed,
      outline_pixel_ratio: image.width * image.height ? round(changed / (image.width * image.height)) : 0,
      color: rgb,
    },
  }
}

export function measureStyleDrift(image, { palette, alphaThreshold = 1 } = {}) {
  const colors = (palette ?? []).map(normalizePaletteColor)
  if (!colors.length) throw new Error('palette is required')
  const unique = new Set()
  let visible = 0
  let offPalette = 0
  let distanceSum = 0
  let maxDistance = 0

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] < alphaThreshold) continue
      visible += 1
      unique.add(`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`)
      const nearest = nearestPaletteColor(image.data, offset, colors)
      const distance = Math.sqrt(colorDistanceSq(image.data, offset, nearest))
      if (distance > 0) offPalette += 1
      distanceSum += distance
      maxDistance = Math.max(maxDistance, distance)
    }
  }

  return {
    mode: 'report_only',
    visible_pixel_count: visible,
    unique_color_count: unique.size,
    palette_color_count: colors.length,
    off_palette_pixel_count: offPalette,
    off_palette_ratio: visible ? round(offPalette / visible) : 0,
    average_nearest_palette_distance: visible ? round(distanceSum / visible) : 0,
    max_nearest_palette_distance: round(maxDistance),
  }
}

export function buildPixelStyleReport(image, { maxColors = 16, alphaThreshold = 1 } = {}) {
  const palette = extractPalette(image, { maxColors, alphaThreshold })
  return {
    mode: 'report_only',
    output_mutation: 'none',
    palette: {
      max_colors: maxColors,
      colors: palette,
    },
    metrics: palette.length ? measureStyleDrift(image, { palette, alphaThreshold }) : null,
  }
}

function outlineMode(value) {
  const mode = String(value ?? 'outer').trim().toLowerCase()
  return ['off', 'none'].includes(mode) ? 'none' : ['inner', 'outer', 'both'].includes(mode) ? mode : 'outer'
}

function outlineReportsFor(image, options = {}) {
  const mode = outlineMode(options.outlineMode ?? options.outline_mode)
  if (mode === 'none' || options.outline === false) {
    return {
      image: cloneRgba(image),
      reports: [],
      summary: {
        enabled: false,
        mode: 'none',
        outline_pixel_count: 0,
        outline_pixel_ratio: 0,
      },
    }
  }
  const color = options.outlineColor ?? options.outline_color ?? [24, 24, 32]
  const reports = []
  let next = image
  if (mode === 'inner' || mode === 'both') {
    const inner = strengthenInnerAlphaOutline(next, { color, alphaThreshold: options.alphaThreshold ?? options.alpha_threshold ?? 1 })
    next = inner.image
    reports.push(inner.report)
  }
  if (mode === 'outer' || mode === 'both') {
    const outer = strengthenAlphaOutline(next, { color, alphaThreshold: options.alphaThreshold ?? options.alpha_threshold ?? 1 })
    next = outer.image
    reports.push(outer.report)
  }
  const outlinePixels = reports.reduce((sum, report) => sum + (report.outline_pixel_count ?? 0), 0)
  return {
    image: next,
    reports,
    summary: {
      enabled: true,
      mode,
      outline_pixel_count: outlinePixels,
      outline_pixel_ratio: image.width * image.height ? round(outlinePixels / (image.width * image.height)) : 0,
      color: reports.find((report) => report.color)?.color ?? color,
    },
  }
}

function alphaCleanupReport(before, after, cleanupMinAlpha) {
  let removedPixels = 0
  let lowAlphaRemovedPixels = 0
  let edgeMatteRemovedPixels = 0
  for (let i = 0; i < before.data.length; i += 4) {
    const beforeAlpha = before.data[i + 3]
    if (!beforeAlpha || after.data[i + 3] > 0) continue
    removedPixels += 1
    if (beforeAlpha <= cleanupMinAlpha) lowAlphaRemovedPixels += 1
    else edgeMatteRemovedPixels += 1
  }
  return {
    cleanup_min_alpha: cleanupMinAlpha,
    removed_pixel_count: removedPixels,
    low_alpha_removed_pixel_count: lowAlphaRemovedPixels,
    edge_matte_removed_pixel_count: edgeMatteRemovedPixels,
  }
}

function isLightNeutralPixel(data, offset) {
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  return max - min <= 28 && (r + g + b) / 3 >= 170
}

function hasTransparentNeighborAt(image, x, y, alphaThreshold) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return true
      if (image.data[pixelOffset(image.width, nx, ny) + 3] < alphaThreshold) return true
    }
  }
  return false
}

function measureHaloResidue(image, { alphaThreshold = 1 } = {}) {
  let nearWhiteEdgePixels = 0
  let semiTransparentEdgePixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      const alpha = image.data[offset + 3]
      if (alpha < alphaThreshold) continue
      if (!hasTransparentNeighborAt(image, x, y, alphaThreshold)) continue
      if (isLightNeutralPixel(image.data, offset)) nearWhiteEdgePixels += 1
      if (alpha > alphaThreshold && alpha < 255) semiTransparentEdgePixels += 1
    }
  }
  return {
    near_white_edge_pixels: nearWhiteEdgePixels,
    semi_transparent_edge_pixels: semiTransparentEdgePixels,
  }
}

export function applyPixelFinishing(image, {
  maxColors = 16,
  alphaThreshold = 1,
  cleanupMinAlpha = 18,
  componentCleanup = true,
  componentCleanupMinArea = 4,
  componentCleanupMinAreaRatio = 0,
  outline = true,
  outlineMode: requestedOutlineMode = 'outer',
  outlineColor = [24, 24, 32],
  gridMode = 'profile_cell_grid',
  cellSize = null,
} = {}) {
  const before = buildPixelStyleReport(image, { maxColors, alphaThreshold })
  const haloBefore = measureHaloResidue(image, { alphaThreshold })
  const paletteSnap = applyPixelStyleCorrection(image, { maxColors, alphaThreshold })
  const alphaCleaned = cleanupAlphaArtifactsFromRgba(paletteSnap.image, {
    minAlpha: cleanupMinAlpha,
  })
  const alphaCleanup = alphaCleanupReport(paletteSnap.image, alphaCleaned, cleanupMinAlpha)
  const componentCleaned = componentCleanup
    ? cleanupSmallAlphaComponentsFromRgba(alphaCleaned, {
      minArea: componentCleanupMinArea,
      minAreaRatio: componentCleanupMinAreaRatio,
    })
    : {
        image: alphaCleaned,
        stats: {
          enabled: false,
          min_area: componentCleanupMinArea,
          min_area_ratio: componentCleanupMinAreaRatio,
          threshold: null,
          total_components: null,
          removed_components: 0,
          removed_pixels: 0,
        },
      }
  const outlined = outlineReportsFor(componentCleaned.image, {
    outline,
    outlineMode: requestedOutlineMode,
    outlineColor,
    alphaThreshold,
  })
  const after = buildPixelStyleReport(outlined.image, { maxColors, alphaThreshold })
  const haloAfter = measureHaloResidue(outlined.image, { alphaThreshold })
  const changed = countChangedPixels(image, outlined.image)
  return {
    image: outlined.image,
    report: {
      mode: 'pixel_finishing_v1',
      output_mutation: changed.changed ? 'pixel_finishing' : 'none',
      palette: {
        source: paletteSnap.report.palette.source,
        max_colors: maxColors,
        colors: paletteSnap.report.palette.colors,
      },
      metrics: {
        before: before.metrics,
        after: after.metrics,
      },
      changed_pixel_count: changed.changed,
      changed_pixel_ratio: changed.total ? round(changed.changed / changed.total) : 0,
      palette_snap: {
        changed_pixel_count: paletteSnap.report.changed_pixel_count,
        changed_pixel_ratio: paletteSnap.report.changed_pixel_ratio,
      },
      alpha_cleanup: alphaCleanup,
      halo_residue: {
        before: haloBefore,
        after: haloAfter,
      },
      component_cleanup: componentCleaned.stats,
      outline: outlined.summary,
      outline_steps: outlined.reports,
      grid: {
        mode: gridMode,
        cell_size: cellSize,
        snap: 'not_applied_v1',
      },
      scale: {
        method: 'nearest_neighbor_exports',
        note: 'Multi-resolution exports use nearest-neighbor resizing from the finished sheet.',
      },
    },
  }
}
