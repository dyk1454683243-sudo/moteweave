import { assertPixelStructure } from '../../editor-project/pixelStructure.js'

export const ONION_DEFAULTS = Object.freeze({ enabled: false, previous: 1, next: 1, opacity: 35, previousTint: '#de9693', nextTint: '#82a8c8' })

export function onionFrames(order, frameId, settings) {
  const at = order.indexOf(frameId), result = []
  if (at < 0) return result
  for (const [side, sign] of [['previous', -1], ['next', 1]]) {
    const count = Math.max(0, Math.min(3, Math.trunc(Number(settings[side]) || 0)))
    for (let distance = count; distance >= 1; distance--) {
      const id = order[at + sign * distance]
      if (id) result.push({ id, distance, tint: settings[`${side}Tint`], opacity: settings.opacity / distance })
    }
  }
  return result
}

// A fresh display buffer, never a saved cel or the canvas/locator preview.
export function tintOnionPixels(bytes, tint, opacity) {
  const out = new Uint8ClampedArray(bytes.length)
  const rgb = [1, 3, 5].map(at => parseInt(tint.slice(at, at + 2), 16))
  const alpha = Math.max(0, Math.min(100, opacity)) / 100
  for (let at = 0; at < bytes.length; at += 4) {
    out.set(rgb, at); out[at + 3] = Math.round(bytes[at + 3] * alpha)
  }
  return out
}

