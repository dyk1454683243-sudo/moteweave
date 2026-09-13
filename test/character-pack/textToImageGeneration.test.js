import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import {
  BACKGROUND_MATTE_V2_ALGORITHM,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES,
} from '../../src/character-pack/backgroundMatteV2.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
} from '../../src/character-pack/fixedRegionGeometry.js'
import {
  TEMPLATE_CALIBRATION_MODE,
} from '../../src/character-pack/fixedRegionCalibration.js'
import { evaluateFixedRegionSourceQuality } from '../../src/character-pack/sourceQualityGate.js'
import { resolveSourceLayout } from '../../src/character-pack/sourceLayouts.js'
import {
  runProductionSheetTextToImage,
  runQualityCharacterTextToImage,
  scoreQualityCharacterCandidate,
} from '../../src/character-pack/textToImageGeneration.js'
import {
  CHARACTER_QUALITY_CLOSURE_GATE_IDS,
  CHARACTER_QUALITY_CLOSURE_MODE,
} from '../../src/character-pack/qualityClosureGate.js'

function makeTinyCharacterImage() {
  const image = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const offset = (y * 8 + x) * 4
      image.data[offset] = 255
      image.data[offset + 1] = 255
      image.data[offset + 2] = 255
      image.data[offset + 3] = 255
    }
  }
  for (let y = 2; y < 6; y++) {
    for (let x = 3; x < 5; x++) {
      const offset = (y * 8 + x) * 4
      image.data[offset] = 40
      image.data[offset + 1] = 120
      image.data[offset + 2] = 210
      image.data[offset + 3] = 255
    }
  }
  return encodeRgbaPng(image)
}

function makeCharacterImage({ width = 128, height = 128, rect }) {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      image.data[offset] = 255
      image.data[offset + 1] = 255
      image.data[offset + 2] = 255
      image.data[offset + 3] = 255
    }
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * width + x) * 4
      image.data[offset] = 40
      image.data[offset + 1] = 120
      image.data[offset + 2] = 210
      image.data[offset + 3] = 255
    }
  }
  return encodeRgbaPng(image)
}

function generated(candidateIndex, buffer = Buffer.from('png')) {
  return {
    buffer,
    provider: 'openrouter',
    providerPresetId: 'mock-provider',
    providerLabel: 'Mock provider',
    model: 'mock/model',
    prompt: `prompt ${candidateIndex}`,
    promptContract: { layout_id: 'topdown_rpg_v0', contract_version: 'test_contract' },
    inputImages: { template: true, reference: false, palette: false },
    templateName: 'template.png',
    referenceName: null,
    paletteName: null,
    generationOptions: { candidateCount: 2, provider: { seed: candidateIndex } },
    candidateIndex,
  }
}

async function fixedRegionEdgePressureBuffer() {
  const image = {
    width: FIXED_REGION_SOURCE_SHEET.w,
    height: FIXED_REGION_SOURCE_SHEET.h,
    data: new Uint8ClampedArray(
      FIXED_REGION_SOURCE_SHEET.w * FIXED_REGION_SOURCE_SHEET.h * 4
    ),
  }
  for (const region of Object.values(FIXED_REGION_SOURCE_REGIONS)) {
    const top = region.y + Math.floor((region.h - 10) / 2)
    for (let y = top; y < top + 10; y++) {
      for (let x = region.x + region.w - 3; x < region.x + region.w; x++) {
        const offset = (y * image.width + x) * 4
        image.data.set([40, 120, 210, 255], offset)
      }
    }
  }
  return encodeRgbaPng(image)
}

async function fixedRegionTwoToneMatteBuffer() {
  const image = {
    width: FIXED_REGION_SOURCE_SHEET.w,
    height: FIXED_REGION_SOURCE_SHEET.h,
    data: new Uint8ClampedArray(
      FIXED_REGION_SOURCE_SHEET.w * FIXED_REGION_SOURCE_SHEET.h * 4
    ),
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      image.data.set(
        x < image.width / 2
          ? [245, 245, 245, 255]
          : [170, 205, 245, 255],
        offset
      )
    }
  }
  for (const region of Object.values(FIXED_REGION_SOURCE_REGIONS)) {
    const left = region.x + Math.floor((region.w - 4) / 2)
    const top = region.y + Math.floor((region.h - 10) / 2)
    for (let y = top; y < top + 10; y++) {
      for (let x = left; x < left + 4; x++) {
        const offset = (y * image.width + x) * 4
        image.data.set([40, 120, 70, 255], offset)
      }
    }
  }
  return encodeRgbaPng(image)
}

function countRgb(image, color) {
  let count = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      image.data[offset] === color[0] &&
      image.data[offset + 1] === color[1] &&
      image.data[offset + 2] === color[2] &&
      image.data[offset + 3] > 0
    ) {
      count++
    }
  }
  return count
}

