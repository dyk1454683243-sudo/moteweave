import { getAnimationNameForIntent, getMovementIntent, movePreviewActor } from '../../character-pack/playablePreview.js'
import {
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
  getFixedRegionSourceActionRegionKeys,
  scaleFixedRegionSourceRegion,
} from '../../character-pack/fixedRegionGeometry.js'
import {
  OCAD_SOURCE_ACTIONS,
  OCAD_SOURCE_ACTION_ORDER,
  OCAD_SOURCE_ACTION_RUNTIME_PREVIEW,
} from '../../character-pack/ocadSourceActions.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../character-pack/sourceLayoutIds.js'
import { state } from '../appState.js'
import { $, fetchJson } from '../dom.js'

const previewMovementKeys = new Set(['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export function drawCharacterPackPlaceholder(message = '等待处理') {
  const canvas = $('#character-pack-playground')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < canvas.height; y += 16) {
    for (let x = 0; x < canvas.width; x += 16) {
      ctx.fillStyle = (x / 16 + y / 16) % 2 ? '#101216' : '#0b0d11'
      ctx.fillRect(x, y, 16, 16)
    }
  }
  ctx.strokeStyle = '#14b8a655'
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  ctx.moveTo(0, 150)
  ctx.lineTo(canvas.width, 150)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#94a3b8'
  ctx.font = '700 16px sans-serif'
  ctx.fillText(message, 22, 36)
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法读取预览图片：${url}`))
    image.src = url
  })
}

export function stopPlayablePreview() {
  const preview = state.characterPack.preview
  if (preview.raf) cancelAnimationFrame(preview.raf)
  preview.raf = null
  const status = $('#character-pack-preview-state')
  if (status) status.dataset.state = 'idle'
}

function chooseAvailableAnimation(animations, preferred, fallback) {
  if (animations[preferred]) return preferred
  if (animations[fallback]) return fallback
  return Object.keys(animations)[0]
}

function animationDisplayName(name, animation) {
  if (animation?.display_label) return animation.display_label
  if (animation?.source_layout) return name
  return animation?.label ? `${animation.label} (${name})` : name
}

function isFixedRegionActionMode(job = {}, animations = {}) {
  return (
    job.source_action_layout === FIXED_REGION_MOTION_LAYOUT_ID ||
    animations.source_layout?.id === FIXED_REGION_MOTION_LAYOUT_ID ||
    state.characterPack.debugReport?.source_layout?.id === FIXED_REGION_MOTION_LAYOUT_ID
  )
}

function sourceActionDisplayName(action) {
  const info = OCAD_SOURCE_ACTIONS[action]
  return info?.zh ? `${action} · ${info.zh}` : action
}

function optionHtml({ value, label, previewAnimation = '', repairSupported = true }) {
  return `<option value="${value}" data-preview-animation="${previewAnimation}" data-repair-supported="${repairSupported ? 'true' : 'false'}">${label}</option>`
}

function sourceActionPreviewSpec(action) {
  const info = OCAD_SOURCE_ACTIONS[action]
  const keys = getFixedRegionSourceActionRegionKeys(action)
  return info && keys.length ? { ...info, keys } : null
}

function findInspectionAction(preview) {
  const actions = preview.inspectionIndex?.actions
  if (!Array.isArray(actions)) return null
  return actions.find((action) => action.name === preview.sourceActionName) ?? null
}

function drawFixedRegionInspectionFrame(ctx, preview, timestamp) {
  const action = findInspectionAction(preview)
  const frames = action?.sheet_frames ?? []
  if (!preview.inspectionImage || !frames.length) return false
  const sourceInfo = OCAD_SOURCE_ACTIONS[preview.sourceActionName]
  const delay = 1000 / Math.max(1, action.fps ?? sourceInfo?.fps ?? 5)
  if (!preview.lastTime || timestamp - preview.lastTime >= delay) {
    if (sourceInfo?.loop) preview.frameCursor = (preview.frameCursor + 1) % frames.length
    else preview.frameCursor = Math.min(preview.frameCursor + 1, frames.length - 1)
    preview.lastTime = timestamp
  }
  const frame = frames[Math.max(0, Math.min(frames.length - 1, preview.frameCursor))]
  const sourceW = frame.w ?? preview.inspectionIndex?.target_size?.w ?? 256
  const sourceH = frame.h ?? preview.inspectionIndex?.target_size?.h ?? 256
  const targetH = Math.min(184, ctx.canvas.height - 8)
  const scale = targetH / sourceH
  const targetW = Math.round(sourceW * scale)
  const dx = Math.round((ctx.canvas.width - targetW) / 2)
  const dy = Math.round(ctx.canvas.height - 8 - targetH)
  ctx.drawImage(preview.inspectionImage, frame.x, frame.y, sourceW, sourceH, dx, dy, targetW, targetH)
  const status = $('#character-pack-preview-state')
  if (status) {
    status.textContent = `${sourceActionDisplayName(preview.sourceActionName)} · x ${Math.round(preview.position.x)} y ${Math.round(preview.position.y)}`
    status.dataset.state = 'playing'
  }
  return true
}

function drawFixedRegionSourceFrame(ctx, preview, timestamp) {
  const action = preview.sourceActionName
  const sourceImage = preview.sourceImage
  const spec = sourceActionPreviewSpec(action)
  if (!sourceImage || !spec) return false
  const delay = 1000 / Math.max(1, spec.fps ?? 5)
  if (!preview.lastTime || timestamp - preview.lastTime >= delay) {
    if (spec.loop) preview.frameCursor = (preview.frameCursor + 1) % spec.keys.length
    else preview.frameCursor = Math.min(preview.frameCursor + 1, spec.keys.length - 1)
    preview.lastTime = timestamp
  }
  const key = spec.keys[Math.max(0, Math.min(spec.keys.length - 1, preview.frameCursor))]
  const region = scaleFixedRegionSourceRegion(FIXED_REGION_SOURCE_REGIONS[key], {
    width: sourceImage.naturalWidth || sourceImage.width || FIXED_REGION_SOURCE_SHEET.w,
    height: sourceImage.naturalHeight || sourceImage.height || FIXED_REGION_SOURCE_SHEET.h,
  })
  const scale = 2
  const dx = Math.round(preview.position.x - (region.w * scale) / 2)
  const dy = Math.round(preview.position.y - region.h * scale)
  ctx.drawImage(sourceImage, region.x, region.y, region.w, region.h, dx, dy, region.w * scale, region.h * scale)
  const status = $('#character-pack-preview-state')
  if (status) {
    status.textContent = `${sourceActionDisplayName(action)} · x ${Math.round(preview.position.x)} y ${Math.round(preview.position.y)}`
    status.dataset.state = 'playing'
  }
  return true
}

function drawPlayableFrame(timestamp = 0) {
  const preview = state.characterPack.preview
  const canvas = $('#character-pack-playground')
  const ctx = canvas.getContext('2d')
  const animations = preview.animations?.animations ?? {}
  if (!preview.image) return
  const movementDelta = preview.lastMoveTime ? timestamp - preview.lastMoveTime : 0
  preview.lastMoveTime = timestamp
  const intent = getMovementIntent(preview.keys, preview.direction)
  if (preview.sourceActionName) {
    preview.wasMoving = false
  } else if (intent.moving) {
    preview.direction = intent.direction
    preview.wasMoving = true
    preview.animationName = chooseAvailableAnimation(animations, getAnimationNameForIntent(intent, preview.direction), preview.animationName)
    preview.position = movePreviewActor(preview.position, intent, {
      deltaMs: movementDelta,
      speed: 72,
      minX: 48,
      maxX: canvas.width - 48,
      minY: 96,
      maxY: canvas.height - 18,
    })
  } else if (preview.wasMoving) {
    preview.wasMoving = false
    preview.animationName = chooseAvailableAnimation(animations, `idle_${preview.direction}`, preview.animationName)
  }
  const animation = animations[preview.animationName]
  if (!animation) return
  const frameSize = preview.animations.frame_size
  const sheetSize = preview.animations.sheet_size
  const framesPerRow = Math.max(1, Math.floor(sheetSize.w / frameSize.w))
  const delay = 1000 / Math.max(1, animation.fps ?? 8)
  if (!preview.lastTime || timestamp - preview.lastTime >= delay) {
    preview.frameCursor = (preview.frameCursor + 1) % animation.frames.length
    preview.lastTime = timestamp
  }
  const index = animation.frames[preview.frameCursor]
  const sx = (index % framesPerRow) * frameSize.w
  const sy = Math.floor(index / framesPerRow) * frameSize.h
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < canvas.height; y += 16) {
    for (let x = 0; x < canvas.width; x += 16) {
      ctx.fillStyle = (x / 16 + y / 16) % 2 ? '#101216' : '#0b0d11'
      ctx.fillRect(x, y, 16, 16)
    }
  }
  const scale = 2
  const anchor = preview.animations.anchor ?? { x: frameSize.w / 2, y: frameSize.h - 8 }
  const dx = Math.round(preview.position.x - anchor.x * scale)
  const dy = Math.round(preview.position.y - anchor.y * scale)
  ctx.strokeStyle = '#14b8a644'
  ctx.beginPath()
  ctx.moveTo(0, preview.position.y)
  ctx.lineTo(canvas.width, preview.position.y)
  ctx.stroke()
  if (drawFixedRegionInspectionFrame(ctx, preview, timestamp) || drawFixedRegionSourceFrame(ctx, preview, timestamp)) {
    preview.raf = requestAnimationFrame(drawPlayableFrame)
    return
  }
  ctx.drawImage(preview.image, sx, sy, frameSize.w, frameSize.h, dx, dy, frameSize.w * scale, frameSize.h * scale)
  const status = $('#character-pack-preview-state')
  if (status) {
    status.textContent = `${animationDisplayName(preview.animationName, animation)} · x ${Math.round(preview.position.x)} y ${Math.round(preview.position.y)}`
    status.dataset.state = 'playing'
  }
  preview.raf = requestAnimationFrame(drawPlayableFrame)
}

async function loadFixedRegionInspectionPreview(job, useFixedRegionActions) {
  if (!useFixedRegionActions || !job.inspection_sheet_url || !job.inspection_index_url) return { image: null, index: null }
  try {
    const [image, index] = await Promise.all([
      loadImageUrl(job.inspection_sheet_url),
      fetchJson(job.inspection_index_url),
    ])
    return { image, index }
  } catch {
    return { image: null, index: null }
  }
}

export async function startPlayablePreview(job) {
  stopPlayablePreview()
  if (!job.normalized_sheet_url || !job.animations_url) return
  const [image, animations] = await Promise.all([
    loadImageUrl(job.normalized_sheet_url),
    fetchJson(job.animations_url),
  ])
  const animationMap = animations.animations ?? {}
  const useFixedRegionActions = isFixedRegionActionMode(job, animations)
  const inspectionPreview = await loadFixedRegionInspectionPreview(job, useFixedRegionActions)
  const sourceImage = useFixedRegionActions && !inspectionPreview.image && job.source_url ? await loadImageUrl(job.source_url) : null
  const names = useFixedRegionActions
    ? OCAD_SOURCE_ACTION_ORDER
    : Object.keys(animationMap).filter((name) => !animationMap[name]?.ui_hidden)
  const select = $('#character-pack-animation')
  select.innerHTML = names
    .map((name) => {
      if (!useFixedRegionActions) {
        return optionHtml({ value: name, label: animationDisplayName(name, animationMap[name]), previewAnimation: name })
      }
      return optionHtml({
        value: name,
        label: sourceActionDisplayName(name),
        previewAnimation: OCAD_SOURCE_ACTION_RUNTIME_PREVIEW[name] ?? '',
        repairSupported: true,
      })
    })
    .join('')
  select.disabled = names.length === 0
  state.characterPack.preview.image = image
  state.characterPack.preview.inspectionImage = inspectionPreview.image
  state.characterPack.preview.inspectionIndex = inspectionPreview.index
  state.characterPack.preview.sourceImage = sourceImage
  state.characterPack.preview.animations = animations
  const preferred = useFixedRegionActions ? 'walkdown' : 'walk_down'
  const selectedName = names.includes(preferred) ? preferred : names[0]
  select.value = selectedName
  state.characterPack.preview.sourceActionName = useFixedRegionActions ? selectedName : null
  state.characterPack.preview.animationName =
    select.selectedOptions[0]?.dataset.previewAnimation ||
    (animationMap[selectedName] ? selectedName : Object.keys(animationMap)[0])
  state.characterPack.preview.frameCursor = 0
  state.characterPack.preview.lastTime = 0
  state.characterPack.preview.lastMoveTime = 0
  state.characterPack.preview.direction = 'down'
  state.characterPack.preview.position = { x: 192, y: 166 }
  state.characterPack.preview.wasMoving = false
  previewAnimationChanged()
  state.characterPack.preview.raf = requestAnimationFrame(drawPlayableFrame)
}

function previewAnimationChanged() {
  const preview = state.characterPack.preview
  const select = $('#character-pack-animation')
  const selected = select.selectedOptions[0]
  const previewAnimation = selected?.dataset.previewAnimation || select.value
  const fixedRegionSourceAction = Boolean(OCAD_SOURCE_ACTIONS[select.value])
  preview.sourceActionName = fixedRegionSourceAction ? select.value : null
  preview.animationName = preview.animations?.animations?.[previewAnimation] ? previewAnimation : preview.animationName
  const direction = preview.animationName?.split('_').pop()
  if (['down', 'up', 'left', 'right'].includes(direction)) preview.direction = direction
  preview.frameCursor = 0
  preview.lastTime = 0
}

function handlePreviewKey(event, pressed) {
  if (!previewMovementKeys.has(event.key)) return
  if (!$('#character-pack').classList.contains('active')) return
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return
  const preview = state.characterPack.preview
  if (!preview.animations) return
  event.preventDefault()
  if (pressed) preview.keys.add(event.key)
  else preview.keys.delete(event.key)
}

export function initPlayablePreviewControls() {
  $('#character-pack-animation')?.addEventListener('change', previewAnimationChanged)
  window.addEventListener('keydown', (event) => handlePreviewKey(event, true))
  window.addEventListener('keyup', (event) => handlePreviewKey(event, false))
}
