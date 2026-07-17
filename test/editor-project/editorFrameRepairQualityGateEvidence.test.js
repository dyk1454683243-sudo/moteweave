import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'

import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  buildFrameRepairQualityGateBlindOrder,
  hashFrameRepairQualityGateValue,
  serializeFrameRepairQualityGateValue,
} from '../../src/editor-project/index.js'
import {
  finalizeFrameRepairQualityGateEvidence,
  readFrameRepairQualityGateEvidence,
  readFrameRepairQualityGateSetupManifest,
  resolveFrameRepairQualityGateSessionPaths,
  resolveFrameRepairQualityGateSetupPaths,
  startFrameRepairQualityGateEvidence,
  withFrameRepairQualityGateSessionLock,
  writeFrameRepairQualityGateOutcome,
  writeFrameRepairQualityGateReview,
  writeFrameRepairQualityGateSetupManifest,
} from '../../src/editor-project/frameRepairQualityGateEvidence.js'

const FIXED_TIME = '2026-07-12T00:00:00.000Z'
const SESSION_ID = 'frqg_20260712_primary'
const PROVIDER_PRESET_ID = 'preset_primary'

function sha(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function operationId(sessionId, caseId, caseHash) {
  return `frqgop_${sha(`${sessionId}\0${caseId}\0${caseHash}`).slice(0, 48)}`
}

const USER_CASES = Object.freeze([
  Object.freeze({ caseId: 'real_shape_01', assetId: 'asset_qg_real_shape_01', clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 16, instruction: 'Repair the distorted body shape only.', maskEdits: [{ op: 'add_rectangle', x: 20, y: 18, width: 48, height: 62 }], difficulty: 'medium', defectCategory: 'shape', expectedImprovement: 'The body shape is coherent while pixels outside the mask remain unchanged.' }),
  Object.freeze({ caseId: 'real_detail_02', assetId: 'asset_qg_real_detail_02', clipId: 'walk_left', clipFramePosition: 1, sheetFrameIndex: 21, instruction: 'Repair the missing sprite detail only.', maskEdits: [{ op: 'add_rectangle', x: 42, y: 30, width: 16, height: 18 }], difficulty: 'medium', defectCategory: 'detail', expectedImprovement: 'The missing detail is restored without altering unrelated pixels.' }),
  Object.freeze({ caseId: 'real_anchor_03', assetId: 'asset_qg_real_anchor_03', clipId: 'walk_up', clipFramePosition: 2, sheetFrameIndex: 10, instruction: 'Repair the foot anchor and baseline only.', maskEdits: [{ op: 'add_rectangle', x: 28, y: 70, width: 40, height: 18 }], difficulty: 'medium', defectCategory: 'anchor_baseline', expectedImprovement: 'The feet share the intended baseline and anchor.' }),
  Object.freeze({ caseId: 'real_facing_04', assetId: 'asset_qg_real_facing_04', clipId: 'walk_right', clipFramePosition: 3, sheetFrameIndex: 31, instruction: 'Repair facing-direction inconsistency only.', maskEdits: [{ op: 'add_rectangle', x: 18, y: 14, width: 58, height: 68 }], difficulty: 'medium', defectCategory: 'facing_consistency', expectedImprovement: 'The frame faces right consistently with its neighboring frames.' }),
  Object.freeze({ caseId: 'real_semantic_05', assetId: 'asset_qg_real_semantic_05', clipId: 'idle_down', clipFramePosition: 0, sheetFrameIndex: 0, instruction: 'Reconstruct the masked semantic feature only.', maskEdits: [{ op: 'add_rectangle', x: 30, y: 20, width: 36, height: 44 }], difficulty: 'hard', defectCategory: 'semantic_reconstruction', expectedImprovement: 'The intended feature is recognizable and preserves character identity.' }),
  Object.freeze({ caseId: 'real_continuity_06', assetId: 'asset_qg_real_continuity_06', clipId: 'walk_down', clipFramePosition: 2, sheetFrameIndex: 18, instruction: 'Repair continuity with neighboring animation frames only.', maskEdits: [{ op: 'add_rectangle', x: 22, y: 16, width: 52, height: 66 }], difficulty: 'hard', defectCategory: 'neighbor_continuity', expectedImprovement: 'The repaired frame transitions coherently to both neighboring frames.' }),
])

function canonicalPlan(sessionId = SESSION_ID) {
  const definitions = [
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
    ...USER_CASES.map((item) => ({ ...item, expectedAssetRevisionId: 'rev_001' })),
  ]
  const cases = definitions.map((definition, displayIndex) => {
    const canonical = {
      case_id: definition.caseId,
      display_index: displayIndex,
      asset_id: definition.assetId,
      parent_revision_id: definition.expectedAssetRevisionId,
      repair: {
        clip_id: definition.clipId,
        clip_frame_position: definition.clipFramePosition,
        sheet_frame_index: definition.sheetFrameIndex,
        instruction: definition.instruction,
        instruction_sha256: hashFrameRepairQualityGateValue(definition.instruction),
        mask_edits: structuredClone(definition.maskEdits),
        mask_sha256: sha(`mask:${definition.caseId}`),
      },
      classification: {
        difficulty: definition.difficulty,
        defect_category: definition.defectCategory,
        expected_improvement: definition.expectedImprovement,
        ownership_class: displayIndex < 2 ? 'repository_control' : 'user_owned',
      },
      authority: {
        source_sha256: sha(`source:${definition.caseId}`),
        parent_sheet_sha256: sha(`sheet:${definition.caseId}`),
        target_frame_sha256: sha(`frame:${definition.caseId}`),
        reference_context_sha256: sha(`context:${definition.caseId}`),
      },
      provider: { preset_id: PROVIDER_PRESET_ID, image_size: '1K', max_calls: 1 },
    }
    const caseHash = hashFrameRepairQualityGateValue(canonical)
    return {
      ...canonical,
      case_hash: caseHash,
      operation_id: operationId(sessionId, definition.caseId, caseHash),
    }
  })
  const plan = {
    protocol: 'frame_repair_quality_gate_plan_v1',
    session_id: sessionId,
    setup_manifest_sha256: sha('setup-manifest'),
    implementation_revision: 'quality-gate-evidence-fixture-v1',
    project: {
      id: 'project_quality_gate',
      initial_revision: 1,
      initial_projection_sha256: sha('initial-project'),
    },
    provider: { preset_id: PROVIDER_PRESET_ID, image_size: '1K' },
    call_budget: { per_case: 1, total: 8 },
    cases,
  }
  return Object.freeze({
    ...plan,
    session_plan_hash: hashFrameRepairQualityGateValue(plan),
  })
}

function blindOrder(plan) {
  return buildFrameRepairQualityGateBlindOrder({
    sessionId: plan.session_id,
    cases: plan.cases,
  })
}

function artifactRecords(label) {
  return ['sheet', 'animations', 'metadata', 'editor_metadata', 'debug_report'].map((key, index) => ({
    key,
    size: 100 + index,
    sha256: sha(`${label}:${key}`),
  }))
}

function setupManifest() {
  const plan = canonicalPlan()
  return {
    protocol: 'frame_repair_quality_gate_setup_v1',
    source_project: { id: 'project_source', revision: 12 },
    target_project: { id: plan.project.id, revision: 1 },
    ownership_confirmed: true,
    cases: plan.cases.map((item, index) => {
      const artifacts = artifactRecords(item.case_id)
      return {
        case_id: item.case_id,
        ownership_class: index < 2 ? 'repository_control' : 'user_owned',
        source: {
          asset_id: index < 2 ? null : `source_${item.asset_id}`,
          revision_id: index < 2 ? null : 'rev_003',
          source_sha256: hashFrameRepairQualityGateValue(artifacts),
          artifacts,
        },
        target: {
          asset_id: item.asset_id,
          revision_id: 'rev_001',
          artifacts: structuredClone(artifacts),
        },
        control_identity: index === 0
          ? 'quality_gate_control_outline_alpha_v1'
          : index === 1
            ? 'quality_gate_control_small_component_v1'
            : null,
      }
    }),
  }
}

function reviewRecord(plan, index = 0) {
  const item = plan.cases[index]
  return {
    protocol: 'frame_repair_quality_gate_review_v1',
    session_id: plan.session_id,
    session_plan_hash: plan.session_plan_hash,
    case_id: item.case_id,
    case_hash: item.case_hash,
    operation_id: item.operation_id,
    job_id: `job_${item.case_id}`,
    frame_repair_plan_hash: sha(`repair-plan:${item.case_id}`),
    frame_repair_artifact_manifest_sha256: sha(`repair-manifest:${item.case_id}`),
    project_revision: 1,
    project_projection_sha256: plan.project.initial_projection_sha256,
    parent_revision_id: item.parent_revision_id,
    blind: { choice: 'prefer_b', a: 'before', b: 'after', preferred_version: 'after' },
    functional: {
      improvement: 'improved',
      usability: 'usable',
      new_blocking_defect: false,
      reason_codes: ['shape_improved'],
      note: 'local evidence note',
    },
    hard_gates: { status: 'pass', reasons: [], facts: completeHardGateFacts() },
    successful_candidate: true,
    recorded_at: FIXED_TIME,
  }
}

function outcomeRecord(plan, index = 0) {
  const item = plan.cases[index]
  return {
    protocol: 'frame_repair_quality_gate_outcome_v1',
    session_id: plan.session_id,
    session_plan_hash: plan.session_plan_hash,
    case_id: item.case_id,
    case_hash: item.case_hash,
    operation_id: item.operation_id,
    job_id: `job_${item.case_id}`,
    review_sha256: sha(`review:${item.case_id}`),
    outcome: 'rejected',
    provider_calls: 1,
    controlled_reason: null,
    project_before_revision: 1,
    project_after_revision: 1,
    accepted_revision_id: null,
    project_before_projection_sha256: plan.project.initial_projection_sha256,
    project_after_projection_sha256: plan.project.initial_projection_sha256,
    recorded_at: FIXED_TIME,
  }
}

async function tempGeneratedDir() {
  return mkdtemp(path.join(os.tmpdir(), 'frame-repair-quality-gate-evidence-'))
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code)
    return true
  }
}

