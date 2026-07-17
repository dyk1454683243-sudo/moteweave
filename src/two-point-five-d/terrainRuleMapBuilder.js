import { buildTransitionMaskMetadata } from './terrainAutotileBuilder.js'

export const TWO_POINT_FIVE_D_MAP_RULE_PROFILE_MODE = 'two_point_five_d_map_rule_profile_v1'
export const TWO_POINT_FIVE_D_RULE_MAP_MODE = 'two_point_five_d_guarded_rule_map_v1'
export const TWO_POINT_FIVE_D_RULE_MAP_VALIDATION_MODE = 'two_point_five_d_rule_map_validation_v1'
export const TWO_POINT_FIVE_D_CONSTRAINT_SOLVER_MODE = 'two_point_five_d_constraint_map_solver_v1'

const EDGE_PAIRS = Object.freeze({
  north: ['nw', 'ne'],
  east: ['ne', 'se'],
  south: ['sw', 'se'],
  west: ['nw', 'sw'],
})

const OPPOSITE_EDGE = Object.freeze({
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
})

function assertPositiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}

function normalizeSeed(seed) {
  if (Number.isInteger(Number(seed))) return Number(seed)
  const text = String(seed ?? '170617')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
  }
  return hash || 1
}

function normalizeDensity(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.55
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

function tileByMask(plan) {
  return new Map(plan.tiles.map((tile) => [tile.mask, tile]))
}

function edgeSignature(mask, edge) {
  const transition = buildTransitionMaskMetadata(mask)
  const pair = EDGE_PAIRS[edge]
  return pair.map((corner) => Boolean(transition.corners[corner]))
}

function edgeSignatureText(mask, edge) {
  return edgeSignature(mask, edge).map((value) => value ? '1' : '0').join('')
}

function mapCellAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null
  return map.cells[y * map.width + x]
}

function indexFor(width, x, y) {
  return y * width + x
}

function cloneDomains(domains) {
  return domains.map((domain) => new Set(domain))
}

function sortedNumbers(values) {
  return [...values].map(Number).sort((a, b) => a - b)
}

function histogram(cells) {
  const counts = new Map()
  for (const cell of cells) counts.set(cell.mask, (counts.get(cell.mask) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])))
}

function makeCell({ plan, tile, index, x, y }) {
  const [logicalW, logicalH] = plan.projection.logical_tile_size
  const [spriteW, spriteH] = plan.projection.sprite_cell_size
  const anchorX = x * logicalW + logicalW / 2
  const anchorY = y * logicalH + logicalH
  return {
    index,
    x,
    y,
    mask: tile.mask,
    tile_id: tile.id,
    atlas_tile_id: tile.atlas_tile_id,
    tile_class: tile.transition.tile_class,
    tile_role: tile.tile_role,
    terrain_type: tile.terrain_type,
    transition_to_terrain_type: tile.transition_to_terrain_type,
    logical_px: {
      x: x * logicalW,
      y: y * logicalH,
      w: logicalW,
      h: logicalH,
    },
    sprite_px: {
      x: Math.round(anchorX - tile.pivot.x),
      y: Math.round(anchorY - tile.pivot.y),
      w: spriteW,
      h: spriteH,
    },
    source_rect: { ...tile.source_rect },
    runtime_inner_rect: { ...tile.runtime_inner_rect },
    collision: {
      x: x * logicalW,
      y: y * logicalH,
      w: tile.collision.w,
      h: tile.collision.h,
    },
    edges: Object.fromEntries(Object.keys(EDGE_PAIRS).map((edge) => [edge, edgeSignatureText(tile.mask, edge)])),
  }
}

function mapMetrics(cells, width, height) {
  const nonEmpty = cells.filter((cell) => cell.tile_class !== 'empty')
  return {
    width,
    height,
    tile_count: cells.length,
    non_empty_tile_count: nonEmpty.length,
    empty_tile_count: cells.length - nonEmpty.length,
    mask_histogram: histogram(cells),
  }
}

export function areTwoPointFiveDMaskEdgesCompatible(mask, neighborMask, side) {
  const opposite = OPPOSITE_EDGE[side]
  if (!opposite) throw new Error(`unsupported edge: ${side}`)
  const edge = edgeSignature(mask, side)
  const neighborEdge = edgeSignature(neighborMask, opposite)
  return edge[0] === neighborEdge[0] && edge[1] === neighborEdge[1]
}

