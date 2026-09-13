import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

import {
  beginLocalCharacterRunState,
  canUseStandardLocalSource,
  createInitialLocalCharacterState,
  deriveLocalCharacterPresentation,
} from '../src/ui/studio/characterLocalView.js'

test('Studio promotion permanently redirects every legacy shell entry through fixed locations', async () => {
  const [server, html, smoke] = await Promise.all([
    readFile('server.js', 'utf8'),
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('scripts/smoke-local-ui.mjs', 'utf8'),
  ])

  assert.match(server, /if \(pathname === '\/' \|\| pathname === '\/index\.html'\) \{[\s\S]*res\.statusCode = 302[\s\S]*'location', '\/src\/ui\/studio\/studio\.html#character'/)
  assert.match(server, /legacyStudioRedirectLocation\(requestUrl\.search\)/)
  assert.match(server, /pathname === '\/legacy' \|\| pathname === '\/legacy\/' \|\| pathname === '\/legacy\.html'/)
  assert.doesNotMatch(server, /`\/legacy\$\{requestUrl\.search\}`|relativePath = 'index\.html'/)
  assert.doesNotMatch(server, /if \(pathname === '\/' \|\| pathname === '\/index\.html'\) \{\s*rootPath = __dirname/)
  assert.doesNotMatch(html, /href="\/legacy\?tab=(?:prompts|motion-source|project-pack)"/)
  assert.match(smoke, /fetch\(`\$\{baseUrl\}\/`, \{ redirect: 'manual' \}\)/)
  assert.match(smoke, /legacyRedirectCases/)
  for (const path of ['/legacy', '/legacy/', '/legacy.html']) {
    assert.match(smoke, new RegExp(`['"]${path.replaceAll('/', '\\/')}`))
  }
  assert.match(smoke, /legacyFallbackCases/)
  assert.match(smoke, /'character-pack', '\/src\/ui\/studio\/studio\.html#character'/)
  assert.match(smoke, /studio\.html\?open=scene-prompt#scene/)
  assert.match(smoke, /\?tab=qa&tab=motion-source/)
  assert.match(smoke, /\?tab=__proto__/)
  await assert.rejects(access('index.html'), { code: 'ENOENT' })
  await assert.rejects(access('src/app.js'), { code: 'ENOENT' })
})

test('Studio local Character state matrix permits only real build, same-Job resume, and verified export', () => {
  const empty = createInitialLocalCharacterState()
  assert.equal(deriveLocalCharacterPresentation(empty).action, 'blocked')
  assert.equal(deriveLocalCharacterPresentation({ ...empty, phase: 'ready' }).action, 'build')
  assert.equal(deriveLocalCharacterPresentation({ ...empty, phase: 'running' }).action, 'running')
  assert.equal(deriveLocalCharacterPresentation({ ...empty, phase: 'poll_paused' }).action, 'resume')
  assert.equal(deriveLocalCharacterPresentation({ ...empty, phase: 'submission_unknown' }).action, 'blocked')
  assert.equal(deriveLocalCharacterPresentation({ ...empty, phase: 'failed' }).action, 'build')
  const complete = deriveLocalCharacterPresentation({
    ...empty,
    phase: 'complete',
    result: { job: { zip_url: '/generated/job/character_pack.zip' } },
  })
  assert.equal(complete.action, 'export')
  assert.equal(complete.releaseReady, true)
})

test('Studio local Character closes advanced configuration before running and rejects JPEG in standard mode', () => {
  const empty = createInitialLocalCharacterState()
  const binding = { inputKey: 'current', inputEpoch: 1, processingMode: 'advanced' }
  const running = beginLocalCharacterRunState({ ...empty, advancedPanel: 'config' }, binding)
  assert.equal(running.phase, 'running')
  assert.equal(running.busy, 'submit')
  assert.equal(running.advancedPanel, null)
  assert.equal(running.binding, binding)
  assert.equal(canUseStandardLocalSource({ name: 'hero.jpg', type: 'image/jpeg', size: 4, arrayBuffer() {} }), false)
  assert.equal(canUseStandardLocalSource({ name: 'hero.png', type: 'image/png', size: 4, arrayBuffer() {} }), true)
})

test('Studio local Character UI binds real reports, previews, and individual engine packages without fake capability', async () => {
  const [html, css, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
  ])

  assert.match(css, /\.character-local-workspace \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\)/)
  assert.match(css, /\.character-local-stage \{[^}]*grid-template-rows: 36px minmax\(0, 1fr\) 104px/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.character-local-workspace \{[^}]*grid-template-columns: 1fr; grid-template-rows: auto auto/)
  assert.match(css, /\.character-local-file:focus-visible \+ \.character-local-drop,[\s\S]*\.character-local-file:focus-visible ~ \.character-local-source-card/)
  assert.match(html, /id="character-local-canvas"[^>]*width="960"[^>]*height="500"[^>]*aria-describedby="character-local-stage-help character-local-preview-state"[^>]*data-character-local-aria="previewAria"/)
  assert.match(html, /data-character-local-aria="sourceActionsAria"/)
  assert.match(html, /data-character-local-aria="defaultsAria"/)
  assert.doesNotMatch(html, /data-character-local-copy="profileId"/)
  assert.doesNotMatch(html, /id="character-local-empty-stage"/)
  assert.match(html, /id="character-local-quality-link"[^>]*target="_blank"/)
  for (const id of [
    'character-local-export-pack',
    'character-local-export-godot',
    'character-local-export-rpgmaker',
    'character-local-export-ocad',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.doesNotMatch(html, /id="character-local-export-(?:unity|tres)"/)
  assert.doesNotMatch(html, /id="character-local-(?:cancel|simulate)/)
  assert.match(view, /getMovementIntent\(preview\.keys, preview\.direction\)/)
  assert.match(view, /movePreviewActor\(preview\.position, intent/)
  assert.match(view, /sourceActionsAria: 'Source file actions'/)
  assert.match(view, /defaultsAria: 'Locked processing defaults'/)
  assert.match(view, /previewAria: 'Playable verified character preview\./)
  assert.match(view, /gridLocked: '8 × 8 · locked processing layout'/)
  assert.match(view, /defaultFps: 'FPS · defined per animation'/)
  assert.doesNotMatch(view, /profileId:|currentBinding:|setHidden\('character-local-empty-stage'/)
  assert.doesNotMatch(css, /\.character-local-profile code|\.character-local-empty-stage/)
  assert.doesNotMatch(`${html}\n${view}`, /FPS · 10|由锁定布局识别|detected from locked layout|网格识别使用/)
  assert.match(view, /primary\.disabled = [^\n]+!currentInputValid[^\n]+\['blocked', 'running'\]\.includes\(presentation\.action\)/)
  assert.match(api, /requestStudioCharacterJson\('\/api\/process-sheet'/)
  assert.doesNotMatch(`${view}\n${api}`, /\/api\/generate-character|characterPackTab|characterPack\/workflows/)
})

test('Studio local Character invalidates release before decode and discards out-of-order selections', async () => {
  const view = await readFile('src/ui/studio/characterLocalView.js', 'utf8')
  const start = view.indexOf('async function selectSource(file)')
  const end = view.indexOf('\nfunction clearSource(', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const selection = view.slice(start, end)
  const invalidateIndex = selection.indexOf('clearVerifiedResult()')
  const resetIndex = selection.indexOf("busy: 'decode'")
  const decodeIndex = selection.indexOf('await readImageDimensions(nextUrl)')
  assert.ok(invalidateIndex >= 0 && invalidateIndex < decodeIndex)
  assert.ok(resetIndex >= 0 && resetIndex < decodeIndex)
  assert.match(selection, /const selectionEpoch = \+\+sourceSelectionEpoch/)
  assert.match(selection, /if \(selectionEpoch !== sourceSelectionEpoch\) \{[\s\S]*revokeObjectURL/)
  assert.match(view, /function clearSource\([^)]*\) \{[\s\S]*sourceSelectionEpoch \+= 1/)
})
