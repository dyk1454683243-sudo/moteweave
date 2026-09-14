import {
  acceptFixedRegionActionRepairCandidate,
  repairCharacterAction,
  waitForJob,
} from './api.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from '../../character-pack/sourceLayoutIds.js'

const ACTION_REPAIR_REFERENCE_ROLES = Object.freeze([
  'verified_character_identity_only',
  'per_slot_pose_and_facing_only',
  'independent_transparent_output_geometry',
])

export function buildAiActionRepairRequest({ ai, project, asset, revision, action, batch, plan = null, live = false } = {}) {
  const actions = batch?.available && batch.canPlan ? batch.actions : action ? [action] : []
  return {
    projectId: project?.id,
    assetId: asset?.id,
    parentRevisionId: revision?.id,
    jobId: revision?.source_job_id,
    animation: actions[0],
    actions,
    ...(batch?.available && batch.canPlan ? { regionKeys: batch.regionKeys } : {}),
    instruction: String(ai?.instruction ?? '').trim(),
    equipmentPolicy: ai?.equipmentPolicy,
    providerPresetId: ai?.providerPresetId || undefined,
    imageConfig: { image_size: ai?.imageSize || '1K' },
    ...(live
      ? {
          reviewedRunId: plan?.review_id,
          expectedPlanHash: plan?.plan_hash,
          expectedReferenceManifestSha256: plan?.reference_manifest_sha256,
          confirm_live_generation: true,
          maxProviderCalls: 1,
        }
      : { dryRunPlan: true }),
  }
}

export function singleCallActionRepairPlanErrors({ plan, project, asset, revision, selectedRegionKeys = [] } = {}) {
  const errors = []
  const actualKeys = Array.isArray(plan?.selected_region_keys) ? [...plan.selected_region_keys].sort() : []
  const expectedKeys = Array.isArray(selectedRegionKeys) ? [...selectedRegionKeys].sort() : []
  const sourceMask = plan?.preflight?.source_region_mask
  const maskRegions = Array.isArray(sourceMask?.regions) ? sourceMask.regions : []
  const maskKeys = maskRegions.map((region) => region?.key).sort()
  const expectedMaskSize = plan?.source_action_layout === TOPDOWN_RPG_SOURCE_LAYOUT_ID
    ? 768
    : plan?.source_action_layout === FIXED_REGION_MOTION_LAYOUT_ID
      ? 252
      : null
  if (plan?.repair_mode !== 'action_repair_atlas') errors.push('repair mode is not the required three-atlas workflow')
  const referenceDimensions = plan?.preflight?.image_dimensions?.references
  if (!project?.id || !asset?.id || !revision?.id) errors.push('target project, asset, or parent revision is missing')
  if (plan?.identity?.project_id !== project?.id || plan?.identity?.asset_id !== asset?.id ||
      plan.identity.parent_revision_id !== revision?.id ||
      plan.identity.source_job_id !== revision?.source_job_id) {
    errors.push('planned project, asset, parent revision, or source job identity changed')
  }
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) errors.push('selected action slots changed after planning')
  if (!expectedMaskSize || sourceMask?.width !== expectedMaskSize || sourceMask?.height !== expectedMaskSize ||
      !Array.isArray(sourceMask?.regions) ||
      JSON.stringify(maskKeys) !== JSON.stringify(expectedKeys) ||
      maskRegions.some((region) => !Number.isInteger(region?.x) || !Number.isInteger(region?.y) ||
        !Number.isInteger(region?.w) || !Number.isInteger(region?.h) || region.w <= 0 || region.h <= 0)) {
    errors.push('selected source-region mask does not match the exact action slots')
  }
  if (plan?.reference_policy?.source_target_regions_holed !== false) errors.push('source target slots are not confirmed intact')
  if (plan?.reference_policy?.full_source_sheet_sent !== false ||
      plan?.reference_policy?.full_normalized_sheet_sent !== false) errors.push('a full character sheet would be sent to the provider')
  if (plan?.reference_policy?.provider_candidate_feedback !== false) errors.push('provider candidate feedback is not disabled')
  if (JSON.stringify(plan?.preflight?.reference_roles ?? []) !== JSON.stringify(ACTION_REPAIR_REFERENCE_ROLES)) {
    errors.push('reference roles do not match the three-atlas contract')
  }
  if (!plan?.repair_identity_anchor_atlas_url || !plan?.repair_pose_guide_atlas_url ||
      !plan?.repair_empty_output_atlas_url) errors.push('one or more required reference atlases are missing')
  if (!plan?.action_repair_review_contract_url || !plan?.review_id ||
      !/^[a-f0-9]{64}$/.test(plan?.plan_hash ?? '') ||
      !/^[a-f0-9]{64}$/.test(plan?.reference_manifest_sha256 ?? '')) {
    errors.push('sealed action repair review contract is incomplete')
  }
  if (referenceDimensions?.width !== 1024 || referenceDimensions?.height !== 1024) {
    errors.push('reference atlas dimensions are not 1024x1024')
  }
  if (!plan?.provider?.provider || !(plan?.provider?.model ?? plan?.model)) errors.push('provider or model identity is missing')
  if (plan?.estimated_provider_calls !== 1) errors.push('provider call estimate is not exactly one')
  return errors
}

