import JSZip from 'jszip'

function addFile(zip, name, content) {
  if (content === undefined || content === null) return
  zip.file(name, Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2))
}

export async function buildProjectPackZip(result = {}) {
  const zip = new JSZip()
  addFile(zip, 'project_manifest.json', result.projectManifest)
  addFile(zip, 'project_validation.json', result.validation)

  const character = result.characterResult ?? {}
  addFile(zip, 'character/metadata.json', character.metadataJson)
  addFile(zip, 'character/animations.json', character.animationsJson)
  addFile(zip, 'character/editor_metadata.json', character.editorMetadataJson)
  addFile(zip, 'character/debug_report.json', character.debugReport)
  addFile(zip, 'character/source.png', character.files?.sourcePng)
  addFile(zip, 'character/normalized_sheet.png', character.files?.normalizedSheetPng)
  addFile(zip, 'character/character_pack.zip', character.files?.zipBuffer)

  const scene = result.sceneResult ?? {}
  addFile(zip, 'scene/scene.json', scene.sceneJson)
  addFile(zip, 'scene/tile_atlas.json', scene.tileAtlasMetadata)
  addFile(zip, 'scene/tile_map.json', scene.tileMap ?? scene.map)
  addFile(zip, 'scene/quality_gate.json', scene.qualityGate)
  addFile(zip, 'scene/project.ldtk', scene.ldtkProjectJson)
  addFile(zip, 'scene/tileset.png', scene.files?.tilesetPng)
  addFile(zip, 'scene/scene_pack.zip', scene.files?.zipBuffer)

  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
