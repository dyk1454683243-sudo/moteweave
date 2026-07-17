import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { createFrameRepairController } from '../../src/ui/editor/frameRepairController.js'
import { createEmptyFrameRepairState } from '../../src/ui/editor/frameRepairState.js'

const PLAN_HASH = 'a'.repeat(64)
const MASK_HASH = 'b'.repeat(64)
const OPERATION_ID = 'fr_0123456789abcdef'
const JOB_ID = 'job_frame_repair'

const ARTIFACT_FILES = Object.freeze({
  patched_normalized_sheet: 'patched_normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  frame_repair_plan: 'frame_repair_plan.json',
  frame_repair_context: 'editor_frame_repair_context.json',
  frame_repair_mask: 'frame_repair_mask.png',
  frame_repair_quality: 'frame_repair_quality.json',
  target_before: 'target_before.png',
  composited_candidate_frame: 'composited_candidate_frame.png',
  frame_repair_difference: 'frame_repair_difference.png',
})

function rectangleRuns({ x, y, width, height }, frameWidth = 96) {
  return Array.from({ length: height }, (_, row) => ({
    start: (y + row) * frameWidth + x,
    length: width,
  }))
}

function providerState() {
  return {
    available: true,
    implemented: true,
    provider: 'gemini',
    model: 'model-a',
    active_preset_id: 'gemini-default',
    presets: [{
      id: 'gemini-default',
      provider: 'gemini',
      label: 'Gemini default',
      model: 'model-a',
      available: true,
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    }],
  }
}

function workbenchSnapshot(overrides = {}) {
  return {
    selection: {
      projectId: 'project_demo',
      projectRevision: 4,
      assetId: 'asset_hero',
      revisionId: 'rev_003',
    },
    clipId: 'walk_down',
    clipFrames: [32, 33, 34],
    clipFramePosition: 1,
    sheetFrameIndex: 33,
    beforeImage: { width: 768, height: 768, kind: 'parent-sheet' },
    beforeRect: { sx: 96, sy: 384, sw: 96, sh: 96 },
    providerState: providerState(),
    unsavedReason: null,
    workbenchView: {
      view: {
        clipId: 'walk_down',
        frameIndex: 33,
        mode: 'before',
        zoom: 2,
        pan: { x: 7, y: -3 },
        overlays: { cuts: true, anchor: true, baseline: true, bbox: true, debug: false },
      },
      renderFrame: { mode: 'before', zoom: 2, pan: { x: 7, y: -3 } },
    },
    ...overrides,
  }
}

