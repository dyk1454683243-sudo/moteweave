import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { initStudioCharacterLocal, inspectStudioLocalCharacterIsolationSnapshot } from '../src/ui/studio/characterLocalView.js'
import { syncCharacterCombobox } from '../src/ui/studio/characterCombobox.js'

function createLocalDocument() {
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
      checked: false,
      files: null,
      textContent: '',
      dataset: {},
      style: {},
      classList: {
        toggle(name, force) {
          if (force === false) attrs.delete(`class:${name}`)
          else if (force === true) attrs.set(`class:${name}`, '1')
          else if (attrs.has(`class:${name}`)) attrs.delete(`class:${name}`)
          else attrs.set(`class:${name}`, '1')
        },
        add(name) { attrs.set(`class:${name}`, '1') },
        remove(name) { attrs.delete(`class:${name}`) },
        contains(name) { return attrs.has(`class:${name}`) },
      },
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => {
        attrs.set(name, String(value))
        if (name === 'id' && value) {
          node.id = String(value)
          nodes.set(String(value), node)
        }
      },
      removeAttribute: (name) => { attrs.delete(name) },
      addEventListener: (type, fn) => {
        const list = listeners.get(type) || []
        list.push(fn)
        listeners.set(type, list)
      },
      dispatchEvent: (event) => {
        for (const fn of listeners.get(event.type) || []) fn({ ...event, currentTarget: node, preventDefault() { event.preventDefault?.() } })
      },
      focus() {},
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
        if (selector === 'svg') return { getAttribute: (name) => (name === 'width' || name === 'height' ? '14' : null), style: { transform: '' } }
        return null
      },
      querySelectorAll() { return [] },
      closest(selector) {
        if (selector === '[role="option"]' && node.getAttribute('role') === 'option') return node
        return null
      },
      children: [],
      options: [],
      selectedOptions: [],
      replaceChildren(...next) {
        node.children = next
        node.options = next
      },
      append(child) {
        node.children = [...node.children, child]
        node.options = node.children
      },
      getBoundingClientRect() { return { top: 80, bottom: 108, left: 0, right: 200 } },
    }
    if (id) nodes.set(id, node)
    return node
  }
  const ids = [
    'character-advanced-layout', 'character-advanced-layout-trigger', 'character-advanced-layout-value', 'character-advanced-layout-list', 'character-advanced-layout-label',
    'character-advanced-background-mode', 'character-advanced-background-mode-trigger', 'character-advanced-background-mode-value', 'character-advanced-background-mode-list', 'character-advanced-background-mode-label',
    'character-advanced-outline-mode', 'character-advanced-outline-mode-trigger', 'character-advanced-outline-mode-value', 'character-advanced-outline-mode-list', 'character-advanced-outline-mode-label',
    'character-advanced-frame', 'character-advanced-frame-trigger', 'character-advanced-frame-value', 'character-advanced-frame-list', 'character-advanced-frame-label',
    'character-advanced-locks', 'character-local-advanced-form', 'character-advanced-config',
    'character-advanced-tolerance', 'character-advanced-min-alpha', 'character-advanced-min-area', 'character-advanced-min-area-ratio',
    'character-advanced-max-colors', 'character-advanced-anchor-x', 'character-advanced-anchor-y',
    'character-advanced-nudge-x', 'character-advanced-nudge-y', 'character-advanced-motion-max-shift',
    'character-advanced-component-cleanup', 'character-advanced-pixel-finishing', 'character-advanced-outline',
    'character-advanced-auto-correct', 'character-advanced-motion-stabilize',
    'character-advanced-export-1x', 'character-advanced-export-2x', 'character-advanced-export-3x', 'character-advanced-export-4x',
    'character-advanced-black-file', 'character-advanced-black-clear', 'character-advanced-black-name',
    'character-local-file', 'character-local-name', 'character-local-primary',
    'character-advanced-nudge-save', 'character-advanced-nudge-clear',
    'character-advanced-auto-grid', 'character-advanced-calibration-open', 'character-advanced-cuts-open',
    'character-local-workspace',
  ]
  for (const id of ids) {
    const tag = id.endsWith('-file') || id.includes('tolerance') || id.includes('min-') || id.includes('anchor') || id.includes('nudge') || id.includes('max-') || id.includes('motion-max') ? 'input'
      : id.includes('export') || id.includes('cleanup') || id.includes('finishing') || id === 'character-advanced-outline' || id.includes('auto-correct') || id.includes('stabilize') ? 'input'
        : id === 'character-advanced-layout' || id === 'character-advanced-background-mode' || id === 'character-advanced-outline-mode' || id === 'character-advanced-frame' || id === 'character-advanced-locks' ? 'select'
          : id.includes('clear') || id.includes('save') || id.includes('open') || id.includes('grid') || id.includes('primary') ? 'button'
            : 'div'
    createNode(id, tag)
  }
  const layout = nodes.get('character-advanced-layout')
  layout.value = 'fixed_region_motion_v0'
  layout.options = [
    { value: 'topdown_rpg_v0', text: '标准 RPG · 8 × 8', textContent: '标准 RPG · 8 × 8', getAttribute: () => null },
    { value: 'fixed_region_motion_v0', text: '固定区域动作源图', textContent: '固定区域动作源图', getAttribute: () => null },
  ]
  const bg = nodes.get('character-advanced-background-mode')
  bg.value = 'auto'
  bg.options = [
    { value: 'auto', text: '自动检测', textContent: '自动检测', getAttribute: () => null },
    { value: 'flood', text: '纯色连通去背', textContent: '纯色连通去背', getAttribute: () => null },
    { value: 'edge_palette', text: '边缘取色去背', textContent: '边缘取色去背', getAttribute: () => null },
    { value: 'alpha', text: '透明通道清理', textContent: '透明通道清理', getAttribute: () => null },
    { value: 'dual_matte', text: '黑白底配对', textContent: '黑白底配对', getAttribute: () => null },
  ]
  const outline = nodes.get('character-advanced-outline-mode')
  outline.value = 'outer'
  outline.options = [
    { value: 'outer', text: '外描边', textContent: '外描边', getAttribute: () => null },
    { value: 'inner', text: '内描边', textContent: '内描边', getAttribute: () => null },
    { value: 'both', text: '内外描边', textContent: '内外描边', getAttribute: () => null },
  ]
  const frame = nodes.get('character-advanced-frame')
  frame.options = []
  frame.append = (child) => {
    frame.children = [...frame.children, child]
    frame.options = frame.children
  }
  const docListeners = new Map()
  const document = {
    documentElement: { lang: 'zh-CN' },
    createElement: (tag) => createNode('', tag),
    getElementById: (id) => nodes.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === '.character-advanced-panel-close' || selector === '.character-advanced-panel-back') return []
      if (selector === '[data-character-advanced-frame-index]') return []
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
  return { document, nodes }
}

