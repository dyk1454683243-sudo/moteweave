import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../src/character-pack/profile.js'
import {
  isMotionBuildBindingCurrent,
  isMotionPreviewBindingCurrent,
  mapMotionEvidence,
  mapMotionReportOutcome,
  motionApplyCompatibility,
  motionBuildFingerprint,
  motionCandidateFingerprint,
  preservePreviewCandidates,
  restoreAutoFrameSelection,
  serializeMotionSelectionOptions,
} from '../src/ui/motionSource/guidedState.js'

function v2(overrides = {}) {
  return {
    recipe: 'motion_selection_recipe_v2',
    loop_expectation: 'auto',
    temporal_matte: 'disabled',
    ...overrides,
  }
}

function buildOptions(overrides = {}) {
  return {
    action: 'walk_down',
    frames: 4,
    selection_mode: 'auto',
    motion_selection: v2(),
    stride: 1,
    fps: 12,
    maxFrames: 64,
    startSec: 0,
    endSec: null,
    background: {
      method: 'key_color',
      key_color: [255, 255, 255],
      tolerance: 24,
      defringe: true,
    },
    anchor_policy: {
      static_offset_y: 0,
    },
    pixel_grid_refinement: {
      recipe: 'pixel_grid_v2_balanced',
    },
    output_profile: {
      resample_strategy: 'reject_mismatch',
    },
    ...overrides,
  }
}

function completeReport(overrides = {}) {
  return {
    status: 'done',
    contract: {
      source_kind: 'frame_sequence_zip',
      target_frame_count: 4,
      motion_selection: v2(),
    },
    input_frame_count: 8,
    selected_frame_count: 4,
    effective_selection_mode: 'auto',
    source_identity: `sha256:${'a'.repeat(64)}`,
    operation_id: 'motion_build_test',
    options_hash: `sha256:${'b'.repeat(64)}`,
    source_warnings: [],
    warnings: [],
    background: {
      halo_score_before: 0.2,
      halo_score_after: 0.04,
      frames: [],
    },
    frame_selection: {
      mode: 'motion_selection_report_v2',
      status: 'selected',
      recipe: 'motion_selection_recipe_v2',
      settings: v2({ loop_expectation: 'loop' }),
      selected: [{ original_index: 0 }, { original_index: 1 }, { original_index: 2 }, { original_index: 3 }],
      warnings: [],
      target: {
        target_satisfied: true,
        target_frame_count: 4,
        selected_frame_count: 4,
        shortfall_count: 0,
      },
      registration: { status: 'completed' },
      clusters: { status: 'completed' },
      static_gate: { status: 'motion_detected' },
      periodicity: {
        status: 'detected',
        selected_period: 4,
      },
      phase_selection: {
        status: 'selected',
        effective_mode: 'loop',
      },
      temporal_matte: {
        status: 'disabled',
        modifies_pixels: false,
      },
      loop: {
        expectation: 'loop',
        detected_period: 4,
        phase_mode: 'loop',
        seamless: true,
        endpoint_evidence: {
          similarity: 0.91,
        },
      },
    },
    pixel_grid_refinement: {
      schema_version: 2,
      mode: 'pixel_grid_refinement_v2',
      status: 'refined',
      recipe: {
        id: 'pixel_grid_v2_balanced',
      },
      grid: {
        cell_size: 6,
        confidence: 0.91,
        method: 'run_length_mode',
      },
      consensus: {
        support_ratio: 0.875,
        phase_agreement: 0.75,
        rejected_harmonics: [{ cell_size: 12, reason: 'harmonic_alias' }],
      },
      sequence: {
        shared_palette: true,
        shared_grid: true,
        invariants: ['shared_palette', 'shared_grid'],
      },
      warnings: [],
    },
    ...overrides,
  }
}

