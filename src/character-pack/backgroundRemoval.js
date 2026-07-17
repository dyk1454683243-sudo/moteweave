import { cloneRgba, colorDistanceSq, pixelOffset } from './imageMath.js'

export function passthroughRgba(image) {
  return cloneRgba(image)
}

function clearPixel(data, offset) {
  data[offset] = 0
  data[offset + 1] = 0
  data[offset + 2] = 0
  data[offset + 3] = 0
}

export function floodRemoveBackgroundFromRgba(image, { color = [255, 255, 255], tolerance = 18 } = {}) {
  const out = cloneRgba(image)
  const threshold = tolerance * tolerance
  const seen = new Uint8Array(out.width * out.height)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return
    const i = y * out.width + x
    if (seen[i]) return
    seen[i] = 1
    const o = pixelOffset(out.width, x, y)
    if (out.data[o + 3] === 0 || colorDistanceSq(out.data, o, color) <= threshold) queue.push([x, y])
  }
  for (let x = 0; x < out.width; x++) {
    push(x, 0)
    push(x, out.height - 1)
  }
  for (let y = 0; y < out.height; y++) {
    push(0, y)
    push(out.width - 1, y)
  }
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q]
    const o = pixelOffset(out.width, x, y)
    clearPixel(out.data, o)
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return out
}

function edgePixels(image) {
  const pixels = []
  for (let x = 0; x < image.width; x++) {
    pixels.push(pixelOffset(image.width, x, 0), pixelOffset(image.width, x, image.height - 1))
  }
  for (let y = 0; y < image.height; y++) {
    pixels.push(pixelOffset(image.width, 0, y), pixelOffset(image.width, image.width - 1, y))
  }
  return pixels
}

function quantizedKey(data, offset, step) {
  return [
    Math.floor(data[offset] / step),
    Math.floor(data[offset + 1] / step),
    Math.floor(data[offset + 2] / step),
  ].join(',')
}

export function detectEdgeBackgroundPalette(image, { maxColors = 4, quantizeStep = 16, minShare = 0.02 } = {}) {
  const buckets = new Map()
  const offsets = edgePixels(image)
  for (const offset of offsets) {
    if (image.data[offset + 3] === 0) continue
    const key = quantizedKey(image.data, offset, quantizeStep)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++
    bucket.r += image.data[offset]
    bucket.g += image.data[offset + 1]
    bucket.b += image.data[offset + 2]
    buckets.set(key, bucket)
  }
  const minCount = Math.max(1, Math.floor(offsets.length * minShare))
  return [...buckets.values()]
    .filter((bucket) => bucket.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((bucket) => [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ])
}

function isNeutralLightBackground(data, offset) {
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  return max - min <= 28 && (r + g + b) / 3 >= 170
}

function hasTransparentNeighbor(image, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return true
      if (image.data[pixelOffset(image.width, nx, ny) + 3] === 0) return true
    }
  }
  return false
}

function transparentNeighborCount(image, x, y) {
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) {
        count++
      } else if (image.data[pixelOffset(image.width, nx, ny) + 3] === 0) {
        count++
      }
    }
  }
  return count
}

function nearestPaletteColor(data, offset, colors) {
  let best = null
  let bestDistance = Infinity
  for (const color of colors) {
    const distance = colorDistanceSq(data, offset, color)
    if (distance >= bestDistance) continue
    best = color
    bestDistance = distance
  }
  return { color: best, distance: bestDistance }
}

function isNearBackgroundPalette(data, offset, colors, tolerance) {
  return nearestPaletteColor(data, offset, colors).distance <= tolerance * tolerance
}

