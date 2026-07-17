function generatedUrl(jobId, name) {
  return `/generated/${jobId}/${name}`
}

function optionalFile(name, content) {
  return content === undefined || content === null ? [] : [{ name, content }]
}

function candidateFiles(result = {}) {
  return (result.files?.candidateArtifacts ?? [])
    .filter((file) => file?.name && file.content !== undefined && file.content !== null)
    .map((file) => ({ name: file.name, content: file.content }))
}

export function buildScenePackArtifactManifest(jobId, result = {}) {
  const files = [
    { name: 'scene.json', content: result.sceneJson },
    { name: 'tile_atlas.json', content: result.tileAtlasMetadata },
    { name: 'tile_map.json', content: result.tileMap },
    { name: 'quality_gate.json', content: result.qualityGate },
    ...optionalFile('style_correction.json', result.styleCorrection),
    ...optionalFile('edge_conditioning.json', result.edgeConditioning),
    ...optionalFile('tile_conditioning_review.json', result.tileConditioningReview),
    ...optionalFile('project.ldtk', result.ldtkProjectJson),
    ...optionalFile('project_manifest.json', result.projectManifest),
    ...optionalFile('tileset.png', result.files?.tilesetPng),
    ...optionalFile('prompt.txt', result.files?.promptTxt),
    ...optionalFile('generation.json', result.files?.generationJson),
    ...optionalFile('candidate_selection.json', result.candidateSelection ?? result.files?.candidateSelectionJson),
    ...optionalFile('tile_conditioning_review.png', result.files?.tileConditioningReviewPng),
    ...candidateFiles(result),
    { name: 'scene_pack.zip', content: result.files?.zipBuffer },
  ]

  return {
    files,
    urls: {
      scene_url: generatedUrl(jobId, 'scene.json'),
      tile_atlas_url: generatedUrl(jobId, 'tile_atlas.json'),
      tile_map_url: generatedUrl(jobId, 'tile_map.json'),
      quality_gate_url: generatedUrl(jobId, 'quality_gate.json'),
      ...(result.styleCorrection ? { style_correction_url: generatedUrl(jobId, 'style_correction.json') } : {}),
      ...(result.edgeConditioning ? { edge_conditioning_url: generatedUrl(jobId, 'edge_conditioning.json') } : {}),
      ...(result.tileConditioningReview ? { tile_conditioning_review_url: generatedUrl(jobId, 'tile_conditioning_review.json') } : {}),
      ...(result.ldtkProjectJson ? { ldtk_project_url: generatedUrl(jobId, 'project.ldtk') } : {}),
      ...(result.projectManifest ? { project_manifest_url: generatedUrl(jobId, 'project_manifest.json') } : {}),
      ...(result.files?.tilesetPng ? { tileset_url: generatedUrl(jobId, 'tileset.png') } : {}),
      ...(result.files?.promptTxt ? { prompt_url: generatedUrl(jobId, 'prompt.txt') } : {}),
      ...(result.files?.generationJson ? { generation_url: generatedUrl(jobId, 'generation.json') } : {}),
      ...(result.candidateSelection || result.files?.candidateSelectionJson ? { candidate_selection_url: generatedUrl(jobId, 'candidate_selection.json') } : {}),
      ...(result.files?.tileConditioningReviewPng ? { tile_conditioning_review_image_url: generatedUrl(jobId, 'tile_conditioning_review.png') } : {}),
      ...(candidateFiles(result).length ? {
        candidate_artifact_urls: Object.fromEntries(candidateFiles(result).map((file) => [file.name, generatedUrl(jobId, file.name)])),
      } : {}),
      scene_pack_zip_url: generatedUrl(jobId, 'scene_pack.zip'),
      zip_url: generatedUrl(jobId, 'scene_pack.zip'),
    },
  }
}
