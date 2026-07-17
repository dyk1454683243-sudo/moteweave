const TERMINAL = new Set([
  'done',
  'failed',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])

function acceptOperationKey(selection, payload) {
  return JSON.stringify([
    selection?.projectId,
    selection?.projectRevision,
    selection?.assetId,
    selection?.revisionId,
    payload?.projectId,
    payload?.assetId,
    payload?.jobId,
    payload?.expectedRevision,
    payload?.expectedAssetRevisionId,
    payload?.expectedRecipeHash,
    payload?.warningConfirmed === true,
  ])
}

function acceptOutcomeIsUnknown(error) {
  return !Number.isInteger(error?.status)
}

export function createRepairPreviewLifecycle({
  buildPreview,
  acceptPreview,
  fetchJob,
  hashDraft,
  schedule = (callback) => setTimeout(callback, 500),
  cancel = clearTimeout,
  onUpdate = () => {},
  onLateAccept = () => {},
  onInvalidate = () => {},
}) {
  let selection = null
  let selectionToken = 0
  let buildGeneration = 0
  let acceptGeneration = 0
  let draftHashGeneration = 0
  let pollWait = null
  let buildController = null
  const acceptOperations = new Map()

  const sameSelection = (left, right) => Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
  const current = (token, expected = selection) => token === selectionToken && sameSelection(expected, selection)
  const currentBuild = (token, generation, expected = selection) => current(token, expected) && generation === buildGeneration

  function clearPollWait() {
    if (!pollWait) return
    const wait = pollWait
    pollWait = null
    if (wait.timer != null) cancel(wait.timer)
    wait.resolve(false)
  }

  function waitForPoll() {
    return new Promise((resolve) => {
      const wait = {
        timer: null,
        resolve(ready) {
          if (pollWait === wait) pollWait = null
          resolve(ready)
        },
      }
      pollWait = wait
      wait.timer = schedule(() => wait.resolve(true))
    })
  }

  function setSelection(next) {
    if (sameSelection(selection, next)) return selectionToken
    selection = structuredClone(next)
    selectionToken += 1
    buildGeneration += 1
    acceptGeneration += 1
    draftHashGeneration += 1
    buildController?.abort()
    clearPollWait()
    onInvalidate()
    return selectionToken
  }

  async function poll(job, token, expectedSelection, generation, signal) {
    let currentJob = job
    while (
      current(token, expectedSelection) &&
      generation === buildGeneration &&
      currentJob?.id &&
      !TERMINAL.has(currentJob.status)
    ) {
      if (!await waitForPoll()) return null
      const requestedJobId = currentJob.id
      const next = await fetchJob(requestedJobId, { signal })
      if (!current(token, expectedSelection) || generation !== buildGeneration) return null
      currentJob = {
        ...next,
        id: next?.id || requestedJobId,
        reason: next?.reason ?? null,
        retry_hint: next?.retry_hint ?? null,
      }
      onUpdate({ type: 'job', job: currentJob, buildGeneration: generation })
    }
    return current(token, expectedSelection) && generation === buildGeneration ? currentJob : null
  }

  async function build(payload) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const generation = ++buildGeneration
    buildController?.abort()
    clearPollWait()
    const controller = new AbortController()
    buildController = controller
    onInvalidate()
    onUpdate({ type: 'build_started', buildGeneration: generation })
    try {
      const result = await buildPreview(payload, { signal: controller.signal })
      if (!current(token, expectedSelection) || generation !== buildGeneration) return null
      onUpdate({ type: 'preview_created', preview: result, buildGeneration: generation })
      await poll(result, token, expectedSelection, generation, controller.signal)
      return result
    } catch (error) {
      if (error?.name !== 'AbortError' && current(token, expectedSelection) && generation === buildGeneration) {
        onUpdate({ type: 'error', phase: 'build', error })
      }
      return null
    }
  }

  function invalidateDraft() {
    const generation = ++draftHashGeneration
    onInvalidate()
    onUpdate({
      type: 'draft_optimistically_stale',
      draftHashGeneration: generation,
      currentDraftSettingsHash: null,
    })
    return generation
  }

  async function digestDraft(bytes, { generation: suppliedGeneration } = {}) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const generation = suppliedGeneration ?? invalidateDraft()
    try {
      const hash = await hashDraft(bytes)
      if (!current(token, expectedSelection) || generation !== draftHashGeneration) return null
      onUpdate({ type: 'draft_hash', hash, draftHashGeneration: generation })
      return hash
    } catch (error) {
      if (current(token, expectedSelection) && generation === draftHashGeneration) {
        onUpdate({ type: 'error', phase: 'draft_hash', error })
      }
      return null
    }
  }

  function accept(payload) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const request = structuredClone(payload)
    request.warningConfirmed = payload?.warningConfirmed === true
    const operationKey = acceptOperationKey(expectedSelection, request)
    if (acceptOperations.has(operationKey)) return acceptOperations.get(operationKey)
    const generation = ++acceptGeneration
    onInvalidate()
    onUpdate({ type: 'accept_started', acceptGeneration: generation })
    const operation = Promise.resolve().then(async () => {
      try {
        const result = await acceptPreview(request)
        if (!current(token, expectedSelection) || generation !== acceptGeneration) {
          onLateAccept({ result, selection: expectedSelection, outcomeUnknown: false })
          return null
        }
        onUpdate({ type: 'accepted', result })
        return result
      } catch (error) {
        const isCurrent = current(token, expectedSelection) && generation === acceptGeneration
        const outcomeUnknown = acceptOutcomeIsUnknown(error)
        if (!isCurrent || outcomeUnknown) {
          onLateAccept({ error, selection: expectedSelection, outcomeUnknown })
        }
        if (isCurrent) onUpdate({ type: 'error', phase: 'accept', error })
        return null
      }
    })
    let tracked
    tracked = operation.finally(() => {
      if (acceptOperations.get(operationKey) === tracked) acceptOperations.delete(operationKey)
    })
    acceptOperations.set(operationKey, tracked)
    return tracked
  }

  function stop() {
    selectionToken += 1
    buildGeneration += 1
    acceptGeneration += 1
    draftHashGeneration += 1
    buildController?.abort()
    clearPollWait()
    onInvalidate()
  }

  return Object.freeze({
    setSelection,
    build,
    digestDraft,
    invalidateDraft,
    accept,
    stop,
    isCurrent: current,
    isCurrentBuild: currentBuild,
    capture: () => ({
      token: selectionToken,
      buildGeneration,
      selection: structuredClone(selection),
    }),
  })
}
