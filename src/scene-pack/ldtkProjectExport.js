import { buildTileAtlasMetadata, getTileSourceRegion, TOPDOWN_TILE_DUAL_GRID_V0 } from './tileProfile.js'
import { validateTileMap } from './tileArrangement.js'

const LDTK_JSON_VERSION = '1.5.3'

const ROOT_REQUIRED_FIELDS = [
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
]

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

function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function buildTilesetDef({ uid, profile, tilesetRelPath }) {
  const spacing = profile.source.cell.w - profile.tile.w
  return {
    identifier: `${profile.id}_tileset`,
    uid,
    relPath: tilesetRelPath,
    tileGridSize: profile.tile.w,
    pxWid: profile.source.sheet.w,
    pxHei: profile.source.sheet.h,
    __cWid: profile.grid.columns,
    __cHei: profile.grid.rows,
    padding: profile.source.cell.padding,
    spacing,
    tags: [],
    enumTags: [],
    customData: buildTileAtlasMetadata(profile).tiles.map((tile) => ({
      tileId: tile.index,
      data: JSON.stringify({ mask: tile.mask, corners: tile.corners }),
    })),
    savedSelections: [],
  }
}

function buildLayerDef({
  identifier,
  type,
  uid,
  gridSize,
  tilesetDefUid,
}) {
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
    intGridValues: [],
    intGridValuesGroups: [],
    autoRuleGroups: [],
    canSelectWhenInactive: true,
    excludedTags: [],
    guideGridHei: gridSize,
    guideGridWid: gridSize,
    hideFieldsWhenInactive: false,
    hideInList: false,
    inactiveOpacity: 0.6,
    renderInWorldView: true,
    requiredTags: [],
    tilePivotX: 0,
    tilePivotY: 0,
    uiFilterTags: [],
    useAsyncRender: false,
    ...(tilesetDefUid ? { tilesetDefUid } : {}),
  }
}

function buildFieldDef(field, uid) {
  const type = field.type ?? 'String'
  return {
    __type: type,
    type,
    identifier: normalizeIdentifier(field.identifier, `Field_${uid}`),
    uid,
    canBeNull: field.canBeNull ?? false,
    isArray: field.isArray ?? false,
    allowOutOfLevelRef: false,
    allowedRefTags: [],
    allowedRefs: 'Any',
    autoChainRef: true,
    editorAlwaysShow: false,
    editorCutLongValues: true,
    editorDisplayMode: 'Hidden',
    editorDisplayPos: 'Above',
    editorDisplayScale: 1,
    editorLinkStyle: 'StraightArrow',
    editorShowInWorld: false,
    exportToToc: false,
    searchable: false,
    symmetricalRef: false,
    useForSmartColor: false,
    ...(field.defaultValue !== undefined ? { defaultOverride: clonePlain(field.defaultValue) } : {}),
  }
}

function buildEntityDef(entity, uid, fieldUidStart) {
  return {
    identifier: normalizeIdentifier(entity.identifier, `Entity_${uid}`),
    uid,
    color: entity.color ?? '#ffcc00',
    width: entity.width ?? TOPDOWN_TILE_DUAL_GRID_V0.tile.w,
    height: entity.height ?? TOPDOWN_TILE_DUAL_GRID_V0.tile.h,
    pivotX: entity.pivotX ?? 0.5,
    pivotY: entity.pivotY ?? 1,
    nineSliceBorders: [],
    tileRenderMode: 'Cover',
    allowOutOfBounds: false,
    exportToToc: false,
    fieldDefs: (entity.fields ?? []).map((field, index) => buildFieldDef(field, fieldUidStart + index)),
    fillOpacity: 0.25,
    hollow: false,
    keepAspectRatio: true,
    limitBehavior: 'DiscardOldOnes',
    limitScope: 'PerLayer',
    lineOpacity: 1,
    maxCount: 0,
    renderMode: 'Rectangle',
    resizableX: false,
    resizableY: false,
    showName: true,
    tags: [],
    tileOpacity: 1,
  }
}

function buildGridTile(cell, profile) {
  const region = getTileSourceRegion(cell.mask, profile)
  return {
    px: [cell.x * profile.tile.w, cell.y * profile.tile.h],
    src: [region.x, region.y],
    t: cell.mask,
    f: 0,
    a: 1,
    d: [cell.x, cell.y, cell.index],
  }
}

function buildLayerInstance({
  identifier,
  type,
  iid,
  layerDefUid,
  levelUid,
  map,
  profile,
  tilesetDefUid,
  tilesetRelPath,
}) {
  const isTileLayer = type === 'Tiles'
  return {
    __identifier: identifier,
    __type: type,
    __gridSize: profile.tile.w,
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
    autoLayerTiles: [],
    entityInstances: [],
    gridTiles: isTileLayer ? map.cells.map((cell) => buildGridTile(cell, profile)) : [],
    intGridCsv: [],
    ...(isTileLayer ? { __tilesetDefUid: tilesetDefUid, __tilesetRelPath: tilesetRelPath } : {}),
  }
}

