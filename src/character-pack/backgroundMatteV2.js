import { createHash } from 'node:crypto'

import {
  ALPHA_PROVENANCE,
  BACKGROUND_RECIPE_IDS,
  zeroTransparentRgbFromRgba,
} from './backgroundProcessingContract.js'
import { encodeRgbaPng, resizeRgbaNearest } from './imageCodec.js'
import { cloneRgba } from './imageMath.js'

export const BACKGROUND_MATTE_V2_ALGORITHM = BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2
export const BACKGROUND_MATTE_V2_CLASSIFICATION_REVISION =
  'exterior_background_reachability_v1_shoulder_singleton_v1_fringe_hard_clear_v1'
const BACKGROUND_MATTE_V2_FOREGROUND_SAMPLING_REVISION =
  'provisional_sure_foreground_snapshot_v1'

export const BACKGROUND_MATTE_V2_ARTIFACT_FILES = Object.freeze({
  OUTPUT: 'background_removed_provider_output.png',
  QUALITY: 'background_quality.json',
  REVIEW: 'background_review.json',
  CONTRACT_MASKS: 'background_contract_masks.json',
  PREVIEW: 'background_preview.png',
  SPILL_OVERLAY: 'background_spill_overlay.png',
  SURE_BACKGROUND_MASK: 'background_sure_background_mask.png',
  UNKNOWN_BAND_MASK: 'background_unknown_band_mask.png',
  SURE_FOREGROUND_MASK: 'background_sure_foreground_mask.png',
  ALPHA_ESTIMATE: 'background_alpha_estimate.png',
  FOREGROUND_RECONSTRUCTION: 'background_foreground_reconstruction.png',
})

export const BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES = Object.freeze([
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION,
])

export const BACKGROUND_MATTE_V2_DEFAULTS = Object.freeze({
  edge_band_ratio: 0.01,
  edge_band_min: 2,
  edge_band_max: 32,
  edge_sample_limit: 65_536,
  dominant_cluster_min_share: 0.9,
  corner_agreement_min_count: 3,
  corner_agreement_min_share: 0.75,
  oklab_p95_max_distance: 0.04,
  oklab_bucket_size: 0.02,
  unknown_band_scale: 1.25,
  unknown_band_min: 2,
  unknown_band_max: 16,
  foreground_sample_min: 3,
  foreground_sample_max: 9,
  foreground_search_radius_multiplier: 2,
  alpha_min_channel_delta: 0.05,
  alpha_max_mad: 0.1,
  hard_alpha_threshold: 0.5,
})

export const BACKGROUND_SPILL_OVERLAY_LEGEND = Object.freeze({
  visible_background_like: Object.freeze({ priority: 1, rgba: Object.freeze([255, 0, 255, 255]) }),
  possible_spill: Object.freeze({ priority: 2, rgba: Object.freeze([255, 0, 64, 255]) }),
  low_confidence: Object.freeze({ priority: 3, rgba: Object.freeze([255, 128, 0, 255]) }),
  solved_unknown: Object.freeze({ priority: 4, rgba: Object.freeze([0, 180, 255, 255]) }),
  exterior_shoulder_singleton: Object.freeze({ priority: 5, rgba: Object.freeze([0, 255, 128, 255]) }),
  exterior_fringe_hard_clear: Object.freeze({ priority: 6, rgba: Object.freeze([64, 128, 255, 255]) }),
  background_supported_clear: Object.freeze({ priority: 7, rgba: Object.freeze([176, 64, 255, 255]) }),
  protected_light_foreground: Object.freeze({ priority: 8, rgba: Object.freeze([255, 224, 0, 255]) }),
  sure_background: Object.freeze({ priority: 9, rgba: Object.freeze([0, 0, 0, 0]) }),
})

export const BACKGROUND_MATTE_V2_IMAGE_LIMITS = Object.freeze({
  max_width: 4096,
  max_height: 4096,
  max_pixels: 2048 * 2048,
})

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function srgbChannelToLinearByte(value) {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function linearChannelToSrgbByte(value) {
  const channel = clamp(value)
  const srgb = channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.round(clamp(srgb) * 255)
}

function rgbBytesToLinear(rgb) {
  return rgb.map(srgbChannelToLinearByte)
}

function rgbBytesToOklab(rgb) {
  const [r, g, b] = rgbBytesToLinear(rgb)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function mean(items, selector) {
  if (!items.length) return 0
  return items.reduce((sum, item) => sum + selector(item), 0) / items.length
}

function meanVector(items, selector, length = 3) {
  if (!items.length) return Array.from({ length }, () => 0)
  return Array.from({ length }, (_, channel) => mean(items, (item) => selector(item)[channel]))
}

function percentile(sorted, quantile) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}

function median(values) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function canonicalJsonHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function imageBytes(image) {
  const header = Buffer.allocUnsafe(8)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  return Buffer.concat([header, Buffer.from(image.data)])
}

export function assertBackgroundMatteV2Dimensions(
  image,
  limits = BACKGROUND_MATTE_V2_IMAGE_LIMITS,
) {
  if (
    !Number.isSafeInteger(image?.width) ||
    !Number.isSafeInteger(image?.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > limits.max_width ||
    image.height > limits.max_height ||
    image.width * image.height > limits.max_pixels
  ) {
    throw new Error(
      `Background Matte V2 image exceeds ${limits.max_width}x${limits.max_height}/${limits.max_pixels} pixel budget`,
    )
  }
  return true
}

export function assertBackgroundMatteV2ImageBudget(
  image,
  limits = BACKGROUND_MATTE_V2_IMAGE_LIMITS,
) {
  assertBackgroundMatteV2Dimensions(image, limits)
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('Background Matte V2 RGBA input is malformed')
  }
  return true
}

function inspectHardPixelMatte(image) {
  let transparent = 0
  let opaque = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3]
    if (alpha === 0) {
      transparent++
      if (image.data[offset] || image.data[offset + 1] || image.data[offset + 2]) {
        return { detected: false, transparent, opaque, reason: 'transparent_rgb_not_zero' }
      }
    } else if (alpha === 255) {
      opaque++
    } else {
      return { detected: false, transparent, opaque, reason: 'partial_alpha_present' }
    }
  }
  return {
    detected: transparent > 0 && opaque > 0,
    transparent,
    opaque,
    reason: transparent > 0 && opaque > 0 ? null : 'hard_matte_partition_missing',
  }
}

function assertBackgroundAlphaIntegrity(image) {
  let transparentNonzeroRgbPixels = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      image.data[offset + 3] === 0 &&
      (image.data[offset] || image.data[offset + 1] || image.data[offset + 2])
    ) {
      transparentNonzeroRgbPixels++
    }
  }
  if (transparentNonzeroRgbPixels) {
    throw new Error(
      `Background Matte V2 alpha integrity failed: ${transparentNonzeroRgbPixels} transparent pixels contain nonzero RGB`,
    )
  }
  return { status: 'pass', transparent_nonzero_rgb_pixels: 0 }
}

export function hashRgbaForBackgroundContract(image) {
  return createHash('sha256').update(imageBytes(image)).digest('hex')
}

export function hashBackgroundContractMask(mask, width, height) {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height) {
    throw new Error('background contract mask dimensions are invalid')
  }
  const header = Buffer.allocUnsafe(8)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  return createHash('sha256').update(header).update(mask).digest('hex')
}

function edgeBandCoordinates(width, height, band) {
  const coordinates = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < band || y < band || x >= width - band || y >= height - band) {
        coordinates.push([x, y])
      }
    }
  }
  return coordinates
}

function sampledEdgePixels(image, options) {
  const edgeBand = Math.min(
    Math.min(image.width, image.height),
    Math.max(
      options.edge_band_min,
      Math.min(options.edge_band_max, Math.round(Math.min(image.width, image.height) * options.edge_band_ratio)),
    ),
  )
  const coordinates = edgeBandCoordinates(image.width, image.height, edgeBand)
  const stride = Math.max(1, Math.ceil(coordinates.length / options.edge_sample_limit))
  const samples = []
  for (let index = 0; index < coordinates.length; index += stride) {
    const [x, y] = coordinates[index]
    const offset = (y * image.width + x) * 4
    if (image.data[offset + 3] === 0) continue
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
    samples.push({ x, y, rgb, lab: rgbBytesToOklab(rgb) })
  }
  return { edgeBand, sampleStride: stride, samples }
}

function dominantBackgroundCluster(samples, options) {
  const buckets = new Map()
  for (const sample of samples) {
    const key = sample.lab.map((value) => Math.round(value / options.oklab_bucket_size)).join(',')
    const bucket = buckets.get(key) ?? []
    bucket.push(sample)
    buckets.set(key, bucket)
  }
  const seedBucket = [...buckets.values()].sort((a, b) => b.length - a.length)[0] ?? []
  if (!seedBucket.length) return null
  let center = meanVector(seedBucket, (sample) => sample.lab)
  let cluster = samples.filter((sample) => oklabDistance(sample.lab, center) <= options.oklab_p95_max_distance)
  if (!cluster.length) return null
  center = meanVector(cluster, (sample) => sample.lab)
  cluster = samples.filter((sample) => oklabDistance(sample.lab, center) <= options.oklab_p95_max_distance)
  center = meanVector(cluster, (sample) => sample.lab)
  const distances = cluster.map((sample) => oklabDistance(sample.lab, center)).sort((a, b) => a - b)
  return {
    cluster,
    center,
    p95: percentile(distances, 0.95) ?? Infinity,
    rgb: meanVector(cluster, (sample) => sample.rgb).map(Math.round),
    linear_rgb: meanVector(cluster, (sample) => rgbBytesToLinear(sample.rgb)),
  }
}

function cornerAgreement(image, backgroundLab, edgeBand, options) {
  const size = Math.max(2, Math.min(Math.min(image.width, image.height), edgeBand * 2))
  const origins = [
    [0, 0],
    [Math.max(0, image.width - size), 0],
    [0, Math.max(0, image.height - size)],
    [Math.max(0, image.width - size), Math.max(0, image.height - size)],
  ]
  const corners = origins.map(([originX, originY], index) => {
    let valid = 0
    let matching = 0
    for (let y = originY; y < originY + size; y += 1) {
      for (let x = originX; x < originX + size; x += 1) {
        const offset = (y * image.width + x) * 4
        if (image.data[offset + 3] === 0) continue
        valid++
        const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
        if (oklabDistance(rgbBytesToOklab(rgb), backgroundLab) <= options.oklab_p95_max_distance) matching++
      }
    }
    const share = valid ? matching / valid : 0
    return { index, valid_sample_count: valid, matching_sample_count: matching, matching_share: round(share), agrees: share >= options.corner_agreement_min_share }
  })
  return { size, corners, agreeing_count: corners.filter((corner) => corner.agrees).length }
}

