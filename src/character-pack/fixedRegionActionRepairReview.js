import { createHash } from 'node:crypto'

export const FIXED_REGION_ACTION_REPAIR_REVIEW_PROTOCOL = 'fixed_region_action_repair_review_v1'
export const FIXED_REGION_ACTION_REPAIR_JOB_TYPE = 'editor_fixed_region_action_repair'
export const FIXED_REGION_ACTION_REPAIR_REVIEW_FILE = 'fixed_region_action_repair_review.json'
export const FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_PROTOCOL = 'fixed_region_action_repair_acceptance_v1'
export const FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE = 'fixed_region_action_repair_acceptance_manifest.json'

export const FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES = Object.freeze([
  Object.freeze({
    name: 'identity_anchor_atlas.png',
    role: 'verified_character_identity_only',
  }),
  Object.freeze({
    name: 'pose_guide_atlas.png',
    role: 'per_slot_pose_and_facing_only',
  }),
  Object.freeze({
    name: 'empty_output_atlas.png',
    role: 'independent_transparent_output_geometry',
  }),
])

export const FIXED_REGION_ACTION_REPAIR_MANAGED_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  source_quality_report: 'source_quality_report.json',
  sheet: 'normalized_sheet.png',
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  inspection_index: 'inspection_index.json',
  inspection_sheet: 'inspection_sheet.png',
  godot_npc_zip: 'godot_npc_pack.zip',
  rpgmaker_zip: 'rpgmaker_pack.zip',
  ocad_zip: 'ocad_pack.zip',
  zip: 'character_pack.zip',
  action_repair_plan: 'fixed_region_source_repair_plan.json',
  action_repair_review: FIXED_REGION_ACTION_REPAIR_REVIEW_FILE,
  action_repair_summary: 'fixed_region_source_repair_summary.json',
  action_repair_prompt: 'selected_prompt.txt',
  action_repair_identity_anchor_atlas: 'identity_anchor_atlas.png',
  action_repair_pose_guide_atlas: 'pose_guide_atlas.png',
  action_repair_empty_output_atlas: 'empty_output_atlas.png',
  action_repair_raw_provider_output: 'raw_provider_repair_atlas.png',
  action_repair_background_removed_atlas: 'background_removed_provider_atlas.png',
  action_repair_atlas_extraction: 'atlas_extraction_report.json',
  action_repair_provider_source: 'normalized_provider_source_sheet.png',
  action_repair_repaired_source: 'repaired_source_sheet.png',
  action_repair_review_candidate: 'candidate_scoped_review_only.png',
  action_repair_candidate_validation: 'candidate_validation_report.json',
  action_repair_scope: 'source_scope_report.json',
  action_repair_equipment_quality: 'equipment_quality_report.json',
  action_repair_equipment_overlay: 'equipment_quality_overlay.png',
  action_repair_equipment_body: 'equipment_body_candidate.png',
  action_repair_equipment_layer: 'equipment_layer.png',
  action_repair_acceptance_manifest: FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE,
})

const MANAGED_KEY_BY_FILE = new Map(
  Object.entries(FIXED_REGION_ACTION_REPAIR_MANAGED_FILES).map(([key, fileName]) => [fileName, key]),
)

export const FIXED_REGION_ACTION_REPAIR_REQUIRED_ACCEPTANCE_FILES = Object.freeze([
  'source.png',
  'normalized_sheet.png',
  'animations.json',
  'metadata.json',
  'editor_metadata.json',
  'debug_report.json',
  'character_pack.zip',
  'fixed_region_source_repair_plan.json',
  FIXED_REGION_ACTION_REPAIR_REVIEW_FILE,
  'fixed_region_source_repair_summary.json',
  'selected_prompt.txt',
  'identity_anchor_atlas.png',
  'pose_guide_atlas.png',
  'empty_output_atlas.png',
  'raw_provider_repair_atlas.png',
  'background_removed_provider_atlas.png',
  'atlas_extraction_report.json',
  'normalized_provider_source_sheet.png',
  'repaired_source_sheet.png',
  'candidate_scoped_review_only.png',
  'candidate_validation_report.json',
  'source_scope_report.json',
  'equipment_quality_report.json',
  'equipment_quality_overlay.png',
])

