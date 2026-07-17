const STAGES = Object.freeze([
  ['target_mask', 'Target & Mask'],
  ['review_call', 'Review AI Call'],
  ['processing', 'Processing'],
  ['result_validation', 'Result & Validation'],
])

const PROVIDER_DIAGNOSTIC_COPY = Object.freeze({
  provider_safety_filter: Object.freeze({
    outcome: 'known', retryHint: null,
    detail: 'The provider blocked the candidate for safety reasons.', next: null,
  }),
  provider_route_blocked: Object.freeze({
    outcome: 'known', retryHint: 'switch_provider_preset',
    detail: 'The selected provider route rejected image generation.',
    next: 'Switch the provider preset before authorizing a new call.',
  }),
  provider_authentication_failed: Object.freeze({
    outcome: 'known', retryHint: 'check_provider_credentials',
    detail: 'The provider rejected the configured credentials.',
    next: 'Check provider credentials before authorizing a new call.',
  }),
  provider_quota_or_payment_required: Object.freeze({
    outcome: 'known', retryHint: 'check_provider_quota',
    detail: 'The provider reported unavailable quota or required payment.',
    next: 'Check the provider account quota before authorizing a new call.',
  }),
  provider_rate_limited: Object.freeze({
    outcome: 'known', retryHint: 'wait_before_new_call',
    detail: 'The provider temporarily rate-limited the request.',
    next: 'Wait before authorizing a new call.',
  }),
  provider_request_rejected: Object.freeze({
    outcome: 'known', retryHint: 'review_provider_preset',
    detail: 'The provider rejected the submitted request.',
    next: 'Review the selected provider preset before authorizing a new call.',
  }),
  provider_service_unavailable: Object.freeze({
    outcome: 'known', retryHint: 'review_provider_status',
    detail: 'The provider returned a service error.',
    next: 'Review provider status before authorizing a new call.',
  }),
  provider_output_invalid: Object.freeze({
    outcome: 'known', retryHint: 'inspect_provider_output_contract',
    detail: 'The provider response did not contain a usable image.',
    next: 'Inspect the provider output contract before authorizing a new call.',
  }),
  provider_candidate_invalid: Object.freeze({
    outcome: 'known', retryHint: 'inspect_provider_output_contract',
    detail: 'The returned image could not produce a valid repair candidate.',
    next: 'Inspect the provider output contract before authorizing a new call.',
  }),
  provider_unavailable: Object.freeze({
    outcome: 'known', retryHint: 'configure_provider',
    detail: 'The selected provider is unavailable.',
    next: 'Configure a provider before authorizing a new call.',
  }),
  provider_configuration_error: Object.freeze({
    outcome: 'known', retryHint: 'check_provider_configuration',
    detail: 'The provider configuration is invalid.',
    next: 'Check provider configuration before authorizing a new call.',
  }),
  transport_outcome_unknown: Object.freeze({
    outcome: 'unknown', retryHint: null,
    detail: 'The remote result could not be confirmed. Recover the original operation; no call will be retried automatically.',
    next: null,
  }),
  provider_failed: Object.freeze({
    outcome: 'unknown', retryHint: null,
    detail: 'The provider failure could not be classified safely. Recover the original operation; no call will be retried automatically.',
    next: null,
  }),
})

const PROVIDER_CANDIDATE_SUBTYPE_COPY = Object.freeze({
  inspect_provider_output_invalid: Object.freeze({
    code: 'provider_output_invalid',
    detail: 'The returned image payload could not be decoded or fitted into one repair frame.',
    next: 'Inspect the fixed failure diagnostic; a sanitized preview exists only when the image could be decoded.',
  }),
  inspect_provider_output_full_sheet: Object.freeze({
    code: 'provider_output_full_sheet',
    detail: 'The provider returned a full sprite sheet instead of one frame.',
    next: 'Inspect the sanitized failure preview before authorizing a new call.',
  }),
  inspect_provider_output_empty: Object.freeze({
    code: 'provider_output_empty',
    detail: 'The provider image did not contain one visible character after bounded local cleanup.',
    next: 'Inspect the sanitized failure preview before authorizing a new call.',
  }),
  inspect_provider_output_multiple_subjects: Object.freeze({
    code: 'provider_output_multiple_subjects',
    detail: 'The provider image contained more than one significant subject.',
    next: 'Inspect the sanitized failure preview before authorizing a new call.',
  }),
})

