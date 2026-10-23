import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  assignCharacterAiReference,
  CHARACTER_AI_REFERENCE_MAX_BYTES,
  CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES,
  clearCharacterAiReference,
  collectCharacterAiReviewInput,
  handleCharacterAiComposerSubmit,
  inspectStudioCharacterAiComposer,
  inspectStudioCharacterState,
  initStudioCharacter,
  readCharacterAiReferenceFile,
  renderStudioCharacterLanguage,
  seedStudioCharacterStateForTest,
  switchStudioCharacterSource,
} from '../src/ui/studio/characterView.js'
import { STRICT_FIXED_REGION_PROFILE } from '../src/ui/studio/characterApi.js'
import { setCurrentLanguage } from '../src/ui/i18n.js'
import { setStudioProviderSnapshotForTest, STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'

const PLAN_HASH = '1'.repeat(64)
const REFERENCE_HASH = '2'.repeat(64)
const REVIEW_ID = 'generation_review_composer_test'
const GEMINI_PRESET_ID = 'gemini-native-test'
const RAW_PROVIDER_OUTPUT_URL = '/generated/job_done/raw_provider_output.png'
const PENDING_SELECTOR = Object.freeze({ jobId: 'job_done', reviewId: 'generation_review_done' })

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sealedReview() {
  return {
    mode: 'provider_free_generation_review',
    status: 'done',
    generation_profile_id: STRICT_FIXED_REGION_PROFILE.generationProfileId,
    review_id: REVIEW_ID,
    reviewed_run_id: REVIEW_ID,
    plan_hash: PLAN_HASH,
    reference_manifest_sha256: REFERENCE_HASH,
    provider: { provider: 'gemini', route_kind: 'google_native', model: 'gemini-test-model' },
    model: 'gemini-test-model',
    image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    candidate_count: 1,
    estimated_provider_calls: 1,
    provider_calls_used: 0,
    max_provider_calls: 1,
    generation_review_url: `/generated/${REVIEW_ID}/generation_review.json`,
    generation_request_manifest_url: `/generated/${REVIEW_ID}/generation_request_manifest.json`,
    generation_reference_manifest_url: `/generated/${REVIEW_ID}/generation_reference_manifest.json`,
    generation_prompt_url: `/generated/${REVIEW_ID}/generation_prompt.txt`,
    reference_urls: [{
      name: 'generation_structure.png',
      role: 'structure',
      url: `/generated/${REVIEW_ID}/generation_structure.png`,
    }],
  }
}

function strictGeminiState(overrides = {}) {
  return {
    status: 'ready',
    active_preset_id: GEMINI_PRESET_ID,
    presets: [{
      id: GEMINI_PRESET_ID,
      available: true,
      provider: 'gemini',
      route_kind: 'google_native',
      model: 'gemini-test-model',
      supports_image_size: true,
      image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
    }],
    ...overrides,
  }
}

function createComposerDocument() {
  const nodes = new Map()
  const createNode = (id, tag = 'div') => {
    const listeners = new Map()
    const attrs = new Map()
    const node = {
      id,
      tagName: tag.toUpperCase(),
      hidden: false,
      disabled: false,
      value: '',
      required: false,
      files: null,
      textContent: '',
      dataset: {},
      style: {},
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false } },
      getAttribute: (name) => (name === 'src' ? node.src : attrs.get(name) ?? null),
      setAttribute: (name, value) => {
        attrs.set(name, String(value))
        if (name === 'src') node.src = value
        if (name === 'id') {
          node.id = String(value)
          if (value) nodes.set(value, node)
        }
      },
      querySelector(selector) {
        if (selector === 'path') {
          return {
            getAttribute: (name) => ({
              d: 'M5 8l5 5 5-5',
              stroke: '#94a3b8',
              'stroke-width': '1.8',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            }[name] ?? null),
          }
        }
        if (selector === 'svg') {
          return {
            getAttribute: (name) => (name === 'width' || name === 'height' ? '14' : null),
            style: { transform: '' },
          }
        }
        return null
      },
      removeAttribute: (name) => { attrs.delete(name); if (name === 'src') node.src = '' },
      addEventListener: (type, fn) => {
        const list = listeners.get(type) || []
        list.push(fn)
        listeners.set(type, list)
      },
      dispatchEvent: (event) => {
        for (const fn of listeners.get(event.type) || []) fn({ ...event, currentTarget: node, preventDefault() { event.preventDefault?.() } })
      },
      focus() {},
      querySelectorAll() { return [] },
      closest(selector) {
        if (selector === '[role="option"]' && node.getAttribute?.('role') === 'option') return node
        return null
      },
      children: [],
      options: [],
      replaceChildren(...next) {
        node.children = next
        node.options = next
      },
    }
    if (id) nodes.set(id, node)
    return node
  }
  const ids = [
    'studio-character-view', 'character-ai-form', 'character-description', 'character-preset',
    'character-model', 'character-reference-mode', 'character-ai-refs',
    'character-model-label', 'character-model-trigger', 'character-model-value', 'character-model-list',
    'character-preset-label', 'character-preset-trigger', 'character-preset-value', 'character-preset-list',
    'character-reference-mode-help', 'character-reference-mode-error',
    'character-reference-mode-trigger', 'character-reference-mode-value', 'character-reference-mode-list',
    'character-reference-mode-option-builtin', 'character-reference-mode-option-custom',
    'character-reference-mode-label',
    'character-seed', 'character-reference-file', 'character-palette-file',
    'character-reference-empty', 'character-palette-empty',
    'character-reference-selected', 'character-palette-selected',
    'character-reference-preview', 'character-palette-preview',
    'character-reference-name', 'character-palette-name',
    'character-reference-meta', 'character-palette-meta',
    'character-reference-clear', 'character-palette-clear',
    'character-reference-error', 'character-palette-error',
    'character-reference-label', 'character-palette-label',
    'character-primary-action', 'character-regenerate-action',
    'character-replace-help', 'character-ai-gemini', 'character-accepted-image',
    'character-local-entry', 'character-ai-entry',
    'character-local-workspace', 'character-flow-title', 'character-workspace-title',
    'character-top-status', 'character-action-message',
    'character-stage-title', 'character-stage-kicker', 'character-stage-help',
    'character-local-stage-title', 'character-local-stage-kicker', 'character-local-stage-help',
    'character-stage-phase', 'character-local-stage-phase',
    'character-header-crumb', 'character-export-link',
    'character-description-error', 'character-seed-error',
  ]
  for (const id of ids) {
    const tag = id.endsWith('-file') || id === 'character-seed'
      ? 'input'
      : id === 'character-description' ? 'textarea'
        : id === 'character-preset' || id === 'character-model' || id === 'character-reference-mode' ? 'select'
          : id.includes('entry') || id.includes('action') || id.endsWith('-clear') ? 'button'
            : id.endsWith('-preview') ? 'img'
              : 'div'
    createNode(id, tag)
  }
  const form = nodes.get('character-ai-form')
  const description = nodes.get('character-description')
  description.value = 'a copper-haired ranger'
  nodes.get('character-preset').value = 'rpg_humanoid_v0'
  nodes.get('character-preset').options = [
    { value: 'rpg_humanoid_v0', text: 'RPG 人形', textContent: 'RPG 人形', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.presetRpg' : null },
    { value: 'animal_companion_v0', text: '动物伙伴', textContent: '动物伙伴', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.presetAnimal' : null },
    { value: 'monster_creature_v0', text: '魔物生物', textContent: '魔物生物', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.presetMonster' : null },
    { value: 'xianxia_hero_v0', text: '仙侠角色', textContent: '仙侠角色', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.presetXianxia' : null },
    { value: 'chibi_big_pixel_v0', text: '大像素 Q 版', textContent: '大像素 Q 版', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.presetChibi' : null },
  ]
  nodes.get('character-reference-mode').value = 'builtin'
  nodes.get('character-reference-mode').options = [
    { value: 'builtin', text: '内置动作模板（默认）', textContent: '内置动作模板（默认）', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.referenceModeBuiltin' : null },
    { value: 'custom', text: '内置动作模板 + 外观/配色参考', textContent: '内置动作模板 + 外观/配色参考', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.referenceModeCustom' : null },
  ]
  nodes.get('character-model').options = [
    { value: '', text: '正在检查可用模型…', textContent: '正在检查可用模型…', getAttribute: (name) => name === 'data-studio-i18n' ? 'character.modelChecking' : null },
  ]
  nodes.get('character-ai-refs').hidden = true
  nodes.get('character-reference-mode-option-builtin').dataset.value = 'builtin'
  nodes.get('character-reference-mode-option-custom').dataset.value = 'custom'
  nodes.get('character-reference-mode-list').hidden = true
  nodes.get('character-model-list').hidden = true
  nodes.get('character-preset-list').hidden = true
  const classSets = new WeakMap()
  for (const node of nodes.values()) {
    const items = new Set()
    classSets.set(node, items)
    node.classList = {
      toggle(name, force) {
        if (force === false) items.delete(name)
        else if (force === true) items.add(name)
        else if (items.has(name)) items.delete(name)
        else items.add(name)
      },
      add(name) { items.add(name) },
      remove(name) { items.delete(name) },
      contains(name) { return items.has(name) },
    }
    node.closest = (selector) => {
      if (selector === '[role="option"]' && node.getAttribute?.('role') === 'option') return node
      return null
    }
  }
  nodes.get('character-reference-mode-option-builtin').setAttribute('role', 'option')
  nodes.get('character-reference-mode-option-custom').setAttribute('role', 'option')
  const docListeners = new Map()
  const document = {
    documentElement: { lang: 'zh-CN' },
    createElement: (tag) => createNode('', tag),
    getElementById: (id) => nodes.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === '[data-character-language]') return []
      return []
    },
    addEventListener(type, fn) {
      const list = docListeners.get(type) || []
      list.push(fn)
      docListeners.set(type, list)
    },
    dispatchEvent(event) {
      for (const fn of docListeners.get(event.type) || []) fn(event)
    },
  }
  return { document, nodes, form, description }
}

function installUrlSpies() {
  const revoked = []
  const created = []
  globalThis.URL = globalThis.URL || function URL() {}
  globalThis.URL.createObjectURL = (file) => {
    const url = `blob:${file?.name || 'ref'}`
    created.push(url)
    return url
  }
  globalThis.URL.revokeObjectURL = (url) => { revoked.push(url) }
  if (typeof globalThis.btoa !== 'function') {
    globalThis.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64')
  }
  return { created, revoked }
}

function fakeFile({
  name = 'hero.png',
  type = 'image/png',
  size = 16,
  bytes = null,
  delay = null,
  fail = false,
} = {}) {
  const buffer = bytes || new Uint8Array(Math.max(1, Number(size) || 1)).fill(9)
  return {
    name,
    type,
    size,
    arrayBuffer() {
      if (fail) return Promise.reject(new Error('read failed'))
      if (!delay) return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
      return delay.then(() => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    },
  }
}

function installFetch(calls) {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    calls.push({ url: href, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (href === '/api/gemini-state') return jsonResponse(strictGeminiState())
    if (href === '/api/generate-character/review') return jsonResponse(sealedReview())
    if (href === '/api/generate-character') {
      const error = new Error('live generation must not run')
      error.code = 'unexpected_live'
      throw error
    }
    if (href.includes('/accept')) {
      const error = new Error('accept must not run')
      error.code = 'unexpected_accept'
      throw error
    }
    throw new Error(`unexpected fetch ${href}`)
  }
}

test('Character AI reference limits are conservative client bounds below 32 MiB x 2', () => {
  assert.equal(CHARACTER_AI_REFERENCE_MAX_BYTES, 2 * 1024 * 1024)
  assert.equal(CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES, 3 * 1024 * 1024)
  assert.ok(CHARACTER_AI_REFERENCE_MAX_BYTES * 2 > CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES)
  assert.ok(CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES < 32 * 1024 * 1024)
})

test('Character AI reference reader validates MIME, size, aggregate, read, and base64', async () => {
  installUrlSpies()
  const ok = await readCharacterAiReferenceFile(fakeFile({ name: 'ok.png', type: 'image/png', size: 24 }), 'reference')
  assert.equal(ok.name, 'ok.png')
  assert.equal(ok.mimeType, 'image/png')
  assert.equal(ok.size, 24)
  assert.equal(typeof ok.base64, 'string')
  assert.ok(ok.base64.length > 0)
  assert.match(ok.objectUrl, /^blob:ok.png/)

  await assert.rejects(
    () => readCharacterAiReferenceFile(fakeFile({ name: 'x.pdf', type: 'application/pdf', size: 16 }), 'reference'),
    (error) => error.code === 'reference_type_invalid',
  )
  await assert.rejects(
    () => readCharacterAiReferenceFile(fakeFile({ name: 'zero.png', type: 'image/png', size: 0 }), 'reference'),
    (error) => error.code === 'reference_size_invalid',
  )
  await assert.rejects(
    () => readCharacterAiReferenceFile(fakeFile({
      name: 'big.png',
      type: 'image/png',
      size: CHARACTER_AI_REFERENCE_MAX_BYTES + 1,
    }), 'reference'),
    (error) => error.code === 'reference_size_invalid',
  )
  await assert.rejects(
    () => readCharacterAiReferenceFile(fakeFile({
      name: 'peer.png',
      type: 'image/png',
      size: 2 * 1024 * 1024,
    }), 'palette', { otherSize: 2 * 1024 * 1024 }),
    (error) => error.code === 'reference_total_size_invalid',
  )
  await assert.rejects(
    () => readCharacterAiReferenceFile(fakeFile({ name: 'bad.png', type: 'image/png', size: 16, fail: true }), 'reference'),
    (error) => error.code === 'reference_read_failed',
  )
})

test('Character AI reference assign is race-safe for replace and clear', async () => {
  const previousDocument = globalThis.document
  const { document } = createComposerDocument()
  const urls = installUrlSpies()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ draftDescription: 'ranger' })
    let releaseA
    const waitA = new Promise((resolve) => { releaseA = resolve })
    const fileA = fakeFile({ name: 'first.png', type: 'image/png', size: 16, delay: waitA })
    const pendingA = assignCharacterAiReference('reference', fileA)
    const fileB = fakeFile({ name: 'second.png', type: 'image/png', size: 18 })
    await assignCharacterAiReference('reference', fileB)
    releaseA()
    await pendingA
    const afterReplace = inspectStudioCharacterAiComposer()
    assert.equal(afterReplace.draftReferenceName, 'second.png')
    assert.equal(afterReplace.draftReferenceError, null)
    assert.ok(urls.revoked.includes('blob:first.png'))
    assert.equal(urls.revoked.includes('blob:second.png'), false)
    assert.ok(urls.created.includes('blob:second.png'))

    let releaseSlow
    const waitSlow = new Promise((resolve) => { releaseSlow = resolve })
    const slow = fakeFile({ name: 'stale.png', type: 'image/png', size: 16, delay: waitSlow })
    const pendingSlow = assignCharacterAiReference('reference', slow)
    clearCharacterAiReference('reference')
    releaseSlow()
    await pendingSlow
    const afterClear = inspectStudioCharacterAiComposer()
    assert.equal(afterClear.draftReferenceName, null)
    assert.equal(afterClear.draftReferenceError, null)
    assert.ok(urls.revoked.includes('blob:first.png'))
    assert.ok(urls.revoked.includes('blob:second.png'))
    assert.ok(urls.revoked.includes('blob:stale.png'))
  } finally {
    globalThis.document = previousDocument
  }
})

test('Character AI reference errors stay coded and rerender bilingually', async () => {
  const previousDocument = globalThis.document
  const previousLanguage = 'zh'
  const { document, nodes } = createComposerDocument()
  installUrlSpies()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ draftDescription: 'ranger' })
    setCurrentLanguage('zh')
    await assignCharacterAiReference('reference', fakeFile({ name: 'x.pdf', type: 'application/pdf', size: 12 }))
    assert.equal(inspectStudioCharacterAiComposer().draftReferenceError, 'reference_type_invalid')
    assert.equal(nodes.get('character-reference-error').textContent, STUDIO_TRANSLATIONS.zh['character.referenceTypeInvalid'])
    assert.equal(nodes.get('character-reference-file').getAttribute('aria-invalid'), 'true')
    assert.match(nodes.get('character-reference-file').getAttribute('aria-describedby') || '', /character-reference-error/)
    setCurrentLanguage('en')
    const { renderStudioCharacterLanguage } = await import('../src/ui/studio/characterView.js')
    renderStudioCharacterLanguage()
    assert.equal(inspectStudioCharacterAiComposer().draftReferenceError, 'reference_type_invalid')
    assert.equal(nodes.get('character-reference-error').textContent, STUDIO_TRANSLATIONS.en['character.referenceTypeInvalid'])
  } finally {
    setCurrentLanguage(previousLanguage)
    globalThis.document = previousDocument
  }
})

