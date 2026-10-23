import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { assertApiRequest, assertLocalRequest, readBoundedBody } from '../src/server/localRequest.js'

const request = (headers = {}, method = 'POST') => ({ method, socket: { remoteAddress: '127.0.0.1' },
  headers: { host: '127.0.0.1:55000', 'content-type': 'application/json', 'content-length': '2', ...headers } })
test('legacy and editor API share local-only, exact same-origin and JSON guards', async () => {
  for (const endpoint of ['/api/provider-config', '/api/editor/projects']) {
    assert.doesNotThrow(() => assertApiRequest(request(), endpoint))
    assert.doesNotThrow(() => assertApiRequest(request({ origin: 'http://127.0.0.1:55000', 'content-type': 'Application/JSON; charset=utf-8' }), endpoint))
    for (const headers of [{ origin: 'https://127.0.0.1:55000' }, { origin: 'http://127.0.0.1:55001' },
      { origin: 'null' }, { origin: '' }, { referer: 'https://external.example/' }, { host: 'evil.example' },
      { host: 'localhost:55000@evil.example' }, { host: 'localhost:55000/path' }]) {
      assert.throws(() => assertApiRequest(request(headers), endpoint), { code: 'forbidden_origin' })
    }
    for (const type of ['text/plain', 'application/jsonp', 'application/x-www-form-urlencoded', '']) {
      assert.throws(() => assertApiRequest(request({ 'content-type': type }), endpoint), { code: 'unsupported_media_type' })
    }
  }
  assert.throws(() => assertLocalRequest({ ...request(), socket: { remoteAddress: '10.0.0.1' } }), { code: 'forbidden_origin' })
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8')
  assert.match(server, /assertApiRequest\(req, url.pathname\)[\s\S]*await routeApi/)
})
test('binary uploads and empty cancellation/release retain their existing handlers', () => {
  for (const endpoint of ['/api/motion-source/uploads', '/api/editor/projects/p/sprite-documents/import-png',
    '/api/editor/projects/p/sprite-documents/import-jpeg', '/api/editor/projects/p/sprite-documents/general-sequence',
    '/api/editor/projects/p/sprite-documents/d/working-pixels']) {
    assert.doesNotThrow(() => assertApiRequest(request({ 'content-type': 'application/octet-stream', 'content-length': '1024' }), endpoint))
  }
  assert.doesNotThrow(() => assertApiRequest(request({ 'content-type': '', 'content-length': '0' }), '/api/motion-source/jobs/j/cancel'))
  assert.doesNotThrow(() => assertApiRequest(request({ 'content-type': '' }, 'DELETE'), '/api/motion-source/uploads/u'))
})
test('bounded reader checks both declared and streamed bytes without retaining an oversized body', async () => {
  const body = (chunks, headers = {}) => Object.assign(Readable.from(chunks.map(s => Buffer.from(s))), { headers })
  assert.equal((await readBoundedBody(body(['ab', 'cd']), 4)).toString(), 'abcd')
  await assert.rejects(readBoundedBody(body(['ab'], { 'content-length': '5' }), 4), { code: 'request_too_large' })
  await assert.rejects(readBoundedBody(body(['ab', 'cde']), 4), { code: 'request_too_large' })
  await assert.rejects(readBoundedBody(body([], { 'content-length': '-1' }), 4), { code: 'invalid_content_length' })
})
