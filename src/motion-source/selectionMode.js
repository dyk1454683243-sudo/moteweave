export const MOTION_SELECTION_MODE_AUTO = 'auto'
export const MOTION_SELECTION_MODE_MANUAL = 'manual'
export const MOTION_SELECTION_INDEX_LIMIT = 64

const MOTION_SELECTION_MODES = new Set([
  MOTION_SELECTION_MODE_AUTO,
  MOTION_SELECTION_MODE_MANUAL,
])

export class MotionSelectionModeError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = 'MotionSelectionModeError'
    this.code = code
    this.status = 400
    Object.assign(this, details)
  }
}

function selectionError(code, details) {
  return new MotionSelectionModeError(code, details)
}

function normalizeIndexes(value, frameCount) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw selectionError('invalid_selected_frame_indexes')
  if (!value.length) return null
  if (value.length > MOTION_SELECTION_INDEX_LIMIT) {
    throw selectionError('too_many_selected_frame_indexes', {
      selected_frame_index_count: value.length,
      selected_frame_index_limit: MOTION_SELECTION_INDEX_LIMIT,
    })
  }

  const seen = new Set()
  const indexes = []
  for (const [position, valueAtPosition] of value.entries()) {
    if (!Number.isInteger(valueAtPosition)) {
      throw selectionError('invalid_selected_frame_index', {
        index_position: position,
        index_value: valueAtPosition,
      })
    }
    if (valueAtPosition < 0 || (frameCount !== null && valueAtPosition >= frameCount)) {
      throw selectionError('selected_frame_index_out_of_range', {
        frame_count: frameCount,
        index_position: position,
        index_value: valueAtPosition,
      })
    }
    if (seen.has(valueAtPosition)) {
      throw selectionError('duplicate_selected_frame_index', {
        index_position: position,
        index_value: valueAtPosition,
      })
    }
    seen.add(valueAtPosition)
    indexes.push(valueAtPosition)
  }
  return indexes
}

export function normalizeMotionSelectionRequest({
  selectionMode,
  selectedFrameIndexes,
  frameCount = null,
} = {}) {
  if (frameCount !== null && (!Number.isInteger(frameCount) || frameCount < 0)) {
    throw selectionError('invalid_motion_frame_count', { frame_count: frameCount })
  }

  const explicitMode = selectionMode !== undefined
  if (explicitMode && !MOTION_SELECTION_MODES.has(selectionMode)) {
    throw selectionError('invalid_motion_selection_mode', {
      selection_mode: selectionMode,
    })
  }

  const normalizedIndexes = normalizeIndexes(selectedFrameIndexes, frameCount)
  const effectiveSelectionMode = explicitMode
    ? selectionMode
    : normalizedIndexes
      ? MOTION_SELECTION_MODE_MANUAL
      : MOTION_SELECTION_MODE_AUTO

  if (effectiveSelectionMode === MOTION_SELECTION_MODE_AUTO && normalizedIndexes) {
    throw selectionError('auto_selection_conflicts_with_frame_indexes')
  }
  if (effectiveSelectionMode === MOTION_SELECTION_MODE_MANUAL && !normalizedIndexes) {
    throw selectionError('manual_selection_requires_frame_indexes')
  }

  return {
    requestedSelectionMode: explicitMode ? selectionMode : null,
    effectiveSelectionMode,
    selectedFrameIndexes: normalizedIndexes,
    inferredFromLegacy: !explicitMode,
  }
}
