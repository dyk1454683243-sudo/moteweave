import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import { canvasToBlob, downloadBlob, loadImage } from '../dom.js'
import {
  buildSequencePlan,
  createSequenceBinding,
  editSequenceFrames,
  makeSpriteZip,
  naturalSortSequenceFiles,
  normalizeSequenceOptions,
  sequenceBindingIsCurrent,
  sequenceOptionsKey,
} from '../sprite/core.js'
import { requestFrameGif } from '../sprite/api.js'
import { studioT, translateStudioDocument } from './settingsView.js'

const SEQUENCE_PHASES = new Set([
  'empty',
  'ready',
  'processing',
  'building',
  'complete',
  'partial',
  'stale',
  'error',
  'local_error',
])

const SEQUENCE_PRESENTATIONS = Object.freeze({
  empty: Object.freeze({
    titleKey: 'sequence.phase.emptyTitle',
    summaryKey: 'sequence.phase.emptySummary',
    statusKey: 'sequence.status.empty',
    crumbKey: 'sequence.crumb.empty',
    primaryKey: 'sequence.primary.choose',
    primaryAction: 'select',
  }),
  ready: Object.freeze({
    titleKey: 'sequence.phase.readyTitle',
    summaryKey: 'sequence.phase.readySummary',
    statusKey: 'sequence.status.ready',
    crumbKey: 'sequence.crumb.ready',
    primaryKey: 'sequence.primary.generate',
    primaryAction: 'generate',
  }),
  processing: Object.freeze({
    titleKey: 'sequence.phase.processingTitle',
    summaryKey: 'sequence.phase.processingSummary',
    statusKey: 'sequence.status.processing',
    crumbKey: 'sequence.crumb.processing',
    primaryKey: 'sequence.primary.processing',
    primaryAction: 'busy',
  }),
  building: Object.freeze({
    titleKey: 'sequence.phase.buildingTitle',
    summaryKey: 'sequence.phase.buildingSummary',
    statusKey: 'sequence.status.building',
    crumbKey: 'sequence.crumb.building',
    primaryKey: 'sequence.primary.building',
    primaryAction: 'busy',
  }),
  complete: Object.freeze({
    titleKey: 'sequence.phase.completeTitle',
    summaryKey: 'sequence.phase.completeSummary',
    statusKey: 'sequence.status.complete',
    crumbKey: 'sequence.crumb.complete',
    primaryKey: 'sequence.primary.regenerate',
    primaryAction: 'generate',
  }),
  partial: Object.freeze({
    titleKey: 'sequence.phase.partialTitle',
    summaryKey: 'sequence.phase.partialSummary',
    statusKey: 'sequence.status.partial',
    crumbKey: 'sequence.crumb.partial',
    primaryKey: 'sequence.primary.retryGif',
    primaryAction: 'retryGif',
  }),
  stale: Object.freeze({
    titleKey: 'sequence.phase.staleTitle',
    summaryKey: 'sequence.phase.staleSummary',
    statusKey: 'sequence.status.stale',
    crumbKey: 'sequence.crumb.stale',
    primaryKey: 'sequence.primary.regenerateCurrent',
    primaryAction: 'generate',
  }),
  error: Object.freeze({
    titleKey: 'sequence.phase.errorTitle',
    summaryKey: 'sequence.phase.errorSummary',
    statusKey: 'sequence.status.error',
    crumbKey: 'sequence.crumb.error',
    primaryKey: 'sequence.primary.reselect',
    primaryAction: 'select',
  }),
  local_error: Object.freeze({
    titleKey: 'sequence.phase.localErrorTitle',
    summaryKey: 'sequence.phase.localErrorSummary',
    statusKey: 'sequence.status.localError',
    crumbKey: 'sequence.crumb.localError',
    primaryKey: 'sequence.primary.retryLocal',
    primaryAction: 'retryLocal',
  }),
})

const OPTION_IDS = Object.freeze({
  targetW: 'studio-sequence-target-w',
  targetH: 'studio-sequence-target-h',
  padding: 'studio-sequence-padding',
  spacing: 'studio-sequence-spacing',
  columns: 'studio-sequence-columns',
  fps: 'studio-sequence-fps',
})

const DOWNLOAD_IDS = Object.freeze({
  png: 'studio-sequence-download-png',
  json: 'studio-sequence-download-json',
  gif: 'studio-sequence-download-gif',
  zip: 'studio-sequence-download-zip',
})

const PROCESSING_STEPS = new Set(['read', 'local_build', 'package'])

const MAX_SEQUENCE_CANVAS_EDGE = 16384
const MAX_SEQUENCE_CANVAS_PIXELS = 67_108_864

let initialized = false
let sequenceState = null

function byId(id) {
  return document.getElementById(id)
}

function exactPhase(value) {
  return SEQUENCE_PHASES.has(value) ? value : 'empty'
}

function exactProcessingStep(value) {
  return PROCESSING_STEPS.has(value) ? value : 'read'
}

function processingStepLabel(state) {
  return studioT(`sequence.processingStep.${exactProcessingStep(state.processingStep)}`)
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = String(value ?? '')
}

function setNodeText(node, value) {
  if (node) node.textContent = String(value ?? '')
}

function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden)
}

function setStatus(id, text, state = 'idle', busy = false) {
  const node = byId(id)
  if (!node) return
  node.textContent = text
  node.dataset.state = state
  node.setAttribute('aria-busy', String(Boolean(busy)))
}

function outputSet() {
  return {
    sheetBlob: null,
    index: null,
    gifBlob: null,
    zipBlob: null,
  }
}

export function createInitialSequenceState({ serviceAvailable = true } = {}) {
  const options = normalizeSequenceOptions()
  return {
    serviceAvailable: Boolean(serviceAvailable),
    phase: 'empty',
    busy: null,
    processingStep: null,
    sourceEpoch: 0,
    operationToken: 0,
    controller: null,
    frames: [],
    pendingFileNames: [],
    options,
    optionsKey: sequenceOptionsKey(options),
    binding: null,
    outputsInvalidated: false,
    outputOptions: null,
    outputs: outputSet(),
    zipIncludesGif: false,
    gifRequestCount: 0,
    localFailureStage: null,
    lastLocalError: null,
    lastGifError: null,
    failedFileName: null,
    error: null,
    notice: null,
  }
}

