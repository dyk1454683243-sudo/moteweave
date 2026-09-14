import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { requestFrameGif } from '../src/ui/sprite/api.js'

function namedBlob(name, bytes) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
  Object.defineProperty(blob, 'name', { value: name })
  return blob
}

test('Frame GIF request sends the exact synchronous endpoint body and returns its Blob', async () => {
  const resultBlob = new Blob(['GIF89a'], { type: 'image/gif' })
  const controller = new AbortController()
  const calls = []
  const events = []
  const result = await requestFrameGif({
    framesBase64: ['Zmlyc3Q=', 'c2Vjb25k'],
    options: {
      targetW: '64',
      targetH: 48,
      padding: 3,
      spacing: 7,
      columns: 9,
      fps: '15',
    },
    signal: controller.signal,
    onRequestStart: () => events.push('request-start'),
    fetchImpl: async (url, request) => {
      events.push('fetch')
      calls.push({ url, request })
      return {
        ok: true,
        status: 200,
        blob: async () => resultBlob,
      }
    },
  })

  assert.equal(result, resultBlob)
  assert.deepEqual(events, ['request-start', 'fetch'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/build-frame-gif')
  assert.equal(calls[0].request.method, 'POST')
  assert.deepEqual(calls[0].request.headers, {
    'content-type': 'application/json',
  })
  assert.equal(calls[0].request.signal, controller.signal)
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    frames_base64: ['Zmlyc3Q=', 'c2Vjb25k'],
    options: {
      targetW: 64,
      targetH: 48,
      padding: 3,
      fps: 15,
    },
  })
})

test('File inputs are naturally sorted and encoded without a DOM dependency', async () => {
  let body = null
  await requestFrameGif({
    files: [
      namedBlob('frame10.png', [0x43]),
      namedBlob('frame2.png', [0x42]),
      namedBlob('frame1.png', [0x41]),
    ],
    options: {},
    fetchImpl: async (_url, request) => {
      body = JSON.parse(request.body)
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(['GIF89a']),
      }
    },
  })

  assert.deepEqual(body, {
    frames_base64: ['QQ==', 'Qg==', 'Qw=='],
    options: {
      targetW: 256,
      targetH: 256,
      padding: 0,
      fps: 12,
    },
  })
})

test('Explicit ordered frames preserve the edited UI order for the GIF body', async () => {
  let body = null
  const frame10 = { file: namedBlob('frame10.png', [0x43]) }
  const frame2 = { file: namedBlob('frame2.png', [0x42]) }
  const frame1 = { file: namedBlob('frame1.png', [0x41]) }

  await requestFrameGif({
    orderedFrames: [frame10, frame1, frame2],
    files: [frame1, frame2, frame10],
    fetchImpl: async (_url, request) => {
      body = JSON.parse(request.body)
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(['GIF89a']),
      }
    },
  })

  assert.deepEqual(body.frames_base64, ['Qw==', 'QQ==', 'Qg=='])
})

test('Invalid ordered frames fail before the GIF request starts', async () => {
  let requestStarts = 0
  let fetchCalls = 0
  await assert.rejects(
    requestFrameGif({
      orderedFrames: {},
      onRequestStart: () => { requestStarts += 1 },
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error('fetch must not run')
      },
    }),
    /orderedFrames must be an array/,
  )
  assert.equal(requestStarts, 0)
  assert.equal(fetchCalls, 0)
})

test('Frame GIF 400 responses expose the server reason without retrying', async () => {
  let calls = 0
  await assert.rejects(
    requestFrameGif({
      framesBase64: [],
      options: {},
      fetchImpl: async () => {
        calls += 1
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'gif_build_failed',
            reason: 'At least one frame is required to build a GIF',
          }),
        }
      },
    }),
    (error) => {
      assert.equal(error.message, 'At least one frame is required to build a GIF')
      assert.equal(error.code, 'gif_build_failed')
      assert.equal(error.status, 400)
      assert.equal(error.reason, 'At least one frame is required to build a GIF')
      return true
    },
  )
  assert.equal(calls, 1)
})

test('Frame GIF request-start fires only after local frame encoding succeeds', async () => {
  let requestStarts = 0
  let fetchCalls = 0
  const brokenFrame = {
    name: 'broken.png',
    arrayBuffer: async () => {
      throw new Error('local read failed')
    },
  }

  await assert.rejects(
    requestFrameGif({
      files: [brokenFrame],
      onRequestStart: () => { requestStarts += 1 },
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error('fetch must not run')
      },
    }),
    /local read failed/,
  )
  assert.equal(requestStarts, 0)
  assert.equal(fetchCalls, 0)
})

test('Sequence GIF API has no Job, cancellation, resume, or Provider surface', async () => {
  const source = await readFile(
    new URL('../src/ui/sprite/api.js', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/\/api\//g)?.length, 1)
  assert.match(source, /fetchImpl\('\/api\/build-frame-gif'/)
  assert.doesNotMatch(source, /\/api\/jobs|cancel|resume|provider/i)
})
