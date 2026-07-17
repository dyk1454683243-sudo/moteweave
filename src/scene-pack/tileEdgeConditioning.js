import { getTileEdges, getTileSourceRegion, TOPDOWN_TILE_DUAL_GRID_V0 } from './tileProfile.js'

const DEFAULT_BAND = 3
const RGBA_CHANNELS = 4
const MODE_GLOBAL_V0 = 'edge_conditioning_v0'
const MODE_EDGE_AWARE_V1 = 'edge_aware_conditioning_v1'

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeOptions(options = {}) {
  if (options === false) return { enabled: false, band: DEFAULT_BAND, mode: MODE_EDGE_AWARE_V1 }
  const enabled = options.enabled ?? true
  const band = Number(options.band ?? DEFAULT_BAND)
  if (!Number.isInteger(band) || band < 1) throw new Error('edge conditioning band must be a positive integer')
  return { enabled: Boolean(enabled), band, mode: normalizeMode(options.mode) }
}

function normalizeMode(mode = MODE_EDGE_AWARE_V1) {
  if (mode === 'global-v0' || mode === MODE_GLOBAL_V0) return MODE_GLOBAL_V0
  if (mode === 'edge-aware-v1' || mode === MODE_EDGE_AWARE_V1) return MODE_EDGE_AWARE_V1
  throw new Error(`Unknown edge conditioning mode: ${mode}`)
}

function tileEntries(tiles) {
  if (!tiles) return []
  const entries = tiles instanceof Map ? [...tiles.entries()] : Object.entries(tiles)
  return entries.map(([mask, image]) => ({ mask: Number(mask), key: String(mask), image }))
}

function cloneImage(image) {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  }
}

function imageOffset(image, x, y) {
  return (y * image.width + x) * RGBA_CHANNELS
}

function addPixel(sums, image, x, y) {
  const offset = imageOffset(image, x, y)
  sums[0] += image.data[offset]
  sums[1] += image.data[offset + 1]
  sums[2] += image.data[offset + 2]
  sums[3] += image.data[offset + 3]
  sums.count += 1
}

function averagePixel(sums) {
  if (!sums.count) return [0, 0, 0, 0]
  return [
    Math.round(sums[0] / sums.count),
    Math.round(sums[1] / sums.count),
    Math.round(sums[2] / sums.count),
    Math.round(sums[3] / sums.count),
  ]
}

function setPixel(image, x, y, rgba) {
  const offset = imageOffset(image, x, y)
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3]
}

function makeSums(length) {
  return Array.from({ length }, () => ({ 0: 0, 1: 0, 2: 0, 3: 0, count: 0 }))
}

function buildAxisAverages(entries, band, axis) {
  const first = entries[0]?.image
  if (!first) return []
  const length = axis === 'vertical' ? first.height : first.width
  const maxBand = Math.min(band, axis === 'vertical' ? first.width : first.height)
  const sumsByBand = Array.from({ length: maxBand }, () => makeSums(length))

  for (const { image } of entries) {
    for (let k = 0; k < maxBand; k += 1) {
      if (axis === 'vertical') {
        const west = k
        const east = image.width - 1 - k
        for (let y = 0; y < image.height; y += 1) {
          addPixel(sumsByBand[k][y], image, west, y)
          if (east !== west) addPixel(sumsByBand[k][y], image, east, y)
        }
      } else {
        const north = k
        const south = image.height - 1 - k
        for (let x = 0; x < image.width; x += 1) {
          addPixel(sumsByBand[k][x], image, x, north)
          if (south !== north) addPixel(sumsByBand[k][x], image, x, south)
        }
      }
    }
  }

  return sumsByBand.map((sums) => sums.map(averagePixel))
}

function applyAxisAverages(image, averages, axis) {
  for (let k = 0; k < averages.length; k += 1) {
    if (axis === 'vertical') {
      const west = k
      const east = image.width - 1 - k
      for (let y = 0; y < image.height; y += 1) {
        setPixel(image, west, y, averages[k][y])
        if (east !== west) setPixel(image, east, y, averages[k][y])
      }
    } else {
      const north = k
      const south = image.height - 1 - k
      for (let x = 0; x < image.width; x += 1) {
        setPixel(image, x, north, averages[k][x])
        if (south !== north) setPixel(image, x, south, averages[k][x])
      }
    }
  }
}

function enforceMeasuredEdges(image, { horizontal, vertical }) {
  if (horizontal[0]) {
    const top = 0
    const bottom = image.height - 1
    for (let x = 1; x < image.width - 1; x += 1) {
      setPixel(image, x, top, horizontal[0][x])
      setPixel(image, x, bottom, horizontal[0][x])
    }
  }
  if (vertical[0]) {
    const left = 0
    const right = image.width - 1
    for (let y = 1; y < image.height - 1; y += 1) {
      setPixel(image, left, y, vertical[0][y])
      setPixel(image, right, y, vertical[0][y])
    }
  }
}

