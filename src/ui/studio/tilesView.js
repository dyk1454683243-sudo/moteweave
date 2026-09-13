import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import {
  appendTwoPointFiveDOperation,
  buildTwoPointFiveDCornerGrid,
  clearTwoPointFiveDEditorOperations,
  createTwoPointFiveDBinding,
  normalizeTwoPointFiveDOptions,
  twoPointFiveDBindingIsCurrent,
  twoPointFiveDMaskFromGrid,
  twoPointFiveDOptionsKey,
} from '../twoPointFiveD/core.js'
import { buildTwoPointFiveDMaterialSourceBenchmarkReview } from '../../two-point-five-d/materialSourceBenchmarkReviewCore.js'
import { studioT, translateStudioDocument } from './settingsView.js'
import {
  TILES_BENCHMARK_MAX_CALLS,
  TILES_MATERIAL_SOURCE_MAX_BYTES,
  assertLocalTilesJob,
  assertTilesBenchmarkReport,
  buildTilesBenchmarkRequest,
  fetchTilesGeminiPreset,
  fetchTilesJsonArtifact,
  pollTilesJob,
  postLocalTilesBuild,
  postTilesBenchmarkPlan,
  postTilesBenchmarkRun,
  tilesBenchmarkSubmissionIsDefiniteRejection,
} from './tilesApi.js'

const TILE_PHASES = new Set([
  'empty',
  'ready',
  'building',
  'complete',
  'failed',
  'stale',
  'ai_setup',
  'ai_plan_ready',
  'ai_running',
  'ai_review',
  'ai_failed',
])
const LOCAL_PHASES = new Set(['empty', 'ready', 'building', 'complete', 'failed', 'stale'])
const AI_PHASES = new Set(['ai_setup', 'ai_plan_ready', 'ai_running', 'ai_review', 'ai_failed'])
const TERMINAL_FAILURES = new Set(['failed_post_processing', 'failed_model_error', 'failed_safety_filter', 'not_found'])
const CANVAS_WIDTH = 520
const CANVAS_HEIGHT = 402
const MAX_CELL_STEP = 54
const DEFAULT_PAD_X = 40
const DEFAULT_PAD_Y = 42

const OPTION_IDS = Object.freeze({
  mapWidth: 'studio-tiles-width',
  mapHeight: 'studio-tiles-height',
  mapDensity: 'studio-tiles-density',
  mapSeed: 'studio-tiles-seed',
  mapSolver: 'studio-tiles-solver',
  mapBorder: 'studio-tiles-border',
})

const LOCAL_OUTPUTS = Object.freeze({
  'studio-tiles-output-atlas': Object.freeze({ field: 'strict_atlas_png_url', file: 'strict_atlas.png' }),
  'studio-tiles-output-map': Object.freeze({ field: 'map_editor_preview_png_url', file: 'map_editor_preview.png' }),
  'studio-tiles-output-tiled': Object.freeze({
    field: 'tiled_json_url',
    file: 'tileset.tiled.json',
    secondaryField: 'tiled_tsx_url',
    secondaryFile: 'tileset.tsx',
  }),
  'studio-tiles-output-pack': Object.freeze({ field: 'release_demo_pack_zip_url', file: 'release_demo_pack.zip' }),
})

let initialized = false
let tilesState = null

function byId(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = String(value ?? '')
}

function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden)
}

function setLink(id, url, enabled, downloadName = null) {
  const link = byId(id)
  if (!link) return
  if (enabled && url) {
    link.href = url
    link.target = '_blank'
    link.rel = 'noreferrer'
    if (downloadName) link.download = downloadName
    else link.removeAttribute('download')
    link.removeAttribute('aria-disabled')
    link.tabIndex = 0
  } else {
    link.removeAttribute('href')
    link.removeAttribute('target')
    link.removeAttribute('rel')
    link.removeAttribute('download')
    link.setAttribute('aria-disabled', 'true')
    link.tabIndex = -1
  }
}

function exactPhase(phase) {
  return TILE_PHASES.has(phase) ? phase : 'empty'
}

function phaseForMode(state, mode = state.mode) {
  return mode === 'ai' ? state.aiPhase : state.localPhase
}

export function createInitialTilesState({ serviceAvailable = true } = {}) {
  const options = normalizeTwoPointFiveDOptions()
  return {
    serviceAvailable: Boolean(serviceAvailable),
    mode: 'local',
    phase: 'empty',
    localPhase: 'empty',
    aiPhase: 'ai_setup',
    busy: null,
    controller: null,
    options,
    optionsKey: twoPointFiveDOptionsKey(options),
    activeTool: 'paint',
    dragStart: null,
    sourceFile: null,
    sourceEpoch: 0,
    binding: null,
    job: null,
    resultJob: null,
    localError: null,
    localPollInterrupted: false,
    resultImageFailed: false,
    ai: {
      preset: null,
      plan: null,
      request: null,
      job: null,
      report: null,
      review: null,
      consumed: false,
      lockedUnknownSubmission: false,
      pollInterrupted: false,
      error: null,
    },
  }
}

export function deriveTilesPresentation(state = createInitialTilesState()) {
  const phase = exactPhase(state.phase)
  const isAi = state.mode === 'ai'
  let action = 'blocked'
  if (!isAi) {
    if (phase === 'empty') action = 'edit'
    else if (phase === 'ready' || phase === 'complete' || phase === 'failed' || phase === 'stale') action = 'build'
    else if (phase === 'building' && state.localPollInterrupted && state.job) action = 'resume_local'
  } else if (phase === 'ai_setup') {
    action = 'plan'
  } else if (phase === 'ai_plan_ready') {
    action = 'run'
  } else if (phase === 'ai_running' && state.ai.pollInterrupted && state.ai.job) {
    action = 'resume_ai'
  } else if (phase === 'ai_review') {
    action = 'return_local'
  } else if (phase === 'ai_failed') {
    action = 'replan_ai'
  }
  return Object.freeze({ phase, isAi, action, busy: state.busy !== null })
}

function currentSnapshot(state) {
  return { sourceEpoch: state.sourceEpoch, optionsKey: state.optionsKey }
}

