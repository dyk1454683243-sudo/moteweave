import assert from 'node:assert/strict'
import test from 'node:test'

import { FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS } from '../../src/editor-project/frameRepairQualityGateProtocol.js'
import { createFrameRepairQualityGateController } from '../../src/ui/editor/frameRepairQualityGateController.js'
import { QUALITY_GATE_RECOVERY_STORAGE_KEY } from '../../src/ui/editor/frameRepairQualityGateState.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const REVIEW_HASH = 'c'.repeat(64)

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    value() {
      const raw = values.get(QUALITY_GATE_RECOVERY_STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    },
  }
}

function characterAsset(id, revisionId = 'rev_001') {
  return {
    id,
    kind: 'character_pack',
    active_revision_id: revisionId,
    revisions: { [revisionId]: { id: revisionId } },
    clips: { walk_down: { frames: [16, 17], fps: 8 } },
  }
}

function sourceProject() {
  return {
    id: 'project_source', revision: 7, scenes: {},
    assets: Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
      const id = `asset_source_${index + 1}`
      return [id, characterAsset(id)]
    })),
  }
}

function targetProject(revision = 1) {
  const caseIds = [
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.map((item) => item.caseId),
    ...Array.from({ length: 6 }, (_, index) => `case_user_0${index + 1}`),
  ]
  return {
    id: 'project_quality_gate', revision, scenes: {},
    assets: Object.fromEntries(caseIds.map((caseId) => {
      const id = `asset_qg_${caseId}`
      return [id, characterAsset(id, revision > 1 && caseId === 'control_outline_alpha' ? 'rev_002' : 'rev_001')]
    })),
  }
}

function mapping() {
  return [
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.map((item) => ({
      caseId: item.caseId, targetAssetId: item.assetId, targetRevisionId: 'rev_001',
      ownershipClass: 'repository_control',
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      caseId: `case_user_0${index + 1}`,
      targetAssetId: `asset_qg_case_user_0${index + 1}`,
      targetRevisionId: 'rev_001',
      ownershipClass: 'user_owned',
    })),
  ]
}

function fullCases() {
  const categories = [
    ['shape', 'medium'], ['detail', 'medium'], ['anchor_baseline', 'medium'],
    ['facing_consistency', 'medium'], ['semantic_reconstruction', 'hard'],
    ['neighbor_continuity', 'hard'],
  ]
  return [
    ...structuredClone(FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS),
    ...categories.map(([defectCategory, difficulty], index) => ({
      caseId: `case_user_0${index + 1}`,
      assetId: `asset_qg_case_user_0${index + 1}`,
      expectedAssetRevisionId: 'rev_001',
      clipId: 'walk_down',
      clipFramePosition: 0,
      sheetFrameIndex: 16,
      instruction: `Repair case ${index + 1} only.`,
      maskEdits: [{ op: 'add_rectangle', x: 10 + index, y: 10, width: 8, height: 8 }],
      difficulty,
      defectCategory,
      expectedImprovement: `Case ${index + 1} has a coherent localized repair.`,
    })),
  ]
}

function sealedPlan(body) {
  return {
    protocol: 'frame_repair_quality_gate_plan_v1',
    session_id: body.sessionId,
    session_plan_hash: HASH_B,
    provider: { preset_id: body.providerPresetId, image_size: body.imageConfig.image_size },
    cases: body.cases.map((item, index) => ({
      case_id: item.caseId,
      display_index: index,
      asset_id: item.assetId,
      parent_revision_id: item.expectedAssetRevisionId,
      operation_id: `frqgop_${String(index + 1).padStart(48, '0')}`,
      case_hash: String(index + 1).repeat(64).slice(0, 64),
      repair: {
        clip_id: item.clipId,
        clip_frame_position: item.clipFramePosition,
        sheet_frame_index: item.sheetFrameIndex,
        instruction: item.instruction,
        mask_edits: structuredClone(item.maskEdits),
      },
      classification: {
        difficulty: item.difficulty,
        defect_category: item.defectCategory,
        expected_improvement: item.expectedImprovement,
        ownership_class: index < 2 ? 'repository_control' : 'user_owned',
      },
    })),
  }
}

