import { state } from './appState.js'
import { $ } from './dom.js'
import { drawCharacterPackPlaceholder, initPlayablePreviewControls } from './characterPack/playablePreviewWidget.js'
import {
  clearCurrentFrameAdjustment,
  getCharacterPackGenerationLayoutLabel,
  getCharacterPackSourceLayoutLabel,
  getProviderPresetId,
  initManualAdjustmentControls,
  saveCurrentFrameAdjustment,
  setCharacterPackStatus,
  syncCharacterPackSourceLayoutControls,
  syncFrameAdjustmentControls,
  syncFrameNudgeLabels,
  syncGenerationModeCopy,
  syncLayoutModeCopy,
  syncLockedAnimationsFromSelect,
  syncTuningLabels,
} from './characterPack/controls.js'
import { refreshBenchmarkGallery } from './characterPack/benchmarkGalleryView.js'
import { initProviderConfigControls, refreshGeminiState } from './characterPack/providerStatus.js'
import { initCharacterPackWorkflowEvents } from './characterPack/workflows.js'
import { initExportModal } from './characterPack/renderers.js'

export function initCharacterPackTab() {
  drawCharacterPackPlaceholder()
  initExportModal()
  initManualAdjustmentControls()
  initProviderConfigControls()
  syncTuningLabels()
  refreshGeminiState()
  refreshBenchmarkGallery()
  initPlayablePreviewControls()
  syncLayoutModeCopy()
  syncGenerationModeCopy()

  for (const selector of ['#character-pack-bg-tolerance', '#character-pack-anchor-x', '#character-pack-anchor-y']) {
    $(selector).addEventListener('input', syncTuningLabels)
  }
  $('#character-pack-adjust-frame').addEventListener('change', syncFrameAdjustmentControls)
  $('#character-pack-frame-nudge-x').addEventListener('input', syncFrameNudgeLabels)
  $('#character-pack-frame-nudge-y').addEventListener('input', syncFrameNudgeLabels)
  $('#character-pack-save-frame-adjustment').addEventListener('click', saveCurrentFrameAdjustment)
  $('#character-pack-clear-frame-adjustment').addEventListener('click', clearCurrentFrameAdjustment)
  $('#character-pack-locked-animations').addEventListener('change', syncLockedAnimationsFromSelect)

  $('#character-pack-source-layout').addEventListener('change', () => {
    syncLayoutModeCopy()
    syncCharacterPackSourceLayoutControls()
    if (state.characterPack.file) {
      setCharacterPackStatus(`已切换源图布局：${getCharacterPackSourceLayoutLabel()}`, 'ready')
    }
  })
  $('#character-pack-generation-layout').addEventListener('change', () => {
    syncGenerationModeCopy()
    setCharacterPackStatus(`已切换 AI 生成布局：${getCharacterPackGenerationLayoutLabel()}`, 'ready')
  })
  $('#character-pack-provider-preset').addEventListener('change', () => {
    state.characterPack.providerPresetId = getProviderPresetId()
    const preset = state.characterPack.providerPresets.find((item) => item.id === state.characterPack.providerPresetId)
    if (preset) setCharacterPackStatus(`已切换 AI 生成通道：${preset.label}`, 'ready')
  })

  initCharacterPackWorkflowEvents()
}
