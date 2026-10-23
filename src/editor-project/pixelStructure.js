import { pixelDocumentTarget } from './pixelDocumentTarget.js'
import { isEditablePixelDocument } from './pixelDocumentOrigin.js'
import { assertPixelLinks, linkedCopyEnabled, pixelLinkScope, prunePixelLinks } from './pixelLinks.js'
import { applyTextCommand, assertTextObjects, pruneTextObjects } from './pixelTextObjects.js'
import { pixelTextBounds, pixelTextLineStep } from './pixelDrawingTools.js'

const fail = (message, code = 'unsupported_input') => { throw Object.assign(new Error(message), { code }) }
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export const PIXEL_STRUCTURE_FIELDS = ['frame_order', 'layer_order', 'frames', 'layers', 'cels', 'links', 'text_objects', 'tags']
export const TAG_DIRECTIONS = Object.freeze(['forward', 'reverse', 'pingpong'])

export function assertPixelTags(manifest) {
  if (!Object.hasOwn(manifest, 'tags') || manifest.tags == null) return manifest
  if (!Array.isArray(manifest.tags)) fail('Documents with unsupported tags or anchors cannot be reordered or reduced yet.')
  if (manifest.tags.length > 32) fail('The document already has 32 animation tags.', 'resource_limit')
  const seen = new Set()
  for (const tag of manifest.tags) {
    if (!exact(tag, ['id', 'name', 'from_frame_id', 'to_frame_id', 'direction'])) {
      fail('Documents with unsupported tags or anchors cannot be reordered or reduced yet.')
    }
    if (!idOk(tag.id) || seen.has(tag.id)) fail('Animation tag identity is invalid.')
    seen.add(tag.id)
    if (typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 64 || /[\u0000-\u001f\u007f]/.test(tag.name)) {
      fail('Animation tag name must contain 1–64 characters.')
    }
    const fromIdx = manifest.frame_order?.indexOf(tag.from_frame_id) ?? -1
    const toIdx = manifest.frame_order?.indexOf(tag.to_frame_id) ?? -1
    if (fromIdx < 0 || toIdx < 0 || !Object.hasOwn(manifest.frames || {}, tag.from_frame_id) || !Object.hasOwn(manifest.frames || {}, tag.to_frame_id) || fromIdx > toIdx) {
      fail('Animation tag frame range is invalid.')
    }
    if (!TAG_DIRECTIONS.includes(tag.direction)) fail('Animation tag playback direction is invalid.')
  }
  return manifest
}

export function transformCanvasRgba(rgba, oldW, oldH, newW, newH, offsetX, offsetY) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== oldW * oldH * 4) fail('Invalid source pixel buffer.')
  const next = new Uint8Array(newW * newH * 4)
  const srcStartX = Math.max(0, -offsetX)
  const srcEndX = Math.min(oldW, newW - offsetX)
  const srcStartY = Math.max(0, -offsetY)
  const srcEndY = Math.min(oldH, newH - offsetY)
  if (srcEndX > srcStartX && srcEndY > srcStartY) {
    const copyBytes = (srcEndX - srcStartX) * 4
    const dstStartX = srcStartX + offsetX
    for (let srcY = srcStartY; srcY < srcEndY; srcY += 1) {
      const dstY = srcY + offsetY
      const srcOffset = (srcY * oldW + srcStartX) * 4
      const dstOffset = (dstY * newW + dstStartX) * 4
      next.set(rgba.subarray(srcOffset, srcOffset + copyBytes), dstOffset)
    }
  }
  return next
}

export const CANVAS_ANCHORS = Object.freeze([
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
])

export function anchorCanvasOffsets(oldW, oldH, newW, newH, anchor = 'center') {
  const dw = newW - oldW
  const dh = newH - oldH
  let offset_x = Math.floor(dw / 2)
  let offset_y = Math.floor(dh / 2)
  if (anchor.endsWith('left')) offset_x = 0
  else if (anchor.endsWith('right')) offset_x = dw
  if (anchor.startsWith('top')) offset_y = 0
  else if (anchor.startsWith('bottom')) offset_y = dh
  return { offset_x, offset_y }
}