export function localTilesResultIsCurrent(state = tilesState) {
  let releaseReady = false
  try {
    releaseReady = Boolean(state?.resultJob && assertLocalTilesJob(state.resultJob, { terminal: true }))
  } catch {
    releaseReady = false
  }
  return Boolean(
    releaseReady &&
    state?.resultJob &&
    state?.binding?.jobId === state.resultJob.id &&
    twoPointFiveDBindingIsCurrent(state.binding, currentSnapshot(state)) &&
    !state.resultImageFailed
  )
}

function setLocalPhase(state, phase) {
  if (!LOCAL_PHASES.has(phase)) return
  state.localPhase = phase
  if (state.mode === 'local') state.phase = phase
}

function setAiPhase(state, phase) {
  if (!AI_PHASES.has(phase)) return
  state.aiPhase = phase
  if (state.mode === 'ai') state.phase = phase
}

function abortCurrent(state) {
  state.controller?.abort()
  state.controller = null
}

function errorText(error) {
  return String(error?.message || error || studioT('tiles.error.unknown'))
}

function localizedJobStatus(status) {
  const raw = String(status ?? '—')
  const key = `tiles.jobStatus.${raw}`
  const translated = studioT(key)
  return translated === key ? raw : `${raw} · ${translated}`
}

function providerBudget(job) {
  const budget = job?.provider_call_budget
  const integerOrNull = (value) => Number.isInteger(Number(value)) ? Number(value) : null
  return {
    planned: integerOrNull(budget?.planned_provider_calls),
    used: integerOrNull(budget?.used_provider_calls),
    max: integerOrNull(budget?.max_provider_calls),
  }
}

function budgetValue(value) {
  return Number.isInteger(value) ? String(value) : '—'
}

function localFailureStatus(state) {
  if (state.localError?.code && state.job?.status === 'done') return state.localError.code
  if (state.resultImageFailed) return 'artifact_unavailable'
  if (TERMINAL_FAILURES.has(state.job?.status)) return state.job.status
  return state.localError?.code ?? state.job?.status ?? 'local_error'
}

function aiFailureStatus(state) {
  if (TERMINAL_FAILURES.has(state.ai.job?.status)) return state.ai.job.status
  if (state.ai.error?.code) return state.ai.error.code
  return state.ai.job?.status ?? 'failed_model_error'
}

function renderTopStatus(state) {
  const status = byId('studio-tiles-status')
  const metrics = byId('studio-tiles-stage-metrics')
  const runtime = byId('studio-tiles-runtime-status')
  if (!status || !metrics || !runtime) return
  const phase = state.phase
  let top = studioT(`tiles.status.${phase.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())}`)
  let metricsText = optionSummary(state)
  let runtimeText = studioT('tiles.runtime.localPreview')
  if (state.mode === 'local') {
    if (phase === 'empty') {
      metricsText = studioT('tiles.stageMetrics.localEmpty', { width: state.options.mapWidth, height: state.options.mapHeight })
    } else if (phase === 'ready') {
      metricsText = studioT('tiles.stageMetrics.localReady', {
        width: state.options.mapWidth,
        height: state.options.mapHeight,
        count: state.options.editorOperations.length,
      })
    } else if (phase === 'building') {
      const jobStatus = state.job?.status ?? 'queued'
      top = `${jobStatus} · 0 Provider`
      metricsText = studioT('tiles.stageMetrics.localBuilding', { status: jobStatus, job: state.job?.id ?? '—' })
      runtimeText = studioT('tiles.runtime.localBuilding')
    } else if (phase === 'complete') {
      top = 'done · 0 Provider'
      metricsText = studioT('tiles.stageMetrics.localComplete')
      runtimeText = studioT('tiles.runtime.localComplete')
    } else if (phase === 'failed') {
      const failure = localFailureStatus(state)
      top = `${failure} · 0 Provider`
      metricsText = studioT('tiles.stageMetrics.localFailed', { status: failure, job: state.job?.id ?? state.resultJob?.id ?? '—' })
      runtimeText = studioT('tiles.runtime.localFailed')
    } else if (phase === 'stale') {
      metricsText = studioT('tiles.stageMetrics.localStale')
      runtimeText = studioT('tiles.runtime.localStale')
    }
  } else {
    const budget = providerBudget(state.ai.job)
    const max = state.ai.request?.maxProviderCalls ?? budget.max ?? TILES_BENCHMARK_MAX_CALLS
    const used = budgetValue(budget.used)
    if (phase === 'ai_setup') {
      metricsText = studioT('tiles.stageMetrics.aiSetup')
      runtimeText = studioT('tiles.runtime.aiSetup')
    } else if (phase === 'ai_plan_ready') {
      top = `plan_ready · 0/${max} calls`
      metricsText = studioT('tiles.stageMetrics.aiPlanReady', { count: state.ai.request?.candidateCount ?? max })
      runtimeText = studioT('tiles.runtime.aiPlanReady', { max })
    } else if (phase === 'ai_running' && state.ai.lockedUnknownSubmission && !state.ai.job) {
      top = studioT('tiles.runtime.submissionUnknown')
      metricsText = studioT('tiles.runtime.submissionUnknown')
      runtimeText = studioT('tiles.runtime.submissionUnknown')
    } else if (phase === 'ai_running') {
      const jobStatus = state.ai.job?.status ?? 'generating'
      top = `${jobStatus} · ${used}/${budgetValue(budget.max ?? max)} calls`
      metricsText = studioT('tiles.stageMetrics.aiRunning', { status: jobStatus, job: state.ai.job?.id ?? '—' })
      runtimeText = studioT('tiles.runtime.aiRunning', { used, max: budgetValue(budget.max ?? max) })
    } else if (phase === 'ai_review') {
      top = `done · ${used}/${budgetValue(budget.max ?? max)} calls`
      metricsText = studioT('tiles.stageMetrics.aiReview', { used, max: budgetValue(budget.max ?? max) })
      runtimeText = studioT('tiles.runtime.aiReview')
    } else if (phase === 'ai_failed') {
      const failure = aiFailureStatus(state)
      top = failure
      metricsText = studioT('tiles.stageMetrics.aiFailed', { status: failure })
      runtimeText = studioT('tiles.runtime.aiFailed')
    }
  }
  status.textContent = top
  status.dataset.state = phase
  status.setAttribute('aria-busy', String(state.busy !== null))
  metrics.textContent = metricsText
  runtime.textContent = runtimeText
  runtime.setAttribute('aria-busy', String(state.busy !== null))
}