export function buildTwoPointFiveDMapRuleProfile(plan) {
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_MAP_RULE_PROFILE_MODE,
    rule_profile_id: plan.rule_profile.id,
    algorithm_family: 'corner_mask_constraint_map',
    wfc_scope: 'guarded_constraint_profile_not_full_wfc_solver',
    masks: plan.rule_profile.masks.map((mask) => {
      const transition = buildTransitionMaskMetadata(mask, { solidMask: plan.rule_profile.solid_mask })
      return {
        mask,
        tile_id: `mask_${mask}`,
        tile_class: transition.tile_class,
        active_corners: transition.active_corners,
        edges: Object.fromEntries(Object.keys(EDGE_PAIRS).map((edge) => [edge, edgeSignatureText(mask, edge)])),
        compatible_neighbors: Object.fromEntries(Object.keys(EDGE_PAIRS).map((edge) => [
          edge,
          plan.rule_profile.masks.filter((neighborMask) => areTwoPointFiveDMaskEdgesCompatible(mask, neighborMask, edge)),
        ])),
      }
    }),
    constraints: {
      edge_matching: 'corner_signatures_must_match_across_shared_edges',
      collision: 'logical_footprint_only',
      placement: 'logical_grid_with_sprite_cell_pivot_metadata',
    },
  }
}

export function buildTwoPointFiveDMapFromMasks({
  plan,
  width,
  height,
  masks,
  arrangement = {},
} = {}) {
  if (!plan?.tiles?.length) throw new Error('plan with tiles is required')
  const mapWidth = assertPositiveInteger(width, 'width')
  const mapHeight = assertPositiveInteger(height, 'height')
  if (!Array.isArray(masks) || masks.length !== mapWidth * mapHeight) {
    throw new Error('masks length must match width * height')
  }
  const tilesByMask = tileByMask(plan)
  const cells = masks.map((maskValue, index) => {
    const mask = Number(maskValue)
    const tile = tilesByMask.get(mask)
    if (!tile) throw new Error(`mask is not present in rule profile: ${mask}`)
    return makeCell({
      plan,
      tile,
      index,
      x: index % mapWidth,
      y: Math.floor(index / mapWidth),
    })
  })
  const [logicalW, logicalH] = plan.projection.logical_tile_size
  const [spriteW, spriteH] = plan.projection.sprite_cell_size
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_RULE_MAP_MODE,
    rule_profile_id: plan.rule_profile.id,
    contract_id: plan.contract_id,
    projection: {
      type: plan.projection.type,
      logical_tile_size: [...plan.projection.logical_tile_size],
      sprite_cell_size: [...plan.projection.sprite_cell_size],
      pivot: plan.projection.pivot,
      fixed_height_px: plan.projection.fixed_height_px,
    },
    tile_size: {
      logical: { width: logicalW, height: logicalH },
      sprite: { width: spriteW, height: spriteH },
    },
    width: mapWidth,
    height: mapHeight,
    px_size: {
      width: mapWidth * logicalW,
      height: mapHeight * logicalH,
    },
    arrangement: {
      mode: arrangement.mode ?? 'explicit_corner_mask_map_v1',
      wfc_scope: arrangement.wfc_scope ?? 'explicit_masks_validated_not_full_wfc_solver',
      ...arrangement,
    },
    cells,
    metrics: mapMetrics(cells, mapWidth, mapHeight),
  }
}

export function buildTwoPointFiveDGuardedRuleMap({
  plan,
  width = 8,
  height = 6,
  seed = plan?.material_profile?.seed ?? 170617,
  density = 0.55,
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
  return buildTwoPointFiveDMapFromMasks({
    plan,
    width: mapWidth,
    height: mapHeight,
    masks,
    arrangement: {
      mode: 'guarded_seeded_corner_grid_v1',
      algorithm: 'seeded_corner_grid',
      seed: resolvedSeed,
      density: resolvedDensity,
      corner_grid_size: { columns: mapWidth + 1, rows: mapHeight + 1 },
      wfc_scope: 'constraint_validated_seeded_map_not_full_wfc_solver',
    },
  })
}

function normalizeFixedMasks(fixedMasks = [], width, height) {
  return fixedMasks.map((item) => {
    const x = Number(item.x)
    const y = Number(item.y)
    const mask = Number(item.mask)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`fixed mask coordinate is outside the map: ${item.x},${item.y}`)
    }
    if (!Number.isInteger(mask) || mask < 0 || mask > 15) throw new Error(`fixed mask is invalid: ${item.mask}`)
    return { x, y, mask }
  })
}

