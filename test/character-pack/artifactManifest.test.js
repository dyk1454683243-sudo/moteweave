import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCharacterPackArtifactManifest } from '../../src/character-pack/artifactManifest.js'

test('buildCharacterPackArtifactManifest exposes optional source and generation artifacts', () => {
  const manifest = buildCharacterPackArtifactManifest('job_123', {
    animationsJson: {
      animations: {
        walk_down: { display_label: 'walk down (source: walkdown)' },
      },
    },
    inspectionPreviews: [
      {
        fileName: 'inspection_gifs/walk_down.gif',
        runtimeFileName: 'walk_down.gif',
        stripFileName: 'inspection_strips/walk_down.png',
        animation: 'walk_down',
        label: 'walk down inspection',
        frame_count: 4,
        frame_size: { w: 256, h: 256 },
        fps: 10,
        mode: 'loop',
      },
    ],
    metadataJson: { id: 'pack' },
    editorMetadataJson: { sheet: 'normalized_sheet.png' },
    debugReport: { validation: { status: 'pass', blocking_errors: [] } },
    files: {
      sourcePng: Buffer.from('source'),
      sourceLayoutOverlayPng: Buffer.from('source overlay'),
      sourceQualityReportJson: Buffer.from('source quality'),
      normalizedSheetPng: Buffer.from('sheet'),
      multiResolutionManifest: { sheets: [{ frame_size: 64, file: 'normalized_sheet_64.png' }] },
      multiResolutionSheets: { 64: Buffer.from('sheet64') },
      debugOverlayPng: Buffer.from('debug'),
      onionSkinOverlayPng: Buffer.from('onion'),
      promptTxt: Buffer.from('prompt'),
      generationJson: Buffer.from('generation'),
      inspectionIndexJson: { mode: 'inspection_preview_v1' },
      inspectionSheetPng: Buffer.from('inspection sheet'),
      inspectionGifBuffers: { 'inspection_gifs/walk_down.gif': Buffer.from('inspection gif') },
      inspectionStripPngBuffers: { 'inspection_strips/walk_down.png': Buffer.from('inspection strip') },
      rowGifBuffers: { 'walk_down.gif': Buffer.from('gif') },
      godotNpcZipBuffer: Buffer.from('godot'),
      rpgmakerZipBuffer: Buffer.from('rpgmaker'),
      ocadZipBuffer: Buffer.from('ocad'),
      zipBuffer: Buffer.from('zip'),
    },
  })

  assert.deepEqual(
    manifest.files.map((file) => file.name),
    [
      'source.png',
      'source_layout_overlay.png',
      'source_quality_report.json',
      'normalized_sheet.png',
      'multi_resolution.json',
      'normalized_sheet_64.png',
      'debug_overlay.png',
      'onion_skin_overlay.png',
      'animations.json',
      'metadata.json',
      'editor_metadata.json',
      'debug_report.json',
      'prompt.txt',
      'generation.json',
      'inspection_index.json',
      'inspection_sheet.png',
      'inspection_gifs/walk_down.gif',
      'inspection_strips/walk_down.png',
      'walk_down.gif',
      'godot_npc_pack.zip',
      'rpgmaker_pack.zip',
      'ocad_pack.zip',
      'character_pack.zip',
    ]
  )
  assert.equal(manifest.urls.source_url, '/generated/job_123/source.png')
  assert.equal(manifest.urls.source_layout_overlay_url, '/generated/job_123/source_layout_overlay.png')
  assert.equal(manifest.urls.source_quality_report_url, '/generated/job_123/source_quality_report.json')
  assert.equal(manifest.urls.multi_resolution_manifest_url, '/generated/job_123/multi_resolution.json')
  assert.deepEqual(manifest.urls.multi_resolution_sheet_urls, [
    { frame_size: 64, url: '/generated/job_123/normalized_sheet_64.png' },
  ])
  assert.equal(manifest.urls.prompt_url, '/generated/job_123/prompt.txt')
  assert.equal(manifest.urls.generation_url, '/generated/job_123/generation.json')
  assert.equal(manifest.urls.inspection_index_url, '/generated/job_123/inspection_index.json')
  assert.equal(manifest.urls.inspection_sheet_url, '/generated/job_123/inspection_sheet.png')
  assert.deepEqual(manifest.urls.inspection_gif_urls, ['/generated/job_123/inspection_gifs/walk_down.gif'])
  assert.deepEqual(manifest.urls.inspection_gif_previews, [
    {
      animation: 'walk_down',
      file: 'inspection_gifs/walk_down.gif',
      fps: 10,
      frame_count: 4,
      frame_size: { w: 256, h: 256 },
      label: 'walk down inspection',
      mode: 'loop',
      name: 'walk_down.gif',
      runtime_url: '/generated/job_123/walk_down.gif',
      strip_url: '/generated/job_123/inspection_strips/walk_down.png',
      url: '/generated/job_123/inspection_gifs/walk_down.gif',
    },
  ])
  assert.equal(manifest.urls.editor_metadata_url, '/generated/job_123/editor_metadata.json')
  assert.equal(manifest.urls.godot_npc_zip_url, '/generated/job_123/godot_npc_pack.zip')
  assert.equal(manifest.urls.rpgmaker_zip_url, '/generated/job_123/rpgmaker_pack.zip')
  assert.equal(manifest.urls.ocad_zip_url, '/generated/job_123/ocad_pack.zip')
  assert.deepEqual(manifest.urls.row_gif_urls, ['/generated/job_123/walk_down.gif'])
  assert.deepEqual(manifest.urls.row_gif_previews, [
    {
      animation: 'walk_down',
      label: 'walk down (source: walkdown)',
      name: 'walk_down.gif',
      url: '/generated/job_123/walk_down.gif',
    },
  ])
  assert.equal('artifactDisposition' in manifest, false)
  assert.equal('generation_release_gate_url' in manifest.urls, false)
})

