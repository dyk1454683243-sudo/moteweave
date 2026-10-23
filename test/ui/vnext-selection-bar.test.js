import assert from 'node:assert/strict'
import test from 'node:test'

import { placeSelectionBar } from '../../src/ui/vnext/vnext-manual-pixels.js'

const host = { width: 720, height: 640 }, bar = { width: 300, height: 44 }
const overlaps = (p, r) => p.left < r.right && p.left + bar.width > r.left && p.top < r.bottom && p.top + bar.height > r.top
const inside = p => p.left >= 8 && p.top >= 8 && p.left + bar.width <= host.width - 8 && p.top + bar.height <= host.height - 8

test('the bar sits below a visible image, aligned with the selection', () => {
  const image = { left: 100, top: 100, right: 400, bottom: 300 }, selection = { left: 150, top: 150, right: 200, bottom: 200 }
  assert.deepEqual(placeSelectionBar({ host, bar, image, selection }), { left: 150, top: 308 })
})

test('when the image fills the view, a selection near the bottom edge gets the bar above it, not on it', () => {
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }
  const selection = { left: 120, top: 560, right: 200, bottom: 618 }
  const p = placeSelectionBar({ host, bar, image, selection })
  assert.equal(overlaps(p, selection), false); assert.ok(inside(p)); assert.equal(p.top, 560 - 8 - 44)
})

test('when the image fills the view, a selection near the top edge gets the bar below it', () => {
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }, selection = { left: 120, top: 10, right: 200, bottom: 60 }
  const p = placeSelectionBar({ host, bar, image, selection })
  assert.equal(overlaps(p, selection), false); assert.equal(p.top, 68)
})

test('a tall selection spanning the view puts the bar beside it', () => {
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }, selection = { left: 20, top: 0, right: 300, bottom: 640 }
  const p = placeSelectionBar({ host, bar, image, selection })
  assert.equal(overlaps(p, selection), false); assert.ok(inside(p)); assert.equal(p.left, 308)
})

test('floating canvas controls are avoided when a free spot exists', () => {
  const image = { left: 100, top: 100, right: 400, bottom: 300 }, selection = { left: 150, top: 150, right: 200, bottom: 200 }
  const footer = { left: 100, top: 300, right: 480, bottom: 360 } // covers the spot below the image
  const p = placeSelectionBar({ host, bar, image, selection, avoid: [footer] })
  assert.equal(overlaps(p, footer), false); assert.equal(overlaps(p, selection), false); assert.equal(p.top, 100 - 8 - 44)
})

test('a selection covering the whole view: least selection overlap, then the bottom edge clear of controls', () => {
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }, selection = { left: -10, top: -10, right: 730, bottom: 650 }
  const modeSwitch = { left: 250, top: 16, right: 470, bottom: 48 }, toolRail = { left: 670, top: 16, right: 704, bottom: 300 }
  const p = placeSelectionBar({ host, bar, image, selection, avoid: [modeSwitch, toolRail] })
  assert.ok(inside(p)); assert.equal(overlaps(p, modeSwitch), false); assert.equal(overlaps(p, toolRail), false)
  assert.equal(p.top, host.height - 8 - 44, 'prefers the bottom edge when the selection is unavoidable')
})

test('when every spot next to the selection is blocked, the nearest free spot elsewhere is used', () => {
  // Image fills the view; selection near the bottom; a Preview panel leaves only 298px to its left.
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }, selection = { left: 244, top: 576, right: 306, bottom: 616 }
  const preview = { left: 306, top: 324, right: 712, bottom: 632 }, modeSwitch = { left: 254, top: 16, right: 470, bottom: 48 }
  const p = placeSelectionBar({ host, bar, image, selection, avoid: [preview, modeSwitch] })
  assert.equal(overlaps(p, selection), false); assert.equal(overlaps(p, preview), false); assert.equal(overlaps(p, modeSwitch), false)
  assert.ok(inside(p))
})

test('a free band narrower than the grid step between two controls is still found', () => {
  // Free rows only between the mode switch (bottom 52) and a wide panel starting at 104: the 44px bar fits at 52..96.
  const image = { left: -200, top: -200, right: 1000, bottom: 900 }, selection = { left: 120, top: 500, right: 600, bottom: 632 }
  const modeSwitch = { left: 0, top: 0, right: 720, bottom: 52 }, panel = { left: 0, top: 104, right: 720, bottom: 500 }
  const p = placeSelectionBar({ host, bar, image, selection, avoid: [modeSwitch, panel] })
  assert.equal(overlaps(p, selection), false); assert.equal(overlaps(p, modeSwitch), false); assert.equal(overlaps(p, panel), false)
  assert.ok(p.top >= 52 && p.top + bar.height <= 104)
})
