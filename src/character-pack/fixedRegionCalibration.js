import {
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
} from './fixedRegionGeometry.js'

export const TEMPLATE_CALIBRATION_MODE = 'fixed_region_template_safe_fit_v0'
export const TEMPLATE_CALIBRATION_STAGE_SIZE = 256
export const TEMPLATE_CALIBRATION_CROP_SIZE = 252

// Visible bounds measured from the repository's canonical fixed-region template.
// Values are region-local and intentionally versioned with the calibration mode.
export const FIXED_REGION_TEMPLATE_VISIBLE_BOUNDS_V0 = Object.freeze({
  attractL0: { x: 17, y: 9, w: 25, h: 32 },
  attractL1: { x: 8, y: 7, w: 27, h: 34 },
  attractL2: { x: 6, y: 10, w: 25, h: 31 },
  attractL3: { x: 0, y: 12, w: 28, h: 29 },
  attractL4: { x: 0, y: 12, w: 28, h: 29 },
  attractL5: { x: 3, y: 10, w: 25, h: 31 },
  attractL6: { x: 10, y: 8, w: 22, h: 33 },
  attractL7: { x: 15, y: 7, w: 22, h: 34 },
  climb0: { x: 2, y: 5, w: 18, h: 36 },
  climb1: { x: 2, y: 3, w: 18, h: 38 },
  climb2: { x: 2, y: 5, w: 18, h: 36 },
  climb3: { x: 2, y: 5, w: 18, h: 36 },
  climb4: { x: 2, y: 3, w: 18, h: 38 },
  climb5: { x: 2, y: 5, w: 18, h: 36 },
  defence: { x: 2, y: 8, w: 18, h: 33 },
  die: { x: 0, y: 6, w: 40, h: 35 },
  idleL: { x: 2, y: 5, w: 18, h: 36 },
  idledown: { x: 2, y: 5, w: 18, h: 36 },
  idleup: { x: 2, y: 5, w: 18, h: 36 },
  item0: { x: 2, y: 4, w: 16, h: 37 },
  item1: { x: 0, y: 3, w: 21, h: 38 },
  jump0: { x: 3, y: 4, w: 18, h: 35 },
  jump1: { x: 1, y: 4, w: 20, h: 35 },
  runL0: { x: 3, y: 7, w: 25, h: 34 },
  runL1: { x: 7, y: 7, w: 18, h: 34 },
  runL2: { x: 6, y: 6, w: 21, h: 35 },
  runL3: { x: 3, y: 7, w: 25, h: 34 },
  runL4: { x: 6, y: 7, w: 18, h: 34 },
  runL5: { x: 5, y: 6, w: 20, h: 35 },
  rundown0: { x: 3, y: 7, w: 17, h: 34 },
  rundown1: { x: 3, y: 7, w: 16, h: 34 },
  rundown2: { x: 3, y: 6, w: 16, h: 35 },
  rundown3: { x: 2, y: 7, w: 17, h: 34 },
  rundown4: { x: 3, y: 7, w: 16, h: 34 },
  rundown5: { x: 3, y: 7, w: 16, h: 34 },
  runup0: { x: 3, y: 7, w: 17, h: 34 },
  runup1: { x: 3, y: 7, w: 16, h: 34 },
  runup2: { x: 3, y: 5, w: 16, h: 36 },
  runup3: { x: 2, y: 7, w: 17, h: 34 },
  runup4: { x: 3, y: 7, w: 16, h: 34 },
  runup5: { x: 3, y: 5, w: 16, h: 36 },
  sitdown: { x: 1, y: 7, w: 17, h: 34 },
  walkL0: { x: 4, y: 5, w: 15, h: 36 },
  walkL1: { x: 4, y: 5, w: 14, h: 36 },
  walkL2: { x: 2, y: 7, w: 17, h: 34 },
  walkL3: { x: 4, y: 6, w: 14, h: 35 },
  walkL4: { x: 4, y: 5, w: 15, h: 36 },
  walkL5: { x: 4, y: 6, w: 17, h: 35 },
  walkdown0: { x: 2, y: 6, w: 18, h: 35 },
  walkdown1: { x: 2, y: 7, w: 18, h: 34 },
  walkdown2: { x: 2, y: 6, w: 18, h: 35 },
  walkdown3: { x: 2, y: 6, w: 18, h: 35 },
  walkdown4: { x: 2, y: 7, w: 18, h: 34 },
  walkdown5: { x: 2, y: 6, w: 18, h: 35 },
  walkup0: { x: 2, y: 5, w: 18, h: 36 },
  walkup1: { x: 2, y: 5, w: 18, h: 36 },
  walkup2: { x: 2, y: 5, w: 18, h: 36 },
  walkup3: { x: 2, y: 5, w: 18, h: 36 },
  walkup4: { x: 2, y: 5, w: 18, h: 36 },
  walkup5: { x: 2, y: 5, w: 18, h: 36 },
})