function passingQualityClosure() {
  return {
    mode: CHARACTER_QUALITY_CLOSURE_MODE,
    status: 'pass',
    release_ready: true,
    gates: CHARACTER_QUALITY_CLOSURE_GATE_IDS.map((id) => ({ id, status: 'pass' })),
  }
}

function warningQualityClosure() {
  const closure = passingQualityClosure()
  return {
    ...closure,
    status: 'warning',
    release_ready: false,
    gates: closure.gates.map((gate) => (
      gate.id === 'motion_consistency' ? { ...gate, status: 'warning' } : gate
    )),
  }
}

function productionDebugReport({
  layout = 'topdown_rpg_v0',
  validation = { status: 'pass', warnings: [], blocking_errors: [], metrics: {} },
  sourceQuality = null,
  qualityClosure = passingQualityClosure(),
  generationProfile = null,
  subjectCount = null,
} = {}) {
  return {
    source_layout: { id: layout },
    validation,
    source_quality: sourceQuality,
    quality_closure: qualityClosure,
    ...(generationProfile ? { generation_profile: generationProfile } : {}),
    ...(subjectCount ? { subject_count: subjectCount } : {}),
  }
}

function fullSheetSubjectCount({ status = 'blocked' } = {}) {
  return {
    required: true,
    status,
    source: {
      status,
      stages: [
        { stage: 'pre_calibration_source', status: 'pass' },
        { stage: 'calibrated_source', status },
      ],
    },
    normalized: { stage: 'normalized_frames', status },
    suggested_region_keys: ['walkup0'],
    needs_review_region_keys: [],
    advisory_region_keys: [],
  }
}

test('production sheet text-to-image scores candidates and records selected one', async () => {
  const generatedCalls = []
  const processCalls = []
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'topdown_rpg_v0',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 2, seed: 10 },
    generateSource: async ({ candidateIndex }) => {
      generatedCalls.push(candidateIndex)
      return generated(candidateIndex)
    },
    processSheet: async (_buffer, options) => {
      processCalls.push(options)
      const index = processCalls.length
      return {
        debugReport: productionDebugReport({
          validation: index === 1
            ? { status: 'warning', warnings: ['motion.low'], blocking_errors: [], metrics: {} }
            : { status: 'pass', warnings: [], blocking_errors: [], metrics: {} },
        }),
        files: {},
      }
    },
  })

  assert.deepEqual(generatedCalls, [1, 2])
  assert.equal(result.candidateSelection.selected_index, 2)
  assert.equal(result.candidateSelection.release_selected_index, 2)
  assert.equal(result.candidateSelection.release_ready, true)
  assert.equal(result.candidateSelection.candidate_count, 2)
  const generation = JSON.parse(result.result.files.generationJson.toString('utf8'))
  assert.equal(generation.candidate_selection.selected_index, 2)
  assert.equal(generation.image_config.image_size, '2K')
})

test('production sheet text-to-image candidate selection penalizes weak fixed-region source quality', async () => {
  const processCalls = []
  const calibratedSources = []
  const pressuredSource = await fixedRegionEdgePressureBuffer()
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'fixed_region_motion_v0',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 2, seed: 10 },
    generateSource: async ({ candidateIndex }) => ({
      ...generated(candidateIndex, pressuredSource),
      promptContract: { layout_id: 'fixed_region_motion_v0', contract_version: 'test_contract' },
    }),
    processSheet: async (_buffer, _options) => {
      processCalls.push(_options)
      calibratedSources.push(await loadRgba(_buffer))
      return {
        debugReport: productionDebugReport({
          layout: 'fixed_region_motion_v0',
          validation: { status: 'pass', warnings: [], blocking_errors: [], metrics: {} },
          sourceQuality: _options.sourceFileName === 'candidate_1.png'
            ? {
                status: 'warning',
                warnings: ['source_action_low_motion:walkdown', 'source_region_halo:idleup'],
                blocking_errors: [],
                summary: {
                  duplicate_motion_action_count: 1,
                  halo_region_count: 1,
                  edge_pressure_severe_region_count: 0,
                  empty_region_count: 0,
                },
              }
            : {
                status: 'pass',
                warnings: [],
                blocking_errors: [],
                summary: {
                  duplicate_motion_action_count: 0,
                  halo_region_count: 0,
                  edge_pressure_severe_region_count: 0,
                  empty_region_count: 0,
                },
              },
        }),
        files: {},
      }
    },
  })

  assert.equal(result.candidateSelection.selected_index, 2)
  assert.equal(result.candidateSelection.release_selected_index, 2)
  assert.equal(processCalls[0].fixedRegionSourceStaging, 'none')
  assert.equal(processCalls[0].generation.fixed_region_calibration.mode, TEMPLATE_CALIBRATION_MODE)
  const sourceQuality = evaluateFixedRegionSourceQuality(
    calibratedSources[0],
    resolveSourceLayout('fixed_region_motion_v0')
  )
  assert.equal(sourceQuality.summary.empty_region_count, 0)
  assert.equal(sourceQuality.summary.edge_pressure_severe_region_count, 0)
  assert.equal(sourceQuality.summary.edge_pressure_region_count, 0)
  const [weak, clean] = result.candidateSelection.candidates
  assert.equal(weak.metrics.source_quality_duplicate_motion_actions, 1)
  assert.equal(weak.metrics.source_quality_halo_regions, 1)
  assert.ok(weak.score < clean.score)
})

