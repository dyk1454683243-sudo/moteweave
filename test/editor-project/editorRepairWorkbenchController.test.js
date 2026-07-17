import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from '../../src/editor-project/repairRecipeSerialization.js'
import { createEmptyLocalRepairState } from '../../src/ui/editor/state.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const IMPLEMENTATION_REVISION = 'package-0.4.0'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function characterFixture({ revisionId = 'rev_001' } = {}) {
  const revision = {
    id: revisionId,
    source_job_id: 'job_parent',
    processing_recipe_ref: null,
    artifacts: {
      source: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/source.png`,
      sheet: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/normalized_sheet.png`,
      animations: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/animations.json`,
      metadata: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/metadata.json`,
      editor_metadata: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/editor_metadata.json`,
      debug_report: `workspace/projects/project_demo/assets/asset_hero/${revisionId}/debug_report.json`,
    },
  }
  const asset = {
    id: 'asset_hero',
    name: 'Hero',
    kind: 'character_pack',
    profile: 'topdown_rpg_v0',
    active_revision_id: revision.id,
    revisions: { [revision.id]: revision },
    clips: {
      walk_down: { id: 'walk_down', label: 'Walk down', frames: [16, 17], fps: 8 },
      empty: { id: 'empty', label: 'Empty', frames: [], fps: 8 },
      attack: { id: 'attack', label: 'Attack', frames: [40, 41], fps: 4 },
    },
  }
  return { asset, revision }
}

function managedDocuments(asset, revision, overrides = {}) {
  const clips = Object.fromEntries(Object.entries(asset.clips).map(([id, clip]) => [id, {
    frames: [...clip.frames],
    fps: clip.fps,
    loop: true,
    mode: 'loop',
  }]))
  return {
    animations: {
      version: TOPDOWN_RPG_V0.version,
      profile: TOPDOWN_RPG_V0.id,
      source_layout: { id: 'fixed_region_motion_v0', kind: 'fixed_regions' },
      sheet: 'normalized_sheet.png',
      frame_size: { ...TOPDOWN_RPG_V0.frame },
      sheet_size: { ...TOPDOWN_RPG_V0.sheet },
      anchor: { x: TOPDOWN_RPG_V0.anchor.x, y: TOPDOWN_RPG_V0.anchor.y },
      animations: clips,
      ...overrides.animations,
    },
    metadata: {
      version: TOPDOWN_RPG_V0.version,
      id: 'npc_fixture',
      name: asset.name,
      profile: TOPDOWN_RPG_V0.id,
      quality: { status: 'pass', warnings: [], blocking_errors: [] },
      ...overrides.metadata,
    },
    editorMetadata: {
      version: TOPDOWN_RPG_V0.version,
      id: 'npc_fixture',
      profile: TOPDOWN_RPG_V0.id,
      sheet: 'normalized_sheet.png',
      frame_size: { ...TOPDOWN_RPG_V0.frame },
      sheet_size: { ...TOPDOWN_RPG_V0.sheet },
      frame_tags: [],
      frames: {},
      attachments: [],
      slices: [],
      ...overrides.editorMetadata,
    },
    debugReport: {
      version: TOPDOWN_RPG_V0.version,
      profile: TOPDOWN_RPG_V0.id,
      source_layout: { id: 'fixed_region_motion_v0', kind: 'fixed_regions' },
      source_staging: { applied: true, mode: 'legacy_stage', stage_size: 252 },
      validation: { status: 'pass', warnings: [], blocking_errors: [] },
      frames: [],
      ...overrides.debugReport,
    },
  }
}

function managedUrl(ref) {
  return `/api/editor/artifact?path=${encodeURIComponent(ref)}`
}

function previewUrls(jobId = 'job_preview') {
  return {
    normalized_sheet_url: `/generated/${jobId}/normalized_sheet.png`,
    animations_url: `/generated/${jobId}/animations.json`,
    metadata_url: `/generated/${jobId}/metadata.json`,
    editor_metadata_url: `/generated/${jobId}/editor_metadata.json`,
    debug_report_url: `/generated/${jobId}/debug_report.json`,
    processing_recipe_url: `/generated/${jobId}/processing_recipe.json`,
    reprocess_context_url: `/generated/${jobId}/editor_reprocess_context.json`,
  }
}

function exactReprocessContext({ job, selection, sourceLayout = 'fixed_region_motion_v0' }) {
  return {
    version: 'editor_reprocess_context_v0',
    job_type: 'editor_character_reprocess',
    preview_job_id: job.id,
    submitted_at: '2026-07-10T00:00:00.000Z',
    project_id: selection.projectId,
    project_revision: selection.projectRevision,
    asset_id: selection.assetId,
    parent_revision_id: selection.revisionId,
    input_mode: 'managed_source',
    input_artifact_key: 'source',
    input_artifact_ref: `workspace/projects/${selection.projectId}/assets/${selection.assetId}/${selection.revisionId}/source.png`,
    input_artifact_sha256: HASH_A,
    black_matte_artifact_sha256: null,
    authoritative_source_layout: sourceLayout,
    recipe_hash: job.recipe_hash,
    draft_settings_hash: job.draft_settings_hash,
    implementation_revision: job.implementation_revision,
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  return { promise, resolve, reject }
}

function harness(options = {}) {
  const { asset, revision } = characterFixture()
  const documents = managedDocuments(asset, revision, options.managedOverrides)
  const state = {
    project: { id: 'project_demo', name: 'Demo', revision: 4, assets: { [asset.id]: asset }, scenes: {} },
    dirty: false,
    sceneHistories: {},
    selectedAssetId: asset.id,
    selectedLayerId: null,
    activePanel: 'repair',
    repair: {
      local: createEmptyLocalRepairState(),
      aiAction: {
        selectedAction: '', providerPresetId: '', imageSize: '1K', plan: null, job: null,
        importResult: null, status: 'idle', message: '', assetId: null, revisionId: null,
      },
    },
  }
  const jsonByUrl = new Map([
    [managedUrl(revision.artifacts.animations), documents.animations],
    [managedUrl(revision.artifacts.metadata), documents.metadata],
    [managedUrl(revision.artifacts.editor_metadata), documents.editorMetadata],
    [managedUrl(revision.artifacts.debug_report), documents.debugReport],
  ])
  const imagesByUrl = new Map([
    [managedUrl(revision.artifacts.source), { width: 252, height: 252, kind: 'source' }],
    [managedUrl(revision.artifacts.sheet), { width: 768, height: 768, kind: 'before' }],
  ])
  const calls = { json: [], image: [], clear: [], render: 0, logs: [] }
  const artifactClient = {
    async loadJson(input) {
      calls.json.push(input)
      if (input.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (!jsonByUrl.has(input.url)) throw Object.assign(new Error(`missing ${input.url}`), { status: 404, code: 'artifact_not_found' })
      return structuredClone(jsonByUrl.get(input.url))
    },
    async loadImage(input) {
      calls.image.push(input)
      if (input.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (!imagesByUrl.has(input.url)) throw Object.assign(new Error(`missing ${input.url}`), { status: 404, code: 'artifact_not_found' })
      return imagesByUrl.get(input.url)
    },
    clearRepairArtifactCache(identity) { calls.clear.push(identity) },
  }
  const lifecycleEvents = []
  let lifecycleSelection = null
  let draftGeneration = 0
  let buildGeneration = 0
  const lifecycle = {
    setSelection(value) { lifecycleSelection = structuredClone(value); return 1 },
    invalidateDraft() { draftGeneration += 1; lifecycleEvents.push(['invalidate', draftGeneration]); return draftGeneration },
    async digestDraft(bytes, { generation } = {}) {
      const hash = sha256(bytes)
      lifecycleEvents.push(['digest', generation, hash])
      return hash
    },
    async build(payload) { buildGeneration += 1; lifecycleEvents.push(['build', structuredClone(payload)]); return null },
    async accept(payload) { lifecycleEvents.push(['accept', structuredClone(payload)]); return { project: state.project, asset } },
    stop() { lifecycleEvents.push(['stop']) },
    capture() { return { token: 1, buildGeneration, selection: structuredClone(lifecycleSelection) } },
    isCurrent() { return true },
    isCurrentBuild(_token, generation, selection) {
      return generation === buildGeneration && JSON.stringify(selection) === JSON.stringify(lifecycleSelection)
    },
  }
  const panel = { render() { calls.render += 1 } }
  return {
    state, asset, revision, documents, jsonByUrl, imagesByUrl, calls, artifactClient,
    lifecycle, lifecycleEvents, panel,
    getUnsavedReason: options.getUnsavedReason ?? (() => state.dirty ? 'Save project changes before building a repair Preview' : null),
  }
}

async function createController(h, overrides = {}) {
  const { createRepairWorkbenchController } = await import('../../src/ui/editor/repairWorkbenchController.js')
  const controller = createRepairWorkbenchController({
    state: h.state,
    profile: TOPDOWN_RPG_V0,
    artifactClient: h.artifactClient,
    lifecycle: h.lifecycle,
    getSelectedAsset: () => h.state.project?.assets?.[h.state.selectedAssetId] ?? null,
    requestRender() { h.calls.render += 1 },
    addLog(message) { h.calls.logs.push(message) },
    renderAiActionContent() {},
    hashDraft: async (bytes) => sha256(bytes),
    getUnsavedReason: h.getUnsavedReason,
    createFrameDifference: () => ({
      imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
      source: { width: 1, height: 1 },
      diagnostics: [],
    }),
    ...overrides,
  })
  controller.attach(h.panel)
  return controller
}

async function installPreviewBundle(h, { status = 'done', qualityStatus = 'pass', clips, overrides = {} } = {}) {
  const local = h.state.repair.local
  const canonical = structuredClone(local.validation.canonical)
  canonical.implementation_revision = IMPLEMENTATION_REVISION
  const recipeHash = sha256(serializeCanonicalRecipe(canonical))
  const draftSettingsHash = sha256(serializeCanonicalRecipe(createDraftSettingsHashInput(canonical)))
  const job = {
    id: 'job_preview',
    type: 'editor_character_reprocess',
    status,
    project_id: local.selection.projectId,
    asset_id: local.selection.assetId,
    parent_revision_id: local.selection.revisionId,
    recipe_hash: recipeHash,
    draft_settings_hash: draftSettingsHash,
    implementation_revision: IMPLEMENTATION_REVISION,
    canonical_recipe: canonical,
    reason: status === 'done' ? null : 'quality evidence failed',
    retry_hint: status === 'done' ? null : 'adjust cleanup settings',
    ...previewUrls(),
    ...overrides.job,
  }
  const previewAnimations = structuredClone(h.documents.animations)
  previewAnimations.source_layout = { id: 'fixed_region_motion_v0', kind: 'fixed_regions' }
  previewAnimations.animations = clips ?? {
    walk_down: { frames: [32, 33], fps: 12, loop: true, mode: 'loop' },
    empty: { frames: [], fps: 8, loop: true, mode: 'loop' },
    attack: { frames: [52, 53], fps: 6, loop: false, mode: 'once' },
  }
  const report = {
    ...h.documents.debugReport,
    validation: {
      status: qualityStatus,
      warnings: qualityStatus === 'warning' ? ['review_palette'] : [],
      blocking_errors: qualityStatus === 'fail' ? ['palette_failed'] : [],
    },
    ...overrides.report,
  }
  const editorMetadata = {
    ...h.documents.editorMetadata,
    ...overrides.editorMetadata,
  }
  const metadata = {
    ...h.documents.metadata,
    quality: { status: qualityStatus, warnings: [], blocking_errors: [] },
    ...overrides.metadata,
  }
  const context = {
    ...exactReprocessContext({ job, selection: local.selection }),
    ...overrides.context,
  }
  const urls = previewUrls(job.id)
  h.imagesByUrl.set(urls.normalized_sheet_url, { width: 768, height: 768, kind: 'after' })
  h.jsonByUrl.set(urls.animations_url, previewAnimations)
  h.jsonByUrl.set(urls.metadata_url, metadata)
  h.jsonByUrl.set(urls.editor_metadata_url, editorMetadata)
  h.jsonByUrl.set(urls.debug_report_url, report)
  h.jsonByUrl.set(urls.processing_recipe_url, overrides.processingRecipe ?? canonical)
  h.jsonByUrl.set(urls.reprocess_context_url, context)
  return job
}

test('Repair controller source owns all extracted session functions and no provider/general-import boundary', async () => {
  const source = await readFile('src/ui/editor/repairWorkbenchController.js', 'utf8')
  for (const expected of [
    'async function openRepairForAsset', 'function handleRepairLifecycleUpdate', 'function dispatchRepairFilmstrip',
    'function hydrateRepairPreview', 'function buildLocalRepairPreview', 'function acceptLocalRepairPreview',
    'currentDraftSettingsHash = null', 'clearRepairArtifactCache', 'submittedCanonicalRecipe',
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /repairCharacterAction|importGeneratedJob|providerPresetId|apiKey|promptText/)
})

test('Repair open derives source authority from managed sidecars, not asset.profile, and preserves staging provenance', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)

  const local = h.state.repair.local
  assert.equal(local.status, 'idle')
  assert.equal(local.sourceContext.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(local.sourceContext.sourceLayoutKind, 'fixed_regions')
  assert.equal(h.asset.profile, 'topdown_rpg_v0')
  assert.deepEqual(local.draft.provenance.fixedRegionStaging, h.documents.debugReport.source_staging)
  assert.equal(local.currentDraftSettingsHash.length, 64)
  assert.equal(local.draft.dirty, false)
  assert.equal(h.calls.json.some((call) => call.url === managedUrl(h.revision.artifacts.metadata)), true)
  assert.equal(h.calls.json.every((call) => call.signal instanceof AbortSignal), true)
})

test('Repair open rejects managed profile disagreement instead of trusting the asset record', async () => {
  const h = harness({ managedOverrides: { metadata: { profile: 'wrong_profile' } } })
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  assert.equal(h.state.repair.local.status, 'failed')
  assert.match(h.state.repair.local.message, /managed_profile_mismatch/)
  assert.equal(h.state.repair.local.draft, null)
})

test('Repair draft hashing synchronizes generations, clears freshness immediately, and never builds implicitly', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const context = controller.contextFor(h.asset, h.revision)
  context.patchDraft({ path: 'background.tolerance', value: 25 })

  const local = h.state.repair.local
  const generation = local.draftHashGeneration
  assert.equal(local.currentDraftSettingsHash, null)
  assert.equal(local.previewModel.state, 'dirty')
  assert.equal(h.lifecycleEvents.some((event) => event[0] === 'build'), false)

  controller.handleLifecycleUpdate({ type: 'draft_hash', hash: HASH_A, draftHashGeneration: generation - 1 })
  assert.equal(local.currentDraftSettingsHash, null)
  controller.handleLifecycleUpdate({ type: 'draft_hash', hash: HASH_B, draftHashGeneration: generation })
  assert.equal(local.currentDraftSettingsHash, HASH_B)
  assert.equal(local.draft.currentDraftSettingsHash, HASH_B)
})

test('Repair Build and Accept are both blocked by unsaved project state with an accessible reason', async () => {
  const h = harness()
  h.state.dirty = true
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const context = controller.contextFor(h.asset, h.revision)
  const view = context.viewModel()
  assert.equal(view.canBuild, false)
  assert.match(view.buildReason, /Save project changes/)
  assert.equal(await context.buildPreview(), null)
  assert.equal(await context.acceptPreview(), null)
  assert.equal(h.lifecycleEvents.some((event) => ['build', 'accept'].includes(event[0])), false)
})

test('Repair Build uses the exact local Recipe envelope and never submits an implementation revision', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  await controller.contextFor(h.asset, h.revision).buildPreview()
  const build = h.lifecycleEvents.find((event) => event[0] === 'build')[1]
  assert.deepEqual(Object.keys(build).sort(), ['assetId', 'expectedAssetRevisionId', 'expectedRevision', 'projectId', 'recipe'])
  assert.equal(build.recipe.implementation_revision, null)
  assert.equal(build.expectedAssetRevisionId, h.revision.id)
})

test('Repair hydration loads and validates the complete seven-artifact evidence set before enabling Accept', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h)

  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })
  const generatedJsonUrls = h.calls.json.filter((call) => call.identity === `job:${job.id}`).map((call) => call.url)
  assert.deepEqual(new Set(generatedJsonUrls), new Set([
    job.animations_url,
    job.metadata_url,
    job.editor_metadata_url,
    job.debug_report_url,
    job.processing_recipe_url,
    job.reprocess_context_url,
  ]))
  assert.equal(h.calls.image.some((call) => call.url === job.normalized_sheet_url), true)
  assert.equal(h.state.repair.local.previewModel.state, 'ready')
  assert.equal(h.state.repair.local.previewModel.acceptance.canAccept, true)
  assert.deepEqual(h.state.repair.local.filmstrip.frames, [32, 33])

  await controller.contextFor(h.asset, h.revision).acceptPreview()
  const accept = h.lifecycleEvents.find((event) => event[0] === 'accept')[1]
  assert.deepEqual(Object.keys(accept).sort(), [
    'assetId', 'expectedAssetRevisionId', 'expectedRecipeHash', 'expectedRevision',
    'jobId', 'projectId', 'warningConfirmed',
  ])
  assert.equal(accept.expectedRecipeHash, job.recipe_hash)
  assert.equal(accept.warningConfirmed, false)
})

test('Repair hydration treats a sidecar identity mismatch as integrity failure and never exposes Accept', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h, { overrides: { context: { asset_id: 'asset_other' } } })
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })

  assert.equal(h.state.repair.local.previewModel.state, 'failed')
  assert.equal(h.state.repair.local.previewModel.acceptance.canAccept, false)
  assert.match(h.state.repair.local.message, /artifact_integrity_failed/)
  assert.equal(await controller.contextFor(h.asset, h.revision).acceptPreview(), null)
})

test('Repair hydration rejects an explicit mismatched project revision on the public preview job', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h, { overrides: { job: { project_revision: 999 } } })
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })

  assert.equal(h.state.repair.local.previewModel.state, 'failed')
  assert.equal(h.state.repair.local.previewModel.acceptance.canAccept, false)
  assert.match(h.state.repair.local.message, /artifact_integrity_failed/)
})

test('Repair lifecycle keeps hydrated evidence inspectable while mapping controlled conflicts', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h)
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })
  const error = Object.assign(new Error('project moved'), { code: 'revision_conflict', details: { expected: 4, actual: 5 } })

  controller.handleLifecycleUpdate({ type: 'error', phase: 'accept', error })

  const local = h.state.repair.local
  assert.equal(local.previewModel.state, 'revision_conflict')
  assert.equal(local.previewModel.artifactsComplete, true)
  assert.equal(local.previewModel.acceptance.canAccept, false)
  assert.equal(local.previewModel.acceptance.reason, 'revision_conflict')
  assert.equal(local.error, error)

  controller.handleLifecycleUpdate({ type: 'build_started' })
  assert.equal(local.error, null)
  assert.equal(local.message, '')
  assert.equal(local.previewModel.state, 'queued')
})

test('Repair warning evidence requires confirmation tied to the exact job and full Recipe hash', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h, { qualityStatus: 'warning' })
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })
  const context = controller.contextFor(h.asset, h.revision)

  assert.equal(h.state.repair.local.previewModel.state, 'warning')
  assert.equal(h.state.repair.local.previewModel.acceptance.reason, 'warning_confirmation_required')
  context.confirmWarning(true)
  assert.equal(h.state.repair.local.previewModel.acceptance.canAccept, true)
  assert.deepEqual(h.state.repair.local.warningConfirmation, {
    jobId: job.id,
    recipeHash: job.recipe_hash,
    confirmed: true,
  })
})

test('Repair failed_post_processing remains inspectable but blocked and preserves reason separately from retry_hint', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h, { status: 'failed_post_processing', qualityStatus: 'fail' })
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })

  const local = h.state.repair.local
  assert.equal(local.previewModel.state, 'blocked_quality')
  assert.equal(local.previewModel.acceptance.canAccept, false)
  const failure = local.previewModel.diagnostics.find((item) => item.code === 'failed_post_processing')
  assert.equal(failure.message, 'quality evidence failed')
  assert.equal(failure.retry_hint, 'adjust cleanup settings')
})

test('Repair filmstrip uses hydrated animation truth, handles empty clips, and keys Difference by revision/job/frame', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const job = await installPreviewBundle(h)
  await controller.handleLifecycleUpdate({ type: 'preview_created', preview: job, buildGeneration: 0 })
  const context = controller.contextFor(h.asset, h.revision)

  context.selectFilmstripFrame(1)
  assert.equal(h.state.repair.local.view.frameIndex, 33)
  assert.equal([...h.state.repair.local.differenceCache.keys()].some((key) => key.includes(`asset_hero:${h.revision.id}:${job.id}:33`)), true)
  context.selectClip('empty')
  assert.equal(h.state.repair.local.view.frameIndex, null)
  assert.equal(h.state.repair.local.renderFrame.beforeRect, null)
  assert.equal(h.state.repair.local.renderFrame.differenceSource, null)
  context.selectClip('attack')
  assert.deepEqual(h.state.repair.local.filmstrip.frames, [52, 53])
  assert.equal(h.state.repair.local.view.frameIndex, 52)
})

test('Repair close preserves the local draft on a panel switch while dispose clears managed and job caches', async () => {
  const h = harness()
  const controller = await createController(h)
  await controller.openAsset(h.asset)
  const context = controller.contextFor(h.asset, h.revision)
  context.patchDraft({ path: 'background.tolerance', value: 25 })
  const draft = h.state.repair.local.draft
  h.state.repair.local.preview = { jobId: 'job_preview' }

  controller.close('panel_switch')
  assert.equal(h.state.repair.local.draft, draft)
  assert.equal(h.state.repair.local.draft.dirty, true)
  controller.dispose()
  assert.deepEqual(new Set(h.calls.clear), new Set(['asset_hero:rev_001', 'job:job_preview']))
  assert.equal(h.lifecycleEvents.some((event) => event[0] === 'stop'), true)
})

test('Frame Repair adapter snapshots the immutable parent clip instead of an unaccepted Preview clip', async () => {
  const h = harness()
  const entries = []
  const closes = []
  const frameRepairController = {
    enter(snapshot) { entries.push(snapshot); return true },
    close(reason) { closes.push(reason) },
    dispose() {},
    decorateWorkbenchView(view) { return view },
  }
  const controller = await createController(h, { frameRepairController })
  await controller.openAsset(h.asset)
  const local = h.state.repair.local
  local.previewModel.clips = {
    walk_down: { id: 'walk_down', frames: [52, 53], fps: 6, loop_mode: 'loop' },
  }
  local.filmstrip = { frames: [52, 53], selectedIndex: 0, playing: false }
  local.view.clipId = 'walk_down'
  local.view.frameIndex = 52
  local.renderFrame.beforeRect = { sx: 384, sy: 576, sw: 96, sh: 96 }

  assert.equal(controller.contextFor(h.asset, h.revision).enterFrameRepair(), true)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].clipFrames, [16, 17])
  assert.equal(entries[0].clipFramePosition, 0)
  assert.equal(entries[0].sheetFrameIndex, 16)
  assert.deepEqual(entries[0].beforeRect, { sx: 0, sy: 192, sw: 96, sh: 96 })

  closes.length = 0
  controller.contextFor(h.asset, h.revision).selectFilmstripFrame(1)
  assert.deepEqual(closes, ['selection_switched'])
})

test('Repair superseded open aborts its managed loads and cannot replace the newer session', async () => {
  const h = harness()
  const originalLoadJson = h.artifactClient.loadJson
  const firstAnimations = createDeferred()
  let delayed = true
  h.artifactClient.loadJson = async (input) => {
    if (delayed && input.url === managedUrl(h.revision.artifacts.animations)) {
      h.calls.json.push(input)
      return firstAnimations.promise
    }
    return originalLoadJson(input)
  }
  const controller = await createController(h)
  const first = controller.openAsset(h.asset)
  await Promise.resolve()
  delayed = false
  const second = controller.openAsset(h.asset)
  firstAnimations.resolve(h.documents.animations)
  await Promise.all([first, second])

  assert.equal(h.calls.json.some((call) => call.signal?.aborted), true)
  assert.equal(h.state.repair.local.status, 'idle')
  assert.equal(h.state.repair.local.openGeneration >= 2, true)
})

test('Quality Gate receives only narrow Workbench delegates for snapshot, selection, locked Generate, and deferred Accept', async () => {
  const h = harness()
  const calls = []
  const frameRepairController = {
    enterQualityGateAuthoringCase(snapshot) { calls.push(['author', snapshot]); return true },
    enterLockedQualityGateCase(snapshot, value) { calls.push(['locked', snapshot, value]); return true },
    exportQualityGateCaseDraft(metadata) { calls.push(['draft', metadata]); return { ...metadata } },
    generateOneCandidate(options) { calls.push(['generate', options]); return Promise.resolve({ id: 'job_frame' }) },
    acceptCandidate(options) { calls.push(['accept', options]); return Promise.resolve({ accepted: true }) },
    close(reason) { calls.push(['close', reason]) },
    dispose() {},
    decorateWorkbenchView(view) { return view },
  }
  const controller = await createController(h, { frameRepairController })
  await controller.openAsset(h.asset)

  const snapshot = controller.frameRepairSnapshot()
  assert.equal(snapshot.selection.assetId, 'asset_hero')
  assert.equal(snapshot.sheetFrameIndex, 16)
  assert.equal(Object.hasOwn(snapshot, 'local'), false)
  assert.equal(controller.setFrameRepairComparisonView({ mode: 'difference', zoom: 3, pan: { x: 4, y: -2 } }), true)
  assert.equal(h.state.repair.local.view.mode, 'difference')
  assert.equal(controller.selectFrameRepairClip('attack'), true)
  assert.equal(controller.selectFrameRepairFrame(1), true)
  assert.equal(h.state.repair.local.view.frameIndex, 41)
  assert.equal(controller.enterQualityGateAuthoringCase(), true)
  assert.equal(controller.enterLockedQualityGateCase({ caseId: 'case_user_01' }), true)
  assert.deepEqual(controller.exportQualityGateCaseDraft({ difficulty: 'medium' }), { difficulty: 'medium' })
  assert.deepEqual(await controller.generateQualityGateCandidate('frqgop_' + 'a'.repeat(48)), { id: 'job_frame' })
  assert.deepEqual(await controller.acceptQualityGateCandidateDeferred(), { accepted: true })
  assert.deepEqual(calls.find(([type]) => type === 'generate')[1], { operationId: 'frqgop_' + 'a'.repeat(48) })
  assert.deepEqual(calls.find(([type]) => type === 'accept')[1], { deferProjectAdoption: true })
})
