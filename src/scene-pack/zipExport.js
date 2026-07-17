import JSZip from 'jszip'

function addFile(zip, name, content) {
  if (content === undefined || content === null) return
  zip.file(name, Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2))
}

export async function buildScenePackZip(result = {}) {
  const zip = new JSZip()
  addFile(zip, 'scene.json', result.sceneJson)
  addFile(zip, 'tile_atlas.json', result.tileAtlasMetadata)
  addFile(zip, 'tile_map.json', result.tileMap)
  addFile(zip, 'quality_gate.json', result.qualityGate)
  addFile(zip, 'style_correction.json', result.styleCorrection)
  addFile(zip, 'edge_conditioning.json', result.edgeConditioning)
  addFile(zip, 'tile_conditioning_review.json', result.tileConditioningReview)
  addFile(zip, 'project.ldtk', result.ldtkProjectJson)
  addFile(zip, 'project_manifest.json', result.projectManifest)
  addFile(zip, 'tileset.png', result.files?.tilesetPng)
  addFile(zip, 'prompt.txt', result.files?.promptTxt)
  addFile(zip, 'generation.json', result.files?.generationJson)
  addFile(zip, 'candidate_selection.json', result.candidateSelection ?? result.files?.candidateSelectionJson)
  addFile(zip, 'tile_conditioning_review.png', result.files?.tileConditioningReviewPng)
  for (const file of result.files?.candidateArtifacts ?? []) addFile(zip, file.name, file.content)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
