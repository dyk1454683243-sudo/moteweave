import test from 'node:test'
import assert from 'node:assert/strict'

import {
  StudioProjectApiError,
  assertProjectArtifactUrl,
  assertProjectJob,
  diagnosticProjectArtifacts,
  normalizeProjectInputs,
  pollProjectJob,
  postProjectPack,
  projectObservationCanResume,
  projectSubmissionIsDefiniteRejection,
  releaseProjectArtifacts,
  verifyProjectResult,
  verifyProjectFailureDiagnostics,
} from '../src/ui/studio/projectApi.js'

const INPUTS = Object.freeze({
  projectId: 'forest_demo',
  characterJobId: 'accepted_character_1',
  sceneJobId: 'job_scene_1',
  strictStyleContract: false,
})

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function projectJob(overrides = {}) {
  return {
    id: 'job_project_1',
    status: 'queued',
    type: 'project_pack',
    project_id: INPUTS.projectId,
    character_job_id: INPUTS.characterJobId,
    scene_job_id: INPUTS.sceneJobId,
    ...overrides,
  }
}

function doneArtifacts(id = 'job_project_1') {
  return {
    project_manifest_url: `/generated/${id}/project_manifest.json`,
    project_validation_url: `/generated/${id}/project_validation.json`,
    project_pack_zip_url: `/generated/${id}/project_pack.zip`,
    zip_url: `/generated/${id}/project_pack.zip`,
  }
}

function manifest(overrides = {}) {
  return {
    version: 'scene_character_project_v0',
    project_id: INPUTS.projectId,
    packs: {
      character: { id: 'hero_pack', profile: 'fixed-region-v1' },
      scene: { id: 'meadow_scene', profile: 'scene-dual-grid-v0' },
    },
    style_contract: { mode: 'shared', palette: 'child-packs' },
    ...overrides,
  }
}

function validation(overrides = {}) {
  return {
    status: 'pass',
    blocking_errors: [],
    warnings: [],
    style_contract: { policy: 'warn' },
    ...overrides,
  }
}

test('Project Pack inputs normalize the complete maintained parameter surface', () => {
  assert.deepEqual(normalizeProjectInputs({
    projectId: '  forest_demo  ',
    characterJobId: ' accepted_character_1 ',
    sceneJobId: ' job_scene_1 ',
    strictStyleContract: 1,
    createdAt: 'not user controlled',
    styleContract: { fake: true },
  }), {
    projectId: 'forest_demo',
    characterJobId: 'accepted_character_1',
    sceneJobId: 'job_scene_1',
    strictStyleContract: true,
  })
  assert.throws(
    () => normalizeProjectInputs({ ...INPUTS, characterJobId: '../escape' }),
    (error) => error instanceof StudioProjectApiError && error.code === 'invalid_project_input',
  )
})

