const DEFAULT_CELL_SIZE = { w: 96, h: 96 }
const DEFAULT_DURATION_MS = 100

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`invalid_${name}`)
  return number
}

function normalizeCellSize(cellSize = DEFAULT_CELL_SIZE) {
  const width = Array.isArray(cellSize) ? cellSize[0] : cellSize.w ?? cellSize.width
  const height = Array.isArray(cellSize) ? cellSize[1] : cellSize.h ?? cellSize.height
  return {
    w: positiveInteger(width, 'editor_cell_width'),
    h: positiveInteger(height, 'editor_cell_height'),
  }
}

function normalizeSheetSize({ sheetSize, cellSize, frameCount }) {
  if (!sheetSize) {
    const count = positiveInteger(frameCount, 'editor_frame_count')
    return {
      sheet: { w: cellSize.w * count, h: cellSize.h },
      frameCount: count,
    }
  }

  const sheet = {
    w: positiveInteger(sheetSize.w ?? sheetSize.width, 'editor_sheet_width'),
    h: positiveInteger(sheetSize.h ?? sheetSize.height, 'editor_sheet_height'),
  }
  if (sheet.h !== cellSize.h) throw new Error('editor_sheet_height_mismatch')
  if (sheet.w % cellSize.w !== 0) throw new Error('editor_sheet_width_not_divisible_by_cell_width')
  const derivedFrameCount = sheet.w / cellSize.w
  const count = frameCount === undefined
    ? derivedFrameCount
    : positiveInteger(frameCount, 'editor_frame_count')
  if (count !== derivedFrameCount) throw new Error('editor_sheet_size_mismatch')
  return { sheet, frameCount: count }
}

function normalizeActionName(action) {
  return String(action ?? 'animation')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'animation'
}

function frameFilename(action, index, frameNames) {
  return frameNames?.[index] ?? `${action}_${String(index).padStart(3, '0')}.png`
}

export function buildEditorFramesJson({
  image = 'normalized_motion_strip.png',
  action = 'walk_down',
  frameCount,
  cellSize = DEFAULT_CELL_SIZE,
  sheetSize,
  durationMs = DEFAULT_DURATION_MS,
  frameNames,
} = {}) {
  const normalizedCell = normalizeCellSize(cellSize)
  const normalized = normalizeSheetSize({ sheetSize, cellSize: normalizedCell, frameCount })
  const frameDuration = positiveInteger(durationMs, 'editor_frame_duration')
  const actionName = normalizeActionName(action)
  const frames = Array.from({ length: normalized.frameCount }, (_, index) => {
    const frame = {
      x: index * normalizedCell.w,
      y: 0,
      w: normalizedCell.w,
      h: normalizedCell.h,
    }
    return {
      filename: frameFilename(actionName, index, frameNames),
      frame,
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, ...frame },
      sourceSize: { w: normalizedCell.w, h: normalizedCell.h },
      duration: frameDuration,
    }
  })

  return {
    frames,
    meta: {
      app: 'motion_source_editor_handoff',
      version: '1',
      image,
      format: 'RGBA8888',
      size: normalized.sheet,
      scale: '1',
      frameTags: [
        {
          name: actionName,
          from: 0,
          to: normalized.frameCount - 1,
          direction: 'forward',
        },
      ],
      motion_source: {
        action: actionName,
        frame_count: normalized.frameCount,
        cell_size: normalizedCell,
        strip_layout: 'horizontal',
      },
    },
  }
}
