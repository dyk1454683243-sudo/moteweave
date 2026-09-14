import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  buildFixedRegionActionRepairAtlasLayout,
  buildFixedRegionActionRepairAtlases,
  extractFixedRegionActionRepairAtlas,
} from '../../src/character-pack/fixedRegionActionRepairAtlas.js'
import { FIXED_REGION_SOURCE_REGIONS } from '../../src/character-pack/fixedRegionGeometry.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_SOURCE_LAYOUT_ID } from '../../src/character-pack/sourceLayoutIds.js'
import {
  applyFixedRegionSourceRepair,
  buildFixedRegionSourceRepairPlan,
  buildFixedRegionSourceRepairPrompt,
  evaluateFixedRegionRepairScope,
} from '../../src/character-pack/sourceRegionRepair.js'

const REAL_PIG_TEMPLATE = new URL('../../templates/motion_template_ocad_primary.png', import.meta.url)
const TOPDOWN_TEMPLATE = new URL('../../templates/motion_template_ocha_8x8.png', import.meta.url)
const CASE_ONE_REGION_KEYS = [
  'rundown1', 'rundown2', 'rundown3', 'rundown4', 'rundown5', 'walkdown4',
  'runup0', 'runup1', 'walkup1', 'walkup2', 'walkup4', 'climb0',
  'climb2', 'climb3', 'climb5', 'runL1', 'runL2', 'runL3',
  'runL4', 'runL5', 'attractL1', 'attractL3',
]

function image(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset)
  return { width, height, data }
}

function fillRectangle(target, rectangle, fill) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.h; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.w; x += 1) {
      target.data.set(fill, (y * target.width + x) * 4)
    }
  }
}

test('action repair atlas fits the confirmed 26-slot weapon batch into one bounded board', () => {
  const keys = Object.keys(FIXED_REGION_SOURCE_REGIONS).slice(0, 26)
  const layout = buildFixedRegionActionRepairAtlasLayout(keys)

  assert.equal(layout.width, 1024)
  assert.equal(layout.height, 1024)
  assert.equal(layout.columns, 6)
  assert.equal(layout.rows, 6)
  assert.equal(layout.target_slots.length, 26)
  assert.equal(layout.control_slots.length, 10)
  assert.deepEqual(layout.target_slots.map((slot) => slot.region_key), keys)
})

test('uniform-grid prompt preserves distinct left and right target facings', () => {
  const plan = buildFixedRegionSourceRepairPlan({
    actions: ['idle_left', 'idle_right'],
    regionKeys: ['idle_left_0', 'idle_right_0'],
    sourceLayoutId: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
    sourceSheetPath: '/managed/source.png',
    motionTemplate: { enabled: true, preset: TOPDOWN_RPG_SOURCE_LAYOUT_ID },
  })
  const prompt = buildFixedRegionSourceRepairPrompt(plan)

  assert.match(prompt, /idle_left_0 \(idle_left\); screen-left side view\./)
  assert.match(prompt, /idle_right_0 \(idle_right\); screen-right side view\./)
  assert.match(prompt, /CONTROL; leave fully transparent and draw nothing/i)
  assert.match(prompt, /Do not create white or colored panels inside individual cells/i)
})