test('fixed-region calibration normalizes explicit staging overrides before processing', async () => {
  const source = await fixedRegionEdgePressureBuffer()
  let processedImage = null
  let processedOptions = null
  await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'fixed_region_motion_v0',
    generationOptions: { candidateCount: 1 },
    processOptions: {
      fixedRegionSourceStaging: 'none',
      fixedRegionStageSize: 512,
      fixedRegionCropRight: 8,
      fixedRegionCropBottom: 8,
    },
    generateSource: async ({ candidateIndex }) => ({
      ...generated(candidateIndex, source),
      promptContract: {
        layout_id: 'fixed_region_motion_v0',
        contract_version: 'test_contract',
      },
    }),
    processSheet: async (buffer, options) => {
      processedImage = await loadRgba(buffer)
      processedOptions = options
      return {
        debugReport: productionDebugReport({ layout: 'fixed_region_motion_v0' }),
        files: {},
      }
    },
  })

  assert.deepEqual(
    { width: processedImage.width, height: processedImage.height },
    {
      width: FIXED_REGION_SOURCE_SHEET.w,
      height: FIXED_REGION_SOURCE_SHEET.h,
    }
  )
  assert.equal(processedOptions.fixedRegionSourceStaging, 'none')
  assert.equal(processedOptions.fixedRegionStageSize, 512)
  assert.equal(processedOptions.fixedRegionCropRight, 8)
  assert.equal(processedOptions.fixedRegionCropBottom, 8)
})

test('fixed-region calibration removes a nonuniform opaque matte before fitting poses', async () => {
  const source = await fixedRegionTwoToneMatteBuffer()
  let processedImage = null
  let processedOptions = null
  await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'fixed_region_motion_v0',
    backgroundMode: 'auto',
    generationOptions: { candidateCount: 1 },
    generateSource: async ({ candidateIndex }) => ({
      ...generated(candidateIndex, source),
      promptContract: {
        layout_id: 'fixed_region_motion_v0',
        contract_version: 'test_contract',
      },
    }),
    processSheet: async (buffer, options) => {
      processedImage = await loadRgba(buffer)
      processedOptions = options
      return {
        debugReport: productionDebugReport({ layout: 'fixed_region_motion_v0' }),
        files: {},
      }
    },
  })

  assert.equal(
    processedOptions.generation.fixed_region_calibration.background_removal.mode,
    'edge_palette'
  )
  assert.equal(countRgb(processedImage, [245, 245, 245]), 0)
  assert.equal(countRgb(processedImage, [170, 205, 245]), 0)
})

test('production sheet text-to-image leaves non-fixed generated candidates unchanged', async () => {
  const source = Buffer.from('unchanged-non-fixed-source')
  let processedSource = null
  let processedOptions = null
  await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'topdown_rpg_v0',
    generationOptions: { candidateCount: 1 },
    generateSource: async ({ candidateIndex }) => generated(candidateIndex, source),
    processSheet: async (buffer, options) => {
      processedSource = buffer
      processedOptions = options
      return {
        debugReport: productionDebugReport(),
        files: {},
      }
    },
  })

  assert.strictEqual(processedSource, source)
  assert.equal(processedOptions.generation.fixed_region_calibration, null)
})

test('fixed-region generation calibration survives real processing without edge, empty, or cropped failures', async () => {
  const source = await fixedRegionEdgePressureBuffer()
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'fixed_region_motion_v0',
    generationOptions: { candidateCount: 1 },
    generateSource: async ({ candidateIndex }) => ({
      ...generated(candidateIndex, source),
      promptContract: {
        layout_id: 'fixed_region_motion_v0',
        contract_version: 'test_contract',
      },
    }),
  })

  const report = result.result.debugReport
  assert.equal(report.source_quality.summary.empty_region_count, 0)
  assert.equal(report.source_quality.summary.edge_pressure_region_count, 0)
  assert.equal(
    report.validation.blocking_errors.some((message) => (
      /^frame_\d+_(?:empty|cropped)$/.test(message)
    )),
    false
  )
})

test('production sheet publishes an eligible candidate even when a blocked diagnostic candidate scores higher', async () => {
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'topdown_rpg_v0',
    generationOptions: { candidateCount: 2 },
    generateSource: async ({ candidateIndex }) => generated(candidateIndex),
    processSheet: async (_buffer, options) => {
      const index = Number(options.sourceFileName.match(/\d+/)?.[0])
      return {
        candidateIndex: index,
        debugReport: productionDebugReport({
          validation: {
            status: 'pass',
            warnings: [],
            blocking_errors: [],
            metrics: index === 2
              ? { duplicate_frames: { unexpected_group_count: 1 } }
              : {},
          },
          qualityClosure: index === 1
            ? warningQualityClosure()
            : passingQualityClosure(),
        }),
        files: {},
      }
    },
  })

  assert.equal(result.candidateSelection.selected_index, 1)
  assert.equal(result.candidateSelection.release_selected_index, 2)
  assert.equal(result.candidateSelection.release_ready, true)
  assert.equal(result.result.candidateIndex, 2)
  assert.equal(result.result.generationReleaseGate.release_ready, true)
  assert.ok(result.candidateSelection.candidates[0].score > result.candidateSelection.candidates[1].score)
})

