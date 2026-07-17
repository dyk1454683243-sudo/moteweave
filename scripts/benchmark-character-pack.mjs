#!/usr/bin/env node
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { runCharacterPackBenchmark } from '../src/character-pack/benchmark/benchmarkRunner.js'

const defaultInputs = [
  { path: 'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png', name: 'fixture_sample_hero', backgroundMode: 'flood' },
]

function argumentValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue
    const value = process.argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a file path`)
    values.push(value)
  }
  return values
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const explicitInputs = argumentValues('--input').map((inputPath, index) => ({
  path: inputPath,
  name: `explicit_input_${index + 1}`,
  backgroundMode: 'flood',
}))
const inputs = [...defaultInputs, ...explicitInputs]
for (const input of inputs) {
  if (!(await fileExists(input.path))) throw new Error(`Benchmark input not found: ${input.path}`)
}

const report = await runCharacterPackBenchmark({ inputs, runGodotProbe: process.argv.includes('--godot') })
console.log(JSON.stringify({ run_id: report.run_id, items: report.items.length }, null, 2))