export function deriveSequencePresentation(state = createInitialSequenceState()) {
  const phase = exactPhase(state.phase)
  const presentation = SEQUENCE_PRESENTATIONS[phase]
  return {
    phase,
    ...presentation,
    busy: state.busy !== null,
  }
}

function currentBindingSnapshot(state) {
  return { sourceEpoch: state.sourceEpoch, optionsKey: state.optionsKey }
}

export function sequenceOutputsAreCurrent(state) {
  return Boolean(
    !state?.outputsInvalidated &&
    state?.outputs?.sheetBlob &&
    state?.outputs?.index &&
    state?.binding &&
    sequenceBindingIsCurrent(state.binding, currentBindingSnapshot(state))
  )
}

function releaseFrames(frames) {
  for (const frame of frames ?? []) {
    if (frame?.url) URL.revokeObjectURL(frame.url)
  }
}

function clearCanvas() {
  const canvas = byId('studio-sequence-canvas')
  if (!canvas) return
  const context = canvas.getContext?.('2d')
  context?.clearRect(0, 0, canvas.width, canvas.height)
  canvas.width = 1
  canvas.height = 1
}

function abortCurrentOperation(state) {
  state.operationToken += 1
  state.controller?.abort()
  state.controller = null
  state.busy = null
}

function clearSequenceOutputs(state, { clearPreview = true } = {}) {
  state.outputs = outputSet()
  state.binding = null
  state.outputsInvalidated = false
  state.outputOptions = null
  state.zipIncludesGif = false
  state.gifRequestCount = 0
  state.localFailureStage = null
  state.lastLocalError = null
  state.lastGifError = null
  if (clearPreview) clearCanvas()
}

function readSequenceOptions() {
  return normalizeSequenceOptions(Object.fromEntries(
    Object.entries(OPTION_IDS).map(([key, id]) => [key, byId(id)?.value]),
  ))
}

function writeSequenceOptions(options) {
  for (const [key, id] of Object.entries(OPTION_IDS)) {
    const input = byId(id)
    if (input) input.value = String(options[key])
  }
}

function assertSequencePlanFitsCanvas(plan) {
  const width = plan.index.sheet_size.w
  const height = plan.index.sheet_size.h
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_SEQUENCE_CANVAS_EDGE ||
    height > MAX_SEQUENCE_CANVAS_EDGE ||
    width * height > MAX_SEQUENCE_CANVAS_PIXELS
  ) {
    const error = new Error(studioT('sequence.error.canvasTooLarge'))
    error.code = 'sequence_canvas_too_large'
    throw error
  }
}

function drawFrame(context, image, frame, options) {
  const innerWidth = Math.max(1, options.targetW - options.padding * 2)
  const innerHeight = Math.max(1, options.targetH - options.padding * 2)
  const scale = Math.min(innerWidth / image.width, innerHeight / image.height, 1)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const x = frame.x + options.padding + Math.round((innerWidth - width) / 2)
  const y = frame.y + options.padding + Math.round((innerHeight - height) / 2)
  context.drawImage(image, x, y, width, height)
}

async function buildLocalSequenceOutput(state, plan, orderedFrames = state.frames) {
  assertSequencePlanFitsCanvas(plan)
  const canvas = byId('studio-sequence-canvas')
  const context = canvas?.getContext?.('2d')
  if (!canvas || !context) {
    const error = new Error(studioT('sequence.error.canvasUnavailable'))
    error.code = 'sequence_canvas_unavailable'
    throw error
  }
  canvas.width = plan.index.sheet_size.w
  canvas.height = plan.index.sheet_size.h
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  plan.index.frames.forEach((frame, index) => {
    drawFrame(context, orderedFrames[index].image, frame, plan.options)
  })
  const sheetBlob = await canvasToBlob(canvas)
  const zipBlob = await makeSpriteZip({ sheetBlob, index: plan.index })
  return { sheetBlob, index: plan.index, gifBlob: null, zipBlob }
}

function renderFrameList(state) {
  const list = byId('studio-sequence-frame-list')
  if (!list) return
  list.replaceChildren()
  if (!state.frames.length) {
    const empty = document.createElement('li')
    empty.className = 'sequence-frame-empty'
    empty.textContent = studioT('sequence.frames.empty')
    list.append(empty)
    return
  }
  state.frames.forEach((frame, index) => {
    const item = document.createElement('li')
    const preview = document.createElement('img')
    const name = document.createElement('strong')
    const actions = document.createElement('span')
    preview.src = frame.url
    preview.alt = frame.file.name
    name.textContent = frame.file.name
    actions.className = 'sequence-frame-actions'
    item.dataset.sequenceFrameIndex = String(index)
    for (const [action, symbol, labelKey] of [
      ['move_up', '↑', 'sequence.frames.moveUp'],
      ['move_down', '↓', 'sequence.frames.moveDown'],
      ['remove', '×', 'sequence.frames.remove'],
    ]) {
      const button = document.createElement('button')
      const label = studioT(labelKey, {
        name: frame.file.name,
        position: index + 1,
        count: state.frames.length,
      })
      button.type = 'button'
      button.dataset.sequenceFrameAction = action
      button.textContent = symbol
      button.setAttribute('aria-label', label)
      button.title = label
      button.disabled = Boolean(
        !state.serviceAvailable ||
        state.busy ||
        (action === 'move_up' && index === 0) ||
        (action === 'move_down' && index === state.frames.length - 1)
      )
      button.setAttribute('aria-disabled', String(button.disabled))
      actions.append(button)
    }
    item.append(preview, name, actions)
    list.append(item)
  })
}

function sequenceHasRetainedOutputs(state) {
  return Boolean(Object.values(state.outputs ?? {}).some(Boolean))
}

