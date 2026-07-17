import { getActiveAssetRevision, listAssetClipIds } from './assets.js'
import { clonePlain } from './safety.js'

export class EditorAssetLibraryError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'EditorAssetLibraryError'
    this.code = code
    this.details = details
  }
}

const THUMBNAIL_ARTIFACTS_BY_KIND = Object.freeze({
  character_pack: ['thumbnail', 'preview', 'sheet', 'source'],
  scene_pack: ['thumbnail', 'preview', 'tile_atlas', 'scene'],
  tilemap: ['thumbnail', 'preview', 'tileset', 'tile_atlas'],
  static_image: ['thumbnail', 'preview', 'image'],
  spritesheet: ['thumbnail', 'preview', 'sheet'],
  effect: ['thumbnail', 'preview', 'image', 'sheet'],
  ui: ['thumbnail', 'preview', 'image', 'sheet'],
})

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size
}

function assetMissing(assetId) {
  return new EditorAssetLibraryError('asset_not_found', `editor asset not found: ${assetId}`, {
    asset_id: assetId,
  })
}

function thumbnailArtifactForAsset(asset, revision = getActiveAssetRevision(asset)) {
  const artifacts = revision?.artifacts ?? {}
  const candidates = THUMBNAIL_ARTIFACTS_BY_KIND[asset?.kind] ?? ['thumbnail', 'preview', 'image', 'sheet']
  return candidates.map((key) => artifacts[key]).find(Boolean) ?? null
}

export function listAssetUsage(project, assetId) {
  const usage = []
  for (const scene of Object.values(project?.scenes ?? {})) {
    for (const layer of scene.layers ?? []) {
      if (layer?.asset_id !== assetId) continue
      usage.push({
        scene_id: scene.id,
        scene_name: scene.name ?? scene.id,
        layer_id: layer.id,
        layer_name: layer.name ?? layer.id,
        layer_type: layer.type,
      })
    }
  }
  return usage
}

export function summarizeAssetUsage(project, assetId) {
  const usages = listAssetUsage(project, assetId)
  return {
    asset_id: assetId,
    scene_count: uniqueCount(usages.map((item) => item.scene_id)),
    layer_count: usages.length,
    usages,
  }
}

export function buildAssetLibraryEntry(project, asset) {
  const revision = getActiveAssetRevision(asset)
  const usage = summarizeAssetUsage(project, asset?.id)
  return {
    id: asset?.id ?? null,
    name: asset?.name ?? asset?.id ?? '',
    kind: asset?.kind ?? 'unknown',
    profile: asset?.profile ?? null,
    active_revision_id: asset?.active_revision_id ?? null,
    quality_status: revision?.quality_status ?? 'unknown',
    production_status: revision?.production_status ?? 'review_required',
    source_job_id: revision?.source_job_id ?? null,
    provenance: clonePlain(asset?.provenance ?? {}),
    clip_count: listAssetClipIds(asset).length,
    revision_count: Object.keys(asset?.revisions ?? {}).length,
    thumbnail_artifact: thumbnailArtifactForAsset(asset, revision),
    usage,
    can_delete: usage.layer_count === 0,
    can_unlink: usage.layer_count > 0,
    can_repair: asset?.kind === 'character_pack',
    can_export: false,
  }
}

export function buildAssetLibrary(project) {
  return Object.values(project?.assets ?? {})
    .map((asset) => buildAssetLibraryEntry(project, asset))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function removeAssetFromProject(project, assetId, { now = new Date() } = {}) {
  const asset = project?.assets?.[assetId]
  if (!asset) throw assetMissing(assetId)
  const usage = summarizeAssetUsage(project, assetId)
  if (usage.layer_count > 0) {
    throw new EditorAssetLibraryError('asset_in_use', 'asset is still used by scene layers', usage)
  }

  const nextProject = clonePlain(project)
  delete nextProject.assets[assetId]
  nextProject.updated_at = timestamp(now)
  return {
    project: nextProject,
    asset: clonePlain(asset),
    usage,
  }
}

export function unlinkAssetFromScenes(project, assetId, { now = new Date() } = {}) {
  const asset = project?.assets?.[assetId]
  if (!asset) throw assetMissing(assetId)
  const usage = summarizeAssetUsage(project, assetId)
  const nextProject = clonePlain(project)
  const updatedAt = timestamp(now)

  for (const scene of Object.values(nextProject.scenes ?? {})) {
    const before = scene.layers ?? []
    const after = before.filter((layer) => layer?.asset_id !== assetId)
    if (after.length !== before.length) {
      scene.layers = after
      scene.updated_at = updatedAt
    }
  }

  nextProject.updated_at = updatedAt
  return {
    project: nextProject,
    asset: clonePlain(asset),
    usage,
    removed_layers: usage.usages,
  }
}
