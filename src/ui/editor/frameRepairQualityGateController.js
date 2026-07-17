import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
} from '../../editor-project/frameRepairQualityGateProtocol.js'
import {
  QUALITY_GATE_RECOVERY_STORAGE_KEY,
  createEmptyFrameRepairQualityGateState,
  getFrameRepairQualityGateUiModel,
  parseFrameRepairQualityGateRecoveryHandle,
  reduceFrameRepairQualityGateState,
} from './frameRepairQualityGateState.js'

const USER_CASE_SLOTS = Object.freeze([
  { caseId: 'case_user_01', difficulty: 'medium', defectCategory: 'shape' },
  { caseId: 'case_user_02', difficulty: 'medium', defectCategory: 'detail' },
  { caseId: 'case_user_03', difficulty: 'medium', defectCategory: 'anchor_baseline' },
  { caseId: 'case_user_04', difficulty: 'medium', defectCategory: 'facing_consistency' },
  { caseId: 'case_user_05', difficulty: 'hard', defectCategory: 'semantic_reconstruction' },
  { caseId: 'case_user_06', difficulty: 'hard', defectCategory: 'neighbor_continuity' },
])
const TERMINAL_CASE_STATUSES = new Set([
  'accepted', 'rejected', 'provider_blocked', 'quality_blocked',
])
const BLIND_CHOICES = new Set(['prefer_a', 'prefer_b', 'no_material_difference'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/
const SHA256 = /^[a-f0-9]{64}$/

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function safeError(error) {
  return {
    code: typeof error?.code === 'string' && SAFE_ID.test(error.code)
      ? error.code
      : 'quality_gate_action_failed',
    message: typeof error?.message === 'string' && error.message.length <= 240
      ? error.message
      : 'Quality Gate action failed',
  }
}

function targetAssetId(caseId) {
  return `asset_qg_${caseId}`
}

function createSessionId() {
  const bytes = new Uint8Array(16)
  const cryptoApi = globalThis.crypto
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure session identity is unavailable')
  }
  cryptoApi.getRandomValues(bytes)
  return `frqg_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function sanitizeSetup(result) {
  if (!plain(result) || !plain(result.project) || !SAFE_ID.test(result.project.id ?? '') ||
      !Number.isSafeInteger(result.project.revision) || !SHA256.test(result.setupManifestSha256 ?? '') ||
      !Array.isArray(result.mapping)) return null
  const mapping = result.mapping.map((item) => ({
    caseId: item?.caseId,
    targetAssetId: item?.targetAssetId,
    targetRevisionId: item?.targetRevisionId,
    ownershipClass: item?.ownershipClass,
  }))
  if (mapping.length !== 8 || mapping.some((item) => (
    !SAFE_ID.test(item.caseId ?? '') || !SAFE_ID.test(item.targetAssetId ?? '') ||
    !SAFE_ID.test(item.targetRevisionId ?? '') ||
    !['repository_control', 'user_owned'].includes(item.ownershipClass)
  ))) return null
  return {
    projectId: result.project.id,
    projectRevision: result.project.revision,
    setupManifestSha256: result.setupManifestSha256,
    mapping,
  }
}

function reconstructSetup(project, handle) {
  if (!plain(project) || project.id !== handle.projectId ||
      !Number.isSafeInteger(project.revision) || !SHA256.test(handle.setupManifestSha256 ?? '')) return null
  const caseIds = [
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.map((item) => item.caseId),
    ...USER_CASE_SLOTS.map((item) => item.caseId),
  ]
  const mapping = caseIds.map((caseId, index) => {
    const assetId = targetAssetId(caseId)
    const asset = project.assets?.[assetId]
    const revisionId = asset?.active_revision_id
    return {
      caseId,
      targetAssetId: assetId,
      targetRevisionId: revisionId,
      ownershipClass: index < 2 ? 'repository_control' : 'user_owned',
    }
  })
  if (mapping.some((item) => !SAFE_ID.test(item.targetRevisionId ?? ''))) return null
  return {
    projectId: project.id,
    projectRevision: project.revision,
    setupManifestSha256: handle.setupManifestSha256,
    mapping,
  }
}

function controlCases(setup) {
  const byCaseId = new Map(setup.mapping.map((item) => [item.caseId, item]))
  return FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.map((item) => {
    const mapped = byCaseId.get(item.caseId)
    return {
      ...clone(item),
      assetId: mapped?.targetAssetId ?? item.assetId,
      expectedAssetRevisionId: mapped?.targetRevisionId ?? item.expectedAssetRevisionId,
    }
  })
}

function selectedProviderFromPublicState(providerState) {
  const presets = Array.isArray(providerState?.presets)
    ? providerState.presets.filter((item) => plain(item) && SAFE_ID.test(item.id ?? ''))
    : []
  const selected = presets.find((item) => (
    item.id === providerState?.active_preset_id && item.available === true
  )) ?? presets.find((item) => item.available === true) ?? null
  return selected ? { available: true, providerPresetId: selected.id, imageSize: '1K' } : {
    available: false,
    providerPresetId: null,
    imageSize: '1K',
  }
}

function planCaseToLock(item, plan) {
  if (!plain(item) || !plain(item.repair) || !plain(plan?.provider)) return null
  return {
    caseId: item.case_id,
    operationId: item.operation_id,
    assetId: item.asset_id,
    expectedAssetRevisionId: item.parent_revision_id,
    clipId: item.repair.clip_id,
    clipFramePosition: item.repair.clip_frame_position,
    sheetFrameIndex: item.repair.sheet_frame_index,
    instruction: item.repair.instruction,
    maskEdits: clone(item.repair.mask_edits),
    providerPresetId: plan.provider.preset_id,
    imageSize: plan.provider.image_size,
  }
}

function browserPlanProjection(view) {
  const session = view?.session
  if (!plain(session) || !SAFE_ID.test(session.id ?? '') || !SHA256.test(session.planHash ?? '') ||
      !SAFE_ID.test(session.providerPresetId ?? '') || !['1K', '2K'].includes(session.imageSize) ||
      !Array.isArray(view.cases) || view.cases.length !== 8) return null
  const cases = view.cases.map((item) => ({
    case_id: item.caseId,
    display_index: item.displayIndex,
    asset_id: item.assetId,
    parent_revision_id: item.parentRevisionId,
    operation_id: item.operationId,
    case_hash: item.caseHash,
    repair: {
      clip_id: item.repair?.clipId,
      clip_frame_position: item.repair?.clipFramePosition,
      sheet_frame_index: item.repair?.sheetFrameIndex,
      instruction: item.repair?.instruction,
      mask_edits: clone(item.repair?.maskEdits),
    },
    classification: {
      difficulty: item.classification?.difficulty,
      defect_category: item.classification?.defectCategory,
      expected_improvement: item.classification?.expectedImprovement,
      ownership_class: item.classification?.ownershipClass,
    },
  }))
  if (cases.some((item) => !SAFE_ID.test(item.case_id ?? '') ||
      !SAFE_ID.test(item.asset_id ?? '') || !SAFE_ID.test(item.parent_revision_id ?? '') ||
      !SAFE_ID.test(item.operation_id ?? '') || !SHA256.test(item.case_hash ?? '') ||
      !SAFE_ID.test(item.repair.clip_id ?? '') || !Array.isArray(item.repair.mask_edits))) return null
  return {
    session_id: session.id,
    session_plan_hash: session.planHash,
    provider: { preset_id: session.providerPresetId, image_size: session.imageSize },
    cases,
  }
}

function acceptedRevisionId(result, assetId) {
  if (SAFE_ID.test(result?.revision?.id ?? '')) return result.revision.id
  const active = result?.project?.assets?.[assetId]?.active_revision_id
  return SAFE_ID.test(active ?? '') ? active : null
}

export function createFrameRepairQualityGateController({
  state,
  api,
  repairWorkbench,
  frameRepair,
  getCurrentProject,
  adoptProject,
  requestRender = () => {},
  announce = () => {},
  storage,
} = {}) {
  if (!api || !repairWorkbench || !frameRepair ||
      typeof getCurrentProject !== 'function' || typeof adoptProject !== 'function') {
    throw new TypeError('Frame Repair Quality Gate controller dependencies are invalid')
  }

  let currentState = plain(state) ? reduceFrameRepairQualityGateState(state, {}) :
    createEmptyFrameRepairQualityGateState()
  let persistentStorage = null
  let storageWarning = null
  let disposed = false
  let actionGeneration = 0
  let activeRequest = null
  let planRequest = null
  let sealedReview = null
  let adoptedProjectRevision = null

  try {
    persistentStorage = storage ?? globalThis.localStorage ?? null
    if (persistentStorage && (typeof persistentStorage.getItem !== 'function' ||
        typeof persistentStorage.setItem !== 'function' ||
        typeof persistentStorage.removeItem !== 'function')) persistentStorage = null
  } catch {
    persistentStorage = null
    storageWarning = 'Quality Gate recovery will not persist after refresh'
  }

  function dispatch(event, message = null) {
    currentState = reduceFrameRepairQualityGateState(currentState, event)
    if (message) announce(message)
    requestRender()
    return currentState
  }

  if (storageWarning) {
    currentState = reduceFrameRepairQualityGateState(currentState, {
      type: 'persistence_warning', message: storageWarning,
    })
  }

  function loadStoredHandle() {
    if (!persistentStorage) return null
    try {
      return parseFrameRepairQualityGateRecoveryHandle(
        persistentStorage.getItem(QUALITY_GATE_RECOVERY_STORAGE_KEY),
      )
    } catch {
      persistentStorage = null
      dispatch({
        type: 'persistence_warning',
        message: 'Quality Gate recovery will not persist after refresh',
      })
      return null
    }
  }

  function persistHandle(value) {
    const handle = parseFrameRepairQualityGateRecoveryHandle(value)
    if (!handle) return false
    if (!persistentStorage) {
      dispatch({
        type: 'persistence_warning',
        message: 'Quality Gate recovery will not persist after refresh',
      })
      return false
    }
    try {
      persistentStorage.setItem(QUALITY_GATE_RECOVERY_STORAGE_KEY, JSON.stringify(handle))
      return true
    } catch {
      persistentStorage = null
      dispatch({
        type: 'persistence_warning',
        message: 'Quality Gate recovery will not persist after refresh',
      })
      return false
    }
  }

  function currentHandle(overrides = {}) {
    const existing = loadStoredHandle() ?? {}
    const project = getCurrentProject()
    return parseFrameRepairQualityGateRecoveryHandle({
      projectId: currentState.setup?.projectId ?? project?.id ?? existing.projectId,
      ...(currentState.setup?.setupManifestSha256
        ? { setupManifestSha256: currentState.setup.setupManifestSha256 }
        : existing.setupManifestSha256 ? { setupManifestSha256: existing.setupManifestSha256 } : {}),
      ...(currentState.session?.session?.id
        ? { sessionId: currentState.session.session.id }
        : existing.sessionId ? { sessionId: existing.sessionId } : {}),
      ...(currentState.plan?.session_plan_hash
        ? { planHash: currentState.plan.session_plan_hash }
        : existing.planHash ? { planHash: existing.planHash } : {}),
      ...overrides,
    })
  }

  function capture() {
    return currentState
  }

  function uiModel(options) {
    return getFrameRepairQualityGateUiModel(currentState, options)
  }

  function action(name, operation) {
    if (disposed) return Promise.resolve(null)
    if (activeRequest) return activeRequest.name === name ? activeRequest.promise : Promise.resolve(null)
    const controller = new AbortController()
    const token = ++actionGeneration
    const promise = (async () => {
      try {
        return await operation({ signal: controller.signal, token })
      } catch (error) {
        if (error?.name !== 'AbortError' && token === actionGeneration && !disposed) {
          dispatch({ type: 'error', error: safeError(error) }, `${safeError(error).code}: ${safeError(error).message}`)
        }
        return null
      } finally {
        if (activeRequest?.token === token) activeRequest = null
      }
    })()
    activeRequest = { name, controller, token, promise }
    return promise
  }

  function abortActive() {
    actionGeneration += 1
    activeRequest?.controller.abort()
    activeRequest = null
  }

  function selectSourceAssets(assets) {
    if (disposed || currentState.phase !== 'entry' || !Array.isArray(assets) || assets.length !== 6) return false
    const project = getCurrentProject()
    const selected = assets.map((value, index) => {
      const assetId = typeof value === 'string' ? value : value?.id
      const asset = project?.assets?.[assetId]
      const revisionId = asset?.active_revision_id
      return {
        caseId: USER_CASE_SLOTS[index].caseId,
        assetId,
        expectedAssetRevisionId: revisionId,
      }
    })
    if (!project || new Set(selected.map((item) => item.assetId)).size !== 6 || selected.some((item) => {
      const asset = project.assets?.[item.assetId]
      return !asset || asset.kind !== 'character_pack' || !SAFE_ID.test(item.assetId ?? '') ||
        !SAFE_ID.test(item.expectedAssetRevisionId ?? '') ||
        !asset.revisions?.[item.expectedAssetRevisionId]
    })) return false
    dispatch({ type: 'source_assets', assets: selected })
    return true
  }

  function confirmOwnership(confirmed) {
    if (disposed || currentState.phase !== 'entry') return false
    dispatch({ type: 'ownership', confirmed })
    return currentState.ownershipConfirmed
  }

  function setup({ targetProjectId, targetProjectName = 'Frame Repair Quality Gate' } = {}) {
    const sourceProject = getCurrentProject()
    if (!sourceProject || currentState.phase !== 'entry' ||
        !uiModel().setupEnabled || !SAFE_ID.test(targetProjectId ?? '') ||
        targetProjectId === sourceProject.id) return Promise.resolve(null)
    dispatch({ type: 'phase', phase: 'setup' })
    return action('setup', async ({ signal, token }) => {
      let result
      try {
        result = await api.setupFrameRepairQualityGate({
          sourceProjectId: sourceProject.id,
          body: {
            expectedRevision: sourceProject.revision,
            targetProjectId,
            targetProjectName,
            ownershipConfirmed: true,
            sourceAssets: clone(currentState.sourceAssets),
          },
        }, { signal })
      } catch (error) {
        if (token === actionGeneration) dispatch({ type: 'phase', phase: 'entry' })
        throw error
      }
      if (token !== actionGeneration) return null
      const safeSetup = sanitizeSetup(result)
      if (!safeSetup) throw new Error('Quality Gate Setup response is invalid')
      persistHandle({
        projectId: safeSetup.projectId,
        setupManifestSha256: safeSetup.setupManifestSha256,
      })
      dispatch({ type: 'setup', setup: safeSetup }, 'Quality Gate project is ready for case authoring')
      dispatch({ type: 'cases', cases: controlCases(safeSetup) })
      adoptedProjectRevision = result.project.revision
      await adoptProject(result.project)
      return safeSetup
    })
  }

  function rehydrate() {
    const handle = loadStoredHandle()
    if (!handle) return Promise.resolve(null)
    return action('rehydrate', async ({ signal, token }) => {
      let project = getCurrentProject()
      if (project?.id !== handle.projectId && typeof api.loadEditorProject === 'function') {
        const loaded = await api.loadEditorProject(handle.projectId, { signal })
        project = loaded?.project ?? loaded
        if (token !== actionGeneration) return null
        if (project) await adoptProject(project)
      }
      const safeSetup = reconstructSetup(project, handle)
      if (!safeSetup) return null
      dispatch({ type: 'ownership', confirmed: true })
      dispatch({ type: 'setup', setup: safeSetup })
      dispatch({ type: 'cases', cases: controlCases(safeSetup) })
      if (!handle.sessionId) return safeSetup
      const view = await api.fetchFrameRepairQualityGate({
        projectId: handle.projectId,
        sessionId: handle.sessionId,
      }, { signal })
      if (token !== actionGeneration) return null
      const recoveredPlan = browserPlanProjection(view)
      if (!recoveredPlan) throw new Error('Quality Gate recovery view is incomplete')
      dispatch({ type: 'planned', plan: recoveredPlan })
      dispatch({ type: 'session', session: view }, 'Quality Gate session recovered')
      if (handle.caseId) dispatch({ type: 'active_case', caseId: handle.caseId })
      if (handle.reviewSha256) sealedReview = { sha256: handle.reviewSha256 }
      if (handle.acceptedRevisionId) {
        dispatch({ type: 'pending_outcome', handle })
      }
      return view
    })
  }

  function preflightProvider() {
    if (disposed || !['authoring', 'planned'].includes(currentState.phase)) return false
    const value = selectedProviderFromPublicState(frameRepair.viewModel?.().providerState)
    dispatch({ type: 'provider_preflight', value })
    return value.available
  }

  function beginAuthoringCase(caseId) {
    const slot = USER_CASE_SLOTS.find((item) => item.caseId === caseId)
    const mapped = currentState.setup?.mapping?.find((item) => item.caseId === caseId)
    const project = getCurrentProject()
    const asset = project?.assets?.[mapped?.targetAssetId]
    if (!slot || currentState.phase !== 'authoring' || !asset) return Promise.resolve(false)
    return action('author_case', async ({ token }) => {
      await repairWorkbench.openAsset(asset)
      if (token !== actionGeneration) return false
      const entered = repairWorkbench.enterQualityGateAuthoringCase()
      if (entered) {
        dispatch({ type: 'active_case', caseId })
        dispatch({ type: 'case_stage', stage: 'authoring' })
      }
      return entered
    })
  }

  function saveAuthoringCase({ expectedImprovement } = {}) {
    const slot = USER_CASE_SLOTS.find((item) => item.caseId === currentState.activeCaseId)
    if (!slot || currentState.phase !== 'authoring') return null
    const draft = repairWorkbench.exportQualityGateCaseDraft({
      ...slot,
      expectedImprovement,
    })
    if (!draft || typeof draft.expectedImprovement !== 'string' || !draft.expectedImprovement.trim()) return null
    const nextCases = [
      ...currentState.cases.filter((item) => !USER_CASE_SLOTS.some((slotItem) => slotItem.caseId === item.caseId)),
      ...USER_CASE_SLOTS.map((slotItem) => (
        slotItem.caseId === slot.caseId
          ? draft
          : currentState.cases.find((item) => item.caseId === slotItem.caseId)
      )).filter(Boolean),
    ]
    if (currentState.plan || currentState.session) dispatch({ type: 'invalidate' })
    dispatch({ type: 'cases', cases: nextCases }, 'Case definition saved in memory; Start seals the session')
    dispatch({ type: 'case_stage', stage: null })
    frameRepair.close?.('quality_gate_case_saved')
    planRequest = null
    return draft
  }

  function cancelAuthoringCase() {
    if (disposed || currentState.phase !== 'authoring' ||
        currentState.activeCaseStage !== 'authoring') return false
    frameRepair.close?.('quality_gate_case_cancelled')
    dispatch({ type: 'case_stage', stage: null }, 'Case authoring cancelled; no definition was saved')
    return true
  }

  function setCases(cases) {
    if (disposed || currentState.phase !== 'authoring' || !Array.isArray(cases)) return false
    dispatch({ type: 'cases', cases: clone(cases) })
    planRequest = null
    return true
  }

  function editCases() {
    if (disposed || currentState.phase !== 'planned' || currentState.session) return false
    abortActive()
    planRequest = null
    sealedReview = null
    frameRepair.close?.('quality_gate_plan_invalidated')
    dispatch({ type: 'invalidate' }, 'Quality Gate plan invalidated; case definitions are editable again')
    return true
  }

  function plan() {
    const project = getCurrentProject()
    const provider = currentState.providerPreflight
    if (!project || currentState.phase !== 'authoring' || !uiModel().validateEnabled) return Promise.resolve(null)
    return action('plan', async ({ signal, token }) => {
      const body = {
        sessionId: createSessionId(),
        expectedRevision: project.revision,
        setupManifestSha256: currentState.setup.setupManifestSha256,
        providerPresetId: provider.providerPresetId,
        imageConfig: { image_size: provider.imageSize },
        maxProviderCalls: 8,
        cases: clone(currentState.cases),
      }
      const result = await api.planFrameRepairQualityGate({
        projectId: project.id,
        body,
      }, { signal })
      if (token !== actionGeneration) return null
      if (!SHA256.test(result?.session_plan_hash ?? '') || result.session_id !== body.sessionId) {
        throw new Error('Quality Gate Plan response is invalid')
      }
      planRequest = body
      dispatch({ type: 'planned', plan: result }, 'Quality Gate plan validated with zero provider calls')
      return result
    })
  }

  function start() {
    const project = getCurrentProject()
    if (!project || !planRequest || !uiModel().startEnabled) return Promise.resolve(null)
    return action('start', async ({ signal, token }) => {
      const started = await api.startFrameRepairQualityGate({
        projectId: project.id,
        body: {
          ...clone(planRequest),
          expectedPlanHash: currentState.plan.session_plan_hash,
          confirmSessionStart: true,
        },
      }, { signal })
      if (token !== actionGeneration) return null
      const plan = started?.plan
      if (plan?.session_plan_hash !== currentState.plan.session_plan_hash) {
        throw new Error('Quality Gate Start response is invalid')
      }
      persistHandle({
        projectId: project.id,
        setupManifestSha256: currentState.setup.setupManifestSha256,
        sessionId: plan.session_id,
        planHash: plan.session_plan_hash,
        projectRevision: project.revision,
      })
      const view = await api.fetchFrameRepairQualityGate({
        projectId: project.id,
        sessionId: plan.session_id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view }, 'Quality Gate started; each Generate remains an explicit action')
      const first = view?.cases?.find((item) => !TERMINAL_CASE_STATUSES.has(item.status))
      if (first) dispatch({ type: 'active_case', caseId: first.caseId })
      return view
    })
  }

  function refresh() {
    const session = currentState.session?.session
    const handle = loadStoredHandle()
    const projectId = session?.projectId ?? currentState.setup?.projectId ?? handle?.projectId
    const sessionId = session?.id ?? handle?.sessionId
    if (!projectId || !sessionId) return Promise.resolve(null)
    return action('refresh', async ({ signal, token }) => {
      const view = await api.fetchFrameRepairQualityGate({ projectId, sessionId }, { signal })
      if (token !== actionGeneration) return null
      if (!currentState.plan) {
        const recoveredPlan = browserPlanProjection(view)
        if (!recoveredPlan) throw new Error('Quality Gate session view is incomplete')
        dispatch({ type: 'planned', plan: recoveredPlan })
      }
      dispatch({ type: 'session', session: view })
      return view
    })
  }

  function prepareCase(caseId = currentState.activeCaseId) {
    const serverCases = currentState.session?.cases ?? []
    const firstOpen = serverCases.find((item) => !TERMINAL_CASE_STATUSES.has(item.status))
    const serverCase = serverCases.find((item) => item.caseId === caseId)
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === caseId)
    const project = getCurrentProject()
    const asset = project?.assets?.[serverCase?.assetId]
    const lockedCase = planCaseToLock(plannedCase, currentState.plan)
    if (!serverCase || firstOpen?.caseId !== caseId || !plannedCase || !asset || !lockedCase ||
        currentState.phase === 'finalized' ||
        (currentState.phase === 'paused' && serverCase.status !== 'outcome_unknown')) {
      return Promise.resolve(false)
    }
    return action('prepare_case', async ({ token }) => {
      await repairWorkbench.openAsset(asset)
      if (token !== actionGeneration) return false
      if (!repairWorkbench.selectFrameRepairClip(lockedCase.clipId) ||
          !repairWorkbench.selectFrameRepairFrame(lockedCase.clipFramePosition)) return false
      const entered = repairWorkbench.enterLockedQualityGateCase(lockedCase)
      if (entered) {
        dispatch({ type: 'active_case', caseId })
        dispatch({
          type: 'case_stage',
          stage: serverCase.status === 'candidate_ready'
            ? 'candidate'
            : serverCase.status === 'outcome_unknown' ? 'outcome_unknown' : 'locked',
        })
        persistHandle({
          projectId: project.id,
          setupManifestSha256: currentState.setup.setupManifestSha256,
          sessionId: currentState.session.session.id,
          planHash: currentState.plan.session_plan_hash,
          caseId,
          operationId: lockedCase.operationId,
          projectRevision: project.revision,
        })
        if (serverCase.status === 'candidate_ready') {
          await frameRepair.recoverOriginalOperation()
          if (token !== actionGeneration) return false
        }
      }
      return entered
    })
  }

  function planActiveFrameRepair() {
    if (currentState.activeCaseStage !== 'locked') return Promise.resolve(null)
    return action('plan_active_case', async ({ token }) => {
      const result = await frameRepair.reviewCall()
      if (token !== actionGeneration || !result?.can_run) return null
      dispatch({ type: 'case_stage', stage: 'planned' }, 'Frame Repair Plan is ready; Generate still requires confirmation')
      return result
    })
  }

  function generateActiveCase() {
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === currentState.activeCaseId)
    if (currentState.activeCaseStage !== 'planned' || !plannedCase) return Promise.resolve(null)
    return action('generate_active_case', async ({ signal, token }) => {
      const result = await repairWorkbench.generateQualityGateCandidate(plannedCase.operation_id)
      if (token !== actionGeneration) return null
      if (result) {
        const view = await api.fetchFrameRepairQualityGate({
          projectId: currentState.session.session.projectId,
          sessionId: currentState.session.session.id,
        }, { signal })
        if (token !== actionGeneration) return null
        dispatch({ type: 'session', session: view })
        dispatch({ type: 'case_stage', stage: 'candidate' }, 'One candidate completed; review remains manual')
      }
      return result
    })
  }

  function recoverActiveOperation() {
    if (!uiModel().recoverEnabled) return Promise.resolve(null)
    return action('recover_active_operation', async ({ signal, token }) => {
      const result = await frameRepair.recoverOriginalOperation()
      if (token !== actionGeneration) return null
      const view = await api.fetchFrameRepairQualityGate({
        projectId: currentState.session.session.projectId,
        sessionId: currentState.session.session.id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view })
      const active = view.cases?.find((item) => item.caseId === currentState.activeCaseId)
      dispatch({
        type: 'case_stage',
        stage: active?.status === 'candidate_ready' ? 'candidate' : 'outcome_unknown',
      })
      return result
    })
  }

  function chooseBlindResult(choice) {
    if (!BLIND_CHOICES.has(choice) || currentState.phase !== 'reviewing' &&
        currentState.activeCaseStage !== 'candidate') return false
    dispatch({ type: 'blind_choice', choice })
    return true
  }

  function revealBlindMapping() {
    if (!currentState.blindChoice || currentState.revealed) return false
    dispatch({ type: 'revealed' })
    return true
  }

  function sealReview({ improvement, usability, newBlockingDefect, reasonCodes = [], note = null } = {}) {
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === currentState.activeCaseId)
    const job = frameRepair.viewModel?.().job
    const project = getCurrentProject()
    if (!plannedCase || !project || !currentState.revealed || !currentState.blindChoice ||
        !SAFE_ID.test(job?.id ?? '')) return Promise.resolve(null)
    return action('seal_review', async ({ signal, token }) => {
      const result = await api.recordFrameRepairQualityGateReview({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
        caseId: plannedCase.case_id,
        body: {
          expectedPlanHash: currentState.plan.session_plan_hash,
          expectedCaseHash: plannedCase.case_hash,
          operationId: plannedCase.operation_id,
          jobId: job.id,
          blindChoice: currentState.blindChoice,
          improvement,
          usability,
          newBlockingDefect,
          reasonCodes: clone(reasonCodes),
          note,
        },
      }, { signal })
      if (token !== actionGeneration || !SHA256.test(result?.sha256 ?? '')) return null
      sealedReview = { sha256: result.sha256, jobId: job.id }
      persistHandle({
        projectId: project.id,
        setupManifestSha256: currentState.setup.setupManifestSha256,
        sessionId: currentState.plan.session_id,
        planHash: currentState.plan.session_plan_hash,
        caseId: plannedCase.case_id,
        operationId: plannedCase.operation_id,
        jobId: job.id,
        projectRevision: project.revision,
        reviewSha256: result.sha256,
      })
      const view = await api.fetchFrameRepairQualityGate({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view })
      dispatch({ type: 'case_stage', stage: 'review_sealed' }, 'Blind and functional review sealed')
      return result
    })
  }

  function outcomeBody({ plannedCase, jobId, outcome, projectRevision, acceptedRevisionId = null }) {
    return {
      expectedPlanHash: currentState.plan.session_plan_hash,
      expectedCaseHash: plannedCase.case_hash,
      operationId: plannedCase.operation_id,
      jobId,
      expectedReviewSha256: sealedReview?.sha256 ?? null,
      outcome,
      expectedProjectRevision: projectRevision,
      acceptedRevisionId,
    }
  }

  function acceptActiveCase() {
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === currentState.activeCaseId)
    if (!plannedCase || currentState.activeCaseStage !== 'review_sealed' || !sealedReview) {
      return Promise.resolve(null)
    }
    return action('accept_active_case', async ({ signal, token }) => {
      const accepted = await repairWorkbench.acceptQualityGateCandidateDeferred()
      if (token !== actionGeneration || !accepted?.project) return null
      const revisionId = acceptedRevisionId(accepted, plannedCase.asset_id)
      const projectRevision = accepted.project.revision
      if (!revisionId || !Number.isSafeInteger(projectRevision)) {
        throw new Error('Deferred Accept response is invalid')
      }
      const handle = currentHandle({
        caseId: plannedCase.case_id,
        operationId: plannedCase.operation_id,
        jobId: sealedReview.jobId,
        acceptedRevisionId: revisionId,
        projectRevision,
        reviewSha256: sealedReview.sha256,
      })
      try {
        await api.recordFrameRepairQualityGateOutcome({
          projectId: accepted.project.id,
          sessionId: currentState.plan.session_id,
          caseId: plannedCase.case_id,
          body: outcomeBody({
            plannedCase,
            jobId: sealedReview.jobId,
            outcome: 'accepted',
            projectRevision,
            acceptedRevisionId: revisionId,
          }),
        }, { signal })
      } catch (error) {
        if (handle) {
          persistHandle(handle)
          dispatch({ type: 'pending_outcome', handle })
        }
        throw error
      }
      if (token !== actionGeneration) return null
      if (adoptedProjectRevision !== projectRevision) {
        adoptedProjectRevision = projectRevision
        await adoptProject(accepted.project)
      }
      const settledHandle = currentHandle({ projectRevision })
      if (settledHandle) persistHandle(settledHandle)
      sealedReview = null
      dispatch({ type: 'pending_outcome', handle: null })
      const view = await api.fetchFrameRepairQualityGate({
        projectId: accepted.project.id,
        sessionId: currentState.plan.session_id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view }, 'Accepted outcome sealed and project adopted')
      return view
    })
  }

  function rejectActiveCase() {
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === currentState.activeCaseId)
    const project = getCurrentProject()
    if (!plannedCase || !project || currentState.activeCaseStage !== 'review_sealed' || !sealedReview) {
      return Promise.resolve(null)
    }
    return action('reject_active_case', async ({ signal, token }) => {
      await api.recordFrameRepairQualityGateOutcome({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
        caseId: plannedCase.case_id,
        body: outcomeBody({
          plannedCase,
          jobId: sealedReview.jobId,
          outcome: 'rejected',
          projectRevision: project.revision,
        }),
      }, { signal })
      if (token !== actionGeneration) return null
      const settledHandle = currentHandle({ projectRevision: project.revision })
      if (settledHandle) persistHandle(settledHandle)
      sealedReview = null
      const view = await api.fetchFrameRepairQualityGate({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view }, 'Rejected outcome sealed; project was not changed')
      return view
    })
  }

  function recordBlockedOutcome(outcome) {
    if (outcome !== 'provider_blocked' && outcome !== 'quality_blocked') return Promise.resolve(null)
    const plannedCase = currentState.plan?.cases?.find((item) => item.case_id === currentState.activeCaseId)
    const project = getCurrentProject()
    const jobId = frameRepair.viewModel?.().job?.id ?? null
    if (!plannedCase || !project || !JOB_ID.test(jobId ?? '')) {
      return Promise.resolve(null)
    }
    return action('record_blocked_outcome', async ({ signal, token }) => {
      await api.recordFrameRepairQualityGateOutcome({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
        caseId: plannedCase.case_id,
        body: {
          expectedPlanHash: currentState.plan.session_plan_hash,
          expectedCaseHash: plannedCase.case_hash,
          operationId: plannedCase.operation_id,
          jobId,
          expectedReviewSha256: null,
          outcome,
          expectedProjectRevision: project.revision,
          acceptedRevisionId: null,
        },
      }, { signal })
      if (token !== actionGeneration) return null
      const view = await api.fetchFrameRepairQualityGate({
        projectId: project.id,
        sessionId: currentState.plan.session_id,
      }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: view }, `${outcome} outcome sealed without project adoption`)
      return view
    })
  }

  function recoverPendingOutcome() {
    const handle = parseFrameRepairQualityGateRecoveryHandle(currentState.pendingOutcome) ?? loadStoredHandle()
    if (!handle?.acceptedRevisionId || !handle.sessionId || !handle.caseId || !handle.reviewSha256) {
      return Promise.resolve(null)
    }
    return action('recover_pending_outcome', async ({ signal, token }) => {
      const view = await api.fetchFrameRepairQualityGate({
        projectId: handle.projectId,
        sessionId: handle.sessionId,
      }, { signal })
      const serverCase = view?.cases?.find((item) => item.caseId === handle.caseId)
      if (!serverCase) return null
      if (serverCase.outcome !== 'accepted') {
        await api.recordFrameRepairQualityGateOutcome({
          projectId: handle.projectId,
          sessionId: handle.sessionId,
          caseId: handle.caseId,
          body: {
            expectedPlanHash: handle.planHash,
            expectedCaseHash: serverCase.caseHash,
            operationId: handle.operationId,
            jobId: handle.jobId,
            expectedReviewSha256: handle.reviewSha256,
            outcome: 'accepted',
            expectedProjectRevision: handle.projectRevision,
            acceptedRevisionId: handle.acceptedRevisionId,
          },
        }, { signal })
      }
      if (token !== actionGeneration) return null
      if (typeof api.loadEditorProject === 'function') {
        const loaded = await api.loadEditorProject(handle.projectId, { signal })
        const project = loaded?.project ?? loaded
        if (project && token === actionGeneration) await adoptProject(project)
      }
      const settledHandle = currentHandle({
        caseId: undefined,
        operationId: undefined,
        jobId: undefined,
        acceptedRevisionId: undefined,
        projectRevision: handle.projectRevision,
        reviewSha256: undefined,
      })
      if (settledHandle) persistHandle(settledHandle)
      dispatch({ type: 'pending_outcome', handle: null })
      const refreshed = serverCase.outcome === 'accepted'
        ? view
        : await api.fetchFrameRepairQualityGate({
            projectId: handle.projectId,
            sessionId: handle.sessionId,
          }, { signal })
      if (token !== actionGeneration) return null
      dispatch({ type: 'session', session: refreshed }, 'Accepted outcome recovered without another Generate or Accept')
      return refreshed
    })
  }

  function finalize() {
    const project = getCurrentProject()
    const session = currentState.session?.session
    if (!project || !session || !uiModel().finalizeEnabled) return Promise.resolve(null)
    return action('finalize', async ({ signal, token }) => {
      const result = await api.finalizeFrameRepairQualityGate({
        projectId: project.id,
        sessionId: session.id,
        body: {
          expectedPlanHash: session.planHash,
          expectedRevision: project.revision,
          confirmFinalize: true,
        },
      }, { signal })
      if (token !== actionGeneration) return null
      if (result?.view) dispatch({ type: 'session', session: result.view }, 'Quality Gate finalized')
      return result
    })
  }

  function close(reason = 'close') {
    abortActive()
    frameRepair.close?.(reason)
    sealedReview = null
  }

  function handleProjectSwitch() {
    close('project_switch')
  }

  function dispose() {
    if (disposed) return
    close('teardown')
    disposed = true
  }

  return Object.freeze({
    capture,
    uiModel,
    selectSourceAssets,
    confirmOwnership,
    setup,
    rehydrate,
    preflightProvider,
    beginAuthoringCase,
    saveAuthoringCase,
    cancelAuthoringCase,
    setCases,
    editCases,
    plan,
    start,
    refresh,
    prepareCase,
    planActiveFrameRepair,
    generateActiveCase,
    recoverActiveOperation,
    chooseBlindResult,
    revealBlindMapping,
    sealReview,
    acceptActiveCase,
    rejectActiveCase,
    recordBlockedOutcome,
    recoverPendingOutcome,
    finalize,
    close,
    handleProjectSwitch,
    dispose,
  })
}
