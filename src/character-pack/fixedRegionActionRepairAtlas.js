import { cleanupSmallAlphaComponentsFromRgba } from './backgroundRemoval.js'
import {
  actionRepairActionForRegion,
  actionRepairFacingForRegion,
  actionRepairIdentityAnchorKeys,
  actionRepairRegionKeyForFrameIndex,
  normalizeActionRepairRegionKeys,
  resolveActionRepairLayout,
  scaleActionRepairRegion,
} from './actionRepairLayouts.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from './imageCodec.js'
import { removeBackground } from './sourcePreparation.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from './sourceLayoutIds.js'

export const FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION = 'fixed_region_action_repair_atlas_v1'
export const FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE = 1024
export const FIXED_REGION_ACTION_REPAIR_ATLAS_COLUMNS = 6
export const MAX_FIXED_REGION_ACTION_REPAIR_TARGETS = 30

const CHROMA = Object.freeze([255, 0, 255, 255])
const TARGET_GUTTER = 12
const MAX_IDENTITY_ANCHORS = 8

function createImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = fill[0]
    data[offset + 1] = fill[1]
    data[offset + 2] = fill[2]
    data[offset + 3] = fill[3]
  }
  return { width, height, data }
}

function cloneImage(image) {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  }
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

function gridCell(width, height, columns, rows, row, column) {
  const x0 = Math.round((column * width) / columns)
  const x1 = Math.round(((column + 1) * width) / columns)
  const y0 = Math.round((row * height) / rows)
  const y1 = Math.round(((row + 1) * height) / rows)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function insetRectangle(rectangle, inset) {
  const xInset = Math.min(inset, Math.floor((rectangle.w - 1) / 2))
  const yInset = Math.min(inset, Math.floor((rectangle.h - 1) / 2))
  return {
    x: rectangle.x + xInset,
    y: rectangle.y + yInset,
    w: Math.max(1, rectangle.w - xInset * 2),
    h: Math.max(1, rectangle.h - yInset * 2),
  }
}

function fillRectangle(image, rectangle, fill) {
  const left = clamp(rectangle.x, 0, image.width)
  const top = clamp(rectangle.y, 0, image.height)
  const right = clamp(rectangle.x + rectangle.w, left, image.width)
  const bottom = clamp(rectangle.y + rectangle.h, top, image.height)
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = fill[0]
      image.data[offset + 1] = fill[1]
      image.data[offset + 2] = fill[2]
      image.data[offset + 3] = fill[3]
    }
  }
}

function cropImage(image, rectangle) {
  const x = clamp(rectangle.x, 0, image.width - 1)
  const y = clamp(rectangle.y, 0, image.height - 1)
  const right = clamp(rectangle.x + rectangle.w, x + 1, image.width)
  const bottom = clamp(rectangle.y + rectangle.h, y + 1, image.height)
  const output = createImage(right - x, bottom - y)
  for (let targetY = 0; targetY < output.height; targetY += 1) {
    const sourceOffset = ((y + targetY) * image.width + x) * 4
    const targetOffset = targetY * output.width * 4
    output.data.set(image.data.slice(sourceOffset, sourceOffset + output.width * 4), targetOffset)
  }
  return output
}

function pasteImage(target, source, destinationX, destinationY) {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const targetY = destinationY + sourceY
    if (targetY < 0 || targetY >= target.height) continue
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const targetX = destinationX + sourceX
      if (targetX < 0 || targetX >= target.width) continue
      const sourceOffset = (sourceY * source.width + sourceX) * 4
      if (source.data[sourceOffset + 3] === 0) continue
      const targetOffset = (targetY * target.width + targetX) * 4
      target.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset)
    }
  }
}

function alphaBounds(image, threshold = 8) {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  let pixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue
      pixels += 1
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return null
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1, pixels }
}