export function applySequenceFrameEdit(
  state,
  { action, index } = {},
  { revokeObjectURL = (url) => globalThis.URL?.revokeObjectURL?.(url) } = {},
) {
  if (!state?.serviceAvailable || state.busy) {
    return { changed: false, focusAction: action, focusIndex: index }
  }

  const edit = editSequenceFrames(state.frames, { action, index })
  if (!edit.changed) {
    return { ...edit, focusAction: action }
  }

  const hadRetainedOutputs = sequenceHasRetainedOutputs(state)
  abortCurrentOperation(state)
  if (edit.removedFrame?.url) revokeObjectURL(edit.removedFrame.url)
  state.frames = edit.frames
  state.sourceEpoch += 1
  state.pendingFileNames = []
  state.processingStep = null
  state.failedFileName = null
  state.error = null
  state.notice = null
  state.localFailureStage = null
  state.lastLocalError = null
  state.lastGifError = null

  if (!state.frames.length) {
    clearSequenceOutputs(state, { clearPreview: false })
    state.phase = 'empty'
  } else if (hadRetainedOutputs) {
    state.outputsInvalidated = true
    state.phase = 'stale'
  } else {
    clearSequenceOutputs(state, { clearPreview: false })
    state.phase = 'ready'
  }

  return {
    ...edit,
    focusAction: action === 'remove' ? 'remove' : action,
  }
}

function restoreSequenceFrameFocus({ focusAction, focusIndex } = {}) {
  const list = byId('studio-sequence-frame-list')
  const listVisible = Boolean(list?.getClientRects?.().length)
  if (focusIndex >= 0 && focusAction) {
    const item = listVisible ? list.querySelector(
      `[data-sequence-frame-index="${focusIndex}"]`,
    ) : null
    const requestedButton = item?.querySelector(
      `[data-sequence-frame-action="${focusAction}"]`,
    )
    const focusTarget = requestedButton && !requestedButton.disabled
      ? requestedButton
      : item?.querySelector('[data-sequence-frame-action]:not(:disabled)')
    if (focusTarget) {
      focusTarget.focus()
      return
    }
  }
  byId('studio-sequence-primary')?.focus()
}

function editSequenceFrame(action, index) {
  const result = applySequenceFrameEdit(sequenceState, { action, index })
  if (!result.changed) return
  if (!sequenceState.frames.length) clearCanvas()
  sequenceState.notice = studioT(
    sequenceState.phase === 'stale'
      ? 'sequence.notice.framesEditedStale'
      : sequenceState.frames.length
        ? 'sequence.notice.framesEdited'
        : 'sequence.notice.framesEmpty',
    { count: sequenceState.frames.length },
  )
  renderStudioSequence(sequenceState)
  const liveCopy = byId('studio-sequence-live-status')?.querySelector(
    `[data-sequence-copy-phase~="${exactPhase(sequenceState.phase)}"]`,
  )
  setNodeText(liveCopy, sequenceState.notice)
  restoreSequenceFrameFocus(result)
}

const OPTION_DELTA_LABEL_KEYS = Object.freeze({
  targetW: 'sequence.parameter.targetWidth',
  targetH: 'sequence.parameter.targetHeight',
  padding: 'sequence.parameter.padding',
  spacing: 'sequence.parameter.spacing',
  columns: 'sequence.parameter.columns',
  fps: 'sequence.parameter.fps',
})

function sequenceStaleSourceDetail(state) {
  if (state.binding?.sourceEpoch !== state.sourceEpoch) {
    return studioT('sequence.source.filesChanged')
  }
  for (const key of Object.keys(OPTION_DELTA_LABEL_KEYS)) {
    const before = state.outputOptions?.[key]
    const after = state.options?.[key]
    if (before !== undefined && before !== after) {
      return studioT('sequence.source.parameterChanged', {
        label: studioT(OPTION_DELTA_LABEL_KEYS[key]),
        before,
        after,
      })
    }
  }
  return studioT('sequence.source.bindingChanged')
}