function countChangedPixels(beforeEntries, conditionedTiles) {
  let changed = 0
  let total = 0
  for (const { key, image } of beforeEntries) {
    const after = conditionedTiles[key]
    if (!after) continue
    const pixelCount = Math.floor(Math.min(image.data.length, after.data.length) / RGBA_CHANNELS)
    total += pixelCount
    for (let i = 0; i < pixelCount; i += 1) {
      const offset = i * RGBA_CHANNELS
      if (
        image.data[offset] !== after.data[offset] ||
        image.data[offset + 1] !== after.data[offset + 1] ||
        image.data[offset + 2] !== after.data[offset + 2] ||
        image.data[offset + 3] !== after.data[offset + 3]
      ) {
        changed += 1
      }
    }
  }
  return { changed, total }
}

function cloneTiles(tiles) {
  return Object.fromEntries(tileEntries(tiles).map(({ key, image }) => [key, cloneImage(image)]))
}

function disabledReport({ mode, band, tileCount }) {
  return {
    schema_version: 1,
    mode,
    enabled: false,
    band,
    tile_count: tileCount,
    changed_pixel_count: 0,
    changed_pixel_ratio: 0,
  }
}

function conditionTileEdgesGlobalV0(entries, conditionedTiles, { band }) {
  const horizontal = buildAxisAverages(entries, band, 'horizontal')
  const vertical = buildAxisAverages(entries, band, 'vertical')
  for (const image of Object.values(conditionedTiles)) {
    applyAxisAverages(image, horizontal, 'horizontal')
    applyAxisAverages(image, vertical, 'vertical')
    enforceMeasuredEdges(image, { horizontal, vertical })
  }
  const changed = countChangedPixels(entries, conditionedTiles)

  return {
    tiles: conditionedTiles,
    report: {
      schema_version: 1,
      mode: MODE_GLOBAL_V0,
      enabled: true,
      band,
      tile_count: entries.length,
      changed_pixel_count: changed.changed,
      changed_pixel_ratio: changed.total ? round(changed.changed / changed.total) : 0,
      output_mutation: 'runtime_tile_edges_only',
      axis_groups: [
        { axis: 'horizontal', sampled_band_count: horizontal.length },
        { axis: 'vertical', sampled_band_count: vertical.length },
      ],
    },
  }
}

function sideAxis(side) {
  return side === 'north' || side === 'south' ? 'horizontal' : 'vertical'
}

function sideLength(image, side) {
  return sideAxis(side) === 'horizontal' ? image.width : image.height
}

function getSidePixel(image, side, position) {
  const x = side === 'west' ? 0 : side === 'east' ? image.width - 1 : position
  const y = side === 'north' ? 0 : side === 'south' ? image.height - 1 : position
  const offset = imageOffset(image, x, y)
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
    image.data[offset + 3],
  ]
}

function setSidePixel(image, side, position, rgba) {
  const x = side === 'west' ? 0 : side === 'east' ? image.width - 1 : position
  const y = side === 'north' ? 0 : side === 'south' ? image.height - 1 : position
  setPixel(image, x, y, rgba)
}

function edgeSignature(mask, side) {
  return getTileEdges(mask)[side].map((value) => (value ? 1 : 0)).join('')
}

function edgeRefsForEntries(entries) {
  return entries.flatMap(({ key, mask, image }) => ['north', 'east', 'south', 'west'].map((side) => ({
    id: `${key}:${side}`,
    key,
    mask,
    image,
    side,
    axis: sideAxis(side),
    signature: edgeSignature(mask, side),
  })))
}

function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (id) => {
    const current = parent.get(id)
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }
  return { find, union }
}

function unionEdgeAwareConstraints(refs) {
  const byId = new Map(refs.map((ref) => [ref.id, ref]))
  const unionFind = makeUnionFind(refs.map((ref) => ref.id))
  const bySignature = new Map()
  for (const ref of refs) {
    const key = `${ref.axis}:${ref.signature}`
    const group = bySignature.get(key) ?? []
    group.push(ref)
    bySignature.set(key, group)
  }
  for (const group of bySignature.values()) {
    for (let i = 1; i < group.length; i += 1) unionFind.union(group[0].id, group[i].id)
  }
  for (const ref of refs) {
    if (ref.side === 'north') unionFind.union(ref.id, `${ref.key}:south`)
    if (ref.side === 'west') unionFind.union(ref.id, `${ref.key}:east`)
  }

  const groups = new Map()
  for (const ref of refs) {
    const root = unionFind.find(ref.id)
    const group = groups.get(root) ?? []
    group.push(byId.get(ref.id))
    groups.set(root, group)
  }
  return { groups: [...groups.values()], bySignature }
}