function safeProviderDiagnostic(job) {
  if (!job || typeof job.reason !== 'string' || job.reason.length === 0) return null
  const requestedReason = Object.hasOwn(PROVIDER_DIAGNOSTIC_COPY, job.reason)
    ? job.reason
    : 'provider_failed'
  const requested = PROVIDER_DIAGNOSTIC_COPY[requestedReason]
  const outcomeUnknown = job.recovery_state === 'outcome_unknown'
  const reason = (requested.outcome === 'unknown') === outcomeUnknown
    ? requestedReason
    : 'provider_failed'
  const definition = PROVIDER_DIAGNOSTIC_COPY[reason]
  const label = definition.outcome === 'unknown' ? 'Outcome unknown' : 'Known provider failure'
  const subtype = reason === 'provider_candidate_invalid' &&
    typeof job.retry_hint === 'string' && Object.hasOwn(PROVIDER_CANDIDATE_SUBTYPE_COPY, job.retry_hint)
    ? PROVIDER_CANDIDATE_SUBTYPE_COPY[job.retry_hint]
    : null
  const detail = subtype?.detail ?? definition.detail
  const next = subtype?.next ?? (job.retry_hint === definition.retryHint ? definition.next : null)
  return Object.freeze({
    tone: definition.outcome,
    state: `${label} · ${reason}`,
    detail,
    next,
    announcement: `${label}. ${reason}.${subtype ? ` ${subtype.code}.` : ''} ${detail}${next ? ` Next check. ${next}` : ''}`,
  })
}

function node(documentRef, tag, className = '', text = '') {
  const value = documentRef.createElement(tag)
  if (className) value.className = className
  value.textContent = text
  return value
}

function setDisabled(control, disabled, reason = null, label = null) {
  control.disabled = Boolean(disabled)
  control.title = reason ?? ''
  if (label) control.setAttribute('aria-label', reason ? `${label}: unavailable (${reason})` : label)
}

function option(documentRef, value, label) {
  const item = node(documentRef, 'option', '', label)
  item.value = value
  return item
}

function valueText(value, fallback = 'Unavailable') {
  return value == null || value === '' ? fallback : String(value)
}

function joined(values, fallback = 'None') {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => value != null && value !== '')
  return filtered.length ? filtered.join(', ') : fallback
}

function selectedRectangle(view) {
  const index = view?.selectedEditIndex
  return Number.isInteger(index) ? view.maskEdits?.[index] ?? null : null
}

