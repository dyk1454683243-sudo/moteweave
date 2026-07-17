import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import {
  extractMaterialPatchSet,
  renderMaterialPatchSheetPng,
} from '../../src/two-point-five-d/materialPatchExtractor.js'

async function buildPatchSource() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="32" height="64" fill="#2f8f3f"/>',
    '<rect x="32" y="0" width="32" height="64" fill="#9edb75"/>',
    '<rect x="0" y="0" width="4" height="64" fill="#1e5c28"/>',
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function buildHighColorPatchSource() {
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges">',
  ]
  for (let y = 0; y < 64; y += 4) {
    for (let x = 0; x < 64; x += 4) {
      const r = (x * 3 + y * 5) % 256
      const g = (x * 7 + y * 2) % 256
      const b = (x * 11 + y * 13) % 256
      parts.push(`<rect x="${x}" y="${y}" width="4" height="4" fill="#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}"/>`)
    }
  }
  parts.push('</svg>')
  return sharp(Buffer.from(parts.join(''))).png().toBuffer()
}

async function visibleColorCountFromDataUrl(dataUrl) {
  const buffer = Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64')
  const raw = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const colors = new Set()
  for (let index = 0; index < raw.data.length; index += 4) {
    if (!raw.data[index + 3]) continue
    colors.add(`${raw.data[index]},${raw.data[index + 1]},${raw.data[index + 2]},${raw.data[index + 3]}`)
  }
  return colors.size
}

test('extractMaterialPatchSet extracts fixed-size patch assets with diagnostics', async () => {
  const source = await buildPatchSource()
  const extraction = await extractMaterialPatchSet({
    normalizedSourcePng: source,
    patchSize: [16, 16],
    tileableEdges: false,
    samples: [{
      slot: 'top_material',
      material_id: 'grass_top',
      role: 'top',
      sample_region: { x: 0, y: 0, w: 64, h: 64 },
    }],
  })

  assert.equal(extraction.mode, 'material_patch_extraction_v1')
  assert.equal(extraction.status, 'warning')
  assert.equal(extraction.patch_count, 1)
  assert.equal(extraction.patches[0].patch.mode, 'material_patch_v1')
  assert.deepEqual(extraction.patches[0].patch.size, { width: 16, height: 16 })
  assert.match(extraction.patches[0].patch.image_data_url, /^data:image\/png;base64,/)
  assert.ok(extraction.patches[0].diagnostics.metrics.unique_color_count >= 3)
  assert.ok(extraction.patches[0].diagnostics.warnings.includes('material_patch_repeat_edge_delta_top_material'))

  const materialProfile = {
    slots: {
      top_material: { slot: 'top_material', material_id: 'grass_top' },
    },
    materials: {
      grass_top: { patch: extraction.patches[0].patch },
    },
  }
  const sheet = await renderMaterialPatchSheetPng(materialProfile)
  const metadata = await sharp(sheet).metadata()
  assert.deepEqual({ width: metadata.width, height: metadata.height, format: metadata.format }, { width: 80, height: 80, format: 'png' })
})

test('extractMaterialPatchSet normalizes patch edges for tileable fills by default', async () => {
  const source = await buildPatchSource()
  const extraction = await extractMaterialPatchSet({
    normalizedSourcePng: source,
    patchSize: [16, 16],
    samples: [{
      slot: 'top_material',
      material_id: 'grass_top',
      role: 'top',
      sample_region: { x: 0, y: 0, w: 64, h: 64 },
    }],
  })

  assert.equal(extraction.tileability.status, 'active')
  assert.equal(extraction.tileability.changed_patch_count, 1)
  assert.ok(extraction.tileability.changed_pixel_count > 0)
  assert.equal(extraction.patches[0].patch.tileability.status, 'active')
  assert.equal(extraction.patches[0].diagnostics.warnings.includes('material_patch_repeat_edge_delta_top_material'), false)
  assert.ok(extraction.patches[0].diagnostics.metrics.opposing_edge_delta.max <= 72)
})

test('extractMaterialPatchSet limits patch palettes from the contract color budget', async () => {
  const source = await buildHighColorPatchSource()
  const extraction = await extractMaterialPatchSet({
    normalizedSourcePng: source,
    patchSize: [16, 16],
    paletteMaxColors: 9,
    samples: [
      {
        slot: 'top_material',
        material_id: 'grass_top',
        role: 'top',
        sample_region: { x: 0, y: 0, w: 32, h: 64 },
      },
      {
        slot: 'side_material',
        material_id: 'dirt_side',
        role: 'side',
        sample_region: { x: 32, y: 0, w: 32, h: 64 },
      },
    ],
  })

  assert.equal(extraction.palette_limit.status, 'active')
  assert.equal(extraction.palette_limit.patch_color_budget, 4)
  assert.equal(extraction.palette_limit.expected_max_visible_colors, 9)
  for (const item of extraction.patches) {
    assert.equal(item.patch.palette_limit.color_budget, 4)
    assert.ok(await visibleColorCountFromDataUrl(item.patch.image_data_url) <= 4)
  }
})
