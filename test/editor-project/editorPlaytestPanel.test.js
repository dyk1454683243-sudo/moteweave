import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import * as playtestPanel from '../../src/ui/editor/playtestPanel.js'

const {
  DEFAULT_PLAYTEST_OPTIONS,
  canUsePlaytestInteractions,
  getPlaytestPanelState,
  playerLayerOptions,
} = playtestPanel

function fixture() {
  const hero = {
    id: 'asset_hero',
    kind: 'character_pack',
    active_revision_id: 'rev_001',
    clips: { idle_down: { id: 'idle_down', frames: [0] } },
  }
  const ground = {
    id: 'asset_ground',
    kind: 'scene_pack',
    active_revision_id: 'rev_001',
    clips: {},
  }
  const scene = {
    id: 'scene_main',
    layers: [
      { id: 'layer_ground', name: 'Ground', type: 'tilemap', asset_id: ground.id },
      { id: 'layer_hero', name: 'Hero', type: 'character', asset_id: hero.id },
    ],
  }
  return {
    project: { id: 'project_demo', active_scene_id: scene.id, assets: { [hero.id]: hero, [ground.id]: ground } },
    scene,
    assets: { [hero.id]: hero, [ground.id]: ground },
    renderAssets: {
      status: 'ready',
      result: {
        byAssetId: {
          [hero.id]: { status: 'ready', kind: hero.kind },
          [ground.id]: { status: 'ready', kind: ground.kind },
        },
        diagnostics: [],
      },
    },
  }
}

test('playtest defaults remain ephemeral and match the approved controls', () => {
  assert.deepEqual(DEFAULT_PLAYTEST_OPTIONS, {
    moveSpeed: 72,
    animationRate: 1,
    movingFollowSeconds: 0.18,
    stoppedSettleSeconds: 0.3,
    cameraClamp: true,
  })
})

test('player layer options only expose Character Pack character layers', () => {
  const value = fixture()
  assert.deepEqual(playerLayerOptions(value.scene, value.assets), [{ value: 'layer_hero', label: 'Hero' }])
})

test('a hidden character player layer blocks Start and interaction shortcuts', () => {
  const value = fixture()
  value.scene.layers[1].visible = false

  const hiddenPlayer = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: value.renderAssets,
  })

  assert.equal(hiddenPlayer.status, 'blocked_player')
  assert.equal(hiddenPlayer.canStart, false)
  assert.equal(canUsePlaytestInteractions(hiddenPlayer), false)
})

test('interaction result summary exposes real runtime effects and an explicit empty state', () => {
  assert.equal(typeof playtestPanel.getInteractionResultSummary, 'function')

  assert.deepEqual(playtestPanel.getInteractionResultSummary(null), {
    empty: true,
    latestMessage: '',
    flags: [],
    inventory: [],
    layerOverrides: [],
  })

  assert.deepEqual(playtestPanel.getInteractionResultSummary({
    messages: [{ text: 'Door opens' }, { text: 'Older message' }],
    flags: { door_open: true, quest_stage: 'entry' },
    inventory: [{ item_id: 'rusty_key', quantity: 2 }],
    layerOverrides: {
      layer_key: { visible: false },
      layer_door: { clip_id: 'open', playing: true },
    },
  }), {
    empty: false,
    latestMessage: 'Door opens',
    flags: ['door_open=true', 'quest_stage=entry'],
    inventory: ['rusty_key ×2'],
    layerOverrides: ['layer_key: hidden', 'layer_door: clip=open, playing'],
  })
})

test('interaction results are rendered inside the existing collapsed Interaction events section', async () => {
  const source = await readFile(new URL('../../src/ui/editor/playtestPanel.js', import.meta.url), 'utf8')
  assert.match(source, /details\.append\(fields, actions, renderInteractionResults\(documentRef, config\.playtest\?\.runtime\)\)/)
  assert.match(source, /renderInteractionEvents\(documentRef, config, !canUsePlaytestInteractions\(state\)\)/)
})

test('interaction controls cannot bypass a blocked player but remain usable while running', () => {
  const value = fixture()
  const ready = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: value.renderAssets,
  })
  assert.equal(canUsePlaytestInteractions(ready), true)

  const blocked = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: {
      status: 'error',
      result: {
        byAssetId: { asset_hero: { status: 'error' } },
        diagnostics: [{ code: 'asset_load_failed', asset_id: 'asset_hero' }],
      },
    },
  })
  assert.equal(canUsePlaytestInteractions(blocked), false)

  const running = getPlaytestPanelState({
    ...value,
    playtest: {
      playerLayerId: 'layer_hero',
      running: true,
      runtime: { diagnostics: [], player: { clip_id: 'idle_down' } },
    },
    sceneRender: value.renderAssets,
  })
  assert.equal(canUsePlaytestInteractions(running), true)
})

test('playtest panel state covers empty, loading, blocked, partial, ready, and running states', () => {
  const value = fixture()
  assert.equal(getPlaytestPanelState({}).status, 'no_project')
  assert.equal(getPlaytestPanelState({ project: value.project }).status, 'no_scene')
  assert.equal(getPlaytestPanelState({
    ...value,
    sceneRender: value.renderAssets,
    scene: { ...value.scene, layers: [value.scene.layers[0]] },
  }).status, 'no_player')

  const loading = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: { status: 'loading', result: null },
  })
  assert.equal(loading.status, 'loading')
  assert.equal(loading.canStart, false)

  const blocked = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: {
      status: 'error',
      result: { byAssetId: { asset_hero: { status: 'error' } }, diagnostics: [{ code: 'asset_load_failed', asset_id: 'asset_hero' }] },
    },
  })
  assert.equal(blocked.status, 'blocked_player')
  assert.equal(blocked.canStart, false)

  const qualityBlockedValue = fixture()
  qualityBlockedValue.assets.asset_hero.revisions = {
    rev_001: { id: 'rev_001', quality_status: 'fail', production_status: 'blocked', artifacts: {} },
  }
  const qualityBlocked = getPlaytestPanelState({
    ...qualityBlockedValue,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: qualityBlockedValue.renderAssets,
  })
  assert.equal(qualityBlocked.status, 'blocked_player')
  assert.equal(qualityBlocked.canStart, false)

  const partial = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: {
      status: 'partial',
      result: {
        byAssetId: { asset_hero: { status: 'ready' }, asset_ground: { status: 'error' } },
        diagnostics: [{ code: 'asset_load_failed', asset_id: 'asset_ground' }],
      },
    },
  })
  assert.equal(partial.status, 'partial')
  assert.equal(partial.canStart, true)

  const ready = getPlaytestPanelState({
    ...value,
    playtest: { playerLayerId: 'layer_hero', running: false },
    sceneRender: value.renderAssets,
  })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.canStart, true)

  const running = getPlaytestPanelState({
    ...value,
    playtest: {
      playerLayerId: 'layer_hero',
      running: true,
      runtime: { diagnostics: [], player: { clip_id: 'idle_down' } },
    },
    sceneRender: value.renderAssets,
  })
  assert.equal(running.status, 'running')
  assert.equal(running.canStart, false)
  assert.equal(running.canStop, true)

  const missingClip = getPlaytestPanelState({
    ...value,
    playtest: {
      playerLayerId: 'layer_hero',
      running: true,
      runtime: { diagnostics: ['missing_directional_clip'], player: { clip_id: 'idle_down' } },
    },
    sceneRender: value.renderAssets,
  })
  assert.equal(missingClip.status, 'missing_clip')
  assert.equal(missingClip.canStop, true)
})