export function grayscalePose(image) {
  const output = cloneImage(image)
  for (let offset = 0; offset < output.data.length; offset += 4) {
    if (output.data[offset + 3] === 0) continue
    const luminance = Math.round(
      output.data[offset] * 0.299 + output.data[offset + 1] * 0.587 + output.data[offset + 2] * 0.114,
    )
    const shade = luminance < 70 ? 30 : luminance < 145 ? 125 : 220
    output.data[offset] = shade
    output.data[offset + 1] = shade
    output.data[offset + 2] = Math.min(255, shade + 12)
  }
  return output
}

async function placeSpriteInRectangle(canvas, sprite, rectangle, padding = 12) {
  const bounds = alphaBounds(sprite)
  if (!bounds) throw new Error('action repair atlas cannot place an empty sprite')
  const cropped = cropImage(sprite, bounds)
  const availableWidth = Math.max(1, rectangle.w - padding * 2)
  const availableHeight = Math.max(1, rectangle.h - padding * 2)
  const integerScale = Math.max(
    1,
    Math.floor(Math.min(availableWidth / cropped.width, availableHeight / cropped.height)),
  )
  const scaled = integerScale === 1
    ? cropped
    : await resizeRgbaNearest(cropped, {
        w: cropped.width * integerScale,
        h: cropped.height * integerScale,
      })
  const x = rectangle.x + Math.round((rectangle.w - scaled.width) / 2)
  const y = rectangle.y + rectangle.h - padding - scaled.height
  pasteImage(canvas, scaled, x, y)
  return {
    original_bounds: bounds,
    integer_scale: integerScale,
    placed_bounds: { x, y, w: scaled.width, h: scaled.height },
  }
}

function normalizeRegionKeys(regionKeys, sourceLayoutId) {
  const unique = normalizeActionRepairRegionKeys(sourceLayoutId, regionKeys)
  if (unique.length > MAX_FIXED_REGION_ACTION_REPAIR_TARGETS) {
    throw new Error(`action repair atlas supports at most ${MAX_FIXED_REGION_ACTION_REPAIR_TARGETS} target regions per call`)
  }
  return unique
}

export function fixedRegionActionRepairFacing(regionKey, sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return actionRepairFacingForRegion(sourceLayoutId, regionKey)
}

export function buildFixedRegionActionRepairAtlasLayout(regionKeys, sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  const keys = normalizeRegionKeys(regionKeys, sourceLayoutId)
  const columns = FIXED_REGION_ACTION_REPAIR_ATLAS_COLUMNS
  const rows = Math.ceil(keys.length / columns) + 1
  const targetSlots = keys.map((regionKey, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const cell = gridCell(
      FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
      FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
      columns,
      rows,
      row,
      column,
    )
    return {
      index,
      region_key: regionKey,
      action: actionRepairActionForRegion(sourceLayoutId, regionKey),
      facing: fixedRegionActionRepairFacing(regionKey, sourceLayoutId),
      row,
      column,
      atlas_cell: cell,
      atlas_inner: insetRectangle(cell, TARGET_GUTTER),
    }
  })
  const controlSlots = []
  for (let index = keys.length; index < rows * columns; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const cell = gridCell(
      FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
      FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
      columns,
      rows,
      row,
      column,
    )
    controlSlots.push({
      row,
      column,
      atlas_cell: cell,
      atlas_inner: insetRectangle(cell, TARGET_GUTTER),
    })
  }
  return {
    version: FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION,
    source_layout: sourceLayoutId,
    width: FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
    height: FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
    columns,
    rows,
    target_slots: targetSlots,
    control_slots: controlSlots,
  }
}

function runtimeFrameRectangle(image, frameIndex) {
  const columns = 8
  const rows = 8
  const cellWidth = Math.round(image.width / columns)
  const cellHeight = Math.round(image.height / rows)
  return {
    x: (frameIndex % columns) * cellWidth,
    y: Math.floor(frameIndex / columns) * cellHeight,
    w: cellWidth,
    h: cellHeight,
  }
}

