#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'

import {
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
} from '../src/character-pack/fixedRegionGeometry.js'

const TEMPLATE_PATH = 'templates/fixed_region_motion_template_v1.png'
const SAMPLE_PATH = 'test/fixtures/character-pack/local-image-golden/ocad-sheet/fixed_region_sample_hero.png'

const TEMPLATE_PALETTE = Object.freeze({
  outline: [38, 44, 52, 255],
  hair: [178, 186, 196, 255],
  skin: [178, 186, 196, 255],
  body: [126, 139, 154, 255],
  accent: [91, 104, 119, 255],
  legs: [73, 84, 98, 255],
})

const SAMPLE_PALETTE = Object.freeze({
  outline: [24, 28, 36, 255],
  hair: [220, 226, 235, 255],
  skin: [224, 169, 132, 255],
  body: [43, 64, 91, 255],
  accent: [162, 68, 74, 255],
  legs: [35, 43, 58, 255],
})

function createImage(background) {
  const { w, h } = FIXED_REGION_SOURCE_SHEET
  const data = new Uint8ClampedArray(w * h * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = background[0]
    data[offset + 1] = background[1]
    data[offset + 2] = background[2]
    data[offset + 3] = background[3]
  }
  return { width: w, height: h, data }
}

function setPixel(image, region, x, y, color) {
  if (x < 1 || y < 1 || x >= region.w - 1 || y >= region.h - 1) return
  const px = region.x + x
  const py = region.y + y
  const offset = (py * image.width + px) * 4
  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
  image.data[offset + 3] = color[3]
}

function rect(image, region, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(image, region, xx, yy, color)
    }
  }
}

function block(image, region, x, y, width, height, fill, outline) {
  rect(image, region, x - 1, y - 1, width + 2, height + 2, outline)
  rect(image, region, x, y, width, height, fill)
}

function actionAndPhase(regionKey) {
  const match = String(regionKey).match(/^(.+?)(\d+)$/)
  return {
    action: match ? match[1] : String(regionKey),
    phase: match ? Number(match[2]) : 0,
  }
}

function actionDirection(action) {
  if (action.includes('up') || action === 'climb') return 'up'
  if (action.endsWith('L')) return 'left'
  return 'down'
}

function drawFace(image, region, cx, top, direction, palette, detailed) {
  const headX = cx - 3
  block(image, region, headX, top, 7, 7, palette.skin, palette.outline)
  rect(image, region, headX - 1, top - 1, 9, 3, palette.hair)
  if (!detailed || direction === 'up') return
  const eyeX = direction === 'left' ? headX + 1 : headX + 2
  setPixel(image, region, eyeX, top + 3, palette.outline)
  if (direction === 'down') setPixel(image, region, headX + 5, top + 3, palette.outline)
}

