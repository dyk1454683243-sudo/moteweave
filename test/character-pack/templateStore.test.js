import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'
import {
  loadAuthoritativeGenerationStructureImage,
  loadTemplateImage,
} from '../../src/character-pack/templateStore.js'

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

  assert.equal(template.name, 'motion_template_ocad_primary.png')
  const metadata = await sharp(template.buffer).metadata()
  assert.equal(metadata.width, 252)
  assert.equal(metadata.height, 252)
})

test('loadTemplateImage keeps the legacy fixed-region motion preset readable', async () => {
  const template = await loadTemplateImage(LEGACY_OCAD_MOTION_LAYOUT_ID, { rootDir: process.cwd() })

  assert.equal(template.name, 'motion_template_ocad_primary.png')
})

test('loadTemplateImage returns null for unknown presets', async () => {
  assert.equal(await loadTemplateImage('missing_profile', { rootDir: process.cwd() }), null)
})

test('strict generation exposes only the confirmed fixed-region exact-outline Structure', async () => {
  const fixed = await loadAuthoritativeGenerationStructureImage(FIXED_REGION_MOTION_LAYOUT_ID, {
    rootDir: process.cwd(),
  })

  assert.equal(fixed.name, 'motion_template_ocad_primary.png')
  assert.equal(fixed.structureAuthority, 'repository_maintained_exact_outline')
  assert.equal(fixed.structureAuthorityId, 'fixed_region_motion_primary_structure_v1')
  assert.equal(fixed.expectedStructureSha256, '6970952fdd0571493d46ec26b6fa750b56f1459f96ae3473d51090651c7da541')
  assert.equal(await loadAuthoritativeGenerationStructureImage('topdown_rpg_v0', {
    rootDir: process.cwd(),
  }), null)
})
