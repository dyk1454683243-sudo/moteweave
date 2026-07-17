const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed',
  'failed_quality_gate',
  'failed_project_pack',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])

const SELECTION_KEYS = Object.freeze([
  'projectId',
  'projectRevision',
  'assetId',
  'revisionId',
  'clipId',
  'clipFramePosition',
  'sheetFrameIndex',
])
const RECOVERY_KEYS = Object.freeze([
  'projectId',
  'assetId',
  'operationId',
  'jobId',
  'planHash',
])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const FRAME_REPAIR_RECOVERY_STORAGE_KEY = 'gametool.editor.frame-repair.recovery.v1'

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  )
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function sameSelection(left, right) {
  return Boolean(left && right) && SELECTION_KEYS.every((key) => left[key] === right[key])
}

function validScopedId(value) {
  return typeof value === 'string' && value.length <= 120 && ID_PATTERN.test(value)
}

function validJobId(value) {
  return value === null || validScopedId(value)
}

function validRecoveryHandle(value) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.length !== RECOVERY_KEYS.length ||
      keys.some((key, index) => key !== [...RECOVERY_KEYS].sort()[index])) return false
  return validScopedId(value.projectId) &&
    validScopedId(value.assetId) &&
    typeof value.operationId === 'string' && OPERATION_ID_PATTERN.test(value.operationId) &&
    validJobId(value.jobId) &&
    typeof value.planHash === 'string' && SHA256_PATTERN.test(value.planHash)
}

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function defaultOperationId() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return `fr_${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function uncertainTransport(error) {
  return error?.name !== 'AbortError' &&
    (!Number.isInteger(error?.status) || error.status >= 500)
}

function withOperationId(payload, operationId) {
  const request = clone(payload) ?? {}
  if (isPlainObject(request.body)) {
    request.body = { ...request.body, operationId }
  } else {
    request.operationId = operationId
  }
  return request
}

function requestPlanHash(payload, fallback) {
  return payload?.body?.expectedPlanHash ?? payload?.expectedPlanHash ?? fallback
}

function requestScope(payload, selection) {
  return {
    projectId: payload?.projectId ?? selection?.projectId,
    assetId: payload?.assetId ?? selection?.assetId,
  }
}

function acceptOperationKey(selection, payload) {
  return JSON.stringify([
    ...SELECTION_KEYS.map((key) => selection?.[key] ?? null),
    payload?.projectId ?? null,
    payload?.assetId ?? null,
    payload?.jobId ?? null,
    payload?.body?.expectedRevision ?? payload?.expectedRevision ?? null,
    payload?.body?.expectedAssetRevisionId ?? payload?.expectedAssetRevisionId ?? null,
    payload?.body?.expectedPlanHash ?? payload?.expectedPlanHash ?? null,
    (payload?.body?.warningConfirmed ?? payload?.warningConfirmed) === true,
  ])
}

function assertDependencies(dependencies) {
  for (const key of ['plan', 'generate', 'recover', 'fetchJob', 'accept']) {
    if (typeof dependencies[key] !== 'function') {
      throw new TypeError(`Frame Repair lifecycle ${key} dependency is required`)
    }
  }
}

export function createFrameRepairLifecycle(dependencies = {}) {
  assertDependencies(dependencies)
  const {
    plan: submitPlan,
    generate: submitGeneration,
    recover: recoverOperation,
    fetchJob,
    accept: submitAccept,
    storage = defaultStorage(),
    createOperationId = defaultOperationId,
    schedule = (callback) => setTimeout(callback, 500),
    cancel = clearTimeout,
    onUpdate = () => {},
    onLateAccept = () => {},
  } = dependencies

  let selection = null
  let selectionToken = 0
  let planGeneration = 0
  let liveGeneration = 0
  let acceptGeneration = 0
  let currentPlanHash = null
  let activePlanGeneration = null
  let consumedPlanGeneration = null
  let planController = null
  let liveController = null
  let pollWait = null
  let currentLivePromise = null
  const acceptOperations = new Map()

  function removeRecoveryHandle() {
    try {
      storage?.removeItem?.(FRAME_REPAIR_RECOVERY_STORAGE_KEY)
    } catch {
      // Session storage is optional; storage failures never broaden the request.
    }
  }

  function readRecoveryHandle() {
    let raw
    try {
      raw = storage?.getItem?.(FRAME_REPAIR_RECOVERY_STORAGE_KEY)
    } catch {
      return null
    }
    if (raw == null) return null
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      removeRecoveryHandle()
      return null
    }
    if (!validRecoveryHandle(value)) {
      removeRecoveryHandle()
      return null
    }
    return clone(value)
  }

  function writeRecoveryHandle(value) {
    if (!validRecoveryHandle(value)) return false
    try {
      storage?.setItem?.(FRAME_REPAIR_RECOVERY_STORAGE_KEY, JSON.stringify({
        projectId: value.projectId,
        assetId: value.assetId,
        operationId: value.operationId,
        jobId: value.jobId,
        planHash: value.planHash,
      }))
      return true
    } catch {
      return false
    }
  }

  function current(token, expectedSelection = selection) {
    return token === selectionToken && sameSelection(expectedSelection, selection)
  }

  function currentLive(token, generation, expectedSelection) {
    return current(token, expectedSelection) && generation === liveGeneration
  }

  function clearPollWait() {
    if (!pollWait) return
    const wait = pollWait
    pollWait = null
    if (wait.timer != null) cancel(wait.timer)
    wait.resolve(false)
  }

  function waitForPoll() {
    return new Promise((resolvePromise) => {
      let settled = false
      const wait = {
        timer: null,
        resolve(ready) {
          if (settled) return
          settled = true
          if (pollWait === wait) pollWait = null
          resolvePromise(ready)
        },
      }
      pollWait = wait
      const timer = schedule(() => wait.resolve(true))
      if (pollWait === wait) wait.timer = timer
      else if (timer != null) cancel(timer)
    })
  }

  function abortPlan() {
    planController?.abort()
    planController = null
  }

  function abortLiveObservation() {
    liveController?.abort()
    liveController = null
    clearPollWait()
    currentLivePromise = null
  }

  function setSelection(next) {
    if (sameSelection(selection, next)) return selectionToken
    const previous = selection
    selectionToken += 1
    planGeneration += 1
    liveGeneration += 1
    acceptGeneration += 1
    abortPlan()
    abortLiveObservation()
    selection = clone(next)
    currentPlanHash = null
    activePlanGeneration = null
    consumedPlanGeneration = null
    onUpdate({
      type: previous ? 'selection_switched' : 'selection_set',
      selection: clone(selection),
      selectionToken,
    })
    return selectionToken
  }

  function invalidatePlan(reason = 'edited') {
    planGeneration += 1
    liveGeneration += 1
    abortPlan()
    abortLiveObservation()
    currentPlanHash = null
    activePlanGeneration = null
    consumedPlanGeneration = null
    onUpdate({ type: 'plan_invalidated', reason, planGeneration })
    return planGeneration
  }

  function plan(payload) {
    const token = selectionToken
    const expectedSelection = clone(selection)
    const generation = ++planGeneration
    abortPlan()
    const controller = new AbortController()
    planController = controller
    currentPlanHash = null
    activePlanGeneration = null
    onUpdate({ type: 'planning', planGeneration: generation })

    return (async () => {
      try {
        const result = await submitPlan(clone(payload), { signal: controller.signal })
        if (!current(token, expectedSelection) || generation !== planGeneration) return null
        currentPlanHash = typeof result?.plan_hash === 'string' && SHA256_PATTERN.test(result.plan_hash)
          ? result.plan_hash
          : null
        activePlanGeneration = currentPlanHash ? generation : null
        consumedPlanGeneration = null
        onUpdate({ type: 'planned', plan: result, planGeneration: generation })
        return result
      } catch (error) {
        if (error?.name !== 'AbortError' && current(token, expectedSelection) && generation === planGeneration) {
          onUpdate({ type: 'error', phase: 'plan', error })
        }
        return null
      } finally {
        if (planController === controller) planController = null
      }
    })()
  }

  function jobMatchesOperation(value, {
    operationId,
    planHash,
    scope,
    expectedSelection,
  }) {
    return isPlainObject(value) && validScopedId(value.id) &&
      value.project_id === scope.projectId &&
      value.asset_id === scope.assetId &&
      value.parent_revision_id === expectedSelection.revisionId &&
      value.operation_id === operationId &&
      value.plan_hash === planHash
  }

  async function pollJob({
    initialJob,
    jobId,
    operationId,
    planHash,
    token,
    generation,
    expectedSelection,
    signal,
  }) {
    let currentJob = { ...initialJob, id: jobId }
    while (
      currentLive(token, generation, expectedSelection) &&
      !TERMINAL_JOB_STATUSES.has(currentJob.status) &&
      currentJob.recovery_state !== 'outcome_unknown'
    ) {
      if (!await waitForPoll()) return null
      let next
      try {
        next = await fetchJob(jobId, { signal })
      } catch (error) {
        if (error?.name !== 'AbortError' && currentLive(token, generation, expectedSelection)) {
          onUpdate({ type: 'error', phase: 'poll', error })
        }
        return null
      }
      if (!currentLive(token, generation, expectedSelection)) return null
      if (!isPlainObject(next) ||
          (next.project_id != null && next.project_id !== expectedSelection.projectId) ||
          (next.asset_id != null && next.asset_id !== expectedSelection.assetId) ||
          (next.parent_revision_id != null && next.parent_revision_id !== expectedSelection.revisionId) ||
          (next.operation_id != null && next.operation_id !== operationId) ||
          (next.plan_hash != null && next.plan_hash !== planHash)) {
        onUpdate({
          type: 'error',
          phase: 'poll',
          error: Object.assign(new Error('frame repair job identity changed'), { code: 'identity_mismatch' }),
        })
        return null
      }
      currentJob = { ...currentJob, ...next, id: jobId }
      onUpdate({ type: 'job', job: clone(currentJob), source: 'poll' })
    }
    if (!currentLive(token, generation, expectedSelection)) return null
    if (currentJob.recovery_state === 'outcome_unknown') {
      onUpdate({ type: 'outcome_unknown', job: clone(currentJob) })
    }
    return currentJob
  }

  async function adoptJob({
    value,
    expectedJobId = null,
    operationId,
    planHash,
    scope,
    token,
    generation,
    expectedSelection,
    signal,
    source,
  }) {
    if (!jobMatchesOperation(value, {
      operationId,
      planHash,
      scope,
      expectedSelection,
    }) ||
        (expectedJobId && value.id !== expectedJobId)) {
      if (currentLive(token, generation, expectedSelection)) {
        onUpdate({
          type: 'error',
          phase: source,
          error: Object.assign(new Error('frame repair operation identity changed'), { code: 'identity_mismatch' }),
        })
      }
      return null
    }
    if (!currentLive(token, generation, expectedSelection)) return null
    const jobId = expectedJobId ?? value.id
    const currentJob = { ...value, id: jobId }
    writeRecoveryHandle({ ...scope, operationId, jobId, planHash })
    onUpdate({ type: 'job', job: clone(currentJob), source })
    if (currentJob.recovery_state === 'outcome_unknown') {
      onUpdate({ type: 'outcome_unknown', job: clone(currentJob) })
      return currentJob
    }
    if (TERMINAL_JOB_STATUSES.has(currentJob.status)) return currentJob
    return pollJob({
      initialJob: currentJob,
      jobId,
      operationId,
      planHash,
      token,
      generation,
      expectedSelection,
      signal,
    })
  }

  function generate(payload) {
    if (currentLivePromise) return currentLivePromise
    const planHash = requestPlanHash(payload, currentPlanHash)
    if (!currentPlanHash || planHash !== currentPlanHash || !SHA256_PATTERN.test(planHash ?? '') ||
        activePlanGeneration == null || consumedPlanGeneration === activePlanGeneration) {
      onUpdate({
        type: 'error',
        phase: 'generate',
        error: Object.assign(new Error('Frame Repair Plan is missing or stale'), { code: 'stale_plan' }),
      })
      return Promise.resolve(null)
    }
    const scope = requestScope(payload, selection)
    const suppliedOperationId = payload?.operationId
    const operationId = typeof suppliedOperationId === 'string' &&
      OPERATION_ID_PATTERN.test(suppliedOperationId)
      ? suppliedOperationId
      : createOperationId()
    if (!validScopedId(scope.projectId) || !validScopedId(scope.assetId) ||
        typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) {
      onUpdate({
        type: 'error',
        phase: 'generate',
        error: Object.assign(new Error('Frame Repair operation identity is invalid'), { code: 'invalid_operation_identity' }),
      })
      return Promise.resolve(null)
    }

    const token = selectionToken
    const expectedSelection = clone(selection)
    const generation = ++liveGeneration
    abortLiveObservation()
    const controller = new AbortController()
    liveController = controller
    consumedPlanGeneration = activePlanGeneration
    const request = withOperationId(payload, operationId)
    writeRecoveryHandle({ ...scope, operationId, jobId: null, planHash })
    onUpdate({ type: 'generation_started', operationId, planHash, liveGeneration: generation })

    const operation = (async () => {
      let result
      let source = 'generate'
      try {
        try {
          result = await submitGeneration(request, { signal: controller.signal })
        } catch (error) {
          if (!currentLive(token, generation, expectedSelection) || error?.name === 'AbortError') return null
          if (!uncertainTransport(error)) {
            onUpdate({ type: 'error', phase: 'generate', error, outcomeUnknown: false })
            return null
          }
          source = 'recovery'
          try {
            result = await recoverOperation({ ...scope, operationId }, { signal: controller.signal })
          } catch (recoveryError) {
            if (!currentLive(token, generation, expectedSelection) || recoveryError?.name === 'AbortError') return null
            const controlledNotFound = recoveryError?.status === 404 &&
              recoveryError?.code === 'operation_not_found'
            onUpdate({
              type: 'error',
              phase: 'recovery',
              error: recoveryError,
              outcomeUnknown: !controlledNotFound,
              controlledNotFound,
            })
            return null
          }
        }
        return await adoptJob({
          value: result,
          operationId,
          planHash,
          scope,
          token,
          generation,
          expectedSelection,
          signal: controller.signal,
          source,
        })
      } finally {
        if (liveController === controller) liveController = null
      }
    })()
    let tracked
    tracked = operation.finally(() => {
      if (currentLivePromise === tracked) currentLivePromise = null
    })
    currentLivePromise = tracked
    return tracked
  }

  function recoverFromSession() {
    if (currentLivePromise) return currentLivePromise
    const handle = readRecoveryHandle()
    if (!handle || !selection ||
        selection.projectId !== handle.projectId || selection.assetId !== handle.assetId) {
      return Promise.resolve(null)
    }
    const token = selectionToken
    const expectedSelection = clone(selection)
    const generation = ++liveGeneration
    abortLiveObservation()
    const controller = new AbortController()
    liveController = controller
    currentPlanHash = handle.planHash
    onUpdate({ type: 'recovery_started', handle: clone(handle), liveGeneration: generation })

    const operation = (async () => {
      try {
        let result
        try {
          result = await recoverOperation({
            projectId: handle.projectId,
            assetId: handle.assetId,
            operationId: handle.operationId,
          }, { signal: controller.signal })
        } catch (error) {
          if (!currentLive(token, generation, expectedSelection) || error?.name === 'AbortError') return null
          const controlledNotFound = error?.status === 404 && error?.code === 'operation_not_found'
          onUpdate({
            type: 'error',
            phase: 'recovery',
            error,
            outcomeUnknown: !controlledNotFound,
            controlledNotFound,
          })
          return null
        }
        return await adoptJob({
          value: result,
          expectedJobId: handle.jobId,
          operationId: handle.operationId,
          planHash: handle.planHash,
          scope: { projectId: handle.projectId, assetId: handle.assetId },
          token,
          generation,
          expectedSelection,
          signal: controller.signal,
          source: 'recovery',
        })
      } finally {
        if (liveController === controller) liveController = null
      }
    })()
    let tracked
    tracked = operation.finally(() => {
      if (currentLivePromise === tracked) currentLivePromise = null
    })
    currentLivePromise = tracked
    return tracked
  }

  function accept(payload, { deferProjectAdoption = false } = {}) {
    const token = selectionToken
    const expectedSelection = clone(selection)
    const request = clone(payload)
    if (isPlainObject(request?.body)) {
      request.body.warningConfirmed = request.body.warningConfirmed === true
    } else if (request) {
      request.warningConfirmed = request.warningConfirmed === true
    }
    const operationKey = acceptOperationKey(expectedSelection, request)
    if (acceptOperations.has(operationKey)) return acceptOperations.get(operationKey)
    const generation = ++acceptGeneration
    onUpdate({ type: 'accepting', acceptGeneration: generation })

    const operation = (async () => {
      try {
        const result = await submitAccept(request)
        if (!current(token, expectedSelection) || generation !== acceptGeneration) {
          onLateAccept({ result, selection: expectedSelection, outcomeUnknown: false })
          return null
        }
        removeRecoveryHandle()
        onUpdate({ type: deferProjectAdoption ? 'accepted_deferred' : 'accepted', result })
        return result
      } catch (error) {
        const isCurrent = current(token, expectedSelection) && generation === acceptGeneration
        const outcomeUnknown = uncertainTransport(error)
        if (!isCurrent || outcomeUnknown) {
          onLateAccept({ error, selection: expectedSelection, outcomeUnknown })
        }
        if (isCurrent) onUpdate({ type: 'error', phase: 'accept', error, outcomeUnknown })
        return null
      }
    })()
    let tracked
    tracked = operation.finally(() => {
      if (acceptOperations.get(operationKey) === tracked) acceptOperations.delete(operationKey)
    })
    acceptOperations.set(operationKey, tracked)
    return tracked
  }

  function stop(reason = 'close') {
    const normalizedReason = typeof reason === 'string' ? reason : reason?.reason ?? 'close'
    selectionToken += 1
    planGeneration += 1
    liveGeneration += 1
    acceptGeneration += 1
    abortPlan()
    abortLiveObservation()
    activePlanGeneration = null
    consumedPlanGeneration = null
    if (['accepted', 'discarded', 'not_found_acknowledged'].includes(normalizedReason)) {
      removeRecoveryHandle()
    }
    onUpdate({
      type: normalizedReason === 'teardown' ? 'teardown' : 'stopped',
      reason: normalizedReason,
    })
  }

  function capture() {
    return {
      selection: clone(selection),
      selectionToken,
      planGeneration,
      liveGeneration,
      planHash: currentPlanHash,
      activePlanGeneration,
      consumedPlanGeneration,
      planInFlight: Boolean(planController && !planController.signal.aborted),
      liveInFlight: Boolean(currentLivePromise),
      pollScheduled: Boolean(pollWait),
      acceptOperationCount: acceptOperations.size,
      recoveryHandle: readRecoveryHandle(),
    }
  }

  return Object.freeze({
    setSelection,
    invalidatePlan,
    plan,
    generate,
    recoverFromSession,
    accept,
    stop,
    capture,
  })
}
