// Text draft = a live, unsaved preview of raster text. Nothing here writes pixels: the draft is
// rendered from the saved baseline on every change, and only placing it becomes one saved edit.

export const TEXT_DRAFT_DEFAULTS = Object.freeze({
  text: '', fontId: 'sans-serif', family: 'sans-serif', size: 16,
  bold: false, italic: false, antialias: false, mode: 'fill', strokeWidth: 1,
})

const KEYS = ['text', 'fontId', 'family', 'size', 'bold', 'italic', 'antialias', 'mode', 'strokeWidth', 'x', 'y']

export function sameTextSnapshot(a, b) {
  if (!a || !b) return false
  return KEYS.every(key => a[key] === b[key])
    && Array.isArray(a.color) && Array.isArray(b.color) && a.color.every((v, i) => v === b.color[i])
}

export function cloneTextSnapshot(snapshot) {
  return { ...snapshot, color: snapshot.color.slice() }
}

/**
 * Undo history of one draft. Continuous changes (typing, slider drags, colour drags, placement drags)
 * share an open group and replace its newest step; a different group, a discrete change or end()
 * closes it, so each undo step is one meaningful change.
 */
export function createTextDraftHistory(initial) {
  const steps = [cloneTextSnapshot(initial)]
  let index = 0, openGroup = null
  return {
    current: () => cloneTextSnapshot(steps[index]),
    get canUndo() { return index > 0 },
    get canRedo() { return index < steps.length - 1 },
    get size() { return steps.length },
    record(snapshot, group = null) {
      if (sameTextSnapshot(snapshot, steps[index])) { if (group !== openGroup) openGroup = null; return false }
      if (group && group === openGroup && index > 0) {
        // A burst that ends where it started (type, then delete it again) leaves no undo step.
        if (sameTextSnapshot(snapshot, steps[index - 1])) { steps.splice(index); index -= 1; openGroup = null; return true }
        steps[index] = cloneTextSnapshot(snapshot)
      } else { steps.splice(index + 1); steps.push(cloneTextSnapshot(snapshot)); index = steps.length - 1 }
      steps.splice(index + 1)
      openGroup = group
      return true
    },
    end() { openGroup = null },
    undo() {
      openGroup = null
      if (index === 0) return null
      index -= 1
      return cloneTextSnapshot(steps[index])
    },
    redo() {
      openGroup = null
      if (index >= steps.length - 1) return null
      index += 1
      return cloneTextSnapshot(steps[index])
    },
  }
}

/** Bounding box of the pixels a draft changes, in image pixels; null when nothing changes. */
export function textDraftBounds(source, bytes) {
  const { width, height, rgba } = source
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (bytes[i] === rgba[i] && bytes[i + 1] === rgba[i + 1] && bytes[i + 2] === rgba[i + 2] && bytes[i + 3] === rgba[i + 3]) continue
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/** Keep whole-pixel placement without clamping editable text to the image edges. */
export function clampTextAnchor(width, height, point) {
  const integer = value => Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number.isFinite(value) ? value : 0)))
  return { x: integer(point.x), y: integer(point.y) }
}

export function pointInTextBounds(bounds, point, slop = 1) {
  return Boolean(bounds) && point.x >= bounds.x - slop && point.y >= bounds.y - slop
    && point.x < bounds.x + bounds.w + slop && point.y < bounds.y + bounds.h + slop
}
