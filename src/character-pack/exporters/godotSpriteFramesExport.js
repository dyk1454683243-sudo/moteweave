export const GODOT_SPRITEFRAMES_V0 = Object.freeze({
  id: 'godot_spriteframes_v0',
  folderRoot: 'moteweave/spriteframes',
  resourceFileName: 'godot_spriteframes.tres',
})

const CLIP_NAME = /^[A-Za-z0-9_]+$/
const PACK_ID = /^[A-Za-z0-9_-]+$/
const SHEET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/

function fail(message) {
  throw new Error(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`)
  return value
}

function formatGodotFloat(value) {
  if (Object.is(value, -0)) return '0.0'
  if (Number.isSafeInteger(value)) return `${value}.0`
  const text = value.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0')
  if (!/^\d+\.\d+$/.test(text) || Number(text) === 0) fail(`cannot write fps ${value} as a Godot float`)
  return text
}

function requirePackId(packId) {
  if (packId === undefined || packId === null || packId === '') {
    fail('metadata.id is required for Godot SpriteFrames export')
  }
  if (typeof packId !== 'string' || !PACK_ID.test(packId)) {
    fail('metadata.id must match [A-Za-z0-9_-]+ for Godot SpriteFrames export')
  }
  return packId
}

function sheetFileName(sheet) {
  if (typeof sheet !== 'string' || !SHEET_NAME.test(sheet)) {
    fail('animations.json.sheet must be a png file name for Godot SpriteFrames export')
  }
  return sheet
}

function readFrames(name, frames, cellCount) {
  if (!Array.isArray(frames) || frames.length === 0) {
    fail(`animation "${name}" frames must be a non-empty list`)
  }
  return frames.map((index) => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= cellCount) {
      fail(`animation "${name}" frame index ${index} is outside the sheet`)
    }
    return index
  })
}

function readLoop(name, clip) {
  if (clip.flip_h !== false) fail(`animation "${name}" flip_h must be false`)
  if (clip.mode === 'pingpong') fail(`animation "${name}" mode "pingpong" is not supported`)
  if (clip.mode === 'loop' && clip.loop === true) return true
  if (clip.mode === 'once' && clip.loop === false) return false
  fail(`animation "${name}" mode "${String(clip.mode)}" and loop ${String(clip.loop)} do not agree`)
}

function readClip(name, clip, cellCount) {
  if (typeof name !== 'string' || !CLIP_NAME.test(name)) {
    fail(`animation name "${name}" must match [A-Za-z0-9_]+`)
  }
  if (!isPlainObject(clip)) fail(`animation "${name}" must be an object`)
  if (typeof clip.fps !== 'number' || !Number.isFinite(clip.fps) || clip.fps <= 0) {
    fail(`animation "${name}" fps must be a finite number greater than 0`)
  }
  const frames = readFrames(name, clip.frames, cellCount)
  const loop = readLoop(name, clip)
  return { name, frames, loop, speed: formatGodotFloat(clip.fps) }
}

function renderFrame(index) {
  return `{
"duration": 1.0,
"texture": SubResource("AtlasTexture_${index}")
}`
}

function renderClip(clip) {
  return `{
"frames": [${clip.frames.map(renderFrame).join(', ')}],
"loop": ${clip.loop ? 'true' : 'false'},
"name": &"${clip.name}",
"speed": ${clip.speed}
}`
}

export function buildGodotSpriteFramesTres(animationsJson, { packId } = {}) {
  const id = requirePackId(packId)
  if (!isPlainObject(animationsJson)) fail('animations.json is required for Godot SpriteFrames export')
  const sheet = sheetFileName(animationsJson.sheet)
  if (!isPlainObject(animationsJson.frame_size) || !isPlainObject(animationsJson.sheet_size)) {
    fail('animations.json frame_size and sheet_size are required for Godot SpriteFrames export')
  }
  const frameW = requirePositiveInteger(animationsJson.frame_size.w, 'animations.json.frame_size.w')
  const frameH = requirePositiveInteger(animationsJson.frame_size.h, 'animations.json.frame_size.h')
  const sheetW = requirePositiveInteger(animationsJson.sheet_size.w, 'animations.json.sheet_size.w')
  const sheetH = requirePositiveInteger(animationsJson.sheet_size.h, 'animations.json.sheet_size.h')
  if (sheetW % frameW !== 0 || sheetH % frameH !== 0) {
    fail('animations.json.sheet_size must divide evenly by frame_size')
  }
  const columns = sheetW / frameW
  const cellCount = columns * (sheetH / frameH)
  if (!isPlainObject(animationsJson.animations)) {
    fail('animations.json.animations is required for Godot SpriteFrames export')
  }

  const clips = Object.entries(animationsJson.animations).map(([name, clip]) => readClip(name, clip, cellCount))
  const atlasOrder = []
  const seen = new Set()
  for (const clip of clips) {
    for (const index of clip.frames) {
      if (seen.has(index)) continue
      seen.add(index)
      atlasOrder.push(index)
    }
  }

  const lines = [
    `[gd_resource type="SpriteFrames" load_steps=${2 + atlasOrder.length} format=3]`,
    '',
    `[ext_resource type="Texture2D" path="res://${GODOT_SPRITEFRAMES_V0.folderRoot}/${id}/${sheet}" id="1_sheet"]`,
    '',
  ]
  for (const index of atlasOrder) {
    const column = index % columns
    const row = Math.floor(index / columns)
    lines.push(
      `[sub_resource type="AtlasTexture" id="AtlasTexture_${index}"]`,
      'atlas = ExtResource("1_sheet")',
      `region = Rect2(${column * frameW}, ${row * frameH}, ${frameW}, ${frameH})`,
      '',
    )
  }
  lines.push('[resource]')
  lines.push(`animations = [${clips.map(renderClip).join(', ')}]`)
  return `${lines.join('\n')}\n`
}

export function buildGodotSpriteFramesExport({ metadata, animationsJson, sheetPng } = {}) {
  if (!Buffer.isBuffer(sheetPng)) fail('sheetPng buffer is required for Godot SpriteFrames export')
  const tres = buildGodotSpriteFramesTres(animationsJson, { packId: metadata?.id })
  const basePath = `${GODOT_SPRITEFRAMES_V0.folderRoot}/${metadata.id}`
  return {
    exportProfile: GODOT_SPRITEFRAMES_V0.id,
    basePath,
    tres,
    files: {
      [`${basePath}/${GODOT_SPRITEFRAMES_V0.resourceFileName}`]: Buffer.from(tres, 'utf8'),
      [`${basePath}/${animationsJson.sheet}`]: sheetPng,
    },
  }
}