test('Character AI implicit submit prepares Review only in editable composer phases', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, form } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  try {
    initStudioCharacter({ serviceAvailable: true })
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })

    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    calls.length = 0
    const setupEvent = { type: 'submit', preventDefault() { setupEvent.prevented = true } }
    handleCharacterAiComposerSubmit(setupEvent)
    assert.equal(setupEvent.prevented, true)
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    assert.ok(calls.some((call) => call.url === '/api/generate-character/review'))
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)

    seedStudioCharacterStateForTest({
      phase: 'confirm',
      draftDescription: 'a copper-haired ranger',
      review: sealedReview(),
    })
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    assert.deepEqual(calls, [])

    const replaced = []
    const previousLocation = globalThis.location
    const previousHistory = globalThis.history
    globalThis.location = { href: 'http://127.0.0.1:9/?pending_job=job_done&pending_review=rev_done#character' }
    globalThis.history = { state: null, replaceState(_s, _t, url) { replaced.push(String(url)) } }
    seedStudioCharacterStateForTest({
      phase: 'review_required',
      draftDescription: 'a copper-haired ranger',
      review: sealedReview(),
      job: { id: 'job_done', status: 'done' },
      evidenceBody: { expectedRawProviderOutputSha256: PLAN_HASH },
    })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    assert.ok(calls.some((call) => call.url === '/api/generate-character/review'))
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)
    assert.equal(calls.some((call) => String(call.url).includes('/accept')), false)
    assert.ok(replaced.length >= 1)
    assert.equal(replaced.some((url) => url.includes('pending_job=') || url.includes('pending_review=')), false)
    globalThis.location = previousLocation
    globalThis.history = previousHistory

    const replacedAccepted = []
    const previousLocationAccepted = globalThis.location
    const previousHistoryAccepted = globalThis.history
    globalThis.location = { href: 'http://127.0.0.1:9/?publication=accepted_v1_job_test&pending_job=job_acc&pending_review=rev_acc#character' }
    globalThis.history = { state: null, replaceState(_s, _t, url) { replacedAccepted.push(String(url)) } }
    const keptSrc = 'blob:accepted-keep'
    seedStudioCharacterStateForTest({
      phase: 'accepted',
      draftDescription: 'a copper-haired ranger',
      processingSourceReady: true,
      acceptedPresentationReady: true,
      processingSourcePublicationId: 'accepted_v1_job_test',
      acceptance: { publication_id: 'accepted_v1_job_test' },
      acceptedResult: { sheetUrl: keptSrc },
    })
    const acceptedImage = document.getElementById('character-accepted-image')
    if (acceptedImage) {
      acceptedImage.src = keptSrc
      acceptedImage.hidden = false
    }
    document.getElementById('character-description').value = 'a copper-haired ranger'
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    assert.ok(calls.some((call) => call.url === '/api/generate-character/review'))
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)
    assert.equal(calls.some((call) => String(call.url).includes('/accept')), false)
    assert.ok(replacedAccepted.length >= 1)
    const lastUrl = replacedAccepted[replacedAccepted.length - 1]
    assert.equal(lastUrl.includes('pending_job='), false)
    assert.equal(lastUrl.includes('pending_review='), false)
    assert.equal(lastUrl.includes('publication=accepted_v1_job_test'), true)
    const { inspectStudioCharacterState } = await import('../src/ui/studio/characterView.js')
    assert.equal(inspectStudioCharacterState().hasAcceptedResult, true)
    assert.equal(document.getElementById('character-accepted-image')?.src, keptSrc)
    globalThis.location = previousLocationAccepted
    globalThis.history = previousHistoryAccepted
    assert.equal(typeof form.dispatchEvent, 'function')
  } finally {
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI HTML keeps required concept, error association, and submit isolation', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const view = await readFile('src/ui/studio/characterView.js', 'utf8')
  assert.match(html, /id="character-model"(?=[\s>])/)
  assert.equal([...html.matchAll(/id="character-model"(?=[\s>])/g)].length, 1)
  assert.match(html, /id="character-model-trigger"[^>]*role="combobox"/)
  assert.match(html, /id="character-preset-trigger"[^>]*role="combobox"/)
  assert.match(html, /id="character-reference-mode-trigger"[^>]*role="combobox"/)
  const aiForm = html.slice(html.indexOf('id="character-ai-form"'), html.indexOf('id="character-local-advanced-form"'))
  assert.equal([...aiForm.matchAll(/d="M5 8l5 5 5-5"/g)].length, 3)
  assert.equal([...aiForm.matchAll(/stroke="#94a3b8"/g)].length, 3)
  assert.equal([...aiForm.matchAll(/stroke-width="1.8"/g)].length, 3)
  assert.equal([...aiForm.matchAll(/stroke-linecap="round"/g)].length, 3)
  assert.equal([...aiForm.matchAll(/stroke-linejoin="round"/g)].length, 3)
  assert.equal([...aiForm.matchAll(/viewBox="0 0 20 20" width="14" height="14"/g)].length, 3)
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  assert.doesNotMatch(css, /\.character-local-panel:has\(\.character-ai-combobox-trigger\[aria-expanded="true"\]\)/)
  assert.doesNotMatch(css, /\.character-advanced-scroll:has\(\.character-ai-combobox-trigger\[aria-expanded="true"\]\)/)
  assert.match(css, /\.character-ai-combobox-list \{[^}]*position:\s*fixed/)
  assert.doesNotMatch(view, /scrollIntoView/)
  assert.match(view, /from '\.\/characterCombobox\.js'/)
  const localForm = html.slice(html.indexOf('id="character-local-advanced-form"'))
  assert.equal([...localForm.matchAll(/d="M5 8l5 5 5-5"/g)].length, 4)
  assert.match(localForm, /id="character-advanced-layout-trigger"[^>]*role="combobox"/)
  assert.match(localForm, /id="character-advanced-background-mode-trigger"[^>]*role="combobox"/)
  assert.match(localForm, /id="character-advanced-outline-mode-trigger"[^>]*role="combobox"/)
  assert.match(localForm, /id="character-advanced-frame-trigger"[^>]*role="combobox"/)
  assert.doesNotMatch(html, />▾</)
  assert.doesNotMatch(html, /character-ai-combobox-caret[^>]*style="[^"]*transform/)
  assert.doesNotMatch(html, /id="character-field-(?:identity|body|outfit|colors|equipment|style)"/)
  assert.doesNotMatch(html, /character-ai-fields/)
  assert.match(html, /id="character-preset"(?=[\s>])/)
  assert.match(html, /id="character-description"[^>]*required[^>]*aria-required="true"/)
  assert.match(html, /id="character-description"[^>]*aria-describedby="character-description-error"/)
  assert.match(html, /id="character-description-error"/)
  assert.match(html, /id="character-seed"[^>]*aria-describedby="character-seed-error"/)
  assert.match(html, /id="character-seed-error"/)
  assert.match(html, /id="character-reference-mode"/)
  assert.match(html, /id="character-reference-mode-trigger"[^>]*role="combobox"/)
  assert.match(html, /id="character-reference-mode-trigger"[^>]*aria-autocomplete="none"/)
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /id="character-reference-mode-option-builtin"/)
  assert.match(html, /id="character-reference-mode-option-custom"/)
  assert.match(html, /data-value="builtin"/)
  assert.match(html, /data-value="custom"/)
  assert.match(html, /内置动作模板 \+ 外观\/配色参考/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.referenceModeCustom'], '内置动作模板 + 外观/配色参考')
  assert.equal(STUDIO_TRANSLATIONS.en['character.referenceModeCustom'], 'Built-in motion template + appearance / palette references')
  assert.match(html, /id="character-reference-mode"[^>]*aria-hidden="true"/)
  assert.equal([...html.matchAll(/id="character-reference-mode-trigger"/g)].length, 1)
  assert.match(html, /data-studio-i18n="character.referenceModeBuiltin"/)
  assert.match(html, /id="character-ai-refs"[^>]*\bhidden\b/)
  assert.match(html, /id="character-reference-file"[^>]*aria-describedby="character-reference-error"/)
  assert.match(html, /id="character-palette-file"[^>]*aria-describedby="character-palette-error"/)
  assert.match(html, /data-design-source="[^"]*683:4017/)
  assert.match(view, /handleCharacterAiComposerSubmit/)
  assert.match(view, /characterAiComposerCanPrepareReview/)
  assert.doesNotMatch(view, /character-ai-form'\)\?\.addEventListener\('submit', \(event\) => \{[\s\S]*handlePrimaryAction\(\)/)
  assert.match(view, /CHARACTER_AI_REFERENCE_MAX_BYTES = 2 \* 1024 \* 1024/)
  assert.match(view, /CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES = 3 \* 1024 \* 1024/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.statusReviewPending'], '尚未生成')
  assert.equal(STUDIO_TRANSLATIONS.en['character.statusReviewPending'], 'Not generated')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.statusReady'], '待确认')
  assert.equal(STUDIO_TRANSLATIONS.en['character.statusReady'], 'Ready to confirm')
  assert.doesNotMatch(STUDIO_TRANSLATIONS.zh['character.statusReviewPending'], /次调用|0\/1/)
  assert.doesNotMatch(STUDIO_TRANSLATIONS.en['character.statusReady'], /0\/1|calls/)
  assert.doesNotMatch(STUDIO_TRANSLATIONS.en['character.reviewSummary'], /Provider-free Review/)
  assert.doesNotMatch(STUDIO_TRANSLATIONS.en['character.confirmSummary'], /2K \/ 1:1/)
  assert.equal(STUDIO_TRANSLATIONS.en['character.confirming'], 'Confirming generation…')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.confirming'], '正在确认生成…')
  assert.doesNotMatch(STUDIO_TRANSLATIONS.en['character.confirming'], /sealed|Provider|review_required|one-call|binding/i)
  assert.doesNotMatch(STUDIO_TRANSLATIONS.zh['character.confirming'], /封存|服务提供方|哈希/)
  assert.equal(STUDIO_TRANSLATIONS.en['character.runningAction'], 'Processing…')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.runningAction'], '处理中…')
  assert.doesNotMatch(STUDIO_TRANSLATIONS.en['character.runningAction'], /Provider|one-call|review_required/i)
  assert.doesNotMatch(STUDIO_TRANSLATIONS.zh['character.runningAction'], /服务提供方|调用/)
  assert.equal(STUDIO_TRANSLATIONS.zh['character.modelLabel'], '模型')
  assert.equal(STUDIO_TRANSLATIONS.en['character.modelLabel'], 'Model')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.modelChecking'], '正在检查可用模型…')
  assert.equal(STUDIO_TRANSLATIONS.en['character.modelChecking'], 'Checking available model…')
  assert.equal(STUDIO_TRANSLATIONS.zh['character.modelUnavailable'], '请先在设置中配置 Gemini')
  assert.equal(STUDIO_TRANSLATIONS.en['character.modelUnavailable'], 'Configure Gemini in Settings')
  const primaryLayerCopyKeys = [
    'character.runningProviderComplete',
    'character.runningProviderPending',
    'character.oneCallSealedJob',
    'character.providerCallsLabel',
    'character.reviewJobDetail',
    'character.confirmJobDetail',
    'character.runningJobDetail',
    'character.topdownJobDetail',
    'character.jobCallsUnknown',
    'character.statusReviewRequired',
    'character.statusReviewRequiredZero',
    'character.statusCallsKnown',
    'character.statusCallsUnknown',
    'character.statusRestoringPublication',
    'character.statusPendingRestoreInterrupted',
    'character.statusBlockedPreReview',
    'character.runningTitle',
    'character.runningSummary',
    'character.runningKicker',
    'character.runningStageSummary',
    'character.accepting',
    'character.retryPendingRestore',
    'character.evidenceFailedSummary',
    'character.evidenceFailedStageSummary',
    'character.recheckEvidence',
  ]
  const bannedPrimary = /Provider|\bcalls\b|服务提供方|调用|1\/1|review_required/i
  for (const key of primaryLayerCopyKeys) {
    assert.doesNotMatch(STUDIO_TRANSLATIONS.en[key], bannedPrimary, `en ${key}`)
    assert.doesNotMatch(STUDIO_TRANSLATIONS.zh[key], bannedPrimary, `zh ${key}`)
  }
})


