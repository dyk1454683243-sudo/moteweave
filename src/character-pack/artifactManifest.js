import { resolveGenerationArtifactDisposition } from './generationReleaseGate.js'

function generatedUrl(jobId, name) {
  return `/generated/${jobId}/${name}`
}

function optionalFile(name, content) {
  return content ? [{ name, content }] : []
}

function multiResolutionEntries(result) {
  const sheets = result.files.multiResolutionSheets ?? {}
  const manifestSheets = result.files.multiResolutionManifest?.sheets ?? []
  return Object.entries(sheets)
    .map(([size, content]) => {
      const frameSize = Number(size)
      const manifestSheet = manifestSheets.find((sheet) => sheet.frame_size === frameSize)
      return {
        frameSize,
        name: manifestSheet?.file ?? `normalized_sheet_${frameSize}.png`,
        content,
      }
    })
    .sort((a, b) => b.frameSize - a.frameSize)
}

export function buildCharacterPackArtifactManifest(jobId, result) {
  const artifactDisposition = resolveGenerationArtifactDisposition(result)
  const publishReleaseArtifacts = artifactDisposition !== 'diagnostic_only'
  const rowGifBuffers = result.files.rowGifBuffers ?? {}
  const rowGifFiles = Object.entries(rowGifBuffers).map(([name, content]) => ({ name, content }))
  const rowGifUrls = rowGifFiles.map(({ name }) => generatedUrl(jobId, name))
  const inspectionGifFiles = Object.entries(result.files.inspectionGifBuffers ?? {}).map(([name, content]) => ({ name, content }))
  const inspectionStripFiles = Object.entries(result.files.inspectionStripPngBuffers ?? {}).map(([name, content]) => ({ name, content }))
  const multiResolutionFiles = multiResolutionEntries(result)
  const rowPreviewsByFile = new Map((result.rowPreviews ?? []).map((preview) => [preview.fileName ?? `${preview.name}.gif`, preview]))
  const inspectionPreviewsByFile = new Map((result.inspectionPreviews ?? []).map((preview) => [preview.fileName, preview]))
  const rowGifPreviews = rowGifFiles.map(({ name }) => {
    const preview = rowPreviewsByFile.get(name)
    const animation = preview?.name ?? name.replace(/\.gif$/i, '')
    const metadata = result.animationsJson?.animations?.[animation] ?? {}
    return {
      name,
      url: generatedUrl(jobId, name),
      animation,
      label: preview?.label ?? metadata.display_label ?? metadata.label ?? animation,
    }
  })
  const inspectionGifPreviews = inspectionGifFiles.map(({ name }) => {
    const preview = inspectionPreviewsByFile.get(name)
    const runtimeName = preview?.runtimeFileName
    const stripName = preview?.stripFileName
    const animation = preview?.animation ?? name.split('/').pop().replace(/\.gif$/i, '')
    const metadata = result.animationsJson?.animations?.[animation] ?? {}
    return {
      name: name.split('/').pop(),
      file: name,
      url: generatedUrl(jobId, name),
      runtime_url: runtimeName ? generatedUrl(jobId, runtimeName) : null,
      strip_url: stripName ? generatedUrl(jobId, stripName) : null,
      animation,
      label: preview?.label ?? metadata.display_label ?? metadata.label ?? animation,
      frame_count: preview?.frame_count ?? null,
      frame_size: preview?.frame_size ?? null,
      fps: preview?.fps ?? null,
      mode: preview?.mode ?? null,
    }
  })

  const files = [
    { name: 'source.png', content: result.files.sourcePng },
    ...optionalFile('source_layout_overlay.png', result.files.sourceLayoutOverlayPng),
    ...optionalFile('source_quality_report.json', result.files.sourceQualityReportJson),
    { name: 'normalized_sheet.png', content: result.files.normalizedSheetPng },
    ...(publishReleaseArtifacts ? optionalFile('multi_resolution.json', result.files.multiResolutionManifest) : []),
    ...(publishReleaseArtifacts ? multiResolutionFiles : []),
    { name: 'debug_overlay.png', content: result.files.debugOverlayPng },
    { name: 'onion_skin_overlay.png', content: result.files.onionSkinOverlayPng },
    ...(publishReleaseArtifacts ? [{ name: 'animations.json', content: result.animationsJson }] : []),
    ...(publishReleaseArtifacts ? [{ name: 'metadata.json', content: result.metadataJson }] : []),
    ...(publishReleaseArtifacts ? [{ name: 'editor_metadata.json', content: result.editorMetadataJson }] : []),
    { name: 'debug_report.json', content: result.debugReport },
    ...optionalFile('generation_release_gate.json', result.generationReleaseGate),
    ...optionalFile('prompt.txt', result.files.promptTxt),
    ...optionalFile('generation.json', result.files.generationJson),
    ...optionalFile('inspection_index.json', result.files.inspectionIndexJson),
    ...optionalFile('inspection_sheet.png', result.files.inspectionSheetPng),
    ...inspectionGifFiles,
    ...inspectionStripFiles,
    ...rowGifFiles,
    ...(publishReleaseArtifacts ? optionalFile('godot_npc_pack.zip', result.files.godotNpcZipBuffer) : []),
    ...(publishReleaseArtifacts ? optionalFile('rpgmaker_pack.zip', result.files.rpgmakerZipBuffer) : []),
    ...(publishReleaseArtifacts ? optionalFile('ocad_pack.zip', result.files.ocadZipBuffer) : []),
    ...(publishReleaseArtifacts ? [{ name: 'character_pack.zip', content: result.files.zipBuffer }] : []),
  ]

  return {
    files,
    urls: {
      result_url: generatedUrl(jobId, publishReleaseArtifacts ? 'metadata.json' : 'generation_release_gate.json'),
      source_url: generatedUrl(jobId, 'source.png'),
      ...(result.files.sourceLayoutOverlayPng ? { source_layout_overlay_url: generatedUrl(jobId, 'source_layout_overlay.png') } : {}),
      ...(result.files.sourceQualityReportJson ? { source_quality_report_url: generatedUrl(jobId, 'source_quality_report.json') } : {}),
      debug_report_url: generatedUrl(jobId, 'debug_report.json'),
      normalized_sheet_url: generatedUrl(jobId, 'normalized_sheet.png'),
      ...(publishReleaseArtifacts && result.files.multiResolutionManifest ? { multi_resolution_manifest_url: generatedUrl(jobId, 'multi_resolution.json') } : {}),
      ...(publishReleaseArtifacts && multiResolutionFiles.length
        ? { multi_resolution_sheet_urls: multiResolutionFiles.map((file) => ({ frame_size: file.frameSize, url: generatedUrl(jobId, file.name) })) }
        : {}),
      debug_overlay_url: generatedUrl(jobId, 'debug_overlay.png'),
      onion_skin_overlay_url: generatedUrl(jobId, 'onion_skin_overlay.png'),
      ...(publishReleaseArtifacts ? { animations_url: generatedUrl(jobId, 'animations.json') } : {}),
      ...(publishReleaseArtifacts ? { metadata_url: generatedUrl(jobId, 'metadata.json') } : {}),
      ...(publishReleaseArtifacts ? { editor_metadata_url: generatedUrl(jobId, 'editor_metadata.json') } : {}),
      ...(result.generationReleaseGate ? { generation_release_gate_url: generatedUrl(jobId, 'generation_release_gate.json') } : {}),
      ...(result.files.promptTxt ? { prompt_url: generatedUrl(jobId, 'prompt.txt') } : {}),
      ...(result.files.generationJson ? { generation_url: generatedUrl(jobId, 'generation.json') } : {}),
      ...(result.files.inspectionIndexJson ? { inspection_index_url: generatedUrl(jobId, 'inspection_index.json') } : {}),
      ...(result.files.inspectionSheetPng ? { inspection_sheet_url: generatedUrl(jobId, 'inspection_sheet.png') } : {}),
      ...(inspectionGifFiles.length ? { inspection_gif_urls: inspectionGifFiles.map((file) => generatedUrl(jobId, file.name)) } : {}),
      ...(inspectionGifPreviews.length ? { inspection_gif_previews: inspectionGifPreviews } : {}),
      ...(publishReleaseArtifacts && result.files.godotNpcZipBuffer ? { godot_npc_zip_url: generatedUrl(jobId, 'godot_npc_pack.zip') } : {}),
      ...(publishReleaseArtifacts && result.files.rpgmakerZipBuffer ? { rpgmaker_zip_url: generatedUrl(jobId, 'rpgmaker_pack.zip') } : {}),
      ...(publishReleaseArtifacts && result.files.ocadZipBuffer ? { ocad_zip_url: generatedUrl(jobId, 'ocad_pack.zip') } : {}),
      ...(publishReleaseArtifacts ? { zip_url: generatedUrl(jobId, 'character_pack.zip') } : {}),
      row_gif_urls: rowGifUrls,
      row_gif_previews: rowGifPreviews,
    },
    ...(artifactDisposition ? { artifactDisposition } : {}),
  }
}
