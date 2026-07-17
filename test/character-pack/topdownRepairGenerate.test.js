import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTopdownRepairTask } from '../../src/character-pack/benchmark/topdownRepairManifest.js'
import {
  buildTopdownRepairCellPrompt,
  buildTopdownRepairReferenceImages,
  generateTopdownRepairCell,
  postprocessTopdownRepairCell,
} from '../../src/character-pack/benchmark/topdownRepairGenerate.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

function makeRgba(width, height, background = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0]
    data[i + 1] = background[1]
    data[i + 2] = background[2]
    data[i + 3] = background[3]
  }
  return { width, height, data }
}

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

async function makeProviderPng() {
  const image = makeRgba(128, 128)
  paintRect(image, { x: 40, y: 28, w: 42, h: 80 })
  return encodeRgbaPng(image)
}

function makeTask() {
  return buildTopdownRepairTask({
    runId: 'repair_generate_unit',
    item: {
      case: { id: 'blue_wizard', description: 'a small blue wizard' },
      variant: 1,
      generation: {
        provider_preset_id: 'repair-provider',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
      },
    },
    issue: {
      message: 'frame_40_cropped',
      issue: 'cropped_frame',
      frame: 40,
      row: 5,
      col: 0,
      animation: 'attack_left',
      frame_in_animation: 0,
      repair_scope: 'single_cell',
      strategy: 'regenerate_pose_with_more_padding',
    },
  })
}

test('buildTopdownRepairCellPrompt keeps repair generation scoped to one cell', () => {
  const prompt = buildTopdownRepairCellPrompt(makeTask())

  assert.match(prompt, /Repair exactly one topdown_rpg_v0 cell/)
  assert.match(prompt, /Return a single repaired cell image only/)
  assert.match(prompt, /not an 8x8 sheet/)
  assert.match(prompt, /Do not reproduce multiple tiny poses/)
  assert.match(prompt, /not a grid/)
})

test('buildTopdownRepairReferenceImages extracts same-animation neighbors into a strip', async () => {
  const sheet = makeRgba(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h, [0, 0, 0, 0])
  paintRect(sheet, { x: 96, y: 480, w: 20, h: 20 }, [255, 0, 0, 255])
  paintRect(sheet, { x: 192, y: 480, w: 20, h: 20 }, [0, 255, 0, 255])
  paintRect(sheet, { x: 288, y: 480, w: 20, h: 20 }, [0, 0, 255, 255])

  const refs = await buildTopdownRepairReferenceImages({
    task: makeTask(),
    normalizedSheetBuffer: await encodeRgbaPng(sheet),
  })

  assert.equal(refs.length, 1)
  assert.equal(refs[0].name, 'same_animation_reference.png')
  assert.deepEqual(refs[0].frames, [41, 42, 43])
  const strip = await loadRgba(refs[0].buffer)
  assert.equal(strip.width, 288)
  assert.equal(strip.height, 96)
  assert.equal(strip.data[(17 * strip.width + 1) * 4], 255)
  assert.equal(strip.data[(17 * strip.width + 96 + 1) * 4 + 1], 255)
  assert.equal(strip.data[(17 * strip.width + 192 + 1) * 4 + 2], 255)
})

test('postprocessTopdownRepairCell normalizes provider output to a strict 96x96 cell', async () => {
  const result = await postprocessTopdownRepairCell(await makeProviderPng(), { backgroundMode: 'flood' })
  const cell = await loadRgba(result.cell_png)

  assert.deepEqual(result.source_size, { w: 128, h: 128 })
  assert.equal(result.background_mode, 'flood')
  assert.equal(cell.width, 96)
  assert.equal(cell.height, 96)
  assert.ok(result.normalized_bbox.w > 0)
  assert.ok(result.normalized_bbox.x > 0)
  assert.ok(result.normalized_bbox.right < 95)
})

test('generateTopdownRepairCell sends a prompt-image request and returns a repaired 96x96 cell', async () => {
  let request
  const providerPng = await makeProviderPng()
  const fetchImpl = async (url, init) => {
    request = { url, init }
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

  const referenceImage = { name: 'normalized_sheet.png', mimeType: 'image/png', buffer: await makeProviderPng() }
  const result = await generateTopdownRepairCell({
    task: makeTask(),
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/repair', model: 'model/repair', image_size: '1K' },
      ]),
    },
    referenceImages: [referenceImage],
    fetchImpl,
    backgroundMode: 'flood',
  })

  assert.equal(request.url, 'https://example.test/repair')
  assert.equal(request.init.headers.authorization, 'Bearer alpha')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'model/repair')
  assert.deepEqual(body.image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.equal(body.messages[0].content[0].type, 'text')
  assert.match(body.messages[0].content[0].text, /Return a single repaired cell image only/)
  assert.match(body.messages[0].content[0].text, /Do not reproduce multiple tiny poses/)
  assert.equal(body.messages[0].content[1].type, 'image_url')
  const cell = await loadRgba(result.repaired_cell_png)
  assert.equal(cell.width, 96)
  assert.equal(cell.height, 96)
  assert.equal(result.provider_preset_id, 'repair-provider')
  assert.deepEqual(result.input_images, ['normalized_sheet.png'])
})