function viewFor(runtime) {
  const reviewing = runtime.review != null && runtime.outcome == null
  return {
    session: {
      id: runtime.plan.session_id,
      projectId: 'project_quality_gate',
      projectRevision: runtime.project.revision,
      planHash: runtime.plan.session_plan_hash,
      providerPresetId: runtime.plan.provider.preset_id,
      imageSize: runtime.plan.provider.image_size,
      status: reviewing ? 'reviewing' : 'ready',
      blockingReason: null,
      callsUsed: runtime.generated ? 1 : 0,
      callsRemaining: runtime.generated ? 7 : 8,
    },
    cases: runtime.plan.cases.map((item, index) => ({
      caseId: item.case_id,
      displayIndex: index,
      assetId: item.asset_id,
      parentRevisionId: item.parent_revision_id,
      operationId: item.operation_id,
      caseHash: item.case_hash,
      repair: {
        clipId: item.repair.clip_id,
        clipFramePosition: item.repair.clip_frame_position,
        sheetFrameIndex: item.repair.sheet_frame_index,
        instruction: item.repair.instruction,
        maskEdits: structuredClone(item.repair.mask_edits),
      },
      classification: {
        difficulty: item.classification.difficulty,
        defectCategory: item.classification.defect_category,
        expectedImprovement: item.classification.expected_improvement,
        ownershipClass: item.classification.ownership_class,
      },
      status: index === 0
        ? runtime.outcome ?? (runtime.review ? 'awaiting_decision' : runtime.generated ? 'candidate_ready' : 'pending')
        : 'pending',
      reviewRecorded: index === 0 && Boolean(runtime.review),
      successfulCandidate: index === 0 && runtime.review ? true : null,
      outcome: index === 0 ? runtime.outcome : null,
      operation: index === 0 && runtime.generated
        ? { jobId: 'job_quality_1', status: 'done', providerCallsUsed: 1, generatedCandidateCount: 1, reason: null }
        : null,
      reviewArtifactUrl: null,
      outcomeArtifactUrl: null,
    })),
    artifacts: {},
    allowedArtifactUrls: [],
  }
}

