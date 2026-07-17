import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import sharp from 'sharp'

import { runCharacterPackBenchmark } from '../../src/character-pack/benchmark/benchmarkRunner.js'

async function makeSheet(filePath) {
  const width = 128
  const height = 128
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * 16 + 8
      const foot = row * 16 + 12
      for (let y = foot - 8; y <= foot; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          const offset = (y * width + x) * 4
          data[offset] = 10 + row
          data[offset + 1] = 20 + col
          data[offset + 2] = 30
        }
      }
    }
  }
  await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toFile(filePath)
}

test('runCharacterPackBenchmark writes a stable report without live providers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-benchmark-'))
  const input = path.join(root, 'sheet.png')
  await makeSheet(input)

  const result = await runCharacterPackBenchmark({
    inputs: [{ path: input, name: 'sheet' }],
    outputDir: path.join(root, 'out'),
    runId: 'bench_test',
    runGodotProbe: false,
  })

  assert.equal(result.run_id, 'bench_test')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].input.name, 'sheet')
  assert.equal(result.items[0].processing.status, 'done')
  assert.equal(result.items[0].exports.json_grid.available, true)
  assert.equal(result.items[0].exports.rpgmaker_v0.available, true)
  assert.equal(typeof result.items[0].validation.status, 'string')

  const saved = JSON.parse(await readFile(path.join(root, 'out', 'bench_test', 'benchmark_report.json'), 'utf8'))
  assert.equal(saved.run_id, 'bench_test')
})

test('runCharacterPackBenchmark records Godot probe status when enabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-benchmark-probe-'))
  const input = path.join(root, 'sheet.png')
  await makeSheet(input)

  const result = await runCharacterPackBenchmark({
    inputs: [{ path: input, name: 'sheet' }],
    outputDir: path.join(root, 'out'),
    runId: 'bench_probe_test',
    runGodotProbe: true,
  })

  assert.equal(typeof result.items[0].godot_probe.json_grid.status, 'string')
  assert.equal(typeof result.items[0].godot_probe.rpgmaker_v0.status, 'string')
  assert.equal(typeof result.items[0].godot_probe.ocad_v0.status, 'string')
})
