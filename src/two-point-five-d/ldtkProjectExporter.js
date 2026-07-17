import { validateTwoPointFiveDRuleMap } from './terrainRuleMapBuilder.js'

export const TWO_POINT_FIVE_D_LDTK_PROJECT_MODE = 'two_point_five_d_ldtk_project_export_v1'
export const TWO_POINT_FIVE_D_LDTK_AUTO_LAYER_RULES_MODE = 'two_point_five_d_ldtk_auto_layer_rules_v1'
export const TWO_POINT_FIVE_D_LDTK_PROJECT_VALIDATION_MODE = 'two_point_five_d_ldtk_project_validation_v1'
export const TWO_POINT_FIVE_D_LDTK_WORKFLOW_VALIDATION_MODE = 'two_point_five_d_ldtk_workflow_validation_v1'

const LDTK_JSON_VERSION = '1.5.3'
const ROOT_REQUIRED_FIELDS = Object.freeze([
  'bgColor',
  'defs',
  'externalLevels',
  'iid',
  'jsonVersion',
  'levels',
  'toc',
  'worlds',
  'appBuildId',
  'backupLimit',
  'backupOnSave',
  'customCommands',
  'defaultEntityHeight',
  'defaultEntityWidth',
  'defaultGridSize',
  'defaultLevelBgColor',
  'defaultPivotX',
  'defaultPivotY',
  'dummyWorldIid',
  'exportLevelBg',
  'exportTiled',
  'flags',
  'identifierStyle',
  'imageExportMode',
  'levelNamePattern',
  'minifyJson',
  'nextUid',
  'simplifiedExport',
])

function normalizeIdentifier(value, fallback) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const identifier = normalized || fallback
  return /^[A-Za-z_]/.test(identifier) ? identifier : `_${identifier}`
}

function stableIid(...parts) {
  return `iid_${parts.map((part) => normalizeIdentifier(part, 'item')).join('_')}`
}

function pivotFraction(pivot) {
  if (pivot === 'top_left') return { x: 0, y: 0 }
  if (pivot === 'center') return { x: 0.5, y: 0.5 }
  return { x: 0.5, y: 1 }
}

function buildTilesetCustomData(plan) {
  return plan.tiles.map((tile) => ({
    tileId: tile.atlas_tile_id,
    data: JSON.stringify({
      mask: tile.mask,
      tile_role: tile.tile_role,
      tile_class: tile.transition.tile_class,
      terrain_type: tile.terrain_type,
      logical_footprint: tile.logical_footprint,
      collision: tile.collision,
      pivot: tile.pivot,
      visual_bounds: tile.visual_bounds,
      runtime_inner_rect: tile.runtime_inner_rect,
    }),
  }))
}

function buildTilesetDef({ plan, uid, tilesetRelPath }) {
  const [spriteW] = plan.projection.sprite_cell_size
  return {
    identifier: `${normalizeIdentifier(plan.contract_id, 'two_point_five_d')}_tileset`,
    uid,
    relPath: tilesetRelPath,
    tileGridSize: spriteW,
    pxWid: plan.atlas.strict_atlas_size.width,
    pxHei: plan.atlas.strict_atlas_size.height,
    __cWid: plan.atlas.grid.columns,
    __cHei: plan.atlas.grid.rows,
    padding: 0,
    spacing: 0,
    tags: ['two_point_five_d', plan.rule_profile.id],
    enumTags: [],
    customData: buildTilesetCustomData(plan),
    savedSelections: [],
  }
}

function buildLayerDef({ identifier, type, uid, gridSize, tilesetDefUid, pivot, intGridValues = [], autoRuleGroups = [] }) {
  return {
    __type: type,
    type,
    identifier,
    uid,
    gridSize,
    displayOpacity: 1,
    pxOffsetX: 0,
    pxOffsetY: 0,
    parallaxFactorX: 0,
    parallaxFactorY: 0,
    parallaxScaling: false,
    intGridValues,
    intGridValuesGroups: [],
    autoRuleGroups,
    canSelectWhenInactive: true,
    excludedTags: [],
    guideGridHei: gridSize,
    guideGridWid: gridSize,
    hideFieldsWhenInactive: false,
    hideInList: false,
    inactiveOpacity: 0.6,
    renderInWorldView: true,
    requiredTags: [],
    tilePivotX: pivot.x,
    tilePivotY: pivot.y,
    uiFilterTags: [],
    useAsyncRender: false,
    ...(tilesetDefUid ? { tilesetDefUid } : {}),
  }
}

