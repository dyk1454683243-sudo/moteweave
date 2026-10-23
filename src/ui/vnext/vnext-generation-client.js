import { FIXED_REGION_PROFILE, selectStrictGeminiPreset } from '../../editor-project/composerCapabilities.js'
// The maintained strict full-sheet contract (also used by Studio): artifact-verified acceptance and
// provider-free restore of a review-required job from its stored artifacts.
import {
  isRecoverableStrictPendingRestoreError,
  replayStrictAcceptedPublication,
  prepareStrictManualAcceptanceEvidence,
  restoreStrictReviewRequiredGeneration,
} from '../studio/characterApi.js'
export { selectStrictGeminiPreset }
export const VNEXT_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/

export const VNEXT_PROCESS_OPTIONS = Object.freeze({
  sourceLayout: 'fixed_region_motion_v0',
  backgroundMode: 'deterministic_pixel_matte_v2',
  description: '',
  backgroundTolerance: 24,
  anchorOffset: Object.freeze({ x: 0, y: 0 }),
  frameAdjustments: Object.freeze([]),
  lockedAnimations: Object.freeze([]),
  autoCorrect: true,
  motionStabilize: true,
  pixelFinishing: false,
  sourcePixelRecovery: 'global_median_v1',
})

export const VNEXT_PROCESS_UNSUPPORTED = Object.freeze({
  dual_matte: 'No control in this batch; dual_matte is unsupported.',
  blackSourceBuffer: 'No control in this batch; black-matte pairing is unsupported.',
  manualOverrides: 'No control in this batch; manual overrides are unsupported.',
  styleEnforcement: 'No formal process-sheet field; not invented.',
})

export const VNEXT_FILE02_FORMATS = Object.freeze([
  Object.freeze({ key: 'normalized_sheet_url', file: 'normalized_sheet.png', label: 'Sheet PNG', processed: true }),
  Object.freeze({ key: 'animations_url', file: 'animations.json', label: 'Animations', processed: true }),
  Object.freeze({ key: 'metadata_url', file: 'metadata.json', label: 'Metadata', processed: true }),
  Object.freeze({ key: 'editor_metadata_url', file: 'editor_metadata.json', label: 'Editor metadata', processed: true }),
  Object.freeze({ key: 'debug_report_url', file: 'debug_report.json', label: 'Quality report', processed: true }),
  Object.freeze({ key: 'zip_url', file: 'character_pack.zip', label: 'Character pack', processed: true }),
  Object.freeze({ key: 'godot_npc_zip_url', file: 'godot_npc_pack.zip', label: 'Godot pack', processed: true }),
  Object.freeze({ key: 'rpgmaker_zip_url', file: 'rpgmaker_pack.zip', label: 'RPG Maker pack', processed: true }),
  Object.freeze({ key: 'ocad_zip_url', file: 'ocad_pack.zip', label: 'OCAD pack', processed: true }),
])

