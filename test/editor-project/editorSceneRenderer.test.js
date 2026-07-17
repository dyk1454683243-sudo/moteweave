import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSceneRenderAssetCache,
  loadSceneRenderAssets,
  renderEditorSceneFrame,
} from '../../src/ui/editor/sceneRenderer.js'
import { fitSceneToStage } from '../../src/ui/editor/sceneCanvas.js'

function revision(id, artifacts) {
  return {
    id,
    quality_status: 'pass',
    production_status: 'ready',
    artifacts,
  }
}

function characterAsset({ id = 'asset_hero', revisionId = 'rev_001' } = {}) {
  return {
    id,
    kind: 'character_pack',
    name: 'Hero',
    active_revision_id: revisionId,
    revisions: {
      [revisionId]: revision(revisionId, {
        sheet: `workspace/projects/project_demo/assets/${id}/${revisionId}/normalized_sheet.png`,
      }),
    },
    clips: {
      walk_down: {
        id: 'walk_down',
        frames: [0, 1, 2, 3],
        fps: 8,
        loop_mode: 'loop',
        frame_size: { w: 16, h: 24 },
        anchor: { x: 8, y: 20 },
      },
      walk_right: {
        id: 'walk_right',
        frames: [4, 5],
        fps: 8,
        loop_mode: 'loop',
        frame_size: { w: 16, h: 24 },
        anchor: { x: 6, y: 22 },
      },
    },
  }
}

function sceneAsset({ id = 'asset_ground', revisionId = 'rev_001' } = {}) {
  return {
    id,
    kind: 'scene_pack',
    name: 'Ground',
    active_revision_id: revisionId,
    revisions: {
      [revisionId]: revision(revisionId, {
        tile_map: `workspace/projects/project_demo/assets/${id}/${revisionId}/tile_map.json`,
        tile_atlas: `workspace/projects/project_demo/assets/${id}/${revisionId}/tile_atlas.json`,
        preview: `workspace/projects/project_demo/assets/${id}/${revisionId}/tileset.png`,
      }),
    },
    clips: {},
  }
}

function layer({
  id,
  assetId,
  type,
  clipId,
  x = 0,
  y = 0,
  z = 0,
  opacity = 1,
  visible = true,
  scale = { x: 1, y: 1 },
  flipX = false,
  flipY = false,
  pivot,
} = {}) {
  return {
    id,
    name: id,
    type,
    asset_id: assetId,
    ...(clipId ? { clip_id: clipId } : {}),
    visible,
    transform: {
      position: { x, y },
      scale,
      rotation_deg: 0,
      pivot: pivot ?? (type === 'tilemap'
        ? { mode: 'top_left', name: null, x: null, y: null }
        : { mode: 'artifact_anchor', name: 'feet', x: null, y: null }),
      coordinate_space: 'world',
      flip_x: flipX,
      flip_y: flipY,
    },
    render: {
      z_index: z,
      opacity,
      parallax: 1,
      blend_mode: 'normal',
    },
  }
}

function scene(layers) {
  return {
    id: 'scene_main',
    world: { w: 320, h: 180 },
    viewport: { w: 160, h: 90 },
    camera: { x: 0, y: 0, zoom: 1 },
    background: '#123456',
    layers,
  }
}

function tileMap() {
  return {
    tile_size: { w: 32, h: 32 },
    width: 2,
    height: 1,
    cells: [
      { x: 0, y: 0, mask: 6, tile_id: 'mask_6' },
      { x: 1, y: 0, mask: 9, tile_id: 'mask_9' },
    ],
  }
}

function tileAtlas() {
  return {
    tile_size: { w: 32, h: 32 },
    tiles: [
      { id: 'mask_6', index: 6, mask: 6, source: { x: 104, y: 56, w: 32, h: 32 } },
      { id: 'mask_9', index: 9, mask: 9, source: { x: 56, y: 104, w: 32, h: 32 } },
    ],
  }
}

