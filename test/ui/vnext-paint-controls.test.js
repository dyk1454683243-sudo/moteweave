import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePaintHex, paintHex, paintHsv, paintRgb, bindPaintControls } from '../../src/ui/vnext/vnext-paint-controls.js'

test('paint hex preserves exact RGBA, accepts 6/8 digits, rejects incomplete/invalid input', () => {
  assert.deepEqual(parsePaintHex(' #123aBC ', 17), [18, 58, 188, 17])
  assert.deepEqual(parsePaintHex('123abc80'), [18, 58, 188, 128])
  assert.deepEqual(parsePaintHex('09080700'), [9, 8, 7, 0])
  assert.equal(paintHex([9, 8, 7, 0]), '09080700')
  for (const value of ['', '#', '123', '1234567', 'GG3456', '123456789', '12 3456']) assert.equal(parsePaintHex(value), null)
})

test('RGB/HSV roundtrip retains bytes and achromatic hue; percentage display preserves all alpha bytes', () => {
  for (const r of [0, 1, 77, 128, 254, 255]) for (const g of [0, 115, 255]) for (const b of [0, 102, 255]) {
    assert.deepEqual(paintRgb(paintHsv([r, g, b]), 73), [r, g, b, 73])
  }
  assert.deepEqual(paintHsv([128, 128, 128], 279), [279, 0, 128 / 255])
  assert.deepEqual(paintRgb([240, 1, 1], 0), [0, 0, 255, 0])
  for (let a = 0; a <= 255; a++) assert.equal(Math.round((Math.round(a / 255 * 1000) / 10) * 255 / 100), a)
})

function harness() {
  const nodes = new Map()
  class Control {
    constructor(id) { this.id = id; this.value = ''; this.style = { setProperty() {} }; this.listeners = {}; this.attrs = {}; this.dataset = {}; nodes.set(id, this) }
    addEventListener(type, fn) { this.listeners[type] = fn }
    setAttribute(k, v) { this.attrs[k] = v }
    focus() {} setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 } }
    fire(type, data = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...data }) }
  }
  for (const id of ['sv', 'marker', 'hue', 'alpha', 'percent', 'hex', 'error']) new Control(`vnext-paint-${id}`)
  for (const id of ['size', 'range', 'footprint', 'error', 'capture', 'clear', 'sample', 'dimensions', 'hint']) new Control(`vnext-brush-${id}`)
  const tips = ['round', 'square', 'pattern'].map(shape => { const n = new Control(shape); n.dataset.brushShape = shape; return n })
  let busy = false, capturable = false, captures = 0, selected = [77, 115, 102, 255], brush, colors = 0, changes = 0
  let panel
  panel = bindPaintControls({ root: { querySelector: id => nodes.get(id.slice(1)), querySelectorAll: () => tips },
    initialColor: selected, isBusy: () => busy, canCapture: () => capturable, onCapture: () => { captures++ },
    onColor: color => { colors++; selected = color; panel.setColor(color) }, onBrush: value => { changes++; brush = value } })
  return { panel, node: id => nodes.get(id), color: () => selected, counts: () => [colors, changes], brush: () => brush, busy: value => { busy = value; panel.refresh() }, capturable: value => { capturable = value; panel.refresh() }, captures: () => captures }
}