test('provider atlas extraction removes a nested flat white panel from the exact target interior', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const provider = image(layout.width, layout.height, [255, 0, 255, 255])
  const target = layout.target_slots[0].atlas_inner
  const panelFrame = {
    x: target.x + 4,
    y: target.y + 4,
    w: target.w - 8,
    h: target.h - 8,
  }
  const whitePanel = {
    x: panelFrame.x + 2,
    y: panelFrame.y + 2,
    w: panelFrame.w - 4,
    h: panelFrame.h - 4,
  }
  fillRectangle(provider, panelFrame, [82, 24, 82, 255])
  fillRectangle(provider, whitePanel, [255, 255, 255, 255])
  fillRectangle(provider, {
    x: whitePanel.x + Math.floor(whitePanel.w * 0.38),
    y: whitePanel.y + Math.floor(whitePanel.h * 0.2),
    w: Math.max(12, Math.floor(target.w * 0.24)),
    h: Math.max(24, Math.floor(target.h * 0.65)),
  }, [21, 101, 79, 255])

  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: await encodeRgbaPng(provider),
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys,
  })
  const cleanedAtlas = await loadRgba(extracted.background_removed_provider_atlas_png)
  const entry = extracted.report.target_entries[0]

  assert.equal(extracted.report.status, 'extraction_pass')
  assert.equal(entry.components.significant_count, 1)
  assert.ok(entry.cleaned_foreground_pixels < target.w * target.h * 0.5)
  assert.deepEqual(
    [...cleanedAtlas.data.subarray((target.y * cleanedAtlas.width + target.x) * 4, (target.y * cleanedAtlas.width + target.x) * 4 + 4)],
    [0, 0, 0, 0],
  )
})

test('provider atlas extraction preserves a high-coverage transparent character without a second background pass', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const provider = image(layout.width, layout.height)
  const target = layout.target_slots[0].atlas_inner
  const centerX = target.x + (target.w - 1) / 2
  const centerY = target.y + (target.h - 1) / 2
  const radiusX = target.w * 0.49
  const radiusY = target.h * 0.49
  for (let y = target.y; y < target.y + target.h; y += 1) {
    for (let x = target.x; x < target.x + target.w; x += 1) {
      const dx = (x - centerX) / radiusX
      const dy = (y - centerY) / radiusY
      if (dx * dx + dy * dy > 1) continue
      provider.data.set(y < centerY ? [42, 92, 61, 255] : [83, 45, 31, 255], (y * provider.width + x) * 4)
    }
  }
  const before = new Uint8ClampedArray(provider.data)

  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: await encodeRgbaPng(provider),
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys,
  })
  const cleanedAtlas = await loadRgba(extracted.background_removed_provider_atlas_png)

  assert.equal(extracted.report.status, 'extraction_pass')
  for (let y = target.y; y < target.y + target.h; y += 1) {
    for (let x = target.x; x < target.x + target.w; x += 1) {
      const offset = (y * provider.width + x) * 4
      assert.deepEqual(
        [...cleanedAtlas.data.subarray(offset, offset + 4)],
        [...before.subarray(offset, offset + 4)],
      )
    }
  }
})

test('provider atlas extraction preserves but blocks transparent character content that touches an inner edge', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const provider = image(layout.width, layout.height)
  const target = layout.target_slots[0].atlas_inner
  fillRectangle(provider, {
    x: target.x,
    y: target.y + 20,
    w: Math.floor(target.w * 0.7),
    h: target.h - 40,
  }, [42, 92, 61, 255])
  fillRectangle(provider, {
    x: target.x + 20,
    y: target.y + 40,
    w: Math.floor(target.w * 0.55),
    h: target.h - 80,
  }, [83, 45, 31, 255])
  const before = new Uint8ClampedArray(provider.data)

  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: await encodeRgbaPng(provider),
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys,
  })
  const cleanedAtlas = await loadRgba(extracted.background_removed_provider_atlas_png)
  const entry = extracted.report.target_entries[0]

  assert.equal(extracted.report.status, 'extraction_blocked')
  assert.equal(entry.input_edge_safe, false)
  for (let y = target.y; y < target.y + target.h; y += 1) {
    for (let x = target.x; x < target.x + target.w; x += 1) {
      const offset = (y * provider.width + x) * 4
      assert.deepEqual(
        [...cleanedAtlas.data.subarray(offset, offset + 4)],
        [...before.subarray(offset, offset + 4)],
      )
    }
  }
})

