#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'

export const WEBSITE_OG_PATH = 'website/og.png'
export const WEBSITE_OG_WIDTH = 1200
export const WEBSITE_OG_HEIGHT = 630

const FONT = Object.freeze({
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  '/': [0x01, 0x02, 0x04, 0x08, 0x10, 0, 0],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0e],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x0a, 0x04, 0x04, 0x04, 0x0a, 0x11],
  Y: [0x11, 0x0a, 0x04, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
})

const COLORS = Object.freeze({
  background: [8, 11, 9, 255],
  panel: [16, 20, 17, 255],
  panelRaised: [23, 29, 25, 255],
  grid: [19, 29, 23, 255],
  line: [52, 70, 58, 255],
  lineStrong: [86, 118, 98, 255],
  paper: [237, 247, 239, 255],
  muted: [158, 171, 161, 255],
  mint: [155, 248, 193, 255],
  mintStrong: [84, 229, 154, 255],
  mintDeep: [22, 63, 43, 255],
  amber: [255, 200, 117, 255],
  amberDeep: [70, 52, 27, 255],
})

function createImage() {
  const data = new Uint8ClampedArray(WEBSITE_OG_WIDTH * WEBSITE_OG_HEIGHT * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = COLORS.background[0]
    data[offset + 1] = COLORS.background[1]
    data[offset + 2] = COLORS.background[2]
    data[offset + 3] = COLORS.background[3]
  }
  return { width: WEBSITE_OG_WIDTH, height: WEBSITE_OG_HEIGHT, data }
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const offset = (y * image.width + x) * 4
  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
  image.data[offset + 3] = color[3]
}

function fillRect(image, x, y, width, height, color) {
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(image.width, Math.ceil(x + width))
  const endY = Math.min(image.height, Math.ceil(y + height))
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) setPixel(image, px, py, color)
  }
}

function strokeRect(image, x, y, width, height, thickness, color) {
  fillRect(image, x, y, width, thickness, color)
  fillRect(image, x, y + height - thickness, width, thickness, color)
  fillRect(image, x, y, thickness, height, color)
  fillRect(image, x + width - thickness, y, thickness, height, color)
}

function measureText(text, scale, tracking = scale) {
  if (!text.length) return 0
  return text.length * 5 * scale + (text.length - 1) * tracking
}

function drawText(image, text, x, y, scale, color, tracking = scale) {
  const normalized = String(text).toUpperCase()
  let cursor = x
  for (const character of normalized) {
    const rows = FONT[character]
    if (!rows) throw new Error(`unsupported website OG glyph: ${character}`)
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if ((rows[row] & (1 << (4 - column))) === 0) continue
        fillRect(image, cursor + column * scale, y + row * scale, scale, scale, color)
      }
    }
    cursor += 5 * scale + tracking
  }
  return cursor - tracking
}

function drawGrid(image) {
  for (let x = 0; x < image.width; x += 24) fillRect(image, x, 0, 1, image.height, COLORS.grid)
  for (let y = 0; y < image.height; y += 24) fillRect(image, 0, y, image.width, 1, COLORS.grid)
}

function drawCorner(image, x, y, xDirection, yDirection) {
  const horizontalX = xDirection > 0 ? x : x - 34
  const horizontalY = yDirection > 0 ? y : y - 3
  const verticalX = xDirection > 0 ? x : x - 3
  const verticalY = yDirection > 0 ? y : y - 34
  fillRect(image, horizontalX, horizontalY, 34, 3, COLORS.mintStrong)
  fillRect(image, verticalX, verticalY, 3, 34, COLORS.mintStrong)
}