export function bindOnionSkin({ root, session, compose, status, clearStatus }) {
  const button = root.querySelector('#vnext-onion-toggle'), settingsButton = root.querySelector('[data-vnext-toggle="onion"]')
  const pop = root.querySelector('.vnext-onion-pop'), stage = root.querySelector('#vnext-canvas-stage')
  if (!button || !settingsButton || !pop || !stage) return null
  const settings = { ...ONION_DEFAULTS }, inputs = [...pop.querySelectorAll('[data-onion-setting]')]
  const steppers = [...pop.querySelectorAll('[data-onion-step]')]
  let owner = null, desired = null, running = false, generation = 0, key = '', overlay = null, error = false
  let cache = new Map()
  const failure = 'Onion skin could not load. Turn it off and on to retry.'
  function clearError() { error = false; clearStatus?.(failure) }
  const context = () => {
    const canvasId = session.view.selectedId, canvas = session.view.canvases.find(c => c.id === canvasId)
    const manifest = session.documents.get(session.project?.canvases?.[canvasId]?.document_id)
    return { projectId: session.project?.id, epoch: session.api.openEpoch.current, canvasId, canvas, manifest,
      frameId: session.documentTimeline?.target(manifest)?.frame_id }
  }
  const sameOwner = (a, b) => a && b && a.projectId === b.projectId && a.epoch === b.epoch && a.canvasId === b.canvasId && a.manifest === b.manifest
  const suspended = () => session.documentCandidate || session.openInFlight?.() || session.frameLoading || session.documentTimeline?.isPlaying()
  const live = request => desired === request && request.generation === generation && settings.enabled && !suspended()
    && sameOwner(request, context()) && request.frameId === context().frameId
  function clear() { overlay?.remove(); overlay = null }
  function place() {
    if (!overlay || !owner) return
    const tile = stage.querySelector(`[data-canvas-id="${owner.canvasId}"]`)
    const pos = session.view.positionOf(owner.canvasId)
    if (tile) { overlay.style.left = `${pos.x}px`; overlay.style.top = `${pos.y}px`; tile.before(overlay) }
  }
  async function pump() {
    if (running) return
    running = true
    try {
      while (desired) {
        const request = desired, frameCache = cache
        try {
          for (const frame of request.frames) {
            if (!live(request)) break
            if (!frameCache.has(frame.id)) {
              const bytes = await compose(request.projectId, request.manifest, frame.id)
              if (live(request)) frameCache.set(frame.id, bytes)
            }
          }
          if (!live(request)) { if (desired === request) desired = null; continue }
          const { w, h } = request.manifest.canvas
          const surface = document.createElement('canvas'); surface.width = w; surface.height = h
          surface.className = 'vnext-onion-overlay'; surface.setAttribute('aria-hidden', 'true')
          const ctx = surface.getContext('2d'), part = document.createElement('canvas'); part.width = w; part.height = h
          const partContext = part.getContext('2d')
          for (const frame of request.frames) {
            const data = partContext.createImageData(w, h)
            data.data.set(tintOnionPixels(frameCache.get(frame.id), frame.tint, frame.opacity))
            partContext.putImageData(data, 0, 0); ctx.drawImage(part, 0, 0)
          }
          clear(); overlay = surface; place(); desired = null; button.dataset.state = 'ready'; clearError(); render()
        } catch {
          if (live(request)) {
            clear(); desired = null; error = true; button.dataset.state = 'error'
            button.title = failure
            status(button.title, { error: true })
          } else if (desired === request) desired = null
        }
      }
    } finally { running = false }
  }
  function render() {
    const next = context()
    let supported = false
    try { assertPixelStructure(next.manifest); supported = next.manifest.frame_order.length > 1 } catch { /* No saved multi-frame document. */ }
    if (!sameOwner(owner, next)) { owner = next; cache = new Map(); key = ''; clearError() }
    const disabled = !supported || Boolean(session.openInFlight?.() || session.frameLoading || session.manualGesture)
    button.disabled = settingsButton.disabled = disabled
    inputs.forEach(input => { input.disabled = disabled })
    steppers.forEach(stepper => { const [name, step] = stepper.dataset.onionStep.split(':'); stepper.disabled = disabled || settings[name] + Number(step) < 0 || settings[name] + Number(step) > 3 })
    button.classList.toggle('is-selected', settings.enabled)
    button.setAttribute('aria-pressed', String(settings.enabled))
    button.setAttribute('aria-label', settings.enabled ? 'Turn onion skin off' : 'Turn onion skin on')
    if (!error) button.title = !supported ? 'Select a saved canvas with at least two frames.' : disabled ? 'Finish the current edit or project change first.' : settings.enabled ? 'Turn onion skin off' : 'Turn onion skin on'
    settingsButton.title = disabled ? button.title : 'Onion skin settings'
    const nextKey = JSON.stringify([settings, next.frameId, supported, Boolean(suspended())])
    if (key === nextKey) { place(); return }
    key = nextKey; generation++; desired = null; clear(); button.dataset.state = 'idle'
    if (!supported || !settings.enabled || suspended()) return
    const frames = onionFrames(next.manifest.frame_order, next.frameId, settings)
    const ids = new Set(frames.map(f => f.id))
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
    if (!frames.length || !settings.opacity) return
    desired = { ...next, frames, generation }; button.dataset.state = 'loading'; void pump()
  }
  button.addEventListener('click', () => {
    if (button.disabled) return
    settings.enabled = !settings.enabled; clearError(); if (settings.enabled) cache = new Map()
    render()
  })
  settingsButton.addEventListener('click', () => {
    if (settingsButton.disabled) return
    pop.hidden = !pop.hidden; settingsButton.setAttribute('aria-expanded', String(!pop.hidden))
    if (!pop.hidden) {
      const anchor = settingsButton.getBoundingClientRect(), board = pop.offsetParent.getBoundingClientRect()
      pop.style.left = `${Math.max(12, Math.min(anchor.right - board.left - pop.offsetWidth, board.width - pop.offsetWidth - 12))}px`
      pop.style.top = `${Math.max(12, anchor.top - board.top - pop.offsetHeight - 8)}px`
      inputs[0]?.focus()
    }
  })
  for (const input of inputs) {
    const name = input.dataset.onionSetting
    input.value = String(settings[name])
    const sizeValue = () => { if (name === 'opacity') input.style.width = `${Math.max(1, input.value.length)}ch` }
    sizeValue(); input.addEventListener('input', sizeValue)
    const commit = () => {
      if (!input.disabled) {
        const value = input.type === 'color' ? input.value : Number(input.value.replace('%', ''))
        if (input.type === 'color' ? /^#[0-9a-f]{6}$/i.test(value) : input.value.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= (name === 'opacity' ? 100 : 3)) settings[name] = value
      }
      input.value = String(settings[name]); sizeValue(); error = false; render()
    }
    input.addEventListener('change', commit)
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit() } })
  }
  for (const stepper of steppers) stepper.addEventListener('click', () => {
    if (stepper.disabled) return
    const [name, step] = stepper.dataset.onionStep.split(':')
    settings[name] += Number(step); inputs.find(input => input.dataset.onionSetting === name).value = String(settings[name]); error = false; render()
  })
  pop.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); pop.hidden = true; settingsButton.setAttribute('aria-expanded', 'false'); settingsButton.focus() }
  })
  pop.addEventListener('keyup', e => e.stopPropagation())
  settingsButton.addEventListener('keydown', e => { if (e.code === 'Space') e.stopPropagation() })
  button.addEventListener('keydown', e => { if (e.code === 'Space') e.stopPropagation() })
  return { render }
}