function canonicalPlan(body, { maskRuns = null } = {}) {
  const runs = maskRuns ?? rectangleRuns(body.maskEdits.find((edit) => edit.op === 'add_rectangle'))
  const activePixelCount = runs.reduce((total, run) => total + run.length, 0)
  return {
    version: 'frame_repair_plan_v1',
    project: { id: 'project_demo', revision: 4 },
    asset: { id: 'asset_hero', parent_revision_id: 'rev_003' },
    profile: { id: TOPDOWN_RPG_V0.id, frame_size: { ...TOPDOWN_RPG_V0.frame } },
    clip: {
      id: 'walk_down',
      frames: [32, 33, 34],
      position: 1,
      sheet_frame_index: 33,
      context_frames: [
        { position: 0, sheet_frame_index: 32, sha256: '1'.repeat(64) },
        { position: 2, sheet_frame_index: 34, sha256: '2'.repeat(64) },
      ],
    },
    parent_sheet_sha256: '3'.repeat(64),
    target_frame_sha256: '4'.repeat(64),
    references: {
      input_reference_roles: ['target_enlarged', 'mask_visualization', 'clip_context', 'full_sheet'],
      context_sha256: '5'.repeat(64),
      items: [],
    },
    mask: {
      width: 96,
      height: 96,
      source: 'user_scoped',
      confidence: 'user_confirmed',
      runs,
      activePixelCount,
      sha256: MASK_HASH,
    },
    instruction: body.instruction.trim(),
    provider: {
      id: body.providerPresetId,
      provider: 'gemini',
      label: 'Gemini default',
      model: 'model-a',
      image_config: { image_size: body.imageConfig.image_size, aspect_ratio: '1:1' },
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    implementation_revision: 'package-0.4.0',
  }
}

function planResult(body, overrides = {}) {
  const plan = overrides.plan ?? canonicalPlan(body, overrides)
  return {
    plan,
    plan_hash: overrides.plan_hash ?? PLAN_HASH,
    can_run: overrides.can_run ?? true,
    diagnostics: overrides.diagnostics ?? [],
    estimated_provider_calls: 1,
    max_provider_calls: 1,
  }
}

function completedJob(overrides = {}) {
  return {
    id: JOB_ID,
    type: 'editor_character_frame_repair',
    status: 'done',
    project_id: 'project_demo',
    project_revision: 4,
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_003',
    operation_id: OPERATION_ID,
    plan_hash: PLAN_HASH,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 1,
    quality_status: 'pass',
    recovery_state: null,
    ...Object.fromEntries(Object.entries(ARTIFACT_FILES).map(([key, file]) => [
      `${key}_url`, `/generated/${JOB_ID}/${file}`,
    ])),
    ...overrides,
  }
}

function qualityReport(status = 'pass') {
  return {
    status,
    complete: true,
    completeness: { complete: true, missing: [] },
    integrity: {
      non_target_equal: true,
      target_outside_mask_equal: true,
      actual_non_target_changed: 0,
      actual_outside_mask_changed: 0,
      changed_inside_mask: 12,
    },
    validation: {
      status: status === 'warning' ? 'warning' : status,
      warnings: status === 'warning' ? ['review_continuity'] : [],
      blocking_errors: status === 'fail' ? ['quality_failed'] : [],
      deltas: {
        warnings_added: status === 'warning' ? ['review_continuity'] : [],
        warnings_removed: [],
        blocking_errors_added: status === 'fail' ? ['quality_failed'] : [],
        blocking_errors_removed: [],
      },
    },
  }
}

function operationContext(job = completedJob()) {
  return {
    version: 'editor_frame_repair_context_v1',
    job_type: 'editor_character_frame_repair',
    job_id: job.id,
    operation_id: job.operation_id,
    submitted_at: '2026-07-11T00:00:00.000Z',
    project_id: job.project_id,
    project_revision: 4,
    asset_id: job.asset_id,
    parent_revision_id: job.parent_revision_id,
    parent_sheet_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_003/normalized_sheet.png',
    parent_sheet_sha256: '3'.repeat(64),
    parent_processing_recipe_ref: null,
    profile: TOPDOWN_RPG_V0.id,
    frame_size: { ...TOPDOWN_RPG_V0.frame },
    sheet_size: { ...TOPDOWN_RPG_V0.sheet },
    clip_id: 'walk_down',
    clip_frame_position: 1,
    sheet_frame_index: 33,
    target_frame_sha256: '4'.repeat(64),
    context_frames: [],
    reference_context_sha256: '5'.repeat(64),
    mask_sha256: MASK_HASH,
    plan_hash: PLAN_HASH,
    provider_preset: {
      id: 'gemini-default', provider: 'gemini', label: 'Gemini default', model: 'model-a',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
    provider_call_budget: 1,
    provider_calls_used: 1,
    implementation_revision: 'package-0.4.0',
    input_reference_roles: ['target_enlarged', 'mask_visualization', 'clip_context', 'full_sheet'],
    sealed_artifacts: [],
  }
}

function artifactBundle(plan, job = completedJob(), quality = qualityReport()) {
  const images = new Map([
    [job.patched_normalized_sheet_url, { width: 768, height: 768, kind: 'candidate-sheet' }],
    [job.frame_repair_mask_url, { width: 96, height: 96, kind: 'mask' }],
    [job.target_before_url, { width: 96, height: 96, kind: 'target-before' }],
    [job.composited_candidate_frame_url, { width: 96, height: 96, kind: 'candidate-frame' }],
    [job.frame_repair_difference_url, { width: 96, height: 96, kind: 'difference' }],
  ])
  const json = new Map([
    [job.animations_url, {
      version: TOPDOWN_RPG_V0.version,
      profile: TOPDOWN_RPG_V0.id,
      sheet: 'normalized_sheet.png',
      frame_size: { ...TOPDOWN_RPG_V0.frame },
      sheet_size: { ...TOPDOWN_RPG_V0.sheet },
      animations: { walk_down: { frames: [32, 33, 34], fps: 8, loop: true, mode: 'loop' } },
    }],
    [job.metadata_url, { profile: TOPDOWN_RPG_V0.id, quality: { status: quality.status } }],
    [job.editor_metadata_url, {
      version: TOPDOWN_RPG_V0.version,
      profile: TOPDOWN_RPG_V0.id,
      sheet: 'normalized_sheet.png',
      frame_size: { ...TOPDOWN_RPG_V0.frame },
      sheet_size: { ...TOPDOWN_RPG_V0.sheet },
    }],
    [job.debug_report_url, { profile: TOPDOWN_RPG_V0.id, validation: quality.validation }],
    [job.frame_repair_plan_url, structuredClone(plan)],
    [job.frame_repair_context_url, operationContext(job)],
    [job.frame_repair_quality_url, structuredClone(quality)],
  ])
  return { images, json }
}

function transparentFrame() {
  return { width: 96, height: 96, data: new Uint8ClampedArray(96 * 96 * 4) }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function controllerHarness(options = {}) {
  const apiCalls = []
  const lifecycleCalls = []
  const acceptedProjects = []
  const announcements = []
  const artifactCalls = []
  const project = {
    id: 'project_demo', revision: 4,
    assets: { asset_hero: { id: 'asset_hero', kind: 'character_pack', active_revision_id: 'rev_003' } },
    scenes: { scene_main: { id: 'scene_main', layers: [] } },
  }
  const state = {
    project,
    dirty: false,
    sceneHistories: { 'project_demo:scene_main': { cursor: 0, snapshots: [] } },
    repair: {
      frame: createEmptyFrameRepairState(),
      local: {
        view: structuredClone(workbenchSnapshot().workbenchView.view),
        renderFrame: { ...workbenchSnapshot().workbenchView.renderFrame },
      },
    },
  }
  let currentPlan = null
  let currentBundle = { images: new Map(), json: new Map() }
  const generatedJob = options.job ?? completedJob({ quality_status: options.qualityStatus ?? 'pass' })
  if (options.initialPlanBody) {
    currentPlan = planResult(options.initialPlanBody)
    currentBundle = artifactBundle(
      currentPlan.plan,
      generatedJob,
      options.quality ?? qualityReport(options.qualityStatus ?? 'pass'),
    )
  }
  const lifecycle = {
    setSelection(value) { lifecycleCalls.push(['selection', structuredClone(value)]) },
    invalidatePlan(reason) { lifecycleCalls.push(['invalidate', reason]) },
    async plan(input) {
      apiCalls.push(['plan', structuredClone(input)])
      if (options.planDeferred) return options.planDeferred.promise
      const overrides = typeof options.planOverrides === 'function'
        ? options.planOverrides(input.body)
        : options.planOverrides
      currentPlan = planResult(input.body, overrides)
      return structuredClone(currentPlan)
    },
    async generate(input) {
      apiCalls.push(['generate', structuredClone(input)])
      const body = input.body
      currentPlan ??= planResult(body)
      currentBundle = artifactBundle(
        currentPlan.plan,
        generatedJob,
        options.quality ?? qualityReport(options.qualityStatus ?? 'pass'),
      )
      options.mutateBundle?.(currentBundle, generatedJob)
      if (options.removeArtifactUrl) {
        currentBundle.json.delete(generatedJob[options.removeArtifactUrl])
        currentBundle.images.delete(generatedJob[options.removeArtifactUrl])
      }
      return structuredClone(generatedJob)
    },
    async recoverFromSession() {
      lifecycleCalls.push(['recover'])
      return options.recoveredJob ? structuredClone(options.recoveredJob) : null
    },
    async accept(input) {
      apiCalls.push(['accept', structuredClone(input)])
      return options.acceptResult ?? { project: { ...project, revision: 5 }, asset: { id: 'asset_hero' } }
    },
    stop(reason) { lifecycleCalls.push(['stop', reason]) },
    capture() { return { recoveryHandle: options.recoveryHandle ?? null } },
  }
  const artifactClient = {
    async loadImage(input) {
      artifactCalls.push(['image', input])
      assert.equal(input.allowedGeneratedUrls.has(input.url), true)
      if (!currentBundle.images.has(input.url)) throw Object.assign(new Error('artifact missing'), { code: 'artifact_not_found' })
      return currentBundle.images.get(input.url)
    },
    async loadJson(input) {
      artifactCalls.push(['json', input])
      assert.equal(input.allowedGeneratedUrls.has(input.url), true)
      if (!currentBundle.json.has(input.url)) throw Object.assign(new Error('artifact missing'), { code: 'artifact_not_found' })
      return structuredClone(currentBundle.json.get(input.url))
    },
    clearRepairArtifactCache(identity) { artifactCalls.push(['clear', identity]) },
  }
  let renders = 0
  const controller = createFrameRepairController({
    state,
    lifecycle,
    artifactClient,
    profile: TOPDOWN_RPG_V0,
    requestRender() { renders += 1 },
    onProjectAccepted(result) { acceptedProjects.push(result) },
    announce(message) { announcements.push(message) },
    readFramePixels: options.readFramePixels ?? (() => transparentFrame()),
    createDifference: () => ({ width: 96, height: 96, kind: 'difference' }),
    createMaskSource: () => ({ width: 96, height: 96, kind: 'mask-source' }),
  })
  function installBundle(job = generatedJob, quality = options.quality ?? qualityReport(options.qualityStatus ?? 'pass')) {
    currentPlan ??= planResult({
      instruction: 'repair the hand',
      maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
      providerPresetId: 'gemini-default',
      imageConfig: { image_size: '1K' },
    })
    currentBundle = artifactBundle(currentPlan.plan, job, quality)
    return job
  }
  return {
    state, project, controller, lifecycle, apiCalls, lifecycleCalls, artifactCalls,
    acceptedProjects, announcements, installBundle,
    get renders() { return renders },
  }
}

async function prepareRunnableController(h) {
  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  await h.controller.reviewCall()
}

test('controller entry and edits are local; only Review and Generate call their APIs', async () => {
  const h = controllerHarness()
  const projectBefore = JSON.stringify(h.state.project)
  const historyBefore = structuredClone(h.state.sceneHistories)

  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  assert.deepEqual(h.apiCalls, [])
  assert.equal(h.state.repair.frame.uiState, 'invalid_mask')

  await h.controller.reviewCall()
  assert.deepEqual(h.apiCalls.map(([type]) => type), ['plan'])
  assert.equal(h.state.repair.frame.uiState, 'planned')
  await h.controller.generateOneCandidate()
  assert.equal(h.apiCalls.filter(([type]) => type === 'generate').length, 1)
  assert.equal(h.state.repair.frame.uiState, 'ready')
  assert.equal(JSON.stringify(h.state.project), projectBefore)
  assert.equal(h.state.dirty, false)
  assert.deepEqual(h.state.sceneHistories, historyBefore)
})

test('submitted and completed operations keep target inputs frozen until discard', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  await h.controller.generateOneCandidate()

  assert.equal(h.state.repair.frame.uiState, 'ready')
  assert.equal(h.controller.viewModel().canEdit, false)
  assert.equal(h.controller.setInstruction('change the completed operation'), false)
  assert.equal(h.controller.addRectangle({ x: 20, y: 20, width: 4, height: 4 }), false)
  assert.equal(h.state.repair.frame.instruction, 'repair the hand')
  assert.equal(h.state.repair.frame.maskEdits.length, 1)
})

test('instruction input is capped at 500 Unicode characters without splitting a surrogate pair', async () => {
  const h = controllerHarness()
  const input = `a${'🧩'.repeat(500)}`

  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction(input)
  await h.controller.reviewCall()

  const instruction = h.apiCalls.find(([type]) => type === 'plan')[1].body.instruction
  assert.equal([...instruction].length, 500)
  assert.equal(instruction, [...input].slice(0, 500).join(''))
  assert.doesNotMatch(instruction, /[\uD800-\uDFFF]$/u)
})

test('empty or mismatched selected frames stay honest and never enter lifecycle submission', () => {
  const h = controllerHarness()
  const entered = h.controller.enter(workbenchSnapshot({ clipFramePosition: 5 }))

  assert.equal(entered, false)
  assert.equal(h.state.repair.frame.uiState, 'no_frame')
  assert.deepEqual(h.apiCalls, [])
  assert.equal(h.lifecycleCalls.some(([type]) => type === 'selection'), false)
})

test('unsupported assets cannot enter Frame Repair even with a syntactically valid snapshot', () => {
  const h = controllerHarness()
  h.state.project.assets.asset_hero.kind = 'scene_pack'

  assert.equal(h.controller.enter(workbenchSnapshot()), false)
  assert.equal(h.state.repair.frame.uiState, 'unsupported_asset')
  assert.equal(h.lifecycleCalls.some(([type]) => type === 'selection'), false)
})

test('mask, instruction, provider, and image edits invalidate a Plan and ignore its late result', async () => {
  const planDeferred = deferred()
  const h = controllerHarness({ planDeferred })
  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  const planning = h.controller.reviewCall()

  h.controller.setInstruction('repair the other hand')
  h.controller.setProviderPreset('gemini-default')
  h.controller.setImageSize('2K')
  planDeferred.resolve(planResult({
    ...h.apiCalls[0][1].body,
    instruction: 'repair the hand',
  }))

  assert.equal(await planning, null)
  assert.equal(h.state.repair.frame.plan, null)
  assert.equal(h.state.repair.frame.stage, 'target_mask')
  assert.equal(h.apiCalls.filter(([type]) => type === 'generate').length, 0)
})

test('client rejects noncanonical adjacent mask runs from a Plan response', async () => {
  const h = controllerHarness({
    planOverrides: (body) => ({
      plan: canonicalPlan(body, {
        maskRuns: [{ start: 10, length: 2 }, { start: 12, length: 2 }],
      }),
    }),
  })
  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')

  assert.equal(await h.controller.reviewCall(), null)
  assert.equal(h.state.repair.frame.plan, null)
  assert.equal(h.state.repair.frame.uiState, 'failed_processing')
})

test('repeated sheet frames preserve the selected clip position in the Plan request', async () => {
  const repeatedFrames = [32, 33, 33, 34]
  const h = controllerHarness({
    planOverrides: (body) => {
      const plan = canonicalPlan(body)
      plan.clip.frames = [...repeatedFrames]
      plan.clip.position = 2
      plan.clip.sheet_frame_index = 33
      return { plan }
    },
  })
  h.controller.enter(workbenchSnapshot({
    clipFrames: repeatedFrames,
    clipFramePosition: 2,
    sheetFrameIndex: 33,
  }))
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  await h.controller.reviewCall()

  assert.equal(h.apiCalls[0][1].body.clipFramePosition, 2)
  assert.equal(h.apiCalls[0][1].body.sheetFrameIndex, 33)
  assert.equal(h.state.repair.frame.plan.plan.clip.position, 2)
})

test('successful hydration decorates the existing Canvas and filmstrip without replacing the parent revision', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  await h.controller.generateOneCandidate()

  const baseView = {
    frameIndex: 33,
    mode: 'after',
    zoom: 2,
    pan: { x: 0, y: 0 },
    filmstrip: {
      items: [32, 33, 34].map((frameIndex, index) => ({
        index,
        frameIndex,
        source: { width: 768, height: 768, kind: 'parent-sheet' },
        rect: { sx: frameIndex % 8 * 96, sy: Math.floor(frameIndex / 8) * 96, sw: 96, sh: 96 },
      })),
    },
    renderFrame: {
      mode: 'after',
      before: { width: 768, height: 768, kind: 'parent-sheet' },
      beforeRect: { sx: 96, sy: 384, sw: 96, sh: 96 },
      frameSize: { w: 96, h: 96 },
      overlayCommands: [
        { type: 'line', overlay: 'cuts' },
        { type: 'anchor', overlay: 'anchor' },
        { type: 'line', overlay: 'baseline' },
        { type: 'rect', overlay: 'bbox' },
        { type: 'anchor', overlay: 'debug' },
      ],
      drawOverlay() {},
    },
  }
  const decorated = h.controller.decorateWorkbenchView(baseView)

  assert.equal(decorated.frameRepair.active, true)
  assert.equal(decorated.renderFrame.after.kind, 'candidate-sheet')
  assert.equal(decorated.renderFrame.differenceSource.kind, 'difference')
  assert.equal(decorated.renderFrame.overlayCommands.some((command) => command.type === 'frame_repair_mask'), true)
  assert.deepEqual(
    decorated.renderFrame.overlayCommands
      .filter((command) => !command.type.startsWith('frame_repair_'))
      .map((command) => command.overlay),
    ['anchor', 'bbox'],
  )
  assert.equal(decorated.filmstrip.items.every((item) => item.source.kind === 'candidate-sheet'), true)
  assert.deepEqual(
    decorated.filmstrip.items.filter((item) => item.repaired).map((item) => item.frameIndex),
    [33],
  )
  assert.equal(h.state.project.assets.asset_hero.active_revision_id, 'rev_003')
})

test('Frame Repair hides an old Reprocess After until its own candidate exists', () => {
  const h = controllerHarness()
  h.controller.enter(workbenchSnapshot())
  const decorated = h.controller.decorateWorkbenchView({
    frameIndex: 33,
    modeAvailability: { after: { enabled: true } },
    filmstrip: {
      items: [{
        frameIndex: 33,
        source: { width: 768, height: 768, kind: 'parent-sheet' },
      }],
    },
    renderFrame: {
      before: { width: 768, height: 768, kind: 'parent-sheet' },
      beforeRect: { sx: 96, sy: 384, sw: 96, sh: 96 },
      after: { width: 768, height: 768, kind: 'old-reprocess-preview' },
      afterSheet: { width: 768, height: 768, kind: 'old-reprocess-preview' },
      afterRect: { sx: 96, sy: 384, sw: 96, sh: 96 },
      differenceSource: { width: 96, height: 96, kind: 'old-difference' },
      overlayCommands: [],
    },
  })

  assert.equal(decorated.renderFrame.after, null)
  assert.equal(decorated.renderFrame.afterSheet, null)
  assert.equal(decorated.renderFrame.afterRect, null)
  assert.equal(decorated.renderFrame.differenceSource, null)
  assert.equal(decorated.modeAvailability.after.enabled, false)
  assert.equal(decorated.filmstrip.items[0].repaired, false)
  assert.equal(decorated.filmstrip.items[0].repairedLabel, null)
})

test('duplicate done-job adoption shares one artifact hydration', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  const job = h.installBundle()

  const first = h.controller.handleLifecycleUpdate({ type: 'job', job })
  const duplicate = h.controller.handleLifecycleUpdate({ type: 'job', job: structuredClone(job) })
  await Promise.all([first, duplicate])

  assert.equal(h.artifactCalls.filter(([type]) => type === 'image').length, 5)
  assert.equal(h.artifactCalls.filter(([type]) => type === 'json').length, 7)
  assert.equal(h.state.repair.frame.uiState, 'ready')
})

