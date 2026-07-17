import { DEFAULT_GENERATION_PRESET, DEFAULT_UPLOAD_SOURCE_LAYOUT } from '../../character-pack/generationDefaults.js'
import {
  OCAD_SOURCE_ACTIONS,
  OCAD_SOURCE_ACTION_ORDER,
  OCAD_SOURCE_ACTION_RUNTIME_PREVIEW,
} from '../../character-pack/ocadSourceActions.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../character-pack/sourceLayoutIds.js'
import { state } from '../appState.js'
import { $ } from '../dom.js'
import { setManualCutLinesEnabled } from './cutLineEditor.js'

const CHARACTER_PACK_ANIMATIONS = [
  'idle_down',
  'idle_up',
  'idle_left',
  'idle_right',
  'walk_down',
  'walk_up',
  'walk_left',
  'walk_right',
  'attack_down',
  'attack_up',
  'attack_left',
  'attack_right',
  'hurt',
  'happy',
  'sit',
  'talk',
]

const LAYOUT_MODE_COPY = {
  topdown_rpg_v0: {
    label: '8x8 标准序列帧',
    layoutHint: '8x8 模式按等宽等高单元格切图，AI 会使用 8x8 结构模板。',
    fileHint: '上传图应为 8 列 x 8 行；Manual cut lines 只在这个模式可用。',
    generateHint: '会使用 8x8 模板约束生成等格 Sprite Sheet，再进入同一条后处理流水线。',
  },
  [FIXED_REGION_MOTION_LAYOUT_ID]: {
    label: '固定区域动作源图',
    layoutHint: '固定区域模式按动作区域切图，报告会保留源动作语义并映射到内部 runtime。',
    fileHint: '上传图应保留 252x252 一图动作区域比例；Manual cut lines 会关闭，左右向由源动作映射处理。',
    generateHint: '会使用固定区域动作模板约束生成，再归一化成 8x8 runtime Sheet。',
  },
}

export function setCharacterPackStatus(message, status = 'idle') {
  const statusLine = $('#character-pack-status')
  statusLine.textContent = message
  statusLine.dataset.status = status
}

export function formatJobStatus(job) {
  if (!job) return 'idle'
  if (job.status === 'done') return '处理完成'
  const status = job.failure_status ? `${job.status} · ${job.failure_status}` : job.status
  return job.reason ? `${status}: ${job.reason}` : status
}

export function getCharacterPackSourceLayout() {
  return $('#character-pack-source-layout')?.value || DEFAULT_UPLOAD_SOURCE_LAYOUT
}

export function getCharacterPackGenerationLayout() {
  return $('#character-pack-generation-layout')?.value || DEFAULT_GENERATION_PRESET
}

export function getCharacterPackSourceLayoutLabel() {
  return LAYOUT_MODE_COPY[getCharacterPackSourceLayout()]?.label ?? '源图布局'
}

export function getCharacterPackGenerationLayoutLabel() {
  return LAYOUT_MODE_COPY[getCharacterPackGenerationLayout()]?.label ?? 'AI 生成布局'
}

export function syncLayoutModeCopy() {
  const copy = LAYOUT_MODE_COPY[getCharacterPackSourceLayout()] ?? LAYOUT_MODE_COPY.topdown_rpg_v0
  const layoutHint = $('#character-pack-layout-hint')
  if (layoutHint) layoutHint.textContent = copy.layoutHint
  const fileHint = $('#character-pack-file-hint')
  if (fileHint) fileHint.textContent = copy.fileHint
}

export function syncGenerationModeCopy() {
  const copy = LAYOUT_MODE_COPY[getCharacterPackGenerationLayout()] ?? LAYOUT_MODE_COPY[FIXED_REGION_MOTION_LAYOUT_ID]
  const generateHint = $('#character-pack-generate-hint')
  if (generateHint) generateHint.textContent = copy.generateHint
}

export function getProviderPresetId() {
  return $('#character-pack-provider-preset')?.value || state.characterPack.providerPresetId || ''
}

function getNumberControl(selector, fallback = 0) {
  const value = Number($(selector)?.value)
  return Number.isFinite(value) ? value : fallback
}

export function getCharacterPackTuningOptions() {
  const lockedAnimations = state.characterPack.lockedAnimations
    .map((animation) => OCAD_SOURCE_ACTION_RUNTIME_PREVIEW[animation] ?? animation)
    .filter(Boolean)
  return {
    backgroundTolerance: getNumberControl('#character-pack-bg-tolerance', 24),
    anchorOffset: {
      x: getNumberControl('#character-pack-anchor-x', 0),
      y: getNumberControl('#character-pack-anchor-y', 0),
    },
    frameAdjustments: Object.entries(state.characterPack.manualFrameAdjustments)
      .map(([frame, adjustment]) => ({ frame: Number(frame), dx: adjustment.dx, dy: adjustment.dy }))
      .filter((adjustment) => adjustment.dx || adjustment.dy),
    lockedAnimations: [...new Set(lockedAnimations)],
  }
}

export function syncTuningLabels() {
  const tolerance = getNumberControl('#character-pack-bg-tolerance', 24)
  const anchorX = getNumberControl('#character-pack-anchor-x', 0)
  const anchorY = getNumberControl('#character-pack-anchor-y', 0)
  $('#character-pack-bg-tolerance-value').textContent = String(tolerance)
  $('#character-pack-anchor-x-value').textContent = String(anchorX)
  $('#character-pack-anchor-y-value').textContent = String(anchorY)
}