test('provider atlas extraction yields only selected fixed regions and scoped patching preserves every other pixel', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown', 'idleup']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const provider = image(layout.width, layout.height, [255, 0, 255, 255])
  for (const [index, slot] of layout.target_slots.entries()) {
    const sprite = {
      x: slot.atlas_inner.x + Math.floor(slot.atlas_inner.w * 0.35),
      y: slot.atlas_inner.y + Math.floor(slot.atlas_inner.h * 0.25),
      w: Math.max(8, Math.floor(slot.atlas_inner.w * 0.3)),
      h: Math.max(16, Math.floor(slot.atlas_inner.h * 0.6)),
    }
    fillRectangle(provider, sprite, index === 0 ? [21, 101, 79, 255] : [24, 96, 73, 255])
  }
  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: await encodeRgbaPng(provider),
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys,
  })
  const providerSource = await loadRgba(extracted.provider_source_sheet_png)
  const selectedRectangles = regionKeys.map((key) => FIXED_REGION_SOURCE_REGIONS[key])
  let selectedVisible = 0
  let unselectedVisible = 0
  for (let y = 0; y < providerSource.height; y += 1) {
    for (let x = 0; x < providerSource.width; x += 1) {
      if (providerSource.data[(y * providerSource.width + x) * 4 + 3] === 0) continue
      const selected = selectedRectangles.some((rect) => (
        x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
      ))
      if (selected) selectedVisible += 1
      else unselectedVisible += 1
    }
  }

  assert.equal(extracted.report.status, 'extraction_pass')
  assert.ok(selectedVisible > 0)
  assert.equal(unselectedVisible, 0)
  assert.equal(extracted.report.control_foreground_pixels, 0)

  const applied = await applyFixedRegionSourceRepair({
    sourceSheetBuffer: sourceBuffer,
    providerSheetBuffer: extracted.provider_source_sheet_png,
    actions: ['idledown', 'idleup'],
    regionKeys,
  })
  const scope = await evaluateFixedRegionRepairScope({
    beforeBuffer: sourceBuffer,
    afterBuffer: applied.repaired_source_sheet_png,
    regionKeys,
  })
  assert.equal(scope.status, 'scope_pass')
  assert.ok(scope.inside_selected_changed_pixels > 0)
  assert.equal(scope.outside_selected_changed_pixels, 0)
})

test('provider atlas extraction blocks any foreground in a control slot', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const provider = image(layout.width, layout.height, [255, 0, 255, 255])
  const target = layout.target_slots[0].atlas_inner
  fillRectangle(provider, {
    x: target.x + 20,
    y: target.y + 20,
    w: 30,
    h: 70,
  }, [21, 101, 79, 255])
  const control = layout.control_slots[0]
  fillRectangle(provider, control.atlas_inner, [255, 255, 255, 255])
  fillRectangle(provider, {
    x: control.atlas_inner.x + 20,
    y: control.atlas_inner.y + 20,
    w: 20,
    h: 40,
  }, [21, 101, 79, 255])

  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: await encodeRgbaPng(provider),
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys,
  })

  assert.equal(extracted.report.status, 'extraction_blocked')
  assert.equal(extracted.report.control_slots_empty, false)
  assert.ok(extracted.report.control_foreground_pixels > 0)
})

test('provider atlas extraction fail-closes on full-cell, edge-touching, and tiny control content', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const regionKeys = ['idledown']
  const layout = buildFixedRegionActionRepairAtlasLayout(regionKeys)
  const variants = [
    (provider, control) => fillRectangle(provider, control.atlas_inner, [255, 255, 255, 255]),
    (provider, control) => fillRectangle(provider, {
      x: control.atlas_inner.x,
      y: control.atlas_inner.y,
      w: 1,
      h: control.atlas_inner.h,
    }, [21, 101, 79, 255]),
    (provider, control) => fillRectangle(provider, {
      x: control.atlas_inner.x + 4,
      y: control.atlas_inner.y + 4,
      w: 1,
      h: 1,
    }, [21, 101, 79, 255]),
  ]

  for (const contaminate of variants) {
    const provider = image(layout.width, layout.height, [255, 0, 255, 255])
    const target = layout.target_slots[0].atlas_inner
    fillRectangle(provider, {
      x: target.x + 20,
      y: target.y + 20,
      w: 30,
      h: 70,
    }, [21, 101, 79, 255])
    contaminate(provider, layout.control_slots[0])
    const extracted = await extractFixedRegionActionRepairAtlas({
      providerAtlasBuffer: await encodeRgbaPng(provider),
      sourceSheetBuffer: sourceBuffer,
      normalizedSheetBuffer: sourceBuffer,
      motionTemplateBuffer: sourceBuffer,
      regionKeys,
    })
    assert.equal(extracted.report.status, 'extraction_blocked')
    assert.equal(extracted.report.control_slots_empty, false)
    assert.ok(extracted.report.control_foreground_pixels > 0)
  }
})