test('done jobs with incomplete call accounting are rejected before artifact hydration', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  const invalid = completedJob({ provider_calls_used: 0, generated_candidate_count: 0 })
  h.installBundle(invalid)

  assert.equal(await h.controller.handleLifecycleUpdate({ type: 'job', job: invalid }), null)
  assert.equal(h.state.repair.frame.uiState, 'failed_processing')
  assert.equal(h.artifactCalls.some(([type]) => type === 'image' || type === 'json'), false)
})

test('job project revision mismatch is rejected before artifact hydration', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  const invalid = completedJob({ project_revision: 5 })
  h.installBundle(invalid)

  assert.equal(await h.controller.handleLifecycleUpdate({ type: 'job', job: invalid }), null)
  assert.equal(h.state.repair.frame.uiState, 'project_conflict')
  assert.equal(h.artifactCalls.some(([type]) => type === 'image' || type === 'json'), false)
})

test('frozen transport errors still enter outcome_unknown without mutating the error object', async () => {
  const h = controllerHarness()
  h.controller.enter(workbenchSnapshot())
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  const error = Object.freeze(Object.assign(new Error('connection lost'), { code: 'network_failed' }))

  assert.doesNotThrow(() => h.controller.handleLifecycleUpdate({
    type: 'error', phase: 'generate', error, outcomeUnknown: true,
  }))
  assert.equal(h.state.repair.frame.uiState, 'outcome_unknown')
  assert.equal(h.controller.setInstruction('start a second call'), false)
  assert.equal(h.controller.addRectangle({ x: 20, y: 20, width: 4, height: 4 }), false)
  assert.equal(await h.controller.reviewCall(), null)
  assert.deepEqual(h.apiCalls, [])
  assert.equal(h.state.repair.frame.uiState, 'outcome_unknown')
})

