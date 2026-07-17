function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function optionEnabled(value, fallback = true) {
  if (value === undefined || value === null) return fallback
  return value !== false
}

export function resolveBackgroundOptions(options = {}) {
  return {
    tolerance: clampNumber(options.backgroundTolerance ?? options.background_tolerance, 0, 80, 24),
    cleanup_min_alpha: clampNumber(options.cleanupMinAlpha ?? options.cleanup_min_alpha, 0, 80, 18),
    matte_residue_cleanup: optionEnabled(options.matteResidueCleanup ?? options.matte_residue_cleanup, true),
    matte_residue_tolerance: clampNumber(options.matteResidueTolerance ?? options.matte_residue_tolerance, 0, 120, 40),
    matte_residue_passes: Math.round(clampNumber(options.matteResiduePasses ?? options.matte_residue_passes, 0, 4, 2)),
    edge_decontamination: optionEnabled(options.edgeDecontamination ?? options.edge_decontamination, true),
    edge_decontamination_max_distance: clampNumber(options.edgeDecontaminationMaxDistance ?? options.edge_decontamination_max_distance, 0, 180, 112),
    edge_decontamination_strength: clampNumber(options.edgeDecontaminationStrength ?? options.edge_decontamination_strength, 0, 1, 0.55),
  }
}

export function resolveAnchorOffset(options = {}) {
  const raw = options.anchorOffset ?? options.anchor_offset ?? {}
  return {
    x: Math.round(clampNumber(raw.x ?? options.anchorOffsetX ?? options.anchor_offset_x, -16, 16, 0)),
    y: Math.round(clampNumber(raw.y ?? options.anchorOffsetY ?? options.anchor_offset_y, -16, 16, 0)),
  }
}

export function resolveComponentCleanupOptions(options = {}) {
  return {
    enabled: options.componentCleanup !== false && options.component_cleanup !== false,
    min_area: clampNumber(options.componentCleanupMinArea ?? options.component_cleanup_min_area, 1, 64, 4),
    min_area_ratio: clampNumber(options.componentCleanupMinAreaRatio ?? options.component_cleanup_min_area_ratio, 0, 0.25, 0),
  }
}

export function resolveFixedRegionSourceStagingOptions(options = {}) {
  const rawMode =
    options.fixedRegionSourceStaging ??
    options.fixed_region_source_staging ??
    options.sourceStaging ??
    options.source_staging ??
    'off'
  const mode = String(rawMode).trim()
  const enabled = rawMode === true || mode === 'fixed_region_256_crop' || mode === 'template_256_crop_252'
  return {
    enabled,
    mode: enabled ? 'fixed_region_256_crop' : 'off',
    stage_size: Math.round(clampNumber(options.fixedRegionStageSize ?? options.fixed_region_stage_size, 64, 1024, 256)),
    crop_right: Math.round(clampNumber(options.fixedRegionCropRight ?? options.fixed_region_crop_right, 0, 64, 4)),
    crop_bottom: Math.round(clampNumber(options.fixedRegionCropBottom ?? options.fixed_region_crop_bottom, 0, 64, 4)),
    matte_tolerance: clampNumber(options.fixedRegionMatteTolerance ?? options.fixed_region_matte_tolerance, 0, 255, 80),
  }
}

export function applyAnchorOffset(profile, offset) {
  if (!offset.x && !offset.y) return profile
  return {
    ...profile,
    anchor: {
      ...profile.anchor,
      x: profile.anchor.x + offset.x,
      y: profile.anchor.y + offset.y,
    },
    baselineY: profile.baselineY + offset.y,
  }
}
