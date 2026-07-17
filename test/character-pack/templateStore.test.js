import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

import {
  buildFixedRegionMotionTemplate,
  buildFixedRegionSampleHero,
} from '../../scripts/create-fixed-region-motion-assets.mjs'
import { FIXED_REGION_SOURCE_REGIONS } from '../../src/character-pack/fixedRegionGeometry.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'
import { loadTemplateImage } from '../../src/character-pack/templateStore.js'

function pixelOffset(width, x, y) {
  return (y * width + x) * 4
}

function isNearWhite(data, offset) {
  return data[offset + 3] > 0 && data[offset] >= 245 && data[offset + 1] >= 245 && data[offset + 2] >= 245
}

function isForeground(data, offset) {
  if (data[offset + 3] === 0) return false
  return !isNearWhite(data, offset)
}

test('loadTemplateImage reads the built-in 8x8 topdown_rpg_v0 template', async () => {
  const template = await loadTemplateImage('topdown_rpg_v0', { rootDir: process.cwd() })

  assert.equal(template.name, 'motion_template_ocha_8x8.png')
  assert.equal(template.mimeType, 'image/png')
  assert.ok(Buffer.isBuffer(template.buffer))
  assert.ok(template.buffer.length > 1000)
  const metadata = await sharp(template.buffer).metadata()
  assert.equal(metadata.width, 256)
  assert.equal(metadata.height, 256)
})

test('built-in topdown template gives providers 64 occupied padded cells', async () => {
  const template = await loadTemplateImage('topdown_rpg_v0', { rootDir: process.cwd() })
  const { data, info } = await sharp(template.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cellW = info.width / 8
  const cellH = info.height / 8

  assert.equal(cellW, 32)
  assert.equal(cellH, 32)

  const cornerOffsets = [
    pixelOffset(info.width, 0, 0),
    pixelOffset(info.width, info.width - 1, 0),
    pixelOffset(info.width, 0, info.height - 1),
    pixelOffset(info.width, info.width - 1, info.height - 1),
  ]
  assert.equal(cornerOffsets.every((offset) => isNearWhite(data, offset)), true)

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      let count = 0
      let minX = Infinity
      let minY = Infinity
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
          const offset = pixelOffset(info.width, col * cellW + x, row * cellH + y)
          if (!isForeground(data, offset)) continue
          count += 1
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      const frame = row * 8 + col
      assert.ok(count >= 40, `frame_${frame}_template_empty_or_too_sparse`)
      assert.ok(minX >= 2, `frame_${frame}_template_left_edge_touch`)
      assert.ok(minY >= 2, `frame_${frame}_template_top_edge_touch`)
      assert.ok(maxX <= cellW - 3, `frame_${frame}_template_right_edge_touch`)
      assert.ok(maxY <= cellH - 3, `frame_${frame}_template_bottom_edge_touch`)
    }
  }
})

test('loadTemplateImage reads the built-in fixed-region motion template by canonical id', async () => {
  const template = await loadTemplateImage(FIXED_REGION_MOTION_LAYOUT_ID, { rootDir: process.cwd() })

  assert.equal(template.name, 'fixed_region_motion_template_v1.png')
  const metadata = await sharp(template.buffer).metadata()
  assert.equal(metadata.width, 252)
  assert.equal(metadata.height, 252)
  assert.deepEqual(template.buffer, await buildFixedRegionMotionTemplate())
})

test('loadTemplateImage keeps the legacy fixed-region motion preset readable', async () => {
  const template = await loadTemplateImage(LEGACY_OCAD_MOTION_LAYOUT_ID, { rootDir: process.cwd() })

  assert.equal(template.name, 'fixed_region_motion_template_v1.png')
})

test('fixed-region template keeps every canonical region occupied and padded', async () => {
  const template = await loadTemplateImage(FIXED_REGION_MOTION_LAYOUT_ID, { rootDir: process.cwd() })
  const { data, info } = await sharp(template.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  for (const [regionKey, region] of Object.entries(FIXED_REGION_SOURCE_REGIONS)) {
    let count = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < region.h; y += 1) {
      for (let x = 0; x < region.w; x += 1) {
        const offset = pixelOffset(info.width, region.x + x, region.y + y)
        if (!isForeground(data, offset)) continue
        count += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    assert.ok(count >= 30, `${regionKey}_template_empty_or_too_sparse`)
    assert.ok(minX >= 1, `${regionKey}_template_left_edge_touch`)
    assert.ok(minY >= 1, `${regionKey}_template_top_edge_touch`)
    assert.ok(maxX <= region.w - 2, `${regionKey}_template_right_edge_touch`)
    assert.ok(maxY <= region.h - 2, `${regionKey}_template_bottom_edge_touch`)
  }
})

test('committed fixed-region sample hero is deterministically reproducible', async () => {
  const fixture = await readFile(
    'test/fixtures/character-pack/local-image-golden/ocad-sheet/fixed_region_sample_hero.png'
  )
  assert.deepEqual(fixture, await buildFixedRegionSampleHero())
})

test('loadTemplateImage returns null for unknown presets', async () => {
  assert.equal(await loadTemplateImage('missing_profile', { rootDir: process.cwd() }), null)
})
