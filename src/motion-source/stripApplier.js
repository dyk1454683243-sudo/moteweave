import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { cloneRgba, pixelOffset } from '../character-pack/imageMath.js'
import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from '../character-pack/profile.js'
import { validateNormalizedFrames } from '../character-pack/validator.js'
import { cellRegionForFrame, framesFromSheet } from './sheetFrames.js'

const RESAMPLE_STRATEGIES = new Set(['reject_mismatch', 'nearest_keyframes'])

function assertRgbaImage(image, name) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error(`invalid_${name}`)
  }
  if (!image.data || image.data.length !== image.width * image.height * 4) throw new Error(`invalid_${name}`)
}

function assertProfile(profile) {
  if (!profile?.frame?.w || !profile?.frame?.h || !profile?.sheet?.w || !profile?.sheet?.h || !profile?.grid?.columns || !profile?.grid?.rows) {
    throw new Error('invalid_character_profile')
  }
}

function stripFrameCount(strip, profile) {
  if (strip.height !== profile.frame.h || strip.width % profile.frame.w !== 0) {
    throw new Error('invalid_strip_cell_size')
  }
  const count = strip.width / profile.frame.w
  if (!Number.isInteger(count) || count < 1) throw new Error('invalid_strip_cell_size')
  return count
}

function validateSheetSize(sheet, profile) {
  if (sheet.width !== profile.sheet.w || sheet.height !== profile.sheet.h) {
    throw new Error('sheet_profile_size_mismatch')
  }
}

function copyStripCellToSheet({ strip, sheet, sourceFrameIndex, targetFrameIndex, profile }) {
  const target = cellRegionForFrame(targetFrameIndex, profile)
  const sourceX = sourceFrameIndex * profile.frame.w
  for (let y = 0; y < profile.frame.h; y += 1) {
    for (let x = 0; x < profile.frame.w; x += 1) {
      const src = pixelOffset(strip.width, sourceX + x, y)
      const dst = pixelOffset(sheet.width, target.x + x, target.y + y)
      sheet.data[dst] = strip.data[src]
      sheet.data[dst + 1] = strip.data[src + 1]
      sheet.data[dst + 2] = strip.data[src + 2]
      sheet.data[dst + 3] = strip.data[src + 3]
    }
  }
}

function nearestKeyframeMapping(sourceCount, targetCount) {
  if (targetCount === 1) return [0]
  return Array.from({ length: targetCount }, (_, index) => Math.round((index * (sourceCount - 1)) / (targetCount - 1)))
}

function resolveFrameMapping({ sourceCount, targetCount, resampleStrategy, frameMapping }) {
  if (Array.isArray(frameMapping)) {
    if (frameMapping.length !== targetCount) throw new Error('frame_mapping_target_count_mismatch')
    for (const item of frameMapping) {
      if (!Number.isInteger(item) || item < 0 || item >= sourceCount) throw new Error('invalid_frame_mapping')
    }
    return { strategy: 'custom', sourceIndexes: frameMapping.slice() }
  }
  if (sourceCount === targetCount) {
    return {
      strategy: 'exact',
      sourceIndexes: Array.from({ length: targetCount }, (_, index) => index),
    }
  }
  if (resampleStrategy === 'nearest_keyframes') {
    return {
      strategy: 'nearest_keyframes',
      sourceIndexes: nearestKeyframeMapping(sourceCount, targetCount),
    }
  }
  throw new Error(`target_frame_count_mismatch: strip has ${sourceCount} frames but ${targetCount} are required for the action`)
}

function buildMappingReport({ sourceIndexes, targetIndexes, strategy, profile }) {
  return sourceIndexes.map((sourceFrameIndex, outputIndex) => {
    const targetFrameIndex = targetIndexes[outputIndex]
    const target = cellRegionForFrame(targetFrameIndex, profile)
    return {
      output_index: outputIndex,
      source_frame_index: sourceFrameIndex,
      target_frame_index: targetFrameIndex,
      target_row: target.row,
      target_col: target.col,
      method: strategy === 'exact' ? 'copy' : strategy,
    }
  })
}

export async function applyMotionStrip({
  sheet,
  strip,
  action = 'walk_down',
  profile = TOPDOWN_RPG_V0,
  resampleStrategy = 'reject_mismatch',
  frameMapping,
} = {}) {
  assertProfile(profile)
  assertRgbaImage(sheet, 'sheet')
  assertRgbaImage(strip, 'strip')
  validateSheetSize(sheet, profile)
  if (!RESAMPLE_STRATEGIES.has(resampleStrategy)) throw new Error('unsupported_resample_strategy')

  const sourceCount = stripFrameCount(strip, profile)
  const targetIndexes = getAnimationFrameIndexes(action, profile)
  const mapping = resolveFrameMapping({
    sourceCount,
    targetCount: targetIndexes.length,
    resampleStrategy,
    frameMapping,
  })
  const appliedSheet = cloneRgba(sheet)
  for (const [outputIndex, sourceFrameIndex] of mapping.sourceIndexes.entries()) {
    copyStripCellToSheet({
      strip,
      sheet: appliedSheet,
      sourceFrameIndex,
      targetFrameIndex: targetIndexes[outputIndex],
      profile,
    })
  }
  const frames = framesFromSheet(appliedSheet, profile)
  const validation = validateNormalizedFrames(frames, profile)
  const resampleMapping = buildMappingReport({
    sourceIndexes: mapping.sourceIndexes,
    targetIndexes,
    strategy: mapping.strategy,
    profile,
  })
  const report = {
    schema_version: 1,
    mode: 'apply_motion_strip_report_v1',
    status: validation.blocking_errors.length ? 'warning' : 'done',
    action,
    profile_id: profile.id,
    source_strip_frame_count: sourceCount,
    target_frame_count: targetIndexes.length,
    target_frame_indexes: targetIndexes,
    resample_strategy: mapping.strategy,
    resample_mapping: mapping.strategy === 'exact' ? null : resampleMapping,
    copy_mapping: resampleMapping,
    validation: {
      status: validation.status,
      blocking_errors: validation.blocking_errors,
      warnings: validation.warnings,
    },
  }

  return {
    appliedSheet,
    appliedNormalizedSheetPng: await encodeRgbaPng(appliedSheet),
    report,
    frames,
  }
}