export function buildLdtkProjectJson({
  projectId = 'scene_project',
  identifier = 'scene_0',
  map,
  tilesetRelPath = 'tileset.png',
  entityDefs = [],
  profile = TOPDOWN_TILE_DUAL_GRID_V0,
} = {}) {
  const validation = validateTileMap(map, { profile })
  if (validation.status !== 'pass') throw new Error(`Cannot export invalid tile map: ${validation.blocking_errors.join(', ')}`)

  const projectIdentifier = normalizeIdentifier(projectId, 'scene_project')
  const levelIdentifier = normalizeIdentifier(identifier, 'scene_0')
  const tilesetUid = 1
  const tilesLayerUid = 2
  const entitiesLayerUid = 3
  const levelUid = 4
  const entityUidStart = 100
  const fieldUidStart = 1000
  const entityDefinitions = entityDefs.map((entity, index) => buildEntityDef(
    entity,
    entityUidStart + index,
    fieldUidStart + index * 100
  ))
  const nextUid = Math.max(
    levelUid,
    entitiesLayerUid,
    tilesLayerUid,
    tilesetUid,
    ...entityDefinitions.flatMap((entity) => [entity.uid, ...entity.fieldDefs.map((field) => field.uid)])
  ) + 1

  return {
    jsonVersion: LDTK_JSON_VERSION,
    appBuildId: 0,
    iid: stableIid(projectIdentifier, 'project'),
    bgColor: '#1d1d1d',
    defaultGridSize: profile.tile.w,
    defaultEntityWidth: profile.tile.w,
    defaultEntityHeight: profile.tile.h,
    defaultLevelBgColor: '#1d1d1d',
    defaultPivotX: 0,
    defaultPivotY: 0,
    dummyWorldIid: stableIid(projectIdentifier, 'world'),
    externalLevels: false,
    levels: [
      {
        identifier: levelIdentifier,
        iid: stableIid(projectIdentifier, levelIdentifier, 'level'),
        uid: levelUid,
        pxWid: map.width * profile.tile.w,
        pxHei: map.height * profile.tile.h,
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
            profile,
          }),
          buildLayerInstance({
            identifier: 'Tiles',
            type: 'Tiles',
            iid: stableIid(projectIdentifier, levelIdentifier, 'tiles_layer'),
            layerDefUid: tilesLayerUid,
            levelUid,
            map,
            profile,
            tilesetDefUid: tilesetUid,
            tilesetRelPath,
          }),
        ],
      },
    ],
    worlds: [],
    toc: [],
    defs: {
      tilesets: [buildTilesetDef({ uid: tilesetUid, profile, tilesetRelPath })],
      layers: [
        buildLayerDef({
          identifier: 'Tiles',
          type: 'Tiles',
          uid: tilesLayerUid,
          gridSize: profile.tile.w,
          tilesetDefUid: tilesetUid,
        }),
        buildLayerDef({
          identifier: 'Entities',
          type: 'Entities',
          uid: entitiesLayerUid,
          gridSize: profile.tile.w,
        }),
      ],
      entities: entityDefinitions,
      enums: [],
      externalEnums: [],
      levelFields: [],
    },
    nextUid,
    backupLimit: 10,
    backupOnSave: false,
    customCommands: [],
    exportLevelBg: true,
    exportTiled: false,
    flags: [],
    identifierStyle: 'Capitalize',
    imageExportMode: 'None',
    levelNamePattern: 'Level_%idx',
    minifyJson: false,
    simplifiedExport: false,
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
}

export function validateLdtkProjectJson(project) {
  const blocking_errors = []
  if (!project?.iid) blocking_errors.push('missing_iid')
  if (!hasRequiredRootFields(project)) blocking_errors.push('missing_required_root_fields')
  if (!project?.defs?.tilesets?.length) blocking_errors.push('missing_tileset_def')
  if (!project?.defs?.layers?.some((layer) => layer.identifier === 'Tiles' && layer.type === 'Tiles')) {
    blocking_errors.push('missing_tiles_layer_def')
  }
  if (!project?.defs?.layers?.some((layer) => layer.identifier === 'Entities' && layer.type === 'Entities')) {
    blocking_errors.push('missing_entities_layer_def')
  }

  const levels = project?.levels ?? []
  const firstLevel = levels[0]
  if (!firstLevel?.identifier) blocking_errors.push('missing_level_identifier')
  if (!Number.isInteger(firstLevel?.pxWid) || !Number.isInteger(firstLevel?.pxHei)) {
    blocking_errors.push('missing_level_size')
  }

  const layerInstances = levels.flatMap((level) => level.layerInstances ?? [])
  const gridTiles = layerInstances
    .filter((layer) => layer.__identifier === 'Tiles')
    .flatMap((layer) => layer.gridTiles ?? [])
  if (gridTiles.some(tileShapeInvalid)) blocking_errors.push('grid_tile_shape_invalid')

  return {
    status: blocking_errors.length ? 'fail' : 'pass',
    blocking_errors,
    metrics: {
      level_count: levels.length,
      layer_count: project?.defs?.layers?.length ?? 0,
      tileset_count: project?.defs?.tilesets?.length ?? 0,
      entity_def_count: project?.defs?.entities?.length ?? 0,
      grid_tile_count: gridTiles.length,
    },
  }
}
