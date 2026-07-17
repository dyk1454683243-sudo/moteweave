import {
  TOPDOWN_TILE_DUAL_GRID_V0,
  areTileEdgesCompatible,
  getTileSourceRegion,
} from './tileProfile.js'

function assertPositiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}

function assertMasks(width, height, masks) {
  if (!Array.isArray(masks)) throw new Error('masks are required')
  if (masks.length !== width * height) throw new Error('masks length must match width * height')
  return masks.map((mask) => Number(mask))
}

function normalizeSeed(seed) {
  if (Number.isInteger(Number(seed))) return Number(seed)
  const text = String(seed ?? '1')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) >>> 0
  return hash || 1
}

function normalizeDensity(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.max(0, Math.min(1, number))
}

function seededUnit(x, y, seed) {
  let value = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed, 1442695041)) >>> 0
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

function maskFromCornerGrid(cornerGrid, x, y) {
  return (cornerGrid[y][x] ? 1 : 0)
    | (cornerGrid[y][x + 1] ? 2 : 0)
    | (cornerGrid[y + 1][x + 1] ? 4 : 0)
    | (cornerGrid[y + 1][x] ? 8 : 0)
}

function mapCellAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null
  return map.cells[y * map.width + x]
}

export function buildTileMap({ width, height, masks, profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const mapWidth = assertPositiveInteger(width, 'width')
  const mapHeight = assertPositiveInteger(height, 'height')
  const mapMasks = assertMasks(mapWidth, mapHeight, masks)
  const cells = mapMasks.map((mask, index) => {
    getTileSourceRegion(mask, profile)
    return {
      index,
      x: index % mapWidth,
      y: Math.floor(index / mapWidth),
      mask,
      tile_id: `mask_${mask}`,
    }
  })

  return {
    profile: profile.id,
    tile_size: { ...profile.tile },
    width: mapWidth,
    height: mapHeight,
    cells,
  }
}

export function buildRuleBasedTileMap({
  width = 6,
  height = 4,
  seed = 1,
  density = 0.5,
  profile = TOPDOWN_TILE_DUAL_GRID_V0,
} = {}) {
  const mapWidth = assertPositiveInteger(width, 'width')
  const mapHeight = assertPositiveInteger(height, 'height')
  const resolvedSeed = normalizeSeed(seed)
  const resolvedDensity = normalizeDensity(density)
  const cornerGrid = Array.from({ length: mapHeight + 1 }, (_, y) => (
    Array.from({ length: mapWidth + 1 }, (_, x) => {
      if (x === 0 || y === 0 || x === mapWidth || y === mapHeight) return false
      return seededUnit(x, y, resolvedSeed) < resolvedDensity
    })
  ))
  const masks = []
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) masks.push(maskFromCornerGrid(cornerGrid, x, y))
  }
  const map = buildTileMap({ width: mapWidth, height: mapHeight, masks, profile })
  return {
    ...map,
    arrangement: {
      mode: 'rule_based_dual_grid_v0',
      seed: resolvedSeed,
      density: resolvedDensity,
      corner_grid_size: { w: mapWidth + 1, h: mapHeight + 1 },
    },
  }
}

export function validateTileMap(map, { profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const blocking = new Set()
  const edge_mismatches = []
  const expectedCount = map.width * map.height

  if (map.cells.length !== expectedCount) blocking.add('tile_count_mismatch')

  for (const cell of map.cells) {
    try {
      getTileSourceRegion(cell.mask, profile)
    } catch {
      blocking.add('tile_mask_out_of_range')
      continue
    }

    for (const [side, dx, dy] of [
      ['east', 1, 0],
      ['south', 0, 1],
    ]) {
      const neighbor = mapCellAt(map, cell.x + dx, cell.y + dy)
      if (!neighbor) continue
      if (areTileEdgesCompatible(cell.mask, neighbor.mask, side)) continue
      edge_mismatches.push({
        at: { x: cell.x, y: cell.y, index: cell.index, mask: cell.mask },
        neighbor: { x: neighbor.x, y: neighbor.y, index: neighbor.index, mask: neighbor.mask },
        side,
      })
    }
  }

  if (edge_mismatches.length) blocking.add('tile_edge_mismatch')

  return {
    status: blocking.size ? 'fail' : 'pass',
    blocking_errors: [...blocking],
    edge_mismatches,
    metrics: {
      width: map.width,
      height: map.height,
      tile_count: map.cells.length,
      checked_adjacencies: map.height * Math.max(0, map.width - 1) + map.width * Math.max(0, map.height - 1),
    },
  }
}

export function buildLdtkSceneJson({ map, identifier = 'scene_0', profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const validation = validateTileMap(map, { profile })
  if (validation.status !== 'pass') throw new Error(`Cannot export invalid tile map: ${validation.blocking_errors.join(', ')}`)

  return {
    format: 'ldtk_style_scene_pack_v0',
    identifier,
    profile: profile.id,
    world_grid_size: {
      w: map.width * profile.tile.w,
      h: map.height * profile.tile.h,
    },
    defs: {
      tilesets: [
        {
          identifier: `${profile.id}_tileset`,
          tile_grid_size: profile.tile.w,
          source: {
            sheet: { ...profile.source.sheet },
            cell: { ...profile.source.cell },
          },
        },
      ],
    },
    levels: [
      {
        identifier,
        px_size: {
          w: map.width * profile.tile.w,
          h: map.height * profile.tile.h,
        },
        layers: [
          {
            identifier: 'Tiles',
            type: 'Tiles',
            grid_size: profile.tile.w,
            grid_tiles: map.cells.map((cell) => {
              const region = getTileSourceRegion(cell.mask, profile)
              return {
                px: [cell.x * profile.tile.w, cell.y * profile.tile.h],
                src: [region.x, region.y],
                tile: cell.mask,
                flip: 0,
              }
            }),
          },
        ],
      },
    ],
  }
}
