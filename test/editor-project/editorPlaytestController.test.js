import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPlaytestControllerState,
  resolvePlaytestScenePlayerLayer,
  resolveDirectionalClip,
  tickPlaytestController,
  transitionPlaytestControllerScene,
} from '../../src/editor-project/playtestController.js'
import { createLayerDocument, createSceneDocument } from '../../src/editor-project/index.js'

const timestamp = '2026-07-10T00:00:00.000Z'

function makeScene({
  world = { w: 640, h: 480 },
  viewport = { w: 320, h: 240 },
  camera = { x: 0, y: 0, zoom: 1 },
  playerPosition = { x: 100, y: 100 },
  clipId = 'idle_down',
} = {}) {
  return createSceneDocument({
    id: 'scene_main',
    name: 'Main Scene',
    world,
    viewport,
    camera,
    createdAt: timestamp,
    updatedAt: timestamp,
    layers: [createLayerDocument({
      id: 'layer_player',
      name: 'Player',
      type: 'character',
      assetId: 'asset_hero',
      clipId,
      transform: {
        position: playerPosition,
        scale: { x: 1, y: 1 },
        rotation_deg: 0,
        pivot: { mode: 'artifact_anchor', name: 'feet', x: null, y: null },
        coordinate_space: 'world',
        flip_x: false,
        flip_y: false,
      },
    })],
  })
}

function makeAsset() {
  const clips = {}
  for (const direction of ['down', 'up', 'left', 'right']) {
    clips[`walk_${direction}`] = { id: `walk_${direction}`, frames: [0, 1], fps: 8 }
    clips[`idle_${direction}`] = { id: `idle_${direction}`, frames: [2], fps: 4 }
  }
  return { id: 'asset_hero', clips }
}

test('playtest controller state uses scene position and safe runtime defaults', () => {
  const scene = makeScene({ camera: { x: 12, y: 14, zoom: 1.5 } })
  const state = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })

  assert.deepEqual(state, {
    player: {
      layer_id: 'layer_player',
      x: 100,
      y: 100,
      direction: 'down',
      moving: false,
      clip_id: 'idle_down',
    },
    camera: { x: 12, y: 14, zoom: 1.5, velocity: { x: 0, y: 0 } },
    options: {
      moveSpeed: 72,
      animationRate: 1,
      movingFollowSeconds: 0.18,
      stoppedSettleSeconds: 0.3,
      cameraClamp: true,
    },
    diagnostics: [],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)

  const unsafeZoom = createPlaytestControllerState({
    scene: makeScene({ camera: { x: 0, y: 0, zoom: Number.NaN } }),
    playerLayerId: 'layer_player',
  })
  assert.equal(unsafeZoom.camera.zoom, 1)
})

test('scene transitions only continue with a visible matching Character Pack player layer', () => {
  const sourceScene = makeScene()
  const sameIdTarget = makeScene({ playerPosition: { x: 24, y: 32 } })
  const renamedTarget = {
    ...makeScene({ playerPosition: { x: 48, y: 64 } }),
    layers: [{
      ...makeScene({ playerPosition: { x: 48, y: 64 } }).layers[0],
      id: 'layer_room_player',
    }],
  }
  const assets = { asset_hero: { kind: 'character_pack' } }

  assert.equal(
    resolvePlaytestScenePlayerLayer(sourceScene, sameIdTarget, 'layer_player', assets)?.id,
    'layer_player',
  )
  assert.equal(
    resolvePlaytestScenePlayerLayer(sourceScene, renamedTarget, 'layer_player', assets)?.id,
    'layer_room_player',
  )
  assert.equal(
    resolvePlaytestScenePlayerLayer(sourceScene, {
      ...renamedTarget,
      layers: [{ ...renamedTarget.layers[0], visible: false }],
    }, 'layer_player', assets),
    null,
  )
  assert.equal(
    resolvePlaytestScenePlayerLayer(sourceScene, {
      ...renamedTarget,
      layers: [{ ...renamedTarget.layers[0], asset_id: 'asset_other' }],
    }, 'layer_player', assets),
    null,
  )

  const runtime = {
    ...createPlaytestControllerState({ scene: sourceScene, playerLayerId: 'layer_player' }),
    activeSceneId: sourceScene.id,
    flags: { door_open: true },
    player: {
      ...createPlaytestControllerState({ scene: sourceScene, playerLayerId: 'layer_player' }).player,
      x: 24,
      y: 32,
    },
  }
  const transitioned = transitionPlaytestControllerScene(runtime, sourceScene, renamedTarget, assets)
  assert.equal(transitioned.activeSceneId, renamedTarget.id)
  assert.deepEqual({
    layer_id: transitioned.player.layer_id,
    x: transitioned.player.x,
    y: transitioned.player.y,
  }, {
    layer_id: 'layer_room_player',
    x: 24,
    y: 32,
  })
  assert.deepEqual(transitioned.flags, { door_open: true })
  assert.equal(transitionPlaytestControllerScene(runtime, sourceScene, {
    ...renamedTarget,
    layers: [],
  }, assets), null)
})