test('resolves only fixed setup and session evidence paths and rejects unsafe identities before path construction', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan()
  const caseIds = plan.cases.map((item) => item.case_id)
  const setup = resolveFrameRepairQualityGateSetupPaths({
    generatedDir,
    targetProjectId: plan.project.id,
  })
  assert.equal(setup.setupManifest, path.join(
    generatedDir,
    'frame-repair-quality-gates',
    `setup_${plan.project.id}`,
    'setup_manifest.json',
  ))
  const session = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds,
  })
  assert.equal(session.sessionPlan, path.join(session.sessionDir, 'session_plan.json'))
  assert.equal(session.blindOrder, path.join(session.sessionDir, 'blind_order.json'))
  assert.equal(session.reviewFiles[caseIds[0]], path.join(session.sessionDir, `case_${caseIds[0]}_review.json`))
  assert.equal(session.outcomeFiles[caseIds[0]], path.join(session.sessionDir, `case_${caseIds[0]}_outcome.json`))
  assert.equal(session.reportJson, path.join(session.sessionDir, 'frame_repair_quality_gate.json'))
  assert.equal(session.reportMarkdown, path.join(session.sessionDir, 'frame_repair_quality_gate.md'))
  assert.equal(session.contactSheet, path.join(session.sessionDir, 'frame_repair_quality_gate_contact_sheet.png'))
  assert.equal(session.artifactManifest, path.join(session.sessionDir, 'artifact_manifest.json'))

  for (const bad of ['../escape', '/absolute', 'bad\\path', 'bad%2fpath']) {
    assert.throws(() => resolveFrameRepairQualityGateSessionPaths({
      generatedDir,
      sessionId: bad,
      caseIds,
    }))
  }
  assert.throws(() => resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: [...caseIds.slice(0, 7), '../case'],
  }))

  const realRoot = await tempGeneratedDir()
  const alias = path.join(await tempGeneratedDir(), 'generated-alias')
  await symlink(realRoot, alias, 'dir')
  await assert.rejects(writeFrameRepairQualityGateSetupManifest({
    generatedDir: alias,
    targetProjectId: plan.project.id,
    manifest: setupManifest(),
  }))
})

