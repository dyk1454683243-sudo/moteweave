import {
  buildTwoPointFiveDMapFromMasks,
  validateTwoPointFiveDRuleMap,
} from './terrainRuleMapBuilder.js'

export const TWO_POINT_FIVE_D_MAP_EDITOR_WORKFLOW_MODE = 'two_point_five_d_map_editor_workflow_v1'

function assertInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`)
  return number
}

function assertRect(operation, map) {
  const x = assertInteger(operation.x, 'operation.x')
  const y = assertInteger(operation.y, 'operation.y')
  const w = assertInteger(operation.w, 'operation.w')
  const h = assertInteger(operation.h, 'operation.h')
  if (w < 1 || h < 1) throw new Error('operation rectangle must have positive size')
  if (x < 0 || y < 0 || x + w > map.width || y + h > map.height) {
    throw new Error('operation rectangle is outside the map')
  }
  return { x, y, w, h }
}

function boolValue(value, fallback = true) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['solid', 'true', '1', 'on', 'terrain'].includes(normalized)) return true
  if (['empty', 'false', '0', 'off', 'erase'].includes(normalized)) return false
  throw new Error(`unsupported boolean value: ${value}`)
}

function cornerGridFromRuleMap(map) {
  const grid = Array.from({ length: map.height + 1 }, () => Array.from({ length: map.width + 1 }, () => null))
  for (const cell of map.cells) {
    const bits = {
      nw: Boolean(cell.mask & 1),
      ne: Boolean(cell.mask & 2),
      se: Boolean(cell.mask & 4),
      sw: Boolean(cell.mask & 8),
    }
    for (const [x, y, value] of [
      [cell.x, cell.y, bits.nw],
      [cell.x + 1, cell.y, bits.ne],
      [cell.x + 1, cell.y + 1, bits.se],
      [cell.x, cell.y + 1, bits.sw],
    ]) {
      if (grid[y][x] !== null && grid[y][x] !== value) {
        throw new Error(`map cannot be converted to editor corner grid at ${x},${y}`)
      }
      grid[y][x] = value
    }
  }
  return grid.map((row) => row.map(Boolean))
}

function masksFromCornerGrid(cornerGrid, width, height) {
  const masks = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      masks.push((cornerGrid[y][x] ? 1 : 0)
        | (cornerGrid[y][x + 1] ? 2 : 0)
        | (cornerGrid[y + 1][x + 1] ? 4 : 0)
        | (cornerGrid[y + 1][x] ? 8 : 0))
    }
  }
  return masks
}

function summarizeChangedCells(beforeMap, afterMap) {
  const changed = []
  for (let index = 0; index < beforeMap.cells.length; index += 1) {
    const before = beforeMap.cells[index]
    const after = afterMap.cells[index]
    if (before.mask === after.mask) continue
    changed.push({
      index,
      x: before.x,
      y: before.y,
      before_mask: before.mask,
      after_mask: after.mask,
    })
  }
  return changed
}

function applyOperation(cornerGrid, map, operation) {
  const type = String(operation.type ?? '').trim()
  if (type === 'paint_terrain_rect' || type === 'erase_terrain_rect') {
    const rect = assertRect(operation, map)
    const solid = type === 'erase_terrain_rect' ? false : boolValue(operation.solid, true)
    for (let y = rect.y; y <= rect.y + rect.h; y += 1) {
      for (let x = rect.x; x <= rect.x + rect.w; x += 1) cornerGrid[y][x] = solid
    }
    return {
      type,
      rect,
      solid,
      affected_corner_count: (rect.w + 1) * (rect.h + 1),
    }
  }
  if (type === 'set_corner') {
    const x = assertInteger(operation.x, 'operation.x')
    const y = assertInteger(operation.y, 'operation.y')
    if (x < 0 || y < 0 || x > map.width || y > map.height) throw new Error('corner operation is outside the map')
    const solid = boolValue(operation.solid, true)
    cornerGrid[y][x] = solid
    return {
      type,
      x,
      y,
      solid,
      affected_corner_count: 1,
    }
  }
  throw new Error(`unsupported map editor operation: ${type || 'missing'}`)
}

export function buildTwoPointFiveDMapEditorBrushPalette(plan) {
  return {
    terrain_brushes: [
      { id: 'paint_terrain_rect', label: 'Paint terrain rectangle', operation: 'paint_terrain_rect' },
      { id: 'erase_terrain_rect', label: 'Erase terrain rectangle', operation: 'erase_terrain_rect' },
      { id: 'set_corner', label: 'Set corner control point', operation: 'set_corner' },
    ],
    mask_palette: plan.tiles.map((tile) => ({
      mask: tile.mask,
      tile_id: tile.id,
      atlas_tile_id: tile.atlas_tile_id,
      tile_role: tile.tile_role,
      tile_class: tile.transition.tile_class,
      active_corners: tile.transition.active_corners,
    })),
  }
}

export function applyTwoPointFiveDMapEditorWorkflow({
  plan,
  map,
  operations = [],
  sessionId = 'map_editor_session',
} = {}) {
  if (!plan?.tiles?.length) throw new Error('plan with tiles is required')
  if (!map?.cells?.length) throw new Error('map is required')
  const baseValidation = validateTwoPointFiveDRuleMap(map, { plan })
  if (baseValidation.status === 'fail') {
    throw new Error(`Cannot edit invalid map: ${baseValidation.blocking_errors.join(', ')}`)
  }
  const cornerGrid = cornerGridFromRuleMap(map)
  const appliedOperations = operations.map((operation, index) => ({
    index,
    ...applyOperation(cornerGrid, map, operation),
  }))
  const masks = masksFromCornerGrid(cornerGrid, map.width, map.height)
  const arrangement = appliedOperations.length
    ? {
        mode: 'map_editor_corner_workflow_v1',
        source_arrangement: map.arrangement,
        operation_count: appliedOperations.length,
        wfc_scope: 'map_editor_corner_edits_validated_not_interactive_ui',
      }
    : { ...map.arrangement }
  const editedMap = buildTwoPointFiveDMapFromMasks({
    plan,
    width: map.width,
    height: map.height,
    masks,
    arrangement,
  })
  const validation = validateTwoPointFiveDRuleMap(editedMap, { plan })
  const changedCells = summarizeChangedCells(map, editedMap)
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_MAP_EDITOR_WORKFLOW_MODE,
    session_id: sessionId,
    status: validation.status,
    base_map: {
      mode: map.mode,
      arrangement: map.arrangement,
      width: map.width,
      height: map.height,
      validation_status: baseValidation.status,
    },
    operations: appliedOperations,
    brush_palette: buildTwoPointFiveDMapEditorBrushPalette(plan),
    changed_cell_count: changedCells.length,
    changed_cells: changedCells.slice(0, 128),
    validation,
    map: editedMap,
    claim_boundary: 'Headless map-editor workflow for rule-safe operations; browser UI and freehand editing are separate follow-up work.',
  }
}