function renderLanguageButtons() {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  document.querySelectorAll('[data-tiles-language]').forEach((button) => {
    const current = button.dataset.tilesLanguage === language
    button.classList.toggle('is-current', current)
    button.setAttribute('aria-pressed', String(current))
  })
}

function sourceLabel(state) {
  return state.sourceFile?.name || studioT('tiles.sourceChoose')
}

function optionSummary(state) {
  const { mapWidth, mapHeight, editorOperations } = state.options
  const source = state.sourceFile ? state.sourceFile.name : studioT('tiles.source.procedural')
  return `${mapWidth}×${mapHeight} · ${studioT('tiles.editsCount', { count: editorOperations.length })} · ${source}`
}

function renderLocalBinding(state) {
  const summary = optionSummary(state)
  const failureStatus = localFailureStatus(state)
  const failureJobId = state.job?.id ?? state.resultJob?.id ?? '—'
  setText('studio-tiles-binding-empty', `${summary}\n${studioT('tiles.binding.zeroRequests')}`)
  setText('studio-tiles-binding-ready', `${summary}\n${studioT('tiles.binding.notSubmitted')}`)
  setText('studio-tiles-binding-building', `${studioT('tiles.jobLabel')}: ${state.job?.id ?? '—'}\n${summary} · 0 Provider`)
  setText('studio-tiles-binding-complete', `Validation · ${state.resultJob?.validation_status ?? '—'}\nLDtk · ${state.resultJob?.ldtk_workflow_validation_status ?? state.resultJob?.ldtk_project_status ?? '—'} · Import · ${state.resultJob?.import_validation_status ?? '—'} · Round-trip · ${state.resultJob?.external_roundtrip_validation_status ?? '—'}`)
  setText('studio-tiles-binding-failed', `${studioT('tiles.jobLabel')}: ${state.job?.id ?? '—'}\n${studioT('tiles.binding.failedDetail')}`)
  setText('studio-tiles-binding-stale', `${studioT('tiles.binding.oldKey')}: ${state.binding?.optionsKey?.slice(0, 30) ?? '—'}\n${studioT('tiles.binding.newKey')}: ${state.optionsKey.slice(0, 30)}`)
  setText('studio-tiles-source-name', sourceLabel(state))
  setText('studio-tiles-map-meta', `${state.options.mapWidth}×${state.options.mapHeight} · corner_mask_16 · ${studioT('tiles.editsCount', { count: state.options.editorOperations.length })}`)
  setText('studio-tiles-job-pill-building', String(state.job?.status ?? 'post_processing').toUpperCase())
  setText('studio-tiles-job-pill-complete', 'DONE · PASS')
  setText('studio-tiles-job-building', `${studioT('tiles.jobLabel')}: ${state.job?.id ?? '—'}\n${studioT('tiles.stateLabel')}: ${localizedJobStatus(state.job?.status)}\nProvider: 0`)
  setText('studio-tiles-job-complete', `Validation: ${state.resultJob?.validation_status ?? '—'}\nLDtk: ${state.resultJob?.ldtk_workflow_validation_status ?? state.resultJob?.ldtk_project_status ?? '—'}\nImport: ${state.resultJob?.import_validation_status ?? '—'}\nRound-trip: ${state.resultJob?.external_roundtrip_validation_status ?? '—'}`)
  setText('studio-tiles-job-stale', `${studioT('tiles.binding.oldKey')}: ${state.binding?.optionsKey?.slice(0, 34) ?? '—'}\n${studioT('tiles.binding.newKey')}: ${state.optionsKey.slice(0, 34)}`)
  setText('studio-tiles-failed-status', failureStatus.toUpperCase())
  setText('studio-tiles-failed-reason', `${studioT('tiles.error.originalReason')}: ${errorText(state.localError ?? state.job?.reason)}\n${studioT('tiles.jobLabel')}: ${failureJobId} · Provider: 0`)
}

function renderOutputState(state) {
  const enabled = state.mode === 'local' && state.phase === 'complete' && localTilesResultIsCurrent(state)
  const localStatusKey = enabled
    ? 'tiles.output.downloadable'
    : state.phase === 'building'
      ? 'tiles.output.generating'
      : ['failed', 'stale'].includes(state.phase)
        ? 'tiles.output.locked'
        : 'tiles.output.waiting'
  for (const [id, output] of Object.entries(LOCAL_OUTPUTS)) {
    setLink(id, state.resultJob?.[output.field], enabled, output.file)
    const link = byId(id)
    if (enabled && output.secondaryField && state.resultJob?.[output.secondaryField]) {
      link.dataset.secondaryUrl = state.resultJob[output.secondaryField]
      link.dataset.secondaryFile = output.secondaryFile
    } else if (link) {
      delete link.dataset.secondaryUrl
      delete link.dataset.secondaryFile
    }
    const status = link?.querySelector('[data-tiles-output-state]')
    if (status) status.textContent = studioT(localStatusKey)
  }
  const planEnabled = state.mode === 'ai' && Boolean(state.ai.plan?.plan_url)
  const reportEnabled = state.mode === 'ai' && state.phase === 'ai_review' && Boolean(state.ai.job?.material_source_benchmark_url)
  setLink('studio-tiles-output-plan', state.ai.plan?.plan_url ?? state.ai.job?.material_source_benchmark_plan_url, planEnabled, 'material_source_benchmark_plan.json')
  setLink('studio-tiles-output-report', state.ai.job?.material_source_benchmark_url, reportEnabled, 'material_source_benchmark.json')
  setLink('studio-tiles-output-notes', state.ai.job?.material_source_benchmark_md_url, reportEnabled, 'material_source_benchmark.md')
  for (const id of ['studio-tiles-output-plan', 'studio-tiles-output-report', 'studio-tiles-output-notes']) {
    const link = byId(id)
    const status = link?.querySelector('[data-tiles-output-state]')
    const key = link.hasAttribute('href')
      ? 'tiles.output.viewable'
      : state.phase === 'ai_running'
        ? 'tiles.output.generating'
        : state.phase === 'ai_failed' && id !== 'studio-tiles-output-plan'
          ? 'tiles.output.notGenerated'
        : 'tiles.output.waiting'
    if (status) status.textContent = studioT(key)
  }
}

