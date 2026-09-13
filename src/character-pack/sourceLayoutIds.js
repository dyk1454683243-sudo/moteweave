export const TOPDOWN_RPG_SOURCE_LAYOUT_ID = 'topdown_rpg_v0'
export const FIXED_REGION_MOTION_LAYOUT_ID = 'fixed_region_motion_v0'
export const LEGACY_OCAD_MOTION_LAYOUT_ID = 'ocad_motion_v0'

const SOURCE_LAYOUT_TEMPLATE_FILES = Object.freeze({
  [TOPDOWN_RPG_SOURCE_LAYOUT_ID]: 'motion_template_ocha_8x8.png',
  [FIXED_REGION_MOTION_LAYOUT_ID]: 'motion_template_ocad_primary.png',
  [LEGACY_OCAD_MOTION_LAYOUT_ID]: 'motion_template_ocad_primary.png',
})

export function templateFileForSourceLayout(sourceLayoutId) {
  return SOURCE_LAYOUT_TEMPLATE_FILES[sourceLayoutId] ?? null
}
