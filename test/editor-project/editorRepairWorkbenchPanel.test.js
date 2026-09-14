import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createRepairWorkbenchPanel } from '../../src/ui/editor/repairWorkbenchPanel.js'

test('Editor Repair panel exposes only the sealed three-atlas action workflow', async () => {
  const source = await readFile('src/ui/editor/repairWorkbenchPanel.js', 'utf8')

  assert.match(source, /Three-atlas action repair/)
  assert.match(source, /Identity anchor \+ pose guide \+ empty output atlas/)
  assert.match(source, /dataset\.batchRepairRegion/)
  assert.match(source, /renderAiAction/)
  assert.doesNotMatch(source, /Processing Recipe/)
  assert.doesNotMatch(source, /Build Preview/)
  assert.doesNotMatch(source, /Accept as revision/)
  assert.throws(() => createRepairWorkbenchPanel(), /root is required/)
})
