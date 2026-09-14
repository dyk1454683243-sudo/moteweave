import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS } from '../../src/character-pack/benchmark/t2iGoldenReview.js'
import {
  evaluateProductionSheetReleaseGate,
  evaluateQualityCharacterReleaseGate,
  FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
  GENERATION_RELEASE_GATE_MODE,
  QUALITY_CHARACTER_RELEASE_THRESHOLDS,
  resolveGenerationArtifactDisposition,
} from '../../src/character-pack/generationReleaseGate.js'
import {
  CHARACTER_QUALITY_CLOSURE_GATE_IDS,
  CHARACTER_QUALITY_CLOSURE_MODE,
} from '../../src/character-pack/qualityClosureGate.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayouts.js'

function passingValidation() {
  return { status: 'pass', warnings: [], blocking_errors: [] }
}

function passingClosure() {
  return {
    mode: CHARACTER_QUALITY_CLOSURE_MODE,
    status: 'pass',
    release_ready: true,
    gates: CHARACTER_QUALITY_CLOSURE_GATE_IDS.map((id) => ({ id, status: 'pass' })),
  }
}

function passingProductionDebugReport(overrides = {}) {
  return {
    source_layout: { id: 'topdown_rpg_v0' },
    validation: passingValidation(),
    quality_closure: passingClosure(),
    ...overrides,
  }
}

function passingSubjectCount() {
  return {
    required: true,
    status: 'pass',
    source: {
      status: 'pass',
      stages: [
        { stage: 'pre_calibration_source', status: 'pass' },
        { stage: 'calibrated_source', status: 'pass' },
      ],
    },
    normalized: { stage: 'normalized_frames', status: 'pass' },
    suggested_region_keys: [],
    needs_review_region_keys: [],
    advisory_region_keys: [],
  }
}

function boundaryQualityInput(overrides = {}) {
  return {
    score: 615,
    bbox: { x: 10, y: 10, w: 64, h: 96 },
    metrics: {
      visible_pixel_count: 1000,
      unique_color_count: 8,
      palette_changed_pixel_ratio: 0.7,
      outline_pixel_ratio: 0.08,
      bbox_width_ratio: 0.72,
      bbox_height_ratio: 0.86,
      bbox_area_ratio: 0.42,
      center_offset_ratio: 0.1,
      edge_margin_ratio: 0.035,
    },
    ...overrides,
  }
}

test('generation release gate shares the frozen golden review thresholds', () => {
  assert.strictEqual(QUALITY_CHARACTER_RELEASE_THRESHOLDS, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS)
  assert.equal(Object.isFrozen(QUALITY_CHARACTER_RELEASE_THRESHOLDS), true)
})

