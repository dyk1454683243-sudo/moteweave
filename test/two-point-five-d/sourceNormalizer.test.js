import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { normalizeTwoPointFiveDMaterialSource } from '../../src/two-point-five-d/sourceNormalizer.js'

test('normalizeTwoPointFiveDMaterialSource converts arbitrary source images into a controlled material canvas', async () => {
  const source = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 3,
      background: '#4c8c42',
    },
  })
    .jpeg()
    .toBuffer()

  const normalized = await normalizeTwoPointFiveDMaterialSource({
    sourceBuffer: source,
    sourceId: 'manual terrain source.jpg',
  })
  const meta = await sharp(normalized.normalizedPng).metadata()

  assert.equal(normalized.report.mode, 'two_point_five_d_source_normalization_v0')
  assert.equal(normalized.report.status, 'warning')
  assert.equal(normalized.report.source_id, 'manual_terrain_source_jpg')
  assert.deepEqual({ width: meta.width, height: meta.height, format: meta.format, channels: meta.channels }, {
    width: 1024,
    height: 1024,
    format: 'png',
    channels: 4,
  })
  assert.ok(normalized.report.warnings.includes('source_format_normalized_to_png'))
  assert.ok(normalized.report.warnings.includes('source_size_normalized_to_target_canvas'))
})
