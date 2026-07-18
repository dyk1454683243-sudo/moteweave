import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertMotionEnginePackResult,
  buildMotionApplyContextCommit,
  buildMotionEnginePackProcessingOptions,
  motionEnginePackBindingCurrent,
  motionEnginePackExportReadiness,
} from '../src/ui/motionSource/enginePackExportState.js'
import { buildMotionEnginePacksFromAppliedSheet } from '../src/ui/motionSource/api.js'

function applyEvidence(overrides = {}) {
  const id = overrides.id ?? 'motion_apply_test'
  return {
    applyJob: {
      id,
      status: 'done',
      applied_normalized_sheet_url: `/generated/${id}/applied_normalized_sheet.png`,
      apply_motion_strip_report_url: `/generated/${id}/apply_motion_strip_report.json`,
      ...overrides.job,
    },
    applyReport: {
      schema_version: 1,
      mode: 'apply_motion_strip_report_v1',
      status: 'done',
      profile_id: 'topdown_rpg_v0',
      validation: { status: 'pass', blocking_errors: [], warnings: [] },
      ...overrides.report,
    },
    applyResultStale: overrides.applyResultStale ?? false,
    applyArtifactError: overrides.applyArtifactError ?? null,
  }
}

function enginePackJob(id = 'engine_pack_test') {
  return {
    id,
    status: 'done',
    debug_report_url: `/generated/${id}/debug_report.json`,
    normalized_sheet_url: `/generated/${id}/normalized_sheet.png`,
    animations_url: `/generated/${id}/animations.json`,
    metadata_url: `/generated/${id}/metadata.json`,
    editor_metadata_url: `/generated/${id}/editor_metadata.json`,
    zip_url: `/generated/${id}/character_pack.zip`,
    godot_npc_zip_url: `/generated/${id}/godot_npc_pack.zip`,
    rpgmaker_zip_url: `/generated/${id}/rpgmaker_pack.zip`,
    ocad_zip_url: `/generated/${id}/ocad_pack.zip`,
  }
}

function enginePackDebugReport(overrides = {}) {
  return {
    profile: 'topdown_rpg_v0',
    source_layout: { id: 'topdown_rpg_v0' },
    requested_background_mode: 'passthrough',
    component_cleanup: { enabled: false },
    normalization: {
      auto_correction: { enabled: false },
      motion_stabilization: { enabled: false },
    },
    pixel_style: { mode: 'report_only' },
    validation: { status: 'pass', blocking_errors: [], warnings: [] },
    ...overrides,
  }
}

test('Motion engine package export uses fixed provider-free processing options', () => {
  assert.deepEqual(buildMotionEnginePackProcessingOptions(), {
    name: 'motion_applied_character',
    description: 'Character packages reprocessed from a Motion Source applied sheet',
    sourceType: 'motion_source_apply',
    sourceFileName: 'applied_normalized_sheet.png',
    sourceLayout: 'topdown_rpg_v0',
    backgroundMode: 'passthrough',
    autoCorrect: false,
    motionStabilize: false,
    componentCleanup: false,
    pixelFinishing: false,
    styleReport: true,
    outputFrameSizes: [96, 64, 48, 32, 16],
  })
})

test('Motion engine package readiness fails closed on stale, blocked, or unbound Apply evidence', () => {
  assert.equal(motionEnginePackExportReadiness(applyEvidence()).ready, true)
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ applyResultStale: true })).reason, 'apply_result_stale')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ applyArtifactError: { reason: 'decode' } })).reason, 'apply_artifact_error')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ job: { status: 'failed_post_processing' } })).reason, 'apply_job_not_done')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ job: { applied_normalized_sheet_url: '/generated/other/applied_normalized_sheet.png' } })).reason, 'apply_artifact_unbound')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ job: { apply_motion_strip_report_url: '/generated/other/apply_motion_strip_report.json' } })).reason, 'apply_report_unbound')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ report: { status: 'warning', validation: { blocking_errors: ['invalid'] } } })).reason, 'apply_report_blocked')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ report: { validation: { status: 'fail', blocking_errors: [], warnings: [] } } })).reason, 'apply_report_blocked')
  assert.equal(motionEnginePackExportReadiness(applyEvidence({ report: { validation: { blocking_errors: [], warnings: [] } } })).reason, 'apply_report_blocked')
})

test('Motion engine package API reprocesses the exact managed Apply artifact', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (calls.length === 1) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    return new Response(JSON.stringify({ id: 'engine_pack_api', status: 'queued' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    })
  }

  const result = await buildMotionEnginePacksFromAppliedSheet(applyEvidence())
  assert.deepEqual(result, { id: 'engine_pack_api', status: 'queued' })
  assert.equal(calls[0].url, '/generated/motion_apply_test/applied_normalized_sheet.png')
  assert.equal(calls[1].url, '/api/process-sheet')
  assert.equal(calls[1].options.method, 'POST')
  const body = JSON.parse(calls[1].options.body)
  assert.equal(body.source_base64, 'AQID')
  assert.equal(body.source_black_base64, null)
  assert.deepEqual(body.options, buildMotionEnginePackProcessingOptions())
})

