import test from 'node:test'
import assert from 'node:assert/strict'

import { bindPlaytestInputLifecycle } from '../../src/ui/editor/playtestInputLifecycle.js'

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type) },
    dispatch(type, event = {}) { listeners.get(type)?.(event) },
  }
}

function keyboardEvent({ key, code, form = false, repeat = false } = {}) {
  let prevented = false
  return {
    key,
    code,
    repeat,
    target: { closest: () => form ? {} : null },
    preventDefault: () => { prevented = true },
    get prevented() { return prevented },
  }
}

test('stage input owns movement keys, ignores form arrows, and clears lifecycle state', () => {
  const stage = {
    ...eventTarget(),
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    focus() {},
  }
  const hudStop = eventTarget()
  const windowRef = eventTarget()
  const documentRef = { ...eventTarget(), hidden: false }
  const playtest = { running: true, key: 'KeyE', pressedKeys: new Set(), lastTickMs: 10 }
  let stopped = 0
  let triggered = 0
  const sizes = []
  const unbind = bindPlaytestInputLifecycle({
    stage,
    hudStop,
    getPlaytest: () => playtest,
    onStop: () => { stopped += 1 },
    onTrigger: () => { triggered += 1 },
    onResize: (width, height) => sizes.push([width, height]),
    windowRef,
    documentRef,
  })

  const formArrow = keyboardEvent({ key: 'ArrowRight', form: true })
  stage.dispatch('keydown', formArrow)
  assert.equal(playtest.pressedKeys.size, 0)
  assert.equal(formArrow.prevented, false)

  const movement = keyboardEvent({ key: 'd', code: 'KeyD' })
  stage.dispatch('keydown', movement)
  assert.deepEqual([...playtest.pressedKeys], ['d'])
  assert.equal(movement.prevented, true)
  stage.dispatch('keyup', keyboardEvent({ key: 'd', code: 'KeyD' }))
  assert.equal(playtest.pressedKeys.size, 0)

  stage.dispatch('keydown', keyboardEvent({ key: 'e', code: 'KeyE' }))
  assert.equal(triggered, 1)
  stage.dispatch('keydown', keyboardEvent({ key: 'Escape' }))
  assert.equal(stopped, 1)

  playtest.pressedKeys.add('w')
  stage.dispatch('blur')
  assert.equal(playtest.pressedKeys.size, 0)
  assert.equal(playtest.lastTickMs, null)
  assert.deepEqual(sizes, [[640, 360]])

  unbind()
  assert.equal(stage.listeners.size, 0)
})

test('movement input uses physical codes and releases cleanly across Shift changes', () => {
  const stage = {
    ...eventTarget(),
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    focus() {},
  }
  const playtest = { running: true, key: 'KeyE', pressedKeys: new Set(), lastTickMs: 10 }
  const unbind = bindPlaytestInputLifecycle({
    stage,
    hudStop: eventTarget(),
    getPlaytest: () => playtest,
    onStop() {},
    onTrigger() {},
    onResize() {},
    windowRef: eventTarget(),
    documentRef: { ...eventTarget(), hidden: false },
  })

  stage.dispatch('keydown', keyboardEvent({ key: 'z', code: 'KeyW' }))
  assert.deepEqual([...playtest.pressedKeys], ['w'])

  stage.dispatch('keyup', keyboardEvent({ key: 'Z', code: 'KeyW' }))
  assert.equal(playtest.pressedKeys.size, 0)

  stage.dispatch('keydown', keyboardEvent({ key: 'D' }))
  assert.deepEqual([...playtest.pressedKeys], ['d'])
  stage.dispatch('keyup', keyboardEvent({ key: 'd' }))
  assert.equal(playtest.pressedKeys.size, 0)

  unbind()
})

test('near-key repeat does not retrigger interaction while movement repeat stays pressed', () => {
  const stage = {
    ...eventTarget(),
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    focus() {},
  }
  const playtest = { running: true, key: 'KeyE', pressedKeys: new Set(), lastTickMs: 10 }
  let triggered = 0
  const unbind = bindPlaytestInputLifecycle({
    stage,
    hudStop: eventTarget(),
    getPlaytest: () => playtest,
    onStop() {},
    onTrigger: () => { triggered += 1 },
    onResize() {},
    windowRef: eventTarget(),
    documentRef: { ...eventTarget(), hidden: false },
  })

  stage.dispatch('keydown', keyboardEvent({ key: 'e', code: 'KeyE' }))
  stage.dispatch('keydown', keyboardEvent({ key: 'e', code: 'KeyE', repeat: true }))
  assert.equal(triggered, 1)

  const repeatedMovement = keyboardEvent({ key: 'w', code: 'KeyW', repeat: true })
  stage.dispatch('keydown', repeatedMovement)
  assert.deepEqual([...playtest.pressedKeys], ['w'])
  assert.equal(repeatedMovement.prevented, true)

  unbind()
})
