#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'

import {
  DEFAULT_OPENROUTER_BENCHMARK_CASES,
  runOpenRouterCharacterBenchmark,
  selectOpenRouterBenchmarkCases,
} from '../src/character-pack/benchmark/openRouterBenchmark.js'
import { DEFAULT_GENERATION_PRESET } from '../src/character-pack/generationDefaults.js'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  const lines = readFileSync('.env', 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (process.env[key]) continue
    process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function argValues(name) {
  const values = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) values.push(process.argv[i + 1])
  }
  return values
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function parsePositiveInt(name, fallback) {
  const value = Number(argValue(name, fallback))
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

loadLocalEnv()

const sampleSize = parsePositiveInt('--sample-size', process.env.OPENROUTER_BENCHMARK_SAMPLE_SIZE || '20')
const variants = parsePositiveInt('--variants', process.env.OPENROUTER_BENCHMARK_VARIANTS || '1')
const yes = hasFlag('--yes') || process.env.OPENROUTER_BENCHMARK_CONFIRM === '1'
const imageSize = argValue('--image-size', process.env.OPENROUTER_BENCHMARK_IMAGE_SIZE || process.env.OPENROUTER_IMAGE_SIZE || '2K')
const outputDir = argValue('--output-dir', process.env.OPENROUTER_BENCHMARK_OUTPUT_DIR || 'generated/openrouter-benchmarks')
const preset = argValue('--preset', process.env.OPENROUTER_BENCHMARK_PRESET || DEFAULT_GENERATION_PRESET)
const runId = argValue('--run-id', process.env.OPENROUTER_BENCHMARK_RUN_ID || undefined)
const runGodotProbe = hasFlag('--godot')

if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not configured. Copy .env.example to .env and set the key.')
  process.exit(2)
}

if (!yes) {
  console.error('Refusing to spend live provider quota without --yes.')
  console.error('Example: npm run benchmark:openrouter -- --sample-size 1 --variants 1 --yes')
  process.exit(2)
}

const caseIds = argValues('--case-id')
const cases = selectOpenRouterBenchmarkCases({ caseIds, sampleSize: caseIds.length ? null : sampleSize, cases: DEFAULT_OPENROUTER_BENCHMARK_CASES })

const report = await runOpenRouterCharacterBenchmark({
  cases,
  variantsPerCase: variants,
  outputDir,
  runId,
  preset,
  imageConfig: {
    image_size: imageSize,
    aspect_ratio: process.env.OPENROUTER_BENCHMARK_ASPECT_RATIO || process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '1:1',
  },
  runGodotProbe,
})

console.log(
  JSON.stringify(
    {
      run_id: report.run_id,
      output_dir: `${outputDir}/${report.run_id}`,
      preset: report.preset,
      template_file: report.template_file,
      total: report.summary.total,
      validation: report.summary.validation,
      failures: report.summary.failures,
      failure_taxonomy: report.summary.failure_taxonomy,
      quality_gate: report.quality_gate,
      pass_rate: report.summary.pass_rate,
      usable_rate: report.summary.usable_rate,
    },
    null,
    2
  )
)
