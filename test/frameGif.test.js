import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { buildFrameGifFromImages } from '../src/frameGif.js'

async function pngFrame(color) {
  return sharp({
    create: {
      width: 12,
      height: 10,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer()
}

test('buildFrameGifFromImages renders uploaded frames into a GIF', async () => {
  const gif = await buildFrameGifFromImages(
    [
      await pngFrame({ r: 255, g: 0, b: 0, alpha: 1 }),
      await pngFrame({ r: 0, g: 0, b: 255, alpha: 1 }),
    ],
    { targetW: 32, targetH: 32, padding: 4, fps: 12 }
  )

  assert.ok(Buffer.isBuffer(gif))
  assert.equal(gif.subarray(0, 3).toString('ascii'), 'GIF')
})
