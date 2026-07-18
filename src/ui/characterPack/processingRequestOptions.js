const BACKGROUND_MODE_ALIASES = Object.freeze({
  flood_edge: 'auto',
  alpha: 'passthrough',
})

const CHARACTER_BACKGROUND_MODES = new Set([
  'auto',
  'passthrough',
  'flood',
  'edge_palette',
  'dual_matte',
])

export const CHARACTER_OUTPUT_FRAME_SIZES = Object.freeze([96, 64, 48, 32, 16])

function clampNumber(value, { min, max, fallback, integer = false }) {
  const blank = value === null || value === undefined || (
    typeof value === 'string' && value.trim() === ''
  )
  const numeric = blank ? Number.NaN : Number(value)
  const finite = Number.isFinite(numeric) ? numeric : fallback
  const clamped = Math.min(max, Math.max(min, finite))
  return integer ? Math.round(clamped) : clamped
}

export function normalizeCharacterBackgroundMode(value = 'auto', {
  generation = false,
} = {}) {
  const normalized = BACKGROUND_MODE_ALIASES[value] ?? value
  if (!CHARACTER_BACKGROUND_MODES.has(normalized)) {
    throw new Error(`Unsupported Character background mode: ${String(value)}`)
  }
  if (generation && normalized === 'dual_matte') return 'flood'
  return normalized
}

export function buildCharacterProcessingRequestOptions({
  backgroundMode = 'auto',
  cleanupMinAlpha = 18,
  componentCleanupMinArea = 4,
  componentCleanupMinAreaRatio = 0,
  motionStabilizationMaxShift = 2,
  generation = false,
} = {}) {
  return {
    backgroundMode: normalizeCharacterBackgroundMode(backgroundMode, { generation }),
    cleanupMinAlpha: clampNumber(cleanupMinAlpha, {
      min: 0,
      max: 80,
      fallback: 18,
    }),
    componentCleanupMinArea: clampNumber(componentCleanupMinArea, {
      min: 1,
      max: 64,
      fallback: 4,
      integer: true,
    }),
    componentCleanupMinAreaRatio: clampNumber(componentCleanupMinAreaRatio, {
      min: 0,
      max: 0.25,
      fallback: 0,
    }),
    motionStabilizationMaxShift: clampNumber(motionStabilizationMaxShift, {
      min: 0,
      max: 4,
      fallback: 2,
      integer: true,
    }),
    outputFrameSizes: [...CHARACTER_OUTPUT_FRAME_SIZES],
  }
}
