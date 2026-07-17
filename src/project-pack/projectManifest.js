function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function normalizeCreatedAt(createdAt) {
  if (!createdAt) return new Date().toISOString()
  if (createdAt instanceof Date) return createdAt.toISOString()
  return new Date(createdAt).toISOString()
}

function normalizePack(pack) {
  if (!pack) return null
  return {
    id: pack.id,
    profile: pack.profile,
    ...(pack.artifacts ? { artifacts: clonePlain(pack.artifacts) } : {}),
  }
}

export function buildProjectManifest({
  projectId,
  createdAt,
  characterPack,
  scenePack,
  styleContract,
} = {}) {
  return {
    version: 'scene_character_project_v0',
    project_id: projectId,
    created_at: normalizeCreatedAt(createdAt),
    packs: {
      character: normalizePack(characterPack),
      scene: normalizePack(scenePack),
    },
    style_contract: clonePlain(styleContract),
  }
}

export function validateProjectManifest(manifest) {
  const blocking_errors = []
  if (!manifest?.project_id) blocking_errors.push('missing_project_id')
  if (!manifest?.packs?.character) blocking_errors.push('missing_character_pack')
  if (!manifest?.packs?.scene) blocking_errors.push('missing_scene_pack')
  if (!manifest?.style_contract) blocking_errors.push('missing_style_contract')
  if (manifest?.packs?.character && (!manifest.packs.character.id || !manifest.packs.character.profile)) {
    blocking_errors.push('invalid_character_pack')
  }
  if (manifest?.packs?.scene && (!manifest.packs.scene.id || !manifest.packs.scene.profile)) {
    blocking_errors.push('invalid_scene_pack')
  }
  if (manifest?.style_contract && (!manifest.style_contract.mode || !manifest.style_contract.palette)) {
    blocking_errors.push('invalid_style_contract')
  }

  return {
    status: blocking_errors.length ? 'fail' : 'pass',
    blocking_errors,
    metrics: {
      has_character_pack: Boolean(manifest?.packs?.character),
      has_scene_pack: Boolean(manifest?.packs?.scene),
      has_style_contract: Boolean(manifest?.style_contract),
    },
  }
}
