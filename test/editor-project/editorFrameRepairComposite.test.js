import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

import * as editorProject from '../../src/editor-project/index.js'
import {
  buildFrameRepairMaskVisualization,
  buildFrameRepairQualityReport,
  compositeFrameRepairCandidate,
  extractFrameRgba,
  frameOrigin,
  normalizeFrameRepairCandidate,
  runsToBitset,
  verifyFrameRepairIntegrity,
} from '../../src/editor-project/frameRepairComposite.js'

function rgba(width, height, value = 0) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(value) }
}

function setPixel(image, x, y, [r, g, b, a = 255]) {
  const offset = (y * image.width + x) * 4
  image.data.set([r, g, b, a], offset)
}

function fillRect(image, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) setPixel(image, xx, yy, color)
  }
}

async function pngFor(image) {
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).png().toBuffer()
}

function normalizationFixture() {
  const parentFrame = rgba(8, 8)
  fillRect(parentFrame, 2, 2, 4, 5, [160, 32, 48, 255])
  setPixel(parentFrame, 2, 2, [24, 24, 32, 255])
  const parentSheet = rgba(16, 8)
  for (let y = 0; y < 8; y += 1) {
    parentSheet.data.set(parentFrame.data.subarray(y * 8 * 4, (y + 1) * 8 * 4), y * 16 * 4)
  }
  fillRect(parentSheet, 10, 2, 4, 5, [32, 72, 160, 255])
  return { parentFrame, parentSheet, frameSize: { w: 8, h: 8 } }
}

async function assertNormalizeCode(input, code) {
  await assert.rejects(normalizeFrameRepairCandidate(input), (error) => error?.code === code)
}

function frameRepairQualityEvidenceFixture() {
  const bbox = { x: 0, y: 0, w: 2, h: 2, right: 1, bottom: 1, centerX: 1, centerY: 1 }
  const footAnchor = { x: 1, y: 1, mode: 'lower-body-foot' }
  const halo = { near_white_edge_pixels: 0, semi_transparent_edge_pixels: 0 }
  const alpha = { visible_pixels: 4, opaque_pixels: 4, semi_transparent_pixels: 0 }
  const components = { count: 1, total_count: 1, threshold: 1, areas: [4] }
  const continuityMetrics = {
    foot_anchor_distance: 0,
    bbox_center_distance: 0,
    baseline_delta: 0,
    visible_pixel_delta: 0,
  }
  return {
    complete: true,
    before: {
      bbox: structuredClone(bbox),
      foot_anchor: structuredClone(footAnchor),
      baseline: 1,
      visible_pixels: 4,
    },
    after: {
      bbox: structuredClone(bbox),
      foot_anchor: structuredClone(footAnchor),
      baseline: 1,
      visible_pixels: 4,
    },
    integrity: {
      attempted_outside_mask_changed: 2,
      actual_outside_mask_changed: 0,
      actual_non_target_changed: 0,
      non_target_equal: true,
      target_outside_mask_equal: true,
      changed_inside_mask: 1,
    },
    halo: {
      before: structuredClone(halo),
      candidate: structuredClone(halo),
      after: structuredClone(halo),
    },
    alpha: {
      before: structuredClone(alpha),
      candidate: structuredClone(alpha),
      after: structuredClone(alpha),
    },
    significant_components: {
      before: structuredClone(components),
      candidate: structuredClone(components),
      after: structuredClone(components),
    },
    continuity: {
      status: 'measured',
      warnings: [],
      frames: [{
        role: 'previous',
        before: structuredClone(continuityMetrics),
        after: structuredClone(continuityMetrics),
        delta: structuredClone(continuityMetrics),
      }],
    },
    validation: {
      status: 'pass',
      warnings: [],
      blocking_errors: [],
      deltas: {
        warnings_added: [],
        warnings_removed: [],
        blocking_errors_added: [],
        blocking_errors_removed: [],
      },
    },
  }
}

function withoutPath(value, path) {
  const cloned = structuredClone(value)
  const parts = path.split('.')
  let target = cloned
  for (const part of parts.slice(0, -1)) target = target[part]
  delete target[parts.at(-1)]
  return cloned
}

function withPath(value, path, replacement) {
  const cloned = structuredClone(value)
  const parts = path.split('.')
  let target = cloned
  for (const part of parts.slice(0, -1)) target = target[part]
  target[parts.at(-1)] = replacement
  return cloned
}

