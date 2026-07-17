import test from 'node:test'
import assert from 'node:assert/strict'

import { removeBackground } from '../../src/character-pack/sourcePreparation.js'

function rgba(width, height, pixels) {
  return { width, height, data: Uint8ClampedArray.from(pixels.flat(2)) }
}

function offset(width, x, y) {
  return (y * width + x) * 4
}

test('removeBackground flood path clears opaque white matte fringe without deleting enclosed whites', async () => {
  const pixels = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => [255, 255, 255, 255]))
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [30, 70, 120, 255]
  }
  pixels[1][3] = [236, 238, 241, 255]
  pixels[3][3] = [248, 248, 248, 255]

  const result = await removeBackground(rgba(7, 7, pixels), {
    backgroundMode: 'flood',
    backgroundTolerance: 18,
    matteResidueTolerance: 40,
  })

  assert.equal(result.mode, 'flood')
  assert.equal(result.image.data[offset(7, 0, 0) + 3], 0)
  assert.equal(result.image.data[offset(7, 3, 1) + 3], 0)
  assert.equal(result.image.data[offset(7, 3, 3) + 3], 255)
  assert.deepEqual([...result.image.data.slice(offset(7, 3, 3), offset(7, 3, 3) + 3)], [248, 248, 248])
})

test('removeBackground flood path decontaminates retained light edge pixels while protecting near-white costume pixels', async () => {
  const pixels = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [255, 255, 255, 255]))
  for (let y = 1; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [25, 65, 125, 255]
  }
  pixels[2][1] = [205, 216, 232, 255]
  pixels[3][3] = [250, 250, 250, 255]

  const result = await removeBackground(rgba(6, 6, pixels), {
    backgroundMode: 'flood',
    backgroundTolerance: 18,
    matteResidueTolerance: 40,
    edgeDecontaminationMaxDistance: 92,
    edgeDecontaminationStrength: 0.6,
  })

  const stainedOffset = offset(6, 1, 2)
  assert.equal(result.image.data[stainedOffset + 3], 255)
  assert.ok(result.image.data[stainedOffset] < 120)
  assert.ok(result.image.data[stainedOffset + 1] < 150)
  assert.ok(result.image.data[stainedOffset + 2] < 195)

  const costumeOffset = offset(6, 3, 3)
  assert.equal(result.image.data[costumeOffset + 3], 255)
  assert.deepEqual([...result.image.data.slice(costumeOffset, costumeOffset + 3)], [250, 250, 250])
})
