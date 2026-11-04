import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'

import { buildAnimationsJson, buildMetadataJson } from '../../src/character-pack/packageBuilder.js'
import {
  GODOT_SPRITEFRAMES_V0,
  buildGodotSpriteFramesExport,
  buildGodotSpriteFramesTres,
} from '../../src/character-pack/exporters/godotSpriteFramesExport.js'
import { buildGodotNpcExport } from '../../src/character-pack/exporters/godotNpcExport.js'
import { buildCharacterPackZip } from '../../src/character-pack/zipExport.js'

const PACK_ID = 'npc_20260524_010203_green_priestess'
const GOLDEN_URL = new URL('../fixtures/character-pack/godot-spriteframes-v0/topdown_rpg_v0.tres', import.meta.url)

function metadata() {
  return buildMetadataJson({
    id: PACK_ID,
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'pass', warnings: [], blocking_errors: [] },
  })
}

function clip(overrides = {}) {
  return {
    fps: 10,
    loop: true,
    mode: 'loop',
    frames: [16],
    flip_h: false,
    ...overrides,
  }
}

function animationsDocument(animations = { walk_down: clip() }, overrides = {}) {
  return {
    sheet: 'normalized_sheet.png',
    frame_size: { w: 96, h: 96 },
    sheet_size: { w: 768, h: 768 },
    anchor: { x: 48, y: 88 },
    animations,
    ...overrides,
  }
}

function writeTres(animations, packId = 'pack') {
  return buildGodotSpriteFramesTres(animationsDocument(animations), { packId })
}

test('topdown_rpg_v0 SpriteFrames text matches the golden fixture', async () => {
  const animationsJson = buildAnimationsJson()
  const tres = buildGodotSpriteFramesTres(animationsJson, { packId: PACK_ID })
  const golden = await readFile(GOLDEN_URL, 'utf8')

  assert.equal(tres, golden)
  assert.match(tres, /^\[gd_resource type="SpriteFrames" load_steps=66 format=3\]\n/)
  assert.doesNotMatch(tres, /uid=/)
  assert.doesNotMatch(tres, /&"default"/)
  assert.match(tres, /id="AtlasTexture_16"\]\natlas = ExtResource\("1_sheet"\)\nregion = Rect2\(0, 192, 96, 96\)/)
  assert.match(tres, /id="AtlasTexture_44"\]\natlas = ExtResource\("1_sheet"\)\nregion = Rect2\(384, 480, 96, 96\)/)
  assert.match(clipBlock(tres, 'walk_down'), /AtlasTexture_16[\s\S]*AtlasTexture_17[\s\S]*AtlasTexture_18[\s\S]*AtlasTexture_19/)
  assert.match(tres, /"loop": true,\n"name": &"walk_down",\n"speed": 10\.0/)
  assert.match(clipBlock(tres, 'attack_right'), /AtlasTexture_44[\s\S]*AtlasTexture_45[\s\S]*AtlasTexture_46[\s\S]*AtlasTexture_47/)
  assert.match(tres, /"loop": false,\n"name": &"attack_right",\n"speed": 12\.0/)
  assert.equal(tres.split('[sub_resource type="AtlasTexture"').length - 1, 64)
  assert.match(tres, /path="res:\/\/moteweave\/spriteframes\/npc_20260524_010203_green_priestess\/normalized_sheet\.png"/)
})

function clipBlock(tres, name) {
  const nameAt = tres.indexOf(`"name": &"${name}"`)
  const framesAt = tres.lastIndexOf('"frames": [', nameAt)
  return tres.slice(framesAt, nameAt)
}

test('smaller sheets keep the same indexes and use frame_size pixels', () => {
  const tres = buildGodotSpriteFramesTres(animationsDocument(
    { walk_down: clip({ frames: [16, 17] }) },
    { frame_size: { w: 48, h: 48 }, sheet_size: { w: 384, h: 384 } },
  ), { packId: 'small' })

  assert.match(tres, /region = Rect2\(0, 96, 48, 48\)/)
  assert.match(tres, /region = Rect2\(48, 96, 48, 48\)/)
  assert.match(tres, /load_steps=4/)
})

test('one AtlasTexture is emitted per distinct index and later clips reuse it', () => {
  const tres = writeTres({
    first: clip({ frames: [1, 2], ui_hidden: true, label: 'provenance' }),
    second: clip({ fps: 7.5, frames: [2, 3], mode: 'once', loop: false }),
  })

  assert.equal(tres.split('[sub_resource type="AtlasTexture" id="AtlasTexture_2"]').length - 1, 1)
  assert.equal(tres.split('SubResource("AtlasTexture_2")').length - 1, 2)
  assert.match(tres, /load_steps=5/)
  assert.match(tres, /"name": &"first"/)
  assert.match(tres, /"speed": 7\.5/)
  assert.doesNotMatch(tres, /ui_hidden|provenance/)
})

test('extra animations.json keys do not change the resource text', () => {
  const plain = writeTres({ talk: clip({ fps: 6, frames: [60] }) })
  const annotated = buildGodotSpriteFramesTres(animationsDocument(
    { talk: clip({ fps: 6, frames: [60], source_actions: [{ flip_h: true }] }) },
    { source_layout: 'fixed_regions', version: '0.1', profile: 'topdown_rpg_v0' },
  ), { packId: 'pack' })

  assert.equal(annotated, plain)
})

