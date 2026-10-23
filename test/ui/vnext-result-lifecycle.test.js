import assert from 'node:assert/strict'
import test from 'node:test'
import { createResultLifecycle, undoEntryFor } from '../../src/ui/vnext/vnext-result-lifecycle.js'

test('a result binds the Undo entry its own write reported, falling back only to an entry that appeared during the write', () => {
  const before = { id: 'before' }, after = { id: 'after' }, reported = { id: 'reported' }
  assert.equal(undoEntryFor(reported, before, after), reported)
  assert.equal(undoEntryFor(null, before, after), after)
  assert.equal(undoEntryFor(null, before, before), null, 'no entry when nothing new was recorded')
})

test('a held result completes exactly once, and Undo reverts it only while it is still the latest change', async () => {
  let latest = null
  const undone = []
  const blocked = new Set()
  const results = createResultLifecycle({
    latestUndoEntry: () => latest,
    undoIfLatest: async entry => { if (blocked.has(entry)) return false; undone.push(entry); latest = null; return true },
  })
  const turn = { id: 'turn' }
  results.hold('image:job', { turn, provider: 'grok' })
  assert.equal(results.peek('image:job').turn, turn)
  assert.equal(results.complete('image:job').provider, 'grok')
  assert.equal(results.complete('image:job'), null, 'a repeated recovery finds nothing to complete twice')
  const entry = { id: 'entry' }
  latest = { id: 'later edit' }
  assert.equal(await results.undo(entry), 'superseded', 'a later change withdraws this Undo')
  assert.deepEqual(undone, [])
  latest = entry; blocked.add(entry)
  assert.equal(await results.undo(entry), 'retry', 'blocked by another save: the same Undo stays offered')
  blocked.clear()
  assert.equal(await results.undo(entry), 'undone')
  assert.deepEqual(undone, [entry])
  results.hold('a', { projectId: 'p1' }); results.hold('b', { projectId: 'p2' })
  results.releaseWhere(record => record.projectId === 'p1')
  assert.equal(results.peek('a'), null); assert.ok(results.peek('b'))
})

test('an Undo already reverted with ⌘Z / Ctrl+Z reports already_undone, and an entry that left the history is gone', async () => {
  const entry = { id: 'entry' }
  let state = 'undo', latest = { id: 'later edit' }
  const results = createResultLifecycle({ latestUndoEntry: () => latest, undoIfLatest: async () => true, entryState: () => state })
  assert.equal(await results.undo(entry), 'superseded', 'still in the history under a later change: withdrawn')
  assert.equal(results.gone(entry), false)
  state = 'redo'; latest = null
  assert.equal(await results.undo(entry), 'already_undone', 'reverted with ⌘Z / Ctrl+Z, not by a later change')
  state = 'absent'
  assert.equal(await results.undo(entry), 'superseded')
  assert.equal(results.gone(entry), true, 'the history that held it was replaced')
  const plain = createResultLifecycle({ latestUndoEntry: () => null, undoIfLatest: async () => true })
  assert.equal(await plain.undo(entry), 'superseded', 'without an entry state the old answer is kept')
  assert.equal(plain.gone(entry), false)
})

test('r7: a result Undo status follows its history entry, and Redo restores exactly that undone result while it is the newest undone change', async () => {
  const entry = { id: 'placement' }, later = { id: 'later' }
  let state = 'undo', newestRedo = null, blocked = false
  const redone = []
  const results = createResultLifecycle({
    entryState: () => state,
    latestRedoEntry: () => newestRedo,
    redoIfLatest: async item => { if (blocked) return false; redone.push(item); newestRedo = null; state = 'undo'; return true },
  })
  const undo = { entry, status: 'offered', running: false }
  state = 'redo'
  assert.equal(results.settle(undo).status, 'undone', '⌘Z / Ctrl+Z undid it')
  state = 'undo'
  assert.equal(results.settle(undo).status, 'offered', '⌘⇧Z / Ctrl+Shift+Z put it back')
  state = 'absent'
  assert.equal(results.settle(undo), null, 'gone from the history: dropped')
  state = 'redo'
  newestRedo = later
  assert.equal(results.canRedo(entry), false, 'not the newest undone change')
  assert.equal(await results.redo(entry), 'superseded')
  assert.deepEqual(redone, [])
  newestRedo = entry; blocked = true
  assert.equal(await results.redo(entry), 'retry', 'another save blocked it: the same Redo stays offered')
  blocked = false
  assert.equal(await results.redo(entry), 'redone')
  assert.deepEqual(redone, [entry])
  assert.equal(createResultLifecycle({ entryState: () => 'redo', latestRedoEntry: () => entry }).canRedo(entry), false, 'no Redo without a Redo step')
})