test('writes and reads one canonical setup manifest with identical retry and conflicting retry semantics', async () => {
  const generatedDir = await tempGeneratedDir()
  const manifest = setupManifest()
  const first = await writeFrameRepairQualityGateSetupManifest({
    generatedDir,
    targetProjectId: manifest.target_project.id,
    manifest,
  })
  const paths = resolveFrameRepairQualityGateSetupPaths({
    generatedDir,
    targetProjectId: manifest.target_project.id,
  })
  const before = await stat(paths.setupManifest)
  assert.equal(first.sha256, sha(await readFile(paths.setupManifest, 'utf8')))
  assert.deepEqual(await readFrameRepairQualityGateSetupManifest({
    generatedDir,
    targetProjectId: manifest.target_project.id,
  }), manifest)

  const identical = await writeFrameRepairQualityGateSetupManifest({
    generatedDir,
    targetProjectId: manifest.target_project.id,
    manifest: structuredClone(manifest),
  })
  const after = await stat(paths.setupManifest)
  assert.equal(identical.sha256, first.sha256)
  assert.equal(after.ino, before.ino)
  assert.equal(after.mtimeMs, before.mtimeMs)

  const changed = structuredClone(manifest)
  changed.source_project.revision += 1
  await assert.rejects(writeFrameRepairQualityGateSetupManifest({
    generatedDir,
    targetProjectId: manifest.target_project.id,
    manifest: changed,
  }), expectCode('evidence_conflict'))
  await assert.rejects(writeFrameRepairQualityGateSetupManifest({
    generatedDir: await tempGeneratedDir(),
    targetProjectId: manifest.target_project.id,
    manifest: { ...manifest, providerKey: 'DO_NOT_STORE_SECRET' },
  }))
})