export function syncFrameAdjustmentControls() {
  const frame = Number($('#character-pack-adjust-frame')?.value ?? 0)
  const adjustment = state.characterPack.manualFrameAdjustments[frame] ?? { dx: 0, dy: 0 }
  $('#character-pack-frame-nudge-x').value = String(adjustment.dx)
  $('#character-pack-frame-nudge-y').value = String(adjustment.dy)
  $('#character-pack-frame-nudge-x-value').textContent = String(adjustment.dx)
  $('#character-pack-frame-nudge-y-value').textContent = String(adjustment.dy)
  const adjustmentCount = Object.keys(state.characterPack.manualFrameAdjustments).length
  $('#character-pack-adjustment-summary').textContent = `${adjustmentCount} frames · ${state.characterPack.lockedAnimations.length} locked`
}

export function syncFrameNudgeLabels() {
  $('#character-pack-frame-nudge-x-value').textContent = String(getNumberControl('#character-pack-frame-nudge-x', 0))
  $('#character-pack-frame-nudge-y-value').textContent = String(getNumberControl('#character-pack-frame-nudge-y', 0))
}

export function saveCurrentFrameAdjustment() {
  const frame = Number($('#character-pack-adjust-frame').value)
  const dx = getNumberControl('#character-pack-frame-nudge-x', 0)
  const dy = getNumberControl('#character-pack-frame-nudge-y', 0)
  if (!dx && !dy) delete state.characterPack.manualFrameAdjustments[frame]
  else state.characterPack.manualFrameAdjustments[frame] = { dx, dy }
  syncFrameAdjustmentControls()
  setCharacterPackStatus(`已保存帧 ${frame} 微调`, 'ready')
}

export function clearCurrentFrameAdjustment() {
  const frame = Number($('#character-pack-adjust-frame').value)
  delete state.characterPack.manualFrameAdjustments[frame]
  syncFrameAdjustmentControls()
  setCharacterPackStatus(`已清除帧 ${frame} 微调`, 'ready')
}

export function syncLockedAnimationsFromSelect() {
  state.characterPack.lockedAnimations = [...$('#character-pack-locked-animations').selectedOptions].map((option) => option.value)
  syncFrameAdjustmentControls()
}

function lockedAnimationOptions() {
  if (getCharacterPackSourceLayout() !== FIXED_REGION_MOTION_LAYOUT_ID) {
    return CHARACTER_PACK_ANIMATIONS.map((animation) => ({ value: animation, label: animation, disabled: false }))
  }
  return OCAD_SOURCE_ACTION_ORDER.map((action) => {
    const info = OCAD_SOURCE_ACTIONS[action]
    const runtime = OCAD_SOURCE_ACTION_RUNTIME_PREVIEW[action]
    return {
      value: action,
      label: `${action}${info?.zh ? ` · ${info.zh}` : ''}`,
      disabled: !runtime,
    }
  })
}

export function renderLockedAnimationOptions() {
  const animationSelect = $('#character-pack-locked-animations')
  const selected = new Set(state.characterPack.lockedAnimations)
  animationSelect.innerHTML = ''
  for (const animation of lockedAnimationOptions()) {
    const option = document.createElement('option')
    option.value = animation.value
    option.textContent = animation.label
    option.disabled = animation.disabled
    option.selected = !animation.disabled && selected.has(animation.value)
    animationSelect.append(option)
  }
  state.characterPack.lockedAnimations = [...animationSelect.selectedOptions].map((option) => option.value)
  syncFrameAdjustmentControls()
}

export function initManualAdjustmentControls() {
  const frameSelect = $('#character-pack-adjust-frame')
  frameSelect.innerHTML = ''
  for (let i = 0; i < 64; i++) {
    const option = document.createElement('option')
    option.value = String(i)
    option.textContent = `Frame ${i}`
    frameSelect.append(option)
  }

  renderLockedAnimationOptions()
}

export function renderProviderPresetOptions(providerState) {
  const select = $('#character-pack-provider-preset')
  if (!select) return
  const presets = Array.isArray(providerState.presets) ? providerState.presets : []
  state.characterPack.providerPresets = presets
  select.innerHTML = ''
  if (!providerState.implemented) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'AI 生成未实现'
    select.append(option)
    select.disabled = true
    state.characterPack.providerPresetId = null
    return
  }
  if (!presets.length) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '没有可选通道'
    select.append(option)
    select.disabled = true
    state.characterPack.providerPresetId = null
    return
  }
  for (const preset of presets) {
    const option = document.createElement('option')
    option.value = preset.id
    option.disabled = !preset.available
    option.textContent = `${preset.label} · ${preset.model}${preset.available ? '' : '（未配置 key）'}`
    select.append(option)
  }
  const available = presets.filter((preset) => preset.available)
  const preferred =
    state.characterPack.providerPresetId ||
    providerState.active_preset_id ||
    available[0]?.id ||
    presets[0]?.id ||
    ''
  select.value = presets.some((preset) => preset.id === preferred) ? preferred : available[0]?.id || presets[0]?.id || ''
  state.characterPack.providerPresetId = select.value || null
  select.disabled = !available.length
}

export function syncCharacterPackSourceLayoutControls() {
  const hasFile = Boolean(state.characterPack.file)
  const isUniformGrid = getCharacterPackSourceLayout() === 'topdown_rpg_v0'
  if (!isUniformGrid && state.characterPack.useManualCutLines) setManualCutLinesEnabled(false)
  $('#character-pack-auto-grid').disabled = !hasFile || !isUniformGrid
  $('#character-pack-manual-grid').disabled = !hasFile || !isUniformGrid
  $('#character-pack-reset-grid').disabled = !hasFile || !isUniformGrid
  $('#character-pack-reslice').disabled = !hasFile
  renderLockedAnimationOptions()
}
