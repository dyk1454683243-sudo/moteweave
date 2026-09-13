import test from 'node:test'
import assert from 'node:assert/strict'

import {
  StudioTilesApiError,
  assertLocalTilesJob,
  assertTilesArtifactUrl,
  assertTilesBenchmarkJob,
  assertTilesBenchmarkReport,
  buildTilesBenchmarkRequest,
  fetchTilesGeminiPreset,
  pollTilesJob,
  postLocalTilesBuild,
  postTilesBenchmarkPlan,
  postTilesBenchmarkRun,
  selectEligibleTilesGeminiPreset,
  tilesBenchmarkSubmissionIsDefiniteRejection,
} from '../src/ui/studio/tilesApi.js'

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function nativePreset(overrides = {}) {
  return {
    id: 'gemini-native',
    label: 'Gemini native',
    provider: 'gemini',
    route_kind: 'google_native',
    model: 'gemini-3.1-flash-image-preview',
    available: true,
    supports_image_size: true,
    ...overrides,
  }
}

function localJob(overrides = {}) {
  return {
    id: 'job_tiles_1',
    type: 'two_point_five_d_tileset',
    status: 'queued',
    ...overrides,
  }
}

function benchmarkJob(overrides = {}) {
  return {
    id: 'job_tiles_benchmark_1',
    type: 'two_point_five_d_material_source_benchmark',
    status: 'queued',
    provider_call_budget: {
      planned_provider_calls: 4,
      max_provider_calls: 4,
      used_provider_calls: 0,
    },
    candidate_count: 4,
    provider_config: {
      selected_available: true,
      selected_preset_id: 'gemini-native',
      provider: 'gemini',
      route_kind: 'google_native',
      model: 'gemini-3.1-flash-image-preview',
    },
    ...overrides,
  }
}

const sealedGeminiProvider = Object.freeze({
  selected_available: true,
  selected_preset_id: 'gemini-native',
  provider: 'gemini',
  route_kind: 'google_native',
  model: 'gemini-3.1-flash-image-preview',
})

function benchmarkReportCase(description, count = 4) {
  const candidates = Array.from({ length: count }, (_, index) => ({
    id: `candidate_${String(index + 1).padStart(2, '0')}`,
    case_id: 'custom_material_source',
    index,
    status: 'pass',
    warnings: [],
    blocking_errors: [],
  }))
  return {
    id: 'custom_material_source',
    item_id: 'custom_material_source_v1',
    description,
    candidates,
    candidate_selection: {
      mode: 'two_point_five_d_material_source_candidate_selection_v1',
      candidate_count: count,
      selected_candidate_id: 'candidate_01',
      selected_candidate_index: 0,
      selected_status: 'pass',
      ranking: [...candidates],
    },
  }
}

const localArtifacts = Object.freeze({
  strict_atlas_png_url: '/generated/job_tiles_1/strict_atlas.png',
  runtime_padded_atlas_png_url: '/generated/job_tiles_1/runtime_padded_atlas.png',
  map_editor_preview_png_url: '/generated/job_tiles_1/map_editor_preview.png',
  tiled_json_url: '/generated/job_tiles_1/tileset.tiled.json',
  tiled_tsx_url: '/generated/job_tiles_1/tileset.tsx',
  ldtk_project_url: '/generated/job_tiles_1/project.ldtk',
  ldtk_workflow_validation_url: '/generated/job_tiles_1/ldtk_workflow_validation.json',
  workflow_release_evidence_url: '/generated/job_tiles_1/workflow_release_evidence.json',
  workflow_release_evidence_md_url: '/generated/job_tiles_1/workflow_release_evidence.md',
  consumer_package_audit_url: '/generated/job_tiles_1/consumer_package_audit.json',
  import_validation_url: '/generated/job_tiles_1/import_validation.json',
  release_demo_manifest_url: '/generated/job_tiles_1/release_demo_manifest.json',
  release_demo_readme_url: '/generated/job_tiles_1/release_demo_README.md',
  release_demo_pack_zip_url: '/generated/job_tiles_1/release_demo_pack.zip',
  external_tool_probe_url: '/generated/job_tiles_1/external_tool_probe.json',
  external_import_smoke_url: '/generated/job_tiles_1/external_import_smoke.json',
  external_roundtrip_validation_url: '/generated/job_tiles_1/external_roundtrip_validation.json',
  external_roundtrip_checklist_md_url: '/generated/job_tiles_1/external_roundtrip_checklist.md',
})

