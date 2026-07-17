const PHASES = new Set(['entry', 'setup', 'authoring', 'planned', 'running', 'paused', 'reviewing', 'finalized'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/
const OPERATION_ID = /^[A-Za-z0-9_-]{16,80}$/
const SHA256 = /^[a-f0-9]{64}$/
const HANDLE_KEYS = new Set([
  'projectId', 'setupManifestSha256', 'sessionId', 'planHash', 'caseId',
  'operationId', 'jobId', 'acceptedRevisionId', 'projectRevision', 'reviewSha256',
])

export const QUALITY_GATE_RECOVERY_STORAGE_KEY = 'gametool.editor.frameRepairQualityGate.v1'

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function frozen(value) {
  return freeze(clone(value))
}

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype)
}

export function parseFrameRepairQualityGateRecoveryHandle(raw) {
  let value = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return null }
  }
  if (!plain(value) || Object.keys(value).some((key) => !HANDLE_KEYS.has(key)) ||
      !SAFE_ID.test(value.projectId ?? '')) return null
  for (const key of ['setupManifestSha256', 'planHash', 'reviewSha256']) {
    if (value[key] != null && !SHA256.test(value[key])) return null
  }
  for (const key of ['sessionId', 'caseId', 'jobId', 'acceptedRevisionId']) {
    if (value[key] != null && !SAFE_ID.test(value[key])) return null
  }
  if (value.operationId != null && !OPERATION_ID.test(value.operationId)) return null
  if (value.projectRevision != null &&
      (!Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0)) return null
  return frozen(Object.fromEntries(Object.keys(value).map((key) => [key, value[key]])))
}

export function createEmptyFrameRepairQualityGateState() {
  return frozen({
    phase: 'entry',
    generation: 0,
    caseGeneration: 0,
    sourceAssets: [],
    ownershipConfirmed: false,
    providerPreflight: null,
    setup: null,
    cases: [],
    plan: null,
    session: null,
    activeCaseId: null,
    activeCaseStage: null,
    blindChoice: null,
    revealed: false,
    pendingOutcome: null,
    error: null,
    persistenceWarning: null,
  })
}

function validDistribution(cases) {
  if (!Array.isArray(cases) || cases.length !== 8) return false
  const difficulties = { basic: 0, medium: 0, hard: 0 }
  for (const item of cases) {
    if (!item || !Object.hasOwn(difficulties, item.difficulty)) return false
    difficulties[item.difficulty] += 1
  }
  return difficulties.basic === 2 && difficulties.medium === 4 && difficulties.hard === 2
}

