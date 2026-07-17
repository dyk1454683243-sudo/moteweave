import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { writeScenePackArtifacts } from '../artifactWriter.js'
import { generateSceneTilePack } from '../tileGenerate.js'
import { buildSceneTileReport } from './sceneTileReport.js'

const MAX_SCENE_TILE_CANDIDATES = 8

export const DEFAULT_SCENE_TILE_GATE_CASES = Object.freeze([
  {
    id: 'mossy_forest_ground',
    description: 'mossy forest ground dual-grid tiles, reusable topdown terrain, no characters',
  },
  {
    id: 'dry_cliff_path',
    description: 'dry rocky cliff path dual-grid tiles, reusable topdown terrain, no characters',
  },
  {
    id: 'snowy_ruins_floor',
    description: 'snowy ruined stone floor dual-grid tiles, reusable topdown terrain, no characters',
  },
  {
    id: 'wet_cave_floor',
    description: 'wet cave floor dual-grid tiles with shallow puddles, reusable topdown terrain, no characters',
  },
  {
    id: 'village_dirt_road',
    description: 'village dirt road and grass dual-grid tiles, reusable topdown terrain, no characters',
  },
])

function safePathSegment(value, fallback = 'scene') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function normalizeCandidateCount(value) {
  const count = Number(value ?? 1)
  if (!Number.isInteger(count) || count < 1) throw new Error('candidateCount must be a positive integer')
  if (count > MAX_SCENE_TILE_CANDIDATES) throw new Error(`candidateCount must be ${MAX_SCENE_TILE_CANDIDATES} or less`)
  return count
}

export function selectSceneTileGateCases({ caseIds = [], sampleSize } = {}) {
  const requested = Array.isArray(caseIds) ? caseIds.filter(Boolean).map(String) : []
  const byId = new Map(DEFAULT_SCENE_TILE_GATE_CASES.map((item) => [item.id, item]))
  if (requested.length) {
    const missing = requested.filter((id) => !byId.has(id))
    if (missing.length) throw new Error(`Unknown scene tile gate case id: ${missing.join(', ')}`)
    return requested.map((id) => byId.get(id))
  }
  const limit = sampleSize === undefined ? DEFAULT_SCENE_TILE_GATE_CASES.length : Number(sampleSize)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('sampleSize must be a positive integer')
  return DEFAULT_SCENE_TILE_GATE_CASES.slice(0, limit)
}

export function buildSceneTileLiveGatePlan({
  runId = 'scene_tile_live_gate',
  caseIds,
  sampleSize,
  outputDir = 'generated/scene-tile-live-gates',
  providerPresetId,
  imageConfig = {},
  candidateCount = 1,
  gatePolicy = { raw_tile_quality: 'strict' },
  styleCorrection,
  edgeConditioning,
  width = 3,
  height = 3,
  pattern = 'rule',
  seed = 7,
  density = 0.55,
} = {}) {
  const cases = selectSceneTileGateCases({ caseIds, sampleSize })
  const resolvedCandidateCount = normalizeCandidateCount(candidateCount)
  return {
    schema_version: 1,
    run_id: runId,
    output_dir: path.join(outputDir, runId),
    provider_preset_id: providerPresetId ?? null,
    image_config: imageConfig,
    scene_options: {
      width,
      height,
      pattern,
      seed,
      density,
      candidate_count: resolvedCandidateCount,
      gate_policy: gatePolicy,
      style_correction: styleCorrection ?? null,
      edge_conditioning: edgeConditioning ?? null,
    },
    estimated_provider_calls: cases.length * resolvedCandidateCount,
    cases: cases.map((item, index) => ({
      ...item,
      item_id: `${safePathSegment(item.id)}_v1`,
      seed: Number(seed) + index,
    })),
  }
}

export async function runSceneTileLiveGate({
  plan,
  env = process.env,
  fetchImpl = globalThis.fetch,
  providerBudget = null,
} = {}) {
  if (!plan) throw new Error('plan is required')
  await mkdir(plan.output_dir, { recursive: true })
  const itemOutputDir = path.join(plan.output_dir, 'items')
  await mkdir(itemOutputDir, { recursive: true })
  const items = []
  const sceneDirs = []

  for (const item of plan.cases) {
    const result = await generateSceneTilePack({
      description: item.description,
      providerPresetId: plan.provider_preset_id,
      imageConfig: plan.image_config,
      candidateCount: plan.scene_options.candidate_count,
      providerBudget,
      env,
      fetchImpl,
      projectId: plan.run_id,
      identifier: item.id,
      width: plan.scene_options.width,
      height: plan.scene_options.height,
      pattern: plan.scene_options.pattern,
      seed: item.seed,
      density: plan.scene_options.density,
      gatePolicy: plan.scene_options.gate_policy,
      styleCorrection: plan.scene_options.style_correction ?? undefined,
      edgeConditioning: plan.scene_options.edge_conditioning ?? undefined,
    })
    const written = await writeScenePackArtifacts({
      jobId: item.item_id,
      outputDir: itemOutputDir,
      result,
    })
    sceneDirs.push(written.dir)
    items.push({
      case: item,
      output_dir: written.dir,
      status: written.status,
      quality_gate: result.qualityGate,
      candidate_selection: result.candidateSelection,
      urls: written.urls,
    })
  }

  const report = await buildSceneTileReport({ sceneDirs, runId: plan.run_id })
  return {
    schema_version: 1,
    run_id: plan.run_id,
    output_dir: plan.output_dir,
    plan,
    items,
    report,
    summary: report.summary,
  }
}