test('starts exact plan and blind evidence idempotently and resumes only identical partial publication', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan()
  const order = blindOrder(plan)
  const first = await startFrameRepairQualityGateEvidence({ generatedDir, plan, blindOrder: order })
  assert.equal(first.plan_sha256, sha(serializeFrameRepairQualityGateValue(plan)))
  const paths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: plan.cases.map((item) => item.case_id),
  })
  const storedPlan = JSON.parse(await readFile(paths.sessionPlan, 'utf8'))
  const storedBlind = JSON.parse(await readFile(paths.blindOrder, 'utf8'))
  assert.deepEqual(storedPlan, plan)
  assert.deepEqual(storedBlind, {
    protocol: 'frame_repair_quality_gate_blind_order_v1',
    session_id: plan.session_id,
    session_plan_hash: plan.session_plan_hash,
    cases: order.cases,
  })
  const retry = await startFrameRepairQualityGateEvidence({
    generatedDir,
    plan: structuredClone(plan),
    blindOrder: structuredClone(order),
  })
  assert.deepEqual(retry, first)

  const partialPlan = canonicalPlan('frqg_20260712_partial')
  const partialOrder = blindOrder(partialPlan)
  const partialPaths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: partialPlan.session_id,
    caseIds: partialPlan.cases.map((item) => item.case_id),
  })
  await mkdir(partialPaths.sessionDir, { recursive: true })
  await writeFile(partialPaths.sessionPlan, serializeFrameRepairQualityGateValue(partialPlan))
  await startFrameRepairQualityGateEvidence({
    generatedDir,
    plan: partialPlan,
    blindOrder: partialOrder,
  })
  assert.deepEqual(JSON.parse(await readFile(partialPaths.blindOrder, 'utf8')).cases, partialOrder.cases)

  const conflictPlan = canonicalPlan('frqg_20260712_conflict')
  const conflictPaths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: conflictPlan.session_id,
    caseIds: conflictPlan.cases.map((item) => item.case_id),
  })
  await mkdir(conflictPaths.sessionDir, { recursive: true })
  await writeFile(conflictPaths.sessionPlan, Buffer.from('{"wrong":true}', 'utf8'))
  await assert.rejects(startFrameRepairQualityGateEvidence({
    generatedDir,
    plan: conflictPlan,
    blindOrder: blindOrder(conflictPlan),
  }), expectCode('evidence_conflict'))
})