export function cleanupAlphaArtifactsFromRgba(image, { minAlpha = 18, neutralMatteMaxAlpha = 180 } = {}) {
  const out = cloneRgba(image)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const offset = pixelOffset(out.width, x, y)
      const alpha = out.data[offset + 3]
      if (!alpha) continue
      const shouldClearLowAlpha = alpha <= minAlpha
      const shouldClearNeutralMatte =
        alpha <= neutralMatteMaxAlpha &&
        isNeutralLightBackground(out.data, offset) &&
        hasTransparentNeighbor(out, x, y)
      if (shouldClearLowAlpha || shouldClearNeutralMatte) clearPixel(out.data, offset)
    }
  }
  return out
}

export function cleanupEdgeMatteResidueFromRgba(image, { colors = [], tolerance = 24, residueTolerance = Math.max(32, tolerance + 16), minDistance = 0, passes = 2 } = {}) {
  if (!colors.length || !passes) return cloneRgba(image)
  const out = cloneRgba(image)
  const minDistanceSq = minDistance * minDistance
  const residueToleranceSq = residueTolerance * residueTolerance
  for (let pass = 0; pass < passes; pass++) {
    const toClear = []
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const offset = pixelOffset(out.width, x, y)
        if (out.data[offset + 3] === 0) continue
        if (transparentNeighborCount(out, x, y) < 2) continue
        const nearest = nearestPaletteColor(out.data, offset, colors)
        if (!nearest.color || nearest.distance <= minDistanceSq || nearest.distance > residueToleranceSq) continue
        toClear.push(offset)
      }
    }
    if (!toClear.length) break
    for (const offset of toClear) clearPixel(out.data, offset)
  }
  return out
}

function foregroundNeighborAverage(image, x, y, colors, backgroundTolerance) {
  let count = 0
  const sum = [0, 0, 0]
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
      const offset = pixelOffset(image.width, nx, ny)
      if (image.data[offset + 3] === 0) continue
      if (isNearBackgroundPalette(image.data, offset, colors, backgroundTolerance)) continue
      sum[0] += image.data[offset]
      sum[1] += image.data[offset + 1]
      sum[2] += image.data[offset + 2]
      count++
    }
  }
  if (!count) return null
  return sum.map((value) => Math.round(value / count))
}

function luminance(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

export function decontaminateEdgeColorsFromRgba(
  image,
  { colors = [], tolerance = 24, maxBackgroundDistance = 112, foregroundTolerance = Math.max(48, tolerance + 24), strength = 0.55 } = {}
) {
  if (!colors.length || strength <= 0) return cloneRgba(image)
  const out = cloneRgba(image)
  const source = cloneRgba(image)
  const maxDistanceSq = maxBackgroundDistance * maxBackgroundDistance
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const offset = pixelOffset(source.width, x, y)
      if (source.data[offset + 3] === 0) continue
      if (!hasTransparentNeighbor(source, x, y)) continue
      const nearest = nearestPaletteColor(source.data, offset, colors)
      if (!nearest.color || nearest.distance <= tolerance * tolerance || nearest.distance > maxDistanceSq) continue
      const foreground = foregroundNeighborAverage(source, x, y, colors, foregroundTolerance)
      if (!foreground) continue
      const current = [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
      if (luminance(current) - luminance(foreground) < 10 && nearest.distance > foregroundTolerance * foregroundTolerance) continue
      for (let channel = 0; channel < 3; channel++) {
        out.data[offset + channel] = Math.round(current[channel] * (1 - strength) + foreground[channel] * strength)
      }
    }
  }
  return out
}

function collectAlphaComponents(image) {
  const seen = new Uint8Array(image.width * image.height)
  const components = []
  const queue = []
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const startIndex = y * image.width + x
      if (seen[startIndex]) continue
      seen[startIndex] = 1
      if (image.data[pixelOffset(image.width, x, y) + 3] === 0) continue

      const pixels = []
      queue.length = 0
      queue.push([x, y])
      for (let q = 0; q < queue.length; q++) {
        const [cx, cy] = queue[q]
        pixels.push(cy * image.width + cx)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
            const index = ny * image.width + nx
            if (seen[index]) continue
            seen[index] = 1
            if (image.data[pixelOffset(image.width, nx, ny) + 3] > 0) queue.push([nx, ny])
          }
        }
      }
      components.push(pixels)
    }
  }
  return components
}