test('partial artifact failure and job identity mismatch block review without exposing a candidate', async (t) => {
  await t.test('partial artifact failure', async () => {
    const h = controllerHarness({ removeArtifactUrl: 'frame_repair_quality_url' })
    await prepareRunnableController(h)
    assert.equal(await h.controller.generateOneCandidate(), null)
    assert.equal(h.state.repair.frame.uiState, 'failed_processing')
    assert.equal(h.state.repair.frame.candidate, null)
  })

  await t.test('parent revision mismatch', async () => {
    const h = controllerHarness({ job: completedJob({ parent_revision_id: 'rev_004' }) })
    await prepareRunnableController(h)
    assert.equal(await h.controller.generateOneCandidate(), null)
    assert.equal(h.state.repair.frame.uiState, 'asset_revision_conflict')
    assert.equal(h.artifactCalls.some(([type]) => type === 'image' || type === 'json'), false)
  })
})

test('missing repaired clip and failed pixel integrity stay blocked and never expose a candidate', async (t) => {
  await t.test('missing repaired clip', async () => {
    const h = controllerHarness({
      mutateBundle(bundle, job) {
        delete bundle.json.get(job.animations_url).animations.walk_down
      },
    })
    await prepareRunnableController(h)
    assert.equal(await h.controller.generateOneCandidate(), null)
    assert.equal(h.state.repair.frame.uiState, 'blocked_quality')
    assert.equal(h.state.repair.frame.candidate, null)
  })

  await t.test('non-target pixels changed', async () => {
    const quality = qualityReport('pass')
    quality.integrity.non_target_equal = false
    quality.integrity.actual_non_target_changed = 1
    const h = controllerHarness({ quality })
    await prepareRunnableController(h)
    assert.equal(await h.controller.generateOneCandidate(), null)
    assert.equal(h.state.repair.frame.uiState, 'blocked_quality')
    assert.equal(h.state.repair.frame.candidate, null)
  })
})

