import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  LEGACY_STUDIO_TAB_ROUTES,
  legacyStudioRedirectLocation,
} from '../src/server/legacyStudioRedirect.js'
import {
  STUDIO_TRANSLATIONS,
  advancedProviderPresentation,
  currentProviderRoutePresentation,
  providerPresentation,
  studioHasEligibleNativeGeminiPreset,
} from '../src/ui/studio/settingsView.js'
import {
  advancedProviderRouteForState,
  advancedProviderRouteIsUndisclosed,
  clearAdvancedProviderSecret,
} from '../src/ui/studio/advancedProviderState.js'
import { STRICT_FIXED_REGION_PROFILE } from '../src/ui/studio/characterApi.js'

const STUDIO_RAIL_DESTINATIONS = [
  '#character',
  '#action',
  '#sequence',
  '#tiles',
  '#scene',
  '#project',
  '#qa',
  '#settings',
]

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

test('Studio Settings stays parallel and keeps the accepted rail capability-truthful', async () => {
  const [html, app, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])

  assert.match(html, /data-design-source="figma:ro8w6TKkpd969zW2V5bmkx\/749:4446,978:5077,978:5218,978:5359,1111:5317"/)
  assert.match(html, /location\.protocol === 'file:'[\s\S]*studio-file-mode/)
  assert.match(openingTagForId(html, 'studio-runtime-warning'), /role="alert"/)
  assert.match(html, /<link rel="stylesheet" href="\.\/studio\.css"/)
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/)
  assert.match(app, /import \{ initStudioSettings, refreshStudioSettingsLanguage \} from '\.\/settingsView\.js'/)
  assert.match(app, /void bootStudio\(\)/)
  assert.match(app, /export function studioServiceAvailable/)
  assert.match(app, /initStudioSettings\(\{ serviceAvailable \}\)/)
  assert.match(app, /initStudioCharacter\(\{ serviceAvailable \}\)/)
  assert.match(css, /\.icon-rail\s*\{/)
  assert.match(css, /\.settings-dashboard\s*\{/)
  assert.match(css, /\.studio-file-mode \.studio-runtime-warning \{ display: grid; \}/)

  const railStart = html.indexOf('<aside class="icon-rail"')
  const railEnd = html.indexOf('</aside>', railStart)
  assert.ok(railStart >= 0 && railEnd > railStart, 'Studio rail is missing')
  const rail = html.slice(railStart, railEnd)
  for (const destination of STUDIO_RAIL_DESTINATIONS) {
    assert.match(rail, new RegExp(`href="${destination.replace('?', '\\?')}"`))
  }
  const railDestinationOffsets = STUDIO_RAIL_DESTINATIONS.map((destination) => rail.indexOf(`href="${destination}"`))
  assert.ok(railDestinationOffsets.every((offset) => offset >= 0), 'every Studio rail destination must exist')
  assert.deepEqual(
    railDestinationOffsets,
    [...railDestinationOffsets].sort((left, right) => left - right),
    'Studio rail destinations must stay in accepted Character → Project → QA → Settings order',
  )
  const qaOffset = rail.indexOf('href="#qa"')
  const spacerOffset = rail.indexOf('<div class="rail-spacer">')
  const settingsOffset = rail.indexOf('href="#settings"')
  const projectOffset = rail.indexOf('href="#project"')
  assert.ok(projectOffset < spacerOffset && spacerOffset < qaOffset && qaOffset < settingsOffset, 'QA and Settings must follow the main-workflow spacer')
  assert.equal((rail.match(/class="rail-item/g) ?? []).length, 8)
  assert.match(
    rail,
    /<a class="rail-item is-active" href="#character"[^>]*aria-current="page">/,
  )
  assert.match(rail, /<a class="rail-item" href="#settings" data-studio-route="settings">/)
  assert.match(rail, /<a class="rail-item rail-item-utility" href="#qa" data-studio-route="qa">/)
  assert.match(rail, /data-studio-i18n="nav\.qa"/)
})

test('legacy deep links use the fixed server whitelist and safe Character fallback', () => {
  assert.deepEqual(LEGACY_STUDIO_TAB_ROUTES, {
    'motion-source': 'action',
    sprite: 'sequence',
    'two-point-five-d': 'tiles',
    'project-pack': 'project',
    qa: 'qa',
    'character-pack': 'character',
    prompts: 'tiles',
  })
  assert.equal(
    legacyStudioRedirectLocation('?tab=two-point-five-d'),
    '/src/ui/studio/studio.html#tiles',
  )
  assert.equal(
    legacyStudioRedirectLocation('?tab=prompts'),
    '/src/ui/studio/studio.html#tiles',
  )
  for (const search of ['', '?tab=unknown', '?tab=qa&tab=motion-source']) {
    assert.equal(
      legacyStudioRedirectLocation(search),
      '/src/ui/studio/studio.html#character',
    )
  }
})
test('Studio Settings binds maintained cross-module and advanced Provider capabilities', async () => {
  const [html, source] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
  ])

  const settingsStart = html.indexOf('id="studio-settings-view"')
  const settingsEnd = html.indexOf('id="studio-action-view"')
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart)
  const settingsHtml = html.slice(settingsStart, settingsEnd)

  for (const id of [
    'language-select',
    'studio-current-provider-badge',
    'studio-current-provider-route',
    'studio-current-provider-source',
    'studio-current-provider-impact',
    'studio-provider-state-badge',
    'studio-runtime-provider',
    'studio-runtime-model',
    'studio-runtime-base-url-field',
    'studio-runtime-base-url',
    'studio-runtime-api-key',
    'studio-toggle-api-key',
    'studio-save-provider-config',
    'studio-clear-provider-config',
    'studio-provider-config-status',
    'studio-ffmpeg-status',
    'studio-rembg-status',
    'studio-refresh-tools',
    'studio-tool-status-message',
    'studio-advanced-provider',
    'studio-advanced-runtime-provider',
    'studio-advanced-runtime-model',
    'studio-advanced-runtime-base-url',
    'studio-advanced-runtime-api-key',
    'studio-save-advanced-provider',
    'studio-clear-advanced-provider',
  ]) {
    assert.notEqual(openingTagForId(settingsHtml, id), '', `missing Studio Settings control #${id}`)
  }

  assert.match(source, /\binitI18n\(\)/)
  assert.doesNotMatch(source, /\bsetCurrentLanguage\s*\(/)
  assert.match(
    source,
    /languageSelect\.addEventListener\('change', renderLocalizedState\)/,
  )
  assert.match(source, /document\.querySelectorAll\('\.settings-language\[data-studio-language\]'\)/)
  assert.match(source, /languageSelect\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
  assert.match(source, /if \(!serviceConnectionAvailable\) \{[\s\S]*Promise\.resolve\(\[\]\)/)
  assert.match(source, /\binitProviderConfigSurface\(\{/)
  assert.match(source, /\bfetchProviderState\(\)/)
  assert.match(source, /\bfetchMotionSourceToolStatus\(\)/)

  const settingsLanguageButtons = settingsHtml.match(/<button class="language-short settings-language[^>]+>/g) ?? []
  assert.equal(settingsLanguageButtons.length, 2)
  for (const tag of settingsLanguageButtons) {
    assert.match(tag, /aria-pressed="(?:true|false)"/)
  }

  const notProvidedStart = settingsHtml.indexOf('<div class="not-provided">')
  const notProvidedEnd = settingsHtml.indexOf('</div>', notProvidedStart)
  assert.ok(notProvidedStart >= 0 && notProvidedEnd > notProvidedStart)
  const notProvided = settingsHtml.slice(notProvidedStart, notProvidedEnd)
  assert.match(notProvided, /data-studio-i18n="settings\.scope\.notProvidedTitle"/)
  assert.match(notProvided, /data-studio-i18n="settings\.scope\.notProvidedOne"/)
  assert.match(notProvided, /data-studio-i18n="settings\.scope\.notProvidedTwo"/)
  assert.match(notProvided, /data-studio-i18n="settings\.scope\.notProvidedReason"/)
  assert.doesNotMatch(notProvided, /<(?:button|input|select|textarea)\b/)

  const interactiveTags = [...settingsHtml.matchAll(/<(?:button|input|select)\b[^>]*>/g)]
    .map((match) => match[0])
  for (const tag of interactiveTags) {
    assert.doesNotMatch(tag, /\bid="[^"]*(?:generate|accept|review|confirm)[^"]*"/i)
  }
  const buttonBodies = [...settingsHtml.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
  for (const button of buttonBodies) {
    assert.doesNotMatch(button, /(?:\bgenerate\b|\breview\b|\baccept\b|生成|审阅|接受)/i)
  }
  assert.doesNotMatch(
    source,
    /(?:\/api\/generate-character|\/accept\b|reviewedRunId|confirmLiveGeneration)/,
  )
})

test('Studio Settings never seeds or echoes an API key and translates every marker', async () => {
  const [html, source] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
  ])

  const apiKeyInput = openingTagForId(html, 'studio-runtime-api-key')
  assert.match(apiKeyInput, /\btype="password"/)
  assert.match(apiKeyInput, /\bautocomplete="new-password"/)
  assert.doesNotMatch(apiKeyInput, /\bvalue\s*=/)
  assert.match(source, /if \(apiKeyInput\) apiKeyInput\.value = ''/)
  assert.doesNotMatch(`${html}\n${source}`, /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,})/)
  assert.match(html, /<option value="" selected disabled[^>]*data-studio-i18n="common\.loading"/)
  assert.match(html, /<option value="gemini">Gemini<\/option>/)
  const primaryProviderStart = html.indexOf('id="provider-title"')
  const advancedProviderStart = html.indexOf('id="studio-advanced-provider"')
  const primaryProviderHtml = html.slice(primaryProviderStart, advancedProviderStart)
  const advancedProviderHtml = html.slice(advancedProviderStart, html.indexOf('</details>', advancedProviderStart))
  assert.doesNotMatch(primaryProviderHtml, /<option value="openrouter(?:_compatible)?"/)
  assert.match(advancedProviderHtml, /<option value="openrouter"/)
  assert.match(advancedProviderHtml, /<option value="openrouter_compatible"/)
  assert.doesNotMatch(advancedProviderHtml, /<option value="gemini"/)
  assert.doesNotMatch(html, /class="conditional-field"/)
  assert.match(source, /const exactProvider = 'gemini'/)
  assert.match(source, /DEFAULT_RUNTIME_MODELS\.gemini/)
  assert.doesNotMatch(source, /CUSTOM_COMPATIBLE_PROVIDER/)
  assert.match(source, /if \(!provider\) \{[\s\S]*settings\.provider\.providerRequired/)
  assert.match(html, /data-studio-i18n="settings\.provider\.supportedLabel">Studio 配置目标/)
  assert.equal(STUDIO_TRANSLATIONS.zh['settings.provider.supportedLabel'], 'Studio 配置目标')
  assert.equal(STUDIO_TRANSLATIONS.en['settings.provider.supportedLabel'], 'Studio configuration target')
  assert.match(
    source,
    /providerActionPending = 'save'[\s\S]*setProviderControlsLoading\(true\)[\s\S]*renderProviderState\(\)/,
  )
  assert.match(
    source,
    /providerActionPending = 'clear'[\s\S]*setProviderControlsLoading\(true\)[\s\S]*renderProviderState\(\)/,
  )
  assert.match(source, /lastResolvedProvider = provider/)
  assert.match(
    source,
    /queueMicrotask\(\(\) => \{[\s\S]*providerSnapshot\.provider === provider[\s\S]*restoreProviderControlAvailability\(\)/,
  )
  assert.match(
    source,
    /lastResolvedProvider\.runtime_configured === true && lastResolvedProvider\.provider === 'gemini'/,
  )
  assert.match(
    source,
    /lastResolvedProvider\.runtime_configured === true && ADVANCED_PROVIDER_TYPES\.has\(lastResolvedProvider\.provider\)/,
  )

  const translationKeys = new Set(
    [...html.matchAll(/data-studio-i18n(?:-[a-z-]+)?="([^"]+)"/g)]
      .map((match) => match[1]),
  )
  for (const language of ['zh', 'en']) {
    for (const key of translationKeys) {
      assert.ok(
        Object.hasOwn(STUDIO_TRANSLATIONS[language], key),
        `missing ${language} Studio translation for ${key}`,
      )
    }
  }

  assert.equal(STUDIO_TRANSLATIONS.zh['settings.scope.title'], '设置范围')
  assert.equal(STUDIO_TRANSLATIONS.zh['settings.provider.title'], '切换到原生 Gemini')
  assert.doesNotMatch(
    `${STUDIO_TRANSLATIONS.zh['settings.provider.saving']}\n${STUDIO_TRANSLATIONS.en['settings.provider.saving']}`,
    /浏览器会话|browser-session/,
  )
  assert.equal(STUDIO_TRANSLATIONS.en['nav.mainLabel'], 'Main navigation')

  const nativeRoute = currentProviderRoutePresentation({
    kind: 'resolved',
    provider: {
      status: 'ready',
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      presets: [{
        id: 'gemini_native_1',
        available: true,
        provider: 'gemini',
        route_kind: 'google_native',
        supports_image_size: true,
        image_config: { image_size: '2K', aspect_ratio: '1:1' },
      }],
    },
  }, {})
  const sharedSnapshot = {
    kind: 'resolved',
    provider: {
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'openrouter',
      model: 'example/model',
    },
  }
  const undisclosedSharedRoute = currentProviderRoutePresentation(sharedSnapshot, {}, null)
  const sharedRoute = currentProviderRoutePresentation(sharedSnapshot, {}, 'openrouter')
  const compatibleRoute = currentProviderRoutePresentation(sharedSnapshot, {}, 'openrouter_compatible')
  const undisclosedEnvironmentRoute = currentProviderRoutePresentation({
    ...sharedSnapshot,
    provider: { ...sharedSnapshot.provider, runtime_configured: false },
  }, {}, null)
  assert.equal(nativeRoute.state, 'ready')
  assert.match(nativeRoute.route, /gemini/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.currentRoute.undisclosedRoute'],
    STUDIO_TRANSLATIONS.en['settings.currentRoute.undisclosedRoute'],
  ].includes(undisclosedSharedRoute.route))
  assert.doesNotMatch(undisclosedSharedRoute.route, /openrouter|example\/model/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.currentRoute.undisclosedRoute'],
    STUDIO_TRANSLATIONS.en['settings.currentRoute.undisclosedRoute'],
  ].includes(undisclosedEnvironmentRoute.route))
  assert.doesNotMatch(undisclosedEnvironmentRoute.route, /openrouter|example\/model/)
  assert.equal(sharedRoute.state, 'idle')
  assert.match(sharedRoute.route, /openrouter/)
  assert.match(compatibleRoute.route, /openrouter_compatible/)
  assert.notEqual(nativeRoute.impact, sharedRoute.impact)
  assert.match(STUDIO_TRANSLATIONS.zh['settings.currentRoute.description'], /已配置.*不代表已实测连接/)
  assert.match(STUDIO_TRANSLATIONS.en['settings.currentRoute.description'], /configured.*does not mean a live connection was tested/i)
  assert.match(STUDIO_TRANSLATIONS.zh['settings.advancedProvider.save'], /保存配置/)
  assert.match(STUDIO_TRANSLATIONS.en['settings.advancedProvider.save'], /Save configuration/)
  assert.equal(STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedDetail'].includes('配置已保存（未启用生成）'), true)
  assert.match(STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedDetail'], /Configuration saved \(generation not enabled\)/)
  assert.equal(STUDIO_TRANSLATIONS.zh['settings.advancedProvider.saveFailed'], '配置保存失败')
  assert.equal(STUDIO_TRANSLATIONS.en['settings.advancedProvider.saveFailed'], 'Configuration save failed')
  assert.doesNotMatch(
    `${STUDIO_TRANSLATIONS.zh['settings.advancedProvider.save']}\n${STUDIO_TRANSLATIONS.en['settings.advancedProvider.save']}`,
    /保存并激活|Save and activate/,
  )
  assert.doesNotMatch(
    [
      STUDIO_TRANSLATIONS.zh['settings.advancedProvider.save'],
      STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedBadge'],
      STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedDetail'],
      STUDIO_TRANSLATIONS.zh['settings.provider.nonGeminiBadge'],
    ].join('\n'),
    /已激活|当前会话已激活|保存并激活/,
  )
  assert.doesNotMatch(
    [
      STUDIO_TRANSLATIONS.en['settings.advancedProvider.save'],
      STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedBadge'],
      STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedDetail'],
      STUDIO_TRANSLATIONS.en['settings.provider.nonGeminiBadge'],
    ].join('\n'),
    /Save and activate|already active for this session|Activated\b/,
  )

  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  assert.match(css, /--success:\s*#89d185/)
  assert.match(css, /--warning:\s*#cca700/)
  assert.match(css, /button:disabled, input:disabled, select:disabled, textarea:disabled \{ cursor: not-allowed;/)
  assert.match(css, /\.provider-fields select:disabled \{ cursor: not-allowed;/)
  assert.match(css, /\[data-pending="true"\]:disabled \{ cursor: wait; \}/)
  assert.match(
    css,
    /@media \(max-width: 560px\)[\s\S]*\.provider-actions \{[^}]*flex-direction: column/,
  )
})

test('Studio other Provider config keeps Gemini primary, clears secrets, and hides raw errors', async () => {
  const [html, settingsView, providerConfig] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
    readFile('src/ui/providerConfig.js', 'utf8'),
  ])
  const start = html.indexOf('id="studio-advanced-provider"')
  const end = html.indexOf('id="studio-action-view"', start)
  assert.ok(start > 0 && end > start)
  const advancedHtml = html.slice(start, end)

  assert.match(html, /id="studio-runtime-provider"[\s\S]*<option value="gemini">Gemini<\/option>/)
  assert.match(advancedHtml, /value="openrouter"/)
  assert.match(advancedHtml, /value="openrouter_compatible"/)
  assert.doesNotMatch(advancedHtml, /option value="gemini"/)
  assert.match(advancedHtml, /AI 生成[\s\S]*仅 Gemini 可用/)
  assert.match(advancedHtml, /Scene 在线生成[\s\S]*仅 Gemini 可用/)
  assert.match(advancedHtml, /Character Strict[\s\S]*原生 Gemini/)
  assert.match(advancedHtml, /Tiles AI[\s\S]*原生 Gemini/)
  assert.match(html, /id="studio-advanced-technical-details"/)
  assert.match(html, /id="studio-gemini-technical-details"/)
  assert.match(html, /aria-controls="studio-advanced-technical-error"/)
  assert.match(settingsView, /if \(!validation\.valid\) \{[\s\S]*clearAdvancedProviderSecret/)
  assert.match(settingsView, /finally \{[\s\S]*clearAdvancedProviderSecret/)
  assert.match(settingsView, /postProviderConfig\(validation\.payload\)/)
  assert.match(settingsView, /postProviderConfig\(\{ clear: true \}\)/)
  assert.match(settingsView, /kind: 'error', technical:/)
  assert.doesNotMatch(settingsView, /studioT\('settings\.provider\.actionError', \{ error:/)
  assert.doesNotMatch(settingsView, /studioT\('settings\.advancedProvider\.saveFailed', \{ error:/)
  assert.doesNotMatch(settingsView, /localStorage\.(?:setItem|getItem)\([^)]*(?:api|key|provider)/i)
  assert.doesNotMatch(providerConfig, /showToast\(error\.message\)/)
  assert.match(providerConfig, /clearRuntimeApiKey\(config\)/)

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

test('Studio generation-ready follows eligible native Gemini presets, not only the active route', async () => {
  const source = await readFile('src/ui/studio/settingsView.js', 'utf8')
  assert.match(source, /const generationReady = studioHasEligibleNativeGeminiPreset\(provider\)/)
  assert.match(source, /selectStrictGeminiPreset\(providerState\)/)
  assert.match(source, /async function saveAdvancedProvider[\s\S]*providerSnapshot = \{ kind: 'saving' \}[\s\S]*notifyStudioProviderSnapshotListeners/)
  assert.match(source, /async function clearAdvancedProvider[\s\S]*providerSnapshot = \{ kind: 'clearing' \}[\s\S]*notifyStudioProviderSnapshotListeners/)
  assert.doesNotMatch(source, /const generationReady = nativeGemini\s*\|\|/)
  assert.match(
    source,
    /environmentAdvanced[\s\S]*advancedProviderRouteIsUndisclosed/,
  )

  const geminiPreset = {
    id: 'gemini_native_1',
    available: true,
    provider: 'gemini',
    route_kind: 'google_native',
    model: 'gemini-2.5-flash-image',
    supports_image_size: true,
    image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
  }
  const openRouterPreset = {
    id: 'openrouter-default',
    available: true,
    provider: 'openrouter',
    route_kind: 'openrouter',
    model: 'example/model',
  }
  const pureGemini = {
    kind: 'resolved',
    provider: {
      status: 'ready',
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      presets: [geminiPreset],
    },
  }
  const geminiEmptyPresets = {
    kind: 'resolved',
    provider: {
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      presets: [],
    },
  }
  const geminiUnavailablePlusOpenRouter = {
    kind: 'resolved',
    provider: {
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      presets: [
        { ...geminiPreset, available: false },
        openRouterPreset,
      ],
    },
  }
  const sessionOpenRouter = {
    kind: 'resolved',
    provider: {
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'openrouter',
      model: 'example/model',
      presets: [openRouterPreset],
    },
  }
  const environmentOpenRouter = {
    kind: 'resolved',
    provider: {
      ...sessionOpenRouter.provider,
      runtime_configured: false,
    },
  }
  const mixedActiveOpenRouter = {
    kind: 'resolved',
    provider: {
      status: 'ready',
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'openrouter',
      model: 'example/model',
      presets: [openRouterPreset, geminiPreset],
    },
  }

  assert.equal(studioHasEligibleNativeGeminiPreset(pureGemini.provider), true)
  assert.equal(studioHasEligibleNativeGeminiPreset(geminiEmptyPresets.provider), false)
  assert.equal(studioHasEligibleNativeGeminiPreset(geminiUnavailablePlusOpenRouter.provider), false)
  assert.equal(studioHasEligibleNativeGeminiPreset(sessionOpenRouter.provider), false)
  assert.equal(studioHasEligibleNativeGeminiPreset(mixedActiveOpenRouter.provider), true)
  assert.equal(studioHasEligibleNativeGeminiPreset({
    presets: [{ ...geminiPreset, id: '../escape' }],
  }), false)
  assert.equal(studioHasEligibleNativeGeminiPreset({
    ...pureGemini.provider,
    status: 'idle',
  }), false)
  assert.equal(studioHasEligibleNativeGeminiPreset({
    status: 'ready',
    presets: [{ ...geminiPreset, supports_image_size: false }],
  }), false)
  assert.equal(studioHasEligibleNativeGeminiPreset({
    status: 'ready',
    presets: [{ ...geminiPreset, image_config: { image_size: '1K', aspect_ratio: '1:1' } }],
  }), false)
  assert.equal(studioHasEligibleNativeGeminiPreset({
    status: 'ready',
    presets: [{ ...geminiPreset, image_config: { image_size: '2K', aspect_ratio: '16:9' } }],
  }), false)

  const geminiRoute = currentProviderRoutePresentation(pureGemini, {}, null)
  const emptyGeminiRoute = currentProviderRoutePresentation(geminiEmptyPresets, {}, null)
  const unavailableGeminiRoute = currentProviderRoutePresentation(geminiUnavailablePlusOpenRouter, {}, null)
  const sessionRoute = currentProviderRoutePresentation(sessionOpenRouter, {}, 'openrouter')
  const environmentRoute = currentProviderRoutePresentation(environmentOpenRouter, {}, null)
  const mixedRoute = currentProviderRoutePresentation(mixedActiveOpenRouter, {}, 'openrouter')

  assert.equal(geminiRoute.state, 'ready')
  assert.match(geminiRoute.route, /gemini/)
  assert.match(geminiRoute.impact, /Native Gemini|原生 Gemini/)

  assert.equal(emptyGeminiRoute.state, 'idle')
  assert.match(emptyGeminiRoute.route, /gemini/)
  assert.match(emptyGeminiRoute.impact, /remain locked|保持锁定/)
  assert.doesNotMatch(emptyGeminiRoute.badge, /Service session|服务会话|Local environment|本地环境/)

  assert.equal(unavailableGeminiRoute.state, 'idle')
  assert.match(unavailableGeminiRoute.route, /gemini/)
  assert.match(unavailableGeminiRoute.impact, /remain locked|保持锁定/)

  assert.equal(sessionRoute.state, 'idle')
  assert.match(sessionRoute.route, /openrouter/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedBadge'],
    STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedBadge'],
  ].includes(sessionRoute.badge))
  assert.match(sessionRoute.impact, /service-session configuration was saved|服务会话配置已保存/)
  assert.doesNotMatch(sessionRoute.impact, /Environment configuration detected|检测到环境配置/)

  assert.equal(environmentRoute.state, 'idle')
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.currentRoute.undisclosedRoute'],
    STUDIO_TRANSLATIONS.en['settings.currentRoute.undisclosedRoute'],
  ].includes(environmentRoute.route))
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.advancedProvider.environmentBadge'],
    STUDIO_TRANSLATIONS.en['settings.advancedProvider.environmentBadge'],
  ].includes(environmentRoute.badge))
  assert.match(environmentRoute.impact, /Environment configuration was detected|检测到环境配置/)
  assert.match(environmentRoute.impact, /This is not a saved service-session replacement|这不是“配置已保存 \/ 服务会话已替换”/)
  assert.doesNotMatch(environmentRoute.impact, /^(Configuration saved|配置已保存)/)
  assert.doesNotMatch(environmentRoute.badge, /Configuration saved|配置已保存|Saved ·|已保存/)

  assert.equal(mixedRoute.state, 'ready')
  assert.match(mixedRoute.route, /openrouter/)
  assert.doesNotMatch(mixedRoute.route, /gemini_native/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.provider.usesNativeGeminiBadge'],
    STUDIO_TRANSLATIONS.en['settings.provider.usesNativeGeminiBadge'],
  ].includes(mixedRoute.badge))
  assert.match(mixedRoute.impact, /eligible native Gemini preset|合格的原生 Gemini preset/)
  assert.doesNotMatch(mixedRoute.impact, /stay locked|保持锁定/)

  const emptyGeminiCard = providerPresentation(geminiEmptyPresets)
  const unavailableGeminiCard = providerPresentation(geminiUnavailablePlusOpenRouter)
  const environmentMainCard = providerPresentation(environmentOpenRouter)
  const sessionMainCard = providerPresentation(sessionOpenRouter)
  assert.equal(emptyGeminiCard.state, 'idle')
  assert.match(emptyGeminiCard.detail, /No eligible native Gemini preset|没有合格的原生 Gemini preset/)
  assert.equal(unavailableGeminiCard.state, 'idle')
  assert.match(unavailableGeminiCard.detail, /No eligible native Gemini preset|没有合格的原生 Gemini preset/)
  assert.equal(environmentMainCard.state, 'idle')
  assert.match(environmentMainCard.detail, /Environment configuration was detected|检测到环境配置/)
  assert.doesNotMatch(environmentMainCard.detail, /^(The current service-session configuration|当前服务会话配置)/)
  assert.match(sessionMainCard.detail, /service-session configuration is not native Gemini|当前服务会话配置不是原生 Gemini/)

  const sessionCard = advancedProviderPresentation({
    serviceAvailable: true,
    advancedSnapshot: { kind: 'idle' },
    snapshot: sessionOpenRouter,
    provider: sessionOpenRouter.provider,
    selectedAdvancedRoute: 'openrouter',
  })
  const environmentCard = advancedProviderPresentation({
    serviceAvailable: true,
    advancedSnapshot: { kind: 'idle' },
    snapshot: environmentOpenRouter,
    provider: environmentOpenRouter.provider,
    selectedAdvancedRoute: null,
  })
  const mixedCard = advancedProviderPresentation({
    serviceAvailable: true,
    advancedSnapshot: { kind: 'idle' },
    snapshot: mixedActiveOpenRouter,
    provider: mixedActiveOpenRouter.provider,
    selectedAdvancedRoute: 'openrouter',
  })
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedBadge'],
    STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedBadge'],
  ].includes(sessionCard.badge))
  assert.match(sessionCard.detail, /Configuration saved \(generation not enabled\)|配置已保存（未启用生成）/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.advancedProvider.environmentBadge'],
    STUDIO_TRANSLATIONS.en['settings.advancedProvider.environmentBadge'],
  ].includes(environmentCard.badge))
  assert.match(environmentCard.detail, /Environment configuration detected, but it is not connected to Studio generation|检测到环境配置，但未接入 Studio 生成/)
  assert.doesNotMatch(
    `${environmentCard.badge}\n${environmentCard.detail}`,
    /Configuration saved|service session was replaced|配置已保存|服务会话已替换|服务会话配置已被替换|Saved · route undisclosed|已保存 · 路线未披露/,
  )
  assert.doesNotMatch(
    `${environmentRoute.badge}\n${environmentRoute.source}\n${environmentMainCard.badge}\n${environmentCard.badge}\n${environmentCard.detail}`,
    /Configuration saved|service session was replaced|配置已保存|服务会话已替换|服务会话配置已被替换/,
  )
  assert.match(environmentMainCard.detail, /This is not a saved service-session replacement|这不是“配置已保存 \/ 服务会话已替换”/)
  assert.ok([
    STUDIO_TRANSLATIONS.zh['settings.advancedProvider.savedBadge'],
    STUDIO_TRANSLATIONS.en['settings.advancedProvider.savedBadge'],
  ].includes(mixedCard.badge))
  assert.match(mixedCard.detail, /Configuration saved \(generation not enabled\)|配置已保存（未启用生成）/)

  assert.match(STUDIO_TRANSLATIONS.zh['settings.advancedProvider.environmentDetail'], /检测到环境配置，但未接入 Studio 生成/)
  assert.match(STUDIO_TRANSLATIONS.en['settings.advancedProvider.environmentDetail'], /Environment configuration detected, but it is not connected to Studio generation/)
})
