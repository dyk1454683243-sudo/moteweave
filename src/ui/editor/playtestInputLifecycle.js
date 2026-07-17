const MOVEMENT_CODES = new Map([
  ['KeyW', 'w'],
  ['KeyA', 'a'],
  ['KeyS', 's'],
  ['KeyD', 'd'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
])

const MOVEMENT_KEYS = new Map([
  ['w', 'w'], ['W', 'w'],
  ['a', 'a'], ['A', 'a'],
  ['s', 's'], ['S', 's'],
  ['d', 'd'], ['D', 'd'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
])

function movementKey(event) {
  if (typeof event.code === 'string' && event.code) {
    return MOVEMENT_CODES.get(event.code) ?? null
  }
  return MOVEMENT_KEYS.get(event.key) ?? null
}

function isFormControl(target) {
  return Boolean(target?.closest?.('input, select, textarea, button, [contenteditable="true"]'))
}

export function clearPlaytestInput(playtest) {
  playtest?.pressedKeys?.clear?.()
  if (playtest) playtest.lastTickMs = null
}

export function bindPlaytestInputLifecycle({
  stage,
  hudStop,
  getPlaytest,
  onStop,
  onTrigger,
  onResize,
  windowRef = window,
  documentRef = document,
}) {
  let resizeObserver = null
  const measure = () => {
    const rect = stage.getBoundingClientRect()
    onResize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)))
  }
  const keydown = (event) => {
    const playtest = getPlaytest()
    if (!playtest.running) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onStop()
      return
    }
    if (isFormControl(event.target)) return
    const movement = movementKey(event)
    if (movement) {
      event.preventDefault()
      playtest.pressedKeys.add(movement)
    } else if (!event.repeat && event.code === (playtest.key || 'KeyE')) {
      event.preventDefault()
      onTrigger()
    }
  }
  const keyup = (event) => {
    const movement = movementKey(event)
    if (!movement) return
    getPlaytest().pressedKeys.delete(movement)
    if (getPlaytest().running && !isFormControl(event.target)) event.preventDefault()
  }
  const clear = () => clearPlaytestInput(getPlaytest())
  const pointerdown = (event) => {
    if (getPlaytest().running && !isFormControl(event.target)) stage.focus({ preventScroll: true })
  }
  const visibility = () => { if (documentRef.hidden) clear() }
  const stop = () => onStop()
  const fallbackResize = () => measure()

  stage.addEventListener('keydown', keydown)
  stage.addEventListener('keyup', keyup)
  stage.addEventListener('blur', clear, true)
  stage.addEventListener('pointerdown', pointerdown)
  hudStop.addEventListener('click', stop)
  windowRef.addEventListener('blur', clear)
  documentRef.addEventListener('visibilitychange', visibility)
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === stage)
      if (entry) onResize(Math.max(1, Math.round(entry.contentRect.width)), Math.max(1, Math.round(entry.contentRect.height)))
    })
    resizeObserver.observe(stage)
  } else {
    windowRef.addEventListener('resize', fallbackResize)
  }
  measure()

  return () => {
    resizeObserver?.disconnect()
    stage.removeEventListener('keydown', keydown)
    stage.removeEventListener('keyup', keyup)
    stage.removeEventListener('blur', clear, true)
    stage.removeEventListener('pointerdown', pointerdown)
    hudStop.removeEventListener('click', stop)
    windowRef.removeEventListener('blur', clear)
    windowRef.removeEventListener('resize', fallbackResize)
    documentRef.removeEventListener('visibilitychange', visibility)
    clear()
  }
}