function renderResultImage(state) {
  const canvas = byId('studio-tiles-editor-canvas')
  const image = byId('studio-tiles-result-preview')
  const useResult = ['complete', 'stale'].includes(state.phase) && Boolean(state.resultJob?.map_editor_preview_png_url) && !state.resultImageFailed
  setHidden(canvas, useResult)
  setHidden(image, !useResult)
  if (useResult) {
    const url = state.resultJob.map_editor_preview_png_url
    if (image.getAttribute('src') !== url) image.src = url
  } else {
    image?.removeAttribute('src')
  }
}

function setInputsDisabled(state) {
  const localLocked = state.mode !== 'local' || state.busy !== null || state.phase === 'building'
  for (const id of Object.values(OPTION_IDS)) {
    const input = byId(id)
    if (input) input.disabled = localLocked
  }
  const source = byId('studio-tiles-source-file')
  if (source) source.disabled = localLocked
  document.querySelectorAll('[data-tiles-tool], #studio-tiles-clear-edits').forEach((button) => {
    button.disabled = localLocked || state.phase !== 'ready'
  })
  const aiLocked = state.mode !== 'ai' || state.busy !== null || state.phase !== 'ai_setup' || !state.serviceAvailable
  for (const id of ['studio-tiles-ai-description', 'studio-tiles-ai-candidates', 'studio-tiles-ai-max-calls']) {
    const input = byId(id)
    if (input) input.disabled = aiLocked
  }
  const confirm = byId('studio-tiles-ai-confirm')
  if (confirm) confirm.disabled = state.mode !== 'ai' || state.phase !== 'ai_plan_ready' || state.busy !== null || state.ai.consumed
}

function renderPrimary(state) {
  const button = byId('studio-tiles-primary')
  if (!button) return
  const presentation = deriveTilesPresentation(state)
  button.dataset.tilesAction = presentation.action
  let disabled = presentation.action === 'blocked' || presentation.busy
  if (presentation.action !== 'edit' && !state.serviceAvailable) disabled = true
  if (presentation.action === 'run') {
    disabled = disabled || !state.ai.plan || !state.ai.preset || !byId('studio-tiles-ai-confirm')?.checked || state.ai.consumed
  }
  button.disabled = disabled
  const activeCopy = button.querySelector(`[data-tiles-copy-phase~="${state.phase}"]`)
  if (activeCopy) {
    if (presentation.action === 'resume_local' || presentation.action === 'resume_ai') {
      activeCopy.textContent = studioT('tiles.primary.resumeSameJob')
    } else if (presentation.action === 'run') {
      activeCopy.textContent = studioT('tiles.primary.aiRunCount', { count: state.ai.request?.maxProviderCalls ?? TILES_BENCHMARK_MAX_CALLS })
    }
  }
}

function renderError(state) {
  const node = byId('studio-tiles-error')
  const error = state.mode === 'ai' ? state.ai.error : state.localError
  const visible = Boolean(error) && !['failed', 'ai_failed'].includes(state.phase)
  setHidden(node, !visible)
  if (visible) node.textContent = errorText(error)
}

function renderAi(state) {
  const description = byId('studio-tiles-ai-description')
  if (description) {
    if (state.ai.request?.description) description.value = state.ai.request.description
    else if (description.dataset.userEdited !== 'true') description.value = studioT('tiles.ai.descriptionDefault')
  }
  const candidates = Number(byId('studio-tiles-ai-candidates')?.value ?? state.ai.request?.candidateCount ?? 4)
  const max = Number(byId('studio-tiles-ai-max-calls')?.value ?? state.ai.request?.maxProviderCalls ?? 4)
  const budget = providerBudget(state.ai.job)
  const requestedMax = state.ai.request?.maxProviderCalls ?? max
  const used = budgetValue(budget.used ?? (state.ai.plan ? 0 : null))
  const failed = state.phase === 'ai_failed'
  setText('studio-tiles-ai-provider', state.ai.preset ? `Gemini · ${state.ai.preset.model}` : 'Gemini')
  setText('studio-tiles-ai-binding-state', failed
    ? studioT('tiles.ai.bindingFailed')
    : state.ai.plan ? studioT('tiles.ai.bindingPlanReady') : studioT('tiles.ai.bindingSetup'))
  setText('studio-tiles-ai-binding-detail', failed
    ? `reason: ${errorText(state.ai.job?.reason ?? state.ai.error)}\nretry_hint: ${state.ai.job?.retry_hint ?? '—'}\nused: ${used}/${budgetValue(budget.max ?? requestedMax)}`
    : `${studioT('tiles.ai.candidateSummary', { count: state.ai.request?.candidateCount ?? candidates })}\n${studioT('tiles.ai.callSummary', { used, max: requestedMax })}`)
  setText('studio-tiles-ai-provider-title', failed ? studioT('tiles.ai.providerFailedTitle') : studioT('tiles.ai.providerStateTitle'))
  setText('studio-tiles-ai-provider-detail', failed
    ? studioT('tiles.ai.providerFailedDetail')
    : state.ai.preset
      ? studioT('tiles.ai.providerReady', { model: state.ai.preset.model })
      : studioT('tiles.ai.zeroCallNotice'))
  setText('studio-tiles-ai-plan-candidates', state.ai.plan?.candidate_count ?? candidates)
  setText('studio-tiles-ai-plan-image', '1K · 1:1')
  setText('studio-tiles-ai-plan-provider', state.ai.preset ? `Gemini · ${state.ai.preset.model}` : studioT('tiles.ai.providerPending'))
  setText('studio-tiles-ai-plan-budget', `${used}/${requestedMax}`)
  setText('studio-tiles-ai-plan-next', state.phase === 'ai_plan_ready'
    ? studioT('tiles.ai.nextConfirm')
    : state.phase === 'ai_running'
      ? localizedJobStatus(state.ai.job?.status ?? 'generating')
      : studioT('tiles.ai.nextPlan'))
  setText('studio-tiles-ai-confirm-copy', failed
    ? studioT('tiles.ai.confirmReadOnly')
    : studioT('tiles.ai.confirmBudgetCount', { count: requestedMax }))

  const failure = aiFailureStatus(state)
  setText('studio-tiles-ai-failed-job', `${state.ai.job?.id ?? '—'} · reason: ${errorText(state.ai.job?.reason ?? state.ai.error)}`)
  setText('studio-tiles-ai-failed-status', `${failure} · retry_hint: ${state.ai.job?.retry_hint ?? '—'}`)
  setText('studio-tiles-ai-failed-budget', `planned / max / used · ${budgetValue(budget.planned)}/${budgetValue(budget.max)}/${budgetValue(budget.used)}`)

  const review = state.ai.review
  setText('studio-tiles-ai-usable', review ? `${Math.round(Number(review.summary.selected_usable_rate || 0) * 1000) / 10}%` : '—')
  setText('studio-tiles-ai-pass', review ? `${Math.round(Number(review.summary.selected_pass_rate || 0) * 1000) / 10}%` : '—')
  setText('studio-tiles-ai-errors', review?.summary.provider_error_count ?? '—')
  setText('studio-tiles-ai-release', review ? (review.release_ready ? studioT('tiles.ai.releaseReady') : studioT('tiles.ai.releaseLocked')) : '—')
  const selected = byId('studio-tiles-ai-selected-cases')
  if (selected) {
    selected.replaceChildren(...(review?.selected_cases ?? []).map((item) => {
      const li = document.createElement('li')
      const name = document.createElement('strong')
      const status = document.createElement('span')
      name.textContent = `${item.case_id} · ${item.selected_candidate_id ?? 'none'}`
      status.textContent = item.selected_status
      li.append(name, status)
      return li
    }))
  }
  setText('studio-tiles-ai-next-action', review?.decision?.next_action ?? '—')
  setText('studio-tiles-ai-review-summary', review?.decision?.rationale ?? '—')
  setText('studio-tiles-ai-top-issues', (review?.top_issues ?? []).map((issue) => `${issue.id} · ${issue.count}`).join('\n') || '—')
}