test('Motion Selection serializer canonicalizes v2 and fails closed on unknown values', () => {
  for (const loopExpectation of ['auto', 'loop', 'once']) {
    for (const temporalMatte of ['disabled', 'evidence_only']) {
      assert.deepEqual(
        serializeMotionSelectionOptions({
          recipe: 'motion_selection_recipe_v2',
          loopExpectation,
          temporalMatte,
        }),
        {
          recipe: 'motion_selection_recipe_v2',
          loop_expectation: loopExpectation,
          temporal_matte: temporalMatte,
        }
      )
    }
  }
  assert.throws(
    () => serializeMotionSelectionOptions({
      recipe: 'future_recipe',
    }),
    { code: 'invalid_motion_selection_recipe' }
  )
  assert.throws(
    () => serializeMotionSelectionOptions(v2({ loop_expectation: 'sometimes' })),
    { code: 'invalid_motion_loop_expectation' }
  )
  assert.throws(
    () => serializeMotionSelectionOptions(v2({ temporal_matte: 'repair' })),
    { code: 'invalid_motion_temporal_matte' }
  )
  assert.throws(
    () => serializeMotionSelectionOptions({ ...v2(), future_threshold: 0.9 }),
    { code: 'unknown_motion_selection_option' }
  )
})

test('Motion Selection v1 is fixed to Auto and Disabled', () => {
  assert.deepEqual(
    serializeMotionSelectionOptions({
      recipe: 'motion_selection_v1_compat',
    }),
    {
      recipe: 'motion_selection_v1_compat',
      loop_expectation: 'auto',
      temporal_matte: 'disabled',
    }
  )
  assert.deepEqual(
    serializeMotionSelectionOptions(false),
    {
      recipe: 'motion_selection_v1_compat',
      loop_expectation: 'auto',
      temporal_matte: 'disabled',
    }
  )
  assert.throws(
    () => serializeMotionSelectionOptions({
      recipe: 'motion_selection_v1_compat',
      loop_expectation: 'loop',
      temporal_matte: 'disabled',
    }),
    { code: 'motion_selection_v1_dependency_violation' }
  )
  assert.throws(
    () => serializeMotionSelectionOptions({
      recipe: 'motion_selection_v1_compat',
      loop_expectation: 'auto',
      temporal_matte: 'evidence_only',
    }),
    { code: 'motion_selection_v1_dependency_violation' }
  )
})

test('candidate fingerprint is deterministic and covers only extraction sampling', () => {
  const first = motionCandidateFingerprint({
    stride: 2,
    fps: 8,
    maxFrames: 32,
    startSec: 0.5,
    endSec: 2,
    background: { tolerance: 80 },
  })
  const equivalent = motionCandidateFingerprint({
    sampling: {
      stride: 2,
      fps: 8,
      max_frames: 32,
      start_sec: 0.5,
      end_sec: 2,
    },
  })
  assert.equal(first, equivalent)
  assert.equal(
    first,
    motionCandidateFingerprint({
      stride: 2,
      fps: 8,
      maxFrames: 32,
      startSec: 0.5,
      endSec: 2,
      selection_mode: 'manual',
      selected_frame_indexes: [3, 1],
    })
  )
  const fields = {
    stride: 3,
    fps: 9,
    maxFrames: 31,
    startSec: 0.25,
    endSec: 2.5,
  }
  for (const [field, value] of Object.entries(fields)) {
    assert.notEqual(
      first,
      motionCandidateFingerprint({
        stride: 2,
        fps: 8,
        maxFrames: 32,
        startSec: 0.5,
        endSec: 2,
        [field]: value,
      }),
      field
    )
  }
  assert.throws(
    () => motionCandidateFingerprint({ startSec: 2, endSec: 1 }),
    { code: 'invalid_motion_sampling_range' }
  )
})