function createContextMock() {
  const calls = []
  const context = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '',
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillRect: (...args) => calls.push(['fillRect', context.fillStyle, ...args]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...args) => calls.push(['translate', ...args]),
    rotate: (...args) => calls.push(['rotate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    drawImage: (...args) => calls.push(['drawImage', context.globalAlpha, ...args]),
  }
  return { context, calls }
}

function createCanvas(width = 640, height = 360) {
  const { context, calls } = createContextMock()
  return {
    canvas: { width, height, getContext: () => context },
    context,
    calls,
  }
}

test('render asset loading uses controlled URLs, only referenced assets, and revision cache entries', async () => {
  const hero = characterAsset()
  const ground = sceneAsset()
  const unused = characterAsset({ id: 'asset_unused' })
  const currentScene = scene([
    layer({ id: 'layer_ground', assetId: ground.id, type: 'tilemap' }),
    layer({ id: 'layer_hero', assetId: hero.id, type: 'character', clipId: 'walk_down' }),
  ])
  const assets = { [hero.id]: hero, [ground.id]: ground, [unused.id]: unused }
  const cache = createSceneRenderAssetCache()
  const jsonLoads = []
  const imageLoads = []
  const options = {
    cache,
    fetchJson: async (url) => {
      jsonLoads.push(url)
      return url.includes('tile_map') ? tileMap() : tileAtlas()
    },
    loadImage: async (url) => {
      imageLoads.push(url)
      return { src: url, width: url.includes('tileset') ? 192 : 64, height: url.includes('tileset') ? 192 : 48 }
    },
  }

  const first = await loadSceneRenderAssets(currentScene, assets, options)
  const second = await loadSceneRenderAssets(currentScene, assets, options)

  assert.equal(first.byAssetId.asset_hero.status, 'ready')
  assert.equal(first.byAssetId.asset_ground.status, 'ready')
  assert.equal(first.byAssetId.asset_unused, undefined)
  assert.equal(second.byAssetId.asset_hero, first.byAssetId.asset_hero)
  assert.equal(jsonLoads.length, 2)
  assert.equal(imageLoads.length, 2)
  assert.ok([...jsonLoads, ...imageLoads].every((url) => url.startsWith('/api/editor/artifact?path=')))

  hero.active_revision_id = 'rev_002'
  hero.revisions.rev_002 = revision('rev_002', {
    sheet: 'workspace/projects/project_demo/assets/asset_hero/rev_002/normalized_sheet.png',
  })
  const changed = await loadSceneRenderAssets(currentScene, assets, options)
  assert.equal(changed.byAssetId.asset_hero.revision_id, 'rev_002')
  assert.equal(imageLoads.length, 3)
  assert.equal(jsonLoads.length, 2)
})

test('render asset loading retries a local error without blocking or reloading ready layers', async () => {
  const hero = characterAsset()
  const ground = sceneAsset()
  const currentScene = scene([
    layer({ id: 'layer_ground', assetId: ground.id, type: 'tilemap' }),
    layer({ id: 'layer_hero', assetId: hero.id, type: 'character', clipId: 'walk_down' }),
  ])
  const cache = createSceneRenderAssetCache()
  let failedLoads = 0
  let heroAttempts = 0
  const options = {
    cache,
    fetchJson: async (url) => url.includes('tile_map') ? tileMap() : tileAtlas(),
    loadImage: async (url) => {
      if (url.includes('normalized_sheet')) {
        failedLoads += 1
        heroAttempts += 1
        if (heroAttempts === 1) throw new Error('sheet decode failed')
        return { src: url, width: 64, height: 48 }
      }
      return { src: url, width: 192, height: 192 }
    },
  }

  const first = await loadSceneRenderAssets(currentScene, { [hero.id]: hero, [ground.id]: ground }, options)
  const second = await loadSceneRenderAssets(currentScene, { [hero.id]: hero, [ground.id]: ground }, options)

  assert.equal(first.byAssetId.asset_ground.status, 'ready')
  assert.equal(first.byAssetId.asset_hero.status, 'error')
  assert.equal(second.byAssetId.asset_ground, first.byAssetId.asset_ground)
  assert.equal(second.byAssetId.asset_hero.status, 'ready')
  assert.equal(failedLoads, 2)
  assert.ok(first.diagnostics.some((item) => item.code === 'asset_load_failed' && item.asset_id === hero.id))
})

test('render asset cache keys include revision artifact identity across projects', async () => {
  const firstHero = characterAsset()
  const secondHero = structuredClone(firstHero)
  secondHero.revisions.rev_001.artifacts.sheet = 'workspace/projects/project_two/assets/asset_hero/rev_001/normalized_sheet.png'
  const currentScene = scene([layer({ id: 'layer_hero', assetId: firstHero.id, type: 'character', clipId: 'walk_down' })])
  const cache = createSceneRenderAssetCache()
  const imageLoads = []
  const options = {
    cache,
    fetchJson: async () => assert.fail('character assets do not fetch JSON'),
    loadImage: async (url) => {
      imageLoads.push(url)
      return { src: url, width: 64, height: 48 }
    },
  }

  const first = await loadSceneRenderAssets(currentScene, { [firstHero.id]: firstHero }, options)
  const second = await loadSceneRenderAssets(currentScene, { [secondHero.id]: secondHero }, options)

  assert.equal(imageLoads.length, 2)
  assert.notEqual(second.byAssetId.asset_hero, first.byAssetId.asset_hero)
  assert.notEqual(second.byAssetId.asset_hero.image.src, first.byAssetId.asset_hero.image.src)
})

test('render asset loading reports missing assets, revisions, artifacts, and unsupported kinds', async () => {
  const missingRevision = {
    ...characterAsset({ id: 'asset_revision' }),
    active_revision_id: 'rev_missing',
  }
  const missingArtifact = characterAsset({ id: 'asset_artifact' })
  missingArtifact.revisions.rev_001.artifacts = {}
  const unsupported = {
    id: 'asset_static',
    kind: 'static_image',
    active_revision_id: 'rev_001',
    revisions: { rev_001: revision('rev_001', { image: 'workspace/static.png' }) },
    clips: {},
  }
  const currentScene = scene([
    layer({ id: 'layer_missing', assetId: 'asset_missing', type: 'prop' }),
    layer({ id: 'layer_revision', assetId: missingRevision.id, type: 'character' }),
    layer({ id: 'layer_artifact', assetId: missingArtifact.id, type: 'character' }),
    layer({ id: 'layer_static', assetId: unsupported.id, type: 'prop' }),
  ])

  const result = await loadSceneRenderAssets(currentScene, {
    [missingRevision.id]: missingRevision,
    [missingArtifact.id]: missingArtifact,
    [unsupported.id]: unsupported,
  }, {
    cache: createSceneRenderAssetCache(),
    fetchJson: async () => assert.fail('invalid assets must not fetch JSON'),
    loadImage: async () => assert.fail('invalid assets must not load images'),
  })

  assert.deepEqual(
    result.diagnostics.map((item) => item.code).sort(),
    ['missing_artifact', 'missing_asset', 'missing_revision', 'unsupported_asset_kind'].sort(),
  )
  assert.equal(result.byAssetId.asset_revision.status, 'error')
  assert.equal(result.byAssetId.asset_artifact.status, 'error')
  assert.equal(result.byAssetId.asset_static.status, 'error')
})

test('character rendering crops the animation frame and honors runtime position, anchor, scale, and flips', () => {
  const hero = characterAsset()
  const heroImage = { id: 'hero-sheet', width: 64, height: 48 }
  const currentScene = scene([
    layer({
      id: 'layer_hero',
      assetId: hero.id,
      type: 'character',
      clipId: 'walk_down',
      x: 40,
      y: 60,
      scale: { x: 2, y: 3 },
      flipX: true,
    }),
  ])
  const loaded = {
    byAssetId: {
      [hero.id]: { status: 'ready', kind: hero.kind, asset: hero, image: heroImage },
    },
    diagnostics: [],
  }
  const animationRuntime = {
    playing: true,
    layer_clocks: {
      layer_hero: { clip_id: 'walk_right', elapsed_ms: 125, layer_playing: true },
    },
  }
  const playtestRuntime = {
    running: true,
    camera: { x: 10, y: 20, zoom: 2 },
    player: { layer_id: 'layer_hero', x: 40, y: 42.5, clip_id: 'walk_right' },
  }
  const { canvas, context, calls } = createCanvas(320, 180)

  const result = renderEditorSceneFrame(canvas, currentScene, loaded, animationRuntime, playtestRuntime)

  const imageCall = calls.find((entry) => entry[0] === 'drawImage')
  assert.deepEqual(imageCall, [
    'drawImage', 1, heroImage,
    16, 24, 16, 24,
    -6, -22, 16, 24,
  ])
  assert.ok(calls.some((entry) => entry[0] === 'translate' && entry[1] === 120 && entry[2] === 90))
  assert.ok(calls.some((entry) => entry[0] === 'scale' && entry[1] === -8 && entry[2] === 12))
  assert.equal(context.imageSmoothingEnabled, false)
  assert.equal(result.view.mode, 'playtest')
  assert.deepEqual(result.view.camera, { x: 10, y: 20, zoom: 2 })
})

test('scene rendering draws tile atlas cells before same-z character layers in stable order', () => {
  const hero = characterAsset()
  const ground = sceneAsset()
  const tileImage = { id: 'tileset', width: 192, height: 192 }
  const heroImage = { id: 'hero-sheet', width: 64, height: 48 }
  const currentScene = scene([
    layer({ id: 'layer_hero', assetId: hero.id, type: 'character', clipId: 'walk_down', x: 80, y: 80, z: 10 }),
    layer({ id: 'layer_ground', assetId: ground.id, type: 'tilemap', x: 8, y: 16, z: 0, opacity: 0.5, scale: { x: 2, y: 2 } }),
    layer({ id: 'layer_second_hero', assetId: hero.id, type: 'character', clipId: 'walk_down', x: 100, y: 80, z: 10 }),
  ])
  const loaded = {
    byAssetId: {
      [hero.id]: { status: 'ready', kind: hero.kind, asset: hero, image: heroImage },
      [ground.id]: {
        status: 'ready',
        kind: ground.kind,
        asset: ground,
        image: tileImage,
        tile_map: tileMap(),
        tile_atlas: tileAtlas(),
      },
    },
    diagnostics: [],
  }
  const { canvas, calls } = createCanvas(368, 228)

  renderEditorSceneFrame(canvas, currentScene, loaded, {}, null)

  const draws = calls.filter((entry) => entry[0] === 'drawImage')
  assert.equal(draws.length, 4)
  assert.deepEqual(draws.slice(0, 2).map((entry) => entry.slice(0, 7)), [
    ['drawImage', 0.5, tileImage, 104, 56, 32, 32],
    ['drawImage', 0.5, tileImage, 56, 104, 32, 32],
  ])
  assert.deepEqual(draws.slice(2).map((entry) => entry[2]), [heroImage, heroImage])
  assert.ok(calls.some((entry) => entry[0] === 'scale' && entry[1] === 2 && entry[2] === 2))
})

test('scene rendering accepts a row-major legacy tiles array when width is available', () => {
  const ground = sceneAsset()
  const tileImage = { id: 'tileset', width: 192, height: 192 }
  const loaded = {
    byAssetId: {
      [ground.id]: {
        status: 'ready',
        kind: ground.kind,
        asset: ground,
        image: tileImage,
        tile_map: { tile_size: { w: 32, h: 32 }, width: 2, height: 1, tiles: [6, 9] },
        tile_atlas: tileAtlas(),
      },
    },
    diagnostics: [],
  }
  const { canvas, calls } = createCanvas(368, 228)

  renderEditorSceneFrame(
    canvas,
    scene([layer({ id: 'layer_ground', assetId: ground.id, type: 'tilemap' })]),
    loaded,
    {},
    null,
  )

  const draws = calls.filter((entry) => entry[0] === 'drawImage')
  assert.deepEqual(draws.map((entry) => entry.slice(3, 7)), [
    [104, 56, 32, 32],
    [56, 104, 32, 32],
  ])
})

test('scene rendering fills row-major coordinates for legacy tile descriptor arrays', () => {
  const ground = sceneAsset()
  const tileImage = { id: 'tileset', width: 192, height: 192 }
  const loaded = {
    byAssetId: {
      [ground.id]: {
        status: 'ready',
        kind: ground.kind,
        asset: ground,
        image: tileImage,
        tile_map: {
          tile_size: { w: 32, h: 32 },
          width: 2,
          height: 1,
          tiles: [{ mask: 6, tile_id: 'mask_6' }, { mask: 9, tile_id: 'mask_9' }],
        },
        tile_atlas: tileAtlas(),
      },
    },
    diagnostics: [],
  }
  const { canvas, calls } = createCanvas(368, 228)

  renderEditorSceneFrame(
    canvas,
    scene([layer({ id: 'layer_ground', assetId: ground.id, type: 'tilemap' })]),
    loaded,
    {},
    null,
  )

  const draws = calls.filter((entry) => entry[0] === 'drawImage')
  assert.deepEqual(draws.map((entry) => entry.slice(7, 9)), [[0, 0], [32, 0]])
})

test('renderer skips hidden and unsupported layers while returning localized diagnostics', () => {
  const hero = characterAsset()
  const currentScene = scene([
    layer({ id: 'layer_hidden', assetId: hero.id, type: 'character', clipId: 'walk_down', visible: false }),
    layer({ id: 'layer_missing', assetId: 'asset_missing', type: 'prop' }),
    layer({ id: 'layer_unsupported', assetId: 'asset_audio', type: 'effect' }),
  ])
  const loaded = {
    byAssetId: {
      [hero.id]: { status: 'ready', kind: hero.kind, asset: hero, image: { width: 64, height: 48 } },
      asset_audio: { status: 'ready', kind: 'audio_future', asset: { id: 'asset_audio', kind: 'audio_future' } },
    },
    diagnostics: [{ code: 'missing_asset', asset_id: 'asset_missing' }],
  }
  const { canvas, calls } = createCanvas()

  const result = renderEditorSceneFrame(canvas, currentScene, loaded, {}, null)

  assert.equal(calls.some((entry) => entry[0] === 'drawImage'), false)
  assert.ok(result.diagnostics.some((item) => item.code === 'missing_asset' && item.asset_id === 'asset_missing'))
  assert.ok(result.diagnostics.some((item) => item.code === 'unsupported_layer' && item.layer_id === 'layer_unsupported'))
  assert.equal(result.view.mode, 'editor')
  const expectedView = fitSceneToStage(currentScene, { width: canvas.width, height: canvas.height })
  assert.equal(result.view.scale, expectedView.scale)
  assert.equal(result.view.offsetX, expectedView.offsetX)
  assert.equal(result.view.offsetY, expectedView.offsetY)
})

test('a failed layer restores canvas state before later layers render', () => {
  const broken = characterAsset({ id: 'asset_broken' })
  broken.clips = {}
  const hero = characterAsset()
  const currentScene = scene([
    layer({ id: 'layer_broken', assetId: broken.id, type: 'character', clipId: 'missing', z: 0 }),
    layer({ id: 'layer_hero', assetId: hero.id, type: 'character', clipId: 'walk_down', z: 1 }),
  ])
  const loaded = {
    byAssetId: {
      [broken.id]: { status: 'ready', kind: broken.kind, asset: broken, image: { width: 64, height: 48 } },
      [hero.id]: { status: 'ready', kind: hero.kind, asset: hero, image: { width: 64, height: 48 } },
    },
    diagnostics: [],
  }
  const { canvas, calls } = createCanvas(368, 228)

  const result = renderEditorSceneFrame(canvas, currentScene, loaded, {}, null)

  assert.equal(calls.filter((entry) => entry[0] === 'drawImage').length, 1)
  assert.equal(calls.filter((entry) => entry[0] === 'save').length, 2)
  assert.equal(calls.filter((entry) => entry[0] === 'restore').length, 2)
  assert.ok(result.diagnostics.some((item) => item.code === 'layer_draw_failed' && item.layer_id === 'layer_broken'))
})
