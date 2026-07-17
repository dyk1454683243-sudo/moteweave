import sharp from 'sharp'

function svgBuffer(svg) {
  return Buffer.from(svg)
}

function rect({ x, y, w, h }, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`
}

function line({ x1, y1, x2, y2 }, stroke, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" ${extra}/>`
}

function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}

async function compositeOverlay(basePng, overlaySvg) {
  return sharp(basePng)
    .composite([{ input: svgBuffer(overlaySvg), blend: 'over' }])
    .png()
    .toBuffer()
}

export async function renderGridOverlayPng(plan, strictAtlasPng) {
  const { width, height } = plan.atlas.strict_atlas_size
  const [cellW, cellH] = plan.atlas.tile_cell_size
  const occupied = plan.tiles
    .map((tile) => rect(tile.cell, 'rgba(60, 180, 120, 0.12)', 'stroke="#4ecf88" stroke-width="1"'))
    .join('')
  const lines = []
  for (let col = 0; col <= plan.atlas.grid.columns; col += 1) {
    const x = col * cellW
    lines.push(line({ x1: x, y1: 0, x2: x, y2: height }, '#46a0ff66', 'stroke-width="1"'))
  }
  for (let row = 0; row <= plan.atlas.grid.rows; row += 1) {
    const y = row * cellH
    lines.push(line({ x1: 0, y1: y, x2: width, y2: y }, '#46a0ff66', 'stroke-width="1"'))
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    occupied,
    ...lines,
    '</svg>',
  ].join('')
  return compositeOverlay(strictAtlasPng, svg)
}

export async function renderCollisionOverlayPng(plan, strictAtlasPng) {
  const { width, height } = plan.atlas.strict_atlas_size
  const overlays = plan.tiles
    .filter((tile) => tile.transition.tile_class !== 'empty')
    .map((tile) => {
      const collision = {
        x: tile.cell.x + tile.collision.x,
        y: tile.cell.y + tile.collision.y,
        w: tile.collision.w,
        h: tile.collision.h,
      }
      const pivot = {
        x: tile.cell.x + tile.pivot.x,
        y: tile.cell.y + tile.pivot.y,
      }
      return [
        rect(collision, 'rgba(80, 180, 255, 0.18)', 'stroke="#50b4ff" stroke-width="1"'),
        line({ x1: pivot.x - 3, y1: pivot.y, x2: pivot.x + 3, y2: pivot.y }, '#ff3355', 'stroke-width="1"'),
        line({ x1: pivot.x, y1: pivot.y - 3, x2: pivot.x, y2: pivot.y + 3 }, '#ff3355', 'stroke-width="1"'),
      ].join('')
    })
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    ...overlays,
    '</svg>',
  ].join('')
  return compositeOverlay(strictAtlasPng, svg)
}

export async function renderRandomMapPreviewPng(plan, strictAtlasPng, { columns = 8, rows = 6, seed = plan.material_profile.seed } = {}) {
  const [logicalW, logicalH] = plan.projection.logical_tile_size
  const [spriteW, spriteH] = plan.projection.sprite_cell_size
  const width = columns * logicalW + spriteW * 2
  const height = rows * logicalH + spriteH + 16
  const base = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#202426ff',
    },
  })
    .png()
    .toBuffer()

  const nonEmptyTiles = plan.tiles.filter((tile) => tile.transition.tile_class !== 'empty')
  const next = lcg(seed)
  const tileImages = new Map()
  for (const tile of plan.tiles) {
    tileImages.set(
      tile.id,
      await sharp(strictAtlasPng)
        .extract({ left: tile.cell.x, top: tile.cell.y, width: tile.cell.w, height: tile.cell.h })
        .png()
        .toBuffer()
    )
  }

  const composites = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const useEmpty = (row + col) % 11 === 0
      const tile = useEmpty ? plan.tiles[0] : nonEmptyTiles[next() % nonEmptyTiles.length]
      if (tile.transition.tile_class === 'empty') continue
      const anchorX = spriteW + col * logicalW + logicalW / 2
      const anchorY = spriteH + row * logicalH + logicalH
      composites.push({
        input: tileImages.get(tile.id),
        left: Math.round(anchorX - tile.pivot.x),
        top: Math.round(anchorY - tile.pivot.y),
      })
    }
  }

  return sharp(base).composite(composites).png().toBuffer()
}

export async function renderRuleMapPreviewPng(plan, strictAtlasPng, map) {
  const [logicalW, logicalH] = plan.projection.logical_tile_size
  const [spriteW, spriteH] = plan.projection.sprite_cell_size
  const width = map.width * logicalW + spriteW * 2
  const height = map.height * logicalH + spriteH + 16
  const base = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#202426ff',
    },
  })
    .png()
    .toBuffer()

  const tileImages = new Map()
  const composites = []
  for (const cell of map.cells) {
    if (cell.tile_class === 'empty') continue
    let tileImage = tileImages.get(cell.atlas_tile_id)
    if (!tileImage) {
      tileImage = await sharp(strictAtlasPng)
        .extract({ left: cell.source_rect.x, top: cell.source_rect.y, width: cell.source_rect.w, height: cell.source_rect.h })
        .png()
        .toBuffer()
      tileImages.set(cell.atlas_tile_id, tileImage)
    }
    composites.push({
      input: tileImage,
      left: spriteW + cell.sprite_px.x,
      top: spriteH + cell.sprite_px.y,
    })
  }

  return sharp(base).composite(composites).png().toBuffer()
}
