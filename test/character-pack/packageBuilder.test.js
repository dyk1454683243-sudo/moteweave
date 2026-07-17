import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { buildAnimationsJson, buildEditorMetadataJson, buildMetadataJson, buildPackageId } from '../../src/character-pack/packageBuilder.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayouts.js'

test('buildPackageId creates stable filesystem-safe ids', () => {
  const id = buildPackageId('Green Priestess!', '2026-05-24T01:02:03+08:00')
  assert.equal(id, 'npc_20260524_010203_green_priestess')
})

test('buildPackageId formats Date inputs in UTC for host-timezone stability', () => {
  const id = buildPackageId('Green Priestess!', new Date('2026-05-24T01:02:03+08:00'))
  assert.equal(id, 'npc_20260523_170203_green_priestess')
})

test('buildAnimationsJson emits runtime contract', () => {
  const result = buildAnimationsJson()
  assert.equal(result.version, '0.1')
  assert.equal(result.profile, 'topdown_rpg_v0')
  assert.deepEqual(result.frame_size, { w: 96, h: 96 })
  assert.deepEqual(result.sheet_size, { w: 768, h: 768 })
  assert.deepEqual(result.anchor, { x: 48, y: 88 })
  assert.deepEqual(result.animations.attack_up.frames, [36, 37, 38, 39])
  assert.equal(result.animations.attack_up.flip_h, false)
})

test('buildMetadataJson records upload and quality context', () => {
  const result = buildMetadataJson({
    id: 'npc_20260524_010203_green_priestess',
    name: 'Green Priestess',
    description: 'green robe',
    createdAt: '2026-05-24T01:02:03+08:00',
    source: { type: 'upload', file_name: 'source.png' },
    quality: { status: 'warning', warnings: ['source_jpeg'], blocking_errors: [] },
  })
  assert.equal(result.id, 'npc_20260524_010203_green_priestess')
  assert.equal(result.profile, 'topdown_rpg_v0')
  assert.equal(result.quality.status, 'warning')
  assert.deepEqual(result.generation, { provider: null, model: null, prompt_file: null })
})

test('buildEditorMetadataJson emits frame tags and frame-space attachment metadata', () => {
  const result = buildEditorMetadataJson({
    metadata: { id: 'pack' },
    animationsJson: buildAnimationsJson(TOPDOWN_RPG_V0),
    frames: [
      {
        index: 16,
        normalized_bbox: { x: 42, y: 40, w: 13, h: 49, right: 54, bottom: 88, centerX: 48.5, centerY: 64.5 },
        normalized_anchor: { x: 48, y: 88 },
        source_anchor: { x: 8, y: 12 },
        source_meta: { source_layout: 'topdown_rpg_v0', runtime_action: 'walk_down' },
      },
    ],
    profile: TOPDOWN_RPG_V0,
  })

  assert.equal(result.version, '0.1')
  assert.equal(result.profile, 'topdown_rpg_v0')
  assert.equal(result.sheet, 'normalized_sheet.png')
  assert.deepEqual(result.frame_size, { w: 96, h: 96 })
  assert.deepEqual(result.sheet_size, { w: 768, h: 768 })
  assert.ok(result.frame_tags.some((tag) => tag.name === 'walk_down' && tag.from === 16 && tag.to === 19 && tag.direction === 'forward'))
  assert.equal(result.frames.frame_016.runtime_action, 'walk_down')
  assert.deepEqual(result.frames.frame_016.frame, { x: 0, y: 192, w: 96, h: 96 })
  assert.equal(result.frames.frame_016.duration, 100)
  assert.deepEqual(result.frames.frame_016.source, { layout: 'topdown_rpg_v0', runtime_action: 'walk_down' })
  assert.ok(result.attachments.some((point) => point.name === 'feet' && point.frame === 16 && point.point.x === 48 && point.point.y === 88))
  assert.ok(result.attachments.some((point) => point.name === 'head' && point.frame === 16 && point.point.x === 49 && point.point.y === 40))
  assert.ok(result.attachments.some((point) => point.name === 'source_feet' && point.frame === 16 && point.point.x === 8 && point.point.y === 12))
  assert.ok(result.slices.some((slice) => slice.name === 'frame_016_bounds' && slice.rect.x === 42 && slice.rect.h === 49))
})

test('buildEditorMetadataJson preserves fixed-region source provenance', () => {
  const result = buildEditorMetadataJson({
    metadata: { id: 'pack' },
    animationsJson: buildAnimationsJson(TOPDOWN_RPG_V0),
    frames: [
      {
        index: 36,
        normalized_bbox: { x: 40, y: 38, w: 16, h: 50, right: 55, bottom: 87, centerX: 47.5, centerY: 62.5 },
        normalized_anchor: { x: 48, y: 88 },
        source_meta: {
          source_layout: FIXED_REGION_MOTION_LAYOUT_ID,
          runtime_action: 'attack_up',
          source_action: 'climb',
          source_region_key: 'climb0',
          source_frame: 0,
          flip_h: false,
        },
      },
    ],
    profile: TOPDOWN_RPG_V0,
  })

  assert.equal(result.frames.frame_036.source.layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.frames.frame_036.source.region_key, 'climb0')
  assert.equal(result.frames.frame_036.source.action, 'climb')
  assert.equal(result.frames.frame_036.source.flip_h, false)
})
