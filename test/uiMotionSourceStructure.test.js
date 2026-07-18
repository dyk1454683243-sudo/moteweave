import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  fetchImageArtifact,
  fetchJsonArtifact,
  pollMotionSourceJob,
  releaseMotionSourceUpload,
  releaseMotionSourceUploadOperation,
  uploadMotionSource,
  waitForMotionSourceJob,
} from '../src/ui/motionSource/api.js'
import { serializeMotionPixelGridRecipe } from '../src/ui/motionSourceTab.js'

test('Motion Source UI exposes the real Guided workflow, Advanced fallback, and C/D bindings', async () => {
  const [html, appState, api, tab, guidedState, promptTabs, i18n, css] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('src/ui/appState.js', 'utf8'),
    readFile('src/ui/motionSource/api.js', 'utf8'),
    readFile('src/ui/motionSourceTab.js', 'utf8'),
    readFile('src/ui/motionSource/guidedState.js', 'utf8'),
    readFile('src/ui/promptTabs.js', 'utf8'),
    readFile('src/ui/i18n.js', 'utf8'),
    readFile('src/v8.css', 'utf8'),
  ])

  assert.match(html, /id="motion-source-tab"[\s\S]*aria-controls="motion-source"/)
  assert.match(html, /id="motion-source-view-guided"[^>]*aria-pressed="true"/)
  assert.match(html, /id="motion-source-view-advanced"[^>]*aria-pressed="false"/)
  assert.equal((html.match(/class="motion-guide-step"/g) ?? []).length, 5)
  assert.match(html, /id="motion-source-guided-sidebar"/)
  assert.match(html, /id="motion-source-advanced-sidebar"[\s\S]*hidden/)
  assert.match(html, /id="motion-guide-future-semantic"[\s\S]*button type="button" disabled/)
  assert.match(html, /id="motion-guide-future-adaptive"[\s\S]*button type="button" disabled/)
  assert.match(html, /id="motion-source-selection-mode"[\s\S]*value="auto" selected[\s\S]*value="manual"/)
  assert.match(html, /id="motion-source-restore-auto"/)
  assert.match(html, /id="motion-source-cancel"[^>]*disabled/)
  assert.match(html, /id="motion-source-resume"[^>]*disabled/)
  assert.match(html, /id="motion-guide-cancel"[^>]*hidden[^>]*disabled/)
  assert.match(html, /id="motion-guide-resume"[^>]*hidden[^>]*disabled/)
  assert.match(html, /id="motion-guide-build-engine-packs"[^>]*disabled/)
  assert.match(html, /id="motion-source-build-engine-packs"[^>]*disabled/)
  assert.match(html, /id="motion-source-identity"/)
  assert.match(html, /id="motion-source-status"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="motion-source-selection-mode"[^>]*aria-describedby="motion-source-selection-hint"/)
  assert.match(html, /id="motion-source-selection-recipe"[\s\S]*motion_selection_v1_compat[\s\S]*motion_selection_recipe_v2/)
  assert.match(html, /id="motion-source-loop-expectation"[\s\S]*value="auto"[\s\S]*value="loop"[\s\S]*value="once"/)
  assert.match(html, /id="motion-source-temporal-matte"[\s\S]*value="disabled"[\s\S]*value="evidence_only"/)
  assert.match(html, /id="motion-source-pixel-grid-recipe"[\s\S]*value="disabled" selected[\s\S]*pixel_grid_v2_balanced[\s\S]*pixel_grid_v2_detail_safe[\s\S]*pixel_grid_v2_oklab/)
  assert.match(html, /id="motion-source-pixel-grid-recipe"[^>]*aria-describedby="motion-source-pixel-grid-hint"/)
  for (const id of ['source', 'selection', 'loop', 'cleanup', 'grid', 'binding']) {
    assert.match(html, new RegExp(`id="motion-hud-${id}"`))
  }
  assert.match(appState, /view:\s*'guided'/)
  assert.match(appState, /selectionMode:\s*'auto'/)
  assert.match(appState, /frameCandidates:\s*\[\]/)
  assert.match(appState, /previewBinding:\s*null/)
  assert.match(appState, /buildBinding:\s*null/)
  assert.match(appState, /artifactErrors:\s*\{[\s\S]*preview:\s*\{\}[\s\S]*build:\s*\{\}[\s\S]*setApply:\s*\{\}/)
  assert.match(appState, /enginePacks:\s*\{\}/)
  assert.match(appState, /enginePackBinding:\s*null/)
  assert.doesNotMatch(appState, /artifactError:\s*null/)
  assert.match(appState, /reports:\s*\{/)
  assert.match(appState, /sourceEpoch:\s*0/)
  assert.match(appState, /sourceUploadOperationId:\s*null/)
  assert.match(appState, /uiOperation:\s*null/)
  assert.match(appState, /renderToken:\s*0/)
  assert.match(appState, /releaseTasks:\s*new Map\(\)/)
  assert.match(api, /POST|method:\s*'POST'/)
  assert.match(api, /\/api\/motion-source\/uploads/)
  assert.match(api, /method:\s*'DELETE'/)
  assert.doesNotMatch(api, /fileToBase64/)
  assert.match(api, /export async function fetchImageArtifact/)
  assert.match(api, /buildMotionEnginePacksFromAppliedSheet/)
  assert.match(api, /\/api\/process-sheet/)
  assert.match(api, /'failed_quality_gate'/)
  assert.match(tab, /TOPDOWN_RPG_V0\.animations/)
  assert.match(tab, /preservePreviewCandidates/)
  assert.match(tab, /restoreAutoFrameSelection/)
  assert.match(tab, /setSelectionMode\('manual',\s*\{ clearManual: false \}\)/)
  assert.match(tab, /if \(requestedSelectionMode === 'manual'\) options\.selected_frame_indexes = selectedIndexes/)
  assert.match(tab, /frames:\s*Number\(\$\('#motion-source-target-frames'\)\.value\)/)
  assert.doesNotMatch(tab, /frames:\s*requestedSelectionMode === 'manual'/)
  assert.match(tab, /motion_selection:\s*motionSelection/)
  assert.match(tab, /if \(pixelGridRefinement\) options\.pixel_grid_refinement = pixelGridRefinement/)
  assert.match(tab, /'#motion-source-pixel-grid-recipe'/)
  assert.match(tab, /motionCandidateFingerprint/)
  assert.match(tab, /motionBuildFingerprint/)
  assert.match(tab, /isMotionPreviewBindingCurrent/)
  assert.match(tab, /isMotionBuildBindingCurrent/)
  assert.match(tab, /motionApplyCompatibility/)
  assert.match(tab, /mapMotionEvidence/)
  assert.match(tab, /await fetchImageArtifact\(job\.normalized_motion_strip_url/)
  assert.match(tab, /await fetchImageArtifact\(job\.applied_normalized_sheet_url/)
  assert.match(tab, /await fetchJsonArtifact\(job\.debug_report_url/)
  assert.match(tab, /await fetchImageArtifact\(job\.normalized_sheet_url/)
  assert.match(tab, /assertMotionEnginePackResult/)
  assert.match(tab, /buildMotionApplyContextCommit/)
  assert.match(tab, /buildMotionApplyContextCommit\([\s\S]{0,180}kind:\s*'set'/)
  assert.match(tab, /buildMotionApplyContextCommit\([\s\S]{0,180}kind:\s*'single'/)
  assert.match(tab, /motionEnginePackBindingCurrent/)
  assert.match(tab, /buildMotionEnginePacksFromAppliedSheet/)
  assert.match(tab, /state\.motionSource\.artifactErrors\[storeKey\]/)
  assert.match(tab, /image_load:\$\{error\.artifact_url\}/)
  assert.match(tab, /artifactErrorFor\('preview'\)/)
  assert.match(tab, /artifactErrorFor\('setApply'\)/)
  const renderMotionJobStart = tab.slice(
    tab.indexOf('async function renderMotionJob'),
    tab.indexOf('async function renderMotionJob') + 240
  )
  assert.doesNotMatch(renderMotionJobStart, /clearArtifactError/)
  assert.match(
    tab,
    /await fetchImageArtifact\(job\.normalized_motion_strip_url[\s\S]{0,500}clearArtifactError\(handle\.storeKey\)[\s\S]{0,500}state\.motionSource\.reports\.build/
  )
  assert.match(tab, /sourceEpoch \+= 1/)
  assert.match(tab, /MOTION_RELEASE_REQUEST_TIMEOUT_MS\s*=\s*3000/)
  assert.match(tab, /releaseMotionSourceUploadOperation\(operationId, request\)/)
  assert.match(tab, /releaseMotionSourceUpload\(uploadId, request\)/)
  assert.match(tab, /priorUploadOperationId/)
  assert.match(tab, /job\.operation_id === handle\.operationId/)
  assert.match(tab, /job\.source_identity === handle\.sourceIdentity/)
  assert.match(tab, /job\.options_hash === handle\.optionsHash/)
  assert.match(tab, /function startMotionPreview\(\)[\s\S]*const options = motionOptionsForAction\(\)[\s\S]*previewMotionFrames\(source, options, request\)/)
  assert.match(tab, /function startMotionBuild\([\s\S]*const options = motionOptionsForAction\(\)[\s\S]*buildMotionStrip\(source, options, request\)/)
  assert.match(tab, /state\.motionSource\.activeOperation \?\? state\.motionSource\.resumableOperation/)
  assert.match(tab, /resumeMotionJob[\s\S]*refreshFirst: true/)
  assert.match(tab, /handle\.starter\(descriptor,[\s\S]*operationId: handle\.operationId/)
  assert.match(tab, /assertBoundMotionArtifact\(handle, index\)/)
  assert.match(tab, /assertBoundMotionArtifact\(handle, report\)/)
  assert.doesNotMatch(tab, /onUpdate:\s*\(current\)\s*=>\s*\{[\s\S]{0,260}renderMotionJob/)
  assert.match(tab, /videoToolBlocked/)
  assert.match(tab, /rembgToolBlocked/)
  assert.match(guidedState, /motion_selection_v1_dependency_violation/)
  assert.match(guidedState, /passthrough_normalization_incompatible/)
  assert.match(promptTabs, /aria-selected/)
  assert.match(promptTabs, /panel\.hidden = !active/)
  assert.match(i18n, /'motion\.view\.guided': 'Guided'/)
  assert.match(i18n, /'motion\.view\.guided': '引导模式'/)
  assert.match(css, /#motion-source button:focus-visible/)
  assert.match(css, /@media \(max-width: 1180px\)/)
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.motion-source-report-grid[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(css, /playback-status\[data-status="paused"\]/)
  assert.doesNotMatch(html, /adaptive candidate generation[^<]*enabled/i)
})

test('Motion Pixel Grid recipe serialization omits Disabled and preserves real recipes', () => {
  assert.equal(serializeMotionPixelGridRecipe('disabled'), null)
  assert.deepEqual(
    serializeMotionPixelGridRecipe('pixel_grid_v2_balanced'),
    { recipe: 'pixel_grid_v2_balanced' }
  )
  assert.throws(
    () => serializeMotionPixelGridRecipe('pixel_grid_future'),
    /Unsupported Motion Pixel Grid recipe/
  )
})

test('Motion Source browser API can request release before an upload descriptor exists', async () => {
  const previousFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 200,
      json: async () => ({ operation_id: 'motion_upload_op_test', pending: true }),
    }
  }
  try {
    const result = await releaseMotionSourceUploadOperation('motion_upload_op_test')
    assert.equal(result.pending, true)
    assert.equal(request.url, '/api/motion-source/upload-operations/motion_upload_op_test')
    assert.equal(request.options.method, 'DELETE')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser API releases only the named server upload', async () => {
  const previousFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 200,
      json: async () => ({ upload_id: 'motion_upload_test', released: true, pending: false }),
    }
  }
  try {
    const result = await releaseMotionSourceUpload('motion_upload_test')
    assert.equal(result.released, true)
    assert.equal(request.url, '/api/motion-source/uploads/motion_upload_test')
    assert.equal(request.options.method, 'DELETE')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser release requests stop at a bounded deadline', async () => {
  const previousFetch = globalThis.fetch
  let requestSignal = null
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return new Promise(() => {})
  }
  try {
    await assert.rejects(
      releaseMotionSourceUploadOperation('motion_upload_op_timeout', { timeoutMs: 20 }),
      (error) => error?.code === 'motion_release_timeout' && error?.timeout_ms === 20
    )
    assert.equal(requestSignal.aborted, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source artifact reads stop at a bounded deadline', async () => {
  const previousFetch = globalThis.fetch
  let requestSignal = null
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return new Promise(() => {})
  }
  try {
    await assert.rejects(
      fetchJsonArtifact('/generated/job/report.json', { timeoutMs: 20 }),
      (error) => error?.code === 'motion_artifact_timeout' && error?.timeout_ms === 20
    )
    assert.equal(requestSignal.aborted, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source image artifact reads reject undecodable bytes', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(['not an image'], { type: 'text/plain' }),
  })
  try {
    await assert.rejects(
      fetchImageArtifact('/generated/job/normalized_motion_strip.png'),
      (error) => error?.code === 'motion_artifact_unreadable'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser API uploads the original File body without Base64 conversion', async () => {
  const previousFetch = globalThis.fetch
  const source = { name: 'walk.mp4', type: 'video/mp4' }
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 201,
      json: async () => ({
        upload_id: 'motion_upload_test',
        operation_id: 'motion_upload_op_test',
        source_identity: `sha256:${'a'.repeat(64)}`,
      }),
    }
  }
  try {
    const descriptor = await uploadMotionSource(source, { operationId: 'motion_upload_op_test' })
    assert.equal(descriptor.upload_id, 'motion_upload_test')
    assert.match(request.url, /source_name=walk\.mp4/)
    assert.match(request.url, /operation_id=motion_upload_op_test/)
    assert.equal(request.options.body, source)
    assert.equal(request.options.headers['content-type'], 'video/mp4')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source polling keeps abort, timeout, and missing-session failures distinct', async () => {
  const queued = { id: 'job_test', status: 'queued' }
  await assert.rejects(
    waitForMotionSourceJob(queued, { timeoutMs: 0 }),
    (error) => error.code === 'poll_timeout' && error.job_id === 'job_test' && error.job === queued
  )

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    waitForMotionSourceJob(queued, { signal: controller.signal }),
    (error) => error.name === 'AbortError'
  )

  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'motion_job_not_found', reason: 'server session expired' }),
  })
  try {
    await assert.rejects(
      pollMotionSourceJob('job_test'),
      (error) => error.status === 404 && error.code === 'motion_job_not_found'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source polling keeps the exact job id and bounds a stalled fetch', async () => {
  const previousFetch = globalThis.fetch
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'job_other', status: 'queued' }),
    }
  }
  try {
    await assert.rejects(
      waitForMotionSourceJob(
        { id: 'job_exact', status: 'queued' },
        { pollMs: 0, timeoutMs: 100 }
      ),
      (error) => error.code === 'motion_job_binding_mismatch' &&
        error.job_id === 'job_exact' &&
        error.received_job_id === 'job_other'
    )
    assert.deepEqual(requestedUrls, ['/api/jobs/job_exact'])
  } finally {
    globalThis.fetch = previousFetch
  }

  let markFetchStarted
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve
  })
  globalThis.fetch = async (_url, { signal }) => new Promise((resolve, reject) => {
    markFetchStarted?.()
    signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  try {
    const controller = new AbortController()
    const externallyAborted = waitForMotionSourceJob(
      { id: 'job_aborted', status: 'queued' },
      { pollMs: 0, timeoutMs: 100, signal: controller.signal }
    )
    const abortAssertion = assert.rejects(
      externallyAborted,
      (error) => error.name === 'AbortError' && error.code !== 'poll_timeout'
    )
    await fetchStarted
    controller.abort()
    await abortAssertion

    await assert.rejects(
      waitForMotionSourceJob(
        { id: 'job_stalled', status: 'queued' },
        { pollMs: 0, timeoutMs: 10 }
      ),
      (error) => error.code === 'poll_timeout' &&
        error.job_id === 'job_stalled' &&
        error.job?.id === 'job_stalled'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})