test('Character AI concurrent reference reads re-check aggregate size before commit', async () => {
  const previousDocument = globalThis.document
  const { document } = createComposerDocument()
  installUrlSpies()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ draftDescription: 'ranger' })
    let releaseRef
    let releasePal
    const waitRef = new Promise((resolve) => { releaseRef = resolve })
    const waitPal = new Promise((resolve) => { releasePal = resolve })
    const twoMib = 2 * 1024 * 1024
    const pendingRef = assignCharacterAiReference('reference', fakeFile({
      name: 'ref-big.png', type: 'image/png', size: twoMib, delay: waitRef,
    }))
    const pendingPal = assignCharacterAiReference('palette', fakeFile({
      name: 'pal-big.png', type: 'image/png', size: twoMib, delay: waitPal,
    }))
    releaseRef()
    releasePal()
    await Promise.all([pendingRef, pendingPal])
    const after = inspectStudioCharacterAiComposer()
    const sizes = [after.draftReferenceSize, after.draftPaletteSize].filter((value) => value != null)
    assert.ok(sizes.length >= 1)
    assert.ok(sizes.reduce((sum, value) => sum + value, 0) <= CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES)
    assert.ok(after.draftReferenceError === 'reference_total_size_invalid' || after.draftPaletteError === 'reference_total_size_invalid')
  } finally {
    globalThis.document = previousDocument
  }
})