test('buildCharacterPackArtifactManifest publishes release artifacts when the live generation gate passes', () => {
  const manifest = buildCharacterPackArtifactManifest('job_release', {
    animationsJson: { animations: {} },
    metadataJson: { id: 'pack' },
    editorMetadataJson: { sheet: 'normalized_sheet.png' },
    debugReport: { validation: { status: 'pass', blocking_errors: [] } },
    generationReleaseGate: {
      schema_version: 1,
      mode: 'generation_release_gate_v1',
      generation_mode: 'production_sheet_v0',
      policy: 'strict_live_generation_v1',
      status: 'pass',
      release_ready: true,
      blocking_errors: [],
      warnings: [],
      evidence: {},
    },
    releaseReady: true,
    artifactDisposition: 'release',
    files: {
      sourcePng: Buffer.from('source'),
      normalizedSheetPng: Buffer.from('sheet'),
      debugOverlayPng: Buffer.from('debug'),
      onionSkinOverlayPng: Buffer.from('onion'),
      rowGifBuffers: {},
      godotNpcZipBuffer: Buffer.from('godot'),
      rpgmakerZipBuffer: Buffer.from('rpgmaker'),
      ocadZipBuffer: Buffer.from('ocad'),
      zipBuffer: Buffer.from('zip'),
    },
  })

  assert.equal(manifest.artifactDisposition, 'release')
  assert.equal(manifest.files.some((file) => file.name === 'generation_release_gate.json'), true)
  assert.equal(manifest.files.some((file) => file.name === 'character_pack.zip'), true)
  assert.equal(manifest.files.some((file) => file.name === 'godot_npc_pack.zip'), true)
  assert.equal(manifest.urls.generation_release_gate_url, '/generated/job_release/generation_release_gate.json')
  assert.equal(manifest.urls.zip_url, '/generated/job_release/character_pack.zip')
  assert.equal(manifest.urls.godot_npc_zip_url, '/generated/job_release/godot_npc_pack.zip')
})

