import test from 'node:test'
import assert from 'node:assert/strict'

import { createRepairWorkbenchController } from '../../src/ui/editor/repairWorkbenchController.js'
import { createEmptyActionRepairSelectionState } from '../../src/ui/editor/state.js'

function harness() {
  const asset = {
    id: 'asset_hero',
    kind: 'character_pack',
    name: 'Hero',
    active_revision_id: 'rev_001',
    revisions: {
      rev_001: {
        id: 'rev_001',
        source_job_id: 'job_source',
        artifacts: {
          sheet: 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png',
          debug_report: 'workspace/projects/project_demo/assets/asset_hero/rev_001/debug_report.json',
        },
      },
    },
    clips: {
      walk_down: { frames: [16, 17], fps: 10 },
    },
  }
  const state = {
    project: { id: 'project_demo', revision: 2, assets: { asset_hero: asset } },
    selectedAssetId: asset.id,
    selectedLayerId: null,
    activePanel: 'layers',
    repair: {
      local: createEmptyActionRepairSelectionState(),
      aiAction: {
        selectedAction: 'walk_down',
        selectedRegionKeys: [],
        status: 'idle',
        message: '',
        plan: null,
        job: null,
        importResult: null,
      },
    },
  }
  let renders = 0
  const controller = createRepairWorkbenchController({
    state,
    artifactClient: {
      async loadJson() {
        return {
          source_layout: { id: 'topdown_rpg_v0' },
          frames: [
            { index: 16, source_frame: { action: 'walk_down', region_key: 'walk_down_0', flip_h: false } },
            { index: 17, source_frame: { action: 'walk_down', region_key: 'walk_down_1', flip_h: false } },
          ],
        }
      },
      clearRepairArtifactCache() {},
    },
    getSelectedAsset: () => asset,
    requestRender: () => { renders += 1 },
    renderAiActionContent() {},
  })
  return { asset, controller, state, renders: () => renders }
}

test('action repair workbench loads authoritative frame mapping without a local reprocess draft', async () => {
  const h = harness()
  await h.controller.openAsset(h.asset)

  assert.equal(h.state.activePanel, 'repair')
  assert.equal(h.state.repair.local.status, 'ready')
  assert.equal(h.state.repair.local.frameBatchRepairTargets.available, true)
  assert.equal(Object.hasOwn(h.state.repair.local, 'draft'), false)
  assert.equal(h.renders() >= 2, true)

  const context = h.controller.contextFor(h.asset)
  const first = context.viewModel()
  assert.deepEqual(first.frames.map((frame) => frame.target.regionKey), ['walk_down_0', 'walk_down_1'])
  assert.equal(first.sourceSheetUrl.startsWith('/api/editor/artifact?path='), true)

  assert.equal(context.toggleBatchRepairRegion('walk_down_0', true), true)
  assert.deepEqual(h.state.repair.aiAction.selectedRegionKeys, ['walk_down_0'])
  assert.equal(context.viewModel().batch.estimatedProviderCalls, 1)
})
