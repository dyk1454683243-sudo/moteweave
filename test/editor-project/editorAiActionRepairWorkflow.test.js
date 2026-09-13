import test from 'node:test'
import assert from 'node:assert/strict'

import {
  actionRepairProviderConfirmation,
  buildAiActionRepairRequest,
  completedActionRepairJobErrors,
  createAiActionRepairWorkflow,
  singleCallActionRepairPlanErrors,
} from '../../src/ui/editor/aiActionRepairWorkflow.js'

const REFERENCE_ROLES = [
  'verified_character_identity_only',
  'per_slot_pose_and_facing_only',
  'independent_transparent_output_geometry',
]

function validPlan() {
  return {
    can_run: true,
    repair_mode: 'action_repair_atlas',
    source_action_layout: 'fixed_region_motion_v0',
    selected_region_keys: ['idledown'],
    estimated_provider_calls: 1,
    image_config: { image_size: '1K' },
    provider: { provider: 'gemini', model: 'gemini-image-model' },
    review_id: 'review_pig_001',
    plan_hash: 'a'.repeat(64),
    reference_manifest_sha256: 'b'.repeat(64),
    identity: {
      project_id: 'project_pig',
      asset_id: 'asset_pig',
      parent_revision_id: 'rev_001',
      source_job_id: 'job_parent',
    },
    reference_policy: {
      source_target_regions_holed: false,
      full_source_sheet_sent: false,
      full_normalized_sheet_sent: false,
      provider_candidate_feedback: false,
    },
    preflight: {
      reference_roles: REFERENCE_ROLES,
      source_region_mask: {
        width: 252,
        height: 252,
        regions: [{ key: 'idledown', x: 0, y: 0, w: 36, h: 36 }],
      },
      image_dimensions: { references: { width: 1024, height: 1024 } },
    },
    repair_identity_anchor_atlas_url: '/identity.png',
    repair_pose_guide_atlas_url: '/pose.png',
    repair_empty_output_atlas_url: '/empty.png',
    action_repair_review_contract_url: '/review.json',
  }
}

test('action repair request keeps one exact batch and separates dry plan from the live call', () => {
  const common = {
    ai: {
      instruction: 'Remove the weapon and correct the complete pose.',
      equipmentPolicy: 'none',
      providerPresetId: 'gemini-default',
      imageSize: '1K',
    },
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    action: 'idledown',
    batch: { available: true, canPlan: true, actions: ['idledown'], regionKeys: ['idledown'] },
  }
  const dry = buildAiActionRepairRequest(common)
  const live = buildAiActionRepairRequest({ ...common, plan: validPlan(), live: true })

  assert.deepEqual(dry.regionKeys, ['idledown'])
  assert.equal(dry.dryRunPlan, true)
  assert.equal(Object.hasOwn(dry, 'confirm_live_generation'), false)
  assert.equal(live.confirm_live_generation, true)
  assert.equal(live.maxProviderCalls, 1)
  assert.equal(live.expectedPlanHash, 'a'.repeat(64))
  assert.equal(live.expectedReferenceManifestSha256, 'b'.repeat(64))
  assert.equal(live.parentRevisionId, 'rev_001')
  assert.equal(Object.hasOwn(live, 'dryRunPlan'), false)
})

test('single-call review blocks any drift in identity, references, dimensions, or quota', () => {
  const plan = validPlan()
  assert.deepEqual(singleCallActionRepairPlanErrors({
    plan,
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    selectedRegionKeys: ['idledown'],
  }), [])

  const invalid = structuredClone(plan)
  invalid.reference_policy.source_target_regions_holed = true
  invalid.estimated_provider_calls = 2
  assert.deepEqual(singleCallActionRepairPlanErrors({
    plan: invalid,
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    selectedRegionKeys: ['idledown'],
  }), [
    'source target slots are not confirmed intact',
    'provider call estimate is not exactly one',
  ])

  const malformedMask = validPlan()
  malformedMask.preflight.source_region_mask.regions = {}
  assert.deepEqual(singleCallActionRepairPlanErrors({
    plan: malformedMask,
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    selectedRegionKeys: ['idledown'],
  }), ['selected source-region mask does not match the exact action slots'])

  const legacyMode = validPlan()
  legacyMode.repair_mode = 'character_action_provider_repair'
  assert.deepEqual(singleCallActionRepairPlanErrors({
    plan: legacyMode,
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    selectedRegionKeys: ['idledown'],
  }), ['repair mode is not the required three-atlas workflow'])

  const topdown = validPlan()
  topdown.source_action_layout = 'topdown_rpg_v0'
  topdown.selected_region_keys = ['attack_left_0']
  topdown.preflight.source_region_mask = {
    width: 768,
    height: 768,
    regions: [{ key: 'attack_left_0', x: 0, y: 480, w: 96, h: 96 }],
  }
  assert.deepEqual(singleCallActionRepairPlanErrors({
    plan: topdown,
    project: { id: 'project_pig' },
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001', source_job_id: 'job_parent' },
    selectedRegionKeys: ['attack_left_0'],
  }), [])
})

test('provider confirmation always presents the sealed three-atlas contract', () => {
  const confirmation = actionRepairProviderConfirmation({
    plan: validPlan(),
    asset: { id: 'asset_pig' },
    revision: { id: 'rev_001' },
    selectedSlots: ['idledown'],
  })
  assert.match(confirmation, /identity_anchor_atlas\.png/)
  assert.match(confirmation, /pose_guide_atlas\.png/)
  assert.match(confirmation, /empty_output_atlas\.png/)
  assert.match(confirmation, /Source target slots holed: no/)
  assert.match(confirmation, /Review id \/ plan hash:/)
  assert.match(confirmation, /Estimated provider calls: 1/)
  assert.doesNotMatch(confirmation, /INVALID/)
})