export function renderStudioTiles(state = tilesState) {
  if (!state) return
  const root = byId('studio-tiles-view')
  if (!root) return
  state.phase = exactPhase(phaseForMode(state))
  translateStudioDocument(root)
  root.dataset.tilesPhase = state.phase
  root.dataset.tilesMode = state.mode
  root.dataset.tilesBusy = state.busy ?? ''
  setHidden(root.querySelector('[data-tiles-mode-panel="local"]'), state.mode !== 'local')
  setHidden(root.querySelector('[data-tiles-mode-panel="ai"]'), state.mode !== 'ai')
  document.querySelectorAll('[data-tiles-mode-control]').forEach((button) => {
    const current = button.dataset.tilesModeControl === state.mode
    button.classList.toggle('is-active', current)
    button.setAttribute('aria-pressed', String(current))
    button.disabled = state.busy !== null
  })
  renderLanguageButtons()
  renderTopStatus(state)
  renderLocalBinding(state)
  renderAi(state)
  renderOutputState(state)
  renderResultImage(state)
  renderError(state)
  setInputsDisabled(state)
  renderPrimary(state)
  renderTilesCanvas(state)
}

function drawTopQuadrant(ctx, x, y, size, corner, solid) {
  const center = [x + size / 2, y + size / 2]
  const points = {
    nw: [[x, y], [x + size / 2, y], center, [x, y + size / 2]],
    ne: [[x + size / 2, y], [x + size, y], [x + size, y + size / 2], center],
    se: [center, [x + size, y + size / 2], [x + size, y + size], [x + size / 2, y + size]],
    sw: [[x, y + size / 2], center, [x + size / 2, y + size], [x, y + size]],
  }
  ctx.fillStyle = solid ? '#5fae5a' : '#263f4b'
  ctx.beginPath()
  ctx.moveTo(points[corner][0][0], points[corner][0][1])
  for (const point of points[corner].slice(1)) ctx.lineTo(point[0], point[1])
  ctx.closePath()
  ctx.fill()
}

function previewGeometry({ mapWidth: width, mapHeight: height }) {
  const step = Math.min(
    MAX_CELL_STEP,
    (CANVAS_WIDTH - DEFAULT_PAD_X * 2) / width,
    (CANVAS_HEIGHT - (DEFAULT_PAD_Y + 36)) / height,
  )
  return {
    step,
    visual: Math.max(1, step - 6),
    padX: Math.min(DEFAULT_PAD_X, Math.max(4, (CANVAS_WIDTH - width * step) / 2)),
    padY: Math.min(DEFAULT_PAD_Y, Math.max(4, (CANVAS_HEIGHT - height * step) / 2)),
  }
}

function drawPreviewTile(ctx, mask, x, y, visual) {
  const scale = visual / 48
  const scaled = (value, minimum = 1) => Math.max(minimum, Math.round(value * scale))
  const topSize = scaled(36)
  const topX = x + scaled(6, 0)
  const topY = y + scaled(5, 0)
  ctx.fillStyle = '#101820'
  ctx.fillRect(x + scaled(4, 0), y + scaled(34, 0), scaled(40), scaled(8))
  if (mask) {
    ctx.fillStyle = '#6e4b32'
    ctx.fillRect(topX, topY + scaled(26, 0), topSize, scaled(12))
    ctx.fillStyle = '#563927'
    ctx.fillRect(topX, topY + scaled(36, 0), topSize, scaled(4))
  }
  ctx.fillStyle = '#17202a'
  ctx.fillRect(topX, topY, topSize, topSize)
  drawTopQuadrant(ctx, topX, topY, topSize, 'nw', Boolean(mask & 1))
  drawTopQuadrant(ctx, topX, topY, topSize, 'ne', Boolean(mask & 2))
  drawTopQuadrant(ctx, topX, topY, topSize, 'se', Boolean(mask & 4))
  drawTopQuadrant(ctx, topX, topY, topSize, 'sw', Boolean(mask & 8))
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, visual - 1), Math.max(0, visual - 1))
}