test('production sheet returns diagnostic-only evidence when every processed candidate is blocked', async () => {
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'topdown_rpg_v0',
    generationOptions: { candidateCount: 2 },
    generateSource: async ({ candidateIndex }) => generated(candidateIndex),
    processSheet: async () => ({
      debugReport: productionDebugReport({
        qualityClosure: warningQualityClosure(),
      }),
      files: {},
    }),
  })

  assert.equal(result.candidateSelection.release_selected_index, null)
  assert.equal(result.candidateSelection.release_ready, false)
  assert.equal(result.candidateSelection.artifact_disposition, 'diagnostic_only')
  assert.equal(result.releaseReady, false)
  assert.equal(result.result.generationReleaseGate.release_ready, false)
})

test('strict full-sheet generation returns review-required evidence without automatic rejection or release', async () => {
  const source = await makeCharacterImage({
    width: 512,
    height: 512,
    rect: { x: 206, y: 112, w: 100, h: 280 },
  })
  let providerCalls = 0
  const stageOrder = []
  let backgroundRemovedImage = null
  let processingInput = null
  const result = await runProductionSheetTextToImage({
    description: 'forest ranger',
    preset: 'fixed_region_motion_v0',
    generationProfileId: 'full_sheet_fixed_region_v1',
    backgroundMatteV2ArtifactUrlPrefix: '/generated/text_to_image_v2_unit',
    generationOptions: { candidateCount: 1 },
    generateSource: async ({ candidateIndex, preset, backgroundMode, t2iMode }) => {
      providerCalls++
      assert.equal(preset, 'fixed_region_motion_v0')
      assert.equal(backgroundMode, BACKGROUND_MATTE_V2_ALGORITHM)
      assert.equal(t2iMode, 'production_sheet_v0')
      return {
        ...generated(candidateIndex, source),
        mimeType: 'image/png',
        generationProfileId: 'full_sheet_fixed_region_v1',
        promptContract: {
          layout_id: 'fixed_region_motion_v0',
          t2i_mode: 'production_sheet_v0',
          background_mode: BACKGROUND_MATTE_V2_ALGORITHM,
          contract_version: 'character_prompt_contract_v1_18',
        },
      }
    },
    onRawProviderOutput: async ({ buffer, fileName, metadata }) => {
      stageOrder.push('raw_provider_output')
      assert.deepEqual(buffer, source)
      assert.equal(fileName, 'raw_provider_output.png')
      assert.equal(metadata.processing, 'none')
    },
    onBackgroundRemovedProviderOutput: async ({ buffer, fileName, metadata }) => {
      stageOrder.push('background_removed_provider_output')
      backgroundRemovedImage = await loadRgba(buffer)
      assert.equal(fileName, 'background_removed_provider_output.png')
      assert.equal(metadata.processing, 'background_removal_only')
      assert.equal(metadata.width, 512)
      assert.equal(metadata.height, 512)
      assert.equal(metadata.source_file, 'raw_provider_output.png')
      assert.match(metadata.source_sha256, /^[a-f0-9]{64}$/)
    },
    processSheet: async (buffer, options) => {
      stageOrder.push('process_sheet')
      processingInput = await loadRgba(buffer)
      assert.equal(options.backgroundMode, 'already_processed')
      assert.equal(options.backgroundRequestMode, BACKGROUND_MATTE_V2_ALGORITHM)
      assert.equal(options.inputAlphaProvenance, 'calibrated')
      return {
        debugReport: productionDebugReport({
          layout: 'fixed_region_motion_v0',
          validation: {
            status: 'warning',
            warnings: ['frame_17_baseline_drift'],
            blocking_errors: [],
            metrics: {},
          },
          sourceQuality: {
            status: 'warning',
            warnings: ['source_action_scale_inconsistent:climb'],
            blocking_errors: [],
            summary: {},
          },
          qualityClosure: warningQualityClosure(),
          generationProfile: { id: 'full_sheet_fixed_region_v1' },
          subjectCount: fullSheetSubjectCount(),
        }),
        files: {},
      }
    },
  })

  assert.equal(providerCalls, 1)
  assert.deepEqual(stageOrder, [
    'raw_provider_output',
    'background_removed_provider_output',
    'process_sheet',
  ])
  assert.deepEqual(
    { width: backgroundRemovedImage.width, height: backgroundRemovedImage.height },
    { width: 512, height: 512 },
  )
  assert.deepEqual(
    { width: processingInput.width, height: processingInput.height },
    { width: FIXED_REGION_SOURCE_SHEET.w, height: FIXED_REGION_SOURCE_SHEET.h },
  )
  for (let offset = 0; offset < processingInput.data.length; offset += 4) {
    assert.ok([0, 255].includes(processingInput.data[offset + 3]))
    if (processingInput.data[offset + 3] === 0) {
      assert.deepEqual([...processingInput.data.subarray(offset, offset + 3)], [0, 0, 0])
    }
  }
  assert.equal(result.releaseReady, false)
  assert.equal(result.manualReviewRequired, true)
  assert.equal(result.humanDecisionStatus, 'pending')
  assert.equal(result.artifactDisposition, 'review_required')
  assert.equal(result.candidateSelection.release_selected_index, null)
  assert.equal(result.candidateSelection.artifact_disposition, 'review_required')
  assert.equal(result.candidateSelection.review_status, 'awaiting_human_review')
  assert.equal(result.releaseGate.status, 'needs_review')
  assert.deepEqual(result.releaseGate.blocking_errors, [])
  assert.ok(result.releaseGate.automated_review_findings.includes('subject_count.multiple_subjects_blocked'))
  assert.equal(result.result.files.rawProviderOutputFileName, 'raw_provider_output.png')
  assert.deepEqual(result.result.files.rawProviderOutputBuffer, source)
  assert.equal(
    result.result.files.backgroundRemovedProviderOutputFileName,
    'background_removed_provider_output.png',
  )
  assert.ok(Buffer.isBuffer(result.result.files.backgroundRemovedProviderOutputBuffer))
  assert.deepEqual(
    Object.keys(result.result.files.backgroundMatteV2ArtifactBuffers).sort(),
    [...BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES].sort(),
  )
  const generation = JSON.parse(result.result.files.generationJson.toString('utf8'))
  assert.equal(generation.raw_provider_output.file, 'raw_provider_output.png')
  assert.equal(generation.raw_provider_output.byte_length, source.length)
  assert.equal(generation.raw_provider_output.detected_mime_type, 'image/png')
  assert.equal(generation.raw_provider_output.declared_mime_type, 'image/png')
  assert.equal(generation.raw_provider_output.mime_matches_declared, true)
  assert.ok(generation.raw_provider_output.width > 0)
  assert.ok(generation.raw_provider_output.height > 0)
  assert.equal(generation.raw_provider_output.processing, 'none')
  assert.match(generation.raw_provider_output.sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    generation.background_removed_provider_output.file,
    'background_removed_provider_output.png',
  )
  assert.equal(generation.background_removed_provider_output.width, 512)
  assert.equal(generation.background_removed_provider_output.height, 512)
  assert.equal(
    generation.background_removed_provider_output.processing,
    'background_removal_only',
  )
  assert.equal(
    generation.background_removed_provider_output.source_sha256,
    generation.raw_provider_output.sha256,
  )
  assert.equal(generation.background_matte_v2.recipe_id, BACKGROUND_MATTE_V2_ALGORITHM)
  assert.equal(generation.background_matte_v2.provider_calls_used, 0)
  assert.equal(generation.fixed_region_calibration.staging.matte_applied, false)
  assert.equal(generation.fixed_region_calibration.processing_ready_staging.matte_applied, false)
  assert.equal(
    generation.fixed_region_calibration.background_removal.production_hard_alpha.alpha_threshold_byte,
    128,
  )
  assert.deepEqual(
    Object.keys(generation.background_matte_v2.artifacts).sort(),
    Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES).sort(),
  )
})

