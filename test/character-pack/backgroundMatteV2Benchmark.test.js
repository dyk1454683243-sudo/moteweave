import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import { applyDeterministicPixelMatteV2 } from '../../src/character-pack/backgroundMatteV2.js'
import { loadRgba } from '../../src/character-pack/imageCodec.js'

function syntheticSheet(background) {
  const width = 96
  const height = 96
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([...background, 255], offset)
  const paint = (x, y, w, h, color) => {
    for (let row = y; row < y + h; row += 1) {
      for (let column = x; column < x + w; column += 1) {
        data.set(color, (row * width + column) * 4)
      }
    }
  }
  paint(33, 18, 30, 62, [42, 76, 148, 255])
  paint(37, 18, 22, 12, [246, 246, 246, 255])
  paint(40, 34, 4, 4, [255, 255, 255, 255])
  paint(52, 34, 4, 4, [255, 255, 255, 255])
  paint(34, 44, 6, 18, [232, 190, 158, 255])
  paint(63, 48, 24, 2, [112, 82, 38, 255])
  paint(31, 76, 4, 2, [32, 42, 70, 255])
  return { width, height, data }
}

function pixel(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [...image.data.slice(offset, offset + 4)]
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      image.data.set(color, (y * image.width + x) * 4)
    }
  }
}

for (const value of [180, 200, 220, 239]) {
  test(`provider-free matte benchmark preserves light details on RGB ${value} background`, () => {
    const source = syntheticSheet([value, value, value])
    const before = new Uint8ClampedArray(source.data)
    const result = applyDeterministicPixelMatteV2(source)

    assert.equal(result.analysis.eligible, true)
    assert.equal(result.scope.status, 'pass')
    assert.equal(result.scope.metrics.sure_foreground_changed_pixels, 0)
    assert.deepEqual(pixel(result.image, 40, 34), [255, 255, 255, 255])
    assert.deepEqual(pixel(result.image, 52, 34), [255, 255, 255, 255])
    assert.deepEqual(pixel(result.image, 86, 48), [112, 82, 38, 255])
    assert.deepEqual([...source.data], [...before])
    assert.equal(result.quality.provider_calls_used, 0)
  })
}

for (const quality of [70, 85, 95]) {
  test(`provider-free matte benchmark records JPEG Q${quality} as lossy review evidence`, async () => {
    const source = syntheticSheet([255, 255, 255])
    paintRect(source, { x: 4, y: 40, w: 8, h: 8 }, [245, 245, 245, 255])
    const jpeg = await sharp(Buffer.from(source.data), {
      raw: { width: source.width, height: source.height, channels: 4 },
    }).jpeg({ quality }).toBuffer()
    const decoded = await loadRgba(jpeg)
    const before = new Uint8ClampedArray(decoded.data)
    const result = applyDeterministicPixelMatteV2(decoded, { decode: decoded.decode })

    assert.equal(result.scope.status, 'pass')
    assert.equal(result.quality.input_decode.lossy, true)
    assert.equal(result.quality.status, 'needs_review')
    assert.ok(result.quality.warnings.includes('lossy_source_review'))
    assert.ok(result.review.reasons.includes('lossy_source_review'))
    assert.deepEqual(pixel(result.image, 7, 43), [0, 0, 0, 0])
    assert.deepEqual(pixel(result.image, 40, 34), pixel(decoded, 40, 34))
    assert.deepEqual(pixel(result.image, 52, 34), pixel(decoded, 52, 34))
    assert.deepEqual(pixel(result.image, 86, 48), pixel(decoded, 86, 48))
    assert.equal(result.scope.metrics.sure_foreground_changed_pixels, 0)
    if (result.quality.background_residue.visible_pixel_count > 0) {
      assert.equal(result.quality.background_residue.status, 'needs_review')
      assert.equal(
        result.quality.background_residue.adjacent_sure_foreground_pixel_count,
        result.quality.background_residue.visible_pixel_count,
      )
      assert.ok(result.review.reasons.includes('visible_exterior_background_residue'))
    } else {
      assert.equal(result.quality.background_residue.status, 'pass')
    }
    assert.deepEqual([...decoded.data], [...before])
    assert.equal(result.quality.provider_calls_used, 0)
  })
}