function normalizeSolverConstraints(constraints = {}, width, height, allMasks) {
  const allowedMasks = constraints.allowed_masks ?? constraints.allowedMasks
  const allowed = allowedMasks
    ? sortedNumbers(allowedMasks).filter((mask) => allMasks.includes(mask))
    : [...allMasks]
  if (!allowed.length) throw new Error('constraint solver allowed masks cannot be empty')
  const fixedMasks = normalizeFixedMasks(constraints.fixed_masks ?? constraints.fixedMasks ?? [], width, height)
  const border = String(constraints.border ?? 'empty')
  if (!['empty', 'none'].includes(border)) throw new Error('constraint border must be empty or none')
  return {
    allowed_masks: allowed,
    fixed_masks: fixedMasks,
    border,
  }
}

function neighborEntries(width, height, index) {
  const x = index % width
  const y = Math.floor(index / width)
  return [
    { side: 'north', index: y > 0 ? indexFor(width, x, y - 1) : -1 },
    { side: 'east', index: x < width - 1 ? indexFor(width, x + 1, y) : -1 },
    { side: 'south', index: y < height - 1 ? indexFor(width, x, y + 1) : -1 },
    { side: 'west', index: x > 0 ? indexFor(width, x - 1, y) : -1 },
  ].filter((item) => item.index >= 0)
}

function allArcs(width, height) {
  const arcs = []
  for (let index = 0; index < width * height; index += 1) {
    for (const neighbor of neighborEntries(width, height, index)) arcs.push({ from: index, to: neighbor.index, side: neighbor.side })
  }
  return arcs
}

function reviseDomain(domains, arc) {
  const fromDomain = domains[arc.from]
  const toDomain = domains[arc.to]
  const removed = []
  for (const mask of fromDomain) {
    const hasCompatibleNeighbor = [...toDomain].some((neighborMask) => areTwoPointFiveDMaskEdgesCompatible(mask, neighborMask, arc.side))
    if (!hasCompatibleNeighbor) removed.push(mask)
  }
  for (const mask of removed) fromDomain.delete(mask)
  return removed
}

function propagateDomains(domains, width, height, initialQueue, report) {
  const queue = [...initialQueue]
  while (queue.length) {
    const arc = queue.shift()
    const removed = reviseDomain(domains, arc)
    report.propagation_step_count += 1
    if (!removed.length) continue
    report.removal_count += removed.length
    if (domains[arc.from].size === 0) {
      report.contradictions.push({
        index: arc.from,
        reason: 'domain_empty_after_edge_propagation',
        removed,
      })
      return false
    }
    for (const neighbor of neighborEntries(width, height, arc.from)) {
      if (neighbor.index === arc.to) continue
      queue.push({ from: neighbor.index, to: arc.from, side: OPPOSITE_EDGE[neighbor.side] })
    }
  }
  return true
}

function applyDomainConstraint(domains, index, mask, report, reason) {
  if (!domains[index].has(mask)) {
    report.contradictions.push({ index, mask, reason: `${reason}_not_in_domain` })
    return false
  }
  if (domains[index].size === 1 && domains[index].has(mask)) return true
  domains[index] = new Set([mask])
  report.assigned_constraints.push({ index, mask, reason })
  return true
}

function chooseUnresolvedCell(domains) {
  let bestIndex = -1
  let bestSize = Infinity
  for (let index = 0; index < domains.length; index += 1) {
    const size = domains[index].size
    if (size <= 1 || size >= bestSize) continue
    bestSize = size
    bestIndex = index
  }
  return bestIndex
}

function orderedDomainValues(domain, { seed, density, index }) {
  return sortedNumbers(domain).sort((a, b) => {
    const aEmptyPenalty = a === 0 ? density : 1 - density
    const bEmptyPenalty = b === 0 ? density : 1 - density
    const aScore = aEmptyPenalty + seededUnit(index, a, seed)
    const bScore = bEmptyPenalty + seededUnit(index, b, seed)
    return aScore - bScore || a - b
  })
}