test('build fingerprint includes every strip input and excludes Apply-only values', () => {
  const base = buildOptions()
  const fingerprint = motionBuildFingerprint(base)
  assert.equal(
    fingerprint,
    motionBuildFingerprint({
      ...base,
      output_profile: { resample_strategy: 'nearest_keyframes' },
      sheetFile: { name: 'target.png' },
      stripFile: { name: 'edited.png' },
    })
  )

  const mutations = [
    { action: 'walk_up' },
    { frames: 3 },
    { selection_mode: 'manual', selected_frame_indexes: [3, 1, 0] },
    { motion_selection: v2({ loop_expectation: 'once' }) },
    { motion_selection: v2({ temporal_matte: 'evidence_only' }) },
    { stride: 2 },
    { fps: 10 },
    { maxFrames: 32 },
    { startSec: 0.5 },
    { endSec: 2 },
    { background: { ...base.background, method: 'external_rembg' } },
    { background: { ...base.background, key_color: [0, 255, 0] } },
    { background: { ...base.background, tolerance: 12 } },
    { background: { ...base.background, defringe: false } },
    { anchor_policy: { static_offset_y: -2 } },
    { pixel_grid_refinement: { recipe: 'pixel_grid_v2_detail_safe' } },
    { pixel_grid_refinement: false },
  ]
  for (const mutation of mutations) {
    assert.notEqual(
      fingerprint,
      motionBuildFingerprint({ ...base, ...mutation }),
      JSON.stringify(mutation)
    )
  }
  const manualA = motionBuildFingerprint(buildOptions({
    selection_mode: 'manual',
    selected_frame_indexes: [3, 1, 0],
  }))
  const manualB = motionBuildFingerprint(buildOptions({
    selection_mode: 'manual',
    selected_frame_indexes: [0, 1, 3],
  }))
  assert.notEqual(manualA, manualB)
  assert.throws(
    () => motionBuildFingerprint(buildOptions({
      selection_mode: 'auto',
      selected_frame_indexes: [0],
    })),
    { code: 'auto_selection_conflicts_with_frame_indexes' }
  )
})

test('Preview candidates are immutable full-provenance clones and Restore Auto is canonical', () => {
  const preview = {
    frames: [
      {
        candidate_index: 1,
        source_index: 1,
        raw_index: 4,
        timestamp_ms: 320,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_05.png',
        provenance: {
          candidate_index: 1,
          raw_index: 4,
          nested: { source: 'zip' },
        },
        preview_file: 'frame_previews/frame_00002.png',
        selected: true,
      },
      {
        candidate_index: 0,
        source_index: 0,
        raw_index: 2,
        timestamp_ms: 160,
        duration_ms: 80,
        timing_source: 'exact',
        source_entry: 'walk_03.png',
        provenance: {
          candidate_index: 0,
          raw_index: 2,
        },
        preview_file: 'frame_previews/frame_00001.png',
        selected: true,
      },
    ],
  }
  const preserved = preservePreviewCandidates(preview)
  assert.deepEqual(preserved.map((frame) => frame.candidate_index), [0, 1])
  assert.equal(preserved[0].raw_index, 2)
  assert.equal(preserved[0].source_entry, 'walk_03.png')
  assert.equal(preserved[0].preview_file, 'frame_previews/frame_00001.png')
  assert.equal(preserved[1].provenance.nested.source, 'zip')
  assert.equal(Object.isFrozen(preserved), true)
  assert.equal(Object.isFrozen(preserved[1].provenance.nested), true)

  preview.frames[0].raw_index = 99
  preview.frames[0].provenance.nested.source = 'changed'
  assert.equal(preserved[1].raw_index, 4)
  assert.equal(preserved[1].provenance.nested.source, 'zip')

  const restored = restoreAutoFrameSelection(preserved)
  assert.deepEqual(restored.map((frame) => frame.candidate_index), [0, 1])
  assert.equal(restored.every((frame) => frame.selected === false), true)
  restored.splice(0, 1)
  assert.equal(preserved.length, 2)
})

