import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { renderStrictAtlasPng } from '../../src/two-point-five-d/atlasExporter.js'
import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'
import { buildTwoPointFiveDGuardedRuleMap } from '../../src/two-point-five-d/terrainRuleMapBuilder.js'
import {
  renderCollisionOverlayPng,
  renderGridOverlayPng,
  renderRandomMapPreviewPng,
  renderRuleMapPreviewPng,
} from '../../src/two-point-five-d/tilesetPreviewGenerator.js'

test('preview generator emits grid, collision, random, and guarded rule map PNGs', async () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const strictAtlasPng = await renderStrictAtlasPng(plan)
  const ruleMap = buildTwoPointFiveDGuardedRuleMap({ plan })
  const gridOverlay = await renderGridOverlayPng(plan, strictAtlasPng)
  const collisionOverlay = await renderCollisionOverlayPng(plan, strictAtlasPng)
  const randomMap = await renderRandomMapPreviewPng(plan, strictAtlasPng)
  const ruleMapPreview = await renderRuleMapPreviewPng(plan, strictAtlasPng, ruleMap)

  const grid = await sharp(gridOverlay).metadata()
  const collision = await sharp(collisionOverlay).metadata()
  const random = await sharp(randomMap).metadata()
  const rule = await sharp(ruleMapPreview).metadata()

  assert.deepEqual({ width: grid.width, height: grid.height, format: grid.format }, { width: 1024, height: 1024, format: 'png' })
  assert.deepEqual({ width: collision.width, height: collision.height, format: collision.format }, { width: 1024, height: 1024, format: 'png' })
  assert.deepEqual({ width: random.width, height: random.height, format: random.format }, { width: 384, height: 272, format: 'png' })
  assert.deepEqual({ width: rule.width, height: rule.height, format: rule.format }, { width: 384, height: 272, format: 'png' })
})
