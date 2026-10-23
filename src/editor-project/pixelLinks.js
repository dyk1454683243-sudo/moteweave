const fail = message => { throw Object.assign(new Error(message), { code: 'unsupported_input' }) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// Links are explicit, document-local identities. Equal immutable blocks alone
// never imply a relationship (including independently copied blank cels).
export function assertPixelLinks(manifest) {
  if (!Object.hasOwn(manifest, 'links')) return
  const links = manifest.links
  if (!record(links) || Object.keys(links).length !== 2 || !Array.isArray(links.copy_layers) || !record(links.groups)) fail('Invalid linked cel metadata.')
  if (links.copy_layers.length > manifest.layer_order.length || new Set(links.copy_layers).size !== links.copy_layers.length
    || links.copy_layers.some(value => !id(value) || !Object.hasOwn(manifest.layers, value))) fail('Invalid linked-copy layer preference.')
  const owned = new Set(), groups = Object.entries(links.groups), celCount = Object.keys(manifest.cels).length
  if (groups.length > celCount) fail('Too many linked cel groups.')
  for (const [groupId, members] of groups) {
    if (!id(groupId) || !Array.isArray(members) || !members.length || members.length > celCount) fail('Invalid linked cel group.')
    let first
    for (const member of members) {
      if (!id(member) || !Object.hasOwn(manifest.cels, member) || owned.has(member)) fail('Invalid or repeated linked cel member.')
      owned.add(member)
      const cel = manifest.cels[member]
      if (first && (cel.layer_id !== first.layer_id || (cel.block?.sha256 || null) !== (first.block?.sha256 || null)
        || (cel.block?.w || null) !== (first.block?.w || null) || (cel.block?.h || null) !== (first.block?.h || null))) fail('Linked cels must share one layer and identical pixels.')
      first = cel
    }
  }
}

export function pixelLinkScope(manifest, celId) {
  for (const [group_id, members] of Object.entries(manifest.links?.groups || {})) {
    if (members.includes(celId)) return { group_id, cel_ids: [...members].sort() }
  }
  return null
}

export function linkedCopyEnabled(manifest, layerId) {
  return manifest.links?.copy_layers.includes(layerId) || false
}

export function prunePixelLinks(manifest) {
  if (!manifest.links) return
  manifest.links.copy_layers = manifest.links.copy_layers.filter(layerId => Object.hasOwn(manifest.layers, layerId))
  for (const [groupId, members] of Object.entries(manifest.links.groups)) {
    const kept = members.filter(celId => Object.hasOwn(manifest.cels, celId))
    if (kept.length) manifest.links.groups[groupId] = kept
    else delete manifest.links.groups[groupId]
  }
}
