import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const MODULE_CTA_IDS = Object.freeze([
  'character-local-primary',
  'character-primary-action',
  'studio-action-analyze',
  'studio-action-preview',
  'studio-action-build',
  'studio-action-apply',
  'studio-action-recover',
  'studio-sequence-primary',
  'studio-tiles-primary',
  'studio-scene-primary',
  'studio-project-primary',
])

const NON_MODULE_CTA_IDS = Object.freeze([
  'studio-save-provider-config',
  'studio-action-restore-auto',
  'studio-action-cancel',
  'studio-action-resume',
  'studio-action-source-set-apply',
  'character-calibration-use',
  'character-cut-confirm',
  'character-reset-action',
  'character-export-link',
  'studio-scene-export',
  'studio-project-export',
])

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function classList(tag) {
  return (tag.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
}

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1])
}

function mediaBlocks(css, query) {
  const re = new RegExp(`@media\\s*\\(${query.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\)\\s*\\{`, 'g')
  const blocks = []
  let match = re.exec(css)
  while (match) {
    let depth = 0
    for (let i = css.indexOf('{', match.index); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) {
          blocks.push(css.slice(match.index, i + 1))
          break
        }
      }
    }
    match = re.exec(css)
  }
  return blocks
}

test('Studio module primary CTAs share one tokenized class and stay brand-green', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])

  assert.match(css, /--studio-module-cta-min-height:\s*48px/)
  assert.match(css, /--studio-module-cta-inline-size:\s*100%/)
  assert.match(css, /--studio-module-cta-radius:\s*4px/)
  assert.match(css, /--studio-module-cta-font-size:\s*12px/)
  assert.match(css, /--studio-module-cta-font-weight:\s*600/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*align-self:\s*stretch/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*width:\s*var\(--studio-module-cta-inline-size\)/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*max-width:\s*none/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*min-height:\s*var\(--studio-module-cta-min-height\)/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*text-align:\s*center/)
  assert.match(css, /\.button\.primary\.studio-module-cta\s*\{[^}]*background:\s*var\(--brand\)/)
  assert.match(css, /\.button\.primary\.studio-module-cta:disabled\s*\{[^}]*opacity:\s*1/)
  assert.match(css, /\.button\.primary\.studio-module-cta:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  assert.match(css, /\.button\.primary\.studio-module-cta:is\(\[aria-busy="true"\], \[data-pending="true"\]\)/)
  assert.doesNotMatch(css, /\.button\.primary\.studio-module-cta:focus-visible\s*\{[^}]*(?:width|height|min-height|max-width)\s*:/)
  assert.doesNotMatch(css, /\.button\.primary\.studio-module-cta:disabled\s*\{[^}]*(?:width|height|min-height|max-width)\s*:/)
  assert.doesNotMatch(css, /\.button\.primary\.studio-module-cta:is\(\[aria-busy="true"\], \[data-pending="true"\]\)\s*\{[^}]*(?:width|height|min-height|max-width)\s*:/)
  assert.doesNotMatch(css, /\.tiles-main\[data-tiles-mode="ai"\] \.tiles-primary \{[^}]*#0e639c/)
  assert.doesNotMatch(css, /\.scene-primary \{[^}]*height:\s*30px/)
  assert.doesNotMatch(css, /\.project-primary \{[^}]*height:\s*28px/)
  assert.doesNotMatch(css, /\.sequence-primary-action\s*\{[^}]*width:\s*(?:248|224)px/)
  assert.doesNotMatch(css, /\.tiles-primary\s*\{[^}]*width:\s*248px/)
  assert.doesNotMatch(css, /@media \(max-width: 860px\)[\s\S]*?\.sequence-primary-action\s*\{[^}]*width:\s*(?:248|224)px/)
  assert.doesNotMatch(css, /@media \(max-width: 860px\)[\s\S]*?\.tiles-primary\s*\{[^}]*width:\s*248px/)
  assert.match(css, /\.sequence-primary-action\s*\{[^}]*width:\s*auto\s*!important/)
  assert.match(css, /\.tiles-primary\s*\{[^}]*left:\s*0[^}]*right:\s*0[^}]*width:\s*auto\s*!important/)
  assert.match(css, /\.scene-primary\s*\{[^}]*width:\s*100%\s*!important/)
  assert.match(css, /\.project-primary\s*\{[^}]*width:\s*100%\s*!important/)
  assert.match(css, /\.action-primary-actions \.studio-module-cta\s*\{[^}]*width:\s*100%/)
  assert.match(css, /\.character-local-primary\s*\{[^}]*width:\s*100%/)
  assert.match(css, /\.character-primary-action\s*\{[^}]*width:\s*100%/)
  assert.doesNotMatch(css, /\.button\.secondary[^{]*\{[^}]*--studio-module-cta-inline-size/)
  assert.doesNotMatch(css, /#character-export-link[^{]*\{[^}]*--studio-module-cta-inline-size/)
  assert.doesNotMatch(css, /#studio-save-provider-config[^{]*\{[^}]*width:\s*100%/)
  assert.doesNotMatch(css, /#studio-action-restore-auto[^{]*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /\.action-primary-actions \.button\.secondary[^{]*\{[^}]*min-height:\s*var\(--studio-module-cta-min-height\)/)

  for (const id of MODULE_CTA_IDS) {
    const tag = openingTagForId(html, id)
    assert.ok(tag, `${id} must exist`)
    assert.ok(classList(tag).includes('studio-module-cta'), `${id} must use studio-module-cta`)
    assert.ok(classList(tag).includes('button'), `${id} must remain a button`)
    assert.ok(classList(tag).includes('primary'), `${id} must remain primary`)
  }

  for (const id of NON_MODULE_CTA_IDS) {
    const tag = openingTagForId(html, id)
    assert.ok(tag, `${id} must exist`)
    assert.ok(!classList(tag).includes('studio-module-cta'), `${id} must not become a module CTA`)
  }

  assert.doesNotMatch(html, /id="studio-qa-[^"]*primary"|class="[^"]*qa-primary/)
  assert.match(html, /id="studio-action-analyze"/)
  assert.match(html, /id="studio-tiles-primary"/)
  assert.match(html, /id="studio-sequence-primary"/)
})

test('Studio module primary CTAs fill owning columns without leftover 248px widths', async () => {
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  const button = ruleBodies(css, '.button')[0] ?? ''
  assert.match(button, /display:\s*inline-flex/)
  assert.match(button, /align-items:\s*center/)
  assert.match(button, /justify-content:\s*center/)

  const shared = ruleBodies(css, '.button.primary.studio-module-cta')[0] ?? ''
  assert.match(shared, /min-height:\s*var\(--studio-module-cta-min-height\)/)
  assert.match(shared, /height:\s*auto/)
  assert.match(shared, /text-align:\s*center/)
  assert.match(shared, /align-self:\s*stretch/)

  const scenePanel = ruleBodies(css, '.scene-control-panel')
  assert.ok(scenePanel.some((body) => /padding:\s*12px\s+0\s+0/.test(body) || /padding-inline:\s*0/.test(body)))
  assert.ok(!scenePanel.some((body) => /padding:\s*12px\s+12px/.test(body)))
  const sceneOthers = ruleBodies(css, '.scene-control-panel > :not(.scene-primary)')
  assert.ok(sceneOthers.some((body) => /margin-inline:\s*12px/.test(body)))

  const projectPanel = ruleBodies(css, '.project-control-panel')
  assert.ok(projectPanel.some((body) => /padding:\s*12px\s+0\s+0/.test(body) || /padding-inline:\s*0/.test(body)))
  assert.ok(!projectPanel.some((body) => /padding:\s*12px\s*;/.test(body)))
  const projectOthers = ruleBodies(css, '.project-control-panel > :not(.project-primary)')
  assert.ok(projectOthers.some((body) => /margin-inline:\s*12px/.test(body)))

  const sequence = ruleBodies(css, '.sequence-primary-action')
  assert.ok(sequence.length > 0)
  for (const body of sequence) {
    assert.doesNotMatch(body, /(?:max-)?width:\s*(?:248|224)px/)
    assert.doesNotMatch(body, /height:\s*(?:28|30|32|36)px/)
  }
  assert.ok(sequence.some((body) => /left:\s*0/.test(body) && /right:\s*0/.test(body) && /width:\s*auto\s*!important/.test(body) && /max-width:\s*none/.test(body)))

  const tiles = ruleBodies(css, '.tiles-primary')
  assert.ok(tiles.length > 0)
  for (const body of tiles) {
    assert.doesNotMatch(body, /(?:max-)?width:\s*(?:248|224)px/)
    assert.doesNotMatch(body, /height:\s*(?:28|30|32|36)px/)
  }
  assert.ok(tiles.some((body) => /left:\s*0/.test(body) && /right:\s*0/.test(body) && /width:\s*auto\s*!important/.test(body) && /max-width:\s*none/.test(body)))

  const mobile = mediaBlocks(css, 'max-width: 860px').join('\n')
  assert.ok(mobile)
  for (const body of ruleBodies(mobile, '.sequence-primary-action')) {
    assert.doesNotMatch(body, /(?:max-)?width:\s*(?:248|224)px/)
  }
  const mobileTiles = ruleBodies(mobile, '.tiles-primary')
  assert.ok(mobileTiles.length > 0)
  for (const body of mobileTiles) {
    assert.doesNotMatch(body, /(?:max-)?width:\s*(?:248|224)px/)
    assert.match(body, /left:\s*0/)
    assert.match(body, /right:\s*0/)
    assert.match(body, /width:\s*auto/)
    assert.match(body, /max-width:\s*none/)
  }

  for (const selector of ['.scene-primary', '.project-primary', '.sequence-primary-action', '.tiles-primary']) {
    for (const body of ruleBodies(css, selector)) {
      assert.doesNotMatch(body, /(?:min-)?height:\s*(?:28|30|32)px/)
    }
  }

  assert.doesNotMatch(css, /\.button\.secondary\s*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /#studio-save-provider-config[^{]*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /#character-export-link[^{]*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /#studio-scene-export[^{]*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /#studio-project-export[^{]*\{[^}]*--studio-module-cta/)
  assert.doesNotMatch(css, /#studio-action-cancel[^{]*\{[^}]*--studio-module-cta/)
})
