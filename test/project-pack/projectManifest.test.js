import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildProjectManifest,
  validateProjectManifest,
} from '../../src/project-pack/projectManifest.js'

const styleContract = {
  mode: 'shared_reference',
  source: 'pixel_style_report',
  palette: {
    max_colors: 2,
    colors: [
      { hex: '#102030', rgb: [16, 32, 48], count: 10, ratio: 0.5 },
      { hex: '#c86420', rgb: [200, 100, 32], count: 10, ratio: 0.5 },
    ],
  },
}

test('buildProjectManifest joins character and scene packs under one style contract', () => {
  const manifest = buildProjectManifest({
    projectId: 'demo_project',
    createdAt: '2026-06-05T00:00:00.000Z',
    characterPack: {
      id: 'hero_pack',
      profile: 'topdown_rpg_v0',
      artifacts: {
        sheet: 'character/normalized_sheet.png',
        animations: 'character/animations.json',
      },
    },
    scenePack: {
      id: 'meadow_scene',
      profile: 'topdown_tile_dual_grid_v0',
      artifacts: {
        scene: 'scene/scene.json',
        tileset: 'scene/tiles.png',
      },
    },
    styleContract,
  })

  assert.deepEqual(manifest, {
    version: 'scene_character_project_v0',
    project_id: 'demo_project',
    created_at: '2026-06-05T00:00:00.000Z',
    packs: {
      character: {
        id: 'hero_pack',
        profile: 'topdown_rpg_v0',
        artifacts: {
          sheet: 'character/normalized_sheet.png',
          animations: 'character/animations.json',
        },
      },
      scene: {
        id: 'meadow_scene',
        profile: 'topdown_tile_dual_grid_v0',
        artifacts: {
          scene: 'scene/scene.json',
          tileset: 'scene/tiles.png',
        },
      },
    },
    style_contract: styleContract,
  })
})

test('validateProjectManifest requires character, scene, and shared style sections', () => {
  const valid = validateProjectManifest(buildProjectManifest({
    projectId: 'demo_project',
    characterPack: { id: 'hero_pack', profile: 'topdown_rpg_v0' },
    scenePack: { id: 'meadow_scene', profile: 'topdown_tile_dual_grid_v0' },
    styleContract,
  }))

  assert.equal(valid.status, 'pass')
  assert.deepEqual(valid.blocking_errors, [])

  const invalid = validateProjectManifest({
    version: 'scene_character_project_v0',
    project_id: 'broken_project',
    packs: {
      character: { id: 'hero_pack', profile: 'topdown_rpg_v0' },
    },
  })

  assert.equal(invalid.status, 'fail')
  assert.deepEqual(invalid.blocking_errors, ['missing_scene_pack', 'missing_style_contract'])
})