test('frame repair composite API is exported from editor-project', () => {
  assert.equal(editorProject.buildFrameRepairMaskVisualization, buildFrameRepairMaskVisualization)
  assert.equal(editorProject.compositeFrameRepairCandidate, compositeFrameRepairCandidate)
  assert.equal(editorProject.extractFrameRgba, extractFrameRgba)
  assert.equal(editorProject.frameOrigin, frameOrigin)
  assert.equal(editorProject.runsToBitset, runsToBitset)
  assert.equal(editorProject.verifyFrameRepairIntegrity, verifyFrameRepairIntegrity)
  assert.equal(editorProject.buildFrameRepairQualityReport, buildFrameRepairQualityReport)
  assert.equal(editorProject.normalizeFrameRepairCandidate, normalizeFrameRepairCandidate)
})

test('canonical mask visualization is deterministic and leaves its target unchanged', () => {
  const target = rgba(2, 1)
  setPixel(target, 0, 0, [12, 24, 36, 200])
  setPixel(target, 1, 0, [48, 60, 72, 80])
  const snapshot = new Uint8ClampedArray(target.data)

  const visualization = buildFrameRepairMaskVisualization(target, {
    width: 2,
    height: 1,
    runs: [{ start: 1, length: 1 }],
  })

  assert.deepEqual(Array.from(visualization.data), [
    12, 24, 36, 64,
    255, 56, 176, 255,
  ])
  assert.deepEqual(target.data, snapshot)
  assert.throws(() => buildFrameRepairMaskVisualization(target, {
    width: 1,
    height: 1,
    runs: [{ start: 0, length: 1 }],
  }))
})

test('mask composite preserves every non-target and target-outside-mask RGBA byte', () => {
  const parent = rgba(4, 2, 10)
  const candidate = rgba(2, 2, 200)
  const parentSnapshot = new Uint8ClampedArray(parent.data)
  const candidateSnapshot = new Uint8ClampedArray(candidate.data)

  const result = compositeFrameRepairCandidate({
    parentSheet: parent,
    candidateFrame: candidate,
    sheetFrameIndex: 1,
    frameSize: { w: 2, h: 2 },
    mask: { width: 2, height: 2, runs: [{ start: 1, length: 1 }] },
  })

  assert.equal(result.sheet.data[4], 10)
  assert.equal(result.sheet.data[12], 200)
  assert.equal(result.integrity.non_target_equal, true)
  assert.equal(result.integrity.target_outside_mask_equal, true)
  assert.equal(result.integrity.attempted_outside_mask_changed, 3)
  assert.equal(result.integrity.actual_outside_mask_changed, 0)
  assert.equal(result.integrity.actual_non_target_changed, 0)
  assert.equal(result.integrity.changed_inside_mask, 1)
  assert.deepEqual(parent.data, parentSnapshot)
  assert.deepEqual(candidate.data, candidateSnapshot)
})

test('canonical runs and frame bounds are rejected before compositing', () => {
  const parent = rgba(4, 2, 10)
  const candidate = rgba(2, 2, 200)
  for (const runs of [
    [{ start: -1, length: 1 }],
    [{ start: 0, length: 0 }],
    [{ start: 3, length: 2 }],
    [{ start: 1, length: 1 }, { start: 0, length: 1 }],
    [{ start: 0, length: 1 }, { start: 1, length: 1 }],
  ]) {
    assert.throws(() => compositeFrameRepairCandidate({
      parentSheet: parent,
      candidateFrame: candidate,
      sheetFrameIndex: 1,
      frameSize: { w: 2, h: 2 },
      mask: { width: 2, height: 2, runs },
    }))
  }
  assert.throws(() => compositeFrameRepairCandidate({
    parentSheet: parent,
    candidateFrame: candidate,
    sheetFrameIndex: 2,
    frameSize: { w: 2, h: 2 },
    mask: { width: 2, height: 2, runs: [{ start: 0, length: 1 }] },
  }))
})

