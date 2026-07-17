import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFrameRepairQualityGateViewModel,
  createFrameRepairQualityGatePanel,
} from '../../src/ui/editor/frameRepairQualityGatePanel.js'
import { fakeDocument } from '../helpers/fakeEditorDom.js'

function project(assetCount = 6) {
  return {
    id: 'project_source',
    assets: Object.fromEntries(Array.from({ length: assetCount }, (_, index) => [
      `asset_${index + 1}`,
      { id: `asset_${index + 1}`, name: `Hero ${index + 1}`, kind: 'character_pack' },
    ])),
  }
}

function cases(overrides = {}) {
  return Array.from({ length: 8 }, (_, index) => ({
    caseId: `case_${index + 1}`,
    displayIndex: index,
    status: index === 0 ? 'candidate_ready' : 'pending',
    classification: {
      difficulty: index < 2 ? 'basic' : index < 6 ? 'medium' : 'hard',
      defectCategory: index === 7 ? 'neighbor_continuity' : 'shape',
      expectedImprovement: `Expected improvement ${index + 1}`,
    },
    blind: { a: 'before', b: 'after' },
    reviewRecorded: false,
    successfulCandidate: null,
    outcome: null,
    operation: index === 0 ? {
      jobId: 'job_quality_1', status: 'done', providerCallsUsed: 1,
      generatedCandidateCount: 1, reason: null,
    } : null,
    ...overrides[index],
  }))
}

function reviewInput({ desktopReviewAllowed = true, revealed = false, caseOverrides = {} } = {}) {
  const serverCases = cases(caseOverrides)
  return {
    state: {
      phase: 'running',
      activeCaseId: 'case_1',
      activeCaseStage: 'candidate',
      blindChoice: revealed ? 'prefer_b' : null,
      revealed,
      session: {
        session: {
          id: 'frqg_20260712_panel', status: 'running', providerPresetId: 'preset_safe',
          callsUsed: 1, callsRemaining: 7, blockingReason: null,
        },
        cases: serverCases,
        artifacts: { sessionPlan: '/generated/frame-repair-quality-gates/frqg_20260712_panel/session_plan.json' },
        allowedArtifactUrls: ['/generated/frame-repair-quality-gates/frqg_20260712_panel/session_plan.json'],
      },
    },
    ui: {
      phase: 'running',
      blindReviewEnabled: !revealed,
      revealEnabled: revealed,
      sealReviewEnabled: revealed,
      acceptEnabled: revealed,
      rejectEnabled: revealed,
      finalizeEnabled: true,
      progress: serverCases.map((item, index) => ({
        caseId: item.caseId, index, status: item.status, icon: '•',
        visualResult: null, outcomeLabel: item.outcome,
      })),
    },
    project: project(),
    desktopReviewAllowed,
    frameRepair: {
      candidate: { available: true },
      quality: {
        status: 'pass', complete: true,
        integrity: {
          non_target_equal: true, target_outside_mask_equal: true,
          actual_outside_mask_changed: 0,
        },
        validation: { status: 'pass', blocking_errors: [] },
        evidence: {
          geometry: { status: 'pass' }, halo: { status: 'pass' },
          component: { status: 'pass' }, continuity: { status: 'pass' },
        },
      },
      neighborContext: { previous: 'available', next: 'available' },
    },
  }
}

