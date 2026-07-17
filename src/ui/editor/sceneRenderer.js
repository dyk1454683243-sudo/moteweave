import { frameStateForLayer } from '../../editor-project/animationRuntime.js'
import { fetchEditorArtifactJson } from './api.js'
import { fitSceneToStage, getLayerFrameSpec } from './sceneCanvas.js'

const SUPPORTED_ASSET_KINDS = new Set(['character_pack', 'scene_pack'])

function controlledArtifactUrl(pathname) {
  const value = String(pathname ?? '').trim()
  if (!value) throw new Error('missing artifact path')
  if (value.startsWith('/api/editor/artifact?path=')) return value
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.startsWith('~') || normalized.split('/').includes('..')) {
    throw new Error('unsafe artifact path')
  }
  return `/api/editor/artifact?path=${encodeURIComponent(normalized)}`
}

function defaultImageLoader(url) {
  if (typeof Image !== 'function') return Promise.reject(new Error('browser image loader is unavailable'))
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => reject(new Error('image decode failed')), { once: true })
    image.src = url
  })
}

function activeRevision(asset) {
  return asset?.revisions?.[asset.active_revision_id] ?? null
}

function itemDiagnostic(code, values = {}) {
  return { code, ...values }
}

function cacheKey(asset, revision) {
  const artifacts = revision.artifacts ?? {}
  const artifactIdentity = asset.kind === 'character_pack'
    ? [artifacts.sheet]
    : [artifacts.tile_map, artifacts.tile_atlas, artifacts.tileset ?? artifacts.preview]
  return JSON.stringify([asset.id, revision.id, asset.kind, artifactIdentity])
}

function errorEntry(assetId, code, values = {}) {
  const diagnostic = itemDiagnostic(code, { asset_id: assetId, ...values })
  return {
    status: 'error',
    asset_id: assetId,
    error: code,
    diagnostic,
  }
}

async function loadAssetRevision(asset, revision, loaders) {
  try {
    if (asset.kind === 'character_pack') {
      const sheetPath = revision.artifacts?.sheet
      if (!sheetPath) return {
        ...errorEntry(asset.id, 'missing_artifact', {
          revision_id: revision.id,
          artifact: 'sheet',
        }),
        kind: asset.kind,
        asset,
        revision_id: revision.id,
      }
      const image = await loaders.loadImage(loaders.resolveArtifactUrl(sheetPath))
      return {
        status: 'ready',
        asset_id: asset.id,
        revision_id: revision.id,
        kind: asset.kind,
        asset,
        image,
      }
    }

    const mapPath = revision.artifacts?.tile_map
    const atlasPath = revision.artifacts?.tile_atlas
    const imagePath = revision.artifacts?.tileset ?? revision.artifacts?.preview
    const missing = [
      ['tile_map', mapPath],
      ['tile_atlas', atlasPath],
      ['tileset', imagePath],
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length) return {
      ...errorEntry(asset.id, 'missing_artifact', {
        revision_id: revision.id,
        artifact: missing.join(','),
      }),
      kind: asset.kind,
      asset,
      revision_id: revision.id,
    }
    const [tileMap, tileAtlas, image] = await Promise.all([
      loaders.fetchJson(loaders.resolveArtifactUrl(mapPath)),
      loaders.fetchJson(loaders.resolveArtifactUrl(atlasPath)),
      loaders.loadImage(loaders.resolveArtifactUrl(imagePath)),
    ])
    return {
      status: 'ready',
      asset_id: asset.id,
      revision_id: revision.id,
      kind: asset.kind,
      asset,
      image,
      tile_map: tileMap,
      tile_atlas: tileAtlas,
    }
  } catch (error) {
    return {
      ...errorEntry(asset.id, 'asset_load_failed', {
        revision_id: revision.id,
        message: error?.message ?? String(error),
      }),
      kind: asset.kind,
      asset,
      revision_id: revision.id,
    }
  }
}

export function createSceneRenderAssetCache() {
  return new Map()
}

const defaultAssetCache = createSceneRenderAssetCache()