export function analyzeFlatBackgroundV2(image, overrides = {}) {
  const options = { ...BACKGROUND_MATTE_V2_DEFAULTS, ...overrides }
  const edge = sampledEdgePixels(image, options)
  const cluster = dominantBackgroundCluster(edge.samples, options)
  const reasons = []
  if (!cluster) reasons.push('background_cluster_missing')
  const dominantShare = cluster && edge.samples.length ? cluster.cluster.length / edge.samples.length : 0
  const corners = cluster
    ? cornerAgreement(image, cluster.center, edge.edgeBand, options)
    : { size: edge.edgeBand, corners: [], agreeing_count: 0 }
  if (dominantShare < options.dominant_cluster_min_share) reasons.push('background_cluster_share_low')
  if (corners.agreeing_count < options.corner_agreement_min_count) reasons.push('background_corner_agreement_low')
  if (!cluster || cluster.p95 > options.oklab_p95_max_distance) reasons.push('background_cluster_p95_high')
  const eligible = reasons.length === 0
  const analysis = {
    schema_version: 1,
    algorithm: BACKGROUND_MATTE_V2_ALGORITHM,
    status: eligible ? 'eligible_flat_background' : 'passthrough_review',
    eligible,
    reasons,
    edge_band_pixels: edge.edgeBand,
    edge_sample_stride: edge.sampleStride,
    edge_sample_count: edge.samples.length,
    dominant_cluster_count: cluster?.cluster.length ?? 0,
    dominant_cluster_share: round(dominantShare),
    background_rgb: cluster?.rgb ?? null,
    background_linear_rgb: cluster?.linear_rgb.map((value) => round(value)) ?? null,
    background_oklab: cluster?.center.map((value) => round(value)) ?? null,
    oklab_p95_distance: cluster ? round(cluster.p95) : null,
    corner_block_size: corners.size,
    corner_agreement_count: corners.agreeing_count,
    corners: corners.corners,
    thresholds: {
      dominant_cluster_min_share: options.dominant_cluster_min_share,
      corner_agreement_min_count: options.corner_agreement_min_count,
      corner_agreement_min_share: options.corner_agreement_min_share,
      oklab_p95_max_distance: options.oklab_p95_max_distance,
    },
  }
  return { analysis: { ...analysis, sha256: canonicalJsonHash(analysis) }, options }
}

function neighboringIndexes(index, width, height) {
  const x = index % width
  const y = Math.floor(index / width)
  const result = []
  if (x > 0) result.push(index - 1)
  if (x + 1 < width) result.push(index + 1)
  if (y > 0) result.push(index - width)
  if (y + 1 < height) result.push(index + width)
  return result
}

function neighboringIndexes8(index, width, height) {
  const x = index % width
  const y = Math.floor(index / width)
  const result = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      result.push(ny * width + nx)
    }
  }
  return result
}

function frozenPassthroughMasks(image) {
  const total = image.width * image.height
  const sureBackground = new Uint8Array(total)
  const sureForeground = new Uint8Array(total).fill(1)
  return {
    sureBackground,
    unknownBand: new Uint8Array(total),
    sureForeground,
    allowedMutation: new Uint8Array(total),
    unknownDistance: new Uint8Array(total),
    unknownBandWidth: 0,
    coreSureBackground: sureBackground,
    exteriorBackgroundCandidate: new Uint8Array(total),
    exteriorUnknown: new Uint8Array(total),
    exteriorShoulderSingleton: new Uint8Array(total),
    exteriorFringeHardClear: new Uint8Array(total),
    backgroundSupportedClear: new Uint8Array(total),
    protectedLightForeground: new Uint8Array(total),
    foregroundSamplingAuthority: new Uint8Array(sureForeground),
    weakBackgroundDistance: null,
    shoulderBackgroundDistance: null,
    fringeBackgroundDistance: null,
  }
}

function frozenHardPixelMasks(image) {
  const total = image.width * image.height
  const sureBackground = new Uint8Array(total)
  const unknownBand = new Uint8Array(total)
  const sureForeground = new Uint8Array(total)
  const allowedMutation = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    if (image.data[index * 4 + 3] === 0) {
      sureBackground[index] = 1
      allowedMutation[index] = 1
    } else {
      sureForeground[index] = 1
    }
  }
  return {
    sureBackground,
    unknownBand,
    sureForeground,
    allowedMutation,
    unknownDistance: new Uint8Array(total),
    unknownBandWidth: 0,
    coreSureBackground: sureBackground,
    exteriorBackgroundCandidate: new Uint8Array(sureBackground),
    exteriorUnknown: new Uint8Array(total),
    exteriorShoulderSingleton: new Uint8Array(total),
    exteriorFringeHardClear: new Uint8Array(total),
    backgroundSupportedClear: new Uint8Array(total),
    protectedLightForeground: new Uint8Array(total),
    foregroundSamplingAuthority: new Uint8Array(sureForeground),
    weakBackgroundDistance: null,
    shoulderBackgroundDistance: null,
    fringeBackgroundDistance: null,
  }
}

function classifyExteriorShoulderSingletons({
  image,
  provisionalSureForeground,
  exteriorBackgroundCandidate,
  backgroundLab,
  weakBackgroundDistance,
  analysis,
  options,
}) {
  const total = image.width * image.height
  const candidateMask = new Uint8Array(total)
  const result = new Uint8Array(total)
  const backgroundP95Distance = Math.max(0, Number(analysis?.oklab_p95_distance ?? 0))
  const shoulderBackgroundDistance = Math.min(
    backgroundSpillDistance(analysis),
    weakBackgroundDistance + backgroundP95Distance,
  )
  if (shoulderBackgroundDistance <= weakBackgroundDistance) {
    return { mask: result, shoulderBackgroundDistance }
  }
  const hardAlphaByte = Math.round(clamp(options.hard_alpha_threshold) * 255)
  for (let index = 0; index < total; index += 1) {
    if (!provisionalSureForeground[index] || image.data[index * 4 + 3] < hardAlphaByte) continue
    const offset = index * 4
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
    const distance = oklabDistance(rgbBytesToOklab(rgb), backgroundLab)
    if (distance > weakBackgroundDistance && distance <= shoulderBackgroundDistance) {
      candidateMask[index] = 1
    }
  }

  const visited = new Uint8Array(total)
  for (let start = 0; start < total; start += 1) {
    if (!candidateMask[start] || visited[start]) continue
    const component = [start]
    visited[start] = 1
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      for (const neighbor of neighboringIndexes8(component[cursor], image.width, image.height)) {
        if (!candidateMask[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        component.push(neighbor)
      }
    }
    if (component.length !== 1) continue
    const exteriorRingPixels = neighboringIndexes8(start, image.width, image.height)
      .reduce((count, neighbor) => count + (exteriorBackgroundCandidate[neighbor] ? 1 : 0), 0)
    if (exteriorRingPixels >= 2) result[start] = 1
  }
  return { mask: result, shoulderBackgroundDistance }
}

function classifyExteriorFringeHardClear({
  image,
  provisionalSureForeground,
  exteriorBackgroundCandidate,
  backgroundLab,
  shoulderBackgroundDistance,
  analysis,
  options,
}) {
  const total = image.width * image.height
  const result = new Uint8Array(total)
  const fringeBackgroundDistance = backgroundSpillDistance(analysis)
  if (fringeBackgroundDistance <= shoulderBackgroundDistance) {
    return { mask: result, fringeBackgroundDistance }
  }
  const hardAlphaByte = Math.round(clamp(options.hard_alpha_threshold) * 255)
  for (let index = 0; index < total; index += 1) {
    if (!provisionalSureForeground[index] || image.data[index * 4 + 3] < hardAlphaByte) continue
    const offset = index * 4
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
    const distance = oklabDistance(rgbBytesToOklab(rgb), backgroundLab)
    if (distance <= shoulderBackgroundDistance || distance > fringeBackgroundDistance) continue
    const touchesBaseExterior = neighboringIndexes8(index, image.width, image.height)
      .some((neighbor) => exteriorBackgroundCandidate[neighbor])
    if (touchesBaseExterior) result[index] = 1
  }
  return { mask: result, fringeBackgroundDistance }
}

export function freezeBackgroundContractMasks(image, analysis, options = BACKGROUND_MATTE_V2_DEFAULTS) {
  if (!analysis?.eligible || !analysis.background_oklab) {
    return finalizeFrozenMasks(image, frozenPassthroughMasks(image), analysis)
  }
  const total = image.width * image.height
  const sureBackground = new Uint8Array(total)
  const visited = new Uint8Array(total)
  const queue = []
  const backgroundLab = analysis.background_oklab
  const sureDistance = Math.min(
    options.oklab_p95_max_distance,
    Math.max(0.012, Number(analysis.oklab_p95_distance ?? 0) * 1.5),
  )
  const matches = (index) => {
    const offset = index * 4
    if (image.data[offset + 3] === 0) return true
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
    return oklabDistance(rgbBytesToOklab(rgb), backgroundLab) <= sureDistance
  }
  const push = (index) => {
    if (visited[index]) return
    visited[index] = 1
    if (matches(index)) queue.push(index)
  }
  for (let x = 0; x < image.width; x += 1) {
    push(x)
    push((image.height - 1) * image.width + x)
  }
  for (let y = 0; y < image.height; y += 1) {
    push(y * image.width)
    push(y * image.width + image.width - 1)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    sureBackground[index] = 1
    for (const neighbor of neighboringIndexes(index, image.width, image.height)) push(neighbor)
  }

  const weakBackgroundDistance = Math.max(sureDistance, options.oklab_p95_max_distance)
  const exteriorBackgroundCandidate = new Uint8Array(total)
  visited.fill(0)
  queue.length = 0
  for (let index = 0; index < total; index += 1) {
    if (!sureBackground[index]) continue
    visited[index] = 1
    exteriorBackgroundCandidate[index] = 1
    queue.push(index)
  }
  const pushWeakCandidate = (index) => {
    if (visited[index]) return
    visited[index] = 1
    const offset = index * 4
    const matchesWeakBackground = image.data[offset + 3] === 0 || oklabDistance(
      rgbBytesToOklab([image.data[offset], image.data[offset + 1], image.data[offset + 2]]),
      backgroundLab,
    ) <= weakBackgroundDistance
    if (!matchesWeakBackground) return
    exteriorBackgroundCandidate[index] = 1
    queue.push(index)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    for (const neighbor of neighboringIndexes(index, image.width, image.height)) {
      pushWeakCandidate(neighbor)
    }
  }
  const exteriorUnknown = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    if (exteriorBackgroundCandidate[index] && !sureBackground[index]) exteriorUnknown[index] = 1
  }

  const sourceScale = Math.max(image.width, image.height) / 1024
  const unknownBandWidth = Math.max(
    options.unknown_band_min,
    Math.min(options.unknown_band_max, Math.round(sourceScale * options.unknown_band_scale)),
  )
  const unknownBand = new Uint8Array(total)
  const unknownDistance = new Uint8Array(total)
  const bandQueue = []
  for (let index = 0; index < total; index += 1) {
    if (!sureBackground[index]) continue
    for (const neighbor of neighboringIndexes(index, image.width, image.height)) {
      if (sureBackground[neighbor] || unknownDistance[neighbor]) continue
      unknownDistance[neighbor] = 1
      unknownBand[neighbor] = 1
      bandQueue.push(neighbor)
    }
  }
  for (let cursor = 0; cursor < bandQueue.length; cursor += 1) {
    const index = bandQueue[cursor]
    const distance = unknownDistance[index]
    if (distance >= unknownBandWidth) continue
    for (const neighbor of neighboringIndexes(index, image.width, image.height)) {
      if (sureBackground[neighbor] || unknownDistance[neighbor]) continue
      unknownDistance[neighbor] = distance + 1
      unknownBand[neighbor] = 1
      bandQueue.push(neighbor)
    }
  }
  for (let index = 0; index < total; index += 1) {
    if (exteriorUnknown[index]) unknownBand[index] = 1
  }
  const provisionalSureForeground = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    if (!sureBackground[index] && !unknownBand[index]) provisionalSureForeground[index] = 1
  }
  const {
    mask: exteriorShoulderSingleton,
    shoulderBackgroundDistance,
  } = classifyExteriorShoulderSingletons({
    image,
    provisionalSureForeground,
    exteriorBackgroundCandidate,
    backgroundLab,
    weakBackgroundDistance,
    analysis,
    options,
  })
  const {
    mask: exteriorFringeHardClear,
    fringeBackgroundDistance,
  } = classifyExteriorFringeHardClear({
    image,
    provisionalSureForeground,
    exteriorBackgroundCandidate,
    backgroundLab,
    shoulderBackgroundDistance,
    analysis,
    options,
  })
  for (let index = 0; index < total; index += 1) {
    if (exteriorShoulderSingleton[index] || exteriorFringeHardClear[index]) {
      unknownBand[index] = 1
    }
  }
  const sureForeground = new Uint8Array(total)
  const allowedMutation = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    if (!sureBackground[index] && !unknownBand[index]) sureForeground[index] = 1
    if (sureBackground[index] || unknownBand[index]) allowedMutation[index] = 1
  }
  const backgroundSupportedClear = new Uint8Array(exteriorUnknown)
  for (let index = 0; index < total; index += 1) {
    if (exteriorShoulderSingleton[index] || exteriorFringeHardClear[index]) {
      backgroundSupportedClear[index] = 1
    }
  }
  const protectedLightForeground = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    if (!sureForeground[index] || exteriorBackgroundCandidate[index]) continue
    const offset = index * 4
    if (image.data[offset + 3] === 0) continue
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
    if (oklabDistance(rgbBytesToOklab(rgb), backgroundLab) <= weakBackgroundDistance) {
      protectedLightForeground[index] = 1
    }
  }
  return finalizeFrozenMasks(image, {
    sureBackground,
    unknownBand,
    sureForeground,
    allowedMutation,
    unknownDistance,
    unknownBandWidth,
    sureDistance,
    coreSureBackground: sureBackground,
    exteriorBackgroundCandidate,
    exteriorUnknown,
    exteriorShoulderSingleton,
    exteriorFringeHardClear,
    backgroundSupportedClear,
    protectedLightForeground,
    foregroundSamplingAuthority: provisionalSureForeground,
    weakBackgroundDistance,
    shoulderBackgroundDistance,
    fringeBackgroundDistance,
  }, analysis)
}