const localCompletion = Object.freeze({
  validation_status: 'pass',
  tile_map_status: 'pass',
  map_editor_workflow_status: 'pass',
  ldtk_project_status: 'pass',
  ldtk_workflow_validation_status: 'pass',
  workflow_release_evidence_status: 'pass',
  workflow_release_ready: true,
  consumer_package_audit_status: 'pass',
  import_validation_status: 'pass',
  release_demo_pack_status: 'pass',
  release_demo_release_ready: true,
  external_import_smoke_status: 'pass',
  external_roundtrip_validation_status: 'not_run',
  external_roundtrip_ready: true,
})

const benchmarkArtifacts = Object.freeze({
  material_source_benchmark_plan_url: '/generated/two-point-five-d-material-source-benchmarks/run_1/material_source_benchmark_plan.json',
  material_source_benchmark_url: '/generated/two-point-five-d-material-source-benchmarks/run_1/material_source_benchmark.json',
  material_source_benchmark_md_url: '/generated/two-point-five-d-material-source-benchmarks/run_1/material_source_benchmark.md',
})

test('Tiles Studio selects only an available native Gemini image preset', async () => {
  const state = {
    active_preset_id: 'openrouter-default',
    presets: [
      nativePreset({ id: 'gemini-unavailable', available: false }),
      { ...nativePreset(), id: 'openrouter-default', provider: 'openrouter', route_kind: 'openrouter' },
      nativePreset(),
    ],
  }
  assert.deepEqual(selectEligibleTilesGeminiPreset(state), {
    id: 'gemini-native',
    model: 'gemini-3.1-flash-image-preview',
    routeKind: 'google_native',
    label: 'Gemini native',
  })

  const selected = await fetchTilesGeminiPreset({
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/gemini-state')
      assert.equal(options.method, 'GET')
      return jsonResponse(state)
    },
  })
  assert.equal(selected.id, 'gemini-native')
  assert.throws(
    () => selectEligibleTilesGeminiPreset({ presets: [state.presets[1]] }),
    (error) => error instanceof StudioTilesApiError && error.code === 'gemini_not_ready',
  )
})

test('local Tiles build sends exactly the maintained local source and map options', async () => {
  let requestBody
  const file = {
    name: 'moss.png',
    async arrayBuffer() { return Uint8Array.from([1, 2, 3, 4]).buffer },
  }
  const job = await postLocalTilesBuild({
    materialSourceFile: file,
    options: {
      mapWidth: 9,
      mapHeight: 7,
      mapDensity: 0.4,
      mapSeed: 21,
      mapSolver: 'seeded',
      mapBorder: 'none',
      editorOperations: [{ type: 'set_corner', x: 2, y: 3, solid: true }],
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/build-two-point-five-d-tileset')
      assert.equal(options.method, 'POST')
      assert.equal(Object.hasOwn(options, 'timeoutMs'), false)
      requestBody = JSON.parse(options.body)
      return jsonResponse(localJob())
    },
  })
  assert.equal(job.id, 'job_tiles_1')
  assert.deepEqual(requestBody, {
    material_source_base64: 'AQIDBA==',
    material_source_name: 'moss.png',
    options: {
      mapSolver: 'seeded',
      mapBorder: 'none',
      mapWidth: 9,
      mapHeight: 7,
      mapSeed: 21,
      mapDensity: 0.4,
      editorOperations: [{ type: 'set_corner', x: 2, y: 3, solid: true }],
    },
  })
  assert.equal(requestBody.confirm_live_generation, undefined)
  assert.equal(requestBody.providerPresetId, undefined)
})

