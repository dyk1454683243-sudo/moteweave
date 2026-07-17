import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { getTileSourceRegion } from '../../src/scene-pack/tileProfile.js'
import { generateSceneTilePack } from '../../src/scene-pack/tileGenerate.js'
import { buildScenePackFromTileSheet } from '../../src/scene-pack/tileSheetIngestion.js'

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeTileSheet() {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    paintRect(image, { x: region.col * 48, y: region.row * 48, w: 48, h: 48 }, [232, 36, 188, 255])
    paintRect(image, region, [80, 120, 60, 255])
  }
  return image
}

function paintRuntimeTileEdges(image, region, { north, east, south, west }) {
  paintRect(image, { x: region.x, y: region.y, w: region.w, h: 1 }, north)
  paintRect(image, { x: region.x, y: region.y + region.h - 1, w: region.w, h: 1 }, south)
  paintRect(image, { x: region.x, y: region.y, w: 1, h: region.h }, west)
  paintRect(image, { x: region.x + region.w - 1, y: region.y, w: 1, h: region.h }, east)
}

function makeMismatchedTileSheet() {
  const image = makeTileSheet()
  const colors = [
    [220, 30, 30, 255],
    [30, 210, 80, 255],
    [40, 60, 220, 255],
    [230, 210, 50, 255],
  ]
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    paintRuntimeTileEdges(image, region, {
      north: colors[mask % colors.length],
      east: colors[(mask + 1) % colors.length],
      south: colors[(mask + 2) % colors.length],
      west: colors[(mask + 3) % colors.length],
    })
  }
  return image
}

function scaleNearest(image, factor) {
  const output = {
    width: image.width * factor,
    height: image.height * factor,
    data: new Uint8ClampedArray(image.width * factor * image.height * factor * 4),
  }
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const src = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4
      const dst = (y * output.width + x) * 4
      output.data[dst] = image.data[src]
      output.data[dst + 1] = image.data[src + 1]
      output.data[dst + 2] = image.data[src + 2]
      output.data[dst + 3] = image.data[src + 3]
    }
  }
  return output
}

test('generateSceneTilePack requests a provider image and ingests the returned tile sheet', async () => {
  let request
  const providerPng = await encodeRgbaPng(makeTileSheet())
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

  const result = await generateSceneTilePack({
    description: 'mossy cliff path',
    projectId: 'generated_scene_project',
    identifier: 'generated_scene',
    width: 2,
    height: 2,
    pattern: 'solid',
    providerPresetId: 'scene-provider',
    imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
    },
    fetchImpl,
  })

  assert.equal(request.url, 'https://example.test/scene')
  assert.equal(request.init.headers.authorization, 'Bearer alpha')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'model/scene')
  assert.deepEqual(body.image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.equal(typeof body.messages[0].content, 'string')
  assert.match(body.messages[0].content, /mossy cliff path/)
  assert.match(body.messages[0].content, /exactly 192x192 pixels/)
  assert.equal(result.status, 'pass')
  assert.equal(result.qualityGate.status, 'pass')
  assert.equal(result.sceneJson.identifier, 'generated_scene')
  assert.deepEqual(result.files.tilesetPng, providerPng)
  assert.match(result.files.promptTxt.toString('utf8'), /row-major dual-grid mask order 0-15/)
  assert.equal(result.files.generationJson.provider_preset_id, 'scene-provider')
  assert.equal(result.files.generationJson.candidate_count, 1)
  assert.equal(result.candidateSelection.selected_candidate_id, 'candidate_01')
  assert.equal(result.files.candidateArtifacts.some((file) => file.name === 'candidates/candidate_01/quality_gate.json'), true)
  assert.equal(result.files.generationJson.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.match(result.files.promptTxt.toString('utf8'), /outer 3 px border band/)
  assert.match(result.files.promptTxt.toString('utf8'), /not a continuous scene sliced into cells/)
  const tileset = await loadRgba(result.files.tilesetPng)
  assert.equal(tileset.width, 192)
  assert.equal(tileset.height, 192)
})

test('generateSceneTilePack selects the best strict candidate and keeps candidate evidence', async () => {
  let requestCount = 0
  const badPng = await encodeRgbaPng(makeMismatchedTileSheet())
  const goodPng = await encodeRgbaPng(makeTileSheet())
  const fetchImpl = async () => {
    requestCount += 1
    const png = requestCount === 1 ? badPng : goodPng
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const result = await generateSceneTilePack({
    description: 'mossy cliff path',
    width: 2,
    height: 2,
    pattern: 'solid',
    candidateCount: 2,
    gatePolicy: { raw_tile_quality: 'strict' },
    providerPresetId: 'scene-provider',
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
    },
    fetchImpl,
  })

  assert.equal(requestCount, 2)
  assert.equal(result.status, 'pass')
  assert.equal(result.candidateSelection.candidate_count, 2)
  assert.equal(result.candidateSelection.selected_candidate_id, 'candidate_02')
  assert.equal(result.candidateSelection.selected_status, 'pass')
  assert.equal(result.candidateSelection.ranking[0].id, 'candidate_02')
  assert.equal(result.candidateSelection.ranking[1].status, 'fail')
  assert.match(result.candidateSelection.selection_reason, /selected from 2 candidates/)
  assert.equal(result.files.generationJson.selected_candidate_id, 'candidate_02')
  assert.equal(result.files.generationJson.candidate_selection.selected_candidate_id, 'candidate_02')
  assert.deepEqual(result.files.tilesetPng, goodPng)
  assert.equal(result.files.candidateArtifacts.some((file) => file.name === 'candidates/candidate_01/tileset.png'), true)
  assert.equal(result.files.candidateArtifacts.some((file) => file.name === 'candidates/candidate_02/quality_gate.json'), true)
  const candidateOneGate = result.files.candidateArtifacts.find((file) => file.name === 'candidates/candidate_01/quality_gate.json').content
  assert.equal(candidateOneGate.status, 'fail')
})

