import { buildLdtkProjectJson } from './ldtkProjectExport.js'
import { buildLdtkSceneJson, buildRuleBasedTileMap, buildTileMap, validateTileMap } from './tileArrangement.js'

function clampInteger(value, { min, max, fallback }) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function buildCornerGrid(width, height, pattern) {
  return Array.from({ length: height + 1 }, (_, y) => (
    Array.from({ length: width + 1 }, (_, x) => {
      if (pattern === 'solid') return true
      if (pattern === 'path') {
        const center = (x / Math.max(1, width)) * height
        return Math.abs(y - center) <= 0.85
      }
      const marginX = Math.min(x, width - x)
      const marginY = Math.min(y, height - y)
      return marginX > 0 && marginY > 0
    })
  ))
}

function maskFromCorners(cornerGrid, x, y) {
  return (cornerGrid[y][x] ? 1 : 0)
    | (cornerGrid[y][x + 1] ? 2 : 0)
    | (cornerGrid[y + 1][x + 1] ? 4 : 0)
    | (cornerGrid[y + 1][x] ? 8 : 0)
}

export function buildScenePreviewMaskGrid({
  width = 6,
  height = 4,
  pattern = 'island',
  seed = 1,
  density = 0.5,
} = {}) {
  const mapWidth = clampInteger(width, { min: 1, max: 16, fallback: 6 })
  const mapHeight = clampInteger(height, { min: 1, max: 16, fallback: 4 })
  const safePattern = ['solid', 'path', 'island', 'rule'].includes(pattern) ? pattern : 'island'
  if (safePattern === 'rule') {
    const map = buildRuleBasedTileMap({ width: mapWidth, height: mapHeight, seed, density })
    return {
      width: mapWidth,
      height: mapHeight,
      pattern: safePattern,
      corner_grid_size: map.arrangement.corner_grid_size,
      masks: map.cells.map((cell) => cell.mask),
      arrangement: map.arrangement,
      map,
    }
  }
  const cornerGrid = buildCornerGrid(mapWidth, mapHeight, safePattern)
  const masks = []
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      masks.push(maskFromCorners(cornerGrid, x, y))
    }
  }

  return {
    width: mapWidth,
    height: mapHeight,
    pattern: safePattern,
    corner_grid_size: { w: mapWidth + 1, h: mapHeight + 1 },
    masks,
  }
}

export function buildScenePreviewBundle({
  projectId = 'scene_preview_project',
  identifier = 'scene_preview',
  width = 6,
  height = 4,
  pattern = 'island',
  seed = 1,
  density = 0.5,
  tilesetRelPath = 'tileset.png',
} = {}) {
  const maskGrid = buildScenePreviewMaskGrid({ width, height, pattern, seed, density })
  const map = maskGrid.map ?? buildTileMap(maskGrid)
  const validation = validateTileMap(map)
  if (validation.status !== 'pass') throw new Error(`Scene preview generated invalid tile map: ${validation.blocking_errors.join(', ')}`)
  const uniqueMasks = new Set(maskGrid.masks)

  return {
    status: 'pass',
    maskGrid,
    map,
    sceneJson: buildLdtkSceneJson({ map, identifier }),
    ldtkProjectJson: buildLdtkProjectJson({
      projectId,
      identifier,
      map,
      tilesetRelPath,
      entityDefs: [
        {
          identifier: 'SpawnPoint',
          fields: [
            { identifier: 'Kind', type: 'String', defaultValue: 'hero' },
          ],
        },
      ],
    }),
    metrics: {
      width: maskGrid.width,
      height: maskGrid.height,
      tile_count: maskGrid.masks.length,
      unique_mask_count: uniqueMasks.size,
      ...(map.arrangement ? { arrangement_mode: map.arrangement.mode, seed: map.arrangement.seed, density: map.arrangement.density } : {}),
    },
  }
}