test('strict fixed-region V2 rejects invalid activation configuration before a Provider call', async () => {
  let providerCalls = 0
  const generateSource = async () => {
    providerCalls++
    throw new Error('Provider must not be called')
  }

  await assert.rejects(
    runProductionSheetTextToImage({
      preset: 'fixed_region_motion_v0',
      generationProfileId: 'full_sheet_fixed_region_v1',
      backgroundMode: 'auto',
      backgroundMatteV2ArtifactUrlPrefix: '/generated/preflight_unit',
      generateSource,
    }),
    /background mode cannot be overridden/,
  )
  await assert.rejects(
    runProductionSheetTextToImage({
      preset: 'fixed_region_motion_v0',
      generationProfileId: 'full_sheet_fixed_region_v1',
      backgroundMode: BACKGROUND_MATTE_V2_ALGORITHM,
      generateSource,
    }),
    /artifact URL prefix is required/,
  )
  await assert.rejects(
    runProductionSheetTextToImage({
      preset: 'fixed_region_motion_v0',
      generationProfileId: 'full_sheet_fixed_region_v1',
      backgroundMode: BACKGROUND_MATTE_V2_ALGORITHM,
      backgroundMatteV2ArtifactUrlPrefix: '/invalid/preflight_unit',
      generateSource,
    }),
    /artifact URL prefix is required/,
  )
  await assert.rejects(
    runProductionSheetTextToImage({
      preset: 'fixed_region_motion_v0',
      backgroundMode: BACKGROUND_MATTE_V2_ALGORITHM,
      backgroundMatteV2ArtifactUrlPrefix: '/generated/unprofiled_preflight_unit',
      generateSource,
    }),
    /not enabled for this path/,
  )
  await assert.rejects(
    runProductionSheetTextToImage({
      preset: 'topdown_rpg_v0',
      generationProfileId: 'full_sheet_fixed_region_v1',
      backgroundMatteV2ArtifactUrlPrefix: '/generated/wrong_preset_preflight_unit',
      generateSource,
    }),
    /source layout cannot be overridden/,
  )
  assert.equal(providerCalls, 0)
})