function normalizedMappings(value, sourceLayoutId) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.filter((item) => {
    const frameIndex = item?.frame_index ?? item?.frameIndex
    const regionKey = item?.region_key ?? item?.regionKey ?? actionRepairRegionKeyForFrameIndex(sourceLayoutId, frameIndex)
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= 64 ||
        !Object.hasOwn(layout.regions, regionKey) || seen.has(frameIndex)) return false
    seen.add(frameIndex)
    return true
  }).map((item) => ({
    frame_index: item.frame_index ?? item.frameIndex,
    region_key: item.region_key ?? item.regionKey ?? actionRepairRegionKeyForFrameIndex(
      sourceLayoutId,
      item.frame_index ?? item.frameIndex,
    ),
  }))
}

function collectIdentityAnchors({
  sourceImage,
  normalizedImage = null,
  normalizedFrameMappings = [],
  layout,
  sourceLayoutId,
}) {
  const selected = new Set(layout.target_slots.map((slot) => slot.region_key))
  const requiredFacings = [...new Set(layout.target_slots.map((slot) => slot.facing))]
  const sourceKeys = actionRepairIdentityAnchorKeys(
    sourceLayoutId,
    [...selected],
    requiredFacings,
    MAX_IDENTITY_ANCHORS,
  )
  const anchors = sourceKeys.slice(0, normalizedImage ? 6 : MAX_IDENTITY_ANCHORS).map((regionKey) => {
    const region = scaleActionRepairRegion(sourceLayoutId, regionKey, sourceImage)
    return {
      source: 'source',
      region_key: regionKey,
      facing: fixedRegionActionRepairFacing(regionKey, sourceLayoutId),
      image: cropImage(sourceImage, region),
    }
  }).filter((anchor) => alphaBounds(anchor.image))

  if (normalizedImage) {
    for (const mapping of normalizedMappings(normalizedFrameMappings, sourceLayoutId)) {
      if (selected.has(mapping.region_key) || anchors.some((anchor) => anchor.region_key === mapping.region_key) ||
          anchors.length >= MAX_IDENTITY_ANCHORS) continue
      const image = cropImage(normalizedImage, runtimeFrameRectangle(normalizedImage, mapping.frame_index))
      if (!alphaBounds(image)) continue
      anchors.push({
        source: 'normalized',
        frame_index: mapping.frame_index,
        region_key: mapping.region_key,
        facing: fixedRegionActionRepairFacing(mapping.region_key, sourceLayoutId),
        image,
      })
    }
  }

  for (const regionKey of sourceKeys) {
    if (anchors.length >= MAX_IDENTITY_ANCHORS || anchors.some((item) => item.region_key === regionKey)) continue
    const region = scaleActionRepairRegion(sourceLayoutId, regionKey, sourceImage)
    const image = cropImage(sourceImage, region)
    if (alphaBounds(image)) anchors.push({
      source: 'source',
      region_key: regionKey,
      facing: fixedRegionActionRepairFacing(regionKey, sourceLayoutId),
      image,
    })
  }
  if (anchors.length < 2) throw new Error('action repair atlas requires at least two verified unselected identity anchors')
  return anchors
}

function averageProfile(images) {
  const bounds = images.map((image) => alphaBounds(image)).filter(Boolean)
  if (!bounds.length) throw new Error('action repair identity profile has no visible sprites')
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    width: Math.round(average(bounds.map((entry) => entry.w))),
    height: Math.round(average(bounds.map((entry) => entry.h))),
    center_x: average(bounds.map((entry) => entry.x + entry.w / 2)),
    baseline: average(bounds.map((entry) => entry.y + entry.h)),
  }
}

function identityProfiles(anchors, requiredFacings) {
  const sourceAnchors = anchors.filter((anchor) => anchor.source === 'source')
  const fallback = sourceAnchors.length ? sourceAnchors : anchors
  return Object.fromEntries(requiredFacings.map((facing) => {
    const exact = sourceAnchors.filter((anchor) => anchor.facing === facing)
    return [facing, averageProfile((exact.length ? exact : fallback).map((anchor) => anchor.image))]
  }))
}

