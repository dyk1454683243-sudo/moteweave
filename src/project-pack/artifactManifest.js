function generatedUrl(jobId, name) {
  return `/generated/${jobId}/${name}`
}

export function buildProjectPackArtifactManifest(jobId, result = {}) {
  return {
    files: [
      { name: 'project_manifest.json', content: result.projectManifest },
      { name: 'project_validation.json', content: result.validation },
      { name: 'project_pack.zip', content: result.files?.zipBuffer },
    ],
    urls: {
      project_manifest_url: generatedUrl(jobId, 'project_manifest.json'),
      project_validation_url: generatedUrl(jobId, 'project_validation.json'),
      project_pack_zip_url: generatedUrl(jobId, 'project_pack.zip'),
      zip_url: generatedUrl(jobId, 'project_pack.zip'),
    },
  }
}
