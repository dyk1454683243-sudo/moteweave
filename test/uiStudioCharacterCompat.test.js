import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  compatCharacterExportUrl,
  compatCharacterProjectCandidateIsCurrent,
  createInitialCompatCharacterState,
  deriveCompatCharacterPresentation,
} from '../src/ui/studio/characterCompatView.js'
import { compatCharacterInputFingerprint } from '../src/ui/studio/characterCompatApi.js'
import {
  advancedProviderRouteForState,
  advancedProviderRouteIsUndisclosed,
  clearAdvancedProviderSecret,
} from '../src/ui/studio/advancedProviderState.js'

function validState(overrides = {}) {
  const empty = createInitialCompatCharacterState()
  return {
    ...empty,
    settings: {
      ...empty.settings,
      description: 'Silver-haired swordswoman',
    },
    ...overrides,
  }
}

test('Studio compatible Character has an independent fail-closed state matrix', () => {
  assert.equal(deriveCompatCharacterPresentation(createInitialCompatCharacterState()).action, 'run')
  assert.equal(deriveCompatCharacterPresentation(validState({
    settings: { ...createInitialCompatCharacterState().settings, description: '' },
  })).action, 'blocked')
  assert.equal(deriveCompatCharacterPresentation(validState()).action, 'run')
  assert.equal(deriveCompatCharacterPresentation(validState({ phase: 'running' })).action, 'running')
  assert.equal(deriveCompatCharacterPresentation(validState({ phase: 'poll_paused' })).action, 'resume')
  assert.equal(deriveCompatCharacterPresentation(validState({ phase: 'diagnostic' })).action, 'config')
  assert.equal(deriveCompatCharacterPresentation(validState({ phase: 'submission_unknown' })).action, 'blocked')
  assert.equal(deriveCompatCharacterPresentation(validState({ phase: 'failed' })).action, 'config')
})

test('Studio compatible Character exposes Project candidates only for complete production sheets', () => {
  const production = createInitialCompatCharacterState()
  production.settings.description = 'Verified production-sheet character'
  production.phase = 'release'
  production.binding = {
    settings: production.settings,
    inputKey: compatCharacterInputFingerprint({ settings: production.settings, inputEpoch: production.inputEpoch }),
  }
  production.result = {
    job: {
      status: 'done',
      release_ready: true,
      artifact_disposition: 'release',
      zip_url: '/generated/job_compat/character_pack.zip',
    },
  }
  assert.equal(compatCharacterProjectCandidateIsCurrent(production), true)
  assert.equal(compatCharacterExportUrl(production), '/generated/job_compat/character_pack.zip')
  assert.equal(deriveCompatCharacterPresentation(production).action, 'export')
  assert.equal(deriveCompatCharacterPresentation(production).releaseReady, true)

  const quality = structuredClone(production)
  quality.settings.t2iMode = 'quality_character_v0'
  quality.binding.settings.t2iMode = 'quality_character_v0'
  quality.binding.inputKey = compatCharacterInputFingerprint({ settings: quality.settings, inputEpoch: quality.inputEpoch })
  assert.equal(compatCharacterProjectCandidateIsCurrent(quality), false)
})