function maskCount(mask) {
  let count = 0
  for (const value of mask) count += value ? 1 : 0
  return count
}

function assertExteriorShoulderSingletonContract(
  source,
  masks,
  analysis,
  options = BACKGROUND_MATTE_V2_DEFAULTS,
) {
  const report = masks.report
  if (!analysis?.eligible || !analysis.background_oklab) {
    if (
      maskCount(masks.exteriorShoulderSingleton) !== 0 ||
      report.shoulder_background_distance !== null
    ) {
      throw new Error('background contract ineligible Shoulder state changed')
    }
    return true
  }
  if (report.background_analysis_sha256 !== analysis.sha256) {
    throw new Error('background contract Shoulder analysis binding changed')
  }
  const sureDistance = Math.min(
    options.oklab_p95_max_distance,
    Math.max(0.012, Number(analysis.oklab_p95_distance ?? 0) * 1.5),
  )
  const weakBackgroundDistance = Math.max(sureDistance, options.oklab_p95_max_distance)
  const shoulderBackgroundDistance = Math.min(
    backgroundSpillDistance(analysis),
    weakBackgroundDistance + Math.max(0, Number(analysis.oklab_p95_distance ?? 0)),
  )
  if (
    report.sure_background_distance !== round(sureDistance) ||
    report.weak_background_distance !== round(weakBackgroundDistance) ||
    report.shoulder_background_distance !== round(shoulderBackgroundDistance)
  ) {
    throw new Error('background contract Shoulder distance formula changed')
  }

  const total = source.width * source.height
  const hardAlphaByte = Math.round(clamp(options.hard_alpha_threshold) * 255)
  const candidateMask = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) {
    const provisionalSureForeground = masks.sureForeground[index] ||
      masks.exteriorShoulderSingleton[index] || masks.exteriorFringeHardClear[index]
    if (!provisionalSureForeground || source.data[index * 4 + 3] < hardAlphaByte) continue
    const offset = index * 4
    const rgb = [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
    const distance = oklabDistance(rgbBytesToOklab(rgb), analysis.background_oklab)
    if (distance > weakBackgroundDistance && distance <= shoulderBackgroundDistance) {
      candidateMask[index] = 1
    }
  }
  const expectedMask = new Uint8Array(total)
  const visited = new Uint8Array(total)
  for (let start = 0; start < total; start += 1) {
    if (!candidateMask[start] || visited[start]) continue
    const component = [start]
    visited[start] = 1
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      for (const neighbor of neighboringIndexes8(component[cursor], source.width, source.height)) {
        if (!candidateMask[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        component.push(neighbor)
      }
    }
    if (component.length !== 1) continue
    const exteriorRingPixels = neighboringIndexes8(start, source.width, source.height)
      .reduce((count, neighbor) => count + (masks.exteriorBackgroundCandidate[neighbor] ? 1 : 0), 0)
    if (exteriorRingPixels >= 2) expectedMask[start] = 1
  }
  for (let index = 0; index < total; index += 1) {
    if (masks.exteriorShoulderSingleton[index] !== expectedMask[index]) {
      throw new Error('background contract Shoulder source predicate changed')
    }
  }
  return true
}

function assertExteriorFringeHardClearContract(
  source,
  masks,
  analysis,
  options = BACKGROUND_MATTE_V2_DEFAULTS,
) {
  const report = masks.report
  if (!analysis?.eligible || !analysis.background_oklab) {
    if (
      maskCount(masks.exteriorFringeHardClear) !== 0 ||
      report.fringe_background_distance !== null
    ) {
      throw new Error('background contract ineligible Fringe Hard Clear state changed')
    }
    return true
  }
  if (report.background_analysis_sha256 !== analysis.sha256) {
    throw new Error('background contract Fringe Hard Clear analysis binding changed')
  }
  const sureDistance = Math.min(
    options.oklab_p95_max_distance,
    Math.max(0.012, Number(analysis.oklab_p95_distance ?? 0) * 1.5),
  )
  const weakBackgroundDistance = Math.max(sureDistance, options.oklab_p95_max_distance)
  const shoulderBackgroundDistance = Math.min(
    backgroundSpillDistance(analysis),
    weakBackgroundDistance + Math.max(0, Number(analysis.oklab_p95_distance ?? 0)),
  )
  const fringeBackgroundDistance = backgroundSpillDistance(analysis)
  if (report.fringe_background_distance !== round(fringeBackgroundDistance)) {
    throw new Error('background contract Fringe Hard Clear distance formula changed')
  }

  const hardAlphaByte = Math.round(clamp(options.hard_alpha_threshold) * 255)
  for (let index = 0; index < source.width * source.height; index += 1) {
    const provisionalSureForeground = masks.sureForeground[index] ||
      masks.exteriorShoulderSingleton[index] || masks.exteriorFringeHardClear[index]
    let expected = 0
    if (provisionalSureForeground && source.data[index * 4 + 3] >= hardAlphaByte) {
      const offset = index * 4
      const rgb = [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
      const distance = oklabDistance(rgbBytesToOklab(rgb), analysis.background_oklab)
      if (distance > shoulderBackgroundDistance && distance <= fringeBackgroundDistance) {
        expected = neighboringIndexes8(index, source.width, source.height)
          .some((neighbor) => masks.exteriorBackgroundCandidate[neighbor]) ? 1 : 0
      }
    }
    if (masks.exteriorFringeHardClear[index] !== expected) {
      throw new Error('background contract Fringe Hard Clear source predicate changed')
    }
  }
  return true
}

export function assertFrozenBackgroundContractMasks(
  source,
  masks,
  { analysis = null, options = BACKGROUND_MATTE_V2_DEFAULTS } = {},
) {
  const report = masks?.report
  if (
    !report?.frozen_before_mutation ||
    report.classification_revision !== BACKGROUND_MATTE_V2_CLASSIFICATION_REVISION ||
    report.width !== source.width ||
    report.height !== source.height
  ) {
    throw new Error('background contract mask report is missing or malformed')
  }
  if (
    report.shoulder_component_connectivity !== 8 ||
    report.shoulder_component_pixel_count !== 1 ||
    report.shoulder_min_base_exterior_ring_pixels !== 2 ||
    report.shoulder_nonrecursive !== true ||
    report.fringe_ring_connectivity !== 8 ||
    report.fringe_min_base_exterior_ring_pixels !== 1 ||
    report.fringe_nonrecursive !== true ||
    report.foreground_sampling_revision !== BACKGROUND_MATTE_V2_FOREGROUND_SAMPLING_REVISION
  ) {
    throw new Error('background contract Shoulder component contract changed')
  }
  if (report.source_sha256 !== hashRgbaForBackgroundContract(source)) {
    throw new Error('background contract source hash changed')
  }
  const entries = [
    ['sure_background', masks.sureBackground],
    ['unknown_band', masks.unknownBand],
    ['sure_foreground', masks.sureForeground],
    ['allowed_mutation', masks.allowedMutation],
  ]
  for (const [name, mask] of entries) {
    const expected = report.masks?.[name]
    if (!expected || expected.pixel_count !== maskCount(mask) ||
        expected.sha256 !== hashBackgroundContractMask(mask, source.width, source.height)) {
      throw new Error(`background contract mask hash changed: ${name}`)
    }
  }
  const derivedEntries = [
    ['core_sure_background', masks.coreSureBackground],
    ['exterior_background_candidate', masks.exteriorBackgroundCandidate],
    ['exterior_unknown', masks.exteriorUnknown],
    ['exterior_shoulder_singleton', masks.exteriorShoulderSingleton],
    ['exterior_fringe_hard_clear', masks.exteriorFringeHardClear],
    ['background_supported_clear', masks.backgroundSupportedClear],
    ['protected_light_foreground', masks.protectedLightForeground],
    ['foreground_sampling_authority', masks.foregroundSamplingAuthority],
  ]
  for (const [name, mask] of derivedEntries) {
    const expected = report.derived_masks?.[name]
    if (!expected || expected.pixel_count !== maskCount(mask) ||
        expected.sha256 !== hashBackgroundContractMask(mask, source.width, source.height)) {
      throw new Error(`background contract derived mask hash changed: ${name}`)
    }
  }
  for (let index = 0; index < source.width * source.height; index += 1) {
    if (masks.coreSureBackground[index] !== masks.sureBackground[index]) {
      throw new Error('background contract core Sure Background is inconsistent')
    }
    if (masks.sureBackground[index] && !masks.exteriorBackgroundCandidate[index]) {
      throw new Error('background contract exterior candidate omits core background')
    }
    const expectedExteriorUnknown = masks.exteriorBackgroundCandidate[index] &&
      !masks.sureBackground[index] ? 1 : 0
    if (masks.exteriorUnknown[index] !== expectedExteriorUnknown ||
        (masks.exteriorUnknown[index] && !masks.unknownBand[index])) {
      throw new Error('background contract exterior Unknown is inconsistent')
    }
    if (masks.exteriorShoulderSingleton[index]) {
      if (
        masks.exteriorBackgroundCandidate[index] ||
        !masks.unknownBand[index] ||
        masks.sureForeground[index]
      ) {
        throw new Error('background contract exterior Shoulder Singleton is inconsistent')
      }
      const sameMaskNeighbors = neighboringIndexes8(index, source.width, source.height)
        .filter((neighbor) => masks.exteriorShoulderSingleton[neighbor]).length
      const exteriorRingPixels = neighboringIndexes8(index, source.width, source.height)
        .filter((neighbor) => masks.exteriorBackgroundCandidate[neighbor]).length
      if (sameMaskNeighbors !== 0 || exteriorRingPixels < 2) {
        throw new Error('background contract exterior Shoulder Singleton proof changed')
      }
    }
    if (masks.exteriorFringeHardClear[index]) {
      if (
        masks.exteriorBackgroundCandidate[index] ||
        masks.exteriorShoulderSingleton[index] ||
        !masks.unknownBand[index] ||
        masks.sureForeground[index]
      ) {
        throw new Error('background contract exterior Fringe Hard Clear is inconsistent')
      }
      const exteriorRingPixels = neighboringIndexes8(index, source.width, source.height)
        .filter((neighbor) => masks.exteriorBackgroundCandidate[neighbor]).length
      if (exteriorRingPixels < 1) {
        throw new Error('background contract exterior Fringe Hard Clear proof changed')
      }
    }
    const expectedSupportedClear = masks.exteriorUnknown[index] ||
      masks.exteriorShoulderSingleton[index] || masks.exteriorFringeHardClear[index] ? 1 : 0
    if (masks.backgroundSupportedClear[index] !== expectedSupportedClear) {
      throw new Error('background contract supported clear does not match its frozen subsets')
    }
    if (masks.protectedLightForeground[index] &&
        (!masks.sureForeground[index] || masks.exteriorBackgroundCandidate[index])) {
      throw new Error('background contract protected light foreground is inconsistent')
    }
    const expectedForegroundSamplingAuthority = masks.sureForeground[index] ||
      masks.exteriorShoulderSingleton[index] || masks.exteriorFringeHardClear[index] ? 1 : 0
    if (masks.foregroundSamplingAuthority[index] !== expectedForegroundSamplingAuthority) {
      throw new Error('background contract foreground sampling authority changed')
    }
  }
  if (analysis) {
    assertExteriorShoulderSingletonContract(source, masks, analysis, options)
    assertExteriorFringeHardClearContract(source, masks, analysis, options)
  }
  return true
}

function finalizeFrozenMasks(image, masks, analysis) {
  const values = [masks.sureBackground, masks.unknownBand, masks.sureForeground]
  let unclassified = 0
  let multiplyClassified = 0
  for (let index = 0; index < image.width * image.height; index += 1) {
    const classes = values.reduce((sum, mask) => sum + (mask[index] ? 1 : 0), 0)
    if (classes === 0) unclassified++
    if (classes > 1) multiplyClassified++
  }
  if (unclassified || multiplyClassified) throw new Error('background contract masks do not form a complete partition')
  for (let index = 0; index < masks.allowedMutation.length; index += 1) {
    const expected = masks.sureBackground[index] || masks.unknownBand[index] ? 1 : 0
    if (masks.allowedMutation[index] !== expected) throw new Error('allowed mutation mask is inconsistent')
  }
  return {
    ...masks,
    report: {
      schema_version: 1,
      algorithm: BACKGROUND_MATTE_V2_ALGORITHM,
      classification_revision: BACKGROUND_MATTE_V2_CLASSIFICATION_REVISION,
      frozen_before_mutation: true,
      source_sha256: hashRgbaForBackgroundContract(image),
      background_analysis_sha256: analysis?.sha256 ?? null,
      width: image.width,
      height: image.height,
      unknown_band_width: masks.unknownBandWidth,
      sure_background_distance: masks.sureDistance == null ? null : round(masks.sureDistance),
      weak_background_distance: masks.weakBackgroundDistance == null
        ? null
        : round(masks.weakBackgroundDistance),
      shoulder_background_distance: masks.shoulderBackgroundDistance == null
        ? null
        : round(masks.shoulderBackgroundDistance),
      fringe_background_distance: masks.fringeBackgroundDistance == null
        ? null
        : round(masks.fringeBackgroundDistance),
      shoulder_component_connectivity: 8,
      shoulder_component_pixel_count: 1,
      shoulder_min_base_exterior_ring_pixels: 2,
      shoulder_nonrecursive: true,
      fringe_ring_connectivity: 8,
      fringe_min_base_exterior_ring_pixels: 1,
      fringe_nonrecursive: true,
      foreground_sampling_revision: BACKGROUND_MATTE_V2_FOREGROUND_SAMPLING_REVISION,
      unclassified_pixel_count: unclassified,
      multiply_classified_pixel_count: multiplyClassified,
      masks: {
        sure_background: { pixel_count: maskCount(masks.sureBackground), sha256: hashBackgroundContractMask(masks.sureBackground, image.width, image.height) },
        unknown_band: { pixel_count: maskCount(masks.unknownBand), sha256: hashBackgroundContractMask(masks.unknownBand, image.width, image.height) },
        sure_foreground: { pixel_count: maskCount(masks.sureForeground), sha256: hashBackgroundContractMask(masks.sureForeground, image.width, image.height) },
        allowed_mutation: { pixel_count: maskCount(masks.allowedMutation), sha256: hashBackgroundContractMask(masks.allowedMutation, image.width, image.height) },
      },
      derived_masks: {
        core_sure_background: { pixel_count: maskCount(masks.coreSureBackground), sha256: hashBackgroundContractMask(masks.coreSureBackground, image.width, image.height) },
        exterior_background_candidate: { pixel_count: maskCount(masks.exteriorBackgroundCandidate), sha256: hashBackgroundContractMask(masks.exteriorBackgroundCandidate, image.width, image.height) },
        exterior_unknown: { pixel_count: maskCount(masks.exteriorUnknown), sha256: hashBackgroundContractMask(masks.exteriorUnknown, image.width, image.height) },
        exterior_shoulder_singleton: { pixel_count: maskCount(masks.exteriorShoulderSingleton), sha256: hashBackgroundContractMask(masks.exteriorShoulderSingleton, image.width, image.height) },
        exterior_fringe_hard_clear: { pixel_count: maskCount(masks.exteriorFringeHardClear), sha256: hashBackgroundContractMask(masks.exteriorFringeHardClear, image.width, image.height) },
        background_supported_clear: { pixel_count: maskCount(masks.backgroundSupportedClear), sha256: hashBackgroundContractMask(masks.backgroundSupportedClear, image.width, image.height) },
        protected_light_foreground: { pixel_count: maskCount(masks.protectedLightForeground), sha256: hashBackgroundContractMask(masks.protectedLightForeground, image.width, image.height) },
        foreground_sampling_authority: { pixel_count: maskCount(masks.foregroundSamplingAuthority), sha256: hashBackgroundContractMask(masks.foregroundSamplingAuthority, image.width, image.height) },
      },
    },
  }
}

function foregroundSamples(image, masks, index, options) {
  const x = index % image.width
  const y = Math.floor(index / image.width)
  const radius = Math.max(
    1,
    masks.unknownBandWidth * options.foreground_search_radius_multiplier,
  )
  const candidates = []
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.abs(dx) + Math.abs(dy)
      if (!distance || distance > radius) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
      const neighbor = ny * image.width + nx
      if (!masks.foregroundSamplingAuthority[neighbor]) continue
      const offset = neighbor * 4
      if (image.data[offset + 3] === 0) continue
      candidates.push({
        distance,
        rgb: [image.data[offset], image.data[offset + 1], image.data[offset + 2]],
      })
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates.slice(0, options.foreground_sample_max)
}

function solveUnknownPixel(image, masks, index, backgroundLinear, options) {
  const samples = foregroundSamples(image, masks, index, options)
  if (samples.length < options.foreground_sample_min) {
    return { solved: false, reason: 'foreground_samples_insufficient', sample_count: samples.length }
  }
  const foregroundLinear = Array.from({ length: 3 }, (_, channel) => median(
    samples.map((sample) => rgbBytesToLinear(sample.rgb)[channel]),
  ))
  const offset = index * 4
  const compositeLinear = rgbBytesToLinear([
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
  ])
  const alphaEstimates = []
  for (let channel = 0; channel < 3; channel += 1) {
    const denominator = foregroundLinear[channel] - backgroundLinear[channel]
    if (Math.abs(denominator) < options.alpha_min_channel_delta) continue
    const estimate = (compositeLinear[channel] - backgroundLinear[channel]) / denominator
    if (estimate < -0.1 || estimate > 1.1) continue
    alphaEstimates.push(clamp(estimate))
  }
  if (alphaEstimates.length < 2) {
    return { solved: false, reason: 'alpha_channels_insufficient', sample_count: samples.length }
  }
  const alpha = median(alphaEstimates)
  const mad = median(alphaEstimates.map((estimate) => Math.abs(estimate - alpha)))
  if (mad > options.alpha_max_mad) {
    return { solved: false, reason: 'alpha_channel_mad_high', sample_count: samples.length, mad }
  }
  const reconstructed = Array.from({ length: 3 }, (_, channel) => {
    if (alpha <= 1 / 255) return 0
    const value = (compositeLinear[channel] - (1 - alpha) * backgroundLinear[channel]) / alpha
    return linearChannelToSrgbByte(value)
  })
  return {
    solved: true,
    alpha,
    alpha_byte: Math.round(alpha * 255),
    reconstructed,
    foreground_linear: foregroundLinear,
    sample_count: samples.length,
    valid_channel_count: alphaEstimates.length,
    mad,
  }
}

export function evaluateBackgroundScopeIntegrity(
  source,
  output,
  masks,
  { analysis = null, options = BACKGROUND_MATTE_V2_DEFAULTS } = {},
) {
  if (source.width !== output.width || source.height !== output.height) {
    throw new Error('background output dimensions changed')
  }
  assertFrozenBackgroundContractMasks(source, masks, { analysis, options })
  const total = source.width * source.height
  if (
    masks.sureBackground.length !== total ||
    masks.unknownBand.length !== total ||
    masks.sureForeground.length !== total ||
    masks.allowedMutation.length !== total
  ) {
    throw new Error('background contract mask dimensions changed')
  }
  const metrics = {
    sure_foreground_changed_pixels: 0,
    outside_allowed_mutation_mask_changed_pixels: 0,
    unclassified_pixel_count: 0,
    multiply_classified_pixel_count: 0,
    sure_background_remaining_visible_pixels: 0,
    sure_background_nonzero_rgb_pixels: 0,
    background_supported_clear_remaining_visible_pixels: 0,
    background_supported_clear_nonzero_rgb_pixels: 0,
    transparent_nonzero_rgb_pixels: 0,
    changed_pixel_count: 0,
  }
  for (let index = 0; index < total; index += 1) {
    const classes = (masks.sureBackground[index] ? 1 : 0) +
      (masks.unknownBand[index] ? 1 : 0) +
      (masks.sureForeground[index] ? 1 : 0)
    if (!classes) metrics.unclassified_pixel_count++
    if (classes > 1) metrics.multiply_classified_pixel_count++
    const offset = index * 4
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      if (source.data[offset + channel] !== output.data[offset + channel]) changed = true
    }
    if (changed) {
      metrics.changed_pixel_count++
      if (masks.sureForeground[index]) metrics.sure_foreground_changed_pixels++
      if (!masks.allowedMutation[index]) metrics.outside_allowed_mutation_mask_changed_pixels++
    }
    if (masks.sureBackground[index] && output.data[offset + 3] !== 0) {
      metrics.sure_background_remaining_visible_pixels++
    }
    if (masks.sureBackground[index] && (output.data[offset] || output.data[offset + 1] || output.data[offset + 2])) {
      metrics.sure_background_nonzero_rgb_pixels++
    }
    if (masks.backgroundSupportedClear[index] && output.data[offset + 3] !== 0) {
      metrics.background_supported_clear_remaining_visible_pixels++
    }
    if (masks.backgroundSupportedClear[index] && (output.data[offset] || output.data[offset + 1] || output.data[offset + 2])) {
      metrics.background_supported_clear_nonzero_rgb_pixels++
    }
    if (output.data[offset + 3] === 0 && (output.data[offset] || output.data[offset + 1] || output.data[offset + 2])) {
      metrics.transparent_nonzero_rgb_pixels++
    }
  }
  const passed = Object.entries(metrics).every(([key, value]) => (
    key === 'changed_pixel_count' || key === 'transparent_nonzero_rgb_pixels' || value === 0
  ))
  return { status: passed ? 'pass' : 'fail', passed, metrics }
}

function affectedBoundingBox(mask, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const x = index % width
    const y = Math.floor(index / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return maxX < minX ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function visiblePixelMetrics(image) {
  const mask = new Uint8Array(image.width * image.height)
  for (let index = 0; index < mask.length; index += 1) {
    if (image.data[index * 4 + 3] > 0) mask[index] = 1
  }
  return {
    pixel_count: maskCount(mask),
    bbox: affectedBoundingBox(mask, image.width, image.height),
  }
}

function maskComponentCount8(mask, width, height) {
  const visited = new Uint8Array(mask.length)
  let components = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    components++
    const queue = [start]
    visited[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const neighbor = ny * width + nx
          if (!mask[neighbor] || visited[neighbor]) continue
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
  }
  return components
}

function backgroundSpillDistance(analysis) {
  return Math.max(
    0.06,
    Number(analysis?.thresholds?.oklab_p95_max_distance ?? 0.04) * 2,
  )
}

export function buildVisibleBackgroundResidueDiagnostics(
  source,
  output,
  masks,
  analysis,
  options = BACKGROUND_MATTE_V2_DEFAULTS,
) {
  const visibleBackgroundLikeMask = new Uint8Array(output.width * output.height)
  let alphaGe128Pixels = 0
  let directExteriorVisiblePixels = 0
  let adjacentSureForegroundPixels = 0
  let protectedLightOverlapPixels = 0
  const byContractClass = {
    sure_background: 0,
    unknown_band: 0,
    sure_foreground: 0,
  }
  const backgroundLab = analysis?.background_oklab ?? null
  const spillDistance = backgroundSpillDistance(analysis)
  const hardAlphaByte = Math.round(clamp(options.hard_alpha_threshold) * 255)
  for (let index = 0; index < visibleBackgroundLikeMask.length; index += 1) {
    const alpha = output.data[index * 4 + 3]
    if (alpha === 0) continue
    let isVisibleBackgroundLike = false
    if (masks.exteriorBackgroundCandidate[index]) {
      isVisibleBackgroundLike = true
      directExteriorVisiblePixels++
    } else if (
      backgroundLab &&
      masks.sureForeground[index] &&
      alpha >= hardAlphaByte &&
      source.data[index * 4 + 3] >= hardAlphaByte
    ) {
      const x = index % output.width
      const y = Math.floor(index / output.width)
      let touchesExteriorCandidate = false
      for (let ny = Math.max(0, y - 1); ny <= Math.min(output.height - 1, y + 1); ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(output.width - 1, x + 1); nx += 1) {
          if (nx === x && ny === y) continue
          if (masks.exteriorBackgroundCandidate[ny * output.width + nx]) {
            touchesExteriorCandidate = true
            break
          }
        }
        if (touchesExteriorCandidate) break
      }
      if (touchesExteriorCandidate) {
        const offset = index * 4
        const sourceRgb = [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
        if (oklabDistance(rgbBytesToOklab(sourceRgb), backgroundLab) <= spillDistance) {
          isVisibleBackgroundLike = true
          adjacentSureForegroundPixels++
          if (masks.protectedLightForeground[index]) protectedLightOverlapPixels++
        }
      }
    }
    if (!isVisibleBackgroundLike) continue
    visibleBackgroundLikeMask[index] = 1
    if (alpha >= 128) alphaGe128Pixels++
    if (masks.sureBackground[index]) byContractClass.sure_background++
    if (masks.unknownBand[index]) byContractClass.unknown_band++
    if (masks.sureForeground[index]) byContractClass.sure_foreground++
  }
  const visiblePixels = maskCount(visibleBackgroundLikeMask)
  return {
    evidence: {
      status: visiblePixels ? 'needs_review' : 'pass',
      candidate_definition: 'visible_exterior_or_adjacent_background_like_sure_foreground_v1',
      participates_in_activation_gate: true,
      spill_oklab_distance: round(spillDistance),
      hard_alpha_threshold_byte: hardAlphaByte,
      visible_pixel_count: visiblePixels,
      alpha_ge_128_pixel_count: alphaGe128Pixels,
      direct_exterior_visible_pixel_count: directExteriorVisiblePixels,
      adjacent_sure_foreground_pixel_count: adjacentSureForegroundPixels,
      protected_light_overlap_pixel_count: protectedLightOverlapPixels,
      component_count_8: maskComponentCount8(
        visibleBackgroundLikeMask,
        output.width,
        output.height,
      ),
      bbox: affectedBoundingBox(visibleBackgroundLikeMask, output.width, output.height),
      by_contract_class: byContractClass,
    },
    visibleBackgroundLikeMask,
  }
}

function bboxEdgeShift(before, after) {
  if (!before && !after) return 0
  if (!before || !after) return null
  return Math.max(
    Math.abs(before.x - after.x),
    Math.abs(before.y - after.y),
    Math.abs((before.x + before.w) - (after.x + after.w)),
    Math.abs((before.y + before.h) - (after.y + after.h)),
  )
}

function buildBackgroundBoundaryDiagnostics(
  source,
  output,
  masks,
  analysis,
  lowConfidenceMask,
  options = BACKGROUND_MATTE_V2_DEFAULTS,
) {
  const total = output.width * output.height
  const boundaryMask = new Uint8Array(total)
  const spillMask = new Uint8Array(total)
  const sourceCandidateMask = new Uint8Array(total)
  const outputCandidateMask = new Uint8Array(total)
  const contourChangeMask = new Uint8Array(total)
  const backgroundLab = analysis?.background_oklab ?? null
  const spillDistance = backgroundSpillDistance(analysis)
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4
    if (!masks.sureBackground[index] && source.data[offset + 3] > 0) {
      sourceCandidateMask[index] = 1
    }
    if (!masks.sureBackground[index] && output.data[offset + 3] > 0) {
      outputCandidateMask[index] = 1
    }
    if (sourceCandidateMask[index] !== outputCandidateMask[index]) {
      contourChangeMask[index] = 1
    }
    if (output.data[offset + 3] === 0) continue
    const x = index % output.width
    const y = Math.floor(index / output.width)
    const touchesTransparent = x === 0 || y === 0 || x + 1 === output.width || y + 1 === output.height ||
      neighboringIndexes(index, output.width, output.height)
        .some((neighbor) => output.data[neighbor * 4 + 3] === 0)
    if (!touchesTransparent && output.data[offset + 3] === 255) continue
    boundaryMask[index] = 1
    const rgb = [output.data[offset], output.data[offset + 1], output.data[offset + 2]]
    if (
      lowConfidenceMask[index] ||
      (backgroundLab && oklabDistance(rgbBytesToOklab(rgb), backgroundLab) <= spillDistance)
    ) {
      spillMask[index] = 1
    }
  }
  const boundaryPixels = maskCount(boundaryMask)
  const spillPixels = maskCount(spillMask)
  let unknownLostPixels = 0
  let unknownGainedPixels = 0
  for (let index = 0; index < total; index += 1) {
    if (!masks.unknownBand[index]) continue
    if (sourceCandidateMask[index] && !outputCandidateMask[index]) unknownLostPixels++
    if (!sourceCandidateMask[index] && outputCandidateMask[index]) unknownGainedPixels++
  }
  const sourceCandidateBbox = affectedBoundingBox(sourceCandidateMask, output.width, output.height)
  const outputCandidateBbox = affectedBoundingBox(outputCandidateMask, output.width, output.height)
  const sourceComponentCount = maskComponentCount8(sourceCandidateMask, output.width, output.height)
  const outputComponentCount = maskComponentCount8(outputCandidateMask, output.width, output.height)
  const contourChangedPixels = maskCount(contourChangeMask)
  const contourNeedsReview = contourChangedPixels > 0 || sourceComponentCount !== outputComponentCount
  return {
    status: spillPixels || contourNeedsReview ? 'needs_review' : 'pass',
    diagnostic_only: true,
    participates_in_scope_gate: false,
    boundary_pixel_count: boundaryPixels,
    possible_spill_pixel_count: spillPixels,
    possible_spill_ratio: boundaryPixels ? round(spillPixels / boundaryPixels) : 0,
    possible_spill_bbox: affectedBoundingBox(spillMask, output.width, output.height),
    protected_foreground_changed_pixels: masks.report
      ? evaluateBackgroundScopeIntegrity(source, output, masks, { analysis, options })
        .metrics.sure_foreground_changed_pixels
      : null,
    contour: {
      status: contourNeedsReview ? 'needs_review' : 'pass',
      candidate_definition: 'visible_non_sure_background',
      changed_pixel_count: contourChangedPixels,
      unknown_band_lost_pixel_count: unknownLostPixels,
      unknown_band_gained_pixel_count: unknownGainedPixels,
      source_component_count_8: sourceComponentCount,
      output_component_count_8: outputComponentCount,
      component_count_delta: outputComponentCount - sourceComponentCount,
      source_bbox: sourceCandidateBbox,
      output_bbox: outputCandidateBbox,
      bbox_edge_max_shift_pixels: bboxEdgeShift(sourceCandidateBbox, outputCandidateBbox),
      changed_bbox: affectedBoundingBox(contourChangeMask, output.width, output.height),
    },
    visible_before: visiblePixelMetrics(source),
    visible_after: visiblePixelMetrics(output),
    spill_oklab_distance: spillDistance,
    boundaryMask,
    spillMask,
    contourChangeMask,
  }
}

export function applyDeterministicPixelMatteV2(image, { decode = null, ...overrides } = {}) {
  assertBackgroundMatteV2ImageBudget(image)
  const alphaIntegrity = assertBackgroundAlphaIntegrity(image)
  const immutableSource = cloneRgba(image)
  const hardPixelInput = inspectHardPixelMatte(immutableSource)
  const analyzed = hardPixelInput.detected
    ? {
        analysis: {
          schema_version: 1,
          algorithm: BACKGROUND_MATTE_V2_ALGORITHM,
          status: 'already_processed_hard_alpha',
          eligible: false,
          already_processed_hard_alpha: true,
          reasons: [],
          background_rgb: null,
          background_linear_rgb: null,
          background_oklab: null,
          dominant_cluster_share: null,
          oklab_p95_distance: null,
          thresholds: {
            oklab_p95_max_distance: BACKGROUND_MATTE_V2_DEFAULTS.oklab_p95_max_distance,
          },
        },
        options: { ...BACKGROUND_MATTE_V2_DEFAULTS, ...overrides },
      }
    : analyzeFlatBackgroundV2(immutableSource, overrides)
  if (hardPixelInput.detected) {
    analyzed.analysis.sha256 = canonicalJsonHash(analyzed.analysis)
  }
  const { analysis, options } = analyzed
  const masks = hardPixelInput.detected
    ? finalizeFrozenMasks(immutableSource, frozenHardPixelMasks(immutableSource), analysis)
    : freezeBackgroundContractMasks(immutableSource, analysis, options)
  const output = cloneRgba(immutableSource)
  const alphaEstimate = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) }
  const foregroundReconstruction = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) }
  const lowConfidenceMask = new Uint8Array(image.width * image.height)
  const solvedUnknownMask = new Uint8Array(image.width * image.height)
  const lowConfidenceReasons = {}
  let solvedUnknown = 0
  let lowConfidenceUnknown = 0
  const backgroundSupportedCleared = maskCount(masks.backgroundSupportedClear)
  const exteriorShoulderSingletonCleared = maskCount(masks.exteriorShoulderSingleton)
  const exteriorFringeHardClearCleared = maskCount(masks.exteriorFringeHardClear)
  const exteriorUnknownCleared = maskCount(masks.exteriorUnknown)

  if (hardPixelInput.detected) {
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4
      const alpha = immutableSource.data[offset + 3]
      alphaEstimate.data[offset] = alpha
      alphaEstimate.data[offset + 1] = alpha
      alphaEstimate.data[offset + 2] = alpha
      alphaEstimate.data[offset + 3] = 255
      if (alpha === 255) {
        foregroundReconstruction.data[offset] = immutableSource.data[offset]
        foregroundReconstruction.data[offset + 1] = immutableSource.data[offset + 1]
        foregroundReconstruction.data[offset + 2] = immutableSource.data[offset + 2]
        foregroundReconstruction.data[offset + 3] = 255
      }
    }
  }

  if (analysis.eligible) {
    const backgroundLinear = analysis.background_linear_rgb
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4
      if (masks.sureBackground[index]) {
        output.data[offset] = 0
        output.data[offset + 1] = 0
        output.data[offset + 2] = 0
        output.data[offset + 3] = 0
        continue
      }
      if (!masks.unknownBand[index]) continue
      if (masks.backgroundSupportedClear[index]) {
        output.data[offset] = 0
        output.data[offset + 1] = 0
        output.data[offset + 2] = 0
        output.data[offset + 3] = 0
        continue
      }
      const solved = solveUnknownPixel(immutableSource, masks, index, backgroundLinear, options)
      if (!solved.solved) {
        lowConfidenceMask[index] = 1
        lowConfidenceUnknown++
        lowConfidenceReasons[solved.reason] = (lowConfidenceReasons[solved.reason] ?? 0) + 1
        continue
      }
      solvedUnknownMask[index] = 1
      solvedUnknown++
      output.data[offset] = solved.reconstructed[0]
      output.data[offset + 1] = solved.reconstructed[1]
      output.data[offset + 2] = solved.reconstructed[2]
      output.data[offset + 3] = solved.alpha_byte
      alphaEstimate.data[offset] = solved.alpha_byte
      alphaEstimate.data[offset + 1] = solved.alpha_byte
      alphaEstimate.data[offset + 2] = solved.alpha_byte
      alphaEstimate.data[offset + 3] = 255
      foregroundReconstruction.data[offset] = solved.reconstructed[0]
      foregroundReconstruction.data[offset + 1] = solved.reconstructed[1]
      foregroundReconstruction.data[offset + 2] = solved.reconstructed[2]
      foregroundReconstruction.data[offset + 3] = 255
    }
  }
  const unknownTotal = masks.report.masks.unknown_band.pixel_count
  if (unknownTotal !== solvedUnknown + backgroundSupportedCleared + lowConfidenceUnknown) {
    throw new Error('Background Matte V2 Unknown accounting is inconsistent')
  }
  const zeroed = analysis.eligible
    ? zeroTransparentRgbFromRgba(output)
    : { image: output, changed_pixels: 0 }
  const backgroundResidueDiagnostics = buildVisibleBackgroundResidueDiagnostics(
    immutableSource,
    zeroed.image,
    masks,
    analysis,
    options,
  )
  const {
    evidence: backgroundResidueEvidence,
    visibleBackgroundLikeMask,
  } = backgroundResidueDiagnostics
  const scope = evaluateBackgroundScopeIntegrity(
    immutableSource,
    zeroed.image,
    masks,
    { analysis, options },
  )
  if (!scope.passed) throw new Error(`background matte scope integrity failed: ${JSON.stringify(scope.metrics)}`)
  const boundaryDiagnostics = buildBackgroundBoundaryDiagnostics(
    immutableSource,
    zeroed.image,
    masks,
    analysis,
    lowConfidenceMask,
    options,
  )
  const {
    boundaryMask: diagnosticBoundaryMask,
    spillMask: diagnosticSpillMask,
    contourChangeMask,
    ...boundaryEvidence
  } = boundaryDiagnostics
  const warnings = []
  const lossySource = decode?.lossy === true
  if (!analysis.eligible && !hardPixelInput.detected) warnings.push(...analysis.reasons)
  if (lossySource) warnings.push('lossy_source_review')
  if (lowConfidenceUnknown) warnings.push('low_confidence_unknown_pixels')
  if (backgroundResidueEvidence.visible_pixel_count) warnings.push('visible_exterior_background_residue')
  if (boundaryDiagnostics.possible_spill_pixel_count) warnings.push('possible_background_spill')
  if (boundaryDiagnostics.contour.status === 'needs_review') warnings.push('possible_contour_change')
  const recommendation = hardPixelInput.detected
    ? 'inspect_matte_result'
    : !analysis.eligible
    ? 'inspect_passthrough'
    : backgroundResidueEvidence.visible_pixel_count
      ? 'inspect_visible_background_residue'
      : lowConfidenceUnknown
      ? 'inspect_low_confidence_boundary'
      : 'inspect_matte_result'
  const outputSha256 = hashRgbaForBackgroundContract(zeroed.image)
  const diagnosticIntegrity = {
    alpha_estimate_rgba_sha256: hashRgbaForBackgroundContract(alphaEstimate),
    foreground_reconstruction_rgba_sha256: hashRgbaForBackgroundContract(foregroundReconstruction),
    low_confidence_mask_sha256: hashBackgroundContractMask(
      lowConfidenceMask,
      image.width,
      image.height,
    ),
    solved_unknown_mask_sha256: hashBackgroundContractMask(
      solvedUnknownMask,
      image.width,
      image.height,
    ),
    exterior_background_candidate_mask_sha256: hashBackgroundContractMask(
      masks.exteriorBackgroundCandidate,
      image.width,
      image.height,
    ),
    background_supported_clear_mask_sha256: hashBackgroundContractMask(
      masks.backgroundSupportedClear,
      image.width,
      image.height,
    ),
    exterior_shoulder_singleton_mask_sha256: hashBackgroundContractMask(
      masks.exteriorShoulderSingleton,
      image.width,
      image.height,
    ),
    exterior_fringe_hard_clear_mask_sha256: hashBackgroundContractMask(
      masks.exteriorFringeHardClear,
      image.width,
      image.height,
    ),
    protected_light_foreground_mask_sha256: hashBackgroundContractMask(
      masks.protectedLightForeground,
      image.width,
      image.height,
    ),
    foreground_sampling_authority_mask_sha256: hashBackgroundContractMask(
      masks.foregroundSamplingAuthority,
      image.width,
      image.height,
    ),
    visible_background_like_mask_sha256: hashBackgroundContractMask(
      visibleBackgroundLikeMask,
      image.width,
      image.height,
    ),
    boundary_mask_sha256: hashBackgroundContractMask(
      diagnosticBoundaryMask,
      image.width,
      image.height,
    ),
    spill_mask_sha256: hashBackgroundContractMask(
      diagnosticSpillMask,
      image.width,
      image.height,
    ),
    contour_change_mask_sha256: hashBackgroundContractMask(
      contourChangeMask,
      image.width,
      image.height,
    ),
  }
  const quality = {
    schema_version: 1,
    algorithm: BACKGROUND_MATTE_V2_ALGORITHM,
    status: hardPixelInput.detected
      ? (lossySource || boundaryDiagnostics.status === 'needs_review' ? 'needs_review' : 'pass')
      : analysis.eligible
        ? (
            lossySource ||
            lowConfidenceUnknown ||
            backgroundResidueEvidence.status === 'needs_review' ||
            boundaryDiagnostics.status === 'needs_review'
              ? 'needs_review'
              : 'pass'
          )
        : 'passthrough_review',
    provider_calls_used: 0,
    input_decode: decode,
    alpha_integrity: alphaIntegrity,
    alpha_provenance: hardPixelInput.detected
      ? ALPHA_PROVENANCE.ALREADY_PROCESSED
      : analysis.eligible
        ? ALPHA_PROVENANCE.DETERMINISTIC
        : (decode?.source_has_alpha ? ALPHA_PROVENANCE.NATIVE : ALPHA_PROVENANCE.OPAQUE),
    source_sha256: masks.report.source_sha256,
    output_sha256: outputSha256,
    background_analysis: analysis,
    contract_masks_sha256: canonicalJsonHash(masks.report),
    scope_integrity: scope,
    background_residue: backgroundResidueEvidence,
    boundary_diagnostics: boundaryEvidence,
    diagnostic_integrity: diagnosticIntegrity,
    unknown_pixels: {
      total: unknownTotal,
      solved: solvedUnknown,
      background_supported_cleared: backgroundSupportedCleared,
      background_supported_cleared_breakdown: {
        exterior_unknown: exteriorUnknownCleared,
        exterior_shoulder_singleton: exteriorShoulderSingletonCleared,
        exterior_fringe_hard_clear: exteriorFringeHardClearCleared,
      },
      low_confidence: lowConfidenceUnknown,
      low_confidence_reasons: lowConfidenceReasons,
    },
    transparent_rgb_zeroed_pixels: zeroed.changed_pixels,
    warnings,
  }
  const review = {
    schema_version: 1,
    algorithm: BACKGROUND_MATTE_V2_ALGORITHM,
    review_recommendation: recommendation,
    reasons: warnings,
    confidence: {
      background_eligible: analysis.eligible,
      dominant_cluster_share: analysis.dominant_cluster_share,
      oklab_p95_distance: analysis.oklab_p95_distance,
      low_confidence_unknown_pixel_count: lowConfidenceUnknown,
      background_supported_cleared_pixel_count: backgroundSupportedCleared,
      exterior_shoulder_singleton_cleared_pixel_count: exteriorShoulderSingletonCleared,
      exterior_fringe_hard_clear_cleared_pixel_count: exteriorFringeHardClearCleared,
      protected_light_foreground_pixel_count: maskCount(masks.protectedLightForeground),
      visible_background_like_pixel_count: backgroundResidueEvidence.visible_pixel_count,
    },
    spill_overlay_legend: BACKGROUND_SPILL_OVERLAY_LEGEND,
    affected_regions: {
      allowed_mutation_bbox: affectedBoundingBox(masks.allowedMutation, image.width, image.height),
      exterior_background_candidate_bbox: affectedBoundingBox(
        masks.exteriorBackgroundCandidate,
        image.width,
        image.height,
      ),
      exterior_unknown_bbox: affectedBoundingBox(masks.exteriorUnknown, image.width, image.height),
      exterior_shoulder_singleton_bbox: affectedBoundingBox(
        masks.exteriorShoulderSingleton,
        image.width,
        image.height,
      ),
      exterior_fringe_hard_clear_bbox: affectedBoundingBox(
        masks.exteriorFringeHardClear,
        image.width,
        image.height,
      ),
      low_confidence_bbox: affectedBoundingBox(lowConfidenceMask, image.width, image.height),
      background_supported_clear_bbox: affectedBoundingBox(
        masks.backgroundSupportedClear,
        image.width,
        image.height,
      ),
      protected_light_foreground_bbox: affectedBoundingBox(
        masks.protectedLightForeground,
        image.width,
        image.height,
      ),
      visible_background_like_bbox: backgroundResidueEvidence.bbox,
      possible_spill_bbox: boundaryDiagnostics.possible_spill_bbox,
      possible_contour_change_bbox: boundaryDiagnostics.contour.changed_bbox,
    },
    hashes: {
      source_sha256: masks.report.source_sha256,
      output_sha256: outputSha256,
      background_analysis_sha256: analysis.sha256,
      background_contract_masks_sha256: quality.contract_masks_sha256,
    },
  }
  return {
    image: zeroed.image,
    mode: analysis.eligible || hardPixelInput.detected
      ? BACKGROUND_MATTE_V2_ALGORITHM
      : 'passthrough_review',
    warnings,
    options,
    analysis,
    masks,
    scope,
    quality,
    review,
    alphaEstimate,
    foregroundReconstruction,
    lowConfidenceMask,
    solvedUnknownMask,
    visibleBackgroundLikeMask,
    boundaryMask: diagnosticBoundaryMask,
    spillMask: diagnosticSpillMask,
    contourChangeMask,
    boundaryDiagnostics,
    alpha_provenance: quality.alpha_provenance,
    contract: {
      requested: BACKGROUND_MATTE_V2_ALGORITHM,
      canonical: BACKGROUND_MATTE_V2_ALGORITHM,
      recipe_id: BACKGROUND_MATTE_V2_ALGORITHM,
    },
    requested_mode: BACKGROUND_MATTE_V2_ALGORITHM,
    canonical_mode: BACKGROUND_MATTE_V2_ALGORITHM,
    recipe_id: BACKGROUND_MATTE_V2_ALGORITHM,
    input_decode: decode,
  }
}

