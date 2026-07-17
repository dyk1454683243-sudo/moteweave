#!/usr/bin/env node
import { runProcessedSampleBenchmark } from '../src/character-pack/benchmark/processedSampleBenchmark.js'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function parseOptionalPositiveInt(name) {
  const raw = argValue(name, null)
  if (raw === null) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

const rootDir = argValue('--root-dir', 'generated')
const outputDir = argValue('--output-dir', 'generated/processed-sample-benchmarks')
const runId = argValue('--run-id', undefined)
const limit = parseOptionalPositiveInt('--limit')

const report = await runProcessedSampleBenchmark({
  rootDir,
  outputDir,
  runId,
  limit,
})

console.log(
  JSON.stringify(
    {
      run_id: report.run_id,
      output_dir: `${outputDir}/${report.run_id}`,
      total: report.summary.total,
      validation: report.summary.validation,
      failure_modes: report.summary.failure_modes,
      pass_rate: report.summary.pass_rate,
      usable_rate: report.summary.usable_rate,
    },
    null,
    2
  )
)
