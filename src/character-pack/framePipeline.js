import { autoCorrectNormalizedFrames } from './autoCorrector.js'
import { applyManualFrameAdjustments } from './manualFrameAdjustments.js'
import { stabilizeAnimationGroups } from './motionStabilizer.js'
import { normalizeCells } from './normalizer.js'
import { computeGridBoundaries, correctGridByProjection, sliceRgbaCells } from './sheetSlicer.js'
import { cleanupCellComponents } from './sourcePreparation.js'
import { evaluateFixedRegionSourceQuality } from './sourceQualityGate.js'
import { evaluateSourceRegionEdgePressure, sliceCellsForSourceLayout } from './sourceLayouts.js'

export function resolveLockedAnimations(options = {}) {
  return Array.isArray(options.lockedAnimations ?? options.locked_animations)
    ? (options.lockedAnimations ?? options.locked_animations).map(String)
    : []
}

export function buildFramePipeline({ transparent, profile, sourceLayout, options = {} } = {}) {
  const sourceQualityReport = evaluateFixedRegionSourceQuality(transparent, sourceLayout)
  const sourceRegionEdgePressure = evaluateSourceRegionEdgePressure(transparent, sourceLayout)
  const fixedSource = sliceCellsForSourceLayout(transparent, profile, sourceLayout)
  const baseGrid = fixedSource
    ? fixedSource.grid
    : computeGridBoundaries({ width: transparent.width, height: transparent.height, columns: profile.grid.columns, rows: profile.grid.rows, manualOverrides: options.manualOverrides })
  const grid = fixedSource || options.manualOverrides ? baseGrid : correctGridByProjection(transparent, baseGrid)
  const cells = fixedSource ? fixedSource.cells : sliceRgbaCells(transparent, grid)
  const componentCleanup = cleanupCellComponents(cells, options)
  const normalized = normalizeCells(componentCleanup.cells, profile)
  const autoCorrection = autoCorrectNormalizedFrames(normalized.frames, profile, { enabled: options.autoCorrect !== false })
  const lockedAnimations = resolveLockedAnimations(options)
  const motionStabilization = stabilizeAnimationGroups(autoCorrection.frames, profile, {
    enabled: options.motionStabilize !== false && options.motionStabilization !== false,
    maxShift: options.motionStabilizationMaxShift ?? options.motion_stabilization_max_shift,
    lockedAnimations,
  })
  const manualAdjustments = applyManualFrameAdjustments(motionStabilization.frames, profile, {
    adjustments: options.frameAdjustments ?? options.frame_adjustments,
  })

  return {
    sourceQualityReport,
    sourceRegionEdgePressure,
    fixedSource,
    baseGrid,
    grid,
    cells,
    componentCleanup,
    normalized,
    autoCorrection,
    lockedAnimations,
    motionStabilization,
    manualAdjustments,
    frames: manualAdjustments.frames,
  }
}
