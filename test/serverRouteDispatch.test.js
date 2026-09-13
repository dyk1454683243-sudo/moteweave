import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { routeApi } from '../src/server/routes/index.js'

const HANDLER_NAMES = Object.freeze([
  'editor',
  'job',
  'geminiState',
  'benchmarkGallery',
  'providerConfig',
  'repairCharacterAction',
  'processSheet',
  'generateCharacterReview',
  'generateCharacter',
  'acceptGeneratedCharacter',
  'buildFrameGif',
  'motionSourceToolStatus',
  'motionSourceUpload',
  'releaseMotionSourceUploadOperation',
  'releaseMotionSourceUpload',
  'cancelMotionSourceJob',
  'analyzeMotionSource',
  'previewMotionFrames',
  'buildMotionStrip',
  'applyMotionStrip',
  'analyzeMotionSourceSet',
  'applyMotionSourceSet',
  'processSceneTiles',
  'generateSceneTiles',
  'buildTwoPointFiveDTileset',
  'twoPointFiveDMaterialSourceBenchmark',
  'projectPack',
])

const ROUTE_CASES = Object.freeze([
  ['POST', '/api/editor/projects', 'editor'],
  ['GET', '/api/jobs/job-1', 'job', 'job-1'],
  ['GET', '/api/gemini-state', 'geminiState'],
  ['GET', '/api/benchmark-gallery', 'benchmarkGallery'],
  ['POST', '/api/provider-config', 'providerConfig'],
  ['POST', '/api/repair-character-action', 'repairCharacterAction'],
  ['POST', '/api/process-sheet', 'processSheet'],
  ['POST', '/api/generate-character/review', 'generateCharacterReview'],
  ['POST', '/api/generate-character', 'generateCharacter'],
  [
    'POST',
    '/api/generate-character/job-reviewed-1/accept',
    'acceptGeneratedCharacter',
    'job-reviewed-1',
  ],
  ['POST', '/api/build-frame-gif', 'buildFrameGif'],
  ['GET', '/api/motion-source-tool-status', 'motionSourceToolStatus'],
  ['POST', '/api/motion-source/uploads?source_name=walk.gif', 'motionSourceUpload', 'url'],
  [
    'DELETE',
    '/api/motion-source/upload-operations/operation-1',
    'releaseMotionSourceUploadOperation',
    'operation-1',
  ],
  [
    'DELETE',
    '/api/motion-source/uploads/upload-1',
    'releaseMotionSourceUpload',
    'upload-1',
  ],
  [
    'POST',
    '/api/motion-source/jobs/job-2/cancel',
    'cancelMotionSourceJob',
    'job-2',
  ],
  ['POST', '/api/analyze-motion-source', 'analyzeMotionSource'],
  ['POST', '/api/preview-motion-frames', 'previewMotionFrames'],
  ['POST', '/api/build-motion-strip', 'buildMotionStrip'],
  ['POST', '/api/apply-motion-strip', 'applyMotionStrip'],
  ['POST', '/api/analyze-motion-source-set', 'analyzeMotionSourceSet'],
  ['POST', '/api/apply-motion-source-set', 'applyMotionSourceSet'],
  ['POST', '/api/process-scene-tiles', 'processSceneTiles'],
  ['POST', '/api/generate-scene-tiles', 'generateSceneTiles'],
  ['POST', '/api/build-two-point-five-d-tileset', 'buildTwoPointFiveDTileset'],
  [
    'POST',
    '/api/two-point-five-d-material-source-benchmark',
    'twoPointFiveDMaterialSourceBenchmark',
  ],
  ['POST', '/api/project-pack', 'projectPack'],
])

function createContext(method, pathname) {
  return {
    req: { method },
    res: {},
    url: new URL(pathname, 'http://127.0.0.1:4173'),
  }
}