function solveDomains(domains, width, height, { seed, density, report, depth = 0, nodeLimit = 20000 }) {
  if (report.search_node_count > nodeLimit) {
    report.contradictions.push({ reason: 'search_node_limit_exceeded', node_limit: nodeLimit })
    return null
  }
  report.search_node_count += 1
  report.max_depth = Math.max(report.max_depth, depth)
  const unresolved = chooseUnresolvedCell(domains)
  if (unresolved === -1) return domains

  const values = orderedDomainValues(domains[unresolved], { seed, density, index: unresolved })
  for (const mask of values) {
    const nextDomains = cloneDomains(domains)
    nextDomains[unresolved] = new Set([mask])
    report.decision_count += 1
    const queue = allArcs(width, height).filter((arc) => arc.from === unresolved || arc.to === unresolved)
    const propagated = propagateDomains(nextDomains, width, height, queue, report)
    if (!propagated) {
      report.backtrack_count += 1
      continue
    }
    const solved = solveDomains(nextDomains, width, height, { seed, density, report, depth: depth + 1, nodeLimit })
    if (solved) return solved
    report.backtrack_count += 1
  }
  return null
}

export function solveTwoPointFiveDConstraintMap({
  plan,
  width = 8,
  height = 6,
  seed = plan?.material_profile?.seed ?? 170617,
  density = 0.55,
  constraints = {},
  nodeLimit = 20000,
} = {}) {
  if (!plan?.tiles?.length) throw new Error('plan with tiles is required')
  const mapWidth = assertPositiveInteger(width, 'width')
  const mapHeight = assertPositiveInteger(height, 'height')
  const resolvedSeed = normalizeSeed(seed)
  const resolvedDensity = normalizeDensity(density)
  const allMasks = sortedNumbers(plan.rule_profile.masks)
  const normalizedConstraints = normalizeSolverConstraints(constraints, mapWidth, mapHeight, allMasks)
  const report = {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_CONSTRAINT_SOLVER_MODE,
    status: 'pass',
    algorithm: 'ac3_backtracking_constraint_solver',
    seed: resolvedSeed,
    density: resolvedDensity,
    width: mapWidth,
    height: mapHeight,
    node_limit: nodeLimit,
    constraints: normalizedConstraints,
    assigned_constraints: [],
    contradictions: [],
    propagation_step_count: 0,
    removal_count: 0,
    decision_count: 0,
    backtrack_count: 0,
    search_node_count: 0,
    max_depth: 0,
  }
  const domains = Array.from(
    { length: mapWidth * mapHeight },
    () => new Set(normalizedConstraints.allowed_masks)
  )

  if (normalizedConstraints.border === 'empty') {
    for (let y = 0; y < mapHeight; y += 1) {
      for (let x = 0; x < mapWidth; x += 1) {
        if (x !== 0 && y !== 0 && x !== mapWidth - 1 && y !== mapHeight - 1) continue
        if (!applyDomainConstraint(domains, indexFor(mapWidth, x, y), 0, report, 'empty_border')) {
          return { status: 'fail', map: null, report: { ...report, status: 'fail' } }
        }
      }
    }
  }
  for (const fixed of normalizedConstraints.fixed_masks) {
    if (!applyDomainConstraint(domains, indexFor(mapWidth, fixed.x, fixed.y), fixed.mask, report, 'fixed_mask')) {
      return { status: 'fail', map: null, report: { ...report, status: 'fail' } }
    }
  }

  const initialPropagation = propagateDomains(domains, mapWidth, mapHeight, allArcs(mapWidth, mapHeight), report)
  if (!initialPropagation) return { status: 'fail', map: null, report: { ...report, status: 'fail' } }
  const solved = solveDomains(domains, mapWidth, mapHeight, {
    seed: resolvedSeed,
    density: resolvedDensity,
    report,
    nodeLimit,
  })
  if (!solved) return { status: 'fail', map: null, report: { ...report, status: 'fail' } }
  const masks = solved.map((domain) => [...domain][0])
  const map = buildTwoPointFiveDMapFromMasks({
    plan,
    width: mapWidth,
    height: mapHeight,
    masks,
    arrangement: {
      mode: 'constraint_solved_corner_mask_v1',
      algorithm: report.algorithm,
      seed: resolvedSeed,
      density: resolvedDensity,
      constraints: {
        border: normalizedConstraints.border,
        fixed_mask_count: normalizedConstraints.fixed_masks.length,
        allowed_mask_count: normalizedConstraints.allowed_masks.length,
      },
      solver: {
        mode: report.mode,
        status: report.status,
        decision_count: report.decision_count,
        backtrack_count: report.backtrack_count,
        propagation_step_count: report.propagation_step_count,
        search_node_count: report.search_node_count,
      },
      wfc_scope: 'local_constraint_solver_not_full_wfc_productization',
    },
  })
  return {
    status: 'pass',
    map,
    report: {
      ...report,
      status: 'pass',
      solved_mask_histogram: map.metrics.mask_histogram,
      distinct_mask_count: Object.keys(map.metrics.mask_histogram).length,
    },
  }
}