function countNonZeroPixels(image, rectangles) {
  let count = 0
  for (const rectangle of rectangles) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.h; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.w; x += 1) {
        const offset = (y * image.width + x) * 4
        if (image.data[offset] || image.data[offset + 1] || image.data[offset + 2] || image.data[offset + 3]) count += 1
      }
    }
  }
  return count
}

export async function buildFixedRegionActionRepairAtlases({
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer,
  normalizedFrameMappings = [],
  regionKeys,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
} = {}) {
  if (!sourceSheetBuffer) throw new Error('sourceSheetBuffer is required for action repair atlas')
  if (!motionTemplateBuffer) throw new Error('motionTemplateBuffer is required for action repair atlas')
  const sourceLayout = resolveActionRepairLayout(sourceLayoutId)
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys, sourceLayoutId)
  const [sourceImage, normalizedImage, motionTemplateImage] = await Promise.all([
    loadRgba(sourceSheetBuffer),
    normalizedSheetBuffer ? loadRgba(normalizedSheetBuffer) : Promise.resolve(null),
    loadRgba(motionTemplateBuffer),
  ])
  if (sourceImage.width !== sourceLayout.sheet.w || sourceImage.height !== sourceLayout.sheet.h) {
    throw new Error(`action repair source is not the expected ${sourceLayout.sheet.w}x${sourceLayout.sheet.h} ${sourceLayout.id} sheet`)
  }
  if (motionTemplateImage.width !== sourceLayout.template_size.w || motionTemplateImage.height !== sourceLayout.template_size.h) {
    throw new Error(`action repair motion template is not the expected ${sourceLayout.template_size.w}x${sourceLayout.template_size.h} ${sourceLayout.id} template`)
  }
  const anchors = collectIdentityAnchors({
    sourceImage,
    normalizedImage,
    normalizedFrameMappings,
    layout,
    sourceLayoutId,
  })
  const identityAtlas = createImage(layout.width, layout.height, CHROMA)
  const identityPlacement = []
  for (let index = 0; index < anchors.length; index += 1) {
    const rectangle = gridCell(layout.width, layout.height, 4, 2, Math.floor(index / 4), index % 4)
    const placed = await placeSpriteInRectangle(identityAtlas, anchors[index].image, rectangle, 28)
    const { image, ...identity } = anchors[index]
    identityPlacement.push({ ...identity, ...placed })
  }

  const poseGuideAtlas = createImage(layout.width, layout.height, CHROMA)
  const emptyOutputAtlas = createImage(layout.width, layout.height, CHROMA)
  const poseGuidePlacement = []
  for (const slot of [...layout.target_slots, ...layout.control_slots]) {
    fillRectangle(emptyOutputAtlas, slot.atlas_inner, [0, 0, 0, 0])
  }
  for (const slot of layout.target_slots) {
    const region = scaleActionRepairRegion(sourceLayoutId, slot.region_key, motionTemplateImage)
    const pose = grayscalePose(cropImage(motionTemplateImage, region))
    const placed = await placeSpriteInRectangle(poseGuideAtlas, pose, slot.atlas_inner, 14)
    poseGuidePlacement.push({ ...slot, ...placed })
  }
  const targetHoleNonZeroPixels = countNonZeroPixels(
    emptyOutputAtlas,
    layout.target_slots.map((slot) => slot.atlas_inner),
  )
  const controlSlotNonZeroPixels = countNonZeroPixels(
    emptyOutputAtlas,
    layout.control_slots.map((slot) => slot.atlas_inner),
  )
  const outputSlotNonZeroPixels = targetHoleNonZeroPixels + controlSlotNonZeroPixels
  if (outputSlotNonZeroPixels !== 0) throw new Error('independent action repair output atlas is not empty')

  const [identityBuffer, poseBuffer, emptyBuffer] = await Promise.all([
    encodeRgbaPng(identityAtlas),
    encodeRgbaPng(poseGuideAtlas),
    encodeRgbaPng(emptyOutputAtlas),
  ])
  return {
    reference_images: [
      {
        name: 'identity_anchor_atlas.png',
        mimeType: 'image/png',
        buffer: identityBuffer,
        role: 'verified_character_identity_only',
      },
      {
        name: 'pose_guide_atlas.png',
        mimeType: 'image/png',
        buffer: poseBuffer,
        role: 'per_slot_pose_and_facing_only',
      },
      {
        name: 'empty_output_atlas.png',
        mimeType: 'image/png',
        buffer: emptyBuffer,
        role: 'independent_transparent_output_geometry',
      },
    ],
    evidence: {
      version: FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION,
      layout,
      identity_anchors: identityPlacement,
      pose_guide_placement: poseGuidePlacement,
      target_holes_zero_rgba: true,
      target_hole_nonzero_pixels: 0,
      control_slots_zero_rgba: true,
      control_slot_nonzero_pixels: 0,
      output_slots_zero_rgba: true,
      output_slot_nonzero_pixels: 0,
      full_source_sheet_attached: false,
      full_normalized_sheet_attached: false,
      generated_candidate_attached: false,
    },
  }
}

