import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { runSceneTileCorrectionMatrix } from '../../src/scene-pack/benchmark/sceneTileCorrectionMatrix.js'
import { getTileSourceRegion } from '../../src/scene-pack/tileProfile.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3] ?? 255
}

function fillRect(image, rect, rgba) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) setPixel(image, x, y, rgba)
  }
}

function makeSheet() {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    fillRect(image, { x: region.col * 48, y: region.row * 48, w: 48, h: 48 }, [240, 40, 200, 255])
    fillRect(image, region, [80, 120, 60, 255])
  }
  return image
}

function makeMismatchedSheet() {
  const image = makeSheet()
  const colors = [
    [220, 30, 30, 255],
    [30, 210, 80, 255],
    [40, 60, 220, 255],
    [230, 210, 50, 255],
  ]
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    fillRect(image, { x: region.x, y: region.y, w: region.w, h: 1 }, colors[mask % colors.length])
    fillRect(image, { x: region.x, y: region.y + region.h - 1, w: region.w, h: 1 }, colors[(mask + 1) % colors.length])
    fillRect(image, { x: region.x, y: region.y, w: 1, h: region.h }, colors[(mask + 2) % colors.length])
    fillRect(image, { x: region.x + region.w - 1, y: region.y, w: 1, h: region.h }, colors[(mask + 3) % colors.length])
  }
  return image
}

test('runSceneTileCorrectionMatrix writes raw, style, and edge-aware comparison artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-tile-correction-matrix-'))
  const input = path.join(root, 'scene.png')
  await writeFile(input, await encodeRgbaPng(makeSheet()))

  const result = await runSceneTileCorrectionMatrix({
    inputs: [{ file: input, id: 'forest_case' }],
    outputDir: root,
    runId: 'matrix_test',
    width: 2,
    height: 2,
    pattern: 'solid',
    gatePolicy: { raw_tile_quality: 'strict' },
  })

  assert.equal(result.mode, 'scene_tile_correction_matrix_v0')
  assert.equal(result.summary.input_count, 1)
  assert.equal(result.summary.variant_count, 3)
  assert.equal(result.summary.total_items, 3)
  assert.deepEqual(result.summary.by_variant.map((variant) => variant.id), [
    'raw',
    'style_snap',
    'style_snap_edge_aware',
  ])
  assert.equal(result.summary.correction_dependency.corrected_item_count, 2)
  assert.equal(result.summary.correction_dependency.uncorrected_item_count, 1)
  assert.equal(result.summary.raw_quality_readiness.status, 'ready')
  assert.deepEqual(result.summary.raw_quality_readiness.blockers, [])
  assert.equal(result.summary.raw_quality_diagnostics.status, 'pass')
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.visual_seam_failures, 0)
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.self_loop_failures, 0)
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.source_atlas_continuities, 0)
  assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].sample_id, 'forest_case')
  assert.equal(result.samples[0].variants.raw.status, 'pass')
  assert.equal(result.samples[0].variants.style_snap.status, 'pass')
  assert.equal(result.samples[0].variants.style_snap_edge_aware.status, 'pass')
  assert.equal(result.report.summary.total, 3)
  assert.equal(await exists(path.join(root, 'matrix_test', 'scene_tile_correction_matrix.json')), true)
  assert.equal(await exists(path.join(root, 'matrix_test', 'scene_tile_report.json')), true)
  assert.equal(await exists(path.join(root, 'matrix_test', 'items', 'forest_case_raw', 'quality_gate.json')), true)
  assert.equal(await exists(path.join(root, 'matrix_test', 'items', 'forest_case_style_snap', 'style_correction.json')), true)
  assert.equal(await exists(path.join(root, 'matrix_test', 'items', 'forest_case_style_snap_edge_aware', 'edge_conditioning.json')), true)

  const saved = JSON.parse(await readFile(path.join(root, 'matrix_test', 'scene_tile_correction_matrix.json'), 'utf8'))
  assert.equal(saved.summary.transitions.raw_to_style_snap.same, 1)
  assert.equal(saved.summary.transitions.style_snap_to_style_snap_edge_aware.same, 1)
  assert.deepEqual(saved.summary.blocker_taxonomy_by_variant.find((item) => item.variant_id === 'raw').top_categories, [])
  assert.equal(saved.summary.gate_transitions.raw_to_style_snap.find((gate) => gate.id === 'visual_seams').same, 1)
})

test('runSceneTileCorrectionMatrix summarizes raw blockers and gate transitions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-tile-correction-matrix-blockers-'))
  const input = path.join(root, 'scene.png')
  await writeFile(input, await encodeRgbaPng(makeMismatchedSheet()))

  const result = await runSceneTileCorrectionMatrix({
    inputs: [{ file: input, id: 'rough_case' }],
    outputDir: root,
    runId: 'matrix_blockers_test',
    width: 2,
    height: 2,
    pattern: 'solid',
    gatePolicy: { raw_tile_quality: 'strict' },
  })

  const rawCategories = result.summary.blocker_taxonomy_by_variant.find((item) => item.variant_id === 'raw').top_categories
  assert.equal(result.summary.raw_quality_readiness.status, 'not_ready')
  assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_variant_failures'))
  assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_visual_seam_failures'))
  assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_self_loop_failures'))
  assert.equal(result.summary.raw_quality_diagnostics.status, 'fail')
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.visual_seam_failures, 4)
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.self_loop_failures, 32)
  assert.equal(result.summary.raw_quality_diagnostics.issue_counts.source_atlas_continuities, 0)
  assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].sample_id, 'rough_case')
  assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].visual_seam_failure_count, 4)
  assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].self_loop_failure_count, 32)
  assert.equal(result.summary.raw_quality_diagnostics.worst_visual_seams[0].sample_id, 'rough_case')
  assert.equal(result.summary.raw_quality_diagnostics.worst_self_loops[0].sample_id, 'rough_case')
  assert.equal(rawCategories.find((item) => item.id === 'tile.visual_seam_mismatch').count, 1)
  assert.equal(rawCategories.find((item) => item.id === 'tile.self_loop_mismatch').count, 1)
  assert.equal(result.summary.gate_transitions.raw_to_style_snap_edge_aware.find((gate) => gate.id === 'visual_seams').improved, 1)
  assert.equal(result.summary.gate_transitions.raw_to_style_snap_edge_aware.find((gate) => gate.id === 'tile_self_loops').improved, 1)
  assert.equal(result.summary.blocker_transitions.raw_to_style_snap_edge_aware.find((item) => item.id === 'tile.visual_seam_mismatch').resolved, 1)
  assert.equal(result.samples[0].variants.raw.status, 'fail')
  assert.equal(result.samples[0].variants.style_snap_edge_aware.status, 'pass')
})
