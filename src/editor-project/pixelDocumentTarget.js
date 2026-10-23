// Identity resolution shared by the local editor and the document store.
export function pixelDocumentTarget(manifest, target, { writable = false } = {}) {
  const fail = message => { throw Object.assign(new Error(message), { code: 'unsupported_input' }) }
  const frames = manifest?.frame_order || [], layers = manifest?.layer_order || []
  if (!target && (frames.length !== 1 || layers.length !== 1)) fail('Choose an explicit frame and layer.')
  const frameId = target?.frame_id || frames[0], layerId = target?.layer_id || layers[0]
  const matches = Object.values(manifest?.cels || {}).filter(c => c.frame_id === frameId && c.layer_id === layerId)
  const cel = matches[0], layer = manifest?.layers?.[layerId]
  if (!frames.includes(frameId) || !layers.includes(layerId) || !layer || matches.length !== 1
    || (target && cel.id !== target.cel_id)) fail('The frame, layer and cel must belong to this document.')
  if (writable && layer.locked) fail('The selected layer is locked.')
  if (cel.block && (cel.block.w !== manifest.canvas.w || cel.block.h !== manifest.canvas.h)) fail('Only complete RGBA cels are supported.')
  return { cel, layer, target: { frame_id: frameId, layer_id: layerId, cel_id: cel.id } }
}

export function pixelRectInside(rect, bounds) {
  return rect && ['x', 'y', 'w', 'h'].every(k => Number.isSafeInteger(rect[k]))
    && rect.w > 0 && rect.h > 0 && rect.x >= bounds.x && rect.y >= bounds.y
    && rect.x + rect.w <= bounds.x + bounds.w && rect.y + rect.h <= bounds.y + bounds.h
}