test('Motion engine package result requires every exact managed artifact and passing validation', () => {
  const inputBinding = motionEnginePackExportReadiness(applyEvidence()).binding
  const job = enginePackJob()
  const binding = assertMotionEnginePackResult({
    job,
    debugReport: enginePackDebugReport({
      validation: { status: 'pass', blocking_errors: [], warnings: ['reviewed'] },
    }),
    inputBinding,
  })
  assert.deepEqual(binding, {
    ...inputBinding,
    engine_pack_job_id: job.id,
  })
  assert.equal(motionEnginePackBindingCurrent(binding, {
    applyJob: applyEvidence().applyJob,
    enginePackJob: job,
  }), true)

  for (const field of ['zip_url', 'godot_npc_zip_url', 'rpgmaker_zip_url', 'ocad_zip_url']) {
    assert.throws(
      () => assertMotionEnginePackResult({
        job: { ...job, [field]: undefined },
        debugReport: enginePackDebugReport(),
        inputBinding,
      }),
      { code: 'engine_pack_artifact_unbound' }
    )
  }
  assert.throws(
    () => assertMotionEnginePackResult({
      job: { ...job, zip_url: `${job.zip_url}?download=1` },
      debugReport: enginePackDebugReport(),
      inputBinding,
    }),
    { code: 'engine_pack_artifact_unbound' }
  )
  assert.throws(
    () => assertMotionEnginePackResult({
      job,
      debugReport: enginePackDebugReport({
        validation: { status: 'fail', blocking_errors: ['bad_frame'], warnings: [] },
      }),
      inputBinding,
    }),
    { code: 'engine_pack_validation_blocked' }
  )
  for (const validation of [
    { blocking_errors: [], warnings: [] },
    { status: 'unknown', blocking_errors: [], warnings: [] },
    { status: 'pass', blocking_errors: 'none', warnings: [] },
    { status: 'warning', blocking_errors: [], warnings: 'review' },
  ]) {
    assert.throws(
      () => assertMotionEnginePackResult({
        job,
        debugReport: enginePackDebugReport({ validation }),
        inputBinding,
      }),
      { code: 'engine_pack_validation_blocked' }
    )
  }
  for (const debugReport of [
    enginePackDebugReport({ profile: 'other_profile' }),
    enginePackDebugReport({ source_layout: { id: 'other_profile' } }),
    enginePackDebugReport({ requested_background_mode: 'flood' }),
    enginePackDebugReport({ component_cleanup: { enabled: true } }),
    enginePackDebugReport({
      normalization: {
        auto_correction: { enabled: true },
        motion_stabilization: { enabled: false },
      },
    }),
    enginePackDebugReport({
      normalization: {
        auto_correction: { enabled: false },
        motion_stabilization: { enabled: true },
      },
    }),
    enginePackDebugReport({ pixel_style: { mode: 'pixel_finishing_v1' } }),
  ]) {
    assert.throws(
      () => assertMotionEnginePackResult({ job, debugReport, inputBinding }),
      { code: 'engine_pack_processing_evidence_mismatch' }
    )
  }
})

test('Motion apply commits keep single and set contexts mutually exclusive', () => {
  const motionSource = {
    jobs: {
      apply: { id: 'old_single' },
      setApply: { id: 'old_set' },
      enginePacks: { id: 'old_engine' },
    },
    reports: {
      apply: { id: 'old_single_report' },
      setApply: { id: 'old_set_report' },
      enginePacks: { id: 'old_engine_report' },
    },
    applyResultStale: true,
    enginePackBinding: { apply_job_id: 'old_single' },
  }
  const singleJob = { id: 'new_single' }
  const singleReport = { id: 'new_single_report' }
  const single = {
    ...motionSource,
    ...buildMotionApplyContextCommit(motionSource, {
      kind: 'single',
      job: singleJob,
      report: singleReport,
    }),
  }
  assert.equal(single.jobs.apply, singleJob)
  assert.equal(single.reports.apply, singleReport)
  assert.equal(single.jobs.setApply, null)
  assert.equal(single.jobs.enginePacks, null)
  assert.equal(single.enginePackBinding, null)

  const setJob = { id: 'new_set' }
  const setReport = { id: 'new_set_report' }
  const set = {
    ...single,
    ...buildMotionApplyContextCommit(single, {
      kind: 'set',
      job: setJob,
      report: setReport,
    }),
  }
  assert.equal(set.jobs.apply, null)
  assert.equal(set.reports.apply, null)
  assert.equal(set.jobs.setApply, setJob)
  assert.equal(set.reports.setApply, setReport)
  assert.equal(set.jobs.enginePacks, null)
  assert.equal(set.enginePackBinding, null)
})

test('Motion engine package binding becomes stale with a new Apply result', () => {
  const current = applyEvidence()
  const job = enginePackJob()
  const binding = {
    ...motionEnginePackExportReadiness(current).binding,
    engine_pack_job_id: job.id,
  }
  assert.equal(motionEnginePackBindingCurrent(binding, {
    applyJob: applyEvidence({ id: 'motion_apply_new' }).applyJob,
    enginePackJob: job,
  }), false)
  assert.equal(motionEnginePackBindingCurrent(binding, {
    applyJob: current.applyJob,
    applyResultStale: true,
    enginePackJob: job,
  }), false)
})