test('Preview and Build binding current checks require epoch identity and exact fingerprints', () => {
  const sourceIdentity = `sha256:${'c'.repeat(64)}`
  const sampling = {
    stride: 1,
    fps: 12,
    maxFrames: 64,
    startSec: 0,
    endSec: null,
  }
  const previewBinding = {
    source_epoch: 2,
    source_identity: sourceIdentity,
    sampling_fingerprint: motionCandidateFingerprint(sampling),
  }
  assert.equal(isMotionPreviewBindingCurrent(previewBinding, {
    sourceEpoch: 2,
    sourceIdentity,
    samplingOptions: sampling,
  }), true)
  assert.equal(isMotionPreviewBindingCurrent(previewBinding, {
    sourceEpoch: 3,
    sourceIdentity,
    samplingOptions: sampling,
  }), false)
  assert.equal(isMotionPreviewBindingCurrent(previewBinding, {
    sourceEpoch: 2,
    sourceIdentity: `sha256:${'d'.repeat(64)}`,
    samplingOptions: sampling,
  }), false)
  assert.equal(isMotionPreviewBindingCurrent(previewBinding, {
    sourceEpoch: 2,
    sourceIdentity,
    samplingOptions: { ...sampling, stride: 2 },
  }), false)

  const options = buildOptions()
  const buildBinding = {
    source_epoch: 2,
    source_identity: sourceIdentity,
    build_fingerprint: motionBuildFingerprint(options),
  }
  assert.equal(isMotionBuildBindingCurrent(buildBinding, {
    sourceEpoch: 2,
    sourceIdentity,
    buildOptions: options,
  }), true)
  assert.equal(isMotionBuildBindingCurrent(buildBinding, {
    sourceEpoch: 2,
    sourceIdentity,
    buildOptions: { ...options, frames: 3 },
  }), false)
  assert.equal(isMotionBuildBindingCurrent(buildBinding, {
    sourceEpoch: 2,
    sourceIdentity,
    buildOptions: {
      ...options,
      output_profile: { resample_strategy: 'nearest_keyframes' },
    },
  }), true)
})

test('Apply compatibility honors edited authority, stale gates, profile counts, and resampling', () => {
  assert.equal(TOPDOWN_RPG_V0.animations.length, 16)
  assert.deepEqual(
    motionApplyCompatibility({
      action: 'walk_down',
      editedStripOverride: false,
      hasLatestBuild: true,
      latestBuildCurrent: false,
      stripFrameCount: 4,
    }),
    {
      authority: 'latest_build',
      action: 'walk_down',
      resample_strategy: 'reject_mismatch',
      source_strip_frame_count: 4,
      target_frame_count: 4,
      resampling_required: false,
      server_validation_required: false,
      status: 'blocked',
      allowed: false,
      reason: 'latest_build_stale',
    }
  )
  const edited = motionApplyCompatibility({
    action: 'walk_down',
    editedStripOverride: true,
    hasLatestBuild: true,
    latestBuildCurrent: false,
    stripFrameCount: 4,
  })
  assert.equal(edited.allowed, true)
  assert.equal(edited.authority, 'edited_override')

  const mismatch = motionApplyCompatibility({
    action: 'walk_down',
    hasLatestBuild: true,
    latestBuildCurrent: true,
    stripFrameCount: 8,
    resampleStrategy: 'reject_mismatch',
  })
  assert.equal(mismatch.allowed, false)
  assert.equal(mismatch.reason, 'target_frame_count_mismatch')
  assert.equal(mismatch.target_frame_count, 4)

  const nearest = motionApplyCompatibility({
    action: 'walk_down',
    hasLatestBuild: true,
    latestBuildCurrent: true,
    stripFrameCount: 8,
    resampleStrategy: 'nearest_keyframes',
  })
  assert.equal(nearest.allowed, true)
  assert.equal(nearest.resampling_required, true)

  const editedUnknownCount = motionApplyCompatibility({
    action: 'walk_down',
    editedStripOverride: true,
    stripFrameCount: null,
  })
  assert.equal(editedUnknownCount.allowed, true)
  assert.equal(editedUnknownCount.status, 'needs_review')
  assert.equal(editedUnknownCount.server_validation_required, true)

  const evidenceBlocked = motionApplyCompatibility({
    action: 'walk_down',
    hasLatestBuild: true,
    latestBuildCurrent: true,
    latestBuildEvidenceStatus: 'blocked',
    stripFrameCount: 4,
  })
  assert.equal(evidenceBlocked.allowed, false)
  assert.equal(evidenceBlocked.reason, 'latest_build_evidence_blocked')
})

