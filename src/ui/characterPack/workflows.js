import { state } from '../appState.js'
import { $, loadImage, setPreviewImage, showToast } from '../dom.js'
import { generateCharacterSheet, processCharacterSheet, repairCharacterAction, waitForJob } from './api.js'
import { getManualOverridesForRequest, makeEvenCutLines, resetManualCutLines, setManualCutLinesEnabled } from './cutLineEditor.js'
import { drawCharacterPackPlaceholder, stopPlayablePreview } from './playablePreviewWidget.js'
import {
  formatJobStatus,
  getCharacterPackGenerationLayout,
  getCharacterPackSourceLayout,
  getCharacterPackTuningOptions,
  getProviderPresetId,
  setCharacterPackStatus,
  syncCharacterPackSourceLayoutControls,
  syncFrameAdjustmentControls,
} from './controls.js'
import { refreshBenchmarkGallery } from './benchmarkGalleryView.js'
import { renderCharacterPackJob } from './jobRenderer.js'
import { refreshGeminiState } from './providerStatus.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../character-pack/sourceLayoutIds.js'
import {
  clearActionRepairPlan,
  selectedRepairAnimation,
  selectedRepairAnimations,
  setActionRepairStatus,
  syncActionRepairControls,
} from './repairControls.js'

function pixelFinishingOptions() {
  const enabled = $('#character-pack-pixel-finishing')?.checked ?? false
  const maxColors = Number($('#character-pack-style-max-colors')?.value ?? 16)
  return {
    pixelFinishing: enabled,
    pixelFinishingMaxColors: maxColors,
    pixelFinishingOutline: $('#character-pack-pixel-outline')?.checked ?? true,
    pixelFinishingOutlineMode: $('#character-pack-pixel-outline-mode')?.value ?? 'outer',
    styleReport: ($('#character-pack-style-report')?.checked ?? false) || enabled,
    styleMaxColors: maxColors,
  }
}

function localFixedRegionStagingOptions(sourceLayout) {
  if (sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID) return {}
  return {
    fixedRegionSourceStaging: 'fixed_region_256_crop',
    fixedRegionStageSize: 256,
    fixedRegionCropRight: 4,
    fixedRegionCropBottom: 4,
    fixedRegionMatteTolerance: 80,
  }
}

async function handleCharacterPackFile(file) {
  if (state.characterPack.sourceUrl) URL.revokeObjectURL(state.characterPack.sourceUrl)
  const { image, url } = await loadImage(file)
  state.characterPack.file = file
  state.characterPack.blackFile = null
  state.characterPack.referenceFile = null
  state.characterPack.paletteFile = null
  state.characterPack.job = null
  state.characterPack.debugReport = null
  state.characterPack.repairActions = []
  clearActionRepairPlan()
  state.characterPack.manualFrameAdjustments = {}
  state.characterPack.lockedAnimations = []
  for (const option of $('#character-pack-locked-animations').options) option.selected = false
  syncFrameAdjustmentControls()
  stopPlayablePreview()
  state.characterPack.sourceUrl = url
  state.characterPack.sourceSize = { width: image.width, height: image.height }
  state.characterPack.manualCutLines = makeEvenCutLines(image.width, image.height)
  state.characterPack.useManualCutLines = false
  setPreviewImage('#character-pack-source-preview', state.characterPack.sourceUrl)
  setPreviewImage('#character-pack-normalized-preview', null)
  setPreviewImage('#character-pack-debug-preview', null)
  $('#process-character-pack').disabled = false
  syncCharacterPackSourceLayoutControls()
  $('#character-pack-links').innerHTML = ''
  $('#character-pack-quality').textContent = '已载入源图，点击处理后会生成质量报告。'
  setCharacterPackStatus(`已选择 ${file.name}`, 'ready')
  setManualCutLinesEnabled(false)
  drawCharacterPackPlaceholder('源图已载入')
}