function resolveBlockReader(getBlockBytes) {
  if (typeof getBlockBytes === 'function') return getBlockBytes
  if (getBlockBytes instanceof Map) return (block) => getBlockBytes.get(block?.sha256) || null
  return () => null
}

function measureTextObjectGlyphExtents(item, anchor, options = {}) {
  const resolved = options.familyFor?.(item) || (item?.font?.kind === 'generic' ? item.font.name : null)
  if (resolved) {
    try {
      return pixelTextBounds(
        anchor,
        item.text,
        item.size,
        {
          family: resolved,
          bold: Boolean(item.bold),
          italic: Boolean(item.italic),
          mode: item.mode || 'fill',
          strokeWidth: item.stroke_width || 1,
        },
        options.makeCanvas,
      )
    } catch {
      /* fallback when 2D canvas measurement is unavailable */
    }
  }
  const lines = String(item?.text || '').replace(/\r\n?/g, '\n').split('\n')
  const width = Math.max(item?.size || 1, ...lines.map(line => Math.ceil([...line].length * (item?.size || 1))))
  const step = pixelTextLineStep(item?.size || 6, { mode: item?.mode || 'fill', strokeWidth: item?.stroke_width || 1 })
  return { x: anchor.x, y: anchor.y, w: width, h: step * lines.length, step }
}

export function inspectCanvasResizeImpact(manifest, getBlockBytes, options = {}) {
  const oldW = manifest?.canvas?.w || 0
  const oldH = manifest?.canvas?.h || 0
  const width = options.width ?? oldW
  const height = options.height ?? oldH
  const anchored = options.anchor
    ? anchorCanvasOffsets(oldW, oldH, width, height, options.anchor)
    : { offset_x: 0, offset_y: 0 }
  const offset_x = Number.isFinite(options.offset_x)
    ? options.offset_x
    : Number.isFinite(options.offsetX)
      ? options.offsetX
      : anchored.offset_x
  const offset_y = Number.isFinite(options.offset_y)
    ? options.offset_y
    : Number.isFinite(options.offsetY)
      ? options.offsetY
      : anchored.offset_y
  const readBytes = resolveBlockReader(getBlockBytes)
  let clippedPixelCount = 0
  let affectedCelCount = 0
  const affectedFrameIds = new Set()
  const affectedLayerIds = new Set()
  const linkedGroupIds = new Set()
  for (const cel of Object.values(manifest?.cels || {})) {
    if (!cel?.block) continue
    const group = pixelLinkScope(manifest, cel.id)
    if (group) linkedGroupIds.add(group.group_id)
    const bytes = readBytes(cel.block, cel)
    if (!(bytes instanceof Uint8Array) || bytes.length !== oldW * oldH * 4) continue
    let celClipped = 0
    for (let y = 0; y < oldH; y += 1) {
      const dstY = y + offset_y
      const outY = dstY < 0 || dstY >= height
      const rowOffset = y * oldW * 4
      for (let x = 0; x < oldW; x += 1) {
        if (bytes[rowOffset + x * 4 + 3] === 0) continue
        const dstX = x + offset_x
        if (outY || dstX < 0 || dstX >= width) celClipped += 1
      }
    }
    if (celClipped > 0) {
      clippedPixelCount += celClipped
      affectedCelCount += 1
      affectedFrameIds.add(cel.frame_id)
      affectedLayerIds.add(cel.layer_id)
    }
  }
  let outsideTextCount = 0
  for (const item of manifest?.text_objects?.items || []) {
    if (!String(item?.text || '').trim()) continue
    if (manifest?.layers?.[item.layer_id]?.visible === false) continue
    const nextX = item.x + offset_x
    const nextY = item.y + offset_y
    const box = measureTextObjectGlyphExtents(item, { x: nextX, y: nextY }, options)
    if (box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height) {
      outsideTextCount += 1
    }
  }
  const affectedFrameNumbers = [...affectedFrameIds]
    .map(fid => (manifest?.frame_order?.indexOf(fid) ?? -1) + 1)
    .filter(n => n > 0)
    .sort((a, b) => a - b)
  return {
    offset_x,
    offset_y,
    offsetX: offset_x,
    offsetY: offset_y,
    clippedPixelCount,
    affectedCelCount,
    clippedCelCount: affectedCelCount,
    affectedFrameCount: affectedFrameIds.size,
    affectedFrameNumbers,
    affectedLayerCount: affectedLayerIds.size,
    linkedGroupCount: linkedGroupIds.size,
    outsideTextCount,
    clippedTextCount: outsideTextCount,
    clipsPixels: clippedPixelCount > 0,
    clipsText: outsideTextCount > 0,
    clipsContent: clippedPixelCount > 0 || outsideTextCount > 0,
  }
}

