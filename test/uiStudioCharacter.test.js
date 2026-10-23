import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  characterHeaderCrumbKey,
  characterJobStripPresentation,
  characterPipelineStepState,
  collectCharacterAiReviewInput,
  CHARACTER_AI_COMPATIBLE_PRESET_IDS,
  createInitialCharacterState,
  deriveCharacterPresentation,
  acceptedHydrationKind,
} from '../src/ui/studio/characterView.js'
import {
  createInitialLocalCharacterState,
  createLocalCharacterFailureState,
  deriveLocalCharacterActivityPresentation,
  deriveLocalCharacterBlockingPresentation,
  deriveLocalCharacterPresentation,
  deriveLocalCharacterVisibleError,
  LOCAL_ADVANCED_CONFIG_CONTROL_SELECTOR,
} from '../src/ui/studio/characterLocalView.js'
import {
  ADVANCED_CONFIG_CONTROL_SELECTOR,
  queryAdvancedConfigControls,
} from '../src/ui/studio/characterResultView.js'
import { setStudioProviderSnapshotForTest, STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'
import { sha256Bytes, STRICT_FIXED_REGION_PROFILE } from '../src/ui/studio/characterApi.js'

const EVIDENCE_BINDINGS = Object.freeze([
  ['character-raw-image', 'raw_provider_output_url'],
  ['character-background-image', 'background_removed_provider_output_url'],
  ['character-normalized-image', 'normalized_sheet_url'],
  ['character-preview-image', 'background_preview_url'],
  ['character-spill-image', 'background_spill_overlay_url'],
  ['character-sure-background-image', 'background_sure_background_mask_url'],
  ['character-unknown-image', 'background_unknown_band_mask_url'],
  ['character-sure-foreground-image', 'background_sure_foreground_mask_url'],
  ['character-alpha-image', 'background_alpha_estimate_url'],
  ['character-reconstruction-image', 'background_foreground_reconstruction_url'],
])

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function openingTagForClassToken(html, classToken) {
  return html.match(new RegExp(`<(?:details|section)\\b[^>]*\\bclass="[^"]*\\b${classToken}\\b[^"]*"[^>]*>`))?.[0] ?? ''
}

function attributeTokens(tag) {
  return String(tag).replace(/"[^"]*"/g, '""')
}

function cssDeclares(css, prelude, declaration) {
  return new RegExp(`${prelude}[^{]*\\{[^}]*${declaration}`, 'i').test(css)
}

function resolveCharacterPhasePanelDisplay(tag, css, { mode, phase }) {
  const classes = tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/).filter(Boolean) ?? []
  const kind = classes.find((name) => /^character-(running|accepted|topdown)-panel$/.test(name))
  assert.ok(kind, `missing phase panel class: ${tag}`)
  const panelPhase = kind.replace('character-', '').replace('-panel', '')
  const hasHidden = /\bhidden\b/.test(attributeTokens(tag))
  const hiddenRule = cssDeclares(css, '\\[hidden\\]', 'display:\\s*none\\s*!important')
  const localAiOnly = cssDeclares(
    css,
    '\\.character-main\\[data-character-mode=["\']local["\']\\]\\s+\\.character-ai-only',
    'display:\\s*none\\s*!important',
  )
  const defaultNone = cssDeclares(css, '\\.character-state-panel', 'display:\\s*none')
  const phaseGrid = cssDeclares(
    css,
    `\\.character-main\\[data-character-phase=["']${panelPhase}["']\\][\\s\\S]{0,240}\\.${kind}`,
    'display:\\s*grid(?!\\s*!important)',
  )
  if (hasHidden && hiddenRule) return 'none'
  if (mode === 'local' && classes.includes('character-ai-only') && localAiOnly) return 'none'
  if (phase === panelPhase && phaseGrid) return 'grid'
  if (defaultNone) return 'none'
  return 'unset'
}

function extractCharacterAdvancedConfigHtml(html) {
  const idAt = html.indexOf('id="character-advanced-config"')
  assert.ok(idAt >= 0, 'missing #character-advanced-config')
  const start = html.lastIndexOf('<section', idAt)
  const scanner = /<\/?section\b/gi
  scanner.lastIndex = start
  let depth = 0
  let match
  while ((match = scanner.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, scanner.lastIndex)
  }
  assert.fail('unterminated #character-advanced-config')
}

function parseCharacterAdvancedConfigControls(html) {
  const section = extractCharacterAdvancedConfigHtml(html)
  const controls = []
  const tagRe = new RegExp(
    `<(${LOCAL_ADVANCED_CONFIG_CONTROL_SELECTOR.split(',').map((part) => part.trim()).join('|')})\\b([^>]*)>`,
    'gi',
  )
  let match
  while ((match = tagRe.exec(section))) {
    const tag = match[1].toLowerCase()
    const attrs = match[2]
    const id = attrs.match(/\bid="([^"]+)"/)?.[1]
    if (!id) continue
    const type = attrs.match(/\btype="([^"]+)"/)?.[1] || ''
    const multiple = /\bmultiple\b/.test(attrs)
    const checked = /\bchecked\b/.test(attrs)
    const valueAttr = attrs.match(/\bvalue="([^"]*)"/)?.[1] ?? ''
    const options = []
    let value = valueAttr
    if (tag === 'select') {
      const close = section.indexOf('</select>', match.index)
      const inner = section.slice(match.index, close)
      const optionRe = /<option\b([^>]*)>/gi
      let optionMatch
      while ((optionMatch = optionRe.exec(inner))) {
        const optionValue = optionMatch[1].match(/\bvalue="([^"]*)"/)?.[1] ?? ''
        const selected = /\bselected\b/.test(optionMatch[1])
        options.push({ value: optionValue, selected })
        if (selected) value = optionValue
      }
      if (!value && options[0]) value = options[0].value
    }
    controls.push({ id, tag, type, multiple, checked, value, options })
  }
  return controls
}

function snapshotSealedControl(control) {
  return {
    id: control.id,
    disabled: Boolean(control.disabled),
    tabIndex: control.tabIndex,
    value: control.value,
    checked: Boolean(control.checked),
    selectedIndex: Array.isArray(control.options) ? control.selectedIndex : undefined,
    selectedValues: control.multiple
      ? [...(control.selectedOptions || [])].map((option) => option.value)
      : undefined,
    type: control.type || '',
  }
}

function characterHtml(html) {
  const start = html.indexOf('id="studio-character-view"')
  assert.ok(start >= 0, 'Studio Character view is missing')
  return html.slice(start)
}

