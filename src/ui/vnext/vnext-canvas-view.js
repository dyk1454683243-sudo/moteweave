import { listedDirtyPositions } from './vnext-project-client.js'

export const VNEXT_ZOOM_MIN = 0.1
export const VNEXT_ZOOM_MAX = 32
export const VNEXT_CANVAS_NAME_SCREEN = 20
// Discrete keyboard/button magnification steps along a ladder and keeps pan on whole screen pixels;
// continuous trackpad/wheel gestures scale smoothly across [VNEXT_ZOOM_MIN, VNEXT_ZOOM_MAX] with float pan anchoring.
export const VNEXT_ZOOM_STEPS = Object.freeze([0.1, 0.125, 0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32])
export const VNEXT_PIXEL_GRID_MIN_ZOOM = 4
export const VNEXT_CHECKER_SQUARES = Object.freeze([1, 2, 4, 8, 16, 32])
export const VNEXT_CHECKER_SQUARE_DEFAULT = 8
export const VNEXT_WHEEL_ZOOM_DOUBLING_PX = 100
export const VNEXT_WHEEL_ZOOM_MAX_DELTA_PX = 120
export const VNEXT_WHEEL_ZOOM_LINE_PX = 16
export const VNEXT_WHEEL_ZOOM_PAGE_PX = 100

export function normalizeWheelZoomDelta(deltaY, deltaMode = 0) {
  const raw = Number(deltaY)
  if (!Number.isFinite(raw) || raw === 0) return 0
  if (deltaMode === 1) return raw * VNEXT_WHEEL_ZOOM_LINE_PX
  if (deltaMode === 2) return raw * VNEXT_WHEEL_ZOOM_PAGE_PX
  return raw
}

export function nextZoomStep(zoom, direction) {
  const z = clampZoom(zoom)
  if (direction > 0) return VNEXT_ZOOM_STEPS.find(step => step > z + 1e-6) ?? VNEXT_ZOOM_MAX
  for (let i = VNEXT_ZOOM_STEPS.length - 1; i >= 0; i -= 1) if (VNEXT_ZOOM_STEPS[i] < z - 1e-6) return VNEXT_ZOOM_STEPS[i]
  return VNEXT_ZOOM_MIN
}

/** The largest ladder step that does not exceed the zoom, so a fitted view still has uniform pixels. */
export function snapZoomDown(zoom) {
  const z = clampZoom(zoom)
  let best = VNEXT_ZOOM_STEPS[0]
  for (const step of VNEXT_ZOOM_STEPS) if (step <= z + 1e-6) best = step
  return best
}

export function clampZoom(zoom) {
  const value = Number(zoom)
  if (!Number.isFinite(value)) return 1
  return Math.min(VNEXT_ZOOM_MAX, Math.max(VNEXT_ZOOM_MIN, value))
}

export function zoomPercentLabel(zoom) {
  return `${Math.round(clampZoom(zoom) * 100)}%`
}

