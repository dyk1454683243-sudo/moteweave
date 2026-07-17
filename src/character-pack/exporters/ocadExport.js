import sharp from 'sharp'

import { FIXED_REGION_SOURCE_REGIONS } from '../fixedRegionGeometry.js'
import { loadRgba } from '../imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { OCAD_V0 } from './exportProfiles.js'

export const OCAD_REGIONS = FIXED_REGION_SOURCE_REGIONS

const WALK_OFFSETS = [0, 1, 2, 3, 2, 1]

const OCAD_MAPPING = [
  ['idledown', 'idle_down', 0],
  ['idleL', 'idle_left', 0],
  ['idleup', 'idle_up', 0],
  ['defence', 'hurt', 0],
  ['die', 'hurt', 1],
  ['sitdown', 'sit', 0],
  ['item0', 'attack_down', 0],
  ['item1', 'attack_down', 1],
  ['jump0', 'happy', 0],
  ['jump1', 'happy', 1],
  ...WALK_OFFSETS.map((offset, i) => [`walkdown${i}`, 'walk_down', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`walkL${i}`, 'walk_left', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`walkup${i}`, 'walk_up', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`rundown${i}`, 'walk_down', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`runL${i}`, 'walk_left', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`runup${i}`, 'walk_up', offset]),
  ...[0, 1, 2, 3, 2, 1, 0, 1].map((offset, i) => [`attractL${i}`, 'attack_left', offset]),
  ...WALK_OFFSETS.map((offset, i) => [`climb${i}`, 'walk_up', offset]),
]