export function hardenBackgroundAlpha(image, { threshold = BACKGROUND_MATTE_V2_DEFAULTS.hard_alpha_threshold } = {}) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Background Matte V2 hard alpha threshold must be a finite number from 0 to 1')
  }
  const out = cloneRgba(image)
  const alphaThreshold = Math.round(threshold * 255)
  for (let offset = 0; offset < out.data.length; offset += 4) {
    if (out.data[offset + 3] === 0) {
      out.data[offset] = 0
      out.data[offset + 1] = 0
      out.data[offset + 2] = 0
    } else if (out.data[offset + 3] >= alphaThreshold) {
      out.data[offset + 3] = 255
    } else {
      out.data[offset] = 0
      out.data[offset + 1] = 0
      out.data[offset + 2] = 0
      out.data[offset + 3] = 0
    }
  }
  return {
    image: out,
    threshold: Number(threshold),
    alpha_threshold_byte: alphaThreshold,
    alpha_provenance: ALPHA_PROVENANCE.DETERMINISTIC,
  }
}

export function renderBackgroundMaskImage(mask, width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const offset = index * 4
    data[offset] = color[0]
    data[offset + 1] = color[1]
    data[offset + 2] = color[2]
    data[offset + 3] = color[3] ?? 255
  }
  return { width, height, data }
}

