import { state } from '../appState.js'
import { $ } from '../dom.js'

export function selectedRepairAnimation() {
  return selectedRepairAnimations()[0] || ''
}

export function selectedRepairAnimations() {
  const selected = Array.isArray(state.characterPack.repairActions) ? state.characterPack.repairActions.filter(Boolean) : []
  if (selected.length) return [...new Set(selected)]
  const select = $('#character-pack-animation')
  return [select?.value || state.characterPack.preview.animationName || ''].filter(Boolean)
}

function selectedRepairOption() {
  const select = $('#character-pack-animation')
  return select?.selectedOptions?.[0] ?? null
}

function selectedRepairSupported() {
  if ((state.characterPack.repairActions ?? []).length > 1) return true
  const option = selectedRepairOption()
  return option?.dataset.repairSupported !== 'false'
}

export function setActionRepairStatus(message, status = 'idle') {
  const statusLine = $('#character-pack-repair-status')
  if (!statusLine) return
  statusLine.textContent = message
  statusLine.dataset.status = status
}

export function clearActionRepairPlan(message = '') {
  state.characterPack.repairPlan = null
  if (message) setActionRepairStatus(message, 'idle')
  syncActionRepairControls()
}

export function syncActionRepairControls(job = state.characterPack.job) {
  const planButton = $('#character-pack-repair-plan')
  const runButton = $('#character-pack-repair-run')
  if (!planButton || !runButton) return
  const canRepair = Boolean(job?.id && job.status === 'done' && job.debug_report_url && job.normalized_sheet_url)
  const animations = selectedRepairAnimations()
  const animation = animations[0] ?? ''
  const repairSupported = selectedRepairSupported()
  const plan = state.characterPack.repairPlan
  const planActions = Array.isArray(plan?.actions) ? plan.actions : plan?.animation ? [plan.animation] : []
  const planMatches = Boolean(
    plan?.can_run &&
    plan.source_job_id === job?.id &&
    planActions.length === animations.length &&
    planActions.every((item, index) => item === animations[index])
  )
  planButton.disabled = !canRepair || !animation || !repairSupported
  runButton.disabled = !canRepair || !planMatches
  if (!canRepair) {
    if (job?.status && job.status !== 'done') setActionRepairStatus('修复需等待当前角色包完成', job.status)
    else setActionRepairStatus('完成一个角色包后可修复当前动作', 'idle')
  } else if (!repairSupported) {
    setActionRepairStatus(`当前源动作：${animation}，暂不支持自动修复`, 'idle')
  } else if (planMatches) {
    const calls = plan.estimated_provider_calls ?? 1
    const frames = Array.isArray(plan.selected_frames) ? plan.selected_frames.length : 0
    const targetLabel = animations.length > 1 ? `${animations.length} 个源动作` : animation
    setActionRepairStatus(`${targetLabel} 修复计划就绪：${calls} 次 provider call · ${frames} 帧`, 'ready')
  } else {
    const targetLabel = animations.length > 1 ? `${animations.length} 个源动作` : animation || '未选择'
    setActionRepairStatus(`当前动作：${targetLabel}，可先生成修复计划`, 'ready')
  }
}
