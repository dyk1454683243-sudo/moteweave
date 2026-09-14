import { applyTwoPointFiveDMapEditorWorkflow } from '../../two-point-five-d/mapEditorWorkflow.js'
import { buildTwoPointFiveDAtlasPlan } from '../../two-point-five-d/terrainAutotileBuilder.js'
import {
  buildTwoPointFiveDGuardedRuleMap,
  solveTwoPointFiveDConstraintMap,
} from '../../two-point-five-d/terrainRuleMapBuilder.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../two-point-five-d/tilesetContract.js'

export const DEFAULT_TWO_POINT_FIVE_D_OPTIONS = Object.freeze({
  mapSolver: 'constraint',
  mapBorder: 'empty',
  mapWidth: 8,
  mapHeight: 6,
  mapSeed: 170617,
  mapDensity: 0.55,
  editorOperations: Object.freeze([]),
})

const SOLVERS = new Set(['constraint', 'seeded'])
const BORDERS = new Set(['empty', 'none'])
const OPERATION_TYPES = new Set([
  'paint_terrain_rect',
  'erase_terrain_rect',
  'set_corner',
])

const DEFAULT_TWO_POINT_FIVE_D_PREVIEW_PLAN = buildTwoPointFiveDAtlasPlan(
  DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function integer(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return clamp(Math.trunc(number), min, max)
}

function finite(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return clamp(number, min, max)
}

function normalizeOperation(value, { width, height }) {
  if (!value || typeof value !== 'object' || !OPERATION_TYPES.has(value.type)) return null
  if (value.type === 'set_corner') {
    return Object.freeze({
      type: 'set_corner',
      x: integer(value.x, 0, 0, width),
      y: integer(value.y, 0, 0, height),
      solid: Boolean(value.solid),
    })
  }
  const x = integer(value.x, 0, 0, Math.max(0, width - 1))
  const y = integer(value.y, 0, 0, Math.max(0, height - 1))
  const w = integer(value.w, 1, 1, Math.max(1, width - x))
  const h = integer(value.h, 1, 1, Math.max(1, height - y))
  return Object.freeze({ type: value.type, x, y, w, h })
}

export function normalizeTwoPointFiveDOptions(values = {}) {
  const mapWidth = integer(values.mapWidth ?? values.map_width, DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapWidth, 1, 64)
  const mapHeight = integer(values.mapHeight ?? values.map_height, DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapHeight, 1, 64)
  const mapSolverValue = String(values.mapSolver ?? values.map_solver ?? DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapSolver)
  const mapBorderValue = String(values.mapBorder ?? values.map_border ?? DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapBorder)
  const editorOperations = Array.from(values.editorOperations ?? values.editor_operations ?? [])
    .map((operation) => normalizeOperation(operation, { width: mapWidth, height: mapHeight }))
    .filter(Boolean)
  return Object.freeze({
    mapSolver: SOLVERS.has(mapSolverValue) ? mapSolverValue : DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapSolver,
    mapBorder: BORDERS.has(mapBorderValue) ? mapBorderValue : DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapBorder,
    mapWidth,
    mapHeight,
    mapSeed: integer(values.mapSeed ?? values.map_seed, DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapSeed, -2147483648, 2147483647),
    mapDensity: finite(values.mapDensity ?? values.map_density, DEFAULT_TWO_POINT_FIVE_D_OPTIONS.mapDensity, 0, 1),
    editorOperations: Object.freeze(editorOperations),
  })
}

export function twoPointFiveDOptionsKey(values = {}) {
  return JSON.stringify(normalizeTwoPointFiveDOptions(values))
}

export function createTwoPointFiveDBinding({ sourceEpoch, optionsKey, jobId = null } = {}) {
  if (!Number.isSafeInteger(sourceEpoch) || sourceEpoch < 0 || typeof optionsKey !== 'string' || !optionsKey) {
    throw new TypeError('A non-negative sourceEpoch and optionsKey are required')
  }
  if (jobId !== null && (typeof jobId !== 'string' || !jobId)) {
    throw new TypeError('jobId must be a non-empty string or null')
  }
  return Object.freeze({ sourceEpoch, optionsKey, jobId })
}

export function twoPointFiveDBindingIsCurrent(binding, { sourceEpoch, optionsKey } = {}) {
  return Boolean(
    binding &&
    Number.isSafeInteger(binding.sourceEpoch) &&
    binding.sourceEpoch === sourceEpoch &&
    typeof binding.optionsKey === 'string' &&
    binding.optionsKey === optionsKey
  )
}

export function seededTwoPointFiveDUnit(x, y, seed) {
  let value = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed, 1442695041)) >>> 0
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

