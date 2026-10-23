// Rasterize into a fixed-size canvas. Editable text is kept separately; overflow only clips pixels.
export function createPixelText(source, color, start, text, size, makeCanvas = () => document.createElement('canvas'), options = {}) {
  const bytes = copyPixelBuffer(source, color), { width, height } = source
  if (!start || !Number.isSafeInteger(start.x) || !Number.isSafeInteger(start.y)) throw new Error('Use whole-number text coordinates.')
  if (!Number.isInteger(size) || size < 6 || size > 96) throw new Error('Use a whole-number size from 6 to 96 px.')
  if (typeof text !== 'string' || text.length > 160) throw new Error('Use at most 160 characters.')
  const { family = 'sans-serif', bold = false, italic = false, antialias = false, mode = 'fill', strokeWidth = 1 } = options
  if (typeof family !== 'string' || !/^(sans-serif|serif|monospace|GameToolFont\d+)$/.test(family)
    || [bold, italic, antialias].some(v => typeof v !== 'boolean') || !['fill', 'stroke', 'both'].includes(mode)
    || !Number.isInteger(strokeWidth) || strokeWidth < 1 || strokeWidth > 8) throw new Error('Invalid text style.')
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 4) throw new Error('Use at most 4 lines.')
  if (!text.trim()) return { bytes, changed: false }
  const canvas = makeCanvas(), ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Text preview is unavailable in this browser.')
  canvas.width = width; canvas.height = height
  const layout = measurePixelTextLayout(ctx, lines, size, options)
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = strokeWidth; ctx.lineJoin = 'round'
  const { step } = layout
  const x = start.x + layout.drawXOffset, y = start.y + layout.drawYOffset
  lines.forEach((line, i) => {
    if (mode !== 'fill') ctx.strokeText(line, x, y + i * step)
    if (mode !== 'stroke') ctx.fillText(line, x, y + i * step)
  })
  const mask = ctx.getImageData(0, 0, width, height).data
  for (let i = 0; i < bytes.length; i += 4) {
    const coverage = antialias ? mask[i + 3] / 255 : Number(mask[i + 3] >= 128)
    if (!coverage) continue
    if (coverage === 1) { bytes.set(color, i); continue }
    // Coverage interpolates the replacement paint and original premultiplied RGBA.
    const inkAlpha = color[3] * coverage, oldAlpha = bytes[i + 3] * (1 - coverage), alpha = inkAlpha + oldAlpha
    for (let c = 0; c < 3; c++) bytes[i + c] = alpha ? Math.round((color[c] * inkAlpha + bytes[i + c] * oldAlpha) / alpha) : 0
    bytes[i + 3] = Math.round(alpha)
  }
  return { bytes, changed: bytes.some((v, i) => v !== source.rgba[i]) }
}