test('Character Local HTML keeps four branded comboboxes and hidden native selects', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  for (const id of ['character-advanced-layout', 'character-advanced-background-mode', 'character-advanced-outline-mode', 'character-advanced-frame']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*hidden`))
    assert.match(html, new RegExp(`id="${id}-trigger"[^>]*role="combobox"`))
    assert.match(html, new RegExp(`id="${id}-list"[^>]*role="listbox"`))
  }
  assert.match(html, /id="character-advanced-locks"[^>]*multiple/)
  assert.doesNotMatch(html, /id="character-advanced-locks-trigger"/)
  function insideOpenLabel(id) {
    const idx = html.indexOf(`id="${id}"`)
    const before = html.slice(0, idx)
    return before.lastIndexOf('<label') > before.lastIndexOf('</label>')
  }
  for (const id of ['character-advanced-background-mode-trigger', 'character-advanced-outline-mode-trigger', 'character-advanced-frame-trigger']) {
    assert.equal(insideOpenLabel(id), false, `${id} must not sit inside a label`)
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-labelledby="${id.replace('-trigger', '-label')} ${id.replace('-trigger', '-value')}"`))
  }
  assert.match(html, /class="character-advanced-field"/)
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  const controller = await readFile('src/ui/studio/characterCombobox.js', 'utf8')
  assert.doesNotMatch(css, /\.character-local-panel:has\(\.character-ai-combobox-trigger\[aria-expanded="true"\]\)/)
  assert.doesNotMatch(css, /\.character-advanced-scroll:has\(\.character-ai-combobox-trigger\[aria-expanded="true"\]\)/)
  assert.match(css, /\.character-ai-combobox-list \{[^}]*position:\s*fixed/)
  assert.match(css, /\.character-ai-combobox-list\.is-scrollable \{[^}]*max-height:\s*232px/)
  assert.doesNotMatch(controller, /scrollIntoView/)
  assert.match(controller, /preventScroll:\s*true/)
  assert.match(controller, /list\.scrollTop/)
  assert.match(controller, /position:\s*fixed|style\.left/)
})

