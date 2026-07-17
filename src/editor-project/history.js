import { clonePlain } from './safety.js'

function trimPast(past, limit) {
  if (past.length <= limit) return past
  return past.slice(past.length - limit)
}

export function createCommandHistory({ snapshot = null, selection = null, limit = 100 } = {}) {
  return {
    past: [],
    present: clonePlain(snapshot),
    future: [],
    selection: clonePlain(selection),
    limit,
    group_key: null,
  }
}

export function commitHistory(history, snapshot, { selection = history.selection, groupKey = null } = {}) {
  const next = {
    ...history,
    present: clonePlain(snapshot),
    future: [],
    selection: clonePlain(selection),
    group_key: groupKey,
  }

  if (groupKey && history.group_key === groupKey) return next

  next.past = trimPast([
    ...history.past,
    {
      snapshot: clonePlain(history.present),
      selection: clonePlain(history.selection),
      group_key: history.group_key,
    },
  ], next.limit)
  return next
}

export function undoHistory(history, { resolveSelection } = {}) {
  if (!history.past.length) return history
  const previous = history.past.at(-1)
  const presentEntry = {
    snapshot: clonePlain(history.present),
    selection: clonePlain(history.selection),
    group_key: history.group_key,
  }
  const selection = resolveSelection
    ? resolveSelection(clonePlain(previous.selection), clonePlain(previous.snapshot))
    : previous.selection
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: clonePlain(previous.snapshot),
    future: [presentEntry, ...history.future],
    selection: clonePlain(selection),
    group_key: previous.group_key ?? null,
  }
}

export function redoHistory(history, { resolveSelection } = {}) {
  if (!history.future.length) return history
  const nextEntry = history.future[0]
  const presentEntry = {
    snapshot: clonePlain(history.present),
    selection: clonePlain(history.selection),
    group_key: history.group_key,
  }
  const selection = resolveSelection
    ? resolveSelection(clonePlain(nextEntry.selection), clonePlain(nextEntry.snapshot))
    : nextEntry.selection
  return {
    ...history,
    past: trimPast([...history.past, presentEntry], history.limit),
    present: clonePlain(nextEntry.snapshot),
    future: history.future.slice(1),
    selection: clonePlain(selection),
    group_key: nextEntry.group_key ?? null,
  }
}