function componentStats(image, threshold = 8) {
  const seen = new Uint8Array(image.width * image.height)
  const components = []
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const start = y * image.width + x
      if (seen[start]) continue
      seen[start] = 1
      if (image.data[start * 4 + 3] <= threshold) continue
      const queue = [start]
      let pixels = 0
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor]
        pixels += 1
        const currentX = index % image.width
        const currentY = Math.floor(index / image.width)
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const nextX = currentX + dx
            const nextY = currentY + dy
            if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue
            const next = nextY * image.width + nextX
            if (seen[next]) continue
            seen[next] = 1
            if (image.data[next * 4 + 3] > threshold) queue.push(next)
          }
        }
      }
      components.push(pixels)
    }
  }
  components.sort((left, right) => right - left)
  const largest = components[0] ?? 0
  return {
    count: components.length,
    largest,
    significant_count: components.filter((pixels) => pixels >= Math.max(16, largest * 0.08)).length,
    sizes: components.slice(0, 8),
  }
}

function scaleAtlasRectangle(rectangle, providerImage, layout) {
  const x = Math.round((rectangle.x * providerImage.width) / layout.width)
  const y = Math.round((rectangle.y * providerImage.height) / layout.height)
  const right = Math.round(((rectangle.x + rectangle.w) * providerImage.width) / layout.width)
  const bottom = Math.round(((rectangle.y + rectangle.h) * providerImage.height) / layout.height)
  return {
    x: clamp(x, 0, providerImage.width - 1),
    y: clamp(y, 0, providerImage.height - 1),
    w: Math.max(1, clamp(right, x + 1, providerImage.width) - x),
    h: Math.max(1, clamp(bottom, y + 1, providerImage.height) - y),
  }
}

function alphaBorderCoverage(image, bounds, threshold = 8) {
  let opaque = 0
  let total = 0
  const inspect = (x, y) => {
    total += 1
    if (image.data[(y * image.width + x) * 4 + 3] > threshold) opaque += 1
  }
  for (let x = bounds.x; x < bounds.x + bounds.w; x += 1) {
    inspect(x, bounds.y)
    if (bounds.h > 1) inspect(x, bounds.y + bounds.h - 1)
  }
  for (let y = bounds.y + 1; y < bounds.y + bounds.h - 1; y += 1) {
    inspect(bounds.x, y)
    if (bounds.w > 1) inspect(bounds.x + bounds.w - 1, y)
  }
  return total ? opaque / total : 0
}

