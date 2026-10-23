// Display-only brush footprint. Keep this mask equivalent to createPixelStroke;
// kernel-comparison tests guard odd/even anchors, hard circles and pattern holes.
export function brushCursorMask({ size = 1, shape = 'square', pattern } = {}) {
  const width = shape === 'pattern' ? pattern?.width : size
  const height = shape === 'pattern' ? pattern?.height : size
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 64)
    || !['square', 'round', 'pattern'].includes(shape)
    || (shape === 'pattern' && pattern?.rgba?.length !== width * height * 4)) return []
  const ox = Math.floor((width - 1) / 2), oy = Math.floor((height - 1) / 2), pixels = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (shape === 'pattern' ? pattern.rgba[(y * width + x) * 4 + 3] > 0
      : shape === 'square' || (x - (size - 1) / 2) ** 2 + (y - (size - 1) / 2) ** 2 <= size * size / 4) pixels.push([x - ox, y - oy])
  }
  return pixels
}

export function brushCursorPixels(mask, point, width, height, rect) {
  if (!point || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return []
  return mask.map(([dx, dy]) => [point.x + dx, point.y + dy]).filter(([x, y]) =>
    x >= 0 && y >= 0 && x < width && y < height
    && (!rect || (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h)))
}

// Only exposed pixel edges, including holes. No fill obscures the artwork.
export function brushCursorPath(pixels) {
  const occupied = new Set(pixels.map(([x, y]) => `${x},${y}`)), edges = []
  for (const [x, y] of pixels) {
    if (!occupied.has(`${x},${y - 1}`)) edges.push(`M${x} ${y}h1`)
    if (!occupied.has(`${x + 1},${y}`)) edges.push(`M${x + 1} ${y}v1`)
    if (!occupied.has(`${x},${y + 1}`)) edges.push(`M${x} ${y + 1}h1`)
    if (!occupied.has(`${x - 1},${y}`)) edges.push(`M${x} ${y}v1`)
  }
  return edges.join('')
}

export function bindBrushCursor({ root, stage, view, getState, canEdit, selectionOn }) {
  let pointer = null, pressed = false, svg = null, paths = [], cachedBrush, mask = [], key = ''
  const hide = () => { if (svg) svg.style.display = 'none'; stage?.classList.remove('has-brush-cursor') }
  const forget = () => { pointer = null; pressed = false; hide() }
  function refresh() {
    const state = getState()
    if (!pointer || pressed || state.busy || view.spaceDown || !['pencil', 'eraser'].includes(view.tool)) { hide(); return }
    const host = stage.getBoundingClientRect()
    // Read fresh hit geometry too: panels or dialogs may have appeared over a stationary pointer.
    const target = root.elementFromPoint?.(pointer.x, pointer.y) || pointer.target
    if (!(target === stage || target?.closest?.('.vnext-canvas-tile')) || !stage.contains(target)) { hide(); return }
    const id = view.hitTest(pointer.x, pointer.y, host), canvas = view.canvases.find(c => c.id === id && !c.transient)
    if (!canvas || !canEdit(id)) { hide(); return }
    const origin = view.positionOf(id), world = view.screenToWorld(pointer.x, pointer.y, host)
    const point = { x: Math.floor(world.x - origin.x), y: Math.floor(world.y - origin.y) }
    if (cachedBrush !== state.brush) { cachedBrush = state.brush; mask = brushCursorMask(state.brush); key = '' }
    const rect = selectionOn(id)?.rect
    const nextKey = [id, point.x, point.y, canvas.width, canvas.height, rect?.x, rect?.y, rect?.w, rect?.h].join(':')
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.classList.add('vnext-brush-cursor'); svg.setAttribute('aria-hidden', 'true')
      for (const [stroke, width] of [['#161616', 3], ['#ffffff', 1]]) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('fill', 'none'); path.setAttribute('stroke', stroke); path.setAttribute('stroke-width', String(width))
        path.setAttribute('vector-effect', 'non-scaling-stroke'); path.setAttribute('stroke-linecap', 'square')
        svg.append(path); paths.push(path)
      }
      stage.append(svg)
    }
    if (nextKey !== key) {
      const d = brushCursorPath(brushCursorPixels(mask, point, canvas.width, canvas.height, rect))
      for (const path of paths) path.setAttribute('d', d)
      key = nextKey
    }
    if (!paths[0].getAttribute('d')) { hide(); return }
    const at = view.worldToScreen(origin.x, origin.y, host)
    for (const path of paths) path.setAttribute('transform', `translate(${at.x - host.left} ${at.y - host.top}) scale(${view.zoom})`)
    svg.style.display = ''; stage.classList.add('has-brush-cursor')
  }
  stage?.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') { forget(); return }
    pointer = { x: event.clientX, y: event.clientY, target: event.target }; refresh()
  }, true)
  stage?.addEventListener('pointerdown', () => { pressed = true; hide() }, true)
  stage?.addEventListener('pointerup', () => { pressed = false; refresh() }, true)
  stage?.addEventListener('pointerleave', forget)
  stage?.addEventListener('pointercancel', forget)
  root.addEventListener('pointerover', event => { if (!stage?.contains(event.target)) forget() }, true)
  root.addEventListener('visibilitychange', () => { if (root.hidden) forget() })
  window.addEventListener('blur', forget)
  return { refresh }
}
