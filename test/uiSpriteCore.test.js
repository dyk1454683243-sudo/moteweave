import assert from 'node:assert/strict'
import test from 'node:test'

import JSZip from 'jszip'

import {
  buildSequencePlan,
  createSequenceBinding,
  editSequenceFrames,
  makeSpriteZip,
  naturalSortSequenceFiles,
  normalizeSequenceOptions,
  sequenceBindingIsCurrent,
  sequenceOptionsKey,
} from '../src/ui/sprite/core.js'

test('Sequence files use stable natural filename order without mutating the input', () => {
  const files = [
    { name: 'walk10.png' },
    { name: 'walk2.png' },
    { name: 'walk1.png' },
    { name: 'WALK2.PNG' },
  ]
  const sorted = naturalSortSequenceFiles(files)

  assert.deepEqual(sorted.map((file) => file.name), [
    'walk1.png',
    'walk2.png',
    'WALK2.PNG',
    'walk10.png',
  ])
  assert.deepEqual(files.map((file) => file.name), [
    'walk10.png',
    'walk2.png',
    'walk1.png',
    'WALK2.PNG',
  ])
})

test('Sequence frame edits preserve identity and never mutate the current order', () => {
  const first = { file: { name: 'same.png' }, url: 'blob:first' }
  const second = { file: { name: 'same.png' }, url: 'blob:second' }
  const third = { file: { name: 'third.png' }, url: 'blob:third' }
  const frames = [first, second, third]

  const movedUp = editSequenceFrames(frames, { action: 'move_up', index: 2 })
  assert.equal(movedUp.changed, true)
  assert.deepEqual(movedUp.frames, [first, third, second])
  assert.equal(movedUp.frames[1], third)
  assert.equal(movedUp.focusIndex, 1)

  const movedDown = editSequenceFrames(frames, { action: 'move_down', index: 0 })
  assert.equal(movedDown.changed, true)
  assert.deepEqual(movedDown.frames, [second, first, third])
  assert.equal(movedDown.focusIndex, 1)

  const removed = editSequenceFrames(frames, { action: 'remove', index: 1 })
  assert.equal(removed.changed, true)
  assert.deepEqual(removed.frames, [first, third])
  assert.equal(removed.removedFrame, second)
  assert.equal(removed.focusIndex, 1)

  assert.deepEqual(frames, [first, second, third])
  assert.notEqual(movedUp.frames, frames)
  assert.notEqual(movedDown.frames, frames)
  assert.notEqual(removed.frames, frames)
})

test('Sequence frame edit boundaries and unknown actions fail closed', () => {
  const frames = [{ file: { name: 'a.png' } }, { file: { name: 'b.png' } }]
  for (const edit of [
    { action: 'move_up', index: 0 },
    { action: 'move_down', index: 1 },
    { action: 'remove', index: -1 },
    { action: 'remove', index: 2 },
    { action: 'invented', index: 0 },
  ]) {
    const result = editSequenceFrames(frames, edit)
    assert.equal(result.changed, false)
    assert.equal(result.frames, frames)
    assert.equal(result.removedFrame, null)
  }

  const removedLast = editSequenceFrames([frames[0]], { action: 'remove', index: 0 })
  assert.equal(removedLast.changed, true)
  assert.deepEqual(removedLast.frames, [])
  assert.equal(removedLast.focusIndex, -1)
})

test('Sequence options reuse export normalization and produce a canonical key', () => {
  const normalized = normalizeSequenceOptions({
    targetW: '64',
    targetH: 0,
    padding: -2,
    spacing: 999,
    columns: '3',
    fps: 121,
  })

  assert.deepEqual(normalized, {
    targetW: 64,
    targetH: 1,
    padding: 0,
    spacing: 128,
    columns: 3,
    fps: 120,
  })
  assert.equal(
    sequenceOptionsKey(normalized),
    sequenceOptionsKey({
      targetW: 64,
      targetH: 1,
      padding: 0,
      spacing: 128,
      columns: 3,
      fps: 120,
    }),
  )
  assert.notEqual(
    sequenceOptionsKey(normalized),
    sequenceOptionsKey({ ...normalized, spacing: 4 }),
  )
  assert.equal(
    normalizeSequenceOptions({ targetW: 10, targetH: 8, padding: 128 }).padding,
    3,
    'padding must leave at least one drawable pixel inside the smaller cell edge',
  )
})