function harness({ failAcceptedOutcome = false, storage = memoryStorage() } = {}) {
  const calls = []
  const adoptions = []
  let currentProject = sourceProject()
  let frameJob = null
  let failOutcome = failAcceptedOutcome
  const runtime = {
    project: targetProject(),
    plan: null,
    generated: false,
    review: null,
    outcome: null,
  }
  const api = {
    async setupFrameRepairQualityGate(input, options) {
      calls.push(['setup', structuredClone(input), options.signal])
      return { project: structuredClone(runtime.project), mapping: mapping(), setupManifestSha256: HASH_A }
    },
    async planFrameRepairQualityGate(input, options) {
      calls.push(['plan', structuredClone(input), options.signal])
      runtime.plan = sealedPlan(input.body)
      return structuredClone(runtime.plan)
    },
    async startFrameRepairQualityGate(input, options) {
      calls.push(['start', structuredClone(input), options.signal])
      return { plan: structuredClone(runtime.plan), blindOrder: {}, evidence: {} }
    },
    async fetchFrameRepairQualityGate(input, options) {
      calls.push(['fetch', structuredClone(input), options.signal])
      return structuredClone(viewFor(runtime))
    },
    async recordFrameRepairQualityGateReview(input, options) {
      calls.push(['review', structuredClone(input), options.signal])
      runtime.review = { sha256: REVIEW_HASH }
      return { sha256: REVIEW_HASH, review: { successful_candidate: true } }
    },
    async recordFrameRepairQualityGateOutcome(input, options) {
      calls.push(['outcome', structuredClone(input), options.signal])
      if (failOutcome && input.body.outcome === 'accepted') {
        failOutcome = false
        runtime.outcome = input.body.outcome
        throw new TypeError('connection reset after outcome write')
      }
      runtime.outcome = input.body.outcome
      return { sha256: 'd'.repeat(64), outcome: { outcome: runtime.outcome } }
    },
    async finalizeFrameRepairQualityGate(input, options) {
      calls.push(['finalize', structuredClone(input), options.signal])
      const view = viewFor(runtime)
      view.session.status = 'finalized'
      return { report: { decision: { result: 'evidence_insufficient' } }, view }
    },
    async loadEditorProject(projectId) {
      calls.push(['load_project', projectId])
      return { project: structuredClone(runtime.project) }
    },
  }
  const workbench = {
    async openAsset(asset) { calls.push(['open_asset', asset.id]); return {} },
    enterQualityGateAuthoringCase() { calls.push(['enter_author']); return true },
    exportQualityGateCaseDraft(metadata) {
      calls.push(['export_draft', structuredClone(metadata)])
      return {
        ...metadata, assetId: `asset_qg_${metadata.caseId}`, expectedAssetRevisionId: 'rev_001',
        clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 16,
        instruction: 'Repair only the selected defect.',
        maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
      }
    },
    selectFrameRepairClip(value) { calls.push(['select_clip', value]); return true },
    selectFrameRepairFrame(value) { calls.push(['select_frame', value]); return true },
    enterLockedQualityGateCase(value) { calls.push(['enter_locked', structuredClone(value)]); return true },
    async generateQualityGateCandidate(operationId) {
      calls.push(['generate', operationId])
      runtime.generated = true
      frameJob = { id: 'job_quality_1' }
      return frameJob
    },
    async acceptQualityGateCandidateDeferred() {
      calls.push(['accept_deferred'])
      runtime.project = targetProject(2)
      return {
        project: structuredClone(runtime.project),
        asset: runtime.project.assets.asset_qg_control_outline_alpha,
        revision: { id: 'rev_002' },
      }
    },
  }
  const frameRepair = {
    viewModel() {
      return {
        providerState: {
          active_preset_id: 'provider_safe',
          presets: [{ id: 'provider_safe', available: true }],
        },
        job: frameJob,
      }
    },
    async reviewCall() { calls.push(['frame_plan']); return { can_run: true, plan_hash: 'e'.repeat(64) } },
    async recoverOriginalOperation() { calls.push(['recover']); return { id: 'job_quality_1' } },
    close(reason) { calls.push(['close', reason]) },
  }
  async function adoptProject(project) {
    adoptions.push(structuredClone(project))
    currentProject = structuredClone(project)
  }
  const controller = createFrameRepairQualityGateController({
    api, repairWorkbench: workbench, frameRepair,
    getCurrentProject: () => currentProject,
    adoptProject,
    storage,
  })
  return { controller, api, workbench, frameRepair, calls, adoptions, runtime, storage, get project() { return currentProject } }
}

async function setupAndStart(h) {
  const sourceIds = Object.keys(h.project.assets)
  assert.equal(h.controller.selectSourceAssets(sourceIds), true)
  assert.equal(h.controller.confirmOwnership(true), true)
  await h.controller.setup({ targetProjectId: 'project_quality_gate' })
  assert.equal(h.controller.setCases(fullCases()), true)
  assert.equal(h.controller.preflightProvider(), true)
  await h.controller.plan()
  await h.controller.start()
}

async function reachSealedReview(h) {
  await setupAndStart(h)
  assert.equal(await h.controller.prepareCase('control_outline_alpha'), true)
  await h.controller.planActiveFrameRepair()
  assert.equal(h.calls.some(([type]) => type === 'generate'), false)
  await h.controller.generateActiveCase()
  assert.equal(h.controller.chooseBlindResult('prefer_b'), true)
  assert.equal(h.controller.revealBlindMapping(), true)
  await h.controller.sealReview({
    improvement: 'improved', usability: 'usable', newBlockingDefect: false,
    reasonCodes: ['outline_repaired'], note: null,
  })
}

test('controller runs Setup, zero-call Plan/Start, one explicit Generate, review, and deferred Accept in order', async () => {
  const h = harness()
  await reachSealedReview(h)
  await h.controller.acceptActiveCase()

  assert.deepEqual(h.calls.filter(([type]) => [
    'setup', 'plan', 'start', 'frame_plan', 'generate', 'review', 'accept_deferred', 'outcome',
  ].includes(type)).map(([type]) => type), [
    'setup', 'plan', 'start', 'frame_plan', 'generate', 'review', 'accept_deferred', 'outcome',
  ])
  assert.equal(h.adoptions.length, 2)
  assert.equal(h.adoptions[0].revision, 1)
  assert.equal(h.adoptions[1].revision, 2)
  assert.equal(h.runtime.outcome, 'accepted')
  assert.equal(h.controller.runAll, undefined)
  assert.equal(h.controller.retry, undefined)
  assert.equal(h.controller.batch, undefined)
})

