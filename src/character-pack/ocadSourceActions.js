export const OCAD_SOURCE_ACTIONS = Object.freeze({
  idledown: Object.freeze({ action: 'idledown', label: 'idle down', zh: '正面待机', loop: true, fps: 5 }),
  idleup: Object.freeze({ action: 'idleup', label: 'idle up', zh: '背面待机', loop: true, fps: 5 }),
  idleL: Object.freeze({ action: 'idleL', label: 'idle left', zh: '左向待机', loop: true, fps: 5 }),
  walkdown: Object.freeze({ action: 'walkdown', label: 'walk down', zh: '向下行走', loop: true, fps: 5 }),
  walkup: Object.freeze({ action: 'walkup', label: 'walk up', zh: '向上行走', loop: true, fps: 5 }),
  walkL: Object.freeze({ action: 'walkL', label: 'walk left', zh: '向左行走', loop: true, fps: 5 }),
  rundown: Object.freeze({ action: 'rundown', label: 'run down', zh: '向下奔跑', loop: true, fps: 5 }),
  runup: Object.freeze({ action: 'runup', label: 'run up', zh: '向上奔跑', loop: true, fps: 5 }),
  runL: Object.freeze({ action: 'runL', label: 'run left', zh: '向左奔跑', loop: true, fps: 5 }),
  climb: Object.freeze({ action: 'climb', label: 'climb', zh: '攀爬', loop: true, fps: 7 }),
  attractL: Object.freeze({ action: 'attractL', label: 'attract left', zh: '左向吸引/交互动作', loop: false, fps: 5 }),
  defence: Object.freeze({ action: 'defence', label: 'defence', zh: '防御', loop: true, fps: 5 }),
  die: Object.freeze({ action: 'die', label: 'die', zh: '倒地/死亡', loop: true, fps: 5 }),
  item: Object.freeze({ action: 'item', label: 'item', zh: '道具动作', loop: false, fps: 5 }),
  jump: Object.freeze({ action: 'jump', label: 'jump', zh: '跳跃/高兴动作', loop: true, fps: 1 }),
  sitdown: Object.freeze({ action: 'sitdown', label: 'sit down', zh: '坐下', loop: false, fps: 5 }),
})

export const OCAD_SOURCE_ACTION_ORDER = Object.freeze([
  'attractL',
  'climb',
  'defence',
  'die',
  'idleL',
  'idledown',
  'idleup',
  'item',
  'jump',
  'runL',
  'rundown',
  'runup',
  'sitdown',
  'walkL',
  'walkdown',
  'walkup',
])

export const OCAD_SOURCE_ACTION_RUNTIME_PREVIEW = Object.freeze({
  idledown: 'idle_down',
  idleup: 'idle_up',
  idleL: 'idle_left',
  walkdown: 'walk_down',
  walkup: 'walk_up',
  walkL: 'walk_left',
  climb: 'attack_up',
  attractL: 'attack_left',
  defence: 'hurt',
  die: 'hurt',
  item: 'attack_down',
  sitdown: 'sit',
})

export const OCAD_SOURCE_ACTION_REPAIR_TARGETS = Object.freeze({
  idledown: Object.freeze({ animation: 'idle_down', derived: [] }),
  idleup: Object.freeze({ animation: 'idle_up', derived: [] }),
  idleL: Object.freeze({
    animation: 'idle_left',
    derived: [Object.freeze({ animation: 'idle_right', transform: 'flip_h' })],
  }),
  walkdown: Object.freeze({ animation: 'walk_down', derived: [] }),
  walkup: Object.freeze({ animation: 'walk_up', derived: [] }),
  walkL: Object.freeze({
    animation: 'walk_left',
    derived: [Object.freeze({ animation: 'walk_right', transform: 'flip_h' })],
  }),
  climb: Object.freeze({ animation: 'attack_up', derived: [] }),
  attractL: Object.freeze({
    animation: 'attack_left',
    derived: [Object.freeze({ animation: 'attack_right', transform: 'flip_h' })],
  }),
  item: Object.freeze({ animation: 'attack_down', derived: [] }),
  sitdown: Object.freeze({ animation: 'sit', derived: [] }),
})

export function isOcadSourceAction(action) {
  return Object.hasOwn(OCAD_SOURCE_ACTIONS, action)
}

export function getOcadSourceActionList() {
  return OCAD_SOURCE_ACTION_ORDER.map((action) => OCAD_SOURCE_ACTIONS[action])
}