function renderMetrics(state) {
  const plan = buildSequencePlan({ frameCount: state.frames.length, options: state.options })
  const grid = `${plan.options.columns} × ${plan.rows}`
  const sheet = `${plan.index.sheet_size.w} × ${plan.index.sheet_size.h}`
  const playback = `${plan.options.fps} FPS`
  setText('studio-sequence-metric-frames', String(plan.frameCount))
  setText('studio-sequence-metric-sheet', sheet)
  setText('studio-sequence-metric-rows', String(plan.rows))
  const planValues = {
    frames: String(plan.frameCount),
    cell: `${plan.options.targetW} × ${plan.options.targetH}`,
    grid,
    sheetSize: sheet,
    playback,
  }
  for (const [key, value] of Object.entries(planValues)) {
    const node = document.querySelector(`[data-sequence-plan-value="${key}"]`)
    if (node) node.textContent = value
  }
  const readyTitle = byId('studio-sequence-ready-title')
  if (readyTitle) {
    readyTitle.textContent = studioT('sequence.readyDynamic', {
      count: plan.frameCount,
      columns: plan.options.columns,
      rows: plan.rows,
    })
  }
  setText('studio-sequence-file-name', state.frames.length === 0
    ? studioT('sequence.file.empty')
    : state.frames.length === 1
      ? state.frames[0].file.name
      : studioT('sequence.file.many', { count: state.frames.length }))
  setText('studio-sequence-source-meta', state.frames.length
    ? studioT('sequence.source.loaded', { count: state.frames.length })
    : studioT('sequence.source.none'))

  const phase = exactPhase(state.phase)
  const sourceCopy = byId('studio-sequence-view')?.querySelector(`[data-sequence-source-phase~="${phase}"]`)
  const sourcePrimary = sourceCopy?.querySelector('[data-sequence-source-primary]')
  const sourceSecondary = sourceCopy?.querySelector('[data-sequence-source-secondary]')
  const pendingCount = state.pendingFileNames.length
  const displayCount = phase === 'processing' && state.processingStep === 'read' && pendingCount
    ? pendingCount
    : plan.frameCount
  if (sourcePrimary) {
    const primaryKeys = {
      ready: 'sequence.source.ready',
      processing: state.processingStep === 'read'
        ? 'sequence.source.processingRead'
        : state.processingStep === 'package'
          ? 'sequence.source.processingPackage'
          : 'sequence.source.processingBuild',
      building: 'sequence.source.locked',
      complete: 'sequence.source.bound',
      partial: 'sequence.source.bound',
      stale: 'sequence.source.stale',
      error: 'sequence.source.decodeFailed',
      local_error: state.localFailureStage === 'package_after_gif'
        ? 'sequence.source.packageError'
        : 'sequence.source.localError',
    }
    sourcePrimary.textContent = studioT(primaryKeys[phase] ?? 'sequence.source.bound', {
      count: displayCount,
      file: state.failedFileName ?? '—',
    })
  }
  if (sourceSecondary) {
    const first = state.frames[0]?.file?.name ?? '—'
    const last = state.frames.at(-1)?.file?.name ?? '—'
    if (phase === 'error') sourceSecondary.textContent = studioT('sequence.source.decodeFailureNoBatch')
    else if (phase === 'processing') {
      sourceSecondary.textContent = studioT('sequence.source.processingStep', {
        step: processingStepLabel(state),
      })
    } else if (phase === 'building') sourceSecondary.textContent = studioT('sequence.source.lockedHelp')
    else if (phase === 'partial') sourceSecondary.textContent = studioT('sequence.source.partialHelp')
    else if (phase === 'stale') sourceSecondary.textContent = sequenceStaleSourceDetail(state)
    else if (phase === 'local_error') sourceSecondary.textContent = `${first} → ${last}`
    else sourceSecondary.textContent = `${first} → ${last}`
  }

  const stagePhase = byId('studio-sequence-view')?.querySelector(
    `.sequence-stage-phase [data-sequence-copy-phase~="${phase}"]`,
  )
  const stagePhaseKey = phase === 'processing'
    ? `sequence.stagePhase.processing.${state.processingStep ?? 'read'}`
    : phase === 'local_error' && state.localFailureStage === 'package_after_gif'
      ? 'sequence.stagePhase.package_error'
      : `sequence.stagePhase.${phase}`
  setNodeText(stagePhase, studioT(stagePhaseKey, {
    count: displayCount,
    columns: plan.options.columns,
    rows: plan.rows,
    width: plan.index.sheet_size.w,
    height: plan.index.sheet_size.h,
    requests: state.gifRequestCount,
  }))

  const bindingCopy = byId('studio-sequence-binding-summary')?.querySelector(
    `[data-sequence-copy-phase~="${phase}"]`,
  )
  const bindingTitle = bindingCopy?.querySelector('strong')
  const bindingLines = bindingCopy ? Array.from(bindingCopy.querySelectorAll('small')) : []
  const bindingValues = {
    empty: ['sequence.binding.emptyPrimary', 'sequence.binding.emptySecondary', 'sequence.binding.emptyTertiary'],
    ready: ['sequence.binding.readyPrimary', 'sequence.binding.readySecondary', 'sequence.binding.readyTertiary'],
    processing: ['sequence.binding.processingPrimary', 'sequence.binding.processingSecondary', 'sequence.binding.processingTertiary'],
    building: ['sequence.binding.buildingPrimary', 'sequence.binding.buildingSecondary', 'sequence.binding.buildingTertiary'],
    complete: ['sequence.binding.completePrimary', 'sequence.binding.completeSecondary', 'sequence.binding.completeTertiary'],
    partial: ['sequence.binding.partialPrimary', 'sequence.binding.partialSecondary', 'sequence.binding.partialTertiary'],
    stale: ['sequence.binding.stalePrimary', 'sequence.binding.staleSecondary', 'sequence.binding.staleTertiary'],
    error: ['sequence.binding.errorPrimary', 'sequence.binding.errorSecondary', 'sequence.binding.errorTertiary'],
    local_error: state.localFailureStage === 'package_after_gif'
      ? ['sequence.binding.packageErrorPrimary', 'sequence.binding.packageErrorSecondary', 'sequence.binding.packageErrorTertiary']
      : ['sequence.binding.localErrorPrimary', 'sequence.binding.localErrorSecondary', 'sequence.binding.localErrorTertiary'],
  }[phase]
  const bindingParams = {
    count: displayCount,
    epoch: state.sourceEpoch,
    width: plan.options.targetW,
    height: plan.options.targetH,
    columns: plan.options.columns,
    fps: plan.options.fps,
    requests: state.gifRequestCount,
    step: processingStepLabel(state),
  }
  setNodeText(bindingTitle, studioT(bindingValues[0], bindingParams))
  bindingLines.forEach((node, index) => setNodeText(node, studioT(bindingValues[index + 1], bindingParams)))

  const staleIndex = phase === 'stale' ? state.outputs.index : null
  const staleOptions = staleIndex ? state.outputOptions : null
  const staleColumns = staleOptions?.columns ?? 0
  const staleRows = staleIndex?.frames?.length && staleColumns
    ? Math.ceil(staleIndex.frames.length / staleColumns)
    : 0
  const sheetMetaValues = staleIndex && staleOptions
    ? {
        count: staleIndex.frames.length,
        width: staleOptions.targetW,
        height: staleOptions.targetH,
        columns: staleColumns,
        rows: staleRows,
        sheetWidth: staleIndex.sheet_size.w,
        sheetHeight: staleIndex.sheet_size.h,
      }
    : {
        count: plan.frameCount,
        width: plan.options.targetW,
        height: plan.options.targetH,
        columns: plan.options.columns,
        rows: plan.rows,
        sheetWidth: plan.index.sheet_size.w,
        sheetHeight: plan.index.sheet_size.h,
      }
  const sheetMeta = byId('studio-sequence-view')?.querySelector('.sequence-sheet-meta > span')
  setNodeText(sheetMeta, studioT('sequence.sheetMeta', {
    ...sheetMetaValues,
  }))
  const sheetBindingMeta = byId('studio-sequence-view')?.querySelector(
    `.sequence-sheet-meta small [data-sequence-copy-phase~="${phase}"]`,
  )
  if (sheetBindingMeta) {
    setNodeText(sheetBindingMeta, studioT(`sequence.meta.${phase}`, { epoch: state.sourceEpoch }))
  }
}

