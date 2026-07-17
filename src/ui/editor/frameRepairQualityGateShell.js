import {
  fetchFrameRepairQualityGate,
  finalizeFrameRepairQualityGate,
  planFrameRepairQualityGate,
  recordFrameRepairQualityGateOutcome,
  recordFrameRepairQualityGateReview,
  setupFrameRepairQualityGate,
  startFrameRepairQualityGate,
} from './api.js'
import { createFrameRepairQualityGateController } from './frameRepairQualityGateController.js'

const DESKTOP_REVIEW_QUERY = '(min-width: 761px)'

function characterPackOptions(project) {
  return Object.values(project?.assets ?? {})
    .filter((asset) => asset?.kind === 'character_pack' && asset.revisions?.[asset.active_revision_id])
    .map((asset) => ({
      id: asset.id,
      name: asset.name ?? asset.id,
      revisionId: asset.active_revision_id,
    }))
}

function safeReportError(error) {
  return {
    error: {
      code: typeof error?.code === 'string' ? error.code : 'artifact_request_failed',
      message: 'The finalized Quality Gate report could not be loaded from sealed evidence.',
    },
  }
}

export function createFrameRepairQualityGateRuntime({
  repairWorkbench,
  frameRepair,
  getCurrentProject,
  adoptProject,
  artifactClient,
  requestRender = () => {},
  announce = () => {},
  matchMedia = globalThis.matchMedia?.bind(globalThis),
} = {}) {
  if (!repairWorkbench || !frameRepair || !artifactClient ||
      typeof getCurrentProject !== 'function' || typeof adoptProject !== 'function') {
    throw new TypeError('Frame Repair Quality Gate runtime dependencies are invalid')
  }

  const mediaQuery = typeof matchMedia === 'function' ? matchMedia(DESKTOP_REVIEW_QUERY) : null
  let desktopReviewAllowed = mediaQuery ? mediaQuery.matches === true : true
  let panel = null
  let reopenRequested = false
  let disposed = false
  let report = null
  let reportLoadKey = null
  let reportLoad = null

  function createController() {
    return createFrameRepairQualityGateController({
      api: {
        setupFrameRepairQualityGate,
        planFrameRepairQualityGate,
        startFrameRepairQualityGate,
        fetchFrameRepairQualityGate,
        recordFrameRepairQualityGateReview,
        recordFrameRepairQualityGateOutcome,
        finalizeFrameRepairQualityGate,
      },
      repairWorkbench,
      frameRepair,
      getCurrentProject,
      adoptProject,
      requestRender,
      announce,
    })
  }
  let controller = createController()

  function blindPresentation(state) {
    const active = state.session?.cases?.find((item) => item.caseId === state.activeCaseId)
    const blindActive = Boolean(active && !state.revealed &&
      (state.activeCaseStage === 'candidate' || active.status === 'candidate_ready'))
    const a = active?.blind?.a === 'after' && active?.blind?.b === 'before' ? 'after' : 'before'
    const b = a === 'after' ? 'before' : 'after'
    return {
      active: blindActive,
      revealed: state.revealed === true,
      a,
      b,
      stateText: blindActive ? 'Blind comparison: choose A or B before reveal.' : null,
      canvasLabel: blindActive ? 'Blind A/B frame comparison' : null,
    }
  }

  function getView() {
    const state = controller.capture()
    const project = getCurrentProject()
    const eligibleAssets = characterPackOptions(project)
    return {
      state,
      ui: controller.uiModel({ desktopReviewAllowed }),
      project,
      frameRepair: frameRepair.viewModel?.() ?? null,
      report: state.phase === 'finalized' ? report : null,
      desktopReviewAllowed,
      blindPresentation: blindPresentation(state),
      frameRepairEligibility: {
        enabled: Boolean(project && (eligibleAssets.length >= 6 || state.setup?.projectId === project.id)),
        reason: !project
          ? 'Load a project before opening Quality Gate'
          : eligibleAssets.length < 6 && state.setup?.projectId !== project.id
            ? 'Select a project with six eligible Character Packs'
            : null,
        eligibleAssets,
      },
    }
  }

  async function loadFinalReport() {
    const state = controller.capture()
    const session = state.session?.session
    const url = state.session?.artifacts?.reportJson
    if (state.phase !== 'finalized' || !session?.id || !url) return null
    const key = `${session.id}\0${url}`
    if (reportLoadKey === key) return reportLoad
    reportLoadKey = key
    report = null
    const allowedGeneratedUrls = new Set(state.session.allowedArtifactUrls ?? [])
    reportLoad = artifactClient.loadJson({
      identity: `quality-gate:${session.id}`,
      url,
      allowedGeneratedUrls,
    }).then((value) => {
      if (!disposed && reportLoadKey === key) report = value
      return value
    }).catch((error) => {
      if (!disposed && reportLoadKey === key) report = safeReportError(error)
      return null
    }).finally(() => {
      if (!disposed && reportLoadKey === key) requestRender()
    })
    return reportLoad
  }

  async function handleAction(type, payload = {}) {
    if (disposed) return null
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {}
    let result = null
    if (type === 'setup') {
      if (Array.isArray(payload.selectedAssetIds)) controller.selectSourceAssets(payload.selectedAssetIds)
      if (Object.hasOwn(payload, 'ownershipConfirmed')) controller.confirmOwnership(payload.ownershipConfirmed)
      result = await controller.setup({
        targetProjectId: payload.targetProjectId,
        targetProjectName: payload.targetProjectName,
      })
    } else if (type === 'author_case' || type === 'author') result = await controller.beginAuthoringCase(payload.caseId)
    else if (type === 'save_case' || type === 'save') result = controller.saveAuthoringCase(payload)
    else if (type === 'cancel_authoring' || type === 'cancel') result = controller.cancelAuthoringCase()
    else if (type === 'edit_cases') result = controller.editCases()
    else if (type === 'preflight') result = controller.preflightProvider()
    else if (type === 'plan') result = await controller.plan()
    else if (type === 'start') result = await controller.start()
    else if (type === 'refresh') result = await controller.refresh()
    else if (type === 'rehydrate') result = await controller.rehydrate()
    else if (type === 'prepare_case' || type === 'prepare') result = await controller.prepareCase(payload.caseId)
    else if (type === 'plan_case' || type === 'plan-case') result = await controller.planActiveFrameRepair()
    else if (type === 'generate') result = await controller.generateActiveCase()
    else if (type === 'blind') result = controller.chooseBlindResult(payload.choice)
    else if (type === 'reveal') result = controller.revealBlindMapping()
    else if (type === 'seal_review' || type === 'review') result = await controller.sealReview(payload)
    else if (type === 'accept') result = await controller.acceptActiveCase()
    else if (type === 'reject') result = await controller.rejectActiveCase()
    else if (type === 'recover_operation' || type === 'recover') result = await controller.recoverActiveOperation()
    else if (type === 'record_blocked' || type === 'blocked') result = await controller.recordBlockedOutcome(payload.outcome)
    else if (type === 'recover_outcome') result = await controller.recoverPendingOutcome()
    else if (type === 'finalize') result = await controller.finalize()
    else if (type === 'set_view') result = repairWorkbench.setFrameRepairComparisonView(payload)
    else if (type === 'select_evidence' && payload.url) {
      const state = controller.capture()
      const sessionId = state.session?.session?.id
      const reportUrl = state.session?.artifacts?.reportJson
      if (sessionId && (payload.url !== reportUrl || state.phase === 'finalized')) result = await artifactClient.loadJson({
        identity: `quality-gate:${sessionId}`,
        url: payload.url,
        allowedGeneratedUrls: new Set(state.session.allowedArtifactUrls ?? []),
      })
    } else if (type === 'exit') return close('quality_gate_exit')
    await loadFinalReport()
    return result
  }

  function attachPanel(value) {
    if (disposed || panel === value) return false
    panel?.closeQualityGate?.('quality_gate_panel_replaced')
    panel = value ?? null
    panel?.attachQualityGate?.(runtime)
    if (reopenRequested) panel?.openQualityGate?.()
    void loadFinalReport()
    return Boolean(panel)
  }

  function reopen() {
    if (disposed) return false
    reopenRequested = true
    void controller.rehydrate().then(() => loadFinalReport())
    return panel?.openQualityGate?.() ?? false
  }

  function close(reason = 'close') {
    reopenRequested = false
    controller.close(reason)
    panel?.closeQualityGate?.(reason)
    return true
  }

  function handleProjectSwitch() {
    const sessionId = controller.capture().session?.session?.id
    controller.handleProjectSwitch()
    controller.dispose()
    controller = createController()
    reopenRequested = false
    panel?.closeQualityGate?.('project_switch')
    if (sessionId) artifactClient.clearRepairArtifactCache?.(`quality-gate:${sessionId}`)
    report = null
    reportLoadKey = null
    reportLoad = null
  }

  function onMediaChange(event) {
    desktopReviewAllowed = event.matches === true
    requestRender()
  }
  mediaQuery?.addEventListener?.('change', onMediaChange)

  function dispose() {
    if (disposed) return
    disposed = true
    mediaQuery?.removeEventListener?.('change', onMediaChange)
    const sessionId = controller.capture().session?.session?.id
    close('teardown')
    panel?.attachQualityGate?.(null)
    panel = null
    controller.dispose()
    if (sessionId) artifactClient.clearRepairArtifactCache?.(`quality-gate:${sessionId}`)
    report = null
    reportLoadKey = null
    reportLoad = null
  }

  const runtime = Object.freeze({
    getView,
    handleAction,
    attachPanel,
    reopen,
    close,
    handleProjectSwitch,
    isDesktopReviewAllowed: () => desktopReviewAllowed,
    dispose,
  })
  return runtime
}