test('mode and loop must agree, and pingpong, flip_h, and empty frames fail', () => {
  assert.throws(() => writeTres({ walk_down: clip({ mode: 'loop', loop: false }) }), /do not agree/)
  assert.throws(() => writeTres({ attack_right: clip({ mode: 'once', loop: true, frames: [44] }) }), /do not agree/)
  assert.throws(() => writeTres({ walk_down: clip({ mode: 'pingpong', loop: true }) }), /mode "pingpong" is not supported/)
  assert.throws(() => writeTres({ walk_down: clip({ mode: 'pingpong', loop: false }) }), /mode "pingpong" is not supported/)
  assert.throws(() => writeTres({ walk_down: clip({ flip_h: true }) }), /flip_h must be false/)
  assert.throws(() => writeTres({ walk_down: clip({ frames: [] }) }), /frames must be a non-empty list/)
})

test('sheet geometry, clip names, fps, and pack ids are rejected before any text is returned', () => {
  assert.throws(() => writeTres({ 'walk-down': clip() }), /must match \[A-Za-z0-9_\]\+/)
  assert.throws(() => writeTres({ walk_down: clip({ fps: 0 }) }), /fps must be a finite number greater than 0/)
  assert.throws(() => writeTres({ walk_down: clip({ fps: Number.NaN }) }), /fps must be a finite number greater than 0/)
  assert.throws(() => writeTres({ walk_down: clip({ frames: [64] }) }), /frame index 64 is outside the sheet/)
  assert.throws(
    () => buildGodotSpriteFramesTres(animationsDocument(undefined, { sheet_size: { w: 100, h: 96 } }), { packId: 'pack' }),
    /must divide evenly by frame_size/,
  )
  assert.throws(() => buildGodotSpriteFramesTres(animationsDocument(), {}), /metadata.id is required/)
  assert.throws(() => buildGodotSpriteFramesTres(animationsDocument(), { packId: '../escape' }), /metadata.id must match/)
})

test('files map copies the sheet bytes beside the tres and leaves the NPC pack paths alone', async () => {
  const sheetPng = Buffer.from('normalized-sheet-bytes')
  const animationsJson = buildAnimationsJson()
  const spriteFrames = buildGodotSpriteFramesExport({ metadata: metadata(), animationsJson, sheetPng })
  const tresPath = `${GODOT_SPRITEFRAMES_V0.folderRoot}/${PACK_ID}/${GODOT_SPRITEFRAMES_V0.resourceFileName}`
  const sheetPath = `${GODOT_SPRITEFRAMES_V0.folderRoot}/${PACK_ID}/normalized_sheet.png`

  assert.equal(spriteFrames.exportProfile, 'godot_spriteframes_v0')
  assert.deepEqual(Object.keys(spriteFrames.files).sort(), [sheetPath, tresPath].sort())
  assert.equal(spriteFrames.files[tresPath].toString('utf8'), spriteFrames.tres)
  assert.equal(spriteFrames.files[sheetPath], sheetPng)

  const spriteZip = await JSZip.loadAsync(await buildCharacterPackZip(spriteFrames.files))
  assert.deepEqual(
    Object.keys(spriteZip.files).filter((name) => !name.endsWith('/')).sort(),
    [sheetPath, tresPath].sort(),
  )
  assert.equal(await spriteZip.file(tresPath).async('string'), spriteFrames.tres)
  assert.deepEqual(Buffer.from(await spriteZip.file(sheetPath).async('nodebuffer')), sheetPng)

  const npc = buildGodotNpcExport({
    metadata: metadata(),
    spritePng: Buffer.from('sprite'),
    thumbPng: Buffer.from('thumb'),
  })
  const npcNames = [
    `AI资源库/一图全动作/${PACK_ID}/npc.json`,
    `AI资源库/一图全动作/${PACK_ID}/sprite.png`,
    `AI资源库/一图全动作/${PACK_ID}/thumb.png`,
  ]
  assert.deepEqual(Object.keys(npc.files).sort(), [...npcNames].sort())
  const npcZip = await JSZip.loadAsync(await buildCharacterPackZip(npc.files))
  assert.deepEqual(
    Object.keys(npcZip.files).filter((name) => !name.endsWith('/')).sort(),
    [...npcNames].sort(),
  )
  assert.equal(npcNames.some((name) => name in spriteFrames.files), false)
  assert.equal(Object.keys(spriteFrames.files).some((name) => name.startsWith('AI资源库/')), false)
})

test('public overlay restores the serializer, fixture, and spec', async () => {
  const overlayUrl = new URL('../../configs/public-overlay.json', import.meta.url)
  const docUrl = new URL('../../docs/releases/public-overlay.md', import.meta.url)
  const overlay = JSON.parse(await readFile(overlayUrl, 'utf8'))
  const doc = await readFile(docUrl, 'utf8')
  const required = [
    'docs/protocols/godot-spriteframes-tres-v0.md',
    'src/character-pack/exporters/godotSpriteFramesExport.js',
    'test/character-pack/godotSpriteFramesExport.test.js',
    'test/fixtures/character-pack/godot-spriteframes-v0/topdown_rpg_v0.tres',
  ]

  for (const requiredPath of required) {
    assert.equal(overlay.overlays.some((entry) => entry.path === requiredPath), true, requiredPath)
    assert.equal(doc.includes(requiredPath), true, requiredPath)
  }
})
