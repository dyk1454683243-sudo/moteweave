import { loadSceneRenderAssets } from './sceneRenderer.js'

function renderSignature(projectId, scene, assets) {
  if (!scene) return ''
  const references = (scene.layers ?? []).map((layer) => {
    const asset = assets[layer.asset_id]
    const revision = asset?.revisions?.[asset.active_revision_id]
    return [layer.asset_id, asset?.active_revision_id ?? null, revision?.artifacts ?? null]
  })
  return JSON.stringify([projectId ?? null, scene.id, references])
}

function resultStatus(result) {
  const entries = Object.values(result?.byAssetId ?? {})
  const ready = entries.filter((entry) => entry.status === 'ready').length
  const failed = entries.length - ready
  if (failed && ready) return 'partial'
  if (failed) return 'error'
  return 'ready'
}

export function createSceneRenderLifecycle({
  getProjectId,
  getScene,
  getAssets,
  getState,
  setState,
  onSettled,
  loadAssets = loadSceneRenderAssets,
}) {
  return function refreshSceneRenderAssets({ force = false } = {}) {
    const scene = getScene()
    const assets = getAssets()
    const current = getState()
    const signature = renderSignature(getProjectId(), scene, assets)
    if (!scene) {
      setState({
        ...current,
        status: 'idle',
        result: null,
        signature: '',
        error: '',
        diagnostics: [],
      })
      return Promise.resolve(null)
    }
    if (!force && signature === current.signature && ['loading', 'ready'].includes(current.status)) {
      return Promise.resolve(current.result)
    }

    const token = (current.token ?? 0) + 1
    setState({
      ...current,
      status: 'loading',
      result: null,
      signature,
      token,
      error: '',
      diagnostics: [],
    })
    return loadAssets(scene, assets).then((result) => {
      const latest = getState()
      if (latest.token !== token || latest.signature !== signature) return null
      setState({
        ...latest,
        status: resultStatus(result),
        result,
        error: '',
        diagnostics: result.diagnostics ?? [],
      })
      onSettled()
      return result
    }).catch((error) => {
      const latest = getState()
      if (latest.token !== token || latest.signature !== signature) return null
      const message = error?.message ?? String(error)
      setState({
        ...latest,
        status: 'error',
        result: null,
        error: message,
        diagnostics: [{ code: 'scene_render_failed', message }],
      })
      onSettled()
      return null
    })
  }
}
