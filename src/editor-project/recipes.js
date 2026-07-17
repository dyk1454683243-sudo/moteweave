import {
  CHARACTER_PROCESSING_CONTRACT,
  CHARACTER_REPAIR_OUTPUT_FRAME_SIZES,
  PROCESSING_RECIPE_VERSION,
} from './constants.js'
import { clonePlain } from './safety.js'

export function createDefaultCharacterProcessingRecipe({
  fileName = 'source.png',
  sourceLayout = 'topdown_rpg_v0',
  sourceJobId = null,
  assetId = null,
  blackMatteArtifactRef = null,
  createdFrom = {},
} = {}) {
  return {
    version: PROCESSING_RECIPE_VERSION,
    target_pipeline: 'character_pack',
    pipeline_contract: CHARACTER_PROCESSING_CONTRACT,
    implementation_revision: null,
    source: {
      file_name: fileName,
      source_layout: sourceLayout,
      source_job_id: sourceJobId,
      asset_id: assetId,
      black_matte_artifact_ref: blackMatteArtifactRef,
      ...clonePlain(createdFrom.source),
    },
    background: {
      mode: 'auto',
      tolerance: 24,
      ...clonePlain(createdFrom.background),
    },
    cleanup: {
      component_cleanup: true,
      min_alpha: 18,
      min_area: 4,
      min_area_ratio: 0,
      ...clonePlain(createdFrom.cleanup),
    },
    fixed_region_staging: {
      enabled: false,
      mode: null,
      stage_size: null,
      crop_right: null,
      crop_bottom: null,
      matte_tolerance: null,
      ...clonePlain(createdFrom.fixed_region_staging),
    },
    grid: {
      manual_overrides: null,
      ...clonePlain(createdFrom.grid),
    },
    anchor_offset: {
      x: 0,
      y: 0,
      ...clonePlain(createdFrom.anchor_offset),
    },
    frame_adjustments: clonePlain(createdFrom.frame_adjustments ?? {}),
    locked_animations: [...(createdFrom.locked_animations ?? [])],
    correction: {
      auto_correct: true,
      motion_stabilize: true,
      motion_max_shift: 2,
      ...clonePlain(createdFrom.correction),
    },
    pixel_finishing: {
      enabled: false,
      max_colors: 16,
      outline: true,
      outline_mode: 'outer',
      ...clonePlain(createdFrom.pixel_finishing),
    },
    style_report: {
      enabled: true,
      max_colors: 16,
      ...clonePlain(createdFrom.style_report),
    },
    outputs: {
      frame_sizes: [...CHARACTER_REPAIR_OUTPUT_FRAME_SIZES],
      ...clonePlain(createdFrom.outputs),
    },
  }
}

export function recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer = null } = {}) {
  if (recipe.background.mode === 'dual_matte' && (!recipe.source.black_matte_artifact_ref || !Buffer.isBuffer(blackSourceBuffer))) {
    throw new TypeError('dual_matte requires a resolved managed black matte')
  }
  return {
    sourceLayout: recipe.source.source_layout,
    backgroundMode: recipe.background.mode,
    backgroundTolerance: recipe.background.tolerance,
    blackSourceBuffer,
    matteResidueCleanup: true,
    matteResidueTolerance: 40,
    matteResiduePasses: 2,
    edgeDecontamination: true,
    edgeDecontaminationMaxDistance: 112,
    edgeDecontaminationStrength: 0.55,
    sourcePreprocess: true,
    componentCleanup: recipe.cleanup.component_cleanup,
    cleanupMinAlpha: recipe.cleanup.min_alpha,
    componentCleanupMinArea: recipe.cleanup.min_area,
    componentCleanupMinAreaRatio: recipe.cleanup.min_area_ratio,
    fixedRegionSourceStaging: 'off',
    fixedRegionStageSize: null,
    fixedRegionCropRight: null,
    fixedRegionCropBottom: null,
    fixedRegionMatteTolerance: null,
    manualOverrides: clonePlain(recipe.grid.manual_overrides),
    anchorOffset: clonePlain(recipe.anchor_offset),
    frameAdjustments: clonePlain(recipe.frame_adjustments),
    lockedAnimations: [...recipe.locked_animations],
    autoCorrect: recipe.correction.auto_correct,
    motionStabilize: recipe.correction.motion_stabilize,
    motionStabilizationMaxShift: recipe.correction.motion_max_shift,
    pixelFinishing: recipe.pixel_finishing.enabled,
    pixelFinishingMaxColors: recipe.pixel_finishing.max_colors,
    pixelFinishingOutline: recipe.pixel_finishing.outline,
    pixelFinishingOutlineMode: recipe.pixel_finishing.outline_mode,
    pixelFinishingOutlineColor: [24, 24, 32],
    styleReport: true,
    styleMaxColors: recipe.style_report.max_colors,
    outputFrameSizes: [...CHARACTER_REPAIR_OUTPUT_FRAME_SIZES],
  }
}