test('playtest controller moves with WASD and arrows while retaining facing when stopped', () => {
  const scene = makeScene()
  const assets = { asset_hero: makeAsset() }
  let state = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })

  state = tickPlaytestController(state, new Set(['d']), 100, scene, assets)
  assert.equal(state.player.x, 107.2)
  assert.equal(state.player.y, 100)
  assert.equal(state.player.direction, 'right')
  assert.equal(state.player.moving, true)
  assert.equal(state.player.clip_id, 'walk_right')

  state = tickPlaytestController(state, new Set(['ArrowUp']), 100, scene, assets)
  assert.equal(state.player.x, 107.2)
  assert.equal(state.player.y, 92.8)
  assert.equal(state.player.direction, 'up')
  assert.equal(state.player.clip_id, 'walk_up')

  state = tickPlaytestController(state, new Set(), 100, scene, assets)
  assert.equal(state.player.direction, 'up')
  assert.equal(state.player.moving, false)
  assert.equal(state.player.clip_id, 'idle_up')
})

test('playtest controller normalizes diagonal movement and safely clamps delta time', () => {
  const scene = makeScene({ playerPosition: { x: 320, y: 240 } })
  const assets = { asset_hero: makeAsset() }
  const initial = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })
  const diagonal = tickPlaytestController(initial, new Set(['w', 'd']), 100, scene, assets)
  const expectedAxisDistance = 7.2 / Math.sqrt(2)

  assert.ok(Math.abs(diagonal.player.x - (320 + expectedAxisDistance)) < 1e-9)
  assert.ok(Math.abs(diagonal.player.y - (240 - expectedAxisDistance)) < 1e-9)
  assert.ok(Math.abs(Math.hypot(diagonal.player.x - 320, diagonal.player.y - 240) - 7.2) < 1e-9)

  const clampedDelta = tickPlaytestController(initial, new Set(['d']), 1000, scene, assets)
  assert.equal(clampedDelta.player.x, 327.2)
  const invalidDelta = tickPlaytestController(initial, new Set(['d']), Number.NaN, scene, assets)
  assert.equal(invalidDelta.player.x, 320)
})

test('playtest controller clamps the player and camera to scene world bounds', () => {
  const scene = makeScene({
    world: { w: 200, h: 150 },
    viewport: { w: 100, h: 80 },
    camera: { x: 100, y: 70, zoom: 1 },
    playerPosition: { x: 198, y: 149 },
  })
  const state = createPlaytestControllerState({
    scene,
    playerLayerId: 'layer_player',
    options: { movingFollowSeconds: 0.0001 },
  })
  const next = tickPlaytestController(state, new Set(['d', 's']), 100, scene, { asset_hero: makeAsset() })

  assert.deepEqual({ x: next.player.x, y: next.player.y }, { x: 200, y: 150 })
  assert.ok(next.camera.x >= 0 && next.camera.x <= 100)
  assert.ok(next.camera.y >= 0 && next.camera.y <= 70)
  assert.equal(next.camera.x, 100)
  assert.equal(next.camera.y, 70)
})

test('directional clip resolver supports clip maps and loaded animation descriptor shapes', () => {
  assert.deepEqual(resolveDirectionalClip(makeAsset(), 'left', true, 'idle_down'), {
    clip_id: 'walk_left',
    requested_clip_id: 'walk_left',
    issue: null,
  })
  assert.equal(
    resolveDirectionalClip({ animations: [{ name: 'walk_right' }] }, 'right', true, null).clip_id,
    'walk_right',
  )
  assert.equal(
    resolveDirectionalClip({ animations: { idle_up: { frames: [0] } } }, 'up', false, null).clip_id,
    'idle_up',
  )

  const missingLeft = resolveDirectionalClip(
    {
      clips: {
        walk_right: { id: 'walk_right', frames: [0] },
        idle_down: { id: 'idle_down', frames: [1] },
      },
    },
    'left',
    true,
    'idle_down',
  )
  assert.deepEqual(missingLeft, {
    clip_id: 'idle_down',
    requested_clip_id: 'walk_left',
    issue: 'missing_directional_clip',
  })

  const missingFallback = resolveDirectionalClip(
    { clips: { walk_right: { id: 'walk_right', frames: [0] } } },
    'left',
    true,
    'idle_down',
  )
  assert.deepEqual(missingFallback, {
    clip_id: null,
    requested_clip_id: 'walk_left',
    issue: 'missing_directional_clip',
  })
})