test('a job arriving after selection close is ignored without artifact hydration', async () => {
  const h = controllerHarness()
  await prepareRunnableController(h)
  const job = h.installBundle()

  h.controller.close('selection_switched')
  assert.equal(await h.controller.handleLifecycleUpdate({ type: 'job', job }), null)
  assert.equal(h.state.repair.frame.active, false)
  assert.equal(h.state.repair.frame.uiState, 'selection_switched')
  assert.equal(h.artifactCalls.some(([type]) => type === 'image' || type === 'json'), false)
})

test('entering the exact recovery scope performs one original-operation lookup and no POST', async () => {
  const recoveredJob = completedJob({
    status: 'generating', quality_status: 'unknown', provider_calls_used: 1, generated_candidate_count: 0,
  })
  const h = controllerHarness({
    recoveryHandle: {
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: JOB_ID, planHash: PLAN_HASH,
    },
    recoveredJob,
  })

  assert.equal(h.controller.enter(workbenchSnapshot()), true)
  assert.equal(await h.controller.recoverOriginalOperation(), recoveredJob.id)
  assert.equal(h.lifecycleCalls.filter(([type]) => type === 'recover').length, 1)
  assert.deepEqual(h.apiCalls, [])
  assert.equal(h.state.repair.frame.planHash, PLAN_HASH)
  assert.equal(h.state.repair.frame.operationId, OPERATION_ID)
  assert.equal(h.state.repair.frame.uiState, 'generating')
})

