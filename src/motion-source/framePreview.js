import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { pixelOffset } from '../character-pack/imageMath.js'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function pasteNearest(src, dst, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(src.width * scale))
  const outH = Math.max(1, Math.round(src.height * scale))
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const sx = clamp(Math.floor(x / scale), 0, src.width - 1)
      const sy = clamp(Math.floor(y / scale), 0, src.height - 1)
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const source = pixelOffset(src.width, sx, sy)
      const target = pixelOffset(dst.width, tx, ty)
      dst.data[target] = src.data[source]
      dst.data[target + 1] = src.data[source + 1]
      dst.data[target + 2] = src.data[source + 2]
      dst.data[target + 3] = src.data[source + 3]
    }
  }
}

function pasteImage(src, dst, dstX, dstY) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const source = pixelOffset(src.width, x, y)
      const target = pixelOffset(dst.width, tx, ty)
      dst.data[target] = src.data[source]
      dst.data[target + 1] = src.data[source + 1]
      dst.data[target + 2] = src.data[source + 2]
      dst.data[target + 3] = src.data[source + 3]
    }
  }
}

function thumbnailForFrame(frame, cellW, cellH) {
  const image = blankImage(cellW, cellH)
  const scale = Math.min(cellW / frame.width, cellH / frame.height)
  const outW = Math.max(1, Math.round(frame.width * scale))
  const outH = Math.max(1, Math.round(frame.height * scale))
  pasteNearest(frame, image, Math.floor((cellW - outW) / 2), Math.floor((cellH - outH) / 2), scale)
  return image
}

function frameFileName(index) {
  return `frame_previews/frame_${String(index + 1).padStart(5, '0')}.png`
}

function optionalMilliseconds(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function previewFrameProvenance(frameProvenance, index) {
  const provenance = frameProvenance?.[index]
  if (!provenance) {
    return {
      candidate_index: index,
      raw_index: index,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: null,
    }
  }
  if (Number(provenance.candidate_index) !== index) {
    throw new Error('motion_frame_preview_provenance_candidate_index_mismatch')
  }
  const rawIndex = Number(provenance.raw_index)
  if (!Number.isSafeInteger(rawIndex) || rawIndex < 0) {
    throw new Error('motion_frame_preview_provenance_raw_index_invalid')
  }
  return {
    candidate_index: index,
    raw_index: rawIndex,
    timestamp_ms: optionalMilliseconds(provenance.timestamp_ms),
    duration_ms: optionalMilliseconds(provenance.duration_ms),
    timing_source: typeof provenance.timing_source === 'string' && provenance.timing_source
      ? provenance.timing_source
      : null,
    source_entry: typeof provenance.source_entry === 'string' && provenance.source_entry
      ? provenance.source_entry
      : null,
  }
}

export async function buildMotionFramePreviewArtifacts(frames, {
  sourceKind = 'unknown',
  sourceName = '',
  cellSize = 96,
  columns = 8,
  sampling = {},
  ffmpeg = null,
  frameProvenance = null,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('motion_frame_preview_requires_frames')
  if (
    frameProvenance !== null &&
    (!Array.isArray(frameProvenance) || frameProvenance.length !== frames.length)
  ) {
    throw new Error('motion_frame_preview_provenance_length_mismatch')
  }
  const cellW = Math.max(24, Math.round(Number(cellSize) || 96))
  const cellH = cellW
  const gridColumns = Math.max(1, Math.min(frames.length, Math.round(Number(columns) || 8)))
  const gridRows = Math.ceil(frames.length / gridColumns)
  const thumbnails = frames.map((frame) => thumbnailForFrame(frame, cellW, cellH))
  const sheet = blankImage(cellW * gridColumns, cellH * gridRows)
  for (const [index, thumbnail] of thumbnails.entries()) {
    const col = index % gridColumns
    const row = Math.floor(index / gridColumns)
    pasteImage(thumbnail, sheet, col * cellW, row * cellH)
  }

  const files = {
    'frame_preview_sheet.png': await encodeRgbaPng(sheet),
  }
  const frameEntries = []
  for (const [index, thumbnail] of thumbnails.entries()) {
    const previewFile = frameFileName(index)
    const provenance = previewFrameProvenance(frameProvenance, index)
    files[previewFile] = await encodeRgbaPng(thumbnail)
    frameEntries.push({
      source_index: index,
      output_index: index,
      ...provenance,
      preview_file: previewFile,
      source_size: { w: frames[index].width, h: frames[index].height },
      selected: true,
    })
  }

  const index = {
    schema_version: 2,
    mode: 'motion_frame_preview_index_v2',
    default_selection_mode: 'auto',
    source_kind: sourceKind,
    source_name: sourceName,
    frame_count: frames.length,
    cell_size: { w: cellW, h: cellH },
    grid: { columns: gridColumns, rows: gridRows },
    sampling,
    ffmpeg,
    sheet_file: 'frame_preview_sheet.png',
    frames: frameEntries,
  }
  files['frame_preview_index.json'] = index
  return { files, index }
}
