import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

import { SPRITE_DOCUMENT_LIMITS } from '../../src/editor-project/constants.js'
import {
  PIXEL_WORKING_COPY_LIMITS,
  createPixelWorkingCopy,
  modifyPixelWorkingCopy,
  redoPixelWorkingCopy,
  undoPixelWorkingCopy,
} from '../../src/editor-project/pixelWorkingCopy.js'
import { spriteDocumentError } from '../../src/editor-project/spriteDocumentValidation.js'

function rgba(width, height, fill) {
  const bytes = new Uint8Array(width * height * 4)
  for (let index = 0; index < bytes.length; index += 4) {
    bytes[index] = fill[0]
    bytes[index + 1] = fill[1]
    bytes[index + 2] = fill[2]
    bytes[index + 3] = fill[3]
  }
  return bytes
}

function code(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

test('pixel working copy keeps source RGBA, including transparent channels, and ignores later external writes', () => {
  const source = Uint8Array.of(9, 8, 7, 0, 1, 2, 3, 255)
  const copy = createPixelWorkingCopy({ width: 2, height: 1, rgba: source })
  source[0] = 99
  source[3] = 255
  const read = copy.pixels()
  assert.deepEqual([...read], [9, 8, 7, 0, 1, 2, 3, 255])
  read[0] = 4
  assert.deepEqual([...copy.pixels()], [9, 8, 7, 0, 1, 2, 3, 255])
  assert.equal(PIXEL_WORKING_COPY_LIMITS.maxEdge, SPRITE_DOCUMENT_LIMITS.maxCanvasEdge)
})

test('pixel working copy accepts one cel and rejects paths, extra frames, and bad sizes', () => {
  const bytes = Uint8Array.of(4, 5, 6, 0)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const copy = createPixelWorkingCopy({
    frame_order: ['frame_1'],
    layer_order: ['layer_1'],
    cels: { cel_1: { block: { w: 1, h: 1, sha256: digest }, rgba: bytes } },
  })
  assert.deepEqual([...copy.pixels()], [4, 5, 6, 0])
  assert.equal(code(() => createPixelWorkingCopy('workspace/source.png'))?.code, 'invalid_request')
  assert.equal(code(() => createPixelWorkingCopy({
    frame_order: ['a', 'b'],
    layer_order: ['layer_1'],
    cels: { cel_1: { block: { w: 1, h: 1 }, rgba: bytes } },
  }))?.code, 'unsupported_input')
  assert.equal(code(() => createPixelWorkingCopy({ width: 4097, height: 1, rgba: new Uint8Array(4097 * 4) }))?.code, 'resource_limit')
  assert.equal(code(() => createPixelWorkingCopy({ width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3) }))?.code, 'invalid_request')
  assert.equal(code(() => createPixelWorkingCopy({
    block: { w: 1, h: 1, sha256: 'a'.repeat(64) },
    rgba: bytes,
  }))?.code, 'artifact_integrity_failed')
})

test('rectangle writes stay inside the working copy, restore byte for byte, and clear redo on a new branch', () => {
  const copy = createPixelWorkingCopy({ width: 2, height: 2, rgba: rgba(2, 2, [1, 1, 1, 255]) })
  modifyPixelWorkingCopy(copy, { x: 1, y: 0, w: 1, h: 1 }, Uint8Array.of(9, 8, 7, 0))
  assert.deepEqual([...copy.pixels()], [1, 1, 1, 255, 9, 8, 7, 0, 1, 1, 1, 255, 1, 1, 1, 255])
  undoPixelWorkingCopy(copy)
  assert.deepEqual([...copy.pixels()], [...rgba(2, 2, [1, 1, 1, 255])])
  redoPixelWorkingCopy(copy)
  assert.equal(copy.pixels()[4], 9)
  undoPixelWorkingCopy(copy)
  modifyPixelWorkingCopy(copy, { x: 0, y: 1, w: 1, h: 1 }, Uint8Array.of(2, 3, 4, 5))
  redoPixelWorkingCopy(copy)
  assert.equal(copy.pixels()[4], 1)
  assert.equal(copy.pixels()[8], 2)
  const outside = code(() => modifyPixelWorkingCopy(copy, { x: 1, y: 1, w: 2, h: 1 }, new Uint8Array(8)))
  assert.equal(outside?.code, 'invalid_request')
  assert.equal(copy.pixels()[8], 2)
})

test('pixel history rejects the 101st step and a delta past 64MiB before changing pixels', () => {
  const small = createPixelWorkingCopy({ width: 1, height: 1, rgba: Uint8Array.of(0, 0, 0, 255) })
  for (let step = 0; step < PIXEL_WORKING_COPY_LIMITS.maxHistorySteps; step += 1) {
    modifyPixelWorkingCopy(small, { x: 0, y: 0, w: 1, h: 1 }, Uint8Array.of(step, 0, 0, 255))
  }
  const blocked = code(() => modifyPixelWorkingCopy(small, { x: 0, y: 0, w: 1, h: 1 }, Uint8Array.of(9, 9, 9, 9)))
  assert.equal(blocked?.code, 'resource_limit')
  assert.equal(blocked?.details?.limit, 100)
  assert.equal(small.pixels()[0], 99)

  const width = 1024
  const height = 1024
  const large = createPixelWorkingCopy({ width, height, rgba: rgba(width, height, [0, 0, 0, 0]) })
  const patch = rgba(width, height, [3, 2, 1, 0])
  for (let step = 0; step < 16; step += 1) {
    patch[0] = step
    modifyPixelWorkingCopy(large, { x: 0, y: 0, w: width, h: height }, patch)
  }
  const before = large.pixels()[0]
  const over = code(() => modifyPixelWorkingCopy(large, { x: 0, y: 0, w: width, h: height }, rgba(width, height, [8, 8, 8, 8])))
  assert.equal(over?.code, 'resource_limit')
  assert.equal(over?.details?.limit, PIXEL_WORKING_COPY_LIMITS.maxHistoryBytes)
  assert.equal(large.pixels()[0], before)
  assert.equal(spriteDocumentError('resource_limit', 'pixel history exceeds 64MiB').code, 'resource_limit')
})
