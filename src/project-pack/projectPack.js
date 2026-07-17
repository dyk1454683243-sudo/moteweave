import { buildProjectManifest, validateProjectManifest } from './projectManifest.js'

function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function characterProfile(result = {}) {
  return result.metadataJson?.profile ?? result.animationsJson?.profile ?? result.debugReport?.profile
}

function sceneProfile(result = {}) {
  return result.tileAtlasMetadata?.profile ?? result.tileMap?.profile ?? result.map?.profile ?? result.qualityGate?.profile
}

function characterPackSummary(result = {}) {
  return {
    id: result.metadataJson?.id ?? result.id,
    profile: characterProfile(result),
    artifacts: {
      sheet: 'character/normalized_sheet.png',
      animations: 'character/animations.json',
      metadata: 'character/metadata.json',
      editor_metadata: 'character/editor_metadata.json',
      debug_report: 'character/debug_report.json',
      zip: 'character/character_pack.zip',
    },
  }
}

function scenePackSummary(result = {}) {
  return {
    id: result.sceneJson?.identifier ?? result.projectManifest?.packs?.scene?.id ?? result.id,
    profile: sceneProfile(result),
    artifacts: {
      scene: 'scene/scene.json',
      tileset: 'scene/tileset.png',
      tile_atlas: 'scene/tile_atlas.json',
      tile_map: 'scene/tile_map.json',
      quality_gate: 'scene/quality_gate.json',
      ldtk_project: 'scene/project.ldtk',
      zip: 'scene/scene_pack.zip',
    },
  }
}

export function buildDefaultStyleContract({ characterResult, sceneResult } = {}) {
  const characterStyle = characterResult?.debugReport?.pixel_style
  const sceneStyle = sceneResult?.styleCorrection ?? sceneResult?.qualityGate?.style_correction
  const palette = clonePlain(characterStyle?.palette ?? sceneStyle?.palette ?? { max_colors: 0, colors: [] })
  return {
    mode: 'shared_reference',
    source: characterStyle ? 'character_pixel_style_report' : sceneStyle ? 'scene_style_correction' : 'not_recorded',
    palette,
  }
}

function validateProjectPackChildren({ characterResult, sceneResult } = {}) {
  const blocking = []
  const warnings = []
  const characterStatus = characterResult?.debugReport?.validation?.status ?? null
  const sceneStatus = sceneResult?.qualityGate?.status ?? null
  const hasCharacterArtifacts = Boolean(
    characterResult?.metadataJson &&
    characterResult?.animationsJson &&
    characterResult?.files?.normalizedSheetPng &&
    characterResult?.files?.zipBuffer
  )
  const hasSceneArtifacts = Boolean(
    sceneResult?.sceneJson &&
    sceneResult?.tileAtlasMetadata &&
    (sceneResult?.tileMap || sceneResult?.map) &&
    sceneResult?.qualityGate &&
    sceneResult?.files?.tilesetPng &&
    sceneResult?.files?.zipBuffer
  )
  if (characterStatus === 'fail') blocking.push('character_pack_failed_validation')
  if (sceneStatus === 'fail') blocking.push('scene_pack_failed_quality_gate')
  if (!hasCharacterArtifacts) blocking.push('character_artifacts_incomplete')
  if (!hasSceneArtifacts) blocking.push('scene_artifacts_incomplete')
  if (characterStatus === 'warning') warnings.push('character_pack_validation_warning')
  if (sceneStatus === 'warning') warnings.push('scene_pack_quality_warning')
  return {
    blocking,
    warnings,
    metrics: {
      character_status: characterStatus,
      scene_status: sceneStatus,
      has_character_artifacts: hasCharacterArtifacts,
      has_scene_artifacts: hasSceneArtifacts,
    },
  }
}

function paletteColors(palette) {
  return (palette?.colors ?? [])
    .map((color) => color?.hex ?? (Array.isArray(color?.rgb) ? `rgb(${color.rgb.slice(0, 3).join(',')})` : null))
    .filter(Boolean)
}

