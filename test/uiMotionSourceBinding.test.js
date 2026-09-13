import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOTION_REQUIRED_ARTIFACTS,
  MOTION_SOURCE_BYTE_LIMITS,
  assertBoundMotionArtifact,
  assertMotionJobCompletionArtifacts,
  assertMotionJobBinding,
  assertUploadedMotionSourceDescriptor,
  deriveMotionControlAvailability,
  deriveMotionFrameControlAvailability,
  isMotionOperationCurrent,
  isMotionSourceTooLarge,
  missingMotionJobArtifact,
  motionJobMatchesOperation,
  motionSourceByteLimit,
  requiredMotionArtifacts,
} from '../src/ui/motionSource/binding.js'

const SOURCE_IDENTITY = `sha256:${'a'.repeat(64)}`
const OPTIONS_HASH = `sha256:${'b'.repeat(64)}`

function sourceHandle(overrides = {}) {
  return {
    bound: true,
    epoch: 3,
    renderToken: 8,
    operationId: 'motion_build_op_test',
    sourceIdentity: SOURCE_IDENTITY,
    optionsHash: OPTIONS_HASH,
    jobId: 'motion_job_test',
    status: 'post_processing',
    ...overrides,
  }
}

function operationContext(handle, overrides = {}) {
  return {
    uiOperation: handle,
    renderToken: 8,
    sourceEpoch: 3,
    sourceFile: { name: 'walk.gif', size: 128 },
    sourceDescriptor: { source_identity: SOURCE_IDENTITY },
    ...overrides,
  }
}

test('Motion source size classification preserves the legacy raster, GIF/ZIP, and video ceilings', () => {
  assert.equal(motionSourceByteLimit({ name: 'walk.png', type: 'image/png' }), MOTION_SOURCE_BYTE_LIMITS.raster)
  assert.equal(motionSourceByteLimit({ name: 'walk.GIF' }), MOTION_SOURCE_BYTE_LIMITS.gifZip)
  assert.equal(motionSourceByteLimit({ type: 'application/zip' }), MOTION_SOURCE_BYTE_LIMITS.gifZip)
  assert.equal(motionSourceByteLimit({ name: 'walk.mov' }), MOTION_SOURCE_BYTE_LIMITS.video)
  assert.equal(motionSourceByteLimit({ type: 'video/custom' }), MOTION_SOURCE_BYTE_LIMITS.video)
  assert.equal(isMotionSourceTooLarge({ name: 'walk.png', size: MOTION_SOURCE_BYTE_LIMITS.raster }), false)
  assert.equal(isMotionSourceTooLarge({ name: 'walk.png', size: MOTION_SOURCE_BYTE_LIMITS.raster + 1 }), true)
})

test('uploaded descriptor assertion requires the exact operation, filename, bytes, and sha256 identity', () => {
  const file = { name: ' walk.gif ', size: 4096 }
  const descriptor = {
    upload_id: 'motion_upload_test',
    operation_id: 'motion_upload_op_test',
    source_name: 'walk.gif',
    byte_length: 4096,
    source_identity: SOURCE_IDENTITY,
  }
  assert.equal(assertUploadedMotionSourceDescriptor(descriptor, {
    file,
    operationId: 'motion_upload_op_test',
  }), descriptor)

  for (const invalid of [
    { ...descriptor, upload_id: '' },
    { ...descriptor, operation_id: 'other' },
    { ...descriptor, source_name: 'other.gif' },
    { ...descriptor, byte_length: 4095 },
    { ...descriptor, source_identity: `sha256:${'A'.repeat(64)}` },
  ]) {
    assert.throws(
      () => assertUploadedMotionSourceDescriptor(invalid, {
        file,
        operationId: 'motion_upload_op_test',
      }),
      (error) => error?.code === 'motion_source_binding_mismatch'
    )
  }
  assert.throws(
    () => assertUploadedMotionSourceDescriptor(descriptor, { file }),
    (error) => error?.code === 'motion_source_binding_mismatch'
  )
})

