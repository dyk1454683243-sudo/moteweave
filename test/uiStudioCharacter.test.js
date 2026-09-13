import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createInitialCharacterState,
  deriveCharacterPresentation,
} from '../src/ui/studio/characterView.js'
import { STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'

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
    /\.character-topbar > :is\(\.prompt-assistant-entry, \.status-badge\)\s*\{[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s,
  )
  assert.match(
    css,
    /\.character-workspace\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\)/s,
  )
  assert.match(
    css,
    /\.character-stage\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\) 104px/s,
  )
  assert.match(
    css,
    /\.character-pipeline ol\s*\{[^}]*height:\s*91px/s,
  )
  assert.match(
    css,
    /\.character-pipeline li\s*\{[^}]*height:\s*91px[^}]*gap:\s*2px[^}]*padding:\s*7px 8px/s,
  )
  assert.match(
    css,
    /\.character-pipeline li::before\s*\{[^}]*box-sizing:\s*border-box[^}]*flex:\s*0 0 14px/s,
  )
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
    /\.character-stage\s*\{\s*grid-template-rows:\s*36px minmax\(0, 1fr\) auto;\s*\}/,
  )
  assert.match(
    narrowDesktop,
    /\.character-pipeline\s*\{\s*grid-template-columns:\s*54px minmax\(0, 1fr\);\s*\}/,
  )
  assert.match(
    narrowDesktop,
    /\.pipeline-status\s*\{\s*grid-column:\s*1 \/ -1;\s*align-items:\s*flex-end;\s*\}/,
  )
  assert.match(
    narrowDesktop,
    /\.pipeline-status span\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/s,
  )
})

test('Studio Character owns the Figma local and strict AI modes on the internal route', async () => {
  const [html, app, view, api, localView, localApi] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
    readFile('src/ui/studio/characterApi.js', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
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
  for (const nodeId of ['701:4864', '702:3936', '709:4274', '704:4036', '706:4136', '711:4369']) {
    assert.match(html, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const nodeId of ['655:3697', '660:3702', '683:3795', '663:3707', '665:3716', '667:3725', '668:3736']) {
    assert.match(html, new RegExp(nodeId.replace(':', '\\:')))
  }
  assert.match(html, /id="character-local-entry"[^>]*aria-pressed="true"[^>]*data-studio-i18n="character\.localEntry"/)
  assert.match(html, /id="character-ai-entry"[^>]*aria-pressed="false"[^>]*data-studio-i18n="character\.aiEntry"/)
  assert.match(html, /id="character-local-workspace"[^>]*data-character-local-phase="empty"/)
  assert.match(openingTagForId(html, 'character-ai-workspace'), /\bhidden\b/)
  assert.match(app, /const STUDIO_ROUTES = Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /return STUDIO_ROUTES\.includes\(route\) \? route : 'character'/)
  assert.match(app, /const activeRoute = STUDIO_ROUTES\.includes\(route\) \? route : 'character'/)
  assert.match(app, /const STUDIO_TITLES = Object\.freeze\(/)
  assert.match(app, /action: 'MoteWeave · 动作源'/)
  assert.match(app, /document\.title = STUDIO_TITLES\[language\]\[activeRoute\]/)
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

test('Studio Character exposes truthful controls for strict fixed, manual Accept, and blocked Topdown', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const character = characterHtml(html)

  assert.match(html, /id="character-description"/)
  assert.match(html, /id="character-primary-action"[^>]*data-action="review"/)
  assert.match(html, /id="character-issue-count"[^>]*min="0"[^>]*step="1"/)
  assert.doesNotMatch(character, /id="character-topdown-profile"/)
  assert.match(character, /<span class="mode-tab character-profile-unavailable" role="note"[^>]*data-studio-i18n="character\.topdownProfileTab"/)
  const exportTag = openingTagForId(html, 'character-export-link')
  assert.match(exportTag, /aria-disabled="true"/)
  assert.match(exportTag, /data-studio-i18n="character\.exportLocked"/)
  assert.doesNotMatch(exportTag, /\bhidden\b/)
  assert.doesNotMatch(exportTag, /\bhref\s*=/)
  assert.match(openingTagForId(html, 'character-reset-action'), /\bhidden\b/)
  assert.match(html, /data-studio-i18n="character\.overridesValue"/)
  assert.match(html, /data-studio-i18n="character\.frameLocksValue"/)
  assert.match(html, /data-studio-i18n="character\.normalizationValue"/)
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
    /class="character-state-panel character-accepted-panel"[\s\S]*data-studio-i18n="character\.acceptedKicker"[\s\S]*data-studio-i18n="character\.releasePack"/,
  )
  assert.match(
    character,
    /id="character-review-evidence"[\s\S]*data-studio-i18n="character\.reviewEvidenceTitle"/,
  )
  assert.match(view, /root\.dataset\.characterPhase = state\.phase/)
  assert.match(view, /if \(state\.failureMode\) root\.dataset\.characterFailure = state\.failureMode/)
})

test('Studio Character keeps the Topdown pixel placeholder while hiding only unsupported detail', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
  ])
  const placeholder = html.match(
    /<div id="character-placeholder"[\s\S]*?<\/div>\s*<div class="character-job-strip"/,
  )?.[0]
  assert.ok(placeholder, 'character placeholder is missing')
  assert.match(placeholder, /class="pixel-character"/)
  assert.match(
    view,
    /setHidden\('character-placeholder', \['review_required', 'accepted'\]\.includes\(state\.phase\)\)/,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="topdown"\] \.character-blocking-grid\s*\{[^}]*display:\s*none !important/s,
  )
  assert.match(
    css,
    /\.character-main\[data-character-phase="topdown"\] \.character-placeholder p\s*\{[^}]*display:\s*none/s,
  )
  assert.doesNotMatch(
    css,
    /\.character-main\[data-character-phase="topdown"\] \.character-placeholder(?:\s*,|\s*\{[^}]*display:\s*none)/s,
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
})