export function renderBackgroundSpillOverlay(source, result) {
  const out = cloneRgba(source)
  for (let index = 0; index < source.width * source.height; index += 1) {
    const offset = index * 4
    if (result.visibleBackgroundLikeMask?.[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.visible_background_like.rgba, offset)
    } else if (result.spillMask?.[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.possible_spill.rgba, offset)
    } else if (result.lowConfidenceMask[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.low_confidence.rgba, offset)
    } else if (result.solvedUnknownMask[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.solved_unknown.rgba, offset)
    } else if (result.masks.exteriorShoulderSingleton[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.exterior_shoulder_singleton.rgba, offset)
    } else if (result.masks.exteriorFringeHardClear?.[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.exterior_fringe_hard_clear.rgba, offset)
    } else if (result.masks.backgroundSupportedClear[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.background_supported_clear.rgba, offset)
    } else if (result.masks.protectedLightForeground[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.protected_light_foreground.rgba, offset)
    } else if (result.masks.sureBackground[index]) {
      out.data.set(BACKGROUND_SPILL_OVERLAY_LEGEND.sure_background.rgba, offset)
    }
  }
  return out
}

function compositePixel(foreground, offset, background) {
  const alpha = foreground.data[offset + 3] / 255
  return [0, 1, 2].map((channel) => Math.round(
    foreground.data[offset + channel] * alpha + background[channel] * (1 - alpha),
  ))
}

