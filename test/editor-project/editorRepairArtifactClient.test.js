import test from 'node:test'
import assert from 'node:assert/strict'

import { createRepairArtifactClient } from '../../src/ui/editor/artifactClient.js'

const managedJsonUrl = '/api/editor/artifact?path=workspace%2Fprojects%2Fproject_demo%2Fassets%2Fasset_hero%2Frev_003%2Fanimations.json'
const generatedJsonUrl = '/generated/job_preview/animations.json'
const generatedImageUrl = '/generated/job_preview/normalized_sheet.png'
const qualityGateSessionId = 'frqg_20260713_primary'
const qualityGateJsonUrl = `/generated/frame-repair-quality-gates/${qualityGateSessionId}/session_plan.json`

function fakeResponse({ status = 200, json = {}, blob = { bytes: 'png' } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(json),
    blob: async () => blob,
    text: async () => JSON.stringify(json),
  }
}

function assertUnsafe(load) {
  assert.throws(load, (error) => {
    assert.equal(error.code, 'unsafe_artifact_path')
    assert.match(error.message, /controlled allowlist/)
    return true
  })
}

test('artifact client accepts only exact recorded managed and explicit generated URLs', async () => {
  let fetchCalls = 0
  const client = createRepairArtifactClient({
    fetchImpl: async () => {
      fetchCalls += 1
      return fakeResponse({ json: { ok: true } })
    },
  })
  const allowedManagedUrls = new Set([managedJsonUrl])
  const allowedGeneratedUrls = new Set([generatedJsonUrl])

  assert.deepEqual(await client.loadJson({
    identity: 'asset_hero:rev_003',
    url: managedJsonUrl,
    allowedManagedUrls,
  }), { ok: true })
  assert.deepEqual(await client.loadJson({
    identity: 'job:job_preview',
    url: generatedJsonUrl,
    allowedGeneratedUrls,
  }), { ok: true })
  assert.equal(fetchCalls, 2)

  for (const entry of [
    {
      url: '/generated/job_other/animations.json',
      allowedGeneratedUrls,
    },
    {
      url: '/generated/job_preview/debug_report.json',
      allowedGeneratedUrls,
    },
    {
      url: 'https://example.test/generated/job_preview/animations.json',
      allowedGeneratedUrls: new Set(['https://example.test/generated/job_preview/animations.json']),
    },
    {
      url: '/generated/job_preview/../secret.json',
      allowedGeneratedUrls: new Set(['/generated/job_preview/../secret.json']),
    },
    {
      url: '/generated/job_preview/animations.json?download=1',
      allowedGeneratedUrls: new Set(['/generated/job_preview/animations.json?download=1']),
    },
    {
      url: '/generated/job_preview/subdir/animations.json',
      allowedGeneratedUrls: new Set(['/generated/job_preview/subdir/animations.json']),
    },
    {
      url: '/generated/job_preview%2Fjob_other/animations.json',
      allowedGeneratedUrls: new Set(['/generated/job_preview%2Fjob_other/animations.json']),
    },
    {
      url: 'data:application/json,%7B%7D',
      allowedGeneratedUrls: new Set(['data:application/json,%7B%7D']),
    },
    {
      url: '/unknown/job_preview/animations.json',
      allowedGeneratedUrls: new Set(['/unknown/job_preview/animations.json']),
    },
    {
      url: '/api/editor/artifact?path=..%2Fsecret.json',
      allowedManagedUrls: new Set(['/api/editor/artifact?path=..%2Fsecret.json']),
    },
    {
      url: '/api/editor/artifact?path=workspace%2Fprojects%2Fproject_demo%2Ffile.json&download=1',
      allowedManagedUrls: new Set(['/api/editor/artifact?path=workspace%2Fprojects%2Fproject_demo%2Ffile.json&download=1']),
    },
    {
      url: '/api/editor/artifact?path=generated%2Fjob_preview%2Fanimations.json',
      allowedManagedUrls: new Set(['/api/editor/artifact?path=generated%2Fjob_preview%2Fanimations.json']),
    },
    {
      url: '/api/editor/artifact?path=workspace%252Fprojects%252Fproject_demo%252Ffile.json',
      allowedManagedUrls: new Set(['/api/editor/artifact?path=workspace%252Fprojects%252Fproject_demo%252Ffile.json']),
    },
  ]) {
    assertUnsafe(() => client.loadJson({
      identity: 'blocked',
      allowedManagedUrls: new Set(),
      allowedGeneratedUrls: new Set(),
      ...entry,
    }))
  }
  assert.equal(fetchCalls, 2)

  assertUnsafe(() => client.loadJson({
    identity: 'job:job_other',
    url: generatedJsonUrl,
    allowedGeneratedUrls,
  }))
})