test('appends exact review and outcome records, ignores unexpected files, and blocks records after finalization starts', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan()
  await startFrameRepairQualityGateEvidence({ generatedDir, plan, blindOrder: blindOrder(plan) })
  const review = reviewRecord(plan)
  const outcome = outcomeRecord(plan)
  const firstReview = await writeFrameRepairQualityGateReview({ generatedDir, plan, review })
  const firstOutcome = await writeFrameRepairQualityGateOutcome({ generatedDir, plan, outcome })
  assert.match(firstReview.sha256, /^[a-f0-9]{64}$/)
  assert.match(firstOutcome.sha256, /^[a-f0-9]{64}$/)
  assert.equal((await writeFrameRepairQualityGateReview({
    generatedDir,
    plan,
    review: structuredClone(review),
  })).sha256, firstReview.sha256)
  assert.equal((await writeFrameRepairQualityGateOutcome({
    generatedDir,
    plan,
    outcome: structuredClone(outcome),
  })).sha256, firstOutcome.sha256)

  const changedReview = structuredClone(review)
  changedReview.functional.note = 'different note'
  await assert.rejects(writeFrameRepairQualityGateReview({
    generatedDir,
    plan,
    review: changedReview,
  }), expectCode('evidence_conflict'))

  const paths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: plan.cases.map((item) => item.case_id),
  })
  await writeFile(path.join(paths.sessionDir, 'case_unplanned_review.json'), '{"ignored":true}')
  const evidence = await readFrameRepairQualityGateEvidence({
    generatedDir,
    sessionId: plan.session_id,
  })
  assert.deepEqual(evidence.reviews, [review])
  assert.deepEqual(evidence.outcomes, [outcome])

  await writeFile(paths.reportJson, '{"protocol":"frame_repair_quality_gate_report_v1"}')
  await assert.rejects(writeFrameRepairQualityGateReview({
    generatedDir,
    plan,
    review: reviewRecord(plan, 1),
  }), expectCode('quality_gate_finalized'))
})