function renderTilesCanvas(state) {
  const canvas = byId('studio-tiles-editor-canvas')
  if (!canvas || canvas.hidden) return
  const { grid, width, height } = buildTwoPointFiveDCornerGrid(state.options)
  const geometry = previewGeometry(state.options)
  canvas.setAttribute('aria-label', studioT('tiles.editor.canvasDynamicLabel', { width, height }))
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#050608'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      drawPreviewTile(
        ctx,
        twoPointFiveDMaskFromGrid(grid, x, y),
        geometry.padX + x * geometry.step,
        geometry.padY + y * geometry.step,
        geometry.visual,
      )
    }
  }
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      ctx.fillStyle = grid[y][x] ? '#14b8a6' : '#334155'
      const dot = Math.max(2, Math.min(6, geometry.step / 2))
      ctx.fillRect(
        geometry.padX + x * geometry.step - dot / 2,
        geometry.padY + y * geometry.step - dot / 2,
        dot,
        dot,
      )
    }
  }
}

function canvasPoint(event, state) {
  const canvas = byId('studio-tiles-editor-canvas')
  const rect = canvas.getBoundingClientRect()
  const geometry = previewGeometry(state.options)
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width) - geometry.padX,
    y: (event.clientY - rect.top) * (canvas.height / rect.height) - geometry.padY,
    step: geometry.step,
    width: state.options.mapWidth,
    height: state.options.mapHeight,
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function cellFromEvent(event, state) {
  const point = canvasPoint(event, state)
  return {
    x: clamp(Math.floor(point.x / point.step), 0, point.width - 1),
    y: clamp(Math.floor(point.y / point.step), 0, point.height - 1),
  }
}

function cornerFromEvent(event, state) {
  const point = canvasPoint(event, state)
  return {
    x: clamp(Math.round(point.x / point.step), 0, point.width),
    y: clamp(Math.round(point.y / point.step), 0, point.height),
  }
}

function invalidateLocalResult(state) {
  if (state.resultJob) setLocalPhase(state, 'stale')
  else if (state.localPhase !== 'empty') setLocalPhase(state, 'ready')
  state.localError = null
  state.localPollInterrupted = false
  state.resultImageFailed = false
}

function invalidateAiPlan(state) {
  if (!state.ai.plan && !state.ai.request && !state.ai.job && !state.ai.report && !state.ai.review) return
  state.ai.plan = null
  state.ai.request = null
  state.ai.job = null
  state.ai.report = null
  state.ai.review = null
  state.ai.consumed = false
  state.ai.lockedUnknownSubmission = false
  state.ai.pollInterrupted = false
  state.ai.error = null
  setAiPhase(state, 'ai_setup')
}

function aiAuthorityMustBePreserved(state) {
  return Boolean(
    state.ai.lockedUnknownSubmission ||
    (state.aiPhase === 'ai_running' && (state.ai.consumed || state.ai.job)) ||
    state.aiPhase === 'ai_failed'
  )
}

function commitOptions(state, options) {
  state.options = normalizeTwoPointFiveDOptions(options)
  state.optionsKey = twoPointFiveDOptionsKey(state.options)
  invalidateLocalResult(state)
  if (!aiAuthorityMustBePreserved(state)) invalidateAiPlan(state)
  renderStudioTiles(state)
}

function readOptions() {
  return normalizeTwoPointFiveDOptions({
    mapWidth: byId(OPTION_IDS.mapWidth)?.value,
    mapHeight: byId(OPTION_IDS.mapHeight)?.value,
    mapDensity: byId(OPTION_IDS.mapDensity)?.value,
    mapSeed: byId(OPTION_IDS.mapSeed)?.value,
    mapSolver: byId(OPTION_IDS.mapSolver)?.value,
    mapBorder: byId(OPTION_IDS.mapBorder)?.value,
    editorOperations: tilesState?.options.editorOperations ?? [],
  })
}

function writeOptions(options) {
  for (const [key, id] of Object.entries(OPTION_IDS)) {
    const input = byId(id)
    if (input) input.value = String(options[key])
  }
}

function applyEditorOperation(state, operation) {
  commitOptions(state, appendTwoPointFiveDOperation(state.options, operation))
}

async function ensureGeminiPreset(state) {
  if (state.ai.preset || !state.serviceAvailable) return state.ai.preset
  state.busy = 'provider'
  state.ai.error = null
  renderStudioTiles(state)
  try {
    state.ai.preset = await fetchTilesGeminiPreset()
    return state.ai.preset
  } catch (error) {
    state.ai.error = error
    return null
  } finally {
    state.busy = null
    renderStudioTiles(state)
  }
}

function readBenchmarkRequest(state) {
  return buildTilesBenchmarkRequest({
    description: byId('studio-tiles-ai-description')?.value,
    candidateCount: byId('studio-tiles-ai-candidates')?.value,
    maxProviderCalls: byId('studio-tiles-ai-max-calls')?.value,
    providerPresetId: state.ai.preset?.id,
    options: state.options,
  })
}

async function createBenchmarkPlan() {
  const state = tilesState
  if (!state?.serviceAvailable || state.busy) return
  const preset = await ensureGeminiPreset(state)
  if (!preset || state.busy) return
  let request
  try {
    request = readBenchmarkRequest(state)
  } catch (error) {
    state.ai.error = error
    renderStudioTiles(state)
    byId('studio-tiles-ai-description')?.focus()
    return
  }
  abortCurrent(state)
  state.controller = new AbortController()
  state.busy = 'ai_plan'
  state.ai.error = null
  state.ai.plan = null
  state.ai.request = request
  state.ai.consumed = false
  state.ai.lockedUnknownSubmission = false
  byId('studio-tiles-ai-confirm').checked = false
  renderStudioTiles(state)
  try {
    state.ai.plan = await postTilesBenchmarkPlan(request, { signal: state.controller.signal })
    setAiPhase(state, 'ai_plan_ready')
  } catch (error) {
    if (error?.name !== 'AbortError') state.ai.error = error
  } finally {
    state.controller = null
    state.busy = null
    renderStudioTiles(state)
  }
}