// Requested runs execute end to end; these strings describe progress, results and recovery only.
export const VNEXT_GENERATION_COPY = Object.freeze({
  reviewTitle: 'Preparing the sheet…',
  preparingBody: 'Checking the request before the one generation call.',
  reviewGate: 'The request changed before generation started. Nothing was generated; send it again.',
  noProposal: 'Describe what to make and send it. The assistant runs the selected preset when it fits.',
  generateAgain: 'Generate again',
  generateAgainTitle: 'Run this preset again with the same request. This is a new provider call.',
  needSkill: 'Select Fixed-region motion in Your skills first.',
  needPrompt: 'Describe the character first.',
  geminiMissing: 'Gemini is not ready. Set GEMINI_API_KEY and restart the server, then try again.',
  recoveryTitle: 'Sheet not finished',
  recoveryBody: 'The connection was interrupted. The result is not yet known.',
  recoveryGate: 'No automatic retry.',
  stoppedTitle: 'Stopped waiting',
  stoppedBody: 'A job that already started may still finish; check it with its Job ID. No automatic retry.',
  stoppedBeforeCall: 'Stopped before the generation call. Nothing was generated.',
  presetUnavailable: 'Fixed-region motion is not ready: this server has no Gemini 2K square image preset. Nothing was generated.',
  continueQuery: 'Continue query',
  stopWaiting: 'Stop waiting',
  jobIdLabel: 'Known Job ID',
  jobIdPlaceholder: 'Enter a known Job ID',
  invalidJobId: 'Job ID is not a valid identifier.',
  missingJobId: 'No Job ID. Continue query does not resubmit.',
  runningTitle: 'Generating the sheet…',
  runningBody: 'One image, no automatic retry.',
  candidateTitle: 'Image generated',
  candidateResumeBody: 'Processing has not finished for this image. Finish processing to place this same image; it is not generated again.',
  adopt: 'Finish processing',
  processingTitle: 'Processing the sheet…',
  processingBody: 'Removing the background and building the sprite sheet.',
  processFailedTitle: 'Processing failed',
  generateFailedTitle: 'Generation failed',
  needProcessed: 'Processing must pass before adding to the canvas.',
  viewJob: 'View job status',
  jobNotFoundTitle: 'Job not found',
  jobNotFoundBody: 'No job or saved result with this ID is available in the local service, so there is nothing to finish. Checking it generated and changed nothing; enter another Job ID to check it.',
  jobUnavailableTitle: 'Job cannot be finished',
  jobUnavailableBody: 'This job\'s files exist, but it is not a generated sheet that can be finished here. Nothing was generated or changed.',
  jobLostBody: 'The local service no longer holds this job and its result was not saved, so it cannot be finished. Its one generation call may already have been used; nothing is retried.',
  jobHeldBody: 'This sheet is already in this project. The local service no longer holds its job, so nothing was finished or added again.',
  jobSavedOffCanvasBody: 'This sheet is saved in this project, but no canvas shows it now. The local service no longer holds its job, so nothing was finished or added again.',
  savedOffCanvasTitle: 'Saved, not on the canvas',
  savedOffCanvasBody: 'This sheet is saved in this project, but no canvas shows it now. Nothing was added again; the downloads stay available.',
  undoneRedoBody: 'Undo removed the new canvas; the sheet stays saved in this project. Redo puts the same canvas back.',
  undoneBody: 'Undo removed the new canvas; the sheet stays saved in this project.',
  undoneRedoRetryBody: 'Undo removed the new canvas; the sheet stays saved in this project. Redo could not run while another change was saving; try again.',
  addWaitedForSaveBody: 'Another canvas change was still saving, so the sheet was not added yet. Add to canvas adds it once that change is saved; nothing is generated again.',
  // After Undo and a page reload (no Redo): the same saved canvas is put back with the canvas restore.
  putBack: 'Put back on the canvas',
  puttingBack: 'Putting back…',
  putBackTitle: 'Put the same saved canvas back where it was; nothing is added, processed or generated again',
  putBackBody: 'Undo removed this sheet\'s canvas; the sheet stays saved in this project. Put back on the canvas restores that same canvas; nothing is added or generated again.',
  putBackRetryBody: 'Undo removed this sheet\'s canvas; the sheet stays saved in this project. Putting it back could not run while another change was saving; try again.',
  putBackUnknownBody: 'Undo removed this sheet\'s canvas; the sheet stays saved in this project. Putting it back was not confirmed; Put back on the canvas checks the same request and does not add another canvas.',
  putBackChangedBody: 'Undo removed this sheet\'s canvas; the sheet stays saved in this project. The project changed meanwhile, so nothing was put back; try again.',
  putBackLimitBody: 'Undo removed this sheet\'s canvas; the sheet stays saved in this project. The project already holds as many canvases as it can; remove one, then try again.',
  putBackRefusedBody: 'This sheet is saved in this project, but its canvas can no longer be put back here. Nothing was added again; the downloads stay available.',
  putBackNotShownBody: 'The same canvas was put back, but this view did not reload. Reload the page to see it; nothing is added again.',
  putBackDoneBody: 'Back on the canvas. Undo removes it.',
  jobNeedsProjectTitle: 'Open a project first',
  jobNeedsProjectBody: 'The local service no longer holds this processing job. Open its project to check whether the sheet is already there. Nothing was generated or changed.',
  jobLookupTitle: 'Job not checked',
  jobLookupBody: 'The local service did not answer the check. Nothing was generated again; Continue query checks the same Job ID again.',
  jobGoneBody: 'The local service no longer holds this job (it may have restarted). Nothing was generated again; Continue query checks whether its result was saved.',
  readyTitle: 'Sprite sheet on the canvas',
  readyPendingTitle: 'Sprite sheet ready',
  addCanvas: 'Add to canvas',
  download: 'Download artifact',
})

export const VNEXT_GENERATE_PROFILE = FIXED_REGION_PROFILE

