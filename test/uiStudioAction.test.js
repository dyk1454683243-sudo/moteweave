import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  assertMotionJobBinding,
  isMotionOperationCurrent,
  motionJobMatchesOperation,
} from '../src/ui/motionSource/binding.js'
import {
  createInitialActionState,
  deriveActionAdvancedEntry,
  deriveActionAppliedDownloadUrl,
  deriveActionBlockedRecovery,
  deriveActionFlow,
  shouldRetainActionModeError,
  deriveActionPresentation,
} from '../src/ui/studio/actionView.js'
import { STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'

const FIGMA_ACTION_CURRENT_NODE_IDS = Object.freeze([
  '829:4494', '829:4862', '829:5230', '235:2223', '310:8798',
  '829:5598', '830:4794', '829:5966', '829:6334', '321:4871',
])

const FIGMA_ACTION_INVENTORY_NODE_IDS = Object.freeze([
  '830:5162', '848:4571', '848:5036', '848:5501', '848:5966',
])

const ACTION_PHASES = Object.freeze([
  'empty', 'running', 'paused', 'preview', 'review', 'blocked',
  'applied', 'abandon', 'advanced', 'source_set',
])

const OPTION_FIELDS = Object.freeze([
  'action', 'targetFrameCount', 'selectionMode', 'selectionRecipe',
  'loopExpectation', 'temporalMatte', 'stride', 'fps', 'maxFrames',
  'startSec', 'endSec', 'backgroundMethod', 'keyColor',
  'backgroundTolerance', 'defringe', 'staticOffsetY', 'pixelGridRecipe',
  'resampleStrategy',
])

const ACTION_ARTIFACT_FIELDS = Object.freeze([
  'motion_source_analysis_url',
  'frame_preview_index_url',
  'frame_preview_sheet_url',
  'motion_source_report_url',
  'motion_contact_sheet_url',
  'normalized_motion_strip_url',
  'selected_frames_url',
  'video_frames_sheet_url',
  'frames_index_url',
  'frames_zip_url',
  'apply_motion_strip_report_url',
  'applied_normalized_sheet_url',
  'motion_source_set_report_url',
  'identity_consistency_report_url',
  'motion_source_set_apply_report_url',
])

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function actionHtml(html) {
  const start = html.indexOf('id="studio-action-view"')
  const end = html.indexOf('id="studio-sequence-view"', start)
  assert.ok(start >= 0 && end > start, 'Studio Action view is missing')
  return html.slice(start, end)
}

function quotedValues(tag) {
  return [...tag.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])
}

test('Studio Action is an internal Figma-backed route and preserves the existing Motion workspace', async () => {
  const [html, app, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const action = actionHtml(html)

  assert.match(openingTagForId(html, 'studio-action-view'), /data-studio-view="action"[^>]*hidden/)
  assert.match(html, /href="#action" data-studio-route="action"/)
  assert.doesNotMatch(action, /href="\/legacy\?tab=motion-source"|action\.oldWorkspace|action-legacy-link/)
  assert.match(app, /import \{ initStudioAction, renderStudioActionLanguage \} from '\.\/actionView\.js'/)
  assert.match(app, /const STUDIO_ROUTES = Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /action: 'MoteWeave · 动作取帧'/)
  assert.match(app, /action: 'MoteWeave · Frame Extraction'/)
  assert.match(html, /action: 'MoteWeave · 动作取帧（文件预览）'/)
  assert.match(app, /else if \(activeRoute === 'action'\) renderStudioActionLanguage\(\)/)
  assert.match(app, /actionInitializationPromise = Promise\.resolve\(initStudioAction\(\{ serviceAvailable \}\)\)/)
  assert.match(css, /\.action-workspace\s*\{/)

  const designSource = openingTagForId(html, 'studio-action-view')
  const currentSource = designSource.match(/data-design-source="([^"]+)"/)?.[1] ?? ''
  const inventorySource = designSource.match(/data-design-inventory="([^"]+)"/)?.[1] ?? ''
  const archiveSource = designSource.match(/data-design-archive-inventory="([^"]+)"/)?.[1] ?? ''
  for (const nodeId of FIGMA_ACTION_CURRENT_NODE_IDS) {
    assert.match(currentSource, new RegExp(nodeId.replace(':', '\\:')))
    assert.doesNotMatch(inventorySource, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const nodeId of FIGMA_ACTION_INVENTORY_NODE_IDS) {
    assert.match(inventorySource, new RegExp(nodeId.replace(':', '\\:')))
    assert.doesNotMatch(currentSource, new RegExp(nodeId.replace(':', '\\:')))
  }
  assert.match(archiveSource, /53\:96/)
  assert.doesNotMatch(currentSource, /53\:96/)
  for (const phase of ACTION_PHASES) {
    assert.match(action, new RegExp(`data-action-panel="[^"]*\\b${phase}\\b`))
  }
})

