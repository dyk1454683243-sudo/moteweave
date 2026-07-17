import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from './sourceLayoutIds.js'

const TEMPLATE_FILES = {
  topdown_rpg_v0: 'motion_template_ocha_8x8.png',
  [FIXED_REGION_MOTION_LAYOUT_ID]: 'fixed_region_motion_template_v1.png',
  [LEGACY_OCAD_MOTION_LAYOUT_ID]: 'fixed_region_motion_template_v1.png',
}

export async function loadTemplateImage(preset, { rootDir = process.cwd() } = {}) {
  const fileName = TEMPLATE_FILES[preset]
  if (!fileName) return null
  try {
    return {
      name: fileName,
      mimeType: 'image/png',
      buffer: await readFile(path.join(rootDir, 'templates', fileName)),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
