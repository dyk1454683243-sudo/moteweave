import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('server constructs and injects exactly one provider-free quality-gate coordinator', async () => {
  const source = await readFile(new URL('../../server.js', import.meta.url), 'utf8')
  assert.equal((source.match(/createFrameRepairQualityGateCoordinator\s*\(/g) ?? []).length, 1)
  const frameCoordinatorIndex = source.indexOf('const frameRepairCoordinator = createFrameRepairCoordinator')
  const qualityCoordinatorIndex = source.indexOf(
    'const frameRepairQualityGateCoordinator = createFrameRepairQualityGateCoordinator',
  )
  const contentTypesIndex = source.indexOf('const CONTENT_TYPES')
  assert.ok(frameCoordinatorIndex >= 0 && frameCoordinatorIndex < qualityCoordinatorIndex)
  assert.ok(qualityCoordinatorIndex < contentTypesIndex)
  const block = source.slice(qualityCoordinatorIndex, contentTypesIndex)
  for (const expected of [
    /projectRoot:\s*__dirname/,
    /workspaceRoot:\s*editorWorkspaceDir/,
    /generatedDir,/,
    /implementationRevision,/,
    /frameRepairCoordinator,/,
    /frameRepairService,/,
  ]) assert.match(block, expected)
  assert.doesNotMatch(block, /process\.env|runtimeProviderEnv|requestFrameRepairCandidate|createJobQueue|jobQueue|concurrency/)
  assert.equal((source.match(/frameRepairQualityGateCoordinator,\s*\n/g) ?? []).length, 1)
  assert.match(source, /handleEditorProjectApi\([\s\S]*frameRepairQualityGateCoordinator,/)
})
