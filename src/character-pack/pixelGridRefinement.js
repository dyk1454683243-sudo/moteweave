import { cloneRgba, colorDistanceSq, pixelOffset } from './imageMath.js'
import { extractPalette } from './stylePipeline.js'

export const PIXEL_GRID_RECIPE_IDS = Object.freeze({
  V1_COMPAT: 'pixel_grid_v1_compat',
  V2_BALANCED: 'pixel_grid_v2_balanced',
  V2_DETAIL_SAFE: 'pixel_grid_v2_detail_safe',
  V2_OKLAB: 'pixel_grid_v2_oklab',
})

export const PIXEL_GRID_RECIPES = Object.freeze({
  [PIXEL_GRID_RECIPE_IDS.V1_COMPAT]: Object.freeze({
    id: PIXEL_GRID_RECIPE_IDS.V1_COMPAT,
    schema_version: 1,
    sequence_consensus: false,
    harmonic_rejection: false,
    detail_protection: 'off',
    color_distance: 'rgb',
    outline_stage: 'caller_owned_legacy_order',
  }),
  [PIXEL_GRID_RECIPE_IDS.V2_BALANCED]: Object.freeze({
    id: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    schema_version: 2,
    sequence_consensus: true,
    harmonic_rejection: true,
    detail_protection: 'balanced',
    color_distance: 'rgb',
    outline_stage: 'after_refinement',
  }),
  [PIXEL_GRID_RECIPE_IDS.V2_DETAIL_SAFE]: Object.freeze({
    id: PIXEL_GRID_RECIPE_IDS.V2_DETAIL_SAFE,
    schema_version: 2,
    sequence_consensus: true,
    harmonic_rejection: true,
    detail_protection: 'detail_safe',
    color_distance: 'rgb',
    outline_stage: 'after_refinement',
  }),
  [PIXEL_GRID_RECIPE_IDS.V2_OKLAB]: Object.freeze({
    id: PIXEL_GRID_RECIPE_IDS.V2_OKLAB,
    schema_version: 2,
    sequence_consensus: true,
    harmonic_rejection: true,
    detail_protection: 'detail_safe',
    color_distance: 'oklab',
    outline_stage: 'after_refinement',
  }),
})

export function resolvePixelGridRecipe(recipe = PIXEL_GRID_RECIPE_IDS.V2_BALANCED) {
  if (typeof recipe !== 'string' || !recipe.trim()) {
    const error = new Error('Pixel grid recipe must be a non-empty string')
    error.code = 'invalid_pixel_grid_recipe'
    error.recipe = recipe
    throw error
  }
  const id = recipe.trim()
  const resolved = PIXEL_GRID_RECIPES[id]
  if (!resolved) {
    const error = new Error(`Unsupported pixel grid recipe: ${id}`)
    error.code = 'invalid_pixel_grid_recipe'
    error.recipe = id
    throw error
  }
  return resolved
}

const PIXEL_GRID_OPTION_KEYS = new Set([
  'recipe',
  'maxColors',
  'minConfidence',
  'minSequenceSupport',
  'minCell',
  'maxCell',
  'alphaThreshold',
  'alphaHardenThreshold',
  'emptyCellCoverage',
  'emitLogical',
  'sampleLimit',
  'outlineMode',
  'outlineColor',
])

function finiteOption(value, key, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    const error = new Error(`Invalid pixel grid option: ${key}`)
    error.code = 'invalid_pixel_grid_option'
    error.option = key
    throw error
  }
  return number
}

export function normalizePixelGridRefinementOptions(value, {
  defaultRecipe = PIXEL_GRID_RECIPE_IDS.V1_COMPAT,
} = {}) {
  if (!value) return false
  const source = value === true ? {} : value
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    const error = new Error('pixel grid refinement options must be an object')
    error.code = 'invalid_pixel_grid_options'
    throw error
  }
  for (const key of Object.keys(source)) {
    if (!PIXEL_GRID_OPTION_KEYS.has(key)) {
      const error = new Error(`Unknown pixel grid option: ${key}`)
      error.code = 'unknown_pixel_grid_option'
      error.option = key
      throw error
    }
  }
  const recipe = resolvePixelGridRecipe(
    Object.prototype.hasOwnProperty.call(source, 'recipe')
      ? source.recipe
      : defaultRecipe
  )
  const normalized = { recipe: recipe.id }
  if (source.maxColors !== undefined) normalized.maxColors = finiteOption(source.maxColors, 'maxColors', { min: 2, max: 64, integer: true })
  if (source.minConfidence !== undefined) normalized.minConfidence = finiteOption(source.minConfidence, 'minConfidence', { min: 0, max: 1 })
  if (source.minSequenceSupport !== undefined) normalized.minSequenceSupport = finiteOption(source.minSequenceSupport, 'minSequenceSupport', { min: 0, max: 1 })
  if (source.minCell !== undefined) normalized.minCell = finiteOption(source.minCell, 'minCell', { min: 2, max: MAX_GRID_CELL_SIZE, integer: true })
  if (source.maxCell !== undefined) normalized.maxCell = finiteOption(source.maxCell, 'maxCell', { min: 2, max: MAX_GRID_CELL_SIZE, integer: true })
  if (normalized.minCell !== undefined && normalized.maxCell !== undefined && normalized.maxCell < normalized.minCell) {
    const error = new Error('maxCell must be greater than or equal to minCell')
    error.code = 'invalid_pixel_grid_option'
    error.option = 'maxCell'
    throw error
  }
  if (source.alphaThreshold !== undefined) normalized.alphaThreshold = finiteOption(source.alphaThreshold, 'alphaThreshold', { min: 1, max: 255, integer: true })
  if (source.alphaHardenThreshold !== undefined) normalized.alphaHardenThreshold = finiteOption(source.alphaHardenThreshold, 'alphaHardenThreshold', { min: 1, max: 255, integer: true })
  if (source.emptyCellCoverage !== undefined) normalized.emptyCellCoverage = finiteOption(source.emptyCellCoverage, 'emptyCellCoverage', { min: 0, max: 1 })
  if (source.sampleLimit !== undefined) normalized.sampleLimit = finiteOption(source.sampleLimit, 'sampleLimit', { min: 1, max: 16, integer: true })
  if (source.emitLogical !== undefined) {
    if (typeof source.emitLogical !== 'boolean') {
      const error = new Error('Invalid pixel grid option: emitLogical')
      error.code = 'invalid_pixel_grid_option'
      error.option = 'emitLogical'
      throw error
    }
    normalized.emitLogical = source.emitLogical
  }
  if (source.outlineMode !== undefined) {
    const outlineMode = String(source.outlineMode)
    if (!['none', 'outer'].includes(outlineMode)) {
      const error = new Error('outlineMode must be none or outer')
      error.code = 'invalid_pixel_grid_option'
      error.option = 'outlineMode'
      throw error
    }
    normalized.outlineMode = outlineMode
  }
  if (source.outlineColor !== undefined) {
    try {
      normalized.outlineColor = normalizeRgb(source.outlineColor)
    } catch (cause) {
      const error = new Error('Invalid pixel grid option: outlineColor')
      error.code = 'invalid_pixel_grid_option'
      error.option = 'outlineColor'
      error.cause = cause
      throw error
    }
  }
  return normalized
}

const MAX_GRID_CELL_SIZE = 32
const MAX_GRID_DETECTION_PIXELS = 1 * 1024 * 1024
const MAX_SINGLE_FRAME_GRID_DETECTION_PIXELS = 4 * 1024 * 1024
const MAX_SEQUENCE_DETECTION_PIXELS = 4 * 1024 * 1024
const MAX_PALETTE_SAMPLE_PIXELS = 256 * 1024
const MAX_OFFSET_SCORE_SAMPLES = 64 * 1024
const MAX_AUTOCORRELATION_COMPARISONS = 8 * 1024 * 1024

export const PIXEL_GRID_REFINEMENT_LIMITS = Object.freeze({
  max_frame_pixels: 4 * 1024 * 1024,
  max_total_pixels: 8 * 1024 * 1024,
  max_color_comparisons: 64 * 1024 * 1024,
  max_total_cells: 256 * 1024,
})

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)))
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)))
}