function cornerGridFromRuleMap(map) {
  const grid = Array.from(
    { length: map.height + 1 },
    () => Array.from({ length: map.width + 1 }, () => null),
  )
  for (const cell of map.cells) {
    for (const [x, y, solid] of [
      [cell.x, cell.y, Boolean(cell.mask & 1)],
      [cell.x + 1, cell.y, Boolean(cell.mask & 2)],
      [cell.x + 1, cell.y + 1, Boolean(cell.mask & 4)],
      [cell.x, cell.y + 1, Boolean(cell.mask & 8)],
    ]) {
      if (grid[y][x] !== null && grid[y][x] !== solid) {
        throw new Error(`Maintained tiles map has conflicting corner ${x},${y}`)
      }
      grid[y][x] = solid
    }
  }
  return grid.map((row) => row.map(Boolean))
}

export function buildTwoPointFiveDCornerGrid(values = {}) {
  const options = normalizeTwoPointFiveDOptions(values)
  const baseMap = options.mapSolver === 'seeded'
    ? buildTwoPointFiveDGuardedRuleMap({
        plan: DEFAULT_TWO_POINT_FIVE_D_PREVIEW_PLAN,
        width: options.mapWidth,
        height: options.mapHeight,
        seed: options.mapSeed,
        density: options.mapDensity,
      })
    : solveTwoPointFiveDConstraintMap({
        plan: DEFAULT_TWO_POINT_FIVE_D_PREVIEW_PLAN,
        width: options.mapWidth,
        height: options.mapHeight,
        seed: options.mapSeed,
        density: options.mapDensity,
        constraints: { border: options.mapBorder },
      })
  if (options.mapSolver === 'constraint' && baseMap.status !== 'pass') {
    throw new Error(`2.5D constraint solver failed: ${baseMap.report.contradictions.map((item) => item.reason).join(', ')}`)
  }
  const map = options.mapSolver === 'constraint' ? baseMap.map : baseMap
  const edited = applyTwoPointFiveDMapEditorWorkflow({
    plan: DEFAULT_TWO_POINT_FIVE_D_PREVIEW_PLAN,
    map,
    operations: options.editorOperations,
    sessionId: 'studio_tiles_preview',
  }).map
  const grid = cornerGridFromRuleMap(edited)
  return Object.freeze({
    options,
    width: edited.width,
    height: edited.height,
    grid: Object.freeze(grid.map((row) => Object.freeze(row))),
  })
}

export function twoPointFiveDMaskFromGrid(grid, x, y) {
  return (grid[y][x] ? 1 : 0)
    | (grid[y][x + 1] ? 2 : 0)
    | (grid[y + 1][x + 1] ? 4 : 0)
    | (grid[y + 1][x] ? 8 : 0)
}

export function appendTwoPointFiveDOperation(values = {}, operation = {}) {
  const options = normalizeTwoPointFiveDOptions(values)
  const normalized = normalizeOperation(operation, {
    width: options.mapWidth,
    height: options.mapHeight,
  })
  if (!normalized) throw new TypeError(`Unsupported tiles editor operation: ${String(operation?.type ?? '')}`)
  return normalizeTwoPointFiveDOptions({
    ...options,
    editorOperations: [...options.editorOperations, normalized],
  })
}

export function clearTwoPointFiveDEditorOperations(values = {}) {
  return normalizeTwoPointFiveDOptions({ ...normalizeTwoPointFiveDOptions(values), editorOperations: [] })
}