export async function loadSceneRenderAssets(scene, assets = {}, options = {}) {
  const cache = options.cache ?? defaultAssetCache
  const loaders = {
    fetchJson: options.fetchJson ?? fetchEditorArtifactJson,
    loadImage: options.loadImage ?? defaultImageLoader,
    resolveArtifactUrl: options.resolveArtifactUrl ?? controlledArtifactUrl,
  }
  const byAssetId = {}
  const diagnostics = []
  const assetIds = [...new Set((scene?.layers ?? []).map((layer) => layer.asset_id).filter(Boolean))]

  await Promise.all(assetIds.map(async (assetId) => {
    const asset = assets?.[assetId]
    if (!asset) {
      const entry = errorEntry(assetId, 'missing_asset')
      byAssetId[assetId] = entry
      diagnostics.push(entry.diagnostic)
      return
    }
    const revision = activeRevision(asset)
    if (!revision) {
      const entry = {
        ...errorEntry(assetId, 'missing_revision', { revision_id: asset.active_revision_id ?? null }),
        kind: asset.kind,
        asset,
      }
      byAssetId[assetId] = entry
      diagnostics.push(entry.diagnostic)
      return
    }
    if (!SUPPORTED_ASSET_KINDS.has(asset.kind)) {
      const entry = {
        ...errorEntry(assetId, 'unsupported_asset_kind', {
          revision_id: revision.id,
          kind: asset.kind,
        }),
        kind: asset.kind,
        asset,
      }
      byAssetId[assetId] = entry
      diagnostics.push(entry.diagnostic)
      return
    }

    const key = cacheKey(asset, revision)
    if (!cache.has(key)) cache.set(key, loadAssetRevision(asset, revision, loaders))
    const pending = cache.get(key)
    const entry = await pending
    if (entry.status === 'error' && cache.get(key) === pending) cache.delete(key)
    byAssetId[assetId] = entry
    if (entry.diagnostic) diagnostics.push(entry.diagnostic)
  }))

  return { byAssetId, diagnostics }
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function positive(value, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getRenderView(canvas, scene, playtestRuntime) {
  const rect = {
    width: positive(canvas?.width, 1),
    height: positive(canvas?.height, 1),
  }
  if (playtestRuntime?.running && playtestRuntime?.camera) {
    const viewport = scene?.viewport ?? scene?.world ?? { w: rect.width, h: rect.height }
    return {
      ...fitSceneToStage({ ...scene, world: viewport }, rect, 0),
      mode: 'playtest',
      camera: {
        x: finite(playtestRuntime.camera.x),
        y: finite(playtestRuntime.camera.y),
        zoom: positive(playtestRuntime.camera.zoom, positive(scene?.camera?.zoom, 1)),
      },
      visible: { w: viewport.w, h: viewport.h },
    }
  }
  return {
    ...fitSceneToStage(scene, rect),
    mode: 'editor',
    camera: {
      x: finite(scene?.camera?.x),
      y: finite(scene?.camera?.y),
      zoom: positive(scene?.camera?.zoom, 1),
    },
    visible: { ...(scene?.world ?? { w: rect.width, h: rect.height }) },
  }
}

function effectiveLayer(layer, playtestRuntime) {
  const player = playtestRuntime?.player
  if (!playtestRuntime?.running || player?.layer_id !== layer.id) return layer
  return {
    ...layer,
    ...(player.clip_id ? { clip_id: player.clip_id } : {}),
    transform: {
      ...layer.transform,
      position: {
        x: finite(player.x, finite(layer.transform?.position?.x)),
        y: finite(player.y, finite(layer.transform?.position?.y)),
      },
    },
  }
}

function layerTransform(layer, view) {
  const position = layer.transform?.position ?? { x: 0, y: 0 }
  const viewportLayer = layer.transform?.coordinate_space === 'viewport'
  const zoom = viewportLayer ? 1 : view.camera.zoom
  const parallax = viewportLayer ? 0 : finite(layer.render?.parallax, 1)
  const worldX = viewportLayer ? finite(position.x) : (finite(position.x) - view.camera.x * parallax) * zoom
  const worldY = viewportLayer ? finite(position.y) : (finite(position.y) - view.camera.y * parallax) * zoom
  const scaleX = (finite(layer.transform?.scale?.x, 1) || 1) * zoom * view.scale * (layer.transform?.flip_x ? -1 : 1)
  const scaleY = (finite(layer.transform?.scale?.y, 1) || 1) * zoom * view.scale * (layer.transform?.flip_y ? -1 : 1)
  return {
    x: view.offsetX + worldX * view.scale,
    y: view.offsetY + worldY * view.scale,
    scaleX,
    scaleY,
  }
}

function drawWithLayerTransform(context, layer, view, draw) {
  const transform = layerTransform(layer, view)
  context.save()
  context.globalAlpha = Math.max(0, Math.min(1, finite(layer.render?.opacity, 1)))
  context.translate(transform.x, transform.y)
  context.rotate((finite(layer.transform?.rotation_deg) * Math.PI) / 180)
  context.scale(transform.scaleX, transform.scaleY)
  try {
    draw()
  } finally {
    context.restore()
  }
}

function drawCharacter(context, layer, entry, animationRuntime) {
  const asset = entry.asset
  const frameState = frameStateForLayer(animationRuntime, layer, asset)
  const clip = asset?.clips?.[layer.clip_id] ?? frameState.clip
  if (!clip || !entry.image) throw new Error('character render asset is incomplete')
  const frameSize = clip.frame_size ?? { w: 96, h: 96 }
  const frameNumber = Number.isInteger(frameState.frame_number) ? frameState.frame_number : clip.frames?.[0]
  if (!Number.isInteger(frameNumber)) throw new Error('character frame is unavailable')
  const columns = Math.max(1, Math.floor(positive(entry.image.width, frameSize.w) / frameSize.w))
  const sourceX = (frameNumber % columns) * frameSize.w
  const sourceY = Math.floor(frameNumber / columns) * frameSize.h
  const { anchor } = getLayerFrameSpec(layer, asset)
  context.drawImage(
    entry.image,
    sourceX,
    sourceY,
    frameSize.w,
    frameSize.h,
    -anchor.x,
    -anchor.y,
    frameSize.w,
    frameSize.h,
  )
}

function normalizedCells(tileMap) {
  if (Array.isArray(tileMap?.cells)) return tileMap.cells
  if (!Array.isArray(tileMap?.tiles) || !Number.isInteger(tileMap?.width) || tileMap.width < 1) return []
  return tileMap.tiles.map((tile, index) => {
    const descriptor = tile && typeof tile === 'object'
      ? tile
      : { mask: Number(tile), tile_id: `mask_${Number(tile)}` }
    const resolvedIndex = Number.isInteger(descriptor.index) ? descriptor.index : index
    return {
      ...descriptor,
      index: resolvedIndex,
      x: Number.isFinite(descriptor.x) ? descriptor.x : resolvedIndex % tileMap.width,
      y: Number.isFinite(descriptor.y) ? descriptor.y : Math.floor(resolvedIndex / tileMap.width),
    }
  })
}

function drawTileMap(context, entry) {
  const tileMap = entry.tile_map
  const atlasTiles = Array.isArray(entry.tile_atlas?.tiles) ? entry.tile_atlas.tiles : []
  const cells = normalizedCells(tileMap)
  const byId = new Map(atlasTiles.map((tile) => [tile.id, tile]))
  const byMask = new Map(atlasTiles.map((tile) => [Number(tile.mask ?? tile.index), tile]))
  const tileSize = tileMap?.tile_size ?? entry.tile_atlas?.tile_size ?? { w: 32, h: 32 }
  if (!entry.image || !cells.length || !atlasTiles.length) throw new Error('scene tile render asset is incomplete')

  for (const cell of cells) {
    const tile = byId.get(cell.tile_id) ?? byMask.get(Number(cell.mask ?? cell.tile))
    const source = tile?.source
    if (!source) continue
    const index = Number.isInteger(cell.index) ? cell.index : 0
    const x = Number.isFinite(cell.x) ? cell.x : index % positive(tileMap?.width, 1)
    const y = Number.isFinite(cell.y) ? cell.y : Math.floor(index / positive(tileMap?.width, 1))
    context.drawImage(
      entry.image,
      source.x,
      source.y,
      source.w,
      source.h,
      x * tileSize.w,
      y * tileSize.h,
      tileSize.w,
      tileSize.h,
    )
  }
}

export function renderEditorSceneFrame(canvas, scene, assets, animationRuntime = {}, playtestRuntime = null) {
  const context = canvas?.getContext?.('2d')
  const diagnostics = [...(assets?.diagnostics ?? [])]
  const view = getRenderView(canvas, scene, playtestRuntime)
  if (!context) {
    diagnostics.push(itemDiagnostic('missing_canvas_context'))
    return { view, diagnostics }
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  context.fillStyle = scene?.background || '#101418'
  context.fillRect(view.offsetX, view.offsetY, view.visible.w * view.scale, view.visible.h * view.scale)

  const sortedLayers = (scene?.layers ?? [])
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const zDelta = finite(left.layer.render?.z_index) - finite(right.layer.render?.z_index)
      return zDelta || left.index - right.index
    })

  for (const item of sortedLayers) {
    if (!item.layer.visible) continue
    const layer = effectiveLayer(item.layer, playtestRuntime)
    const entry = assets?.byAssetId?.[layer.asset_id]
    if (!entry || entry.status !== 'ready') {
      diagnostics.push(itemDiagnostic('asset_unavailable', {
        layer_id: layer.id,
        asset_id: layer.asset_id,
      }))
      continue
    }
    try {
      if (entry.kind === 'character_pack' && layer.type === 'character') {
        drawWithLayerTransform(context, layer, view, () => drawCharacter(context, layer, entry, animationRuntime))
      } else if (entry.kind === 'scene_pack' && layer.type === 'tilemap') {
        drawWithLayerTransform(context, layer, view, () => drawTileMap(context, entry))
      } else {
        diagnostics.push(itemDiagnostic('unsupported_layer', {
          layer_id: layer.id,
          asset_id: layer.asset_id,
          kind: entry.kind,
          layer_type: layer.type,
        }))
      }
    } catch (error) {
      diagnostics.push(itemDiagnostic('layer_draw_failed', {
        layer_id: layer.id,
        asset_id: layer.asset_id,
        message: error?.message ?? String(error),
      }))
    }
  }
  return { view, diagnostics }
}
