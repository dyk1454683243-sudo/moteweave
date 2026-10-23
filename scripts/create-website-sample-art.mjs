#!/usr/bin/env node
/**
 * Original pixel art for the public MoteWeave site.
 *
 * Draws a 32×32 field cartographer (not based on any existing character),
 * scales it nearest-neighbour into the 8×8 × 192px topdown_rpg_v0 sheet, and
 * writes a walk preview plus a small tile and prop set. No network. No randomness.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(rootDir, 'website', 'assets')

const N = 32
const CELL = 192
const SCALE = 6
const COLS = 8
const ROWS = 8

const INK = 1
const SKIN = 2
const SHADE = 3
const HAIR = 4
const TUNIC = 5
const TDARK = 6
const NAVY = 7
const NDARK = 8
const BOOT = 9
const SCARF = 10
const CREAM = 11

const PALETTE = [
  null,
  [26, 20, 18, 255],
  [240, 192, 154, 255],
  [201, 132, 98, 255],
  [107, 58, 38, 255],
  [47, 138, 98, 255],
  [29, 92, 66, 255],
  [49, 64, 95, 255],
  [30, 40, 60, 255],
  [107, 70, 50, 255],
  [224, 122, 66, 255],
  [243, 234, 216, 255],
]

function blank() {
  return new Uint8Array(N * N)
}

function put(buf, x, y, color) {
  if (!color || x < 0 || y < 0 || x >= N || y >= N) return
  buf[y * N + x] = color
}

function rect(buf, x, y, w, h, color) {
  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) put(buf, x + xx, y + yy, color)
  }
}

function flip(buf) {
  const out = blank()
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) out[y * N + (N - 1 - x)] = buf[y * N + x]
  }
  return out
}

function shift(buf, dx, dy) {
  const out = blank()
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const color = buf[y * N + x]
      if (color) put(out, x + dx, y + dy, color)
    }
  }
  return out
}

function outline(buf) {
  const out = buf.slice()
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (buf[y * N + x]) continue
      const touches = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const nx = x + dx
        const ny = y + dy
        return nx >= 0 && ny >= 0 && nx < N && ny < N && buf[ny * N + nx]
      })
      if (touches) out[y * N + x] = INK
    }
  }
  return out
}

function hashFrame(buf) {
  let hash = 2166136261
  for (const value of buf) {
    hash ^= value
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function drawEyes(g, x, y, pose) {
  if (pose.blink) {
    rect(g, x, y, 2, 1, INK)
    return
  }
  put(g, x, y, CREAM)
  put(g, x + 1, y, INK)
}

function drawFront(pose) {
  const g = blank()
  const y = 4 + (pose.bob || 0)
  rect(g, 11, y, 10, 2, HAIR)
  rect(g, 10, y + 1, 12, 3, HAIR)
  put(g, 19, y - 1, HAIR)
  put(g, 20, y - 2, HAIR)
  put(g, 12, y + 1, CREAM)
  put(g, 13, y + 1, SHADE)
  rect(g, 12, y + 4, 8, 6, SKIN)
  rect(g, 18, y + 6, 2, 3, SHADE)
  rect(g, 11, y + 4, 2, 3, HAIR)
  rect(g, 19, y + 4, 2, 2, HAIR)
  drawEyes(g, 13, y + 7, pose)
  drawEyes(g, 16, y + 7, pose)
  if (pose.talk) {
    rect(g, 14, y + 9, 3, 1, INK)
  } else if (pose.happy) {
    rect(g, 14, y + 9, 3, 1, INK)
    put(g, 14, y + 8, SHADE)
    put(g, 16, y + 8, SHADE)
  } else {
    put(g, 14, y + 9, INK)
    put(g, 15, y + 9, INK)
    put(g, 16, y + 9, SHADE)
  }
  rect(g, 12, y + 10, 8, 1, SCARF)
  rect(g, 19 + (pose.tail || 0), y + 10, 1, 3, SCARF)
  rect(g, 12, y + 11, 8, 6, TUNIC)
  rect(g, 18, y + 12, 2, 5, TDARK)
  rect(g, 14, y + 11, 3, 1, CREAM)
  put(g, 12, y + 12, CREAM)
  rect(g, 16, y + 14, 2, 2, BOOT)
  put(g, 16, y + 14, CREAM)
  if (pose.happy) {
    rect(g, 9, y + 7, 2, 5, SKIN)
    rect(g, 9, y + 11, 2, 1, SHADE)
    rect(g, 21, y + 7, 2, 5, SHADE)
    rect(g, 11, y + 11, 1, 2, SKIN)
    rect(g, 20, y + 11, 1, 2, SHADE)
  } else {
    const leftArm = pose.leftArm || 0
    const rightArm = pose.rightArm || 0
    rect(g, 10, y + 11 + leftArm, 2, 5, SKIN)
    rect(g, 10, y + 15 + leftArm, 2, 1, SHADE)
    rect(g, 20, y + 11 + rightArm, 2, 5, SHADE)
    if (pose.map) {
      const mapY = y + 14 + rightArm
      rect(g, 22, mapY, 4, 3, CREAM)
      put(g, 23, mapY + 1, SCARF)
      put(g, 24, mapY + 1, INK)
    }
  }
  if (pose.sit) {
    rect(g, 8, y + 17, 6, 2, NAVY)
    rect(g, 18, y + 17, 6, 2, NDARK)
    rect(g, 7, y + 18, 3, 2, BOOT)
    rect(g, 22, y + 18, 3, 2, BOOT)
  } else {
    const lx = 12 + (pose.leftLegX || 0)
    const rx = 17 + (pose.rightLegX || 0)
    rect(g, lx, y + 17 + (pose.leftLeg || 0), 3, 3, NAVY)
    rect(g, rx, y + 17 + (pose.rightLeg || 0), 3, 3, NDARK)
    rect(g, lx - 1, y + 20 + (pose.leftLeg || 0), 4, 2, BOOT)
    rect(g, rx, y + 20 + (pose.rightLeg || 0), 4, 2, BOOT)
  }
  return g
}

function drawBack(pose) {
  const g = blank()
  const y = 4 + (pose.bob || 0)
  rect(g, 10, y + 1, 12, 8, HAIR)
  rect(g, 9, y + 3, 14, 5, HAIR)
  put(g, 20, y, HAIR)
  put(g, 21, y - 1, HAIR)
  put(g, 11, y + 2, CREAM)
  put(g, 12, y + 2, SHADE)
  if (pose.blink) {
    put(g, 15, y + 4, SHADE)
    put(g, 16, y + 5, INK)
  }
  rect(g, 12, y + 8, 8, 1, SCARF)
  rect(g, 9 + (pose.tail || 0), y + 8, 1, 3, SCARF)
  rect(g, 12, y + 9, 8, 6, TUNIC)
  rect(g, 18, y + 10, 2, 5, TDARK)
  rect(g, 15, y + 10, 1, 5, TDARK)
  put(g, 12, y + 10, CREAM)
  rect(g, 16, y + 12, 2, 2, BOOT)
  put(g, 16, y + 12, CREAM)
  if (pose.happy) {
    rect(g, 8, y + 6, 3, 4, SHADE)
    rect(g, 21, y + 6, 3, 4, TDARK)
  } else {
    rect(g, 9, y + 11 + (pose.leftArm || 0), 3, 4, SHADE)
    rect(g, 20, y + 11 + (pose.rightArm || 0), 3, 4, TDARK)
    if (pose.map) {
      const mapY = y + 13 + (pose.rightArm || 0)
      rect(g, 23, mapY, 4, 3, CREAM)
      put(g, 24, mapY + 1, INK)
    }
  }
  if (pose.sit) {
    rect(g, 9, y + 15, 14, 2, NAVY)
    rect(g, 8, y + 16, 3, 2, BOOT)
    rect(g, 21, y + 16, 3, 2, BOOT)
  } else {
    const lx = 12 + (pose.leftLegX || 0)
    const rx = 17 + (pose.rightLegX || 0)
    rect(g, lx, y + 15 + (pose.leftLeg || 0), 3, 3, NAVY)
    rect(g, rx, y + 15 + (pose.rightLeg || 0), 3, 3, NDARK)
    rect(g, lx - 1, y + 18 + (pose.leftLeg || 0), 4, 2, BOOT)
    rect(g, rx, y + 18 + (pose.rightLeg || 0), 4, 2, BOOT)
  }
  return g
}

function drawSide(pose) {
  const g = blank()
  const y = 4 + (pose.bob || 0)
  rect(g, 13, y, 7, 2, HAIR)
  rect(g, 12, y + 1, 8, 3, HAIR)
  put(g, 14, y - 1, HAIR)
  put(g, 13, y + 1, CREAM)
  rect(g, 12, y + 4, 6, 6, SKIN)
  rect(g, 16, y + 6, 2, 3, SHADE)
  put(g, 11, y + 6, SKIN)
  put(g, 11, y + 7, SHADE)
  drawEyes(g, 13, y + 7, pose)
  put(g, 12, y + 9, pose.talk || pose.happy ? INK : SHADE)
  rect(g, 14, y + 10, 4, 1, SCARF)
  rect(g, 18 + (pose.tail || 0), y + 10, 1, 3, SCARF)
  rect(g, 14, y + 11, 5, 6, TUNIC)
  rect(g, 17, y + 12, 2, 5, TDARK)
  put(g, 14, y + 11, CREAM)
  if (pose.happy) {
    rect(g, 12, y + 7, 2, 4, SKIN)
    rect(g, 13, y + 11, 1, 2, SKIN)
  } else if (pose.map) {
    const arm = pose.arm || 0
    rect(g, 12, y + 12 + arm, 2, 4, SKIN)
    rect(g, 8, y + 14 + arm, 4, 3, CREAM)
    put(g, 9, y + 15 + arm, INK)
    put(g, 10, y + 15 + arm, SCARF)
  } else {
    const arm = pose.arm || 0
    rect(g, 13, y + 12 + arm, 2, 5, SKIN)
    rect(g, 13, y + 16 + arm, 2, 1, SHADE)
  }
  if (pose.sit) {
    rect(g, 8, y + 17, 8, 2, NAVY)
    rect(g, 7, y + 18, 3, 2, BOOT)
  } else {
    const frontX = 13 + (pose.frontX || 0)
    rect(g, 16, y + 17 + (pose.backLeg || 0), 3, 3, NDARK)
    rect(g, 16, y + 20 + (pose.backLeg || 0), 3, 2, BOOT)
    rect(g, frontX, y + 17 + (pose.frontLeg || 0), 3, 3, NAVY)
    rect(g, frontX - 1, y + 20 + (pose.frontLeg || 0), 4, 2, BOOT)
  }
  return g
}

function poseFor(action, frame) {
  const walk = [
    { bob: 0, leftLeg: 2, rightLeg: -2, leftLegX: -1, rightLegX: 1, leftArm: -1, rightArm: 1, frontLeg: 2, backLeg: -2, frontX: -1, arm: 1 },
    { bob: -1, leftLeg: 0, rightLeg: 0, leftArm: 1, rightArm: -1, frontLeg: 0, backLeg: 0, arm: -1 },
    { bob: 0, leftLeg: -2, rightLeg: 2, leftLegX: 1, rightLegX: -1, leftArm: 1, rightArm: -1, frontLeg: -2, backLeg: 2, frontX: 1, arm: -1 },
    { bob: -1, leftLeg: 1, rightLeg: -1, leftArm: -1, rightArm: 1, frontLeg: 1, backLeg: -1, arm: 1, tail: 1 },
  ]
  const idle = [
    { bob: 0, tail: 0 },
    { bob: -1, tail: 0 },
    { bob: 0, tail: 1 },
    { bob: -1, blink: true },
  ]
  const attack = [
    { bob: 0, rightArm: -2, arm: -2, leftArm: 1 },
    { bob: 0, rightArm: 1, arm: 1, map: true },
    { bob: -1, rightArm: 2, arm: 2, map: true, tail: 1 },
    { bob: 0, rightArm: 0, arm: 0, map: true },
  ]
  if (action === 'walk') return walk[frame]
  if (action === 'attack') return attack[frame]
  if (action === 'hurt') {
    return [
      { blink: true, slump: 1, leftArm: 1, rightArm: 1 },
      { blink: true, slump: 1, bob: -1, tail: 1 },
      { blink: true, leftArm: 2, rightArm: -1 },
      { bob: -1, blink: true, slump: 1, tail: -1 },
    ][frame]
  }
  if (action === 'happy') {
    return [
      { happy: true, bob: -1 },
      { happy: true, bob: 0, tail: 1 },
      { happy: true, bob: -1, blink: true },
      { happy: true, bob: 0 },
    ][frame]
  }
  if (action === 'sit') {
    return [
      { sit: true, bob: 1 },
      { sit: true, bob: 0 },
      { sit: true, bob: 1, tail: 1 },
      { sit: true, bob: 0, blink: true },
    ][frame]
  }
  if (action === 'talk') {
    return [
      { talk: true, leftArm: -2 },
      { talk: true, leftArm: -3, bob: -1 },
      { talk: true, leftArm: -2, tail: 1 },
      { talk: true, leftArm: -1, blink: true },
    ][frame]
  }
  return idle[frame]
}

function renderFrame(action, dir, frame) {
  const pose = poseFor(action, frame)
  let buf
  if (dir === 'up') buf = drawBack(pose)
  else if (dir === 'left' || dir === 'right') {
    buf = drawSide(pose)
    if (dir === 'right') buf = flip(buf)
  } else buf = drawFront(pose)
  if (pose.slump) buf = shift(buf, 1, 1)
  return outline(buf)
}

const LAYOUT = [
  [
    ['idle', 'down'],
    ['idle', 'down'],
    ['idle', 'down'],
    ['idle', 'down'],
    ['idle', 'up'],
    ['idle', 'up'],
    ['idle', 'up'],
    ['idle', 'up'],
  ],
  [
    ['idle', 'left'],
    ['idle', 'left'],
    ['idle', 'left'],
    ['idle', 'left'],
    ['idle', 'right'],
    ['idle', 'right'],
    ['idle', 'right'],
    ['idle', 'right'],
  ],
  [
    ['walk', 'down'],
    ['walk', 'down'],
    ['walk', 'down'],
    ['walk', 'down'],
    ['walk', 'up'],
    ['walk', 'up'],
    ['walk', 'up'],
    ['walk', 'up'],
  ],
  [
    ['walk', 'left'],
    ['walk', 'left'],
    ['walk', 'left'],
    ['walk', 'left'],
    ['walk', 'right'],
    ['walk', 'right'],
    ['walk', 'right'],
    ['walk', 'right'],
  ],
  [
    ['attack', 'down'],
    ['attack', 'down'],
    ['attack', 'down'],
    ['attack', 'down'],
    ['attack', 'up'],
    ['attack', 'up'],
    ['attack', 'up'],
    ['attack', 'up'],
  ],
  [
    ['attack', 'left'],
    ['attack', 'left'],
    ['attack', 'left'],
    ['attack', 'left'],
    ['attack', 'right'],
    ['attack', 'right'],
    ['attack', 'right'],
    ['attack', 'right'],
  ],
  [
    ['hurt', 'down'],
    ['hurt', 'down'],
    ['hurt', 'down'],
    ['hurt', 'down'],
    ['happy', 'down'],
    ['happy', 'down'],
    ['happy', 'down'],
    ['happy', 'down'],
  ],
  [
    ['sit', 'down'],
    ['sit', 'down'],
    ['sit', 'down'],
    ['sit', 'down'],
    ['talk', 'down'],
    ['talk', 'down'],
    ['talk', 'down'],
    ['talk', 'down'],
  ],
]

function paintScaled(target, targetWidth, frame, originX, originY, scale, background) {
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const index = frame[y * N + x]
      const color = index ? PALETTE[index] : background
      if (!color) continue
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = originX + x * scale + sx
          const py = originY + y * scale + sy
          const offset = (py * targetWidth + px) * 4
          target[offset] = color[0]
          target[offset + 1] = color[1]
          target[offset + 2] = color[2]
          target[offset + 3] = color[3]
        }
      }
    }
  }
}

function tile(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4)
  const putPx = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const offset = (y * width + x) * 4
    data[offset] = color[0]
    data[offset + 1] = color[1]
    data[offset + 2] = color[2]
    data[offset + 3] = color[3]
  }
  const fill = (color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) putPx(x, y, color)
    }
  }
  const rectPx = (x, y, w, h, color) => {
    for (let yy = 0; yy < h; yy += 1) {
      for (let xx = 0; xx < w; xx += 1) putPx(x + xx, y + yy, color)
    }
  }
  painter({ put: putPx, fill, rect: rectPx })
  return data
}

const GRASS = [63, 154, 78, 255]
const GRASS_D = [45, 116, 56, 255]
const GRASS_L = [125, 206, 112, 255]
const DIRT = [196, 160, 106, 255]
const DIRT_D = [138, 104, 64, 255]
const DIRT_L = [226, 201, 150, 255]
const WATER = [58, 126, 194, 255]
const WATER_L = [126, 182, 230, 255]
const SAND = [226, 210, 164, 255]
const ROCK = [138, 143, 134, 255]
const ROCK_L = [197, 203, 191, 255]
const ROCK_D = [78, 85, 78, 255]
const LEAF = [47, 138, 98, 255]
const LEAF_D = [29, 92, 66, 255]
const LEAF_L = [125, 206, 160, 255]
const WOOD = [107, 70, 50, 255]
const GLOW = [240, 193, 90, 255]
const FLOWER = [224, 122, 66, 255]
const CREAM_T = [243, 234, 216, 255]
const INK_T = [26, 20, 18, 255]

function grassTile(specks, flower) {
  return tile(16, 16, ({ fill, put }) => {
    fill(GRASS)
    for (const [x, y] of specks) {
      put(x, y, GRASS_D)
      put(x, y - 1, GRASS_L)
    }
    if (flower) {
      put(8, 8, FLOWER)
      put(8, 7, FLOWER)
      put(7, 6, CREAM_T)
      put(9, 6, CREAM_T)
      put(8, 5, CREAM_T)
      put(8, 9, GRASS_D)
    }
  })
}

function buildTiles() {
  const tiles = [
    grassTile([[3, 4], [8, 10], [13, 6], [6, 14]], false),
    grassTile([[5, 3], [11, 8], [2, 11], [14, 13]], false),
    grassTile([[4, 13], [12, 4]], true),
    tile(16, 16, ({ fill, put, rect }) => {
      fill(DIRT)
      rect(0, 7, 16, 2, DIRT_L)
      for (const [x, y] of [[2, 3], [6, 5], [11, 4], [14, 11], [4, 12], [9, 13]]) put(x, y, DIRT_D)
    }),
    tile(16, 16, ({ fill, rect }) => {
      fill(WATER)
      rect(0, 4, 16, 1, WATER_L)
      rect(0, 11, 16, 1, WATER_L)
      rect(3, 5, 4, 1, WATER_L)
      rect(9, 12, 5, 1, WATER_L)
    }),
    tile(16, 16, ({ rect, put }) => {
      rect(0, 0, 16, 6, GRASS)
      rect(0, 6, 16, 2, SAND)
      rect(0, 8, 16, 8, WATER)
      rect(0, 11, 16, 1, WATER_L)
      put(3, 2, GRASS_D)
      put(11, 4, GRASS_L)
      put(5, 6, DIRT_L)
    }),
    tile(16, 16, ({ fill, rect, put }) => {
      fill(GRASS)
      rect(4, 5, 8, 7, ROCK)
      rect(4, 5, 4, 2, ROCK_L)
      rect(8, 9, 4, 3, ROCK_D)
      put(6, 7, ROCK_L)
      put(10, 8, ROCK_D)
      put(3, 13, GRASS_D)
    }),
    tile(16, 16, ({ fill, rect, put }) => {
      fill(GRASS)
      rect(7, 10, 2, 4, WOOD)
      rect(3, 4, 10, 7, LEAF)
      rect(4, 3, 8, 3, LEAF)
      rect(5, 2, 4, 2, LEAF_L)
      rect(8, 8, 4, 3, LEAF_D)
      put(6, 5, LEAF_L)
      put(2, 14, GRASS_D)
    }),
    tile(16, 16, ({ fill, rect, put }) => {
      fill(GRASS)
      rect(7, 8, 2, 6, WOOD)
      rect(5, 4, 6, 5, INK_T)
      rect(6, 5, 4, 3, GLOW)
      put(7, 6, CREAM_T)
      put(4, 6, GLOW)
      put(11, 6, GLOW)
      put(3, 14, GRASS_D)
    }),
  ]
  return tiles
}

function blitTileStrip(tiles, scale, gap, pad) {
  const tileSize = 16 * scale
  const width = pad * 2 + tiles.length * tileSize + (tiles.length - 1) * gap
  const height = pad * 2 + tileSize
  const data = new Uint8ClampedArray(width * height * 4)
  tiles.forEach((source, index) => {
    const originX = pad + index * (tileSize + gap)
    const originY = pad
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const sourceOffset = (y * 16 + x) * 4
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = originX + x * scale + sx
            const py = originY + y * scale + sy
            const offset = (py * width + px) * 4
            data[offset] = source[sourceOffset]
            data[offset + 1] = source[sourceOffset + 1]
            data[offset + 2] = source[sourceOffset + 2]
            data[offset + 3] = source[sourceOffset + 3]
          }
        }
      }
    }
  })
  return { width, height, data }
}

function buildSheet(frames) {
  const width = COLS * CELL
  const height = ROWS * CELL
  const data = Buffer.alloc(width * height * 4, 255)
  frames.forEach((frame, index) => {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    paintScaled(data, width, frame, col * CELL, row * CELL, SCALE, [255, 255, 255, 255])
  })
  return { width, height, data }
}

function buildHero(frames) {
  const scale = 8
  const gap = 20
  const frame = N * scale
  const width = frame * 2 + gap
  const height = frame * 2 + gap
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < 4; index += 1) {
    const col = index % 2
    const row = Math.floor(index / 2)
    paintScaled(data, width, frames[16 + index], col * (frame + gap), row * (frame + gap), scale, null)
  }
  return { width, height, data }
}

async function writePng(filePath, image) {
  await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png({ compressionLevel: 9, effort: 9 })
    .toFile(filePath)
}

function assertArt(frames) {
  const seen = new Map()
  frames.forEach((frame, index) => {
    const hash = hashFrame(frame)
    if (seen.has(hash)) {
      throw new Error(`duplicate frame ${index} matches ${seen.get(hash)}`)
    }
    seen.set(hash, index)
    let opaque = 0
    for (const value of frame) if (value) opaque += 1
    if (opaque < 80) throw new Error(`frame ${index} is too empty (${opaque})`)
  })
  const walk = frames.slice(16, 20)
  const legDelta = walk.some((frame, index) => {
    if (!index) return false
    for (let y = 22; y < 30; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        if (frame[y * N + x] !== walk[0][y * N + x]) return true
      }
    }
    return false
  })
  if (!legDelta) throw new Error('walk cycle does not move the legs')
}

async function main() {
  const frames = []
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const [action, dir] = LAYOUT[row][col]
      frames.push(renderFrame(action, dir, col % 4))
    }
  }
  assertArt(frames)
  await mkdir(assetDir, { recursive: true })
  const sheet = buildSheet(frames)
  const hero = buildHero(frames)
  const tiles = blitTileStrip(buildTiles(), 4, 8, 8)
  await writePng(path.join(assetDir, 'sample-character.png'), sheet)
  await writePng(path.join(assetDir, 'hero-walk.png'), hero)
  await writePng(path.join(assetDir, 'sample-tiles.png'), tiles)
  if (process.argv.includes('--preview')) {
    const previewScale = 4
    const preview = {
      width: COLS * N * previewScale,
      height: ROWS * N * previewScale,
      data: new Uint8ClampedArray(COLS * N * previewScale * ROWS * N * previewScale * 4),
    }
    frames.forEach((frame, index) => {
      const col = index % COLS
      const row = Math.floor(index / COLS)
      paintScaled(preview.data, preview.width, frame, col * N * previewScale, row * N * previewScale, previewScale, [12, 16, 14, 255])
    })
    await writePng('/tmp/art-sheet.png', preview)
    await writePng('/tmp/art-walk.png', hero)
    await writePng('/tmp/art-tiles.png', blitTileStrip(buildTiles(), 8, 12, 12))
    const faceScale = 12
    const face = {
      width: N * faceScale,
      height: N * faceScale,
      data: new Uint8ClampedArray(N * faceScale * N * faceScale * 4),
    }
    paintScaled(face.data, face.width, frames[16], 0, 0, faceScale, [18, 22, 20, 255])
    await writePng('/tmp/art-face.png', face)
  }
  console.log(JSON.stringify({
    sheet: `${sheet.width}x${sheet.height}`,
    hero: `${hero.width}x${hero.height}`,
    tiles: `${tiles.width}x${tiles.height}`,
    colors: PALETTE.length - 1,
  }))
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