test('benchmark Plan is zero-call evidence and live Run reuses its exact sealed request', async () => {
  const request = buildTilesBenchmarkRequest({
    description: 'mossy cliff grass blocks with cool stone sides',
    candidateCount: 4,
    maxProviderCalls: 4,
    providerPresetId: 'gemini-native',
    options: { mapWidth: 8, mapHeight: 6, mapSeed: 170617, mapDensity: 0.55 },
  })
  const calls = []
  const plan = await postTilesBenchmarkPlan(request, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (url === '/api/two-point-five-d-material-source-benchmark') {
        const body = JSON.parse(options.body)
        assert.equal(body.dryRunPlan, true)
        assert.equal(body.confirm_live_generation, undefined)
        assert.equal(body.providerPresetId, 'gemini-native')
        assert.equal(body.maxProviderCalls, 4)
        return jsonResponse({
          mode: 'dry_run_plan',
          status: 'done',
          run_id: 'run_1',
          estimated_provider_calls: 4,
          candidate_count: 4,
          case_ids: ['custom_material_source'],
          provider_config: {
            selected_available: true,
            selected_preset_id: 'gemini-native',
            provider: 'gemini',
            route_kind: 'google_native',
            model: 'gemini-3.1-flash-image-preview',
          },
          plan_url: '/generated/two-point-five-d-material-source-benchmarks/run_1/material_source_benchmark_plan.json',
        })
      }
      return jsonResponse({
        mode: 'two_point_five_d_material_source_benchmark_v1_plan',
        run_id: 'run_1',
        provider_preset_id: 'gemini-native',
        candidate_count: 4,
        estimated_provider_calls: 4,
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
        provider_config: {
          selected_available: true,
          ...sealedGeminiProvider,
        },
        map_options: {
          solver: 'constraint',
          width: 8,
          height: 6,
          seed: 170617,
          density: 0.55,
          border: 'empty',
          fixedMasks: [],
          editorOperations: [],
        },
        cases: [{
          id: 'custom_material_source',
          item_id: 'custom_material_source_v1',
          description: request.description,
          index: 0,
        }],
      })
    },
  })
  assert.equal(calls.length, 2)
  assert.equal(plan.request, request)

  let liveBody
  const initial = await postTilesBenchmarkRun(plan, {
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/two-point-five-d-material-source-benchmark')
      liveBody = JSON.parse(options.body)
      return jsonResponse(benchmarkJob())
    },
  })
  assert.equal(initial.id, 'job_tiles_benchmark_1')
  assert.equal(liveBody.dryRunPlan, undefined)
  assert.equal(liveBody.confirm_live_generation, true)
  assert.equal(liveBody.runId, 'run_1')
  assert.equal(liveBody.maxProviderCalls, 4)
  assert.equal(liveBody.providerPresetId, request.providerPresetId)
  assert.deepEqual(liveBody.expectedProviderConfig, sealedGeminiProvider)
  assert.equal(liveBody.description, request.description)
  assert.deepEqual(liveBody.options, request.options)

  await assert.rejects(
    postTilesBenchmarkPlan(request, {
      fetchImpl: async (url) => jsonResponse(url.startsWith('/api/') ? {
        mode: 'dry_run_plan',
        status: 'done',
        run_id: 'run_mismatch',
        estimated_provider_calls: 4,
        candidate_count: 4,
        provider_config: {
          selected_available: true,
          selected_preset_id: 'gemini-native',
          provider: 'gemini',
          route_kind: 'google_native',
          model: 'gemini-3.1-flash-image-preview',
        },
        plan_url: '/generated/two-point-five-d-material-source-benchmarks/run_mismatch/material_source_benchmark_plan.json',
      } : {
        mode: 'two_point_five_d_material_source_benchmark_v1_plan',
        run_id: 'run_mismatch',
        provider_preset_id: 'gemini-native',
        candidate_count: 4,
        estimated_provider_calls: 4,
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
        provider_config: {
          selected_available: true,
          ...sealedGeminiProvider,
        },
        map_options: {
          solver: 'constraint', width: 9, height: 6, seed: 170617,
          density: 0.55, border: 'empty', fixedMasks: [], editorOperations: [],
        },
        cases: [{ id: 'custom_material_source', description: request.description }],
      }),
    }),
    (error) => error.code === 'benchmark_plan_binding_mismatch',
  )
})