function renderDownloadState(state) {
  const current = sequenceOutputsAreCurrent(state)
  const localAvailable = current && ['building', 'complete', 'partial'].includes(state.phase)
  const packageFailureAvailable = current &&
    state.phase === 'local_error' &&
    state.localFailureStage === 'package_after_gif'
  const availability = {
    png: localAvailable || packageFailureAvailable,
    json: localAvailable || packageFailureAvailable,
    gif: (localAvailable || packageFailureAvailable) && Boolean(state.outputs.gifBlob),
    zip: (localAvailable || packageFailureAvailable) && Boolean(state.outputs.zipBlob),
  }
  const statusKeysByPhase = {
    empty: { png: 'sequence.output.waiting', json: 'sequence.output.waiting', gif: 'sequence.output.waiting', zip: 'sequence.output.waiting' },
    ready: { png: 'sequence.output.waiting', json: 'sequence.output.waiting', gif: 'sequence.output.waiting', zip: 'sequence.output.waiting' },
    processing: { png: 'sequence.output.locked', json: 'sequence.output.locked', gif: 'sequence.output.locked', zip: 'sequence.output.locked' },
    building: { png: 'sequence.output.available', json: 'sequence.output.available', gif: 'sequence.output.generating', zip: 'sequence.output.availableGifPending' },
    complete: { png: 'sequence.output.available', json: 'sequence.output.available', gif: 'sequence.output.available', zip: 'sequence.output.availableWithGif' },
    partial: { png: 'sequence.output.available', json: 'sequence.output.available', gif: 'sequence.output.notGenerated', zip: 'sequence.output.availableWithoutGif' },
    stale: { png: 'sequence.output.locked', json: 'sequence.output.locked', gif: 'sequence.output.locked', zip: 'sequence.output.locked' },
    error: { png: 'sequence.output.waiting', json: 'sequence.output.waiting', gif: 'sequence.output.waiting', zip: 'sequence.output.waiting' },
    local_error: packageFailureAvailable
      ? { png: 'sequence.output.available', json: 'sequence.output.available', gif: 'sequence.output.available', zip: 'sequence.output.availableWithoutGif' }
      : { png: 'sequence.output.locked', json: 'sequence.output.locked', gif: 'sequence.output.locked', zip: 'sequence.output.locked' },
  }
  const statusKeys = state.phase === 'building' && !localAvailable
    ? statusKeysByPhase.ready
    : statusKeysByPhase[exactPhase(state.phase)]
  for (const [kind, id] of Object.entries(DOWNLOAD_IDS)) {
    const button = byId(id)
    if (!button) continue
    button.disabled = !availability[kind]
    button.setAttribute('aria-disabled', String(!availability[kind]))
    button.dataset.outputState = availability[kind] ? 'available' : exactPhase(state.phase)
    const status = button.querySelector('[data-sequence-output-status]')
    if (status) status.textContent = studioT(statusKeys[kind])
  }
}

function renderPreview(state) {
  const canvas = byId('studio-sequence-canvas')
  const hasSheet = Boolean(state.outputs.sheetBlob)
  setHidden(canvas, !hasSheet)
}

function renderControls(state) {
  const busy = state.busy !== null
  const presentation = deriveSequencePresentation(state)
  const source = byId('studio-sequence-file')
  if (source) source.disabled = !state.serviceAvailable || busy
  for (const id of Object.values(OPTION_IDS)) {
    const input = byId(id)
    if (input) input.disabled = !state.serviceAvailable || busy
  }
  const primary = byId('studio-sequence-primary')
  if (primary) {
    const needsFrames = ['generate', 'retryGif', 'retryLocal'].includes(presentation.primaryAction)
    const hasRetryAuthority = presentation.primaryAction !== 'retryGif' || sequenceOutputsAreCurrent(state)
    primary.disabled = !state.serviceAvailable || busy || presentation.primaryAction === 'busy' ||
      (needsFrames && !state.frames.length) || !hasRetryAuthority
    primary.dataset.sequenceAction = presentation.primaryAction
    primary.setAttribute('aria-disabled', String(primary.disabled))
    const localErrorCopy = primary.querySelector('[data-sequence-copy-phase~="local_error"]')
    if (localErrorCopy) {
      localErrorCopy.textContent = studioT(state.localFailureStage === 'package_after_gif'
        ? 'sequence.primary.retryPackage'
        : 'sequence.primary.retryLocal')
    }
  }
}

function localizedSequenceError(state) {
  if (!state.error) return ''
  if (state.phase === 'error') {
    return studioT('sequence.error.decodeCallout', {
      file: state.failedFileName ?? '—',
    })
  }
  if (state.phase === 'local_error') {
    const knownReasonKey = state.error.code === 'sequence_canvas_too_large'
      ? 'sequence.error.canvasTooLarge'
      : state.error.code === 'sequence_canvas_unavailable'
        ? 'sequence.error.canvasUnavailable'
        : null
    return studioT('sequence.error.localCallout', {
      reason: knownReasonKey
        ? studioT(knownReasonKey)
        : state.error.reason ?? state.error.message ?? studioT('common.unknownError'),
    })
  }
  return state.error.message ?? String(state.error)
}