function functionSource(source, name) {
  const marker = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`)
  const match = marker.exec(source)
  assert.ok(match, `missing function ${name}`)
  const bodyStart = match.index + match[0].length
  const remainder = source.slice(bodyStart)
  const next = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/.exec(remainder)
  return source.slice(match.index, next ? bodyStart + next.index : source.length)
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
}

test('Studio Character preserves the exact desktop Figma shell geometry', async () => {
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  const narrowDesktopStart = css.indexOf('@media (min-width: 1005px) and (max-width: 1160px)')
  const narrowDesktopEnd = css.indexOf('@media (max-width: 1004px)', narrowDesktopStart)
  const narrowDesktop = css.slice(narrowDesktopStart, narrowDesktopEnd)

  assert.match(
    css,
    /\.character-topbar\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s,
  )
  assert.match(
    css,
    /\.character-topbar > \.status-badge\s*\{[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s,
  )
  assert.match(
    css,
    /\.character-local-workspace\s*\{[^}]*grid-template-columns:\s*300px minmax\(0, 1fr\)/s,
  )
  assert.match(
    css,
    /\.character-stage(?::not\(\.character-local-stage\))?\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\) 120px/s,
  )
  assert.match(
    css,
    /\.character-pipeline ol\s*\{[^}]*height:\s*56px/s,
  )
  assert.match(
    css,
    /\.character-pipeline li\s*\{[^}]*height:\s*56px[^}]*justify-content:\s*center[^}]*gap:\s*5px[^}]*padding:\s*9px 10px[^}]*border-left-width:\s*3px/s,
  )
  assert.doesNotMatch(css, /\.character-pipeline li::before/)
  assert.match(css, /\.character-pipeline li\.is-current\s*\{[^}]*border-color:\s*var\(--brand\)/s)
  assert.match(css, /\.character-pipeline li\.is-complete\s*\{[^}]*border-color:/s)
  assert.match(
    css,
    /\.character-pipeline li span\s*\{[^}]*flex:\s*0 0 auto[^}]*line-height:\s*11px/s,
  )
  assert.match(
    css,
    /\.character-pipeline li small\s*\{[^}]*flex:\s*0 0 auto[^}]*line-height:\s*10px/s,
  )
  assert.match(
    css,
    /\.character-state-mode-hint\.character-review-mode-hint\s*\{\s*display:\s*none;\s*\}/,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="review_required"\] \.character-review-mode-hint\s*\{\s*display:\s*flex;\s*\}/,
  )
  assert.ok(narrowDesktopStart >= 0 && narrowDesktopEnd > narrowDesktopStart)
  assert.match(
    narrowDesktop,
    /\.character-stage:not\(\.character-local-stage\)\s*\{\s*grid-template-rows:\s*36px minmax\(0, 1fr\) auto;\s*\}/,
  )
  assert.match(
    narrowDesktop,
    /\.character-pipeline\s*\{\s*grid-template-columns:\s*54px minmax\(0, 1fr\);\s*\}/,
  )
  assert.doesNotMatch(css, /\.pipeline-status\b/)
})

test('Studio Character owns the Figma local and strict AI modes on the internal route', async () => {
  const [html, app, view, api, localView, localApi, css, resultView] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
    readFile('src/ui/studio/characterApi.js', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterResultView.js', 'utf8'),
  ])

  assert.match(html, /href="#character" data-studio-route="character"/)
  assert.match(html, /href="#action" data-studio-route="action"/)
  assert.match(html, /href="#sequence" data-studio-route="sequence"/)
  assert.match(html, /href="#tiles" data-studio-route="tiles"/)
  assert.match(html, /href="#settings" data-studio-route="settings"/)
  assert.match(html, /<title>MoteWeave · 角色工作室<\/title>/)
  assert.match(
    openingTagForId(html, 'studio-settings-view'),
    /data-studio-view="settings"[^>]*hidden/,
  )
  assert.doesNotMatch(openingTagForId(html, 'studio-character-view'), /\bhidden\b/)
  assert.match(html, /id="studio-character-view"[\s\S]*data-studio-view="character"/)
  for (const nodeId of ['683:4017', '1449:4733', '1450:4953', '1450:6394', '1452:5091', '1452:5453', '701:4864', '702:3936', '709:4274', '704:4036', '706:4136', '711:4369']) {
    assert.match(html, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const nodeId of ['655:3697', '660:3702', '683:3795', '663:3707', '665:3716', '667:3725', '668:3736']) {
    assert.match(html, new RegExp(nodeId.replace(':', '\\:')))
  }
  assert.match(html, /id="character-local-entry"[^>]*aria-pressed="true"[^>]*data-studio-i18n="character\.localEntry"/)
  assert.match(html, /id="character-ai-entry"[^>]*aria-pressed="false"[^>]*data-studio-i18n="character\.aiEntry"/)
  assert.doesNotMatch(html, /id="character-compat-entry"|id="character-compat-workspace"|data-character-mode="compat"|characterCompatView/)
  assert.doesNotMatch(html, /971:5301|971:6230|971:7159|971:8101|996:5274/)
  assert.match(html, /data-ux-design-source="figma:ro8w6TKkpd969zW2V5bmkx\/996:5125"/)
  assert.match(html, /id="character-local-workspace"[^>]*data-character-local-phase="empty"/)
  assert.match(html, /class="character-stage-copy character-local-stage-copy"/)
  assert.match(html, /id="character-stage-title"/)
  assert.match(html, /class="character-local-clips-dock"/)
  assert.match(css, /\.character-main\[data-character-mode="local"\] #character-local-workspace\[data-character-local-phase="empty"\] \.character-local-stage-copy/)
  assert.match(css, /\.character-main\[data-character-mode="local"\] #character-local-workspace\[data-character-local-phase="empty"\] \.character-local-clips-dock/)
  assert.match(css, /\.character-main\[data-character-mode="local"\] #character-local-workspace\[data-character-local-phase="empty"\] \.character-local-stage-copy,[\s\S]*display:\s*none !important/)
  assert.match(css, /\.character-main\[data-character-mode="local"\] #character-local-workspace\[data-character-local-phase="empty"\] \.character-local-stage,[\s\S]*grid-template-rows:\s*36px minmax\(0, 1fr\)/)
  assert.doesNotMatch(css, /(?<!\[data-character-mode="local"\] )#character-local-workspace\[data-character-local-phase="empty"\] \.character-local-stage-copy/)
  assert.doesNotMatch(html, /id="character-local-stage-copy" hidden|id="character-local-clips"[^>]*hidden/)
  assert.doesNotMatch(css, /\.character-main\[data-character-mode="ai"\][^{]*\.character-local-stage-copy[^{]*display:\s*none !important/)
  assert.match(html, /id="character-local-quality"[^>]*hidden[^>]*aria-labelledby="character-local-quality-title"/)
  assert.match(html, /id="character-local-quality-disclosure"(?![^>]*\bopen\b)/)
  assert.match(html, /<details id="character-local-quality-disclosure">[\s\S]*<summary>[\s\S]*id="character-local-quality-status"[\s\S]*id="character-local-quality-issues"[\s\S]*id="character-local-quality-link"/)
  assert.doesNotMatch(html, /id="character-local-failure"|id="character-local-failure-issues"|class="character-local-failure"/)
  assert.doesNotMatch(css, /\.character-local-failure\b/)
  assert.doesNotMatch(localView, /character-local-failure/)
  assert.match(localView, /stageFailedReportHelp: 'Review the Quality Report at the top right\. Verified download stays locked\.'/)
  assert.match(localView, /stageFailedNoReportHelp: 'No Quality Report was returned\. Verified download stays locked\.'/)
  assert.match(css, /\.character-local-quality:has\(> details\[open\]\)/)
  assert.match(resultView, /setText\('character-local-quality-summary', `\$\{resultT\('qualityIssues'\)\} \$\{findingCount\}`\)/)
  assert.match(openingTagForId(html, 'character-ai-workspace'), /data-character-source="ai"/)
  assert.doesNotMatch(html, /<main id="character-ai-workspace"|character-flow-header|character-local-flow-header|新建一次调用计划/)
  assert.match(app, /const STUDIO_ROUTES = Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /return STUDIO_ROUTES\.includes\(route\) \? route : 'character'/)
  assert.match(app, /const activeRoute = STUDIO_ROUTES\.includes\(route\) \? route : 'character'/)
  assert.match(app, /const STUDIO_TITLES = Object\.freeze\(/)
  assert.match(app, /action: 'MoteWeave · 动作取帧'/)
  assert.match(app, /document\.title = STUDIO_TITLES\[language\]\[activeRoute\]/)
  assert.match(app, /setSharedCharacterResultRouteActive\(activeRoute === 'character'\)/)
  const movementHandler = functionSource(resultView, 'handleMovementKey')
  assert.match(movementHandler, /if \(!sharedResultRouteActive \|\| !preview\.animations/)
  assert.ok(movementHandler.indexOf('!sharedResultRouteActive') < movementHandler.indexOf('preventDefault'))
  assert.match(functionSource(resultView, 'drawPreviewFrame'), /if \(!sharedResultRouteActive \|\| !preview\.image/)
  assert.match(functionSource(resultView, 'startSharedCharacterPreview'), /if \(!sharedResultRouteActive \|\| !preview\.image/)
  assert.match(app, /if \(routerStarted\) return renderStudioRoute\(\)/)
  assert.match(app, /querySelector\('#language-select'\)\?\.addEventListener\('change',[\s\S]*renderStudioRoute\(resolveStudioRoute\(\)\)/)
  assert.match(app, /hashchange', \(\) => renderStudioRoute\(resolveStudioRoute\(\), \{ focus: true \}\)/)
  assert.match(app, /const heading = activeView\?\.querySelector\('h1'\)/)
  assert.match(app, /heading\.focus\(\{ preventScroll: true \}\)/)
  assert.match(app, /characterInitializationPromise = Promise\.resolve\(initStudioCharacter\(\{ serviceAvailable \}\)\)/)
  assert.doesNotMatch(`${app}\n${view}\n${localView}`, /(?:\.\.\/\.\.\/app\.js|characterPackTab|characterPack\/workflows|generateCharacterSheet)/)
  assert.match(api, /'\/api\/generate-character\/review'/)
  assert.match(api, /'\/api\/generate-character'/)
  assert.match(api, /`\/api\/jobs\/\$\{encodeURIComponent\(jobId\)\}`/)
  assert.match(api, /`\/api\/generate-character\/\$\{encodeURIComponent\(jobId\)\}\/accept`/)
  assert.match(api, /timeoutMs: STRICT_ACCEPT_REQUEST_TIMEOUT_MS/)
  assert.match(localApi, /'\/api\/process-sheet'/)
  assert.match(localApi, /`\/api\/jobs\/\$\{encodeURIComponent\(id\)\}`/)
})

test('Local Character failed state preserves a valid quality report and exposes localized blocking truth', () => {
  const report = {
    validation: {
      status: 'fail',
      warnings: [],
      blocking_errors: ['frame_0_empty'],
    },
  }
  const error = Object.assign(new Error('Quality Report does not permit verified downloads'), {
    code: 'quality_gate_blocked',
    payload: report,
  })
  const failed = createLocalCharacterFailureState({
    ...createInitialLocalCharacterState(),
    phase: 'running',
    busy: 'verify',
    job: { id: 'job_same', status: 'done' },
  }, {
    job: { id: 'job_same', status: 'done' },
    error,
  })

  assert.equal(failed.phase, 'failed')
  assert.equal(failed.busy, null)
  assert.equal(failed.failureReport, report)
  assert.equal(failed.result, null)
  assert.equal(deriveLocalCharacterPresentation(failed).helpKey, 'stageFailedReportHelp')
  assert.deepEqual(deriveLocalCharacterBlockingPresentation(failed, 'en'), {
    reasonKey: 'failureQualityBlocked',
    reason: 'The quality check blocked this result.',
    hasQualityReport: true,
  })
  assert.equal(
    deriveLocalCharacterVisibleError(failed, 'en'),
    'The quality check blocked this result. Current task response: Quality Report does not permit verified downloads',
  )
  assert.equal(
    deriveLocalCharacterBlockingPresentation(failed, 'zh').reason,
    '质量检查阻止了这个结果。',
  )
})

test('Local Character failed and submission-unknown states do not invent a Quality Report', () => {
  const failed = createLocalCharacterFailureState(createInitialLocalCharacterState(), {
    job: { id: 'job_failed', status: 'failed_model_error' },
    error: Object.assign(new Error('model failed'), {
      code: 'http_error',
      payload: { validation: { status: 'fail' } },
    }),
  })
  assert.equal(failed.failureReport, null)
  assert.equal(deriveLocalCharacterPresentation(failed).helpKey, 'stageFailedNoReportHelp')
  assert.deepEqual(deriveLocalCharacterBlockingPresentation(failed, 'en'), {
    reasonKey: 'failureService',
    reason: 'The service request ended without a verified result.',
    hasQualityReport: false,
  })
  assert.equal(
    deriveLocalCharacterVisibleError(failed, 'en'),
    'The service request ended without a verified result. Current task response: model failed',
  )

  const unknown = createLocalCharacterFailureState(createInitialLocalCharacterState(), {
    phase: 'submission_unknown',
    error: Object.assign(new Error('request failed'), { code: 'request_failed' }),
  })
  assert.equal(unknown.failureReport, null)
  assert.equal(deriveLocalCharacterBlockingPresentation(unknown, 'en').reasonKey, 'failureSubmissionUnknown')
  assert.equal(
    deriveLocalCharacterBlockingPresentation(unknown, 'zh').reason,
    '服务端没有返回权威任务回执，因此不能自动再次提交这个输入。',
  )
  assert.equal(
    deriveLocalCharacterVisibleError(unknown, 'zh'),
    '服务端没有返回权威任务回执，因此不能自动再次提交这个输入。 当前任务返回：request failed',
  )
})

test('Local Character done-to-verification failure keeps the same terminal Job and fails closed', () => {
  const terminalJob = { id: 'job_verified_binding', status: 'done' }
  const failed = createLocalCharacterFailureState({
    ...createInitialLocalCharacterState(),
    phase: 'running',
    busy: 'verify',
    binding: { inputKey: 'current-input' },
    job: terminalJob,
  }, {
    job: terminalJob,
    error: Object.assign(new Error('Animations manifest is malformed'), {
      code: 'invalid_animations',
      payload: { animations: 'not-a-quality-report' },
    }),
  })

  assert.equal(failed.phase, 'failed')
  assert.equal(failed.job, terminalJob)
  assert.equal(failed.binding.inputKey, 'current-input')
  assert.equal(failed.result, null)
  assert.equal(failed.failureReport, null)
  assert.equal(deriveLocalCharacterBlockingPresentation(failed, 'en').reasonKey, 'failureVerification')
  assert.equal(
    deriveLocalCharacterVisibleError(failed, 'en'),
    'The Job finished, but its returned files could not be verified. Current task response: Animations manifest is malformed',
  )

  const statusOnly = createLocalCharacterFailureState(createInitialLocalCharacterState(), {
    job: { id: 'job_status_only', status: 'failed_model_error' },
    errorMessage: 'failed_model_error',
  })
  assert.equal(
    deriveLocalCharacterVisibleError(statusOnly, 'en'),
    'The service did not produce a usable result.',
  )
})

test('Local Character activity uses only real discrete running phases', async () => {
  assert.deepEqual(deriveLocalCharacterActivityPresentation({
    phase: 'running',
    busy: 'observe',
    job: { status: 'queued' },
  }), { visible: true, key: 'progressQueued' })
  assert.deepEqual(deriveLocalCharacterActivityPresentation({
    phase: 'running',
    busy: 'observe',
    job: { status: 'post_processing' },
  }), { visible: true, key: 'progressPost' })
  assert.deepEqual(deriveLocalCharacterActivityPresentation({
    phase: 'running',
    busy: 'verify',
    job: { status: 'done' },
  }), { visible: true, key: 'progressVerify' })
  assert.deepEqual(deriveLocalCharacterActivityPresentation({ phase: 'poll_paused' }), {
    visible: false,
    key: null,
  })
  assert.deepEqual(deriveLocalCharacterActivityPresentation({ phase: 'complete' }), {
    visible: false,
    key: null,
  })

  const localView = await readFile('src/ui/studio/characterLocalView.js', 'utf8')
  assert.doesNotMatch(localView, /value:\s*(?:22|68|90|100)/)
  assert.match(localView, /progressBar\.removeAttribute\('value'\)/)
})

test('Studio Character keeps mode-specific source controls while sharing one real processor', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const character = characterHtml(html)
  assert.match(css, /\.character-local-workspace \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\)/)
  assert.doesNotMatch(css, /(?:^|[^\w-])\.character-workspace\s*\{/)
  assert.match(css, /\.character-workspace-title \{[^}]*clip:\s*rect\(0, 0, 0, 0\)/)
  assert.doesNotMatch(css, /\.character-flow-header \{[^}]*clip:\s*rect\(0, 0, 0, 0\)/)
  assert.match(character, /id="character-ai-workspace"[^>]*data-character-source="ai"/)
  assert.match(character, /id="character-regenerate-action"[^>]*hidden/)
  assert.doesNotMatch(openingTagForId(character, 'character-regenerate-action'), /aria-describedby/)
  assert.match(character, /id="character-replace-help"[^>]*hidden/)
  assert.match(character, /class="character-local-stage character-stage"/)
  assert.match(character, /class="character-local-profile"[^>]*data-character-processing-controls/)
  assert.match(character, /id="character-advanced-config"[^>]*data-character-processing-controls/)
  assert.match(character, /id="character-local-advanced-form"[^>]*data-character-processing="shared"/)
  assert.doesNotMatch(character, /id="character-ai-processing-summary"/)
  assert.match(character, /id="character-advanced-title"[^>]*data-studio-i18n="character.processingTitle"/)
  assert.match(character, /id="character-processing-shared-help"[^>]*data-studio-i18n="character.processingSharedHelp"/)
  assert.match(css, /\.character-advanced-inline-header\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*clip-path:\s*inset\(50%\)/)
  assert.match(css, /\.character-advanced-inline-header p\s*\{[^}]*display:\s*none/)
  assert.match(css, /\.character-local-processing-help\s*\{[^}]*display:\s*none/)
  const phaseFocus = functionSource(view, 'setState')
  assert.match(phaseFocus, /\['setup', 'confirm'\]\.includes\(state\.phase\)[\s\S]*'character-flow-title'[\s\S]*'character-workspace-title'/)
  assert.doesNotMatch(phaseFocus, /byId\('character-flow-title'\)\?\.focus/)
  const modeFocus = functionSource(view, 'showCharacterMode')
  assert.match(modeFocus, /\['setup', 'confirm'\]\.includes\(state\.phase\)[\s\S]*'character-workspace-title'/)
  assert.doesNotMatch(modeFocus, /\bbeginOperation\(\)/)
  assert.match(modeFocus, /state\.busy === 'hydrate'[\s\S]*activeController\?\.abort\(\)[\s\S]*operationEpoch \+= 1/)
  const sharedFormTag = openingTagForId(character, 'character-local-advanced-form')
  assert.doesNotMatch(sharedFormTag, /data-character-source=/)
  for (const id of [
    'character-advanced-layout',
    'character-advanced-background-mode',
    'character-advanced-tolerance',
    'character-advanced-anchor-x',
    'character-advanced-frame',
    'character-advanced-locks',
    'character-advanced-auto-correct',
    'character-advanced-motion-stabilize',
    'character-advanced-export-1x',
  ]) assert.match(character, new RegExp(`id="${id}"`))
  assert.match(character, /id="character-fixed-profile"[^>]*hidden/)
  assert.match(css, /\.character-main\[data-character-mode="ai"\]:not\(\[data-character-processing-source="ready"\]\) \[data-character-processing-controls\]\s*\{[^}]*display:\s*none !important/)
  assert.match(css, /\.character-main\[data-character-mode="ai"\] \[data-character-source="local"\]\s*\{[^}]*display:\s*none !important/)
  assert.doesNotMatch(css, /\.character-main\[data-character-mode="ai"\]\[data-character-processing-source="ready"\] \[data-character-source="ai"\]/)
  assert.match(css, /\.character-main\[data-character-mode="ai"\]\[data-character-ai-flow="source"\] \.character-ai-only,[\s\S]*#character-primary-action\s*\{[^}]*display:\s*none !important/)
  assert.doesNotMatch(css, /data-character-phase="review_required"\]\s+\.character-ai-source\s*,/)
  assert.doesNotMatch(css, /data-character-phase="review_required"\][^\n]*\.character-prompt-field\s*\{[^}]*display:\s*none/)
  assert.doesNotMatch(css, /\.character-ai-readonly-group\b/)
  assert.doesNotMatch(css, /\.character-ai-readonly-values\b/)
  assert.match(css, /\.character-ai-budget > div \{[^}]*border:\s*1px solid var\(--border-soft\);[^}]*background:\s*var\(--control-dark\);/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.processingTitle'], '处理参数')
  assert.equal(STUDIO_TRANSLATIONS.en['character.processingTitle'], 'Processing parameters')
  assert.equal(htmlParentOfId(html, 'character-local-advanced-form')?.id, 'character-advanced-config')
  assert.match(character, /id="character-local-canvas"/)
  assert.match(character, /id="character-local-quality"/)
  assert.match(character, /id="character-local-clips"/)
  assert.equal((character.match(/id="character-advanced-config"/g) || []).length, 1)
  assert.equal((character.match(/id="character-local-canvas"/g) || []).length, 1)
  assert.doesNotMatch(character, /<main id="character-ai-workspace"|character-flow-header|新建一次调用计划/)
  assert.match(view, /function bindAiSharedResult\(/)
  assert.match(view, /setHidden\('character-release-grid', true\)/)
  assert.doesNotMatch(view, /setHidden\('character-release-grid', !unlocked\)/)
  assert.match(view, /loadAcceptedRawCharacterSource\(/)
  assert.match(view, /adoptStudioCharacterProcessingSource\(/)
  assert.match(view, /setStudioCharacterProcessingContext\(/)
  assert.doesNotMatch(view, /createAiAcceptedResultPresentation\(/)
  assert.doesNotMatch(view, /function projectSharedCharacterResult\(/)
  assert.match(view, /localWorkspace\.hidden = false/)
  assert.match(character, /id="character-ai-planned-calls"/)
  assert.match(character, /id="character-ai-max-calls"/)
  assert.match(character, /id="character-ai-used-calls"/)
  assert.match(character, /id="character-ai-next-action"/)
  assert.match(character, /id="character-fixed-profile"[^>]*hidden/)
  assert.doesNotMatch(character, /class="mode-tab is-active"/)
  assert.match(character, /id="character-sealed-binding"[^>]*class="[^"]*technical-disclosure/)
  assert.match(view, /function renderAiBudget\(/)
  assert.doesNotMatch(view, /\/api\/process-sheet/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.aiSourceTitle'], 'AI 生成角色')
  assert.equal(STUDIO_TRANSLATIONS.en['character.aiSourceTitle'], 'Generate a character with AI')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.regenerateAction'], '准备生成另一张')
  assert.equal(STUDIO_TRANSLATIONS.en['character.regenerateAction'], 'Prepare another image')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.reviewAction'], '生成角色')
  assert.equal(STUDIO_TRANSLATIONS.en['character.reviewAction'], 'Generate character')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.topdownProfileTab'], '俯视布局暂不可用')
})

test('Studio Character keeps sealed review provenance internal and removes non-actionable processing chrome', async () => {
  const [html, view, css, localView] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
  ])
  const character = characterHtml(html)
  const sealedInput = character.match(/<section id="character-sealed-input"[\s\S]*?<\/section>/)?.[0] ?? ''
  const promptLink = openingTagForId(character, 'character-sealed-prompt-link')
  const renderBinding = functionSource(view, 'renderReviewBinding')
  const buildReview = functionSource(view, 'buildReview')
  const restorePending = functionSource(view, 'restorePendingGenerationFromQuery')
  const renderControls = functionSource(view, 'renderControls')
  const renderComposer = functionSource(view, 'renderAiSourceComposer')
  const regenerate = functionSource(view, 'regenerateFromPrompt')
  const reset = functionSource(view, 'resetToReview')
  const clearPending = functionSource(view, 'clearPendingGenerationInUrl')
  const renderLanguage = functionSource(view, 'renderStudioCharacterLanguage')
  const renderLocalLanguage = functionSource(localView, 'renderStudioCharacterLocalLanguage')

  assert.ok(sealedInput, 'internal sealed generation provenance is missing')
  assert.match(openingTagForId(character, 'character-sealed-input'), /\bhidden\b/)
  assert.match(openingTagForId(character, 'character-sealed-input'), /aria-hidden="true"/)
  assert.match(sealedInput, /id="character-sealed-description"/)
  assert.match(sealedInput, /data-studio-i18n="character\.sealedNegativeSummary"/)
  assert.doesNotMatch(sealedInput, /<(?:input|textarea|select|button)\b/)
  assert.match(promptLink, /target="_blank"/)
  assert.match(promptLink, /rel="noopener"/)
  assert.match(promptLink, /\bhidden\b/)
  assert.doesNotMatch(promptLink, /\bhref=/)
  assert.match(renderBinding, /const sealedInputVisible = state\.phase === 'review_required' && Boolean\(review\)/)
  assert.match(renderBinding, /setHidden\('character-sealed-input', true\)/)
  assert.match(renderBinding, /state\.sealedDescription\?\.trim\(\)/)
  assert.match(renderBinding, /review\?\.generation_prompt_url/)
  assert.match(renderBinding, /promptLink\.href = promptUrl/)
  assert.match(renderBinding, /promptLink\.removeAttribute\('href'\)/)
  assert.doesNotMatch(renderBinding, /(?:fetch|requestStrictFixedRegionReview|startStrictLiveGeneration|postStrictManualAcceptance)\s*\(/)
  const startPrepared = functionSource(view, 'startPreparedCharacterAiReview')
  assert.match(startPrepared, /sealedDescription:\s*description/)
  assert.match(startPrepared, /draftDescription:\s*description/)
  assert.match(renderControls, /renderAiSourceComposer\(\)/)
  assert.match(renderComposer, /state\.phase === 'review_required'/)
  assert.match(renderComposer, /setup \|\| reviewRequired \|\| acceptedSourceReady/)
  assert.match(renderComposer, /character-replace-help/)
  assert.match(renderComposer, /regenerate\.hidden = !replacementReady/)
  assert.match(regenerate, /state\.phase === 'review_required'/)
  assert.match(regenerate, /acceptedProcessingHandoffComplete\(\)/)
  assert.match(regenerate, /prepareCharacterAiReviewInput\(\)/)
  assert.match(regenerate, /resetToReview\(\)/)
  assert.match(regenerate, /startPreparedCharacterAiReview\(prepared\)/)
  assert.match(reset, /clearPendingGenerationInUrl\(\)/)
  assert.match(reset, /currentCharacterAiDrafts\(\)/)
  assert.match(clearPending, /searchParams\.delete\('pending_job'\)/)
  assert.match(clearPending, /searchParams\.delete\('pending_review'\)/)
  assert.match(restorePending, /sealedDescription:\s*restored\.sealedDescription/)
  assert.match(restorePending, /draftDescription:\s*restored\.sealedDescription/)
  assert.match(renderLanguage, /renderStudioCharacterLocalLanguage\(\)/)
  assert.match(renderLocalLanguage, /renderStaticCopy\(\)/)
  assert.match(renderLocalLanguage, /refreshSharedAdvancedProfileCopy\(\)/)
  assert.match(view, /\['character\.reviewLinkPrompt', 'generation_prompt_url'\]/)
  assert.match(css, /\.character-sealed-input,\s*\n\.character-sealed-binding,\s*\n\.character-review-evidence\s*\{[^}]*display:\s*none !important/s)
  assert.match(renderBinding, /setHidden\('character-sealed-binding', true\)/)
  assert.match(view, /setHidden\('character-review-evidence', true\)/)
  assert.match(openingTagForId(character, 'character-sealed-binding'), /\bhidden\b[^>]*aria-hidden="true"/)
  assert.match(openingTagForId(character, 'character-review-evidence'), /\bhidden\b[^>]*aria-hidden="true"/)
  assert.match(character, /class="character-local-default-chips"[^>]*\bhidden\b/)
  assert.match(character, /class="character-advanced-lock-label"[^>]*\bhidden\b[^>]*>[\s\S]*?id="character-advanced-locks"/)
  assert.match(css, /\.character-main:is\(\[data-character-phase="running"\], \[data-character-phase="review_required"\], \[data-character-phase="accepted"\]\) \.character-ai-settings\s*\{[^}]*display:\s*none !important/s)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.sealedInputTitle'], '生成输入（已封存）')
  assert.equal(STUDIO_TRANSLATIONS.en['character.sealedInputTitle'], 'Generation input (sealed)')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.sealedInputState'], '只读')
  assert.equal(STUDIO_TRANSLATIONS.en['character.sealedInputState'], 'Read only')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.reviewDescriptionHelp'], '修改只会准备一张新图，不会改当前图片；生成仍需再次确认。')
  assert.equal(STUDIO_TRANSLATIONS.en['character.reviewDescriptionHelp'], 'Edits prepare a new image and do not change the current one. Generation still needs an explicit confirm.')
})


test('Studio Character AI setup uses a structured form and a quiet generated-image canvas', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const character = characterHtml(html)
  assert.match(character, /id="character-ai-form"/)
  assert.match(character, /id="character-preset"/)
  assert.match(character, /value="rpg_humanoid_v0"/)
  assert.match(character, /value="animal_companion_v0"/)
  assert.match(character, /value="monster_creature_v0"/)
  assert.match(character, /value="xianxia_hero_v0"/)
  assert.match(character, /value="chibi_big_pixel_v0"/)
  assert.doesNotMatch(character, /two_to_one_character_v0/)
  assert.deepEqual([...CHARACTER_AI_COMPATIBLE_PRESET_IDS], [
    'rpg_humanoid_v0',
    'animal_companion_v0',
    'monster_creature_v0',
    'xianxia_hero_v0',
    'chibi_big_pixel_v0',
  ])
  for (const id of [
    'character-model',
    'character-reference-mode',
    'character-reference-file',
    'character-palette-file',
    'character-seed',
  ]) assert.match(character, new RegExp(`id="${id}"`))
  assert.match(character, /id="character-model-trigger"[^>]*role="combobox"/)
  assert.match(character, /id="character-preset-trigger"[^>]*role="combobox"/)
  const aiForm = character.slice(character.indexOf('id="character-ai-form"'), character.indexOf('id="character-local-advanced-form"'))
  assert.equal([...aiForm.matchAll(/d="M5 8l5 5 5-5"/g)].length, 3)
  assert.doesNotMatch(aiForm, />▾</)
  const localForm = character.slice(character.indexOf('id="character-local-advanced-form"'))
  assert.equal([...localForm.matchAll(/d="M5 8l5 5 5-5"/g)].length, 4)
  assert.match(localForm, /id="character-advanced-layout-trigger"[^>]*role="combobox"/)
  assert.match(character, /id="character-reference-mode"/)
  assert.match(character, /id="character-reference-mode-trigger"[^>]*role="combobox"/)
  assert.match(character, /id="character-reference-mode-trigger"[^>]*aria-autocomplete="none"/)
  assert.match(character, /aria-haspopup="listbox"/)
  assert.match(character, /id="character-reference-mode-option-builtin"/)
  assert.match(character, /id="character-reference-mode-option-custom"/)
  assert.match(openingTagForId(character, 'character-ai-refs'), /\bhidden\b/)
  assert.match(character, /value="builtin"/)
  assert.match(character, /value="custom"/)
  assert.doesNotMatch(functionSource(view, 'collectCharacterAiReviewInput'), /referenceMode:/)
  assert.doesNotMatch(character, /id="character-field-(?:identity|body|outfit|colors|equipment|style)"/)
  assert.doesNotMatch(character, /character-ai-fields/)
  assert.doesNotMatch(css, /character-ai-fields/)
  assert.match(character, /class="character-ai-advanced"/)
  assert.doesNotMatch(character, /id="character-description-help"/)
  assert.doesNotMatch(character, /character\.descriptionHelp/)
  assert.doesNotMatch(character, /id="character-(?:temperature|top-p|top-k|quality-tier|candidate-count|negative-prompt|aspect-ratio)"/)
  assert.match(openingTagForId(character, 'character-ai-gemini'), /\bhidden\b/)
  assert.match(openingTagForClassToken(character, 'character-ai-settings'), /\bhidden\b/)
  assert.match(html, /id="character-primary-action"[^>]*>生成角色</)
  assert.match(css, /\.character-ai-settings\s*\{[^}]*display:\s*none !important/)
  assert.match(css, /\.character-ai-topdown-note\s*\{[^}]*display:\s*none !important/)
  assert.match(css, /\.character-main\[data-character-phase="setup"\] \.character-stage-copy\s*\{[^}]*clip-path:\s*inset\(50%\)/)
  const buildReview = functionSource(view, 'buildReview')
  const prepareReview = functionSource(view, 'prepareCharacterAiReviewInput')
  const startPreparedReview = functionSource(view, 'startPreparedCharacterAiReview')
  assert.match(prepareReview, /collectCharacterAiReviewInput\(\)/)
  assert.match(startPreparedReview, /requestStrictFixedRegionReview\(input/)
  assert.doesNotMatch(startPreparedReview, /requestStrictFixedRegionReview\(\{\s*description/)
  assert.match(buildReview, /prepareCharacterAiReviewInput\(\)/)
  assert.match(view, /startStrictLiveGeneration\(state\.review/)
  assert.doesNotMatch(view, /temperature|topP|topK|qualityTier/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.confirmAction'], '确认生成')
  assert.equal(STUDIO_TRANSLATIONS.en['character.confirmAction'], 'Confirm generation')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.descriptionLabel'], '角色概念')
  assert.equal(STUDIO_TRANSLATIONS.en['character.descriptionLabel'], 'Character concept')
})

test('Studio Character AI review input binds only maintained Current fields', () => {
  const builtin = collectCharacterAiReviewInput({
    draftDescription: '  a copper-haired ranger  ',
    draftCharacterPreset: 'two_to_one_character_v0',
    providerPresetId: 'gemini-native-test',
    draftReferenceMode: 'builtin',
    draftPromptFields: {
      identity: 'fox ears',
      body: '',
      outfit: 'green coat',
      colors: 'copper and green',
      equipment: '',
      style: '16-bit',
      background: 'forest',
    },
    draftSeed: '7',
    draftReferenceImage: { base64: 'abc', mimeType: 'image/png', name: 'hero.png' },
    draftPaletteImage: { base64: 'def', mimeType: 'image/webp', name: 'palette.webp' },
  })
  assert.deepEqual(builtin, {
    description: 'a copper-haired ranger',
    characterPreset: 'rpg_humanoid_v0',
    providerPresetId: 'gemini-native-test',
    generationOptions: { candidateCount: 1, seed: 7 },
  })
  assert.equal(Object.hasOwn(builtin, 'promptFields'), false)
  assert.equal(Object.hasOwn(builtin, 'model'), false)
  assert.equal(Object.hasOwn(builtin, 'referenceImage'), false)
  assert.equal(Object.hasOwn(builtin, 'paletteImage'), false)
  assert.equal(Object.hasOwn(builtin, 'referenceMode'), false)
  const custom = collectCharacterAiReviewInput({
    draftDescription: 'ranger',
    draftCharacterPreset: 'rpg_humanoid_v0',
    providerPresetId: 'gemini-native-test',
    draftReferenceMode: 'custom',
    draftReferenceImage: { base64: 'abc', mimeType: 'image/png', name: 'hero.png' },
    draftPaletteImage: { base64: 'def', mimeType: 'image/webp', name: 'palette.webp' },
  })
  assert.deepEqual(custom.referenceImage, { base64: 'abc', mimeType: 'image/png', name: 'hero.png' })
  assert.deepEqual(custom.paletteImage, { base64: 'def', mimeType: 'image/webp', name: 'palette.webp' })
  assert.equal(Object.hasOwn(custom, 'referenceMode'), false)
  assert.throws(
    () => collectCharacterAiReviewInput({
      draftDescription: 'ranger',
      draftCharacterPreset: 'rpg_humanoid_v0',
      draftReferenceMode: 'custom',
    }),
    /Add at least one character or palette reference|请至少添加一张角色参考或配色参考/,
  )
  assert.throws(
    () => collectCharacterAiReviewInput({
      draftDescription: 'ranger',
      draftCharacterPreset: 'rpg_humanoid_v0',
      draftSeed: '1.5',
    }),
    /Seed must be a whole number|种子必须是整数/,
  )
})

test('Studio Character shared stage names itself from the visible shared title', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const character = characterHtml(html)
  const stageTag = character.match(/<section class="character-local-stage character-stage"[^>]*>/)?.[0] ?? ''
  assert.ok(stageTag, 'shared Character stage section is missing')
  assert.match(stageTag, /aria-labelledby="character-stage-title"/)
  assert.doesNotMatch(stageTag, /character-local-stage-title/)
  assert.match(character, /<h2 id="character-stage-title"[^>]*>/)
  const localTitle = character.match(/<h2 id="character-local-stage-title"[^>]*>/)?.[0] ?? ''
  assert.ok(localTitle, 'hidden Local stage title compatibility node is missing')
  assert.match(localTitle, /\bhidden\b/)
})

test('Studio Character exposes truthful controls for strict fixed, manual Accept, and blocked Topdown', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const character = characterHtml(html)

  assert.match(html, /id="character-description"/)
  assert.doesNotMatch(character, /class="character-contract-card"/)
  for (const internalSetupId of [
    'character-profile-value',
    'character-layout-value',
    'character-budget-value',
    'character-matte-value',
  ]) {
    assert.equal(openingTagForId(character, internalSetupId), '', `setup must not expose #${internalSetupId}`)
  }
  assert.match(html, /id="character-primary-action"[^>]*data-action="review"/)
  assert.match(html, /id="character-issue-count"[^>]*min="0"[^>]*step="1"/)
  assert.doesNotMatch(character, /id="character-topdown-profile"/)
  assert.match(character, /<span class="character-ai-topdown-note"[^>]*role="note"[^>]*data-studio-i18n="character\.topdownProfileTab"/)
  const exportTag = openingTagForId(html, 'character-export-link')
  assert.match(exportTag, /aria-disabled="true"/)
  assert.match(exportTag, /data-studio-i18n="character\.exportLocked"/)
  assert.doesNotMatch(exportTag, /\bhidden\b/)
  assert.doesNotMatch(exportTag, /\bhref\s*=/)
  assert.match(openingTagForId(html, 'character-reset-action'), /\bhidden\b/)
  assert.match(openingTagForId(character, 'character-local-advanced-form'), /data-character-processing="shared"/)
  assert.match(character, /id="character-advanced-tolerance"/)
  assert.match(character, /id="character-advanced-locks"/)
  assert.match(character, /id="character-advanced-auto-correct"/)
  assert.match(character, /id="character-advanced-motion-stabilize"/)
  assert.match(character, /data-studio-i18n="character\.statusBlockedPreReview">调用前已阻断 · 0 次调用/)
  assert.match(html, /id="character-provider-binding"/)
  assert.match(html, /id="character-model-binding"/)
  assert.match(view, /setText\('character-plan-hash', review\?\.plan_hash \|\| '—'\)/)
  assert.match(view, /setText\('character-reference-hash', review\?\.reference_manifest_sha256 \|\| '—'\)/)
  assert.doesNotMatch(character, /(?:Reject|拒绝|自动接受|自动修补)/i)
  assert.match(view, /const visible = state\.phase === 'review_required'/)
  assert.match(view, /const acceptance = state\.phase === 'accepted' \? state\.acceptance : null/)
  assert.match(view, /if \(state\.phase !== 'setup'\) return[\s\S]*phase: 'topdown'/)
  assert.doesNotMatch(view, /(?:retry|fallback|repair).*fetch\s*\(/i)

  const setup = deriveCharacterPresentation(createInitialCharacterState())
  assert.equal(setup.action, 'review')
  assert.equal(setup.topStatusKey, 'character.statusReviewPending')
  assert.equal(setup.stagePhaseKey, 'character.phaseReview')
  const restoringPublication = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    busy: 'restore',
  })
  assert.equal(restoringPublication.action, 'blocked')
  assert.equal(restoringPublication.actionKey, 'character.restoringPublicationAction')
  assert.equal(restoringPublication.topStatusKey, 'character.statusRestoringPublication')
  const confirm = deriveCharacterPresentation({ ...createInitialCharacterState(), phase: 'confirm' })
  assert.equal(confirm.action, 'confirm')
  assert.equal(confirm.topStatusKey, 'character.statusReady')
  assert.equal(confirm.stagePhaseKey, 'character.phaseConfirm')
  const blocked = deriveCharacterPresentation({ ...createInitialCharacterState(), phase: 'topdown' })
  assert.equal(blocked.action, 'blocked')
  assert.equal(blocked.topStatusKey, 'character.statusBlockedPreReview')
  assert.equal(blocked.stagePhaseKey, 'character.phaseTopdown')

  const runningUnknown = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'running',
    job: { status: 'queued', provider_calls_used: 1 },
  })
  assert.equal(runningUnknown.statusCode, 'queued')
  assert.equal(runningUnknown.usedCalls, null)

  const runningKnown = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'running',
    job: { status: 'queued', provider_call_budget: { used_provider_calls: 1 } },
  })
  assert.equal(runningKnown.statusCode, 'queued')
  assert.equal(runningKnown.usedCalls, 1)

  const submissionUnknown = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'running',
    failureMode: 'submission_unknown',
  })
  assert.equal(submissionUnknown.statusCode, 'submission_unknown')
  assert.equal(submissionUnknown.usedCalls, null)
  assert.equal(submissionUnknown.action, 'running')

  const failedQuality = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'running',
    failureMode: 'terminal',
    job: { status: 'failed_quality_gate', provider_call_budget: { used_provider_calls: 1 } },
  })
  assert.equal(failedQuality.statusCode, 'failed_quality_gate')
  assert.equal(failedQuality.usedCalls, 1)
  assert.equal(failedQuality.action, 'running')
  const evidenceFailure = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'review_required',
    failureMode: 'evidence',
  })
  assert.equal(evidenceFailure.action, 'blocked')
  assert.equal(evidenceFailure.stagePhaseKey, 'character.phaseReviewRequired')
  assert.equal(evidenceFailure.topStatusKey, 'character.statusReviewRequiredZero')
  const recheckableEvidenceFailure = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'review_required',
    failureMode: 'evidence',
    job: { id: 'job_existing', status: 'done' },
    review: { reviewed_run_id: 'review_existing' },
  })
  assert.equal(recheckableEvidenceFailure.action, 'recheck')
  assert.equal(recheckableEvidenceFailure.topStatusKey, 'character.statusReviewRequired')
  assert.match(STUDIO_TRANSLATIONS.zh['character.jobStatusFailedQuality'], /质量门失败/)
  assert.match(STUDIO_TRANSLATIONS.zh['character.jobStatusNotFound'], /任务不存在/)

  assert.match(view, /presentationStagePhase\(presentation\)/)
  assert.match(view, /presentationTopStatus\(presentation\)/)
  assert.doesNotMatch(view, /presentation\.(?:stagePhase|topStatus)\b/)
  assert.doesNotMatch(view, /phase:\s*'failed'/)
  assert.match(view, /setHidden\('character-reset-action', true\)/)
  assert.match(view, /\['blocked', 'running'\]\.includes\(presentation\.action\)/)
})

