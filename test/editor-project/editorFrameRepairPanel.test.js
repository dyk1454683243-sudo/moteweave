import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createFrameRepairPanel } from '../../src/ui/editor/frameRepairPanel.js'
import { fakeDocument } from '../helpers/fakeEditorDom.js'

const PLAN_HASH = 'a'.repeat(64)

function frameRepairView(overrides = {}) {
  return {
    active: true,
    stage: 'target_mask',
    uiState: 'needs_scope',
    message: 'Add a rectangle to define the repair area.',
    announcement: 'Add a rectangle to define the repair area.',
    selection: {
      projectId: 'project_demo', projectRevision: 4, assetId: 'asset_hero', revisionId: 'rev_003',
      clipId: 'walk_down', clipFramePosition: 1, sheetFrameIndex: 33,
    },
    instruction: '',
    maskMode: 'add_rectangle',
    maskEdits: [],
    selectedEditIndex: null,
    mask: { source: 'user_scoped', confidence: 'needs_scope', activePixelCount: 0 },
    providerState: {
      active_preset_id: 'gemini-default',
      presets: [{
        id: 'gemini-default', label: 'Gemini default', provider: 'gemini', model: 'model-a',
        available: true, image_config: { image_size: '1K', aspect_ratio: '1:1' },
      }],
    },
    providerPresetId: 'gemini-default',
    imageSize: '1K',
    plan: null,
    planHash: null,
    job: null,
    candidate: null,
    quality: null,
    diagnostics: [],
    error: null,
    canReview: false,
    canEdit: true,
    reviewReason: 'instruction_and_non_empty_mask_required',
    canGenerate: false,
    generateReason: 'provider_free_plan_required',
    canAccept: false,
    acceptReason: 'candidate_not_acceptable',
    warningConfirmed: false,
    actions: ['edit_mask', 'review_call', 'close'],
    ...overrides,
  }
}