export function cleanupSmallAlphaComponentsFromRgba(image, { minArea = 4, minAreaRatio = 0 } = {}) {
  const out = cloneRgba(image)
  const components = collectAlphaComponents(out)
  const largest = components.length ? Math.max(...components.map((component) => component.length)) : 0
  const threshold = Math.max(1, Math.round(Math.max(minArea, largest * minAreaRatio)))
  let removedComponents = 0
  let removedPixels = 0
  for (const component of components) {
    if (component.length >= threshold) continue
    removedComponents++
    removedPixels += component.length
    for (const index of component) clearPixel(out.data, index * 4)
  }
  return {
    image: out,
    stats: {
      enabled: true,
      min_area: minArea,
      min_area_ratio: minAreaRatio,
      threshold,
      total_components: components.length,
      removed_components: removedComponents,
      removed_pixels: removedPixels,
    },
  }
}

export function edgePaletteRemoveBackgroundFromRgba(
  image,
  {
    tolerance = 24,
    maxColors = 4,
    matteResidueCleanup = true,
    residueTolerance = Math.max(32, tolerance + 16),
    residuePasses = 2,
    edgeDecontamination = true,
    edgeDecontaminationMaxDistance = 112,
    edgeDecontaminationStrength = 0.55,
  } = {}
) {
  const colors = detectEdgeBackgroundPalette(image, { maxColors })
  if (!colors.length) return cloneRgba(image)
  const out = cloneRgba(image)
  const threshold = tolerance * tolerance
  const seen = new Uint8Array(out.width * out.height)
  const queue = []
  const isBackground = (offset) =>
    colors.some((color) => colorDistanceSq(out.data, offset, color) <= threshold) ||
    isNeutralLightBackground(out.data, offset)
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return
    const i = y * out.width + x
    if (seen[i]) return
    seen[i] = 1
    const o = pixelOffset(out.width, x, y)
    if (out.data[o + 3] === 0 || isBackground(o)) queue.push([x, y])
  }
  for (let x = 0; x < out.width; x++) {
    push(x, 0)
    push(x, out.height - 1)
  }
  for (let y = 0; y < out.height; y++) {
    push(0, y)
    push(out.width - 1, y)
  }
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q]
    const o = pixelOffset(out.width, x, y)
    clearPixel(out.data, o)
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  const cleaned = matteResidueCleanup
    ? cleanupEdgeMatteResidueFromRgba(out, { colors, tolerance, residueTolerance, passes: residuePasses })
    : out
  return edgeDecontamination
    ? decontaminateEdgeColorsFromRgba(cleaned, {
      colors,
      tolerance,
      maxBackgroundDistance: edgeDecontaminationMaxDistance,
      strength: edgeDecontaminationStrength,
    })
    : cleaned
}

export function dualMatteFromRgba(white, black, { consistencyTolerance = 42 } = {}) {
  if (white.width !== black.width || white.height !== black.height) {
    return { image: passthroughRgba(white), warnings: ['dual_matte_inconsistent'] }
  }
  const out = cloneRgba(black)
  let inconsistent = 0
  for (let i = 0; i < out.data.length; i += 4) {
    const dr = Math.abs(white.data[i] - black.data[i])
    const dg = Math.abs(white.data[i + 1] - black.data[i + 1])
    const db = Math.abs(white.data[i + 2] - black.data[i + 2])
    if (Math.max(dr, dg, db) - Math.min(dr, dg, db) > consistencyTolerance) inconsistent++
    const alpha = Math.max(0, Math.min(255, 255 - Math.round((dr + dg + db) / 3)))
    out.data[i + 3] = alpha
  }
  return { image: out, warnings: inconsistent >= Math.max(1, out.width * out.height * 0.01) ? ['dual_matte_inconsistent'] : [] }
}
