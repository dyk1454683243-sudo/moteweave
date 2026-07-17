import sharp from 'sharp'

import {
  FIXED_REGION_SOURCE_REGIONS,
  scaleFixedRegionSourceRegion,
} from '../fixedRegionGeometry.js'
import { loadRgba } from '../imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { RPGMAKER_V0 } from './exportProfiles.js'

function sourceFrameFor(animation, sourceColumn, profile) {
  return animation.row * profile.grid.columns + animation.startCol + sourceColumn
}

function getAnimation(profile, name) {
  const animation = profile.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Missing source animation for RPGMaker export: ${name}`)
  return animation
}

async function copyScaledFrame({ frame, target, targetWidth, targetX, targetY }) {
  const src = frame.image
  const scale = Math.min(RPGMAKER_V0.frame.w / src.width, RPGMAKER_V0.frame.h / src.height)
  const scaledW = Math.max(1, Math.round(src.width * scale))
  const scaledH = Math.max(1, Math.round(src.height * scale))
  const data = await sharp(Buffer.from(src.data), { raw: { width: src.width, height: src.height, channels: 4 } })
    .resize(scaledW, scaledH, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
  const dx = targetX + Math.floor((RPGMAKER_V0.frame.w - scaledW) / 2)
  const dy = targetY + RPGMAKER_V0.frame.h - scaledH
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

async function copySourceRegion({ source, regionKey, target, targetWidth, targetX, targetY, flipH = false }) {
  const region = scaleFixedRegionSourceRegion(FIXED_REGION_SOURCE_REGIONS[regionKey], source)
  const scale = Math.min(RPGMAKER_V0.frame.w / region.w, RPGMAKER_V0.frame.h / region.h)
  const scaledW = Math.max(1, Math.round(region.w * scale))
  const scaledH = Math.max(1, Math.round(region.h * scale))
  const data = await sharp(Buffer.from(source.data), { raw: { width: source.width, height: source.height, channels: 4 } })
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
    .resize(scaledW, scaledH, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
  const dx = targetX + Math.floor((RPGMAKER_V0.frame.w - scaledW) / 2)
  const dy = targetY + RPGMAKER_V0.frame.h - scaledH
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const sourceX = flipH ? scaledW - 1 - x : x
      const srcOffset = (y * scaledW + sourceX) * 4
      const dstOffset = ((dy + y) * targetWidth + dx + x) * 4
      target[dstOffset] = data[srcOffset]
      target[dstOffset + 1] = data[srcOffset + 1]
      target[dstOffset + 2] = data[srcOffset + 2]
      target[dstOffset + 3] = data[srcOffset + 3]
    }
  }
}

async function renderRpgmakerSprite(frames, profile) {
  const target = new Uint8ClampedArray(RPGMAKER_V0.sheet.w * RPGMAKER_V0.sheet.h * 4)
  for (const rowDef of RPGMAKER_V0.rows) {
    const sourceAnimation = getAnimation(profile, rowDef.source)
    for (let col = 0; col < RPGMAKER_V0.grid.columns; col++) {
      const frameIndex = sourceFrameFor(sourceAnimation, RPGMAKER_V0.sourceColumns[col], profile)
      const frame = frames[frameIndex]
      if (!frame) throw new Error(`Missing normalized frame ${frameIndex} for RPGMaker export`)
      await copyScaledFrame({
        frame,
        target,
        targetWidth: RPGMAKER_V0.sheet.w,
        targetX: col * RPGMAKER_V0.frame.w,
        targetY: rowDef.row * RPGMAKER_V0.frame.h,
      })
    }
  }
  return sharp(Buffer.from(target), { raw: { width: RPGMAKER_V0.sheet.w, height: RPGMAKER_V0.sheet.h, channels: 4 } }).png().toBuffer()
}

async function renderRpgmakerSpriteFromSource(sourcePng) {
  const source = await loadRgba(sourcePng)
  if (source.width !== 252 || source.height !== 252) return null
  const target = new Uint8ClampedArray(RPGMAKER_V0.sheet.w * RPGMAKER_V0.sheet.h * 4)
  const rows = [
    { row: 0, keys: ['walkdown0', 'walkdown1', 'walkdown2'], flipH: false },
    { row: 1, keys: ['walkL0', 'walkL1', 'walkL2'], flipH: false },
    { row: 2, keys: ['walkL0', 'walkL1', 'walkL2'], flipH: true },
    { row: 3, keys: ['walkup0', 'walkup1', 'walkup2'], flipH: false },
  ]
  for (const rowDef of rows) {
    for (const [col, regionKey] of rowDef.keys.entries()) {
      await copySourceRegion({
        source,
        regionKey,
        target,
        targetWidth: RPGMAKER_V0.sheet.w,
        targetX: col * RPGMAKER_V0.frame.w,
        targetY: rowDef.row * RPGMAKER_V0.frame.h,
        flipH: rowDef.flipH,
      })
    }
  }
  return sharp(Buffer.from(target), { raw: { width: RPGMAKER_V0.sheet.w, height: RPGMAKER_V0.sheet.h, channels: 4 } }).png().toBuffer()
}

export function buildRpgmakerNpcJson({ metadata, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!metadata?.id) throw new Error('metadata.id is required for RPGMaker export')
  const id = `${metadata.id}_rpgmaker`
  const displayName = `${metadata.name || metadata.id} RPGMaker`
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
      tags: ['ai_generated', profile.id, RPGMAKER_V0.id],
    },
    assets: {
      spritePath: './sprite.png',
      thumbPath: './thumb.png',
    },
    spritesheet: {
      layoutVersion: 'rpgmaker_v1',
      frameWidth: RPGMAKER_V0.frame.w,
      frameHeight: RPGMAKER_V0.frame.h,
      columns: RPGMAKER_V0.grid.columns,
      rows: RPGMAKER_V0.grid.rows,
      margin: 0,
      spacing: 0,
      defaultFps: 5,
      animations: Object.fromEntries(
        RPGMAKER_V0.rows.map((row) => [
          row.name,
          {
            row: row.row,
            from: 0,
            to: 2,
            loop: true,
          },
        ])
      ),
    },
    gameplay: {
      faction: 'neutral',
      role: 'generated_character',
      level: 1,
      stats: { hp: 100, attack: 10, defense: 5, moveSpeed: 100 },
      interaction: { canTalk: true, canTrade: false, questGiver: false },
    },
    ext: {
      librarySortPriority: 120,
      sourceProfile: profile.id,
      exportProfile: RPGMAKER_V0.id,
      cardPreviewAnim: 'rundown',
      localization: {
        appearance: { zh: metadata.description || displayName, ja: '', en: '' },
        background: { zh: `${displayName} 是 RPGMaker 兼容导出。`, ja: '', en: '' },
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

export async function buildRpgmakerExport({ metadata, frames, profile = TOPDOWN_RPG_V0, sourcePng = null, sourceLayout = null } = {}) {
  if (!Array.isArray(frames)) throw new Error('normalized frames are required for RPGMaker export')
  const npcJson = buildRpgmakerNpcJson({ metadata, profile })
  const basePath = `${RPGMAKER_V0.folderRoot}/${npcJson.meta.id}`
  const sourceNativeSprite = sourceLayout?.kind === 'fixed_regions' && sourcePng
    ? await renderRpgmakerSpriteFromSource(sourcePng)
    : null
  const spritePng = sourceNativeSprite ?? await renderRpgmakerSprite(frames, profile)
  const thumbPng = await sharp(spritePng).extract({ left: 0, top: 0, width: RPGMAKER_V0.frame.w, height: RPGMAKER_V0.frame.h }).png().toBuffer()
  return {
    basePath,
    npcJson,
    spritePng,
    thumbPng,
    files: {
      [`${basePath}/${RPGMAKER_V0.jsonFileName}`]: npcJson,
      [`${basePath}/${RPGMAKER_V0.spriteFileName}`]: spritePng,
      [`${basePath}/thumb.png`]: thumbPng,
    },
  }
}
