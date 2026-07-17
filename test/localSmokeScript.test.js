import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

test('local smoke script checks Repair workbench and reprocess module markers without mutating a project', async () => {
  const source = await readFile('scripts/smoke-local-ui.mjs', 'utf8')
  for (const marker of [
    '/src/ui/editor/repairWorkbenchPanel.js',
    'editor-repair-workbench',
    'dataset.repairMode',
    'editor-repair-filmstrip-frames',
    'editor-repair-recipe-trigger',
    'Build Preview',
    'Accept as revision',
    'AI Action Repair',
    '/src/ui/editor/api.js',
    "includes('/reprocess')",
    '/src/ui/editor/frameRepairPanel.js',
    '/src/ui/editor/frameRepairController.js',
    'Target & Mask',
    'Review AI Call',
    'Processing',
    'Result & Validation',
    '/frame-repair/plan',
    '/frame-repair/operations/',
    '/accept',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /reprocess\/[^'`]+\/accept/)
})

test('local smoke wrapper self-hosts and verifies provider-free local routes', () => {
  const result = spawnSync(process.execPath, ['scripts/run-local-smoke.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /local smoke passed/)
})
