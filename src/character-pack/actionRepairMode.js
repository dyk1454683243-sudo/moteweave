const STATIC_POSE_ANIMATIONS = new Set([
  'idle_down',
  'idle_up',
  'idle_left',
  'idle_right',
])

export const ACTION_REPAIR_MODE = Object.freeze({
  ANIMATION_STRIP: 'animation_strip',
  STATIC_POSE: 'static_pose',
})

export function isStaticPoseAnimation(animation = '') {
  return STATIC_POSE_ANIMATIONS.has(String(animation))
}

export function repairModeForAnimation(animation = '', fallback = ACTION_REPAIR_MODE.ANIMATION_STRIP) {
  return isStaticPoseAnimation(animation) ? ACTION_REPAIR_MODE.STATIC_POSE : fallback
}

export function isStaticPoseRepairTask(task = {}) {
  const value = task ?? {}
  return (
    value.repair_mode === ACTION_REPAIR_MODE.STATIC_POSE ||
    value.target?.repair_mode === ACTION_REPAIR_MODE.STATIC_POSE ||
    value.provider_payload?.output?.repair_mode === ACTION_REPAIR_MODE.STATIC_POSE
  )
}

export function repairOutputFrameCountForTask(task = {}, targetFrameCount = 0) {
  return isStaticPoseRepairTask(task) ? 1 : Math.max(1, targetFrameCount)
}