const HASH_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  )
}

export function stableActionRepairJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256ActionRepairBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  return createHash('sha256').update(bytes).digest('hex')
}

export function hashActionRepairValue(value) {
  return sha256ActionRepairBytes(Buffer.from(stableActionRepairJson(value), 'utf8'))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertSafeIdentity(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((item) => (
    typeof item !== 'string' || !item || item.includes('..')
  ))) throw new Error(`${label} is invalid`)
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`)
  return value
}

export function isSafeActionRepairArtifactFileName(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.startsWith('/') || value.startsWith('~')) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized !== value || !/^[A-Za-z0-9._/-]+$/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

export function fixedRegionActionRepairArtifactKey(fileName) {
  if (!isSafeActionRepairArtifactFileName(fileName)) throw new Error('action repair artifact file name is unsafe')
  return MANAGED_KEY_BY_FILE.get(fileName) ?? `sealed_${sha256ActionRepairBytes(fileName).slice(0, 24)}`
}

function referenceRecords(referenceImages = []) {
  if (!Array.isArray(referenceImages) || referenceImages.length !== FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES.length) {
    throw new Error('fixed-region action repair requires exactly three reference images')
  }
  return referenceImages.map((image, index) => {
    const expected = FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES[index]
    if (image?.name !== expected.name || image?.role !== expected.role || !Buffer.isBuffer(image?.buffer)) {
      throw new Error('fixed-region action repair reference identity changed')
    }
    return {
      name: image.name,
      role: image.role,
      byte_length: image.buffer.byteLength,
      sha256: sha256ActionRepairBytes(image.buffer),
    }
  })
}

function reviewIdentity(identity = {}) {
  return {
    project_id: assertSafeIdentity(identity.project_id ?? identity.projectId, 'project id'),
    asset_id: assertSafeIdentity(identity.asset_id ?? identity.assetId, 'asset id'),
    parent_revision_id: assertSafeIdentity(
      identity.parent_revision_id ?? identity.parentRevisionId,
      'parent revision id',
    ),
    source_job_id: assertSafeIdentity(identity.source_job_id ?? identity.sourceJobId, 'source job id'),
  }
}

export function buildFixedRegionActionRepairReviewContract({
  reviewId,
  identity,
  plan,
  sourceSheetBuffer,
  normalizedSheetBuffer,
  motionTemplateBuffer,
  referenceBundle,
} = {}) {
  if (!plan || !sourceSheetBuffer || !normalizedSheetBuffer || !motionTemplateBuffer || !referenceBundle) {
    throw new Error('complete fixed-region action repair review inputs are required')
  }
  const references = referenceRecords(referenceBundle.reference_images)
  const base = {
    protocol: FIXED_REGION_ACTION_REPAIR_REVIEW_PROTOCOL,
    job_type: FIXED_REGION_ACTION_REPAIR_JOB_TYPE,
    review_id: assertSafeIdentity(reviewId, 'review id'),
    identity: reviewIdentity(identity),
    source: {
      source_sheet_sha256: sha256ActionRepairBytes(sourceSheetBuffer),
      normalized_sheet_sha256: sha256ActionRepairBytes(normalizedSheetBuffer),
      motion_template_sha256: sha256ActionRepairBytes(motionTemplateBuffer),
    },
    selection: {
      source_layout: plan.source_layout,
      actions: [...(plan.actions ?? [])],
      region_keys: [...(plan.region_keys ?? [])],
      equipment_policy: plan.equipment_policy,
      instruction: plan.instruction,
      source_region_mask: cloneJson(plan.preflight?.source_region_mask ?? null),
    },
    provider: {
      preset_id: plan.provider?.id ?? plan.provider_preset_id,
      provider: plan.provider?.provider,
      model: plan.provider?.model,
      image_config: cloneJson(plan.provider?.image_config ?? plan.image_config ?? {}),
    },
    atlas: cloneJson(plan.atlas),
    atlas_evidence: cloneJson(referenceBundle.evidence),
    reference_policy: cloneJson(plan.reference_policy),
    references: {
      items: references,
      manifest_sha256: hashActionRepairValue(references),
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    automatic_retry: false,
    candidate_feedback: false,
  }
  return Object.freeze({
    ...base,
    plan_hash: hashActionRepairValue(base),
  })
}

export function assertFixedRegionActionRepairReviewContract(value) {
  if (!isPlainObject(value)) throw new Error('action repair review contract is invalid')
  const { plan_hash: planHash, ...base } = value
  if (value.protocol !== FIXED_REGION_ACTION_REPAIR_REVIEW_PROTOCOL ||
      value.job_type !== FIXED_REGION_ACTION_REPAIR_JOB_TYPE ||
      hashActionRepairValue(base) !== assertHash(planHash, 'action repair plan hash')) {
    throw new Error('action repair review contract hash changed')
  }
  assertSafeIdentity(value.review_id, 'review id')
  reviewIdentity(value.identity)
  assertHash(value.source?.source_sheet_sha256, 'source sheet hash')
  assertHash(value.source?.normalized_sheet_sha256, 'normalized sheet hash')
  assertHash(value.source?.motion_template_sha256, 'motion template hash')
  assertStringArray(value.selection?.actions, 'selected actions')
  assertStringArray(value.selection?.region_keys, 'selected region keys')
  if (value.estimated_provider_calls !== 1 || value.max_provider_calls !== 1 ||
      value.automatic_retry !== false || value.candidate_feedback !== false) {
    throw new Error('action repair provider-call contract is invalid')
  }
  const items = value.references?.items
  if (!Array.isArray(items) || items.length !== FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES.length) {
    throw new Error('action repair reference manifest is incomplete')
  }
  items.forEach((item, index) => {
    const expected = FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES[index]
    if (!isPlainObject(item) || item.name !== expected.name || item.role !== expected.role ||
        !Number.isSafeInteger(item.byte_length) || item.byte_length <= 0) {
      throw new Error('action repair reference manifest identity changed')
    }
    assertHash(item.sha256, 'reference hash')
  })
  if (value.references.manifest_sha256 !== hashActionRepairValue(items)) {
    throw new Error('action repair reference manifest hash changed')
  }
  return value
}

function acceptanceArtifactRecords(artifactEntries = []) {
  if (!Array.isArray(artifactEntries) || !artifactEntries.length) {
    throw new Error('action repair acceptance artifacts are required')
  }
  const seenKeys = new Set()
  const seenNames = new Set()
  return artifactEntries.map((entry) => {
    const fileName = entry?.file_name ?? entry?.fileName ?? entry?.name
    const key = fixedRegionActionRepairArtifactKey(fileName)
    if ((entry?.key != null && entry.key !== key) || !Buffer.isBuffer(entry?.content) ||
        seenKeys.has(key) || seenNames.has(fileName)) {
      throw new Error('action repair acceptance artifact identity is invalid')
    }
    seenKeys.add(key)
    seenNames.add(fileName)
    return {
      key,
      file_name: fileName,
      byte_length: entry.content.byteLength,
      sha256: sha256ActionRepairBytes(entry.content),
    }
  }).sort((left, right) => left.file_name.localeCompare(right.file_name))
}

export function buildFixedRegionActionRepairAcceptanceManifest({
  jobId,
  reviewContract,
  result,
  artifactEntries,
} = {}) {
  assertFixedRegionActionRepairReviewContract(reviewContract)
  const artifacts = acceptanceArtifactRecords(artifactEntries)
  const names = new Set(artifacts.map((entry) => entry.file_name))
  const missing = FIXED_REGION_ACTION_REPAIR_REQUIRED_ACCEPTANCE_FILES.filter((name) => !names.has(name))
  if (missing.length) throw new Error(`action repair acceptance artifacts are incomplete: ${missing.join(', ')}`)
  const base = {
    protocol: FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_PROTOCOL,
    job_type: FIXED_REGION_ACTION_REPAIR_JOB_TYPE,
    job_id: assertSafeIdentity(jobId, 'candidate job id'),
    identity: cloneJson(reviewContract.identity),
    review: {
      review_id: reviewContract.review_id,
      plan_hash: reviewContract.plan_hash,
      reference_manifest_sha256: reviewContract.references.manifest_sha256,
    },
    selection: cloneJson(reviewContract.selection),
    outcome: {
      repair_status: result?.status,
      provider_calls_used: result?.summary?.provider_calls_used,
      scope_status: result?.scope_validation?.status,
      outside_selected_changed_pixels: result?.scope_validation?.outside_selected_changed_pixels,
      quality_status: result?.summary?.quality_status,
      atlas_extraction_status: result?.summary?.atlas_extraction_status,
      accepted: false,
      requires_user_confirmation: true,
    },
    artifacts,
  }
  assertFixedRegionActionRepairPassingOutcome(base.outcome)
  return Object.freeze({
    ...base,
    manifest_sha256: hashActionRepairValue(base),
  })
}

export function assertFixedRegionActionRepairPassingOutcome(outcome) {
  if (!isPlainObject(outcome) || outcome.repair_status !== 'source_repaired' ||
      outcome.provider_calls_used !== 1 || outcome.scope_status !== 'scope_pass' ||
      outcome.outside_selected_changed_pixels !== 0 || outcome.quality_status !== 'pass' ||
      outcome.atlas_extraction_status !== 'extraction_pass' || outcome.accepted !== false ||
      outcome.requires_user_confirmation !== true) {
    throw new Error('action repair candidate did not pass the acceptance gates')
  }
  return outcome
}

export function assertFixedRegionActionRepairAcceptanceManifest(value) {
  if (!isPlainObject(value)) throw new Error('action repair acceptance manifest is invalid')
  const { manifest_sha256: manifestHash, ...base } = value
  if (value.protocol !== FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_PROTOCOL ||
      value.job_type !== FIXED_REGION_ACTION_REPAIR_JOB_TYPE ||
      hashActionRepairValue(base) !== assertHash(manifestHash, 'acceptance manifest hash')) {
    throw new Error('action repair acceptance manifest hash changed')
  }
  assertSafeIdentity(value.job_id, 'candidate job id')
  reviewIdentity(value.identity)
  assertSafeIdentity(value.review?.review_id, 'review id')
  assertHash(value.review?.plan_hash, 'review plan hash')
  assertHash(value.review?.reference_manifest_sha256, 'reference manifest hash')
  assertStringArray(value.selection?.actions, 'accepted actions')
  assertStringArray(value.selection?.region_keys, 'accepted region keys')
  assertFixedRegionActionRepairPassingOutcome(value.outcome)
  if (!Array.isArray(value.artifacts) || !value.artifacts.length) {
    throw new Error('action repair acceptance artifacts are incomplete')
  }
  const seenKeys = new Set()
  const seenNames = new Set()
  for (const entry of value.artifacts) {
    if (!isPlainObject(entry) || entry.key !== fixedRegionActionRepairArtifactKey(entry.file_name) ||
        !Number.isSafeInteger(entry.byte_length) || entry.byte_length <= 0 ||
        seenKeys.has(entry.key) || seenNames.has(entry.file_name)) {
      throw new Error('action repair acceptance artifact manifest is invalid')
    }
    assertHash(entry.sha256, 'acceptance artifact hash')
    seenKeys.add(entry.key)
    seenNames.add(entry.file_name)
  }
  const missing = FIXED_REGION_ACTION_REPAIR_REQUIRED_ACCEPTANCE_FILES.filter((name) => !seenNames.has(name))
  if (missing.length) throw new Error('action repair acceptance artifact manifest is incomplete')
  return value
}