test('quality-gate artifacts require the exact session identity, fixed filename, and current allowlist', async () => {
  let fetchCalls = 0
  const client = createRepairArtifactClient({
    fetchImpl: async () => {
      fetchCalls += 1
      return fakeResponse({ json: { protocol: 'frame_repair_quality_gate_plan_v1' } })
    },
  })
  const allowedGeneratedUrls = new Set([qualityGateJsonUrl])
  assert.deepEqual(await client.loadJson({
    identity: `quality-gate:${qualityGateSessionId}`,
    url: qualityGateJsonUrl,
    allowedGeneratedUrls,
  }), { protocol: 'frame_repair_quality_gate_plan_v1' })
  for (const url of [
    qualityGateJsonUrl.replace(qualityGateSessionId, 'frqg_20260713_another'),
    `${qualityGateJsonUrl}?download=1`,
    qualityGateJsonUrl.replace('session_plan.json', 'nested/session_plan.json'),
    qualityGateJsonUrl.replace('session_plan.json', 'private.json'),
    qualityGateJsonUrl.replace('session_plan.json', 'case_case_a_review.json'),
    qualityGateJsonUrl.replace('frame-repair-quality-gates', 'frame-repair-quality-gates%2Fescape'),
  ]) {
    assertUnsafe(() => client.loadJson({
      identity: `quality-gate:${qualityGateSessionId}`,
      url,
      allowedGeneratedUrls,
    }))
  }
  assert.equal(fetchCalls, 1)
})

test('JSON and image loads deduplicate by identity and controlled URL', async () => {
  const calls = []
  let decodes = 0
  const client = createRepairArtifactClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return url.endsWith('.png')
        ? fakeResponse({ blob: { url, sequence: calls.length } })
        : fakeResponse({ json: { url, sequence: calls.length } })
    },
    decodeImage: async (blob) => {
      decodes += 1
      return { decoded: blob }
    },
  })
  const allowedManagedUrls = new Set([managedJsonUrl])
  const allowedGeneratedUrls = new Set([generatedImageUrl])

  const jsonA = client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  const jsonB = client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  const imageA = client.loadImage({ identity: 'job:job_preview', url: generatedImageUrl, allowedGeneratedUrls })
  const imageB = client.loadImage({ identity: 'job:job_preview', url: generatedImageUrl, allowedGeneratedUrls })

  assert.equal(jsonA, jsonB)
  assert.equal(imageA, imageB)
  assert.deepEqual(await jsonA, { url: managedJsonUrl, sequence: 1 })
  assert.deepEqual(await imageA, {
    decoded: { url: generatedImageUrl, sequence: 2 },
  })
  assert.equal(calls.length, 2)
  assert.equal(decodes, 1)

  await client.loadJson({ identity: 'asset:other-revision', url: managedJsonUrl, allowedManagedUrls })
  assert.equal(calls.length, 3)
})

test('clearRepairArtifactCache evicts only the selected revision or job identity', async () => {
  const counts = new Map()
  const client = createRepairArtifactClient({
    fetchImpl: async (url) => {
      counts.set(url, (counts.get(url) ?? 0) + 1)
      return fakeResponse({ json: { url, call: counts.get(url) } })
    },
  })
  const allowedManagedUrls = new Set([managedJsonUrl])
  const allowedGeneratedUrls = new Set([generatedJsonUrl])

  await client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  await client.loadJson({ identity: 'job:job_preview', url: generatedJsonUrl, allowedGeneratedUrls })
  client.clearRepairArtifactCache('asset:rev')
  const managedReload = await client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  const generatedCached = await client.loadJson({ identity: 'job:job_preview', url: generatedJsonUrl, allowedGeneratedUrls })

  assert.equal(managedReload.call, 2)
  assert.equal(generatedCached.call, 1)
  assert.equal(counts.get(managedJsonUrl), 2)
  assert.equal(counts.get(generatedJsonUrl), 1)
})