async function observeBenchmarkJob(state, job) {
  state.ai.pollInterrupted = false
  state.ai.job = job
  setAiPhase(state, 'ai_running')
  renderStudioTiles(state)
  try {
    const terminal = await pollTilesJob(job, {
      kind: 'benchmark',
      maxProviderCalls: state.ai.request.maxProviderCalls,
      expectedBenchmark: {
        expectedRunId: state.ai.plan.sealed_plan.run_id,
        providerPresetId: state.ai.request.providerPresetId,
        expectedProviderConfig: state.ai.plan.sealed_provider_config,
        candidateCount: state.ai.request.candidateCount,
      },
      signal: state.controller.signal,
      onUpdate(update) {
        state.ai.job = update
        renderStudioTiles(state)
      },
    })
    state.ai.job = terminal
    if (terminal.status !== 'done') {
      state.ai.error = new Error(terminal.reason || terminal.status)
      state.ai.error.code = terminal.status
      state.ai.pollInterrupted = false
      setAiPhase(state, 'ai_failed')
      return
    }
    const report = assertTilesBenchmarkReport(await fetchTilesJsonArtifact(terminal.material_source_benchmark_url, {
      signal: state.controller.signal,
    }), {
      job: terminal,
      request: state.ai.request,
      runId: state.ai.plan.sealed_plan.run_id,
      sealedProviderConfig: state.ai.plan.sealed_provider_config,
    })
    state.ai.report = report
    state.ai.review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
    setAiPhase(state, 'ai_review')
  } catch (error) {
    if (error?.name === 'AbortError') return
    state.ai.error = error
    if (error?.code === 'poll_interrupted' && state.ai.job) {
      state.ai.pollInterrupted = true
      setAiPhase(state, 'ai_running')
    } else if (state.ai.job) {
      state.ai.pollInterrupted = false
      setAiPhase(state, 'ai_failed')
    } else {
      state.ai.plan = null
      state.ai.request = null
      state.ai.consumed = false
      setAiPhase(state, 'ai_setup')
    }
  }
}

function replanBenchmark() {
  const state = tilesState
  if (!state || state.busy || state.aiPhase !== 'ai_failed') return
  abortCurrent(state)
  invalidateAiPlan(state)
  const confirm = byId('studio-tiles-ai-confirm')
  if (confirm) confirm.checked = false
  renderStudioTiles(state)
}

async function runBenchmark() {
  const state = tilesState
  if (!state?.serviceAvailable || state.busy || !state.ai.plan || state.ai.consumed || !byId('studio-tiles-ai-confirm')?.checked) return
  state.ai.consumed = true
  state.ai.error = null
  state.busy = 'ai_submit'
  abortCurrent(state)
  state.controller = new AbortController()
  setAiPhase(state, 'ai_running')
  renderStudioTiles(state)
  try {
    const job = await postTilesBenchmarkRun(state.ai.plan, { signal: state.controller.signal })
    state.busy = 'ai_observe'
    await observeBenchmarkJob(state, job)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      state.ai.error = error
      if (tilesBenchmarkSubmissionIsDefiniteRejection(error)) {
        state.ai.plan = null
        state.ai.request = null
        state.ai.consumed = false
        state.ai.lockedUnknownSubmission = false
        setAiPhase(state, 'ai_setup')
      } else {
        state.ai.lockedUnknownSubmission = true
        setAiPhase(state, 'ai_running')
      }
    }
  } finally {
    state.controller = null
    state.busy = null
    renderStudioTiles(state)
  }
}

async function resumeBenchmark() {
  const state = tilesState
  if (!state?.ai.job || state.busy) return
  state.busy = 'ai_observe'
  state.ai.error = null
  state.controller = new AbortController()
  renderStudioTiles(state)
  try {
    await observeBenchmarkJob(state, state.ai.job)
  } finally {
    state.controller = null
    state.busy = null
    renderStudioTiles(state)
  }
}

async function observeLocalJob(state, job) {
  state.job = job
  state.localPollInterrupted = false
  setLocalPhase(state, 'building')
  renderStudioTiles(state)
  try {
    const terminal = await pollTilesJob(job, {
      kind: 'local',
      signal: state.controller.signal,
      onUpdate(update) {
        state.job = update
        renderStudioTiles(state)
      },
    })
    state.job = terminal
    if (terminal.status !== 'done') {
      state.localError = new Error(terminal.reason || terminal.status)
      setLocalPhase(state, 'failed')
      return
    }
    state.binding = createTwoPointFiveDBinding({
      sourceEpoch: state.binding.sourceEpoch,
      optionsKey: state.binding.optionsKey,
      jobId: terminal.id,
    })
    state.resultJob = terminal
    state.resultImageFailed = false
    setLocalPhase(state, twoPointFiveDBindingIsCurrent(state.binding, currentSnapshot(state)) ? 'complete' : 'stale')
  } catch (error) {
    if (error?.name === 'AbortError') return
    if (error?.payload?.job?.id === state.job?.id) state.job = error.payload.job
    state.localError = error
    if (error?.code === 'poll_interrupted' && state.job) {
      state.localPollInterrupted = true
      setLocalPhase(state, 'building')
    } else {
      setLocalPhase(state, 'failed')
    }
  }
}

async function buildLocalTiles() {
  const state = tilesState
  if (!state?.serviceAvailable || state.busy) return
  abortCurrent(state)
  state.controller = new AbortController()
  state.busy = 'local_submit'
  state.localError = null
  state.localPollInterrupted = false
  state.binding = createTwoPointFiveDBinding({ ...currentSnapshot(state), jobId: null })
  setLocalPhase(state, 'building')
  renderStudioTiles(state)
  try {
    const job = await postLocalTilesBuild({
      materialSourceFile: state.sourceFile,
      options: state.options,
      signal: state.controller.signal,
    })
    state.job = job
    state.busy = 'local_observe'
    await observeLocalJob(state, job)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      state.localError = error
      setLocalPhase(state, 'failed')
    }
  } finally {
    state.controller = null
    state.busy = null
    renderStudioTiles(state)
  }
}

async function resumeLocalJob() {
  const state = tilesState
  if (!state?.job || state.busy) return
  state.busy = 'local_observe'
  state.localError = null
  state.controller = new AbortController()
  renderStudioTiles(state)
  try {
    await observeLocalJob(state, state.job)
  } finally {
    state.controller = null
    state.busy = null
    renderStudioTiles(state)
  }
}