test('color controls synchronize hex/alpha/picker; invalid draft does not write; Escape restores', () => {
  const h = harness(), hex = h.node('vnext-paint-hex'), alpha = h.node('vnext-paint-alpha')
  hex.value = '#12345680'; hex.fire('change')
  assert.deepEqual(h.color(), [18, 52, 86, 128]); assert.equal(alpha.value, '128')
  assert.equal(h.node('vnext-paint-percent').value, '50.2')
  hex.value = 'oops'; hex.fire('keydown', { key: 'Enter' })
  assert.deepEqual(h.color(), [18, 52, 86, 128]); assert.equal(hex.attrs['aria-invalid'], 'true')
  hex.fire('keydown', { key: 'Escape' }); assert.equal(hex.value, '12345680')
  hex.value = 'FF0000'; hex.fire('change'); assert.deepEqual(h.color(), [255, 0, 0, 128])
  const hue = h.node('vnext-paint-hue'); hue.value = '240'; hue.fire('input')
  assert.deepEqual(h.color(), [0, 0, 255, 128])
  const sv = h.node('vnext-paint-sv'); sv.fire('pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 50 })
  sv.fire('pointerup', { pointerId: 1, clientX: 50, clientY: 50 })
  assert.deepEqual(h.color(), [64, 64, 128, 128])
  sv.fire('keydown', { key: 'ArrowUp', shiftKey: true }); assert.deepEqual(h.color(), [77, 77, 153, 128])
  alpha.value = '0'; alpha.fire('input'); assert.equal(h.color()[3], 0)
  const pc = h.node('vnext-paint-percent'); pc.value = '100'; pc.fire('change'); assert.equal(h.color()[3], 255)
})

test('brush coverage maps square and symmetric round tiers without changing width contract', () => {
  const h = harness(), size = h.node('vnext-brush-size'), hex = h.node('vnext-paint-hex')
  const values = () => [...size.innerHTML.matchAll(/value="(\d+)"/g)].map(m => Number(m[1]))
  assert.deepEqual(values(), Array.from({ length: 64 }, (_, i) => (i + 1) ** 2))
  for (const count of [1, 4, 9, 16, 81, 4096]) {
    size.value = String(count); size.fire('change')
    assert.equal(h.brush().size, Math.sqrt(count))
    assert.equal(h.node('vnext-brush-footprint').textContent, `${Math.sqrt(count)} × ${Math.sqrt(count)} px`)
  }
  h.node('round').fire('click')
  assert.deepEqual(h.brush(), { size: 64, shape: 'round' })
  assert.deepEqual(values().slice(0, 5), [1, 4, 9, 12, 21])
  assert.equal(values().length, 64); assert.equal(new Set(values()).size, 64)
  for (const bad of ['', '0', '2', '16', '65', '1.5', '4097']) {
    size.value = bad; size.fire('change'); assert.equal(size.attrs['aria-invalid'], 'true'); assert.equal(h.brush().size, 64)
  }
  size.value = '12'; size.fire('change'); assert.deepEqual(h.brush(), { size: 4, shape: 'round' })
  assert.equal(size.attrs['aria-invalid'], 'false')
  h.node('square').fire('click'); assert.equal(size.value, '16')
  const range = h.node('vnext-brush-range'); range.value = '9'; range.fire('input')
  assert.equal(size.value, '81'); assert.equal(range.attrs['aria-valuetext'], '81 pixels, 9 by 9 image pixels')
  assert.equal(h.brush().size, 9)
  assert.equal(size.listeners.keydown, undefined, 'native select keys are not intercepted')
  h.busy(true); assert.equal(size.disabled, true); assert.equal(hex.disabled, true)
  assert.equal(h.node('vnext-paint-sv').attrs['aria-disabled'], 'true')
  const before = h.counts(); size.value = '2'; size.fire('change'); h.node('square').fire('click')
  hex.value = 'ABCDEF00'; hex.fire('change'); h.node('vnext-paint-sv').fire('keydown', { key: 'ArrowUp' })
  assert.deepEqual(h.counts(), before); assert.deepEqual(h.brush(), { size: 9, shape: 'square' })
  h.busy(false); assert.equal(hex.disabled, false); hex.value = 'ABCDEF00'; hex.fire('change')
  assert.deepEqual(h.color(), [171, 205, 239, 0])
})
test('percent Enter reports invalid drafts; Escape restores without changing color', () => {
  const h = harness(), percent = h.node('vnext-paint-percent')
  for (const bad of ['', '-1', '101', 'NaN']) {
    percent.value = bad; percent.fire('keydown', { key: 'Enter' })
    assert.equal(percent.attrs['aria-invalid'], 'true'); assert.equal(h.node('vnext-paint-error').hidden, false)
    assert.deepEqual(h.color(), [77, 115, 102, 255]); percent.fire('keydown', { key: 'Escape' }); assert.equal(percent.value, '100')
  }
  percent.value = '50'; percent.fire('keydown', { key: 'Enter' }); assert.equal(h.color()[3], 128)
})

test('busy paint controls retain their hint geometry without accepting edits', () => {
  const h = harness(), hint = h.node('vnext-brush-hint'), size = h.node('vnext-brush-size')
  for (const capturable of [false, true]) {
    h.capturable(capturable)
    const before = { text: hint.textContent, hidden: hint.hidden }, counts = h.counts()
    h.busy(true)
    assert.deepEqual({ text: hint.textContent, hidden: hint.hidden }, before)
    size.value = '4'; size.fire('change'); h.node('round').fire('click')
    assert.deepEqual(h.counts(), counts); assert.equal(size.disabled, true)
    h.busy(false)
    assert.deepEqual({ text: hint.textContent, hidden: hint.hidden }, before)
  }
})

test('pattern controls require a sample and selection, keep original size, and restore the regular brush', () => {
  const h = harness(), pattern = { width: 3, height: 2, rgba: new Uint8Array(24).fill(255) }
  pattern.rgba[3] = 0; pattern.rgba[7] = 1 // holes excluded; even faint cells are covered
  assert.equal(h.node('pattern').disabled, true); assert.equal(h.node('vnext-brush-capture').disabled, true)
  h.node('pattern').fire('click'); assert.equal(h.brush(), undefined)
  h.capturable(true); h.node('vnext-brush-capture').fire('click'); assert.equal(h.captures(), 1)
  h.panel.setPattern(pattern); assert.equal(h.brush().shape, 'pattern')
  assert.equal(h.node('vnext-brush-size').disabled, true); assert.equal(h.node('vnext-brush-dimensions').textContent, '3 × 2 px · this tab only')
  assert.equal(h.node('vnext-brush-size').value, '5')
  assert.equal(h.node('vnext-brush-footprint').textContent, '3 × 2 px')
  assert.equal(h.node('vnext-brush-range').attrs['aria-valuetext'], '5 pixels, 3 by 2 image pixels')
  const size = h.node('vnext-brush-size'); size.value = '7'; size.fire('change'); assert.equal(h.brush().size, 1)
  h.busy(true); h.node('vnext-brush-clear').fire('click'); h.node('vnext-brush-capture').fire('click')
  assert.equal(h.captures(), 1); assert.equal(h.brush().pattern, pattern)
  h.busy(false); h.node('round').fire('click'); assert.equal(size.disabled, false); assert.equal(h.node('pattern').disabled, false)
  h.node('pattern').fire('click'); assert.equal(size.disabled, true)
  h.node('vnext-brush-clear').fire('click'); assert.deepEqual(h.brush(), { size: 1, shape: 'square' })
  assert.equal(h.node('vnext-brush-sample').hidden, true); assert.equal(size.disabled, false); assert.equal(h.node('pattern').disabled, true)
})
