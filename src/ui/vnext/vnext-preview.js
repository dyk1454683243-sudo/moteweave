import { bindPixelProcessing } from './vnext-pixel-processing.js'
// VIS-02 visual preview · Figma 1604:5041 + HOME-TIMELINE-LINK-COPIES-2026-09-17-r2.
// Sample frames, colors, and skills are design samples, not project data,
// until a real editor project is opened. GEN-01/GEN-02 stay page-only drafts.
// P2-04 binds project/canvas operations. P2-06 text discussion delegates to the bounded Grok connector.

import {
  VNEXT_PROJECT_COPY,
  VNEXT_PROJECT_V0,
  compareLayoutConflict,
  createVnextProjectClient,
  formatLastSaved,
  projectListViewModel,
  createOperationId,
  VNEXT_EDITOR_API_PREFIX,
  sha256Hex,
  shouldProtectLeave,
  createFrameCoalescer,
} from './vnext-project-client.js'
import {
  createVnextCanvasView,
  locatorHitTest,
  locatorMapModel,
  locatorToWorld,
  zoomPercentLabel, VNEXT_PIXEL_GRID_MIN_ZOOM, VNEXT_CHECKER_SQUARES, VNEXT_CHECKER_SQUARE_DEFAULT } from './vnext-canvas-view.js'
import { bindVnextGenerationSession, renderVnextToast } from './vnext-generation-view.js'
import { WORKING_PIXELS_MAX_BYTES, createPixelCopyOperation, diffPixelRect, pixelCopyPosition, pixelCopySource, scopedPixelRequest, splitPixelRectStrips } from './vnext-pixel-copy.js'
import { GENERAL_SEQUENCE_MAX_FRAMES, SEQUENCE_EXPANDED_LIMIT_MESSAGE, SEQUENCE_FRAME_LIMIT_MESSAGE, assertSequencePreviewBudget, bitMaskHas, classifySequenceImage, encodeGeneralSequenceBody, maskDelta, maskSelectionFromBitMasks, packBitMask, partitionSequenceSourceBatches, prepareSequenceSourceHandles, readSequenceHandleBatch, readSequenceSources, sequenceDisplayScale, toggleBitMask } from '../../editor-project/generalSequenceBody.js'
import { staticImagePosition } from './vnext-static-image.js'
import { adoptSavedProject, olderThanShown } from './vnext-saved-project.js'
import { selectedCanvasPng } from './vnext-canvas-download.js'
import { bindExportPanel } from './vnext-export-panel.js'
import { bindSubscriptionSheet, createSubscriptionSheetClient } from './vnext-subscription-sheet.js'
import { createVnextGenerationClient } from './vnext-generation-client.js'
import { bindManualPixelTools, pixelWriteReceipt } from './vnext-manual-pixels.js'
import { bindTooltips } from './vnext-tooltips.js'
import { isBlankSpriteDocument, isEditablePixelDocument, isGeneralSequenceSpriteDocument } from '../../editor-project/pixelDocumentOrigin.js'
import { applicationPreset } from '../../editor-project/composerCapabilities.js'
import { isEmptyNativeDrawingTarget } from './vnext-pixel-drawing.js'
import { compositePixelFrame, compositePixelBuffers, inspectCanvasResizeImpact, computeCanvasContentBounds, anchorCanvasOffsets } from '../../editor-project/pixelStructure.js'
import { bindDocumentTimeline } from './vnext-document-timeline.js'
import { bindOnionSkin } from './vnext-onion-skin.js'
import { bindExternalBridge, externalPixelLink, readExternalPixels } from './vnext-external-pixels.js'

export const VNEXT_IMPORT_PNG_MAX_BYTES = 32 * 1024 * 1024
const CANVAS_IMPORT_PROJECT_REQUIRED = 'Create or open a project, then drop the image again.'

const IMPORT_RELOAD_COPY = Object.freeze({
  title: 'Imported, but the canvas did not refresh',
  body: 'The file is already saved. Reload only fetches the canvas and does not import again.',
  primary: 'Reload',
  status: 'Imported, but the canvas did not refresh. Reload does not import again.',
})

export function canvasImportKind(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '')
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpeg'
  if (type) return null
  if (/\.png$/i.test(name)) return 'png'
  if (/\.jpe?g$/i.test(name)) return 'jpeg'
  return null
}

export function classifyCanvasDrop({ hasProject = false, files = [] } = {}) {
  const list = [...files]
  if (!hasProject) return { ok: false, reason: CANVAS_IMPORT_PROJECT_REQUIRED }
  if (!list.length) return { ok: false, reason: 'Drop a local PNG or JPEG file, not an image link.' }
  if (list.length !== 1) return { ok: false, reason: 'Drop one PNG or JPEG file.' }
  const file = list[0]
  const kind = canvasImportKind(file)
  if (!kind) return { ok: false, reason: 'Only PNG or JPEG files can be dropped onto the canvas.' }
  return { ok: true, file, kind }
}

export function canvasForImport({ beforeIds = [], project = null, documentId = '' } = {}) {
  const canvases = Object.values(project?.canvases || {})
  if (documentId) {
    const match = canvases.find((item) => item.document_id === documentId)
    if (match) return match
  }
  const before = new Set(beforeIds)
  const added = canvases.filter((item) => item?.id && !before.has(item.id))
  return added.length === 1 ? added[0] : null
}

const SAMPLE_FRAMES = 12
const SAMPLE_HEAD_FRAME = 3
const SAMPLE_DURATION_MS = '125'

// Cel occupancy from the current 1824:5516 instance (Code Connect + render).
// Details 01–03 filled; Sprite all 12 (03 selected); Shadow all 12 filled.
const SAMPLE_LAYERS = [
  { name: 'Details', filled: (frame) => frame <= 3, asset: 'cel-content.svg' },
  { name: 'Sprite', filled: () => true, asset: 'cel-content.svg', selectedFrame: 3, selectedAsset: 'cel-row-selected.svg' },
  { name: 'Shadow', filled: () => true, asset: 'cel-content.svg' },
]
const BLANK_CEL = 'cel-blank.svg'

export const VNEXT_REFERENCE_MAX_BYTES = 2 * 1024 * 1024
export const VNEXT_REFERENCE_TOTAL_MAX_BYTES = 3 * 1024 * 1024
const VNEXT_REFERENCE_TYPES = Object.freeze(new Set(['image/png', 'image/webp', 'image/jpeg']))
const VNEXT_REFERENCE_NAME = /\.(?:png|webp|jpe?g)$/i
export const VNEXT_REFERENCE_ERRORS = Object.freeze({
  reference_required: 'Choose a PNG, WebP, or JPEG image.',
  reference_size_invalid: 'Each reference image must be 2 MiB or smaller.',
  reference_total_size_invalid: 'Character and palette references together must be 3 MiB or smaller.',
  reference_type_invalid: 'Reference image must be PNG, WebP, or JPEG.',
  reference_read_failed: 'Could not read the reference image.',
  reference_decode_failed: 'Could not decode the reference image.',
})

function referenceMimeType(file) {
  const type = String(file?.type ?? '').toLowerCase()
  const name = String(file?.name ?? '')
  if (VNEXT_REFERENCE_TYPES.has(type)) return type
  if (name.toLowerCase().endsWith('.webp')) return 'image/webp'
  if (name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

function decodeFailedError() {
  const error = new Error(VNEXT_REFERENCE_ERRORS.reference_decode_failed)
  error.code = 'reference_decode_failed'
  return error
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

export function decodeVnextReferenceBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (data.byteLength >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const type = String.fromCharCode(data[12], data[13], data[14], data[15])
    if (type !== 'IHDR') throw decodeFailedError()
    const width = readU32(data, 16)
    const height = readU32(data, 20)
    if (!(width > 0 && height > 0)) throw decodeFailedError()
    let offset = 8
    let hasIdat = false
    let hasIend = false
    while (offset + 12 <= data.byteLength) {
      const length = readU32(data, offset)
      const chunk = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])
      if (length > data.byteLength) break
      if (chunk === 'IDAT') hasIdat = true
      if (chunk === 'IEND') {
        hasIend = true
        break
      }
      offset += 12 + length
    }
    if (!hasIdat || !hasIend) throw decodeFailedError()
    return { width, height }
  }
  if (data.byteLength >= 12 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.byteLength) {
      if (data[offset] !== 0xff) break
      const marker = data[offset + 1]
      const size = (data[offset + 2] << 8) | data[offset + 3]
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = (data[offset + 5] << 8) | data[offset + 6]
        const width = (data[offset + 7] << 8) | data[offset + 8]
        if (!(width > 0 && height > 0)) throw decodeFailedError()
        return { width, height }
      }
      if (size < 2) break
      offset += 2 + size
    }
    throw decodeFailedError()
  }
  if (data.byteLength >= 30 && String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...data.slice(12, 16))
    if (kind === 'VP8X') {
      const width = 1 + data[24] + (data[25] << 8) + (data[26] << 16)
      const height = 1 + data[27] + (data[28] << 8) + (data[29] << 16)
      if (!(width > 0 && height > 0)) throw decodeFailedError()
      return { width, height }
    }
    throw decodeFailedError()
  }
  throw decodeFailedError()
}

function decodeWithHtmlImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const finish = (error, size) => {
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      if (error) reject(error)
      else resolve(size)
    }
    image.onload = () => {
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        finish(decodeFailedError())
        return
      }
      finish(null, { width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => finish(decodeFailedError())
    image.src = objectUrl
  })
}

export async function decodeVnextReferenceImage(file, objectUrl, hooks = {}) {
  if (typeof hooks.decodeImage === 'function') return hooks.decodeImage(file, objectUrl)
  if (typeof hooks.Image === 'function' || typeof Image === 'function') {
    return decodeWithHtmlImage(objectUrl)
  }
  if (typeof createImageBitmap === 'function' && file) {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    if (!(size.width > 0 && size.height > 0)) throw decodeFailedError()
    return size
  }
  const bytes = file?.arrayBuffer ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()
  return decodeVnextReferenceBytes(bytes)
}

export function createVnextReferenceDraft(hooks = {}) {
  const createObjectURL = hooks.createObjectURL || ((blob) => globalThis.URL?.createObjectURL?.(blob) || '')
  const revokeObjectURL = hooks.revokeObjectURL || ((url) => {
    if (url && globalThis.URL?.revokeObjectURL) globalThis.URL.revokeObjectURL(url)
  })
  let epoch = 0
  const state = {
    prompt: '',
    reference: null,
    error: '',
  }

  function revokeCandidate(url) {
    if (!url || url === state.reference?.objectUrl) return
    revokeObjectURL(url)
  }

  async function applyFile(file) {
    const token = ++epoch
    if (!file) {
      if (token === epoch) state.error = ''
      return { ok: true, cancelled: true, token }
    }
    const checked = validateVnextReferenceFile(file)
    if (!checked.ok) {
      if (token !== epoch) return { stale: true, token }
      state.error = checked.message
      return { ok: false, kept: state.reference, token }
    }
    let objectUrl = ''
    try {
      objectUrl = createObjectURL(file)
      if (!objectUrl) throw decodeFailedError()
      const decoded = await decodeVnextReferenceImage(file, objectUrl, hooks)
      if (token !== epoch) {
        revokeCandidate(objectUrl)
        return { stale: true, token }
      }
      if (!(decoded?.width > 0 && decoded?.height > 0)) throw decodeFailedError()
      const previous = state.reference
      state.reference = {
        name: String(file.name || 'reference.png'),
        mimeType: referenceMimeType(file),
        size: Number(file.size) || 0,
        objectUrl,
        width: decoded.width,
        height: decoded.height,
      }
      state.error = ''
      if (previous?.objectUrl && previous.objectUrl !== objectUrl) revokeObjectURL(previous.objectUrl)
      return { ok: true, token, reference: state.reference }
    } catch (error) {
      revokeCandidate(objectUrl)
      if (token !== epoch) return { stale: true, token }
      const code = error?.code
      state.error = code && VNEXT_REFERENCE_ERRORS[code] ? VNEXT_REFERENCE_ERRORS[code] : (error?.message || VNEXT_REFERENCE_ERRORS.reference_decode_failed)
      return { ok: false, kept: state.reference, token }
    }
  }

  function clear() {
    epoch += 1
    const previous = state.reference
    state.reference = null
    state.error = ''
    if (previous?.objectUrl) revokeObjectURL(previous.objectUrl)
    return { token: epoch }
  }

  return {
    state,
    applyFile,
    clear,
    getEpoch: () => epoch,
  }
}

const referenceDraft = createVnextReferenceDraft()
const pageDraft = referenceDraft.state

function el(name, attrs = {}, children = []) {
  const node = document.createElement(name)
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value === true ? '' : String(value))
  })
  children.forEach((child) => node.append(child))
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function svgUse(assetName, attrs = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') svg.setAttribute('class', value)
    else svg.setAttribute(key, String(value))
  })
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', `#vnext-${assetName.replace(/\.svg$/, '')}`)
  svg.append(use)
  return svg
}

function celImage(asset, selected = false) {
  return svgUse(asset, { width: selected ? 28 : 24, height: selected ? 28 : 24 })
}

export function validateVnextReferenceFile(file, { otherSize = 0 } = {}) {
  if (!file) return { ok: false, code: 'reference_required', message: VNEXT_REFERENCE_ERRORS.reference_required }
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > VNEXT_REFERENCE_MAX_BYTES) {
    return { ok: false, code: 'reference_size_invalid', message: VNEXT_REFERENCE_ERRORS.reference_size_invalid }
  }
  const peer = Number(otherSize) || 0
  if (size + peer > VNEXT_REFERENCE_TOTAL_MAX_BYTES) {
    return { ok: false, code: 'reference_total_size_invalid', message: VNEXT_REFERENCE_ERRORS.reference_total_size_invalid }
  }
  const type = String(file.type ?? '').toLowerCase()
  const name = String(file.name ?? '')
  if (!(VNEXT_REFERENCE_TYPES.has(type) || (!type && VNEXT_REFERENCE_NAME.test(name)))) {
    return { ok: false, code: 'reference_type_invalid', message: VNEXT_REFERENCE_ERRORS.reference_type_invalid }
  }
  return { ok: true, code: '', message: '' }
}

export async function readVnextReferenceFile(file, options = {}) {
  const checked = validateVnextReferenceFile(file, options)
  if (!checked.ok) {
    const error = new Error(checked.message)
    error.code = checked.code
    throw error
  }
  let objectUrl = ''
  try {
    objectUrl = globalThis.URL?.createObjectURL?.(file) || ''
    const decoded = await decodeVnextReferenceImage(file, objectUrl, options)
    return {
      name: String(file.name || 'reference.png'),
      mimeType: referenceMimeType(file),
      size: Number(file.size) || 0,
      objectUrl,
      width: decoded.width,
      height: decoded.height,
    }
  } catch (error) {
    if (objectUrl && globalThis.URL?.revokeObjectURL) globalThis.URL.revokeObjectURL(objectUrl)
    if (error?.code) throw error
    const failed = new Error(VNEXT_REFERENCE_ERRORS.reference_decode_failed)
    failed.code = 'reference_decode_failed'
    throw failed
  }
}

function renderFrames(root) {
  for (let frame = 1; frame <= SAMPLE_FRAMES; frame += 1) {
    const isHead = frame === SAMPLE_HEAD_FRAME
    const col = el('div', {
      className: `vnext-frame-col${isHead ? ' is-head' : ''}`,
      'data-frame': frame,
    }, [
      el('div', { className: 'vnext-frame-index', text: String(frame).padStart(2, '0') }),
    ])
    SAMPLE_LAYERS.forEach((layer) => {
      const filled = layer.filled(frame)
      const selected = layer.selectedFrame === frame
      const asset = !filled ? BLANK_CEL : selected ? layer.selectedAsset : layer.asset
      col.append(el('div', {
        className: `vnext-cel${filled ? ' is-filled' : ' is-blank'}${selected ? ' is-selected' : ''}`,
        title: 'Sample cel · not project data',
        'data-layer': layer.name,
      }, [celImage(asset, selected)]))
    })
    col.append(el('div', { className: 'vnext-frame-duration', text: SAMPLE_DURATION_MS }))
    root.append(col)
  }
  root.append(el('div', {
    className: 'vnext-add-blank-col',
    'data-figma': 'I1824:5516;1990:599',
    'data-capability': 'TIME-05',
    'data-capability-status': 'pending',
  }, [
    el('button', {
      type: 'button',
      className: 'vnext-add-blank',
      'data-figma': 'I1824:5516;1990:600',
      'data-capability': 'TIME-05',
      'data-capability-status': 'pending',
      disabled: true,
      title: 'Add a blank frame to the selected layer · real add-frame stays in protected P2',
      'aria-label': 'Add blank frame to selected layer',
    }, [svgUse('icon-plus-16', { className: 'vnext-icon is-16' })]),
  ]))
}

function setExpanded(selector, expanded) {
  document.querySelectorAll(selector).forEach((node) => {
    node.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  })
}

function placeSkillPop() {
  const pop = document.querySelector('.vnext-skill-pop')
  const composer = document.querySelector('.vnext-composer')
  const board = document.querySelector('.vnext-workbench')
  const btn = document.querySelector('[data-figma="I1824:5723;1819:5367"]')
  if (!pop || !board) return
  const boardBox = board.getBoundingClientRect()
  const anchor = (btn || composer)?.getBoundingClientRect()
  if (!anchor) return
  const popW = pop.offsetWidth || 299
  const popH = pop.offsetHeight || 276
  const gap = 8
  let left = anchor.left - boardBox.left + anchor.width / 2 - popW / 2
  left = Math.min(Math.max(12, left), Math.max(12, boardBox.width - popW - 12))
  let top = anchor.top - boardBox.top - popH - gap
  if (top < 12) top = anchor.bottom - boardBox.top + gap
  pop.style.left = `${Math.round(left)}px`
  pop.style.top = `${Math.round(top)}px`
  pop.style.bottom = 'auto'
}

function toggle(name) {
  const skill = document.querySelector('.vnext-skill-pop')
  const preview = document.querySelector('.vnext-preview')
  switch (name) {
    case 'skill':
      skill.hidden = !skill.hidden
      setExpanded('[data-vnext-toggle="skill"][data-capability~="SKILL-01"]', !skill.hidden)
      if (!skill.hidden) requestAnimationFrame(placeSkillPop)
      break
    case 'preview':
      preview.hidden = !preview.hidden
      setExpanded('[data-figma="1820:5408"]', !preview.hidden)
      break
    case 'preview-collapse':
      preview.classList.toggle('is-collapsed')
      break
    default:
      break
  }
}

let closeOpenViewSettings = null

function dismissOpenViewSettings() {
  if (closeOpenViewSettings?.()) return true
  const panel = document.querySelector?.('#vnext-view-settings')
  const opener = document.querySelector?.('#vnext-view-settings-btn')
  if (!panel || panel.hidden) return false
  panel.hidden = true
  opener?.setAttribute?.('aria-expanded', 'false')
  opener?.focus?.()
  return true
}

function closeTransientOverlays() {
  const skill = document.querySelector('.vnext-skill-pop')
  const onion = document.querySelector('.vnext-onion-pop')
  const menu = document.querySelector('#vnext-project-menu')
  dismissOpenViewSettings()
  if (skill && !skill.hidden) {
    skill.hidden = true
    setExpanded('[data-vnext-toggle="skill"][data-capability~="SKILL-01"]', false)
  }
  if (onion && !onion.hidden) {
    onion.hidden = true
    setExpanded('[data-vnext-toggle="onion"]', false)
  }
  if (menu && !menu.hidden) {
    menu.hidden = true
    const btn = document.querySelector('#vnext-project-btn')
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }
}

function isDraftInput(target) {
  return Boolean(target.closest('textarea, input, .vnext-prompt, .vnext-ref-image, .vnext-ref-clear, .vnext-workflow-job'))
}

function isViewSettingsControl(target) {
  return Boolean(target?.closest?.('#vnext-view-settings, #vnext-view-settings-btn, #vnext-grid'))
}

function editableHost(node) {
  if (!node) return false
  if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable) return true
  if (node.closest?.('input, textarea, select')) return true
  const host = node.closest?.('[contenteditable]')
  const attr = host?.getAttribute?.('contenteditable')
  return attr === '' || attr === 'true' || attr === 'plaintext-only'
}

function nativeTextUndoTarget(target) {
  const active = target?.ownerDocument?.activeElement || globalThis.document?.activeElement
  return editableHost(target) || editableHost(active)
}

function isBoundProjectChrome(target) {
  return Boolean(target.closest([
    '#vnext-project-btn',
    '#vnext-project-menu',
    '#vnext-import-input',
    '#vnext-open-dialog',
    '#vnext-blank-dialog',
    '#vnext-canvas-size-dialog',
    '#vnext-confirm-dialog',
    '#vnext-canvas-stage',
    '#vnext-zoom',
    '#vnext-tool-move',
    '#vnext-workflow',
    '.vnext-pane-resizer',
    '[data-project-action]',
  ].join(', ')))
}

function blockProductActions(event) {
  const toggleNode = event.target.closest('[data-vnext-toggle]')
  if (toggleNode) {
    event.preventDefault()
    toggle(toggleNode.dataset.vnextToggle)
    return
  }
  if (isDraftInput(event.target) || isBoundProjectChrome(event.target)) return
  if (event.target.closest('button, a, [data-capability]')) {
    event.preventDefault()
  }
}

export function renderReferenceSlot(root) {
  const empty = root.querySelector('.vnext-ref-empty')
  const filled = root.querySelector('.vnext-ref-filled')
  const preview = root.querySelector('#vnext-ref-preview')
  const name = root.querySelector('#vnext-ref-name')
  const clear = root.querySelector('.vnext-ref-clear')
  const error = root.querySelector('#vnext-ref-error')
  const slot = root.querySelector('.vnext-ref-image')
  const current = pageDraft.reference
  if (current) {
    empty.hidden = true
    filled.hidden = false
    clear.hidden = false
    preview.src = current.objectUrl
    preview.alt = current.name
    name.textContent = current.name
    slot.classList.add('is-filled')
    slot.title = `${current.name} · replace or clear. Page draft only.`
  } else {
    empty.hidden = false
    filled.hidden = true
    clear.hidden = true
    preview.removeAttribute('src')
    preview.alt = ''
    name.textContent = ''
    slot.classList.remove('is-filled')
    slot.title = VNEXT_REFERENCE_ERRORS.reference_required
  }
  if (pageDraft.error) {
    error.hidden = false
    error.textContent = pageDraft.error
  } else {
    error.hidden = true
    error.textContent = ''
  }
}

function bindPromptDraft(root) {
  const input = root.querySelector('#vnext-prompt-input')
  if (!input) return
  input.value = pageDraft.prompt
  input.addEventListener('input', () => {
    pageDraft.prompt = input.value
    root.dispatchEvent(new Event('vnext-draft-change'))
  })
}

export function applyModuleReferenceFile(file) {
  return referenceDraft.applyFile(file)
}

export function referenceDraftName() {
  return pageDraft.reference?.name || ''
}

export async function applyReferenceDraftFile(root, file, { applyFile } = {}) {
  const slot = root?.querySelector?.('.vnext-ref-image')
  const run = applyFile || ((next) => referenceDraft.applyFile(next))
  await run(file)
  if (slot?.dataset.canvasSelection === '1') return 'selection'
  renderReferenceSlot(root)
  return 'draft'
}

function bindReferenceDraft(root) {
  const slot = root.querySelector('.vnext-ref-image')
  const input = root.querySelector('#vnext-ref-input')
  const clear = root.querySelector('.vnext-ref-clear')
  if (!slot || !input) return
  renderReferenceSlot(root)
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    await applyReferenceDraftFile(root, file)
  })
  const stopLabelActivation = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  clear?.addEventListener('click', (event) => {
    stopLabelActivation(event)
    if (slot.dataset.canvasSelection === '1') return
    referenceDraft.clear()
    renderReferenceSlot(root)
    root.dispatchEvent(new Event('vnext-draft-change'))
  })
  clear?.addEventListener('pointerdown', stopLabelActivation)
  clear?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.stopPropagation()
  })
}

function bindSkillReference(root) {
  const pop = root.querySelector('.vnext-skill-pop')
  const row = root.querySelector('#vnext-skill-row')
  const clear = root.querySelector('.vnext-skill-tag-action')
  if (!pop || !row) return
  // The markup provides layout only; preset names and descriptions come from the shared catalog.
  pop.querySelectorAll('.vnext-skill-item[data-skill-id]').forEach((node) => {
    const preset = applicationPreset(node.dataset.skillId)
    if (!preset) return
    const name = node.querySelector('.vnext-skill-name')
    if (name) name.textContent = preset.name
    node.title = `${preset.name} · ${preset.description} Thumbnail is a template reference.`
  })

  function closeSkillPop() {
    pop.hidden = true
    setExpanded('[data-vnext-toggle="skill"][data-capability~="SKILL-01"]', false)
  }

  function selectSkill(item) {
    const preset = applicationPreset(item?.dataset.skillId)
    if (!preset) return false
    pop.querySelectorAll('.vnext-skill-item').forEach((node) => {
      node.classList.toggle('is-selected', node === item)
      const state = node.querySelector('.vnext-skill-state')
      if (!state) return
      if (node === item) state.textContent = 'Selected'
      else if (node.dataset.skillId) state.textContent = 'Ready'
    })
    const label = root.querySelector('.vnext-skill-tag-label')
    const name = item.querySelector('.vnext-skill-name')
    if (name) name.textContent = preset.name
    if (label) label.textContent = preset.name
    row.hidden = false
    closeSkillPop()
    root.dispatchEvent(new Event('vnext-draft-change'))
    return true
  }

  pop.addEventListener('click', (event) => {
    if (event.target.closest('[data-capability="SKILL-05"]')) return
    const item = event.target.closest('[data-skill-id]')
    if (!item) return
    event.preventDefault()
    selectSkill(item)
  })
  clear?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    row.hidden = true
    pop.querySelectorAll('.vnext-skill-item[data-skill-id]').forEach((node) => {
      node.classList.remove('is-selected')
      const state = node.querySelector('.vnext-skill-state')
      if (state) state.textContent = 'Ready'
    })
    root.dispatchEvent(new Event('vnext-draft-change'))
  })
  return { select: id => {
    if (!applicationPreset(id)) return false
    const item = [...pop.querySelectorAll('[data-skill-id]')].find(node => node.dataset.skillId === id)
    return item ? selectSkill(item) : false
  } }
}

function bindOverlayDismiss(root) {
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (dismissOpenViewSettings()) {
      event.preventDefault()
      event.vnextViewSettingsClosed = true
      event.stopImmediatePropagation?.()
      return
    }
    closeTransientOverlays()
  })
  root.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.vnext-skill-pop, .vnext-timeline-menu, .vnext-onion-pop, #vnext-view-settings, #vnext-view-settings-btn, [data-vnext-toggle], #vnext-project-menu, #vnext-project-btn, .vnext-dialog-root, .vnext-composer, textarea, input')) return
    closeTransientOverlays()
  })
}

const locatorPreviewUrls = new WeakMap()

function locatorPreviewUrl(canvas) {
  if (canvas?.previewUrl) return canvas.previewUrl
  const node = canvas?.preview
  if (!node || typeof node.toDataURL !== 'function') return ''
  if (locatorPreviewUrls.has(node)) return locatorPreviewUrls.get(node)
  let url = ''
  try {
    url = node.toDataURL('image/png')
  } catch {
    url = ''
  }
  locatorPreviewUrls.set(node, url)
  return url
}

function rgbaBytesToCanvas(bytes, width, height) {
  const w = Number(width)
  const h = Number(height)
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (!(w > 0) || !(h > 0) || source.byteLength !== w * h * 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(source), w, h), 0, 0)
  return canvas
}

function firstCelBlock(manifest) {
  const layerId = manifest.layer_order?.[0]
  const frameId = manifest.frame_order?.[0]
  if (!layerId || !frameId) return null
  return Object.values(manifest.cels || {}).find((cel) => cel.frame_id === frameId && cel.layer_id === layerId) || null
}

export function timelineSummary(manifest, { sample = false } = {}) {
  if (sample) {
    return {
      current: String(SAMPLE_HEAD_FRAME).padStart(2, '0'),
      total: String(SAMPLE_FRAMES).padStart(2, '0'),
      durationLabel: '8 fps',
      layerCount: SAMPLE_LAYERS.length,
      frameCount: SAMPLE_FRAMES,
    }
  }
  const frames = Array.isArray(manifest?.frame_order) ? manifest.frame_order : []
  const layers = Array.isArray(manifest?.layer_order) ? manifest.layer_order : []
  const durations = frames
    .map((id) => Number(manifest?.frames?.[id]?.duration_ms))
    .filter((value) => Number.isFinite(value) && value > 0)
  let durationLabel = '—'
  if (durations.length > 0 && durations.every((value) => value === durations[0])) {
    const fps = 1000 / durations[0]
    if (Number.isFinite(fps) && fps > 0 && Math.abs(fps - Math.round(fps)) < 1e-6) {
      durationLabel = `${Math.round(fps)} fps`
    }
  }
  return {
    current: String(frames.length ? 1 : 0).padStart(2, '0'),
    total: String(frames.length).padStart(2, '0'),
    durationLabel,
    layerCount: layers.length,
    frameCount: frames.length,
  }
}

export function concurrentLayoutBlocked(session) {
  return Boolean(session?.pendingImport || session?.blankSubmitting || session?.confirmedImport
    || session?.nameEdit?.committing || session?.manualWrite || session?.manualGesture)
}

export function concurrentLayoutMessage(session) {
  if (session?.pendingImport || session?.blankSubmitting || session?.confirmedImport) return 'Import already in progress.'
  if (session?.nameEdit?.committing) return 'Saving name…'
  return 'Finish the current stroke or resolve its save before editing.'
}

export function projectPixelsUnchanged(previous, next) {
  if (!previous || !next || previous.id !== next.id) return false
  const before = previous.sprite_documents || {}
  const after = next.sprite_documents || {}
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const id of ids) {
    if ((before[id]?.working_revision ?? null) !== (after[id]?.working_revision ?? null)) return false
  }
  return true
}

export function beginPendingSave(session, positions) {
  if (!session || session.pendingSave) return null
  if (!Array.isArray(positions) || positions.length === 0) return null
  session.pendingSave = {
    positions: positions.map((item) => ({ canvas_id: item.canvas_id, x: item.x, y: item.y })),
  }
  return session.pendingSave
}

export async function loadProjectBundle(api, project, { makePreview, frameFor, familyFor } = {}) {
  const documents = new Map()
  const rendered = []
  const canvases = Object.values(project?.canvases || {})
  if (!canvases.length) return { project, documents, rendered }
  const docs = await api.listDocuments(project.id)
  for (const summary of docs) {
    const loaded = await api.getDocument(project.id, summary.document_id)
    documents.set(summary.document_id, loaded.document)
  }
  for (const canvas of canvases) {
    const manifest = documents.get(canvas.document_id)
    const size = manifest?.canvas || { w: 0, h: 0 }
    const cel = manifest ? firstCelBlock(manifest) : null
    let preview = null
    const frameId = frameFor?.(manifest) || manifest?.frame_order?.[0]
    const hasText = Boolean(manifest?.text_objects?.items?.some(item => item.frame_id === frameId))
    if (manifest && (hasText || manifest.layer_order?.length > 1 || manifest.frame_order?.length > 1 || manifest.layers?.[manifest.layer_order[0]]?.visible === false || (cel && !cel.block))) {
      const bytes = await readCompositeFrame(api, project.id, manifest, frameId, { familyFor })
      preview = makePreview ? makePreview({ bytes, width: size.w, height: size.h }) : null
    } else if (cel?.block) {
      const block = await api.getBlock(project.id, canvas.document_id, cel.block.sha256)
      try {
        preview = makePreview ? makePreview(block) : null
      } catch {
        preview = null
      }
    }
    rendered.push({
      id: canvas.id,
      document_id: canvas.document_id,
      x: canvas.x,
      y: canvas.y,
      width: size.w,
      height: size.h,
      name: canvas.display_name || manifest?.name || '',
      display_name: canvas.display_name || '',
      manifest_name: manifest?.name || '',
      preview,
    })
  }
  return { project, documents, rendered }
}

async function readCompositeFrame(api, projectId, manifest, frameId, { familyFor, requireFonts = false } = {}) {
  const { paintLayerText, rememberLayerPixels } = await import('./vnext-text-objects.js')
  const resolve = familyFor || (item => item.font.kind === 'generic' ? item.font.name : null)
  const bytes = await compositePixelFrame(manifest, frameId, async celBlock => {
    const block = await api.getBlock(projectId, manifest.document_id, celBlock.sha256)
    if (block.width !== celBlock.w || block.height !== celBlock.h || block.sha256 !== celBlock.sha256 || await sha256Hex(block.bytes) !== celBlock.sha256) throw new Error('Saved layer pixels could not be verified.')
    return block.bytes
  }, (rgba, layerId) => paintLayerText(rgba, manifest, frameId, layerId, resolve, { requireFonts }), layers => rememberLayerPixels(manifest, frameId, layers))
  return bytes
}

export async function applyLoadedProjectBundle({ token, isCurrent, load, commit }) {
  const bundle = await load()
  if (!isCurrent(token)) return { stale: true, committed: false, bundle }
  commit(bundle)
  return { stale: false, committed: true, bundle }
}

let projectSession = null

export function getVnextProjectSession() {
  return projectSession
}

export function bindVnextProjectSession(root = document, { client } = {}) {
  const api = client || createVnextProjectClient()
  const pixelBlocks = new Map()
  let pixelBlockBytes = 0
  function rememberPixelBlock(documentId, sha256, bytes, width, height) {
    if (!documentId || !sha256 || !(bytes instanceof Uint8Array) || !(width > 0) || !(height > 0)) return
    const key = `${documentId}:${sha256}`
    const previous = pixelBlocks.get(key)
    if (previous) { pixelBlockBytes -= previous.bytes.byteLength; pixelBlocks.delete(key) }
    pixelBlocks.set(key, { bytes, width, height })
    pixelBlockBytes += bytes.byteLength
    while (pixelBlockBytes > 64 * 1024 * 1024 && pixelBlocks.size) {
      const oldest = pixelBlocks.keys().next().value
      pixelBlockBytes -= pixelBlocks.get(oldest).bytes.byteLength
      pixelBlocks.delete(oldest)
    }
  }
  function cachedPixelBlock(documentId, sha256) {
    const key = `${documentId}:${sha256}`
    const hit = pixelBlocks.get(key)
    if (!hit) return null
    pixelBlocks.delete(key)
    pixelBlocks.set(key, hit)
    return hit
  }
  function retainLoadedPixelBlocks(documents) {
    const keep = new Set()
    for (const [id, manifest] of documents || []) {
      for (const cel of Object.values(manifest?.cels || {})) {
        if (cel.block?.sha256) keep.add(`${id}:${cel.block.sha256}`)
      }
    }
    for (const key of [...pixelBlocks.keys()]) {
      if (keep.has(key)) continue
      pixelBlockBytes -= pixelBlocks.get(key).bytes.byteLength
      pixelBlocks.delete(key)
    }
  }
  const fetchBlock = api.getBlock.bind(api)
  api.getBlock = async (projectId, documentId, sha256) => {
    const hit = cachedPixelBlock(documentId, sha256)
    if (hit) return { bytes: new Uint8Array(hit.bytes), width: hit.width, height: hit.height, sha256 }
    const block = await fetchBlock(projectId, documentId, sha256)
    rememberPixelBlock(documentId, block.sha256 || sha256, block.bytes, block.width, block.height)
    return block
  }
  const view = createVnextCanvasView({ zoom: 1, tool: 'move' })
  const session = {
    api,
    view,
    project: null,
    documents: new Map(),
    list: { status: 'idle', projects: [], omitted_count: 0, query: '', selectedId: null, error: null },
    pendingSave: null,
    pendingImport: false,
    nameEdit: null,
    activity: 0,
    loadGeneration: 0,
    boundProjectId: null,
    checkerSquare: VNEXT_CHECKER_SQUARE_DEFAULT,
    activeWrite: null,
    lastSaveSnapshot: null,
    lastError: null,
    saveReceipt: null,
    confirm: null,
    pendingLeave: null,
    pendingHistory: new Map(),
  }
  projectSession = session
  let manualTools = null
  let exportPanel = null

  const nodes = {
    name: root.querySelector('#vnext-project-name'),
    btn: root.querySelector('#vnext-project-btn'),
    menu: root.querySelector('#vnext-project-menu'),
    save: root.querySelector('#vnext-save-positions'),
    download: root.querySelector('[data-capability="FILE-01"]'),
    importInput: root.querySelector('#vnext-import-input'),
    sequenceRoot: root.querySelector('#vnext-sequence-dialog'),
    sequenceDialogCard: root.querySelector('#vnext-sequence-dialog .is-sequence'),
    sequenceFileRow: root.querySelector('#vnext-sequence-file-row'),
    sequenceFileLabel: root.querySelector('#vnext-sequence-file-label'),
    sequenceFileHint: root.querySelector('#vnext-sequence-file-hint'),
    sequenceMixedNotice: root.querySelector('#vnext-sequence-mixed-notice'),
    sequenceActions: root.querySelector('#vnext-sequence-actions'),
    sequenceCancel: root.querySelector('#vnext-sequence-cancel'),
    sequenceInput: root.querySelector('#vnext-sequence-input'),
    sequenceFrames: root.querySelector('#vnext-sequence-frames'),
    sequenceStatus: root.querySelector('#vnext-sequence-status'),
    sequenceError: root.querySelector('#vnext-sequence-error'),
    sequenceImport: root.querySelector('#vnext-sequence-import'),
    sequenceChoose: root.querySelector('#vnext-sequence-choose'),
    sequenceKeepAll: root.querySelector('#vnext-sequence-keep-all'),
    sequenceApplyAuto: root.querySelector('#vnext-sequence-apply-auto'),
    sequenceStop: root.querySelector('#vnext-sequence-stop'),
    sequenceBackground: root.querySelector('#vnext-general-background'),
    motionControls: root.querySelector('#vnext-motion-video-controls'),
    motionPlayer: root.querySelector('#vnext-motion-video-player'),
    motionStart: root.querySelector('#vnext-motion-start'),
    motionEnd: root.querySelector('#vnext-motion-end'),
    motionMode: root.querySelector('#vnext-motion-mode'),
    motionFpsWrap: root.querySelector('#vnext-motion-fps-wrap'),
    motionFps: root.querySelector('#vnext-motion-fps'),
    motionStrideWrap: root.querySelector('#vnext-motion-stride-wrap'),
    motionStride: root.querySelector('#vnext-motion-stride'),
    motionActionRow: root.querySelector('#vnext-motion-action-row'),
    motionPreviewBtn: root.querySelector('#vnext-motion-preview-btn'),
    motionPreviewState: root.querySelector('#vnext-motion-preview-state'),
    motionPreviewStage: root.querySelector('#vnext-motion-preview-stage'),
    motionPreviewCanvas: root.querySelector('#vnext-motion-preview-canvas'),
    motionPreviewMeta: root.querySelector('#vnext-motion-preview-meta'),
    blankButton: root.querySelector('#vnext-new-canvas'),
    duplicateCanvas: root.querySelector('#vnext-duplicate-canvas'),
    canvasSizeMenu: root.querySelector('#vnext-menu-canvas-size'),
    canvasSizeOpen: root.querySelector('#vnext-canvas-size-open'),
    canvasSizeRoot: root.querySelector('#vnext-canvas-size-dialog'),
    canvasSizeForm: root.querySelector('#vnext-canvas-size-form'),
    canvasSizeCurrent: root.querySelector('#vnext-canvas-size-current'),
    canvasSizeWidth: root.querySelector('#vnext-canvas-size-width'),
    canvasSizeHeight: root.querySelector('#vnext-canvas-size-height'),
    canvasCropOrigins: root.querySelector('#vnext-canvas-crop-origins'),
    canvasCropX: root.querySelector('#vnext-canvas-crop-x'),
    canvasCropY: root.querySelector('#vnext-canvas-crop-y'),
    canvasAnchorWrap: root.querySelector('#vnext-canvas-anchor-wrap'),
    canvasAnchorGrid: root.querySelector('#vnext-canvas-anchor-grid'),
    canvasUseSelection: root.querySelector('#vnext-canvas-use-selection'),
    canvasTrimBounds: root.querySelector('#vnext-canvas-trim-bounds'),
    canvasSizeWarning: root.querySelector('#vnext-canvas-size-warning'),
    canvasSizeError: root.querySelector('#vnext-canvas-size-error'),
    canvasSizeApply: root.querySelector('#vnext-canvas-size-apply'),
    subscription: root.querySelector('#vnext-subscription-sheet'),
    blankRoot: root.querySelector('#vnext-blank-dialog'),
    blankForm: root.querySelector('#vnext-blank-form'),
    blankName: root.querySelector('#vnext-blank-name'),
    blankWidth: root.querySelector('#vnext-blank-width'),
    blankHeight: root.querySelector('#vnext-blank-height'),
    blankError: root.querySelector('#vnext-blank-error'),
    openRoot: root.querySelector('#vnext-open-dialog'),
    search: root.querySelector('#vnext-project-search'),
    status: root.querySelector('#vnext-list-status'),
    rows: root.querySelector('#vnext-list-rows'),
    warning: root.querySelector('#vnext-list-warning'),
    warningTitle: root.querySelector('#vnext-list-warning-title'),
    warningBody: root.querySelector('#vnext-list-warning-body'),
    openConfirm: root.querySelector('#vnext-open-confirm'),
    clearSearch: root.querySelector('#vnext-list-clear'),
    confirmRoot: root.querySelector('#vnext-confirm-dialog'),
    confirmTitle: root.querySelector('#vnext-confirm-title'),
    confirmBody: root.querySelector('#vnext-confirm-body'),
    confirmDetails: root.querySelector('#vnext-confirm-details'),
    confirmPrimary: root.querySelector('#vnext-confirm-primary'),
    confirmSecondary: root.querySelector('#vnext-confirm-secondary'),
    stage: root.querySelector('#vnext-canvas-stage'),
    zoom: root.querySelector('#vnext-zoom'),
    move: root.querySelector('#vnext-tool-move'),
    grid: root.querySelector('#vnext-grid'),
    gridPending: root.querySelector('#vnext-grid-pending'),
    viewSettings: root.querySelector('#vnext-view-settings'),
    viewSettingsBtn: root.querySelector('#vnext-view-settings-btn'),
    checkerNote: root.querySelector('#vnext-checker-note'),
    checkerSizes: root.querySelector('#vnext-checker-sizes'),
    pixelGridSwitch: root.querySelector('#vnext-pixel-grid-switch'),
    pixelGridNote: root.querySelector('#vnext-pixel-grid-note'),
    toast: root.querySelector('#vnext-project-toast'),
    pageLabel: root.querySelector('[data-capability="PAGE-01"] span'),
    frames: root.querySelector('#vnext-frame-cols'),
    layerCol: root.querySelector('#vnext-layer-col'),
    playCurrent: root.querySelector('.vnext-play-current'),
    playTotal: root.querySelector('.vnext-play-total'),
    fpsLabel: root.querySelector('.vnext-playback-params-start .vnext-text-btn span'),
    documentScopeBar: root.querySelector('#vnext-document-scope-bar'),
    projectReferences: root.querySelector('#vnext-project-references'),
    referenceCount: root.querySelector('#vnext-reference-count'),
    referencePurpose: root.querySelector('#vnext-reference-purpose'),
    promoteFrameRef: root.querySelector('#vnext-promote-frame-ref'),
    promoteCelRef: root.querySelector('#vnext-promote-cel-ref'),
    recoverReference: root.querySelector('#vnext-recover-reference'),
    referenceStatus: root.querySelector('#vnext-reference-status'),
    referenceList: root.querySelector('#vnext-reference-list'),
  }

  const selectedReferencesByProject = new Map()
  const pendingReferenceByProject = new Map()
  const inFlightReferenceByProject = new Map()
  const referenceStatusByProject = new Map()
  let fallbackReferenceStatus = { text: '', error: false }

  function isReferenceBusy(projectId = session.project?.id) {
    return Boolean(projectId && inFlightReferenceByProject.has(projectId))
  }

  function currentPendingReference(projectId = session.project?.id) {
    return projectId ? (pendingReferenceByProject.get(projectId) || null) : null
  }

  function currentReferenceStatus(projectId = session.project?.id) {
    if (!projectId) return fallbackReferenceStatus
    return referenceStatusByProject.get(projectId) || { text: '', error: false }
  }

  function setReferenceStatus(text = '', { error = false, projectId = session.project?.id } = {}) {
    const next = { text: String(text || ''), error: Boolean(text) && Boolean(error) }
    if (projectId) referenceStatusByProject.set(projectId, next)
    else fallbackReferenceStatus = next
    if ((!projectId || session.project?.id === projectId) && nodes.referenceStatus) {
      nodes.referenceStatus.textContent = next.text
      nodes.referenceStatus.hidden = !next.text
      nodes.referenceStatus.classList.toggle('is-error', next.error)
    }
  }

  session.referencePending = (projectId = session.project?.id) => Boolean(
    currentPendingReference(projectId) || isReferenceBusy(projectId),
  )

  function activeProjectReferences() {
    const list = Array.isArray(session.project?.references) ? session.project.references : []
    return list.filter(ref => ref && ref.status === 'active' && typeof ref.id === 'string')
  }

  session.activeReferenceIds = () => {
    const projectId = session.project?.id
    if (!projectId) return []
    const activeSet = new Set(activeProjectReferences().map(ref => ref.id))
    const raw = selectedReferencesByProject.get(projectId) || []
    const filtered = raw.filter(id => activeSet.has(id)).slice(0, 8)
    if (filtered.length !== raw.length) selectedReferencesByProject.set(projectId, filtered)
    return filtered.slice()
  }

  session.setActiveReferenceIds = (ids) => {
    const projectId = session.project?.id
    if (!projectId) return []
    const activeSet = new Set(activeProjectReferences().map(ref => ref.id))
    const unique = []
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id === 'string' && activeSet.has(id) && !unique.includes(id) && unique.length < 8) {
        unique.push(id)
      }
    }
    selectedReferencesByProject.set(projectId, unique)
    renderChrome()
    notifyDraftChange()
    return unique.slice()
  }

  session.toggleActiveReference = (refId) => {
    const projectId = session.project?.id
    if (!projectId || typeof refId !== 'string') return false
    if (session.referencePending(projectId)) return false
    const activeSet = new Set(activeProjectReferences().map(ref => ref.id))
    if (!activeSet.has(refId)) return false
    const current = session.activeReferenceIds()
    if (current.includes(refId)) {
      selectedReferencesByProject.set(projectId, current.filter(id => id !== refId))
      if (!currentPendingReference(projectId)) setReferenceStatus('')
      renderChrome()
      notifyDraftChange()
      return false
    }
    if (current.length >= 8) {
      setReferenceStatus('Up to 8 references can be selected per turn.', { error: true })
      return false
    }
    selectedReferencesByProject.set(projectId, [...current, refId])
    if (!currentPendingReference(projectId)) setReferenceStatus('')
    renderChrome()
    notifyDraftChange()
    return true
  }

  async function executeReferenceOperation(op, { isRecovery = false } = {}) {
    if (inFlightReferenceByProject.has(op.projectId)) {
      return { ok: false, reason: 'busy', operationId: op.operationId }
    }
    inFlightReferenceByProject.set(op.projectId, op)
    renderChrome()
    try {
      const response = op.kind === 'promote'
        ? await api.promoteReference(op.projectId, op.payload)
        : await api.revokeReference(op.projectId, op.referenceId, op.payload)
      if (pendingReferenceByProject.get(op.projectId)?.operationId === op.operationId) {
        pendingReferenceByProject.delete(op.projectId)
      }
      const isCurrent = session.project?.id === op.projectId && api.openEpoch.isCurrent(op.openToken)
      if (!isCurrent) {
        return { ok: false, reason: 'stale', operationId: op.operationId }
      }
      if (response?.project) session.project = response.project
      if (op.kind === 'promote') {
        if (response?.reference?.id && response.reference.status === 'active') {
          const current = session.activeReferenceIds()
          if (!current.includes(response.reference.id) && current.length < 8) {
            selectedReferencesByProject.set(op.projectId, [...current, response.reference.id])
          }
        }
        const totalRecords = Array.isArray(session.project?.references) ? session.project.references.length : 0
        const msg = isRecovery
          ? `Confirmed “${response?.reference?.name || op.resolvedName}” in project references${totalRecords >= 64 ? ' (64/64 records used)' : ''}.`
          : `Saved “${response?.reference?.name || op.resolvedName}” to project references${totalRecords >= 64 ? ' (64/64 records used)' : ''}.`
        setReferenceStatus(msg, { projectId: op.projectId })
        setCanvasStatus(msg)
      } else {
        const current = selectedReferencesByProject.get(op.projectId) || []
        if (current.includes(op.referenceId)) {
          selectedReferencesByProject.set(op.projectId, current.filter(id => id !== op.referenceId))
        }
        const totalRecords = Array.isArray(session.project?.references) ? session.project.references.length : 0
        const msg = totalRecords >= 64
          ? 'Reference revoked. 64/64 reference records remain used (revoked references stay in project history and do not free slots).'
          : isRecovery
            ? 'Confirmed reference removal from project library.'
            : 'Reference removed from project library.'
        setReferenceStatus(msg, { projectId: op.projectId })
      }
      return {
        ok: true,
        recovered: isRecovery,
        reference: response?.reference || null,
        receipt: response?.receipt || null,
        operationId: op.operationId,
      }
    } catch (error) {
      if (error?.kind === 'unknown') {
        pendingReferenceByProject.set(op.projectId, op)
        const msg = op.kind === 'promote'
          ? `Saving “${op.resolvedName}” was interrupted before confirmation. Click Verify pending save to check or finish the same request.`
          : `Revoking “${op.resolvedName}” was interrupted before confirmation. Click Verify pending revoke to check or finish the same request.`
        setReferenceStatus(msg, { error: true, projectId: op.projectId })
        if (session.project?.id === op.projectId && api.openEpoch.isCurrent(op.openToken)) {
          setCanvasStatus(msg, { error: true })
        }
        return { ok: false, unknown: true, operationId: op.operationId, error }
      }
      if (pendingReferenceByProject.get(op.projectId)?.operationId === op.operationId) {
        pendingReferenceByProject.delete(op.projectId)
      }
      if (session.project?.id === op.projectId && api.openEpoch.isCurrent(op.openToken)) {
        const msg = error?.reason || error?.message || (op.kind === 'promote' ? 'Reference could not be saved.' : 'Reference could not be revoked.')
        setReferenceStatus(msg, { error: true, projectId: op.projectId })
        if (op.kind === 'promote') setCanvasStatus(msg, { error: true })
      }
      return { ok: false, unknown: false, operationId: op.operationId, error }
    } finally {
      if (inFlightReferenceByProject.get(op.projectId) === op) {
        inFlightReferenceByProject.delete(op.projectId)
      }
      renderChrome()
      notifyDraftChange()
    }
  }

  session.resolvePendingReference = async () => {
    const projectId = session.project?.id
    if (!projectId) return { ok: false, reason: 'no_project' }
    const pending = pendingReferenceByProject.get(projectId)
    if (!pending) return { ok: false, reason: 'none' }
    if (inFlightReferenceByProject.has(projectId)) {
      return { ok: false, reason: 'busy', operationId: pending.operationId }
    }
    pending.openToken = api.openEpoch.current
    return executeReferenceOperation(pending, { isRecovery: true })
  }

  session.promoteProjectReference = async ({ frameId = null, layerId = null, sourceKind = 'frame_composite', purpose = null, name = null } = {}) => {
    const projectId = session.project?.id
    const pending = currentPendingReference(projectId)
    if (pending) {
      setReferenceStatus('Verify the pending reference update before saving another reference.', { error: true, projectId })
      return { ok: false, reason: 'pending_recovery', unknown: true, operationId: pending.operationId }
    }
    if (!session.project || isReferenceBusy(projectId) || exportBusy() || session.documentCandidate || session.textDraftOpen?.()) {
      setReferenceStatus('Finish the current edit before saving a project reference.', { error: true, projectId })
      return { ok: false, reason: 'busy' }
    }
    const allRefs = Array.isArray(session.project.references) ? session.project.references : []
    if (allRefs.length >= 64) {
      const msg = 'Project reference limit reached (64/64 records). Revoked references remain in project history and do not free slots.'
      setReferenceStatus(msg, { error: true, projectId })
      return { ok: false, reason: 'reference_limit' }
    }
    const selected = view.canvases.find(canvas => canvas.id === view.selectedId && !canvas.transient)
    const manifest = selected ? session.documents.get(selected.document_id) : null
    if (!selected || !manifest) {
      setReferenceStatus('Select a saved canvas first.', { error: true, projectId })
      return { ok: false, reason: 'no_selection' }
    }
    const target = session.documentTimeline?.target(manifest)
    const resolvedFrameId = frameId || target?.frame_id || manifest.frame_order?.[0] || ''
    const resolvedLayerId = sourceKind === 'cel' ? (layerId || target?.layer_id || manifest.layer_order?.[0] || '') : null
    const resolvedPurpose = purpose || nodes.referencePurpose?.value || (sourceKind === 'cel' ? 'cel' : 'frame')
    const frameNumber = Math.max(1, (manifest.frame_order || []).indexOf(resolvedFrameId) + 1)
    const layerName = resolvedLayerId ? (manifest.layers?.[resolvedLayerId]?.name || resolvedLayerId) : ''
    const baseTitle = (selected.name || manifest.name || 'Sprite').slice(0, 80)
    const resolvedName = (name && String(name).trim())
      || `${baseTitle} · F${frameNumber}${layerName ? ` · ${layerName}` : ''}`.slice(0, 128)
    const expectedRevision = session.project.revision
    const openToken = api.openEpoch.current
    const operationId = createOperationId()
    const payload = {
      operationId,
      expectedRevision,
      canvasId: selected.id,
      documentId: manifest.document_id,
      workingRevision: manifest.revision,
      expectedWorkingRevision: manifest.revision,
      sourceKind,
      frameId: resolvedFrameId,
      ...(resolvedLayerId ? { layerId: resolvedLayerId } : {}),
      purpose: resolvedPurpose,
      name: resolvedName,
    }
    return executeReferenceOperation({
      kind: 'promote',
      projectId,
      openToken,
      operationId,
      payload,
      resolvedName,
    })
  }

  session.revokeProjectReference = async (refId) => {
    const projectId = session.project?.id
    const pending = currentPendingReference(projectId)
    if (pending) {
      setReferenceStatus('Verify the pending reference update before revoking another reference.', { error: true, projectId })
      return { ok: false, reason: 'pending_recovery', unknown: true, operationId: pending.operationId }
    }
    if (!session.project || !refId || isReferenceBusy(projectId) || exportBusy() || session.documentCandidate) {
      return { ok: false, reason: 'busy' }
    }
    const expectedRevision = session.project.revision
    const openToken = api.openEpoch.current
    const operationId = createOperationId()
    const existing = (session.project.references || []).find(item => item && item.id === refId)
    return executeReferenceOperation({
      kind: 'revoke',
      projectId,
      openToken,
      operationId,
      referenceId: refId,
      resolvedName: existing?.name || refId,
      payload: {
        operationId,
        expectedRevision,
      },
    })
  }

  function renderProjectReferences() {
    const section = nodes.projectReferences
    if (!section) return
    if (!session.project) {
      section.hidden = true
      return
    }
    section.hidden = false
    const projectId = session.project.id
    const allRefs = Array.isArray(session.project.references) ? session.project.references : []
    const activeRefs = activeProjectReferences()
    const revokedCount = Math.max(0, allRefs.length - activeRefs.length)
    const limitReached = allRefs.length >= 64
    const selectedIds = session.activeReferenceIds()
    const busy = isReferenceBusy(projectId)
    const pending = currentPendingReference(projectId)
    const lockedByRefState = busy || Boolean(pending)
    if (nodes.referenceCount) {
      const capLabel = revokedCount > 0
        ? `${activeRefs.length} active · ${allRefs.length}/64 records`
        : `${allRefs.length}/64`
      nodes.referenceCount.textContent = selectedIds.length > 0
        ? `${selectedIds.length} in turn · ${capLabel}`
        : capLabel
      nodes.referenceCount.title = limitReached
        ? '64/64 reference records used. Revoked references remain in project history and do not free slots.'
        : `${activeRefs.length} active reference(s), ${allRefs.length}/64 total project reference records used.`
    }
    const selected = view.canvases.find(canvas => canvas.id === view.selectedId && !canvas.transient)
    const manifest = selected ? session.documents.get(selected.document_id) : null
    const target = manifest ? session.documentTimeline?.target(manifest) : null
    const frameId = target?.frame_id || manifest?.frame_order?.[0] || null
    const layerId = target?.layer_id || manifest?.layer_order?.[0] || null
    const activeCel = manifest && frameId && layerId
      ? Object.values(manifest.cels || {}).find(c => c.frame_id === frameId && c.layer_id === layerId)
      : null
    const hasFrameText = Boolean(manifest?.text_objects?.items?.some(item => item.frame_id === frameId))
    const hasCelText = Boolean(manifest?.text_objects?.items?.some(item => item.frame_id === frameId && item.layer_id === layerId))
    const canPromoteBase = Boolean(manifest && frameId && !lockedByRefState && !exportBusy() && !session.documentCandidate && !session.textDraftOpen?.() && !limitReached)
    const hasVisibleFramePixels = Boolean(manifest && frameId && manifest.layer_order.some(lid => {
      const layer = manifest.layers?.[lid]
      if (!layer || layer.visible === false) return false
      return Boolean(Object.values(manifest.cels || {}).find(c => c.frame_id === frameId && c.layer_id === lid)?.block)
    }))
    if (nodes.promoteFrameRef) {
      nodes.promoteFrameRef.disabled = !canPromoteBase || !hasVisibleFramePixels || hasFrameText
      nodes.promoteFrameRef.title = pending
        ? 'Verify the pending reference update before saving another reference'
        : limitReached
          ? 'Project reference limit reached (64/64 records). Revoked references remain in project history and do not free slots.'
          : !manifest
            ? 'Select a saved canvas to promote a frame reference'
            : hasFrameText
              ? 'Frames with editable text objects cannot be promoted as pixel references'
              : !hasVisibleFramePixels
                ? 'Current frame has no visible pixels to promote'
                : 'Save current frame composite into the project reference library'
    }
    if (nodes.promoteCelRef) {
      nodes.promoteCelRef.disabled = !canPromoteBase || !activeCel?.block || hasCelText
      nodes.promoteCelRef.title = pending
        ? 'Verify the pending reference update before saving another reference'
        : limitReached
          ? 'Project reference limit reached (64/64 records). Revoked references remain in project history and do not free slots.'
          : !manifest
            ? 'Select a saved canvas to promote a cel reference'
            : hasCelText
              ? 'Cels with editable text objects cannot be promoted as pixel references'
              : !activeCel?.block
                ? 'Current cel is empty'
                : 'Save current layer cel into the project reference library'
    }
    if (nodes.recoverReference) {
      nodes.recoverReference.hidden = !pending
      nodes.recoverReference.disabled = !pending || busy
      if (pending) {
        nodes.recoverReference.textContent = pending.kind === 'revoke' ? 'Verify pending revoke' : 'Verify pending save'
        nodes.recoverReference.title = pending.kind === 'revoke'
          ? `Replay revoke (${pending.operationId}) to confirm project reference state`
          : `Replay save (${pending.operationId}) to confirm project reference state`
      }
    }
    if (nodes.referenceStatus) {
      const statusEntry = currentReferenceStatus(projectId)
      const fallbackCapacityNote = !statusEntry.text && limitReached
        ? `64/64 reference records used (${activeRefs.length} active${revokedCount > 0 ? `, ${revokedCount} revoked` : ''}). Revoked references remain in project history and do not free slots.`
        : ''
      const displayText = statusEntry.text || fallbackCapacityNote
      nodes.referenceStatus.textContent = displayText
      nodes.referenceStatus.hidden = !displayText
      nodes.referenceStatus.classList.toggle('is-error', Boolean(statusEntry.text && statusEntry.error))
    }
    if (nodes.referenceList) {
      nodes.referenceList.replaceChildren()
      for (const ref of activeRefs) {
        const isSelected = selectedIds.includes(ref.id)
        const thumbUrl = typeof api.referencePngUrl === 'function'
          ? api.referencePngUrl(session.project.id, ref.id)
          : `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(session.project.id)}/references/${encodeURIComponent(ref.id)}/png`
        const row = el('div', {
          className: `vnext-reference-row${isSelected ? ' is-selected' : ''}`,
          role: 'listitem',
          'data-reference-id': ref.id,
          'data-figma': '2860:1130',
        }, [
          el('img', {
            className: 'vnext-reference-thumb',
            src: thumbUrl,
            alt: '',
            width: 28,
            height: 28,
            loading: 'lazy',
          }),
          el('div', { className: 'vnext-reference-meta' }, [
            el('span', { className: 'vnext-reference-name', text: ref.name, title: ref.name }),
            el('span', {
              className: 'vnext-reference-sub',
              text: `${ref.purpose} · ${ref.width}×${ref.height} · ${ref.source_kind === 'cel' ? 'cel' : 'frame'}`,
            }),
          ]),
          el('div', { className: 'vnext-reference-actions' }, [
            el('button', {
              type: 'button',
              className: `vnext-prop-btn${isSelected ? ' is-primary' : ''}`,
              'data-reference-toggle': ref.id,
              'data-figma': '2860:1130;toggle',
              'aria-pressed': String(isSelected),
              disabled: lockedByRefState,
              title: pending
                ? 'Verify the pending reference update first'
                : isSelected
                  ? 'Included in next Canvas & timeline turn (click to remove)'
                  : 'Use this reference in next Canvas & timeline turn',
              text: isSelected ? 'In turn' : 'Use',
            }),
            el('button', {
              type: 'button',
              className: 'vnext-prop-btn',
              'data-reference-revoke': ref.id,
              'data-figma': '2860:1130;revoke',
              disabled: lockedByRefState,
              title: pending ? 'Verify the pending reference update first' : 'Revoke this project reference',
              'aria-label': `Revoke ${ref.name}`,
              text: 'Revoke',
            }),
          ]),
        ])
        nodes.referenceList.append(row)
      }
    }
  }

  function renderDocumentScopeBar() {
    const bar = nodes.documentScopeBar
    if (!bar) return
    if (!session.project) {
      bar.hidden = true
      bar.replaceChildren()
      return
    }
    const manifest = selectedManifest()
    const lockedIds = manifest ? (session.documentTimeline?.lockedFrameIds?.(manifest) || []) : []
    const editableIds = manifest ? (session.documentTimeline?.editableFrameIds?.(manifest) || []) : []
    const selectedRefIds = session.activeReferenceIds()
    const activeRefs = activeProjectReferences().filter(ref => selectedRefIds.includes(ref.id))
    if (lockedIds.length === 0 && activeRefs.length === 0) {
      bar.hidden = true
      bar.replaceChildren()
      return
    }
    bar.hidden = false
    bar.replaceChildren()
    if (manifest && lockedIds.length > 0) {
      const frameLabels = editableIds.map(fid => `F${manifest.frame_order.indexOf(fid) + 1}`).join(', ')
      bar.append(el('button', {
        type: 'button',
        className: 'vnext-scope-pill',
        'data-clear-frame-scope': 'true',
        'data-figma': '2860:1105',
        'data-capability': 'CHAT-01 TIME-04',
        title: `Revising ${frameLabels} (${lockedIds.length} locked). Click to unlock all frames.`,
        text: `Scope: ${editableIds.length}/${manifest.frame_order.length} frames (${lockedIds.length} locked) ×`,
      }))
    }
    for (const ref of activeRefs) {
      bar.append(el('button', {
        type: 'button',
        className: 'vnext-scope-pill is-ref',
        'data-remove-turn-reference': ref.id,
        'data-figma': '2860:1106',
        'data-capability': 'CHAT-01 CHAT-02',
        title: `Using reference "${ref.name}" (${ref.purpose}). Click to remove from turn.`,
        text: `Ref: ${ref.name} (${ref.purpose}) ×`,
      }))
    }
  }

  nodes.projectReferences?.addEventListener('click', (event) => {
    const actionBtn = event.target.closest?.('[data-reference-action]')
    if (actionBtn && !actionBtn.disabled) {
      const action = actionBtn.dataset.referenceAction
      if (action === 'promote-frame') void session.promoteProjectReference({ sourceKind: 'frame_composite' })
      if (action === 'promote-cel') void session.promoteProjectReference({ sourceKind: 'cel' })
      if (action === 'recover') void session.resolvePendingReference()
      return
    }
    const toggleBtn = event.target.closest?.('[data-reference-toggle]')
    if (toggleBtn && !toggleBtn.disabled) {
      session.toggleActiveReference(toggleBtn.dataset.referenceToggle)
      return
    }
    const revokeBtn = event.target.closest?.('[data-reference-revoke]')
    if (revokeBtn && !revokeBtn.disabled) {
      void session.revokeProjectReference(revokeBtn.dataset.referenceRevoke)
    }
  })

  nodes.documentScopeBar?.addEventListener('click', (event) => {
    const clearScopeBtn = event.target.closest?.('[data-clear-frame-scope]')
    if (clearScopeBtn) {
      session.documentTimeline?.setEditableFrameIds?.(null)
      return
    }
    const removeRefBtn = event.target.closest?.('[data-remove-turn-reference]')
    if (removeRefBtn) {
      session.toggleActiveReference(removeRefBtn.dataset.removeTurnReference)
    }
  })

  function showToast(message, options = {}) {
    if (!nodes.toast) return
    if (message && typeof message === 'object') {
      renderVnextToast(nodes.toast, message)
      return
    }
    if (!message) {
      renderVnextToast(nodes.toast, '')
      return
    }
    renderVnextToast(nodes.toast, { title: String(message), ...options })
  }
  session.showToast = showToast

  function setMenuOpen(open) {
    if (!nodes.menu || !nodes.btn) return
    if (open) renderChrome() // assistant preparation can finish without a canvas render; derive menu availability on open
    nodes.menu.hidden = !open
    nodes.btn.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  function renderChrome() {
    const selected = view.canvases.find(canvas => canvas.id === view.selectedId && !canvas.transient)
    if (nodes.download) {
      nodes.download.disabled = !selected || !(selected.preview || selected.previewUrl) || exportBusy()
      nodes.download.title = exportBusy() ? 'Finish the current edit or project change before exporting.' : selected ? 'Export selected canvas' : 'Select a saved canvas to export'
      nodes.download.setAttribute('aria-label', 'Export selected canvas')
      nodes.download.dataset.capabilityStatus = 'implemented'
    }
    const name = session.project?.name || VNEXT_PROJECT_COPY.noProject
    if (nodes.name) nodes.name.textContent = name
    if (nodes.pageLabel && session.project?.pages?.[0]?.name) {
      nodes.pageLabel.textContent = session.project.pages[0].name
    }
    const dirty = view.isDirty()
    const manualBusy = Boolean(session.frameLoading || session.manualGesture || session.manualWrite || session.pixelCopyPending)
    const changing = projectChangeInFlight() // imports and Save positions pause while another project opens or is created
    const canSave = Boolean(session.project && dirty && !session.pendingSave && !historyPending() && !manualBusy && !changing && !session.blankSubmitting && !session.blankUnconfirmed)
    if (nodes.save) {
      nodes.save.disabled = !canSave
      nodes.save.textContent = session.saveReceipt && !dirty ? VNEXT_PROJECT_COPY.saved : VNEXT_PROJECT_COPY.menuSave
    }
    if (nodes.importInput) nodes.importInput.disabled = !session.project || Boolean(historyPending()) || manualBusy || changing
    if (nodes.blankButton) {
      nodes.blankButton.disabled = !session.project || (blankBusy() && !session.blankUnconfirmed)
      nodes.blankButton.textContent = session.blankUnconfirmed ? 'Check canvas creation…' : 'New canvas…'
    }
    if (nodes.duplicateCanvas) {
      const canDuplicate = Boolean(session.project && selected && session.documents?.get?.(selected.document_id) && !historyPending() && !manualBusy && !changing && !session.blankSubmitting && !session.blankUnconfirmed && !session.pendingImport && !session.pendingSave && !session.nameEdit)
      nodes.duplicateCanvas.disabled = !canDuplicate
    }
    if (nodes.canvasSizeMenu) {
      nodes.canvasSizeMenu.disabled = !session.canResizeSelectedCanvas?.()
    }
    if (nodes.subscription) nodes.subscription.disabled = !session.project || changing
    const textDraftOpen = Boolean(session.textDraftOpen?.()) // view changes are fine; Move places the draft
    if (nodes.zoom) {
      nodes.zoom.disabled = manualBusy && !textDraftOpen
      nodes.zoom.textContent = zoomPercentLabel(view.zoom)
    }
    if (nodes.grid) {
      const on = session.pixelGrid !== false
      const waiting = on && view.zoom < VNEXT_PIXEL_GRID_MIN_ZOOM
      nodes.grid.setAttribute('aria-pressed', String(on))
      nodes.grid.classList.toggle('is-selected', on)
      nodes.grid.title = waiting ? 'On. Visible at 400% zoom or higher.' : 'Pixel grid'
      if (nodes.gridPending) nodes.gridPending.hidden = !waiting
      if (nodes.pixelGridSwitch) {
        nodes.pixelGridSwitch.setAttribute('aria-pressed', String(on))
        nodes.pixelGridSwitch.textContent = on ? 'On' : 'Off'
      }
      if (nodes.pixelGridNote) nodes.pixelGridNote.hidden = !waiting
    }
    const square = VNEXT_CHECKER_SQUARES.includes(session.checkerSquare) ? session.checkerSquare : VNEXT_CHECKER_SQUARE_DEFAULT
    session.checkerSquare = square
    if (typeof nodes.stage?.style?.setProperty === 'function') nodes.stage.style.setProperty('--vnext-checker-square', String(square))
    else if (nodes.stage?.style) nodes.stage.style['--vnext-checker-square'] = String(square)
    if (nodes.checkerNote) nodes.checkerNote.textContent = `Shows transparent areas only. Each square covers ${square} × ${square} image pixels. This does not change the artwork or exports.`
    nodes.checkerSizes?.querySelectorAll('[data-checker-size]').forEach((button) => {
      button.setAttribute('aria-checked', String(Number(button.dataset.checkerSize) === square))
    })
    if (nodes.move) {
      nodes.move.disabled = manualBusy && !textDraftOpen
      const selected = view.tool === 'move'
      nodes.move.classList.toggle('is-selected', selected)
      nodes.move.setAttribute('aria-pressed', selected ? 'true' : 'false')
    }
    manualTools?.refresh()
    session.documentTimeline?.render()
    session.onionSkin?.render()
    exportPanel?.refresh()
    renderProjectReferences()
    renderDocumentScopeBar()
    session.onChromeRendered?.(); session.pixelProcessing?.sync(); session.externalBridge?.sync()
  }

  function renderCanvas() {
    if (!nodes.stage) return
    let world = nodes.stage.querySelector('.vnext-canvas-world')
    if (!world) {
      world = el('div', { className: 'vnext-canvas-world' })
      nodes.stage.append(world)
    }
    world.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`
    if (typeof world.style.setProperty === 'function') world.style.setProperty('--vnext-inverse-zoom', String(1 / (view.zoom || 1))) // keeps world-space outlines 1 screen px
    const host = nodes.stage.getBoundingClientRect()
    const seen = new Set()
    for (const storedCanvas of view.canvases) {
      const canvas = session.documentCandidate?.canvas.id === storedCanvas.id ? session.documentCandidate.canvas : storedCanvas
      seen.add(canvas.id)
      let tile = world.querySelector(`[data-canvas-id="${canvas.id}"]`)
      if (!tile) {
        tile = el('button', {
          type: 'button',
          className: 'vnext-canvas-tile',
          'data-canvas-id': canvas.id,
        })
        tile.addEventListener('click', (event) => {
          event.stopPropagation()
          view.select(tile.dataset.canvasId)
          bindConversationRef(tile.dataset.canvasId)
          refreshTimeline()
          renderCanvas()
        })
        world.append(tile)
      }
      const pos = view.positionOf(canvas.id)
      tile.style.width = `${canvas.width}px`
      tile.style.height = `${canvas.height}px`
      tile.style.transform = `translate(${pos.x}px, ${pos.y}px)`
      tile.classList.toggle('is-selected', view.selectedId === canvas.id)
      renderCanvasBackdrop(world, tile, canvas, pos)
      renderCanvasFrame(canvas, pos, host)
      renderPixelGrid(canvas, pos, host)
      renderCanvasName(world, canvas, pos)
      if (canvas.previewUrl) {
        let image = tile.querySelector('img')
        if (!image) {
          image = el('img', { alt: canvas.name || 'Canvas', draggable: 'false' })
          tile.replaceChildren(image)
        }
        if (image.getAttribute('src') !== canvas.previewUrl) image.src = canvas.previewUrl
        image.alt = canvas.name || 'Canvas'
      } else {
        const children = tile.children || []
        if (canvas.preview) {
          if (children[0] !== canvas.preview || tile.querySelector('img') || (!session.paintTextObjects && children.length > 1)) {
            tile.replaceChildren(canvas.preview)
          }
        } else if (children.length) {
          tile.replaceChildren()
        }
        session.paintTextObjects?.(tile, canvas)
      }
    }
    for (const tile of [...world.querySelectorAll('.vnext-canvas-tile')]) {
      if (!seen.has(tile.dataset.canvasId)) tile.remove()
    }
    for (const label of [...world.querySelectorAll('[data-canvas-name]')]) {
      if (!seen.has(label.dataset.canvasName)) label.remove()
    }
    for (const frame of [...nodes.stage.querySelectorAll('[data-canvas-frame]')]) {
      if (!seen.has(frame.dataset.canvasFrame)) frame.remove()
    }
    for (const node of [...world.querySelectorAll('[data-canvas-backdrop]')]) {
      if (!seen.has(node.dataset.canvasBackdrop)) node.remove()
    }
    for (const node of [...nodes.stage.querySelectorAll('[data-canvas-grid]')]) {
      if (!seen.has(node.dataset.canvasGrid)) node.remove()
    }
    nodes.stage.classList.toggle('is-panning', view.spaceDown)
    renderChrome()
    renderObjectPreview(host)
    renderConversationRef()
  }

  let locatorModel = null

  function renderObjectPreview(hostRect) {
    const body = root.querySelector('.vnext-preview-body')
    const pane = root.querySelector('.vnext-preview')
    if (!body || pane?.classList?.contains?.('is-collapsed') || pane?.hidden) return
    const host = hostRect || nodes.stage?.getBoundingClientRect()
    locatorModel = locatorMapModel({
      canvases: view.canvases.map((canvas) => ({
        id: canvas.id,
        width: canvas.width,
        height: canvas.height,
        position: view.positionOf(canvas.id),
        previewUrl: locatorPreviewUrl(canvas),
        selected: canvas.id === view.selectedId,
      })),
      panX: view.panX,
      panY: view.panY,
      zoom: view.zoom,
      hostWidth: host?.width || 1,
      hostHeight: host?.height || 1,
      mapWidth: body.clientWidth || 1,
      mapHeight: body.clientHeight || 1,
    })
    let map = body.querySelector('.vnext-locator')
    if (!map) {
      map = el('div', { className: 'vnext-locator' })
      body.replaceChildren(map)
    }
    const seen = new Set()
    for (const item of locatorModel.items) {
      seen.add(item.id)
      let node = map.querySelector(`[data-locator-id="${item.id}"]`)
      if (!node) {
        node = el('button', {
          type: 'button',
          className: 'vnext-locator-item',
          'data-locator-id': item.id,
          title: 'Locate on canvas',
        })
        map.append(node)
      }
      node.style.left = `${item.map.x}px`
      node.style.top = `${item.map.y}px`
      node.style.width = `${item.map.w}px`
      node.style.height = `${item.map.h}px`
      node.classList.toggle('is-selected', item.selected)
      if (item.previewUrl) {
        let image = node.querySelector('img')
        if (!image) {
          image = el('img', { alt: '', draggable: 'false' })
          node.replaceChildren(image)
        }
        if (image.getAttribute('src') !== item.previewUrl) image.setAttribute('src', item.previewUrl)
      } else if (node.querySelector('img')) {
        node.replaceChildren()
      }
    }
    for (const node of [...map.querySelectorAll('.vnext-locator-item')]) {
      if (!seen.has(node.dataset.locatorId)) node.remove()
    }
    let viewport = map.querySelector('.vnext-locator-view')
    if (!viewport) {
      viewport = el('div', { className: 'vnext-locator-view' })
      map.append(viewport)
    }
    const box = locatorModel.viewport.map
    viewport.style.left = `${box.x}px`
    viewport.style.top = `${box.y}px`
    viewport.style.width = `${box.w}px`
    viewport.style.height = `${box.h}px`
    if (pane) pane.dataset.capabilityStatus = locatorModel.items.length ? 'bound' : 'pending'
  }

  function locateFromPreview(event) {
    if (!locatorModel) return
    const body = root.querySelector('.vnext-preview-body')
    const host = nodes.stage?.getBoundingClientRect()
    if (!body || !host) return
    const rect = body.getBoundingClientRect()
    const mapX = event.clientX - rect.left
    const mapY = event.clientY - rect.top
    const hit = locatorHitTest(locatorModel, mapX, mapY)
    if (hit && hit !== session.textDraftCanvasId?.() && session.finishTextDraft?.() === false) { renderCanvas(); return } // open text is placed first
    if (hit) {
      view.select(hit)
      view.centerOn(hit, host.width, host.height)
      bindConversationRef(hit)
    } else {
      const world = locatorToWorld(locatorModel, mapX, mapY)
      view.centerWorld(world.x, world.y, host.width, host.height)
    }
    nodes.stage?.focus?.({ preventScroll: true }) // locating returns keyboard shortcuts to the canvas
    renderCanvas()
    refreshTimeline()
  }

  function applyTimelineSummary(summary) {
    if (nodes.playCurrent) nodes.playCurrent.textContent = summary.current
    if (nodes.playTotal) nodes.playTotal.textContent = `/ ${summary.total}`
    if (nodes.fpsLabel) nodes.fpsLabel.textContent = summary.durationLabel
  }

  function appendDisabledAddBlank() {
    if (!nodes.frames) return
    nodes.frames.append(el('div', {
      className: 'vnext-add-blank-col',
      'data-capability': 'TIME-05',
      'data-capability-status': 'pending',
    }, [
      el('button', {
        type: 'button',
        className: 'vnext-add-blank',
        'data-capability': 'TIME-05',
        disabled: true,
        title: 'Add a blank frame to the selected layer · real add-frame stays in protected P2',
        'aria-label': 'Add blank frame to selected layer',
      }, [svgUse('icon-plus-16', { className: 'vnext-icon is-16' })]),
    ]))
  }

  function renderSampleTimeline() {
    if (!nodes.frames) return
    nodes.frames.replaceChildren()
    renderFrames(nodes.frames)
    if (!nodes.layerCol) return
    const names = ['Details', 'Sprite', 'Shadow']
    nodes.layerCol.querySelectorAll('.vnext-layer-row').forEach((row, index) => {
      row.hidden = false
      const name = row.querySelector('.vnext-layer-name')
      if (name) name.textContent = names[index] || name.textContent
    })
  }

  function renderEmptyTimeline() {
    if (nodes.frames) {
      nodes.frames.replaceChildren()
      appendDisabledAddBlank()
    }
    if (!nodes.layerCol) return
    nodes.layerCol.querySelectorAll('.vnext-layer-row').forEach((row) => {
      row.hidden = true
    })
  }

  function selectedManifest() {
    if (!session.project) return null
    const canvas = view.canvases.find((item) => item.id === view.selectedId) || view.canvases[0] || null
    return canvas ? session.documents.get(canvas.document_id) || null : null
  }

  function refreshTimeline() {
    if (session.documentTimeline?.render()) return
    if (!session.project) {
      renderSampleTimeline()
      applyTimelineSummary(timelineSummary(null, { sample: true }))
      return
    }
    const manifest = selectedManifest()
    if (!manifest || !(manifest.frame_order || []).length) {
      renderEmptyTimeline()
      applyTimelineSummary(timelineSummary(manifest || { frame_order: [], layer_order: [], frames: {}, layers: {} }))
      return
    }
    renderDocumentTimeline(manifest)
    applyTimelineSummary(timelineSummary(manifest))
  }

  function renderDocumentTimeline(manifest) {
    if (!nodes.frames || !manifest) {
      renderEmptyTimeline()
      return
    }
    const layers = (manifest.layer_order || []).map((id) => (manifest.layers || {})[id]).filter(Boolean)
    const frames = manifest.frame_order || []
    nodes.frames.replaceChildren()
    frames.forEach((frameId, index) => {
      const frame = manifest.frames[frameId]
      const col = el('div', {
        className: `vnext-frame-col${index === 0 ? ' is-head' : ''}`,
        'data-frame': index + 1,
      }, [el('div', { className: 'vnext-frame-index', text: String(index + 1).padStart(2, '0') })])
      layers.forEach((layer, layerIndex) => {
        const cel = Object.values(manifest.cels || {}).find((item) => item.frame_id === frameId && item.layer_id === layer.id)
        const filled = Boolean(cel?.block)
        const selected = index === 0 && layerIndex === 0
        const asset = !filled ? BLANK_CEL : selected ? 'cel-row-selected.svg' : 'cel-content.svg'
        col.append(el('div', {
          className: `vnext-cel${filled ? ' is-filled' : ' is-blank'}${selected ? ' is-selected' : ''}`,
          title: `${layer.name} · ${frameId}`,
          'data-layer': layer.name,
        }, [celImage(asset, selected)]))
      })
      col.append(el('div', { className: 'vnext-frame-duration', text: String(frame?.duration_ms ?? '') }))
      nodes.frames.append(col)
    })
    appendDisabledAddBlank()
    const rows = [...nodes.layerCol.querySelectorAll('.vnext-layer-row')]
    rows.forEach((row, index) => {
      const layer = layers[index]
      row.hidden = !layer
      const name = row.querySelector('.vnext-layer-name')
      if (layer && name) name.textContent = layer.name
    })
  }

  function renderList() {
    const model = projectListViewModel(session.list)
    if (nodes.search) {
      nodes.search.parentElement.hidden = !model.showSearch && !model.noMatch
      if (model.noMatch) nodes.search.parentElement.hidden = false
    }
    if (nodes.status) {
      if (model.loading) nodes.status.textContent = VNEXT_PROJECT_COPY.loading
      else if (model.wholeError) nodes.status.textContent = session.list.error?.message || VNEXT_PROJECT_COPY.listError
      else if (model.emptyWorkspace) nodes.status.textContent = `${VNEXT_PROJECT_COPY.emptyTitle}. ${VNEXT_PROJECT_COPY.emptyBody}`
      else if (model.allUnreadable) nodes.status.textContent = `${VNEXT_PROJECT_COPY.allUnreadTitle}. ${VNEXT_PROJECT_COPY.allUnreadBody}`
      else if (model.noMatch) nodes.status.textContent = `${VNEXT_PROJECT_COPY.noMatchTitle(session.list.query)} ${VNEXT_PROJECT_COPY.noMatchBody}`
      else nodes.status.textContent = model.hintText || model.countText
    }
    if (nodes.rows) {
      nodes.rows.replaceChildren()
      for (const project of model.filtered) {
        const selected = project.id === model.selectedId
        const row = el('button', {
          type: 'button',
          className: `vnext-list-row${selected ? ' is-selected' : ''}`,
          role: 'option',
          'aria-selected': selected ? 'true' : 'false',
          'data-project-id': project.id,
        }, [
          el('span', { className: 'vnext-list-row-name', text: project.name }),
          el('span', { className: 'vnext-list-row-meta', text: project.id }),
          ...(project.version === VNEXT_PROJECT_V0
            ? [el('span', { className: 'vnext-list-row-meta', text: VNEXT_PROJECT_COPY.olderFormat })]
            : []),
          el('span', {
            className: 'vnext-list-row-meta',
            text: VNEXT_PROJECT_COPY.lastSaved(formatLastSaved(project.updated_at)),
          }),
        ])
        nodes.rows.append(row)
      }
    }
    if (nodes.warning) {
      nodes.warning.hidden = !model.showOmitted
      if (model.showOmitted) {
        nodes.warningTitle.textContent = VNEXT_PROJECT_COPY.omittedTitle(model.omitted)
        nodes.warningBody.textContent = VNEXT_PROJECT_COPY.omittedBody
      }
    }
    if (nodes.openConfirm) nodes.openConfirm.disabled = model.openDisabled
    if (nodes.clearSearch) nodes.clearSearch.hidden = !model.noMatch
    const refresh = nodes.openRoot?.querySelector('[data-project-action="refresh"]')
    if (refresh) refresh.hidden = !model.showRefresh
  }

  function closeOpenDialog({ cancelPendingOpen = false } = {}) {
    if (nodes.openRoot) nodes.openRoot.hidden = true
    api.cancelList()
    // Only an open request actually in flight is cancelled. Closing the list alone must not advance the
    // open epoch, or pending saves/recovery bound to the current project would wrongly turn stale.
    if (cancelPendingOpen && confirmedOpenInFlight()) { // editing and this project's image save resume at once, not when the cancelled request returns
      api.cancelOpen(); keepImageSaveAfterAbandonedChange(session.project?.id ?? null, session.activity || 0)
      clearOpenWaitStatus(); renderChrome(); notifyDraftChange()
    }
  }

  function dismissOpenDialog() {
    closeOpenDialog({ cancelPendingOpen: true })
  }

  function closeConfirm() {
    const onDismiss = session.confirm?.onDismiss
    session.confirm = null
    if (nodes.confirmRoot) nodes.confirmRoot.hidden = true
    onDismiss?.()
  }

  function openConfirm({ title, body, details = '', primary, secondary, onPrimary, onSecondary, onDismiss, owner = null }) {
    closeConfirm()
    session.confirm = { onPrimary, onSecondary, onDismiss, owner }
    nodes.confirmTitle.textContent = title
    nodes.confirmBody.textContent = body
    nodes.confirmDetails.hidden = !details
    nodes.confirmDetails.textContent = details
    nodes.confirmPrimary.textContent = primary
    nodes.confirmSecondary.textContent = secondary
    nodes.confirmRoot.hidden = false
  }

  function noteSessionError(error) {
    session.lastError = {
      kind: error?.kind || '',
      code: error?.code || '',
      status: error?.status || 0,
      reason: error?.reason || '',
      message: error?.message || '',
    }
  }

  async function applyProject(project, { preserveView = false, token, write, notOlderThanShown = false } = {}) {
    const used = write ? write.activity : (token ?? api.openEpoch.current)
    // A reload of a project read earlier never replaces a newer revision of that project that was
    // saved while it was read or while its documents loaded: checked again right before the commit.
    const superseded = () => notOlderThanShown && olderThanShown(session.project, project)
    const isCurrent = write
      ? () => writeStillCurrent(write)
      : (value) => api.openEpoch.isCurrent(value) && !superseded()
    if (superseded()) return { stale: true, committed: false, superseded: true }
    try {
    const applied = await applyLoadedProjectBundle({
      token: used,
      isCurrent,
      load: () => loadProjectBundle(api, project, {
        makePreview: (block) => rgbaBytesToCanvas(block.bytes, block.width, block.height),
        frameFor: manifest => session.documentTimeline?.target(manifest)?.frame_id,
        familyFor: item => session.resolveTextFont?.(item) || (item.font.kind === 'generic' ? item.font.name : null),
      }),
      commit(bundle) {
        const previousLayoutRevision = session.layoutBaseRevision ?? session.project?.revision
        const previousBaselines = new Map(view.canvases.filter((canvas) => !canvas.transient).map((canvas) => [canvas.id, { x: canvas.x, y: canvas.y }]))
        const draftsBefore = { ...view.drafts }
        const nextId = bundle.project?.id ?? null
        const switchedProject = session.boundProjectId !== nextId
        if (switchedProject) {
          if (session.boundProjectId !== null && nodes.sequenceRoot && !nodes.sequenceRoot.hidden) closeSequenceDialog(true)
          session.documentTimeline?.reset()
          manualTools?.cancel()
          session.activity = (session.activity || 0) + 1
          session.boundProjectId = nextId
          session.conversationRef = null
          session.contextDismissed = false
          session.nameEdit = null
          setCanvasStatus('')
          showToast('')
        }
        session.project = bundle.project
        try { window.localStorage.setItem('vnext-last-project-id', bundle.project.id) } catch { /* optional UI preference */ }
        // A confirmed open owns a new context. An unresolved submitted write stays
        // with its project and must not block or replay onto the project being opened.
        const leavingWrite = session.staticImageWrite
        if (leavingWrite && !writeStillCurrent(leavingWrite)) {
          if (switchedProject && leavingWrite.projectId !== nextId && leavingWrite.submitted
            && !['done', 'abandoned'].includes(leavingWrite.stage)) {
            leavingWrite.hold = true
            parkedStaticWrites.set(leavingWrite.projectId, leavingWrite)
            if (session.pendingImport === leavingWrite) session.pendingImport = false
            if (session.staticImageWrite === leavingWrite) session.staticImageWrite = null
          } else {
            releaseStaticWrite(leavingWrite)
            if (!['done', 'abandoned'].includes(leavingWrite.stage)) leavingWrite.stage = 'abandoned'
            if (session.staticImageWrite === leavingWrite) session.staticImageWrite = null
          }
        }
        const parkedWrite = parkedStaticWrites.get(nextId)
        if (parkedWrite && !['done', 'abandoned'].includes(parkedWrite.stage)) {
          parkedWrite.activity = session.activity || 0
          parkedWrite.openToken = api.openEpoch.current
          session.staticImageWrite = parkedWrite
          parkedStaticWrites.delete(nextId)
          if (!nodes.confirmTitle) {
            parkedWrite.hold = true
            session.pendingImport = parkedWrite
          } else if (parkedWrite.stage === 'reload') openStaticReload(parkedWrite)
          else openStaticImportUnknown(parkedWrite)
        }
        session.saveReceipt = null
        session.documents = bundle.documents
        retainLoadedPixelBlocks(session.documents)
        if (!preserveView) view.resetView()
        view.setCanvases(bundle.rendered, { keepDrafts: preserveView })
        if (!preserveView) { // an opened project starts fitted, not clipped at the stage origin
          const box = nodes.stage?.getBoundingClientRect?.()
          view.fitAll(box?.width || 800, box?.height || 600, 64)
        }
        const draftsRemain = preserveView && !switchedProject && Object.entries(draftsBefore).some(([id, draft]) => draft && view.drafts[id])
        const layoutMovedUnderDraft = draftsRemain && Object.entries(draftsBefore).some(([id, draft]) => {
          const previous = previousBaselines.get(id)
          const next = view.canvases.find((canvas) => canvas.id === id && !canvas.transient)
          return Boolean(draft && previous && next && (previous.x !== next.x || previous.y !== next.y))
        })
        if (!draftsRemain) {
          session.layoutBaseRevision = bundle.project?.revision
          session.layoutRevisionPinned = false
        } else if (session.layoutRevisionPinned) {
          session.layoutBaseRevision = previousLayoutRevision
        } else if (layoutMovedUnderDraft) {
          session.layoutBaseRevision = previousLayoutRevision
          session.layoutRevisionPinned = true
        } else {
          session.layoutBaseRevision = bundle.project?.revision
          session.layoutRevisionPinned = false
        }
        renderCanvas()
        blockPendingHistoryEdit()
        try {
          refreshTimeline()
        } catch {
          /* Keep the committed project even if timeline chrome fails. */
        }
        session.onProjectBound?.()
      },
    })
    return applied.stale && superseded() ? { ...applied, superseded: true } : applied
    } catch (error) {
      if (isCurrent(used)) noteSessionError(error)
      throw error
    }
  }

  async function openProjectById(projectId) {
    const token = api.openEpoch.next(), leaving = session.project?.id ?? null, activity = session.activity || 0
    let opened = false
    session.pendingOpen = { projectId, token }
    renderChrome() // pixel editing pauses while another project loads (see session.openInFlight)
    notifyDraftChange()
    try {
      const result = await api.getProject(projectId, { token })
      if (result.stale || result.aborted) {
        recoverNameEditAfterAbandonedOpen()
        return false
      }
      if (!result.ok) {
        showToast(VNEXT_PROJECT_COPY.openFailed)
        recoverNameEditAfterAbandonedOpen()
        return false
      }
      const applied = await applyProject(result.project, { token })
      opened = !applied.stale
      if (opened) {
        session.loadGeneration = (session.loadGeneration || 0) + 1
        if (session.staticImageWrite && !['done', 'abandoned'].includes(session.staticImageWrite.stage)) {
          session.staticImageWrite.loadGeneration = session.loadGeneration
        }
      }
      // A confirmed open owns a new context: the released, frozen image save of the old one stays discarded
      // (never revived by a later abandoned change).
      const old = session.staticImageWrite
      if (opened && old && !['done', 'abandoned'].includes(old.stage) && !writeStillCurrent(old)
        && parkedStaticWrites.get(old.projectId) !== old) old.stage = 'abandoned'
      return opened
    } catch {
      if (!api.openEpoch.isCurrent(token)) return false
      showToast(VNEXT_PROJECT_COPY.openFailed)
      recoverNameEditAfterAbandonedOpen()
      return false
    } finally {
      if (session.pendingOpen?.token === token) session.pendingOpen = null
      if (!opened) keepImageSaveAfterAbandonedChange(leaving, activity)
      clearOpenWaitStatus()
      renderChrome() // succeeded, failed or was superseded: editing state follows the current project again
      notifyDraftChange()
    }
  }

  // The read-only notice from a blocked edit is stale once the open has ended.
  function clearOpenWaitStatus() {
    const wait = 'Wait for the project to finish opening.'
    if (projectChangeInFlight()) return
    if (nodes.stage && root.querySelector('#vnext-canvas-status')?.textContent === wait) setCanvasStatus('')
    if (nodes.toast && !nodes.toast.hidden && nodes.toast.textContent === wait) showToast('') // e.g. from a blocked import
  }

  session.restoreLastProject = async () => {
    let id = ''
    try { id = window.localStorage.getItem('vnext-last-project-id') || '' } catch { return }
    if (!session.project && /^[A-Za-z0-9_-]{1,96}$/.test(id)) await openProjectById(id)
  }

  function confirmedOpenInFlight() {
    return Boolean(session.pendingOpen) && api.openEpoch.isCurrent(session.pendingOpen.token)
  }
  // New project and a v0 upgrade copy (and their Retry) switch projects once the server answers. That
  // request is already submitted, so closing a dialog does not cancel it; only a newer open supersedes it.
  async function duringProjectTransition(token, task) {
    if (token != null && !api.openEpoch.isCurrent(token)) return task() // already superseded: never takes over a newer lock
    const transition = { token }, leaving = session.project?.id ?? null, activity = session.activity || 0
    session.pendingTransition = transition
    try { renderChrome(); notifyDraftChange(); return await task() } finally {
      if (session.pendingTransition === transition) session.pendingTransition = null
      keepImageSaveAfterAbandonedChange(leaving, activity)
      clearOpenWaitStatus()
      renderChrome()
      notifyDraftChange()
    }
  }
  // An open, New project or upgrade that ends without switching projects has still advanced the open epoch.
  // An unfinished image save of this unchanged project (held for recovery, running, released after a failed
  // step, or not yet submitted) stays this project's: rebind it (and the assistant's image job) so its
  // same-operation recovery runs instead of leaving the import lock stranded. A real switch changes the
  // project or activity and is still rejected.
  function keepImageSaveAfterAbandonedChange(projectId, activity) {
    if (projectChangeInFlight() || session.project?.id !== projectId || (session.activity || 0) !== activity) return
    const write = session.staticImageWrite, epoch = api.openEpoch.current
    if (write && write.openToken != null && write.openToken !== epoch && write.projectId === projectId && write.activity === activity
      && !['done', 'abandoned'].includes(write.stage)) write.openToken = epoch
    session.onOpenEpochKept?.(projectId, epoch)
  }
  function projectChangeInFlight() {
    const transition = session.pendingTransition
    return confirmedOpenInFlight() || (Boolean(transition) && (transition.token == null || api.openEpoch.isCurrent(transition.token)))
  }
  // While another project is loading or being created the old canvas is read-only: a new edit would land
  // on the project being left, and a stroke still in progress is discarded at the switch. A cancelled or
  // superseded open is no longer "in flight".
  session.openInFlight = () => projectChangeInFlight()

  function protectThen(action) {
    if (session.blankSubmitting) { setCanvasStatus('Wait for canvas creation to finish.'); return }
    if (session.blankUnconfirmed) { openUnknown('blank', session.blankUnconfirmed); return }
    if (session.manualGesture) {
      setCanvasStatus(session.textDraftOpen?.() ? 'Place or discard the text first: Done or Discard in the Text panel.' : 'Finish or cancel the current stroke first.')
      return
    }
    if (session.manualWrite) { session.manualWrite.recover?.(); return }
    if (session.pixelCopyPending) { session.resolvePixelCopy?.(); return }
    if (!shouldProtectLeave({
      dirty: view.isDirty(),
      pendingImport: session.pendingImport || session.hasAssistantWork?.() || session.hasPixelDrawingSave?.(),
      pendingSave: session.pendingSave,
    })) {
      return action()
    }
    openConfirm({
      title: VNEXT_PROJECT_COPY.leaveTitle,
      body: VNEXT_PROJECT_COPY.leaveBody,
      primary: VNEXT_PROJECT_COPY.leave,
      secondary: VNEXT_PROJECT_COPY.stay,
        onPrimary: () => {
          closeConfirm()
          action()
        },
      onSecondary: () => closeConfirm(),
    })
  }

  async function loadList() {
    session.list.status = 'loading'
    session.list.error = null
    renderList()
    const result = await api.listProjects()
    if (result.stale || result.aborted) return
    if (!result.ok) {
      session.list.status = 'error'
      session.list.error = result.error
      renderList()
      return
    }
    session.list.status = 'ready'
    session.list.projects = result.projects
    session.list.omitted_count = result.omitted_count
    session.list.has_more = Boolean(result.has_more)
    if (session.list.selectedId && !result.projects.some((item) => item.id === session.list.selectedId)) {
      session.list.selectedId = null
    }
    renderList()
  }

  async function confirmOpen() {
    const model = projectListViewModel(session.list)
    const summary = model.filtered.find((item) => item.id === model.selectedId)
    if (!summary) return
    if (summary.version === VNEXT_PROJECT_V0) {
      protectThen(() => {
        openConfirm({
          title: VNEXT_PROJECT_COPY.upgradeTitle,
          body: VNEXT_PROJECT_COPY.upgradeBody,
          primary: VNEXT_PROJECT_COPY.upgradeAction,
          secondary: VNEXT_PROJECT_COPY.cancel,
          onPrimary: async () => {
            closeConfirm()
            // A newer open or New project keeps the late copy from switching projects. The epoch only advances
            // to supersede a project change still in flight (the newest request wins), so a failed copy leaves
            // this project's pending work current.
            const bound = rememberWrite('upgrade', session.project?.id ?? null, {
              openToken: projectChangeInFlight() ? api.openEpoch.next() : api.openEpoch.current,
            })
            await duringProjectTransition(bound.openToken, async () => {
              try {
                const copy = await api.upgradeCopy(summary.id, {
                  expectedRevision: summary.revision,
                })
                if (!copy.receipt) {
                  if (operationStillCurrent(bound)) showToast(VNEXT_PROJECT_COPY.upgradeFailed)
                  return
                }
                if (!operationStillCurrent(bound)) { showToast(VNEXT_PROJECT_COPY.upgradeNotOpened); return }
                closeOpenDialog()
                if (!(await openProjectById(copy.project.id))) showToast(VNEXT_PROJECT_COPY.upgradeNotOpened)
              } catch (error) {
                if (!operationStillCurrent(bound)) return
                if (error.kind === 'unknown') {
                  if (error.request) bound.request = error.request
                  openUnknown('upgrade', bound)
                  return
                }
                showToast(error.reason || VNEXT_PROJECT_COPY.upgradeFailed)
              }
            })
          },
          onSecondary: () => closeConfirm(),
        })
      })
      return
    }
    protectThen(async () => {
      closeOpenDialog()
      await openProjectById(summary.id)
    })
  }

  function rememberWrite(kind, projectId, extra = {}) {
    const write = {
      kind,
      projectId,
      startedOn: session.project?.id ?? null,
      activity: session.activity || 0,
      loadGeneration: session.loadGeneration || 0,
      openToken: extra.openToken ?? null,
      positions: extra.positions || null,
      dropPoint: extra.dropPoint || null,
      canvasIds: extra.canvasIds || null,
    }
    session.activeWrite = write
    return write
  }

  function writeStillCurrent(write) {
    return Boolean(write)
      && session.project?.id === write.projectId
      && (session.activity || 0) === write.activity
      && (write.loadGeneration == null || write.loadGeneration === (session.loadGeneration || 0))
      && (write.openToken == null || api.openEpoch.isCurrent(write.openToken))
  }

  function operationStillCurrent(write) {
    if (!write) return false
    if (write.kind === 'create' || write.kind === 'upgrade') {
      return (session.activity || 0) === write.activity
        && (session.project?.id ?? null) === write.startedOn
        && (write.openToken == null || api.openEpoch.isCurrent(write.openToken))
    }
    return writeStillCurrent(write)
  }

  function openUnknown(kind, write) {
    openConfirm({
      title: VNEXT_PROJECT_COPY.unknownTitle,
      body: VNEXT_PROJECT_COPY.unknownBody,
      primary: VNEXT_PROJECT_COPY.retry,
      secondary: VNEXT_PROJECT_COPY.dismiss,
      // A retried New project / upgrade keeps the canvas read-only until the destination is applied.
      owner: write,
      onPrimary: () => {
        if (write.retrying) return
        return kind === 'create' || kind === 'upgrade' ? duringProjectTransition(write.openToken, retry) : retry()
      },
      onSecondary: () => {
        write.dismissed = true
        if (!write.retrying && session.pendingImport === write) session.pendingImport = false
        if (kind === 'sequence' && sequenceReview?.unknownWrite === write && nodes.sequenceImport) {
          nodes.sequenceImport.disabled = false
          syncSequenceActionButtons()
        }
        if (session.confirm?.owner === write) closeConfirm()
        renderChrome()
      },
    })
    async function retry() {
      if (write.retrying) return
      write.retrying = true
      try {
        const result = kind === 'blank' ? { body: await api.createBlank(write.projectId, write.blankRequest) }
          : write.request && typeof api.replay === 'function' ? await api.replay(write.request) : await api.retryUnknown()
        const ownsDialog = session.confirm?.owner === write
        if (ownsDialog) closeConfirm()
        if (write.dismissed || !operationStillCurrent(write)) {
          if (session.pendingImport === write) session.pendingImport = false
          if (ownsDialog) renderChrome()
          return
        }
        const switching = kind === 'create' || kind === 'upgrade'
        const notOpened = () => { if (switching && result.body?.receipt) showToast(kind === 'create' ? VNEXT_PROJECT_COPY.createdNotOpened : VNEXT_PROJECT_COPY.upgradeNotOpened) }
        if (!operationStillCurrent(write)) { notOpened(); return }
        if (switching) {
          if (!result.body?.project) return
          if ((await applyProject(result.body.project, { token: write.openToken ?? api.openEpoch.current })).stale) notOpened()
          renderCanvas()
          return
        }
        if (!writeStillCurrent(write)) return
        if (kind === 'sequence' && result.body?.already_imported === true && typeof write.resumeSequence === 'function') {
          await write.resumeSequence(result.body)
          if (session.pendingImport === write) session.pendingImport = false
          renderChrome()
          return
        }
        if ((kind === 'import' || kind === 'blank' || kind === 'sequence') && result.body?.receipt) {
          if (kind === 'sequence' && typeof write.resumeSequence === 'function') {
            await write.resumeSequence(result.body)
            return
          }
          if (kind === 'sequence') closeSequenceDialog(true)
          await finishConfirmedImport(result.body, write)
          if (session.pendingImport === write) session.pendingImport = false
          if (kind === 'blank') session.blankUnconfirmed = null
          renderChrome()
          return
        }
        if (result.body?.project && kind === 'save') {
          await applyProject(result.body.project, { preserveView: true, write })
        }
        if (result.body?.receipt && kind === 'save' && writeStillCurrent(write)) {
          session.saveReceipt = result.body.receipt
          view.applySavedPositions(write.positions || [])
        }
        renderCanvas()
      } catch (error) {
        if (error.kind === 'unknown') return
        if (session.pendingImport === write) session.pendingImport = false
        if (kind === 'sequence' && sequenceReview) {
          sequenceReview.unknownPending = false
          sequenceReview.unknownWrite = null
          sequenceReview.submitting = false
          if (sequenceReview.isMotion) {
            sequenceReview.operationId = createOperationId()
            if (Number.isInteger(session.project?.revision)) sequenceReview.revision = session.project.revision
          } else if (sequenceReview.committedBatchCount === 0) {
            invalidateUncommittedSequenceBatches(sequenceReview)
          }
          if (nodes.sequenceImport) nodes.sequenceImport.disabled = Boolean(sequenceReview.previewStale)
          syncSequenceActionButtons()
        }
        if (session.confirm?.owner === write) closeConfirm()
        renderChrome()
        if (operationStillCurrent(write)) showToast(error.reason || VNEXT_PROJECT_COPY.saveFailed)
      } finally {
        write.retrying = false
        if (write.dismissed && session.pendingImport === write) session.pendingImport = false
      }
    }
  }

  async function handleConflict(error, write) {
    if (!writeStillCurrent(write) || confirmedOpenInFlight()) return
    try {
      const latest = await api.getProject(write.projectId, { token: api.openEpoch.current })
      if (!writeStillCurrent(write) || confirmedOpenInFlight() || !latest.ok || latest.stale) return
      const rows = compareLayoutConflict(view.drafts, Object.values(latest.project.canvases || {}))
      const details = rows.map((row) => (
        `${row.canvas_id}: draft ${row.draft.x},${row.draft.y} · latest ${row.latest.x},${row.latest.y}`
      )).join('\n')
      openConfirm({
        title: VNEXT_PROJECT_COPY.conflictTitle,
        body: VNEXT_PROJECT_COPY.conflictBody,
        details,
        primary: VNEXT_PROJECT_COPY.keepDraft,
        secondary: VNEXT_PROJECT_COPY.discardLoad,
        onPrimary: () => {
          closeConfirm()
        },
        onSecondary: async () => {
          if (!writeStillCurrent(write)) {
            closeConfirm()
            return
          }
          view.discardDrafts()
          closeConfirm()
          await applyProject(latest.project, { write })
        },
      })
    } catch {
      if (writeStillCurrent(write)) showToast(error.reason || VNEXT_PROJECT_COPY.saveFailed)
    }
  }

  function bindUnknown(write, error) {
    if (write && error?.request) write.request = error.request
  }

  async function savePositions() {
    if (session.blankSubmitting) { setCanvasStatus('Wait for canvas creation to finish.'); return }
    if (session.blankUnconfirmed) { openUnknown('blank', session.blankUnconfirmed); return }
    if (concurrentLayoutBlocked(session)) { setCanvasStatus(concurrentLayoutMessage(session)); return }
    if (!session.project || blockPendingHistoryEdit()) return
    if (projectChangeInFlight()) { setCanvasStatus('Wait for the project to finish opening.'); return }
    const projectId = session.project.id
    const expectedRevision = session.layoutBaseRevision ?? session.project.revision
    const started = beginPendingSave(session, view.listedDirtyPositions())
    if (!started) return
    const positions = started.positions
    const write = rememberWrite('save', projectId, { positions })
    session.lastSaveSnapshot = positions
    renderChrome()
    try {
      const result = await api.saveLayout(projectId, {
        expectedRevision,
        positions,
      })
      if (!writeStillCurrent(write)) return
      if (!result.receipt) {
        showToast(VNEXT_PROJECT_COPY.saveFailed)
        return
      }
      session.project = result.project
      session.layoutBaseRevision = result.project?.revision
      session.layoutRevisionPinned = false
      session.boundProjectId = result.project?.id ?? session.boundProjectId
      session.saveReceipt = result.receipt
      view.applySavedPositions(positions)
      showToast(VNEXT_PROJECT_COPY.saved)
    } catch (error) {
      if (!writeStillCurrent(write)) return
      if (error.kind === 'stale') {
        await handleConflict(error, write)
      } else if (error.kind === 'unknown') {
        bindUnknown(write, error)
        openUnknown('save', write)
      } else {
        showToast(error.reason || VNEXT_PROJECT_COPY.saveFailed)
      }
    } finally {
      if (session.pendingSave === started) session.pendingSave = null
      renderCanvas()
    }
  }

  function notifyDraftChange() {
    try {
      root.dispatchEvent(new Event('vnext-draft-change'))
    } catch {
      root.dispatchEvent({ type: 'vnext-draft-change' })
    }
  }

  function setCanvasStatus(text, { error = false } = {}) {
    const node = root.querySelector('#vnext-canvas-status')
    if (!node) return
    node.textContent = text || ''
    node.hidden = !text
    node.classList.toggle('is-error', Boolean(text) && error)
  }

  function rejectCanvasImport(reason) {
    setCanvasStatus(reason, { error: true })
    showToast(reason)
    // Guide the user without retaining a File or creating a project implicitly.
    if (!session.project) setMenuOpen(true)
  }

  function readWorkingRevision(documentId) {
    if (!documentId) return null
    const entry = session.project?.sprite_documents?.[documentId]
    if (entry && Number.isInteger(entry.working_revision)) return entry.working_revision
    const doc = session.documents?.get?.(documentId)
    if (doc && Number.isInteger(doc.working_revision)) return doc.working_revision
    return null
  }

  function setSelectionEdit(on) {
    root.querySelector('.vnext-left')?.classList.toggle('is-selection-edit', Boolean(on))
  }

  function bindConversationRef(canvasId, { consumed = false } = {}) {
    const canvas = view.canvases.find((item) => item.id === canvasId)
    if (!canvas || canvas.transient || !session.project) return
    const documentId = canvas.document_id || ''
    session.conversationRef = {
      projectId: session.project.id,
      canvasId: canvas.id,
      documentId,
      projectRevision: session.project.revision,
      workingRevision: readWorkingRevision(documentId),
      name: canvas.name || canvas.id,
    }
    session.contextDismissed = false
    session.consumedConversationRef = consumed ? session.conversationRef : null
    renderConversationRef()
    notifyDraftChange()
  }

  // Sending consumes the composer attachment, not the selected canvas or the
  // request's frozen source. A failed send can restore only that same attachment.
  session.consumeConversationRef = () => {
    const ref = session.conversationRef
    if (!ref || session.contextDismissed || session.consumedConversationRef === ref) return null
    session.consumedConversationRef = ref
    renderConversationRef()
    return ref
  }
  session.restoreConversationRef = ref => {
    if (!ref || session.conversationRef !== ref || session.consumedConversationRef !== ref) return
    session.consumedConversationRef = null
    renderConversationRef()
  }

  // View-only transparency checkerboard under a canvas: a sibling behind the tile (not the tile's own
  // background, which the stroke preview hides), scaled with the world so one square is 8 sprite pixels.
  // Exports, the eyedropper and hit testing read pixel data, never this element.
  function renderCanvasBackdrop(world, tile, canvas, pos) {
    let backdrop = world.querySelector(`[data-canvas-backdrop="${canvas.id}"]`)
    if (!backdrop) {
      backdrop = el('div', { className: 'vnext-canvas-backdrop', 'data-canvas-backdrop': canvas.id, 'aria-hidden': 'true' })
      if (typeof world.insertBefore === 'function') world.insertBefore(backdrop, tile); else world.append(backdrop)
    }
    backdrop.hidden = Boolean(canvas.transient) // generated candidates keep their own preview image
    backdrop.style.width = `${canvas.width}px`
    backdrop.style.height = `${canvas.height}px`
    backdrop.style.transform = `translate(${pos.x}px, ${pos.y}px)`
  }

  // View-only pixel grid in screen space (1 px lines) from 400%; drawn over the artwork, under the overlays.
  function renderPixelGrid(canvas, pos, hostRect) {
    let grid = nodes.stage.querySelector(`[data-canvas-grid="${canvas.id}"]`)
    const show = session.pixelGrid !== false && view.zoom >= VNEXT_PIXEL_GRID_MIN_ZOOM && !canvas.transient
    if (!show) { grid?.remove(); return }
    if (!grid) {
      grid = el('div', { className: 'vnext-pixel-grid', 'data-canvas-grid': canvas.id, 'aria-hidden': 'true' })
      nodes.stage.append(grid)
    }
    const host = hostRect || nodes.stage.getBoundingClientRect()
    const origin = view.worldToScreen(pos.x, pos.y, host)
    const far = view.worldToScreen(pos.x + canvas.width, pos.y + canvas.height, host)
    grid.style.left = `${origin.x - host.left}px`
    grid.style.top = `${origin.y - host.top}px`
    grid.style.width = `${Math.max(0, far.x - origin.x)}px`
    grid.style.height = `${Math.max(0, far.y - origin.y)}px`
    grid.style.backgroundSize = `${view.zoom}px ${view.zoom}px`
  }

  function renderCanvasFrame(canvas, pos, hostRect) {
    let frame = nodes.stage.querySelector(`[data-canvas-frame="${canvas.id}"]`)
    if (view.selectedId !== canvas.id) {
      frame?.remove()
      return
    }
    if (!frame) {
      frame = el('div', { className: 'vnext-canvas-frame', 'data-canvas-frame': canvas.id })
      nodes.stage.append(frame)
    }
    const host = hostRect || nodes.stage.getBoundingClientRect()
    const origin = view.worldToScreen(pos.x, pos.y, host)
    const far = view.worldToScreen(pos.x + canvas.width, pos.y + canvas.height, host)
    frame.style.left = `${origin.x - host.left}px`
    frame.style.top = `${origin.y - host.top}px`
    frame.style.width = `${Math.max(0, far.x - origin.x)}px`
    frame.style.height = `${Math.max(0, far.y - origin.y)}px`
  }

  function renderCanvasName(world, canvas, pos) {
    const editing = session.nameEdit?.canvasId === canvas.id && session.nameEdit?.projectId === session.project?.id
    let label = world.querySelector(`[data-canvas-name="${canvas.id}"]`)
    const zoom = view.zoom || 1
    if (editing) {
      if (!label || label.tagName !== 'INPUT') {
        label?.remove?.()
        label = el('input', {
          className: 'vnext-canvas-name-input',
          'data-canvas-name': canvas.id,
          type: 'text',
          'aria-label': 'Canvas name',
        })
        label.value = session.nameEdit.draft
        const isolatePointer = (event) => event.stopPropagation?.()
        label.addEventListener('pointerdown', isolatePointer)
        label.addEventListener('pointermove', isolatePointer)
        label.addEventListener('mousedown', isolatePointer)
        label.addEventListener('wheel', (event) => {
          view.resetWheelZoom?.()
          event.stopPropagation?.()
        }, { passive: true })
        label.addEventListener('compositionstart', () => {
          if (session.nameEdit?.canvasId === canvas.id) session.nameEdit.composing = true
        })
        label.addEventListener('compositionend', () => {
          if (session.nameEdit?.canvasId === canvas.id) session.nameEdit.composing = false
        })
        label.addEventListener('input', () => {
          if (session.nameEdit?.canvasId !== canvas.id) return
          session.nameEdit.draft = label.value
          if (session.nameEdit.submitted && label.value === session.nameEdit.submitted.displayName) {
            session.nameEdit.confirmNew = false
          }
        })
        label.addEventListener('keydown', (event) => {
          event.stopPropagation?.()
          if (event.isComposing || event.key === 'Process' || session.nameEdit?.composing) return
          if (event.key === 'Enter') {
            event.preventDefault?.()
            commitNameEdit()
          } else if (event.key === 'Escape') {
            event.preventDefault?.()
            cancelNameEdit()
          }
        })
        label.addEventListener('blur', () => {
          const edit = session.nameEdit
          if (!edit || edit.committing || edit.canvasId !== canvas.id) return
          if (edit.keepDraft || edit.submitted || edit.needsReconfirm || edit.confirmNew) return
          // Leaving a normal edit saves it; uncertain/failed saves still require
          // explicit confirmation, and Escape remains the cancellation path.
          commitNameEdit()
        })
        world.append(label)
        if (session.nameEdit.focus) {
          session.nameEdit.focus = false
          label.focus?.()
          label.select?.()
        }
      }
    } else if (!label || label.tagName === 'INPUT') {
      label?.remove?.()
      label = el('button', {
        type: 'button',
        className: 'vnext-canvas-name',
        'data-canvas-name': canvas.id,
      })
      label.addEventListener('pointerdown', (event) => event.stopPropagation?.())
      label.addEventListener('click', (event) => {
        event.stopPropagation?.()
        // Like any click elsewhere this places open text first; the draft's own image is just reselected.
        if (canvas.id !== session.textDraftCanvasId?.() && session.finishTextDraft?.() === false) return
        view.select(canvas.id)
        bindConversationRef(canvas.id)
        refreshTimeline(); renderCanvas() // same as selecting by clicking the image: panel and timeline follow
      })
      label.addEventListener('dblclick', (event) => {
        event.preventDefault?.()
        event.stopPropagation?.()
        beginNameEdit(canvas.id)
      })
      world.append(label)
    }
    if (label.tagName !== 'INPUT') {
      label.textContent = canvas.name || ''
      label.style.maxWidth = `${Math.min(336, canvas.width * zoom)}px`
    }
    label.title = canvas.name || ''
    const nameHeight = label.offsetHeight || (label.tagName === 'INPUT' ? 24 : 16)
    label.style.transformOrigin = 'left bottom'
    label.style.transform = `translate(${pos.x}px, ${pos.y - 4 / zoom - nameHeight}px) scale(${1 / zoom})`
  }

  function beginNameEdit(canvasId) {
    if (concurrentLayoutBlocked(session)) { setCanvasStatus(concurrentLayoutMessage(session)); return }
    if (blockPendingHistoryEdit()) return
    const canvas = view.canvases.find((item) => item.id === canvasId)
    if (!canvas || canvas.transient || !session.project) return
    view.resetWheelZoom?.()
    session.nameEdit = {
      canvasId,
      projectId: session.project.id,
      openEpoch: api.openEpoch.current,
      expectedRevision: session.project.revision,
      draft: canvas.name || '',
      operationId: null,
      submitted: null,
      committing: false,
      composing: false,
      keepDraft: false,
      needsReconfirm: false,
      confirmNew: false,
      focus: true,
    }
    renderCanvas()
  }

  function cancelNameEdit() {
    if (!session.nameEdit || session.nameEdit.committing) return
    session.nameEdit = null
    renderCanvas()
  }

  function nameEditLive(edit) {
    return Boolean(edit)
      && session.nameEdit === edit
      && session.project?.id === edit.projectId
      && api.openEpoch.isCurrent(edit.openEpoch)
  }

  function recoverNameEditAfterAbandonedOpen() {
    const edit = session.nameEdit
    if (!edit || session.project?.id !== edit.projectId) return
    if (api.openEpoch.isCurrent(edit.openEpoch)) return
    edit.committing = false
    edit.keepDraft = true
    edit.operationId = null
    edit.submitted = null
    edit.needsReconfirm = true
    edit.openEpoch = api.openEpoch.current
  }

  function releaseInterruptedNameEdit(edit) {
    if (session.nameEdit !== edit || session.project?.id !== edit.projectId) return
    if (api.openEpoch.isCurrent(edit.openEpoch)) return
    recoverNameEditAfterAbandonedOpen()
  }

  const HISTORY_LIMIT = 64
  // Records of result canvases this page's own Undo removed (createUndonePlacementStore in
  // vnext-saved-project.js). The page that keeps result records sets the store; the session decides
  // when a record is kept or dropped and persists nothing itself.
  session.undonePlacements = null

  function historyForProject() {
    if (!session.project) return null
    if (session.history?.projectId !== session.project.id) {
      session.history = session.pendingHistory.get(session.project.id)?.history
        || { projectId: session.project.id, undo: [], redo: [], pixelHeads: new Map() }
    }
    return session.history
  }

  function pushHistory(entry) {
    if (entry.projectId !== session.project?.id) return
    const history = historyForProject()
    if (!history) return
    history.undo.push(entry)
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
    history.redo = []
  }

  function invalidateChangedPixelHistory(documentId, revision) {
    const history = historyForProject()
    const known = history?.pixelHeads.get(documentId)
    if (known === undefined || known === revision) return
    // A reloaded external edit is not a new baseline for an old undo request.
    for (const entry of [...history.undo, ...history.redo]) {
      if ((entry.kind === 'pixels' || entry.manualPixels) && entry.documentId === documentId) entry.invalidated = true
    }
  }

  function historyPending() {
    return session.pendingHistory.get(session.project?.id)
  }

  function blockPendingHistoryEdit() {
    if (session.manualGesture || session.manualWrite) {
      if (session.manualWrite?.running) return true
      setCanvasStatus(session.textDraftOpen?.() ? 'Place or discard the text first: Done or Discard in the Text panel.'
        : 'Finish the current stroke or resolve its save before editing.')
      session.manualWrite?.recover?.()
      return true
    }
    if (session.pixelCopyPending) {
      setCanvasStatus('The new copy is not settled yet. Resolve its save before editing.')
      session.resolvePixelCopy?.()
      return true
    }
    if (session.referencePending?.()) {
      setCanvasStatus('Verify the pending reference update before editing.', { error: true })
      return true
    }
    const pending = historyPending()
    if (!pending) return false
    const message = pending.entry.refreshPending
      ? 'Undo/redo was saved. Press the same shortcut to reload it before editing.'
      : pending.unknown
        ? 'Undo/redo result is unknown. Press the same shortcut to check it before editing.'
        : 'Undo/redo in progress. Please wait.'
    setCanvasStatus(message, { error: Boolean(pending.unknown) })
    return true
  }

  function sameHistoryContext(projectId, openEpoch) {
    return session.project?.id === projectId && api.openEpoch.isCurrent(openEpoch)
  }

  function frozenHistoryRequest(entry, direction) {
    const key = direction === 'undo' ? 'undoRequest' : 'redoRequest'
    if (!entry[key]) {
      entry[key] = {
        operationId: globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}`,
        expectedRevision: session.project.revision,
        projectId: session.project.id,
        canvasId: entry.canvasId,
        openEpoch: api.openEpoch.current,
        omitted: direction === 'undo' ? Boolean(entry.beforeOmitted) : false,
        displayName: direction === 'undo' ? entry.beforeName : entry.afterName,
        detachOperationId: entry.detachOperationId || null,
        documentId: entry.documentId,
        expectedWorkingRevision: session.project.sprite_documents?.[entry.documentId]?.working_revision,
        targetRevision: direction === 'undo' ? entry.beforeRevision : entry.afterRevision,
        ...(entry.structure ? { mode: 'structure' } : {}),
      }
    }
    return entry[key]
  }

  async function applyHistoryProject(projectId, openEpoch, project) {
    if (!sameHistoryContext(projectId, openEpoch)) return false
    const applied = await applyProject(project, { preserveView: true, token: openEpoch })
    return Boolean(applied && !applied.stale && sameHistoryContext(projectId, openEpoch))
  }

  function noteHistoryError(error, projectId, openEpoch) {
    if (!sameHistoryContext(projectId, openEpoch)) return
    if (blockPendingHistoryEdit()) return
    if (error?.kind === 'stale') {
      setCanvasStatus('That step was not saved. Refresh before trying again.', { error: true })
      return
    }
    setCanvasStatus(error?.reason || 'Undo could not be saved.', { error: true })
  }

  async function submitHistoryWrite(entry, direction, projectId, openEpoch) {
    const request = frozenHistoryRequest(entry, direction)
    if (entry.refreshPending) return finishHistoryRefresh(entry, direction, projectId, openEpoch)
    let result
    if (entry.kind === 'pixels') {
      result = await api.restoreWorking(request.projectId, request.documentId, request)
      const revision = pixelWriteReceipt(result, request, request.projectId, request.documentId)
      session.pendingHistory.get(projectId).history.pixelHeads.set(entry.documentId, revision)
    } else if (entry.kind === 'rename') {
      result = request.omitted
        ? await api.resetCanvasName(request.projectId, request.canvasId, {
          operationId: request.operationId,
          expectedRevision: request.expectedRevision,
        })
        : await api.renameCanvas(request.projectId, request.canvasId, {
          operationId: request.operationId,
          expectedRevision: request.expectedRevision,
          displayName: request.displayName,
        })
    } else if (direction === 'undo') {
      entry.detachOperationId = request.operationId
      // A result's canvas keeps a record of exactly this detach, so the saved sheet can still be put
      // back after a page reload empties this history (session.restoreUndonePlacement).
      if (entry.placement) session.undonePlacements?.remember({ projectId: request.projectId, canvasId: request.canvasId,
        documentId: entry.documentId, detachOperationId: request.operationId, jobId: entry.placement.jobId })
      result = await api.detachCanvas(request.projectId, request.canvasId, {
        operationId: request.operationId,
        expectedRevision: request.expectedRevision,
      })
    } else {
      result = await api.restoreCanvas(request.projectId, request.canvasId, {
        operationId: request.operationId,
        expectedRevision: request.expectedRevision,
        detachOperationId: request.detachOperationId,
      })
    }
    if (!result?.receipt) {
      session.pendingHistory.get(projectId).unknown = true
      return false
    }
    session.pendingHistory.get(projectId).unknown = false
    if (entry.placement && entry.kind === 'import' && direction === 'redo') session.undonePlacements?.forget(request)
    entry.refreshPending = {
      operationId: request.operationId,
      direction,
      project: result.project,
      projectId,
      openEpoch,
    }
    if (!sameHistoryContext(projectId, openEpoch)) {
      return false
    }
    return finishHistoryRefresh(entry, direction, projectId, openEpoch)
  }

  async function finishHistoryRefresh(entry, direction, projectId, openEpoch) {
    const pending = entry.refreshPending
    if (!pending || pending.direction !== direction || !sameHistoryContext(projectId, openEpoch)) return false
    let project = pending.project
    // A reopened project may be newer than the receipt. Reload without reissuing the write.
    if (pending.openEpoch !== openEpoch || session.project.revision > project.revision) {
      const loaded = await api.getProject(projectId, { token: openEpoch })
      if (!loaded.ok || loaded.stale || loaded.aborted || !sameHistoryContext(projectId, openEpoch)) return false
      project = loaded.project
    }
    const refreshed = await applyHistoryProject(projectId, openEpoch, project)
    if (!refreshed) return false
    entry.refreshPending = null
    if (entry.kind === 'import' && direction === 'redo' && sameHistoryContext(projectId, openEpoch) && entry.to) {
      view.moveDraft(entry.canvasId, entry.to.x, entry.to.y)
      renderCanvas()
    }
    return true
  }

  async function runHistoryStep(entry, direction) {
    if (session.manualWrite?.partialKnownFailure && typeof session.manualWrite.releasePartial === 'function') {
      session.manualWrite.releasePartial()
    }
    if (session.pendingImport?.partialKnownFailure && typeof session.pendingImport.releasePartial === 'function') {
      closeConfirm()
      session.pendingImport.releasePartial()
    }
    if (session.pixelCopyPending || session.manualGesture || session.manualWrite) { blockPendingHistoryEdit(); return false }
    if (projectChangeInFlight()) { setCanvasStatus('Wait for the project to finish opening.'); return false }
    if (!entry || session.historyBusy || !session.project) return false
    const projectId = session.project.id
    const openEpoch = api.openEpoch.current
    if (entry.projectId !== projectId || !sameHistoryContext(projectId, openEpoch)) return false
    const pending = historyPending()
    if (pending && (pending.entry !== entry || pending.direction !== direction)) {
      blockPendingHistoryEdit()
      return false
    }
    if (session.pendingSave || session.pendingImport || session.nameEdit?.committing || drag?.kind === 'move') return false
    if ((entry.kind === 'pixels' || entry.manualPixels) && !pending) {
      invalidateChangedPixelHistory(entry.documentId, session.project.sprite_documents?.[entry.documentId]?.working_revision)
      if (entry.invalidated) {
        setCanvasStatus('This image changed elsewhere. Its earlier pixel undo history is no longer available.', { error: true })
        return false
      }
    }
    if (entry.kind !== 'move' && !pending) {
      session.pendingHistory.set(projectId, { entry, direction, history: historyForProject(), unknown: false })
    }
    session.historyBusy = true
    renderChrome()
    try {
      if (entry.kind === 'move') {
        const target = direction === 'undo' ? entry.from : entry.to
        if (!sameHistoryContext(projectId, openEpoch) || !view.canvases.some((item) => item.id === entry.canvasId)) return false
        view.moveDraft(entry.canvasId, target.x, target.y)
        renderCanvas()
        return sameHistoryContext(projectId, openEpoch)
      }
      if (entry.kind === 'rename' || entry.kind === 'import' || entry.kind === 'pixels') {
        const done = await submitHistoryWrite(entry, direction, projectId, openEpoch)
        if (!done && sameHistoryContext(projectId, openEpoch)) blockPendingHistoryEdit()
        return done
      }
      return false
    } catch (error) {
      const operation = session.pendingHistory.get(projectId)
      if (operation && error?.kind === 'unknown') operation.unknown = true
      if (operation && error?.submittedUnknown === false && !entry.refreshPending) operation.unknown = false
      if (operation && !operation.unknown && !entry.refreshPending) session.pendingHistory.delete(projectId)
      noteHistoryError(error, projectId, openEpoch)
      return false
    } finally {
      session.historyBusy = false
      renderChrome()
    }
  }

  function commitHistoryPointer(history, entry, direction, projectId, openEpoch) {
    if (!sameHistoryContext(projectId, openEpoch)) return
    if (direction === 'undo') {
      if (history.undo.at(-1) !== entry) return
      history.undo.pop()
      history.redo.push(entry)
      entry.redoRequest = null
      session.pendingHistory.delete(projectId)
      restoreHistorySelection(entry, direction)
      setCanvasStatus('')
      renderChrome()
      // Results bound to this entry (a sheet's Undo / Redo) re-read where it now is.
      notifyDraftChange()
      return
    }
    if (history.redo.at(-1) !== entry) return
    history.redo.pop()
    history.undo.push(entry)
    entry.undoRequest = null
    session.pendingHistory.delete(projectId)
    restoreHistorySelection(entry, direction)
    setCanvasStatus('')
    renderChrome()
    notifyDraftChange()
  }

  // Selection moves/pastes put the marquee back with their pixels.
  function restoreHistorySelection(entry, direction) {
    if (!entry.selection || entry.projectId !== session.project?.id) return
    const rect = direction === 'undo' ? entry.selection.before : entry.selection.after
    if (rect) session.pixelSelection = { projectId: entry.projectId, canvasId: entry.canvasId, rect: { ...rect } }
    // No marquee before (e.g. a paste into another image): clear only a marquee on this same canvas.
    else if (session.pixelSelection?.canvasId === entry.canvasId) session.pixelSelection = null
  }

  async function undoHistory() {
    if (session.historyBusy) return
    const history = historyForProject()
    const entry = history?.undo?.at(-1)
    if (!entry || !session.project) return
    const projectId = session.project.id
    const openEpoch = api.openEpoch.current
    const done = await runHistoryStep(entry, 'undo')
    if (done) commitHistoryPointer(history, entry, 'undo', projectId, openEpoch)
  }

  async function redoHistory() {
    if (session.historyBusy) return
    const history = historyForProject()
    const entry = history?.redo?.at(-1)
    if (!entry || !session.project) return
    const projectId = session.project.id
    const openEpoch = api.openEpoch.current
    const done = await runHistoryStep(entry, 'redo')
    if (done) commitHistoryPointer(history, entry, 'redo', projectId, openEpoch)
  }

  // Records the Undo entry of one confirmed canvas addition and returns it, so the result that
  // made the canvas can bind its Undo to exactly this entry. A replayed or recovered addition of
  // the same canvas returns the entry it already has (or null once it was undone) instead of
  // recording a second one.
  function recordCanvasAdditionEntry(projectId, canvasId, documentId, point) {
    if (!canvasId || session.project?.id !== projectId || !session.project.canvases?.[canvasId]) return null
    const history = historyForProject()
    if (!history) return null
    const same = entry => entry.kind === 'import' && entry.projectId === projectId && entry.canvasId === canvasId
    const existing = history.undo.find(same)
    if (existing) return existing
    if (history.redo.some(same)) return null
    pushHistory({ kind: 'import', projectId, canvasId, documentId, to: { x: point.x, y: point.y } })
    return history.undo.at(-1) || null
  }

  function rememberSuccessfulImport(result, write) {
    if (!writeStillCurrent(write) || session.project?.id !== write.projectId) return null
    const documentId = result?.document?.document_id || result?.receipt?.document_id || ''
    const canvas = canvasForImport({
      beforeIds: write.canvasIds || [],
      project: session.project,
      documentId,
    })
    if (!canvas || (write.canvasIds || []).includes(canvas.id)) return null
    const stored = session.project.canvases?.[canvas.id]
    const point = write.dropPoint || { x: stored?.x ?? canvas.x ?? 0, y: stored?.y ?? canvas.y ?? 0 }
    return recordCanvasAdditionEntry(session.project.id, canvas.id, documentId, point)
  }

  function confirmedCanvasName(remote, canvas, canvasId, displayName) {
    const custom = Object.hasOwn(remote, 'display_name') ? (remote.display_name || '') : ''
    const confirmed = canvas.id === canvasId ? (custom || displayName || '') : custom
    const manifestName = session.documents?.get?.(canvas.document_id)?.name || canvas.manifest_name || ''
    return { display_name: confirmed, name: confirmed || manifestName }
  }

  function applyConfirmedName(project, canvasId, displayName) {
    const stored = project?.canvases || {}
    const locals = view.canvases.filter((canvas) => !canvas.transient)
    if (locals.some((canvas) => !stored[canvas.id]) || Object.keys(stored).some((id) => !locals.some((canvas) => canvas.id === id))) return false
    for (const canvas of locals) {
      const remote = stored[canvas.id]
      canvas.x = remote.x
      canvas.y = remote.y
      const resolved = confirmedCanvasName(remote, canvas, canvasId, displayName)
      canvas.display_name = resolved.display_name
      canvas.name = resolved.name
    }
    session.project = project
    return true
  }

  async function commitNameEdit() {
    if (session.pendingImport || session.blankSubmitting || session.confirmedImport || session.manualWrite || session.manualGesture) {
      setCanvasStatus(concurrentLayoutMessage(session))
      return
    }
    if (blockPendingHistoryEdit()) return
    const edit = session.nameEdit
    if (!edit || edit.committing || edit.composing) return
    const canvas = view.canvases.find((item) => item.id === edit.canvasId)
    const value = edit.draft
    if (!canvas || !nameEditLive(edit)) {
      session.nameEdit = null
      return
    }
    if (edit.submitted && value !== edit.submitted.displayName) {
      if (!edit.confirmNew) {
        edit.confirmNew = true
        edit.keepDraft = true
        setCanvasStatus('Unconfirmed save kept the original name. Confirm again to save this draft.', { error: true })
        return
      }
      edit.operationId = null
      edit.submitted = null
      edit.confirmNew = false
    }
    if (value === canvas.name && !edit.submitted) {
      session.nameEdit = null
      renderCanvas()
      return
    }
    if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128 || /[\u0000-\u001f]/.test(value)) {
      edit.keepDraft = true
      setCanvasStatus('Name must be 1-128 characters without surrounding spaces.', { error: true })
      return
    }
    const submitted = edit.submitted && value === edit.submitted.displayName
      ? edit.submitted
      : null
    const operationId = submitted?.operationId
      || (edit.needsReconfirm ? null : edit.operationId)
      || (globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}`)
    const displayName = submitted?.displayName || value
    const expectedRevision = submitted?.expectedRevision || edit.expectedRevision
    const storedCanvas = session.project?.canvases?.[edit.canvasId]
    const nameBefore = {
      omitted: !storedCanvas || !Object.hasOwn(storedCanvas, 'display_name'),
      name: storedCanvas?.display_name || '',
    }
    edit.operationId = operationId
    edit.submitted = {
      operationId,
      displayName,
      expectedRevision,
      projectId: edit.projectId,
      canvasId: edit.canvasId,
    }
    edit.needsReconfirm = false
    edit.confirmNew = false
    edit.committing = true
    edit.keepDraft = true
    setCanvasStatus('Saving name…')
    const bound = {
      projectId: edit.projectId,
      canvasId: edit.canvasId,
      operationId,
      openEpoch: edit.openEpoch,
    }
    try {
      const result = await api.renameCanvas(bound.projectId, bound.canvasId, {
        operationId,
        expectedRevision,
        displayName,
      })
      if (!nameEditLive(edit) || session.nameEdit?.operationId !== bound.operationId) {
        releaseInterruptedNameEdit(edit)
        return
      }
      if (!result?.receipt) {
        edit.committing = false
        setCanvasStatus('Name could not be saved. The draft was kept.', { error: true })
        return
      }
      const dirtyLayout = view.listedDirtyPositions().length > 0
      const local = !dirtyLayout && projectPixelsUnchanged(session.project, result.project) && applyConfirmedName(result.project, bound.canvasId, displayName)
      if (local) {
        session.layoutBaseRevision = result.project.revision
        session.layoutRevisionPinned = false
      }
      const applied = local ? { stale: false } : await applyProject(result.project, { preserveView: true, token: bound.openEpoch })
      if (!nameEditLive(edit) || applied?.stale) {
        if (session.nameEdit === edit) edit.committing = false
        return
      }
      if (session.nameEdit?.operationId === bound.operationId) session.nameEdit = null
      if (session.project?.id === bound.projectId && (nameBefore.omitted || nameBefore.name !== displayName)) {
        pushHistory({
          kind: 'rename',
          projectId: bound.projectId,
          canvasId: bound.canvasId,
          beforeOmitted: nameBefore.omitted,
          beforeName: nameBefore.name,
          afterName: displayName,
        })
      }
      renderCanvas()
      setCanvasStatus('')
    } catch (error) {
      if (!nameEditLive(edit) || session.nameEdit?.operationId !== bound.operationId) {
        releaseInterruptedNameEdit(edit)
        return
      }
      edit.committing = false
      edit.keepDraft = true
      noteSessionError(error)
      if (error.kind === 'stale') {
        edit.operationId = null
        edit.submitted = null
        edit.needsReconfirm = true
        const loaded = await api.getProject(bound.projectId, { token: bound.openEpoch })
        if (!nameEditLive(edit) || session.project?.id !== bound.projectId) return
        if (loaded?.ok && !loaded.stale && loaded.project?.id === bound.projectId) {
          edit.expectedRevision = loaded.project.revision
        }
        setCanvasStatus('Name was not saved. Confirm again to save this draft.', { error: true })
        return
      }
      if (error.kind === 'unknown') {
        edit.submitted = {
          operationId,
          displayName,
          expectedRevision,
          projectId: bound.projectId,
          canvasId: bound.canvasId,
        }
        setCanvasStatus('Name save was not confirmed. Retry keeps the original name.')
        return
      }
      setCanvasStatus(error.reason || 'Name could not be saved. The draft was kept.', { error: true })
    }
  }

  function renderConversationRef() {
    const node = root.querySelector('#vnext-canvas-ref')
    const later = root.querySelector('#vnext-edit-later')
    const input = root.querySelector('#vnext-prompt-input')
    const slot = root.querySelector('.vnext-ref-image')
    const fileInput = root.querySelector('#vnext-ref-input')
    if (node) node.hidden = true
    if (later) later.hidden = true
    setSelectionEdit(false)
    const ref = session.conversationRef
    const canvas = ref ? view.canvases.find((item) => item.id === ref.canvasId) : null
    const showSelection = Boolean(ref && session.consumedConversationRef !== ref && !session.contextDismissed && canvas && !canvas.transient && session.project?.id === ref.projectId)
    if (ref && (!canvas || session.project?.id !== ref.projectId)) session.conversationRef = null
    if (!showSelection) {
      if (slot) {
        delete slot.dataset.canvasSelection
        slot.classList.remove('is-canvas-selection')
      }
      if (fileInput) fileInput.disabled = false
      if (slot) renderReferenceSlot(root)
      if (input && input.placeholder === 'Message…') {
        input.placeholder = 'Message…'
      }
      return
    }
    ref.projectRevision = session.project.revision
    ref.documentId = canvas.document_id || ref.documentId
    const working = readWorkingRevision(ref.documentId)
    if (working != null) ref.workingRevision = working
    ref.name = canvas.name || ref.name
    if (slot) {
      slot.dataset.canvasSelection = '1'
      slot.classList.add('is-canvas-selection')
      const empty = slot.querySelector('.vnext-ref-empty')
      const filled = slot.querySelector('.vnext-ref-filled')
      const preview = slot.querySelector('#vnext-ref-preview')
      const name = slot.querySelector('#vnext-ref-name')
      const clear = slot.querySelector('.vnext-ref-clear')
      if (empty) empty.hidden = true
      if (filled) filled.hidden = false
      if (clear) {
        clear.hidden = false
        clear.title = 'Remove from conversation. The canvas stays.'
        clear.setAttribute('aria-label', 'Remove from conversation. The canvas stays.')
      }
      if (preview) {
        const url = locatorPreviewUrl(canvas)
        if (url) { if (preview.getAttribute('src') !== url) preview.src = url }
        else preview.removeAttribute('src')
        preview.alt = ref.name
      }
      if (name) name.textContent = ref.name
      slot.classList.add('is-filled')
      slot.title = `${ref.name} · selected canvas. Remove does not delete it.`
    }
    if (fileInput) fileInput.disabled = true
    if (node) {
      node.dataset.projectId = ref.projectId
      node.dataset.canvasId = ref.canvasId
      node.dataset.documentId = ref.documentId
      node.dataset.projectRevision = String(ref.projectRevision ?? '')
      if (ref.workingRevision == null) delete node.dataset.workingRevision
      else node.dataset.workingRevision = String(ref.workingRevision)
    }
    if (input) input.placeholder = 'Message…'
  }

  function placeImportedCanvas(result, write) {
    if (!write?.dropPoint || !writeStillCurrent(write)) return
    const documentId = result?.document?.document_id || result?.receipt?.document_id || ''
    const canvas = canvasForImport({
      beforeIds: write.canvasIds || [],
      project: session.project,
      documentId,
    })
    if (!canvas) return
    view.moveDraft(canvas.id, write.dropPoint.x, write.dropPoint.y)
    view.select(canvas.id)
    bindConversationRef(canvas.id)
    renderCanvas()
    setCanvasStatus('Imported. Save positions to keep this drop point.')
  }

  function applyConfirmedDrop(confirmed, write) {
    if (!confirmed || confirmed.applied) return
    if (!writeStillCurrent(write) || session.project?.id !== confirmed.projectId) return
    placeImportedCanvas(confirmed.result, write)
    confirmed.applied = true
  }

  function settleConfirmedImport(confirmed, write) {
    if (confirmed.settled || !writeStillCurrent(write) || session.project?.id !== confirmed.projectId) return
    applyConfirmedDrop(confirmed, write)
    confirmed.historyEntry = rememberSuccessfulImport(confirmed.result, write)
    if (write.kind === 'blank' || write.kind === 'sequence') {
      const canvasId = confirmed.result.canvas?.id || Object.values(session.project.canvases).find(c => c.document_id === confirmed.result.receipt.document_id)?.id
      if (canvasId) { view.select(canvasId); bindConversationRef(canvasId); refreshTimeline(); const box = nodes.stage?.getBoundingClientRect(); view.fitAll(box?.width || 800, box?.height || 600); renderCanvas() }
    }
    // A file-picker or sequence import arrives at the origin; if an explicit anchor was selected or it covers
    // an existing canvas, draft a free position beside it (requiring explicit Save positions) instead of overlapping.
    let placedBeside = false
    if ((write.kind === 'import' || write.kind === 'sequence') && !write.dropPoint) {
      const documentId = confirmed.result.document?.document_id || confirmed.result.receipt?.document_id || ''
      const canvas = canvasForImport({ beforeIds: confirmed.canvasIds, project: session.project, documentId })
      const rendered = canvas && !confirmed.canvasIds.includes(canvas.id) && !view.drafts?.[canvas.id]
        && view.canvases.find(item => item.id === canvas.id && !item.transient)
      if (rendered) {
        const at = view.positionOf(canvas.id)
        const covered = view.canvases.find(other => other.id !== canvas.id && !other.transient && (() => {
          const o = view.positionOf(other.id)
          return at.x < o.x + other.width && at.x + rendered.width > o.x && at.y < o.y + other.height && at.y + rendered.height > o.y
        })())
        const anchorId = write.anchor?.id || write.anchor?.canvasId || ''
        const explicitAnchor = anchorId
          ? (view.canvases.find(other => other.id === anchorId && !other.transient) || { ...write.anchor, id: anchorId })
          : null
        const anchorTarget = explicitAnchor || covered
        if (anchorTarget) {
          try {
            const point = staticImagePosition(view, anchorTarget, { canvasId: canvas.id, width: rendered.width, height: rendered.height })
            if (point.x !== at.x || point.y !== at.y) {
              view.moveDraft(canvas.id, point.x, point.y)
              placedBeside = true
              // A requested (generated) image keeps the place its request chose: saved below.
              if (write.sourceJobId) confirmed.placedBeside = { canvasId: canvas.id, point }
              const historyEntry = historyForProject()?.undo?.at(-1)
              if (historyEntry?.kind === 'import' && historyEntry.canvasId === canvas.id) {
                historyEntry.to = { x: point.x, y: point.y }
              }
              if (write.kind === 'sequence') {
                const box = nodes.stage?.getBoundingClientRect()
                view.fitAll(box?.width || 800, box?.height || 600)
              }
              renderCanvas()
            }
          } catch { /* no free spot: leave the stored position */ }
        }
      }
    }
    confirmed.settled = true
    session.confirmedImport = null
    showToast('')
    if (write.dropPoint) setCanvasStatus('Imported. Save positions to keep this drop point.')
    else if (placedBeside && !confirmed.placedBeside) setCanvasStatus('Imported beside the existing canvases. Save canvas positions to keep it there.')
    else setCanvasStatus('')
  }

  function openImportReload(confirmed, write) {
    showToast('')
    setCanvasStatus(IMPORT_RELOAD_COPY.status)
    openConfirm({
      title: IMPORT_RELOAD_COPY.title,
      body: IMPORT_RELOAD_COPY.body,
      primary: IMPORT_RELOAD_COPY.primary,
      secondary: VNEXT_PROJECT_COPY.dismiss,
      onPrimary: async () => {
        if (!writeStillCurrent(write) || session.project?.id !== confirmed.projectId) {
          closeConfirm()
          return
        }
        try {
          await applyProject(confirmed.result.project, { preserveView: true, write })
          if (!writeStillCurrent(write) || session.project?.id !== confirmed.projectId) return
          settleConfirmedImport(confirmed, write)
          closeConfirm()
        } catch (error) {
          if (!writeStillCurrent(write)) return
          noteSessionError(error)
          setCanvasStatus(IMPORT_RELOAD_COPY.status)
        }
      },
      onSecondary: () => closeConfirm(),
    })
  }

  // Returns the outcome instead of implying success: 'settled' once the canvas shows the import
  // and its Undo entry exists; 'refresh_pending' when the import committed but the project did not
  // load. Dialog-driven imports open the Reload prompt; a requested result (inlineRecovery) reports
  // the pending refresh to its own turn, which offers the same reload inline.
  async function finishConfirmedImport(result, write, { inlineRecovery = false } = {}) {
    const confirmed = {
      projectId: write.projectId,
      dropPoint: write.dropPoint || null,
      canvasIds: [...(write.canvasIds || [])],
      result,
      applied: false,
    }
    session.confirmedImport = confirmed
    try {
      await applyProject(result.project, { preserveView: true, write })
    } catch (error) {
      if (!writeStillCurrent(write)) return { status: 'abandoned', confirmed }
      if (inlineRecovery) {
        setCanvasStatus(IMPORT_RELOAD_COPY.status)
        return { status: 'refresh_pending', confirmed }
      }
      noteSessionError(error)
      openImportReload(confirmed, write)
      return { status: 'refresh_pending', confirmed }
    }
    if (!writeStillCurrent(write)) return { status: 'abandoned', confirmed }
    settleConfirmedImport(confirmed, write)
    return { status: confirmed.settled ? 'settled' : 'abandoned', confirmed }
  }

  // Inline recovery of a committed import whose project did not load: it only reads the project
  // again and settles the same import once that newest read (at least as recent as the import) is
  // actually shown. A failed, stale, foreign or older read keeps the recovery; the import-time
  // snapshot is never shown in its place, so a newer change is never rolled back. It never
  // re-sends the import.
  async function retryConfirmedImportRefresh(confirmed, write) {
    if (!writeStillCurrent(write) || session.project?.id !== confirmed.projectId) return { status: 'abandoned', confirmed }
    if (confirmed.settled) return { status: 'settled', confirmed }
    const minimum = confirmed.result.project?.revision ?? 0
    const loaded = await api.getProject(confirmed.projectId, { token: api.openEpoch.current })
    if (!writeStillCurrent(write) || session.project?.id !== confirmed.projectId) return { status: 'abandoned', confirmed }
    if (!loaded?.ok || loaded.stale || loaded.aborted || !loaded.project || loaded.project.id !== confirmed.projectId
      || (loaded.project.revision ?? -1) < minimum) {
      setCanvasStatus(IMPORT_RELOAD_COPY.status)
      return { status: 'refresh_pending', confirmed }
    }
    let applied
    try {
      applied = await applyProject(loaded.project, { preserveView: true, write })
    } catch {
      if (!writeStillCurrent(write)) return { status: 'abandoned', confirmed }
      setCanvasStatus(IMPORT_RELOAD_COPY.status)
      return { status: 'refresh_pending', confirmed }
    }
    if (!writeStillCurrent(write)) return { status: 'abandoned', confirmed }
    if (applied?.committed !== true || applied.stale === true) {
      setCanvasStatus(IMPORT_RELOAD_COPY.status)
      return { status: 'refresh_pending', confirmed }
    }
    settleConfirmedImport(confirmed, write)
    return { status: confirmed.settled ? 'settled' : 'abandoned', confirmed }
  }

  function blankBusy() {
    return exportBusy() || Boolean(session.confirmedImport || session.hasAssistantWork?.())
  }
  function closeBlankDialog() {
    if (session.blankSubmitting) return
    if (nodes.blankRoot) nodes.blankRoot.hidden = true
    nodes.btn?.focus()
  }
  function openBlankDialog() {
    if (session.blankUnconfirmed) { openUnknown('blank', session.blankUnconfirmed); return }
    if (!session.project || blankBusy() || !nodes.blankRoot) return
    nodes.blankForm.reset()
    nodes.blankError.hidden = true
    nodes.blankRoot.hidden = false
    nodes.blankName.focus()
    nodes.blankName.select()
  }
  nodes.blankRoot?.addEventListener('click', event => {
    if (event.target.closest('[data-blank-cancel]')) closeBlankDialog()
  })
  nodes.blankRoot?.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBlankDialog() }
    if (event.key === 'Tab') {
      const controls = [...nodes.blankForm.querySelectorAll('input, button')].filter(n => !n.disabled)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus() }
    }
  })
  nodes.blankForm?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!session.project || blankBusy() || session.blankSubmitting) return
    const name = nodes.blankName.value.trim(), width = Number(nodes.blankWidth.value), height = Number(nodes.blankHeight.value)
    if (!name || /[\x00-\x1f\x7f]/.test(name) || name.length > 128 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024) {
      nodes.blankError.textContent = 'Use a name and whole-number dimensions from 1 to 1024.'; nodes.blankError.hidden = false; return
    }
    const write = rememberWrite('blank', session.project.id, { openToken: api.openEpoch.current, canvasIds: Object.keys(session.project.canvases || {}) })
    write.blankRequest = Object.freeze({ operationId: createOperationId(), expectedRevision: session.project.revision, name, width, height })
    session.blankSubmitting = true; session.pendingImport = write
    const controls = [...nodes.blankForm.querySelectorAll('input, button')]
    controls.forEach(n => { n.disabled = true }); renderChrome()
    try {
      const result = await api.createBlank(write.projectId, write.blankRequest)
      if (!writeStillCurrent(write)) return
      if (!result.receipt) throw Object.assign(new Error('Canvas creation was not confirmed.'), { kind: 'unknown' })
      nodes.blankRoot.hidden = true
      await finishConfirmedImport(result, write)
    } catch (error) {
      if (!writeStillCurrent(write)) return
      if (error.kind === 'unknown') {
        nodes.blankRoot.hidden = true; session.blankUnconfirmed = write; openUnknown('blank', write)
      } else { nodes.blankError.textContent = error.code === 'stale_revision' ? 'The project changed. Reopen it before creating a canvas.' : 'Canvas could not be created. No new canvas was confirmed.'; nodes.blankError.hidden = false }
    } finally {
      session.blankSubmitting = false; controls.forEach(n => { n.disabled = false })
      if (session.pendingImport === write && !session.blankUnconfirmed) session.pendingImport = false
      renderChrome(); notifyDraftChange()
      if (nodes.blankRoot.hidden) nodes.stage?.focus()
    }
  })

  let canvasSizeState = null
  session.canResizeSelectedCanvas = () => {
    if (!session.project || blankBusy() || session.documentCandidate || session.textDraftOpen?.()) return false
    const selected = view.canvases.find(canvas => canvas.id === view.selectedId && !canvas.transient)
    const manifest = selected ? session.documents.get(selected.document_id) : null
    if (!manifest) return false
    return Object.values(manifest.layers || {}).every(layer => !layer.locked)
  }
  function closeCanvasSizeDialog(force = false) {
    if (!force && canvasSizeState?.submitting) return
    canvasSizeState = null
    if (nodes.canvasSizeRoot) nodes.canvasSizeRoot.hidden = true
    if (nodes.canvasSizeError) { nodes.canvasSizeError.hidden = true; nodes.canvasSizeError.textContent = '' }
    if (nodes.canvasSizeWarning) { nodes.canvasSizeWarning.hidden = true; nodes.canvasSizeWarning.textContent = '' }
  }
  function syncCanvasSizeDialog() {
    if (!canvasSizeState || !nodes.canvasSizeRoot || nodes.canvasSizeRoot.hidden) return
    const { manifest, blocksBySha, mode, anchor } = canvasSizeState
    nodes.canvasSizeForm?.querySelectorAll('[data-canvas-size-mode]').forEach(btn => {
      const active = btn.dataset.canvasSizeMode === mode
      btn.setAttribute('aria-pressed', String(active))
      btn.classList.toggle('is-selected', active)
    })
    if (nodes.canvasCropOrigins) nodes.canvasCropOrigins.hidden = mode !== 'crop'
    if (nodes.canvasAnchorWrap) nodes.canvasAnchorWrap.hidden = mode !== 'resize'
    nodes.canvasAnchorGrid?.querySelectorAll('[data-canvas-anchor]').forEach(btn => {
      const active = btn.dataset.canvasAnchor === anchor
      btn.setAttribute('aria-checked', String(active))
      btn.classList.toggle('is-selected', active)
    })
    const width = Number(nodes.canvasSizeWidth?.value)
    const height = Number(nodes.canvasSizeHeight?.value)
    const cropX = Number(nodes.canvasCropX?.value || 0)
    const cropY = Number(nodes.canvasCropY?.value || 0)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024
      || (mode === 'crop' && (!Number.isSafeInteger(cropX) || !Number.isSafeInteger(cropY) || cropX < -1024 || cropX > 1024 || cropY < -1024 || cropY > 1024))) {
      if (nodes.canvasSizeWarning) { nodes.canvasSizeWarning.hidden = true; nodes.canvasSizeWarning.textContent = '' }
      return
    }
    if (nodes.canvasSizeError) { nodes.canvasSizeError.hidden = true; nodes.canvasSizeError.textContent = '' }
    const familyFor = item => session.resolveTextFont?.(item) || (item?.font?.kind === 'generic' ? item.font.name : null)
    const impact = inspectCanvasResizeImpact(
      manifest,
      blocksBySha,
      mode === 'crop'
        ? { width, height, anchor: 'top-left', offsetX: -cropX, offsetY: -cropY, familyFor }
        : { width, height, anchor, familyFor },
    )
    canvasSizeState.lastImpact = impact
    if (impact.clipsPixels || impact.clipsText) {
      const parts = []
      if (impact.clipsPixels) {
        parts.push(`Clips ${impact.clippedPixelCount} non-transparent pixel(s) across ${impact.clippedCelCount} cel(s) (${impact.affectedFrameNumbers.map(n => `F${n}`).join(', ')})`)
      }
      if (impact.clipsText) {
        parts.push(`Clips ${impact.clippedTextCount} text object(s)`)
      }
      if (nodes.canvasSizeWarning) {
        nodes.canvasSizeWarning.textContent = `Warning: ${parts.join(' and ')}. Undo restores the previous canvas.`
        nodes.canvasSizeWarning.hidden = false
      }
      if (nodes.canvasSizeApply) {
        nodes.canvasSizeApply.textContent = mode === 'crop' ? 'Crop & clip pixels' : 'Apply & clip pixels'
      }
    } else {
      if (nodes.canvasSizeWarning) {
        nodes.canvasSizeWarning.hidden = true
        nodes.canvasSizeWarning.textContent = ''
      }
      if (nodes.canvasSizeApply) {
        nodes.canvasSizeApply.textContent = mode === 'crop' ? 'Crop canvas' : 'Apply'
      }
    }
  }
  session.openCanvasSizeDialog = async ({ mode = 'resize', fromSelection = false } = {}) => {
    if (!session.canResizeSelectedCanvas() || !nodes.canvasSizeRoot) return false
    const selected = view.canvases.find(canvas => canvas.id === view.selectedId && !canvas.transient)
    const manifest = selected ? session.documents.get(selected.document_id) : null
    if (!selected || !manifest) return false
    const projectId = session.project.id
    const projectRevision = session.project.revision
    const workingRevision = manifest.revision
    const blocksBySha = new Map()
    try {
      for (const cel of Object.values(manifest.cels || {})) {
        const sha = cel?.block?.sha256
        if (!sha || blocksBySha.has(sha)) continue
        const block = await api.getBlock(projectId, manifest.document_id, sha)
        if (block?.bytes instanceof Uint8Array) blocksBySha.set(sha, block.bytes)
      }
    } catch {
      setCanvasStatus('Canvas pixels could not be loaded for resize inspection.', { error: true })
      return false
    }
    if (session.project?.id !== projectId || session.project.revision !== projectRevision || view.selectedId !== selected.id || session.documents.get(manifest.document_id)?.revision !== workingRevision) {
      return false
    }
    const sel = session.pixelSelection?.projectId === projectId && session.pixelSelection?.canvasId === selected.id
      ? session.pixelSelection.rect
      : null
    const initialMode = (fromSelection && sel) || mode === 'crop' ? 'crop' : 'resize'
    canvasSizeState = {
      projectId,
      projectRevision,
      canvasId: selected.id,
      documentId: manifest.document_id,
      workingRevision,
      manifest,
      blocksBySha,
      mode: initialMode,
      anchor: 'center',
      submitting: false,
      lastImpact: null,
    }
    if (nodes.canvasSizeCurrent) {
      nodes.canvasSizeCurrent.textContent = `${selected.name || manifest.name || 'Canvas'} · Current: ${manifest.canvas.w} × ${manifest.canvas.h} px · ${manifest.frame_order.length} frame(s), ${manifest.layer_order.length} layer(s)`
    }
    if (nodes.canvasUseSelection) nodes.canvasUseSelection.hidden = !sel
    if (fromSelection && sel) {
      if (nodes.canvasCropX) nodes.canvasCropX.value = String(sel.x)
      if (nodes.canvasCropY) nodes.canvasCropY.value = String(sel.y)
      if (nodes.canvasSizeWidth) nodes.canvasSizeWidth.value = String(sel.w)
      if (nodes.canvasSizeHeight) nodes.canvasSizeHeight.value = String(sel.h)
    } else {
      if (nodes.canvasCropX) nodes.canvasCropX.value = '0'
      if (nodes.canvasCropY) nodes.canvasCropY.value = '0'
      if (nodes.canvasSizeWidth) nodes.canvasSizeWidth.value = String(manifest.canvas.w)
      if (nodes.canvasSizeHeight) nodes.canvasSizeHeight.value = String(manifest.canvas.h)
    }
    if (nodes.canvasSizeError) { nodes.canvasSizeError.hidden = true; nodes.canvasSizeError.textContent = '' }
    nodes.canvasSizeRoot.hidden = false
    syncCanvasSizeDialog()
    nodes.canvasSizeWidth?.focus?.()
    nodes.canvasSizeWidth?.select?.()
    return true
  }
  nodes.canvasSizeOpen?.addEventListener('click', () => { void session.openCanvasSizeDialog() })
  nodes.canvasSizeRoot?.addEventListener('click', event => {
    if (event.target.closest('[data-canvas-size-cancel]')) { closeCanvasSizeDialog(); return }
    const modeBtn = event.target.closest('[data-canvas-size-mode]')
    if (modeBtn && canvasSizeState && !canvasSizeState.submitting) {
      canvasSizeState.mode = modeBtn.dataset.canvasSizeMode === 'crop' ? 'crop' : 'resize'
      syncCanvasSizeDialog()
      return
    }
    const anchorBtn = event.target.closest('[data-canvas-anchor]')
    if (anchorBtn && canvasSizeState && !canvasSizeState.submitting) {
      canvasSizeState.anchor = anchorBtn.dataset.canvasAnchor || 'center'
      syncCanvasSizeDialog()
    }
  })
  nodes.canvasSizeRoot?.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCanvasSizeDialog() }
  })
  for (const input of [nodes.canvasSizeWidth, nodes.canvasSizeHeight, nodes.canvasCropX, nodes.canvasCropY]) {
    input?.addEventListener('input', () => syncCanvasSizeDialog())
  }
  nodes.canvasUseSelection?.addEventListener('click', () => {
    if (!canvasSizeState || canvasSizeState.submitting) return
    const sel = session.pixelSelection?.projectId === canvasSizeState.projectId && session.pixelSelection?.canvasId === canvasSizeState.canvasId
      ? session.pixelSelection.rect
      : null
    if (!sel) return
    canvasSizeState.mode = 'crop'
    if (nodes.canvasCropX) nodes.canvasCropX.value = String(sel.x)
    if (nodes.canvasCropY) nodes.canvasCropY.value = String(sel.y)
    if (nodes.canvasSizeWidth) nodes.canvasSizeWidth.value = String(sel.w)
    if (nodes.canvasSizeHeight) nodes.canvasSizeHeight.value = String(sel.h)
    syncCanvasSizeDialog()
  })
  nodes.canvasTrimBounds?.addEventListener('click', () => {
    if (!canvasSizeState || canvasSizeState.submitting) return
    const bounds = computeCanvasContentBounds(canvasSizeState.manifest, canvasSizeState.blocksBySha)
    if (!bounds) {
      if (nodes.canvasSizeError) {
        nodes.canvasSizeError.textContent = 'This canvas has no non-transparent pixels to trim.'
        nodes.canvasSizeError.hidden = false
      }
      return
    }
    canvasSizeState.mode = 'crop'
    if (nodes.canvasCropX) nodes.canvasCropX.value = String(bounds.x)
    if (nodes.canvasCropY) nodes.canvasCropY.value = String(bounds.y)
    if (nodes.canvasSizeWidth) nodes.canvasSizeWidth.value = String(bounds.w)
    if (nodes.canvasSizeHeight) nodes.canvasSizeHeight.value = String(bounds.h)
    syncCanvasSizeDialog()
  })
  nodes.canvasSizeForm?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!canvasSizeState || canvasSizeState.submitting) return
    const { mode, anchor, manifest } = canvasSizeState
    const width = Number(nodes.canvasSizeWidth?.value)
    const height = Number(nodes.canvasSizeHeight?.value)
    const cropX = Number(nodes.canvasCropX?.value || 0)
    const cropY = Number(nodes.canvasCropY?.value || 0)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024) {
      if (nodes.canvasSizeError) {
        nodes.canvasSizeError.textContent = 'Use whole-number width and height from 1 to 1024 px.'
        nodes.canvasSizeError.hidden = false
      }
      return
    }
    if (mode === 'crop' && (!Number.isSafeInteger(cropX) || !Number.isSafeInteger(cropY) || cropX < -1024 || cropX > 1024 || cropY < -1024 || cropY > 1024)) {
      if (nodes.canvasSizeError) {
        nodes.canvasSizeError.textContent = 'Use whole-number Left (X) and Top (Y) offsets from -1024 to 1024 px.'
        nodes.canvasSizeError.hidden = false
      }
      return
    }
    const offsets = mode === 'crop'
      ? { offset_x: -cropX, offset_y: -cropY }
      : anchorCanvasOffsets(manifest.canvas.w, manifest.canvas.h, width, height, anchor)
    const command = {
      type: 'resize-canvas',
      width,
      height,
      offset_x: offsets.offset_x,
      offset_y: offsets.offset_y,
    }
    const impact = canvasSizeState.lastImpact || inspectCanvasResizeImpact(
      manifest,
      canvasSizeState.blocksBySha,
      mode === 'crop'
        ? { width, height, anchor: 'top-left', offsetX: -cropX, offsetY: -cropY }
        : { width, height, anchor },
    )
    if (width === manifest.canvas.w && height === manifest.canvas.h && impact.offsetX === 0 && impact.offsetY === 0) {
      closeCanvasSizeDialog(true)
      setCanvasStatus('Canvas size is unchanged.')
      return
    }
    const targetState = canvasSizeState
    targetState.submitting = true
    const controls = [...(nodes.canvasSizeForm?.querySelectorAll('input, button') || [])]
    controls.forEach(n => { n.disabled = true })
    try {
      const res = await session.changeStructure(command, {
        projectId: targetState.projectId,
        projectRevision: targetState.projectRevision,
        canvasId: targetState.canvasId,
        documentId: targetState.documentId,
        workingRevision: targetState.workingRevision,
      })
      if (res?.ok) {
        closeCanvasSizeDialog(true)
        setCanvasStatus(`Canvas ${mode === 'crop' ? 'cropped' : 'resized'} to ${width} × ${height} px. Undo restores the previous size.`)
      } else if (!res?.unknown && canvasSizeState === targetState) {
        if (nodes.canvasSizeError) {
          nodes.canvasSizeError.textContent = res?.reason === 'stale'
            ? 'The canvas changed before resizing. Reopen Canvas size & crop.'
            : 'Canvas size could not be updated.'
          nodes.canvasSizeError.hidden = false
        }
      } else if (res?.unknown) {
        closeCanvasSizeDialog(true)
      }
    } finally {
      targetState.submitting = false
      controls.forEach(n => { n.disabled = false })
      if (canvasSizeState === targetState) syncCanvasSizeDialog()
    }
  })

  async function importPngFile(file, dropPoint = null) {
    if (blockPendingHistoryEdit()) return
    const kind = canvasImportKind(file)
    if (file && !kind) {
      rejectCanvasImport('Only PNG or JPEG files can be imported.')
      return
    }
    if (file && projectChangeInFlight()) {
      rejectCanvasImport('Wait for the project to finish opening.')
      return
    }
    if (session.pendingImport) {
      rejectCanvasImport('Import already in progress.')
      return
    }
    if (!session.project) {
      rejectCanvasImport(CANVAS_IMPORT_PROJECT_REQUIRED)
      return
    }
    if (!file) return
    if (Number.isFinite(file.size) && file.size > VNEXT_IMPORT_PNG_MAX_BYTES) {
      rejectCanvasImport(kind === 'jpeg' ? 'JPEG exceeds 32 MiB.' : 'PNG exceeds 32 MiB.')
      return
    }
    let unresolved = false
    const projectId = session.project.id
    const expectedRevision = session.project.revision
    const write = rememberWrite('import', projectId, {
      dropPoint,
      canvasIds: Object.keys(session.project.canvases || {}),
    })
    session.pendingImport = write
    showToast('')
    setCanvasStatus('Importing…')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!writeStillCurrent(write)) return
      const digest = await sha256Hex(bytes)
      if (!writeStillCurrent(write)) return
      const stem = String(file.name || '').split(/[/\\]/).pop().replace(/\.(png|jpe?g)$/i, '')
      const request = {
        expectedRevision,
        expectedSha256: digest,
        name: stem && stem.length <= 128 && stem === stem.trim() ? stem : undefined,
        bytes,
      }
      const result = kind === 'jpeg'
        ? await api.importJpeg(projectId, request)
        : await api.importPng(projectId, request)
      if (!writeStillCurrent(write)) return
      if (!result.receipt) {
        setCanvasStatus(VNEXT_PROJECT_COPY.importFailed)
        showToast(VNEXT_PROJECT_COPY.importFailed)
        return
      }
      await finishConfirmedImport(result, write)
    } catch (error) {
      if (!writeStillCurrent(write)) return
      noteSessionError(error)
      if (error.kind === 'unknown') {
        unresolved = true
        bindUnknown(write, error)
        showToast('')
        setCanvasStatus(error.reason || 'Import result is unknown. Retry keeps the same file.')
        openUnknown('import', write)
      } else {
        setCanvasStatus(error.reason || VNEXT_PROJECT_COPY.importFailed)
        showToast(error.reason || VNEXT_PROJECT_COPY.importFailed)
      }
    } finally {
      if (session.pendingImport === write && !unresolved) session.pendingImport = false
      renderChrome()
      renderConversationRef()
    }
  }

  async function createProject() {
    return protectThen(async () => {
      const bound = rememberWrite('create', session.project?.id ?? null, { openToken: api.openEpoch.next() })
      await duringProjectTransition(bound.openToken, async () => {
        try {
          const result = await api.createProjectV1({})
          if (!result.receipt) {
            if (operationStillCurrent(bound)) showToast(VNEXT_PROJECT_COPY.openFailed)
            return
          }
          if (!operationStillCurrent(bound) || (await applyProject(result.project, { token: bound.openToken })).stale) {
            showToast(VNEXT_PROJECT_COPY.createdNotOpened)
          }
        } catch (error) {
          if (!operationStillCurrent(bound)) return
          if (error.kind === 'unknown') { bindUnknown(bound, error); openUnknown('create', bound) }
          else showToast(error.reason || VNEXT_PROJECT_COPY.openFailed)
        }
      })
    })
  }

  nodes.btn?.addEventListener('click', (event) => {
    event.preventDefault()
    setMenuOpen(Boolean(nodes.menu?.hidden))
  })
  nodes.menu?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-project-action]')?.dataset.projectAction
    if (!action) return
    setMenuOpen(false)
    if (action === 'new') await createProject()
    if (action === 'blank') openBlankDialog()
    if (action === 'duplicate-canvas') await session.duplicateSelectedCanvas?.()
    if (action === 'canvas-size') await session.openCanvasSizeDialog?.()
    if (action === 'open') {
      nodes.openRoot.hidden = false
      session.list.query = nodes.search?.value || ''
      await loadList()
    }
    if (action === 'import') {
      if (!session.project) {
        rejectCanvasImport(CANVAS_IMPORT_PROJECT_REQUIRED)
        return
      }
      if (projectChangeInFlight()) {
        rejectCanvasImport('Wait for the project to finish opening.')
        return
      }
      if (nodes.importInput && !nodes.importInput.disabled) nodes.importInput.click()
    }
    if (action === 'sequence') {
      if (blockPendingHistoryEdit()) return
      if (!session.project) {
        rejectCanvasImport(CANVAS_IMPORT_PROJECT_REQUIRED)
        return
      }
      if (projectChangeInFlight()) {
        rejectCanvasImport('Wait for the project to finish opening.')
        return
      }
      if (session.pendingImport || session.blankSubmitting || session.confirmedImport) {
        rejectCanvasImport('Import already in progress.')
        return
      }
      if (session.nameEdit) {
        rejectCanvasImport('Finish renaming the canvas before importing.')
        return
      }
      if (session.documentCandidate || session.hasPixelDrawingSave?.() || session.hasAssistantWork?.()) {
        rejectCanvasImport('Finish or resolve the current result before importing a sequence.')
        return
      }
      sequenceAnchor = view.selectedId ? {
        projectId: session.project.id,
        canvasId: view.selectedId,
        documentId: session.project.canvases?.[view.selectedId]?.document_id || '',
      } : null
      if (!sequenceReview && !sequenceAbort) {
        setSequenceFileHeader(null)
        setSequenceDialogMode('empty')
        setMotionInlineState('')
        setSequenceStatusText('')
      }
      syncSequenceActionButtons()
      if (nodes.sequenceRoot) nodes.sequenceRoot.hidden = false
    }
    if (action === 'save') await savePositions()
    if (action === 'subscription' && !event.target.closest('[data-project-action]')?.disabled) {
      root.querySelector('#vnext-subscription-dialog').hidden = false
    }
  })
  nodes.importInput?.addEventListener('change', async () => {
    const file = nodes.importInput.files?.[0]
    nodes.importInput.value = ''
    await importPngFile(file)
  })
  let sequenceReview = null
  let sequenceSerial = 0
  let sequenceAbort = null
  let sequenceAnchor = null
  let motionPlayTimer = null
  let motionObjectUrl = ''
  function setSequenceDialogMode(mode = 'empty') {
    if (!nodes.sequenceDialogCard) return
    if (!mode || mode === 'empty') {
      nodes.sequenceDialogCard.removeAttribute?.('data-sequence-mode')
    } else {
      nodes.sequenceDialogCard.setAttribute?.('data-sequence-mode', mode)
    }
  }
  function setSequenceFileHeader(filesOrLabel = null) {
    const isEmpty = !filesOrLabel || (Array.isArray(filesOrLabel) && filesOrLabel.length === 0)
    if (isEmpty) {
      nodes.sequenceFileRow?.classList?.remove?.('is-selected')
      if (nodes.sequenceFileLabel) {
        nodes.sequenceFileLabel.hidden = true
        nodes.sequenceFileLabel.textContent = ''
        nodes.sequenceFileLabel.removeAttribute?.('title')
      }
      if (nodes.sequenceFileHint) nodes.sequenceFileHint.hidden = false
      if (nodes.sequenceChoose) nodes.sequenceChoose.textContent = 'Choose files'
      return
    }
    let label = ''
    let fullTitle = ''
    if (typeof filesOrLabel === 'string') {
      label = filesOrLabel
      fullTitle = filesOrLabel
    } else if (Array.isArray(filesOrLabel)) {
      if (filesOrLabel.length === 1) {
        label = filesOrLabel[0]?.name || 'Selected file'
        fullTitle = label
      } else {
        label = `${filesOrLabel.length} images`
        fullTitle = filesOrLabel.map((item) => item?.name || 'image').join(', ')
      }
    }
    nodes.sequenceFileRow?.classList?.add?.('is-selected')
    if (nodes.sequenceFileLabel) {
      nodes.sequenceFileLabel.hidden = false
      nodes.sequenceFileLabel.textContent = label
      nodes.sequenceFileLabel.title = fullTitle
      nodes.sequenceFileLabel.setAttribute?.('title', fullTitle)
    }
    if (nodes.sequenceFileHint) nodes.sequenceFileHint.hidden = true
    if (nodes.sequenceChoose) nodes.sequenceChoose.textContent = 'Replace'
  }
  function setSequenceStatusText(text, { hideWhenEmpty = true } = {}) {
    if (!nodes.sequenceStatus) return
    nodes.sequenceStatus.replaceChildren()
    nodes.sequenceStatus.textContent = text || ''
    nodes.sequenceStatus.hidden = hideWhenEmpty ? !text : false
  }
  function setMotionInlineState(text, { isError = false } = {}) {
    if (!nodes.motionPreviewState) return
    const val = text || ''
    nodes.motionPreviewState.textContent = val
    nodes.motionPreviewState.hidden = !val
    nodes.motionPreviewState.classList?.toggle?.('is-error', Boolean(val && isError))
  }
  function stopMotionPlayback() {
    if (motionPlayTimer) {
      clearTimeout(motionPlayTimer)
      motionPlayTimer = null
    }
  }
  function revokeMotionObjectUrl() {
    if (nodes.motionPlayer) {
      try { nodes.motionPlayer.pause?.() } catch {}
      nodes.motionPlayer.removeAttribute?.('src')
    }
    if (motionObjectUrl && typeof URL?.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(motionObjectUrl) } catch {}
    }
    motionObjectUrl = ''
  }
  function isSequenceAbortError(error) {
    return Boolean(
      error &&
      (error.name === 'AbortError' || error.code === 'aborted' || error.aborted === true)
    )
  }
  function stopSequencePreviewWork(ownedController = null) {
    if (ownedController && sequenceAbort && sequenceAbort !== ownedController) {
      try { ownedController.abort() } catch {}
      return
    }
    const targetAbort = ownedController || sequenceAbort
    if (targetAbort) {
      try { targetAbort.abort() } catch {}
    }
    if (!ownedController || sequenceAbort === ownedController) {
      sequenceAbort = null
      if (nodes.sequenceStop) nodes.sequenceStop.hidden = true
      if (nodes.sequenceChoose) nodes.sequenceChoose.disabled = Boolean(session.pendingImport)
      syncSequenceActionButtons()
    }
  }
  function isMaskZero(mask) {
    if (!(mask instanceof Uint8Array)) return true
    for (let i = 0; i < mask.length; i += 1) if (mask[i] !== 0) return false
    return true
  }
  function masksEqual(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
    return true
  }
  function countMaskBits(mask, width, height) {
    if (!(mask instanceof Uint8Array)) return 0
    let count = 0
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (bitMaskHas(mask, width, x, y)) count += 1
    }
    return count
  }
  function sequenceSelectionLocked(target = sequenceReview) {
    return !target
      || Boolean(session.pendingImport)
      || Boolean(target.submitting)
      || Boolean(target.unknownPending)
      || target.committedBatchCount > 0
  }
  function syncSequenceActionButtons() {
    const active = Boolean(sequenceReview)
    const isMotion = Boolean(sequenceReview?.isMotion)
    const isVideo = Boolean(sequenceReview?.isVideo || (nodes.motionControls && !nodes.motionControls.hidden))
    const busy = Boolean(session.pendingImport || sequenceReview?.submitting || sequenceReview?.unknownPending)
    const locked = sequenceSelectionLocked(sequenceReview)
    if (nodes.sequenceImport) {
      const isPartialBatchResume = active && !isMotion && sequenceReview.committedBatchCount > 0
      nodes.sequenceImport.textContent = isPartialBatchResume ? 'Resume' : 'Import to timeline'
    }
    if (nodes.sequenceKeepAll) {
      nodes.sequenceKeepAll.hidden = !active || isMotion
      nodes.sequenceKeepAll.disabled = !active || isMotion || busy || locked || sequenceReview.frames.every((frame) => frame.transparent_source || isMaskZero(frame.mask))
    }
    if (nodes.sequenceApplyAuto) {
      nodes.sequenceApplyAuto.hidden = !active || isMotion
      nodes.sequenceApplyAuto.disabled = !active || isMotion || busy || locked || sequenceReview.frames.every((frame) => frame.transparent_source || masksEqual(frame.mask, frame.proposal))
    }
    if (nodes.sequenceStop) {
      nodes.sequenceStop.textContent = 'Cancel'
      if (isVideo && nodes.motionActionRow) {
        if (nodes.sequenceStop.parentNode !== nodes.motionActionRow) {
          if (typeof nodes.motionActionRow.insertBefore === 'function' && nodes.motionPreviewState?.parentNode === nodes.motionActionRow) {
            nodes.motionActionRow.insertBefore(nodes.sequenceStop, nodes.motionPreviewState)
          } else {
            nodes.motionActionRow.append?.(nodes.sequenceStop)
          }
        }
      } else if (nodes.sequenceActions && nodes.sequenceStop.parentNode !== nodes.sequenceActions) {
        nodes.sequenceActions.append?.(nodes.sequenceStop)
      }
    }
    if (nodes.sequenceActions) {
      const anyActionVisible = Boolean(
        (nodes.sequenceKeepAll && !nodes.sequenceKeepAll.hidden)
        || (nodes.sequenceApplyAuto && !nodes.sequenceApplyAuto.hidden)
        || (nodes.sequenceStop && nodes.sequenceStop.parentNode === nodes.sequenceActions && !nodes.sequenceStop.hidden)
      )
      nodes.sequenceActions.hidden = !anyActionVisible
    }
    const videoControlsLocked = !sequenceReview?.isVideo || busy || locked
    if (nodes.motionStart) nodes.motionStart.disabled = videoControlsLocked
    if (nodes.motionEnd) nodes.motionEnd.disabled = videoControlsLocked
    if (nodes.motionMode) nodes.motionMode.disabled = videoControlsLocked
    if (nodes.motionFps) nodes.motionFps.disabled = videoControlsLocked
    if (nodes.motionStride) nodes.motionStride.disabled = videoControlsLocked
    if (nodes.motionPreviewBtn) {
      nodes.motionPreviewBtn.disabled = videoControlsLocked
      const useUpdateLabel = Boolean(
        sequenceReview?.isVideo &&
        (
          (sequenceReview.previewStale && sequenceReview.hasPreviewedOnce)
          || sequenceReview.previewCancelled
          || sequenceReview.previewError
          || sequenceReview.changedWhileExtracting
        )
      )
      nodes.motionPreviewBtn.textContent = useUpdateLabel ? 'Update preview' : 'Preview segment'
    }
    if (nodes.sequenceChoose) nodes.sequenceChoose.disabled = busy
    if (nodes.sequenceCancel) nodes.sequenceCancel.disabled = busy
  }
  let sharedSequenceOverlayCanvas = null
  function releaseSequenceReview({ keepVideoControls = false } = {}) {
    stopMotionPlayback()
    if (nodes.motionPreviewStage) nodes.motionPreviewStage.hidden = true
    if (nodes.motionPreviewCanvas) {
      nodes.motionPreviewCanvas.width = 0
      nodes.motionPreviewCanvas.height = 0
    }
    if (nodes.motionPreviewMeta) nodes.motionPreviewMeta.textContent = ''
    if (nodes.sequenceMixedNotice) nodes.sequenceMixedNotice.hidden = true
    if (!keepVideoControls) {
      if (nodes.motionControls) nodes.motionControls.hidden = true
      setMotionInlineState('')
      revokeMotionObjectUrl()
      setSequenceDialogMode('empty')
    }
    if (sequenceReview?.frames) {
      for (const frame of sequenceReview.frames) {
        if (frame?.image) {
          frame.image.src = ''
          frame.image.removeAttribute?.('src')
        }
        if (frame?.overlayCanvas) {
          frame.overlayCanvas.width = 0
          frame.overlayCanvas.height = 0
          frame.overlayCanvas = null
        }
      }
    }
    if (!keepVideoControls) sequenceReview = null
    if (nodes.sequenceFrames) {
      for (const child of [...(nodes.sequenceFrames.children || [])]) {
        if (typeof child?.width === 'number') child.width = 0
        if (typeof child?.height === 'number') child.height = 0
        const innerCanvas = child?.querySelector?.('canvas')
        if (innerCanvas) {
          innerCanvas.width = 0
          innerCanvas.height = 0
        }
      }
      nodes.sequenceFrames.replaceChildren()
      nodes.sequenceFrames.hidden = true
    }
  }
  function invalidateUncommittedSequenceBatches(target = sequenceReview) {
    if (sequenceSelectionLocked(target)) return
    target.frozenCommitBatches = null
    target.batchOperationIds = null
    target.operationId = createOperationId()
    if (Number.isInteger(session.project?.revision)) {
      target.revision = session.project.revision
      target.committedRevision = session.project.revision
    }
  }
  function closeSequenceDialog(force = false) {
    if (!force && (session.pendingImport?.kind === 'sequence' || sequenceReview?.submitting || sequenceReview?.unknownPending)) return
    sequenceSerial += 1
    sequenceAnchor = null
    stopSequencePreviewWork()
    if (nodes.sequenceRoot) nodes.sequenceRoot.hidden = true
    releaseSequenceReview()
    setSequenceFileHeader(null)
    sequenceError('')
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    setSequenceStatusText('')
    syncSequenceActionButtons()
  }
  function sequenceError(message) {
    const msg = message || ''
    if (sequenceReview?.isVideo && !sequenceReview.submitting && !sequenceReview.unknownPending && !session.pendingImport) {
      sequenceReview.previewError = Boolean(msg)
      if (msg) {
        setMotionInlineState(msg, { isError: true })
      } else if (nodes.motionPreviewState?.classList?.contains?.('is-error')) {
        setMotionInlineState('', { isError: false })
      }
      syncSequenceActionButtons()
    }
    if (!nodes.sequenceError) return
    const shownInlineInVideo = Boolean(
      msg &&
      sequenceReview?.isVideo &&
      !sequenceReview.submitting &&
      !sequenceReview.unknownPending &&
      !session.pendingImport &&
      nodes.motionPreviewState &&
      nodes.motionControls &&
      !nodes.motionControls.hidden
    )
    nodes.sequenceError.hidden = !msg || shownInlineInVideo
    nodes.sequenceError.textContent = msg
  }
  function sequenceStillCurrent(token) {
    return token
      && token.serial === sequenceSerial
      && session.project?.id === token.projectId
      && api.openEpoch.isCurrent(token.epoch)
      && nodes.sequenceRoot && !nodes.sequenceRoot.hidden
      && (!nodes.sequenceBackground || nodes.sequenceBackground.value === token.background)
  }
  function renderSequenceStatus() {
    if (!nodes.sequenceStatus) return
    syncSequenceActionButtons()
    if (!sequenceReview) {
      if (nodes.sequenceMixedNotice) nodes.sequenceMixedNotice.hidden = true
      setSequenceStatusText('')
      return
    }
    setSequenceDialogMode('images')
    nodes.sequenceStatus.replaceChildren()
    nodes.sequenceStatus.textContent = ''
    nodes.sequenceStatus.hidden = false
    const hasMixedScale = sequenceReview.frames.length > 1 && sequenceReview.frames.some((frame) => frame.padded)
    if (nodes.sequenceMixedNotice) {
      nodes.sequenceMixedNotice.hidden = !hasMixedScale
      nodes.sequenceMixedNotice.textContent = 'Mixed sizes · padded, not scaled'
    }
    if (hasMixedScale) {
      const notice = document.createElement('p')
      notice.className = 'vnext-sequence-mixed-scale-notice'
      notice.textContent = 'Mixed sizes · padded, not scaled'
      notice.hidden = Boolean(nodes.sequenceMixedNotice)
      nodes.sequenceStatus.append(notice)
    }
    const hint = document.createElement('p')
    hint.className = 'vnext-sequence-hint'
    hint.textContent = sequenceReview.committedBatchCount > 0
      ? `${sequenceReview.committedFrameCount}/${sequenceReview.frames.length} imported`
      : 'Click pixels to keep/remove'
    nodes.sequenceStatus.append(hint)
    const details = document.createElement('details')
    details.className = 'vnext-sequence-details'
    const summary = document.createElement('summary')
    summary.textContent = 'Details'
    details.append(summary)
    if (hasMixedScale) {
      const maxW = sequenceReview.frames[0]?.placed_width || Math.max(...sequenceReview.frames.map((f) => f.width))
      const maxH = sequenceReview.frames[0]?.placed_height || Math.max(...sequenceReview.frames.map((f) => f.height))
      const mixedDetail = document.createElement('p')
      mixedDetail.textContent = `Mixed frame dimensions detected (${sequenceReview.frames.map((f) => `${f.width}×${f.height}`).join(', ')}). Smaller frames are top-left padded with transparency to ${maxW}×${maxH} without scaling, so subject scale differs across frames during playback.`
      details.append(mixedDetail)
    }
    sequenceReview.frames.forEach((frame, index) => {
      const line = document.createElement('p')
      const pad = frame.padded ? ` Padded to ${frame.placed_width}×${frame.placed_height}.` : ''
      const grid = frame.recovery_status === 'passthrough' && frame.recovery_reason === 'exceeds_recovery_budget'
        ? ' Original size kept (exceeds 4,194,304-pixel recovery analysis budget).'
        : sequenceReview.grid_consistent ? ' Grid confirmed.' : ' Grid not confirmed.'
      const omitted = countMaskBits(frame.mask, frame.width, frame.height)
      const bgDetected = frame.background_status === 'omitted' || frame.background_status === 'detected'
      const bgLabel = typeof frame.background === 'string' && frame.background && frame.background !== 'auto' && frame.background !== 'none'
        ? frame.background
        : (frame.background_color && typeof frame.background_color === 'object'
          ? `rgb(${frame.background_color.r}, ${frame.background_color.g}, ${frame.background_color.b})`
          : (typeof frame.background_color === 'string' && frame.background_color ? frame.background_color : 'detected'))
      let bgNote = ''
      if (frame.transparent_source) {
        bgNote = ' Transparency kept.'
      } else if (omitted === 0 && bgDetected) {
        bgNote = ' Original pixels kept.'
      } else if (bgDetected) {
        bgNote = ` Auto background (${bgLabel}) · ${omitted} omitted.`
      } else {
        bgNote = omitted > 0
          ? ` Manual selection · ${omitted} omitted.`
          : ` Original pixels kept (${frame.background_reason || 'no confident border background'}).`
      }
      const reason = frame.recovery_reason ? `, ${frame.recovery_reason}` : ''
      const bgReason = frame.background_reason ? `, bg:${frame.background_reason}` : ''
      const gridReason = sequenceReview.grid_reason ? `, ${sequenceReview.grid_reason}` : ''
      line.textContent = `Frame ${index + 1}: ${frame.width}×${frame.height}.${pad}${grid}${bgNote} (${frame.recovery_status || 'unknown'}${reason}${bgReason}${gridReason}).`
      details.append(line)
    })
    nodes.sequenceStatus.append(details)
  }
  function paintLargeMaskOverlay(context, frame, canvasWidth, canvasHeight) {
    if (typeof ImageData !== 'function' || typeof document?.createElement !== 'function') return false
    const overlay = sharedSequenceOverlayCanvas || document.createElement('canvas')
    const overlayCtx = overlay.getContext?.('2d')
    if (typeof overlayCtx?.putImageData !== 'function') return false
    sharedSequenceOverlayCanvas = overlay
    overlay.width = canvasWidth
    overlay.height = canvasHeight
    const data = new Uint8ClampedArray(canvasWidth * canvasHeight * 4)
    const fw = frame.width
    const fh = frame.height
    const total = fw * fh
    const mask = frame.mask
    for (let byteIndex = 0; byteIndex < mask.length; byteIndex += 1) {
      const byte = mask[byteIndex]
      if (byte === 0) continue
      const base = byteIndex << 3
      for (let bit = 0; bit < 8; bit += 1) {
        if ((byte & (1 << bit)) === 0) continue
        const idx = base + bit
        if (idx >= total) break
        const x = idx % fw
        const y = (idx - x) / fw
        const cx = Math.min(canvasWidth - 1, Math.floor((x * canvasWidth) / fw))
        const cy = Math.min(canvasHeight - 1, Math.floor((y * canvasHeight) / fh))
        data[(cy * canvasWidth + cx) * 4 + 3] = 115
      }
    }
    overlayCtx.putImageData(new ImageData(data, canvasWidth, canvasHeight), 0, 0)
    context.drawImage(overlay, 0, 0, canvasWidth, canvasHeight)
    return true
  }
  function drawSequenceReview() {
    if (!nodes.sequenceFrames || !sequenceReview) return
    for (const child of [...(nodes.sequenceFrames.children || [])]) {
      if (typeof child?.width === 'number') child.width = 0
      if (typeof child?.height === 'number') child.height = 0
      const innerCanvas = child?.querySelector?.('canvas')
      if (innerCanvas) {
        innerCanvas.width = 0
        innerCanvas.height = 0
      }
    }
    nodes.sequenceFrames.replaceChildren()
    nodes.sequenceFrames.hidden = sequenceReview.frames.length === 0
    const maxPreviewBoxPx = 128
    sequenceReview.frames.forEach((frame, index) => {
      const scale = sequenceDisplayScale(frame.width, frame.height)
      const rawWidth = frame.width * scale
      const rawHeight = frame.height * scale
      const fitScale = Math.min(1, maxPreviewBoxPx / Math.max(rawWidth, rawHeight, 1))
      const cssWidth = Math.max(1, Math.round(rawWidth * fitScale))
      const cssHeight = Math.max(1, Math.round(rawHeight * fitScale))
      const card = document.createElement('div')
      card.className = 'vnext-motion-frame-card vnext-sequence-region-card'
      card.dataset.frameIndex = String(index)
      card.dataset.logicalWidth = String(frame.width)
      card.dataset.logicalHeight = String(frame.height)
      card.dataset.transparentSource = frame.transparent_source ? 'true' : 'false'
      const canvas = document.createElement('canvas')
      canvas.width = cssWidth
      canvas.height = cssHeight
      canvas.dataset.logicalWidth = String(frame.width)
      canvas.dataset.logicalHeight = String(frame.height)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      canvas.style.maxWidth = `${maxPreviewBoxPx}px`
      canvas.style.maxHeight = `${maxPreviewBoxPx}px`
      canvas.style.flex = '0 0 auto'
      canvas.style.aspectRatio = `${rawWidth} / ${rawHeight}`
      canvas.setAttribute('aria-label', `Frame ${index + 1} recovered pixels`)
      Object.defineProperty(card, 'width', {
        configurable: true,
        get: () => canvas.width,
        set: (val) => { canvas.width = val },
      })
      Object.defineProperty(card, 'height', {
        configurable: true,
        get: () => canvas.height,
        set: (val) => { canvas.height = val },
      })
      const context = canvas.getContext('2d')
      const image = frame.image
      const cellW = canvas.width / frame.width
      const cellH = canvas.height / frame.height
      const paint = () => {
        context.imageSmoothingEnabled = false
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        context.fillStyle = 'rgba(0, 0, 0, 0.45)'
        if (!frame.transparent_source) {
          if (frame.width * frame.height > 65536 && paintLargeMaskOverlay(context, frame, canvas.width, canvas.height)) {
            return
          }
          for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
            if (bitMaskHas(frame.mask, frame.width, x, y)) {
              context.fillRect(x * cellW, y * cellH, Math.max(1, cellW), Math.max(1, cellH))
            }
          }
        }
      }
      frame.repaint = paint
      if (image.complete) paint()
      else image.addEventListener('load', paint, { once: true })
      const handleCellClick = (event) => {
        if (frame.transparent_source || sequenceSelectionLocked(sequenceReview) || !sequenceStillCurrent(sequenceReview)) return
        const rect = canvas.getBoundingClientRect()
        const x = Math.floor((event.clientX - rect.left) * frame.width / rect.width)
        const y = Math.floor((event.clientY - rect.top) * frame.height / rect.height)
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return
        toggleBitMask(frame.mask, frame.width, x, y)
        invalidateUncommittedSequenceBatches(sequenceReview)
        paint()
        renderSequenceStatus()
      }
      canvas.addEventListener('click', handleCellClick)
      card.addEventListener('click', (event) => {
        if (event.target === card) handleCellClick(event)
      })
      const label = document.createElement('span')
      label.className = 'vnext-sequence-frame-label'
      label.textContent = frame.transparent_source ? 'Transparent' : String(index + 1).padStart(2, '0')
      card.append(canvas)
      card.append(label)
      nodes.sequenceFrames.append(card)
    })
    renderSequenceStatus()
  }
  function sequenceBatchLimitBytes() {
    const custom = Number(session.sequenceMaxBatchBytes)
    return Number.isInteger(custom) && custom > 64 ? custom : undefined
  }
  async function previewSequenceSources(sources, token) {
    if (!sequenceStillCurrent(token)) return
    sequenceError('')
    releaseSequenceReview()
    setSequenceDialogMode('images')
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    syncSequenceActionButtons()
    let handles
    try {
      handles = prepareSequenceSourceHandles(sources)
    } catch (error) {
      stopSequencePreviewWork()
      renderSequenceStatus()
      sequenceError(error.message || SEQUENCE_FRAME_LIMIT_MESSAGE)
      return
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    sequenceAbort = controller
    if (nodes.sequenceStop) nodes.sequenceStop.hidden = false
    syncSequenceActionButtons()
    try {
      const previewFrames = []
      let gridConsistent = true
      let gridReason = 'single_frame_or_consistent'
      let stepX = null
      let stepY = null
      let runningMaxW = 0
      let runningMaxH = 0
      for (let i = 0; i < handles.length; i += 1) {
        if (!sequenceStillCurrent(token)) return
        setSequenceStatusText(
          handles.length > 1
            ? `Reading images (${i + 1}/${handles.length})…`
            : 'Reading image…'
        )
        const loaded = await readSequenceHandleBatch([handles[i]], token, sequenceStillCurrent)
        if (!loaded || !sequenceStillCurrent(token)) return
        const single = [{ bytes: loaded[0].bytes, selection: { mode: 'proposal' } }]
        let body
        try { body = encodeGeneralSequenceBody(single) } catch (error) {
          throw new Error(error.message || SEQUENCE_FRAME_LIMIT_MESSAGE)
        }
        const digest = await sha256Hex(body)
        if (!sequenceStillCurrent(token)) return
        setSequenceStatusText(
          handles.length > 1
            ? `Recovering pixels (${i + 1}/${handles.length})…`
            : 'Recovering pixels…'
        )
        const result = await api.importGeneralSequence(token.projectId, {
          expectedRevision: token.revision,
          expectedSha256: digest,
          background: token.background || 'auto',
          name: token.name || 'Sequence',
          bytes: body,
          preview: true,
          signal: controller?.signal,
        })
        if (!sequenceStillCurrent(token)) return
        if (result.preview.grid_consistent !== true) {
          gridConsistent = false
          gridReason = result.preview.grid_reason || 'passthrough_or_unconfirmed_grid'
        }
        for (const frame of result.preview.frames || []) {
          runningMaxW = Math.max(runningMaxW, frame.width)
          runningMaxH = Math.max(runningMaxH, frame.height)
          assertSequencePreviewBudget(previewFrames.length + 1, runningMaxW, runningMaxH, session.sequenceMaxExpandedBytes)
          if (stepX === null) { stepX = frame.step_x; stepY = frame.step_y }
          else if (frame.step_x !== stepX || frame.step_y !== stepY) {
            gridConsistent = false
            gridReason = 'mixed_source_grid_steps'
          }
          previewFrames.push(frame)
        }
      }
      const maxW = Math.max(...previewFrames.map((f) => f.width))
      const maxH = Math.max(...previewFrames.map((f) => f.height))
      assertSequencePreviewBudget(previewFrames.length, maxW, maxH, session.sequenceMaxExpandedBytes)
      for (const f of previewFrames) {
        f.placed_width = maxW
        f.placed_height = maxH
        f.padded = f.width !== maxW || f.height !== maxH
      }
      const operationId = createOperationId()
      sequenceReview = {
        ...token,
        background: token.background || 'auto',
        name: token.name || 'Sequence',
        sourceHandles: handles,
        operationId,
        batchOperationIds: null,
        committedBatchCount: 0,
        committedFrameCount: 0,
        committedDocumentId: '',
        committedRevision: token.revision,
        lastConfirmedResult: null,
        frozenCommitBatches: null,
        submitting: false,
        unknownPending: false,
        unknownWrite: null,
        grid_consistent: gridConsistent,
        grid_reason: gridReason,
        frames: previewFrames.map((frame) => {
          const image = new Image()
          image.src = `data:image/png;base64,${frame.c_png_base64}`
          const mask = Uint8Array.from(atob(frame.proposal_mask_base64), (char) => char.charCodeAt(0))
          const proposal = mask.slice()
          return { ...frame, image, mask, proposal }
        }),
      }
      stopSequencePreviewWork(controller)
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = false
      drawSequenceReview()
    } catch (error) {
      if (!sequenceStillCurrent(token)) return
      const wasAborted = isSequenceAbortError(error) || Boolean(controller?.signal?.aborted)
      stopSequencePreviewWork(controller)
      releaseSequenceReview()
      renderSequenceStatus()
      if (wasAborted) return
      sequenceError(error.reason || error.message || SEQUENCE_EXPANDED_LIMIT_MESSAGE || 'Sequence preview failed.')
    }
  }
  function beginSequencePreview(sources, { name = 'Sequence', background = nodes.sequenceBackground?.value || 'auto', sourceJobId = null, anchor = null } = {}) {
    if (!session.project || !nodes.sequenceRoot) return null
    stopSequencePreviewWork()
    setSequenceFileHeader(name || 'Generated image')
    const token = {
      serial: ++sequenceSerial,
      projectId: session.project.id,
      revision: session.project.revision,
      epoch: api.openEpoch.current,
      background: background || 'auto',
      name,
      sourceJobId: sourceJobId || null,
      anchor: anchor || null,
    }
    if (nodes.sequenceBackground && nodes.sequenceBackground.value !== token.background) nodes.sequenceBackground.value = token.background
    nodes.sequenceRoot.hidden = false
    previewSequenceSources(sources, token).catch((error) => {
      if (!sequenceStillCurrent(token)) return
      stopSequencePreviewWork()
      releaseSequenceReview()
      renderSequenceStatus()
      if (isSequenceAbortError(error)) return
      sequenceError(error.reason || error.message || 'Sequence preview failed.')
    })
    return token
  }
  async function commitSequence() {
    if (!sequenceReview) return
    if (sequenceReview.unknownPending && sequenceReview.unknownWrite) {
      sequenceReview.unknownWrite.dismissed = false
      session.pendingImport = sequenceReview.unknownWrite
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      syncSequenceActionButtons()
      openUnknown('sequence', sequenceReview.unknownWrite)
      return
    }
    if (session.pendingImport || sequenceReview.submitting) return
    const reviewed = sequenceReview
    if (!sequenceStillCurrent(reviewed)) {
      sequenceError('The preview is out of date. Choose the images again.')
      return
    }
    let handleBatches = reviewed.frozenCommitBatches
    if (!handleBatches) {
      try {
        const descriptors = reviewed.frames.map((frame, index) => ({
          handle: reviewed.sourceHandles[index],
          size: reviewed.sourceHandles[index]?.size ?? reviewed.sourceHandles[index]?.bytes?.byteLength ?? 0,
          selection: frame.transparent_source
            ? { mode: 'proposal' }
            : maskSelectionFromBitMasks(frame.proposal, frame.mask, frame.width, frame.height),
        }))
        handleBatches = partitionSequenceSourceBatches(descriptors, sequenceBatchLimitBytes())
        reviewed.frozenCommitBatches = handleBatches
      } catch (error) {
        sequenceError(error.message || 'The cell selection is too large.')
        return
      }
    }
    if (!Array.isArray(reviewed.batchOperationIds) || reviewed.batchOperationIds.length !== handleBatches.length) {
      reviewed.batchOperationIds = handleBatches.map((_, index) => (index === 0 ? reviewed.operationId : createOperationId()))
    }
    reviewed.submitting = true
    const write = rememberWrite('sequence', reviewed.projectId, {
      openToken: reviewed.epoch,
      canvasIds: reviewed.initialCanvasIds || Object.keys(session.project.canvases || {}),
    })
    write.anchor = reviewed.anchor || null
    if (!reviewed.initialCanvasIds) reviewed.initialCanvasIds = write.canvasIds
    session.pendingImport = write
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    syncSequenceActionButtons()
    let batchIndex = Number.isInteger(reviewed.committedBatchCount) ? reviewed.committedBatchCount : 0
    let currentRevision = Number.isInteger(reviewed.committedRevision) ? reviewed.committedRevision : reviewed.revision
    let createdDocumentId = reviewed.committedDocumentId || ''
    let lastResult = reviewed.lastConfirmedResult || null
    const markRecoveredJobDone = () => {
      if (!reviewed.sourceJobId) return
      const recoverBtn = root.querySelector(`[data-recover-job="${reviewed.sourceJobId}"]`)
      if (recoverBtn) {
        recoverBtn.dataset.recoveredDone = 'true'
        recoverBtn.textContent = 'Saved in this project'
        recoverBtn.disabled = true
      }
    }
    const settleAlreadyImported = async (project) => {
      write.resumeSequence = null
      reviewed.unknownPending = false
      reviewed.unknownWrite = null
      reviewed.submitting = false
      closeSequenceDialog(true)
      if (project) {
        await applyProject(project, { preserveView: true, write })
      }
      markRecoveredJobDone()
    }
    const recordCommittedBatch = (result, batchLen) => {
      lastResult = result
      currentRevision = result.project?.revision ?? result.receipt?.project_revision ?? (currentRevision + 1)
      if (!createdDocumentId) createdDocumentId = result.document?.document_id || result.receipt?.document_id || ''
      batchIndex += 1
      reviewed.committedBatchCount = batchIndex
      reviewed.committedFrameCount = (reviewed.committedFrameCount || 0) + batchLen
      reviewed.committedRevision = currentRevision
      reviewed.revision = currentRevision
      reviewed.committedDocumentId = createdDocumentId
      reviewed.lastConfirmedResult = result
    }
    const runRemainingBatches = async (confirmedBody = null) => {
      let unresolved = false
      try {
        if (confirmedBody) {
          reviewed.unknownPending = false
          reviewed.unknownWrite = null
          if ((confirmedBody.already_imported === true || confirmedBody.alreadyImported === true) && batchIndex === 0 && reviewed.sourceJobId) {
            await settleAlreadyImported(confirmedBody.project)
            return
          }
          recordCommittedBatch(confirmedBody, handleBatches[batchIndex]?.length || 0)
        }
        while (batchIndex < handleBatches.length) {
          const descriptorBatch = handleBatches[batchIndex]
          const opId = reviewed.batchOperationIds[batchIndex]
          const loadedBatch = await readSequenceHandleBatch(
            descriptorBatch.map((item) => item.handle),
            reviewed,
            sequenceStillCurrent
          )
          if (!loadedBatch || !sequenceStillCurrent(reviewed) || session.pendingImport !== write) return
          const batch = descriptorBatch.map((item, idx) => ({
            bytes: loadedBatch[idx].bytes,
            selection: item.selection,
          }))
          const body = encodeGeneralSequenceBody(batch)
          const digest = await sha256Hex(body)
          const query = new URLSearchParams({
            operation_id: opId,
            expected_revision: String(currentRevision),
            expected_sha256: digest,
            background: reviewed.background || 'auto',
            name: reviewed.name,
            preview: '0',
            ...(batchIndex > 0 && createdDocumentId ? { append_document_id: createdDocumentId } : {}),
            ...(batchIndex === 0 && reviewed.sourceJobId ? { source_job_id: reviewed.sourceJobId } : {}),
          })
          write.request = {
            method: 'POST',
            url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(reviewed.projectId)}/sprite-documents/general-sequence?${query}`,
            headers: { 'content-type': 'application/octet-stream' },
            body,
            rememberUnknown: true,
            requiredOperationId: opId,
            allowAlreadyImported: Boolean(batchIndex === 0 && reviewed.sourceJobId),
            projectId: reviewed.projectId,
          }
          if (!sequenceStillCurrent(reviewed) || session.pendingImport !== write) return
          if (handleBatches.length > 1 && nodes.sequenceStatus) {
            nodes.sequenceStatus.textContent = `Importing batch ${batchIndex + 1} of ${handleBatches.length}…`
          }
          const result = await api.importGeneralSequence(reviewed.projectId, {
            operationId: opId,
            expectedRevision: currentRevision,
            expectedSha256: digest,
            background: reviewed.background || 'auto',
            name: reviewed.name,
            bytes: body,
            ...(batchIndex > 0 && createdDocumentId ? { appendDocumentId: createdDocumentId } : {}),
            ...(batchIndex === 0 && reviewed.sourceJobId ? { sourceJobId: reviewed.sourceJobId } : {}),
          })
          if (!writeStillCurrent(write)) return
          if (result.alreadyImported && batchIndex === 0 && reviewed.sourceJobId) {
            await settleAlreadyImported(result.project)
            return
          }
          if (!result.receipt || result.receipt.operation_id !== opId || result.receipt.project_id !== reviewed.projectId) {
            throw Object.assign(new Error('Sequence import was not confirmed.'), { kind: 'unknown', request: write.request })
          }
          recordCommittedBatch(result, descriptorBatch.length)
        }
        write.resumeSequence = null
        reviewed.unknownPending = false
        reviewed.unknownWrite = null
        reviewed.submitting = false
        closeSequenceDialog(true)
        await finishConfirmedImport(lastResult, write)
        markRecoveredJobDone()
      } catch (error) {
        if (!writeStillCurrent(write)) return
        if (error.kind === 'unknown') {
          unresolved = true
          reviewed.unknownPending = true
          reviewed.unknownWrite = write
          syncSequenceActionButtons()
          bindUnknown(write, error)
          write.request = error.request || write.request
          write.resumeSequence = (body) => runRemainingBatches(body)
          sequenceError('Sequence import result is unknown. Retry uses the same operation.')
          openUnknown('sequence', write)
        } else {
          reviewed.unknownPending = false
          reviewed.unknownWrite = null
          reviewed.submitting = false
          if (session.pendingImport === write) session.pendingImport = false
          if (reviewed.committedBatchCount > 0 && lastResult?.project) {
            try {
              await applyProject(lastResult.project, { preserveView: true, write })
            } catch {
              /* Keep sequence review state for retry */
            }
          } else {
            invalidateUncommittedSequenceBatches(reviewed)
          }
          renderSequenceStatus()
          if (reviewed.committedBatchCount > 0) {
            const detail = error.reason || error.message || 'Batch import failed.'
            sequenceError(`${detail} ${reviewed.committedFrameCount} of ${reviewed.frames.length} frames (${reviewed.committedBatchCount}/${handleBatches.length} batches) were saved. Click Import sequence to retry the remaining frames.`)
          } else {
            sequenceError(error.reason || error.message || 'Sequence import failed. No canvas was confirmed.')
          }
          if (nodes.sequenceImport) nodes.sequenceImport.disabled = false
          syncSequenceActionButtons()
        }
      } finally {
        if (!unresolved) {
          if (session.pendingImport === write) session.pendingImport = false
          syncSequenceActionButtons()
          renderChrome()
          renderConversationRef()
          notifyDraftChange()
        }
      }
    }
    await runRemainingBatches()
  }
  const MOTION_VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i
  const VNEXT_IMPORT_GIF_MAX_BYTES = 64 * 1024 * 1024
  const VNEXT_IMPORT_VIDEO_MAX_BYTES = 200 * 1024 * 1024
  function classifyMotionPickerFile(file) {
    if (!file) return null
    const type = String(file.type || '').toLowerCase()
    const name = String(file.name || '').toLowerCase()
    if (type === 'image/gif' || name.endsWith('.gif')) return 'gif'
    if (type.startsWith('video/') || MOTION_VIDEO_EXT_RE.test(name)) return 'video'
    return null
  }
  function syncMotionModeFields() {
    const mode = nodes.motionMode?.value === 'stride' ? 'stride' : 'fps'
    if (nodes.motionFpsWrap) nodes.motionFpsWrap.hidden = mode !== 'fps'
    if (nodes.motionStrideWrap) nodes.motionStrideWrap.hidden = mode !== 'stride'
  }
  function renderMotionStatus() {
    if (!nodes.sequenceStatus) return
    syncSequenceActionButtons()
    if (!sequenceReview?.isMotion) {
      renderSequenceStatus()
      return
    }
    nodes.sequenceStatus.replaceChildren()
    if (sequenceReview.isVideo) {
      setSequenceDialogMode('video')
      if (sequenceReview.previewCancelled) {
        setMotionInlineState('Preview cancelled.')
      } else if (sequenceReview.previewError) {
        /* keep error message in motionPreviewState */
      } else if (sequenceAbort) {
        setMotionInlineState('Extracting preview…')
      } else if (sequenceReview.previewStale && sequenceReview.hasPreviewedOnce) {
        setMotionInlineState('Parameters changed')
      } else {
        setMotionInlineState('')
      }
    } else {
      setSequenceDialogMode('gif')
      setMotionInlineState('')
    }
    if (sequenceReview.isVideo && (sequenceReview.previewStale || !sequenceReview.frames?.length)) {
      const fallbackText = sequenceReview.previewCancelled
        ? 'Preview cancelled.'
        : (sequenceReview.hasPreviewedOnce ? 'Parameters changed' : '')
      if (fallbackText) {
        const p = document.createElement('p')
        p.textContent = fallbackText
        nodes.sequenceStatus.append(p)
        if (nodes.sequenceStatus.textContent !== fallbackText) {
          nodes.sequenceStatus.textContent = fallbackText
        }
      } else {
        nodes.sequenceStatus.textContent = ''
      }
      nodes.sequenceStatus.hidden = !fallbackText || Boolean(nodes.motionPreviewState)
      return
    }
    const frameCount = sequenceReview.frames.length
    const summaryText = `${frameCount} frame${frameCount === 1 ? '' : 's'} · ${sequenceReview.canvasWidth}×${sequenceReview.canvasHeight} px · ${sequenceReview.totalDurationMs} ms`
    const summary = document.createElement('p')
    summary.textContent = summaryText
    nodes.sequenceStatus.append(summary)
    if (nodes.sequenceStatus.textContent !== summaryText) {
      nodes.sequenceStatus.textContent = summaryText
    }
    nodes.sequenceStatus.hidden = frameCount === 0
  }
  function startMotionPreviewLoop(review) {
    stopMotionPlayback()
    if (!nodes.motionPreviewStage || !nodes.motionPreviewCanvas || !review?.frames?.length) {
      if (nodes.motionPreviewStage) nodes.motionPreviewStage.hidden = true
      return
    }
    const maxStagePx = 72
    const rawW = Math.max(1, review.canvasWidth || review.frames[0]?.width || 1)
    const rawH = Math.max(1, review.canvasHeight || review.frames[0]?.height || 1)
    const scale = sequenceDisplayScale(rawW, rawH)
    const scaledW = rawW * scale
    const scaledH = rawH * scale
    const fit = Math.min(1, maxStagePx / Math.max(scaledW, scaledH, 1))
    const boxW = Math.max(1, Math.round(scaledW * fit))
    const boxH = Math.max(1, Math.round(scaledH * fit))
    nodes.motionPreviewCanvas.width = boxW
    nodes.motionPreviewCanvas.height = boxH
    nodes.motionPreviewCanvas.style.width = `${boxW}px`
    nodes.motionPreviewCanvas.style.height = `${boxH}px`
    nodes.motionPreviewStage.hidden = false
    let activeIdx = 0
    const paintFrame = (idx) => {
      if (sequenceReview !== review || !review.frames?.length || !nodes.motionPreviewCanvas) return
      activeIdx = idx % review.frames.length
      const frame = review.frames[activeIdx]
      const ctx = nodes.motionPreviewCanvas.getContext?.('2d')
      if (ctx && frame?.image) {
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, boxW, boxH)
        if (frame.image.complete) {
          ctx.drawImage(frame.image, 0, 0, boxW, boxH)
        } else {
          frame.image.addEventListener?.('load', () => {
            if (sequenceReview === review && activeIdx === idx % review.frames.length) {
              ctx.imageSmoothingEnabled = false
              ctx.clearRect(0, 0, boxW, boxH)
              ctx.drawImage(frame.image, 0, 0, boxW, boxH)
            }
          }, { once: true })
        }
      }
      if (nodes.motionPreviewMeta) {
        nodes.motionPreviewMeta.textContent = `Frame ${activeIdx + 1}/${review.frames.length} · ${frame?.duration_ms ?? 100} ms · ${rawW}×${rawH} px`
      }
    }
    const step = (idx = 0) => {
      if (sequenceReview !== review || !review.frames?.length || nodes.sequenceRoot?.hidden) return
      const currentIdx = idx % review.frames.length
      paintFrame(currentIdx)
      if (review.frames.length <= 1) return
      const delay = Math.max(20, Number(review.frames[currentIdx]?.duration_ms) || 100)
      motionPlayTimer = setTimeout(() => step((currentIdx + 1) % review.frames.length), delay)
      motionPlayTimer?.unref?.()
    }
    step(0)
  }
  function drawMotionReview() {
    if (!nodes.sequenceFrames || !sequenceReview?.isMotion) return
    for (const child of [...(nodes.sequenceFrames.children || [])]) {
      if (typeof child?.width === 'number') child.width = 0
      if (typeof child?.height === 'number') child.height = 0
      const innerCanvas = child?.querySelector?.('canvas')
      if (innerCanvas) {
        innerCanvas.width = 0
        innerCanvas.height = 0
      }
    }
    nodes.sequenceFrames.replaceChildren()
    nodes.sequenceFrames.hidden = sequenceReview.frames.length === 0
    const maxPreviewBoxPx = 72
    sequenceReview.frames.forEach((frame, index) => {
      const scale = sequenceDisplayScale(frame.width, frame.height)
      const rawWidth = frame.width * scale
      const rawHeight = frame.height * scale
      const fitScale = Math.min(1, maxPreviewBoxPx / Math.max(rawWidth, rawHeight, 1))
      const cssWidth = Math.max(1, Math.round(rawWidth * fitScale))
      const cssHeight = Math.max(1, Math.round(rawHeight * fitScale))
      const card = document.createElement('div')
      card.className = 'vnext-motion-frame-card'
      card.dataset.frameIndex = String(index)
      card.dataset.durationMs = String(frame.duration_ms)
      const canvas = document.createElement('canvas')
      canvas.width = cssWidth
      canvas.height = cssHeight
      canvas.dataset.logicalWidth = String(frame.width)
      canvas.dataset.logicalHeight = String(frame.height)
      canvas.dataset.durationMs = String(frame.duration_ms)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      canvas.style.maxWidth = `${maxPreviewBoxPx}px`
      canvas.style.maxHeight = `${maxPreviewBoxPx}px`
      canvas.setAttribute('aria-label', `Frame ${index + 1} (${frame.duration_ms} ms)`)
      const context = canvas.getContext('2d')
      const image = frame.image
      const paint = () => {
        context.imageSmoothingEnabled = false
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
      }
      if (image.complete) paint()
      else image.addEventListener('load', paint, { once: true })
      const label = document.createElement('span')
      label.textContent = `#${index + 1} · ${frame.duration_ms}ms`
      card.append(canvas)
      card.append(label)
      nodes.sequenceFrames.append(card)
    })
    startMotionPreviewLoop(sequenceReview)
    renderMotionStatus()
  }
  async function runVideoSegmentPreview(targetReview, { startSec, endSec, samplingMode, fps, stride, requestSerial }) {
    const reqSerial = Number.isInteger(requestSerial) ? requestSerial : targetReview?.serial
    const reqToken = targetReview ? {
      serial: reqSerial,
      projectId: targetReview.projectId,
      epoch: targetReview.epoch,
      background: targetReview.background,
    } : null
    const isOwnedRequestCurrent = () => Boolean(
      targetReview?.isVideo &&
      sequenceReview === targetReview &&
      targetReview.serial === reqSerial &&
      sequenceStillCurrent(reqToken)
    )
    if (!isOwnedRequestCurrent()) return
    targetReview.previewCancelled = false
    targetReview.previewError = false
    targetReview.changedWhileExtracting = false
    sequenceError('')
    stopMotionPlayback()
    if (!Number.isFinite(startSec) || startSec < 0 || !Number.isFinite(endSec) || endSec <= startSec) {
      stopSequencePreviewWork()
      targetReview.hasPreviewedOnce = true
      targetReview.previewStale = true
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      renderMotionStatus()
      sequenceError('End time must be greater than start time.')
      return
    }
    if (samplingMode === 'fps' && (!Number.isFinite(fps) || fps < 1 || fps > 30)) {
      stopSequencePreviewWork()
      targetReview.hasPreviewedOnce = true
      targetReview.previewStale = true
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      renderMotionStatus()
      sequenceError('Target FPS must be between 1 and 30.')
      return
    }
    if (samplingMode === 'stride' && (!Number.isInteger(stride) || stride < 1 || stride > 120)) {
      stopSequencePreviewWork()
      targetReview.hasPreviewedOnce = true
      targetReview.previewStale = true
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      renderMotionStatus()
      sequenceError('Every N frames must be an integer between 1 and 120.')
      return
    }
    stopSequencePreviewWork()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    sequenceAbort = controller
    if (nodes.sequenceStop) nodes.sequenceStop.hidden = false
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    setMotionInlineState('Extracting preview…')
    if (nodes.sequenceStatus) {
      nodes.sequenceStatus.replaceChildren()
      nodes.sequenceStatus.textContent = 'Extracting preview…'
      nodes.sequenceStatus.hidden = Boolean(nodes.motionPreviewState)
    }
    syncSequenceActionButtons()
    try {
      const requestPreview = async (includeBytes) => api.importMotionTimeline(targetReview.projectId, {
        expectedRevision: session.project?.revision ?? targetReview.revision,
        expectedSha256: targetReview.expectedSha256,
        action: 'preview',
        kind: 'video',
        fileName: targetReview.fileName,
        name: targetReview.name,
        startSec,
        endSec,
        samplingMode,
        fps: samplingMode === 'fps' ? fps : null,
        stride: samplingMode === 'stride' ? stride : null,
        bytes: includeBytes ? targetReview.sourceBytes : null,
        signal: controller?.signal,
      })
      let result
      try {
        result = await requestPreview(false)
      } catch (err) {
        if (err?.code === 'invalid_request' && /not staged/i.test(String(err?.reason || err?.message || ''))) {
          result = await requestPreview(true)
        } else {
          throw err
        }
      }
      if (!isOwnedRequestCurrent() || controller?.signal?.aborted) return
      const preview = result.preview || {}
      const sampling = preview.sampling || {}
      targetReview.startSec = sampling.start_sec ?? startSec
      targetReview.endSec = sampling.end_sec ?? endSec
      targetReview.samplingMode = sampling.sampling_mode ?? samplingMode
      targetReview.fps = sampling.fps ?? fps
      targetReview.stride = sampling.stride ?? stride
      targetReview.canvasWidth = preview.width || preview.frames?.[0]?.width || targetReview.probeWidth || 1
      targetReview.canvasHeight = preview.height || preview.frames?.[0]?.height || targetReview.probeHeight || 1
      targetReview.totalDurationMs = preview.total_duration_ms || 0
      targetReview.hasPreviewedOnce = true
      targetReview.previewStale = Boolean(targetReview.changedWhileExtracting)
      targetReview.previewCancelled = false
      targetReview.previewError = false
      targetReview.operationId = createOperationId()
      if (Number.isInteger(session.project?.revision)) targetReview.revision = session.project.revision
      targetReview.frames = (preview.frames || []).map((frame) => {
        const image = new Image()
        image.src = `data:image/png;base64,${frame.png_base64}`
        return { ...frame, image }
      })
      stopSequencePreviewWork(controller)
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = targetReview.frames.length === 0 || targetReview.previewStale
      drawMotionReview()
    } catch (error) {
      if (!isOwnedRequestCurrent()) return
      const wasAborted = isSequenceAbortError(error) || Boolean(controller?.signal?.aborted)
      stopSequencePreviewWork(controller)
      releaseSequenceReview({ keepVideoControls: true })
      targetReview.frames = []
      targetReview.hasPreviewedOnce = true
      targetReview.previewStale = true
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      if (wasAborted) {
        targetReview.previewCancelled = true
        renderMotionStatus()
        return
      }
      renderMotionStatus()
      sequenceError(error.reason || error.message || 'Video preview failed.')
    }
  }
  async function previewMotionSource(file, token) {
    const reqToken = token ? { ...token, serial: token.serial } : null
    if (!sequenceStillCurrent(reqToken)) return
    const kind = classifyMotionPickerFile(file)
    if (!kind) return
    sequenceError('')
    releaseSequenceReview()
    setSequenceDialogMode(kind)
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    syncSequenceActionButtons()
    const maxBytes = kind === 'gif' ? VNEXT_IMPORT_GIF_MAX_BYTES : VNEXT_IMPORT_VIDEO_MAX_BYTES
    if (Number.isFinite(file.size) && file.size <= 0) {
      stopSequencePreviewWork()
      renderSequenceStatus()
      sequenceError('Selected media file is empty.')
      return
    }
    if (Number.isFinite(file.size) && file.size > maxBytes) {
      stopSequencePreviewWork()
      renderSequenceStatus()
      sequenceError(kind === 'gif' ? 'GIF exceeds the 64 MiB import limit.' : 'Video exceeds the 200 MiB import limit.')
      return
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    sequenceAbort = controller
    if (nodes.sequenceStop) nodes.sequenceStop.hidden = false
    syncSequenceActionButtons()
    try {
      setSequenceStatusText(kind === 'gif' ? 'Reading GIF…' : 'Reading video…')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!sequenceStillCurrent(reqToken) || controller?.signal?.aborted) return
      if (bytes.byteLength === 0) {
        throw new Error('Selected media file is empty.')
      }
      if (bytes.byteLength > maxBytes) {
        throw new Error(kind === 'gif' ? 'GIF exceeds the 64 MiB import limit.' : 'Video exceeds the 200 MiB import limit.')
      }
      const digest = await sha256Hex(bytes)
      if (!sequenceStillCurrent(reqToken) || controller?.signal?.aborted) return
      const stem = String(file.name || '').split(/[/\\]/).pop().replace(/\.[a-z0-9]+$/i, '').trim()
      const docName = (stem && !/[\x00-\x1f\x7f]/.test(stem) ? stem : (kind === 'gif' ? 'GIF sequence' : 'Video sequence')).slice(0, 128)
      if (kind === 'gif') {
        if (nodes.motionControls) nodes.motionControls.hidden = true
        revokeMotionObjectUrl()
        setSequenceStatusText('Decoding GIF frames…')
        const result = await api.importMotionTimeline(reqToken.projectId, {
          expectedRevision: reqToken.revision,
          expectedSha256: digest,
          action: 'preview',
          kind: 'gif',
          fileName: file.name || 'animation.gif',
          name: docName,
          bytes,
          signal: controller?.signal,
        })
        if (!sequenceStillCurrent(reqToken) || controller?.signal?.aborted) return
        const preview = result.preview || {}
        sequenceReview = {
          ...reqToken,
          isMotion: true,
          isVideo: false,
          kind: 'gif',
          name: docName,
          fileName: file.name || 'animation.gif',
          expectedSha256: digest,
          sourceBytes: bytes,
          operationId: createOperationId(),
          committedBatchCount: 0,
          submitting: false,
          unknownPending: false,
          unknownWrite: null,
          previewStale: false,
          canvasWidth: preview.width || preview.frames?.[0]?.width || 1,
          canvasHeight: preview.height || preview.frames?.[0]?.height || 1,
          totalDurationMs: preview.total_duration_ms || 0,
          frames: (preview.frames || []).map((frame) => {
            const image = new Image()
            image.src = `data:image/png;base64,${frame.png_base64}`
            return { ...frame, image }
          }),
        }
        stopSequencePreviewWork(controller)
        if (nodes.sequenceImport) nodes.sequenceImport.disabled = sequenceReview.frames.length === 0
        drawMotionReview()
        return
      }
      setSequenceStatusText('Inspecting video metadata…')
      const probeResult = await api.importMotionTimeline(reqToken.projectId, {
        expectedRevision: reqToken.revision,
        expectedSha256: digest,
        action: 'probe',
        kind: 'video',
        fileName: file.name || 'clip.mp4',
        name: docName,
        bytes,
        signal: controller?.signal,
      })
      if (!sequenceStillCurrent(reqToken) || controller?.signal?.aborted) return
      const probe = probeResult.probe || {}
      const defaults = probe.default_sampling || {}
      const startSec = Number.isFinite(defaults.start_sec) ? defaults.start_sec : 0
      const endSec = Number.isFinite(defaults.end_sec) ? defaults.end_sec : Math.min(4, Number(probe.duration_sec) || 2)
      const samplingMode = defaults.sampling_mode === 'stride' ? 'stride' : 'fps'
      const fps = Number.isFinite(defaults.fps) ? defaults.fps : 8
      const stride = Number.isInteger(defaults.stride) ? defaults.stride : 2
      if (nodes.motionStart) nodes.motionStart.value = String(startSec)
      if (nodes.motionEnd) nodes.motionEnd.value = String(endSec)
      if (nodes.motionMode) nodes.motionMode.value = samplingMode
      if (nodes.motionFps) nodes.motionFps.value = String(fps)
      if (nodes.motionStride) nodes.motionStride.value = String(stride)
      syncMotionModeFields()
      if (nodes.motionControls) nodes.motionControls.hidden = false
      revokeMotionObjectUrl()
      if (typeof URL?.createObjectURL === 'function' && typeof Blob === 'function') {
        try {
          motionObjectUrl = URL.createObjectURL(new Blob([bytes], { type: file.type || 'video/mp4' }))
          if (nodes.motionPlayer) nodes.motionPlayer.src = motionObjectUrl
        } catch {}
      }
      sequenceReview = {
        ...reqToken,
        isMotion: true,
        isVideo: true,
        kind: 'video',
        name: docName,
        fileName: file.name || 'clip.mp4',
        expectedSha256: digest,
        sourceBytes: bytes,
        probeWidth: probe.width || 0,
        probeHeight: probe.height || 0,
        probeDurationSec: Number(probe.duration_sec) || 0,
        probeSourceFps: Number(probe.source_fps) || 0,
        startSec,
        endSec,
        samplingMode,
        fps,
        stride,
        operationId: createOperationId(),
        committedBatchCount: 0,
        submitting: false,
        unknownPending: false,
        unknownWrite: null,
        hasPreviewedOnce: false,
        previewStale: true,
        previewCancelled: false,
        previewError: false,
        changedWhileExtracting: false,
        canvasWidth: probe.width || 1,
        canvasHeight: probe.height || 1,
        totalDurationMs: 0,
        frames: [],
      }
      syncSequenceActionButtons()
      await runVideoSegmentPreview(sequenceReview, {
        startSec,
        endSec,
        samplingMode,
        fps,
        stride,
        requestSerial: reqToken.serial,
      })
    } catch (error) {
      if (!sequenceStillCurrent(reqToken)) return
      const wasAborted = isSequenceAbortError(error) || Boolean(controller?.signal?.aborted)
      stopSequencePreviewWork(controller)
      releaseSequenceReview()
      renderSequenceStatus()
      if (wasAborted) return
      sequenceError(error.reason || error.message || 'Motion preview failed.')
    }
  }
  async function commitMotionSequence() {
    if (!sequenceReview?.isMotion) return
    if (sequenceReview.unknownPending && sequenceReview.unknownWrite) {
      sequenceReview.unknownWrite.dismissed = false
      session.pendingImport = sequenceReview.unknownWrite
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      syncSequenceActionButtons()
      openUnknown('sequence', sequenceReview.unknownWrite)
      return
    }
    if (session.pendingImport || sequenceReview.submitting) return
    const reviewed = sequenceReview
    if (!sequenceStillCurrent(reviewed)) {
      sequenceError('The preview is out of date. Choose the file again.')
      return
    }
    if (reviewed.previewStale || !reviewed.frames?.length) {
      sequenceError('Preview the selected segment before importing to the timeline.')
      return
    }
    reviewed.submitting = true
    const currentRevision = Number.isInteger(session.project?.revision) ? session.project.revision : reviewed.revision
    const opId = reviewed.operationId || createOperationId()
    reviewed.operationId = opId
    const write = rememberWrite('sequence', reviewed.projectId, {
      openToken: reviewed.epoch,
      canvasIds: reviewed.initialCanvasIds || Object.keys(session.project.canvases || {}),
    })
    write.anchor = reviewed.anchor || sequenceAnchor || null
    if (!reviewed.initialCanvasIds) reviewed.initialCanvasIds = write.canvasIds
    session.pendingImport = write
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    syncSequenceActionButtons()
    let unresolved = false
    try {
      const query = new URLSearchParams({
        operation_id: opId,
        expected_revision: String(currentRevision),
        expected_sha256: reviewed.expectedSha256,
        action: 'commit',
        kind: reviewed.kind,
        file_name: reviewed.fileName,
        name: reviewed.name,
      })
      if (reviewed.isVideo) {
        query.set('start_sec', String(reviewed.startSec))
        query.set('end_sec', String(reviewed.endSec))
        query.set('sampling_mode', reviewed.samplingMode)
        if (reviewed.samplingMode === 'fps') query.set('fps', String(reviewed.fps))
        if (reviewed.samplingMode === 'stride') query.set('stride', String(reviewed.stride))
      }
      write.request = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(reviewed.projectId)}/sprite-documents/motion-import?${query}`,
        headers: { 'content-type': 'application/octet-stream' },
        body: reviewed.sourceBytes,
        rememberUnknown: true,
        requiredOperationId: opId,
        projectId: reviewed.projectId,
      }
      setSequenceStatusText('Importing frames to timeline…')
      const result = await api.importMotionTimeline(reviewed.projectId, {
        operationId: opId,
        expectedRevision: currentRevision,
        expectedSha256: reviewed.expectedSha256,
        action: 'commit',
        kind: reviewed.kind,
        fileName: reviewed.fileName,
        name: reviewed.name,
        startSec: reviewed.isVideo ? reviewed.startSec : null,
        endSec: reviewed.isVideo ? reviewed.endSec : null,
        samplingMode: reviewed.isVideo ? reviewed.samplingMode : null,
        fps: reviewed.isVideo && reviewed.samplingMode === 'fps' ? reviewed.fps : null,
        stride: reviewed.isVideo && reviewed.samplingMode === 'stride' ? reviewed.stride : null,
        bytes: reviewed.sourceBytes,
      })
      if (!writeStillCurrent(write)) return
      if (!result.receipt || result.receipt.operation_id !== opId || result.receipt.project_id !== reviewed.projectId) {
        throw Object.assign(new Error('Motion sequence import was not confirmed.'), { kind: 'unknown', request: write.request })
      }
      write.resumeSequence = null
      reviewed.unknownPending = false
      reviewed.unknownWrite = null
      reviewed.submitting = false
      closeSequenceDialog(true)
      await finishConfirmedImport(result, write)
    } catch (error) {
      if (!writeStillCurrent(write)) return
      if (error.kind === 'unknown') {
        unresolved = true
        reviewed.unknownPending = true
        reviewed.unknownWrite = write
        syncSequenceActionButtons()
        bindUnknown(write, error)
        write.request = error.request || write.request
        write.resumeSequence = async (body) => {
          write.resumeSequence = null
          reviewed.unknownPending = false
          reviewed.unknownWrite = null
          reviewed.submitting = false
          closeSequenceDialog(true)
          await finishConfirmedImport(body, write)
          if (session.pendingImport === write) session.pendingImport = false
          renderChrome()
        }
        sequenceError('Sequence import result is unknown. Retry uses the same operation.')
        openUnknown('sequence', write)
      } else {
        reviewed.unknownPending = false
        reviewed.unknownWrite = null
        reviewed.submitting = false
        reviewed.operationId = createOperationId()
        if (Number.isInteger(session.project?.revision)) reviewed.revision = session.project.revision
        if (session.pendingImport === write) session.pendingImport = false
        renderMotionStatus()
        sequenceError(error.reason || error.message || 'Sequence import failed. No canvas was confirmed.')
        if (nodes.sequenceImport) nodes.sequenceImport.disabled = Boolean(reviewed.previewStale)
        syncSequenceActionButtons()
      }
    } finally {
      if (!unresolved) {
        if (session.pendingImport === write) session.pendingImport = false
        syncSequenceActionButtons()
        renderChrome()
        renderConversationRef()
        notifyDraftChange()
      }
    }
  }
  const markMotionPreviewStale = () => {
    syncMotionModeFields()
    if (!sequenceReview?.isVideo || sequenceSelectionLocked(sequenceReview)) return
    if (sequenceAbort) {
      sequenceReview.changedWhileExtracting = true
      sequenceReview.previewStale = true
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      syncSequenceActionButtons()
      return
    }
    sequenceSerial += 1
    sequenceReview.serial = sequenceSerial
    stopSequencePreviewWork()
    sequenceReview.hasPreviewedOnce = true
    sequenceReview.previewStale = true
    sequenceReview.previewCancelled = false
    sequenceReview.previewError = false
    sequenceReview.operationId = createOperationId()
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    sequenceError('')
    renderMotionStatus()
  }
  nodes.motionStart?.addEventListener('input', markMotionPreviewStale)
  nodes.motionEnd?.addEventListener('input', markMotionPreviewStale)
  nodes.motionMode?.addEventListener('change', markMotionPreviewStale)
  nodes.motionFps?.addEventListener('input', markMotionPreviewStale)
  nodes.motionStride?.addEventListener('input', markMotionPreviewStale)
  nodes.motionPreviewBtn?.addEventListener('click', () => {
    if (!sequenceReview?.isVideo || sequenceSelectionLocked(sequenceReview)) return
    const targetReview = sequenceReview
    const reqSerial = ++sequenceSerial
    targetReview.serial = reqSerial
    const startSec = Number(nodes.motionStart?.value ?? 0)
    const endSec = Number(nodes.motionEnd?.value ?? 1)
    const samplingMode = nodes.motionMode?.value === 'stride' ? 'stride' : 'fps'
    const fps = Number(nodes.motionFps?.value ?? 8)
    const stride = Number(nodes.motionStride?.value ?? 2)
    runVideoSegmentPreview(targetReview, {
      startSec,
      endSec,
      samplingMode,
      fps,
      stride,
      requestSerial: reqSerial,
    }).catch((error) => {
      if (sequenceReview !== targetReview || targetReview.serial !== reqSerial || !sequenceStillCurrent(targetReview)) return
      stopSequencePreviewWork()
      if (isSequenceAbortError(error)) return
      sequenceError(error.reason || error.message || 'Video preview failed.')
    })
  })
  nodes.sequenceChoose?.addEventListener('click', () => {
    if (session.pendingImport || sequenceReview?.submitting || sequenceReview?.unknownPending) return
    nodes.sequenceInput?.click()
  })
  nodes.sequenceKeepAll?.addEventListener('click', () => {
    if (sequenceSelectionLocked(sequenceReview) || sequenceReview?.isMotion) return
    for (const frame of sequenceReview.frames) {
      if (frame.transparent_source) continue
      frame.mask.fill(0)
      frame.repaint?.()
    }
    invalidateUncommittedSequenceBatches(sequenceReview)
    renderSequenceStatus()
  })
  nodes.sequenceApplyAuto?.addEventListener('click', () => {
    if (sequenceSelectionLocked(sequenceReview) || sequenceReview?.isMotion) return
    for (const frame of sequenceReview.frames) {
      if (frame.transparent_source) continue
      frame.mask.set(frame.proposal)
      frame.repaint?.()
    }
    invalidateUncommittedSequenceBatches(sequenceReview)
    renderSequenceStatus()
  })
  nodes.sequenceStop?.addEventListener('click', () => {
    if (session.pendingImport?.kind === 'sequence' || sequenceReview?.submitting || sequenceReview?.unknownPending) return
    sequenceSerial += 1
    stopSequencePreviewWork()
    if (sequenceReview?.isVideo) {
      sequenceReview.serial = sequenceSerial
      releaseSequenceReview({ keepVideoControls: true })
      sequenceReview.frames = []
      sequenceReview.hasPreviewedOnce = true
      sequenceReview.previewStale = true
      sequenceReview.previewCancelled = true
      sequenceReview.previewError = false
      sequenceReview.changedWhileExtracting = false
      if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
      sequenceError('')
      renderMotionStatus()
      return
    }
    releaseSequenceReview()
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    sequenceError('')
    setSequenceStatusText('Preview cancelled.')
    syncSequenceActionButtons()
  })
  nodes.sequenceBackground?.addEventListener('change', () => {
    if (session.pendingImport?.kind === 'sequence' || sequenceSelectionLocked(sequenceReview) || sequenceReview?.isMotion) return
    sequenceSerial += 1
    stopSequencePreviewWork()
    releaseSequenceReview()
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    setSequenceStatusText('Background changed. Choose the images again before import.')
    syncSequenceActionButtons()
  })
  nodes.sequenceRoot?.addEventListener('click', (event) => {
    if (event.target.closest('[data-sequence-cancel]')) closeSequenceDialog()
  })
  nodes.sequenceInput?.addEventListener('change', () => {
    if (session.pendingImport || sequenceReview?.submitting || sequenceReview?.unknownPending) return
    const files = [...(nodes.sequenceInput.files || [])]
    nodes.sequenceInput.value = ''
    if (!session.project || !nodes.sequenceRoot || nodes.sequenceRoot.hidden) return
    stopSequencePreviewWork()
    sequenceError('')
    releaseSequenceReview()
    if (nodes.sequenceImport) nodes.sequenceImport.disabled = true
    syncSequenceActionButtons()
    if (files.length === 0) return
    const motionKinds = files.map((f) => classifyMotionPickerFile(f))
    if (motionKinds.some(Boolean) && files.length > 1) {
      setSequenceFileHeader(null)
      renderSequenceStatus()
      sequenceError('Choose one GIF or video at a time, or select multiple PNG/JPEG images.')
      return
    }
    setSequenceFileHeader(files)
    const token = {
      serial: ++sequenceSerial,
      projectId: session.project.id,
      revision: session.project.revision,
      epoch: api.openEpoch.current,
      background: nodes.sequenceBackground?.value || 'auto',
      name: 'Sequence',
      sourceJobId: null,
      anchor: sequenceAnchor || (view.selectedId ? {
        projectId: session.project.id,
        canvasId: view.selectedId,
        documentId: session.project.canvases?.[view.selectedId]?.document_id || '',
      } : null),
    }
    if (nodes.sequenceStop) nodes.sequenceStop.hidden = false
    syncSequenceActionButtons()
    if (files.length === 1 && motionKinds[0]) {
      previewMotionSource(files[0], token).catch((error) => {
        if (!sequenceStillCurrent(token)) return
        stopSequencePreviewWork()
        releaseSequenceReview()
        renderSequenceStatus()
        if (isSequenceAbortError(error)) return
        sequenceError(error.reason || error.message || 'Motion preview failed.')
      })
      return
    }
    previewSequenceSources(files, token).catch((error) => {
      if (!sequenceStillCurrent(token)) return
      stopSequencePreviewWork()
      releaseSequenceReview()
      renderSequenceStatus()
      if (isSequenceAbortError(error)) return
      sequenceError(error.reason || error.message || 'Sequence preview failed.')
    })
  })
  nodes.sequenceImport?.addEventListener('click', () => {
    if (sequenceReview?.isMotion) {
      commitMotionSequence().catch((error) => sequenceError(error.reason || error.message || 'Sequence import failed.'))
      return
    }
    commitSequence().catch((error) => sequenceError(error.reason || error.message || 'Sequence import failed.'))
  })
  // A generated image the user asked for is placed directly. The server applies its automatic
  // background proposal (the import dialog's default), binds provenance to source_job_id and
  // keeps the unscaled original; Undo removes the new canvas. An unknown result keeps this exact
  // operation, so resolving it replays the same request and never imports a second canvas.
  let generatedImport = null
  session.importGeneratedAsset = async ({ bytes, projectId, openEpoch, background = 'auto', name = 'Generated image', sourceJobId = null, anchor = null } = {}) => {
    if (session.project?.id !== projectId || !api.openEpoch.isCurrent(openEpoch)) return { abandoned: true }
    const previous = generatedImport
    // The same image whose import committed but whose canvas did not refresh: reload only.
    if (sourceJobId && previous?.sourceJobId === sourceJobId && previous.refreshPending && writeStillCurrent(previous)) return refreshGeneratedImport(previous)
    if (sourceJobId && previous?.sourceJobId === sourceJobId && previous.importRequest && writeStillCurrent(previous)) return sendGeneratedImport(previous)
    if (projectChangeInFlight()) return { deferred: true }
    if (session.pendingImport || staticPlacementBlocked()) return { busy: true }
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
    if (!source.length) return { missingBytes: true }
    const body = encodeGeneralSequenceBody([{ bytes: source, selection: { mode: 'proposal' } }])
    const write = rememberWrite('sequence', projectId, { openToken: openEpoch, canvasIds: Object.keys(session.project.canvases || {}) })
    write.anchor = anchor
    write.sourceJobId = sourceJobId
    write.importRequest = { operationId: createOperationId(), expectedRevision: session.project.revision,
      expectedSha256: await sha256Hex(body), name, bytes: body,
      background: ['auto', 'green', 'magenta', 'purple', 'white'].includes(background) ? background : 'auto',
      ...(sourceJobId ? { sourceJobId } : {}) }
    if (!writeStillCurrent(write)) return { abandoned: true }
    generatedImport = write
    return sendGeneratedImport(write)
  }
  async function sendGeneratedImport(write) {
    if (write.busy || (session.pendingImport && session.pendingImport !== write)) return { busy: true }
    write.busy = true
    write.submitted = true
    session.pendingImport = write
    renderChrome()
    try {
      const result = await api.importGeneralSequence(write.projectId, write.importRequest)
      if (!writeStillCurrent(write)) return { abandoned: true }
      if (result.alreadyImported) {
        if (generatedImport === write) generatedImport = null
        if (result.project) await applyProject(result.project, { preserveView: true, write })
        return { alreadyImported: true }
      }
      if (!result.receipt || result.receipt.operation_id !== write.importRequest.operationId || result.receipt.project_id !== write.projectId) {
        return { unknown: true }
      }
      if (generatedImport === write) generatedImport = null
      if (session.pendingImport === write) session.pendingImport = false
      return generatedImportOutcome(await savePlacedBeside(await finishConfirmedImport(result, write, { inlineRecovery: true })), write)
    } catch (error) {
      if (!writeStillCurrent(write)) return { abandoned: true }
      if (error.kind === 'unknown') return { unknown: true }
      if (generatedImport === write) generatedImport = null
      throw error
    } finally {
      write.busy = false
      if (session.pendingImport === write) session.pendingImport = false
      renderChrome(); renderConversationRef(); notifyDraftChange()
    }
  }
  // A committed import reports its own Undo entry; one whose canvas did not refresh reports that
  // it is saved and keeps this same write (and its operation) for the inline reload.
  async function savePlacedBeside(outcome) {
    const beside = outcome?.status === 'settled' ? outcome.confirmed?.placedBeside : null
    if (beside) await placeAddedCanvas({ projectId: outcome.confirmed.projectId, canvasId: beside.canvasId, point: beside.point })
    return outcome
  }
  function generatedImportOutcome(outcome, write) {
    if (outcome.status === 'abandoned') return { abandoned: true }
    const documentId = outcome.confirmed.result.receipt?.document_id
    if (outcome.status === 'refresh_pending') {
      write.refreshPending = outcome.confirmed
      generatedImport = write
      return { saved: true, refreshPending: true, operationId: write.importRequest.operationId }
    }
    write.refreshPending = null
    if (generatedImport === write) generatedImport = null
    const canvasId = Object.values(session.project?.canvases || {}).find(c => c.document_id === documentId)?.id || null
    return { placed: true, canvasId, historyEntry: outcome.confirmed.historyEntry || null }
  }
  async function refreshGeneratedImport(write) {
    if (write.busy) return { busy: true }
    write.busy = true
    try {
      return generatedImportOutcome(await savePlacedBeside(await retryConfirmedImportRefresh(write.refreshPending, write)), write)
    } finally {
      write.busy = false
      renderChrome(); renderConversationRef(); notifyDraftChange()
    }
  }
  nodes.stage?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return
    event.preventDefault()
    nodes.stage.classList.toggle('is-drop', true)
  })
  nodes.stage?.addEventListener('dragleave', () => {
    nodes.stage.classList.toggle('is-drop', false)
  })
  nodes.stage?.addEventListener('drop', (event) => {
    event.preventDefault()
    nodes.stage.classList.toggle('is-drop', false)
    const files = [...(event.dataTransfer?.files || [])]
    const verdict = classifyCanvasDrop({ hasProject: Boolean(session.project), files })
    if (!verdict.ok) {
      rejectCanvasImport(verdict.reason)
      return
    }
    const host = typeof nodes.stage.getBoundingClientRect === 'function'
      ? nodes.stage.getBoundingClientRect()
      : { left: 0, top: 0 }
    const point = view.screenToWorld(event.clientX, event.clientY, host)
    return importPngFile(verdict.file, point)
  })
  function dismissCanvasSelection() {
    if (session.finishTextDraft?.() === false) return // open text is placed first, as for any other selection change
    session.conversationRef = null
    session.contextDismissed = true
    view.select(null)
    renderConversationRef()
    renderCanvas()
    notifyDraftChange()
  }
  root.querySelector('#vnext-canvas-ref-remove')?.addEventListener('click', () => {
    dismissCanvasSelection()
  })
  root.querySelector('.vnext-ref-clear')?.addEventListener('click', (event) => {
    if (root.querySelector('.vnext-ref-image')?.dataset.canvasSelection !== '1') return
    event.preventDefault?.()
    event.stopPropagation?.()
    dismissCanvasSelection()
  })
  nodes.search?.addEventListener('input', () => {
    session.list.query = nodes.search.value
    renderList()
  })
  nodes.rows?.addEventListener('click', (event) => {
    const id = event.target.closest('[data-project-id]')?.dataset.projectId
    if (!id) return
    session.list.selectedId = id
    renderList()
  })
  nodes.openRoot?.addEventListener('click', async (event) => {
    if (event.target.dataset.dialogDismiss === 'open') {
      dismissOpenDialog()
      return
    }
    const action = event.target.closest('[data-project-action]')?.dataset.projectAction
    if (action === 'refresh') await loadList()
    if (action === 'clear-search') {
      session.list.query = ''
      if (nodes.search) nodes.search.value = ''
      renderList()
    }
    if (action === 'confirm-open') await confirmOpen()
  })
  nodes.confirmPrimary?.addEventListener('click', () => session.confirm?.onPrimary?.())
  nodes.confirmSecondary?.addEventListener('click', () => session.confirm?.onSecondary?.())
  nodes.confirmRoot?.querySelector('.vnext-dialog-scrim')?.addEventListener('click', () => {
    session.confirm?.onSecondary?.()
  })
  root.querySelector('.vnext-preview-body')?.addEventListener('click', locateFromPreview)
  nodes.zoom?.addEventListener('click', () => {
    const box = nodes.stage?.getBoundingClientRect()
    view.fitAll(box?.width || 800, box?.height || 600)
    renderCanvas()
  })
  nodes.move?.addEventListener('click', () => {
    const placing = session.finishTextDraft?.() // an open text draft is placed first; false: it has to stay open
    if (placing === false) return
    if (!placing && (session.manualGesture || session.manualWrite || session.pixelCopyPending)) return
    view.setTool('move') // clicking the active Move tool keeps it; there is no separate hidden mode
    renderChrome()
  })

  let drag = null
  nodes.stage?.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('[data-canvas-name]')) return
    if (event.button !== undefined && event.button !== 0) return // right/middle presses never select or start a drag
    const host = nodes.stage.getBoundingClientRect()
    const hit = view.hitTest(event.clientX, event.clientY, host)
    if (view.spaceDown) {
      drag = { kind: 'pan', x: event.clientX, y: event.clientY }
      nodes.stage.classList.add('is-active')
      try { nodes.stage.setPointerCapture(event.pointerId) } catch { /* synthetic pointer */ }
      return
    }
    if (hit) {
      view.select(hit)
      bindConversationRef(hit)
    } else view.select(null)
    refreshTimeline()
    if (hit && view.tool === 'move') {
      if (concurrentLayoutBlocked(session) || session.pendingSave) {
        setCanvasStatus(session.pendingSave ? 'Finish the current stroke or resolve its save before editing.' : concurrentLayoutMessage(session))
        renderCanvas()
        return
      }
      if (blockPendingHistoryEdit()) {
        renderCanvas()
        return
      }
      const pos = view.positionOf(hit)
      drag = {
        kind: 'move',
        id: hit,
        startX: event.clientX,
        startY: event.clientY,
        origX: pos.x,
        origY: pos.y,
      }
      try { nodes.stage.setPointerCapture(event.pointerId) } catch { /* synthetic pointer */ }
    }
    renderCanvas()
  })
  const movePaint = createFrameCoalescer(() => renderCanvas(), (callback) => {
    const schedule = globalThis.requestAnimationFrame || ((run) => run())
    schedule(callback)
  })
  function paintMotionLayers(hostRect) {
    const world = nodes.stage?.querySelector('.vnext-canvas-world')
    if (!world) return false
    const host = hostRect || nodes.stage?.getBoundingClientRect()
    world.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`
    if (typeof world.style.setProperty === 'function') world.style.setProperty('--vnext-inverse-zoom', String(1 / (view.zoom || 1)))
    if (nodes.zoom) nodes.zoom.textContent = zoomPercentLabel(view.zoom)
    if (nodes.grid) {
      const on = session.pixelGrid !== false
      const waiting = on && view.zoom < VNEXT_PIXEL_GRID_MIN_ZOOM
      nodes.grid.title = waiting ? 'On. Visible at 400% zoom or higher.' : 'Pixel grid'
      if (nodes.gridPending) nodes.gridPending.hidden = !waiting
      if (nodes.pixelGridNote) nodes.pixelGridNote.hidden = !waiting
    }
    for (const storedCanvas of view.canvases) {
      const canvas = session.documentCandidate?.canvas.id === storedCanvas.id ? session.documentCandidate.canvas : storedCanvas
      const pos = view.positionOf(canvas.id)
      if (!pos) continue
      const tile = world.querySelector(`[data-canvas-id="${canvas.id}"]`)
      if (tile) tile.style.transform = `translate(${pos.x}px, ${pos.y}px)`
      const backdrop = world.querySelector(`[data-canvas-backdrop="${canvas.id}"]`)
      if (backdrop) backdrop.style.transform = `translate(${pos.x}px, ${pos.y}px)`
      renderCanvasName(world, canvas, pos)
      renderCanvasFrame(canvas, pos, host)
      renderPixelGrid(canvas, pos, host)
    }
    session.refreshMotionChrome?.()
    renderObjectPreview(host)
    return true
  }
  nodes.stage?.addEventListener('pointermove', (event) => {
    if (!drag) return
    if (drag.kind === 'pan') {
      view.panBy(event.clientX - drag.x, event.clientY - drag.y)
      drag.x = event.clientX
      drag.y = event.clientY
    } else if (drag.kind === 'move') {
      const dx = Math.round((event.clientX - drag.startX) / view.zoom)
      const dy = Math.round((event.clientY - drag.startY) / view.zoom)
      view.moveDraft(drag.id, drag.origX + dx, drag.origY + dy)
    }
    if (!paintMotionLayers()) movePaint.request()
  })
  const finishDrag = (commit) => {
    const gesture = drag
    drag = null
    nodes.stage?.classList.remove('is-active')
    if (commit && gesture?.kind === 'move' && session.project) {
      const end = view.positionOf(gesture.id)
      if (end && (end.x !== gesture.origX || end.y !== gesture.origY)) {
        pushHistory({
          kind: 'move',
          projectId: session.project.id,
          canvasId: gesture.id,
          from: { x: gesture.origX, y: gesture.origY },
          to: { x: end.x, y: end.y },
        })
      }
    }
    renderCanvas()
  }
  nodes.stage?.addEventListener('pointerup', () => finishDrag(true))
  nodes.stage?.addEventListener('pointercancel', () => finishDrag(false))
  nodes.stage?.addEventListener('wheel', (event) => {
    if (editableHost(event.target)) {
      view.resetWheelZoom?.()
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const manualBusy = Boolean(session.frameLoading || session.manualGesture || session.manualWrite || session.pixelCopyPending)
    const textDraftOpen = Boolean(session.textDraftOpen?.())
    if (drag || (manualBusy && !textDraftOpen)) {
      view.resetWheelZoom?.()
      return
    }
    const host = nodes.stage.getBoundingClientRect()
    if (view.wheelZoom(event, host) && !paintMotionLayers(host)) movePaint.request()
  }, { passive: false })

  root.addEventListener('keydown', (event) => {
    const nativeText = nativeTextUndoTarget(event.target)
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key?.toLowerCase() === 'z' && !nativeText && !event.isComposing) {
      event.preventDefault()
      if (!event.repeat) return event.shiftKey ? redoHistory() : undoHistory()
      return
    }
    const inViewSettings = isViewSettingsControl(event.target)
    const nativeSpaceControl = editableHost(event.target) || Boolean(event.target?.closest?.('button, select'))
    if (event.code === 'Space' && !event.repeat && !inViewSettings && !nativeSpaceControl && !isDraftInput(event.target)) {
      event.preventDefault()
      view.setSpaceDown(true)
      renderCanvas()
    }
    // View navigation: + / − step the zoom ladder, 1–6 set 100%–3200%, 0 fits all. Only from the page,
    // the canvas area or the tool rail; text fields and dialogs keep their keys.
    const navKey = /^[-+=_0-6]$/.test(event.key || '')
    const navTarget = navKey && !inViewSettings && (['BODY', 'HTML'].includes(event.target?.tagName) || Boolean(event.target?.closest?.('.vnext-center, .vnext-tools')))
    const typing = navKey && ((typeof event.target?.closest === 'function' && isDraftInput(event.target)) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable)
    if (navTarget && !typing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && nodes.stage) {
      const box = nodes.stage.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2
      const level = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }[event.key]
      let changed = false
      if (event.key === '+' || event.key === '=') { view.zoomAt(cx, cy, 2, box); changed = true }
      else if (event.key === '-' || event.key === '_') { view.zoomAt(cx, cy, 0.5, box); changed = true }
      else if (event.key === '0') { view.fitAll(box.width, box.height); changed = true }
      else if (level) { view.zoomTo(level, cx, cy, box); changed = true }
      if (changed) { event.preventDefault(); renderCanvas(); return }
    }
    if (event.key === 'Escape') {
      if (nodes.viewSettings && nodes.viewSettings.hidden === false) {
        closeViewSettings()
        event.preventDefault()
        event.vnextViewSettingsClosed = true
        event.stopImmediatePropagation?.()
        return
      }
      if ((nodes.openRoot && !nodes.openRoot.hidden) || confirmedOpenInFlight()) dismissOpenDialog()
      closeConfirm()
    }
  })
  root.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' || !view.spaceDown) return
    view.setSpaceDown(false)
    renderCanvas()
  })
  window.addEventListener('beforeunload', (event) => {
    if (shouldProtectLeave({
      dirty: view.isDirty(),
      pendingImport: session.pendingImport || session.manualGesture || session.hasAssistantWork?.(),
      pendingSave: session.pendingSave,
    })) {
      event.preventDefault()
      event.returnValue = ''
    }
  })

  function exportBusy() {
    return Boolean(projectChangeInFlight() || session.frameLoading || session.manualGesture || session.manualWrite
      || session.pixelCopyPending || session.pendingImport || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit)
  }
  function exportContext() {
    const canvas = view.canvases.find(item => item.id === view.selectedId && !item.transient)
    if (!canvas || !session.project || !(canvas.preview || canvas.previewUrl)) return null
    const document = session.documents.get(canvas.document_id)
    const frameId = document && (session.documentTimeline?.target(document)?.frame_id || document.frame_order[0])
    return { canvas, name: canvas.name, canvasId: canvas.id, projectId: session.project.id, document, frameId,
      key: JSON.stringify([session.project.id, canvas.id, api.openEpoch.current, document?.revision, frameId]), busy: exportBusy() }
  }

  session.prepareDocumentEdit = async ({ selectedOnly = false } = {}) => {
    if (session.frameLoading || staticPlacementBlocked() || projectChangeInFlight() || session.pixelCopyPending || session.referencePending?.()) throw new Error('Finish the current edit first.')
    session.documentTimeline?.stop?.()
    const canvasId = selectedOnly ? view.selectedId : session.conversationRef?.canvasId || view.selectedId
    const canvas = view.canvases.find(c => c.id === canvasId)
    const manifest = session.documents.get(session.project?.canvases?.[canvasId]?.document_id)
    if (!canvas || !manifest) throw new Error('Select a canvas to work on its frames and layers.')
    const projectId = session.project.id, projectRevision = session.project.revision, epoch = api.openEpoch.current
    const lockedFrameIds = session.documentTimeline?.lockedFrameIds?.(manifest) || []
    const editableFrameIds = lockedFrameIds.length > 0 ? (session.documentTimeline?.editableFrameIds?.(manifest) || manifest.frame_order.slice()) : null
    const referenceIds = session.activeReferenceIds?.() || []
    const scopeKey = JSON.stringify([editableFrameIds, referenceIds])
    return { projectId, projectRevision, sourceCanvasId: canvasId, sourceDocumentId: manifest.document_id, sourceRevision: manifest.revision,
      width: manifest.canvas.w, height: manifest.canvas.h, manifest, canvas,
      ...(editableFrameIds ? { editableFrameIds, lockedFrameIds } : {}),
      ...(referenceIds.length ? { referenceIds } : {}),
      isSelected: () => {
        if (session.project?.id !== projectId && session.project.revision === projectRevision) return false
        if (session.project?.id !== projectId || session.project.revision !== projectRevision || api.openEpoch.current !== epoch
          || view.selectedId !== canvasId || session.documents.get(manifest.document_id)?.revision !== manifest.revision) return false
        const currentLocked = session.documentTimeline?.lockedFrameIds?.(manifest) || []
        const currentEditable = currentLocked.length > 0 ? (session.documentTimeline?.editableFrameIds?.(manifest) || manifest.frame_order.slice()) : null
        const currentRefs = session.activeReferenceIds?.() || []
        return JSON.stringify([currentEditable, currentRefs]) === scopeKey
      } }
  }
  session.showDocumentCandidate = async (source, value, isValid = () => true) => {
    if (!isValid() || !source.isSelected() || staticPlacementBlocked()) throw new Error('The source changed before preview.')
    const manifest = value.document, blocks = new Map()
    if (!manifest || manifest.document_id !== source.sourceDocumentId || value.sha256 !== await sha256Hex(new TextEncoder().encode(JSON.stringify(manifest)))) throw new Error('Candidate identity could not be verified.')
    let total = 0
    for (const [hash, encoded] of Object.entries(value.blocks || {})) {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); total += bytes.length
      if (total > (value.processing ? 32 : 16) * 1024 * 1024 || await sha256Hex(bytes) !== hash) throw new Error('Candidate pixels could not be verified.')
      blocks.set(hash, bytes)
    }
    const candidateApi = { getBlock: async (_p, _d, hash) => ({ bytes: blocks.get(hash), width: manifest.canvas.w, height: manifest.canvas.h, sha256: hash }) }
    const compose = async (frame, sourceOverride) => {
      const showSource = sourceOverride ?? (session.documentCandidate?.id === value.candidate_id && session.documentCandidate.showSource)
      const m = showSource ? source.manifest : manifest
      return rgbaBytesToCanvas(await readCompositeFrame(showSource ? api : candidateApi, source.projectId, m, frame), m.canvas.w, m.canvas.h)
    }
    const preview = await compose(manifest.frame_order[0])
    if (!isValid() || !source.isSelected() || staticPlacementBlocked()) throw new Error('The source changed before preview.')
    const guard = { kind: 'document-candidate', projectId: source.projectId }
    session.documentTimeline?.stop?.()
    session.documentCandidate = { id: value.candidate_id, source, manifest, compose, phase: 'review', guard, processing: value.processing || null, showSource: false,
      canvas: { ...source.canvas, width: manifest.canvas.w, height: manifest.canvas.h, preview, previewUrl: null, name: `${source.canvas.name || manifest.name} · Unsaved preview` } }
    session.manualWrite = guard
    session.pixelSelection = null
    renderCanvas(); notifyDraftChange()
  }
  session.compareDocumentCandidate = async showSource => {
    const c = session.documentCandidate
    if (!c || !c.processing || c.running || c.phase !== 'review') return
    session.documentTimeline?.stop?.()
    const sequence = c.compareSequence = (c.compareSequence || 0) + 1
    const m = showSource ? c.source.manifest : c.manifest
    const frame = session.documentTimeline?.target(c.manifest)?.frame_id || c.manifest.frame_order[0]
    c.phase = 'comparing'; renderCanvas()
    try {
      const preview = await c.compose(frame, showSource)
      if (session.documentCandidate !== c || c.compareSequence !== sequence
        || (session.documentTimeline?.target(c.manifest)?.frame_id || c.manifest.frame_order[0]) !== frame) return
      c.showSource = showSource
      c.canvas = { ...c.canvas, width: m.canvas.w, height: m.canvas.h, preview, name: `${c.source.canvas.name || m.name} · ${showSource ? 'Source' : 'Unsaved preview'}` }
    } finally { if (session.documentCandidate === c) { c.phase = 'review'; renderCanvas() } }
  }
  session.clearDocumentCandidate = () => {
    const c = session.documentCandidate
    session.documentTimeline?.stop?.()
    if (session.manualWrite === c?.guard || session.manualWrite === c?.write) session.manualWrite = null
    session.documentCandidate = null
    renderCanvas(); notifyDraftChange()
  }
  session.saveDocumentCandidate = async (source, save) => {
    const c = session.documentCandidate
    if (!c || c.source !== source || c.running || (!c.result && !source.isSelected())) throw new Error('Candidate context changed.')
    c.write ||= rememberWrite('document-candidate', source.projectId, { openToken: api.openEpoch.current })
    const write = c.write, live = () => writeStillCurrent(write)
    session.documentTimeline?.stop?.(); c.phase = 'saving'; c.running = true; write.running = true; session.manualWrite = write; renderCanvas()
    try {
      if (!c.result) {
        const response = await save()
        if (!response?.receipt || response.receipt.project_id !== source.projectId || response.receipt.document_revision !== response.document?.revision
          || response.project?.revision !== response.receipt.project_revision) throw new Error('Save response could not be verified; resolve the same save.')
        c.result = response
      }
      const result = c.result
      if (!live()) throw new Error('Saved in the original project. Reopen it to see the result.')
      const derived = result.document.document_id !== source.sourceDocumentId
      if (!c.recorded) {
        invalidateChangedPixelHistory(source.sourceDocumentId, source.sourceRevision)
        historyForProject().pixelHeads.set(result.document.document_id, result.document.revision)
        pushHistory(derived ? { kind: 'import', projectId: source.projectId, canvasId: result.canvas.id, documentId: result.document.document_id, manualPixels: true, to: { x: result.canvas.x, y: result.canvas.y } }
          : { kind: 'pixels', structure: true, projectId: source.projectId, canvasId: source.sourceCanvasId, documentId: source.sourceDocumentId, beforeRevision: source.sourceRevision, afterRevision: result.document.revision })
        c.recorded = true
      }
      const latest = await api.getProject(source.projectId, { token: api.openEpoch.current })
      if (!latest.ok || latest.stale || !live()) throw new Error('Saved. Reload the document to finish refreshing.')
      const applied = await applyProject(latest.project, { preserveView: true, write })
      if (applied.stale || !live()) throw new Error('Saved in the original project. Reopen it to see the result.')
      session.documentCandidate = null
      if (session.manualWrite === write) session.manualWrite = null
      const consumed = session.consumedConversationRef === session.conversationRef
      view.select(result.canvas?.id || source.sourceCanvasId); bindConversationRef(view.selectedId, { consumed })
      renderCanvas(); notifyDraftChange()
      return result
    } catch (error) { c.phase = 'recovery'; renderCanvas(); throw error }
    finally { c.running = false; write.running = false }
  }

  // Selection edits skip the drawing read grant; their exact write still uses a scoped write grant.
  session.preparePixelEdit = async ({ scopeGrant = true, includeTextPreview = false, allowedOperations = null } = {}) => {
    if (session.frameLoading) throw new Error('Wait for the selected frame to finish loading.')
    if (projectChangeInFlight()) throw Object.assign(new Error('Wait for the project to finish opening.'), { code: 'pixel_busy' })
    session.documentTimeline?.stop?.()
    if (session.manualGesture || session.manualWrite || session.pendingImport || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit) {
      throw Object.assign(new Error('Finish the current edit before sending an image request.'), { code: 'pixel_busy' })
    }
    const owner = session.project, epoch = api.openEpoch.current, activity = session.activity
    const canvasId = session.conversationRef?.canvasId
    const manifest = session.documents.get(owner?.canvases?.[canvasId]?.document_id)
    const target = session.documentTimeline?.target(manifest)
    const source = pixelCopySource(owner, canvasId, session.documents, target)
    const selection = session.pixelSelection
    if (selection?.projectId === owner.id && selection.canvasId === canvasId) source.allowedRect = { ...selection.rect }
    source.isCurrent = () => session.project?.id === owner.id && api.openEpoch.isCurrent(epoch)
      && session.activity === activity
    source.isSelected = () => source.isCurrent() && session.project.revision === source.projectRevision
      && session.conversationRef?.canvasId === canvasId && session.pixelSelection === selection
      && (!target || session.documentTimeline?.target(manifest)?.cel_id === target.cel_id)
    const block = source.sha256 ? await api.getBlock(source.projectId, source.sourceDocumentId, source.sha256)
      : { bytes: new Uint8Array(source.width * source.height * 4), width: source.width, height: source.height, sha256: null }
    if (!source.isSelected()) throw Object.assign(new Error('The selected image changed. Send again for the current selection.'), { code: 'assistant_context_changed' })
    if (!(block.bytes instanceof Uint8Array) || block.width !== source.width || block.height !== source.height
      || block.sha256 !== source.sha256 || (source.sha256 && await sha256Hex(block.bytes) !== source.sha256)) {
      throw Object.assign(new Error('The source image could not be verified. No new image was created.'), { code: 'pixel_source_invalid' })
    }
    if (!source.isSelected()) throw Object.assign(new Error('The selected image changed.'), { code: 'assistant_context_changed' })
    source.rgba = block.bytes.slice()
    const hasFrameText = includeTextPreview && manifest.text_objects?.items?.some(item => item.frame_id === source.target.frame_id)
    const hasLayerText = Boolean(manifest.text_objects?.items?.some(
      item => item.frame_id === source.target.frame_id && item.layer_id === source.target.layer_id,
    ))
    let paintText = null
    const familyFor = item => session.resolveTextFont?.(item) || (item.font.kind === 'generic' ? item.font.name : null)
    const needsPreview = Boolean(source.multiCel || hasFrameText || manifest.layers?.[manifest.layer_order[0]]?.visible === false)
    if (needsPreview || hasLayerText) {
      const { paintLayerText } = await import('./vnext-text-objects.js')
      paintText = paintLayerText
    }
    if (needsPreview) {
      const blocks = new Map([[source.target.cel_id, source.rgba]])
      for (const cel of Object.values(manifest.cels)) {
        if (cel.frame_id !== source.target.frame_id || cel.id === source.target.cel_id || !manifest.layers[cel.layer_id].visible || !cel.block) continue
        const other = await api.getBlock(owner.id, manifest.document_id, cel.block.sha256)
        if (other.width !== source.width || other.height !== source.height || other.sha256 !== cel.block.sha256 || await sha256Hex(other.bytes) !== cel.block.sha256) throw new Error('A preview layer could not be verified.')
        blocks.set(cel.id, new Uint8Array(other.bytes))
      }
      if (!source.isSelected()) throw new Error('The selected layer or frame changed.')
      source.previewPixels = (pixels, { textObject = null } = {}) => {
        let previewManifest = manifest
        if (textObject) {
          const items = manifest.text_objects?.items || []
          previewManifest = { ...manifest, text_objects: { version: 1, items: items.some(item => item.id === textObject.id)
            ? items.map(item => item.id === textObject.id ? textObject : item) : [...items, textObject] } }
        }
        // Empty/in-progress text is a preview, not a persisted manifest to validate.
        return compositePixelBuffers(manifest, source.target.frame_id, new Map(blocks).set(source.target.cel_id, pixels),
          includeTextPreview ? (rgba, layerId) => paintText(rgba, previewManifest, source.target.frame_id, layerId, familyFor) : null)
      }
    }
    source.sampleRgba = (mode = 'composite') => {
      if (mode === 'layer') {
        if (paintText && hasLayerText) {
          const layerVisibleManifest = manifest.layers?.[source.target?.layer_id]?.visible === false
            ? {
              ...manifest,
              layers: {
                ...manifest.layers,
                [source.target.layer_id]: { ...manifest.layers[source.target.layer_id], visible: true },
              },
            }
            : manifest
          return paintText(source.rgba.slice(), layerVisibleManifest, source.target.frame_id, source.target.layer_id, familyFor)
        }
        return source.rgba
      }
      if (typeof source.previewPixels === 'function') return source.previewPixels(source.rgba)
      if (manifest.layers?.[source.target?.layer_id]?.visible === false) return new Uint8Array(source.width * source.height * 4)
      return source.rgba
    }
    if (scopeGrant && (source.allowedRect || source.multiCel || source.linkScope)) {
      const grant = await api.createScopeGrant(source.projectId, source.sourceDocumentId, { operation_id: createOperationId(),
        expected_revision: source.projectRevision, expected_working_revision: source.sourceRevision, ...source.target,
        rect: source.allowedRect || { x: 0, y: 0, w: source.width, h: source.height },
        allowed_operations: Array.isArray(allowedOperations) && allowedOperations.length
          ? allowedOperations
          : ['replace-color', 'fill-rect', 'erase', 'pencil', 'eraser', 'line', 'rectangle', 'flood-fill', 'text'],
        ...(source.linkScope ? { link_scope: source.linkScope } : {}) })
      if (!source.isSelected() || !grant?.grant_id) throw new Error('The selected area changed. Select it again.')
      source.grantId = grant.grant_id
    }
    return source
  }

  session.openConfirm = openConfirm
  session.closeConfirm = closeConfirm

  function staticPlacementBlocked() {
    return Boolean(session.manualGesture || session.manualWrite || session.pendingImport || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit)
  }

  function recordStaticImport(write) {
    if (write.historyRecorded || !writeStillCurrent(write)) return
    write.historyEntry = rememberSuccessfulImport(write.imported, write)
    write.historyRecorded = Boolean(write.historyEntry)
  }

  async function saveStaticPosition(write) {
    if (!writeStillCurrent(write)) return { abandoned: true }
    const canvasId = write.positions?.[0]?.canvas_id
    const point = write.dropPoint
    try {
      const saved = await api.saveLayout(write.projectId, write.positionRequest)
      if (!writeStillCurrent(write)) return { abandoned: true }
      if (!saved?.receipt) {
        write.hold = true
        openStaticPositionRetry(write)
        return { canvasId, point, positionFailed: true }
      }
      session.project = saved.project
      if (!session.layoutRevisionPinned) session.layoutBaseRevision = saved.project?.revision
      view.applySavedPositions(write.positions)
      write.stage = 'done'
      // The Undo entry this placement recorded, so a result completed later (after a position
      // retry or a resolved drawing save) still binds its Undo to this exact canvas addition.
      write.result = { canvasId, point, historyEntry: write.historyEntry || null }
      releaseStaticWrite(write)
      renderCanvas()
      setCanvasStatus('')
      return write.result
    } catch (error) {
      if (!writeStillCurrent(write)) return { abandoned: true }
      noteSessionError(error)
      write.hold = error.kind === 'unknown'
      openStaticPositionRetry(write)
      return { canvasId, point, positionFailed: true, positionUnknown: error.kind === 'unknown' }
    }
  }

  function openStaticPositionRetry(write) {
    write.stage = 'position'
    setCanvasStatus(write.hold
      ? 'Image added. Position result is unknown. Resolve the same save before editing.'
      : 'Image added. Position was not saved. Undo removes this new image.')
    openConfirm({
      title: 'Position was not saved',
      body: 'Retry saves only this new image position. It does not import or generate again.',
      primary: 'Save position',
      secondary: VNEXT_PROJECT_COPY.dismiss,
      onPrimary: () => retryStaticWriteFromDialog(write),
      onSecondary: () => closeConfirm(),
    })
  }

  // A dialog Retry that finishes a pixel drawing's save reports it, so the run that drew it is
  // completed with its Undo (see session.onPixelDrawingResolved); nothing is sent again.
  async function retryStaticWriteFromDialog(write) {
    const result = await resumeStaticWrite(write)
    if (write.pixelDrawing && result?.canvasId && !result.positionFailed && !result.positionUnknown) session.onPixelDrawingResolved?.(write.projectId, result)
    return result
  }

  function releaseStaticWrite(write) {
    write.hold = false
    if (session.pendingImport === write) session.pendingImport = false
    renderChrome()
  }

  function openStaticReload(write) {
    write.stage = 'reload'
    write.hold = true
    setCanvasStatus(IMPORT_RELOAD_COPY.status)
    openConfirm({
      title: IMPORT_RELOAD_COPY.title,
      body: 'Reload only fetches the saved canvas. It does not import or generate again.',
      primary: IMPORT_RELOAD_COPY.primary,
      secondary: VNEXT_PROJECT_COPY.dismiss,
      onPrimary: () => retryStaticWriteFromDialog(write),
      onSecondary: () => closeConfirm(),
    })
  }

  async function placeAndSaveStatic(write) {
    if (!writeStillCurrent(write) || !write.imported) return { abandoned: true }
    const documentId = write.imported.document?.document_id || write.imported.receipt?.document_id || ''
    const canvas = canvasForImport({
      beforeIds: write.canvasIds || [],
      project: session.project,
      documentId,
    })
    if (!canvas) {
      openStaticReload(write)
      return { refreshFailed: true }
    }
    const placed = view.canvases.find((item) => item.id === canvas.id)
    let point = { x: canvas.x ?? 0, y: canvas.y ?? 0 }
    try {
      point = staticImagePosition(view, write.anchor, {
        canvasId: canvas.id,
        width: placed?.width || canvas.width || 64,
        height: placed?.height || canvas.height || 64,
      })
    } catch {
      point = { x: canvas.x ?? 0, y: canvas.y ?? 0 }
    }
    if (write.dropPoint) point = write.dropPoint
    write.dropPoint = point
    recordStaticImport(write)
    view.moveDraft(canvas.id, point.x, point.y)
    write.positions = [{ canvas_id: canvas.id, x: point.x, y: point.y }]
    if (!write.positionRequest) {
      write.positionRequest = {
        operationId: createOperationId(),
        expectedRevision: session.project.revision,
        positions: write.positions,
      }
    }
    return saveStaticPosition(write)
  }

  async function finishStaticPlacement(imported, write) {
    if (!writeStillCurrent(write)) return { abandoned: true }
    if (!imported?.receipt && !imported?.alreadyImported) return { unknown: true }
    write.imported = imported
    try {
      await applyProject(imported.project, { preserveView: true, write })
    } catch (error) {
      if (!writeStillCurrent(write)) return { abandoned: true }
      noteSessionError(error)
      openStaticReload(write)
      return { refreshFailed: true }
    }
    if (!writeStillCurrent(write)) return { abandoned: true }
    if (imported.alreadyImported) {
      write.stage = 'done'
      write.result = { alreadyImported: true }
      setCanvasStatus('This image was already saved. Its position and Undo history were not changed.')
      return write.result
    }
    return placeAndSaveStatic(write)
  }

  function openStaticImportUnknown(write) {
    write.stage = 'import'
    write.hold = true
    setCanvasStatus('Import result is unknown. Retry uses the same request.')
    openConfirm({
      title: VNEXT_PROJECT_COPY.unknownTitle,
      body: 'The import result is unknown. Retry uses the same request. It does not generate or import a second image.',
      primary: VNEXT_PROJECT_COPY.retry,
      secondary: VNEXT_PROJECT_COPY.dismiss,
      onPrimary: () => retryStaticWriteFromDialog(write),
      onSecondary: () => closeConfirm(),
    })
  }

  // Keep only this local write, including its exact requests, after a dialog is closed.
  // Recovery never uses the client's global last-unknown slot or imports a second canvas.
  async function resumeStaticWrite(write) {
    if (!writeStillCurrent(write)) return { abandoned: true }
    if (write.stage === 'done') return write.result
    if (write.busy || (session.pendingImport && session.pendingImport !== write)
      || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit) return { busy: true }
    // Never submitted yet: a new import, so it waits for the project change; recovery of a submitted save does not.
    if (!write.submitted && projectChangeInFlight()) return { busy: true, waiting: true }
    const canvasId = write.positions?.[0]?.canvas_id
    if (canvasId && !session.project.canvases?.[canvasId]) {
      releaseStaticWrite(write)
      return { abandoned: true }
    }
    write.busy = true
    write.hold = false
    session.pendingImport = write
    closeConfirm()
    try {
      let result
      if (write.stage === 'position') result = await saveStaticPosition(write)
      else {
        if (!write.imported) {
          if (!write.submitted) { // never sent (kept during a project change): it is a new import at the current revision
            write.expectedRevision = write.importRequest.expectedRevision = session.project.revision
            write.canvasIds = Object.keys(session.project.canvases || {})
          }
          write.submitted = true
          // From this point recovery belongs to this exact operation, not a fresh candidate save.
          if (pixelDrawingCandidates.get(write.projectId) === write.pixelDrawingCandidate) pixelDrawingCandidates.delete(write.projectId)
          const imported = write.nativeImageJobId
            ? await api.importGeneratedImage(write.projectId, write.nativeImageJobId, write.importRequest)
            : await api.importPng(write.projectId, write.importRequest)
          if (!writeStillCurrent(write)) return { abandoned: true }
          if (!imported?.receipt && !imported?.alreadyImported) {
            openStaticImportUnknown(write)
            return { unknown: true }
          }
          write.imported = imported
        }
        result = await finishStaticPlacement(write.imported, write)
      }
      return result
    } catch (error) {
      if (!writeStillCurrent(write)) return { abandoned: true }
      noteSessionError(error)
      if (error.kind === 'unknown' && !write.imported) {
        openStaticImportUnknown(write)
        return { unknown: true }
      }
      throw error
    } finally {
      write.busy = false
      if (!write.hold || !writeStillCurrent(write)) releaseStaticWrite(write)
    }
  }

  // Completed, never-submitted drawings survive project changes in this tab. They are not write locks
  // or recovery requests: returning to the owner offers an explicit new save at its current revision.
  const pixelDrawingCandidates = new Map()
  const parkedStaticWrites = new Map()
  session.retainPixelDrawing = ({ bytes, projectId, anchor = null, name = 'Pixel drawing' }) => {
    const candidate = { bytes, projectId, anchor, name }
    pixelDrawingCandidates.set(projectId, candidate)
    return candidate
  }
  const currentPixelDrawingWrite = () => session.staticImageWrite?.pixelDrawing
    && !['done', 'abandoned'].includes(session.staticImageWrite.stage) && writeStillCurrent(session.staticImageWrite)
      ? session.staticImageWrite : null
  session.hasPixelDrawingSave = () => Boolean(currentPixelDrawingWrite() || pixelDrawingCandidates.has(session.project?.id))
  session.resolvePixelDrawingSave = async () => {
    if (!session.hasPixelDrawingSave()) return { abandoned: true }
    const write = currentPixelDrawingWrite()
    if (!write) {
      if (projectChangeInFlight()) return { busy: true, waiting: true }
      const candidate = pixelDrawingCandidates.get(session.project.id)
      return session.placeStaticImage({ ...candidate, openEpoch: api.openEpoch.current, pixelDrawing: true, pixelDrawingCandidate: candidate })
    }
    const result = await resumeStaticWrite(write)
    if (result?.abandoned) write.stage = 'abandoned'
    return result
  }
  session.canPlacePixelDrawing = () => !staticPlacementBlocked() && !projectChangeInFlight() && !session.hasPixelDrawingSave()
  // The assistant may resume a submitted image save during a project change; a not-yet-submitted one waits.
  // Both image writers count: the placement writer and the direct generated-image import.
  const imageWrites = () => [session.staticImageWrite, generatedImport].filter(write => write && !['done', 'abandoned'].includes(write.stage))
  session.imageSaveFor = jobId => Boolean(jobId) && imageWrites().some(write => write.sourceJobId === jobId)
  session.imageSaveCurrentFor = jobId => Boolean(jobId) && imageWrites().some(write => write.sourceJobId === jobId && writeStillCurrent(write))
  session.imageSaveRecoverable = () => imageWrites().some(write => write.submitted && writeStillCurrent(write))
  session.placeStaticImage = async ({ bytes, projectId, openEpoch, sourceJobId = null, nativeImageJobId = null, anchor = null, name = 'Generated image', pixelDrawing = false, pixelDrawingCandidate = null } = {}) => {
    const candidate = pixelDrawing ? pixelDrawingCandidate || session.retainPixelDrawing({ bytes, projectId, anchor, name }) : null
    if (session.project?.id !== projectId || !api.openEpoch.isCurrent(openEpoch)) return { abandoned: true }
    const previous = session.staticImageWrite
    if (sourceJobId && previous?.sourceJobId === sourceJobId && writeStillCurrent(previous)) return resumeStaticWrite(previous)
    if (staticPlacementBlocked()) return { busy: true }
    // During a project change nothing new is written: keep the finished image as a prepared, unsubmitted save.
    const deferred = projectChangeInFlight()
    const expectedRevision = session.project.revision
    const write = rememberWrite('import', projectId, {
      openToken: openEpoch,
      canvasIds: Object.keys(session.project.canvases || {}),
    })
    write.anchor = anchor
    write.pixelDrawing = pixelDrawing
    write.pixelDrawingCandidate = candidate
    write.sourceJobId = sourceJobId
    write.nativeImageJobId = nativeImageJobId
    write.stage = 'import'
    write.busy = true
    session.staticImageWrite = write
    write.expectedRevision = expectedRevision
    if (!deferred) session.pendingImport = write
    try {
      const digest = await sha256Hex(bytes)
      if (!writeStillCurrent(write)) { write.stage = 'abandoned'; return { abandoned: true } } // never prepared: nothing to resume
      write.importRequest = {
        operationId: createOperationId(),
        expectedRevision,
        expectedSha256: digest,
        name,
        bytes,
      }
      write.busy = false
      if (deferred) return { deferred: true }
      return await resumeStaticWrite(write)
    } finally {
      write.busy = false
      if (session.pendingImport === write && !write.hold) session.pendingImport = false
      renderChrome()
    }
  }
  session.prepareBlankPixelDrawing = async size => {
    const source = await session.preparePixelEdit({ scopeGrant: false })
    if (!isEmptyNativeDrawingTarget(session.documents.get(source.sourceDocumentId), source, size)) {
      throw Object.assign(new Error('Select an empty native 32×32 or 64×64 canvas of the requested size, without a region selection. Nothing was drawn.'), { code: 'pixel_source_unsupported' })
    }
    return source
  }
  // The user's drawing request is the permission: the drawing is written directly to the
  // still-empty selected canvas with the usual revision checks, and Undo restores it.
  session.saveBlankPixelDrawing = async (source, rgba) => {
    const valid = () => source.isSelected() && !projectChangeInFlight()
      && isEmptyNativeDrawingTarget(session.documents.get(source.sourceDocumentId), source, source.width)
    if (!valid() || !(rgba instanceof Uint8Array) || rgba.length !== source.rgba.length) {
      throw Object.assign(new Error('The selected blank canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
    }
    return session.savePixelStroke(source, rgba, { allowBlank: true })
  }
  // Latest Undo entry, so a completed AI result can offer an optional Undo that never reverts a later edit.
  session.latestUndoEntry = () => historyForProject()?.undo?.at(-1) || null
  // Where a result's Undo entry is now: still undoable ('undo'), already undone with ⌘Z/Ctrl+Z
  // ('redo'), or no longer in this project's history ('absent', e.g. after the history was replaced).
  session.undoEntryState = entry => {
    const history = historyForProject()
    if (!entry || !history) return 'absent'
    if (history.undo.includes(entry)) return 'undo'
    if (history.redo.includes(entry)) return 'redo'
    return 'absent'
  }
  // A canvas another writer added (a preset sheet placed from its job) records its Undo here once
  // the shown project contains it: Undo detaches exactly that canvas. Replays return the same entry.
  // `jobId` is the job a preset sheet came from, so its card can find the canvas again after a reload.
  session.recordCanvasAddition = ({ projectId, canvasId, jobId = null } = {}) => {
    const stored = session.project?.id === projectId ? session.project.canvases?.[canvasId] : null
    if (!stored) return null
    const entry = recordCanvasAdditionEntry(projectId, canvasId, stored.document_id || '', { x: stored.x ?? 0, y: stored.y ?? 0 })
    if (entry) entry.placement = { jobId: entry.placement?.jobId || jobId || null }
    return entry
  }
  // A canvas a requested result added (a generated image, a preset or subscription sheet) keeps the
  // place the request chose: the given point, or beside the canvas it would otherwise cover at the
  // stored origin. Only that canvas's position is saved, with the existing canvas-layout command;
  // no other canvas or unsaved draft is touched. A failure keeps the draft and says so; no retry.
  // `origin` is where the canvas's own add stored it: a canvas a later save moved away from there keeps
  // that newer layout and is not moved again (a late completion never overrides the user's placement).
  // Automatic arrangement (no requested point, as in a sheet's recovery) keeps an unsaved position of
  // that canvas the same way (the user moved it but has not saved): it is neither replaced nor saved;
  // Save canvas positions keeps it as usual. A requested point comes from the import that just drafted
  // the canvas itself.
  async function placeAddedCanvas({ projectId, canvasId, point = null, origin = null } = {}) {
    const epoch = api.openEpoch.current
    // The canvas's own project is still the one shown (another open may have started and failed).
    const shown = () => session.project?.id === projectId && !projectChangeInFlight()
    const here = () => shown() && api.openEpoch.isCurrent(epoch)
    // A draft already moved beside the others is never left without saying it is unsaved.
    const notSaved = unknown => {
      if (shown() && view.drafts?.[canvasId]) setCanvasStatus(unknown
        ? 'Placed beside the existing canvases; saving its position was not confirmed. Save canvas positions to keep it there.'
        : 'Placed beside the existing canvases, but the position was not saved. Save canvas positions to keep it there.')
    }
    if (!here()) { notSaved(false); return { unchanged: true } }
    // Another write or gesture is in progress: the canvas still moves beside the others as a draft
    // (never left covering them), its position is not saved now, and the status says so.
    const blocked = staticPlacementBlocked()
    const rendered = view.canvases.find(item => item.id === canvasId && !item.transient)
    const stored = session.project.canvases?.[canvasId]
    if (!rendered || !stored) return { unchanged: true }
    if (origin && ((stored.x ?? 0) !== (origin.x ?? 0) || (stored.y ?? 0) !== (origin.y ?? 0))) return { unchanged: true, movedSinceAdd: true }
    const draft = view.drafts?.[canvasId]
    if (!point && draft && (draft.x !== (stored.x ?? 0) || draft.y !== (stored.y ?? 0))) return { unchanged: true, draftKept: true }
    let target = point
    if (!target) {
      const at = view.positionOf(canvasId)
      const covered = view.canvases.some(other => other.id !== canvasId && !other.transient && (() => {
        const o = view.positionOf(other.id)
        return at.x < o.x + other.width && at.x + rendered.width > o.x && at.y < o.y + other.height && at.y + rendered.height > o.y
      })())
      if (!covered) return { unchanged: true }
      try { target = staticImagePosition(view, null, { canvasId, width: rendered.width, height: rendered.height }) } catch { return { unchanged: true } }
    }
    view.moveDraft(canvasId, target.x, target.y)
    const entry = historyForProject()?.undo?.find(item => item.kind === 'import' && item.projectId === projectId && item.canvasId === canvasId)
    if (entry) entry.to = { x: target.x, y: target.y }
    if (blocked) { notSaved(false); renderCanvas(); return { positionFailed: true, deferred: true, point: target } }
    const positions = [{ canvas_id: canvasId, x: target.x, y: target.y }]
    // Like saveStaticPosition: the import lock is held while this one position is written, so Save
    // positions, Undo/Redo, a rename, an open or another import cannot race the same revision.
    const lock = { kind: 'placed-canvas-position', projectId, canvasId }
    session.pendingImport = lock
    renderChrome()
    try {
      const saved = await api.saveLayout(projectId, { operationId: createOperationId(), expectedRevision: session.project.revision, positions })
      if (!shown()) return { abandoned: true }
      if (!saved?.receipt) throw Object.assign(new Error('Position was not saved.'), { kind: 'unknown' })
      // Never moves the shown project back to an older revision.
      adoptSavedProject(session, saved.project)
      if (!session.layoutRevisionPinned) session.layoutBaseRevision = session.project?.revision
      view.applySavedPositions(positions)
      renderCanvas()
      return { saved: true, point: target }
    } catch (error) {
      if (!shown()) return { abandoned: true }
      noteSessionError(error)
      notSaved(error?.kind === 'unknown')
      renderCanvas()
      return { positionFailed: true, positionUnknown: error?.kind === 'unknown', point: target }
    } finally {
      if (session.pendingImport === lock) session.pendingImport = false
      renderChrome()
    }
  }
  session.placeAddedCanvas = placeAddedCanvas
  // Whether a canvas write is being sent right now (its new revision is not shown yet). A result's own
  // write (a preset sheet's first add) reads the shown revision only once none is; a write started
  // after it is sent meets the existing conflict handling. Unresolved states that wait for the user
  // (a preview awaiting Apply, an unconfirmed Undo or copy) are not counted: they never end on their own.
  session.canvasWriteInFlight = () => Boolean(session.pendingSave || session.historyBusy || session.pendingImport
    || session.manualWrite?.running || session.nameEdit?.committing || session.blankSubmitting)
  session.undoIfLatest = async entry => {
    if (!entry || session.historyBusy || historyForProject()?.undo?.at(-1) !== entry) return false
    await undoHistory()
    return historyForProject()?.undo?.at(-1) !== entry
  }
  // Redo of exactly one undone result (for example a sheet's canvas removed by its Undo), only while
  // it is the newest undone change: the existing Redo step restores that same canvas.
  session.latestRedoEntry = () => historyForProject()?.redo?.at(-1) || null
  session.redoIfLatest = async entry => {
    if (!entry || session.historyBusy || historyForProject()?.redo?.at(-1) !== entry) return false
    await redoHistory()
    return historyForProject()?.redo?.at(-1) !== entry
  }
  // After a page reload the history is empty, so a result's canvas that this page's own Undo removed
  // has no Redo. Its record (kept when that Undo was sent) names exactly that canvas and detach, and
  // the existing canvas restore puts the same canvas back: nothing is added, processed or generated,
  // no other canvas changes, and the server checks the detach receipt. The restored canvas becomes
  // the newest Undo entry, so the next Undo removes exactly it. Offered only while no history entry
  // of this page holds that canvas (Undo / Redo own it then).
  session.undonePlacementFor = ({ projectId, jobId = null, documentId = null } = {}) => {
    if (session.project?.id !== projectId) return null
    const record = session.undonePlacements?.find({ project: session.project, jobId, documentId }) || null
    const history = historyForProject()
    const inHistory = record && [...(history?.undo || []), ...(history?.redo || [])]
      .some(entry => entry.kind === 'import' && entry.projectId === projectId && entry.canvasId === record.canvasId)
    return record && !inHistory ? record : null
  }
  const restoreRequests = new Map()
  session.restoreUndonePlacement = async ({ projectId, jobId = null, documentId = null } = {}) => {
    const record = session.undonePlacementFor({ projectId, jobId, documentId })
    if (!record) return { outcome: 'unavailable' }
    if (projectChangeInFlight() || staticPlacementBlocked() || session.pixelCopyPending || drag?.kind === 'move') return { outcome: 'retry' }
    const epoch = api.openEpoch.current
    const key = `${projectId}|${record.canvasId}|${record.detachOperationId}`
    // An unconfirmed restore keeps its record and is resent exactly as it was (the server replays a
    // committed receipt). The lock is not kept meanwhile, so no other canvas write waits on it; if a
    // later read already shows the canvas, it is back without an Undo entry (as after a reload).
    const request = restoreRequests.get(key) || { operationId: createOperationId(), expectedRevision: session.project.revision }
    restoreRequests.set(key, request)
    // Like a placement's position save: the import lock keeps other writes off this revision meanwhile.
    const lock = { kind: 'restore-undone-placement', projectId, canvasId: record.canvasId }
    session.pendingImport = lock
    renderChrome()
    try {
      let result
      try {
        result = await api.restoreCanvas(projectId, record.canvasId, { ...request, detachOperationId: record.detachOperationId })
      } catch (error) {
        if (error?.kind === 'unknown') return { outcome: 'unknown' }
        restoreRequests.delete(key)
        if (error?.kind === 'stale') {
          // Another change landed first: nothing was put back; the newest project is shown when it can be read.
          try {
            const loaded = await api.getProject(projectId, { token: epoch })
            if (loaded?.ok && !loaded.stale && !loaded.aborted && loaded.project?.id === projectId) await applyHistoryProject(projectId, epoch, loaded.project)
          } catch (readError) { noteSessionError(readError) }
          return { outcome: 'changed' }
        }
        // Refused (the canvas is back already, or the receipt or document is gone): the record ends,
        // except at the canvas limit, where removing another canvas makes room.
        if (error?.code !== 'resource_limit') session.undonePlacements?.forget(record)
        return { outcome: 'refused', limit: error?.code === 'resource_limit' }
      }
      if (!result?.receipt) return { outcome: 'unknown' }
      restoreRequests.delete(key)
      session.undonePlacements?.forget(record)
      // Confirmed: a failed read of the restored project only means this view did not reload.
      let shown = false
      try { shown = await applyHistoryProject(projectId, epoch, result.project) } catch (readError) { noteSessionError(readError) }
      if (!shown) return { outcome: 'restored', shown: false }
      const stored = session.project.canvases?.[record.canvasId]
      const entry = stored ? recordCanvasAdditionEntry(projectId, record.canvasId, record.documentId, { x: stored.x ?? 0, y: stored.y ?? 0 }) : null
      if (entry) entry.placement = { jobId: record.jobId }
      renderCanvas()
      notifyDraftChange()
      return { outcome: 'restored', shown: true, canvasId: record.canvasId, entry }
    } finally {
      if (session.pendingImport === lock) session.pendingImport = false
      renderChrome()
    }
  }
  // In-app results the user asked for are applied directly and report a typed outcome; only an
  // external (Aseprite / MCP) return keeps its review, because no request in this app produced it.
  session.reviewNativePixelCandidate = async (source, rgba, candidate, { external = false, checkCurrent = async () => {}, saveOperationId = null, renderRecovery = null } = {}) => {
    const scopeRect = candidate?.allowed_rect || source.allowedRect || null
    const isSubRect = Boolean(scopeRect && (scopeRect.x !== 0 || scopeRect.y !== 0 || scopeRect.w !== 64 || scopeRect.h !== 64))
    if (!source.isSelected() || projectChangeInFlight() || staticPlacementBlocked() || session.pixelCopyPending
      || !(rgba instanceof Uint8Array) || rgba.length !== 64 * 64 * 4 || source.width !== 64 || source.height !== 64
      || await sha256Hex(source.rgba) !== candidate.source_sha256 || await sha256Hex(rgba) !== candidate.sha256
      || !source.isSelected() || projectChangeInFlight() || staticPlacementBlocked()) {
      throw Object.assign(new Error('The canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
    }
    if (isSubRect) {
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          if (x >= scopeRect.x && x < scopeRect.x + scopeRect.w && y >= scopeRect.y && y < scopeRect.y + scopeRect.h) continue
          const idx = (y * 64 + x) * 4
          if (rgba[idx] !== source.rgba[idx] || rgba[idx + 1] !== source.rgba[idx + 1]
            || rgba[idx + 2] !== source.rgba[idx + 2] || rgba[idx + 3] !== source.rgba[idx + 3]) {
            throw Object.assign(new Error('The canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
          }
        }
      }
    }
    if (rgba.every((v, i) => v === source.rgba[i])) {
      const unchanged = `${external ? 'The external tools' : 'Astra'} left the preview unchanged. No pixels were saved.`
      return external ? unchanged : { outcome: 'unchanged', message: 'No pixels needed to change.' }
    }
    const manifest = session.documents.get(source.sourceDocumentId)
    const nativeBlank = !external && isBlankSpriteDocument(manifest)
    const writable = Boolean(manifest?.derived_from) || nativeBlank
    const scopeNotice = isSubRect ? ` · Region (${scopeRect.x}, ${scopeRect.y}, ${scopeRect.w}×${scopeRect.h})` : ''
    let changedPixels = 0
    const diffRgba = external ? new Uint8Array(64 * 64 * 4) : null
    if (external) {
      for (let i = 0; i < 64 * 64; i += 1) {
        const idx = i * 4
        const changed = rgba[idx] !== source.rgba[idx]
          || rgba[idx + 1] !== source.rgba[idx + 1]
          || rgba[idx + 2] !== source.rgba[idx + 2]
          || rgba[idx + 3] !== source.rgba[idx + 3]
        if (changed) {
          changedPixels += 1
          if (rgba[idx + 3] > 0) {
            diffRgba[idx] = rgba[idx]
            diffRgba[idx + 1] = rgba[idx + 1]
            diffRgba[idx + 2] = rgba[idx + 2]
            diffRgba[idx + 3] = 255
          } else {
            diffRgba[idx] = 255
            diffRgba[idx + 1] = 80
            diffRgba[idx + 2] = 120
            diffRgba[idx + 3] = 255
          }
        }
      }
    }
    const sourceLabel = candidate?.bridge_source === 'aseprite' ? 'Aseprite (.aseprite) return' : 'Codex STDIO MCP'
    const externalSummary = external
      ? `Source: ${sourceLabel} · Scope: ${isSubRect ? `Region (${scopeRect.x}, ${scopeRect.y}, ${scopeRect.w}×${scopeRect.h})` : 'Full 64×64 canvas'} · ${changedPixels} px changed · `
      : ''
    const approved = !external ? true
      : await new Promise(resolve => {
        openConfirm({ title: 'Preview external drawing',
          body: `${externalSummary}GameTool native pixel tools${scopeNotice} · ${candidate.drawing_batches} drawing ${candidate.drawing_batches === 1 ? 'batch' : 'batches'}. Nothing is saved yet. `
            + (writable ? 'Save updates this canvas. Undo restores the previous pixels.' : 'Save creates an editable copy beside this canvas. The original stays unchanged; Undo removes the copy.'),
          primary: 'Save drawing', secondary: 'Discard preview', onPrimary: () => {
            if (projectChangeInFlight()) { setCanvasStatus('Wait for the project to finish opening.'); return }
            resolve(true); closeConfirm()
          }, onSecondary: closeConfirm, onDismiss: () => resolve(false) })
        const preview = rgbaBytesToCanvas(rgba, 64, 64)
        preview.className = 'vnext-pixel-edit-candidate is-native-drawing'; preview.setAttribute('aria-label', 'External native pixel drawing preview')
        nodes.confirmDetails.append(preview)
        if (diffRgba) {
          const diffPreview = rgbaBytesToCanvas(diffRgba, 64, 64)
          if (diffPreview) {
            diffPreview.className = 'vnext-pixel-edit-candidate is-native-drawing is-diff'
            diffPreview.setAttribute('aria-label', 'External pixel difference preview')
            nodes.confirmDetails.append(diffPreview)
          }
        }
        nodes.confirmDetails.hidden = false
      })
    if (!approved) return 'Preview discarded. No pixels were saved.'
    await checkCurrent()
    if (!source.isSelected() || projectChangeInFlight()) throw Object.assign(new Error(), { code: 'assistant_context_changed' })
    const writeSource = isSubRect && !source.allowedRect ? { ...source, allowedRect: { ...scopeRect } } : source
    const saveMessage = saved => typeof saved === 'string' ? saved
      : saved?.saved && saved?.settled ? `${external ? 'External' : 'Astra'} drawing saved on this canvas. Undo restores the previous pixels.`
        : saved?.saved ? 'Drawing saved; canvas reload is pending. No new model request is needed.'
          : 'Drawing save is not confirmed. Check the current save notice; no new model request was sent.'
    const inlineRecovery = !external && typeof renderRecovery === 'function'
      ? notice => renderRecovery({ ...notice, onPrimary: async () => {
        const saved = await notice.onPrimary()
        return { message: saveMessage(saved), pending: Boolean(session.manualWrite || session.pixelCopyPending) }
      } })
      : null
    const saved = await session.savePixelStroke(writeSource, rgba, {
      allowBlank: nativeBlank, saveOperationId, renderRecovery: inlineRecovery, ...(isSubRect ? { selection: scopeRect } : {}),
    })
    if (external) return saveMessage(saved)
    // Direct application reports a typed outcome; the copy path describes itself in its message.
    if (typeof saved === 'string') {
      const copied = /beside the original/i.test(saved) && !/not confirmed|not saved|could not|failed/i.test(saved)
      return { outcome: copied ? 'copied' : 'unconfirmed', message: saved, writable }
    }
    return { outcome: saved?.saved ? (saved.settled ? 'saved' : 'saved_pending') : 'unconfirmed', message: saveMessage(saved), writable }
  }
  // Explicit review links run only during initial page load, never from background polling.
  session.reviewExternalPixels = async link => {
    if (session.project || projectChangeInFlight()) {
      setCanvasStatus('Open the review link in a new tab to keep the current project unchanged.', { error: true })
      return
    }
    const initialEpoch = api.openEpoch.current, initialActivity = session.activity
    let openedEpoch = null
    let source = null
    const ownsInitial = () => !session.project && !projectChangeInFlight() && api.openEpoch.isCurrent(initialEpoch) && session.activity === initialActivity
    const ownsOpened = () => openedEpoch !== null && session.project?.id === link.projectId && !projectChangeInFlight() && api.openEpoch.isCurrent(openedEpoch) && (!source || source.isCurrent())
    try {
      const cleanup = await session.externalBridge?.resumeRetirement?.(link)
      if (cleanup) {
        if (!ownsInitial() || !await openProjectById(link.projectId)) return
        openedEpoch = api.openEpoch.current
        if (ownsOpened()) setCanvasStatus(cleanup.message, { error: cleanup.error })
        return
      }
      const result = await readExternalPixels(link)
      if (!ownsInitial()) return
      if (!await openProjectById(link.projectId)) return
      openedEpoch = api.openEpoch.current
      const c = result.context
      if (session.project?.id !== c.project_id || session.project.revision !== c.project_revision
        || session.project.canvases?.[c.canvas_id]?.document_id !== c.document_id
        || session.documents.get(c.document_id)?.revision !== c.working_revision) throw Error('The external drawing expired or its canvas changed. No pixels were saved.')
      view.select(c.canvas_id); bindConversationRef(c.canvas_id); refreshTimeline()
      const extRect = c.allowed_rect
      if (extRect && (extRect.x !== 0 || extRect.y !== 0 || extRect.w !== 64 || extRect.h !== 64)) {
        session.pixelSelection = { projectId: c.project_id, canvasId: c.canvas_id, rect: { ...extRect } }
      }
      renderCanvas()
      source = await session.preparePixelEdit({ scopeGrant: false })
      if (!ownsOpened()) return
      const candidateWithSource = {
        ...result.pixel_candidate,
        bridge_source: result.pixel_candidate?.bridge_source || c?.bridge_source || 'codex_mcp',
      }
      const message = await session.reviewNativePixelCandidate(source, result.rgba, candidateWithSource, {
        external: true, checkCurrent: async () => {
          const latest = await readExternalPixels(link)
          if (!ownsOpened()) throw Object.assign(new Error(), { code: 'assistant_context_changed' })
          if (latest.pixel_candidate.sha256 !== result.pixel_candidate.sha256) throw Error('The external drawing changed. No pixels were saved.')
        },
      })
      const isSavedDecision = typeof message === 'string'
        && (/saved/i.test(message) || /beside the original/i.test(message))
        && !/not confirmed|no pixels were saved/i.test(message)
      const isDiscardedDecision = typeof message === 'string' && /discarded/i.test(message)
      if (isSavedDecision || isDiscardedDecision) {
        const retired = await session.externalBridge.retireCandidate({
          projectId: link.projectId, canvasId: c.canvas_id, sessionId: link.sessionId,
          targetName: source?.name || c.canvas_id,
          projectRevision: session.project?.revision, workingRevision: c.working_revision,
          isSaved: isSavedDecision, isDiscarded: isDiscardedDecision, decisionMessage: message,
        })
        if (!retired) {
          if (session.project?.id === link.projectId) setCanvasStatus(session.externalBridge.state.notice.text, { error: true })
          return
        }
      }
      if (ownsOpened()) setCanvasStatus(message)
    } catch (error) {
      if (error?.code === 'assistant_context_changed') return
      if (openedEpoch === null ? !ownsInitial() : !ownsOpened()) return
      setCanvasStatus(error.message || 'The external drawing could not be opened. No pixels were saved.', { error: true })
    }
  }
  session.reviewExternalCandidate = async (link, { saveOperationId = null } = {}) => {
    if (!session.project || session.project.id !== link?.projectId || projectChangeInFlight()) {
      throw Object.assign(new Error('Open the target project before reviewing the external edit.'), { code: 'assistant_context_changed' })
    }
    const epoch = api.openEpoch.current
    const ownsProject = () => session.project?.id === link.projectId && !projectChangeInFlight() && api.openEpoch.isCurrent(epoch)
    const result = await readExternalPixels(link)
    if (!ownsProject()) throw Object.assign(new Error('The selected canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
    const c = result.context
    if (session.project?.id !== c.project_id || session.project.revision !== c.project_revision
      || session.project.canvases?.[c.canvas_id]?.document_id !== c.document_id
      || session.documents.get(c.document_id)?.revision !== c.working_revision) {
      throw Object.assign(new Error('The external drawing expired or its canvas changed. No pixels were saved.'), { code: 'stale_revision' })
    }
    if (view.selectedId !== c.canvas_id) {
      view.select(c.canvas_id)
      bindConversationRef(c.canvas_id)
      refreshTimeline()
    }
    const extRect = c.allowed_rect
    if (extRect && (extRect.x !== 0 || extRect.y !== 0 || extRect.w !== result.pixel_candidate.width || extRect.h !== result.pixel_candidate.height)) {
      session.pixelSelection = { projectId: c.project_id, canvasId: c.canvas_id, rect: { ...extRect } }
    }
    renderCanvas()
    const source = await session.preparePixelEdit({ scopeGrant: false })
    if (!ownsProject() || !source.isCurrent()) {
      throw Object.assign(new Error('The selected canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
    }
    const candidateWithSource = {
      ...result.pixel_candidate,
      bridge_source: result.pixel_candidate?.bridge_source || c?.bridge_source || 'codex_mcp',
    }
    const message = await session.reviewNativePixelCandidate(source, result.rgba, candidateWithSource, {
      external: true,
      saveOperationId,
      checkCurrent: async () => {
        const latest = await readExternalPixels(link)
        if (!ownsProject() || !source.isCurrent()) throw Object.assign(new Error(), { code: 'assistant_context_changed' })
        if (latest.pixel_candidate.sha256 !== result.pixel_candidate.sha256) {
          throw Object.assign(new Error('The external drawing changed. No pixels were saved.'), { code: 'stale_revision' })
        }
      },
    })
    if (ownsProject()) setCanvasStatus(message)
    return message
  }
  session.createPixelCopy = async (source, operation, onRecovered = () => {}, { rgba, selectCopy = false, selectionRect = null, operationId = null, renderRecovery = null } = {}) => {
    if (!source.isSelected() || session.manualGesture || session.manualWrite || session.pendingImport || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit || session.pixelCopyPending) {
      throw Object.assign(new Error('The selected image changed or another edit is pending. No new image was submitted.'), { code: 'assistant_context_changed' })
    }
    source.copyPosition = pixelCopyPosition(view, source)
    const write = rememberWrite('pixel-copy', source.projectId, { openToken: api.openEpoch.current })
    let state, failed = false, partialKnownFailure = false, resolving = false
    const live = () => source.isCurrent() && writeStillCurrent(write)
    const allPixelsSaved = () => Boolean(state?.pixelsComplete)
    const hasPartialStrips = () => Boolean(state?.stripCount > 1 && state?.stripIndex > 0 && !state?.pixelsComplete)
    const reload = async () => {
      const latest = await api.getProject(source.projectId, { token: api.openEpoch.current })
      if (!live()) return
      if (!latest.ok || latest.stale) throw new Error('Image saved, but the canvas could not be refreshed.')
      await applyProject(latest.project, { preserveView: true, write })
      if (!live()) return
      const box = nodes.stage?.getBoundingClientRect()
      view.fitAll(box?.width || 800, box?.height || 600, 64)
      renderCanvas()
    }
    const release = () => {
      if (session.pendingImport !== write) return
      write.partialKnownFailure = false
      write.releasePartial = null
      partialKnownFailure = false
      session.pendingImport = false
      session.pixelCopyPending = false
      session.pixelCopyBusy = false
      session.resolvePixelCopy = null
      renderChrome(); notifyDraftChange()
    }
    const partial = () => hasPartialStrips()
      ? `Partial stroke saved (${state.stripIndex}/${state.stripCount} strips). Retry to finish or undo to revert.`
      : state?.derived
        ? `“${source.name}” was created, but the change is not complete. The original is unchanged.`
        : 'The new image was not confirmed. The original is unchanged.'
    const showRecovery = renderRecovery || openConfirm
    const retryRecovery = async () => {
      if (!renderRecovery) closeConfirm()
      const message = await run()
      if (live()) onRecovered(message)
      return message
    }
    const recover = () => {
      if (!state || resolving || !live()) return
      if (partialKnownFailure && hasPartialStrips()) {
        showRecovery({
          title: `Partial stroke saved (${state.stripIndex}/${state.stripCount} strips)`,
          body: 'Part of this pixel change was saved to the new copy before an error occurred. Retry finishes the remaining strips, or Dismiss and Undo removes the partial copy.',
          primary: VNEXT_PROJECT_COPY.retry,
          secondary: VNEXT_PROJECT_COPY.dismiss,
          onPrimary: retryRecovery,
          onSecondary: () => { closeConfirm(); release() },
        })
        return
      }
      const refreshOnly = state?.phase === 'refresh' || failed
      showRecovery({ title: refreshOnly ? 'Canvas refresh pending' : 'New image not completed',
        body: refreshOnly ? 'Retry only reloads the actual saved canvas; it will not generate another image.'
          : `${partial()} Retry checks the same saved request; it does not call the model again.`,
        primary: refreshOnly ? 'Reload canvas' : VNEXT_PROJECT_COPY.retry,
        secondary: VNEXT_PROJECT_COPY.dismiss,
        onPrimary: retryRecovery,
        onSecondary: () => closeConfirm() })
    }
    const run = async () => {
      if (resolving || !live()) return ''
      resolving = true
      session.pixelCopyBusy = true
      partialKnownFailure = false
      write.partialKnownFailure = false
      write.releasePartial = null
      notifyDraftChange()
      try {
        if (failed) await reload()
        else await state.run()
        if (!live()) return ''
        source.copyResult = { canvasId: state.derived?.canvas?.id || null, complete: !failed, pixelsSaved: allPixelsSaved() }
        const message = failed ? partial() : `New image “${source.name}” is beside the original. The original is unchanged. Undo removes only the new canvas.`
        if (!failed && selectCopy && view.selectedId === source.sourceCanvasId) { // the user may have selected another image meanwhile
          view.select(state.derived.canvas.id)
          session.documentTimeline?.setTarget(state.derived.document, source.target)
          const rect = selectionRect || source.allowedRect
          if (rect) session.pixelSelection = { projectId: source.projectId, canvasId: state.derived.canvas.id, rect: { ...rect } }
          bindConversationRef(state.derived.canvas.id)
          refreshTimeline(); renderCanvas()
        }
        release(); setCanvasStatus(''); return message
      } catch (error) {
        if (!live()) return ''
        if (error.kind !== 'unknown' && state.phase !== 'refresh') {
          if (hasPartialStrips()) {
            partialKnownFailure = true
            write.partialKnownFailure = true
            write.releasePartial = release
            source.copyResult = {
              canvasId: state.derived?.canvas?.id || null,
              complete: false,
              pixelsSaved: false,
              partial: true,
              stripIndex: state.stripIndex,
              stripCount: state.stripCount,
            }
            if (state.saved?.project) {
              try { await applyProject(state.saved.project, { preserveView: true, write }) } catch { /* Keep partial recovery */ }
            }
            const message = partial()
            setCanvasStatus(message, { error: true })
            return message
          }
          failed = true
          source.copyResult = { canvasId: state.derived?.canvas?.id || null, complete: false, pixelsSaved: allPixelsSaved() }
          if (!state.derived) {
            release()
            const rejected = 'No new image was created. The project changed or the edit was rejected. Send again after checking the selection.'
            if (rgba !== undefined) setCanvasStatus(rejected, { error: true }) // manual edits have no other place to report this
            return rejected
          }
          try { await reload(); if (live()) release() } catch { /* Keep the reload-only recovery. */ }
        }
        const message = allPixelsSaved() ? 'The new image pixels are saved, but its position or display is not yet confirmed.' : partial()
        setCanvasStatus(message, { error: true })
        return message
      } finally {
        if (rgba !== undefined && live() && (state?.saved || state?.derived)) {
          const confirmed = state.saved || state.derived
          historyForProject().pixelHeads.set(confirmed.document.document_id, confirmed.document.revision)
        }
        resolving = false
        session.pixelCopyBusy = false
        notifyDraftChange()
        if (live() && session.pixelCopyPending) recover()
        else if (!live()) release()
      }
    }
    // Acquire the local write lock before the digest await; no competing editor write may start.
    session.pixelCopyPending = true
    session.pixelCopyBusy = true
    session.pendingImport = write
    session.resolvePixelCopy = recover
    notifyDraftChange()
    try {
      state = await createPixelCopyOperation({ source, operation, rgba, api, isCurrent: live, operationId,
        onDerived: (result) => pushHistory({ kind: 'import', projectId: source.projectId,
          canvasId: result.canvas.id, documentId: result.document.document_id,
          manualPixels: rgba !== undefined,
          to: { ...source.copyPosition } }), refresh: reload })
    } catch (error) { release(); throw error }
    return run()
  }

  session.savePalette = async colorsOrPayload => {
    if (!session.project || !['editor_project_v1', 'editor_project_v2'].includes(session.project.version) || session.frameLoading || session.pixelCopyPending
      || projectChangeInFlight() || staticPlacementBlocked()) return
    const write = rememberWrite('palette', session.project.id, { openToken: api.openEpoch.current })
    const isPayload = Boolean(colorsOrPayload && !Array.isArray(colorsOrPayload) && Array.isArray(colorsOrPayload.colors))
    const rawColors = isPayload ? colorsOrPayload.colors : colorsOrPayload
    const nextColors = rawColors.map(c => c.slice())
    const request = { operationId: createOperationId(), expectedRevision: session.project.revision, colors: nextColors }
    if (isPayload && Array.isArray(colorsOrPayload.items)) {
      request.active_id = colorsOrPayload.active_id
      request.items = colorsOrPayload.items.map(item => ({ id: item.id, name: item.name, colors: item.colors.map(c => c.slice()) }))
    } else if (Array.isArray(session.project.settings?.palette?.items) && session.project.settings.palette.items.length > 0) {
      const existingItems = session.project.settings.palette.items
      const activeId = session.project.settings.palette.active_id || existingItems[0].id
      request.active_id = activeId
      request.items = existingItems.map(item => ({
        id: item.id,
        name: item.name,
        colors: item.id === activeId ? nextColors.map(c => c.slice()) : item.colors.map(c => c.slice()),
      }))
    }
    const live = () => writeStillCurrent(write)
    let saved, running = false, uncertain = false
    const release = () => {
      if (session.manualWrite !== write) return
      session.manualWrite = null
      if (session.pendingImport === write) session.pendingImport = false
      renderChrome(); notifyDraftChange()
    }
    const recover = () => {
      if (running || !live()) return
      openConfirm({ title: saved ? 'Palette refresh pending' : 'Palette save not confirmed',
        body: saved ? 'The palette is saved. Reload reads the project without saving again.'
          : 'Retry checks this same palette request. Dismiss keeps editing locked until it is resolved.',
        primary: saved ? 'Reload palette' : VNEXT_PROJECT_COPY.retry, secondary: VNEXT_PROJECT_COPY.dismiss,
        onPrimary: async () => { closeConfirm(); await run() }, onSecondary: closeConfirm })
    }
    write.recover = recover; session.manualWrite = write; session.pendingImport = write
    renderChrome(); notifyDraftChange(); setCanvasStatus('Saving palette…')
    const run = async () => {
      if (running || !live()) { if (!live()) release(); return }
      running = true
      try {
        if (!saved) saved = await api.savePalette(write.projectId, request)
        if (!live()) return
        const loaded = await api.getProject(write.projectId, { token: api.openEpoch.current })
        if (!live()) return
        if (!loaded.ok || loaded.stale) throw new Error('Palette reload failed')
        const applied = await applyProject(loaded.project, { preserveView: true, write })
        if (!applied || applied.stale) throw new Error('Palette could not be displayed')
        if (live()) { release(); setCanvasStatus('Palette saved.') }
      } catch (error) {
        if (!live()) return
        uncertain ||= error.kind === 'unknown'
        if (!saved && !uncertain) release()
        setCanvasStatus(saved ? 'Palette saved; reload is still pending.' : uncertain
          ? 'Palette save not confirmed. Resolve it before editing.' : 'Palette not saved. Reopen the project if it changed elsewhere.', { error: true })
      } finally {
        running = false
        if (!live()) release(); else if (session.manualWrite === write) recover()
      }
    }
    await run()
  }

  // writeRect widens the scoped patch for selection moves/pastes; selection is where the marquee lands.
  function otherDocumentsUnchanged(previous, next, documentId) {
    const before = previous?.sprite_documents || {}
    const after = next?.sprite_documents || {}
    const ids = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const id of ids) {
      if (id === documentId) continue
      if ((before[id]?.working_revision ?? null) !== (after[id]?.working_revision ?? null)) return false
    }
    return true
  }
  async function applyConfirmedDocument(project, document, fullBytes, live = () => true) {
    if (!live() || !project || !document || session.project?.id !== project.id || document.document_id == null) return false
    const previousIds = Object.keys(session.project.canvases || {})
    if (previousIds.length !== Object.keys(project.canvases || {}).length || previousIds.some(id => !project.canvases[id])) return false
    if (!otherDocumentsUnchanged(session.project, project, document.document_id)) return false
    const remoteRevision = project.sprite_documents?.[document.document_id]?.working_revision
    if (remoteRevision != null && remoteRevision !== document.revision) return false
    const movedUnderDraft = view.canvases.some(canvas => !canvas.transient && view.drafts[canvas.id] && project.canvases[canvas.id] && (project.canvases[canvas.id].x !== canvas.x || project.canvases[canvas.id].y !== canvas.y))
    if (movedUnderDraft || view.canvases.some(canvas => !canvas.transient && !project.canvases[canvas.id])) return false
    const extra = new Map()
    for (const cel of Object.values(document.cels || {})) {
      if (!cel.block || cachedPixelBlock(document.document_id, cel.block.sha256)) continue
      if (!(fullBytes instanceof Uint8Array) || fullBytes.length !== cel.block.w * cel.block.h * 4) return false
      if (await sha256Hex(fullBytes) !== cel.block.sha256) return false
      if (!live()) return false
      extra.set(cel.block.sha256, { bytes: fullBytes, width: cel.block.w, height: cel.block.h })
    }
    if (!live()) return false
    const frameId = session.documentTimeline?.target(document)?.frame_id || document.frame_order?.[0]
    let bytes
    try {
      const { paintLayerText, rememberLayerPixels } = await import('./vnext-text-objects.js')
      if (!live()) return false
      const familyFor = item => session.resolveTextFont?.(item) || (item.font?.kind === 'generic' ? item.font.name : null)
      bytes = await compositePixelFrame(document, frameId, async celBlock => {
        const hit = extra.get(celBlock.sha256) || cachedPixelBlock(document.document_id, celBlock.sha256)
        if (!hit) throw new Error('missing block')
        return hit.bytes
      }, (rgba, layerId) => paintLayerText(rgba, document, frameId, layerId, familyFor), layers => rememberLayerPixels(document, frameId, layers))
    } catch {
      return false
    }
    if (!live()) return false
    const width = document.canvas?.w, height = document.canvas?.h
    const existing = view.canvases.find(canvas => canvas.document_id === document.document_id && !canvas.transient)?.preview
    let preview = existing?.width === width && existing?.height === height ? existing : rgbaBytesToCanvas(bytes, width, height)
    if (preview === existing) {
      try { preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0) }
      catch { return false }
    }
    if (!live() || !preview) return false
    for (const [sha, block] of extra) rememberPixelBlock(document.document_id, sha, block.bytes, block.width, block.height)
    session.documents.set(document.document_id, document)
    session.project = project
    for (const canvas of view.canvases) {
      if (canvas.transient) continue
      const remote = project.canvases[canvas.id]
      canvas.x = remote.x
      canvas.y = remote.y
      const custom = Object.hasOwn(remote, 'display_name') ? (remote.display_name || '') : ''
      canvas.display_name = custom
      canvas.name = custom || session.documents.get(canvas.document_id)?.name || canvas.manifest_name || ''
      if (canvas.document_id === document.document_id) {
        canvas.preview = preview
        canvas.width = document.canvas.w
        canvas.height = document.canvas.h
      }
    }
    const draftsRemain = view.canvases.some(canvas => !canvas.transient && view.drafts[canvas.id])
    if (!draftsRemain || !session.layoutRevisionPinned) {
      session.layoutBaseRevision = project.revision
      session.layoutRevisionPinned = false
    }
    refreshTimeline()
    renderCanvas()
    return true
  }
  session.savePixelStroke = async (source, rgba, { writeRect = null, selection = null, allowBlank = true, saveKind = 'stroke', saveOperationId = null, renderRecovery = null } = {}) => {
    const savedLabel = saveKind === 'text' ? 'Text' : 'Stroke'
    const savedNoun = saveKind === 'text' ? 'text' : 'stroke'
    if (!source.isSelected() || staticPlacementBlocked() || session.pixelCopyPending) throw new Error('Finish the current edit before drawing.')
    if (!(rgba instanceof Uint8Array) || rgba.length !== source.width * source.height * 4) throw new Error('Invalid stroke buffer.')
    if (rgba.every((value, i) => value === source.rgba[i])) return
    const marquee = session.pixelSelection
    const selectionBefore = marquee?.projectId === source.projectId && marquee.canvasId === source.sourceCanvasId ? { ...marquee.rect } : null
    if (writeRect) source = { ...source, allowedRect: { ...writeRect } }
    const manifest = session.documents.get(source.sourceDocumentId)
    if (!manifest?.derived_from && !(allowBlank && isEditablePixelDocument(manifest, session.project))) {
      return session.createPixelCopy(source, null, () => {}, { rgba, selectCopy: true, selectionRect: selection, operationId: saveOperationId, renderRecovery })
    }
    invalidateChangedPixelHistory(source.sourceDocumentId, source.sourceRevision)
    const write = rememberWrite('manual-pixels', source.projectId, { openToken: api.openEpoch.current })
    const live = () => source.isCurrent() && writeStillCurrent(write)
    let request, saved, historyEntry = null, running = false, partialKnownFailure = false
    const strokeBytes = new Uint8Array(rgba), grantState = {}
    const baseRect = source.allowedRect || { x: 0, y: 0, w: source.width, h: source.height }
    const changedRect = baseRect.w * baseRect.h * 4 > WORKING_PIXELS_MAX_BYTES && source.rgba instanceof Uint8Array
      ? (diffPixelRect(source.rgba, strokeBytes, source.width, source.height, baseRect) || baseRect)
      : baseRect
    const strips = splitPixelRectStrips(changedRect, WORKING_PIXELS_MAX_BYTES)
    const stripStates = strips.map(() => ({}))
    let stripIndex = 0
    const allSaved = () => (strips.length === 1 ? Boolean(saved) : stripIndex >= strips.length && Boolean(saved))
    const release = () => {
      write.partialKnownFailure = false
      write.running = false
      if (session.activeWrite === write) session.activeWrite = null
      if (session.manualWrite !== write) return
      session.manualWrite = null
      if (session.pendingImport === write) session.pendingImport = false
      renderChrome(); notifyDraftChange()
    }
    const saveResult = () => ({ saved: allSaved(), partial: stripIndex > 0 && !allSaved(), settled: session.manualWrite !== write })
    const showRecovery = renderRecovery || openConfirm
    const retryRecovery = async () => {
      if (!renderRecovery) closeConfirm()
      await run()
      return saveResult()
    }
    const recover = () => {
      if (running || !live()) return
      if (partialKnownFailure && !allSaved()) {
        showRecovery({
          title: `Partial ${savedNoun} saved (${stripIndex}/${strips.length} strips)`,
          body: `Retry writes the remaining ${strips.length - stripIndex} strip(s). Or dismiss and use Undo to revert the partial ${savedNoun}.`,
          primary: VNEXT_PROJECT_COPY.retry,
          secondary: VNEXT_PROJECT_COPY.dismiss,
          onPrimary: retryRecovery,
          onSecondary: () => { closeConfirm(); release() },
        })
        return
      }
      showRecovery({ title: allSaved() ? 'Pixel refresh pending' : `${savedLabel} save not confirmed`,
        body: allSaved() ? `Pixels are saved. Reload checks the saved image without writing another ${savedNoun}.`
          : `Retry checks this same ${savedNoun} request. It does not create another edit.`,
        primary: allSaved() ? 'Reload canvas' : VNEXT_PROJECT_COPY.retry, secondary: VNEXT_PROJECT_COPY.dismiss,
        onPrimary: retryRecovery, onSecondary: closeConfirm })
    }
    write.recover = recover
    write.releasePartial = release
    session.manualWrite = write; session.pendingImport = write
    renderChrome(); notifyDraftChange()
    const run = async () => {
      if (running || !live()) { if (!live()) release(); return }
      running = true
      write.running = true
      partialKnownFailure = false
      write.partialKnownFailure = false
      try {
        if (strips.length === 1) {
          request ||= await scopedPixelRequest(api, source, strokeBytes, { state: grantState, operationId: saveOperationId })
          if (!saved) {
            const result = await api.writeWorkingPixels(source.projectId, source.sourceDocumentId, request)
            const afterRevision = pixelWriteReceipt(result, request, source.projectId, source.sourceDocumentId)
            saved = result
            if (!live()) return
            historyForProject().pixelHeads.set(source.sourceDocumentId, afterRevision)
            pushHistory({ kind: 'pixels', projectId: source.projectId, canvasId: source.sourceCanvasId,
              documentId: source.sourceDocumentId, beforeRevision: source.sourceRevision, afterRevision, structure: source.multiCel || source.hasLinks,
              ...(selection ? { selection: { before: selectionBefore, after: { ...selection } } } : {}) })
            if (selection) session.pixelSelection = { projectId: source.projectId, canvasId: source.sourceCanvasId, rect: { ...selection } }
          }
        } else {
          while (stripIndex < strips.length) {
            const curProjRev = saved ? (saved.receipt?.project_revision ?? saved.project?.revision) : source.projectRevision
            const curDocRev = saved ? (saved.document?.revision ?? saved.receipt?.document_revision) : source.sourceRevision
            const req = await scopedPixelRequest(api, source, strokeBytes, {
              documentId: source.sourceDocumentId,
              revision: curDocRev,
              projectRevision: curProjRev,
              target: source.target,
              rect: strips[stripIndex],
              state: stripStates[stripIndex],
            })
            const result = await api.writeWorkingPixels(source.projectId, source.sourceDocumentId, req)
            const afterRevision = pixelWriteReceipt(result, req, source.projectId, source.sourceDocumentId)
            saved = result
            stripIndex += 1
            if (!live()) return
            historyForProject().pixelHeads.set(source.sourceDocumentId, afterRevision)
            if (!historyEntry) {
              historyEntry = {
                kind: 'pixels',
                projectId: source.projectId,
                canvasId: source.sourceCanvasId,
                documentId: source.sourceDocumentId,
                beforeRevision: source.sourceRevision,
                afterRevision,
                structure: source.multiCel || source.hasLinks,
                ...(selection ? { selection: { before: selectionBefore, after: { ...selection } } } : {}),
              }
              pushHistory(historyEntry)
            } else {
              historyEntry.afterRevision = afterRevision
              historyEntry.undoRequest = null
              historyEntry.redoRequest = null
            }
            if (selection && stripIndex === strips.length) {
              session.pixelSelection = { projectId: source.projectId, canvasId: source.sourceCanvasId, rect: { ...selection } }
            }
          }
        }
        const loaded = await api.getProject(source.projectId, { token: api.openEpoch.current })
        if (!live()) return
        if (!loaded.ok || loaded.stale) throw new Error('Saved pixels could not be reloaded.')
        const displayed = await applyConfirmedDocument(loaded.project, saved.document, strokeBytes, live)
        if (!live()) return
        if (!displayed) {
          const applied = await applyProject(loaded.project, { preserveView: true, write })
          if (!live()) return
          if (!applied || applied.stale) throw new Error('Saved pixels could not be displayed.')
        }
        if (live()) { release(); setCanvasStatus('') }
      } catch (error) {
        if (!live()) return
        if (strips.length > 1 && stripIndex < strips.length && error.kind !== 'unknown') {
          stripStates[stripIndex] = {}
        }
        if (strips.length > 1 && stripIndex > 0 && !allSaved() && error.kind !== 'unknown') {
          partialKnownFailure = true
          write.partialKnownFailure = true
          if (saved?.project) {
            try {
              await applyProject(saved.project, { preserveView: true, write })
            } catch {
              /* Keep partial recovery state */
            }
          }
          if (!live()) return
          setCanvasStatus(`Partial ${savedNoun} saved (${stripIndex}/${strips.length} strips). Retry to finish or undo to revert.`, { error: true })
          return
        }
        if (!allSaved() && error.kind !== 'unknown') release()
        setCanvasStatus(allSaved() ? 'Pixels saved; reload is still pending.'
          : error.kind === 'unknown' ? `${savedLabel} save not confirmed. Resolve it before editing.`
            : `${savedLabel} not saved. Reopen the project if it changed elsewhere.`, { error: true })
      } finally {
        running = false
        write.running = false
        if (!live()) release()
        else if (session.manualWrite === write) recover()
      }
    }
    try {
      await run()
      // saved: the store confirmed the write; settled: the confirmed pixels are on screen (no recovery pending).
      return saveResult()
    } catch (error) { release(); throw error }
  }
  session.duplicateSelectedCanvas = async () => {
    if (!session.project || session.frameLoading || projectChangeInFlight() || staticPlacementBlocked() || session.pixelCopyPending || session.manualGesture || session.manualWrite || session.pendingImport || session.pendingSave || session.historyBusy || historyPending() || session.nameEdit) {
      return { ok: false, reason: 'busy' }
    }
    const canvasId = view.selectedId
    const owner = session.project
    const stored = owner?.canvases?.[canvasId]
    const manifest = stored ? session.documents.get(stored.document_id) : null
    if (!stored || !manifest) return { ok: false, reason: 'no_selection' }
    session.documentTimeline?.stop?.()
    invalidateChangedPixelHistory(manifest.document_id, manifest.revision)
    const write = rememberWrite('duplicate-canvas', owner.id, { openToken: api.openEpoch.current })
    const deriveRequest = {
      operationId: createOperationId(),
      expectedRevision: owner.revision,
      sourceCanvasId: canvasId,
      sourceDocumentId: manifest.document_id,
      sourceRevision: manifest.revision,
      name: `${manifest.name.slice(0, 120)} · copy`,
    }
    const live = () => writeStillCurrent(write)
    let derived = null, running = false, recorded = false
    const release = () => {
      if (session.manualWrite === write) session.manualWrite = null
      if (session.pendingImport === write) session.pendingImport = false
      renderChrome()
      notifyDraftChange()
    }
    const recover = () => {
      if (!live() || running) return
      openConfirm({
        title: derived ? 'Canvas refresh pending' : 'Duplicate canvas not confirmed',
        body: derived
          ? 'The copy is saved. Reload the canvas without creating another copy.'
          : 'Retry checks the same duplicate request without creating a second copy.',
        primary: derived ? 'Reload canvas' : VNEXT_PROJECT_COPY.retry,
        secondary: VNEXT_PROJECT_COPY.dismiss,
        onPrimary: () => { closeConfirm(); run() },
        onSecondary: closeConfirm,
      })
    }
    write.recover = recover
    session.manualWrite = write
    session.pendingImport = write
    renderChrome()
    notifyDraftChange()
    const run = async () => {
      if (running || !live()) return
      running = true
      renderChrome()
      try {
        if (!derived) {
          const response = await api.deriveWorking(owner.id, deriveRequest)
          pixelWriteReceipt(response, { ...deriveRequest, expectedWorkingRevision: 0 }, owner.id, response.document?.document_id)
          derived = response
        }
        if (!live()) return
        if (!recorded) {
          historyForProject().pixelHeads.set(derived.document.document_id, derived.document.revision)
          pushHistory({
            kind: 'import',
            projectId: owner.id,
            canvasId: derived.canvas.id,
            documentId: derived.document.document_id,
            manualPixels: true,
            to: { x: derived.canvas.x, y: derived.canvas.y },
          })
          recorded = true
        }
        await applyProject(derived.project, { preserveView: true, write })
        if (!live()) return
        view.select(derived.canvas.id)
        bindConversationRef(derived.canvas.id)
        session.pixelSelection = null
        const box = nodes.stage?.getBoundingClientRect()
        view.fitAll(box?.width || 800, box?.height || 600, 64)
        release()
        refreshTimeline()
        renderCanvas()
        setCanvasStatus('')
      } catch (error) {
        if (!live()) return
        if (error.kind !== 'unknown' && !derived) {
          release()
          setCanvasStatus(error.reason || error.message || 'Canvas could not be duplicated.', { error: true })
        } else {
          setCanvasStatus(derived ? 'Duplicate saved; reload is still pending.' : 'Resolve the pending duplicate before editing.', { error: true })
        }
      } finally {
        running = false
        if (!live()) release()
        else if (session.manualWrite === write) recover()
      }
    }
    await run()
    return derived
      ? { ok: true, canvas: derived.canvas, document: derived.document, receipt: derived.receipt }
      : { ok: false, unknown: session.manualWrite === write }
  }
  session.changeStructure = async (command, scope = null) => {
    if (session.frameLoading) return { ok: false, unknown: false, reason: 'loading' }
    if (projectChangeInFlight()) { setCanvasStatus('Wait for the project to finish opening.'); return { ok: false, unknown: false, reason: 'opening' } }
    session.documentTimeline?.stop?.()
    const canvasId = scope?.canvasId || view.selectedId, owner = session.project
    if (scope && (owner?.id !== scope.projectId || owner.revision !== scope.projectRevision)) return { ok: false, unknown: false, reason: 'stale' }
    const documentId = scope?.documentId || owner?.canvases?.[canvasId]?.document_id
    const manifest = session.documents.get(documentId)
    if (scope && (manifest?.document_id !== scope.documentId || manifest?.revision !== scope.workingRevision)) return { ok: false, unknown: false, reason: 'stale' }
    if (!manifest || staticPlacementBlocked() || session.pixelCopyPending) return { ok: false, unknown: false, reason: 'blocked' }
    invalidateChangedPixelHistory(manifest.document_id, manifest.revision)
    const write = rememberWrite('working-structure', owner.id, { openToken: api.openEpoch.current })
    const target = session.documentTimeline?.target(manifest)
    let result, derived, request, running = false, recorded = false, confirmed = false
    const finishConfirmed = () => {
      if (confirmed || !result?.receipt) return
      confirmed = true
      scope?.onConfirmed?.(result)
    }
    const deriveRequest = { operationId: createOperationId(), expectedRevision: owner.revision,
      sourceCanvasId: canvasId, sourceDocumentId: manifest.document_id, sourceRevision: manifest.revision, name: `${manifest.name.slice(0, 120)} · copy` }
    const live = () => writeStillCurrent(write)
    const release = () => { if (session.manualWrite === write) session.manualWrite = null; if (session.pendingImport === write) session.pendingImport = false; renderChrome(); notifyDraftChange() }
    const recover = () => { if (!live() || running) return; openConfirm({ title: 'Layer or frame save pending',
      body: result ? 'Saved. Reload the document without writing again.' : 'Check the same operation before making another edit. No model will be called.',
      primary: result ? 'Reload canvas' : VNEXT_PROJECT_COPY.retry, secondary: VNEXT_PROJECT_COPY.dismiss,
      onPrimary: () => { closeConfirm(); run() }, onSecondary: closeConfirm }) }
    write.recover = recover; session.manualWrite = write; session.pendingImport = write
    const run = async () => {
      if (running || !live()) return
      running = true; renderChrome()
      try {
        if (!isEditablePixelDocument(manifest, owner) && !derived) {
          const response = await api.deriveWorking(owner.id, deriveRequest)
          pixelWriteReceipt(response, { ...deriveRequest, expectedWorkingRevision: 0 }, owner.id, response.document?.document_id)
          derived = response
          if (!live()) return
          pushHistory({ kind: 'import', projectId: owner.id, canvasId: derived.canvas.id, documentId: derived.document.document_id, manualPixels: true, to: { x: derived.canvas.x, y: derived.canvas.y } })
        }
        const doc = derived?.document || manifest, id = derived?.canvas.id || canvasId
        request ||= { operationId: createOperationId(), expectedRevision: derived?.receipt.project_revision || owner.revision, expectedWorkingRevision: doc.revision, command }
        if (!result) {
          const response = await api.changeStructure(owner.id, doc.document_id, request)
          pixelWriteReceipt(response, request, owner.id, doc.document_id)
          result = response
        }
        if (!live()) return
        if (!recorded) {
          historyForProject().pixelHeads.set(doc.document_id, result.document.revision)
          if (!derived) pushHistory({ kind: 'pixels', structure: true, projectId: owner.id, canvasId: id, documentId: doc.document_id, beforeRevision: doc.revision, afterRevision: result.document.revision })
          recorded = true
        }
        const next = result.document
        let selected = target
        if (command.type === 'add-layer') selected = { ...target, layer_id: next.layer_order.find(key => !doc.layers[key]) }
        if (command.type === 'add-frame' || command.type === 'copy-frame') selected = { ...target, frame_id: next.frame_order.at(-1) }
        for (const kind of ['frame', 'layer']) {
          if (command.type === `move-${kind}`) selected = { ...selected, [`${kind}_id`]: command[`${kind}_id`] }
          if (command.type === `delete-${kind}` && selected?.[`${kind}_id`] === command[`${kind}_id`]) {
            const index = doc[`${kind}_order`].indexOf(command[`${kind}_id`])
            selected = { ...selected, [`${kind}_id`]: next[`${kind}_order`][Math.min(index, next[`${kind}_order`].length - 1)] }
          }
        }
        session.documentTimeline?.setTarget(next, selected)
        let refreshed = null
        try {
          const loaded = await api.getProject(owner.id, { token: api.openEpoch.current })
          if (loaded.ok && !loaded.stale) refreshed = loaded.project
        } catch { refreshed = null }
        if (!live()) return
        const displayed = refreshed ? await applyConfirmedDocument(refreshed, result.document, null, live) : false
        if (!live()) return
        if (!displayed) {
          await applyProject(refreshed || result.project, { preserveView: true, write })
          if (!live()) return
        }
        if (!live()) return
        view.select(id); bindConversationRef(id); session.pixelSelection = null
        if (derived) { const box = nodes.stage.getBoundingClientRect(); view.fitAll(box.width, box.height, 64) }
        finishConfirmed()
        release(); refreshTimeline(); renderCanvas(); setCanvasStatus('')
      } catch (error) {
        if (!live()) return
        if (result?.project) {
          try { await applyProject(result.project, { preserveView: true, write }) } catch {}
          if (!live()) return
          finishConfirmed()
          release(); setCanvasStatus('Saved. The canvas was refreshed from the confirmed result.', { error: true })
        } else if (error.kind !== 'unknown') {
          // A confirmed derive is retained as a visible, undoable copy, never hidden.
          if (derived) { try { await applyProject(derived.project, { preserveView: true, write }) } catch {} }
          if (!live()) return
          release(); setCanvasStatus(error.reason || error.message || 'The document was not changed.', { error: true })
        } else { setCanvasStatus('Resolve the pending layer or frame save before editing.', { error: true }) }
      } finally { running = false; if (!live()) release(); else if (session.manualWrite === write) recover() }
    }
    await run()
    if (result?.receipt) return { ok: true, unknown: false, document: result.document, receipt: result.receipt, operationId: request?.operationId || null }
    if (session.manualWrite === write) return { ok: false, unknown: true, operationId: request?.operationId || null }
    return { ok: false, unknown: false }
  }
  session.documentTimeline = bindDocumentTimeline({ root, session, command: session.changeStructure,
    compose: async (manifest, frameId) => session.documentCandidate?.manifest === manifest ? session.documentCandidate.compose(frameId) : rgbaBytesToCanvas(await readCompositeFrame(api, session.project.id, manifest, frameId, { familyFor: item => session.resolveTextFont?.(item) || (item.font.kind === 'generic' ? item.font.name : null) }), manifest.canvas.w, manifest.canvas.h),
    renderCanvas, renderPlaybackState: renderChrome, confirm: openConfirm, closeConfirm, status: setCanvasStatus, historyPending,
    promoteReference: opts => session.promoteProjectReference(opts),
    onScopeChange: () => { renderChrome(); notifyDraftChange() } })
  session.onionSkin = bindOnionSkin({ root, session, compose: (projectId, manifest, frameId) => readCompositeFrame(api, projectId, manifest, frameId), status: setCanvasStatus,
    clearStatus: message => { if (root.querySelector('#vnext-canvas-status')?.textContent === message) setCanvasStatus('') } })
  bindSubscriptionSheet({ root, session, client: createSubscriptionSheetClient(), getJob: createVnextGenerationClient().getJob })
  exportPanel = bindExportPanel({ root, trigger: nodes.download, api, context: exportContext,
    familyFor: item => session.resolveTextFont?.(item) || null,
    stopPlayback: () => session.documentTimeline?.stop(),
    currentFrame: target => selectedCanvasPng(target.canvas, { loadPixels: target.canvas.document_id ? async () => {
      if (!target.document) throw new Error('The selected canvas has no saved pixels to download.')
      return readCompositeFrame(api, target.projectId, target.document, target.frameId, { familyFor: item => session.resolveTextFont?.(item) || null, requireFonts: true })
    } : undefined }) })
  const tooltips = bindTooltips(root) // contextual control tips (instructions and shortcuts; states stay on the page)
  tooltips.set(nodes.move, 'Move · drag canvases to position them · click a canvas to see its details · V')
  nodes.move?.setAttribute('aria-keyshortcuts', 'V')
  tooltips.set(nodes.zoom, 'Zoom · Pinch or ⌘/Ctrl + scroll · + / − zoom · 1–6 set 100% to 3200% · click or 0 fits all in view')
  tooltips.set(nodes.grid, 'Pixel grid · one cell is one image pixel · shown from 400% zoom · not part of the artwork')
  tooltips.set(nodes.viewSettingsBtn, 'View settings · checkerboard square size and pixel grid. Display only.')
  function closeViewSettings() {
    if (!nodes.viewSettings || nodes.viewSettings.hidden) return false
    nodes.viewSettings.hidden = true
    nodes.viewSettingsBtn?.setAttribute('aria-expanded', 'false')
    nodes.viewSettingsBtn?.focus?.()
    return true
  }
  closeOpenViewSettings = closeViewSettings
  function openViewSettings() {
    if (!nodes.viewSettings) return
    nodes.viewSettings.hidden = false
    nodes.viewSettingsBtn?.setAttribute('aria-expanded', 'true')
    nodes.checkerSizes?.querySelector('[aria-checked="true"]')?.focus?.()
    renderChrome()
  }
  function setCheckerSquare(size) {
    const next = Number(size)
    if (!VNEXT_CHECKER_SQUARES.includes(next) || next === session.checkerSquare) return
    session.checkerSquare = next
    renderChrome()
  }
  function setPixelGrid(on) {
    session.pixelGrid = on ? true : false
    renderChrome()
    renderCanvas()
  }
  nodes.grid?.addEventListener('click', () => setPixelGrid(session.pixelGrid === false))
  nodes.viewSettingsBtn?.addEventListener('click', () => { if (nodes.viewSettings?.hidden === false) closeViewSettings(); else openViewSettings() })
  nodes.pixelGridSwitch?.addEventListener('click', () => setPixelGrid(session.pixelGrid === false))
  nodes.checkerSizes?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-checker-size]')
    if (button) setCheckerSquare(button.dataset.checkerSize)
  })
  nodes.checkerSizes?.addEventListener('keydown', (event) => {
    const buttons = [...nodes.checkerSizes.querySelectorAll('[data-checker-size]')]
    const index = buttons.indexOf(event.target)
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    const next = buttons[(index + step + buttons.length) % buttons.length]
    setCheckerSquare(next.dataset.checkerSize)
    next.focus?.()
  })
  manualTools = bindManualPixelTools({ root, session, status: setCanvasStatus, render: renderCanvas, tooltips,
    canEdit: (canvasId = view.selectedId) => {
      try { if (session.frameLoading) return false; const manifest = session.documents.get(session.project?.canvases?.[canvasId]?.document_id); pixelCopySource(session.project, canvasId, session.documents, session.documentTimeline?.target(manifest)); return true } catch { return false }
    },
    select: id => { session.selectCanvas(id) },
  })
  session.selectCanvas = id => { view.select(id); bindConversationRef(id); refreshTimeline(); renderCanvas() }
  // Read-only summary of the selected image for the properties panel (name, size, frame/layer, edit state).
  session.pixelTargetInfo = () => {
    const candidate = session.documentCandidate
    if (candidate?.canvas && (candidate.canvas.id === view.selectedId || !view.selectedId)) {
      const manifest = candidate.showSource ? candidate.source.manifest : candidate.manifest, target = session.documentTimeline?.target(candidate.manifest)
      return { name: candidate.canvas.name, width: manifest.canvas.w, height: manifest.canvas.h,
        frame: target ? manifest.frame_order.indexOf(target.frame_id) + 1 : 1, frames: manifest.frame_order.length,
        layer: target ? manifest.layers[target.layer_id]?.name || '' : '', candidate: true,
        readOnly: candidate.phase === 'saving' ? 'Saving this candidate…' : candidate.phase === 'recovery'
          ? (candidate.processing ? 'Resolve save in Perfect pixels' : 'Resolve the same save in chat') : 'Applying this result…' }
    }
    const canvas = view.canvases.find(item => item.id === view.selectedId)
    if (canvas?.transient) {
      return { name: canvas.name || 'AI result', width: canvas.width, height: canvas.height, frame: 0, frames: 0, layer: '',
        derived: false, linkedFrames: null, readOnly: 'Generated result · not in the project yet' }
    }
    const stored = session.project?.canvases?.[view.selectedId]
    if (!canvas || !stored) return null
    const manifest = session.documents.get(stored.document_id), target = manifest ? session.documentTimeline?.target(manifest) : null
    let readOnly = '', source = null
    if (session.openInFlight?.()) readOnly = 'Opening another project…'
    else if (session.frameLoading) readOnly = 'Loading this frame…'
    else if (!manifest) readOnly = 'This image has no editable pixels.'
    else try { source = pixelCopySource(session.project, view.selectedId, session.documents, target) } catch (error) { readOnly = error.message || 'This image cannot be edited.' }
    return { name: canvas.name || 'Image', width: canvas.width, height: canvas.height,
      frame: target ? manifest.frame_order.indexOf(target.frame_id) + 1 : 0, frames: manifest?.frame_order?.length || 0,
      layer: target ? manifest.layers?.[target.layer_id]?.name || '' : '', derived: Boolean(manifest?.derived_from), blank: isBlankSpriteDocument(manifest),
      sequence: isGeneralSequenceSpriteDocument(manifest, session.project),
      linkedFrames: source?.linkedFrames?.length > 1 ? source.linkedFrames : null, readOnly }
  }
  session.renderCanvas = renderCanvas
  session.pixelProcessing = bindPixelProcessing({ root, session })
  session.externalBridge = bindExternalBridge({ root, session, api })
  session.renderObjectPreview = renderObjectPreview
  // A caller may pin the open epoch its operation started in; a newer open then makes the reload stale.
  // The reload used after a save and by Reload canvas recovery (preset and subscription sheets):
  // it shows a read only if no newer revision of the same project is shown by then.
  session.reloadProject = (project, { token } = {}) => applyProject(project, { preserveView: true, token: token ?? api.openEpoch.current, notOlderThanShown: true })
  renderChrome()
  renderCanvas()
  if (typeof window !== 'undefined') {
    window.getVnextProjectSession = () => session
    window.__vnextRenderProject = renderCanvas
    window.__vnextRenderList = renderList
    window.__vnextRefreshTimeline = refreshTimeline
  }
  return session
}

function bindPaneResize(root) {
  const board = root.querySelector('.vnext-workbench')
  const left = root.querySelector('.vnext-left')
  const right = root.querySelector('.vnext-color-sidebar')
  if (!board || !left || !right) return
  const MIN_LEFT = 280
  const MAX_LEFT = 406
  const MIN_RIGHT = 240
  const MAX_RIGHT = 314
  const MIN_CENTER = 360

  function readWidth(side) {
    const raw = getComputedStyle(board).getPropertyValue(side === 'left' ? '--vnext-left-width' : '--vnext-right-width')
    return Number.parseFloat(raw) || (side === 'left' ? 406 : 314)
  }

  function clamp(side, next) {
    const boardW = board.getBoundingClientRect().width
    const other = side === 'left' ? readWidth('right') : readWidth('left')
    const max = Math.max(MIN_CENTER, boardW - other - MIN_CENTER)
    if (side === 'left') return Math.min(MAX_LEFT, max, Math.max(MIN_LEFT, next))
    return Math.min(MAX_RIGHT, max, Math.max(MIN_RIGHT, next))
  }

  let drag = null
  function onMove(event) {
    if (!drag) return
    const delta = event.clientX - drag.startX
    const next = drag.side === 'left' ? drag.startW + delta : drag.startW - delta
    const width = clamp(drag.side, next)
    board.style.setProperty(drag.side === 'left' ? '--vnext-left-width' : '--vnext-right-width', `${Math.round(width)}px`)
  }
  function onUp() {
    if (!drag) return
    drag.handle.classList.remove('is-dragging')
    drag = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  board.style.setProperty('--vnext-left-width', `${Math.round(clamp('left', readWidth('left')))}px`)
  board.style.setProperty('--vnext-right-width', `${Math.round(clamp('right', readWidth('right')))}px`)
  root.querySelectorAll('.vnext-pane-resizer').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const side = handle.dataset.pane
      const pane = side === 'left' ? left : right
      drag = { side, startX: event.clientX, startW: pane.getBoundingClientRect().width, handle }
      handle.classList.add('is-dragging')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })
  })
}

function bindPreviewWindow(root, onChange) {
  const pane = root.querySelector('.vnext-preview')
  const host = root.querySelector('.vnext-canvas-host')
  const head = pane?.querySelector('.vnext-preview-head')
  const handle = pane?.querySelector('.vnext-preview-resize')
  if (!pane || !host || !head) return
  const MIN_W = 240
  const MIN_H = 160
  const MAX_W = 640
  const MAX_H = 480
  const GAP = 8

  function current() {
    const hostBox = host.getBoundingClientRect()
    const box = pane.getBoundingClientRect()
    return {
      left: box.left - hostBox.left,
      top: box.top - hostBox.top,
      width: box.width,
      height: box.height,
    }
  }

  function area() {
    const hostBox = host.getBoundingClientRect()
    return {
      left: 0,
      top: 0,
      right: hostBox.width,
      bottom: hostBox.height,
    }
  }

  function clampToArea(x, y, w, h) {
    const a = area()
    return {
      x: Math.min(Math.max(a.left, x), Math.max(a.left, a.right - w)),
      y: Math.min(Math.max(a.top, y), Math.max(a.top, a.bottom - h)),
    }
  }

  function obstacles() {
    const hostBox = host.getBoundingClientRect()
    return [...host.querySelectorAll('.vnext-tools, .vnext-mode, .vnext-viewport-group, .vnext-zoom')]
      .filter((node) => node && !node.hidden)
      .map((node) => {
        const box = node.getBoundingClientRect()
        return {
          left: box.left - hostBox.left - GAP,
          top: box.top - hostBox.top - GAP,
          right: box.right - hostBox.left + GAP,
          bottom: box.bottom - hostBox.top + GAP,
        }
      })
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }

  function place(left, top, w, h) {
    let x = left
    let y = top
    const blocks = obstacles()
    for (let step = 0; step < 4; step += 1) {
      const clamped = clampToArea(x, y, w, h)
      x = clamped.x
      y = clamped.y
      const rect = { left: x, top: y, right: x + w, bottom: y + h }
      const hit = blocks.find((block) => overlaps(rect, block))
      if (!hit) break
      const pushLeft = rect.right - hit.left
      const pushRight = hit.right - rect.left
      const pushUp = rect.bottom - hit.top
      const pushDown = hit.bottom - rect.top
      const min = Math.min(pushLeft, pushRight, pushUp, pushDown)
      if (min === pushLeft) x -= pushLeft
      else if (min === pushRight) x += pushRight
      else if (min === pushUp) y -= pushUp
      else y += pushDown
    }
    return clampToArea(x, y, w, h)
  }

  function fitSize(left, top, width, height) {
    const a = area()
    let w = Math.min(width, Math.max(MIN_W, a.right - left))
    let h = Math.min(height, Math.max(MIN_H, a.bottom - top))
    const proposed = { left, top, right: left + w, bottom: top + h }
    for (const block of obstacles()) {
      if (!overlaps(proposed, block)) continue
      if (block.left >= left) w = Math.min(w, Math.max(MIN_W, block.left - left))
      if (block.top >= top) h = Math.min(h, Math.max(MIN_H, block.top - top))
    }
    return { w, h }
  }

  function apply(left, top, width, height, mode) {
    const collapsed = pane.classList.contains('is-collapsed')
    let w = Math.min(MAX_W, Math.max(MIN_W, width))
    let h = collapsed ? current().height : Math.min(MAX_H, Math.max(MIN_H, height))
    let x = left
    let y = top
    if (mode === 'resize') {
      const fitted = fitSize(left, top, w, h)
      w = fitted.w
      h = fitted.h
    } else {
      const next = place(left, top, w, h)
      x = next.x
      y = next.y
    }
    pane.style.left = `${Math.round(x)}px`
    pane.style.top = `${Math.round(y)}px`
    pane.style.right = 'auto'
    pane.style.bottom = 'auto'
    pane.style.width = `${Math.round(w)}px`
    if (!collapsed) pane.style.height = `${Math.round(h)}px`
  }

  let drag = null
  function onMove(event) {
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (drag.mode === 'move') apply(drag.start.left + dx, drag.start.top + dy, drag.start.width, drag.start.height, 'move')
    else {
      apply(drag.start.left, drag.start.top, drag.start.width + dx, drag.start.height + dy, 'resize')
      onChange?.()
    }
  }
  function onUp() {
    if (!drag) return
    drag = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    onChange?.()
  }
  function start(mode, event) {
    event.preventDefault()
    event.stopPropagation()
    drag = { mode, x: event.clientX, y: event.clientY, start: current() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  head.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return
    start('move', event)
  })
  handle?.addEventListener('pointerdown', (event) => {
    if (pane.classList.contains('is-collapsed')) return
    start('resize', event)
  })
}

export function bootVnextPreview(root = document, options = {}) {
  const frames = root.querySelector('#vnext-frame-cols')
  if (frames && frames.childElementCount === 0) renderFrames(frames)
  bindPromptDraft(root)
  bindReferenceDraft(root)
  const skills = bindSkillReference(root)
  bindOverlayDismiss(root)
  bindPaneResize(root)
  const projectSession = bindVnextProjectSession(root, options.client ? { client: options.client } : undefined)
  if (projectSession) projectSession.selectApplicationPreset = id => skills?.select(id) === true
  bindPreviewWindow(root, () => projectSession?.renderCanvas?.())
  let initialJobId = ''
  try {
    initialJobId = new URLSearchParams(window.location.search).get('job') || ''
  } catch {
    initialJobId = ''
  }
  bindVnextGenerationSession(root, {
    session: projectSession,
    initialJobId,
    getDraft: () => ({
      prompt: root.querySelector('#vnext-prompt-input')?.value ?? '',
      skillId: root.querySelector('#vnext-skill-row')?.hidden
        ? null
        : (root.querySelector('.vnext-skill-item.is-selected')?.dataset.skillId || 'fixed-region-motion'),
      reference: pageDraft.reference,
    }),
  })
  const externalLink = externalPixelLink(window.location.hash)
  if (externalLink) projectSession?.reviewExternalPixels?.(externalLink)
  else projectSession?.restoreLastProject?.()
  root.addEventListener('click', blockProductActions)
  root.addEventListener('submit', (event) => event.preventDefault())
  window.addEventListener('resize', () => {
    const skill = document.querySelector('.vnext-skill-pop')
    if (skill && !skill.hidden) placeSkillPop()
  })
}

if (typeof document !== 'undefined') {
  bootVnextPreview(document)
}