export function buildTwoPointFiveDLdtkAutoLayerRules({ plan, tilesetDefUid = 1 } = {}) {
  if (!plan?.tiles?.length) throw new Error('plan with tiles is required')
  const tilesByMask = new Map(plan.tiles.map((tile) => [tile.mask, tile]))
  const intGridValues = plan.rule_profile.masks.map((mask) => {
    const tile = tilesByMask.get(mask)
    return {
      identifier: `Mask_${mask}`,
      value: mask + 1,
      color: tile?.transition?.tile_class === 'empty'
        ? '#2c3440'
        : tile?.transition?.tile_class === 'solid'
          ? '#60a85a'
          : '#b7c35c',
      tile: tile
        ? {
            mask,
            tile_id: tile.id,
            atlas_tile_id: tile.atlas_tile_id,
            tile_role: tile.tile_role,
            tile_class: tile.transition.tile_class,
          }
        : null,
    }
  })
  const rules = plan.rule_profile.masks.map((mask, index) => {
    const tile = tilesByMask.get(mask)
    const outputsTile = Boolean(tile && tile.transition.tile_class !== 'empty')
    return {
      uid: 1000 + index,
      name: `mask_${mask}`,
      active: true,
      size: 1,
      chance: 1,
      breakOnMatch: true,
      intGridValue: mask + 1,
      tileIds: outputsTile ? [tile.atlas_tile_id] : [],
      tileRects: outputsTile ? [{ ...tile.source_rect }] : [],
      pattern: [mask + 1],
      flipX: false,
      flipY: false,
      checker: 'None',
      xModulo: 1,
      yModulo: 1,
      xOffset: 0,
      yOffset: 0,
      tileMode: outputsTile ? 'Single' : 'None',
      metadata: {
        mask,
        tile_id: tile?.id ?? `mask_${mask}`,
        tile_role: tile?.tile_role ?? 'unknown',
        tile_class: tile?.transition?.tile_class ?? 'unknown',
      },
    }
  })
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_LDTK_AUTO_LAYER_RULES_MODE,
    rule_profile_id: plan.rule_profile.id,
    layer_identifier: 'TerrainMasks',
    output_layer_identifier: 'Tiles',
    int_grid_value_encoding: 'mask_plus_one_zero_reserved_for_empty_cell',
    tileset_def_uid: tilesetDefUid,
    int_grid_values: intGridValues,
    auto_rule_groups: [
      {
        uid: 500,
        name: 'corner_mask_16_autotile_rules',
        active: true,
        isOptional: false,
        usesWizard: false,
        rules,
      },
    ],
    claim_boundary: 'LDtk-style auto-layer rule authoring only; no editor round-trip evaluation is claimed.',
  }
}

function buildGridTile(cell) {
  return {
    px: [cell.logical_px.x, cell.logical_px.y],
    src: [cell.source_rect.x, cell.source_rect.y],
    t: cell.atlas_tile_id,
    f: 0,
    a: 1,
    d: [cell.x, cell.y, cell.index, cell.mask],
  }
}