test('serializes tasks through one bounded per-session lock and releases the tail after failure', async () => {
  const generatedDir = await tempGeneratedDir()
  const order = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  let secondEntered = false
  const first = withFrameRepairQualityGateSessionLock({ generatedDir, sessionId: SESSION_ID }, async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
  })
  const second = withFrameRepairQualityGateSessionLock({ generatedDir, sessionId: SESSION_ID }, async () => {
    secondEntered = true
    order.push('second')
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(secondEntered, false)
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second'])

  await assert.rejects(withFrameRepairQualityGateSessionLock(
    { generatedDir, sessionId: SESSION_ID },
    async () => { throw new Error('expected lock failure') },
  ))
  let reached = false
  await withFrameRepairQualityGateSessionLock({ generatedDir, sessionId: SESSION_ID }, async () => {
    reached = true
  })
  assert.equal(reached, true)
})

function completeHardGateFacts({ warning = false } = {}) {
  return {
    identity_complete: true,
    manifest_verified: true,
    outside_mask_equal: true,
    outside_mask_changed_pixels: 0,
    candidate_available: true,
    composited_frame_available: true,
    quality_evidence_complete: true,
    validator_status: warning ? 'warning' : 'pass',
    validator_blocking_errors: [],
    continuity_complete: true,
    revision_chain_valid: true,
    unrelated_project_mutation: false,
    provider_calls: 1,
    warnings: warning ? ['validator_warning'] : [],
  }
}

async function framePng(red, green, blue) {
  return sharp({
    create: {
      width: 96,
      height: 96,
      channels: 4,
      background: { r: red, g: green, b: blue, alpha: 1 },
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer()
}

async function completedEvidenceFixture(generatedDir, plan) {
  await startFrameRepairQualityGateEvidence({ generatedDir, plan, blindOrder: blindOrder(plan) })
  const frames = []
  for (let index = 0; index < plan.cases.length; index += 1) {
    if (index < 6) {
      const review = reviewRecord(plan, index)
      review.functional.note = index === 0
        ? 'private reviewer note [link](https://invalid.example) <svg onload=alert(1)>'
        : null
      review.hard_gates = index === 0
        ? {
            status: 'warning',
            reasons: ['validator_warning'],
            facts: completeHardGateFacts({ warning: true }),
          }
        : { status: 'pass', reasons: [], facts: completeHardGateFacts() }
      await writeFrameRepairQualityGateReview({ generatedDir, plan, review })
      const outcome = outcomeRecord(plan, index)
      outcome.outcome = 'accepted'
      outcome.review_sha256 = sha(serializeFrameRepairQualityGateValue(review))
      outcome.project_after_revision = 2 + index
      outcome.accepted_revision_id = `rev_00${2 + index}`
      await writeFrameRepairQualityGateOutcome({ generatedDir, plan, outcome })
      frames.push({
        case_id: plan.cases[index].case_id,
        before_png: await framePng(24 + index, 40, 80),
        after_png: await framePng(40, 96 + index, 48),
      })
    } else {
      const outcome = outcomeRecord(plan, index)
      outcome.job_id = null
      outcome.review_sha256 = null
      outcome.outcome = 'provider_blocked'
      outcome.controlled_reason = 'provider_no_candidate'
      await writeFrameRepairQualityGateOutcome({ generatedDir, plan, outcome })
    }
  }
  return frames
}

test('finalizes deterministic parity-safe reports, a fixed contact sheet, and a sorted complete manifest', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan('frqg_20260712_finalize')
  const frames = await completedEvidenceFixture(generatedDir, plan)
  const first = await finalizeFrameRepairQualityGateEvidence({ generatedDir, plan, frames })
  const paths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: plan.cases.map((item) => item.case_id),
  })
  const reportBytes = await readFile(paths.reportJson)
  const report = JSON.parse(reportBytes)
  const markdown = await readFile(paths.reportMarkdown, 'utf8')
  const contactBytes = await readFile(paths.contactSheet)
  const manifest = JSON.parse(await readFile(paths.artifactManifest, 'utf8'))

  assert.deepEqual(report.decision, {
    accepted: 6,
    calls_remaining: 0,
    calls_used: 8,
    completed_candidates: 6,
    failure_domain: null,
    improvement_rate: 1,
    provider_blocked: 2,
    rejected: 0,
    required_successes: 5,
    result: 'passed',
    successful_candidates: 6,
    total_planned: 8,
    unresolved: 0,
  })
  assert.equal(report.provider.preset_id, PROVIDER_PRESET_ID)
  assert.equal(report.session_plan_hash, plan.session_plan_hash)
  assert.deepEqual(report.taxonomy.hard_gate_reasons, [{ code: 'validator_warning', count: 1 }])
  assert.deepEqual(report.taxonomy.controlled_provider_reasons, [{ code: 'provider_no_candidate', count: 2 }])
  assert.deepEqual(report.breakdown.difficulty.map((item) => item.key), ['basic', 'hard', 'medium'])
  assert.deepEqual(report.breakdown.category.map((item) => item.key), [...plan.cases]
    .map((item) => item.classification.defect_category).sort())
  for (const value of [
    report.decision.result,
    'none',
    `${report.decision.successful_candidates}/${report.decision.completed_candidates}`,
    `${report.decision.required_successes}`,
    `${report.decision.improvement_rate}`,
    `${report.decision.calls_used}/${report.decision.calls_used + report.decision.calls_remaining}`,
    PROVIDER_PRESET_ID,
    plan.session_plan_hash,
    'provider_no_candidate',
    'validator_warning',
  ]) assert.match(markdown, new RegExp(value))
  assert.doesNotMatch(JSON.stringify(report), /private reviewer note|invalid\.example|onload/)
  assert.doesNotMatch(markdown, /private reviewer note|invalid\.example|onload/)

  const contactMetadata = await sharp(contactBytes).metadata()
  assert.equal(contactMetadata.width, 1536)
  assert.equal(contactMetadata.height, 512)
  assert.equal(contactMetadata.format, 'png')

  const expectedFiles = [
    'blind_order.json',
    ...plan.cases.slice(0, 6).flatMap((item) => [
      `case_${item.case_id}_outcome.json`,
      `case_${item.case_id}_review.json`,
    ]),
    ...plan.cases.slice(6).map((item) => `case_${item.case_id}_outcome.json`),
    'frame_repair_quality_gate.json',
    'frame_repair_quality_gate.md',
    'frame_repair_quality_gate_contact_sheet.png',
    'session_plan.json',
  ].sort()
  assert.equal(manifest.protocol, 'frame_repair_quality_gate_artifact_manifest_v1')
  assert.equal(manifest.session_id, plan.session_id)
  assert.equal(manifest.session_plan_hash, plan.session_plan_hash)
  assert.deepEqual(manifest.files.map((item) => item.file_name), expectedFiles)
  assert.equal(manifest.files.some((item) => item.file_name === 'artifact_manifest.json'), false)
  for (const item of manifest.files) {
    const bytes = await readFile(path.join(paths.sessionDir, item.file_name))
    assert.equal(item.size, bytes.length)
    assert.equal(item.sha256, sha(bytes))
  }

  const before = await Promise.all([
    stat(paths.reportJson),
    stat(paths.reportMarkdown),
    stat(paths.contactSheet),
    stat(paths.artifactManifest),
  ])
  const retry = await finalizeFrameRepairQualityGateEvidence({
    generatedDir,
    plan: structuredClone(plan),
    frames: frames.map((item) => ({
      case_id: item.case_id,
      before_png: Buffer.from(item.before_png),
      after_png: Buffer.from(item.after_png),
    })),
  })
  const after = await Promise.all([
    stat(paths.reportJson),
    stat(paths.reportMarkdown),
    stat(paths.contactSheet),
    stat(paths.artifactManifest),
  ])
  assert.deepEqual(retry, first)
  assert.deepEqual(after.map(({ ino, mtimeMs }) => ({ ino, mtimeMs })),
    before.map(({ ino, mtimeMs }) => ({ ino, mtimeMs })))
})

test('fails closed when immutable evidence names are occupied by links or directories', async () => {
  const generatedDir = await tempGeneratedDir()
  const linkedPlan = canonicalPlan('frqg_20260712_linked_file')
  const linkedPaths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: linkedPlan.session_id,
    caseIds: linkedPlan.cases.map((item) => item.case_id),
  })
  await mkdir(linkedPaths.sessionDir, { recursive: true })
  const externalPlan = path.join(await tempGeneratedDir(), 'external-plan.json')
  await writeFile(externalPlan, serializeFrameRepairQualityGateValue(linkedPlan))
  await symlink(externalPlan, linkedPaths.sessionPlan)
  await assert.rejects(startFrameRepairQualityGateEvidence({
    generatedDir,
    plan: linkedPlan,
    blindOrder: blindOrder(linkedPlan),
  }), expectCode('unsafe_artifact_path'))

  const directoryPlan = canonicalPlan('frqg_20260712_directory')
  const directoryPaths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: directoryPlan.session_id,
    caseIds: directoryPlan.cases.map((item) => item.case_id),
  })
  await mkdir(directoryPaths.sessionDir, { recursive: true })
  await writeFile(directoryPaths.sessionPlan, serializeFrameRepairQualityGateValue(directoryPlan))
  await mkdir(directoryPaths.blindOrder)
  await assert.rejects(startFrameRepairQualityGateEvidence({
    generatedDir,
    plan: directoryPlan,
    blindOrder: blindOrder(directoryPlan),
  }), expectCode('unsafe_artifact_path'))
})