test('Frame Repair rail exposes the approved four-stage surface and no forbidden active tool', async () => {
  const source = await readFile('src/ui/editor/frameRepairPanel.js', 'utf8')
  for (const marker of [
    'Target & Mask', 'Review AI Call', 'Processing', 'Result & Validation',
    'Add rectangle', 'Remove rectangle', 'Generate one candidate',
    'Recover original operation', 'Discard candidate', 'Accept revision', 'aria-live', 'aria-current',
    'editor-frame-repair-stage-content',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /brush|lasso|freehand|eraser|multiple candidates|automatic retry/i)
  assert.doesNotMatch(source, /innerHTML|provider key|raw generated path/i)
})

test('rail keeps future stages inert and dispatches one declared action per real control', () => {
  const documentRef = fakeDocument()
  const calls = []
  const panel = createFrameRepairPanel({
    documentRef,
    onAction: (type, payload) => calls.push([type, payload]),
  })
  panel.render(frameRepairView())

  const targetStage = panel.element.querySelector('[data-frame-repair-stage="target_mask"]')
  const reviewStage = panel.element.querySelector('[data-frame-repair-stage="review_call"]')
  const processingStage = panel.element.querySelector('[data-frame-repair-stage="processing"]')
  const resultStage = panel.element.querySelector('[data-frame-repair-stage="result_validation"]')
  const stageContent = panel.element.querySelector('.editor-frame-repair-stage-content')
  const targetBody = stageContent?.querySelector('[data-frame-repair-panel="target_mask"]')
  const reviewBody = stageContent?.querySelector('[data-frame-repair-panel="review_call"]')
  assert.equal(targetStage.getAttribute('aria-current'), 'step')
  assert.equal(targetStage.inert, false)
  assert.ok(stageContent, 'stage headings and the scrollable current body use separate stable regions')
  assert.equal(targetBody.hidden, false)
  for (const [stage, id] of [[reviewStage, 'review_call'], [processingStage, 'processing'], [resultStage, 'result_validation']]) {
    assert.equal(stage.inert, false, 'stage title remains accessible')
    assert.equal(stageContent.querySelector(`[data-frame-repair-panel="${id}"]`).inert, true)
    assert.equal(stageContent.querySelector(`[data-frame-repair-panel="${id}"]`).hidden, true)
  }

  panel.element.querySelector('[data-frame-repair-action="add-mode"]').dispatchEvent({ type: 'click' })
  assert.deepEqual(calls, [['set_mask_mode', 'add']])
  panel.element.querySelector('[data-frame-repair-action="generate"]').dispatchEvent({ type: 'click' })
  assert.equal(calls.length, 1, 'disabled future-stage action must remain inert')

  panel.render(frameRepairView({ stage: 'review_call', uiState: 'planned' }))
  assert.equal(targetBody.hidden, true)
  assert.equal(reviewBody.hidden, false)
  assert.equal(reviewStage.getAttribute('aria-current'), 'step')
})

test('rail preserves focused controls across renders and binds only local edit actions', () => {
  const documentRef = fakeDocument()
  const calls = []
  const panel = createFrameRepairPanel({ documentRef, onAction: (...args) => calls.push(args) })
  panel.render(frameRepairView())
  const instruction = panel.element.querySelector('[data-frame-repair-control="instruction"]')
  const provider = panel.element.querySelector('[data-frame-repair-control="provider"]')
  assert.equal(provider.disabled, false)
  assert.equal(provider.title, '')
  const createCount = documentRef.createCount
  instruction.focus()

  panel.render(frameRepairView({ instruction: 'repair hand' }))
  assert.equal(panel.element.querySelector('[data-frame-repair-control="instruction"]'), instruction)
  assert.equal(panel.element.querySelector('[data-frame-repair-control="provider"]'), provider)
  assert.equal(documentRef.activeElement, instruction)
  assert.equal(documentRef.createCount, createCount)

  panel.render(frameRepairView({
    instruction: 'repair hand',
    maskEdits: [{ op: 'add_rectangle', x: 4, y: 5, width: 8, height: 9 }],
    selectedEditIndex: 0,
  }))
  const selectedEdit = panel.element.querySelector('[data-frame-repair-control="selected-edit"]')
  assert.equal(selectedEdit.disabled, false)
  assert.equal(selectedEdit.title, '')
  calls.length = 0
  const width = panel.element.querySelector('[data-frame-repair-rectangle="width"]')
  assert.equal(panel.element.querySelector('[data-frame-repair-rectangle="x"]').max, '95')
  assert.equal(panel.element.querySelector('[data-frame-repair-rectangle="y"]').max, '95')
  assert.equal(width.max, '96')
  assert.equal(panel.element.querySelector('[data-frame-repair-rectangle="height"]').max, '96')
  width.value = ''
  width.dispatchEvent({ type: 'input' })
  assert.deepEqual(calls, [], 'blank rectangle values must remain invalid instead of becoming zero')

  instruction.value = 'repair the hand'
  instruction.dispatchEvent({ type: 'input' })
  provider.value = 'gemini-default'
  provider.dispatchEvent({ type: 'change' })
  panel.element.querySelector('[data-frame-repair-control="image-size"]').value = '2K'
  panel.element.querySelector('[data-frame-repair-control="image-size"]').dispatchEvent({ type: 'change' })
  assert.deepEqual(calls, [
    ['set_instruction', 'repair the hand'],
    ['set_provider', 'gemini-default'],
    ['set_image_size', '2K'],
  ])
})

test('rail renders exact Plan, processing, quality, warning, and acceptance truth', () => {
  const documentRef = fakeDocument()
  const calls = []
  const panel = createFrameRepairPanel({ documentRef, onAction: (...args) => calls.push(args) })
  const plan = {
    can_run: true,
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    plan: {
      clip: { id: 'walk_down', position: 1, sheet_frame_index: 33, context_frames: [{}, {}] },
      mask: { source: 'user_scoped', confidence: 'user_confirmed', activePixelCount: 64 },
      provider: { id: 'gemini-default', provider: 'gemini', model: 'model-a', image_config: { image_size: '1K', aspect_ratio: '1:1' } },
    },
  }
  panel.render(frameRepairView({
    stage: 'review_call', uiState: 'planned', plan, planHash: PLAN_HASH, canReview: true,
    canGenerate: true, generateReason: null,
  }))
  const callSummary = panel.element.querySelector('.editor-frame-repair-call-summary')
  assert.match(callSummary.textContent, /walk_down/)
  assert.match(callSummary.textContent, /1 provider call/)
  assert.match(callSummary.textContent, new RegExp(PLAN_HASH))

  panel.render(frameRepairView({
    stage: 'processing', uiState: 'generating', plan, planHash: PLAN_HASH,
    job: { id: 'job_frame', status: 'generating', provider_call_budget: 1, provider_calls_used: 1 },
  }))
  assert.match(panel.element.querySelector('.editor-frame-repair-processing').textContent, /1 \/ 1/)
  assert.equal(panel.element.querySelector('[data-frame-repair-action="generate"]').disabled, true)
  assert.equal(
    panel.element.querySelectorAll('button').some((button) => /retry/i.test(button.textContent)),
    false,
    'Processing has no Retry button',
  )

  panel.render(frameRepairView({
    stage: 'processing', uiState: 'outcome_unknown', planHash: PLAN_HASH,
    canEdit: false,
    actions: ['recover', 'discard', 'close'],
    job: { id: 'job_frame', status: 'generating', recovery_state: 'outcome_unknown', provider_call_budget: 1, provider_calls_used: 1 },
  }))
  const recover = panel.element.querySelector('[data-frame-repair-action="recover"]')
  assert.equal(recover.hidden, false)
  assert.equal(panel.element.querySelector('[data-frame-repair-action="discard"]').disabled, false)
  assert.equal(panel.element.querySelector('[data-frame-repair-action="add-mode"]').disabled, true)
  assert.equal(panel.element.querySelector('[data-frame-repair-control="instruction"]').disabled, true)
  recover.dispatchEvent({ type: 'click' })
  assert.deepEqual(calls.at(-1), ['recover'])

  panel.render(frameRepairView({
    stage: 'result_validation', uiState: 'warning', plan, planHash: PLAN_HASH,
    canEdit: false,
    actions: ['confirm_warning', 'accept', 'discard', 'close'],
    candidate: { jobId: 'job_frame' },
    quality: {
      status: 'warning', complete: true,
      integrity: { non_target_equal: true, target_outside_mask_equal: true, actual_non_target_changed: 0, actual_outside_mask_changed: 0 },
      validation: { status: 'warning', warnings: ['review_continuity'], blocking_errors: [] },
    },
    acceptReason: 'warning_confirmation_required',
  }))
  assert.match(panel.element.querySelector('.editor-frame-repair-quality').textContent, /review_continuity/)
  assert.equal(panel.element.querySelector('[data-frame-repair-control="instruction"]').disabled, true)
  const warning = panel.element.querySelector('[data-frame-repair-control="warning-confirmation"]')
  warning.checked = true
  warning.dispatchEvent({ type: 'change' })
  panel.element.querySelector('[data-frame-repair-action="discard"]').dispatchEvent({ type: 'click' })
  assert.deepEqual(calls.slice(-2), [['confirm_warning', true], ['discard']])
  assert.equal(panel.element.querySelector('[data-frame-repair-action="accept"]').disabled, true)
})

test('rail renders only local allowlisted provider diagnostics and keeps one polite live region', () => {
  const documentRef = fakeDocument()
  const panel = createFrameRepairPanel({ documentRef, onAction() {} })

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'failed_model',
    canEdit: false,
    actions: ['review_call', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'provider_rate_limited',
      retry_hint: 'wait_before_new_call',
      recovery_state: null,
      provider_call_budget: 1,
      provider_calls_used: 1,
      remote_message: 'Bearer private.token /Users/private/provider.json',
    },
  }))

  const diagnostic = panel.element.querySelector('.editor-frame-repair-diagnostic')
  const state = panel.element.querySelector('.editor-frame-repair-diagnostic-state')
  const detail = panel.element.querySelector('.editor-frame-repair-diagnostic-detail')
  const next = panel.element.querySelector('.editor-frame-repair-diagnostic-next')
  const live = panel.element.querySelector('.editor-frame-repair-live')
  assert.equal(diagnostic.hidden, false)
  assert.equal(diagnostic.dataset.tone, 'known')
  assert.equal(state.textContent, 'Known provider failure · provider_rate_limited')
  assert.match(detail.textContent, /rate-limited/)
  assert.match(next.textContent, /Wait before authorizing a new call/)
  assert.match(live.textContent, /provider_rate_limited/)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /Bearer|\/Users\/private/)
  assert.equal(panel.element.querySelectorAll('[aria-live]').length, 1)
  assert.equal(panel.element.querySelectorAll('button').some((button) => /retry/i.test(button.textContent)), false)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'failed_model',
    canEdit: false,
    actions: ['review_call', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'provider_candidate_invalid',
      retry_hint: 'inspect_provider_output_full_sheet',
      recovery_state: null,
      provider_call_budget: 1,
      provider_calls_used: 1,
    },
  }))
  assert.equal(state.textContent, 'Known provider failure · provider_candidate_invalid')
  assert.match(detail.textContent, /full sprite sheet instead of one frame/i)
  assert.match(next.textContent, /sanitized failure preview/i)
  assert.match(live.textContent, /provider_output_full_sheet/)
  assert.equal(panel.element.querySelectorAll('button').some((button) => /retry/i.test(button.textContent)), false)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'failed_model',
    canEdit: false,
    actions: ['review_call', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'provider_rate_limited',
      retry_hint: 'Bearer private.token',
      recovery_state: null,
      provider_call_budget: 1,
      provider_calls_used: 1,
    },
  }))
  assert.equal(state.textContent, 'Known provider failure · provider_rate_limited')
  assert.equal(next.hidden, true)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /Bearer/)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'outcome_unknown',
    canEdit: false,
    actions: ['recover', 'discard', 'close'],
    job: {
      id: 'job_frame',
      status: 'failed_model_error',
      reason: 'private_internal_marker',
      retry_hint: 'Bearer private.token',
      recovery_state: 'outcome_unknown',
      provider_call_budget: 1,
      provider_calls_used: 1,
    },
  }))

  assert.equal(diagnostic.dataset.tone, 'unknown')
  assert.equal(state.textContent, 'Outcome unknown · provider_failed')
  assert.match(detail.textContent, /could not be classified safely/)
  assert.equal(next.hidden, true)
  assert.doesNotMatch([state, detail, next, live].map((node) => node.textContent).join(' '), /private_internal_marker|Bearer/)
  assert.equal(panel.element.querySelector('[data-frame-repair-action="recover"]').hidden, false)

  panel.render(frameRepairView({
    stage: 'processing',
    uiState: 'generating',
    job: { id: 'job_frame', status: 'generating', reason: null, retry_hint: null, provider_call_budget: 1, provider_calls_used: 1 },
  }))
  assert.equal(diagnostic.hidden, true)
})

test('focusFirst and destroy use the stable rail lifecycle', () => {
  const documentRef = fakeDocument()
  const panel = createFrameRepairPanel({ documentRef, onAction() {} })
  panel.render(frameRepairView())
  panel.focusFirst()
  assert.equal(documentRef.activeElement, panel.element.querySelector('[data-frame-repair-action="add-mode"]'))
  panel.destroy()
  panel.element.querySelector('[data-frame-repair-action="add-mode"]').dispatchEvent({ type: 'click' })
})