test('quality policy applies fail, unknown, and warning precedence to real evidence groups', () => {
  const base = frameRepairQualityEvidenceFixture()
  assert.equal(buildFrameRepairQualityReport(base).status, 'pass')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    integrity: { ...base.integrity, actual_outside_mask_changed: 1 },
    complete: false,
  }).status, 'fail')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    validation: { ...base.validation, status: 'fail', blocking_errors: ['frame_1_cropped'] },
  }).status, 'fail')
  assert.equal(buildFrameRepairQualityReport({ ...base, complete: false }).status, 'unknown')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    complete: false,
    validation: { ...base.validation, status: 'warning', warnings: ['halo_score_high'] },
  }).status, 'unknown')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    validation: { ...base.validation, status: 'warning', warnings: ['halo_score_high'] },
  }).status, 'warning')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    continuity: { ...base.continuity, status: 'warning', warnings: ['clip_continuity_delta'] },
  }).status, 'warning')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    integrity: { ...base.integrity, changed_inside_mask: 0 },
  }).status, 'warning')
  assert.equal(buildFrameRepairQualityReport({
    ...base,
    integrity: { ...base.integrity, attempted_outside_mask_changed: 99 },
  }).status, 'pass')
})

test('quality completeness requires every nested measured fact with stable missing paths', () => {
  const base = frameRepairQualityEvidenceFixture()
  const requiredPaths = [
    'before.bbox',
    'before.foot_anchor',
    'before.baseline',
    'before.visible_pixels',
    'after.bbox',
    'after.foot_anchor',
    'after.baseline',
    'after.visible_pixels',
    'integrity.attempted_outside_mask_changed',
    'integrity.actual_outside_mask_changed',
    'integrity.actual_non_target_changed',
    'integrity.target_outside_mask_equal',
    'integrity.non_target_equal',
    'integrity.changed_inside_mask',
    ...['before', 'candidate', 'after'].flatMap((stage) => [
      `halo.${stage}.near_white_edge_pixels`,
      `halo.${stage}.semi_transparent_edge_pixels`,
      `alpha.${stage}.visible_pixels`,
      `alpha.${stage}.opaque_pixels`,
      `alpha.${stage}.semi_transparent_pixels`,
      `significant_components.${stage}.count`,
      `significant_components.${stage}.total_count`,
      `significant_components.${stage}.threshold`,
      `significant_components.${stage}.areas`,
    ]),
    'continuity.status',
    'continuity.warnings',
    'validation.status',
    'validation.warnings',
    'validation.blocking_errors',
    'validation.deltas',
  ]

  for (const path of requiredPaths) {
    const report = buildFrameRepairQualityReport(withoutPath(base, path))
    assert.equal(report.status, 'unknown', path)
    assert.ok(report.completeness.missing.includes(path), `${path}: ${report.completeness.missing}`)
  }

  const withoutContinuityMeasurements = withoutPath(base, 'continuity.frames')
  const continuityReport = buildFrameRepairQualityReport(withoutContinuityMeasurements)
  assert.equal(continuityReport.status, 'unknown')
  assert.ok(continuityReport.completeness.missing.includes('continuity.frames'))

  const measuredEmpty = structuredClone(base)
  for (const stage of ['before', 'after']) {
    measuredEmpty[stage].bbox = null
    measuredEmpty[stage].foot_anchor = null
    measuredEmpty[stage].baseline = null
    measuredEmpty[stage].visible_pixels = 0
  }
  assert.equal(buildFrameRepairQualityReport(measuredEmpty).status, 'pass')
})

test('quality completeness requires strictly measured continuity frames', () => {
  const base = frameRepairQualityEvidenceFixture()
  const deltasOnly = {
    ...base,
    continuity: { status: 'measured', warnings: [], deltas: [{}] },
  }
  const deltasOnlyReport = buildFrameRepairQualityReport(deltasOnly)
  assert.equal(deltasOnlyReport.status, 'unknown')
  assert.ok(deltasOnlyReport.completeness.missing.includes('continuity.frames'))

  const missingMetric = withoutPath(base, 'continuity.frames.0.before.foot_anchor_distance')
  const missingMetricReport = buildFrameRepairQualityReport(missingMetric)
  assert.equal(missingMetricReport.status, 'unknown')
  assert.ok(missingMetricReport.completeness.missing.includes('continuity.frames'))

  const noAdjacentFrames = {
    ...base,
    continuity: { status: 'measured', warnings: [], frames: [] },
  }
  assert.equal(buildFrameRepairQualityReport(noAdjacentFrames).status, 'pass')

  const integrityFailure = buildFrameRepairQualityReport({
    ...deltasOnly,
    integrity: { ...base.integrity, actual_outside_mask_changed: 1 },
  })
  assert.equal(integrityFailure.status, 'fail')
  assert.ok(integrityFailure.completeness.missing.includes('continuity.frames'))

  const validatorFailure = buildFrameRepairQualityReport({
    ...deltasOnly,
    validation: { ...base.validation, status: 'fail', blocking_errors: ['frame_1_cropped'] },
  })
  assert.equal(validatorFailure.status, 'fail')
  assert.ok(validatorFailure.completeness.missing.includes('continuity.frames'))
})