async function handleProcessCharacterPack() {
  const file = state.characterPack.file
  if (!file) {
    showToast('请先上传角色表')
    return
  }
  const button = $('#process-character-pack')
  button.disabled = true
  state.characterPack.job = null
  state.characterPack.repairActions = []
  clearActionRepairPlan()
  setCharacterPackStatus('post_processing', 'post_processing')
  try {
    const sourceLayout = getCharacterPackSourceLayout()
    let job = await processCharacterSheet(file, {
      name: $('#character-pack-name').value,
      description: '',
      backgroundMode: $('#character-pack-background').value,
      ...getCharacterPackTuningOptions(),
      sourceLayout,
      ...localFixedRegionStagingOptions(sourceLayout),
      sourceFileName: file.name,
      manualOverrides: getManualOverridesForRequest(),
      autoCorrect: $('#character-pack-auto-correct')?.checked ?? true,
      componentCleanup: $('#character-pack-component-cleanup')?.checked ?? true,
      minAlpha: Number($('#character-pack-cleanup-min-alpha')?.value ?? 18),
      minArea: Number($('#character-pack-component-cleanup-min-area')?.value ?? 4),
      minAreaRatio: Number($('#character-pack-component-cleanup-min-area-ratio')?.value ?? 0),
      motionStabilize: $('#character-pack-motion-stabilize')?.checked ?? true,
      motionMaxShift: Number($('#character-pack-motion-max-shift')?.value ?? 2),
      ...pixelFinishingOptions(),
      export1x: $('#character-pack-export-1x')?.checked ?? true,
      export2x: $('#character-pack-export-2x')?.checked ?? true,
      export3x: $('#character-pack-export-3x')?.checked ?? false,
      export4x: $('#character-pack-export-4x')?.checked ?? false,
    }, state.characterPack.blackFile)
    job = await waitForJob(job, (current) => setCharacterPackStatus(formatJobStatus(current), current.status))
    await renderCharacterPackJob(job)
    showToast(job.status === 'done' ? '角色包处理完成' : '处理完成但有阻塞问题')
  } catch (error) {
    setCharacterPackStatus(error.message, 'failed_post_processing')
    showToast(error.message)
  } finally {
    button.disabled = false
  }
}

async function handleGenerateCharacterPack() {
  const button = $('#generate-character-pack')
  button.disabled = true
  state.characterPack.job = null
  state.characterPack.repairActions = []
  clearActionRepairPlan()
  setCharacterPackStatus('generating', 'generating')
  try {
    const candidateCount = Number($('#character-pack-candidate-count')?.value ?? 1)
    let job = await generateCharacterSheet($('#character-pack-description').value, {
      name: $('#character-pack-name').value,
      description: $('#character-pack-description').value,
      t2iMode: $('#character-pack-t2i-mode')?.value ?? 'production_sheet_v0',
      characterPreset: $('#character-pack-character-preset')?.value ?? 'rpg_humanoid_v0',
      backgroundMode: $('#character-pack-background').value === 'dual_matte' ? 'flood' : $('#character-pack-background').value,
      ...getCharacterPackTuningOptions(),
      imageSize: $('#character-pack-image-size').value,
      candidateCount,
      maxProviderCalls: candidateCount,
      seed: $('#character-pack-seed')?.value ? Number($('#character-pack-seed').value) : undefined,
      sourceLayout: getCharacterPackSourceLayout(),
      generationLayout: getCharacterPackGenerationLayout(),
      providerPresetId: getProviderPresetId(),
      referenceFile: state.characterPack.referenceFile,
      paletteFile: state.characterPack.paletteFile,
      autoCorrect: $('#character-pack-auto-correct')?.checked ?? true,
      componentCleanup: $('#character-pack-component-cleanup')?.checked ?? true,
      minAlpha: Number($('#character-pack-cleanup-min-alpha')?.value ?? 18),
      minArea: Number($('#character-pack-component-cleanup-min-area')?.value ?? 4),
      minAreaRatio: Number($('#character-pack-component-cleanup-min-area-ratio')?.value ?? 0),
      motionStabilize: $('#character-pack-motion-stabilize')?.checked ?? true,
      motionMaxShift: Number($('#character-pack-motion-max-shift')?.value ?? 2),
      ...pixelFinishingOptions(),
      export1x: $('#character-pack-export-1x')?.checked ?? true,
      export2x: $('#character-pack-export-2x')?.checked ?? true,
      export3x: $('#character-pack-export-3x')?.checked ?? false,
      export4x: $('#character-pack-export-4x')?.checked ?? false,
    })
    job = await waitForJob(job, (current) => setCharacterPackStatus(formatJobStatus(current), current.status))
    await renderCharacterPackJob(job)
    showToast(job.status === 'done' ? 'AI 角色包处理完成' : 'AI 生成未完成')
  } catch (error) {
    setCharacterPackStatus(error.message, 'failed_model_error')
    showToast(error.message)
  } finally {
    button.disabled = false
    refreshGeminiState()
  }
}

function buildActionRepairRequest(extra = {}) {
  const job = state.characterPack.job
  if (!job?.id) throw new Error('请先完成一个角色包')
  const actions = selectedRepairAnimations()
  const animation = actions[0] ?? selectedRepairAnimation()
  if (!animation) throw new Error('请先选择一个动作')
  return {
    jobId: job.id,
    animation,
    actions,
    providerPresetId: getProviderPresetId(),
    imageConfig: {
      image_size: $('#character-pack-image-size')?.value || '1K',
    },
    ...extra,
  }
}

async function handlePlanCharacterActionRepair() {
  const button = $('#character-pack-repair-plan')
  button.disabled = true
  setActionRepairStatus('正在生成修复计划...', 'post_processing')
  try {
    const request = buildActionRepairRequest({ dryRunPlan: true })
    const plan = await repairCharacterAction(request)
    state.characterPack.repairPlan = {
      ...plan,
      source_job_id: request.jobId,
      animation: request.animation,
      actions: request.actions,
    }
    syncActionRepairControls()
    if (plan.status !== 'done') showToast(plan.preflight?.errors?.[0] || '修复计划被阻塞')
    else showToast('修复计划已生成')
  } catch (error) {
    state.characterPack.repairPlan = null
    setActionRepairStatus(error.message, 'failed_post_processing')
    showToast(error.message)
  } finally {
    syncActionRepairControls()
  }
}