function panelLikeStats(
  image,
  bounds,
  { panelCoverage = 0.7, panelFillCoverage = 0.9, panelBorderCoverage = 0.8 } = {},
) {
  if (!bounds) {
    return {
      coverage: 0,
      fill_coverage: 0,
      border_coverage: 0,
      panel_like: false,
    }
  }
  const coverage = bounds.pixels / Math.max(1, image.width * image.height)
  const fillCoverage = bounds.pixels / Math.max(1, bounds.w * bounds.h)
  const borderCoverage = alphaBorderCoverage(image, bounds)
  return {
    coverage,
    fill_coverage: fillCoverage,
    border_coverage: borderCoverage,
    panel_like: coverage >= panelCoverage &&
      fillCoverage >= panelFillCoverage &&
      borderCoverage >= panelBorderCoverage,
  }
}

function hasTransparentPixel(image, threshold = 8) {
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] <= threshold) return true
  }
  return false
}

function isTransparentOrChroma(data, offset, chromaTolerance = 24) {
  if (data[offset + 3] <= 8) return true
  const threshold = chromaTolerance * chromaTolerance
  const distance = (data[offset] - CHROMA[0]) ** 2 +
    (data[offset + 1] - CHROMA[1]) ** 2 +
    (data[offset + 2] - CHROMA[2]) ** 2
  return distance <= threshold
}

function inspectProviderInputEdge(image, chromaTolerance = 24) {
  let pixels = 0
  let unsafePixels = 0
  const inspect = (x, y) => {
    pixels += 1
    const offset = (y * image.width + x) * 4
    if (!isTransparentOrChroma(image.data, offset, chromaTolerance)) unsafePixels += 1
  }
  for (let x = 0; x < image.width; x += 1) {
    inspect(x, 0)
    if (image.height > 1) inspect(x, image.height - 1)
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    inspect(0, y)
    if (image.width > 1) inspect(image.width - 1, y)
  }
  return {
    safe: unsafePixels === 0,
    pixels,
    unsafe_pixels: unsafePixels,
    allowed_background: 'transparent_or_chroma',
  }
}

async function removeNestedCellBackgrounds(
  crop,
  { maxPasses = 3, panelCoverage = 0.7, panelFillCoverage = 0.9, panelBorderCoverage = 0.8 } = {},
) {
  let image = crop
  let offsetX = 0
  let offsetY = 0
  const passes = []
  const warnings = []
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (hasTransparentPixel(image)) {
      passes.push('alpha_passthrough')
      break
    }
    const background = await removeBackground(image, { backgroundMode: 'edge_palette' })
    image = background.image
    passes.push(background.mode)
    warnings.push(...background.warnings)
    const bounds = alphaBounds(image)
    if (!bounds) break
    const panel = panelLikeStats(image, bounds, {
      panelCoverage,
      panelFillCoverage,
      panelBorderCoverage,
    })
    if (!panel.panel_like || pass === maxPasses - 1) break
    offsetX += bounds.x
    offsetY += bounds.y
    image = cropImage(image, bounds)
  }
  const remainingBounds = alphaBounds(image)
  return {
    image,
    offset: { x: offsetX, y: offsetY },
    mode: passes.join('+'),
    passes: passes.length,
    warnings: [...new Set(warnings)],
    panel_residue: panelLikeStats(image, remainingBounds, {
      panelCoverage,
      panelFillCoverage,
      panelBorderCoverage,
    }),
  }
}

function inspectProviderControlCell(providerImage, layout, slot, chromaTolerance = 24) {
  const cell = scaleAtlasRectangle(slot.atlas_cell, providerImage, layout)
  const inner = scaleAtlasRectangle(slot.atlas_inner, providerImage, layout)
  const crop = cropImage(providerImage, inner)
  const content = createImage(crop.width, crop.height)
  let foregroundPixels = 0
  for (let offset = 0; offset < crop.data.length; offset += 4) {
    if (isTransparentOrChroma(crop.data, offset, chromaTolerance)) continue
    content.data.set(crop.data.subarray(offset, offset + 4), offset)
    foregroundPixels += 1
  }
  return {
    cell,
    inner,
    image: content,
    foreground_pixels: foregroundPixels,
    content_offset: { x: 0, y: 0 },
    background_mode: 'strict_transparent_or_chroma_control',
    background_warnings: [],
    background_passes: 0,
    component_cleanup: {
      enabled: false,
      reason: 'control_slots_fail_closed_before_component_cleanup',
    },
  }
}