test('Character AI Gemini block follows locked 2K 1:1 native preset and rerenders after settings resolve', async () => {
  const previousDocument = globalThis.document
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, 'loading')
    assert.equal(nodes.get('character-primary-action').disabled, true)
    assert.equal(nodes.get('character-ai-gemini').hidden, true)
    setStudioProviderSnapshotForTest({ kind: 'saving' })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, 'loading')
    assert.equal(nodes.get('character-primary-action').disabled, true)
    setStudioProviderSnapshotForTest({ kind: 'clearing' })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, 'loading')
    assert.equal(nodes.get('character-primary-action').disabled, true)

    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: GEMINI_PRESET_ID,
        presets: [{
          id: GEMINI_PRESET_ID,
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: false,
          image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
        }],
      },
    })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, 'gemini')
    assert.equal(nodes.get('character-primary-action').disabled, true)

    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: GEMINI_PRESET_ID,
        presets: [{
          id: GEMINI_PRESET_ID,
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: true,
          image_config: { image_size: '1K', aspect_ratio: '1:1' },
        }],
      },
    })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, 'gemini')

    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    assert.equal(inspectStudioCharacterAiComposer().geminiBlock, null)
    assert.equal(nodes.get('character-primary-action').disabled, false)
    assert.equal(nodes.get('character-ai-gemini').hidden, true)

    const typeDescription = () => {
      const node = nodes.get('character-description')
      node.value = 'a copper-haired ranger'
      node.dispatchEvent({ type: 'input' })
    }
    const assertReplacementLocked = (label) => {
      typeDescription()
      assert.equal(nodes.get('character-regenerate-action').hidden, false, label)
      assert.equal(nodes.get('character-regenerate-action').disabled, true, label)
    }
    const assertReplacementReady = (label) => {
      typeDescription()
      assert.equal(nodes.get('character-regenerate-action').hidden, false, label)
      assert.equal(nodes.get('character-regenerate-action').disabled, false, label)
    }

    seedStudioCharacterStateForTest({
      phase: 'review_required',
      draftDescription: 'a copper-haired ranger',
      review: sealedReview(),
      job: { id: 'job_done', status: 'done' },
    })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    for (const kind of ['loading', 'saving', 'clearing']) {
      setStudioProviderSnapshotForTest({ kind })
      assertReplacementLocked(`review_required ${kind}`)
    }
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: GEMINI_PRESET_ID,
        presets: [{
          id: GEMINI_PRESET_ID,
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: false,
          image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
        }],
      },
    })
    assertReplacementLocked('review_required non-strict')
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    assertReplacementReady('review_required strict')

    seedStudioCharacterStateForTest({
      phase: 'accepted',
      draftDescription: 'a copper-haired ranger',
      processingSourceReady: true,
      acceptedPresentationReady: true,
      processingSourcePublicationId: 'accepted_v1_job_test',
      acceptance: { publication_id: 'accepted_v1_job_test' },
      acceptedResult: { sheetUrl: 'blob:accepted-keep' },
    })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    for (const kind of ['loading', 'saving', 'clearing']) {
      setStudioProviderSnapshotForTest({ kind })
      assertReplacementLocked(`accepted ${kind}`)
    }
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: GEMINI_PRESET_ID,
        presets: [{
          id: GEMINI_PRESET_ID,
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: true,
          image_config: { image_size: '1K', aspect_ratio: '1:1' },
        }],
      },
    })
    assertReplacementLocked('accepted non-strict')
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    assertReplacementReady('accepted strict')
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
  }
})

