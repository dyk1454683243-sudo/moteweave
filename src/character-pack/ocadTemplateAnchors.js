const TEMPLATE_SOURCE = 'fixed_region_motion_v0_template'

const MOTION_BY_ACTION = Object.freeze({
  idledown: Object.freeze({ family: 'idle', direction: 'down', stabilizable: true }),
  idleup: Object.freeze({ family: 'idle', direction: 'up', stabilizable: true }),
  idleL: Object.freeze({ family: 'idle', direction: 'left', stabilizable: true }),
  walkdown: Object.freeze({ family: 'walk', direction: 'down', stabilizable: true }),
  walkup: Object.freeze({ family: 'walk', direction: 'up', stabilizable: true }),
  walkL: Object.freeze({ family: 'walk', direction: 'left', stabilizable: true }),
  rundown: Object.freeze({ family: 'run', direction: 'down', stabilizable: true }),
  runup: Object.freeze({ family: 'run', direction: 'up', stabilizable: true }),
  runL: Object.freeze({ family: 'run', direction: 'left', stabilizable: true }),
  climb: Object.freeze({ family: 'climb', direction: 'up', stabilizable: true }),
  attractL: Object.freeze({ family: 'interact', direction: 'left', stabilizable: false }),
  defence: Object.freeze({ family: 'defence', direction: 'down', stabilizable: false }),
  die: Object.freeze({ family: 'death', direction: 'down', stabilizable: false }),
  item: Object.freeze({ family: 'item', direction: 'down', stabilizable: false }),
  jump: Object.freeze({ family: 'jump', direction: 'down', stabilizable: true }),
  sitdown: Object.freeze({ family: 'sit', direction: 'down', stabilizable: false }),
})

function actionForRegionKey(key) {
  const match = String(key).match(/^(.+?)(\d+)$/)
  return match ? match[1] : key
}

function flipDirection(direction) {
  if (direction === 'left') return 'right'
  if (direction === 'right') return 'left'
  return direction
}

function scaleAnchor(anchor, sourceRegion, targetSize) {
  if (!targetSize || (targetSize.w === sourceRegion.w && targetSize.h === sourceRegion.h)) return anchor
  return {
    ...anchor,
    x: Math.round((anchor.x / sourceRegion.w) * targetSize.w),
    y: Math.round((anchor.y / sourceRegion.h) * targetSize.h),
  }
}

export function getOcadTemplateHints(regionKey, sourceRegion, options = {}) {
  const action = actionForRegionKey(regionKey)
  const motion = MOTION_BY_ACTION[action] ?? { family: action, direction: 'down', stabilizable: false }
  const anchorX = options.flipH ? sourceRegion.w - 1 - Math.round((sourceRegion.w - 1) / 2) : Math.round((sourceRegion.w - 1) / 2)
  const anchor = scaleAnchor(
    {
      x: anchorX,
      y: sourceRegion.h - 1,
      mode: 'template-foot-center',
      source: TEMPLATE_SOURCE,
    },
    sourceRegion,
    options.targetSize
  )
  return {
    anchor,
    motion: {
      action,
      family: motion.family,
      direction: options.flipH ? flipDirection(motion.direction) : motion.direction,
      stabilizable: motion.stabilizable,
    },
  }
}