function pixelOffset(width, x, y) {
  return (y * width + x) * 4
}

function cloneRgba(image) {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  }
}

function resizeRgbaNearest(image, width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width))
      const sourceOffset = pixelOffset(image.width, sourceX, sourceY)
      const targetOffset = pixelOffset(width, x, y)
      data.set(image.data.subarray(sourceOffset, sourceOffset + 4), targetOffset)
    }
  }
  return { width, height, data }
}

export function removeTopLeftConnectedMatte(image, { tolerance = 80 } = {}) {
  const output = cloneRgba(image)
  const key = [output.data[0], output.data[1], output.data[2]]
  const threshold = tolerance * tolerance
  const pixelCount = output.width * output.height
  const seen = new Uint8Array(pixelCount)
  const stack = new Int32Array(pixelCount)
  let stackSize = 1
  let removedPixels = 0
  stack[0] = 0
  seen[0] = 1

  while (stackSize > 0) {
    const index = stack[--stackSize]
    const offset = index * 4
    const alpha = output.data[offset + 3]
    const distance =
      (output.data[offset] - key[0]) ** 2 +
      (output.data[offset + 1] - key[1]) ** 2 +
      (output.data[offset + 2] - key[2]) ** 2
    if (alpha !== 0 && distance > threshold) continue

    if (alpha !== 0) removedPixels++
    output.data[offset + 3] = 0

    const x = index % output.width
    const y = Math.floor(index / output.width)
    const neighbors = []
    if (x > 0) neighbors.push(index - 1)
    if (x + 1 < output.width) neighbors.push(index + 1)
    if (y > 0) neighbors.push(index - output.width)
    if (y + 1 < output.height) neighbors.push(index + output.width)
    for (const neighbor of neighbors) {
      if (seen[neighbor]) continue
      seen[neighbor] = 1
      stack[stackSize++] = neighbor
    }
  }

  return { image: output, removedPixels }
}

export function stageTemplateCalibrationSource(
  image,
  {
    stageSize = TEMPLATE_CALIBRATION_STAGE_SIZE,
    cropSize = TEMPLATE_CALIBRATION_CROP_SIZE,
    matteTolerance = 80,
    removeConnectedMatte = true,
  } = {}
) {
  const resized = resizeRgbaNearest(image, stageSize, stageSize)
  const matte = removeConnectedMatte
    ? removeTopLeftConnectedMatte(resized, { tolerance: matteTolerance })
    : { image: resized, removedPixels: 0 }
  const data = new Uint8ClampedArray(cropSize * cropSize * 4)
  for (let y = 0; y < cropSize; y++) {
    const sourceStart = pixelOffset(stageSize, 0, y)
    const targetStart = pixelOffset(cropSize, 0, y)
    data.set(matte.image.data.subarray(sourceStart, sourceStart + cropSize * 4), targetStart)
  }
  return {
    image: { width: cropSize, height: cropSize, data },
    report: {
      input_size: { w: image.width, h: image.height },
      stage_size: { w: stageSize, h: stageSize },
      output_size: { w: cropSize, h: cropSize },
      matte_applied: removeConnectedMatte,
      matte_removed_pixels: matte.removedPixels,
    },
  }
}

function retainedRegionForeground(
  image,
  region,
  { minComponentPixels = 2 } = {}
) {
  const pixelCount = region.w * region.h
  const seen = new Uint8Array(pixelCount)
  const components = []
  let visiblePixelCount = 0

  const isVisible = (localIndex) => {
    const x = localIndex % region.w
    const y = Math.floor(localIndex / region.w)
    return image.data[pixelOffset(image.width, region.x + x, region.y + y) + 3] > 0
  }

  for (let start = 0; start < pixelCount; start++) {
    if (seen[start] || !isVisible(start)) continue
    const stack = [start]
    const pixels = []
    seen[start] = 1
    while (stack.length) {
      const index = stack.pop()
      pixels.push(index)
      visiblePixelCount++
      const x = index % region.w
      const y = Math.floor(index / region.w)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextY < 0 || nextX >= region.w || nextY >= region.h) continue
          const next = nextY * region.w + nextX
          if (seen[next] || !isVisible(next)) continue
          seen[next] = 1
          stack.push(next)
        }
      }
    }
    components.push(pixels)
  }

  if (!components.length) {
    return {
      bbox: null,
      mask: new Uint8Array(pixelCount),
      componentCount: 0,
      keptComponentCount: 0,
      visiblePixelCount,
      keptPixelCount: 0,
    }
  }

  components.sort((a, b) => b.length - a.length)
  const largest = components[0]
  const retainedComponents = [
    largest,
    ...components.slice(1).filter((pixels) => pixels.length >= minComponentPixels),
  ]
  const retainedPixels = retainedComponents.flat()
  const mask = new Uint8Array(pixelCount)
  let minX = region.w
  let minY = region.h
  let maxX = -1
  let maxY = -1
  for (const index of retainedPixels) {
    mask[index] = 1
    const x = index % region.w
    const y = Math.floor(index / region.w)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return {
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    mask,
    componentCount: components.length,
    keptComponentCount: retainedComponents.length,
    visiblePixelCount,
    keptPixelCount: retainedPixels.length,
  }
}