test('Studio Character exposes exactly the six approved Figma state shells and their real-data bindings', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const character = characterHtml(html)
  const approvedPhases = ['setup', 'confirm', 'running', 'review_required', 'accepted', 'topdown']

  assert.match(
    openingTagForId(html, 'studio-character-view'),
    /data-character-phase="setup"/,
  )
  assert.deepEqual(
    [...new Set([...view.matchAll(/phase:\s*'([^']+)'/g)].map((match) => match[1]))].sort(),
    [...approvedPhases].sort(),
  )
  assert.doesNotMatch(view, /phase:\s*'failed'/)

  for (const selector of [
    'data-character-phase="running"',
    'data-character-phase="review_required"',
    'data-character-phase="accepted"',
    'data-character-phase="topdown"',
  ]) {
    assert.match(css, new RegExp(selector))
  }

  const bindingIds = [
    'character-running-panel-title',
    'character-running-mode-binding',
    'character-running-provider-calls',
    'character-running-network-phase',
    'character-running-profile',
    'character-running-call-budget',
    'character-running-raw-provenance',
    'character-running-job-state',
    'character-running-job-detail',
    'character-review-gate-binding',
    'character-review-mode-binding',
    'character-review-raw-sha',
    'character-review-matte-count',
    'character-accepted-publication-id',
    'character-accepted-profile',
    'character-accepted-source-job',
    'character-accepted-raw-sha',
    'character-accepted-release-gate',
    'character-accepted-output-pack',
    'character-accepted-output-engines',
    'character-topdown-panel-title',
  ]
  for (const id of bindingIds) {
    assert.notEqual(openingTagForId(character, id), '', `missing Figma state binding #${id}`)
  }

  for (const id of ['character-running-panel-title', 'character-topdown-panel-title']) {
    assert.match(
      openingTagForId(character, id),
      /data-studio-i18n="character\.[^"]+"/,
      `missing bilingual marker on #${id}`,
    )
  }
  assert.match(
    character,
    /class="character-state-panel character-accepted-panel[^"]*character-ai-only"[^>]*aria-labelledby="character-accepted-panel-title"[\s\S]*id="character-accepted-card-kicker"[\s\S]*id="character-accepted-card-detail"/,
  )
  assert.match(
    character,
    /id="character-review-evidence"[\s\S]*data-studio-i18n="character\.reviewEvidenceTitle"/,
  )
  assert.match(view, /root\.dataset\.characterPhase = state\.phase/)
  assert.match(view, /if \(state\.failureMode\) root\.dataset\.characterFailure = state\.failureMode/)
})

test('Studio Character keeps only text while waiting for evidence and hides it for result or blocked phases', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const placeholder = html.match(
    /<div id="character-placeholder"[\s\S]*?<\/div>\s*<div id="character-job-strip" class="character-job-strip"/,
  )?.[0]
  assert.ok(placeholder, 'character placeholder is missing')
  assert.match(placeholder, /data-studio-i18n="character\.placeholderText"/)
  assert.doesNotMatch(placeholder, /class="pixel-character"/)
  assert.doesNotMatch(css, /\.pixel-character\b/)
  assert.match(
    view,
    /setHidden\('character-placeholder', true\)/,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="running"\] \.character-placeholder,/,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="setup"\] \.character-placeholder,/,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="topdown"\] \.character-placeholder \{ display: none !important; \}/,
  )
  assert.doesNotMatch(css, /\.character-main\[data-character-phase="running"\] \.character-placeholder p/)
  assert.match(
    css,
    /\.character-main\[data-character-phase="topdown"\] \.character-blocking-grid\s*\{[^}]*display:\s*none !important/s,
  )

  const stageCopy = html.match(/<header class="character-stage-copy[^"]*">[\s\S]*?<\/header>/)?.[0]
  assert.ok(stageCopy, 'character stage status is missing')
  assert.match(stageCopy, /id="character-stage-kicker"[^>]*data-studio-i18n="character\.reviewKicker"/)
  assert.match(stageCopy, /<h2 id="character-stage-title"[^>]*data-studio-i18n="character\.reviewStageTitle">/)
  assert.match(stageCopy, /id="character-stage-help"[^>]*data-studio-i18n="character\.reviewStageSummary"/)
  assert.match(view, /setText\('character-stage-kicker', studioT\(presentation\.kickerKey\)\)/)
  assert.match(view, /setText\('character-stage-title', studioT\(presentation\.stageTitleKey/)
  assert.match(css, /\.character-stage-copy\s*\{[^}]*min-height:\s*72px/s)
  assert.match(css, /\.character-main\[data-character-phase="review_required"\]:not\(\[data-character-failure\]\) \.character-stage-copy\s*\{[^}]*display:\s*none !important/s)
  assert.match(css, /\.character-main:is\(\[data-character-processing-source="acquiring"\], \[data-character-processing-source="ready"\]\):has\([^}]+\) \.character-stage-copy\s*\{[^}]*display:\s*none !important/s)
  assert.doesNotMatch(css, /\.character-main\[data-character-phase="review_required"\] \.character-stage-copy\s*\{[^}]*display:\s*none/s)
  assert.match(css, /\.character-main\[data-character-phase="review_required"\] \.character-ai-evidence-disclosure\s*\{[^}]*display:\s*none !important/s)
  assert.match(css, /\.character-main\[data-character-phase="accepted"\] \.character-stage-copy\s*\{[^}]*width:\s*min\(340px, 100%\);[^}]*min-height:\s*72px/s)
  assert.doesNotMatch(
    css,
    /\.character-main\[data-character-phase="accepted"\] \.character-stage-copy\s*\{[^}]*display:\s*none/s,
  )
})

test('Studio Character derives Running bindings and phases only from the current Job evidence', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const bindings = functionSource(view, 'renderFigmaStateBindings')
  const phases = functionSource(view, 'renderRunningPhases')

  assert.match(bindings, /const usedCalls = authoritativeCallUsage\(state\.job\)/)
  assert.match(bindings, /const rawSha = state\.job\?\.raw_provider_output_sha256/)
  assert.match(bindings, /const submissionUnknown = state\.failureMode === 'submission_unknown'/)
  assert.match(bindings, /const terminalBeforeRaw = state\.failureMode === 'terminal' && !state\.job\?\.raw_provider_output_url/)
  assert.match(bindings, /setText\(\s*'character-running-mode-binding'/)
  assert.match(bindings, /setText\(\s*'character-running-panel-title'/)
  assert.match(bindings, /setText\(\s*'character-running-network-phase'/)
  for (const key of [
    'character.runningProviderComplete',
    'character.runningSubmissionUnknown',
    'character.runningStopped',
    'character.runningProviderPending',
    'character.networkFinished',
    'character.networkStateUnknown',
    'character.networkStateStopped',
    'character.networkStatePending',
  ]) {
    assert.match(bindings, new RegExp(key.replace('.', '\\.')))
  }

  assert.match(phases, /const status = state\.job\?\.status/)
  assert.match(phases, /if \(status === 'generating'\) current = 1/)
  assert.match(phases, /if \(state\.job\?\.raw_provider_output_url\)/)
  assert.match(phases, /if \(status === 'done'\)/)
  assert.match(phases, /index === current && !state\.failureMode/)
})

test('Studio Character maps each Figma shell to its approved dynamic pipeline labels', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const source = view.match(
    /const PIPELINE_PRESETS = Object\.freeze\(\{([\s\S]*?)\n\}\)/,
  )?.[1]
  assert.ok(source, 'PIPELINE_PRESETS is missing')

  function preset(phase) {
    const block = source.match(
      new RegExp(`${phase}: Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\),`),
    )?.[1]
    assert.ok(block, `${phase} pipeline preset is missing`)
    return [...block.matchAll(/\['([^']+)', '([^']+)'\]/g)]
      .map((match) => [match[1], match[2]])
  }

  const standard = [
    ['raw', 'character.pipelineRaw'],
    ['matte', 'character.pipelineMatte'],
    ['count', 'character.pipelineCount'],
    ['evidence', 'character.pipelineEvidence'],
    ['quality', 'character.pipelineQuality'],
    ['review', 'character.pipelineReview'],
    ['accept', 'character.pipelineAccept'],
  ]
  assert.deepEqual(preset('setup'), standard)
  assert.match(source, /confirm: null/)
  assert.match(source, /running: null/)
  assert.deepEqual(preset('review_required'), [
    ['raw', 'character.pipelineRaw'],
    ['output', 'character.pipelineOutput'],
    ['six_base', 'character.pipelineSixBase'],
    ['spill', 'character.pipelineSpill'],
    ['sure_bg', 'character.pipelineSureBackground'],
    ['unknown', 'character.pipelineUnknown'],
    ['sure_fg', 'character.pipelineSureForeground'],
  ])
  assert.deepEqual(preset('accepted'), [
    ['idle', 'character.pipelineIdle'],
    ['walk_down', 'character.pipelineWalkDown'],
    ['walk_up', 'character.pipelineWalkUp'],
    ['walk_left', 'character.pipelineWalkLeft'],
    ['walk_right', 'character.pipelineWalkRight'],
    ['attack', 'character.pipelineAttack'],
    ['hurt', 'character.pipelineHurt'],
  ])
  assert.deepEqual(preset('topdown'), [
    ['profile', 'character.pipelineProfile'],
    ['structure', 'character.pipelineStructure'],
    ['prompt', 'character.pipelinePrompt'],
    ['model', 'character.pipelineModel'],
    ['budget', 'character.pipelineBudget'],
    ['hashes', 'character.pipelineHashes'],
    ['review', 'character.pipelineReview'],
  ])

  const renderPipeline = functionSource(view, 'renderPipeline')
  assert.match(renderPipeline, /const preset = PIPELINE_PRESETS\[state\.phase\] \|\| standard/)
  assert.match(renderPipeline, /item\.dataset\.pipelineStep = step/)
  assert.match(renderPipeline, /title\.textContent = studioT\(labelKey\)/)
  assert.match(renderPipeline, /stepState === 'complete'\s*\? studioT\('character\.pipelineComplete'\)/)
  assert.doesNotMatch(renderPipeline, /['"]✓['"]/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.pipelineComplete'], '完成')
  assert.equal(STUDIO_TRANSLATIONS.en['character.pipelineComplete'], 'Complete')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.pipelineStepCount'], '7 步')
  assert.equal(STUDIO_TRANSLATIONS.en['character.pipelineStepCount'], '7 steps')

  const crumbs = {
    setup: 'character.headerCrumb',
    confirm: 'character.headerCrumbConfirm',
    running: 'character.headerCrumbRunning',
    review_required: 'character.headerCrumbReviewRequired',
    accepted: 'character.headerCrumbAccepted',
    topdown: 'character.headerCrumbTopdown',
  }
  for (const [phase, key] of Object.entries(crumbs)) {
    assert.equal(characterHeaderCrumbKey({ phase }), key)
    assert.ok(STUDIO_TRANSLATIONS.zh[key])
    assert.ok(STUDIO_TRANSLATIONS.en[key])
  }
  assert.equal(
    characterHeaderCrumbKey({ phase: 'running', failureMode: 'poll_interrupted' }),
    'character.headerCrumb',
  )

  assert.deepEqual(characterJobStripPresentation({ phase: 'setup' }), {
    titleKey: 'character.stripReviewTitle',
    detailKey: 'character.reviewJobDetail',
  })
  assert.deepEqual(characterJobStripPresentation({ phase: 'review_required' }), {
    titleKey: 'character.stripReviewRequiredTitle',
    detailKey: 'character.reviewRequiredJobDetail',
  })
  assert.deepEqual(characterJobStripPresentation({
    phase: 'review_required',
    failureMode: 'evidence',
    job: { status: 'done' },
  }), {
    titleKey: 'character.jobStatusEvidenceError',
    detailKey: 'character.evidenceFailedStageSummary',
  })
  assert.deepEqual(characterJobStripPresentation({ phase: 'setup', busy: 'restore' }), {
    titleKey: 'character.statusRestoringPublication',
    detailKey: 'character.restoringPublicationAction',
  })
  for (const [failureMode, titleKey, detailKey] of [
    ['restore_loading', 'character.statusPendingRestoreLoading', 'character.pendingRestoreLoadingStageSummary'],
    ['restore_interrupted', 'character.statusPendingRestoreInterrupted', 'character.pendingRestoreInterruptedStageSummary'],
    ['restore_failed', 'character.statusPendingRestoreFailed', 'character.pendingRestoreFailedStageSummary'],
  ]) {
    assert.deepEqual(characterJobStripPresentation({ phase: 'running', failureMode }), { titleKey, detailKey })
  }
  assert.equal(characterPipelineStepState({ phase: 'review_required' }, 'evidence'), 'complete')
  assert.equal(characterPipelineStepState({
    phase: 'review_required',
    failureMode: 'evidence',
    job: { raw_provider_output_url: '/generated/job/raw.png' },
  }, 'raw'), 'complete')
  assert.equal(characterPipelineStepState({
    phase: 'review_required',
    failureMode: 'evidence',
    job: { raw_provider_output_url: '/generated/job/raw.png' },
  }, 'evidence'), 'wait')
  assert.equal(characterPipelineStepState({
    phase: 'running',
    failureMode: 'terminal',
    job: { status: 'failed_quality_gate' },
  }, 'raw'), 'wait')
  assert.equal(characterPipelineStepState({
    phase: 'running',
    failureMode: 'submission_unknown',
  }, 'raw'), 'wait')
  assert.equal(characterPipelineStepState({ phase: 'accepted', acceptedResult: null }, 'idle'), 'wait')
  assert.equal(characterPipelineStepState({
    phase: 'accepted',
    acceptedResult: { complete: false, error: { code: 'missing_debug_report_url' } },
    acceptedHydrateError: { code: 'missing_debug_report_url' },
  }, 'walk_down'), 'wait')
  assert.equal(characterPipelineStepState({
    phase: 'accepted',
    acceptedResult: {
      complete: true,
      animations: sampleAnimations(),
      debugReport: sampleDebugReport(),
      missingQualityUrl: false,
      error: null,
    },
    acceptedPresentationReady: true,
    processingSourceReady: true,
  }, 'hurt'), 'complete')
  assert.equal(acceptedHydrationKind({ phase: 'accepted', acceptedResult: null }), 'pending')
  assert.equal(acceptedHydrationKind({
    phase: 'accepted',
    acceptedResult: {
      complete: true,
      animations: sampleAnimations(),
      debugReport: sampleDebugReport(),
      missingQualityUrl: false,
      error: null,
    },
  }), 'pending')
  assert.equal(acceptedHydrationKind({
    phase: 'accepted',
    acceptedHydrateError: { code: 'result_image_failed' },
    acceptedResult: { complete: true, animations: {}, debugReport: {}, missingQualityUrl: false },
  }), 'error')
  assert.equal(deriveCharacterPresentation({
    phase: 'accepted',
    acceptedResult: null,
  }).action, 'blocked')
  assert.equal(deriveCharacterPresentation({
    phase: 'accepted',
    acceptedHydrateError: { code: 'http_error', message: 'HTTP 503' },
    acceptedResult: { error: { code: 'http_error' } },
  }).action, 'retry-accepted')
  assert.equal(deriveCharacterPresentation({
    phase: 'accepted',
    acceptedResult: {
      complete: true,
      animations: sampleAnimations(),
      debugReport: sampleDebugReport(),
      missingQualityUrl: false,
      error: null,
    },
    acceptedPresentationReady: true,
    processingSourceReady: true,
  }).action, 'blocked')
  for (const [key, zh, en] of [
    ['character.stripReviewTitle', '尚未审阅', 'Review not started'],
    ['character.stripConfirmTitle', '可确认', 'Ready to confirm'],
    ['character.stripRunningTitle', '生成中', 'Generating'],
    ['character.stripReviewRequiredTitle', '需要人工审阅', 'Human review required'],
    ['character.stripTopdownTitle', '审阅前已阻断', 'Blocked before review'],
  ]) {
    assert.equal(STUDIO_TRANSLATIONS.zh[key], zh)
    assert.equal(STUDIO_TRANSLATIONS.en[key], en)
  }
})

test('Studio Character keeps Export visible but unlocks it only for a verified downstream processing Job', async () => {
  const resultView = await readFile('src/ui/studio/characterResultView.js', 'utf8')
  const exportFn = functionSource(resultView, 'renderExportLinks')
  const presentation = functionSource(resultView, 'createCharacterResultPresentation')

  assert.match(presentation, /exportUnlocked: exportable/)
  assert.match(resultView, /function characterResultExportable/)
  assert.match(resultView, /status === 'playable'/)
  assert.match(resultView, /exportUrls\?\.debug_report_url/)
  assert.match(exportFn, /const release = presentation\.exportUnlocked \? presentation\.exportUrls : null/)
  assert.match(exportFn, /topExport\.href = '#character-local-export-dialog'/)
  assert.match(exportFn, /topExport\.removeAttribute\?\.\('href'\)/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.exportLocked'], '处理完成后可导出')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.exportBlocked'], '当前不可导出')
})

test('Studio Character keeps ten independent evidence media empty until the verified review gate', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])

  const evidenceBlock = view.match(
    /const EVIDENCE_MEDIA = Object\.freeze\(\[([\s\S]*?)\]\)/,
  )?.[1]
  assert.ok(evidenceBlock, 'EVIDENCE_MEDIA is missing')
  const actualBindings = [...evidenceBlock.matchAll(/\['([^']+)', '([^']+)'\]/g)]
    .map((match) => [match[1], match[2]])
  assert.deepEqual(actualBindings, EVIDENCE_BINDINGS)
  assert.equal(new Set(actualBindings.map(([id]) => id)).size, 10)
  assert.equal(new Set(actualBindings.map(([, field]) => field)).size, 10)

  for (const [id] of EVIDENCE_BINDINGS) {
    const tag = html.match(new RegExp(`<img[^>]+id="${id}"[^>]*>`))?.[0] ?? ''
    assert.notEqual(tag, '')
    assert.doesNotMatch(tag, /\bsrc\s*=/)
    assert.match(tag, /\bdata-studio-i18n-alt="character\.[^"]+"/)
  }

  assert.match(view, /const visible = state\.phase === 'review_required'/)
  assert.match(view, /image\.getAttribute\('src'\) !== job\[field\]/)
  assert.match(view, /image\.src = job\[field\]/)
  assert.match(view, /evidenceMediaReady\(\)/)
  assert.match(
    view,
    /EVIDENCE_MEDIA\.every\(\(\[, field\]\) => state\.evidenceMediaStatus\[field\] === 'loaded'\)/,
  )
  assert.match(
    view,
    /phase: 'review_required',[\s\S]*evidenceMediaStatus: Object\.fromEntries\(EVIDENCE_MEDIA\.map/,
  )

  const rawTag = openingTagForId(html, 'character-raw-image')
  const normalizedTag = openingTagForId(html, 'character-normalized-image')
  assert.match(rawTag, /data-studio-i18n-alt="character\.rawAlt"/)
  assert.match(normalizedTag, /data-studio-i18n-alt="character\.normalizedAlt"/)
  assert.match(evidenceBlock, /\['character-raw-image', 'raw_provider_output_url'\]/)
  assert.match(evidenceBlock, /\['character-normalized-image', 'normalized_sheet_url'\]/)
  assert.doesNotMatch(evidenceBlock, /(?:source_url|\|\||\?\?)/)
  assert.match(
    html,
    /id="character-normalized-image"[\s\S]*data-studio-i18n="character\.normalizedFileNote"/,
  )
  assert.match(STUDIO_TRANSLATIONS.en['character.normalizedFileNote'], /not Raw/i)
  assert.match(STUDIO_TRANSLATIONS.zh['character.normalizedFileNote'], /不是原始图/)
})

