// Contextual tips in the web Skill reference tooltip style (agreed design: grey text, 8 px radius), for
// supplementary instructions and shortcuts only: states, errors, recovery steps and disabled reasons stay
// visible on the page. A tip opens beside its panel or tool rail, level with its control, so it never covers
// neighbouring controls; it describes the control via aria-describedby.
// Hover and keyboard focus are tracked separately: a hover tip opens after a short delay and stays open while
// the pointer moves onto it (passing other controls on the way switches only after a pause on one); a
// keyboard-focused control keeps its tip after the pointer leaves. Esc hides the visible tip only (it never
// reaches other Esc handlers such as placing text) and cancels any pending hover; the tip stays hidden until
// the pointer and focus have left that control.

const GAP = 6, EDGE = 8, HOVER_DELAY = 350, LEAVE_DELAY = 200, SLOP = 4

const NOOP = Object.freeze({ set() {}, hide() {}, get active() { return null } })

// sides: containers a tip opens beside. canCover: the drawing surface and its content, which a tip may overlay.
export function bindTooltips(root, { sides = '.vnext-color-sidebar, .vnext-tools', canCover = '#vnext-canvas-stage, .vnext-canvas-world *' } = {}) {
  const doc = root?.nodeType === 9 ? root : root?.ownerDocument || globalThis.document
  if (!doc?.body || typeof doc.createElement !== 'function' || typeof root?.addEventListener !== 'function') return NOOP
  const win = doc.defaultView || globalThis
  const layer = doc.createElement('div')
  layer.className = 'vnext-tooltip-layer'
  doc.body.append(layer)
  const tips = new WeakMap(), dismissed = new Set()
  let seq = 0, hover = null, focus = null, shown = null, pending = null, corridor = null, hoverTimer = 0, leaveTimer = 0

  function tipFor(el) {
    let tip = tips.get(el)
    if (!tip) {
      tip = doc.createElement('div')
      tip.className = 'vnext-tooltip'
      tip.id = `vnext-tooltip-${++seq}`
      tip.setAttribute('role', 'tooltip')
      tip.hidden = true
      layer.append(tip)
      tips.set(el, tip)
      const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      el.setAttribute('aria-describedby', [...ids, tip.id].join(' '))
    }
    return tip
  }
  /** Sets (or clears) a control's tip; it replaces the browser's own title tooltip. */
  function set(el, text) {
    if (!el) return
    const value = String(text || '')
    el.dataset.tooltip = value
    el.removeAttribute('title')
    const tip = tipFor(el)
    if (tip.textContent !== value) tip.textContent = value
    if (el === shown) render()
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))
  const inRect = (r, x, y) => Boolean(r) && x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP
  const hoverBox = el => el.closest('label') || el // a field's label box (e.g. "X") counts as the field
  const triggerOf = node => node?.closest?.('[data-tooltip]') || node?.closest?.('label')?.querySelector?.('[data-tooltip]') || null
  // A trigger scrolled out of its panel (or the viewport) shows no tip; it returns when scrolled back.
  function clippedOut(el) {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return true
    for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
      const style = win.getComputedStyle(p)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const c = p.getBoundingClientRect()
      if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) return true
    }
    return r.bottom <= 0 || r.top >= win.innerHeight || r.right <= 0 || r.left >= win.innerWidth
  }
  // Controls a tip must not cover: everything interactive outside the trigger's own panel and the drawing surface.
  function obstacles(el, side) {
    const out = []
    for (const n of doc.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')) {
      if (n === el || side?.contains(n) || layer.contains(n) || n.matches(canCover)) continue
      const r = n.getBoundingClientRect()
      if (r.width && r.height && win.getComputedStyle(n).visibility !== 'hidden') out.push(r)
    }
    return out
  }
  function place(el, tip) {
    const r = el.getBoundingClientRect(), vw = win.innerWidth, vh = win.innerHeight
    tip.style.left = '0px'; tip.style.top = '0px'
    const w = tip.offsetWidth, h = tip.offsetHeight
    const side = el.closest(sides)
    let left = -1, top = clamp(r.top + r.height / 2 - h / 2, EDGE, vh - h - EDGE)
    if (side) {
      // Beside the panel or rail, level with the control. If that lands on another control (the tool rail, the
      // stage's zoom buttons…), move the shortest way clear of it: further left, or just above or below it.
      const ideal = { left: side.getBoundingClientRect().left - GAP - w, top }, blocks = obstacles(el, side), tried = new Set()
      const hitAt = p => blocks.find(b => p.left < b.right + GAP && p.left + w > b.left - GAP && p.top < b.bottom + GAP && p.top + h > b.top - GAP)
      const fits = p => p.left >= EDGE && p.top >= EDGE && p.top + h <= vh - EDGE && !tried.has(`${p.left},${p.top}`)
      const cost = p => Math.abs(p.left - ideal.left) + Math.abs(p.top - ideal.top)
      let pos = ideal, hit = hitAt(pos)
      for (let i = 0; hit && i < 8; i++, hit = hitAt(pos)) {
        tried.add(`${pos.left},${pos.top}`)
        const next = [{ left: hit.left - GAP - w, top: pos.top }, { left: pos.left, top: hit.top - GAP - h }, { left: pos.left, top: hit.bottom + GAP }]
          .filter(fits).sort((a, b) => cost(a) - cost(b))[0]
        if (!next) break
        pos = next
      }
      left = pos.left; top = pos.top // best effort beside the panel even if nothing is fully clear
    }
    if (left < EDGE) { // no clear spot beside (very narrow window): above the control, or below it
      left = clamp(r.left + r.width / 2 - w / 2, EDGE, vw - w - EDGE)
      top = r.top - h - GAP >= EDGE ? r.top - h - GAP : Math.min(r.bottom + GAP, vh - h - EDGE)
    }
    tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(top)}px`
    return tip.getBoundingClientRect()
  }
  function wanted() {
    for (const el of [hover, focus]) {
      if (el && el.isConnected && el.dataset.tooltip && !dismissed.has(el) && !clippedOut(el)) return el
    }
    return null
  }
  function render() {
    const el = wanted()
    if (shown && shown !== el) tips.get(shown).hidden = true
    shown = el
    corridor = null
    if (!el) return
    const tip = tipFor(el)
    if (tip.textContent !== el.dataset.tooltip) tip.textContent = el.dataset.tooltip
    tip.hidden = false
    const t = place(el, tip)
    if (el === hover) { // the strip between the control and its tip, so the pointer can travel to the tip
      const r = hoverBox(el).getBoundingClientRect()
      corridor = { left: Math.min(t.left, r.left), right: Math.max(t.right, r.right), top: Math.min(t.top, r.top), bottom: Math.max(t.bottom, r.bottom) }
    }
  }
  function cancelPending() { clearTimeout(hoverTimer); hoverTimer = 0; pending = null }
  function schedule(el, delay) {
    if (pending === el) return
    cancelPending()
    pending = el
    hoverTimer = win.setTimeout(() => {
      pending = null; hoverTimer = 0
      clearTimeout(leaveTimer); leaveTimer = 0
      hover = el
      render()
    }, delay)
  }
  function forget(el) { if (el && el !== hover && el !== focus) dismissed.delete(el) }
  function endHover() {
    clearTimeout(leaveTimer); leaveTimer = 0
    const was = hover
    hover = null
    forget(was)
    render()
  }

  for (const el of root.querySelectorAll?.('[data-tooltip]') || []) set(el, el.dataset.tooltip)

  doc.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return
    const x = event.clientX, y = event.clientY, target = triggerOf(event.target)
    for (const el of [...dismissed]) if (el !== target) forget(el)
    if (hover && shown === hover) {
      const onTip = inRect(tips.get(hover).getBoundingClientRect(), x, y)
      if (target === hover || onTip) { clearTimeout(leaveTimer); leaveTimer = 0; cancelPending(); return }
      if (inRect(corridor, x, y)) {
        // On the way to the tip: keep it; another control under the pointer takes over only after a pause.
        clearTimeout(leaveTimer); leaveTimer = 0
        if (target && !dismissed.has(target)) schedule(target, HOVER_DELAY); else cancelPending()
        return
      }
      if (!leaveTimer) leaveTimer = win.setTimeout(endHover, LEAVE_DELAY)
    } else if (hover && target !== hover) {
      endHover()
    }
    if (target && target !== hover && !dismissed.has(target)) schedule(target, shown ? 0 : HOVER_DELAY)
    else if (target !== pending) cancelPending()
  }, true)
  doc.addEventListener('pointerout', event => { if (!event.relatedTarget) { cancelPending(); if (hover) endHover() } }, true) // left the window
  doc.addEventListener('pointerdown', event => {
    cancelPending()
    if (shown && tips.get(shown)?.contains(event.target)) {
      dismissed.add(shown)
      render()
      return
    }
    if (hover && !tips.get(hover).contains(event.target)) { dismissed.add(hover); render() } // a click closes the hover tip
  }, true)
  root.addEventListener('focusin', event => {
    const el = triggerOf(event.target)
    let keyboard = Boolean(el)
    try { if (el) keyboard = el.matches(':focus-visible') } catch { /* older engines: show on any focus */ }
    const was = focus
    focus = keyboard ? el : null
    forget(was)
    render()
  })
  root.addEventListener('focusout', event => {
    const el = triggerOf(event.target)
    if (!el || focus !== el) return
    focus = null
    forget(el)
    render()
  })
  win.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    const waiting = pending
    cancelPending() // a pending hover must not reopen a tip right after Esc
    if (waiting) dismissed.add(waiting)
    if (!shown) return
    event.preventDefault(); event.stopImmediatePropagation() // dismiss only: this Esc must not place text or cancel anything
    for (const el of [shown, hover, focus, waiting]) if (el) dismissed.add(el)
    render()
  }, true)
  win.addEventListener('resize', render)
  doc.addEventListener('scroll', render, true)
  return { set, hide() { cancelPending(); hover = null; focus = null; render() }, get active() { return shown } }
}
