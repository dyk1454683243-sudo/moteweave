import {
  actionRepairActionForRegion,
  actionRepairRegionKeyForFrameIndex,
  isActionRepairSourceLayoutId,
  resolveActionRepairLayout,
} from '../character-pack/actionRepairLayouts.js'

function unavailable(reason) {
  return {
    available: false,
    reason,
    layoutId: null,
    byFrame: {},
    byRegion: {},
    regionKeys: [],
  }
}

function uniqueIntegers(values = []) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
}

export function buildFrameBatchRepairTargets(debugReport = {}) {
  const layoutId = debugReport?.source_layout?.id
  if (!isActionRepairSourceLayoutId(layoutId)) {
    return unavailable('Batch action repair requires a supported generated source layout')
  }
  const layout = resolveActionRepairLayout(layoutId)

  const rawByFrame = {}
  const rawByRegion = {}
  for (const frame of Array.isArray(debugReport.frames) ? debugReport.frames : []) {
    const frameIndex = frame?.index
    const regionKey = String(
      frame?.source_frame?.region_key ?? actionRepairRegionKeyForFrameIndex(layout.id, frameIndex) ?? '',
    )
    const action = String(frame?.source_frame?.action ?? actionRepairActionForRegion(layout.id, regionKey) ?? '')
    const validRegions = layout.action_region_keys[action]
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || !Array.isArray(validRegions) || !validRegions.includes(regionKey)) continue

    const target = {
      frameIndex,
      action,
      regionKey,
      flipH: frame.source_frame?.flip_h === true,
    }
    rawByFrame[String(frameIndex)] = target
    const region = rawByRegion[regionKey] ?? { action, regionKey, frameIndices: [] }
    region.frameIndices.push(frameIndex)
    rawByRegion[regionKey] = region
  }

  const regionKeys = Object.keys(rawByRegion)
  if (!regionKeys.length) return unavailable('Generated frame metadata has no repairable source-region mapping')

  const byRegion = Object.fromEntries(regionKeys.map((regionKey) => {
    const region = rawByRegion[regionKey]
    return [regionKey, { ...region, frameIndices: uniqueIntegers(region.frameIndices) }]
  }))
  const byFrame = Object.fromEntries(Object.entries(rawByFrame).map(([frameIndex, target]) => [
    frameIndex,
    {
      ...target,
      linkedFrameIndices: [...byRegion[target.regionKey].frameIndices],
    },
  ]))

  return {
    available: true,
    reason: null,
    layoutId: layout.id,
    byFrame,
    byRegion,
    regionKeys,
  }
}

export function resolveFrameBatchRepairSelection({ targets, selectedRegionKeys = [] } = {}) {
  if (!targets?.available) {
    return {
      available: false,
      reason: targets?.reason ?? 'Batch action repair is unavailable',
      regionKeys: [],
      actions: [],
      frameIndices: [],
      sourceRegionCount: 0,
      outputFrameCount: 0,
      estimatedProviderCalls: 0,
      canPlan: false,
    }
  }

  const selected = new Set(Array.isArray(selectedRegionKeys) ? selectedRegionKeys : [])
  const regionKeys = targets.regionKeys.filter((regionKey) => selected.has(regionKey))
  const regions = regionKeys.map((regionKey) => targets.byRegion[regionKey]).filter(Boolean)
  const actions = [...new Set(regions.map((region) => region.action))]
  const frameIndices = uniqueIntegers(regions.flatMap((region) => region.frameIndices))
  return {
    available: true,
    reason: regionKeys.length ? null : 'Select at least one action frame',
    regionKeys,
    actions,
    frameIndices,
    sourceRegionCount: regionKeys.length,
    outputFrameCount: frameIndices.length,
    estimatedProviderCalls: regionKeys.length ? 1 : 0,
    canPlan: regionKeys.length > 0,
  }
}

export function toggleFrameBatchRepairRegion({ targets, selectedRegionKeys = [], regionKey, checked } = {}) {
  if (!targets?.available || !targets.byRegion?.[regionKey]) return [...(selectedRegionKeys ?? [])]
  const selected = new Set(Array.isArray(selectedRegionKeys) ? selectedRegionKeys : [])
  if (checked) selected.add(regionKey)
  else selected.delete(regionKey)
  return targets.regionKeys.filter((key) => selected.has(key))
}
