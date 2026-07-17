export const FIXED_REGION_SOURCE_SHEET = Object.freeze({ w: 252, h: 252 })

export const FIXED_REGION_SOURCE_REGIONS = Object.freeze({
  attractL0: { x: 0, y: 168, w: 42, h: 42 },
  attractL1: { x: 42, y: 168, w: 42, h: 42 },
  attractL2: { x: 84, y: 168, w: 42, h: 42 },
  attractL3: { x: 126, y: 168, w: 42, h: 42 },
  attractL4: { x: 168, y: 168, w: 42, h: 42 },
  attractL5: { x: 210, y: 168, w: 42, h: 42 },
  attractL6: { x: 0, y: 210, w: 42, h: 42 },
  attractL7: { x: 42, y: 210, w: 42, h: 42 },
  climb0: { x: 126, y: 84, w: 21, h: 42 },
  climb1: { x: 147, y: 84, w: 21, h: 42 },
  climb2: { x: 168, y: 84, w: 21, h: 42 },
  climb3: { x: 189, y: 84, w: 21, h: 42 },
  climb4: { x: 210, y: 84, w: 21, h: 42 },
  climb5: { x: 231, y: 84, w: 21, h: 42 },
  defence: { x: 168, y: 126, w: 21, h: 42 },
  die: { x: 189, y: 210, w: 63, h: 42 },
  idleL: { x: 210, y: 126, w: 21, h: 42 },
  idledown: { x: 189, y: 126, w: 21, h: 42 },
  idleup: { x: 231, y: 126, w: 21, h: 42 },
  item0: { x: 147, y: 210, w: 21, h: 42 },
  item1: { x: 168, y: 210, w: 21, h: 42 },
  jump0: { x: 105, y: 210, w: 21, h: 42 },
  jump1: { x: 126, y: 210, w: 21, h: 42 },
  runL0: { x: 0, y: 126, w: 28, h: 42 },
  runL1: { x: 28, y: 126, w: 28, h: 42 },
  runL2: { x: 56, y: 126, w: 28, h: 42 },
  runL3: { x: 84, y: 126, w: 28, h: 42 },
  runL4: { x: 112, y: 126, w: 28, h: 42 },
  runL5: { x: 140, y: 126, w: 28, h: 42 },
  rundown0: { x: 0, y: 0, w: 21, h: 42 },
  rundown1: { x: 21, y: 0, w: 21, h: 42 },
  rundown2: { x: 42, y: 0, w: 21, h: 42 },
  rundown3: { x: 63, y: 0, w: 21, h: 42 },
  rundown4: { x: 84, y: 0, w: 21, h: 42 },
  rundown5: { x: 105, y: 0, w: 21, h: 42 },
  runup0: { x: 0, y: 42, w: 21, h: 42 },
  runup1: { x: 21, y: 42, w: 21, h: 42 },
  runup2: { x: 42, y: 42, w: 21, h: 42 },
  runup3: { x: 63, y: 42, w: 21, h: 42 },
  runup4: { x: 84, y: 42, w: 21, h: 42 },
  runup5: { x: 105, y: 42, w: 21, h: 42 },
  sitdown: { x: 84, y: 210, w: 21, h: 42 },
  walkL0: { x: 0, y: 84, w: 21, h: 42 },
  walkL1: { x: 21, y: 84, w: 21, h: 42 },
  walkL2: { x: 42, y: 84, w: 21, h: 42 },
  walkL3: { x: 63, y: 84, w: 21, h: 42 },
  walkL4: { x: 84, y: 84, w: 21, h: 42 },
  walkL5: { x: 105, y: 84, w: 21, h: 42 },
  walkdown0: { x: 126, y: 0, w: 21, h: 42 },
  walkdown1: { x: 147, y: 0, w: 21, h: 42 },
  walkdown2: { x: 168, y: 0, w: 21, h: 42 },
  walkdown3: { x: 189, y: 0, w: 21, h: 42 },
  walkdown4: { x: 210, y: 0, w: 21, h: 42 },
  walkdown5: { x: 231, y: 0, w: 21, h: 42 },
  walkup0: { x: 126, y: 42, w: 21, h: 42 },
  walkup1: { x: 147, y: 42, w: 21, h: 42 },
  walkup2: { x: 168, y: 42, w: 21, h: 42 },
  walkup3: { x: 189, y: 42, w: 21, h: 42 },
  walkup4: { x: 210, y: 42, w: 21, h: 42 },
  walkup5: { x: 231, y: 42, w: 21, h: 42 },
})

export const FIXED_REGION_SOURCE_ACTION_REGION_KEYS = Object.freeze({
  idledown: Object.freeze(['idledown']),
  idleup: Object.freeze(['idleup']),
  idleL: Object.freeze(['idleL']),
  walkdown: Object.freeze(['walkdown0', 'walkdown1', 'walkdown2', 'walkdown3', 'walkdown4', 'walkdown5']),
  walkup: Object.freeze(['walkup0', 'walkup1', 'walkup2', 'walkup3', 'walkup4', 'walkup5']),
  walkL: Object.freeze(['walkL0', 'walkL1', 'walkL2', 'walkL3', 'walkL4', 'walkL5']),
  rundown: Object.freeze(['rundown0', 'rundown1', 'rundown2', 'rundown3', 'rundown4', 'rundown5']),
  runup: Object.freeze(['runup0', 'runup1', 'runup2', 'runup3', 'runup4', 'runup5']),
  runL: Object.freeze(['runL0', 'runL1', 'runL2', 'runL3', 'runL4', 'runL5']),
  climb: Object.freeze(['climb0', 'climb1', 'climb2', 'climb3', 'climb4', 'climb5']),
  attractL: Object.freeze(['attractL0', 'attractL1', 'attractL2', 'attractL3', 'attractL4', 'attractL5', 'attractL6', 'attractL7']),
  defence: Object.freeze(['defence']),
  die: Object.freeze(['die']),
  item: Object.freeze(['item0', 'item1']),
  jump: Object.freeze(['jump0', 'jump1']),
  sitdown: Object.freeze(['sitdown']),
})

export function getFixedRegionSourceActionRegionKeys(action) {
  return FIXED_REGION_SOURCE_ACTION_REGION_KEYS[action] ?? []
}

export function scaleFixedRegionSourceRegion(region, image, sheet = FIXED_REGION_SOURCE_SHEET) {
  const scaleX = image.width / sheet.w
  const scaleY = image.height / sheet.h
  const x = Math.round(region.x * scaleX)
  const y = Math.round(region.y * scaleY)
  const right = Math.round((region.x + region.w) * scaleX)
  const bottom = Math.round((region.y + region.h) * scaleY)
  return {
    x: Math.max(0, Math.min(image.width - 1, x)),
    y: Math.max(0, Math.min(image.height - 1, y)),
    w: Math.max(1, Math.min(image.width - x, right - x)),
    h: Math.max(1, Math.min(image.height - y, bottom - y)),
  }
}