function drawStanding(image, region, action, phase, palette, detailed) {
  const direction = actionDirection(action)
  const fast = action.startsWith('run')
  const moving = fast || action.startsWith('walk')
  const cycle = [0, 1, 0, -1, 0, 1, 0, -1][phase % 8]
  const jumpLift = action === 'jump' ? [3, 5][phase % 2] : 0
  const bob = moving ? cycle : 0
  const cx = Math.floor(region.w / 2) + (direction === 'left' ? 1 : 0)
  const footY = region.h - 3 - jumpLift
  const top = footY - 29 + bob

  drawFace(image, region, cx, top, direction, palette, detailed)
  block(image, region, cx - 4, top + 9, 9, 12, palette.body, palette.outline)
  rect(image, region, cx - 2, top + 11, 4, 7, palette.accent)

  let leftArmY = top + 11
  let rightArmY = top + 11
  let leftArmX = cx - 7
  let rightArmX = cx + 5
  if (moving) {
    const swing = phase % 2 === 0 ? -2 : 2
    leftArmY += Math.max(0, swing)
    rightArmY += Math.max(0, -swing)
  }
  if (action === 'climb') {
    leftArmY = top + 2 + (phase % 2)
    rightArmY = top + 1 + ((phase + 1) % 2)
  }
  if (action === 'item') {
    leftArmY = top + 5
    rightArmY = top + 5
  }
  if (action === 'defence') {
    leftArmX = cx - 6
    rightArmX = cx + 3
    leftArmY = top + 14
    rightArmY = top + 14
  }

  block(image, region, leftArmX, leftArmY, 3, action === 'climb' ? 8 : 9, palette.accent, palette.outline)
  block(image, region, rightArmX, rightArmY, 3, action === 'climb' ? 8 : 9, palette.accent, palette.outline)

  const stride = moving ? (phase % 2 === 0 ? 2 : -2) * (fast ? 1 : 0.5) : 0
  const leftLegX = Math.round(cx - 4 - stride)
  const rightLegX = Math.round(cx + 1 + stride)
  block(image, region, leftLegX, top + 22, 3, 7, palette.legs, palette.outline)
  block(image, region, rightLegX, top + 22, 3, 7, palette.legs, palette.outline)

  if (action === 'attractL') {
    const reach = Math.min(12, 6 + phase)
    block(image, region, Math.max(2, cx - reach - 3), top + 12 - (phase % 3), reach, 3, palette.accent, palette.outline)
  }
}

function drawSitting(image, region, palette, detailed) {
  const cx = Math.floor(region.w / 2)
  const top = region.h - 27
  drawFace(image, region, cx, top, 'down', palette, detailed)
  block(image, region, cx - 4, top + 9, 9, 10, palette.body, palette.outline)
  block(image, region, cx - 7, top + 20, 7, 3, palette.legs, palette.outline)
  block(image, region, cx + 1, top + 20, 7, 3, palette.legs, palette.outline)
}

function drawFallen(image, region, palette, detailed) {
  const bodyWidth = Math.min(32, region.w - 15)
  const y = region.h - 10
  block(image, region, 6, y, bodyWidth, 6, palette.body, palette.outline)
  block(image, region, 6 + bodyWidth, y - 1, 7, 7, palette.skin, palette.outline)
  rect(image, region, 7, y + 1, Math.max(3, bodyWidth - 3), 2, palette.accent)
  if (detailed) rect(image, region, 6 + bodyWidth, y - 2, 8, 2, palette.hair)
}

function drawRegionSprite(image, regionKey, region, palette, detailed) {
  const { action, phase } = actionAndPhase(regionKey)
  if (action === 'die') {
    drawFallen(image, region, palette, detailed)
    return
  }
  if (action === 'sitdown') {
    drawSitting(image, region, palette, detailed)
    return
  }
  drawStanding(image, region, action, phase, palette, detailed)
}

async function encodePng(image) {
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer()
}

async function buildAsset({ background, palette, detailed }) {
  const image = createImage(background)
  for (const [regionKey, region] of Object.entries(FIXED_REGION_SOURCE_REGIONS)) {
    drawRegionSprite(image, regionKey, region, palette, detailed)
  }
  return encodePng(image)
}

export function buildFixedRegionMotionTemplate() {
  return buildAsset({
    background: [0, 0, 0, 0],
    palette: TEMPLATE_PALETTE,
    detailed: false,
  })
}

export function buildFixedRegionSampleHero() {
  return buildAsset({
    background: [255, 255, 255, 255],
    palette: SAMPLE_PALETTE,
    detailed: true,
  })
}

export async function writeFixedRegionMotionAssets({ rootDir = process.cwd() } = {}) {
  const templatePath = path.resolve(rootDir, TEMPLATE_PATH)
  const samplePath = path.resolve(rootDir, SAMPLE_PATH)
  await mkdir(path.dirname(templatePath), { recursive: true })
  await mkdir(path.dirname(samplePath), { recursive: true })
  await writeFile(templatePath, await buildFixedRegionMotionTemplate())
  await writeFile(samplePath, await buildFixedRegionSampleHero())
  return { templatePath, samplePath }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  await writeFixedRegionMotionAssets()
}