test('artifact failures preserve controlled codes and details while collapsing unknown codes', async () => {
  const details = { artifact: 'workspace/projects/project_demo/escape.json', realpath: '/outside/escape.json' }
  const responses = [
    fakeResponse({
      status: 403,
      json: { error: 'unsafe_artifact_path', reason: 'managed artifact escaped its root', details },
    }),
    fakeResponse({
      status: 418,
      json: { error: 'internal_stack_marker', reason: 'request was rejected', details: { request_id: 'req_1' } },
    }),
    fakeResponse({ json: { recovered: true } }),
  ]
  let calls = 0
  const client = createRepairArtifactClient({
    fetchImpl: async () => responses[calls++],
  })
  const allowedManagedUrls = new Set([managedJsonUrl])

  await assert.rejects(
    client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls }),
    (error) => {
      assert.equal(error.name, 'RepairArtifactError')
      assert.equal(error.status, 403)
      assert.equal(error.code, 'unsafe_artifact_path')
      assert.equal(error.message, 'managed artifact escaped its root')
      assert.deepEqual(error.details, details)
      return true
    },
  )
  await assert.rejects(
    client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls }),
    (error) => {
      assert.equal(error.status, 418)
      assert.equal(error.code, 'artifact_request_failed')
      assert.deepEqual(error.details, { request_id: 'req_1' })
      return true
    },
  )
  assert.deepEqual(
    await client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls }),
    { recovered: true },
  )
  assert.equal(calls, 3)
})

test('artifact client forwards AbortSignal and evicts decode rejections', async () => {
  const seenSignals = []
  let decodeCalls = 0
  const client = createRepairArtifactClient({
    fetchImpl: async (_url, options) => {
      seenSignals.push(options.signal)
      return fakeResponse({ blob: { value: decodeCalls + 1 } })
    },
    decodeImage: async (blob) => {
      decodeCalls += 1
      if (decodeCalls === 1) throw Object.assign(new Error('decode failed'), { code: 'decode_failed' })
      return { decoded: blob.value }
    },
  })
  const allowedGeneratedUrls = new Set([generatedImageUrl])
  const controller = new AbortController()

  await assert.rejects(
    client.loadImage({
      identity: 'job:job_preview',
      url: generatedImageUrl,
      allowedGeneratedUrls,
      signal: controller.signal,
    }),
    (error) => {
      assert.equal(error.name, 'RepairArtifactError')
      assert.equal(error.code, 'artifact_request_failed')
      assert.equal(error.message, 'decode failed')
      return true
    },
  )
  assert.deepEqual(
    await client.loadImage({ identity: 'job:job_preview', url: generatedImageUrl, allowedGeneratedUrls }),
    { decoded: 2 },
  )
  assert.equal(decodeCalls, 2)
  assert.equal(seenSignals[0], controller.signal)
  assert.equal(seenSignals[1], undefined)
})

test('successful HTTP responses preserve retryable SyntaxError JSON diagnostics', async () => {
  let calls = 0
  const client = createRepairArtifactClient({
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('invalid JSON evidence') },
        }
      }
      return fakeResponse({ json: { valid: true } })
    },
  })
  const allowedManagedUrls = new Set([managedJsonUrl])

  await assert.rejects(
    client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls }),
    (error) => {
      assert.ok(error instanceof SyntaxError)
      assert.equal(error.message, 'invalid JSON evidence')
      return true
    },
  )
  assert.deepEqual(
    await client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls }),
    { valid: true },
  )
  assert.equal(calls, 2)
})

test('a cleared old rejection cannot evict a newer same-identity cache generation', async () => {
  let rejectOld
  let resolveNew
  let calls = 0
  const oldResponse = new Promise((_resolve, reject) => { rejectOld = reject })
  const newResponse = new Promise((resolve) => { resolveNew = resolve })
  const client = createRepairArtifactClient({
    fetchImpl: () => {
      calls += 1
      return calls === 1 ? oldResponse : newResponse
    },
  })
  const allowedManagedUrls = new Set([managedJsonUrl])

  const oldLoad = client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  await Promise.resolve()
  client.clearRepairArtifactCache('asset:rev')
  const newLoad = client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  await Promise.resolve()
  rejectOld(new Error('old request failed late'))
  await assert.rejects(oldLoad, /old request failed late/)

  const sharedNewLoad = client.loadJson({ identity: 'asset:rev', url: managedJsonUrl, allowedManagedUrls })
  assert.equal(sharedNewLoad, newLoad)
  assert.equal(calls, 2)
  resolveNew(fakeResponse({ json: { generation: 'new' } }))
  assert.deepEqual(await newLoad, { generation: 'new' })
})
