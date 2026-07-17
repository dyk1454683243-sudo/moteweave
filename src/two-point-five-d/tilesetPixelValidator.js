import sharp from 'sharp'

function statusFor(blockingErrors, warnings) {
  if (blockingErrors.length) return 'fail'
  if (warnings.length) return 'warning'
  return 'pass'
}

function pixelIndex(x, y, width) {
  return (y * width + x) * 4
}

function rectFitsWithin(inner, outer) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

function layerFitsCell(layer, cell) {
  return layer.x >= 0 && layer.y >= 0 && layer.w > 0 && layer.h > 0 && layer.x + layer.w <= cell.w && layer.y + layer.h <= cell.h
}

function visibleBoundsInCell(data, imageWidth, cell) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  let visiblePixels = 0
  let semiTransparentPixels = 0

  for (let y = cell.y; y < cell.y + cell.h; y += 1) {
    for (let x = cell.x; x < cell.x + cell.w; x += 1) {
      const alpha = data[pixelIndex(x, y, imageWidth) + 3]
      if (!alpha) continue
      visiblePixels += 1
      if (alpha > 0 && alpha < 255) semiTransparentPixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (!visiblePixels) {
    return {
      visible_pixel_count: 0,
      semi_transparent_pixel_count: 0,
      absolute: null,
      relative: null,
    }
  }

  return {
    visible_pixel_count: visiblePixels,
    semi_transparent_pixel_count: semiTransparentPixels,
    absolute: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    relative: { x: minX - cell.x, y: minY - cell.y, w: maxX - minX + 1, h: maxY - minY + 1 },
  }
}

function suggestedFixesFor(blockingErrors, warnings) {
  const messages = []
  if (blockingErrors.includes('strict_atlas_size_mismatch')) messages.push('Regenerate the strict atlas from the contract strict_size before export.')
  if (blockingErrors.includes('atlas_cell_alignment_invalid')) messages.push('Use a strict atlas size divisible by atlas.tile_cell_size.')
  if (blockingErrors.includes('semi_transparent_pixels_disallowed')) messages.push('Apply alpha thresholding or render only hard alpha pixels before export.')
  if (blockingErrors.includes('visible_pixels_outside_rule_cells')) messages.push('Keep rendered material pixels inside the rule profile cells assigned by atlas_tile_id.')
  if (blockingErrors.includes('tile_visual_bounds_invalid')) messages.push('Reduce visual layer extents or increase sprite_cell_size so every tile fits inside its cell.')
  if (blockingErrors.includes('collision_bounds_invalid')) messages.push('Keep collision metadata inside the logical footprint instead of deriving it from visual art.')
  if (warnings.includes('palette_color_count_exceeds_max')) messages.push('Reduce procedural material colors or raise palette.max_colors intentionally.')
  return [...new Set(messages)]
}

export async function validateRenderedTilesetPng({ plan, strictAtlasPng }) {
  const contract = plan.validation.contract
  const expected = plan.atlas.strict_atlas_size
  const [cellW, cellH] = plan.atlas.tile_cell_size
  const image = await sharp(strictAtlasPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = image.info
  const blockingErrors = []
  const warnings = []
  const diagnostics = []

  const sizePass = width === expected.width && height === expected.height
  if (!sizePass) blockingErrors.push('strict_atlas_size_mismatch')
  diagnostics.push({
    check: 'strict_atlas_size',
    status: sizePass ? 'pass' : 'fail',
    expected,
    actual: { width, height },
  })

  const aligned = width % cellW === 0 && height % cellH === 0
  if (!aligned) blockingErrors.push('atlas_cell_alignment_invalid')
  diagnostics.push({
    check: 'atlas_cell_alignment',
    status: aligned ? 'pass' : 'fail',
    tile_cell_size: { width: cellW, height: cellH },
  })

  const tileByAtlasId = new Map(plan.tiles.map((tile) => [tile.atlas_tile_id, tile]))
  const occupiedTileIds = new Set(plan.tiles.filter((tile) => tile.transition.tile_class !== 'empty').map((tile) => tile.atlas_tile_id))
  const colorSet = new Set()
  let visiblePixels = 0
  let semiTransparentPixels = 0
  let outsideRuleCellPixels = 0
  const outsideRuleCellSamples = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = pixelIndex(x, y, width)
      const alpha = image.data[index + 3]
      if (!alpha) continue
      visiblePixels += 1
      if (alpha > 0 && alpha < 255) semiTransparentPixels += 1
      colorSet.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]},${alpha}`)

      const col = Math.floor(x / cellW)
      const row = Math.floor(y / cellH)
      const atlasTileId = row * plan.atlas.grid.columns + col
      if (!occupiedTileIds.has(atlasTileId)) {
        outsideRuleCellPixels += 1
        if (outsideRuleCellSamples.length < 8) outsideRuleCellSamples.push({ x, y, atlas_tile_id: atlasTileId })
      }
    }
  }

  const allowSemiTransparent = Boolean(contract.palette?.allow_semi_transparent_pixels)
  if (semiTransparentPixels && !allowSemiTransparent) blockingErrors.push('semi_transparent_pixels_disallowed')
  diagnostics.push({
    check: 'semi_transparent_pixels',
    status: semiTransparentPixels && !allowSemiTransparent ? 'fail' : 'pass',
    count: semiTransparentPixels,
    allow_semi_transparent_pixels: allowSemiTransparent,
  })

  if (outsideRuleCellPixels) blockingErrors.push('visible_pixels_outside_rule_cells')
  diagnostics.push({
    check: 'visible_pixels_outside_rule_cells',
    status: outsideRuleCellPixels ? 'fail' : 'pass',
    count: outsideRuleCellPixels,
    samples: outsideRuleCellSamples,
  })

  const visibleColorCount = colorSet.size
  const maxColors = contract.palette?.max_colors ?? 0
  if (maxColors > 0 && visibleColorCount > maxColors) warnings.push('palette_color_count_exceeds_max')
  diagnostics.push({
    check: 'palette_color_count',
    status: maxColors > 0 && visibleColorCount > maxColors ? 'warning' : 'pass',
    visible_color_count: visibleColorCount,
    max_colors: maxColors,
  })

  const perTileDiagnostics = plan.tiles.map((tile) => {
    const tileErrors = []
    const tileWarnings = []
    const bounds = visibleBoundsInCell(image.data, width, tile.cell)
    const expectedVisible = tile.transition.tile_class !== 'empty'
    if (expectedVisible && bounds.visible_pixel_count === 0) tileErrors.push('tile_has_no_visible_pixels')
    if (!expectedVisible && bounds.visible_pixel_count > 0) tileErrors.push('empty_tile_has_visible_pixels')
    if (bounds.semi_transparent_pixel_count && !allowSemiTransparent) tileErrors.push('tile_has_disallowed_semi_transparent_pixels')

    const layersFit = Object.values(tile.layers).every((layer) => layerFitsCell(layer, tile.cell))
    if (!layersFit) tileErrors.push('tile_visual_layer_exceeds_cell')

    const collisionFits = rectFitsWithin(tile.collision, tile.logical_footprint)
    if (!collisionFits) tileErrors.push('collision_outside_logical_footprint')

    return {
      id: tile.id,
      mask: tile.mask,
      atlas_tile_id: tile.atlas_tile_id,
      tile_class: tile.transition.tile_class,
      status: statusFor(tileErrors, tileWarnings),
      errors: tileErrors,
      warnings: tileWarnings,
      visible_bounds: bounds,
      collision_within_logical_footprint: collisionFits,
      visual_layers_within_cell: layersFit,
    }
  })

  if (perTileDiagnostics.some((tile) => tile.errors.some((error) => error.includes('visual') || error.includes('visible')))) {
    blockingErrors.push('tile_visual_bounds_invalid')
  }
  if (perTileDiagnostics.some((tile) => tile.errors.some((error) => error.includes('collision')))) {
    blockingErrors.push('collision_bounds_invalid')
  }
  diagnostics.push({
    check: 'per_tile_visual_bounds',
    status: blockingErrors.includes('tile_visual_bounds_invalid') ? 'fail' : 'pass',
    checked_tiles: perTileDiagnostics.length,
  })
  diagnostics.push({
    check: 'collision_bounds',
    status: blockingErrors.includes('collision_bounds_invalid') ? 'fail' : 'pass',
    checked_tiles: perTileDiagnostics.length,
  })

  return {
    status: statusFor(blockingErrors, warnings),
    blocking_errors: [...new Set(blockingErrors)],
    warnings: [...new Set(warnings)],
    metrics: {
      image_size: { width, height },
      channels,
      visible_pixel_count: visiblePixels,
      semi_transparent_pixel_count: semiTransparentPixels,
      outside_rule_cell_pixel_count: outsideRuleCellPixels,
      visible_color_count: visibleColorCount,
      checked_tile_count: perTileDiagnostics.length,
      failed_tile_count: perTileDiagnostics.filter((tile) => tile.status === 'fail').length,
      warning_tile_count: perTileDiagnostics.filter((tile) => tile.status === 'warning').length,
    },
    global_diagnostics: diagnostics,
    per_tile_diagnostics: perTileDiagnostics,
    suggested_fixes: suggestedFixesFor(blockingErrors, warnings),
  }
}

export function buildTwoPointFiveDValidationReport({ plan, pixelValidation }) {
  const contractValidation = plan.validation
  const blockingErrors = [...contractValidation.blocking_errors, ...pixelValidation.blocking_errors]
  const warnings = [...contractValidation.warnings, ...pixelValidation.warnings]
  return {
    schema_version: 1,
    mode: 'two_point_five_d_validation_report_v0',
    status: statusFor(blockingErrors, warnings),
    blocking_errors: [...new Set(blockingErrors)],
    warnings: [...new Set(warnings)],
    metrics: {
      ...contractValidation.metrics,
      pixel_validation: pixelValidation.metrics,
    },
    contract_validation: contractValidation,
    pixel_validation: pixelValidation,
    global_diagnostics: pixelValidation.global_diagnostics,
    per_tile_diagnostics: pixelValidation.per_tile_diagnostics,
    suggested_fixes: pixelValidation.suggested_fixes,
  }
}