function drawWeaveMark(image, x, y) {
  const cell = 18
  const gap = 5
  const step = cell + gap
  const size = 8
  fillRect(image, x - 28, y + 18, 8, 8, COLORS.mint)
  fillRect(image, x - 10, y + 70, 5, 5, COLORS.amber)
  fillRect(image, x + 12, y - 18, 6, 6, COLORS.muted)
  fillRect(image, x + 196, y + 26, 5, 5, COLORS.mintStrong)
  fillRect(image, x + 214, y + 138, 8, 8, COLORS.amber)

  strokeRect(image, x - 12, y - 12, size * step + 19, size * step + 19, 2, COLORS.line)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const horizontalRibbon = row === 1 || row === 4 || row === 6
      const verticalRibbon = column === 1 || column === 4 || column === 6
      let color = COLORS.panelRaised
      if (horizontalRibbon) color = (column + row) % 2 === 0 ? COLORS.mint : COLORS.mintDeep
      if (verticalRibbon) color = (column + row) % 2 === 0 ? COLORS.paper : COLORS.lineStrong
      if (horizontalRibbon && verticalRibbon) {
        color = (row + column) % 4 === 0 ? COLORS.amber : COLORS.mintStrong
      }
      fillRect(image, x + column * step, y + row * step, cell, cell, color)
    }
  }
}

function drawSourceIcon(image, x, y) {
  const motes = [
    [0, 10, COLORS.mint],
    [22, 0, COLORS.muted],
    [39, 18, COLORS.amber],
    [16, 34, COLORS.mintStrong],
    [50, 42, COLORS.lineStrong],
    [6, 53, COLORS.paper],
  ]
  for (const [dx, dy, color] of motes) fillRect(image, x + dx, y + dy, 10, 10, color)
}

function drawRefineIcon(image, x, y) {
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const color = row === column || row + column === 3 ? COLORS.mint : COLORS.panelRaised
      fillRect(image, x + column * 16, y + row * 16, 12, 12, color)
    }
  }
}

function drawReviewIcon(image, x, y) {
  strokeRect(image, x, y, 66, 66, 3, COLORS.lineStrong)
  fillRect(image, x + 14, y + 34, 10, 10, COLORS.mint)
  fillRect(image, x + 22, y + 42, 10, 10, COLORS.mint)
  fillRect(image, x + 30, y + 34, 10, 10, COLORS.mint)
  fillRect(image, x + 38, y + 26, 10, 10, COLORS.mint)
  fillRect(image, x + 46, y + 18, 10, 10, COLORS.mint)
}

function drawExportIcon(image, x, y) {
  strokeRect(image, x + 8, y + 20, 52, 42, 3, COLORS.lineStrong)
  fillRect(image, x + 18, y + 8, 32, 20, COLORS.amberDeep)
  strokeRect(image, x + 18, y + 8, 32, 20, 3, COLORS.amber)
  fillRect(image, x + 31, y, 6, 22, COLORS.amber)
  fillRect(image, x + 23, y + 8, 22, 6, COLORS.amber)
}

function drawStepCard(image, x, number, label, icon) {
  const y = 438
  const width = 245
  const height = 122
  fillRect(image, x, y, width, height, COLORS.panel)
  strokeRect(image, x, y, width, height, 2, COLORS.line)
  fillRect(image, x, y, 7, height, number === '03' ? COLORS.mintStrong : COLORS.mintDeep)
  drawText(image, number, x + 25, y + 21, 3, COLORS.amber, 3)
  drawText(image, label, x + 25, y + 69, 3, COLORS.paper, 3)
  icon(image, x + 158, y + 29)
}

async function readReleaseBrand(rootDir) {
  const config = JSON.parse(await readFile(path.join(rootDir, 'configs/public-release.json'), 'utf8'))
  if (config.brand?.status !== 'approved') throw new Error('website OG requires an approved public brand')
  return {
    displayName: String(config.brand.display_name || '').toUpperCase(),
    version: String(config.release_version || '').toUpperCase(),
  }
}

