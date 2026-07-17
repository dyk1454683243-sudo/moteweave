import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import * as editorProject from '../../src/editor-project/index.js'
import { createAssetRef, createAssetRevision } from '../../src/editor-project/assets.js'
import { createDefaultEditorProject } from '../../src/editor-project/defaults.js'
import { FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS, FrameRepairQualityGateError } from '../../src/editor-project/frameRepairQualityGateProtocol.js'
import { buildFrameRepairQualityGateBlindOrder, buildFrameRepairQualityGateCaseFingerprint, buildFrameRepairQualityGatePlan, computeFrameRepairQualityGateDecision, hashFrameRepairQualityGateValue, projectFrameRepairQualityGateHardGates, serializeFrameRepairQualityGateValue } from '../../src/editor-project/frameRepairQualityGatePlan.js'
import { validateEditorProject } from '../../src/editor-project/validation.js'
const FIXED_TIMESTAMP = '2026-07-13T00:00:00.000Z', sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex')
const USER_CASES = [
  { caseId: 'case_shape_01', assetId: 'asset_shape_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 16, instruction: 'Repair the distorted body shape only.', maskEdits: [{ op: 'add_rectangle', x: 20, y: 18, width: 48, height: 62 }], difficulty: 'medium', defectCategory: 'shape', expectedImprovement: 'The body shape is coherent while pixels outside the mask remain unchanged.' },
  { caseId: 'case_detail_01', assetId: 'asset_detail_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_left', clipFramePosition: 1, sheetFrameIndex: 21, instruction: 'Repair the missing sprite detail only.', maskEdits: [{ op: 'add_rectangle', x: 42, y: 30, width: 16, height: 18 }], difficulty: 'medium', defectCategory: 'detail', expectedImprovement: 'The missing detail is restored without altering unrelated pixels.' },
  { caseId: 'case_anchor_01', assetId: 'asset_anchor_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_up', clipFramePosition: 2, sheetFrameIndex: 10, instruction: 'Repair the foot anchor and baseline only.', maskEdits: [{ op: 'add_rectangle', x: 28, y: 70, width: 40, height: 18 }], difficulty: 'medium', defectCategory: 'anchor_baseline', expectedImprovement: 'The feet share the intended baseline and anchor.' },
  { caseId: 'case_facing_01', assetId: 'asset_facing_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_right', clipFramePosition: 3, sheetFrameIndex: 31, instruction: 'Repair facing-direction inconsistency only.', maskEdits: [{ op: 'add_rectangle', x: 18, y: 14, width: 58, height: 68 }], difficulty: 'medium', defectCategory: 'facing_consistency', expectedImprovement: 'The frame faces right consistently with its neighboring frames.' },
  { caseId: 'case_semantic_01', assetId: 'asset_semantic_01', expectedAssetRevisionId: 'rev_001', clipId: 'idle_down', clipFramePosition: 0, sheetFrameIndex: 0, instruction: 'Reconstruct the masked semantic feature only.', maskEdits: [{ op: 'add_rectangle', x: 30, y: 20, width: 36, height: 44 }], difficulty: 'hard', defectCategory: 'semantic_reconstruction', expectedImprovement: 'The intended feature is recognizable and preserves character identity.' },
  { caseId: 'case_continuity_01', assetId: 'asset_continuity_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_down', clipFramePosition: 2, sheetFrameIndex: 18, instruction: 'Repair continuity with neighboring animation frames only.', maskEdits: [{ op: 'add_rectangle', x: 22, y: 16, width: 52, height: 66 }], difficulty: 'hard', defectCategory: 'neighbor_continuity', expectedImprovement: 'The repaired frame transitions coherently to both neighboring frames.' },
]
const CONTROL_IDENTITIES = ['quality_gate_control_outline_alpha_v1', 'quality_gate_control_small_component_v1']
const FINGERPRINT_KEYS = ['asset_id', 'case_id', 'clip_frame_position', 'clip_id', 'defect_category', 'difficulty', 'expected_improvement', 'image_size', 'instruction_sha256', 'mask_sha256', 'max_provider_calls', 'ownership_class', 'parent_revision_id', 'parent_sheet_sha256', 'provider_preset_id', 'reference_context_sha256', 'sheet_frame_index', 'source_sha256', 'target_frame_sha256']
const ARTIFACT_KEYS = ['sheet', 'animations', 'metadata', 'editor_metadata', 'debug_report']
const evidenceArtifacts = (caseId) => ARTIFACT_KEYS.map((key, index) => ({ key, size: 1024 + index, sha256: sha(`evidence:${caseId}:${key}`) }))
const revisionArtifacts = (records, assetId) => Object.fromEntries(records.map(({ key }) => [key, `assets/${assetId}/revisions/rev_001/${key === 'sheet' ? 'sheet.png' : `${key}.json`}`]))
function makeFixture() {
  const requestedCases = structuredClone([
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
    ...USER_CASES,
  ])
  const setupCases = requestedCases.map((item, index) => {
    const isControl = index < 2
    const artifacts = evidenceArtifacts(item.caseId)
    artifacts.find((artifact) => artifact.key === 'sheet').sha256 = sha(`parent-sheet:${item.caseId}`)
    return {
      case_id: item.caseId,
      ownership_class: isControl ? 'repository_control' : 'user_owned',
      source: {
        asset_id: isControl ? null : `source_${item.assetId}`,
        revision_id: isControl ? null : 'source_rev_012',
        source_sha256: hashFrameRepairQualityGateValue(artifacts),
        artifacts,
      },
      target: {
        asset_id: item.assetId,
        revision_id: 'rev_001',
        artifacts: structuredClone(artifacts),
      },
      control_identity: isControl ? CONTROL_IDENTITIES[index] : null,
    }
  })
  const setupManifest = {
    protocol: 'frame_repair_quality_gate_setup_v1',
    source_project: { id: 'project_source', revision: 12 },
    target_project: { id: 'project_quality_gate', revision: 1 },
    ownership_confirmed: true,
    cases: setupCases,
  }
  const project = createDefaultEditorProject({
    id: setupManifest.target_project.id,
    name: 'Frame Repair Quality Gate',
    revision: 1,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  })
  project.assets = Object.fromEntries(setupCases.map((item, index) => [item.target.asset_id, createAssetRef({
    id: item.target.asset_id, name: item.case_id, kind: 'character_pack', profile: 'topdown_rpg_v0',
    clips: { [requestedCases[index].clipId]: { id: requestedCases[index].clipId, frames: [requestedCases[index].sheetFrameIndex], fps: 8, frame_size: { w: 96, h: 96 }, anchor: { x: 48, y: 88 }, loop_mode: 'loop' } },
    revision: createAssetRevision({
      id: 'rev_001', sourceJobId: 'quality_gate_fixture_job', createdAt: FIXED_TIMESTAMP,
      qualityStatus: 'pass', productionStatus: 'ready', artifacts: revisionArtifacts(item.target.artifacts, item.target.asset_id),
    }),
  })]))
  const request = {
    sessionId: 'frqg_20260713_primary',
    expectedRevision: 1,
    setupManifestSha256: hashFrameRepairQualityGateValue(setupManifest),
    providerPresetId: 'preset_primary',
    imageConfig: { image_size: '1K' },
    maxProviderCalls: 8,
    cases: requestedCases,
  }
  const frameRepairPlans = requestedCases.map((item) => {
    const plan = {
      version: 'frame_repair_plan_v1',
      project: { id: project.id, revision: project.revision },
      asset: { id: item.assetId, parent_revision_id: item.expectedAssetRevisionId },
      clip: { id: item.clipId, position: item.clipFramePosition, sheet_frame_index: item.sheetFrameIndex },
      mask: { sha256: sha(`mask:${item.caseId}`) },
      instruction: item.instruction,
      parent_sheet_sha256: sha(`parent-sheet:${item.caseId}`),
      target_frame_sha256: sha(`target-frame:${item.caseId}`),
      references: { context_sha256: sha(`reference-context:${item.caseId}`) },
      provider: {
        id: request.providerPresetId,
        provider: 'fixture_provider',
        label: 'Fixture provider',
        model: 'fixture-model-v1',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
      },
      estimated_provider_calls: 1,
      max_provider_calls: 1,
      implementation_revision: 'quality-gate-fixture-v1',
    }
    return { plan, plan_hash: hashFrameRepairQualityGateValue(plan), can_run: true, diagnostics: [] }
  })
  return { setupManifest, request, project, frameRepairPlans }
}
function fingerprintInput(fixture, index = 0) {
  return {
    setupCase: fixture.setupManifest.cases[index],
    requestedCase: fixture.request.cases[index],
    frameRepairPlan: fixture.frameRepairPlans[index],
  }
}
function projectInitialProjection(project) {
  const projection = structuredClone(project)
  delete projection.revision
  delete projection.updated_at
  return projection
}
function canonicalCase(fixture, index) {
  const fingerprint = buildFrameRepairQualityGateCaseFingerprint(fingerprintInput(fixture, index))
  const requestedCase = fixture.request.cases[index]
  const plan = fixture.frameRepairPlans[index].plan
  return {
    case_id: fingerprint.case_id,
    display_index: index,
    asset_id: fingerprint.asset_id,
    parent_revision_id: fingerprint.parent_revision_id,
    repair: {
      clip_id: fingerprint.clip_id,
      clip_frame_position: fingerprint.clip_frame_position,
      sheet_frame_index: fingerprint.sheet_frame_index,
      instruction: plan.instruction,
      instruction_sha256: fingerprint.instruction_sha256,
      mask_edits: structuredClone(requestedCase.maskEdits),
      mask_sha256: fingerprint.mask_sha256,
    },
    classification: {
      difficulty: fingerprint.difficulty,
      defect_category: fingerprint.defect_category,
      expected_improvement: fingerprint.expected_improvement,
      ownership_class: fingerprint.ownership_class,
    },
    authority: {
      source_sha256: fingerprint.source_sha256,
      parent_sheet_sha256: fingerprint.parent_sheet_sha256,
      target_frame_sha256: fingerprint.target_frame_sha256,
      reference_context_sha256: fingerprint.reference_context_sha256,
    },
    provider: {
      preset_id: fingerprint.provider_preset_id,
      image_size: fingerprint.image_size,
      max_calls: 1,
    },
  }
}
function expectedPlan(fixture) {
  const cases = fixture.request.cases.map((requestedCase, index) => {
    const canonical = canonicalCase(fixture, index)
    const case_hash = hashFrameRepairQualityGateValue(canonical)
    return {
      ...canonical,
      case_hash,
      operation_id: `frqgop_${sha(`${fixture.request.sessionId}\0${requestedCase.caseId}\0${case_hash}`).slice(0, 48)}`,
    }
  })
  const hashInput = {
    protocol: 'frame_repair_quality_gate_plan_v1',
    session_id: fixture.request.sessionId,
    setup_manifest_sha256: fixture.request.setupManifestSha256,
    implementation_revision: 'quality-gate-fixture-v1',
    project: {
      id: fixture.project.id,
      initial_revision: 1,
      initial_projection_sha256: hashFrameRepairQualityGateValue(projectInitialProjection(fixture.project)),
    },
    provider: { preset_id: fixture.request.providerPresetId, image_size: '1K' },
    call_budget: { per_case: 1, total: 8 },
    cases,
  }
  return { ...hashInput, session_plan_hash: hashFrameRepairQualityGateValue(hashInput) }
}
function reverseRecordKeys(value) {
  if (Array.isArray(value)) return value.map(reverseRecordKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [key, reverseRecordKeys(child)]),
  )
}
function assertDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') assertDeepFrozen(child)
  }
}
function refreshSetupHash(fixture) {
  fixture.request.setupManifestSha256 = hashFrameRepairQualityGateValue(fixture.setupManifest)
}
function refreshFramePlanHash(frameRepairPlan) {
  frameRepairPlan.plan_hash = hashFrameRepairQualityGateValue(frameRepairPlan.plan)
}
function refreshEvidence(fixture, index) {
  const setupCase = fixture.setupManifest.cases[index]
  setupCase.source.source_sha256 = hashFrameRepairQualityGateValue(setupCase.source.artifacts)
  setupCase.target.artifacts = structuredClone(setupCase.source.artifacts)
  fixture.project.assets[setupCase.target.asset_id].revisions.rev_001.artifacts = revisionArtifacts(setupCase.target.artifacts, setupCase.target.asset_id)
  refreshSetupHash(fixture)
}
test('publishes the five Plan APIs and provides sorted UTF-8 canonical SHA-256 bytes', () => {
  const direct = {
    serializeFrameRepairQualityGateValue,
    hashFrameRepairQualityGateValue,
    buildFrameRepairQualityGateCaseFingerprint,
    buildFrameRepairQualityGatePlan,
    buildFrameRepairQualityGateBlindOrder,
    projectFrameRepairQualityGateHardGates,
    computeFrameRepairQualityGateDecision,
  }
  for (const [name, implementation] of Object.entries(direct)) {
    assert.strictEqual(editorProject[name], implementation, name)
  }
  const value = { z: 1, a: { z: '\u00e9', a: [{ b: 2, a: 1 }] } }
  const before = structuredClone(value)
  const bytes = serializeFrameRepairQualityGateValue(value)
  assert.equal(Buffer.isBuffer(bytes), true)
  assert.equal(bytes.toString('utf8'), '{"a":{"a":[{"a":1,"b":2}],"z":"\u00e9"},"z":1}')
  assert.equal(hashFrameRepairQualityGateValue(value), 'bbdef025c85882f3b1169ea85175be7968ef28641c46e4f95729140340cd0f09')
  assert.deepEqual(value, before)
  assert.deepEqual(bytes, serializeFrameRepairQualityGateValue(reverseRecordKeys(value)))
})
test('fingerprint uses requestedCase, exact authority keys, and excludes global project revision', () => {
  const fixture = makeFixture()
  const input = fingerprintInput(fixture)
  const fingerprint = buildFrameRepairQualityGateCaseFingerprint(input)
  const plan = input.frameRepairPlan.plan
  assert.deepEqual(Object.keys(fingerprint).sort(), FINGERPRINT_KEYS)
  assert.deepEqual(fingerprint, {
    case_id: input.requestedCase.caseId,
    asset_id: plan.asset.id,
    parent_revision_id: plan.asset.parent_revision_id,
    clip_id: plan.clip.id,
    clip_frame_position: plan.clip.position,
    sheet_frame_index: plan.clip.sheet_frame_index,
    mask_sha256: plan.mask.sha256,
    instruction_sha256: hashFrameRepairQualityGateValue(plan.instruction),
    parent_sheet_sha256: plan.parent_sheet_sha256,
    target_frame_sha256: plan.target_frame_sha256,
    reference_context_sha256: plan.references.context_sha256,
    provider_preset_id: plan.provider.id,
    image_size: plan.provider.image_config.image_size,
    difficulty: input.requestedCase.difficulty,
    defect_category: input.requestedCase.defectCategory,
    expected_improvement: input.requestedCase.expectedImprovement,
    ownership_class: input.setupCase.ownership_class,
    source_sha256: input.setupCase.source.source_sha256,
    max_provider_calls: plan.max_provider_calls,
  })
  const revisionOnly = structuredClone(input)
  revisionOnly.frameRepairPlan.plan.project.revision = 999
  refreshFramePlanHash(revisionOnly.frameRepairPlan)
  assert.deepEqual(buildFrameRepairQualityGateCaseFingerprint(revisionOnly), fingerprint)
  for (const key of FINGERPRINT_KEYS) {
    const changed = { ...fingerprint, [key]: typeof fingerprint[key] === 'number' ? 999 : `changed_${key}` }
    assert.notEqual(hashFrameRepairQualityGateValue(changed), hashFrameRepairQualityGateValue(fingerprint), key)
  }
  assertDeepFrozen(fingerprint)
})
test('builder returns the exact frozen plan_v1 document with sealed cases and self-excluding session hash', () => {
  const fixture = makeFixture()
  const before = structuredClone(fixture)
  const actual = buildFrameRepairQualityGatePlan(fixture)
  const expected = expectedPlan(fixture)
  const { session_plan_hash, ...hashInput } = actual
  assert.deepEqual(actual, expected)
  assert.deepEqual(Object.keys(actual).sort(), [
    'call_budget', 'cases', 'implementation_revision', 'project', 'protocol', 'provider',
    'session_id', 'session_plan_hash', 'setup_manifest_sha256',
  ])
  assert.deepEqual(Object.keys(actual.cases[0]).sort(), [
    'asset_id', 'authority', 'case_hash', 'case_id', 'classification', 'display_index',
    'operation_id', 'parent_revision_id', 'provider', 'repair',
  ])
  assert.deepEqual(actual.cases.map((item) => item.display_index), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(actual.cases.some((item) => Object.hasOwn(item, 'fingerprint')), false)
  assert.equal(session_plan_hash, hashFrameRepairQualityGateValue(hashInput))
  assert.equal(actual.project.initial_projection_sha256, hashFrameRepairQualityGateValue(
    projectInitialProjection(fixture.project),
  ))
  assert.deepEqual(fixture, before)
  assertDeepFrozen(actual)
  fixture.project.assets[actual.cases[0].asset_id].name = 'mutated'
  fixture.request.cases[0].maskEdits[0].width = 1
  assert.deepEqual(actual, expected)
})
test('canonical hashes bind case order, preset, setup digest and call budget while key order stays stable', () => {
  const baselineFixture = makeFixture()
  const baseline = buildFrameRepairQualityGatePlan(baselineFixture)
  assert.deepEqual(buildFrameRepairQualityGatePlan(reverseRecordKeys(baselineFixture)), baseline)
  const caseOrder = makeFixture()
  caseOrder.setupManifest.cases.reverse()
  caseOrder.request.cases.reverse()
  caseOrder.frameRepairPlans.reverse()
  refreshSetupHash(caseOrder)
  assert.notEqual(buildFrameRepairQualityGatePlan(caseOrder).session_plan_hash, baseline.session_plan_hash)
  const preset = makeFixture()
  preset.request.providerPresetId = 'preset_secondary'
  for (const item of preset.frameRepairPlans) {
    item.plan.provider.id = 'preset_secondary'
    refreshFramePlanHash(item)
  }
  assert.notEqual(buildFrameRepairQualityGatePlan(preset).session_plan_hash, baseline.session_plan_hash)
  const setupDigest = makeFixture()
  setupDigest.setupManifest.cases[2].source.artifacts[1].sha256 = sha('changed evidence')
  refreshEvidence(setupDigest, 2)
  const changedSetup = buildFrameRepairQualityGatePlan(setupDigest)
  assert.notEqual(changedSetup.session_plan_hash, baseline.session_plan_hash)
  assert.notEqual(changedSetup.cases[2].case_hash, baseline.cases[2].case_hash)
  assert.notEqual(changedSetup.cases[2].operation_id, baseline.cases[2].operation_id)
  const { session_plan_hash: ignored, ...hashInput } = baseline
  void ignored
  assert.notEqual(
    hashFrameRepairQualityGateValue({ ...hashInput, call_budget: { per_case: 1, total: 7 } }),
    baseline.session_plan_hash,
  )
  const changedSession = makeFixture()
  changedSession.request.sessionId = 'frqg_20260713_secondary'
  assert.notEqual(
    buildFrameRepairQualityGatePlan(changedSession).cases[0].operation_id,
    baseline.cases[0].operation_id,
  )
  assert.notEqual(baseline.cases[0].operation_id, baseline.cases[1].operation_id)
})
test('configured 2K image size is sealed into the session and every case', () => {
  const fixture = makeFixture()
  fixture.request.imageConfig.image_size = '2K'
  for (const item of fixture.frameRepairPlans) { item.plan.provider.image_config.image_size = '2K'; refreshFramePlanHash(item) }
  const plan = buildFrameRepairQualityGatePlan(fixture)
  assert.equal(plan.provider.image_size, '2K')
  assert.equal(plan.cases.every((item) => item.provider.image_size === '2K'), true)
})

test('builder rejects a Frame Plan parent sheet digest outside setup sheet authority', () => {
  const fixture = makeFixture()
  fixture.frameRepairPlans[2].plan.parent_sheet_sha256 = sha('mismatched parent sheet')
  refreshFramePlanHash(fixture.frameRepairPlans[2])
  assert.throws(() => buildFrameRepairQualityGatePlan(fixture), (error) => {
    assert.equal(error instanceof FrameRepairQualityGateError, true)
    assert.equal(error.code, 'invalid_quality_gate_plan')
    return true
  })
})

test('builder rejects request case order that differs from setup manifest order', () => {
  const fixture = makeFixture()
  const firstCase = fixture.request.cases[0]
  fixture.request.cases[0] = fixture.request.cases[1]
  fixture.request.cases[1] = firstCase
  assert.throws(() => buildFrameRepairQualityGatePlan(fixture), (error) => {
    assert.equal(error instanceof FrameRepairQualityGateError, true)
    assert.equal(error.code, 'invalid_quality_gate_plan')
    return true
  })
})

test('builder enforces Task1 controls, approved authority, identities, configured preset/image, and one call per case', () => {
  const valid = makeFixture()
  assert.deepEqual(validateEditorProject(valid.project).blocking_errors, [])
  for (const setupCase of valid.setupManifest.cases) {
    assert.equal(setupCase.source.artifacts.length >= 5, true)
    for (const artifact of setupCase.source.artifacts) assert.deepEqual(Object.keys(artifact).sort(), ['key', 'sha256', 'size'])
    assert.equal(setupCase.source.source_sha256, hashFrameRepairQualityGateValue(setupCase.source.artifacts))
    assert.deepEqual(setupCase.target.artifacts, setupCase.source.artifacts)
    const framePlan = valid.frameRepairPlans.find((item) => item.plan.asset.id === setupCase.target.asset_id).plan
    assert.equal(setupCase.target.artifacts.find((item) => item.key === 'sheet').sha256, framePlan.parent_sheet_sha256)
    assert.notEqual(setupCase.source.source_sha256, framePlan.parent_sheet_sha256)
  }
  for (const asset of Object.values(valid.project.assets)) {
    assert.equal(asset.kind, 'character_pack'); assert.equal(asset.active_revision_id, 'rev_001')
    assert.deepEqual(Object.keys(asset.revisions), ['rev_001'])
  }
  assert.deepEqual(valid.request.cases.slice(0, 2), FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS)
  assert.deepEqual(valid.setupManifest.cases.map((item) => item.control_identity), [
    ...CONTROL_IDENTITIES, ...Array(6).fill(null),
  ])
  assert.deepEqual(valid.setupManifest.cases.map((item) => item.ownership_class), [
    'repository_control', 'repository_control', ...Array(6).fill('user_owned'),
  ])
  assert.deepEqual(valid.setupManifest.cases.slice(0, 2).map((item) => (
    [item.source.asset_id, item.source.revision_id]
  )), [[null, null], [null, null]])
  assert.equal(valid.setupManifest.cases.slice(2).every((item) => (
    item.source.asset_id !== null && item.source.revision_id !== null
  )), true)
  assert.deepEqual(valid.request.cases.slice(2).map(({ difficulty, defectCategory }) => (
    [difficulty, defectCategory]
  )), [
    ['medium', 'shape'], ['medium', 'detail'], ['medium', 'anchor_baseline'],
    ['medium', 'facing_consistency'], ['hard', 'semantic_reconstruction'],
    ['hard', 'neighbor_continuity'],
  ])
  const invalidCases = [
    ['manifest identity', 'invalid_quality_gate_plan', (f) => { f.setupManifest.cases[2].target.asset_id = 'asset_wrong'; refreshSetupHash(f) }],
    ['request identity', 'invalid_quality_gate_plan', (f) => { f.request.cases[2].assetId = 'asset_wrong' }],
    ['project id', 'invalid_quality_gate_plan', (f) => { f.project.id = 'project_wrong' }],
    ['project revision', 'invalid_quality_gate_plan', (f) => { f.project.revision = 2 }],
    ['target asset revision', 'invalid_quality_gate_plan', (f) => { const asset = f.project.assets.asset_shape_01; asset.revisions.rev_002 = { ...structuredClone(asset.revisions.rev_001), id: 'rev_002' }; asset.active_revision_id = 'rev_002' }],
    ['frame Plan identity', 'invalid_quality_gate_plan', (f) => { f.frameRepairPlans[2].plan.clip.id = 'clip_wrong'; refreshFramePlanHash(f.frameRepairPlans[2]) }],
    ['frame Plan hash', 'invalid_quality_gate_plan', (f) => { f.frameRepairPlans[2].plan_hash = sha('wrong frame Plan hash') }],
    ['provider unavailable', 'provider_unavailable', (f) => { f.frameRepairPlans[2].can_run = false; f.frameRepairPlans[2].diagnostics = ['provider_unavailable'] }],
    ['wrong preset', 'invalid_quality_gate_plan', (f) => { f.frameRepairPlans[2].plan.provider.id = 'preset_wrong'; refreshFramePlanHash(f.frameRepairPlans[2]) }],
    ['wrong image', 'invalid_quality_gate_plan', (f) => { f.frameRepairPlans[2].plan.provider.image_config.image_size = '2K'; refreshFramePlanHash(f.frameRepairPlans[2]) }],
    ['wrong max1', 'invalid_quality_gate_plan', (f) => { f.frameRepairPlans[2].plan.max_provider_calls = 2; refreshFramePlanHash(f.frameRepairPlans[2]) }],
    ['setup hash', 'invalid_quality_gate_plan', (f) => { f.request.setupManifestSha256 = sha('wrong setup') }],
    ['setup protocol', 'invalid_quality_gate_plan', (f) => { f.setupManifest.protocol = 'setup_v2'; refreshSetupHash(f) }],
    ['source mismatch', 'invalid_quality_gate_plan', (f) => { f.setupManifest.cases[2].source.source_sha256 = sha('wrong source'); refreshSetupHash(f) }],
    ['target artifact hash', 'invalid_quality_gate_plan', (f) => { f.setupManifest.cases[2].target.artifacts[0].sha256 = sha('wrong target artifact'); refreshSetupHash(f) }],
    ['control identity', 'invalid_quality_gate_plan', (f) => { f.setupManifest.cases[0].control_identity = 'wrong_control'; refreshSetupHash(f) }],
    ['control fields', 'invalid_quality_gate_plan', (f) => { f.request.cases[0].instruction = 'wrong control instruction' }],
  ]
  for (const [name, expectedCode, mutate] of invalidCases) {
    const fixture = makeFixture()
    mutate(fixture)
    assert.throws(() => buildFrameRepairQualityGatePlan(fixture), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true, name)
      assert.equal(error.code, expectedCode, name)
      return true
    })
  }
  const privateFixture = makeFixture()
  privateFixture.frameRepairPlans[0].runtime = { token: 'runtime_secret_DO_NOT_LEAK' }
  privateFixture.frameRepairPlans[0].plan.provider.apiKey = 'provider_secret_DO_NOT_LEAK'
  refreshFramePlanHash(privateFixture.frameRepairPlans[0])
  const publicBytes = serializeFrameRepairQualityGateValue(
    buildFrameRepairQualityGatePlan(privateFixture),
  ).toString('utf8')
  for (const forbidden of ['runtime_secret_DO_NOT_LEAK', 'provider_secret_DO_NOT_LEAK', 'apiKey', 'runtime']) {
    assert.equal(publicBytes.includes(forbidden), false)
  }
  const malicious = makeFixture()
  malicious.request.cases[2].assetId = 'malicious_identity_DO_NOT_ECHO'
  assert.throws(() => buildFrameRepairQualityGatePlan(malicious), (error) => {
    assert.equal(error instanceof FrameRepairQualityGateError, true)
    assert.equal(error.code, 'invalid_quality_gate_plan')
    const serialized = JSON.stringify({ code: error.code, message: error.message, details: error.details })
    assert.equal(serialized.includes('malicious_identity_DO_NOT_ECHO'), false)
    return true
  })
})
test('blind order accepts sessionId plus sealed cases and returns only deterministic frozen aliases', () => {
  const plan = buildFrameRepairQualityGatePlan(makeFixture())
  const input = { sessionId: plan.session_id, cases: structuredClone(plan.cases) }
  const expected = {
    session_id: plan.session_id,
    cases: plan.cases.map(({ case_id, case_hash }) => {
      const inverse = Number.parseInt(sha(`${plan.session_id}\0${case_id}`).slice(0, 2), 16) % 2 === 1
      return {
        case_id,
        case_hash,
        a: inverse ? 'after' : 'before',
        b: inverse ? 'before' : 'after',
      }
    }),
  }
  const first = buildFrameRepairQualityGateBlindOrder(input)
  assert.deepEqual(first, expected)
  assert.deepEqual(buildFrameRepairQualityGateBlindOrder(structuredClone(input)), first)
  assertDeepFrozen(first)
  input.cases[0].case_hash = sha('mutated after blind projection')
  assert.deepEqual(first, expected)
  const reversed = { sessionId: plan.session_id, cases: structuredClone(plan.cases).reverse() }
  assert.deepEqual(
    buildFrameRepairQualityGateBlindOrder(reversed).cases.map((item) => item.case_id),
    reversed.cases.map((item) => item.case_id),
  )
  const serialized = serializeFrameRepairQualityGateValue(first).toString('utf8')
  for (const forbidden of ['verdict', 'image', 'job', 'random', 'clock', 'timestamp']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

function hardGateInput(overrides = {}) {
  return {
    identityComplete: true,
    manifestVerified: true,
    outsideMaskEqual: true,
    outsideMaskChangedPixels: 0,
    candidateAvailable: true,
    compositedFrameAvailable: true,
    qualityEvidenceComplete: true,
    validatorStatus: 'pass',
    validatorBlockingErrors: [],
    continuityComplete: true,
    revisionChainValid: true,
    unrelatedProjectMutation: false,
    providerCalls: 1,
    warnings: [],
    ...structuredClone(overrides),
  }
}

const HARD_GATE_FACTS = {
  identity_complete: true,
  manifest_verified: true,
  outside_mask_equal: true,
  outside_mask_changed_pixels: 0,
  candidate_available: true,
  composited_frame_available: true,
  quality_evidence_complete: true,
  validator_status: 'pass',
  validator_blocking_errors: [],
  continuity_complete: true,
  revision_chain_valid: true,
  unrelated_project_mutation: false,
  provider_calls: 1,
  warnings: [],
}

test('hard-gate projector returns detached frozen pass and non-blocking warning projections', () => {
  const input = hardGateInput()
  const before = structuredClone(input)
  const pass = projectFrameRepairQualityGateHardGates(input)
  assert.deepEqual(pass, { status: 'pass', reasons: [], facts: HARD_GATE_FACTS })
  assert.deepEqual(input, before)
  assertDeepFrozen(pass)
  input.validatorBlockingErrors.push('mutated_after_projection')
  assert.deepEqual(pass, { status: 'pass', reasons: [], facts: HARD_GATE_FACTS })

  const warning = projectFrameRepairQualityGateHardGates(hardGateInput({
    warnings: ['halo_warning'],
  }))
  assert.deepEqual(warning, {
    status: 'warning',
    reasons: ['halo_warning'],
    facts: { ...HARD_GATE_FACTS, warnings: ['halo_warning'] },
  })
  assert.notEqual(warning.status, 'blocked')
  assertDeepFrozen(warning)
  const validatorWarning = projectFrameRepairQualityGateHardGates(hardGateInput({
    validatorStatus: 'warning', warnings: ['validator_warning'],
  }))
  assert.deepEqual(validatorWarning, {
    status: 'warning',
    reasons: ['validator_warning'],
    facts: { ...HARD_GATE_FACTS, validator_status: 'warning', warnings: ['validator_warning'] },
  })
})

test('hard-gate projector maps every blocker to a controlled canonical reason', () => {
  const cases = [
    [{ identityComplete: false }, 'identity_incomplete'],
    [{ manifestVerified: false }, 'artifact_manifest_mismatch'],
    [{ outsideMaskEqual: false }, 'outside_mask_changed'],
    [{ outsideMaskChangedPixels: 1 }, 'outside_mask_changed'],
    [{ candidateAvailable: false }, 'candidate_missing'],
    [{ compositedFrameAvailable: false }, 'composited_frame_missing'],
    [{ qualityEvidenceComplete: false }, 'quality_evidence_incomplete'],
    [{ validatorStatus: 'fail' }, 'validator_blocked'],
    [{ validatorBlockingErrors: ['invalid_mask'] }, 'validator_blocked'],
    [{ continuityComplete: false }, 'continuity_incomplete'],
    [{ revisionChainValid: false }, 'revision_chain_drift'],
    [{ unrelatedProjectMutation: true }, 'unrelated_project_mutation'],
    [{ providerCalls: 0 }, 'provider_call_count_invalid'],
    [{ providerCalls: 2 }, 'provider_call_count_invalid'],
  ]
  for (const [patch, reason] of cases) {
    const result = projectFrameRepairQualityGateHardGates(hardGateInput(patch))
    assert.equal(result.status, 'blocked', reason)
    assert.deepEqual(result.reasons, [reason], reason)
    assertDeepFrozen(result)
  }

  const multiple = projectFrameRepairQualityGateHardGates(hardGateInput({
    identityComplete: false,
    manifestVerified: false,
    outsideMaskEqual: false,
    outsideMaskChangedPixels: 2,
    candidateAvailable: false,
    compositedFrameAvailable: false,
    qualityEvidenceComplete: false,
    validatorStatus: 'fail',
    validatorBlockingErrors: ['invalid_mask'],
    continuityComplete: false,
    revisionChainValid: false,
    unrelatedProjectMutation: true,
    providerCalls: 2,
  }))
  assert.equal(multiple.status, 'blocked')
  assert.deepEqual(multiple.reasons, [
    'identity_incomplete',
    'artifact_manifest_mismatch',
    'outside_mask_changed',
    'candidate_missing',
    'composited_frame_missing',
    'quality_evidence_incomplete',
    'validator_blocked',
    'continuity_incomplete',
    'revision_chain_drift',
    'unrelated_project_mutation',
    'provider_call_count_invalid',
  ])
  assert.equal(new Set(multiple.reasons).size, multiple.reasons.length)
})

test('hard-gate projector rejects non-plain, extra, unsafe, and uncontrolled facts without echo', () => {
  const sentinel = 'private_hard_gate_DO_NOT_ECHO'
  const invalid = [
    Object.assign(Object.create({}), hardGateInput()),
    { ...hardGateInput(), [sentinel]: sentinel },
    hardGateInput({ outsideMaskChangedPixels: -1 }),
    hardGateInput({ outsideMaskChangedPixels: Number.MAX_SAFE_INTEGER + 1 }),
    hardGateInput({ providerCalls: -1 }),
    hardGateInput({ providerCalls: 1.5 }),
    hardGateInput({ providerCalls: Number.MAX_SAFE_INTEGER + 1 }),
    hardGateInput({ warnings: [sentinel] }),
  ]
  for (const value of invalid) {
    assert.throws(() => projectFrameRepairQualityGateHardGates(value), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true)
      assert.equal(error.code, 'invalid_quality_gate_plan')
      const serialized = JSON.stringify({ code: error.code, message: error.message, details: error.details })
      assert.equal(serialized.includes(sentinel), false)
      return true
    })
  }
})

const DECISION_FIELDS = [
  'result', 'failure_domain', 'total_planned', 'completed_candidates',
  'successful_candidates', 'required_successes', 'improvement_rate', 'calls_used',
  'calls_remaining', 'accepted', 'rejected', 'provider_blocked', 'unresolved',
]

function decisionFixture({ completed = 6, successful = completed } = {}) {
  const plan = buildFrameRepairQualityGatePlan(makeFixture())
  const reviews = []
  const hardGates = []
  const outcomes = []
  for (let index = 0; index < plan.cases.length; index += 1) {
    const caseId = plan.cases[index].case_id
    if (index < completed) {
      reviews.push({
        case_id: caseId,
        functional: index < successful
          ? { improvement: 'improved', usability: index % 2 ? 'review_required' : 'usable', new_blocking_defect: false }
          : { improvement: 'same', usability: 'blocked', new_blocking_defect: true },
      })
      const gate = projectFrameRepairQualityGateHardGates(hardGateInput({
        warnings: index === 0 ? ['halo_warning'] : [],
      }))
      hardGates.push({ case_id: caseId, ...gate })
      outcomes.push({
        case_id: caseId,
        outcome: index % 2 === 0 ? 'accepted' : 'rejected',
        provider_calls: 1,
        controlled_reason: null,
      })
    } else {
      outcomes.push({
        case_id: caseId,
        outcome: 'provider_blocked',
        provider_calls: 0,
        controlled_reason: 'provider_unavailable',
      })
    }
  }
  return { plan, reviews, hardGates, outcomes }
}

function decisionView(value) {
  return Object.fromEntries(DECISION_FIELDS.map((key) => [key, value[key]]))
}

function expectedDecision({
  result,
  failureDomain,
  completed,
  successful,
  accepted = Math.ceil(completed / 2),
  rejected = Math.floor(completed / 2),
  providerBlocked = 8 - completed,
  unresolved = 0,
  callsUsed = completed,
}) {
  return {
    result,
    failure_domain: failureDomain,
    total_planned: 8,
    completed_candidates: completed,
    successful_candidates: successful,
    required_successes: Math.ceil(0.7 * completed),
    improvement_rate: completed === 0 ? 0 : successful / completed,
    calls_used: callsUsed,
    calls_remaining: Math.max(0, 8 - callsUsed),
    accepted,
    rejected,
    provider_blocked: providerBlocked,
    unresolved,
  }
}

test('decision derives 6/6, 5/6, and 5/7 passes independent of accept/reject labels', () => {
  for (const [completed, successful] of [[6, 6], [6, 5], [7, 5]]) {
    const input = decisionFixture({ completed, successful })
    input.reviews[0].successful = false
    if (successful < completed) input.reviews[successful].successful = true
    input.reviews[0].provider_secret = 'decision_secret_DO_NOT_LEAK'
    input.hardGates[0].private_image = 'private_image_DO_NOT_LEAK'
    input.outcomes[0].runtime = { token: 'runtime_token_DO_NOT_LEAK' }
    const before = structuredClone(input)
    const actual = computeFrameRepairQualityGateDecision(input)
    assert.deepEqual(decisionView(actual), expectedDecision({
      result: 'passed', failureDomain: null, completed, successful,
    }))
    assert.deepEqual(input, before)
    assertDeepFrozen(actual)
    const serialized = serializeFrameRepairQualityGateValue(actual).toString('utf8')
    for (const forbidden of ['decision_secret_DO_NOT_LEAK', 'private_image_DO_NOT_LEAK', 'runtime_token_DO_NOT_LEAK']) {
      assert.equal(serialized.includes(forbidden), false)
    }
  }
  for (const patch of [
    { improvement: 'same' },
    { usability: 'blocked' },
    { new_blocking_defect: true },
  ]) {
    const input = decisionFixture({ completed: 6, successful: 6 })
    Object.assign(input.reviews[0].functional, patch)
    const actual = computeFrameRepairQualityGateDecision(input)
    assert.equal(actual.result, 'passed')
    assert.equal(actual.successful_candidates, 5)
  }
})

test('decision distinguishes visual-quality failure from insufficient terminal evidence', () => {
  const quality = computeFrameRepairQualityGateDecision(decisionFixture({
    completed: 6,
    successful: 4,
  }))
  assert.deepEqual(decisionView(quality), expectedDecision({
    result: 'quality_failed', failureDomain: 'visual_quality', completed: 6, successful: 4,
  }))

  const tooFew = computeFrameRepairQualityGateDecision(decisionFixture({
    completed: 5,
    successful: 5,
  }))
  assert.deepEqual(decisionView(tooFew), expectedDecision({
    result: 'evidence_insufficient', failureDomain: null, completed: 5, successful: 5,
  }))

  const unknownInput = decisionFixture({ completed: 6, successful: 6 })
  unknownInput.outcomes[7] = {
    case_id: unknownInput.plan.cases[7].case_id,
    outcome: 'outcome_unknown',
    provider_calls: 0,
    controlled_reason: null,
  }
  const unknown = computeFrameRepairQualityGateDecision(unknownInput)
  assert.deepEqual(decisionView(unknown), expectedDecision({
    result: 'evidence_insufficient',
    failureDomain: null,
    completed: 6,
    successful: 6,
    providerBlocked: 1,
    unresolved: 1,
  }))

  const missingInput = decisionFixture({ completed: 6, successful: 6 })
  missingInput.outcomes.pop()
  const missing = computeFrameRepairQualityGateDecision(missingInput)
  assert.deepEqual(decisionView(missing), expectedDecision({
    result: 'evidence_insufficient',
    failureDomain: null,
    completed: 6,
    successful: 6,
    providerBlocked: 1,
    unresolved: 1,
  }))
})

test('decision treats a provider safety filter terminal reason as a safety-domain quality failure', () => {
  const input = decisionFixture({ completed: 6, successful: 6 })
  input.outcomes[7].provider_calls = 1
  input.outcomes[7].controlled_reason = 'provider_safety_filter'
  const actual = computeFrameRepairQualityGateDecision(input)
  assert.equal(actual.result, 'quality_failed')
  assert.equal(actual.failure_domain, 'safety')
  assert.equal(actual.calls_used, 7)
})

test('decision treats a reviewed case with missing outcome and hard gate as a safety failure', () => {
  const input = decisionFixture({ completed: 6, successful: 6 })
  const caseId = input.plan.cases[0].case_id
  input.outcomes = input.outcomes.filter((item) => item.case_id !== caseId)
  input.hardGates = input.hardGates.filter((item) => item.case_id !== caseId)
  const actual = computeFrameRepairQualityGateDecision(input)
  assert.equal(actual.result, 'quality_failed')
  assert.equal(actual.failure_domain, 'safety')
})

test('decision treats provider-blocked outcomes with reviews and gates as a safety failure', () => {
  const input = decisionFixture({ completed: 6, successful: 6 })
  const reviewedCaseIds = new Set(input.reviews.map((item) => item.case_id))
  for (const outcome of input.outcomes) {
    if (!reviewedCaseIds.has(outcome.case_id)) continue
    outcome.outcome = 'provider_blocked'
    outcome.provider_calls = 0
    outcome.controlled_reason = 'provider_unavailable'
  }
  const actual = computeFrameRepairQualityGateDecision(input)
  assert.equal(actual.result, 'quality_failed')
  assert.equal(actual.failure_domain, 'safety')
})

test('decision gives safety failures priority over visual rates and caps remaining calls at zero', () => {
  const blockedGate = decisionFixture({ completed: 6, successful: 6 })
  blockedGate.hardGates[0] = {
    case_id: blockedGate.plan.cases[0].case_id,
    ...projectFrameRepairQualityGateHardGates(hardGateInput({ identityComplete: false })),
  }
  const qualityBlocked = decisionFixture({ completed: 6, successful: 6 })
  qualityBlocked.outcomes[0] = {
    ...qualityBlocked.outcomes[0],
    outcome: 'quality_blocked',
    controlled_reason: 'blocked_by_hard_gate',
  }
  const perCaseCalls = decisionFixture({ completed: 6, successful: 6 })
  perCaseCalls.outcomes[0].provider_calls = 2
  const totalCalls = decisionFixture({ completed: 8, successful: 8 })
  totalCalls.outcomes[0].provider_calls = 2

  for (const input of [blockedGate, qualityBlocked, perCaseCalls, totalCalls]) {
    const actual = computeFrameRepairQualityGateDecision(input)
    assert.equal(actual.result, 'quality_failed')
    assert.equal(actual.failure_domain, 'safety')
    assert.equal(actual.calls_used, input.outcomes.reduce((sum, item) => sum + item.provider_calls, 0))
    assert.equal(actual.calls_remaining, Math.max(0, 8 - actual.calls_used))
    assertDeepFrozen(actual)
  }
  assert.equal(computeFrameRepairQualityGateDecision(totalCalls).calls_used, 9)
  assert.equal(computeFrameRepairQualityGateDecision(totalCalls).calls_remaining, 0)
})

test('serialization rejects an oversized canonical value before JSON.stringify', () => {
  const scalar = 'x'.repeat(1_000_000)
  const value = Array(17).fill(scalar)
  const originalStringify = JSON.stringify
  let stringifyCalls = 0
  JSON.stringify = function stringifySpy(...args) {
    stringifyCalls += 1
    return originalStringify.apply(this, args)
  }
  try {
    assert.throws(() => serializeFrameRepairQualityGateValue(value), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true)
      assert.equal(error.code, 'invalid_quality_gate_plan')
      return true
    })
    assert.equal(stringifyCalls, 0)
  } finally {
    JSON.stringify = originalStringify
  }
})