function renderRuntimePhaseCopy(state, presentation) {
  const view = byId('studio-sequence-view')
  if (!view) return
  const statusCopy = byId('studio-sequence-status')?.querySelector(
    `[data-sequence-copy-phase~="${presentation.phase}"]`,
  )
  const statusKey = presentation.phase === 'local_error' && state.localFailureStage === 'package_after_gif'
    ? 'sequence.status.packageError'
    : presentation.statusKey
  setNodeText(statusCopy, studioT(statusKey, { requests: state.gifRequestCount }))

  const liveCopy = byId('studio-sequence-live-status')?.querySelector(
    `[data-sequence-copy-phase~="${presentation.phase}"]`,
  )
  const liveKey = presentation.phase === 'processing'
    ? `sequence.live.processing.${state.processingStep ?? 'read'}`
    : presentation.phase === 'local_error' && state.localFailureStage === 'package_after_gif'
      ? 'sequence.live.packageError'
      : `sequence.live.${presentation.phase}`
  setNodeText(liveCopy, studioT(liveKey, { requests: state.gifRequestCount }))

  const processingCurrent = view.querySelector('[data-sequence-processing-current]')
  if (presentation.phase === 'processing') {
    const step = exactProcessingStep(state.processingStep)
    const guidanceStep = state.busy === 'gif' && step === 'read' ? 'local_build' : step
    const summary = byId('studio-sequence-phase-summary')?.querySelector(
      '[data-sequence-copy-phase~="processing"]',
    )
    const processingSummaryKey = step === 'read'
      ? 'sequence.phase.processingSummary'
      : `sequence.phase.processingSummary.${step}`
    setNodeText(summary, studioT(processingSummaryKey))
    setNodeText(view.querySelector('[data-sequence-processing-badge]'), studioT('sequence.processingBadge', {
      requests: state.gifRequestCount,
    }))
    setNodeText(view.querySelector('[data-sequence-processing-title]'), studioT('sequence.processingCardTitle'))
    setNodeText(processingCurrent, studioT('sequence.processingCurrent', {
      step: processingStepLabel(state),
    }))
    setNodeText(view.querySelector('[data-sequence-processing-help]'), studioT(`sequence.processingHelp.${guidanceStep}`))
    setNodeText(view.querySelector('[data-sequence-processing-recovery]'), studioT(`sequence.processingRecovery.${guidanceStep}`))
  }

  if (presentation.phase === 'local_error') {
    const postGif = state.localFailureStage === 'package_after_gif'
    const summary = byId('studio-sequence-phase-summary')?.querySelector(
      '[data-sequence-copy-phase~="local_error"]',
    )
    setNodeText(summary, studioT(postGif
      ? 'sequence.phase.packageErrorSummary'
      : 'sequence.phase.localErrorSummary'))
    const truth = byId('studio-sequence-output-truth')?.querySelector(
      '[data-sequence-copy-phase~="local_error"]',
    )
    setNodeText(truth, studioT(postGif
      ? 'sequence.output.truth.packageError'
      : 'sequence.output.truth.localError'))
    view.querySelectorAll('[data-sequence-local-error-variant]').forEach((variant) => {
      variant.hidden = variant.dataset.sequenceLocalErrorVariant !== state.localFailureStage
    })
    view.querySelectorAll('[data-sequence-local-error-reason]').forEach((node) => {
      setNodeText(node, localizedSequenceError(state))
    })
    view.querySelectorAll('[data-sequence-local-error-count]').forEach((node) => {
      setNodeText(node, studioT(postGif
        ? 'sequence.packageErrorCount'
        : 'sequence.localErrorCount', {
        requests: state.gifRequestCount,
      }))
    })
    view.querySelectorAll('[data-sequence-local-error-recovery]').forEach((node) => {
      setNodeText(node, studioT(postGif
        ? 'sequence.packageErrorRecovery'
        : 'sequence.localErrorRecovery'))
    })
  }
}

export function renderStudioSequence(state = sequenceState) {
  if (!state) return
  const view = byId('studio-sequence-view')
  if (!view) return
  const presentation = deriveSequencePresentation(state)
  view.dataset.sequencePhase = presentation.phase
  view.dataset.sequenceLocalFailure = state.localFailureStage ?? ''
  view.setAttribute('aria-busy', String(presentation.busy))
  const statusState = state.error ? 'error' : presentation.busy ? 'loading' : presentation.phase === 'complete' ? 'ready' : 'idle'
  for (const id of ['studio-sequence-status', 'studio-sequence-live-status']) {
    const node = byId(id)
    if (!node) continue
    node.dataset.state = statusState
    node.setAttribute('aria-busy', String(presentation.busy))
  }
  const error = byId('studio-sequence-error')
  if (error) {
    error.textContent = localizedSequenceError(state)
    error.hidden = !state.error
  }
  setText('studio-sequence-error-file', state.failedFileName ?? '—')
  setText('studio-sequence-partial-reason', state.phase === 'partial' && state.error
    ? [state.error.code, state.error.reason ?? state.error.message].filter(Boolean).join(' · ')
    : '')
  view.querySelectorAll('[data-sequence-panel]').forEach((panel) => {
    const phases = String(panel.dataset.sequencePanel).split(/\s+/).filter(Boolean)
    panel.hidden = !phases.includes(presentation.phase)
  })
  renderFrameList(state)
  renderMetrics(state)
  renderDownloadState(state)
  renderPreview(state)
  renderControls(state)
  renderRuntimePhaseCopy(state, presentation)
}

export function renderStudioSequenceLanguage() {
  const root = byId('studio-sequence-view')
  if (!root) return
  translateStudioDocument(root, getCurrentLanguage())
  root.querySelectorAll('[data-sequence-language]').forEach((button) => {
    const active = button.dataset.sequenceLanguage === getCurrentLanguage()
    button.classList.toggle('is-current', active)
    button.setAttribute('aria-pressed', String(active))
  })
  if (sequenceState) renderStudioSequence(sequenceState)
}

async function decodeSequenceFiles(fileList) {
  const state = sequenceState
  const files = naturalSortSequenceFiles(fileList)
  if (!files.length) return
  abortCurrentOperation(state)
  const token = state.operationToken
  const previousFrames = state.frames
  const hadOutputAuthority = Boolean(state.binding || state.outputs.sheetBlob)
  state.error = null
  state.failedFileName = null
  state.notice = null
  state.busy = 'decode'
  state.processingStep = 'read'
  state.pendingFileNames = files.map((file) => file.name)
  state.phase = 'processing'
  state.notice = studioT('sequence.notice.reading')
  renderStudioSequence(state)
  const decoded = []
  try {
    for (const file of files) {
      let frame
      try {
        frame = await loadImage(file)
      } catch (error) {
        if (error && typeof error === 'object') {
          try { error.sequenceFileName = file.name } catch { /* keep the original decode error */ }
        }
        throw error
      }
      if (token !== state.operationToken) {
        URL.revokeObjectURL(frame.url)
        releaseFrames(decoded)
        return
      }
      decoded.push({ file, image: frame.image, url: frame.url })
    }
    if (token !== state.operationToken) {
      releaseFrames(decoded)
      return
    }
    state.sourceEpoch += 1
    state.frames = decoded
    state.pendingFileNames = []
    state.processingStep = null
    releaseFrames(previousFrames)
    if (hadOutputAuthority) state.outputsInvalidated = true
    state.phase = hadOutputAuthority ? 'stale' : 'ready'
    state.notice = studioT(hadOutputAuthority ? 'sequence.notice.sourceStale' : 'sequence.notice.ready', {
      count: decoded.length,
    })
  } catch (error) {
    releaseFrames(decoded)
    if (token !== state.operationToken) return
    releaseFrames(previousFrames)
    state.sourceEpoch += 1
    state.frames = []
    state.pendingFileNames = []
    state.processingStep = null
    clearSequenceOutputs(state)
    state.phase = 'error'
    state.failedFileName = error?.sequenceFileName ?? files[0]?.name ?? null
    state.error = error instanceof Error ? error : new Error(String(error))
    state.error.code = 'sequence_decode_failed'
  } finally {
    if (token === state.operationToken) {
      state.busy = null
      renderStudioSequence(state)
    }
  }
}

