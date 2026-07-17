export const TOPDOWN_RPG_V0 = Object.freeze({
  id: 'topdown_rpg_v0',
  version: '0.1',
  grid: { columns: 8, rows: 8 },
  frame: { w: 96, h: 96 },
  sheet: { w: 768, h: 768 },
  authoringCell: { w: 192, h: 192 },
  anchor: { x: 48, y: 88, mode: 'feet-center' },
  baselineY: 88,
  thresholds: {
    anchorDriftPx: 4,
    baselineDriftPx: 3,
    onionSkinDriftPx: 2,
    minPaddingPx: 4,
    bboxVarianceRatio: 0.25,
  },
  animations: [
    { name: 'idle_down', row: 0, startCol: 0, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_up', row: 0, startCol: 4, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_left', row: 1, startCol: 0, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'idle_right', row: 1, startCol: 4, count: 4, fps: 8, loop: true, mode: 'loop' },
    { name: 'walk_down', row: 2, startCol: 0, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_up', row: 2, startCol: 4, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_left', row: 3, startCol: 0, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'walk_right', row: 3, startCol: 4, count: 4, fps: 10, loop: true, mode: 'loop' },
    { name: 'attack_down', row: 4, startCol: 0, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_up', row: 4, startCol: 4, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_left', row: 5, startCol: 0, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'attack_right', row: 5, startCol: 4, count: 4, fps: 12, loop: false, mode: 'once' },
    { name: 'hurt', row: 6, startCol: 0, count: 4, fps: 6, loop: false, mode: 'once' },
    { name: 'happy', row: 6, startCol: 4, count: 4, fps: 6, loop: true, mode: 'loop' },
    { name: 'sit', row: 7, startCol: 0, count: 4, fps: 4, loop: true, mode: 'loop' },
    { name: 'talk', row: 7, startCol: 4, count: 4, fps: 6, loop: true, mode: 'loop' },
  ],
})

export function getFrameIndex(row, col, profile = TOPDOWN_RPG_V0) {
  return row * profile.grid.columns + col
}

export function getAnimationFrameIndexes(name, profile = TOPDOWN_RPG_V0) {
  const animation = profile.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Unknown animation: ${name}`)
  return Array.from({ length: animation.count }, (_, i) => getFrameIndex(animation.row, animation.startCol + i, profile))
}

export function getNearestCardinalDirection(dx, dy, fallback = 'down') {
  if (dx === 0 && dy === 0) return fallback
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}