test('Studio Character lists every verified artifact with its real path, hash, and byte length', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])

  const artifactNav = openingTagForId(html, 'character-evidence-artifacts')
  assert.match(artifactNav, /\bhidden\b/)
  assert.match(
    artifactNav,
    /\bdata-studio-i18n-aria-label="character\.verifiedArtifactsLabel"/,
  )

  const renderArtifacts = functionSource(view, 'renderEvidenceArtifactLinks')
  assert.match(renderArtifacts, /if \(state\.phase !== 'review_required'\) return/)
  assert.match(renderArtifacts, /for \(const artifact of state\.verifiedArtifacts\)/)
  assert.match(renderArtifacts, /anchor\.href = artifact\.url/)
  assert.match(renderArtifacts, /file\.textContent = artifact\.file/)
  assert.match(
    renderArtifacts,
    /detail\.textContent = `\$\{artifact\.sha256\} · \$\{artifact\.byte_length\} B · \$\{artifact\.url\}`/,
  )
  assert.match(
    renderArtifacts,
    /anchor\.title = `\$\{artifact\.sha256\} · \$\{artifact\.url\}`/,
  )
})

test('Studio Character surfaces Accept publication failures and evidence failures without substitution', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const accept = functionSource(view, 'acceptGeneration')
  const acceptRecheckPolicy = functionSource(view, 'acceptFailureRequiresEvidenceRecheck')
  const enterReview = functionSource(view, 'enterReviewRequired')
  const imageError = functionSource(view, 'handleEvidenceImageError')
  const observe = functionSource(view, 'observeGenerationJob')
  const renderControls = functionSource(view, 'renderControls')
  const render = functionSource(view, 'renderStudioCharacter')

  assert.match(accept, /postStrictManualAcceptance\(state\.job\.id, body/)
  assert.match(accept, /catch \(error\)[\s\S]*phase: 'review_required'/)
  assert.match(accept, /acceptFailureRequiresEvidenceRecheck\(error\)/)
  assert.match(accept, /failureMode: 'evidence'/)
  assert.match(accept, /acceptError: errorMessage\(error\)/)
  assert.match(acceptRecheckPolicy, /artifact_integrity_failed/)
  assert.match(acceptRecheckPolicy, /acceptance_binding_stale/)
  assert.match(renderControls, /state\.acceptError[\s\S]*character\.acceptFailed/)
  assert.match(render, /if \(state\.error\) setActionMessage\(state\.error, 'error'\)/)

  assert.match(
    enterReview,
    /catch \(error\)[\s\S]*setState\(\{\s*phase: 'review_required',[\s\S]*failureMode: 'evidence',[\s\S]*error: errorMessage\(error\)/,
  )
  assert.match(imageError, /image\?\.removeAttribute\('src'\)/)
  assert.match(imageError, /phase: 'review_required'/)
  assert.match(imageError, /evidenceBody: null/)
  assert.match(imageError, /verifiedArtifacts: state\.verifiedArtifacts/)
  assert.match(imageError, /failureMode: 'evidence'/)
  assert.match(imageError, /character\.evidenceImageFailed/)
  assert.match(
    observe,
    /phase: 'running',[\s\S]*busy: null,[\s\S]*failureMode: 'terminal'/,
  )
  assert.match(
    render,
    /acceptedHydrationKind\(\) === 'pending'/,
  )
})

test('Studio Character resumes observation of the existing job without a second generation POST', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const resume = functionSource(view, 'resumeGenerationObservation')
  const confirm = functionSource(view, 'confirmGeneration')
  const primary = functionSource(view, 'handlePrimaryAction')

  assert.match(resume, /state\.failureMode !== 'poll_interrupted' \|\| !state\.job/)
  assert.match(resume, /observeGenerationJob\(state\.job, operation\)/)
  assert.doesNotMatch(
    resume,
    /(?:startStrictLiveGeneration|requestStrictFixedRegionReview|postStrictManualAcceptance|fetch\s*\()/,
  )
  assert.equal((confirm.match(/startStrictLiveGeneration\(/g) ?? []).length, 1)
  assert.match(confirm, /reviewConsumed: true/)
  assert.match(primary, /action === 'observe'\) void resumeGenerationObservation\(\)/)

  const interrupted = deriveCharacterPresentation({
    ...createInitialCharacterState(),
    phase: 'running',
    failureMode: 'poll_interrupted',
    job: { id: 'job_existing', status: 'queued' },
  })
  assert.equal(interrupted.action, 'observe')
  assert.equal(interrupted.statusCode, 'poll_interrupted')
  assert.equal(interrupted.usedCalls, null)
})

test('Studio Character restores only an explicit validated Accepted publication without a new generation', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const fromQuery = functionSource(view, 'acceptedPublicationFromQuery')
  const readCache = functionSource(view, 'readAcceptedPublicationCache')
  const restore = functionSource(view, 'restoreAcceptedPublicationFromQuery')
  const accept = functionSource(view, 'acceptGeneration')

  assert.match(fromQuery, /searchParams\.getAll\('publication'\)/)
  assert.match(fromQuery, /values\.length === 1 \? values\[0\] : null/)
  assert.match(readCache, /validateStrictAcceptedPublicationCache\(JSON\.parse\(raw\), publicationId\)/)
  assert.match(restore, /const cached = readAcceptedPublicationCache\(publicationId\)/)
  assert.match(restore, /setState\(\{ busy: 'restore', acceptError: null, error: null \}\)/)
  assert.match(restore, /phase: 'accepted'/)
  assert.match(restore, /replayStrictAcceptedPublication\(publicationId/)
  assert.match(restore, /cacheAcceptedPublication\(restored\)/)
  assert.doesNotMatch(
    restore,
    /(?:requestStrictFixedRegionReview|startStrictLiveGeneration|pollStrictGenerationJob|\/api\/gemini-state)/,
  )
  assert.match(accept, /cacheAcceptedPublication\(\{[\s\S]*publicationId: acceptance\.publication_id/)
  assert.match(accept, /selectAcceptedPublicationInUrl\(acceptance\.publication_id\)/)
  assert.match(accept, /acceptedBinding: body/)
  assert.match(restore, /acceptedBinding: cached\.body/)
  assert.match(restore, /acceptedBinding: restored\.body/)
  assert.match(
    restore,
    /catch \(error\)[\s\S]*phase: 'review_required',[\s\S]*failureMode: 'evidence',[\s\S]*error: errorMessage\(error\)/,
  )

  const bindings = functionSource(view, 'renderFigmaStateBindings')
  assert.match(bindings, /const binding = state\.phase === 'accepted' \? state\.acceptedBinding : null/)
  assert.match(bindings, /binding\?\.expectedRawProviderOutputSha256/)

  const render = functionSource(view, 'renderStudioCharacter')
  assert.match(render, /if \(state\.error\) setActionMessage\(state\.error, 'error'\)/)
  assert.match(
    render,
    /acceptedHydrationKind\(\) === 'pending'/,
  )
})

test('Studio Character restores one sealed pending Job into the existing review state without generation', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const fromQuery = functionSource(view, 'pendingGenerationFromQuery')
  const restore = functionSource(view, 'restorePendingGenerationFromQuery')
  const selectAccepted = functionSource(view, 'selectAcceptedPublicationInUrl')

  assert.match(fromQuery, /params\.getAll\('pending_job'\)/)
  assert.match(fromQuery, /params\.getAll\('pending_review'\)/)
  assert.match(fromQuery, /jobs\.length !== 1 \|\| reviews\.length !== 1/)
  assert.match(fromQuery, /parseStrictPendingGenerationSelector\(/)
  assert.match(restore, /state\.pendingSelector \|\| pendingGenerationFromQuery\(\)/)
  assert.match(restore, /restoreStrictReviewRequiredGeneration\(selector/)
  assert.match(restore, /reviewConsumed: true/)
  assert.match(restore, /await enterReviewRequired\(restored\.job, operation\)/)
  assert.match(restore, /isRecoverableStrictPendingRestoreError\(error\)/)
  assert.match(restore, /'restore_interrupted'/)
  assert.match(restore, /'restore_failed'/)
  assert.doesNotMatch(
    restore,
    /(?:requestStrictFixedRegionReview|startStrictLiveGeneration|pollStrictGenerationJob|\/api\/gemini-state|\/api\/generate-character)/,
  )
  assert.match(selectAccepted, /searchParams\.delete\('pending_job'\)/)
  assert.match(selectAccepted, /searchParams\.delete\('pending_review'\)/)

  const primary = functionSource(view, 'handlePrimaryAction')
  assert.match(primary, /action === 'restore'\) void restorePendingGenerationFromQuery\(\)/)
  const presentation = functionSource(view, 'deriveCharacterPresentation')
  assert.match(presentation, /action: interrupted \? 'restore' : 'blocked'/)
})

test('Studio Character preserves route, accessibility, responsive, and bilingual marker contracts', async () => {
  const [html, app, settingsView, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const character = characterHtml(html)

  assert.match(openingTagForId(character, 'character-local-advanced-form'), /data-character-processing="shared"/)
  assert.equal(openingTagForId(character, 'character-ai-processing-summary'), '')
  assert.match(openingTagForId(character, 'character-top-status'), /role="status"/)
  assert.match(openingTagForId(character, 'character-top-status'), /aria-live="polite"/)
  assert.match(openingTagForId(character, 'character-top-status'), /aria-atomic="true"/)
  assert.match(openingTagForId(character, 'character-flow-title'), /tabindex="-1"/)
  assert.match(openingTagForId(character, 'character-accept-preflight'), /role="status"/)
  assert.match(openingTagForId(character, 'character-accept-preflight'), /aria-live="polite"/)
  assert.match(openingTagForId(character, 'character-action-message'), /role="status"/)
  assert.match(openingTagForId(character, 'character-action-message'), /aria-live="polite"/)
  const jobStrip = openingTagForId(character, 'character-job-strip')
  assert.match(jobStrip, /class="character-job-strip" role="group"/)
  assert.match(jobStrip, /data-studio-i18n-aria-label="character\.jobStripLabel"/)
  assert.doesNotMatch(jobStrip, /aria-live=/)
  assert.doesNotMatch(character, /class="pipeline-status"/)
  assert.equal(openingTagForId(character, 'character-job-state'), '')
  assert.equal(openingTagForId(character, 'character-job-detail'), '')
  const pipeline = character.match(/<footer class="character-pipeline">[\s\S]*?<\/footer>/)?.[0]
  assert.ok(pipeline, 'character pipeline footer is missing')
  assert.equal((pipeline.match(/<li\b/g) ?? []).length, 7)
  assert.doesNotMatch(pipeline, /<(?:input|button|img|svg)\b/)
  assert.match(
    character,
    /class="character-language-group" role="group"[^>]*data-studio-i18n-aria-label="settings\.language\.label"/,
  )
  const languageButtons = character.match(/<button class="language-short character-language[^>]+>/g) ?? []
  assert.equal(languageButtons.length, 2)
  for (const tag of languageButtons) {
    assert.match(tag, /aria-pressed="(?:true|false)"/)
    assert.doesNotMatch(tag, /aria-current=/)
  }
  assert.doesNotMatch(character, /class="character-search"|character\.searchDisabled/)
  assert.match(app, /hashchange'[\s\S]*\{ focus: true \}/)
  assert.match(app, /\['http:', 'https:'\]\.includes\(locationValue\?\.protocol\)/)
  assert.match(app, /document\.documentElement\.classList\.toggle\('studio-file-mode', !available\)/)
  assert.match(app, /initStudioSettings\(\{ serviceAvailable \}\)/)
  assert.match(app, /initStudioCharacter\(\{ serviceAvailable \}\)/)
  assert.match(app, /if \(focus\)[\s\S]*heading\.focus\(\{ preventScroll: true \}\)/)
  assert.match(
    settingsView,
    /translateAttribute\(root, 'data-studio-i18n-alt', 'alt', (?:lang|language)\)/,
  )
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-stage:not\(\.character-local-stage\) \{ grid-template-rows: 36px minmax\(0, 1fr\) auto; \}/)
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-pipeline \{ grid-template-columns: 1fr; \}/)
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-pipeline ol \{ grid-template-columns: repeat\(4, minmax\(50px, 1fr\)\); \}/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.character-topbar \{ height: auto; min-height: 44px;/)
  assert.match(css, /\.character-local-commit\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;[^}]*margin-top:\s*auto;/)
  assert.match(
    css,
    /@media \(max-width: 860px\)[\s\S]*?\.character-main\[data-character-mode="ai"\] \.character-local-commit\s*\{[^}]*position:\s*static;[^}]*bottom:\s*auto;[^}]*margin-top:\s*12px;/,
  )
  assert.doesNotMatch(css, /\.character-evidence-grid figure:last-child \{ grid-column: 1 \/ -1; \}/)
  assert.match(css, /\.studio-file-mode \[data-studio-server-required\] \{ pointer-events: none; opacity: \.45; \}/)

  assert.match(html, /location\.protocol === 'file:'[\s\S]*studio-file-mode/)
  assert.match(html, /else if \(control\.hasAttribute\('data-studio-server-required'\)\) control\.tabIndex = -1/)
  assert.match(html, /showLockedStatus\('studio-provider-state-badge', '需要本地服务'\)/)
  assert.match(openingTagForId(html, 'studio-runtime-warning'), /role="alert"/)
  assert.match(openingTagForId(html, 'character-primary-action'), /\bdisabled\b/)
  assert.match(openingTagForId(html, 'character-primary-action'), /\bdata-studio-server-required\b/)
  const characterView = await readFile('src/ui/studio/characterView.js', 'utf8')
  assert.match(characterView, /const editable = serviceConnectionAvailable[\s\S]*\(setup \|\| reviewRequired \|\| acceptedSourceReady\)[\s\S]*&& !state\.busy/)
  assert.match(characterView, /fixed\.disabled = !serviceConnectionAvailable/)
  assert.match(characterView, /topdownButton\.disabled = !serviceConnectionAvailable/)
  assert.match(characterView, /setText\('character-running-job-state', pipelineStatus\)/)
  assert.match(characterView, /setText\('character-running-job-detail', pipelineDetail\)/)
  assert.doesNotMatch(characterView, /setText\('character-job-(?:state|detail)'/)
  assert.match(css, /\.character-main:not\(\[data-character-phase="accepted"\]\) \.character-job-strip\s*\{[^}]*display:\s*flex/s)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.reviewJobDetail'], '先描述角色，再生成')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.reviewRequiredJobDetail'], '证据已生成 · 等待人工确认')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.topdownJobDetail'], '此布局暂不可用')

  const markerKeys = new Set(
    [...character.matchAll(/data-studio-i18n(?:-[a-z-]+)?="([^"]+)"/g)]
      .map((match) => match[1]),
  )
  for (const language of ['zh', 'en']) {
    for (const key of markerKeys) {
      assert.ok(
        Object.hasOwn(STUDIO_TRANSLATIONS[language], key),
        `missing ${language} Studio Character translation for ${key}`,
      )
    }
  }

  const englishKeys = Object.keys(STUDIO_TRANSLATIONS.en)
    .filter((key) => key.startsWith('character.'))
    .sort()
  const chineseKeys = Object.keys(STUDIO_TRANSLATIONS.zh)
    .filter((key) => key.startsWith('character.'))
    .sort()
  assert.deepEqual(chineseKeys, englishKeys)
  for (const key of englishKeys) {
    assert.deepEqual(
      placeholders(STUDIO_TRANSLATIONS.zh[key]),
      placeholders(STUDIO_TRANSLATIONS.en[key]),
      `${key} placeholder mismatch`,
    )
  }

  const strictPrimaryCopyKeys = [
    'character.fixedProfileTab',
    'character.topdownProfileTab',
    'character.statusReviewPending',
    'character.statusBlockedPreReview',
    'character.statusReady',
    'character.statusReviewRequired',
    'character.statusReviewRequiredZero',
    'character.statusAccepted',
    'character.jobStatusQueued',
    'character.jobStatusGenerating',
    'character.jobStatusPostProcessing',
    'character.jobStatusDone',
    'character.jobStatusFailedQuality',
    'character.jobStatusFailedSafety',
    'character.jobStatusFailedModel',
    'character.jobStatusFailedPost',
    'character.jobStatusNotFound',
    'character.jobStatusRequestFailed',
    'character.jobStatusEvidenceError',
    'character.jobStatusPollInterrupted',
    'character.jobStatusSubmissionUnknown',
  ]
  const oldPrimaryTokens = /(?:Fixed[- ]region|Profile|Structure|review_pending|blocked_pre_review|review_required|accepted|queued|generating|post_processing|done|failed_quality_gate|failed_safety_filter|failed_model_error|failed_post_processing|not_found|request_failed|evidence_error|poll_interrupted|submission_unknown)/i
  for (const key of strictPrimaryCopyKeys) {
    assert.match(STUDIO_TRANSLATIONS.zh[key], /[\u3400-\u9fff]/, `${key} must be Chinese in zh`)
    assert.doesNotMatch(STUDIO_TRANSLATIONS.zh[key], oldPrimaryTokens, `${key} keeps an old English or machine token in zh`)
    assert.match(STUDIO_TRANSLATIONS.en[key], /[A-Za-z]/, `${key} must remain English in en`)
    assert.doesNotMatch(STUDIO_TRANSLATIONS.en[key], /[\u3400-\u9fff]/, `${key} must not contain Chinese in en`)
  }

  const userFacingStatusKeys = [
    'character.statusReviewPending',
    'character.statusBlockedPreReview',
    'character.statusReady',
    'character.statusReviewRequired',
    'character.statusReviewRequiredZero',
    'character.statusAccepted',
    'character.stripReviewTitle',
    'character.stripConfirmTitle',
    'character.stripRunningTitle',
    'character.stripReviewRequiredTitle',
    'character.stripTopdownTitle',
  ]
  const rawStatusCodes = /\b(?:review_pending|blocked_pre_review|review_required|poll_interrupted|submission_unknown)\b/i
  for (const language of ['zh', 'en']) {
    for (const key of userFacingStatusKeys) {
      assert.doesNotMatch(
        STUDIO_TRANSLATIONS[language][key],
        rawStatusCodes,
        `${language} ${key} must not expose a machine status code`,
      )
    }
  }
  assert.doesNotMatch(character, /review_pending/i)
})

test('Studio document IDs stay unique after adding the Character view', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length)
})