export function measurePixelTextLayout(ctx, lines, size, options = {}) {
  const { family = 'sans-serif', bold = false, italic = false, mode = 'fill', strokeWidth = 1 } = options
  if (typeof family !== 'string' || !/^(sans-serif|serif|monospace|GameToolFont\d+)$/.test(family)
    || [bold, italic].some(value => typeof value !== 'boolean') || !['fill', 'stroke', 'both'].includes(mode)
    || !Number.isInteger(strokeWidth) || strokeWidth < 1 || strokeWidth > 8) throw new Error('Invalid text style.')
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}`
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.direction = 'ltr'
  const padding = mode === 'fill' ? 0 : Math.ceil(strokeWidth / 2)
  const step = pixelTextLineStep(size, { mode, strokeWidth })
  const metrics = lines.map(line => ctx.measureText(line))
  if (metrics.some(metric => [metric.width, metric.actualBoundingBoxLeft, metric.actualBoundingBoxRight, metric.actualBoundingBoxAscent, metric.actualBoundingBoxDescent].some(value => !Number.isFinite(value)))) throw new Error('This font cannot be measured safely.')
  const left = Math.max(0, ...metrics.map(metric => metric.actualBoundingBoxLeft))
  const ascent = Math.max(size, ...metrics.map(metric => metric.actualBoundingBoxAscent))
  return { padding, step, metrics, drawXOffset: Math.ceil(left) + padding, drawYOffset: Math.ceil(ascent) + padding }
}

function pixelTextExceedsCanvas(x, y, metrics, step, padding, width, height) {
  return metrics.some((metric, index) => !Number.isFinite(metric.actualBoundingBoxRight + metric.actualBoundingBoxDescent)
    || x + Math.max(metric.width, metric.actualBoundingBoxRight) + padding > width
    || y + index * step + metric.actualBoundingBoxDescent + padding > height)
}

export function pixelTextFits(anchor, text, size, width, height, options = {}, makeCanvas = () => document.createElement('canvas')) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return false
  if (!anchor || !Number.isInteger(anchor.x) || !Number.isInteger(anchor.y) || anchor.x < 0 || anchor.y < 0 || anchor.x >= width || anchor.y >= height) return false
  if (!Number.isInteger(size) || size < 6 || size > 96 || typeof text !== 'string' || text.length > 160) return false
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 4) return false
  if (!text.trim()) return true
  try {
    const canvas = makeCanvas(), ctx = canvas?.getContext?.('2d', { willReadFrequently: true })
    if (!ctx) return false
    const layout = measurePixelTextLayout(ctx, lines, size, options)
    const x = anchor.x + layout.drawXOffset, y = anchor.y + layout.drawYOffset
    return !pixelTextExceedsCanvas(x, y, layout.metrics, layout.step, layout.padding, width, height)
  } catch {
    return false
  }
}

export function pixelTextLineStep(size, options = {}) {
  const mode = options.mode || 'fill'
  const strokeWidth = options.strokeWidth ?? 1
  const padding = mode === 'fill' ? 0 : Math.ceil(strokeWidth / 2)
  return Math.ceil(size * 1.25) + padding * 2
}

export function pixelTextBounds(anchor, text, size, options = {}, makeCanvas = () => document.createElement('canvas')) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const step = pixelTextLineStep(size, options)
  if (!String(text || '').trim()) return { x: anchor.x, y: anchor.y, w: 2, h: step, step }
  const canvas = makeCanvas(), ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Text preview is unavailable in this browser.')
  const layout = measurePixelTextLayout(ctx, lines, size, options)
  let right = anchor.x, bottom = anchor.y
  lines.forEach((line, index) => {
    const metric = layout.metrics[index]
    const drawX = anchor.x + layout.drawXOffset
    const drawY = anchor.y + layout.drawYOffset + index * layout.step
    right = Math.max(right, drawX + Math.max(metric.width, metric.actualBoundingBoxRight) + layout.padding)
    bottom = Math.max(bottom, drawY + metric.actualBoundingBoxDescent + layout.padding)
  })
  return { x: anchor.x, y: anchor.y, w: Math.max(1, Math.ceil(right - anchor.x)), h: Math.max(layout.step, Math.ceil(bottom - anchor.y)), step: layout.step }
}

// Small, provider-free, single-cel pixel tools. Saved RGBA is the only source.
export function copyPixelBuffer({ width, height, rgba }, color) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || !(rgba instanceof Uint8Array) || rgba.length !== width * height * 4
    || !Array.isArray(color) || color.length !== 4 || [0, 1, 2, 3].some(i => !Number.isInteger(color[i]) || color[i] < 0 || color[i] > 255)
    || (typeof SharedArrayBuffer !== 'undefined' && rgba.buffer instanceof SharedArrayBuffer)) {
    throw new Error('Unsupported pixel buffer or paint color.')
  }
  return new Uint8Array(rgba)
}

export function createPixelFill(source, color, seed, rect = { x: 0, y: 0, w: source.width, h: source.height }) {
  const bytes = copyPixelBuffer(source, color), { width, height } = source
  const inside = (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h
  if (!seed || !Number.isInteger(seed.x) || !Number.isInteger(seed.y)
    || seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height || !inside(seed.x, seed.y)) return { bytes, changed: false }
  const start = seed.y * width + seed.x, target = bytes.slice(start * 4, start * 4 + 4)
  if (color.every((value, i) => value === target[i])) return { bytes, changed: false }
  // A changed pixel cannot match target again: mark on enqueue, no extra visited buffer.
  // At most one queue entry per pixel (4 MiB at the supported 1024×1024 limit).
  const queue = new Uint32Array(width * height)
  let head = 0, tail = 0
  function visit(index) {
    if (!inside(index % width, Math.floor(index / width))) return
    const offset = index * 4
    if (bytes[offset] !== target[0] || bytes[offset + 1] !== target[1]
      || bytes[offset + 2] !== target[2] || bytes[offset + 3] !== target[3]) return
    bytes.set(color, offset); queue[tail++] = index
  }
  visit(start)
  while (head < tail) {
    const index = queue[head++], x = index % width
    if (x > 0) visit(index - 1)
    if (x + 1 < width) visit(index + 1)
    if (index >= width) visit(index - width)
    if (index + width < width * height) visit(index + width)
  }
  return { bytes, changed: true }
}

export function copyPixelPattern(pattern) {
  const { width, height, rgba } = pattern || {}
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 64 || height > 64
    || !(rgba instanceof Uint8Array) || rgba.length !== width * height * 4
    || (typeof SharedArrayBuffer !== 'undefined' && rgba.buffer instanceof SharedArrayBuffer)) {
    throw new Error('Select a pattern from 1 to 64 px on each side.')
  }
  if (!rgba.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('The selected pattern is fully transparent.')
  return { width, height, rgba: new Uint8Array(rgba) }
}

export function createPixelStroke(source, color, { size = 1, shape = 'square', pattern, erase = false } = {}) {
  if (!Number.isInteger(size) || size < 1 || size > 64 || !['square', 'round', 'pattern'].includes(shape)) {
    throw new Error('Use a round or square brush with a whole-number size from 1 to 64 px.')
  }
  const bytes = copyPixelBuffer(source, color), ink = color.slice(), { width, height, rgba } = source
  // Even sizes extend one extra pixel toward positive x/y. Test pixel centers against a hard circle;
  // no antialiasing or alpha accumulation: every covered pixel receives exactly the chosen RGBA.
  const offset = Math.floor((size - 1) / 2), center = (size - 1) / 2, radiusSquared = size * size / 4
  const mask = []
  if (shape === 'pattern') {
    const sample = copyPixelPattern(pattern), ox = Math.floor((sample.width - 1) / 2), oy = Math.floor((sample.height - 1) / 2)
    for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
      const i = (y * sample.width + x) * 4
      if (sample.rgba[i + 3]) mask.push([x - ox, y - oy, erase ? [0, 0, 0, 0] : sample.rgba.slice(i, i + 4)])
    }
  } else for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (shape === 'square' || (x - center) ** 2 + (y - center) ** 2 <= radiusSquared) mask.push([x - offset, y - offset, ink])
  }
  function stamp(x, y) {
    for (const [dx, dy, paint] of mask) {
      const px = x + dx, py = y + dy
      if (px >= 0 && py >= 0 && px < width && py < height) bytes.set(paint, (py * width + px) * 4)
    }
  }
  let last = null
  const inside = p => p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height
  return {
    bytes,
    get changed() { return bytes.some((value, i) => value !== rgba[i]) },
    point(p) {
      // Leaving the image breaks the stroke; re-entry never paints an edge bridge.
      if (!inside(p)) { last = null; return }
      let x = last?.x ?? p.x, y = last?.y ?? p.y
      const dx = Math.abs(p.x - x), dy = -Math.abs(p.y - y)
      const sx = x < p.x ? 1 : -1, sy = y < p.y ? 1 : -1
      let error = dx + dy
      for (;;) {
        stamp(x, y)
        if (x === p.x && y === p.y) break
        const twice = 2 * error
        if (twice >= dy) { error += dy; x += sx }
        if (twice <= dx) { error += dx; y += sy }
      }
      last = { ...p }
    },
  }
}

export function createPixelLine(source, color, start) {
  const stroke = createPixelStroke(source, color), anchor = start && { ...start }
  const inside = p => p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < source.width && p.y < source.height
  return {
    bytes: stroke.bytes,
    get changed() { return stroke.changed },
    point(end) {
      // Reuse the candidate buffer; earlier preview endpoints never become paint.
      stroke.bytes.set(source.rgba)
      stroke.point(null)
      if (!inside(anchor) || !inside(end)) return
      stroke.point(anchor); stroke.point(end)
    },
  }
}

export function createPixelRectangle(source, color, start) {
  const stroke = createPixelStroke(source, color), anchor = start && { ...start }
  const inside = p => p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < source.width && p.y < source.height
  return {
    bytes: stroke.bytes,
    get changed() { return stroke.changed },
    point(end) {
      stroke.bytes.set(source.rgba); stroke.point(null)
      if (!inside(anchor) || !inside(end)) return
      stroke.point(anchor); stroke.point({ x: end.x, y: anchor.y })
      stroke.point(end); stroke.point({ x: anchor.x, y: end.y }); stroke.point(anchor)
    },
  }
}
