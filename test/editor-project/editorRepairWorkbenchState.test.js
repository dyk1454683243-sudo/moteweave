import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEmptyActionRepairSelectionState,
  editorState,
} from '../../src/ui/editor/state.js'

test('action repair selection state contains no local reprocess preview or Recipe state', () => {
  const first = createEmptyActionRepairSelectionState()
  const second = createEmptyActionRepairSelectionState()

  assert.deepEqual(first, {
    selection: null,
    frameBatchRepairTargets: null,
    clips: {},
    sourceSheetUrl: null,
    filmstrip: { frames: [], selectedIndex: 0, playing: false },
    view: { clipId: '', frameIndex: null },
    status: 'idle',
    message: '',
    error: null,
    openGeneration: 0,
  })
  assert.notEqual(first, second)
  assert.notEqual(first.filmstrip, second.filmstrip)
  assert.equal(Object.hasOwn(first, 'draft'), false)
  assert.equal(Object.hasOwn(first, 'preview'), false)
  assert.deepEqual(editorState.repair.local, createEmptyActionRepairSelectionState())
})