test('Project Pack submission sends only normalized real API parameters and binds the returned Job', async () => {
  let body
  const job = await postProjectPack(INPUTS, {
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/project-pack')
      assert.equal(options.method, 'POST')
      body = JSON.parse(options.body)
      return jsonResponse(projectJob())
    },
  })
  assert.equal(job.id, 'job_project_1')
  assert.deepEqual(body, INPUTS)
  assert.equal(body.stylePolicy, undefined)
  assert.equal(body.createdAt, undefined)
  assert.equal(body.styleContract, undefined)

  await assert.rejects(
    postProjectPack(INPUTS, {
      fetchImpl: async () => jsonResponse(projectJob({ scene_job_id: 'job_scene_drift' })),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'job_binding_mismatch',
  )
})

test('Project artifacts are same-origin, exact-Job, and release stays locked on failure', () => {
  assert.equal(
    assertProjectArtifactUrl('/generated/job_project_1/project_pack.zip', 'project_pack.zip', {
      jobId: 'job_project_1',
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    '/generated/job_project_1/project_pack.zip',
  )
  assert.throws(
    () => assertProjectArtifactUrl('https://evil.example/generated/job_project_1/project_pack.zip', 'project_pack.zip', {
      jobId: 'job_project_1',
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'artifact_origin_mismatch',
  )
  assert.throws(
    () => assertProjectArtifactUrl('/generated/job_project_2/project_pack.zip', 'project_pack.zip', {
      jobId: 'job_project_1',
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'artifact_binding_mismatch',
  )
  assert.throws(
    () => assertProjectJob(projectJob({ status: 'done' }), { terminal: true, expectedInputs: INPUTS }),
    (error) => error instanceof StudioProjectApiError && error.code === 'artifact_missing',
  )

  const done = assertProjectJob(projectJob({ status: 'done', ...doneArtifacts() }), {
    terminal: true,
    expectedInputs: INPUTS,
  })
  assert.deepEqual(releaseProjectArtifacts(done).map((row) => row.file), [
    'project_pack.zip',
    'project_manifest.json',
    'project_validation.json',
  ])
  const failed = assertProjectJob(projectJob({
    status: 'failed_project_pack',
    ...doneArtifacts(),
  }), { terminal: true, expectedInputs: INPUTS })
  assert.deepEqual(releaseProjectArtifacts(failed), [])
  assert.deepEqual(diagnosticProjectArtifacts(failed).map((row) => row.file), [
    'project_manifest.json',
    'project_validation.json',
  ])
})

test('Project polling observes only the submitted Job and distinguishes stale from paused observation', async () => {
  const urls = []
  const terminal = await pollProjectJob(projectJob(), {
    expectedInputs: INPUTS,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      urls.push(url)
      return jsonResponse(projectJob({ status: 'done', ...doneArtifacts() }))
    },
  })
  assert.equal(terminal.status, 'done')
  assert.deepEqual(urls, ['/api/jobs/job_project_1'])

  await assert.rejects(
    pollProjectJob(projectJob(), {
      expectedInputs: INPUTS,
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse(projectJob({ id: 'job_project_2' })),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'job_binding_mismatch',
  )
  await assert.rejects(
    pollProjectJob(projectJob(), {
      expectedInputs: INPUTS,
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse({ status: 'not_found' }),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'job_not_found',
  )
  await assert.rejects(
    pollProjectJob(projectJob(), {
      expectedInputs: INPUTS,
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse({ error: 'temporary' }, { status: 503 }),
    }),
    (error) => (
      error instanceof StudioProjectApiError &&
      error.code === 'poll_interrupted' &&
      error.payload.job.id === 'job_project_1'
    ),
  )
})

test('Project verification combines exact Job binding with truthful manifest and validation contracts', async () => {
  const done = projectJob({ status: 'done', ...doneArtifacts() })
  const verified = await verifyProjectResult(done, INPUTS, {
    fetchImpl: async (url) => {
      if (url.endsWith('/project_manifest.json')) return jsonResponse(manifest())
      if (url.endsWith('/project_validation.json')) return jsonResponse(validation())
      throw new Error(`unexpected URL ${url}`)
    },
  })
  assert.equal(verified.job.id, 'job_project_1')
  assert.equal(verified.validation.status, 'pass')
  assert.equal(verified.artifacts[0].file, 'project_pack.zip')

  await assert.rejects(
    verifyProjectResult(done, INPUTS, {
      fetchImpl: async (url) => (
        url.endsWith('/project_manifest.json')
          ? jsonResponse(manifest({ project_id: 'another_project' }))
          : jsonResponse(validation())
      ),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'manifest_binding_mismatch',
  )
  await assert.rejects(
    verifyProjectResult(done, INPUTS, {
      fetchImpl: async (url) => (
        url.endsWith('/project_manifest.json')
          ? jsonResponse(manifest())
          : jsonResponse(validation({ blocking_errors: ['style_mismatch'] }))
      ),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'validation_binding_mismatch',
  )

  const strictInputs = { ...INPUTS, strictStyleContract: true }
  await assert.rejects(
    verifyProjectResult(done, strictInputs, {
      fetchImpl: async (url) => (
        url.endsWith('/project_manifest.json') ? jsonResponse(manifest()) : jsonResponse(validation())
      ),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'validation_binding_mismatch',
  )
})

test('failed Project Pack diagnostics require the exact Job, Project manifest, fail report, and style policy', async () => {
  const failed = projectJob({ status: 'failed_project_pack', ...doneArtifacts() })
  const failedValidation = validation({
    status: 'fail',
    blocking_errors: ['style_contract_failed'],
    warnings: ['scene_style_palette_mismatch'],
    style_contract: { policy: 'strict' },
  })
  const verified = await verifyProjectFailureDiagnostics(
    failed,
    { ...INPUTS, strictStyleContract: true },
    {
      fetchImpl: async (url) => (
        url.endsWith('/project_manifest.json') ? jsonResponse(manifest()) : jsonResponse(failedValidation)
      ),
    },
  )
  assert.equal(verified.validation.status, 'fail')
  assert.deepEqual(verified.artifacts.map((row) => row.file), [
    'project_manifest.json',
    'project_validation.json',
  ])

  await assert.rejects(
    verifyProjectFailureDiagnostics(failed, INPUTS, {
      fetchImpl: async (url) => (
        url.endsWith('/project_manifest.json') ? jsonResponse(manifest()) : jsonResponse(failedValidation)
      ),
    }),
    (error) => error instanceof StudioProjectApiError && error.code === 'validation_binding_mismatch',
  )
})

test('only a definite client response proves Project submission was rejected before Job creation', () => {
  assert.equal(projectSubmissionIsDefiniteRejection({ status: 400 }), true)
  assert.equal(projectSubmissionIsDefiniteRejection({ status: 429 }), true)
  assert.equal(projectSubmissionIsDefiniteRejection({ status: 500 }), false)
  assert.equal(projectSubmissionIsDefiniteRejection(new Error('network')), false)
})

test('only transient observation errors retry the same known Project Job', () => {
  assert.equal(projectObservationCanResume({ code: 'request_failed' }), true)
  assert.equal(projectObservationCanResume({ code: 'request_timeout' }), true)
  assert.equal(projectObservationCanResume({ code: 'poll_interrupted' }), true)
  assert.equal(projectObservationCanResume({ code: 'request_rejected', status: 503 }), true)
  assert.equal(projectObservationCanResume({ code: 'manifest_binding_mismatch' }), false)
  assert.equal(projectObservationCanResume({ code: 'request_rejected', status: 404 }), false)
})
