import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFrameBatchRepairTargets,
  resolveFrameBatchRepairSelection,
  toggleFrameBatchRepairRegion,
} from '../../src/editor-project/frameBatchRepairSelection.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from '../../src/character-pack/sourceLayoutIds.js'

function report(frames) {
  return {
    source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
    frames: frames.map((source_frame, index) => ({ index, source_frame })),
  }
}

test('batch action repair maps repeated and mirrored output frames to one authoritative source region', () => {
  const targets = buildFrameBatchRepairTargets(report([
    { action: 'idledown', region_key: 'idledown', flip_h: false },
    { action: 'idledown', region_key: 'idledown', flip_h: false },
    { action: 'idleL', region_key: 'idleL', flip_h: false },
    { action: 'idleL', region_key: 'idleL', flip_h: true },
  ]))

  assert.equal(targets.available, true)
  assert.deepEqual(targets.byFrame['2'], {
    frameIndex: 2,
    action: 'idleL',
    regionKey: 'idleL',
    flipH: false,
    linkedFrameIndices: [2, 3],
  })
  assert.deepEqual(targets.byFrame['3'].linkedFrameIndices, [2, 3])

  const selection = resolveFrameBatchRepairSelection({ targets, selectedRegionKeys: ['idleL'] })
  assert.deepEqual(selection.regionKeys, ['idleL'])
  assert.deepEqual(selection.actions, ['idleL'])
  assert.deepEqual(selection.frameIndices, [2, 3])
  assert.equal(selection.sourceRegionCount, 1)
  assert.equal(selection.outputFrameCount, 2)
  assert.equal(selection.estimatedProviderCalls, 1)
})

test('batch action repair keeps only valid source regions and selection follows source order', () => {
  const targets = buildFrameBatchRepairTargets(report([
    { action: 'walkdown', region_key: 'walkdown0' },
    { action: 'walkdown', region_key: 'walkdown1' },
    { action: 'walkdown', region_key: 'idleup' },
  ]))

  assert.deepEqual(targets.regionKeys, ['walkdown0', 'walkdown1'])
  const first = toggleFrameBatchRepairRegion({ targets, selectedRegionKeys: [], regionKey: 'walkdown1', checked: true })
  const second = toggleFrameBatchRepairRegion({ targets, selectedRegionKeys: first, regionKey: 'walkdown0', checked: true })
  assert.deepEqual(second, ['walkdown0', 'walkdown1'])
  assert.deepEqual(resolveFrameBatchRepairSelection({ targets, selectedRegionKeys: second }).actions, ['walkdown'])
})

test('batch action repair maps uniform-grid frames through the same source-slot contract', () => {
  const targets = buildFrameBatchRepairTargets({
    source_layout: { id: TOPDOWN_RPG_SOURCE_LAYOUT_ID },
    frames: [40, 41, 42, 43].map((index) => ({
      index,
      source_frame: { layout: TOPDOWN_RPG_SOURCE_LAYOUT_ID, row: 5, col: index - 40 },
    })),
  })

  assert.equal(targets.available, true)
  assert.deepEqual(targets.regionKeys, [
    'attack_left_0', 'attack_left_1', 'attack_left_2', 'attack_left_3',
  ])
  const selection = resolveFrameBatchRepairSelection({
    targets,
    selectedRegionKeys: ['attack_left_1', 'attack_left_3'],
  })
  assert.deepEqual(selection.actions, ['attack_left'])
  assert.deepEqual(selection.frameIndices, [41, 43])
  assert.equal(selection.estimatedProviderCalls, 1)
})

test('batch action repair reports unknown generated sources honestly', () => {
  const targets = buildFrameBatchRepairTargets({ source_layout: { id: 'unknown_layout' }, frames: [] })
  assert.equal(targets.available, false)
  assert.match(targets.reason, /supported generated source layout/)
  assert.equal(resolveFrameBatchRepairSelection({ targets, selectedRegionKeys: ['idleL'] }).canPlan, false)
})