test('quality completeness rejects malformed nested facts and preserves failure precedence', () => {
  const base = frameRepairQualityEvidenceFixture()
  const malformed = [
    ['before.bbox', { x: 0, y: 0, w: 0, h: 2, right: 0, bottom: 1, centerX: 0, centerY: 1 }],
    ['after.foot_anchor', { x: -1, y: 1, mode: 'lower-body-foot' }],
    ['before.baseline', Number.POSITIVE_INFINITY],
    ['integrity.attempted_outside_mask_changed', -1],
    ['integrity.actual_outside_mask_changed', Number.MAX_SAFE_INTEGER + 1],
    ['integrity.target_outside_mask_equal', 'true'],
    ['halo.before.near_white_edge_pixels', -1],
    ['alpha.candidate.visible_pixels', -1],
    ['significant_components.after.areas', 'not-an-array'],
    ['significant_components.before.areas', [-1]],
    ['continuity.warnings', [1]],
    ['continuity.frames', [{ role: '', before: {}, after: {}, delta: {} }]],
    ['validation.warnings', [1]],
    ['validation.deltas.warnings_added', 'not-an-array'],
  ]
  for (const [path, value] of malformed) {
    const report = buildFrameRepairQualityReport(withPath(base, path, value))
    assert.equal(report.status, 'unknown', path)
    assert.ok(report.completeness.missing.includes(path), `${path}: ${report.completeness.missing}`)
  }

  const incomplete = withoutPath(base, 'before.bbox')
  const integrityFailure = buildFrameRepairQualityReport({
    ...incomplete,
    integrity: { ...incomplete.integrity, actual_outside_mask_changed: 1 },
  })
  assert.equal(integrityFailure.status, 'fail')
  assert.ok(integrityFailure.completeness.missing.includes('before.bbox'))

  const validatorFailure = buildFrameRepairQualityReport({
    ...incomplete,
    validation: {
      ...incomplete.validation,
      status: 'fail',
      blocking_errors: ['frame_1_cropped'],
    },
  })
  assert.equal(validatorFailure.status, 'fail')
  assert.ok(validatorFailure.completeness.missing.includes('before.bbox'))
})

test('quality report derives structural evidence from actual frames, mask, adjacency, and full validation', () => {
  const parentFrame = rgba(4, 4)
  fillRect(parentFrame, 1, 1, 2, 2, [160, 32, 48, 255])
  const normalizedProviderFrame = { ...parentFrame, data: new Uint8ClampedArray(parentFrame.data) }
  setPixel(normalizedProviderFrame, 1, 1, [32, 72, 160, 255])
  setPixel(normalizedProviderFrame, 2, 1, [24, 24, 32, 255])
  const compositedFrame = { ...parentFrame, data: new Uint8ClampedArray(parentFrame.data) }
  setPixel(compositedFrame, 1, 1, [32, 72, 160, 255])
  const validation = {
    status: 'pass',
    warnings: [],
    blocking_errors: [],
    deltas: {
      warnings_added: [],
      warnings_removed: [],
      blocking_errors_added: [],
      blocking_errors_removed: [],
    },
  }

  const report = buildFrameRepairQualityReport({
    complete: true,
    parentFrame,
    compositedFrame,
    normalizedProviderFrame,
    mask: { width: 4, height: 4, runs: [{ start: 5, length: 1 }] },
    integrity: { actual_non_target_changed: 0, non_target_equal: true },
    adjacentClipFrames: [{ role: 'previous', frame: parentFrame }],
    validation,
  })

  assert.equal(report.status, 'pass')
  assert.deepEqual(report.before.bbox, {
    x: 1, y: 1, w: 2, h: 2, right: 2, bottom: 2, centerX: 2, centerY: 2,
  })
  assert.equal(report.before.baseline, 2)
  assert.equal(report.after.foot_anchor.y, 2)
  assert.equal(report.integrity.changed_inside_mask, 1)
  assert.equal(report.integrity.attempted_outside_mask_changed, 1)
  assert.equal(report.integrity.actual_outside_mask_changed, 0)
  assert.equal(report.integrity.actual_non_target_changed, 0)
  assert.equal(report.halo.before.near_white_edge_pixels, 0)
  assert.equal(report.alpha.after.visible_pixels, 4)
  assert.equal(report.significant_components.candidate.count, 1)
  assert.equal(report.continuity.frames.length, 1)
  assert.deepEqual(report.validation.deltas, validation.deltas)
  assert.equal(report.completeness.complete, true)
})

