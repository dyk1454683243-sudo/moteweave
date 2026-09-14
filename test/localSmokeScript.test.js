import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

test('local smoke script checks the exclusive three-atlas Repair workbench without mutating a project', async () => {
  const source = await readFile('scripts/smoke-local-ui.mjs', 'utf8')
  for (const marker of [
    '/src/ui/editor/repairWorkbenchPanel.js',
    'editor-repair-action-only',
    'editor-repair-action-filmstrip',
    'dataset.batchRepairRegion',
    'Three-atlas action repair',
    'retired local reprocess API client is still present',
    'retired reprocess route returned',
    '/src/ui/editor/api.js',
    "includes('/api/repair-character-action')",
    '/src/ui/editor/shell.js',
    'createAiActionRepairWorkflow',
    'retired single-frame runtime is still loaded',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /reprocess\/[^'`]+\/accept/)
  assert.doesNotMatch(source, /\/src\/ui\/editor\/frameRepair(?:Panel|Controller)\.js/)
  assert.doesNotMatch(source, /Frame Repair stage marker/)
  assert.doesNotMatch(source, /Quality Gate API client route/)
})

test('local smoke wrapper self-hosts and verifies provider-free local routes', () => {
  const result = spawnSync(process.execPath, ['scripts/run-local-smoke.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /local smoke passed/)
})
