import { createTextFontLibrary, TEXT_FONT_DEFAULTS } from './vnext-text-fonts.js'
import { isEditablePixelDocument } from '../../editor-project/pixelDocumentOrigin.js'
import { bindPaintControls } from './vnext-paint-controls.js'
import { bindPaletteControls, sameColor } from './vnext-palette.js'
import { TEXT_DRAFT_DEFAULTS, clampTextAnchor, cloneTextSnapshot, createTextDraftHistory, pointInTextBounds } from './vnext-text-draft.js'
import { compositeTextObjects, recompositeFrame, textObjectAt, textObjectBounds, textObjectCommand, textObjectProps, textObjectsForFrame } from './vnext-text-objects.js'
import { createFrameCoalescer } from './vnext-project-client.js'
import { bindBrushCursor } from './vnext-brush-cursor.js'

import { createPixelText, createPixelFill, createPixelStroke, createPixelLine, createPixelRectangle, copyPixelPattern } from '../../editor-project/pixelDrawingTools.js'
import { clampPixelBlockPosition, clampPixelMove, deletePixelRect, extractPixelBlock, flipPixelRect, movePixelRect, pastePixelBlock, pixelPointInRect } from '../../editor-project/pixelSelectionOps.js'
export { createPixelText, createPixelFill, createPixelStroke, createPixelLine, createPixelRectangle }


export function pixelWriteReceipt(result, request, projectId, documentId) {
  const r = result?.receipt, doc = result?.document
  if (!r || r.operation_id !== request.operationId || r.project_id !== projectId
    || r.document_id !== documentId || r.project_revision !== request.expectedRevision + 1
    || result.project?.id !== projectId || result.project.revision < r.project_revision
    || doc?.document_id !== documentId || doc.revision !== r.document_revision
    || !Number.isSafeInteger(doc.revision) || doc.revision <= request.expectedWorkingRevision) {
    throw Object.assign(new Error('The saved pixel revision was not confirmed.'), { kind: 'unknown' })
  }
  return doc.revision
}

const TOOL_IDS = { marquee: 'TOOL-02', pencil: 'TOOL-03', eraser: 'TOOL-04', fill: 'TOOL-05', line: 'TOOL-06', rectangle: 'TOOL-07', text: 'TOOL-08', eyedropper: 'COLOR-06' }
const isPixelTool = tool => Object.hasOwn(TOOL_IDS, tool)
// Single-key tool shortcuts (letters only, no modifier) from the page, the canvas area or the tool rail.
export const TOOL_KEYS = Object.freeze({ move: 'V', marquee: 'M', pencil: 'B', eraser: 'E', fill: 'G', line: 'L', rectangle: 'R', text: 'T', eyedropper: 'I' })
const TOOL_BY_KEY = Object.fromEntries(Object.entries(TOOL_KEYS).map(([tool, key]) => [key.toLowerCase(), tool]))
const isShapeTool = tool => tool === 'line' || tool === 'rectangle'

