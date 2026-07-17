import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptyFrameRepairQualityGateState,
  getFrameRepairQualityGateUiModel,
  parseFrameRepairQualityGateRecoveryHandle,
  reduceFrameRepairQualityGateState,
} from '../../src/ui/editor/frameRepairQualityGateState.js'

test('quality-gate state is frozen, phase-exact, stale-safe, and honest about desktop review', () => {
  let state = createEmptyFrameRepairQualityGateState()
  assert.equal(Object.isFrozen(state), true)
  state = reduceFrameRepairQualityGateState(state, { type: 'phase', phase: 'authoring' })
  assert.equal(getFrameRepairQualityGateUiModel(state).authoringWarning, 'Not saved until Start')
  const stale = reduceFrameRepairQualityGateState(state, {
    type: 'planned', generation: 99, plan: { session_plan_hash: 'a'.repeat(64) },
  })
  assert.deepEqual(stale, state)
  state = reduceFrameRepairQualityGateState(state, {
    type: 'session',
    session: {
      session: { status: 'reviewing' },
      cases: [{ caseId: 'case_a', status: 'awaiting_decision', reviewRecorded: true, outcome: null }],
    },
  })
  state = reduceFrameRepairQualityGateState(state, { type: 'active_case', caseId: 'case_a' })
  state = reduceFrameRepairQualityGateState(state, { type: 'blind_choice', choice: 'prefer_a' })
  state = reduceFrameRepairQualityGateState(state, { type: 'revealed' })
  const mobile = getFrameRepairQualityGateUiModel(state, { desktopReviewAllowed: false })
  assert.equal(mobile.acceptEnabled, false)
  assert.equal(mobile.rejectEnabled, false)
  assert.equal(mobile.desktopDisabledReason, 'Desktop pixel inspection is required')
})

test('Start needs eight exact cases, provider preflight, Setup authority, and a server plan hash', () => {
  let state = createEmptyFrameRepairQualityGateState()
  state = reduceFrameRepairQualityGateState(state, { type: 'ownership', confirmed: true })
  state = reduceFrameRepairQualityGateState(state, {
    type: 'source_assets', assets: Array.from({ length: 6 }, (_, index) => ({ assetId: `asset_${index}` })),
  })
  assert.equal(getFrameRepairQualityGateUiModel(state).setupEnabled, true)
  state = reduceFrameRepairQualityGateState(state, {
    type: 'setup', setup: { setupManifestSha256: 'a'.repeat(64) },
  })
  state = reduceFrameRepairQualityGateState(state, {
    type: 'cases',
    cases: [
      ...Array.from({ length: 2 }, (_, index) => ({ caseId: `basic_${index}`, difficulty: 'basic' })),
      ...Array.from({ length: 4 }, (_, index) => ({ caseId: `medium_${index}`, difficulty: 'medium' })),
      ...Array.from({ length: 2 }, (_, index) => ({ caseId: `hard_${index}`, difficulty: 'hard' })),
    ],
  })
  state = reduceFrameRepairQualityGateState(state, {
    type: 'planned', plan: { session_plan_hash: 'b'.repeat(64) },
  })
  assert.equal(getFrameRepairQualityGateUiModel(state).startEnabled, false)
  state = reduceFrameRepairQualityGateState(state, {
    type: 'provider_preflight', value: { available: true, providerPresetId: 'provider_safe' },
  })
  assert.equal(getFrameRepairQualityGateUiModel(state).startEnabled, true)
})

test('progress separates visual success from disposition and locks later cases while one is active', () => {
  let state = createEmptyFrameRepairQualityGateState()
  state = reduceFrameRepairQualityGateState(state, {
    type: 'session',
    session: {
      session: { status: 'running' },
      cases: [
        { caseId: 'case_a', status: 'accepted', reviewRecorded: true, successfulCandidate: false, outcome: 'accepted' },
        { caseId: 'case_b', status: 'pending', reviewRecorded: false, successfulCandidate: null, outcome: null },
      ],
    },
  })
  state = reduceFrameRepairQualityGateState(state, { type: 'active_case', caseId: 'case_b' })
  const model = getFrameRepairQualityGateUiModel(state)
  assert.equal(model.progress[0].visualResult, 'Visual not successful')
  assert.equal(model.progress[0].outcomeLabel, 'accepted')
  assert.equal(model.remainingCasesLocked, true)
})

test('recovery handle accepts only the narrow safe projection', () => {
  const handle = {
    projectId: 'project_gate', sessionId: 'frqg_20260713_primary', planHash: 'a'.repeat(64),
    caseId: 'case_shape', operationId: 'frqgop_' + 'b'.repeat(48), jobId: 'job_1',
    acceptedRevisionId: null, projectRevision: 2, reviewSha256: 'c'.repeat(64),
  }
  assert.deepEqual(parseFrameRepairQualityGateRecoveryHandle(JSON.stringify(handle)), handle)
  for (const invalid of [
    { ...handle, path: '/tmp/private' },
    { ...handle, url: 'https://invalid.example' },
    { ...handle, note: 'private' },
    { ...handle, apiKey: 'secret' },
    { ...handle, planHash: 'wrong' },
  ]) assert.equal(parseFrameRepairQualityGateRecoveryHandle(invalid), null)
})