const RUNNING = new Set(['queued', 'generating', 'post_processing'])
const FAILED = new Set([
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

export function normalizeJobId(value) {
  return String(value ?? '').trim()
}

export function isUsableJobId(value) {
  return VNEXT_JOB_ID_PATTERN.test(normalizeJobId(value))
}

export function qualityPassed(job) {
  const status = job?.debug_report?.status
    ?? job?.debug_report?.validation?.status
    ?? job?.debug_report?.quality?.status
    ?? job?.quality_status
    ?? job?.validation?.status
  return job?.status === 'done' && status === 'pass'
}

export function hasProcessedSheet(job) {
  return Boolean(job?.normalized_sheet_url || job?.normalized_sheet_sha256)
}

// The local service answers { status: 'not_found' } for a job it does not hold; that is never a
// candidate (restoreGenerationJob decides whether its stored artifacts can still be continued).
export function isJobNotFound(job) {
  return job?.status === 'not_found'
}

export function classifyGenerationJob(job) {
  if (!job || isJobNotFound(job)) return 'missing'
  if (RUNNING.has(job.status)) return 'running'
  if (FAILED.has(job.status) && hasProcessedSheet(job)) return 'process_failed'
  if (FAILED.has(job.status)) return 'failed'
  if (job.status === 'done' && qualityPassed(job) && hasProcessedSheet(job)) return 'ready'
  if (job.status === 'done' && hasProcessedSheet(job)) return 'process_failed'
  if (job.status === 'done') return 'candidate'
  return 'unknown'
}

export function classifyAfterGenerate(job) {
  if (!job || isJobNotFound(job)) return 'missing'
  if (RUNNING.has(job.status)) return 'running'
  if (FAILED.has(job.status)) return hasProcessedSheet(job) ? 'process_failed' : 'failed'
  return 'candidate'
}

const GENERATED_PNG = /^\/generated\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\/[A-Za-z0-9._-]+\.png$/
const GENERATED_ARTIFACT = /^\/generated\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,119})\/([A-Za-z0-9._-]+)$/

export function isGeneratedArtifactUrl(url, jobId, fileName) {
  const match = typeof url === 'string' ? url.match(GENERATED_ARTIFACT) : null
  return Boolean(match && match[1] === normalizeJobId(jobId) && match[2] === fileName)
}

const PROCESS_ARTIFACT_KEYS = Object.freeze([
  ['normalized_sheet_url', 'normalized_sheet.png'],
  ['animations_url', 'animations.json'],
  ['metadata_url', 'metadata.json'],
  ['editor_metadata_url', 'editor_metadata.json'],
  ['debug_report_url', 'debug_report.json'],
])

export function isCompletedProcessJobShape(job) {
  return Boolean(job?.status === 'done' && !job?.generation_url && job?.id && PROCESS_ARTIFACT_KEYS.every(([key, file]) => (
    isGeneratedArtifactUrl(job[key], job.id, file)
  )))
}

export function isGeneratedPngUrl(url, jobId = null) {
  if (typeof url !== 'string' || !GENERATED_PNG.test(url)) return false
  if (jobId == null) return true
  return url.split('/')[2] === normalizeJobId(jobId)
}

export function candidateImageUrl(job) {
  const listed = [job?.source_url, job?.t2i_result_url]
  if (Array.isArray(job?.candidate_urls)) {
    for (const item of job.candidate_urls) listed.push(typeof item === 'string' ? item : item?.url)
  }
  return listed.find((url) => isGeneratedPngUrl(url, job?.id)) ?? null
}

export function displayJobImageUrl(job, phase) {
  if (phase === 'ready' && isGeneratedPngUrl(job?.normalized_sheet_url, job?.id)) return job.normalized_sheet_url
  return candidateImageUrl(job)
}

export function canCreateFromJob(job) {
  return qualityPassed(job) && hasProcessedSheet(job) && job?.human_decision_status !== 'pending'
}

export function restoreJobPhase(job) {
  if (job?.human_decision_status === 'pending') return classifyAfterGenerate(job)
  const processed = classifyGenerationJob(job)
  if (processed === 'ready' || processed === 'process_failed') return processed
  return classifyAfterGenerate(job)
}

export function file02Availability(job) {
  const qa = qualityPassed(job)
  return VNEXT_FILE02_FORMATS.map((format) => {
    const url = job?.[format.key]
    const present = isGeneratedArtifactUrl(url, job?.id, format.file)
    return {
      ...format,
      url: present ? url : null,
      available: present && (!format.processed || qa),
      reason: !present
        ? 'This format has no Job URL.'
        : (!qa ? 'Processed downloads require a passing quality report.' : null),
    }
  })
}