test('Character Local comboboxes write canonical select values and stay one-open', async () => {
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { document, nodes } = createLocalDocument()
  globalThis.document = document
  globalThis.fetch = async () => { throw new Error('unexpected fetch') }
  const calls = []
  try {
    initStudioCharacterLocal({ serviceAvailable: true })
    assert.equal(nodes.get('character-advanced-frame').options.length, 64)
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('role'), 'combobox')
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    let focusOpts = null
    nodes.get('character-advanced-layout-trigger').focus = (opts) => { focusOpts = opts }
    nodes.get('character-advanced-layout-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'true')
    assert.equal(focusOpts?.preventScroll, true)
    nodes.get('character-advanced-background-mode-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    assert.equal(nodes.get('character-advanced-background-mode-trigger').getAttribute('aria-expanded'), 'true')
    const flood = nodes.get('character-advanced-background-mode-option-flood')
    assert.equal(flood.getAttribute('role'), 'option')
    let changes = 0
    nodes.get('character-advanced-background-mode').addEventListener('change', () => { changes += 1 })
    nodes.get('character-advanced-background-mode-list').dispatchEvent({
      type: 'click',
      preventDefault() {},
      target: flood,
    })
    assert.equal(nodes.get('character-advanced-background-mode').value, 'flood')
    assert.equal(changes, 1)
    assert.equal(nodes.get('character-advanced-background-mode-trigger').getAttribute('aria-expanded'), 'false')
    const focused = []
    nodes.get('character-advanced-outline-mode-trigger').focus = () => focused.push('outline')
    nodes.get('character-advanced-outline-mode-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    nodes.get('character-advanced-outline-mode-trigger').dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault() {},
    })
    nodes.get('character-advanced-outline-mode-trigger').dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault() {},
    })
    assert.equal(nodes.get('character-advanced-outline-mode').value, 'inner')
    assert.ok(focused.includes('outline'))
    nodes.get('character-advanced-frame-trigger').focus = () => focused.push('frame')
    nodes.get('character-advanced-frame-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    assert.equal(nodes.get('character-advanced-frame-list').classList.contains('is-scrollable'), true)
    assert.equal(nodes.get('character-advanced-outline-mode-trigger').getAttribute('aria-expanded'), 'false')
    assert.equal(nodes.get('character-advanced-frame').options.length, 64)
    nodes.get('character-advanced-frame-trigger').dispatchEvent({
      type: 'keydown',
      key: 'End',
      preventDefault() {},
    })
    nodes.get('character-advanced-frame-trigger').dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault() {},
    })
    assert.equal(nodes.get('character-advanced-frame').value, '63')
    nodes.get('character-advanced-layout-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    nodes.get('character-advanced-layout-trigger').dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() {},
    })
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    nodes.get('character-advanced-layout-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    let tabPrevented = false
    nodes.get('character-advanced-layout-trigger').dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault() { tabPrevented = true },
    })
    assert.equal(tabPrevented, false)
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    nodes.get('character-advanced-layout-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    document.dispatchEvent({ type: 'pointerdown', target: { id: 'outside' } })
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    nodes.get('character-advanced-layout-trigger').dispatchEvent({ type: 'click', preventDefault() {} })
    nodes.get('character-advanced-layout').disabled = true
    syncCharacterCombobox('advancedLayout', { editable: false })
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-expanded'), 'false')
    assert.equal(nodes.get('character-advanced-layout-trigger').getAttribute('aria-disabled'), 'true')
    const snapshot = inspectStudioLocalCharacterIsolationSnapshot()
    assert.equal(snapshot.advancedSettings.backgroundMode, 'flood')
    assert.equal(snapshot.advancedSettings.pixelFinishingOutlineMode, 'inner')
    assert.equal(calls.length, 0)
  } finally {
    globalThis.document = previousDocument
    globalThis.fetch = previousFetch
  }
})