function finiteUnitOption(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number`)
  }
  return clamp01(number)
}

function normalizeRgb(color) {
  const rgb = color?.rgb ?? color
  if (!Array.isArray(rgb) || rgb.length < 3) throw new Error('palette colors must include rgb values')
  return rgb.slice(0, 3).map((value) => clampInt(value, 0, 255))
}

function quantizedColorKey(data, offset, step = 8) {
  const bucketCount = Math.ceil(256 / step)
  return (
    Math.floor(data[offset] / step) * bucketCount * bucketCount +
    Math.floor(data[offset + 1] / step) * bucketCount +
    Math.floor(data[offset + 2] / step)
  )
}

function collectRuns(image, { minCell, maxCell, alphaThreshold }) {
  const counts = new Uint32Array(maxCell * 8 + 1)
  let runCount = 0
  const pushRun = (length) => {
    if (length < minCell || length >= counts.length) return
    counts[length] += 1
    runCount += 1
  }

  for (let y = 0; y < image.height; y += 1) {
    let current = null
    let length = 0
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      const key = image.data[offset + 3] >= alphaThreshold ? quantizedColorKey(image.data, offset) : null
      if (key === null) {
        if (current !== null) pushRun(length)
        current = null
        length = 0
      } else if (key === current) {
        length += 1
      } else {
        if (current !== null) pushRun(length)
        current = key
        length = 1
      }
    }
    if (current !== null) pushRun(length)
  }

  for (let x = 0; x < image.width; x += 1) {
    let current = null
    let length = 0
    for (let y = 0; y < image.height; y += 1) {
      const offset = pixelOffset(image.width, x, y)
      const key = image.data[offset + 3] >= alphaThreshold ? quantizedColorKey(image.data, offset) : null
      if (key === null) {
        if (current !== null) pushRun(length)
        current = null
        length = 0
      } else if (key === current) {
        length += 1
      } else {
        if (current !== null) pushRun(length)
        current = key
        length = 1
      }
    }
    if (current !== null) pushRun(length)
  }

  return { counts, run_count: runCount }
}

function runLengthCandidates(runHistogram, { minCell, maxCell }) {
  const counts = runHistogram.counts
  let totalWeight = 0
  for (let run = minCell; run < counts.length; run += 1) {
    totalWeight += run * counts[run]
  }
  if (!totalWeight) return []
  const candidates = []
  for (let cell = minCell; cell <= maxCell; cell += 1) {
    let matched = 0
    for (let run = minCell; run < counts.length; run += 1) {
      if (!counts[run]) continue
      const remainder = run % cell
      const offBy = Math.min(remainder, cell - remainder)
      if (offBy <= Math.max(1, Math.floor(cell * 0.12))) {
        matched += run * counts[run]
      }
    }
    candidates.push({ cell_size: cell, score: matched / totalWeight })
  }
  return candidates.sort((a, b) => b.score - a.score || b.cell_size - a.cell_size)
}

function visiblePixelCount(image, alphaThreshold) {
  let count = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] >= alphaThreshold) count += 1
  }
  return count
}

function visibleBounds(image, alphaThreshold) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] < alphaThreshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX >= minX ? { minX, minY, maxX, maxY } : null
}

function cellBoundsForIndex(limit, offset, cellSize, index) {
  const start = Math.max(0, offset + index * cellSize)
  const end = Math.min(limit, offset + (index + 1) * cellSize)
  return { start, end }
}

function indexRange(limit, offset, cellSize) {
  if (limit <= 0) return { min: 0, max: -1 }
  return {
    min: Math.floor((0 - offset) / cellSize),
    max: Math.floor((limit - 1 - offset) / cellSize),
  }
}

function scoreSampleStride(image, maxSamples = MAX_OFFSET_SCORE_SAMPLES) {
  const pixels = image.width * image.height
  return Math.max(1, Math.ceil(Math.sqrt(pixels / Math.max(1, maxSamples))))
}

function cellVarianceScore(image, { cellSize, offsetX, offsetY, alphaThreshold, sampleStride = 1 }) {
  const xRange = indexRange(image.width, offsetX, cellSize)
  const yRange = indexRange(image.height, offsetY, cellSize)
  let visible = 0
  let dominant = 0

  for (let cy = yRange.min; cy <= yRange.max; cy += 1) {
    const yBounds = cellBoundsForIndex(image.height, offsetY, cellSize, cy)
    if (yBounds.start >= yBounds.end) continue
    for (let cx = xRange.min; cx <= xRange.max; cx += 1) {
      const xBounds = cellBoundsForIndex(image.width, offsetX, cellSize, cx)
      if (xBounds.start >= xBounds.end) continue
      const counts = new Map()
      let cellVisible = 0
      for (let y = yBounds.start; y < yBounds.end; y += sampleStride) {
        for (let x = xBounds.start; x < xBounds.end; x += sampleStride) {
          const offset = pixelOffset(image.width, x, y)
          if (image.data[offset + 3] < alphaThreshold) continue
          cellVisible += 1
          const key = quantizedColorKey(image.data, offset)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      if (!cellVisible) continue
      visible += cellVisible
      dominant += Math.max(...counts.values())
    }
  }

  return visible ? dominant / visible : 0
}

function pixelBoundaryDelta(data, a, b) {
  return (
    Math.abs(data[a] - data[b]) +
    Math.abs(data[a + 1] - data[b + 1]) +
    Math.abs(data[a + 2] - data[b + 2]) +
    Math.abs(data[a + 3] - data[b + 3])
  ) / (255 * 4)
}

function circularDistance(a, b, modulo) {
  const direct = Math.abs(a - b)
  return Math.min(direct, modulo - direct)
}

function boundaryPhaseScores(image, { cellSize, axis, sampleStride }) {
  const scores = []
  for (let phase = 0; phase < cellSize; phase += 1) {
    let total = 0
    let count = 0
    if (axis === 'x') {
      for (let x = phase; x < image.width; x += cellSize) {
        if (x <= 0) continue
        for (let y = 0; y < image.height; y += sampleStride) {
          total += pixelBoundaryDelta(
            image.data,
            pixelOffset(image.width, x - 1, y),
            pixelOffset(image.width, x, y)
          )
          count += 1
        }
      }
    } else {
      for (let y = phase; y < image.height; y += cellSize) {
        if (y <= 0) continue
        for (let x = 0; x < image.width; x += sampleStride) {
          total += pixelBoundaryDelta(
            image.data,
            pixelOffset(image.width, x, y - 1),
            pixelOffset(image.width, x, y)
          )
          count += 1
        }
      }
    }
    scores.push(count ? total / count : 0)
  }
  return scores
}

function findBestOffset(image, { cellSize, alphaThreshold }) {
  const sampleStride = scoreSampleStride(image)
  const bounds = visibleBounds(image, alphaThreshold)
  const preferred = bounds
    ? { x: ((bounds.minX % cellSize) + cellSize) % cellSize, y: ((bounds.minY % cellSize) + cellSize) % cellSize }
    : { x: 0, y: 0 }
  const chooseAxisPhase = (scores, preferredPhase) => scores
    .map((boundary, phase) => ({
      phase,
      boundary,
      score: boundary * 0.9 + (
        1 - circularDistance(phase, preferredPhase, cellSize) / Math.max(1, cellSize / 2)
      ) * 0.1,
    }))
    .sort((a, b) => b.score - a.score || a.phase - b.phase)[0]
  const x = chooseAxisPhase(
    boundaryPhaseScores(image, { cellSize, axis: 'x', sampleStride }),
    preferred.x
  )
  const y = chooseAxisPhase(
    boundaryPhaseScores(image, { cellSize, axis: 'y', sampleStride }),
    preferred.y
  )
  const varianceScore = cellVarianceScore(image, {
    cellSize,
    offsetX: x.phase,
    offsetY: y.phase,
    alphaThreshold,
    sampleStride,
  })
  const offsetPrior = 1 - (
    circularDistance(x.phase, preferred.x, cellSize) +
    circularDistance(y.phase, preferred.y, cellSize)
  ) / Math.max(1, cellSize)
  const boundaryContrast = (x.boundary + y.boundary) / 2
  return {
    x: x.phase,
    y: y.phase,
    score: varianceScore * 0.7 + boundaryContrast * 0.2 + offsetPrior * 0.1,
    variance_score: varianceScore,
    boundary_contrast: boundaryContrast,
  }
}

function detectByAutocorrelation(image, { minCell, maxCell, alphaThreshold }) {
  const visible = visiblePixelCount(image, alphaThreshold)
  if (visible < minCell * minCell) {
    return {
      candidates: [],
      evidence: {
        comparison_count: 0,
        comparison_limit: MAX_AUTOCORRELATION_COMPARISONS,
        sample_stride: 1,
      },
    }
  }
  const maxShift = Math.min(maxCell, image.width - 1, image.height - 1)
  const shiftCount = Math.max(0, maxShift - minCell + 1)
  const estimatedComparisons = safeProduct(
    safeProduct(image.width, image.height),
    shiftCount * 2
  )
  const sampleStride = Math.max(
    1,
    Math.ceil(Math.sqrt(
      estimatedComparisons / MAX_AUTOCORRELATION_COMPARISONS
    ))
  )
  const candidates = []
  let totalCompared = 0
  for (let shift = minCell; shift <= maxShift; shift += 1) {
    let compared = 0
    let same = 0
    for (let y = 0; y < image.height; y += sampleStride) {
      for (let x = 0; x < image.width - shift; x += sampleStride) {
        const a = pixelOffset(image.width, x, y)
        const b = pixelOffset(image.width, x + shift, y)
        if (image.data[a + 3] < alphaThreshold || image.data[b + 3] < alphaThreshold) continue
        compared += 1
        if (quantizedColorKey(image.data, a) === quantizedColorKey(image.data, b)) same += 1
      }
    }
    for (let y = 0; y < image.height - shift; y += sampleStride) {
      for (let x = 0; x < image.width; x += sampleStride) {
        const a = pixelOffset(image.width, x, y)
        const b = pixelOffset(image.width, x, y + shift)
        if (image.data[a + 3] < alphaThreshold || image.data[b + 3] < alphaThreshold) continue
        compared += 1
        if (quantizedColorKey(image.data, a) === quantizedColorKey(image.data, b)) same += 1
      }
    }
    totalCompared += compared
    if (compared) {
      candidates.push({
        cell_size: shift,
        score: same / compared,
        comparison_count: compared,
      })
    }
  }
  return {
    candidates: candidates.sort((a, b) => b.score - a.score || b.cell_size - a.cell_size),
    evidence: {
      comparison_count: totalCompared,
      comparison_limit: MAX_AUTOCORRELATION_COMPARISONS,
      sample_stride: sampleStride,
      estimated_full_comparisons: estimatedComparisons,
    },
  }
}

function extentFitScore(bounds, cellSize) {
  if (!bounds) return 0.5
  const width = bounds.maxX - bounds.minX + 1
  const height = bounds.maxY - bounds.minY + 1
  const fit = (extent) => {
    const remainder = extent % cellSize
    const distance = Math.min(remainder, cellSize - remainder)
    return 1 - distance / cellSize
  }
  return (fit(width) + fit(height)) / 2
}

export function detectPixelGrid(image, {
  minCell = 2,
  maxCell = 32,
  alphaThreshold = 8,
  candidateLimit = 3,
  maxDetectionPixels = MAX_GRID_DETECTION_PIXELS,
} = {}) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data) {
    throw new Error('detectPixelGrid requires an RGBA image')
  }
  const min = clampInt(minCell, 2, MAX_GRID_CELL_SIZE)
  const max = Math.max(min, clampInt(maxCell, min, MAX_GRID_CELL_SIZE))
  const threshold = clampInt(alphaThreshold, 1, 255)
  const detectionPixelLimit = clampInt(
    maxDetectionPixels,
    1,
    MAX_SINGLE_FRAME_GRID_DETECTION_PIXELS
  )
  const pixelCount = image.width * image.height
  const visiblePixels = pixelCount <= detectionPixelLimit
    ? visiblePixelCount(image, threshold)
    : 0
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    pixelCount > detectionPixelLimit ||
    visiblePixels === 0
  ) {
    return {
      cell_size: null,
      offset: { x: 0, y: 0 },
      confidence: 0,
      method: pixelCount > detectionPixelLimit ? 'budget_exceeded' : 'none',
      visible_pixel_count: visiblePixels,
      detection_work: {
        pixel_count: pixelCount,
        pixel_limit: detectionPixelLimit,
        autocorrelation: null,
      },
      candidates: [],
    }
  }

  const runHistogram = collectRuns(image, {
    minCell: min,
    maxCell: max,
    alphaThreshold: threshold,
  })
  const runCandidates = runLengthCandidates(runHistogram, {
    minCell: min,
    maxCell: max,
  })
  const topRun = runCandidates[0]
  const method = topRun?.score >= 0.35 ? 'run_length_mode' : 'autocorrelation'
  const autocorrelation = method === 'autocorrelation'
    ? detectByAutocorrelation(image, {
        minCell: min,
        maxCell: max,
        alphaThreshold: threshold,
      })
    : null
  const rawCandidates = method === 'run_length_mode'
    ? runCandidates
    : autocorrelation.candidates
  const bounds = visibleBounds(image, threshold)
  const scored = rawCandidates.map((candidate) => {
    const offset = findBestOffset(image, { cellSize: candidate.cell_size, alphaThreshold: threshold })
    const extentFit = extentFitScore(bounds, candidate.cell_size)
    return {
      cell_size: candidate.cell_size,
      score: round(candidate.score * (
        0.5 +
        offset.variance_score * 0.2 +
        offset.boundary_contrast * 0.2 +
        extentFit * 0.1
      ), 6),
      offset,
      source_score: candidate.score,
      extent_fit: extentFit,
      boundary_contrast: offset.boundary_contrast,
    }
  }).sort((a, b) => b.score - a.score || b.cell_size - a.cell_size)
  const best = scored[0]
  if (!best) {
    return {
      cell_size: null,
      offset: { x: 0, y: 0 },
      confidence: 0,
      method: 'none',
      visible_pixel_count: visiblePixels,
      detection_work: {
        pixel_count: pixelCount,
        pixel_limit: detectionPixelLimit,
        run_count: runHistogram.run_count,
        run_histogram_bins: runHistogram.counts.length,
        autocorrelation: autocorrelation?.evidence ?? null,
      },
      candidates: [],
    }
  }

  const runnerUpScore = scored[1]?.score ?? 0
  const confidence = clamp01(
    best.score + Math.max(0, best.score - runnerUpScore) * 0.6
  )
  return {
    cell_size: best.cell_size,
    offset: { x: best.offset.x, y: best.offset.y },
    confidence: round(confidence, 4),
    method,
    visible_pixel_count: visiblePixels,
    detection_work: {
      pixel_count: pixelCount,
      pixel_limit: detectionPixelLimit,
      run_count: runHistogram.run_count,
      run_histogram_bins: runHistogram.counts.length,
      autocorrelation: autocorrelation?.evidence ?? null,
    },
    candidates: scored.slice(0, clampInt(candidateLimit, 1, MAX_GRID_CELL_SIZE)).map((candidate) => ({
      cell_size: candidate.cell_size,
      score: round(candidate.score, 4),
      source_score: round(candidate.source_score, 4),
      offset: { x: candidate.offset.x, y: candidate.offset.y },
      offset_score: round(candidate.offset.score, 4),
      boundary_contrast: round(candidate.boundary_contrast, 4),
      extent_fit: round(candidate.extent_fit, 4),
    })),
  }
}

function sampledFrameIndexes(frameCount, sampleLimit) {
  if (sampleLimit <= 1) return frameCount > 0 ? [0] : []
  if (frameCount <= sampleLimit) return Array.from({ length: frameCount }, (_, index) => index)
  const indexes = new Set([0, frameCount - 1])
  const slots = Math.max(0, sampleLimit - indexes.size)
  for (let i = 1; i <= slots; i += 1) {
    indexes.add(Math.round((i * (frameCount - 1)) / (slots + 1)))
  }
  return [...indexes].sort((a, b) => a - b)
}

function sequenceSampleIndexes(frames, sampleLimit, maxSequencePixels = MAX_SEQUENCE_DETECTION_PIXELS) {
  const largestFramePixels = Math.max(1, ...frames.map((frame) => frame.width * frame.height))
  const budgetedLimit = Math.max(1, Math.floor(maxSequencePixels / largestFramePixels))
  return sampledFrameIndexes(frames.length, Math.min(
    frames.length,
    Math.max(1, clampInt(sampleLimit, 1, frames.length)),
    budgetedLimit
  ))
}

function legacyDetectionIndexes(
  frames,
  sampleLimit,
  maxSequencePixels = MAX_SEQUENCE_DETECTION_PIXELS
) {
  const indexes = []
  let totalPixels = 0
  const limit = Math.min(frames.length, Math.max(1, clampInt(sampleLimit, 1, frames.length)))
  for (let index = 0; index < limit; index += 1) {
    const framePixels = safeProduct(frames[index].width, frames[index].height)
    if (indexes.length && totalPixels + framePixels > maxSequencePixels) break
    indexes.push(index)
    totalPixels = Math.min(Number.MAX_SAFE_INTEGER, totalPixels + framePixels)
    if (totalPixels >= maxSequencePixels) break
  }
  return indexes
}

function weightedCircularPhase(entries, key, modulo) {
  if (!entries.length || !modulo) return { phase: 0, agreement: 0 }
  let best = { phase: 0, score: -1 }
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)
  for (let phase = 0; phase < modulo; phase += 1) {
    let score = 0
    for (const entry of entries) {
      const distance = circularDistance(entry[key], phase, modulo)
      score += entry.weight * (1 - distance / Math.max(1, modulo / 2))
    }
    if (score > best.score || (score === best.score && phase < best.phase)) best = { phase, score }
  }
  return {
    phase: best.phase,
    agreement: totalWeight ? clamp01(best.score / totalWeight) : 0,
  }
}

function harmonicRelatives(a, b) {
  const smaller = Math.min(a, b)
  const larger = Math.max(a, b)
  return smaller > 0 && larger % smaller === 0
}

function sequenceCandidateRecord(cellSize, entries, sampledCount) {
  const supportFrames = new Set(entries.map((entry) => entry.frame_index))
  const weights = entries.map((entry) => Math.max(
    0.0001,
    entry.score * (0.25 + entry.visible_weight * 0.75)
  ))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const mean = (key) => entries.reduce((sum, entry, index) => sum + entry[key] * weights[index], 0) / totalWeight
  const phaseEntries = entries.map((entry, index) => ({
    x: entry.offset.x,
    y: entry.offset.y,
    weight: weights[index],
  }))
  const x = weightedCircularPhase(phaseEntries, 'x', cellSize)
  const y = weightedCircularPhase(phaseEntries, 'y', cellSize)
  const phaseAgreement = (x.agreement + y.agreement) / 2
  const supportRatio = supportFrames.size / Math.max(1, sampledCount)
  const meanScore = mean('score')
  const boundaryContrast = mean('boundary_contrast')
  const score = clamp01(
    meanScore * 0.65 +
    supportRatio * 0.2 +
    boundaryContrast * 0.1 +
    phaseAgreement * 0.05
  )
  return {
    cell_size: cellSize,
    offset: { x: x.phase, y: y.phase },
    score: round(score, 6),
    mean_candidate_score: round(meanScore, 6),
    boundary_contrast: round(boundaryContrast, 6),
    supporting_frame_count: supportFrames.size,
    support_ratio: round(supportRatio, 6),
    phase_agreement: round(phaseAgreement, 6),
    supporting_frame_indexes: [...supportFrames].sort((a, b) => a - b),
  }
}

function chooseSequenceCandidate(candidates, { harmonicRejection = true } = {}) {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || b.cell_size - a.cell_size)
  const top = ranked[0] ?? null
  if (!top || !harmonicRejection) return { selected: top, rejected_harmonics: [] }
  const review = ranked.filter((candidate) => (
    candidate.score >= top.score * 0.7 &&
    candidate.support_ratio >= Math.max(0.5, top.support_ratio * 0.75) &&
    harmonicRelatives(candidate.cell_size, top.cell_size)
  ))
  let selected = top
  for (const candidate of review) {
    const strongerBoundary = candidate.boundary_contrast > selected.boundary_contrast + 0.02
    const comparableBoundary =
      Math.abs(candidate.boundary_contrast - selected.boundary_contrast) <= 0.02
    if (
      strongerBoundary ||
      (
        comparableBoundary &&
        candidate.score > selected.score + 0.000001
      )
    ) {
      selected = candidate
    }
  }
  const rejected = ranked
    .filter((candidate) => (
      candidate.cell_size !== selected.cell_size &&
      harmonicRelatives(candidate.cell_size, selected.cell_size) &&
      candidate.score >= top.score * 0.65 &&
      candidate.support_ratio >= Math.max(0.5, selected.support_ratio * 0.75) &&
      selected.boundary_contrast > candidate.boundary_contrast + 0.02
    ))
    .map((candidate) => ({
      cell_size: candidate.cell_size,
      reason: 'harmonic_alias',
      alias_of: selected.cell_size,
      score: candidate.score,
      boundary_contrast: candidate.boundary_contrast,
    }))
  return { selected, rejected_harmonics: rejected }
}

function combinePixelGridSequenceDetections(sampled, detections, {
  harmonicRejection = true,
} = {}) {
  const grouped = new Map()
  for (const { frame_index: frameIndex, detection } of detections) {
    if (
      !detection.cell_size ||
      detection.confidence < 0.45 ||
      ['none', 'budget_exceeded'].includes(detection.method)
    ) {
      continue
    }
    const topCandidateScore = Number(detection.candidates[0]?.score ?? 0)
    const candidateThreshold = Math.max(0.4, topCandidateScore * 0.65)
    const visibleWeight = Math.sqrt(
      Math.min(Number(detection.visible_pixel_count ?? 0), MAX_OFFSET_SCORE_SAMPLES) /
      MAX_OFFSET_SCORE_SAMPLES
    )
    for (const candidate of detection.candidates) {
      if (candidate.score < candidateThreshold) continue
      const entries = grouped.get(candidate.cell_size) ?? []
      entries.push({
        frame_index: frameIndex,
        score: candidate.score,
        boundary_contrast: candidate.boundary_contrast,
        offset: candidate.offset,
        visible_weight: visibleWeight,
      })
      grouped.set(candidate.cell_size, entries)
    }
  }
  const candidates = [...grouped.entries()].map(([cellSize, entries]) => (
    sequenceCandidateRecord(cellSize, entries, sampled.length)
  ))
  const decision = chooseSequenceCandidate(candidates, { harmonicRejection })
  const selected = decision.selected
  if (!selected) {
    return {
      cell_size: null,
      offset: { x: 0, y: 0 },
      confidence: 0,
      method: 'none',
      candidates: [],
      sampled_frame_indexes: sampled,
      supporting_frame_count: 0,
      support_ratio: 0,
      rejected_harmonics: [],
      frame_detections: detections.map(({ frame_index: frameIndex, detection }) => ({
        frame_index: frameIndex,
        ...detection,
      })),
    }
  }
  return {
    cell_size: selected.cell_size,
    offset: selected.offset,
    confidence: round(selected.score, 4),
    method: 'sequence_consensus',
    candidates: [...candidates].sort((a, b) => b.score - a.score || b.cell_size - a.cell_size),
    sampled_frame_indexes: sampled,
    supporting_frame_count: selected.supporting_frame_count,
    support_ratio: selected.support_ratio,
    phase_agreement: selected.phase_agreement,
    rejected_harmonics: decision.rejected_harmonics,
    frame_detections: detections.map(({ frame_index: frameIndex, detection }) => {
      const candidate = detection.candidates.find((item) => item.cell_size === selected.cell_size)
      return {
        frame_index: frameIndex,
        cell_size: detection.cell_size,
        offset: detection.offset,
        confidence: detection.confidence,
        method: detection.method,
        detection_work: detection.detection_work ?? null,
        consensus_candidate: candidate ?? null,
        phase_distance: candidate
          ? {
              x: circularDistance(candidate.offset.x, selected.offset.x, selected.cell_size),
              y: circularDistance(candidate.offset.y, selected.offset.y, selected.cell_size),
            }
          : null,
      }
    }),
  }
}

export function detectPixelGridSequence(frames, {
  minCell = 2,
  maxCell = 32,
  alphaThreshold = 8,
  sampleLimit = 12,
  harmonicRejection = true,
  maxSequencePixels = MAX_SEQUENCE_DETECTION_PIXELS,
  maxFrameDetectionPixels = MAX_GRID_DETECTION_PIXELS,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('detectPixelGridSequence requires frames')
  const sampled = sequenceSampleIndexes(frames, sampleLimit, maxSequencePixels)
  const detections = sampled.map((frameIndex) => ({
    frame_index: frameIndex,
    detection: detectPixelGrid(frames[frameIndex], {
      minCell,
      maxCell,
      alphaThreshold,
      candidateLimit: MAX_GRID_CELL_SIZE,
      maxDetectionPixels: maxFrameDetectionPixels,
    }),
  }))
  return combinePixelGridSequenceDetections(sampled, detections, { harmonicRejection })
}

async function detectPixelGridSequenceAsync(frames, {
  minCell = 2,
  maxCell = 32,
  alphaThreshold = 8,
  sampleLimit = 12,
  harmonicRejection = true,
  maxSequencePixels = MAX_SEQUENCE_DETECTION_PIXELS,
  maxFrameDetectionPixels = MAX_GRID_DETECTION_PIXELS,
  signal = null,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error('detectPixelGridSequence requires frames')
  }
  const sampled = sequenceSampleIndexes(frames, sampleLimit, maxSequencePixels)
  const detections = []
  await yieldForPixelGridCancellation(signal)
  for (const frameIndex of sampled) {
    throwIfPixelGridAborted(signal)
    detections.push({
      frame_index: frameIndex,
      detection: detectPixelGrid(frames[frameIndex], {
        minCell,
        maxCell,
        alphaThreshold,
        candidateLimit: MAX_GRID_CELL_SIZE,
        maxDetectionPixels: maxFrameDetectionPixels,
      }),
    })
    await yieldForPixelGridCancellation(signal)
  }
  return combinePixelGridSequenceDetections(sampled, detections, { harmonicRejection })
}

async function detectBestPixelGridAsync(frames, {
  minCell,
  maxCell,
  alphaThreshold,
  sampleLimit,
  maxFrameDetectionPixels,
  signal,
}) {
  const detections = []
  const sampled = legacyDetectionIndexes(frames, sampleLimit)
  await yieldForPixelGridCancellation(signal)
  for (const frameIndex of sampled) {
    throwIfPixelGridAborted(signal)
    detections.push(detectPixelGrid(frames[frameIndex], {
      minCell,
      maxCell,
      alphaThreshold,
      maxDetectionPixels: maxFrameDetectionPixels,
    }))
    await yieldForPixelGridCancellation(signal)
  }
  return detections
    .sort((a, b) => b.confidence - a.confidence || (b.cell_size ?? 0) - (a.cell_size ?? 0))[0] ??
    detectPixelGrid(frames[0], {
      minCell,
      maxCell,
      alphaThreshold,
      maxDetectionPixels: maxFrameDetectionPixels,
    })
}

export function buildSharedPalette(frames, {
  maxColors = 16,
  sampleLimit = 12,
  alphaThreshold = 8,
  maxSamplePixels = MAX_PALETTE_SAMPLE_PIXELS,
  reservedColors = [],
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('buildSharedPalette requires at least one frame')
  const colorLimit = clampInt(maxColors, 2, 64)
  const fixedColors = []
  const fixedColorKeys = new Set()
  for (const color of reservedColors) {
    const normalized = normalizeRgb(color)
    const key = normalized.join(',')
    if (fixedColorKeys.has(key)) continue
    fixedColorKeys.add(key)
    fixedColors.push(normalized)
    if (fixedColors.length >= colorLimit) break
  }
  const extractedColorLimit = Math.max(0, colorLimit - fixedColors.length)
  const sampled = sampledFrameIndexes(frames.length, Math.max(1, clampInt(sampleLimit, 1, frames.length)))
  const pixelBudget = clampInt(maxSamplePixels, 1, MAX_PALETTE_SAMPLE_PIXELS)
  const pooledData = new Uint8ClampedArray(pixelBudget * 4)
  const perFrameBudget = Math.max(1, Math.floor(pixelBudget / sampled.length))
  let cursor = 0
  let sourceColorCount = 0
  const sourceColors = new Set()
  for (const index of sampled) {
    const frame = frames[index]
    const framePixels = frame.width * frame.height
    const stride = Math.max(1, Math.ceil(Math.sqrt(framePixels / perFrameBudget)))
    let sampledFromFrame = 0
    for (let y = 0; y < frame.height && cursor < pooledData.length; y += stride) {
      for (let x = 0; x < frame.width && cursor < pooledData.length; x += stride) {
        if (sampledFromFrame >= perFrameBudget) break
        const offset = pixelOffset(frame.width, x, y)
        const key = `${frame.data[offset]},${frame.data[offset + 1]},${frame.data[offset + 2]}`
        if (frame.data[offset + 3] >= alphaThreshold) {
          if (!sourceColors.has(key)) {
            sourceColors.add(key)
            sourceColorCount += 1
          }
        }
        sampledFromFrame += 1
        if (
          extractedColorLimit === 0 ||
          (
            frame.data[offset + 3] >= alphaThreshold &&
            fixedColorKeys.has(key)
          )
        ) {
          continue
        }
        pooledData[cursor] = frame.data[offset]
        pooledData[cursor + 1] = frame.data[offset + 1]
        pooledData[cursor + 2] = frame.data[offset + 2]
        pooledData[cursor + 3] = frame.data[offset + 3]
        cursor += 4
      }
    }
  }
  const sampledPixelCount = cursor / 4
  const pooled = {
    width: Math.max(1, sampledPixelCount),
    height: 1,
    data: sampledPixelCount
      ? pooledData.slice(0, sampledPixelCount * 4)
      : new Uint8ClampedArray(4),
  }
  const extractedColors = extractedColorLimit
    ? extractPalette(pooled, { maxColors: extractedColorLimit, alphaThreshold }).map((color) => color.rgb)
    : []
  const colors = [...extractedColors, ...fixedColors]
  return {
    colors,
    sampled_frame_count: sampled.length,
    sampled_pixel_count: sampledPixelCount,
    sample_pixel_limit: pixelBudget,
    source_color_count: sourceColorCount,
    reserved_colors: fixedColors,
  }
}

function srgbChannelToLinear(value) {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function rgbToOklab(rgb) {
  const r = srgbChannelToLinear(rgb[0])
  const g = srgbChannelToLinear(rgb[1])
  const b = srgbChannelToLinear(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabDistanceSq(a, b) {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

function paletteDistanceContext(palette, colorDistance) {
  return {
    mode: colorDistance === 'oklab' ? 'oklab' : 'rgb',
    oklab: colorDistance === 'oklab' ? palette.map(rgbToOklab) : null,
  }
}

function nearestPaletteIndex(
  data,
  offset,
  palette,
  context = paletteDistanceContext(palette, 'rgb'),
  candidateCount = palette.length
) {
  const limit = Math.max(1, Math.min(palette.length, candidateCount))
  const sourceLab = context.mode === 'oklab'
    ? rgbToOklab([data[offset], data[offset + 1], data[offset + 2]])
    : null
  let bestIndex = 0
  let bestDistance = context.mode === 'oklab'
    ? oklabDistanceSq(sourceLab, context.oklab[0])
    : colorDistanceSq(data, offset, palette[0])
  for (let index = 1; index < limit; index += 1) {
    const distance = context.mode === 'oklab'
      ? oklabDistanceSq(sourceLab, context.oklab[index])
      : colorDistanceSq(data, offset, palette[index])
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

function snapToPaletteWithDistance(image, {
  palette,
  alphaThreshold = 1,
  colorDistance = 'rgb',
  reservedColors = [],
} = {}) {
  const output = cloneRgba(image)
  const context = paletteDistanceContext(palette, colorDistance)
  const paletteIndexes = new Uint8Array(image.width * image.height)
  paletteIndexes.fill(255)
  const fixedColorCount = Math.min(reservedColors.length, palette.length)
  const baseColorCount = palette.length - fixedColorCount
  const fixedIndexes = new Map()
  for (let index = baseColorCount; index < palette.length; index += 1) {
    fixedIndexes.set(palette[index].join(','), index)
  }
  let visiblePixelCount = 0
  let colorComparisonCount = 0
  for (let offset = 0; offset < output.data.length; offset += 4) {
    if (output.data[offset + 3] < alphaThreshold) continue
    const exactFixedIndex = fixedIndexes.get(
      `${output.data[offset]},${output.data[offset + 1]},${output.data[offset + 2]}`
    )
    const paletteIndex = exactFixedIndex ?? nearestPaletteIndex(
      output.data,
      offset,
      palette,
      context,
      baseColorCount || palette.length
    )
    if (exactFixedIndex === undefined) {
      colorComparisonCount += baseColorCount || palette.length
    }
    const color = palette[paletteIndex]
    paletteIndexes[offset / 4] = paletteIndex
    output.data[offset] = color[0]
    output.data[offset + 1] = color[1]
    output.data[offset + 2] = color[2]
    visiblePixelCount += 1
  }
  return {
    image: output,
    paletteIndexes,
    visiblePixelCount,
    colorComparisonCount,
  }
}

function countChangedPixels(before, after) {
  const length = Math.min(before.data.length, after.data.length)
  let changed = 0
  let total = 0
  for (let offset = 0; offset < length; offset += 4) {
    total += 1
    if (
      before.data[offset] !== after.data[offset] ||
      before.data[offset + 1] !== after.data[offset + 1] ||
      before.data[offset + 2] !== after.data[offset + 2] ||
      before.data[offset + 3] !== after.data[offset + 3]
    ) changed += 1
  }
  return { changed, total }
}

function detailProtectionPolicy(mode) {
  if (mode === 'detail_safe') {
    return {
      min_colors: 2,
      max_dominant_ratio: 0.78,
      min_transition_density: 0.08,
    }
  }
  if (mode === 'balanced') {
    return {
      min_colors: 3,
      max_dominant_ratio: 0.62,
      min_transition_density: 0.2,
    }
  }
  return null
}

function cellTransitionDensity(paletteIndexes, imageWidth, xBounds, yBounds) {
  let compared = 0
  let changed = 0
  for (let y = yBounds.start; y < yBounds.end; y += 1) {
    for (let x = xBounds.start; x < xBounds.end; x += 1) {
      const paletteIndex = paletteIndexes[y * imageWidth + x]
      if (paletteIndex === 255) continue
      if (x + 1 < xBounds.end) {
        const right = paletteIndexes[y * imageWidth + x + 1]
        if (right !== 255) {
          compared += 1
          if (right !== paletteIndex) changed += 1
        }
      }
      if (y + 1 < yBounds.end) {
        const down = paletteIndexes[(y + 1) * imageWidth + x]
        if (down !== 255) {
          compared += 1
          if (down !== paletteIndex) changed += 1
        }
      }
    }
  }
  return compared ? changed / compared : 0
}

function projectLogicalOutline({
  baseLogical,
  outlinedLogical,
  output,
  xRange,
  yRange,
  offsetX,
  offsetY,
  cellSize,
}) {
  let outlineCellCount = 0
  let outlinePixelCount = 0
  for (let ly = 0; ly < baseLogical.height; ly += 1) {
    for (let lx = 0; lx < baseLogical.width; lx += 1) {
      const logicalOffset = pixelOffset(baseLogical.width, lx, ly)
      if (baseLogical.data[logicalOffset + 3] > 0 || outlinedLogical.data[logicalOffset + 3] === 0) continue
      const cx = xRange.min + lx
      const cy = yRange.min + ly
      const xBounds = cellBoundsForIndex(output.width, offsetX, cellSize, cx)
      const yBounds = cellBoundsForIndex(output.height, offsetY, cellSize, cy)
      for (let y = yBounds.start; y < yBounds.end; y += 1) {
        for (let x = xBounds.start; x < xBounds.end; x += 1) {
          const outputOffset = pixelOffset(output.width, x, y)
          output.data[outputOffset] = outlinedLogical.data[logicalOffset]
          output.data[outputOffset + 1] = outlinedLogical.data[logicalOffset + 1]
          output.data[outputOffset + 2] = outlinedLogical.data[logicalOffset + 2]
          output.data[outputOffset + 3] = outlinedLogical.data[logicalOffset + 3]
          outlinePixelCount += 1
        }
      }
      outlineCellCount += 1
    }
  }
  return {
    cellCount: outlineCellCount,
    pixelCount: outlinePixelCount,
  }
}

function sameRgbAt(image, offset, rgb) {
  return image.data[offset] === rgb[0] &&
    image.data[offset + 1] === rgb[1] &&
    image.data[offset + 2] === rgb[2]
}

function strengthenLogicalOuterOutline(image, outlineColor) {
  const rgb = normalizeRgb(outlineColor)
  const output = cloneRgba(image)
  let added = 0
  let nonOutlineVisible = 0
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] > 0) {
        if (!sameRgbAt(image, offset, rgb)) nonOutlineVisible += 1
        continue
      }
      let touchesNonOutlineVisible = false
      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
        const neighborOffset = pixelOffset(image.width, nx, ny)
        if (
          image.data[neighborOffset + 3] > 0 &&
          !sameRgbAt(image, neighborOffset, rgb)
        ) {
          touchesNonOutlineVisible = true
          break
        }
      }
      if (!touchesNonOutlineVisible) continue
      output.data[offset] = rgb[0]
      output.data[offset + 1] = rgb[1]
      output.data[offset + 2] = rgb[2]
      output.data[offset + 3] = 255
      added += 1
    }
  }
  return {
    image: output,
    report: {
      mode: 'outer',
      output_mutation: added ? 'outline_strengthen' : 'none',
      outline_pixel_count: added,
      outline_pixel_ratio: image.width * image.height
        ? round(added / (image.width * image.height), 6)
        : 0,
      color: rgb,
      reason: nonOutlineVisible > 0 ? null : 'outline_ambiguous_single_color',
    },
  }
}

function assertSingleFrameRefinementBudget(image, {
  cellSize,
  offsetX,
  offsetY,
  paletteColorCount,
}) {
  const pixels = safeProduct(image.width, image.height)
  const colorComparisons = safeProduct(pixels, paletteColorCount)
  const xRange = indexRange(image.width, offsetX, cellSize)
  const yRange = indexRange(image.height, offsetY, cellSize)
  const totalCells =
    Math.max(0, xRange.max - xRange.min + 1) *
    Math.max(0, yRange.max - yRange.min + 1)
  const violations = []
  if (pixels > PIXEL_GRID_REFINEMENT_LIMITS.max_frame_pixels) {
    violations.push('max_frame_pixels')
  }
  if (colorComparisons > PIXEL_GRID_REFINEMENT_LIMITS.max_color_comparisons) {
    violations.push('max_color_comparisons')
  }
  if (totalCells > PIXEL_GRID_REFINEMENT_LIMITS.max_total_cells) {
    violations.push('max_total_cells')
  }
  if (!violations.length) return
  const error = new Error('pixel grid single-frame refinement budget exceeded')
  error.code = 'pixel_grid_refinement_budget_exceeded'
  error.resource_budget = {
    status: 'exceeded',
    estimates: {
      frame_pixels: pixels,
      palette_color_count: paletteColorCount,
      color_comparisons: colorComparisons,
      total_cells: totalCells,
    },
    limits: PIXEL_GRID_REFINEMENT_LIMITS,
    violations,
  }
  throw error
}

export function refinePixelFrame(image, {
  grid,
  palette,
  alphaHardenThreshold = 128,
  emptyCellCoverage = 0.5,
  emitLogical = true,
  colorDistance = 'rgb',
  detailProtection = 'off',
  outlineMode = 'none',
  outlineColor = [24, 24, 32],
  reservedPaletteColors = [],
} = {}) {
  if (!grid?.cell_size) throw new Error('refinePixelFrame requires a detected grid')
  const colors = (palette?.colors ?? palette ?? []).map(normalizeRgb)
  if (!colors.length) throw new Error('refinePixelFrame requires a palette')
  if (!['rgb', 'oklab'].includes(colorDistance)) throw new Error('invalid_pixel_grid_color_distance')
  if (!['off', 'balanced', 'detail_safe'].includes(detailProtection)) throw new Error('invalid_pixel_grid_detail_protection')
  if (!['none', 'outer'].includes(outlineMode)) throw new Error('invalid_pixel_grid_outline_mode')
  const cellSize = clampInt(grid.cell_size, 1, Math.max(image.width, image.height))
  const offsetX = clampInt(grid.offset?.x ?? 0, 0, cellSize - 1)
  const offsetY = clampInt(grid.offset?.y ?? 0, 0, cellSize - 1)
  assertSingleFrameRefinementBudget(image, {
    cellSize,
    offsetX,
    offsetY,
    paletteColorCount: colors.length,
  })
  const alphaThreshold = clampInt(alphaHardenThreshold, 1, 255)
  const coverageThreshold = Math.max(0, Math.min(1, Number(emptyCellCoverage)))
  const snappedResult = snapToPaletteWithDistance(image, {
    palette: colors,
    alphaThreshold: 1,
    colorDistance,
    reservedColors: reservedPaletteColors,
  })
  const snapped = snappedResult.image
  const paletteIndexes = snappedResult.paletteIndexes
  const output = cloneRgba(snapped)
  const xRange = indexRange(image.width, offsetX, cellSize)
  const yRange = indexRange(image.height, offsetY, cellSize)
  const logicalWidth = Math.max(0, xRange.max - xRange.min + 1)
  const logicalHeight = Math.max(0, yRange.max - yRange.min + 1)
  const baseLogical = {
    width: logicalWidth,
    height: logicalHeight,
    data: new Uint8ClampedArray(logicalWidth * logicalHeight * 4),
  }
  const detailPolicy = detailProtectionPolicy(detailProtection)
  let alphaHardenedPixelCount = 0
  let emptyCellCount = 0
  let totalCellCount = 0
  let detailProtectedCellCount = 0
  let detailProtectedPixelCount = 0
  const counts = new Float64Array(colors.length)

  for (let cy = yRange.min; cy <= yRange.max; cy += 1) {
    const yBounds = cellBoundsForIndex(image.height, offsetY, cellSize, cy)
    if (yBounds.start >= yBounds.end) continue
    for (let cx = xRange.min; cx <= xRange.max; cx += 1) {
      const xBounds = cellBoundsForIndex(image.width, offsetX, cellSize, cx)
      if (xBounds.start >= xBounds.end) continue
      totalCellCount += 1
      counts.fill(0)
      let visible = 0
      let total = 0
      let totalPaletteWeight = 0
      for (let y = yBounds.start; y < yBounds.end; y += 1) {
        for (let x = xBounds.start; x < xBounds.end; x += 1) {
          const offset = pixelOffset(image.width, x, y)
          total += 1
          const hardenedAlpha =
            image.data[offset + 3] > 0 && image.data[offset + 3] >= alphaThreshold
              ? 255
              : 0
          if (hardenedAlpha !== image.data[offset + 3]) alphaHardenedPixelCount += 1
          if (!hardenedAlpha) continue
          visible += 1
          const paletteIndex = paletteIndexes[offset / 4]
          counts[paletteIndex] += image.data[offset + 3]
          totalPaletteWeight += image.data[offset + 3]
        }
      }
      const coverage = total ? visible / total : 0
      let dominantIndex = 0
      let dominantCount = counts[0] ?? 0
      let colorCount = dominantCount > 0 ? 1 : 0
      for (let index = 1; index < counts.length; index += 1) {
        const count = counts[index]
        if (count > 0) colorCount += 1
        if (count > dominantCount) {
          dominantCount = count
          dominantIndex = index
        }
      }
      const dominantRatio = totalPaletteWeight ? dominantCount / totalPaletteWeight : 1
      const transitionDensity = cellTransitionDensity(
        paletteIndexes,
        image.width,
        xBounds,
        yBounds
      )
      const protectDetail = Boolean(
        detailPolicy &&
        visible > 0 &&
        coverage >= Math.max(0.1, coverageThreshold / 2) &&
        colorCount >= detailPolicy.min_colors &&
        dominantRatio <= detailPolicy.max_dominant_ratio &&
        transitionDensity >= detailPolicy.min_transition_density
      )
      const opaque = protectDetail || (visible > 0 && total > 0 && coverage >= coverageThreshold)
      const color = opaque ? colors[dominantIndex] : [0, 0, 0]

      if (protectDetail) {
        detailProtectedCellCount += 1
        detailProtectedPixelCount += total
        for (let y = yBounds.start; y < yBounds.end; y += 1) {
          for (let x = xBounds.start; x < xBounds.end; x += 1) {
            const offset = pixelOffset(output.width, x, y)
            const hardenedAlpha =
              image.data[offset + 3] > 0 && image.data[offset + 3] >= alphaThreshold
                ? 255
                : 0
            if (!hardenedAlpha) {
              output.data[offset] = 0
              output.data[offset + 1] = 0
              output.data[offset + 2] = 0
              output.data[offset + 3] = 0
              continue
            }
            output.data[offset + 3] = 255
          }
        }
      } else {
        if (!opaque) emptyCellCount += 1
        for (let y = yBounds.start; y < yBounds.end; y += 1) {
          for (let x = xBounds.start; x < xBounds.end; x += 1) {
            const offset = pixelOffset(output.width, x, y)
            output.data[offset] = color[0]
            output.data[offset + 1] = color[1]
            output.data[offset + 2] = color[2]
            output.data[offset + 3] = opaque ? 255 : 0
          }
        }
      }

      const lx = cx - xRange.min
      const ly = cy - yRange.min
      const logicalOffset = pixelOffset(baseLogical.width, lx, ly)
      baseLogical.data[logicalOffset] = color[0]
      baseLogical.data[logicalOffset + 1] = color[1]
      baseLogical.data[logicalOffset + 2] = color[2]
      baseLogical.data[logicalOffset + 3] = opaque ? 255 : 0
    }
  }

  let logicalImage = baseLogical
  let outlineReport = {
    stage: 'after_refinement',
    mode: 'none',
    output_mutation: 'none',
    outline_cell_count: 0,
    outline_logical_pixel_count: 0,
    outline_pixel_count: 0,
    outline_pixel_ratio: 0,
    color: normalizeRgb(outlineColor),
  }
  if (outlineMode === 'outer') {
    const outlined = strengthenLogicalOuterOutline(baseLogical, outlineColor)
    const projected = projectLogicalOutline({
      baseLogical,
      outlinedLogical: outlined.image,
      output,
      xRange,
      yRange,
      offsetX,
      offsetY,
      cellSize,
    })
    logicalImage = outlined.image
    outlineReport = {
      ...outlined.report,
      stage: 'after_refinement',
      mode: 'outer',
      outline_cell_count: projected.cellCount,
      added_outline_cell_count: projected.cellCount,
      outline_logical_pixel_count: projected.cellCount,
      outline_pixel_count: projected.pixelCount,
      outline_pixel_ratio: output.width * output.height
        ? round(projected.pixelCount / (output.width * output.height), 6)
        : 0,
    }
  }

  const changed = countChangedPixels(image, output)
  return {
    image: output,
    logicalImage: emitLogical ? logicalImage : null,
    report: {
      changed_pixel_count: changed.changed,
      changed_pixel_ratio: changed.total ? round(changed.changed / changed.total) : 0,
      alpha_hardened_pixel_count: alphaHardenedPixelCount,
      empty_cell_count: emptyCellCount,
      total_cell_count: totalCellCount,
      detail_protected_cell_count: detailProtectedCellCount,
      detail_protected_pixel_count: detailProtectedPixelCount,
      color_comparison_count: snappedResult.colorComparisonCount,
      detail_protected_cell_ratio: totalCellCount
        ? round(detailProtectedCellCount / totalCellCount, 6)
        : 0,
      detail_protection_reason: detailProtectedCellCount ? 'source_detail_preserved' : null,
      outline: outlineReport,
    },
  }
}

function boundedRefinementLimit(value, fallback) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('pixel grid refinement resource limits must be positive safe integers')
  }
  return Math.min(number, fallback)
}

function normalizeRefinementLimits(value = {}) {
  return {
    max_frame_pixels: boundedRefinementLimit(
      value.max_frame_pixels,
      PIXEL_GRID_REFINEMENT_LIMITS.max_frame_pixels
    ),
    max_total_pixels: boundedRefinementLimit(
      value.max_total_pixels,
      PIXEL_GRID_REFINEMENT_LIMITS.max_total_pixels
    ),
    max_color_comparisons: boundedRefinementLimit(
      value.max_color_comparisons,
      PIXEL_GRID_REFINEMENT_LIMITS.max_color_comparisons
    ),
    max_total_cells: boundedRefinementLimit(
      value.max_total_cells,
      PIXEL_GRID_REFINEMENT_LIMITS.max_total_cells
    ),
  }
}

function safeProduct(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
    return Number.MAX_SAFE_INTEGER
  }
  if (a && b > Math.floor(Number.MAX_SAFE_INTEGER / a)) return Number.MAX_SAFE_INTEGER
  return a * b
}

function refinementWorkEstimate(frames, grid, paletteColorCount, limits) {
  let totalPixels = 0
  let maxFramePixels = 0
  let totalCells = 0
  for (const frame of frames) {
    const pixels = safeProduct(frame.width, frame.height)
    totalPixels = Math.min(Number.MAX_SAFE_INTEGER, totalPixels + pixels)
    maxFramePixels = Math.max(maxFramePixels, pixels)
    const xRange = indexRange(frame.width, grid.offset?.x ?? 0, grid.cell_size)
    const yRange = indexRange(frame.height, grid.offset?.y ?? 0, grid.cell_size)
    totalCells = Math.min(
      Number.MAX_SAFE_INTEGER,
      totalCells +
        Math.max(0, xRange.max - xRange.min + 1) *
        Math.max(0, yRange.max - yRange.min + 1)
    )
  }
  const colorComparisons = safeProduct(totalPixels, paletteColorCount)
  const violations = []
  if (maxFramePixels > limits.max_frame_pixels) violations.push('max_frame_pixels')
  if (totalPixels > limits.max_total_pixels) violations.push('max_total_pixels')
  if (colorComparisons > limits.max_color_comparisons) violations.push('max_color_comparisons')
  if (totalCells > limits.max_total_cells) violations.push('max_total_cells')
  return {
    status: violations.length ? 'exceeded' : 'within_budget',
    estimates: {
      max_frame_pixels: maxFramePixels,
      total_pixels: totalPixels,
      palette_color_count: paletteColorCount,
      color_comparisons: colorComparisons,
      total_cells: totalCells,
    },
    limits,
    violations,
  }
}

function gridConsensusReport(grid) {
  return {
    sampled_frame_count: grid.sampled_frame_indexes?.length ?? 0,
    supporting_frame_count: grid.supporting_frame_count ?? 0,
    support_ratio: grid.support_ratio ?? 0,
    phase_agreement: grid.phase_agreement ?? 0,
    candidates: grid.candidates ?? [],
    rejected_harmonics: grid.rejected_harmonics ?? [],
    frame_detections: grid.frame_detections ?? [],
  }
}

function gridSummary(grid) {
  return {
    cell_size: grid.cell_size,
    offset: grid.offset,
    confidence: grid.confidence,
    method: grid.method,
  }
}

function emptyFrameReports(frames) {
  return frames.map((_, index) => ({
    index,
    changed_pixel_ratio: 0,
    alpha_hardened_pixel_count: 0,
    empty_cell_count: 0,
    detail_protected_cell_count: 0,
    detail_protected_pixel_count: 0,
    color_comparison_count: 0,
  }))
}

function reportSettings(settings) {
  return {
    min_cell: settings.minCell,
    max_cell: settings.maxCell,
    min_confidence: settings.minConfidence,
    min_sequence_support: settings.minSequenceSupport,
    max_colors: settings.maxColors,
    sample_limit: settings.sampleLimit,
  }
}

function passthroughNoGridResult({
  frames,
  resolvedRecipe,
  grid,
  settings,
  warnings,
}) {
  const legacy = resolvedRecipe.schema_version === 1
  return {
    status: 'passthrough_no_grid',
    frames,
    logicalFrames: null,
    logicalSafe: false,
    grid,
    palette: { colors: [], sampled_frame_count: 0, source_color_count: 0 },
    report: {
      schema_version: resolvedRecipe.schema_version,
      mode: legacy ? 'pixel_grid_refinement_v1' : 'pixel_grid_refinement_v2',
      ...(legacy ? {} : { recipe: resolvedRecipe, settings: reportSettings(settings) }),
      status: 'passthrough_no_grid',
      grid: legacy ? grid : gridSummary(grid),
      ...(legacy ? {} : { consensus: gridConsensusReport(grid) }),
      palette: { max_colors: settings.maxColors, color_count: 0 },
      frames: emptyFrameReports(frames),
      sequence: {
        frame_count: frames.length,
        shared_palette: false,
        ...(legacy
          ? { flicker_guarantee: null }
          : { shared_grid: false, invariants: [] }),
      },
      ...(legacy
        ? {}
        : {
            resource_budget: {
              status: 'not_evaluated',
              reason: 'no_reliable_grid',
              limits: settings.resourceLimits,
            },
            outline: {
              stage: 'after_refinement',
              mode: 'none',
              outline_cell_count: 0,
              outline_logical_pixel_count: 0,
              outline_logical_pixel_ratio: 0,
              outline_pixel_count: 0,
              outline_pixel_ratio: 0,
            },
          }),
      warnings,
    },
  }
}

function passthroughRefinementBudgetResult({
  frames,
  resolvedRecipe,
  grid,
  palette,
  settings,
  resourceBudget,
  warnings,
}) {
  const legacy = resolvedRecipe.schema_version === 1
  return {
    status: 'passthrough_refinement_budget',
    frames,
    logicalFrames: null,
    logicalSafe: false,
    grid,
    palette,
    report: {
      schema_version: resolvedRecipe.schema_version,
      mode: legacy ? 'pixel_grid_refinement_v1' : 'pixel_grid_refinement_v2',
      ...(legacy ? {} : { recipe: resolvedRecipe, settings: reportSettings(settings) }),
      status: 'passthrough_refinement_budget',
      grid: legacy ? grid : gridSummary(grid),
      ...(legacy ? {} : { consensus: gridConsensusReport(grid) }),
      palette: {
        max_colors: settings.maxColors,
        color_count: palette.colors.length,
        ...(legacy
          ? {}
          : {
              color_distance: resolvedRecipe.color_distance,
              sampled_pixel_count: palette.sampled_pixel_count,
              sample_pixel_limit: palette.sample_pixel_limit,
              reserved_colors: palette.reserved_colors ?? [],
            }),
      },
      frames: emptyFrameReports(frames),
      sequence: {
        frame_count: frames.length,
        shared_palette: false,
        ...(legacy
          ? { flicker_guarantee: null }
          : { shared_grid: false, invariants: [] }),
      },
      ...(legacy
        ? {}
        : {
            resource_budget: resourceBudget,
            outline: {
              stage: 'after_refinement',
              mode: 'none',
              outline_cell_count: 0,
              outline_logical_pixel_count: 0,
              outline_logical_pixel_ratio: 0,
              outline_pixel_count: 0,
              outline_pixel_ratio: 0,
            },
          }),
      warnings,
    },
  }
}

function normalizeRefineFramesSettings(options = {}) {
  const minCell = clampInt(options.minCell ?? 2, 2, MAX_GRID_CELL_SIZE)
  const maxCell = Math.max(
    minCell,
    clampInt(options.maxCell ?? 32, minCell, MAX_GRID_CELL_SIZE)
  )
  return {
    recipe: options.recipe,
    maxColors: clampInt(options.maxColors ?? 16, 2, 64),
    minConfidence: finiteUnitOption(options.minConfidence ?? 0.6, 'minConfidence'),
    minSequenceSupport: finiteUnitOption(
      options.minSequenceSupport ?? 0.5,
      'minSequenceSupport'
    ),
    minCell,
    maxCell,
    alphaThreshold: clampInt(options.alphaThreshold ?? 8, 1, 255),
    alphaHardenThreshold: clampInt(options.alphaHardenThreshold ?? 128, 1, 255),
    emptyCellCoverage: finiteUnitOption(
      options.emptyCellCoverage ?? 0.5,
      'emptyCellCoverage'
    ),
    emitLogical: options.emitLogical !== false,
    sampleLimit: clampInt(options.sampleLimit ?? 12, 1, 16),
    outlineMode: options.outlineMode ?? 'none',
    outlineColor: normalizeRgb(options.outlineColor ?? [24, 24, 32]),
    resourceLimits: normalizeRefinementLimits(options.resourceLimits),
  }
}

function preparePixelGridRefinement(frames, options = {}, precomputedGrid = null) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error('refinePixelFrames requires at least one frame')
  }
  const settings = normalizeRefineFramesSettings(options)
  const resolvedRecipe = resolvePixelGridRecipe(
    settings.recipe ?? PIXEL_GRID_RECIPE_IDS.V1_COMPAT
  )
  const legacyIndexes = resolvedRecipe.sequence_consensus
    ? []
    : legacyDetectionIndexes(frames, settings.sampleLimit)
  const maxFrameDetectionPixels = frames.length === 1
    ? MAX_SINGLE_FRAME_GRID_DETECTION_PIXELS
    : MAX_GRID_DETECTION_PIXELS
  const grid = precomputedGrid ?? (
    resolvedRecipe.sequence_consensus
      ? detectPixelGridSequence(frames, {
          minCell: settings.minCell,
          maxCell: settings.maxCell,
          alphaThreshold: settings.alphaThreshold,
          sampleLimit: settings.sampleLimit,
          harmonicRejection: resolvedRecipe.harmonic_rejection,
          maxFrameDetectionPixels,
        })
      : legacyIndexes
          .map((index) => detectPixelGrid(frames[index], {
            minCell: settings.minCell,
            maxCell: settings.maxCell,
            alphaThreshold: settings.alphaThreshold,
            maxDetectionPixels: maxFrameDetectionPixels,
          }))
          .sort((a, b) => b.confidence - a.confidence || (b.cell_size ?? 0) - (a.cell_size ?? 0))[0] ??
        detectPixelGrid(frames[0], {
          minCell: settings.minCell,
          maxCell: settings.maxCell,
          alphaThreshold: settings.alphaThreshold,
          maxDetectionPixels: maxFrameDetectionPixels,
        })
  )
  const warnings = []
  const insufficientSupport = resolvedRecipe.sequence_consensus &&
    Number(grid.support_ratio ?? 0) < settings.minSequenceSupport
  if (!grid.cell_size || grid.confidence < settings.minConfidence || insufficientSupport) {
    if (
      grid.method === 'budget_exceeded' ||
      grid.frame_detections?.some((item) => item.method === 'budget_exceeded')
    ) {
      warnings.push('grid_detection_budget_exceeded')
    }
    if (insufficientSupport) warnings.push('insufficient_sequence_grid_support')
    warnings.push('no_reliable_grid_detected')
    return {
      result: passthroughNoGridResult({
        frames,
        resolvedRecipe,
        grid,
        settings,
        warnings,
      }),
    }
  }

  const palette = buildSharedPalette(frames, {
    maxColors: settings.maxColors,
    sampleLimit: settings.sampleLimit,
    alphaThreshold: settings.alphaThreshold,
    reservedColors:
      resolvedRecipe.schema_version === 2 && settings.outlineMode === 'outer'
        ? [settings.outlineColor]
        : [],
  })
  if (!palette.colors.length || palette.source_color_count === 0) {
    warnings.push('no_visible_palette_colors')
    warnings.push('no_reliable_grid_detected')
    return {
      result: passthroughNoGridResult({
        frames,
        resolvedRecipe,
        grid,
        settings,
        warnings,
      }),
    }
  }
  const resourceBudget = refinementWorkEstimate(
    frames,
    grid,
    palette.colors.length,
    settings.resourceLimits
  )
  if (resourceBudget.status === 'exceeded') {
    warnings.push('grid_refinement_budget_exceeded')
    return {
      result: passthroughRefinementBudgetResult({
        frames,
        resolvedRecipe,
        grid,
        palette,
        settings,
        resourceBudget,
        warnings,
      }),
    }
  }
  return {
    frames,
    resolvedRecipe,
    grid,
    palette,
    settings,
    resourceBudget,
    warnings,
  }
}

function refinePreparedFrame(frame, prepared) {
  const { resolvedRecipe, grid, palette, settings } = prepared
  return refinePixelFrame(frame, {
    grid,
    palette: palette.colors,
    alphaHardenThreshold: settings.alphaHardenThreshold,
    emptyCellCoverage: settings.emptyCellCoverage,
    emitLogical: settings.emitLogical,
    colorDistance: resolvedRecipe.color_distance,
    detailProtection: resolvedRecipe.detail_protection,
    outlineMode: resolvedRecipe.schema_version === 2 ? settings.outlineMode : 'none',
    outlineColor: settings.outlineColor,
    reservedPaletteColors: palette.reserved_colors ?? [],
  })
}

function finalizePixelGridRefinement(prepared, refined) {
  const {
    frames,
    resolvedRecipe,
    grid,
    palette,
    settings,
    resourceBudget,
    warnings,
  } = prepared
  const totalCells = refined.reduce((sum, item) => sum + item.report.total_cell_count, 0)
  const protectedCells = refined.reduce(
    (sum, item) => sum + item.report.detail_protected_cell_count,
    0
  )
  const protectedRatio = totalCells ? protectedCells / totalCells : 0
  const logicalSafe = protectedCells === 0
  const legacy = resolvedRecipe.schema_version === 1
  const outlineCellCount = refined.reduce(
    (sum, item) => sum + item.report.outline.outline_cell_count,
    0
  )
  const outlinePixelCount = refined.reduce(
    (sum, item) => sum + item.report.outline.outline_pixel_count,
    0
  )
  const displayPixelCount = frames.reduce(
    (sum, frame) => sum + frame.width * frame.height,
    0
  )
  const logicalPixelCount = totalCells
  const actualColorComparisons = refined.reduce(
    (sum, item) => sum + item.report.color_comparison_count,
    0
  )
  return {
    status: 'refined',
    frames: refined.map((item) => item.image),
    logicalFrames:
      settings.emitLogical && logicalSafe
        ? refined.map((item) => item.logicalImage)
        : null,
    logicalSafe,
    grid,
    palette,
    report: {
      schema_version: resolvedRecipe.schema_version,
      mode: legacy ? 'pixel_grid_refinement_v1' : 'pixel_grid_refinement_v2',
      ...(legacy
        ? {}
        : {
            recipe: resolvedRecipe,
            settings: reportSettings(settings),
          }),
      status: 'refined',
      grid: legacy ? grid : gridSummary(grid),
      ...(legacy ? {} : { consensus: gridConsensusReport(grid) }),
      palette: {
        max_colors: settings.maxColors,
        color_count: palette.colors.length,
        ...(legacy
          ? {}
          : {
              color_distance: resolvedRecipe.color_distance,
              sampled_pixel_count: palette.sampled_pixel_count,
              sample_pixel_limit: palette.sample_pixel_limit,
              reserved_colors: palette.reserved_colors ?? [],
            }),
      },
      frames: refined.map((item, index) => ({
        index,
        ...item.report,
      })),
      sequence: {
        frame_count: frames.length,
        shared_palette: true,
        ...(legacy
          ? { flicker_guarantee: 'palette_and_grid_locked' }
          : {
              shared_grid: true,
              invariants: ['shared_palette', 'shared_grid'],
              logical_output_safe: logicalSafe,
              detail_protected_cell_count: protectedCells,
              detail_protected_cell_ratio: round(protectedRatio, 6),
            }),
      },
      ...(legacy
        ? {}
        : {
            resource_budget: {
              ...resourceBudget,
              actual_color_comparisons: actualColorComparisons,
            },
            outline: {
              stage: 'after_refinement',
              mode: settings.outlineMode,
              outline_cell_count: outlineCellCount,
              added_outline_cell_count: outlineCellCount,
              outline_logical_pixel_count: outlineCellCount,
              outline_logical_pixel_ratio: logicalPixelCount
                ? round(outlineCellCount / logicalPixelCount, 6)
                : 0,
              outline_pixel_count: outlinePixelCount,
              outline_pixel_ratio: displayPixelCount
                ? round(outlinePixelCount / displayPixelCount, 6)
                : 0,
              color: settings.outlineColor,
            },
          }),
      warnings,
    },
  }
}

function throwIfPixelGridAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('pixel grid refinement cancelled')
  error.code = 'cancelled'
  error.failure_status = 'cancelled'
  error.cause = signal.reason
  throw error
}

async function yieldForPixelGridCancellation(signal) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  throwIfPixelGridAborted(signal)
}

export function refinePixelFrames(frames, options = {}) {
  const prepared = preparePixelGridRefinement(frames, options)
  if (prepared.result) return prepared.result
  const refined = frames.map((frame) => refinePreparedFrame(frame, prepared))
  return finalizePixelGridRefinement(prepared, refined)
}

export async function refinePixelFramesAsync(frames, options = {}) {
  throwIfPixelGridAborted(options.signal)
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error('refinePixelFrames requires at least one frame')
  }
  const settings = normalizeRefineFramesSettings(options)
  const resolvedRecipe = resolvePixelGridRecipe(
    settings.recipe ?? PIXEL_GRID_RECIPE_IDS.V1_COMPAT
  )
  const maxFrameDetectionPixels = frames.length === 1
    ? MAX_SINGLE_FRAME_GRID_DETECTION_PIXELS
    : MAX_GRID_DETECTION_PIXELS
  const grid = resolvedRecipe.sequence_consensus
    ? await detectPixelGridSequenceAsync(frames, {
        minCell: settings.minCell,
        maxCell: settings.maxCell,
        alphaThreshold: settings.alphaThreshold,
        sampleLimit: settings.sampleLimit,
        harmonicRejection: resolvedRecipe.harmonic_rejection,
        maxFrameDetectionPixels,
        signal: options.signal,
      })
    : await detectBestPixelGridAsync(frames, {
        minCell: settings.minCell,
        maxCell: settings.maxCell,
        alphaThreshold: settings.alphaThreshold,
        sampleLimit: settings.sampleLimit,
        maxFrameDetectionPixels,
        signal: options.signal,
      })
  const prepared = preparePixelGridRefinement(frames, options, grid)
  if (prepared.result) return prepared.result
  await yieldForPixelGridCancellation(options.signal)
  const refined = []
  for (const frame of frames) {
    throwIfPixelGridAborted(options.signal)
    refined.push(refinePreparedFrame(frame, prepared))
    await yieldForPixelGridCancellation(options.signal)
  }
  return finalizePixelGridRefinement(prepared, refined)
}