test('a recovery handle for another asset is ignored without lookup', async () => {
  const h = controllerHarness({
    recoveryHandle: {
      projectId: 'project_demo', assetId: 'asset_other', operationId: OPERATION_ID,
      jobId: JOB_ID, planHash: PLAN_HASH,
    },
    recoveredJob: completedJob({ status: 'generating' }),
  })
  h.controller.enter(workbenchSnapshot())

  assert.equal(await h.controller.recoverOriginalOperation(), null)
  assert.equal(h.lifecycleCalls.some(([type]) => type === 'recover'), false)
})

test('a completed recovered operation hydrates its sealed Plan and candidate without resubmission', async () => {
  const job = completedJob()
  const initialPlanBody = {
    instruction: 'repair the hand',
    maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
    providerPresetId: 'gemini-default',
    imageConfig: { image_size: '1K' },
  }
  const h = controllerHarness({
    job,
    recoveredJob: job,
    initialPlanBody,
    recoveryHandle: {
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: JOB_ID, planHash: PLAN_HASH,
    },
  })

  h.controller.enter(workbenchSnapshot())
  await h.controller.recoverOriginalOperation()

  assert.deepEqual(h.apiCalls, [])
  assert.equal(h.state.repair.frame.uiState, 'ready')
  assert.equal(h.state.repair.frame.candidate?.jobId, JOB_ID)
  assert.equal(h.state.repair.frame.plan?.plan_hash, PLAN_HASH)
  assert.equal(h.state.repair.frame.instruction, 'repair the hand')
  assert.equal(h.state.repair.frame.provisionalMask.activePixelCount, 64)
})

