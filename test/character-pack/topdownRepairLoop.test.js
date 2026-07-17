import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTopdownRepairManifestForBenchmarkReport } from '../../src/character-pack/benchmark/topdownRepairManifest.js'
import {
  buildTopdownRepairLoopPlan,
  runTopdownRepairLoop,
} from '../../src/character-pack/benchmark/topdownRepairLoop.js'
import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function paintRect(image, rect, color = [40, 90, 180, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeCell(rect) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, rect)
  return image
}

function pasteCell(sheet, frame, cell) {
  const col = frame % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frame / TOPDOWN_RPG_V0.grid.columns)
  for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
    for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
      const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
      sheet.data[dst] = cell.data[src]
      sheet.data[dst + 1] = cell.data[src + 1]
      sheet.data[dst + 2] = cell.data[src + 2]
      sheet.data[dst + 3] = cell.data[src + 3]
    }
  }
}

async function makeSheetPng({ croppedFrames = [] } = {}) {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const compact = makeCell({ x: 24, y: 17, w: 48, h: 72 })
  const cropped = makeCell({ x: 0, y: 17, w: 72, h: 72 })
  const croppedSet = new Set(croppedFrames)
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteCell(sheet, frame, croppedSet.has(frame) ? cropped : compact)
  }
  return encodeRgbaPng(sheet)
}

async function makeProviderPng() {
  const image = {
    width: 128,
    height: 128,
    data: new Uint8ClampedArray(128 * 128 * 4),
  }
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255
    image.data[i + 1] = 255
    image.data[i + 2] = 255
    image.data[i + 3] = 255
  }
  paintRect(image, { x: 42, y: 30, w: 44, h: 74 })
  return encodeRgbaPng(image)
}

function makeManifest() {
  return buildTopdownRepairManifestForBenchmarkReport({
    run_id: 'topdown_repair_loop_unit',
    preset: 'topdown_rpg_v0',
    provider_preset_id: 'repair-provider',
    image_config: { image_size: '1K', aspect_ratio: '1:1' },
    items: [
      {
        case: { id: 'blue_wizard', description: 'a small blue wizard' },
        variant: 1,
        artifacts: { dir: 'generated/unit/items/blue_wizard_v1' },
        generation: { provider_preset_id: 'repair-provider' },
        validation: { status: 'fail', blocking_errors: ['frame_40_cropped', 'frame_41_cropped'], warnings: [] },
      },
    ],
  })
}

test('buildTopdownRepairLoopPlan rejects mixed item selections for one-sheet repair', () => {
  const manifest = buildTopdownRepairManifestForBenchmarkReport({
    run_id: 'topdown_repair_loop_mixed_unit',
    preset: 'topdown_rpg_v0',
    items: [
      {
        case: { id: 'blue_wizard' },
        variant: 1,
        artifacts: { dir: 'generated/unit/items/blue_wizard_v1' },
        validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
      },
      {
        case: { id: 'frog_knight' },
        variant: 1,
        artifacts: { dir: 'generated/unit/items/frog_knight_v1' },
        validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
      },
    ],
  })

  const plan = buildTopdownRepairLoopPlan({ manifest, outputDir: 'generated/unit/repair-loop' })

  assert.equal(plan.can_run, false)
  assert.match(plan.preflight.errors.join('\n'), /must share one item_id/)
})

test('buildTopdownRepairLoopPlan rejects duplicate target frames before provider calls', () => {
  const manifest = buildTopdownRepairManifestForBenchmarkReport({
    run_id: 'topdown_repair_loop_duplicate_unit',
    preset: 'topdown_rpg_v0',
    items: [
      {
        case: { id: 'blue_wizard' },
        variant: 1,
        artifacts: { dir: 'generated/unit/items/blue_wizard_v1' },
        validation: { status: 'fail', blocking_errors: ['frame_40_empty', 'frame_40_cropped'], warnings: [] },
      },
    ],
  })

  const plan = buildTopdownRepairLoopPlan({ manifest, outputDir: 'generated/unit/repair-loop' })

  assert.equal(plan.can_run, false)
  assert.match(plan.preflight.errors.join('\n'), /duplicate target frames selected: 40/)
})

test('runTopdownRepairLoop generates selected cells and applies them with validation evidence', async () => {
  const manifest = makeManifest()
  const plan = buildTopdownRepairLoopPlan({
    manifest,
    taskIds: ['blue_wizard_v1_frame_40_cropped', 'blue_wizard_v1_frame_41_cropped'],
    outputDir: 'generated/unit/repair-loop',
  })
  const providerPng = await makeProviderPng()
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${providerPng.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const result = await runTopdownRepairLoop({
    plan,
    normalizedSheetBuffer: await makeSheetPng({ croppedFrames: [40, 41] }),
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/repair', model: 'model/repair', image_size: '1K' },
      ]),
    },
    fetchImpl,
    backgroundMode: 'flood',
  })

  assert.equal(plan.can_run, true)
  assert.equal(plan.estimated_provider_calls, 2)
  assert.deepEqual(plan.tasks[0].reference_policy.used_frames, [42, 43])
  assert.equal(result.status, 'passed')
  assert.equal(result.summary.generated_count, 2)
  assert.equal(result.validation_gate.passed, true)
  assert.equal(result.validation_gate.resolved_count, 2)
  assert.equal(result.validation_gate.new_blocking_errors.length, 0)
  assert.equal(result.apply_result.target_results.every((target) => target.resolved), true)
  assert.equal(Object.keys(result.apply_result.row_gif_buffers).length, 16)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].body.messages[0].content[1].type, 'image_url')
})

test('runTopdownRepairLoop stops before apply when provider generation fails', async () => {
  const manifest = makeManifest()
  const plan = buildTopdownRepairLoopPlan({
    manifest,
    taskIds: ['blue_wizard_v1_frame_40_cropped', 'blue_wizard_v1_frame_41_cropped'],
    outputDir: 'generated/unit/repair-loop',
  })
  const providerPng = await makeProviderPng()
  let callCount = 0
  const fetchImpl = async () => {
    callCount += 1
    if (callCount === 2) throw new Error('provider unavailable')
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${providerPng.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const result = await runTopdownRepairLoop({
    plan,
    normalizedSheetBuffer: await makeSheetPng({ croppedFrames: [40, 41] }),
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/repair', model: 'model/repair', image_size: '1K' },
      ]),
    },
    fetchImpl,
    backgroundMode: 'flood',
  })

  assert.equal(result.status, 'failed_generation')
  assert.equal(result.generated_count, 1)
  assert.equal(result.failed_task_id, 'blue_wizard_v1_frame_41_cropped')
  assert.equal(result.apply_result, null)
  assert.equal(result.validation_gate, null)
})