export function locatorMapModel({
  canvases = [],
  panX = 0,
  panY = 0,
  zoom = 1,
  hostWidth = 1,
  hostHeight = 1,
  mapWidth = 1,
  mapHeight = 1,
  padding = 12,
} = {}) {
  const z = clampZoom(zoom)
  const viewRect = {
    x: -panX / z,
    y: -panY / z,
    w: Math.max(1, hostWidth / z),
    h: Math.max(1, hostHeight / z),
  }
  let minX = viewRect.x
  let minY = viewRect.y
  let maxX = viewRect.x + viewRect.w
  let maxY = viewRect.y + viewRect.h
  const items = []
  for (const canvas of canvases) {
    const pos = canvas.position || { x: canvas.x || 0, y: canvas.y || 0 }
    const w = Number(canvas.width) || 0
    const h = Number(canvas.height) || 0
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + w)
    maxY = Math.max(maxY, pos.y + h)
    items.push({
      id: canvas.id,
      x: pos.x,
      y: pos.y,
      w,
      h,
      previewUrl: canvas.previewUrl || '',
      selected: Boolean(canvas.selected),
    })
  }
  const worldW = Math.max(1, maxX - minX)
  const worldH = Math.max(1, maxY - minY)
  const innerW = Math.max(1, mapWidth - padding * 2)
  const innerH = Math.max(1, mapHeight - padding * 2)
  const scale = Math.min(innerW / worldW, innerH / worldH)
  const offsetX = padding + (innerW - worldW * scale) / 2
  const offsetY = padding + (innerH - worldH * scale) / 2
  function toMap(x, y, w, h) {
    return {
      x: offsetX + (x - minX) * scale,
      y: offsetY + (y - minY) * scale,
      w: Math.max(2, w * scale),
      h: Math.max(2, h * scale),
    }
  }
  return {
    scale,
    originX: minX,
    originY: minY,
    offsetX,
    offsetY,
    items: items.map((item) => ({ ...item, map: toMap(item.x, item.y, item.w, item.h) })),
    viewport: { ...viewRect, map: toMap(viewRect.x, viewRect.y, viewRect.w, viewRect.h) },
  }
}

export function locatorToWorld(model, mapX, mapY) {
  const scale = Number(model?.scale)
  if (!(scale > 0)) return { x: 0, y: 0 }
  return {
    x: model.originX + (mapX - model.offsetX) / scale,
    y: model.originY + (mapY - model.offsetY) / scale,
  }
}

export function locatorHitTest(model, mapX, mapY) {
  const items = model?.items || []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const box = items[index].map
    if (
      mapX >= box.x
      && mapY >= box.y
      && mapX <= box.x + box.w
      && mapY <= box.y + box.h
    ) {
      return items[index].id
    }
  }
  return null
}

function normalizeCanvas(item, { transient = false } = {}) {
  return {
    id: item.id,
    document_id: item.document_id,
    x: item.x,
    y: item.y,
    width: item.width || item.w || 0,
    height: item.height || item.h || 0,
    preview: item.preview || null,
    previewUrl: item.previewUrl || '',
    name: item.display_name || item.name || item.id,
    display_name: item.display_name || '',
    manifest_name: item.manifest_name || '',
    transient: Boolean(transient || item.transient),
  }
}

