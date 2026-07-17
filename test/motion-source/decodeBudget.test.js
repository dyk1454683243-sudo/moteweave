import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMotionDecodeBudget,
  decodedRgbaBytes,
  DEFAULT_MOTION_DECODE_LIMITS,
} from '../../src/motion-source/decodeBudget.js'

function expectBudgetError(fn, budget) {
  assert.throws(
    fn,
    (error) => (
      error?.code === 'decode_budget_exceeded' &&
      error?.budget === budget &&
      error?.non_retryable === true
    )
  )
}

test('motion decode budget exposes the approved default ceilings', () => {
  assert.deepEqual(DEFAULT_MOTION_DECODE_LIMITS, {
    zip_entry_count: 256,
    zip_uncompressed_bytes: 256 * 1024 * 1024,
    page_count: 240,
    decoded_frame_count: 240,
    frame_pixels: 16_777_216,
    aggregate_rgba_bytes: 256 * 1024 * 1024,
    extracted_frame_count: 64,
    sampled_frame_count: 64,
  })
})

test('motion decode budget accepts exact ZIP count and uncompressed-byte boundaries', () => {
  const budget = createMotionDecodeBudget()
  assert.deepEqual(budget.assertZipArchive({
    entryCount: 256,
    totalUncompressedBytes: 256 * 1024 * 1024,
  }), {
    entry_count: 256,
    total_uncompressed_bytes: 256 * 1024 * 1024,
  })
})

test('motion decode budget rejects ZIP entry and uncompressed-byte overflow', () => {
  const budget = createMotionDecodeBudget()
  expectBudgetError(
    () => budget.assertZipArchive({
      entryCount: 257,
      totalUncompressedBytes: 1,
    }),
    'zip_entry_count'
  )
  expectBudgetError(
    () => budget.assertZipArchive({
      entryCount: 1,
      totalUncompressedBytes: 256 * 1024 * 1024 + 1,
    }),
    'zip_uncompressed_bytes'
  )
})

test('motion decode budget tracks ZIP entries incrementally without committing an overflow', () => {
  const budget = createMotionDecodeBudget({
    limits: {
      zip_entry_count: 2,
      zip_uncompressed_bytes: 10,
    },
  })
  budget.recordZipEntry({ uncompressedBytes: 4 })
  budget.recordZipEntry({ uncompressedBytes: 6 })
  expectBudgetError(
    () => budget.recordZipEntry({ uncompressedBytes: 1 }),
    'zip_entry_count'
  )
  assert.deepEqual(budget.snapshot(), {
    zip_entry_count: 2,
    zip_uncompressed_bytes: 10,
    decoded_frame_count: 0,
    aggregate_rgba_bytes: 0,
    limits: budget.limits,
  })
})

test('motion decode budget enforces GIF and sequence page count', () => {
  const budget = createMotionDecodeBudget()
  assert.equal(budget.assertPageCount(240), 240)
  expectBudgetError(() => budget.assertPageCount(241), 'page_count')
})

test('motion decode budget enforces per-frame pixels and aggregate RGBA bytes', () => {
  const budget = createMotionDecodeBudget({
    limits: {
      decoded_frame_count: 3,
      frame_pixels: 16,
      aggregate_rgba_bytes: 64,
    },
  })
  assert.deepEqual(decodedRgbaBytes({ width: 4, height: 4 }), {
    pixels: 16,
    rgbaBytes: 64,
  })
  const recorded = budget.recordDecodedFrame({ width: 4, height: 4 })
  assert.equal(recorded.frame_pixels, 16)
  assert.equal(recorded.aggregate_rgba_bytes, 64)
  expectBudgetError(
    () => budget.recordDecodedFrame({ width: 5, height: 4 }),
    'frame_pixels'
  )
  expectBudgetError(
    () => budget.recordDecodedFrame({ width: 1, height: 1 }),
    'aggregate_rgba_bytes'
  )
  assert.equal(budget.snapshot().decoded_frame_count, 1)
  assert.equal(budget.snapshot().aggregate_rgba_bytes, 64)
})

test('motion decode budget accepts four maximum-size RGBA frames and rejects the next byte', () => {
  const budget = createMotionDecodeBudget()
  for (let index = 0; index < 4; index += 1) {
    budget.recordDecodedFrame({ width: 4096, height: 4096 })
  }
  assert.equal(
    budget.snapshot().aggregate_rgba_bytes,
    DEFAULT_MOTION_DECODE_LIMITS.aggregate_rgba_bytes
  )
  expectBudgetError(
    () => budget.recordDecodedFrame({ width: 1, height: 1 }),
    'aggregate_rgba_bytes'
  )
  const perFrame = createMotionDecodeBudget()
  expectBudgetError(
    () => perFrame.recordDecodedFrame({ width: 4097, height: 4096 }),
    'frame_pixels'
  )
})

test('motion decode budget limits decoded frame count independently of page metadata', () => {
  const budget = createMotionDecodeBudget({
    limits: {
      decoded_frame_count: 2,
      frame_pixels: 1,
      aggregate_rgba_bytes: 12,
    },
  })
  budget.recordDecodedFrame({ width: 1, height: 1 })
  budget.recordDecodedFrame({ width: 1, height: 1 })
  expectBudgetError(
    () => budget.recordDecodedFrame({ width: 1, height: 1 }),
    'decoded_frame_count'
  )
})

test('motion decode budget enforces extracted and sampled contract maxima', () => {
  const budget = createMotionDecodeBudget()
  assert.equal(budget.assertExtractedFrameCount(64), 64)
  assert.equal(budget.assertSampledFrameCount(64), 64)
  expectBudgetError(
    () => budget.assertExtractedFrameCount(65),
    'extracted_frame_count'
  )
  expectBudgetError(
    () => budget.assertSampledFrameCount(65),
    'sampled_frame_count'
  )
})

test('motion decode budget rejects invalid or unsafe measurements with the stable error code', () => {
  const budget = createMotionDecodeBudget()
  expectBudgetError(() => budget.assertPageCount(-1), 'page_count')
  expectBudgetError(
    () => budget.assertZipArchive({
      entryCount: 1,
      totalUncompressedBytes: Number.MAX_SAFE_INTEGER + 1,
    }),
    'zip_uncompressed_bytes'
  )
  expectBudgetError(
    () => decodedRgbaBytes({ width: 0, height: 10 }),
    'frame_width'
  )
})
