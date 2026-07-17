import sharp from 'sharp'

import { TOPDOWN_RPG_V0 } from '../profile.js'

export const GODOT_NPC_RESOURCE_ROOT = 'AI资源库/一图全动作'

function buildSpritesheet(profile) {
  return {
    layoutVersion: 'json_grid',
    frameWidth: profile.frame.w,
    frameHeight: profile.frame.h,
    columns: profile.grid.columns,
    rows: profile.grid.rows,
    margin: 0,
    spacing: 0,
    defaultFps: 8,
    animations: Object.fromEntries(
      profile.animations.map((animation) => [
        animation.name,
        {
          row: animation.row,
          from: animation.startCol,
          to: animation.startCol + animation.count - 1,
          loop: animation.loop,
        },
      ])
    ),
  }
}

function buildGameplay({ category = 'function', role = 'generated_character' } = {}) {
  return {
    faction: 'neutral',
    role,
    level: 1,
    stats: {
      hp: 100,
      attack: 10,
      defense: 5,
      moveSpeed: 100,
    },
    interaction: {
      canTalk: true,
      canTrade: category === 'shop',
      questGiver: category === 'quest',
    },
  }
}

export function buildGodotNpcJson({
  metadata,
  profile = TOPDOWN_RPG_V0,
  style = 'modern',
  category = 'function',
  role = 'generated_character',
  sortPriority = 100,
} = {}) {
  if (!metadata?.id) throw new Error('metadata.id is required for Godot NPC export')
  const createdAt = metadata.created_at ?? new Date().toISOString()
  const displayName = metadata.name || metadata.id
  const description = metadata.description || displayName

  return {
    schemaVersion: 1,
    meta: {
      id: metadata.id,
      displayName,
      style,
      category,
      types: [category],
      description,
      generator: 'ai_character_pack_pipeline',
      createdAt,
      updatedAt: createdAt,
      tags: ['ai_generated', profile.id],
    },
    assets: {
      spritePath: './sprite.png',
      thumbPath: './thumb.png',
    },
    spritesheet: buildSpritesheet(profile),
    gameplay: buildGameplay({ category, role }),
    ext: {
      librarySortPriority: sortPriority,
      spritesheetSlice: 'json_grid',
      cardPreviewAnim: 'walk_down',
      sourceProfile: profile.id,
      sourceQualityStatus: metadata.quality?.status ?? 'unknown',
      localization: {
        appearance: {
          zh: description,
          ja: '',
          en: '',
        },
        background: {
          zh: `${displayName} 是由网页角色包管线生成并标准化的可导入 NPC。`,
          ja: '',
          en: '',
        },
        dialogues: {
          greeting: {
            zh: `你好，我是${displayName}。`,
            ja: '',
            en: '',
          },
          shopOpen: {
            zh: '需要看看我的物品吗？',
            ja: '',
            en: '',
          },
          questHint: {
            zh: '也许我们之后会有新的任务。',
            ja: '',
            en: '',
          },
        },
      },
      otherPayload: {},
      projectPrivate: {},
    },
  }
}

export function buildGodotNpcExport({ metadata, spritePng, thumbPng, profile = TOPDOWN_RPG_V0 } = {}) {
  if (!Buffer.isBuffer(spritePng)) throw new Error('spritePng buffer is required for Godot NPC export')
  if (!Buffer.isBuffer(thumbPng)) throw new Error('thumbPng buffer is required for Godot NPC export')
  const npcJson = buildGodotNpcJson({ metadata, profile })
  const basePath = `${GODOT_NPC_RESOURCE_ROOT}/${metadata.id}`

  return {
    basePath,
    npcJson,
    files: {
      [`${basePath}/npc.json`]: npcJson,
      [`${basePath}/sprite.png`]: spritePng,
      [`${basePath}/thumb.png`]: thumbPng,
    },
  }
}

export async function buildGodotNpcThumbPng(normalizedSheetPng, profile = TOPDOWN_RPG_V0) {
  const idleDown = profile.animations.find((animation) => animation.name === 'idle_down') ?? profile.animations[0]
  return sharp(normalizedSheetPng)
    .ensureAlpha()
    .extract({
      left: idleDown.startCol * profile.frame.w,
      top: idleDown.row * profile.frame.h,
      width: profile.frame.w,
      height: profile.frame.h,
    })
    .png()
    .toBuffer()
}
