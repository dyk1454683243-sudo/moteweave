import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { renderStrictAtlasPng } from '../../src/two-point-five-d/atlasExporter.js'
import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'
import {
  buildTwoPointFiveDValidationReport,
  validateRenderedTilesetPng,
} from '../../src/two-point-five-d/tilesetPixelValidator.js'

test('validateRenderedTilesetPng passes deterministic procedural strict atlas pixels', async () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const strictAtlasPng = await renderStrictAtlasPng(plan)
  const pixelValidation = await validateRenderedTilesetPng({ plan, strictAtlasPng })
  const report = buildTwoPointFiveDValidationReport({ plan, pixelValidation })

  assert.equal(pixelValidation.status, 'pass')
  assert.equal(pixelValidation.metrics.image_size.width, 1024)
  assert.equal(pixelValidation.metrics.semi_transparent_pixel_count, 0)
  assert.equal(pixelValidation.metrics.outside_rule_cell_pixel_count, 0)
  assert.equal(pixelValidation.per_tile_diagnostics.length, 16)
  assert.equal(pixelValidation.per_tile_diagnostics.find((tile) => tile.mask === 0).visible_bounds.visible_pixel_count, 0)
  assert.equal(report.status, 'pass')
  assert.equal(report.metrics.pixel_validation.checked_tile_count, 16)
})

test('validateRenderedTilesetPng fails visible pixels outside rule cells', async () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const strictAtlasPng = await renderStrictAtlasPng(plan)
  const polluted = await sharp(strictAtlasPng)
    .composite([
      {
        input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="512" y="512" width="2" height="2" fill="#ffffff"/></svg>'),
      },
    ])
    .png()
    .toBuffer()

  const pixelValidation = await validateRenderedTilesetPng({ plan, strictAtlasPng: polluted })

  assert.equal(pixelValidation.status, 'fail')
  assert.ok(pixelValidation.blocking_errors.includes('visible_pixels_outside_rule_cells'))
  assert.ok(pixelValidation.metrics.outside_rule_cell_pixel_count > 0)
})
