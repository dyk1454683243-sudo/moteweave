const TERMINAL_CASE_STATUSES = new Set([
  'accepted', 'rejected', 'provider_blocked', 'quality_blocked',
])

const PROVIDER_DIAGNOSTICS = Object.freeze({
  provider_safety_filter: 'The provider blocked the candidate for safety reasons.',
  provider_route_blocked: 'The selected provider route rejected image generation.',
  provider_unavailable: 'The selected provider preset is unavailable.',
  provider_configuration_error: 'The selected provider configuration is invalid.',
  provider_output_invalid: 'The provider response did not contain a usable image.',
  provider_candidate_invalid: 'The returned image did not produce a valid repair candidate.',
  provider_authentication_failed: 'The provider rejected its configured credentials.',
  provider_quota_or_payment_required: 'The provider reported unavailable quota or required payment.',
  provider_rate_limited: 'The provider temporarily rate-limited the request.',
  provider_request_rejected: 'The provider rejected the submitted request.',
  provider_service_unavailable: 'The provider service was unavailable.',
  transport_outcome_unknown: 'The remote result is unknown. Recover the original operation; no call is repeated.',
  provider_failed: 'The provider outcome could not be classified safely. Recover the original operation.',
})

const REASON_CODES = Object.freeze([
  'outline_repaired', 'alpha_edge_repaired', 'component_repaired', 'shape_improved',
  'detail_improved', 'anchor_improved', 'facing_improved', 'semantic_improved',
  'continuity_improved', 'no_visible_improvement', 'new_artifact', 'identity_drift',
  'pose_drift', 'continuity_regression', 'blocked_by_hard_gate',
])

const USER_CASE_IDS = Object.freeze([
  'case_user_01', 'case_user_02', 'case_user_03',
  'case_user_04', 'case_user_05', 'case_user_06',
])

function node(documentRef, tag, className = '', text = '') {
  const value = documentRef.createElement(tag)
  if (className) value.className = className
  value.textContent = text
  return value
}

function option(documentRef, value, label) {
  const item = node(documentRef, 'option', '', label)
  item.value = value
  return item
}

function scalar(value, fallback = 'Unavailable') {
  return value == null || value === '' ? fallback : String(value)
}

function yesNo(value) {
  return value === true ? 'Pass' : value === false ? 'Blocked' : 'Unavailable'
}

function list(value, fallback = 'None') {
  const items = Array.isArray(value) ? value.filter((item) => (
    typeof item === 'string' || typeof item === 'number'
  )) : []
  return items.length ? items.join(', ') : fallback
}

function titleCase(value) {
  return scalar(value).replaceAll('_', ' ')
}

function allAssets(project) {
  const source = project?.assets
  if (Array.isArray(source)) return source
  if (source && typeof source === 'object') return Object.values(source)
  return []
}

function classificationFor(item, planned) {
  return item?.classification ?? (planned ? {
    difficulty: planned.classification?.difficulty,
    defectCategory: planned.classification?.defect_category,
    expectedImprovement: planned.classification?.expected_improvement,
  } : {})
}

function safeDiagnostic(operation) {
  const requested = typeof operation?.reason === 'string' &&
    Object.hasOwn(PROVIDER_DIAGNOSTICS, operation.reason)
    ? operation.reason
    : operation?.recoveryState === 'outcome_unknown' || operation?.recovery_state === 'outcome_unknown'
      ? 'provider_failed'
      : null
  if (!requested) return { code: null, detail: 'No controlled provider diagnostic is recorded.' }
  return { code: requested, detail: PROVIDER_DIAGNOSTICS[requested] }
}