test('Character AI concept and seed errors bind nearby nodes', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: '' })
    document.getElementById('character-description').value = ''
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    assert.equal(inspectStudioCharacterAiComposer().draftConceptError, 'description_required')
    assert.equal(nodes.get('character-description-error').hidden, false)
    assert.equal(nodes.get('character-description-error').textContent, STUDIO_TRANSLATIONS.zh['character.descriptionRequired'])
    assert.equal(nodes.get('character-description').getAttribute('aria-invalid'), 'true')
    assert.match(nodes.get('character-description').getAttribute('aria-describedby') || '', /character-description-error/)
    assert.equal(calls.some((call) => call.url.includes('/review')), false)

    nodes.get('character-description').value = 'ranger'
    nodes.get('character-description').dispatchEvent({ type: 'input' })
    assert.equal(inspectStudioCharacterAiComposer().draftConceptError, null)
    assert.equal(nodes.get('character-description-error').hidden, true)
    assert.equal(nodes.get('character-description').getAttribute('aria-invalid'), null)
    renderStudioCharacterLanguage()
    assert.equal(inspectStudioCharacterAiComposer().draftConceptError, null)
    assert.equal(nodes.get('character-description-error').hidden, true)
    assert.equal(nodes.get('character-description').getAttribute('aria-invalid'), null)

    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'ranger', draftSeed: '1.5' })
    document.getElementById('character-description').value = 'ranger'
    document.getElementById('character-seed').value = '1.5'
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    assert.equal(inspectStudioCharacterAiComposer().draftSeedError, 'seed_invalid')
    assert.equal(nodes.get('character-seed-error').hidden, false)
    assert.equal(nodes.get('character-seed-error').textContent, STUDIO_TRANSLATIONS.zh['character.seedInvalid'])
    assert.equal(nodes.get('character-seed').getAttribute('aria-invalid'), 'true')
    assert.match(nodes.get('character-seed').getAttribute('aria-describedby') || '', /character-seed-error/)
    assert.equal(calls.some((call) => call.url.includes('/review')), false)

    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'ranger', draftSeed: '1.5', draftSeedError: 'seed_invalid' })
    nodes.get('character-seed').value = '1.5'
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    assert.equal(inspectStudioCharacterAiComposer().draftSeedError, 'seed_invalid')
    nodes.get('character-seed').value = '8'
    nodes.get('character-seed').dispatchEvent({ type: 'input' })
    assert.equal(inspectStudioCharacterAiComposer().draftSeedError, null)
    assert.equal(nodes.get('character-seed-error').hidden, true)
    assert.equal(nodes.get('character-seed').getAttribute('aria-invalid'), null)
  } finally {
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI model select is one truthful strict Gemini option and never stale', async () => {
  const previousDocument = globalThis.document
  const previousLanguage = 'zh'
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setCurrentLanguage('zh')
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelValue, '')
    assert.equal(inspect.modelOptions.length, 1)
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.zh['character.modelChecking'])
    setStudioProviderSnapshotForTest({ kind: 'saving' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.zh['character.modelChecking'])
    setCurrentLanguage('en')
    renderStudioCharacterLanguage()
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.en['character.modelChecking'])
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: 'openrouter-top',
        presets: [
          {
            id: 'openrouter-top',
            available: true,
            provider: 'openrouter',
            route_kind: 'openrouter',
            model: 'openrouter-not-for-character',
            supports_image_size: true,
            image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
          },
          {
            id: GEMINI_PRESET_ID,
            available: true,
            provider: 'gemini',
            route_kind: 'google_native',
            model: 'gemini-2.5-flash-image',
            supports_image_size: true,
            image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
          },
        ],
      },
    })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.geminiBlock, null)
    assert.equal(inspect.modelDisabled, false)
    assert.equal(inspect.modelOptions.length, 1)
    assert.equal(inspect.modelValue, GEMINI_PRESET_ID)
    assert.equal(inspect.modelOptions[0].value, GEMINI_PRESET_ID)
    assert.equal(inspect.modelOptions[0].text, 'Gemini · gemini-2.5-flash-image')
    assert.equal(inspect.modelOptions.some((option) => /openrouter/i.test(`${option.text}${option.value}`)), false)
    setStudioProviderSnapshotForTest({
      kind: 'resolved',
      provider: {
        status: 'ready',
        active_preset_id: GEMINI_PRESET_ID,
        presets: [{
          id: GEMINI_PRESET_ID,
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          model: 'gemini-1k',
          supports_image_size: true,
          image_config: { image_size: '1K', aspect_ratio: '1:1' },
        }],
      },
    })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.geminiBlock, 'gemini')
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelValue, '')
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.en['character.modelUnavailable'])
    setCurrentLanguage('zh')
    renderStudioCharacterLanguage()
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.zh['character.modelUnavailable'])
    assert.equal(nodes.get('character-ai-gemini').hidden, false)
  } finally {
    setCurrentLanguage(previousLanguage)
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
  }
})