export function renderSixBackgroundPreview(image) {
  const backgrounds = [
    { id: 'checker', color: null },
    { id: 'white', color: [255, 255, 255] },
    { id: 'black', color: [0, 0, 0] },
    { id: 'gray', color: [128, 128, 128] },
    { id: 'magenta', color: [255, 0, 255] },
    { id: 'green', color: [0, 255, 0] },
  ]
  const width = image.width * 3
  const height = image.height * 2
  const data = new Uint8ClampedArray(width * height * 4)
  backgrounds.forEach((background, panel) => {
    const panelX = (panel % 3) * image.width
    const panelY = Math.floor(panel / 3) * image.height
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const sourceOffset = (y * image.width + x) * 4
        const targetOffset = ((panelY + y) * width + panelX + x) * 4
        const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0)
          ? [230, 230, 230]
          : [180, 180, 180]
        const rgb = compositePixel(image, sourceOffset, background.color ?? checker)
        data[targetOffset] = rgb[0]
        data[targetOffset + 1] = rgb[1]
        data[targetOffset + 2] = rgb[2]
        data[targetOffset + 3] = 255
      }
    }
  })
  return {
    image: { width, height, data },
    panels: backgrounds.map((background, index) => ({
      id: background.id,
      row: Math.floor(index / 3),
      column: index % 3,
    })),
  }
}