function switchMode(mode) {
  const state = tilesState
  if (!state || !['local', 'ai'].includes(mode) || state.busy) return
  state.mode = mode
  state.phase = phaseForMode(state, mode)
  renderStudioTiles(state)
  if (mode === 'ai') void ensureGeminiPreset(state)
}

function triggerTilesDownload(url, file) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function downloadTiledPair(event) {
  const link = event.currentTarget
  const primaryUrl = link.getAttribute('href')
  const secondaryUrl = link.dataset.secondaryUrl
  if (!primaryUrl || !secondaryUrl || link.getAttribute('aria-disabled') === 'true') return
  event.preventDefault()
  triggerTilesDownload(primaryUrl, 'tileset.tiled.json')
  triggerTilesDownload(secondaryUrl, link.dataset.secondaryFile || 'tileset.tsx')
}

function bindEvents() {
  document.querySelectorAll('[data-tiles-mode-control]').forEach((button) => {
    button.addEventListener('click', () => switchMode(button.dataset.tilesModeControl))
  })
  document.querySelectorAll('[data-tiles-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.tilesLanguage)
      const select = byId('language-select')
      if (select) {
        select.value = button.dataset.tilesLanguage
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        renderStudioTilesLanguage()
      }
    })
  })
  for (const id of Object.values(OPTION_IDS)) {
    byId(id)?.addEventListener('change', () => {
      const options = readOptions()
      writeOptions(options)
      commitOptions(tilesState, options)
    })
  }
  byId('studio-tiles-source-file')?.addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      tilesState.localError = new Error(studioT('tiles.error.sourceType'))
      renderStudioTiles(tilesState)
      return
    }
    if (file.size > TILES_MATERIAL_SOURCE_MAX_BYTES) {
      tilesState.localError = new Error(studioT('tiles.error.sourceSize'))
      renderStudioTiles(tilesState)
      return
    }
    tilesState.sourceFile = file
    tilesState.sourceEpoch += 1
    invalidateLocalResult(tilesState)
    renderStudioTiles(tilesState)
  })
  document.querySelectorAll('[data-tiles-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      tilesState.activeTool = button.dataset.tilesTool
      document.querySelectorAll('[data-tiles-tool]').forEach((tool) => {
        const current = tool.dataset.tilesTool === tilesState.activeTool
        tool.classList.toggle('is-active', current)
        tool.setAttribute('aria-pressed', String(current))
      })
    })
  })
  byId('studio-tiles-clear-edits')?.addEventListener('click', () => {
    commitOptions(tilesState, clearTwoPointFiveDEditorOperations(tilesState.options))
  })
  const canvas = byId('studio-tiles-editor-canvas')
  canvas?.addEventListener('pointerdown', (event) => {
    if (tilesState.busy || tilesState.localPhase === 'empty') return
    if (tilesState.activeTool === 'corner-solid' || tilesState.activeTool === 'corner-empty') {
      const corner = cornerFromEvent(event, tilesState)
      applyEditorOperation(tilesState, {
        type: 'set_corner',
        ...corner,
        solid: tilesState.activeTool === 'corner-solid',
      })
      return
    }
    tilesState.dragStart = cellFromEvent(event, tilesState)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  })
  canvas?.addEventListener('pointerup', (event) => {
    if (!tilesState.dragStart || tilesState.busy) return
    const end = cellFromEvent(event, tilesState)
    const start = tilesState.dragStart
    tilesState.dragStart = null
    applyEditorOperation(tilesState, {
      type: tilesState.activeTool === 'erase' ? 'erase_terrain_rect' : 'paint_terrain_rect',
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(start.x - end.x) + 1,
      h: Math.abs(start.y - end.y) + 1,
    })
  })
  canvas?.addEventListener('pointerleave', () => { if (tilesState) tilesState.dragStart = null })
  byId('studio-tiles-result-preview')?.addEventListener('error', () => {
    if (!tilesState || !['complete', 'stale'].includes(tilesState.localPhase)) return
    tilesState.resultImageFailed = true
    tilesState.localError = new Error(studioT('tiles.error.previewUnavailable'))
    setLocalPhase(tilesState, 'failed')
    renderStudioTiles(tilesState)
  })
  byId('studio-tiles-ai-confirm')?.addEventListener('change', () => renderStudioTiles(tilesState))
  byId('studio-tiles-ai-description')?.addEventListener('input', (event) => {
    event.currentTarget.dataset.userEdited = 'true'
  })
  byId('studio-tiles-ai-candidates')?.addEventListener('change', (event) => {
    const count = clamp(Math.trunc(Number(event.currentTarget.value) || 4), 1, 4)
    event.currentTarget.value = String(count)
    const max = byId('studio-tiles-ai-max-calls')
    if (max) max.value = String(count)
    renderStudioTiles(tilesState)
  })
  byId('studio-tiles-ai-max-calls')?.addEventListener('change', (event) => {
    const count = Number(byId('studio-tiles-ai-candidates')?.value ?? 4)
    event.currentTarget.value = String(count)
    renderStudioTiles(tilesState)
  })
  byId('studio-tiles-output-tiled')?.addEventListener('click', downloadTiledPair)
  byId('studio-tiles-primary')?.addEventListener('click', () => {
    const action = deriveTilesPresentation(tilesState).action
    if (action === 'edit') {
      setLocalPhase(tilesState, 'ready')
      renderStudioTiles(tilesState)
    } else if (action === 'build') void buildLocalTiles()
    else if (action === 'resume_local') void resumeLocalJob()
    else if (action === 'plan') void createBenchmarkPlan()
    else if (action === 'run') void runBenchmark()
    else if (action === 'resume_ai') void resumeBenchmark()
    else if (action === 'return_local') switchMode('local')
    else if (action === 'replan_ai') replanBenchmark()
  })
}

export function renderStudioTilesLanguage() {
  if (!tilesState) return
  renderStudioTiles(tilesState)
}

export function initStudioTiles({ serviceAvailable = true } = {}) {
  if (initialized) return tilesState
  const root = byId('studio-tiles-view')
  if (!root) return null
  initialized = true
  tilesState = createInitialTilesState({ serviceAvailable })
  writeOptions(tilesState.options)
  bindEvents()
  renderStudioTiles(tilesState)
  return tilesState
}