test('generateSceneTilePack consumes provider call budget per candidate', async () => {
  let requestCount = 0
  const providerPng = await encodeRgbaPng(makeTileSheet())
  const fetchImpl = async () => {
    requestCount += 1
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
  const providerBudget = { max: 1, used: 0 }

  await assert.rejects(
    () => generateSceneTilePack({
      description: 'mossy cliff path',
      width: 2,
      height: 2,
      pattern: 'solid',
      candidateCount: 2,
      providerBudget,
      providerPresetId: 'scene-provider',
      env: {
        KEY_A: 'alpha',
        CHARACTER_PROVIDER_PRESETS: JSON.stringify([
          { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
        ]),
      },
      fetchImpl,
    }),
    /Provider call budget exceeded/
  )
  assert.equal(requestCount, 1)
  assert.equal(providerBudget.used, 1)
})

test('generateSceneTilePack resizes provider output to the tile source contract before ingestion', async () => {
  const providerPng = await encodeRgbaPng(scaleNearest(makeTileSheet(), 2))
  const fetchImpl = async () => ({
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
  })

  const result = await generateSceneTilePack({
    description: 'mossy cliff path',
    width: 2,
    height: 2,
    pattern: 'solid',
    providerPresetId: 'scene-provider',
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
    },
    fetchImpl,
  })

  const tileset = await loadRgba(result.files.tilesetPng)
  assert.equal(result.status, 'pass')
  assert.equal(result.qualityGate.status, 'pass')
  assert.equal(tileset.width, 192)
  assert.equal(tileset.height, 192)
  assert.deepEqual(result.files.generationJson.postprocess.source_size, { w: 384, h: 384 })
  assert.deepEqual(result.files.generationJson.postprocess.output_size, { w: 192, h: 192 })
  assert.equal(result.files.generationJson.postprocess.resize_method, 'nearest')
})

test('generateSceneTilePack can opt into palette snap style correction before ingestion', async () => {
  const providerPng = await encodeRgbaPng(makeTileSheet())
  const fetchImpl = async () => ({
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
  })

  const result = await generateSceneTilePack({
    description: 'mossy cliff path',
    width: 2,
    height: 2,
    pattern: 'solid',
    styleCorrection: { mode: 'palette_snap', maxColors: 1 },
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
    },
    providerPresetId: 'scene-provider',
    fetchImpl,
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.styleCorrection.mode, 'palette_snap')
  assert.equal(result.qualityGate.style_correction.mode, 'palette_snap')
  assert.equal(result.files.generationJson.style_correction.mode, 'palette_snap')
  assert.ok(result.files.generationJson.style_correction.changed_pixel_count > 0)
  assert.notDeepEqual(result.files.tilesetPng, providerPng)
})

test('generateSceneTilePack can opt into local edge conditioning before writing tile artifacts', async () => {
  const providerPng = await encodeRgbaPng(makeMismatchedTileSheet())
  const fetchImpl = async () => ({
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
  })

  const result = await generateSceneTilePack({
    description: 'mossy cliff path',
    width: 2,
    height: 2,
    pattern: 'solid',
    providerPresetId: 'scene-provider',
    edgeConditioning: { enabled: true, band: 3 },
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
    },
    fetchImpl,
  })

  const writtenTileset = await loadRgba(result.files.tilesetPng)
  const artifactCheck = buildScenePackFromTileSheet({
    source: writtenTileset,
    width: 2,
    height: 2,
    pattern: 'solid',
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.qualityGate.status, 'pass')
  assert.equal(artifactCheck.qualityGate.status, 'pass')
  assert.equal(result.edgeConditioning.enabled, true)
  assert.equal(result.edgeConditioning.mode, 'edge_aware_conditioning_v1')
  assert.equal(result.edgeConditioning.band, 3)
  assert.ok(result.edgeConditioning.changed_pixel_count > 0)
  assert.ok(result.edgeConditioning.changed_pixel_ratio < 0.3398)
  assert.equal(result.tileConditioningReview.status, 'warning')
  assert.equal(result.files.generationJson.edge_conditioning.enabled, true)
  assert.equal(result.files.generationJson.edge_conditioning.mode, 'edge_aware_conditioning_v1')
  assert.equal(result.files.generationJson.edge_conditioning.band, 3)
  assert.equal(result.files.generationJson.tile_conditioning_review.status, 'warning')
  assert.ok(Buffer.isBuffer(result.files.tileConditioningReviewPng))
})
