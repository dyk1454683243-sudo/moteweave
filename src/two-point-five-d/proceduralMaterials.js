const REQUIRED_RENDER_SLOTS = Object.freeze([
  'top_material',
  'side_material',
  'edge_material',
  'corner_material',
  'transition_detail',
  'shadow_material',
])

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_')
}

function svgEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function hashString(value) {
  let hash = 2166136261
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function materialAccentRects(material, { seed, patternSize }) {
  const accents = [material.highlight, material.shadow, material.detail].filter(Boolean)
  if (!accents.length) return []
  const rects = []
  let state = hashString(`${seed}:${material.id}`)
  for (let index = 0; index < 7; index += 1) {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0
    const size = index % 3 === 0 ? 2 : 1
    const maxX = Math.max(1, patternSize[0] - size + 1)
    const x = (state + index * 3) % maxX
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0
    const maxY = Math.max(1, patternSize[1] - size + 1)
    const y = (state + index * 5) % maxY
    const color = accents[index % accents.length]
    rects.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${svgEscape(color)}"/>`)
  }
  return rects
}

export function buildProceduralMaterialProfile(materials = {}) {
  const profile = materials.procedural_profile ?? {}
  const patternSize = profile.pattern_size ?? [16, 16]
  const materialEntries = Object.entries(profile.materials ?? {})
  const materialMap = Object.fromEntries(
    materialEntries.map(([id, value]) => [
      id,
      {
        id,
        pattern_id: `mat_${sanitizeId(id)}`,
        role: value.role ?? 'detail',
        base: value.base,
        highlight: value.highlight,
        shadow: value.shadow,
        detail: value.detail,
      },
    ])
  )
  const slots = Object.fromEntries(
    Object.entries(materials.slots ?? {}).map(([slot, materialId]) => [
      slot,
      {
        slot,
        material_id: materialId,
        pattern_id: materialMap[materialId]?.pattern_id ?? `mat_missing_${sanitizeId(materialId)}`,
        role: materialMap[materialId]?.role ?? 'missing',
      },
    ])
  )

  return {
    schema_version: 1,
    id: profile.id ?? 'procedural_material_profile',
    generator: profile.generator ?? 'procedural_material_v0',
    seed: profile.seed ?? 0,
    pattern_size: patternSize,
    required_slots: [...REQUIRED_RENDER_SLOTS],
    materials: materialMap,
    slots,
  }
}

export function materialFill(materialProfile, slotName, fallback = '#ff00ff') {
  const slot = materialProfile.slots[slotName]
  if (!slot || slot.role === 'missing') return fallback
  return `url(#${slot.pattern_id})`
}

export function renderProceduralMaterialDefs(materialProfile) {
  const [width, height] = materialProfile.pattern_size
  const patterns = Object.values(materialProfile.materials).map((material) => {
    if (material.patch?.image_data_url) {
      const patchWidth = material.patch.size?.width ?? width
      const patchHeight = material.patch.size?.height ?? height
      return [
        `<pattern id="${svgEscape(material.pattern_id)}" patternUnits="userSpaceOnUse" width="${patchWidth}" height="${patchHeight}">`,
        `<image href="${svgEscape(material.patch.image_data_url)}" width="${patchWidth}" height="${patchHeight}" preserveAspectRatio="none" image-rendering="pixelated"/>`,
        '</pattern>',
      ].join('')
    }
    const accents = materialAccentRects(material, { seed: materialProfile.seed, patternSize: materialProfile.pattern_size })
    return [
      `<pattern id="${svgEscape(material.pattern_id)}" patternUnits="userSpaceOnUse" width="${width}" height="${height}">`,
      `<rect width="${width}" height="${height}" fill="${svgEscape(material.base)}"/>`,
      ...accents,
      '</pattern>',
    ].join('')
  })
  return `<defs>${patterns.join('')}</defs>`
}

export function collectProceduralMaterialColors(materialProfile) {
  const colors = new Set()
  for (const material of Object.values(materialProfile.materials)) {
    for (const key of ['base', 'highlight', 'shadow', 'detail']) {
      if (material[key]) colors.add(material[key].toLowerCase())
    }
  }
  return [...colors].sort()
}
