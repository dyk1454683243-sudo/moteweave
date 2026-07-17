class FakeClassList {
  constructor(owner) { this.owner = owner }
  values() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)) }
  contains(value) { return this.values().has(value) }
  add(...values) { this.owner.className = [...new Set([...this.values(), ...values])].join(' ') }
  remove(...values) { const removed = new Set(values); this.owner.className = [...this.values()].filter((value) => !removed.has(value)).join(' ') }
  toggle(value, force) {
    const enabled = force == null ? !this.contains(value) : Boolean(force)
    if (enabled) this.add(value); else this.remove(value)
    return enabled
  }
}

function dataName(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function selectorMatch(node, selector) {
  const notDisabled = selector.includes(':not([disabled])')
  const base = selector.replace(':not([disabled])', '')
  if (notDisabled && node.disabled) return false
  if (base === '[tabindex="0"]') return node.tabIndex === 0
  const attr = base.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
  if (attr) {
    const [, key, expected] = attr
    const value = key.startsWith('data-') ? node.dataset[dataName(key.slice(5))] : node.getAttribute(key)
    return expected == null ? value != null : String(value) === expected
  }
  const combined = base.match(/^([a-z]+)?(\.[a-z0-9_-]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i)
  if (!combined) return false
  const [, tag, classToken, key, expected] = combined
  if (tag && node.tagName !== tag.toUpperCase()) return false
  if (classToken && !node.classList.contains(classToken.slice(1))) return false
  if (key) {
    const value = key.startsWith('data-') ? node.dataset[dataName(key.slice(5))] : node.getAttribute(key)
    if (expected == null ? value == null : String(value) !== expected) return false
  }
  return true
}

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.parentNode = null
    this.className = ''
    this.classList = new FakeClassList(this)
    this.dataset = {}
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = {}
    this.hidden = false
    this.disabled = false
    this.checked = false
    this.selected = false
    this.multiple = false
    this.value = ''
    this.type = ''
    this.tabIndex = -1
    this.inert = false
    this.textContent = ''
    this.title = ''
    this.scrollCount = 0
    this.clientWidth = 320
    this.clientHeight = 320
  }
  get childNodes() { return this.children }
  get options() { return this.tagName === 'SELECT' ? this.children : [] }
  get selectedOptions() { return this.options.filter((option) => option.selected) }
  append(...nodes) { for (const item of nodes) { const node = typeof item === 'string' ? this.ownerDocument.createTextNode(item) : item; node.parentNode = this; this.children.push(node) } }
  prepend(...nodes) { for (const item of [...nodes].reverse()) { item.parentNode = this; this.children.unshift(item) } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes) }
  insertBefore(node, reference) { const index = reference == null ? this.children.length : this.children.indexOf(reference); if (node.parentNode) node.remove(); node.parentNode = this; this.children.splice(index < 0 ? this.children.length : index, 0, node) }
  remove() { if (!this.parentNode) return; const index = this.parentNode.children.indexOf(this); if (index >= 0) this.parentNode.children.splice(index, 1); this.parentNode = null }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'tabindex') this.tabIndex = Number(value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener) }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  dispatchEvent(event) { event.target ??= this; event.currentTarget = this; event.preventDefault ??= () => { event.defaultPrevented = true }; for (const listener of this.listeners.get(event.type) ?? []) listener(event); if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event); return !event.defaultPrevented }
  closest(selector) { let cursor = this; while (cursor) { if (selectorMatch(cursor, selector)) return cursor; cursor = cursor.parentNode } return null }
  querySelectorAll(selector) { const selectors = selector.split(',').map((value) => value.trim()); const result = []; const visit = (node) => { for (const child of node.children) { if (selectors.some((item) => selectorMatch(child, item))) result.push(child); visit(child) } }; visit(this); return result }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  focus() { this.ownerDocument.activeElement = this }
  scrollIntoView() { this.scrollCount += 1 }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight } }
  getContext() {
    return {
      canvas: this,
      imageSmoothingEnabled: true,
      clearRect() {}, drawImage: () => { this.ownerDocument.drawImageCount += 1 }, putImageData() {}, getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) } },
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, stroke() {}, strokeRect() {}, fillRect() {}, setLineDash() {},
      arc: (...args) => { this.ownerDocument.arcCalls.push(args) },
      moveTo() {}, lineTo() {}, fillText() {},
      set lineWidth(value) { this.canvas.ownerDocument.lineWidths.push(value) },
    }
  }
}

export function fakeDocument({ narrow = false } = {}) {
  const listeners = new Set()
  const media = {
    matches: narrow,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener) },
    setMatches(value) { this.matches = value; for (const listener of listeners) listener({ matches: value }) },
  }
  const documentRef = {
    activeElement: null,
    drawImageCount: 0,
    createCount: 0,
    arcCalls: [],
    lineWidths: [],
    media,
    defaultView: { matchMedia: () => media },
    createElement(tag) { documentRef.createCount += 1; return new FakeElement(tag, documentRef) },
    createTextNode(text) { const node = new FakeElement('#text', documentRef); node.textContent = text; return node },
  }
  return documentRef
}