export async function buildWebsiteOgRgba({ rootDir = process.cwd() } = {}) {
  const { displayName, version } = await readReleaseBrand(rootDir)
  const image = createImage()
  drawGrid(image)
  fillRect(image, 0, 0, image.width, 12, COLORS.mintDeep)
  fillRect(image, 42, 42, 710, 338, COLORS.panel)
  strokeRect(image, 42, 42, 710, 338, 2, COLORS.line)
  fillRect(image, 776, 42, 382, 338, COLORS.panel)
  strokeRect(image, 776, 42, 382, 338, 2, COLORS.line)
  drawCorner(image, 22, 22, 1, 1)
  drawCorner(image, image.width - 22, 22, -1, 1)
  drawCorner(image, 22, image.height - 22, 1, -1)
  drawCorner(image, image.width - 22, image.height - 22, -1, -1)

  const badge = `SOURCE PREVIEW ${version}`
  fillRect(image, 70, 72, measureText(badge, 2, 2) + 28, 34, COLORS.mintDeep)
  drawText(image, badge, 84, 82, 2, COLORS.mint, 2)

  const brandScale = 11
  const first = displayName.slice(0, 4)
  const second = displayName.slice(4)
  const brandY = 145
  const firstEnd = drawText(image, first, 70, brandY, brandScale, COLORS.paper, brandScale)
  drawText(image, second, firstEnd + brandScale * 2, brandY, brandScale, COLORS.mint, brandScale)

  drawText(image, 'WEAVE PIXELS INTO GAME-READY ASSETS', 72, 250, 3, COLORS.paper, 3)
  drawText(image, 'LOCAL-FIRST / EVIDENCE BEFORE EXPORT', 72, 304, 3, COLORS.mint, 3)
  fillRect(image, 72, 354, 620, 3, COLORS.lineStrong)
  fillRect(image, 72, 354, 188, 3, COLORS.mintStrong)

  drawWeaveMark(image, 867, 100)
  drawText(image, 'MOTES', 824, 316, 2, COLORS.muted, 2)
  fillRect(image, 899, 322, 62, 2, COLORS.lineStrong)
  fillRect(image, 954, 316, 8, 14, COLORS.mint)
  drawText(image, 'WEAVE', 978, 316, 2, COLORS.paper, 2)

  drawStepCard(image, 42, '01', 'SOURCE', drawSourceIcon)
  drawStepCard(image, 303, '02', 'REFINE', drawRefineIcon)
  drawStepCard(image, 564, '03', 'REVIEW', drawReviewIcon)
  drawStepCard(image, 825, '04', 'EXPORT', drawExportIcon)
  drawText(image, 'PROVIDER-FREE RELEASE CHECK', 42, 590, 2, COLORS.muted, 2)
  drawText(image, 'MOTEWEAVE.PAGES.DEV', 884, 590, 2, COLORS.mint, 2)
  return image
}

export async function buildWebsiteOgPng({ rootDir = process.cwd() } = {}) {
  const image = await buildWebsiteOgRgba({ rootDir })
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer()
}

export async function writeWebsiteOg({ rootDir = process.cwd() } = {}) {
  const outputPath = path.join(rootDir, WEBSITE_OG_PATH)
  await writeFile(outputPath, await buildWebsiteOgPng({ rootDir }))
  return outputPath
}

export async function checkWebsiteOg({ rootDir = process.cwd() } = {}) {
  const expected = await buildWebsiteOgRgba({ rootDir })
  const actual = await sharp(path.join(rootDir, WEBSITE_OG_PATH))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    actual.info.width !== expected.width
    || actual.info.height !== expected.height
    || actual.info.channels !== 4
    || !actual.data.equals(Buffer.from(expected.data))
  ) {
    throw new Error(`${WEBSITE_OG_PATH} does not match the deterministic generator`)
  }
  return { path: WEBSITE_OG_PATH, width: expected.width, height: expected.height }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify(await checkWebsiteOg(), null, 2))
  } else {
    console.log(await writeWebsiteOg())
  }
}
