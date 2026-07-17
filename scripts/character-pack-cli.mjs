#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  recomputeOpenRouterBenchmarkReport,
  runOpenRouterCharacterBenchmark,
  selectOpenRouterBenchmarkCases,
} from '../src/character-pack/benchmark/openRouterBenchmark.js'
import {
  buildTopdownQualityClosurePlan,
  runTopdownQualityClosureGate,
} from '../src/character-pack/benchmark/topdownQualityClosureGate.js'
import {
  buildT2iGoldenReview,
  buildT2iGoldenReviewHtml,
  buildT2iGoldenReviewMarkdown,
} from '../src/character-pack/benchmark/t2iGoldenReview.js'
import { applyTopdownRepairCells } from '../src/character-pack/benchmark/topdownRepairApply.js'
import {
  buildTopdownRepairCellPrompt,
  buildTopdownRepairReferenceImages,
  generateTopdownRepairCell,
} from '../src/character-pack/benchmark/topdownRepairGenerate.js'
import {
  buildTopdownRepairLoopPlan,
  runTopdownRepairLoop,
  serializeTopdownRepairLoopPlan,
  serializeTopdownRepairLoopResult,
} from '../src/character-pack/benchmark/topdownRepairLoop.js'
import { buildTopdownRepairPlansForBenchmarkReport } from '../src/character-pack/benchmark/topdownRepairPlan.js'
import { buildTopdownRepairManifestForBenchmarkReport } from '../src/character-pack/benchmark/topdownRepairManifest.js'
import {
  buildCharacterQualityClosureRepairManifestForSources,
  renderCharacterQualityClosureRepairManifestMarkdown,
} from '../src/character-pack/benchmark/qualityClosureRepairManifest.js'
import {
  buildQualityClosureRepairLoopPlan,
  runQualityClosureRepairLoop,
  serializeQualityClosureRepairLoopPlan,
  serializeQualityClosureRepairLoopResult,
} from '../src/character-pack/benchmark/qualityClosureRepairLoop.js'
import {
  applyQualityClosureProviderRepairs,
  serializeQualityClosureProviderRepairApplyResult,
} from '../src/character-pack/benchmark/qualityClosureRepairApply.js'
import {
  buildQualityClosureProviderHandoff,
  renderQualityClosureProviderHandoffMarkdown,
} from '../src/character-pack/benchmark/qualityClosureProviderHandoff.js'
import {
  buildQualityClosureProviderRepairReferenceImages,
  buildQualityClosureProviderRepairLoopPlan,
  runQualityClosureProviderRepairLoop,
  serializeQualityClosureProviderRepairLoopPlan,
  serializeQualityClosureProviderRepairLoopResult,
} from '../src/character-pack/benchmark/qualityClosureProviderRepairLoop.js'
import {
  DEFAULT_LOCAL_IMAGE_MANIFEST,
  runLocalImageBenchmark,
} from '../src/character-pack/benchmark/localImageBenchmark.js'
import {
  addLocalImageSample,
  validateLocalImageManifest,
} from '../src/character-pack/benchmark/localImageManifest.js'
import { runProcessedSampleBenchmark } from '../src/character-pack/benchmark/processedSampleBenchmark.js'
import { writeCharacterPackArtifacts } from '../src/character-pack/artifactWriter.js'
import { DEFAULT_GENERATION_PRESET } from '../src/character-pack/generationDefaults.js'
import { encodeRgbaPng, loadRgba } from '../src/character-pack/imageCodec.js'
import { normalizePixelGridRefinementOptions } from '../src/character-pack/pixelGridRefinement.js'
import { processSheetBuffer } from '../src/character-pack/processSheet.js'
import { getGeminiProviderState } from '../src/character-pack/providers/providerConfig.js'
import { buildCharacterPromptContract, compileProviderPrompt, summarizePromptContract } from '../src/character-pack/promptContracts.js'
import { applyPixelStyleCorrection } from '../src/character-pack/stylePipeline.js'
import { loadTemplateImage } from '../src/character-pack/templateStore.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../src/character-pack/sourceLayouts.js'
import { writeTextToImageArtifacts } from '../src/character-pack/textToImageArtifacts.js'
import {
  buildQualityCharacterPrompt,
  normalizeGenerationOptions,
  normalizeTextToImageMode,
  parsePromptFieldEntries,
  resolveTextToImageAspectRatio,
  summarizeQualityPromptContract,
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
} from '../src/character-pack/textToImagePrompt.js'
import {
  buildT2iGoldenBenchmarkPlan,
  runProductionSheetTextToImage,
  runQualityCharacterTextToImage,
  T2I_GOLDEN_CASES,
} from '../src/character-pack/textToImageGeneration.js'
import {
  buildSceneTilePromptContract,
  compileSceneTilePromptContract,
  summarizeSceneTilePromptContract,
} from '../src/scene-pack/tilePromptContracts.js'
import { generateSceneTilePack } from '../src/scene-pack/tileGenerate.js'
import {
  buildTileConditioningReview,
  renderTileConditioningContactSheet,
} from '../src/scene-pack/tileConditioningReview.js'
import { conditionTileSheetEdges } from '../src/scene-pack/tileEdgeConditioning.js'
import { buildScenePackFromTileSheet } from '../src/scene-pack/tileSheetIngestion.js'
import { writeScenePackArtifacts } from '../src/scene-pack/artifactWriter.js'
import {
  buildSceneTileLiveGatePlan,
  runSceneTileLiveGate,
} from '../src/scene-pack/benchmark/sceneTileLiveGate.js'
import {
  buildSceneTileManualPromptPack,
  inspectSceneTileManualRetestInputs,
  renderSceneTileManualHandoff,
} from '../src/scene-pack/benchmark/sceneTileManualPromptPack.js'
import { runSceneTileCorrectionMatrix } from '../src/scene-pack/benchmark/sceneTileCorrectionMatrix.js'
import { writeSceneTileReport } from '../src/scene-pack/benchmark/sceneTileReport.js'
import { writeProjectPackArtifacts } from '../src/project-pack/artifactWriter.js'
import { buildProjectPack } from '../src/project-pack/projectPack.js'
import { loadCharacterPackResultFromDir, loadScenePackResultFromDir } from '../src/project-pack/artifactLoader.js'
import { createMotionSourceContract } from '../src/motion-source/contract.js'
import { normalizeMotionSelectionOptions } from '../src/motion-source/frameSelector.js'
import { buildMotionStrip } from '../src/motion-source/stripBuilder.js'
import { applyMotionStrip } from '../src/motion-source/stripApplier.js'
import { applyMotionSourceSet } from '../src/motion-source/sourceSetApplier.js'
import { validateMotionSourceSetManifest } from '../src/motion-source/sourceSet.js'
import { evaluateIdentityConsistency } from '../src/motion-source/identityConsistencyGate.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../src/two-point-five-d/tilesetContract.js'
import { writeTwoPointFiveDTilesetArtifacts } from '../src/two-point-five-d/atlasExporter.js'
import { generateTwoPointFiveDMaterialSource } from '../src/two-point-five-d/aiMaterialSourceBridge.js'
import { runMaterialSourceEvidenceGate } from '../src/two-point-five-d/materialSourceEvidenceGate.js'
import {
  buildTwoPointFiveDMaterialSourceBenchmarkPlan,
  runTwoPointFiveDMaterialSourceBenchmark,
} from '../src/two-point-five-d/materialSourceBenchmark.js'
import {
  buildTwoPointFiveDMaterialSourceBenchmarkReview,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewHtml,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewMarkdown,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewPng,
} from '../src/two-point-five-d/materialSourceBenchmarkReview.js'
import {
  detectFrameSourceKind,
  extractFrames,
  resolveFfmpegPath,
} from '../src/video-sprite/frameExtractor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const SCENE_TILE_STRICT_GATE_RUNBOOK = 'docs/runbooks/scene-tile-strict-gate-readiness.md'
const DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_DIR = 'generated/two-point-five-d-material-source-benchmarks'

function loadLocalEnv() {
  const envPath = path.join(rootDir, '.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (process.env[key]) continue
    process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }
    i += 1
    if (options[key] === undefined) options[key] = next
    else if (Array.isArray(options[key])) options[key].push(next)
    else options[key] = [options[key], next]
  }
  return { positional, options }
}

function option(options, name, fallback = undefined) {
  return options[name] ?? fallback
}

function optionNumber(options, name, fallback = undefined) {
  const raw = option(options, name, fallback)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`)
  return value
}

function optionPositiveInt(options, name, fallback) {
  const value = Number(option(options, name, fallback))
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

function optionOptionalPositiveInt(options, name) {
  if (options[name] === undefined) return undefined
  return optionPositiveInt(options, name)
}

function optionRgb(options, names, fallback) {
  const keys = Array.isArray(names) ? names : [names]
  const raw = keys.map((name) => options[name]).find((value) => value !== undefined)
  if (raw === undefined) return fallback
  const text = String(raw).trim()
  const hex = text.startsWith('#') ? text.slice(1) : null
  const channels = hex
    ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => Number.parseInt(part, 16))
    : text.split(',').map((part) => Number(part.trim()))
  if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new Error(`--${keys[0]} must be an RGB triplet like 255,255,255 or #ffffff`)
  }
  return channels
}

function sceneEdgeConditioningOptions(options) {
  if (!options['edge-condition']) return undefined
  return {
    enabled: true,
    band: optionPositiveInt(options, 'edge-band', 3),
    mode: option(options, 'edge-condition-mode', 'edge-aware-v1'),
  }
}

function sceneStyleCorrectionOptions(options) {
  if (!options['style-snap']) return undefined
  return {
    mode: 'palette_snap',
    maxColors: optionPositiveInt(options, 'style-max-colors', 16),
  }
}

function sceneTileGatePolicyOptions(options, fallback = 'warn') {
  const rawTileQuality = String(option(options, 'raw-tile-policy', option(options, 'raw-tile-quality-policy', fallback))).trim().toLowerCase()
  if (!['warn', 'strict'].includes(rawTileQuality)) throw new Error('--raw-tile-policy must be warn or strict')
  return {
    raw_tile_quality: rawTileQuality,
  }
}

function pixelGridRefinementFromOptions(options) {
  const recipe = option(options, 'grid-refinement-recipe')
  if (!options['grid-refinement'] && !options['pixel-grid-refinement'] && !recipe) return false
  return normalizePixelGridRefinementOptions({
    ...(recipe ? { recipe } : {}),
    maxColors: optionPositiveInt(options, 'grid-refinement-max-colors', optionPositiveInt(options, 'finish-max-colors', 16)),
    minConfidence: optionNumber(options, 'grid-refinement-min-confidence', 0.6),
    minSequenceSupport: optionNumber(options, 'grid-refinement-min-sequence-support', 0.5),
    minCell: optionPositiveInt(options, 'grid-refinement-min-cell', 2),
    maxCell: optionPositiveInt(options, 'grid-refinement-max-cell', 32),
  })
}

async function attachTileConditioningReview(result, conditioned) {
  if (!conditioned?.report?.enabled) return result
  const review = buildTileConditioningReview({
    rawTiles: conditioned.rawTiles,
    conditionedTiles: conditioned.tiles,
    edgeConditioning: conditioned.report,
    qualityGate: result.qualityGate,
  })
  return {
    ...result,
    tileConditioningReview: review,
    files: {
      ...(result.files ?? {}),
      tileConditioningReviewPng: await encodeRgbaPng(renderTileConditioningContactSheet({
        rawTiles: conditioned.rawTiles,
        conditionedTiles: conditioned.tiles,
      })),
    },
  }
}

