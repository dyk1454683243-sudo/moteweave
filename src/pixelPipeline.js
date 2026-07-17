export const SCENE_PRESETS = {
  'topdown-front': {
    label: 'topdown 正视',
    title: '正视 TopDown 场景',
    rules: [
      '视角：topdown 正视，建筑全部正朝向，不使用 45 度透视。',
      '构图：主体建筑、道路、入口和可通行区域必须清晰。',
      '禁忌：不要人物、UI、文字、水印。',
    ],
  },
  'topdown-45': {
    label: 'topdown 45度',
    title: '45 度 TopDown 场景',
    rules: [
      '视角：topdown 45度，建筑朝向统一为 45 度。',
      '构图：地形、建筑和可通行区域必须能作为游戏地图读取。',
      '禁忌：不要人物、UI、文字、水印，不出现天空主画面。',
    ],
  },
  'terraria-side': {
    label: '横版泰拉',
    title: '横版探索场景',
    rules: [
      '视角：2D 横版侧视，强调可探索地形和清晰平台层级。',
      '构图：前景地块、中景平台、远景环境要分层，但不要遮挡通行读图。',
      '禁忌：不要人物、UI、文字、水印。',
    ],
  },
  'arcade-side': {
    label: '横版街机',
    title: '横版街机场景',
    rules: [
      '视角：严格横版街机侧视。',
      '构图：必须包含远景、中景、前景三个视差层，强调水平方向推进感。',
      '远景：地标、天际线、山体或大月亮等低细节元素。',
      '中景：主要可通行区域、平台、街道或室内结构。',
      '前景：管线、栏杆、车辆残骸等快速掠过的遮挡元素。',
      '禁忌：不要人物、UI、文字、水印。',
    ],
  },
}

export const CHARACTER_PRESETS = {
  'rpgmaker-v1': 'RPGMaker V1',
  'rpgmaker-v3': 'RPGMaker V3',
  'character-v2': '常规角色 V2',
  'character-v2-2': '常规角色 V2.2',
  'character-v3': '常规角色 V3',
  'character-v2-3ot': 'V2.3OT',
  monster: '怪物',
  animal: '动物',
  'horizontal-character': '横版人物',
  'topdown-8dir': '八方向 TopDown',
  'horse-riding': '骑马动作',
  'one-image-all-actions': '一图全动作',
}

const FALLBACK_SCENE = 'topdown-front'
const FALLBACK_CHARACTER = 'character-v2'

function cleanText(value, fallback) {
  const text = String(value ?? '').trim()
  return text || fallback
}

function roundTime(value) {
  return Math.round(value * 1000) / 1000
}

export function buildScenePrompt({ view, theme, composition, style } = {}) {
  const preset = SCENE_PRESETS[view] ?? SCENE_PRESETS[FALLBACK_SCENE]
  const subject = cleanText(theme, '未指定主题，请生成一个清晰可用的像素游戏场景。')
  const layout = cleanText(composition, '主体、可通行区域、装饰物和边界层次清楚。')
  const visualStyle = cleanText(style, '清晰像素块，统一调色，明确光源，可读性高。')

  return [
    `生成 ${preset.label} 像素场景。`,
    `类型：${preset.title}`,
    `主题：${subject}`,
    `构图：${layout}`,
    `风格：${visualStyle}`,
    '',
    '画面规范：',
    ...preset.rules.map((rule) => `- ${rule}`),
    '- 输出应是一张完整背景或全景图，不直接生成角色动作。',
    '- 只输出完整场景图。',
  ].join('\n')
}

export function buildCharacterPrompt({ preset, character, hasReferenceImage = false } = {}) {
  const presetName = CHARACTER_PRESETS[preset] ?? CHARACTER_PRESETS[FALLBACK_CHARACTER]
  const subject = cleanText(character, '一个轮廓清楚、配色稳定、适合游戏内使用的像素角色。')
  const referenceLine = hasReferenceImage
    ? '如果提供角色参考图，请将角色参考图放在模板图之后；用它提取身份、服装、颜色和关键视觉特征。'
    : '如果没有角色参考图，请完全根据用户描述替换主角。'

  return [
    `使用前面的模板 Sprite Sheet 作为 ${presetName} 格式参考。`,
    referenceLine,
    '根据用户描述替换主角，但严格保持模板中的动作顺序、朝向、姿势、比例、留白、单元格间距、画布尺寸和 Sprite Sheet 布局。',
    `角色：${subject}`,
    '背景纯白或透明。',
    '不要文字、编号、UI、网格线、边框、水印或额外符号。',
    '只输出一张完成后的像素风 Sprite Sheet。',
  ].join('\n')
}

function toInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeExportParams(params = {}) {
  return {
    targetW: clamp(toInt(params.targetW, 256), 1, 4096),
    targetH: clamp(toInt(params.targetH, 256), 1, 4096),
    padding: clamp(toInt(params.padding, 0), 0, 128),
    spacing: clamp(toInt(params.spacing, 0), 0, 128),
    columns: clamp(toInt(params.columns, 4), 1, 64),
    fps: clamp(toInt(params.fps, 12), 1, 120),
  }
}

export function buildSpriteIndex({
  frameCount = 0,
  targetW = 256,
  targetH = 256,
  spacing = 0,
  columns = 4,
  fps = 12,
  timestamps = [],
} = {}) {
  const normalized = normalizeExportParams({ targetW, targetH, spacing, columns, fps })
  const count = clamp(toInt(frameCount, 0), 0, 100000)
  const rows = count === 0 ? 0 : Math.ceil(count / normalized.columns)
  const sheetW = count === 0 ? 0 : normalized.columns * (normalized.targetW + normalized.spacing) - normalized.spacing
  const sheetH = rows === 0 ? 0 : rows * (normalized.targetH + normalized.spacing) - normalized.spacing
  const frames = Array.from({ length: count }, (_, i) => {
    const col = i % normalized.columns
    const row = Math.floor(i / normalized.columns)
    return {
      i,
      x: col * (normalized.targetW + normalized.spacing),
      y: row * (normalized.targetH + normalized.spacing),
      w: normalized.targetW,
      h: normalized.targetH,
      t: roundTime(Number.isFinite(timestamps[i]) ? timestamps[i] : i / normalized.fps),
    }
  })

  return {
    version: '1.0',
    frame_size: { w: normalized.targetW, h: normalized.targetH },
    sheet_size: { w: sheetW, h: sheetH },
    frames,
  }
}
