const DEFAULT_THRESHOLDS = Object.freeze({
  maxChangedPixelRatio: 0.1,
})
const DEFAULT_CONTACT_SHEET_FILE = 'tile_conditioning_review.png'
const RGBA_CHANNELS = 4
const GUTTER = 8
const GUTTER_COLOR = [34, 42, 52, 255]

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function tileEntries(tiles) {
  if (!tiles) return []
  const entries = tiles instanceof Map ? [...tiles.entries()] : Object.entries(tiles)
  return entries
    .map(([mask, image]) => ({ mask: Number(mask), key: String(mask), image }))
    .sort((a, b) => a.mask - b.mask)
}

function imageOffset(image, x, y) {
  return (y * image.width + x) * RGBA_CHANNELS
}

function setPixel(image, x, y, rgba) {
  const offset = imageOffset(image, x, y)
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3]
}

function blitTile(output, tile, dx, dy) {
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const src = imageOffset(tile, x, y)
      const dst = imageOffset(output, dx + x, dy + y)
      output.data[dst] = tile.data[src]
      output.data[dst + 1] = tile.data[src + 1]
      output.data[dst + 2] = tile.data[src + 2]
      output.data[dst + 3] = tile.data[src + 3]
    }
  }
}

function normalizeThresholds(thresholds = {}) {
  return { ...DEFAULT_THRESHOLDS, ...thresholds }
}

export function buildTileConditioningReview({
  rawTiles,
  conditionedTiles,
  edgeConditioning,
  qualityGate,
  thresholds = {},
  contactSheetFile = DEFAULT_CONTACT_SHEET_FILE,
} = {}) {
  const effectiveThresholds = normalizeThresholds(thresholds)
  const changedPixelRatio = edgeConditioning?.changed_pixel_ratio ?? 0
  const warnings = []
  if (qualityGate?.status === 'pass' && changedPixelRatio >= effectiveThresholds.maxChangedPixelRatio) {
    warnings.push('tile.edge_conditioning_visible_mutation')
  }
  const rawCount = tileEntries(rawTiles).length
  const conditionedCount = tileEntries(conditionedTiles).length

  return {
    schema_version: 1,
    mode: 'tile_conditioning_review_v0',
    status: warnings.length ? 'warning' : 'pass',
    warnings,
    thresholds: {
      max_changed_pixel_ratio: effectiveThresholds.maxChangedPixelRatio,
    },
    metrics: {
      structural_status: qualityGate?.status ?? 'not_run',
      edge_conditioning_mode: edgeConditioning?.mode ?? null,
      changed_pixel_count: edgeConditioning?.changed_pixel_count ?? 0,
      changed_pixel_ratio: round(changedPixelRatio),
      raw_tile_count: rawCount,
      conditioned_tile_count: conditionedCount,
    },
    artifacts: {
      contact_sheet: contactSheetFile,
    },
  }
}

export function renderTileConditioningContactSheet({
  rawTiles,
  conditionedTiles,
  columns = 4,
} = {}) {
  const rawEntries = tileEntries(rawTiles)
  const conditionedEntries = tileEntries(conditionedTiles)
  const first = rawEntries[0]?.image ?? conditionedEntries[0]?.image
  if (!first) throw new Error('Cannot render tile conditioning contact sheet without tiles')
  const rows = Math.ceil(Math.max(rawEntries.length, conditionedEntries.length) / columns)
  const panelWidth = columns * first.width
  const output = {
    width: panelWidth * 2 + GUTTER,
    height: rows * first.height,
    data: new Uint8ClampedArray((panelWidth * 2 + GUTTER) * rows * first.height * RGBA_CHANNELS),
  }
  for (let y = 0; y < output.height; y += 1) {
    for (let x = panelWidth; x < panelWidth + GUTTER; x += 1) setPixel(output, x, y, GUTTER_COLOR)
  }
  for (const [index, { image }] of rawEntries.entries()) {
    const x = (index % columns) * first.width
    const y = Math.floor(index / columns) * first.height
    blitTile(output, image, x, y)
  }
  for (const [index, { image }] of conditionedEntries.entries()) {
    const x = panelWidth + GUTTER + (index % columns) * first.width
    const y = Math.floor(index / columns) * first.height
    blitTile(output, image, x, y)
  }
  return output
}