export function buildProcessSheetPayload({ name, sourceBase64 }) {
  return {
    source_base64: sourceBase64,
    source_black_base64: null,
    options: {
      name,
      ...VNEXT_PROCESS_OPTIONS,
      anchorOffset: { ...VNEXT_PROCESS_OPTIONS.anchorOffset },
      frameAdjustments: [...VNEXT_PROCESS_OPTIONS.frameAdjustments],
      lockedAnimations: [...VNEXT_PROCESS_OPTIONS.lockedAnimations],
    },
  }
}

export function buildReviewRequest({ description, providerPresetId, reference } = {}) {
  const request = {
    generationProfileId: VNEXT_GENERATE_PROFILE.generationProfileId,
    description: String(description ?? ''),
    t2iMode: VNEXT_GENERATE_PROFILE.t2iMode,
    imageConfig: { ...VNEXT_GENERATE_PROFILE.imageConfig },
    generationOptions: { ...VNEXT_GENERATE_PROFILE.generationOptions },
    maxProviderCalls: VNEXT_GENERATE_PROFILE.maxProviderCalls,
    backgroundMode: VNEXT_GENERATE_PROFILE.backgroundMode,
  }
  if (providerPresetId) request.providerPresetId = String(providerPresetId)
  if (reference?.base64) {
    request.reference_image_base64 = reference.base64
    request.reference_image_mime = reference.mimeType || 'image/png'
    request.reference_image_name = reference.name || 'reference.png'
  }
  return request
}

export function buildLiveGenerateRequest(review) {
  return {
    generationProfileId: VNEXT_GENERATE_PROFILE.generationProfileId,
    reviewedRunId: review.reviewed_run_id,
    expectedPlanHash: review.plan_hash,
    expectedReferenceManifestSha256: review.reference_manifest_sha256,
    confirmLiveGeneration: true,
    maxProviderCalls: VNEXT_GENERATE_PROFILE.maxProviderCalls,
  }
}

// VNext accepts a preset result because the user requested it, not because anyone inspected the
// image: the record says so (acceptanceBasis 'user_request') and claims no reviewed issues. The
// hashes come from the strict acceptance evidence (verified artifact bytes and the sealed review),
// never from job-record fields; the server checks every one of them again.
export const VNEXT_ACCEPTANCE_BASIS = 'user_request'
export function vnextAcceptRequest(acceptanceBody) {
  return { ...acceptanceBody, humanReviewedIssueCount: 0, acceptanceBasis: VNEXT_ACCEPTANCE_BASIS }
}

