import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { buildMetadataJson } from '../../src/character-pack/packageBuilder.js'
import { buildOcadExport, buildOcadNpcJson, OCAD_REGIONS } from '../../src/character-pack/exporters/ocadExport.js'

function makeFrame(index) {
  const data = new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4)
  for (let y = 28; y < 86; y++) {
    for (let x = 30; x < 66; x++) {
      const offset = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      data[offset] = (index * 17) % 255
      data[offset + 1] = 120
      data[offset + 2] = 80
      data[offset + 3] = 255
    }
  }
  return { index, image: { width: 96, height: 96, data } }
}

function frames() {
  return Array.from({ length: 64 }, (_, index) => makeFrame(index))
}

function metadata() {
  return buildMetadataJson({
    id: 'npc_20260524_010203_green_priestess',
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'pass', warnings: [], blocking_errors: [] },
  })
}

test('buildOcadNpcJson emits yituquan_v1 without json_grid override', () => {
  const result = buildOcadNpcJson({ metadata: metadata() })

  assert.equal(result.meta.id, 'npc_20260524_010203_green_priestess_ocad')
  assert.equal(result.spritesheet.layoutVersion, 'yituquan_v1')
  assert.equal(result.spritesheet.frameWidth, 252)
  assert.equal(result.spritesheet.frameHeight, 252)
  assert.equal(result.ext.spritesheetSlice, undefined)
  assert.equal(result.ext.exportProfile, 'ocad_v0')
})

test('buildOcadExport renders a 252x252 sprite with fixed OCAD regions', async () => {
  const result = await buildOcadExport({ metadata: metadata(), frames: frames() })

  assert.equal(result.basePath, 'AI资源库/一图全动作/npc_20260524_010203_green_priestess_ocad')
  assert.equal(result.files['AI资源库/一图全动作/npc_20260524_010203_green_priestess_ocad/npc.json'].spritesheet.layoutVersion, 'yituquan_v1')

  const meta = await sharp(result.spritePng).metadata()
  assert.equal(meta.width, 252)
  assert.equal(meta.height, 252)
  assert.deepEqual(OCAD_REGIONS.idledown, { x: 189, y: 126, w: 21, h: 42 })
})