test('validates every bounded 96 by 96 frame before publishing finalization', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan('frqg_20260712_bad_frame')
  const frames = await completedEvidenceFixture(generatedDir, plan)
  frames[0].before_png = await sharp({
    create: {
      width: 95,
      height: 96,
      channels: 4,
      background: { r: 20, g: 30, b: 40, alpha: 1 },
    },
  }).png().toBuffer()
  await assert.rejects(finalizeFrameRepairQualityGateEvidence({ generatedDir, plan, frames }))
  const paths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: plan.cases.map((item) => item.case_id),
  })
  await assert.rejects(stat(paths.reportJson), (error) => error?.code === 'ENOENT')
})

test('a finalizer queued first wins deterministically and blocks a late immutable review', async () => {
  const generatedDir = await tempGeneratedDir()
  const plan = canonicalPlan('frqg_20260712_finalize_race')
  await startFrameRepairQualityGateEvidence({ generatedDir, plan, blindOrder: blindOrder(plan) })
  const finalizing = finalizeFrameRepairQualityGateEvidence({ generatedDir, plan, frames: [] })
  const lateReview = writeFrameRepairQualityGateReview({
    generatedDir,
    plan,
    review: reviewRecord(plan),
  })
  const finalized = await finalizing
  assert.equal(finalized.report.decision.result, 'evidence_insufficient')
  await assert.rejects(lateReview, expectCode('quality_gate_finalized'))
  const evidence = await readFrameRepairQualityGateEvidence({
    generatedDir,
    sessionId: plan.session_id,
  })
  assert.deepEqual(evidence.reviews, [])
})