function artifactEvidence(buffer, mimeType) {
  return {
    byte_length: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mime_type: mimeType,
  }
}

function assertBackgroundMatteV2BundleIntegrity(result, rawSource) {
  if (!rawSource) throw new Error('Background Matte V2 raw source is required for Artifact evidence')
  assertBackgroundMatteV2ImageBudget(rawSource)
  assertBackgroundMatteV2ImageBudget(result?.image)
  if (rawSource.width !== result.image.width || rawSource.height !== result.image.height) {
    throw new Error('Background Matte V2 Artifact dimensions changed')
  }
  assertFrozenBackgroundContractMasks(rawSource, result.masks, {
    analysis: result.analysis,
    options: result.options,
  })
  const scope = evaluateBackgroundScopeIntegrity(rawSource, result.image, result.masks, {
    analysis: result.analysis,
    options: result.options,
  })
  if (!scope.passed || JSON.stringify(scope) !== JSON.stringify(result.scope)) {
    throw new Error('Background Matte V2 Scope evidence changed')
  }
  const { sha256: analysisSha256, ...analysisWithoutHash } = result.analysis ?? {}
  if (
    !analysisSha256 ||
    canonicalJsonHash(analysisWithoutHash) !== analysisSha256 ||
    result.masks.report.background_analysis_sha256 !== analysisSha256
  ) {
    throw new Error('Background Matte V2 analysis evidence changed')
  }
  const sourceSha256 = hashRgbaForBackgroundContract(rawSource)
  const outputSha256 = hashRgbaForBackgroundContract(result.image)
  const masksSha256 = canonicalJsonHash(result.masks.report)
  if (
    result.quality?.source_sha256 !== sourceSha256 ||
    result.quality?.output_sha256 !== outputSha256 ||
    result.quality?.contract_masks_sha256 !== masksSha256 ||
    result.review?.hashes?.source_sha256 !== sourceSha256 ||
    result.review?.hashes?.output_sha256 !== outputSha256 ||
    result.review?.hashes?.background_analysis_sha256 !== analysisSha256 ||
    result.review?.hashes?.background_contract_masks_sha256 !== masksSha256
  ) {
    throw new Error('Background Matte V2 Artifact hashes changed')
  }
  assertBackgroundMatteV2ImageBudget(result.alphaEstimate)
  assertBackgroundMatteV2ImageBudget(result.foregroundReconstruction)
  const recomputedBoundary = buildBackgroundBoundaryDiagnostics(
    rawSource,
    result.image,
    result.masks,
    result.analysis,
    result.lowConfidenceMask,
    result.options,
  )
  const {
    boundaryMask: recomputedBoundaryMask,
    spillMask: recomputedSpillMask,
    contourChangeMask: recomputedContourChangeMask,
    ...recomputedBoundaryEvidence
  } = recomputedBoundary
  const {
    evidence: recomputedBackgroundResidueEvidence,
    visibleBackgroundLikeMask: recomputedVisibleBackgroundLikeMask,
  } = buildVisibleBackgroundResidueDiagnostics(
    rawSource,
    result.image,
    result.masks,
    result.analysis,
    result.options,
  )
  const expectedDiagnosticIntegrity = {
    alpha_estimate_rgba_sha256: hashRgbaForBackgroundContract(result.alphaEstimate),
    foreground_reconstruction_rgba_sha256: hashRgbaForBackgroundContract(result.foregroundReconstruction),
    low_confidence_mask_sha256: hashBackgroundContractMask(result.lowConfidenceMask, rawSource.width, rawSource.height),
    solved_unknown_mask_sha256: hashBackgroundContractMask(result.solvedUnknownMask, rawSource.width, rawSource.height),
    exterior_background_candidate_mask_sha256: hashBackgroundContractMask(result.masks.exteriorBackgroundCandidate, rawSource.width, rawSource.height),
    background_supported_clear_mask_sha256: hashBackgroundContractMask(result.masks.backgroundSupportedClear, rawSource.width, rawSource.height),
    exterior_shoulder_singleton_mask_sha256: hashBackgroundContractMask(result.masks.exteriorShoulderSingleton, rawSource.width, rawSource.height),
    exterior_fringe_hard_clear_mask_sha256: hashBackgroundContractMask(result.masks.exteriorFringeHardClear, rawSource.width, rawSource.height),
    protected_light_foreground_mask_sha256: hashBackgroundContractMask(result.masks.protectedLightForeground, rawSource.width, rawSource.height),
    foreground_sampling_authority_mask_sha256: hashBackgroundContractMask(result.masks.foregroundSamplingAuthority, rawSource.width, rawSource.height),
    visible_background_like_mask_sha256: hashBackgroundContractMask(recomputedVisibleBackgroundLikeMask, rawSource.width, rawSource.height),
    boundary_mask_sha256: hashBackgroundContractMask(recomputedBoundaryMask, rawSource.width, rawSource.height),
    spill_mask_sha256: hashBackgroundContractMask(recomputedSpillMask, rawSource.width, rawSource.height),
    contour_change_mask_sha256: hashBackgroundContractMask(recomputedContourChangeMask, rawSource.width, rawSource.height),
  }
  if (
    JSON.stringify(result.quality?.diagnostic_integrity) !== JSON.stringify(expectedDiagnosticIntegrity) ||
    JSON.stringify(result.quality?.background_residue) !== JSON.stringify(recomputedBackgroundResidueEvidence) ||
    JSON.stringify(result.quality?.boundary_diagnostics) !== JSON.stringify(recomputedBoundaryEvidence) ||
    hashBackgroundContractMask(result.boundaryMask, rawSource.width, rawSource.height) !==
      expectedDiagnosticIntegrity.boundary_mask_sha256 ||
    hashBackgroundContractMask(result.spillMask, rawSource.width, rawSource.height) !==
      expectedDiagnosticIntegrity.spill_mask_sha256 ||
    hashBackgroundContractMask(result.contourChangeMask, rawSource.width, rawSource.height) !==
      expectedDiagnosticIntegrity.contour_change_mask_sha256 ||
    hashBackgroundContractMask(result.visibleBackgroundLikeMask, rawSource.width, rawSource.height) !==
      expectedDiagnosticIntegrity.visible_background_like_mask_sha256 ||
    maskCount(result.lowConfidenceMask) !== result.quality?.unknown_pixels?.low_confidence ||
    maskCount(result.solvedUnknownMask) !== result.quality?.unknown_pixels?.solved ||
    maskCount(result.masks.backgroundSupportedClear) !==
      result.quality?.unknown_pixels?.background_supported_cleared ||
    maskCount(result.masks.exteriorUnknown) !==
      result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_unknown ||
    maskCount(result.masks.exteriorShoulderSingleton) !==
      result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_shoulder_singleton ||
    maskCount(result.masks.exteriorFringeHardClear) !==
      result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_fringe_hard_clear ||
    result.quality?.unknown_pixels?.background_supported_cleared !==
      result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_unknown +
        result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_shoulder_singleton +
        result.quality?.unknown_pixels?.background_supported_cleared_breakdown?.exterior_fringe_hard_clear ||
    result.quality?.unknown_pixels?.total !==
      result.quality?.unknown_pixels?.solved +
        result.quality?.unknown_pixels?.background_supported_cleared +
        result.quality?.unknown_pixels?.low_confidence
  ) {
    throw new Error('Background Matte V2 diagnostic evidence changed')
  }
  return { sourceSha256, outputSha256, masksSha256 }
}