test('Reject records a provider-free terminal outcome without adopting the target again', async () => {
  const h = harness()
  await reachSealedReview(h)
  await h.controller.rejectActiveCase()
  assert.equal(h.runtime.outcome, 'rejected')
  assert.equal(h.adoptions.length, 1)
  assert.equal(h.calls.some(([type]) => type === 'accept_deferred'), false)
})

test('blocked outcomes require and forward the durable Frame Repair job id', async () => {
  const h = harness()
  await setupAndStart(h)
  await h.controller.prepareCase('control_outline_alpha')
  await h.controller.planActiveFrameRepair()

  assert.equal(await h.controller.recordBlockedOutcome('provider_blocked'), null)
  assert.equal(h.calls.some(([type]) => type === 'outcome'), false)

  await h.controller.generateActiveCase()
  await h.controller.recordBlockedOutcome('provider_blocked')
  const outcomeCall = h.calls.find(([type]) => type === 'outcome')
  assert.equal(outcomeCall[1].body.jobId, 'job_quality_1')
  assert.equal(outcomeCall[1].body.outcome, 'provider_blocked')
})

test('authoring cancellation closes only the authoring rail and seals no case definition', async () => {
  const h = harness()
  const sourceIds = Object.keys(h.project.assets)
  h.controller.selectSourceAssets(sourceIds)
  h.controller.confirmOwnership(true)
  await h.controller.setup({ targetProjectId: 'project_quality_gate' })

  assert.equal(await h.controller.beginAuthoringCase('case_user_01'), true)
  assert.equal(h.controller.cancelAuthoringCase(), true)
  assert.equal(h.controller.capture().activeCaseStage, null)
  assert.equal(h.controller.capture().cases.length, 2)
  assert.deepEqual(h.calls.find(([type, reason]) => type === 'close' &&
    reason === 'quality_gate_case_cancelled'), ['close', 'quality_gate_case_cancelled'])
})

test('an interrupted accepted outcome stores only a safe handle and recovers without Generate or Accept', async () => {
  const storage = memoryStorage()
  const h = harness({ failAcceptedOutcome: true, storage })
  await reachSealedReview(h)
  assert.equal(await h.controller.acceptActiveCase(), null)
  const handle = storage.value()
  assert.deepEqual(Object.keys(handle).sort(), [
    'acceptedRevisionId', 'caseId', 'jobId', 'operationId', 'planHash', 'projectId',
    'projectRevision', 'reviewSha256', 'sessionId', 'setupManifestSha256',
  ])
  assert.equal(h.controller.capture().pendingOutcome.acceptedRevisionId, 'rev_002')

  const generateCount = h.calls.filter(([type]) => type === 'generate').length
  const acceptCount = h.calls.filter(([type]) => type === 'accept_deferred').length
  const outcomeCount = h.calls.filter(([type]) => type === 'outcome').length
  await h.controller.recoverPendingOutcome()
  assert.equal(h.runtime.outcome, 'accepted')
  assert.equal(h.calls.filter(([type]) => type === 'generate').length, generateCount)
  assert.equal(h.calls.filter(([type]) => type === 'accept_deferred').length, acceptCount)
  assert.equal(h.calls.filter(([type]) => type === 'outcome').length, outcomeCount)
  assert.equal(h.calls.some(([type]) => type === 'load_project'), true)
  assert.equal(h.controller.capture().pendingOutcome, null)
  assert.equal(storage.value().acceptedRevisionId, undefined)
})

test('close, project switch, and disposal abort work without starting generation', async () => {
  const h = harness()
  const pending = h.controller.rehydrate()
  h.controller.handleProjectSwitch()
  await pending
  h.controller.dispose()
  assert.equal(h.calls.some(([type]) => type === 'generate'), false)
  assert.equal(h.calls.some(([type]) => type === 'accept_deferred'), false)
})
