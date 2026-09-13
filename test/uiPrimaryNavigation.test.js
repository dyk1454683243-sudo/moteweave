import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const STUDIO_DESTINATIONS = [
  '#character',
  '#action',
  '#sequence',
  '#tiles',
  '#scene',
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
  assert.match(app, /Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.doesNotMatch(html, /href="\/legacy|data-tab=/)
  assert.match(server, /pathname === '\/legacy'[\s\S]*legacyStudioRedirectLocation\(requestUrl\.search\)/)
})

test('the retired root shell and its top-level DOM controllers are absent', async () => {
  for (const path of RETIRED_SHELL_FILES) {
    await assert.rejects(access(path), { code: 'ENOENT' })
  }
})