function optionList(options, name) {
  const value = options[name]
  if (value === undefined) return []
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function parseMapFixedSpec(spec) {
  const parts = String(spec).split(',').map((item) => item.trim())
  if (parts.length !== 3) throw new Error('--map-fixed must use x,y,mask')
  const [x, y, mask] = parts.map(Number)
  if (![x, y, mask].every(Number.isInteger)) throw new Error('--map-fixed must use integer x,y,mask')
  return { x, y, mask }
}

function parseMapEditSpec(spec) {
  const [kind, payload = ''] = String(spec).split(':')
  const normalizedKind = kind.trim().toLowerCase()
  const parts = payload.split(',').map((item) => item.trim()).filter(Boolean)
  if (normalizedKind === 'paint' || normalizedKind === 'erase') {
    if (parts.length < 4) throw new Error('--map-edit paint/erase must use kind:x,y,w,h')
    const [x, y, w, h] = parts.slice(0, 4).map(Number)
    if (![x, y, w, h].every(Number.isInteger)) throw new Error('--map-edit rectangle values must be integers')
    return {
      type: normalizedKind === 'paint' ? 'paint_terrain_rect' : 'erase_terrain_rect',
      x,
      y,
      w,
      h,
    }
  }
  if (normalizedKind === 'corner') {
    if (parts.length < 3) throw new Error('--map-edit corner must use corner:x,y,solid|empty')
    const [x, y] = parts.slice(0, 2).map(Number)
    if (![x, y].every(Number.isInteger)) throw new Error('--map-edit corner coordinates must be integers')
    return {
      type: 'set_corner',
      x,
      y,
      solid: parts[2],
    }
  }
  throw new Error('--map-edit must start with paint, erase, or corner')
}

function parseMapSolverOptions(options) {
  const solver = String(option(options, 'map-solver', 'constraint')).trim().toLowerCase()
  if (!['constraint', 'seeded'].includes(solver)) throw new Error('--map-solver must be constraint or seeded')
  const border = String(option(options, 'map-border', 'empty')).trim().toLowerCase()
  if (!['empty', 'none'].includes(border)) throw new Error('--map-border must be empty or none')
  return cleanOptions({
    solver,
    width: optionOptionalPositiveInt(options, 'map-width'),
    height: optionOptionalPositiveInt(options, 'map-height'),
    seed: option(options, 'map-seed'),
    density: options['map-density'] === undefined ? undefined : optionNumber(options, 'map-density'),
    border,
    fixedMasks: optionList(options, 'map-fixed').map(parseMapFixedSpec),
    editorOperations: optionList(options, 'map-edit').map(parseMapEditSpec),
    allowedMasks: optionList(options, 'map-allowed-mask').map((item) => {
      const mask = Number(item)
      if (!Number.isInteger(mask)) throw new Error('--map-allowed-mask must be an integer')
      return mask
    }),
  })
}

function makeJobId(prefix = 'cli') {
  return `${prefix}_${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function processOptionsFromCli(options) {
  const anchorOffsetX = optionNumber(options, 'anchor-offset-x')
  const anchorOffsetY = optionNumber(options, 'anchor-offset-y')
  return {
    name: option(options, 'name'),
    description: option(options, 'description'),
    sourceLayout: option(options, 'source-layout'),
    backgroundMode: option(options, 'background-mode', 'auto'),
    backgroundTolerance: optionNumber(options, 'background-tolerance'),
    blackSourceBuffer: options['black-source'] ? readFileSync(String(options['black-source'])) : undefined,
    sourceFileName: options.input ? path.basename(String(options.input)) : undefined,
    anchorOffset: anchorOffsetX !== undefined || anchorOffsetY !== undefined ? { x: anchorOffsetX ?? 0, y: anchorOffsetY ?? 0 } : undefined,
    autoCorrect: options['disable-auto-correct'] ? false : undefined,
    motionStabilize: options['disable-motion-stabilization'] ? false : undefined,
    lockedAnimations: optionList(options, 'locked-animation'),
    styleReport: options['style-report'] ? true : undefined,
    styleMaxColors: options['style-max-colors'] ? optionPositiveInt(options, 'style-max-colors') : undefined,
  }
}

function cleanOptions(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)))
}

async function commandProcess(options) {
  const input = option(options, 'input')
  if (!input) throw new Error('process requires --input')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('cli_process'))
  const source = await readFile(String(input))
  const result = await processSheetBuffer(source, cleanOptions(processOptionsFromCli(options)))
  const written = await writeCharacterPackArtifacts({ jobId, outputDir, result })
  return {
    command: 'process',
    job_id: written.job_id,
    output_dir: written.dir,
    status: written.status,
    reason: written.reason,
    retry_hint: written.retry_hint,
    urls: written.urls,
  }
}

async function commandProjectPack(options) {
  const characterDir = option(options, 'character-dir')
  const sceneDir = option(options, 'scene-dir')
  if (!characterDir) throw new Error('project pack requires --character-dir')
  if (!sceneDir) throw new Error('project pack requires --scene-dir')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('project_pack'))
  const styleContractPath = option(options, 'style-contract')
  const result = buildProjectPack({
    projectId: option(options, 'project-id', jobId),
    createdAt: option(options, 'created-at'),
    characterResult: await loadCharacterPackResultFromDir(String(characterDir)),
    sceneResult: await loadScenePackResultFromDir(String(sceneDir)),
    styleContract: styleContractPath ? JSON.parse(await readFile(String(styleContractPath), 'utf8')) : undefined,
    stylePolicy: options['strict-style-contract'] ? 'strict' : 'warn',
  })
  const written = await writeProjectPackArtifacts({ jobId, outputDir, result })
  return {
    command: 'project pack',
    job_id: written.job_id,
    output_dir: written.dir,
    status: written.status,
    reason: written.reason,
    retry_hint: written.retry_hint,
    urls: written.urls,
    validation: result.validation,
    project_manifest: result.projectManifest,
  }
}

function motionSourceKindFromExtractor(kind) {
  if (kind === 'zip') return 'frame_sequence_zip'
  if (kind === 'gif') return 'gif'
  if (kind === 'image') return 'single_image'
  if (kind === 'video') return 'video_file'
  throw new Error(`unsupported motion source kind: ${kind}`)
}

function motionSelectionFromOptions(options = {}) {
  const allowedKeys = new Set([
    'motion-selection-recipe',
    'loop-expectation',
    'temporal-matte',
  ])
  const protectedPrefixes = [
    'motion-selection',
    'loop-expectation',
    'temporal-matte',
  ]
  const unknown = Object.keys(options).find((key) => (
    !allowedKeys.has(key) &&
    protectedPrefixes.some((prefix) => key.startsWith(prefix))
  ))
  if (unknown) throw new Error(`Unknown Motion Selection option --${unknown}`)
  const recipe = option(options, 'motion-selection-recipe')
  const loopExpectation = option(options, 'loop-expectation')
  const temporalMatte = option(options, 'temporal-matte')
  if (
    recipe === undefined &&
    loopExpectation === undefined &&
    temporalMatte === undefined
  ) {
    return false
  }
  return normalizeMotionSelectionOptions({
    recipe,
    ...(loopExpectation !== undefined
      ? { loop_expectation: loopExpectation }
      : {}),
    ...(temporalMatte !== undefined
      ? { temporal_matte: temporalMatte }
      : {}),
  })
}

async function commandMotionSourceBuildStrip(positional, options) {
  const input = positional[2] ?? option(options, 'input')
  if (!input) throw new Error('motion-source build-strip requires an input path')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('motion_source_strip'))
  const stride = optionPositiveInt(options, 'stride', 1)
  const maxFrames = optionPositiveInt(options, 'max-frames', 64)
  const frameCount = optionPositiveInt(options, 'frames', 8)
  const inputPath = path.resolve(String(input))
  const sourceName = path.basename(inputPath)
  const sourceKind = detectFrameSourceKind(sourceName)
  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  const source = sourceKind === 'video' ? Buffer.alloc(0) : await readFile(inputPath)
  const extracted = await extractFrames(source, {
    kind: sourceKind,
    name: sourceName,
    stride,
    maxFrames,
    fps: optionNumber(options, 'fps', 12),
    startSec: optionNumber(options, 'start-sec', 0),
    endSec: optionNumber(options, 'end-sec'),
    inputPath: sourceKind === 'video' ? inputPath : undefined,
    videoOutputDir: sourceKind === 'video'
      ? path.join(jobDir, 'video_frames')
      : undefined,
    ffmpegPath: sourceKind === 'video'
      ? resolveFfmpegPath(process.env)
      : undefined,
  })
  const contract = createMotionSourceContract({
    source_kind: motionSourceKindFromExtractor(extracted.kind),
    runtime_action: option(options, 'action', 'walk_down'),
    target_frame_count: frameCount,
    sampling: {
      stride,
      max_frames: maxFrames,
      fps: optionNumber(options, 'fps', 12),
      start_sec: optionNumber(options, 'start-sec', 0),
      end_sec: optionNumber(options, 'end-sec'),
    },
    frame_size: {
      normalized_cell: [
        optionPositiveInt(options, 'cell-width', 96),
        optionPositiveInt(options, 'cell-height', 96),
      ],
    },
    anchor_policy: {
      padding_px: optionPositiveInt(options, 'padding', 6),
      static_offset_y: optionNumber(options, 'static-offset-y', 0),
    },
    background: {
      key_color: optionRgb(options, ['background-key', 'key-color'], [255, 255, 255]),
      tolerance: optionNumber(options, 'background-tolerance', 24),
      defringe: options['disable-defringe'] ? false : true,
    },
    motion_selection: motionSelectionFromOptions(options),
  })
  const result = await buildMotionStrip({
    frames: extracted.frames,
    frameProvenance: extracted.frame_provenance,
    contract,
    pixelGridRefinement: pixelGridRefinementFromOptions(options),
  })
  await writeFile(path.join(jobDir, 'normalized_motion_strip.png'), result.normalizedMotionStripPng)
  await writeFile(path.join(jobDir, 'motion_contact_sheet.png'), result.motionContactSheetPng)
  await writeFile(path.join(jobDir, 'motion_source_report.json'), JSON.stringify(result.report, null, 2))
  await writeFile(path.join(jobDir, 'selected_frames.json'), JSON.stringify(result.selectedFrames, null, 2))

  return {
    command: 'motion-source build-strip',
    job_id: jobId,
    output_dir: jobDir,
    status: result.report.status,
    source_kind: contract.source_kind,
    action: contract.runtime_action,
    input_frame_count: result.report.input_frame_count,
    selected_frame_count: result.report.selected_frame_count,
    warnings: result.report.source_warnings,
    ...(extracted.ffmpeg ? { ffmpeg: extracted.ffmpeg } : {}),
    urls: {
      normalized_motion_strip_url: `/generated/${jobId}/normalized_motion_strip.png`,
      motion_contact_sheet_url: `/generated/${jobId}/motion_contact_sheet.png`,
      motion_source_report_url: `/generated/${jobId}/motion_source_report.json`,
      selected_frames_url: `/generated/${jobId}/selected_frames.json`,
    },
  }
}

async function commandMotionSourceApplyStrip(options) {
  const sheetPath = option(options, 'sheet')
  const stripPath = option(options, 'strip')
  if (!sheetPath) throw new Error('motion-source apply-strip requires --sheet')
  if (!stripPath) throw new Error('motion-source apply-strip requires --strip')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('motion_source_apply'))
  const action = option(options, 'action', 'walk_down')
  const resampleStrategy = option(options, 'resample-strategy', 'reject_mismatch')
  const sheet = await loadRgba(await readFile(String(sheetPath)))
  const strip = await loadRgba(await readFile(String(stripPath)))
  const result = await applyMotionStrip({
    sheet,
    strip,
    action,
    resampleStrategy,
  })
  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  await writeFile(path.join(jobDir, 'applied_normalized_sheet.png'), result.appliedNormalizedSheetPng)
  await writeFile(path.join(jobDir, 'apply_motion_strip_report.json'), JSON.stringify(result.report, null, 2))

  return {
    command: 'motion-source apply-strip',
    job_id: jobId,
    output_dir: jobDir,
    status: result.report.status,
    action,
    resample_strategy: result.report.resample_strategy,
    source_strip_frame_count: result.report.source_strip_frame_count,
    target_frame_count: result.report.target_frame_count,
    validation: result.report.validation,
    urls: {
      applied_normalized_sheet_url: `/generated/${jobId}/applied_normalized_sheet.png`,
      apply_motion_strip_report_url: `/generated/${jobId}/apply_motion_strip_report.json`,
    },
  }
}

function resolveManifestAssetPath(manifestPath, sourcePath) {
  if (path.isAbsolute(sourcePath)) return sourcePath
  return path.resolve(path.dirname(path.resolve(manifestPath)), sourcePath)
}

function parseStripSpecs(specs) {
  return specs.map((spec) => {
    const text = String(spec)
    const separator = text.indexOf('=')
    if (separator <= 0 || separator === text.length - 1) {
      throw new Error('--strip must use source_id_or_action=path')
    }
    return {
      id: text.slice(0, separator).trim(),
      path: text.slice(separator + 1).trim(),
    }
  })
}

async function commandMotionSourceAnalyzeSet(positional, options) {
  const manifestPath = positional[2] ?? option(options, 'manifest')
  if (!manifestPath) throw new Error('motion-source analyze-set requires a manifest path')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('motion_source_set'))
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const setReport = validateMotionSourceSetManifest(manifest)
  let identityReport = {
    schema_version: 1,
    mode: 'identity_consistency_report_v1',
    status: 'skipped',
    can_apply_multi_strip: false,
    warnings: ['source_set_validation_failed'],
    blocking_errors: setReport.blocking_errors,
  }

  if (setReport.normalized_manifest) {
    const normalized = setReport.normalized_manifest
    const strips = await Promise.all(normalized.sources.map(async (source) => ({
      id: source.id,
      runtime_action: source.runtime_action,
      target_frame_count: source.target_frame_count,
      facing_direction: source.facing_direction,
      image: await loadRgba(await readFile(resolveManifestAssetPath(manifestPath, source.source))),
    })))
    const anchorSource = normalized.sources.find((source) => (
      source.id === normalized.identity_anchor.source_id
      || source.runtime_action === normalized.identity_anchor.source_id
    ))
    identityReport = evaluateIdentityConsistency(strips, {
      identityAnchor: {
        ...normalized.identity_anchor,
        facing_direction: normalized.identity_anchor.facing_direction ?? anchorSource?.facing_direction,
      },
      thresholds: manifest.identity_thresholds,
    })
  }

  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  await writeFile(path.join(jobDir, 'motion_source_set_report.json'), JSON.stringify(setReport, null, 2))
  await writeFile(path.join(jobDir, 'identity_consistency_report.json'), JSON.stringify(identityReport, null, 2))

  const status = setReport.status === 'fail'
    ? 'fail'
    : (identityReport.status === 'fail' ? 'fail' : setReport.status)
  return {
    command: 'motion-source analyze-set',
    job_id: jobId,
    output_dir: jobDir,
    status,
    source_set_status: setReport.status,
    identity_status: identityReport.status,
    can_apply_multi_strip: identityReport.can_apply_multi_strip,
    warnings: [...new Set([...(setReport.warnings ?? []), ...(identityReport.warnings ?? [])])],
    blocking_errors: [...new Set([...(setReport.blocking_errors ?? []), ...(identityReport.blocking_errors ?? [])])],
    urls: {
      motion_source_set_report_url: `/generated/${jobId}/motion_source_set_report.json`,
      identity_consistency_report_url: `/generated/${jobId}/identity_consistency_report.json`,
    },
  }
}

async function commandMotionSourceApplySet(options) {
  const sheetPath = option(options, 'sheet')
  const manifestPath = option(options, 'manifest')
  if (!sheetPath) throw new Error('motion-source apply-set requires --sheet')
  if (!manifestPath) throw new Error('motion-source apply-set requires --manifest')
  const stripSpecs = parseStripSpecs(optionList(options, 'strip'))
  if (!stripSpecs.length) throw new Error('motion-source apply-set requires at least one --strip action=path')

  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('motion_source_set_apply'))
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const sheet = await loadRgba(await readFile(String(sheetPath)))
  const strips = await Promise.all(stripSpecs.map(async (spec) => ({
    id: spec.id,
    runtime_action: spec.id,
    image: await loadRgba(await readFile(spec.path)),
  })))
  const result = await applyMotionSourceSet({
    sheet,
    manifest,
    strips,
    resampleStrategy: option(options, 'resample-strategy', 'reject_mismatch'),
    identityThresholds: manifest.identity_thresholds,
  })

  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  if (result.appliedNormalizedSheetPng) {
    await writeFile(path.join(jobDir, 'applied_normalized_sheet.png'), result.appliedNormalizedSheetPng)
  }
  await writeFile(path.join(jobDir, 'motion_source_set_apply_report.json'), JSON.stringify(result.report, null, 2))
  await writeFile(path.join(jobDir, 'motion_source_set_report.json'), JSON.stringify(result.setReport, null, 2))
  await writeFile(path.join(jobDir, 'identity_consistency_report.json'), JSON.stringify(result.identityReport ?? {
    schema_version: 1,
    mode: 'identity_consistency_report_v1',
    status: 'skipped',
    can_apply_multi_strip: false,
    warnings: ['identity_gate_not_run'],
    blocking_errors: result.report.blocking_errors,
  }, null, 2))

  return {
    command: 'motion-source apply-set',
    job_id: jobId,
    output_dir: jobDir,
    status: result.report.status,
    can_apply_multi_strip: result.report.can_apply_multi_strip,
    applied_actions: result.report.applied_actions,
    warnings: result.report.warnings,
    blocking_errors: result.report.blocking_errors,
    urls: {
      applied_normalized_sheet_url: result.appliedNormalizedSheetPng ? `/generated/${jobId}/applied_normalized_sheet.png` : null,
      motion_source_set_apply_report_url: `/generated/${jobId}/motion_source_set_apply_report.json`,
      motion_source_set_report_url: `/generated/${jobId}/motion_source_set_report.json`,
      identity_consistency_report_url: `/generated/${jobId}/identity_consistency_report.json`,
    },
  }
}

async function imageFromPath(filePath, fallbackName) {
  if (!filePath) return null
  return {
    name: path.basename(String(filePath)) || fallbackName,
    mimeType: 'image/png',
    buffer: await readFile(String(filePath)),
  }
}

function promptFieldsFromOptions(options) {
  return {
    ...parsePromptFieldEntries(optionList(options, 'prompt-field')),
    ...cleanOptions({
      identity: option(options, 'identity'),
      body: option(options, 'body'),
      outfit: option(options, 'outfit') ?? option(options, 'clothing'),
      colors: option(options, 'colors') ?? option(options, 'palette'),
      equipment: option(options, 'equipment') ?? option(options, 'weapon'),
      style: option(options, 'style'),
      background: option(options, 'background'),
      outputType: option(options, 'output-type'),
    }),
  }
}

function generationOptionsFromCli(options) {
  return normalizeGenerationOptions({
    candidateCount: option(options, 'candidate-count', process.env.T2I_CANDIDATE_COUNT),
    seed: option(options, 'seed'),
    temperature: option(options, 'temperature'),
    topP: option(options, 'top-p'),
    topK: option(options, 'top-k'),
    qualityTier: option(options, 'quality-tier'),
  })
}

function singleProviderImageGenerationOptionsFromCli(options) {
  return normalizeGenerationOptions({
    candidateCount: 1,
    seed: option(options, 'source-seed') ?? option(options, 'seed'),
    temperature: option(options, 'temperature'),
    topP: option(options, 'top-p'),
    topK: option(options, 'top-k'),
    qualityTier: option(options, 'quality-tier'),
  })
}

function parseGenericFieldEntries(entries = []) {
  const list = Array.isArray(entries) ? entries : [entries]
  const fields = {}
  for (const entry of list.filter(Boolean)) {
    const text = String(entry)
    const separator = text.includes('=') ? '=' : ':'
    const index = text.indexOf(separator)
    if (index <= 0) continue
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (key && value) fields[key] = value
  }
  return fields
}

function twoPointFiveDMaterialSourcePromptFieldsFromOptions(options) {
  return cleanOptions({
    ...parseGenericFieldEntries(optionList(options, 'material-source-field')),
    terrain: option(options, 'terrain') ?? option(options, 'source-terrain'),
    topMaterial: option(options, 'top-material'),
    sideMaterial: option(options, 'side-material'),
    edgeMaterial: option(options, 'edge-material'),
    cornerMaterial: option(options, 'corner-material'),
    transitionDetail: option(options, 'transition-detail'),
    shadowMaterial: option(options, 'shadow-material'),
    decalMaterial: option(options, 'decal-material'),
    style: option(options, 'style'),
    palette: option(options, 'palette'),
    lighting: option(options, 'lighting'),
    notes: option(options, 'notes'),
    negative: option(options, 'negative'),
  })
}

function twoPointFiveDMaterialSourceImageConfigFromOptions(options) {
  return cleanOptions({
    image_size: option(options, 'source-image-size') ?? option(options, 'image-size'),
    aspect_ratio: option(options, 'source-aspect-ratio') ?? option(options, 'aspect-ratio'),
  })
}

function providerCallBudgetFromOptions(options, { command, plannedProviderCalls }) {
  const planned = Number(plannedProviderCalls)
  if (!Number.isInteger(planned) || planned < 1) throw new Error(`${command} planned provider calls must be a positive integer`)
  if (options['max-provider-calls'] === undefined) {
    throw new Error(`${command} requires --max-provider-calls for live provider quota; planned provider calls: ${planned}`)
  }
  const max = optionPositiveInt(options, 'max-provider-calls')
  if (planned > max) {
    throw new Error(`${command} planned provider calls ${planned} exceed --max-provider-calls ${max}`)
  }
  return {
    planned_provider_calls: planned,
    max_provider_calls: max,
    used_provider_calls: 0,
    providerBudget: { max, used: 0 },
  }
}

function publicProviderCallBudget(budget) {
  return {
    planned_provider_calls: budget.planned_provider_calls,
    max_provider_calls: budget.max_provider_calls,
    used_provider_calls: budget.providerBudget?.used ?? budget.used_provider_calls ?? 0,
  }
}

function publicSceneTileProviderConfig(providerPresetId = '') {
  const state = getGeminiProviderState(process.env)
  const requestedId = providerPresetId || process.env.SCENE_TILE_GATE_PROVIDER_PRESET || state.active_preset_id || ''
  const selected = state.presets.find((preset) => preset.id === requestedId) ||
    state.presets.find((preset) => preset.id === state.active_preset_id) ||
    state.presets[0] ||
    null
  return {
    available: state.available,
    status: state.status,
    requested_provider_preset_id: providerPresetId || null,
    active_preset_id: state.active_preset_id,
    selected_preset_id: selected?.id ?? null,
    provider: selected?.provider ?? state.provider,
    model: selected?.model ?? state.model,
    selected_available: Boolean(selected?.available),
    image_config: selected?.image_config ?? null,
  }
}

function publicTwoPointFiveDMaterialSourceProviderConfig(providerPresetId = '', imageConfig = {}) {
  const state = getGeminiProviderState(process.env)
  const requestedId = providerPresetId || state.active_preset_id || ''
  const selected = state.presets.find((preset) => preset.id === requestedId) ||
    state.presets.find((preset) => preset.id === state.active_preset_id) ||
    state.presets[0] ||
    null
  return {
    available: state.available,
    status: state.status,
    requested_provider_preset_id: providerPresetId || null,
    active_preset_id: state.active_preset_id,
    selected_preset_id: selected?.id ?? null,
    provider: selected?.provider ?? state.provider,
    model: selected?.model ?? state.model,
    selected_available: Boolean(selected?.available),
    image_config: cleanOptions({
      ...(selected?.image_config ?? {}),
      ...(imageConfig ?? {}),
    }),
  }
}

function providerBlockerCategory(error) {
  const message = String(error?.message || error || '')
  if (/quota|rate[- ]?limit|limit:\s*0/i.test(message)) return 'provider_quota_blocked'
  if (/terms of service|prohibited|policy|tos/i.test(message)) return 'provider_route_blocked'
  if (/api key|not configured|missing_credentials/i.test(message)) return 'provider_configuration_blocked'
  return 'provider_request_blocked'
}

function buildSceneTileLiveGateBlocker({ plan, providerCallBudget, providerConfig, error }) {
  return {
    schema_version: 1,
    mode: 'scene_tile_live_gate_blocker_v0',
    run_id: plan.run_id,
    status: 'blocked_provider_access',
    failure_stage: 'provider_image_generation',
    blocker_category: providerBlockerCategory(error),
    provider_preset_id: plan.provider_preset_id,
    provider_config: providerConfig,
    estimated_provider_calls: plan.estimated_provider_calls,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    case_ids: plan.cases.map((item) => item.id),
    image_config: plan.image_config,
    scene_options: plan.scene_options,
    error_message: String(error?.message || error),
    retry_hint: error?.retry_hint ?? 'inspect_provider_route',
    recovery_runbook: SCENE_TILE_STRICT_GATE_RUNBOOK,
  }
}

function unavailableSignal(reason) {
  return {
    available: false,
    unavailable_reason: reason,
  }
}

function correctionPathLabel(sceneOptions = {}) {
  const steps = [
    sceneOptions.style_correction ? `style:${sceneOptions.style_correction.mode ?? 'present'}` : null,
    sceneOptions.edge_conditioning?.enabled === false
      ? null
      : sceneOptions.edge_conditioning ? `edge:${sceneOptions.edge_conditioning.mode ?? 'present'}` : null,
  ].filter(Boolean)
  return steps.join('+') || 'none'
}

function buildSceneTileBlockedReview({ plan, blocker }) {
  const reason = 'provider_blocked_before_image_generation'
  return {
    schema_version: 1,
    mode: 'scene_tile_live_gate_review_v0',
    run_id: plan.run_id,
    status: 'blocked_provider_access',
    conclusion: 'provider_access_blocked_no_tile_quality_evidence',
    blocker_category: blocker.blocker_category,
    provider_config: blocker.provider_config,
    provider_call_budget: blocker.provider_call_budget,
    planned_sample: {
      case_count: plan.cases.length,
      case_ids: plan.cases.map((item) => item.id),
      candidate_count: plan.scene_options.candidate_count,
      estimated_provider_calls: plan.estimated_provider_calls,
      gate_policy: plan.scene_options.gate_policy,
      image_config: plan.image_config,
      correction_path: correctionPathLabel(plan.scene_options),
    },
    evidence_status: {
      provider_access: 'blocked',
      live_sample: 'not_collected',
      selected_candidate_distribution: 'unavailable',
      failed_candidate_taxonomy: 'unavailable',
      tile_quality_signals: 'unavailable',
      style_snap_edge_effect: 'unavailable',
      wfc_ldtk_decision_ready: false,
    },
    selected_candidate_status_distribution: unavailableSignal(reason),
    failed_candidate_taxonomy: {
      ...unavailableSignal(reason),
      top_categories: [],
    },
    tile_quality_signals: {
      duplicate_referenced_runtime_tiles: unavailableSignal(reason),
      source_atlas_continuity: unavailableSignal(reason),
      visual_seams: unavailableSignal(reason),
      self_loops: unavailableSignal(reason),
      style_snap_edge_conditioning_effect: unavailableSignal(reason),
    },
    decision: {
      proceed_to_ldtk_auto_layer: false,
      proceed_to_wfc_or_rule_expansion: false,
      next_action: 'unblock_provider_route_and_rerun_strict_live_gate',
      recovery_runbook: SCENE_TILE_STRICT_GATE_RUNBOOK,
    },
    blocker_file: 'live_gate_blocker.json',
    plan_file: 'live_gate_plan.json',
    recovery_runbook: SCENE_TILE_STRICT_GATE_RUNBOOK,
  }
}

function markdownForSceneTileBlockedReview(review) {
  return [
    `# Scene Tile Live Gate Review: ${review.run_id}`,
    '',
    `- Status: ${review.status}`,
    `- Conclusion: ${review.conclusion}`,
    `- Blocker category: ${review.blocker_category}`,
    `- Provider: ${review.provider_config?.provider ?? 'unknown'}`,
    `- Model: ${review.provider_config?.model ?? 'unknown'}`,
    `- Planned cases: ${review.planned_sample.case_count}`,
    `- Candidate count: ${review.planned_sample.candidate_count}`,
    `- Estimated provider calls: ${review.planned_sample.estimated_provider_calls}`,
    `- Provider calls used: ${review.provider_call_budget.used_provider_calls} / ${review.provider_call_budget.max_provider_calls}`,
    `- Raw tile policy: ${review.planned_sample.gate_policy?.raw_tile_quality ?? 'unknown'}`,
    `- Correction path: ${review.planned_sample.correction_path}`,
    '',
    '## Evidence Status',
    '',
    '| Evidence | Status |',
    '|---|---|',
    `| Live sample | ${review.evidence_status.live_sample} |`,
    `| Selected candidate distribution | ${review.evidence_status.selected_candidate_distribution} |`,
    `| Failed candidate taxonomy | ${review.evidence_status.failed_candidate_taxonomy} |`,
    `| Tile quality signals | ${review.evidence_status.tile_quality_signals} |`,
    `| Style snap / edge effect | ${review.evidence_status.style_snap_edge_effect} |`,
    '',
    '## Decision',
    '',
    '- Do not proceed to LDtk auto-layer rules from this run.',
    '- Do not proceed to WFC or rule arrangement expansion from this run.',
    `- Next action: ${review.decision.next_action}`,
    `- Recovery runbook: ${review.decision.recovery_runbook}`,
    '',
  ].join('\n')
}