export function computeCanvasContentBounds(manifest, getBlockBytes) {
  const oldW = manifest?.canvas?.w || 0
  const oldH = manifest?.canvas?.h || 0
  const readBytes = resolveBlockReader(getBlockBytes)
  let minX = oldW, minY = oldH, maxX = -1, maxY = -1
  for (const cel of Object.values(manifest?.cels || {})) {
    if (!cel?.block) continue
    const bytes = readBytes(cel.block, cel)
    if (!(bytes instanceof Uint8Array) || bytes.length !== oldW * oldH * 4) continue
    for (let y = 0; y < oldH; y += 1) {
      const rowOffset = y * oldW * 4
      for (let x = 0; x < oldW; x += 1) {
        if (bytes[rowOffset + x * 4 + 3] === 0) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  return {
    x: minX,
    y: minY,
    w: width,
    h: height,
    width,
    height,
    offset_x: -minX,
    offset_y: -minY,
  }
}

// Only the existing full-canvas raster representation is editable. Unknown
// rendering semantics must not be flattened into a deceptively equivalent copy.
export function assertPixelStructure(manifest, { derived = false, project = null } = {}) {
  if (derived && !isEditablePixelDocument(manifest, project)) fail('Create a working copy before editing its structure.')
  if (!manifest.frame_order?.length || !manifest.layer_order?.length || manifest.frame_order.length > 256 || manifest.layer_order.length > 32) fail('Unsupported document structure.')
  for (const id of manifest.frame_order) if (!exact(manifest.frames[id], ['id', 'duration_ms'])) fail('Unsupported frame fields.')
  for (const id of manifest.layer_order) {
    const layer = manifest.layers[id]
    if (!exact(layer, ['id', 'name', 'kind', 'visible', 'locked']) || layer.kind !== 'raster') fail('Unsupported layer fields.')
  }
  if (Object.keys(manifest.cels).length !== manifest.frame_order.length * manifest.layer_order.length) fail('Every frame and layer must have one explicit cel.')
  for (const cel of Object.values(manifest.cels)) {
    if (!exact(cel, ['id', 'frame_id', 'layer_id', 'block']) || (cel.block && !exact(cel.block, ['sha256', 'w', 'h']))) fail('Unsupported cel fields.')
    pixelDocumentTarget(manifest, { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id })
  }
  assertPixelLinks(manifest)
  assertTextObjects(manifest)
  assertPixelTags(manifest)
  return manifest
}

export function validateStructureCommand(command) {
  const fields = {
    'add-layer': ['type', 'name'], 'rename-layer': ['type', 'layer_id', 'name'],
    'set-visible': ['type', 'layer_id', 'value'], 'set-locked': ['type', 'layer_id', 'value'],
    'set-layer-link-copies': ['type', 'layer_id', 'value'],
    'link-cels': ['type', 'layer_id', 'source_frame_id', 'target_frame_id'],
    'unlink-cel': ['type', 'layer_id', 'frame_id'],
    'add-frame': ['type'], 'copy-frame': ['type', 'frame_id'], 'set-duration': ['type', 'frame_id', 'duration_ms'],
    'delete-frame': ['type', 'frame_id'], 'delete-layer': ['type', 'layer_id'],
    'move-frame': ['type', 'frame_id', 'index'], 'move-layer': ['type', 'layer_id', 'index'],
    'add-tag': ['type', 'name', 'from_frame_id', 'to_frame_id', 'direction'],
    'update-tag': ['type', 'tag_id', 'name', 'from_frame_id', 'to_frame_id', 'direction'],
    'delete-tag': ['type', 'tag_id'],
    'resize-canvas': ['type', 'width', 'height', 'offset_x', 'offset_y'],
    'upsert-text': ['type', 'id', 'frame_id', 'layer_id', 'text', 'x', 'y', 'size', 'font', 'bold', 'italic', 'antialias', 'mode', 'stroke_width', 'color'],
    'delete-text': ['type', 'id'],
  }[command?.type]
  if (!fields || !exact(command, fields)) fail('Unsupported structure command.')
  if (command.type === 'add-tag' || command.type === 'update-tag') {
    if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 64 || /[\u0000-\u001f\u007f]/.test(command.name)) {
      fail('Animation tag name must contain 1–64 characters.')
    }
    if (!TAG_DIRECTIONS.includes(command.direction)) fail('Animation tag playback direction is invalid.')
  } else if ('name' in command && (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 120)) {
    fail('Layer name must contain 1–120 characters.')
  }
  if ('value' in command && typeof command.value !== 'boolean') fail('Layer state must be a boolean.')
  if ('duration_ms' in command && (!Number.isSafeInteger(command.duration_ms) || command.duration_ms < 1 || command.duration_ms > 60000)) fail('Frame duration must be 1–60000 ms.')
  if ('index' in command && (!Number.isSafeInteger(command.index) || command.index < 0)) fail('Invalid destination position.')
  if (command.type === 'resize-canvas') {
    for (const key of ['width', 'height']) {
      if (!Number.isSafeInteger(command[key]) || command[key] < 1) fail('Canvas width and height must be positive integers.')
      if (command[key] > 1024) fail('Canvas edge cannot exceed 1024 px.', 'resource_limit')
    }
    for (const key of ['offset_x', 'offset_y']) {
      if (!Number.isSafeInteger(command[key]) || command[key] < -4096 || command[key] > 4096) fail('Canvas offset must be an integer within ±4096 px.')
    }
  }
  for (const key of ['frame_id', 'layer_id', 'source_frame_id', 'target_frame_id', 'tag_id']) {
    if (key in command && !idOk(command[key])) fail('Invalid document target.')
  }
  return command
}

export function applyStructureCommand(manifest, command, idFor, { project = null, blockMap = null } = {}) {
  assertPixelStructure(manifest, { derived: true, project }); validateStructureCommand(command)
  if (command.type === 'upsert-text' || command.type === 'delete-text') return applyTextCommand(manifest, command, idFor)
  const next = structuredClone(manifest)
  const owns = (map, order, id) => typeof id === 'string' && Object.hasOwn(map || {}, id) && order?.includes(id)
  const layer = owns(next.layers, next.layer_order, command.layer_id) ? next.layers[command.layer_id] : null
  const frame = owns(next.frames, next.frame_order, command.frame_id) ? next.frames[command.frame_id] : null
  if (command.layer_id && !layer || command.frame_id && !frame) fail('The requested layer or frame does not exist.')
  const structural = /^(delete|move)-(frame|layer)$/.test(command.type)
  if (structural && manifest.anchors?.length) fail('Documents with tags or anchors cannot be reordered or reduced yet.')
  if (structural && layer?.locked) fail('Unlock the layer before moving or deleting it.')
  if (command.type === 'delete-frame' && Object.values(manifest.layers).some(value => value.locked)) fail('Unlock all layers before deleting a frame.')
  if (command.type === 'set-layer-link-copies' && layer.locked) fail('Unlock the layer before changing Link copies.')
  if ((command.type === 'link-cels' || command.type === 'unlink-cel') && layer.locked) fail('Unlock the layer before linking or unlinking cels.')
  if (command.type === 'resize-canvas' && Object.values(manifest.layers).some(value => value.locked)) fail('Unlock all layers before resizing or cropping the canvas.')
  if (command.type === 'copy-frame' && next.layer_order.some(id => next.layers[id].locked && linkedCopyEnabled(next, id))) fail('Unlock linked-copy layers before copying a frame.')
  const addCel = (frameId, layerId, block = null) => {
    const id = idFor(`cel:${frameId}:${layerId}`)
    if (next.cels[id]) fail('Cel identity collision.')
    next.cels[id] = { id, frame_id: frameId, layer_id: layerId, block: block ? { ...block } : null }
    return id
  }
  if (command.type === 'add-layer') {
    if (next.layer_order.length >= 32) fail('The document already has 32 layers.', 'resource_limit')
    const id = idFor('layer'); if (next.layers[id]) fail('Layer identity collision.')
    next.layer_order.unshift(id)
    next.layers[id] = { id, name: command.name.trim(), kind: 'raster', visible: true, locked: false }
    for (const frameId of next.frame_order) addCel(frameId, id)
  } else if (command.type === 'rename-layer') layer.name = command.name.trim()
  else if (command.type === 'set-visible') layer.visible = command.value
  else if (command.type === 'set-locked') layer.locked = command.value
  else if (command.type === 'set-layer-link-copies') {
    next.links ||= { copy_layers: [], groups: {} }
    next.links.copy_layers = next.links.copy_layers.filter(id => id !== layer.id)
    if (command.value) next.links.copy_layers.push(layer.id)
  } else if (command.type === 'link-cels') {
    if (!owns(next.frames, next.frame_order, command.source_frame_id) || !owns(next.frames, next.frame_order, command.target_frame_id)) {
      fail('The requested layer or frame does not exist.')
    }
    if (command.source_frame_id === command.target_frame_id) fail('Select two different frames to link cels.')
    const sourceCel = Object.values(next.cels).find(c => c.frame_id === command.source_frame_id && c.layer_id === layer.id)
    const targetCel = Object.values(next.cels).find(c => c.frame_id === command.target_frame_id && c.layer_id === layer.id)
    if (!sourceCel || !targetCel) fail('The requested cel does not exist.')
    next.links ||= { copy_layers: [], groups: {} }
    const sourceGroup = pixelLinkScope(next, sourceCel.id)
    const targetGroup = pixelLinkScope(next, targetCel.id)
    if (!sourceGroup || sourceGroup.group_id !== targetGroup?.group_id) {
      if (targetGroup) {
        const remaining = next.links.groups[targetGroup.group_id].filter(id => id !== targetCel.id)
        if (remaining.length >= 2) next.links.groups[targetGroup.group_id] = remaining
        else delete next.links.groups[targetGroup.group_id]
      }
      targetCel.block = sourceCel.block ? { ...sourceCel.block } : null
      if (sourceGroup && next.links.groups[sourceGroup.group_id]) {
        if (!next.links.groups[sourceGroup.group_id].includes(targetCel.id)) {
          next.links.groups[sourceGroup.group_id].push(targetCel.id)
        }
      } else {
        const groupId = idFor(`link:${sourceCel.id}:${targetCel.id}`)
        if (Object.hasOwn(next.links.groups, groupId)) fail('Linked group identity collision.')
        next.links.groups[groupId] = [sourceCel.id, targetCel.id]
      }
    }
  } else if (command.type === 'unlink-cel') {
    const cel = Object.values(next.cels).find(c => c.frame_id === frame.id && c.layer_id === layer.id)
    const group = cel ? pixelLinkScope(next, cel.id) : null
    if (!group || !next.links?.groups?.[group.group_id]) fail('The selected cel is not linked.')
    const remaining = next.links.groups[group.group_id].filter(id => id !== cel.id)
    if (remaining.length >= 2) next.links.groups[group.group_id] = remaining
    else delete next.links.groups[group.group_id]
  } else if (command.type === 'add-tag' || command.type === 'update-tag') {
    if (!owns(next.frames, next.frame_order, command.from_frame_id) || !owns(next.frames, next.frame_order, command.to_frame_id)) {
      fail('Animation tag frame range is invalid.')
    }
    if (next.frame_order.indexOf(command.from_frame_id) > next.frame_order.indexOf(command.to_frame_id)) {
      fail('Animation tag start frame must not come after its end frame.')
    }
    next.tags = Array.isArray(next.tags) ? [...next.tags] : []
    if (command.type === 'add-tag') {
      if (next.tags.length >= 32) fail('The document already has 32 animation tags.', 'resource_limit')
      const id = idFor('tag')
      if (!idOk(id) || next.tags.some(tag => tag.id === id)) fail('Animation tag identity collision.')
      next.tags.push({
        id,
        name: command.name.trim(),
        from_frame_id: command.from_frame_id,
        to_frame_id: command.to_frame_id,
        direction: command.direction,
      })
    } else {
      const idx = next.tags.findIndex(tag => tag.id === command.tag_id)
      if (idx < 0) fail('Animation tag was not found.')
      next.tags[idx] = {
        id: command.tag_id,
        name: command.name.trim(),
        from_frame_id: command.from_frame_id,
        to_frame_id: command.to_frame_id,
        direction: command.direction,
      }
    }
  } else if (command.type === 'delete-tag') {
    next.tags = Array.isArray(next.tags) ? [...next.tags] : []
    const idx = next.tags.findIndex(tag => tag.id === command.tag_id)
    if (idx < 0) fail('Animation tag was not found.')
    next.tags.splice(idx, 1)
  } else if (command.type === 'resize-canvas') {
    if (command.width === next.canvas.w && command.height === next.canvas.h && command.offset_x === 0 && command.offset_y === 0) {
      fail('Canvas size and offset are unchanged.')
    }
    const nonEmptyCelCount = Object.values(next.cels).filter(cel => Boolean(cel?.block)).length
    if (nonEmptyCelCount * command.width * command.height * 4 > 128 * 1024 * 1024) {
      fail('expanded RGBA exceeds 128MiB', 'resource_limit')
    }
    next.canvas = { w: command.width, h: command.height }
    for (const cel of Object.values(next.cels)) {
      if (!cel.block) continue
      const mapped = blockMap?.get(cel.block.sha256)
      if (!mapped || mapped.w !== command.width || mapped.h !== command.height) {
        fail('Transformed pixel block is required for non-empty cels.')
      }
      cel.block = { sha256: mapped.sha256, w: mapped.w, h: mapped.h }
    }
    if (next.text_objects?.items?.length && (command.offset_x !== 0 || command.offset_y !== 0)) {
      for (const item of next.text_objects.items) {
        item.x += command.offset_x
        item.y += command.offset_y
      }
    }
  } else if (command.type === 'set-duration') frame.duration_ms = command.duration_ms
  else if (structural) {
    const kind = frame ? 'frame' : 'layer', id = command[`${kind}_id`], order = next[`${kind}_order`]
    if (command.type.startsWith('delete-')) {
      if (order.length === 1) fail(`Keep at least one ${kind}.`)
      const oldOrder = [...order]
      order.splice(order.indexOf(id), 1)
      delete next[`${kind}s`][id]
      for (const [celId, cel] of Object.entries(next.cels)) if (cel[`${kind}_id`] === id) delete next.cels[celId]
      prunePixelLinks(next)
      pruneTextObjects(next, kind, id)
      if (kind === 'frame' && Array.isArray(next.tags) && next.tags.length) {
        const updatedTags = []
        for (const tag of next.tags) {
          const fromIdx = oldOrder.indexOf(tag.from_frame_id)
          const toIdx = oldOrder.indexOf(tag.to_frame_id)
          const kept = oldOrder.slice(fromIdx, toIdx + 1).filter(frameId => frameId !== id)
          if (kept.length > 0) {
            updatedTags.push({ ...tag, from_frame_id: kept[0], to_frame_id: kept[kept.length - 1] })
          }
        }
        next.tags = updatedTags
      }
    } else {
      if (command.index >= order.length) fail('Invalid destination position.')
      order.splice(order.indexOf(id), 1); order.splice(command.index, 0, id)
      if (kind === 'frame' && Array.isArray(next.tags) && next.tags.length) {
        next.tags = next.tags.map(tag => {
          const fromIdx = order.indexOf(tag.from_frame_id)
          const toIdx = order.indexOf(tag.to_frame_id)
          return fromIdx <= toIdx ? tag : { ...tag, from_frame_id: tag.to_frame_id, to_frame_id: tag.from_frame_id }
        })
      }
    }
  }
  else {
    if (next.frame_order.length >= 256) fail('The document already has 256 frames.', 'resource_limit')
    const id = idFor('frame'); if (next.frames[id]) fail('Frame identity collision.')
    next.frame_order.push(id)
    next.frames[id] = { id, duration_ms: command.type === 'copy-frame' ? frame.duration_ms : 125 }
    if (command.type === 'copy-frame') {
      const copies = (manifest.text_objects?.items || []).filter(item => item.frame_id === frame.id)
      if (copies.length) {
        next.text_objects ||= { version: 1, items: [...(next.text_objects?.items || [])] }
        if (next.text_objects.items.length + copies.length > 32) fail('The document already has 32 text objects.', 'resource_limit')
        for (const item of copies) {
          const textId = idFor(`text:${item.id}`)
          if (!textId || next.text_objects.items.some(entry => entry.id === textId)) fail('Text object identity collision.')
          next.text_objects.items.push({ ...structuredClone(item), id: textId, frame_id: id })
        }
      }
    }
    for (const layerId of next.layer_order) {
      const source = command.type === 'copy-frame' && Object.values(manifest.cels).find(c => c.frame_id === frame.id && c.layer_id === layerId)
      const celId = addCel(id, layerId, source?.block || null)
      if (source && linkedCopyEnabled(next, layerId)) {
        const group = pixelLinkScope(next, source.id)
        if (group) next.links.groups[group.group_id].push(celId)
        else {
          const groupId = idFor(`link:${source.id}`)
          if (Object.hasOwn(next.links.groups, groupId)) fail('Linked group identity collision.')
          next.links.groups[groupId] = [source.id, celId]
        }
      }
    }
  }
  assertPixelStructure(next, { derived: true, project })
  return next
}

// First layer is the top of the stack. Straight-alpha source-over with an
// explicit rounding rule is shared by the live preview and PNG export.
export async function compositePixelFrame(manifest, frameId, readBlock, onLayer = null, rememberLayers = null) {
  assertPixelStructure(manifest)
  const blocks = new Map()
  const layers = new Map()
  for (const cel of Object.values(manifest.cels)) {
    if (cel.frame_id !== frameId || !manifest.layers[cel.layer_id]?.visible || !cel.block) continue
    const bytes = await readBlock(cel.block, cel)
    blocks.set(cel.id, bytes)
    layers.set(cel.layer_id, bytes)
  }
  if (rememberLayers) rememberLayers(layers)
  return compositePixelBuffers(manifest, frameId, blocks, onLayer)
}

function blendOver(rgba, source) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = source[i + 3], b = rgba[i + 3], alpha = a * 255 + b * (255 - a)
    if (!a) continue
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round((source[i + c] * a * 255 + rgba[i + c] * b * (255 - a)) / alpha)
    rgba[i + 3] = Math.round(alpha / 255)
  }
}

