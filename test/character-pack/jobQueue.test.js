import test from 'node:test'
import assert from 'node:assert/strict'

import { createJobQueue } from '../../src/character-pack/jobQueue.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('createJobQueue caps concurrent jobs and starts queued jobs later', async () => {
  const queue = createJobQueue({ concurrency: 2 })
  const first = deferred()
  const second = deferred()
  const third = deferred()
  const started = []

  queue.enqueue(async () => {
    started.push('first')
    await first.promise
  })
  queue.enqueue(async () => {
    started.push('second')
    await second.promise
  })
  queue.enqueue(async () => {
    started.push('third')
    await third.promise
  })

  assert.deepEqual(started, ['first', 'second'])
  assert.deepEqual(queue.stats(), { active: 2, queued: 1, concurrency: 2 })
  first.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(started, ['first', 'second', 'third'])
  second.resolve()
  third.resolve()
})

test('createJobQueue reports task errors through onError callback', async () => {
  const queue = createJobQueue({ concurrency: 1 })
  const errors = []

  queue.enqueue(
    async () => {
      throw new Error('boom')
    },
    (error) => errors.push(error.message)
  )

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(errors, ['boom'])
  assert.deepEqual(queue.stats(), { active: 0, queued: 0, concurrency: 1 })
})