function getAnimation(profile, name) {
  const animation = profile.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Missing source animation for OCAD export: ${name}`)
  return animation
}

function frameIndexFor(profile, animationName, frameOffset) {
  const animation = getAnimation(profile, animationName)
  return animation.row * profile.grid.columns + animation.startCol + Math.min(frameOffset, animation.count - 1)
}

function alphaBounds(image) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return { left: 0, top: 0, width: image.width, height: image.height }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function cropBounds(frame) {
  const image = frame.image
  const bbox = frame.normalized_bbox
  if (!bbox) return alphaBounds(image)
  const left = Math.max(0, Math.floor(bbox.x))
  const top = Math.max(0, Math.floor(bbox.y))
  const right = Math.min(image.width - 1, Math.ceil(bbox.right))
  const bottom = Math.min(image.height - 1, Math.ceil(bbox.bottom))
  return { left, top, width: Math.max(1, right - left + 1), height: Math.max(1, bottom - top + 1) }
}

async function drawRegion(target, targetWidth, frame, region) {
  const src = frame.image
  const crop = cropBounds(frame)
  const scale = Math.min(region.w / crop.width, region.h / crop.height)
  const scaledW = Math.max(1, Math.round(crop.width * scale))
  const scaledH = Math.max(1, Math.round(crop.height * scale))
  const data = await sharp(Buffer.from(src.data), { raw: { width: src.width, height: src.height, channels: 4 } })
    .extract(crop)
    .resize(scaledW, scaledH, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
  const dx = region.x + Math.floor((region.w - scaledW) / 2)
  const dy = region.y + region.h - scaledH
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const srcOffset = (y * scaledW + x) * 4
      const dstOffset = ((dy + y) * targetWidth + dx + x) * 4
      target[dstOffset] = data[srcOffset]
      target[dstOffset + 1] = data[srcOffset + 1]
      target[dstOffset + 2] = data[srcOffset + 2]
      target[dstOffset + 3] = data[srcOffset + 3]
    }
  }
}

async function renderOcadSprite(frames, profile) {
  const target = new Uint8ClampedArray(OCAD_V0.sheet.w * OCAD_V0.sheet.h * 4)
  for (const [regionKey, animationName, frameOffset] of OCAD_MAPPING) {
    const frame = frames[frameIndexFor(profile, animationName, frameOffset)]
    if (!frame) throw new Error(`Missing normalized frame for OCAD region: ${regionKey}`)
    await drawRegion(target, OCAD_V0.sheet.w, frame, OCAD_REGIONS[regionKey])
  }
  return sharp(Buffer.from(target), { raw: { width: OCAD_V0.sheet.w, height: OCAD_V0.sheet.h, channels: 4 } }).png().toBuffer()
}

async function renderOcadSpriteFromSource(sourcePng) {
  const source = await loadRgba(sourcePng)
  if (source.width !== OCAD_V0.sheet.w || source.height !== OCAD_V0.sheet.h) return null
  return sourcePng
}

export function buildOcadNpcJson({ metadata, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!metadata?.id) throw new Error('metadata.id is required for OCAD export')
  const id = `${metadata.id}_ocad`
  const displayName = `${metadata.name || metadata.id} OCAD`
  const createdAt = metadata.created_at ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    meta: {
      id,
      displayName,
      style: 'modern',
      category: 'function',
      types: ['function'],
      description: metadata.description || displayName,
      generator: 'ai_character_pack_pipeline',
      createdAt,
      updatedAt: createdAt,
      tags: ['ai_generated', profile.id, OCAD_V0.id],
    },
    assets: { spritePath: './sprite.png', thumbPath: './thumb.png' },
    spritesheet: {
      layoutVersion: 'yituquan_v1',
      frameWidth: OCAD_V0.sheet.w,
      frameHeight: OCAD_V0.sheet.h,
      columns: 1,
      rows: 1,
      margin: 0,
      spacing: 0,
      defaultFps: 8,
      animations: {},
    },
    gameplay: {
      faction: 'neutral',
      role: 'generated_character',
      level: 1,
      stats: { hp: 100, attack: 10, defense: 5, moveSpeed: 100 },
      interaction: { canTalk: true, canTrade: false, questGiver: false },
    },
    ext: {
      librarySortPriority: 130,
      sourceProfile: profile.id,
      exportProfile: OCAD_V0.id,
      cardPreviewAnim: 'walkdown',
      localization: {
        appearance: { zh: metadata.description || displayName, ja: '', en: '' },
        background: { zh: `${displayName} 是 OCAD 兼容导出。`, ja: '', en: '' },
        dialogues: {
          greeting: { zh: `你好，我是${displayName}。`, ja: '', en: '' },
          shopOpen: { zh: '当前没有商品。', ja: '', en: '' },
          questHint: { zh: '之后再来看看吧。', ja: '', en: '' },
        },
      },
      otherPayload: {},
      projectPrivate: {},
    },
  }
}

export async function buildOcadExport({ metadata, frames, profile = TOPDOWN_RPG_V0, sourcePng = null, sourceLayout = null } = {}) {
  if (!Array.isArray(frames)) throw new Error('normalized frames are required for OCAD export')
  const npcJson = buildOcadNpcJson({ metadata, profile })
  const basePath = `${OCAD_V0.folderRoot}/${npcJson.meta.id}`
  const sourceNativeSprite = sourceLayout?.kind === 'fixed_regions' && sourcePng
    ? await renderOcadSpriteFromSource(sourcePng)
    : null
  const spritePng = sourceNativeSprite ?? await renderOcadSprite(frames, profile)
  const thumbRegion = OCAD_REGIONS.idledown
  const thumbPng = await sharp(spritePng).extract({ left: thumbRegion.x, top: thumbRegion.y, width: thumbRegion.w, height: thumbRegion.h }).png().toBuffer()
  return {
    basePath,
    npcJson,
    spritePng,
    thumbPng,
    files: {
      [`${basePath}/${OCAD_V0.jsonFileName}`]: npcJson,
      [`${basePath}/${OCAD_V0.spriteFileName}`]: spritePng,
      [`${basePath}/thumb.png`]: thumbPng,
    },
  }
}