async function handleRunCharacterActionRepair() {
  const plan = state.characterPack.repairPlan
  try {
    const request = buildActionRepairRequest({
      confirm_live_generation: true,
      maxProviderCalls: 1,
    })
    const planActions = Array.isArray(plan?.actions) ? plan.actions : plan?.animation ? [plan.animation] : []
    if (
      !plan?.can_run ||
      plan.source_job_id !== request.jobId ||
      planActions.length !== request.actions.length ||
      !planActions.every((item, index) => item === request.actions[index])
    ) {
      showToast('请先为当前动作生成修复计划')
      syncActionRepairControls()
      return
    }
    const actionLabel = request.actions.length > 1 ? request.actions.join(', ') : request.animation
    const ok = window.confirm(`${actionLabel} 将使用 1 次 provider call 修复，并生成新的角色包结果。继续吗？`)
    if (!ok) return
    const button = $('#character-pack-repair-run')
    button.disabled = true
    setActionRepairStatus('正在调用 provider 修复当前动作...', 'generating')
    let job = await repairCharacterAction(request)
    job = await waitForJob(job, (current) => setActionRepairStatus(formatJobStatus(current), current.status))
    state.characterPack.repairPlan = null
    state.characterPack.repairActions = []
    await renderCharacterPackJob(job)
    showToast(job.status === 'done' ? '当前动作修复完成' : '修复未完成')
  } catch (error) {
    setActionRepairStatus(error.message, 'failed_model_error')
    showToast(error.message)
  } finally {
    syncActionRepairControls()
    refreshGeminiState()
  }
}

export function initCharacterPackWorkflowEvents() {
  $('#character-pack-file').addEventListener('change', async (event) => {
    const [file] = event.target.files
    if (!file) return
    await handleCharacterPackFile(file)
  })
  $('#character-pack-black-file').addEventListener('change', async (event) => {
    const [file] = event.target.files
    state.characterPack.blackFile = file ?? null
    if (file) setCharacterPackStatus(`已选择黑底配对图 ${file.name}`, 'ready')
  })
  $('#character-pack-reference-file').addEventListener('change', async (event) => {
    const [file] = event.target.files
    state.characterPack.referenceFile = file ?? null
    if (file) setCharacterPackStatus(`已选择 AI 参考图 ${file.name}`, 'ready')
  })
  $('#character-pack-palette-file').addEventListener('change', async (event) => {
    const [file] = event.target.files
    state.characterPack.paletteFile = file ?? null
    if (file) setCharacterPackStatus(`已选择调色板参考 ${file.name}`, 'ready')
  })
  $('#character-pack-auto-grid').addEventListener('click', () => setManualCutLinesEnabled(false))
  $('#character-pack-manual-grid').addEventListener('click', () => setManualCutLinesEnabled(true))
  $('#character-pack-reset-grid').addEventListener('click', () => resetManualCutLines(setCharacterPackStatus))
  $('#character-pack-reslice').addEventListener('click', handleProcessCharacterPack)
  $('#process-character-pack').addEventListener('click', handleProcessCharacterPack)
  $('#generate-character-pack').addEventListener('click', handleGenerateCharacterPack)
  $('#character-pack-repair-plan').addEventListener('click', handlePlanCharacterActionRepair)
  $('#character-pack-repair-run').addEventListener('click', handleRunCharacterActionRepair)
  $('#character-pack-animation').addEventListener('change', () => clearActionRepairPlan())
  $('#refresh-benchmark-gallery').addEventListener('click', refreshBenchmarkGallery)

  const trackToggle = $('#character-pack-track-toggle')
  if (trackToggle) {
    trackToggle.addEventListener('click', (event) => {
      const btn = event.target.closest('.segment')
      if (!btn) return
      const track = btn.dataset.track
      if (!track) return

      for (const b of trackToggle.querySelectorAll('.segment')) {
        b.classList.toggle('active', b === btn)
      }

      const trackTargets = document.querySelectorAll(
        '#character-pack-form > [data-track], #character-pack-form .engine-section[data-track]'
      )
      for (const target of trackTargets) {
        if (target.dataset.track === 'shared') {
          target.hidden = false
        } else {
          target.hidden = target.dataset.track !== track
        }
      }

      // Special case for elements inside shared that are AI-only
      const aiOnlyInShared = document.querySelectorAll('#character-pack-form [data-track="shared"] [data-track="ai"]')
      for (const el of aiOnlyInShared) {
        if (el.closest('#character-pack-track-toggle')) continue
        el.hidden = track !== 'ai'
      }
    })
  }
}
