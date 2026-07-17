import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import {
  applyExternalMattingToFrames,
  REMBG_MATTING_LIMITS,
  resolveRembgPath,
} from '../../src/motion-source/externalMatting.js'
import { EXTERNAL_TOOL_FAILURE } from '../../src/motion-source/guardedToolRunner.js'

function solid(width, height, [r, g, b, a]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = r
    data[index * 4 + 1] = g
    data[index * 4 + 2] = b
    data[index * 4 + 3] = a
  }
  return { width, height, data }
}

test('resolveRembgPath preserves local CLI and environment path authority', () => {
  assert.equal(resolveRembgPath({ REMBG_PATH: '/opt/bin/rembg', rembgPath: '/ignored' }), '/opt/bin/rembg')
  assert.equal(resolveRembgPath({ rembgPath: '/local/rembg' }), '/local/rembg')
  assert.equal(resolveRembgPath({}), 'rembg')
})

test('external matting passes per-frame product guards and records bounded evidence', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-'))
  const frames = [
    solid(2, 2, [10, 20, 30, 255]),
    solid(2, 2, [40, 50, 60, 255]),
  ]
  const calls = []
  const runner = async (binary, args, options) => {
    calls.push({ binary, args, options })
    await copyFile(args[1], args[2])
  }

  const result = await applyExternalMattingToFrames(frames, {
    outputDir,
    rembgPath: '/custom/rembg',
    runner,
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].binary, '/custom/rembg')
  assert.equal(calls[0].args[0], 'i')
  assert.equal(calls[0].options.tool, 'rembg')
  assert.equal(calls[0].options.maxRssMiB, REMBG_MATTING_LIMITS.maxRssMiB)
  assert.equal(calls[0].options.timeoutMs, REMBG_MATTING_LIMITS.frameTimeoutMs)
  assert.equal(calls[0].options.pollIntervalMs, REMBG_MATTING_LIMITS.pollIntervalMs)
  assert.ok(Number.isFinite(calls[0].options.deadlineAt))
  assert.equal(result.frames.length, 2)
  assert.equal(result.report.frame_count, 2)
  assert.equal(result.report.limits.total_timeout_ms, REMBG_MATTING_LIMITS.totalTimeoutMs)
  assert.ok(result.report.output_bytes_total > 0)
})

test('external matting never launches the next frame after cancellation', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-cancel-'))
  const frames = [
    solid(2, 2, [10, 20, 30, 255]),
    solid(2, 2, [40, 50, 60, 255]),
  ]
  const controller = new AbortController()
  let calls = 0

  await assert.rejects(
    () => applyExternalMattingToFrames(frames, {
      outputDir,
      signal: controller.signal,
      runner: async (binary, args) => {
        calls += 1
        await copyFile(args[1], args[2])
        controller.abort()
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
  assert.equal(calls, 1)
})

test('external matting checks the remaining total deadline before every frame', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-deadline-'))
  const frames = [
    solid(2, 2, [10, 20, 30, 255]),
    solid(2, 2, [40, 50, 60, 255]),
  ]
  const timestamps = [0, 0, 0, 0, 10, 10, 10, 10, 10, 101]
  let calls = 0

  await assert.rejects(
    () => applyExternalMattingToFrames(frames, {
      outputDir,
      now: () => timestamps.shift() ?? 101,
      toolLimits: { totalTimeoutMs: 100, frameTimeoutMs: 40 },
      runner: async (binary, args, options) => {
        calls += 1
        assert.equal(options.timeoutMs, 40)
        assert.equal(options.deadlineAt, 100)
        await copyFile(args[1], args[2])
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.TIMEOUT)
      assert.equal(error.deadline_scope, 'total_stage')
      assert.equal(error.frame_index, 1)
      return true
    }
  )
  assert.equal(calls, 1)
})

test('external matting maps unclassified runner failures to a stable tool code', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-fail-'))
  await assert.rejects(
    () => applyExternalMattingToFrames(
      [solid(2, 2, [10, 20, 30, 255])],
      {
        outputDir,
        runner: async () => {
          throw new Error('model unavailable')
        },
      }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.FAILED)
      assert.match(error.message, /external matting failed: model unavailable/)
      return true
    }
  )
})

test('external matting validates tool output against decoded pixel budgets before loading RGBA', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-budget-'))
  const oversizedOutput = await encodeRgbaPng(solid(2, 2, [10, 20, 30, 255]))
  await assert.rejects(
    () => applyExternalMattingToFrames(
      [solid(1, 1, [10, 20, 30, 255])],
      {
        outputDir,
        decodeLimits: { frame_pixels: 3 },
        runner: async (binary, args) => writeFile(args[2], oversizedOutput),
      }
    ),
    (error) => error.code === 'decode_budget_exceeded' && error.budget === 'frame_pixels'
  )
})

test('external matting rejects oversized tool output before metadata or RGBA decode', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'external-matting-output-limit-'))

  await assert.rejects(
    () => applyExternalMattingToFrames(
      [solid(2, 2, [10, 20, 30, 255])],
      {
        outputDir,
        toolLimits: {
          maxOutputBytesPerFrame: 8,
          maxOutputBytesTotal: 16,
        },
        runner: async (binary, args) => {
          await writeFile(args[2], Buffer.alloc(9))
        },
      }
    ),
    (error) => (
      error.code === 'decode_budget_exceeded' &&
      error.budget === 'external_matting_frame_output_bytes'
    )
  )
})
