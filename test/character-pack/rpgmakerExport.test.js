import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { buildMetadataJson } from '../../src/character-pack/packageBuilder.js'
import { buildRpgmakerExport, buildRpgmakerNpcJson } from '../../src/character-pack/exporters/rpgmakerExport.js'

function makeFrame(index, color) {
  const data = new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4)
  for (let y = 24; y < 80; y++) {
    for (let x = 34; x < 62; x++) {
      const offset = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = 255
    }
  }
  return {
    index,
    image: {
      width: TOPDOWN_RPG_V0.frame.w,
      height: TOPDOWN_RPG_V0.frame.h,
      data,
    },
  }
}

function frames() {
  return Array.from({ length: 64 }, (_, index) => makeFrame(index, [(index * 13) % 255, (index * 29) % 255, (index * 47) % 255]))
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

test('buildRpgmakerNpcJson emits rpgmaker_v1 metadata for the plugin', () => {
  const result = buildRpgmakerNpcJson({ metadata: metadata() })

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.meta.id, 'npc_20260524_010203_green_priestess_rpgmaker')
  assert.equal(result.meta.displayName, 'Green Priestess RPGMaker')
  assert.equal(result.assets.spritePath, './sprite.png')
  assert.equal(result.assets.thumbPath, './thumb.png')
  assert.equal(result.spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(result.spritesheet.frameWidth, 48)
  assert.equal(result.spritesheet.frameHeight, 48)
  assert.equal(result.spritesheet.columns, 3)
  assert.equal(result.spritesheet.rows, 4)
  assert.equal(result.ext.sourceProfile, 'topdown_rpg_v0')
  assert.equal(result.ext.exportProfile, 'rpgmaker_v0')
})

test('buildRpgmakerExport renders a 144x192 sprite and import folder', async () => {
  const result = await buildRpgmakerExport({ metadata: metadata(), frames: frames() })

  assert.equal(result.basePath, 'AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker')
  assert.ok(Buffer.isBuffer(result.spritePng))
  assert.ok(Buffer.isBuffer(result.thumbPng))
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/NPC.json'].spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/sprite.png'], result.spritePng)
  assert.equal(result.files['AI资源库/RPGMAKER/npc_20260524_010203_green_priestess_rpgmaker/thumb.png'], result.thumbPng)

  const meta = await sharp(result.spritePng).metadata()
  assert.equal(meta.width, 144)
  assert.equal(meta.height, 192)
})
