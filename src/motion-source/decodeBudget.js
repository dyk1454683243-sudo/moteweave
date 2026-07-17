const MIB = 1024 * 1024

export const DEFAULT_MOTION_DECODE_LIMITS = Object.freeze({
  zip_entry_count: 256,
  zip_uncompressed_bytes: 256 * MIB,
  page_count: 240,
  decoded_frame_count: 240,
  frame_pixels: 16_777_216,
  aggregate_rgba_bytes: 256 * MIB,
  extracted_frame_count: 64,
  sampled_frame_count: 64,
})

export class MotionDecodeBudgetError extends Error {
  constructor(budget, actual, limit, message = null) {
    super(message || `motion decode budget exceeded: ${budget} ${actual} > ${limit}`)
    this.name = 'MotionDecodeBudgetError'
    this.code = 'decode_budget_exceeded'
    this.status = 'decode_budget_exceeded'
    this.failure_status = 'decode_budget_exceeded'
    this.retry_hint = null
    this.non_retryable = true
    this.budget = budget
    this.actual = actual
    this.limit = limit
  }
}

function decodeBudgetError(budget, actual, limit, message) {
  return new MotionDecodeBudgetError(budget, actual, limit, message)
}

function safeCount(value, budget) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw decodeBudgetError(budget, value, 0, `invalid motion decode measurement: ${budget}`)
  }
  return number
}

function positiveDimension(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw decodeBudgetError(name, value, 0, `invalid decoded frame dimension: ${name}`)
  }
  return number
}

function normalizeLimits(overrides = {}) {
  const limits = {}
  for (const [name, fallback] of Object.entries(DEFAULT_MOTION_DECODE_LIMITS)) {
    const value = overrides[name] ?? fallback
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw decodeBudgetError(name, value, fallback, `invalid motion decode limit: ${name}`)
    }
    limits[name] = value
  }
  return Object.freeze(limits)
}

function assertWithin(budget, actual, limit) {
  const normalized = safeCount(actual, budget)
  if (normalized > limit) throw decodeBudgetError(budget, normalized, limit)
  return normalized
}

export function decodedRgbaBytes({ width, height } = {}) {
  const normalizedWidth = positiveDimension(width, 'frame_width')
  const normalizedHeight = positiveDimension(height, 'frame_height')
  if (normalizedWidth > Math.floor(Number.MAX_SAFE_INTEGER / normalizedHeight)) {
    throw decodeBudgetError('frame_pixels', Number.MAX_SAFE_INTEGER, 0, 'decoded frame dimensions overflow')
  }
  const pixels = normalizedWidth * normalizedHeight
  if (pixels > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    throw decodeBudgetError('aggregate_rgba_bytes', Number.MAX_SAFE_INTEGER, 0, 'decoded RGBA byte count overflow')
  }
  return { pixels, rgbaBytes: pixels * 4 }
}

export function createMotionDecodeBudget({ limits = {} } = {}) {
  const resolvedLimits = normalizeLimits(limits)
  const state = {
    zip_entry_count: 0,
    zip_uncompressed_bytes: 0,
    decoded_frame_count: 0,
    aggregate_rgba_bytes: 0,
  }

  function assertZipArchive({ entryCount, totalUncompressedBytes } = {}) {
    return {
      entry_count: assertWithin(
        'zip_entry_count',
        entryCount,
        resolvedLimits.zip_entry_count
      ),
      total_uncompressed_bytes: assertWithin(
        'zip_uncompressed_bytes',
        totalUncompressedBytes,
        resolvedLimits.zip_uncompressed_bytes
      ),
    }
  }

  function recordZipEntry({ uncompressedBytes = 0 } = {}) {
    const nextEntryCount = state.zip_entry_count + 1
    const entryBytes = safeCount(uncompressedBytes, 'zip_uncompressed_bytes')
    if (entryBytes > Number.MAX_SAFE_INTEGER - state.zip_uncompressed_bytes) {
      throw decodeBudgetError(
        'zip_uncompressed_bytes',
        Number.MAX_SAFE_INTEGER,
        resolvedLimits.zip_uncompressed_bytes,
        'ZIP uncompressed byte accounting overflow'
      )
    }
    const nextBytes = state.zip_uncompressed_bytes + entryBytes
    assertWithin('zip_entry_count', nextEntryCount, resolvedLimits.zip_entry_count)
    assertWithin('zip_uncompressed_bytes', nextBytes, resolvedLimits.zip_uncompressed_bytes)
    state.zip_entry_count = nextEntryCount
    state.zip_uncompressed_bytes = nextBytes
    return snapshot()
  }

  function assertPageCount(count) {
    return assertWithin('page_count', count, resolvedLimits.page_count)
  }

  function recordDecodedFrame({ width, height } = {}) {
    const { pixels, rgbaBytes } = decodedRgbaBytes({ width, height })
    assertWithin('frame_pixels', pixels, resolvedLimits.frame_pixels)
    const nextFrameCount = state.decoded_frame_count + 1
    assertWithin(
      'decoded_frame_count',
      nextFrameCount,
      resolvedLimits.decoded_frame_count
    )
    if (rgbaBytes > Number.MAX_SAFE_INTEGER - state.aggregate_rgba_bytes) {
      throw decodeBudgetError(
        'aggregate_rgba_bytes',
        Number.MAX_SAFE_INTEGER,
        resolvedLimits.aggregate_rgba_bytes,
        'decoded RGBA byte accounting overflow'
      )
    }
    const nextAggregate = state.aggregate_rgba_bytes + rgbaBytes
    assertWithin(
      'aggregate_rgba_bytes',
      nextAggregate,
      resolvedLimits.aggregate_rgba_bytes
    )
    state.decoded_frame_count = nextFrameCount
    state.aggregate_rgba_bytes = nextAggregate
    return {
      frame_pixels: pixels,
      frame_rgba_bytes: rgbaBytes,
      ...snapshot(),
    }
  }

  function assertExtractedFrameCount(count) {
    return assertWithin(
      'extracted_frame_count',
      count,
      resolvedLimits.extracted_frame_count
    )
  }

  function assertSampledFrameCount(count) {
    return assertWithin(
      'sampled_frame_count',
      count,
      resolvedLimits.sampled_frame_count
    )
  }

  function snapshot() {
    return {
      ...state,
      limits: resolvedLimits,
    }
  }

  return {
    assertZipArchive,
    recordZipEntry,
    assertPageCount,
    recordDecodedFrame,
    assertExtractedFrameCount,
    assertSampledFrameCount,
    snapshot,
    limits: resolvedLimits,
  }
}