function averageEdgeGroup(group) {
  const length = Math.min(...group.map((ref) => sideLength(ref.image, ref.side)))
  return Array.from({ length }, (_, position) => {
    const sums = { 0: 0, 1: 0, 2: 0, 3: 0, count: 0 }
    for (const ref of group) {
      const pixel = getSidePixel(ref.image, ref.side, position)
      sums[0] += pixel[0]
      sums[1] += pixel[1]
      sums[2] += pixel[2]
      sums[3] += pixel[3]
      sums.count += 1
    }
    return averagePixel(sums)
  })
}

function conditionTileEdgesEdgeAwareV1(entries, conditionedTiles, { band }) {
  const refs = edgeRefsForEntries(entries)
  const { groups, bySignature } = unionEdgeAwareConstraints(refs)
  for (const group of groups) {
    const average = averageEdgeGroup(group)
    for (const ref of group) {
      const target = conditionedTiles[ref.key]
      for (let position = 0; position < average.length; position += 1) {
        setSidePixel(target, ref.side, position, average[position])
      }
    }
  }
  const changed = countChangedPixels(entries, conditionedTiles)
  const edge_signature_groups = [...bySignature.entries()].map(([key, group]) => {
    const [axis, signature] = key.split(':')
    return { axis, signature, side_count: group.length }
  })

  return {
    tiles: conditionedTiles,
    report: {
      schema_version: 1,
      mode: MODE_EDGE_AWARE_V1,
      enabled: true,
      band,
      requested_band: band,
      applied_edge_depth: 1,
      tile_count: entries.length,
      changed_pixel_count: changed.changed,
      changed_pixel_ratio: changed.total ? round(changed.changed / changed.total) : 0,
      output_mutation: 'measured_runtime_outer_edges_only',
      edge_signature_groups,
      constraint_group_count: groups.length,
    },
  }
}

export function conditionTileEdges(tiles, options = {}) {
  const { enabled, band, mode } = normalizeOptions(options)
  const entries = tileEntries(tiles)
  const conditionedTiles = cloneTiles(tiles)
  if (!enabled) {
    return {
      tiles: conditionedTiles,
      report: disabledReport({ mode, band, tileCount: entries.length }),
    }
  }

  if (mode === MODE_GLOBAL_V0) return conditionTileEdgesGlobalV0(entries, conditionedTiles, { band })
  return conditionTileEdgesEdgeAwareV1(entries, conditionedTiles, { band })
}

export function writeTilesToTileSheet(source, tiles, { profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const output = cloneImage(source)
  for (const { mask, image } of tileEntries(tiles)) {
    const region = getTileSourceRegion(mask, profile)
    for (let y = 0; y < region.h; y += 1) {
      for (let x = 0; x < region.w; x += 1) {
        const src = imageOffset(image, x, y)
        const dst = imageOffset(output, region.x + x, region.y + y)
        output.data[dst] = image.data[src]
        output.data[dst + 1] = image.data[src + 1]
        output.data[dst + 2] = image.data[src + 2]
        output.data[dst + 3] = image.data[src + 3]
      }
    }
  }
  return output
}

function cloneTileRegion(image, region) {
  const data = new Uint8ClampedArray(region.w * region.h * RGBA_CHANNELS)
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const src = imageOffset(image, region.x + x, region.y + y)
      const dst = (y * region.w + x) * RGBA_CHANNELS
      data[dst] = image.data[src]
      data[dst + 1] = image.data[src + 1]
      data[dst + 2] = image.data[src + 2]
      data[dst + 3] = image.data[src + 3]
    }
  }
  return { width: region.w, height: region.h, data }
}

export function conditionTileSheetEdges(source, options = {}) {
  const profile = options?.profile ?? TOPDOWN_TILE_DUAL_GRID_V0
  const tileCount = profile.grid.columns * profile.grid.rows
  const tiles = {}
  for (let mask = 0; mask < tileCount; mask += 1) {
    tiles[mask] = cloneTileRegion(source, getTileSourceRegion(mask, profile))
  }
  const conditioned = conditionTileEdges(tiles, options)
  return {
    source: writeTilesToTileSheet(source, conditioned.tiles, { profile }),
    rawTiles: tiles,
    tiles: conditioned.tiles,
    report: conditioned.report,
  }
}