test('Sequence plans reuse the sprite index for rows, sheet size, and timestamps', () => {
  const plan = buildSequencePlan({
    frameCount: 5,
    options: {
      targetW: 64,
      targetH: 96,
      padding: 4,
      spacing: 2,
      columns: 3,
      fps: 12,
    },
  })

  assert.equal(plan.frameCount, 5)
  assert.equal(plan.rows, 2)
  assert.deepEqual(plan.options, {
    targetW: 64,
    targetH: 96,
    padding: 4,
    spacing: 2,
    columns: 3,
    fps: 12,
  })
  assert.equal(plan.optionsKey, sequenceOptionsKey(plan.options))
  assert.deepEqual(plan.index.sheet_size, { w: 196, h: 194 })
  assert.deepEqual(plan.index.frames[3], {
    i: 3,
    x: 0,
    y: 98,
    w: 64,
    h: 96,
    t: 0.25,
  })
})

test('Sequence bindings are immutable operation snapshots and fail closed when stale', () => {
  const optionsKey = sequenceOptionsKey({ targetW: 32, targetH: 48 })
  const binding = createSequenceBinding({ sourceEpoch: 7, optionsKey })

  assert.equal(Object.isFrozen(binding), true)
  assert.equal(sequenceBindingIsCurrent(binding, { sourceEpoch: 7, optionsKey }), true)
  assert.equal(sequenceBindingIsCurrent(binding, { sourceEpoch: 8, optionsKey }), false)
  assert.equal(sequenceBindingIsCurrent(binding, {
    sourceEpoch: 7,
    optionsKey: sequenceOptionsKey({ targetW: 33, targetH: 48 }),
  }), false)
  assert.equal(sequenceBindingIsCurrent(null, { sourceEpoch: 7, optionsKey }), false)
  assert.throws(
    () => createSequenceBinding({ sourceEpoch: -1, optionsKey }),
    TypeError,
  )
})

test('Sprite ZIP contains only the fixed PNG, JSON, and optional GIF entries', async () => {
  const index = {
    version: '1.0',
    frame_size: { w: 16, h: 16 },
    sheet_size: { w: 32, h: 16 },
    frames: [],
  }
  const sheetBytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47)
  const gifBytes = Uint8Array.of(0x47, 0x49, 0x46)
  const zipBlob = await makeSpriteZip({
    sheetBlob: new Blob([sheetBytes], { type: 'image/png' }),
    index,
    gifBlob: new Blob([gifBytes], { type: 'image/gif' }),
  })
  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer(), { checkCRC32: true })

  assert.equal(zipBlob.type, 'application/zip')
  assert.deepEqual(Object.keys(zip.files), ['sprite.png', 'index.json', 'preview.gif'])
  assert.deepEqual(
    [...await zip.file('sprite.png').async('uint8array')],
    [...sheetBytes],
  )
  assert.equal(
    await zip.file('index.json').async('string'),
    JSON.stringify(index, null, 2),
  )
  assert.deepEqual(
    [...await zip.file('preview.gif').async('uint8array')],
    [...gifBytes],
  )

  const withoutGifBlob = await makeSpriteZip({
    sheetBlob: new Blob([sheetBytes]),
    index,
  })
  const withoutGif = await JSZip.loadAsync(await withoutGifBlob.arrayBuffer())
  assert.deepEqual(Object.keys(withoutGif.files), ['sprite.png', 'index.json'])
})