export function actionRepairProviderConfirmation({
  plan,
  asset,
  revision,
  selectedSlots,
  imageSize,
} = {}) {
  const references = plan?.preflight?.reference_roles ?? ACTION_REPAIR_REFERENCE_ROLES
  const dimensions = plan?.preflight?.image_dimensions?.references
  const sourceMask = plan?.preflight?.source_region_mask
  return [
    'Confirm the single provider call:',
    `Asset: ${asset?.id ?? '-'}`,
    `Parent revision: ${revision?.id ?? '-'}`,
    `Selected action slots: ${(selectedSlots ?? []).join(', ') || '-'}`,
    `Selected-region mask: ${sourceMask ? `${sourceMask.width}x${sourceMask.height}, ${sourceMask.regions?.length ?? 0} exact full-slot rectangles` : '-'}`,
    `References: ${references.join(', ')}`,
    'Reference files: identity_anchor_atlas.png, pose_guide_atlas.png, empty_output_atlas.png',
    `Source target slots holed: ${plan?.reference_policy?.source_target_regions_holed === false ? 'no' : 'INVALID'}`,
    `Provider / model: ${plan?.provider?.provider ?? '-'} / ${plan?.provider?.model ?? plan?.model ?? '-'}`,
    `Review id / plan hash: ${plan?.review_id ?? '-'} / ${plan?.plan_hash ?? '-'}`,
    `Reference manifest: ${plan?.reference_manifest_sha256 ?? '-'}`,
    `Atlas dimensions: ${dimensions ? `${dimensions.width}x${dimensions.height}` : '-'}; requested output: ${plan?.image_config?.image_size ?? imageSize ?? '-'}`,
    `Estimated provider calls: ${plan?.estimated_provider_calls ?? '-'}`,
    'Result: review-only candidate. No asset revision will be created until you explicitly accept it.',
  ].join('\n')
}

export function actionRepairAcceptanceConfirmation({ job, asset, revision, slots = [] } = {}) {
  return [
    'Accept this reviewed candidate as a new asset revision?',
    `Candidate job: ${job?.id ?? '-'}`,
    `Asset: ${asset?.id ?? '-'}`,
    `Required parent revision: ${revision?.id ?? '-'}`,
    `Corrected action slots: ${slots.join(', ') || '-'}`,
    'This step imports the existing candidate and does not call the provider again.',
  ].join('\n')
}