async function cleanProviderCell(providerImage, layout, slot) {
  const cell = scaleAtlasRectangle(slot.atlas_cell, providerImage, layout)
  const inner = scaleAtlasRectangle(slot.atlas_inner, providerImage, layout)
  const crop = cropImage(providerImage, inner)
  const inputEdge = inspectProviderInputEdge(crop)
  const background = await removeNestedCellBackgrounds(crop)
  const componentCleanup = cleanupSmallAlphaComponentsFromRgba(background.image, {
    minArea: 12,
    minAreaRatio: 0.001,
  })
  return {
    cell,
    inner,
    image: componentCleanup.image,
    content_offset: background.offset,
    background_mode: background.mode,
    background_warnings: background.warnings,
    background_passes: background.passes,
    panel_residue: background.panel_residue,
    input_edge: inputEdge,
    component_cleanup: componentCleanup.stats,
  }
}

async function normalizeCandidateCell(candidate, destinationRegion, identityProfile, templateCell) {
  const bounds = alphaBounds(candidate)
  if (!bounds) {
    return {
      image: createImage(destinationRegion.w, destinationRegion.h),
      report: {
        provider_cell_bounds: null,
        template_bounds: alphaBounds(templateCell),
        identity_profile: identityProfile,
        normalized_bounds: null,
      },
    }
  }
  const templateBounds = alphaBounds(templateCell)
  const cropped = cropImage(candidate, bounds)
  const maxWidth = clamp(
    Math.max(identityProfile.width + 2, templateBounds?.w ?? identityProfile.width),
    1,
    destinationRegion.w - 2,
  )
  const maxHeight = clamp(
    Math.max(identityProfile.height, templateBounds?.h ?? identityProfile.height),
    1,
    destinationRegion.h - 2,
  )
  const scale = Math.min(maxWidth / cropped.width, maxHeight / cropped.height)
  const targetWidth = Math.max(1, Math.round(cropped.width * scale))
  const targetHeight = Math.max(1, Math.round(cropped.height * scale))
  const resized = await resizeRgbaNearest(cropped, { w: targetWidth, h: targetHeight })
  const output = createImage(destinationRegion.w, destinationRegion.h)
  const x = clamp(Math.round(identityProfile.center_x - resized.width / 2), 0, destinationRegion.w - resized.width)
  const y = clamp(Math.round(identityProfile.baseline - resized.height), 0, destinationRegion.h - resized.height)
  pasteImage(output, resized, x, y)
  return {
    image: output,
    report: {
      provider_cell_bounds: bounds,
      template_bounds: templateBounds,
      identity_profile: identityProfile,
      normalized_bounds: { x, y, w: resized.width, h: resized.height },
    },
  }
}