test('Studio Character phase panels stay CSS-gated without static hidden', async () => {
  const [html, css, localView] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
  ])
  const panels = {
    running: openingTagForClassToken(html, 'character-running-panel'),
    accepted: openingTagForClassToken(html, 'character-accepted-panel'),
    topdown: openingTagForClassToken(html, 'character-topdown-panel'),
  }
  assert.match(panels.running, /^<details\b/)
  assert.match(panels.accepted, /^<section\b/)
  assert.match(panels.topdown, /^<section\b/)
  for (const [name, tag] of Object.entries(panels)) {
    assert.doesNotMatch(attributeTokens(tag), /\bhidden\b/, `${name} opening tag must not use static hidden`)
  }
  assert.match(panels.accepted, /\bcharacter-ai-only\b/)
  assert.match(panels.running, /\bcharacter-ai-only\b/)
  assert.match(panels.topdown, /\bcharacter-ai-only\b/)
  assert.match(panels.running, /\bcharacter-state-card\b/)
  assert.match(panels.accepted, /\bcharacter-state-card\b/)
  assert.match(panels.topdown, /\bcharacter-state-card-compact\b/)
  assert.match(panels.accepted, /aria-labelledby="character-accepted-panel-title"/)
  assert.match(panels.topdown, /aria-labelledby="character-topdown-panel-title"/)
  assert.match(html, /<h2 id="character-accepted-panel-title">/)
  assert.match(html, /<dl class="character-state-rows">/)
  const stageBody = html.slice(html.indexOf('character-local-stage-body'), html.indexOf('character-local-clips-dock'))
  const copyAt = stageBody.indexOf('character-local-stage-copy')
  const runningAt = stageBody.indexOf('character-running-panel')
  const acceptedAt = stageBody.indexOf('character-accepted-panel')
  const topdownAt = stageBody.indexOf('character-topdown-panel')
  const previewAt = stageBody.indexOf('character-local-preview')
  const qualityAt = stageBody.indexOf('character-local-quality')
  const evidenceAt = stageBody.indexOf('character-ai-evidence-disclosure')
  assert.ok(copyAt >= 0 && runningAt > copyAt && acceptedAt > runningAt && topdownAt > acceptedAt)
  assert.ok(previewAt > topdownAt && qualityAt > previewAt && evidenceAt > qualityAt)
  const evidenceParent = htmlParentOfId(html, 'character-ai-evidence-disclosure')
  assert.ok(evidenceParent, 'evidence disclosure must have a parsed parent')
  assert.ok(
    String(evidenceParent.className).split(/\s+/).includes('character-local-stage-body'),
    `evidence parent must be .character-local-stage-body, got ${evidenceParent.className}`,
  )
  assert.match(css, /\.character-local-stage-body\s*>\s*\.character-ai-evidence-disclosure[^}]*grid-column:\s*1\s*\/\s*-1/)
  assert.match(css, /\.character-local-stage-body\s*>\s*\.character-ai-evidence-disclosure[^}]*justify-self:\s*start[^}]*width:\s*min\(560px,\s*100%\)/)
  assert.match(css, /\.character-local-stage-body\s*>\s*\.character-ai-evidence-disclosure\[open\][^}]*width:\s*100%/)
  assert.match(css, /\.character-main\[data-character-phase="review_required"\]:not\(\[data-character-failure\]\) \.character-local-stage-body:has\([^}]+\)\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);[^}]*grid-auto-rows:\s*minmax\(0, 1fr\);[^}]*padding:\s*0;[^}]*background-size:\s*20px 20px/)
  assert.match(css, /\.character-main:is\(\[data-character-processing-source="acquiring"\], \[data-character-processing-source="ready"\]\) \.character-local-stage-body:has\([^}]+\)\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);[^}]*grid-auto-rows:\s*minmax\(0, 1fr\);[^}]*padding:\s*0;[^}]*background-size:\s*20px 20px/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-local-preview\s*\{[^}]*flex:\s*0 0 auto/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-local-stage-body\s*>\s*\.character-ai-evidence-disclosure\s*\{[^}]*flex:\s*0 0 auto/)
  assert.match(html, /id="character-sheet-inspector"[^>]*aria-labelledby="character-sheet-inspector-title"[^>]*hidden/)
  assert.match(html, /id="character-sheet-viewport"[^>]*data-character-sheet-zoom="actual"[^>]*role="region"[^>]*tabindex="0"/)
  assert.match(html, /id="character-sheet-zoom-fit-button"[^>]*aria-controls="character-sheet-viewport"[^>]*aria-pressed="false"/)
  assert.match(html, /id="character-sheet-zoom-actual-button"[^>]*aria-controls="character-sheet-viewport"[^>]*aria-pressed="true"/)
  assert.match(html, /id="character-sheet-open-original"[^>]*target="_blank"[^>]*rel="noopener"[^>]*hidden/)
  assert.equal(htmlParentOfId(html, 'character-accepted-image')?.id, 'character-sheet-viewport')
  assert.match(css, /\.character-sheet-viewport\s*\{[^}]*overflow:\s*auto[^}]*overscroll-behavior:\s*contain/)
  assert.match(css, /\.character-sheet-inspector\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s)
  assert.match(css, /\.character-sheet-inspector-toolbar\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*4;[^}]*left:\s*12px;[^}]*right:\s*12px;[^}]*top:\s*12px;[^}]*padding:\s*6px 8px;[^}]*border:\s*0;[^}]*background:\s*rgba\(18, 22, 30, \.82\);[^}]*box-shadow:\s*0 8px 24px/s)
  assert.match(css, /\.character-sheet-viewport\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*auto;[^}]*padding:\s*62px 24px 24px;[^}]*background-size:\s*20px 20px/s)
  assert.match(css, /\.character-main\[data-character-phase="review_required"\]:not\(\[data-character-failure\]\) \.character-sheet-viewport\s*\{[^}]*height:\s*100%;[^}]*background:\s*transparent/)
  assert.match(css, /\.character-main:is\(\[data-character-processing-source="acquiring"\], \[data-character-processing-source="ready"\]\) \.character-sheet-viewport\s*\{[^}]*height:\s*100%;[^}]*background:\s*transparent/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-main:is\(\[data-character-processing-source="acquiring"\], \[data-character-processing-source="ready"\]\) \.character-sheet-viewport\s*\{[^}]*height:\s*clamp\(380px, 58vh, 620px\)/)
  assert.match(css, /\.character-sheet-zoom button\[aria-pressed="true"\]/)
  assert.doesNotMatch(css, /\.character-shared-sheet:not\(\[hidden\]\)\s*\{[^}]*max-width:\s*min\(520px,\s*100%\)/)
  assert.match(html, /id="character-evidence-summary-status"[^>]*data-state="loading"/)
  assert.match(html, /class="character-evidence-metadata"/)
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.character-main\[data-character-phase="review_required"\] \.character-evidence-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.doesNotMatch(css, /\.character-stage:not\(\.character-local-stage\)[^{]*\{[^}]*character-local-stage-body/)
  assert.match(css, /\.character-local-stage-body\s*>\s*\.character-state-panel/)
  assert.match(css, /\.character-running-panel\s*>\s*summary:focus-visible/)
  assert.match(css, /\.character-state-card\s*\{/)
  assert.match(css, /\.character-state-rows\s*\{/)
  assert.match(css, /\.character-local-stage-body\s*\{[^}]*overflow:\s*auto/)
  assert.match(css, /\.character-local-stage\.character-stage\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\) auto/)
  assert.doesNotMatch(css, /\.character-local-stage\s*>\s*\.character-state-panel/)
  assert.doesNotMatch(css, /margin:\s*132px 0 12px 24px/)
  assert.match(css, /\.character-local-quality\s*\{[^}]*position:\s*static/)
  assert.match(css, /\.character-local-preview\s*\{[^}]*position:\s*relative/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-local-stage-body\s*\{[^}]*align-items:\s*stretch/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-local-preview\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0/)
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.character-local-stage-body\s*>\s*\.character-local-quality:has\(> details\[open\]\)[^}]*width:\s*100%/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-stage-body\s*\{[^}]*flex-direction:\s*column/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-stage\.character-stage\s*\{[^}]*grid-template-rows:\s*36px auto auto/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-stage:not\(\.character-local-stage\)\s*\{[^}]*grid-template-rows:\s*36px minmax\(620px, auto\) auto/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-stage\.character-stage\s*>\s*\.character-local-clips-dock[^}]*grid-row:\s*3/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-preview\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-sheet-viewport\s*\{[^}]*padding-top:\s*82px/)
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.character-sheet-inspector-toolbar\s*\{[^}]*left:\s*8px;[^}]*display:\s*grid/)
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.character-sheet-viewport\s*\{[^}]*padding:\s*124px 12px 12px/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-stage-body\s*>\s*\.character-local-quality:has\(> details\[open\]\)[^}]*width:\s*100%/)
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*\.character-local-quality[^}]*position:\s*static/)
  assert.match(css, /\.character-main\[data-character-phase="accepted"\] \.character-release-grid\s*\{[^}]*display:\s*none/)
  assert.match(html, /<details class="character-state-panel character-running-panel[^"]*"[^>]*>\s*<summary>/)
  assert.doesNotMatch(css, /character-(?:running|accepted|topdown)-panel[^{]{0,80}\{\s*display:\s*grid\s*!important/)
  assert.ok(cssDeclares(css, '\\[hidden\\]', 'display:\\s*none\\s*!important'))
  assert.ok(cssDeclares(css, '\\.character-state-panel', 'display:\\s*none'))
  assert.doesNotMatch(localView, /byId\('character-local-stage-title'\)\?\.focus/)
  assert.match(localView, /byId\('character-stage-title'\)\?\.focus\(\)/)

  for (const phase of ['running', 'accepted', 'topdown']) {
    const visible = Object.fromEntries(
      Object.entries(panels).map(([name, tag]) => [name, resolveCharacterPhasePanelDisplay(tag, css, { mode: 'ai', phase })]),
    )
    assert.equal(visible[phase], 'grid', `${phase} must show its own panel`)
    for (const other of Object.keys(panels).filter((name) => name !== phase)) {
      assert.equal(visible[other], 'none', `${phase} must hide ${other}`)
    }
  }
  for (const leftover of ['running', 'accepted', 'topdown', 'setup', undefined]) {
    for (const [name, tag] of Object.entries(panels)) {
      assert.equal(
        resolveCharacterPhasePanelDisplay(tag, css, { mode: 'local', phase: leftover }),
        'none',
        `Local leftover ${leftover} must hide ${name}`,
      )
    }
  }
})

async function waitForSharedResult(resultMod, predicate, steps = 20) {
  let snap = resultMod.readSharedCharacterResultSnapshot()
  for (let i = 0; i < steps; i += 1) {
    snap = resultMod.readSharedCharacterResultSnapshot()
    if (predicate(snap)) return snap
    await Promise.resolve()
  }
  throw new Error(`waitForSharedResult timed out after ${steps} steps: ${JSON.stringify({
    owner: snap?.owner ?? null,
    playable: snap?.playable ?? null,
    exportUnlocked: snap?.exportUnlocked ?? null,
    bindKey: snap?.bindKey ?? null,
  })}`)
}

function htmlParentOfId(html, id) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const stack = []
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^>]*)>/g
  let match
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('<!--')) continue
    const name = match[1].toLowerCase()
    const attrs = match[2] || ''
    const closing = match[0].startsWith('</')
    const selfClosing = /\/\s*>$/.test(match[0]) || voidTags.has(name)
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) {
          stack.length = i
          break
        }
      }
      continue
    }
    const idMatch = /id=/.test(attrs) ? attrs.match(/id=("[^"]+"|'[^']+')/) : null
    const classMatch = /class=/.test(attrs) ? attrs.match(/class=("[^"]+"|'[^']+')/) : null
    const elId = idMatch ? idMatch[1].slice(1, -1) : ''
    const className = classMatch ? classMatch[1].slice(1, -1) : ''
    if (elId === id) return stack.at(-1) || null
    if (!selfClosing) stack.push({ name, id: elId, className })
  }
  return null
}

function createCharacterResultTestDocument(advancedControls = []) {
  const nodes = new Map()
  const createNode = (id = '', tag = 'div') => {
    const attrs = new Map()
    const children = []
    const classItems = new Set()
    const listeners = new Map()
    const node = {
      id,
      tagName: String(tag).toUpperCase(),
      hidden: false,
      inert: false,
      disabled: false,
      tabIndex: 0,
      textContent: '',
      value: '',
      checked: false,
      type: '',
      multiple: false,
      href: '',
      src: '',
      alt: '',
      width: 96,
      height: 96,
      children,
      parentElement: { clientWidth: 960, clientHeight: 500 },
      dataset: {},
      style: {},
      options: [],
      classList: {
        toggle(name, force) {
          if (force === false) classItems.delete(name)
          else if (force === true) classItems.add(name)
          else if (classItems.has(name)) classItems.delete(name)
          else classItems.add(name)
        },
        contains(name) { return classItems.has(name) },
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null
      },
      setAttribute(name, value) {
        attrs.set(name, String(value))
        if (name === 'src') node.src = String(value)
        if (name === 'href') node.href = String(value)
        if (name === 'tabindex') node.tabIndex = Number(value)
      },
      removeAttribute(name) {
        attrs.delete(name)
        if (name === 'src') node.src = ''
        if (name === 'href') node.href = ''
        if (name === 'tabindex') node.tabIndex = 0
      },
      replaceChildren(...next) {
        children.splice(0, children.length, ...next)
        node.textContent = next.map((child) => child.textContent || '').join('')
      },
      append(...next) {
        children.push(...next)
        if (node.tagName === 'SELECT') {
          for (const child of next) {
            if (child && child.tagName === 'OPTION' && !node.options.includes(child)) node.options.push(child)
          }
        }
        node.textContent = children.map((child) => child.textContent || '').join('')
      },
      querySelector(selector) {
        const tag = String(selector).trim().toLowerCase()
        return children.find((child) => String(child.tagName).toLowerCase() === tag) ?? null
      },
      querySelectorAll(selector) {
        const parts = String(selector).split(',').map((part) => part.trim()).filter(Boolean)
        const descendants = []
        const walk = (current) => {
          for (const child of current.children || []) {
            descendants.push(child)
            walk(child)
          }
        }
        walk(node)
        return descendants.filter((child) => parts.some((part) => {
          const tokens = part.split(/\s+/)
          if (tokens.length === 2 && tokens[0].startsWith('#')) {
            return node.id === tokens[0].slice(1) && String(child.tagName).toLowerCase() === tokens[1]
          }
          if (part.startsWith('.')) return String(child.className || '') === part.slice(1)
          return String(child.tagName).toLowerCase() === part
        }))
      },
      addEventListener(type, handler) {
        const list = listeners.get(type) || []
        list.push(handler)
        listeners.set(type, list)
      },
      dispatchEvent(event) {
        const type = event?.type
        for (const handler of listeners.get(type) || []) handler({ ...event, currentTarget: node, target: node, preventDefault() {} })
      },
      click() {
        node.dispatchEvent({ type: 'click' })
      },
      change() {
        node.dispatchEvent({ type: 'change' })
      },
      focus() {},
      getContext() {
        return {
          canvas: node,
          clearRect() {},
          fillRect() {},
          drawImage() {},
          beginPath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
          getImageData() { return { data: new Uint8ClampedArray(4) } },
          imageSmoothingEnabled: false,
          fillStyle: '',
          strokeStyle: '',
        }
      },
    }
    Object.defineProperty(node, 'selectedIndex', {
      get() {
        return node.options.findIndex((option) => option.value === node.value)
      },
      set(index) {
        const option = node.options[Number(index)]
        if (option) node.value = option.value
      },
      configurable: true,
    })
    Object.defineProperty(node, 'selectedOptions', {
      get() {
        if (node.multiple) return node.options.filter((option) => option.selected)
        const option = node.options.find((item) => item.value === node.value)
        return option ? [option] : []
      },
    })
    if (id) nodes.set(id, node)
    return node
  }
  const ids = [
    'character-local-preview', 'character-local-canvas', 'character-accepted-image',
    'character-sheet-inspector', 'character-sheet-viewport', 'character-sheet-size',
    'character-sheet-zoom-fit-button', 'character-sheet-zoom-actual-button',
    'character-sheet-zoom-double-button', 'character-sheet-zoom-quad-button', 'character-sheet-open-original',
    'character-local-quality', 'character-local-quality-status', 'character-local-quality-frames',
    'character-local-quality-repaired', 'character-local-quality-findings', 'character-local-quality-summary',
    'character-local-quality-link', 'character-local-quality-issues', 'character-local-clips',
    'character-local-preview-state', 'character-local-export-pack', 'character-local-export-godot',
    'character-local-export-rpgmaker', 'character-local-export-ocad', 'character-export-link',
    'character-local-export-dialog', 'character-local-export-close', 'character-advanced-config',
    'studio-character-view', 'character-local-entry', 'character-ai-entry',
    'character-flow-title', 'character-local-source-title', 'character-local-workspace',
    'character-local-advanced-form',
    'character-result-error', 'character-accepted-retry', 'character-release-pack',
    'character-release-godot', 'character-release-rpgmaker', 'character-release-ocad',
    'character-accepted-card-kicker', 'character-accepted-card-detail', 'character-placeholder',
    'character-primary-action', 'character-regenerate-action', 'character-description',
    'character-model',
    'character-replace-help', 'character-workspace-title',
    'character-stage-title', 'character-local-primary', 'character-top-status',
    'character-decoy-button', 'character-decoy-select', 'character-decoy-textarea',
    'character-release-grid', 'character-ai-evidence-disclosure', 'character-local-stage-body',
    'character-evidence-summary-status', 'character-evidence-provider', 'character-evidence-model',
    'character-evidence-review-id', 'character-evidence-raw-sha',
  ]
  for (const id of ids) {
    const tag = id.includes('canvas')
      ? 'canvas'
      : id.includes('image')
        ? 'img'
        : id.includes('entry') || id.includes('retry') || id.includes('action') || id.endsWith('-button') || id === 'character-local-primary'
          ? 'button'
          : id.endsWith('-select') || id === 'character-model'
            ? 'select'
            : id.endsWith('-textarea')
              ? 'textarea'
              : 'div'
    createNode(id, tag)
  }
  const config = nodes.get('character-advanced-config')
  const form = nodes.get('character-local-advanced-form')
  form.tagName = 'FORM'
  config.children.push(form)
  form.parentElement = config
  const sealedControls = []
  for (const spec of advancedControls) {
    const control = createNode(spec.id, spec.tag)
    control.type = spec.type || ''
    control.multiple = Boolean(spec.multiple)
    control.checked = Boolean(spec.checked)
    control.options = (spec.options || []).map((option) => ({
      value: option.value,
      selected: Boolean(option.selected),
      tagName: 'OPTION',
    }))
    control.value = spec.value ?? ''
    form.children.push(control)
    control.parentElement = form
    sealedControls.push(control)
  }
  form.controls = sealedControls
  config.controls = sealedControls
  const stageBody = nodes.get('character-local-stage-body')
  stageBody.className = 'character-local-stage-body'
  const evidence = nodes.get('character-ai-evidence-disclosure')
  evidence.className = 'character-ai-evidence-disclosure'
  evidence.parentElement = stageBody
  stageBody.children.push(evidence)
  nodes.get('character-release-grid').hidden = true
  const decoyButton = nodes.get('character-decoy-button')
  const decoySelect = nodes.get('character-decoy-select')
  const decoyTextarea = nodes.get('character-decoy-textarea')
  decoyButton.disabled = false
  decoyButton.tabIndex = 3
  decoySelect.disabled = false
  decoySelect.tabIndex = 4
  decoySelect.value = 'outside'
  decoyTextarea.disabled = false
  decoyTextarea.tabIndex = 5
  decoyTextarea.value = 'keep'
  const pipelineSteps = ['raw', 'matte', 'count', 'evidence', 'quality', 'preview', 'accept']
  for (const step of pipelineSteps) {
    const item = createNode(`character-pipeline-${step}`, 'li')
    item.dataset.pipelineStep = step
    item.setAttribute('data-pipeline-step', step)
    const title = createNode('', 'span')
    const label = createNode('', 'small')
    item.append(title, label)
  }
  const exportDialog = nodes.get('character-local-export-dialog')
  exportDialog.open = false
  exportDialog.showModal = function showModal() { this.open = true }
  exportDialog.close = function close() { this.open = false }
  const matchAll = (selector) => {
    const parts = String(selector).split(',').map((part) => part.trim()).filter(Boolean)
    const all = [...nodes.values()]
    const found = []
    for (const part of parts) {
      const tokens = part.split(/\s+/)
      if (tokens.length === 2 && tokens[0].startsWith('#')) {
        const root = nodes.get(tokens[0].slice(1))
        if (root) found.push(...root.querySelectorAll(tokens[1]))
      } else if (part === '[data-pipeline-step]') {
        found.push(...all.filter((node) => node.dataset?.pipelineStep != null))
      } else if (part.startsWith('#')) {
        const node = nodes.get(part.slice(1))
        if (node) found.push(node)
      } else {
        found.push(...all.filter((node) => String(node.tagName).toLowerCase() === part))
      }
    }
    return [...new Set(found)]
  }
  return {
    nodes,
    getElementById(id) { return nodes.get(id) ?? null },
    createElement(tag) { return createNode('', tag) },
    querySelectorAll: matchAll,
  }
}

function sampleAnimations(overrides = {}) {
  return {
    frame_size: { w: 32, h: 32 },
    sheet_size: { w: 64, h: 32 },
    animations: {
      idle_down: { frames: [0], fps: 8, display_label: 'Idle' },
      walk_down: { frames: [1], fps: 8, display_label: 'Walk' },
    },
    ...overrides,
  }
}

function sheetImage(url, width = 64, height = 32) {
  return { src: url, width, height, naturalWidth: width, naturalHeight: height }
}

function sampleDebugReport() {
  return {
    validation: { status: 'pass', frame_count: 2, warnings: [], blocking_errors: [] },
  }
}