test('job binding returns a new frozen handle and fails closed on every source identity mismatch', () => {
  const original = sourceHandle({ jobId: null, optionsHash: null })
  const job = {
    id: 'motion_job_test',
    operation_id: original.operationId,
    source_identity: SOURCE_IDENTITY,
    options_hash: OPTIONS_HASH,
  }
  const bound = assertMotionJobBinding(original, job)
  assert.notEqual(bound, original)
  assert.equal(original.jobId, null)
  assert.equal(original.optionsHash, null)
  assert.equal(bound.jobId, job.id)
  assert.equal(bound.optionsHash, OPTIONS_HASH)
  assert.equal(Object.isFrozen(bound), true)

  for (const invalid of [
    { ...job, operation_id: 'other' },
    { ...job, source_identity: `sha256:${'c'.repeat(64)}` },
    { ...job, options_hash: 'not-a-sha256' },
  ]) {
    assert.throws(
      () => assertMotionJobBinding(original, invalid),
      (error) => error?.code === 'motion_source_binding_mismatch'
    )
  }
  assert.throws(
    () => assertMotionJobBinding(sourceHandle(), { ...job, id: 'other_job' }),
    (error) => error?.code === 'motion_job_binding_mismatch'
  )
  assert.throws(
    () => assertMotionJobBinding({ jobId: null }, job),
    (error) => error?.code === 'motion_job_binding_mismatch'
  )
})

test('operation and job current checks require object ownership, render epoch, and bound identity', () => {
  const handle = sourceHandle()
  const context = operationContext(handle)
  const job = {
    id: handle.jobId,
    operation_id: handle.operationId,
    source_identity: handle.sourceIdentity,
    options_hash: handle.optionsHash,
  }
  assert.equal(isMotionOperationCurrent(handle, context), true)
  assert.equal(motionJobMatchesOperation(handle, context, job), true)
  const invalidHandle = { ...handle, bound: undefined }
  assert.equal(isMotionOperationCurrent(invalidHandle, {
    ...context,
    uiOperation: invalidHandle,
  }), false)
  assert.equal(isMotionOperationCurrent(handle, { ...context, uiOperation: { ...handle } }), false)
  assert.equal(isMotionOperationCurrent(handle, { ...context, renderToken: 9 }), false)
  assert.equal(isMotionOperationCurrent(handle, { ...context, sourceEpoch: 4 }), false)
  assert.equal(isMotionOperationCurrent(handle, { ...context, sourceFile: null }), false)
  assert.equal(isMotionOperationCurrent(handle, {
    ...context,
    sourceDescriptor: { source_identity: `sha256:${'d'.repeat(64)}` },
  }), false)
  assert.equal(motionJobMatchesOperation(handle, context, { ...job, options_hash: `sha256:${'e'.repeat(64)}` }), false)
})

test('artifact binding accepts only the exact operation/source/options triple', () => {
  const handle = sourceHandle()
  const artifact = {
    operation_id: handle.operationId,
    source_identity: handle.sourceIdentity,
    options_hash: handle.optionsHash,
  }
  assert.equal(assertBoundMotionArtifact(handle, artifact), artifact)
  assert.throws(
    () => assertBoundMotionArtifact(handle, { ...artifact, options_hash: `sha256:${'f'.repeat(64)}` }),
    (error) => error?.code === 'motion_source_binding_mismatch'
  )
  assert.throws(
    () => assertBoundMotionArtifact({ bound: false }, artifact),
    (error) => error?.code === 'motion_source_binding_mismatch'
  )
})

test('required artifact map is frozen, ordered, and gates only completed jobs', () => {
  assert.equal(Object.isFrozen(MOTION_REQUIRED_ARTIFACTS), true)
  assert.equal(Object.isFrozen(MOTION_REQUIRED_ARTIFACTS.build), true)
  assert.deepEqual(requiredMotionArtifacts('preview'), [
    'frame_preview_index_url',
    'frame_preview_sheet_url',
  ])
  const incomplete = {
    status: 'post_processing',
    frame_preview_index_url: '/preview/index.json',
  }
  assert.equal(missingMotionJobArtifact(incomplete, 'preview'), 'frame_preview_sheet_url')
  assert.equal(assertMotionJobCompletionArtifacts(incomplete, 'preview'), incomplete)
  assert.throws(
    () => assertMotionJobCompletionArtifacts({ ...incomplete, status: 'done' }, 'preview'),
    (error) => error?.code === 'motion_job_artifact_missing' &&
      error?.artifact === 'frame_preview_sheet_url'
  )
  assert.throws(
    () => requiredMotionArtifacts('future'),
    (error) => error?.code === 'motion_job_store_unknown'
  )
})