test('missing directional clips preserve the last clip and surface a diagnostic without mirroring', () => {
  const scene = makeScene({ clipId: 'idle_down' })
  const state = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })
  const next = tickPlaytestController(
    state,
    new Set(['a']),
    100,
    scene,
    {
      asset_hero: {
        clips: {
          walk_right: { id: 'walk_right', frames: [0] },
          idle_down: { id: 'idle_down', frames: [1] },
        },
      },
    },
  )

  assert.equal(next.player.direction, 'left')
  assert.equal(next.player.clip_id, 'idle_down')
  assert.deepEqual(next.diagnostics, ['missing_directional_clip'])
})

test('camera follows moving and stopped players with stable non-overshooting responses', () => {
  const scene = makeScene({
    world: { w: 1000, h: 1000 },
    viewport: { w: 100, h: 100 },
    playerPosition: { x: 100, y: 100 },
  })
  const assets = { asset_hero: makeAsset() }
  const initial = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })
  const moving = tickPlaytestController(initial, new Set(['ArrowUp']), 100, scene, assets)
  const stopped = tickPlaytestController(initial, new Set(), 100, scene, assets)

  assert.ok(moving.camera.x > stopped.camera.x)
  assert.ok(stopped.camera.x > 0)
  assert.ok(moving.camera.x < 50)
  assert.ok(moving.camera.velocity.x > stopped.camera.velocity.x)
  assert.ok(stopped.camera.velocity.x > 0)

  let settling = moving
  for (let index = 0; index < 50; index += 1) {
    settling = tickPlaytestController(settling, new Set(), 100, scene, assets)
    assert.ok(settling.camera.x <= 50)
  }
  assert.ok(settling.camera.x > 49.99)
})

test('camera clamp clears velocity that continues out of world bounds', () => {
  const scene = makeScene({
    world: { w: 200, h: 150 },
    viewport: { w: 100, h: 80 },
    camera: { x: 100, y: 70, zoom: 1 },
    playerPosition: { x: 200, y: 150 },
  })
  const initial = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })
  const state = {
    ...initial,
    camera: {
      ...initial.camera,
      velocity: { x: 120, y: 90 },
    },
  }
  const next = tickPlaytestController(state, new Set(['d', 's']), 100, scene, { asset_hero: makeAsset() })

  assert.equal(next.camera.x, 100)
  assert.equal(next.camera.y, 70)
  assert.deepEqual(next.camera.velocity, { x: 0, y: 0 })
})

test('extremely small positive camera response times remain finite', () => {
  const scene = makeScene({
    world: { w: 1000, h: 1000 },
    viewport: { w: 100, h: 100 },
    playerPosition: { x: 100, y: 100 },
  })
  const state = createPlaytestControllerState({
    scene,
    playerLayerId: 'layer_player',
    options: {
      movingFollowSeconds: Number.MIN_VALUE,
      stoppedSettleSeconds: Number.MIN_VALUE,
    },
  })
  const moving = tickPlaytestController(state, new Set(['ArrowUp']), 16, scene, { asset_hero: makeAsset() })
  const stopped = tickPlaytestController(moving, new Set(), 16, scene, { asset_hero: makeAsset() })

  assert.equal(state.options.movingFollowSeconds, 0.001)
  assert.equal(state.options.stoppedSettleSeconds, 0.001)
  for (const value of [
    moving.camera.x,
    moving.camera.y,
    moving.camera.velocity.x,
    moving.camera.velocity.y,
    stopped.camera.x,
    stopped.camera.y,
    stopped.camera.velocity.x,
    stopped.camera.velocity.y,
  ]) {
    assert.equal(Number.isFinite(value), true)
  }
})

test('ticks return independent serializable runtime state without mutating scene or input state', () => {
  const scene = makeScene()
  const assets = { asset_hero: makeAsset() }
  const state = createPlaytestControllerState({ scene, playerLayerId: 'layer_player' })
  const stateSnapshot = structuredClone(state)
  const sceneSnapshot = structuredClone(scene)
  const assetsSnapshot = structuredClone(assets)
  const pressedKeys = new Set(['d'])
  const pressedKeysSnapshot = [...pressedKeys]

  const next = tickPlaytestController(state, pressedKeys, 16, scene, assets)

  assert.notEqual(next, state)
  assert.notEqual(next.player, state.player)
  assert.notEqual(next.camera, state.camera)
  assert.deepEqual(state, stateSnapshot)
  assert.deepEqual(scene, sceneSnapshot)
  assert.deepEqual(assets, assetsSnapshot)
  assert.deepEqual([...pressedKeys], pressedKeysSnapshot)
  assert.deepEqual(JSON.parse(JSON.stringify(state)), stateSnapshot)
})
