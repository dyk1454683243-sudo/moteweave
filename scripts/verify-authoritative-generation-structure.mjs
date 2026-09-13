#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  FIXED_REGION_MOTION_LAYOUT_ID,
} from '../src/character-pack/sourceLayoutIds.js'
import { loadAuthoritativeGenerationStructureImage } from '../src/character-pack/templateStore.js'

export const AUTHORITATIVE_TEMPLATE_PATH = 'templates/motion_template_ocad_primary.png'
export const AUTHORITATIVE_TEMPLATE_SHA256 = '27bb29c74ed671ec922ea3e080391b02ee35a0ff7bf8d685b8897d2925990d70'

export async function verifyAuthoritativeGenerationStructure({ rootDir = process.cwd() } = {}) {
  const filePath = path.join(rootDir, AUTHORITATIVE_TEMPLATE_PATH)
  const buffer = await readFile(filePath)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  if (sha256 !== AUTHORITATIVE_TEMPLATE_SHA256) {
    throw new Error(`${AUTHORITATIVE_TEMPLATE_PATH} hash changed: ${sha256}`)
  }
  const loaded = await loadAuthoritativeGenerationStructureImage(FIXED_REGION_MOTION_LAYOUT_ID, { rootDir })
  if (!loaded) throw new Error('authoritative generation structure could not be loaded')
  return {
    path: AUTHORITATIVE_TEMPLATE_PATH,
    sha256,
    structureAuthorityId: loaded.structureAuthorityId,
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  console.log(JSON.stringify(await verifyAuthoritativeGenerationStructure(), null, 2))
}