test('a recovered operation for another frame is blocked until explicitly discarded', async () => {
  const job = completedJob()
  const h = controllerHarness({
    recoveredJob: job,
    initialPlanBody: {
      instruction: 'repair the hand',
      maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
      providerPresetId: 'gemini-default',
      imageConfig: { image_size: '1K' },
    },
    recoveryHandle: {
      projectId: 'project_demo', assetId: 'asset_hero', operationId: OPERATION_ID,
      jobId: JOB_ID, planHash: PLAN_HASH,
    },
  })

  h.controller.enter(workbenchSnapshot({
    clipFramePosition: 0,
    sheetFrameIndex: 32,
    beforeRect: { sx: 0, sy: 384, sw: 96, sh: 96 },
  }))
  await h.controller.recoverOriginalOperation()

  assert.equal(h.state.repair.frame.uiState, 'blocked_quality')
  assert.equal(h.state.repair.frame.candidate, null)
  assert.equal(h.controller.viewModel().actions.includes('discard'), true)
  assert.equal(h.controller.discardCandidate(), true)
  assert.equal(h.lifecycleCalls.some(([type, reason]) => type === 'stop' && reason === 'discarded'), true)
})

test('warning acceptance requires exact job/hash confirmation and uses specialized Accept once', async () => {
  const h = controllerHarness({ qualityStatus: 'warning', quality: qualityReport('warning') })
  await prepareRunnableController(h)
  await h.controller.generateOneCandidate()
  assert.equal(h.state.repair.frame.uiState, 'warning')

  assert.equal(await h.controller.acceptCandidate(), null)
  assert.equal(h.apiCalls.filter(([type]) => type === 'accept').length, 0)
  h.controller.confirmWarning(true)
  await h.controller.acceptCandidate()

  const accepts = h.apiCalls.filter(([type]) => type === 'accept')
  assert.equal(accepts.length, 1)
  assert.deepEqual(accepts[0][1], {
    projectId: 'project_demo',
    assetId: 'asset_hero',
    jobId: JOB_ID,
    body: {
      expectedRevision: 4,
      expectedAssetRevisionId: 'rev_003',
      expectedPlanHash: PLAN_HASH,
      warningConfirmed: true,
    },
  })
  assert.equal(h.acceptedProjects.length, 1)
  assert.equal(h.state.repair.frame.uiState, 'accepted')
})

test('pointer, discard, and close restore the saved Workbench view and never delete evidence', async () => {
  const h = controllerHarness()
  h.controller.enter(workbenchSnapshot())
  h.state.repair.local.view = {
    ...h.state.repair.local.view,
    mode: 'difference',
    zoom: 4,
    pan: { x: 100, y: 100 },
  }
  h.controller.handlePointer('down', { point: { x: 4, y: 5 }, pointerId: 1 })
  h.controller.handlePointer('move', { point: { x: 8, y: 9 }, pointerId: 1 })
  h.controller.handlePointer('up', { point: { x: 8, y: 9 }, pointerId: 1 })
  assert.deepEqual(h.state.repair.frame.maskEdits.at(-1), {
    op: 'add_rectangle', x: 4, y: 5, width: 5, height: 5,
  })

  h.controller.discardCandidate()
  assert.equal(h.state.repair.frame.uiState, 'discarded')
  assert.equal(h.state.repair.frame.active, false)
  assert.deepEqual(h.state.repair.local.view, workbenchSnapshot().workbenchView.view)
  assert.equal(h.lifecycleCalls.some((entry) => entry[0] === 'stop' && entry[1] === 'discarded'), true)
  assert.equal(h.artifactCalls.some(([type]) => type === 'delete'), false)
})

