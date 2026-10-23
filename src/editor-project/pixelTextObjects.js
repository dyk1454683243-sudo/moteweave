const fail = (message, code = 'unsupported_input') => { throw Object.assign(new Error(message), { code }) }
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const ownMember = (map, order, id) => idOk(id) && Array.isArray(order) && order.includes(id) && Object.hasOwn(map || {}, id)
const layerOf = (manifest, id) => ownMember(manifest.layers, manifest.layer_order, id) ? manifest.layers[id] : null

export function assertTextObjects(manifest) {
  if (!Object.hasOwn(manifest, 'text_objects')) return manifest
  const value = manifest.text_objects
  if (!exact(value, ['version', 'items']) || value.version !== 1 || !Array.isArray(value.items) || value.items.length > 32) {
    fail('Unsupported text objects.')
  }
  const seen = new Set()
  for (const item of value.items) {
    if (!exact(item, ['id', 'frame_id', 'layer_id', 'text', 'x', 'y', 'size', 'font', 'bold', 'italic', 'antialias', 'mode', 'stroke_width', 'color'])) fail('Unsupported text object.')
    if (!idOk(item.id) || seen.has(item.id) || !ownMember(manifest.frames, manifest.frame_order, item.frame_id) || !layerOf(manifest, item.layer_id)) fail('Text object target is invalid.')
    seen.add(item.id)
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 160 || item.text.replace(/\r\n?/g, '\n').split('\n').length > 4) fail('Text must be 1–160 characters and at most 4 lines.')
    if (![item.x, item.y].every(Number.isSafeInteger)) fail('Text position must use safe integer coordinates.')
    if (!Number.isSafeInteger(item.size) || item.size < 6 || item.size > 96) fail('Text size must be 6–96.')
    if (!exact(item.font, ['kind', 'name']) || (item.font.kind === 'generic' && !['sans-serif', 'serif', 'monospace'].includes(item.font.name))
      || (item.font.kind === 'local' && (typeof item.font.name !== 'string' || !item.font.name || item.font.name.length > 200 || /[\u0000-\u001f\u007f]/.test(item.font.name)))
      || !['generic', 'local'].includes(item.font.kind)) fail('Text font reference is invalid.')
    if ([item.bold, item.italic, item.antialias].some(flag => typeof flag !== 'boolean') || !['fill', 'stroke', 'both'].includes(item.mode)) fail('Text style is invalid.')
    if (!Number.isSafeInteger(item.stroke_width) || item.stroke_width < 1 || item.stroke_width > 8 || !/^#[0-9a-f]{8}$/.test(item.color)) fail('Text style is invalid.')
  }
  return manifest
}

export function pruneTextObjects(manifest, kind, id) {
  if (!manifest.text_objects) return
  manifest.text_objects.items = manifest.text_objects.items.filter(item => item[`${kind}_id`] !== id)
  if (!manifest.text_objects.items.length) delete manifest.text_objects
}

export function applyTextCommand(manifest, command, idFor) {
  const next = structuredClone(manifest)
  next.text_objects ||= { version: 1, items: [] }
  if (command.type === 'delete-text') {
    const current = next.text_objects.items.find(item => item.id === command.id)
    if (!current) fail('Text object was not found.')
    if (layerOf(next, current.layer_id)?.locked) fail('Unlock the layer before editing text.')
    next.text_objects.items = next.text_objects.items.filter(item => item.id !== command.id)
  } else {
    const target = layerOf(next, command.layer_id)
    if (!target || !ownMember(next.frames, next.frame_order, command.frame_id)) fail('Text object target is invalid.')
    const current = command.id ? next.text_objects.items.find(item => item.id === command.id) : null
    if (current && layerOf(next, current.layer_id)?.locked) fail('Unlock the layer before editing text.')
    if (target.locked) fail('Unlock the layer before editing text.')
    const item = {
      id: command.id || idFor('text'), frame_id: command.frame_id, layer_id: command.layer_id, text: command.text,
      x: command.x, y: command.y, size: command.size, font: { ...command.font }, bold: command.bold, italic: command.italic,
      antialias: command.antialias, mode: command.mode, stroke_width: command.stroke_width, color: command.color,
    }
    if (next.text_objects.items.some(entry => entry.id === item.id) && !command.id) fail('Text object identity collision.')
    const index = next.text_objects.items.findIndex(entry => entry.id === item.id)
    if (index < 0) next.text_objects.items.push(item)
    else next.text_objects.items[index] = item
  }
  if (!next.text_objects.items.length) delete next.text_objects
  assertTextObjects(next)
  return next
}
