import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('production runtime exposes only the three-atlas repair stack', async () => {
  const paths = [
    '../../server.js',
    '../../src/editor-project/apiHandler.js',
    '../../src/editor-project/artifactRegistry.js',
    '../../src/editor-project/index.js',
    '../../src/ui/editor/api.js',
    '../../src/ui/editor/repairWorkbenchPanel.js',
    '../../src/ui/editor/shell.js',
    '../../src/ui/editor/state.js',
  ]
  const sources = await Promise.all(paths.map((pathname) => readFile(new URL(pathname, import.meta.url), 'utf8')))
  const [server, apiHandler, artifactRegistry, index, uiApi, panel, shell, state] = sources
  const runtime = sources.join('\n')

  assert.doesNotMatch(runtime, /frameRepair(?:Service|Coordinator|Controller|Lifecycle|State|Panel|QualityGate)/)
  assert.doesNotMatch(apiHandler, /frame-repair(?:-quality-gates|\/plan|\/operations)/)
  assert.doesNotMatch(uiApi, /planCharacterFrameRepair|generateCharacterFrameRepair|acceptCharacterFrameRepair/)
  assert.doesNotMatch(index, /frameRepair|normalizedCharacterSheetPackage/)
  assert.doesNotMatch(artifactRegistry, /editor_frame_repair_context|FRAME_REPAIR_/)
  assert.doesNotMatch(panel, /Repair Frame|Quality Gate|qualityGateWorkspace/)
  assert.doesNotMatch(state, /createEmptyFrameRepairState|\bframe:\s*/)
  assert.doesNotMatch(shell, /frameRepairController|frameRepairQualityGate/)
  assert.doesNotMatch([server, apiHandler, index, uiApi, panel, shell, state].join('\n'),
    /characterReprocess|CharacterReprocess|\/reprocess|editor_character_reprocess/)
  assert.match(artifactRegistry, /editor_reprocess_context\.json/)
  assert.match(server, /repairCharacterAction:\s*handleRepairCharacterAction/)

  for (const retiredPath of [
    '../../src/editor-project/characterReprocessCoordinator.js',
    '../../src/editor-project/characterReprocessService.js',
    '../../src/ui/editor/repairPreviewLifecycle.js',
    '../../src/ui/editor/repairComparisonRenderer.js',
  ]) {
    await assert.rejects(readFile(new URL(retiredPath, import.meta.url), 'utf8'), { code: 'ENOENT' })
  }
})

test('current documentation marks every old repair route retired and names the sole three-atlas route', async () => {
  const [boundaries, frameProtocol, qualityProtocol, currentProtocol, artifacts, recipe, runbook] = await Promise.all([
    readFile(new URL('../../docs/protocols/local-api-boundaries.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/protocols/editor-frame-repair-v1.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/protocols/editor-frame-repair-quality-gate-v1.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/protocols/fixed-region-action-repair-atlas-v1.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/protocols/character-pack-artifacts.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/protocols/processing-recipe-v0.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/runbooks/character-finishing-workbench-v1.md', import.meta.url), 'utf8'),
  ])

  assert.match(boundaries, /Retired single-frame repair route descriptions/)
  assert.match(boundaries, /POST \/api\/repair-character-action/)
  assert.match(boundaries, /action-repair\/:jobId\/accept/)
  assert.match(boundaries, /former provider-free Character Workbench routes are retired/)
  assert.match(frameProtocol, /Status:\*\* Retired on 2026-08-08/)
  assert.match(qualityProtocol, /Status:\*\* Retired on 2026-08-08/)
  assert.match(currentProtocol, /Exclusive product routing/)
  assert.match(currentProtocol, /There is no generic animation-strip repair fallback/)
  assert.match(artifacts, /Retired Workbench Recipe Evidence/)
  assert.match(recipe, /Historical Editor Repair contract/)
  assert.match(runbook, /Retired historical verification record/)
})
