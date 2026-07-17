import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeGifFromRgbaFrames } from '../../src/character-pack/gifExport.js'
import { buildCharacterPackZip } from '../../src/character-pack/zipExport.js'

function frame(alpha) {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  data[3] = alpha
  return { width: 4, height: 4, data }
}

test('encodeGifFromRgbaFrames returns a GIF buffer', () => {
  const gif = encodeGifFromRgbaFrames([frame(255), frame(0)], { delay: 100 })
  assert.ok(Buffer.isBuffer(gif))
  assert.equal(gif.subarray(0, 3).toString('ascii'), 'GIF')
})

test('buildCharacterPackZip includes png and json artifacts', async () => {
  const zip = await buildCharacterPackZip({
    'normalized_sheet.png': Buffer.from('png'),
    'animations.json': { version: '0.1' },
  })
  assert.ok(Buffer.isBuffer(zip))
  assert.ok(zip.length > 20)
})
