import { cloneRgba } from './imageMath.js'

export const BACKGROUND_RECIPE_IDS = Object.freeze({
  LEGACY_AUTO: 'legacy_auto_v1',
  LEGACY_FLOOD: 'legacy_flood_v1',
  LEGACY_EDGE_PALETTE: 'legacy_edge_palette_v1',
  NATIVE_ALPHA: 'native_alpha_v1',
  DUAL_MATTE: 'dual_matte_v1',
  PASSTHROUGH: 'passthrough_v1',
  DETERMINISTIC_PIXEL_MATTE_V2: 'deterministic_pixel_matte_v2',
  ALREADY_PROCESSED: 'already_processed',
})

export const BACKGROUND_MODES = Object.freeze({
  AUTO: 'auto',
  LEGACY_FLOOD: 'legacy_flood',
  LEGACY_EDGE_PALETTE: 'legacy_edge_palette',
  ALPHA: 'alpha',
  DUAL_MATTE: 'dual_matte',
  PASSTHROUGH: 'passthrough',
  DETERMINISTIC_PIXEL_MATTE_V2: 'deterministic_pixel_matte_v2',
  ALREADY_PROCESSED: 'already_processed',
})

export const ALPHA_PROVENANCE = Object.freeze({
  OPAQUE: 'opaque',
  NATIVE: 'native',
  PROVIDER: 'provider',
  STAGING: 'staging',
  DETERMINISTIC: 'deterministic',
  DUAL: 'dual',
  CALIBRATED: 'calibrated',
  UNKNOWN: 'unknown',
  ALREADY_PROCESSED: 'already_processed',
})

const MODE_ALIASES = new Map([
  ['auto', BACKGROUND_MODES.AUTO],
  ['flood_edge', BACKGROUND_MODES.AUTO],
  ['flood', BACKGROUND_MODES.LEGACY_FLOOD],
  ['legacy_flood', BACKGROUND_MODES.LEGACY_FLOOD],
  ['edge_palette', BACKGROUND_MODES.LEGACY_EDGE_PALETTE],
  ['legacy_edge_palette', BACKGROUND_MODES.LEGACY_EDGE_PALETTE],
  ['alpha', BACKGROUND_MODES.ALPHA],
  ['alpha_cleanup', BACKGROUND_MODES.ALPHA],
  ['transparent', BACKGROUND_MODES.ALPHA],
  ['dual_matte', BACKGROUND_MODES.DUAL_MATTE],
  ['passthrough', BACKGROUND_MODES.PASSTHROUGH],
  ['deterministic_pixel_matte_v2', BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2],
  ['matte_v2', BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2],
  ['already_processed', BACKGROUND_MODES.ALREADY_PROCESSED],
])

const RECIPE_BY_MODE = Object.freeze({
  [BACKGROUND_MODES.AUTO]: BACKGROUND_RECIPE_IDS.LEGACY_AUTO,
  [BACKGROUND_MODES.LEGACY_FLOOD]: BACKGROUND_RECIPE_IDS.LEGACY_FLOOD,
  [BACKGROUND_MODES.LEGACY_EDGE_PALETTE]: BACKGROUND_RECIPE_IDS.LEGACY_EDGE_PALETTE,
  [BACKGROUND_MODES.ALPHA]: BACKGROUND_RECIPE_IDS.NATIVE_ALPHA,
  [BACKGROUND_MODES.DUAL_MATTE]: BACKGROUND_RECIPE_IDS.DUAL_MATTE,
  [BACKGROUND_MODES.PASSTHROUGH]: BACKGROUND_RECIPE_IDS.PASSTHROUGH,
  [BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2]: BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2,
  [BACKGROUND_MODES.ALREADY_PROCESSED]: BACKGROUND_RECIPE_IDS.ALREADY_PROCESSED,
})

export function resolveBackgroundMode(
  value,
  {
    defaultMode = BACKGROUND_MODES.AUTO,
    allowDeterministicV2 = false,
    allowAlreadyProcessed = false,
  } = {},
) {
  const requested = String(value ?? defaultMode).trim().toLowerCase() || defaultMode
  const canonical = MODE_ALIASES.get(requested)
  if (!canonical) throw new Error(`unknown background mode: ${requested}`)
  if (canonical === BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2 && !allowDeterministicV2) {
    throw new Error('deterministic_pixel_matte_v2 is not enabled for this path')
  }
  if (canonical === BACKGROUND_MODES.ALREADY_PROCESSED && !allowAlreadyProcessed) {
    throw new Error('already_processed is not enabled for this path')
  }
  return Object.freeze({
    requested,
    canonical,
    recipe_id: RECIPE_BY_MODE[canonical],
  })
}

export function inspectDecodedAlpha(image, { transparentSource = ALPHA_PROVENANCE.NATIVE } = {}) {
  let transparent = 0
  let partial = 0
  for (let offset = 3; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset]
    if (alpha < 255) transparent++
    if (alpha > 0 && alpha < 255) partial++
  }
  const total = image.width * image.height
  return {
    provenance: transparent ? transparentSource : ALPHA_PROVENANCE.OPAQUE,
    has_non_opaque_alpha: transparent > 0,
    has_partial_alpha: partial > 0,
    non_opaque_pixel_count: transparent,
    partial_alpha_pixel_count: partial,
    non_opaque_ratio: total ? transparent / total : 0,
  }
}

export function zeroTransparentRgbFromRgba(image) {
  const out = cloneRgba(image)
  let changedPixels = 0
  for (let offset = 0; offset < out.data.length; offset += 4) {
    if (out.data[offset + 3] !== 0) continue
    if (out.data[offset] || out.data[offset + 1] || out.data[offset + 2]) changedPixels++
    out.data[offset] = 0
    out.data[offset + 1] = 0
    out.data[offset + 2] = 0
  }
  return { image: out, changed_pixels: changedPixels }
}