function insetBounds(bounds, safeMarginPx) {
  const insetX = Math.min(safeMarginPx, Math.floor((bounds.w - 1) / 2))
  const insetY = Math.min(safeMarginPx, Math.floor((bounds.h - 1) / 2))
  return {
    x: bounds.x + insetX,
    y: bounds.y + insetY,
    w: Math.max(1, bounds.w - insetX * 2),
    h: Math.max(1, bounds.h - insetY * 2),
  }
}

function drawFittedComponent({ source, output, region, component, visibleBounds, safeMarginPx }) {
  const target = insetBounds(visibleBounds, safeMarginPx)
  const scale = Math.min(target.w / component.bbox.w, target.h / component.bbox.h)
  const width = Math.max(1, Math.min(target.w, Math.round(component.bbox.w * scale)))
  const height = Math.max(1, Math.min(target.h, Math.round(component.bbox.h * scale)))
  const targetX = region.x + target.x + Math.floor((target.w - width) / 2)
  const targetY = region.y + target.y + (target.h - height)

  for (let y = 0; y < height; y++) {
    const sourceY = component.bbox.y + Math.min(
      component.bbox.h - 1,
      Math.floor((y * component.bbox.h) / height)
    )
    for (let x = 0; x < width; x++) {
      const sourceX = component.bbox.x + Math.min(
        component.bbox.w - 1,
        Math.floor((x * component.bbox.w) / width)
      )
      if (!component.mask[sourceY * region.w + sourceX]) continue
      const sourceOffset = pixelOffset(source.width, region.x + sourceX, region.y + sourceY)
      const targetOffset = pixelOffset(output.width, targetX + x, targetY + y)
      output.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset)
    }
  }

  return { scale, target: { x: targetX, y: targetY, w: width, h: height } }
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function calibrateFixedRegionTemplateImage(
  source,
  { safeMarginPx = 3, visibleBounds = FIXED_REGION_TEMPLATE_VISIBLE_BOUNDS_V0 } = {}
) {
  if (
    source.width !== FIXED_REGION_SOURCE_SHEET.w ||
    source.height !== FIXED_REGION_SOURCE_SHEET.h
  ) {
    throw new Error('template calibration source must be 252 x 252')
  }

  const output = {
    width: TEMPLATE_CALIBRATION_STAGE_SIZE,
    height: TEMPLATE_CALIBRATION_STAGE_SIZE,
    data: new Uint8ClampedArray(
      TEMPLATE_CALIBRATION_STAGE_SIZE * TEMPLATE_CALIBRATION_STAGE_SIZE * 4
    ),
  }
  const missingRegions = []
  const scales = []
  const regionReports = []
  let removedComponents = 0
  let removedPixels = 0

  for (const [key, region] of Object.entries(FIXED_REGION_SOURCE_REGIONS)) {
    const bounds = visibleBounds[key]
    if (!bounds) throw new Error(`template calibration bounds missing for ${key}`)
    const component = retainedRegionForeground(source, region)
    removedComponents += Math.max(0, component.componentCount - component.keptComponentCount)
    removedPixels += component.visiblePixelCount - component.keptPixelCount
    if (!component.bbox) {
      missingRegions.push(key)
      regionReports.push({ key, status: 'missing' })
      continue
    }

    const fitted = drawFittedComponent({
      source,
      output,
      region,
      component,
      visibleBounds: bounds,
      safeMarginPx,
    })
    scales.push(fitted.scale)
    regionReports.push({
      key,
      status: 'calibrated',
      source_bbox: component.bbox,
      target_bbox: fitted.target,
      scale: fitted.scale,
    })
  }

  return {
    image: output,
    report: {
      mode: TEMPLATE_CALIBRATION_MODE,
      source_size: { w: source.width, h: source.height },
      output_size: { w: output.width, h: output.height },
      safe_margin_px: safeMarginPx,
      region_count: Object.keys(FIXED_REGION_SOURCE_REGIONS).length,
      calibrated_region_count: regionReports.length - missingRegions.length,
      missing_region_count: missingRegions.length,
      missing_regions: missingRegions,
      removed_component_count: removedComponents,
      removed_pixel_count: removedPixels,
      scale: {
        min: scales.length ? Math.min(...scales) : null,
        median: median(scales),
        max: scales.length ? Math.max(...scales) : null,
      },
      regions: regionReports,
    },
  }
}