test('evidence mapper uses real report fields without inventing scores', () => {
  const report = completeReport()
  const mapped = mapMotionEvidence({
    job: { status: 'done' },
    report,
    bindingCurrent: true,
  })
  assert.equal(mapped.status, 'complete')
  assert.equal(mapped.source.source_kind, 'frame_sequence_zip')
  assert.equal(mapped.source.input_frame_count, 8)
  assert.equal(mapped.selection.recipe, 'motion_selection_recipe_v2')
  assert.equal(mapped.selection.authority, 'auto')
  assert.equal(mapped.selection.selected_frame_count, 4)
  assert.equal(mapped.selection.target_satisfied, true)
  assert.equal(mapped.selection.automatic_stages.registration, 'completed')
  assert.equal(mapped.loop.periodicity_status, 'detected')
  assert.equal(mapped.loop.selected_period, 4)
  assert.equal(mapped.loop.endpoint_similarity, 0.91)
  assert.equal(mapped.cleanup.halo_score_before, 0.2)
  assert.equal(mapped.cleanup.halo_score_after, 0.04)
  assert.equal(mapped.grid.status, 'complete')
  assert.equal(mapped.grid.cell_size, 6)
  assert.equal(mapped.grid.confidence, 0.91)
  assert.equal(mapped.grid.support_ratio, 0.875)
  assert.equal(mapped.binding.status, 'current')
  assert.equal(mapped.selection.score, undefined)
  assert.equal(mapped.loop.semantic_phase, undefined)
})

test('manual evidence marks automatic stages not run and target mismatch needs review', () => {
  const report = completeReport({
    status: 'warning',
    effective_selection_mode: 'manual',
    warnings: ['manual_target_count_mismatch'],
    frame_selection: {
      mode: 'motion_selection_report_v2',
      status: 'manual',
      recipe: 'motion_selection_recipe_v2',
      settings: v2(),
      selection_mode: 'manual',
      selected: [{ original_index: 3 }, { original_index: 1 }],
      warnings: ['manual_target_count_mismatch'],
      target: {
        target_satisfied: false,
        target_frame_count: 4,
        selected_frame_count: 2,
        shortfall_count: 2,
      },
      registration: { status: 'not_run_manual_authority' },
      clusters: { status: 'not_run_manual_authority' },
      periodicity: { status: 'not_run_manual_authority' },
      phase_selection: { status: 'not_run_manual_authority' },
      temporal_matte: { status: 'not_run_manual_authority' },
      loop: {
        expectation: 'auto',
      },
    },
  })
  const mapped = mapMotionEvidence({
    job: { status: 'done' },
    report,
  })
  assert.equal(mapped.status, 'needs_review')
  assert.equal(mapped.selection.authority, 'manual')
  assert.equal(mapped.selection.target_satisfied, false)
  assert.deepEqual(mapped.selection.automatic_stages, {
    status: 'not_run',
    reason: 'manual_authority',
    registration: 'not_run',
    clustering: 'not_run',
    periodicity: 'not_run',
    phase_selection: 'not_run',
    temporal_matte: 'not_run',
  })
  assert.equal(mapped.loop.status, 'not_run')
  assert.equal(mapped.loop.reason, 'manual_authority')
})

test('temporal matte evidence warnings require review and stay visible in loop evidence', () => {
  const report = completeReport()
  report.frame_selection.temporal_matte = {
    status: 'evidence_only',
    modifies_pixels: false,
    warnings: ['temporal_matte_motion_confounded'],
  }
  const mapped = mapMotionEvidence({
    job: { status: 'done' },
    report,
  })
  assert.equal(mapped.status, 'needs_review')
  assert.equal(mapped.selection.status, 'needs_review')
  assert.deepEqual(mapped.loop.warnings, ['temporal_matte_motion_confounded'])
  assert.deepEqual(mapped.warnings, ['temporal_matte_motion_confounded'])
})

