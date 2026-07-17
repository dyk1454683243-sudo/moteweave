import sharp from 'sharp'

const MATERIAL_PATCH_MODE = 'material_patch_v1'
const MATERIAL_PATCH_EXTRACTION_MODE = 'material_patch_extraction_v1'

function sanitizeId(value) {
  return String(value || 'material_patch').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function hashBuffer(buffer) {
  let hash = 2166136261
  for (const byte of buffer) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function buildPaletteLimitPolicy({ paletteMaxColors = null, sampleCount = 0, reservedColors = 1 } = {}) {
  if (!positiveInteger(paletteMaxColors)) {
    return {
      mode: 'material_patch_palette_limit_v1',
      status: 'disabled',
      reason: 'palette_max_colors_not_configured',
      max_colors: null,
      reserved_colors: 0,
      patch_color_budget: null,
      expected_max_visible_colors: null,
    }
  }
  const effectiveSampleCount = Math.max(1, sampleCount)
  const safeReserved = Math.max(0, Math.min(paletteMaxColors - 1, reservedColors))
  const available = Math.max(1, paletteMaxColors - safeReserved)
  const patchColorBudget = Math.max(1, Math.min(256, Math.floor(available / effectiveSampleCount)))
  const expectedMaxVisibleColors = patchColorBudget * effectiveSampleCount + safeReserved
  return {
    mode: 'material_patch_palette_limit_v1',
    status: expectedMaxVisibleColors <= paletteMaxColors ? 'active' : 'warning',
    reason: patchColorBudget < 2 ? 'patch_color_budget_below_two_colors' : 'limited_palette_patch_budget',
    max_colors: paletteMaxColors,
    reserved_colors: safeReserved,
    patch_color_budget: patchColorBudget,
    patch_count: effectiveSampleCount,
    expected_max_visible_colors: expectedMaxVisibleColors,
  }
}

async function limitPatchPalette(patchPng, policy) {
  if (policy?.status !== 'active' || !positiveInteger(policy.patch_color_budget)) return patchPng
  return sharp(patchPng)
    .ensureAlpha()
    .png({
      palette: true,
      colors: policy.patch_color_budget,
      dither: 0,
    })
    .toBuffer()
}

function toHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

function pixelToHex(pixel) {
  return `#${toHex(pixel.r)}${toHex(pixel.g)}${toHex(pixel.b)}`
}

function luma(pixel) {
  return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722
}

function readPixel(data, width, x, y) {
  const index = (y * width + x) * 4
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  }
}

function writePixel(data, width, x, y, pixel) {
  const index = (y * width + x) * 4
  data[index] = pixel.r
  data[index + 1] = pixel.g
  data[index + 2] = pixel.b
  data[index + 3] = pixel.a
}

function averagePixel(a, b) {
  return {
    r: Math.round((a.r + b.r) / 2),
    g: Math.round((a.g + b.g) / 2),
    b: Math.round((a.b + b.b) / 2),
    a: Math.round(((a.a ?? 255) + (b.a ?? 255)) / 2),
  }
}

function pixelEquals(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b && (a.a ?? 255) === (b.a ?? 255)
}

function tileabilityPolicy({ enabled = true } = {}) {
  return {
    mode: 'tileable_patch_edge_normalization_v1',
    status: enabled ? 'active' : 'disabled',
    reason: enabled ? 'normalize_opposing_patch_edges' : 'disabled_by_caller',
  }
}

async function normalizePatchTileability(patchPng, policy) {
  if (policy.status !== 'active') {
    return {
      png: patchPng,
      report: {
        ...policy,
        changed_pixel_count: 0,
        changed_pixel_ratio: 0,
      },
    }
  }
  const raw = await sharp(patchPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = raw.info
  const data = Buffer.from(raw.data)
  const before = Buffer.from(raw.data)
  if (width > 1) {
    for (let y = 0; y < height; y += 1) {
      const merged = averagePixel(readPixel(data, width, 0, y), readPixel(data, width, width - 1, y))
      writePixel(data, width, 0, y, merged)
      writePixel(data, width, width - 1, y, merged)
    }
  }
  if (height > 1) {
    for (let x = 0; x < width; x += 1) {
      const merged = averagePixel(readPixel(data, width, x, 0), readPixel(data, width, x, height - 1))
      writePixel(data, width, x, 0, merged)
      writePixel(data, width, x, height - 1, merged)
    }
  }

  const edgePixels = new Set()
  for (let y = 0; y < height; y += 1) {
    edgePixels.add(`${0}:${y}`)
    edgePixels.add(`${width - 1}:${y}`)
  }
  for (let x = 0; x < width; x += 1) {
    edgePixels.add(`${x}:${0}`)
    edgePixels.add(`${x}:${height - 1}`)
  }
  let changedPixelCount = 0
  for (const key of edgePixels) {
    const [x, y] = key.split(':').map(Number)
    if (!pixelEquals(readPixel(before, width, x, y), readPixel(data, width, x, y))) changedPixelCount += 1
  }
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
  return {
    png,
    report: {
      ...policy,
      changed_pixel_count: changedPixelCount,
      changed_pixel_ratio: Number((changedPixelCount / Math.max(1, edgePixels.size)).toFixed(4)),
    },
  }
}

function colorDistance(a, b) {
  const alphaPenalty = Math.abs((a.a ?? 255) - (b.a ?? 255)) * 0.5
  return Math.sqrt(
    ((a.r ?? 0) - (b.r ?? 0)) ** 2 +
    ((a.g ?? 0) - (b.g ?? 0)) ** 2 +
    ((a.b ?? 0) - (b.b ?? 0)) ** 2
  ) + alphaPenalty
}

function averageOpposingEdgeDelta(data, width, height) {
  let horizontal = 0
  let vertical = 0
  for (let y = 0; y < height; y += 1) {
    horizontal += colorDistance(readPixel(data, width, 0, y), readPixel(data, width, width - 1, y))
  }
  for (let x = 0; x < width; x += 1) {
    vertical += colorDistance(readPixel(data, width, x, 0), readPixel(data, width, x, height - 1))
  }
  horizontal = Number((horizontal / Math.max(1, height)).toFixed(2))
  vertical = Number((vertical / Math.max(1, width)).toFixed(2))
  return {
    horizontal,
    vertical,
    max: Number(Math.max(horizontal, vertical).toFixed(2)),
  }
}

function patchMetrics(rawImage) {
  const pixels = []
  let visiblePixelCount = 0
  let alphaTotal = 0
  const colors = new Set()
  for (let y = 0; y < rawImage.info.height; y += 1) {
    for (let x = 0; x < rawImage.info.width; x += 1) {
      const pixel = readPixel(rawImage.data, rawImage.info.width, x, y)
      if (!pixel.a) continue
      visiblePixelCount += 1
      alphaTotal += pixel.a
      pixels.push(pixel)
      colors.add(pixelToHex(pixel).toLowerCase())
    }
  }

  if (!pixels.length) {
    return {
      visible_pixel_count: 0,
      pixel_count: rawImage.info.width * rawImage.info.height,
      visible_coverage_ratio: 0,
      mean_alpha: 0,
      luma_min: 0,
      luma_max: 0,
      luma_range: 0,
      luma_median: 0,
      unique_color_count: 0,
      sampled_colors: [],
      opposing_edge_delta: averageOpposingEdgeDelta(rawImage.data, rawImage.info.width, rawImage.info.height),
    }
  }

  pixels.sort((a, b) => luma(a) - luma(b))
  const pick = (ratio) => pixels[Math.min(pixels.length - 1, Math.max(0, Math.floor((pixels.length - 1) * ratio)))]
  const minLuma = luma(pixels[0])
  const maxLuma = luma(pixels[pixels.length - 1])
  return {
    visible_pixel_count: visiblePixelCount,
    pixel_count: rawImage.info.width * rawImage.info.height,
    visible_coverage_ratio: Number((visiblePixelCount / Math.max(1, rawImage.info.width * rawImage.info.height)).toFixed(4)),
    mean_alpha: Number((alphaTotal / visiblePixelCount).toFixed(2)),
    luma_min: Number(minLuma.toFixed(2)),
    luma_max: Number(maxLuma.toFixed(2)),
    luma_range: Number((maxLuma - minLuma).toFixed(2)),
    luma_median: Number(luma(pick(0.5)).toFixed(2)),
    unique_color_count: colors.size,
    sampled_colors: [...colors].slice(0, 16),
    opposing_edge_delta: averageOpposingEdgeDelta(rawImage.data, rawImage.info.width, rawImage.info.height),
  }
}

function patchDiagnostics(slot, metrics) {
  const warnings = []
  if (metrics.visible_coverage_ratio < 0.75) warnings.push(`material_patch_low_visible_coverage_${slot}`)
  if (metrics.luma_range < 8) warnings.push(`material_patch_low_contrast_${slot}`)
  if (metrics.unique_color_count < 2) warnings.push(`material_patch_low_color_variety_${slot}`)
  if (metrics.opposing_edge_delta.max > 72) warnings.push(`material_patch_repeat_edge_delta_${slot}`)
  return {
    status: warnings.length ? 'warning' : 'pass',
    warnings,
    metrics,
  }
}

async function extractPatch({ normalizedSourcePng, sample, patchSize, paletteLimit, tileability }) {
  const [width, height] = patchSize
  const rawPatchPng = await sharp(normalizedSourcePng)
    .extract({
      left: sample.sample_region.x,
      top: sample.sample_region.y,
      width: sample.sample_region.w,
      height: sample.sample_region.h,
    })
    .resize(width, height, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer()
  const palettePatchPng = await limitPatchPalette(rawPatchPng, paletteLimit)
  const tileable = await normalizePatchTileability(palettePatchPng, tileability)
  const patchPng = await limitPatchPalette(tileable.png, paletteLimit)
  const rawPatch = await sharp(patchPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const hash = hashBuffer(patchPng).toString(16)
  const safeSlot = sanitizeId(sample.slot)
  const patch = {
    schema_version: 1,
    mode: MATERIAL_PATCH_MODE,
    id: `patch_${safeSlot}_${hash}`,
    slot: sample.slot,
    material_id: sample.material_id,
    source_rect: { ...sample.sample_region },
    size: { width, height },
    png_sha: hash,
    palette_limit: paletteLimit?.status === 'active'
      ? {
          mode: paletteLimit.mode,
          max_colors: paletteLimit.max_colors,
          color_budget: paletteLimit.patch_color_budget,
        }
      : null,
    tileability: tileable.report,
    image_data_url: `data:image/png;base64,${patchPng.toString('base64')}`,
  }
  return {
    slot: sample.slot,
    material_id: sample.material_id,
    role: sample.role,
    patch,
    diagnostics: patchDiagnostics(sample.slot, patchMetrics(rawPatch)),
  }
}

export async function extractMaterialPatchSet({
  normalizedSourcePng,
  samples = [],
  patchSize = [16, 16],
  paletteMaxColors = null,
  tileableEdges = true,
} = {}) {
  if (!Buffer.isBuffer(normalizedSourcePng)) {
    throw new Error('normalizedSourcePng is required for material patch extraction')
  }
  const paletteLimit = buildPaletteLimitPolicy({
    paletteMaxColors,
    sampleCount: samples.length,
    reservedColors: 1,
  })
  const tileability = tileabilityPolicy({ enabled: tileableEdges })
  const patches = []
  for (const sample of samples) {
    patches.push(await extractPatch({ normalizedSourcePng, sample, patchSize, paletteLimit, tileability }))
  }
  const warnings = [...new Set(patches.flatMap((patch) => patch.diagnostics.warnings))]
  return {
    schema_version: 1,
    mode: MATERIAL_PATCH_EXTRACTION_MODE,
    status: warnings.length ? 'warning' : 'pass',
    patch_size: { width: patchSize[0], height: patchSize[1] },
    palette_limit: paletteLimit,
    tileability: {
      ...tileability,
      changed_patch_count: patches.filter((patch) => patch.patch.tileability?.changed_pixel_count > 0).length,
      changed_pixel_count: patches.reduce((total, patch) => total + (patch.patch.tileability?.changed_pixel_count ?? 0), 0),
    },
    patch_count: patches.length,
    warning_patch_count: patches.filter((patch) => patch.diagnostics.status === 'warning').length,
    warnings,
    patches,
  }
}

function decodePatchDataUrl(dataUrl) {
  const encoded = String(dataUrl).replace(/^data:image\/png;base64,/, '')
  return Buffer.from(encoded, 'base64')
}

export async function renderMaterialPatchSheetPng(materialProfile) {
  const slots = Object.values(materialProfile?.slots ?? {})
  const patchSlots = slots.filter((slot) => materialProfile.materials?.[slot.material_id]?.patch?.image_data_url)
  const swatch = 64
  const gap = 8
  const width = Math.max(swatch + gap * 2, patchSlots.length * (swatch + gap) + gap)
  const height = swatch + gap * 2
  const base = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#202426ff',
    },
  })
    .png()
    .toBuffer()
  const composites = []
  for (let index = 0; index < patchSlots.length; index += 1) {
    const slot = patchSlots[index]
    const patch = materialProfile.materials[slot.material_id].patch
    composites.push({
      input: await sharp(decodePatchDataUrl(patch.image_data_url))
        .resize(swatch, swatch, { fit: 'fill', kernel: 'nearest' })
        .png()
        .toBuffer(),
      left: gap + index * (swatch + gap),
      top: gap,
    })
  }
  return sharp(base).composite(composites).png().toBuffer()
}
