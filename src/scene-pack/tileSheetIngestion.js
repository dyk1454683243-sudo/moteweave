import { buildScenePreviewBundle } from './scenePreview.js'
import { evaluateSceneTileQualityGate } from './tileQualityGate.js'
import {
  buildTileAtlasMetadata,
  getTileSourceRegion,
  TOPDOWN_TILE_DUAL_GRID_V0,
  validateTileProfile,
} from './tileProfile.js'

function cloneTileRegion(image, region) {
  const data = new Uint8ClampedArray(region.w * region.h * 4)
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const src = ((region.y + y) * image.width + region.x + x) * 4
      const dst = (y * region.w + x) * 4
      data[dst] = image.data[src]
      data[dst + 1] = image.data[src + 1]
      data[dst + 2] = image.data[src + 2]
      data[dst + 3] = image.data[src + 3]
    }
  }
  return { width: region.w, height: region.h, data }
}

export function validateTileSheetImage(image, { profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const profileValidation = validateTileProfile(profile)
  const blocking_errors = [...profileValidation.blocking_errors]
  const expected = profile.source.sheet
  const expectedDataLength = image?.width * image?.height * 4
  if (image?.width !== expected.w || image?.height !== expected.h) blocking_errors.push('source_sheet_size_mismatch')
  if (!image?.data || image.data.length !== expectedDataLength) blocking_errors.push('source_sheet_data_size_mismatch')

  return {
    status: blocking_errors.length ? 'fail' : 'pass',
    blocking_errors,
    warnings: profileValidation.warnings,
    metrics: {
      width: image?.width ?? 0,
      height: image?.height ?? 0,
      expected_width: expected.w,
      expected_height: expected.h,
      tile_count: profile.grid.columns * profile.grid.rows,
      source_cell_size: { ...profile.source.cell },
      runtime_tile_size: { ...profile.tile },
    },
  }
}

export function extractTileSheetTiles(image, { profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const validation = validateTileSheetImage(image, { profile })
  if (validation.status !== 'pass') throw new Error(`Cannot ingest invalid tile sheet: ${validation.blocking_errors.join(', ')}`)
  const tileCount = profile.grid.columns * profile.grid.rows
  const tiles = {}
  for (let mask = 0; mask < tileCount; mask += 1) {
    tiles[mask] = cloneTileRegion(image, getTileSourceRegion(mask, profile))
  }

  return {
    profile: profile.id,
    validation,
    tiles,
    tileAtlasMetadata: buildTileAtlasMetadata(profile),
  }
}

export function buildScenePackFromTileSheet({
  source,
  tilesetPng,
  projectId = 'uploaded_scene_project',
  identifier = 'uploaded_scene',
  width = 6,
  height = 4,
  pattern = 'island',
  seed = 1,
  density = 0.5,
  tilesetRelPath = 'tileset.png',
  palette,
  thresholds,
  gatePolicy,
  rawTilePolicy,
  profile = TOPDOWN_TILE_DUAL_GRID_V0,
  styleCorrectionReport,
  edgeConditioningReport,
} = {}) {
  const ingested = extractTileSheetTiles(source, { profile })
  const preview = buildScenePreviewBundle({
    projectId,
    identifier,
    width,
    height,
    pattern,
    seed,
    density,
    tilesetRelPath,
  })
  const evaluatedQualityGate = evaluateSceneTileQualityGate({
    map: preview.map,
    tiles: ingested.tiles,
    source,
    palette,
    thresholds,
    gatePolicy,
    rawTilePolicy,
    profile,
  })
  const qualityGate = {
    ...evaluatedQualityGate,
    ...(styleCorrectionReport ? { style_correction: styleCorrectionReport } : {}),
    ...(edgeConditioningReport ? { edge_conditioning: edgeConditioningReport } : {}),
  }

  return {
    status: qualityGate.status,
    sourceValidation: ingested.validation,
    tiles: ingested.tiles,
    tileAtlasMetadata: ingested.tileAtlasMetadata,
    map: preview.map,
    tileMap: preview.map,
    sceneJson: preview.sceneJson,
    ldtkProjectJson: preview.ldtkProjectJson,
    qualityGate,
    ...(styleCorrectionReport ? { styleCorrection: styleCorrectionReport } : {}),
    ...(edgeConditioningReport ? { edgeConditioning: edgeConditioningReport } : {}),
    metrics: {
      ...preview.metrics,
      source_sheet: ingested.validation.metrics,
      ...(styleCorrectionReport ? { style_correction: styleCorrectionReport } : {}),
      ...(edgeConditioningReport ? { edge_conditioning: edgeConditioningReport } : {}),
    },
    files: {
      ...(tilesetPng ? { tilesetPng } : {}),
    },
  }
}
