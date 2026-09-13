#!/usr/bin/env node
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { runCharacterPackBenchmark } from '../src/character-pack/benchmark/benchmarkRunner.js'

const defaultInputs = [
  { path: 'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png', name: 'fixture_sample_hero', backgroundMode: 'flood' },
]

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const inputs = []
for (const input of defaultInputs) {
  if (await fileExists(input.path)) inputs.push(input)
}

if (inputs.length === 0) {
  throw new Error('No benchmark inputs found')
}

const report = await runCharacterPackBenchmark({ inputs, runGodotProbe: process.argv.includes('--godot') })
console.log(JSON.stringify({ run_id: report.run_id, items: report.items.length }, null, 2))