function evidenceValue(value, fallback = 'Unavailable — evidence is not loaded') {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return yesNo(value)
  if (value && typeof value === 'object' && typeof value.status === 'string') return titleCase(value.status)
  return fallback
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

/**
 * Projects authoritative controller/server state into presentation-only values.
 * Trusted rates, hashes, hard gates, and pixel facts are copied, never recomputed.
 */
export function buildFrameRepairQualityGateViewModel(input = {}) {
  const state = input?.state ?? {}
  const ui = input?.ui ?? {}
  const project = input?.project ?? null
  const frameRepair = input?.frameRepair ?? {}
  const serverView = state?.session?.session ? state.session : input?.session ?? {}
  const session = serverView?.session ?? {}
  const planCases = Array.isArray(state?.plan?.cases) ? state.plan.cases : []
  const serverCases = Array.isArray(serverView?.cases) ? serverView.cases : []
  const progressSource = serverCases.length ? serverCases : Array.isArray(ui?.progress) ? ui.progress : []
  const activeCaseId = state?.activeCaseId ?? progressSource.find((item) => (
    !TERMINAL_CASE_STATUSES.has(item?.status)
  ))?.caseId ?? progressSource[0]?.caseId ?? null
  const activeIndex = Math.max(0, progressSource.findIndex((item) => item?.caseId === activeCaseId))
  const activeCase = progressSource[activeIndex] ?? null
  const plannedCase = planCases.find((item) => item?.case_id === activeCase?.caseId) ?? null
  const classification = classificationFor(activeCase, plannedCase)
  const quality = frameRepair?.quality ?? activeCase?.quality ?? {}
  const integrity = quality?.integrity ?? {}
  const validation = quality?.validation ?? {}
  const metrics = quality?.metrics ?? frameRepair?.evidence ?? {}
  const operation = activeCase?.operation ?? frameRepair?.job ?? null
  const diagnostic = safeDiagnostic(operation)
  const report = input?.report?.report ?? input?.report ?? null
  const decision = report?.decision ?? null
  const phase = state?.phase ?? ui?.phase ?? 'entry'
  const view = phase === 'finalized' || decision?.result
    ? 'summary'
    : ['running', 'paused', 'reviewing'].includes(phase) ? 'review' : 'setup'
  const desktopReviewAllowed = input?.desktopReviewAllowed !== false
  const mobileReason = desktopReviewAllowed ? null : 'Desktop pixel inspection is required'
  const eligibleAssets = allAssets(project).filter((item) => item?.kind === 'character_pack')
  const selectedAssetIds = (Array.isArray(state?.sourceAssets) ? state.sourceAssets : [])
    .map((item) => typeof item === 'string' ? item : item?.assetId ?? item?.id)
    .filter(Boolean)
  const authoredCaseIds = new Set((Array.isArray(state?.cases) ? state.cases : [])
    .map((item) => item?.caseId).filter(Boolean))
  const mappedUserCaseIds = (Array.isArray(state?.setup?.mapping) ? state.setup.mapping : [])
    .filter((item) => item?.ownershipClass === 'user_owned')
    .map((item) => item.caseId)
  const nextAuthorCaseId = (mappedUserCaseIds.length ? mappedUserCaseIds : USER_CASE_IDS)
    .find((caseId) => !authoredCaseIds.has(caseId)) ?? null
  const selectedProgress = new Map((Array.isArray(ui?.progress) ? ui.progress : [])
    .map((item) => [item.caseId, item]))
  const progress = Array.from({ length: 8 }, (_, index) => {
    const item = progressSource[index] ?? {}
    const projected = selectedProgress.get(item.caseId) ?? {}
    const status = item.status ?? projected.status ?? 'pending'
    const caseId = item.caseId ?? projected.caseId ?? null
    const selectable = Boolean(caseId && (item.reviewArtifactUrl || item.outcomeArtifactUrl ||
      (TERMINAL_CASE_STATUSES.has(status) && (item.outcome || projected.outcomeLabel))))
    return {
      index,
      caseId,
      label: caseId ? `Case ${index + 1} · ${caseId}` : `Case ${index + 1}`,
      status,
      icon: projected.icon ?? (TERMINAL_CASE_STATUSES.has(status) ? '✓' : status === 'processing' ? '…' : '•'),
      visualResult: projected.visualResult ?? (item.reviewRecorded
        ? item.successfulCandidate ? 'Visual success' : 'Visual not successful'
        : null),
      outcomeLabel: projected.outcomeLabel ?? item.outcome ?? null,
      selectable,
      artifactUrl: item.outcomeArtifactUrl ?? item.reviewArtifactUrl ?? null,
      active: caseId != null && caseId === activeCaseId,
    }
  })
  const providerReady = state?.providerPreflight?.available === true
  const setupBusy = phase === 'setup'
  const setupBaseReason = !project
    ? 'Load a source Editor project first'
    : eligibleAssets.length < 6
      ? 'Six eligible Character Packs are required'
      : setupBusy ? 'Creating the isolated project' : null
  const setupEnabled = !setupBaseReason && (ui?.setupEnabled === true || (
    phase === 'entry' && selectedAssetIds.length === 6 && state?.ownershipConfirmed === true
  ))
  const hardGateStatus = activeCase?.status === 'quality_blocked'
    ? 'blocked'
    : quality?.complete === true && ['pass', 'warning'].includes(quality?.status)
      ? quality.status
      : quality?.status ?? 'unavailable'
  const comparisonReady = Boolean(frameRepair?.candidate || frameRepair?.comparison ||
    ['candidate_ready', 'awaiting_review', 'awaiting_decision'].includes(activeCase?.status))
  const revealed = state?.revealed === true
  const blind = activeCase?.blind ?? {}
  const labelFor = (side) => {
    if (!revealed) return side.toUpperCase()
    const mapped = blind?.[side]
    return mapped === 'before' ? 'Original' : mapped === 'after' ? 'Candidate' : side.toUpperCase()
  }
  const allowedUrls = new Set(Array.isArray(serverView?.allowedArtifactUrls)
    ? serverView.allowedArtifactUrls : [])
  const artifactEntries = Object.entries(serverView?.artifacts ?? {})
    .filter(([, url]) => typeof url === 'string' && allowedUrls.has(url))
    .map(([key, url]) => ({ key, label: titleCase(key), url }))
  const errorCode = typeof state?.error?.code === 'string' ? state.error.code : null
  const errorCopy = errorCode === 'project_exists'
    ? 'The target project already exists. Choose a new target id.'
    : errorCode ? `Quality Gate stopped · ${errorCode}` : null
  const evidence = {
    expectedImprovement: classification?.expectedImprovement ?? 'Unavailable — case authority is not loaded',
    integrity: `Non-target ${yesNo(integrity?.non_target_equal)} · outside mask ${yesNo(integrity?.target_outside_mask_equal)} · changed ${scalar(integrity?.actual_outside_mask_changed)}`,
    validator: `Status ${titleCase(validation?.status)} · blocking ${list(validation?.blocking_errors)}`,
    geometry: evidenceValue(metrics?.bbox_anchor_baseline ?? metrics?.geometry ?? quality?.geometry),
    halo: evidenceValue(metrics?.halo ?? quality?.halo),
    component: evidenceValue(metrics?.component ?? quality?.component),
    continuity: evidenceValue(metrics?.continuity ?? quality?.continuity),
    diagnostic: diagnostic.code ? `${titleCase(diagnostic.code)} · ${diagnostic.detail}` : diagnostic.detail,
  }
  const actions = {
    setup: { enabled: setupEnabled, reason: setupEnabled ? null : setupBaseReason ?? 'Select exactly six assets and confirm ownership' },
    authorCase: { enabled: phase === 'authoring', reason: phase === 'authoring' ? null : 'Setup must finish first' },
    preflight: { enabled: phase === 'authoring', reason: phase === 'authoring' ? null : 'Authoring must be active' },
    plan: { enabled: ui?.validateEnabled === true, reason: ui?.validateEnabled ? null : providerReady ? 'Complete all eight case definitions' : 'A configured eligible preset is required' },
    start: { enabled: ui?.startEnabled === true, reason: ui?.startEnabled ? null : 'Seal a current provider-free Plan first' },
    prepareCase: { enabled: view === 'review' && !['paused', 'finalized'].includes(phase), reason: phase === 'paused' ? 'The session is paused' : null },
    planCase: { enabled: state?.activeCaseStage === 'locked', reason: 'Prepare the locked case first' },
    generate: { enabled: ui?.generateEnabled === true, reason: ui?.generateEnabled ? null : 'A confirmed one-call Frame Repair Plan is required' },
    blind: { enabled: desktopReviewAllowed && ui?.blindReviewEnabled === true, reason: mobileReason ?? 'A reviewable candidate is required' },
    reveal: { enabled: desktopReviewAllowed && ui?.revealEnabled === true, reason: mobileReason ?? 'Record the blind preference first' },
    sealReview: { enabled: desktopReviewAllowed && ui?.sealReviewEnabled === true, reason: mobileReason ?? 'Complete the revealed functional verdict' },
    accept: { enabled: desktopReviewAllowed && ui?.acceptEnabled === true, reason: mobileReason ?? 'Seal the human review first' },
    reject: { enabled: desktopReviewAllowed && ui?.rejectEnabled === true, reason: mobileReason ?? 'Seal the human review first' },
    recoverOperation: { enabled: ui?.recoverEnabled === true, reason: 'Recovery is available only for the original unknown operation' },
    recordBlocked: { enabled: ['provider_blocked', 'quality_blocked'].includes(activeCase?.status), reason: 'No controlled blocked outcome is ready to record' },
    recoverOutcome: { enabled: ui?.outcomeRecoveryEnabled === true, reason: 'No pending accepted outcome needs recovery' },
    finalize: { enabled: ui?.finalizeEnabled === true, reason: 'A running, paused, or reviewing session is required' },
  }
  const announcement = errorCopy ?? (phase === 'paused'
    ? `Quality Gate paused · ${scalar(session?.blockingReason, 'controlled safety stop')}`
    : view === 'summary' ? `Quality Gate finalized · ${titleCase(decision?.result)}`
      : view === 'review' ? `Case ${activeIndex + 1} · ${titleCase(activeCase?.status)}`
        : phase === 'authoring' ? 'Case definitions are not saved until Start' : 'Quality Gate setup')
  return freeze({
    view,
    phase,
    desktopReviewAllowed,
    mobileReason,
    setup: {
      projectAvailable: Boolean(project), eligibleAssets, selectedAssetIds,
      ownershipConfirmed: state?.ownershipConfirmed === true,
      targetProjectId: state?.setup?.projectId ?? '',
      targetProjectName: state?.setup?.projectName ?? 'Frame Repair Quality Gate',
      setupManifestAvailable: Boolean(state?.setup?.setupManifestSha256),
      authoredCases: Math.max(0, (Array.isArray(state?.cases) ? state.cases.length : 0) - 2),
      nextAuthorCaseId,
      providerReady,
      providerPresetId: state?.providerPreflight?.providerPresetId ?? session?.providerPresetId ?? null,
      planHashAvailable: Boolean(state?.plan?.session_plan_hash),
      authoringWarning: ui?.authoringWarning ?? null,
      busy: setupBusy,
      error: errorCopy,
    },
    session: {
      caseIndex: activeIndex + 1,
      preset: session?.providerPresetId ?? state?.plan?.provider?.preset_id ?? 'Not locked',
      callsUsed: session?.callsUsed ?? 0,
      callsMaximum: (session?.callsUsed ?? 0) + (session?.callsRemaining ?? 8),
      difficulty: classification?.difficulty ?? 'Unavailable',
      hardGateStatus,
      status: session?.status ?? phase,
      blockingReason: session?.blockingReason ?? null,
    },
    comparison: {
      ready: comparisonReady,
      revealed,
      labelA: labelFor('a'),
      labelB: labelFor('b'),
      modeA: blind?.a === 'after' ? 'after' : 'before',
      modeB: blind?.b === 'before' ? 'before' : 'after',
      description: revealed ? 'Mapping revealed after the blind preference was recorded.' : 'Blind comparison. Choose A or B before revealing the mapping.',
      neighbor: frameRepair?.neighborContext ?? activeCase?.neighborContext ?? null,
    },
    evidence,
    actions,
    progress,
    activeCaseId,
    report: decision ? {
      result: decision?.result ?? 'evidence_insufficient',
      successful: decision?.successful_candidates ?? 0,
      completed: decision?.completed_candidates ?? 0,
      required: decision?.required_successes ?? 0,
      rate: decision?.improvement_rate ?? 0,
      callsUsed: decision?.calls_used ?? session?.callsUsed ?? 0,
      callsMaximum: (decision?.calls_used ?? 0) + (decision?.calls_remaining ?? 0),
      accepted: decision?.accepted ?? 0,
      rejected: decision?.rejected ?? 0,
      providerBlocked: decision?.provider_blocked ?? 0,
      unresolved: decision?.unresolved ?? 0,
      failureDomain: decision?.failure_domain ?? null,
      difficulty: Array.isArray(report?.breakdown?.difficulty) ? report.breakdown.difficulty : [],
      category: Array.isArray(report?.breakdown?.category) ? report.breakdown.category : [],
      hardGateReasons: Array.isArray(report?.taxonomy?.hard_gate_reasons) ? report.taxonomy.hard_gate_reasons : [],
      providerReasons: Array.isArray(report?.taxonomy?.controlled_provider_reasons) ? report.taxonomy.controlled_provider_reasons : [],
    } : null,
    artifacts: artifactEntries,
    announcement,
  })
}

export function createFrameRepairQualityGatePanel({
  documentRef = document,
  onAction = () => {},
  announce = () => {},
} = {}) {
  if (!documentRef?.createElement || typeof onAction !== 'function' || typeof announce !== 'function') {
    throw new TypeError('Frame Repair Quality Gate panel dependencies are invalid')
  }

  const element = node(documentRef, 'section', 'editor-frame-repair-quality-gate')
  element.setAttribute('aria-label', 'Frame Repair Quality Gate')
  element.dataset.view = 'setup'
  const live = node(documentRef, 'p', 'editor-quality-gate-live')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')

  const setup = node(documentRef, 'section', 'editor-quality-gate-setup')
  setup.setAttribute('aria-label', 'Quality Gate setup')
  const setupHeader = node(documentRef, 'header', 'editor-quality-gate-setup-header')
  setupHeader.append(node(documentRef, 'h2', '', 'Frame Repair Quality Gate'))
  const exitSetup = node(documentRef, 'button', 'secondary', 'Exit Quality Gate')
  exitSetup.type = 'button'
  setupHeader.append(exitSetup)
  const setupStatus = node(documentRef, 'p', 'editor-quality-gate-setup-status')
  const assetsLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  assetsLabel.append(node(documentRef, 'span', '', 'Select exactly six Character Packs'))
  const assets = node(documentRef, 'select')
  assets.multiple = true
  assets.dataset.qualityGateControl = 'source-assets'
  assetsLabel.append(assets)
  const ownershipLabel = node(documentRef, 'label', 'editor-quality-gate-ownership')
  const ownership = node(documentRef, 'input')
  ownership.type = 'checkbox'
  ownership.dataset.qualityGateControl = 'ownership'
  ownershipLabel.append(ownership, node(documentRef, 'span', '', 'I confirm I own or may use these six inputs for this local quality gate.'))
  const targetIdLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  targetIdLabel.append(node(documentRef, 'span', '', 'New isolated project id'))
  const targetId = node(documentRef, 'input')
  targetId.type = 'text'
  targetId.dataset.qualityGateControl = 'target-id'
  targetIdLabel.append(targetId)
  const targetNameLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  targetNameLabel.append(node(documentRef, 'span', '', 'New isolated project name'))
  const targetName = node(documentRef, 'input')
  targetName.type = 'text'
  targetName.dataset.qualityGateControl = 'target-name'
  targetNameLabel.append(targetName)
  const expectedImprovementLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  expectedImprovementLabel.append(node(documentRef, 'span', '', 'Expected improvement for the next case'))
  const expectedImprovement = node(documentRef, 'textarea')
  expectedImprovement.rows = 3
  expectedImprovement.maxLength = 500
  expectedImprovement.dataset.qualityGateControl = 'expected-improvement'
  expectedImprovementLabel.append(expectedImprovement)
  const setupActions = node(documentRef, 'div', 'editor-quality-gate-setup-actions')

  const sessionBar = node(documentRef, 'header', 'editor-quality-gate-session')
  const sessionTitle = node(documentRef, 'h2', '', 'Focused Frame Repair review')
  const sessionFacts = node(documentRef, 'p', 'editor-quality-gate-session-facts')
  const exitReview = node(documentRef, 'button', 'secondary', 'Exit Quality Gate')
  exitReview.type = 'button'
  sessionBar.append(sessionTitle, sessionFacts, exitReview)

  const canvas = node(documentRef, 'section', 'editor-quality-gate-canvas')
  canvas.setAttribute('aria-label', 'Focused comparison canvas')
  const comparisonDescription = node(documentRef, 'p', 'editor-quality-gate-comparison-description')
  const comparisonControls = node(documentRef, 'div', 'editor-quality-gate-comparison-controls')
  const viewA = node(documentRef, 'button', 'secondary', 'A')
  const viewB = node(documentRef, 'button', 'secondary', 'B')
  const split = node(documentRef, 'button', 'secondary', 'Split')
  const difference = node(documentRef, 'button', 'secondary', 'Difference')
  const onion = node(documentRef, 'button', 'secondary', 'Onion')
  for (const control of [viewA, viewB, split, difference, onion]) control.type = 'button'
  comparisonControls.append(viewA, viewB, split, difference, onion)
  const canvasSlot = node(documentRef, 'div', 'editor-quality-gate-canvas-slot')
  canvasSlot.setAttribute('aria-label', 'Existing Repair Workbench Canvas')
  const neighbor = node(documentRef, 'p', 'editor-quality-gate-neighbor')
  canvas.append(comparisonDescription, comparisonControls, canvasSlot, neighbor)

  const evidence = node(documentRef, 'aside', 'editor-quality-gate-evidence')
  evidence.setAttribute('aria-label', 'Automated evidence and review actions')
  const evidenceScroll = node(documentRef, 'div', 'editor-quality-gate-evidence-scroll')
  evidenceScroll.append(node(documentRef, 'h3', '', 'Evidence'))
  const evidenceRows = new Map()
  for (const [key, label] of [
    ['expectedImprovement', 'Expected improvement'],
    ['integrity', 'Pixel integrity'],
    ['validator', 'Validator'],
    ['geometry', 'BBox / anchor / baseline'],
    ['halo', 'Halo'],
    ['component', 'Component'],
    ['continuity', 'Continuity'],
    ['diagnostic', 'Safe provider diagnostic'],
  ]) {
    const row = node(documentRef, 'section', 'editor-quality-gate-evidence-row')
    row.dataset.evidence = key
    row.append(node(documentRef, 'h4', '', label))
    const value = node(documentRef, 'p')
    row.append(value)
    evidenceScroll.append(row)
    evidenceRows.set(key, value)
  }

  const actionRegion = node(documentRef, 'section', 'editor-quality-gate-actions')
  actionRegion.setAttribute('aria-label', 'Quality Gate actions')
  const blindGroup = node(documentRef, 'div', 'editor-quality-gate-blind-actions')
  const preferA = node(documentRef, 'button', 'secondary', 'Prefer A')
  const preferB = node(documentRef, 'button', 'secondary', 'Prefer B')
  const noDifference = node(documentRef, 'button', 'secondary', 'No material difference')
  const reveal = node(documentRef, 'button', 'secondary', 'Reveal mapping')
  for (const control of [preferA, preferB, noDifference, reveal]) control.type = 'button'
  blindGroup.append(preferA, preferB, noDifference, reveal)

  const improvementLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  improvementLabel.append(node(documentRef, 'span', '', 'Improvement'))
  const improvement = node(documentRef, 'select')
  improvement.append(option(documentRef, '', 'Select'), option(documentRef, 'improved', 'Improved'), option(documentRef, 'same', 'Same'), option(documentRef, 'worse', 'Worse'))
  improvementLabel.append(improvement)
  const usabilityLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  usabilityLabel.append(node(documentRef, 'span', '', 'Usability'))
  const usability = node(documentRef, 'select')
  usability.append(option(documentRef, '', 'Select'), option(documentRef, 'usable', 'Usable'), option(documentRef, 'review_required', 'Review required'), option(documentRef, 'blocked', 'Blocked'))
  usabilityLabel.append(usability)
  const blockerLabel = node(documentRef, 'label', 'editor-quality-gate-blocker')
  const blocker = node(documentRef, 'input')
  blocker.type = 'checkbox'
  blockerLabel.append(blocker, node(documentRef, 'span', '', 'Candidate introduces a new blocking defect'))
  const reasonsLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  reasonsLabel.append(node(documentRef, 'span', '', 'Controlled reason codes'))
  const reasons = node(documentRef, 'select')
  reasons.multiple = true
  reasons.append(...REASON_CODES.map((value) => option(documentRef, value, titleCase(value))))
  reasonsLabel.append(reasons)
  const noteLabel = node(documentRef, 'label', 'editor-quality-gate-field')
  noteLabel.append(node(documentRef, 'span', '', 'Optional local note'))
  const note = node(documentRef, 'textarea')
  note.rows = 3
  note.maxLength = 500
  noteLabel.append(note)
  const decisionActions = node(documentRef, 'div', 'editor-quality-gate-decision-actions')
  const sealReview = node(documentRef, 'button', '', 'Seal review')
  const accept = node(documentRef, 'button', '', 'Accept revision')
  const reject = node(documentRef, 'button', 'secondary', 'Reject candidate')
  const recoverOperation = node(documentRef, 'button', 'secondary', 'Recover original operation')
  const recordBlocked = node(documentRef, 'button', 'secondary', 'Record blocked outcome')
  const recoverOutcome = node(documentRef, 'button', 'secondary', 'Recover accepted outcome')
  const finalize = node(documentRef, 'button', '', 'Finalize report')
  for (const control of [sealReview, accept, reject, recoverOperation, recordBlocked, recoverOutcome, finalize]) control.type = 'button'
  decisionActions.append(sealReview, accept, reject, recoverOperation, recordBlocked, recoverOutcome, finalize)
  actionRegion.append(blindGroup, improvementLabel, usabilityLabel, blockerLabel, reasonsLabel, noteLabel, decisionActions)
  evidence.append(evidenceScroll, actionRegion)

  const progress = node(documentRef, 'nav', 'editor-quality-gate-progress')
  progress.setAttribute('aria-label', 'Eight-case progress')
  const progressButtons = Array.from({ length: 8 }, (_, index) => {
    const control = node(documentRef, 'button', 'editor-quality-gate-progress-item')
    control.type = 'button'
    control.dataset.qualityGateAction = 'select_evidence'
    control.dataset.qualityGateProgressIndex = String(index)
    progress.append(control)
    return control
  })

  const summary = node(documentRef, 'section', 'editor-quality-gate-summary')
  summary.setAttribute('aria-label', 'Final Quality Gate summary')
  const summaryTitle = node(documentRef, 'h2', '', 'Quality Gate result')
  const summaryDecision = node(documentRef, 'p', 'editor-quality-gate-summary-decision')
  const summaryCounts = node(documentRef, 'p', 'editor-quality-gate-summary-counts')
  const summaryBreakdown = node(documentRef, 'div', 'editor-quality-gate-summary-breakdown')
  const artifactLinks = node(documentRef, 'div', 'editor-quality-gate-artifacts')
  const exitSummary = node(documentRef, 'button', 'secondary', 'Exit Quality Gate')
  exitSummary.type = 'button'
  summary.append(summaryTitle, summaryDecision, summaryCounts, summaryBreakdown, artifactLinks, exitSummary)

  element.append(live, setup, sessionBar, canvas, evidence, progress, summary)

  const listeners = []
  const disabledReasons = new Map()
  let currentModel = buildFrameRepairQualityGateViewModel({})
  let destroyed = false
  let rovingIndex = 0
  let lastAnnouncement = ''
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }
  const dispatch = (type, payload) => {
    if (destroyed) return
    if (payload === undefined) onAction(type)
    else onAction(type, payload)
  }
  const click = (control, type, payload = undefined) => {
    control.dataset.qualityGateAction = type
    listen(control, 'click', () => {
      if (!control.disabled) dispatch(type, typeof payload === 'function' ? payload() : payload)
    })
  }
  const reasonNode = (control) => {
    if (disabledReasons.has(control)) return disabledReasons.get(control)
    const value = node(documentRef, 'p', 'editor-quality-gate-disabled-reason')
    const id = `editor-quality-gate-disabled-${disabledReasons.size + 1}`
    value.setAttribute('id', id)
    value.hidden = true
    control.setAttribute('aria-describedby', id)
    control.parentNode?.append(value)
    disabledReasons.set(control, value)
    return value
  }
  const available = (control, enabled, reason, label) => {
    control.disabled = !enabled
    control.setAttribute('aria-disabled', String(!enabled))
    control.title = enabled ? '' : reason ?? 'Unavailable'
    control.setAttribute('aria-label', enabled ? label : `${label}: unavailable (${reason ?? 'Unavailable'})`)
    const value = reasonNode(control)
    value.hidden = enabled
    value.textContent = enabled ? '' : reason ?? 'Unavailable'
  }

  const setupButton = node(documentRef, 'button', '', 'Create isolated project')
  const authorCase = node(documentRef, 'button', 'secondary', 'Author case')
  const preflight = node(documentRef, 'button', 'secondary', 'Check provider preset')
  const plan = node(documentRef, 'button', 'secondary', 'Validate session')
  const start = node(documentRef, 'button', '', 'Start session')
  for (const control of [setupButton, authorCase, preflight, plan, start]) control.type = 'button'
  setupActions.append(setupButton, authorCase, preflight, plan, start)
  setup.append(
    setupHeader, setupStatus, assetsLabel, ownershipLabel, targetIdLabel, targetNameLabel,
    expectedImprovementLabel, setupActions,
  )

  const setupPayload = () => ({
    targetProjectId: targetId.value.trim(),
    targetProjectName: targetName.value.trim(),
    selectedAssetIds: [...assets.selectedOptions].map((item) => item.value),
    ownershipConfirmed: ownership.checked === true,
  })
  click(setupButton, 'setup', setupPayload)
  click(authorCase, 'author_case', () => ({
    caseId: currentModel.setup.nextAuthorCaseId,
    expectedImprovement: expectedImprovement.value.trim(),
  }))
  click(preflight, 'preflight')
  click(plan, 'plan')
  click(start, 'start')
  click(exitSetup, 'exit')
  click(exitReview, 'exit')
  click(exitSummary, 'exit')
  click(viewA, 'set_view', () => ({ mode: currentModel.comparison.modeA }))
  click(viewB, 'set_view', () => ({ mode: currentModel.comparison.modeB }))
  click(split, 'set_view', { mode: 'split' })
  click(difference, 'set_view', { mode: 'difference' })
  click(onion, 'set_view', { mode: 'onion' })
  click(preferA, 'blind', { choice: 'prefer_a' })
  click(preferB, 'blind', { choice: 'prefer_b' })
  click(noDifference, 'blind', { choice: 'no_material_difference' })
  click(reveal, 'reveal')
  click(sealReview, 'seal_review', () => ({
    improvement: improvement.value,
    usability: usability.value,
    newBlockingDefect: blocker.checked === true,
    reasonCodes: [...reasons.selectedOptions].map((item) => item.value),
    note: note.value.trim() || null,
  }))
  click(accept, 'accept')
  click(reject, 'reject')
  click(recoverOperation, 'recover_operation')
  click(recordBlocked, 'record_blocked', () => ({ outcome: currentModel.progress.find((item) => item.active)?.status }))
  click(recoverOutcome, 'recover_outcome')
  click(finalize, 'finalize')
  progressButtons.forEach((control, index) => listen(control, 'click', () => {
    const item = currentModel.progress[index]
    if (control.disabled || !item?.selectable) return
    dispatch('select_evidence', { caseId: item.caseId, url: item.artifactUrl })
  }))

  function updateSetupAvailability() {
    if (currentModel.phase !== 'entry') return
    const selected = [...assets.selectedOptions].length
    const valid = currentModel.setup.projectAvailable && currentModel.setup.eligibleAssets.length >= 6 &&
      selected === 6 && ownership.checked && targetId.value.trim() && targetName.value.trim()
    available(setupButton, Boolean(valid), valid ? null : 'Select exactly six assets, confirm ownership, and name a new target project', 'Create isolated project')
  }
  listen(assets, 'change', updateSetupAvailability)
  listen(ownership, 'change', updateSetupAvailability)
  listen(targetId, 'input', updateSetupAvailability)
  listen(targetName, 'input', updateSetupAvailability)
  const updateAuthorAvailability = () => {
    const enabled = currentModel.actions.authorCase.enabled &&
      Boolean(currentModel.setup.nextAuthorCaseId) && Boolean(expectedImprovement.value.trim())
    available(authorCase, enabled, enabled ? null : currentModel.setup.nextAuthorCaseId
      ? 'Describe the expected improvement before authoring the case'
      : 'All six real cases are authored', 'Author case')
  }
  listen(expectedImprovement, 'input', updateAuthorAvailability)

  listen(progress, 'keydown', (event) => {
    const tag = event.target?.tagName
    if (['INPUT', 'SELECT', 'TEXTAREA', 'CANVAS'].includes(tag)) return
    const control = event.target?.closest?.('[data-quality-gate-progress-index]')
    const index = progressButtons.indexOf(control)
    if (index < 0) return
    const key = event.key
    let next = index
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % 8
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index + 7) % 8
    else if (key === 'Home') next = 0
    else if (key === 'End') next = 7
    else return
    event.preventDefault()
    rovingIndex = next
    progressButtons.forEach((item, itemIndex) => { item.tabIndex = itemIndex === rovingIndex ? 0 : -1 })
    progressButtons[rovingIndex].focus()
    progressButtons[rovingIndex].scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

  function render(input) {
    if (destroyed) return
    currentModel = buildFrameRepairQualityGateViewModel(input)
    element.dataset.view = currentModel.view
    const setupVisible = currentModel.view === 'setup'
    const reviewVisible = currentModel.view === 'review'
    const summaryVisible = currentModel.view === 'summary'
    setup.hidden = !setupVisible
    setup.inert = !setupVisible
    for (const region of [sessionBar, canvas, evidence, progress]) {
      region.hidden = !reviewVisible
      region.inert = !reviewVisible
    }
    summary.hidden = !summaryVisible
    summary.inert = !summaryVisible
    live.textContent = currentModel.announcement
    if (currentModel.announcement !== lastAnnouncement) {
      lastAnnouncement = currentModel.announcement
      announce(currentModel.announcement)
    }

    setupStatus.textContent = currentModel.setup.error ?? (
      currentModel.phase === 'authoring'
        ? `${currentModel.setup.authoredCases} of 6 real cases authored · ${currentModel.setup.authoringWarning ?? 'Not saved until Start'}`
        : currentModel.setup.busy ? 'Creating the isolated project…'
          : `${currentModel.setup.eligibleAssets.length} eligible Character Packs · ${currentModel.setup.providerReady ? 'preset eligible' : 'preset preflight required'}`
    )
    const assetSignature = currentModel.setup.eligibleAssets.map((item) => [item.id, item.name]).join('|')
    if (assets.dataset.signature !== assetSignature) {
      assets.dataset.signature = assetSignature
      assets.replaceChildren(...currentModel.setup.eligibleAssets.map((item) => option(
        documentRef,
        item.id,
        item.name ? `${item.name} · ${item.id}` : item.id,
      )))
    }
    const selectedAssets = new Set(currentModel.setup.selectedAssetIds)
    for (const item of assets.options) item.selected = selectedAssets.has(item.value)
    ownership.checked = currentModel.setup.ownershipConfirmed
    if (documentRef.activeElement !== targetId) targetId.value = currentModel.setup.targetProjectId
    if (documentRef.activeElement !== targetName) targetName.value = currentModel.setup.targetProjectName
    available(setupButton, currentModel.actions.setup.enabled, currentModel.actions.setup.reason, 'Create isolated project')
    expectedImprovementLabel.hidden = currentModel.phase !== 'authoring' || !currentModel.setup.nextAuthorCaseId
    updateAuthorAvailability()
    available(preflight, currentModel.actions.preflight.enabled, currentModel.actions.preflight.reason, 'Check provider preset')
    available(plan, currentModel.actions.plan.enabled, currentModel.actions.plan.reason, 'Validate session')
    available(start, currentModel.actions.start.enabled, currentModel.actions.start.reason, 'Start session')

    sessionFacts.textContent = `Case ${currentModel.session.caseIndex} / 8 · preset ${scalar(currentModel.session.preset)} · calls ${currentModel.session.callsUsed} / ${currentModel.session.callsMaximum} · difficulty ${titleCase(currentModel.session.difficulty)} · hard gate ${titleCase(currentModel.session.hardGateStatus)}`
    comparisonDescription.textContent = currentModel.comparison.description
    viewA.textContent = currentModel.comparison.labelA
    viewB.textContent = currentModel.comparison.labelB
    viewA.setAttribute('aria-label', `Show ${currentModel.comparison.labelA}`)
    viewB.setAttribute('aria-label', `Show ${currentModel.comparison.labelB}`)
    available(viewA, currentModel.comparison.ready, 'A candidate comparison is not loaded', `Show ${currentModel.comparison.labelA}`)
    available(viewB, currentModel.comparison.ready, 'A candidate comparison is not loaded', `Show ${currentModel.comparison.labelB}`)
    for (const [control, label] of [[split, 'Split'], [difference, 'Difference'], [onion, 'Onion']]) {
      available(control, currentModel.comparison.ready && currentModel.comparison.revealed,
        currentModel.comparison.revealed ? 'A candidate comparison is not loaded' : 'Reveal the blind mapping first', label)
    }
    const neighborValue = currentModel.comparison.neighbor
    neighbor.textContent = neighborValue
      ? `Neighbor context · previous ${evidenceValue(neighborValue.previous)} · next ${evidenceValue(neighborValue.next)}`
      : 'Neighbor context · unavailable'
    for (const [key, value] of evidenceRows) value.textContent = currentModel.evidence[key]

    for (const [control, label] of [[preferA, 'Prefer A'], [preferB, 'Prefer B'], [noDifference, 'No material difference']]) {
      available(control, currentModel.actions.blind.enabled, currentModel.actions.blind.reason, label)
    }
    available(reveal, currentModel.actions.reveal.enabled, currentModel.actions.reveal.reason, 'Reveal mapping')
    const functionalEnabled = currentModel.desktopReviewAllowed && currentModel.comparison.revealed
    for (const [control, label] of [[improvement, 'Improvement'], [usability, 'Usability'], [blocker, 'New blocking defect'], [reasons, 'Controlled reason codes'], [note, 'Optional local note']]) {
      available(control, functionalEnabled, currentModel.mobileReason ?? 'Reveal the blind mapping first', label)
    }
    available(sealReview, currentModel.actions.sealReview.enabled, currentModel.actions.sealReview.reason, 'Seal review')
    available(accept, currentModel.actions.accept.enabled, currentModel.actions.accept.reason, 'Accept revision')
    available(reject, currentModel.actions.reject.enabled, currentModel.actions.reject.reason, 'Reject candidate')
    available(recoverOperation, currentModel.actions.recoverOperation.enabled, currentModel.actions.recoverOperation.reason, 'Recover original operation')
    available(recordBlocked, currentModel.actions.recordBlocked.enabled, currentModel.actions.recordBlocked.reason, 'Record blocked outcome')
    available(recoverOutcome, currentModel.actions.recoverOutcome.enabled, currentModel.actions.recoverOutcome.reason, 'Recover accepted outcome')
    available(finalize, currentModel.actions.finalize.enabled, currentModel.actions.finalize.reason, 'Finalize report')

    const requestedRoving = currentModel.progress.findIndex((item) => item.active)
    if (requestedRoving >= 0 && !progressButtons.some((item) => documentRef.activeElement === item)) rovingIndex = requestedRoving
    currentModel.progress.forEach((item, index) => {
      const control = progressButtons[index]
      control.tabIndex = index === rovingIndex ? 0 : -1
      control.dataset.status = item.status
      if (item.active) control.setAttribute('aria-current', 'step')
      else control.removeAttribute('aria-current')
      control.textContent = `${item.icon} ${item.label} · ${titleCase(item.status)}${item.visualResult ? ` · ${item.visualResult}` : ''}${item.outcomeLabel ? ` · ${titleCase(item.outcomeLabel)}` : ''}`
      control.disabled = false
      control.setAttribute('aria-disabled', String(!item.selectable))
      control.title = item.selectable ? 'Open sealed evidence' : 'Case evidence is not sealed'
    })

    const report = currentModel.report
    summaryDecision.textContent = report
      ? `${titleCase(report.result)} · ${report.successful} / ${report.completed} successful · required ${report.required} · rate ${report.rate}`
      : 'Final evidence is unavailable.'
    summaryCounts.textContent = report
      ? `Calls ${report.callsUsed} / ${report.callsMaximum} · accepted ${report.accepted} · rejected ${report.rejected} · provider blocked ${report.providerBlocked} · unresolved ${report.unresolved} · failure domain ${scalar(report.failureDomain, 'none')}`
      : ''
    summaryBreakdown.replaceChildren()
    if (report) {
      for (const [label, rows] of [['Difficulty', report.difficulty], ['Category', report.category]]) {
        const section = node(documentRef, 'section')
        section.append(node(documentRef, 'h3', '', `${label} breakdown`))
        section.append(node(documentRef, 'p', '', rows.length
          ? rows.map((item) => `${titleCase(item.key)} ${item.successful}/${item.completed} (${item.planned} planned)`).join(' · ')
          : 'No breakdown evidence'))
        summaryBreakdown.append(section)
      }
      const taxonomy = node(documentRef, 'section')
      taxonomy.append(node(documentRef, 'h3', '', 'Controlled taxonomy'))
      taxonomy.append(node(documentRef, 'p', '', `Hard gates ${report.hardGateReasons.map((item) => `${item.code} ${item.count}`).join(', ') || 'none'} · Provider ${report.providerReasons.map((item) => `${item.code} ${item.count}`).join(', ') || 'none'}`))
      summaryBreakdown.append(taxonomy)
    }
    artifactLinks.replaceChildren()
    for (const item of currentModel.artifacts) {
      const link = node(documentRef, 'a', 'editor-quality-gate-artifact-link', item.label)
      link.setAttribute('href', item.url)
      artifactLinks.append(link)
    }
  }

  function focusPrimary() {
    const controls = currentModel.view === 'setup'
      ? [setupButton, authorCase, preflight, plan, start, exitSetup]
      : currentModel.view === 'summary'
        ? [exitSummary]
        : [preferA, preferB, noDifference, reveal, sealReview, accept, reject, recoverOperation, recoverOutcome, finalize, exitReview]
    controls.find((control) => !control.disabled && !control.hidden)?.focus()
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    for (const remove of listeners.splice(0)) remove()
  }

  return Object.freeze({ element, canvasSlot, render, focusPrimary, destroy })
}