function buildLayerInstance({
  identifier,
  type,
  iid,
  layerDefUid,
  levelUid,
  map,
  gridSize,
  tilesetDefUid,
  tilesetRelPath,
}) {
  const isTilesLayer = type === 'Tiles'
  const isIntGridLayer = type === 'IntGrid'
  return {
    __identifier: identifier,
    __type: type,
    __gridSize: gridSize,
    __cWid: map.width,
    __cHei: map.height,
    __opacity: 1,
    __pxTotalOffsetX: 0,
    __pxTotalOffsetY: 0,
    iid,
    layerDefUid,
    levelId: levelUid,
    pxOffsetX: 0,
    pxOffsetY: 0,
    visible: true,
    optionalRules: [],
    seed: 0,
    autoLayerTiles: isIntGridLayer ? map.cells.filter((cell) => cell.tile_class !== 'empty').map((cell) => buildGridTile(cell)) : [],
    entityInstances: [],
    gridTiles: isTilesLayer ? map.cells.map((cell) => buildGridTile(cell)) : [],
    intGridCsv: isIntGridLayer ? map.cells.map((cell) => cell.mask + 1) : [],
    ...(isTilesLayer ? { __tilesetDefUid: tilesetDefUid, __tilesetRelPath: tilesetRelPath } : {}),
  }
}

export function buildTwoPointFiveDLdtkProjectJson({
  plan,
  map,
  projectId = plan?.contract_id ?? 'two_point_five_d_project',
  identifier = 'terrain_map_0',
  tilesetRelPath = 'strict_atlas.png',
} = {}) {
  if (!plan?.tiles?.length) throw new Error('plan with tiles is required')
  const mapValidation = validateTwoPointFiveDRuleMap(map, { plan })
  if (mapValidation.status === 'fail') {
    throw new Error(`Cannot export invalid 2.5D rule map: ${mapValidation.blocking_errors.join(', ')}`)
  }
  const [logicalW, logicalH] = plan.projection.logical_tile_size
  const [spriteW, spriteH] = plan.projection.sprite_cell_size
  if (logicalW !== logicalH) throw new Error('2.5D LDtk export currently requires square logical tiles')
  if (spriteW !== spriteH) throw new Error('2.5D LDtk export currently requires square sprite cells')

  const projectIdentifier = normalizeIdentifier(projectId, 'two_point_five_d_project')
  const levelIdentifier = normalizeIdentifier(identifier, 'terrain_map_0')
  const pivot = pivotFraction(plan.projection.pivot)
  const tilesetUid = 1
  const tilesLayerUid = 2
  const entitiesLayerUid = 3
  const terrainMasksLayerUid = 4
  const levelUid = 5
  const autoLayerRules = buildTwoPointFiveDLdtkAutoLayerRules({ plan, tilesetDefUid: tilesetUid })
  return {
    jsonVersion: LDTK_JSON_VERSION,
    appBuildId: 0,
    iid: stableIid(projectIdentifier, 'project'),
    bgColor: '#1d1d1d',
    defaultGridSize: logicalW,
    defaultEntityWidth: logicalW,
    defaultEntityHeight: logicalH,
    defaultLevelBgColor: '#1d1d1d',
    defaultPivotX: pivot.x,
    defaultPivotY: pivot.y,
    dummyWorldIid: stableIid(projectIdentifier, 'world'),
    externalLevels: false,
    levels: [
      {
        identifier: levelIdentifier,
        iid: stableIid(projectIdentifier, levelIdentifier, 'level'),
        uid: levelUid,
        pxWid: map.width * logicalW,
        pxHei: map.height * logicalH,
        worldX: 0,
        worldY: 0,
        worldDepth: 0,
        __bgColor: '#1d1d1d',
        __neighbours: [],
        __smartColor: '#6c8cff',
        bgPivotX: 0.5,
        bgPivotY: 0.5,
        useAutoIdentifier: false,
        fieldInstances: [],
        layerInstances: [
          buildLayerInstance({
            identifier: 'Entities',
            type: 'Entities',
            iid: stableIid(projectIdentifier, levelIdentifier, 'entities_layer'),
            layerDefUid: entitiesLayerUid,
            levelUid,
            map,
            gridSize: logicalW,
          }),
          buildLayerInstance({
            identifier: 'TerrainMasks',
            type: 'IntGrid',
            iid: stableIid(projectIdentifier, levelIdentifier, 'terrain_masks_layer'),
            layerDefUid: terrainMasksLayerUid,
            levelUid,
            map,
            gridSize: logicalW,
          }),
          buildLayerInstance({
            identifier: 'Tiles',
            type: 'Tiles',
            iid: stableIid(projectIdentifier, levelIdentifier, 'tiles_layer'),
            layerDefUid: tilesLayerUid,
            levelUid,
            map,
            gridSize: logicalW,
            tilesetDefUid: tilesetUid,
            tilesetRelPath,
          }),
        ],
      },
    ],
    worlds: [],
    toc: [],
    defs: {
      tilesets: [buildTilesetDef({ plan, uid: tilesetUid, tilesetRelPath })],
      layers: [
        buildLayerDef({
          identifier: 'Tiles',
          type: 'Tiles',
          uid: tilesLayerUid,
          gridSize: logicalW,
          tilesetDefUid: tilesetUid,
          pivot,
        }),
        buildLayerDef({
          identifier: 'TerrainMasks',
          type: 'IntGrid',
          uid: terrainMasksLayerUid,
          gridSize: logicalW,
          tilesetDefUid: tilesetUid,
          pivot,
          intGridValues: autoLayerRules.int_grid_values.map((item) => ({
            identifier: item.identifier,
            value: item.value,
            color: item.color,
          })),
          autoRuleGroups: autoLayerRules.auto_rule_groups,
        }),
        buildLayerDef({
          identifier: 'Entities',
          type: 'Entities',
          uid: entitiesLayerUid,
          gridSize: logicalW,
          pivot,
        }),
      ],
      entities: [],
      enums: [],
      externalEnums: [],
      levelFields: [],
    },
    nextUid: 2000,
    backupLimit: 10,
    backupOnSave: false,
    customCommands: [],
    exportLevelBg: true,
    exportTiled: false,
    flags: ['TwoPointFiveDGuardedRuleMap'],
    identifierStyle: 'Capitalize',
    imageExportMode: 'None',
    levelNamePattern: 'Level_%idx',
    minifyJson: false,
    simplifiedExport: false,
    twoPointFiveD: {
      mode: TWO_POINT_FIVE_D_LDTK_PROJECT_MODE,
      rule_profile_id: plan.rule_profile.id,
      map_mode: map.mode,
      map_arrangement: map.arrangement,
      auto_layer_rules: {
        mode: autoLayerRules.mode,
        layer_identifier: autoLayerRules.layer_identifier,
        rule_group_count: autoLayerRules.auto_rule_groups.length,
        rule_count: autoLayerRules.auto_rule_groups.reduce((total, group) => total + group.rules.length, 0),
        int_grid_value_count: autoLayerRules.int_grid_values.length,
      },
      logical_tile_size: { width: logicalW, height: logicalH },
      sprite_cell_size: { width: spriteW, height: spriteH },
      pivot: plan.projection.pivot,
      pivot_fraction: pivot,
      placement_note: 'Tiles layer uses logical grid coordinates; tileset customData preserves sprite cell, pivot, collision, and visual bounds for importers.',
      claim_boundary: 'Concrete single-level LDtk project export plus LDtk-style auto-layer rule authoring; no editor round-trip evaluation or full WFC solver is claimed.',
    },
  }
}