test('control availability preserves real workflow gates and remains frozen', () => {
  const active = sourceHandle()
  const ready = deriveMotionControlAvailability({
    sourceFile: { name: 'walk.gif', size: 4096 },
    frameSelection: [{ selected: true }],
    sheetFile: { name: 'sheet.png' },
    manifestFile: { name: 'npc.json' },
    sourceSetStripFiles: [{ name: 'walk.png' }],
    toolStatus: {
      ffmpeg: { available: true },
      rembg: { available: true },
    },
    options: {
      selection_mode: 'manual',
      selection_recipe: 'motion_selection_recipe_v2',
      background: { method: 'external_rembg' },
    },
    binding: {
      candidate_fingerprint: 'motion_candidate_v1:{}',
      build_fingerprint: 'motion_build_v1:{}',
    },
    previewCurrent: true,
    applyCompatibility: { allowed: true },
    frameCandidates: [{ candidate_index: 0 }],
    activeOperation: active,
    operationContext: operationContext(active),
  })
  assert.equal(Object.isFrozen(ready), true)
  assert.equal(Object.isFrozen(ready.facts), true)
  assert.equal(Object.isFrozen(ready.controls), true)
  for (const name of [
    'analyze',
    'previewFrames',
    'buildStrip',
    'guidedBuild',
    'applyStrip',
    'analyzeSet',
    'applySet',
    'cancel',
    'restoreAuto',
  ]) {
    assert.equal(ready.controls[name], true, `${name} should be available`)
  }
  assert.equal(ready.controls.resume, false)

  const generic = sourceHandle({ bound: false })
  const genericRunning = deriveMotionControlAvailability({
    uiBusy: true,
    activeOperation: generic,
    operationContext: operationContext(generic),
  })
  assert.equal(genericRunning.controls.cancel, false)

  const noEvidence = deriveMotionControlAvailability({
    sourceFile: { name: 'walk.gif', size: 4096 },
    options: { selection_mode: 'manual' },
  })
  assert.equal(noEvidence.controls.analyze, true)
  assert.equal(noEvidence.controls.previewFrames, false)
  assert.equal(noEvidence.controls.buildStrip, false)
  assert.equal(noEvidence.controls.applyStrip, false)
  assert.equal(noEvidence.controls.chooseSource, true)
})

test('video, rembg, manual preview, busy, resume, and v1 dependency gates fail closed', () => {
  const videoBlocked = deriveMotionControlAvailability({
    sourceFile: { name: 'walk.mp4', size: 4096 },
    toolStatus: { ffmpeg: { available: false }, rembg: { available: false } },
    options: {
      selection_mode: 'manual',
      motion_selection: { recipe: 'motion_selection_v1_compat' },
      background: { method: 'external_rembg' },
    },
    binding: {
      candidate_fingerprint: 'candidate',
      build_fingerprint: 'build',
    },
    frameSelection: [{ selected: true }],
    previewCurrent: false,
    previewArtifactError: { reason: 'missing preview' },
  })
  assert.equal(videoBlocked.controls.analyze, true)
  assert.equal(videoBlocked.controls.previewFrames, false)
  assert.equal(videoBlocked.controls.buildStrip, false)
  assert.equal(videoBlocked.controls.loopExpectation, false)
  assert.equal(videoBlocked.controls.temporalMatte, false)

  const resumable = sourceHandle({ jobId: null, optionsHash: null })
  const resume = deriveMotionControlAvailability({
    uiBusy: true,
    resumableOperation: resumable,
    operationContext: operationContext(resumable),
  })
  assert.equal(resume.controls.resume, true)
  assert.equal(resume.controls.chooseSource, false)
  assert.equal(resume.controls.requestOptions, false)
  assert.equal(resume.controls.navigation, true)
})

test('frame controls reject invalid indexes and preserve first/last ordering gates', () => {
  assert.deepEqual(deriveMotionFrameControlAvailability({ index: 0, frameCount: 3 }), {
    toggle: true,
    up: false,
    down: true,
    remove: true,
  })
  assert.deepEqual(deriveMotionFrameControlAvailability({ index: 2, frameCount: 3 }), {
    toggle: true,
    up: true,
    down: false,
    remove: true,
  })
  assert.deepEqual(deriveMotionFrameControlAvailability({ index: 3, frameCount: 3 }), {
    toggle: false,
    up: false,
    down: false,
    remove: false,
  })
  assert.equal(deriveMotionFrameControlAvailability({
    uiBusy: true,
    index: 1,
    frameCount: 3,
  }).remove, false)
})