test('strict fixed-region V2 preserves Raw then rejects generated prompt-contract drift before Matte', async () => {
  let providerCalls = 0
  let rawWrites = 0
  let backgroundWrites = 0
  let processCalls = 0
  for (const promptContract of [
    {
      layout_id: 'topdown_rpg_v0',
      t2i_mode: 'production_sheet_v0',
      background_mode: BACKGROUND_MATTE_V2_ALGORITHM,
    },
    {
      layout_id: 'fixed_region_motion_v0',
      t2i_mode: 'quality_character_v0',
      background_mode: BACKGROUND_MATTE_V2_ALGORITHM,
    },
    {
      layout_id: 'fixed_region_motion_v0',
      t2i_mode: 'production_sheet_v0',
      background_mode: 'auto',
    },
  ]) {
    await assert.rejects(
      runProductionSheetTextToImage({
        generationProfileId: 'full_sheet_fixed_region_v1',
        backgroundMatteV2ArtifactUrlPrefix: '/generated/prompt_drift_unit',
        generateSource: async ({ preset, backgroundMode }) => {
          providerCalls++
          assert.equal(preset, 'fixed_region_motion_v0')
          assert.equal(backgroundMode, BACKGROUND_MATTE_V2_ALGORITHM)
          return {
            ...generated(1),
            promptContract,
          }
        },
        onRawProviderOutput: async () => {
          rawWrites++
        },
        onBackgroundRemovedProviderOutput: async () => {
          backgroundWrites++
        },
        processSheet: async () => {
          processCalls++
          throw new Error('processing must not run')
        },
      }),
      /generated prompt contract does not match generation profile/,
    )
  }
  assert.equal(providerCalls, 3)
  assert.equal(rawWrites, 3)
  assert.equal(backgroundWrites, 0)
  assert.equal(processCalls, 0)
})

test('quality character candidate scoring preserves missing hard metrics for fail-closed evaluation', () => {
  const base = {
    styleReport: {
      metrics: {
        visible_pixel_count: 1000,
        unique_color_count: 8,
      },
    },
    finishReport: {
      palette_snap: { changed_pixel_ratio: 0.2 },
      outline: { outline_pixel_ratio: 0.02 },
      quality_spec: {
        bbox: { x: 32, y: 16, w: 48, h: 80 },
        metrics: {
          bbox_width_ratio: 0.375,
          bbox_height_ratio: 0.625,
          bbox_area_ratio: 0.2344,
          center_offset_ratio: 0,
          edge_margin_ratio: 0.125,
        },
      },
    },
  }
  const cases = [
    ['visible_pixel_count', (input) => delete input.styleReport.metrics.visible_pixel_count],
    ['bbox_width_ratio', (input) => delete input.finishReport.quality_spec.metrics.bbox_width_ratio],
    ['bbox_height_ratio', (input) => delete input.finishReport.quality_spec.metrics.bbox_height_ratio],
    ['bbox_area_ratio', (input) => delete input.finishReport.quality_spec.metrics.bbox_area_ratio],
    ['center_offset_ratio', (input) => delete input.finishReport.quality_spec.metrics.center_offset_ratio],
    ['edge_margin_ratio', (input) => delete input.finishReport.quality_spec.metrics.edge_margin_ratio],
  ]

  for (const [metric, removeMetric] of cases) {
    const input = structuredClone(base)
    removeMetric(input)
    const result = scoreQualityCharacterCandidate(input)
    assert.equal(result.release_ready, false, metric)
    assert.equal(result.metrics[metric], null, metric)
    assert.ok(result.blocking_errors.includes(`quality_character_metrics_missing:${metric}`), metric)
  }

  const nonFiniteCases = [
    ['visible_pixel_count', Number.NaN, (input, value) => { input.styleReport.metrics.visible_pixel_count = value }],
    ['bbox_width_ratio', Number.POSITIVE_INFINITY, (input, value) => { input.finishReport.quality_spec.metrics.bbox_width_ratio = value }],
  ]
  for (const [metric, value, setMetric] of nonFiniteCases) {
    const input = structuredClone(base)
    setMetric(input, value)
    const result = scoreQualityCharacterCandidate(input)
    assert.equal(result.release_ready, false, metric)
    assert.equal(result.metrics[metric], null, metric)
    assert.ok(result.blocking_errors.includes(`quality_character_metrics_missing:${metric}`), metric)
  }
})

