import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import * as editorProject from '../../src/editor-project/index.js'

test('implementation revision resolver is exported for one-time server wiring', () => {
  assert.equal(typeof editorProject.resolveImplementationRevision, 'function')
})

test('implementation revision uses explicit priority and fails closed on invalid configured values', () => {
  const resolve = editorProject.resolveImplementationRevision
  assert.equal(resolve({ env: {}, packageVersion: '0.4.0' }), 'package-0.4.0')
  assert.equal(resolve({ env: { GIT_COMMIT_SHA: ' git-sha ' }, packageVersion: '0.4.0' }), 'git-sha')
  assert.equal(resolve({
    env: { GAMETOOL_BUILD_REVISION: ' release-1 ', GIT_COMMIT_SHA: 'git-sha' },
    packageVersion: '0.4.0',
  }), 'release-1')
  for (const env of [
    { GAMETOOL_BUILD_REVISION: '' },
    { GAMETOOL_BUILD_REVISION: 'bad\nrevision' },
    { GAMETOOL_BUILD_REVISION: `a${'b'.repeat(128)}` },
    { GIT_COMMIT_SHA: '' },
  ]) {
    assert.throws(
      () => resolve({ env, packageVersion: '0.4.0' }),
      (error) => error?.code === 'invalid_implementation_revision',
    )
  }
  assert.throws(
    () => resolve({ env: {}, packageVersion: undefined }),
    (error) => error?.code === 'invalid_implementation_revision',
  )
})

test('server wires one provider-free reprocess service to the existing queue and distinct real generated root', async () => {
  const source = await readFile(new URL('../../server.js', import.meta.url), 'utf8')
  assert.equal((source.match(/createJobQueue\s*\(/g) ?? []).length, 2)
  assert.match(source, /const jobQueue = createJobQueue\(\{ concurrency: process\.env\.CHARACTER_JOB_CONCURRENCY \|\| 2 \}\)/)
  assert.match(source, /const motionMediaQueue = createJobQueue\(\{ concurrency: 1 \}\)/)
  assert.equal((source.match(/resolveImplementationRevision\s*\(/g) ?? []).length, 1)
  assert.match(source, /const implementationRevision = resolveImplementationRevision\(\{ env: process\.env, packageVersion \}\)/)
  assert.match(source, /const characterReprocessService = createCharacterReprocessService\(\{/)
  assert.match(source, /jobQueue,\s*\n\s*createJob,\s*\n\s*getJob,\s*\n\s*updateJob,/)
  assert.match(source, /processSheet: processSheetBuffer,/)
  assert.match(source, /writeCharacterArtifacts:\s*\(\{ job, result \}\)\s*=>\s*writeCharacterPackArtifacts\(\{/)
  assert.match(source, /allowExistingJobDir:\s*true/)
  assert.doesNotMatch(
    source.match(/const characterReprocessService[\s\S]*?\n\}\)/)?.[0] ?? '',
    /writeJobArtifacts/,
  )
  assert.match(source, /writeEvidence:\s*\(input\)\s*=>\s*writeCharacterReprocessEvidence\(\{ generatedDir, \.\.\.input \}\)/)
  assert.match(source, /const characterReprocessCoordinator = createCharacterReprocessCoordinator\(\{/)
  assert.match(source, /reprocessGeneratedDir:\s*generatedDir/)
  assert.match(source, /generatedDir:\s*editorGeneratedDir/)
  assert.match(source, /characterReprocessCoordinator,/)
  assert.match(source, /reprocessService:\s*characterReprocessService/)
  const serviceBlock = source.slice(
    source.indexOf('const characterReprocessService ='),
    source.indexOf('const characterReprocessCoordinator ='),
  )
  assert.doesNotMatch(serviceBlock, /currentProviderEnv|provider|prompt/i)
})

test('local env loading preserves explicitly configured blank values for fail-closed build revision validation', async () => {
  const source = await readFile(new URL('../../server.js', import.meta.url), 'utf8')
  assert.match(source, /Object\.hasOwn\(process\.env, key\)/)
})
