import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../src/character-pack/profile.js'

const CELL = 32
const SHEET = CELL * 8

const WHITE = [255, 255, 255, 255]
const OUTLINE = [45, 50, 58, 255]
const FILL = [128, 140, 154, 255]
const SHADE = [88, 98, 112, 255]
const LIGHT = [178, 186, 196, 255]

function offset(width, x, y) {
  return (y * width + x) * 4
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const i = offset(image.width, x, y)
  image.data[i] = color[0]
  image.data[i + 1] = color[1]
  image.data[i + 2] = color[2]
  image.data[i + 3] = color[3]
}

function rect(image, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPixel(image, xx, yy, color)
  }
}

function block(image, x, y, w, h, color = FILL) {
  rect(image, x - 1, y - 1, w + 2, h + 2, OUTLINE)
  rect(image, x, y, w, h, color)
}

function drawFront(image, ox, oy, frame, action) {
  const bob = action.startsWith('walk') && frame % 2 ? 1 : 0
  const cx = ox + 16
  const top = oy + 6 + bob
  block(image, cx - 4, top, 8, 7, LIGHT)
  block(image, cx - 5, top + 8, 10, 10, FILL)
  rect(image, cx - 2, top + 3, 1, 1, OUTLINE)
  rect(image, cx + 2, top + 3, 1, 1, OUTLINE)

  const swing = frame % 2 === 0 ? -1 : 1
  block(image, cx - 8, top + 10 + Math.max(0, swing), 3, 7, SHADE)
  block(image, cx + 5, top + 10 + Math.max(0, -swing), 3, 7, SHADE)

  const leftLegH = frame % 2 === 0 ? 5 : 4
  const rightLegH = frame % 2 === 0 ? 4 : 5
  block(image, cx - 4, oy + 23, 3, leftLegH, SHADE)
  block(image, cx + 1, oy + 23, 3, rightLegH, SHADE)

  if (action === 'happy') {
    block(image, cx - 10, oy + 8, 3, 7, SHADE)
    block(image, cx + 7, oy + 8, 3, 7, SHADE)
  }
  if (action === 'talk') block(image, cx + 6, oy + 11, 3, 5, LIGHT)
}

function drawBack(image, ox, oy, frame, action) {
  const bob = action.startsWith('walk') && frame % 2 ? 1 : 0
  const cx = ox + 16
  const top = oy + 5 + bob
  block(image, cx - 4, top, 8, 8, FILL)
  block(image, cx - 5, top + 9, 10, 11, SHADE)
  block(image, cx - 8, top + 11 + (frame % 2), 3, 7, FILL)
  block(image, cx + 5, top + 11 + ((frame + 1) % 2), 3, 7, FILL)
  block(image, cx - 4, oy + 23, 3, frame % 2 === 0 ? 5 : 4, OUTLINE)
  block(image, cx + 1, oy + 23, 3, frame % 2 === 0 ? 4 : 5, OUTLINE)
}

function drawSide(image, ox, oy, frame, direction, action) {
  const bob = action.startsWith('walk') && frame % 2 ? 1 : 0
  const dir = direction === 'left' ? -1 : 1
  const cx = ox + 16
  const top = oy + 6 + bob
  block(image, cx - 4, top, 8, 7, LIGHT)
  block(image, cx - 4, top + 8, 9, 10, FILL)
  rect(image, cx + dir * 3, top + 3, 1, 1, OUTLINE)
  block(image, cx + dir * 5, top + 11, 3, 7, SHADE)
  block(image, cx - dir * 7, top + 12, 3, 6, SHADE)
  block(image, cx - 3 - (frame % 2), oy + 23, 3, 5, SHADE)
  block(image, cx + 1 + (frame % 2), oy + 23, 3, 4, SHADE)
}

function drawAttack(image, ox, oy, frame, direction) {
  if (direction === 'up') drawBack(image, ox, oy, frame, 'attack_up')
  else if (direction === 'left' || direction === 'right') drawSide(image, ox, oy, frame, direction, `attack_${direction}`)
  else drawFront(image, ox, oy, frame, 'attack_down')

  const cx = ox + 16
  const phase = Math.min(frame, 2)
  if (direction === 'left') block(image, cx - 12, oy + 15 - phase, 5, 3, LIGHT)
  else if (direction === 'right') block(image, cx + 7, oy + 15 - phase, 5, 3, LIGHT)
  else if (direction === 'up') block(image, cx + 4, oy + 8 - phase, 3, 5, LIGHT)
  else block(image, cx - 2, oy + 21 + phase, 4, 5, LIGHT)
}

function drawHurt(image, ox, oy, frame) {
  const lean = frame % 2 === 0 ? -2 : 2
  drawFront(image, ox + lean, oy + 1, frame, 'hurt')
  block(image, ox + 16 - lean, oy + 20, 5, 3, SHADE)
}

function drawSit(image, ox, oy, frame) {
  const cx = ox + 16
  block(image, cx - 4, oy + 8, 8, 7, LIGHT)
  block(image, cx - 5, oy + 16, 10, 7, FILL)
  block(image, cx - 7 + (frame % 2), oy + 23, 6, 3, SHADE)
  block(image, cx + 1 - (frame % 2), oy + 23, 6, 3, SHADE)
}

function directionForAnimation(name) {
  if (name.endsWith('_up')) return 'up'
  if (name.endsWith('_left')) return 'left'
  if (name.endsWith('_right')) return 'right'
  return 'down'
}

function drawPose(image, animation, frameIndex) {
  const ox = (animation.startCol + frameIndex) * CELL
  const oy = animation.row * CELL
  const name = animation.name
  const direction = directionForAnimation(name)

  if (name.startsWith('attack')) return drawAttack(image, ox, oy, frameIndex, direction)
  if (name === 'hurt') return drawHurt(image, ox, oy, frameIndex)
  if (name === 'happy') return drawFront(image, ox, oy, frameIndex, 'happy')
  if (name === 'sit') return drawSit(image, ox, oy, frameIndex)
  if (name === 'talk') return drawFront(image, ox, oy, frameIndex, 'talk')
  if (direction === 'up') return drawBack(image, ox, oy, frameIndex, name)
  if (direction === 'left' || direction === 'right') return drawSide(image, ox, oy, frameIndex, direction, name)
  return drawFront(image, ox, oy, frameIndex, name)
}

async function main() {
  const image = {
    width: SHEET,
    height: SHEET,
    data: new Uint8ClampedArray(SHEET * SHEET * 4),
  }
  for (let y = 0; y < SHEET; y++) {
    for (let x = 0; x < SHEET; x++) setPixel(image, x, y, WHITE)
  }

  for (const animation of TOPDOWN_RPG_V0.animations) {
    for (let frame = 0; frame < animation.count; frame++) drawPose(image, animation, frame)
  }

  const buffer = await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer()

  await writeFile(path.resolve('templates/motion_template_ocha_8x8.png'), buffer)
}

await main()
