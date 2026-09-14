import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  QA_COPY,
  QA_ITEM_COUNT,
  createInitialQaState,
  deriveQaPresentation,
  qaT,
  updateQaItem,
} from '../src/ui/studio/qaView.js'

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

test('QA presentation derives Default, In Progress, and Complete only from five manual checks', () => {
  let state = createInitialQaState()
  assert.equal(QA_ITEM_COUNT, 5)
  assert.deepEqual(state.checked, [false, false, false, false, false])
  assert.deepEqual(
    deriveQaPresentation(state),
    {
      checked: [false, false, false, false, false],
      count: 0,
      remaining: 5,
      phase: 'default',
      progressStateKey: 'stateDefault',
    },
  )

  state = updateQaItem(state, 2, true)
  assert.deepEqual(
    deriveQaPresentation(state),
    {
      checked: [false, false, true, false, false],
      count: 1,
      remaining: 4,
      phase: 'in_progress',
      progressStateKey: 'statePartial',
    },
  )

  for (const index of [0, 1, 3, 4]) state = updateQaItem(state, index, true)
  assert.equal(deriveQaPresentation(state).phase, 'complete')
  assert.equal(deriveQaPresentation(state).count, 5)

  state = updateQaItem(state, 1, false)
  assert.equal(deriveQaPresentation(state).phase, 'in_progress')
  assert.equal(deriveQaPresentation(state).remaining, 1)
  assert.equal(qaT('sessionCount', { count: 4 }, 'zh'), '会话内 · 4/5')
  assert.equal(qaT('sessionCount', { count: 4 }, 'en'), 'Session · 4/5')
  assert.match(QA_COPY.zh.boundaryRule2Title, /^QA 勾选/)
  assert.match(QA_COPY.en.boundaryRule2Body, /^Checking or unchecking/)
})

test('Studio QA matches the approved Current frames as the sole QA surface', async () => {
  const [html, app, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const qaStart = html.indexOf('id="studio-qa-view"')
  const qaEnd = html.indexOf('id="studio-character-view"', qaStart)
  assert.ok(qaStart >= 0 && qaEnd > qaStart, 'Studio QA view is missing')
  const qaHtml = html.slice(qaStart, qaEnd)

  assert.match(
    openingTagForId(html, 'studio-qa-view'),
    /data-design-source="figma:ro8w6TKkpd969zW2V5bmkx\/955:4573,957:4580,957:4754"/,
  )
  assert.equal((qaHtml.match(/\bdata-qa-item(?:\s|>)/g) ?? []).length, 5)
  assert.equal((qaHtml.match(/class="qa-check-input" type="checkbox"/g) ?? []).length, 5)
  assert.match(qaHtml, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="5"/)
  assert.match(qaHtml, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.doesNotMatch(qaHtml, /id="studio-qa-status-number"|id="studio-qa-status-count"/)
  assert.match(qaHtml, /<details class="card qa-boundary-card technical-disclosure"/)
  assert.equal((qaHtml.match(/data-qa-language="(?:zh|en)"/g) ?? []).length, 2)
  assert.doesNotMatch(qaHtml, /data-studio-server-required/)
  assert.doesNotMatch(qaHtml, /<(?:button|a)[^>]*(?:pass|accept|export|release|project)/i)

  assert.match(app, /Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /initStudioQa\(\)/)
  assert.match(app, /activeRoute === 'qa'\) renderStudioQaLanguage\(\)/)
  assert.match(css, /\.qa-grid \{[^}]*grid-template-columns: minmax\(0,1192fr\) minmax\(360px,600fr\)/)
  assert.match(css, /\.qa-checklist \{[^}]*gap: 12px[^}]*padding: 13px 20px 0/)
  assert.doesNotMatch(css, /\.qa-status-(?:card|summary)|\.qa-interaction-rules|#studio-qa-status-/)
  assert.match(css, /\.qa-checklist > li\.is-checked \{[^}]*border-color: var\(--brand\)[^}]*background:/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.qa-topbar \.qa-language \{ display: inline-flex/)
})

test('QA implementation is session-only and has no service or release side effects', async () => {
  const source = await readFile('src/ui/studio/qaView.js', 'utf8')

  assert.match(source, /createInitialQaState\(\)[\s\S]*Array\(QA_ITEM_COUNT\)\.fill\(false\)/)
  assert.match(source, /input\.addEventListener\('change'/)
  assert.match(
    source,
    /button\.addEventListener\('click', \(\) => \{\s*setCurrentLanguage\(button\.dataset\.qaLanguage\)\s*translateStudioDocument\(document, getCurrentLanguage\(\)\)\s*renderStudioQa\(qaState\)/,
  )
  assert.match(
    source,
    /root\.querySelectorAll\('\[data-qa-language\]'\)[\s\S]*button\.setAttribute\('aria-pressed', String\(active\)\)/,
  )
  assert.match(
    source,
    /root\.querySelectorAll\('\[data-qa-copy-aria-label\]'\)[\s\S]*element\.setAttribute\('aria-label', qaT\(element\.dataset\.qaCopyAriaLabel/,
  )
  assert.match(source, /count === 0 \? 'default' : count === QA_ITEM_COUNT \? 'complete' : 'in_progress'/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/)
  assert.doesNotMatch(source, /\/api\//)
  assert.doesNotMatch(source, /(?:download|export|releaseReady|projectCandidate)\s*[=(]/)
})