test('poll observes the same local Job and unlocks only exact generated artifacts', async () => {
  const requests = []
  const done = localJob({ status: 'done', ...localCompletion, ...localArtifacts })
  const result = await pollTilesJob(localJob(), {
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return jsonResponse(done)
    },
  })
  assert.deepEqual(result, done)
  assert.deepEqual(requests.map((item) => item.url), ['/api/jobs/job_tiles_1'])
  assert.equal(requests[0].options.method, 'GET')

  assert.equal(
    assertTilesArtifactUrl('/generated/job_tiles_1/strict_atlas.png', 'strict_atlas.png'),
    '/generated/job_tiles_1/strict_atlas.png',
  )
  assert.throws(
    () => assertTilesArtifactUrl('https://evil.example/generated/job_tiles_1/strict_atlas.png', 'strict_atlas.png', {
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    (error) => error.code === 'artifact_origin_mismatch',
  )
  assert.throws(
    () => assertTilesArtifactUrl('/generated/other_job/strict_atlas.png', 'strict_atlas.png', {
      exactPath: '/generated/job_tiles_1/strict_atlas.png',
    }),
    (error) => error.code === 'artifact_binding_mismatch',
  )
  for (const unsafe of [
    '//evil.example/generated/job_tiles_1/strict_atlas.png',
    'javascript:/generated/job_tiles_1/strict_atlas.png',
    'ftp://127.0.0.1/generated/job_tiles_1/strict_atlas.png',
  ]) {
    assert.throws(
      () => assertTilesArtifactUrl(unsafe, 'strict_atlas.png', {
        locationValue: { origin: 'http://127.0.0.1:4173' },
      }),
      (error) => error.code === 'artifact_url_invalid',
    )
  }
  assert.equal(
    assertTilesArtifactUrl('http://127.0.0.1:4173/generated/job_tiles_1/strict_atlas.png', 'strict_atlas.png', {
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    '/generated/job_tiles_1/strict_atlas.png',
  )
})

test('local Complete requires all 18 bound artifacts and release-ready validation evidence', () => {
  const done = localJob({ status: 'done', ...localCompletion, ...localArtifacts })
  assert.equal(assertLocalTilesJob(done, { terminal: true }).status, 'done')
  assert.throws(
    () => assertLocalTilesJob({ ...done, validation_status: 'fail' }, { terminal: true }),
    (error) => error.code === 'local_validation_failed' && error.payload.invalid.includes('validation_status:fail'),
  )
  assert.throws(
    () => assertLocalTilesJob({ ...done, workflow_release_evidence_md_url: undefined }, { terminal: true }),
    (error) => error.code === 'artifact_missing',
  )
})

test('terminal Job validators return normalized artifact URLs instead of original absolute values', () => {
  const local = assertLocalTilesJob({
    ...localJob({ status: 'done' }),
    ...localCompletion,
    ...localArtifacts,
    strict_atlas_png_url: 'http://local.invalid/generated/job_tiles_1/strict_atlas.png',
  }, { terminal: true })
  assert.equal(local.strict_atlas_png_url, '/generated/job_tiles_1/strict_atlas.png')

  const benchmark = assertTilesBenchmarkJob(benchmarkJob({
    status: 'done',
    run_id: 'run_1',
    provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 4 },
    ...benchmarkArtifacts,
    material_source_benchmark_url: 'http://local.invalid/generated/two-point-five-d-material-source-benchmarks/run_1/material_source_benchmark.json',
  }), {
    maxProviderCalls: 4,
    terminal: true,
    expectedRunId: 'run_1',
    providerPresetId: 'gemini-native',
    candidateCount: 4,
  })
  assert.equal(benchmark.material_source_benchmark_url, benchmarkArtifacts.material_source_benchmark_url)
})

test('benchmark poll preserves the authoritative call budget and never posts a second run', async () => {
  const queue = [
    benchmarkJob({ status: 'generating', provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 1 } }),
    benchmarkJob({ status: 'done', run_id: 'run_1', provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 4 }, ...benchmarkArtifacts }),
  ]
  const updates = []
  const requests = []
  const result = await pollTilesJob(benchmarkJob(), {
    kind: 'benchmark',
    maxProviderCalls: 4,
    expectedBenchmark: {
      expectedRunId: 'run_1',
      providerPresetId: 'gemini-native',
      expectedProviderConfig: sealedGeminiProvider,
      candidateCount: 4,
    },
    sleepImpl: async () => {},
    onUpdate(job) { updates.push([job.status, job.provider_call_budget.used_provider_calls]) },
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method })
      return jsonResponse(queue.shift())
    },
  })
  assert.equal(result.status, 'done')
  assert.deepEqual(updates, [['queued', 0], ['generating', 1], ['done', 4]])
  assert.deepEqual(requests, [
    { url: '/api/jobs/job_tiles_benchmark_1', method: 'GET' },
    { url: '/api/jobs/job_tiles_benchmark_1', method: 'GET' },
  ])
})

