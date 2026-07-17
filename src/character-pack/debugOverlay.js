import sharp from 'sharp'

import { getAnimationFrameIndexes } from './profile.js'

function svgBuffer(svg) {
  return Buffer.from(svg)
}

function line(x1, y1, x2, y2, color, width = 1, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`
}

function rect(x, y, w, h, color, width = 1, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`
}

function circle(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function drawCellGuides(profile, frames = []) {
  const parts = []
  for (let col = 0; col <= profile.grid.columns; col++) {
    const x = col * profile.frame.w
    parts.push(line(x, 0, x, profile.sheet.h, '#26a69a', 1, 'opacity="0.55"'))
  }
  for (let row = 0; row <= profile.grid.rows; row++) {
    const y = row * profile.frame.h
    parts.push(line(0, y, profile.sheet.w, y, '#26a69a', 1, 'opacity="0.55"'))
  }

  for (let row = 0; row < profile.grid.rows; row++) {
    const y = row * profile.frame.h
    parts.push(line(0, y + profile.baselineY, profile.sheet.w, y + profile.baselineY, '#2772db', 1, 'opacity="0.65"'))
  }

  for (const frame of frames) {
    const col = frame.index % profile.grid.columns
    const row = Math.floor(frame.index / profile.grid.columns)
    const ox = col * profile.frame.w
    const oy = row * profile.frame.h
    const bbox = frame.normalized_bbox
    if (bbox) parts.push(rect(ox + bbox.x, oy + bbox.y, bbox.w, bbox.h, '#ff3b5f', 1.5))
    parts.push(circle(ox + profile.anchor.x, oy + profile.anchor.y, 2.4, '#37d65a'))
  }
  return parts.join('\n')
}

function fallbackOverlay({ width, height, title = 'debug_overlay' }) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0)"/>
    <text x="12" y="24" font-size="16" fill="#ff3366">${title}</text>
  </svg>`
}

export async function renderDebugOverlayPng({ profile, frames, baseSheet = null, width, height, title = 'debug_overlay' }) {
  if (!profile) return sharp(svgBuffer(fallbackOverlay({ width, height, title }))).png().toBuffer()
  const svg = `<svg width="${profile.sheet.w}" height="${profile.sheet.h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0)"/>
    ${drawCellGuides(profile, frames)}
  </svg>`
  const overlay = sharp(svgBuffer(svg)).png().toBuffer()
  if (!baseSheet) return overlay
  return sharp(baseSheet).composite([{ input: await overlay }]).png().toBuffer()
}

function drawSourceLayoutGuides({ regions = [], grid = null, width, height }) {
  const parts = []
  if (grid?.columns?.length && grid?.rows?.length) {
    for (const column of grid.columns) parts.push(line(column.x, 0, column.x, height, '#26a69a', 2, 'opacity="0.72"'))
    for (const row of grid.rows) parts.push(line(0, row.y, width, row.y, '#26a69a', 2, 'opacity="0.72"'))
    const lastColumn = grid.columns.at(-1)
    const lastRow = grid.rows.at(-1)
    if (lastColumn) parts.push(line(lastColumn.x + lastColumn.w, 0, lastColumn.x + lastColumn.w, height, '#26a69a', 2, 'opacity="0.72"'))
    if (lastRow) parts.push(line(0, lastRow.y + lastRow.h, width, lastRow.y + lastRow.h, '#26a69a', 2, 'opacity="0.72"'))
  }

  regions.forEach((region, index) => {
    const color = index % 2 === 0 ? '#ff3b5f' : '#37d65a'
    const label = escapeXml(region.display_label ?? region.label ?? region.key ?? index)
    const fontSize = Math.max(5, Math.min(13, Math.round(Math.min(region.w, region.h) * 0.18)))
    parts.push(`<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="${color}" opacity="0.08" stroke="${color}" stroke-width="2"/>`)
    parts.push(`<text x="${region.x + 2}" y="${region.y + fontSize + 1}" font-size="${fontSize}" fill="${color}" font-family="monospace" font-weight="700">${label}</text>`)
  })
  return parts.join('\n')
}

export async function renderSourceLayoutOverlayPng({ sourcePng = null, width, height, regions = [], grid = null, title = '' }) {
  const titleText = title ? `<text x="12" y="22" font-size="16" fill="#ff3b5f" font-family="monospace" font-weight="700">${escapeXml(title)}</text>` : ''
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0)"/>
    ${titleText}
    ${drawSourceLayoutGuides({ regions, grid, width, height })}
  </svg>`
  const overlay = await sharp(svgBuffer(svg)).png().toBuffer()
  if (!sourcePng) return overlay
  return sharp(sourcePng).composite([{ input: overlay }]).png().toBuffer()
}

function tintFrame(frame, color) {
  const data = new Uint8ClampedArray(frame.image.data.length)
  for (let i = 0; i < frame.image.data.length; i += 4) {
    const alpha = frame.image.data[i + 3]
    if (!alpha) continue
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = Math.min(150, alpha)
  }
  return sharp(Buffer.from(data), { raw: { width: frame.image.width, height: frame.image.height, channels: 4 } }).png().toBuffer()
}

export async function renderOnionSkinOverlayPng({ profile, frames }) {
  const colors = [
    [255, 54, 84],
    [255, 157, 46],
    [58, 214, 98],
    [67, 164, 255],
  ]
  const composites = []
  const walkAnimations = profile.animations.filter((animation) => animation.name.startsWith('walk_'))
  for (const animation of walkAnimations) {
    const indexes = getAnimationFrameIndexes(animation.name, profile)
    const left = animation.startCol * profile.frame.w
    const top = animation.row * profile.frame.h
    for (let i = 0; i < indexes.length; i++) {
      const frame = frames[indexes[i]]
      if (!frame) continue
      composites.push({ input: await tintFrame(frame, colors[i % colors.length]), left, top })
    }
  }
  const guideSvg = `<svg width="${profile.sheet.w}" height="${profile.sheet.h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(0,0,0,0)"/>
    ${drawCellGuides(profile, frames.filter((frame) => profile.animations.some((animation) => animation.name.startsWith('walk_') && frame.index >= animation.row * profile.grid.columns + animation.startCol && frame.index < animation.row * profile.grid.columns + animation.startCol + animation.count)))}
  </svg>`
  composites.push({ input: svgBuffer(guideSvg), left: 0, top: 0 })
  return sharp({
    create: {
      width: profile.sheet.w,
      height: profile.sheet.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}
