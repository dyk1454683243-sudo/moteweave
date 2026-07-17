export const TOPDOWN_TILE_DUAL_GRID_V0 = Object.freeze({
  id: 'topdown_tile_dual_grid_v0',
  version: '0.1',
  tile: { w: 32, h: 32 },
  grid: { columns: 4, rows: 4 },
  source: {
    sheet: { w: 192, h: 192 },
    cell: { w: 48, h: 48, padding: 8 },
  },
  thresholds: {
    minSourcePaddingPx: 4,
  },
})

const CORNER_BITS = Object.freeze({
  nw: 1,
  ne: 2,
  se: 4,
  sw: 8,
})

const SIDE_TO_EDGES = Object.freeze({
  north: ['nw', 'ne'],
  east: ['ne', 'se'],
  south: ['sw', 'se'],
  west: ['nw', 'sw'],
})

const OPPOSITE_SIDE = Object.freeze({
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
})

function assertMask(mask, profile) {
  const index = Number(mask)
  const count = profile.grid.columns * profile.grid.rows
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`tile mask must be an integer from 0 to ${count - 1}`)
  return index
}

export function getTileCorners(mask) {
  const index = Number(mask)
  return {
    nw: Boolean(index & CORNER_BITS.nw),
    ne: Boolean(index & CORNER_BITS.ne),
    se: Boolean(index & CORNER_BITS.se),
    sw: Boolean(index & CORNER_BITS.sw),
  }
}

export function getTileEdges(mask) {
  const corners = getTileCorners(mask)
  return Object.fromEntries(
    Object.entries(SIDE_TO_EDGES).map(([side, keys]) => [side, keys.map((key) => corners[key])])
  )
}

export function getTileSourceRegion(mask, profile = TOPDOWN_TILE_DUAL_GRID_V0) {
  const index = assertMask(mask, profile)
  const col = index % profile.grid.columns
  const row = Math.floor(index / profile.grid.columns)
  const padding = profile.source.cell.padding
  return {
    index,
    row,
    col,
    x: col * profile.source.cell.w + padding,
    y: row * profile.source.cell.h + padding,
    w: profile.tile.w,
    h: profile.tile.h,
    padding: { top: padding, right: padding, bottom: padding, left: padding },
  }
}

export function buildTileAtlasMetadata(profile = TOPDOWN_TILE_DUAL_GRID_V0) {
  const count = profile.grid.columns * profile.grid.rows
  return {
    version: profile.version,
    profile: profile.id,
    tile_size: { ...profile.tile },
    grid: { ...profile.grid },
    source: {
      sheet: { ...profile.source.sheet },
      cell: { ...profile.source.cell },
    },
    tiles: Array.from({ length: count }, (_, index) => {
      const region = getTileSourceRegion(index, profile)
      return {
        id: `mask_${index}`,
        index,
        row: region.row,
        col: region.col,
        mask: index,
        corners: getTileCorners(index),
        edges: getTileEdges(index),
        source: { x: region.x, y: region.y, w: region.w, h: region.h },
      }
    }),
  }
}

export function areTileEdgesCompatible(mask, neighborMask, side) {
  const opposite = OPPOSITE_SIDE[side]
  if (!opposite) throw new Error(`Unknown tile side: ${side}`)
  const sourceEdge = getTileEdges(mask)[side]
  const neighborEdge = getTileEdges(neighborMask)[opposite]
  return sourceEdge.length === neighborEdge.length && sourceEdge.every((value, index) => value === neighborEdge[index])
}

export function validateTileProfile(profile = TOPDOWN_TILE_DUAL_GRID_V0) {
  const blocking_errors = []
  const warnings = []
  const expectedSheet = {
    w: profile.grid.columns * profile.source.cell.w,
    h: profile.grid.rows * profile.source.cell.h,
  }
  const maxTile = {
    w: profile.source.cell.w - profile.source.cell.padding * 2,
    h: profile.source.cell.h - profile.source.cell.padding * 2,
  }
  const minSourcePaddingPx = profile.source.cell.padding

  if (minSourcePaddingPx < profile.thresholds.minSourcePaddingPx) blocking_errors.push('source_padding_below_min')
  if (profile.tile.w > maxTile.w || profile.tile.h > maxTile.h) blocking_errors.push('tile_exceeds_padded_source_cell')
  if (profile.source.sheet.w !== expectedSheet.w || profile.source.sheet.h !== expectedSheet.h) blocking_errors.push('source_sheet_size_mismatch')

  return {
    status: blocking_errors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors,
    warnings,
    metrics: {
      tile_count: profile.grid.columns * profile.grid.rows,
      min_source_padding_px: minSourcePaddingPx,
      expected_source_sheet: expectedSheet,
      max_tile_inside_padding: maxTile,
    },
  }
}
