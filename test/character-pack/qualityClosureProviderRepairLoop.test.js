import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQualityClosureProviderRepairLoopPlan,
  buildQualityClosureProviderRepairReferenceImages,
  postprocessQualityClosureProviderRepairStrip,
  runQualityClosureProviderRepairLoop,
} from '../../src/character-pack/benchmark/qualityClosureProviderRepairLoop.js'
import { applyQualityClosureProviderRepairs } from '../../src/character-pack/benchmark/qualityClosureRepairApply.js'
import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function paintRect(image, rect, color = [60, 120, 200, 255]) {
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

function makeCell(index, { propSide = null } = {}) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, { x: 42, y: 40, w: 13, h: 49 }, [40 + (index % 80), 90, 160, 255])
  if (propSide === 'left') paintRect(image, { x: 25, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
  if (propSide === 'right') paintRect(image, { x: 69, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
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

async function makeSemanticWarningSheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const propSides = new Map([
    [24, 'left'],
    [25, 'left'],
    [26, 'right'],
    [27, 'right'],
  ])
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteCell(sheet, frame, makeCell(frame, { propSide: propSides.get(frame) }))
  }
  return encodeRgbaPng(sheet)
}

async function makeRepairStripPng(frames, { propSide = 'left' } = {}) {
  const strip = {
    width: TOPDOWN_RPG_V0.frame.w * frames.length,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * frames.length * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (const [index, frame] of frames.entries()) {
    const cell = makeCell(frame, { propSide })
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = (y * strip.width + index * TOPDOWN_RPG_V0.frame.w + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return encodeRgbaPng(strip)
}

async function makeSquareProviderStripPng(frames) {
  const image = {
    width: 512,
    height: 512,
    data: new Uint8ClampedArray(512 * 512 * 4),
  }
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255
    image.data[i + 1] = 255
    image.data[i + 2] = 255
    image.data[i + 3] = 255
  }
  for (const [slot, frame] of frames.entries()) {
    const cell = makeCell(frame, { propSide: 'left' })
    const dx = 64 + slot * 96
    const dy = 208
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        if (!cell.data[src + 3]) continue
        const dst = ((dy + y) * image.width + dx + x) * 4
        image.data[dst] = cell.data[src]
        image.data[dst + 1] = cell.data[src + 1]
        image.data[dst + 2] = cell.data[src + 2]
        image.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return encodeRgbaPng(image)
}

async function makeFullCanvasWrongRepairPng() {
  const image = {
    width: 512,
    height: 512,
    data: new Uint8ClampedArray(512 * 512 * 4),
  }
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 214
    image.data[i + 1] = 214
    image.data[i + 2] = 210
    image.data[i + 3] = 255
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      paintRect(image, {
        x: 96 + col * 38,
        y: 88 + row * 38,
        w: 18,
        h: 24,
      }, [40 + row * 12, 80 + col * 9, 120, 255])
    }
  }
  return encodeRgbaPng(image)
}

async function makeMotionTemplateSheetPng() {
  const cellSize = 32
  const sheet = {
    width: cellSize * TOPDOWN_RPG_V0.grid.columns,
    height: cellSize * TOPDOWN_RPG_V0.grid.rows,
    data: new Uint8ClampedArray(cellSize * TOPDOWN_RPG_V0.grid.columns * cellSize * TOPDOWN_RPG_V0.grid.rows * 4),
  }
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    const col = frame % TOPDOWN_RPG_V0.grid.columns
    const row = Math.floor(frame / TOPDOWN_RPG_V0.grid.columns)
    paintRect(sheet, {
      x: col * cellSize + 10,
      y: row * cellSize + 6,
      w: 10,
      h: 22,
    }, [180, 40 + (frame % 120), 70, 255])
  }
  return encodeRgbaPng(sheet)
}

async function makePatchedStaticSheetPng(frame = 8) {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  for (let index = 0; index < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; index++) {
    pasteCell(sheet, index, makeCell(index))
  }
  pasteCell(sheet, frame, makeCell(frame + 41, { propSide: 'right' }))
  return encodeRgbaPng(sheet)
}

function semanticTask() {
  const frames = [24, 25, 26, 27]
  return {
    schema_version: 1,
    task_id: 'village_elder_v1_repair_semantic_side_walk_left',
    item_id: 'village_elder_v1',
    preset: TOPDOWN_RPG_V0.id,
    stage: 'provider',
    provider_required: true,
    action: 'semantic_frame_repair',
    issue: { type: 'prop_side_flip_suspected' },
    target: {
      animation: 'walk_left',
      frames: frames.map((frame) => ({
        frame,
        row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
        col: frame % TOPDOWN_RPG_V0.grid.columns,
        animation: 'walk_left',
        rect: {
          x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
          y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
          w: TOPDOWN_RPG_V0.frame.w,
          h: TOPDOWN_RPG_V0.frame.h,
        },
      })),
    },
    artifacts: { normalized_sheet: 'generated/unit/village_elder_v1/normalized_sheet.png' },
    provider_payload: {
      prompt: 'Repair walk_left semantic side consistency.',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
  }
}

function sourceActionMirrorTask() {
  const task = semanticTask()
  return {
    ...task,
    requested_action: 'walkL',
    source_action: 'walkL',
    source_layout: 'fixed_region_motion_v0',
    target: {
      ...task.target,
      requested_action: 'walkL',
      source_action: 'walkL',
      source_layout: 'fixed_region_motion_v0',
      derived_frames: [28, 29, 30, 31].map((frame, sourceIndex) => ({
        frame,
        row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
        col: frame % TOPDOWN_RPG_V0.grid.columns,
        animation: 'walk_right',
        transform: 'flip_h',
        source_index: sourceIndex,
        source_target_frame: 24 + sourceIndex,
        rect: {
          x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
          y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
          w: TOPDOWN_RPG_V0.frame.w,
          h: TOPDOWN_RPG_V0.frame.h,
        },
      })),
    },
  }
}

function staticPoseTask() {
  const frames = [8, 9, 10, 11]
  return {
    schema_version: 1,
    task_id: 'village_elder_v1_user_selected_idle_left_repair',
    item_id: 'village_elder_v1',
    preset: TOPDOWN_RPG_V0.id,
    stage: 'provider',
    provider_required: true,
    action: 'single_animation_repair',
    repair_mode: 'static_pose',
    issue: { type: 'motion_inconsistent' },
    target: {
      animation: 'idle_left',
      repair_mode: 'static_pose',
      frames: frames.map((frame) => ({
        frame,
        row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
        col: frame % TOPDOWN_RPG_V0.grid.columns,
        animation: 'idle_left',
        rect: {
          x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
          y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
          w: TOPDOWN_RPG_V0.frame.w,
          h: TOPDOWN_RPG_V0.frame.h,
        },
      })),
    },
    artifacts: { normalized_sheet: 'generated/unit/village_elder_v1/normalized_sheet.png' },
    provider_payload: {
      prompt: 'Repair idle_left as one static pose.',
      output: {
        kind: 'patched_normalized_sheet_png',
        repair_mode: 'static_pose',
        cell_count: 1,
        target_cell_count: 4,
      },
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
  }
}

function manifest() {
  return {
    schema_version: 1,
    mode: 'character_quality_closure_repair_manifest_v1',
    run_id: 'quality_provider_repair_loop_unit',
    preset: TOPDOWN_RPG_V0.id,
    provider_preset_id: 'repair-provider',
    tasks: [semanticTask()],
  }
}

function staticManifest() {
  return {
    ...manifest(),
    tasks: [staticPoseTask()],
  }
}

test('postprocessQualityClosureProviderRepairStrip crops a square provider image into a strict strip', async () => {
  const task = semanticTask()
  const result = await postprocessQualityClosureProviderRepairStrip(await makeSquareProviderStripPng([24, 25, 26, 27]), {
    task,
    backgroundMode: 'flood',
  })

  assert.deepEqual(result.normalized_size, { w: 384, h: 96 })
  assert.equal(result.normalization.method, 'visible_bbox_crop_resize')
  assert.equal(Buffer.isBuffer(result.repair_strip_png), true)
})

test('postprocessQualityClosureProviderRepairStrip rejects full-sheet provider output', async () => {
  const fullCanvas = await makeFullCanvasWrongRepairPng()
  await assert.rejects(
    () => postprocessQualityClosureProviderRepairStrip(fullCanvas, {
      task: semanticTask(),
      backgroundMode: 'flood',
    }),
    /full sheet|full-canvas|horizontal/
  )
})

test('runQualityClosureProviderRepairLoop generates one strip and applies it to the selected animation', async () => {
  const task = semanticTask()
  const plan = buildQualityClosureProviderRepairLoopPlan({
    manifest: manifest(),
    taskId: task.task_id,
    outputDir: 'generated/unit/provider-repair-loop',
    motionTemplate: { enabled: true, preset: 'unit-motion-template', layout: 'topdown_rpg_v0' },
  })
  assert.equal(plan.image_config.aspect_ratio, '4:1')
  const normalizedSheetBuffer = await makeSemanticWarningSheetPng()
  const motionTemplateBuffer = await makeMotionTemplateSheetPng()
  const providerStrip = await makeRepairStripPng([24, 25, 26, 27])
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
                images: [{ image_url: { url: `data:image/png;base64,${providerStrip.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const refs = await buildQualityClosureProviderRepairReferenceImages({
    task,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    motionTemplateName: 'unit_motion_template.png',
    motionTemplateLayout: 'topdown_rpg_v0',
  })
  assert.deepEqual(refs.map((image) => image.name), ['motion_template_reference.png', 'normalized_sheet_reference.png', 'target_animation_reference.png'])
  assert.equal(refs[0].source_mode, 'uniform_grid_template_sheet')
  assert.equal(plan.can_run, true)
  assert.equal(plan.estimated_provider_calls, 1)
  assert.match(plan.selected.prompt, /Target facing direction: left/)
  assert.match(plan.selected.prompt, /Motion template action strip/)
  assert.match(plan.selected.prompt, /do not add ladders, weapons/)
  assert.match(plan.selected.prompt, /no duplicated arms or hands/)

  const result = await runQualityClosureProviderRepairLoop({
    plan,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    motionTemplateName: 'unit_motion_template.png',
    motionTemplateLayout: 'topdown_rpg_v0',
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/repair', model: 'model/repair', image_size: '1K' },
      ]),
    },
    fetchImpl,
    backgroundMode: 'auto',
  })

  assert.match(result.status, /^(passed|partial)$/)
  assert.equal(result.summary.generated_count, 1)
  assert.equal(result.summary.resolved_target_count, 1)
  assert.equal(result.apply_result.semantic_target_results[0].resolved, true)
  assert.equal(Object.keys(result.apply_result.row_gif_buffers).length, 16)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.messages[0].content.length, 4)
  assert.equal(requests[0].body.messages[0].content[1].type, 'image_url')
  assert.match(requests[0].body.messages[0].content[0].text, /Follow the motion template/)
})

test('applyQualityClosureProviderRepairs mirrors derived right-facing frames locally', async () => {
  const task = sourceActionMirrorTask()
  const result = await applyQualityClosureProviderRepairs({
    normalizedSheetBuffer: await makeSemanticWarningSheetPng(),
    repairs: [{ task, stripBuffer: await makeRepairStripPng([24, 25, 26, 27], { propSide: 'left' }) }],
  })

  assert.equal(result.summary.pasted_cell_count, 8)
  assert.equal(result.applied_tasks[0].source_action, 'walkL')
  assert.deepEqual(result.applied_tasks[0].frames, [24, 25, 26, 27])
  assert.deepEqual(result.applied_tasks[0].derived_frames.map((frame) => frame.frame), [28, 29, 30, 31])
  assert.ok(result.applied_tasks[0].derived_frames.every((frame) => frame.transform === 'flip_h'))
})

test('static pose repair crops a provider-patched sheet and pastes one cell into all target frames', async () => {
  const task = staticPoseTask()
  const plan = buildQualityClosureProviderRepairLoopPlan({
    manifest: staticManifest(),
    taskId: task.task_id,
    outputDir: 'generated/unit/provider-static-pose-repair-loop',
    motionTemplate: { enabled: true, preset: 'unit-motion-template', layout: 'topdown_rpg_v0' },
  })
  assert.equal(plan.image_config.aspect_ratio, '1:1')
  assert.equal(plan.selected.repair_mode, 'static_pose')
  assert.equal(plan.selected.expected_output.kind, 'patched_normalized_sheet_png')
  assert.equal(plan.selected.expected_output.cell_count, 1)
  assert.equal(plan.selected.expected_output.target_cell_count, 4)
  assert.match(plan.selected.prompt, /Required output: one full transparent normalized sheet/)
  assert.match(plan.selected.prompt, /Keep every non-target cell visually unchanged/)

  const normalizedSheetBuffer = await makeSemanticWarningSheetPng()
  const motionTemplateBuffer = await makeMotionTemplateSheetPng()
  const providerSheet = await makePatchedStaticSheetPng(8)
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
                images: [{ image_url: { url: `data:image/png;base64,${providerSheet.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const refs = await buildQualityClosureProviderRepairReferenceImages({
    task,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    motionTemplateName: 'unit_motion_template.png',
    motionTemplateLayout: 'topdown_rpg_v0',
  })
  assert.deepEqual(refs[0].frames, [8])
  assert.deepEqual(refs[2].frames, [8])
  assert.deepEqual(refs[2].target_frames, [8, 9, 10, 11])

  const result = await runQualityClosureProviderRepairLoop({
    plan,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    motionTemplateName: 'unit_motion_template.png',
    motionTemplateLayout: 'topdown_rpg_v0',
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/repair', model: 'model/repair', image_size: '1K' },
      ]),
    },
    fetchImpl,
    backgroundMode: 'auto',
  })

  assert.equal(result.summary.generated_count, 1)
  assert.equal(result.generation.postprocess.normalized_size.w, 96)
  assert.equal(result.generation.postprocess.normalized_size.h, 96)
  assert.equal(result.generation.postprocess.normalization.method, 'patched_sheet_crop_first_target_cell')
  assert.equal(result.apply_result.summary.pasted_cell_count, 4)
  assert.equal(result.apply_result.applied_tasks[0].repair_mode, 'static_pose')
  assert.equal(result.apply_result.applied_tasks[0].output_cell_count, 1)
  assert.deepEqual(result.apply_result.applied_tasks[0].frames, [8, 9, 10, 11])
  assert.equal(requests.length, 1)
  assert.match(requests[0].body.messages[0].content[0].text, /one full transparent normalized sheet/)
})
