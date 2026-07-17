import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function readJsonIfExists(dir, name) {
  const filePath = path.join(dir, name)
  if (!existsSync(filePath)) return undefined
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readBufferIfExists(dir, name) {
  const filePath = path.join(dir, name)
  if (!existsSync(filePath)) return undefined
  return readFile(filePath)
}

export async function loadCharacterPackResultFromDir(dir) {
  return {
    metadataJson: await readJsonIfExists(dir, 'metadata.json'),
    animationsJson: await readJsonIfExists(dir, 'animations.json'),
    editorMetadataJson: await readJsonIfExists(dir, 'editor_metadata.json'),
    debugReport: await readJsonIfExists(dir, 'debug_report.json'),
    files: {
      sourcePng: await readBufferIfExists(dir, 'source.png'),
      normalizedSheetPng: await readBufferIfExists(dir, 'normalized_sheet.png'),
      zipBuffer: await readBufferIfExists(dir, 'character_pack.zip'),
    },
  }
}

export async function loadScenePackResultFromDir(dir) {
  return {
    sceneJson: await readJsonIfExists(dir, 'scene.json'),
    tileAtlasMetadata: await readJsonIfExists(dir, 'tile_atlas.json'),
    tileMap: await readJsonIfExists(dir, 'tile_map.json'),
    qualityGate: await readJsonIfExists(dir, 'quality_gate.json'),
    ldtkProjectJson: await readJsonIfExists(dir, 'project.ldtk'),
    styleCorrection: await readJsonIfExists(dir, 'style_correction.json'),
    edgeConditioning: await readJsonIfExists(dir, 'edge_conditioning.json'),
    tileConditioningReview: await readJsonIfExists(dir, 'tile_conditioning_review.json'),
    files: {
      tilesetPng: await readBufferIfExists(dir, 'tileset.png'),
      zipBuffer: await readBufferIfExists(dir, 'scene_pack.zip'),
      tileConditioningReviewPng: await readBufferIfExists(dir, 'tile_conditioning_review.png'),
    },
  }
}