function paletteOverlapRatio(a, b) {
  const left = new Set(paletteColors(a))
  const right = new Set(paletteColors(b))
  if (!left.size || !right.size) return null
  let overlap = 0
  for (const color of left) {
    if (right.has(color)) overlap += 1
  }
  return overlap / Math.max(left.size, right.size)
}

function validateSharedStyleContract({ styleContract, characterResult, sceneResult } = {}) {
  const warnings = []
  const characterStyle = characterResult?.debugReport?.pixel_style
  const sceneStyle = sceneResult?.styleCorrection ?? sceneResult?.qualityGate?.style_correction
  const contractPalette = styleContract?.palette
  const characterOverlap = paletteOverlapRatio(contractPalette, characterStyle?.palette)
  const sceneOverlap = paletteOverlapRatio(contractPalette, sceneStyle?.palette)

  if (!paletteColors(contractPalette).length) warnings.push('style_contract_palette_empty')
  if (!characterStyle) warnings.push('character_style_report_missing')
  if (!sceneStyle) warnings.push('scene_style_report_missing')
  if (characterOverlap !== null && characterOverlap < 0.25) warnings.push('character_style_palette_mismatch')
  if (sceneOverlap !== null && sceneOverlap < 0.25) warnings.push('scene_style_palette_mismatch')

  return {
    status: warnings.length ? 'warning' : 'pass',
    warnings,
    metrics: {
      contract_palette_color_count: paletteColors(contractPalette).length,
      character_palette_color_count: paletteColors(characterStyle?.palette).length,
      scene_palette_color_count: paletteColors(sceneStyle?.palette).length,
      character_palette_overlap_ratio: characterOverlap,
      scene_palette_overlap_ratio: sceneOverlap,
      has_character_style_report: Boolean(characterStyle),
      has_scene_style_report: Boolean(sceneStyle),
    },
  }
}

function normalizeStylePolicy(stylePolicy) {
  return stylePolicy === 'strict' ? 'strict' : 'warn'
}

export function buildProjectPack({
  projectId = 'game_project',
  createdAt,
  characterResult,
  sceneResult,
  styleContract,
  stylePolicy = 'warn',
} = {}) {
  if (!characterResult) throw new Error('characterResult is required')
  if (!sceneResult) throw new Error('sceneResult is required')
  const resolvedStylePolicy = normalizeStylePolicy(stylePolicy)

  const projectManifest = buildProjectManifest({
    projectId,
    createdAt,
    characterPack: characterPackSummary(characterResult),
    scenePack: scenePackSummary(sceneResult),
    styleContract: styleContract ?? buildDefaultStyleContract({ characterResult, sceneResult }),
  })
  const manifestValidation = validateProjectManifest(projectManifest)
  const childValidation = validateProjectPackChildren({ characterResult, sceneResult })
  const styleValidation = validateSharedStyleContract({
    styleContract: projectManifest.style_contract,
    characterResult,
    sceneResult,
  })
  const styleBlocking = resolvedStylePolicy === 'strict' && styleValidation.warnings.length
    ? ['style_contract_failed']
    : []
  const blocking = [...manifestValidation.blocking_errors, ...childValidation.blocking, ...styleBlocking]
  const warnings = [...childValidation.warnings, ...styleValidation.warnings]
  const validation = {
    status: blocking.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    blocking_errors: blocking,
    warnings,
    manifest: manifestValidation,
    style_contract: {
      ...styleValidation,
      policy: resolvedStylePolicy,
    },
    metrics: {
      ...manifestValidation.metrics,
      ...childValidation.metrics,
      style_policy: resolvedStylePolicy,
      ...Object.fromEntries(Object.entries(styleValidation.metrics).map(([key, value]) => [`style_${key}`, value])),
    },
  }

  return {
    status: validation.status,
    projectManifest,
    validation,
    characterResult,
    sceneResult,
    files: {},
  }
}
