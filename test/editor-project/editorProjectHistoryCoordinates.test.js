import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createCommandHistory,
  commitHistory,
  layerPivotToTopLeft,
  layerPositionToScreen,
  redoHistory,
  screenToWorld,
  undoHistory,
  worldToScreen,
} from '../../src/editor-project/index.js'

test('command history groups repeated updates and enforces the history limit', () => {
  let history = createCommandHistory({ snapshot: { x: 0 }, selection: { layer_id: 'layer_a' }, limit: 2 })
  history = commitHistory(history, { x: 1 }, { groupKey: 'drag:layer_a', selection: { layer_id: 'layer_a' } })
  history = commitHistory(history, { x: 2 }, { groupKey: 'drag:layer_a', selection: { layer_id: 'layer_a' } })

  assert.equal(history.past.length, 1)
  assert.deepEqual(history.present, { x: 2 })

  history = undoHistory(history)
  assert.deepEqual(history.present, { x: 0 })
  history = redoHistory(history)
  assert.deepEqual(history.present, { x: 2 })

  history = commitHistory(history, { x: 3 }, { groupKey: 'nudge:1' })
  history = commitHistory(history, { x: 4 }, { groupKey: 'nudge:2' })
  history = commitHistory(history, { x: 5 }, { groupKey: 'nudge:3' })
  assert.equal(history.past.length, 2)
  assert.deepEqual(history.past.map((entry) => entry.snapshot), [{ x: 3 }, { x: 4 }])
})

test('coordinate helpers convert world, viewport, parallax, and pivot positions', () => {
  const camera = { x: 10, y: 20, zoom: 2 }
  const screen = worldToScreen({ x: 100, y: 80 }, { camera, parallax: 0.5 })
  assert.deepEqual(screen, { x: 190, y: 140 })
  assert.deepEqual(screenToWorld(screen, { camera, parallax: 0.5 }), { x: 100, y: 80 })

  const viewportLayer = {
    transform: { position: { x: 40, y: 60 }, coordinate_space: 'viewport' },
    render: { parallax: 0.25 },
  }
  assert.deepEqual(layerPositionToScreen(viewportLayer, { camera }), { x: 40, y: 60 })

  const worldLayer = {
    transform: { position: { x: 100, y: 80 }, coordinate_space: 'world' },
    render: { parallax: 0.5 },
  }
  assert.deepEqual(layerPositionToScreen(worldLayer, { camera }), { x: 190, y: 140 })

  assert.deepEqual(layerPivotToTopLeft(
    { x: 200, y: 300 },
    {
      frameSize: { w: 96, h: 96 },
      pivot: { mode: 'center' },
      scale: { x: 2, y: 2 },
    }
  ), { x: 104, y: 204 })
})