function imageConfigFromCli(options, { mode, characterPreset, envPrefix = 'OPENROUTER' } = {}) {
  const imageSizeEnv = process.env[`${envPrefix}_IMAGE_SIZE`] || process.env.OPENROUTER_IMAGE_SIZE || process.env.GEMINI_IMAGE_SIZE
  const aspectEnv = process.env[`${envPrefix}_IMAGE_ASPECT_RATIO`] || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || process.env.GEMINI_IMAGE_ASPECT_RATIO
  const explicit = {
    image_size: option(options, 'image-size', imageSizeEnv || '2K'),
    aspect_ratio: option(options, 'aspect-ratio', aspectEnv),
  }
  return {
    image_size: explicit.image_size,
    aspect_ratio: resolveTextToImageAspectRatio({ mode, characterPreset, imageConfig: explicit }),
  }
}

function pixelFinishingFromOptions(options) {
  return {
    enabled: !options['disable-pixel-finishing'],
    maxColors: optionPositiveInt(options, 'finish-max-colors', 32),
    downsampleFactor: optionPositiveInt(options, 'downsample-factor', 2),
    outline: !options['disable-outline'],
    gridRefinement: pixelGridRefinementFromOptions(options),
  }
}

async function writeDryRunPrompt({ options, contract, prompt, promptContract }) {
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('cli_prompt'))
  const jobDir = path.join(outputDir, jobId)
  const generation = {
    mode: 'dry_run_prompt',
    prompt_contract: promptContract ?? summarizePromptContract(contract),
  }
  await mkdir(jobDir, { recursive: true })
  await writeFile(path.join(jobDir, 'prompt.txt'), prompt)
  await writeFile(path.join(jobDir, 'generation.json'), JSON.stringify(generation, null, 2))
  return {
    command: 'generate',
    mode: 'dry_run_prompt',
    job_id: jobId,
    output_dir: jobDir,
    prompt_contract: generation.prompt_contract,
  }
}

async function commandSceneTilePrompt(options) {
  if (!options['dry-run-prompt']) throw new Error('scene tile-prompt is provider-free for now; pass --dry-run-prompt')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('scene_tile_prompt'))
  const jobDir = path.join(outputDir, jobId)
  const contract = buildSceneTilePromptContract({ description: option(options, 'description', '') })
  const prompt = compileSceneTilePromptContract(contract)
  const generation = {
    mode: 'dry_run_prompt',
    prompt_contract: summarizeSceneTilePromptContract(contract),
  }
  await mkdir(jobDir, { recursive: true })
  await writeFile(path.join(jobDir, 'prompt.txt'), prompt)
  await writeFile(path.join(jobDir, 'generation.json'), JSON.stringify(generation, null, 2))
  return {
    command: 'scene tile-prompt',
    mode: 'dry_run_prompt',
    job_id: jobId,
    output_dir: jobDir,
    prompt_contract: generation.prompt_contract,
  }
}

async function commandSceneTileIngest(options) {
  const input = option(options, 'input')
  if (!input) throw new Error('scene tile-ingest requires --input')
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('scene_tile_ingest'))
  const tilesetPng = await readFile(String(input))
  const source = await loadRgba(tilesetPng)
  const styleCorrection = sceneStyleCorrectionOptions(options)
  const corrected = styleCorrection ? applyPixelStyleCorrection(source, styleCorrection) : null
  const edgeConditioning = sceneEdgeConditioningOptions(options)
  const sourceBeforeEdgeConditioning = corrected?.image ?? source
  const conditioned = edgeConditioning ? conditionTileSheetEdges(sourceBeforeEdgeConditioning, edgeConditioning) : null
  const sourceForIngestion = conditioned?.source ?? sourceBeforeEdgeConditioning
  const tilesetPngForIngestion = conditioned?.report?.enabled ? await encodeRgbaPng(sourceForIngestion) : tilesetPng
  const result = await attachTileConditioningReview(buildScenePackFromTileSheet({
    source: sourceForIngestion,
    tilesetPng: corrected || conditioned?.report?.enabled ? await encodeRgbaPng(sourceForIngestion) : tilesetPngForIngestion,
    projectId: option(options, 'project-id', 'uploaded_scene_project'),
    identifier: option(options, 'identifier', 'uploaded_scene'),
    width: optionPositiveInt(options, 'width', 6),
    height: optionPositiveInt(options, 'height', 4),
    pattern: option(options, 'pattern', 'island'),
    seed: optionNumber(options, 'seed', 1),
    density: optionNumber(options, 'density', 0.5),
    tilesetRelPath: option(options, 'tileset-rel-path', 'tileset.png'),
    gatePolicy: sceneTileGatePolicyOptions(options),
    styleCorrectionReport: corrected?.report,
    edgeConditioningReport: conditioned?.report,
  }), conditioned)
  const written = await writeScenePackArtifacts({ jobId, outputDir, result })
  return {
    command: 'scene tile-ingest',
    job_id: written.job_id,
    output_dir: written.dir,
    status: written.status,
    reason: written.reason,
    retry_hint: written.retry_hint,
    urls: written.urls,
    quality_gate: result.qualityGate,
    ...(result.styleCorrection ? { style_correction: result.styleCorrection } : {}),
    ...(result.edgeConditioning ? { edge_conditioning: result.edgeConditioning } : {}),
    ...(result.tileConditioningReview ? { tile_conditioning_review: result.tileConditioningReview } : {}),
  }
}

async function commandSceneTileGenerate(options) {
  if (!options.yes) throw new Error('scene tile-generate uses live provider quota; pass --yes to continue')

  loadLocalEnv()
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('scene_tile_generate'))
  const candidateCount = optionPositiveInt(options, 'candidate-count', 1)
  const providerCallBudget = providerCallBudgetFromOptions(options, {
    command: 'scene tile-generate',
    plannedProviderCalls: candidateCount,
  })
  const imageConfig = {
    image_size: option(options, 'image-size', process.env.OPENROUTER_IMAGE_SIZE || process.env.GEMINI_IMAGE_SIZE || '2K'),
    aspect_ratio: option(options, 'aspect-ratio', process.env.OPENROUTER_IMAGE_ASPECT_RATIO || process.env.GEMINI_IMAGE_ASPECT_RATIO || '1:1'),
  }
  const result = await generateSceneTilePack({
    description: option(options, 'description', ''),
    providerPresetId: option(options, 'provider-preset'),
    imageConfig,
    candidateCount,
    providerBudget: providerCallBudget.providerBudget,
    projectId: option(options, 'project-id', 'generated_scene_project'),
    identifier: option(options, 'identifier', 'generated_scene'),
    width: optionPositiveInt(options, 'width', 6),
    height: optionPositiveInt(options, 'height', 4),
    pattern: option(options, 'pattern', 'island'),
    seed: optionNumber(options, 'seed', 1),
    density: optionNumber(options, 'density', 0.5),
    tilesetRelPath: option(options, 'tileset-rel-path', 'tileset.png'),
    gatePolicy: sceneTileGatePolicyOptions(options),
    styleCorrection: sceneStyleCorrectionOptions(options),
    edgeConditioning: sceneEdgeConditioningOptions(options),
  })
  const written = await writeScenePackArtifacts({ jobId, outputDir, result })
  return {
    command: 'scene tile-generate',
    mode: 'live',
    job_id: written.job_id,
    output_dir: written.dir,
    status: written.status,
    reason: written.reason,
    retry_hint: written.retry_hint,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    urls: written.urls,
    quality_gate: result.qualityGate,
    ...(result.styleCorrection ? { style_correction: result.styleCorrection } : {}),
    ...(result.edgeConditioning ? { edge_conditioning: result.edgeConditioning } : {}),
    ...(result.tileConditioningReview ? { tile_conditioning_review: result.tileConditioningReview } : {}),
  }
}

async function commandGenerate(options) {
  const description = option(options, 'description', '')
  const t2iMode = normalizeTextToImageMode(option(options, 't2i-mode', option(options, 'mode', TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET)))
  const characterPreset = option(options, 'character-preset')
  const promptFields = promptFieldsFromOptions(options)
  const backgroundMode = option(options, 'background-mode', 'auto')
  const generationOptions = generationOptionsFromCli(options)
  const imageConfig = imageConfigFromCli(options, { mode: t2iMode, characterPreset })
  const preset = option(options, 'preset', DEFAULT_GENERATION_PRESET)
  const templateImage = t2iMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER || options['disable-template'] ? null : await loadTemplateImage(preset, { rootDir })
  const referenceImage = await imageFromPath(option(options, 'reference-image'), 'reference.png')
  const paletteImage = await imageFromPath(option(options, 'palette-image'), 'palette.png')
  let contract = null
  let prompt = ''
  let promptContract = null
  if (t2iMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) {
    prompt = buildQualityCharacterPrompt({ description, promptFields, characterPreset, backgroundMode })
    promptContract = summarizeQualityPromptContract({ characterPreset, promptFields, backgroundMode })
  } else {
    contract = buildCharacterPromptContract({ description, preset, promptFields, characterPreset, backgroundMode, t2iMode })
    prompt = compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage })
    promptContract = summarizePromptContract(contract)
  }
  if (options['dry-run-prompt']) return writeDryRunPrompt({ options, contract, prompt, promptContract })
  if (!options.yes) throw new Error('generate uses live provider quota; pass --yes to continue')
  const providerCallBudget = providerCallBudgetFromOptions(options, {
    command: 'generate',
    plannedProviderCalls: generationOptions.candidateCount,
  })

  loadLocalEnv()
  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('cli_generate'))
  if (t2iMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) {
    const result = await runQualityCharacterTextToImage({
      description,
      providerPresetId: option(options, 'provider-preset'),
      imageConfig,
      generationOptions,
      promptFields,
      characterPreset,
      backgroundMode,
      referenceImage,
      paletteImage,
      pixelFinishing: pixelFinishingFromOptions(options),
      providerBudget: providerCallBudget.providerBudget,
    })
    const written = await writeTextToImageArtifacts({ jobId, outputDir, result })
    return {
      command: 'generate',
      mode: 'live',
      t2i_mode: t2iMode,
      job_id: written.job_id,
      output_dir: written.dir,
      status: written.status,
      failure_status: written.failure_status ?? null,
      reason: written.reason,
      retry_hint: written.retry_hint,
      release_gate: result.generationReleaseGate,
      release_ready: result.releaseReady === true,
      artifact_disposition: result.artifactDisposition,
      provider_call_budget: publicProviderCallBudget(providerCallBudget),
      candidate_selection: result.report.candidate_selection,
      urls: written.urls,
    }
  }
  const { result, candidateSelection } = await runProductionSheetTextToImage({
    description,
    name: option(options, 'name', 'generated_character'),
    preset,
    providerPresetId: option(options, 'provider-preset'),
    imageConfig,
    generationOptions,
    promptFields,
    characterPreset,
    backgroundMode,
    templateImage,
    referenceImage,
    paletteImage,
    providerBudget: providerCallBudget.providerBudget,
    processOptions: {
      styleReport: options['style-report'] ? true : undefined,
      styleMaxColors: options['style-max-colors'] ? optionPositiveInt(options, 'style-max-colors') : undefined,
    },
  })
  const written = await writeCharacterPackArtifacts({ jobId, outputDir, result })
  return {
    command: 'generate',
    mode: 'live',
    t2i_mode: t2iMode,
    job_id: written.job_id,
    output_dir: written.dir,
    status: written.status,
    failure_status: written.failure_status ?? null,
    reason: written.reason,
    retry_hint: written.retry_hint,
    release_gate: result.generationReleaseGate,
    release_ready: result.releaseReady === true,
    artifact_disposition: result.artifactDisposition,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    candidate_selection: candidateSelection,
    urls: written.urls,
  }
}

async function commandBenchmarkOpenRouter(options) {
  loadLocalEnv()
  const yes = Boolean(options.yes) || process.env.OPENROUTER_BENCHMARK_CONFIRM === '1'
  if (!yes) throw new Error('benchmark openrouter uses live provider quota; pass --yes to continue')
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured')
  const caseIds = optionList(options, 'case-id')
  const cases = selectOpenRouterBenchmarkCases({
    caseIds,
    sampleSize: caseIds.length ? null : optionPositiveInt(options, 'sample-size', process.env.OPENROUTER_BENCHMARK_SAMPLE_SIZE || '20'),
  })
  const outputDir = option(options, 'output-dir', process.env.OPENROUTER_BENCHMARK_OUTPUT_DIR || 'generated/openrouter-benchmarks')
  const report = await runOpenRouterCharacterBenchmark({
    cases,
    variantsPerCase: optionPositiveInt(options, 'variants', process.env.OPENROUTER_BENCHMARK_VARIANTS || '1'),
    outputDir,
    runId: option(options, 'run-id'),
    preset: option(options, 'preset', process.env.OPENROUTER_BENCHMARK_PRESET || DEFAULT_GENERATION_PRESET),
    providerPresetId: option(options, 'provider-preset', process.env.OPENROUTER_BENCHMARK_PROVIDER_PRESET),
    backgroundMode: option(options, 'background-mode', 'auto'),
    imageConfig: {
      image_size: option(options, 'image-size', process.env.OPENROUTER_BENCHMARK_IMAGE_SIZE || process.env.OPENROUTER_IMAGE_SIZE || '2K'),
      aspect_ratio: option(options, 'aspect-ratio', process.env.OPENROUTER_BENCHMARK_ASPECT_RATIO || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '1:1'),
    },
    runGodotProbe: Boolean(options.godot),
  })
  return {
    command: 'benchmark openrouter',
    run_id: report.run_id,
    output_dir: `${outputDir}/${report.run_id}`,
    preset: report.preset,
    total: report.summary.total,
    validation: report.summary.validation,
    failures: report.summary.failures,
    failure_taxonomy: report.summary.failure_taxonomy,
    pass_rate: report.summary.pass_rate,
    usable_rate: report.summary.usable_rate,
  }
}

function selectT2iGoldenCases(options) {
  const ids = new Set(optionList(options, 'case-id'))
  const sampleSize = options['sample-size'] ? optionPositiveInt(options, 'sample-size') : null
  const selected = ids.size ? T2I_GOLDEN_CASES.filter((testCase) => ids.has(testCase.id)) : T2I_GOLDEN_CASES
  if (ids.size && selected.length !== ids.size) {
    const known = new Set(T2I_GOLDEN_CASES.map((testCase) => testCase.id))
    const missing = [...ids].filter((id) => !known.has(id))
    throw new Error(`Unknown t2i golden case id: ${missing.join(', ')}`)
  }
  return sampleSize ? selected.slice(0, sampleSize) : selected
}

function t2iGoldenMarkdown(report) {
  const lines = [
    `# T2I Golden Benchmark ${report.run_id}`,
    '',
    `T2I mode: \`${report.t2i_mode}\``,
    `Provider: \`${report.provider_config?.provider ?? 'unknown'}\``,
    `Model: \`${report.provider_config?.model ?? 'unknown'}\``,
    `Cases: ${report.summary.total}`,
    ...(report.summary.failure_count ? [
      `Failed cases: ${report.summary.failure_count}`,
    ] : []),
    ...(report.summary.stopped_early ? [
      `Stopped early: ${report.summary.stop_reason ?? 'yes'}`,
    ] : []),
    `Candidate count: ${report.candidate_count}`,
    ...(report.provider_call_budget ? [
      `Planned provider calls: ${report.provider_call_budget.planned_provider_calls}`,
      `Max provider calls: ${report.provider_call_budget.max_provider_calls}`,
      `Used provider calls: ${report.provider_call_budget.used_provider_calls}`,
    ] : []),
    `Average score: ${report.summary.average_score}`,
    `Average reviewed score: ${report.summary.average_reviewed_score}`,
    '',
    '## Failure Taxonomy',
    '',
    ...(report.failure_taxonomy?.length
      ? report.failure_taxonomy.map((item) => `- ${item.category}: ${item.count} (${item.examples.join(', ')})`)
      : ['- none']),
    '',
    '| Case | Locale | Diagnostic | Diagnostic score | Release | Release score | Status | Error |',
    '|---|---:|---:|---:|---:|---:|---|---|',
    ...report.items.map((item) => `| ${item.case_id} | ${item.locale} | ${item.selected_index ?? ''} | ${item.selected_score ?? ''} | ${item.release_selected_index ?? ''} | ${item.release_selected_score ?? ''} | ${item.status} | ${String(item.error ?? '').replace(/\|/g, '\\|')} |`),
  ]
  return `${lines.join('\n')}\n`
}

function failedT2iGoldenItem(testCase, error) {
  const candidateSelection = error.candidate_selection ?? error.candidateSelection ?? null
  return {
    case_id: testCase.id,
    locale: testCase.locale,
    description: testCase.description,
    status: error.status ?? 'failed',
    selected_index: candidateSelection?.selected_index ?? null,
    selected_score: candidateSelection?.selected_score ?? null,
    release_selected_index: candidateSelection?.release_selected_index ?? null,
    release_selected_score: candidateSelection?.release_selected_score ?? null,
    error: error.message ?? 'case_failed',
    failure_status: error.failure_status ?? null,
    retry_hint: error.retry_hint ?? null,
    candidate_selection: candidateSelection,
  }
}

function t2iProviderConfigFromOptions(options = {}) {
  const state = getGeminiProviderState()
  if (state.status === 'configuration_error') {
    return {
      status: state.status,
      error: state.error,
      requested_provider_preset_id: option(options, 'provider-preset') || null,
      selected_provider_preset_id: null,
      provider: null,
      model: null,
      available: false,
      secrets_exposed: false,
    }
  }
  const requestedId = option(options, 'provider-preset')
  const selected = requestedId
    ? (state.presets ?? []).find((preset) => preset.id === requestedId)
    : (state.presets ?? []).find((preset) => preset.id === state.active_preset_id)
  return {
    status: selected ? state.status : 'preset_not_found',
    requested_provider_preset_id: requestedId || null,
    selected_provider_preset_id: selected?.id ?? state.active_preset_id ?? null,
    provider: selected?.provider ?? state.provider ?? null,
    model: selected?.model ?? state.model ?? null,
    available: Boolean(selected?.available ?? state.available),
    image_config: selected?.image_config ?? null,
    secrets_exposed: false,
  }
}