export function compositePixelBuffers(manifest, frameId, blocks, onLayer = null) {
  assertPixelStructure(manifest)
  if (!Object.hasOwn(manifest.frames, frameId) || !manifest.frame_order.includes(frameId)) fail('Frame does not exist.')
  const rgba = new Uint8Array(manifest.canvas.w * manifest.canvas.h * 4)
  let first = true
  for (const layerId of [...manifest.layer_order].reverse()) {
    if (!manifest.layers[layerId].visible) continue
    const cel = Object.values(manifest.cels).find(c => c.frame_id === frameId && c.layer_id === layerId)
    const hasPixels = Boolean(cel && (cel.block || blocks.has(cel.id)))
    if (!hasPixels && !onLayer) continue
    let layerRgba = null
    if (hasPixels) {
      const source = blocks.get(cel.id)
      if (!(source instanceof Uint8Array) || source.length !== rgba.length) fail('Invalid layer pixels.')
      layerRgba = new Uint8Array(source)
    }
    if (onLayer) {
      const base = layerRgba || new Uint8Array(rgba.length)
      const painted = onLayer(base, layerId)
      if (painted instanceof Uint8Array && painted.length === rgba.length && painted !== base) {
        layerRgba = painted
      } else if (!layerRgba && base.some(v => v !== 0)) {
        layerRgba = base
      }
    }
    if (layerRgba) {
      if (first) rgba.set(layerRgba)
      else blendOver(rgba, layerRgba)
      first = false
    }
  }
  return rgba
}