function resealDecisionPlan(plan) {
  for (const item of plan.cases) {
    const { case_hash: ignoredCaseHash, operation_id: ignoredOperationId, ...canonical } = item
    void ignoredCaseHash
    void ignoredOperationId
    item.case_hash = hashFrameRepairQualityGateValue(canonical)
    item.operation_id = `frqgop_${sha(`${plan.session_id}\0${item.case_id}\0${item.case_hash}`).slice(0, 48)}`
  }
  const { session_plan_hash: ignoredSessionHash, ...session } = plan
  void ignoredSessionHash
  plan.session_plan_hash = hashFrameRepairQualityGateValue(session)
  return plan
}

test('decision validates every nested field of self-consistent sealed plans', () => {
  const valid = computeFrameRepairQualityGateDecision(decisionFixture({
    completed: 6,
    successful: 6,
  }))
  assert.equal(valid.result, 'passed')
  assert.equal(valid.failure_domain, null)

  const mutations = [
    ['setup digest format', (plan) => { plan.setup_manifest_sha256 = 'g'.repeat(64) }],
    ['empty implementation revision', (plan) => { plan.implementation_revision = '' }],
    ['invalid implementation revision', (plan) => { plan.implementation_revision = 'bad\nrevision' }],
    ['project exact keys', (plan) => { plan.project.extra = true }],
    ['project id', (plan) => { plan.project.id = '../unsafe' }],
    ['project initial revision', (plan) => { plan.project.initial_revision = 0 }],
    ['project projection digest', (plan) => { plan.project.initial_projection_sha256 = 'g'.repeat(64) }],
    ['provider exact keys', (plan) => { plan.provider.extra = true }],
    ['provider preset', (plan) => { plan.provider.preset_id = '../unsafe' }],
    ['provider image size', (plan) => { plan.provider.image_size = '4K' }],
    ['call budget exact keys', (plan) => { plan.call_budget.extra = true }],
    ['call budget per case', (plan) => { plan.call_budget.per_case = 2 }],
    ['call budget total', (plan) => { plan.call_budget.total = 7 }],
    ['repair missing key', (plan) => { delete plan.cases[0].repair.instruction }],
    ['repair extra key', (plan) => { plan.cases[0].repair.extra = true }],
    ['repair clip id', (plan) => { plan.cases[0].repair.clip_id = '../unsafe' }],
    ['repair clip position', (plan) => { plan.cases[0].repair.clip_frame_position = 8 }],
    ['repair sheet index', (plan) => { plan.cases[0].repair.sheet_frame_index = 64 }],
    ['repair instruction text', (plan) => { plan.cases[0].repair.instruction = '' }],
    ['repair instruction binding', (plan) => { plan.cases[0].repair.instruction = 'Digest left stale.' }],
    ['repair instruction digest', (plan) => { plan.cases[0].repair.instruction_sha256 = 'g'.repeat(64) }],
    ['repair mask edit', (plan) => { plan.cases[0].repair.mask_edits = [{ op: 'add_rectangle', x: 95, y: 0, width: 2, height: 1 }] }],
    ['repair mask digest', (plan) => { plan.cases[0].repair.mask_sha256 = 'g'.repeat(64) }],
    ['classification exact keys', (plan) => { plan.cases[0].classification.extra = true }],
    ['classification difficulty mapping', (plan) => { plan.cases[0].classification.difficulty = 'hard' }],
    ['classification category mapping', (plan) => { plan.cases[0].classification.defect_category = 'shape' }],
    ['classification expected text', (plan) => { plan.cases[0].classification.expected_improvement = '' }],
    ['classification ownership', (plan) => { plan.cases[0].classification.ownership_class = 'user_owned' }],
    ['authority exact keys', (plan) => { plan.cases[0].authority.extra = true }],
    ['authority digest', (plan) => { plan.cases[0].authority.source_sha256 = 'g'.repeat(64) }],
    ['case provider exact keys', (plan) => { plan.cases[0].provider.extra = true }],
    ['case provider preset binding', (plan) => { plan.cases[0].provider.preset_id = 'preset_secondary' }],
    ['case provider image binding', (plan) => { plan.cases[0].provider.image_size = '2K' }],
    ['case provider max calls', (plan) => { plan.cases[0].provider.max_calls = 2 }],
  ]

  for (const [name, mutate] of mutations) {
    const input = decisionFixture({ completed: 6, successful: 6 })
    input.plan = structuredClone(input.plan)
    mutate(input.plan)
    resealDecisionPlan(input.plan)
    assert.throws(() => computeFrameRepairQualityGateDecision(input), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true, name)
      assert.equal(error.code, 'invalid_quality_gate_plan', name)
      return true
    }, name)
  }
})