test('benchmark report is bound to the sealed run, preset, candidates, and Job budget', () => {
  const job = benchmarkJob({
    status: 'done',
    run_id: 'run_1',
    provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 4 },
    ...benchmarkArtifacts,
  })
  const request = {
    description: 'mossy cliff grass blocks with cool stone sides',
    providerPresetId: 'gemini-native',
    candidateCount: 4,
    maxProviderCalls: 4,
    options: {
      mapSolver: 'constraint',
      mapBorder: 'empty',
      mapWidth: 8,
      mapHeight: 6,
      mapSeed: 170617,
      mapDensity: 0.55,
      editorOperations: [],
    },
  }
  const report = {
    mode: 'two_point_five_d_material_source_benchmark_v1',
    run_id: 'run_1',
    plan: {
      run_id: 'run_1',
      provider_preset_id: 'gemini-native',
      provider_config: {
        selected_available: true,
        ...sealedGeminiProvider,
      },
      candidate_count: 4,
      estimated_provider_calls: 4,
      map_options: {
        solver: 'constraint',
        width: 8,
        height: 6,
        seed: 170617,
        density: 0.55,
        border: 'empty',
        fixedMasks: [],
        editorOperations: [],
      },
      cases: [{
        id: 'custom_material_source',
        description: 'mossy cliff grass blocks with cool stone sides',
      }],
    },
    summary: {
      status: 'pass',
      case_count: 1,
      candidate_count: 4,
      selected_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 4, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      stopped_early: false,
      provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 4 },
      failure_taxonomy: { top_categories: [] },
    },
    status: 'pass',
    cases: [benchmarkReportCase('mossy cliff grass blocks with cool stone sides')],
  }
  assert.equal(assertTilesBenchmarkReport(report, {
    job,
    request,
    runId: 'run_1',
    sealedProviderConfig: sealedGeminiProvider,
  }), report)
  assert.throws(
    () => assertTilesBenchmarkReport({ ...report, run_id: 'other_run' }, { job, request, runId: 'run_1' }),
    (error) => error.code === 'benchmark_report_binding_mismatch',
  )
  assert.throws(
    () => assertTilesBenchmarkReport({
      ...report,
      plan: { ...report.plan, cases: [{ ...report.plan.cases[0], description: 'different material' }] },
    }, { job, request, runId: 'run_1' }),
    (error) => error.code === 'benchmark_report_binding_mismatch',
  )
  assert.throws(
    () => assertTilesBenchmarkReport({
      ...report,
      plan: { ...report.plan, map_options: { ...report.plan.map_options, width: 9 } },
    }, { job, request, runId: 'run_1' }),
    (error) => error.code === 'benchmark_report_binding_mismatch',
  )
  assert.throws(
    () => assertTilesBenchmarkReport({ ...report, cases: [] }, {
      job,
      request,
      runId: 'run_1',
      sealedProviderConfig: sealedGeminiProvider,
    }),
    (error) => error.code === 'benchmark_report_invalid',
  )
  assert.throws(
    () => assertTilesBenchmarkReport({
      ...report,
      summary: {
        ...report.summary,
        selected_pass_rate: 0,
        candidate_validation: { pass: 0, warning: 0, fail: 0, error: 4 },
      },
    }, {
      job,
      request,
      runId: 'run_1',
      sealedProviderConfig: sealedGeminiProvider,
    }),
    (error) => error.code === 'benchmark_report_invalid',
  )
  assert.throws(
    () => assertTilesBenchmarkReport({
      ...report,
      plan: {
        ...report.plan,
        provider_config: { ...report.plan.provider_config, model: 'gemini-drifted-model' },
      },
    }, {
      job,
      request,
      runId: 'run_1',
      sealedProviderConfig: sealedGeminiProvider,
    }),
    (error) => error.code === 'benchmark_report_binding_mismatch',
  )

  const earlyCase = benchmarkReportCase(request.description, 2)
  earlyCase.candidates[1] = {
    ...earlyCase.candidates[1],
    status: 'error',
    blocking_errors: ['provider_material_source_generation_failed'],
    non_retryable: true,
  }
  earlyCase.candidate_selection.ranking = [earlyCase.candidates[0], earlyCase.candidates[1]]
  const earlyJob = {
    ...job,
    provider_call_budget: { planned_provider_calls: 4, max_provider_calls: 4, used_provider_calls: 1 },
  }
  const earlyReport = {
    ...report,
    status: 'fail',
    summary: {
      ...report.summary,
      status: 'fail',
      candidate_count: 2,
      candidate_validation: { pass: 1, warning: 0, fail: 0, error: 1 },
      provider_call_budget: earlyJob.provider_call_budget,
      stopped_early: true,
      failure_taxonomy: {
        top_categories: [{
          id: 'provider_material_source_generation_failed',
          count: 1,
          examples: ['custom_material_source/candidate_02'],
        }],
      },
    },
    cases: [earlyCase],
  }
  assert.equal(assertTilesBenchmarkReport(earlyReport, {
    job: earlyJob,
    request,
    runId: 'run_1',
    sealedProviderConfig: sealedGeminiProvider,
  }), earlyReport)
})

test('only definite 4xx benchmark submission rejections permit a fresh live run', () => {
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: 400 }), true)
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: 409 }), true)
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: 429 }), true)
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: 500 }), false)
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: 503 }), false)
  assert.equal(tilesBenchmarkSubmissionIsDefiniteRejection({ status: null }), false)
})