function hasRequiredRootFields(project) {
  return ROOT_REQUIRED_FIELDS.every((field) => Object.hasOwn(project ?? {}, field))
}

function tileShapeInvalid(tile) {
  return !Array.isArray(tile?.px)
    || tile.px.length !== 2
    || !Array.isArray(tile?.src)
    || tile.src.length !== 2
    || !Number.isInteger(tile?.t)
    || !Number.isInteger(tile?.f)
    || typeof tile?.a !== 'number'
    || !Array.isArray(tile?.d)
    || tile.d.length < 4
}

export function validateTwoPointFiveDLdtkProjectJson(project) {
  const blockingErrors = []
  if (project?.jsonVersion !== LDTK_JSON_VERSION) blockingErrors.push('ldtk_json_version_unsupported')
  if (!project?.iid) blockingErrors.push('missing_iid')
  if (!hasRequiredRootFields(project)) blockingErrors.push('missing_required_root_fields')
  if (project?.twoPointFiveD?.mode !== TWO_POINT_FIVE_D_LDTK_PROJECT_MODE) {
    blockingErrors.push('missing_two_point_five_d_export_metadata')
  }
  if (!project?.defs?.tilesets?.length) blockingErrors.push('missing_tileset_def')
  if (!project?.defs?.layers?.some((layer) => layer.identifier === 'Tiles' && layer.type === 'Tiles')) {
    blockingErrors.push('missing_tiles_layer_def')
  }
  if (!project?.defs?.layers?.some((layer) => layer.identifier === 'Entities' && layer.type === 'Entities')) {
    blockingErrors.push('missing_entities_layer_def')
  }
  const terrainMaskLayer = project?.defs?.layers?.find((layer) => layer.identifier === 'TerrainMasks' && layer.type === 'IntGrid')
  if (!terrainMaskLayer) blockingErrors.push('missing_terrain_masks_layer_def')
  if (terrainMaskLayer && (!Array.isArray(terrainMaskLayer.intGridValues) || terrainMaskLayer.intGridValues.length < 16)) {
    blockingErrors.push('terrain_masks_int_grid_values_incomplete')
  }
  const autoRuleGroups = terrainMaskLayer?.autoRuleGroups ?? []
  const autoRules = autoRuleGroups.flatMap((group) => group.rules ?? [])
  if (!autoRuleGroups.length || autoRules.length < 16) blockingErrors.push('ldtk_auto_layer_rules_incomplete')

  const tileset = project?.defs?.tilesets?.[0]
  if (!Number.isInteger(tileset?.tileGridSize) || tileset.tileGridSize < 1) blockingErrors.push('tileset_tile_grid_size_invalid')
  if (!Array.isArray(tileset?.customData) || tileset.customData.length === 0) blockingErrors.push('tileset_custom_data_missing')

  const levels = project?.levels ?? []
  const firstLevel = levels[0]
  if (!firstLevel?.identifier) blockingErrors.push('missing_level_identifier')
  if (!Number.isInteger(firstLevel?.pxWid) || !Number.isInteger(firstLevel?.pxHei)) {
    blockingErrors.push('missing_level_size')
  }

  const layerInstances = levels.flatMap((level) => level.layerInstances ?? [])
  const gridTiles = layerInstances
    .filter((layer) => layer.__identifier === 'Tiles')
    .flatMap((layer) => layer.gridTiles ?? [])
  const intGridCells = layerInstances
    .filter((layer) => layer.__identifier === 'TerrainMasks')
    .flatMap((layer) => layer.intGridCsv ?? [])
  if (gridTiles.length === 0) blockingErrors.push('missing_grid_tiles')
  if (gridTiles.some(tileShapeInvalid)) blockingErrors.push('grid_tile_shape_invalid')
  if (intGridCells.length === 0) blockingErrors.push('missing_terrain_mask_int_grid')

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_LDTK_PROJECT_VALIDATION_MODE,
    status: blockingErrors.length ? 'fail' : 'pass',
    blocking_errors: blockingErrors,
    warnings: [],
    metrics: {
      level_count: levels.length,
      layer_count: project?.defs?.layers?.length ?? 0,
      tileset_count: project?.defs?.tilesets?.length ?? 0,
      grid_tile_count: gridTiles.length,
      terrain_mask_cell_count: intGridCells.length,
      auto_layer_rule_group_count: autoRuleGroups.length,
      auto_layer_rule_count: autoRules.length,
      tileset_tile_grid_size: tileset?.tileGridSize ?? null,
      default_grid_size: project?.defaultGridSize ?? null,
      has_two_point_five_d_metadata: project?.twoPointFiveD?.mode === TWO_POINT_FIVE_D_LDTK_PROJECT_MODE,
    },
  }
}

