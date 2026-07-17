import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
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
} = {}) {
  return {
    source_layout: { id: layout },
    validation,
    source_quality: sourceQuality,
    quality_closure: qualityClosure,
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
  const result = await runProductionSheetTextToImage({
    description: 'blue wizard',
    preset: 'fixed_region_motion_v0',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 2, seed: 10 },
    generateSource: async ({ candidateIndex }) => ({
      ...generated(candidateIndex),
      promptContract: { layout_id: 'fixed_region_motion_v0', contract_version: 'test_contract' },
    }),
    processSheet: async (_buffer, _options) => {
      processCalls.push(_options)
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
  assert.equal(processCalls[0].fixedRegionSourceStaging, 'fixed_region_256_crop')
  assert.equal(processCalls[0].fixedRegionStageSize, 256)
  assert.equal(processCalls[0].fixedRegionCropRight, 4)
  assert.equal(processCalls[0].fixedRegionCropBottom, 4)
  assert.equal(processCalls[0].fixedRegionMatteTolerance, 80)
  const [weak, clean] = result.candidateSelection.candidates
  assert.equal(weak.metrics.source_quality_duplicate_motion_actions, 1)
  assert.equal(weak.metrics.source_quality_halo_regions, 1)
  assert.ok(weak.score < clean.score)
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