test('Character AI blocked snapshots fail closed before any Review network', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, form, nodes } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    const blockedSnapshots = [
      { kind: 'loading' },
      { kind: 'saving' },
      { kind: 'clearing' },
      {
        kind: 'resolved',
        provider: {
          status: 'ready',
          active_preset_id: 'openrouter-top',
          presets: [{
            id: 'openrouter-top',
            available: true,
            provider: 'openrouter',
            route_kind: 'openrouter',
            model: 'openrouter-not-for-character',
            supports_image_size: true,
            image_config: { ...STRICT_FIXED_REGION_PROFILE.imageConfig },
          }],
        },
      },
    ]
    for (const snapshot of blockedSnapshots) {
      setStudioProviderSnapshotForTest(snapshot)
      calls.length = 0
      handleCharacterAiComposerSubmit({ preventDefault() {} })
      form.dispatchEvent({ type: 'submit', preventDefault() {} })
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
      assert.deepEqual(calls, [], snapshot.kind || 'unavailable')
      assert.equal(calls.some((call) => call.url === '/api/gemini-state'), false, `${snapshot.kind} gemini-state`)
      assert.equal(calls.some((call) => call.url === '/api/generate-character/review'), false, `${snapshot.kind} review`)
      assert.equal(calls.some((call) => call.url === '/api/generate-character'), false, `${snapshot.kind} live`)
      assert.equal(nodes.get('character-primary-action').disabled, true)
    }

    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    assert.ok(calls.some((call) => call.url === '/api/generate-character/review'))
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)

    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    nodes.get('character-model').value = 'stale-preset'
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    assert.deepEqual(calls, [])
    assert.equal(calls.some((call) => call.url === '/api/gemini-state'), false)
    assert.equal(calls.some((call) => call.url === '/api/generate-character/review'), false)
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI review body uses selected preset id and omits disconnected promptFields', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({
      phase: 'setup',
      draftDescription: 'a copper-haired ranger',
      draftCharacterPreset: 'rpg_humanoid_v0',
      draftSeed: '9',
    })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    document.getElementById('character-seed').value = '9'
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    const visible = collectCharacterAiReviewInput()
    assert.equal(visible.providerPresetId, GEMINI_PRESET_ID)
    assert.equal(Object.hasOwn(visible, 'promptFields'), false)
    assert.equal(Object.hasOwn(visible, 'model'), false)
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    const reviewCall = calls.find((call) => call.url === '/api/generate-character/review')
    assert.ok(reviewCall)
    assert.equal(reviewCall.body.providerPresetId, GEMINI_PRESET_ID)
    assert.equal(Object.hasOwn(reviewCall.body, 'promptFields'), false)
    assert.equal(Object.hasOwn(reviewCall.body, 'model'), false)
    assert.equal(reviewCall.body.generationOptions.seed, 9)
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)

    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    nodes.get('character-model').value = 'stale-preset'
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    assert.deepEqual(calls, [])
    assert.equal(calls.some((call) => call.url === '/api/gemini-state'), false)
    assert.equal(calls.some((call) => call.url === '/api/generate-character/review'), false)
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI snapshot rerender preserves retained drafts and references', async () => {
  const previousDocument = globalThis.document
  const { document, nodes } = createComposerDocument()
  const urls = installUrlSpies()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({
      phase: 'setup',
      draftDescription: 'copper ranger',
      draftCharacterPreset: 'animal_companion_v0',
      draftSeed: '11',
    })
    nodes.get('character-description').value = 'copper ranger'
    nodes.get('character-preset').value = 'animal_companion_v0'
    nodes.get('character-seed').value = '11'
    await assignCharacterAiReference('reference', fakeFile({ name: 'hero.png', type: 'image/png', size: 16 }))
    await assignCharacterAiReference('palette', fakeFile({ name: 'palette.png', type: 'image/png', size: 12 }))
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftDescription, 'copper ranger')
    assert.equal(inspect.draftCharacterPreset, 'animal_companion_v0')
    assert.equal(inspect.draftSeed, '11')
    assert.equal(inspect.draftReferenceName, 'hero.png')
    assert.equal(inspect.draftPaletteName, 'palette.png')
    assert.equal(inspect.modelValue, GEMINI_PRESET_ID)
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftDescription, 'copper ranger')
    assert.equal(inspect.draftCharacterPreset, 'animal_companion_v0')
    assert.equal(inspect.draftSeed, '11')
    assert.equal(inspect.draftReferenceName, 'hero.png')
    assert.equal(inspect.draftPaletteName, 'palette.png')
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelValue, '')
    assert.equal(nodes.get('character-description').value, 'copper ranger')
    switchStudioCharacterSource('local')
    switchStudioCharacterSource('ai')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftDescription, 'copper ranger')
    assert.equal(inspect.draftReferenceName, 'hero.png')
    assert.equal(inspect.draftPaletteName, 'palette.png')
    assert.ok(urls.created.includes('blob:hero.png'))
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
  }
})

test('Character AI reference mode defaults to built-in structure and omits custom images', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes, form } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  installUrlSpies()
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'builtin')
    assert.equal(inspect.refsHidden, true)
    assert.equal(nodes.get('character-ai-refs').hidden, true)
    assert.equal(nodes.get('character-reference-mode').value, 'builtin')
    assert.equal(nodes.get('character-primary-action').disabled, false)
    await assignCharacterAiReference('reference', fakeFile({ name: 'hero.png', type: 'image/png', size: 16 }))
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceName, 'hero.png')
    assert.equal(inspect.refsHidden, true)
    const builtinInput = collectCharacterAiReviewInput()
    assert.equal(Object.hasOwn(builtinInput, 'referenceImage'), false)
    assert.equal(Object.hasOwn(builtinInput, 'paletteImage'), false)
    assert.equal(Object.hasOwn(builtinInput, 'referenceMode'), false)
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    const reviewCall = calls.find((call) => call.url === '/api/generate-character/review')
    assert.ok(reviewCall)
    assert.equal(Object.hasOwn(reviewCall.body, 'referenceImage'), false)
    assert.equal(Object.hasOwn(reviewCall.body, 'paletteImage'), false)
    assert.equal(Object.hasOwn(reviewCall.body, 'reference_image_base64'), false)
    assert.equal(Object.hasOwn(reviewCall.body, 'referenceMode'), false)

    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'custom')
    assert.equal(inspect.refsHidden, false)
    assert.equal(inspect.draftReferenceName, 'hero.png')
    const customInput = collectCharacterAiReviewInput()
    assert.equal(customInput.referenceImage.name, 'hero.png')
    assert.equal(Object.hasOwn(customInput, 'referenceMode'), false)

    nodes.get('character-reference-mode').value = 'builtin'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'builtin')
    assert.equal(inspect.refsHidden, true)
    assert.equal(inspect.draftReferenceName, 'hero.png')
    assert.equal(Object.hasOwn(collectCharacterAiReviewInput(), 'referenceImage'), false)
    assert.equal(typeof form.dispatchEvent, 'function')
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI custom reference mode fail-closes without a valid image', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes, form } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  installUrlSpies()
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    assert.equal(inspectStudioCharacterAiComposer().refsHidden, false)
    assert.equal(nodes.get('character-primary-action').disabled, true)
    assert.match(nodes.get('character-primary-action').getAttribute('aria-describedby') || '', /character-reference-mode-help/)
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    form.dispatchEvent({ type: 'submit', preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    assert.deepEqual(calls, [])
    assert.equal(inspectStudioCharacterAiComposer().draftCustomReferenceError, 'custom_reference_required')
    assert.match(inspectStudioCharacterAiComposer().actionMessage, /请至少添加一张角色参考或配色参考/)
    assert.equal(nodes.get('character-reference-mode-error').hidden, false)
    assert.equal(nodes.get('character-reference-mode').getAttribute('aria-invalid'), 'true')
    nodes.get('character-reference-mode').value = 'builtin'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    const afterBuiltin = inspectStudioCharacterAiComposer()
    assert.equal(afterBuiltin.draftReferenceMode, 'builtin')
    assert.equal(afterBuiltin.draftCustomReferenceError, null)
    assert.equal(afterBuiltin.actionMessage, '')
    assert.equal(nodes.get('character-action-message').textContent, '')
    assert.equal(nodes.get('character-primary-action').disabled, false)
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })

    await assignCharacterAiReference('palette', fakeFile({ name: 'palette.png', type: 'image/png', size: 12 }))
    assert.equal(inspectStudioCharacterAiComposer().draftCustomReferenceError, null)
    assert.equal(nodes.get('character-primary-action').disabled, false)
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 20 && !calls.some((call) => call.url.includes('/review')); i += 1) await Promise.resolve()
    const reviewCall = calls.find((call) => call.url === '/api/generate-character/review')
    assert.ok(reviewCall)
    assert.equal(reviewCall.body.palette_image_name, 'palette.png')
    assert.equal(Object.hasOwn(reviewCall.body, 'reference_image_base64'), false)
    assert.equal(Object.hasOwn(reviewCall.body, 'referenceMode'), false)
    assert.equal(calls.some((call) => call.url === '/api/generate-character'), false)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

function loadedEvidenceStatus() {
  return {
    raw_provider_output_url: 'loaded',
    background_removed_provider_output_url: 'loaded',
    normalized_sheet_url: 'loaded',
    background_preview_url: 'loaded',
    background_spill_overlay_url: 'loaded',
    background_sure_background_mask_url: 'loaded',
    background_unknown_band_mask_url: 'loaded',
    background_sure_foreground_mask_url: 'loaded',
    background_alpha_estimate_url: 'loaded',
    background_foreground_reconstruction_url: 'loaded',
  }
}

function reviewRequiredSeed(extra = {}) {
  return {
    phase: 'review_required',
    review: sealedReview(),
    job: { id: 'job_done', status: 'done', raw_provider_output_url: RAW_PROVIDER_OUTPUT_URL },
    evidenceBody: { expectedRawProviderOutputSha256: PLAN_HASH },
    evidenceMediaStatus: loadedEvidenceStatus(),
    pendingSelector: { ...PENDING_SELECTOR },
    ...extra,
  }
}

