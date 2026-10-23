import { createHash } from 'node:crypto'
import { encodeRgbaPng, loadRgba } from './imageCodec.js'
import { recoverPixelGrid, SOURCE_PIXEL_MAX_PIXELS, SOURCE_PIXEL_RECOVERY_MODE } from './pixelGridSampling.js'
import { applyDeterministicPixelMatteV2 } from './backgroundMatteV2.js'
import { resolveBackgroundMode, BACKGROUND_MODES } from './backgroundProcessingContract.js'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// Runs once outside background candidate selection; callers retain the original buffer.
export async function prepareSourcePixelRecovery(buffer, options = {}, sourceLayout = null) {
  const mode = options.sourcePixelRecovery
  if (mode == null || mode === false) return null
  if (mode !== SOURCE_PIXEL_RECOVERY_MODE) throw new Error('Unsupported sourcePixelRecovery mode')
  if (options.pixelFinishing === true || options.pixel_finishing === true) throw new Error('Source pixel recovery cannot be combined with palette finishing')
  const backgroundMode = resolveBackgroundMode(options.backgroundMode, { allowDeterministicV2: true, allowAlreadyProcessed: true }).canonical
  if (backgroundMode === BACKGROUND_MODES.DUAL_MATTE) throw new Error('Source pixel recovery does not support paired dual matte sources')
  const loadedRaw = await loadRgba(buffer, { limitInputPixels: SOURCE_PIXEL_MAX_PIXELS })
  // A native template already has at most one source pixel per layout pixel.
  // Reinterpreting repeated character details as a coarser grid would erase them.
  const alreadyNative = sourceLayout?.kind === 'fixed_regions'
    && loadedRaw.width <= sourceLayout.sheet.w && loadedRaw.height <= sourceLayout.sheet.h
  const recovered = alreadyNative ? {
    image: loadedRaw,
    report: { method: SOURCE_PIXEL_RECOVERY_MODE, status: 'passthrough', reason: 'already_at_layout_resolution',
      exact_recovery: false, input: { width: loadedRaw.width, height: loadedRaw.height },
      output: { width: loadedRaw.width, height: loadedRaw.height }, local_snapping: false, palette_reduction: false },
  } : recoverPixelGrid(loadedRaw)
  const background = backgroundMode === BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2
    ? applyDeterministicPixelMatteV2(recovered.image, { decode: loadedRaw.decode })
    : null
  return {
    loadedRaw,
    image: recovered.image,
    background,
    png: recovered.report.status === 'resampled' ? await encodeRgbaPng(recovered.image) : null,
    report: {
      ...recovered.report,
      original_encoded_sha256: sha256(buffer),
      input_rgba_sha256: sha256(loadedRaw.data),
      output_rgba_sha256: sha256(recovered.image.data),
      stage: 'decoded_source_before_layout_and_background',
      artifact: recovered.report.status === 'resampled' ? 'source_pixel_recovery.png' : null,
      source_png_semantics: 'layout_calibrated_working_source',
    },
  }
}