export function createFrameRepairPanel({
  documentRef = document,
  onAction = () => {},
} = {}) {
  if (!documentRef || typeof documentRef.createElement !== 'function' || typeof onAction !== 'function') {
    throw new TypeError('Frame Repair panel dependencies are invalid')
  }

  const element = node(documentRef, 'section', 'editor-frame-repair-rail')
  element.setAttribute('aria-label', 'Frame Repair')
  const titleRow = node(documentRef, 'header', 'editor-frame-repair-header')
  titleRow.append(node(documentRef, 'h2', '', 'Frame Repair'))
  const close = node(documentRef, 'button', 'secondary', 'Close Frame Repair')
  close.type = 'button'
  close.dataset.frameRepairAction = 'close'
  titleRow.append(close)

  const live = node(documentRef, 'p', 'editor-frame-repair-live')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')
  const steps = node(documentRef, 'ol', 'editor-frame-repair-steps')
  const stageContent = node(documentRef, 'div', 'editor-frame-repair-stage-content')
  const stageNodes = new Map()
  for (const [id, label] of STAGES) {
    const step = node(documentRef, 'li', 'editor-frame-repair-step')
    step.dataset.frameRepairStage = id
    const heading = node(documentRef, 'h3', 'editor-frame-repair-step-title', label)
    heading.id = `editor-frame-repair-stage-${id}`
    const body = node(documentRef, 'div', 'editor-frame-repair-step-body')
    body.dataset.frameRepairPanel = id
    body.setAttribute('role', 'group')
    body.setAttribute('aria-labelledby', heading.id)
    step.append(heading)
    steps.append(step)
    stageContent.append(body)
    stageNodes.set(id, { step, body })
  }
  element.append(titleRow, live, steps, stageContent)

  const targetBody = stageNodes.get('target_mask').body
  const targetIdentity = node(documentRef, 'p', 'editor-frame-repair-target')
  const maskSummary = node(documentRef, 'p', 'editor-frame-repair-mask-summary')
  const maskTools = node(documentRef, 'div', 'editor-frame-repair-mask-tools')
  const addMode = node(documentRef, 'button', 'secondary', 'Add rectangle')
  const removeMode = node(documentRef, 'button', 'secondary', 'Remove rectangle')
  addMode.type = removeMode.type = 'button'
  addMode.dataset.frameRepairAction = 'add-mode'
  removeMode.dataset.frameRepairAction = 'remove-mode'
  addMode.setAttribute('aria-pressed', 'false')
  removeMode.setAttribute('aria-pressed', 'false')
  maskTools.append(addMode, removeMode)

  const instructionLabel = node(documentRef, 'label', 'editor-frame-repair-field')
  instructionLabel.append(node(documentRef, 'span', '', 'Repair instruction'))
  const instruction = node(documentRef, 'textarea')
  instruction.rows = 3
  instruction.dataset.frameRepairControl = 'instruction'
  instructionLabel.append(instruction)

  const editLabel = node(documentRef, 'label', 'editor-frame-repair-field')
  editLabel.append(node(documentRef, 'span', '', 'Mask rectangle'))
  const editSelect = node(documentRef, 'select')
  editSelect.dataset.frameRepairControl = 'selected-edit'
  editLabel.append(editSelect)
  const rectangleGrid = node(documentRef, 'div', 'editor-frame-repair-rectangle-grid')
  const rectangleInputs = {}
  for (const [key, label, min, max] of [['x', 'X', 0, 95], ['y', 'Y', 0, 95], ['width', 'Width', 1, 96], ['height', 'Height', 1, 96]]) {
    const field = node(documentRef, 'label', 'editor-frame-repair-field compact')
    field.append(node(documentRef, 'span', '', label))
    const input = node(documentRef, 'input')
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = '1'
    input.dataset.frameRepairRectangle = key
    field.append(input)
    rectangleGrid.append(field)
    rectangleInputs[key] = input
  }
  const editActions = node(documentRef, 'div', 'editor-frame-repair-edit-actions')
  const deleteEdit = node(documentRef, 'button', 'secondary', 'Delete rectangle')
  const undo = node(documentRef, 'button', 'secondary', 'Undo')
  deleteEdit.type = undo.type = 'button'
  deleteEdit.dataset.frameRepairAction = 'delete-edit'
  undo.dataset.frameRepairAction = 'undo'
  editActions.append(deleteEdit, undo)

  const providerLabel = node(documentRef, 'label', 'editor-frame-repair-field')
  providerLabel.append(node(documentRef, 'span', '', 'Provider preset'))
  const provider = node(documentRef, 'select')
  provider.dataset.frameRepairControl = 'provider'
  providerLabel.append(provider)
  const imageSizeLabel = node(documentRef, 'label', 'editor-frame-repair-field')
  imageSizeLabel.append(node(documentRef, 'span', '', 'Image size'))
  const imageSize = node(documentRef, 'select')
  imageSize.dataset.frameRepairControl = 'image-size'
  imageSize.append(option(documentRef, '1K', '1K'), option(documentRef, '2K', '2K'))
  imageSizeLabel.append(imageSize)
  const review = node(documentRef, 'button', '', 'Review AI Call')
  review.type = 'button'
  review.dataset.frameRepairAction = 'review'
  targetBody.append(
    targetIdentity, maskSummary, maskTools, instructionLabel, editLabel, rectangleGrid,
    editActions, providerLabel, imageSizeLabel, review,
  )

  const reviewBody = stageNodes.get('review_call').body
  const callSummary = node(documentRef, 'p', 'editor-frame-repair-call-summary')
  const generate = node(documentRef, 'button', '', 'Generate one candidate')
  generate.type = 'button'
  generate.dataset.frameRepairAction = 'generate'
  reviewBody.append(callSummary, generate)

  const processingBody = stageNodes.get('processing').body
  const processing = node(documentRef, 'p', 'editor-frame-repair-processing')
  const diagnostic = node(documentRef, 'div', 'editor-frame-repair-diagnostic')
  diagnostic.hidden = true
  const diagnosticTitle = node(documentRef, 'p', 'editor-frame-repair-diagnostic-title', 'Safe diagnostic')
  const diagnosticState = node(documentRef, 'p', 'editor-frame-repair-diagnostic-state')
  const diagnosticDetail = node(documentRef, 'p', 'editor-frame-repair-diagnostic-detail')
  const diagnosticNext = node(documentRef, 'p', 'editor-frame-repair-diagnostic-next')
  diagnostic.append(diagnosticTitle, diagnosticState, diagnosticDetail, diagnosticNext)
  const processingNote = node(
    documentRef,
    'p',
    'editor-frame-repair-note',
    'Closing keeps the operation recoverable; it does not cancel or retry a submitted provider call.',
  )
  const recover = node(documentRef, 'button', 'secondary', 'Recover original operation')
  recover.type = 'button'
  recover.dataset.frameRepairAction = 'recover'
  recover.hidden = true
  processingBody.append(processing, diagnostic, processingNote, recover)

  const resultBody = stageNodes.get('result_validation').body
  const quality = node(documentRef, 'p', 'editor-frame-repair-quality')
  const warningLabel = node(documentRef, 'label', 'editor-frame-repair-warning')
  const warningConfirmation = node(documentRef, 'input')
  warningConfirmation.type = 'checkbox'
  warningConfirmation.dataset.frameRepairControl = 'warning-confirmation'
  warningLabel.append(warningConfirmation, node(documentRef, 'span', '', 'I reviewed this exact warning candidate'))
  const resultActions = node(documentRef, 'div', 'editor-frame-repair-result-actions')
  const discard = node(documentRef, 'button', 'secondary', 'Discard candidate')
  const accept = node(documentRef, 'button', '', 'Accept revision')
  discard.type = accept.type = 'button'
  discard.dataset.frameRepairAction = 'discard'
  accept.dataset.frameRepairAction = 'accept'
  resultActions.append(discard, accept)
  resultBody.append(quality, warningLabel, resultActions)

  const listeners = []
  let destroyed = false
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }
  const dispatch = (type, payload) => {
    if (destroyed) return
    if (payload === undefined) onAction(type)
    else onAction(type, payload)
  }
  const click = (control, type, payload) => listen(control, 'click', () => {
    if (!control.disabled) dispatch(type, payload)
  })

  click(close, 'close')
  click(addMode, 'set_mask_mode', 'add')
  click(removeMode, 'set_mask_mode', 'remove')
  click(deleteEdit, 'delete_edit')
  click(undo, 'undo')
  click(review, 'review')
  click(generate, 'generate')
  click(recover, 'recover')
  click(discard, 'discard')
  click(accept, 'accept')
  listen(instruction, 'input', () => { if (!instruction.disabled) dispatch('set_instruction', instruction.value) })
  listen(provider, 'change', () => { if (!provider.disabled) dispatch('set_provider', provider.value) })
  listen(imageSize, 'change', () => { if (!imageSize.disabled) dispatch('set_image_size', imageSize.value) })
  listen(editSelect, 'change', () => {
    if (!editSelect.disabled && editSelect.value !== '') dispatch('select_edit', Number(editSelect.value))
  })
  for (const input of Object.values(rectangleInputs)) {
    listen(input, 'input', () => {
      if (input.disabled) return
      if (Object.values(rectangleInputs).some((control) => String(control.value).trim() === '')) return
      const rectangle = Object.fromEntries(Object.entries(rectangleInputs).map(([key, control]) => [key, Number(control.value)]))
      if (Object.values(rectangle).every(Number.isInteger)) dispatch('update_edit', rectangle)
    })
  }
  listen(warningConfirmation, 'change', () => {
    if (!warningConfirmation.disabled) dispatch('confirm_warning', warningConfirmation.checked)
  })

  function renderStages(view) {
    const currentIndex = Math.max(0, STAGES.findIndex(([id]) => id === view.stage))
    STAGES.forEach(([id], index) => {
      const { step, body } = stageNodes.get(id)
      const current = index === currentIndex
      if (current) step.setAttribute('aria-current', 'step')
      else step.removeAttribute('aria-current')
      step.dataset.status = index < currentIndex ? 'complete' : current ? 'current' : 'future'
      step.inert = false
      body.hidden = !current
      body.inert = !current
    })
  }

  function renderProviders(view) {
    const presets = Array.isArray(view.providerState?.presets) ? view.providerState.presets : []
    const signature = JSON.stringify(presets.map((preset) => [preset.id, preset.label, preset.provider, preset.model, preset.available]))
    if (provider.dataset.signature !== signature) {
      provider.dataset.signature = signature
      provider.replaceChildren(...presets.map((preset) => option(
        documentRef,
        preset.id,
        `${preset.label ?? preset.id} · ${preset.model ?? preset.provider ?? 'model unavailable'}${preset.available === true ? '' : ' · unavailable'}`,
      )))
      ;[...provider.options].forEach((item, index) => {
        item.disabled = presets[index]?.available !== true
      })
    }
    provider.value = view.providerPresetId ?? ''
    return presets
  }

  function renderEdits(view, editable) {
    const edits = Array.isArray(view.maskEdits) ? view.maskEdits : []
    const signature = JSON.stringify(edits.map((edit) => [edit.op, edit.x, edit.y, edit.width, edit.height]))
    if (editSelect.dataset.signature !== signature) {
      editSelect.dataset.signature = signature
      editSelect.replaceChildren(...edits.map((edit, index) => option(
        documentRef,
        String(index),
        `${index + 1}. ${edit.op === 'remove_rectangle' ? 'Remove' : 'Add'} · ${edit.x},${edit.y} · ${edit.width}×${edit.height}`,
      )))
    }
    editSelect.value = Number.isInteger(view.selectedEditIndex) ? String(view.selectedEditIndex) : ''
    const rectangle = selectedRectangle(view)
    for (const [key, input] of Object.entries(rectangleInputs)) input.value = rectangle ? String(rectangle[key]) : ''
    const editReason = edits.length === 0
      ? 'No rectangle is selected'
      : !editable ? 'Mask edits are locked during this stage' : null
    const rectangleReason = !rectangle
      ? 'Select a rectangle first'
      : !editable ? 'Mask edits are locked during this stage' : null
    setDisabled(editSelect, !editable || edits.length === 0, editReason, 'Mask rectangle')
    for (const [key, input] of Object.entries(rectangleInputs)) {
      setDisabled(input, !editable || !rectangle, rectangleReason, key)
    }
    setDisabled(deleteEdit, !editable || !rectangle, rectangleReason, 'Delete rectangle')
    setDisabled(undo, !editable || edits.length === 0, edits.length === 0 ? 'No mask edit to undo' : !editable ? 'Mask edits are locked during this stage' : null, 'Undo')
  }

  function render(view = {}) {
    const editable = view.active === true && view.canEdit === true
    renderStages(view)
    const selection = view.selection ?? {}
    targetIdentity.textContent = `Target · ${valueText(selection.clipId)} · clip position ${valueText(selection.clipFramePosition)} · sheet frame ${valueText(selection.sheetFrameIndex)} · ${valueText(selection.revisionId)}`
    const mask = view.mask ?? {}
    maskSummary.textContent = `Mask · ${valueText(mask.source)} · ${valueText(mask.confidence)} · ${valueText(mask.activePixelCount, '0')} pixels`
    addMode.setAttribute('aria-pressed', String(view.maskMode !== 'remove_rectangle'))
    removeMode.setAttribute('aria-pressed', String(view.maskMode === 'remove_rectangle'))
    setDisabled(addMode, !editable, editable ? null : 'Mask edits are locked during this stage', 'Add rectangle')
    setDisabled(removeMode, !editable, editable ? null : 'Mask edits are locked during this stage', 'Remove rectangle')
    instruction.value = view.instruction ?? ''
    setDisabled(instruction, !editable, editable ? null : 'Instruction is locked during this stage', 'Repair instruction')
    renderEdits(view, editable)
    const presets = renderProviders(view)
    setDisabled(
      provider,
      !editable || presets.length === 0,
      presets.length === 0 ? 'No safe public provider preset is available' : !editable ? 'Provider is locked during this stage' : null,
      'Provider preset',
    )
    imageSize.value = view.imageSize ?? '1K'
    setDisabled(imageSize, !editable, editable ? null : 'Image size is locked during this stage', 'Image size')
    setDisabled(review, !view.canReview, view.reviewReason, 'Review AI Call')

    const plan = view.plan?.plan
    callSummary.textContent = plan
      ? `Target ${valueText(plan.clip?.id)} position ${valueText(plan.clip?.position)} / sheet ${valueText(plan.clip?.sheet_frame_index)} · Mask ${valueText(plan.mask?.source)} ${valueText(plan.mask?.confidence)} ${valueText(plan.mask?.activePixelCount, '0')} pixels · Context ${plan.clip?.context_frames?.length ?? 0} frames · Provider ${valueText(plan.provider?.id)} / ${valueText(plan.provider?.model)} · ${valueText(plan.provider?.image_config?.image_size)} ${valueText(plan.provider?.image_config?.aspect_ratio)} · ${view.plan?.estimated_provider_calls ?? 0} provider call · Plan hash ${valueText(view.planHash)}`
      : 'Review a provider-free Plan before generation.'
    setDisabled(generate, !view.canGenerate, view.generateReason, 'Generate one candidate')

    const job = view.job
    processing.textContent = job
      ? `Job ${valueText(job.id)} · ${valueText(job.status)} · provider calls ${job.provider_calls_used ?? 0} / ${job.provider_call_budget ?? 1}`
      : 'No provider call has been submitted.'
    const providerDiagnostic = safeProviderDiagnostic(job)
    diagnostic.hidden = providerDiagnostic === null
    if (providerDiagnostic) {
      diagnostic.dataset.tone = providerDiagnostic.tone
      diagnosticState.textContent = providerDiagnostic.state
      diagnosticDetail.textContent = providerDiagnostic.detail
      diagnosticNext.hidden = providerDiagnostic.next === null
      diagnosticNext.textContent = providerDiagnostic.next ? `Next check · ${providerDiagnostic.next}` : ''
    } else {
      delete diagnostic.dataset.tone
      diagnosticState.textContent = ''
      diagnosticDetail.textContent = ''
      diagnosticNext.hidden = true
      diagnosticNext.textContent = ''
    }
    const baseAnnouncement = view.announcement ?? view.message ?? ''
    live.textContent = providerDiagnostic
      ? `${baseAnnouncement} ${providerDiagnostic.announcement}`.trim()
      : baseAnnouncement
    recover.hidden = view.uiState !== 'outcome_unknown'
    setDisabled(recover, view.uiState !== 'outcome_unknown', view.uiState === 'outcome_unknown' ? null : 'Recovery is only available for an uncertain original operation', 'Recover original operation')

    const report = view.quality
    quality.textContent = report
      ? `Quality ${valueText(report.status)} · complete ${String(report.complete === true)} · validation ${valueText(report.validation?.status)} · non-target equal ${String(report.integrity?.non_target_equal === true)} · outside-mask equal ${String(report.integrity?.target_outside_mask_equal === true)} · non-target changed ${report.integrity?.actual_non_target_changed ?? 'Unavailable'} · outside-mask changed ${report.integrity?.actual_outside_mask_changed ?? 'Unavailable'} · warnings ${joined(report.validation?.warnings)} · blocking ${joined(report.validation?.blocking_errors)}`
      : 'No candidate quality evidence is available.'
    warningLabel.hidden = view.uiState !== 'warning'
    warningConfirmation.checked = view.warningConfirmed === true
    setDisabled(warningConfirmation, view.uiState !== 'warning', view.uiState === 'warning' ? null : 'The candidate has no warning confirmation requirement', 'Warning confirmation')
    const canDiscard = Array.isArray(view.actions) && view.actions.includes('discard')
    setDisabled(discard, !canDiscard, canDiscard ? null : 'No candidate or recoverable operation to discard', 'Discard candidate')
    setDisabled(accept, !view.canAccept, view.acceptReason, 'Accept revision')
    close.disabled = view.active !== true
  }

  function focusFirst() {
    const preferred = [addMode, removeMode, instruction, review, generate, recover, discard, accept, close]
    preferred.find((control) => !control.disabled && !control.hidden)?.focus()
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    for (const remove of listeners.splice(0)) remove()
  }

  return Object.freeze({ element, render, focusFirst, destroy })
}