test('Frame Repair controller and thin Workbench adapter stay browser-safe and avoid general import/provider calls', async () => {
  const controllerSource = await readFile('src/ui/editor/frameRepairController.js', 'utf8')
  const workbenchSource = await readFile('src/ui/editor/repairWorkbenchController.js', 'utf8')
  for (const source of [controllerSource, workbenchSource]) {
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/)
    assert.doesNotMatch(source, /importGeneratedJob|repairCharacterAction|\/api\/repair-character-action/)
  }
  assert.match(workbenchSource, /frameRepairController/)
  assert.match(workbenchSource, /decorateWorkbenchView/)
  assert.match(workbenchSource, /enterFrameRepair/)
  assert.match(controllerSource, /Generate one candidate|confirmLiveGeneration/)
})

test('quality-gate authoring exports only a case draft and blocks every live action', async () => {
  const h = controllerHarness()
  assert.equal(h.controller.enterQualityGateAuthoringCase(workbenchSnapshot()), true)
  assert.equal(h.controller.setInstruction('repair the hand'), true)
  assert.equal(h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 }), true)
  assert.deepEqual(h.controller.exportQualityGateCaseDraft({
    caseId: 'case_user_01', difficulty: 'medium', defectCategory: 'shape',
    expectedImprovement: 'The hand silhouette is coherent.',
  }), {
    caseId: 'case_user_01',
    assetId: 'asset_hero',
    expectedAssetRevisionId: 'rev_003',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 33,
    instruction: 'repair the hand',
    maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
    difficulty: 'medium',
    defectCategory: 'shape',
    expectedImprovement: 'The hand silhouette is coherent.',
  })
  assert.equal(await h.controller.reviewCall(), null)
  assert.equal(await h.controller.generateOneCandidate({ operationId: OPERATION_ID }), null)
  assert.equal(await h.controller.recoverOriginalOperation(), null)
  assert.equal(await h.controller.acceptCandidate(), null)
  assert.deepEqual(h.apiCalls, [])
})

test('locked quality-gate cases are immutable, accept only their planned operation, and defer adoption', async () => {
  const h = controllerHarness()
  const locked = {
    caseId: 'case_user_01',
    operationId: OPERATION_ID,
    assetId: 'asset_hero',
    expectedAssetRevisionId: 'rev_003',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 33,
    instruction: 'repair the hand',
    maskEdits: [{ op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8 }],
    providerPresetId: 'gemini-default',
    imageSize: '1K',
  }
  assert.equal(h.controller.enterLockedQualityGateCase(workbenchSnapshot(), locked), true)
  assert.equal(h.controller.setInstruction('mutate'), false)
  assert.equal(h.controller.setProviderPreset('another'), false)
  assert.equal(h.controller.setImageSize('2K'), false)
  assert.equal(h.controller.addRectangle({ x: 1, y: 1, width: 2, height: 2 }), false)
  assert.equal(h.controller.undoMaskEdit(), false)
  assert.equal(h.controller.handlePointer('down', { point: { x: 1, y: 1 } }), false)
  await h.controller.reviewCall()
  assert.equal(await h.controller.generateOneCandidate({ operationId: 'frqgop_' + 'c'.repeat(48) }), null)
  await h.controller.generateOneCandidate({ operationId: OPERATION_ID })
  assert.equal(h.apiCalls.find(([type]) => type === 'generate')[1].operationId, OPERATION_ID)
  assert.equal(await h.controller.acceptCandidate(), null)
  assert.deepEqual(h.acceptedProjects, [])
  const accepted = await h.controller.acceptCandidate({ deferProjectAdoption: true })
  assert.equal(accepted.project.revision, 5)
  assert.deepEqual(h.acceptedProjects, [])

  h.controller.close('project_switch')
  assert.equal(h.controller.enter(workbenchSnapshot()), true)
  h.controller.addRectangle({ x: 10, y: 10, width: 8, height: 8 })
  h.controller.setInstruction('repair the hand')
  await h.controller.reviewCall()
  await h.controller.generateOneCandidate({ operationId: 'frqgop_' + 'd'.repeat(48) })
  assert.equal(h.apiCalls.filter(([type]) => type === 'generate').at(-1)[1].operationId, undefined)
})

test('locked quality-gate entry rejects an identity mismatch atomically', () => {
  const h = controllerHarness()
  assert.equal(h.controller.enterLockedQualityGateCase(workbenchSnapshot(), {
    caseId: 'case_user_01', operationId: OPERATION_ID, assetId: 'asset_other',
    expectedAssetRevisionId: 'rev_003', clipId: 'walk_down', clipFramePosition: 1,
    sheetFrameIndex: 33, instruction: 'repair the hand', maskEdits: [],
    providerPresetId: 'gemini-default', imageSize: '1K',
  }), false)
  assert.equal(h.state.repair.frame.active, false)
})
