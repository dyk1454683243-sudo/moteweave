import test from 'node:test'
import assert from 'node:assert/strict'

import { buildGodotNpcExport, buildGodotNpcJson } from '../../src/character-pack/exporters/godotNpcExport.js'
import { buildMetadataJson } from '../../src/character-pack/packageBuilder.js'

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

test('buildGodotNpcJson emits json_grid data understood by the free NPC plugin', () => {
  const result = buildGodotNpcJson({ metadata: metadata() })

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.meta.id, 'npc_20260524_010203_green_priestess')
  assert.equal(result.meta.displayName, 'Green Priestess')
  assert.equal(result.meta.style, 'modern')
  assert.equal(result.meta.category, 'function')
  assert.deepEqual(result.assets, { spritePath: './sprite.png', thumbPath: './thumb.png' })
  assert.equal(result.spritesheet.layoutVersion, 'json_grid')
  assert.equal(result.spritesheet.frameWidth, 96)
  assert.equal(result.spritesheet.frameHeight, 96)
  assert.equal(result.spritesheet.columns, 8)
  assert.equal(result.spritesheet.rows, 8)
  assert.deepEqual(result.spritesheet.animations.walk_down, { row: 2, from: 0, to: 3, loop: true })
  assert.deepEqual(result.spritesheet.animations.attack_right, { row: 5, from: 4, to: 7, loop: false })
  assert.equal(result.ext.spritesheetSlice, 'json_grid')
  assert.equal(result.ext.sourceProfile, 'topdown_rpg_v0')
  assert.equal(result.gameplay.interaction.canTalk, true)
})

test('buildGodotNpcExport returns the AI resource folder expected by the plugin scanner', () => {
  const sprite = Buffer.from('sprite')
  const thumb = Buffer.from('thumb')
  const result = buildGodotNpcExport({ metadata: metadata(), spritePng: sprite, thumbPng: thumb })

  assert.equal(result.basePath, 'AI资源库/一图全动作/npc_20260524_010203_green_priestess')
  assert.equal(result.files['AI资源库/一图全动作/npc_20260524_010203_green_priestess/sprite.png'], sprite)
  assert.equal(result.files['AI资源库/一图全动作/npc_20260524_010203_green_priestess/thumb.png'], thumb)
  assert.equal(
    result.files['AI资源库/一图全动作/npc_20260524_010203_green_priestess/npc.json'].spritesheet.layoutVersion,
    'json_grid'
  )
})