export function createVnextGenerationClient({ fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch.bind(globalThis)

  async function readJson(response) {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  async function request(url, init) {
    const response = await fetchFn(url, init)
    const body = await readJson(response)
    if (!response.ok) {
      const error = new Error(body.reason || body.error || `http_${response.status}`)
      error.status = response.status
      error.code = body.error || `http_${response.status}`
      error.body = body
      throw error
    }
    return body
  }

  return {
    async getJob(jobId, { signal } = {}) {
      const id = normalizeJobId(jobId)
      if (!isUsableJobId(id)) {
        const error = new Error(VNEXT_GENERATION_COPY.invalidJobId)
        error.code = 'invalid_job_id'
        throw error
      }
      const job = await request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'GET', signal })
      if (!isCompletedProcessJobShape(job) || job.debug_report) return job
      try {
        const report = await request(job.debug_report_url, { method: 'GET', signal })
        return { ...job, debug_report: report }
      } catch {
        return { ...job, debug_report: null, debug_report_unavailable: true }
      }
    },
    async getGeminiState({ signal } = {}) {
      return request('/api/gemini-state', { method: 'GET', signal })
    },
    async reviewCharacter(input, { signal } = {}) {
      const state = await request('/api/gemini-state', { method: 'GET', signal })
      const preset = selectStrictGeminiPreset(state)
      if (!preset) {
        const error = new Error(VNEXT_GENERATION_COPY.geminiMissing)
        error.code = 'gemini_not_ready'
        throw error
      }
      return request('/api/generate-character/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildReviewRequest({ ...input, providerPresetId: preset.id })),
        signal,
      })
    },
    async startGenerate(review, { signal } = {}) {
      return request('/api/generate-character', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildLiveGenerateRequest(review)),
        signal,
      })
    },
    async getStaticImageState(projectId) {
      return request(`/api/editor/projects/${encodeURIComponent(projectId)}/image-generation`)
    },
    async getStaticImageJob(projectId, jobId) {
      return request(`/api/editor/projects/${encodeURIComponent(projectId)}/image-generation/${encodeURIComponent(jobId)}`)
    },
    async listStaticImages(projectId) {
      return request(`/api/editor/projects/${encodeURIComponent(projectId)}/image-generation/recent`)
    },
    async downloadStaticImage(projectId, jobId) {
      const response = await fetchFn(`/api/editor/projects/${encodeURIComponent(projectId)}/image-generation/${encodeURIComponent(jobId)}/source`)
      if (!response.ok) throw new Error('The generated image could not be read.')
      return new Uint8Array(await response.arrayBuffer())
    },
    async startStaticImage(projectId, body, { signal } = {}) {
      if (!body || !['description,operation_id', 'description,operation_id,provider', 'description,operation_id,provider,reference'].includes(Object.keys(body).sort().join(','))
        || (body.provider !== undefined && !['codex', 'grok', 'antigravity'].includes(body.provider))) {
        const error = new Error('Static image requests require a supported provider and a selected canvas reference, never a file path or sheet profile.')
        error.code = 'static_image_contract'
        throw error
      }
      return request(`/api/editor/projects/${encodeURIComponent(projectId)}/image-generation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    },
    blockGenerate() {
      const error = new Error('Provider generation is blocked in this batch.')
      error.code = 'provider_blocked'
      throw error
    },
    // A review-required sheet job rebuilt and verified from its stored artifacts (the same strict,
    // provider-free restore Studio uses), whether or not the local service still holds its record:
    //   { job, review, description } a valid job that can be finished (nothing is generated again);
    //     description is the user's sealed request text;
    //   { missing: true } no generated job with this ID exists;
    //   { unavailable: true, code } its files exist but it cannot be finished here.
    // A check that could not complete (no answer, a server error) throws instead, so it is never
    // mistaken for a missing job.
    async restoreGenerationJob(jobId, { signal } = {}) {
      const id = normalizeJobId(jobId)
      if (!isUsableJobId(id)) return { missing: true }
      let generation
      try {
        generation = await request(`/generated/${encodeURIComponent(id)}/generation.json`, { method: 'GET', signal })
      } catch (error) {
        if (error.status === 404) return { missing: true }
        throw error
      }
      const reviewId = generation?.generation_review?.reviewed_run_id
      if (typeof reviewId !== 'string' || !reviewId) return { unavailable: true, code: 'no_sealed_review' }
      try {
        const restored = await restoreStrictReviewRequiredGeneration({ jobId: id, reviewId }, { fetchImpl: fetchFn, signal })
        return { job: restored.job, review: restored.review, description: restored.sealedDescription || '' }
      } catch (error) {
        // Only a definite verdict on the files (a coded strict error) makes the job unfinishable;
        // an unanswered or unexplained check stays a lookup failure.
        if (isRecoverableStrictPendingRestoreError(error) || !error?.code) throw error
        return { unavailable: true, code: error.code }
      }
    },
    // A job that already has a publication (accepted here or in Studio) is replayed with the values
    // that publication recorded (replayStrictAcceptedPublication); the server checks them against it
    // and writes nothing. Otherwise the request carries the sealed review and the SHA-256 of the
    // job's verified artifact bytes (prepareStrictManualAcceptanceEvidence), and the accept route
    // re-checks them all against the stored files.
    async acceptJob(jobId, { signal } = {}) {
      const id = normalizeJobId(jobId)
      if (isUsableJobId(id)) {
        try {
          const replay = await replayStrictAcceptedPublication(`accepted_v1_${id}`, { fetchImpl: fetchFn, signal })
          return replay.response
        } catch (error) {
          if (!(error?.code === 'artifact_fetch_failed' && error.status === 404)) throw error
        }
      }
      const restored = await this.restoreGenerationJob(id, { signal })
      if (!restored.job) {
        const error = new Error(restored.missing ? VNEXT_GENERATION_COPY.jobNotFoundBody : VNEXT_GENERATION_COPY.jobUnavailableBody)
        error.code = restored.missing ? 'job_not_found' : 'job_not_acceptable'
        throw error
      }
      const { acceptanceBody } = await prepareStrictManualAcceptanceEvidence(
        { job: restored.job, review: restored.review, humanReviewedIssueCount: 0 },
        { fetchImpl: fetchFn, signal },
      )
      return request(`/api/generate-character/${encodeURIComponent(id)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(vnextAcceptRequest(acceptanceBody)),
        signal,
      })
    },
    async processSheet({ name, sourceBase64, signal } = {}) {
      return request('/api/process-sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildProcessSheetPayload({ name, sourceBase64 })),
        signal,
      })
    },
    async downloadUrl(url, { signal } = {}) {
      const response = await fetchFn(url, { method: 'GET', signal })
      if (!response.ok) {
        const error = new Error('download_failed')
        error.code = 'download_failed'
        error.status = response.status
        throw error
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