export function createVnextCanvasView(initial = {}) {
  const view = {
    panX: Number(initial.panX) || 0,
    panY: Number(initial.panY) || 0,
    zoom: clampZoom(initial.zoom ?? 1),
    selectedId: initial.selectedId ?? null,
    tool: initial.tool === 'move' ? 'move' : 'select',
    spaceDown: false,
    projectCanvases: [],
    transients: [],
    drafts: {},
  }

  function allCanvases() {
    return view.projectCanvases.concat(view.transients)
  }

  function canvasById(id) {
    return allCanvases().find((item) => item.id === id) || null
  }

  function cleanFloat(value) {
    if (!Number.isFinite(value) || Math.abs(value) <= 1e-12) return 0
    return Object.is(value, -0) ? 0 : value
  }

  function resetWheelZoom() {}

  function applyZoomTo(level, screenX, screenY, host = { left: 0, top: 0 }, { roundPan = true } = {}) {
    const before = {
      x: (screenX - host.left - view.panX) / view.zoom,
      y: (screenY - host.top - view.panY) / view.zoom,
    }
    view.zoom = clampZoom(level)
    const nextPanX = (screenX - host.left) - before.x * view.zoom
    const nextPanY = (screenY - host.top) - before.y * view.zoom
    view.panX = roundPan ? Math.round(nextPanX) : cleanFloat(nextPanX)
    view.panY = roundPan ? Math.round(nextPanY) : cleanFloat(nextPanY)
    return view.zoom
  }

  return {
    get panX() { return view.panX },
    get panY() { return view.panY },
    get zoom() { return view.zoom },
    get selectedId() { return view.selectedId },
    get tool() { return view.tool },
    get spaceDown() { return view.spaceDown },
    get canvases() { return allCanvases() },
    get drafts() { return view.drafts },
    get wheelRemainder() { return 0 },
    resetWheelZoom,
    setTool(tool) {
      view.tool = ['move', 'marquee', 'pencil', 'eraser', 'fill', 'line', 'rectangle', 'text', 'eyedropper'].includes(tool) ? tool : 'select'
    },
    setSpaceDown(value) {
      view.spaceDown = Boolean(value)
    },
    resetView() {
      view.panX = 0
      view.panY = 0
      view.zoom = 1
      view.selectedId = null
      resetWheelZoom()
    },
    setCanvases(canvases, { keepDrafts = false } = {}) {
      const transientIds = new Set(view.transients.map((item) => item.id))
      view.projectCanvases = (canvases || []).map((item) => normalizeCanvas(item))
      if (!keepDrafts) {
        const next = {}
        for (const [id, draft] of Object.entries(view.drafts)) {
          if (transientIds.has(id)) next[id] = draft
        }
        view.drafts = next
      }
      if (view.selectedId && !canvasById(view.selectedId)) view.selectedId = null
    },
    setTransients(items) {
      const previous = new Map(view.transients.map((item) => [item.id, item]))
      view.transients = (items || []).filter(Boolean).map((item) => {
        const current = previous.get(item.id)
        const draft = view.drafts[item.id]
        return normalizeCanvas({
          ...item,
          x: draft?.x ?? current?.x ?? item.x ?? 0,
          y: draft?.y ?? current?.y ?? item.y ?? 0,
          width: item.width || current?.width || 0,
          height: item.height || current?.height || 0,
        }, { transient: true })
      })
      const keep = new Set(allCanvases().map((item) => item.id))
      for (const id of Object.keys(view.drafts)) {
        if (!keep.has(id)) delete view.drafts[id]
      }
      if (view.selectedId && !canvasById(view.selectedId)) view.selectedId = null
    },
    applySavedPositions(positions) {
      const sent = Array.isArray(positions) ? positions : []
      const map = new Map(sent.map((item) => [item.canvas_id, item]))
      view.projectCanvases = view.projectCanvases.map((canvas) => {
        const next = map.get(canvas.id)
        if (!next) return canvas
        return { ...canvas, x: next.x, y: next.y }
      })
      for (const item of sent) {
        const draft = view.drafts[item.canvas_id]
        if (!draft) continue
        if (draft.x === item.x && draft.y === item.y) delete view.drafts[item.canvas_id]
      }
    },
    select(id) {
      view.selectedId = id && canvasById(id) ? id : null
      return view.selectedId
    },
    positionOf(id) {
      const canvas = canvasById(id)
      if (!canvas) return null
      const draft = view.drafts[id]
      return draft ? { x: draft.x, y: draft.y } : { x: canvas.x, y: canvas.y }
    },
    moveDraft(id, x, y) {
      if (!canvasById(id)) return false
      view.drafts[id] = { x: Math.trunc(x), y: Math.trunc(y) }
      return true
    },
    isDirty() {
      return listedDirtyPositions(view.projectCanvases, view.drafts).length > 0
    },
    listedDirtyPositions() {
      return listedDirtyPositions(view.projectCanvases, view.drafts)
    },
    centerWorld(worldX, worldY, hostWidth, hostHeight) {
      view.panX = Math.round(hostWidth / 2 - worldX * view.zoom)
      view.panY = Math.round(hostHeight / 2 - worldY * view.zoom)
    },
    centerOn(id, hostWidth, hostHeight) {
      const canvas = canvasById(id)
      if (!canvas) return false
      const pos = this.positionOf(id)
      this.centerWorld(pos.x + canvas.width / 2, pos.y + canvas.height / 2, hostWidth, hostHeight)
      return true
    },
    discardDrafts() {
      view.drafts = {}
    },
    panBy(dx, dy) {
      view.panX = Math.round(view.panX + dx)
      view.panY = Math.round(view.panY + dy)
    },
    screenToWorld(screenX, screenY, host = { left: 0, top: 0 }) {
      const x = (screenX - host.left - view.panX) / view.zoom
      const y = (screenY - host.top - view.panY) / view.zoom
      return { x, y }
    },
    worldToScreen(worldX, worldY, host = { left: 0, top: 0 }) {
      return {
        x: worldX * view.zoom + view.panX + host.left,
        y: worldY * view.zoom + view.panY + host.top,
      }
    },
    // factor > 1 steps up the ladder, < 1 steps down; the world point under the pointer stays put.
    zoomAt(screenX, screenY, factor, host = { left: 0, top: 0 }) {
      resetWheelZoom()
      return applyZoomTo(nextZoomStep(view.zoom, factor > 1 ? 1 : -1), screenX, screenY, host)
    },
    zoomTo(level, screenX, screenY, host = { left: 0, top: 0 }) {
      resetWheelZoom()
      return applyZoomTo(level, screenX, screenY, host)
    },
    // Continuous exponential wheel/pinch zoom: equivalent inputs at the same anchor that stay within
    // [-VNEXT_WHEEL_ZOOM_MAX_DELTA_PX, VNEXT_WHEEL_ZOOM_MAX_DELTA_PX] per event and [VNEXT_ZOOM_MIN, VNEXT_ZOOM_MAX]
    // bounds are split-invariant up to floating-point precision.
    wheelZoom(event = {}, host = { left: 0, top: 0 }) {
      const deltaPx = normalizeWheelZoomDelta(event.deltaY, event.deltaMode)
      if (deltaPx === 0) return false
      const clampedDelta = Math.max(-VNEXT_WHEEL_ZOOM_MAX_DELTA_PX, Math.min(VNEXT_WHEEL_ZOOM_MAX_DELTA_PX, deltaPx))
      const zoomIn = clampedDelta < 0
      if ((zoomIn && view.zoom >= VNEXT_ZOOM_MAX) || (!zoomIn && view.zoom <= VNEXT_ZOOM_MIN)) {
        return false
      }
      const target = clampZoom(view.zoom * Math.pow(2, -clampedDelta / VNEXT_WHEEL_ZOOM_DOUBLING_PX))
      if (Math.abs(target - view.zoom) <= 1e-9) {
        return false
      }
      const screenX = Number(event.clientX) || 0
      const screenY = Number(event.clientY) || 0
      applyZoomTo(target, screenX, screenY, host, { roundPan: false })
      return true
    },
    fitAll(hostWidth, hostHeight, padding = 32) {
      resetWheelZoom()
      const canvases = allCanvases()
      if (!canvases.length) {
        view.zoom = 1
        view.panX = 0
        view.panY = 0
        return view.zoom
      }
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const canvas of canvases) {
        const pos = this.positionOf(canvas.id)
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + canvas.width)
        maxY = Math.max(maxY, pos.y + canvas.height)
      }
      const width = Math.max(1, maxX - minX)
      const height = Math.max(1, maxY - minY)
      const raw = clampZoom(Math.min(
        (hostWidth - padding * 2) / width,
        (hostHeight - padding * 2 - VNEXT_CANVAS_NAME_SCREEN) / height,
      ))
      const zoom = raw >= 1 ? snapZoomDown(raw) : raw
      view.zoom = zoom
      view.panX = Math.round((hostWidth - width * zoom) / 2 - minX * zoom)
      view.panY = Math.round((hostHeight - height * zoom + VNEXT_CANVAS_NAME_SCREEN) / 2 - minY * zoom)
      return view.zoom
    },
    hitTest(screenX, screenY, host = { left: 0, top: 0 }) {
      const world = this.screenToWorld(screenX, screenY, host)
      const canvases = allCanvases()
      for (let index = canvases.length - 1; index >= 0; index -= 1) {
        const canvas = canvases[index]
        const pos = this.positionOf(canvas.id)
        if (
          world.x >= pos.x
          && world.y >= pos.y
          && world.x <= pos.x + canvas.width
          && world.y <= pos.y + canvas.height
        ) {
          return canvas.id
        }
      }
      return null
    },
  }
}