function t2iFailureCategory(item) {
  if (item.status === 'done') return null
  if (item.failure_status === 'provider_route_blocked' || item.status === 'provider_route_blocked') return 'provider.route_blocked'
  if (item.status === 'failed_budget_exhausted') return 'provider.budget_exhausted'
  const candidates = item.candidate_selection?.candidates ?? []
  if (candidates.some((candidate) => candidate.failure_status === 'provider_route_blocked')) return 'provider.route_blocked'
  if (candidates.some((candidate) => candidate.status === 'error')) return 'provider.model_error'
  return `generation.${item.status || 'failed'}`
}

function t2iFailureTaxonomy(items) {
  const categories = new Map()
  for (const item of items) {
    const category = t2iFailureCategory(item)
    if (!category) continue
    const entry = categories.get(category) ?? { category, count: 0, examples: [] }
    entry.count += 1
    if (entry.examples.length < 8) entry.examples.push(item.case_id)
    categories.set(category, entry)
  }
  return [...categories.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

function t2iGoldenSummary(items, { stoppedEarly = false, stopReason = null, maxCaseFailures = null } = {}) {
  const totalScore = items.reduce((sum, item) => sum + Number(item.selected_score || 0), 0)
  const reviewedScore = items.reduce((sum, item) => (
    sum + Number(item.release_selected_score ?? item.selected_score ?? 0)
  ), 0)
  const failureCount = items.filter((item) => item.status !== 'done').length
  const successCount = items.length - failureCount
  return {
    total: items.length,
    success_count: successCount,
    failure_count: failureCount,
    stopped_early: stoppedEarly,
    stop_reason: stopReason,
    max_case_failures: maxCaseFailures,
    average_score: items.length ? Math.round((totalScore / items.length) * 100) / 100 : 0,
    average_reviewed_score: items.length ? Math.round((reviewedScore / items.length) * 100) / 100 : 0,
  }
}

async function commandBenchmarkT2iGolden(options) {
  loadLocalEnv()
  const cases = selectT2iGoldenCases(options)
  const mode = normalizeTextToImageMode(option(options, 't2i-mode', TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER))
  const characterPreset = option(options, 'character-preset')
  const generationOptions = generationOptionsFromCli(options)
  const candidateCount = generationOptions.candidateCount
  const imageConfig = imageConfigFromCli(options, { mode, characterPreset, envPrefix: 'T2I' })
  const providerConfig = t2iProviderConfigFromOptions(options)
  if (options['dry-run-plan']) {
    const plan = buildT2iGoldenBenchmarkPlan({
      cases,
      candidateCount,
      mode,
      imageConfig,
      generationOptions,
    })
    const { mode: planMode, ...planRest } = plan
    return {
      command: 'benchmark t2i-golden',
      mode: 'dry_run_plan',
      t2i_mode: planMode,
      planned_provider_calls: cases.length * candidateCount,
      provider_config: providerConfig,
      ...planRest,
    }
  }
  const yes = Boolean(options.yes) || process.env.T2I_BENCHMARK_CONFIRM === '1'
  if (!yes) throw new Error('benchmark t2i-golden uses live provider quota; pass --yes to continue')
  const providerCallBudget = providerCallBudgetFromOptions(options, {
    command: 'benchmark t2i-golden',
    plannedProviderCalls: cases.length * candidateCount,
  })
  const outputDir = option(options, 'output-dir', 'generated/t2i-golden-benchmarks')
  const runId = option(options, 'run-id', makeJobId('t2i_golden'))
  const runDir = path.join(outputDir, runId)
  const itemsDir = path.join(runDir, 'items')
  await mkdir(itemsDir, { recursive: true })
  const items = []
  const maxCaseFailures = optionPositiveInt(options, 'max-case-failures', 1)
  let caseFailures = 0
  let stoppedEarly = false
  let stopReason = null
  for (const testCase of cases) {
    try {
      const result = await runQualityCharacterTextToImage({
        description: testCase.description,
        providerPresetId: option(options, 'provider-preset'),
        imageConfig,
        generationOptions,
        promptFields: promptFieldsFromOptions(options),
        characterPreset,
        backgroundMode: option(options, 'background-mode', 'auto'),
        pixelFinishing: pixelFinishingFromOptions(options),
        providerBudget: providerCallBudget.providerBudget,
      })
      const written = await writeTextToImageArtifacts({ jobId: testCase.id, outputDir: itemsDir, result })
      items.push({
        case_id: testCase.id,
        locale: testCase.locale,
        description: testCase.description,
        status: written.status,
        selected_index: result.report.selected_index,
        selected_score: result.report.selected_score,
        release_selected_index: result.report.release_selected_index,
        release_selected_score: result.report.release_selected_score,
        prompt_file: path.join(written.dir, 'prompt.txt'),
        generation_file: path.join(written.dir, 'generation.json'),
        source_file: path.join(written.dir, 'source.png'),
        result_file: path.join(written.dir, 't2i_result.png'),
        candidate_selection: result.report.candidate_selection,
      })
    } catch (error) {
      caseFailures += 1
      items.push(failedT2iGoldenItem(testCase, error))
      if (caseFailures >= maxCaseFailures) {
        stoppedEarly = true
        stopReason = 'case_failure_limit_reached'
        break
      }
    }
  }
  const report = {
    run_id: runId,
    t2i_mode: mode,
    provider_config: providerConfig,
    candidate_count: candidateCount,
    image_config: imageConfig,
    generation_options: generationOptions,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    summary: t2iGoldenSummary(items, { stoppedEarly, stopReason, maxCaseFailures }),
    failure_taxonomy: t2iFailureTaxonomy(items),
    items,
  }
  report.markdown = t2iGoldenMarkdown(report)
  await writeFile(path.join(runDir, 't2i_golden_report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 't2i_golden_report.md'), report.markdown)
  return {
    command: 'benchmark t2i-golden',
    mode: 'live',
    t2i_mode: mode,
    run_id: runId,
    output_dir: runDir,
    total: report.summary.total,
    provider_config: report.provider_config,
    provider_call_budget: report.provider_call_budget,
    failure_taxonomy: report.failure_taxonomy,
    average_score: report.summary.average_score,
    average_reviewed_score: report.summary.average_reviewed_score,
  }
}

function t2iGoldenReviewReportPath(options) {
  const reportPath = option(options, 'report')
  if (reportPath) return String(reportPath)
  const runDir = option(options, 'run-dir')
  if (runDir) return path.join(String(runDir), 't2i_golden_report.json')
  throw new Error('benchmark t2i-golden-review requires --report or --run-dir')
}

function t2iGoldenReviewThresholdsFromOptions(options) {
  const pairs = [
    ['usable-score', 'usable_score'],
    ['warning-score', 'warning_score'],
    ['target-usable-rate', 'target_usable_rate'],
    ['min-visible-pixels', 'min_visible_pixel_count'],
    ['min-unique-colors', 'min_unique_color_count'],
    ['max-palette-change', 'max_palette_changed_pixel_ratio'],
    ['max-outline-ratio', 'max_outline_pixel_ratio'],
    ['max-visible-pixels', 'max_visible_pixel_count'],
    ['max-bbox-width-ratio', 'max_bbox_width_ratio'],
    ['max-bbox-height-ratio', 'max_bbox_height_ratio'],
    ['max-bbox-area-ratio', 'max_bbox_area_ratio'],
    ['max-center-offset-ratio', 'max_center_offset_ratio'],
    ['min-edge-margin-ratio', 'min_edge_margin_ratio'],
  ]
  const thresholds = {}
  for (const [optionName, thresholdName] of pairs) {
    if (options[optionName] !== undefined) thresholds[thresholdName] = optionNumber(options, optionName)
  }
  return thresholds
}

function resolveArtifactPath(filePath) {
  if (!filePath) return null
  const value = String(filePath)
  return path.isAbsolute(value) ? value : path.resolve(value)
}

function webRelativePath(fromDir, toPath) {
  const relative = path.relative(fromDir, toPath) || path.basename(toPath)
  return relative.split(path.sep).join('/')
}

function t2iArtifactRecord(filePath, outputDir) {
  const resolvedPath = resolveArtifactPath(filePath)
  if (!resolvedPath) return { path: null, resolved_path: null, href: null, exists: false }
  return {
    path: String(filePath),
    resolved_path: resolvedPath,
    href: webRelativePath(outputDir, resolvedPath),
    exists: existsSync(resolvedPath),
  }
}

function t2iGoldenReviewArtifacts(report, outputDir) {
  const byCase = {}
  for (const item of report.items ?? []) {
    const candidateDir = item.result_file ? path.dirname(String(item.result_file)) : null
    const candidates = (item.candidate_selection?.candidates ?? []).map((candidate) => ({
      index: candidate.index,
      score: candidate.score,
      artifact: t2iArtifactRecord(
        candidateDir ? path.join(candidateDir, `candidate_${candidate.index}.png`) : null,
        outputDir
      ),
    }))
    byCase[item.case_id] = {
      source: t2iArtifactRecord(item.source_file, outputDir),
      result: t2iArtifactRecord(item.result_file, outputDir),
      prompt: t2iArtifactRecord(item.prompt_file, outputDir),
      generation: t2iArtifactRecord(item.generation_file, outputDir),
      candidates,
    }
  }
  return byCase
}

async function commandBenchmarkT2iGoldenReview(options) {
  const reportPath = t2iGoldenReviewReportPath(options)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  const outputDir = path.resolve(option(options, 'output-dir', path.dirname(reportPath)))
  await mkdir(outputDir, { recursive: true })
  const review = buildT2iGoldenReview(report, {
    sourceReport: reportPath,
    thresholds: t2iGoldenReviewThresholdsFromOptions(options),
    artifactStatusByCaseId: t2iGoldenReviewArtifacts(report, outputDir),
  })
  const jsonPath = path.join(outputDir, 't2i_golden_review.json')
  const markdownPath = path.join(outputDir, 't2i_golden_review.md')
  const htmlPath = path.join(outputDir, 't2i_golden_review.html')
  await writeFile(jsonPath, JSON.stringify(review, null, 2))
  await writeFile(markdownPath, buildT2iGoldenReviewMarkdown(review))
  await writeFile(htmlPath, buildT2iGoldenReviewHtml(review))
  return {
    command: 'benchmark t2i-golden-review',
    mode: 'offline',
    source_run_id: review.source_run_id,
    output_dir: outputDir,
    total: review.summary.total,
    usable_rate: review.summary.usable_rate,
    quality_gate: review.quality_gate,
    closure_analysis: review.closure_analysis,
    priority_actions: review.closure_analysis?.priority_actions ?? [],
    issue_taxonomy: review.summary.issue_taxonomy,
    review_file: jsonPath,
    markdown_file: markdownPath,
    html_file: htmlPath,
  }
}

async function commandBenchmarkOpenRouterRecomputeReport(options) {
  const reportPath = option(options, 'report')
  if (!reportPath) throw new Error('benchmark openrouter-recompute-report requires --report')
  const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
  const outputDir = option(options, 'output-dir', path.dirname(path.dirname(String(reportPath))))
  const recomputed = recomputeOpenRouterBenchmarkReport(report, { runId: option(options, 'run-id') })
  const runDir = path.join(outputDir, recomputed.run_id)
  await mkdir(runDir, { recursive: true })
  await writeFile(path.join(runDir, 'benchmark_report.json'), JSON.stringify(recomputed, null, 2))
  await writeFile(path.join(runDir, 'benchmark_report.md'), recomputed.markdown)
  return {
    command: 'benchmark openrouter-recompute-report',
    source_run_id: recomputed.source_run_id,
    run_id: recomputed.run_id,
    output_dir: runDir,
    preset: recomputed.preset,
    total: recomputed.summary.total,
    validation: recomputed.summary.validation,
    failures: recomputed.summary.failures,
    failure_taxonomy: recomputed.summary.failure_taxonomy,
    pass_rate: recomputed.summary.pass_rate,
    usable_rate: recomputed.summary.usable_rate,
    quality_gate: recomputed.quality_gate,
  }
}

async function commandBenchmarkTopdownQualityClosure(options) {
  const caseIds = optionList(options, 'case-id')
  const imageSizes = optionList(options, 'image-size')
  const variantsPerCase = optionPositiveInt(options, 'variants', process.env.OPENROUTER_BENCHMARK_VARIANTS || '1')
  const runId = option(options, 'run-id')
  if (options['dry-run-plan']) {
    const plan = buildTopdownQualityClosurePlan({
      runId,
      caseIds: caseIds.length ? caseIds : undefined,
      imageSizes: imageSizes.length ? imageSizes : undefined,
      variantsPerCase,
    })
    return {
      command: 'benchmark topdown-quality-closure',
      mode: 'dry_run_plan',
      ...plan,
    }
  }

  loadLocalEnv()
  const yes = Boolean(options.yes) || process.env.OPENROUTER_BENCHMARK_CONFIRM === '1'
  if (!yes) throw new Error('benchmark topdown-quality-closure uses live provider quota; pass --yes to continue')
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured')
  const outputDir = option(options, 'output-dir', process.env.OPENROUTER_BENCHMARK_OUTPUT_DIR || 'generated/openrouter-benchmarks')
  const report = await runTopdownQualityClosureGate({
    outputDir,
    runId,
    caseIds: caseIds.length ? caseIds : undefined,
    imageSizes: imageSizes.length ? imageSizes : undefined,
    variantsPerCase,
    providerPresetId: option(options, 'provider-preset', process.env.OPENROUTER_BENCHMARK_PROVIDER_PRESET),
    backgroundMode: option(options, 'background-mode', 'auto'),
    aspectRatio: option(options, 'aspect-ratio', process.env.OPENROUTER_BENCHMARK_ASPECT_RATIO || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '1:1'),
  })
  return {
    command: 'benchmark topdown-quality-closure',
    mode: 'live',
    run_id: report.run_id,
    output_dir: `${outputDir}/${report.run_id}`,
    preset: report.preset,
    case_ids: report.case_ids,
    image_sizes: report.image_sizes,
    variants_per_case: report.variants_per_case,
    comparison: report.comparison,
  }
}

async function commandBenchmarkProcessed(options) {
  const outputDir = option(options, 'output-dir', 'generated/processed-sample-benchmarks')
  const report = await runProcessedSampleBenchmark({
    rootDir: option(options, 'root-dir', 'generated'),
    outputDir,
    runId: option(options, 'run-id'),
    limit: options.limit ? optionPositiveInt(options, 'limit', null) : null,
  })
  return {
    command: 'benchmark processed',
    run_id: report.run_id,
    output_dir: `${outputDir}/${report.run_id}`,
    total: report.summary.total,
    validation: report.summary.validation,
    failure_modes: report.summary.failure_modes,
    failure_taxonomy: report.summary.failure_taxonomy,
    pass_rate: report.summary.pass_rate,
    usable_rate: report.summary.usable_rate,
  }
}

async function commandBenchmarkLocalImages(options) {
  const outputDir = option(options, 'output-dir', 'generated/local-image-benchmarks')
  const backgroundSweepModes = optionList(options, 'background-sweep-mode')
  const report = await runLocalImageBenchmark({
    manifestPath: option(options, 'manifest', DEFAULT_LOCAL_IMAGE_MANIFEST),
    outputDir,
    runId: option(options, 'run-id'),
    sampleIds: optionList(options, 'id'),
    kinds: optionList(options, 'kind'),
    backgroundMode: option(options, 'background-mode', 'auto'),
    backgroundSweep: Boolean(options['background-sweep']),
    backgroundSweepModes: backgroundSweepModes.length ? backgroundSweepModes : undefined,
    backgroundTolerance: optionNumber(options, 'background-tolerance'),
    styleMaxColors: optionPositiveInt(options, 'style-max-colors', 16),
    downsampleFactor: optionPositiveInt(options, 'downsample-factor', 2),
    outline: !options['disable-outline'],
    visualPreviews: !options['disable-visual-previews'],
    gateLayer: option(options, 'gate-layer', 'local-golden'),
  })
  return {
    command: 'benchmark local-images',
    mode: report.mode,
    gate_layer: report.gate_layer,
    run_id: report.run_id,
    output_dir: `${outputDir}/${report.run_id}`,
    manifest: report.manifest.path,
    manifest_validation: report.manifest_validation,
    total: report.summary.total,
    validation: report.summary.validation,
    quality_gate: report.quality_gate,
    usable_rate: report.summary.usable_rate,
    expectation_met_rate: report.summary.expectation_met_rate,
    background_sweep: { enabled: Boolean(report.options.backgroundSweep) },
    visual_previews: { enabled: Boolean(report.options.visualPreviews) },
    report_file: `${outputDir}/${report.run_id}/local_image_benchmark.json`,
    html_file: `${outputDir}/${report.run_id}/local_image_benchmark.html`,
  }
}

async function commandBenchmarkLocalImagesValidate(options) {
  const report = await validateLocalImageManifest({
    manifestPath: option(options, 'manifest', DEFAULT_LOCAL_IMAGE_MANIFEST),
  })
  return {
    command: 'benchmark local-images-validate',
    mode: report.mode,
    manifest: report.manifest.path,
    total: report.summary.total,
    status: report.summary.status,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    issues: report.issues,
    items: report.items,
  }
}

async function commandBenchmarkLocalImagesAdd(options) {
  const result = await addLocalImageSample({
    manifestPath: option(options, 'manifest', DEFAULT_LOCAL_IMAGE_MANIFEST),
    input: option(options, 'input'),
    id: option(options, 'id'),
    kind: option(options, 'kind'),
    profile: option(options, 'profile'),
    sourceRights: option(options, 'source-rights'),
    expectedChecks: optionList(options, 'expected-check'),
    expectedStatus: option(options, 'expected-status'),
    notes: option(options, 'notes'),
  })
  return {
    command: 'benchmark local-images-add',
    mode: result.mode,
    manifest: result.manifest,
    destination: result.destination,
    sample: result.sample,
    validation: result.validation,
  }
}

async function commandBenchmarkSceneTileReport(options) {
  const sceneDirs = optionList(options, 'scene-dir')
  if (!sceneDirs.length) throw new Error('benchmark scene-tile-report requires at least one --scene-dir')
  const outputDir = option(options, 'output-dir', 'generated/scene-tile-reports')
  const report = await writeSceneTileReport({
    sceneDirs,
    outputDir,
    runId: option(options, 'run-id', makeJobId('scene_tile_report')),
  })
  return {
    command: 'benchmark scene-tile-report',
    run_id: report.run_id,
    output_dir: report.output_dir,
    total: report.summary.total,
    validation: report.summary.validation,
    pass_rate: report.summary.pass_rate,
    usable_rate: report.summary.usable_rate,
    sample_size: report.summary.sample_size,
    gate_policy: report.summary.gate_policy,
    correction_paths: report.summary.correction_paths,
    correction_dependency: report.summary.correction_dependency,
    gates: report.summary.gates,
    failure_taxonomy: report.summary.failure_taxonomy,
  }
}

async function commandBenchmarkSceneTileCorrectionMatrix(options) {
  const inputFiles = optionList(options, 'input')
  if (!inputFiles.length) throw new Error('benchmark scene-tile-correction-matrix requires at least one --input')
  const ids = optionList(options, 'id')
  const outputDir = option(options, 'output-dir', 'generated/scene-tile-correction-matrix')
  const runId = option(options, 'run-id', makeJobId('scene_tile_correction_matrix'))
  const result = await runSceneTileCorrectionMatrix({
    inputs: inputFiles.map((file, index) => ({ file, id: ids[index] })),
    outputDir,
    runId,
    width: optionPositiveInt(options, 'width', 3),
    height: optionPositiveInt(options, 'height', 3),
    pattern: option(options, 'pattern', 'rule'),
    seed: optionNumber(options, 'seed', 7),
    density: optionNumber(options, 'density', 0.55),
    gatePolicy: sceneTileGatePolicyOptions(options, 'strict'),
    styleCorrection: {
      mode: 'palette_snap',
      maxColors: optionPositiveInt(options, 'style-max-colors', 16),
    },
    edgeConditioning: {
      enabled: true,
      band: optionPositiveInt(options, 'edge-band', 3),
      mode: option(options, 'edge-condition-mode', 'edge-aware-v1'),
    },
  })
  return {
    command: 'benchmark scene-tile-correction-matrix',
    run_id: result.run_id,
    output_dir: result.output_dir,
    input_count: result.summary.input_count,
    total_items: result.summary.total_items,
    by_variant: result.summary.by_variant,
    transitions: result.summary.transitions,
    gate_transitions: result.summary.gate_transitions,
    blocker_taxonomy_by_variant: result.summary.blocker_taxonomy_by_variant,
    blocker_transitions: result.summary.blocker_transitions,
    raw_quality_readiness: result.summary.raw_quality_readiness,
    raw_quality_diagnostics: result.summary.raw_quality_diagnostics,
    correction_dependency: result.summary.correction_dependency,
    matrix_file: path.join(result.output_dir, 'scene_tile_correction_matrix.json'),
    report_file: path.join(result.output_dir, 'scene_tile_report.json'),
  }
}

async function commandBenchmarkSceneTileManualPrompts(options) {
  const outputDir = option(options, 'output-dir', 'generated/scene-tile-manual-prompts')
  const runId = option(options, 'run-id', makeJobId('scene_tile_manual_prompts'))
  const pack = buildSceneTileManualPromptPack({
    outputDir,
    runId,
    inputDir: option(options, 'input-dir', '/tmp/scene-tile-gemini-v06-sheets'),
    caseIds: optionList(options, 'case-id'),
    sampleSize: options['sample-size'] ? optionPositiveInt(options, 'sample-size') : undefined,
  })

  await mkdir(pack.output_dir, { recursive: true })
  for (const item of pack.cases) {
    const caseDir = path.join(pack.output_dir, item.id)
    await mkdir(caseDir, { recursive: true })
    await writeFile(path.join(pack.output_dir, item.prompt_file), item.prompt)
    await writeFile(path.join(pack.output_dir, item.generation_file), JSON.stringify({
      mode: 'scene_tile_manual_prompt_case_v0',
      case_id: item.id,
      description: item.description,
      expected_input_filename: item.expected_input_filename,
      expected_input_file: item.expected_input_file,
      prompt_contract: item.prompt_contract,
    }, null, 2))
  }
  await writeFile(path.join(pack.output_dir, pack.handoff_file), renderSceneTileManualHandoff(pack))
  await writeFile(path.join(pack.output_dir, 'manual_prompt_pack.json'), JSON.stringify(pack, null, 2))

  return {
    command: 'benchmark scene-tile-manual-prompts',
    mode: pack.mode,
    run_id: pack.run_id,
    output_dir: pack.output_dir,
    prompt_contract: pack.prompt_contract,
    case_ids: pack.cases.map((item) => item.id),
    prompt_files: pack.cases.map((item) => path.join(pack.output_dir, item.prompt_file)),
    expected_input_files: pack.cases.map((item) => item.expected_input_filename),
    handoff_file: path.join(pack.output_dir, pack.handoff_file),
    pack_file: path.join(pack.output_dir, 'manual_prompt_pack.json'),
  }
}

async function commandBenchmarkSceneTileManualRetest(options) {
  const outputDir = option(options, 'output-dir', 'generated/scene-tile-correction-matrix')
  const runId = option(options, 'run-id', 'gemini_manual_scene_tile_v06_raw_quality_20260617')
  const retest = await inspectSceneTileManualRetestInputs({
    inputDir: option(options, 'input-dir', '/tmp/scene-tile-gemini-v06-sheets'),
    outputDir,
    runId,
    caseIds: optionList(options, 'case-id'),
    sampleSize: options['sample-size'] ? optionPositiveInt(options, 'sample-size') : undefined,
    width: optionPositiveInt(options, 'width', 3),
    height: optionPositiveInt(options, 'height', 3),
    pattern: option(options, 'pattern', 'rule'),
    seed: optionNumber(options, 'seed', 7),
    density: optionNumber(options, 'density', 0.55),
    gatePolicy: sceneTileGatePolicyOptions(options, 'strict'),
    styleCorrection: {
      mode: 'palette_snap',
      maxColors: optionPositiveInt(options, 'style-max-colors', 16),
    },
    edgeConditioning: {
      enabled: true,
      band: optionPositiveInt(options, 'edge-band', 3),
      mode: option(options, 'edge-condition-mode', 'edge-aware-v1'),
    },
  })

  await mkdir(retest.output_dir, { recursive: true })
  await writeFile(path.join(retest.output_dir, 'manual_retest_status.json'), JSON.stringify(retest, null, 2))

  if (!retest.ready) {
    return {
      command: 'benchmark scene-tile-manual-retest',
      mode: retest.mode,
      status: retest.status,
      run_id: retest.run_id,
      output_dir: retest.output_dir,
      input_dir: retest.input_dir,
      prompt_contract: retest.prompt_contract,
      existing_input_count: retest.existing_input_count,
      missing_input_count: retest.missing_input_count,
      invalid_input_count: retest.invalid_input_count,
      missing_inputs: retest.missing_inputs.map((item) => ({
        id: item.id,
        expected_input_filename: item.expected_input_filename,
        input_file: item.input_file,
      })),
      invalid_inputs: retest.invalid_inputs.map((item) => ({
        id: item.id,
        expected_input_filename: item.expected_input_filename,
        input_file: item.input_file,
        blocking_errors: item.blocking_errors,
        actual_format: item.actual_format,
        actual_size: item.actual_size,
      })),
      status_file: path.join(retest.output_dir, 'manual_retest_status.json'),
    }
  }

  const result = await runSceneTileCorrectionMatrix({
    inputs: retest.matrix_inputs,
    outputDir,
    runId,
    ...retest.matrix_options,
  })
  return {
    command: 'benchmark scene-tile-manual-retest',
    mode: retest.mode,
    status: 'ready',
    run_id: result.run_id,
    output_dir: result.output_dir,
    input_dir: retest.input_dir,
    prompt_contract: retest.prompt_contract,
    input_count: result.summary.input_count,
    total_items: result.summary.total_items,
    raw_quality_readiness: result.summary.raw_quality_readiness,
    raw_quality_diagnostics: result.summary.raw_quality_diagnostics,
    correction_dependency: result.summary.correction_dependency,
    matrix_file: path.join(result.output_dir, 'scene_tile_correction_matrix.json'),
    report_file: path.join(result.output_dir, 'scene_tile_report.json'),
    status_file: path.join(retest.output_dir, 'manual_retest_status.json'),
  }
}

async function commandBenchmarkSceneTileLiveGate(options) {
  loadLocalEnv()
  const outputDir = option(options, 'output-dir', 'generated/scene-tile-live-gates')
  const runId = option(options, 'run-id', makeJobId('scene_tile_live_gate'))
  const providerPresetId = option(options, 'provider-preset', process.env.SCENE_TILE_GATE_PROVIDER_PRESET)
  const providerConfig = publicSceneTileProviderConfig(providerPresetId)
  const plan = buildSceneTileLiveGatePlan({
    runId,
    outputDir,
    caseIds: optionList(options, 'case-id'),
    sampleSize: options['sample-size'] ? optionPositiveInt(options, 'sample-size') : undefined,
    providerPresetId,
    candidateCount: optionPositiveInt(options, 'candidate-count', 1),
    imageConfig: cleanOptions({
      image_size: option(options, 'image-size', process.env.SCENE_TILE_GATE_IMAGE_SIZE || process.env.OPENROUTER_IMAGE_SIZE || process.env.GEMINI_IMAGE_SIZE || '2K'),
      aspect_ratio: option(options, 'aspect-ratio', process.env.SCENE_TILE_GATE_ASPECT_RATIO || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || process.env.GEMINI_IMAGE_ASPECT_RATIO || '1:1'),
    }),
    width: optionPositiveInt(options, 'width', 3),
    height: optionPositiveInt(options, 'height', 3),
    pattern: option(options, 'pattern', 'rule'),
    seed: optionNumber(options, 'seed', 7),
    density: optionNumber(options, 'density', 0.55),
    gatePolicy: sceneTileGatePolicyOptions(options, 'strict'),
    styleCorrection: sceneStyleCorrectionOptions(options),
    edgeConditioning: sceneEdgeConditioningOptions(options),
  })
  const planEvidence = {
    ...plan,
    provider_config: providerConfig,
  }

  if (options['dry-run-plan']) {
    await mkdir(plan.output_dir, { recursive: true })
    await writeFile(path.join(plan.output_dir, 'live_gate_plan.json'), JSON.stringify(planEvidence, null, 2))
    return {
      command: 'benchmark scene-tile-live-gate',
      mode: 'dry_run_plan',
      run_id: plan.run_id,
      output_dir: plan.output_dir,
      estimated_provider_calls: plan.estimated_provider_calls,
      case_ids: plan.cases.map((item) => item.id),
      candidate_count: plan.scene_options.candidate_count,
      provider_config: providerConfig,
      gate_policy: plan.scene_options.gate_policy,
      plan_file: path.join(plan.output_dir, 'live_gate_plan.json'),
    }
  }

  const yes = Boolean(options.yes) || process.env.SCENE_TILE_GATE_CONFIRM === '1'
  if (!yes) throw new Error('benchmark scene-tile-live-gate uses live provider quota; pass --dry-run-plan to inspect or --yes to continue')
  const providerCallBudget = providerCallBudgetFromOptions(options, {
    command: 'benchmark scene-tile-live-gate',
    plannedProviderCalls: plan.estimated_provider_calls,
  })
  await mkdir(plan.output_dir, { recursive: true })
  await writeFile(path.join(plan.output_dir, 'live_gate_plan.json'), JSON.stringify(planEvidence, null, 2))
  let result
  try {
    result = await runSceneTileLiveGate({ plan: planEvidence, providerBudget: providerCallBudget.providerBudget })
  } catch (error) {
    const blocker = buildSceneTileLiveGateBlocker({ plan: planEvidence, providerCallBudget, providerConfig, error })
    const review = buildSceneTileBlockedReview({ plan: planEvidence, blocker })
    await writeFile(
      path.join(plan.output_dir, 'live_gate_blocker.json'),
      JSON.stringify(blocker, null, 2)
    )
    await writeFile(path.join(plan.output_dir, 'live_gate_review.json'), JSON.stringify(review, null, 2))
    await writeFile(path.join(plan.output_dir, 'live_gate_review.md'), markdownForSceneTileBlockedReview(review))
    throw error
  }
  await writeFile(path.join(result.output_dir, 'live_gate_plan.json'), JSON.stringify(result.plan, null, 2))
  await writeFile(path.join(result.output_dir, 'scene_tile_report.json'), JSON.stringify(result.report, null, 2))
  await writeFile(path.join(result.output_dir, 'scene_tile_report.md'), result.report.markdown)
  return {
    command: 'benchmark scene-tile-live-gate',
    mode: 'live',
    run_id: result.run_id,
    output_dir: result.output_dir,
    total: result.summary.total,
    candidate_count: result.plan.scene_options.candidate_count,
    estimated_provider_calls: result.plan.estimated_provider_calls,
    provider_config: providerConfig,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    validation: result.summary.validation,
    pass_rate: result.summary.pass_rate,
    usable_rate: result.summary.usable_rate,
    sample_size: result.summary.sample_size,
    gate_policy: result.summary.gate_policy,
    correction_paths: result.summary.correction_paths,
    correction_dependency: result.summary.correction_dependency,
    failure_taxonomy: result.summary.failure_taxonomy,
  }
}

async function commandBenchmarkTopdownRepairPlan(options) {
  const reportPath = option(options, 'report')
  if (!reportPath) throw new Error('benchmark topdown-repair-plan requires --report')
  const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
  return {
    command: 'benchmark topdown-repair-plan',
    ...buildTopdownRepairPlansForBenchmarkReport(report),
  }
}

async function commandBenchmarkTopdownRepairManifest(options) {
  const reportPath = option(options, 'report')
  if (!reportPath) throw new Error('benchmark topdown-repair-manifest requires --report')
  const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
  const manifest = buildTopdownRepairManifestForBenchmarkReport(report)
  if (options['summary-only']) {
    return {
      command: 'benchmark topdown-repair-manifest',
      run_id: manifest.run_id,
      preset: manifest.preset,
      summary: manifest.summary,
    }
  }
  return {
    command: 'benchmark topdown-repair-manifest',
    ...manifest,
  }
}

async function readQualityClosureDebugReportSource({ debugReportPath, item = {}, runId = null, artifactDir = null, blocker = null } = {}) {
  if (blocker) return { item, runId, artifactDir, debugReportPath, blocker }
  try {
    return {
      item,
      runId,
      artifactDir,
      debugReportPath,
      debugReport: JSON.parse(await readFile(String(debugReportPath), 'utf8')),
    }
  } catch (error) {
    return {
      item,
      runId,
      artifactDir,
      debugReportPath,
      blocker: `could not read debug_report.json: ${error.message || error}`,
    }
  }
}

async function qualityClosureSourcesFromBenchmarkReport(report = {}) {
  const sources = []
  for (const item of report.items ?? []) {
    const artifactDir = item.artifacts?.dir ?? null
    const debugReportPath = item.debug_report_path ?? (artifactDir ? path.join(artifactDir, 'debug_report.json') : null)
    if (!debugReportPath) {
      sources.push({
        item,
        runId: report.run_id ?? null,
        artifactDir,
        blocker: 'benchmark item is missing artifacts.dir or debug_report_path',
      })
      continue
    }
    sources.push(await readQualityClosureDebugReportSource({
      item,
      runId: report.run_id ?? null,
      artifactDir,
      debugReportPath,
    }))
  }
  return sources
}

async function commandBenchmarkQualityClosureRepairManifest(options) {
  const debugReportPath = option(options, 'debug-report')
  const reportPath = option(options, 'report')
  if (!debugReportPath && !reportPath) throw new Error('benchmark quality-closure-repair-manifest requires --debug-report or --report')
  if (debugReportPath && reportPath) throw new Error('benchmark quality-closure-repair-manifest accepts only one of --debug-report or --report')

  let sources
  let runId = option(options, 'run-id', null)
  let preset = option(options, 'preset', 'topdown_rpg_v0')
  if (debugReportPath) {
    const artifactDir = option(options, 'artifact-dir', path.dirname(String(debugReportPath)))
    const caseId = option(options, 'case-id', null)
    const itemId = option(options, 'item-id', artifactDir ? path.basename(String(artifactDir)) : 'debug_report')
    const description = option(options, 'description', null)
    sources = [await readQualityClosureDebugReportSource({
      item: {
        id: itemId,
        item_id: itemId,
        case: caseId ? { id: caseId, description } : undefined,
      },
      runId,
      artifactDir,
      debugReportPath,
    })]
  } else {
    const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
    runId = runId ?? report.run_id ?? null
    preset = option(options, 'preset', report.preset ?? preset)
    sources = await qualityClosureSourcesFromBenchmarkReport(report)
  }

  const manifest = buildCharacterQualityClosureRepairManifestForSources(sources, { runId, preset })
  const outputDir = option(options, 'output-dir', null)
  const artifacts = {}
  if (outputDir) {
    await mkdir(String(outputDir), { recursive: true })
    artifacts.manifest_json = path.join(String(outputDir), 'quality_closure_repair_manifest.json')
    artifacts.manifest_md = path.join(String(outputDir), 'quality_closure_repair_manifest.md')
    await writeFile(artifacts.manifest_json, JSON.stringify(manifest, null, 2))
    await writeFile(artifacts.manifest_md, renderCharacterQualityClosureRepairManifestMarkdown(manifest))
  }

  if (options['summary-only']) {
    return {
      command: 'benchmark quality-closure-repair-manifest',
      run_id: manifest.run_id,
      preset: manifest.preset,
      status: manifest.status,
      summary: manifest.summary,
      ...(outputDir ? { artifacts } : {}),
    }
  }
  return {
    command: 'benchmark quality-closure-repair-manifest',
    ...manifest,
    ...(outputDir ? { artifacts } : {}),
  }
}

function compactQualityClosureRepairLoopPlan(plan) {
  return {
    command: 'benchmark quality-closure-repair-loop',
    mode: 'dry_run_plan',
    run_id: plan.run_id,
    preset: plan.preset,
    output_dir: plan.output_dir,
    can_run: plan.can_run,
    preflight: plan.preflight,
    selected_task_count: plan.selected_task_count,
    local_task_count: plan.local_task_count,
    provider_task_count: plan.provider_task_count,
    estimated_provider_calls: plan.estimated_provider_calls,
    input_normalized_sheet: plan.input_normalized_sheet,
    task_ids: plan.tasks.map((task) => task.task_id),
    plan_file: plan.files.plan,
  }
}

function compactQualityClosureRepairLoopResult(plan, result) {
  return {
    command: 'benchmark quality-closure-repair-loop',
    mode: 'provider_free_local_repair',
    status: result.status,
    run_id: result.run_id,
    preset: result.preset,
    output_dir: plan.output_dir,
    summary: result.summary,
    local_target_results: result.local_target_results,
    provider_dry_run: {
      estimated_provider_calls: result.provider_dry_run.estimated_provider_calls,
      task_count: result.provider_dry_run.tasks.length,
      task_ids: result.provider_dry_run.tasks.map((task) => task.task_id),
    },
    files: {
      plan: plan.files.plan,
      report: plan.files.report,
      markdown: plan.files.markdown,
      before_after_preview: plan.files.before_after_preview,
      repaired_normalized_sheet: plan.files.repaired_normalized_sheet,
    },
  }
}

function qualityClosureRepairLoopFiles(plan, { planOnly = false } = {}) {
  const files = [plan.files.plan]
  if (!planOnly) {
    files.push(
      plan.files.report,
      plan.files.markdown,
      plan.files.before_after_preview,
      plan.files.repaired_normalized_sheet,
      ...plan.provider_tasks.flatMap((task) => [task.files.prompt, task.files.contract])
    )
  }
  return files.filter((file) => file && existsSync(file))
}

async function writeQualityClosureRepairLoopArtifacts(plan, result) {
  await mkdir(plan.output_dir, { recursive: true })
  await mkdir(plan.files.item_output_dir, { recursive: true })
  await writeFile(plan.files.plan, JSON.stringify(serializeQualityClosureRepairLoopPlan(plan), null, 2))
  await writeFile(plan.files.report, JSON.stringify(serializeQualityClosureRepairLoopResult(result), null, 2))
  await writeFile(plan.files.markdown, result.markdown)
  await writeFile(plan.files.before_after_preview, result.before_after_preview_png)
  await writeFile(plan.files.repaired_normalized_sheet, result.repaired_normalized_sheet_png)

  const dryRunTasksById = new Map(result.provider_dry_run.tasks.map((task) => [task.task_id, task]))
  for (const task of plan.provider_tasks) {
    const dryRun = dryRunTasksById.get(task.task_id)
    await mkdir(task.output_dir, { recursive: true })
    await writeFile(task.files.prompt, dryRun?.provider_payload?.prompt ?? task.provider_payload?.prompt ?? '')
    await writeFile(task.files.contract, JSON.stringify(dryRun ?? task, null, 2))
  }
}

async function commandBenchmarkQualityClosureRepairLoop(options) {
  const manifestPath = option(options, 'manifest')
  if (!manifestPath) throw new Error('benchmark quality-closure-repair-loop requires --manifest')
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const loopId = option(options, 'loop-id', makeJobId('quality_closure_repair_loop'))
  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), safePathSegment(loopId))
  )
  const plan = buildQualityClosureRepairLoopPlan({
    manifest,
    taskIds: optionList(options, 'task-id'),
    itemIds: optionList(options, 'item-id'),
    stages: optionList(options, 'stage'),
    actions: optionList(options, 'action'),
    limit: optionOptionalPositiveInt(options, 'limit'),
    outputDir,
  })

  if (options['dry-run-plan']) {
    const collisions = qualityClosureRepairLoopFiles(plan, { planOnly: true })
    if (collisions.length) throw new Error(`quality closure repair loop output collision: ${collisions.join(', ')}`)
    await mkdir(plan.output_dir, { recursive: true })
    await writeFile(plan.files.plan, JSON.stringify(serializeQualityClosureRepairLoopPlan(plan), null, 2))
    return compactQualityClosureRepairLoopPlan(plan)
  }

  if (!plan.can_run) throw new Error(`benchmark quality-closure-repair-loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  const collisions = qualityClosureRepairLoopFiles(plan)
  if (collisions.length) throw new Error(`quality closure repair loop output collision: ${collisions.join(', ')}`)
  const normalizedSheetBuffer = await readFile(plan.input_normalized_sheet)
  const result = await runQualityClosureRepairLoop({ plan, normalizedSheetBuffer })
  await writeQualityClosureRepairLoopArtifacts(plan, result)
  return compactQualityClosureRepairLoopResult(plan, result)
}

function parseRepairSpec(spec) {
  const text = String(spec ?? '')
  const separator = text.indexOf('=')
  if (separator <= 0 || separator === text.length - 1) {
    throw new Error('--repair must be formatted as <task_id>=<cell.png>')
  }
  return {
    taskId: text.slice(0, separator),
    cellPath: text.slice(separator + 1),
  }
}

function compactValidation(validation) {
  return {
    status: validation.status,
    blocking_errors: validation.blocking_errors,
    warnings: validation.warnings,
    failure_taxonomy: validation.failure_taxonomy,
  }
}

function safePathSegment(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

async function commandBenchmarkTopdownApplyRepair(options) {
  const reportPath = option(options, 'report')
  if (!reportPath) throw new Error('benchmark topdown-apply-repair requires --report')
  const repairSpecs = optionList(options, 'repair').map(parseRepairSpec)
  if (!repairSpecs.length) throw new Error('benchmark topdown-apply-repair requires at least one --repair <task_id>=<cell.png>')

  const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
  const manifest = buildTopdownRepairManifestForBenchmarkReport(report)
  const tasksById = new Map(manifest.tasks.map((task) => [task.task_id, task]))
  const repairsByItem = new Map()
  for (const spec of repairSpecs) {
    const task = tasksById.get(spec.taskId)
    if (!task) throw new Error(`Unknown topdown repair task id: ${spec.taskId}`)
    const existing = repairsByItem.get(task.item_id) ?? []
    existing.push({ task, cellBuffer: await readFile(spec.cellPath), cell_path: spec.cellPath })
    repairsByItem.set(task.item_id, existing)
  }

  const outputDir = option(options, 'output-dir', path.join('generated', 'topdown-repairs', manifest.run_id ?? makeJobId('topdown_repair')))
  await mkdir(outputDir, { recursive: true })
  const items = []
  for (const [itemId, repairs] of repairsByItem.entries()) {
    const normalizedSheetPath = repairs[0].task.artifacts?.normalized_sheet
    if (!normalizedSheetPath) throw new Error(`Repair task ${repairs[0].task.task_id} is missing normalized_sheet artifact path`)
    const itemOutputSegment = safePathSegment(itemId)
    const itemOutputDir = path.join(outputDir, itemOutputSegment)
    await mkdir(itemOutputDir, { recursive: true })
    const applied = await applyTopdownRepairCells({
      normalizedSheetBuffer: await readFile(normalizedSheetPath),
      repairs,
    })
    await writeFile(path.join(itemOutputDir, 'repaired_normalized_sheet.png'), applied.repaired_normalized_sheet_png)
    for (const [fileName, buffer] of Object.entries(applied.row_gif_buffers)) {
      await writeFile(path.join(itemOutputDir, fileName), buffer)
    }
    const validationReport = {
      schema_version: applied.schema_version,
      item_id: itemId,
      output_id: itemOutputSegment,
      input_normalized_sheet: normalizedSheetPath,
      applied_tasks: applied.applied_tasks,
      target_results: applied.target_results,
      validation_before: compactValidation(applied.validation_before),
      validation_after: compactValidation(applied.validation_after),
      row_gif_count: Object.keys(applied.row_gif_buffers).length,
    }
    await writeFile(path.join(itemOutputDir, 'repair_validation.json'), JSON.stringify(validationReport, null, 2))
    items.push({
      item_id: itemId,
      output_id: itemOutputSegment,
      output_dir: itemOutputDir,
      input_normalized_sheet: normalizedSheetPath,
      applied_tasks: applied.applied_tasks,
      target_results: applied.target_results,
      validation_before: compactValidation(applied.validation_before),
      validation_after: compactValidation(applied.validation_after),
      files: {
        repaired_normalized_sheet: path.join(itemOutputDir, 'repaired_normalized_sheet.png'),
        validation_report: path.join(itemOutputDir, 'repair_validation.json'),
        row_gif_count: Object.keys(applied.row_gif_buffers).length,
      },
    })
  }

  return {
    command: 'benchmark topdown-apply-repair',
    run_id: manifest.run_id,
    preset: manifest.preset,
    output_dir: outputDir,
    summary: {
      item_count: items.length,
      repair_count: repairSpecs.length,
      resolved_count: items.flatMap((item) => item.target_results).filter((item) => item.resolved).length,
    },
    items,
  }
}

async function commandBenchmarkQualityClosureApplyProviderRepair(options) {
  const manifestPath = option(options, 'manifest')
  if (!manifestPath) throw new Error('benchmark quality-closure-apply-provider-repair requires --manifest')
  const repairSpecs = optionList(options, 'repair').map(parseRepairSpec)
  if (!repairSpecs.length) {
    throw new Error('benchmark quality-closure-apply-provider-repair requires at least one --repair <task_id>=<strip.png>')
  }

  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const tasksById = new Map((manifest.tasks ?? []).map((task) => [task.task_id, task]))
  const repairsByItem = new Map()
  for (const spec of repairSpecs) {
    const task = tasksById.get(spec.taskId)
    if (!task) throw new Error(`Unknown quality closure repair task id: ${spec.taskId}`)
    const existing = repairsByItem.get(task.item_id) ?? []
    existing.push({ task, stripBuffer: await readFile(spec.cellPath), strip_path: spec.cellPath })
    repairsByItem.set(task.item_id, existing)
  }

  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), makeJobId('provider_repair_apply'))
  )
  await mkdir(outputDir, { recursive: true })
  const items = []
  for (const [itemId, repairs] of repairsByItem.entries()) {
    const normalizedSheetPath = repairs[0].task.artifacts?.normalized_sheet
    if (!normalizedSheetPath) throw new Error(`Quality closure repair task ${repairs[0].task.task_id} is missing normalized_sheet artifact path`)
    const itemOutputSegment = safePathSegment(itemId)
    const itemOutputDir = path.join(outputDir, itemOutputSegment)
    await mkdir(itemOutputDir, { recursive: true })
    const applied = await applyQualityClosureProviderRepairs({
      normalizedSheetBuffer: await readFile(normalizedSheetPath),
      repairs,
    })
    const reportPath = path.join(itemOutputDir, 'quality_closure_provider_repair_report.json')
    const markdownPath = path.join(itemOutputDir, 'quality_closure_provider_repair_report.md')
    await writeFile(path.join(itemOutputDir, 'repaired_normalized_sheet.png'), applied.repaired_normalized_sheet_png)
    for (const [fileName, buffer] of Object.entries(applied.row_gif_buffers)) {
      await writeFile(path.join(itemOutputDir, fileName), buffer)
    }
    await writeFile(reportPath, JSON.stringify(serializeQualityClosureProviderRepairApplyResult(applied), null, 2))
    await writeFile(markdownPath, applied.markdown)
    items.push({
      item_id: itemId,
      output_id: itemOutputSegment,
      output_dir: itemOutputDir,
      input_normalized_sheet: normalizedSheetPath,
      status: applied.status,
      summary: applied.summary,
      semantic_target_results: applied.semantic_target_results,
      validation_gate: applied.validation_gate,
      validation_before: applied.validation_before,
      validation_after: applied.validation_after,
      quality_closure_after: {
        status: applied.quality_closure_after.status,
        release_ready: applied.quality_closure_after.release_ready,
        summary: applied.quality_closure_after.summary,
      },
      files: {
        repaired_normalized_sheet: path.join(itemOutputDir, 'repaired_normalized_sheet.png'),
        validation_report: reportPath,
        markdown_report: markdownPath,
        row_gif_count: Object.keys(applied.row_gif_buffers).length,
      },
    })
  }

  return {
    command: 'benchmark quality-closure-apply-provider-repair',
    run_id: manifest.run_id,
    preset: manifest.preset,
    output_dir: outputDir,
    summary: {
      item_count: items.length,
      repair_count: repairSpecs.length,
      resolved_count: items.flatMap((item) => item.semantic_target_results).filter((item) => item.resolved).length,
      passed_item_count: items.filter((item) => item.status === 'passed').length,
      partial_item_count: items.filter((item) => item.status === 'partial').length,
      needs_followup_item_count: items.filter((item) => item.status === 'needs_followup').length,
    },
    items,
  }
}

async function commandBenchmarkQualityClosureProviderHandoff(options) {
  const manifestPath = option(options, 'manifest')
  if (!manifestPath) throw new Error('benchmark quality-closure-provider-handoff requires --manifest')
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), 'provider_handoff')
  )
  const handoff = buildQualityClosureProviderHandoff(manifest, {
    manifestPath: String(manifestPath),
    taskId: option(options, 'task-id'),
    outputDir,
  })
  const markdown = renderQualityClosureProviderHandoffMarkdown(handoff)

  await mkdir(outputDir, { recursive: true })
  await writeFile(handoff.files.handoff_json, JSON.stringify(handoff, null, 2))
  await writeFile(handoff.files.handoff_md, markdown)
  if (handoff.selected) {
    await writeFile(handoff.files.selected_prompt, handoff.selected.prompt)
    await writeFile(handoff.files.selected_contract, JSON.stringify({
      task_id: handoff.selected.task_id,
      item_id: handoff.selected.item_id,
      action: handoff.selected.action,
      issue: handoff.selected.issue,
      animation: handoff.selected.animation,
      frames: handoff.selected.frames,
      target: handoff.selected.target,
      expected_output: handoff.selected.expected_output,
      artifacts: handoff.selected.artifacts,
      provider_payload: handoff.selected.provider_payload,
      next_apply_command: handoff.selected.next_apply_command,
    }, null, 2))
  }

  return {
    command: 'benchmark quality-closure-provider-handoff',
    run_id: handoff.run_id,
    preset: handoff.preset,
    status: handoff.status,
    selected_task_id: handoff.selected?.task_id ?? null,
    selected_item_id: handoff.selected?.item_id ?? null,
    selected_animation: handoff.selected?.animation ?? null,
    selected_frames: handoff.selected?.frames ?? [],
    candidate_count: handoff.candidates.length,
    output_dir: outputDir,
    files: handoff.files,
    next_apply_command: handoff.selected?.next_apply_command ?? null,
  }
}

function providerRepairLoopImageConfigFromOptions(options) {
  return cleanOptions({
    image_size: option(options, 'image-size'),
    aspect_ratio: option(options, 'aspect-ratio'),
  })
}

function providerRepairLoopMotionTemplateFromOptions(options) {
  if (options['disable-motion-template']) return { enabled: false }
  const templatePath = option(options, 'motion-template') ?? option(options, 'action-template')
  const preset = option(options, 'motion-template-preset', templatePath ? null : FIXED_REGION_MOTION_LAYOUT_ID)
  return cleanOptions({
    enabled: true,
    path: templatePath,
    preset,
    layout: option(options, 'motion-template-layout', preset ?? null),
  })
}

function qualityClosureProviderRepairLoopFiles(plan, { planOnly = false } = {}) {
  const referenceFiles = [
    ...(plan.motion_template?.enabled ? [plan.files.motion_template_reference] : []),
    plan.files.normalized_sheet_reference,
    plan.files.target_animation_reference,
    plan.files.source_sheet_reference,
  ]
  const files = planOnly
    ? [
        plan.files.plan,
        plan.files.prompt,
        ...referenceFiles,
      ]
    : [
        plan.files.plan,
        plan.files.summary,
        plan.files.prompt,
        ...referenceFiles,
        plan.files.raw_provider_output,
        plan.files.repaired_strip,
        plan.files.repaired_normalized_sheet,
        plan.files.validation_report,
        plan.files.markdown_report,
      ]
  return files.filter((file) => file && existsSync(file))
}

async function sourceSheetBufferForPlan(plan) {
  const sourceSheet = plan.preflight?.source_sheet
  return sourceSheet && existsSync(sourceSheet) ? readFile(sourceSheet) : null
}

async function motionTemplateForPlan(plan) {
  const template = plan.motion_template
  if (!template?.enabled) return null
  if (template.path) {
    return {
      buffer: await readFile(String(template.path)),
      name: path.basename(String(template.path)),
      layout: template.layout ?? null,
    }
  }
  if (!template.preset) return null
  const loaded = await loadTemplateImage(template.preset, { rootDir })
  if (!loaded) throw new Error(`motion template preset is unavailable: ${template.preset}`)
  return {
    buffer: loaded.buffer,
    name: loaded.name,
    layout: template.layout ?? template.preset,
  }
}

function compactProviderRepairLoopPlan(plan) {
  return {
    command: 'benchmark quality-closure-provider-repair-loop',
    mode: 'dry_run_plan',
    run_id: plan.run_id,
    preset: plan.preset,
    output_dir: plan.output_dir,
    can_run: plan.can_run,
    preflight: plan.preflight,
    estimated_provider_calls: plan.estimated_provider_calls,
    provider_preset_id: plan.provider_preset_id,
    image_config: plan.image_config,
    motion_template: plan.motion_template,
    selected_task_id: plan.selected?.task_id ?? null,
    selected_animation: plan.selected?.animation ?? null,
    selected_frames: plan.selected?.frames ?? [],
    files: plan.files,
  }
}

function compactProviderRepairLoopResult(plan, result) {
  return {
    command: 'benchmark quality-closure-provider-repair-loop',
    mode: 'live',
    status: result.status,
    run_id: result.run_id,
    preset: result.preset,
    output_dir: plan.output_dir,
    selected_task_id: result.selected_task_id,
    selected_animation: plan.selected?.animation ?? null,
    provider: result.generation?.provider ?? null,
    provider_preset_id: result.generation?.provider_preset_id ?? plan.provider_preset_id,
    model: result.generation?.model ?? null,
    summary: result.summary,
    files: {
      plan: plan.files.plan,
      summary: plan.files.summary,
      prompt: plan.files.prompt,
      normalized_sheet_reference: plan.files.normalized_sheet_reference,
      target_animation_reference: plan.files.target_animation_reference,
      raw_provider_output: result.generation ? plan.files.raw_provider_output : undefined,
      repaired_strip: result.generation ? plan.files.repaired_strip : undefined,
      repaired_normalized_sheet: result.apply_result ? plan.files.repaired_normalized_sheet : undefined,
      validation_report: result.apply_result ? plan.files.validation_report : undefined,
      markdown_report: result.apply_result ? plan.files.markdown_report : undefined,
      row_gif_count: result.apply_result ? Object.keys(result.apply_result.row_gif_buffers ?? {}).length : 0,
    },
  }
}

async function writeProviderRepairLoopReferenceFiles(plan, referenceImages = []) {
  const fileByName = new Map([
    ['motion_template_reference.png', plan.files.motion_template_reference],
    ['normalized_sheet_reference.png', plan.files.normalized_sheet_reference],
    ['target_animation_reference.png', plan.files.target_animation_reference],
    ['source_sheet_reference.png', plan.files.source_sheet_reference],
  ])
  for (const image of referenceImages) {
    const file = fileByName.get(image.name)
    if (file) await writeFile(file, image.buffer)
  }
}

async function writeQualityClosureProviderRepairLoopArtifacts(plan, result) {
  await mkdir(plan.output_dir, { recursive: true })
  await writeFile(plan.files.plan, JSON.stringify(serializeQualityClosureProviderRepairLoopPlan(plan), null, 2))
  if (plan.selected) await writeFile(plan.files.prompt, result.generation?.prompt ?? plan.selected.prompt)
  await writeProviderRepairLoopReferenceFiles(plan, result.reference_images ?? [])

  if (result.generation) {
    await writeFile(plan.files.raw_provider_output, result.generation.raw_provider_png)
    await writeFile(plan.files.repaired_strip, result.generation.repaired_strip_png)
  }

  if (result.apply_result) {
    await mkdir(plan.files.item_output_dir, { recursive: true })
    await writeFile(plan.files.repaired_normalized_sheet, result.apply_result.repaired_normalized_sheet_png)
    for (const [fileName, buffer] of Object.entries(result.apply_result.row_gif_buffers)) {
      await writeFile(path.join(plan.files.item_output_dir, fileName), buffer)
    }
    await writeFile(plan.files.validation_report, JSON.stringify(serializeQualityClosureProviderRepairApplyResult(result.apply_result), null, 2))
    await writeFile(plan.files.markdown_report, result.apply_result.markdown)
  }

  await writeFile(plan.files.summary, JSON.stringify(serializeQualityClosureProviderRepairLoopResult(result), null, 2))
}

async function commandBenchmarkQualityClosureProviderRepairLoop(options) {
  const manifestPath = option(options, 'manifest')
  if (!manifestPath) throw new Error('benchmark quality-closure-provider-repair-loop requires --manifest')
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const loopId = option(options, 'loop-id', makeJobId('provider_repair_loop'))
  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), safePathSegment(loopId))
  )
  const plan = buildQualityClosureProviderRepairLoopPlan({
    manifest,
    taskId: option(options, 'task-id'),
    outputDir,
    providerPresetId: option(options, 'provider-preset'),
    imageConfig: providerRepairLoopImageConfigFromOptions(options),
    backgroundMode: option(options, 'background-mode', 'auto'),
    motionTemplate: providerRepairLoopMotionTemplateFromOptions(options),
  })

  if (options['dry-run-plan']) {
    const collisions = qualityClosureProviderRepairLoopFiles(plan, { planOnly: true })
    if (collisions.length) throw new Error(`quality closure provider repair loop output collision: ${collisions.join(', ')}`)
    await mkdir(plan.output_dir, { recursive: true })
    await writeFile(plan.files.plan, JSON.stringify(serializeQualityClosureProviderRepairLoopPlan(plan), null, 2))
    if (plan.can_run) {
      const normalizedSheetBuffer = await readFile(plan.preflight.normalized_sheet)
      const motionTemplate = await motionTemplateForPlan(plan)
      const referenceImages = await buildQualityClosureProviderRepairReferenceImages({
        task: plan.task,
        normalizedSheetBuffer,
        motionTemplateBuffer: motionTemplate?.buffer ?? null,
        motionTemplateName: motionTemplate?.name ?? undefined,
        motionTemplateLayout: motionTemplate?.layout ?? null,
        sourceSheetBuffer: await sourceSheetBufferForPlan(plan),
      })
      if (plan.selected) await writeFile(plan.files.prompt, plan.selected.prompt)
      await writeProviderRepairLoopReferenceFiles(plan, referenceImages)
    }
    return compactProviderRepairLoopPlan(plan)
  }

  if (!options.yes) {
    throw new Error('benchmark quality-closure-provider-repair-loop uses live provider quota; pass --dry-run-plan to inspect or --yes to continue')
  }
  if (!plan.can_run) throw new Error(`benchmark quality-closure-provider-repair-loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  const collisions = qualityClosureProviderRepairLoopFiles(plan)
  if (collisions.length) throw new Error(`quality closure provider repair loop output collision: ${collisions.join(', ')}`)

  loadLocalEnv()
  const normalizedSheetBuffer = await readFile(plan.preflight.normalized_sheet)
  const motionTemplate = await motionTemplateForPlan(plan)
  const result = await runQualityClosureProviderRepairLoop({
    plan,
    normalizedSheetBuffer,
    motionTemplateBuffer: motionTemplate?.buffer ?? null,
    motionTemplateName: motionTemplate?.name ?? undefined,
    motionTemplateLayout: motionTemplate?.layout ?? null,
    sourceSheetBuffer: await sourceSheetBufferForPlan(plan),
  })
  await writeQualityClosureProviderRepairLoopArtifacts(plan, result)
  return compactProviderRepairLoopResult(plan, result)
}

async function loadRepairManifestFromReport(options, commandName) {
  const reportPath = option(options, 'report')
  if (!reportPath) throw new Error(`${commandName} requires --report`)
  const report = JSON.parse(await readFile(String(reportPath), 'utf8'))
  const manifest = buildTopdownRepairManifestForBenchmarkReport(report)
  return { report, manifest }
}

async function loadRepairTaskFromReport(options, commandName) {
  const taskId = option(options, 'task-id')
  if (!taskId) throw new Error(`${commandName} requires --task-id`)
  const { report, manifest } = await loadRepairManifestFromReport(options, commandName)
  const task = manifest.tasks.find((item) => item.task_id === taskId)
  if (!task) throw new Error(`Unknown topdown repair task id: ${taskId}`)
  return { report, manifest, task }
}

async function commandBenchmarkTopdownGenerateRepairCell(options) {
  const { manifest, task } = await loadRepairTaskFromReport(options, 'benchmark topdown-generate-repair-cell')
  const prompt = buildTopdownRepairCellPrompt(task)
  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'topdown-repairs', manifest.run_id ?? makeJobId('topdown_repair'), safePathSegment(task.task_id))
  )
  await mkdir(outputDir, { recursive: true })
  const generation = {
    schema_version: 1,
    mode: options['dry-run-prompt'] ? 'dry_run_prompt' : 'live',
    task_id: task.task_id,
    run_id: manifest.run_id,
    preset: manifest.preset,
    provider_payload: task.provider_payload,
  }
  await writeFile(path.join(outputDir, 'prompt.txt'), prompt)

  if (options['dry-run-prompt']) {
    await writeFile(path.join(outputDir, 'repair_generation.json'), JSON.stringify(generation, null, 2))
    return {
      command: 'benchmark topdown-generate-repair-cell',
      mode: 'dry_run_prompt',
      run_id: manifest.run_id,
      task_id: task.task_id,
      output_dir: outputDir,
      prompt_file: path.join(outputDir, 'prompt.txt'),
      generation_file: path.join(outputDir, 'repair_generation.json'),
    }
  }

  loadLocalEnv()
  const yes = Boolean(options.yes)
  if (!yes) throw new Error('benchmark topdown-generate-repair-cell uses live provider quota; pass --yes to continue')
  const normalizedSheetPath = task.artifacts?.normalized_sheet
  if (!normalizedSheetPath) throw new Error(`Repair task ${task.task_id} is missing normalized_sheet artifact path`)
  const normalizedSheetBuffer = await readFile(normalizedSheetPath)
  const referenceImages = await buildTopdownRepairReferenceImages({ task, normalizedSheetBuffer })
  const imageConfig = {
    image_size: option(options, 'image-size', task.provider_payload?.image_config?.image_size || process.env.OPENROUTER_IMAGE_SIZE || '2K'),
    aspect_ratio: option(options, 'aspect-ratio', task.provider_payload?.image_config?.aspect_ratio || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '1:1'),
  }
  const generated = await generateTopdownRepairCell({
    task,
    providerPresetId: option(options, 'provider-preset', task.provider_payload?.provider_preset_id ?? process.env.OPENROUTER_BENCHMARK_PROVIDER_PRESET),
    imageConfig,
    referenceImages,
    backgroundMode: option(options, 'background-mode', 'auto'),
  })
  for (const image of referenceImages) {
    await writeFile(path.join(outputDir, image.name), image.buffer)
  }
  await writeFile(path.join(outputDir, 'raw_provider_output.png'), generated.raw_provider_png)
  await writeFile(path.join(outputDir, 'repaired_cell.png'), generated.repaired_cell_png)
  await writeFile(
    path.join(outputDir, 'repair_generation.json'),
    JSON.stringify({
      ...generation,
      provider: generated.provider,
      provider_preset_id: generated.provider_preset_id,
      provider_label: generated.provider_label,
      model: generated.model,
      image_config: generated.image_config,
      input_images: generated.input_images,
      postprocess: generated.postprocess,
    }, null, 2)
  )
  return {
    command: 'benchmark topdown-generate-repair-cell',
    mode: 'live',
    run_id: manifest.run_id,
    task_id: task.task_id,
    output_dir: outputDir,
    provider: generated.provider,
    provider_preset_id: generated.provider_preset_id,
    model: generated.model,
    files: {
      prompt: path.join(outputDir, 'prompt.txt'),
      raw_provider_output: path.join(outputDir, 'raw_provider_output.png'),
      repaired_cell: path.join(outputDir, 'repaired_cell.png'),
      generation: path.join(outputDir, 'repair_generation.json'),
    },
    postprocess: generated.postprocess,
  }
}

