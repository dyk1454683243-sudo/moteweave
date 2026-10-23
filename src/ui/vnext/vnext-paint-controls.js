import { brushCursorMask } from './vnext-brush-cursor.js'

// UI coverage is a count; the drawing contract still receives a width tier.
const coverageByShape = new Map()
function coverageTiers(shape) {
  if (!coverageByShape.has(shape)) coverageByShape.set(shape,
    Array.from({ length: 64 }, (_, i) => brushCursorMask({ size: i + 1, shape }).length))
  return coverageByShape.get(shape)
}

// One exact RGBA value drives every color control. HSV is only an editing view;
// rendering a picked/typed color must never quantize its bytes or alpha.
export function parsePaintHex(value, alpha = 255) {
  const hex = String(value).trim().replace(/^#/, '')
  if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null
  const rgba = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  return [...rgba, hex.length === 8 ? parseInt(hex.slice(6), 16) : alpha]
}
export function paintHex(rgba) {
  return rgba.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
export function paintHsv([r, g, b], previousHue = 0) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = previousHue
  if (d) h = ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360
  return [h, max ? d / max : 0, max]
}
export function paintRgb([h, s, v], alpha = 255) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [...rgb.map(n => Math.round((n + m) * 255)), alpha]
}

export function bindPaintControls({ root, initialColor, onColor, onBrush, isBusy, canCapture = () => false, onCapture }) {
  const get = id => root.querySelector(`#${id}`)
  const sv = get('vnext-paint-sv'), marker = get('vnext-paint-marker'), hue = get('vnext-paint-hue')
  const alpha = get('vnext-paint-alpha'), percent = get('vnext-paint-percent'), hex = get('vnext-paint-hex')
  const error = get('vnext-paint-error'), size = get('vnext-brush-size'), sizeRange = get('vnext-brush-range')
  const tips = [...(root.querySelectorAll?.('[data-brush-shape]') || [])]
  const capture = get('vnext-brush-capture'), clear = get('vnext-brush-clear'), sampleRow = get('vnext-brush-sample')
  const sampleCanvas = get('vnext-brush-preview'), sampleLabel = get('vnext-brush-dimensions'), hint = get('vnext-brush-hint')
  const inputs = [hue, alpha, percent, hex, size, sizeRange, ...tips].filter(Boolean)
  const footprint = get('vnext-brush-footprint')
  let optionShape, optionPattern
  let rgba = initialColor.slice(), hsv = paintHsv(rgba), brush = { size: 1, shape: 'square' }, dragging = null, ownHsv = false
  const blocked = () => Boolean(isBusy())
  function invalid(message = '', field = hex) {
    const notice = field === size ? get('vnext-brush-error') : error
    if (notice) { notice.textContent = message; notice.hidden = !message }
    for (const node of (field === size ? [size] : [hex, percent])) node?.setAttribute('aria-invalid', String(Boolean(message) && node === field))
  }
  function renderColor() {
    if (hex) hex.value = paintHex(rgba)
    const pc = Math.round(rgba[3] / 255 * 1000) / 10
    if (percent) percent.value = String(pc)
    if (alpha) alpha.value = String(rgba[3])
    if (hue) hue.value = String(hsv[0])
    sv?.style.setProperty('--paint-hue', `hsl(${hsv[0]} 100% 50%)`)
    sv?.setAttribute('aria-valuenow', String(Math.round(hsv[1] * 100)))
    sv?.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv[1] * 100)}%, brightness ${Math.round(hsv[2] * 100)}%. Arrow keys adjust; Shift for larger steps.`)
    if (marker) { marker.style.left = `${hsv[1] * 100}%`; marker.style.top = `${(1 - hsv[2]) * 100}%` }
    alpha?.style.setProperty('--paint-rgb', rgba.slice(0, 3).join(','))
    alpha?.setAttribute('aria-valuetext', `${pc}% · alpha ${rgba[3]} of 255`)
  }
  function setColor(next) {
    rgba = next.slice()
    if (!ownHsv) hsv = paintHsv(rgba, hsv[0])
    invalid(); renderColor()
  }
  function emit(next, fromHsv = false) {
    if (blocked()) return
    ownHsv = fromHsv
    try { setColor(next); onColor(next.slice()) } finally { ownHsv = false }
  }
  function updateHsv(next) { if (!blocked()) { hsv = next; emit(paintRgb(hsv, rgba[3]), true) } }
  function commitHex() {
    if (blocked()) { renderColor(); return }
    const next = parsePaintHex(hex.value, rgba[3])
    if (next) emit(next)
    else invalid('Use 6 or 8 hex digits, for example 4D7366FF.')
  }
  hex?.addEventListener('change', commitHex)
  hex?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); commitHex() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); invalid(); renderColor() }
  })
  hue?.addEventListener('input', () => updateHsv([Number(hue.value), hsv[1], hsv[2]]))
  alpha?.addEventListener('input', () => emit([...rgba.slice(0, 3), Number(alpha.value)]))
  function commitPercent() {
    if (blocked()) { renderColor(); return }
    const value = Number(percent.value)
    if (percent.value.trim() && Number.isFinite(value) && value >= 0 && value <= 100) emit([...rgba.slice(0, 3), Math.round(value * 255 / 100)])
    else invalid('Use an opacity from 0 to 100%.', percent)
  }
  percent?.addEventListener('change', commitPercent)
  percent?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); commitPercent() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); invalid(); renderColor() }
  })
  function point(event) {
    const rect = sv.getBoundingClientRect()
    if (rect.width && rect.height) updateHsv([hsv[0], Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))])
  }
  sv?.addEventListener('pointerdown', event => {
    if (blocked() || event.button !== 0) return
    event.preventDefault(); sv.focus(); dragging = event.pointerId
    sv.setPointerCapture(event.pointerId); point(event)
  })
  sv?.addEventListener('pointermove', event => { if (dragging === event.pointerId && !blocked()) point(event) })
  sv?.addEventListener('pointerup', event => { if (dragging === event.pointerId) { point(event); dragging = null } })
  sv?.addEventListener('lostpointercapture', () => { dragging = null })
  sv?.addEventListener('pointercancel', () => { dragging = null })
  sv?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? .1 : .01, next = hsv.slice()
    if (event.key === 'ArrowLeft') next[1] -= step
    if (event.key === 'ArrowRight') next[1] += step
    if (event.key === 'ArrowUp') next[2] += step
    if (event.key === 'ArrowDown') next[2] -= step
    updateHsv([next[0], Math.max(0, Math.min(1, next[1])), Math.max(0, Math.min(1, next[2]))])
  })
  function renderBrush() {
    const pattern = brush.shape === 'pattern' ? brush.pattern : null
    const counts = pattern ? [brushCursorMask(brush).length] : coverageTiers(brush.shape)
    const count = pattern ? counts[0] : counts[brush.size - 1]
    const width = pattern ? pattern.width : brush.size, height = pattern ? pattern.height : brush.size
    if (size) {
      if (optionShape !== brush.shape || optionPattern !== pattern) {
        // Values come only from the local numeric mask, never user text.
        size.innerHTML = counts.map(n => `<option value="${n}">${n}</option>`).join('')
        optionShape = brush.shape; optionPattern = pattern
      }
      size.value = String(count)
    }
    if (sizeRange) {
      sizeRange.value = String(brush.size)
      sizeRange.setAttribute('aria-valuetext', `${count} pixels, ${width} by ${height} image pixels`)
    }
    if (footprint) footprint.textContent = `${width} × ${height} px`
    tips.forEach(node => node.setAttribute('aria-pressed', String(node.dataset.brushShape === brush.shape)))
    if (sampleRow) sampleRow.hidden = !brush.pattern
    if (sampleLabel && brush.pattern) sampleLabel.textContent = `${brush.pattern.width} × ${brush.pattern.height} px · this tab only` // not saved: stays visible
    refresh()
  }
  function setPattern(pattern) {
    brush = { ...brush, shape: 'pattern', pattern }
    if (sampleCanvas) {
      sampleCanvas.width = pattern.width; sampleCanvas.height = pattern.height
      const ctx = sampleCanvas.getContext('2d'), pixels = ctx.createImageData(pattern.width, pattern.height)
      pixels.data.set(pattern.rgba); ctx.putImageData(pixels, 0, 0)
      sampleCanvas.style.aspectRatio = `${pattern.width} / ${pattern.height}`
    }
    invalid('', size); renderBrush(); onBrush({ ...brush })
  }
  function changeSize(node) {
    if (blocked() || brush.shape === 'pattern') { renderBrush(); return }
    const value = Number(node.value)
    const tier = node === sizeRange ? value : coverageTiers(brush.shape).indexOf(value) + 1
    if (Number.isInteger(tier) && tier >= 1 && tier <= 64) {
      brush.size = tier; invalid('', size); onBrush({ ...brush }); renderBrush()
    } else invalid('Choose an available pixel coverage.', size)
  }
  size?.addEventListener('change', () => changeSize(size))
  // Keep native select keyboard behavior (arrows, Space, Enter and Escape).
  sizeRange?.addEventListener('input', () => changeSize(sizeRange))
  tips.forEach(node => node.addEventListener('click', () => {
    if (blocked() || (node.dataset.brushShape === 'pattern' && !brush.pattern)) return
    brush.shape = node.dataset.brushShape; onBrush({ ...brush }); renderBrush()
  }))
  capture?.addEventListener('click', () => { if (!blocked() && canCapture()) onCapture?.() })
  clear?.addEventListener('click', () => {
    if (blocked()) return
    brush = { size: brush.size, shape: brush.shape === 'pattern' ? 'square' : brush.shape }
    invalid('', size); renderBrush(); onBrush({ ...brush })
  })
  function refresh() {
    const locked = blocked()
    inputs.forEach(node => { node.disabled = locked })
    for (const node of [size, sizeRange]) if (node) node.disabled = locked || brush.shape === 'pattern'
    tips.forEach(node => { if (node.dataset.brushShape === 'pattern') node.disabled = locked || !brush.pattern })
    if (capture) capture.disabled = locked || !canCapture()
    // How to enable a pattern stays visible while Use selection is unavailable (its tip is unreachable then).
    const how = !locked && !brush.pattern && capture?.disabled ? 'Select up to 64 × 64 px with Select pixels to use it as a pattern' : ''
    // A transient gesture/write lock must not collapse the hint and move the color controls.
    if (hint && !locked) { if (hint.textContent !== how) hint.textContent = how; hint.hidden = !how }
    if (clear) clear.disabled = locked || !brush.pattern
    if (sv) { sv.setAttribute('aria-disabled', String(locked)); sv.tabIndex = locked ? -1 : 0 }
    if (locked) dragging = null
  }
  renderColor(); renderBrush(); refresh()
  return { setColor, setPattern, refresh }
}
