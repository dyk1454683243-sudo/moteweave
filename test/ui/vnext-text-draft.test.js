import test from 'node:test'
import assert from 'node:assert/strict'
import { TEXT_DRAFT_DEFAULTS, clampTextAnchor, createTextDraftHistory, pointInTextBounds, sameTextSnapshot, textDraftBounds } from '../../src/ui/vnext/vnext-text-draft.js'

const base = { ...TEXT_DRAFT_DEFAULTS, color: [1, 2, 3, 255], x: 2, y: 3 }

test('typing and slider drags are one undo step each; discrete changes are their own step', () => {
  const history = createTextDraftHistory(base)
  for (const text of ['H', 'He', 'Hel', 'Hello']) history.record({ ...base, text }, 'text')
  history.record({ ...base, text: 'Hello', size: 20 }, 'size')
  history.record({ ...base, text: 'Hello', size: 28 }, 'size') // same drag
  history.record({ ...base, text: 'Hello', size: 28, bold: true }) // discrete
  assert.equal(history.size, 4)
  assert.equal(history.undo().bold, false)
  assert.equal(history.undo().size, 16)
  assert.equal(history.undo().text, '')
  assert.equal(history.undo(), null, 'the first step is the empty draft')
  assert.equal(history.redo().text, 'Hello')
})

test('a pause or another control ends a group, and a new change after Undo drops the redo branch', () => {
  const history = createTextDraftHistory(base)
  history.record({ ...base, text: 'A' }, 'text'); history.end()
  history.record({ ...base, text: 'AB' }, 'text')
  assert.equal(history.size, 3, 'a pause split the typing into two steps')
  history.undo()
  history.record({ ...base, text: 'A', italic: true })
  assert.equal(history.canRedo, false)
  assert.equal(history.current().italic, true)
  assert.equal(history.record({ ...base, text: 'A', italic: true }), false, 'an unchanged snapshot adds nothing')
  assert.equal(sameTextSnapshot(history.current(), { ...base, text: 'A', italic: true }), true)
  const copy = history.current(); copy.color[0] = 99
  assert.equal(history.current().color[0], 1, 'snapshots are copies')
})

test('a burst that returns to where it started leaves no empty undo step', () => {
  const history = createTextDraftHistory(base)
  history.record({ ...base, text: 'Hi' }); history.end()
  for (const text of ['Hi!', 'Hi']) history.record({ ...base, text }, 'text')
  assert.equal(history.size, 2)
  assert.equal(history.undo().text, '', 'one Undo goes back past the typed text, not to an identical step')
  history.redo()
  history.record({ ...base, text: 'Hi', size: 20 }, 'size'); history.record({ ...base, text: 'Hi', size: 16 }, 'size')
  history.record({ ...base, text: 'Hi', size: 18 }, 'size')
  assert.equal(history.size, 3, 'a new change after returning starts its own step')
})

test('draft bounds come from the clean baseline, and whole-pixel placement can cross image edges', () => {
  const rgba = new Uint8Array(6 * 4 * 4), bytes = new Uint8Array(rgba)
  bytes.set([9, 9, 9, 255], ((1 * 6) + 2) * 4); bytes.set([9, 9, 9, 255], ((2 * 6) + 4) * 4)
  assert.deepEqual(textDraftBounds({ width: 6, height: 4, rgba }, bytes), { x: 2, y: 1, w: 3, h: 2 })
  assert.equal(textDraftBounds({ width: 6, height: 4, rgba }, new Uint8Array(rgba)), null)
  assert.deepEqual(clampTextAnchor(6, 4, { x: -3, y: 9.6 }), { x: -3, y: 10 })
  assert.deepEqual(clampTextAnchor(6, 4, { x: NaN, y: 1.4 }), { x: 0, y: 1 })
  assert.equal(pointInTextBounds({ x: 2, y: 1, w: 3, h: 2 }, { x: 5, y: 3 }), true, 'one pixel of slop')
  assert.equal(pointInTextBounds({ x: 2, y: 1, w: 3, h: 2 }, { x: 6, y: 1 }), false)
  assert.equal(pointInTextBounds(null, { x: 0, y: 0 }), false)
})