function realAcceptResponse(saved = 'accepted') {
  const publicationId = 'accepted_v1_job_ai'
  const urls = Object.fromEntries(Object.entries({
    result_url: 'metadata.json',
    raw_provider_output_url: 'raw_provider_output.png',
    background_removed_provider_output_url: 'background_removed_provider_output.png',
    background_quality_url: 'background_quality.json',
    background_review_url: 'background_review.json',
    background_contract_masks_url: 'background_contract_masks.json',
    background_preview_url: 'background_preview.png',
    background_spill_overlay_url: 'background_spill_overlay.png',
    background_sure_background_mask_url: 'background_sure_background_mask.png',
    background_unknown_band_mask_url: 'background_unknown_band_mask.png',
    background_sure_foreground_mask_url: 'background_sure_foreground_mask.png',
    background_alpha_estimate_url: 'background_alpha_estimate.png',
    background_foreground_reconstruction_url: 'background_foreground_reconstruction.png',
    source_url: 'source.png',
    normalized_sheet_url: 'normalized_sheet.png',
    animations_url: 'animations.json',
    debug_report_url: 'debug_report.json',
    metadata_url: 'metadata.json',
    editor_metadata_url: 'editor_metadata.json',
    generation_release_gate_url: 'generation_release_gate.json',
    manual_acceptance_url: 'manual_acceptance.json',
    generation_url: 'generation.json',
    zip_url: 'character_pack.zip',
    godot_npc_zip_url: 'godot_npc_pack.zip',
    rpgmaker_zip_url: 'rpgmaker_pack.zip',
    ocad_zip_url: 'ocad_pack.zip',
  }).map(([field, file]) => [field, `/generated/${publicationId}/${file}`]))
  return {
    mode: 'full_sheet_manual_acceptance_v1',
    status: 'done',
    saved,
    source_job_id: 'job_ai',
    publication_id: publicationId,
    manual_acceptance_status: 'accepted',
    human_reviewed_issue_count: 0,
    manual_acceptance_sha256: '7'.repeat(64),
    provider_calls_used: 0,
    provider_call_budget: { planned_provider_calls: 0, max_provider_calls: 0, used_provider_calls: 0 },
    ...urls,
  }
}

function jsonResponse(body, { status = 200, ok = true } = {}) {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body))
  return {
    ok,
    status,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? String(bytes.length) : null } },
    async arrayBuffer() { return bytes.buffer },
  }
}

function bytesResponse(bytes, { status = 200, ok = true } = {}) {
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return new Response(copy, {
    status,
    headers: { 'content-length': String(copy.byteLength) },
  })
}

async function acceptedSourceFixture() {
  const bytes = new TextEncoder().encode('verified accepted AI raw source')
  return {
    bytes,
    binding: Object.freeze({
      expectedRawProviderOutputSha256: await sha256Bytes(bytes),
    }),
  }
}

test('shared Character result renderer isolates deferred images and real Accept responses', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const { STRICT_ACCEPT_URL_FIELDS } = await import('../src/ui/studio/characterApi.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const { initStudioCharacter, inspectStudioCharacterState, switchStudioCharacterSource } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  const advancedControls = parseCharacterAdvancedConfigControls(html)
  assert.ok(advancedControls.length > 0)
  assert.ok(advancedControls.every((spec) => spec.id.startsWith('character-advanced-')))
  const document = createCharacterResultTestDocument(advancedControls)
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document

  const localResult = {
    job: {
      id: 'job_local',
      status: 'done',
      normalized_sheet_url: '/generated/job_local/normalized_sheet.png',
      debug_report_url: '/generated/job_local/debug_report.json',
      zip_url: '/generated/job_local/character_pack.zip',
    },
    animations: sampleAnimations(),
    debugReport: sampleDebugReport(),
  }
  const sheetLoads = []
  localView.seedStudioLocalCharacterCompleteForTest(localResult)
  resultMod.setCharacterResultImageLoader((url) => {
    sheetLoads.push(url)
    return Promise.resolve(sheetImage(url))
  })
  initStudioCharacter({ serviceAvailable: true })
  switchStudioCharacterSource('local')
  localView.renderStudioCharacterLocal()
  const afterInit = await waitForSharedResult(resultMod, (snap) => snap.owner === 'local' && snap.playable)
  assert.deepEqual(localView.inspectStudioLocalCharacterState(), {
    phase: 'complete',
    jobId: 'job_local',
    hasResult: true,
    status: 'done',
    failureReasonKey: null,
  })
  assert.equal(afterInit.owner, 'local')
  assert.equal(afterInit.playable, true)
  assert.equal(afterInit.previewStateHidden, false)
  assert.equal(afterInit.previewLabelledBy, 'character-local-preview-state')
  assert.equal(afterInit.qualityHidden, false)
  assert.equal(afterInit.exportUnlocked, true)
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame
  const scheduledFrames = new Map()
  const canceledFrames = []
  let nextFrameId = 1
  try {
    globalThis.requestAnimationFrame = (callback) => {
      const id = nextFrameId
      nextFrameId += 1
      scheduledFrames.set(id, callback)
      return id
    }
    globalThis.cancelAnimationFrame = (id) => {
      canceledFrames.push(id)
      scheduledFrames.delete(id)
    }
    const beforeRouteToggle = resultMod.readSharedCharacterResultSnapshot()
    const sheetLoadsBeforeRouteToggle = sheetLoads.length
    resultMod.setSharedCharacterResultRouteActive(true)
    assert.deepEqual([...scheduledFrames.keys()], [1])
    resultMod.setSharedCharacterResultRouteActive(false)
    assert.deepEqual(canceledFrames, [1])
    assert.equal(scheduledFrames.size, 0)
    const offRoute = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(offRoute.owner, beforeRouteToggle.owner)
    assert.equal(offRoute.bindKey, beforeRouteToggle.bindKey)
    assert.equal(offRoute.previewState, beforeRouteToggle.previewState)
    resultMod.setSharedCharacterResultRouteActive(true)
    assert.deepEqual([...scheduledFrames.keys()], [2])
    const afterRouteReturn = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(afterRouteReturn.owner, beforeRouteToggle.owner)
    assert.equal(afterRouteReturn.bindKey, beforeRouteToggle.bindKey)
    assert.equal(afterRouteReturn.previewState, beforeRouteToggle.previewState)
    assert.equal(sheetLoads.length, sheetLoadsBeforeRouteToggle)
  } finally {
    resultMod.setSharedCharacterResultRouteActive(false)
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame
    if (previousCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame
    else globalThis.cancelAnimationFrame = previousCancelAnimationFrame
    resultMod.setSharedCharacterResultRouteActive(true)
  }
  const bindGenerationBeforeLocalRerender = resultMod.getSharedCharacterBindGeneration()
  const sheetLoadsBeforeLocalRerender = sheetLoads.length
  localView.renderStudioCharacterLocal()
  await Promise.resolve()
  assert.equal(resultMod.getSharedCharacterBindGeneration(), bindGenerationBeforeLocalRerender)
  assert.equal(sheetLoads.length, sheetLoadsBeforeLocalRerender)
  const exportLink = document.getElementById('character-export-link')
  const exportDialog = document.getElementById('character-local-export-dialog')
  assert.notEqual(exportLink.getAttribute('aria-disabled'), 'true')
  assert.equal(exportDialog.open, false)
  exportLink.click()
  assert.equal(exportDialog.open, true)
  resultMod.closeSharedCharacterExportDialog()
  assert.equal(exportDialog.open, false)
  assertLegacyReleaseSurfaceHidden(document)
  const liveControls = queryAdvancedConfigControls(document.getElementById('character-advanced-config'))
  assert.equal(liveControls.length, advancedControls.length)
  assert.equal(ADVANCED_CONFIG_CONTROL_SELECTOR, LOCAL_ADVANCED_CONFIG_CONTROL_SELECTOR)
  const decoySnapshot = {
    button: snapshotSealedControl(document.nodes.get('character-decoy-button')),
    select: snapshotSealedControl(document.nodes.get('character-decoy-select')),
    textarea: snapshotSealedControl(document.nodes.get('character-decoy-textarea')),
  }
  assert.equal(document.nodes.get('character-advanced-frame').options.length, 64)
  assert.ok(document.nodes.get('character-advanced-locks').options.length > 1)
  const frame = document.nodes.get('character-advanced-frame')
  frame.value = '7'
  frame.change()
  const locks = document.nodes.get('character-advanced-locks')
  for (const option of locks.options) option.selected = option.value === 'walk_down'
  locks.change()
  localView.seedStudioLocalCharacterCompleteForTest(localResult)
  const sealedNodes = advancedControls.map((spec) => document.nodes.get(spec.id))
  assert.ok(sealedNodes.every(Boolean))
  assert.equal(sealedNodes.length, liveControls.length)
  const localControlSnapshots = Object.fromEntries(sealedNodes.map((control) => [control.id, snapshotSealedControl(control)]))
  const localSettingsSnapshot = structuredClone(localView.getStudioLocalCharacterAdvancedSettings())
  const localIsolationSnapshot = localView.inspectStudioLocalCharacterIsolationSnapshot()
  assert.equal(localControlSnapshots['character-advanced-frame'].value, '7')
  assert.deepEqual(localControlSnapshots['character-advanced-locks'].selectedValues, ['walk_down'])
  assert.equal(localSettingsSnapshot.lockedAnimations.includes('walk_down'), true)

  document.nodes.get('character-ai-entry').click()
  assert.equal(inspectStudioCharacterState().mode, 'ai')
  assert.deepEqual(localView.inspectStudioLocalCharacterState(), {
    phase: 'complete',
    jobId: 'job_local',
    hasResult: true,
    status: 'done',
    failureReasonKey: null,
  })
  const afterAiSwitch = resultMod.readSharedCharacterResultSnapshot()
  assert.notEqual(afterAiSwitch.owner, 'local')
  assert.equal(afterAiSwitch.playable, false)
  assert.equal(afterAiSwitch.exportUnlocked, false)
  assert.equal(document.nodes.get('character-advanced-config').hidden, false)
  assert.equal(document.nodes.get('character-advanced-config').inert, false)
  assert.equal(document.nodes.get('character-local-advanced-form').hidden, false)
  assert.equal(document.nodes.get('character-local-advanced-form').inert, false)
  assert.equal(document.getElementById('character-ai-processing-summary'), null)
  for (const control of sealedNodes) {
    const before = localControlSnapshots[control.id]
    assert.equal(control.disabled, before.disabled, `${control.id} must keep the shared form state in AI`)
    assert.equal(control.tabIndex, before.tabIndex, `${control.id} must remain in the shared form tab order`)
  }
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-button')), decoySnapshot.button)
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-select')), decoySnapshot.select)
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-textarea')), decoySnapshot.textarea)
  assert.equal(localView.canMutateStudioCharacterLocalParameters(), true)
  assert.deepEqual(localView.getStudioLocalCharacterAdvancedSettings(), localSettingsSnapshot)
  assert.deepEqual(localView.inspectStudioLocalCharacterIsolationSnapshot(), localIsolationSnapshot)

  sheetLoads.length = 0
  document.nodes.get('character-local-entry').click()
  assert.equal(inspectStudioCharacterState().mode, 'local')
  const afterLocalReturn = await waitForSharedResult(resultMod, (snap) => snap.owner === 'local' && snap.playable)
  assert.equal(afterLocalReturn.owner, 'local')
  assert.equal(afterLocalReturn.playable, true)
  assert.equal(afterLocalReturn.exportPackHref, localResult.job.zip_url)
  assert.deepEqual(sheetLoads, [localResult.job.normalized_sheet_url])
  assert.equal(document.nodes.get('character-advanced-config').hidden, false)
  assert.equal(document.nodes.get('character-advanced-config').inert, false)
  assert.equal(document.nodes.get('character-local-advanced-form').hidden, false)
  assert.equal(document.nodes.get('character-local-advanced-form').inert, false)
  assert.equal(document.getElementById('character-ai-processing-summary'), null)
  for (const control of sealedNodes) {
    const before = localControlSnapshots[control.id]
    assert.equal(control.disabled, before.disabled, `${control.id} disabled must restore`)
    assert.equal(control.tabIndex, before.tabIndex, `${control.id} tabIndex must restore`)
    if (before.type === 'file' || before.type === 'button') continue
    assert.equal(control.value, before.value, `${control.id} value must restore`)
    assert.equal(control.checked, before.checked, `${control.id} checked must restore`)
    if (before.selectedIndex !== undefined && before.selectedIndex >= 0) {
      assert.equal(control.selectedIndex, before.selectedIndex, `${control.id} selectedIndex must restore`)
    }
    if (before.selectedValues) {
      assert.deepEqual(snapshotSealedControl(control).selectedValues, before.selectedValues, `${control.id} selectedValues must restore`)
    }
  }
  assert.equal(frame.value, '7')
  assert.equal(frame.selectedIndex, 7)
  assert.deepEqual(snapshotSealedControl(locks).selectedValues, ['walk_down'])
  assert.deepEqual(localView.getStudioLocalCharacterAdvancedSettings(), localSettingsSnapshot)
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-button')), decoySnapshot.button)
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-select')), decoySnapshot.select)
  assert.deepEqual(snapshotSealedControl(document.nodes.get('character-decoy-textarea')), decoySnapshot.textarea)
  const phaseTags = {
    running: openingTagForClassToken(html, 'character-running-panel'),
    accepted: openingTagForClassToken(html, 'character-accepted-panel'),
    topdown: openingTagForClassToken(html, 'character-topdown-panel'),
  }
  for (const [name, tag] of Object.entries(phaseTags)) {
    assert.equal(
      resolveCharacterPhasePanelDisplay(tag, css, {
        mode: 'local',
        phase: document.nodes.get('studio-character-view').dataset.characterPhase,
      }),
      'none',
      `AI then Local must hide ${name}`,
    )
  }

  let resolveLocalImage
  resultMod.setCharacterResultImageLoader(() => new Promise((resolve) => { resolveLocalImage = resolve }))
  const staleLocalBind = resultMod.bindSharedCharacterResult(
    resultMod.createLocalCompleteResultPresentation(localResult),
    { owner: 'local' },
  )
  switchStudioCharacterSource('ai')
  const aiRawReviewUrl = '/generated/job_ai/raw_provider_output.png'
  await resultMod.bindSharedCharacterResult(resultMod.createAiReviewResultPresentation({
    raw_provider_output_url: aiRawReviewUrl,
    normalized_sheet_url: '/generated/job_ai/normalized_sheet.png',
  }), { owner: 'ai' })
  resolveLocalImage(sheetImage(localResult.job.normalized_sheet_url))
  await staleLocalBind
  const afterStaleLocal = resultMod.readSharedCharacterResultSnapshot()
  assert.equal(afterStaleLocal.owner, 'ai')
  assert.equal(afterStaleLocal.imageAltKey, 'character.reviewSheetAlt')
  assert.equal(afterStaleLocal.imageSrc, aiRawReviewUrl)
  assert.notEqual(afterStaleLocal.imageSrc, localResult.job.normalized_sheet_url)
  assert.equal(afterStaleLocal.playable, false)
  assert.equal(afterStaleLocal.inspectorHidden, false)
  assert.equal(afterStaleLocal.previewStateHidden, true)
  assert.equal(afterStaleLocal.previewLabelledBy, 'character-sheet-inspector-title')
  assert.equal(afterStaleLocal.sheetZoom, 'actual')
  assert.equal(afterStaleLocal.imageStyleWidth, '96px')
  assert.equal(hrefOf(document.getElementById('character-sheet-open-original')), aiRawReviewUrl)
  assert.equal(resultMod.setSharedCharacterSheetZoom('quad'), true)
  assert.equal(resultMod.readSharedCharacterResultSnapshot().imageStyleWidth, '384px')
  assert.equal(document.getElementById('character-sheet-zoom-quad-button').getAttribute('aria-pressed'), 'true')
  assert.equal(resultMod.setSharedCharacterSheetZoom('actual'), true)
  assert.equal(resultMod.setSharedCharacterSheetZoom('unsupported'), false)
  assert.deepEqual(localView.inspectStudioLocalCharacterState(), {
    phase: 'complete',
    jobId: 'job_local',
    hasResult: true,
    status: 'done',
    failureReasonKey: null,
  })

  const freshAccepted = realAcceptResponse('accepted')
  const restoredAccepted = realAcceptResponse('already_accepted')
  assert.ok(Object.hasOwn(STRICT_ACCEPT_URL_FIELDS, 'debug_report_url'))
  assert.equal(freshAccepted.debug_report_url, restoredAccepted.debug_report_url)
  assert.equal(freshAccepted.animations_url, restoredAccepted.animations_url)
  assert.equal(freshAccepted.zip_url, restoredAccepted.zip_url)
  assert.deepEqual(
    Object.keys(freshAccepted).filter((key) => key.endsWith('_url')).sort(),
    Object.keys(restoredAccepted).filter((key) => key.endsWith('_url')).sort(),
  )
  const requested = []
  const artifacts = await resultMod.loadAcceptedCharacterResultArtifacts(restoredAccepted, {
    fetchImpl: async (url, options) => {
      requested.push({ url: String(url), method: options?.method || 'GET' })
      assert.notEqual(options?.method, 'POST')
      assert.equal(String(url).includes('/api/process-sheet'), false)
      if (String(url).includes('animations.json')) return jsonResponse(sampleAnimations())
      if (String(url).includes('debug_report.json')) return jsonResponse(sampleDebugReport())
      throw new Error(`unexpected fetch ${url}`)
    },
  })
  assert.equal(artifacts.missingQualityUrl, false)
  assert.ok(artifacts.animations)
  assert.ok(artifacts.debugReport)
  assert.deepEqual(requested.map((entry) => entry.url).sort(), [
    restoredAccepted.animations_url,
    restoredAccepted.debug_report_url,
  ].sort())
  assert.equal(typeof resultMod.createAiAcceptedResultPresentation, 'undefined')
  const acceptedArtifactsDoNotPublish = resultMod.readSharedCharacterResultSnapshot()
  assert.equal(acceptedArtifactsDoNotPublish.owner, 'ai')
  assert.equal(acceptedArtifactsDoNotPublish.playable, false)
  assert.equal(acceptedArtifactsDoNotPublish.exportUnlocked, false)

  resultMod.setCharacterResultImageLoader((url) => Promise.resolve(sheetImage(url)))
  switchStudioCharacterSource('local')
  const afterAcceptedArtifactRead = await waitForSharedResult(resultMod, (snap) => snap.owner === 'local' && snap.playable)
  assert.equal(afterAcceptedArtifactRead.owner, 'local')
  assert.equal(afterAcceptedArtifactRead.playable, true)
  assert.equal(afterAcceptedArtifactRead.exportPackHref, localResult.job.zip_url)
  assert.deepEqual(localView.inspectStudioLocalCharacterState(), {
    phase: 'complete',
    jobId: 'job_local',
    hasResult: true,
    status: 'done',
    failureReasonKey: null,
  })

  const rejected = []
  const onReject = (error) => rejected.push(error)
  process.once('unhandledRejection', onReject)
  resultMod.setCharacterResultImageLoader(() => Promise.reject(Object.assign(new Error('image failed'), { code: 'request_failed' })))
  await resultMod.bindSharedCharacterResult(
    resultMod.createLocalCompleteResultPresentation(localResult),
    { owner: 'local' },
  )
  await new Promise((resolve) => setImmediate(resolve))
  process.removeListener('unhandledRejection', onReject)
  assert.equal(rejected.length, 0)
  assert.deepEqual(localView.inspectStudioLocalCharacterState(), {
    phase: 'complete',
    jobId: 'job_local',
    hasResult: true,
    status: 'done',
    failureReasonKey: null,
  })
  const afterReject = resultMod.readSharedCharacterResultSnapshot()
  assert.equal(afterReject.owner, 'local')
  assert.equal(afterReject.exportPackHref, localResult.job.zip_url)
  assert.equal(afterReject.qualityHidden, false)
  assert.equal(afterReject.playable, false)
  let retryImageLoads = 0
  resultMod.setCharacterResultImageLoader((url) => {
    retryImageLoads += 1
    return Promise.resolve(sheetImage(url))
  })
  localView.renderStudioCharacterLocal()
  const afterImageRetry = await waitForSharedResult(resultMod, (snap) => snap.owner === 'local' && snap.playable)
  assert.equal(retryImageLoads, 1)
  assert.equal(afterImageRetry.exportUnlocked, true)
  assert.equal(document.nodes.get('character-result-error').hidden, true)

  resultMod.setCharacterResultImageLoader(null)
  const missing = await resultMod.loadAcceptedCharacterResultArtifacts({ zip_url: '/generated/accepted_v1_job_ai/character_pack.zip' })
  assert.equal(missing.error.code, 'missing_animations_url')
  await assert.rejects(
    () => resultMod.loadAcceptedCharacterResultArtifacts(restoredAccepted, {
      fetchImpl: async () => jsonResponse('not-json', { status: 200 }),
    }),
    /invalid JSON|malformed|Unexpected/,
  )
  await assert.rejects(
    () => resultMod.loadAcceptedCharacterResultArtifacts(restoredAccepted, {
      fetchImpl: async () => jsonResponse({ error: 'missing' }, { status: 404, ok: false }),
    }),
    /HTTP 404|job_not_found|http_error/,
  )
  await assert.rejects(
    () => resultMod.loadAcceptedCharacterResultArtifacts(restoredAccepted, {
      fetchImpl: async () => jsonResponse({ animations: {} }),
    }),
    /malformed|invalid_animations/,
  )

  switchStudioCharacterSource('ai')
  document.nodes.get('character-local-export-dialog').open = false
  document.nodes.get('character-export-link').click()
  assert.equal(document.nodes.get('character-local-export-dialog').open, false)
  assert.equal(resultMod.openSharedCharacterExportDialog(), false)

  assert.match(
    html,
    /id="character-workspace-title"[^>]*data-studio-i18n="character.headerTitle"/,
  )

  resultMod.stopSharedCharacterPreview()
  resultMod.setCharacterResultDocument(null)
})

function fakePngFile(name = 'hero.png') {
  return {
    name,
    type: 'image/png',
    size: 8,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
  }
}

test('Local Character abandons decode/calibration and keeps a submitted Job after leaving Local', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const { initStudioCharacter, switchStudioCharacterSource } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousUrl = globalThis.URL
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  globalThis.URL = {
    createObjectURL() { return 'blob:local-test' },
    revokeObjectURL() {},
  }
  try {
    initStudioCharacter({ serviceAvailable: true })
    switchStudioCharacterSource('local')

    let resolveDecode
    localView.setLocalCharacterImageDimensionLoader(() => new Promise((resolve, reject) => { resolveDecode = { resolve, reject } }))
    const decodePromise = localView.selectStudioLocalCharacterSourceForTest(fakePngFile())
    assert.equal(localView.inspectStudioLocalCharacterIsolationSnapshot().busy, 'decode')
    switchStudioCharacterSource('ai')
    resolveDecode.resolve({ width: 32, height: 32 })
    await decodePromise
    switchStudioCharacterSource('local')
    const afterDecode = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterDecode.busy, null)
    assert.equal(afterDecode.fileName, null)
    assert.equal(afterDecode.sourceUrl, null)
    assert.equal(afterDecode.dimensions, null)
    assert.equal(afterDecode.error, null)
    assert.equal(localView.inspectStudioLocalCharacterState().phase, 'empty')
    assert.equal(localView.inspectStudioLocalCharacterState().hasResult, false)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), true)

    switchStudioCharacterSource('local')
    localView.setLocalCharacterImageDimensionLoader(() => new Promise((resolve, reject) => { resolveDecode = { resolve, reject } }))
    const decodeRejectPromise = localView.selectStudioLocalCharacterSourceForTest(fakePngFile('reject.png'))
    switchStudioCharacterSource('ai')
    resolveDecode.reject(new Error('decode failed'))
    await decodeRejectPromise
    switchStudioCharacterSource('local')
    const afterDecodeReject = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterDecodeReject.busy, null)
    assert.equal(afterDecodeReject.fileName, null)
    assert.equal(afterDecodeReject.sourceUrl, null)
    assert.equal(afterDecodeReject.dimensions, null)
    assert.equal(afterDecodeReject.error, null)
    assert.equal(localView.inspectStudioLocalCharacterState().phase, 'empty')

    localView.seedStudioLocalCharacterReadyForTest({
      file: fakePngFile(),
      processingMode: 'advanced',
      sourceLayout: 'fixed_region_motion_v0',
    })
    let resolveCalib
    localView.setLocalCharacterCalibrationDecoder(() => new Promise((resolve, reject) => { resolveCalib = { resolve, reject } }))
    const calibPromise = localView.startStudioLocalCharacterCalibrationForTest()
    assert.equal(localView.inspectStudioLocalCharacterIsolationSnapshot().calibration.busy, true)
    switchStudioCharacterSource('ai')
    resolveCalib.resolve({ width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4) })
    await calibPromise
    switchStudioCharacterSource('local')
    const afterCalib = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterCalib.calibration.busy, false)
    assert.equal(afterCalib.calibration.hasPreview, false)
    assert.equal(afterCalib.calibration.hasReport, false)
    assert.equal(afterCalib.error, null)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), true)

    localView.seedStudioLocalCharacterReadyForTest({
      file: fakePngFile(),
      processingMode: 'advanced',
      sourceLayout: 'fixed_region_motion_v0',
    })
    localView.setLocalCharacterCalibrationDecoder(() => new Promise((resolve, reject) => { resolveCalib = { resolve, reject } }))
    const calibRejectPromise = localView.startStudioLocalCharacterCalibrationForTest()
    switchStudioCharacterSource('ai')
    resolveCalib.reject(new Error('calibration failed'))
    await calibRejectPromise
    switchStudioCharacterSource('local')
    const afterCalibReject = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterCalibReject.calibration.busy, false)
    assert.equal(afterCalibReject.calibration.hasPreview, false)
    assert.equal(afterCalibReject.calibration.hasReport, false)
    assert.equal(afterCalibReject.error, null)

    const jobResponse = (payload) => {
      const bytes = new TextEncoder().encode(JSON.stringify(payload))
      return {
        ok: true,
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'content-length' ? String(bytes.length) : null } },
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
      }
    }

    localView.seedStudioLocalCharacterReadyForTest({ file: fakePngFile(), processingMode: 'standard' })
    let resolveFailedPost
    let failedPostCount = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/process-sheet')) {
        failedPostCount += 1
        await new Promise((resolve) => { resolveFailedPost = resolve })
        return jobResponse({ id: 'job_local_submit', status: 'failed_quality_gate', reason: 'blocked' })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const failedSubmit = localView.submitStudioLocalCharacterJobForTest()
    assert.equal(localView.inspectStudioLocalCharacterState().phase, 'running')
    switchStudioCharacterSource('ai')
    for (let i = 0; i < 50 && typeof resolveFailedPost !== 'function'; i += 1) await Promise.resolve()
    resolveFailedPost()
    await failedSubmit
    switchStudioCharacterSource('local')
    const afterFailed = localView.inspectStudioLocalCharacterState()
    assert.equal(afterFailed.phase, 'failed')
    assert.equal(afterFailed.jobId, 'job_local_submit')
    assert.equal(failedPostCount, 1)

    localView.seedStudioLocalCharacterReadyForTest({ file: fakePngFile(), processingMode: 'standard' })
    let resolveSuccessPost
    let successPostCount = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/process-sheet')) {
        successPostCount += 1
        await new Promise((resolve) => { resolveSuccessPost = resolve })
        return jobResponse({ id: 'job_local_ok', status: 'queued' })
      }
      if (String(url).includes('/api/jobs/job_local_ok')) {
        const error = new Error('poll failed')
        error.code = 'request_failed'
        throw error
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const successSubmit = localView.submitStudioLocalCharacterJobForTest()
    switchStudioCharacterSource('ai')
    for (let i = 0; i < 50 && typeof resolveSuccessPost !== 'function'; i += 1) await Promise.resolve()
    resolveSuccessPost()
    await successSubmit
    switchStudioCharacterSource('local')
    const afterSuccess = localView.inspectStudioLocalCharacterState()
    assert.equal(afterSuccess.jobId, 'job_local_ok')
    assert.equal(successPostCount, 1)

    localView.seedStudioLocalCharacterReadyForTest({ file: fakePngFile(), processingMode: 'standard' })
    let rejectBeforeReceipt
    let unknownPostCount = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/process-sheet')) {
        unknownPostCount += 1
        await new Promise((_, reject) => { rejectBeforeReceipt = reject })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const unknownSubmit = localView.submitStudioLocalCharacterJobForTest()
    switchStudioCharacterSource('ai')
    for (let i = 0; i < 50 && typeof rejectBeforeReceipt !== 'function'; i += 1) await Promise.resolve()
    const requestFailed = Object.assign(new Error('network'), { code: 'request_failed' })
    rejectBeforeReceipt(requestFailed)
    await unknownSubmit
    switchStudioCharacterSource('local')
    const afterUnknown = localView.inspectStudioLocalCharacterState()
    assert.equal(afterUnknown.phase, 'submission_unknown')
    assert.equal(afterUnknown.jobId, null)
    assert.equal(unknownPostCount, 1)

    localView.seedStudioLocalCharacterReadyForTest({ file: fakePngFile(), processingMode: 'standard' })
    let resolvePollPost
    let pollPostCount = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/process-sheet')) {
        pollPostCount += 1
        await new Promise((resolve) => { resolvePollPost = resolve })
        return jobResponse({ id: 'job_local_poll', status: 'queued' })
      }
      if (String(url).includes('/api/jobs/job_local_poll')) {
        const error = new Error('observe failed')
        error.code = 'request_failed'
        throw error
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const pollSubmit = localView.submitStudioLocalCharacterJobForTest()
    switchStudioCharacterSource('ai')
    for (let i = 0; i < 50 && typeof resolvePollPost !== 'function'; i += 1) await Promise.resolve()
    resolvePollPost()
    await pollSubmit
    switchStudioCharacterSource('local')
    const afterPoll = localView.inspectStudioLocalCharacterState()
    assert.equal(afterPoll.phase, 'poll_paused')
    assert.equal(afterPoll.jobId, 'job_local_poll')
    assert.equal(afterPoll.status, 'queued')
    assert.equal(pollPostCount, 1)
  } finally {
    globalThis.fetch = previousFetch
    globalThis.URL = previousUrl
    globalThis.document = previousDocument
    localView.setLocalCharacterImageDimensionLoader(null)
    localView.setLocalCharacterCalibrationDecoder(null)
    resultMod.setCharacterResultDocument(null)
  }
})