test('completed candidate requires an exact one-call ledger and zero out-of-scope pixels', () => {
  const job = {
    selected_region_keys: ['idledown'],
    provider_call_budget: { used_provider_calls: 1 },
    source_scope_status: 'scope_pass',
    outside_selected_changed_pixels: 0,
    source_scope_report_url: '/scope.json',
    review_candidate_source_sheet_url: '/candidate.png',
    action_repair_plan_hash: 'a'.repeat(64),
    action_repair_reference_manifest_sha256: 'b'.repeat(64),
    action_repair_acceptance_manifest_url: '/acceptance.json',
    action_repair_manifest_sha256: 'c'.repeat(64),
    accepted: false,
    requires_user_confirmation: true,
  }
  assert.deepEqual(completedActionRepairJobErrors({ job, plan: validPlan(), selectedRegionKeys: ['idledown'] }), [])
  assert.deepEqual(completedActionRepairJobErrors({
    job: { ...job, provider_call_budget: { used_provider_calls: 2 } },
    plan: validPlan(),
    selectedRegionKeys: ['idledown'],
  }), ['provider call ledger is not exactly one'])
})

test('one live call stops at candidate review and only a later accept imports with the exact parent revision', async () => {
  const revision = { id: 'rev_001', source_job_id: 'job_parent' }
  const asset = {
    id: 'asset_pig',
    active_revision_id: revision.id,
    revisions: { [revision.id]: revision },
  }
  const state = {
    dirty: false,
    project: { id: 'project_pig', revision: 4, assets: { [asset.id]: asset } },
    selectedAssetId: asset.id,
    selectedLayerId: null,
    activePanel: 'repair',
    repair: {
      aiAction: {
        selectedAction: 'idledown', selectedRegionKeys: ['idledown'],
        instruction: 'Remove the weapon and correct the complete pose.', equipmentPolicy: 'none',
        providerPresetId: 'gemini-default', imageSize: '1K', plan: validPlan(), job: null,
        importResult: null, status: 'planned', message: '', assetId: asset.id, revisionId: revision.id,
      },
    },
  }
  const calls = { provider: [], import: [], confirm: [], render: 0, log: [] }
  const importedRevision = { id: 'rev_002', source_job_id: 'job_candidate', parent_revision_id: revision.id }
  const importedProject = {
    ...state.project,
    revision: 5,
    assets: {
      [asset.id]: {
        ...asset,
        active_revision_id: importedRevision.id,
        revisions: { ...asset.revisions, [importedRevision.id]: importedRevision },
      },
    },
  }
  const workflow = createAiActionRepairWorkflow({
    state,
    getRepairContext: () => {
      const currentAsset = state.project.assets[state.selectedAssetId]
      return { asset: currentAsset, revision: currentAsset.revisions[currentAsset.active_revision_id] }
    },
    getPreferredAction: () => 'idledown',
    getBatchSelection: () => ({
      available: true, canPlan: true, actions: ['idledown'], regionKeys: ['idledown'],
    }),
    getAssetRevision: (currentAsset) => currentAsset.revisions[currentAsset.active_revision_id],
    saveProject: async () => state.project,
    adoptProject: (project) => { state.project = project },
    render: () => { calls.render += 1 },
    log: (message) => { calls.log.push(message) },
    confirm: (message) => { calls.confirm.push(message); return true },
    api: {
      async repairCharacterAction(request) {
        calls.provider.push(request)
        return { id: 'job_candidate', status: 'queued' }
      },
      async waitForJob(job, onUpdate) {
        onUpdate({ ...job, status: 'generating' })
        return {
          id: job.id,
          status: 'done',
          selected_region_keys: ['idledown'],
          provider_call_budget: { used_provider_calls: 1 },
          source_scope_status: 'scope_pass',
          outside_selected_changed_pixels: 0,
          source_scope_report_url: '/scope.json',
          review_candidate_source_sheet_url: '/candidate.png',
          action_repair_plan_hash: 'a'.repeat(64),
          action_repair_reference_manifest_sha256: 'b'.repeat(64),
          action_repair_acceptance_manifest_url: '/acceptance.json',
          action_repair_manifest_sha256: 'c'.repeat(64),
          accepted: false,
          requires_user_confirmation: true,
        }
      },
      async acceptFixedRegionActionRepairCandidate(request) {
        calls.import.push(request)
        return { project: importedProject, asset: importedProject.assets[asset.id], revision: importedRevision }
      },
    },
  })

  await workflow.run()
  assert.equal(calls.provider.length, 1)
  assert.equal(calls.provider[0].maxProviderCalls, 1)
  assert.equal(calls.import.length, 0)
  assert.equal(state.repair.aiAction.status, 'candidate_ready')
  assert.match(calls.confirm[0], /review-only candidate/i)

  await workflow.accept()
  assert.equal(calls.provider.length, 1)
  assert.equal(calls.import.length, 1)
  assert.equal(calls.import[0].expectedAssetRevisionId, 'rev_001')
  assert.equal(calls.import[0].expectedPlanHash, 'a'.repeat(64))
  assert.equal(state.repair.aiAction.status, 'imported')
  assert.equal(state.repair.aiAction.revisionId, 'rev_002')
  assert.match(calls.confirm[1], /does not call the provider again/i)
})
