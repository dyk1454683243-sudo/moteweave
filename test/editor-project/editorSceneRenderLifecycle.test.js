import test from 'node:test'
import assert from 'node:assert/strict'

import { createSceneRenderLifecycle } from '../../src/ui/editor/sceneRenderLifecycle.js'

function fixture(loadAssets) {
  const scene = {
    id: 'scene_main',
    layers: [
      { id: 'layer_ground', asset_id: 'asset_ground' },
      { id: 'layer_hero', asset_id: 'asset_hero' },
    ],
  }
  const assets = {
    asset_ground: {
      id: 'asset_ground',
      active_revision_id: 'rev_ground',
      revisions: { rev_ground: { id: 'rev_ground', artifacts: { tile_map: 'ground.json' } } },
    },
    asset_hero: {
      id: 'asset_hero',
      active_revision_id: 'rev_hero',
      revisions: { rev_hero: { id: 'rev_hero', artifacts: { spritesheet: 'hero.png' } } },
    },
  }
  let state = {
    status: 'idle',
    result: null,
    token: 0,
    signature: '',
    error: '',
    diagnostics: [],
  }
  let settled = 0
  const refresh = createSceneRenderLifecycle({
    getProjectId: () => 'project_demo',
    getScene: () => scene,
    getAssets: () => assets,
    getState: () => state,
    setState: (next) => { state = next },
    onSettled: () => { settled += 1 },
    loadAssets,
  })
  return {
    refresh,
    getState: () => state,
    getSettled: () => settled,
  }
}

const partialResult = {
  byAssetId: {
    asset_ground: { status: 'error' },
    asset_hero: { status: 'ready' },
  },
  diagnostics: [{ code: 'asset_load_failed', asset_id: 'asset_ground' }],
}

const readyResult = {
  byAssetId: {
    asset_ground: { status: 'ready' },
    asset_hero: { status: 'ready' },
  },
  diagnostics: [],
}

test('same-signature refresh retries a partial result and then reuses ready', async () => {
  let calls = 0
  const value = fixture(async () => {
    calls += 1
    return calls === 1 ? partialResult : readyResult
  })

  await value.refresh()
  assert.equal(value.getState().status, 'partial')

  await value.refresh()
  assert.equal(calls, 2)
  assert.equal(value.getState().status, 'ready')

  const reused = await value.refresh()
  assert.equal(calls, 2)
  assert.equal(reused, readyResult)
})

test('same-signature refresh retries after a rejected load', async () => {
  let calls = 0
  const value = fixture(async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary decode failure')
    return readyResult
  })

  await value.refresh()
  assert.equal(value.getState().status, 'error')

  const retried = await value.refresh()
  assert.equal(calls, 2)
  assert.equal(retried, readyResult)
  assert.equal(value.getState().status, 'ready')
})

test('a stale load cannot replace the result from a newer token', async () => {
  const resolvers = []
  const value = fixture(() => new Promise((resolve) => resolvers.push(resolve)))

  const staleRequest = value.refresh()
  const latestRequest = value.refresh({ force: true })
  const latestResult = { ...readyResult, request: 'latest' }
  resolvers[1](latestResult)
  assert.equal(await latestRequest, latestResult)

  const staleResult = { ...readyResult, request: 'stale' }
  resolvers[0](staleResult)
  assert.equal(await staleRequest, null)
  assert.equal(value.getState().result, latestResult)
  assert.equal(value.getSettled(), 1)
})