function assertCurrentReviewPreserved({ calls, replaced, inspect, snapshot }) {
  assert.deepEqual(calls, [])
  assert.equal(calls.some((call) => String(call.url).includes('/api/gemini-state')), false)
  assert.equal(inspect.phase, 'review_required')
  assert.equal(inspect.hasReview, true)
  assert.equal(inspect.hasEvidenceBody, true)
  assert.equal(inspect.rawProviderOutputUrl, RAW_PROVIDER_OUTPUT_URL)
  assert.deepEqual(inspect.pendingSelector, PENDING_SELECTOR)
  assert.equal(snapshot.phase, 'review_required')
  assert.equal(snapshot.jobId, 'job_done')
  assert.equal(snapshot.rawProviderOutputUrl, RAW_PROVIDER_OUTPUT_URL)
  assert.deepEqual(snapshot.pendingSelector, PENDING_SELECTOR)
  assert.equal(replaced.length, 0)
  assert.match(globalThis.location.href, /pending_job=job_done/)
  assert.match(globalThis.location.href, /pending_review=generation_review_done/)
}

test('Character AI custom empty mode only blocks preparing a new Review', async () => {
  const previousDocument = globalThis.document
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  try {
    initStudioCharacter({ serviceAvailable: true })
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    seedStudioCharacterStateForTest({
      phase: 'review_required',
      draftDescription: 'a copper-haired ranger',
      draftReferenceMode: 'custom',
      review: sealedReview(),
      job: { id: 'job_done', status: 'done' },
      evidenceBody: { expectedRawProviderOutputSha256: PLAN_HASH },
      evidenceMediaStatus: loadedEvidenceStatus(),
    })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.primaryAction, 'accept')
    assert.equal(inspect.primaryDisabled, false)
    assert.equal(nodes.get('character-regenerate-action').disabled, true)

    seedStudioCharacterStateForTest({
      phase: 'review_required',
      draftDescription: 'ranger',
      draftReferenceMode: 'custom',
      failureMode: 'evidence',
      review: sealedReview(),
      job: { id: 'job_done', status: 'done' },
      evidenceBody: null,
    })
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.primaryAction, 'recheck')
    assert.equal(inspect.primaryDisabled, false)

    seedStudioCharacterStateForTest({
      phase: 'accepted',
      draftDescription: 'ranger',
      draftReferenceMode: 'custom',
      processingSourceReady: true,
      acceptedPresentationReady: true,
      processingSourcePublicationId: 'accepted_v1_job_test',
      acceptance: { publication_id: 'accepted_v1_job_test' },
      acceptedResult: { sheetUrl: 'blob:accepted-keep', error: 'hydrate failed' },
      acceptedHydrateError: 'hydrate failed',
    })
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.primaryAction, 'retry-accepted')
    assert.equal(inspect.primaryDisabled, false)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
  }
})

