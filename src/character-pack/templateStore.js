import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  templateFileForSourceLayout,
} from './sourceLayoutIds.js'

const AUTHORITATIVE_GENERATION_STRUCTURES = Object.freeze({
  [FIXED_REGION_MOTION_LAYOUT_ID]: Object.freeze({
    id: 'fixed_region_motion_primary_structure_v1',
    fileName: 'motion_template_ocad_primary.png',
    sourceSha256: '27bb29c74ed671ec922ea3e080391b02ee35a0ff7bf8d685b8897d2925990d70',
    structureSha256: '6970952fdd0571493d46ec26b6fa750b56f1459f96ae3473d51090651c7da541',
  }),
})

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export async function loadTemplateImage(preset, { rootDir = process.cwd() } = {}) {
  const fileName = templateFileForSourceLayout(preset)
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

export async function loadAuthoritativeGenerationStructureImage(preset, { rootDir = process.cwd() } = {}) {
  const contract = AUTHORITATIVE_GENERATION_STRUCTURES[preset]
  if (!contract) return null
  const template = await loadTemplateImage(preset, { rootDir })
  if (!template) return null
  const sourceSha256 = sha256(template.buffer)
  if (template.name !== contract.fileName || sourceSha256 !== contract.sourceSha256) {
    throw new Error(`authoritative generation structure source changed: ${preset}`)
  }
  return {
    ...template,
    structureAuthority: 'repository_maintained_exact_outline',
    structureAuthorityId: contract.id,
    expectedStructureSha256: contract.structureSha256,
  }
}