test('simple Analyze and Apply report outcomes preserve fail and warning semantics', () => {
  assert.equal(
    mapMotionReportOutcome({
      job: { status: 'done' },
      report: {
        status: 'fail',
        blocking_errors: ['corrupt_or_unsupported_source'],
      },
    }).status,
    'blocked'
  )
  assert.equal(
    mapMotionReportOutcome({
      job: { status: 'done' },
      report: {
        status: 'ok',
        warnings: ['extension_kind_mismatch'],
      },
    }).status,
    'needs_review'
  )
  assert.equal(
    mapMotionReportOutcome({
      job: { status: 'done' },
      report: {
        status: 'warning',
        validation: {
          blocking_errors: ['frame_clipped'],
          warnings: [],
        },
      },
    }).status,
    'needs_review'
  )
})

test('normalization-incompatible grid is not applied and warning jobs need review', () => {
  const report = completeReport({
    status: 'done',
    warnings: ['grid_normalization_passthrough_normalization_incompatible'],
    pixel_grid_refinement: {
      schema_version: 2,
      mode: 'pixel_grid_refinement_v2',
      status: 'passthrough_normalization_incompatible',
      source_refinement_status: 'refined',
      recipe: { id: 'pixel_grid_v2_detail_safe' },
      sequence: {
        shared_palette: false,
        shared_grid: false,
        invariants: [],
      },
      warnings: ['grid_normalization_passthrough_normalization_incompatible'],
    },
  })
  const mapped = mapMotionEvidence({
    job: { status: 'done' },
    report,
  })
  assert.equal(mapped.status, 'needs_review')
  assert.equal(mapped.grid.status, 'not_applied')
  assert.equal(mapped.grid.applied, false)
  assert.equal(mapped.grid.evidence_status, 'passthrough_normalization_incompatible')
  assert.equal(mapped.grid.shared_grid, false)
})

test('artifact errors, stale bindings, missing artifacts, and failed jobs are blocked', () => {
  const unboundReport = completeReport()
  delete unboundReport.source_identity
  delete unboundReport.operation_id
  delete unboundReport.options_hash
  assert.deepEqual(
    {
      status: mapMotionEvidence({
        job: { status: 'done' },
        report: completeReport(),
        artifactError: new Error('unreadable'),
      }).status,
      stale: mapMotionEvidence({
        job: { status: 'done' },
        report: completeReport(),
        bindingCurrent: false,
      }).status,
      missing: mapMotionEvidence({
        job: { status: 'done' },
        report: null,
      }).status,
      unbound: mapMotionEvidence({
        job: { status: 'done' },
        report: unboundReport,
      }).status,
      failed: mapMotionEvidence({
        job: {
          status: 'failed_post_processing',
          failure_status: 'cancelled',
        },
        report: null,
      }).status,
    },
    {
      status: 'blocked',
      stale: 'blocked',
      missing: 'blocked',
      unbound: 'blocked',
      failed: 'blocked',
    }
  )
  assert.equal(
    mapMotionEvidence({
      job: { status: 'post_processing' },
      report: null,
    }).status,
    'running'
  )
})

test('evidence mapper keeps absent numeric evidence unavailable rather than inventing zero', () => {
  const report = completeReport({
    input_frame_count: null,
    selected_frame_count: null,
    background: {
      halo_score_before: null,
      halo_score_after: null,
    },
  })
  report.frame_selection.target.selected_frame_count = null
  report.frame_selection.selected = null
  const mapped = mapMotionEvidence({
    job: { status: 'done' },
    report,
  })
  assert.equal(mapped.source.input_frame_count, null)
  assert.equal(mapped.source.selected_frame_count, null)
  assert.equal(mapped.selection.selected_frame_count, null)
  assert.equal(mapped.cleanup.halo_score_before, null)
  assert.equal(mapped.cleanup.halo_score_after, null)
})