function hrefOf(node) {
  return node?.getAttribute?.('href') || node?.href || ''
}

function assertLegacyReleaseSurfaceHidden(document) {
  assert.equal(document.getElementById('character-release-grid').hidden, true)
  for (const id of [
    'character-release-pack',
    'character-release-godot',
    'character-release-rpgmaker',
    'character-release-ocad',
  ]) {
    assert.equal(hrefOf(document.getElementById(id)), '', `${id} must stay empty`)
  }
}

test('Accepted AI source enters the exact shared processor and only its downstream Job unlocks Export and Project', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    inspectStudioCharacterState,
    startStudioCharacterAcceptedHydrateForTest,
    getStudioCharacterProjectCandidate,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  resultMod.setCharacterResultImageLoader((url) => Promise.resolve(sheetImage(url)))
  localView.setLocalCharacterImageDimensionLoader(() => ({ width: 4096, height: 4096 }))
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    const network = []
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url)
      const method = options.method || 'GET'
      network.push({ href, method, body: options.body || null })
      if (href === acceptance.raw_provider_output_url) return bytesResponse(source.bytes)
      if (href === acceptance.animations_url) return jsonResponse(sampleAnimations())
      if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
      throw new Error(`unexpected fetch ${href}`)
    }

    await startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
    })

    const aiState = inspectStudioCharacterState()
    const processingSource = localView.getStudioCharacterProcessingSourceState()
    const sharedBeforeProcess = resultMod.readSharedCharacterResultSnapshot()
    const acceptedSourcePresentation = resultMod.getSharedCharacterExportPresentation()
    assert.equal(aiState.processingSourceReady, true)
    assert.equal(aiState.processingSourcePublicationId, acceptance.publication_id)
    assert.equal(processingSource.hasSource, true)
    assert.equal(processingSource.sourceOrigin, 'ai')
    assert.equal(processingSource.sourceProvenance.publicationId, acceptance.publication_id)
    assert.equal(processingSource.phase, 'ready')
    assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'ready')
    assert.equal(Object.hasOwn(document.getElementById('studio-character-view').dataset, 'characterPhase'), false)
    assert.equal(document.getElementById('character-local-advanced-form').hidden, false)
    assert.equal(document.getElementById('character-local-advanced-form').inert, false)
    assert.equal(document.getElementById('character-local-primary').dataset.action, 'build')
    assert.equal(document.getElementById('character-local-primary').disabled, false)
    assert.equal(sharedBeforeProcess.owner, 'ai')
    assert.equal(sharedBeforeProcess.previewHidden, false)
    assert.equal(sharedBeforeProcess.imageHidden, false)
    assert.match(sharedBeforeProcess.imageSrc, /^blob:/)
    assert.equal(sharedBeforeProcess.inspectorHidden, false)
    assert.equal(sharedBeforeProcess.imageAltKey, 'character.acceptedSourceImageAlt')
    assert.equal(acceptedSourcePresentation.status, 'accepted_static')
    assert.equal(acceptedSourcePresentation.acceptedStatic, true)
    assert.equal(sharedBeforeProcess.exportUnlocked, false)
    assert.equal(sharedBeforeProcess.playable, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assert.equal(network.filter((entry) => entry.method !== 'GET').length, 0)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '')
    assertLegacyReleaseSurfaceHidden(document)

    document.getElementById('character-advanced-layout').value = 'fixed_region_motion_v0'
    document.getElementById('character-advanced-background-mode').value = 'auto'
    document.getElementById('character-advanced-tolerance').value = '31'
    document.getElementById('character-advanced-outline').checked = false
    document.getElementById('character-advanced-anchor-x').value = '3'
    document.getElementById('character-advanced-export-3x').checked = true
    localView.notifyLocalAdvancedControlsChanged()

    const processedJobId = 'job_ai_shared_process'
    const processedJob = {
      id: processedJobId,
      status: 'done',
      source_url: `/generated/${processedJobId}/source.png`,
      normalized_sheet_url: `/generated/${processedJobId}/normalized_sheet.png`,
      animations_url: `/generated/${processedJobId}/animations.json`,
      debug_report_url: `/generated/${processedJobId}/debug_report.json`,
      metadata_url: `/generated/${processedJobId}/metadata.json`,
      editor_metadata_url: `/generated/${processedJobId}/editor_metadata.json`,
      zip_url: `/generated/${processedJobId}/character_pack.zip`,
      godot_npc_zip_url: `/generated/${processedJobId}/godot_npc_pack.zip`,
      rpgmaker_zip_url: `/generated/${processedJobId}/rpgmaker_pack.zip`,
      ocad_zip_url: `/generated/${processedJobId}/ocad_pack.zip`,
    }
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url)
      const method = options.method || 'GET'
      network.push({ href, method, body: options.body || null })
      if (href === '/api/process-sheet' && method === 'POST') return jsonResponse(processedJob)
      if (href === processedJob.animations_url) {
        return jsonResponse(sampleAnimations({
          profile: 'topdown_rpg_v0',
          source_layout: { id: 'fixed_region_motion_v0' },
        }))
      }
      if (href === processedJob.debug_report_url) return jsonResponse(sampleDebugReport())
      throw new Error(`unexpected fetch ${href}`)
    }

    await localView.submitStudioLocalCharacterJobForTest()
    const localAfterProcess = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(
      localAfterProcess.phase,
      'complete',
      `downstream shared processor did not complete: ${JSON.stringify(localAfterProcess)}`,
    )
    const completed = await waitForSharedResult(
      resultMod,
      (snapshot) => snapshot.owner === 'local' && snapshot.playable && snapshot.exportUnlocked,
    )
    const post = network.filter((entry) => entry.href === '/api/process-sheet' && entry.method === 'POST')
    assert.equal(post.length, 1)
    const request = JSON.parse(post[0].body)
    assert.equal(request.options.backgroundTolerance, 31)
    assert.equal(request.options.pixelFinishingOutline, false)
    assert.deepEqual(request.options.anchorOffset, { x: 3, y: 0 })
    assert.equal(request.options.export3x, true)
    assert.deepEqual(request.options.outputFrameSizes, [96, 192, 288])
    assert.equal(Object.hasOwn(request.options, 'providerPresetId'), false)
    assert.equal(Object.hasOwn(request.options, 'reviewedRunId'), false)
    assert.equal(Object.hasOwn(request.options, 'confirmLiveGeneration'), false)
    assert.equal(completed.owner, 'local')
    assert.equal(completed.bindKey.includes(processedJobId), true)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '#character-local-export-dialog')
    assert.equal(hrefOf(document.getElementById('character-local-export-pack')), processedJob.zip_url)
    assert.deepEqual(getStudioCharacterProjectCandidate(), {
      kind: 'character',
      jobId: processedJobId,
      sourceJobId: processedJobId,
      status: 'done',
      profile: 'topdown_rpg_v0',
      zipUrl: processedJob.zip_url,
    })
    assert.notEqual(getStudioCharacterProjectCandidate().jobId, acceptance.publication_id)
    assertLegacyReleaseSurfaceHidden(document)

    await localView.selectStudioLocalCharacterSourceForTest(fakePngFile('replacement.png'))
    assert.equal(localView.getStudioCharacterProcessingSourceState().sourceOrigin, 'local')
    assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'ready')
    assert.equal(Object.hasOwn(document.getElementById('studio-character-view').dataset, 'characterPhase'), false)
    assert.equal(document.getElementById('character-local-advanced-form').hidden, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assert.equal(resultMod.readSharedCharacterResultSnapshot().exportUnlocked, false)
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultImageLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted source handoff supersedes hidden Local running and submission-unknown states', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    inspectStudioCharacterState,
    seedStudioCharacterAcceptedForTest,
    startStudioCharacterAcceptedHydrateForTest,
    switchStudioCharacterSource,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  localView.setLocalCharacterImageDimensionLoader(() => ({ width: 4096, height: 4096 }))
  try {
    initStudioCharacter({ serviceAvailable: true })
    const source = await acceptedSourceFixture()
    for (const [index, localPhase] of ['running', 'submission_unknown'].entries()) {
      const acceptance = realAcceptResponse('already_accepted')
      localView.seedStudioLocalCharacterReadyForTest({
        file: fakePngFile(`local-${localPhase}.png`),
        processingMode: 'advanced',
        sourceLayout: 'fixed_region_motion_v0',
      })
      localView.seedStudioLocalCharacterActiveRunForTest({
        phase: localPhase,
        job: localPhase === 'running' ? { id: `job_hidden_${index}`, status: 'queued' } : null,
      })
      globalThis.fetch = async (url) => {
        const href = String(url)
        if (href === acceptance.animations_url) return jsonResponse(sampleAnimations())
        if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
        if (href === acceptance.raw_provider_output_url) return bytesResponse(source.bytes)
        throw new Error(`unexpected fetch ${href}`)
      }

      await startStudioCharacterAcceptedHydrateForTest(acceptance, {
        acceptedBinding: source.binding,
      })

      const accepted = inspectStudioCharacterState()
      const processingSource = localView.getStudioCharacterProcessingSourceState()
      assert.equal(accepted.processingSourceReady, true, localPhase)
      assert.equal(processingSource.phase, 'ready', localPhase)
      assert.equal(processingSource.sourceOrigin, 'ai', localPhase)
      assert.equal(processingSource.sourceProvenance.publicationId, acceptance.publication_id, localPhase)
      assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'ready')
      assert.equal(Object.hasOwn(document.getElementById('studio-character-view').dataset, 'characterPhase'), false)
    }
  } finally {
    seedStudioCharacterAcceptedForTest()
    switchStudioCharacterSource('local')
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Black-matte dimension read cannot commit after leaving Local', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const { initStudioCharacter, switchStudioCharacterSource } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousUrl = globalThis.URL
  const revoked = []
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  globalThis.URL = {
    createObjectURL(file) { return `blob:${file?.name || 'black'}` },
    revokeObjectURL(url) { revoked.push(url) },
  }
  try {
    initStudioCharacter({ serviceAvailable: true })
    switchStudioCharacterSource('local')
    localView.seedStudioLocalCharacterReadyForTest({
      file: fakePngFile(),
      dimensions: { width: 32, height: 32 },
      processingMode: 'advanced',
      sourceLayout: 'fixed_region_motion_v0',
      backgroundMode: 'dual_matte',
    })
    let resolveBlack
    localView.setLocalCharacterImageDimensionLoader(() => new Promise((resolve, reject) => {
      resolveBlack = { resolve, reject }
    }))
    const blackPromise = localView.selectStudioLocalCharacterBlackMatteForTest(fakePngFile('matte.png'))
    switchStudioCharacterSource('ai')
    switchStudioCharacterSource('local')
    resolveBlack.resolve({ width: 32, height: 32 })
    await blackPromise
    const afterResolve = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterResolve.blackFileName, null)
    assert.equal(afterResolve.blackUrl, null)
    assert.equal(afterResolve.blackDimensions, null)
    assert.equal(afterResolve.error, null)
    assert.ok(revoked.includes('blob:matte.png'))

    localView.seedStudioLocalCharacterReadyForTest({
      file: fakePngFile(),
      dimensions: { width: 32, height: 32 },
      processingMode: 'advanced',
      sourceLayout: 'fixed_region_motion_v0',
      backgroundMode: 'dual_matte',
    })
    localView.setLocalCharacterImageDimensionLoader(() => new Promise((resolve, reject) => {
      resolveBlack = { resolve, reject }
    }))
    const blackReject = localView.selectStudioLocalCharacterBlackMatteForTest(fakePngFile('bad-matte.png'))
    switchStudioCharacterSource('ai')
    switchStudioCharacterSource('local')
    resolveBlack.reject(new Error('black decode failed'))
    await blackReject
    const afterReject = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(afterReject.blackFileName, null)
    assert.equal(afterReject.blackUrl, null)
    assert.equal(afterReject.blackDimensions, null)
    assert.equal(afterReject.error, null)
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.URL = previousUrl
  }
})

