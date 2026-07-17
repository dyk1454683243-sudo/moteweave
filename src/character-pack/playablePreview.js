import { getNearestCardinalDirection } from './profile.js'

const LEFT_KEYS = new Set(['a', 'A', 'ArrowLeft'])
const RIGHT_KEYS = new Set(['d', 'D', 'ArrowRight'])
const UP_KEYS = new Set(['w', 'W', 'ArrowUp'])
const DOWN_KEYS = new Set(['s', 'S', 'ArrowDown'])

function hasAny(keys, candidates) {
  for (const key of candidates) {
    if (keys.has(key)) return true
  }
  return false
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function getMovementIntent(keys, fallback = 'down') {
  const dx = (hasAny(keys, RIGHT_KEYS) ? 1 : 0) - (hasAny(keys, LEFT_KEYS) ? 1 : 0)
  const dy = (hasAny(keys, DOWN_KEYS) ? 1 : 0) - (hasAny(keys, UP_KEYS) ? 1 : 0)
  return {
    dx,
    dy,
    direction: getNearestCardinalDirection(dx, dy, fallback),
    moving: dx !== 0 || dy !== 0,
  }
}

export function getAnimationNameForIntent(intent, fallbackDirection = 'down') {
  const direction = intent.direction || fallbackDirection
  return `${intent.moving ? 'walk' : 'idle'}_${direction}`
}

export function movePreviewActor(position, intent, { deltaMs, speed, minX, maxX, minY, maxY }) {
  const length = Math.hypot(intent.dx, intent.dy) || 1
  const distance = (speed * deltaMs) / 1000
  return {
    x: clamp(position.x + (intent.dx / length) * distance, minX, maxX),
    y: clamp(position.y + (intent.dy / length) * distance, minY, maxY),
  }
}