function repairLoopImageConfigFromOptions(options) {
  return cleanOptions({
    image_size: option(options, 'image-size'),
    aspect_ratio: option(options, 'aspect-ratio'),
  })
}

function existingPlannedFiles(plan, { planOnly = false } = {}) {
  const files = planOnly
    ? [plan.files.plan]
    : [
        plan.files.summary,
        plan.files.repaired_normalized_sheet,
        plan.files.validation_report,
        ...plan.tasks.flatMap((task) => [
          task.files.prompt,
          task.files.same_animation_reference,
          task.files.raw_provider_output,
          task.files.repaired_cell,
          task.files.generation,
          task.files.generation_error,
        ]),
      ]
  return files.filter((file) => file && existsSync(file))
}

function compactRepairLoopPlan(plan) {
  return {
    command: 'benchmark topdown-repair-loop',
    mode: 'dry_run_plan',
    run_id: plan.run_id,
    preset: plan.preset,
    output_dir: plan.output_dir,
    can_run: plan.can_run,
    preflight: plan.preflight,
    estimated_provider_calls: plan.estimated_provider_calls,
    provider_preset_id: plan.provider_preset_id,
    image_config: plan.image_config,
    input_normalized_sheet: plan.input_normalized_sheet,
    task_ids: plan.tasks.map((task) => task.task_id),
    plan_file: plan.files.plan,
  }
}