function collectUids(project) {
  const uidEntries = []
  for (const tileset of project?.defs?.tilesets ?? []) uidEntries.push({ kind: 'tileset_def', uid: tileset.uid })
  for (const layer of project?.defs?.layers ?? []) {
    uidEntries.push({ kind: 'layer_def', uid: layer.uid })
    for (const group of layer.autoRuleGroups ?? []) {
      uidEntries.push({ kind: 'auto_rule_group', uid: group.uid })
      for (const rule of group.rules ?? []) uidEntries.push({ kind: 'auto_rule', uid: rule.uid })
    }
  }
  for (const level of project?.levels ?? []) uidEntries.push({ kind: 'level', uid: level.uid })
  return uidEntries
}

function duplicatedUids(uidEntries) {
  const seen = new Map()
  const duplicates = new Set()
  for (const entry of uidEntries) {
    if (!Number.isInteger(entry.uid)) continue
    if (seen.has(entry.uid)) duplicates.add(entry.uid)
    else seen.set(entry.uid, entry)
  }
  return [...duplicates].sort((a, b) => a - b)
}

function layerDefByUid(project) {
  return new Map((project?.defs?.layers ?? []).map((layer) => [layer.uid, layer]))
}

function parseCustomData(data) {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function validateTwoPointFiveDLdtkWorkflowReadiness(project, {
  expectedTilesetRelPath = 'strict_atlas.png',
} = {}) {
  const projectValidation = validateTwoPointFiveDLdtkProjectJson(project)
  const blockingErrors = [...projectValidation.blocking_errors]
  const warnings = []

  try {
    JSON.parse(JSON.stringify(project))
  } catch {
    blockingErrors.push('ldtk_project_json_roundtrip_failed')
  }

  const uidEntries = collectUids(project)
  const duplicateUids = duplicatedUids(uidEntries)
  if (duplicateUids.length) blockingErrors.push('ldtk_uid_collision')
  if (uidEntries.some((entry) => !Number.isInteger(entry.uid) || entry.uid < 1)) blockingErrors.push('ldtk_uid_invalid')
  if (Number.isInteger(project?.nextUid) && uidEntries.some((entry) => entry.uid >= project.nextUid)) {
    blockingErrors.push('ldtk_next_uid_not_above_used_uids')
  }

  const tileset = project?.defs?.tilesets?.[0]
  if (tileset?.relPath !== expectedTilesetRelPath) blockingErrors.push('ldtk_tileset_relpath_mismatch')
  const tilesetTileIds = new Set((tileset?.customData ?? []).map((item) => Number(item.tileId)))
  const customDataPayloads = (tileset?.customData ?? []).map((item) => parseCustomData(item.data))
  if (customDataPayloads.some((item) => !item)) blockingErrors.push('ldtk_tileset_custom_data_unparseable')
  if (customDataPayloads.some((item) => !item?.pivot || !item?.collision || !item?.runtime_inner_rect)) {
    blockingErrors.push('ldtk_tileset_custom_data_missing_runtime_metadata')
  }

  const defsByUid = layerDefByUid(project)
  const layerInstances = (project?.levels ?? []).flatMap((level) => level.layerInstances ?? [])
  for (const instance of layerInstances) {
    const def = defsByUid.get(instance.layerDefUid)
    if (!def) {
      blockingErrors.push('ldtk_layer_instance_missing_def')
      continue
    }
    if (def.identifier !== instance.__identifier || def.type !== instance.__type) {
      blockingErrors.push('ldtk_layer_instance_def_mismatch')
    }
  }

  const tilesLayerDef = project?.defs?.layers?.find((layer) => layer.identifier === 'Tiles')
  const masksLayerDef = project?.defs?.layers?.find((layer) => layer.identifier === 'TerrainMasks')
  const tilesLayers = layerInstances.filter((layer) => layer.__identifier === 'Tiles')
  const maskLayers = layerInstances.filter((layer) => layer.__identifier === 'TerrainMasks')
  if (tilesLayers.length !== 1) blockingErrors.push('ldtk_tiles_layer_instance_count_invalid')
  if (maskLayers.length !== 1) blockingErrors.push('ldtk_terrain_masks_layer_instance_count_invalid')
  if (tilesLayerDef?.tilesetDefUid !== tileset?.uid) blockingErrors.push('ldtk_tiles_layer_tileset_uid_mismatch')
  if (masksLayerDef?.tilesetDefUid !== tileset?.uid) blockingErrors.push('ldtk_masks_layer_tileset_uid_mismatch')

  const maskValues = new Set((masksLayerDef?.intGridValues ?? []).map((item) => Number(item.value)))
  for (let value = 1; value <= 16; value += 1) {
    if (!maskValues.has(value)) blockingErrors.push('ldtk_masks_int_grid_value_missing')
  }
  const autoRuleGroups = masksLayerDef?.autoRuleGroups ?? []
  const autoRules = autoRuleGroups.flatMap((group) => group.rules ?? [])
  const autoRuleValues = new Set(autoRules.map((rule) => Number(rule.intGridValue)))
  for (let value = 1; value <= 16; value += 1) {
    if (!autoRuleValues.has(value)) blockingErrors.push('ldtk_auto_rule_value_missing')
  }
  for (const rule of autoRules) {
    if (!Array.isArray(rule.pattern) || rule.pattern.length !== 1 || rule.pattern[0] !== rule.intGridValue) {
      blockingErrors.push('ldtk_auto_rule_pattern_mismatch')
    }
    if ((rule.tileIds ?? []).some((tileId) => !tilesetTileIds.has(Number(tileId)))) {
      blockingErrors.push('ldtk_auto_rule_tile_id_not_in_tileset')
    }
  }

  const gridTiles = tilesLayers.flatMap((layer) => layer.gridTiles ?? [])
  const intGridCsv = maskLayers.flatMap((layer) => layer.intGridCsv ?? [])
  const autoLayerTiles = maskLayers.flatMap((layer) => layer.autoLayerTiles ?? [])
  if (gridTiles.length !== intGridCsv.length) blockingErrors.push('ldtk_tiles_and_masks_cell_count_mismatch')
  if (intGridCsv.some((value) => !Number.isInteger(value) || value < 1 || value > 16)) {
    blockingErrors.push('ldtk_int_grid_csv_value_out_of_range')
  }
  const nonEmptyMaskCount = intGridCsv.filter((value) => value > 1).length
  if (autoLayerTiles.length !== nonEmptyMaskCount) blockingErrors.push('ldtk_auto_layer_tile_count_mismatch')
  if (gridTiles.some((tile) => !tilesetTileIds.has(Number(tile.t)))) blockingErrors.push('ldtk_grid_tile_id_not_in_tileset')
  if (tilesLayers.some((layer) => layer.__tilesetRelPath !== expectedTilesetRelPath)) {
    blockingErrors.push('ldtk_tiles_layer_relpath_mismatch')
  }

  const layerOrder = layerInstances.map((layer) => layer.__identifier)
  if (!layerOrder.includes('Tiles') || !layerOrder.includes('TerrainMasks') || !layerOrder.includes('Entities')) {
    blockingErrors.push('ldtk_layer_order_missing_required_layers')
  }
  if (autoLayerTiles.length === 0) warnings.push('ldtk_auto_layer_tiles_empty_for_current_map')

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_LDTK_WORKFLOW_VALIDATION_MODE,
    status: blockingErrors.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: [...new Set(blockingErrors)],
    warnings,
    metrics: {
      project_validation_status: projectValidation.status,
      uid_count: uidEntries.length,
      duplicate_uid_count: duplicateUids.length,
      max_uid: uidEntries.reduce((max, entry) => Math.max(max, Number(entry.uid) || 0), 0),
      next_uid: project?.nextUid ?? null,
      layer_order: layerOrder,
      tileset_relpath: tileset?.relPath ?? null,
      custom_data_count: tileset?.customData?.length ?? 0,
      grid_tile_count: gridTiles.length,
      int_grid_cell_count: intGridCsv.length,
      auto_layer_tile_count: autoLayerTiles.length,
      non_empty_mask_count: nonEmptyMaskCount,
      auto_rule_count: autoRules.length,
      int_grid_value_count: masksLayerDef?.intGridValues?.length ?? 0,
    },
    claim_boundary: 'Static LDtk import-readiness checks for project shape, layer references, auto-rules, and metadata; no external editor launch is claimed.',
  }
}