export function completedActionRepairJobErrors({ job, plan, selectedRegionKeys = [] } = {}) {
  const errors = []
  const actualKeys = Array.isArray(job?.selected_region_keys) ? [...job.selected_region_keys].sort() : []
  const expectedKeys = Array.isArray(selectedRegionKeys) ? [...selectedRegionKeys].sort() : []
  if (job?.provider_call_budget?.used_provider_calls !== 1) errors.push('provider call ledger is not exactly one')
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) errors.push('completed candidate slots do not match the reviewed plan')
  if (job?.source_scope_status !== 'scope_pass') errors.push('source pixel scope did not pass')
  if (job?.outside_selected_changed_pixels !== 0) errors.push('candidate changed pixels outside the selected source slots')
  if (!job?.source_scope_report_url || !job?.review_candidate_source_sheet_url) errors.push('candidate scope evidence is incomplete')
  if (job?.action_repair_plan_hash !== plan?.plan_hash ||
      job?.action_repair_reference_manifest_sha256 !== plan?.reference_manifest_sha256 ||
      !job?.action_repair_acceptance_manifest_url ||
      !/^[a-f0-9]{64}$/.test(job?.action_repair_manifest_sha256 ?? '')) {
    errors.push('candidate sealed acceptance evidence is incomplete')
  }
  if (job?.accepted !== false || job?.requires_user_confirmation !== true) errors.push('candidate acceptance boundary is invalid')
  return errors
}

