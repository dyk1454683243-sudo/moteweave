import { access } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import {
  buildSceneTilePromptContract,
  compileSceneTilePromptContract,
  summarizeSceneTilePromptContract,
} from '../tilePromptContracts.js'
import { TOPDOWN_TILE_DUAL_GRID_V0 } from '../tileProfile.js'
import { selectSceneTileGateCases } from './sceneTileLiveGate.js'

const DEFAULT_MANUAL_INPUT_DIR = '/tmp/scene-tile-gemini-v06-sheets'
const REQUIRED_MANUAL_IMAGE = Object.freeze({
  format: 'png',
  width: TOPDOWN_TILE_DUAL_GRID_V0.source.sheet.w,
  height: TOPDOWN_TILE_DUAL_GRID_V0.source.sheet.h,
})

function safePathSegment(value, fallback = 'scene') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

export function buildSceneTileManualPromptPack({
  runId = 'scene_tile_manual_prompts',
  outputDir = 'generated/scene-tile-manual-prompts',
  inputDir = DEFAULT_MANUAL_INPUT_DIR,
  caseIds = [],
  sampleSize,
} = {}) {
  const cases = selectSceneTileGateCases({ caseIds, sampleSize })
  const promptCases = cases.map((item) => {
    const id = safePathSegment(item.id)
    const contract = buildSceneTilePromptContract({ description: item.description })
    const prompt = compileSceneTilePromptContract(contract)
    return {
      id,
      description: item.description,
      prompt,
      prompt_file: `${id}/prompt.txt`,
      generation_file: `${id}/generation.json`,
      expected_input_filename: `${id}_192.png`,
      expected_input_file: path.join(inputDir, `${id}_192.png`),
      prompt_contract: summarizeSceneTilePromptContract(contract),
    }
  })
  const promptContract = promptCases[0]?.prompt_contract ?? summarizeSceneTilePromptContract(buildSceneTilePromptContract())
  return {
    schema_version: 1,
    mode: 'scene_tile_manual_prompt_pack_v0',
    run_id: runId,
    output_dir: path.join(outputDir, runId),
    input_dir: inputDir,
    handoff_file: 'manual_handoff.md',
    required_image: REQUIRED_MANUAL_IMAGE,
    prompt_contract: promptContract,
    cases: promptCases,
  }
}

export function renderSceneTileManualHandoff(pack) {
  const required = pack.required_image ?? REQUIRED_MANUAL_IMAGE
  const lines = [
    '# Scene Tile Manual Handoff',
    '',
    `Prompt contract: ${pack.prompt_contract.contract_version}`,
    '',
    'For each case, paste the matching prompt.txt into the external image model.',
    'Save only the returned tile source sheet image. Do not save a chat screenshot or preview card.',
    '',
    'Required output contract:',
    '',
    `- Format: true ${required.format.toUpperCase()} image data.`,
    `- Size: exactly ${required.width}x${required.height} pixels.`,
    '- Filename: use the expected filename exactly.',
    '- Do not save JPEG data with a .png filename.',
    '- Do not upscale to 1024x1024, 1K, or any display-preview size.',
    '- Do not include labels, mask numbers, grid captions, page borders, or extra whitespace.',
    '',
    '| Case | Prompt file | Save output as |',
    '|---|---|---|',
    ...pack.cases.map((item) => `| ${item.id} | ${item.prompt_file} | ${item.expected_input_file} |`),
    '',
  ]
  return lines.join('\n')
}

export function buildSceneTileManualRetestPlan({
  inputDir = DEFAULT_MANUAL_INPUT_DIR,
  outputDir = 'generated/scene-tile-correction-matrix',
  runId = 'gemini_manual_scene_tile_v06_raw_quality_20260617',
  caseIds = [],
  sampleSize,
  width = 3,
  height = 3,
  pattern = 'rule',
  seed = 7,
  density = 0.55,
  gatePolicy = { raw_tile_quality: 'strict' },
  styleCorrection = { mode: 'palette_snap', maxColors: 16 },
  edgeConditioning = { enabled: true, band: 3, mode: 'edge-aware-v1' },
} = {}) {
  const promptPack = buildSceneTileManualPromptPack({ inputDir, caseIds, sampleSize })
  const cases = promptPack.cases.map((item) => ({
    id: item.id,
    description: item.description,
    expected_input_filename: item.expected_input_filename,
    input_file: path.join(inputDir, item.expected_input_filename),
  }))
  return {
    schema_version: 1,
    mode: 'scene_tile_manual_retest_plan_v0',
    run_id: runId,
    input_dir: inputDir,
    output_dir: path.join(outputDir, runId),
    matrix_output_dir: outputDir,
    prompt_contract: promptPack.prompt_contract,
    cases,
    matrix_inputs: cases.map((item) => ({ file: item.input_file, id: item.id })),
    matrix_options: {
      width,
      height,
      pattern,
      seed,
      density,
      gatePolicy,
      styleCorrection,
      edgeConditioning,
    },
  }
}

async function fileExists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function inspectManualImageFile(file) {
  let metadata
  try {
    metadata = await sharp(file).metadata()
  } catch (error) {
    return {
      valid: false,
      blocking_errors: ['source_sheet_unreadable_image'],
      actual_format: null,
      actual_size: null,
      message: error?.message,
    }
  }

  const blockingErrors = []
  if (metadata.format !== REQUIRED_MANUAL_IMAGE.format) blockingErrors.push('source_sheet_format_mismatch')
  if (metadata.width !== REQUIRED_MANUAL_IMAGE.width || metadata.height !== REQUIRED_MANUAL_IMAGE.height) {
    blockingErrors.push('source_sheet_size_mismatch')
  }
  return {
    valid: blockingErrors.length === 0,
    blocking_errors: blockingErrors,
    actual_format: metadata.format ?? null,
    actual_size: { width: metadata.width ?? null, height: metadata.height ?? null },
  }
}

export async function inspectSceneTileManualRetestInputs(options = {}) {
  const plan = buildSceneTileManualRetestPlan(options)
  const existing = []
  const missingInputs = []
  const invalidInputs = []
  for (const item of plan.cases) {
    if (await fileExists(item.input_file)) {
      existing.push(item)
      const inspection = await inspectManualImageFile(item.input_file)
      if (!inspection.valid) invalidInputs.push({ ...item, ...inspection })
    } else {
      missingInputs.push(item)
    }
  }
  const status = invalidInputs.length ? 'invalid_inputs' : missingInputs.length ? 'missing_inputs' : 'ready'
  return {
    ...plan,
    status,
    ready: status === 'ready',
    existing_input_count: existing.length,
    missing_input_count: missingInputs.length,
    invalid_input_count: invalidInputs.length,
    missing_inputs: missingInputs,
    invalid_inputs: invalidInputs,
  }
}