test('Studio Action keeps the primary operation in a fixed footer and removes non-user empty-state detail', async () => {
  const [html, css, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/actionView.js', 'utf8'),
    readFile('src/ui/motionSource/api.js', 'utf8'),
  ])
  const action = actionHtml(html)
  const scrollStart = action.indexOf('class="action-control-scroll"')
  const footerStart = action.indexOf('class="action-control-footer"')
  const analyzeStart = action.indexOf('id="studio-action-analyze"')
  const optionStart = action.indexOf('id="studio-action-option-target-frame-count"')
  const advancedStart = action.indexOf('id="studio-action-advanced-toggle"')
  const advancedPanelStart = action.indexOf('id="studio-action-advanced-panel"')

  assert.ok(scrollStart >= 0 && footerStart > scrollStart, 'Action control scroll body must precede its footer')
  assert.ok(optionStart > scrollStart && optionStart < footerStart, 'maintained options must remain in the scroll body')
  assert.ok(advancedStart > optionStart && advancedStart < advancedPanelStart, 'Advanced must follow basic options in the left flow')
  assert.ok(analyzeStart > footerStart, 'Analyze must remain in the independent footer')
  assert.match(openingTagForId(action, 'studio-action-advanced-toggle'), /aria-controls="studio-action-advanced-panel"/)
  assert.match(openingTagForId(action, 'studio-action-advanced-toggle'), /aria-expanded="false"/)
  assert.match(openingTagForId(action, 'studio-action-advanced-title'), /tabindex="-1"/)
  assert.match(openingTagForId(action, 'studio-action-selected-source'), /\bhidden\b/)
  assert.match(openingTagForId(action, 'studio-action-selected-source'), /aria-live="polite"/)

  for (const retired of [
    'studio-action-source-meta', 'studio-action-source-name', 'studio-action-source-size',
    'studio-action-source-kind', 'studio-action-source-identity', 'studio-action-upload-id',
  ]) assert.equal(openingTagForId(action, retired), '', `retired source detail #${retired} must stay absent`)
  assert.doesNotMatch(action, /action-empty-glyph/)
  assert.doesNotMatch(css, /\.action-empty-glyph/)
  assert.match(css, /\.action-control-scroll\s*\{[^}]*overflow:\s*auto/)
  assert.match(css, /\.action-control-footer\s*\{/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.action-workspace\s*\{[^}]*display:\s*block[\s\S]*\.action-control-scroll\s*\{[^}]*overflow:\s*visible[\s\S]*\.action-control-footer\s*\{[^}]*position:\s*static/)
  assert.doesNotMatch(view, /function renderSourceMeta\(/)
  assert.match(view, /function renderSelectedSource\(state\)[\s\S]*state\.sourceFile\?\.name[\s\S]*selected\.textContent = name[\s\S]*action\.source\.selected/)
  const selectedSourceRenderer = view.match(/function renderSelectedSource\(state\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(selectedSourceRenderer, /sourceDescriptor|source_identity|upload_id|operation_id|\.size|\.type|innerHTML/)
  assert.match(view, /aria-expanded/)
  assert.match(view, /studio-action-advanced-title[\s\S]*focus/)
  assert.match(view, /studio-action-advanced-toggle[\s\S]*focus/)

  assert.match(api, /function sourceOperationBody\(source, operationId, options\)[\s\S]*source_upload_id:\s*source\.upload_id[\s\S]*source_identity:\s*source\.source_identity[\s\S]*operation_id:\s*operationId/)
  assert.match(api, /\.\.\.\(options \? \{ options \} : \{\}\)/)
  assert.match(view, /function serializedOptions\(state = actionState\)[\s\S]*serializeMotionOptions\(state\.optionsModel/)
  assert.match(view, /function invalidateOptionDependentState\(field\)/)
  assert.match(view, /function resetForSourceFile\(file\)[\s\S]*observationController\?\.abort\(\)[\s\S]*renderToken \+= 1[\s\S]*sourceEpoch \+= 1[\s\S]*clearDerivedState\(state, \{ keepSource: false \}\)[\s\S]*releasePriorUpload\(priorDescriptor, priorOperationId\)/)
})

test('Studio Action Advanced entry follows source, operation, and flow truth', () => {
  const initial = createInitialActionState()
  assert.deepEqual(deriveActionAdvancedEntry(initial), {
    open: false, hidden: false, disabled: true, labelKey: 'action.advancedToggle',
  })
  assert.equal(deriveActionAdvancedEntry({ ...initial, sourceFile: { name: 'walk.gif' } }).disabled, false)
  assert.equal(deriveActionAdvancedEntry({
    ...initial,
    sourceFile: { name: 'walk.gif' },
    uiOperation: { storeKey: 'analysis' },
    phase: 'running',
  }).disabled, true)
  assert.equal(deriveActionAdvancedEntry({
    ...initial,
    sourceFile: { name: 'walk.gif' },
    phase: 'abandon',
  }).disabled, true)
  assert.equal(deriveActionAdvancedEntry({
    ...initial,
    sourceFile: { name: 'walk.gif' },
    phase: 'paused',
  }).disabled, true)
  assert.deepEqual(deriveActionAdvancedEntry({
    ...initial,
    sourceFile: { name: 'walk.gif' },
    phase: 'advanced',
  }), {
    open: true, hidden: false, disabled: false, labelKey: 'action.advancedClose',
  })
  assert.equal(deriveActionAdvancedEntry({
    ...initial,
    sourceFile: { name: 'walk.gif' },
    currentFlow: 'sourceSet',
    phase: 'source_set',
  }).hidden, true)
  for (const phase of ['review', 'blocked', 'applied']) {
    assert.equal(deriveActionAdvancedEntry({
      ...initial,
      sourceFile: { name: 'walk.gif' },
      phase,
    }).disabled, false, `${phase} should permit a new Advanced configuration view`)
  }
  assert.equal(shouldRetainActionModeError({ fromPhase: 'blocked', toPhase: 'advanced' }), true)
  assert.equal(shouldRetainActionModeError({ fromPhase: 'advanced', toPhase: 'blocked' }), true)
  assert.equal(shouldRetainActionModeError({ fromPhase: 'review', toPhase: 'advanced' }), false)
})

test('Studio Action renders only Figma states and all 18 maintained Motion options', async () => {
  const [html, view, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/actionView.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const action = actionHtml(html)
  const fields = [...action.matchAll(/data-action-option="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual([...new Set(fields)].sort(), [...OPTION_FIELDS].sort())
  assert.match(view, /const OPTION_FIELDS = Object\.freeze\(\{[\s\S]*resampleStrategy: 'string'/)

  for (const field of OPTION_FIELDS) {
    const tag = action.match(new RegExp(`<[^>]+data-action-option="${field}"[^>]*>`))?.[0] ?? ''
    assert.notEqual(tag, '', `missing Motion option ${field}`)
    assert.match(tag, /data-studio-server-required/)
  }
  assert.match(openingTagForId(action, 'studio-action-option-action'), /type="text"[^>]*value="walk_down"/)
  assert.match(openingTagForId(action, 'studio-action-option-action'), /data-action-option="action"/)
  assert.match(openingTagForId(html, 'studio-action-option-target-frame-count'), /value="4"/)
  assert.match(html, /class="action-context-toolbar" hidden/)
  assert.match(css, /\.action-context-toolbar \{[^}]*display: none !important/)
  assert.match(css, /\.action-workspace \{[^}]*grid-template-rows: minmax\(0, 1fr\)/)
  assert.match(view, /field === 'action'/)
  assert.match(view, /action\.error\.actionName/)
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-selection-recipe"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['motion_selection_recipe_v2', 'motion_selection_v1_compat'],
  )
  assert.match(action, /class="action-field action-operator-field" hidden[\s\S]*id="studio-action-option-selection-recipe"/)
  assert.match(css, /\.action-operator-field \{[^}]*display: none !important/)
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-loop-expectation"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['auto', 'loop', 'once'],
  )
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-temporal-matte"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['disabled', 'evidence_only'],
  )
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-background-method"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['key_color', 'external_rembg'],
  )
  assert.match(openingTagForId(action, 'studio-action-option-key-color'), /value="255,255,255"/)
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-pixel-grid-recipe"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['disabled', 'pixel_grid_v2_balanced', 'pixel_grid_v2_detail_safe', 'pixel_grid_v2_oklab'],
  )
  assert.deepEqual(
    quotedValues(action.match(/<select id="studio-action-option-resample-strategy"[\s\S]*?<\/select>/)?.[0] ?? ''),
    ['reject_mismatch', 'nearest_keyframes'],
  )
})

test('Studio Action keeps generated media empty and every real entry point server-gated', async () => {
  const [html, view, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/actionView.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const action = actionHtml(html)
  for (const id of [
    'studio-action-preview-image', 'studio-action-strip-image',
    'studio-action-contact-image', 'studio-action-applied-image',
  ]) {
    const tag = openingTagForId(action, id)
    assert.match(tag, /\bhidden\b/)
    assert.doesNotMatch(tag, /\bsrc\s*=/)
  }
  const recovery = openingTagForId(action, 'studio-action-recover')
  assert.match(recovery, /\bhidden\b/)
  assert.match(recovery, /\bdisabled\b/)
  const appliedDownload = openingTagForId(action, 'studio-action-download-applied')
  assert.match(appliedDownload, /\bhidden\b/)
  assert.match(appliedDownload, /\bdownload\b/)
  assert.match(appliedDownload, /aria-disabled="true"/)
  assert.doesNotMatch(appliedDownload, /\bhref\s*=/)
  for (const id of [
    'studio-action-file', 'studio-action-analyze', 'studio-action-preview',
    'studio-action-build', 'studio-action-apply', 'studio-action-cancel',
    'studio-action-resume', 'studio-action-sheet-file', 'studio-action-strip-file',
    'studio-action-manifest-file', 'studio-action-strip-files',
    'studio-action-source-set-analyze', 'studio-action-source-set-apply',
  ]) {
    assert.match(openingTagForId(action, id), /data-studio-server-required/)
  }
  assert.doesNotMatch(action, /AI 生成 · 后续提供|action-coming-later|action-future-button|action\.playtestDisabled/)
  assert.match(openingTagForId(action, 'studio-action-quality-status'), /action\.contextQualityWaiting/)
  assert.match(openingTagForId(action, 'studio-action-quality-status'), /data-state="waiting"/)
  assert.match(view, /quality\.dataset\.state = qualityState/)
  assert.match(view, /function evidenceForFlow\(state, flow\)/)
  assert.match(view, /evidenceForFlow\(state, 'guided'\)\?\.status \?\? 'waiting'/)
  assert.match(view, /setFlowEvidence\(state, 'guided', outcome\)/)
  assert.match(view, /setFlowEvidence\(state, 'sourceSet', outcome\)/)
  assert.match(view, /const visibleEvidence = evidenceForFlow\(state, sourceSetFlow \? 'sourceSet' : 'guided'\)/)
  assert.match(view, /localizedActionStatus\(job\.status\)/)
  assert.match(view, /progress\.dataset\.state = state\.activeOperation \? 'indeterminate' : 'idle'/)
  assert.doesNotMatch(css, /\.action-progress i\s*\{[^}]*width:\s*32%/)
  assert.doesNotMatch(action, /value="none"/)
  assert.doesNotMatch(action, /(?:openrouter|provider|mock(?:ed|ing)?|synthetic|\/api\/generate-character)/i)
})

test('Studio Action binds exactly 15 maintained artifacts and verifies current ownership before render', async () => {
  const view = await readFile('src/ui/studio/actionView.js', 'utf8')
  const fields = [...view.matchAll(/\['([a-z_]+_url)', 'action\.artifact\.[^']+'\]/g)]
    .map((match) => match[1])
  assert.deepEqual(fields, ACTION_ARTIFACT_FIELDS)
  assert.doesNotMatch(view, /(?:frame_sheet_url|frame_zip_url|video_frame_sheet_url|motion_set_report_url)/)
  assert.match(view, /assertStudioActionArtifactUrl\(url\)/)
  assert.match(view, /if \(image\.getAttribute\('src'\) !== exactUrl\) image\.src = exactUrl/)
  assert.match(view, /function renderAppliedDownload\(state, flow\)[\s\S]*link\.removeAttribute\('href'\)[\s\S]*deriveActionAppliedDownloadUrl\(state, flow\)[\s\S]*link\.setAttribute\('href', url\)/)
  assert.match(view, /assertMotionJobBinding\(handle, job\)/)
  assert.match(view, /assertMotionJobCompletionArtifacts\(job, handle\.storeKey\)/)
  assert.match(view, /assertBoundMotionArtifact\(handle, artifact\)/)
  assert.match(view, /if \(!isMotionOperationCurrent\(handle, operationContext\(actionState\)\)\) return/)
  assert.match(view, /function lastJobForFlow\(state, flow\)[\s\S]*state\.lastJobByFlow\?\.\[exactFlow\]/)
  assert.match(view, /rememberLastJob\(actionState, finalJob, flowForStoreKey\(currentHandle\.storeKey\)\)/)
  assert.match(view, /setHidden\(byId\('studio-action-artifact-empty'\), !empty\)/)
})

test('Motion binding refuses stale owners and Action pause/resume/expired states stay fail-closed', async () => {
  const identity = `sha256:${'a'.repeat(64)}`
  const operation = Object.freeze({
    bound: true,
    renderToken: 3,
    epoch: 4,
    sourceIdentity: identity,
    operationId: 'motion_build_op_1',
    optionsHash: identity,
    jobId: 'job_1',
  })
  const current = {
    uiOperation: operation,
    renderToken: 3,
    sourceEpoch: 4,
    sourceFile: { name: 'walk.gif' },
    sourceDescriptor: { source_identity: identity },
  }
  const job = {
    id: 'job_1', operation_id: 'motion_build_op_1',
    source_identity: identity, options_hash: identity,
  }
  assert.equal(isMotionOperationCurrent(operation, current), true)
  assert.equal(motionJobMatchesOperation(operation, current, job), true)
  assert.equal(isMotionOperationCurrent(operation, { ...current, renderToken: 5 }), false)
  assert.equal(motionJobMatchesOperation(operation, current, { ...job, id: 'job_other' }), false)
  assert.throws(() => assertMotionJobBinding(operation, { ...job, source_identity: `sha256:${'b'.repeat(64)}` }), {
    code: 'motion_source_binding_mismatch',
  })

  const view = await readFile('src/ui/studio/actionView.js', 'utf8')
  assert.match(view, /function pauseOperation\(handle, error\)[\s\S]*state\.resumableOperation = paused[\s\S]*state\.phase = 'paused'/)
  assert.match(view, /function ownsOperation\(state, handle\)[\s\S]*state\.uiOperation === handle/)
  for (const name of ['finishOperation', 'pauseOperation', 'failOperation']) {
    assert.match(
      view,
      new RegExp(`function ${name}\\(handle(?:, error)?\\) \\{[\\s\\S]*if \\(!ownsOperation\\(state, handle\\)\\) return false`),
    )
  }
  assert.match(view, /async function resumeExistingOperation\(\)[\s\S]*state\.phase = 'running'[\s\S]*refreshFirst = true/)
  assert.match(view, /function failOperation\(handle, error\)[\s\S]*state\.phase = 'blocked'[\s\S]*state\.blockedOperationKey = handle\?\.storeKey \?\? null/)
  const recoveryHandler = view.match(/function recoverBlockedOperation\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(recoveryHandler, /deriveActionBlockedRecovery\(state, actionControls\(state\)\.controls\)/)
  assert.match(recoveryHandler, /analysis: startAnalysis[\s\S]*setApply: startSourceSetApply/)
  assert.doesNotMatch(recoveryHandler, /resumeExistingOperation|fetch\s*\(|waitForMotionSourceJob/)
  assert.match(view, /function beginOperation\([\s\S]*operationId: bound \? createMotionOperationId\(`motion_\$\{storeKey\}_op`\) : null/)
  assert.match(view, /bindActionControl\('studio-action-recover', recoverBlockedOperation\)/)
  assert.match(view, /if \(current\.status === 'cancelling' && isAbortError\(error\)\) return/)
  assert.match(view, /motion_job_receipt_missing/)
  assert.match(view, /motion_server_session_expired/)
  assert.match(view, /if \(error\?\.status === 404 \|\| error\?\.code === 'motion_job_not_found'\)/)
  assert.doesNotMatch(view, /(?:retry|fallback).*fetch\s*\(/i)
})

test('Studio Action derives explicit blocked recovery as a new operation without borrowing paused Resume', () => {
  const initial = createInitialActionState()
  const blocked = { ...initial, phase: 'blocked' }

  assert.deepEqual(
    deriveActionBlockedRecovery(
      { ...blocked, blockedOperationKey: 'analysis' },
      { analyze: true },
    ),
    { action: 'analysis', labelKey: 'action.recovery.analysis' },
  )
  assert.deepEqual(
    deriveActionBlockedRecovery(
      {
        ...blocked,
        blockedOperationKey: 'preview',
        reports: { analysis: { status: 'pass' } },
      },
      { previewFrames: true },
    ),
    { action: 'preview', labelKey: 'action.recovery.preview' },
  )
  assert.deepEqual(
    deriveActionBlockedRecovery(
      { ...blocked, blockedOperationKey: 'apply' },
      { applyStrip: false, guidedBuild: true },
    ),
    { action: 'build', labelKey: 'action.recovery.build' },
  )
  assert.deepEqual(
    deriveActionBlockedRecovery(
      {
        ...blocked,
        currentFlow: 'sourceSet',
        blockedOperationKey: 'setApply',
        reports: { set: { can_apply_multi_strip: true } },
      },
      { applySet: true },
    ),
    { action: 'setApply', labelKey: 'action.recovery.sourceSetApply' },
  )
  assert.deepEqual(
    deriveActionBlockedRecovery(
      { ...blocked, blockedOperationKey: 'build' },
      { guidedBuild: false },
    ),
    { action: 'adjust', labelKey: 'action.recovery.adjust' },
  )
  assert.equal(deriveActionBlockedRecovery({ ...initial, phase: 'paused' }, {}), null)
  assert.equal(deriveActionBlockedRecovery({
    ...blocked,
    blockedOperationKey: 'build',
    resumableOperation: { storeKey: 'build' },
  }, { guidedBuild: true }), null)
})

test('Studio Action exposes the main Applied download only from current done non-blocked Apply authority', () => {
  const initial = createInitialActionState()
  const appliedUrl = '/generated/job_action/applied.png'
  const guided = {
    ...initial,
    phase: 'applied',
    jobs: { apply: { status: 'done', applied_normalized_sheet_url: appliedUrl } },
    reports: { apply: { status: 'pass' } },
  }
  assert.equal(deriveActionAppliedDownloadUrl(guided), appliedUrl)
  assert.equal(deriveActionAppliedDownloadUrl({ ...guided, phase: 'blocked' }), null)
  assert.equal(deriveActionAppliedDownloadUrl({ ...guided, reports: {} }), null)
  assert.equal(deriveActionAppliedDownloadUrl({
    ...guided,
    reports: { apply: { status: 'blocked' } },
  }), null)
  assert.equal(deriveActionAppliedDownloadUrl({
    ...guided,
    uiOperation: { storeKey: 'apply' },
  }), null)

  const sourceSetUrl = '/generated/job_set/applied.png'
  assert.equal(deriveActionAppliedDownloadUrl({
    ...initial,
    phase: 'applied',
    currentFlow: 'sourceSet',
    jobs: { setApply: { status: 'done', applied_normalized_sheet_url: sourceSetUrl } },
    reports: { setApply: { status: 'warning' } },
  }), sourceSetUrl)
  assert.throws(() => deriveActionAppliedDownloadUrl({
    ...guided,
    jobs: { apply: { status: 'done', applied_normalized_sheet_url: 'https://invalid.example/out.png' } },
  }), { code: 'motion_artifact_url_invalid' })
})

test('Studio Action supports Source Set and Abandon without pretending to apply output', async () => {
  const [html, view, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/actionView.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const action = actionHtml(html)
  for (const id of [
    'studio-action-source-set-toggle', 'studio-action-manifest-file',
    'studio-action-strip-files', 'studio-action-source-set-analyze',
    'studio-action-source-set-apply', 'studio-action-abandon-cancel',
    'studio-action-abandon-confirm',
  ]) assert.notEqual(openingTagForId(action, id), '', `missing Action control #${id}`)
  assert.match(openingTagForId(action, 'studio-action-source-set-toggle'), /\bhidden\b/)
  assert.match(action, /id="studio-action-source-set-panel"/)
  assert.match(css, /#studio-action-source-set-toggle,\s*#studio-action-source-set-panel,\s*\.action-source-set-stage \{[^}]*display: none !important/)
  assert.match(view, /analyzeMotionSourceSet\(payload, \{ signal \}\)/)
  assert.match(view, /applyMotionSourceSet\(payload, \{ signal \}\)/)
  assert.match(view, /reports\.set\?\.can_apply_multi_strip === true/)
  assert.ok(
    view.indexOf("if (handle.storeKey === 'set' && job.identity_consistency_report_url)") <
      view.indexOf('if (JOB_FAILURE_STATUSES.has(job.status)'),
    'Source Set identity reports must be committed before generic failed-job handling',
  )
  assert.match(view, /setFlowEvidence\(state, 'sourceSet', mapMotionReportOutcome\(\{ job, report \}\)\)[\s\S]*state\.phase = 'source_set'/)
  assert.match(view, /view\.dataset\.actionSourceSetStatus = state\.reports\.set/)
  assert.match(view, /sourceSetRunning = sourceSetFlow/)
  assert.match(view, /\['running', 'paused', 'blocked', 'applied'\]\.includes\(presentation\.phase\)/)
  assert.match(action, /data-action-source="job"[\s\S]*id="studio-action-cancel"[\s\S]*id="studio-action-resume"/)
  assert.doesNotMatch(
    action.match(/data-action-source="guided"[\s\S]*?<\/div>/)?.[0] ?? '',
    /studio-action-(?:cancel|resume)/,
  )
  for (const id of [
    'studio-action-sheet-file-name', 'studio-action-strip-file-name',
    'studio-action-manifest-file-name', 'studio-action-strip-files-name',
    'studio-action-source-set-outcome',
  ]) assert.notEqual(openingTagForId(action, id), '', `missing Action state binding #${id}`)
  assert.match(view, /state\.stripFile = null[\s\S]*stripInput\.value = ''/)
  assert.match(view, /function restoreAutomaticSelection\(\)[\s\S]*invalidateOperationAuthority\(actionState, 'build'\)[\s\S]*actionState\.phase = 'preview'/)
  assert.match(view, /function updateFrameSelection\(target\)[\s\S]*invalidateOperationAuthority\(actionState, 'build'\)[\s\S]*actionState\.phase = 'preview'/)
  assert.match(view, /function invalidateOptionDependentState\(field\)[\s\S]*!currentBuildBinding\(state, options\)[\s\S]*invalidateOperationAuthority\(state, 'build'\)/)
  assert.match(view, /function invalidateOptionDependentState\(field\)[\s\S]*priorApplyAuthority[\s\S]*scope: 'both'[\s\S]*authorityWasPresent: priorApplyAuthority/)
  assert.match(view, /state\.phase === 'advanced'[\s\S]*\['review', 'blocked', 'applied'\]\.includes\(state\.priorPhase\)[\s\S]*state\.priorPhase = guidedFallbackPhase\(state\)/)
  assert.match(view, /function remainingEvidenceAfterApplyInvalidation\(state,[\s\S]*mapMotionReportOutcome\(\{ job: state\.jobs\.set, report: state\.reports\.set \}\)[\s\S]*mapMotionEvidence\(\{/)
  assert.match(view, /function guidedFallbackPhase\(state\)[\s\S]*state\.jobs\.build[\s\S]*state\.previewCandidates\.length \? 'preview' : 'empty'/)
  assert.doesNotMatch(view, /function sourceSetApplyIsCurrent\(/)
  assert.match(view, /function invalidateApplyResult\([\s\S]*scope === 'both'[\s\S]*affected\.has\('guided'\)[\s\S]*affected\.has\('sourceSet'\)[\s\S]*state\.currentFlow/)
  assert.match(view, /state\.priorFlow === currentFlow[\s\S]*state\.priorPhase = fallbackPhase/)
  assert.match(view, /const modeSwitchLocked = Boolean\(state\.uiOperation\) \|\| state\.phase === 'abandon'[\s\S]*button\.disabled = modeSwitchLocked/)
  assert.match(view, /studio-action-sheet-file'[\s\S]*invalidateApplyResult\(\{ scope: 'both' \}\)/)
  assert.match(view, /studio-action-strip-file'[\s\S]*invalidateApplyResult\(\{ scope: 'guided' \}\)/)
  assert.match(view, /studio-action-manifest-file'[\s\S]*invalidateApplyResult\(\{ scope: 'sourceSet' \}\)[\s\S]*invalidateOperationAuthority\(actionState, 'set'\)/)
  assert.match(view, /studio-action-strip-files'[\s\S]*invalidateApplyResult\(\{ scope: 'sourceSet' \}\)[\s\S]*invalidateOperationAuthority\(actionState, 'set'\)/)
  assert.match(view, /function artifactsForFlow\(state, flow\)[\s\S]*SOURCE_SET_ACTION_ARTIFACT_FIELDS[\s\S]*GUIDED_ACTION_ARTIFACT_FIELDS[\s\S]*delete artifacts\.apply_motion_strip_report_url[\s\S]*delete artifacts\.motion_source_set_apply_report_url[\s\S]*delete artifacts\.applied_normalized_sheet_url[\s\S]*state\.reports\.setApply : state\.reports\.apply[\s\S]*report \? \(flow === 'sourceSet' \? state\.jobs\.setApply : state\.jobs\.apply\) : null/)
  assert.match(view, /const job = await cancelMotionSourceJob\(handle\.jobId\)[\s\S]*rememberLastJob\(state, job, flowForStoreKey\(handle\.storeKey\)\)/)
  assert.match(view, /async function cancelCurrentOperation\(\)[\s\S]*handle\?\.bound !== true[\s\S]*cancelMotionSourceJob\(handle\.jobId\)/)
  assert.match(view, /function requestAbandonToCharacter\(event\)[\s\S]*event\?\.preventDefault\(\)[\s\S]*actionState\.phase = 'abandon'/)
  assert.match(
    view,
    /function requestAbandonToCharacter\(event\)[\s\S]*if \(actionState\.uiOperation \|\| actionState\.resumableOperation\) return[\s\S]*event\?\.preventDefault\(\)/,
  )
  assert.match(view, /function confirmAbandon\(\)[\s\S]*releasePriorUpload\(descriptor, operationId\)[\s\S]*'studio-action-file'[\s\S]*'studio-action-strip-files'[\s\S]*input\.value = ''[\s\S]*globalThis\.location\.hash = '#character'/)
  assert.match(view, /if \(state\?\.phase === 'applied'\) return false/)
})

test('Studio Action has complete bilingual markers and an explicit default presentation', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const action = actionHtml(html)
  const keys = new Set(
    [...action.matchAll(/data-studio-i18n(?:-[a-z-]+)?="(action\.[^"]+)"/g)]
      .map((match) => match[1]),
  )
  for (const language of ['zh', 'en']) {
    for (const key of keys) {
      assert.ok(Object.hasOwn(STUDIO_TRANSLATIONS[language], key), `missing ${language} Action translation for ${key}`)
    }
    for (const key of [
      'action.recovery.analysis',
      'action.recovery.preview',
      'action.recovery.build',
      'action.recovery.apply',
      'action.recovery.sourceSetAnalyze',
      'action.recovery.sourceSetApply',
      'action.recovery.adjust',
    ]) {
      assert.ok(Object.hasOwn(STUDIO_TRANSLATIONS[language], key), `missing ${language} Action recovery translation ${key}`)
    }
  }
  assert.deepEqual({
    header: STUDIO_TRANSLATIONS.zh['action.headerTitle'],
    source: STUDIO_TRANSLATIONS.zh['action.sourceTitle'],
    analyze: STUDIO_TRANSLATIONS.zh['action.analyze'],
  }, {
    header: '动作取帧',
    source: '动作素材',
    analyze: '分析素材',
  })
  assert.deepEqual({
    header: STUDIO_TRANSLATIONS.en['action.headerTitle'],
    source: STUDIO_TRANSLATIONS.en['action.sourceTitle'],
    analyze: STUDIO_TRANSLATIONS.en['action.analyze'],
  }, {
    header: 'Frame Extraction',
    source: 'Source media',
    analyze: 'Analyze source media',
  })
  assert.match(action, /data-studio-i18n="action\.headerTitle">动作取帧</)
  assert.match(action, /data-studio-i18n="action\.sourceTitle">动作素材</)
  assert.match(action, /data-studio-i18n="action\.analyze">分析素材</)
  const initial = createInitialActionState()
  assert.equal(initial.phase, 'empty')
  assert.equal(initial.serviceAvailable, true)
  assert.equal(initial.currentFlow, 'guided')
  assert.deepEqual(initial.lastJobByFlow, { guided: null, sourceSet: null })
  assert.equal(deriveActionFlow(initial), 'guided')
  assert.equal(deriveActionFlow({ ...initial, currentFlow: 'sourceSet', phase: 'blocked' }), 'sourceSet')
  assert.equal(deriveActionFlow({
    ...initial,
    activeOperation: { storeKey: 'set' },
  }), 'sourceSet')
  assert.equal(deriveActionFlow({
    ...initial,
    currentFlow: 'sourceSet',
    activeOperation: { storeKey: 'build' },
  }), 'guided')
  assert.deepEqual(deriveActionPresentation(initial), {
    phase: 'empty',
    status: 'idle',
    titleKey: 'action.phase.emptyTitle',
    summaryKey: 'action.phase.emptySummary',
  })
  assert.equal(deriveActionPresentation({ ...initial, phase: 'not-a-state' }).phase, 'empty')
  for (const key of [
    'action.status.idle', 'action.status.previewReady', 'action.status.review',
    'action.status.advanced', 'action.status.abandonConfirmation',
    'action.status.sourceSet', 'action.status.applied',
  ]) {
    assert.ok(STUDIO_TRANSLATIONS.en[key], `missing en Action status translation ${key}`)
    assert.ok(STUDIO_TRANSLATIONS.zh[key], `missing zh Action status translation ${key}`)
  }
  const view = await readFile('src/ui/studio/actionView.js', 'utf8')
  assert.match(view, /'studio-action-status',[\s\S]*translatedActionStatus\(presentation\.status\)/)
})

test('Action Current clips the left flow explainer and keeps phase copy inventory', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const action = actionHtml(html)
  assert.match(action, /class="action-flow-header"/)
  assert.match(action, /id="studio-action-phase-title"/)
  assert.match(action, /id="studio-action-phase-summary"/)
  assert.match(action, /aria-labelledby="studio-action-phase-title"/)
  assert.match(css, /\.action-flow-header \{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
})