export function createAiActionRepairWorkflow({
  state,
  getRepairContext,
  getPreferredAction,
  getBatchSelection,
  getAssetRevision,
  saveProject,
  adoptProject,
  render,
  log,
  confirm,
  api = { acceptFixedRegionActionRepairCandidate, repairCharacterAction, waitForJob },
} = {}) {
  const request = ({ live = false } = {}) => {
    const ai = state.repair.aiAction
    const { asset, revision } = getRepairContext()
    return buildAiActionRepairRequest({
      ai,
      project: state.project,
      asset,
      revision,
      action: getPreferredAction(),
      batch: getBatchSelection(),
      plan: ai.plan,
      live,
    })
  }

  const fail = (error) => {
    Object.assign(state.repair.aiAction, { status: 'error', message: error?.message || String(error) })
    log(state.repair.aiAction.message)
    render()
  }

  async function plan() {
    const { asset, revision } = getRepairContext()
    const action = getPreferredAction()
    const batch = getBatchSelection()
    const canPlan = batch.available ? batch.canPlan : Boolean(action)
    if (!asset || !revision?.source_job_id || !canPlan || !String(state.repair.aiAction.instruction ?? '').trim()) return
    Object.assign(state.repair.aiAction, { status: 'planning', message: 'planning repair' })
    render()
    try {
      const result = await api.repairCharacterAction(request())
      state.repair.aiAction = {
        ...state.repair.aiAction,
        selectedAction: batch.available ? (batch.actions[0] ?? action) : action,
        selectedRegionKeys: batch.available ? [...batch.regionKeys] : [],
        plan: result,
        job: null,
        importResult: null,
        status: result.can_run ? 'planned' : 'blocked',
        message: result.can_run ? 'repair plan ready' : result.preflight?.errors?.[0] ?? 'repair plan blocked',
        assetId: asset.id,
        revisionId: revision.id,
      }
      log(`Action repair plan: ${batch.available ? batch.regionKeys.join(', ') : action}`)
      render()
    } catch (error) {
      fail(error)
    }
  }

  async function run() {
    const { asset, revision } = getRepairContext()
    const action = getPreferredAction()
    const ai = state.repair.aiAction
    const batch = getBatchSelection()
    const resultPlan = ai.plan
    const canRun = batch.available ? batch.canPlan : Boolean(action)
    if (!asset || !revision?.source_job_id || !canRun || !resultPlan?.can_run ||
        ai.assetId !== asset.id || ai.revisionId !== revision.id) return
    const selectedSlots = resultPlan.selected_region_keys ?? (batch.available ? batch.regionKeys : [action])
    const identityErrors = singleCallActionRepairPlanErrors({
      plan: resultPlan,
      project: state.project,
      asset,
      revision,
      selectedRegionKeys: batch.available ? batch.regionKeys : selectedSlots,
    })
    if (identityErrors.length) {
      Object.assign(ai, { status: 'blocked', message: identityErrors[0] })
      log(`Action repair blocked before provider call: ${identityErrors.join('; ')}`)
      render()
      return
    }
    if (!confirm(actionRepairProviderConfirmation({
      plan: resultPlan,
      asset,
      revision,
      selectedSlots,
      imageSize: ai.imageSize,
    }))) return
    Object.assign(ai, { status: 'running', message: 'repair job queued' })
    render()
    try {
      let job = await api.repairCharacterAction(request({ live: true }))
      job = await api.waitForJob(job, (current) => {
        state.repair.aiAction.job = current
        state.repair.aiAction.message = current.status ?? 'running'
        render()
      })
      state.repair.aiAction.job = job
      if (job.status !== 'done') {
        Object.assign(state.repair.aiAction, { status: 'error', message: job.reason || job.status || 'repair failed' })
        log(state.repair.aiAction.message)
        render()
        return
      }
      const completionErrors = completedActionRepairJobErrors({
        job,
        plan: resultPlan,
        selectedRegionKeys: selectedSlots,
      })
      if (completionErrors.length) {
        Object.assign(state.repair.aiAction, { status: 'error', message: completionErrors[0] })
        log(`Action repair candidate blocked after provider call: ${completionErrors.join('; ')}`)
        render()
        return
      }
      Object.assign(state.repair.aiAction, {
        job,
        importResult: null,
        status: 'candidate_ready',
        message: 'review-only candidate ready; inspect it before accepting',
        assetId: asset.id,
        revisionId: revision.id,
      })
      log(`Action repair candidate ready: ${asset.id} from ${revision.id}`)
      render()
    } catch (error) {
      fail(error)
    }
  }

  async function accept() {
    let { asset, revision } = getRepairContext()
    const ai = state.repair.aiAction
    const job = ai.job
    if (!asset || !revision || ai.status !== 'candidate_ready' || job?.status !== 'done' || ai.importResult ||
        ai.assetId !== asset.id || ai.revisionId !== revision.id) return
    const slots = job.selected_region_keys ?? ai.plan?.selected_region_keys ?? ai.selectedRegionKeys
    if (!confirm(actionRepairAcceptanceConfirmation({ job, asset, revision, slots }))) return
    if (state.dirty) {
      const saved = await saveProject()
      if (!saved) return
      asset = state.project.assets?.[asset.id]
      revision = getAssetRevision(asset)
    }
    if (!asset || revision?.id !== ai.revisionId) {
      Object.assign(ai, { status: 'error', message: 'active asset revision changed; candidate was not accepted' })
      render()
      return
    }
    Object.assign(ai, { status: 'accepting', message: 'accepting reviewed candidate' })
    render()
    try {
      const imported = await api.acceptFixedRegionActionRepairCandidate({
        projectId: state.project.id,
        assetId: asset.id,
        jobId: job.id,
        expectedRevision: state.project.revision,
        expectedAssetRevisionId: revision.id,
        expectedPlanHash: ai.plan.plan_hash,
      })
      const previousAi = { ...ai }
      adoptProject(imported.project)
      state.selectedAssetId = asset.id
      state.selectedLayerId = null
      state.activePanel = 'repair'
      state.repair.aiAction = {
        ...state.repair.aiAction,
        selectedAction: previousAi.selectedAction,
        selectedRegionKeys: [],
        instruction: previousAi.instruction,
        equipmentPolicy: previousAi.equipmentPolicy,
        providerPresetId: previousAi.providerPresetId,
        imageSize: previousAi.imageSize,
        plan: null,
        job,
        importResult: imported,
        status: 'imported',
        message: `accepted as ${imported.revision.id}`,
        assetId: asset.id,
        revisionId: imported.revision.id,
      }
      log(`Action repair accepted: ${asset.id} ${imported.revision.id}`)
      render()
    } catch (error) {
      fail(error)
    }
  }

  return Object.freeze({ accept, plan, request, run })
}