test('source declares the approved pure DOM surface without forbidden active capabilities', async () => {
  const source = await readFile('src/ui/editor/frameRepairQualityGatePanel.js', 'utf8')
  for (const marker of [
    'editor-frame-repair-quality-gate', 'editor-quality-gate-session',
    'editor-quality-gate-canvas-slot', 'editor-quality-gate-evidence',
    'editor-quality-gate-progress', 'editor-quality-gate-actions',
    'editor-quality-gate-summary', 'editor-quality-gate-disabled-reason',
    'Expected improvement', 'BBox / anchor / baseline', 'Halo', 'Component', 'Continuity',
    'Desktop pixel inspection is required',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /innerHTML|batch generation|model comparison|automatic scoring|mobile approval/i)
})

test('view model covers setup truth, eight progress records, and server-owned final metrics', () => {
  const noProject = buildFrameRepairQualityGateViewModel({
    state: { phase: 'entry', sourceAssets: [], ownershipConfirmed: false },
    ui: { setupEnabled: false },
  })
  assert.equal(noProject.view, 'setup')
  assert.equal(noProject.actions.setup.enabled, false)
  assert.match(noProject.actions.setup.reason, /Load a source Editor project/)
  assert.equal(noProject.progress.length, 8)

  const insufficient = buildFrameRepairQualityGateViewModel({
    state: { phase: 'entry', sourceAssets: [], ownershipConfirmed: false },
    ui: { setupEnabled: false },
    project: project(5),
  })
  assert.match(insufficient.actions.setup.reason, /Six eligible Character Packs/)

  const final = buildFrameRepairQualityGateViewModel({
    state: { phase: 'finalized', session: { session: { callsUsed: 8, callsRemaining: 0 }, cases: cases() } },
    report: {
      decision: {
        result: 'passed', successful_candidates: 5, completed_candidates: 7,
        required_successes: 5, improvement_rate: 5 / 7, calls_used: 8, calls_remaining: 0,
        accepted: 4, rejected: 3, provider_blocked: 1, unresolved: 0, failure_domain: null,
      },
      breakdown: { difficulty: [{ key: 'hard', planned: 2, completed: 2, successful: 1 }], category: [] },
      taxonomy: { hard_gate_reasons: [], controlled_provider_reasons: [] },
    },
  })
  assert.equal(final.view, 'summary')
  assert.equal(final.report.successful, 5)
  assert.equal(final.report.completed, 7)
  assert.equal(final.report.required, 5)
  assert.equal(final.report.rate, 5 / 7, 'panel must present the trusted rate without recomputing it')
})

test('panel exposes Layout C regions, one live region, a reusable Canvas slot, and eight roving items', () => {
  const documentRef = fakeDocument()
  const panel = createFrameRepairQualityGatePanel({ documentRef })
  panel.render(reviewInput())

  assert.equal(panel.element.dataset.view, 'review')
  assert.ok(panel.element.querySelector('.editor-quality-gate-session'))
  assert.ok(panel.element.querySelector('.editor-quality-gate-canvas'))
  assert.equal(panel.element.querySelector('.editor-quality-gate-canvas-slot'), panel.canvasSlot)
  assert.ok(panel.element.querySelector('.editor-quality-gate-evidence'))
  assert.ok(panel.element.querySelector('.editor-quality-gate-actions'))
  assert.equal(panel.element.querySelectorAll('[aria-live]').length, 1)
  const items = panel.element.querySelectorAll('.editor-quality-gate-progress-item')
  assert.equal(items.length, 8)
  assert.equal(items.filter((item) => item.tabIndex === 0).length, 1)
  assert.match(panel.element.querySelector('.editor-quality-gate-session-facts').textContent, /Case 1 \/ 8.*calls 1 \/ 8.*hard gate pass/)
})

test('disabled programmatic clicks are guarded and mobile review reasons remain visible', () => {
  const documentRef = fakeDocument({ narrow: true })
  const calls = []
  const panel = createFrameRepairQualityGatePanel({
    documentRef,
    onAction: (...args) => calls.push(args),
  })
  panel.render(reviewInput({ desktopReviewAllowed: false, revealed: true }))

  for (const action of ['blind', 'seal_review', 'accept', 'reject']) {
    const controls = panel.element.querySelectorAll(`[data-quality-gate-action="${action}"]`)
    assert.ok(controls.length > 0)
    for (const control of controls) {
      assert.equal(control.disabled, true)
      assert.match(control.title, /Desktop pixel inspection is required/)
      control.dispatchEvent({ type: 'click' })
    }
  }
  assert.deepEqual(calls, [])
  assert.ok(panel.element.querySelectorAll('.editor-quality-gate-disabled-reason')
    .some((item) => item.hidden === false && item.textContent === 'Desktop pixel inspection is required'))
})

test('completed evidence dispatches once, pending evidence stays inert, and progress keys rove locally', () => {
  const documentRef = fakeDocument()
  const calls = []
  const input = reviewInput({
    caseOverrides: {
      0: {
        status: 'accepted', outcome: 'accepted', reviewRecorded: true,
        successfulCandidate: true,
        outcomeArtifactUrl: '/generated/frame-repair-quality-gates/frqg_20260712_panel/case_case_1_outcome.json',
      },
      1: { status: 'pending' },
    },
  })
  input.state.session.allowedArtifactUrls.push(
    '/generated/frame-repair-quality-gates/frqg_20260712_panel/case_case_1_outcome.json',
  )
  const panel = createFrameRepairQualityGatePanel({
    documentRef,
    onAction: (...args) => calls.push(args),
  })
  panel.render(input)
  const items = panel.element.querySelectorAll('.editor-quality-gate-progress-item')
  items[0].dispatchEvent({ type: 'click' })
  assert.deepEqual(calls, [[
    'select_evidence',
    {
      caseId: 'case_1',
      url: '/generated/frame-repair-quality-gates/frqg_20260712_panel/case_case_1_outcome.json',
    },
  ]])
  items[1].dispatchEvent({ type: 'click' })
  assert.equal(calls.length, 1)

  items[0].focus()
  items[0].dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true })
  assert.equal(documentRef.activeElement, items[1])
  assert.equal(items[1].tabIndex, 0)
  items[1].dispatchEvent({ type: 'keydown', key: 'End', bubbles: true })
  assert.equal(documentRef.activeElement, items[7])
})

test('blind reveal updates stable controls without replacing focus or leaking the mapping early', () => {
  const documentRef = fakeDocument()
  const panel = createFrameRepairQualityGatePanel({ documentRef })
  panel.render(reviewInput())
  const a = panel.element.querySelector('[data-quality-gate-action="set_view"]')
  const description = panel.element.querySelector('.editor-quality-gate-comparison-description')
  assert.equal(a.textContent, 'A')
  assert.doesNotMatch(description.textContent, /Original|Candidate/)
  a.focus()

  panel.render(reviewInput({ revealed: true }))
  assert.equal(panel.element.querySelector('[data-quality-gate-action="set_view"]'), a)
  assert.equal(documentRef.activeElement, a)
  assert.equal(a.textContent, 'Original')
  assert.match(description.textContent, /Mapping revealed/)
})

test('safe diagnostics ignore remote fields and destroy removes every action listener once', () => {
  const documentRef = fakeDocument()
  const calls = []
  const input = reviewInput()
  input.state.session.cases[0].operation = {
    reason: 'provider_rate_limited',
    remoteMessage: 'Bearer private-token /Users/private/provider.json',
  }
  const panel = createFrameRepairQualityGatePanel({ documentRef, onAction: (...args) => calls.push(args) })
  panel.render(input)
  const diagnostic = panel.element.querySelector('[data-evidence="diagnostic"]').querySelector('p')
  assert.match(diagnostic.textContent, /rate limited|rate-limited/i)
  assert.doesNotMatch(diagnostic.textContent, /Bearer|\/Users\/private/)
  panel.destroy()
  panel.destroy()
  panel.element.querySelector('[data-quality-gate-action="exit"]').dispatchEvent({ type: 'click' })
  assert.deepEqual(calls, [])
})