test('artifact disposition releases only when every canonical gate field agrees', () => {
  const passing = {
    generationReleaseGate: {
      schema_version: 1,
      mode: GENERATION_RELEASE_GATE_MODE,
      generation_mode: 'quality_character_v0',
      policy: 'golden_review_hard_thresholds_v1',
      status: 'pass',
      release_ready: true,
      blocking_errors: [],
      warnings: [],
      evidence: {},
    },
    releaseReady: true,
    artifactDisposition: 'release',
  }
  assert.equal(resolveGenerationArtifactDisposition(passing), 'release')

  const conflicts = [
    { generationReleaseGate: { ...passing.generationReleaseGate, schema_version: 2 } },
    { generationReleaseGate: { ...passing.generationReleaseGate, mode: 'unknown_gate' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, policy: 'unknown_policy' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, status: 'fail' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, release_ready: false } },
    { generationReleaseGate: { ...passing.generationReleaseGate, blocking_errors: ['blocked'] } },
    { generationReleaseGate: { ...passing.generationReleaseGate, warnings: null } },
    { generationReleaseGate: { ...passing.generationReleaseGate, evidence: null } },
    { releaseReady: false },
    { artifactDisposition: 'diagnostic_only' },
  ]
  for (const conflict of conflicts) {
    assert.equal(resolveGenerationArtifactDisposition({ ...passing, ...conflict }), 'diagnostic_only')
  }
  assert.equal(resolveGenerationArtifactDisposition({}), null)

  const manualReview = {
    generationReleaseGate: {
      ...passing.generationReleaseGate,
      generation_mode: 'production_sheet_v0',
      policy: 'strict_live_generation_v1',
      status: 'needs_review',
      release_ready: false,
      manual_review_required: true,
      human_decision_status: 'pending',
      automated_review_findings: ['subject_count.multiple_subjects_blocked'],
    },
    releaseReady: false,
    manualReviewRequired: true,
    artifactDisposition: 'review_required',
  }
  assert.equal(resolveGenerationArtifactDisposition(manualReview), 'review_required')
  assert.equal(resolveGenerationArtifactDisposition({
    ...manualReview,
    generationReleaseGate: {
      ...manualReview.generationReleaseGate,
      blocking_errors: ['subject_count.evidence_missing'],
    },
  }), 'diagnostic_only')

  const manualAcceptance = {
    schema_version: 1,
    protocol: FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
    acceptance_id: 'accepted_job_1',
    source_job_id: 'job_1',
    published_job_id: 'accepted_job_1',
    decision: 'accepted',
    decision_authority: 'human',
    generation_profile_id: 'full_sheet_fixed_region_v1',
    prompt_contract_version: 'character_prompt_contract_v1_18',
    accepted_at: '2026-08-09T08:00:00.000Z',
    human_reviewed_issue_count: 0,
    provider_calls_used: 0,
    generation_review: {
      reviewed_run_id: 'generation_review_1',
      plan_hash: 'a'.repeat(64),
      reference_manifest_sha256: 'b'.repeat(64),
      prompt_text_sha256: '1'.repeat(64),
    },
    source_artifacts: {
      raw_provider_output_file: 'raw_provider_output.png',
      raw_provider_output_sha256: 'c'.repeat(64),
      raw_provider_output_byte_length: 3,
      source_sha256: 'd'.repeat(64),
      source_byte_length: 4,
      normalized_sheet_sha256: 'e'.repeat(64),
      normalized_sheet_byte_length: 5,
      prompt_sha256: '1'.repeat(64),
      prompt_byte_length: 6,
      generation_release_gate_sha256: 'f'.repeat(64),
    },
    publication_artifacts: {
      release_files: [
        { file: 'godot_npc_pack.zip', sha256: '2'.repeat(64), byte_length: 7 },
        { file: 'ocad_pack.zip', sha256: '4'.repeat(64), byte_length: 9 },
        { file: 'rpgmaker_pack.zip', sha256: '3'.repeat(64), byte_length: 8 },
      ],
      character_pack_entries: [
        { file: 'animations.json', sha256: '5'.repeat(64), byte_length: 10 },
      ],
      metadata_without_generation_sha256: '6'.repeat(64),
      engine_zips: {
        godot_npc: { file: 'godot_npc_pack.zip', sha256: '2'.repeat(64), byte_length: 7 },
        rpgmaker: { file: 'rpgmaker_pack.zip', sha256: '3'.repeat(64), byte_length: 8 },
        ocad: { file: 'ocad_pack.zip', sha256: '4'.repeat(64), byte_length: 9 },
      },
    },
  }
  const humanAccepted = {
    generationReleaseGate: {
      ...manualReview.generationReleaseGate,
      status: 'accepted',
      release_ready: true,
      manual_review_required: false,
      human_decision_status: 'accepted',
      generation_profile_id: 'full_sheet_fixed_region_v1',
      prompt_contract_version: 'character_prompt_contract_v1_18',
      manual_acceptance: manualAcceptance,
    },
    releaseReady: true,
    manualReviewRequired: false,
    humanDecisionStatus: 'accepted',
    generationProfileId: 'full_sheet_fixed_region_v1',
    promptContractVersion: 'character_prompt_contract_v1_18',
    artifactDisposition: 'release',
  }
  assert.equal(resolveGenerationArtifactDisposition(humanAccepted), 'release')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    humanDecisionStatus: 'pending',
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        generation_review: {
          ...manualAcceptance.generation_review,
          reviewed_run_id: '',
        },
      },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationProfileId: undefined,
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: { ...manualAcceptance, provider_calls_used: 1 },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        publication_artifacts: {
          ...manualAcceptance.publication_artifacts,
          release_files: [],
        },
      },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        publication_artifacts: {
          ...manualAcceptance.publication_artifacts,
          release_files: [
            ...manualAcceptance.publication_artifacts.release_files.slice(0, 1),
            {
              ...manualAcceptance.publication_artifacts.release_files[1],
              sha256: '7'.repeat(64),
            },
            ...manualAcceptance.publication_artifacts.release_files.slice(2),
          ],
        },
      },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        publication_artifacts: {
          ...manualAcceptance.publication_artifacts,
          release_files: [
            ...manualAcceptance.publication_artifacts.release_files,
          ].reverse(),
        },
      },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        publication_artifacts: {
          ...manualAcceptance.publication_artifacts,
          character_pack_entries: [
            { file: 'generation.json', sha256: '5'.repeat(64), byte_length: 10 },
          ],
        },
      },
    },
  }), 'diagnostic_only')
  assert.equal(resolveGenerationArtifactDisposition({
    ...humanAccepted,
    generationReleaseGate: {
      ...humanAccepted.generationReleaseGate,
      manual_acceptance: {
        ...manualAcceptance,
        source_artifacts: {
          ...manualAcceptance.source_artifacts,
          prompt_sha256: '9'.repeat(64),
        },
      },
    },
  }), 'diagnostic_only')
})