test('Accepted source hydrate write-back stays owned by the current publication and AI mode', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    inspectStudioCharacterState,
    startStudioCharacterAcceptedHydrateForTest,
    switchStudioCharacterSource,
    acceptedHydrationKind,
    deriveCharacterPresentation,
    getStudioCharacterProjectCandidate,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  localView.setLocalCharacterImageDimensionLoader(() => ({ width: 4096, height: 4096 }))
  try {
    initStudioCharacter({ serviceAvailable: true })
    const publicationA = realAcceptResponse('already_accepted')
    const publicationB = {
      ...publicationA,
      source_job_id: 'job_b',
      publication_id: 'accepted_v1_job_b',
      ...Object.fromEntries(
        Object.entries(publicationA)
          .filter(([field]) => field.endsWith('_url'))
          .map(([field, value]) => [field, String(value).replace(publicationA.publication_id, 'accepted_v1_job_b')]),
      ),
    }
    const source = await acceptedSourceFixture()
    let resolveA
    let resolveB
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href.endsWith('animations.json')) {
        if (href.includes(publicationA.publication_id)) {
          await new Promise((resolve) => { resolveA = resolve })
        } else if (href.includes(publicationB.publication_id)) {
          await new Promise((resolve) => { resolveB = resolve })
        }
        return jsonResponse(sampleAnimations())
      }
      if (href.endsWith('debug_report.json')) return jsonResponse(sampleDebugReport())
      if (href.endsWith('raw_provider_output.png')) return bytesResponse(source.bytes)
      throw new Error('unexpected fetch ' + href)
    }

    const hydrateA = startStudioCharacterAcceptedHydrateForTest(publicationA, {
      acceptedBinding: source.binding,
    })
    assert.equal(inspectStudioCharacterState().busy, 'hydrate')
    assert.equal(acceptedHydrationKind(), 'pending')
    assert.equal(deriveCharacterPresentation().action, 'blocked')

    switchStudioCharacterSource('local')
    for (let i = 0; i < 50 && typeof resolveA !== 'function'; i += 1) await Promise.resolve()
    resolveA()
    await hydrateA
    const afterLocal = inspectStudioCharacterState()
    assert.equal(afterLocal.mode, 'local')
    assert.equal(afterLocal.processingSourceReady, false)
    assert.equal(afterLocal.processingSourcePublicationId, null)
    assert.equal(afterLocal.busy, null)

    const staleA = startStudioCharacterAcceptedHydrateForTest(publicationA, {
      acceptedBinding: source.binding,
    })
    const currentB = startStudioCharacterAcceptedHydrateForTest(publicationB, {
      acceptedBinding: source.binding,
    })
    for (let i = 0; i < 50 && (typeof resolveA !== 'function' || typeof resolveB !== 'function'); i += 1) {
      await Promise.resolve()
    }
    resolveA()
    await staleA
    assert.equal(inspectStudioCharacterState().publicationId, publicationB.publication_id)
    assert.equal(inspectStudioCharacterState().processingSourceReady, false)

    resolveB()
    await currentB
    const afterB = inspectStudioCharacterState()
    const processingSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(afterB.mode, 'ai')
    assert.equal(afterB.publicationId, publicationB.publication_id)
    assert.equal(afterB.processingSourceReady, true)
    assert.equal(afterB.processingSourcePublicationId, publicationB.publication_id)
    assert.equal(afterB.busy, null)
    assert.equal(acceptedHydrationKind(), 'ready')
    assert.equal(processingSource.sourceOrigin, 'ai')
    assert.equal(processingSource.sourceProvenance.publicationId, publicationB.publication_id)
    assert.equal(resultMod.readSharedCharacterResultSnapshot().exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '')
    assertLegacyReleaseSurfaceHidden(document)
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted handoff stays pending until the verified raw source decodes', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    startStudioCharacterAcceptedHydrateForTest,
    getStudioCharacterProjectCandidate,
    inspectStudioCharacterState,
    acceptedHydrationKind,
    deriveCharacterPresentation,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  let dimensions
  localView.setLocalCharacterImageDimensionLoader(() => new Promise((resolve, reject) => {
    dimensions = { resolve, reject }
  }))
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    const reviewJob = Object.freeze({
      id: acceptance.source_job_id,
      raw_provider_output_url: `/generated/${acceptance.source_job_id}/raw_provider_output.png`,
    })
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href === acceptance.animations_url) return jsonResponse(sampleAnimations())
      if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
      if (href === acceptance.raw_provider_output_url) return bytesResponse(source.bytes)
      throw new Error('unexpected fetch ' + href)
    }

    await resultMod.bindSharedCharacterResult(
      resultMod.createAiReviewResultPresentation(reviewJob),
      { owner: 'ai' },
    )

    const hydrate = startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
      reviewJob,
    })
    for (let i = 0; i < 50 && !dimensions; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    if (typeof dimensions?.resolve !== 'function') {
      await hydrate
      assert.fail(`accepted source decode did not start: ${JSON.stringify(inspectStudioCharacterState())}`)
    }
    assert.equal(acceptedHydrationKind(), 'pending')
    assert.equal(inspectStudioCharacterState().busy, 'hydrate')
    assert.equal(inspectStudioCharacterState().processingSourceReady, false)
    assert.equal(deriveCharacterPresentation().action, 'blocked')
    const sharedPending = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(sharedPending.owner, 'ai')
    assert.equal(sharedPending.previewHidden, false)
    assert.equal(sharedPending.imageHidden, false)
    assert.equal(sharedPending.imageSrc, reviewJob.raw_provider_output_url)
    assert.equal(sharedPending.inspectorHidden, false)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'review_static')
    assert.equal(sharedPending.exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '')
    assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'acquiring')

    dimensions.resolve({ width: 4096, height: 4096 })
    await hydrate
    const ready = inspectStudioCharacterState()
    const processingSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(acceptedHydrationKind(), 'ready')
    assert.equal(ready.processingSourceReady, true)
    assert.equal(processingSource.sourceOrigin, 'ai')
    assert.equal(processingSource.sourceProvenance.publicationId, acceptance.publication_id)
    assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'ready')
    assert.equal(document.getElementById('character-local-advanced-form').hidden, false)
    assert.equal(document.getElementById('character-local-advanced-form').inert, false)
    assert.equal(document.getElementById('character-local-primary').dataset.action, 'build')
    const sharedReady = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(sharedReady.owner, 'ai')
    assert.equal(sharedReady.previewHidden, false)
    assert.equal(sharedReady.imageHidden, false)
    assert.equal(sharedReady.inspectorHidden, false)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(sharedReady.exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)

    localView.setLocalCharacterImageDimensionLoader(() => Promise.reject(new Error('source decode failed')))
    await startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
    })
    const rejected = inspectStudioCharacterState()
    assert.equal(acceptedHydrationKind(), 'error')
    assert.equal(rejected.processingSourceReady, false)
    assert.equal(rejected.processingSourceError?.code, 'accepted_source_decode_failed')
    assert.equal(deriveCharacterPresentation().action, 'retry-accepted')
    assert.equal(resultMod.readSharedCharacterResultSnapshot().exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '')
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Leaving AI during accepted-source hydrate cancels it and returning resumes exactly once', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    inspectStudioCharacterState,
    startStudioCharacterAcceptedHydrateForTest,
    switchStudioCharacterSource,
    acceptedHydrationKind,
    getStudioCharacterProjectCandidate,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  localView.setLocalCharacterImageDimensionLoader(() => ({ width: 4096, height: 4096 }))
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    const waiters = []
    let rawGets = 0
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href === acceptance.animations_url) {
        await new Promise((resolve) => { waiters.push(resolve) })
        return jsonResponse(sampleAnimations())
      }
      if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
      if (href === acceptance.raw_provider_output_url) {
        rawGets += 1
        return bytesResponse(source.bytes)
      }
      throw new Error('unexpected fetch ' + href)
    }

    const first = startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
    })
    const started = inspectStudioCharacterState().hydrateCount
    switchStudioCharacterSource('local')
    for (let i = 0; i < 50 && waiters.length < 1; i += 1) await Promise.resolve()
    waiters[0]()
    await first
    assert.equal(inspectStudioCharacterState().mode, 'local')
    assert.equal(inspectStudioCharacterState().busy, null)
    assert.equal(inspectStudioCharacterState().processingSourceReady, false)
    assert.equal(rawGets, 0)

    switchStudioCharacterSource('ai')
    const resumed = inspectStudioCharacterState()
    assert.equal(resumed.mode, 'ai')
    assert.equal(resumed.busy, 'hydrate')
    assert.equal(resumed.hydrateCount, started + 1)
    assert.equal(acceptedHydrationKind(), 'pending')
    for (let i = 0; i < 50 && waiters.length < 2; i += 1) await Promise.resolve()
    waiters[1]()
    for (let i = 0; i < 50 && inspectStudioCharacterState().busy === 'hydrate'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    const afterResume = inspectStudioCharacterState()
    const processingSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(acceptedHydrationKind(), 'ready')
    assert.equal(afterResume.hydrateCount, started + 1)
    assert.equal(afterResume.busy, null)
    assert.equal(afterResume.processingSourceReady, true)
    assert.equal(processingSource.sourceOrigin, 'ai')
    assert.equal(processingSource.sourceProvenance.publicationId, acceptance.publication_id)
    assert.equal(rawGets, 1)
    assert.equal(resultMod.readSharedCharacterResultSnapshot().exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted primary retry click starts one hydrate and ignores a second click', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const {
    initStudioCharacter,
    seedStudioCharacterAcceptedForTest,
    renderStudioCharacter,
    inspectStudioCharacterState,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    const sourceError = { code: 'accepted_source_decode_failed', message: 'retrying' }
    seedStudioCharacterAcceptedForTest({
      acceptance,
      acceptedBinding: source.binding,
      acceptedResult: Object.freeze({
        complete: true,
        animations: sampleAnimations(),
        debugReport: sampleDebugReport(),
        missingQualityUrl: false,
        error: null,
      }),
      acceptedHydrateError: sourceError,
      processingSourceError: sourceError,
    })
    renderStudioCharacter()
    const primary = document.getElementById('character-primary-action')
    assert.equal(primary.dataset.action, 'retry-accepted')
    const before = inspectStudioCharacterState().hydrateCount
    let artifactGets = 0
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href.endsWith('animations.json')) {
        artifactGets += 1
        await new Promise(() => {})
      }
      throw new Error('unexpected fetch ' + href)
    }
    primary.click()
    primary.click()
    assert.equal(inspectStudioCharacterState().hydrateCount, before + 1)
    assert.equal(artifactGets, 1)
    assert.equal(inspectStudioCharacterState().busy, 'hydrate')
    assert.equal(primary.disabled, true)
  } finally {
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted ready reuses one verified source adoption across render, language, and mode refresh', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    initStudioCharacter,
    startStudioCharacterAcceptedHydrateForTest,
    renderStudioCharacter,
    renderStudioCharacterLanguage,
    switchStudioCharacterSource,
    inspectStudioCharacterState,
    getStudioCharacterProjectCandidate,
    acceptedHydrationKind,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  let rawGets = 0
  let dimensionReads = 0
  let resultImageLoads = 0
  resultMod.setCharacterResultImageLoader(() => {
    resultImageLoads += 1
    return Promise.resolve(sheetImage('unexpected'))
  })
  localView.setLocalCharacterImageDimensionLoader(() => {
    dimensionReads += 1
    return { width: 4096, height: 4096 }
  })
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href === acceptance.animations_url) return jsonResponse(sampleAnimations())
      if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
      if (href === acceptance.raw_provider_output_url) {
        rawGets += 1
        return bytesResponse(source.bytes)
      }
      throw new Error('unexpected fetch ' + href)
    }

    await startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
    })
    const started = inspectStudioCharacterState().hydrateCount
    assert.equal(acceptedHydrationKind(), 'ready')
    assert.equal(rawGets, 1)
    assert.equal(dimensionReads, 1)
    assert.equal(resultImageLoads, 0)

    const description = document.getElementById('character-description')
    const regenerate = document.getElementById('character-regenerate-action')
    const typeReplacement = () => {
      description.value = 'a new copper-haired forest courier'
      description.dispatchEvent({ type: 'input' })
    }
    assert.equal(description.disabled, false)
    assert.equal(regenerate.hidden, false)
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    typeReplacement()
    assert.equal(regenerate.disabled, true)
    setStudioProviderSnapshotForTest({ kind: 'saving' })
    typeReplacement()
    assert.equal(regenerate.disabled, true)
    setStudioProviderSnapshotForTest({ kind: 'clearing' })
    typeReplacement()
    assert.equal(regenerate.disabled, true)
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: 'gemini-native-test',
        presets: [{
          id: 'gemini-native-test',
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: false,
          image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
        }],
      },
    })
    typeReplacement()
    assert.equal(regenerate.disabled, true)
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: 'gemini-native-test',
        presets: [{
          id: 'gemini-native-test',
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: true,
          image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
        }],
      },
    })
    typeReplacement()
    assert.equal(regenerate.disabled, false)

    renderStudioCharacter()
    renderStudioCharacter()
    renderStudioCharacterLanguage()
    switchStudioCharacterSource('local')
    const sharedInLocalMode = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(document.getElementById('studio-character-view').dataset.characterMode, 'local')
    assert.equal(sharedInLocalMode.owner, 'ai')
    assert.equal(sharedInLocalMode.previewHidden, false)
    assert.equal(sharedInLocalMode.imageHidden, false)
    assert.equal(sharedInLocalMode.inspectorHidden, false)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    switchStudioCharacterSource('ai')

    const ready = inspectStudioCharacterState()
    const processingSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(ready.hydrateCount, started)
    assert.equal(ready.processingSourceReady, true)
    assert.equal(acceptedHydrationKind(), 'ready')
    assert.equal(processingSource.sourceOrigin, 'ai')
    assert.equal(processingSource.sourceProvenance.publicationId, acceptance.publication_id)
    assert.equal(rawGets, 1)
    assert.equal(dimensionReads, 1)
    assert.equal(resultImageLoads, 0)
    assert.equal(document.getElementById('character-local-advanced-form').hidden, false)
    assert.equal(document.getElementById('character-local-advanced-form').inert, false)
    const sharedReady = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(sharedReady.owner, 'ai')
    assert.equal(sharedReady.previewHidden, false)
    assert.equal(sharedReady.imageHidden, false)
    assert.equal(sharedReady.inspectorHidden, false)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(sharedReady.exportUnlocked, false)
    assert.equal(getStudioCharacterProjectCandidate(), null)

    const retainedIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    let releaseProviderState
    globalThis.fetch = async (url) => {
      if (String(url) === '/api/gemini-state') {
        return new Promise((resolve) => { releaseProviderState = resolve })
      }
      throw new Error('unexpected fetch ' + url)
    }
    regenerate.click()
    assert.equal(inspectStudioCharacterState().busy, 'review')
    for (let i = 0; i < 20 && typeof releaseProviderState !== 'function'; i += 1) {
      await Promise.resolve()
    }
    assert.equal(typeof releaseProviderState, 'function')
    switchStudioCharacterSource('local')
    switchStudioCharacterSource('ai')
    assert.equal(inspectStudioCharacterState().busy, 'review')
    releaseProviderState(jsonResponse({ status: 'unavailable', presets: [] }))
    for (let i = 0; i < 20 && inspectStudioCharacterState().busy; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    assert.equal(inspectStudioCharacterState().phase, 'setup')
    assert.equal(inspectStudioCharacterState().busy, null)
    const replacementFailureIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(replacementFailureIsolation.sourceUrl, retainedIsolation.sourceUrl)
    assert.equal(replacementFailureIsolation.inputEpoch, retainedIsolation.inputEpoch)
    assert.deepEqual(replacementFailureIsolation.sourceProvenance, retainedIsolation.sourceProvenance)
    assert.deepEqual(replacementFailureIsolation.advancedSettings, retainedIsolation.advancedSettings)
    assert.equal(document.getElementById('studio-character-view').dataset.characterProcessingSource, 'ready')
    const replacementFailureShared = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(replacementFailureShared.bindKey, sharedReady.bindKey)
    assert.equal(replacementFailureShared.imageSrc, sharedReady.imageSrc)
    assert.equal(replacementFailureShared.previewHidden, false)
    assert.equal(replacementFailureShared.exportUnlocked, false)
    assertLegacyReleaseSurfaceHidden(document)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultImageLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted source stays visible while an unknown local submission remains locked across mode switches', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const localView = await import('../src/ui/studio/characterLocalView.js')
  const {
    getStudioCharacterProjectCandidate,
    initStudioCharacter,
    inspectStudioCharacterState,
    startStudioCharacterAcceptedHydrateForTest,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  let rawGets = 0
  let dimensionReads = 0
  let resultImageLoads = 0
  resultMod.setCharacterResultImageLoader(() => {
    resultImageLoads += 1
    return Promise.resolve(sheetImage('unexpected'))
  })
  localView.setLocalCharacterImageDimensionLoader(() => {
    dimensionReads += 1
    return { width: 4096, height: 4096 }
  })
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href === acceptance.animations_url) return jsonResponse(sampleAnimations())
      if (href === acceptance.debug_report_url) return jsonResponse(sampleDebugReport())
      if (href === acceptance.raw_provider_output_url) {
        rawGets += 1
        return bytesResponse(source.bytes)
      }
      throw new Error('unexpected fetch ' + href)
    }

    await startStudioCharacterAcceptedHydrateForTest(acceptance, {
      acceptedBinding: source.binding,
    })
    localView.setStudioCharacterProcessingContext({ active: true, surfaceActive: true })
    document.getElementById('character-advanced-background-mode').value = 'auto'
    localView.notifyLocalAdvancedControlsChanged()
    const readySnapshot = resultMod.readSharedCharacterResultSnapshot()
    const readyIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    const readySource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(readySnapshot.owner, 'ai')
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(readySource.hasSource, true)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), true)

    let processPosts = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/process-sheet')) {
        processPosts += 1
        throw Object.assign(new Error('network'), { code: 'request_failed' })
      }
      throw new Error('unexpected fetch ' + url)
    }
    await localView.submitStudioLocalCharacterJobForTest()
    assert.equal(processPosts, 1)
    const unknownSnapshot = await waitForSharedResult(
      resultMod,
      (snapshot) => snapshot.owner === 'ai' && snapshot.bindKey === readySnapshot.bindKey,
    )
    const unknownIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    const unknownSource = localView.getStudioCharacterProcessingSourceState()
    const unknownGeneration = resultMod.getSharedCharacterBindGeneration()
    assert.equal(unknownIsolation.phase, 'submission_unknown')
    assert.equal(unknownIsolation.jobId, null)
    assert.equal(unknownIsolation.inputEpoch, readyIsolation.inputEpoch)
    assert.equal(unknownIsolation.binding.inputEpoch, readyIsolation.inputEpoch)
    assert.equal(unknownIsolation.binding.processingMode, readyIsolation.processingMode)
    assert.equal(unknownIsolation.sourceUrl, readyIsolation.sourceUrl)
    assert.deepEqual(unknownIsolation.advancedSettings, readyIsolation.advancedSettings)
    assert.equal(unknownSource.sourceOrigin, 'ai')
    assert.deepEqual(unknownSource.sourceProvenance, readySource.sourceProvenance)
    assert.equal(unknownSnapshot.previewHidden, false)
    assert.equal(unknownSnapshot.imageHidden, false)
    assert.equal(unknownSnapshot.inspectorHidden, false)
    assert.equal(unknownSnapshot.imageSrc, readySnapshot.imageSrc)
    assert.equal(unknownSnapshot.playable, false)
    assert.equal(unknownSnapshot.exportUnlocked, false)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(processPosts, 1)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), false)
    assert.equal(document.getElementById('character-local-primary').disabled, true)
    assert.equal(document.getElementById('character-advanced-layout').disabled, true)

    document.getElementById('character-local-entry').click()
    assert.equal(inspectStudioCharacterState().mode, 'local')
    assert.equal(document.getElementById('character-local-entry').getAttribute('aria-pressed'), 'true')
    assert.equal(document.getElementById('character-ai-entry').getAttribute('aria-pressed'), 'false')
    const localSnapshot = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(localSnapshot.owner, 'ai')
    assert.equal(localSnapshot.bindKey, readySnapshot.bindKey)
    assert.equal(localSnapshot.imageSrc, readySnapshot.imageSrc)
    const localIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    const localSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(localIsolation.phase, 'submission_unknown')
    assert.equal(localIsolation.jobId, null)
    assert.equal(localIsolation.inputEpoch, unknownIsolation.inputEpoch)
    assert.deepEqual(localIsolation.binding, unknownIsolation.binding)
    assert.equal(localIsolation.sourceUrl, unknownIsolation.sourceUrl)
    assert.deepEqual(localSource, unknownSource)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), false)
    assert.equal(document.getElementById('character-local-primary').disabled, true)
    assert.equal(document.getElementById('character-advanced-layout').disabled, true)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(resultMod.getSharedCharacterBindGeneration(), unknownGeneration)
    assert.equal(processPosts, 1)

    document.getElementById('character-ai-entry').click()
    assert.equal(inspectStudioCharacterState().mode, 'ai')
    assert.equal(document.getElementById('character-local-entry').getAttribute('aria-pressed'), 'false')
    assert.equal(document.getElementById('character-ai-entry').getAttribute('aria-pressed'), 'true')
    assert.equal(document.getElementById('character-description').disabled, false)
    assert.equal(document.getElementById('character-regenerate-action').hidden, false)
    const aiSnapshot = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(aiSnapshot.owner, 'ai')
    assert.equal(aiSnapshot.bindKey, readySnapshot.bindKey)
    assert.equal(aiSnapshot.imageSrc, readySnapshot.imageSrc)
    const aiIsolation = localView.inspectStudioLocalCharacterIsolationSnapshot()
    const aiSource = localView.getStudioCharacterProcessingSourceState()
    assert.equal(aiIsolation.phase, 'submission_unknown')
    assert.equal(aiIsolation.jobId, null)
    assert.equal(aiIsolation.inputEpoch, unknownIsolation.inputEpoch)
    assert.deepEqual(aiIsolation.binding, unknownIsolation.binding)
    assert.equal(aiIsolation.sourceUrl, unknownIsolation.sourceUrl)
    assert.deepEqual(aiSource, unknownSource)
    assert.equal(localView.canMutateStudioCharacterLocalParameters(), false)
    assert.equal(document.getElementById('character-local-primary').disabled, true)
    assert.equal(document.getElementById('character-advanced-layout').disabled, true)
    assert.equal(resultMod.getSharedCharacterExportPresentation().status, 'accepted_static')
    assert.equal(resultMod.getSharedCharacterBindGeneration(), unknownGeneration)
    assert.equal(processPosts, 1)
    assert.equal(rawGets, 1)
    assert.equal(dimensionReads, 1)
    assert.equal(resultImageLoads, 0)
    assert.equal(getStudioCharacterProjectCandidate(), null)
  } finally {
    localView.setLocalCharacterImageDimensionLoader(null)
    resultMod.setCharacterResultImageLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Accepted publication never binds as the shared processing result', async () => {
  const resultMod = await import('../src/ui/studio/characterResultView.js')
  const {
    initStudioCharacter,
    seedStudioCharacterAcceptedForTest,
    bindAiSharedResult,
    inspectStudioCharacterState,
    getStudioCharacterProjectCandidate,
  } = await import('../src/ui/studio/characterView.js')
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const document = createCharacterResultTestDocument(parseCharacterAdvancedConfigControls(html))
  const previousDocument = globalThis.document
  resultMod.setCharacterResultDocument(document)
  globalThis.document = document
  let resultImageLoads = 0
  resultMod.setCharacterResultImageLoader((url) => {
    resultImageLoads += 1
    return Promise.resolve(sheetImage(url))
  })
  try {
    initStudioCharacter({ serviceAvailable: true })
    const acceptance = realAcceptResponse('already_accepted')
    const source = await acceptedSourceFixture()
    seedStudioCharacterAcceptedForTest({
      acceptance,
      acceptedBinding: source.binding,
      acceptedResult: Object.freeze({
        complete: true,
        animations: sampleAnimations(),
        debugReport: sampleDebugReport(),
        missingQualityUrl: false,
        error: null,
      }),
      acceptedPresentationReady: true,
      processingSourceReady: false,
      processingSourcePublicationId: null,
    })

    await bindAiSharedResult()
    const shared = resultMod.readSharedCharacterResultSnapshot()
    assert.equal(inspectStudioCharacterState().mode, 'ai')
    assert.equal(inspectStudioCharacterState().phase, 'accepted')
    assert.equal(resultImageLoads, 0)
    assert.equal(shared.owner, null)
    assert.equal(shared.playable, false)
    assert.equal(shared.exportUnlocked, false)
    assert.equal(hrefOf(document.getElementById('character-export-link')), '')
    assert.equal(hrefOf(document.getElementById('character-local-export-pack')), '')
    assert.equal(getStudioCharacterProjectCandidate(), null)
    assertLegacyReleaseSurfaceHidden(document)
  } finally {
    resultMod.setCharacterResultImageLoader(null)
    resultMod.setCharacterResultDocument(null)
    globalThis.document = previousDocument
  }
})