test('Studio Character exposes compatibility as a separate workspace with no Strict Accept controls', async () => {
  const [html, css, parent, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterView.js', 'utf8'),
    readFile('src/ui/studio/characterCompatView.js', 'utf8'),
  ])
  const start = html.indexOf('id="character-compat-workspace"')
  const end = html.indexOf('id="character-ai-workspace"', start)
  assert.ok(start > 0 && end > start)
  const compatHtml = html.slice(start, end)

  assert.match(html, /id="character-compat-entry"[^>]*aria-pressed="false"/)
  assert.match(compatHtml, /id="character-compat-mode"/)
  assert.match(compatHtml, /id="character-compat-preset"/)
  assert.match(compatHtml, /id="character-compat-layout"/)
  assert.match(compatHtml, /id="character-compat-candidates"/)
  assert.match(compatHtml, /id="character-compat-reference"[^>]*image\/jpeg/)
  assert.match(compatHtml, /id="character-compat-palette"[^>]*image\/jpeg/)
  assert.match(compatHtml, /id="character-compat-diagnostic"/)
  assert.match(compatHtml, /data-character-compat-production-only/)
  assert.match(compatHtml, /data-character-compat-production-only><span data-character-compat-copy="outlineMode"/)
  assert.match(compatHtml, /data-character-compat-production-only><input id="character-compat-pixel-finishing"/)
  assert.match(compatHtml, /像素精修固定执行，仅最大颜色与描边会提交/)
  assert.match(compatHtml, /id="character-compat-quality-boundary"[^>]*hidden/)
  assert.match(compatHtml, /无 Accept · 无导出 · 无 Project candidate/)
  assert.doesNotMatch(compatHtml, /accept-generated-character|character-primary-action|人工接受|manual accept/i)
  assert.match(parent, /activeCharacterMode === 'compat'/)
  assert.match(parent, /getStudioCompatCharacterProjectCandidate/)
  assert.match(parent, /aiWorkspace\.hidden = activeCharacterMode !== 'ai'/)
  assert.match(parent, /aiWorkspace\.inert = activeCharacterMode !== 'ai'/)
  assert.match(view, /phase: submissionUnknown \? 'submission_unknown' : 'failed'/)
  assert.match(view, /phase: 'poll_paused'/)
  assert.match(view, /verifyCompatCharacterRelease/)
  assert.match(view, /action === 'export'/)
  assert.doesNotMatch(view, /postStrictManualAcceptance|startStrictLiveGeneration|accept-generated-character/)
  assert.match(view, /configStageHelp: 'Verified downloads open only after the current Job, download disposition/)
  assert.match(view, /configStageHelp: '当前 Job、下载处置/)
  assert.doesNotMatch(view, /(?:configStageHelp|releaseStageHelp):[^\n]*(?:release_ready|发布处置)/)
  assert.doesNotMatch(compatHtml, /id="character-compat-stage-help">[^<]*(?:release_ready|发布处置)/)
  assert.match(view, /releaseStatus: 'verified · download available'/)
  assert.match(view, /releaseStatus: '已验证 · 可下载'/)
  assert.match(compatHtml, /<details class="character-compat-policy technical-disclosure">/)
  assert.doesNotMatch(compatHtml, /<section class="character-compat-policy"/)
  assert.match(css, /\.character-compat-policy summary \{[^}]*cursor: pointer/)
  assert.match(css, /\.character-compat-workspace \{[^}]*grid-template-columns: 430px minmax\(0, 1fr\)/)
  assert.match(css, /\.character-main\[data-character-mode="compat"\] > \.character-workspace \{ display: none !important; \}/)
  assert.match(css, /\.character-main\[data-character-mode="compat"\] > \.character-compat-workspace \{ grid-column: 1; grid-row: 2; \}/)
  assert.doesNotMatch(css, /data-character-mode="compat"[^}]*character-language-group[^}]*display: none/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.character-compat-workspace \{[^}]*grid-template-columns: 1fr/)
})

test('Studio advanced Provider keeps Gemini primary, preserves route intent, and clears key input after every save attempt', async () => {
  const [html, settingsView] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
  ])
  const start = html.indexOf('id="studio-advanced-provider"')
  const end = html.indexOf('id="studio-action-view"', start)
  assert.ok(start > 0 && end > start)
  const advancedHtml = html.slice(start, end)

  assert.match(html, /id="studio-runtime-provider"[\s\S]*<option value="gemini">Gemini<\/option>/)
  assert.match(advancedHtml, /value="openrouter"/)
  assert.match(advancedHtml, /value="openrouter_compatible"/)
  assert.doesNotMatch(advancedHtml, /option value="gemini"/)
  assert.match(advancedHtml, /高级兼容 Character[\s\S]*共享 Provider/)
  assert.match(advancedHtml, /Character Strict[\s\S]*原生 Gemini/)
  assert.match(advancedHtml, /Tiles AI[\s\S]*原生 Gemini/)
  assert.match(settingsView, /if \(!validation\.valid\) \{[\s\S]*clearAdvancedProviderSecret/)
  assert.match(settingsView, /finally \{[\s\S]*clearAdvancedProviderSecret/)
  assert.match(settingsView, /postProviderConfig\(validation\.payload\)/)
  assert.match(settingsView, /postProviderConfig\(\{ clear: true \}\)/)
  assert.doesNotMatch(settingsView, /localStorage\.(?:setItem|getItem)\([^)]*(?:api|key|provider)/i)

  const secret = { value: 'never echo this' }
  clearAdvancedProviderSecret(secret)
  assert.equal(secret.value, '')
  const runtimeOpenRouter = { available: true, provider: 'openrouter', runtime_configured: true }
  assert.equal(advancedProviderRouteForState(runtimeOpenRouter, 'openrouter_compatible'), 'openrouter_compatible')
  assert.equal(advancedProviderRouteForState(runtimeOpenRouter, null), '')
  assert.equal(advancedProviderRouteIsUndisclosed(runtimeOpenRouter, null), true)
  assert.equal(advancedProviderRouteIsUndisclosed(runtimeOpenRouter, 'openrouter'), false)
  const environmentOpenRouter = { available: true, provider: 'openrouter', runtime_configured: false }
  assert.equal(advancedProviderRouteForState(environmentOpenRouter, null), '')
  assert.equal(advancedProviderRouteIsUndisclosed(environmentOpenRouter, null), true)
  assert.equal(advancedProviderRouteIsUndisclosed(environmentOpenRouter, 'openrouter'), false)
  assert.equal(advancedProviderRouteIsUndisclosed({ ...environmentOpenRouter, available: false }, null), false)
})

test('Studio compatibility design provenance includes all Current config, running, diagnostic, release, active, and failure nodes', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  for (const nodeId of [
    '971:5301',
    '971:6230',
    '971:7159',
    '971:8101',
    '978:5077',
    '978:5218',
    '978:5359',
  ]) assert.match(html, new RegExp(nodeId))
})