export async function extractFixedRegionActionRepairAtlas({
  providerAtlasBuffer,
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer,
  normalizedFrameMappings = [],
  regionKeys,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
} = {}) {
  if (!providerAtlasBuffer) throw new Error('providerAtlasBuffer is required')
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys, sourceLayoutId)
  const [providerImage, sourceImage, normalizedImage, motionTemplateImage] = await Promise.all([
    loadRgba(providerAtlasBuffer),
    loadRgba(sourceSheetBuffer),
    normalizedSheetBuffer ? loadRgba(normalizedSheetBuffer) : Promise.resolve(null),
    loadRgba(motionTemplateBuffer),
  ])
  if (providerImage.width > 4096 || providerImage.height > 4096) {
    throw new Error('provider action repair atlas exceeds the 4096x4096 decode limit')
  }
  const anchors = collectIdentityAnchors({
    sourceImage,
    normalizedImage,
    normalizedFrameMappings,
    layout,
    sourceLayoutId,
  })
  const profiles = identityProfiles(anchors, [...new Set(layout.target_slots.map((slot) => slot.facing))])
  const providerSource = createImage(sourceImage.width, sourceImage.height)
  const cleanedProviderAtlas = createImage(providerImage.width, providerImage.height)
  const targetEntries = []
  const extractedFrames = {}
  for (const slot of layout.target_slots) {
    const cleaned = await cleanProviderCell(providerImage, layout, slot)
    pasteImage(
      cleanedProviderAtlas,
      cleaned.image,
      cleaned.inner.x + cleaned.content_offset.x,
      cleaned.inner.y + cleaned.content_offset.y,
    )
    const components = componentStats(cleaned.image)
    const destination = scaleActionRepairRegion(sourceLayoutId, slot.region_key, sourceImage)
    const templateRegion = scaleActionRepairRegion(sourceLayoutId, slot.region_key, motionTemplateImage)
    const templateCell = cropImage(motionTemplateImage, templateRegion)
    const normalized = await normalizeCandidateCell(cleaned.image, destination, profiles[slot.facing], templateCell)
    pasteImage(providerSource, normalized.image, destination.x, destination.y)
    extractedFrames[slot.region_key] = await encodeRgbaPng(normalized.image)
    const bounds = alphaBounds(cleaned.image)
    targetEntries.push({
      region_key: slot.region_key,
      action: slot.action,
      facing: slot.facing,
      row: slot.row,
      column: slot.column,
      provider_atlas_cell: cleaned.cell,
      provider_atlas_inner: cleaned.inner,
      cleaned_bounds: bounds,
      cleaned_foreground_pixels: bounds?.pixels ?? 0,
      components,
      background_mode: cleaned.background_mode,
      background_warnings: cleaned.background_warnings,
      background_passes: cleaned.background_passes,
      panel_residue: cleaned.panel_residue,
      input_edge_safe: cleaned.input_edge.safe,
      input_edge_unsafe_pixels: cleaned.input_edge.unsafe_pixels,
      component_cleanup: cleaned.component_cleanup,
      ...normalized.report,
    })
  }

  const controlEntries = []
  for (const slot of layout.control_slots) {
    const cleaned = inspectProviderControlCell(providerImage, layout, slot)
    pasteImage(
      cleanedProviderAtlas,
      cleaned.image,
      cleaned.inner.x + cleaned.content_offset.x,
      cleaned.inner.y + cleaned.content_offset.y,
    )
    const bounds = alphaBounds(cleaned.image)
    controlEntries.push({
      ...slot,
      provider_atlas_cell: cleaned.cell,
      provider_atlas_inner: cleaned.inner,
      foreground_pixels: cleaned.foreground_pixels,
      bounds,
      components: componentStats(cleaned.image),
      background_mode: cleaned.background_mode,
      background_warnings: cleaned.background_warnings,
      background_passes: cleaned.background_passes,
      component_cleanup: cleaned.component_cleanup,
    })
  }
  const targetPass = targetEntries.every((entry) => (
    entry.cleaned_foreground_pixels > 0 &&
    entry.components.significant_count === 1 &&
    entry.input_edge_safe &&
    entry.panel_residue.panel_like === false
  ))
  const controlPass = controlEntries.every((entry) => entry.foreground_pixels === 0)
  return {
    provider_source_sheet_png: await encodeRgbaPng(providerSource),
    background_removed_provider_atlas_png: await encodeRgbaPng(cleanedProviderAtlas),
    extracted_frames: extractedFrames,
    report: {
      schema_version: 1,
      version: FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION,
      provider_free: true,
      status: targetPass && controlPass ? 'extraction_pass' : 'extraction_blocked',
      provider_source_size: { w: providerImage.width, h: providerImage.height },
      atlas_grid: { columns: layout.columns, rows: layout.rows },
      target_entries: targetEntries,
      control_entries: controlEntries,
      control_foreground_pixels: controlEntries.reduce((sum, entry) => sum + entry.foreground_pixels, 0),
      control_slots_empty: controlPass,
    },
  }
}