function compactRepairLoopResult(plan, result) {
  return {
    command: 'benchmark topdown-repair-loop',
    mode: 'live',
    status: result.status,
    run_id: result.run_id,
    preset: result.preset,
    output_dir: plan.output_dir,
    summary: result.summary,
    validation_gate: result.validation_gate,
    files: {
      plan: plan.files.plan,
      summary: plan.files.summary,
      repaired_normalized_sheet: result.apply_result ? plan.files.repaired_normalized_sheet : undefined,
      validation_report: result.apply_result ? plan.files.validation_report : undefined,
    },
  }
}

async function writeTopdownRepairLoopArtifacts(plan, result) {
  await mkdir(plan.output_dir, { recursive: true })
  await mkdir(path.join(plan.output_dir, 'cells'), { recursive: true })
  await writeFile(plan.files.plan, JSON.stringify(serializeTopdownRepairLoopPlan(plan), null, 2))

  const taskEntries = new Map(plan.tasks.map((task) => [task.task_id, task]))
  for (const generation of result.generation_results) {
    const entry = taskEntries.get(generation.task_id)
    if (!entry) continue
    await mkdir(entry.output_dir, { recursive: true })
    await writeFile(entry.files.prompt, generation.generated?.prompt ?? buildTopdownRepairCellPrompt(entry.task))
    for (const image of generation.reference_images ?? []) {
      await writeFile(path.join(entry.output_dir, image.name), image.buffer)
    }
    if (generation.status === 'generated') {
      await writeFile(entry.files.raw_provider_output, generation.generated.raw_provider_png)
      await writeFile(entry.files.repaired_cell, generation.generated.repaired_cell_png)
      await writeFile(
        entry.files.generation,
        JSON.stringify({
          schema_version: 1,
          mode: 'live',
          status: 'generated',
          run_id: plan.run_id,
          preset: plan.preset,
          task_id: generation.task_id,
          reference_policy: generation.reference_policy,
          provider: generation.generated.provider,
          provider_preset_id: generation.generated.provider_preset_id,
          provider_label: generation.generated.provider_label,
          model: generation.generated.model,
          image_config: generation.generated.image_config,
          input_images: generation.generated.input_images,
          postprocess: generation.generated.postprocess,
        }, null, 2)
      )
    } else {
      await writeFile(
        entry.files.generation_error,
        JSON.stringify({
          schema_version: 1,
          mode: 'live',
          status: 'failed',
          run_id: plan.run_id,
          preset: plan.preset,
          task_id: generation.task_id,
          reference_policy: generation.reference_policy,
          error: generation.error,
        }, null, 2)
      )
    }
  }

  if (result.apply_result) {
    await mkdir(plan.files.item_output_dir, { recursive: true })
    await writeFile(plan.files.repaired_normalized_sheet, result.apply_result.repaired_normalized_sheet_png)
    for (const [fileName, buffer] of Object.entries(result.apply_result.row_gif_buffers)) {
      await writeFile(path.join(plan.files.item_output_dir, fileName), buffer)
    }
    await writeFile(
      plan.files.validation_report,
      JSON.stringify({
        schema_version: result.apply_result.schema_version,
        item_id: plan.tasks[0]?.item_id ?? null,
        output_id: path.basename(plan.files.item_output_dir),
        input_normalized_sheet: plan.input_normalized_sheet,
        applied_tasks: result.apply_result.applied_tasks,
        target_results: result.apply_result.target_results,
        validation_before: result.apply_result.validation_before,
        validation_after: result.apply_result.validation_after,
        validation_gate: result.validation_gate,
        row_gif_count: Object.keys(result.apply_result.row_gif_buffers).length,
      }, null, 2)
    )
  }

  await writeFile(plan.files.summary, JSON.stringify(serializeTopdownRepairLoopResult(result), null, 2))
}