test('case one uses an exact 6x5 board with all 22 target and 8 control interiors transparent', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const bundle = await buildFixedRegionActionRepairAtlases({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    regionKeys: CASE_ONE_REGION_KEYS,
  })
  const layout = bundle.evidence.layout
  const empty = await loadRgba(bundle.reference_images[2].buffer)

  assert.deepEqual([layout.columns, layout.rows], [6, 5])
  assert.equal(layout.target_slots.length, 22)
  assert.equal(layout.control_slots.length, 8)
  for (const slot of [...layout.target_slots, ...layout.control_slots]) {
    for (let y = slot.atlas_inner.y; y < slot.atlas_inner.y + slot.atlas_inner.h; y += 1) {
      for (let x = slot.atlas_inner.x; x < slot.atlas_inner.x + slot.atlas_inner.w; x += 1) {
        const offset = (y * empty.width + x) * 4
        assert.deepEqual([...empty.data.subarray(offset, offset + 4)], [0, 0, 0, 0])
      }
    }
  }
})

test('uniform-grid template uses the same three-atlas extraction and exact-slot scope contract', async () => {
  const templateBuffer = await readFile(TOPDOWN_TEMPLATE)
  const templateImage = await loadRgba(templateBuffer)
  const sourceBuffer = await encodeRgbaPng(await resizeRgbaNearest(templateImage, { w: 768, h: 768 }))
  const regionKeys = ['attack_left_0', 'attack_left_2']
  const bundle = await buildFixedRegionActionRepairAtlases({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: templateBuffer,
    normalizedFrameMappings: [40, 41, 42, 43].map((frame_index) => ({ frame_index })),
    regionKeys,
    sourceLayoutId: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  })

  assert.equal(bundle.reference_images.length, 3)
  assert.equal(bundle.evidence.layout.source_layout, TOPDOWN_RPG_SOURCE_LAYOUT_ID)
  assert.deepEqual(bundle.evidence.layout.target_slots.map((slot) => slot.region_key), regionKeys)
  assert.equal(bundle.evidence.identity_anchors.some((anchor) => regionKeys.includes(anchor.region_key)), false)
  for (const reference of bundle.reference_images) {
    const decoded = await loadRgba(reference.buffer)
    assert.deepEqual([decoded.width, decoded.height], [1024, 1024])
  }

  const extracted = await extractFixedRegionActionRepairAtlas({
    providerAtlasBuffer: bundle.reference_images[1].buffer,
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: templateBuffer,
    normalizedFrameMappings: [40, 41, 42, 43].map((frame_index) => ({ frame_index })),
    regionKeys,
    sourceLayoutId: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  })
  assert.equal(extracted.report.status, 'extraction_pass')
  assert.ok(extracted.report.target_entries.every((entry) => entry.template_bounds?.w > 1))
  assert.ok(extracted.report.target_entries.every((entry) => entry.template_bounds?.h > 1))

  const applied = await applyFixedRegionSourceRepair({
    sourceSheetBuffer: sourceBuffer,
    providerSheetBuffer: extracted.provider_source_sheet_png,
    actions: ['attack_left'],
    regionKeys,
    sourceLayoutId: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  })
  const scope = await evaluateFixedRegionRepairScope({
    beforeBuffer: sourceBuffer,
    afterBuffer: applied.repaired_source_sheet_png,
    regionKeys,
    sourceLayoutId: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  })
  assert.equal(scope.status, 'scope_pass')
  assert.ok(scope.inside_selected_changed_pixels > 0)
  assert.equal(scope.outside_selected_changed_pixels, 0)
})