export function validateTwoPointFiveDRuleMap(map, { plan } = {}) {
  const blocking = new Set()
  const warnings = new Set()
  const edgeMismatches = []
  if (!map || typeof map !== 'object') {
    return {
      schema_version: 1,
      mode: TWO_POINT_FIVE_D_RULE_MAP_VALIDATION_MODE,
      status: 'fail',
      blocking_errors: ['map_missing'],
      warnings: [],
      edge_mismatches: [],
      metrics: {},
    }
  }

  const expectedCount = Number(map.width) * Number(map.height)
  if (!Number.isInteger(map.width) || map.width < 1 || !Number.isInteger(map.height) || map.height < 1) {
    blocking.add('map_size_invalid')
  }
  if (!Array.isArray(map.cells)) blocking.add('map_cells_missing')
  else if (map.cells.length !== expectedCount) blocking.add('map_cell_count_mismatch')

  const allowedMasks = new Set((plan?.rule_profile?.masks ?? []).map(Number))
  const planTilesByMask = plan ? tileByMask(plan) : new Map()
  for (const cell of map.cells ?? []) {
    if (!Number.isInteger(cell.index) || cell.index !== cell.y * map.width + cell.x) blocking.add('cell_index_invalid')
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) {
      blocking.add('cell_coordinate_invalid')
    }
    if (!Number.isInteger(cell.mask)) {
      blocking.add('cell_mask_invalid')
      continue
    }
    if (plan && !allowedMasks.has(cell.mask)) blocking.add('cell_mask_not_in_rule_profile')
    const tile = planTilesByMask.get(cell.mask)
    if (tile && cell.atlas_tile_id !== tile.atlas_tile_id) blocking.add('cell_atlas_tile_id_mismatch')
    for (const [side, dx, dy] of [
      ['east', 1, 0],
      ['south', 0, 1],
    ]) {
      const neighbor = mapCellAt(map, cell.x + dx, cell.y + dy)
      if (!neighbor || !Number.isInteger(neighbor.mask)) continue
      if (areTwoPointFiveDMaskEdgesCompatible(cell.mask, neighbor.mask, side)) continue
      edgeMismatches.push({
        side,
        at: { x: cell.x, y: cell.y, index: cell.index, mask: cell.mask },
        neighbor: { x: neighbor.x, y: neighbor.y, index: neighbor.index, mask: neighbor.mask },
      })
    }
  }
  if (edgeMismatches.length) blocking.add('map_edge_constraint_mismatch')

  if (plan) {
    const [logicalW, logicalH] = plan.projection.logical_tile_size
    if (map.tile_size?.logical?.width !== logicalW || map.tile_size?.logical?.height !== logicalH) {
      blocking.add('map_logical_tile_size_mismatch')
    }
    const [spriteW, spriteH] = plan.projection.sprite_cell_size
    if (map.tile_size?.sprite?.width !== spriteW || map.tile_size?.sprite?.height !== spriteH) {
      blocking.add('map_sprite_cell_size_mismatch')
    }
    if (logicalW === spriteW && logicalH === spriteH) warnings.add('logical_and_sprite_size_not_separated')
  }

  const checkedAdjacencies = Math.max(0, map.height * (map.width - 1)) + Math.max(0, map.width * (map.height - 1))
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_RULE_MAP_VALIDATION_MODE,
    status: blocking.size ? 'fail' : warnings.size ? 'warning' : 'pass',
    blocking_errors: [...blocking],
    warnings: [...warnings],
    edge_mismatches: edgeMismatches,
    metrics: {
      width: map.width,
      height: map.height,
      tile_count: Array.isArray(map.cells) ? map.cells.length : 0,
      checked_adjacencies: checkedAdjacencies,
      edge_mismatch_count: edgeMismatches.length,
      distinct_mask_count: new Set((map.cells ?? []).map((cell) => cell.mask)).size,
      mask_histogram: Array.isArray(map.cells) ? histogram(map.cells) : {},
    },
  }
}