async function commandBenchmarkTopdownRepairLoop(options) {
  const { manifest } = await loadRepairManifestFromReport(options, 'benchmark topdown-repair-loop')
  const loopId = option(options, 'loop-id', makeJobId('topdown_repair_loop'))
  const outputDir = option(
    options,
    'output-dir',
    path.join('generated', 'topdown-repairs', safePathSegment(manifest.run_id ?? 'run'), safePathSegment(loopId))
  )
  const plan = buildTopdownRepairLoopPlan({
    manifest,
    taskIds: optionList(options, 'task-id'),
    itemIds: optionList(options, 'item-id'),
    caseIds: optionList(options, 'case-id'),
    frames: optionList(options, 'frame'),
    actions: optionList(options, 'action'),
    issues: optionList(options, 'issue'),
    limit: optionOptionalPositiveInt(options, 'limit'),
    outputDir,
    providerPresetId: option(options, 'provider-preset'),
    imageConfig: repairLoopImageConfigFromOptions(options),
  })

  if (options['dry-run-plan']) {
    const collisions = existingPlannedFiles(plan, { planOnly: true })
    if (collisions.length) throw new Error(`repair loop output collision: ${collisions.join(', ')}`)
    await mkdir(plan.output_dir, { recursive: true })
    await writeFile(plan.files.plan, JSON.stringify(serializeTopdownRepairLoopPlan(plan), null, 2))
    return compactRepairLoopPlan(plan)
  }

  if (!options.yes) throw new Error('benchmark topdown-repair-loop uses live provider quota; pass --dry-run-plan to inspect or --yes to continue')
  if (!plan.can_run) throw new Error(`benchmark topdown-repair-loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  const collisions = existingPlannedFiles(plan)
  if (collisions.length) throw new Error(`repair loop output collision: ${collisions.join(', ')}`)

  loadLocalEnv()
  const normalizedSheetBuffer = await readFile(plan.input_normalized_sheet)
  const result = await runTopdownRepairLoop({
    plan,
    normalizedSheetBuffer,
    backgroundMode: option(options, 'background-mode', 'auto'),
  })
  await writeTopdownRepairLoopArtifacts(plan, result)
  return compactRepairLoopResult(plan, result)
}

async function commandTilesetBuildTwoPointFiveD(options) {
  const outputDir = option(options, 'output-dir', 'generated/two-point-five-d-tilesets')
  const runId = option(options, 'run-id', 'two_point_five_d_tileset')
  const contractPath = option(options, 'contract')
  const materialSourcePath = option(options, 'material-source') ?? option(options, 'source-image')
  const materialSourcePrompt = option(options, 'generate-source') ?? option(options, 'material-source-prompt') ?? option(options, 'source-prompt')
  const materialLayoutPath = option(options, 'material-layout')
  if (materialSourcePath && materialSourcePrompt) {
    throw new Error('tileset build-two-point-five-d accepts either --material-source or --generate-source, not both')
  }
  const contract = contractPath
    ? JSON.parse(await readFile(contractPath, 'utf8'))
    : DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT
  let materialSource = materialSourcePath
    ? { path: materialSourcePath, buffer: await readFile(materialSourcePath) }
    : null
  let aiMaterialSourceBridge = null
  let providerCallBudget = null
  if (materialSourcePrompt) {
    loadLocalEnv()
    providerCallBudget = providerCallBudgetFromOptions(options, {
      command: 'tileset build-two-point-five-d --generate-source',
      plannedProviderCalls: 1,
    })
    const generatedMaterialSource = await generateTwoPointFiveDMaterialSource({
      description: materialSourcePrompt,
      promptFields: twoPointFiveDMaterialSourcePromptFieldsFromOptions(options),
      contract,
      providerPresetId: option(options, 'provider-preset') ?? option(options, 'provider-preset-id'),
      imageConfig: twoPointFiveDMaterialSourceImageConfigFromOptions(options),
      generationOptions: singleProviderImageGenerationOptionsFromCli(options),
      providerBudget: providerCallBudget.providerBudget,
      env: process.env,
    })
    aiMaterialSourceBridge = generatedMaterialSource.report
    materialSource = {
      id: `${runId}_provider_material_source.png`,
      path: `${runId}_provider_material_source.png`,
      buffer: generatedMaterialSource.buffer,
    }
  }
  const materialSampleLayout = materialLayoutPath
    ? JSON.parse(await readFile(materialLayoutPath, 'utf8'))
    : null
  const mapOptions = parseMapSolverOptions(options)
  const result = await writeTwoPointFiveDTilesetArtifacts({
    contract,
    materialSource,
    materialSourceBridge: aiMaterialSourceBridge,
    materialSampleLayout,
    mapOptions,
    outputDir,
    runId,
  })
  return {
    command: 'tileset build-two-point-five-d',
    status: result.status,
    run_id: result.run_id,
    output_dir: result.output_dir,
    contract_id: result.contract.id,
    contract_version: result.contract.contract_version,
    validation: {
      status: result.validation.status,
      blocking_errors: result.validation.blocking_errors,
      warnings: result.validation.warnings,
      metrics: result.validation.metrics,
    },
    provider_call_budget: providerCallBudget ? publicProviderCallBudget(providerCallBudget) : null,
    ai_material_source_bridge: result.ai_material_source_bridge
      ? {
          status: result.ai_material_source_bridge.status,
          mode: result.ai_material_source_bridge.mode,
          source_role: result.ai_material_source_bridge.source_role,
          provider: result.ai_material_source_bridge.provider,
          provider_preset_id: result.ai_material_source_bridge.provider_preset_id,
          model: result.ai_material_source_bridge.model,
          prompt_contract: result.ai_material_source_bridge.prompt_contract,
          generated_source: result.ai_material_source_bridge.generated_source,
          pipeline_handoff: result.ai_material_source_bridge.pipeline_handoff,
          claim_boundary: result.ai_material_source_bridge.claim_boundary,
        }
      : null,
    pipeline_stages: result.plan.pipeline_stages,
    map_rule: {
      mode: result.map_rule_profile.mode,
      rule_profile_id: result.map_rule_profile.rule_profile_id,
      wfc_scope: result.map_rule_profile.wfc_scope,
      validation: {
        status: result.tile_map_validation.status,
        blocking_errors: result.tile_map_validation.blocking_errors,
        warnings: result.tile_map_validation.warnings,
        metrics: result.tile_map_validation.metrics,
      },
      arrangement: result.tile_map.arrangement,
      constraint_solver: result.constraint_solver_report
        ? {
            mode: result.constraint_solver_report.mode,
            status: result.constraint_solver_report.status,
            algorithm: result.constraint_solver_report.algorithm,
            decision_count: result.constraint_solver_report.decision_count,
            backtrack_count: result.constraint_solver_report.backtrack_count,
            propagation_step_count: result.constraint_solver_report.propagation_step_count,
          }
        : null,
    },
    ldtk_project: {
      status: result.ldtk_project_validation.status,
      metrics: result.ldtk_project_validation.metrics,
      workflow_validation: {
        status: result.ldtk_workflow_validation.status,
        metrics: result.ldtk_workflow_validation.metrics,
        claim_boundary: result.ldtk_workflow_validation.claim_boundary,
      },
      auto_layer_rules: result.metadata.ldtk_project.auto_layer_rules,
      claim_boundary: result.metadata.ldtk_project.claim_boundary,
    },
    map_editor_workflow: {
      status: result.map_editor_workflow.status,
      operation_count: result.map_editor_workflow.operations.length,
      changed_cell_count: result.map_editor_workflow.changed_cell_count,
      claim_boundary: result.map_editor_workflow.claim_boundary,
    },
    workflow_release_evidence: {
      status: result.workflow_release_evidence.status,
      release_ready: result.workflow_release_evidence.release_ready,
      summary: result.workflow_release_evidence.summary,
      claim_boundary: result.workflow_release_evidence.claim_boundary,
    },
    consumer_package_audit: {
      status: result.consumer_package_audit.status,
      metrics: result.consumer_package_audit.metrics,
      claim_boundary: result.consumer_package_audit.claim_boundary,
    },
    import_validation: {
      status: result.import_validation.status,
      static_checks: result.import_validation.static_checks,
      external_editor_probe: result.import_validation.external_editor_probe,
      claim_boundary: result.import_validation.claim_boundary,
    },
    release_demo_pack: {
      status: result.release_demo_manifest.status,
      release_ready: result.release_demo_manifest.release_ready,
      primary_files: result.release_demo_manifest.primary_files,
      claim_boundary: result.release_demo_manifest.claim_boundary,
    },
    external_tool_probe: {
      status: result.external_tool_probe.status,
      availability: result.external_tool_probe.availability,
      claim_boundary: result.external_tool_probe.claim_boundary,
    },
    external_import_smoke: {
      status: result.external_import_smoke.status,
      static_package: result.external_import_smoke.static_package,
      external_tool_smoke: result.external_import_smoke.external_tool_smoke,
      claim_boundary: result.external_import_smoke.claim_boundary,
    },
    external_roundtrip_validation: {
      status: result.external_roundtrip_validation.status,
      ready_for_manual_roundtrip: result.external_roundtrip_validation.ready_for_manual_roundtrip,
      automated_roundtrip: result.external_roundtrip_validation.automated_roundtrip,
      claim_boundary: result.external_roundtrip_validation.claim_boundary,
    },
    source_normalization: result.plan.source_normalization
      ? {
          status: result.plan.source_normalization.status,
          warnings: result.plan.source_normalization.warnings,
        }
      : null,
    material_source: result.plan.material_source
      ? {
          status: result.plan.material_source.status,
          warnings: result.plan.material_source.warnings,
          material_profile_id: result.plan.material_source.material_profile_id,
          extraction: result.plan.material_source.extraction
            ? {
                mode: result.plan.material_source.extraction.mode,
                patch_count: result.plan.material_source.extraction.patch_count,
                palette_limit: result.plan.material_source.extraction.palette_limit ?? null,
                tileability: result.plan.material_source.extraction.tileability ?? null,
                warning_patch_count: result.plan.material_source.extraction.warning_patch_count,
              }
            : null,
          quality_gates: result.plan.material_source.quality_gates,
          semantic_slot_selection: result.plan.material_source.semantic_slot_selection
            ? {
                mode: result.plan.material_source.semantic_slot_selection.mode,
                candidate_count: result.plan.material_source.semantic_slot_selection.candidate_count,
              }
            : null,
          slot_separation: result.plan.material_source.slot_separation
            ? {
                mode: result.plan.material_source.slot_separation.mode,
                status: result.plan.material_source.slot_separation.status,
                initial_warning_count: result.plan.material_source.slot_separation.initial_warning_count,
                remaining_warning_count: result.plan.material_source.slot_separation.remaining_warning_count,
                changed_slot_count: result.plan.material_source.slot_separation.changed_slot_count,
              }
            : null,
          layout_selection: result.plan.material_source.layout_selection
            ? {
                mode: result.plan.material_source.layout_selection.mode,
                selected_id: result.plan.material_source.layout_selection.selected.id,
                selected_score: result.plan.material_source.layout_selection.selected.score,
                candidate_count: result.plan.material_source.layout_selection.candidates.length,
              }
            : null,
        }
      : null,
    material_source_guidance: result.plan.material_source_guidance
      ? {
          status: result.plan.material_source_guidance.status,
          issue_count: result.plan.material_source_guidance.issues.length,
        }
      : null,
    artifacts: result.artifacts,
  }
}

async function commandTilesetMaterialSourceEvidence(options) {
  const manifestPath = option(options, 'manifest')
  const outputDir = option(options, 'output-dir', 'generated/two-point-five-d-material-source-evidence')
  const runId = option(options, 'run-id', makeJobId('material_source_evidence'))
  const report = await runMaterialSourceEvidenceGate({
    manifestPath,
    outputDir,
    runId,
    sampleIds: optionList(options, 'sample-id'),
  })
  return {
    command: 'tileset material-source-evidence',
    status: report.quality_gate.status,
    run_id: report.run_id,
    output_dir: report.output_dir,
    manifest_validation: report.manifest_validation.summary,
    summary: report.summary,
    quality_gate: {
      status: report.quality_gate.status,
      gates: report.quality_gate.gates,
    },
    quality_closure: report.quality_closure,
    items: report.items.map((item) => ({
      id: item.id,
      status: item.status,
      warnings: item.warnings,
      blocking_errors: item.blocking_errors,
      patch_count: item.metrics?.patch_count ?? null,
      warning_patch_count: item.metrics?.warning_patch_count ?? null,
      layout_selected_id: item.metrics?.layout_selected_id ?? null,
      layout_selected_score: item.metrics?.layout_selected_score ?? null,
      semantic_slot_selection: item.material_source?.semantic_slot_selection
        ? {
            mode: item.material_source.semantic_slot_selection.mode,
            candidate_count: item.material_source.semantic_slot_selection.candidate_count,
          }
        : null,
      slot_separation: item.material_source?.slot_separation
        ? {
            mode: item.material_source.slot_separation.mode,
            status: item.material_source.slot_separation.status,
            initial_warning_count: item.material_source.slot_separation.initial_warning_count,
            remaining_warning_count: item.material_source.slot_separation.remaining_warning_count,
            changed_slot_count: item.material_source.slot_separation.changed_slot_count,
          }
        : null,
      contact_sheet: item.artifacts?.evidence_contact_sheet_png ?? null,
    })),
    artifacts: {
      report_json: path.join(report.output_dir, 'material_source_evidence_gate.json'),
      report_md: path.join(report.output_dir, 'material_source_evidence_gate.md'),
    },
  }
}

async function commandTilesetMaterialSourceBenchmark(options) {
  loadLocalEnv()
  const outputDir = option(options, 'output-dir', DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_DIR)
  const runId = option(options, 'run-id', makeJobId('material_source_benchmark'))
  const providerPresetId = option(options, 'provider-preset') ?? option(options, 'provider-preset-id') ?? process.env.TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROVIDER_PRESET ?? ''
  const contractPath = option(options, 'contract')
  const materialLayoutPath = option(options, 'material-layout')
  const contract = contractPath
    ? JSON.parse(await readFile(contractPath, 'utf8'))
    : DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT
  const materialSampleLayout = materialLayoutPath
    ? JSON.parse(await readFile(materialLayoutPath, 'utf8'))
    : null
  const plan = buildTwoPointFiveDMaterialSourceBenchmarkPlan({
    runId,
    outputDir,
    description: option(options, 'description') ?? option(options, 'generate-source') ?? option(options, 'material-source-prompt'),
    caseIds: optionList(options, 'case-id'),
    sampleSize: options['sample-size'] ? optionPositiveInt(options, 'sample-size') : undefined,
    providerPresetId,
    candidateCount: optionPositiveInt(options, 'candidate-count', 3),
    imageConfig: cleanOptions({
      image_size: option(options, 'source-image-size') ?? option(options, 'image-size') ?? process.env.TWO_POINT_FIVE_D_MATERIAL_SOURCE_IMAGE_SIZE ?? process.env.OPENROUTER_IMAGE_SIZE ?? process.env.GEMINI_IMAGE_SIZE ?? '2K',
      aspect_ratio: option(options, 'source-aspect-ratio') ?? option(options, 'aspect-ratio') ?? process.env.TWO_POINT_FIVE_D_MATERIAL_SOURCE_ASPECT_RATIO ?? process.env.OPENROUTER_IMAGE_ASPECT_RATIO ?? process.env.GEMINI_IMAGE_ASPECT_RATIO ?? '1:1',
    }),
    generationOptions: singleProviderImageGenerationOptionsFromCli(options),
    contract,
    materialSampleLayout,
    mapOptions: parseMapSolverOptions(options),
  })
  const providerConfig = publicTwoPointFiveDMaterialSourceProviderConfig(providerPresetId, plan.image_config)
  const planEvidence = {
    ...plan,
    provider_config: providerConfig,
  }

  if (options['dry-run-plan']) {
    await mkdir(plan.output_dir, { recursive: true })
    await writeFile(path.join(plan.output_dir, 'material_source_benchmark_plan.json'), JSON.stringify(planEvidence, null, 2))
    return {
      command: 'tileset material-source-benchmark',
      mode: 'dry_run_plan',
      run_id: plan.run_id,
      output_dir: plan.output_dir,
      estimated_provider_calls: plan.estimated_provider_calls,
      case_ids: plan.cases.map((item) => item.id),
      candidate_count: plan.candidate_count,
      provider_config: providerConfig,
      plan_file: path.join(plan.output_dir, 'material_source_benchmark_plan.json'),
    }
  }

  const yes = Boolean(options.yes) || process.env.TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_CONFIRM === '1'
  if (!yes) {
    throw new Error('tileset material-source-benchmark uses live provider quota; pass --dry-run-plan to inspect or --yes to continue')
  }
  const providerCallBudget = providerCallBudgetFromOptions(options, {
    command: 'tileset material-source-benchmark',
    plannedProviderCalls: plan.estimated_provider_calls,
  })
  const report = await runTwoPointFiveDMaterialSourceBenchmark({
    plan: planEvidence,
    providerBudget: providerCallBudget.providerBudget,
  })
  return {
    command: 'tileset material-source-benchmark',
    mode: 'live',
    status: report.status,
    run_id: report.run_id,
    output_dir: report.output_dir,
    candidate_count: report.plan.candidate_count,
    estimated_provider_calls: report.plan.estimated_provider_calls,
    provider_config: providerConfig,
    provider_call_budget: publicProviderCallBudget(providerCallBudget),
    summary: report.summary,
    cases: report.cases.map((item) => ({
      id: item.id,
      candidate_count: item.candidates.length,
      selected_candidate_id: item.candidate_selection.selected_candidate_id,
      selected_status: item.candidate_selection.selected_status,
      ranking: item.candidate_selection.ranking.map((candidate) => ({
        id: candidate.id,
        status: candidate.status,
        warning_count: candidate.warnings?.length ?? 0,
        blocking_error_count: candidate.blocking_errors?.length ?? 0,
        score: candidate.score,
        output_dir: candidate.output_dir,
      })),
    })),
    artifacts: {
      plan_json: path.join(report.output_dir, 'material_source_benchmark_plan.json'),
      report_json: path.join(report.output_dir, 'material_source_benchmark.json'),
      report_md: path.join(report.output_dir, 'material_source_benchmark.md'),
    },
    claim_boundary: report.claim_boundary,
  }
}

async function latestTwoPointFiveDMaterialSourceBenchmarkReport(root) {
  if (!existsSync(root)) {
    throw new Error(`tileset material-source-benchmark-review could not find benchmark root: ${root}`)
  }
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = []
  let dryRunPlanCount = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const runDir = path.join(root, entry.name)
    const reportPath = path.join(runDir, 'material_source_benchmark.json')
    if (existsSync(reportPath)) {
      const reportStat = await stat(reportPath)
      candidates.push({ reportPath, mtimeMs: reportStat.mtimeMs, runDir })
      continue
    }
    if (existsSync(path.join(runDir, 'material_source_benchmark_plan.json'))) {
      dryRunPlanCount += 1
    }
  }
  if (!candidates.length) {
    if (dryRunPlanCount > 0) {
      throw new Error(`tileset material-source-benchmark-review found ${dryRunPlanCount} dry-run plan(s) under ${root} but no material_source_benchmark.json; run a live material-source benchmark first`)
    }
    throw new Error(`tileset material-source-benchmark-review could not find completed material-source benchmark reports under ${root}`)
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.runDir.localeCompare(a.runDir))
  return candidates[0].reportPath
}

async function commandTilesetMaterialSourceBenchmarkReview(options) {
  if (options.latest && (options.report || options.input || options['run-dir'])) {
    throw new Error('tileset material-source-benchmark-review --latest cannot be combined with --report, --input, or --run-dir')
  }
  const runDir = option(options, 'run-dir')
  const reportPath = options.latest
    ? await latestTwoPointFiveDMaterialSourceBenchmarkReport(option(options, 'benchmark-root', DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_DIR))
    : option(options, 'report') ?? option(options, 'input') ?? (runDir ? path.join(runDir, 'material_source_benchmark.json') : null)
  if (!reportPath) throw new Error('tileset material-source-benchmark-review requires --report, --run-dir, or --latest')
  if (!existsSync(reportPath)) {
    const planPath = runDir ? path.join(runDir, 'material_source_benchmark_plan.json') : null
    if (planPath && existsSync(planPath)) {
      throw new Error(`tileset material-source-benchmark-review found only a dry-run plan in ${runDir}; run the live material-source benchmark first, then review material_source_benchmark.json`)
    }
    throw new Error(`tileset material-source-benchmark-review could not find report: ${reportPath}`)
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  const outputDir = option(options, 'output-dir', path.dirname(reportPath))
  await mkdir(outputDir, { recursive: true })
  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const markdown = renderTwoPointFiveDMaterialSourceBenchmarkReviewMarkdown(review)
  const html = renderTwoPointFiveDMaterialSourceBenchmarkReviewHtml(review)
  const png = await renderTwoPointFiveDMaterialSourceBenchmarkReviewPng(review)
  const jsonPath = path.join(outputDir, 'material_source_benchmark_review.json')
  const markdownPath = path.join(outputDir, 'material_source_benchmark_review.md')
  const htmlPath = path.join(outputDir, 'material_source_benchmark_review.html')
  const pngPath = path.join(outputDir, 'material_source_benchmark_review.png')
  await writeFile(jsonPath, JSON.stringify(review, null, 2))
  await writeFile(markdownPath, markdown)
  await writeFile(htmlPath, html)
  await writeFile(pngPath, png)
  return {
    command: 'tileset material-source-benchmark-review',
    mode: 'provider_free_review',
    source_report: reportPath,
    output_dir: outputDir,
    review_status: review.status,
    release_ready: review.release_ready,
    next_action: review.decision.next_action,
    priority: review.decision.priority,
    summary: review.summary,
    artifacts: {
      review_json: jsonPath,
      review_md: markdownPath,
      review_html: htmlPath,
      review_png: pngPath,
    },
    claim_boundary: review.claim_boundary,
  }
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2))
  const command = positional[0]
  if (command === 'process') return commandProcess(options)
  if (command === 'generate') return commandGenerate(options)
  if (command === 'project' && positional[1] === 'pack') return commandProjectPack(options)
  if (command === 'motion-source' && positional[1] === 'build-strip') return commandMotionSourceBuildStrip(positional, options)
  if (command === 'motion-source' && positional[1] === 'apply-strip') return commandMotionSourceApplyStrip(options)
  if (command === 'motion-source' && positional[1] === 'analyze-set') return commandMotionSourceAnalyzeSet(positional, options)
  if (command === 'motion-source' && positional[1] === 'apply-set') return commandMotionSourceApplySet(options)
  if (command === 'scene' && positional[1] === 'tile-prompt') return commandSceneTilePrompt(options)
  if (command === 'scene' && positional[1] === 'tile-ingest') return commandSceneTileIngest(options)
  if (command === 'scene' && positional[1] === 'tile-generate') return commandSceneTileGenerate(options)
  if (command === 'tileset' && positional[1] === 'build-two-point-five-d') return commandTilesetBuildTwoPointFiveD(options)
  if (command === 'tileset' && positional[1] === 'material-source-evidence') return commandTilesetMaterialSourceEvidence(options)
  if (command === 'tileset' && positional[1] === 'material-source-benchmark') return commandTilesetMaterialSourceBenchmark(options)
  if (command === 'tileset' && positional[1] === 'material-source-benchmark-review') return commandTilesetMaterialSourceBenchmarkReview(options)
  if (command === 'benchmark' && positional[1] === 't2i-golden') return commandBenchmarkT2iGolden(options)
  if (command === 'benchmark' && positional[1] === 't2i-golden-review') return commandBenchmarkT2iGoldenReview(options)
  if (command === 'benchmark' && positional[1] === 'openrouter') return commandBenchmarkOpenRouter(options)
  if (command === 'benchmark' && positional[1] === 'openrouter-recompute-report') return commandBenchmarkOpenRouterRecomputeReport(options)
  if (command === 'benchmark' && positional[1] === 'topdown-quality-closure') return commandBenchmarkTopdownQualityClosure(options)
  if (command === 'benchmark' && positional[1] === 'topdown-repair-plan') return commandBenchmarkTopdownRepairPlan(options)
  if (command === 'benchmark' && positional[1] === 'topdown-repair-manifest') return commandBenchmarkTopdownRepairManifest(options)
  if (command === 'benchmark' && positional[1] === 'quality-closure-repair-manifest') return commandBenchmarkQualityClosureRepairManifest(options)
  if (command === 'benchmark' && positional[1] === 'quality-closure-repair-loop') return commandBenchmarkQualityClosureRepairLoop(options)
  if (command === 'benchmark' && positional[1] === 'quality-closure-provider-handoff') return commandBenchmarkQualityClosureProviderHandoff(options)
  if (command === 'benchmark' && positional[1] === 'quality-closure-apply-provider-repair') return commandBenchmarkQualityClosureApplyProviderRepair(options)
  if (command === 'benchmark' && positional[1] === 'quality-closure-provider-repair-loop') return commandBenchmarkQualityClosureProviderRepairLoop(options)
  if (command === 'benchmark' && positional[1] === 'topdown-generate-repair-cell') return commandBenchmarkTopdownGenerateRepairCell(options)
  if (command === 'benchmark' && positional[1] === 'topdown-repair-loop') return commandBenchmarkTopdownRepairLoop(options)
  if (command === 'benchmark' && positional[1] === 'topdown-apply-repair') return commandBenchmarkTopdownApplyRepair(options)
  if (command === 'benchmark' && positional[1] === 'processed') return commandBenchmarkProcessed(options)
  if (command === 'benchmark' && positional[1] === 'local-images') return commandBenchmarkLocalImages(options)
  if (command === 'benchmark' && positional[1] === 'local-images-validate') return commandBenchmarkLocalImagesValidate(options)
  if (command === 'benchmark' && positional[1] === 'local-images-add') return commandBenchmarkLocalImagesAdd(options)
  if (command === 'benchmark' && positional[1] === 'scene-tile-report') return commandBenchmarkSceneTileReport(options)
  if (command === 'benchmark' && positional[1] === 'scene-tile-correction-matrix') return commandBenchmarkSceneTileCorrectionMatrix(options)
  if (command === 'benchmark' && positional[1] === 'scene-tile-manual-prompts') return commandBenchmarkSceneTileManualPrompts(options)
  if (command === 'benchmark' && positional[1] === 'scene-tile-manual-retest') return commandBenchmarkSceneTileManualRetest(options)
  if (command === 'benchmark' && positional[1] === 'scene-tile-live-gate') return commandBenchmarkSceneTileLiveGate(options)
  throw new Error('Usage: character-pack-cli.mjs <process|generate|project pack|motion-source build-strip|motion-source apply-strip|motion-source analyze-set|motion-source apply-set|scene tile-prompt|scene tile-ingest|scene tile-generate|tileset build-two-point-five-d|tileset material-source-evidence|tileset material-source-benchmark|tileset material-source-benchmark-review|benchmark t2i-golden|benchmark t2i-golden-review|benchmark openrouter|benchmark openrouter-recompute-report|benchmark topdown-quality-closure|benchmark topdown-repair-plan|benchmark topdown-repair-manifest|benchmark quality-closure-repair-manifest|benchmark quality-closure-repair-loop|benchmark quality-closure-provider-handoff|benchmark quality-closure-apply-provider-repair|benchmark quality-closure-provider-repair-loop|benchmark topdown-generate-repair-cell|benchmark topdown-repair-loop|benchmark topdown-apply-repair|benchmark processed|benchmark local-images|benchmark local-images-validate|benchmark local-images-add|benchmark scene-tile-report|benchmark scene-tile-correction-matrix|benchmark scene-tile-manual-prompts|benchmark scene-tile-manual-retest|benchmark scene-tile-live-gate> [options]')
}

try {
  const result = await main()
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(String(error.message || error))
  process.exit(2)
}