async function previewPanelSource(image, maxPanelSize) {
  const largest = Math.max(image.width, image.height)
  if (largest <= maxPanelSize) return image
  const scale = maxPanelSize / largest
  return resizeRgbaNearest(image, {
    w: Math.max(1, Math.round(image.width * scale)),
    h: Math.max(1, Math.round(image.height * scale)),
  })
}

export function assertBackgroundMatteV2ArtifactUrlPrefix(artifactUrlPrefix) {
  const urlPrefix = String(artifactUrlPrefix ?? '').replace(/\/$/, '')
  const generatedUrlPrefix = /^\/generated(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,127})+$/.test(urlPrefix)
  let localFileUrlPrefix = false
  try {
    const parsed = new URL(urlPrefix)
    const decodedSegments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
    localFileUrlPrefix = parsed.protocol === 'file:' &&
      parsed.hostname === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.pathname.startsWith('/') &&
      decodedSegments.every((segment) => segment !== '.' && segment !== '..')
  } catch {
    localFileUrlPrefix = false
  }
  if (!generatedUrlPrefix && !localFileUrlPrefix) {
    throw new Error('Background Matte V2 artifact URL prefix is required')
  }
  return urlPrefix
}

export async function buildBackgroundMatteV2ArtifactBundle(
  result,
  {
    rawSource = null,
    previewMaxPanelSize = 512,
    artifactUrlPrefix,
  } = {},
) {
  const urlPrefix = assertBackgroundMatteV2ArtifactUrlPrefix(artifactUrlPrefix)
  assertBackgroundMatteV2BundleIntegrity(result, rawSource)
  const width = result.image.width
  const height = result.image.height
  const outputPng = await encodeRgbaPng(result.image)
  const previewSource = await previewPanelSource(result.image, previewMaxPanelSize)
  const preview = renderSixBackgroundPreview(previewSource)
  const imageBuffers = {
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT]: outputPng,
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW]: await encodeRgbaPng(preview.image),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY]: await encodeRgbaPng(
      renderBackgroundSpillOverlay(rawSource ?? result.image, result),
    ),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK]: await encodeRgbaPng(
      renderBackgroundMaskImage(result.masks.sureBackground, width, height, [0, 200, 255, 255]),
    ),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK]: await encodeRgbaPng(
      renderBackgroundMaskImage(result.masks.unknownBand, width, height, [255, 160, 0, 255]),
    ),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK]: await encodeRgbaPng(
      renderBackgroundMaskImage(result.masks.sureForeground, width, height, [0, 220, 110, 255]),
    ),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE]: await encodeRgbaPng(result.alphaEstimate),
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION]: await encodeRgbaPng(result.foregroundReconstruction),
  }
  const imageEvidence = Object.fromEntries(Object.entries(imageBuffers).map(([file, buffer]) => [
    file,
    { file, ...artifactEvidence(buffer, 'image/png') },
  ]))
  const contractMasks = {
    ...result.masks.report,
    diagnostic_mask_artifacts: {
      sure_background: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK],
      unknown_band: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK],
      sure_foreground: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK],
    },
  }
  const contractMasksBuffer = Buffer.from(`${JSON.stringify(contractMasks, null, 2)}\n`, 'utf8')
  const review = {
    schema_version: result.review.schema_version,
    algorithm: result.review.algorithm,
    review_recommendation: result.review.review_recommendation,
    reasons: result.review.reasons,
    confidence: result.review.confidence,
    spill_overlay_legend: result.review.spill_overlay_legend,
    affected_regions: result.review.affected_regions,
    hashes: result.review.hashes,
    artifacts: {
      output: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
      preview: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW],
      spill_overlay: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY],
      contract_masks: {
        file: BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
        ...artifactEvidence(contractMasksBuffer, 'application/json'),
      },
      alpha_estimate: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE],
      foreground_reconstruction: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION],
    },
    urls: {
      background_removed_provider_output_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT}`,
      background_preview_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW}`,
      background_spill_overlay_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY}`,
      background_contract_masks_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS}`,
      background_alpha_estimate_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE}`,
      background_foreground_reconstruction_url: `${urlPrefix}/${BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION}`,
    },
  }
  const reviewBuffer = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
  const quality = {
    ...result.quality,
    preview_layout: {
      panels: preview.panels,
      panel_size: { width: previewSource.width, height: previewSource.height },
    },
    output_artifact: imageEvidence[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT],
    contract_masks_artifact: review.artifacts.contract_masks,
    review_artifact: {
      file: BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW,
      ...artifactEvidence(reviewBuffer, 'application/json'),
    },
  }
  const qualityBuffer = Buffer.from(`${JSON.stringify(quality, null, 2)}\n`, 'utf8')
  const files = {
    ...imageBuffers,
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS]: contractMasksBuffer,
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW]: reviewBuffer,
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY]: qualityBuffer,
  }
  const artifacts = Object.fromEntries(Object.entries(files).map(([file, buffer]) => [
    file,
    {
      file,
      ...artifactEvidence(buffer, file.endsWith('.png') ? 'image/png' : 'application/json'),
    },
  ]))
  return {
    files,
    artifacts,
    metadata: {
      schema_version: 1,
      recipe_id: BACKGROUND_MATTE_V2_ALGORITHM,
      source_rgba_sha256: result.masks.report.source_sha256,
      output_rgba_sha256: result.quality.output_sha256,
      provider_calls_used: 0,
      artifacts,
    },
    quality,
    review,
    contractMasks,
  }
}
