import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  LEGACY_STUDIO_TAB_ROUTES,
  legacyStudioRedirectLocation,
} from '../src/server/legacyStudioRedirect.js'
import {
  STUDIO_TRANSLATIONS,
  currentProviderRoutePresentation,
} from '../src/ui/studio/settingsView.js'

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

  assert.match(html, /data-design-source="figma:ro8w6TKkpd969zW2V5bmkx\/749:4446"/)
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
    prompts: 'scene',
  })
  assert.equal(
    legacyStudioRedirectLocation('?tab=two-point-five-d'),
    '/src/ui/studio/studio.html#tiles',
  )
  assert.equal(
    legacyStudioRedirectLocation('?tab=prompts'),
    '/src/ui/studio/studio.html?open=scene-prompt#scene',
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
      available: true,
      implemented: true,
      runtime_configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
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
  assert.equal(sharedRoute.state, 'ready')
  assert.match(sharedRoute.route, /openrouter/)
  assert.match(compatibleRoute.route, /openrouter_compatible/)
  assert.notEqual(nativeRoute.impact, sharedRoute.impact)
  assert.match(STUDIO_TRANSLATIONS.zh['settings.currentRoute.description'], /已配置.*不代表已实测连接/)
  assert.match(STUDIO_TRANSLATIONS.en['settings.currentRoute.description'], /configured.*does not mean a live connection was tested/i)

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
