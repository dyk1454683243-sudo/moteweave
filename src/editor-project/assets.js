import {
  ASSET_KIND_REQUIREMENTS,
  DEFAULT_PRODUCTION_STATUS_BY_QUALITY,
} from './constants.js'
import { clonePlain } from './safety.js'

export function getAssetKindRequirements(kind) {
  return ASSET_KIND_REQUIREMENTS[kind] ?? null
}

export function getRequiredArtifactKeys(kind) {
  return [...(ASSET_KIND_REQUIREMENTS[kind]?.artifacts ?? [])]
}

export function getAnyRequiredArtifactKeys(kind) {
  return [...(ASSET_KIND_REQUIREMENTS[kind]?.anyArtifacts ?? [])]
}

export function getDefaultProductionStatus(qualityStatus = 'unknown') {
  return DEFAULT_PRODUCTION_STATUS_BY_QUALITY[qualityStatus] ?? 'review_required'
}

export function getAssetRevision(asset, revisionId = asset?.active_revision_id) {
  if (!asset?.revisions || !revisionId) return null
  return asset.revisions[revisionId] ?? null
}

export function getActiveAssetRevision(asset) {
  return getAssetRevision(asset, asset?.active_revision_id)
}

export function resolveAssetArtifact(asset, artifactKey, { revisionId } = {}) {
  const revision = getAssetRevision(asset, revisionId)
  return revision?.artifacts?.[artifactKey] ?? null
}

export function getAssetClip(asset, clipId) {
  if (!asset?.clips || !clipId) return null
  return asset.clips[clipId] ?? null
}

export function listAssetClipIds(asset) {
  return Object.keys(asset?.clips ?? {})
}

export function createAssetRevision({
  id = 'rev_001',
  sourceJobId = null,
  parentRevisionId = null,
  createdAt,
  qualityStatus = 'unknown',
  productionStatus = getDefaultProductionStatus(qualityStatus),
  processingRecipeRef = null,
  artifacts = {},
  override = null,
} = {}) {
  return {
    id,
    source_job_id: sourceJobId,
    parent_revision_id: parentRevisionId,
    created_at: createdAt ?? new Date().toISOString(),
    quality_status: qualityStatus,
    production_status: productionStatus,
    processing_recipe_ref: processingRecipeRef,
    artifacts: clonePlain(artifacts),
    ...(override ? { override: clonePlain(override) } : {}),
  }
}

export function createAssetRef({
  id,
  kind,
  name,
  profile = null,
  revision,
  provenance = { source_type: 'manual_import', provider: null, model: null },
  clips = {},
  tags = [],
} = {}) {
  const resolvedRevision = revision ?? createAssetRevision()
  return {
    id,
    kind,
    name,
    ...(profile ? { profile } : {}),
    active_revision_id: resolvedRevision.id,
    revisions: {
      [resolvedRevision.id]: clonePlain(resolvedRevision),
    },
    provenance: clonePlain(provenance),
    clips: clonePlain(clips),
    tags: [...tags],
  }
}
