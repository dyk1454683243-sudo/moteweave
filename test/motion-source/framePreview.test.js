import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMotionFramePreviewArtifacts } from '../../src/motion-source/framePreview.js'

function blankFrame(width = 8, height = 8) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }
}

test('motion frame preview declares auto as the default selection authority', async () => {
  const result = await buildMotionFramePreviewArtifacts([
    blankFrame(),
    blankFrame(),
  ])

  assert.equal(result.index.default_selection_mode, 'auto')
  assert.equal(result.index.schema_version, 2)
  assert.equal(result.index.mode, 'motion_frame_preview_index_v2')
  assert.equal(result.index.frames.length, 2)
  assert.equal(result.index.frames.every((frame) => frame.selected === true), true)
  assert.deepEqual(
    result.index.frames.map((frame) => ({
      source_index: frame.source_index,
      output_index: frame.output_index,
      candidate_index: frame.candidate_index,
      raw_index: frame.raw_index,
    })),
    [
      { source_index: 0, output_index: 0, candidate_index: 0, raw_index: 0 },
      { source_index: 1, output_index: 1, candidate_index: 1, raw_index: 1 },
    ]
  )
})

test('motion frame preview emits extraction provenance beside legacy indexes', async () => {
  const result = await buildMotionFramePreviewArtifacts([
    blankFrame(),
    blankFrame(),
  ], {
    frameProvenance: [
      {
        candidate_index: 0,
        raw_index: 1,
        timestamp_ms: 80,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_02.png',
      },
      {
        candidate_index: 1,
        raw_index: 3,
        timestamp_ms: 240,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_04.png',
      },
    ],
  })

  assert.deepEqual(
    result.index.frames.map((frame) => ({
      source_index: frame.source_index,
      output_index: frame.output_index,
      candidate_index: frame.candidate_index,
      raw_index: frame.raw_index,
      timestamp_ms: frame.timestamp_ms,
      duration_ms: frame.duration_ms,
      timing_source: frame.timing_source,
      source_entry: frame.source_entry,
      selected: frame.selected,
    })),
    [
      {
        source_index: 0,
        output_index: 0,
        candidate_index: 0,
        raw_index: 1,
        timestamp_ms: 80,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_02.png',
        selected: true,
      },
      {
        source_index: 1,
        output_index: 1,
        candidate_index: 1,
        raw_index: 3,
        timestamp_ms: 240,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_04.png',
        selected: true,
      },
    ]
  )
})

test('motion frame preview rejects provenance that is not aligned with candidates', async () => {
  await assert.rejects(
    () => buildMotionFramePreviewArtifacts([blankFrame()], {
      frameProvenance: [{
        candidate_index: 1,
        raw_index: 1,
      }],
    }),
    /candidate_index_mismatch/
  )
})
