// The part of a requested result's lifecycle shared by every capability: which history entry
// its own write recorded (so Undo reverts exactly that operation), and which run turn it belongs
// to while a committed write still waits for recovery (a refresh, a position save, a reload).
// It holds no DOM and makes no requests: execution and recovery stay with each capability,
// presentation with vnext-thread-turns.js.

// The entry a write recorded, as reported by the write itself; otherwise the newest entry if it
// appeared during the write (the fallback for writes that do not report their entry).
export function undoEntryFor(reported, before = null, after = null) {
  if (reported) return reported
  return after && after !== before ? after : null
}

export function createResultLifecycle({ latestUndoEntry = () => null, undoIfLatest = null, entryState = () => null,
  latestRedoEntry = () => null, redoIfLatest = null } = {}) {
  const held = new Map()
  return {
    // A result whose write committed but whose completion waits for recovery keeps its original
    // turn and author under one key, so the recovery completes that result instead of a new one.
    hold(key, record) {
      if (!key) return null
      const value = { ...record, key }
      held.set(key, value)
      return value
    },
    peek(key) { return (key && held.get(key)) || null },
    // Completing consumes the record: a repeated recovery or replay finds nothing to complete twice.
    complete(key) {
      const value = (key && held.get(key)) || null
      if (key) held.delete(key)
      return value
    },
    releaseWhere(predicate) {
      for (const [key, value] of held) if (predicate(value)) held.delete(key)
    },
    // 'undone': this result was reverted. 'retry': it is still the latest change but another save
    // blocked it, so the same Undo stays offered. 'already_undone': ⌘Z/Ctrl+Z already reverted it.
    // 'superseded': a later change exists, so this Undo would revert someone else's edit and is
    // withdrawn.
    async undo(entry) {
      if (!entry || typeof undoIfLatest !== 'function' || latestUndoEntry() !== entry) return this.elsewhere(entry)
      let undone = false
      try { undone = await undoIfLatest(entry) } catch { undone = false }
      if (undone) return 'undone'
      return latestUndoEntry() === entry ? 'retry' : this.elsewhere(entry)
    },
    // Why an entry is not the latest change: already undone (it sits in redo) or superseded.
    elsewhere(entry) {
      return entry && entryState(entry) === 'redo' ? 'already_undone' : 'superseded'
    },
    // An offered Undo whose entry left this project's history (the history was replaced, for
    // example after a project switch) can no longer revert anything.
    gone(entry) {
      return Boolean(entry) && entryState(entry) === 'absent'
    },
    // A result's Undo status follows its history entry, whichever control moved it (its own Undo or
    // Redo, ⌘Z / Ctrl+Z, ⌘⇧Z / Ctrl+Shift+Z): back among the undoable changes it is offered again,
    // among the undone ones it is undone, and once gone from the history it is dropped (null).
    settle(undo) {
      if (!undo || undo.running) return undo
      const state = entryState(undo.entry)
      if (state === 'absent') return null
      if (state === 'redo') undo.status = 'undone'
      else if (state === 'undo' && undo.status === 'undone') undo.status = 'offered'
      return undo
    },
    // Redo of exactly this undone result is offered only while it is the newest undone change, so it
    // never re-applies someone else's change. It restores the same canvas: nothing is added again.
    canRedo(entry) {
      return Boolean(entry) && typeof redoIfLatest === 'function' && latestRedoEntry() === entry
    },
    // 'redone': restored. 'retry': still the newest undone change, but another save blocked it.
    // 'superseded': it is no longer the newest undone change (or not undone), so nothing is redone.
    async redo(entry) {
      if (!this.canRedo(entry)) return 'superseded'
      let redone = false
      try { redone = await redoIfLatest(entry) } catch { redone = false }
      if (redone) return 'redone'
      return latestRedoEntry() === entry ? 'retry' : 'superseded'
    },
  }
}