test('production sheet reports local candidate processing failures as post-processing failures', async () => {
  await assert.rejects(
    runProductionSheetTextToImage({
      description: 'blue wizard',
      preset: 'topdown_rpg_v0',
      generationOptions: { candidateCount: 2 },
      generateSource: async ({ candidateIndex }) => generated(candidateIndex),
      processSheet: async (_buffer, options) => {
        throw new Error(`invalid sheet ${options.sourceFileName}`)
      },
    }),
    (error) => {
      assert.equal(error.status, 'failed_post_processing')
      assert.equal(error.failure_status, 'failed_post_processing')
      assert.equal(error.retry_hint, 'manual_inspect')
      assert.equal(error.candidate_selection.candidates.length, 2)
      assert.ok(error.candidate_selection.candidates.every((candidate) => (
        candidate.failure_stage === 'post_processing' &&
        candidate.failure_status === 'failed_post_processing'
      )))
      return true
    }
  )
})

test('local processing evidence remains authoritative when a later provider route is blocked', async () => {
  await assert.rejects(
    runProductionSheetTextToImage({
      description: 'blue wizard',
      preset: 'topdown_rpg_v0',
      generationOptions: { candidateCount: 2 },
      generateSource: async ({ candidateIndex }) => {
        if (candidateIndex === 1) return generated(candidateIndex)
        throw Object.assign(new Error('provider route blocked'), {
          status: 'provider_route_blocked',
          failure_status: 'provider_route_blocked',
          retry_hint: 'switch_provider_preset',
          non_retryable: true,
        })
      },
      processSheet: async () => {
        throw new Error('invalid generated sheet')
      },
    }),
    (error) => {
      assert.equal(error.status, 'failed_post_processing')
      assert.equal(error.failure_status, 'failed_post_processing')
      assert.equal(error.retry_hint, 'manual_inspect')
      assert.deepEqual(
        error.candidate_selection.candidates.map((candidate) => candidate.failure_stage),
        ['post_processing', 'provider']
      )
      return true
    }
  )
})

test('production sheet keeps standalone and packaged generation evidence aligned with release selection', async () => {
  const initialZip = new JSZip()
  initialZip.file('metadata.json', JSON.stringify({ generation: { candidate_selection: null } }))
  initialZip.file('generation.json', JSON.stringify({ candidate_selection: null }))
  const zipBuffer = await initialZip.generateAsync({ type: 'nodebuffer' })
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'topdown_rpg_v0',
    generationOptions: { candidateCount: 1 },
    generateSource: async ({ candidateIndex }) => generated(candidateIndex),
    processSheet: async () => ({
      metadataJson: { generation: { candidate_selection: null } },
      debugReport: productionDebugReport(),
      files: { zipBuffer },
    }),
  })

  assert.equal(result.result.metadataJson.generation.candidate_selection.release_selected_index, 1)
  const packaged = await JSZip.loadAsync(result.result.files.zipBuffer)
  const packagedMetadata = JSON.parse(await packaged.file('metadata.json').async('string'))
  const packagedGeneration = JSON.parse(await packaged.file('generation.json').async('string'))
  const packagedGate = JSON.parse(await packaged.file('generation_release_gate.json').async('string'))
  assert.equal(packagedMetadata.generation.candidate_selection.release_selected_index, 1)
  assert.equal(packagedGeneration.candidate_selection.release_selected_index, 1)
  assert.equal(packagedGate.release_ready, true)
})

test('production sheet reports packaging evidence failures as post-processing failures', async () => {
  await assert.rejects(
    runProductionSheetTextToImage({
      description: 'blue wizard',
      preset: 'topdown_rpg_v0',
      generationOptions: { candidateCount: 1 },
      generateSource: async ({ candidateIndex }) => generated(candidateIndex),
      processSheet: async () => ({
        metadataJson: {},
        debugReport: productionDebugReport(),
        files: { zipBuffer: Buffer.from('not a zip') },
      }),
    }),
    (error) => {
      assert.equal(error.status, 'failed_post_processing')
      assert.equal(error.failure_status, 'failed_post_processing')
      assert.equal(error.retry_hint, 'manual_inspect')
      assert.equal(error.candidate_selection.release_selected_index, 1)
      return true
    }
  )
})

test('quality character text-to-image writes finished result metadata', async () => {
  const image = await makeCharacterImage({ rect: { x: 44, y: 24, w: 40, h: 72 } })
  const result = await runQualityCharacterTextToImage({
    description: 'silver swordswoman',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 2, seed: 20 },
    backgroundMode: 'auto',
    generateSource: async ({ candidateIndex }) => generated(candidateIndex, image),
  })

  assert.equal(result.mode, 'quality_character_v0')
  assert.equal(result.report.candidate_selection.candidate_count, 2)
  assert.equal(result.report.selected_index, 1)
  assert.equal(result.report.release_selected_index, 1)
  assert.equal(result.report.release_ready, true)
  assert.ok(Buffer.isBuffer(result.sourcePng))
  assert.ok(Buffer.isBuffer(result.resultPng))
  assert.equal(result.generationJson.candidate_selection.selected_index, 1)
  assert.equal(result.generationJson.candidate_selection.release_selected_index, 1)
  assert.equal(result.candidates.length, 2)
  assert.ok(result.candidates.every((candidate) => Buffer.isBuffer(candidate.buffer)))
  assert.equal(typeof result.report.pixel_finishing.quality_spec.metrics.bbox_area_ratio, 'number')
})