test('candidate normalization rejects untrusted buffers, formats, dimensions, empty, full-sheet, and multi-subject output', async () => {
  const fixture = normalizationFixture()
  const base = { ...fixture }
  for (const providerBuffer of [null, Buffer.alloc(0), Buffer.alloc(32 * 1024 * 1024 + 1), Buffer.from('corrupt')]) {
    await assertNormalizeCode({ ...base, providerBuffer }, 'provider_output_invalid')
  }

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>')
  await assertNormalizeCode({ ...base, providerBuffer: svg }, 'provider_output_invalid')

  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQBCgABACwAAAAAAQABAAACAkwBADsh+QQBCgABACwAAAAAAQABAAACAkwBADs=', 'base64')
  await assertNormalizeCode({ ...base, providerBuffer: gif }, 'provider_output_invalid')

  const tooWide = await sharp({
    create: { width: 2049, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  }).png().toBuffer()
  await assertNormalizeCode({ ...base, providerBuffer: tooWide }, 'provider_output_invalid')

  await assertNormalizeCode({ ...base, providerBuffer: await pngFor(rgba(8, 8)) }, 'provider_output_empty')
  await assertNormalizeCode({ ...base, providerBuffer: await pngFor(rgba(16, 8, 80)) }, 'provider_output_full_sheet')

  const multiple = rgba(8, 8)
  fillRect(multiple, 1, 2, 2, 2, [180, 30, 30, 255])
  fillRect(multiple, 5, 2, 2, 2, [30, 30, 180, 255])
  await assertNormalizeCode({ ...base, providerBuffer: await pngFor(multiple) }, 'provider_output_multiple_subjects')
})

test('JPEG and WebP candidates are decoded once to RGBA and re-encoded as actual PNG evidence', async () => {
  const fixture = normalizationFixture()
  const source = rgba(8, 8, 255)
  fillRect(source, 2, 1, 4, 6, [170, 35, 45, 255])
  for (const providerBuffer of [
    await sharp(Buffer.from(source.data), { raw: { width: 8, height: 8, channels: 4 } }).jpeg({ quality: 95 }).toBuffer(),
    await sharp(Buffer.from(source.data), { raw: { width: 8, height: 8, channels: 4 } }).webp({ lossless: true }).toBuffer(),
  ]) {
    const expected = await sharp(providerBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const result = await normalizeFrameRepairCandidate({ ...fixture, providerBuffer })
    assert.deepEqual([...result.raw_provider_png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const actual = await sharp(result.raw_provider_png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(actual.info.width, expected.info.width)
    assert.equal(actual.info.height, expected.info.height)
    assert.deepEqual(actual.data, expected.data)
  }
})

test('candidate normalization uses nearest fit, parent foot anchor, parent palette, and cleanup without mutation', async () => {
  const fixture = normalizationFixture()
  const source = rgba(6, 6)
  fillRect(source, 1, 1, 2, 3, [247, 18, 41, 255])
  setPixel(source, 5, 0, [0, 255, 0, 255])
  const parentFrameSnapshot = new Uint8ClampedArray(fixture.parentFrame.data)
  const parentSheetSnapshot = new Uint8ClampedArray(fixture.parentSheet.data)
  const providerBuffer = await pngFor(source)
  const providerSnapshot = Buffer.from(providerBuffer)

  const result = await normalizeFrameRepairCandidate({ ...fixture, providerBuffer })

  assert.equal(result.normalized_candidate_frame.width, 8)
  assert.equal(result.normalized_candidate_frame.height, 8)
  assert.equal(result.transforms.resize, 'nearest')
  assert.equal(result.transforms.palette_source, 'parent_sheet')
  assert.equal(result.transforms.target_bbox.bottom, 6)
  assert.equal(result.finishing.normalized_anchor.y, 6)
  assert.equal(result.finishing.significant_components.count, 1)
  assert.ok(result.finishing.component_cleanup.removed_pixels >= 1)
  assert.ok(result.finishing.palette.changed_pixel_count > 0)
  assert.deepEqual([...result.normalized_candidate_frame_png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual(fixture.parentFrame.data, parentFrameSnapshot)
  assert.deepEqual(fixture.parentSheet.data, parentSheetSnapshot)
  assert.deepEqual(providerBuffer, providerSnapshot)
})