export function bindManualPixelTools({ root, session, canEdit, select, render, status, tooltips = { set() {} } }) {
  const stage = root.querySelector('#vnext-canvas-stage'), view = session.view
  const controls = Object.entries(TOOL_IDS).map(([tool, id]) => [tool, root.querySelector(`[data-capability="${id}"]`)])
  const colors = () => root.querySelectorAll?.('[data-paint-color]') || []
  let color = [77, 115, 102, 255], gesture = null, brush = { size: 1, shape: 'square' }, paintPanel, palettePanel
  let workingColors = [color.slice(), [255, 255, 255, 255]], activeColor = 0
  // Page-memory clipboard: exact RGBA of one cel rectangle; not the system clipboard.
  // hold keeps a stroke or applied move/paste on screen while its save is in flight.
  let clipboard = null, bar = null, hold = null
  const fonts = createTextFontLibrary()
  const inPanel = event => event.target.closest?.('.vnext-pixel-selection-bar')
  const sameRect = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  // ignore: an open text draft is a gesture, but color, palette selection and the tool rail stay usable
  // while it is open (they change or place the draft); every other edit or write still waits.
  function busy(ignore = null) { return Boolean(pendingTextMove || session.frameLoading || (session.manualGesture && session.manualGesture !== ignore) || session.manualWrite || session.pixelCopyPending
    || session.pendingImport || session.pendingSave || session.historyBusy || session.pendingHistory.get(session.project?.id) || session.nameEdit
    || session.openInFlight?.()) } // another project is loading: the current canvas is read-only until it finishes
  const textDraft = () => (gesture?.tool === 'text' ? gesture : null)
  const textDraftOpen = () => Boolean(textDraft() && !textDraft().submitting)
  const busyExceptDraft = () => busy(textDraftOpen() ? textDraft() : null)
  const busyMessage = fallback => (session.openInFlight?.() ? 'Wait for the project to finish opening.' : fallback)
  function paintColor(next) {
    color = next.slice()
    workingColors[activeColor] = color.slice()
    const hex = color.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
    paintPanel?.setColor(color)
    colors().forEach(node => {
      const selected = node.dataset.paintColor.toUpperCase() === `#${hex}` && Number(node.dataset.paintAlpha ?? 255) === color[3]
      node.classList.toggle('is-selected', selected)
      node.setAttribute('aria-pressed', String(selected))
      node.setAttribute('aria-label', `Paint color ${node.dataset.paintColor.toUpperCase()}${selected ? ' · selected' : ''}`)
      node.querySelectorAll('.vnext-swatch-ring').forEach(ring => { ring.style.display = selected ? '' : 'none' })
    })
    ;(root.querySelectorAll?.('[data-working-color]') || []).forEach((quick, index) => {
      const c = workingColors[index], value = c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), selected = index === activeColor
      quick.style.setProperty('--swatch', `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`)
      quick.dataset.paintColor = `#${value.slice(0, 6)}`; quick.dataset.paintAlpha = String(c[3])
      quick.title = `Working color ${index + 1} · #${value} · X swaps colors`
      quick.setAttribute('aria-label', `Working color ${index + 1} · #${value}`)
      quick.setAttribute('aria-pressed', String(selected)); quick.classList.toggle('is-selected', selected)
      quick.querySelectorAll('.vnext-swatch-ring').forEach(ring => { ring.style.display = selected ? '' : 'none' })
    })
    palettePanel?.refresh()
    // The live text draft uses the paint color: a color change shows on the canvas at once (one undo step per drag).
    const draft = textDraft()
    if (draft && draft.props && !draft.submitting && !suppressTextColor && !sameColor(draft.props.color, color)) {
      draft.props = { ...draft.props, color: color.slice() }; recordTextDraft(draft, 'color', 700); renderTextDraft(draft)
    }
  }
  function refresh() {
    if (pendingTextMove && (!textMoveCurrent(pendingTextMove) || (pendingTextMove.recovering && !session.manualWrite))) clearTextMove()
    // The refresh recovery finished, or the session moved on (project/open context changed): stop holding.
    if (hold?.untilWriteClears && (!session.manualWrite || !hold.isCurrent?.())) dropHold(hold)
    const stableStroke = stableTextPanel?.stroke
    if (stableStroke && (stableStroke.cancelled || (stableStroke.source && !stableStroke.source.isCurrent())
      || (!gesture && !hold && !session.manualWrite && !session.pixelCopyPending && !session.pendingImport))) clearStablePanel()
    // Tools can be chosen before a canvas is selected (the first click selects and uses the tool);
    // they are disabled only when the selected canvas cannot be edited.
    const supported = canEdit() || !view.selectedId, locked = busy(), opening = Boolean(session.openInFlight?.())
    const draftOpen = textDraftOpen(), openDraft = draftOpen ? textDraft() : null
    // Selecting the draft's image again (or another one) changes whether it can be placed: redraw it.
    if (openDraft?.source && openDraft.shownSelected !== openDraft.source.isSelected()) renderTextDraft(openDraft)
    for (const [tool, node] of controls) {
      if (!node) continue
      node.disabled = !supported || (locked && !draftOpen) // switching tools places an open text draft
      node.dataset.capabilityStatus = 'implemented'
      node.setAttribute('aria-pressed', String(view.tool === tool))
      node.classList.toggle('is-selected', view.tool === tool)
      // What each tool does and its shortcuts live in the rail tip; the panel shows only the tool's name and options.
      const tip = opening ? 'Wait for the project to finish opening'
        : session.frameLoading ? 'Wait for the frame to load'
        : !supported ? 'Select an unlocked raster layer and frame'
        : locked && !draftOpen ? 'Wait for the current change to finish'
        : tool === 'marquee' ? 'Select pixels · drag to select, drag inside to move · ⌘/Ctrl+C copy · ⌘/Ctrl+V paste · Delete clears · Shift+H/V flip · Esc clears the selection'
        : tool === 'eyedropper' ? 'Eyedropper · click a pixel to make its color the paint color'
          : tool === 'fill' ? 'Fill · click to replace connected pixels of the exact same color · original preserved on first edit'
          : tool === 'line' ? 'Line · drag between two points · 1 px · original preserved on first edit'
          : tool === 'rectangle' ? 'Rectangle · drag between opposite corners · 1 px outline'
          : tool === 'text' ? 'Text · click the canvas to type · double-click a text object to edit · drag a selected object to move'
          : `${tool === 'pencil' ? 'Pencil' : 'Eraser'} · ${brush.shape === 'pattern' ? `${brush.pattern.width} × ${brush.pattern.height} px pattern` : `${brush.size} px ${brush.shape}`} · original preserved on first stroke`
      const ready = supported && !opening && !session.frameLoading && !(locked && !draftOpen)
      tooltips.set(node, ready ? `${tip} · ${TOOL_KEYS[tool]}` : tip)
      node.setAttribute('aria-keyshortcuts', TOOL_KEYS[tool])
    }
    colors().forEach(node => { node.disabled = busyExceptDraft() })
    palettePanel?.refresh()
    paintPanel?.refresh()
    stage?.classList.toggle('is-pixel-tool', isPixelTool(view.tool))
    renderSelection()
    renderToolOptions(); renderTarget(); renderTextPanel(); renderTextOutline()
    // Native range thumbs ignore CSS opacity/color when :disabled. Inert keeps
    // these frozen controls non-interactive without repainting their native skin.
    for (const state of stableTextPanel?.ranges || []) state.node.disabled = state.disabled
    brushCursor.refresh()
  }
  function selectionOn(canvasId) {
    const selected = session.pixelSelection
    return selected && selected.projectId === session.project?.id && selected.canvasId === canvasId ? selected : null
  }
  function renderSelection() {
    stage?.querySelector('.vnext-pixel-selection')?.remove()
    // A move or paste in progress (or still saving) shows where the pixels land, not the saved selection.
    const floating = gesture?.floatRect ? { canvasId: gesture.canvasId, rect: gesture.floatRect }
      : hold?.rect ? { canvasId: hold.canvasId, rect: hold.rect } : null
    const selected = floating || selectionOn(view.selectedId)
    // A floating paste stays visible (with its Cancel/Apply bar) even if another canvas gets selected.
    if (selected && (floating || selected.canvasId === view.selectedId)) {
      const origin = view.positionOf(selected.canvasId), rect = selected.rect, overlay = document.createElement('div')
      overlay.className = floating ? 'vnext-pixel-selection is-floating' : 'vnext-pixel-selection'
      const verb = gesture?.tool === 'paste' ? 'Pasting' : gesture?.floatRect ? 'Moving' : floating ? 'Saving' : 'Selected'
      overlay.setAttribute('aria-label', `${verb} pixels ${rect.x},${rect.y}, ${rect.w} by ${rect.h}`)
      // Placed in stage (screen) pixels so the outline stays 1px and never hides edge pixels when zoomed in.
      const host = stage.getBoundingClientRect?.() || { left: 0, top: 0 }
      const a = view.worldToScreen(origin.x + rect.x, origin.y + rect.y, host), b = view.worldToScreen(origin.x + rect.x + rect.w, origin.y + rect.y + rect.h, host)
      Object.assign(overlay.style, { left: `${a.x - host.left}px`, top: `${a.y - host.top}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` })
      stage.append(overlay)
    }
    renderBar(floating || (selected?.canvasId === view.selectedId ? selected : null))
  }
  function pasteFits() {
    const canvas = view.canvases.find(c => c.id === view.selectedId && !c.transient)
    return Boolean(clipboard && canvas && clipboard.width <= canvas.width && clipboard.height <= canvas.height)
  }
  function createBar(mode) {
    const node = document.createElement('div')
    node.className = 'vnext-pixel-selection-bar'; node.dataset.mode = mode
    node.setAttribute('role', mode === 'paste' ? 'group' : 'toolbar')
    node.setAttribute('aria-label', mode === 'paste' ? 'Pasted pixels' : 'Selection actions')
    const add = (action, text, title, keys, primary = false) => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = `vnext-dialog-btn ${primary ? 'is-primary' : 'is-secondary'}`
      button.dataset.selectionAction = action; button.textContent = text; button.title = title
      button.setAttribute('aria-keyshortcuts', keys)
      button.addEventListener('click', () => runBarAction(action))
      node.append(button)
    }
    if (mode === 'paste') {
      const label = document.createElement('span')
      label.className = 'vnext-pixel-selection-label'; label.dataset.selectionLabel = 'paste'; label.setAttribute('role', 'status')
      node.append(label)
      add('cancel-paste', 'Cancel', 'Discard the pasted pixels · Escape', 'Escape')
      add('apply-paste', 'Apply paste', 'Save the pasted pixels · Enter', 'Enter', true)
    } else {
      add('copy', 'Copy', 'Copy selected pixels · ⌘/Ctrl+C', 'Meta+C Control+C')
      add('paste', 'Paste', 'Paste copied pixels · ⌘/Ctrl+V', 'Meta+V Control+V')
      add('delete', 'Delete', 'Clear selected pixels to transparent · Delete', 'Delete Backspace')
      add('flip-h', 'Flip H', 'Flip selected pixels horizontally · Shift+H', 'Shift+H')
      add('flip-v', 'Flip V', 'Flip selected pixels vertically · Shift+V', 'Shift+V')
      add('crop', 'Crop', 'Crop canvas to this selection across all frames and layers', '')
    }
    // Keys still reach the document so ⌘Z works after a click; pointer input stays off the canvas.
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) node.addEventListener(type, event => event.stopPropagation())
    return node
  }
  function renderBar(selected) {
    const g = gesture
    // Copy/Delete/Flip keep the (disabled) bar in place while pixels load, so it does not flicker.
    const steady = !g || ['copy', 'delete', 'flip-h', 'flip-v'].includes(g.tool)
    const mode = g?.tool === 'paste' ? 'paste' : steady && selected && view.tool === 'marquee' ? 'selection' : null
    if (!stage || !mode || !selected) { bar?.remove(); bar = null; return }
    if (bar?.dataset.mode !== mode) { bar?.remove(); bar = createBar(mode) }
    if (!bar.parentNode) stage.append(bar)
    if (mode === 'paste') {
      // Cancel stays available until the write starts (the bar is removed at that point).
      bar.querySelector('[data-selection-action="apply-paste"]').disabled = Boolean(g.submitting || g.error || !g.source || g.drag)
      const label = bar.querySelector('[data-selection-label="paste"]')
      const text = g.error ? (g.error.message || 'Pixels could not be loaded.') : !g.source ? 'Loading pixels…'
        : `${g.block.width} × ${g.block.height} px · drag to place`
      if (label.textContent !== text) label.textContent = text // avoid re-announcing the status on every drag step
      label.classList.toggle('is-error', Boolean(g.error))
    } else {
      const locked = busy(), editable = canEdit()
      for (const button of bar.querySelectorAll('[data-selection-action]')) {
        button.disabled = locked || !editable || (button.dataset.selectionAction === 'paste' && !pasteFits())
      }
    }
    const host = stage.getBoundingClientRect?.(), origin = view.positionOf(selected.canvasId), r = selected.rect
    const canvas = view.canvases.find(c => c.id === selected.canvasId)
    if (!host || !origin || !canvas) return
    const toStage = (x, y) => { const p = view.worldToScreen(x, y, host); return { x: p.x - host.left, y: p.y - host.top } }
    const a = toStage(origin.x + r.x, origin.y + r.y), b = toStage(origin.x + r.x + r.w, origin.y + r.y + r.h)
    const imageA = toStage(origin.x, origin.y), imageB = toStage(origin.x + canvas.width, origin.y + canvas.height)
    const box = bar.getBoundingClientRect?.() || { width: 0, height: 0 }
    // Floating canvas controls (workspace mode, tool rail, Preview panel) stay uncovered when possible.
    const avoid = ['.vnext-mode', '.vnext-tools', '.vnext-preview'].map(selector => root.querySelector?.(selector)?.getBoundingClientRect?.())
      .filter(r => r && r.width && r.height).map(r => ({ left: r.left - host.left, top: r.top - host.top, right: r.right - host.left, bottom: r.bottom - host.top }))
    const at = placeSelectionBar({ host: { width: host.width, height: host.height }, bar: { width: box.width, height: box.height },
      image: { left: imageA.x, top: imageA.y, right: imageB.x, bottom: imageB.y }, selection: { left: a.x, top: a.y, right: b.x, bottom: b.y }, avoid })
    bar.style.left = `${Math.round(at.left)}px`; bar.style.top = `${Math.round(at.top)}px`
  }
  function runBarAction(action) {
    if (action === 'apply-paste') return applyPaste()
    if (action === 'cancel-paste') return cancel()
    if (action === 'paste') return startPaste()
    if (action === 'crop') return session.openCanvasSizeDialog?.({ mode: 'crop', fromSelection: true })
    return selectionAction(action)
  }
  function selectRect(g, end) {
    const x = Math.max(0, Math.min(g.source.width - 1, end.x)), y = Math.max(0, Math.min(g.source.height - 1, end.y))
    const startX = Math.max(0, Math.min(g.source.width - 1, g.start.x)), startY = Math.max(0, Math.min(g.source.height - 1, g.start.y))
    session.pixelSelection = { projectId: session.project.id, canvasId: g.canvasId,
      rect: { x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(startX - x) + 1, h: Math.abs(startY - y) + 1 } }
    renderSelection()
  }
  function constrain(g) {
    if (g.tool === 'text') return
    const rect = g.source?.allowedRect
    // Moves and pastes intentionally land outside the old selection; their write area is computed exactly.
    if (!rect || !g.stroke || g.unconstrained) return
    const bytes = g.stroke.bytes, source = g.source
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h) continue
      const offset = (y * source.width + x) * 4
      bytes.set(source.rgba.subarray(offset, offset + 4), offset)
    }
  }
  function chooseTool(tool) {
    const draft = textDraft()
    if (draft && !draft.submitting) {
      if (tool === 'text') { textUi.content?.focus(); return }
      if (!placeTextDraft(draft)) return // e.g. typing (IME) or text that does not fit: the draft stays open
      view.setTool(tool); render(); return
    }
    if (busy() || (view.selectedId && !canEdit())) return
    view.setTool(tool)
    render()
  }
  for (const [tool, node] of controls) node?.addEventListener('click', () => chooseTool(tool))
  ;(root.querySelectorAll?.('[data-working-color]') || []).forEach(node => {
    node.addEventListener('click', () => {
      if (busyExceptDraft()) return
      activeColor = Number(node.dataset.workingColor)
      paintColor(workingColors[activeColor])
    })
  })
  function point(event, g) {
    const p = view.screenToWorld(event.clientX, event.clientY, stage.getBoundingClientRect())
    return { x: Math.floor(p.x - g.origin.x), y: Math.floor(p.y - g.origin.y) }
  }
  function preview(g) {
    if (g.cancelled || !g.stroke) return
    constrain(g)
    if (!g.overlay) {
      g.overlay = document.createElement('canvas')
      g.overlay.className = g.tool === 'text' ? 'vnext-pixel-stroke-preview is-text-draft' : 'vnext-pixel-stroke-preview'
      g.overlay.width = g.source.width; g.overlay.height = g.source.height
      g.overlay.style.left = `${g.origin.x}px`; g.overlay.style.top = `${g.origin.y}px`
      stage.querySelector('.vnext-canvas-world')?.append(g.overlay)
    }
    const ctx = g.overlay.getContext('2d')
    if (!g.pixels || g.pixels.width !== g.source.width || g.pixels.height !== g.source.height) g.pixels = ctx.createImageData(g.source.width, g.source.height)
    let pixels = g.stroke.bytes
    if (g.source.previewPixels) {
      // Preview editable text in its saved object order, without baking it into raster bytes.
      const textObject = g.tool === 'text' && !g.invalid ? fontCommand(g.props, g.scope, g.objectId || null) : null
      pixels = g.source.previewPixels(textObject ? g.source.rgba : pixels, { textObject })
    }
    g.pixels.data.set(pixels)
    ctx.putImageData(g.pixels, 0, 0)
    // Cover the saved tile so transparent eraser preview does not reveal old pixels.
    const tile = stage.querySelector(`[data-canvas-id="${g.canvasId}"]`)
    if (tile) tile.style.visibility = 'hidden'
  }
  function clear(g) {
    clearTimeout(g.groupTimer)
    g.pixels = null
    g.overlay?.remove()
    g.outline?.remove()
    g.input?.remove()
    const tile = stage?.querySelector(`[data-canvas-id="${g.canvasId}"]`)
    if (tile && hold?.canvasId !== g.canvasId) tile.style.visibility = '' // a held candidate still covers this tile
    if (session.manualGesture === g) session.manualGesture = null
    if (gesture === g) gesture = null
    try { stage.releasePointerCapture(g.pointerId) } catch { /* capture may have ended */ }
    if (g.drag) try { stage.releasePointerCapture(g.drag.pointerId) } catch { /* capture may have ended */ }
    g.drag = null
    if (g.tool === 'text') renderTextPanel() // back to the text defaults for the next placement
  }
  function cancel() {
    if (objectDrag) cancelTextObjectDrag()
    if (pendingTextMove && !textMoveCurrent(pendingTextMove)) clearTextMove()
    if (hold) dropHold(hold) // e.g. project switch: stop showing a candidate whose save is no longer current
    if (!gesture) return
    const g = gesture; g.cancelled = true
    if (g.tool === 'marquee') session.pixelSelection = g.previousSelection
    clear(g); render()
  }
  // Pixel tools suppress the pointer's default focus change, so using the canvas would otherwise leave
  // keyboard focus on a previously focused panel control and route shortcuts there.
  function focusCanvas() {
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (active && !stage?.contains?.(active)) stage?.focus?.({ preventScroll: true }) // the stage is the focusable "Infinite canvas"
  }
  function selectRectOn(source, rect) {
    session.pixelSelection = { projectId: source.projectId, canvasId: source.sourceCanvasId, rect: { ...rect } }
  }
  // Copy, Delete and Flip act on the current frame's unlocked layer inside the selection.
  async function selectionAction(kind) {
    if (gesture || busy()) { status(busyMessage('Finish the current edit before changing the selection.')); return }
    const canvasId = view.selectedId, selected = selectionOn(canvasId)
    if (!selected) { status('Use Select pixels to select some pixels first.'); return }
    if (!canEdit()) { status('Select an unlocked raster layer and frame.'); return }
    if (session.conversationRef?.canvasId !== canvasId) select(canvasId)
    const preparing = session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true })
    const g = { tool: kind, canvasId, ended: true, cancelled: false, pointerId: null }
    gesture = g; session.manualGesture = g; refresh()
    try {
      const source = await preparing
      if (g.cancelled) return
      if (!sameRect(source.allowedRect, selected.rect)) throw new Error('The selection changed. Select the pixels again.')
      const rect = source.allowedRect
      if (kind === 'capture-brush') {
        if (rect.w > 64 || rect.h > 64) throw new Error('Select a pattern from 1 to 64 px on each side.')
        paintPanel.setPattern(copyPixelPattern(extractPixelBlock(source, rect)))
        view.setTool('pencil')
        focusCanvas()
        status(`Pattern ready: ${rect.w} × ${rect.h} px, original colors. Escape clears the selection to paint elsewhere.`)
        return
      }
      if (kind === 'copy') {
        clipboard = extractPixelBlock(source, rect)
        status(`Copied ${rect.w} × ${rect.h} pixels. Paste with ⌘/Ctrl+V.`)
        return
      }
      const result = kind === 'delete' ? deletePixelRect(source, rect) : flipPixelRect(source, rect, kind === 'flip-h' ? 'horizontal' : 'vertical')
      clear(g)
      if (!result.changed) {
        status(kind === 'delete' ? 'The selected pixels are already transparent.' : 'Flipping would not change these pixels.')
        return
      }
      await session.savePixelStroke(source, result.bytes, { selection: rect })
    } catch (error) {
      if (!g.cancelled) status(error.message || 'The selection change was not saved.', { error: true })
    } finally { clear(g); render() }
  }
  function startMove(g, event, canvas, selected) {
    // Called before any lock is taken: preparePixelEdit checks the same busy state synchronously.
    const preparing = session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true })
    Object.assign(g, { tool: 'move-selection', unconstrained: true, start: g.queued[0], rect: { ...selected.rect },
      size: { width: canvas.width, height: canvas.height }, offset: { x: 0, y: 0 }, floatRect: { ...selected.rect }, queued: [] })
    gesture = g; session.manualGesture = g
    try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
    g.ready = preparing.then(source => {
      if (g.cancelled) return
      if (!sameRect(source.allowedRect, g.rect)) throw new Error('The selection changed. Select the pixels again.')
      g.source = source; g.buffer = new Uint8Array(source.rgba.length); updateMove(g)
    }).catch(error => { g.error = error })
    refresh()
  }
  function dragMove(g, p) {
    g.offset = clampPixelMove(g.size, g.rect, { x: p.x - g.start.x, y: p.y - g.start.y })
    g.floatRect = { ...g.rect, x: g.rect.x + g.offset.x, y: g.rect.y + g.offset.y }
    if (g.source) updateMove(g)
    else renderSelection()
  }
  function updateMove(g) {
    if (!g.source || g.cancelled) return
    const result = movePixelRect(g.source, g.rect, g.offset, g.buffer)
    g.stroke = { bytes: result.bytes, changed: result.changed }; g.floatRect = result.rect
    preview(g); renderSelection()
  }
  async function finishMove(g, end) {
    dragMove(g, end)
    await g.ready
    if (g.cancelled) return
    try {
      if (g.error) throw g.error
      if (!g.source?.isSelected()) throw new Error('The selected image changed. The move was not saved.')
      if (!g.offset.x && !g.offset.y) return
      const result = movePixelRect(g.source, g.rect, g.offset)
      // A fully transparent block moves only the outline; there are no pixels to save.
      if (!result.changed) { clear(g); selectRectOn(g.source, result.rect); return }
      await saveHeld(g, result.bytes, { writeRect: result.writeRect, selection: result.rect })
    } catch (error) { status(error.message || 'The move was not saved.', { error: true }) }
    finally { clear(g); render() }
  }
  // Keep a stroke or applied move/paste on its working copy visible while it saves, then show only what the
  // store confirmed: success reveals the saved tile, rejection or an unconfirmed save shows the saved
  // (old) pixels again. The first edit of an original is not held, because the original never changes.
  async function saveHeld(g, bytes, options, holdRect = options.selection) {
    const inPlace = isEditablePixelDocument(session.documents?.get?.(g.source.sourceDocumentId), session.project)
    const held = inPlace && g.overlay ? { canvasId: g.canvasId, rect: holdRect ? { ...holdRect } : null, overlay: g.overlay, isCurrent: g.source.isCurrent } : null
    if (held) g.overlay = null
    clear(g) // releases the gesture lock; savePixelStroke takes the write lock synchronously
    if (held) {
      hold = held
      const tile = stage?.querySelector(`[data-canvas-id="${held.canvasId}"]`)
      if (tile) tile.style.visibility = 'hidden'
      renderSelection()
    }
    let outcome
    try { outcome = await session.savePixelStroke(g.source, bytes, options) }
    finally {
      // Confirmed but not yet redisplayed ("Pixel refresh pending"): the candidate is the saved result,
      // so keep it until the write lock clears; anything else shows the confirmed (old) pixels now.
      if (held && outcome?.saved && !outcome.settled && hold === held) held.untilWriteClears = true
      else dropHold(held)
    }
    return outcome
  }
  function dropHold(held) {
    if (!held || hold !== held) return
    hold = null
    held.overlay.remove()
    const tile = stage?.querySelector(`[data-canvas-id="${held.canvasId}"]`)
    if (tile) tile.style.visibility = ''
    renderSelection()
  }
  // Paste floats at the copied position until Apply/Enter; Cancel/Escape writes nothing.
  function startPaste() {
    if (!clipboard) { status('Copy a selection first.'); return }
    if (gesture || busy()) { status(busyMessage('Finish the current edit before pasting.')); return }
    const canvasId = view.selectedId, canvas = view.canvases.find(c => c.id === canvasId && !c.transient)
    if (!canvas || !canEdit()) { status('Select an unlocked raster layer and frame.'); return }
    let at
    try { at = clampPixelBlockPosition(canvas, clipboard, clipboard.origin) } catch (error) { status(error.message, { error: true }); return }
    if (session.conversationRef?.canvasId !== canvasId) select(canvasId)
    const preparing = session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true })
    const g = { tool: 'paste', canvasId, origin: { ...view.positionOf(canvasId) }, ended: true, cancelled: false, unconstrained: true,
      pointerId: null, block: clipboard, at, size: { width: canvas.width, height: canvas.height },
      floatRect: { x: at.x, y: at.y, w: clipboard.width, h: clipboard.height } }
    gesture = g; session.manualGesture = g
    view.setTool('marquee')
    g.ready = preparing.then(source => {
      if (g.cancelled) return
      g.source = source; g.buffer = new Uint8Array(source.rgba.length); updatePaste(g)
    }).catch(error => { g.error = error; if (!g.cancelled) render() })
    render()
  }
  function updatePaste(g) {
    if (!g.source || g.cancelled) return
    const result = pastePixelBlock(g.source, g.block, g.at, g.buffer)
    g.stroke = { bytes: result.bytes, changed: result.changed }
    preview(g); renderSelection()
  }
  function dragPaste(g, p) {
    g.at = clampPixelBlockPosition(g.size, g.block, { x: g.drag.from.x + p.x - g.drag.start.x, y: g.drag.from.y + p.y - g.drag.start.y })
    g.floatRect = { x: g.at.x, y: g.at.y, w: g.block.width, h: g.block.height }
    if (g.source) updatePaste(g)
    else renderSelection()
  }
  // A floating paste can outlive unrelated session changes (e.g. cancelling Open project advances the
  // open epoch). Reread the canonical pixels of the same canvas once and recompute, instead of discarding.
  async function refreshPasteSource(g) {
    if (session.project?.id !== g.source?.projectId || view.selectedId !== g.canvasId) return
    session.manualGesture = null // preparePixelEdit checks the gesture lock synchronously; restored before any await
    let preparing
    try { preparing = session.preparePixelEdit({ scopeGrant: false, includeTextPreview: true }) } finally { session.manualGesture = g }
    const source = await preparing
    if (g.cancelled || gesture !== g || source.sourceCanvasId !== g.canvasId || source.width !== g.source.width
      || source.height !== g.source.height) return
    g.source = source; g.buffer = new Uint8Array(source.rgba.length); updatePaste(g)
  }
  async function applyPaste() {
    const g = gesture
    if (g?.tool !== 'paste' || g.submitting || g.drag) return
    g.submitting = true; renderSelection()
    await g.ready
    if (g.cancelled || gesture !== g) return
    try {
      if (g.error) throw g.error
      // Apply targets the canvas the paste floats on, even if the locator selected another one.
      if (view.selectedId !== g.canvasId || session.conversationRef?.canvasId !== g.canvasId) select(g.canvasId)
      if (!g.source?.isSelected()) await refreshPasteSource(g)
      if (g.cancelled || gesture !== g) return // cancelled while the pixels were reread
      if (!g.source?.isSelected()) throw new Error('The selected image changed. The paste was not saved.')
      const result = pastePixelBlock(g.source, g.block, g.at)
      if (!result.changed) { clear(g); selectRectOn(g.source, result.rect); return }
      await saveHeld(g, result.bytes, { writeRect: result.writeRect, selection: result.rect })
    } catch (error) { if (!g.cancelled) status(error.message || 'The paste was not saved.', { error: true }) }
    finally { if (!g.cancelled) clear(g); render() } // cancel() already cleared it; a newer gesture may own the tile
  }
  // ---- Text: options live in the right properties panel; the canvas shows a live, unsaved draft. ----
  // Every change re-renders the draft from the saved baseline (never from a previous preview). Placing it
  // (Done, Esc, another tool, or a click elsewhere) is one saved pixel edit and one Undo step; placed text
  // is pixels, not an editable text object.
  const TOOL_TITLES = { move: 'Move', select: 'Select', marquee: 'Select pixels', pencil: 'Pencil', eraser: 'Eraser',
    fill: 'Fill', line: 'Line', rectangle: 'Rectangle', text: 'Text', eyedropper: 'Eyedropper' }
  const textUi = (() => {
    const q = id => root.querySelector?.(`#${id}`) || null, all = selector => [...(root.querySelectorAll?.(selector) || [])]
    return { section: q('vnext-text-props'), content: q('vnext-text-content'), font: q('vnext-text-font'), fontNote: q('vnext-text-font-note'),
      fontFile: q('vnext-text-font-file'), system: root.querySelector?.('[data-text-font="system"]') || null, importFont: root.querySelector?.('[data-text-font="import"]') || null,
      size: q('vnext-text-size'), sizeRange: q('vnext-text-size-range'), stroke: q('vnext-text-stroke'), strokeRange: q('vnext-text-stroke-range'),
      x: q('vnext-text-x'), y: q('vnext-text-y'), help: q('vnext-text-help'), error: q('vnext-text-error'),
      done: root.querySelector?.('[data-text-action="done"]') || null, discard: root.querySelector?.('[data-text-action="discard"]') || null,
      retry: root.querySelector?.('[data-text-action="retry-pixels"]') || null,
      styles: all('[data-text-style]'), modes: all('[data-text-mode]') }
  })()
  // Preferences for the next text (not the text itself, its position or color, which belong to a draft).
  let textOptions = { ...TEXT_DRAFT_DEFAULTS }, fontChoices = [...TEXT_FONT_DEFAULTS, ...fonts.imported]
  let fontEpoch = 0, fontBusy = false, fontError = '', fontListLimited = false, fieldError = '', suppressTextColor = false
  let selectedText = null, objectDrag = null, pendingTextMove = null, stableTextPanel = null
  function textMoveCurrent(move) {
    const scope = currentTextTarget().scope
    return session.loadGeneration === move.generation && scope?.projectId === move.projectId
      && scope.canvasId === move.canvasId && selectedText?.item.id === move.id && !selectedText.stale
  }
  function keepTextPanelStable(stroke = null) {
    if (stableTextPanel) return
    const panel = root.querySelector?.('.vnext-color')
    if (!panel) return
    const nodes = [...panel.querySelectorAll('input, select, button, textarea, .vnext-icon, .vnext-sv')]
    for (const node of nodes) {
      node.style.setProperty('--vnext-save-opacity', globalThis.getComputedStyle?.(node).opacity || '1')
      node.style.setProperty('--vnext-save-color', globalThis.getComputedStyle?.(node).color || 'inherit')
      node.setAttribute('data-text-move-stable', '')
    }
    panel.setAttribute('aria-busy', 'true')
    const ranges = nodes.filter(node => stroke ? 'disabled' in node : node.type === 'range').map(node => ({ node, disabled: node.disabled, inert: node.inert }))
    for (const state of ranges) state.node.inert = true
    stableTextPanel = { panel, nodes, ranges, stroke, inert: panel.inert }
    if (stroke) panel.inert = true // Keep native control skins, but lock the entire sidebar.
  }
  function clearTextMove() {
    if (pendingTextMove?.selection === selectedText) selectedText.preview = null
    pendingTextMove = null
    clearStablePanel()
  }
  function clearStablePanel() {
    if (!stableTextPanel) return
    for (const node of stableTextPanel.nodes) {
      node.removeAttribute('data-text-move-stable')
      node.style.removeProperty('--vnext-save-opacity')
      node.style.removeProperty('--vnext-save-color')
    }
    stableTextPanel.panel.removeAttribute('aria-busy')
    stableTextPanel.panel.inert = stableTextPanel.inert
    for (const state of stableTextPanel.ranges) state.node.inert = state.inert
    stableTextPanel = null
  }
  async function saveTextPosition(props, id) {
    const selection = selectedText
    if (!selection || busy() || !canEdit()) return
    keepTextPanelStable()
    const move = { id, x: props.x, y: props.y, canvasId: selection.canvasId, projectId: selection.scope.projectId, generation: session.loadGeneration, selection }
    pendingTextMove = move
    selection.preview = props
    render()
    try {
      return await queueTextSave(props, id)
    } catch (error) {
      if (!textMoveCurrent(move)) return
      if (pendingTextMove === move && error.unknown && session.manualWrite && textMoveCurrent(move)) move.recovering = true
      throw error
    } finally {
      if (pendingTextMove === move && !move.recovering) clearTextMove()
      render()
    }
  }
  function textProps() {
    const draft = textDraft()
    if (draft && !draft.submitting) return draft.props
    if (selectedText) {
      const base = selectedText.preview || textObjectProps(selectedText.item)
      return objectDrag?.id === selectedText.item.id ? { ...base, x: objectDrag.x, y: objectDrag.y } : base
    }
    return textOptions
  }
  function currentTextTarget() {
    const canvas = view.canvases.find(item => item.id === view.selectedId)
    const manifest = session.documents?.get?.(session.project?.canvases?.[view.selectedId]?.document_id)
    const target = session.documentTimeline?.target?.(manifest)
    return {
      manifest, target, canvas,
      scope: manifest && target && session.project ? {
        projectId: session.project.id, projectRevision: session.project.revision,
        documentId: manifest.document_id, workingRevision: manifest.revision,
        canvasId: view.selectedId, frameId: target.frame_id, layerId: target.layer_id,
        width: canvas?.width || manifest.canvas.w, height: canvas?.height || manifest.canvas.h,
      } : null,
    }
  }
  function revalidateTextSelection() {
    if (!selectedText) return
    const manifest = session.documents?.get?.(selectedText.scope.documentId)
    const item = manifest?.text_objects?.items?.find(entry => entry.id === selectedText.item.id)
    if (session.project?.id !== selectedText.scope.projectId || !item) { selectedText = null; return }
    selectedText.item = item
    selectedText.scope = { ...selectedText.scope, projectRevision: session.project.revision, workingRevision: manifest.revision, frameId: item.frame_id, layerId: item.layer_id }
    selectedText.missingFont = !familyFor(item)
    const live = currentTextTarget().scope
    selectedText.stale = !live || live.canvasId !== selectedText.scope.canvasId || live.frameId !== item.frame_id || live.layerId !== item.layer_id
  }
  function fontCommand(props, scope, id) {
    const choice = fontChoices.find(entry => entry.id === props.fontId)
    const local = Boolean(choice?.local || props.fontId.startsWith('local:'))
    const fontName = choice?.local || (props.fontId.startsWith('local:') ? props.fontId.slice(6) : props.family)
    return textObjectCommand(props, { id, frameId: scope.frameId, layerId: scope.layerId, fontName, fontKind: local ? 'local' : 'generic' })
  }
  let textSave = Promise.resolve()
  function rejectTextSave(error, fallback) {
    if (selectedText) selectedText.preview = null
    status(error?.message || fallback, { error: true })
    render()
  }
  async function saveTextObject(props, id, scope = selectedText?.scope || currentTextTarget().scope) {
    const generation = session.loadGeneration, priorSelection = selectedText
    if (!scope?.documentId || !scope.frameId || !scope.layerId) throw new Error('Select an unlocked raster layer and frame.')
    const live = currentTextTarget().scope
    if (!live || live.projectId !== scope.projectId || live.documentId !== scope.documentId || live.canvasId !== scope.canvasId || live.frameId !== scope.frameId || live.layerId !== scope.layerId || live.projectRevision !== scope.projectRevision || live.workingRevision !== scope.workingRevision) {
      throw new Error('The selected image, frame, or layer changed. Text was not saved.')
    }
    const localName = props.fontId?.startsWith('local:') ? props.fontId.slice(6) : ''
    const measureFamily = familyFor({ font: { kind: localName ? 'local' : 'generic', name: localName || props.family } })
    if (!measureFamily) throw new Error('The text font is not available.')
    const command = fontCommand(props, scope, id)
    const outcome = await session.changeStructure(command, scope)
    if (!outcome?.ok || outcome.unknown || !outcome.receipt || outcome.receipt.operation_id !== outcome.operationId) {
      const error = new Error(outcome?.unknown ? 'Text save needs confirmation.' : 'Text was not saved.')
      error.unknown = Boolean(outcome?.unknown)
      throw error
    }
    const item = outcome.document?.text_objects?.items?.find(entry => entry.id === id)
    if (!item || item.frame_id !== scope.frameId || item.layer_id !== scope.layerId || item.text !== props.text || item.x !== props.x || item.y !== props.y) throw new Error('The saved text did not match this object.')
    const current = currentTextTarget().scope
    if (session.loadGeneration === generation && selectedText === priorSelection
      && current?.projectId === scope.projectId && current.canvasId === scope.canvasId
      && current.frameId === scope.frameId && current.layerId === scope.layerId) selectedText = { item, scope: { ...scope, projectRevision: outcome.receipt.project_revision, workingRevision: outcome.document.revision }, canvasId: scope.canvasId, sourceWidth: scope.width, sourceHeight: scope.height, missingFont: !familyFor(item) }
    return outcome
  }
  function queueTextSave(props, id) {
    const job = textSave.catch(() => {}).then(() => saveTextObject(props, id))
    textSave = job
    return job
  }
  function familyFor(item) {
    if (!item) return null
    if (item.font.kind === 'generic') return item.font.name
    return fontChoices.find(entry => entry.local === item.font.name)?.family || fonts.familyFor?.(item.font.name) || null
  }
  function paintTextObjects(tile, canvas) {
    tile.querySelector('.vnext-text-objects')?.remove()
    revalidateTextSelection()
    const manifest = session.documents?.get?.(session.project?.canvases?.[canvas.id]?.document_id)
    const target = session.documentTimeline?.target?.(manifest)
    const items = textObjectsForFrame(manifest, target?.frame_id)
    const move = objectDrag?.canvasId === canvas.id && objectDrag.moved ? objectDrag
      : pendingTextMove?.canvasId === canvas.id && textMoveCurrent(pendingTextMove) ? pendingTextMove : null
    const dragging = Boolean(move)
    if (!items.length && !dragging) return
    const overlay = document.createElement('canvas')
    overlay.className = 'vnext-text-objects'
    overlay.width = canvas.width
    overlay.height = canvas.height
    const ctx = overlay.getContext('2d')
    if (dragging) {
      const moved = { id: move.id, x: move.x, y: move.y }
      const bytes = recompositeFrame(manifest, target?.frame_id, familyFor, moved)
      if (bytes) {
        tile.parentElement?.querySelector('.vnext-text-drag-preview')?.remove()
        tile.querySelector('.vnext-text-drag-preview')?.remove()
        const live = document.createElement('canvas')
        live.className = 'vnext-text-drag-preview'
        live.width = canvas.width
        live.height = canvas.height
        live.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes), canvas.width, canvas.height), 0, 0)
        tile.append(live)
        for (const child of tile.children) if (child !== live) child.style.visibility = 'hidden'
        tile.dataset.textCover = '1'
      }
    } else if (tile.dataset.textCover) {
      tile.parentElement?.querySelector('.vnext-text-drag-preview')?.remove()
      tile.querySelector('.vnext-text-drag-preview')?.remove()
      for (const child of tile.children) child.style.visibility = ''
      tile.style.removeProperty('display')
      delete tile.dataset.textCover
    }
    for (const item of items) {
      const selected = selectedText?.canvasId === canvas.id && selectedText.item.id === item.id && !selectedText.stale
      const missing = !familyFor(item)
      if (!selected && !missing) continue
      const at = dragging && move.id === item.id ? { ...item, x: move.x, y: move.y } : item
      const box = textObjectBounds(at, familyFor(item))
      ctx.strokeStyle = missing ? '#c45b5b' : '#517bf5'
      ctx.strokeRect(box.x - 0.5, box.y - 0.5, box.w + 1, box.h + 1)
    }
    if (overlay.width) tile.append(overlay)
  }
  session.paintTextObjects = paintTextObjects
  session.resolveTextFont = familyFor
  function setTextProps(patch, group = null, idle = 0) {
    const draft = textDraft()
    for (const key of ['fontId', 'family', 'size', 'bold', 'italic', 'antialias', 'mode', 'strokeWidth']) if (key in patch) textOptions[key] = patch[key]
    if (!draft || draft.submitting) {
      if (selectedText && !draft) {
        const next = { ...(selectedText.preview || textObjectProps(selectedText.item)), ...patch }
        selectedText.preview = next
        render()
        if (!group) void queueTextSave(next, selectedText.item.id).then(() => { if (selectedText) selectedText.preview = null }).catch(error => rejectTextSave(error, 'Text was not changed.'))
      }
      renderTextPanel(); return
    }
    draft.props = { ...draft.props, ...patch }
    recordTextDraft(draft, group, idle); renderTextDraft(draft)
  }
  function recordTextDraft(draft, group = null, idle = 0) {
    if (!draft.history || draft.composing) return
    draft.history.record(draft.props, group)
    clearTimeout(draft.groupTimer)
    if (group && idle) draft.groupTimer = setTimeout(() => draft.history.end(), idle) // a pause ends a typing/color group
  }
  const eyedropperSection = root.querySelector?.('#vnext-eyedropper-props') || null
  const eyedropperButtons = [...(root.querySelectorAll?.('[data-eyedropper-sample]') || [])]
  let eyedropperSampleMode = 'composite'
  for (const button of eyedropperButtons) {
    button.addEventListener('click', () => {
      if (busy()) return
      eyedropperSampleMode = button.dataset.eyedropperSample === 'layer' ? 'layer' : 'composite'
      refresh()
    })
  }
  function renderToolOptions() {
    const toolSection = root.querySelector?.('#vnext-tool-options')
    const title = root.querySelector?.('#vnext-tool-title'), brushSection = root.querySelector?.('.vnext-brush')
    const info = session.pixelTargetInfo?.()
    const draft = textDraft()
    const hasActiveText = Boolean(draft || selectedText || pendingTextMove)
    const showBrush = Boolean(info && (view.tool === 'pencil' || view.tool === 'eraser') && !draft)
    const showText = Boolean(hasActiveText || (info && view.tool === 'text'))
    const showEyedropper = Boolean(info && view.tool === 'eyedropper' && !draft)
    const showOptions = showBrush || showText || showEyedropper
    const toolLabel = view.tool === 'pencil' ? 'Brush' : (TOOL_TITLES[view.tool] || TOOL_TITLES.select)
    if (title) title.textContent = showText && view.tool !== 'text' ? 'Text' : toolLabel
    if (brushSection) brushSection.hidden = !showBrush
    if (textUi.section) textUi.section.hidden = !showText
    if (eyedropperSection) {
      eyedropperSection.hidden = !showEyedropper
      const locked = busy()
      for (const button of eyedropperButtons) {
        const active = button.dataset.eyedropperSample === eyedropperSampleMode
        button.setAttribute('aria-pressed', String(active))
        button.classList.toggle('is-selected', active)
        button.disabled = locked
      }
    }
    if (toolSection) toolSection.hidden = !showOptions
  }
  function renderTarget() {
    if (stableTextPanel?.stroke) return // Saving status remains on the canvas; target text must not reflow.
    const targetSection = root.querySelector?.('#vnext-target'), targetHead = root.querySelector?.('#vnext-target-head')
    const name = root.querySelector?.('#vnext-target-name'), meta = root.querySelector?.('#vnext-target-meta'), state = root.querySelector?.('#vnext-target-state')
    const targetActions = root.querySelector?.('#vnext-target-actions'), resizeBtn = root.querySelector?.('#vnext-canvas-size-open')
    if (!name || !meta || !state) return
    const info = session.pixelTargetInfo?.()
    if (!info) {
      targetSection?.classList?.add?.('is-empty')
      if (targetHead) targetHead.hidden = true
      if (targetActions) targetActions.hidden = true
      name.textContent = 'No canvas selected'; name.title = ''
      meta.textContent = !session.project ? 'Create or open a project, then add a canvas.'
        : view.canvases.some(c => !c.transient) ? 'Click a canvas to see its details.' : 'Create a canvas or drop a PNG or JPEG to start.'
      meta.hidden = true
      state.hidden = true; return
    }
    targetSection?.classList?.remove?.('is-empty')
    if (targetHead) targetHead.hidden = false
    meta.hidden = false
    name.textContent = info.name; name.title = info.name
    meta.textContent = [info.width && info.height ? `${info.width} × ${info.height} px` : '', info.frames ? `Frame ${info.frame} of ${info.frames}` : '', info.layer ? `Layer: ${info.layer}` : ''].filter(Boolean).join(' · ')
    state.hidden = false; state.classList.toggle('is-readonly', Boolean(info.readOnly))
    state.textContent = info.readOnly ? `Read-only · ${info.readOnly}`
      : info.derived ? (info.linkedFrames ? `Working copy · linked frames ${info.linkedFrames.join(', ')} change together` : 'Working copy · edits save here')
        : (info.blank || info.sequence)
          ? (info.linkedFrames ? `Canvas · linked frames ${info.linkedFrames.join(', ')} change together` : 'Canvas · edits save here')
          : 'Original · your first edit creates a copy beside it'
    if (session.manualWrite && !info.candidate) state.textContent += ' · saving…'
    if (targetActions) targetActions.hidden = Boolean(info.candidate || !session.project?.canvases?.[view.selectedId])
    if (resizeBtn) {
      const canResize = Boolean(!info.readOnly && !busy() && (session.canResizeSelectedCanvas ? session.canResizeSelectedCanvas() : true))
      resizeBtn.disabled = !canResize
      resizeBtn.title = canResize
        ? 'Resize, pad, or crop this canvas across all frames and layers'
        : (info.readOnly || 'Unlock all layers and finish the current edit before resizing.')
    }
  }
  function renderTextOutline() {
    const draft = textDraft()
    if (!draft || draft.submitting || !draft.bounds || view.selectedId !== draft.canvasId) { draft?.outline?.remove(); if (draft) draft.outline = null; return }
    const host = stage?.getBoundingClientRect?.(), origin = view.positionOf(draft.canvasId)
    if (!host || !origin) return
    const canvas = view.canvases.find(item => item.id === draft.canvasId)
    const laid = layoutFrame(draft.props)
    const b = laid || draft.bounds
    const endX = Math.min(b.x + b.w, canvas?.width || b.x + b.w)
    const endY = Math.min(b.y + b.h, canvas?.height || b.y + b.h)
    const startX = Math.max(0, b.x), startY = Math.max(0, b.y)
    if (endX <= startX || endY <= startY) { draft.outline?.remove(); draft.outline = null; return }
    const a = view.worldToScreen(origin.x + startX, origin.y + startY, host), z = view.worldToScreen(origin.x + endX, origin.y + endY, host)
    if (!draft.outline) {
      draft.outline = document.createElement('div'); draft.outline.className = 'vnext-pixel-text-draft-outline'
      draft.outline.setAttribute('aria-hidden', 'true'); stage.append(draft.outline)
    }
    Object.assign(draft.outline.style, { left: `${a.x - host.left}px`, top: `${a.y - host.top}px`, width: `${z.x - a.x}px`, height: `${z.y - a.y}px` })
  }
  function renderTextPanel() {
    const ui = textUi
    if (!ui.section) return
    const draft = textDraft(), open = Boolean(draft && !draft.submitting), p = textProps(), selected = !open && selectedText
    const locked = open ? false : busy(), ready = open && Boolean(draft.source)
    if (ui.font.options.length !== fontChoices.length) {
      ui.font.replaceChildren(...fontChoices.map(entry => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.label; return option }))
    }
    if (![...ui.font.options].some(option => option.value === p.fontId)) {
      const option = document.createElement('option')
      option.value = p.fontId
      option.textContent = selectedText?.item.font.name || p.family || 'Missing font'
      ui.font.append(option)
    }
    if (ui.font.value !== p.fontId) ui.font.value = p.fontId
    ui.font.disabled = locked || fontBusy
    if (ui.system) {
      ui.system.disabled = locked || fontBusy || !fonts.supportsLocal
      tooltips.set(ui.system, fonts.supportsLocal ? 'Lists the fonts installed on this device; your browser asks for permission first' : 'Not supported in this browser; use Import font')
    }
    if (ui.importFont) ui.importFont.disabled = locked || fontBusy
    const text = open || selected ? p.text : ''
    if (ui.content.value !== text && !(open && draft.composing)) ui.content.value = text
    ui.content.disabled = !open
    ui.content.placeholder = open ? 'Type text…' : 'Click the canvas to place text'
    for (const [number, range, value, min, max] of [[ui.size, ui.sizeRange, p.size, 6, 96], [ui.stroke, ui.strokeRange, p.strokeWidth, 1, 8]]) {
      const strokeOff = number === ui.stroke && p.mode === 'fill'
      if (number.getAttribute('aria-invalid') !== 'true' && Number(number.value) !== value) number.value = String(value)
      if (Number(range.value) !== value) range.value = String(value)
      number.disabled = locked || strokeOff
      range.disabled = stableTextPanel?.ranges.find(state => state.node === range)?.disabled ?? number.disabled
      number.min = range.min = String(min); number.max = range.max = String(max)
    }
    ui.styles.forEach(button => { button.setAttribute('aria-pressed', String(Boolean(p[button.dataset.textStyle]))); button.disabled = locked })
    ui.modes.forEach(button => { button.setAttribute('aria-pressed', String(p.mode === button.dataset.textMode)); button.disabled = locked })
    for (const [input, key] of [[ui.x, 'x'], [ui.y, 'y']]) {
      input.disabled = !(ready || selected) || Boolean(pendingTextMove)
      if (ready || selected) { if (input.getAttribute('aria-invalid') !== 'true' && Number(input.value) !== p[key]) input.value = String(p[key]) }
      else input.value = ''
    }
    ui.discard.disabled = (!open && !selected) || Boolean(pendingTextMove)
    ui.done.disabled = !ready || Boolean(draft.composing || fontBusy || draft.invalid)
    const problem = fieldError || (open ? draft.error?.message || draft.invalid || fontError : fontError) || ''
    if (ui.error.textContent !== problem) ui.error.textContent = problem // role=status stays rendered (collapsed when empty) so changes are announced
    if (open && draft.invalid && draft.shownSelected) ui.content.setAttribute('aria-invalid', 'true'); else ui.content.removeAttribute('aria-invalid')
    // Font list state stays visible (loading, unsupported browser, limited list); font errors use the error line.
    const fontState = fontBusy ? 'Loading font…' : !fonts.supportsLocal ? 'System fonts aren’t available in this browser · use Import font'
      : fontListLimited ? 'Showing the first 2048 installed fonts · import a file if yours is missing' : ''
    if (ui.fontNote) { if (ui.fontNote.textContent !== fontState) ui.fontNote.textContent = fontState; ui.fontNote.hidden = !fontState }
    // States stay visible (unsaved draft, loading, recovery); instructions and shortcuts are in the controls' tips.
    const state = selected ? (selectedText.missingFont ? `Font “${selectedText.item.font.name}” is not available. The text object was kept.` : (selectedText.stale ? 'Switch back to this text object’s frame and layer before editing it.' : ''))
      : !open ? '' : !draft.source ? (draft.error ? 'Pixels could not be loaded. Retry reloads them; this text stays here.' : 'Loading pixels…')
      : 'Unsaved draft · not placed on the canvas yet'
    if (ui.retry) ui.retry.hidden = !(open && draft.error && !draft.source)
    if (ui.help.textContent !== state) ui.help.textContent = state
    ui.help.hidden = !state
  }
  function renderTextDraft(draft) {
    if (!draft || draft.cancelled || draft.submitting) return
    if (!draft.source || fontBusy) { renderTextPanel(); return }
    const p = draft.props
    draft.shownSelected = draft.source.isSelected()
    try {
      if (!draft.shownSelected) {
        const name = view.canvases.find(c => c.id === draft.canvasId)?.name || 'the canvas'
        // Reselecting fixes a selection change; a changed project or image cannot be fixed by reselecting.
        const changed = !draft.source.isCurrent() || session.project?.revision !== draft.source.projectRevision
        throw new Error(changed ? 'This image changed while the text was open. Discard the text, then place it again.'
          : `Select “${name}” again to keep editing this text, or Discard it.`)
      }
      if (fontError) throw new Error(fontError)
      const family = /^(sans-serif|serif|monospace|GameToolFont\d+)$/.test(p.family || '') ? p.family : (familyFor(selectedText?.item) || p.family)
      draft.stroke = createPixelText(draft.source, p.color, { x: p.x, y: p.y }, p.text, p.size, undefined,
        { family, bold: p.bold, italic: p.italic, antialias: p.antialias, mode: p.mode, strokeWidth: p.strokeWidth })
      draft.invalid = ''
    } catch (error) {
      draft.stroke = { bytes: new Uint8Array(draft.source.rgba), changed: false }
      draft.invalid = error.message || 'Text could not be drawn.'
    }
    preview(draft) // also keeps an active marquee selection's limit, as for every other tool
    draft.stroke.changed = draft.stroke.bytes.some((v, i) => v !== draft.source.rgba[i])
    // Object validity is independent of visible pixels (fully clipped or same-color text is still editable).
    draft.bounds = !draft.invalid && p.text.trim() ? layoutFrame(p) : null
    renderTextOutline(); placeCanvasText(draft); renderTextPanel()
  }
  function startTextDraft(canvasId, at, restored = null) {
    const canvas = view.canvases.find(c => c.id === canvasId && !c.transient)
    if (!canvas) return null
    const draft = { canvasId, origin: { ...view.positionOf(canvasId) }, tool: 'text', ended: true, cancelled: false, pointerId: null, scope: currentTextTarget().scope }
    const initial = restored ? cloneTextSnapshot(restored)
      : { ...textOptions, text: '', color: color.slice(), ...clampTextAnchor(canvas.width, canvas.height, at) }
    draft.props = initial; draft.history = createTextDraftHistory(initial)
    if (restored && !sameColor(restored.color, color)) { suppressTextColor = true; try { paintColor(restored.color) } finally { suppressTextColor = false } }
    const preparing = session.preparePixelEdit({ includeTextPreview: true }) // checks for other edits before this draft registers itself
    gesture = draft; session.manualGesture = draft
    draft.ready = preparing.then(source => {
      if (draft.cancelled) return
      draft.source = source
      draft.props = { ...draft.props, ...clampTextAnchor(source.width, source.height, draft.props) }
      renderTextDraft(draft)
    }).catch(error => { draft.error = error; if (!draft.cancelled) renderTextPanel() })
    refresh()
    focusCanvasText(draft)
    return draft
  }
  function focusCanvasText(draft) {
    if (!draft || draft.cancelled) return
    if (!draft.input) {
      const input = document.createElement('textarea')
      input.className = 'vnext-pixel-text-input'
      input.maxLength = 160
      input.rows = 4
      input.setAttribute('aria-label', 'Text on the canvas')
      input.addEventListener('pointerdown', event => event.stopPropagation())
      input.addEventListener('input', () => {
        if (draft.cancelled || draft.submitting) return
        draft.props = { ...draft.props, text: input.value }
        recordTextDraft(draft, 'text', 800); renderTextDraft(draft)
      })
      input.addEventListener('compositionstart', () => { draft.composing = true; renderTextPanel() })
      input.addEventListener('compositionend', () => {
        draft.composing = false
        draft.props = { ...draft.props, text: input.value }
        recordTextDraft(draft, 'text', 800); renderTextDraft(draft)
      })
      stage.append(input)
      draft.input = input
    }
    placeCanvasText(draft)
    draft.input.focus({ preventScroll: true })
  }
  function layoutFrame(props = {}) {
    const family = /^(sans-serif|serif|monospace|GameToolFont\d+)$/.test(props.family || '') ? props.family : 'sans-serif'
    const box = textObjectBounds({ text: props.text || '', x: props.x || 0, y: props.y || 0, size: props.size || 16, bold: props.bold, italic: props.italic, mode: props.mode, stroke_width: props.strokeWidth, font: { kind: 'generic', name: family } }, family)
    const lines = Math.max(1, String(props.text || '').replace(/\r\n?/g, '\n').split('\n').length)
    const step = box.step
    return { x: box.x, y: box.y, w: box.w + 1, h: Math.max(box.h, step * lines), step }
  }
  function placeCanvasText(draft) {
    const input = draft?.input
    if (!input || !stage) return
    const host = stage.getBoundingClientRect?.(), origin = view.positionOf(draft.canvasId)
    if (!host || !origin) return
    const p = draft.props || {}
    const canvas = view.canvases.find(item => item.id === draft.canvasId)
    const a = view.worldToScreen(origin.x + (p.x || 0), origin.y + (p.y || 0), host)
    const start = view.worldToScreen(origin.x, origin.y, host)
    const edge = view.worldToScreen(origin.x + (canvas?.width || 1), origin.y + (canvas?.height || 1), host)
    const layout = layoutFrame(p)
    const sourceW = layout.w
    const sourceH = layout.h
    const width = Math.max(8, sourceW * view.zoom)
    const height = Math.max(8, sourceH * view.zoom)
    Object.assign(input.style, {
      left: `${a.x - host.left}px`, top: `${a.y - host.top}px`, width: `${width}px`, height: `${height}px`,
      clipPath: `inset(${Math.max(0, start.y - a.y)}px ${Math.max(0, a.x + width - edge.x)}px ${Math.max(0, a.y + height - edge.y)}px ${Math.max(0, start.x - a.x)}px)`,
      fontSize: `${Math.max(8, (p.size || 16) * view.zoom)}px`, lineHeight: `${layout.step * view.zoom}px`,
      fontFamily: p.family || 'sans-serif', fontWeight: p.bold ? '700' : '400', fontStyle: p.italic ? 'italic' : 'normal',
    })
    if (document.activeElement !== input && input.value !== (p.text || '') && !draft.composing) input.value = p.text || ''
  }
  function retryTextPixels(draft = textDraft()) {
    if (!draft || draft.submitting || draft.source || !draft.error) return
    draft.error = null
    renderTextPanel()
    session.manualGesture = null
    let preparing
    try { preparing = session.preparePixelEdit({ includeTextPreview: true }) } finally { session.manualGesture = draft }
    draft.ready = preparing.then(source => {
      if (draft.cancelled || textDraft() !== draft) return
      draft.source = source
      draft.error = null
      draft.props = { ...draft.props, ...clampTextAnchor(source.width, source.height, draft.props) }
      renderTextDraft(draft)
    }).catch(error => { if (!draft.cancelled && textDraft() === draft) { draft.error = error; renderTextPanel() } })
  }
  function discardTextDraft(draft = textDraft()) {
    if (!draft || draft.submitting) return
    draft.cancelled = true; clear(draft); render(); focusCanvas()
  }
  function undoTextDraft(draft, redo = false) {
    const snapshot = redo ? draft.history.redo() : draft.history.undo()
    if (!snapshot) {
      if (redo) return
      // The first step is the click that placed the cursor: undoing an empty draft removes it.
      if (!draft.props.text.trim()) { discardTextDraft(draft); return }
      status('Nothing earlier to undo in this text. Discard removes it.'); return
    }
    draft.props = snapshot
    if (!sameColor(snapshot.color, color)) { suppressTextColor = true; try { paintColor(snapshot.color) } finally { suppressTextColor = false } }
    renderTextDraft(draft)
  }
  // Returns false when the draft cannot be placed yet (it stays open and explains why).
  function placeTextDraft(draft = textDraft()) {
    if (!draft || draft.submitting) return true
    if (draft.composing) { status('Finish typing first, then place the text.'); return false }
    if (fontBusy) { status('Wait for the font to load.'); return false }
    if (!draft.source) {
      if (!draft.props.text.trim()) { discardTextDraft(draft); return true }
      status(draft.error ? draft.error.message || 'Pixels could not be loaded.' : 'Loading pixels… try again in a moment.', { error: Boolean(draft.error) })
      return false
    }
    renderTextDraft(draft)
    if (!draft.props.text.trim()) { discardTextDraft(draft); return true }
    if (draft.invalid) { status(draft.invalid, { error: true }); return false }
    void saveTextDraft(draft)
    return true
  }
  function adoptConfirmedText(draft, result, objectId, props) {
    const item = result?.document?.text_objects?.items?.find(entry => entry.id === objectId)
    if (!item || item.text !== props.text || item.x !== props.x || item.y !== props.y) return
    const open = textDraft()
    if (open && open !== draft) {
      draft.cancelled = true
      draft.input?.remove(); draft.outline?.remove(); draft.overlay?.remove()
      return
    }
    draft.cancelled = true
    draft.pendingRecovery = null
    clear(draft)
    selectedText = {
      item,
      scope: { ...draft.scope, projectRevision: result.receipt.project_revision, workingRevision: result.document.revision, frameId: item.frame_id, layerId: item.layer_id },
      canvasId: draft.canvasId,
      sourceWidth: draft.source?.width,
      sourceHeight: draft.source?.height,
      missingFont: !familyFor(item),
    }
  }
  async function saveTextDraft(draft) {
    if (draft.pendingRecovery) { draft.submitting = false; draft.pendingRecovery(); return }
    if (!draft.objectId) draft.objectId = `text_${crypto.randomUUID().replace(/-/g, '')}`
    const props = cloneTextSnapshot(draft.props), canvasId = draft.canvasId, objectId = draft.objectId
    const scope = { ...(draft.scope || currentTextTarget().scope), onConfirmed: result => adoptConfirmedText(draft, result, objectId, props) }
    clearTimeout(draft.groupTimer); draft.submitting = true
    if (gesture === draft) { gesture = null; session.manualGesture = null }
    let failed = false, unknown = false
    try {
      await saveTextObject(props, objectId, scope)
      draft.cancelled = true
      draft.pendingRecovery = null
      clear(draft)
    }
    catch (error) {
      failed = true
      unknown = Boolean(error.unknown)
      gesture = draft; session.manualGesture = draft; draft.submitting = false
      if (unknown && session.manualWrite?.recover) draft.pendingRecovery = session.manualWrite.recover
      status(error.message || 'Text was not saved.', { error: true })
      renderTextDraft(draft)
    }
    finally { render() }
    if (failed && !unknown && !draft.source) restoreTextDraft(canvasId, props, false)
  }
  function restoreTextDraft(canvasId, props, onCopy = false) {
    if (gesture || busy() || !view.canvases.some(c => c.id === canvasId && !c.transient)) {
      status(`Text was not saved: “${props.text.slice(0, 40)}”. Select the canvas and place it again.`, { error: true }); return
    }
    if (view.tool !== 'text') view.setTool('text') // placed by Move or another tool: the restored draft still runs as Text
    select(canvasId)
    if (!canEdit()) { status('Text was not saved, and this canvas cannot be edited now.', { error: true }); return }
    startTextDraft(canvasId, props, props)
    status(onCopy ? 'The copy was created, but the text was not saved. It is still here on the copy; choose Done to try again.'
      : 'Text was not saved. It is still here; choose Done to try again.', { error: true })
  }
  function moveTextDraft(draft, p) {
    const drag = draft.moveDrag
    if (!drag || !draft.source) return
    const next = clampTextAnchor(draft.source.width, draft.source.height, { x: drag.from.x + p.x - drag.start.x, y: drag.from.y + p.y - drag.start.y })
    if (next.x === draft.props.x && next.y === draft.props.y) return
    draft.props = { ...draft.props, ...next }; recordTextDraft(draft, 'move'); renderTextDraft(draft)
  }
  function endTextDrag(draft = textDraft()) {
    if (!draft?.moveDrag) return
    try { stage.releasePointerCapture(draft.moveDrag.pointerId) } catch { /* capture may have ended */ }
    draft.moveDrag = null; draft.history.end()
  }
  const loadFont = async task => {
    const epoch = ++fontEpoch, active = () => epoch === fontEpoch
    fontBusy = true; fontError = ''
    renderTextPanel()
    try { await task(active) }
    catch (error) {
      if (active()) fontError = error.name === 'NotAllowedError' ? 'Font access was denied. Use Import font or choose a system default.' : error.message || 'Font could not be loaded.'
    } finally {
      if (active()) {
        fontBusy = false
        const draft = textDraft(); if (draft) renderTextDraft(draft); else renderTextPanel()
      }
    }
  }
  function bindTextPanel() {
    const ui = textUi
    if (!ui.section) return
    ui.content.addEventListener('input', () => {
      const draft = textDraft(); if (!draft || draft.submitting) return
      draft.props = { ...draft.props, text: ui.content.value }
      recordTextDraft(draft, 'text', 800); renderTextDraft(draft)
    })
    ui.content.addEventListener('compositionstart', () => { const draft = textDraft(); if (draft) { draft.composing = true; renderTextPanel() } })
    ui.content.addEventListener('compositionend', () => {
      const draft = textDraft(); if (!draft) return
      draft.composing = false; draft.props = { ...draft.props, text: ui.content.value }
      recordTextDraft(draft, 'text', 800); renderTextDraft(draft)
    })
    ui.content.addEventListener('blur', () => textDraft()?.history?.end())
    const numeric = (number, range, key, min, max, group) => {
      const apply = (node, end) => {
        const value = Number(node.value)
        if (!Number.isInteger(value) || value < min || value > max) {
          if (node === number) { number.setAttribute('aria-invalid', 'true'); fieldError = `Use a whole number from ${min} to ${max}.`; renderTextPanel() }
          return
        }
        number.removeAttribute('aria-invalid'); fieldError = ''
        if (textProps()[key] !== value) setTextProps({ [key]: value }, group)
        if (end) {
          textDraft()?.history?.end()
          if (!textDraft() && selectedText?.preview) void queueTextSave(selectedText.preview, selectedText.item.id).then(() => { if (selectedText) selectedText.preview = null }).catch(error => rejectTextSave(error, 'Text was not changed.'))
        }
      }
      range.addEventListener('input', () => apply(range, false))
      range.addEventListener('change', () => apply(range, true))
      number.addEventListener('input', () => apply(number, false))
      number.addEventListener('change', () => { apply(number, true); if (number.getAttribute('aria-invalid') === 'true') { number.removeAttribute('aria-invalid'); fieldError = ''; renderTextPanel() } })
    }
    numeric(ui.size, ui.sizeRange, 'size', 6, 96, 'size')
    numeric(ui.stroke, ui.strokeRange, 'strokeWidth', 1, 8, 'stroke')
    for (const [input, key] of [[ui.x, 'x'], [ui.y, 'y']]) {
      const apply = end => {
        const draft = textDraft()
        if (!draft?.source && selectedText && end) {
          const value = Number(input.value)
          if (!Number.isSafeInteger(value)) { input.setAttribute('aria-invalid', 'true'); fieldError = 'Use a whole-number text coordinate.'; renderTextPanel(); return }
          const props = { ...textObjectProps(selectedText.item), [key]: value }
          if (props[key] !== selectedText.item[key]) void saveTextPosition(props, selectedText.item.id).catch(error => status(error.message || 'Text was not moved.', { error: true }))
          return
        }
        if (!draft?.source || draft.submitting) return
        const value = Number(input.value)
        if (!Number.isSafeInteger(value)) { input.setAttribute('aria-invalid', 'true'); fieldError = 'Use a whole-number text coordinate.'; renderTextPanel(); return }
        input.removeAttribute('aria-invalid'); fieldError = ''
        if (draft.props[key] !== value) { draft.props = { ...draft.props, [key]: value }; recordTextDraft(draft, key); renderTextDraft(draft) }
        if (end) draft.history.end()
      }
      input.addEventListener('input', () => apply(false))
      input.addEventListener('change', () => { apply(true); input.removeAttribute('aria-invalid'); fieldError = ''; renderTextPanel() })
    }
    ui.styles.forEach(button => button.addEventListener('click', () => { const key = button.dataset.textStyle; setTextProps({ [key]: !textProps()[key] }) }))
    ui.modes.forEach(button => button.addEventListener('click', () => { if (textProps().mode !== button.dataset.textMode) setTextProps({ mode: button.dataset.textMode }) }))
    ui.font.addEventListener('change', () => {
      const entry = fontChoices.find(item => item.id === ui.font.value)
      loadFont(async active => {
        const family = await fonts.resolve(entry, active)
        if (active() && family) { entry.family = family; setTextProps({ fontId: entry.id, family }) }
      })
    })
    ui.system?.addEventListener('click', () => loadFont(async active => {
      const result = await fonts.list()
      if (!active()) return
      fontChoices = [...TEXT_FONT_DEFAULTS, ...fonts.imported, ...result.choices]
      ui.font.replaceChildren()
      fontListLimited = Boolean(result.limited)
    }))
    ui.importFont?.addEventListener('click', () => { ui.fontFile.value = ''; ui.fontFile.click() })
    ui.fontFile?.addEventListener('change', () => {
      const file = ui.fontFile.files?.[0]; if (!file) return
      loadFont(async active => {
        const entry = await fonts.importFile(file, active)
        if (!active() || !entry) return
        fontChoices = [...fontChoices.filter(item => item.id !== entry.id), entry]; ui.font.replaceChildren()
        setTextProps({ fontId: entry.id, family: entry.family })
      })
    })
    ui.done?.addEventListener('click', () => { const draft = textDraft(); if (draft && placeTextDraft(draft)) focusCanvas() })
    ui.discard?.addEventListener('click', () => {
      if (textDraft()) { discardTextDraft(); return }
      if (!selectedText) return
      const id = selectedText.item.id
      selectedText = null
      void session.changeStructure({ type: 'delete-text', id }).catch(error => status(error.message || 'Text was not removed.', { error: true }))
    })
    ui.retry?.addEventListener('click', () => retryTextPixels())
  }
  function placedTextPoint(event, drag, canvas) {
    const p = point(event, { origin: view.positionOf(drag.canvasId) })
    return clampTextAnchor(canvas?.width || 1, canvas?.height || 1, { x: drag.from.x + p.x - drag.start.x, y: drag.from.y + p.y - drag.start.y })
  }
  function cancelTextObjectDrag() {
    const drag = objectDrag
    if (!drag) return
    drag.cancelled = true
    objectDrag = null
    clearTextMove()
    if (session.manualGesture === drag) session.manualGesture = null
    try { stage.releasePointerCapture(drag.pointerId) } catch { /* capture may have ended */ }
    render()
  }
  stage?.addEventListener('dblclick', event => {
    if (inPanel(event) || view.tool !== 'text' || textDraft() || view.spaceDown) return
    if (busy() || !canEdit()) { status(busyMessage('Finish the current edit before editing text.')); return }
    const hit = view.hitTest(event.clientX, event.clientY, stage.getBoundingClientRect())
    if (!hit) return
    const { manifest, target } = currentTextTarget()
    const objects = textObjectsForFrame(manifest, target?.frame_id).filter(item => item.layer_id === target?.layer_id)
    const hitObject = textObjectAt(objects, point(event, { origin: view.positionOf(hit) }), familyFor)
    if (!hitObject) return
    event.preventDefault(); event.stopPropagation()
    objectDrag = null
    const canvas = view.canvases.find(item => item.id === hit)
    selectedText = { item: hitObject, canvasId: hit, sourceWidth: canvas?.width, sourceHeight: canvas?.height, missingFont: !familyFor(hitObject), scope: { ...currentTextTarget().scope, frameId: hitObject.frame_id, layerId: hitObject.layer_id } }
    const restored = textObjectProps(hitObject)
    const loadedFamily = familyFor(hitObject)
    if (loadedFamily) restored.family = loadedFamily
    const draft = startTextDraft(hit, { x: hitObject.x, y: hitObject.y }, restored)
    if (draft) { draft.objectId = hitObject.id; draft.scope = selectedText.scope }
  }, true)
  const inCanvasText = event => Boolean(event.target?.closest?.('.vnext-pixel-text-input'))
  const brushCursor = bindBrushCursor({ root, stage, view, canEdit, selectionOn,
    getState: () => ({ brush, busy: busy() }) })
  stage?.addEventListener('pointerdown', event => {
    if (inPanel(event) || inCanvasText(event)) return
    if (gesture?.tool === 'paste') {
      // Space-drag still pans; every other press stays on the floating paste so it cannot be orphaned.
      if (view.spaceDown) return
      event.preventDefault(); event.stopImmediatePropagation(); focusCanvas()
      const g = gesture
      if (event.button !== 0 || g.drag) return
      const p = point(event, g)
      if (!g.submitting && pixelPointInRect(p, g.floatRect)) {
        g.drag = { pointerId: event.pointerId, start: p, from: { ...g.at } }
        try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
        renderSelection()
      } else status('Drag the pasted pixels into place, then choose Apply paste or press Enter. Escape cancels.')
      return
    }
    if (!isPixelTool(view.tool) || view.spaceDown || event.button !== 0 || event.target.closest?.('[data-canvas-name]')) return
    const openDraft = textDraft()
    if (openDraft) {
      event.preventDefault(); event.stopImmediatePropagation()
      if (openDraft.submitting) return
      const over = view.hitTest(event.clientX, event.clientY, stage.getBoundingClientRect())
      if (over === openDraft.canvasId && !openDraft.source && !openDraft.error) return // still loading its pixels
      if (over === openDraft.canvasId && openDraft.source && session.conversationRef?.canvasId !== openDraft.canvasId) {
        select(openDraft.canvasId); return // the selection moved away (e.g. Preview): clicking the image brings the draft back
      }
      if (over === openDraft.canvasId && openDraft.source) {
        const p = point(event, openDraft)
        // Drag the text itself to move it; an empty or not visible draft simply follows the click.
        if (pointInTextBounds(openDraft.bounds, p)) {
          openDraft.moveDrag = { pointerId: event.pointerId, start: p, from: { x: openDraft.props.x, y: openDraft.props.y } }
          try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
          return
        }
        if (!openDraft.props.text.trim() || !openDraft.bounds) {
          openDraft.props = { ...openDraft.props, ...clampTextAnchor(openDraft.source.width, openDraft.source.height, p) }
          recordTextDraft(openDraft); renderTextDraft(openDraft); focusCanvasText(openDraft); return
        }
      }
      if (placeTextDraft(openDraft)) focusCanvas() // clicking elsewhere places the text
      return
    }
    event.preventDefault(); event.stopImmediatePropagation(); focusCanvas()
    if (busy()) { status(busyMessage('Finish the current save before drawing.')); return }
    const hit = view.hitTest(event.clientX, event.clientY, stage.getBoundingClientRect())
    if (!hit) return
    select(hit)
    if (!canEdit()) { status('Select an unlocked raster layer and frame.'); return }
    if (view.tool === 'text') {
      const { manifest, target } = currentTextTarget()
      const objects = textObjectsForFrame(manifest, target?.frame_id).filter(item => item.layer_id === target?.layer_id)
      const p = point(event, { origin: view.positionOf(hit) })
      const hitObject = textObjectAt(objects, p, familyFor)
      if (hitObject && event.detail > 1) return
      if (hitObject) {
        const canvas = view.canvases.find(c => c.id === hit)
        selectedText = { item: hitObject, canvasId: hit, sourceWidth: canvas?.width, sourceHeight: canvas?.height, missingFont: !familyFor(hitObject), scope: { ...currentTextTarget().scope, frameId: hitObject.frame_id, layerId: hitObject.layer_id } }
        renderTextPanel(); keepTextPanelStable()
        objectDrag = { pointerId: event.pointerId, id: hitObject.id, start: p, from: { x: hitObject.x, y: hitObject.y }, x: hitObject.x, y: hitObject.y, moved: false, canvasId: hit, cancelled: false, projectId: session.project?.id }
        session.manualGesture = objectDrag
        try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
        renderTextPanel(); render(); return
      }
      selectedText = null
      startTextDraft(hit, p); return
    }
    const g = { canvasId: hit, origin: { ...view.positionOf(hit) }, tool: view.tool,
      color: color.slice(), brush: { ...brush, ...(brush.pattern ? { pattern: copyPixelPattern(brush.pattern) } : {}) }, pointerId: event.pointerId, queued: [], cancelled: false }
    g.queued.push(point(event, g))
    if (g.tool === 'marquee') {
      const canvas = view.canvases.find(c => c.id === hit), selected = selectionOn(hit)
      // Pressing inside the current selection moves its pixels; outside starts a new selection.
      if (selected && pixelPointInRect(g.queued[0], selected.rect)) { startMove(g, event, canvas, selected); return }
      g.source = { width: canvas.width, height: canvas.height }; g.start = g.queued[0]; g.previousSelection = session.pixelSelection
      gesture = g; session.manualGesture = g; selectRect(g, g.start)
      try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
      return
    }
    if (isShapeTool(g.tool)) { g.start = g.queued[0]; g.lineEnd = g.start; g.queued = [] }
    // preparePixelEdit takes the same canonical read path as existing pixel edits.
    const preparing = session.preparePixelEdit({ includeTextPreview: true })
    if (g.tool !== 'eyedropper') keepTextPanelStable(g)
    gesture = g; session.manualGesture = g
    try { stage.setPointerCapture(event.pointerId) } catch { /* synthetic input */ }
    g.ready = preparing.then(source => {
      if (g.cancelled) return
      g.source = source
      if (g.tool === 'fill') {
        g.stroke = createPixelFill(source, g.color, g.queued[0], source.allowedRect); g.queued = []; preview(g)
      } else if (isShapeTool(g.tool)) {
        g.stroke = (g.tool === 'line' ? createPixelLine : createPixelRectangle)(source, g.color, g.start)
        g.stroke.point(g.lineEnd); preview(g)
      } else if (g.tool !== 'eyedropper') {
        g.stroke = createPixelStroke(source, g.tool === 'eraser' ? [0, 0, 0, 0] : g.color, { ...g.brush, erase: g.tool === 'eraser' })
        g.queued.forEach(p => g.stroke.point(p)); g.queued = []; preview(g)
      }
    }).catch(error => { g.error = error })
    refresh()
  }, true)
  stage?.addEventListener('pointermove', event => {
    if (inCanvasText(event)) return
    if (objectDrag?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation()
      const p = point(event, { origin: view.positionOf(objectDrag.canvasId) })
      const canvas = view.canvases.find(c => c.id === objectDrag.canvasId)
        const next = placedTextPoint(event, objectDrag, canvas)
        if (next.x !== objectDrag.x || next.y !== objectDrag.y) {
        objectDrag.x = next.x; objectDrag.y = next.y; objectDrag.moved = true
        if (textUi.x && document.activeElement !== textUi.x) textUi.x.value = String(next.x)
        if (textUi.y && document.activeElement !== textUi.y) textUi.y.value = String(next.y)
        textMovePaint.request()
      }
      return
    }
    const g = gesture
    if (g?.tool === 'text') {
      if (g.moveDrag?.pointerId === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); moveTextDraft(g, point(event, g)) }
      return
    }
    if (g?.tool === 'paste') {
      if (!g.drag || event.pointerId !== g.drag.pointerId) return
      event.preventDefault(); event.stopImmediatePropagation()
      dragPaste(g, point(event, g)); return
    }
    if (!g || event.pointerId !== g.pointerId || g.ended) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (g.tool === 'fill') return
    const p = point(event, g)
    if (g.tool === 'marquee') { selectRect(g, p); return }
    if (g.tool === 'move-selection') { dragMove(g, p); return }
    if (isShapeTool(g.tool)) {
      g.lineEnd = p
      if (g.stroke) { g.stroke.point(p); preview(g) }
    } else if (g.tool === 'eyedropper') g.queued = [p]
    else if (g.stroke) { g.stroke.point(p); preview(g) }
    else if (g.queued.length < 4096) g.queued.push(p)
    else { cancel(); status('Pixel loading took too long. The stroke was not saved.'); }
  }, true)
  stage?.addEventListener('pointerup', async event => {
    if (objectDrag?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation()
      const drag = objectDrag
      objectDrag = null
      if (session.manualGesture === drag) session.manualGesture = null
      try { stage.releasePointerCapture(event.pointerId) } catch { /* capture may have ended */ }
      const canvas = view.canvases.find(c => c.id === drag.canvasId)
      const next = placedTextPoint(event, drag, canvas)
      const changed = next.x !== drag.from.x || next.y !== drag.from.y
      const sameTarget = selectedText?.item.id === drag.id && selectedText?.scope?.projectId === drag.projectId && session.project?.id === drag.projectId
      if (!drag.cancelled && changed && sameTarget && !busy() && canEdit()) {
        const props = { ...textObjectProps(selectedText.item), x: next.x, y: next.y }
        await saveTextPosition(props, drag.id).catch(error => status(error.message || 'Text was not moved.', { error: true }))
      } else if (changed && (busy() || !canEdit())) status(busyMessage('Finish the current edit before editing text.'))
      if (!pendingTextMove) clearTextMove()
      render(); return
    }
    const g = gesture
    if (g?.tool === 'text') {
      if (g.moveDrag?.pointerId === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); moveTextDraft(g, point(event, g)); endTextDrag(g) }
      return
    }
    if (g?.tool === 'paste') {
      if (!g.drag || event.pointerId !== g.drag.pointerId) return
      event.preventDefault(); event.stopImmediatePropagation()
      dragPaste(g, point(event, g))
      try { stage.releasePointerCapture(event.pointerId) } catch { /* capture may have ended */ }
      g.drag = null; renderSelection(); return
    }
    if (!g || event.pointerId !== g.pointerId || g.ended) return
    event.preventDefault(); event.stopImmediatePropagation(); g.ended = true
    const end = point(event, g)
    if (g.tool === 'marquee') { selectRect(g, end); clear(g); render(); return }
    if (g.tool === 'move-selection') { await finishMove(g, end); return }
    if (isShapeTool(g.tool)) { g.lineEnd = end; g.stroke?.point(end) }
    else if (g.tool === 'eyedropper') g.queued = [end]
    else if (g.tool !== 'fill') {
      if (g.stroke) g.stroke.point(end)
      else g.queued.push(end)
    }
    await g.ready
    if (g.cancelled) return
    try {
      if (g.error) throw g.error
      if (!g.source?.isSelected()) throw new Error('The selected image changed. The stroke was not saved.')
      if ((g.tool === 'fill' || isShapeTool(g.tool))
        && (end.x < 0 || end.y < 0 || end.x >= g.source.width || end.y >= g.source.height)) return
      if (g.tool === 'eyedropper') {
        const p = g.queued.at(-1)
        if (p.x >= 0 && p.y >= 0 && p.x < g.source.width && p.y < g.source.height) {
          const offset = (p.y * g.source.width + p.x) * 4
          const sampled = typeof g.source.sampleRgba === 'function'
            ? g.source.sampleRgba(eyedropperSampleMode)
            : (eyedropperSampleMode === 'composite' && typeof g.source.previewPixels === 'function'
              ? g.source.previewPixels(g.source.rgba)
              : g.source.rgba)
          if (sampled[offset + 3] > 0) paintColor([...sampled.slice(offset, offset + 4)])
        }
        view.setTool('pencil'); clear(g)
      } else {
        constrain(g)
        if (g.stroke.changed) {
          preview(g) // Includes the release point and selection clipping before holding the final result.
          await saveHeld(g, g.stroke.bytes, {})
        }
      }
    } catch (error) { status(error.message || 'The stroke was not saved.', { error: true }) }
    finally {
      clear(g)
      if (stableTextPanel?.stroke === g && !hold?.untilWriteClears) clearStablePanel()
      render()
    }
  }, true)
  const textMovePaint = createFrameCoalescer(() => render(), (callback) => {
    const schedule = globalThis.requestAnimationFrame || ((run) => run())
    schedule(callback)
  })
  stage?.addEventListener('pointercancel', event => {
    if (objectDrag?.pointerId === event.pointerId) { cancelTextObjectDrag(); return }
    if (inPanel(event)) return
    // An interrupted drag keeps the floating paste where it was; only Cancel/Escape discards it.
    if (gesture?.tool === 'paste') { gesture.drag = null; renderSelection(); return }
    if (gesture?.tool === 'text') { endTextDrag(); return } // an interrupted drag never discards typed text
    if (gesture) cancel() // a stray cancel must not drop a candidate whose save is still in flight
  }, true)
  stage?.addEventListener('lostpointercapture', event => {
    if (objectDrag?.pointerId === event.pointerId) { cancelTextObjectDrag(); return }
    if (inPanel(event)) return
    if (gesture?.tool === 'paste') { if (gesture.drag) { gesture.drag = null; renderSelection() } return }
    if (gesture?.tool === 'text') { endTextDrag(); return }
    if (gesture && !gesture.ended) cancel()
  }, true)
  stage?.addEventListener('wheel', event => {
    if (inPanel(event)) return
    if (gesture && gesture.tool !== 'paste' && gesture.tool !== 'text') { event.preventDefault(); event.stopImmediatePropagation() } // a text draft can be zoomed
  }, { capture: true, passive: false })
  stage?.addEventListener('click', event => {
    if (inPanel(event) || inCanvasText(event)) return
    if (isPixelTool(view.tool) && !event.target.closest?.('[data-canvas-name]')) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
  root.addEventListener('keydown', event => {
    // Open dialogs own the keyboard; pixel keys never act behind them. Escape also belongs to an open
    // menu/popover or a pending project open before it can clear, cancel or explain anything here.
    const modal = ['#vnext-confirm-dialog', '#vnext-open-dialog', '#vnext-canvas-size-dialog'].some(id => root.querySelector?.(id)?.hidden === false)
    const escapeOwned = event.key === 'Escape' && (modal || Boolean(session.openInFlight?.()) // a cancelled open no longer owns Escape
      || ['#vnext-project-menu', '.vnext-skill-pop', '.vnext-timeline-menu', '.vnext-onion-pop', '#vnext-palette-menu', '#vnext-palette-select-menu', '#vnext-view-settings'].some(s => root.querySelector?.(s)?.hidden === false)
      || event.vnextViewSettingsClosed)
    if (objectDrag && event.key === 'Escape' && !escapeOwned) {
      event.preventDefault(); event.stopImmediatePropagation(); cancelTextObjectDrag(); return
    }
    if (escapeOwned || (gesture && modal)) return
    if (!gesture) {
      if (event.isComposing || event.keyCode === 229 || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key?.toLowerCase(), command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey, selected = selectionOn(view.selectedId)
      const popup = ['#vnext-project-menu', '.vnext-skill-pop', '.vnext-timeline-menu', '.vnext-onion-pop', '#vnext-palette-menu', '#vnext-palette-select-menu', '#vnext-view-settings'].some(s => root.querySelector?.(s)?.hidden === false)
      const toolKey = TOOL_BY_KEY[key]
      if (toolKey && plain && !event.shiftKey && !event.repeat && !modal && !popup) {
        const target = event.target
        if (['BODY', 'HTML'].includes(target?.tagName) || target?.closest?.('#vnext-canvas-stage, .vnext-tools, .vnext-color-sidebar')) {
          event.preventDefault(); event.stopImmediatePropagation()
          if (toolKey === 'move') { if (!busy()) { view.setTool('move'); render() } } else chooseTool(toolKey)
        }
        return
      }
      if (key === 'x' && plain && !event.shiftKey && !event.repeat && !modal && !popup && !busy()) {
        const target = event.target
        if (['BODY', 'HTML'].includes(target?.tagName) || target?.closest?.('#vnext-canvas-stage, .vnext-tools, .vnext-color-sidebar')) {
          event.preventDefault(); event.stopImmediatePropagation()
          workingColors = [workingColors[1], workingColors[0]]; paintColor(workingColors[activeColor])
        }
        return
      }
      // Pixel shortcuts act only when focus is on the page, the canvas area or the tool rail, never in other panels.
      const target = event.target, onCanvas = target?.tagName === 'BODY' || target?.tagName === 'HTML'
        || Boolean(target?.closest?.('#vnext-canvas-stage')) || Boolean(target?.closest?.('.vnext-tools'))
      const textSelected = typeof window !== 'undefined' && window.getSelection?.()?.isCollapsed === false
      if (modal || !onCanvas) return
      if (hold && event.key === 'Escape') {
        // A save already in flight cannot be withdrawn; say so instead of clearing the outline.
        event.preventDefault(); event.stopImmediatePropagation()
        status('Saving this change; it cannot be cancelled now. Use Undo after it saves.')
        return
      }
      let action = null
      if (event.key === 'Escape' && session.pixelSelection) action = 'clear'
      else if (command && key === 'c' && selected && !textSelected) action = 'copy'
      else if (command && key === 'v' && clipboard && view.selectedId) action = 'paste'
      else if (plain && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace') && selected) action = 'delete'
      else if (plain && event.shiftKey && (key === 'h' || key === 'v') && selected) action = key === 'h' ? 'flip-h' : 'flip-v'
      if (!action) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.repeat && action !== 'clear') return
      if (action === 'clear') { session.pixelSelection = null; render(); return }
      return action === 'paste' ? startPaste() : selectionAction(action)
    }
    if (gesture.tool === 'paste') {
      // Enter/Escape belong to the paste only when the canvas has keyboard focus; any other focused
      // control (Project menu, Open preview, dialogs) handles them normally.
      const target = event.target, onStage = target?.tagName === 'BODY' || target?.tagName === 'HTML' || Boolean(target?.closest?.('#vnext-canvas-stage'))
      if (modal || !onStage || event.isComposing || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
      else if (event.key === 'Enter' && !target?.closest?.('.vnext-pixel-selection-bar')) {
        event.preventDefault(); event.stopImmediatePropagation(); applyPaste()
      }
      return
    }
    if (gesture.tool === 'text') {
      const draft = gesture
      if (event.isComposing || draft.composing || event.keyCode === 229 || draft.submitting) return
      const command = (event.metaKey || event.ctrlKey) && !event.altKey, key = event.key?.toLowerCase()
      // Text fields keep their own native undo; elsewhere ⌘/Ctrl+Z steps back through this draft's changes.
      const target = event.target
      const typing = Boolean(target?.closest?.('textarea, input:not([type]), input[type="text"], input[type="number"], input[type="search"], [contenteditable="true"]'))
      if (command && (key === 'z' || key === 'y') && !typing) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (!event.repeat) undoTextDraft(draft, key === 'y' || event.shiftKey)
        return
      }
      // Esc / ⌘Enter place the text only from the Text panel, the canvas or the tool rail; other fields keep their keys.
      const placing = ['BODY', 'HTML'].includes(target?.tagName) || Boolean(target?.closest?.('#vnext-text-props, .vnext-pixel-text-input'))
        || (!typing && Boolean(target?.closest?.('#vnext-canvas-stage, .vnext-tools, .vnext-color-sidebar')))
      if (placing && (event.key === 'Escape' || (command && event.key === 'Enter'))) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (!event.repeat && placeTextDraft(draft)) focusCanvas() // Esc keeps the text (as pixels); Discard removes it
      }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
    else if (event.code === 'Space') { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
  paintPanel = bindPaintControls({ root, initialColor: color, onColor: paintColor,
    onBrush: next => { brush = next; refresh() }, isBusy: busyExceptDraft,
    canCapture: () => { const s = selectionOn(view.selectedId); return canEdit() && Boolean(s && s.rect.w <= 64 && s.rect.h <= 64) },
    onCapture: () => selectionAction('capture-brush') })
  palettePanel = bindPaletteControls({ root, session, getColor: () => color.slice(), setColor: paintColor, isBusy: busyExceptDraft, isWriteBusy: busy, status,
    writeBusyMessage: () => (textDraftOpen() ? 'Place or discard the text first, then edit palette colors.' : busyMessage('Finish the current edit, then edit palette colors.')) })
  bindTextPanel()
  // Another tool, a project change or a mode switch first places an open text draft (false: it must stay open).
  session.refreshMotionChrome = () => { renderSelection(); renderTextOutline(); placeCanvasText(textDraft()); brushCursor.refresh() }
  session.finishTextDraft = () => (textDraftOpen() ? placeTextDraft(textDraft()) : undefined)
  session.textDraftOpen = textDraftOpen
  session.textDraftCanvasId = () => (textDraftOpen() ? textDraft().canvasId : null)
  paintColor(color); refresh()
  return { refresh, cancel }
}

// Selection/paste bar position in stage pixels. Prefer outside the image (below, then above), then
// beside the selection, never over the selection or the canvas's own floating controls (`avoid`).
// If the selection fills the view, use the stage edge that hides the fewest selected pixels, then controls.
export function placeSelectionBar({ host, bar, image, selection, avoid = [], margin = 8, gap = 8 }) {
  const maxX = host.width - bar.width - margin, maxY = host.height - bar.height - margin
  const clampX = x => Math.max(margin, Math.min(x, maxX)), clampY = y => Math.max(margin, Math.min(y, maxY))
  const fits = (x, y) => x >= margin - 0.5 && y >= margin - 0.5 && x <= maxX + 0.5 && y <= maxY + 0.5
  const area = (x, y, r) => Math.max(0, Math.min(x + bar.width, r.right) - Math.max(x, r.left))
    * Math.max(0, Math.min(y + bar.height, r.bottom) - Math.max(y, r.top))
  const blocked = (x, y) => avoid.reduce((sum, r) => sum + area(x, y, r), 0)
  const x = clampX(selection.left), y = clampY(selection.top)
  // Each row is tried left-aligned with the selection first, then right-aligned, then at either stage edge.
  const xs = [selection.left, selection.right - bar.width, margin, maxX].map(clampX)
  const ys = [selection.top, selection.bottom - bar.height].map(clampY)
  const preferred = []
  for (const top of [image.bottom + gap, image.top - bar.height - gap, selection.bottom + gap, selection.top - bar.height - gap]) {
    for (const left of xs) preferred.push([left, top])
  }
  for (const left of [selection.right + gap, selection.left - bar.width - gap]) for (const top of ys) preferred.push([left, top])
  for (const [left, top] of preferred) if (fits(left, top) && !area(left, top, selection) && !blocked(left, top)) return { left, top }
  // No preferred spot: scan the stage on a coarse grid. Rank by selected pixels hidden, then controls
  // covered, then distance from the selection, then lower on screen (the bottom edge wins ties).
  const distance = (left, top) => Math.max(0, selection.left - (left + bar.width), left - selection.right)
    + Math.max(0, selection.top - (top + bar.height), top - selection.bottom)
  const lefts = [], tops = [], step = 16
  for (let v = margin; v < maxX; v += step) lefts.push(v)
  for (let v = margin; v < maxY; v += step) tops.push(v)
  lefts.push(clampX(maxX), x); tops.push(clampY(maxY), y)
  // Edge-aligned spots catch free bands narrower than the grid step (e.g. between two controls).
  for (const r of [selection, ...avoid]) {
    lefts.push(clampX(r.right), clampX(r.left - bar.width))
    tops.push(clampY(r.bottom), clampY(r.top - bar.height))
  }
  const lower = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false }
  let best = { left: x, top: y }, bestCost = null
  for (const top of tops) for (const left of lefts) {
    const cost = [area(left, top, selection), blocked(left, top), distance(left, top), -top]
    if (!bestCost || lower(cost, bestCost)) { best = { left, top }; bestCost = cost }
  }
  return best
}