test('quality character text-to-image exposes candidate selection when all candidates fail', async () => {
  await assert.rejects(
    runQualityCharacterTextToImage({
      description: 'silver swordswoman',
      imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
      generationOptions: { candidateCount: 2 },
      generateSource: async ({ candidateIndex }) => {
        throw new Error(`provider failed ${candidateIndex}`)
      },
    }),
    (error) => {
      assert.equal(error.status, 'failed_all_candidates')
      assert.equal(error.candidate_selection.candidate_count, 2)
      assert.equal(error.candidate_selection.selected_index, 1)
      assert.deepEqual(error.candidate_selection.candidates.map((candidate) => candidate.reason), [
        'provider failed 1',
        'provider failed 2',
      ])
      return true
    }
  )
})

test('quality character reports invalid generated images as post-processing failures', async () => {
  await assert.rejects(
    runQualityCharacterTextToImage({
      description: 'silver swordswoman',
      generationOptions: { candidateCount: 2 },
      generateSource: async ({ candidateIndex }) => generated(candidateIndex, Buffer.from('not a png')),
    }),
    (error) => {
      assert.equal(error.status, 'failed_post_processing')
      assert.equal(error.failure_status, 'failed_post_processing')
      assert.equal(error.retry_hint, 'manual_inspect')
      assert.ok(error.candidate_selection.candidates.every((candidate) => (
        candidate.failure_stage === 'post_processing' &&
        candidate.failure_status === 'failed_post_processing'
      )))
      return true
    }
  )
})

test('quality character returns diagnostic-only evidence when every finished candidate fails the hard gate', async () => {
  const oversized = await makeCharacterImage({ rect: { x: 2, y: 2, w: 124, h: 124 } })
  const result = await runQualityCharacterTextToImage({
    description: 'oversized guardian',
    generationOptions: { candidateCount: 2 },
    generateSource: async ({ candidateIndex }) => generated(candidateIndex, oversized),
  })

  assert.equal(result.report.status, 'failed_quality_gate')
  assert.equal(result.report.release_selected_index, null)
  assert.equal(result.report.release_ready, false)
  assert.equal(result.artifactDisposition, 'diagnostic_only')
  assert.equal(result.generationReleaseGate.release_ready, false)
  assert.ok(result.report.candidate_selection.candidates.every((candidate) => candidate.release_ready === false))
})

test('quality character text-to-image stops early when provider route is blocked', async () => {
  const generatedCalls = []
  await assert.rejects(
    runQualityCharacterTextToImage({
      description: 'silver swordswoman',
      imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
      generationOptions: { candidateCount: 4 },
      generateSource: async ({ candidateIndex }) => {
        generatedCalls.push(candidateIndex)
        throw Object.assign(new Error('The request is prohibited due to a violation of provider terms of service.'), {
          status: 'provider_route_blocked',
          failure_status: 'provider_route_blocked',
          retry_hint: 'switch_provider_preset',
          non_retryable: true,
        })
      },
    }),
    (error) => {
      assert.equal(error.status, 'provider_route_blocked')
      assert.equal(error.failure_status, 'provider_route_blocked')
      assert.equal(error.retry_hint, 'switch_provider_preset')
      assert.equal(error.candidate_selection.candidate_count, 4)
      assert.equal(error.candidate_selection.candidates.length, 1)
      assert.equal(error.candidate_selection.candidates[0].failure_status, 'provider_route_blocked')
      return true
    }
  )
  assert.deepEqual(generatedCalls, [1])
})

test('quality character text-to-image prefers compact silhouettes over oversized display art', async () => {
  const oversized = await makeCharacterImage({ rect: { x: 4, y: 4, w: 120, h: 120 } })
  const compact = await makeCharacterImage({ rect: { x: 44, y: 24, w: 40, h: 72 } })
  const result = await runQualityCharacterTextToImage({
    description: 'blue wizard',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 2 },
    generateSource: async ({ candidateIndex }) => (
      candidateIndex === 1 ? generated(candidateIndex, oversized) : generated(candidateIndex, compact)
    ),
  })

  assert.equal(result.report.selected_index, 2)
  assert.equal(result.report.release_selected_index, 2)
  const [largeCandidate, compactCandidate] = result.report.candidate_selection.candidates
  assert.ok(largeCandidate.metrics.bbox_area_ratio > compactCandidate.metrics.bbox_area_ratio)
  assert.ok(largeCandidate.score < compactCandidate.score)
})