test('buildCharacterPackArtifactManifest keeps diagnostics but omits release packages when the live generation gate fails', () => {
  const manifest = buildCharacterPackArtifactManifest('job_diagnostic', {
    animationsJson: { animations: {} },
    metadataJson: { id: 'pack' },
    editorMetadataJson: { sheet: 'normalized_sheet.png' },
    debugReport: { validation: { status: 'fail', blocking_errors: ['sheet.cell_empty'] } },
    generationReleaseGate: { schema_version: 1, mode: 'generation_release_gate_v1', status: 'fail', release_ready: false, blocking_errors: ['sheet.cell_empty'] },
    releaseReady: false,
    artifactDisposition: 'diagnostic_only',
    files: {
      sourcePng: Buffer.from('source'),
      sourceLayoutOverlayPng: Buffer.from('source overlay'),
      sourceQualityReportJson: { status: 'fail' },
      normalizedSheetPng: Buffer.from('sheet'),
      debugOverlayPng: Buffer.from('debug'),
      onionSkinOverlayPng: Buffer.from('onion'),
      promptTxt: Buffer.from('prompt'),
      generationJson: { provider: 'mock' },
      inspectionSheetPng: Buffer.from('inspection sheet'),
      inspectionGifBuffers: { 'inspection_gifs/walk_down.gif': Buffer.from('inspection gif') },
      rowGifBuffers: { 'walk_down.gif': Buffer.from('gif') },
      godotNpcZipBuffer: Buffer.from('godot'),
      rpgmakerZipBuffer: Buffer.from('rpgmaker'),
      ocadZipBuffer: Buffer.from('ocad'),
      zipBuffer: Buffer.from('zip'),
    },
  })

  const names = manifest.files.map((file) => file.name)
  assert.equal(manifest.artifactDisposition, 'diagnostic_only')
  assert.equal(names.includes('source.png'), true)
  assert.equal(names.includes('normalized_sheet.png'), true)
  assert.equal(names.includes('debug_report.json'), true)
  assert.equal(names.includes('generation_release_gate.json'), true)
  assert.equal(names.includes('source_quality_report.json'), true)
  assert.equal(names.includes('animations.json'), false)
  assert.equal(names.includes('metadata.json'), false)
  assert.equal(names.includes('editor_metadata.json'), false)
  assert.equal(names.includes('prompt.txt'), true)
  assert.equal(names.includes('generation.json'), true)
  assert.equal(names.includes('inspection_sheet.png'), true)
  assert.equal(names.includes('inspection_gifs/walk_down.gif'), true)
  assert.equal(names.includes('walk_down.gif'), true)
  assert.equal(names.includes('character_pack.zip'), false)
  assert.equal(names.includes('godot_npc_pack.zip'), false)
  assert.equal(names.includes('rpgmaker_pack.zip'), false)
  assert.equal(names.includes('ocad_pack.zip'), false)
  assert.equal(manifest.urls.generation_release_gate_url, '/generated/job_diagnostic/generation_release_gate.json')
  assert.equal(manifest.urls.result_url, '/generated/job_diagnostic/generation_release_gate.json')
  assert.equal('metadata_url' in manifest.urls, false)
  assert.equal('editor_metadata_url' in manifest.urls, false)
  assert.equal('zip_url' in manifest.urls, false)
  assert.equal('godot_npc_zip_url' in manifest.urls, false)
  assert.equal('rpgmaker_zip_url' in manifest.urls, false)
  assert.equal('ocad_zip_url' in manifest.urls, false)
})

test('buildCharacterPackArtifactManifest keeps semantic GIF filenames mapped to runtime actions', () => {
  const manifest = buildCharacterPackArtifactManifest('job_456', {
    animationsJson: {
      animations: {
        happy: { display_label: 'happy' },
        talk: { display_label: 'talk' },
      },
    },
    metadataJson: { id: 'pack' },
    debugReport: { validation: { status: 'pass', blocking_errors: [] } },
    rowPreviews: [
      {
        name: 'happy',
        fileName: 'happy.gif',
        label: 'happy',
      },
      {
        name: 'talk',
        fileName: 'talk.gif',
        label: 'talk',
      },
    ],
    files: {
      sourcePng: Buffer.from('source'),
      normalizedSheetPng: Buffer.from('sheet'),
      debugOverlayPng: Buffer.from('debug'),
      onionSkinOverlayPng: Buffer.from('onion'),
      rowGifBuffers: { 'happy.gif': Buffer.from('gif'), 'talk.gif': Buffer.from('gif') },
      zipBuffer: Buffer.from('zip'),
    },
  })

  assert.deepEqual(manifest.urls.row_gif_urls, ['/generated/job_456/happy.gif', '/generated/job_456/talk.gif'])
  assert.deepEqual(manifest.urls.row_gif_previews, [
    {
      animation: 'happy',
      label: 'happy',
      name: 'happy.gif',
      url: '/generated/job_456/happy.gif',
    },
    {
      animation: 'talk',
      label: 'talk',
      name: 'talk.gif',
      url: '/generated/job_456/talk.gif',
    },
  ])
})
