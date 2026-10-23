import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'

const STUDIO_DESTINATIONS = [
  '#character',
  '#action',
  '#sequence',
  '#tiles',
  '#project',
  '#qa',
  '#settings',
]

const RETIRED_SHELL_FILES = [
  'index.html',
  'src/app.js',
  'src/styles.css',
  'src/ui/appState.js',
  'src/ui/characterPackTab.js',
  'src/ui/motionSourceTab.js',
  'src/ui/projectPackTab.js',
  'src/ui/promptTabs.js',
  'src/ui/scenePackPreview.js',
  'src/ui/spriteTab.js',
]

test('Studio is the sole primary navigation surface in the accepted rail order', async () => {
  const [html, app, server] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('server.js', 'utf8'),
  ])
  const railStart = html.indexOf('<aside class="icon-rail"')
  const railEnd = html.indexOf('</aside>', railStart)
  assert.ok(railStart >= 0 && railEnd > railStart)
  const rail = html.slice(railStart, railEnd)
  const offsets = STUDIO_DESTINATIONS.map((destination) => rail.indexOf(`href="${destination}"`))
  assert.ok(offsets.every((offset) => offset >= 0))
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right))
  assert.equal((rail.match(/class="rail-item/g) ?? []).length, 8)
  assert.match(rail, /href="#scene"[^>]*data-studio-route="scene"[^>]*hidden/)
  assert.match(rail, /data-studio-i18n="nav\.tiles">地图</)
  assert.match(app, /Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /if \(route === 'scene'\) return 'tiles'/)
  assert.doesNotMatch(html, /href="\/legacy|data-tab=/)
  assert.match(server, /pathname === '\/legacy'[\s\S]*legacyStudioRedirectLocation\(requestUrl\.search\)/)
})

test('the retired root shell and its top-level DOM controllers are absent', async () => {
  for (const path of RETIRED_SHELL_FILES) {
    await assert.rejects(access(path), { code: 'ENOENT' })
  }
})

test('Studio rail project copy is exactly 项目 / Project and never 产出', async () => {
  assert.equal(STUDIO_TRANSLATIONS.zh['nav.project'], '项目')
  assert.equal(STUDIO_TRANSLATIONS.en['nav.project'], 'Project')

  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const railStart = html.indexOf('<aside class="icon-rail"')
  const railEnd = html.indexOf('</aside>', railStart)
  assert.ok(railStart >= 0 && railEnd > railStart)
  const rail = html.slice(railStart, railEnd)
  assert.match(rail, /href="#project"[^>]*data-studio-route="project"/)
  assert.match(rail, /data-studio-i18n="nav\.project">项目</)
  assert.doesNotMatch(rail, /产出/)

  const railCopyKeys = [
    'nav.mainLabel',
    'nav.character',
    'nav.motion',
    'sequence.navLabel',
    'nav.tiles',
    'nav.scene',
    'nav.project',
    'nav.qa',
    'nav.settings',
  ]
  for (const key of railCopyKeys) {
    assert.doesNotMatch(STUDIO_TRANSLATIONS.zh[key], /产出/, `zh ${key} must not use 产出`)
    assert.doesNotMatch(STUDIO_TRANSLATIONS.en[key], /产出/, `en ${key} must not use 产出`)
  }
})

test('Studio Action uses the user-facing 取帧 / Extract rail label without changing its route', async () => {
  assert.equal(STUDIO_TRANSLATIONS.zh['nav.motion'], '取帧')
  assert.equal(STUDIO_TRANSLATIONS.en['nav.motion'], 'Extract')

  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const railStart = html.indexOf('<aside class="icon-rail"')
  const railEnd = html.indexOf('</aside>', railStart)
  assert.ok(railStart >= 0 && railEnd > railStart)
  const rail = html.slice(railStart, railEnd)
  assert.match(rail, /href="#action"[^>]*data-studio-route="action"/)
  assert.match(rail, /data-studio-i18n="nav\.motion">取帧</)
})