function updateSequenceOptions() {
  const state = sequenceState
  const options = readSequenceOptions()
  writeSequenceOptions(options)
  const nextKey = sequenceOptionsKey(options)
  if (nextKey === state.optionsKey) {
    renderStudioSequence(state)
    return
  }
  const previousPhase = state.phase
  const previousError = state.error
  const hadOutputAuthority = Boolean(state.binding || state.outputs.sheetBlob)
  state.options = options
  state.optionsKey = nextKey
  state.error = null
  if (hadOutputAuthority) {
    state.outputsInvalidated = true
    abortCurrentOperation(state)
    state.phase = 'stale'
    state.notice = studioT('sequence.notice.stale')
  } else if (previousPhase === 'local_error' && state.localFailureStage === 'pre_gif' && state.frames.length) {
    state.phase = 'local_error'
    state.error = state.lastLocalError ?? previousError
    state.notice = studioT('sequence.notice.localFailed')
  } else if (previousPhase === 'error') {
    state.phase = 'error'
    state.error = previousError
  } else if (state.frames.length) {
    state.phase = 'ready'
    state.notice = studioT('sequence.notice.ready', { count: state.frames.length })
  }
  renderStudioSequence(state)
}

function operationStillCurrent(state, token, binding) {
  return token === state.operationToken &&
    sequenceBindingIsCurrent(binding, currentBindingSnapshot(state))
}

async function generateSequence() {
  const state = sequenceState
  if (!state.serviceAvailable || state.busy || !state.frames.length) return
  abortCurrentOperation(state)
  clearSequenceOutputs(state, { clearPreview: false })
  const token = state.operationToken
  const orderedFrames = Object.freeze([...state.frames])
  const plan = buildSequencePlan({ frameCount: orderedFrames.length, options: state.options })
  const binding = createSequenceBinding({
    sourceEpoch: state.sourceEpoch,
    optionsKey: plan.optionsKey,
  })
  const controller = new AbortController()
  state.controller = controller
  state.busy = 'build'
  state.processingStep = 'local_build'
  state.phase = 'processing'
  state.binding = binding
  state.error = null
  state.notice = studioT('sequence.notice.buildingLocal')
  renderStudioSequence(state)
  let localReady = false
  let gifReady = false
  try {
    const outputs = await buildLocalSequenceOutput(state, plan, orderedFrames)
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = outputs
    state.outputOptions = Object.freeze({ ...plan.options })
    localReady = true
    let gifRequestStarted = false
    const gifBlob = await requestFrameGif({
      orderedFrames,
      options: plan.options,
      signal: controller.signal,
      onRequestStart: () => {
        if (!operationStillCurrent(state, token, binding)) return
        gifRequestStarted = true
        state.gifRequestCount += 1
        state.processingStep = null
        state.phase = 'building'
        state.notice = studioT('sequence.notice.buildingGif')
        renderStudioSequence(state)
      },
    })
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = { ...outputs, gifBlob }
    gifReady = true
    state.processingStep = 'package'
    state.phase = 'processing'
    state.notice = studioT('sequence.notice.packagingGif')
    renderStudioSequence(state)
    const zipBlob = await makeSpriteZip({
      sheetBlob: outputs.sheetBlob,
      index: outputs.index,
      gifBlob,
    })
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = {
      ...outputs,
      gifBlob,
      zipBlob,
    }
    state.zipIncludesGif = true
    state.localFailureStage = null
    state.lastLocalError = null
    state.lastGifError = null
    state.phase = 'complete'
    state.notice = studioT('sequence.notice.complete')
  } catch (error) {
    if (!operationStillCurrent(state, token, binding) || error?.name === 'AbortError') return
    state.error = error instanceof Error ? error : new Error(String(error))
    state.processingStep = null
    if (gifReady) {
      state.localFailureStage = 'package_after_gif'
      state.lastLocalError = state.error
      state.phase = 'local_error'
    } else if (localReady && gifRequestStarted) {
      state.lastGifError = state.error
      state.phase = 'partial'
    } else {
      state.outputs = outputSet()
      state.binding = null
      state.outputOptions = null
      state.zipIncludesGif = false
      clearCanvas()
      state.localFailureStage = 'pre_gif'
      state.lastLocalError = state.error
      state.phase = 'local_error'
    }
    state.notice = gifReady
      ? studioT('sequence.notice.localPackageFailed')
      : localReady && gifRequestStarted
        ? studioT('sequence.notice.partial')
        : studioT('sequence.notice.localFailed')
  } finally {
    if (token === state.operationToken) {
      state.controller = null
      state.busy = null
      state.processingStep = null
      renderStudioSequence(state)
    }
  }
}

async function retrySequenceGif() {
  const state = sequenceState
  if (
    !state.serviceAvailable ||
    state.busy ||
    !state.frames.length ||
    !sequenceOutputsAreCurrent(state) ||
    !state.outputs.sheetBlob ||
    !state.outputs.index
  ) return
  abortCurrentOperation(state)
  const token = state.operationToken
  const binding = state.binding
  const orderedFrames = Object.freeze([...state.frames])
  const controller = new AbortController()
  state.controller = controller
  state.busy = 'gif'
  state.processingStep = 'read'
  state.phase = 'processing'
  state.error = null
  state.notice = studioT('sequence.notice.reading')
  renderStudioSequence(state)
  let gifReady = false
  let gifRequestStarted = false
  try {
    const gifBlob = await requestFrameGif({
      orderedFrames,
      options: state.options,
      signal: controller.signal,
      onRequestStart: () => {
        if (!operationStillCurrent(state, token, binding)) return
        gifRequestStarted = true
        state.gifRequestCount += 1
        state.processingStep = null
        state.phase = 'building'
        state.notice = studioT('sequence.notice.buildingGif')
        renderStudioSequence(state)
      },
    })
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = { ...state.outputs, gifBlob }
    gifReady = true
    state.processingStep = 'package'
    state.phase = 'processing'
    state.notice = studioT('sequence.notice.packagingGif')
    renderStudioSequence(state)
    const zipBlob = await makeSpriteZip({
      sheetBlob: state.outputs.sheetBlob,
      index: state.outputs.index,
      gifBlob,
    })
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = { ...state.outputs, gifBlob, zipBlob }
    state.zipIncludesGif = true
    state.localFailureStage = null
    state.lastLocalError = null
    state.lastGifError = null
    state.phase = 'complete'
    state.notice = studioT('sequence.notice.complete')
  } catch (error) {
    if (!operationStillCurrent(state, token, binding) || error?.name === 'AbortError') return
    state.error = error instanceof Error ? error : new Error(String(error))
    if (gifReady) {
      state.localFailureStage = 'package_after_gif'
      state.lastLocalError = state.error
      state.phase = 'local_error'
      state.notice = studioT('sequence.notice.localPackageFailed')
    } else if (gifRequestStarted) {
      state.lastGifError = state.error
      state.phase = 'partial'
      state.notice = studioT('sequence.notice.partial')
    } else {
      state.lastGifError = state.error
      state.phase = 'partial'
      state.notice = studioT('sequence.notice.partial')
    }
  } finally {
    if (token === state.operationToken) {
      state.controller = null
      state.busy = null
      state.processingStep = null
      renderStudioSequence(state)
    }
  }
}

