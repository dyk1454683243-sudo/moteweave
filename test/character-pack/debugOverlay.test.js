import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { renderDebugOverlayPng, renderOnionSkinOverlayPng, renderSourceLayoutOverlayPng } from '../../src/character-pack/debugOverlay.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function blankFrame(index, bbox) {
  return {
    index,
    image: { width: TOPDOWN_RPG_V0.frame.w, height: TOPDOWN_RPG_V0.frame.h, data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4) },
    normalized_bbox: bbox,
    warnings: [],
  }
}

async function countVisiblePixels(buffer) {
  const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let visible = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) visible++
  }
  return visible
}

test('renderDebugOverlayPng draws grid, bbox, anchors, and baselines', async () => {
  const frames = Array.from({ length: 64 }, (_, index) => blankFrame(index, { x: 34, y: 18, w: 28, h: 66, right: 61, bottom: 83 }))
  const buffer = await renderDebugOverlayPng({ profile: TOPDOWN_RPG_V0, frames })
  assert.ok(Buffer.isBuffer(buffer))
  assert.ok((await countVisiblePixels(buffer)) > 4000)
})

test('renderOnionSkinOverlayPng draws walk animation overlays', async () => {
  const frames = Array.from({ length: 64 }, (_, index) => blankFrame(index, { x: 34, y: 18, w: 28, h: 66, right: 61, bottom: 83 }))
  for (const frame of frames) {
    const offset = (48 * TOPDOWN_RPG_V0.frame.w + 48) * 4
    frame.image.data[offset] = 20
    frame.image.data[offset + 1] = 40
    frame.image.data[offset + 2] = 60
    frame.image.data[offset + 3] = 255
  }
  const buffer = await renderOnionSkinOverlayPng({ profile: TOPDOWN_RPG_V0, frames })
  assert.ok(Buffer.isBuffer(buffer))
  assert.ok((await countVisiblePixels(buffer)) > 100)
})

test('renderSourceLayoutOverlayPng draws fixed source regions over the source sheet', async () => {
  const width = 252
  const height = 252
  const source = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }
  const sourcePng = await sharp(Buffer.from(source.data), { raw: { width, height, channels: 4 } }).png().toBuffer()
  const buffer = await renderSourceLayoutOverlayPng({
    sourcePng,
    width,
    height,
    regions: [{ key: 'walkL0', x: 10, y: 20, w: 32, h: 42 }],
  })
  assert.ok(Buffer.isBuffer(buffer))
  assert.ok((await countVisiblePixels(buffer)) > 100)
})
