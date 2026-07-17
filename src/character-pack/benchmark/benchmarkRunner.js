import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { processSheetBuffer } from '../processSheet.js'
import { probeCharacterPackZip } from './godotProbe.js'

function buildRunId(date = new Date()) {
  return `bench_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function exportAvailability(result) {
  return {
    json_grid: { available: Boolean(result.files?.godotNpcZipBuffer) },
    rpgmaker_v0: { available: Boolean(result.files?.rpgmakerZipBuffer) },
    ocad_v0: { available: Boolean(result.files?.ocadZipBuffer) },
  }
}

function summarizeResult(input, result) {
  const validation = result.debugReport.validation
  return {
    input,
    processing: {
      status: validation.status === 'fail' ? 'failed_post_processing' : 'done',
      id: result.id,
      background_mode: result.debugReport.background_mode,
    },
    validation: {
      status: validation.status,
      warnings: validation.warnings,
      blocking_errors: validation.blocking_errors,
      metrics: validation.metrics,
    },
    exports: exportAvailability(result),
  }
}

export async function buildGodotProbeSummary(result) {
  return {
    json_grid: await probeCharacterPackZip({
      exportZipBuffer: result.files?.godotNpcZipBuffer,
      targetId: result.id,
      root: 'res://AI资源库/一图全动作',
    }),
    rpgmaker_v0: await probeCharacterPackZip({
      exportZipBuffer: result.files?.rpgmakerZipBuffer,
      targetId: `${result.id}_rpgmaker`,
      root: 'res://AI资源库/RPGMAKER',
      generatorPath: 'res://addons/npc_library_tool/core/rpgmaker_spritesheet_generator.gd',
      expectedAnimations: ['rundown', 'runleft', 'runright', 'runup'],
    }),
    ocad_v0: await probeCharacterPackZip({
      exportZipBuffer: result.files?.ocadZipBuffer,
      targetId: `${result.id}_ocad`,
      root: 'res://AI资源库/一图全动作',
      generatorPath: 'res://addons/npc_library_tool/core/ocad_spritesheet_generator.gd',
      expectedAnimations: ['idledown', 'walkdown', 'walkL', 'walkup'],
    }),
  }
}

export async function runCharacterPackBenchmark({ inputs, outputDir = 'generated/benchmarks', runId = buildRunId(), runGodotProbe = false } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('benchmark inputs are required')
  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })
  const items = []
  for (const input of inputs) {
    const buffer = await readFile(input.path)
    const result = await processSheetBuffer(buffer, {
      name: input.name ?? path.basename(input.path, path.extname(input.path)),
      description: input.description ?? '',
      sourceFileName: path.basename(input.path),
      backgroundMode: input.backgroundMode ?? 'auto',
    })
    const item = summarizeResult({ path: input.path, name: input.name ?? path.basename(input.path) }, result)
    if (runGodotProbe) item.godot_probe = await buildGodotProbeSummary(result)
    items.push(item)
  }
  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    items,
  }
  await writeFile(path.join(runDir, 'benchmark_report.json'), JSON.stringify(report, null, 2))
  return report
}