test('Studio Character keeps Export visible but unlocks its href only for Accepted', async () => {
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  const release = functionSource(view, 'renderRelease')

  assert.match(release, /const acceptance = state\.phase === 'accepted' \? state\.acceptance : null/)
  assert.match(release, /exportLink\.hidden = false/)
  assert.match(release, /exportLink\.setAttribute\('aria-disabled', String\(!enabled\)\)/)
  assert.match(release, /if \(enabled\) \{[\s\S]*exportLink\.href = acceptance\.zip_url/)
  assert.match(release, /else \{[\s\S]*exportLink\.removeAttribute\('href'\)/)
  assert.match(release, /exportLink\.tabIndex = -1/)
  assert.match(release, /state\.phase === 'running'[\s\S]*character\.exportRunning/)
  assert.match(release, /state\.phase === 'review_required'[\s\S]*character\.exportReviewRequired/)
  assert.match(release, /state\.phase === 'topdown'[\s\S]*character\.exportBlocked/)
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
  assert.match(STUDIO_TRANSLATIONS.zh['character.normalizedFileNote'], /不是 Raw/i)
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
    /String\(Boolean\(state\.busy\) \|\| \(state\.phase === 'running' && !state\.failureMode\)\)/,
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
    /String\(Boolean\(state\.busy\) \|\| \(state\.phase === 'running' && !state\.failureMode\)\)/,
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

  assert.match(character, /class="character-mode-tabs" role="group"/)
  assert.match(openingTagForId(character, 'character-top-status'), /role="status"/)
  assert.match(openingTagForId(character, 'character-top-status'), /aria-live="polite"/)
  assert.match(openingTagForId(character, 'character-top-status'), /aria-atomic="true"/)
  assert.match(openingTagForId(character, 'character-flow-title'), /tabindex="-1"/)
  assert.match(openingTagForId(character, 'character-accept-preflight'), /role="status"/)
  assert.match(openingTagForId(character, 'character-accept-preflight'), /aria-live="polite"/)
  assert.match(openingTagForId(character, 'character-action-message'), /role="status"/)
  assert.match(openingTagForId(character, 'character-action-message'), /aria-live="polite"/)
  assert.match(
    character,
    /class="pipeline-status" role="status" aria-live="polite" aria-atomic="true"/,
  )
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
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-stage \{ grid-template-rows: 36px minmax\(0, 1fr\) auto; \}/)
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-pipeline \{ grid-template-columns: 1fr; \}/)
  assert.match(css, /@media \(max-width: 1004px\)[\s\S]*\.character-pipeline ol \{ grid-template-columns: repeat\(4, minmax\(50px, 1fr\)\); \}/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.character-topbar \{ height: auto; min-height: 44px;/)
  assert.doesNotMatch(css, /\.character-evidence-grid figure:last-child \{ grid-column: 1 \/ -1; \}/)
  assert.match(css, /\.studio-file-mode \[data-studio-server-required\] \{ pointer-events: none; opacity: \.45; \}/)

  assert.match(html, /location\.protocol === 'file:'[\s\S]*studio-file-mode/)
  assert.match(html, /else if \(control\.hasAttribute\('data-studio-server-required'\)\) control\.tabIndex = -1/)
  assert.match(html, /showLockedStatus\('studio-provider-state-badge', '需要本地服务'\)/)
  assert.match(openingTagForId(html, 'studio-runtime-warning'), /role="alert"/)
  assert.match(openingTagForId(html, 'character-primary-action'), /\bdisabled\b/)
  assert.match(openingTagForId(html, 'character-primary-action'), /\bdata-studio-server-required\b/)
  const characterView = await readFile('src/ui/studio/characterView.js', 'utf8')
  assert.match(characterView, /const editable = serviceConnectionAvailable && setup && !state\.busy/)
  assert.match(characterView, /fixed\.disabled = !serviceConnectionAvailable/)
  assert.match(characterView, /topdownButton\.disabled = !serviceConnectionAvailable/)

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
})

test('Studio document IDs stay unique after adding the Character view', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length)
})