export function getFrameRepairQualityGateUiModel(state, { desktopReviewAllowed = true } = {}) {
  const value = clone(state)
  const serverCases = value.session?.cases ?? []
  const active = serverCases.find((item) => item.caseId === value.activeCaseId) ?? null
  const terminal = active && ['accepted', 'rejected', 'provider_blocked', 'quality_blocked'].includes(active.status)
  const providerReady = value.providerPreflight?.available === true &&
    SAFE_ID.test(value.providerPreflight?.providerPresetId ?? '')
  const startReady = Boolean(value.setup?.setupManifestSha256 && value.plan?.session_plan_hash &&
    value.ownershipConfirmed && providerReady && validDistribution(value.cases))
  const currentTerminal = !active || Boolean(terminal)
  const sessionLocked = ['paused', 'finalized'].includes(value.phase)
  return frozen({
    phase: value.phase,
    setupEnabled: value.phase === 'entry' && value.ownershipConfirmed && value.sourceAssets.length === 6,
    validateEnabled: value.phase === 'authoring' && providerReady && validDistribution(value.cases),
    startEnabled: value.phase === 'planned' && startReady,
    generateEnabled: value.phase === 'running' && active?.status === 'pending' &&
      value.activeCaseStage === 'planned',
    recoverEnabled: value.phase === 'paused' && active?.status === 'outcome_unknown',
    blindReviewEnabled: desktopReviewAllowed && value.phase === 'running' &&
      active?.status === 'candidate_ready' && value.activeCaseStage === 'candidate' && !value.blindChoice,
    revealEnabled: desktopReviewAllowed && Boolean(value.blindChoice) && !value.revealed,
    sealReviewEnabled: desktopReviewAllowed && value.phase === 'running' && value.revealed &&
      active?.status === 'candidate_ready' && value.activeCaseStage === 'candidate',
    acceptEnabled: desktopReviewAllowed && value.revealed && active?.status === 'awaiting_decision',
    rejectEnabled: desktopReviewAllowed && value.revealed && active?.status === 'awaiting_decision',
    outcomeRecoveryEnabled: Boolean(value.pendingOutcome),
    finalizeEnabled: ['running', 'paused', 'reviewing'].includes(value.phase),
    desktopDisabledReason: desktopReviewAllowed ? null : 'Desktop pixel inspection is required',
    authoringWarning: value.phase === 'authoring' ? 'Not saved until Start' : null,
    activeCaseTerminal: Boolean(terminal),
    remainingCasesLocked: sessionLocked || !currentTerminal,
    progress: serverCases.map((item, index) => ({
      caseId: item.caseId,
      index,
      status: item.status,
      icon: ['accepted', 'rejected', 'provider_blocked', 'quality_blocked'].includes(item.status) ? '✓' : '•',
      visualResult: item.reviewRecorded ? (item.successfulCandidate ? 'Visual success' : 'Visual not successful') : null,
      outcomeLabel: item.outcome ?? null,
    })),
    persistenceWarning: value.persistenceWarning,
  })
}

export function reduceFrameRepairQualityGateState(state, event) {
  const current = clone(state)
  if (!plain(event) || typeof event.type !== 'string') return frozen(current)
  if (event.generation != null && event.generation !== current.generation) return frozen(current)
  if (event.caseGeneration != null && event.caseGeneration !== current.caseGeneration) return frozen(current)
  const next = { ...current }
  if (event.type === 'phase' && PHASES.has(event.phase)) next.phase = event.phase
  if (event.type === 'reset') return createEmptyFrameRepairQualityGateState()
  if (event.type === 'source_assets') next.sourceAssets = clone(event.assets ?? [])
  if (event.type === 'ownership') next.ownershipConfirmed = event.confirmed === true
  if (event.type === 'provider_preflight') next.providerPreflight = clone(event.value)
  if (event.type === 'setup') { next.setup = clone(event.setup); next.phase = 'authoring' }
  if (event.type === 'cases') { next.cases = clone(event.cases ?? []); next.plan = null }
  if (event.type === 'planned') { next.plan = clone(event.plan); next.phase = 'planned' }
  if (event.type === 'session') {
    next.session = clone(event.session)
    next.phase = event.session?.session?.status === 'finalized'
      ? 'finalized'
      : event.session?.session?.status === 'paused'
        ? 'paused'
        : event.session?.session?.status === 'reviewing' ? 'reviewing' : 'running'
  }
  if (event.type === 'active_case') {
    next.activeCaseId = event.caseId
    next.caseGeneration += 1
    next.blindChoice = null
    next.revealed = false
    next.activeCaseStage = null
  }
  if (event.type === 'case_stage') next.activeCaseStage = event.stage ?? null
  if (event.type === 'blind_choice') next.blindChoice = event.choice
  if (event.type === 'revealed') next.revealed = true
  if (event.type === 'pending_outcome') next.pendingOutcome = clone(event.handle)
  if (event.type === 'error') next.error = clone(event.error)
  if (event.type === 'persistence_warning') next.persistenceWarning = String(event.message ?? '')
  if (event.type === 'invalidate') {
    next.generation += 1
    next.plan = null
    next.session = null
    next.phase = 'authoring'
  }
  return frozen(next)
}