async function retryLocalStep() {
  const state = sequenceState
  if (state.localFailureStage !== 'package_after_gif') {
    await generateSequence()
    return
  }
  if (
    !state.serviceAvailable ||
    state.busy ||
    !sequenceOutputsAreCurrent(state) ||
    !state.outputs.sheetBlob ||
    !state.outputs.index ||
    !state.outputs.gifBlob
  ) return
  abortCurrentOperation(state)
  const token = state.operationToken
  const binding = state.binding
  state.busy = 'package'
  state.processingStep = 'package'
  state.phase = 'processing'
  state.error = null
  state.notice = studioT('sequence.notice.packagingGif')
  renderStudioSequence(state)
  try {
    const zipBlob = await makeSpriteZip({
      sheetBlob: state.outputs.sheetBlob,
      index: state.outputs.index,
      gifBlob: state.outputs.gifBlob,
    })
    if (!operationStillCurrent(state, token, binding)) return
    state.outputs = { ...state.outputs, zipBlob }
    state.zipIncludesGif = true
    state.localFailureStage = null
    state.lastLocalError = null
    state.phase = 'complete'
    state.notice = studioT('sequence.notice.complete')
  } catch (error) {
    if (!operationStillCurrent(state, token, binding)) return
    state.error = error instanceof Error ? error : new Error(String(error))
    state.localFailureStage = 'package_after_gif'
    state.lastLocalError = state.error
    state.phase = 'local_error'
    state.notice = studioT('sequence.notice.localPackageFailed')
  } finally {
    if (token === state.operationToken) {
      state.busy = null
      state.processingStep = null
      renderStudioSequence(state)
    }
  }
}

function downloadSequenceOutput(kind) {
  const state = sequenceState
  if (!sequenceOutputsAreCurrent(state) || state.phase === 'stale') return
  if (kind === 'png' && state.outputs.sheetBlob) {
    downloadBlob(state.outputs.sheetBlob, 'sprite.png')
  } else if (kind === 'json' && state.outputs.index) {
    downloadBlob(
      new Blob([JSON.stringify(state.outputs.index, null, 2)], { type: 'application/json' }),
      'index.json',
    )
  } else if (kind === 'gif' && state.outputs.gifBlob) {
    downloadBlob(state.outputs.gifBlob, 'preview.gif')
  } else if (kind === 'zip' && state.outputs.zipBlob) {
    downloadBlob(state.outputs.zipBlob, 'sprite_sheet.zip')
  }
}

function bindSequenceInputs() {
  byId('studio-sequence-file')?.addEventListener('change', (event) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void decodeSequenceFiles(files)
  })
  for (const id of Object.values(OPTION_IDS)) {
    byId(id)?.addEventListener('input', updateSequenceOptions)
  }
  byId('studio-sequence-frame-list')?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-sequence-frame-action]')
    if (!button || button.disabled) return
    const item = button.closest('[data-sequence-frame-index]')
    const index = Number(item?.dataset.sequenceFrameIndex)
    if (!Number.isSafeInteger(index)) return
    editSequenceFrame(button.dataset.sequenceFrameAction, index)
  })
  byId('studio-sequence-primary')?.addEventListener('click', (event) => {
    const action = event.currentTarget.dataset.sequenceAction
    if (action === 'select') {
      byId('studio-sequence-file')?.click()
    } else if (action === 'retryGif') {
      void retrySequenceGif()
    } else if (action === 'retryLocal') {
      void retryLocalStep()
    } else if (action === 'generate') {
      void generateSequence()
    }
  })
  const dropTarget = byId('studio-sequence-drop-zone') ?? byId('studio-sequence-view')
  dropTarget?.addEventListener('dragover', (event) => {
    if (!sequenceState?.serviceAvailable || sequenceState.busy) return
    event.preventDefault()
    dropTarget.classList.add('is-dragging')
  })
  dropTarget?.addEventListener('dragleave', () => dropTarget.classList.remove('is-dragging'))
  dropTarget?.addEventListener('drop', (event) => {
    dropTarget.classList.remove('is-dragging')
    if (!sequenceState?.serviceAvailable || sequenceState.busy) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) void decodeSequenceFiles(files)
  })
  for (const [kind, id] of Object.entries(DOWNLOAD_IDS)) {
    byId(id)?.addEventListener('click', () => downloadSequenceOutput(kind))
  }
  document.querySelectorAll('[data-sequence-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.sequenceLanguage)
      const select = byId('language-select')
      if (select) {
        select.value = getCurrentLanguage()
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      renderStudioSequenceLanguage()
    })
  })
}

export function getStudioSequenceState() {
  return sequenceState
}

export function initStudioSequence({ serviceAvailable = true } = {}) {
  if (initialized) {
    renderStudioSequenceLanguage()
    return Promise.resolve(sequenceState)
  }
  const view = byId('studio-sequence-view')
  if (!view) return Promise.resolve(null)
  initialized = true
  sequenceState = createInitialSequenceState({ serviceAvailable })
  writeSequenceOptions(sequenceState.options)
  bindSequenceInputs()
  renderStudioSequenceLanguage()
  return Promise.resolve(sequenceState)
}
