import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

import {
  CHARACTER_PRESETS,
  SCENE_PRESETS,
  buildCharacterPrompt,
  buildScenePrompt,
} from '../src/pixelPipeline.js'
import {
  PROMPT_ASSISTANT_COPY,
  PROMPT_ASSISTANT_DEFAULTS,
  buildCharacterAssistantPrompt,
  buildSceneAssistantPrompt,
  promptAssistantRequest,
  promptAssistantUrlWithoutRequest,
} from '../src/ui/studio/promptAssistantView.js'

function viewHtml(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`)
  const end = html.indexOf(`id="${nextId}"`, start)
  assert.ok(start >= 0 && end > start, `${id} view is missing`)
  return html.slice(start, end)
}

test('prompt helpers call the maintained deterministic builders with the Figma Current defaults', () => {
  assert.equal(
    buildCharacterAssistantPrompt(),
    buildCharacterPrompt(PROMPT_ASSISTANT_DEFAULTS.character),
  )
  assert.equal(
    buildSceneAssistantPrompt(),
    buildScenePrompt(PROMPT_ASSISTANT_DEFAULTS.scene),
  )
  assert.equal(PROMPT_ASSISTANT_DEFAULTS.character.preset, 'character-v2')
  assert.equal(PROMPT_ASSISTANT_DEFAULTS.character.hasReferenceImage, true)
  assert.equal(PROMPT_ASSISTANT_DEFAULTS.scene.view, 'topdown-front')
  assert.ok(Object.hasOwn(CHARACTER_PRESETS, PROMPT_ASSISTANT_DEFAULTS.character.preset))
  assert.ok(Object.hasOwn(SCENE_PRESETS, PROMPT_ASSISTANT_DEFAULTS.scene.view))
  assert.deepEqual(Object.keys(PROMPT_ASSISTANT_COPY.zh).sort(), Object.keys(PROMPT_ASSISTANT_COPY.en).sort())
})

test('the one-shot Scene helper request is exact, singleton, and removed without changing other URL parts', () => {
  assert.equal(promptAssistantRequest('?open=scene-prompt'), 'scene')
  for (const search of [
    '',
    '?open=character-prompt',
    '?open=scene-prompt&open=scene-prompt',
    '?open=scene-prompt%23character',
  ]) assert.equal(promptAssistantRequest(search), null)
  assert.equal(
    promptAssistantUrlWithoutRequest({ href: 'http://127.0.0.1:4173/src/ui/studio/studio.html?open=scene-prompt&keep=1#scene' }),
    '/src/ui/studio/studio.html?keep=1#scene',
  )
})

test('Character and Scene drawers match the Current design entries and expose only deterministic local actions', async () => {
  const [html, css, view, app] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/promptAssistantView.js', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
  ])
  const character = viewHtml(html, 'studio-character-view', 'toast')
  const scene = viewHtml(html, 'studio-scene-view', 'studio-project-view')

  assert.match(character, /id="studio-character-prompt-open"[^>]*975:5104/)
  assert.match(character, /id="studio-character-prompt-drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*971:9023[^>]*hidden/)
  assert.match(scene, /id="studio-scene-prompt-open"[^>]*977:5224/)
  assert.match(scene, /id="studio-scene-prompt-drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*977:5069[^>]*hidden/)
  for (const kind of ['character', 'scene']) {
    assert.match(html, new RegExp(`data-prompt-kind="${kind}" data-prompt-action="generate"`))
    assert.match(html, new RegExp(`data-prompt-kind="${kind}" data-prompt-action="copy"`))
    assert.match(html, new RegExp(`data-prompt-kind="${kind}" data-prompt-action="reset"`))
    assert.match(html, new RegExp(`id="studio-${kind}-prompt-output"[^>]*readonly`))
  }
  assert.match(scene, /id="studio-scene-prompt-character"/)
  assert.doesNotMatch(`${character}\n${scene}`, /data-prompt-action="(?:run|submit|save|fill|generate-image)"/)
  assert.doesNotMatch(view, /\bfetch\s*\(|localStorage|sessionStorage/)
  assert.match(view, /buildCharacterPrompt\(/)
  assert.match(view, /buildScenePrompt\(/)
  assert.match(view, /navigator\.clipboard\.writeText/)
  assert.match(app, /initStudioPromptAssistants\(\)/)
  assert.match(css, /\.prompt-assistant-drawer\s*\{[^}]*width:\s*min\(520px,100%\)[^}]*height:\s*100%/)
  assert.match(css, /\.scene-main\s*>\s*\.scene-workspace,[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*2;/)
  assert.match(css, /\.prompt-assistant-actions\s*\{[^}]*grid-template-columns:\s*140px 120px 120px/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.prompt-assistant-drawer\s*\{[^}]*width:\s*100%/)
})

test('prompt drawers preserve focus, inert the underlying workspace, localize ARIA, and close on Escape', async () => {
  const view = await readFile('src/ui/studio/promptAssistantView.js', 'utf8')
  assert.match(view, /ariaHidden: element\.getAttribute\('aria-hidden'\),[\s\S]*inert: element\.inert/)
  assert.match(view, /element\.inert = true[\s\S]*element\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(view, /for \(const \{ element, ariaHidden, inert \} of hiddenSiblings\)[\s\S]*element\.inert = inert/)
  assert.match(view, /setAttribute\('aria-expanded', 'true'\)/)
  assert.match(view, /setAttribute\('aria-expanded', 'false'\)/)
  assert.match(view, /titleId\)\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(view, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(view, /event\.key === 'Escape'[\s\S]*closeStudioPromptAssistant\(\)/)
  assert.match(view, /event\.shiftKey && \[title, first\]\.includes\(document\.activeElement\)[\s\S]*last\.focus\(\)/)
  assert.match(view, /data-prompt-copy-aria/)
  assert.match(view, /history\.replaceState\(null, '', promptAssistantUrlWithoutRequest/)
})

test('benchmark browser UI remains retired while its backend contract stays reachable', async () => {
  for (const path of [
    'index.html',
    'src/ui/characterPackTab.js',
    'src/ui/characterPack/api.js',
    'src/ui/characterPack/renderers.js',
    'src/ui/characterPack/workflows.js',
  ]) {
    await assert.rejects(access(path), { code: 'ENOENT' })
  }
  const [route, server, smoke] = await Promise.all([
    readFile('src/server/routes/character.js', 'utf8'),
    readFile('server.js', 'utf8'),
    readFile('scripts/smoke-local-ui.mjs', 'utf8'),
  ])
  assert.match(route, /url\.pathname === '\/api\/benchmark-gallery'/)
  assert.match(server, /buildBenchmarkGallery/)
  assert.match(smoke, /\/api\/benchmark-gallery/)
})
