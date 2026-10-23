import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { buildSprite, spriteBlockOf } from '../../src/ui/vnext/vnext-preview-sprite.mjs'
import {
  validateVnextReferenceFile,
  readVnextReferenceFile,
  decodeVnextReferenceBytes,
  createVnextReferenceDraft,
  timelineSummary,
  applyLoadedProjectBundle,
  applyReferenceDraftFile,
  applyModuleReferenceFile,
  referenceDraftName,
  renderReferenceSlot,
  bindVnextProjectSession,
  bootVnextPreview,
  canvasForImport,
  classifyCanvasDrop,
  VNEXT_IMPORT_PNG_MAX_BYTES,
  loadProjectBundle,
  concurrentLayoutBlocked,
  concurrentLayoutMessage,
  projectPixelsUnchanged,
  VNEXT_REFERENCE_MAX_BYTES,
  VNEXT_REFERENCE_ERRORS,
} from '../../src/ui/vnext/vnext-preview.js'
import { createVnextProjectClient, projectListViewModel, sha256Hex } from '../../src/ui/vnext/vnext-project-client.js'
import { bindDocumentTimeline } from '../../src/ui/vnext/vnext-document-timeline.js'
import { createUndonePlacementStore } from '../../src/ui/vnext/vnext-saved-project.js'

// Capability IDs that have a control on the home surface (capability matrix §9).
const SURFACE_CAPABILITY_IDS = [
  'HOME-00', 'HOME-01', 'HOME-02', 'HOME-03', 'HOME-04', 'HOME-05',
  'HOME-06', 'HOME-07', 'HOME-08', 'HOME-09', 'HOME-10',
  'GEN-01', 'GEN-02', 'GEN-03', 'GEN-04', 'GEN-05', 'GEN-06',
  'GEN-07', 'GEN-08', 'GEN-09', 'GEN-10', 'FILE-02',
  'SKILL-01', 'SKILL-02', 'SKILL-03', 'SKILL-04', 'SKILL-05',
  'PAGE-01', 'PAGE-02', 'VIEW-01', 'VIEW-02', 'FILE-01',
  'TOOL-01', 'TOOL-02', 'TOOL-03', 'TOOL-04', 'TOOL-05', 'TOOL-06', 'TOOL-07', 'TOOL-08',
  'COLOR-01', 'COLOR-02', 'COLOR-03', 'COLOR-04', 'COLOR-05', 'COLOR-06',
  'TIME-01', 'TIME-02', 'TIME-03', 'TIME-04', 'TIME-05', 'TIME-06', 'TIME-07', 'TIME-08', 'TIME-09',
]
const OFF_SURFACE_CAPABILITY_IDS = ['SKILL-06']

const PREVIEW_FILES = [
  'src/ui/vnext/vnext-preview.html',
  'src/ui/vnext/vnext-preview.css',
  'src/ui/vnext/vnext-preview.js',
]

async function readPreview() {
  const [html, css, js] = await Promise.all(PREVIEW_FILES.map((path) => readFile(path, 'utf8')))
  return { html, css, js }
}

test('collapsed model control grows with its name and has no rectangle', async () => {
  const { css } = await readPreview()
  assert.match(css, /\.vnext-assistant-model-wrap \{[^}]*width: max-content/)
  assert.doesNotMatch(css, /\.vnext-assistant-model-wrap \{[^}]*width: 300px/)
  assert.match(css, /\.vnext-assistant-model \{[^}]*border: 0/)
  assert.match(css, /\.vnext-assistant-model:focus-visible \{[^}]*outline: 2px/)
})

test('VIS-02 preview files exist as an isolated labeled entry', async () => {
  const { html } = await readPreview()
  assert.match(html, /VIS-02 visual preview · not the product default/)
  assert.match(html, /sample frames, colors, and skills are design samples, not project data/)
  assert.match(html, /lang="en"/)
  assert.match(html, /data-figma="1604:5041"/)
  assert.match(html, /data-baseline="HOME-TIMELINE-LINK-COPIES-2026-09-17-r2"/)
})

test('VIS-02 does not replace the maintained Studio or editor default entries', async () => {
  const [server, studio, editor] = await Promise.all([
    readFile('server.js', 'utf8'),
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('editor.html', 'utf8'),
  ])
  assert.match(server, /\/src\/ui\/studio\/studio.html#character/)
  assert.doesNotMatch(server, /vnext-preview/)
  assert.doesNotMatch(studio, /vnext-preview/)
  assert.doesNotMatch(editor, /vnext-preview/)
})

test('VIS-02 marks the 50 on-surface function IDs, records SKILL-06 as absent, and keeps unwired controls disabled', async () => {
  const { html, js } = await readPreview()
  assert.equal(SURFACE_CAPABILITY_IDS.length + OFF_SURFACE_CAPABILITY_IDS.length, 56)
  const markup = `${html}\n${js}`
  for (const id of SURFACE_CAPABILITY_IDS) {
    assert.match(markup, new RegExp(`data-capability="[^"]*${id}|'data-capability': '[^']*${id}`), id)
  }
  for (const id of OFF_SURFACE_CAPABILITY_IDS) {
    assert.doesNotMatch(html, new RegExp(`data-capability="[^"]*${id}`), `${id} has no control on 1604:5041`)
    assert.match(html, new RegExp(`data-capability-not-on-surface="${id}"`))
  }
  assert.match(html, /data-capability="HOME-04"[^>]*data-capability-status="closed"[^>]*disabled/)
  assert.match(html, /data-capability="GEN-05"[^>]*disabled/)
  assert.match(html, /Video is not open in this preview/)
  assert.match(html, /send stays disabled; no Review or Provider call/)
  assert.match(html, /data-figma="I1814:5222;1826:5787" data-capability="SKILL-05"/)
  assert.match(html, /vnext-text-btn is-project is-ink/)
  assert.match(html, /vnext-text-btn is-pill is-82 is-ink/)
  assert.match(html, /vnext-text-btn has-bg is-88 is-ink/)
  assert.doesNotMatch(html, /vnext-icon is-12 is-dim/)
  assert.doesNotMatch(html, /1793:5245/)
  assert.equal((html.match(/class="vnext-pop-divider"/g) ?? []).length, 1)
  assert.equal((html.match(/class="vnext-layer-icon"/g) ?? []).length, 6)
  assert.match(html, /vnext-icon is-12" role="img" aria-label="Visibility/)
  assert.match(html, /data-figma="I1824:5516;1990:208"[\s\S]{0,180}?vnext-icon is-16/)
  const eyedropper = html.match(/<symbol id="vnext-icon-eyedropper"[\s\S]*?<\/symbol>/)?.[0] || ''
  assert.match(eyedropper, /stroke="#282828" stroke-width="1.5"/)
  assert.doesNotMatch(eyedropper, /#666666|stroke-width="1\.3"/)
  assert.equal((html.match(/class="vnext-tool(?:\s|")/g) ?? []).length, 8)
  assert.equal((html.match(/<use href="#vnext-/g) ?? []).length > 40, true, 'icons reference the inlined exported design assets')
})

test('VIS-02 inlines the exported SVG assets verbatim as a sprite and references only existing symbols', async () => {
  const { html, js } = await readPreview()
  const sprite = spriteBlockOf(html)
  assert.ok(sprite, 'sprite block present')
  assert.equal(sprite, buildSprite(), 'sprite block must be regenerated from src/ui/vnext/assets/*.svg (node src/ui/vnext/vnext-preview-sprite.mjs)')
  const symbols = new Set([...sprite.matchAll(/<symbol id="vnext-([\w.-]+)"/g)].map((match) => match[1]))
  const svgFiles = (await readdir('src/ui/vnext/assets')).filter((name) => name.endsWith('.svg'))
  assert.equal(symbols.size, svgFiles.length)
  for (const name of symbols) await access(`src/ui/vnext/assets/${name}.svg`)
  const uses = new Set([...html.matchAll(/<use href="#vnext-([\w.-]+)"/g)].map((match) => match[1]))
  const jsUses = new Set([...js.matchAll(/svgUse\('([\w.-]+)'/g)].map((match) => match[1]))
  for (const layer of ['cel-content.svg', 'cel-blank.svg', 'cel-row-selected.svg', 'icon-plus-16.svg']) {
    jsUses.add(layer.replace(/\.svg$/, ''))
  }
  for (const name of [...uses, ...jsUses]) assert.equal(symbols.has(name), true, `symbol for ${name}`)
  const paletteSource = await readFile('src/ui/vnext/vnext-palette.js', 'utf8')
  assert.match(paletteSource, /href="#vnext-color-selected-ring"/, 'selected ring + gap + check asset')
  assert.match(paletteSource, /viewBox="0 0 37 37"/, 'dynamic selected ring has an explicit viewBox')
  assert.match(html, /class="vnext-swatch-ring"[^>]*viewBox="0 0 37 37"/, 'quick selected ring has an explicit viewBox')
  const ids = [...sprite.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, 'sprite ids must be unique')
  assert.doesNotMatch(html, /<img[^>]*\.svg/, 'no <img> to .svg (server.js has no image/svg+xml mapping)')
  assert.match(html, /<img src="\.\/assets\/skill-fixed-region-thumb-252\.png"/, 'real template thumbnail')
  await access('src/ui/vnext/assets/skill-fixed-region-thumb-252.png')
})

test('VIS-02 bundles the licensed Inter web font and records Inter plus Lucide in ATTRIBUTIONS.md', async () => {
  const { css } = await readPreview()
  const attributions = await readFile('ATTRIBUTIONS.md', 'utf8')
  for (const file of ['Inter-Regular.woff2', 'Inter-Medium.woff2', 'Inter-LICENSE-OFL-1.1.txt']) await access(`src/ui/vnext/assets/${file}`)
  assert.match(css, /@font-face \{[\s\S]*?font-family: "Inter";[\s\S]*?font-weight: 400;[\s\S]*?src: url\("\.\/assets\/Inter-Regular\.woff2"\) format\("woff2"\);/)
  assert.match(css, /@font-face \{[\s\S]*?font-family: "Inter";[\s\S]*?font-weight: 500;[\s\S]*?src: url\("\.\/assets\/Inter-Medium\.woff2"\) format\("woff2"\);/)
  assert.doesNotMatch(css, /url\(\s*["']?(https?:)?\/\//, 'no remote font or asset URLs')
  assert.doesNotMatch(css, /@import/, 'no imported stylesheets or font services')
  assert.match(attributions, /Inter 4\.1 \(`SIL Open Font License 1\.1`\)/)
  assert.match(attributions, /https:\/\/github\.com\/rsms\/inter\/releases\/tag\/v4\.1/)
  assert.match(attributions, /src\/ui\/vnext\/assets\/Inter-LICENSE-OFL-1\.1\.txt/)
  assert.match(attributions, /Lucide icons \(`ISC`, with Feather-derived glyphs under `MIT`\)/)
  const iconLicense = await readFile('src/ui/vnext/assets/Lucide-LICENSE.txt', 'utf8')
  assert.match(iconLicense, /ISC License/)
  assert.match(iconLicense, /Lucide Icons and Contributors/)
  assert.match(iconLicense, /The MIT License \(MIT\)/)
  assert.match(iconLicense, /Cole Bemis/)
  const license = await readFile('src/ui/vnext/assets/Inter-LICENSE-OFL-1.1.txt', 'utf8')
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/)
})

test('VIS-02 CSS keeps the Current geometry read from Figma 1604:5041 and the r2 timeline', async () => {
  const { css } = await readPreview()
  assert.match(css, /\.vnext-workbench \{[\s\S]*?width: 1920px;[\s\S]*?height: 1080px;/)
  assert.match(css, /\.vnext-left \{[\s\S]*?width: 406px;[\s\S]*?background: var\(--vnext-surface-base\);/)
  assert.match(css, /\.vnext-tool \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 10px;/)
  assert.match(css, /\.vnext-icon\.is-16 \{ width: 16px; height: 16px; \}/)
  assert.match(css, /\.vnext-icon\.is-12 \{ width: 12px; height: 12px; \}/)
  assert.match(css, /\.vnext-layer-icon \{[\s\S]*?width: 16px;[\s\S]*?height: 16px;/)
  assert.match(css, /\.vnext-send \{[\s\S]*?width: 24px;[\s\S]*?border-radius: 12px;[\s\S]*?background: var\(--vnext-surface-pressed\);/)
  assert.match(css, /\.vnext-swatch \{[\s\S]*?width: 30px;[\s\S]*?height: 30px;[\s\S]*?border-radius: 6px;/)
  const ringRule = css.match(/\.vnext-swatch-ring \{([^}]+)\}/)?.[1] || ''
  assert.match(ringRule, /left: 50%;[\s\S]*?top: 50%;/)
  assert.match(ringRule, /transform: translate\(-50%, -50%\);/)
  assert.match(ringRule, /width: calc\(100% \+ 7px\);[\s\S]*?height: calc\(100% \+ 7px\);/)
  assert.doesNotMatch(ringRule, /left: -4px|top: -4px/, 'ring offset must not bias the center')
  assert.doesNotMatch(ringRule, /!important|(?:width|height): 37px;/, 'do not pin responsive palette rings to their default size')
  assert.match(css, /\.vnext-quick-row \{[^}]*justify-content: flex-start;/)
  assert.match(css, /\.vnext-cel \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;/)
  assert.match(css, /\.vnext-cel > svg \{ width: 24px; height: 24px; \}/)
  assert.match(css, /\.vnext-selected-row \{[\s\S]*?left: 8px;[\s\S]*?right: 8px;[\s\S]*?top: 60px;[\s\S]*?height: 32px;/)
  assert.match(css, /\.vnext-layer-col \{[\s\S]*?width: 200px;[\s\S]*?height: 140px;/)
  assert.match(css, /\.vnext-frame-col \{[\s\S]*?width: 32px;/)
  assert.match(css, /\.vnext-add-blank \{[\s\S]*?border: 1px dashed var\(--vnext-border-subtle\);/)
  assert.match(css, /\.vnext-preview \{[\s\S]*?right: 8px;[\s\S]*?top: 504px;[\s\S]*?width: 406px;[\s\S]*?height: 310px;[\s\S]*?background: rgba\(255, 255, 255, 0\.72\);[\s\S]*?backdrop-filter: blur\(32px\);/)
  assert.match(css, /--vnext-home: #f5f5f5;/)
  assert.match(css, /\.vnext-skill-pop \{[\s\S]*?left: 334px;[\s\S]*?top: 575px;[\s\S]*?width: 299px;[\s\S]*?height: 276px;[\s\S]*?background: rgba\(255, 255, 255, 0\.72\);[\s\S]*?backdrop-filter: blur\(32px\);[\s\S]*?z-index: 20;/)
  assert.doesNotMatch(css, /\.vnext-skill-pop \{[^}]*background: var\(--vnext-surface-subtle\);/)
  assert.doesNotMatch(css, /\.vnext-skill-tag-icon \{ opacity: 0\.7; \}/)
  assert.match(css, /\.vnext-search \{[\s\S]*?background: var\(--vnext-surface-base\);/)
  assert.match(css, /\.vnext-workflow \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?overflow: auto;/)
  assert.match(css, /\.vnext-composer \{[\s\S]*?height: auto;[\s\S]*?flex: 0 0 auto;[\s\S]*?gap: 12px;[\s\S]*?overflow: hidden;/)
  assert.match(css, /\.vnext-composer-top \{[\s\S]*?flex: 0 0 auto;[\s\S]*?max-height: none;/)
  assert.match(css, /\.vnext-skill-and-prompt \{[\s\S]*?flex: 0 0 auto;/)
  assert.match(css, /\.vnext-prompt-input \{[\s\S]*?min-height: 20px;[\s\S]*?max-height: 120px;[\s\S]*?overflow-y: auto;[\s\S]*?field-sizing: content;/)
  assert.match(css, /\.vnext-ref-empty \.vnext-ref-image-label \{[\s\S]*?overflow: visible;/)
  assert.match(css, /\.vnext-color-sidebar \{[\s\S]*?left: 1606px;[\s\S]*?width: 314px;[\s\S]*?padding-top: 40px;/)
  assert.match(css, /\.vnext-preview-banner \{[\s\S]*?position: absolute;/)
})

test('VIS-02 binds page drafts and leaves document controls disabled until a supported canvas is selected', async () => {
  const { html, js } = await readPreview()
  const markup = `${html}\n${js}`
  assert.match(html, /id="vnext-prompt-input"/)
  assert.match(html, /rows="1"/)
  assert.match(html, /placeholder="Message…"/)
  assert.match(html, /id="vnext-ref-input"/)
  assert.match(html, /type="file"/)
  assert.doesNotMatch(html, /id="vnext-ref-input"[^>]*tabindex="-1"/)
  assert.doesNotMatch(html, /vnext-ref-clear"[^>]*tabindex="-1"/)
  assert.match(html, /#vnext-icon-first"/)
  assert.match(html, /#vnext-icon-sprite"/)
  assert.match(html, /#vnext-icon-marquee"/)
  assert.match(html, /data-capability="GEN-01"[^>]*data-capability-status="bound"/)
  assert.match(html, /data-capability="GEN-02"[^>]*data-capability-status="bound"/)
  assert.match(html, /id="vnext-project-btn"[^>]*data-capability="HOME-07 HOME-10"[^>]*data-capability-status="bound"/)
  assert.doesNotMatch(html, /id="vnext-project-btn"[^>]*disabled/)
  assert.match(html, /id="vnext-tool-move"[^>]*data-capability="TOOL-01"[^>]*data-capability-status="bound"/)
  assert.doesNotMatch(html, /id="vnext-tool-move"[^>]*disabled/)
  assert.match(html, /id="vnext-zoom"[^>]*data-capability="VIEW-02"[^>]*data-capability-status="bound"/)
  assert.doesNotMatch(html, /id="vnext-zoom"[^>]*disabled/)
  assert.match(html, /id="vnext-import-input"/)
  assert.doesNotMatch(html, /id="vnext-import-input"[^>]*tabindex="-1"/)
  assert.match(html, /P2-04-PARTIAL-BINDING-REVIEW-REQUIRES-FIXES-2026-09-20/)
  assert.match(html, /P2-04-LIST-CLAUDE-ACCEPTED-2026-09-19/)
  assert.doesNotMatch(html, /orange stroke|#ff7a00|#f97316/)
  assert.match(js, /model\.hintText \|\| model\.countText/)
  assert.match(html, /data-capability="TIME-07"[^>]*data-capability-status="implemented"/)
  assert.doesNotMatch(html, /Document commands are not connected/)
  assert.match(markup, /real add-frame stays in protected P2/)
  assert.match(html, /disabled title="Select a supported canvas to change Link copies/)
  assert.match(js, /pageDraft/)
  assert.match(js, /validateVnextReferenceFile/)
  assert.match(js, /VNEXT_REFERENCE_MAX_BYTES = 2 \* 1024 \* 1024/)
  assert.match(js, /keydown/)
  assert.match(js, /Escape/)
  assert.match(js, /pointerdown/)
  const withoutLastProjectPreference = js
    .replace("window.localStorage.setItem('vnext-last-project-id', bundle.project.id)", '')
    .replace("window.localStorage.getItem('vnext-last-project-id')", '')
  assert.equal(/localStorage|indexedDB|sessionStorage/.test(withoutLastProjectPreference), false,
    'Only the last project ID may persist in browser storage; prompt/reference drafts stay local')
})

test('VIS-02 preview script stays local, labels samples, and never calls a provider', async () => {
  const { js } = await readPreview()
  assert.match(js, /SAMPLE_FRAMES = 12/)
  assert.match(js, /Sample cel · not project data/)
  assert.match(await readFile('src/ui/vnext/vnext-palette.js', 'utf8'), /Palette color/)
  assert.match(js, /frame <= 3/, 'Details dots on frames 01–03 from the current instance')
  assert.doesNotMatch(js, /\bfetch\s*\(/)
  assert.doesNotMatch(js, /XMLHttpRequest|generate-character|process-sheet|OPENROUTER|GEMINI/)
  const client = await readFile('src/ui/vnext/vnext-project-client.js', 'utf8')
  assert.match(client, /\/api\/editor\/projects/)
  assert.doesNotMatch(client, /generate-character|process-sheet|OPENROUTER|GEMINI|XMLHttpRequest/)
})

test('VIS-02 Character reference limits accept a legal file and keep the last valid file on illegal input', async () => {
  const png = new File([Uint8Array.from([137, 80, 78, 71])], 'ok.png', { type: 'image/png' })
  Object.defineProperty(png, 'size', { value: 64 })
  assert.deepEqual(validateVnextReferenceFile(png), { ok: true, code: '', message: '' })

  const huge = new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' })
  Object.defineProperty(huge, 'size', { value: VNEXT_REFERENCE_MAX_BYTES + 1 })
  assert.equal(validateVnextReferenceFile(huge).code, 'reference_size_invalid')
  assert.equal(validateVnextReferenceFile(huge).message, VNEXT_REFERENCE_ERRORS.reference_size_invalid)

  const text = new File([Uint8Array.from([65])], 'notes.txt', { type: 'text/plain' })
  Object.defineProperty(text, 'size', { value: 4 })
  assert.equal(validateVnextReferenceFile(text).code, 'reference_type_invalid')

  const peer = new File([Uint8Array.from([1, 2, 3])], 'peer.png', { type: 'image/png' })
  Object.defineProperty(peer, 'size', { value: 2 * 1024 * 1024 })
  assert.equal(validateVnextReferenceFile(peer, { otherSize: 1024 * 1024 + 1 }).code, 'reference_total_size_invalid')

  const empty = new File([], 'empty.png', { type: 'image/png' })
  await assert.rejects(() => readVnextReferenceFile(empty), { code: 'reference_size_invalid' })
})

const PNG_1X1 = Uint8Array.from(Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
))

test('VIS-02 GEN-01 decodes a real image and keeps the last valid file on corrupt or stale results', async () => {
  assert.deepEqual(decodeVnextReferenceBytes(PNG_1X1), { width: 1, height: 1 })
  assert.throws(() => decodeVnextReferenceBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), { code: 'reference_decode_failed' })
  assert.throws(() => decodeVnextReferenceBytes(Uint8Array.from(Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex',
  ))), { code: 'reference_decode_failed' })

  const valid = new File([PNG_1X1], 'ok.png', { type: 'image/png' })
  const read = await readVnextReferenceFile(valid)
  assert.equal(read.width, 1)
  assert.equal(read.height, 1)
  assert.equal(read.name, 'ok.png')

  const revoked = []
  const pending = []
  const draft = createVnextReferenceDraft({
    createObjectURL: (file) => `blob:${file.name}`,
    revokeObjectURL: (url) => revoked.push(url),
    decodeImage: (file) => new Promise((resolve, reject) => pending.push({ file, resolve, reject })),
  })
  const first = new File([PNG_1X1], 'a.png', { type: 'image/png' })
  const second = new File([PNG_1X1], 'b.png', { type: 'image/png' })
  draft.state.prompt = 'keep-prompt'
  const startedA = draft.applyFile(first)
  const startedB = draft.applyFile(second)
  pending[1].resolve({ width: 2, height: 2 })
  pending[0].resolve({ width: 1, height: 1 })
  await Promise.all([startedA, startedB])
  assert.equal(draft.state.reference.name, 'b.png')
  assert.equal(draft.state.reference.width, 2)
  assert.equal(draft.state.reference.objectUrl, 'blob:b.png')
  assert.equal(draft.state.prompt, 'keep-prompt')
  assert.equal(draft.state.error, '')
  assert.equal(revoked.includes('blob:a.png'), true)

  const olderFail = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'old-fail.png', { type: 'image/png' })
  const newerOk = new File([PNG_1X1], 'new-ok.png', { type: 'image/png' })
  const startedOlder = draft.applyFile(olderFail)
  const startedNewer = draft.applyFile(newerOk)
  pending[3].resolve({ width: 3, height: 3 })
  await startedNewer
  assert.equal(draft.state.reference.name, 'new-ok.png')
  assert.equal(draft.state.reference.width, 3)
  assert.equal(draft.state.reference.objectUrl, 'blob:new-ok.png')
  assert.equal(draft.state.prompt, 'keep-prompt')
  assert.equal(draft.state.error, '')
  pending[2].reject(Object.assign(new Error(VNEXT_REFERENCE_ERRORS.reference_decode_failed), { code: 'reference_decode_failed' }))
  await startedOlder
  assert.equal(draft.state.reference.name, 'new-ok.png')
  assert.equal(draft.state.reference.width, 3)
  assert.equal(draft.state.reference.objectUrl, 'blob:new-ok.png')
  assert.equal(draft.state.prompt, 'keep-prompt')
  assert.equal(draft.state.error, '')
  assert.equal(revoked.includes('blob:old-fail.png'), true)

  const inFlight = new File([PNG_1X1], 'late.png', { type: 'image/png' })
  const startedLate = draft.applyFile(inFlight)
  draft.clear()
  pending[4].resolve({ width: 8, height: 8 })
  await startedLate
  assert.equal(draft.state.reference, null)
  assert.equal(revoked.includes('blob:late.png'), true)

  const failed = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'bad.png', { type: 'image/png' })
  const recovered = new File([PNG_1X1], 'good.png', { type: 'image/png' })
  const startedFail = draft.applyFile(failed)
  const startedGood = draft.applyFile(recovered)
  pending[5].reject(Object.assign(new Error(VNEXT_REFERENCE_ERRORS.reference_decode_failed), { code: 'reference_decode_failed' }))
  pending[6].resolve({ width: 1, height: 1 })
  await Promise.all([startedFail, startedGood])
  assert.equal(draft.state.reference.name, 'good.png')
  assert.equal(draft.state.error, '')
})

test('VIS-02 capture drives the maintained server.js entry at a real 1920×1080 viewport and measures network, fonts, and console', async () => {
  const capture = await readFile('src/ui/vnext/vnext-preview-capture.mjs', 'utf8')
  assert.doesNotMatch(capture, /\/Users\//)
  assert.match(capture, /path\.isAbsolute\(EVIDENCE_DIR\)/)
  assert.match(capture, /const VIEWPORT = \{ width: 1920, height: 1080 \}/)
  assert.doesNotMatch(capture, /1112/)
  assert.match(capture, /spawn\(process\.execPath, \['server\.js'\]/)
  assert.doesNotMatch(capture, /startStaticServer|http\.createServer/)
  assert.match(capture, /studio\.html#character/)
  assert.match(capture, /Network\.enable/)
  assert.match(capture, /Network\.requestWillBeSent/)
  assert.match(capture, /Log\.enable/)
  assert.match(capture, /CSS\.getPlatformFontsForNode/)
  assert.match(capture, /__vnextNetworkCalls/)
  assert.match(capture, /sha256/)
  assert.match(capture, /DOM\.setFileInputFiles/)
  assert.match(capture, /vnext-prompt-input/)
  assert.match(capture, /naturalWidth/)
  assert.match(capture, /tabUntil/)
  assert.match(capture, /usedScriptFocus/)
  assert.match(capture, /refCorrupt/)
  assert.match(capture, /enableFileChooserOpenedEvent:\s*true/)
  assert.doesNotMatch(capture, /Page\.setInterceptFileChooserDialog/)
  assert.match(capture, /fileChooserOpened/)
  assert.match(capture, /afterEnterInputDisabled/)
  assert.match(capture, /afterSpaceInputDisabled/)
  assert.match(capture, /vis02-r4-/)
  assert.doesNotMatch(capture, /vis02-r3-/)
  assert.doesNotMatch(capture, /vis02-home-1920x1080-en-default\.png/)
  assert.match(capture, /probeHeadedNativePicker/)
  assert.match(capture, /EDITOR_WORKSPACE_ROOT/)
  assert.match(capture, /p2-04-canvas-binding-/)
  assert.match(capture, /vnext-import-input/)
  assert.match(capture, /detailsDots\.join\(','\) === '1,2,3'/)
  assert.match(capture, /Input\.dispatchKeyEvent/)
  assert.doesNotMatch(capture, /action\.focus\(\)/)
})

test('P2-04 FIX1 list shell matches accepted Claude ProjectList and does not force 528 on confirm', async () => {
  const { html, css, js } = await readPreview()
  assert.match(css, /\.vnext-dialog \{[^}]*width: 400px/)
  assert.match(css, /\.vnext-dialog\.is-list \{[^}]*width: 528px/)
  assert.match(css, /\.vnext-dialog\.is-list \{[^}]*padding: 24px/)
  assert.match(css, /\.vnext-dialog\.is-list \.vnext-dialog-title \{[^}]*font-size: 16px/)
  assert.match(css, /\.vnext-dialog\.is-list \.vnext-dialog-title \{[^}]*font-weight: 600/)
  assert.match(css, /\.vnext-list-search \{[^}]*border-radius: 6px/)
  assert.match(css, /inset 0 0 0 1px var\(--vnext-border-control\)/)
  assert.match(css, /\.vnext-dialog-btn \{[^}]*border-radius: 10px/)
  assert.match(css, /background: #fdf9f1/)
  assert.doesNotMatch(css, /\.vnext-dialog\.is-confirm \{[^}]*width: 528px/)
  assert.doesNotMatch(css, /content:\s*"!"/)
  assert.doesNotMatch(html, /vnext-list-search[\s\S]{0,240}vnext-icon-search/)
  assert.match(html, /class="vnext-search"[\s\S]{0,240}#vnext-icon-search/)
  assert.match(html, /vnext-list-warning[\s\S]{0,500}vnext-icon is-12/)
  assert.match(css, /vnext-list-warning \.vnext-dialog-btn\[data-project-action="refresh"\][\s\S]{0,80}background: #fff/)
  assert.match(html, /class="vnext-dialog is-list"/)
  assert.match(html, /class="vnext-dialog is-confirm"/)
  assert.match(js, /keepDrafts: preserveView/)
  assert.match(js, /onPrimary: \(\) => \{\s*closeConfirm\(\)/)
  assert.doesNotMatch(js, /session\.project = latest\.project/)
  assert.match(js, /view\.applySavedPositions\(write\.positions/)
  assert.match(js, /dismissOpenDialog\(\)/)
  assert.match(js, /cancelPendingOpen: true/)
})

test('P2-04 FIX1 timeline summary uses sample, empty real, selected canvas, and mixed durations', () => {
  assert.deepEqual(timelineSummary(null, { sample: true }), {
    current: '03',
    total: '12',
    durationLabel: '8 fps',
    layerCount: 3,
    frameCount: 12,
  })
  assert.deepEqual(timelineSummary({ frame_order: [], layer_order: [], frames: {}, layers: {} }), {
    current: '00',
    total: '00',
    durationLabel: '—',
    layerCount: 0,
    frameCount: 0,
  })
  const mixed = {
    frame_order: ['f1', 'f2'],
    layer_order: ['l1'],
    frames: { f1: { duration_ms: 100 }, f2: { duration_ms: 200 } },
    layers: { l1: { id: 'l1' } },
  }
  assert.equal(timelineSummary(mixed).durationLabel, '—')
  assert.equal(timelineSummary(mixed).current, '01')
  assert.equal(timelineSummary(mixed).total, '02')
  const uniform = {
    frame_order: ['f1'],
    layer_order: ['l1', 'l2'],
    frames: { f1: { duration_ms: 125 } },
    layers: { l1: {}, l2: {} },
  }
  assert.equal(timelineSummary(uniform).durationLabel, '8 fps')
  assert.equal(timelineSummary(uniform).layerCount, 2)
})

test('P2-04 FIX1 project load commits only a current token after resources succeed', async () => {
  const committed = []
  let rejectBlock
  const blocked = new Promise((_, reject) => { rejectBlock = reject })
  const failingApi = {
    async listDocuments() { return [{ document_id: 'd1' }] },
    async getDocument() {
      return {
        document: {
          document_id: 'd1',
          canvas: { w: 8, h: 8 },
          layer_order: ['l1'],
          frame_order: ['f1'],
          layers: { l1: { id: 'l1' } },
          frames: { f1: { id: 'f1', duration_ms: 125 } },
          cels: { c1: { frame_id: 'f1', layer_id: 'l1', block: { sha256: 'ab' } } },
        },
      }
    },
    async getBlock() { return blocked },
  }
  const failed = applyLoadedProjectBundle({
    token: 1,
    isCurrent: () => true,
    load: () => loadProjectBundle(failingApi, {
      id: 'p-new',
      canvases: { c1: { id: 'c1', document_id: 'd1', x: 0, y: 0 } },
    }),
    commit: (bundle) => committed.push(bundle.project.id),
  })
  rejectBlock(new Error('block missing'))
  await assert.rejects(() => failed)
  assert.deepEqual(committed, [])

  let releaseOld
  const oldGate = new Promise((resolve) => { releaseOld = resolve })
  let current = 1
  const lateApi = {
    async listDocuments() { await oldGate; return [] },
    async getDocument() { return { document: { document_id: 'd-old' } } },
  }
  const late = applyLoadedProjectBundle({
    token: 1,
    isCurrent: (token) => token === current,
    load: () => loadProjectBundle(lateApi, {
      id: 'old',
      canvases: { c1: { id: 'c1', document_id: 'd-old', x: 0, y: 0 } },
    }),
    commit: (bundle) => committed.push(bundle.project.id),
  })
  current = 2
  const next = await applyLoadedProjectBundle({
    token: 2,
    isCurrent: (token) => token === current,
    load: () => loadProjectBundle({
      async listDocuments() { return [] },
    }, { id: 'new', canvases: {} }),
    commit: (bundle) => committed.push(bundle.project.id),
  })
  releaseOld()
  const stale = await late
  assert.equal(stale.committed, false)
  assert.equal(next.committed, true)
  assert.deepEqual(committed, ['new'])
})

test('loaded canvas keeps the document name for the conversation reference', async () => {
  const bundle = await loadProjectBundle({
    async listDocuments() { return [{ document_id: 'd1', name: 'Long merchant canvas name' }] },
    async getDocument() {
      return {
        document: {
          document_id: 'd1',
          name: 'Long merchant canvas name',
          canvas: { w: 8, h: 8 },
        },
      }
    },
  }, {
    id: 'p',
    canvases: { c1: { id: 'c1', document_id: 'd1', x: 1, y: 2 } },
  })
  assert.equal(bundle.rendered[0].name, 'Long merchant canvas name')
  assert.equal(bundle.rendered[0].id, 'c1')
  const renamed = await loadProjectBundle({
    async listDocuments() { return [{ document_id: 'd1', name: 'Long merchant canvas name' }] },
    async getDocument() {
      return {
        document: {
          document_id: 'd1',
          name: 'Long merchant canvas name',
          canvas: { w: 8, h: 8 },
        },
      }
    },
  }, {
    id: 'p',
    canvases: { c1: { id: 'c1', document_id: 'd1', x: 1, y: 2, display_name: 'North gate' } },
  })
  assert.equal(renamed.rendered[0].name, 'North gate')
  assert.equal(renamed.rendered[0].manifest_name, 'Long merchant canvas name')
})

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name === 'content-type') return 'application/json'
        return headers[name] || null
      },
    },
    async json() { return body },
  }
}

function dataKey(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function selectorMatch(node, selector) {
  if (!node || typeof node !== 'object') return false
  if (typeof selector === 'string' && selector.includes(',')) return selector.split(',').some((part) => selectorMatch(node, part.trim()))
  if (selector.startsWith('#')) return node.id === selector.slice(1)
  if (selector.startsWith('.')) return String(node.className || '').split(/\s+/).includes(selector.slice(1))
  if (/^[a-z]+$/i.test(selector)) return node.tagName?.toLowerCase() === selector.toLowerCase()
  const eq = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/)
  if (eq) {
    const [, key, expected] = eq
    const value = key.startsWith('data-') ? node.dataset?.[dataKey(key.slice(5))] : node.getAttribute?.(key)
    return String(value) === expected
  }
  const attr = selector.match(/^\[([^=\]]+)\]$/)
  if (attr) {
    const key = attr[1]
    const value = key.startsWith('data-') ? node.dataset?.[dataKey(key.slice(5))] : node.getAttribute?.(key)
    return value != null && value !== false
  }
  return false
}

function createSessionHarness() {
  const byId = new Map()
  const rootListeners = new Map()
  function makeNode(id, extra = {}) {
    const node = {
      id: id || '',
      tagName: extra.tagName || 'DIV',
      hidden: extra.hidden ?? false,
      disabled: extra.disabled ?? false,
      textContent: extra.textContent || '',
      value: extra.value || '',
      className: extra.className || '',
      style: {},
      dataset: { ...(extra.dataset || {}) },
      style: {},
      children: [],
      parentNode: extra.parentNode || null,
      parentElement: extra.parentElement || { hidden: false },
      attributes: new Map(),
      listeners: new Map(),
      classList: {
        toggle(name, force) {
          const on = force == null ? !String(node.className).split(/\s+/).includes(name) : Boolean(force)
          const parts = String(node.className).split(/\s+/).filter(Boolean).filter((item) => item !== name)
          if (on) parts.push(name)
          node.className = parts.join(' ')
        },
        add(name) { node.classList.toggle(name, true) },
        remove(name) { node.classList.toggle(name, false) },
        contains(name) { return String(node.className).split(/\s+/).includes(name) },
      },
      setAttribute(name, value) {
        node.attributes.set(name, String(value))
        if (name.startsWith('data-')) node.dataset[dataKey(name.slice(5))] = String(value)
      },
      getAttribute(name) {
        return node.attributes.get(name) ?? null
      },
      removeAttribute(name) {
        node.attributes.delete(name)
        if (name.startsWith('data-')) delete node.dataset[dataKey(name.slice(5))]
      },
      addEventListener(type, fn) {
        if (!node.listeners.has(type)) node.listeners.set(type, new Set())
        node.listeners.get(type).add(fn)
      },
      dispatchEvent(event) {
        event.target ??= node
        event.preventDefault ??= () => { event.defaultPrevented = true }
        const pending = []
        for (const fn of node.listeners.get(event.type) || []) pending.push(fn(event))
        return Promise.all(pending.map((item) => Promise.resolve(item)))
      },
      closest(selector) {
        let cursor = node
        while (cursor) {
          if (selectorMatch(cursor, selector)) return cursor
          cursor = cursor.parentNode
        }
        return null
      },
      contains(child) {
        for (let cursor = child; cursor; cursor = cursor.parentNode) if (cursor === node) return true
        return false
      },
      querySelector(selector) {
        return node.querySelectorAll(selector)[0] || null
      },
      querySelectorAll(selector) {
        const found = []
        const walk = (current) => {
          for (const child of current.children || []) {
            if (selectorMatch(child, selector)) found.push(child)
            walk(child)
          }
        }
        walk(node)
        return found
      },
      getBoundingClientRect() {
        return extra.rect || { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }
      },
      clientWidth: extra.clientWidth || 200,
      clientHeight: extra.clientHeight || 200,
      get lastElementChild() {
        return node.children.at(-1) || null
      },
      append(...kids) {
        for (const child of kids) {
          if (!child || typeof child === 'string') continue
          child.parentNode = node
          node.children.push(child)
        }
      },
      replaceChildren(...kids) {
        node.children = []
        for (const kid of kids) node.append(kid)
      },
      remove() {
        const parent = node.parentNode
        if (!parent?.children) return
        parent.children = parent.children.filter((child) => child !== node)
        node.parentNode = null
      },
    }
    if (id) byId.set(id, node)
    return node
  }
  const openRoot = makeNode('vnext-open-dialog', { hidden: true })
  const confirmRoot = makeNode('vnext-confirm-dialog', { hidden: true })
  const scrim = makeNode('', { className: 'vnext-dialog-scrim' })
  const confirmQuery = confirmRoot.querySelector.bind(confirmRoot)
  confirmRoot.querySelector = (selector) => (
    selector === '.vnext-dialog-scrim' ? scrim : confirmQuery(selector)
  )
  const openConfirm = makeNode('vnext-open-confirm', { tagName: 'BUTTON', dataset: { projectAction: 'confirm-open' } })
  const cancelBtn = makeNode('', { tagName: 'BUTTON', dataset: { dialogDismiss: 'open' } })
  const save = makeNode('vnext-save-positions', { tagName: 'BUTTON', dataset: { projectAction: 'save' } })
  const menu = makeNode('vnext-project-menu', { hidden: true, tagName: 'DIV' })
  const btn = makeNode('vnext-project-btn', { tagName: 'BUTTON' })
  openRoot.append(openConfirm)
  openRoot.append(cancelBtn)
  const createBtn = makeNode('vnext-new-project', { tagName: 'BUTTON', dataset: { projectAction: 'new' } })
  const duplicateBtn = makeNode('vnext-duplicate-canvas', { tagName: 'BUTTON', dataset: { projectAction: 'duplicate-canvas' }, disabled: true })
  menu.append(save)
  menu.append(duplicateBtn)
  menu.append(createBtn)
  makeNode('vnext-project-name')
  makeNode('vnext-confirm-title')
  makeNode('vnext-confirm-body')
  makeNode('vnext-confirm-details')
  makeNode('vnext-confirm-primary', { tagName: 'BUTTON' })
  makeNode('vnext-confirm-secondary', { tagName: 'BUTTON' })
  makeNode('vnext-list-warning', { hidden: true })
  makeNode('vnext-list-warning-title')
  makeNode('vnext-list-warning-body')
  makeNode('vnext-list-status')
  makeNode('vnext-list-rows')
  const search = makeNode('vnext-project-search', { tagName: 'INPUT' })
  search.parentElement = { hidden: false }
  makeNode('vnext-list-clear', { hidden: true })
  const projectToast = makeNode('vnext-project-toast', { hidden: true, className: 'vnext-project-toast', dataset: { figma: '1970:130', toastTone: 'info' } })
  projectToast.append(
    makeNode('vnext-project-toast-icon', { tagName: 'SPAN', className: 'vnext-toast-icon', dataset: { figma: '1970:97' } }),
    makeNode('vnext-project-toast-message', { tagName: 'SPAN', className: 'vnext-toast-message', dataset: { figma: '1970:100' } }),
    makeNode('vnext-project-toast-close', { tagName: 'BUTTON', className: 'vnext-toast-close', dataset: { figma: '1970:107' } }),
  )
  makeNode('vnext-import-input', { tagName: 'INPUT' })
  makeNode('vnext-canvas-stage')
  makeNode('vnext-zoom', { tagName: 'BUTTON', textContent: '100%' })
  makeNode('vnext-grid', { tagName: 'BUTTON' })
  makeNode('vnext-view-settings-btn', { tagName: 'BUTTON' })
  makeNode('vnext-grid-pending', { hidden: true })
  const viewSettings = makeNode('vnext-view-settings', { hidden: true })
  const checkerSizes = makeNode('vnext-checker-sizes')
  for (const size of [1, 2, 4, 8, 16, 32]) checkerSizes.append(makeNode('', { tagName: 'BUTTON', dataset: { checkerSize: String(size) } }))
  viewSettings.append(checkerSizes)
  viewSettings.append(makeNode('vnext-checker-note'))
  viewSettings.append(makeNode('vnext-pixel-grid-switch', { tagName: 'BUTTON' }))
  viewSettings.append(makeNode('vnext-pixel-grid-note', { hidden: true }))
  makeNode('vnext-canvas-status')
  makeNode('vnext-canvas-ref', { hidden: true })
  makeNode('vnext-canvas-ref-name')
  makeNode('vnext-canvas-ref-thumb')
  makeNode('vnext-edit-later', { hidden: true })
  makeNode('vnext-prompt-input', { tagName: 'TEXTAREA' })
  makeNode('vnext-project-references', { className: 'vnext-project-references' })
  makeNode('vnext-reference-count', { tagName: 'SPAN', className: 'vnext-reference-count' })
  makeNode('vnext-reference-purpose', { tagName: 'SELECT', className: 'vnext-reference-purpose', value: 'frame' })
  makeNode('vnext-promote-frame-ref', { tagName: 'BUTTON', className: 'vnext-reference-action' })
  makeNode('vnext-promote-cel-ref', { tagName: 'BUTTON', className: 'vnext-reference-action' })
  makeNode('vnext-recover-reference', { tagName: 'BUTTON', className: 'vnext-reference-action', hidden: true })
  makeNode('vnext-reference-status', { className: 'vnext-reference-status', hidden: true })
  makeNode('vnext-reference-list', { className: 'vnext-reference-list' })
  makeNode('vnext-document-scope-bar', { className: 'vnext-document-scope-bar', hidden: true })
  const left = makeNode('', { className: 'vnext-left' })
  makeNode('vnext-frame-cols')
  const layerCol = makeNode('vnext-layer-col')
  layerCol.append(makeNode('', { className: 'vnext-layer-row' }))
  layerCol.append(makeNode('', { className: 'vnext-layer-row' }))
  layerCol.append(makeNode('', { className: 'vnext-layer-row' }))
  for (const row of layerCol.children) row.append(makeNode('', { className: 'vnext-layer-name' }))
  const playCurrent = makeNode('', { className: 'vnext-play-current' })
  const playTotal = makeNode('', { className: 'vnext-play-total' })
  const preview = makeNode('', { className: 'vnext-preview' })
  const previewBody = makeNode('', { className: 'vnext-preview-body', clientWidth: 200, clientHeight: 160 })
  const classNodes = [preview, previewBody, layerCol, playCurrent, playTotal, left]
  const root = {
    querySelector(selector) {
      if (selector.startsWith('#')) return byId.get(selector.slice(1)) || null
      return classNodes.find((node) => selectorMatch(node, selector)) || null
    },
    addEventListener(type, fn) {
      if (!rootListeners.has(type)) rootListeners.set(type, new Set())
      rootListeners.get(type).add(fn)
    },
    dispatchEvent(event) {
      event.target ??= root
      event.preventDefault ??= () => { event.defaultPrevented = true }
      const pending = []
      for (const fn of rootListeners.get(event.type) || []) pending.push(fn(event))
      return Promise.all(pending.map((item) => Promise.resolve(item)))
    },
  }
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = { addEventListener() {} }
  globalThis.document = {
    createElement(tag) { return makeNode('', { tagName: String(tag).toUpperCase() }) },
    createElementNS(_ns, tag) { return makeNode('', { tagName: String(tag).toUpperCase() }) },
  }
  return {
    root,
    byId,
    openRoot,
    openConfirm,
    cancelBtn,
    save,
    createBtn,
    menu,
    restore() {
      globalThis.window = previousWindow
      globalThis.document = previousDocument
    },
  }
}

async function pendingOpenOfB(dismiss) {
  const harness = createSessionHarness()
  let releaseDocuments
  const documentsGate = new Promise((resolve) => { releaseDocuments = resolve })
  let documentsEntered
  const entered = new Promise((resolve) => { documentsEntered = resolve })
  const projectA = {
    id: 'proj_a',
    name: 'Keep A',
    revision: 4,
    canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } },
  }
  const projectB = {
    id: 'proj_b',
    name: 'Late B',
    revision: 1,
    canvases: { canvas_b: { id: 'canvas_b', document_id: 'doc_b', x: 8, y: 8 } },
  }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/api/editor/projects/proj_b')) return jsonResponse(200, { project: projectB })
      if (path.endsWith('/api/editor/projects/proj_b/sprite-documents')) {
        documentsEntered()
        await documentsGate
        return jsonResponse(200, { documents: [] })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  const origList = client.listDocuments.bind(client)
  let listDocumentsCall = null
  client.listDocuments = (...args) => {
    listDocumentsCall = origList(...args)
    return listDocumentsCall
  }
  const session = bindVnextProjectSession(harness.root, { client })
  session.project = projectA
  session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
  session.view.moveDraft('canvas_a', 6, 3)
  session.view.panBy(12, 8)
  session.list.status = 'ready'
  session.list.projects = [{ id: 'proj_b', name: 'Late B', version: 'editor_project_v1', revision: 1 }]
  session.list.selectedId = 'proj_b'
  await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
  assert.equal(harness.byId.get('vnext-confirm-dialog').hidden, false)
  await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
  await entered
  if (dismiss === 'cancel') {
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.cancelBtn })
  } else {
    await harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: { tagName: 'DIV' } })
  }
  releaseDocuments()
  await listDocumentsCall
  return { harness, session }
}

test('P2-04 FIX3 Cancel waits for the late open to finish and keeps project A', async () => {
  const { harness, session } = await pendingOpenOfB('cancel')
  try {
    assert.equal(session.project.id, 'proj_a')
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 6, y: 3 }])
    assert.equal(session.view.panX, 12)
    assert.equal(session.view.panY, 8)
    assert.equal(session.view.canvases[0].id, 'canvas_a')
  } finally {
    harness.restore()
  }
})

test('P2-04 FIX3 Escape waits for the late open to finish and keeps project A', async () => {
  const { harness, session } = await pendingOpenOfB('escape')
  try {
    assert.equal(session.project.id, 'proj_a')
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 6, y: 3 }])
    assert.equal(session.view.panX, 12)
    assert.equal(session.view.panY, 8)
    assert.equal(session.view.canvases[0].id, 'canvas_a')
  } finally {
    harness.restore()
  }
})

test('P2-04 FIX3 save receipt keeps a later move on the same canvas dirty, retries original unknown payload, and Keep draft does not rebase', async () => {
  const harness = createSessionHarness()
  const project = {
    id: 'proj_a',
    name: 'Keep A',
    revision: 4,
    canvases: {
      canvas_a: { id: 'canvas_a', x: 0, y: 0 },
      canvas_b: { id: 'canvas_b', x: 10, y: 0 },
    },
  }
  const saveBodies = []
  let saveCalls = 0
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  let mode = 'pending-success'
  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      const path = String(url)
      if (path.endsWith('/api/editor/projects/proj_a/canvas-layout')) {
        saveCalls += 1
        saveBodies.push(init.body)
        if (mode === 'pending-success') {
          await saveGate
          return jsonResponse(201, {
            project: { ...project, revision: 5 },
            receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_revision: 5 },
          })
        }
        if (mode === 'unknown') {
          return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        }
        if (mode === 'unknown-retry') {
          return jsonResponse(201, {
            project: { ...project, revision: 6 },
            receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_revision: 6 },
          })
        }
        if (mode === 'stale') {
          return jsonResponse(409, { error: 'stale_revision' })
        }
        if (mode === 'stale-resave') {
          return jsonResponse(201, {
            project: { ...project, revision: 7 },
            receipt: { operation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_revision: 7 },
          })
        }
      }
      if (path.endsWith('/api/editor/projects/proj_a/sprite-documents')) {
        return jsonResponse(200, { documents: [] })
      }
      if (path.endsWith('/api/editor/projects/proj_a')) {
        return jsonResponse(200, {
          project: {
            ...project,
            revision: 9,
            canvases: {
              canvas_a: { id: 'canvas_a', x: 99, y: 99 },
              canvas_b: { id: 'canvas_b', x: 10, y: 0 },
            },
          },
        })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = project
    session.view.setCanvases([
      { id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 },
      { id: 'canvas_b', x: 10, y: 0, width: 8, height: 8 },
    ])
    session.view.moveDraft('canvas_a', 4, 0)
    const firstSave = harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    session.view.moveDraft('canvas_a', 12, 6)
    releaseSave()
    await firstSave
    assert.equal(saveCalls, 1)
    assert.equal(JSON.parse(saveBodies[0]).expected_revision, 4)
    assert.deepEqual(JSON.parse(saveBodies[0]).positions, [{ canvas_id: 'canvas_a', x: 4, y: 0 }])
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 12, y: 6 }])
    assert.deepEqual(session.view.positionOf('canvas_a'), { x: 12, y: 6 })
    assert.equal(session.view.canvases.find((item) => item.id === 'canvas_a').x, 4)
    assert.deepEqual(session.view.positionOf('canvas_b'), { x: 10, y: 0 })

    session.view.setCanvases([
      { id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 },
      { id: 'canvas_b', x: 10, y: 0, width: 8, height: 8 },
    ])
    session.view.moveDraft('canvas_a', 5, 1)
    mode = 'unknown'
    const origList = client.listDocuments.bind(client)
    let retryList = null
    let sawRetryList
    const retryListStarted = new Promise((resolve) => { sawRetryList = resolve })
    client.listDocuments = (...args) => {
      retryList = origList(...args)
      sawRetryList()
      return retryList
    }
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(Boolean(session.confirm), true)
    const unknownBody = JSON.parse(saveBodies.at(-1))
    session.view.moveDraft('canvas_a', 12, 6)
    mode = 'unknown-retry'
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await retryListStarted
    await retryList
    const retryBody = JSON.parse(saveBodies.at(-1))
    assert.equal(retryBody.operation_id, unknownBody.operation_id)
    assert.deepEqual(retryBody.positions, [{ canvas_id: 'canvas_a', x: 5, y: 1 }])
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 12, y: 6 }])
    assert.deepEqual(session.view.positionOf('canvas_a'), { x: 12, y: 6 })
    assert.deepEqual(session.view.positionOf('canvas_b'), { x: 10, y: 0 })

    mode = 'stale'
    const baseline = session.project.revision
    session.view.moveDraft('canvas_a', 7, 2)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(session.project.revision, baseline)
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(session.project.revision, baseline)
    mode = 'stale-resave'
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    const keepBody = JSON.parse(saveBodies.at(-1))
    assert.equal(keepBody.expected_revision, baseline)
  } finally {
    harness.restore()
  }
})

for (const version of [undefined, 'editor_project_v2']) {
test(`late save receipt cannot replace a project opened while the save was in flight (${version ?? 'legacy fixture'})`, async () => {
  const harness = createSessionHarness()
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  const storage = version ? { version, sprite_documents: {}, history: { version: 'editor_history_v1', revisions: null, receipts: null, legacy_backup: null } } : {}
  const projectA = { ...storage, id: 'proj_a', name: 'A', revision: 4, canvases: {} }
  const projectB = { ...storage, id: 'proj_b', name: 'B', revision: 1, canvases: {} }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      if (String(url).includes('/canvas-layout')) {
        await saveGate
        return jsonResponse(201, {
          project: { ...projectA, revision: 5 },
          receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_revision: 5 },
        })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = projectA
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 3, 1)
    const pending = harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    session.project = projectB
    client.openEpoch.next()
    releaseSave()
    await pending
    assert.equal(session.project.id, 'proj_b')
    assert.equal(session.project.revision, 1)
  } finally {
    harness.restore()
  }
})

}

test('import unknown retry keeps the same payload and the previous position draft', async () => {
  const harness = createSessionHarness()
  let releaseRead
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const project = { id: 'proj_a', name: 'A', revision: 2, canvases: { canvas_a: { id: 'canvas_a', x: 0, y: 0 } } }
  const bodies = []
  let mode = 'unknown'
  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        bodies.push(path)
        if (mode === 'unknown') return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(201, {
          project: { ...project, revision: 3 },
          document: { document_id: 'd1' },
          receipt: { operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      if (path.endsWith('/api/editor/projects/proj_a')) return jsonResponse(200, { project })
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = project
    session.view.setCanvases([{ id: 'canvas_a', x: 1, y: 1, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 9, 4)
    const input = harness.byId.get('vnext-import-input')
    input.files = [{ name: 'hero.png', arrayBuffer: async () => {
      await readGate
      return new Uint8Array([137, 80, 78, 71])
    } }]
    const first = input.dispatchEvent({ type: 'change' })
    await harness.byId.get('vnext-canvas-stage').dispatchEvent({ type: 'drop', dataTransfer: { files: [pngFile('second.png')] } })
    assert.equal(harness.byId.get('vnext-project-toast').textContent, 'Import already in progress.')
    assert.equal(harness.byId.get('vnext-project-toast').hidden, false)
    releaseRead()
    await first
    assert.equal(harness.byId.get('vnext-project-toast').hidden, true)
    assert.equal(Boolean(session.confirm), true)
    session.view.moveDraft('canvas_a', 11, 5)
    mode = 'retry'
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(bodies.length, 2)
    assert.equal(bodies[0], bodies[1])
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 11, y: 5 }])
  } finally {
    harness.restore()
  }
})

test('v0 open stays on the current project until Leave, and Cancel does not upgrade', async () => {
  const harness = createSessionHarness()
  const calls = []
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      calls.push(String(url))
      throw new Error(`unexpected ${url}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', name: 'A', revision: 3, canvases: {} }
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 2, 2)
    session.list.status = 'ready'
    session.list.projects = [{ id: 'old', name: 'Old', version: 'editor_project_v0', revision: 1 }]
    session.list.selectedId = 'old'
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Leave without saving canvas positions?')
    await harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
    assert.equal(session.project.id, 'proj_a')
    assert.equal(calls.length, 0)
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Open as an upgraded copy')
    await harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
    assert.equal(session.project.id, 'proj_a')
    assert.equal(calls.length, 0)
  } finally {
    harness.restore()
  }
})

async function pixelSessionFixture() {
  const harness = createSessionHarness(), calls = []
  const bytes = Uint8Array.of(255, 0, 0, 255), digest = await sha256Hex(bytes)
  let project = { id: 'pixel_project', version: 'editor_project_v1', revision: 2,
    canvases: { old: { id: 'old', document_id: 'doc_old', x: 0, y: 0 } }, sprite_documents: { doc_old: { working_revision: 1 } } }
  const manifest = (id, sha = digest, revision = 1) => ({ document_id: id, name: 'Image', revision, canvas: { w: 1, h: 1 },
    ...(id === 'doc_new' ? { derived_from: { document_id: 'doc_old', revision: 1, manifest_sha256: digest } } : {}),
    frame_order: ['f'], layer_order: ['l'], frames: { f: { duration_ms: 100 } }, layers: { l: { name: 'Layer', locked: false } },
    cels: { c: { frame_id: 'f', layer_id: 'l', block: { w: 1, h: 1, sha256: sha } } } })
  const docs = new Map([['doc_old', manifest('doc_old')]]), blocks = new Map([[digest, bytes]])
  const api = createVnextProjectClient({ fetchImpl: async () => { throw new Error('unexpected network') } })
  api.listDocuments = async () => [...docs.values()]
  api.getDocument = async (_p, id) => ({ document: docs.get(id) })
  api.getBlock = async (_p, _d, sha) => ({ width: 1, height: 1, sha256: sha, bytes: blocks.get(sha) })
  api.getProject = async () => ({ ok: true, project, stale: false })
  api.deriveWorking = async (_p, body) => {
    calls.push('derive'); const canvas = { id: 'new', document_id: 'doc_new', x: 1, y: 0 }
    project = { ...project, revision: 3, canvases: { ...project.canvases, new: canvas },
      sprite_documents: { ...project.sprite_documents, doc_new: { working_revision: 1 } } }
    docs.set('doc_new', manifest('doc_new'))
    return { project, canvas, document: docs.get('doc_new'), receipt: { operation_id: body.operationId, project_id: project.id,
      project_revision: 3, document_id: 'doc_new', document_revision: 1 } }
  }
  api.writeWorkingPixels = async (_p, id, body) => {
    calls.push('pixels'); assert.equal(id, 'doc_new')
    const revision = docs.get(id).revision + 1
    blocks.set(body.expectedSha256, body.bytes); docs.set(id, manifest(id, body.expectedSha256, revision))
    project = { ...project, revision: project.revision + 1, sprite_documents: { ...project.sprite_documents, doc_new: { working_revision: revision } } }
    return { project, document: docs.get(id), receipt: { operation_id: body.operationId, project_id: project.id,
      project_revision: project.revision, document_id: id, document_revision: revision } }
  }
  api.detachCanvas = async (_p, id, body) => {
    calls.push('detach'); assert.equal(id, 'new')
    project = { ...project, revision: project.revision + 1, canvases: { old: project.canvases.old } }
    return { project, receipt: { operation_id: body.operationId } }
  }
  api.saveLayout = async (_p, body) => {
    calls.push('position')
    assert.equal(body.positions.length, 1); assert.equal(body.positions[0].canvas_id, 'new')
    const point = body.positions[0]
    project = { ...project, revision: project.revision + 1,
      canvases: { ...project.canvases, new: { ...project.canvases.new, x: point.x, y: point.y } } }
    return { project, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision } }
  }
  api.restoreCanvas = async (_p, id, body) => {
    calls.push('restore'); assert.equal(id, 'new')
    project = { ...project, revision: project.revision + 1, canvases: { ...project.canvases, new: { id, document_id: 'doc_new', x: 1, y: 0 } } }
    return { project, receipt: { operation_id: body.operationId } }
  }
  const session = bindVnextProjectSession(harness.root, { client: api })
  await session.reloadProject(project)
  session.view.select('old')
  session.conversationRef = { projectId: project.id, canvasId: 'old', documentId: 'doc_old' }
  return { harness, api, session, calls, bytes, docs, blocks,
    get project() { return project }, set project(value) { project = value } }
}

test('manual first stroke selects a copy, later strokes reuse it, pixel Undo/Redo restore immutable revisions', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,255,0,255))
    assert.equal(f.session.view.selectedId,'new'); assert.equal(f.session.conversationRef.canvasId,'new')
    const before = structuredClone(f.docs.get('doc_new'))
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,0,0,0))
    assert.equal(f.session.activeWrite, null, 'completed pixel writes release their recovery closure')
    const after = structuredClone(f.docs.get('doc_new'))
    assert.deepEqual(f.calls,['derive','pixels','position','pixels'])
    assert.deepEqual(f.session.history.undo.map(e=>e.kind),['import','pixels'])
    const restored = []
    f.api.restoreWorking = async (pid,did,req) => {
      assert.equal(req.expectedWorkingRevision,f.docs.get(did).revision)
      assert.equal(req.expectedRevision,f.project.revision)
      restored.push(req.targetRevision)
      const doc = { ...(req.targetRevision === before.revision ? before : after), revision: f.docs.get(did).revision + 3 }
      f.docs.set(did,doc); f.project = {...f.project,revision:f.project.revision+1,sprite_documents:{...f.project.sprite_documents,[did]:{working_revision:doc.revision}}}
      return {project:f.project,document:doc,receipt:{operation_id:req.operationId,project_id:pid,project_revision:f.project.revision,document_id:did,document_revision:doc.revision}}
    }
    const key={type:'keydown',key:'z',metaKey:true,target:{tagName:'DIV',closest:()=>null}}
    await f.harness.root.dispatchEvent(key)
    assert.equal(f.session.documents.get('doc_new').cels.c.block.sha256,before.cels.c.block.sha256)
    await f.harness.root.dispatchEvent({...key,shiftKey:true})
    assert.equal(f.session.documents.get('doc_new').cels.c.block.sha256,after.cels.c.block.sha256)
    assert.deepEqual(restored,[before.revision,after.revision])
    assert.deepEqual([...f.bytes],[255,0,0,255]); assert.equal(f.docs.get('doc_old').revision,1)
  } finally { f.harness.restore() }
})

function stubSessionCanvas() {
  const previous = globalThis.ImageData
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
  const make = globalThis.document.createElement
  globalThis.document.createElement = tag => {
    const node = make(tag)
    if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({ putImageData(value) { node.pixels = value?.data ? new Uint8ClampedArray(value.data) : null } })
    return node
  }
  return () => { globalThis.ImageData = previous }
}

async function confirmedRefreshFixture() {
  const harness = createSessionHarness()
  const restoreCanvas = stubSessionCanvas()
  const counts = { list: 0, block: 0, project: 0 }
  const red = Uint8Array.of(9, 1, 2, 255)
  const blue = Uint8Array.of(4, 5, 6, 255)
  const digest = await sha256Hex(red)
  const otherDigest = await sha256Hex(blue)
  const blocks = new Map([[digest, red], [otherDigest, blue]])
  const layer = (id, name) => ({ id, name, kind: 'raster', visible: true, locked: false })
  const frame = { id: 'f', duration_ms: 100 }
  const cel = (id, layerId, sha) => ({ id, frame_id: 'f', layer_id: layerId, block: { sha256: sha, w: 1, h: 1 } })
  const doc = (id, name, sha, revision, layers = { l: layer('l', 'Layer') }, cels = { c: cel('c', 'l', sha) }) => ({
    document_id: id, name, revision, derived_from: { document_id: 'src', revision: 1 }, canvas: { w: 1, h: 1 },
    frame_order: ['f'], layer_order: Object.keys(layers), frames: { f: frame }, layers, cels,
  })
  const docs = new Map([['doc_sheet', doc('doc_sheet', 'Sheet', digest, 1)], ['doc_label', doc('doc_label', 'Sprite', digest, 1)]])
  const otherDoc = doc('doc_other', 'Other', otherDigest, 1)
  let project = {
    id: 'fast_project', version: 'editor_project_v1', revision: 2,
    canvases: {
      sheet: { id: 'sheet', document_id: 'doc_sheet', x: 0, y: 0 },
      label: { id: 'label', document_id: 'doc_label', x: 8, y: 0, display_name: 'Custom' },
    },
    sprite_documents: { doc_sheet: { working_revision: 1 }, doc_label: { working_revision: 1 } },
  }
  const otherProject = { id: 'other_project', version: 'editor_project_v1', revision: 1, canvases: { other: { id: 'other', document_id: 'doc_other', x: 0, y: 0, display_name: 'Kept' } }, sprite_documents: { doc_other: { working_revision: 1 } } }
  const layouts = []
  let pinnedDocs = null
  let holdComposition = false, releaseComposition, compositionEntered
  const compositionGate = new Promise(resolve => { compositionEntered = resolve })
  class HoldBytes extends Uint8Array {
    then(onFulfilled) {
      const plain = new Uint8Array(this)
      if (!holdComposition) { onFulfilled(plain); return }
      holdComposition = false
      compositionEntered()
      releaseComposition = () => onFulfilled(plain)
    }
  }
  let armRefreshDigest = false, holdDigest = false, releaseDigest, digestEntered
  const digestGate = new Promise(resolve => { digestEntered = resolve })
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
  crypto.subtle.digest = async (...args) => {
    if (holdDigest) { holdDigest = false; digestEntered(); await new Promise(resolve => { releaseDigest = resolve }) }
    return originalDigest(...args)
  }
  const api = createVnextProjectClient({ fetchImpl: async () => { throw new Error('unexpected network') } })
  api.listDocuments = async (id) => { counts.list += 1; return id === 'other_project' ? [otherDoc] : [...(pinnedDocs || docs).values()] }
  api.getDocument = async (id, documentId) => ({ document: id === 'other_project' ? otherDoc : (pinnedDocs || docs).get(documentId) })
  api.getBlock = async (_p, _d, sha) => { counts.block += 1; const bytes = blocks.get(sha); if (!bytes) throw new Error(`missing ${sha}`); return { width: 1, height: 1, sha256: sha, bytes: new HoldBytes(bytes) } }
  api.getProject = async (id) => {
    counts.project += 1
    if (armRefreshDigest) { armRefreshDigest = false; holdDigest = true }
    return { ok: true, stale: false, project: id === 'other_project' ? otherProject : project }
  }
  api.writeWorkingPixels = async (_p, id, body) => {
    const current = docs.get(id)
    const next = doc(id, current.name, body.expectedSha256, current.revision + 1)
    blocks.set(body.expectedSha256, body.bytes)
    docs.set(id, next)
    project = { ...project, revision: project.revision + 1, sprite_documents: { ...project.sprite_documents, [id]: { working_revision: next.revision } },
      canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet', x: project.canvases.sheet.x, y: project.canvases.sheet.y }, label: { id: 'label', document_id: 'doc_label', x: 8, y: 0 } } }
    return { project, document: next, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision, document_id: id, document_revision: next.revision } }
  }
  api.changeStructure = async (_p, id, body) => {
    const current = docs.get(id)
    const layers = { ...current.layers, l2: layer('l2', 'Ink') }
    const cels = { ...current.cels, c2: cel('c2', 'l2', current.cels.c.block.sha256) }
    const next = doc(id, current.name, current.cels.c.block.sha256, current.revision + 1, layers, cels)
    docs.set(id, next)
    project = { ...project, revision: project.revision + 1, sprite_documents: { ...project.sprite_documents, [id]: { working_revision: next.revision } },
      canvases: { ...project.canvases, label: { id: 'label', document_id: 'doc_label', x: project.canvases.label.x, y: project.canvases.label.y } } }
    return { project, document: next, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision, document_id: id, document_revision: next.revision } }
  }
  api.saveLayout = async (_p, body) => { layouts.push(body); return { project: { ...project, revision: project.revision + 1 }, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision + 1 } } }
  const session = bindVnextProjectSession(harness.root, { client: api })
  await session.reloadProject(project)
  session.view.select('sheet')
  session.conversationRef = { projectId: project.id, canvasId: 'sheet', documentId: 'doc_sheet' }
  return { harness, api, session, counts, layouts, docs, blocks, digest, otherDigest, otherProject,
    get project() { return project }, set project(value) { project = value },
    armComposition() { holdComposition = true }, compositionEntered: compositionGate, releaseComposition: () => releaseComposition?.(),
    pinList(map) { pinnedDocs = map },
    armDigest() { armRefreshDigest = true }, releaseDigest: () => releaseDigest?.(), digestEntered: digestGate,
    restore() { crypto.subtle.digest = originalDigest; restoreCanvas(); harness.restore() } }
}

async function saveDraft(session, harness) {
  await harness.byId.get('vnext-project-menu').dispatchEvent({ type: 'click', target: harness.byId.get('vnext-save-positions') })
}

// r6: a reload of a project read earlier (Reload canvas recovery, or the reload after a save) runs
// through session.reloadProject. A same-project save that lands while the read is delayed or while its
// documents load must win: the older read is not committed, reports no success, and moves nothing back.
test('a delayed reload never replaces a newer same-project save, whether the save lands before the reload or while its documents load', async () => {
  const f = await confirmedRefreshFixture()
  const listDocuments = f.api.listDocuments
  let holdList = false, releaseList = null, listEntered = null
  f.api.listDocuments = async (...args) => {
    if (holdList) { holdList = false; await new Promise(resolve => { listEntered?.(); releaseList = resolve }) }
    return listDocuments(...args)
  }
  const sheet = () => f.session.view.canvases.find(canvas => canvas.id === 'sheet')
  try {
    // (1) Delayed bundle loading: the read (revision 2) is loading its documents when a position save
    // commits revision 3.
    const read = structuredClone(f.project)
    assert.equal(f.session.project.revision, 2)
    holdList = true
    const entered = new Promise(resolve => { listEntered = resolve })
    const reloading = f.session.reloadProject(read)
    await entered
    f.session.view.moveDraft('sheet', 3, 1)
    await saveDraft(f.session, f.harness)
    assert.equal(f.session.project.revision, 3, 'the save committed while the read was loading')
    releaseList()
    const late = await reloading
    assert.equal(late.committed, false, 'the older read is not committed')
    assert.equal(late.stale, true)
    assert.equal(late.superseded, true)
    assert.equal(f.session.project.revision, 3, 'the shown revision does not go back')
    assert.deepEqual({ x: sheet().x, y: sheet().y }, { x: 3, y: 1 }, 'the saved position is kept')
    assert.deepEqual(f.session.view.listedDirtyPositions(), [], 'no draft is revived')
    assert.equal(f.session.layoutBaseRevision, 3, 'the next save builds on the newer revision')
    assert.equal(f.session.view.selectedId, 'sheet', 'the selection is untouched')

    // (2) Delayed response: the read (still revision 2) arrives after a second save committed revision 4;
    // nothing is loaded or shown for it.
    const listed = f.counts.list
    f.project = { ...f.project, revision: 3 }
    f.session.view.moveDraft('sheet', 5, 2)
    await saveDraft(f.session, f.harness)
    assert.equal(f.session.project.revision, 4)
    const delayed = await f.session.reloadProject(read)
    assert.deepEqual({ committed: delayed.committed, stale: delayed.stale, superseded: delayed.superseded }, { committed: false, stale: true, superseded: true })
    assert.equal(f.counts.list, listed, 'an already superseded read loads nothing')
    assert.equal(f.session.project.revision, 4)
    assert.deepEqual({ x: sheet().x, y: sheet().y }, { x: 5, y: 2 })
    assert.equal(f.session.layoutBaseRevision, 4)

    // (3) A read that is not older than the shown project still commits (recovery stays usable).
    const newest = { ...structuredClone(f.project), revision: 4, canvases: { ...f.project.canvases, sheet: { ...f.project.canvases.sheet, x: 5, y: 2 } } }
    const shown = await f.session.reloadProject(newest)
    assert.equal(shown.committed, true)
    assert.equal(f.session.project.revision, 4)
    assert.deepEqual({ x: sheet().x, y: sheet().y }, { x: 5, y: 2 })
  } finally { f.restore() }
})

test('confirmed pixel refresh skips document and block downloads, clears a removed custom name, and saves the draft at the new revision', async () => {
  const f = await confirmedRefreshFixture()
  try {
    const opened = { ...f.counts }
    f.session.view.moveDraft('sheet', 3, 1)
    const painted = Uint8Array.of(3, 4, 5, 255)
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), painted)
    assert.equal(f.counts.list, opened.list)
    assert.equal(f.counts.block, opened.block)
    assert.equal(f.counts.project, opened.project + 1)
    assert.equal(f.session.project.revision, 3)
    assert.equal(f.session.layoutBaseRevision, 3)
    assert.equal(f.session.layoutRevisionPinned, false)
    assert.deepEqual(f.session.view.listedDirtyPositions(), [{ canvas_id: 'sheet', x: 3, y: 1 }])
    const label = f.session.view.canvases.find(canvas => canvas.id === 'label')
    assert.equal(label.display_name, '')
    assert.equal(label.name, 'Sprite')
    assert.deepEqual([...f.session.view.canvases.find(canvas => canvas.id === 'sheet').preview.pixels], [...painted])
    await saveDraft(f.session, f.harness)
    assert.equal(f.layouts[0].expectedRevision, 3)
    assert.deepEqual(f.layouts[0].positions, [{ canvas_id: 'sheet', x: 3, y: 1 }])
  } finally { f.restore() }
})

test('a pixel refresh falls back and keeps the old layout baseline when the server moved a drafted canvas', async () => {
  const f = await confirmedRefreshFixture()
  try {
    f.session.view.moveDraft('sheet', 3, 1)
    const realGet = f.api.getProject
    f.api.getProject = async (id) => {
      const loaded = await realGet(id)
      if (loaded.project?.id !== 'fast_project') return loaded
      return { ...loaded, project: { ...loaded.project, canvases: { ...loaded.project.canvases, sheet: { ...loaded.project.canvases.sheet, x: 9, y: 0 } } } }
    }
    const before = f.session.layoutBaseRevision
    const opened = f.counts.list
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(3, 4, 5, 255))
    assert.equal(f.counts.list > opened, true)
    assert.equal(f.session.layoutRevisionPinned, true)
    assert.equal(f.session.layoutBaseRevision, before)
    assert.deepEqual(f.session.view.listedDirtyPositions(), [{ canvas_id: 'sheet', x: 3, y: 1 }])
    await saveDraft(f.session, f.harness)
    assert.equal(f.layouts[0].expectedRevision, before)
  } finally { f.restore() }
})

test('confirmed structure refresh skips block downloads and a later save uses the advanced layout revision', async () => {
  const f = await confirmedRefreshFixture()
  try {
    const opened = { ...f.counts }
    f.session.view.moveDraft('sheet', 4, 2)
    const saved = await f.session.changeStructure({ type: 'add-layer', name: 'Ink' })
    assert.equal(saved.ok, true)
    assert.equal(f.counts.list, opened.list)
    assert.equal(f.counts.block, opened.block)
    assert.equal(f.counts.project, opened.project + 1)
    assert.equal(f.session.documents.get('doc_sheet').layer_order.includes('l2'), true)
    assert.equal(f.session.layoutBaseRevision, f.session.project.revision)
    assert.equal(f.session.layoutRevisionPinned, false)
    assert.deepEqual(f.session.view.listedDirtyPositions(), [{ canvas_id: 'sheet', x: 4, y: 2 }])
    const label = f.session.view.canvases.find(canvas => canvas.id === 'label')
    assert.equal(label.display_name, '')
    assert.equal(label.name, 'Sprite')
    await saveDraft(f.session, f.harness)
    assert.equal(f.layouts[0].expectedRevision, f.session.project.revision - 1)
  } finally { f.restore() }
})

for (const kind of ['reopen', 'switch']) {
  test(`a pixel refresh that finishes after ${kind} does not rewrite the new context`, async () => {
    const f = await confirmedRefreshFixture()
    try {
      const source = await f.session.preparePixelEdit()
      const painted = Uint8Array.of(7, 8, 9, 255)
      const paintedDigest = await sha256Hex(painted)
      f.armDigest()
      const saving = f.session.savePixelStroke(source, painted)
      await f.digestEntered
      f.api.openEpoch.next()
      const next = kind === 'switch' ? f.otherProject : { ...f.project, revision: 9, canvases: { ...f.project.canvases, label: { ...f.project.canvases.label, display_name: 'Kept' } } }
      await f.session.reloadProject(next)
      const marker = f.session.view.canvases[0]
      marker.preview = { marker: kind, width: marker.width, height: marker.height }
      const revision = f.session.project.revision
      const newerWrite = { marker: 'newer write owns the slot' }
      f.session.activeWrite = newerWrite
      f.releaseDigest()
      await saving
      assert.equal(f.session.activeWrite, newerWrite, 'late pixel release must not clear another write')
      assert.equal(f.session.project.id, next.id)
      assert.equal(f.session.project.revision, revision)
      assert.equal(marker.preview.marker, kind)
      if (kind === 'reopen') assert.equal(f.session.view.canvases.find(canvas => canvas.id === 'label').display_name, 'Kept')
      if (kind === 'switch') {
        const before = f.counts.block
        await f.session.api.getBlock(next.id, 'doc_sheet', paintedDigest)
        assert.equal(f.counts.block, before + 1, 'the stale refresh did not cache its pixels')
      }
    } finally { f.restore() }
  })

  test(`a structure refresh already composing after ${kind} does not rewrite the new context`, async () => {
    const f = await confirmedRefreshFixture()
    try {
      const frozen = new Map([...f.docs].map(([id, manifest]) => [id, structuredClone(manifest)]))
      const frozenProject = structuredClone(f.project)
      f.armComposition()
      const saving = f.session.changeStructure({ type: 'add-layer', name: 'Ink' })
      await Promise.race([f.compositionEntered, new Promise((_, reject) => setTimeout(() => reject(new Error('structure refresh did not enter composition')), 1000))])
      f.api.openEpoch.next()
      if (kind === 'reopen') f.pinList(frozen)
      const next = kind === 'switch' ? f.otherProject : { ...frozenProject, revision: 9, canvases: { ...frozenProject.canvases, label: { ...frozenProject.canvases.label, display_name: 'Kept' } } }
      await f.session.reloadProject(next)
      const keptSelection = kind === 'switch' ? 'other' : 'label'
      f.session.view.select(keptSelection)
      const marked = f.session.view.canvases.find(canvas => canvas.id === (kind === 'switch' ? 'other' : 'sheet'))
      marked.preview = { marker: kind, width: marked.width, height: marked.height }
      const loadedSheet = f.session.documents.get('doc_sheet')
      const revision = f.session.project.revision
      f.releaseComposition()
      await saving
      assert.equal(f.session.project.id, next.id)
      assert.equal(f.session.project.revision, revision)
      assert.equal(f.session.view.selectedId, keptSelection)
      assert.equal(marked.preview.marker, kind)
      if (kind === 'switch') assert.equal(f.session.documents.has('doc_sheet'), false)
      else {
        assert.equal(f.session.documents.get('doc_sheet'), loadedSheet)
        assert.equal(loadedSheet.revision, 1)
        assert.equal(loadedSheet.layer_order.includes('l2'), false)
        assert.equal(f.session.view.canvases.find(canvas => canvas.id === 'label').display_name, 'Kept')
      }
    } finally { f.restore() }
  })
}

test('palette unknown retry keeps its frozen request and lock; confirmed reload only reads, preserving pixel history', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,255,0,255))
    const history = [...f.session.history.undo], heads = [...f.session.history.pixelHeads], docs = [...f.docs]
    const requests = [], colors = [[4, 5, 6, 128]]
    f.api.savePalette = async (_id, request) => {
      requests.push(structuredClone(request))
      if (requests.length === 1) throw Object.assign(new Error('lost ack'), { kind: 'unknown' })
      if (requests.length === 2) throw Object.assign(new Error('retry forbidden'), { kind: 'known_reject', code: 'forbidden_origin' })
      f.project = { ...f.project, revision: f.project.revision + 1, settings: { palette: { colors: request.colors } } }
      return { project: f.project }
    }
    await f.session.savePalette(colors); colors[0][0] = 99
    assert.equal(f.session.manualWrite.kind, 'palette'); assert.equal(f.session.pendingImport, f.session.manualWrite)
    const write = f.session.manualWrite
    // Dismiss does not release. Opening another project invokes recovery, not a new write.
    f.session.closeConfirm(); assert.equal(f.session.manualWrite, write)
    write.recover(); await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.deepEqual(requests[0], requests[1]); assert.equal(f.session.manualWrite, write)
    const get = f.api.getProject; f.api.getProject = async () => ({ ok: false })
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.deepEqual(requests[0], requests[2]); assert.equal(f.session.manualWrite, write)
    f.api.getProject = get
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(requests.length, 3); assert.equal(f.session.manualWrite, null)
    assert.deepEqual(f.session.project.settings.palette.colors, [[4, 5, 6, 128]])
    assert.deepEqual(f.session.history.undo, history); assert.deepEqual([...f.session.history.pixelHeads], heads); assert.deepEqual([...f.docs], docs)
  } finally { f.harness.restore() }
})

test('manual reload invalidates old pixel history without overwriting external edits; new strokes undo to that external state', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,255,0,255))
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,0,255,255))
    const oldEntry = f.session.history.undo.at(-1)
    const source = await f.session.preparePixelEdit()
    const bytes = Uint8Array.of(255,255,0,255)
    await f.api.writeWorkingPixels(f.project.id, 'doc_new', { bytes, expectedSha256: await sha256Hex(bytes) })
    const external = structuredClone(f.docs.get('doc_new'))
    await f.session.reloadProject(f.project)
    f.session.view.select('new')
    f.session.conversationRef = { projectId:f.project.id, canvasId:'new', documentId:'doc_new' }
    const key = {type:'keydown',key:'z',metaKey:true,target:{tagName:'DIV',closest:()=>null}}
    const restores = []
    f.api.restoreWorking = async (pid,did,req) => {
      restores.push(req.targetRevision)
      assert.equal(req.expectedWorkingRevision,f.docs.get(did).revision)
      const doc = {...external, revision:f.docs.get(did).revision+2}
      f.docs.set(did,doc)
      f.project = {...f.project,revision:f.project.revision+1,sprite_documents:{...f.project.sprite_documents,[did]:{working_revision:doc.revision}}}
      return {project:f.project,document:doc,receipt:{operation_id:req.operationId,project_id:pid,project_revision:f.project.revision,document_id:did,document_revision:doc.revision}}
    }
    await f.harness.root.dispatchEvent(key)
    assert.equal(oldEntry.invalidated,true); assert.equal(restores.length,0)
    assert.equal(f.session.history.undo.at(-1),oldEntry)
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256,external.cels.c.block.sha256)
    await assert.rejects(f.session.savePixelStroke(source,Uint8Array.of(0,0,0,0)))
    await f.session.savePixelStroke(await f.session.preparePixelEdit(),Uint8Array.of(0,0,0,0))
    await f.harness.root.dispatchEvent(key)
    assert.deepEqual(restores,[external.revision])
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256,external.cels.c.block.sha256)
    await f.harness.root.dispatchEvent(key)
    assert.equal(restores.length,1); assert.equal(f.session.history.undo.at(-1),oldEntry)
  } finally { f.harness.restore() }
})

test('a lost text save retries the same operation and confirms once', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0, 255, 0, 255))
    const docId = 'doc_new'
    const manifest = f.session.documents.get(docId)
    const command = { type: 'upsert-text', id: 'text_fixed', frame_id: 'f', layer_id: 'l', text: 'Hi', x: 0, y: 0, size: 8, font: { kind: 'generic', name: 'sans-serif' }, bold: false, italic: false, antialias: false, mode: 'fill', stroke_width: 1, color: '#111111' }
    const ops = []
    let saved = null
    f.api.changeStructure = async (pid, did, req) => {
      ops.push(req.operationId)
      assert.equal(req.command, command)
      if (!saved) {
        saved = { ...structuredClone(manifest), revision: manifest.revision + 1, text_objects: { version: 1, items: [{ ...command }] } }
        delete saved.text_objects.items[0].type
        f.docs.set(did, saved)
        f.project = { ...f.project, revision: f.project.revision + 1, sprite_documents: { ...f.project.sprite_documents, [did]: { working_revision: saved.revision } } }
        throw Object.assign(new Error('lost'), { kind: 'unknown' })
      }
      assert.equal(req.operationId, ops[0])
      return { project: f.project, document: saved, receipt: { operation_id: req.operationId, project_id: pid, project_revision: f.project.revision, document_id: did, document_revision: saved.revision } }
    }
    let confirmed = 0
    const first = await f.session.changeStructure(command, {
      projectId: f.project.id, projectRevision: f.project.revision, documentId: docId, workingRevision: manifest.revision, canvasId: 'new', frameId: 'f', layerId: 'l',
      onConfirmed: result => { confirmed += 1; assert.equal(result.document.text_objects.items.length, 1); assert.equal(result.receipt.operation_id, ops[0]) },
    })
    assert.equal(first.unknown, true)
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false)
    f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    for (let i = 0; i < 50 && confirmed < 1; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(confirmed, 1, JSON.stringify({ ops, write: Boolean(f.session.manualWrite), title: f.harness.byId.get('vnext-confirm-title').textContent, status: f.harness.byId.get('vnext-canvas-status').textContent }))
    assert.deepEqual(ops, [ops[0], ops[0]])
    assert.equal(f.session.manualWrite, null)
    assert.equal(f.docs.get(docId).text_objects.items.length, 1)
  } finally { f.harness.restore() }
})

test('a structure edit does not revalidate pixel history from before an external revision', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,255,0,255))
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,0,255,255))
    const oldEntry = f.session.history.undo.at(-1), bytes = Uint8Array.of(255,255,0,255)
    await f.api.writeWorkingPixels(f.project.id, 'doc_new', { bytes, expectedSha256: await sha256Hex(bytes) })
    const external = structuredClone(f.docs.get('doc_new'))
    await f.session.reloadProject(f.project); f.session.view.select('new')
    f.api.changeStructure = async (pid, did, req) => {
      assert.equal(req.expectedWorkingRevision, external.revision)
      const doc = { ...external, revision: external.revision + 1 }
      f.docs.set(did, doc); f.project = { ...f.project, revision: f.project.revision + 1, sprite_documents: { ...f.project.sprite_documents, [did]: { working_revision: doc.revision } } }
      return { project: f.project, document: doc, receipt: { operation_id: req.operationId, project_id: pid, project_revision: f.project.revision, document_id: did, document_revision: doc.revision } }
    }
    await f.session.changeStructure({ type: 'rename-layer', layer_id: 'l', name: 'Ink' })
    assert.equal(oldEntry.invalidated, true)
    assert.equal(f.session.history.undo.at(-1).structure, true)
    assert.equal(f.session.history.undo.at(-1).beforeRevision, external.revision)
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, external.cels.c.block.sha256)
  } finally { f.harness.restore() }
})

test('manual first-stroke import history cannot detach an externally edited copy', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(),Uint8Array.of(0,255,0,255))
    assert.equal(f.session.history.undo.length,1)
    const entry = f.session.history.undo[0]
    assert.equal(entry.manualPixels,true)
    const bytes = Uint8Array.of(255,255,0,255)
    await f.api.writeWorkingPixels(f.project.id,'doc_new',{bytes,expectedSha256:await sha256Hex(bytes)})
    await f.session.reloadProject(f.project)
    await f.harness.root.dispatchEvent({type:'keydown',key:'z',metaKey:true,target:{tagName:'DIV',closest:()=>null}})
    assert.equal(entry.invalidated,true); assert.ok(f.project.canvases.new)
    assert.equal(f.calls.includes('detach'),false)
  } finally { f.harness.restore() }
})

test('manual pixel undo with an unknown receipt replays the frozen request after reopening', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(),Uint8Array.of(0,255,0,255))
    const before = structuredClone(f.docs.get('doc_new'))
    await f.session.savePixelStroke(await f.session.preparePixelEdit(),Uint8Array.of(0,0,255,255))
    let receipt
    const attempts = []
    f.api.restoreWorking = async (pid,did,req) => {
      attempts.push(req)
      if (receipt) return receipt
      const doc = {...before,revision:f.docs.get(did).revision+3}
      f.docs.set(did,doc)
      f.project = {...f.project,revision:f.project.revision+1,sprite_documents:{...f.project.sprite_documents,[did]:{working_revision:doc.revision}}}
      receipt = {project:f.project,document:doc,receipt:{operation_id:req.operationId,project_id:pid,project_revision:f.project.revision,document_id:did,document_revision:doc.revision}}
      throw Object.assign(new Error('lost'),{kind:'unknown'})
    }
    const key = {type:'keydown',key:'z',metaKey:true,target:{tagName:'DIV',closest:()=>null}}
    await f.harness.root.dispatchEvent(key)
    assert.equal(f.session.history.undo.length,2)
    await f.session.reloadProject(f.project)
    // r7: once the history pointer moved, the session announces it, so results bound to that entry re-read it.
    const announced = []
    f.harness.root.addEventListener('vnext-draft-change', () => announced.push(f.session.history.redo.length))
    await f.harness.root.dispatchEvent(key)
    assert.ok(announced.includes(1), 'a change is announced after the entry moved to redo')
    assert.equal(attempts.length,2); assert.equal(attempts[0],attempts[1])
    assert.equal(f.session.history.undo.length,1); assert.equal(f.session.history.redo.length,1)
    assert.equal(f.session.history.redo[0].invalidated,undefined)
    assert.equal(f.session.history.pixelHeads.get('doc_new'),receipt.document.revision)
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256,before.cels.c.block.sha256)
  } finally { f.harness.restore() }
})

test('manual unknown save freezes request and blocks edits until exact replay and refresh complete', async () => {
  const f = await pixelSessionFixture()
  try {
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,255,0,255))
    const write = f.api.writeWorkingPixels, attempts=[]
    let receipt
    f.api.writeWorkingPixels = async (p,d,r) => {
      attempts.push(r)
      if (!receipt) { receipt=await write(p,d,r); throw Object.assign(new Error('lost'),{kind:'unknown'}) }
      return receipt
    }
    await f.session.savePixelStroke(await f.session.preparePixelEdit(), Uint8Array.of(0,0,255,255))
    assert.ok(f.session.manualWrite); assert.equal(f.session.history.undo.length,1)
    await assert.rejects(f.session.preparePixelEdit(),{code:'pixel_busy'})
    await f.session.confirm.onPrimary()
    assert.equal(attempts.length,2); assert.equal(attempts[0],attempts[1])
    assert.equal(f.session.manualWrite,null); assert.equal(f.session.history.undo.length,2)
    assert.deepEqual(f.calls,['derive','pixels','position','pixels'])
  } finally { f.harness.restore() }
})

test('manual no-op and stale source do not write; an active stroke blocks other image edits', async () => {
  const f = await pixelSessionFixture()
  try {
    const source = await f.session.preparePixelEdit()
    await f.session.savePixelStroke(source,source.rgba)
    assert.equal(f.calls.length,0)
    f.session.manualGesture={}
    await assert.rejects(f.session.preparePixelEdit(),{code:'pixel_busy'})
    await assert.rejects(f.session.savePixelStroke(source,Uint8Array.of(0,0,0,0)))
    f.session.manualGesture=null; f.session.conversationRef=null
    await assert.rejects(f.session.savePixelStroke(source,Uint8Array.of(0,0,0,0)))
    assert.equal(f.calls.length,0)
  } finally { f.harness.restore() }
})

test('selected image creates an independent canvas and history; Undo/Redo preserve source and selection', async () => {
  const f = await pixelSessionFixture()
  try {
    const source = await f.session.preparePixelEdit()
    const creating = f.session.createPixelCopy(source, { type: 'fill-rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: [0, 255, 0, 255] })
    assert.equal(f.session.pixelCopyBusy, true)
    f.session.resolvePixelCopy()
    assert.equal(f.session.confirm, null, 'no recovery may run before the digest/state exists')
    const message = await creating
    assert.match(message, /beside the original/)
    assert.equal(f.session.view.selectedId, 'old'); assert.equal(f.session.conversationRef.canvasId, 'old')
    assert.equal(f.session.history.undo.length, 1); assert.equal(f.session.pixelCopyPending, false)
    const key = { type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest: () => null } }
    await f.harness.root.dispatchEvent(key)
    assert.equal(f.session.project.canvases.new, undefined)
    await f.harness.root.dispatchEvent({ ...key, shiftKey: true })
    assert.equal(f.session.project.canvases.new.document_id, 'doc_new')
    assert.deepEqual(f.calls, ['derive', 'pixels', 'position', 'detach', 'restore'])
    assert.equal(f.docs.get('doc_old').revision, 1); assert.deepEqual([...f.bytes], [255, 0, 0, 255])
  } finally { f.harness.restore() }
})

test('the operation-based pixel copy of an imported original writes once as an undoable copy beside it, without a review modal', async () => {
  const f = await pixelSessionFixture(), oldImageData = globalThis.ImageData
  const make = document.createElement
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
  document.createElement = tag => {
    const node = make(tag)
    if (tag === 'canvas') node.getContext = () => ({ putImageData(value) { node.pixels = value.data } })
    return node
  }
  try {
    const operation = { type: 'fill-rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: [0, 255, 0, 255] }
    const source = await f.session.preparePixelEdit()
    assert.equal(f.session.reviewPixelEdit, undefined, 'the retired preview-and-confirm modal has no entry point')
    const applied = await f.session.createPixelCopy(source, operation)
    assert.match(applied, /beside the original/)
    assert.equal(f.harness.byId.get('vnext-confirm-dialog')?.hidden ?? true, true, 'no confirmation dialog')
    assert.deepEqual(f.calls, ['derive', 'pixels', 'position'], 'applied exactly once')
    assert.equal(f.session.history.undo.length, 1)
  } finally { globalThis.ImageData = oldImageData; f.harness.restore() }
})

test('unknown Undo while awaiting a model blocks a late copy without changing its recovery request', async () => {
  const f = await pixelSessionFixture()
  try {
    const source = await f.session.preparePixelEdit(), requests = []
    f.api.resetCanvasName = async (_p, _c, body) => {
      requests.push(body)
      throw Object.assign(new Error('lost ACK'), { kind: 'unknown', submittedUnknown: true })
    }
    f.session.history = { projectId: source.projectId, undo: [{ kind: 'rename', projectId: source.projectId, canvasId: 'old', beforeOmitted: true, afterName: 'Image' }], redo: [] }
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest: () => null } })
    assert.equal(f.session.historyBusy, false)
    assert.equal(f.session.pendingHistory.size, 1)
    const pending = f.session.pendingHistory.get(source.projectId)
    await assert.rejects(f.session.createPixelCopy(source, { type: 'erase', rect: { x: 0, y: 0, w: 1, h: 1 } }), { code: 'assistant_context_changed' })
    assert.deepEqual(f.calls, [])
    assert.equal(f.session.pendingHistory.get(source.projectId), pending)
    assert.equal(requests.length, 1)
  } finally { f.harness.restore() }
})

test('unknown copy write locks Undo and recovers same request; same-project reopen rejects prepared edit', async () => {
  const f = await pixelSessionFixture()
  try {
    const oldSource = await f.session.preparePixelEdit()
    f.api.openEpoch.next()
    await assert.rejects(f.session.createPixelCopy(oldSource, { type: 'erase', rect: { x: 0, y: 0, w: 1, h: 1 } }), { code: 'assistant_context_changed' })
    const source = await f.session.preparePixelEdit(), write = f.api.writeWorkingPixels
    const requests = []; let once = true
    f.api.writeWorkingPixels = async (...args) => { requests.push(args[2]); if (once) { once = false; throw Object.assign(new Error('lost ACK'), { kind: 'unknown' }) } return write(...args) }
    const message = await f.session.createPixelCopy(source, { type: 'erase', rect: { x: 0, y: 0, w: 1, h: 1 } })
    assert.match(message, /not complete/); assert.equal(f.session.pixelCopyPending, true)
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest: () => null } })
    assert.deepEqual(f.calls, ['derive'])
    await f.session.confirm.onPrimary()
    assert.equal(f.session.pixelCopyPending, false); assert.equal(f.session.history.undo.length, 1)
    assert.equal(requests[0], requests[1]); assert.deepEqual(f.calls, ['derive', 'pixels', 'position'])
  } finally { f.harness.restore() }
})

function spriteManifest(id, frameCount, layerName, duration) {
  const frame_order = Array.from({ length: frameCount }, (_, index) => `frame_${index + 1}`)
  const frames = Object.fromEntries(frame_order.map((frameId) => [frameId, { duration_ms: duration }]))
  return {
    document_id: id,
    frame_order,
    layer_order: ['layer'],
    frames,
    layers: { layer: { id: 'layer', name: layerName } },
    cels: {},
  }
}

test('preview click selects the canvas, updates the timeline, and shows the real thumbnail', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => { throw new Error('no network') } })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', name: 'A', revision: 1 }
    session.documents.set('doc_a', spriteManifest('doc_a', 12, 'Walk', 125))
    session.documents.set('doc_b', spriteManifest('doc_b', 4, 'Idle', 200))
    session.view.setCanvases([
      { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 32, height: 32, preview: { toDataURL: () => 'data:image/png,a' } },
      { id: 'canvas_b', document_id: 'doc_b', x: 80, y: 0, width: 32, height: 32, preview: { toDataURL: () => 'data:image/png,b' } },
    ])
    session.renderCanvas()
    const body = harness.root.querySelector('.vnext-preview-body')
    const located = body.querySelector('[data-locator-id="canvas_b"]')
    const thumb = located.children.find((child) => child.tagName === 'IMG')
    assert.equal(thumb.getAttribute('src'), 'data:image/png,b')
    const left = Number.parseFloat(located.style.left)
    const top = Number.parseFloat(located.style.top)
    await body.dispatchEvent({ type: 'click', clientX: left + 1, clientY: top + 1 })
    assert.equal(session.view.selectedId, 'canvas_b')
    assert.equal(harness.root.querySelector('.vnext-play-total').textContent, '/ 04')
    assert.equal(harness.byId.get('vnext-layer-col').querySelector('.vnext-layer-name').textContent, 'Idle')
  } finally {
    harness.restore()
  }
})

test('late save failure after a real Open cannot discard project B', async () => {
  const harness = createSessionHarness()
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  let saveEntered
  const saveStarted = new Promise((resolve) => { saveEntered = resolve })
  const projectA = { id: 'proj_a', name: 'A', revision: 4, canvases: { canvas_a: { id: 'canvas_a', x: 0, y: 0 } } }
  const projectB = { id: 'proj_b', name: 'B', revision: 2, canvases: { canvas_b: { id: 'canvas_b', x: 8, y: 8 } } }
  let opened
  const openedGate = new Promise((resolve) => { opened = resolve })
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/canvas-layout')) {
        saveEntered()
        await saveGate
        return jsonResponse(409, { error: 'stale_revision' })
      }
      if (path.endsWith('/api/editor/projects/proj_b')) return jsonResponse(200, { project: projectB })
      if (path.endsWith('/api/editor/projects/proj_b/sprite-documents')) {
        opened()
        return jsonResponse(200, { documents: [] })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = projectA
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 3, 1)
    const pending = harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await saveStarted
    session.list.status = 'ready'
    session.list.projects = [{ id: 'proj_b', name: 'B', version: 'editor_project_v1', revision: 2 }]
    session.list.selectedId = 'proj_b'
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await openedGate
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.id, 'proj_b')
    session.view.moveDraft('canvas_b', 20, 9)
    const before = {
      id: session.project.id,
      revision: session.project.revision,
      draft: session.view.positionOf('canvas_b'),
      canvas: session.view.canvases.find((item) => item.id === 'canvas_b')?.id,
    }
    releaseSave()
    await pending
    assert.equal(session.project.id, before.id)
    assert.equal(session.project.revision, before.revision)
    assert.deepEqual(session.view.positionOf('canvas_b'), before.draft)
    assert.equal(session.view.canvases[0].id, before.canvas)
    assert.equal(session.confirm, null)
    assert.notEqual(harness.byId.get('vnext-confirm-title').textContent, 'Canvas positions changed')
  } finally {
    harness.restore()
  }
})

test('stale save during a confirmed Open does not cancel B or show A conflict', async () => {
  const harness = createSessionHarness()
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  let saveEntered
  const saveStarted = new Promise((resolve) => { saveEntered = resolve })
  let releaseB
  const bGate = new Promise((resolve) => { releaseB = resolve })
  let bEntered
  const bStarted = new Promise((resolve) => { bEntered = resolve })
  const projectA = { id: 'proj_a', name: 'A', revision: 4, canvases: { canvas_a: { id: 'canvas_a', x: 0, y: 0 } } }
  const projectB = { id: 'proj_b', name: 'B', revision: 2, canvases: { canvas_b: { id: 'canvas_b', x: 8, y: 8 } } }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/canvas-layout')) {
        saveEntered()
        await saveGate
        return jsonResponse(409, { error: 'stale_revision' })
      }
      if (path.endsWith('/api/editor/projects/proj_b')) {
        bEntered()
        await bGate
        return jsonResponse(200, { project: projectB })
      }
      if (path.endsWith('/api/editor/projects/proj_a')) throw new Error('conflict read must not fetch A')
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = projectA
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 3, 1)
    const pending = harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await saveStarted
    session.list.status = 'ready'
    session.list.projects = [{ id: 'proj_b', name: 'B', version: 'editor_project_v1', revision: 2 }]
    session.list.selectedId = 'proj_b'
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await bStarted
    const epochDuringOpen = client.openEpoch.current
    releaseSave()
    await pending
    assert.equal(client.openEpoch.current, epochDuringOpen)
    assert.equal(session.project.id, 'proj_a')
    assert.equal(session.confirm, null)
    assert.notEqual(harness.byId.get('vnext-confirm-title').textContent, 'Canvas positions changed')
    releaseB()
    await new Promise((resolve) => {
      const check = () => (session.project?.id === 'proj_b' ? resolve() : setImmediate(check))
      check()
    })
    assert.equal(session.project.name, 'B')
    assert.equal(session.project.revision, 2)
    assert.equal(session.view.canvases.some((item) => item.id === 'canvas_b'), true)
    assert.equal(session.confirm, null)
  } finally {
    harness.restore()
  }
})

test('Escape and cancelled Open keep a successful save or import on project A', async () => {
  const harness = createSessionHarness()
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  let releaseImport
  const importGate = new Promise((resolve) => { releaseImport = resolve })
  const projectA = { id: 'proj_a', name: 'A', revision: 4, canvases: {} }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/canvas-layout')) {
        await saveGate
        return jsonResponse(201, {
          project: { ...projectA, revision: 5 },
          receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_revision: 5 },
        })
      }
      if (path.includes('/import-png')) {
        await importGate
        return jsonResponse(201, {
          project: { ...projectA, revision: 6, canvases: { canvas_a: { id: 'canvas_a', x: 4, y: 2 } } },
          receipt: { operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      if (path.endsWith('/api/editor/projects/proj_a')) return jsonResponse(200, { project: projectA })
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = projectA
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 4, 2)
    const pending = harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: { tagName: 'DIV' } })
    releaseSave()
    await pending
    assert.equal(session.project.id, 'proj_a')
    assert.equal(session.project.revision, 5)
    assert.equal(session.saveReceipt.project_revision, 5)
    assert.deepEqual(session.view.positionOf('canvas_a'), { x: 4, y: 2 })

    session.view.moveDraft('canvas_a', 7, 3)
    const input = harness.byId.get('vnext-import-input')
    input.files = [{ name: 'hero.png', arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]) }]
    const importing = input.dispatchEvent({ type: 'change' })
    harness.openRoot.hidden = false
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.cancelBtn })
    releaseImport()
    await importing
    assert.equal(session.project.id, 'proj_a')
    assert.equal(session.project.revision, 6)
    // The user's own draft survives; the imported canvas may add its own placement draft (it is moved
    // beside existing canvases instead of covering them), which Save canvas positions then stores.
    const dirty = session.view.listedDirtyPositions()
    assert.deepEqual(dirty.filter(item => item.canvas_id === 'canvas_a'), [{ canvas_id: 'canvas_a', x: 7, y: 3 }])
    assert.ok(dirty.length <= 2, 'at most the user draft plus the new canvas placement')
  } finally {
    harness.restore()
  }
})

test('new project unknown retry is not blocked by an earlier successful save', async () => {
  const harness = createSessionHarness()
  const projectA = { id: 'proj_a', name: 'A', revision: 4, canvases: {} }
  const projectC = { id: 'proj_c', name: 'C', revision: 1, canvases: {} }
  let createCalls = 0
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/canvas-layout')) {
        return jsonResponse(201, {
          project: { ...projectA, revision: 5 },
          receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_revision: 5 },
        })
      }
      if (path.endsWith('/api/editor/projects/v1')) {
        createCalls += 1
        if (createCalls === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(201, {
          project: projectC,
          receipt: { operation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', project_revision: 1 },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = projectA
    session.view.setCanvases([{ id: 'canvas_a', x: 1, y: 1, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 2, 2)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(session.project.revision, 5)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.createBtn })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(session.project.id, 'proj_c')
    assert.equal(session.project.revision, 1)
    assert.equal(createCalls, 2)
  } finally {
    harness.restore()
  }
})

test('new project unknown retry works when no earlier write is active', async () => {
  const harness = createSessionHarness()
  const projectC = { id: 'proj_c', name: 'C', revision: 1, canvases: {} }
  let createCalls = 0
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      if (!String(url).endsWith('/api/editor/projects/v1')) throw new Error(`unexpected ${url}`)
      createCalls += 1
      if (createCalls === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
      return jsonResponse(201, {
        project: projectC,
        receipt: { operation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', project_revision: 1 },
      })
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    assert.equal(session.activeWrite, null)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.createBtn })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.id, 'proj_c')
    assert.equal(createCalls, 2)
  } finally {
    harness.restore()
  }
})

test('rejected drops visibly guide project selection without reading or queuing the file', async () => {
  const harness = createSessionHarness()
  const stage = harness.byId.get('vnext-canvas-stage')
  const toast = harness.byId.get('vnext-project-toast')
  const status = harness.byId.get('vnext-canvas-status')
  let reads = 0
  let creates = 0
  let imports = 0
  const project = { id: 'proj_new', name: 'Drop check', revision: 1, canvases: {} }
  const file = pngFile('local.png', { arrayBuffer: async () => { reads += 1; return new Uint8Array([137, 80, 78, 71]) } })
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.endsWith('/api/editor/projects/v1')) {
        creates += 1
        return jsonResponse(201, { project, receipt: { project_revision: 1 } })
      }
      if (path.includes('/import-png?')) {
        imports += 1
        return jsonResponse(201, { project: { ...project, revision: 2 }, receipt: { project_revision: 2 } })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })
  const drop = (files) => stage.dispatchEvent({ type: 'drop', clientX: 20, clientY: 30, dataTransfer: { files } })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    await drop([file])
    assert.equal(toast.hidden, false)
    assert.equal(toast.textContent, 'Create or open a project, then drop the image again.')
    assert.equal(status.textContent, toast.textContent)
    assert.equal(status.classList.contains('is-error'), true)
    assert.equal(harness.menu.hidden, false)
    assert.equal(harness.byId.get('vnext-project-btn').getAttribute('aria-expanded'), 'true')
    assert.equal(session.pendingImport, false)
    assert.deepEqual([reads, creates, imports], [0, 0, 0])

    await harness.menu.dispatchEvent({ type: 'click', target: harness.createBtn })
    assert.equal(session.project.id, 'proj_new')
    assert.deepEqual([reads, creates, imports], [0, 1, 0])
    assert.equal(toast.hidden, true)
    assert.equal(status.hidden, true)
    for (const [files, reason] of [
      [[], 'Drop a local PNG or JPEG file, not an image link.'],
      [[file, file], 'Drop one PNG or JPEG file.'],
      [[{ name: 'bad.gif', type: 'image/gif' }], 'Only PNG or JPEG files can be dropped onto the canvas.'],
    ]) {
      await drop(files)
      assert.equal(toast.hidden, false)
      assert.equal(toast.textContent, reason)
      assert.equal(status.textContent, reason)
      assert.deepEqual([reads, creates, imports], [0, 1, 0])
    }
    await drop([file])
    assert.deepEqual([reads, creates, imports], [1, 1, 1])
    assert.equal(toast.hidden, true)
  } finally {
    harness.restore()
  }
})

test('canvas drop keeps one PNG at the frozen point and retries the same import', async () => {
  assert.equal(classifyCanvasDrop({ hasProject: false, files: [{ name: 'a.png', type: 'image/png' }] }).ok, false)
  assert.equal(classifyCanvasDrop({ hasProject: true, files: [{ name: 'a.png' }, { name: 'b.png' }] }).ok, false)
  assert.equal(classifyCanvasDrop({ hasProject: true, files: [{ name: 'a.jpg', type: 'image/jpeg' }] }).kind, 'jpeg')
  assert.equal(classifyCanvasDrop({ hasProject: true, files: [{ name: 'a.gif', type: 'image/gif' }] }).ok, false)
  assert.equal(canvasForImport({
    beforeIds: ['canvas_a'],
    documentId: 'doc_new',
    project: { canvases: { canvas_new: { id: 'canvas_new', document_id: 'doc_new' } } },
  }).id, 'canvas_new')

  const harness = createSessionHarness()
  const stage = harness.byId.get('vnext-canvas-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
  const png = { name: 'hero.png', type: 'image/png', arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]) }
  let calls = 0
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        calls += 1
        if (calls === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(201, {
          project: {
            id: 'proj_a',
            revision: 5,
            canvases: {
              canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
              canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0, name: 'hero' },
            },
          },
          document: { document_id: 'doc_new' },
          receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.panBy(10, 20)
    await stage.dispatchEvent({
      type: 'drop',
      clientX: 30,
      clientY: 50,
      dataTransfer: { files: [png, { name: 'other.png', type: 'image/png' }] },
    })
    assert.equal(calls, 0)
    await stage.dispatchEvent({
      type: 'drop',
      clientX: 30,
      clientY: 50,
      dataTransfer: { files: [png] },
    })
    assert.equal(calls, 1)
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    assert.equal(session.view.selectedId, 'canvas_new')
    assert.deepEqual(session.view.positionOf('canvas_new'), { x: 20, y: 30 })
    assert.equal(session.conversationRef.documentId, 'doc_new')
    assert.equal(session.conversationRef.projectId, 'proj_a')
    session.conversationRef = null
    session.contextDismissed = true
    session.renderCanvas()
    assert.equal(session.conversationRef, null)
    assert.equal(session.view.canvases.some((item) => item.id === 'canvas_new'), true)
  } finally {
    harness.restore()
  }
})

function pngFile(name, extra = {}) {
  return {
    name,
    type: 'image/png',
    size: extra.size ?? 8,
    arrayBuffer: extra.arrayBuffer || (async () => new Uint8Array([137, 80, 78, 71])),
  }
}

test('import claims the operation before read and rejects a second drop, a read failure, a project switch, and an oversized file', async () => {
  const harness = createSessionHarness()
  const stage = harness.byId.get('vnext-canvas-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
  let posts = 0
  let reads = 0
  let releaseRead
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      if (String(url).includes('/import-png')) {
        posts += 1
        return jsonResponse(201, {
          project: { id: 'proj_a', revision: 5, canvases: {} },
          document: { document_id: 'doc_new' },
          receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' },
        })
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  const session = bindVnextProjectSession(harness.root, { client })
  session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
  session.boundProjectId = 'proj_a'
  const status = harness.byId.get('vnext-canvas-status')
  const drop = (file) => stage.dispatchEvent({
    type: 'drop',
    clientX: 30,
    clientY: 50,
    dataTransfer: { files: [file] },
  })
  try {
    const oversized = pngFile('big.png', {
      size: VNEXT_IMPORT_PNG_MAX_BYTES + 1,
      arrayBuffer: async () => { reads += 1; return new Uint8Array() },
    })
    await drop(oversized)
    assert.equal(reads, 0)
    assert.equal(posts, 0)
    assert.equal(status.textContent, 'PNG exceeds 32 MiB.')
    assert.equal(harness.byId.get('vnext-project-toast').textContent, status.textContent)
    assert.equal(harness.byId.get('vnext-project-toast').hidden, false)

    const slow = pngFile('slow.png', {
      arrayBuffer: async () => {
        reads += 1
        await readGate
        return new Uint8Array([137, 80, 78, 71])
      },
    })
    const first = drop(slow)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.pendingImport?.kind, 'import')
    assert.equal(harness.byId.get('vnext-project-toast').hidden, true)
    const second = pngFile('second.png', {
      arrayBuffer: async () => { reads += 1; return new Uint8Array([137, 80, 78, 71]) },
    })
    await drop(second)
    assert.equal(reads, 1)
    assert.equal(posts, 0)
    assert.equal(status.textContent, 'Import already in progress.')
    assert.equal(harness.byId.get('vnext-project-toast').textContent, status.textContent)
    assert.equal(harness.byId.get('vnext-project-toast').hidden, false)
    releaseRead()
    await first
    assert.equal(posts, 1)
    assert.equal(session.pendingImport, false)
    assert.equal(harness.byId.get('vnext-project-toast').hidden, true)

    const rejected = pngFile('bad.png', {
      arrayBuffer: async () => { throw new Error('read failed') },
    })
    await drop(rejected)
    assert.equal(posts, 1)
    assert.equal(session.pendingImport, false)
    assert.equal(status.textContent, 'The PNG could not be imported.')

    const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
    crypto.subtle.digest = async (...args) => {
      session.project = { id: 'proj_b', revision: 1, canvases: { canvas_b: { id: 'canvas_b', x: 1, y: 1 } } }
      session.boundProjectId = 'proj_b'
      session.activity = (session.activity || 0) + 1
      return originalDigest(...args)
    }
    try {
      await drop(pngFile('late.png'))
    } finally {
      crypto.subtle.digest = originalDigest
    }
    assert.equal(posts, 1)
    assert.equal(session.project.id, 'proj_b')
    assert.deepEqual(session.project.canvases, { canvas_b: { id: 'canvas_b', x: 1, y: 1 } })
  } finally {
    harness.restore()
  }
})

function importedProject(extra = {}) {
  return {
    id: 'proj_a',
    revision: 5,
    canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
      canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0, name: 'hero' },
    },
    sprite_documents: {
      doc_new: { id: 'doc_new', working_revision: 2 },
    },
    ...extra,
  }
}

test('confirmed import reloads after a resource failure and does not import again', async () => {
  const harness = createSessionHarness()
  let releaseRead
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const stage = harness.byId.get('vnext-canvas-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
  let posts = 0
  let lists = 0
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        posts += 1
        return jsonResponse(201, {
          project: importedProject(),
          document: { document_id: 'doc_new' },
          receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' },
        })
      }
      if (path.endsWith('/sprite-documents')) {
        lists += 1
        if (lists === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(200, { documents: [] })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.panBy(10, 20)
    const first = stage.dispatchEvent({
      type: 'drop',
      clientX: 30,
      clientY: 50,
      dataTransfer: { files: [pngFile('hero.png', { arrayBuffer: async () => {
        await readGate
        return new Uint8Array([137, 80, 78, 71])
      } })] },
    })
    await stage.dispatchEvent({ type: 'drop', dataTransfer: { files: [pngFile('second.png')] } })
    assert.equal(harness.byId.get('vnext-project-toast').textContent, 'Import already in progress.')
    assert.equal(harness.byId.get('vnext-project-toast').hidden, false)
    releaseRead()
    await first
    assert.equal(harness.byId.get('vnext-project-toast').hidden, true)
    assert.equal(posts, 1)
    assert.equal(client.lastUnknown(), null)
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Imported, but the canvas did not refresh')
    assert.equal(session.view.positionOf('canvas_new'), null)
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts, 1)
    assert.equal(lists, 2)
    assert.equal(session.project.id, 'proj_a')
    assert.equal(session.view.selectedId, 'canvas_new')
    assert.deepEqual(session.view.positionOf('canvas_new'), { x: 20, y: 30 })
    assert.equal(session.conversationRef.workingRevision, 2)
    assert.equal(session.conversationRef.projectRevision, 5)
    assert.equal(session.history.undo.filter((entry) => entry.kind === 'import').length, 1)
  } finally {
    harness.restore()
  }
})

test('same-op import recovery reloads after the confirmed retry fails to refresh', async () => {
  const harness = createSessionHarness()
  const stage = harness.byId.get('vnext-canvas-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
  let posts = 0
  let lists = 0
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        posts += 1
        if (posts === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(201, {
          project: importedProject(),
          document: { document_id: 'doc_new' },
          receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' },
        })
      }
      if (path.endsWith('/sprite-documents')) {
        lists += 1
        if (lists === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(200, { documents: [] })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.panBy(10, 20)
    await stage.dispatchEvent({
      type: 'drop',
      clientX: 30,
      clientY: 50,
      dataTransfer: { files: [pngFile('hero.png')] },
    })
    assert.equal(posts, 1)
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts, 2)
    assert.equal(client.lastUnknown(), null)
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Imported, but the canvas did not refresh')
    session.project = { id: 'proj_b', revision: 1, canvases: { canvas_b: { id: 'canvas_b', x: 4, y: 4 } } }
    session.boundProjectId = 'proj_b'
    session.activity = (session.activity || 0) + 1
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts, 2)
    assert.equal(session.project.id, 'proj_b')
    assert.deepEqual(session.project.canvases, { canvas_b: { id: 'canvas_b', x: 4, y: 4 } })
  } finally {
    harness.restore()
  }
})

test('conversation reference keeps the asset working revision when positions are saved', async () => {
  const harness = createSessionHarness()
  const stage = harness.byId.get('vnext-canvas-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        return jsonResponse(201, {
          project: importedProject(),
          document: { document_id: 'doc_new' },
          receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      if (path.endsWith('/canvas-layout')) {
        return jsonResponse(201, {
          project: { id: 'proj_a', revision: 9, canvases: importedProject().canvases },
          receipt: { operation_id: '33333333-3333-4333-8333-333333333333', project_revision: 9 },
        })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    await stage.dispatchEvent({
      type: 'drop',
      clientX: 40,
      clientY: 40,
      dataTransfer: { files: [pngFile('hero.png')] },
    })
    assert.equal(session.conversationRef.projectRevision, 5)
    assert.equal(session.conversationRef.workingRevision, 2)
    assert.notEqual(session.conversationRef.workingRevision, session.conversationRef.projectRevision)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(session.project.revision, 9)
    assert.equal(session.conversationRef.projectRevision, 9)
    assert.equal(session.conversationRef.workingRevision, 2)
    assert.equal(session.conversationRef.documentId, 'doc_new')
    assert.equal(session.conversationRef.canvasId, 'canvas_new')
  } finally {
    harness.restore()
  }
})

test('canvas name sits outside the pixels, a failed rename keeps its draft, and JPEG drop is not transcoded', async () => {
  const harness = createSessionHarness()
  const slot = document.createElement('div')
  slot.className = 'vnext-ref-image'
  const empty = document.createElement('span')
  empty.className = 'vnext-ref-empty'
  const filled = document.createElement('span')
  filled.className = 'vnext-ref-filled'
  filled.hidden = true
  const preview = document.createElement('img')
  preview.id = 'vnext-ref-preview'
  const slotName = document.createElement('span')
  slotName.id = 'vnext-ref-name'
  const clear = document.createElement('button')
  clear.className = 'vnext-ref-clear'
  clear.hidden = true
  const fileInput = document.createElement('input')
  fileInput.id = 'vnext-ref-input'
  const error = document.createElement('span')
  error.id = 'vnext-ref-error'
  error.hidden = true
  filled.append(preview)
  filled.append(slotName)
  slot.append(empty)
  slot.append(filled)
  slot.append(clear)
  slot.append(fileInput)
  slot.append(error)
  const previousQuery = harness.root.querySelector.bind(harness.root)
  harness.root.querySelector = (selector) => {
    if (selector === '.vnext-ref-image') return slot
    if (selector === '.vnext-ref-empty') return empty
    if (selector === '.vnext-ref-filled') return filled
    if (selector === '#vnext-ref-preview') return preview
    if (selector === '#vnext-ref-name') return slotName
    if (selector === '.vnext-ref-clear') return clear
    if (selector === '#vnext-ref-error') return error
    if (selector === '#vnext-ref-input') return fileInput
    return previousQuery(selector)
  }
  const renameCalls = []
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  let imported = null
  const client = createVnextProjectClient({
    fetchImpl: async (url, init) => {
      imported = { url: String(url), type: init.headers['content-type'], body: init.body }
      return jsonResponse(422, { error: 'unsupported_input', reason: 'stopped' })
    },
  })
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    renameCalls.push(body)
    const error = new Error('stale')
    error.kind = 'stale'
    error.code = 'stale_revision'
    error.reason = 'project revision does not match'
    throw error
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = {
      id: 'proj_a',
      revision: 2,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6 } },
    }
    session.view.setCanvases([{
      id: 'canvas_a',
      document_id: 'doc_a',
      x: 4,
      y: 6,
      width: 8,
      height: 8,
      name: 'Gate',
      display_name: 'Gate',
      previewUrl: 'data:image/png;base64,rgba-preview',
    }])
    session.renderCanvas()
    const stage = harness.byId.get('vnext-canvas-stage')
    const tile = stage.querySelector('[data-canvas-id="canvas_a"]')
    const label = stage.querySelector('[data-canvas-name="canvas_a"]')
    assert.equal(label.tagName, 'BUTTON')
    assert.equal(label.parentNode, tile.parentNode)
    assert.equal(tile.querySelector('[data-canvas-name="canvas_a"]'), null)
    assert.equal(label.style.transform, 'translate(4px, -14px) scale(1)')
    assert.equal(label.textContent, 'Gate')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = stage.querySelector('[data-canvas-name="canvas_a"]')
    assert.equal(input.tagName, 'INPUT')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(renameCalls.length, 1)
    assert.equal(renameCalls[0].expectedRevision, 2)
    assert.equal(renameCalls[0].displayName, 'North gate')
    session.project.revision = 9
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(renameCalls.length, 2)
    assert.equal(renameCalls[1].expectedRevision, 2)
    assert.notEqual(renameCalls[1].operationId, renameCalls[0].operationId)
    assert.equal(renameCalls[1].expectedRevision, 2)
    assert.equal(input.value, 'North gate')
    assert.equal(session.view.canvases[0].name, 'Gate')
    await label.dispatchEvent({ type: 'click' })
    assert.equal(harness.byId.get('vnext-canvas-ref').hidden, true)
    assert.equal(slot.dataset.canvasSelection, '1')
    assert.equal(slotName.textContent, 'Gate')
    assert.equal(preview.src, 'data:image/png;base64,rgba-preview')
    assert.equal(fileInput.disabled, true)
    await clear.dispatchEvent({ type: 'click' })
    assert.equal(session.conversationRef, null)
    assert.equal(session.view.canvases.some((item) => item.id === 'canvas_a'), true)
    assert.equal(session.view.selectedId, null)
    assert.equal(fileInput.disabled, false)
    assert.equal(slot.dataset.canvasSelection, undefined)
    const stageDrop = harness.byId.get('vnext-canvas-stage')
    await stageDrop.dispatchEvent({
      type: 'drop',
      clientX: 10,
      clientY: 10,
      dataTransfer: { files: [{ name: 'gate.jpg', type: 'image/jpeg', arrayBuffer: async () => jpeg }] },
    })
    assert.match(imported.url, /\/import-jpeg\?/)
    assert.equal(imported.type, 'image/jpeg')
    assert.equal(Buffer.from(imported.body).equals(Buffer.from(jpeg)), true)
    assert.doesNotMatch(imported.url, /import-png/)
  } finally {
    harness.restore()
  }
})

test('canvas name blur saves once, Escape cancels, and rejected saves are not retried by blur', async () => {
  const harness = createSessionHarness()
  const calls = []
  let failure = null
  let finishSave
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, {}) })
  client.listDocuments = async () => []
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    calls.push(body)
    if (failure) throw Object.assign(new Error(failure), { kind: failure })
    await new Promise((resolve) => { finishSave = resolve })
    return {
      receipt: { operation_id: body.operationId },
      project: { id: 'proj_a', revision: 3, canvases: {
        canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6, display_name: body.displayName },
      } },
    }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6 },
    } }
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6, width: 8, height: 8, name: 'Gate' }])
    session.renderCanvas()
    const stage = harness.byId.get('vnext-canvas-stage')
    const nameNode = () => stage.querySelector('[data-canvas-name="canvas_a"]')
    const editName = async (value) => {
      await nameNode().dispatchEvent({ type: 'dblclick' })
      const input = nameNode()
      input.value = value
      await input.dispatchEvent({ type: 'input' })
      return input
    }
    let input = await editName('北门守卫')
    await input.dispatchEvent({ type: 'compositionstart' })
    await input.dispatchEvent({ type: 'blur' })
    assert.equal(calls.length, 0, 'composition is not saved prematurely')
    assert.equal(session.nameEdit.draft, '北门守卫')
    await input.dispatchEvent({ type: 'compositionend' })
    await input.dispatchEvent({ type: 'blur' })
    await input.dispatchEvent({ type: 'blur' })
    assert.equal(calls.length, 1, 'blur during a pending save does not duplicate it')
    assert.equal(calls[0].displayName, '北门守卫')
    finishSave()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(nameNode().textContent, '北门守卫')
    assert.equal(session.nameEdit, null)
    await input.dispatchEvent({ type: 'blur' })
    assert.equal(calls.length, 1, 'removing the saved editor does not submit again')

    input = await editName('Cancelled')
    await input.dispatchEvent({ type: 'keydown', key: 'Escape' })
    await input.dispatchEvent({ type: 'blur' })
    assert.equal(calls.length, 1)
    assert.equal(nameNode().textContent, '北门守卫')

    for (const kind of ['stale', 'unknown', 'rejected']) {
      failure = kind
      input = await editName(`Kept ${kind}`)
      await input.dispatchEvent({ type: 'blur' })
      await new Promise((resolve) => setImmediate(resolve))
      const afterFailure = calls.length
      await input.dispatchEvent({ type: 'blur' })
      assert.equal(calls.length, afterFailure, `${kind} needs explicit retry`)
      assert.equal(session.nameEdit.draft, `Kept ${kind}`)
      assert.equal(session.view.canvases[0].name, '北门守卫')
      await input.dispatchEvent({ type: 'keydown', key: 'Escape' })
    }
  } finally {
    harness.restore()
  }
})

test('selected reference shares the add-slot footprint with hover and keyboard-accessible removal', async () => {
  const { css } = await readPreview()
  assert.match(css, /\.vnext-ref-image \{[^}]*width: 53px;[^}]*height: 68px;[^}]*border-radius: 16px;/)
  const selectedRule = css.match(/\.vnext-ref-image\.is-canvas-selection \{([^}]*)\}/)?.[1]
  assert.ok(selectedRule)
  assert.doesNotMatch(selectedRule, /(?:width|height|border-radius):/)
  assert.match(css, /\.vnext-ref-image\.is-canvas-selection \.vnext-ref-preview \{[^}]*width: 45px;[^}]*height: 40px;/)
  assert.match(css, /\.vnext-ref-clear \{[^}]*opacity: 0;[^}]*pointer-events: none;/)
  assert.match(css, /\.vnext-ref-image:hover \.vnext-ref-clear,[\s\S]*?\.vnext-ref-image:focus-within \.vnext-ref-clear \{[^}]*opacity: 1;[^}]*pointer-events: auto;/)
  assert.match(css, /@media \(hover: none\) \{\s*\.vnext-ref-clear \{ opacity: 1; pointer-events: auto; \}/)
})

test('a late reference decode does not cover the selected canvas, and name editing isolates IME and pointer', async () => {
  const harness = createSessionHarness()
  const slot = document.createElement('div')
  slot.className = 'vnext-ref-image'
  const empty = document.createElement('span')
  empty.className = 'vnext-ref-empty'
  const filled = document.createElement('span')
  filled.className = 'vnext-ref-filled'
  filled.hidden = true
  const preview = document.createElement('img')
  preview.id = 'vnext-ref-preview'
  const name = document.createElement('span')
  name.id = 'vnext-ref-name'
  const clear = document.createElement('button')
  clear.className = 'vnext-ref-clear'
  clear.hidden = true
  const error = document.createElement('span')
  error.id = 'vnext-ref-error'
  error.hidden = true
  filled.append(preview)
  filled.append(name)
  slot.append(empty)
  slot.append(filled)
  slot.append(clear)
  slot.append(error)
  const previousQuery = harness.root.querySelector.bind(harness.root)
  harness.root.querySelector = (selector) => {
    if (selector === '.vnext-ref-image') return slot
    if (selector === '.vnext-ref-empty') return empty
    if (selector === '.vnext-ref-filled') return filled
    if (selector === '#vnext-ref-preview') return preview
    if (selector === '#vnext-ref-name') return name
    if (selector === '.vnext-ref-clear') return clear
    if (selector === '#vnext-ref-error') return error
    return previousQuery(selector)
  }
  const previousUrl = globalThis.URL
  const previousImage = globalThis.Image
  globalThis.URL = {
    createObjectURL: () => 'blob:draft',
    revokeObjectURL() {},
  }
  globalThis.Image = class {
    removeAttribute() {}
    set src(_value) {
      this.naturalWidth = 2
      this.naturalHeight = 2
      queueMicrotask(() => this.onload?.())
    }
  }
  const draftClient = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  const draftSession = bindVnextProjectSession(harness.root, { client: draftClient })
  draftSession.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
  draftSession.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'North gate' }])
  let release
  let selectedWhilePending = false
  const gate = new Promise((resolve) => { release = resolve })
  const file = { name: 'draft.png', type: 'image/png', size: 8 }
  const result = applyReferenceDraftFile(harness.root, file, {
    applyFile: async (next) => {
      await gate
      selectedWhilePending = slot.dataset.canvasSelection === '1'
      return applyModuleReferenceFile(next)
    },
  })
  draftSession.conversationRef = { projectId: 'proj_a', canvasId: 'canvas_a', documentId: 'doc_a', name: 'North gate' }
  draftSession.renderCanvas()
  release()
  assert.equal(await result, 'selection')
  assert.equal(selectedWhilePending, true)
  assert.equal(referenceDraftName(), 'draft.png')
  assert.equal(name.textContent, 'North gate')
  const sentReference = draftSession.consumeConversationRef()
  draftSession.renderCanvas()
  assert.equal(draftSession.conversationRef, sentReference, 'source binding survives composer consumption')
  assert.equal(slot.dataset.canvasSelection, undefined, 'the sent canvas is no longer an unsent attachment')
  assert.equal(name.textContent, 'draft.png', 'an unrelated reference draft is preserved')
  const nextSendReference = draftSession.consumeConversationRef()
  assert.equal(nextSendReference, null, 'a later text follow-up has no new canvas attachment to consume')
  draftSession.restoreConversationRef(nextSendReference)
  assert.equal(slot.dataset.canvasSelection, undefined, 'a failed follow-up does not resurrect an earlier attachment')
  draftSession.restoreConversationRef(sentReference)
  assert.equal(name.textContent, 'North gate', 'failed sending restores the original attachment')
  draftSession.consumeConversationRef()
  draftSession.selectCanvas('canvas_a')
  assert.equal(name.textContent, 'North gate', 'explicitly selecting the canvas attaches it again')
  const selectedAgain = draftSession.conversationRef
  draftSession.restoreConversationRef(sentReference)
  assert.equal(draftSession.conversationRef, selectedAgain, 'stale request cannot overwrite a new selection')
  await clear.dispatchEvent({ type: 'click' })
  assert.equal(draftSession.conversationRef, null)
  assert.equal(name.textContent, 'draft.png')
  assert.equal(preview.getAttribute('src') || preview.src, 'blob:draft')
  globalThis.URL = previousUrl
  globalThis.Image = previousImage
  harness.restore()

  const editHarness = createSessionHarness()
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    calls.push(body)
    const error = new Error('unknown')
    error.kind = 'unknown'
    error.reason = 'not confirmed'
    throw error
  }
  try {
    const session = bindVnextProjectSession(editHarness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6 } } }
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6, width: 8, height: 8, name: 'Gate' }])
    session.renderCanvas()
    const stage = editHarness.byId.get('vnext-canvas-stage')
    const label = stage.querySelector('[data-canvas-name="canvas_a"]')
    await stage.dispatchEvent({ type: 'pointerdown', target: label, clientX: 4, clientY: 6 })
    assert.equal(session.view.selectedId, null)
    await label.dispatchEvent({ type: 'dblclick' })
    const input = stage.querySelector('[data-canvas-name="canvas_a"]')
    input.value = '北门守卫'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 0)
    await input.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: false })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].displayName, '北门守卫')
    input.value = '北门改稿'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 1)
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 2)
    assert.equal(calls[1].displayName, '北门改稿')
    assert.notEqual(calls[1].operationId, calls[0].operationId)
  } finally {
    editHarness.restore()
  }
})

test('rename stale refresh does not rebase position drafts, and a late refresh does not touch the next project', async () => {
  const harness = createSessionHarness()
  const saves = []
  let releaseRefresh
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.renameCanvas = async () => {
    const error = new Error('stale')
    error.kind = 'stale'
    error.reason = 'project revision does not match'
    throw error
  }
  let refreshStarted = false
  client.getProject = async () => {
    refreshStarted = true
    return refreshGate
  }
  client.saveLayout = async (_projectId, body) => {
    saves.push(body)
    return { receipt: { operation_id: 'save' }, project: { id: 'proj_a', revision: body.expectedRevision } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = {
      id: 'proj_a',
      revision: 2,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } },
    }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.moveDraft('canvas_a', 10, 20)
    session.renderCanvas()
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await input.dispatchEvent({ type: 'dblclick' })
    const editor = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    editor.value = 'North gate'
    editor.dispatchEvent({ type: 'input' })
    const pending = editor.dispatchEvent({ type: 'keydown', key: 'Enter' })
    for (let i = 0; i < 10 && !refreshStarted; i += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(refreshStarted, true)
    session.project = { id: 'proj_b', revision: 1, canvases: {} }
    session.boundProjectId = 'proj_b'
    client.openEpoch.next()
    const status = harness.byId.get('vnext-canvas-status')
    const before = status.textContent
    releaseRefresh({
      ok: true,
      stale: false,
      project: { id: 'proj_a', revision: 9, canvases: { canvas_a: { id: 'canvas_a', x: 7, y: 8 } } },
    })
    await pending
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.id, 'proj_b')
    assert.equal(session.project.revision, 1)
    assert.equal(status.textContent, before)
  } finally {
    harness.restore()
  }
})

test('rename stale refresh keeps the position draft on its original revision', async () => {
  const harness = createSessionHarness()
  const saves = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.renameCanvas = async () => {
    const error = new Error('stale')
    error.kind = 'stale'
    throw error
  }
  client.getProject = async () => ({
    ok: true,
    stale: false,
    project: {
      id: 'proj_a',
      revision: 9,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 7, y: 8 } },
    },
  })
  client.saveLayout = async (_projectId, body) => {
    saves.push(body)
    return { receipt: { operation_id: 'save' }, project: { id: 'proj_a', revision: body.expectedRevision } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = {
      id: 'proj_a',
      revision: 2,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } },
    }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.moveDraft('canvas_a', 10, 20)
    session.renderCanvas()
    const label = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 2)
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 10, y: 20 }])
    assert.equal(session.nameEdit.expectedRevision, 9)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(saves[0].expectedRevision, 2)
    assert.deepEqual(saves[0].positions, [{ canvas_id: 'canvas_a', x: 10, y: 20 }])
  } finally {
    harness.restore()
  }
})

test('confirmed rename keeps the name but does not authorize overwriting an external position', async () => {
  const harness = createSessionHarness()
  const saves = []
  const remote = { revision: 9, x: 7, y: 8, name: 'Gate' }
  let renameCalls = 0
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => []
  client.getProject = async () => ({
    ok: true,
    stale: false,
    project: {
      id: 'proj_a',
      revision: remote.revision,
      canvases: {
        canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: remote.x, y: remote.y, display_name: remote.name },
      },
    },
  })
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    renameCalls += 1
    if (renameCalls === 1) {
      const error = new Error('stale')
      error.kind = 'stale'
      throw error
    }
    remote.revision += 1
    remote.name = body.displayName
    return {
      receipt: { operation_id: body.operationId },
      project: {
        id: 'proj_a',
        revision: remote.revision,
        canvases: {
          canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: remote.x, y: remote.y, display_name: body.displayName },
        },
      },
    }
  }
  client.saveLayout = async (_projectId, body) => {
    saves.push(body)
    if (body.expectedRevision !== remote.revision) {
      const error = new Error('stale')
      error.kind = 'stale'
      throw error
    }
    remote.revision += 1
    remote.x = body.positions[0].x
    remote.y = body.positions[0].y
    return {
      receipt: { operation_id: 'save' },
      project: { id: 'proj_a', revision: remote.revision },
    }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = {
      id: 'proj_a',
      revision: 2,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } },
    }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.moveDraft('canvas_a', 10, 20)
    session.renderCanvas()
    const label = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.nameEdit.expectedRevision, 9)
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 10)
    assert.equal(session.layoutBaseRevision, 2)
    assert.equal(session.view.canvases[0].name, 'North gate')
    const savedLabel = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await savedLabel.dispatchEvent({ type: 'dblclick' })
    const nextInput = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    nextInput.value = 'North gate kept'
    nextInput.dispatchEvent({ type: 'input' })
    await nextInput.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 11)
    assert.equal(session.layoutBaseRevision, 2)
    assert.equal(session.view.canvases[0].name, 'North gate kept')
    assert.deepEqual(session.view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 10, y: 20 }])
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(saves.length, 1)
    assert.equal(saves[0].expectedRevision, 2)
    assert.deepEqual(saves[0].positions, [{ canvas_id: 'canvas_a', x: 10, y: 20 }])
    assert.equal(remote.x, 7)
    assert.equal(harness.byId.get('vnext-confirm-dialog').hidden, false)
    assert.match(harness.byId.get('vnext-confirm-details').textContent, /10,20/)
    assert.match(harness.byId.get('vnext-confirm-details').textContent, /7,8/)
    assert.equal(session.view.canvases[0].name, 'North gate kept')
    assert.equal(session.project.revision, 11)
  } finally {
    harness.restore()
  }
})

test('a failed open releases the interrupted name edit without dropping the draft', async () => {
  const harness = createSessionHarness()
  let releaseRename
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.renameCanvas = (...args) => new Promise((resolve) => {
    calls.push(args[2])
    releaseRename = resolve
  })
  client.getProject = async () => ({ ok: false, stale: false })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = {
      id: 'proj_a',
      revision: 2,
      canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } },
    }
    session.boundProjectId = 'proj_a'
    session.list = {
      status: 'ready',
      projects: [{ id: 'proj_b', name: 'B', version: 'editor_project_v1', revision: 1 }],
      omitted_count: 0,
      query: '',
      selectedId: 'proj_b',
      error: null,
    }
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.renderCanvas()
    const label = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.nameEdit.committing, true)
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.id, 'proj_a')
    assert.equal(session.nameEdit.committing, false)
    assert.equal(session.nameEdit.draft, 'North gate')
    releaseRename({ receipt: { operation_id: calls[0].operationId }, project: { id: 'proj_a', revision: 99, canvases: {} } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 2)
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 2)
    assert.notEqual(calls[1].operationId, calls[0].operationId)
  } finally {
    harness.restore()
  }
})

test('command-z undoes one drag and a text field keeps native undo', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  const resets = []
  client.resetCanvasName = async () => { resets.push('reset'); return { receipt: { operation_id: 'r' }, project: { id: 'proj_a', revision: 3, canvases: {} } } }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.setTool('move')
    session.renderCanvas()
    const stage = harness.byId.get('vnext-canvas-stage')
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    assert.equal(session.history.undo.length, 1)
    const input = { tagName: 'INPUT', closest() { return this } }
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: input })
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    assert.equal(session.view.positionOf('canvas_a').x, 0)
    assert.equal(resets.length, 0)
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 2, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 22, clientY: 2, pointerId: 2, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 22, clientY: 2, pointerId: 2, target: stage })
    assert.equal(session.history.redo.length, 0)
  } finally {
    harness.restore()
  }
})

test('undo rename uses reset-name, and undo import detaches the same canvas', async () => {
  const harness = createSessionHarness()
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => []
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    calls.push(['rename', body.displayName])
    return {
      receipt: { operation_id: body.operationId },
      project: {
        id: 'proj_a',
        revision: 3,
        canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: body.displayName } },
      },
    }
  }
  client.resetCanvasName = async (_projectId, _canvasId, body) => {
    calls.push(['reset', body.operationId])
    return {
      receipt: { operation_id: body.operationId },
      project: { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } },
    }
  }
  client.detachCanvas = async (_projectId, canvasId, body) => {
    calls.push(['detach', canvasId, body.operationId])
    return {
      receipt: { operation_id: body.operationId },
      project: { id: 'proj_a', revision: 5, canvases: {}, pages: [{ id: 'page_a', canvas_order: [] }], sprite_documents: { doc_a: { id: 'doc_a' } } },
    }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.renderCanvas()
    const label = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.history.undo[0].kind, 'rename')
    assert.equal(session.history.undo[0].beforeOmitted, true)
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.some((item) => item[0] === 'reset'), true)
    assert.equal(Object.hasOwn(session.project.canvases.canvas_a, 'display_name'), false)
    session.history = { projectId: 'proj_a', undo: [{ kind: 'import', projectId: 'proj_a', canvasId: 'canvas_a', documentId: 'doc_a', to: { x: 4, y: 6 } }], redo: [] }
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.some((item) => item[0] === 'detach' && item[1] === 'canvas_a'), true)
    assert.equal(session.project.canvases.canvas_a, undefined)
    assert.equal(session.project.sprite_documents.doc_a.id, 'doc_a')
  } finally {
    harness.restore()
  }
})

test('lost history acknowledgement retries the frozen request and a failed refresh does not move the pointer', async () => {
  const harness = createSessionHarness()
  const calls = []
  let loads = 0
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => {
    loads += 1
    if (loads === 1) throw new Error('refresh failed')
    return []
  }
  client.getProject = async () => ({ ok: true, project: { id: 'proj_a', revision: 9, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } } })
  client.resetCanvasName = async (_projectId, _canvasId, body) => {
    calls.push({ ...body })
    if (calls.length === 1) {
      const error = new Error('unknown')
      error.kind = 'unknown'
      throw error
    }
    return {
      receipt: { operation_id: body.operationId },
      project: { id: 'proj_a', revision: 8, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } },
    }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: 'North gate' } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'North gate' }])
    session.history = {
      projectId: 'proj_a',
      undo: [{ kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, beforeName: '', afterName: 'North gate' }],
      redo: [],
    }
    const key = { type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } }
    await harness.root.dispatchEvent(key)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.history.undo.length, 1)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /result is unknown/)
    let reads = 0
    const importInput = harness.byId.get('vnext-import-input')
    importInput.files = [{ type: 'image/png', name: 'blocked.png', arrayBuffer() { reads += 1 } }]
    await importInput.dispatchEvent({ type: 'change', target: importInput })
    assert.equal(reads, 0)
    assert.equal(Boolean(session.pendingImport), false)
    session.project.revision = 9
    await harness.root.dispatchEvent(key)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 2)
    assert.equal(calls[1].operationId, calls[0].operationId)
    assert.equal(calls[1].expectedRevision, calls[0].expectedRevision)
    assert.equal(calls[0].expectedRevision, 4)
    assert.equal(session.history.undo.length, 1)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /was saved.*reload/)
    await harness.root.dispatchEvent(key)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 2)
    assert.equal(session.history.undo.length, 0)
    assert.equal(session.history.redo.length, 1)
    assert.equal(session.project.revision, 9)
    assert.equal(session.pendingHistory.size, 0)
  } finally {
    harness.restore()
  }
})

test('an unknown undo followed by a definitive stale rejection releases only its pending lock', async () => {
  const harness = createSessionHarness()
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.resetCanvasName = async (_pid, _cid, body) => {
    calls.push({ ...body })
    throw Object.assign(new Error('rejected'), calls.length === 1 ? { kind: 'unknown', submittedUnknown: true } : { kind: 'stale', submittedUnknown: false })
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.setTool('move')
    session.history = { projectId: 'proj_a', undo: [{ kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, afterName: 'Gate' }], redo: [] }
    const key = () => harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    await key()
    assert.equal(session.pendingHistory.size, 1)
    await key()
    assert.equal(session.pendingHistory.size, 0)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.redo.length, 0)
    assert.equal(session.project.revision, 2)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /not saved.*Refresh/)
    const stage = harness.byId.get('vnext-canvas-stage')
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    assert.equal(session.history.undo.length, 2)
  } finally { harness.restore() }
})

test('same-project edits wait for history reconciliation, and editable hosts keep native undo', async () => {
  const harness = createSessionHarness()
  let release
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => []
  client.resetCanvasName = () => new Promise((resolve) => { release = resolve })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: 'Gate' } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.setTool('move')
    session.history = {
      projectId: 'proj_a',
      undo: [{ kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, beforeName: '', afterName: 'Gate' }],
      redo: [{ kind: 'move', projectId: 'proj_a', canvasId: 'canvas_a', from: { x: 0, y: 0 }, to: { x: 3, y: 0 } }],
    }
    const stage = harness.byId.get('vnext-canvas-stage')
    const undo = harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    for (let i = 0; i < 10 && !session.historyBusy; i += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.historyBusy, true)
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 3, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 14, clientY: 2, pointerId: 3, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 14, clientY: 2, pointerId: 3, target: stage })
    assert.equal(session.view.positionOf('canvas_a').x, 0)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /in progress/)
    release({
      receipt: { operation_id: 'reset-1' },
      project: { id: 'proj_a', revision: 3, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } },
    })
    await undo
    assert.equal(session.history.undo.length, 0)
    assert.equal(session.history.redo.length, 2)
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 4, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 14, clientY: 2, pointerId: 4, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 14, clientY: 2, pointerId: 4, target: stage })
    assert.equal(session.history.undo.some((entry) => entry.kind === 'move'), true)
    assert.equal(session.history.redo.length, 0)
    session.history.undo.push({ kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, beforeName: '', afterName: 'Gate' })
    const plain = { tagName: 'DIV', getAttribute: () => '', closest() { return this } }
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: plain })
    assert.equal(session.historyBusy, false)
    const only = { tagName: 'DIV', getAttribute: () => 'plaintext-only', closest() { return this } }
    const before = session.history.undo.length
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: only })
    assert.equal(session.history.undo.length, before)
  } finally {
    harness.restore()
  }
})

test('mixed undo and redo round-trips, and a new drag truncates redo', async () => {
  const harness = createSessionHarness()
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => []
  const projectAfter = (revision, canvases) => ({ receipt: { operation_id: 'op' }, project: { id: 'proj_a', revision, canvases, sprite_documents: { doc_a: { id: 'doc_a' } } } })
  client.resetCanvasName = async (_projectId, _canvasId, body) => {
    calls.push(['reset', body.operationId, body.expectedRevision])
    return projectAfter(body.expectedRevision + 1, { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } })
  }
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    calls.push(['rename', body.operationId, body.expectedRevision, body.displayName])
    return projectAfter(body.expectedRevision + 1, { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: body.displayName } })
  }
  client.detachCanvas = async (_projectId, canvasId, body) => {
    calls.push(['detach', canvasId, body.operationId, body.expectedRevision])
    return projectAfter(body.expectedRevision + 1, {})
  }
  client.restoreCanvas = async (_projectId, canvasId, body) => {
    calls.push(['restore', canvasId, body.operationId, body.expectedRevision, body.detachOperationId])
    return projectAfter(body.expectedRevision + 1, { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6 } })
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: 'Gate' } }, sprite_documents: { doc_a: { id: 'doc_a' } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.view.setTool('move')
    session.history = {
      projectId: 'proj_a',
      undo: [
        { kind: 'import', projectId: 'proj_a', canvasId: 'canvas_a', documentId: 'doc_a', to: { x: 4, y: 6 } },
        { kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, beforeName: '', afterName: 'Gate' },
      ],
      redo: [],
    }
    const stage = harness.byId.get('vnext-canvas-stage')
    const key = (shift = false) => harness.root.dispatchEvent({
      type: 'keydown', key: 'z', metaKey: true, shiftKey: shift, target: { tagName: 'DIV', closest() { return null } },
    })
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    assert.deepEqual(session.history.undo.map((entry) => entry.kind), ['import', 'rename', 'move'])
    await key()
    assert.equal(session.view.positionOf('canvas_a').x, 0)
    assert.equal(session.history.redo[0].kind, 'move')
    await key(true)
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    await key()
    await key()
    assert.equal(calls[0][0], 'reset')
    await key()
    assert.equal(session.project.canvases.canvas_a, undefined)
    await key(true)
    await key(true)
    assert.equal(calls.at(-1)[0], 'rename')
    assert.equal(session.view.positionOf('canvas_a').x, 4)
    assert.equal(calls.filter((item) => item[0] === 'restore').every((item) => item[4] === calls.find((call) => call[0] === 'detach')[2]), true)
    await key()
    await key(true)
    assert.equal(session.history.undo.at(-1).kind, 'rename')
    assert.equal(session.history.redo[0].kind, 'move')
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6, width: 8, height: 8, name: 'Gate' }])
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 5, clientY: 7, pointerId: 4, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 25, clientY: 7, pointerId: 4, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 25, clientY: 7, pointerId: 4, target: stage })
    assert.equal(session.history.redo.length, 0)
    assert.equal(session.history.undo.at(-1).kind, 'move')
  } finally {
    harness.restore()
  }
})

test('import redo refresh recovery restores the unsaved drop point once and permits repeated round trips', async () => {
  const harness = createSessionHarness()
  const writes = []
  let failRefresh = true
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => { if (failRefresh) { failRefresh = false; throw new Error('refresh failed') }; return [] }
  client.restoreCanvas = async (_pid, cid, body) => {
    writes.push(['restore', cid, { ...body }])
    return { receipt: { operation_id: body.operationId }, project: { id: 'proj_a', revision: body.expectedRevision + 1, canvases: { [cid]: { id: cid, document_id: 'doc_a', x: 0, y: 0 } } } }
  }
  client.detachCanvas = async (_pid, cid, body) => {
    writes.push(['detach', cid, { ...body }])
    return { receipt: { operation_id: body.operationId }, project: { id: 'proj_a', revision: body.expectedRevision + 1, canvases: {} } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 3, canvases: {} }
    session.boundProjectId = 'proj_a'
    session.history = { projectId: 'proj_a', undo: [], redo: [{ kind: 'import', projectId: 'proj_a', canvasId: 'canvas_a', documentId: 'doc_a', detachOperationId: 'first-detach', to: { x: 40, y: 60 } }] }
    const key = (redo) => harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, shiftKey: redo, target: { tagName: 'DIV', closest() { return null } } })
    await key(true)
    assert.equal(session.history.redo.length, 1)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /was saved.*reload/)
    await key(true)
    assert.equal(writes.length, 1)
    assert.deepEqual(session.view.positionOf('canvas_a'), { x: 40, y: 60 })
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.redo.length, 0)
    for (let round = 0; round < 2; round += 1) {
      await key(false)
      assert.equal(session.project.canvases.canvas_a, undefined)
      const detachedOperation = writes.at(-1)[2].operationId
      await key(true)
      assert.equal(writes.at(-1)[2].detachOperationId, detachedOperation)
      assert.equal(session.project.canvases.canvas_a.document_id, 'doc_a')
      assert.deepEqual(session.view.positionOf('canvas_a'), { x: 40, y: 60 })
      assert.equal(session.history.undo.length, 1)
    }
    assert.equal(writes.length, 5)
    assert.equal(new Set(writes.map((entry) => entry[2].operationId)).size, 5)
  } finally { harness.restore() }
})

test('a saved drag can be undone and saved as the inverse position', async () => {
  const harness = createSessionHarness()
  const saves = []
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.saveLayout = async (_id, body) => {
    saves.push(structuredClone(body))
    const point = body.positions[0]
    return { receipt: { operation_id: 'save' }, project: { id: 'proj_a', revision: body.expectedRevision + 1, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: point.x, y: point.y } } } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.layoutBaseRevision = 2
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.setTool('move')
    const stage = harness.byId.get('vnext-canvas-stage')
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.deepEqual(saves.map((body) => [body.expectedRevision, body.positions[0].x]), [[2, 10], [3, 0]])
    assert.equal(session.project.canvases.canvas_a.x, 0)
    assert.equal(session.view.isDirty(), false)
    assert.equal(session.history.redo.length, 1)
  } finally { harness.restore() }
})

test('a position save conflict does not move history or lift the pinned layout revision', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.saveLayout = async () => {
    const error = new Error('stale')
    error.kind = 'stale'
    throw error
  }
  client.getProject = async () => ({
    ok: true,
    stale: false,
    project: { id: 'proj_a', revision: 9, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 7, y: 8 } } },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.layoutBaseRevision = 2
    session.layoutRevisionPinned = true
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.setTool('move')
    const stage = harness.byId.get('vnext-canvas-stage')
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    const before = session.history.undo.length
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(session.history.undo.length, before)
    assert.equal(session.history.redo.length, 0)
    assert.equal(session.layoutBaseRevision, 2)
    assert.equal(session.layoutRevisionPinned, true)
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    assert.equal(session.project.revision, 4)
  } finally {
    harness.restore()
  }
})

for (const version of [undefined, 'editor_project_v2']) {
test(`a late history receipt preserves another project edit and reconciles on reopening the original project (${version ?? 'legacy fixture'})`, async () => {
  const harness = createSessionHarness()
  const storage = version ? { version, sprite_documents: {}, history: { version: 'editor_history_v1', revisions: null, receipts: null, legacy_backup: null } } : {}
  let release
  let writes = 0
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.listDocuments = async () => []
  client.resetCanvasName = () => { writes += 1; return new Promise((resolve) => { release = resolve }) }
  client.getProject = async () => ({ ok: true, project: { ...storage, id: 'proj_a', revision: 9, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 3, y: 3 } } } })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { ...storage, id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: 'Gate' } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    session.history = {
      projectId: 'proj_a',
      undo: [
        { kind: 'move', projectId: 'proj_a', canvasId: 'canvas_a', from: { x: 0, y: 0 }, to: { x: 3, y: 3 } },
        { kind: 'rename', projectId: 'proj_a', canvasId: 'canvas_a', beforeOmitted: true, beforeName: '', afterName: 'Gate' },
      ],
      redo: [],
    }
    const originalHistory = session.history
    const pending = harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    for (let i = 0; i < 10 && !session.historyBusy; i += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.historyBusy, true)
    session.project = { ...storage, id: 'proj_b', revision: 1, canvases: { canvas_b: { id: 'canvas_b', document_id: 'doc_b', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_b'
    session.history = { projectId: 'proj_b', undo: [], redo: [] }
    client.openEpoch.next()
    session.view.setCanvases([{ id: 'canvas_b', document_id: 'doc_b', x: 0, y: 0, width: 8, height: 8 }])
    session.view.setTool('move')
    const stage = harness.byId.get('vnext-canvas-stage')
    await stage.dispatchEvent({ type: 'pointerdown', clientX: 2, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointermove', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    await stage.dispatchEvent({ type: 'pointerup', clientX: 12, clientY: 2, pointerId: 1, target: stage })
    assert.equal(session.history.undo.length, 1)
    const status = harness.byId.get('vnext-canvas-status')
    release({
      receipt: { operation_id: 'late' },
      project: { ...storage, id: 'proj_a', revision: 8, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 3, y: 3 } } },
    })
    await pending
    assert.equal(session.project.id, 'proj_b')
    assert.equal(session.project.revision, 1)
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.undo[0].projectId, 'proj_b')
    assert.equal(session.view.positionOf('canvas_b').x, 10)
    assert.equal(session.history.redo.length, 0)
    assert.equal(originalHistory.undo.length, 2)
    session.project = { ...storage, id: 'proj_a', revision: 3, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, display_name: 'Gate' } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate' }])
    client.openEpoch.next()
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    assert.equal(writes, 1)
    assert.equal(session.history, originalHistory)
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.redo.length, 1)
    assert.equal(session.project.revision, 9)
    assert.equal(status.textContent, '')
    await harness.root.dispatchEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } })
    assert.equal(session.history.undo.length, 0)
    assert.equal(session.history.redo.length, 2)
    assert.equal(session.view.positionOf('canvas_a').x, 0)
  } finally {
    harness.restore()
  }
})

}

test('a provider PNG is imported beside the original and saved without moving the original draft', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  const saves = []
  client.importPng = async (_projectId, body) => ({
    receipt: { operation_id: body.operationId, document_id: 'doc_new', project_revision: 5 },
    project: {
      id: 'proj_a',
      revision: 5,
      canvases: {
        canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
        canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0 },
      },
    },
    document: { document_id: 'doc_new' },
  })
  client.listDocuments = async () => []
  client.saveLayout = async (_projectId, body) => {
    saves.push(body)
    return { receipt: { operation_id: 'save' }, project: { id: 'proj_a', revision: 6, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 }, canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: body.positions[0].x, y: body.positions[0].y } } } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.layoutBaseRevision = 2
    session.layoutRevisionPinned = true
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 4, y: 6, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 10, 20)
    const placed = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
      anchor: { id: 'canvas_a', width: 8, height: 8 },
      name: 'Generated character',
    })
    assert.equal(saves.length, 1)
    assert.equal(saves[0].positions.length, 1)
    assert.equal(saves[0].positions[0].canvas_id, 'canvas_new')
    assert.equal(saves[0].positions[0].x, 10 + 8 + 16)
    assert.equal(placed.point.x, 34)
    assert.equal(session.view.positionOf('canvas_a').x, 10)
    assert.equal(session.layoutBaseRevision, 2)
    assert.equal(session.history.undo.filter((entry) => entry.kind === 'import').length, 1)
    client.openEpoch.next()
    const late = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current - 1,
      anchor: { id: 'canvas_a', width: 8, height: 8 },
    })
    assert.equal(late.abandoned, true)
    assert.equal(saves.length, 1)
  } finally {
    harness.restore()
  }
})

test('static image placement abandons a switched project before and during import', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  const imports = []
  client.importPng = async (projectId, body) => {
    imports.push({ projectId, revision: body.expectedRevision })
    session.project = { id: 'proj_b', revision: 99, canvases: {} }
    session.boundProjectId = 'proj_b'
    return {
      receipt: { operation_id: body.operationId, document_id: 'doc_new', project_revision: 5 },
      project: { id: 'proj_a', revision: 5, canvases: { canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0 } } },
      document: { document_id: 'doc_new' },
    }
  }
  client.listDocuments = async () => []
  client.saveLayout = async () => { throw new Error('save') }
  let session
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  try {
    session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    crypto.subtle.digest = async (...args) => {
      session.project = { id: 'proj_b', revision: 9, canvases: {} }
      session.boundProjectId = 'proj_b'
      return digest(...args)
    }
    const duringDigest = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
    })
    assert.equal(duringDigest.abandoned, true)
    assert.equal(imports.length, 0)
    crypto.subtle.digest = digest
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    const duringImport = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
    })
    assert.equal(duringImport.abandoned, true)
    assert.equal(imports.length, 1)
    assert.equal(imports[0].projectId, 'proj_a')
    assert.equal(imports[0].revision, 4)
    assert.equal(session.project.id, 'proj_b')
    assert.equal(session.project.canvases.canvas_new, undefined)
  } finally {
    crypto.subtle.digest = digest
    harness.restore()
  }
})

test('a failed static image position still undoes only the new image', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  const imported = {
    id: 'proj_a',
    revision: 5,
    canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
      canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0 },
    },
  }
  const imports = []
  const detached = []
  const restored = []
  client.importPng = async (_projectId, body) => {
    imports.push(body.operationId)
    return { receipt: { operation_id: body.operationId, document_id: 'doc_new', project_revision: 5 }, project: imported, document: { document_id: 'doc_new' } }
  }
  client.listDocuments = async () => []
  client.saveLayout = async () => { throw Object.assign(new Error('save failed'), { kind: 'rejected', reason: 'save failed' }) }
  client.detachCanvas = async (_projectId, canvasId) => {
    detached.push(canvasId)
    return { receipt: { operation_id: 'detach' }, project: { id: 'proj_a', revision: 7, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } } }
  }
  client.restoreCanvas = async (_projectId, canvasId) => {
    restored.push(canvasId)
    return { receipt: { operation_id: 'restore' }, project: imported }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 10, y: 20, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 10, 20)
    const placed = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
      anchor: { id: 'canvas_a', width: 8, height: 8 },
    })
    assert.equal(placed.positionFailed, true)
    assert.equal(imports.length, 1)
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.undo[0].canvasId, 'canvas_new')
    assert.equal(session.history.undo[0].to.x, 34)
    const key = { type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'DIV', closest() { return null } } }
    await harness.root.dispatchEvent(key)
    assert.deepEqual(detached, ['canvas_new'])
    await harness.root.dispatchEvent({ ...key, shiftKey: true })
    assert.deepEqual(restored, ['canvas_new'])
    assert.equal(imports.length, 1)
  } finally {
    harness.restore()
  }
})

test('an unknown static image import retries the same request', async () => {
  const harness = createSessionHarness()
  const imports = []
  const project = {
    id: 'proj_a',
    revision: 5,
    canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
      canvas_new: { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0 },
    },
  }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        const operationId = new URL(path, 'http://127.0.0.1').searchParams.get('operation_id')
        imports.push(operationId)
        if (imports.length === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        return jsonResponse(201, {
          project,
          document: { document_id: 'doc_new' },
          receipt: { operation_id: operationId, document_id: 'doc_new', project_revision: 5 },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      if (path.endsWith('/canvas-layout')) {
        return jsonResponse(201, {
          project: { ...project, revision: 6 },
          receipt: { operation_id: 'save', project_revision: 6 },
        })
      }
      throw new Error(`unexpected ${path}`)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8 }])
    const placed = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
    })
    assert.equal(placed.unknown, true)
    assert.equal(imports.length, 1)
    const again = await session.placeStaticImage({
      bytes: new Uint8Array([137, 80, 78, 71]),
      projectId: 'proj_a',
      openEpoch: client.openEpoch.current,
    })
    assert.equal(again.busy, true)
    assert.equal(imports.length, 1)
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(imports.length, 2)
    assert.equal(imports[0], imports[1])
    assert.equal(session.history.undo.filter((entry) => entry.canvasId === 'canvas_new').length, 1)
  } finally {
    harness.restore()
  }
})

for (const reopenedId of ['proj_a', 'proj_b']) {
  test(`opening ${reopenedId} releases a settled old static-image recovery lock`, async () => {
    const harness = createSessionHarness()
    const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, {}) })
    const imports = []
    client.listDocuments = async () => []
    client.importPng = async (id) => {
      imports.push(id)
      throw Object.assign(new Error('unknown import'), { kind: 'unknown' })
    }
    try {
      const session = bindVnextProjectSession(harness.root, { client })
      session.project = { id: 'proj_a', revision: 4, canvases: {} }
      session.boundProjectId = 'proj_a'
      await session.placeStaticImage({ projectId: 'proj_a', openEpoch: client.openEpoch.current,
        sourceJobId: 'old_job', bytes: new Uint8Array([137, 80]) })
      const oldRetry = session.confirm.onPrimary
      assert.ok(session.pendingImport)
      await harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
      client.openEpoch.next()
      await session.reloadProject({ id: reopenedId, revision: 5, canvases: {} })
      assert.equal(session.pendingImport, false)
      assert.deepEqual(await oldRetry(), { abandoned: true })
      assert.equal(imports.length, 1)
      const next = await session.placeStaticImage({ projectId: reopenedId, openEpoch: client.openEpoch.current,
        sourceJobId: 'new_job', bytes: new Uint8Array([137, 80]) })
      assert.equal(next.unknown, true)
      assert.deepEqual(imports, ['proj_a', reopenedId])
    } finally { harness.restore() }
  })
}

test('a submitted unknown import resumes the same request after returning to its project and does not write elsewhere', async () => {
  const harness = createSessionHarness()
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, {}) })
  const imports = []
  client.listDocuments = async () => []
  client.importPng = async (id, request) => {
    imports.push({ id, request })
    if (imports.length === 1) throw Object.assign(new Error('unknown import'), { kind: 'unknown' })
    return { project: { id, revision: 6, canvases: {} }, document: { document_id: 'doc_new' }, receipt: { document_id: 'doc_new' } }
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: {} }
    session.boundProjectId = 'proj_a'
    const bytes = new Uint8Array([137, 80, 78, 71])
    await session.placeStaticImage({ projectId: 'proj_a', openEpoch: client.openEpoch.current, sourceJobId: 'job_same', bytes })
    const first = imports[0]
    client.openEpoch.next()
    await session.reloadProject({ id: 'proj_b', revision: 1, canvases: {} })
    assert.equal(session.project.id, 'proj_b')
    assert.equal(session.pendingImport, false)
    assert.equal(imports.length, 1)
    client.openEpoch.next()
    await session.reloadProject({ id: 'proj_a', revision: 4, canvases: {} })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(imports.length, 2)
    assert.equal(imports[1].id, 'proj_a')
    assert.equal(imports[1].request.operationId, first.request.operationId)
    assert.equal(imports[1].request.expectedSha256, first.request.expectedSha256)
    assert.deepEqual(imports[1].request.bytes, bytes)
  } finally { harness.restore() }
})

test('returning a parked unknown import without a confirm dialog keeps the same request and does not throw', async () => {
  const harness = createSessionHarness()
  harness.byId.delete('vnext-confirm-title')
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, {}) })
  const imports = []
  client.listDocuments = async () => []
  client.importPng = async (id, request) => {
    imports.push({ id, request })
    throw Object.assign(new Error('unknown import'), { kind: 'unknown' })
  }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    assert.equal(harness.root.querySelector('#vnext-confirm-title'), null)
    session.project = { id: 'proj_a', revision: 4, canvases: {} }
    session.boundProjectId = 'proj_a'
    const bytes = new Uint8Array([137, 80, 78, 71])
    await assert.rejects(
      session.placeStaticImage({ projectId: 'proj_a', openEpoch: client.openEpoch.current, sourceJobId: 'job_same', bytes }),
      /textContent/,
    )
    const first = imports[0].request
    client.openEpoch.next()
    await session.reloadProject({ id: 'proj_b', revision: 1, canvases: {} })
    client.openEpoch.next()
    await session.reloadProject({ id: 'proj_a', revision: 4, canvases: {} })
    assert.equal(session.pendingImport?.hold, true)
    assert.equal(session.pendingImport?.importRequest?.operationId, first.operationId)
    assert.equal(session.pendingImport?.importRequest?.expectedSha256, first.expectedSha256)
    assert.deepEqual(session.pendingImport?.importRequest?.bytes, bytes)
    assert.equal(imports.length, 1)
    assert.equal(session.project.id, 'proj_a')
  } finally { harness.restore() }
})

for (const initialFailure of ['unknown-import', 'reload', 'native-jpeg', 'pixel-unknown-import', 'pixel-reload']) {
  test(`static image ${initialFailure} recovery survives Escape and releases its position lock`, async () => {
    const harness = createSessionHarness()
    const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
    const imports = [], saves = []
    const original = { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 }
    const added = { id: 'canvas_new', document_id: 'doc_new', x: 0, y: 0 }
    const project = { id: 'proj_a', revision: 5, canvases: { canvas_a: original, canvas_new: added } }
    let loads = 0
    client.importPng = async (_id, request) => {
      imports.push(request)
      if (!initialFailure.endsWith('reload') && imports.length === 1) throw Object.assign(new Error('unknown'), { kind: 'unknown' })
      return { project, document: { document_id: 'doc_new' }, receipt: { document_id: 'doc_new' } }
    }
    if (initialFailure === 'native-jpeg') {
      const importImage = client.importPng
      client.importGeneratedImage = async (pid, jid, request) => { assert.equal(jid, 'job_recovery'); return importImage(pid, request) }
      client.importPng = () => { throw new Error('native JPEG must use trusted generated-image bridge') }
    }
    client.listDocuments = async () => {
      if (++loads === 1 && initialFailure.endsWith('reload')) throw new Error('read failed')
      return []
    }
    client.saveLayout = async (_id, request) => {
      saves.push(request)
      if (saves.length === 1) throw Object.assign(new Error('unconfirmed position'), { kind: 'unknown' })
      return { project: { ...project, revision: 6 }, receipt: { operation_id: request.operationId } }
    }
    try {
      const session = bindVnextProjectSession(harness.root, { client })
      session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: original } }
      session.boundProjectId = 'proj_a'
      session.view.setCanvases([{ ...original, width: 8, height: 8 }])
      const openEpoch = client.openEpoch.current
      const pixelDrawing = initialFailure.startsWith('pixel-')
      const input = { projectId: 'proj_a', openEpoch, ...(pixelDrawing ? { pixelDrawing: true } : { sourceJobId: 'job_recovery' }), ...(initialFailure === 'native-jpeg' ? { nativeImageJobId: 'job_recovery' } : {}) }
      const resume = () => pixelDrawing ? session.resolvePixelDrawingSave() : session.placeStaticImage(input)
      const result = await session.placeStaticImage({ ...input, bytes: new Uint8Array(initialFailure === 'native-jpeg' ? [255, 216, 255] : [137, 80]) })
      assert.equal(Boolean(result.unknown || result.refreshFailed), true)
      await harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', target: { tagName: 'DIV', closest() { return null } } })
      assert.equal(client.openEpoch.current, openEpoch)
      assert.equal(session.confirm, null)
      assert.equal(session.hasPixelDrawingSave(), pixelDrawing)
      const partial = await resume()
      assert.equal(partial.positionUnknown, true)
      assert.ok(session.pendingImport)
      await harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
      const finished = await resume()
      assert.equal(finished.canvasId, 'canvas_new')
      assert.equal(session.pendingImport, false)
      assert.equal(session.layoutBaseRevision, 6)
      assert.equal(session.history.undo.filter(entry => entry.canvasId === 'canvas_new').length, 1)
      assert.equal(saves[0], saves[1])
      assert.equal(imports.length, initialFailure.endsWith('reload') ? 1 : 2)
      if (imports.length === 2) assert.equal(imports[0], imports[1])
      // Repeating recovery after success must not import or reposition again.
      await resume()
      assert.equal(session.hasPixelDrawingSave(), false)
      assert.equal(saves.length, 2)
      session.view.moveDraft('canvas_new', 60, 70)
      await harness.byId.get('vnext-project-menu').dispatchEvent({ type: 'click', target: harness.byId.get('vnext-save-positions') })
      assert.equal(saves.at(-1).expectedRevision, 6)
    } finally { harness.restore() }
  })
}

// Selection edits: 4×2 image, store stub applies working-pixels patches like the server.
async function selectionSessionFixture({ boot = false, width = 4, height = 2, nativeBlank = false, beforeBoot = () => {} } = {}) {
  const harness = createSessionHarness(), calls = [], writes = [], grants = []
  const original = Uint8Array.from({ length: width * height * 4 }, (_, i) => nativeBlank ? 0 : (i % 4 === 3 ? 255 : 10 + (i % 200)))
  const blocks = new Map(), revisions = new Map()
  const remember = async bytes => { const sha = await sha256Hex(bytes); blocks.set(sha, new Uint8Array(bytes)); return sha }
  const firstSha = await remember(original)
  let project = { id: 'sel_project', version: 'editor_project_v1', revision: 2,
    canvases: { old: { id: 'old', document_id: 'doc_old', x: 0, y: 0 } }, sprite_documents: { doc_old: { working_revision: 1 } } }
  const manifest = (id, sha, revision) => ({ document_id: id, name: 'Image', revision, canvas: { w: width, h: height },
    ...(nativeBlank && id === 'doc_old' ? { origin: { type: 'blank' }, source_ref: null } : {}),
    ...(id === 'doc_new' ? { derived_from: { document_id: 'doc_old', revision: 1, manifest_sha256: firstSha } } : {}),
    frame_order: ['f'], layer_order: ['l'], frames: { f: { duration_ms: 100 } }, layers: { l: { name: 'Layer', locked: false } },
    cels: { c: { frame_id: 'f', layer_id: 'l', block: { w: width, h: height, sha256: sha } } } })
  const docs = new Map([['doc_old', manifest('doc_old', firstSha, 1)]])
  revisions.set('doc_old', new Map([[1, docs.get('doc_old')]]))
  const commit = (id, doc) => {
    docs.set(id, doc); if (!revisions.has(id)) revisions.set(id, new Map()); revisions.get(id).set(doc.revision, doc)
    project = { ...project, revision: project.revision + 1, sprite_documents: { ...project.sprite_documents, [id]: { working_revision: doc.revision } } }
    return { project, document: doc }
  }
  const api = createVnextProjectClient({ fetchImpl: async () => { throw new Error('unexpected network') } })
  api.listDocuments = async () => [...docs.values()]
  api.getDocument = async (_p, id) => ({ document: docs.get(id) })
  api.getBlock = async (_p, _d, sha) => ({ width, height, sha256: sha, bytes: new Uint8Array(blocks.get(sha)) })
  api.getProject = async () => ({ ok: true, project, stale: false })
  api.createScopeGrant = async (_p, _d, body) => { calls.push('grant'); grants.push(body); return { grant_id: `grant_${grants.length}`, command_sha256: 'c'.repeat(64) } }
  api.deriveWorking = async (_p, body) => {
    calls.push('derive'); const canvas = { id: 'new', document_id: 'doc_new', x: 20, y: 0 }
    project = { ...project, canvases: { ...project.canvases, new: canvas } }
    const { project: next, document } = commit('doc_new', manifest('doc_new', docs.get('doc_old').cels.c.block.sha256, 1))
    return { project: next, canvas, document, receipt: { operation_id: body.operationId, project_id: next.id,
      project_revision: next.revision, document_id: 'doc_new', document_revision: 1 } }
  }
  api.writeWorkingPixels = async (_p, id, body) => {
    calls.push('pixels'); writes.push({ x: body.x, y: body.y, w: body.width, h: body.height, grantId: body.grantId })
    assert.ok(id === 'doc_new' || (nativeBlank && id === 'doc_old')); assert.equal(body.bytes.length, body.width * body.height * 4)
    const full = new Uint8Array(blocks.get(docs.get(id).cels.c.block.sha256))
    for (let row = 0; row < body.height; row++) full.set(body.bytes.subarray(row * body.width * 4, (row + 1) * body.width * 4), ((body.y + row) * width + body.x) * 4)
    const { project: next, document } = commit(id, manifest(id, await remember(full), docs.get(id).revision + 1))
    return { project: next, document, receipt: { operation_id: body.operationId, project_id: next.id,
      project_revision: next.revision, document_id: id, document_revision: document.revision } }
  }
  api.restoreWorking = async (_p, id, body) => {
    calls.push(`restore:${body.targetRevision}`)
    const target = revisions.get(id).get(body.targetRevision)
    const { project: next, document } = commit(id, { ...target, revision: docs.get(id).revision + 1 })
    return { project: next, document, receipt: { operation_id: body.operationId, project_id: next.id,
      project_revision: next.revision, document_id: id, document_revision: document.revision } }
  }
  api.saveLayout = async (_p, body) => {
    calls.push('position'); const point = body.positions[0]
    project = { ...project, revision: project.revision + 1, canvases: { ...project.canvases, [point.canvas_id]: { ...project.canvases[point.canvas_id], x: point.x, y: point.y } } }
    return { project, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision } }
  }
  api.detachCanvas = async (_p, canvasId, body) => {
    calls.push(`detach:${canvasId}`)
    const nextCanvases = { ...project.canvases }
    delete nextCanvases[canvasId]
    project = { ...project, revision: project.revision + 1, canvases: nextCanvases }
    return { project, receipt: { operation_id: body.operationId, project_id: project.id, project_revision: project.revision } }
  }
  let session
  beforeBoot({ harness, api, docs, commit })
  if (boot) {
    globalThis.window.location = { search: '', hash: '' }
    globalThis.document.querySelector = (selector) => harness.root.querySelector(selector)
    bootVnextPreview(harness.root, { client: api })
    session = globalThis.window.getVnextProjectSession()
  } else session = bindVnextProjectSession(harness.root, { client: api })
  await session.reloadProject(project)
  session.view.select('old')
  session.conversationRef = { projectId: project.id, canvasId: 'old', documentId: 'doc_old' }
  const pixels = async id => [...blocks.get(docs.get(id).cels.c.block.sha256)]
  // Keyboard focus on the page body, as after clicking the canvas or a tool.
  const key = (extra) => harness.root.dispatchEvent({ type: 'keydown', target: { tagName: 'BODY', closest: () => null }, stopImmediatePropagation() {}, ...extra })
  return { harness, api, session, calls, writes, grants, docs, blocks, firstSha, original, pixels, key, get project() { return project } }
}

test('document candidate previews, discards and saves without a false pending-stroke warning or reattaching the source', async () => {
  const priorImageData = globalThis.ImageData
  let commitCandidate
  const f = await selectionSessionFixture({ boot: true, beforeBoot({ docs, commit }) {
    commitCandidate = commit
    globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
    const make = document.createElement
    document.createElement = tag => {
      const node = make(tag)
      if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({
        drawImage() {}, clearRect() {}, strokeRect() {},
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData(image) { node.submitted = new Uint8Array(image.data) },
      })
      return node
    }
    const m = docs.get('doc_old'); m.frames.f.id = 'f'; Object.assign(m.layers.l, { id: 'l', kind: 'raster', visible: true }); m.cels.c.id = 'c'
  } })
  try {
    const { session, harness } = f, saved = session.documents.get('doc_old'), before = JSON.stringify(saved)
    const source = await session.prepareDocumentEdit(), bytes = Uint8Array.of(20,30,40,255, 80,90,100,255), hash = await sha256Hex(bytes)
    const candidate = structuredClone(saved); candidate.canvas = { w: 1, h: 2 }; candidate.cels.c.block = { w: 1, h: 2, sha256: hash }
    const value = { candidate_id: 'test-candidate', document: candidate, sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(candidate))), blocks: { [hash]: Buffer.from(bytes).toString('base64') } }
    await session.showDocumentCandidate(source, value)
    const tile = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-id="old"]')
    assert.equal(tile.style.width, '1px'); assert.equal(tile.style.height, '2px')
    assert.deepEqual([...tile.querySelector('canvas').submitted], [...bytes])
    assert.equal(session.pixelTargetInfo().width, 1)
    assert.equal(session.pixelTargetInfo().height, 2)
    assert.equal(session.pixelTargetInfo().readOnly, 'Applying this result…')
    assert.equal(JSON.stringify(session.documents.get('doc_old')), before); assert.deepEqual(f.calls, [])
    session.clearDocumentCandidate()
    assert.equal(tile.style.width, '4px'); assert.equal(tile.style.height, '2px')
    assert.deepEqual([...tile.querySelector('canvas').submitted], [...f.original])
    assert.equal(session.manualWrite, null); assert.equal(JSON.stringify(session.documents.get('doc_old')), before)
    await assert.rejects(session.showDocumentCandidate(source, value, () => false))
    assert.equal(session.documentCandidate, null)
    session.consumeConversationRef()
    await session.showDocumentCandidate(source, value)
    await session.saveDocumentCandidate(source, async () => {
      assert.equal(session.manualWrite.running, true, 'save lock is marked active throughout reload')
      f.blocks.set(hash, bytes)
      f.api.getBlock = async () => ({ width: 1, height: 2, sha256: hash, bytes })
      const result = commitCandidate('doc_old', { ...candidate, revision: 2 })
      return { ...result, canvas: result.project.canvases.old, receipt: {
        project_id: result.project.id, project_revision: result.project.revision, document_revision: 2,
      } }
    })
    assert.equal(session.manualWrite, null)
    assert.equal(session.documentCandidate, null)
    assert.equal(harness.byId.get('vnext-canvas-status').textContent, '', 'successful candidate reload is not an unresolved stroke')
    assert.equal(session.consumedConversationRef, session.conversationRef, 'Save keeps the attachment consumed')
    assert.equal(session.view.selectedId, 'old', 'the canvas stays selected')
  } finally { globalThis.ImageData = priorImageData; f.harness.restore() }
})

test('brush hover follows actual targets and transforms without selecting, reading or writing pixels', async () => {
  const f = await selectionSessionFixture({ width: 16, height: 16 })
  try {
    const { session, harness } = f, stage = harness.byId.get('vnext-canvas-stage')
    let reads = 0
    f.api.getBlock = async () => { reads++; throw new Error('hover must not read pixels') }
    session.view.setTool('pencil'); session.renderCanvas()
    const hover = async (x = 4, y = 4) => {
      const p = session.view.worldToScreen(x, y, stage.getBoundingClientRect())
      await stage.dispatchEvent({ type: 'pointermove', clientX: p.x, clientY: p.y, pointerId: 1 })
    }
    const visible = () => stage.classList.contains('has-brush-cursor')
    await hover()
    assert.equal(visible(), true)
    const svg = stage.querySelector('.vnext-brush-cursor'), path = svg.children[0]
    assert.equal(path.getAttribute('d'), 'M4 4h1M5 4v1M4 5h1M4 4v1')
    const priorTransform = path.getAttribute('transform')
    const anchor = session.view.worldToScreen(4, 4, stage.getBoundingClientRect())
    session.view.zoomAt(anchor.x, anchor.y, 2, stage.getBoundingClientRect()); session.renderCanvas()
    assert.notEqual(path.getAttribute('transform'), priorTransform)
    assert.equal(stage.querySelector('.vnext-brush-cursor'), svg, 'one reusable overlay')
    await hover()
    session.pixelSelection = { projectId: session.project.id, canvasId: 'old', rect: { x: 0, y: 0, w: 2, h: 2 } }
    session.renderCanvas(); assert.equal(visible(), false)
    await hover(1, 1); assert.equal(visible(), true)
    session.view.setSpaceDown(true); session.renderCanvas(); assert.equal(visible(), false)
    session.view.setSpaceDown(false); session.renderCanvas(); assert.equal(visible(), true)
    for (const field of ['manualWrite', 'frameLoading', 'pendingImport', 'historyBusy']) {
      session[field] = true; session.renderCanvas(); assert.equal(visible(), false, field)
      session[field] = false; session.renderCanvas(); assert.equal(visible(), true, field)
    }
    session.view.setTool('line'); session.renderCanvas(); assert.equal(visible(), false)
    session.view.setTool('eraser'); session.renderCanvas(); assert.equal(visible(), true)
    session.documents.get('doc_old').layers.l.locked = true
    session.renderCanvas(); assert.equal(visible(), false)
    session.documents.get('doc_old').layers.l.locked = false
    session.pixelSelection = null
    session.view.select(null); session.renderCanvas(); await hover()
    assert.equal(visible(), true); assert.equal(session.view.selectedId, null, 'hover never selects its target')
    await hover(16, 0); assert.equal(visible(), false, 'inclusive hitTest boundary is not paintable')
    await hover(); assert.equal(visible(), true)
    await stage.dispatchEvent({ type: 'pointerleave' }); assert.equal(visible(), false)
    session.renderCanvas(); assert.equal(visible(), false, 'refresh does not resurrect a departed pointer')
    await hover()
    let hit = stage
    harness.root.elementFromPoint = () => hit
    hit = harness.byId.get('vnext-view-settings')
    session.renderCanvas(); assert.equal(visible(), false, 'an overlapping control hides a stationary cursor')
    hit = stage; session.renderCanvas(); assert.equal(visible(), true)
    await stage.dispatchEvent({ type: 'pointermove', pointerType: 'touch', pointerId: 1, clientX: 4, clientY: 4 })
    assert.equal(visible(), false)
    await hover(); assert.equal(visible(), true)
    await stage.dispatchEvent({ type: 'pointercancel' }); assert.equal(visible(), false)
    assert.equal(reads, 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, [])
    assert.equal(session.project.revision, 2); assert.equal(session.history?.undo?.length || 0, 0)
  } finally { f.harness.restore() }
})

test('selection Delete on an original derives one copy, clears only the selected pixels, and keeps the marquee on the copy', async () => {
  const f = await selectionSessionFixture()
  try {
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 1, y: 0, w: 2, h: 1 } }
    await f.key({ key: 'Delete' })
    assert.deepEqual(f.calls, ['derive', 'grant', 'pixels'], 'the copy already sits at the computed free position')
    assert.deepEqual(f.writes, [{ x: 1, y: 0, w: 2, h: 1, grantId: 'grant_1' }])
    assert.deepEqual(f.grants[0].rect, { x: 1, y: 0, w: 2, h: 1 }); assert.deepEqual(f.grants[0].allowed_operations, ['working_pixels'])
    const expected = [...f.original]; expected.fill(0, 4, 12)
    assert.deepEqual(await f.pixels('doc_new'), expected)
    assert.deepEqual(await f.pixels('doc_old'), [...f.original], 'the original image is unchanged')
    assert.deepEqual(f.session.pixelSelection, { projectId: 'sel_project', canvasId: 'new', rect: { x: 1, y: 0, w: 2, h: 1 } })
    assert.deepEqual(f.session.history.undo.map(e => e.kind), ['import'])
    await f.key({ key: 'Delete' })
    assert.equal(f.calls.filter(c => c === 'pixels').length, 1, 'deleting transparent pixels again writes nothing')
  } finally { f.harness.restore() }
})

test('selection flip and move on a working copy are single patches; Undo/Redo restore pixels and the marquee', async () => {
  const f = await selectionSessionFixture()
  try {
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 0, y: 0, w: 2, h: 2 } }
    await f.key({ key: 'H', shiftKey: true })
    const flipped = await f.pixels('doc_new')
    const px = (bytes, x, y) => bytes.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)
    assert.deepEqual(px(flipped, 0, 1), px([...f.original], 1, 1)); assert.deepEqual(px(flipped, 3, 0), px([...f.original], 3, 0))
    await f.key({ key: 'V', shiftKey: true })
    assert.deepEqual(f.writes.at(-1), { x: 0, y: 0, w: 2, h: 2, grantId: 'grant_2' })
    const beforeMove = await f.pixels('doc_new')
    const { movePixelRect } = await import('../../src/editor-project/pixelSelectionOps.js')
    const source = await f.session.preparePixelEdit({ scopeGrant: false })
    assert.equal(f.calls.includes('grant') && f.grants.length, 2, 'selection edits do not issue the drawing read grant')
    const moved = movePixelRect(source, source.allowedRect, { x: 2, y: 0 })
    await f.session.savePixelStroke(source, moved.bytes, { writeRect: moved.writeRect, selection: moved.rect })
    assert.deepEqual(f.writes.at(-1), { x: 0, y: 0, w: 4, h: 2, grantId: 'grant_3' }, 'move writes source and destination together')
    assert.deepEqual(f.grants.at(-1).rect, { x: 0, y: 0, w: 4, h: 2 })
    const afterMove = await f.pixels('doc_new')
    assert.deepEqual(px(afterMove, 0, 0), [0, 0, 0, 0]); assert.deepEqual(px(afterMove, 2, 1), px(beforeMove, 0, 1))
    assert.deepEqual(f.session.pixelSelection.rect, { x: 2, y: 0, w: 2, h: 2 })
    assert.deepEqual(f.session.history.undo.map(e => e.kind), ['import', 'pixels', 'pixels'])
    await f.key({ key: 'z', metaKey: true })
    assert.deepEqual(await f.pixels('doc_new'), beforeMove)
    assert.deepEqual(f.session.pixelSelection.rect, { x: 0, y: 0, w: 2, h: 2 }, 'undo returns the marquee with the pixels')
    await f.key({ key: 'z', metaKey: true, shiftKey: true })
    assert.deepEqual(await f.pixels('doc_new'), afterMove)
    assert.deepEqual(f.session.pixelSelection.rect, { x: 2, y: 0, w: 2, h: 2 })
    // A later marquee on another canvas survives undo of an edit that had no marquee before.
    f.session.pixelSelection = null
    const plain = await f.session.preparePixelEdit({ scopeGrant: false })
    const pasted = new Uint8Array(plain.rgba); pasted.set([1, 2, 3, 255], 0)
    await f.session.savePixelStroke(plain, pasted, { writeRect: { x: 0, y: 0, w: 1, h: 1 }, selection: { x: 0, y: 0, w: 1, h: 1 } })
    assert.equal(f.session.history.undo.at(-1).selection.before, null)
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 1, y: 1, w: 1, h: 1 } }
    await f.key({ key: 'z', metaKey: true })
    assert.deepEqual(f.session.pixelSelection, { projectId: 'sel_project', canvasId: 'old', rect: { x: 1, y: 1, w: 1, h: 1 } })
  } finally { f.harness.restore() }
})

test('selection shortcuts ignore text fields, need a selection, and Copy writes nothing', async () => {
  const f = await selectionSessionFixture()
  try {
    await f.key({ key: 'Delete' })
    assert.deepEqual(f.calls, [], 'no selection means Delete does nothing')
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 0, y: 0, w: 1, h: 1 } }
    const typing = { tagName: 'TEXTAREA', closest: selector => (selector.includes('textarea') ? {} : null) }
    for (const extra of [{ key: 'Delete' }, { key: 'Backspace' }, { key: 'H', shiftKey: true }, { key: 'c', metaKey: true }]) {
      await f.harness.root.dispatchEvent({ type: 'keydown', target: typing, stopImmediatePropagation() {}, ...extra })
    }
    assert.deepEqual(f.calls, [], 'typing in the composer never edits pixels')
    const otherPanel = { tagName: 'BUTTON', closest: () => null }
    for (const extra of [{ key: 'Delete' }, { key: 'Backspace' }, { key: 'V', shiftKey: true }]) {
      await f.harness.root.dispatchEvent({ type: 'keydown', target: otherPanel, stopImmediatePropagation() {}, ...extra })
    }
    assert.deepEqual(f.calls, [], 'focus in another panel never edits pixels')
    const copied = await f.key({ key: 'c', metaKey: true })
    assert.ok(copied)
    assert.deepEqual(f.calls, [], 'copy reads pixels but never writes or grants')
    assert.equal(f.session.manualGesture, null)
    assert.equal(f.session.history?.undo?.length ?? 0, 0)
  } finally { f.harness.restore() }
})

// Floating paste in the session harness: canvas element needs a 2D context stub for the preview overlay.
async function floatingPasteFixture(options) {
  const f = await selectionSessionFixture(options)
  const images = [], submitted = []
  const make = globalThis.document.createElement
  globalThis.document.createElement = tag => {
    const node = make(tag)
    if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({
      createImageData: (w, h) => { const image = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; images.push(image); return image },
      putImageData(image) { submitted.push(image?.data ? new Uint8ClampedArray(image.data) : null) },
    })
    return node
  }
  const until = async (check, label) => { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 0)) } throw new Error(`timed out: ${label}`) }
  // Copy two pixels from the original, delete them (this derives the working copy), then paste them back in place.
  f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 0, y: 0, w: 2, h: 1 } }
  await f.key({ key: 'c', metaKey: true })
  await f.key({ key: 'Delete' })
  assert.equal(f.session.view.selectedId, 'new')
  await f.key({ key: 'v', metaKey: true })
  await until(() => f.session.manualGesture?.tool === 'paste' && f.session.manualGesture.source, 'paste ready')
  let releaseWrite, writeStarted = false, rejectWith = null
  const realWrite = f.api.writeWorkingPixels, ops = []
  f.api.writeWorkingPixels = async (...args) => {
    writeStarted = true; ops.push(args[2]?.operationId)
    await new Promise(resolve => { releaseWrite = resolve })
    if (rejectWith) throw rejectWith
    return realWrite(...args)
  }
  const stage = f.harness.byId.get('vnext-canvas-stage')
  const tile = () => stage.querySelector('[data-canvas-id="new"]')
  const overlay = () => stage.querySelector('.vnext-pixel-stroke-preview')
  return { ...f, until, stage, tile, overlay, ops, images, submitted, started: () => writeStarted, release: () => releaseWrite?.(), reject: error => { rejectWith = error } }
}

test('stroke preview reuses one ImageData, replaces every pixel, and allocates again after cancel', async () => {
  const f = await floatingPasteFixture()
  try {
    await f.until(() => f.session.manualGesture?.pixels, 'preview allocated')
    const first = f.session.manualGesture.pixels
    const gesture = f.session.manualGesture
    const allocated = f.images.length
    assert.equal(first.width, gesture.source.width)
    assert.equal(first.height, gesture.source.height)
    assert.equal(first.data.length, first.width * first.height * 4)
    first.data.fill(7)
    const host = f.stage.getBoundingClientRect()
    const from = { ...gesture.at }
    const landed = {
      x: Math.max(0, Math.min(gesture.size.width - gesture.block.width, from.x + 2)),
      y: from.y,
    }
    const downAt = f.session.view.worldToScreen(gesture.origin.x + from.x + 0.2, gesture.origin.y + from.y + 0.2, host)
    const moveAt = f.session.view.worldToScreen(gesture.origin.x + landed.x + 0.2, gesture.origin.y + landed.y + 0.2, host)
    const expected = new Uint8Array(f.original)
    for (let x = 0; x < 2; x++) expected.set([0, 0, 0, 0], x * 4)
    for (let x = 0; x < 2; x++) {
      const src = f.original.subarray(x * 4, x * 4 + 4)
      if (src[3] === 0) continue
      expected.set(src, (landed.y * 4 + landed.x + x) * 4)
    }
    assert.equal([...expected].some((value, index) => index % 4 === 3 && value === 0), true)
    await f.stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: downAt.x, clientY: downAt.y, pointerId: 9, stopImmediatePropagation() {} })
    await f.stage.dispatchEvent({ type: 'pointermove', button: 0, clientX: moveAt.x, clientY: moveAt.y, pointerId: 9, stopImmediatePropagation() {} })
    await f.stage.dispatchEvent({ type: 'pointerup', button: 0, clientX: moveAt.x, clientY: moveAt.y, pointerId: 9, stopImmediatePropagation() {} })
    assert.equal(f.session.manualGesture.pixels, first)
    assert.equal(f.images.length, allocated)
    assert.deepEqual([...f.submitted.at(-1)], [...expected])
    await f.key({ key: 'Escape' })
    assert.equal(gesture.pixels, null)
    assert.equal(f.session.manualGesture, null)
    await f.key({ key: 'v', metaKey: true })
    await f.until(() => f.session.manualGesture?.pixels && f.session.manualGesture.pixels !== first, 'new gesture')
    assert.notEqual(f.session.manualGesture.pixels, first)
    assert.equal(f.images.length, allocated + 1)
  } finally { f.harness.restore() }
})

test('floating paste: Enter and Escape from another focused control are left to that control', async () => {
  const f = await floatingPasteFixture()
  try {
    const before = f.writes.length, elsewhere = { tagName: 'BUTTON', closest: () => null }
    for (const key of ['Enter', 'Escape']) {
      const event = { type: 'keydown', key, target: elsewhere, defaultPrevented: false, stopImmediatePropagation() { throw new Error('must not stop another control') } }
      await f.harness.root.dispatchEvent(event)
      assert.equal(event.defaultPrevented, false, `${key} is not consumed`)
    }
    assert.equal(f.session.manualGesture?.tool, 'paste', 'the paste still floats'); assert.equal(f.writes.length, before)
    const barButton = { tagName: 'BUTTON', closest: selector => (selector === '#vnext-canvas-stage' || selector === '.vnext-pixel-selection-bar' ? {} : null) }
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'Enter', target: barButton, stopImmediatePropagation() {} })
    assert.equal(f.session.manualGesture?.tool, 'paste', 'Enter on a bar button is that button’s own activation')
  } finally { f.harness.restore() }
})

async function heldStrokeFixture(tool = 'pencil') {
  let panel, range, size
  const f = await floatingPasteFixture({ beforeBoot({ harness }) {
    panel = document.createElement('div'); panel.className = 'vnext-color'
    size = document.createElement('select'); size.id = 'vnext-brush-size'; size.disabled = false
    range = document.createElement('input'); range.id = 'vnext-brush-range'; range.type = 'range'; range.disabled = false
    panel.append(size); panel.append(range)
    for (const node of [size, range]) {
      node.style.setProperty = function (key, value) { this[key] = value }
      node.style.removeProperty = function (key) { delete this[key] }
      harness.byId.set(node.id, node)
    }
    const query = harness.root.querySelector
    harness.root.querySelector = selector => selector === '.vnext-color' ? panel : query(selector) || panel.querySelector(selector)
  } })
  await f.key({ key: 'Escape' }) // Leave the fixture's floating paste; test a real ordinary gesture.
  f.session.pixelSelection = null
  f.session.view.setTool(tool); f.session.renderCanvas()
  const pointer = (type, x = 2, y = 1) => {
    const o = f.session.view.positionOf(f.session.view.selectedId)
    const p = f.session.view.worldToScreen(o.x + x + .2, o.y + y + .2, f.stage.getBoundingClientRect())
    return f.stage.dispatchEvent({ type, button: 0, clientX: p.x, clientY: p.y, pointerId: 17, target: f.stage, stopImmediatePropagation() {} })
  }
  return { ...f, panel, range, size, pointer }
}

for (const tool of ['pencil', 'eraser', 'line', 'rectangle', 'fill']) {
  test(`ordinary ${tool} holds final clipped pixels and an inert stable sidebar until confirmation`, async () => {
    const f = await heldStrokeFixture(tool)
    try {
      const before = await f.pixels('doc_new'), history = f.session.history.undo.length
      f.session.pixelSelection = { projectId: f.session.project.id, canvasId: 'new', rect: { x: 2, y: 1, w: 2, h: 1 } }
      await f.pointer('pointerdown')
      await f.until(() => f.session.manualGesture?.overlay, 'stroke preview')
      const gesture = f.session.manualGesture
      const saving = f.pointer('pointerup', 3, 1) // No pointermove: release must be part of the held preview.
      await f.until(() => f.started(), 'write started')
      assert.ok(f.overlay()); assert.equal(f.tile().style.visibility, 'hidden')
      assert.equal(f.session.manualGesture, null); assert.ok(f.session.manualWrite)
      assert.equal(f.panel.inert, true); assert.equal(f.panel.getAttribute('aria-busy'), 'true')
      assert.equal(f.size.disabled, false); assert.equal(f.range.disabled, false)
      assert.equal(f.range.inert, true)
      const submitted = [...f.submitted.at(-1)]
      assert.deepEqual(submitted, [...gesture.stroke.bytes], 'held overlay is the final constrained raster')
      assert.deepEqual(submitted.slice(0, 24), before.slice(0, 24), 'outside selection unchanged')
      if (tool !== 'fill') assert.deepEqual(submitted.slice(28, 32), tool === 'eraser' ? [0, 0, 0, 0] : [77, 115, 102, 255])
      await f.pointer('pointerdown', 1, 0)
      assert.equal(f.ops.length, 1, 'write lock prevents another gesture')
      f.release(); await saving
      assert.equal(f.overlay(), null); assert.equal(f.tile().style.visibility, '')
      assert.deepEqual(await f.pixels('doc_new'), submitted)
      assert.equal(f.session.history.undo.length, history + 1)
      assert.equal(Boolean(f.panel.inert), false); assert.equal(f.panel.getAttribute('aria-busy'), null)
    } finally { f.release(); f.harness.restore() }
  })
}

for (const mode of ['rejected', 'unknown', 'refresh-pending', 'cancel', 'noop', 'original']) {
  test(`ordinary stroke keeps existing ${mode} save semantics and cleans its stable sidebar`, async () => {
    const f = await heldStrokeFixture(mode === 'noop' ? 'eraser' : 'pencil')
    try {
      const history = f.session.history.undo.length, before = await f.pixels('doc_new')
      if (mode === 'original') { f.session.view.select('old'); f.session.renderCanvas() }
      if (mode === 'rejected') f.reject(Object.assign(new Error('stale'), { kind: 'stale', code: 'stale_revision' }))
      if (mode === 'unknown') f.reject(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
      if (mode === 'refresh-pending') {
        const real = f.api.getProject; let fail = true
        f.api.getProject = async (...args) => fail ? (fail = false, { ok: false }) : real(...args)
      }
      const x = mode === 'noop' ? 0 : 2, y = mode === 'noop' ? 0 : 1
      await f.pointer('pointerdown', x, y)
      await f.until(() => f.session.manualGesture?.overlay, 'stroke preview')
      if (mode === 'cancel') await f.key({ key: 'Escape' })
      else {
        const saving = f.pointer('pointerup', x, y)
        if (mode !== 'noop') {
          await f.until(() => f.started(), 'write started')
          if (mode === 'original') {
            assert.equal(f.overlay(), null, 'original never holds a saving edit over its unchanged pixels')
            f.session.renderCanvas()
            assert.equal(f.panel.inert, true, 'copy-in-flight refresh keeps the sidebar stable')
            assert.equal(f.size.disabled, false)
          }
          f.release()
        }
        await saving
      }
      if (mode === 'refresh-pending') {
        assert.ok(f.overlay()); assert.ok(f.session.manualWrite); assert.equal(f.panel.inert, true)
        await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
        await f.until(() => !f.session.manualWrite && !f.overlay(), 'confirmed refresh recovered')
      }
      assert.equal(f.overlay(), null); assert.equal(Boolean(f.panel.inert), false)
      if (['rejected', 'unknown', 'cancel', 'noop'].includes(mode)) {
        assert.deepEqual(await f.pixels('doc_new'), before); assert.equal(f.session.history.undo.length, history)
      }
      if (mode === 'unknown') assert.ok(f.session.manualWrite, 'unknown remains locked for existing recovery')
      if (mode === 'original') assert.deepEqual(await f.pixels('doc_old'), [...f.original], 'original preserved')
    } finally { f.release(); f.harness.restore() }
  })
}

test('applied paste stays visible while saving, then shows the confirmed pixels; Escape during the save explains it cannot cancel', async () => {
  const f = await floatingPasteFixture()
  try {
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started')
    assert.ok(f.overlay(), 'candidate overlay kept during the save'); assert.equal(f.tile()?.style.visibility, 'hidden')
    assert.equal(f.session.manualGesture, null, 'gesture lock released'); assert.ok(f.session.manualWrite, 'write lock held')
    await f.key({ key: 'Escape' })
    assert.match(f.harness.byId.get('vnext-canvas-status').textContent, /cannot be cancelled/)
    assert.ok(f.overlay(), 'Escape does not drop the saving candidate')
    f.release()
    await f.until(() => !f.session.manualWrite, 'write finished')
    assert.equal(f.overlay(), null, 'candidate removed after the confirmed result is shown'); assert.equal(f.tile()?.style.visibility, '')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [...f.original.slice(0, 8)], 'paste restored the copied pixels')
    assert.deepEqual(f.session.pixelSelection.rect, { x: 0, y: 0, w: 2, h: 1 })
  } finally { f.harness.restore() }
})

test('a rejected paste save drops the candidate and leaves the confirmed pixels and outline', async () => {
  const f = await floatingPasteFixture()
  try {
    const history = f.session.history.undo.length
    f.reject(Object.assign(new Error('stale'), { kind: 'stale', code: 'stale_revision' }))
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started')
    assert.ok(f.overlay())
    f.release()
    await f.until(() => !f.session.manualWrite && !f.overlay(), 'rejection settled')
    assert.equal(f.tile()?.style.visibility, '')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [0, 0, 0, 0, 0, 0, 0, 0], 'saved pixels unchanged')
    assert.equal(f.session.history.undo.length, history, 'no history for a rejected save')
    assert.match(f.harness.byId.get('vnext-canvas-status').textContent, /not saved/i)
  } finally { f.harness.restore() }
})

test('an unconfirmed paste save drops the candidate, keeps the write lock and opens the existing recovery dialog', async () => {
  const f = await floatingPasteFixture()
  try {
    f.reject(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started')
    f.release()
    await f.until(() => !f.overlay(), 'candidate dropped')
    assert.equal(f.tile()?.style.visibility, '', 'confirmed (old) pixels are shown')
    assert.ok(f.session.manualWrite, 'write lock kept until the user resolves it')
    assert.equal(f.session.activeWrite, f.session.manualWrite, 'unknown writes retain their recovery closure')
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false)
    assert.match(f.harness.byId.get('vnext-confirm-title').textContent, /not confirmed/i)
  } finally { f.harness.restore() }
})

test('a saved paste whose display refresh failed stays visible until Reload canvas shows the confirmed pixels', async () => {
  const f = await floatingPasteFixture()
  try {
    const realGet = f.api.getProject
    let failNext = true
    f.api.getProject = async (...args) => (failNext ? (failNext = false, { ok: false }) : realGet(...args))
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started')
    f.release()
    await f.until(() => f.harness.byId.get('vnext-confirm-dialog').hidden === false, 'refresh recovery opened')
    assert.match(f.harness.byId.get('vnext-confirm-title').textContent, /refresh pending/i)
    assert.ok(f.overlay(), 'the saved candidate stays on screen'); assert.equal(f.tile()?.style.visibility, 'hidden')
    await f.stage.dispatchEvent({ type: 'pointercancel', target: f.stage })
    assert.ok(f.overlay(), 'a stray pointercancel does not drop it')
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await f.until(() => !f.session.manualWrite, 'refresh finished')
    assert.equal(f.overlay(), null); assert.equal(f.tile()?.style.visibility, '')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [...f.original.slice(0, 8)])
  } finally { f.harness.restore() }
})

test('open dialogs keep the keyboard: Enter does not apply a paste and Delete does not edit pixels behind them', async () => {
  // Escape with a dialog is covered in the real browser: this harness runs listeners without capture order.
  const f = await floatingPasteFixture()
  try {
    const dialog = f.harness.byId.get('vnext-open-dialog'), before = f.writes.length
    dialog.hidden = false
    const enter = { type: 'keydown', key: 'Enter', target: { tagName: 'BODY', closest: () => null }, defaultPrevented: false, stopImmediatePropagation() { throw new Error('must not stop the dialog') } }
    await f.harness.root.dispatchEvent(enter)
    assert.equal(enter.defaultPrevented, false); assert.equal(f.session.manualGesture?.tool, 'paste'); assert.equal(f.writes.length, before)
    dialog.hidden = true
    await f.key({ key: 'Escape' })
    assert.equal(f.session.manualGesture, null, 'with the dialog closed, Escape on the canvas cancels the paste')
    dialog.hidden = false
    const del = { type: 'keydown', key: 'Delete', target: { tagName: 'BODY', closest: () => null }, defaultPrevented: false, stopImmediatePropagation() { throw new Error('must not stop the dialog') } }
    await f.harness.root.dispatchEvent(del)
    assert.equal(del.defaultPrevented, false); assert.equal(f.writes.length, before, 'no pixel edit behind a dialog')
  } finally { f.harness.restore() }
})

test('a floating paste survives an open-epoch change (e.g. a cancelled in-flight open): Apply rereads the same canvas and saves once', async () => {
  const f = await floatingPasteFixture()
  try {
    f.api.cancelOpen() // what cancelling an in-flight project open does; it makes earlier pixel snapshots stale
    assert.equal(f.session.manualGesture.source.isSelected(), false)
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started after rereading pixels')
    f.release()
    await f.until(() => !f.session.manualWrite, 'write finished')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [...f.original.slice(0, 8)])
    assert.equal(f.writes.filter(w => w.grantId).length >= 1, true)
  } finally { f.harness.restore() }
})

test('cancelling while Apply rereads stale pixels reports nothing and writes nothing', async () => {
  const f = await floatingPasteFixture()
  try {
    let releaseRead
    const realBlock = f.api.getBlock
    f.api.cancelOpen()
    f.api.getBlock = async (...args) => { await new Promise(r => { releaseRead = r }); return realBlock(...args) }
    await f.key({ key: 'Enter' })
    await f.until(() => typeof releaseRead === 'function', 'reread started')
    await f.key({ key: 'Escape' })
    assert.equal(f.session.manualGesture, null, 'Escape cancels the paste during the reread')
    f.harness.byId.get('vnext-canvas-status').textContent = ''
    releaseRead()
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0))
    assert.equal(f.harness.byId.get('vnext-canvas-status').textContent, '', 'no false "not saved" error after a deliberate cancel')
    assert.equal(f.started(), false, 'nothing was written')
  } finally { f.harness.restore() }
})

// Recovery after closing the Open project picker (no open in flight): the pending save stays current.
async function dismissThenCancelPicker(f) {
  await f.harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' }) // Dismiss
  const epoch = f.api.openEpoch.current
  f.harness.openRoot.hidden = false
  await f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.cancelBtn }) // picker Cancel
  assert.equal(f.harness.openRoot.hidden, true)
  assert.equal(f.api.openEpoch.current, epoch, 'closing the picker without an open in flight keeps the open epoch')
  await f.key({ key: 'z', metaKey: true }) // a blocked edit offers the pending save's recovery
}

test('confirmed save, refresh failure, Dismiss, cancel Open project: recovery still reloads only, without another write', async () => {
  const f = await floatingPasteFixture()
  try {
    const realGet = f.api.getProject
    let failNext = true
    f.api.getProject = async (...args) => (failNext ? (failNext = false, { ok: false }) : realGet(...args))
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started'); f.release()
    await f.until(() => /refresh pending/i.test(f.harness.byId.get('vnext-confirm-title').textContent), 'refresh recovery opened')
    const writes = f.ops.length
    await dismissThenCancelPicker(f)
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false, 'recovery is offered again')
    assert.match(f.harness.byId.get('vnext-confirm-title').textContent, /refresh pending/i)
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Reload canvas
    await f.until(() => !f.session.manualWrite, 'refresh finished')
    assert.equal(f.ops.length, writes, 'reload did not write again')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [...f.original.slice(0, 8)])
    assert.equal(f.overlay(), null); assert.equal(f.tile()?.style.visibility, '')
  } finally { f.harness.restore() }
})

test('unknown save, Dismiss, cancel Open project: Retry resends the same operation once, no duplicate edit', async () => {
  const f = await floatingPasteFixture()
  try {
    const before = f.docs.get('doc_new').revision
    f.reject(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
    await f.key({ key: 'Enter' })
    await f.until(() => f.started(), 'write started'); f.release()
    await f.until(() => /not confirmed/i.test(f.harness.byId.get('vnext-confirm-title').textContent), 'unknown recovery opened')
    f.reject(null)
    await dismissThenCancelPicker(f)
    assert.match(f.harness.byId.get('vnext-confirm-title').textContent, /not confirmed/i, 'recovery is offered again')
    const retry = f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Retry (waits on the gated write)
    await f.until(() => f.ops.length === 2, 'retry sent'); f.release()
    await retry
    await f.until(() => !f.session.manualWrite, 'retry finished')
    assert.equal(f.ops[0], f.ops[1], 'Retry reuses the original operation id')
    assert.equal(f.docs.get('doc_new').revision, before + 1, 'the edit was stored once')
    assert.deepEqual((await f.pixels('doc_new')).slice(0, 8), [...f.original.slice(0, 8)])
  } finally { f.harness.restore() }
})

// While another project is loading, the current canvas is read-only for new pixel edits.
test('an in-flight project open blocks new pixel edits at the shared entry point and the selection shortcuts; cancel restores editing', async () => {
  const f = await selectionSessionFixture()
  try {
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 0, y: 0, w: 2, h: 1 } }
    f.session.pendingOpen = { projectId: 'other', token: f.api.openEpoch.next() } // what openProjectById records
    assert.equal(f.session.openInFlight(), true)
    await assert.rejects(f.session.preparePixelEdit({ scopeGrant: false }), /finish opening/)
    for (const extra of [{ key: 'Delete' }, { key: 'H', shiftKey: true }, { key: 'c', metaKey: true }]) await f.key(extra)
    assert.deepEqual(f.calls, [], 'no grant, derive or pixel write while the open is in flight')
    assert.match(f.harness.byId.get('vnext-canvas-status').textContent, /finish opening/)
    f.api.cancelOpen() // cancelling the open (or it settling) ends the read-only interval
    assert.equal(f.session.openInFlight(), false)
    assert.ok(f.session.pendingOpen, 'the cancelled request has not settled yet')
    await f.key({ key: 'Escape' })
    assert.equal(f.session.pixelSelection, null, 'Escape works again right after the cancel, before the late response')
    f.session.pixelSelection = { projectId: 'sel_project', canvasId: 'old', rect: { x: 0, y: 0, w: 2, h: 1 } }
    await f.key({ key: 'Delete' })
    assert.deepEqual(f.calls, ['derive', 'grant', 'pixels'], 'editing resumes after the open is cancelled')
  } finally { f.harness.restore() }
})

// New project and a v0 upgrade copy switch projects once the server answers; until the destination is
// applied the current canvas is read-only, and closing a dialog does not cancel the submitted request.
async function transitionFixture() {
  const f = await selectionSessionFixture()
  const until = async (check, label) => { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 0)) } throw new Error(`timed out: ${label}`) }
  const gated = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject, calls: [] } }
  const realList = f.api.listDocuments
  f.api.listDocuments = async (projectId, ...rest) => (projectId === 'sel_project' ? realList(projectId, ...rest) : [])
  f.api.changeStructure = async () => { f.calls.push('structure'); throw new Error('no structure edit expected') }
  const created = id => ({ project: { id, name: id, version: 'editor_project_v1', revision: 1, canvases: {} }, receipt: { project_revision: 1 } })
  const status = () => f.harness.byId.get('vnext-canvas-status').textContent
  const toast = () => f.harness.byId.get('vnext-project-toast').textContent
  const select = (y = 1, x = 0) => { f.session.pixelSelection = { projectId: 'sel_project', canvasId: f.session.view.selectedId, rect: { x, y, w: 2, h: 1 } } }
  // Two saved edits first (the copy, then a pixel patch on it), so Undo has pixels to restore during the transition.
  select(0); await f.key({ key: 'Delete' })
  await until(() => !f.session.manualWrite, 'seed copy saved')
  select(0, 2); await f.key({ key: 'Delete' })
  await until(() => !f.session.manualWrite, 'seed patch saved')
  assert.deepEqual(f.calls, ['derive', 'grant', 'pixels', 'grant', 'pixels']); assert.equal(f.session.view.selectedId, 'new')
  f.calls.length = 0
  async function assertReadOnly(label) {
    assert.equal(f.session.openInFlight(), true, `${label}: in flight`)
    await assert.rejects(f.session.preparePixelEdit({ scopeGrant: false }), /finish opening/)
    select()
    for (const extra of [{ key: 'Delete' }, { key: 'H', shiftKey: true }, { key: 'z', metaKey: true }]) await f.key(extra)
    await f.session.changeStructure({ type: 'add-layer', name: 'Layer 2' })
    assert.deepEqual(f.calls, [], `${label}: no grant, pixel write, Undo restore or layer edit`)
    assert.match(status(), /finish opening/)
  }
  function startUpgrade() {
    f.session.list.status = 'ready'
    f.session.list.projects = [{ id: 'legacy', name: 'Legacy', version: 'editor_project_v0', revision: 4 }]
    f.session.list.selectedId = 'legacy'
    f.harness.openRoot.hidden = false
    return f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
      .then(() => { assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Open as an upgraded copy') })
      .then(() => { f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) }) // Open copy (not awaited)
  }
  const closePicker = () => f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.cancelBtn })
  const newProject = () => f.harness.menu.dispatchEvent({ type: 'click', target: f.harness.createBtn })
  return { ...f, until, gated, created, status, toast, select, assertReadOnly, startUpgrade, closePicker, newProject }
}

test('upgrade copy: closing the picker mid-request keeps the canvas read-only and does not cancel; the copy then opens', async () => {
  const f = await transitionFixture()
  try {
    const upgrade = f.gated(), opened = []
    f.api.upgradeCopy = async (id, body) => { upgrade.calls.push([id, body.expectedRevision]); return upgrade.promise }
    const realGet = f.api.getProject
    f.api.getProject = async (id, opts) => { opened.push(id); return id === 'copy_1' ? { ok: true, stale: false, project: f.created('copy_1').project } : realGet(id, opts) }
    const epoch = f.api.openEpoch.current
    await f.startUpgrade()
    await f.until(() => upgrade.calls.length === 1, 'upgrade sent')
    assert.deepEqual(upgrade.calls, [['legacy', 4]])
    await f.closePicker(); await f.key({ key: 'Escape' })
    assert.equal(f.harness.openRoot.hidden, true)
    assert.equal(f.api.openEpoch.current, epoch, 'starting the copy, closing the picker or Escape leave the open epoch alone')
    await f.assertReadOnly('upgrade')
    upgrade.resolve(f.created('copy_1'))
    await f.until(() => f.session.project?.id === 'copy_1', 'copy opened')
    await f.until(() => !f.session.openInFlight(), 'transition ended')
    assert.deepEqual(opened, ['copy_1'])
    assert.equal(f.status(), '', 'the read-only notice clears once the copy is open')
  } finally { f.harness.restore() }
})

test('upgrade copy: a failure keeps the project and restores editing and Undo; a newer New project keeps the late copy from switching', async () => {
  const f = await transitionFixture()
  try {
    let upgrade = f.gated()
    f.api.upgradeCopy = async () => upgrade.promise
    await f.startUpgrade(); await f.closePicker()
    await f.assertReadOnly('failing upgrade')
    upgrade.reject(Object.assign(new Error('stale'), { kind: 'stale', reason: '' }))
    await f.until(() => !f.session.openInFlight(), 'failed upgrade ended')
    assert.equal(f.session.project.id, 'sel_project')
    assert.equal(f.toast(), 'The upgraded copy could not be created. The original project is unchanged.')
    assert.equal(f.status(), '')
    await f.key({ key: 'z', metaKey: true })
    await f.until(() => f.calls.length === 1, 'undo ran')
    assert.match(f.calls[0], /^restore:/, 'Undo works again after the failed upgrade')
    f.select(); await f.key({ key: 'Delete' })
    await f.until(() => f.calls.length === 3, 'delete ran')
    assert.deepEqual(f.calls.slice(1), ['grant', 'pixels'], 'editing resumes after the failed upgrade')

    upgrade = f.gated()
    f.api.createProjectV1 = async () => f.created('proj_new')
    await f.startUpgrade()
    await f.newProject() // the user moves on while the copy is still being created
    assert.equal(f.session.project.id, 'proj_new')
    assert.equal(f.session.openInFlight(), false, 'the superseded upgrade no longer locks the new project')
    upgrade.resolve(f.created('copy_late'))
    await f.until(() => /upgraded copy was created but not opened/.test(f.toast()), 'late copy reported')
    assert.equal(f.session.project.id, 'proj_new', 'the late copy does not switch projects')
  } finally { f.harness.restore() }
})

test('upgrade copy: an unconfirmed result keeps the same operation; Retry is read-only until the copy is applied', async () => {
  const f = await transitionFixture()
  try {
    const upgrade = f.gated(), retried = f.gated()
    f.api.upgradeCopy = async () => upgrade.promise
    f.api.retryUnknown = async () => { retried.calls.push('retry'); return retried.promise }
    await f.startUpgrade(); await f.closePicker()
    upgrade.reject(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
    await f.until(() => f.harness.byId.get('vnext-confirm-title').textContent === 'Server did not confirm', 'unknown dialog')
    assert.equal(f.session.project.id, 'sel_project')
    const retry = f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await f.until(() => retried.calls.length === 1, 'retry sent')
    await f.assertReadOnly('upgrade retry')
    retried.resolve({ body: f.created('copy_retried') }); await retry
    assert.equal(f.session.project.id, 'copy_retried')
    assert.equal(f.session.openInFlight(), false)
  } finally { f.harness.restore() }
})

test('overlapping project changes: the newest upgrade wins, and the earlier answer only reports what was created', async () => {
  const f = await transitionFixture()
  try {
    const answers = []
    f.api.upgradeCopy = async id => { const g = f.gated(); answers.push([id, g]); return g.promise }
    await f.startUpgrade()
    f.session.list.projects = [{ id: 'legacy_2', name: 'Legacy 2', version: 'editor_project_v0', revision: 1 }]
    f.session.list.selectedId = 'legacy_2'
    await f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
    f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // the second Open copy, while the first runs
    await f.until(() => answers.length === 2, 'both upgrades sent')
    answers[0][1].resolve(f.created('copy_first'))
    await f.until(() => /upgraded copy was created but not opened/.test(f.toast()), 'first copy reported')
    assert.equal(f.session.project.id, 'sel_project', 'the earlier copy does not switch projects')
    await f.assertReadOnly('second upgrade still running')
    const realGet = f.api.getProject
    f.api.getProject = async (id, opts) => (id === 'copy_second' ? { ok: true, stale: false, project: f.created('copy_second').project } : realGet(id, opts))
    answers[1][1].resolve(f.created('copy_second'))
    await f.until(() => f.session.project?.id === 'copy_second', 'newest copy opened')

    // An upgrade started while New project runs also supersedes it.
    const create = f.gated()
    f.api.createProjectV1 = async () => create.promise
    const creating = f.newProject()
    await f.startUpgrade()
    await f.until(() => answers.length === 3, 'third upgrade sent')
    create.resolve(f.created('proj_late')); await creating
    assert.equal(f.toast(), 'The new project was created but not opened. Open it from the project list.')
    assert.equal(f.session.project.id, 'copy_second')
    assert.equal(f.session.openInFlight(), true, 'the upgrade that superseded it still holds the lock')
    f.api.getProject = async (id, opts) => (id === 'copy_third' ? { ok: true, stale: false, project: f.created('copy_third').project } : realGet(id, opts))
    answers[2][1].resolve(f.created('copy_third'))
    await f.until(() => f.session.project?.id === 'copy_third' && !f.session.openInFlight(), 'newest copy opened')
  } finally { f.harness.restore() }
})

test('New project: the canvas is read-only until the new project is applied; failure and a lost response recover', async () => {
  const f = await transitionFixture()
  try {
    let create = f.gated(), ops = []
    f.api.createProjectV1 = async (body = {}) => { ops.push(body.operationId); return create.promise }
    const pending = f.newProject()
    await f.until(() => ops.length === 1, 'create sent')
    const epoch = f.api.openEpoch.current
    await f.key({ key: 'Escape' }); await f.closePicker()
    assert.equal(f.api.openEpoch.current, epoch, 'Escape or closing the picker does not cancel the submitted create')
    await f.assertReadOnly('create')
    create.reject(Object.assign(new Error('bad'), { kind: 'known_reject', reason: '' })); await pending
    assert.equal(f.session.openInFlight(), false)
    assert.equal(f.session.project.id, 'sel_project')
    assert.equal(f.toast(), 'This project could not be opened. The current project is unchanged.')
    f.select(); await f.key({ key: 'Delete' })
    await f.until(() => f.calls.length === 2, 'delete ran')
    assert.deepEqual(f.calls, ['grant', 'pixels'], 'editing resumes after the failed create')

    // A lost response: Retry resends the same request and keeps the canvas read-only until it is applied.
    f.calls.length = 0
    create = f.gated()
    const retried = f.gated()
    f.api.retryUnknown = async () => retried.promise
    const second = f.newProject(); create.reject(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true })); await second
    assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    const retry = f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await f.until(() => f.session.openInFlight(), 'retry running')
    await f.assertReadOnly('create retry')
    retried.resolve({ body: f.created('proj_retried') }); await retry
    assert.equal(f.session.project.id, 'proj_retried')
    assert.equal(f.session.openInFlight(), false)
  } finally { f.harness.restore() }
})

// While a project change is in flight nothing new is written: PNG/JPEG import, Save positions and a newly
// finished generated image wait; an already-submitted image save keeps its lock and its recovery.
async function importTransitionFixture() {
  const f = await transitionFixture()
  const ops = { png: [], generated: [], layout: [] }
  let layoutFailure = null
  const withCanvas = (id, doc) => { const project = { ...f.project, revision: f.project.revision + 1, canvases: { ...f.project.canvases, [id]: { id, document_id: doc, x: 0, y: 0 } } }; return project }
  f.api.importPng = async (_p, body) => {
    if (body.expectedRevision !== f.session.project.revision) throw Object.assign(new Error('stale'), { kind: 'stale', code: 'stale_revision', reason: '' })
    ops.png.push(body.operationId); return { project: withCanvas(`png_${ops.png.length}`, `doc_png_${ops.png.length}`), document: { document_id: `doc_png_${ops.png.length}` }, receipt: { operation_id: body.operationId } } }
  f.api.importGeneratedImage = async (_p, jobId, body) => {
    if (body.expectedRevision !== f.session.project.revision) throw Object.assign(new Error('stale'), { kind: 'stale', code: 'stale_revision', reason: '' })
    ops.generated.push([jobId, body.operationId]); return { project: withCanvas('gen_1', 'doc_gen_1'), document: { document_id: 'doc_gen_1' }, receipt: { operation_id: body.operationId } } }
  f.api.saveLayout = async (_p, body) => {
    ops.layout.push(body.operationId)
    if (layoutFailure) { const error = layoutFailure; layoutFailure = null; throw error }
    return { project: { ...f.session.project, revision: f.session.project.revision + 1 }, receipt: { operation_id: body.operationId } }
  }
  const menu = action => f.harness.menu.dispatchEvent({ type: 'click', target: { closest: () => ({ dataset: { projectAction: action } }) } })
  const png = { name: 'local.png', type: 'image/png', size: 4, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }
  const drop = () => f.harness.byId.get('vnext-canvas-stage').dispatchEvent({ type: 'drop', preventDefault() {}, clientX: 10, clientY: 10, dataTransfer: { files: [png] } })
  const finished = (extra = {}) => ({ bytes: new Uint8Array([137, 80, 78, 71]), projectId: 'sel_project', openEpoch: f.api.openEpoch.current, ...extra })
  return { ...f, ops, menu, drop, finished, failLayoutOnce: error => { layoutFailure = error } }
}

test('during a project change, PNG import, drop and Save positions write nothing; their controls pause and come back', async () => {
  const f = await importTransitionFixture()
  try {
    const upgrade = f.gated()
    f.api.upgradeCopy = async () => upgrade.promise
    f.session.view.moveDraft('new', 9, 9) // unsaved positions: Save positions has work to do
    f.session.list.status = 'ready'
    f.session.list.projects = [{ id: 'legacy', name: 'Legacy', version: 'editor_project_v0', revision: 4 }]
    f.session.list.selectedId = 'legacy'
    f.harness.openRoot.hidden = false
    await f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
    assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Leave without saving canvas positions?')
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Leave
    assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Open as an upgraded copy')
    f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Open copy
    await f.until(() => f.session.openInFlight(), 'upgrade running'); await f.closePicker()
    assert.equal(f.session.openInFlight(), true)
    assert.equal(f.harness.byId.get('vnext-import-input').disabled, true, 'import input paused')
    assert.equal(f.harness.save.disabled, true, 'Save positions paused')
    await f.menu('import'); assert.match(f.status(), /finish opening/)
    await f.drop(); assert.match(f.status(), /finish opening/)
    await f.menu('save')
    assert.deepEqual([f.ops.png, f.ops.layout], [[], []], 'nothing was written to the project being left')
    upgrade.reject(Object.assign(new Error('stale'), { kind: 'stale', reason: '' }))
    await f.until(() => !f.session.openInFlight(), 'upgrade failed')
    assert.notEqual(f.toast(), 'Wait for the project to finish opening.', 'the blocked-import notice clears with the change')
    assert.equal(f.harness.byId.get('vnext-import-input').disabled, false)
    assert.equal(f.harness.save.disabled, false)
    await f.menu('save'); await f.until(() => f.ops.layout.length === 1, 'positions saved')
    await f.drop(); await f.until(() => f.ops.png.length === 1, 'drop imports again')
  } finally { f.harness.restore() }
})

test('a generated image or pixel drawing finished during a project change is kept unsubmitted, then added once without a new generation', async () => {
  const f = await importTransitionFixture()
  try {
    const upgrade = f.gated()
    f.api.upgradeCopy = async () => upgrade.promise
    await f.startUpgrade()
    const kept = await f.session.placeStaticImage(f.finished({ sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))
    assert.deepEqual(kept, { deferred: true })
    assert.equal(f.session.pendingImport, false, 'an unsubmitted image takes no import lock')
    assert.equal(f.session.imageSaveRecoverable(), false)
    assert.deepEqual((await f.session.placeStaticImage(f.finished({ bytes: undefined, sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))), { busy: true, waiting: true }, 'Continue still waits')
    assert.deepEqual(f.ops.generated, [])
    upgrade.reject(Object.assign(new Error('stale'), { kind: 'stale', reason: '' }))
    await f.until(() => !f.session.openInFlight(), 'upgrade failed')
    await f.drop(); await f.until(() => f.ops.png.length === 1 && !f.session.pendingImport, 'another write lands first') // revision moves on
    const placed = await f.session.placeStaticImage(f.finished({ bytes: undefined, sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))
    assert.equal(placed.canvasId, 'gen_1')
    assert.equal(f.ops.generated.length, 1, 'the same finished job is imported once')

    const again = f.gated()
    f.api.upgradeCopy = async () => again.promise
    await f.startUpgrade()
    assert.equal(f.session.canPlacePixelDrawing(), false, 'no new pixel drawing request during the change')
    assert.deepEqual(await f.session.placeStaticImage(f.finished({ pixelDrawing: true, name: '32×32 pixel drawing' })), { deferred: true })
    assert.equal(f.session.hasPixelDrawingSave(), true, 'the drawing is kept for Resolve')
    assert.deepEqual(await f.session.resolvePixelDrawingSave(), { busy: true, waiting: true })
    assert.deepEqual(f.ops.png, [f.ops.png[0]], 'only the earlier drop')
    again.reject(Object.assign(new Error('stale'), { kind: 'stale', reason: '' }))
    await f.until(() => !f.session.openInFlight(), 'second upgrade failed')
    const saved = await f.session.resolvePixelDrawingSave()
    assert.ok(saved.canvasId)
    assert.equal(f.ops.png.length, 2, 'the kept drawing is saved once, at the current revision')
  } finally { f.harness.restore() }
})

test('an unsubmitted pixel drawing survives a successful switch, returns to its owner and saves once at the current revision', async () => {
  const f = await importTransitionFixture()
  try {
    const upgrade = f.gated(), realGet = f.api.getProject, requests = []
    f.api.upgradeCopy = async () => upgrade.promise
    f.api.getProject = async (id, opts) => id === 'copy_1' ? { ok: true, project: f.created(id).project } : realGet(id, opts)
    const realImport = f.api.importPng
    f.api.importPng = async (id, request) => { requests.push({ id, ...request }); return realImport(id, request) }
    await f.startUpgrade()
    const input = f.finished({ pixelDrawing: true, name: '32×32 pixel drawing' })
    assert.deepEqual(await f.session.placeStaticImage(input), { deferred: true })
    const oldWrite = f.session.staticImageWrite
    assert.deepEqual(await f.session.resolvePixelDrawingSave(), { busy: true, waiting: true })
    upgrade.resolve(f.created('copy_1'))
    await f.until(() => f.session.project.id === 'copy_1' && !f.session.openInFlight(), 'destination opened')
    assert.equal(f.session.hasPixelDrawingSave(), false, 'never offered on the destination')
    assert.equal(oldWrite.stage, 'abandoned')
    assert.equal(requests.length, 0, 'transition did not write to either project')
    f.session.list.status = 'ready'
    f.session.list.projects = [{ id: 'sel_project', name: 'Original', version: 'editor_project_v1', revision: 1 }]
    f.session.list.selectedId = 'sel_project'; f.harness.openRoot.hidden = false
    await f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
    await f.until(() => f.session.project.id === 'sel_project' && !f.session.openInFlight(), 'original project rebound')
    assert.equal(f.session.hasPixelDrawingSave(), true, 'return offers the retained candidate')
    assert.equal(f.session.canPlacePixelDrawing(), false, 'another drawing cannot overwrite this candidate')
    f.session.project = { ...f.session.project, revision: f.session.project.revision + 2 }
    const revision = f.session.project.revision
    const saved = await f.session.resolvePixelDrawingSave()
    assert.ok(saved.canvasId)
    assert.equal(requests.length, 1); assert.equal(requests[0].id, 'sel_project')
    assert.equal(requests[0].expectedRevision, revision)
    assert.deepEqual(requests[0].bytes, input.bytes)
    assert.notEqual(requests[0].operationId, oldWrite.importRequest.operationId, 'fresh save, not a revived abandoned write')
    assert.equal(oldWrite.stage, 'abandoned')
    assert.equal(f.session.hasPixelDrawingSave(), false)
    assert.deepEqual(await f.session.resolvePixelDrawingSave(), { abandoned: true })
    assert.equal(requests.length, 1)
  } finally { f.harness.restore() }
})

test('a retained pixel drawing hands off to the exact submitted save when its position result is unknown', async () => {
  const f = await importTransitionFixture()
  try {
    const input = f.finished({ pixelDrawing: true })
    f.session.retainPixelDrawing(input)
    f.failLayoutOnce(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
    const first = await f.session.resolvePixelDrawingSave()
    assert.equal(first.positionUnknown, true)
    const write = f.session.staticImageWrite
    assert.equal(f.session.pendingImport, write)
    assert.equal(write.submitted, true)
    assert.ok((await f.session.resolvePixelDrawingSave()).canvasId)
    assert.equal(f.ops.png.length, 1)
    assert.equal(f.ops.layout.length, 2); assert.equal(f.ops.layout[0], f.ops.layout[1])
    assert.equal(f.session.pendingImport, false)
    assert.equal(f.session.hasPixelDrawingSave(), false, 'no duplicate candidate left after submission')
  } finally { f.harness.restore() }
})

for (const [ending, failure] of [['fails', 'unknown'], ['is cancelled', 'unknown'], ['fails', 'known']]) {
  test(`an image save whose position ${failure === 'unknown' ? 'result is unknown (held)' : 'save failed (released)'} still resumes after opening another project ${ending}, with the same operation`, async () => {
    const f = await importTransitionFixture()
    try {
      f.failLayoutOnce(failure === 'unknown' ? Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }) : Object.assign(new Error('rejected'), { kind: 'known_reject', reason: 'rejected' }))
      const first = await f.session.placeStaticImage(f.finished({ sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))
      assert.equal(first.positionFailed, true)
      assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Position was not saved')
      await f.harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' }) // Dismiss
      const write = f.session.staticImageWrite
      assert.equal(f.session.pendingImport === write, failure === 'unknown', 'an unknown result keeps its lock; a known failure is released')
      const open = f.gated(), realGet = f.api.getProject
      f.api.getProject = async (id, opts) => (id === 'other' ? open.promise : realGet(id, opts))
      f.session.list.status = 'ready'
      f.session.list.projects = [{ id: 'other', name: 'Other', version: 'editor_project_v1', revision: 1 }]
      f.session.list.selectedId = 'other'
      f.harness.openRoot.hidden = false
      const opening = f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
      await f.until(() => f.harness.byId.get('vnext-confirm-title').textContent === 'Leave without saving canvas positions?', 'leave prompt')
      await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Leave (pending save or unsaved position)
      await f.until(() => f.session.openInFlight(), 'open in flight')
      assert.equal(f.session.imageSaveCurrentFor('job_1'), false, 'stale while the open is in flight')
      if (ending === 'fails') { open.resolve({ ok: false }); await opening }
      else { f.harness.openRoot.hidden = false; await f.closePicker() } // cancel via the picker; the request has not returned yet
      await f.until(() => !f.session.openInFlight(), 'open ended')
      assert.equal(f.session.project.id, 'sel_project')
      if (failure === 'unknown') assert.equal(f.session.pendingImport, write, 'the unresolved save keeps its lock (nothing was cleared)')
      assert.equal(f.session.imageSaveCurrentFor('job_1'), true, 'the same save is current again')
      const resolved = await f.session.placeStaticImage(f.finished({ bytes: undefined, sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))
      assert.equal(resolved.canvasId, 'gen_1')
      assert.equal(f.session.pendingImport, false, 'Resolve released the lock')
      assert.equal(f.ops.generated.length, 1, 'no second import')
      assert.equal(f.ops.layout.length, 2); assert.equal(f.ops.layout[0], f.ops.layout[1], 'the position retry reuses its operation')
      if (ending !== 'fails') { open.resolve({ aborted: true }); await f.until(() => !f.session.pendingOpen, 'cancelled request settled'); await new Promise(r => setTimeout(r, 0)) }
    } finally { f.harness.restore() }
  })
}

test('a requested AI pixel result that arrives during a project change writes nothing to the project being left', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64, nativeBlank: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const source = await f.session.preparePixelEdit({ scopeGrant: false })
    const rgba = source.rgba.slice(); rgba.set([250, 10, 20, 255])
    const candidate = { source_sha256: await sha256Hex(source.rgba), sha256: await sha256Hex(rgba), drawing_batches: 1 }
    const writesBefore = f.writes.length
    f.session.pendingTransition = { token: null } // another project starts opening
    await assert.rejects(f.session.reviewNativePixelCandidate(source, rgba, candidate), { code: 'assistant_context_changed' })
    assert.equal(f.writes.length, writesBefore, 'nothing is written; the request can be sent again in the open project')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, candidate.source_sha256)
  } finally { restoreCanvas(); f.harness.restore() }
})

test('a confirmed reopen of the same project keeps its discarded image save discarded; a later failed open does not revive it', async () => {
  const f = await importTransitionFixture()
  try {
    f.failLayoutOnce(Object.assign(new Error('offline'), { kind: 'unknown', submittedUnknown: true }))
    await f.session.placeStaticImage(f.finished({ sourceJobId: 'job_1', nativeImageJobId: 'job_1' }))
    await f.harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' }) // Dismiss
    const write = f.session.staticImageWrite
    const openFromList = async id => {
      f.session.list.status = 'ready'
      f.session.list.projects = [{ id, name: id, version: 'editor_project_v1', revision: 1 }]
      f.session.list.selectedId = id
      f.harness.openRoot.hidden = false
      const opening = f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
      await f.until(() => f.harness.byId.get('vnext-confirm-title').textContent === 'Leave without saving canvas positions?', 'leave prompt')
      await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' }) // Leave
      await opening
    }
    await openFromList('sel_project') // reopen in place: confirmed
    await f.until(() => !f.session.openInFlight() && !f.session.pendingOpen, 'reopened')
    assert.equal(write.stage, 'abandoned', 'the reopen discarded the frozen save, as designed')
    assert.equal(f.session.pendingImport, false)
    const realGet = f.api.getProject
    f.api.getProject = async (id, opts) => (id === 'other' ? { ok: false } : realGet(id, opts))
    f.session.list.status = 'ready'
    f.session.list.projects = [{ id: 'other', name: 'Other', version: 'editor_project_v1', revision: 1 }]
    f.session.list.selectedId = 'other'
    f.harness.openRoot.hidden = false
    await f.harness.openRoot.dispatchEvent({ type: 'click', target: f.harness.openConfirm })
    if (f.harness.byId.get('vnext-confirm-title').textContent === 'Leave without saving canvas positions?') await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await f.until(() => !f.session.openInFlight() && !f.session.pendingOpen, 'failed open ended')
    assert.equal(f.session.imageSaveCurrentFor('job_1'), false, 'not revived')
    assert.equal(f.ops.layout.length, 1, 'no position retry was sent')
  } finally { f.harness.restore() }
})

test('a pending import blocks layout save, and a name-only receipt does not reload pixels', async () => {
  assert.equal(concurrentLayoutBlocked({ pendingImport: { kind: 'import' } }), true)
  assert.equal(concurrentLayoutMessage({ pendingImport: true }), 'Import already in progress.')
  assert.equal(projectPixelsUnchanged({ id: 'p', sprite_documents: { d: { working_revision: 2 } } }, { id: 'p', sprite_documents: { d: { working_revision: 2 } } }), true)
  assert.equal(projectPixelsUnchanged({ id: 'p', sprite_documents: { d: { working_revision: 2 } } }, { id: 'p', sprite_documents: { d: { working_revision: 3 } } }), false)
  const harness = createSessionHarness()
  const saves = []
  const project = { id: 'proj_a', revision: 2, canvases: { canvas_a: { id: 'canvas_a', x: 0, y: 0 } } }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      if (String(url).includes('/canvas-layout')) saves.push(url)
      if (String(url).includes('/import-png')) return new Promise(() => {})
      return jsonResponse(200, { project })
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = project
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
    session.view.moveDraft('canvas_a', 4, 2)
    const input = harness.byId.get('vnext-import-input')
    input.files = [{ name: 'hero.png', arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]) }]
    input.dispatchEvent({ type: 'change' })
    await harness.until?.(() => session.pendingImport)
    if (!session.pendingImport) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(Boolean(session.pendingImport), true)
    await harness.menu.dispatchEvent({ type: 'click', target: harness.save })
    assert.equal(saves.length, 0)
    assert.match(harness.byId.get('vnext-canvas-status').textContent, /Import already in progress/)
  } finally { harness.restore() }
})

test('rename reconfirm applies a remote position instead of keeping the stale view', async () => {
  const harness = createSessionHarness()
  let calls = 0
  const client = createVnextProjectClient({ fetchImpl: async () => jsonResponse(500, { error: 'storage_commit_failed' }) })
  client.getProject = async () => ({
    ok: true, stale: false,
    project: { id: 'proj_a', revision: 9, canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 7, y: 8, display_name: 'Gate' },
      canvas_b: { id: 'canvas_b', document_id: 'doc_b', x: 3, y: 1, display_name: 'Moved' },
      canvas_c: { id: 'canvas_c', document_id: 'doc_c', x: 4, y: 5 },
    } },
  })
  client.renameCanvas = async (_projectId, _canvasId, body) => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('stale'), { kind: 'stale' })
    return {
      receipt: { operation_id: body.operationId },
      project: { id: 'proj_a', revision: 10, sprite_documents: { doc_a: { working_revision: 1 }, doc_b: { working_revision: 1 }, doc_c: { working_revision: 1 } }, canvases: {
        canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 7, y: 8, display_name: body.displayName },
        canvas_b: { id: 'canvas_b', document_id: 'doc_b', x: 3, y: 1, display_name: 'Moved' },
        canvas_c: { id: 'canvas_c', document_id: 'doc_c', x: 4, y: 5 },
      } },
    }
  }
  client.listDocuments = async () => { throw new Error('full reload') }
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 2, sprite_documents: { doc_a: { working_revision: 1 }, doc_b: { working_revision: 1 }, doc_c: { working_revision: 1 } }, canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
      canvas_b: { id: 'canvas_b', document_id: 'doc_b', x: 1, y: 1, display_name: 'Other' },
      canvas_c: { id: 'canvas_c', document_id: 'doc_c', x: 2, y: 2, display_name: 'Custom' },
    } }
    session.documents.set('doc_c', { document_id: 'doc_c', name: 'Sprite' })
    session.view.setCanvases([
      { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0, width: 8, height: 8, name: 'Gate', display_name: '' },
      { id: 'canvas_b', document_id: 'doc_b', x: 1, y: 1, width: 8, height: 8, name: 'Other', display_name: 'Other' },
      { id: 'canvas_c', document_id: 'doc_c', x: 2, y: 2, width: 8, height: 8, name: 'Custom', display_name: 'Custom', manifest_name: 'Sprite' },
    ])
    session.renderCanvas()
    const label = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    await label.dispatchEvent({ type: 'dblclick' })
    const input = harness.byId.get('vnext-canvas-stage').querySelector('[data-canvas-name="canvas_a"]')
    input.value = 'North gate'
    input.dispatchEvent({ type: 'input' })
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.nameEdit.expectedRevision, 9)
    await input.dispatchEvent({ type: 'keydown', key: 'Enter' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 10)
    assert.deepEqual(session.view.positionOf('canvas_a'), { x: 7, y: 8 })
    assert.deepEqual(session.view.positionOf('canvas_b'), { x: 3, y: 1 })
    assert.equal(session.view.canvases.find((item) => item.id === 'canvas_b').name, 'Moved')
    const reset = session.view.canvases.find((item) => item.id === 'canvas_c')
    assert.equal(reset.name, 'Sprite')
    assert.equal(reset.display_name, '')
    assert.deepEqual(session.view.positionOf('canvas_c'), { x: 4, y: 5 })
    assert.equal(session.layoutBaseRevision, 10)
  } finally { harness.restore() }
})

test('a dismissed import retry does not overwrite a reopened project', async () => {
  const harness = createSessionHarness()
  let releaseRetry
  const retryGate = new Promise((resolve) => { releaseRetry = resolve })
  let posts = 0
  const project = { id: 'proj_a', revision: 4, version: 'editor_project_v1', canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 1, y: 1 } } }
  const reopened = { ...project, revision: 8, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 9, y: 9 } } }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        posts += 1
        if (posts === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        await retryGate
        return jsonResponse(201, { project: { ...project, revision: 5 }, document: { document_id: 'doc_new' }, receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' } })
      }
      if (path.endsWith('/proj_a')) return jsonResponse(200, { project: reopened })
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(path)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = project
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', x: 1, y: 1, width: 8, height: 8 }])
    const stage = harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
    await stage.dispatchEvent({ type: 'drop', clientX: 12, clientY: 12, dataTransfer: { files: [pngFile('hero.png')] } })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    const retry = harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
    session.list.status = 'ready'
    session.list.projects = [{ id: 'proj_a', name: 'A', version: 'editor_project_v1', revision: 8 }]
    session.list.selectedId = 'proj_a'
    harness.openRoot.hidden = false
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    if (harness.byId.get('vnext-confirm-title').textContent === 'Leave without saving canvas positions?') {
      await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    }
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 8)
    releaseRetry()
    await retry
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts, 2)
    assert.equal(session.project.revision, 8)
    assert.equal(session.project.canvases.doc_new, undefined)
  } finally { harness.restore() }
})

test('a retried import stays locked, leaves another dialog open, and does not overwrite a reopened project', async () => {
  const harness = createSessionHarness()
  let releaseRetry
  const retryGate = new Promise((resolve) => { releaseRetry = resolve })
  let posts = 0
  const project = { id: 'proj_a', revision: 4, version: 'editor_project_v1', canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 1, y: 1 } } }
  const reopened = { ...project, revision: 8, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 9, y: 9 } } }
  const client = createVnextProjectClient({
    fetchImpl: async (url) => {
      const path = String(url)
      if (path.includes('/import-png')) {
        posts += 1
        if (posts === 1) return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
        await retryGate
        return jsonResponse(201, { project: { ...project, revision: 5 }, document: { document_id: 'doc_new' }, receipt: { operation_id: '22222222-2222-4222-8222-222222222222', document_id: 'doc_new' } })
      }
      if (path.endsWith('/proj_a')) return jsonResponse(200, { project: reopened })
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(path)
    },
  })
  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = project
    session.boundProjectId = 'proj_a'
    session.view.setCanvases([{ id: 'canvas_a', x: 1, y: 1, width: 8, height: 8 }])
    const stage = harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
    await stage.dispatchEvent({ type: 'drop', clientX: 12, clientY: 12, dataTransfer: { files: [pngFile('hero.png')] } })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    const retry = harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(session.pendingImport?.retrying, true)
    assert.equal(session.pendingImport?.dismissed, undefined)
    session.list.status = 'ready'
    session.list.projects = [{ id: 'proj_a', name: 'A', version: 'editor_project_v1', revision: 8 }]
    session.list.selectedId = 'proj_a'
    harness.openRoot.hidden = false
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Leave without saving canvas positions?')
    assert.equal(harness.byId.get('vnext-confirm-dialog').hidden, false)
    assert.notEqual(session.confirm?.owner, session.pendingImport)
    const leaveOwner = session.confirm?.owner ?? null
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.project.revision, 8)
    assert.equal(session.loadGeneration > 0, true)
    await harness.openRoot.dispatchEvent({ type: 'click', target: harness.openConfirm })
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Leave without saving canvas positions?')
    assert.notEqual(session.confirm?.owner, session.pendingImport)
    releaseRetry()
    await retry
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts, 2)
    assert.equal(session.project.revision, 8)
    assert.equal(session.project.canvases.doc_new, undefined)
    assert.equal(harness.byId.get('vnext-confirm-dialog').hidden, false)
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Leave without saving canvas positions?')
    assert.equal(session.confirm?.owner ?? null, leaveOwner)
    assert.notEqual(session.confirm?.owner, session.activeWrite)
    assert.equal(session.pendingImport, false)
  } finally { harness.restore() }
})

test('dragging updates the checkerboard and every canvas grid, not only the selected frame', async () => {
  const harness = createSessionHarness()
  try {
    const session = bindVnextProjectSession(harness.root, { client: createVnextProjectClient({ fetchImpl: async () => jsonResponse(200, {}) }) })
    session.project = { id: 'proj_a', revision: 1, canvases: {} }
    session.view.setCanvases([
      { id: 'canvas_a', x: 0, y: 0, width: 8, height: 8, name: 'A' },
      { id: 'canvas_b', x: 20, y: 0, width: 8, height: 8, name: 'B' },
    ])
    session.view.zoomTo(4, 4, 4, { left: 0, top: 0 })
    session.pixelGrid = true
    const stage = harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    session.renderCanvas()
    const backdrop = () => stage.querySelector('[data-canvas-backdrop="canvas_a"]')
    const grids = () => stage.querySelectorAll('[data-canvas-grid]')
    assert.equal(backdrop().style.transform, 'translate(0px, 0px)')
    assert.equal(grids().length, 2)
    await stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 4, clientY: 4, pointerId: 1 })
    const started = performance.now()
    for (let i = 1; i <= 40; i += 1) {
      await stage.dispatchEvent({ type: 'pointermove', button: 0, clientX: 4 + i, clientY: 4, pointerId: 1 })
    }
    const fastMs = performance.now() - started
    assert.equal(backdrop().style.transform, 'translate(10px, 0px)')
    assert.equal(grids().length, 2)
    assert.notEqual(grids()[0].style.left, grids()[1].style.left)
    const fullStarted = performance.now()
    for (let i = 0; i < 40; i += 1) session.renderCanvas()
    const fullMs = performance.now() - fullStarted
    console.log(JSON.stringify({ motionUpdatesMs: Number(fastMs.toFixed(2)), fullRedrawsMs: Number(fullMs.toFixed(2)) }))
    await stage.dispatchEvent({ type: 'pointerup', button: 0, pointerId: 1 })
    assert.equal(session.view.positionOf('canvas_a').x, 10)
  } finally { harness.restore() }
})

test('checkerboard size and pixel grid are independent display settings', async () => {
  const harness = createSessionHarness()
  try {
    const session = bindVnextProjectSession(harness.root, { client: createVnextProjectClient({ fetchImpl: async () => jsonResponse(200, {}) }) })
    session.project = { id: 'proj_a', revision: 4, canvases: {} }
    session.view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 16, height: 16, name: 'A' }])
    const stage = harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    session.renderCanvas()
    const checker = () => stage.style.getPropertyValue?.('--vnext-checker-square') || stage.style['--vnext-checker-square']
    assert.equal(checker(), '8')
    assert.equal(harness.byId.get('vnext-checker-note').textContent, 'Shows transparent areas only. Each square covers 8 × 8 image pixels. This does not change the artwork or exports.')
    assert.equal(stage.querySelector('[data-canvas-grid="canvas_a"]'), null)
    assert.equal(harness.byId.get('vnext-grid-pending').hidden, false)
    const history = session.history?.undo?.length || 0
    const sizes = harness.byId.get('vnext-checker-sizes')
    await sizes.dispatchEvent({ type: 'click', target: sizes.querySelector('[data-checker-size="1"]') })
    assert.equal(checker(), '1')
    assert.match(harness.byId.get('vnext-checker-note').textContent, /1 × 1 image pixels/)
    await sizes.dispatchEvent({ type: 'click', target: sizes.querySelector('[data-checker-size="32"]') })
    assert.equal(checker(), '32')
    session.view.zoomTo(4, 8, 8, { left: 0, top: 0 })
    session.renderCanvas()
    const grid = stage.querySelector('[data-canvas-grid="canvas_a"]')
    assert.equal(grid.style.backgroundSize, '4px 4px')
    assert.equal(harness.byId.get('vnext-grid-pending').hidden, true)
    await harness.byId.get('vnext-pixel-grid-switch').dispatchEvent({ type: 'click' })
    assert.equal(stage.querySelector('[data-canvas-grid="canvas_a"]'), null)
    assert.equal(checker(), '32')
    assert.equal(session.project.revision, 4)
    assert.equal(session.history?.undo?.length || 0, history)
    await session.reloadProject({ id: 'proj_b', revision: 1, canvases: {} })
    assert.equal(session.checkerSquare, 32)
    assert.equal(session.pixelGrid, false)
    assert.equal(checker(), '32')
    session.view.zoomTo(1, 8, 8, { left: 0, top: 0 })
    const zoomBefore = session.view.zoom
    const sizeButton = sizes.querySelector('[data-checker-size="32"]')
    await harness.root.dispatchEvent({ type: 'keydown', key: '1', target: sizeButton })
    assert.equal(session.view.zoom, zoomBefore)
  } finally { harness.restore() }
})

test('closing view settings does not cancel a floating paste', async () => {
  const f = await floatingPasteFixture()
  try {
    f.harness.byId.get('vnext-view-settings').hidden = false
    const sizeButton = f.harness.byId.get('vnext-checker-sizes').querySelector('[data-checker-size="8"]')
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', target: sizeButton, stopImmediatePropagation() {} })
    assert.equal(f.harness.byId.get('vnext-view-settings').hidden, true)
    assert.equal(f.session.manualGesture?.tool, 'paste')
    assert.equal(f.session.manualGesture.cancelled, false)
  } finally { f.harness.restore() }
})

test('boot order keeps Space and Enter on view settings and restores focus without cancelling paste', async () => {
  const harness = createSessionHarness()
  try {
    globalThis.window.location = { search: '', hash: '' }
    globalThis.document.querySelector = (selector) => harness.root.querySelector(selector)
    bootVnextPreview(harness.root)
    const session = globalThis.window.getVnextProjectSession()
    const panel = harness.byId.get('vnext-view-settings')
    const opener = harness.byId.get('vnext-view-settings-btn')
    const prompt = harness.byId.get('vnext-prompt-input')
    let focused = 0
    opener.focus = () => { focused += 1 }
    prompt.value = 'keep this draft'
    panel.hidden = false
    const sets = []
    const setSpaceDown = session.view.setSpaceDown.bind(session.view)
    session.view.setSpaceDown = (value) => { sets.push(value); return setSpaceDown(value) }
    const zoom = session.view.zoom
    const controls = [
      harness.byId.get('vnext-checker-sizes').querySelector('[data-checker-size="8"]'),
      harness.byId.get('vnext-pixel-grid-switch'),
      opener,
      harness.byId.get('vnext-grid'),
    ]
    for (const target of controls) {
      const space = { type: 'keydown', code: 'Space', key: ' ', repeat: false, target }
      const enter = { type: 'keydown', key: 'Enter', code: 'Enter', target }
      await harness.root.dispatchEvent(space)
      await harness.root.dispatchEvent({ type: 'keyup', code: 'Space', key: ' ', target })
      await harness.root.dispatchEvent(enter)
      assert.notEqual(space.defaultPrevented, true, target.id || target.dataset.checkerSize)
      assert.notEqual(enter.defaultPrevented, true, target.id || target.dataset.checkerSize)
    }
    assert.deepEqual(sets, [])
    assert.equal(session.view.spaceDown, false)
    assert.equal(session.view.zoom, zoom)
    assert.equal(prompt.value, 'keep this draft')
    await harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: opener, stopImmediatePropagation() {} })
    assert.equal(panel.hidden, true)
    assert.equal(focused, 1)
    assert.equal(opener.getAttribute('aria-expanded'), 'false')
    assert.equal(prompt.value, 'keep this draft')
  } finally { harness.restore() }
})

test('boot order leaves Space to native controls and editable descendants', async () => {
  const harness = createSessionHarness()
  try {
    globalThis.window.location = { search: '', hash: '' }
    globalThis.document.querySelector = (selector) => harness.root.querySelector(selector)
    bootVnextPreview(harness.root)
    const session = globalThis.window.getVnextProjectSession()
    const make = (tag, id) => {
      const node = globalThis.document.createElement(tag)
      node.id = id
      return node
    }
    const model = make('select', 'vnext-assistant-model')
    const font = make('select', 'vnext-text-font')
    const system = make('button', 'system-fonts')
    const label = make('span', 'button-label')
    const icon = make('svg', 'button-icon')
    system.append(label)
    system.append(icon)
    const editable = make('div', 'editable')
    editable.setAttribute('contenteditable', 'plaintext-only')
    const text = make('span', 'editable-child')
    editable.append(text)
    const targets = [model, font, system, label, icon, make('input', 'input'), make('textarea', 'textarea'), editable, text]
    for (const target of targets) {
      const event = { type: 'keydown', code: 'Space', key: ' ', repeat: false, target }
      await harness.root.dispatchEvent(event)
      assert.notEqual(event.defaultPrevented, true, target.id)
      assert.equal(session.view.spaceDown, false, target.id)
      await harness.root.dispatchEvent({ type: 'keyup', code: 'Space', key: ' ', target })
    }
  } finally { harness.restore() }
})

test('boot order releases canvas Space after focus moves to native controls', async () => {
  const f = await selectionSessionFixture({ boot: true })
  try {
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    const select = globalThis.document.createElement('select')
    const button = globalThis.document.createElement('button')
    const child = globalThis.document.createElement('span')
    button.append(child)
    for (const target of [select, button, child]) {
      const down = { type: 'keydown', code: 'Space', key: ' ', repeat: false, target: stage }
      await f.harness.root.dispatchEvent(down)
      assert.equal(down.defaultPrevented, true)
      assert.equal(f.session.view.spaceDown, true)
      await f.harness.root.dispatchEvent({ type: 'keyup', code: 'Space', key: ' ', target })
      assert.equal(f.session.view.spaceDown, false)
    }
    f.session.view.setTool('pencil')
    const origin = f.session.view.positionOf('old')
    const at = f.session.view.worldToScreen(origin.x + 1, origin.y + 1, stage.getBoundingClientRect())
    await stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: at.x, clientY: at.y, pointerId: 3, target: stage, stopImmediatePropagation() {} })
    assert.equal(f.session.manualGesture?.tool, 'pencil')
    assert.equal(stage.classList.contains('is-active'), false)
  } finally { f.harness.restore() }
})

test('boot order clears a held Space pan when focus has moved into view settings', async () => {
  const f = await selectionSessionFixture({ boot: true })
  try {
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    f.session.view.setTool('pencil')
    const host = stage.getBoundingClientRect()
    const origin = f.session.view.positionOf('old')
    const at = f.session.view.worldToScreen(origin.x + 1, origin.y + 1, host)
    await f.harness.root.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ', repeat: false, target: stage })
    assert.equal(f.session.view.spaceDown, true)
    f.harness.byId.get('vnext-view-settings').hidden = false
    const sizeButton = f.harness.byId.get('vnext-checker-sizes').querySelector('[data-checker-size="8"]')
    await f.harness.root.dispatchEvent({ type: 'keyup', code: 'Space', key: ' ', target: sizeButton })
    assert.equal(f.session.view.spaceDown, false)
    await stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: at.x, clientY: at.y, pointerId: 3, target: stage, stopImmediatePropagation() {} })
    assert.equal(f.session.manualGesture?.tool, 'pencil')
    assert.equal(stage.classList.contains('is-active'), false)
  } finally { f.harness.restore() }
})

test('Escape from view settings keeps a placed canvas text draft', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64 })
  const make = globalThis.document.createElement
  const mask = new Uint8ClampedArray(64 * 64 * 4)
  mask[7] = 255
  const metrics = { width: 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 2 }
  globalThis.document.createElement = (tag) => {
    const node = make(tag)
    node.focus = () => {}
    if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({
      measureText: () => metrics,
      fillText() {},
      strokeText() {},
      getImageData: () => ({ data: mask }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
    })
    return node
  }
  try {
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    f.session.view.setTool('text')
    const host = stage.getBoundingClientRect()
    const origin = f.session.view.positionOf('old')
    const at = f.session.view.worldToScreen(origin.x, origin.y, host)
    await stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: at.x, clientY: at.y, pointerId: 4, target: stage, stopImmediatePropagation() {} })
    const draft = f.session.manualGesture
    assert.equal(draft?.tool, 'text')
    await draft.ready
    assert.equal(draft.source?.width, 64)
    assert.equal(draft.source.rgba.length, 64 * 64 * 4)
    assert.equal(draft.invalid || '', '')
    const input = stage.querySelector('.vnext-pixel-text-input')
    input.value = 'Hi'
    await input.dispatchEvent({ type: 'input' })
    assert.equal(draft.invalid || '', '')
    assert.equal(draft.stroke.changed, true)
    assert.ok(draft.stroke.bytes.some((value, index) => value !== draft.source.rgba[index]))
    const before = { text: draft.props.text, x: draft.props.x, y: draft.props.y }
    const writes = f.calls.length
    const history = f.session.history?.undo?.length || 0
    f.harness.byId.get('vnext-view-settings').hidden = false
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: input, stopImmediatePropagation() {} })
    assert.equal(f.harness.byId.get('vnext-view-settings').hidden, true)
    assert.equal(f.session.manualGesture, draft)
    assert.equal(draft.cancelled, false)
    assert.equal(draft.submitting || false, false)
    assert.deepEqual({ text: draft.props.text, x: draft.props.x, y: draft.props.y }, before)
    assert.equal(input.value, 'Hi')
    assert.equal(f.calls.length, writes)
    assert.equal(f.session.history?.undo?.length || 0, history)
  } finally { f.harness.restore() }
})

async function savedTextPreviewFixture(layerMode = 'single') {
  const priorImageData = globalThis.ImageData
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64, beforeBoot({ docs }) {
    globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
    const make = document.createElement
    document.createElement = tag => {
      const node = make(tag)
      node.focus = () => {}
      if (String(tag).toLowerCase() === 'canvas') {
        const marks = []
        node.getContext = () => ({
          measureText: () => ({ width: 1, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 1, actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 0 }),
          fillText(_text, x, y) { marks.push([Math.floor(x), Math.floor(y) - 16]) },
          strokeText() {}, strokeRect() {}, clearRect() {}, drawImage() {},
          getImageData() {
            const data = new Uint8ClampedArray(node.width * node.height * 4)
            for (const [x, y] of marks) if (x >= 0 && y >= 0 && x < node.width && y < node.height) data[(y * node.width + x) * 4 + 3] = 255
            return { data }
          },
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
          putImageData(image) { node.submitted = new Uint8Array(image.data) },
        })
      }
      return node
    }
    const doc = docs.get('doc_old')
    doc.frames.f.id = 'f'; Object.assign(doc.layers.l, { id: 'l', kind: 'raster', visible: true }); doc.cels.c.id = 'c'
    doc.derived_from = { document_id: 'source', revision: 1 }
    const text = (id, x, color, layer_id = 'l') => ({ id, frame_id: 'f', layer_id, text: id, x, y: 4, size: 16,
      font: { kind: 'generic', name: 'sans-serif' }, color, bold: false, italic: false, antialias: false, mode: 'fill', stroke_width: 1 })
    doc.text_objects = { version: 1, items: [text('text_a', 4, '#fa0000ff'), text('text_b', 8, '#00fa00ff')] }
    if (layerMode !== 'single') {
      doc.layer_order.unshift('upper')
      doc.layers.upper = { id: 'upper', name: 'Upper', kind: 'raster', visible: layerMode !== 'hidden', locked: false }
      doc.cels.upper = { id: 'upper', frame_id: 'f', layer_id: 'upper', block: null }
      doc.text_objects.items.push(text('text_upper', 4, '#0000faff', 'upper'))
    }
  } })
  const restore = f.harness.restore
  f.harness.restore = () => { globalThis.ImageData = priorImageData; restore() }
  return f
}

for (const layerMode of ['single', 'upper', 'hidden']) {
  test(`live edit preview preserves saved text with ${layerMode} layers without baking it into pixels`, async () => {
    const f = await savedTextPreviewFixture(layerMode)
    try {
      f.session.documentTimeline = { render() { return false }, stop() {}, target: () => ({ frame_id: 'f', layer_id: 'l', cel_id: 'c' }) }
      const plain = await f.session.preparePixelEdit({ scopeGrant: false })
      if (layerMode === 'single') assert.equal(plain.previewPixels, undefined, 'nonmanual callers keep their existing source contract')
      else assert.deepEqual(plain.previewPixels(plain.rgba), plain.rgba, 'nonmanual multilayer callers retain raster-only composition')
      const source = await f.session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true })
      const raster = source.rgba.slice(), manifest = f.docs.get('doc_old')
      const serialized = JSON.stringify(manifest)
      const px = (bytes, x, y = 4) => [...bytes.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
      const preview = source.previewPixels ? source.previewPixels(raster) : raster
      assert.deepEqual(px(preview, 4), layerMode === 'upper' ? [0, 0, 250, 255] : [250, 0, 0, 255])
      assert.deepEqual(px(preview, 8), [0, 250, 0, 255])
      const moved = { ...manifest.text_objects.items[0], x: 12 }
      const edited = source.previewPixels(raster, { textObject: moved })
      assert.deepEqual(px(edited, 4), layerMode === 'upper' ? [0, 0, 250, 255] : px(raster, 4), 'the old position is not drawn twice')
      assert.deepEqual(px(edited, 8), [0, 250, 0, 255], 'another saved object survives editing')
      assert.deepEqual(px(edited, 12), [250, 0, 0, 255])
      const overlap = { ...moved, id: 'text_new', x: 8, color: '#fafafaff' }
      assert.deepEqual(px(source.previewPixels(raster, { textObject: overlap }), 8), [250, 250, 250, 255], 'new text is appended in saved object order')
      assert.deepEqual(source.rgba, raster, 'preview never bakes text into the save buffer')
      assert.equal(JSON.stringify(manifest), serialized, 'preview never mutates saved objects')
      assert.equal(f.calls.length, 0)
    } finally { f.harness.restore() }
  })
}

test('held line, rectangle and new text previews keep saved text before release or Done', async () => {
  const f = await savedTextPreviewFixture()
  try {
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    f.session.documentTimeline = { render() { return false }, stop() {}, target: () => ({ frame_id: 'f', layer_id: 'l', cel_id: 'c' }) }
    const pointer = (type, x, y) => {
      const o = f.session.view.positionOf('old'), p = f.session.view.worldToScreen(o.x + x, o.y + y, stage.getBoundingClientRect())
      return stage.dispatchEvent({ type, button: 0, clientX: p.x, clientY: p.y, pointerId: 9, target: stage, stopImmediatePropagation() {}, stopPropagation() {} })
    }
    const until = async check => { for (let i = 0; i < 40 && !check(); i++) await new Promise(r => setTimeout(r, 0)); assert.ok(check()) }
    for (const tool of ['line', 'rectangle', 'pencil', 'eraser', 'text']) {
      f.session.view.setTool(tool)
      await pointer('pointerdown', 24, 24)
      await until(() => f.session.manualGesture?.source && f.session.manualGesture?.pixels)
      const gesture = f.session.manualGesture
      if (tool === 'text') {
        const input = stage.querySelector('.vnext-pixel-text-input'); input.value = 'New'
        await input.dispatchEvent({ type: 'input' })
      } else await pointer('pointermove', 28, 28)
      const submitted = gesture.overlay.submitted
      for (const [x, expected] of [[4, [250, 0, 0, 255]], [8, [0, 250, 0, 255]]]) {
        assert.deepEqual([...submitted.slice((4 * 64 + x) * 4, (4 * 64 + x) * 4 + 4)], expected, tool)
      }
      if (tool === 'text') {
        // Escape places nonempty text; an empty draft is discarded without a write.
        const input = stage.querySelector('.vnext-pixel-text-input'); input.value = ''
        await input.dispatchEvent({ type: 'input' })
      }
      await f.key({ key: 'Escape' })
      assert.equal(f.session.manualGesture === null, true, 'preview is cleared')
      assert.equal(gesture.pixels === null, true, 'the preview buffer is released')
    }
    assert.equal(f.calls.length, 0, 'cancelled previews never save')
    assert.equal(f.docs.get('doc_old').text_objects.items.length, 2)
  } finally { f.harness.restore() }
})

async function savedTextMoveFixture(mode) {
  let release, failure = null, writes = 0, panel, priorImageData = globalThis.ImageData
  const priorQueryFonts = globalThis.queryLocalFonts
  let releaseFonts
  const fontGate = new Promise(resolve => { releaseFonts = () => resolve([{ postscriptName: 'ArialMT', fullName: 'Arial' }]) })
  if (mode === 'font-finish') globalThis.queryLocalFonts = () => fontGate
  const gate = new Promise(resolve => { release = resolve })
  const item = { id: 'text_a', frame_id: 'f', layer_id: 'l', text: 'Hi', x: 4, y: 4,
    size: 16, font: { kind: 'generic', name: 'sans-serif' }, color: '#4d7366ff',
    bold: false, italic: false, antialias: false, mode: 'fill', stroke_width: 1 }
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64, beforeBoot({ harness, api, docs, commit }) {
    const make = globalThis.document.createElement
    globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
    globalThis.document.createElement = tag => {
      const node = make(tag)
      node.focus = () => {}
      Object.defineProperty(node, 'parentElement', { get: () => node.parentNode })
      node.style.setProperty = (key, value) => { node.style[key] = value }
      node.style.removeProperty = key => { delete node.style[key] }
      if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({
        measureText: () => ({ width: 12, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 12, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 2 }),
        fillText() {}, strokeText() {}, strokeRect() {}, clearRect() {}, drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData(value) { node.pixels = value.data },
      })
      return node
    }
    panel = document.createElement('div'); panel.className = 'vnext-color'
    for (const suffix of ['props', 'x', 'y', 'help', 'content', 'font', 'size', 'size-range', 'stroke', 'stroke-range', 'error']) {
      const id = 'vnext-text-' + suffix
      const node = document.createElement(suffix === 'font' ? 'select' : ['props', 'help', 'error'].includes(suffix) ? 'div' : 'input')
      if (suffix.endsWith('-range')) node.type = 'range'
      if (suffix === 'font') Object.defineProperty(node, 'options', { get: () => node.children })
      node.id = id; harness.byId.set(id, node); panel.append(node)
    }
    for (const action of ['done', 'discard']) { const node = document.createElement('button'); node.dataset.textAction = action; panel.append(node) }
    const systemFonts = document.createElement('button'); systemFonts.dataset.textFont = 'system'; panel.append(systemFonts)
    const query = harness.root.querySelector
    harness.root.querySelector = selector => selector === '.vnext-color' ? panel : query(selector) || panel.querySelector(selector)
    const doc = docs.get('doc_old')
    doc.frames.f.id = 'f'; Object.assign(doc.layers.l, { id: 'l', kind: 'raster', visible: true }); doc.cels.c.id = 'c'
    doc.derived_from = { document_id: 'source', revision: 1 }; doc.text_objects = { version: 1, items: [item] }
    api.changeStructure = async (pid, did, body) => {
      writes++
      await gate
      if (failure) throw failure
      if (mode === 'unknown') throw Object.assign(new Error('offline'), { kind: 'unknown' })
      const { type, ...next } = body.command
      const { project, document } = commit(did, { ...docs.get(did), revision: docs.get(did).revision + 1, text_objects: { version: 1, items: [next] } })
      return { project, document, receipt: { operation_id: body.operationId, project_id: pid, project_revision: project.revision, document_id: did, document_revision: document.revision } }
    }
  } })
  const stage = f.harness.byId.get('vnext-canvas-stage')
  f.session.documentTimeline = { render() { return false }, stop() {}, target: () => ({ frame_id: 'f', layer_id: 'l', cel_id: 'c' }) }
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
  f.session.view.setTool('text')
  const at = (x, y) => { const o = f.session.view.positionOf('old'); return f.session.view.worldToScreen(o.x + x, o.y + y, stage.getBoundingClientRect()) }
  const pointer = (type, x, y) => { const p = at(x, y); return stage.dispatchEvent({ type, button: 0, clientX: p.x, clientY: p.y, pointerId: 9, target: stage, stopImmediatePropagation() {}, stopPropagation() {} }) }
  const until = async check => { for (let i = 0; i < 40 && !check(); i++) await new Promise(r => setTimeout(r, 0)); assert.ok(check()) }
  return { ...f, panel, pointer, until, release, releaseFonts, writes: () => writes,
    reject() { failure = Object.assign(new Error('stale'), { kind: 'stale' }) },
    restore() { globalThis.ImageData = priorImageData; globalThis.queryLocalFonts = priorQueryFonts; f.harness.restore() } }
}

for (const mode of ['success', 'rejected', 'unknown', 'reopen', 'cancel', 'font-finish']) {
  test(`saved text move holds its released position and sidebar during ${mode}`, async () => {
    const f = await savedTextMoveFixture(mode)
    try {
      const x = f.harness.byId.get('vnext-text-x'), y = f.harness.byId.get('vnext-text-y')
      const fontLoading = mode === 'font-finish' ? f.panel.querySelector('[data-text-font="system"]').dispatchEvent({ type: 'click' }) : null
      await f.pointer('pointerdown', 6, 6)
      await f.pointer('pointermove', 16, 10)
      assert.equal(f.session.manualGesture?.id, 'text_a', f.harness.byId.get('vnext-canvas-status').textContent)
      if (mode === 'cancel') {
        await f.key({ key: 'Escape' })
        assert.equal(f.writes(), 0); assert.equal(Number(x.value), 4)
        assert.equal(f.panel.getAttribute('aria-busy'), null)
        return
      }
      if (mode === 'rejected') f.reject()
      const saving = f.pointer('pointerup', 18, 12)
      await f.until(() => f.writes() === 1)
      assert.deepEqual([Number(x.value), Number(y.value)], [16, 10], 'release coordinates stay displayed')
      assert.equal(x.disabled, true)
      assert.equal(f.harness.byId.get('vnext-text-size-range').inert, true, 'native slider stays non-interactive')
      assert.equal(f.harness.byId.get('vnext-text-size-range').disabled, false, 'native enabled skin stays stable')
      assert.equal(f.panel.getAttribute('aria-busy'), 'true')
      assert.equal(x.getAttribute('data-text-move-stable'), '')
      assert.equal(f.session.history.undo.length, 0)
      if (fontLoading) {
        f.releaseFonts(); await fontLoading
        assert.equal(f.harness.byId.get('vnext-text-size-range').disabled, false, 'async font completion preserves the native slider skin')
        assert.equal(f.harness.byId.get('vnext-text-size-range').inert, true, 'async font completion cannot unlock the slider')
        assert.equal(f.panel.getAttribute('aria-busy'), 'true')
      }
      if (mode === 'reopen') {
        f.api.openEpoch.next()
        await f.session.reloadProject(f.project)
        f.session.loadGeneration++
        f.session.renderCanvas()
        f.harness.byId.get('vnext-canvas-status').textContent = 'Reopened project'
      }
      f.release(); await saving
      assert.equal(f.writes(), 1)
      if (mode === 'success' || mode === 'font-finish') {
        assert.deepEqual([Number(x.value), Number(y.value)], [16, 10])
        assert.equal(f.session.history.undo.length, 1)
        assert.equal(f.panel.getAttribute('aria-busy'), null)
        assert.equal(Boolean(f.harness.byId.get('vnext-text-size-range').inert), false)
      } else if (mode === 'unknown') {
        assert.deepEqual([Number(x.value), Number(y.value)], [16, 10])
        assert.ok(f.session.manualWrite)
        assert.equal(f.panel.getAttribute('aria-busy'), 'true')
      } else {
        assert.equal(f.session.history.undo.length, 0)
        assert.equal(f.panel.getAttribute('aria-busy'), null)
        if (mode === 'rejected') assert.deepEqual([Number(x.value), Number(y.value)], [4, 4])
        if (mode === 'reopen') assert.equal(f.harness.byId.get('vnext-canvas-status').textContent, 'Reopened project')
      }
    } finally { f.release(); f.releaseFonts(); f.restore() }
  })
}

test('a fully clipped text draft can save its complete object without changing visible pixels', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64 })
  const make = globalThis.document.createElement, commands = []
  f.session.documentTimeline = { render() { return false }, stop() {}, target: () => ({ frame_id: 'f', layer_id: 'l' }) }
  globalThis.document.createElement = tag => {
    const node = make(tag); node.focus = () => {}
    if (String(tag).toLowerCase() === 'canvas') node.getContext = () => ({
      measureText: () => ({ width: 24, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 24, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 2 }),
      fillText() {}, strokeText() {}, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData() {},
    })
    return node
  }
  try {
    f.session.changeStructure = async (command, scope) => {
      commands.push(command)
      const { type, ...item } = command
      return { ok: true, operationId: 'clip_save', receipt: { operation_id: 'clip_save', project_revision: scope.projectRevision + 1 }, document: { revision: scope.workingRevision + 1, text_objects: { version: 1, items: [item] } } }
    }
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 })
    f.session.view.setTool('text')
    const origin = f.session.view.positionOf('old'), at = f.session.view.worldToScreen(origin.x, origin.y, stage.getBoundingClientRect())
    await stage.dispatchEvent({ type: 'pointerdown', button: 0, clientX: at.x, clientY: at.y, pointerId: 4, target: stage, stopImmediatePropagation() {} })
    const draft = f.session.manualGesture
    await draft.ready
    const input = stage.querySelector('.vnext-pixel-text-input')
    input.value = 'Hi完整文字'; await input.dispatchEvent({ type: 'input' })
    draft.props = { ...draft.props, x: -200, y: 300 }
    await input.dispatchEvent({ type: 'input' })
    assert.equal(draft.invalid, '')
    assert.equal(draft.stroke.changed, false)
    assert.deepEqual(draft.stroke.bytes, draft.source.rgba)
    assert.equal(draft.props.x, -200); assert.equal(draft.props.y, 300)
    assert.equal(f.session.finishTextDraft(), true)
    for (let i = 0; i < 20 && !draft.cancelled; i++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(commands.length, 1, f.harness.byId.get('vnext-canvas-status').textContent || 'text command expected')
    assert.equal(commands[0].text, 'Hi完整文字'); assert.equal(commands[0].x, -200); assert.equal(commands[0].y, 300)
    assert.equal(draft.cancelled, true)
    assert.equal(f.calls.includes('pixels'), false, 'text is not flattened into the raster')
  } finally { f.harness.restore() }
})

test('boot order Escape closes view settings before later handlers and keeps a canvas-focused paste', async () => {
  const f = await floatingPasteFixture({ boot: true })
  try {
    const panel = f.harness.byId.get('vnext-view-settings')
    const opener = f.harness.byId.get('vnext-view-settings-btn')
    const stage = f.harness.byId.get('vnext-canvas-stage')
    let focused = 0
    opener.focus = () => { focused += 1 }
    panel.hidden = false
    opener.setAttribute('aria-expanded', 'true')
    await f.harness.root.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: stage, stopImmediatePropagation() {} })
    assert.equal(panel.hidden, true)
    assert.equal(focused, 1)
    assert.equal(opener.getAttribute('aria-expanded'), 'false')
    assert.equal(f.session.manualGesture?.tool, 'paste')
    assert.equal(f.session.manualGesture.cancelled, false)
  } finally { f.harness.restore() }
})

test('sequence dialog reads handles per frame, fits large previews in 180px, warns on mixed scale, and resumes partial multi-batch commit without duplicating frames', async () => {
  const harness = createSessionHarness()
  const priorImage = globalThis.Image
  const priorCreateElement = globalThis.document.createElement
  globalThis.Image = class {
    constructor() { this.complete = true }
    addEventListener() {}
  }
  globalThis.document.createElement = (tag) => {
    const node = priorCreateElement(tag)
    node.getContext = () => ({
      imageSmoothingEnabled: true,
      clearRect() {},
      drawImage() {},
      fillRect() {},
      putImageData() {},
    })
    return node
  }
  const makeSeqNode = (id, extra = {}) => {
    const node = document.createElement(extra.tagName || 'div')
    node.id = id
    if (extra.hidden !== undefined) node.hidden = extra.hidden
    if (extra.value !== undefined) node.value = extra.value
    harness.byId.set(id, node)
    return node
  }
  makeSeqNode('vnext-sequence-dialog', { hidden: false })
  const seqInput = makeSeqNode('vnext-sequence-input', { tagName: 'INPUT' })
  const seqFrames = makeSeqNode('vnext-sequence-frames')
  const seqStatus = makeSeqNode('vnext-sequence-status')
  const seqError = makeSeqNode('vnext-sequence-error', { hidden: true })
  const seqImport = makeSeqNode('vnext-sequence-import', { tagName: 'BUTTON' })
  makeSeqNode('vnext-sequence-choose', { tagName: 'BUTTON' })
  const seqKeepAll = makeSeqNode('vnext-sequence-keep-all', { tagName: 'BUTTON', hidden: true })
  const seqApplyAuto = makeSeqNode('vnext-sequence-apply-auto', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-sequence-stop', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-general-background', { tagName: 'SELECT', value: 'auto' })

  const observedStatus = []
  let previewCallCount = 0
  const commitCalls = []
  let failBatch2Once = true
  let unknownBatch3Once = true

  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      const path = String(url)
      if (path.includes('/sprite-documents/general-sequence')) {
        const parsed = new URL(path, 'http://localhost')
        if (parsed.searchParams.get('preview') === '1') {
          previewCallCount += 1
          observedStatus.push(seqStatus.textContent)
          const isLarge = previewCallCount === 2
          const w = isLarge ? 1254 : 65
          const h = isLarge ? 1254 : 66
          const maskBytes = new Uint8Array(Math.ceil((w * h) / 8))
          maskBytes[0] = 0b00000011
          return jsonResponse(200, {
            preview: true,
            width: w,
            height: h,
            grid_consistent: !isLarge,
            grid_reason: isLarge ? 'passthrough_or_unconfirmed_grid' : 'single_frame_or_consistent',
            frames: [{
              index: 0,
              width: w,
              height: h,
              placed_width: w,
              placed_height: h,
              padded: false,
              transparent_source: false,
              background: 'magenta',
              background_status: 'omitted',
              background_reason: 'auto_detected_border_color',
              background_color: { r: 255, g: 0, b: 255 },
              recovery_status: isLarge ? 'passthrough' : 'resampled',
              recovery_reason: isLarge ? 'exceeds_recovery_budget' : 'confirmed',
              step_x: isLarge ? 1 : 19,
              step_y: isLarge ? 1 : 19,
              c_png_base64: Buffer.from(PNG_1X1).toString('base64'),
              proposal_mask_base64: Buffer.from(maskBytes).toString('base64'),
              omitted_count: 2,
            }],
          })
        }
        const opId = parsed.searchParams.get('operation_id')
        const expRev = Number(parsed.searchParams.get('expected_revision'))
        const appendId = parsed.searchParams.get('append_document_id') || ''
        commitCalls.push({ opId, expRev, appendId, bodyLen: init.body?.byteLength ?? 0 })
        if (!appendId) {
          return jsonResponse(201, {
            project: {
              id: 'proj_a',
              revision: 5,
              canvases: {
                canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
                canvas_seq: { id: 'canvas_seq', document_id: 'doc_seq', x: 0, y: 0 },
              },
              sprite_documents: { doc_seq: { working_revision: 1 } },
            },
            document: { document_id: 'doc_seq', revision: 1 },
            receipt: { operation_id: opId, project_id: 'proj_a', project_revision: 5, document_id: 'doc_seq', document_revision: 1 },
          })
        }
        if (expRev === 5 && failBatch2Once) {
          failBatch2Once = false
          return jsonResponse(409, { error: 'stale_revision', reason: 'Temporary storage busy.' })
        }
        if (expRev === 5) {
          return jsonResponse(201, {
            project: {
              id: 'proj_a',
              revision: 6,
              canvases: {
                canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
                canvas_seq: { id: 'canvas_seq', document_id: 'doc_seq', x: 0, y: 0 },
              },
              sprite_documents: { doc_seq: { working_revision: 2 } },
            },
            document: { document_id: 'doc_seq', revision: 2 },
            receipt: { operation_id: opId, project_id: 'proj_a', project_revision: 6, document_id: 'doc_seq', document_revision: 2 },
          })
        }
        if (expRev === 6 && unknownBatch3Once) {
          unknownBatch3Once = false
          return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk timeout' })
        }
        return jsonResponse(201, {
          project: {
            id: 'proj_a',
            revision: 7,
            canvases: {
              canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 },
              canvas_seq: { id: 'canvas_seq', document_id: 'doc_seq', x: 0, y: 0 },
            },
            sprite_documents: { doc_seq: { working_revision: 3 } },
          },
          document: { document_id: 'doc_seq', revision: 3 },
          receipt: { operation_id: opId, project_id: 'proj_a', project_revision: 7, document_id: 'doc_seq', document_revision: 3 },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })

  try {
    const session = bindVnextProjectSession(harness.root, { client })
    session.project = { id: 'proj_a', revision: 4, canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 0, y: 0 } } }
    session.boundProjectId = 'proj_a'
    session.sequenceMaxBatchBytes = 300

    const readOrder = []
    const payloadPng = new Uint8Array(220)
    payloadPng.set(PNG_1X1, 0)
    const files = [0, 1, 2].map((i) => ({
      name: `fire_${i}.png`,
      type: 'image/png',
      size: payloadPng.byteLength,
      arrayBuffer: async () => {
        readOrder.push(i)
        return payloadPng.buffer.slice(0)
      },
    }))

    const waitUntil = async (predicate) => {
      for (let i = 0; i < 200 && !predicate(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
    }

    seqInput.files = files
    await seqInput.dispatchEvent({ type: 'change' })
    await waitUntil(() => !seqImport.disabled)
    assert.equal(seqImport.disabled, false, seqError.textContent)
    assert.equal(previewCallCount, 3, 'preview runs frame-by-frame')
    assert.deepEqual(readOrder, [0, 1, 2], 'handles read once per frame during preview')
    assert.deepEqual(observedStatus, [
      'Recovering pixels (1/3)…',
      'Recovering pixels (2/3)…',
      'Recovering pixels (3/3)…',
    ])

    // Check fitted 128px preview box on the 1254x1254 frame (index 1)
    assert.equal(seqFrames.children.length, 3)
    const largeCard = seqFrames.children[1]
    const largeCanvas = largeCard.querySelector('canvas')
    assert.equal(largeCanvas.width, 128, 'preview thumbnail canvas backing store is bounded to <= 128px')
    assert.equal(largeCanvas.height, 128, 'preview thumbnail canvas backing store is bounded to <= 128px')
    assert.equal(largeCanvas.dataset.logicalWidth, '1254')
    assert.equal(largeCanvas.dataset.logicalHeight, '1254')
    assert.equal(largeCanvas.style.maxWidth, '128px')
    assert.equal(largeCanvas.style.maxHeight, '128px')
    assert.equal(largeCanvas.style.width, '128px')
    assert.equal(largeCanvas.style.height, '128px')

    // Check compact mixed-scale warning, hint, and collapsible Details containing passthrough budget copy
    const mixedNotice = seqStatus.children.find((node) => node.className === 'vnext-sequence-mixed-scale-notice')
    assert.ok(mixedNotice, 'mixed-scale warning must be rendered when frames have mixed dimensions')
    assert.equal(mixedNotice.textContent, 'Mixed sizes · padded, not scaled')
    const detailsNode = seqStatus.children.find((node) => node.className === 'vnext-sequence-details')
    assert.ok(detailsNode, 'collapsible Details section must be rendered')
    const detailLines = detailsNode.children.map((node) => node.textContent)
    assert.equal(detailLines[0], 'Details')
    assert.equal(detailLines.some((text) => text.includes('Mixed frame dimensions detected (65×66, 1254×1254, 65×66)')), true)
    assert.equal(detailLines.some((text) => text.includes('Original size kept (exceeds 4,194,304-pixel recovery analysis budget).')), true)

    // Attempt 1: Batch 1 succeeds, Batch 2 fails with a known error
    await seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => !session.pendingImport && !seqImport.disabled)
    assert.equal(Boolean(session.pendingImport), false)
    assert.equal(commitCalls.length, 2)
    assert.equal(commitCalls[0].appendId, '')
    assert.equal(commitCalls[0].expRev, 4)
    assert.equal(commitCalls[1].appendId, 'doc_seq')
    assert.equal(commitCalls[1].expRev, 5)
    assert.equal(session.project.revision, 5, 'committed batch 1 is synced to session.project')
    assert.match(seqError.textContent, /Temporary storage busy\. 1 of 3 frames \(1\/3 batches\) were saved\./)
    assert.equal(seqKeepAll.disabled, true, 'mask buttons lock after batch 1 commits')
    assert.equal(seqApplyAuto.disabled, true)

    // Attempt 2: Resumes directly at Batch 2 (same opId for batch 2, does not resend Batch 1), then Batch 3 hits unknown
    await seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => !harness.byId.get('vnext-confirm-dialog').hidden)
    assert.equal(commitCalls.length, 4)
    assert.equal(commitCalls[2].opId, commitCalls[1].opId, 'Batch 2 retry reuses Batch 2 operationId')
    assert.equal(commitCalls[2].appendId, 'doc_seq')
    assert.equal(commitCalls[2].expRev, 5)
    assert.equal(commitCalls[3].appendId, 'doc_seq')
    assert.equal(commitCalls[3].expRev, 6)
    assert.equal(harness.byId.get('vnext-confirm-dialog').hidden, false)

    // Attempt 3: Confirm Retry on unknown Batch 3 -> reuses Batch 3 operationId and finishes import
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await waitUntil(() => !session.pendingImport && harness.byId.get('vnext-sequence-dialog').hidden)
    assert.equal(commitCalls.length, 5)
    assert.equal(commitCalls[4].opId, commitCalls[3].opId, 'Batch 3 unknown recovery reuses Batch 3 operationId')
    assert.equal(commitCalls[4].appendId, 'doc_seq')
    assert.equal(commitCalls[4].expRev, 6)
    assert.equal(session.project.revision, 7)
    assert.equal(harness.byId.get('vnext-sequence-dialog').hidden, true)
    assert.equal(largeCanvas.width, 0, 'releaseSequenceReview zeros thumbnail canvas width on close')
    assert.equal(largeCanvas.height, 0, 'releaseSequenceReview zeros thumbnail canvas height on close')
  } finally {
    globalThis.Image = priorImage
    globalThis.document.createElement = priorCreateElement
    harness.restore()
  }
})

test('sequence preview enforces cumulative expanded RGBA budget, locks canvas/button selection while in-flight or unknown across multi-batch/known/unknown, and handles already_imported + anchor placement', async () => {
  const harness = createSessionHarness()
  const priorImage = globalThis.Image
  const priorCreateElement = globalThis.document.createElement
  globalThis.Image = class {
    constructor() { this.complete = true }
    addEventListener() {}
  }
  globalThis.document.createElement = (tag) => {
    const node = priorCreateElement(tag)
    node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 64, height: 64 })
    node.getContext = () => ({
      imageSmoothingEnabled: true,
      clearRect() {},
      drawImage() {},
      fillRect() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    })
    return node
  }
  const makeSeqNode = (id, extra = {}) => {
    const node = document.createElement(extra.tagName || 'div')
    node.id = id
    if (extra.hidden !== undefined) node.hidden = extra.hidden
    if (extra.value !== undefined) node.value = extra.value
    harness.byId.set(id, node)
    return node
  }
  const seqDialog = makeSeqNode('vnext-sequence-dialog', { hidden: false })
  const seqInput = makeSeqNode('vnext-sequence-input', { tagName: 'INPUT' })
  const seqFrames = makeSeqNode('vnext-sequence-frames')
  makeSeqNode('vnext-sequence-status')
  const seqError = makeSeqNode('vnext-sequence-error', { hidden: true })
  const seqImport = makeSeqNode('vnext-sequence-import', { tagName: 'BUTTON' })
  makeSeqNode('vnext-sequence-choose', { tagName: 'BUTTON' })
  const seqKeepAll = makeSeqNode('vnext-sequence-keep-all', { tagName: 'BUTTON', hidden: true })
  const seqApplyAuto = makeSeqNode('vnext-sequence-apply-auto', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-sequence-stop', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-general-background', { tagName: 'SELECT', value: 'auto' })

  const commitCalls = []
  let commitBehavior = () => ({ status: 201, mode: 'created' })
  let failDocumentReads = false
  let projectRead = null
  let savedPositions = []
  let layoutHold = null // a promise that holds the next canvas-layout answer
  let layoutUnknownOnce = false // answer the next canvas-layout with an ambiguous failure
  let currentServerProject = {
    id: 'proj_a',
    revision: 4,
    canvases: {
      canvas_origin: { id: 'canvas_origin', document_id: 'doc_origin', x: 0, y: 0 },
      canvas_selected: { id: 'canvas_selected', document_id: 'doc_selected', x: 300, y: 120 },
    },
    sprite_documents: {
      doc_origin: { working_revision: 1 },
      doc_selected: { working_revision: 1 },
    },
  }
  const makeDocManifest = (docId) => ({
    document_id: docId,
    name: docId,
    revision: 1,
    canvas: { w: 64, h: 64 },
    frame_order: ['f0'],
    layer_order: ['l0'],
    frames: { f0: { duration_ms: 100 } },
    layers: { l0: { name: 'Layer 1', locked: false } },
    cels: { c0: { frame_id: 'f0', layer_id: 'l0', block: { w: 64, h: 64, sha256: 'a'.repeat(64) } } },
  })
  const serverDocs = new Map([
    ['doc_origin', makeDocManifest('doc_origin')],
    ['doc_selected', makeDocManifest('doc_selected')],
  ])

  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      const path = String(url)
      if (path.includes('/sprite-documents/general-sequence')) {
        const parsed = new URL(path, 'http://localhost')
        const { decodeGeneralSequenceBody } = await import('../../src/editor-project/generalSequenceBody.js')
        const bodyBytes = init.body instanceof Uint8Array ? init.body : new Uint8Array(init.body || [])
        const decoded = decodeGeneralSequenceBody(bodyBytes)
        if (parsed.searchParams.get('preview') === '1') {
          const w = 64
          const h = 64
          const maskBytes = new Uint8Array(Math.ceil((w * h) / 8))
          maskBytes[0] = 0b00001111
          return jsonResponse(200, {
            preview: true,
            width: w,
            height: h,
            grid_consistent: true,
            grid_reason: 'single_frame_or_consistent',
            frames: decoded.map((entry, idx) => ({
              index: idx,
              width: w,
              height: h,
              placed_width: w,
              placed_height: h,
              padded: false,
              transparent_source: false,
              background: 'magenta',
              background_status: 'omitted',
              background_reason: 'auto_detected_border_color',
              background_color: { r: 255, g: 0, b: 255 },
              recovery_status: 'resampled',
              recovery_reason: 'confirmed',
              step_x: 1,
              step_y: 1,
              c_png_base64: Buffer.from(PNG_1X1).toString('base64'),
              proposal_mask_base64: Buffer.from(maskBytes).toString('base64'),
              omitted_count: 4,
            })),
          })
        }
        const opId = parsed.searchParams.get('operation_id')
        const sourceJobId = parsed.searchParams.get('source_job_id') || ''
        const appendDocId = parsed.searchParams.get('append_document_id') || ''
        const bodySha = await sha256Hex(bodyBytes)
        const record = {
          opId,
          sourceJobId,
          appendDocId,
          bodySha,
          selection: decoded[0].selection,
          frameCount: decoded.length,
        }
        commitCalls.push(record)
        const action = await commitBehavior(record, commitCalls.length)
        if (action.status === 409) {
          return jsonResponse(409, { error: 'stale_revision', reason: 'Temporary storage busy.' })
        }
        if (action.status === 500) {
          return jsonResponse(500, { error: 'internal_error', reason: 'Simulated network drop.' })
        }
        if (action.mode === 'already_imported') {
          return jsonResponse(200, {
            project: currentServerProject,
            already_imported: true,
          })
        }
        const docId = appendDocId || action.docId || `doc_seq_${commitCalls.length}`
        const canvasId = action.canvasId || `canvas_seq_${commitCalls.length}`
        const docRev = appendDocId ? 2 : 1
        serverDocs.set(docId, { ...makeDocManifest(docId), revision: docRev })
        currentServerProject = {
          ...currentServerProject,
          revision: currentServerProject.revision + 1,
          canvases: appendDocId
            ? currentServerProject.canvases
            : {
              ...currentServerProject.canvases,
              [canvasId]: { id: canvasId, document_id: docId, x: 0, y: 0 },
            },
          sprite_documents: {
            ...currentServerProject.sprite_documents,
            [docId]: { working_revision: docRev },
          },
        }
        return jsonResponse(appendDocId ? 200 : 201, {
          project: currentServerProject,
          canvas: currentServerProject.canvases[canvasId],
          document: serverDocs.get(docId),
          receipt: {
            operation_id: opId,
            project_id: 'proj_a',
            project_revision: currentServerProject.revision,
            document_id: docId,
            document_revision: docRev,
          },
        })
      }
      if (path.endsWith('/canvas-layout')) {
        const body = JSON.parse(init.body)
        savedPositions.push(body.positions)
        if (layoutHold) { const held = layoutHold; layoutHold = null; await held }
        if (layoutUnknownOnce) { layoutUnknownOnce = false; return jsonResponse(500, { error: 'internal_error', reason: 'Ambiguous answer in this check.' }) }
        const nextCanvases = { ...currentServerProject.canvases }
        for (const p of body.positions) {
          if (nextCanvases[p.canvas_id]) {
            nextCanvases[p.canvas_id] = { ...nextCanvases[p.canvas_id], x: p.x, y: p.y }
          }
        }
        currentServerProject = {
          ...currentServerProject,
          revision: currentServerProject.revision + 1,
          canvases: nextCanvases,
        }
        return jsonResponse(200, {
          project: currentServerProject,
          receipt: {
            operation_id: body.operation_id,
            project_id: 'proj_a',
            project_revision: currentServerProject.revision,
          },
        })
      }
      if (path.endsWith('/sprite-documents')) {
        if (failDocumentReads) return jsonResponse(500, { error: 'internal_error', reason: 'Simulated read failure.' })
        return jsonResponse(200, { documents: [...serverDocs.values()] })
      }
      const docMatch = path.match(/\/sprite-documents\/([^/?#]+)$/)
      if (docMatch && failDocumentReads) return jsonResponse(500, { error: 'internal_error', reason: 'Simulated read failure.' })
      if (docMatch && serverDocs.has(docMatch[1])) {
        return jsonResponse(200, { document: serverDocs.get(docMatch[1]) })
      }
      if (path.includes('/blocks/')) {
        return new Response(new Uint8Array(64 * 64 * 4), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'x-Canvas-Width': '64', 'x-Canvas-Height': '64' },
        })
      }
      if (path.endsWith('/projects/proj_a')) {
        if (projectRead === 'fail') return jsonResponse(500, { error: 'internal_error', reason: 'Simulated project read failure.' })
        if (projectRead === 'older') return jsonResponse(200, { project: { ...currentServerProject, revision: currentServerProject.revision - 5 } })
        return jsonResponse(200, { project: currentServerProject })
      }
      throw new Error(`unexpected ${path}`)
    },
  })

  try {
    // 0. Default 64 MiB sequence batch ceiling splits 3 x 25 MiB file handles into [2, 1] without custom sequenceMaxBatchBytes
    const { partitionSequenceSourceBatches } = await import('../../src/editor-project/generalSequenceBody.js')
    const defaultBatches = partitionSequenceSourceBatches([
      { name: 'big1.png', size: 25 * 1024 * 1024 },
      { name: 'big2.png', size: 25 * 1024 * 1024 },
      { name: 'big3.png', size: 25 * 1024 * 1024 },
    ])
    assert.deepEqual(defaultBatches.map((b) => b.length), [2, 1], 'default 64 MiB ceiling splits 3 x 25 MiB into [2, 1]')

    const session = bindVnextProjectSession(harness.root, { client })
    await session.reloadProject(currentServerProject)

    const waitUntil = async (predicate) => {
      for (let i = 0; i < 200 && !predicate(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
    }

    const readOrder = []
    const payloadPng = new Uint8Array(PNG_1X1)
    const makeHandle = (idx, name) => ({
      name,
      size: payloadPng.byteLength,
      type: 'image/png',
      async arrayBuffer() {
        readOrder.push(idx)
        return payloadPng.buffer.slice(0)
      },
    })

    // 1. Cumulative expanded RGBA budget check
    session.sequenceMaxExpandedBytes = 20000
    seqInput.files = [makeHandle(0, 'f1.png'), makeHandle(1, 'f2.png'), makeHandle(2, 'f3.png')]
    await seqInput.dispatchEvent({ type: 'change' })
    await waitUntil(() => !seqError.hidden)
    assert.equal(seqImport.disabled, true)
    assert.match(seqError.textContent, /Sequence canvas dimensions exceed the 128 MiB uncompressed RGBA budget\./)
    assert.deepEqual(readOrder, [0, 1])
    assert.equal(seqFrames.children.length, 0)

    // 2a. Item 2: Multi-batch submit holds batch-0 POST in flight; canvas cell click & Keep-all click are blocked so batch 1 never crashes on null frozenCommitBatches
    session.sequenceMaxExpandedBytes = 128 * 1024 * 1024
    session.sequenceMaxBatchBytes = 100 // splits 2 x 67-byte frames into 2 batches [1, 1]
    readOrder.length = 0
    seqInput.files = [makeHandle(0, 'mb1.png'), makeHandle(1, 'mb2.png')]
    await seqInput.dispatchEvent({ type: 'change' })
    await waitUntil(() => !seqImport.disabled && seqFrames.children.length === 2)

    let releaseBatch0
    let batch0InFlight = false
    commitBehavior = async (_rec, callIdx) => {
      if (callIdx === 1) {
        batch0InFlight = true
        await new Promise((resolve) => { releaseBatch0 = resolve })
      }
      return { status: 201, mode: 'created', docId: 'doc_mb', canvasId: 'canvas_mb' }
    }
    const importPromise2a = seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => batch0InFlight)
    assert.equal(seqKeepAll.disabled, true, 'Keep original pixels button disabled while batch 0 is in flight')
    assert.equal(seqApplyAuto.disabled, true, 'Use automatic removal button disabled while batch 0 is in flight')
    // Click both frame canvases and Keep-all while batch 0 is in flight
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    await seqFrames.children[1].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    await seqKeepAll.dispatchEvent({ type: 'click' })
    releaseBatch0()
    await importPromise2a
    await waitUntil(() => !session.pendingImport && seqDialog.hidden)
    assert.equal(commitCalls.length, 2, 'both batches completed without null frozenCommitBatches crash')
    assert.equal(commitCalls[0].selection.mode, 'proposal', 'batch 0 kept frozen proposal selection')
    assert.equal(commitCalls[1].selection.mode, 'proposal', 'batch 1 kept frozen proposal selection despite canvas click during batch 0')
    assert.equal(commitCalls[1].appendDocId, 'doc_mb')

    // 2b. Item 2: Hold batch-0 POST in flight, click canvas cell (blocked), then reject with known 409 -> canvas click now toggles cell (0,0) and re-freezes new opId + delta body on retry
    session.sequenceMaxBatchBytes = undefined
    commitCalls.length = 0
    seqDialog.hidden = false
    seqInput.files = [makeHandle(0, 'single.png')]
    await seqInput.dispatchEvent({ type: 'change' })
    await waitUntil(() => !seqImport.disabled && seqFrames.children.length === 1)

    batch0InFlight = false
    commitBehavior = async (_rec, callIdx) => {
      if (callIdx === 1) {
        batch0InFlight = true
        await new Promise((resolve) => { releaseBatch0 = resolve })
        return { status: 409 }
      }
      return { status: 201, mode: 'created', docId: 'doc_known', canvasId: 'canvas_known' }
    }
    const importPromise2b = seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => batch0InFlight)
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    releaseBatch0()
    await importPromise2b
    await waitUntil(() => !session.pendingImport && !seqImport.disabled)
    assert.equal(commitCalls.length, 1)
    assert.equal(commitCalls[0].selection.mode, 'proposal', 'in-flight canvas click did not mutate batch 0 selection')

    // Now that batch 0 failed with known 409, click canvas cell (0,0) -> toggles cell 0 and invalidates frozen batch
    assert.equal(seqKeepAll.disabled, false, 'selection buttons re-enabled after batch-0 known failure')
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    await seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => !session.pendingImport && seqDialog.hidden)
    assert.equal(commitCalls.length, 2)
    assert.notEqual(commitCalls[1].opId, commitCalls[0].opId, 'fresh operationId generated after canvas cell click following batch-0 known failure')
    assert.notEqual(commitCalls[1].bodySha, commitCalls[0].bodySha, 'fresh request body frozen after canvas cell click')
    assert.equal(commitCalls[1].selection.mode, 'delta')
    assert.deepEqual(commitCalls[1].selection.removed, [[0, 0]], 'cell (0,0) toggled from omitted to kept')

    // 2c. Item 2: Hold batch-0 POST in flight, click canvas cell, then fail with unknown (500) -> selection stays locked both before and after Dismiss, and replays exact frozen opId + bodySha
    commitCalls.length = 0
    seqDialog.hidden = false
    seqInput.files = [makeHandle(0, 'unknown.png')]
    await seqInput.dispatchEvent({ type: 'change' })
    await waitUntil(() => !seqImport.disabled && seqFrames.children.length === 1)

    batch0InFlight = false
    commitBehavior = async (_rec, callIdx) => {
      if (callIdx === 1) {
        batch0InFlight = true
        await new Promise((resolve) => { releaseBatch0 = resolve })
        return { status: 500 }
      }
      return { status: 201, mode: 'created', docId: 'doc_unk', canvasId: 'canvas_unk' }
    }
    const importPromise2c = seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => batch0InFlight)
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    releaseBatch0()
    await importPromise2c
    await waitUntil(() => !harness.byId.get('vnext-confirm-dialog').hidden)
    assert.equal(seqKeepAll.disabled, true, 'Keep-all stays disabled on unknown outcome')
    assert.equal(seqApplyAuto.disabled, true, 'Apply-auto stays disabled on unknown outcome')
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    await seqKeepAll.dispatchEvent({ type: 'click' })
    // Click Dismiss on confirm dialog -> sequenceReview.unknownPending remains true, so selection must still stay locked
    await harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
    assert.equal(seqKeepAll.disabled, true, 'Keep-all stays disabled even after dismissing unknown dialog')
    assert.equal(seqApplyAuto.disabled, true, 'Apply-auto stays disabled even after dismissing unknown dialog')
    await seqFrames.children[0].dispatchEvent({ type: 'click', clientX: 0, clientY: 0 })
    await seqKeepAll.dispatchEvent({ type: 'click' })
    // Click Import frames again -> re-opens unknown recovery dialog instead of starting a new request
    await seqImport.dispatchEvent({ type: 'click' })
    await waitUntil(() => !harness.byId.get('vnext-confirm-dialog').hidden)
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await waitUntil(() => !session.pendingImport && seqDialog.hidden)
    assert.equal(commitCalls.length, 2)
    assert.equal(commitCalls[1].opId, commitCalls[0].opId, 'unknown retry replays the exact frozen operationId')
    assert.equal(commitCalls[1].bodySha, commitCalls[0].bodySha, 'unknown retry replays the exact frozen body bytes')
    assert.equal(commitCalls[1].selection.mode, 'proposal')

    // 3. Item 13: Anchor neighbor placement draft + explicit Save positions
    commitCalls.length = 0
    savedPositions.length = 0
    session.view.discardDrafts()
    session.view.select('canvas_selected')
    // Simulate an unsaved drag on canvas_origin to (0, 80) before adopting a generated asset anchored to canvas_selected (300, 120)
    session.view.moveDraft('canvas_origin', 0, 80)
    assert.equal(session.view.listedDirtyPositions().length, 1, 'canvas_origin has an unsaved position draft')

    // A generated image the user asked for is imported directly: automatic background proposal, provenance, anchor placement.
    const generated = { bytes: payloadPng, projectId: 'proj_a', openEpoch: client.openEpoch.current, name: 'job_gen_42-generated.png',
      sourceJobId: 'job_gen_42', anchor: { id: 'canvas_selected', width: 64, height: 64 } }
    const undoBeforeImport = session.history.undo.length
    commitBehavior = async () => ({ status: 201, mode: 'created', docId: 'doc_gen_42', canvasId: 'canvas_gen_42' })
    const placedResult = await session.importGeneratedAsset(generated)
    assert.equal(placedResult.placed, true)
    assert.equal(placedResult.canvasId, 'canvas_gen_42')
    assert.equal(placedResult.historyEntry, session.history.undo.at(-1), 'the result reports exactly the Undo entry it recorded')
    assert.equal(placedResult.historyEntry.canvasId, 'canvas_gen_42')
    assert.equal(commitCalls.at(-1).sourceJobId, 'job_gen_42')
    assert.equal(commitCalls.at(-1).selection.mode, 'proposal', 'the automatic background proposal applies without a review dialog')
    assert.equal(session.pendingImport, false)
    assert.equal(session.history.undo.length, undoBeforeImport + 1, 'one Undo entry removes the new canvas')
    // DIRECT-ACTIONS r4: the request places the image, so its own beside position is saved with it
    // (only that canvas; the user's unsaved drafts are neither saved nor moved).
    assert.deepEqual(savedPositions, [[{ canvas_id: 'canvas_gen_42', x: 380, y: 120 }]], 'only the new canvas position is saved')
    assert.deepEqual(session.view.positionOf('canvas_gen_42'), { x: 380, y: 120 }, 'new canvas placed beside anchor canvas_selected (300 + 64 + 16, 120) without overlapping (0,0) or (300,120)')
    assert.deepEqual(session.view.positionOf('canvas_origin'), { x: 0, y: 80 }, 'unsaved draft on canvas_origin preserved in view until explicit Save positions')
    assert.deepEqual(session.view.listedDirtyPositions().map(item => item.canvas_id), ['canvas_origin'], 'only the user\'s own draft still awaits Save positions')
    assert.equal(placedResult.historyEntry.to.x, 380, 'Undo/Redo of the addition uses the saved place')
    await session.reloadProject(currentServerProject)
    assert.deepEqual(session.view.positionOf('canvas_gen_42'), { x: 380, y: 120 }, 'a reload keeps the image where it was placed, not stacked at the origin')

    // Click explicit Save positions -> persists the user's own draft only
    await harness.byId.get('vnext-project-menu').dispatchEvent({ type: 'click', target: harness.byId.get('vnext-save-positions') })
    await waitUntil(() => savedPositions.length === 2)
    assert.deepEqual(savedPositions[1].map(item => item.canvas_id), ['canvas_origin'])
    assert.equal(session.view.listedDirtyPositions().length, 0, 'dirty positions cleared after explicit Save positions')
    await session.reloadProject(currentServerProject)
    assert.deepEqual(session.view.positionOf('canvas_gen_42'), { x: 380, y: 120 }, 'reopened project retains saved neighbor position (380, 120)')

    // DIRECT-ACTIONS r4 review: a placement's position write holds the import lock, so Save
    // positions and Undo cannot race it; a blocked placement still moves the canvas as a draft and
    // says it is unsaved; an ambiguous answer is reported as not confirmed.
    const status = harness.byId.get('vnext-canvas-status')
    let releaseLayout
    layoutHold = new Promise(resolve => { releaseLayout = resolve })
    const layoutsBefore = savedPositions.length
    const placing = session.placeAddedCanvas({ projectId: 'proj_a', canvasId: 'canvas_gen_42', point: { x: 460, y: 120 } })
    await waitUntil(() => savedPositions.length === layoutsBefore + 1)
    assert.equal(session.pendingImport?.kind, 'placed-canvas-position', 'the position write holds the import lock')
    session.view.moveDraft('canvas_origin', 0, 96)
    await harness.byId.get('vnext-project-menu').dispatchEvent({ type: 'click', target: harness.byId.get('vnext-save-positions') })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(savedPositions.length, layoutsBefore + 1, 'Save positions does not race the held position write')
    releaseLayout()
    assert.deepEqual(await placing, { saved: true, point: { x: 460, y: 120 } })
    assert.equal(session.pendingImport, false, 'the lock is released')
    // r7: a canvas a later save moved away from where its own add stored it keeps that newer layout; a late
    // completion neither moves it nor writes its position.
    const storedNow = session.project.canvases?.canvas_gen_42
    assert.ok(storedNow, 'the placed canvas is stored')
    const layoutsBeforeMoved = savedPositions.length
    assert.deepEqual(await session.placeAddedCanvas({ projectId: 'proj_a', canvasId: 'canvas_gen_42', origin: { x: (storedNow.x ?? 0) + 8, y: storedNow.y ?? 0 } }),
      { unchanged: true, movedSinceAdd: true })
    assert.equal(savedPositions.length, layoutsBeforeMoved, 'nothing is moved or written for a canvas the user moved since its add')
    // r8: an unsaved position the user gave this canvas (stored still at its add origin) is kept too: automatic
    // placement neither replaces nor saves it, even where it covers another canvas.
    const coveredSpot = session.view.positionOf('canvas_selected')
    session.view.moveDraft('canvas_gen_42', coveredSpot.x, coveredSpot.y)
    assert.deepEqual(await session.placeAddedCanvas({ projectId: 'proj_a', canvasId: 'canvas_gen_42', origin: { x: storedNow.x ?? 0, y: storedNow.y ?? 0 } }),
      { unchanged: true, draftKept: true })
    assert.deepEqual(session.view.positionOf('canvas_gen_42'), coveredSpot, 'the user\'s unsaved position stays where the user put it')
    assert.equal(savedPositions.length, layoutsBeforeMoved, 'and is not written')
    session.view.discardDrafts()
    session.manualGesture = { kind: 'test-gesture' }
    const blockedPlacement = await session.placeAddedCanvas({ projectId: 'proj_a', canvasId: 'canvas_gen_42', point: { x: 540, y: 120 } })
    session.manualGesture = null
    assert.deepEqual(blockedPlacement, { positionFailed: true, deferred: true, point: { x: 540, y: 120 } })
    assert.equal(savedPositions.length, layoutsBefore + 1, 'nothing is written while another gesture is in progress')
    assert.deepEqual(session.view.positionOf('canvas_gen_42'), { x: 540, y: 120 }, 'the canvas still moves beside the others as a draft')
    assert.match(status.textContent, /Placed beside the existing canvases, but the position was not saved\. Save canvas positions to keep it there\./)
    layoutUnknownOnce = true
    const unknownPlacement = await session.placeAddedCanvas({ projectId: 'proj_a', canvasId: 'canvas_gen_42', point: { x: 540, y: 120 } })
    assert.equal(unknownPlacement.positionUnknown, true)
    assert.match(status.textContent, /saving its position was not confirmed/, 'an ambiguous answer is not reported as a definite failure')
    assert.equal(session.pendingImport, false)
    session.view.discardDrafts()
    await session.reloadProject(currentServerProject)

    // 4. Item 10: Deduplicated 200 { project, already_imported: true } (no receipt) on both a direct second import and a lost-ACK (unknown) replay
    const undoCountBeforeDedup = session.history.undo.length
    const canvasesSnapshotBeforeDedup = session.view.canvases.map((c) => ({ id: c.id, ...session.view.positionOf(c.id) }))
    commitBehavior = async () => ({ status: 200, mode: 'already_imported' })
    assert.deepEqual(await session.importGeneratedAsset(generated), { alreadyImported: true })
    assert.equal(session.history.undo.length, undoCountBeforeDedup, 'already_imported does not record a new Undo entry')
    assert.deepEqual(
      session.view.canvases.map((c) => ({ id: c.id, ...session.view.positionOf(c.id) })),
      canvasesSnapshotBeforeDedup,
      'already_imported does not move existing canvases',
    )

    // Lost-ACK (unknown 500), then resolving the same image replays the exact frozen operation and finds it already imported
    let firstUnk = true
    commitBehavior = async () => {
      if (firstUnk) {
        firstUnk = false
        return { status: 500 }
      }
      return { status: 200, mode: 'already_imported' }
    }
    assert.deepEqual(await session.importGeneratedAsset(generated), { unknown: true })
    assert.equal(session.imageSaveCurrentFor('job_gen_42'), true, 'the unknown import is kept for the same job')
    assert.deepEqual(
      session.view.canvases.map((c) => ({ id: c.id, ...session.view.positionOf(c.id) })),
      canvasesSnapshotBeforeDedup,
      'unknown outcome does not move canvases',
    )
    assert.deepEqual(await session.importGeneratedAsset({ ...generated, bytes: undefined }), { alreadyImported: true })
    assert.equal(commitCalls.at(-1).opId, commitCalls.at(-2).opId, 'the replay reuses the frozen operation id')
    assert.equal(commitCalls.at(-1).bodySha, commitCalls.at(-2).bodySha, 'the replay reuses the frozen body bytes')
    assert.equal(session.imageSaveCurrentFor('job_gen_42'), false)
    assert.equal(session.history.undo.length, undoCountBeforeDedup, 'replay already_imported does not push duplicate Undo entry')
    assert.deepEqual(
      session.view.canvases.map((c) => ({ id: c.id, ...session.view.positionOf(c.id) })),
      canvasesSnapshotBeforeDedup,
      'replay already_imported does not move existing canvases',
    )

    // 5. The import commits but the canvas does not load: a truthful saved-but-not-refreshed
    // outcome, no modal and no Undo yet; the inline recovery only reloads, then binds one Undo.
    const refreshJob = { ...generated, sourceJobId: 'job_gen_77' }
    const undoBeforeRefresh = session.history.undo.length
    const commitsBeforeRefresh = commitCalls.length
    commitBehavior = async () => ({ status: 201, mode: 'created', docId: 'doc_gen_77', canvasId: 'canvas_gen_77' })
    failDocumentReads = true
    const pendingOutcome = await session.importGeneratedAsset(refreshJob)
    failDocumentReads = false
    assert.equal(pendingOutcome.saved, true)
    assert.equal(pendingOutcome.refreshPending, true)
    assert.equal(pendingOutcome.placed, undefined, 'not reported as placed before the canvas shows it')
    assert.equal(typeof pendingOutcome.operationId, 'string')
    assert.equal(commitCalls.length, commitsBeforeRefresh + 1)
    assert.equal(session.history.undo.length, undoBeforeRefresh, 'no Undo entry before the canvas refreshes')
    assert.notEqual(harness.byId.get('vnext-confirm-dialog')?.hidden, false, 'a requested result recovers inline, not in a modal')
    assert.equal(session.imageSaveCurrentFor('job_gen_77'), true, 'the same import is kept for its recovery')
    // A failed or older project read keeps the recovery: the import-time snapshot is never shown in its place.
    for (const read of ['fail', 'older']) {
      projectRead = read
      const kept = await session.importGeneratedAsset({ ...refreshJob, bytes: undefined })
      assert.equal(kept.refreshPending, true, `${read}: still saved, not refreshed`)
      assert.equal(kept.placed, undefined, `${read}: not reported as placed`)
      assert.equal(session.history.undo.length, undoBeforeRefresh, `${read}: no Undo yet`)
      assert.equal(session.view.canvases.some(canvas => canvas.id === 'canvas_gen_77'), false, `${read}: nothing older than the import is shown`)
      assert.equal(commitCalls.length, commitsBeforeRefresh + 1, `${read}: never sent again`)
    }
    projectRead = null
    const recovered = await session.importGeneratedAsset({ ...refreshJob, bytes: undefined })
    assert.equal(recovered.placed, true)
    assert.equal(recovered.canvasId, 'canvas_gen_77')
    assert.equal(commitCalls.length, commitsBeforeRefresh + 1, 'recovery never sends the import again')
    assert.equal(session.history.undo.length, undoBeforeRefresh + 1, 'exactly one Undo entry')
    assert.equal(recovered.historyEntry, session.history.undo.at(-1))
    assert.equal(recovered.historyEntry.canvasId, 'canvas_gen_77')
    assert.equal(session.imageSaveCurrentFor('job_gen_77'), false)
    assert.ok(session.view.canvases.some(canvas => canvas.id === 'canvas_gen_77'), 'the canvas shows the recovered import')
  } finally {
    globalThis.Image = priorImage
    globalThis.document.createElement = priorCreateElement
    harness.restore()
  }
})

test('first edit on an original 1254x1254 canvas (createPixelCopy) applies real strip bytes, recovers known/unknown strip-2 failures without re-deriving, and preserves original hash + Undo pixels', async () => {
  const f = await selectionSessionFixture({ width: 1254, height: 1254 })
  try {
    f.session.view.select('old')
    let deriveCalls = 0
    const baseDerive = f.api.deriveWorking
    f.api.deriveWorking = async (_projectId, body) => {
      deriveCalls += 1
      const res = await baseDerive(_projectId, body)
      f.session.project = res.project
      return res
    }
    const detachCalls = []
    const baseDetach = f.api.detachCanvas
    f.api.detachCanvas = async (_p, canvasId, body) => {
      detachCalls.push({ canvasId, opId: body.operationId })
      const res = await baseDetach(_p, canvasId, body)
      f.session.project = res.project
      return res
    }

    let failSecondStripMode = 'known'
    const stripRequests = []
    const committedByOp = new Map()
    const baseWrite = f.api.writeWorkingPixels
    f.api.writeWorkingPixels = async (_p, id, body) => {
      const bytesSha = await sha256Hex(body.bytes)
      stripRequests.push({
        opId: body.operationId,
        rev: body.expectedWorkingRevision,
        projRev: body.expectedRevision,
        y: body.y,
        h: body.height,
        bytesSha,
      })
      if (committedByOp.has(body.operationId)) {
        const cached = committedByOp.get(body.operationId)
        f.session.project = cached.project
        return cached
      }
      if (failSecondStripMode === 'known' && body.y > 0) {
        failSecondStripMode = null
        throw Object.assign(new Error('strip 2 rejected on first copy'), {
          kind: 'stale',
          code: 'stale_revision',
          reason: 'strip 2 rejected on first copy',
        })
      }
      const res = await baseWrite(_p, id, body)
      committedByOp.set(body.operationId, res)
      if (failSecondStripMode === 'unknown' && body.y > 0) {
        failSecondStripMode = null
        throw Object.assign(new Error('strip 2 lost ACK'), {
          kind: 'unknown',
          code: 'network_error',
          reason: 'strip 2 lost ACK',
        })
      }
      f.session.project = res.project
      return res
    }

    const source = await f.session.preparePixelEdit({ scopeGrant: false })
    const after = new Uint8Array(1254 * 1254 * 4)
    for (let i = 0; i < after.length; i += 4) {
      after[i] = (i / 4) % 251
      after[i + 1] = 140
      after[i + 2] = 220
      after[i + 3] = 255
    }

    // 1. Known failure on strip 2 -> Retry finishes strip 2 without re-deriving and applies full 1254x1254 stroke bytes
    const msg1 = await f.session.savePixelStroke(source, after)
    assert.match(msg1, /Partial stroke saved \(1\/2 strips\)\. Retry to finish or undo to revert\./)
    assert.equal(deriveCalls, 1)
    assert.equal(stripRequests.length, 2)
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'original canvas block hash is untouched')

    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(deriveCalls, 1, 'Retry does not call deriveWorking again')
    assert.equal(stripRequests.length, 3, 'Retry sends only strip 2')
    assert.equal(stripRequests[2].y, 836)
    assert.equal(f.session.pixelCopyPending, false)
    assert.equal(f.session.pendingImport, false)
    assert.deepEqual(await f.pixels('doc_new'), [...after], 'derived copy has full 1254x1254 stroke RGBA bytes')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'original canvas block hash remains untouched')
    assert.deepEqual(await f.pixels('doc_old'), [...f.original], 'original canvas pixels remain untouched')

    // 2. Undo detaches the derived copy; then trigger an unknown (committed in store, lost ACK) failure on strip 2 -> Try again replays exact strip-2 opId + bytesSha and returns cached receipt without re-deriving or re-committing
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(detachCalls.length, 1, 'Undo detaches the derived copy')
    assert.equal(f.session.history.undo.length, 0)
    f.session.view.select('old')
    f.session.conversationRef = { projectId: f.session.project.id, canvasId: 'old', documentId: 'doc_old' }
    failSecondStripMode = 'unknown'
    const source2 = await f.session.preparePixelEdit({ scopeGrant: false })
    await f.session.savePixelStroke(source2, after)
    assert.equal(deriveCalls, 2, 'second copy derives once')
    assert.equal(f.session.pixelCopyPending, true, 'unknown failure on strip 2 keeps pixelCopyPending lock')
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false, 'unknown failure opens recovery confirm dialog')
    assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'New image not completed')
    const failedStrip2Req = stripRequests.at(-1)
    assert.equal(failedStrip2Req.y, 836)
    const revBeforeReplay = f.docs.get('doc_new').revision
    assert.equal(revBeforeReplay, 3, 'strip 2 was already committed in store (revision 3) before ACK was lost')
    assert.deepEqual(await f.pixels('doc_new'), [...after], 'strip 2 RGBA bytes are already committed in store before replay')
    assert.equal(f.session.history.undo.length, 1, 'one Undo entry exists for the derived copy after strip 1')

    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(deriveCalls, 2, 'unknown replay on strip 2 does NOT call deriveWorking again')
    assert.equal(stripRequests.at(-1).opId, failedStrip2Req.opId, 'unknown replay reuses exact strip-2 operationId')
    assert.equal(stripRequests.at(-1).bytesSha, failedStrip2Req.bytesSha, 'unknown replay reuses exact strip-2 body bytes')
    assert.equal(f.docs.get('doc_new').revision, revBeforeReplay, 'unknown replay returns cached receipt without incrementing document revision')
    assert.equal(f.session.history.undo.length, 1, 'unknown replay updates the single Undo entry without pushing a duplicate')
    assert.equal(f.session.pixelCopyPending, false)
    assert.equal(f.session.pendingImport, false)
    assert.deepEqual(await f.pixels('doc_new'), [...after], 'unknown replay preserves full 1254x1254 stroke bytes on doc_new')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'original canvas block hash remains untouched')
    assert.deepEqual(await f.pixels('doc_old'), [...f.original], 'original canvas pixels remain untouched')

    // 3. Undo again, trigger known failure on strip 2, and press Ctrl+Z directly -> detaches partial copy in one step
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(detachCalls.length, 2)
    f.session.view.select('old')
    f.session.conversationRef = { projectId: f.session.project.id, canvasId: 'old', documentId: 'doc_old' }
    failSecondStripMode = 'known'
    const source3 = await f.session.preparePixelEdit({ scopeGrant: false })
    await f.session.savePixelStroke(source3, after)
    assert.equal(Boolean(f.session.pendingImport?.partialKnownFailure), true)
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(f.session.pixelCopyPending, false)
    assert.equal(f.session.pendingImport, false)
    assert.equal(detachCalls.length, 3, 'Undo detaches partially written derived copy in one step')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha)
  } finally {
    f.harness.restore()
  }
})

test('multi-strip savePixelStroke applies real strip bytes for a 1254x1254 edit, recovers or reverts partial failures, and Undo/Redo restores exact pixels in a single step', async () => {
  const f = await selectionSessionFixture({ width: 1254, height: 1254 })
  try {
    const docId = 'doc_new'
    const derived = await f.api.deriveWorking(f.project.id, { operationId: 'derive_big' })
    await f.session.reloadProject(derived.project)
    f.session.view.select('new')
    let stripWriteCount = 0
    let failSecondStripMode = null
    const stripRequests = []
    const committedByOp = new Map()
    const baseWrite = f.api.writeWorkingPixels
    f.api.writeWorkingPixels = async (_p, id, body) => {
      stripWriteCount += 1
      const bytesSha = await sha256Hex(body.bytes)
      stripRequests.push({
        stripWriteCount,
        opId: body.operationId,
        rev: body.expectedWorkingRevision,
        projRev: body.expectedRevision,
        x: body.x,
        y: body.y,
        w: body.width,
        h: body.height,
        bytesSha,
      })
      if (committedByOp.has(body.operationId)) {
        const cached = committedByOp.get(body.operationId)
        f.session.project = cached.project
        return cached
      }
      if (failSecondStripMode === 'known' && body.y > 0) {
        failSecondStripMode = null
        throw Object.assign(new Error('strip 2 rejected'), { kind: 'stale', code: 'stale_revision', reason: 'strip 2 rejected' })
      }
      const res = await baseWrite(_p, id, body)
      committedByOp.set(body.operationId, res)
      if (failSecondStripMode === 'unknown' && body.y > 0) {
        failSecondStripMode = null
        throw Object.assign(new Error('strip 2 lost ACK'), { kind: 'unknown', code: 'network_error', reason: 'strip 2 lost ACK' })
      }
      f.session.project = res.project
      return res
    }
    const restoreTargets = []
    const baseRestore = f.api.restoreWorking
    f.api.restoreWorking = async (_p, id, body) => {
      restoreTargets.push(body.targetRevision)
      const res = await baseRestore(_p, id, body)
      f.session.project = res.project
      return res
    }

    const makeSource = async (docRev, projRev) => ({
      projectId: f.session.project.id,
      projectRevision: projRev,
      sourceCanvasId: 'new',
      sourceDocumentId: docId,
      sourceRevision: docRev,
      width: 1254,
      height: 1254,
      rgba: new Uint8Array(await f.pixels(docId)),
      target: { frame_id: 'f', layer_id: 'l', cel_id: 'c' },
      isSelected: () => true,
      isCurrent: () => true,
    })

    // 1. Full 2-strip stroke succeeds, writes real RGBA bytes across both strips, and Undo/Redo restores exact bytes in one step
    const afterFull = new Uint8Array(1254 * 1254 * 4)
    afterFull.fill(200)
    const res1 = await f.session.savePixelStroke(await makeSource(1, f.session.project.revision), afterFull)
    assert.deepEqual(res1, { saved: true, partial: false, settled: true })
    assert.equal(stripRequests.length, 2)
    assert.equal(stripRequests[0].y, 0)
    assert.equal(stripRequests[0].h, 836)
    assert.equal(stripRequests[1].y, 836)
    assert.equal(stripRequests[1].h, 418)
    assert.deepEqual(await f.pixels(docId), [...afterFull], 'both strips applied to doc_new pixels')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'original canvas hash unchanged')

    await f.key({ key: 'z', ctrlKey: true })
    assert.deepEqual(restoreTargets, [1])
    assert.deepEqual(await f.pixels(docId), [...f.original], 'single-step Undo restores exact original pixels')
    await f.key({ key: 'z', ctrlKey: true, shiftKey: true })
    assert.deepEqual(restoreTargets, [1, 3])
    assert.deepEqual(await f.pixels(docId), [...afterFull], 'single-step Redo restores exact full-stroke pixels')

    // 2. Partial multi-strip failure on strip 2 -> Retry finishes strip 2 and completes full RGBA bytes
    failSecondStripMode = 'known'
    const afterPartial = new Uint8Array(1254 * 1254 * 4)
    afterPartial.fill(150)
    const curDocRev = f.docs.get(docId).revision
    const res2 = await f.session.savePixelStroke(await makeSource(curDocRev, f.session.project.revision), afterPartial)
    assert.equal(res2.saved, false)
    assert.equal(res2.partial, true)
    assert.equal(res2.settled, false)
    const countBeforeRetry = stripRequests.length
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(stripRequests.length, countBeforeRetry + 1)
    assert.equal(stripRequests.at(-1).y, 836)
    assert.equal(f.session.manualWrite, null)
    assert.deepEqual(await f.pixels(docId), [...afterPartial], 'Retry completes full 1254x1254 pixels on doc_new')

    // 3. Another partial failure on strip 2 -> Ctrl+Z reverts to beforeRevision in one step and restores exact pre-stroke bytes
    failSecondStripMode = 'known'
    const afterPartial2 = new Uint8Array(1254 * 1254 * 4)
    afterPartial2.fill(90)
    const revBeforePartial2 = f.docs.get(docId).revision
    await f.session.savePixelStroke(await makeSource(revBeforePartial2, f.session.project.revision), afterPartial2)
    assert.equal(Boolean(f.session.manualWrite?.partialKnownFailure), true)
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(f.session.manualWrite, null)
    assert.equal(restoreTargets.at(-1), revBeforePartial2)
    assert.deepEqual(await f.pixels(docId), [...afterPartial], 'Undo of partial multi-strip stroke restores exact pre-stroke pixels')

    // 4. Committed strip 2 with lost ACK (unknown) -> already committed in store before replay; Try again returns cached receipt without bumping revision or duplicating history
    failSecondStripMode = 'unknown'
    const afterUnknown = new Uint8Array(1254 * 1254 * 4)
    afterUnknown.fill(110)
    const revBeforeUnknown = f.docs.get(docId).revision
    const undoCountBeforeUnknown = f.session.history.undo.length
    await f.session.savePixelStroke(await makeSource(revBeforeUnknown, f.session.project.revision), afterUnknown)
    const failedUnkStrip2 = stripRequests.at(-1)
    assert.equal(failedUnkStrip2.y, 836)
    const revAfterCommitBeforeReplay = f.docs.get(docId).revision
    assert.equal(revAfterCommitBeforeReplay, revBeforeUnknown + 2, 'both strips committed in store before lost ACK')
    assert.deepEqual(await f.pixels(docId), [...afterUnknown], 'strip 2 pixels already committed in store before lost-ACK replay')
    assert.equal(f.session.history.undo.length, undoCountBeforeUnknown + 1, 'one Undo entry exists for the partial stroke after strip 1')
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    assert.equal(stripRequests.at(-1).opId, failedUnkStrip2.opId, 'replay reuses exact strip-2 operationId')
    assert.equal(stripRequests.at(-1).bytesSha, failedUnkStrip2.bytesSha, 'replay reuses exact strip-2 body bytes')
    assert.equal(f.docs.get(docId).revision, revAfterCommitBeforeReplay, 'replay returns cached receipt without incrementing revision again')
    assert.equal(f.session.history.undo.length, undoCountBeforeUnknown + 1, 'replay updates the single Undo entry without pushing a duplicate')
    assert.equal(f.session.manualWrite, null)
    assert.deepEqual(await f.pixels(docId), [...afterUnknown])
    await f.key({ key: 'z', ctrlKey: true })
    assert.deepEqual(await f.pixels(docId), [...afterPartial], 'single-step Undo after replayed 2-strip stroke restores exact pre-stroke pixels')
    await f.key({ key: 'z', ctrlKey: true, shiftKey: true })
    assert.deepEqual(await f.pixels(docId), [...afterUnknown], 'single-step Redo after replayed 2-strip stroke restores exact full-stroke pixels')
  } finally {
    f.harness.restore()
  }
})

test('reviewExternalPixels guards async initial GET and post-save checkCurrent GET across project switch so project B status and pixels are never overwritten', async () => {
  const f = await selectionSessionFixture({ width: 64, height: 64 })
  const priorFetch = globalThis.fetch
  const priorImageData = globalThis.ImageData
  const priorCreateElement = globalThis.document.createElement
  globalThis.ImageData = class {
    constructor(data, width, height) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
  globalThis.document.createElement = (tag) => {
    const node = priorCreateElement(tag)
    if (String(tag).toLowerCase() === 'canvas') {
      node.getContext = () => ({
        putImageData() {},
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      })
    }
    return node
  }
  try {
    const { session, harness, api } = f
    const statusNode = harness.byId.get('vnext-canvas-status')
    const confirmDialog = harness.byId.get('vnext-confirm-dialog')
    const projectB = {
      id: 'proj_b',
      version: 'editor_project_v1',
      revision: 1,
      canvases: { cb: { id: 'cb', document_id: 'doc_b', x: 0, y: 0 } },
      sprite_documents: { doc_b: { working_revision: 1 } },
    }
    const bytesB = new Uint8Array(64 * 64 * 4).fill(77)
    for (let i = 3; i < bytesB.length; i += 4) bytesB[i] = 255
    const shaB = await sha256Hex(bytesB)
    f.blocks.set(shaB, bytesB)
    f.docs.set('doc_b', {
      document_id: 'doc_b',
      name: 'B',
      revision: 1,
      canvas: { w: 64, h: 64 },
      frame_order: ['f'],
      layer_order: ['l'],
      frames: { f: { duration_ms: 100 } },
      layers: { l: { name: 'Layer', locked: false } },
      cels: { c: { frame_id: 'f', layer_id: 'l', block: { w: 64, h: 64, sha256: shaB } } },
    })

    const sessionId = '11111111-1111-4111-8111-111111111111'
    const link = { projectId: 'sel_project', sessionId }
    const candRgba = new Uint8Array(64 * 64 * 4).fill(210)
    for (let i = 3; i < candRgba.length; i += 4) candRgba[i] = 255
    const candSha = await sha256Hex(candRgba)
    const candHex = Buffer.from(candRgba).toString('hex')

    const makeExternalPayload = (canvasId, docId, projRev, workRev, sourceSha, sha = candSha) => ({
      session_id: sessionId,
      saved: false,
      context: {
        project_id: 'sel_project',
        canvas_id: canvasId,
        document_id: docId,
        project_revision: projRev,
        working_revision: workRev,
      },
      pixel_candidate: {
        width: 64,
        height: 64,
        rgba_hex: candHex,
        source_sha256: sourceSha,
        sha256: sha,
        drawing_batches: 1,
        tool_calls: 2,
      },
    })

    // 1a. Switch to project B while initial readExternalPixels GET is in flight (then resolves)
    session.project = null
    let releaseFetch1
    globalThis.fetch = async () => {
      await new Promise((resolve) => { releaseFetch1 = resolve })
      return jsonResponse(200, makeExternalPayload('old', 'doc_old', f.project.revision, 1, f.firstSha))
    }
    const p1 = session.reviewExternalPixels(link)
    await new Promise((r) => setTimeout(r, 5))
    await session.reloadProject(projectB)
    statusNode.textContent = 'Loaded Project B'
    releaseFetch1()
    await p1
    assert.equal(session.project.id, 'proj_b')
    assert.equal(statusNode.textContent, 'Loaded Project B', 'project B status is untouched when delayed initial GET resolves')
    assert.equal(confirmDialog.hidden, true, 'candidate confirm dialog does not open on project B')

    // 1b. Switch to project B while initial readExternalPixels GET is in flight (then rejects with 404)
    session.project = null
    let releaseFetch2
    globalThis.fetch = async () => {
      await new Promise((resolve) => { releaseFetch2 = resolve })
      return jsonResponse(404, { error: 'expired' })
    }
    const p2 = session.reviewExternalPixels(link)
    await new Promise((r) => setTimeout(r, 5))
    await session.reloadProject(projectB)
    statusNode.textContent = 'Loaded Project B Ready'
    releaseFetch2()
    await p2
    assert.equal(session.project.id, 'proj_b')
    assert.equal(statusNode.textContent, 'Loaded Project B Ready', 'project B status is untouched when delayed initial GET rejects')

    // 2. Open external candidate on project A's working copy, click Save drawing, and switch to project B while post-save checkCurrent GET is in flight
    const derived = await f.api.deriveWorking(f.project.id, { operationId: 'derive_ext' })
    const newSha = f.docs.get('doc_new').cels.c.block.sha256
    const projARev = derived.project.revision
    const workARev = f.docs.get('doc_new').revision

    let fetchCount = 0
    let releasePostSaveCheck
    let postSaveMode = 'stale_hash'
    globalThis.fetch = async () => {
      fetchCount += 1
      if (fetchCount === 1 || fetchCount === 3) {
        return jsonResponse(200, makeExternalPayload('new', 'doc_new', projARev, workARev, newSha))
      }
      await new Promise((resolve) => { releasePostSaveCheck = resolve })
      if (postSaveMode === 'http_error') {
        return jsonResponse(404, { error: 'expired' })
      }
      return jsonResponse(200, makeExternalPayload('new', 'doc_new', projARev, workARev, newSha, 'f'.repeat(64)))
    }

    session.project = null
    const pOpen1 = session.reviewExternalPixels(link)
    for (let i = 0; i < 50 && confirmDialog.hidden; i += 1) await new Promise((r) => setTimeout(r, 2))
    assert.equal(confirmDialog.hidden, false, 'Preview external drawing confirm dialog opened')

    // Click Save drawing (vnext-confirm-primary) -> triggers checkCurrent() GET which awaits releasePostSaveCheck
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((r) => setTimeout(r, 5))
    await session.reloadProject(projectB)
    statusNode.textContent = 'Project B Active'
    releasePostSaveCheck()
    await pOpen1
    assert.equal(session.project.id, 'proj_b')
    assert.equal(statusNode.textContent, 'Project B Active', 'project B status is NOT overwritten when project A post-save checkCurrent resolves')
    assert.equal(f.docs.get('doc_b').cels.c.block.sha256, shaB, 'project B block hash is untouched')
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, newSha, 'project A working copy was not written after switching away')

    // Repeat with post-save checkCurrent rejecting (404) after switching to project B
    session.project = null
    postSaveMode = 'http_error'
    const pOpen2 = session.reviewExternalPixels(link)
    for (let i = 0; i < 50 && confirmDialog.hidden; i += 1) await new Promise((r) => setTimeout(r, 2))
    assert.equal(confirmDialog.hidden, false)
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise((r) => setTimeout(r, 5))
    await session.reloadProject(projectB)
    statusNode.textContent = 'Project B Still Active'
    releasePostSaveCheck()
    await pOpen2
    assert.equal(session.project.id, 'proj_b')
    assert.equal(statusNode.textContent, 'Project B Still Active', 'project B status is NOT overwritten when project A post-save checkCurrent rejects')
    assert.equal(f.docs.get('doc_b').cels.c.block.sha256, shaB)
  } finally {
    globalThis.fetch = priorFetch
    globalThis.ImageData = priorImageData
    globalThis.document.createElement = priorCreateElement
    f.harness.restore()
  }
})

test('general-sequence canvas edits in place without auto-creating Sequence · copy, supports explicit Duplicate canvas, and keeps AI candidate edits isolated on a copy', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 4, height: 4 })
  const restoreCanvas = stubSessionCanvas()
  try {
    const { session, harness, api } = f
    f.project.assets = {
      asset_seq: {
        id: 'asset_seq',
        revisions: {
          rev_seq: {
            id: 'rev_seq',
            artifacts: {
              image: 'workspace/projects/sel_project/assets/asset_seq/revisions/rev_seq/image.png',
              sequence: 'workspace/projects/sel_project/assets/asset_seq/revisions/rev_seq/sequence.json',
            },
          },
        },
      },
    }
    const frame2Bytes = new Uint8Array(4 * 4 * 4).fill(50)
    for (let i = 3; i < frame2Bytes.length; i += 4) frame2Bytes[i] = 255
    const frame2Sha = await sha256Hex(frame2Bytes)
    f.blocks.set(frame2Sha, frame2Bytes)
    const seqDoc = {
      document_id: 'doc_old',
      project_id: 'sel_project',
      name: 'Sequence',
      revision: 1,
      parent_revision: null,
      derived_from: null,
      source_ref: {
        asset_id: 'asset_seq',
        revision_id: 'rev_seq',
        artifact: 'image',
        expected_sha256: f.firstSha,
      },
      canvas: { w: 4, h: 4 },
      frame_order: ['f', 'f2'],
      layer_order: ['l'],
      frames: {
        f: { id: 'f', duration_ms: 125 },
        f2: { id: 'f2', duration_ms: 125 },
      },
      layers: {
        l: { id: 'l', name: 'Layer 1', kind: 'raster', visible: true, locked: false },
      },
      cels: {
        c: { id: 'c', frame_id: 'f', layer_id: 'l', block: { w: 4, h: 4, sha256: f.firstSha } },
        c2: { id: 'c2', frame_id: 'f2', layer_id: 'l', block: { w: 4, h: 4, sha256: frame2Sha } },
      },
    }
    f.docs.set('doc_old', seqDoc)

    const origFrame1Bytes = new Uint8Array(f.blocks.get(f.firstSha))
    const origFrame2Bytes = new Uint8Array(frame2Bytes)
    const pixelWriteLog = []
    let deriveCount = 0
    api.deriveWorking = async (_projectId, req) => {
      deriveCount += 1
      f.calls.push('derive')
      const srcDoc = structuredClone(f.docs.get(req.sourceDocumentId))
      assert.ok(srcDoc, `deriveWorking sourceDocumentId must exist: ${req.sourceDocumentId}`)
      assert.equal(srcDoc.revision, req.sourceRevision, 'deriveWorking sourceRevision must match current source document revision')
      const newDocId = `doc_copy_${deriveCount}`
      const newCanvasId = `canvas_copy_${deriveCount}`
      const derivedDoc = {
        ...structuredClone(srcDoc),
        document_id: newDocId,
        name: req.name || `${srcDoc.name} · copy`,
        revision: 1,
        parent_revision: null,
        derived_from: {
          document_id: srcDoc.document_id,
          revision: srcDoc.revision,
          manifest_sha256: f.firstSha,
        },
      }
      f.docs.set(newDocId, derivedDoc)
      const canvas = { id: newCanvasId, document_id: newDocId, x: 20 * deriveCount, y: 0 }
      f.project.revision += 1
      f.project.canvases[newCanvasId] = canvas
      f.project.sprite_documents[newDocId] = { working_revision: 1 }
      return {
        project: structuredClone(f.project),
        canvas: structuredClone(canvas),
        document: structuredClone(derivedDoc),
        receipt: {
          operation_id: req.operationId,
          project_id: f.project.id,
          project_revision: f.project.revision,
          document_id: newDocId,
          document_revision: 1,
        },
      }
    }
    api.writeWorkingPixels = async (_projectId, docId, body) => {
      f.calls.push(`pixels:${docId}`)
      const current = structuredClone(f.docs.get(docId))
      assert.ok(body.target && typeof body.target === 'object', 'writeWorkingPixels request must carry body.target')
      const celId = body.target.cel_id
      assert.equal(typeof celId, 'string', 'body.target.cel_id must be a string')
      assert.ok(current.cels[celId], `target cel ${celId} must exist on ${docId}`)
      assert.equal(current.cels[celId].frame_id, body.target.frame_id, 'target.frame_id must match cel frame_id')
      assert.equal(current.cels[celId].layer_id, body.target.layer_id, 'target.layer_id must match cel layer_id')
      const bx = body.x ?? 0
      const by = body.y ?? 0
      pixelWriteLog.push({
        docId,
        target: structuredClone(body.target),
        x: bx,
        y: by,
        width: body.width,
        height: body.height,
      })
      const full = new Uint8Array(f.blocks.get(current.cels[celId].block.sha256))
      for (let row = 0; row < body.height; row += 1) {
        full.set(
          body.bytes.subarray(row * body.width * 4, (row + 1) * body.width * 4),
          ((by + row) * 4 + bx) * 4,
        )
      }
      const nextSha = await sha256Hex(full)
      f.blocks.set(nextSha, full)
      current.revision += 1
      current.cels[celId].block = { w: 4, h: 4, sha256: nextSha }
      f.docs.set(docId, current)
      f.project.revision += 1
      f.project.sprite_documents[docId] = { working_revision: current.revision }
      return {
        project: structuredClone(f.project),
        document: structuredClone(current),
        receipt: {
          operation_id: body.operationId,
          project_id: 'sel_project',
          project_revision: f.project.revision,
          document_id: docId,
          document_revision: current.revision,
        },
      }
    }
    api.changeStructure = async (_projectId, docId, req) => {
      f.calls.push(`structure:${docId}`)
      f.project.revision += 1
      const current = structuredClone(f.docs.get(docId))
      current.revision += 1
      if (req.command.type === 'add-layer') {
        current.layer_order.unshift('l2')
        current.layers.l2 = { id: 'l2', name: req.command.name, kind: 'raster', visible: true, locked: false }
        current.cels.c_f_l2 = { id: 'c_f_l2', frame_id: 'f', layer_id: 'l2', block: null }
        current.cels.c_f2_l2 = { id: 'c_f2_l2', frame_id: 'f2', layer_id: 'l2', block: null }
      }
      f.project.sprite_documents[docId].working_revision = current.revision
      f.docs.set(docId, current)
      return {
        project: structuredClone(f.project),
        document: structuredClone(current),
        receipt: {
          operation_id: req.operationId,
          project_id: 'sel_project',
          project_revision: f.project.revision,
          document_id: docId,
          document_revision: current.revision,
        },
      }
    }

    let activeTarget = { frame_id: 'f', layer_id: 'l', cel_id: 'c' }
    session.documentTimeline = {
      render() { return false },
      stop() {},
      target: () => activeTarget,
    }
    await session.reloadProject(f.project)
    session.view.select('old')
    session.conversationRef = { projectId: f.project.id, canvasId: 'old', documentId: 'doc_old' }
    session.renderCanvas()

    const infoBefore = session.pixelTargetInfo()
    assert.equal(infoBefore.sequence, true, 'pixelTargetInfo identifies general-sequence canvas')
    assert.equal(infoBefore.derived, false)
    assert.equal(infoBefore.blank, false)

    // 1. Manual stroke on frame 1 (f/c) saves in place on 'old' / 'doc_old' without calling deriveWorking
    const source1 = await session.preparePixelEdit({ scopeGrant: false })
    const strokeBytes = new Uint8Array(source1.rgba)
    strokeBytes[0] = 250
    strokeBytes[1] = 10
    strokeBytes[2] = 20
    strokeBytes[3] = 255
    const strokeRes = await session.savePixelStroke(source1, strokeBytes)
    assert.equal(strokeRes.saved, true)
    assert.equal(deriveCount, 0, 'manual stroke on general-sequence must NOT call deriveWorking')
    assert.equal(Object.keys(session.project.canvases).length, 1, 'canvas count remains 1 after manual stroke')
    assert.equal(session.view.selectedId, 'old', 'selected canvas stays on current canvas')
    const docAfterFrame1 = session.documents.get('doc_old')
    assert.equal(docAfterFrame1.revision, 2, 'working_revision advances in place on doc_old')
    assert.equal(docAfterFrame1.derived_from, null, 'in-place edit preserves non-derived identity')
    assert.deepEqual(pixelWriteLog[0].target, { frame_id: 'f', layer_id: 'l', cel_id: 'c' })
    const frame1EditedSha = docAfterFrame1.cels.c.block.sha256
    assert.notEqual(frame1EditedSha, f.firstSha, 'frame 1 cel block sha256 updated')
    assert.deepEqual([...f.blocks.get(frame1EditedSha).slice(0, 4)], [250, 10, 20, 255], 'frame 1 target pixel (0,0) updated')
    assert.equal(docAfterFrame1.cels.c2.block.sha256, frame2Sha, 'non-target frame 2 cel block is untouched by frame 1 edit')

    // 1b. Manual stroke on frame 2 (f2/c2) edits c2 in place while preserving frame 1 (c)
    activeTarget = { frame_id: 'f2', layer_id: 'l', cel_id: 'c2' }
    const sourceFrame2 = await session.preparePixelEdit({ scopeGrant: false })
    const strokeBytes2 = new Uint8Array(sourceFrame2.rgba)
    strokeBytes2[0] = 15
    strokeBytes2[1] = 240
    strokeBytes2[2] = 30
    strokeBytes2[3] = 255
    const strokeRes2 = await session.savePixelStroke(sourceFrame2, strokeBytes2)
    assert.equal(strokeRes2.saved, true)
    assert.equal(deriveCount, 0, 'second frame manual stroke also edits in place without deriveWorking')
    const docAfterFrame2 = session.documents.get('doc_old')
    assert.equal(docAfterFrame2.revision, 3)
    assert.deepEqual(pixelWriteLog[1].target, { frame_id: 'f2', layer_id: 'l', cel_id: 'c2' })
    const frame2EditedSha = docAfterFrame2.cels.c2.block.sha256
    assert.notEqual(frame2EditedSha, frame2Sha, 'frame 2 cel block sha256 updated')
    assert.deepEqual([...f.blocks.get(frame2EditedSha).slice(0, 4)], [15, 240, 30, 255], 'frame 2 target pixel (0,0) updated')
    assert.equal(docAfterFrame2.cels.c.block.sha256, frame1EditedSha, 'non-target frame 1 cel block remains at frame1EditedSha')

    // 2. Timeline structure command (add-layer) also edits in place without calling deriveWorking
    const structRes = await session.changeStructure({ type: 'add-layer', name: 'Highlights' })
    assert.equal(structRes.ok, true)
    assert.equal(deriveCount, 0, 'structure command on general-sequence must NOT call deriveWorking')
    assert.equal(Object.keys(session.project.canvases).length, 1)
    assert.equal(session.documents.get('doc_old').revision, 4)
    assert.deepEqual(session.documents.get('doc_old').layer_order, ['l2', 'l'])

    // 3. Explicit Duplicate canvas creates 'Sequence · copy' beside 'old' with full 2-frame × 2-layer structure and selects it
    const dupBtn = harness.byId.get('vnext-duplicate-canvas')
    assert.equal(dupBtn.disabled, false, 'Duplicate canvas menu button is enabled when a saved canvas is selected')
    await harness.menu.dispatchEvent({ type: 'click', target: dupBtn })
    while (session.manualWrite || session.pendingImport) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.equal(deriveCount, 1, 'explicit Duplicate canvas calls deriveWorking once')
    assert.equal(Object.keys(session.project.canvases).length, 2, 'explicit Duplicate canvas adds second canvas')
    assert.equal(session.view.selectedId, 'canvas_copy_1', 'explicit Duplicate canvas selects the new copy')
    const dupDoc = session.documents.get('doc_copy_1')
    assert.ok(dupDoc, 'duplicated document doc_copy_1 loaded in session')
    assert.deepEqual(dupDoc.derived_from, {
      document_id: 'doc_old',
      revision: 4,
      manifest_sha256: f.firstSha,
    })
    assert.deepEqual(dupDoc.frame_order, ['f', 'f2'], 'duplicated copy preserves full frame_order')
    assert.deepEqual(dupDoc.layer_order, ['l2', 'l'], 'duplicated copy preserves full layer_order')
    assert.equal(dupDoc.cels.c.block.sha256, frame1EditedSha, 'duplicated copy preserves frame 1 edited block')
    assert.equal(dupDoc.cels.c2.block.sha256, frame2EditedSha, 'duplicated copy preserves frame 2 edited block')
    assert.ok('c_f_l2' in dupDoc.cels && 'c_f2_l2' in dupDoc.cels, 'duplicated copy preserves added layer cels across all frames')

    // 4. Select original general-sequence canvas 'old' again: AI/native candidate edit (allowBlank: false) isolates onto a 2nd copy without mutating 'doc_old' or 'doc_copy_1'
    session.view.select('old')
    session.conversationRef = { projectId: f.project.id, canvasId: 'old', documentId: 'doc_old' }
    activeTarget = { frame_id: 'f2', layer_id: 'l', cel_id: 'c2' }
    const sourceForAi = await session.preparePixelEdit({ scopeGrant: false })
    const aiBytes = new Uint8Array(sourceForAi.rgba)
    aiBytes[4] = 99
    await session.savePixelStroke(sourceForAi, aiBytes, { allowBlank: false })
    assert.equal(deriveCount, 2, 'AI candidate edit with allowBlank: false still creates an isolated derived copy')
    assert.equal(Object.keys(session.project.canvases).length, 3, 'AI candidate edit adds isolated 3rd canvas')
    assert.equal(pixelWriteLog[2].docId, 'doc_copy_2', 'AI pixel write targets the isolated copy doc_copy_2')
    assert.deepEqual(pixelWriteLog[2].target, { frame_id: 'f2', layer_id: 'l', cel_id: 'c2' })
    const aiCopyDoc = f.docs.get('doc_copy_2')
    assert.equal(f.blocks.get(aiCopyDoc.cels.c2.block.sha256)[4], 99, 'AI pixel change applied on doc_copy_2 c2')
    assert.equal(f.docs.get('doc_old').revision, 4, 'original sequence document revision untouched by AI copy edit')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, frame1EditedSha, 'original sequence frame 1 untouched by AI copy edit')
    assert.equal(f.docs.get('doc_old').cels.c2.block.sha256, frame2EditedSha, 'original sequence frame 2 untouched by AI copy edit')
    assert.equal(f.docs.get('doc_copy_1').cels.c2.block.sha256, frame2EditedSha, 'first explicit copy untouched by AI copy edit')
    assert.deepEqual(f.blocks.get(f.firstSha), origFrame1Bytes, 'retained original frame 1 block bytes untouched')
    assert.deepEqual(f.blocks.get(frame2Sha), origFrame2Bytes, 'retained original frame 2 block bytes untouched')
  } finally {
    restoreCanvas()
    f.harness.restore()
  }
})

test('listProjects client and projectListViewModel merge >256 projects (294 projects across cursor pages) and include p0eff76c5a5e9a925', async () => {
  const f = await selectionSessionFixture({ width: 4, height: 4 })
  const priorFetch = globalThis.fetch
  try {
    const { session, harness } = f
    const allProjects = []
    for (let i = 0; i < 293; i += 1) {
      const id = `proj_${String(i).padStart(4, '0')}`
      allProjects.push({
        id,
        name: `Project ${i}`,
        version: 'editor_project_v1',
        revision: 1,
        updated_at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      })
    }
    allProjects.push({
      id: 'p0eff76c5a5e9a925',
      name: 'Fire Magma Sequence Trial',
      version: 'editor_project_v1',
      revision: 12,
      updated_at: '2026-10-14T10:00:00.000Z',
    })
    const page1Projects = allProjects.slice(0, 256)
    const page2Projects = allProjects.slice(256)
    const requestedUrls = []
    globalThis.fetch = async (url) => {
      const urlStr = String(url)
      requestedUrls.push(urlStr)
      if (urlStr === '/api/editor/projects') {
        return jsonResponse(200, {
          projects: page1Projects,
          omitted_count: 0,
          has_more: true,
          next_cursor: page1Projects.at(-1).id,
        })
      }
      if (urlStr === `/api/editor/projects?cursor=${encodeURIComponent(page1Projects.at(-1).id)}`) {
        return jsonResponse(200, {
          projects: page2Projects,
          omitted_count: 0,
          has_more: false,
          next_cursor: null,
        })
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`)
    }
    const client = createVnextProjectClient()
    const listed = await client.listProjects()
    assert.equal(listed.ok, true)
    assert.equal(listed.projects.length, 294, 'client merges both cursor pages to return all 294 projects')
    assert.equal(listed.projects[0].id, 'p0eff76c5a5e9a925', 'newest project p0eff76c5a5e9a925 sorts first')
    assert.deepEqual(requestedUrls, [
      '/api/editor/projects',
      `/api/editor/projects?cursor=${encodeURIComponent(page1Projects.at(-1).id)}`,
    ])

    const model = projectListViewModel({
      status: 'ready',
      projects: listed.projects,
      omitted_count: listed.omitted_count,
      has_more: listed.has_more,
    })
    assert.equal(model.countText, '294 projects in this workspace')
    assert.equal(model.filtered.some((p) => p.id === 'p0eff76c5a5e9a925'), true)
    assert.ok(session && harness)
  } finally {
    globalThis.fetch = priorFetch
    f.harness.restore()
  }
})

test('N1 regional reviewNativePixelCandidate rejects out-of-scope pixels and writes a requested regional result directly as a scoped patch with Undo/Redo', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64 })
  const restoreCanvas = stubSessionCanvas()
  try {
    const { session, harness } = f
    const derived = await f.api.deriveWorking(f.project.id, { operationId: 'derive_n1_region' })
    await session.reloadProject(derived.project)
    session.selectCanvas('new')
    const region = { x: 4, y: 6, w: 3, h: 2 }
    session.pixelSelection = { projectId: f.project.id, canvasId: 'new', rect: { ...region } }

    const source = await session.preparePixelEdit({
      scopeGrant: true,
      allowedOperations: ['read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels', 'pixel_tools'],
    })
    assert.deepEqual(source.allowedRect, region)
    assert.ok(source.grantId)

    const sourceSha = await sha256Hex(source.rgba)
    // 1. Out-of-scope modification at (0, 0) is rejected before confirm dialog opens
    const tampered = source.rgba.slice()
    tampered[0] = 250; tampered[1] = 10; tampered[2] = 20; tampered[3] = 255
    const tamperedSha = await sha256Hex(tampered)
    await assert.rejects(
      session.reviewNativePixelCandidate(source, tampered, {
        source_sha256: sourceSha,
        sha256: tamperedSha,
        drawing_batches: 1,
        allowed_rect: region,
      }),
      { code: 'assistant_context_changed' },
    )

    // 2. A valid regional candidate inside (4, 6, 3x2) is the requested result: it is written
    //    directly as a scoped patch, without a modal or in-chat decision, and reports its outcome.
    const valid = source.rgba.slice()
    const idx = (6 * 64 + 4) * 4
    valid[idx] = 240; valid[idx + 1] = 80; valid[idx + 2] = 20; valid[idx + 3] = 255
    const validSha = await sha256Hex(valid)
    const candidateMeta = {
      source_sha256: sourceSha,
      sha256: validSha,
      drawing_batches: 1,
      allowed_rect: region,
    }
    const confirmDialog = harness.byId.get('vnext-confirm-dialog')
    let checked = 0
    const result = await session.reviewNativePixelCandidate(source, valid, candidateMeta, { checkCurrent: async () => { checked++ } })
    assert.equal(confirmDialog.hidden, true, 'no Preview Astra drawing modal')
    assert.equal(checked, 1, 'target and revision are re-checked right before the write')
    assert.equal(result.outcome, 'saved')
    assert.equal(result.writable, true)
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, validSha, 'the regional candidate pixels were written')

    // Undo and Redo restore exact working pixels
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, sourceSha, 'Undo restored pre-patch pixels')
    await f.key({ key: 'z', ctrlKey: true, shiftKey: true })
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, validSha, 'Redo re-applied regional patch pixels')
  } finally {
    restoreCanvas()
    f.harness.restore()
  }
})

for (const writable of [false, true]) for (const failure of ['unknown', 'refresh']) {
  test(`N1 inline recovery keeps ${writable ? 'working canvas' : 'copy'} ${failure} recovery out of modals and reuses the saved request`, async () => {
    const f = await selectionSessionFixture({ boot: true, width: 64, height: 64 })
    const restoreCanvas = stubSessionCanvas()
    try {
      if (writable) {
        const derived = await f.api.deriveWorking(f.project.id, { operationId: 'initial_derive' })
        await f.session.reloadProject(derived.project)
        f.session.selectCanvas('new')
      }
      const source = await f.session.preparePixelEdit()
      const rgba = source.rgba.slice(); rgba[0] = 250
      const candidate = { source_sha256: await sha256Hex(source.rgba), sha256: await sha256Hex(rgba), drawing_batches: 1 }
      const baseWrite = f.api.writeWorkingPixels, baseGet = f.api.getProject
      const requests = [], cached = new Map()
      let fail = true, notice
      f.api.writeWorkingPixels = async (...args) => {
        const request = args[2]; requests.push(request)
        const saved = cached.get(request.operationId) || await baseWrite(args[0], args[1], { x: 0, y: 0, ...request })
        cached.set(request.operationId, saved)
        if (failure === 'unknown' && fail) { fail = false; throw Object.assign(new Error('lost acknowledgement'), { kind: 'unknown' }) }
        return saved
      }
      f.api.getProject = async (...args) => {
        if (failure === 'refresh' && fail && cached.size) { fail = false; throw new Error('refresh unavailable') }
        return baseGet(...args)
      }
      const message = await f.session.reviewNativePixelCandidate(source, rgba, candidate, {
        saveOperationId: 'n1_recovery_request',
        renderRecovery: value => { notice = value },
      })
      assert.ok(notice, JSON.stringify(message))
      assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, true, 'real writer recovery stays inline')
      assert.ok(f.session.manualWrite || f.session.pixelCopyPending, 'unknown/display outcome keeps the original write lock')
      const revision = f.docs.get('doc_new').revision
      const recovered = await notice.onPrimary()
      assert.equal(recovered.pending, false)
      assert.match(recovered.message, /saved on this canvas|beside the original/)
      assert.equal(f.session.manualWrite || f.session.pixelCopyPending || false, false)
      assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, true)
      assert.equal(f.docs.get('doc_new').cels.c.block.sha256, candidate.sha256)
      assert.equal(f.docs.get('doc_new').revision, revision, 'recovery does not commit another pixel revision')
      assert.equal(f.session.history.undo.length, 1, 'the recovered change has one Undo entry')
      assert.equal(f.calls.filter(call => call === 'derive').length, 1, 'copy is derived once')
      if (failure === 'unknown') {
        assert.equal(requests.length, 2)
        assert.equal(requests[0].operationId, requests[1].operationId, 'retry uses the same operation ID')
        assert.deepEqual(requests[0].bytes, requests[1].bytes, 'retry uses the same frozen pixel bytes')
      } else assert.equal(requests.length, 1, 'refresh retry performs no second write')
      assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'original pixels are preserved')
    } finally { restoreCanvas(); f.harness.restore() }
  })
}

test('sequence dialog imports GIF and Video into timeline as new sequence canvases, locks commit when video params change until re-previewed, recovers unknown commit, and isolates project switches', async () => {
  const harness = createSessionHarness()
  const priorImage = globalThis.Image
  const priorCreateElement = globalThis.document.createElement
  globalThis.Image = class {
    constructor() { this.complete = true }
    addEventListener() {}
    removeAttribute() {}
  }
  globalThis.document.createElement = (tag) => {
    const node = priorCreateElement(tag)
    node.getContext = () => ({
      imageSmoothingEnabled: true,
      clearRect() {},
      drawImage() {},
      fillRect() {},
      putImageData() {},
    })
    return node
  }
  const makeSeqNode = (id, extra = {}) => {
    const node = document.createElement(extra.tagName || 'div')
    node.id = id
    if (extra.hidden !== undefined) node.hidden = extra.hidden
    if (extra.value !== undefined) node.value = extra.value
    harness.byId.set(id, node)
    return node
  }
  const seqDialog = makeSeqNode('vnext-sequence-dialog', { hidden: false })
  const seqInput = makeSeqNode('vnext-sequence-input', { tagName: 'INPUT' })
  const seqFileLabel = makeSeqNode('vnext-sequence-file-label', { hidden: true })
  const seqFileHint = makeSeqNode('vnext-sequence-file-hint', { hidden: false })
  const seqFrames = makeSeqNode('vnext-sequence-frames', { hidden: true })
  const seqStatus = makeSeqNode('vnext-sequence-status', { hidden: true })
  const seqError = makeSeqNode('vnext-sequence-error', { hidden: true })
  const seqImport = makeSeqNode('vnext-sequence-import', { tagName: 'BUTTON' })
  const seqChoose = makeSeqNode('vnext-sequence-choose', { tagName: 'BUTTON' })
  const seqCancel = makeSeqNode('vnext-sequence-cancel', { tagName: 'BUTTON' })
  makeSeqNode('vnext-sequence-keep-all', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-sequence-apply-auto', { tagName: 'BUTTON', hidden: true })
  const seqStop = makeSeqNode('vnext-sequence-stop', { tagName: 'BUTTON', hidden: true })
  makeSeqNode('vnext-general-background', { tagName: 'SELECT', value: 'auto' })
  const motionControls = makeSeqNode('vnext-motion-video-controls', { hidden: true })
  makeSeqNode('vnext-motion-video-player', { tagName: 'VIDEO' })
  const motionStart = makeSeqNode('vnext-motion-start', { tagName: 'INPUT', value: '0' })
  const motionEnd = makeSeqNode('vnext-motion-end', { tagName: 'INPUT', value: '2.0' })
  const motionMode = makeSeqNode('vnext-motion-mode', { tagName: 'SELECT', value: 'fps' })
  const motionFpsWrap = makeSeqNode('vnext-motion-fps-wrap', { hidden: false })
  const motionFps = makeSeqNode('vnext-motion-fps', { tagName: 'INPUT', value: '12' })
  const motionStrideWrap = makeSeqNode('vnext-motion-stride-wrap', { hidden: true })
  const motionStride = makeSeqNode('vnext-motion-stride', { tagName: 'INPUT', value: '1' })
  const motionPreviewBtn = makeSeqNode('vnext-motion-preview-btn', { tagName: 'BUTTON' })
  const motionPreviewState = makeSeqNode('vnext-motion-preview-state', { hidden: true })
  const motionStage = makeSeqNode('vnext-motion-preview-stage', { hidden: true })
  makeSeqNode('vnext-motion-preview-canvas', { tagName: 'CANVAS' })
  const motionMeta = makeSeqNode('vnext-motion-preview-meta')

  const motionRequests = []
  const deferredVideoPreviews = []
  let deferVideoPreviewStride = null
  let failVidCommitOnce = true
  let currentProject = {
    id: 'proj_a',
    revision: 4,
    canvases: {
      canvas_a: { id: 'canvas_a', document_id: 'doc_a', x: 10, y: 20 },
    },
    sprite_documents: {
      doc_a: { working_revision: 1 },
    },
  }

  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      const path = String(url)
      if (path.includes('/sprite-documents/motion-import')) {
        const parsed = new URL(path, 'http://localhost')
        const action = parsed.searchParams.get('action')
        const kind = parsed.searchParams.get('kind')
        const opId = parsed.searchParams.get('operation_id')
        motionRequests.push({
          action,
          kind,
          opId,
          start_sec: parsed.searchParams.get('start_sec'),
          end_sec: parsed.searchParams.get('end_sec'),
          sampling_mode: parsed.searchParams.get('sampling_mode'),
          fps: parsed.searchParams.get('fps'),
          stride: parsed.searchParams.get('stride'),
          bodyLen: init.body?.byteLength ?? 0,
          signal: init.signal || null,
        })
        if (action === 'preview' && kind === 'gif') {
          return jsonResponse(200, {
            preview: true,
            kind: 'gif',
            width: 16,
            height: 16,
            frame_count: 2,
            total_duration_ms: 240,
            frames: [
              { index: 0, width: 16, height: 16, duration_ms: 80, timestamp_ms: 0, png_base64: Buffer.from(PNG_1X1).toString('base64') },
              { index: 1, width: 16, height: 16, duration_ms: 160, timestamp_ms: 80, png_base64: Buffer.from(PNG_1X1).toString('base64') },
            ],
          })
        }
        if (action === 'commit' && kind === 'gif') {
          currentProject = {
            ...currentProject,
            revision: currentProject.revision + 1,
            canvases: {
              ...currentProject.canvases,
              canvas_gif: { id: 'canvas_gif', document_id: 'doc_gif', x: 0, y: 0 },
            },
            sprite_documents: {
              ...currentProject.sprite_documents,
              doc_gif: { working_revision: 1 },
            },
          }
          return jsonResponse(201, {
            project: currentProject,
            document: { document_id: 'doc_gif', revision: 1, canvas: { w: 16, h: 16 }, frame_order: ['f1', 'f2'] },
            canvas: currentProject.canvases.canvas_gif,
            receipt: { operation_id: opId, project_id: 'proj_a', project_revision: currentProject.revision, document_id: 'doc_gif', document_revision: 1 },
          })
        }
        if (action === 'probe' && kind === 'video') {
          return jsonResponse(200, {
            probe: true,
            kind: 'video',
            width: 32,
            height: 24,
            duration_sec: 2.5,
            source_fps: 24,
            default_sampling: {
              start_sec: 0,
              end_sec: 1.2,
              sampling_mode: 'fps',
              fps: 10,
              stride: 2,
            },
          })
        }
        if (action === 'preview' && kind === 'video') {
          const mode = parsed.searchParams.get('sampling_mode') || 'fps'
          const strideVal = Number(parsed.searchParams.get('stride') || 2)
          const durMs = mode === 'stride' ? Math.round((strideVal / 24) * 1000) : 100
          const buildPreviewResponse = () => jsonResponse(200, {
            preview: true,
            kind: 'video',
            width: 32,
            height: 24,
            frame_count: 3,
            total_duration_ms: durMs * 3,
            sampling: {
              start_sec: Number(parsed.searchParams.get('start_sec') || 0),
              end_sec: Number(parsed.searchParams.get('end_sec') || 1.2),
              sampling_mode: mode,
              fps: mode === 'fps' ? Number(parsed.searchParams.get('fps') || 10) : null,
              stride: mode === 'stride' ? strideVal : null,
            },
            frames: [
              { index: 0, width: 32, height: 24, duration_ms: durMs, timestamp_ms: 0, png_base64: Buffer.from(PNG_1X1).toString('base64') },
              { index: 1, width: 32, height: 24, duration_ms: durMs, timestamp_ms: durMs, png_base64: Buffer.from(PNG_1X1).toString('base64') },
              { index: 2, width: 32, height: 24, duration_ms: durMs, timestamp_ms: durMs * 2, png_base64: Buffer.from(PNG_1X1).toString('base64') },
            ],
          })
          if (deferVideoPreviewStride === 'all' || deferVideoPreviewStride === strideVal) {
            return await new Promise((resolve, reject) => {
              deferredVideoPreviews.push({
                strideVal,
                signal: init.signal || null,
                resolve: () => resolve(buildPreviewResponse()),
                reject,
                rejectAbort: () => {
                  const abortErr = new Error('The operation was aborted.')
                  abortErr.name = 'AbortError'
                  reject(abortErr)
                },
              })
            })
          }
          return buildPreviewResponse()
        }
        if (action === 'commit' && kind === 'video') {
          if (failVidCommitOnce) {
            failVidCommitOnce = false
            return jsonResponse(500, { error: 'storage_commit_failed', reason: 'Simulated commit ack drop' })
          }
          currentProject = {
            ...currentProject,
            revision: currentProject.revision + 1,
            canvases: {
              ...currentProject.canvases,
              canvas_vid: { id: 'canvas_vid', document_id: 'doc_vid', x: 0, y: 0 },
            },
            sprite_documents: {
              ...currentProject.sprite_documents,
              doc_vid: { working_revision: 1 },
            },
          }
          return jsonResponse(201, {
            project: currentProject,
            document: { document_id: 'doc_vid', revision: 1, canvas: { w: 32, h: 24 }, frame_order: ['f1', 'f2', 'f3'] },
            canvas: currentProject.canvases.canvas_vid,
            receipt: { operation_id: opId, project_id: 'proj_a', project_revision: currentProject.revision, document_id: 'doc_vid', document_revision: 1 },
          })
        }
      }
      if (path.endsWith('/canvas-layout')) {
        const body = JSON.parse(init.body)
        const nextCanvases = { ...currentProject.canvases }
        for (const pos of body.positions) {
          if (nextCanvases[pos.canvas_id]) {
            nextCanvases[pos.canvas_id] = { ...nextCanvases[pos.canvas_id], x: pos.x, y: pos.y }
          }
        }
        currentProject = { ...currentProject, revision: currentProject.revision + 1, canvases: nextCanvases }
        return jsonResponse(200, {
          project: currentProject,
          receipt: { operation_id: body.operation_id, project_id: 'proj_a', project_revision: currentProject.revision },
        })
      }
      if (path.includes('/canvases/canvas_vid/detach')) {
        const body = JSON.parse(init.body)
        const nextCanvases = { ...currentProject.canvases }
        delete nextCanvases.canvas_vid
        currentProject = { ...currentProject, revision: currentProject.revision + 1, canvases: nextCanvases }
        return jsonResponse(200, {
          project: currentProject,
          receipt: { operation_id: body.operation_id, project_id: 'proj_a', project_revision: currentProject.revision },
        })
      }
      if (path.includes('/canvases/canvas_vid/restore')) {
        const body = JSON.parse(init.body)
        currentProject = {
          ...currentProject,
          revision: currentProject.revision + 1,
          canvases: {
            ...currentProject.canvases,
            canvas_vid: { id: 'canvas_vid', document_id: 'doc_vid', x: 64, y: 20 },
          },
        }
        return jsonResponse(200, {
          project: currentProject,
          receipt: { operation_id: body.operation_id, project_id: 'proj_a', project_revision: currentProject.revision },
        })
      }
      if (path.endsWith('/sprite-documents')) return jsonResponse(200, { documents: [] })
      throw new Error(`unexpected ${path}`)
    },
  })

  try {
    const session = bindVnextProjectSession(harness.root, { client })
    await session.reloadProject(currentProject)
    session.view.setCanvases([{ id: 'canvas_a', document_id: 'doc_a', x: 10, y: 20, width: 16, height: 16 }])
    session.selectCanvas('canvas_a')
    assert.equal(harness.byId.has('vnext-sequence-target'), false, 'Target paragraph node is removed from compact sequence dialog')

    // 1. GIF preview + commit
    const gifFile = {
      name: 'walk.gif',
      type: 'image/gif',
      size: 64,
      arrayBuffer: async () => new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]),
    }
    seqInput.files = [gifFile]
    await seqInput.dispatchEvent({ type: 'change' })
    for (let i = 0; i < 15 && motionRequests.length < 1; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(motionRequests.length, 1)
    assert.equal(motionRequests[0].action, 'preview')
    assert.equal(motionRequests[0].kind, 'gif')
    assert.equal(seqFileLabel.hidden, false)
    assert.equal(seqFileLabel.textContent, 'walk.gif')
    assert.equal(seqFileHint.hidden, true)
    assert.equal(seqChoose.textContent, 'Replace')
    assert.equal(motionControls.hidden, true, 'GIF hides video segment controls')
    assert.equal(motionStage.hidden, false, 'GIF shows animated preview stage')
    assert.match(motionMeta.textContent, /Frame 1\/2 · 80 ms · 16×16 px/)
    const gifStatusLines = seqStatus.children.map((node) => node.textContent).join(' ')
    assert.equal(gifStatusLines, '2 frames · 16×16 px · 240 ms')
    assert.equal(seqFrames.children.length, 2)
    assert.equal(seqImport.disabled, false)
    assert.equal(seqImport.textContent, 'Import to timeline')

    // Confirm GIF import -> creates canvas_gif without overwriting canvas_a
    await seqImport.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 15 && (motionRequests.length < 2 || session.pendingImport); i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(motionRequests[1].action, 'commit')
    assert.equal(motionRequests[1].kind, 'gif')
    assert.equal(seqDialog.hidden, true)
    assert.equal(session.view.selectedId, 'canvas_gif')
    assert.equal(Boolean(session.project.canvases.canvas_a), true, 'existing canvas_a preserved')
    assert.equal(session.history.undo.length, 1)
    assert.equal(session.history.undo[0].kind, 'import')
    assert.equal(session.history.undo[0].canvasId, 'canvas_gif')

    // 2. Video probe -> preview -> parameter change locks Import until Update preview -> unknown commit recovery -> Undo/Redo
    seqDialog.hidden = false
    const mp4Bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0])
    const videoFile = {
      name: 'attack.mp4',
      type: 'video/mp4',
      size: mp4Bytes.byteLength,
      arrayBuffer: async () => mp4Bytes,
    }
    seqInput.files = [videoFile]
    await seqInput.dispatchEvent({ type: 'change' })
    for (let i = 0; i < 20 && (motionRequests.length < 4 || seqImport.disabled); i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(motionRequests[2].action, 'probe')
    assert.equal(motionRequests[2].kind, 'video')
    assert.equal(motionRequests[3].action, 'preview')
    assert.equal(motionRequests[3].kind, 'video')
    assert.equal(seqFileLabel.textContent, 'attack.mp4')
    assert.equal(seqChoose.textContent, 'Replace')
    assert.equal(motionControls.hidden, false, 'Video shows segment and sampling controls')
    assert.equal(motionStart.value, '0')
    assert.equal(motionEnd.value, '1.2')
    assert.equal(motionMode.value, 'fps')
    assert.equal(motionFps.value, '10')
    assert.equal(seqImport.disabled, false)
    assert.equal(motionPreviewBtn.textContent, 'Preview segment')

    // Changing sampling mode to stride marks preview stale, shows "Parameters changed" + "Update preview", and disables Import to timeline until Update preview is clicked
    motionMode.value = 'stride'
    await motionMode.dispatchEvent({ type: 'change' })
    assert.equal(motionFpsWrap.hidden, true)
    assert.equal(motionStrideWrap.hidden, false)
    assert.equal(seqImport.disabled, true, 'Import to timeline locked while video parameters are unpreviewed')
    assert.equal(motionPreviewBtn.textContent, 'Update preview')
    assert.equal(motionPreviewState.hidden, false)
    assert.equal(motionPreviewState.textContent, 'Parameters changed')

    // 2a. Active Cancel during an in-flight preview request must abort cleanly without showing an "aborted" error
    deferVideoPreviewStride = 'all'
    motionStride.value = '4'
    await motionStride.dispatchEvent({ type: 'input' })
    await motionPreviewBtn.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 10 && deferredVideoPreviews.length < 1; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(deferredVideoPreviews.length, 1)
    assert.equal(seqStop.hidden, false, 'Cancel button visible while preview request is in flight')
    assert.equal(motionPreviewState.textContent, 'Extracting preview…')
    await seqStop.dispatchEvent({ type: 'click' })
    assert.equal(deferredVideoPreviews[0].signal?.aborted, true, 'Clicking Cancel aborts the in-flight preview signal')
    deferredVideoPreviews[0].rejectAbort()
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(seqStop.hidden, true)
    assert.equal(seqError.hidden, true, 'Active Cancel never displays an error banner')
    assert.equal(seqError.textContent, '', 'Active Cancel never displays "aborted"')
    assert.equal(motionPreviewState.textContent, 'Preview cancelled.')
    assert.equal(seqImport.disabled, true)

    // 2b. Repeated preview clicks while a request is in flight:
    //     Request A (stride=5) is superseded by Request B (stride=3).
    //     When Request A rejects (or settles late), it must NOT cancel Request B or clear Request B's results.
    deferredVideoPreviews.length = 0
    motionStride.value = '5'
    await motionStride.dispatchEvent({ type: 'input' })
    await motionPreviewBtn.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 10 && deferredVideoPreviews.length < 1; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(deferredVideoPreviews.length, 1)
    const reqA = deferredVideoPreviews[0]
    assert.equal(reqA.strideVal, 5)
    assert.equal(reqA.signal?.aborted, false)

    // Click preview again with stride=3 while reqA is still in flight
    motionStride.value = '3'
    await motionPreviewBtn.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 10 && deferredVideoPreviews.length < 2; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(deferredVideoPreviews.length, 2)
    const reqB = deferredVideoPreviews[1]
    assert.equal(reqB.strideVal, 3)
    assert.equal(reqA.signal?.aborted, true, 'Starting Request B aborts Request A')
    assert.equal(reqB.signal?.aborted, false, 'Request B signal remains active')

    // Now let stale Request A reject (simulating late abort/error from Request A)
    reqA.reject(new Error('Stale request A late failure'))
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(reqB.signal?.aborted, false, 'Request A catch block must NOT abort Request B')
    assert.equal(seqStop.hidden, false, 'Cancel button remains visible for active Request B')
    assert.equal(seqError.hidden, true, 'Stale Request A error is ignored')

    // Now resolve Request B (stride=3)
    deferVideoPreviewStride = null
    reqB.resolve()
    for (let i = 0; i < 15 && seqImport.disabled; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(seqStop.hidden, true)
    assert.equal(seqError.hidden, true)
    assert.equal(seqImport.disabled, false, 'Request B unlocks Import to timeline')
    const vidPreviewLines = seqStatus.children.map((node) => node.textContent).join(' ')
    assert.equal(vidPreviewLines, '3 frames · 32×24 px · 375 ms')

    // Clicking Import to timeline hits simulated unknown commit error on first attempt, then recovers with same operation_id
    const commitReqStartIdx = motionRequests.length
    await seqImport.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 20 && harness.byId.get('vnext-confirm-dialog').hidden; i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(motionRequests[commitReqStartIdx].action, 'commit')
    assert.equal(harness.byId.get('vnext-confirm-title').textContent, 'Server did not confirm')
    await harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    for (let i = 0; i < 15 && (motionRequests.length < commitReqStartIdx + 2 || session.pendingImport); i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(motionRequests[commitReqStartIdx + 1].action, 'commit')
    assert.equal(motionRequests[commitReqStartIdx + 1].opId, motionRequests[commitReqStartIdx].opId, 'recovery reuses the exact same operation_id')
    assert.equal(motionRequests[commitReqStartIdx + 1].sampling_mode, 'stride')
    assert.equal(motionRequests[commitReqStartIdx + 1].stride, '3')
    assert.equal(session.view.selectedId, 'canvas_vid')
    assert.equal(Object.keys(session.project.canvases).length, 3)

    // Single-step Undo detaches canvas_vid; Redo restores canvas_vid
    await harness.root.dispatchEvent({
      type: 'keydown',
      key: 'z',
      ctrlKey: true,
      shiftKey: false,
      preventDefault() {},
    })
    for (let i = 0; i < 15 && (session.project.canvases.canvas_vid || session.historyBusy); i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(Boolean(session.project.canvases.canvas_vid), false, 'Undo detaches imported video sequence canvas')
    assert.equal(Boolean(session.project.canvases.canvas_gif), true, 'Previous canvases remain intact')

    await harness.root.dispatchEvent({
      type: 'keydown',
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      preventDefault() {},
    })
    for (let i = 0; i < 15 && (!session.project.canvases.canvas_vid || session.historyBusy); i += 1) {
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(Boolean(session.project.canvases.canvas_vid), true, 'Redo restores imported video sequence canvas')

    // 3. Project switch closes sequence dialog and isolates state
    seqDialog.hidden = false
    await session.reloadProject({
      id: 'proj_b',
      revision: 1,
      canvases: {},
      sprite_documents: {},
    })
    assert.equal(seqDialog.hidden, true, 'Switching projects closes open sequence dialog')
  } finally {
    globalThis.Image = priorImage
    globalThis.document.createElement = priorCreateElement
    harness.restore()
  }
})

test('workspace UX feedback: grouped project menu, 13px/20px composer input, Color-first right column with single-line idle state, and continuous stage wheel zoom', async () => {
  const { html, css } = await readPreview()

  // 1. Project menu groups, headings, dividers, and item order
  const menuBlock = html.match(/<div class="vnext-project-menu" id="vnext-project-menu"[\s\S]*?<div class="vnext-dialog-root" id="vnext-sequence-dialog"/)?.[0] || ''
  assert.ok(menuBlock, 'project menu block exists')
  const headings = [...menuBlock.matchAll(/<p class="vnext-project-menu-heading"[^>]*>([^<]+)<\/p>/g)].map((m) => m[1])
  assert.deepEqual(headings, ['Project', 'Canvas', 'Import', 'AI generation'])
  const dividers = [...menuBlock.matchAll(/<div class="vnext-project-menu-divider" role="separator"><\/div>/g)]
  assert.equal(dividers.length, 3, '3 group dividers separate the 4 menu groups')
  const items = [...menuBlock.matchAll(/<button[^>]*class="vnext-menu-row"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1].trim())
  assert.deepEqual(items, [
    'New project',
    'Open project…',
    'New canvas…',
    'Duplicate canvas',
    'Canvas size / crop…',
    'Save canvas positions',
    'Import image…',
    'Import sequence…',
    'Subscription sheet…',
  ])

  // 2. Composer input & placeholder typography (13px / 20px / 400) while preserving 53x68 attachment and 24px bar
  const promptRule = css.match(/\.vnext-prompt-input \{([^}]*)\}/)?.[1] || ''
  assert.match(promptRule, /font-size:\s*13px/)
  assert.match(promptRule, /line-height:\s*20px/)
  assert.match(promptRule, /font-weight:\s*400/)
  const placeholderRule = css.match(/\.vnext-prompt-input::placeholder \{([^}]*)\}/)?.[1] || ''
  assert.match(placeholderRule, /font-size:\s*13px/)
  assert.match(placeholderRule, /line-height:\s*20px/)
  assert.match(placeholderRule, /font-weight:\s*400/)
  assert.match(css, /\.vnext-ref-image \{[^}]*width: 53px;[^}]*height: 68px;/)
  assert.match(css, /\.vnext-composer-bar \{[^}]*height: 24px;/)

  // 3. Right column DOM order: Color -> Quick colors -> Palette -> #vnext-target -> #vnext-perfect-pixels -> #vnext-tool-options
  const colorIdx = html.indexOf('data-figma="I1823:5415;1682:5310"')
  const quickIdx = html.indexOf('data-figma="I1823:5415;1725:5176"')
  const paletteIdx = html.indexOf('id="vnext-palette"')
  const targetIdx = html.indexOf('id="vnext-target"')
  const perfectIdx = html.indexOf('id="vnext-perfect-pixels"')
  const toolOptionsIdx = html.indexOf('id="vnext-tool-options"')
  assert.ok(colorIdx > 0 && quickIdx > colorIdx && paletteIdx > quickIdx, 'Color, Quick colors, and Palette appear first in order')
  assert.ok(targetIdx > paletteIdx && perfectIdx > targetIdx && toolOptionsIdx > perfectIdx, 'Selected canvas, Perfect pixels, and tool options follow Palette')
  assert.match(html, /id="vnext-zoom"[^>]*title="Zoom · Pinch or ⌘\/Ctrl \+ scroll"/)

  // 4. Right column runtime idle state vs selected canvas vs active tool + stage wheel zoom
  const f = await selectionSessionFixture({
    width: 16,
    height: 16,
    beforeBoot({ harness }) {
      const panel = document.createElement('div')
      panel.className = 'vnext-color'
      const targetRoot = document.createElement('section')
      targetRoot.id = 'vnext-target'
      targetRoot.className = 'vnext-target is-empty'
      const targetHead = document.createElement('div')
      targetHead.id = 'vnext-target-head'
      targetHead.hidden = true
      const targetName = document.createElement('p')
      targetName.id = 'vnext-target-name'
      const targetMeta = document.createElement('p')
      targetMeta.id = 'vnext-target-meta'
      targetMeta.hidden = true
      const targetState = document.createElement('p')
      targetState.id = 'vnext-target-state'
      targetState.hidden = true
      targetRoot.append(targetHead)
      targetRoot.append(targetName)
      targetRoot.append(targetMeta)
      targetRoot.append(targetState)
      const toolOptions = document.createElement('section')
      toolOptions.id = 'vnext-tool-options'
      toolOptions.hidden = true
      const toolTitle = document.createElement('span')
      toolTitle.id = 'vnext-tool-title'
      const brushSection = document.createElement('section')
      brushSection.className = 'vnext-brush'
      brushSection.hidden = true
      toolOptions.append(toolTitle)
      toolOptions.append(brushSection)
      const pencilBtn = document.createElement('button')
      pencilBtn.id = 'vnext-tool-pencil'
      pencilBtn.setAttribute('data-capability', 'TOOL-03')
      panel.append(targetRoot)
      panel.append(toolOptions)
      panel.append(pencilBtn)
      for (const node of [targetRoot, targetHead, targetName, targetMeta, targetState, toolOptions, toolTitle, pencilBtn]) {
        harness.byId.set(node.id, node)
      }
      const query = harness.root.querySelector.bind(harness.root)
      harness.root.querySelector = (selector) => {
        if (selector === '.vnext-color') return panel
        if (selector === '.vnext-brush') return brushSection
        if (selector === '[data-capability="TOOL-03"]') return pencilBtn
        return query(selector) || panel.querySelector(selector)
      }
    },
  })
  try {
    const targetRoot = f.harness.byId.get('vnext-target')
    const targetHead = f.harness.byId.get('vnext-target-head')
    const targetName = f.harness.byId.get('vnext-target-name')
    const targetMeta = f.harness.byId.get('vnext-target-meta')
    const toolOptions = f.harness.byId.get('vnext-tool-options')
    const toolTitle = f.harness.byId.get('vnext-tool-title')

    // Idle with no selection: single-line "No canvas selected", hidden head/meta/tool-options (no empty Move heading)
    f.session.selectCanvas(null)
    assert.equal(targetRoot.classList.contains('is-empty'), true)
    assert.equal(targetHead.hidden, true)
    assert.equal(targetMeta.hidden, true)
    assert.equal(targetName.textContent, 'No canvas selected')
    assert.equal(toolOptions.hidden, true)

    // Select a canvas while Move tool is active: target head/meta shown, tool-options still hidden (Move has no options)
    f.session.selectCanvas('old')
    assert.equal(targetRoot.classList.contains('is-empty'), false)
    assert.equal(targetHead.hidden, false)
    assert.equal(targetMeta.hidden, false)
    assert.equal(toolOptions.hidden, true, 'Move tool does not render an empty tool options block')

    // Switch to Pencil tool: Brush options shown once
    await f.harness.byId.get('vnext-tool-pencil').dispatchEvent({ type: 'click' })
    assert.equal(toolOptions.hidden, false)
    assert.equal(toolTitle.textContent, 'Brush')

    // Stage wheel zoom: continuous Ctrl+wheel updates zoom on every event via paintMotionLayers, plain wheel does not zoom
    const stage = f.harness.byId.get('vnext-canvas-stage')
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
    const startZoom = f.session.view.zoom
    const zoomBtn = f.harness.byId.get('vnext-zoom')
    const gridPending = f.harness.byId.get('vnext-grid-pending')
    const pixelGridNote = f.harness.byId.get('vnext-pixel-grid-note')
    const tileOld = stage.querySelector('[data-canvas-id="old"]')
    const initialPreviewNode = tileOld?.children?.[0]
    let replaceChildrenCount = 0
    const origReplaceChildren = tileOld.replaceChildren.bind(tileOld)
    tileOld.replaceChildren = (...args) => {
      replaceChildrenCount += 1
      return origReplaceChildren(...args)
    }

    await stage.dispatchEvent({ type: 'wheel', deltaY: 20, ctrlKey: false, clientX: 100, clientY: 100 })
    assert.equal(f.session.view.zoom, startZoom, 'plain wheel without Ctrl/Meta does not zoom')

    await stage.dispatchEvent({ type: 'wheel', deltaY: -15, ctrlKey: true, clientX: 100, clientY: 100, timeStamp: 100 })
    assert.ok(Math.abs(f.session.view.zoom - Math.pow(2, 15 / 100)) <= 1e-9, '15px Ctrl+wheel immediately updates continuous zoom')
    assert.equal(zoomBtn.textContent, `${Math.round(f.session.view.zoom * 100)}%`)

    await stage.dispatchEvent({ type: 'wheel', deltaY: -85, ctrlKey: true, clientX: 100, clientY: 100, timeStamp: 120 })
    assert.ok(Math.abs(f.session.view.zoom - 2) <= 1e-9, 'cumulative -100px Ctrl+wheel doubles zoom to 200%')
    assert.equal(zoomBtn.textContent, '200%')
    assert.equal(gridPending.hidden, false, 'below 400% zoom, pixel grid pending indicator remains visible')
    assert.equal(pixelGridNote.hidden, false)
    assert.equal( Boolean(stage.querySelector('[data-canvas-grid="old"]')), false)

    // Zoom across 400% threshold (-100px from 200% -> 400%) via paintMotionLayers
    await stage.dispatchEvent({ type: 'wheel', deltaY: -100, ctrlKey: true, clientX: 100, clientY: 100, timeStamp: 140 })
    assert.ok(Math.abs(f.session.view.zoom - 4) <= 1e-9, 'another -100px doubles zoom to 400%')
    assert.equal(zoomBtn.textContent, '400%')
    assert.equal(gridPending.hidden, true, 'at 400% zoom, pixel grid pending indicator hides')
    assert.equal(pixelGridNote.hidden, true)
    assert.equal(Boolean(stage.querySelector('[data-canvas-grid="old"]')), true, 'at 400% zoom, pixel grid overlay mounts')
    assert.equal(replaceChildrenCount, 0, 'wheel zoom via paintMotionLayers does not detach/replace tile preview children')
    assert.equal(tileOld?.children?.[0], initialPreviewNode)

    // Editable rename input inside stage is isolated from wheel zoom
    f.session.view.setTool('move')
    f.session.renderCanvas()
    assert.equal(replaceChildrenCount, 0, 'renderCanvas also preserves already-mounted preview child without replaceChildren')
    const nameBtn = stage.querySelector('[data-canvas-name="old"]')
    assert.equal(nameBtn?.tagName, 'BUTTON')
    await nameBtn.dispatchEvent({ type: 'dblclick' })
    const nameInput = stage.querySelector('[data-canvas-name="old"]')
    assert.equal(nameInput?.tagName, 'INPUT')
    const zoomBeforeInputWheel = f.session.view.zoom
    const wheelOnInput = { type: 'wheel', deltaY: -40, ctrlKey: true, clientX: 100, clientY: 100, timeStamp: 230, target: nameInput }
    await stage.dispatchEvent(wheelOnInput)
    assert.equal(Boolean(wheelOnInput.defaultPrevented), false, 'editable input inside stage keeps native wheel event')
    assert.equal(f.session.view.zoom, zoomBeforeInputWheel, 'Ctrl+wheel on canvas rename input does not zoom stage')
    await nameInput.dispatchEvent({ type: 'keydown', key: 'Escape' })
  } finally {
    f.harness.restore()
  }
})

test('Block 2 multi-palette selector switches palettes, renames, duplicates, adds presets from library, and deletes with confirmation', async () => {
  const { bindPaletteControls, PALETTE_LIBRARY } = await import('../../src/ui/vnext/vnext-palette.js')
  const f = await pixelSessionFixture()
  try {
    const panel = document.createElement('div')
    panel.className = 'vnext-color'
    const grid = document.createElement('div')
    grid.id = 'vnext-palette'
    grid.style.setProperty = (k, v) => { grid.style[k] = v }
    const add = document.createElement('button')
    add.id = 'vnext-palette-add'
    const menu = document.createElement('section')
    menu.id = 'vnext-palette-menu'
    menu.hidden = true
    const selectBtn = document.createElement('button')
    selectBtn.id = 'vnext-palette-select'
    selectBtn.setAttribute('data-capability', 'COLOR-03')
    const selectLabel = document.createElement('span')
    selectLabel.id = 'vnext-palette-select-label'
    selectBtn.append(selectLabel)
    const selectMenu = document.createElement('section')
    selectMenu.id = 'vnext-palette-select-menu'
    selectMenu.hidden = true
    panel.append(selectBtn)
    panel.append(selectMenu)
    panel.append(grid)
    panel.append(add)
    panel.append(menu)
    for (const node of [grid, add, menu, selectBtn, selectLabel, selectMenu]) f.harness.byId.set(node.id, node)
    const origCreate = document.createElement
    document.createElement = (tag) => {
      const n = origCreate(tag)
      n.style.setProperty = (k, v) => { n.style[k] = v }
      Object.defineProperty(n, 'innerHTML', {
        configurable: true,
        get() { return this._html || '' },
        set(v) {
          this._html = String(v || '')
          this.children = []
          if (this._html.includes('vnext-swatch-ring')) {
            const ring = origCreate('svg')
            ring.className = 'vnext-swatch-ring'
            this.append(ring)
          }
        },
      })
      return n
    }
    const origQuery = f.harness.root.querySelector.bind(f.harness.root)
    f.harness.root.querySelector = (sel) => {
      if (sel === '.vnext-color') return panel
      return origQuery(sel) || panel.querySelector(sel)
    }

    const savedPayloads = []
    f.api.savePalette = async (_id, req) => {
      savedPayloads.push(structuredClone(req))
      f.project = {
        ...f.project,
        revision: f.project.revision + 1,
        settings: {
          palette: {
            colors: req.colors,
            ...(req.active_id || req.activeId ? { active_id: req.active_id || req.activeId } : {}),
            ...(req.items ? { items: req.items } : {}),
          },
        },
      }
      return { project: f.project }
    }

    let activeColor = [17, 17, 17, 255]
    const controls = bindPaletteControls({
      root: f.harness.root,
      session: f.session,
      getColor: () => activeColor,
      setColor: (c) => { activeColor = c },
      isBusy: () => false,
      status() {},
    })
    controls.refresh()
    assert.equal(selectBtn.disabled, false, 'COLOR-03 selector is enabled when project is ready')
    assert.equal(selectLabel.textContent, 'Custom')

    // Open palette menu and add a preset from PALETTE_LIBRARY
    await selectBtn.dispatchEvent({ type: 'click', stopPropagation() {} })
    assert.equal(selectMenu.hidden, false)
    const presetRow = selectMenu.querySelectorAll('button').find(b => b.dataset.palettePreset === PALETTE_LIBRARY[1].id)
    assert.ok(presetRow, 'preset library entry is rendered')
    await selectMenu.dispatchEvent({ type: 'click', target: presetRow })
    await new Promise(r => setTimeout(r, 0))
    assert.equal(f.session.project.settings.palette.items.length, 2)
    assert.equal(selectLabel.textContent, PALETTE_LIBRARY[1].name)

    // Rename active palette
    await selectBtn.dispatchEvent({ type: 'click', stopPropagation() {} })
    const nameInput = selectMenu.querySelector('#vnext-palette-name-input')
    assert.equal(nameInput.value, PALETTE_LIBRARY[1].name)
    nameInput.value = 'GameBoy 4'
    const renameBtn = selectMenu.querySelectorAll('button').find(b => b.dataset.paletteManage === 'rename')
    await selectMenu.dispatchEvent({ type: 'click', target: renameBtn })
    await new Promise(r => setTimeout(r, 0))
    assert.equal(selectLabel.textContent, 'GameBoy 4')

    // Duplicate active palette
    await selectBtn.dispatchEvent({ type: 'click', stopPropagation() {} })
    const dupBtn = selectMenu.querySelectorAll('button').find(b => b.dataset.paletteManage === 'duplicate')
    await selectMenu.dispatchEvent({ type: 'click', target: dupBtn })
    await new Promise(r => setTimeout(r, 0))
    assert.equal(f.session.project.settings.palette.items.length, 3)
    assert.equal(selectLabel.textContent, 'GameBoy 4 copy')

    // Delete active palette requires confirmation via session.openConfirm
    await selectBtn.dispatchEvent({ type: 'click', stopPropagation() {} })
    const delBtn = selectMenu.querySelectorAll('button').find(b => b.dataset.paletteManage === 'delete')
    await selectMenu.dispatchEvent({ type: 'click', target: delBtn })
    assert.equal(f.session.project.settings.palette.items.length, 3, 'does not delete before confirmation')
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false)
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await new Promise(r => setTimeout(r, 0))
    assert.equal(f.session.project.settings.palette.items.length, 2)
  } finally {
    f.harness.restore()
  }
})

test('Block 2 composite vs current-layer eyedropper samples visible composite by default, current layer (including active-layer editable text) when switched, and leaves working color unchanged on transparent pixels', async () => {
  const f = await savedTextPreviewFixture('upper')
  try {
    const doc = f.docs.get('doc_old')
    const lowerBytes = new Uint8Array(64 * 64 * 4)
    lowerBytes.set([10, 20, 30, 255], 0)
    const upperBytes = new Uint8Array(64 * 64 * 4)
    upperBytes.set([200, 100, 50, 255], 0)
    const lowerSha = await sha256Hex(lowerBytes)
    const upperSha = await sha256Hex(upperBytes)
    f.blocks.set(lowerSha, lowerBytes)
    f.blocks.set(upperSha, upperBytes)
    doc.cels.c.block = { w: 64, h: 64, sha256: lowerSha }
    doc.cels.upper.block = { w: 64, h: 64, sha256: upperSha }

    f.session.documentTimeline = { render() { return false }, stop() {}, target: () => ({ frame_id: 'f', layer_id: 'l', cel_id: 'c' }) }
    const source = await f.session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true })
    const px = (bytes, x, y) => [...bytes.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
    assert.equal(typeof source.sampleRgba, 'function')
    const layerSample = source.sampleRgba('layer')
    const compositeSample = source.sampleRgba('composite')
    assert.deepEqual(px(layerSample, 0, 0), [10, 20, 30, 255], 'layer mode samples active lower layer raster')
    assert.deepEqual(px(compositeSample, 0, 0), [200, 100, 50, 255], 'composite mode samples visible upper layer raster over lower layer')
    assert.deepEqual(px(layerSample, 4, 4), [250, 0, 0, 255], 'layer mode samples active-layer editable text (text_a) and ignores upper-layer text')
    assert.deepEqual(px(layerSample, 8, 4), [0, 250, 0, 255], 'layer mode samples second active-layer editable text (text_b)')
    assert.deepEqual(px(compositeSample, 4, 4), [0, 0, 250, 255], 'composite mode samples visible upper-layer text (text_upper) over lower layer')
    assert.deepEqual(px(source.rgba, 4, 4), [0, 0, 0, 0], 'sampling active-layer text does not mutate or bake into raw cel raster bytes')
  } finally {
    f.harness.restore()
  }

  const g = await heldStrokeFixture('eyedropper')
  try {
    // Pixel (0, 0) in doc_new is transparent [0, 0, 0, 0]
    await g.pointer('pointerdown', 0, 0)
    await g.pointer('pointerup', 0, 0)
    assert.equal(g.session.view.tool, 'pencil')
    // Start a pencil stroke at (0, 0) and verify working color remained the initial [77, 115, 102, 255]
    await g.pointer('pointerdown', 0, 0)
    await g.until(() => g.session.manualGesture?.stroke, 'pencil stroke started')
    assert.deepEqual(
      [...g.session.manualGesture.stroke.bytes.slice(0, 4)],
      [77, 115, 102, 255],
      'sampling a transparent pixel keeps current working color unchanged',
    )
    await g.key({ key: 'Escape' })

    // Pixel (2, 1) in doc_new is non-transparent
    const srcBytes = await g.pixels('doc_new')
    const expectedPixel = [...srcBytes.slice((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4)]
    assert.ok(expectedPixel[3] > 0)
    g.session.view.setTool('eyedropper')
    await g.pointer('pointerdown', 2, 1)
    await g.pointer('pointerup', 2, 1)
    await g.pointer('pointerdown', 0, 0)
    await g.until(() => g.session.manualGesture?.stroke, 'second pencil stroke started')
    assert.deepEqual(
      [...g.session.manualGesture.stroke.bytes.slice(0, 4)],
      expectedPixel,
      'sampling an opaque pixel updates working color',
    )
    await g.key({ key: 'Escape' })
  } finally {
    g.release()
    g.harness.restore()
  }
})

test('Block 2 canvas size & crop dialog previews pixel-loss and rendered-glyph text-clipping warnings and dispatches resize-canvas structure command', async () => {
  const f = await selectionSessionFixture({
    width: 4,
    height: 4,
    beforeBoot({ harness, api, docs, commit }) {
      const dialog = document.createElement('div')
      dialog.id = 'vnext-canvas-size-dialog'
      dialog.hidden = true
      const form = document.createElement('form')
      form.id = 'vnext-canvas-size-form'
      const current = document.createElement('p')
      current.id = 'vnext-canvas-size-current'
      const modeResize = document.createElement('button')
      modeResize.dataset.canvasSizeMode = 'resize'
      const modeCrop = document.createElement('button')
      modeCrop.dataset.canvasSizeMode = 'crop'
      const cropOrigins = document.createElement('div')
      cropOrigins.id = 'vnext-canvas-crop-origins'
      cropOrigins.hidden = true
      const cropX = document.createElement('input')
      cropX.id = 'vnext-canvas-crop-x'
      cropX.value = '0'
      const cropY = document.createElement('input')
      cropY.id = 'vnext-canvas-crop-y'
      cropY.value = '0'
      cropOrigins.append(cropX)
      cropOrigins.append(cropY)
      const widthInput = document.createElement('input')
      widthInput.id = 'vnext-canvas-size-width'
      widthInput.value = '4'
      const heightInput = document.createElement('input')
      heightInput.id = 'vnext-canvas-size-height'
      heightInput.value = '4'
      const anchorWrap = document.createElement('div')
      anchorWrap.id = 'vnext-canvas-anchor-wrap'
      const anchorGrid = document.createElement('div')
      anchorGrid.id = 'vnext-canvas-anchor-grid'
      for (const a of ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']) {
        const b = document.createElement('button')
        b.dataset.canvasAnchor = a
        anchorGrid.append(b)
      }
      anchorWrap.append(anchorGrid)
      const useSelectionBtn = document.createElement('button')
      useSelectionBtn.id = 'vnext-canvas-use-selection'
      const trimBtn = document.createElement('button')
      trimBtn.id = 'vnext-canvas-trim-bounds'
      const warning = document.createElement('p')
      warning.id = 'vnext-canvas-size-warning'
      warning.hidden = true
      const error = document.createElement('p')
      error.id = 'vnext-canvas-size-error'
      error.hidden = true
      const applyBtn = document.createElement('button')
      applyBtn.id = 'vnext-canvas-size-apply'
      const cancelBtn = document.createElement('button')
      cancelBtn.dataset.canvasSizeCancel = 'true'
      for (const el of [current, modeResize, modeCrop, cropOrigins, widthInput, heightInput, anchorWrap, useSelectionBtn, trimBtn, warning, error, applyBtn, cancelBtn]) {
        form.append(el)
      }
      dialog.append(form)
      for (const el of [dialog, form, current, cropOrigins, cropX, cropY, widthInput, heightInput, anchorWrap, anchorGrid, useSelectionBtn, trimBtn, warning, error, applyBtn]) {
        if (el.id) harness.byId.set(el.id, el)
      }
      const doc = docs.get('doc_old')
      doc.derived_from = { document_id: 'src', revision: 1 }
      api.changeStructure = async (_p, id, req) => {
        const nextDoc = {
          ...structuredClone(docs.get(id)),
          revision: docs.get(id).revision + 1,
          canvas: { w: req.command.width, h: req.command.height },
        }
        const res = commit(id, nextDoc)
        return {
          project: res.project,
          document: res.document,
          receipt: {
            operation_id: req.operationId,
            project_id: res.project.id,
            project_revision: res.project.revision,
            document_id: id,
            document_revision: res.document.revision,
          },
        }
      }
    },
  })
  try {
    const dialog = f.harness.byId.get('vnext-canvas-size-dialog')
    const widthInput = f.harness.byId.get('vnext-canvas-size-width')
    const heightInput = f.harness.byId.get('vnext-canvas-size-height')
    const warning = f.harness.byId.get('vnext-canvas-size-warning')
    const form = f.harness.byId.get('vnext-canvas-size-form')

    await f.session.openCanvasSizeDialog({ mode: 'resize' })
    assert.equal(dialog.hidden, false)
    assert.equal(widthInput.value, '4')
    assert.equal(heightInput.value, '4')

    // Shrinking 4x4 non-transparent canvas to 2x2 shows live pixel-loss warning before applying
    widthInput.value = '2'
    heightInput.value = '2'
    await widthInput.dispatchEvent({ type: 'input' })
    assert.equal(warning.hidden, false, 'shrinking shows pixel-loss warning before applying')
    assert.match(warning.textContent, /clip/i)

    // Clear cel raster and add visible text whose origin (1, 1) stays inside 6x6 while rendered glyphs overflow
    const doc = f.session.documents.get('doc_old')
    const savedBlock = doc.cels.c.block
    doc.cels.c.block = null
    doc.layers.l.visible = true
    doc.text_objects = {
      version: 1,
      items: [{
        id: 'txt_glyph_clip',
        frame_id: 'f',
        layer_id: 'l',
        text: 'WIDE',
        x: 1,
        y: 1,
        size: 12,
        font: { kind: 'generic', name: 'sans-serif' },
        color: '#ffffffff',
        bold: false,
        italic: false,
        antialias: false,
        mode: 'fill',
        stroke_width: 1,
      }],
    }
    widthInput.value = '6'
    heightInput.value = '6'
    await widthInput.dispatchEvent({ type: 'input' })
    assert.equal(warning.hidden, false, 'warns when visible text glyphs exceed target canvas even though origin (1, 1) is inside 6x6')
    assert.match(warning.textContent, /1 text object/i)

    // Remove text, restore cel block, and expand to 8x8: hides warning and submits resize-canvas structure command
    doc.cels.c.block = savedBlock
    delete doc.text_objects
    widthInput.value = '8'
    heightInput.value = '8'
    await widthInput.dispatchEvent({ type: 'input' })
    assert.equal(warning.hidden, true, 'expanding/padding with no clipped text has no pixel loss')

    await form.dispatchEvent({ type: 'submit' })
    assert.equal(dialog.hidden, true)
    assert.deepEqual(f.session.documents.get('doc_old').canvas, { w: 8, h: 8 })
  } finally {
    f.harness.restore()
  }
})

test('external tools UI: target compatibility, MCP connect/revoke, Aseprite checkout/return with unknown-retry operation_id preservation, copyable handoff, diff review modal, Save/Discard server cleanup, and stale conflict rejection', async () => {
  const { bindExternalBridge } = await import('../../src/ui/vnext/vnext-external-pixels.js')
  const recoveryStorage = new Map()
  const { html, css } = await readPreview()
  const perfectIdx = html.indexOf('id="vnext-perfect-pixels"')
  const externalIdx = html.indexOf('id="vnext-external-tools"')
  const toolOptionsIdx = html.indexOf('id="vnext-tool-options"')
  assert.ok(externalIdx > perfectIdx && toolOptionsIdx > externalIdx, '#vnext-external-tools follows #vnext-perfect-pixels before #vnext-tool-options')
  assert.match(html, /id="vnext-external-connect"[^>]*>Connect external tools<\/button>/)
  assert.match(html, /id="vnext-external-checkout"[^>]*>Create external edit copy<\/button>/)
  assert.match(html, /id="vnext-external-review"[^>]*>Review returned edit<\/button>/)
  assert.match(html, /id="vnext-external-revoke"[^>]*>Revoke<\/button>/)
  assert.match(html, /id="vnext-external-handoff"/)
  assert.match(html, /id="vnext-external-handoff-value"/)
  assert.match(html, /id="vnext-external-copy-handoff"/)
  assert.match(html, /id="vnext-external-availability"/)
  assert.match(css, /#vnext-external-tools\[hidden\]/)
  assert.match(css, /\.vnext-external-handoff\[hidden\]/)
  assert.match(css, /\.vnext-pixel-edit-candidate\.is-diff/)

  const attachExternalToolsDom = (harness) => {
    const extSection = document.createElement('section')
    extSection.id = 'vnext-external-tools'
    extSection.hidden = true
    const connectBtn = document.createElement('button')
    connectBtn.id = 'vnext-external-connect'
    connectBtn.disabled = true
    const checkoutBtn = document.createElement('button')
    checkoutBtn.id = 'vnext-external-checkout'
    checkoutBtn.disabled = true
    const stateActions = document.createElement('div')
    stateActions.id = 'vnext-external-state-actions'
    stateActions.hidden = true
    const reviewBtn = document.createElement('button')
    reviewBtn.id = 'vnext-external-review'
    reviewBtn.hidden = true
    const revokeBtn = document.createElement('button')
    revokeBtn.id = 'vnext-external-revoke'
    revokeBtn.hidden = true
    stateActions.append(reviewBtn, revokeBtn)
    const handoffRow = document.createElement('div')
    handoffRow.id = 'vnext-external-handoff'
    handoffRow.hidden = true
    const handoffInput = document.createElement('input')
    handoffInput.id = 'vnext-external-handoff-value'
    const copyHandoffBtn = document.createElement('button')
    copyHandoffBtn.id = 'vnext-external-copy-handoff'
    handoffRow.append(handoffInput, copyHandoffBtn)
    const statusNode = document.createElement('p')
    statusNode.id = 'vnext-external-status'
    statusNode.hidden = true
    const metaNode = document.createElement('p')
    metaNode.id = 'vnext-external-meta'
    metaNode.hidden = true
    const availNode = document.createElement('p')
    availNode.id = 'vnext-external-availability'
    extSection.append(connectBtn, checkoutBtn, stateActions, handoffRow, statusNode, metaNode)
    for (const el of [extSection, connectBtn, checkoutBtn, stateActions, reviewBtn, revokeBtn, handoffRow, handoffInput, copyHandoffBtn, statusNode, metaNode, availNode]) {
      if (el.id) harness.byId.set(el.id, el)
    }
  }

  // 1. Unsupported 16x16 canvas disables connect/checkout and shows unsupported reason
  const unsupported = await selectionSessionFixture({
    width: 16,
    height: 16,
    beforeBoot({ harness }) {
      attachExternalToolsDom(harness)
    },
  })
  try {
    unsupported.session.externalBridge.sync({ skipRefresh: true })
    assert.equal(unsupported.harness.byId.get('vnext-external-tools').hidden, false)
    assert.equal(unsupported.harness.byId.get('vnext-external-connect').disabled, true)
    assert.equal(unsupported.harness.byId.get('vnext-external-checkout').disabled, true)
    assert.match(unsupported.harness.byId.get('vnext-external-status').textContent, /Unsupported target.*64 × 64 px/)
  } finally {
    unsupported.harness.restore()
  }

  // 2. Supported 64x64 single-frame single-layer canvas: connect unknown retry, handoff copy + manual fallback, status-restored reconnect notice, revoke, checkout unknown retry, return unknown retry, discard + retirement retry, save + retirement retry, and conflict
  const connectOps = []
  const checkoutOps = []
  const returnOps = []
  const revokedCalls = []
  let failConnectUnknownOnce = false
  let failCheckoutUnknownOnce = false
  let failReturnUnknownOnce = false
  let failRevokeOnce = false
  let statusRestoredGrantWithoutToken = false
  let candidateRgba = null
  let sourceSha256 = null
  let candidateSha256 = null
  const sessionId = '44444444-4444-4444-8444-444444444444'
  const expectedMcpCmd = "node '/example/Game tools/scripts/pixel-mcp-stdio.mjs' --project sel_project --grant-id grant_mcp_1 --bridge-token tok_1234567890abcdef"

  const f = await selectionSessionFixture({
    width: 64,
    height: 64,
    beforeBoot({ harness, api }) {
      attachExternalToolsDom(harness)
      globalThis.window.sessionStorage = {
        getItem: key => recoveryStorage.get(key) ?? null,
        setItem: (key, value) => recoveryStorage.set(key, value),
        removeItem: key => recoveryStorage.delete(key),
      }

      api.getExternalBridgeStatus = async () => ({
        ok: true,
        availability: {
          compatibility: { width: 64, height: 64, max_frames: 1, max_layers: 1, alpha_values: [0, 255], max_pixels: 4096, decoded_rgba_bytes: 16384 },
          codex_mcp: { available: true },
          aseprite: { available: true, version: 'Aseprite 1.3.18.5-arm64' },
        },
        target: { compatible: true, code: 'ok', reason: null },
        ...(statusRestoredGrantWithoutToken
          ? {
              grant: {
                grant_id: 'grant_restored_1',
                project_revision: 2,
                working_revision: 1,
                status: 'active',
                expired: false,
                revoked: false,
              },
              codex_mcp: {
                command: ['node', '/example/Game tools/scripts/pixel-mcp-stdio.mjs', '--grant-id', 'grant_restored_1', '--bridge-token', '<BRIDGE_TOKEN>'],
                command_line: "node '/example/Game tools/scripts/pixel-mcp-stdio.mjs' --grant-id grant_restored_1 --bridge-token '<BRIDGE_TOKEN>'",
              },
            }
          : {}),
      })
      api.connectExternalBridge = async (_projectId, req) => {
        connectOps.push(req.operationId)
        if (failConnectUnknownOnce) {
          failConnectUnknownOnce = false
          throw Object.assign(new Error('network_error'), { kind: 'unknown' })
        }
        return {
          ok: true,
          grant: {
            grant_id: 'grant_mcp_1',
            bridge_token: 'tok_1234567890abcdef',
            project_revision: req.expectedRevision,
            working_revision: req.expectedWorkingRevision,
            expires_at: new Date(Date.now() + 900_000).toISOString(),
          },
          mcp: {
            command: ['node', '/example/Game tools/scripts/pixel-mcp-stdio.mjs', '--project', 'sel_project', '--grant-id', 'grant_mcp_1', '--bridge-token', 'tok_1234567890abcdef'],
            command_line: expectedMcpCmd,
          },
          review_hash: `#pixel-preview=sel_project/${sessionId}`,
        }
      }
      api.revokeExternalBridge = async (_projectId, req) => {
        if (failRevokeOnce) {
          failRevokeOnce = false
          throw new Error('server_cleanup_unavailable')
        }
        revokedCalls.push(req)
        return { ok: true, revoked_grants: req.grantId ? [req.grantId] : [], cancelled_checkouts: req.checkoutId ? [req.checkoutId] : [] }
      }
      api.createAsepriteCheckout = async (_projectId, req) => {
        checkoutOps.push(req.operationId)
        if (failCheckoutUnknownOnce) {
          failCheckoutUnknownOnce = false
          throw Object.assign(new Error('network_error'), { kind: 'unknown' })
        }
        return {
          ok: true,
          checkout: {
            checkout_id: 'chk_ase_1',
            grant_id: 'grant_ase_1',
            working_copy_path: '/tmp/gametool/chk_ase_1/working-copy.aseprite',
            project_revision: req.expectedRevision,
            working_revision: req.expectedWorkingRevision,
            return_attempts: 0,
            max_return_attempts: 3,
            checkout_file_sha256: 'a'.repeat(64),
          },
        }
      }
      api.returnAsepriteCheckout = async (_projectId, _checkoutId, req) => {
        returnOps.push(req.operationId)
        if (failReturnUnknownOnce) {
          failReturnUnknownOnce = false
          throw Object.assign(new Error('network_error'), { kind: 'unknown' })
        }
        return {
          ok: true,
          checkout_id: 'chk_ase_1',
          session_id: sessionId,
          review_hash: `#pixel-preview=sel_project/${sessionId}`,
          checkout_file_sha256: 'a'.repeat(64),
          returned_file_sha256: 'b'.repeat(64),
          diff: { changed_pixels: 1, bounds: { x: 0, y: 0, w: 1, h: 1 } },
          candidate: { sha256: candidateSha256, source_sha256: sourceSha256, changed_pixels: 1, return_attempts: 1 },
        }
      }
    },
  })

  const priorFetch = globalThis.fetch
  const priorImageData = globalThis.ImageData
  const priorCreateElement = globalThis.document.createElement
  const priorClipboard = globalThis.navigator?.clipboard
  const clipboardWrites = []
  let failClipboardWrite = false
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (failClipboardWrite) throw new Error('clipboard_denied')
          clipboardWrites.push(text)
        },
      },
    })
  }
  globalThis.ImageData = class {
    constructor(data, width, height) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
  globalThis.document.createElement = (tag) => {
    const node = priorCreateElement(tag)
    if (String(tag).toLowerCase() === 'canvas') {
      node.getContext = () => ({
        putImageData() {},
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      })
    }
    return node
  }
  try {
    const baseBlock = await f.api.getBlock('sel_project', 'doc_old', f.session.documents.get('doc_old').cels.c.block.sha256)
    sourceSha256 = baseBlock.sha256
    candidateRgba = new Uint8Array(baseBlock.bytes)
    candidateRgba[0] = 250
    candidateRgba[1] = 40
    candidateRgba[2] = 60
    candidateRgba[3] = 255
    candidateSha256 = await sha256Hex(candidateRgba)
    const rgbaHex = Array.from(candidateRgba, b => b.toString(16).padStart(2, '0')).join('')

    globalThis.fetch = async (url) => {
      if (String(url).includes(`/pixel-tools/${sessionId}`)) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              session_id: sessionId,
              saved: false,
              context: {
                project_id: 'sel_project',
                project_revision: f.session.project.revision,
                canvas_id: 'old',
                document_id: 'doc_old',
                working_revision: f.session.documents.get('doc_old').revision,
                frame_id: 'f',
                layer_id: 'l',
                cel_id: 'c',
                bridge_source: 'aseprite',
              },
              pixel_candidate: {
                width: 64,
                height: 64,
                rgba_hex: rgbaHex,
                sha256: candidateSha256,
                source_sha256: sourceSha256,
                bridge_source: 'aseprite',
                drawing_batches: 1,
                tool_calls: 1,
              },
            }
          },
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    // Client target precheck rejects slice metadata, user_data, and non-default timeline tags
    const docManifest = f.session.documents.get('doc_old')
    docManifest.slices = { version: 1, items: [{ id: 's1', name: 'Hitbox', x: 0, y: 0, w: 8, h: 8 }] }
    f.session.externalBridge.sync({ skipRefresh: true })
    assert.equal(f.harness.byId.get('vnext-external-connect').disabled, true)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /slice metadata/)
    delete docManifest.slices

    await f.session.externalBridge.refresh({ force: true })
    assert.match(f.harness.byId.get('vnext-external-availability').textContent, /Codex STDIO MCP: Available.*Aseprite CLI: Available/)
    assert.equal(f.harness.byId.get('vnext-external-connect').disabled, false)
    assert.equal(f.harness.byId.get('vnext-external-checkout').disabled, false)
    assert.match(f.harness.byId.get('vnext-external-meta').textContent, /Not authorized/)

    // Status-restored grant without usable credentials prompts reconnect and never displays bare 'node scripts/pixel-mcp-stdio.mjs'
    statusRestoredGrantWithoutToken = true
    await f.session.externalBridge.refresh({ force: true })
    assert.equal(f.harness.byId.get('vnext-external-handoff').hidden, true)
    assert.equal(f.harness.byId.get('vnext-external-handoff-value').value, '')
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Reconnect external tools to copy task-scoped MCP command/)
    assert.doesNotMatch(f.harness.byId.get('vnext-external-meta').textContent, /node scripts\/pixel-mcp-stdio\.mjs/)
    statusRestoredGrantWithoutToken = false

    // Connect external tools: unknown error preserves operationId -> retry succeeds -> handoff copy + clipboard failure fallback -> Revoke
    failConnectUnknownOnce = true
    await f.session.externalBridge.connect()
    assert.equal(connectOps.length, 1)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Connection status is uncertain/)

    await f.session.externalBridge.connect()
    assert.equal(connectOps.length, 2)
    assert.equal(connectOps[0], connectOps[1], 'connect unknown recovery reuses the exact same operation_id')
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Ready · Codex STDIO MCP authorized · Unsaved/)
    assert.equal(f.harness.byId.get('vnext-external-handoff').hidden, false)
    assert.equal(f.harness.byId.get('vnext-external-handoff-value').value, expectedMcpCmd)
    assert.equal(f.harness.byId.get('vnext-external-copy-handoff').textContent, 'Copy MCP command')
    const copiedMcp = await f.session.externalBridge.copyHandoff()
    assert.equal(copiedMcp, expectedMcpCmd)
    assert.equal(clipboardWrites.at(-1), expectedMcpCmd)
    assert.equal(f.harness.byId.get('vnext-external-copy-handoff').textContent, 'Copied MCP command')
    assert.equal(f.harness.byId.get('vnext-external-handoff-value').dataset.copyState, 'copied')

    // Clipboard failure falls back honestly to selectable text without claiming Copied
    failClipboardWrite = true
    const failedCopy = await f.session.externalBridge.copyHandoff()
    assert.equal(failedCopy, null)
    assert.equal(f.harness.byId.get('vnext-external-copy-handoff').textContent, 'Copy unavailable · Press Cmd/Ctrl+C')
    assert.equal(f.harness.byId.get('vnext-external-handoff-value').dataset.copyState, 'manual_fallback')
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Clipboard copy unavailable/)
    failClipboardWrite = false

    assert.equal(f.harness.byId.get('vnext-external-review').hidden, false)
    assert.equal(f.harness.byId.get('vnext-external-revoke').hidden, false)

    await f.session.externalBridge.revoke()
    assert.equal(revokedCalls.length, 1)
    assert.equal(revokedCalls[0].grantId, 'grant_mcp_1')
    assert.equal(f.harness.byId.get('vnext-external-handoff').hidden, true)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Revoked/)

    // Create external edit copy: unknown checkout error preserves checkoutOperationId -> retry -> handoff path -> unknown return error -> retry -> Discard preview (with initial retirement failure + retry) -> Save drawing (with initial retirement failure + retry)
    failCheckoutUnknownOnce = true
    await f.session.externalBridge.createCheckout()
    assert.equal(checkoutOps.length, 1)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Checkout status is uncertain/)

    await f.session.externalBridge.createCheckout()
    assert.equal(checkoutOps.length, 2)
    assert.equal(checkoutOps[0], checkoutOps[1], 'checkout unknown recovery reuses the exact same operation_id')
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /External edit copy ready/)
    assert.equal(f.harness.byId.get('vnext-external-handoff').hidden, false)
    assert.equal(f.harness.byId.get('vnext-external-handoff-value').value, '/tmp/gametool/chk_ase_1/working-copy.aseprite')
    assert.equal(f.harness.byId.get('vnext-external-copy-handoff').textContent, 'Copy .aseprite path')
    const copiedAsePath = await f.session.externalBridge.copyHandoff()
    assert.equal(copiedAsePath, '/tmp/gametool/chk_ase_1/working-copy.aseprite')
    assert.equal(f.harness.byId.get('vnext-external-copy-handoff').textContent, 'Copied .aseprite path')

    failReturnUnknownOnce = true
    await f.session.externalBridge.reviewReturned()
    assert.equal(returnOps.length, 1)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Return status is uncertain/)

    // Retry reviewReturned: reuses the exact same return operation_id and opens Preview external drawing modal with diff summary & diff canvas
    // Simulate server retirement failure on Discard preview first, then verify retry finishes discarding without reviving candidate
    failRevokeOnce = true
    const reviewPromiseDiscard = f.session.externalBridge.reviewReturned()
    for (let i = 0; i < 10 && f.harness.byId.get('vnext-confirm-dialog').hidden; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.equal(returnOps.length, 2)
    assert.equal(returnOps[0], returnOps[1], 'unknown return recovery reuses the exact same operation_id')
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false)
    assert.equal(f.harness.byId.get('vnext-confirm-title').textContent, 'Preview external drawing')
    assert.match(
      f.harness.byId.get('vnext-confirm-body').textContent,
      /Source: Aseprite \(\.aseprite\) return · Scope: Full 64×64 canvas · 1 px changed/,
    )
    const confirmDetails = f.harness.byId.get('vnext-confirm-details')
    assert.equal(confirmDetails.children.length, 2, 'renders both candidate preview canvas and difference preview canvas')
    assert.match(confirmDetails.children[1].className, /is-diff/)
    await f.harness.byId.get('vnext-confirm-secondary').dispatchEvent({ type: 'click' })
    await reviewPromiseDiscard
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Discard incomplete · Could not retire external candidate on server/)
    assert.ok(f.session.externalBridge.state.pendingRetirement, 'retains pendingRetirement when server discard fails')
    assert.equal(f.writes.length, 0, 'discarding preview does not write pixels')
    assert.equal(revokedCalls.length, 1, 'failed retirement call did not record completion yet')

    // A newly bound controller recovers the same tab intent after reload, without opening or saving the candidate.
    assert.equal(recoveryStorage.size, 1)
    assert.doesNotMatch([...recoveryStorage.values()].join(''), /bridge_token|tok_123|rgba|command/)
    f.session.externalBridge = bindExternalBridge({ root: f.harness.root, session: f.session, api: f.api })
    await f.session.externalBridge.refresh({ force: true })
    assert.equal(recoveryStorage.size, 0)
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, true)
    assert.equal(f.session.externalBridge.state.pendingRetirement, null)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Discarded/)
    assert.equal(revokedCalls.length, 2, 'Discard preview retry notifies server with discardOnly: true')
    assert.equal(revokedCalls[1].discardOnly, true)
    assert.equal(revokedCalls[1].checkoutId, 'chk_ase_1')
    assert.equal(revokedCalls[1].sessionId, sessionId)

    // Re-checkout, return, and Save drawing with initial server retirement failure -> retry finishes cleanup without writing pixels a second time
    await f.session.externalBridge.createCheckout()
    failRevokeOnce = true
    const reviewPromiseSave = f.session.externalBridge.reviewReturned()
    for (let i = 0; i < 10 && f.harness.byId.get('vnext-confirm-dialog').hidden; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.equal(f.harness.byId.get('vnext-confirm-dialog').hidden, false)
    await f.harness.byId.get('vnext-confirm-primary').dispatchEvent({ type: 'click' })
    await reviewPromiseSave
    assert.equal(f.writes.length, 1, 'Save drawing commits returned pixels once via real working-pixels writer')
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Saved locally · Server candidate cleanup failed/)
    assert.ok(f.session.externalBridge.state.pendingRetirement, 'retains pendingRetirement when post-save cleanup fails')

    failRevokeOnce = true
    const otherLink = await f.session.externalBridge.resumeRetirement({ projectId: 'other_project', sessionId: '55555555-5555-4555-8555-555555555555' })
    assert.equal(otherLink.error, true, 'a different direct link is blocked while older cleanup fails')
    assert.equal(f.writes.length, 1, 'changing review links cannot repeat or start a pixel save before cleanup')
    const savedIntent = JSON.parse([...recoveryStorage.values()][0])
    assert.equal(savedIntent.canvasId, 'old', 'cleanup stays bound to the original canvas')
    const resumed = await f.session.externalBridge.resumeRetirement({ projectId: 'sel_project', sessionId })
    assert.equal(resumed.error, false, 'direct review-link recovery uses the same retirement path')
    assert.equal(recoveryStorage.size, 0)
    assert.equal(f.writes.length, 1, 'retrying pending retirement after Save does not write pixels a second time')
    assert.equal(f.session.externalBridge.state.pendingRetirement, null)
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Saved/)
    assert.equal(revokedCalls.length, 3, 'Save drawing retry notifies server with discardOnly: true')
    assert.equal(revokedCalls[2].discardOnly, true)

    // Conflict detection when canvas revision advances after checkout
    await f.session.externalBridge.createCheckout()
    f.session.project = { ...f.session.project, revision: f.session.project.revision + 1 }
    await f.session.externalBridge.reviewReturned()
    assert.match(f.harness.byId.get('vnext-external-status').textContent, /Conflict/)
    assert.equal(f.writes.length, 1, 'conflict rejects review without saving pixels')
  } finally {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: priorClipboard,
      })
    }
    globalThis.fetch = priorFetch
    globalThis.ImageData = priorImageData
    globalThis.document.createElement = priorCreateElement
    f.harness.restore()
  }
})


test('a requested native Astra drawing on an imported original is applied once as an editable copy beside it, with one Undo entry', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64 })
  const restoreCanvas = stubSessionCanvas()
  try {
    // A whole-canvas write carries no offset; the fixture writer places it at the origin (as in the recovery tests).
    const baseWrite = f.api.writeWorkingPixels
    f.api.writeWorkingPixels = (projectId, documentId, request) => baseWrite(projectId, documentId, { x: 0, y: 0, ...request })
    const source = await f.session.preparePixelEdit()
    const rgba = source.rgba.slice(); rgba[0] = 250
    const candidate = { source_sha256: await sha256Hex(source.rgba), sha256: await sha256Hex(rgba), drawing_batches: 1 }
    f.session.openConfirm = () => { throw new Error('a requested drawing never opens a review') }
    const result = await f.session.reviewNativePixelCandidate(source, rgba, candidate)
    assert.equal(result.outcome, 'copied')
    assert.deepEqual(f.calls, ['derive', 'pixels', 'position'], 'derived, written and placed exactly once')
    assert.equal(f.calls.filter(call => call === 'derive').length, 1, 'the copy is derived once')
    assert.equal(f.docs.get('doc_new').cels.c.block.sha256, candidate.sha256, 'the copy holds exactly the candidate')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, f.firstSha, 'the imported original is unchanged')
    assert.equal(f.session.history.undo.length, 1)
  } finally { restoreCanvas(); f.harness.restore() }
})

test('a requested native blank Astra drawing saves in place without a decision step and Undo restores the original pixels', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64, nativeBlank: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const source = await f.session.preparePixelEdit({ scopeGrant: false })
    const rgba = source.rgba.slice(); rgba.set([250, 10, 20, 255])
    const candidate = { source_sha256: await sha256Hex(source.rgba), sha256: await sha256Hex(rgba), drawing_batches: 1 }
    f.session.openConfirm = () => { throw new Error('a requested drawing never opens a review') }
    const result = await f.session.reviewNativePixelCandidate(source, rgba, candidate)
    assert.equal(result.outcome, 'saved')
    assert.equal(f.calls.includes('derive'), false)
    assert.deepEqual(Object.keys(f.project.canvases), ['old'])
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, candidate.sha256)
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, candidate.source_sha256)
  } finally { restoreCanvas(); f.harness.restore() }
})

for (const size of [32, 64]) test(`selected ${size}px native blank drawing saves directly and undoes without a new canvas`, async () => {
  const f = await selectionSessionFixture({ boot: true, width: size, height: size, nativeBlank: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const source = await f.session.prepareBlankPixelDrawing(size)
    const rgba = source.rgba.slice(); rgba.set([250, 10, 20, 255])
    const undoBefore = f.session.latestUndoEntry()
    const save = await f.session.saveBlankPixelDrawing(source, rgba)
    assert.equal(save.saved, true)
    assert.equal(f.harness.byId.get('vnext-confirm-dialog')?.hidden ?? true, true, 'no save dialog opens')
    assert.notEqual(f.session.latestUndoEntry(), undoBefore, 'the save records one Undo entry')
    assert.equal(f.calls.includes('derive'), false); assert.deepEqual(Object.keys(f.project.canvases), ['old'])
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, await sha256Hex(rgba))
    await assert.rejects(f.session.prepareBlankPixelDrawing(size), { code: 'pixel_source_unsupported' })
    await f.key({ key: 'z', ctrlKey: true })
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, await sha256Hex(source.rgba))
  } finally { restoreCanvas(); f.harness.restore() }
})

test('a result\'s Undo reverts it only while it is still the latest change, never over a later edit', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 64, height: 64, nativeBlank: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const blank = await f.session.prepareBlankPixelDrawing(64)
    const first = blank.rgba.slice(); first.set([250, 10, 20, 255])
    assert.equal((await f.session.saveBlankPixelDrawing(blank, first)).saved, true)
    const entryA = f.session.latestUndoEntry()
    const source = await f.session.preparePixelEdit({ scopeGrant: false })
    const second = source.rgba.slice(); second.set([10, 200, 30, 255], 4)
    const candidate = { source_sha256: await sha256Hex(source.rgba), sha256: await sha256Hex(second), drawing_batches: 1 }
    assert.equal((await f.session.reviewNativePixelCandidate(source, second, candidate)).outcome, 'saved')
    const entryB = f.session.latestUndoEntry()
    assert.notEqual(entryB, entryA)
    assert.equal(await f.session.undoIfLatest(entryA), false, 'the earlier result is no longer the latest change')
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, candidate.sha256, 'the later edit is preserved')
    assert.equal(await f.session.undoIfLatest(entryB), true)
    assert.equal(f.docs.get('doc_old').cels.c.block.sha256, await sha256Hex(first), 'Undo reverted exactly the latest result')
  } finally { restoreCanvas(); f.harness.restore() }
})

test('selected blank drawing refuses imported originals even when their pixels are transparent', async () => {
  const f = await selectionSessionFixture({ boot: true, width: 32, height: 32 })
  try { await assert.rejects(f.session.prepareBlankPixelDrawing(32), { code: 'pixel_source_unsupported' }); assert.equal(f.writes.length, 0) }
  finally { f.harness.restore() }
})

test('P11 Toast preserves all 4 valid semantic SVG icons, omits separator dot on single-sentence notices, and binds live Figma 1970:130 node IDs', async () => {
  const f = await selectionSessionFixture({ boot: false })
  try {
    const toast = f.harness.byId.get('vnext-project-toast')
    const icon = f.harness.byId.get('vnext-project-toast-icon')
    const message = f.harness.byId.get('vnext-project-toast-message')
    const close = f.harness.byId.get('vnext-project-toast-close')

    // 1) Single-sentence Info notice: no body child, no .has-body class, no #icon-info-16 reference.
    f.session.showToast('Positions saved')
    assert.equal(toast.hidden, false)
    assert.equal(toast.dataset.toastTone, 'info')
    assert.equal(toast.dataset.figma, '1970:130')
    assert.equal(toast.dataset.figmaVariant, '1970:59')
    assert.equal(icon.dataset.figma, '1970:60')
    assert.equal(message.dataset.figma, '1970:63')
    assert.equal(close.dataset.figma, '1970:71')
    assert.equal(String(icon.innerHTML || '').includes('#icon-info-16'), false, 'never uses nonexistent #icon-info-16 symbol')
    assert.equal(String(icon.innerHTML || '').includes('vnext-toast-svg is-info'), true)
    assert.equal(String(icon.innerHTML || '').includes('vnext-toast-svg is-danger'), true, 'danger circle-X SVG remains intact')
    assert.equal(message.children.length, 1, 'single-sentence toast renders only the title span')
    assert.equal(message.children[0].className, 'vnext-project-toast-title', 'no .has-body separator class on single-sentence toast')
    assert.equal(message.children[0].textContent, 'Positions saved')

    // 2) Two-part Warning notice: .has-body class + .vnext-project-toast-body + Warning Figma IDs (1970:96 / 1970:97 / 1970:100 / 1970:107).
    f.session.showToast({
      key: 'assistant_service_unavailable',
      tone: 'warning',
      title: 'Local service unavailable',
      body: 'Draft kept. No message sent. Restart the service, then reload.',
    })
    assert.equal(toast.dataset.toastTone, 'warning')
    assert.equal(toast.dataset.figmaVariant, '1970:96')
    assert.equal(icon.dataset.figma, '1970:97')
    assert.equal(message.dataset.figma, '1970:100')
    assert.equal(close.dataset.figma, '1970:107')
    assert.equal(message.children.length, 2)
    assert.equal(message.children[0].className, 'vnext-project-toast-title has-body')
    assert.equal(message.children[1].className, 'vnext-project-toast-body')
    assert.equal(String(icon.innerHTML || '').includes('vnext-toast-svg is-warning'), true)
  } finally {
    f.harness.restore()
  }
})

test('a canvas placed by another writer records one Undo entry for exactly that canvas; replays reuse it and Undo detaches only it', async () => {
  const f = await selectionSessionFixture({ boot: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const projectId = f.session.project.id
    const detached = []
    const baseDetach = f.api.detachCanvas
    f.api.detachCanvas = async (p, canvasId, body) => { detached.push(canvasId); const res = await baseDetach(p, canvasId, body); f.session.project = res.project; return res }
    const entry = f.session.recordCanvasAddition({ projectId, canvasId: 'old' })
    assert.equal(entry.kind, 'import')
    assert.equal(entry.canvasId, 'old')
    assert.equal(f.session.recordCanvasAddition({ projectId, canvasId: 'old' }), entry, 'a replayed placement returns the same entry')
    assert.equal(f.session.history.undo.filter(item => item.canvasId === 'old').length, 1)
    assert.equal(f.session.recordCanvasAddition({ projectId, canvasId: 'missing' }), null, 'a canvas the shown project lacks gets no entry')
    assert.equal(f.session.recordCanvasAddition({ projectId: 'another', canvasId: 'old' }), null)
    assert.equal(f.session.latestUndoEntry(), entry)
    assert.equal(await f.session.undoIfLatest(entry), true)
    assert.deepEqual(detached, ['old'], 'Undo detaches exactly the placed canvas')
  } finally { restoreCanvas(); f.harness.restore() }
})

// r8: after Undo and a page reload the in-memory history is empty. The record this page kept when its own
// Undo detached a result's canvas puts that same canvas back through the existing canvas restore (the
// recorded detach request; no asset, document or other canvas changes), and the next Undo removes it.
test('r8: Put back restores the same canvas from this page\'s own Undo record after a reload, and the next Undo removes it again', async () => {
  const f = await selectionSessionFixture({ boot: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const projectId = f.session.project.id
    const original = { ...f.session.project.canvases.old }
    let server = f.project
    const memory = new Map()
    f.session.undonePlacements = createUndonePlacementStore(() => ({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) }))
    const receipts = new Map(), sent = []
    let restoreFault = null, lockSeen = null
    f.api.getProject = async () => ({ ok: true, project: server, stale: false })
    f.api.detachCanvas = async (_p, canvasId, body) => {
      sent.push({ kind: 'detach', canvasId, ...body })
      const canvases = { ...server.canvases }
      const removed = canvases[canvasId]
      delete canvases[canvasId]
      server = { ...server, revision: server.revision + 1, canvases }
      const receipt = { operation_id: body.operationId, project_id: projectId, project_revision: server.revision, detached_canvas: { canvas: removed } }
      receipts.set(body.operationId, receipt)
      return { project: server, receipt }
    }
    f.api.restoreCanvas = async (_p, canvasId, body) => {
      sent.push({ kind: 'restore', canvasId, ...body })
      lockSeen = f.session.pendingImport?.kind || null
      if (receipts.has(body.operationId)) return { project: server, receipt: receipts.get(body.operationId) } // the server replays its receipt
      const fault = restoreFault
      restoreFault = null
      if (fault && !fault.commit) throw Object.assign(new Error(fault.code), fault)
      if (body.expectedRevision !== server.revision) throw Object.assign(new Error('stale'), { kind: 'stale', code: 'stale_revision' })
      const recorded = receipts.get(body.detachOperationId)?.detached_canvas?.canvas
      if (!recorded || recorded.id !== canvasId) throw Object.assign(new Error('detach operation does not record this canvas'), { kind: 'known_reject', code: 'not_found' })
      server = { ...server, revision: server.revision + 1, canvases: { ...server.canvases, [canvasId]: recorded } }
      const receipt = { operation_id: body.operationId, project_id: projectId, project_revision: server.revision }
      receipts.set(body.operationId, receipt)
      if (fault?.commit) throw Object.assign(new Error('lost'), { kind: 'unknown' }) // committed, answer lost
      return { project: server, receipt }
    }
    const simulateReload = () => { f.session.history = { projectId, undo: [], redo: [], pixelHeads: new Map() } }

    const entry = f.session.recordCanvasAddition({ projectId, canvasId: 'old', jobId: 'job_sheet' })
    assert.deepEqual(entry.placement, { jobId: 'job_sheet' })
    assert.equal(await f.session.undoIfLatest(entry), true)
    const detachId = sent.at(-1).operationId
    assert.equal(f.session.project.canvases.old, undefined)
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }), null, 'while the history holds the canvas, its Redo owns it')
    // A preset add reads the shown revision only once no canvas write is still being sent.
    assert.equal(f.session.canvasWriteInFlight(), false)
    f.session.pendingSave = true
    assert.equal(f.session.canvasWriteInFlight(), true, 'a save still being written')
    f.session.pendingSave = false
    f.session.historyBusy = true
    assert.equal(f.session.canvasWriteInFlight(), true, 'an Undo still being written')
    f.session.historyBusy = false
    f.session.manualWrite = { kind: 'document-candidate' }
    assert.equal(f.session.canvasWriteInFlight(), false, 'a preview awaiting Apply is not a write in flight')
    f.session.manualWrite = null
    simulateReload()
    assert.deepEqual(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }),
      { projectId, canvasId: 'old', documentId: 'doc_old', detachOperationId: detachId, jobId: 'job_sheet' }, 'the record names exactly that canvas and detach')

    // Busy: nothing is sent. Another change landed first: the newest project is shown, nothing is put back.
    f.session.pendingSave = true
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'retry' })
    f.session.pendingSave = false
    assert.equal(sent.filter(item => item.kind === 'restore').length, 0)
    server = { ...server, revision: server.revision + 1 }
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'changed' })
    assert.equal(f.session.project.revision, server.revision, 'the newest project is shown')
    assert.equal(f.session.project.canvases.old, undefined)
    // Committed but unconfirmed: the same request is sent again and the server replays it.
    restoreFault = { commit: true }
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'unknown' })
    // Unresolved, it holds no lock (no other canvas write waits on it, in this or another project); its
    // record stays offered and Put back sends the same request again.
    assert.equal(f.session.pendingImport, false)
    assert.equal(f.session.canvasWriteInFlight(), false)
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' })?.canvasId, 'old')
    const shownBeforeSwitch = f.session.project
    await f.session.reloadProject({ id: 'sel_other', revision: 1, canvases: {} })
    assert.equal(f.session.pendingImport, false, 'another project is never blocked by it')
    await f.session.reloadProject(shownBeforeSwitch)
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' })?.canvasId, 'old', 'the record stays with its project')
    const restored = await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' })
    const restores = sent.filter(item => item.kind === 'restore')
    assert.equal(restores.at(-1).operationId, restores.at(-2).operationId, 'an unconfirmed restore is resent exactly')
    assert.equal(restores.at(-1).expectedRevision, restores.at(-2).expectedRevision)
    assert.ok(restores.every(item => item.canvasId === 'old' && item.detachOperationId === detachId), 'only the recorded canvas and detach are used')
    assert.equal(lockSeen, 'restore-undone-placement', 'the restore holds the write lock')
    assert.equal(restored.outcome, 'restored')
    assert.equal(restored.canvasId, 'old')
    assert.equal(f.session.pendingImport, false)
    assert.deepEqual(f.session.project.canvases.old, original, 'the same canvas is back where it was')
    assert.ok(f.session.view.canvases.some(canvas => canvas.id === 'old' && !canvas.transient))
    assert.deepEqual(Object.keys(f.session.project.sprite_documents), ['doc_old'], 'no document or asset was added')
    assert.equal(f.calls.includes('derive'), false)
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }), null, 'the record ends once the canvas is back')
    // The restored canvas is the newest Undo entry: Undo removes exactly it again (and keeps a new record).
    assert.equal(f.session.latestUndoEntry(), restored.entry)
    assert.deepEqual(restored.entry.placement, { jobId: 'job_sheet' })
    assert.equal(await f.session.undoIfLatest(restored.entry), true)
    assert.deepEqual({ kind: sent.at(-1).kind, canvasId: sent.at(-1).canvasId }, { kind: 'detach', canvasId: 'old' })
    simulateReload()
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }).detachOperationId, sent.at(-1).operationId)
    // A refused record ends without another request being retried.
    restoreFault = { kind: 'known_reject', code: 'not_found' }
    const secondDetach = sent.at(-1).operationId
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'refused', limit: false })
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }), null)
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'unavailable' })
    // Confirmed, but the restored project could not be read: it is reported as put back (this view did
    // not reload), never as unconfirmed, and the lock is released.
    f.session.undonePlacements.remember({ projectId, canvasId: 'old', documentId: 'doc_old', detachOperationId: secondDetach, jobId: 'job_sheet' })
    const listDocuments = f.api.listDocuments
    f.api.listDocuments = async () => { f.api.listDocuments = listDocuments; throw Object.assign(new Error('Documents could not be read.'), { kind: 'unknown' }) }
    assert.deepEqual(await f.session.restoreUndonePlacement({ projectId, jobId: 'job_sheet' }), { outcome: 'restored', shown: false })
    assert.ok(server.canvases.old, 'the server holds the restored canvas')
    assert.equal(f.session.undonePlacementFor({ projectId, jobId: 'job_sheet' }), null, 'its record ended')
    assert.equal(f.session.pendingImport, false)
  } finally { restoreCanvas(); f.harness.restore() }
})

test('N4 project reference library promotes saved frames/cels, blocks unsaved drafts, persists across reopen, toggles up to 8 active references, revokes, and binds prepareDocumentEdit scope', async () => {
  const f = await selectionSessionFixture({ boot: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const promotedPayloads = []
    const revokedCalls = []
    let refCounter = 0

    // Add a second frame to doc_old so frame-scope locking can be tested
    const doc = f.docs.get('doc_old')
    doc.frame_order = ['f', 'f2']
    doc.frames.f = { id: 'f', duration_ms: 125 }
    doc.frames.f2 = { id: 'f2', duration_ms: 125 }
    doc.layers.l = { id: 'l', name: 'Body', kind: 'raster', visible: true, locked: false }
    doc.cels.c = { id: 'c', frame_id: 'f', layer_id: 'l', block: doc.cels.c.block }
    doc.cels.c2 = { id: 'c2', frame_id: 'f2', layer_id: 'l', block: doc.cels.c.block }
    doc.revision = 2
    let currentProject = {
      ...f.project,
      sprite_documents: { doc_old: { working_revision: 2 } },
    }
    await f.session.reloadProject(currentProject)
    f.session.view.select('old')
    f.session.conversationRef = { projectId: currentProject.id, canvasId: 'old', documentId: 'doc_old' }

    f.api.promoteReference = async (pid, body) => {
      promotedPayloads.push({ pid, body })
      const reference = {
        id: `ref_000${++refCounter}`,
        name: body.name || `Ref ${refCounter}`,
        purpose: body.purpose || (body.sourceKind === 'cel' ? 'cel' : 'frame'),
        status: 'active',
        source_kind: body.sourceKind,
        source_canvas_id: body.canvasId,
        source_document_id: body.documentId,
        source_working_revision: body.expectedWorkingRevision,
        source_frame_id: body.frameId,
        source_layer_id: body.layerId || null,
        source_cel_id: body.celId || null,
        width: 4,
        height: 2,
        rgba_sha256: f.firstSha,
        manifest_sha256: 'b'.repeat(64),
        created_at: '2026-10-21T00:00:00.000Z',
        revoked_at: null,
      }
      const nextRefs = [...(currentProject.references || []), reference]
      currentProject = { ...currentProject, revision: currentProject.revision + 1, references: nextRefs }
      return {
        project: currentProject,
        reference,
        receipt: { operation_id: body.operationId, project_id: pid, project_revision: currentProject.revision },
      }
    }
    f.api.revokeReference = async (pid, refId, body) => {
      revokedCalls.push({ pid, refId, body })
      const nextRefs = (currentProject.references || []).map(r => r.id === refId ? { ...r, status: 'revoked', revoked_at: '2026-10-21T00:01:00.000Z' } : r)
      currentProject = { ...currentProject, revision: currentProject.revision + 1, references: nextRefs }
      return {
        project: currentProject,
        reference: nextRefs.find(r => r.id === refId),
        receipt: { operation_id: body.operationId, project_id: pid, project_revision: currentProject.revision },
      }
    }

    // 1) In-progress edit (manualGesture / manualWrite) blocks reference promotion
    f.session.manualGesture = { kind: 'stroke' }
    const blockedRef = await f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f' })
    assert.deepEqual(blockedRef, { ok: false, reason: 'busy' })
    assert.equal(promotedPayloads.length, 0)
    assert.match(f.harness.byId.get('vnext-reference-status').textContent, /Finish the current edit before saving a project reference/)
    f.session.manualGesture = null

    // 2) Promote frame composite + cel references; both become active for the turn and render in the library + composer scope bar
    const res1 = await f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f', name: 'Hero idle F1' })
    assert.equal(res1.ok, true)
    assert.equal(res1.reference.id, 'ref_0001')
    assert.equal(promotedPayloads.length, 1)
    assert.equal(promotedPayloads[0].body.sourceKind, 'frame_composite')
    assert.equal(promotedPayloads[0].body.frameId, 'f')

    const res2 = await f.session.promoteProjectReference({ sourceKind: 'cel', frameId: 'f2', layerId: 'l', name: 'Body F2 cel' })
    assert.equal(res2.ok, true)
    assert.equal(res2.reference.id, 'ref_0002')
    assert.equal(promotedPayloads.length, 2)
    assert.equal(promotedPayloads[1].body.sourceKind, 'cel')
    assert.equal(promotedPayloads[1].body.layerId, 'l')

    assert.deepEqual(f.session.activeReferenceIds(), ['ref_0001', 'ref_0002'])
    const refList = f.harness.byId.get('vnext-reference-list')
    assert.equal(refList.children.length, 2, 'renders 2 active reference rows in right-rail library')
    assert.equal(f.harness.byId.get('vnext-reference-count').textContent, '2 in turn · 2/64')

    const scopeBar = f.harness.byId.get('vnext-document-scope-bar')
    assert.equal(scopeBar.hidden, false, 'composer scope bar is visible when references are active')

    // 3) Reopen project: saved references remain in project.references and active selection is preserved
    await f.session.reloadProject(currentProject)
    f.session.view.select('old')
    f.session.conversationRef = { projectId: currentProject.id, canvasId: 'old', documentId: 'doc_old' }
    assert.equal(f.session.project.references.length, 2)
    assert.deepEqual(f.session.activeReferenceIds(), ['ref_0001', 'ref_0002'])

    // 4) Toggle reference off and back on; revoke ref_0001 removes it from active selection and list
    f.session.toggleActiveReference('ref_0002')
    assert.deepEqual(f.session.activeReferenceIds(), ['ref_0001'])
    f.session.toggleActiveReference('ref_0002')
    assert.deepEqual(f.session.activeReferenceIds(), ['ref_0001', 'ref_0002'])

    const revoked = await f.session.revokeProjectReference('ref_0001')
    assert.equal(revoked.ok, true)
    assert.equal(revoked.reference.status, 'revoked')
    assert.equal(revokedCalls.length, 1)
    assert.deepEqual(f.session.activeReferenceIds(), ['ref_0002'])
    assert.equal(refList.children.length, 1, 'revoked reference is removed from active library list')

    // 5) prepareDocumentEdit includes active referenceIds and timeline editableFrameIds / lockedFrameIds
    f.session.documentTimeline = {
      stop() {},
      editableFrameIds: () => ['f2'],
      lockedFrameIds: () => ['f'],
    }
    const prepared = await f.session.prepareDocumentEdit()
    assert.deepEqual(prepared.editableFrameIds, ['f2'])
    assert.deepEqual(prepared.lockedFrameIds, ['f'])
    assert.deepEqual(prepared.referenceIds, ['ref_0002'])
  } finally {
    restoreCanvas()
    f.harness.restore()
  }
})

test('R2, R4 & R5: last editable frame stays scoped in next request, unknown promote/revoke recovers same operation across clicks/project switches, and 64-record capacity distinguishes active vs occupied records', async () => {
  const f = await selectionSessionFixture({ boot: true })
  const restoreCanvas = stubSessionCanvas()
  try {
    const doc = f.docs.get('doc_old')
    doc.frame_order = ['f', 'f2']
    doc.frames.f = { id: 'f', duration_ms: 125 }
    doc.frames.f2 = { id: 'f2', duration_ms: 125 }
    doc.layers.l = { id: 'l', name: 'Body', kind: 'raster', visible: true, locked: false }
    doc.cels.c = { id: 'c', frame_id: 'f', layer_id: 'l', block: doc.cels.c.block }
    doc.cels.c2 = { id: 'c2', frame_id: 'f2', layer_id: 'l', block: doc.cels.c.block }
    doc.revision = 2
    let currentProject = {
      ...f.project,
      sprite_documents: { doc_old: { working_revision: 2 } },
      references: [],
    }
    await f.session.reloadProject(currentProject)
    f.session.view.select('old')
    f.session.conversationRef = { projectId: currentProject.id, canvasId: 'old', documentId: 'doc_old' }

    // R2: Mount real bindDocumentTimeline, scope to F2 via Alt+click, attempt to exclude last editable frame F2
    // via Alt+click and menu, and verify timeline chip, composer pill, and prepareDocumentEdit all keep ['f2']
    const makeDomNode = node => {
      node.style.setProperty = (k, v) => { node.style[k] = v }
      Object.defineProperty(node, 'innerHTML', {
        configurable: true,
        get() { return this.markup || '' },
        set(v) {
          this.markup = v
          this.replaceChildren()
          if (String(v).includes('<use')) {
            const useNode = makeDomNode(globalThis.document.createElement('use'))
            this.append(useNode)
          }
        },
      })
      node.insertBefore = (child, ref) => {
        child.parentNode = node
        const idx = node.children.indexOf(ref)
        if (idx >= 0) node.children.splice(idx, 0, child)
        else node.children.push(child)
      }
      node.remove ??= () => {
        const p = node.parentNode
        if (!p) return
        const idx = p.children.indexOf(node)
        if (idx >= 0) p.children.splice(idx, 1)
        node.parentNode = null
      }
      node.replaceWith = next => {
        const p = node.parentNode
        if (!p) return
        const idx = p.children.indexOf(node)
        if (idx >= 0) {
          next.parentNode = p
          p.children.splice(idx, 1, next)
          node.parentNode = null
        }
      }
      node.cloneNode = deep => {
        const copy = makeDomNode(globalThis.document.createElement(node.tagName))
        copy.className = node.className
        copy.dataset = { ...node.dataset }
        copy.attributes = new Map(node.attributes)
        copy.markup = node.markup
        if (deep) node.children.forEach(c => copy.append(makeDomNode(c).cloneNode(true)))
        return copy
      }
      return node
    }
    const origCreateElement = globalThis.document.createElement.bind(globalThis.document)
    globalThis.document.createElement = tag => makeDomNode(origCreateElement(tag))
    globalThis.document.addEventListener ??= () => {}
    globalThis.window ??= {}
    globalThis.window.addEventListener ??= () => {}
    const layerCol = makeDomNode(f.harness.byId.get('vnext-layer-col'))
    makeDomNode(f.harness.byId.get('vnext-frame-cols'))
    const templateRow = makeDomNode(origCreateElement('div'))
    templateRow.className = 'vnext-layer-row'
    for (let i = 0; i < 2; i += 1) {
      const icon = makeDomNode(origCreateElement('button'))
      icon.className = 'vnext-layer-icon'
      icon.innerHTML = '<svg><use/></svg>'
      templateRow.append(icon)
    }
    const linkIcon = makeDomNode(origCreateElement('button'))
    linkIcon.dataset.capability = 'TIME-07'
    linkIcon.innerHTML = '<svg><use/></svg>'
    templateRow.append(linkIcon)
    const nameSpan = makeDomNode(origCreateElement('span'))
    nameSpan.className = 'vnext-layer-name'
    templateRow.append(nameSpan)
    const addLayerBtn = makeDomNode(origCreateElement('button'))
    addLayerBtn.setAttribute('aria-label', 'Add layer')
    layerCol.replaceChildren(templateRow, addLayerBtn)
    const timelineFallbackNodes = new Map()
    for (const sel of [
      '.vnext-grid',
      '.vnext-selected-row',
      '.vnext-play-current',
      '.vnext-play-total',
      '.vnext-playback-params-start .vnext-text-btn span',
      '#vnext-timeline-tags',
      '#vnext-timeline-menu',
      '#vnext-confirm-dialog',
      '#vnext-confirm-details',
      '#vnext-confirm-primary',
      '#vnext-confirm-secondary',
    ]) {
      const existing = f.harness.root.querySelector(sel)
      timelineFallbackNodes.set(sel, makeDomNode(existing || origCreateElement('div')))
    }
    const tagsBar = timelineFallbackNodes.get('#vnext-timeline-tags')
    const timelineRoot = {
      querySelector: sel => f.harness.root.querySelector(sel) || timelineFallbackNodes.get(sel) || null,
      querySelectorAll: sel => (sel === '.vnext-play-nav button' ? [] : (f.harness.root.querySelectorAll?.(sel) || [])),
    }
    f.session.documentTimeline = bindDocumentTimeline({
      root: timelineRoot,
      session: f.session,
      command: async () => ({ ok: true }),
      compose: async () => ({}),
      renderCanvas: () => f.session.renderCanvas(),
      renderPlaybackState: () => f.session.renderCanvas(),
      confirm: () => {},
      closeConfirm: () => {},
      status: () => {},
      historyPending: () => false,
      promoteReference: opts => f.session.promoteProjectReference(opts),
      onScopeChange: () => f.session.renderCanvas(),
    })
    f.session.documentTimeline.render()

    const f2Header = f.harness.byId.get('vnext-frame-cols').children[1].children[0]
    f2Header.onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
    assert.deepEqual(f.session.documentTimeline.editableFrameIds(), ['f2'])
    f2Header.onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
    assert.deepEqual(f.session.documentTimeline.editableFrameIds(), ['f2'], 'last editable frame cannot be excluded to unlock all')
    const timelineScopeChip = tagsBar.children.find(n => n.dataset?.timelineScope === 'subset')
    assert.equal(timelineScopeChip?.textContent, 'Revise F2 · Lock F1 ×')
    const scopeBar = f.harness.byId.get('vnext-document-scope-bar')
    assert.equal(scopeBar.hidden, false)
    assert.match(scopeBar.children[0].textContent, /Scope: 1\/2 frames \(1 locked\)/)
    const preparedScoped = await f.session.prepareDocumentEdit()
    assert.deepEqual(preparedScoped.editableFrameIds, ['f2'])
    assert.deepEqual(preparedScoped.lockedFrameIds, ['f'])

    // R4: Promote disconnects with unknown result -> shows Verify pending save, blocks duplicate promote,
    // and recovers using the exact same operationId & payload
    const promoteCalls = []
    let failPromoteOnce = true
    f.api.promoteReference = async (pid, body) => {
      promoteCalls.push({ pid, body: structuredClone(body) })
      if (failPromoteOnce) {
        failPromoteOnce = false
        throw Object.assign(new Error('network drop'), { kind: 'unknown', request: body })
      }
      const reference = {
        id: 'ref_recovered_1',
        name: body.name || 'Recovered F1',
        purpose: body.purpose || 'frame',
        status: 'active',
        source_kind: body.sourceKind,
        width: 4,
        height: 2,
        rgba_sha256: f.firstSha,
        manifest_sha256: 'b'.repeat(64),
      }
      currentProject = {
        ...currentProject,
        revision: currentProject.revision + 1,
        references: [...(currentProject.references || []), reference],
      }
      return {
        project: currentProject,
        reference,
        receipt: { operation_id: body.operationId, project_id: pid, project_revision: currentProject.revision },
      }
    }

    const firstPromote = await f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f', name: 'Hero F1' })
    assert.equal(firstPromote.ok, false)
    assert.equal(firstPromote.unknown, true)
    assert.equal(promoteCalls.length, 1)
    const recoverBtn = f.harness.byId.get('vnext-recover-reference')
    assert.equal(recoverBtn.hidden, false, 'Verify pending save button is shown on unknown promote')
    assert.equal(recoverBtn.textContent, 'Verify pending save')
    assert.equal(f.harness.byId.get('vnext-promote-frame-ref').disabled, true)
    assert.equal(f.harness.byId.get('vnext-promote-cel-ref').disabled, true)

    // Clicking or calling promote again while pending does not create a new operationId or call API
    const blockedDuplicatePromote = await f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f', name: 'Hero F1' })
    assert.equal(blockedDuplicatePromote.ok, false)
    assert.equal(blockedDuplicatePromote.reason, 'pending_recovery')
    assert.equal(blockedDuplicatePromote.operationId, firstPromote.operationId)
    assert.equal(promoteCalls.length, 1)

    // Recover via Verify pending save button replays the exact same operationId and payload
    const recoveredPromote = await f.session.resolvePendingReference()
    assert.equal(recoveredPromote.ok, true)
    assert.equal(recoveredPromote.recovered, true)
    assert.equal(promoteCalls.length, 2)
    assert.deepEqual(promoteCalls[1], promoteCalls[0])
    assert.equal(recoverBtn.hidden, true)
    assert.equal(f.session.project.references.length, 1)
    assert.deepEqual(f.session.activeReferenceIds(), ['ref_recovered_1'])

    // R4: Revoke disconnects with unknown result -> shows Verify pending revoke, blocks concurrent writes,
    // and recovers using the exact same operationId & payload
    const revokeCalls = []
    let failRevokeOnce = true
    f.api.revokeReference = async (pid, refId, body) => {
      revokeCalls.push({ pid, refId, body: structuredClone(body) })
      if (failRevokeOnce) {
        failRevokeOnce = false
        throw Object.assign(new Error('network drop'), { kind: 'unknown', request: body })
      }
      const nextRefs = (currentProject.references || []).map(r => r.id === refId ? { ...r, status: 'revoked' } : r)
      currentProject = { ...currentProject, revision: currentProject.revision + 1, references: nextRefs }
      return {
        project: currentProject,
        reference: nextRefs.find(r => r.id === refId),
        receipt: { operation_id: body.operationId, project_id: pid, project_revision: currentProject.revision },
      }
    }

    const firstRevoke = await f.session.revokeProjectReference('ref_recovered_1')
    assert.equal(firstRevoke.ok, false)
    assert.equal(firstRevoke.unknown, true)
    assert.equal(revokeCalls.length, 1)
    assert.equal(recoverBtn.hidden, false)
    assert.equal(recoverBtn.textContent, 'Verify pending revoke')

    const blockedSecondRevoke = await f.session.revokeProjectReference('ref_recovered_1')
    assert.equal(blockedSecondRevoke.ok, false)
    assert.equal(blockedSecondRevoke.reason, 'pending_recovery')
    assert.equal(revokeCalls.length, 1)

    const recoveredRevoke = await f.session.resolvePendingReference()
    assert.equal(recoveredRevoke.ok, true)
    assert.equal(recoveredRevoke.recovered, true)
    assert.equal(revokeCalls.length, 2)
    assert.deepEqual(revokeCalls[1], revokeCalls[0])
    assert.equal(recoverBtn.hidden, true)
    assert.deepEqual(f.session.activeReferenceIds(), [])

    // R4: Late response from old project after project switch cannot overwrite new project, drafts, or selection
    let resolveLatePromote
    f.api.promoteReference = () => new Promise(resolve => { resolveLatePromote = resolve })
    const inFlightPromote = f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f', name: 'Late A Ref' })
    const projectB = {
      ...currentProject,
      id: 'proj_b',
      name: 'Project B',
      revision: 10,
      references: [],
    }
    f.api.openEpoch.next()
    await f.session.reloadProject(projectB)
    f.session.view.select('old')
    f.session.view.drafts.old = { x: 44, y: 55 }
    resolveLatePromote({
      project: { ...currentProject, revision: 99 },
      reference: { id: 'ref_late_a', name: 'Late A Ref', status: 'active', purpose: 'frame', width: 4, height: 2 },
      receipt: { operation_id: 'op_late' },
    })
    const lateResult = await inFlightPromote
    assert.equal(lateResult.ok, false)
    assert.equal(lateResult.reason, 'stale')
    assert.equal(f.session.project.id, 'proj_b')
    assert.equal(f.session.project.revision, 10)
    assert.deepEqual(f.session.view.drafts.old, { x: 44, y: 55 }, 'late response from old project does not clear current drafts')
    assert.equal(f.session.view.selectedId, 'old')
    assert.deepEqual(f.session.activeReferenceIds(), [])

    // R5: 64-record capacity display distinguishes active vs total occupied records when revoked records exist
    const sixtyFourRefs = Array.from({ length: 64 }, (_, i) => ({
      id: `ref_cap_${i + 1}`,
      name: `Cap Ref ${i + 1}`,
      purpose: 'frame',
      status: i === 0 ? 'revoked' : 'active',
      source_kind: 'frame_composite',
      width: 4,
      height: 2,
      rgba_sha256: f.firstSha,
      manifest_sha256: 'b'.repeat(64),
    }))
    delete f.session.view.drafts.old
    await f.session.reloadProject({
      ...projectB,
      revision: 11,
      references: sixtyFourRefs,
    })
    f.session.view.select('old')
    assert.equal(f.harness.byId.get('vnext-reference-count').textContent, '63 active · 64/64 records')
    assert.equal(f.harness.byId.get('vnext-promote-frame-ref').disabled, true)
    assert.equal(f.harness.byId.get('vnext-promote-cel-ref').disabled, true)
    assert.match(f.harness.byId.get('vnext-promote-frame-ref').title, /64\/64 records.*do not free slots/i)
    assert.match(f.harness.byId.get('vnext-reference-status').textContent, /64\/64 reference records used \(63 active, 1 revoked\)/)
    const overCapPromote = await f.session.promoteProjectReference({ sourceKind: 'frame_composite', frameId: 'f' })
    assert.equal(overCapPromote.ok, false)
    assert.equal(overCapPromote.reason, 'reference_limit')
  } finally {
    restoreCanvas()
    f.harness.restore()
  }
})
