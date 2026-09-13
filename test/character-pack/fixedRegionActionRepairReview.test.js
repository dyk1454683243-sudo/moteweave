import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES,
  FIXED_REGION_ACTION_REPAIR_REQUIRED_ACCEPTANCE_FILES,
  assertFixedRegionActionRepairAcceptanceManifest,
  assertFixedRegionActionRepairReviewContract,
  buildFixedRegionActionRepairAcceptanceManifest,
  buildFixedRegionActionRepairReviewContract,
} from '../../src/character-pack/fixedRegionActionRepairReview.js'

function reviewContract() {
  const referenceBundle = {
    reference_images: FIXED_REGION_ACTION_REPAIR_REFERENCE_FILES.map((item, index) => ({
      ...item,
      buffer: Buffer.from(`reference-${index}`),
    })),
    evidence: { version: 'fixed_region_action_repair_atlas_v1', target_holes_zero_rgba: true },
  }
  return buildFixedRegionActionRepairReviewContract({
    reviewId: 'review_001',
    identity: {
      project_id: 'project_pig',
      asset_id: 'asset_pig',
      parent_revision_id: 'rev_001',
      source_job_id: 'job_parent',
    },
    plan: {
      source_layout: 'fixed_region_motion_v0',
      actions: ['idledown'],
      region_keys: ['idledown'],
      equipment_policy: 'none',
      instruction: 'Remove the weapon and correct the complete pose.',
      preflight: {
        source_region_mask: {
          width: 252,
          height: 252,
          regions: [{ key: 'idledown', x: 0, y: 0, w: 36, h: 36 }],
        },
      },
      provider: {
        id: 'gemini-default',
        provider: 'gemini',
        model: 'gemini-image-model',
        image_config: { aspect_ratio: '1:1', image_size: '1K' },
      },
      atlas: { width: 1024, height: 1024, columns: 6, rows: 2 },
      reference_policy: {
        source_target_regions_holed: false,
        full_source_sheet_sent: false,
        full_normalized_sheet_sent: false,
        provider_candidate_feedback: false,
      },
    },
    sourceSheetBuffer: Buffer.from('source'),
    normalizedSheetBuffer: Buffer.from('normalized'),
    motionTemplateBuffer: Buffer.from('template'),
    referenceBundle,
  })
}

test('fixed-region action repair review hash seals identity, sources, provider, selection, and three references', () => {
  const review = reviewContract()
  assert.equal(assertFixedRegionActionRepairReviewContract(review), review)
  assert.match(review.plan_hash, /^[a-f0-9]{64}$/)
  assert.match(review.references.manifest_sha256, /^[a-f0-9]{64}$/)
  assert.equal(review.references.items.length, 3)

  const tampered = structuredClone(review)
  tampered.selection.instruction = 'different instruction'
  assert.throws(
    () => assertFixedRegionActionRepairReviewContract(tampered),
    /hash changed/,
  )
})

test('fixed-region acceptance manifest seals the passing one-call candidate and every explicit artifact', () => {
  const review = reviewContract()
  const manifest = buildFixedRegionActionRepairAcceptanceManifest({
    jobId: 'job_candidate',
    reviewContract: review,
    result: {
      status: 'source_repaired',
      summary: {
        provider_calls_used: 1,
        quality_status: 'pass',
        atlas_extraction_status: 'extraction_pass',
      },
      scope_validation: {
        status: 'scope_pass',
        outside_selected_changed_pixels: 0,
      },
    },
    artifactEntries: FIXED_REGION_ACTION_REPAIR_REQUIRED_ACCEPTANCE_FILES.map((fileName) => ({
      file_name: fileName,
      content: Buffer.from(`sealed:${fileName}`),
    })),
  })
  assert.equal(assertFixedRegionActionRepairAcceptanceManifest(manifest), manifest)
  assert.equal(manifest.outcome.provider_calls_used, 1)
  assert.equal(manifest.outcome.accepted, false)

  const tampered = structuredClone(manifest)
  tampered.outcome.outside_selected_changed_pixels = 1
  assert.throws(
    () => assertFixedRegionActionRepairAcceptanceManifest(tampered),
    /hash changed|acceptance gates/,
  )
})