test('Character AI non-setup submit fail-closes before clearing current Review state', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const previousLocation = globalThis.location
  const previousHistory = globalThis.history
  const { document, nodes, form } = createComposerDocument()
  globalThis.document = document
  const calls = []
  const replaced = []
  installFetch(calls)
  globalThis.location = { href: 'http://127.0.0.1:9/?pending_job=job_done&pending_review=generation_review_done#character' }
  globalThis.history = { state: null, replaceState(_s, _t, url) { replaced.push(String(url)) } }
  try {
    initStudioCharacter({ serviceAvailable: true })
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    seedStudioCharacterStateForTest(reviewRequiredSeed({
      draftDescription: 'a copper-haired ranger',
      draftReferenceMode: 'custom',
    }))
    document.getElementById('character-description').value = 'a copper-haired ranger'
    nodes.get('character-reference-mode').value = 'custom'
    nodes.get('character-reference-mode').dispatchEvent({ type: 'change' })
    calls.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    form.dispatchEvent({ type: 'submit', preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const inspect = inspectStudioCharacterAiComposer()
    const snapshot = inspectStudioCharacterState()
    assertCurrentReviewPreserved({ calls, replaced, inspect, snapshot })
    assert.equal(inspect.draftCustomReferenceError, 'custom_reference_required')
    assert.equal(inspect.primaryAction, 'accept')
    assert.equal(inspect.primaryDisabled, false)

    seedStudioCharacterStateForTest(reviewRequiredSeed({
      draftDescription: '',
      draftReferenceMode: 'builtin',
      draftSeed: '11',
    }))
    document.getElementById('character-description').value = '   '
    nodes.get('character-seed').value = '11'
    nodes.get('character-reference-mode').value = 'builtin'
    const focused = []
    nodes.get('character-description').focus = () => focused.push('description')
    nodes.get('character-seed').focus = () => focused.push('seed')
    nodes.get('character-model-trigger').focus = () => focused.push('model')
    calls.length = 0
    replaced.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const emptyInspect = inspectStudioCharacterAiComposer()
    const emptySnapshot = inspectStudioCharacterState()
    assertCurrentReviewPreserved({ calls, replaced, inspect: emptyInspect, snapshot: emptySnapshot })
    assert.equal(emptyInspect.draftConceptError, 'description_required')
    assert.deepEqual(focused, ['description'])

    seedStudioCharacterStateForTest(reviewRequiredSeed({
      draftDescription: 'a copper-haired ranger',
      draftReferenceMode: 'builtin',
      draftSeed: '1.5',
    }))
    document.getElementById('character-description').value = 'a copper-haired ranger'
    nodes.get('character-seed').value = '1.5'
    nodes.get('character-reference-mode').value = 'builtin'
    focused.length = 0
    calls.length = 0
    replaced.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const seedInspect = inspectStudioCharacterAiComposer()
    const seedSnapshot = inspectStudioCharacterState()
    assertCurrentReviewPreserved({ calls, replaced, inspect: seedInspect, snapshot: seedSnapshot })
    assert.equal(seedInspect.draftSeedError, 'seed_invalid')
    assert.deepEqual(focused, ['seed'])

    seedStudioCharacterStateForTest(reviewRequiredSeed({
      draftDescription: 'a copper-haired ranger',
      draftReferenceMode: 'builtin',
      draftSeed: '11',
    }))
    document.getElementById('character-description').value = 'a copper-haired ranger'
    nodes.get('character-seed').value = '11'
    nodes.get('character-reference-mode').value = 'builtin'
    nodes.get('character-model').value = 'stale-preset'
    focused.length = 0
    calls.length = 0
    replaced.length = 0
    handleCharacterAiComposerSubmit({ preventDefault() {} })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const staleInspect = inspectStudioCharacterAiComposer()
    const staleSnapshot = inspectStudioCharacterState()
    assertCurrentReviewPreserved({ calls, replaced, inspect: staleInspect, snapshot: staleSnapshot })
    assert.deepEqual(focused, ['model'])
    assert.match(staleInspect.actionMessage, /当前无法生成|Generation is unavailable/)
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
    globalThis.location = previousLocation
    globalThis.history = previousHistory
  }
})

test('Character AI reference mode listbox is one branded control with pointer and keyboard', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  const trigger = nodes.get('character-reference-mode-trigger')
  const list = nodes.get('character-reference-mode-list')
  const builtinOption = nodes.get('character-reference-mode-option-builtin')
  const customOption = nodes.get('character-reference-mode-option-custom')
  const keydown = (key, extras = {}) => {
    let prevented = false
    trigger.dispatchEvent({
      type: 'keydown',
      key,
      preventDefault() { prevented = true },
      ...extras,
    })
    return prevented
  }
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'builtin')
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.referenceModeListHidden, true)
    assert.equal(inspect.referenceModeTriggerRole, 'combobox')
    assert.equal(inspect.referenceModeActiveDescendant, '')
    assert.deepEqual(inspect.referenceModeOptionValues, ['builtin', 'custom'])
    assert.equal(nodes.get('character-reference-mode').getAttribute('aria-hidden'), 'true')
    assert.equal(trigger.getAttribute('role'), 'combobox')
    assert.equal(trigger.getAttribute('aria-autocomplete'), 'none')
    assert.equal(trigger.getAttribute('aria-haspopup'), 'listbox')
    assert.equal(trigger.getAttribute('aria-controls'), 'character-reference-mode-list')
    assert.equal(nodes.get('character-reference-mode-value').textContent, STUDIO_TRANSLATIONS.zh['character.referenceModeBuiltin'])
    assert.match(nodes.get('character-reference-mode-help').textContent, /动作与排布由内置模板决定/)
    const focused = []
    trigger.focus = () => focused.push('trigger')
    calls.length = 0
    trigger.dispatchEvent({ type: 'click', preventDefault() {} })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeTriggerExpanded, true)
    assert.equal(inspect.referenceModeListHidden, false)
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-builtin')
    assert.deepEqual(calls, [])
    list.dispatchEvent({
      type: 'mousemove',
      target: customOption,
    })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-custom')
    assert.equal(inspect.draftReferenceMode, 'builtin')
    list.dispatchEvent({
      type: 'click',
      preventDefault() {},
      target: customOption,
    })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'custom')
    assert.equal(inspect.refsHidden, false)
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.referenceModeActiveDescendant, '')
    assert.equal(nodes.get('character-reference-mode-value').textContent, STUDIO_TRANSLATIONS.zh['character.referenceModeCustom'])
    assert.match(nodes.get('character-reference-mode-help').textContent, /角色图优先决定身份与外观/)
    assert.deepEqual(calls, [])
    focused.length = 0
    assert.equal(keydown('ArrowDown'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeTriggerExpanded, true)
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-custom')
    assert.equal(keydown('ArrowUp'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-builtin')
    assert.equal(keydown('End'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-custom')
    assert.equal(keydown('Home'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-builtin')
    focused.length = 0
    assert.equal(keydown('Escape'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.referenceModeActiveDescendant, '')
    assert.ok(focused.includes('trigger'))
    keydown('ArrowDown')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'custom')
    assert.equal(inspect.referenceModeActiveDescendant, 'character-reference-mode-option-custom')
    assert.equal(keydown(' '), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'custom')
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    keydown('ArrowDown')
    keydown('Home')
    keydown('Enter')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'builtin')
    keydown('ArrowDown')
    const tabPrevented = keydown('Tab')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(tabPrevented, false)
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.draftReferenceMode, 'builtin')
    keydown('ArrowDown')
    document.dispatchEvent({ type: 'pointerdown', target: { id: 'outside' } })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    setCurrentLanguage('en')
    renderStudioCharacterLanguage()
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(nodes.get('character-reference-mode-value').textContent, STUDIO_TRANSLATIONS.en['character.referenceModeBuiltin'])
    assert.match(nodes.get('character-reference-mode-help').textContent, /No upload needed/)
    trigger.dispatchEvent({ type: 'click', preventDefault() {} })
    list.dispatchEvent({ type: 'click', preventDefault() {}, target: customOption })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftReferenceMode, 'custom')
    assert.equal(nodes.get('character-reference-mode-value').textContent, STUDIO_TRANSLATIONS.en['character.referenceModeCustom'])
    assert.match(nodes.get('character-reference-mode-help').textContent, /character image takes priority/i)
    assert.deepEqual(calls, [])
    assert.equal(builtinOption.getAttribute('role'), 'option')
    assert.equal(customOption.getAttribute('role'), 'option')
  } finally {
    setCurrentLanguage('zh')
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})

test('Character AI model, type, and reference comboboxes share one branded control', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes } = createComposerDocument()
  globalThis.document = document
  const calls = []
  installFetch(calls)
  const caretShape = {
    d: 'M5 8l5 5 5-5',
    stroke: '#94a3b8',
    strokeWidth: '1.8',
    linecap: 'round',
    linejoin: 'round',
    width: '14',
    height: '14',
    transform: '',
  }
  const keydown = (id, key) => {
    let prevented = false
    nodes.get(id).dispatchEvent({
      type: 'keydown',
      key,
      preventDefault() { prevented = true },
    })
    return prevented
  }
  try {
    initStudioCharacter({ serviceAvailable: true })
    seedStudioCharacterStateForTest({ phase: 'setup', draftDescription: 'a copper-haired ranger' })
    document.getElementById('character-description').value = 'a copper-haired ranger'
    let inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelTriggerDisabled, true)
    assert.equal(inspect.modelTriggerRole, 'combobox')
    assert.equal(inspect.presetTriggerRole, 'combobox')
    assert.equal(inspect.referenceModeTriggerRole, 'combobox')
    assert.deepEqual(inspect.comboboxCarets, [caretShape, caretShape, caretShape])
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.deepEqual(calls, [])
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, false)
    assert.equal(inspect.modelTriggerDisabled, false)
    assert.equal(inspect.modelTriggerValue, 'Gemini · gemini-test-model')
    assert.equal(inspect.presetTriggerValue, STUDIO_TRANSLATIONS.zh['character.presetRpg'])
    const focused = []
    nodes.get('character-model-trigger').focus = () => focused.push('model')
    nodes.get('character-preset-trigger').focus = () => focused.push('preset')
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelTriggerExpanded, true)
    assert.equal(inspect.presetTriggerExpanded, false)
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.modelActiveDescendant, `character-model-option-${GEMINI_PRESET_ID}`)
    const modelOption = nodes.get(`character-model-option-${GEMINI_PRESET_ID}`)
    assert.equal(modelOption.getAttribute('role'), 'option')
    assert.equal(modelOption.getAttribute('aria-selected'), 'true')
    assert.equal(inspect.modelListHidden, false)
    assert.equal(keydown('character-model-trigger', 'Enter'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.equal(inspect.modelActiveDescendant, '')
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    focused.length = 0
    assert.equal(keydown('character-model-trigger', 'Escape'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.ok(focused.includes('model'))
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    const modelTabPrevented = keydown('character-model-trigger', 'Tab')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(modelTabPrevented, false)
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.deepEqual(calls, [])
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelTriggerDisabled, true)
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.equal(inspect.modelListHidden, true)
    assert.equal(inspect.modelActiveDescendant, '')
    assert.equal(inspect.modelValue, '')
    assert.equal(inspect.modelTriggerValue, STUDIO_TRANSLATIONS.zh['character.modelChecking'])
    assert.equal(inspect.modelOptions[0].text, STUDIO_TRANSLATIONS.zh['character.modelChecking'])
    assert.equal(inspect.modelOptions.some((option) => option.value === GEMINI_PRESET_ID), false)
    assert.deepEqual(calls, [])
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    nodes.get('character-model-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: { status: 'blocked' } })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.modelDisabled, true)
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.equal(inspect.modelListHidden, true)
    assert.equal(inspect.modelActiveDescendant, '')
    assert.equal(inspect.modelTriggerValue, STUDIO_TRANSLATIONS.zh['character.modelUnavailable'])
    assert.deepEqual(calls, [])
    setStudioProviderSnapshotForTest({ kind: 'resolved', provider: strictGeminiState() })
    assert.equal(nodes.get('character-preset-trigger').getAttribute('aria-controls'), 'character-preset-list')
    nodes.get('character-preset-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.presetTriggerExpanded, true)
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.equal(inspect.referenceModeTriggerExpanded, false)
    assert.equal(inspect.presetActiveDescendant, 'character-preset-option-rpg_humanoid_v0')
    assert.equal(nodes.get('character-preset-option-rpg_humanoid_v0').getAttribute('aria-selected'), 'true')
    assert.equal(keydown('character-preset-trigger', 'ArrowDown'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.presetActiveDescendant, 'character-preset-option-animal_companion_v0')
    assert.equal(keydown('character-preset-trigger', 'End'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.presetActiveDescendant, 'character-preset-option-chibi_big_pixel_v0')
    assert.equal(keydown('character-preset-trigger', 'Home'), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.presetActiveDescendant, 'character-preset-option-rpg_humanoid_v0')
    assert.equal(keydown('character-preset-trigger', 'ArrowDown'), true)
    focused.length = 0
    assert.equal(keydown('character-preset-trigger', ' '), true)
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.draftCharacterPreset, 'animal_companion_v0')
    assert.equal(nodes.get('character-preset').value, 'animal_companion_v0')
    assert.equal(inspect.presetTriggerExpanded, false)
    assert.ok(focused.includes('preset'))
    nodes.get('character-preset-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    const presetTabPrevented = keydown('character-preset-trigger', 'Tab')
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(presetTabPrevented, false)
    assert.equal(inspect.presetTriggerExpanded, false)
    assert.equal(inspect.draftCharacterPreset, 'animal_companion_v0')
    nodes.get('character-reference-mode-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    inspect = inspectStudioCharacterAiComposer()
    assert.equal(inspect.referenceModeTriggerExpanded, true)
    assert.equal(inspect.presetTriggerExpanded, false)
    assert.equal(inspect.modelTriggerExpanded, false)
    assert.deepEqual(calls, [])
  } finally {
    setStudioProviderSnapshotForTest({ kind: 'loading' })
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})