function createHandlers(calls) {
  return Object.fromEntries(HANDLER_NAMES.map((name) => [
    name,
    async (...args) => {
      calls.push({ name, args })
    },
  ]))
}

function expectedArguments(context, specialArgument) {
  if (specialArgument === 'url') return [context.req, context.res, context.url]
  if (specialArgument !== undefined) {
    return [context.req, context.res, specialArgument]
  }
  return [context.req, context.res]
}

for (const [method, pathname, expectedHandler, specialArgument] of ROUTE_CASES) {
  test(`${method} ${pathname} dispatches only to ${expectedHandler}`, async () => {
    const calls = []
    const context = createContext(method, pathname)
    const matched = await routeApi({
      ...context,
      handlers: createHandlers(calls),
    })

    assert.equal(matched, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, expectedHandler)
    const expected = expectedArguments(context, specialArgument)
    assert.equal(calls[0].args.length, expected.length)
    for (let index = 0; index < expected.length; index += 1) {
      assert.equal(calls[0].args[index], expected[index])
    }
  })
}

test('shared jobs preserve prefix matching and final-segment extraction', async () => {
  for (const [pathname, expectedJobId] of [
    ['/api/jobs/parent/child', 'child'],
    ['/api/jobs/', ''],
  ]) {
    const calls = []
    const context = createContext('GET', pathname)
    assert.equal(await routeApi({
      ...context,
      handlers: createHandlers(calls),
    }), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'job')
    assert.equal(calls[0].args[2], expectedJobId)
  }
})

test('wrong methods, near matches, and unknown paths fall through untouched', async () => {
  for (const [method, pathname] of [
    ['GET', '/api/editor'],
    ['GET', '/api/provider-config'],
    ['GET', '/api/generate-character'],
    ['POST', '/api/generate-character/../accept'],
    ['GET', '/api/generate-character/job-reviewed-1/accept'],
    ['POST', '/api/motion-source-tool-status'],
    ['GET', '/api/motion-source/uploads'],
    ['DELETE', '/api/motion-source/upload-operations/'],
    ['DELETE', '/api/motion-source/uploads/upload-1/extra'],
    ['POST', '/api/motion-source/jobs/job-2/cancel/extra'],
    ['GET', '/api/process-scene-tiles'],
    ['GET', '/api/project-pack'],
    ['POST', '/api/jobs/job-1'],
    ['GET', '/api/unknown'],
  ]) {
    const calls = []
    const context = createContext(method, pathname)
    const originalHref = context.url.href
    assert.equal(await routeApi({
      ...context,
      handlers: createHandlers(calls),
    }), false)
    assert.deepEqual(calls, [])
    assert.equal(context.req.method, method)
    assert.equal(context.url.href, originalHref)
  }
})

test('a matched handler error propagates without translation or retry', async () => {
  const expectedError = new Error('expected route failure')
  const calls = []
  const context = createContext('POST', '/api/generate-character')
  const handlers = createHandlers(calls)
  handlers.generateCharacter = async (...args) => {
    calls.push({ name: 'generateCharacter', args })
    throw expectedError
  }

  await assert.rejects(
    routeApi({ ...context, handlers }),
    (error) => error === expectedError,
  )
  assert.equal(calls.length, 1)
})

test('aggregate domain routing order stays explicit and stable', async () => {
  const source = await readFile(
    new URL('../src/server/routes/index.js', import.meta.url),
    'utf8',
  )
  const start = source.indexOf('const DOMAIN_ROUTERS = Object.freeze([')
  const end = source.indexOf('])', start)
  assert.ok(start >= 0 && end > start)
  const routeNames = [
    ...source.slice(start, end).matchAll(/^\s{2}(route[A-Z][A-Za-z]+),$/gm),
  ].map((match) => match[1])

  assert.deepEqual(routeNames, [
    'routeEditor',
    'routeCharacter',
    'routeMotion',
    'routeShared',
    'routeScene',
    'routeProject',
  ])
})