test('production release gate passes strict evidence and treats source quality as not applicable for non-fixed layouts', () => {
  const result = evaluateProductionSheetReleaseGate({
    debugReport: passingProductionDebugReport(),
  })

  assert.equal(result.schema_version, 1)
  assert.equal(result.mode, GENERATION_RELEASE_GATE_MODE)
  assert.equal(result.generation_mode, 'production_sheet_v0')
  assert.equal(result.status, 'pass')
  assert.equal(result.release_ready, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.equal(result.evidence.source_quality.applicable, false)
  assert.equal(result.evidence.source_quality.status, 'not_applicable')
})

test('production release gate requires clean source quality evidence for fixed-region layouts', () => {
  const debugReport = passingProductionDebugReport({
    source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
    source_quality: passingValidation(),
  })
  const pass = evaluateProductionSheetReleaseGate({ debugReport })
  const missing = evaluateProductionSheetReleaseGate({
    debugReport: { ...debugReport, source_quality: null },
  })

  assert.equal(pass.release_ready, true)
  assert.equal(pass.evidence.source_quality.applicable, true)
  assert.equal(missing.release_ready, false)
  assert.ok(missing.blocking_errors.includes('source_quality.evidence_missing'))
})

test('new full-sheet profiles reserve visual decisions for explicit human review', () => {
  const passing = passingProductionDebugReport({
    generation_profile: { id: 'full_sheet_topdown_v1' },
    subject_count: passingSubjectCount(),
  })
  const pending = evaluateProductionSheetReleaseGate({ debugReport: passing })
  assert.equal(pending.status, 'needs_review')
  assert.equal(pending.release_ready, false)
  assert.equal(pending.manual_review_required, true)
  assert.equal(pending.human_decision_status, 'pending')
  assert.deepEqual(pending.blocking_errors, [])
  assert.deepEqual(pending.automated_review_findings, [])

  const missing = evaluateProductionSheetReleaseGate({
    debugReport: { ...passing, subject_count: null },
  })
  assert.ok(missing.blocking_errors.includes('subject_count.evidence_missing'))

  const blocked = evaluateProductionSheetReleaseGate({
    debugReport: {
      ...passing,
      subject_count: {
        ...passingSubjectCount(),
        status: 'blocked',
        source: { ...passingSubjectCount().source, status: 'blocked' },
        suggested_region_keys: ['attractL4'],
      },
    },
  })
  assert.equal(blocked.status, 'needs_review')
  assert.equal(blocked.manual_review_required, true)
  assert.deepEqual(blocked.blocking_errors, [])
  assert.ok(blocked.automated_review_findings.includes('subject_count.multiple_subjects_blocked'))
  assert.ok(blocked.automated_review_findings.includes('subject_count.source_not_pass'))

  const needsReview = evaluateProductionSheetReleaseGate({
    debugReport: {
      ...passing,
      subject_count: {
        ...passingSubjectCount(),
        status: 'needs_review',
        normalized: { ...passingSubjectCount().normalized, status: 'needs_review' },
        needs_review_region_keys: ['attractL6'],
      },
    },
  })
  assert.equal(needsReview.status, 'needs_review')
  assert.equal(needsReview.manual_review_required, true)
  assert.deepEqual(needsReview.blocking_errors, [])
  assert.ok(needsReview.automated_review_findings.includes('subject_count.needs_review'))
  assert.ok(needsReview.automated_review_findings.includes('subject_count.normalized_not_pass'))
})

test('new full-sheet profiles fail closed unless all three subject-count stages are present exactly once', () => {
  const passing = passingSubjectCount()
  const missingCases = [
    {
      id: 'pre_calibration_source',
      subjectCount: {
        ...passing,
        source: { ...passing.source, stages: passing.source.stages.slice(1) },
      },
    },
    {
      id: 'calibrated_source',
      subjectCount: {
        ...passing,
        source: { ...passing.source, stages: passing.source.stages.slice(0, 1) },
      },
    },
    {
      id: 'normalized_frames',
      subjectCount: { ...passing, normalized: { status: 'pass' } },
    },
  ]

  for (const { id, subjectCount } of missingCases) {
    const result = evaluateProductionSheetReleaseGate({
      debugReport: passingProductionDebugReport({
        generation_profile: { id: 'full_sheet_topdown_v1' },
        subject_count: subjectCount,
      }),
    })
    assert.equal(result.release_ready, false)
    assert.ok(result.blocking_errors.includes(`subject_count.${id}_missing`))
  }

  const duplicate = passingSubjectCount()
  duplicate.source.stages.push({ stage: 'pre_calibration_source', status: 'pass' })
  const duplicateResult = evaluateProductionSheetReleaseGate({
    debugReport: passingProductionDebugReport({
      generation_profile: { id: 'full_sheet_topdown_v1' },
      subject_count: duplicate,
    }),
  })
  assert.ok(duplicateResult.blocking_errors.includes('subject_count.pre_calibration_source_duplicate'))
})

test('subject-count accessory edge advisories remain non-blocking', () => {
  const result = evaluateProductionSheetReleaseGate({
    debugReport: passingProductionDebugReport({
      generation_profile: { id: 'full_sheet_topdown_v1' },
      subject_count: {
        ...passingSubjectCount(),
        advisory_region_keys: ['attack_left_0'],
      },
    }),
  })

  assert.equal(result.status, 'needs_review')
  assert.equal(result.release_ready, false)
  assert.equal(result.manual_review_required, true)
  assert.ok(result.warnings.includes('subject_count:accessory_edge_advisory:attack_left_0'))
})

test('strict full-sheet quality warnings become automated review findings instead of candidate failures', () => {
  const result = evaluateProductionSheetReleaseGate({
    debugReport: passingProductionDebugReport({
      generation_profile: { id: 'full_sheet_fixed_region_v1' },
      source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
      validation: {
        status: 'warning',
        warnings: ['frame_17_baseline_drift'],
        blocking_errors: [],
      },
      source_quality: {
        status: 'warning',
        warnings: ['source_action_scale_inconsistent:climb'],
        blocking_errors: [],
      },
      subject_count: {
        ...passingSubjectCount(),
        status: 'blocked',
        source: {
          ...passingSubjectCount().source,
          status: 'blocked',
          stages: passingSubjectCount().source.stages.map((stage) => ({
            ...stage,
            status: stage.stage === 'calibrated_source' ? 'blocked' : 'pass',
          })),
        },
      },
      quality_closure: {
        ...passingClosure(),
        status: 'warning',
        release_ready: false,
        gates: passingClosure().gates.map((gate, index) => ({
          ...gate,
          status: index === 0 ? 'warning' : 'pass',
        })),
      },
    }),
  })

  assert.equal(result.status, 'needs_review')
  assert.equal(result.release_ready, false)
  assert.equal(result.manual_review_required, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.ok(result.automated_review_findings.includes('validation.status_not_pass'))
  assert.ok(result.automated_review_findings.includes('source_quality.status_not_pass'))
  assert.ok(result.automated_review_findings.includes('subject_count.multiple_subjects_blocked'))
  assert.ok(result.automated_review_findings.includes('quality_closure.status_not_pass'))
})

test('strict full-sheet malformed review evidence remains an execution-integrity failure', () => {
  const base = passingProductionDebugReport({
    generation_profile: { id: 'full_sheet_topdown_v1' },
    subject_count: passingSubjectCount(),
  })
  const cases = [
    {
      name: 'validation status invalid',
      debugReport: { ...base, validation: { ...base.validation, status: 'unknown' } },
      expected: 'validation.status_invalid',
    },
    {
      name: 'subject-count stage status missing',
      debugReport: {
        ...base,
        subject_count: {
          ...base.subject_count,
          source: {
            ...base.subject_count.source,
            stages: base.subject_count.source.stages.map((stage, index) => (
              index === 0 ? { stage: stage.stage } : stage
            )),
          },
        },
      },
      expected: 'subject_count.pre_calibration_source_status_missing',
    },
    {
      name: 'subject-count summary status invalid',
      debugReport: {
        ...base,
        subject_count: {
          ...base.subject_count,
          normalized: { ...base.subject_count.normalized, status: 'unknown' },
        },
      },
      expected: 'subject_count.normalized_status_invalid',
    },
    {
      name: 'quality-closure gate status missing',
      debugReport: {
        ...base,
        quality_closure: {
          ...base.quality_closure,
          gates: base.quality_closure.gates.map((gate, index) => (
            index === 0 ? { id: gate.id } : gate
          )),
        },
      },
      expected: 'quality_closure.gate_status_missing',
    },
    {
      name: 'quality-closure release-ready missing',
      debugReport: {
        ...base,
        quality_closure: {
          mode: base.quality_closure.mode,
          status: base.quality_closure.status,
          gates: base.quality_closure.gates,
        },
      },
      expected: 'quality_closure.release_ready_missing',
    },
    {
      name: 'quality-closure release-ready invalid',
      debugReport: {
        ...base,
        quality_closure: {
          ...base.quality_closure,
          release_ready: 'false',
        },
      },
      expected: 'quality_closure.release_ready_invalid',
    },
  ]

  for (const item of cases) {
    const result = evaluateProductionSheetReleaseGate({ debugReport: item.debugReport })
    assert.equal(result.status, 'fail', item.name)
    assert.equal(result.manual_review_required, false, item.name)
    assert.equal(result.human_decision_status, 'unavailable', item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('production release gate fails closed when required evidence is missing', () => {
  const cases = [
    {
      name: 'source layout identity',
      debugReport: { ...passingProductionDebugReport(), source_layout: null },
      expected: 'source_layout.evidence_missing',
    },
    {
      name: 'unsupported source layout identity',
      debugReport: { ...passingProductionDebugReport(), source_layout: { id: 'unknown_layout_v0' } },
      expected: 'source_layout.unsupported',
    },
    {
      name: 'validation object',
      debugReport: passingProductionDebugReport({ validation: null }),
      expected: 'validation.evidence_missing',
    },
    {
      name: 'validation status',
      debugReport: passingProductionDebugReport({ validation: { warnings: [], blocking_errors: [] } }),
      expected: 'validation.status_missing',
    },
    {
      name: 'validation warnings',
      debugReport: passingProductionDebugReport({ validation: { status: 'pass', blocking_errors: [] } }),
      expected: 'validation.warnings_missing',
    },
    {
      name: 'validation blocking errors',
      debugReport: passingProductionDebugReport({ validation: { status: 'pass', warnings: [] } }),
      expected: 'validation.blocking_errors_missing',
    },
    {
      name: 'fixed source quality status',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { warnings: [], blocking_errors: [] },
      }),
      expected: 'source_quality.status_missing',
    },
    {
      name: 'fixed source quality warnings',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', blocking_errors: [] },
      }),
      expected: 'source_quality.warnings_missing',
    },
    {
      name: 'fixed source quality blocking errors',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: [] },
      }),
      expected: 'source_quality.blocking_errors_missing',
    },
    {
      name: 'quality closure object',
      debugReport: passingProductionDebugReport({ quality_closure: null }),
      expected: 'quality_closure.evidence_missing',
    },
    {
      name: 'quality closure mode',
      debugReport: passingProductionDebugReport({
        quality_closure: { ...passingClosure(), mode: null },
      }),
      expected: 'quality_closure.mode_missing',
    },
    {
      name: 'quality closure canonical mode',
      debugReport: passingProductionDebugReport({
        quality_closure: { ...passingClosure(), mode: 'unknown_closure' },
      }),
      expected: 'quality_closure.mode_unsupported',
    },
    {
      name: 'quality closure status',
      debugReport: passingProductionDebugReport({ quality_closure: { release_ready: true, gates: [] } }),
      expected: 'quality_closure.status_missing',
    },
    {
      name: 'quality closure release readiness',
      debugReport: passingProductionDebugReport({ quality_closure: { status: 'pass', gates: [] } }),
      expected: 'quality_closure.release_ready_missing',
    },
    {
      name: 'quality closure gate evidence',
      debugReport: passingProductionDebugReport({ quality_closure: { status: 'pass', release_ready: true } }),
      expected: 'quality_closure.gates_missing',
    },
    {
      name: 'quality closure complete canonical gate set',
      debugReport: passingProductionDebugReport({
        quality_closure: { ...passingClosure(), gates: [] },
      }),
      expected: 'quality_closure.gates_invalid',
    },
    {
      name: 'quality closure unique canonical gate ids',
      debugReport: passingProductionDebugReport({
        quality_closure: {
          ...passingClosure(),
          gates: [
            { id: 'background_halo', status: 'pass' },
            { id: 'alignment_consistency', status: 'pass' },
            { id: 'motion_consistency', status: 'pass' },
            { id: 'motion_consistency', status: 'pass' },
          ],
        },
      }),
      expected: 'quality_closure.gates_invalid',
    },
  ]

  for (const item of cases) {
    const result = evaluateProductionSheetReleaseGate({ debugReport: item.debugReport })
    assert.equal(result.release_ready, false, item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('production release gate rejects non-pass statuses, warnings, and blocking errors', () => {
  const cases = [
    {
      name: 'validation status',
      debugReport: passingProductionDebugReport({
        validation: { status: 'warning', warnings: [], blocking_errors: [] },
      }),
      expected: 'validation.status_not_pass',
    },
    {
      name: 'validation warnings',
      debugReport: passingProductionDebugReport({
        validation: { status: 'pass', warnings: ['motion_warning'], blocking_errors: [] },
      }),
      expected: 'validation.warnings_present',
    },
    {
      name: 'validation blockers',
      debugReport: passingProductionDebugReport({
        validation: { status: 'pass', warnings: [], blocking_errors: ['cropped_frame'] },
      }),
      expected: 'validation.blocking_errors_present',
    },
    {
      name: 'fixed source quality status',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'warning', warnings: [], blocking_errors: [] },
      }),
      expected: 'source_quality.status_not_pass',
    },
    {
      name: 'fixed source quality warnings',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: ['source_warning'], blocking_errors: [] },
      }),
      expected: 'source_quality.warnings_present',
    },
    {
      name: 'fixed source quality blockers',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: [], blocking_errors: ['empty_region'] },
      }),
      expected: 'source_quality.blocking_errors_present',
    },
    {
      name: 'quality closure status',
      debugReport: passingProductionDebugReport({
        quality_closure: { status: 'warning', release_ready: true, gates: [] },
      }),
      expected: 'quality_closure.status_not_pass',
    },
    {
      name: 'quality closure readiness',
      debugReport: passingProductionDebugReport({
        quality_closure: { status: 'pass', release_ready: false, gates: [] },
      }),
      expected: 'quality_closure.not_release_ready',
    },
    {
      name: 'quality closure nested gate status',
      debugReport: passingProductionDebugReport({
        quality_closure: {
          status: 'pass',
          release_ready: true,
          gates: [{ id: 'motion_consistency', status: 'warning' }],
        },
      }),
      expected: 'quality_closure.gates_not_pass',
    },
  ]

  for (const item of cases) {
    const result = evaluateProductionSheetReleaseGate({ debugReport: item.debugReport })
    assert.equal(result.status, 'fail', item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('quality character release gate passes exact hard and soft threshold boundaries', () => {
  const cases = [
    { name: 'all preferred and bbox thresholds', input: boundaryQualityInput(), warning: null },
    {
      name: 'hard score minimum',
      input: boundaryQualityInput({ score: 600 }),
      warning: 'quality_character.score_below_usable',
    },
    {
      name: 'maximum visible pixels',
      input: (() => {
        const input = boundaryQualityInput()
        input.metrics.visible_pixel_count = 220000
        return input
      })(),
      warning: null,
    },
  ]

  for (const item of cases) {
    const result = evaluateQualityCharacterReleaseGate(item.input)
    assert.equal(result.schema_version, 1, item.name)
    assert.equal(result.mode, GENERATION_RELEASE_GATE_MODE, item.name)
    assert.equal(result.generation_mode, 'quality_character_v0', item.name)
    assert.equal(result.status, 'pass', item.name)
    assert.equal(result.release_ready, true, item.name)
    assert.deepEqual(result.blocking_errors, [], item.name)
    if (item.warning) assert.ok(result.warnings.includes(item.warning), item.name)
    else assert.deepEqual(result.warnings, [], item.name)
  }
})

test('quality character release gate rejects every value beyond a hard boundary', () => {
  const cases = [
    { name: 'missing bbox', patch: { bbox: null }, expected: 'quality_character_empty' },
    { name: 'empty image', metric: ['visible_pixel_count', 0], expected: 'quality_character_empty' },
    { name: 'score below 600', patch: { score: 599.999 }, expected: 'quality_character_score_below_warning' },
    { name: 'too many visible pixels', metric: ['visible_pixel_count', 220001], expected: 'quality_character_visible_area_too_large' },
    { name: 'bbox too wide', metric: ['bbox_width_ratio', 0.7201], expected: 'quality_character_bbox_too_wide' },
    { name: 'bbox too tall', metric: ['bbox_height_ratio', 0.8601], expected: 'quality_character_bbox_too_tall' },
    { name: 'bbox area too large', metric: ['bbox_area_ratio', 0.4201], expected: 'quality_character_bbox_too_large' },
    { name: 'off center', metric: ['center_offset_ratio', 0.1001], expected: 'quality_character_off_center' },
    { name: 'edge margin too small', metric: ['edge_margin_ratio', 0.0349], expected: 'quality_character_edge_margin_too_small' },
  ]

  for (const item of cases) {
    const input = boundaryQualityInput(item.patch)
    if (item.metric) input.metrics[item.metric[0]] = item.metric[1]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, false, item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('quality character release gate fails closed for every missing hard metric', () => {
  const hardMetrics = [
    'visible_pixel_count',
    'bbox_width_ratio',
    'bbox_height_ratio',
    'bbox_area_ratio',
    'center_offset_ratio',
    'edge_margin_ratio',
  ]

  const missingScore = evaluateQualityCharacterReleaseGate(boundaryQualityInput({ score: null }))
  assert.ok(missingScore.blocking_errors.includes('quality_character_score_missing'))

  for (const metric of hardMetrics) {
    const input = boundaryQualityInput()
    delete input.metrics[metric]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, false, metric)
    assert.ok(result.blocking_errors.includes(`quality_character_metrics_missing:${metric}`), metric)
  }
})

test('quality character release gate reports soft warnings without blocking release', () => {
  const cases = [
    { name: 'score', patch: { score: 614.999 }, expected: 'quality_character.score_below_usable' },
    { name: 'visible pixels', metric: ['visible_pixel_count', 999], expected: 'quality_character.visible_pixels_below_preferred' },
    { name: 'unique colors', metric: ['unique_color_count', 7], expected: 'quality_character.unique_colors_below_preferred' },
    { name: 'palette change', metric: ['palette_changed_pixel_ratio', 0.7001], expected: 'quality_character.palette_change_above_preferred' },
    { name: 'outline ratio', metric: ['outline_pixel_ratio', 0.0801], expected: 'quality_character.outline_ratio_above_preferred' },
  ]

  for (const item of cases) {
    const input = boundaryQualityInput(item.patch)
    if (item.metric) input.metrics[item.metric[0]] = item.metric[1]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, true, item.name)
    assert.ok(result.warnings.includes(item.expected), item.name)
  }
})

test('quality character release gate does not fail closed for absent soft-only metrics', () => {
  const input = boundaryQualityInput()
  delete input.metrics.unique_color_count
  delete input.metrics.palette_changed_pixel_ratio
  delete input.metrics.outline_pixel_ratio

  const result = evaluateQualityCharacterReleaseGate(input)

  assert.equal(result.release_ready, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.deepEqual(result.warnings, [])
})
