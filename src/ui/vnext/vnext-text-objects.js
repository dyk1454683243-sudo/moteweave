import { createPixelText, pixelTextBounds, pixelTextFits, pixelTextLineStep } from '../../editor-project/pixelDrawingTools.js'
import { compositePixelBuffers } from '../../editor-project/pixelStructure.js'

const layerCaches = new WeakMap()
export function rememberLayerPixels(manifest, frameId, layers) {
  const frames = layerCaches.get(manifest) || new Map()
  frames.set(frameId, layers)
  layerCaches.set(manifest, frames)
}
export function cachedTextLayerPixels(manifest, frameId) {
  return layerCaches.get(manifest)?.get(frameId) || null
}
export function recompositeFrame(manifest, frameId, familyFor, patchItem = null) {
  const layers = cachedTextLayerPixels(manifest, frameId)
  if (!layers) return null
  const blocks = new Map()
  for (const cel of Object.values(manifest.cels || {})) {
    if (cel.frame_id === frameId && layers.has(cel.layer_id)) blocks.set(cel.id, layers.get(cel.layer_id))
  }
  const view = patchItem ? { ...manifest, text_objects: { version: 1, items: (manifest.text_objects?.items || []).map(item => item.id === patchItem.id ? { ...item, ...patchItem } : item) } } : manifest
  return compositePixelBuffers(view, frameId, blocks, (rgba, layerId) => paintLayerText(rgba, view, frameId, layerId, familyFor))
}

export function textObjectProps(item) {
  return {
    text: item.text, fontId: item.font.kind === 'generic' ? item.font.name : `local:${item.font.name}`,
    family: item.font.kind === 'generic' ? item.font.name : item.font.name,
    size: item.size, bold: item.bold, italic: item.italic, antialias: item.antialias,
    mode: item.mode, strokeWidth: item.stroke_width, x: item.x, y: item.y,
    color: item.color.slice(1).match(/../g).map(byte => parseInt(byte, 16)),
  }
}

export function textObjectCommand(props, { id, frameId, layerId, fontName, fontKind }) {
  const color = props.color.map(value => value.toString(16).padStart(2, '0')).join('')
  return {
    type: 'upsert-text', id, frame_id: frameId, layer_id: layerId, text: props.text,
    x: props.x, y: props.y, size: props.size,
    font: { kind: fontKind, name: fontName },
    bold: props.bold, italic: props.italic, antialias: props.antialias,
    mode: props.mode, stroke_width: props.strokeWidth, color: `#${color}`,
  }
}

export function textObjectsForFrame(manifest, frameId, layerId = null) {
  return (manifest?.text_objects?.items || []).filter(item => item.frame_id === frameId && (layerId == null || item.layer_id === layerId) && manifest.layers?.[item.layer_id]?.visible !== false)
}

export function textAxisLimit(axis, width, height) {
  return Math.max(0, (axis === 'y' ? height : width) - 1)
}

export function paintLayerText(rgba, manifest, frameId, layerId, familyFor, { requireFonts = false } = {}) {
  const items = textObjectsForFrame(manifest, frameId, layerId)
  if (!items.length) return rgba
  const missing = items.find(item => !familyFor?.(item))
  if (missing && requireFonts) throw new Error(`Font “${missing.font.name}” is not available. The text object was kept.`)
  const ready = items.filter(item => familyFor?.(item))
  if (!ready.length) return rgba
  let next = rgba
  for (const item of ready) {
    try { next = compositeTextObjects(next, manifest.canvas.w, manifest.canvas.h, [item], familyFor) }
    catch (error) {
      if (requireFonts || !/does not fit/.test(error.message || '')) throw error
    }
  }
  return next
}

export function textPlacementFits(item, width, height, family = null, makeCanvas) {
  if (!item || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return false
  const resolved = family || (item.font?.kind === 'generic' ? item.font.name : null)
  if (!resolved) return false
  return pixelTextFits(
    { x: item.x, y: item.y },
    item.text,
    item.size,
    width,
    height,
    { family: resolved, bold: Boolean(item.bold), italic: Boolean(item.italic), mode: item.mode || 'fill', strokeWidth: item.stroke_width || 1 },
    makeCanvas,
  )
}

export function textObjectBounds(item, family = null) {
  const resolved = family || (item.font?.kind === 'generic' ? item.font.name : null)
  if (resolved) {
    try { return pixelTextBounds({ x: item.x, y: item.y }, item.text, item.size, { family: resolved, bold: item.bold, italic: item.italic, mode: item.mode, strokeWidth: item.stroke_width }) }
    catch { /* measurement unavailable: keep a full-em box so CJK is not cut */ }
  }
  const lines = String(item.text || '').replace(/\r\n?/g, '\n').split('\n')
  const width = Math.max(item.size, ...lines.map(line => Math.ceil([...line].length * item.size)))
  const step = pixelTextLineStep(item.size, { mode: item.mode, strokeWidth: item.stroke_width })
  return { x: item.x, y: item.y, w: width, h: step * lines.length, step }
}

export function textObjectAt(items, point, familyFor = null) {
  return [...items].reverse().find(item => {
    const box = textObjectBounds(item, familyFor?.(item))
    return point.x >= box.x - 1 && point.y >= box.y - 1 && point.x < box.x + box.w + 1 && point.y < box.y + box.h + 1
  }) || null
}

export function compositeTextObjects(bytes, width, height, items, familyFor = item => item.font.name) {
  let next = bytes
  for (const item of items) {
    const family = familyFor(item)
    if (!family) throw new Error(`Font “${item.font.name}” is not available. The text object was kept.`)
    const drawn = createPixelText({ width, height, rgba: next }, textObjectProps(item).color, { x: item.x, y: item.y }, item.text, item.size, undefined, {
      family, bold: item.bold, italic: item.italic, antialias: item.antialias, mode: item.mode, strokeWidth: item.stroke_width,
    })
    next = drawn.bytes
  }
  return next
}
