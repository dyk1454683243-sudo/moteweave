import { buildGodotNpcExport, buildGodotNpcThumbPng } from './exporters/godotNpcExport.js'
import { buildOcadExport } from './exporters/ocadExport.js'
import { buildRpgmakerExport } from './exporters/rpgmakerExport.js'
import { encodeGifFromRgbaFrames } from './gifExport.js'
import { encodeRgbaPng } from './imageCodec.js'
import { normalizeCells } from './normalizer.js'
import { buildRowPreviewIndex } from './rowPreview.js'
import { cleanupCellComponents } from './sourcePreparation.js'
import { buildSourceLayoutRowPreviewCells } from './sourceLayouts.js'
import { buildCharacterPackZip } from './zipExport.js'

export function composeSheet(frames, profile) {
  const image = { width: profile.sheet.w, height: profile.sheet.h, data: new Uint8ClampedArray(profile.sheet.w * profile.sheet.h * 4) }
  for (const frame of frames) {
    const col = frame.index % profile.grid.columns
    const row = Math.floor(frame.index / profile.grid.columns)
    for (let y = 0; y < profile.frame.h; y++) {
      for (let x = 0; x < profile.frame.w; x++) {
        const src = (y * profile.frame.w + x) * 4
        const dst = ((row * profile.frame.h + y) * profile.sheet.w + col * profile.frame.w + x) * 4
        image.data[dst] = frame.image.data[src]
        image.data[dst + 1] = frame.image.data[src + 1]
        image.data[dst + 2] = frame.image.data[src + 2]
        image.data[dst + 3] = frame.image.data[src + 3]
      }
    }
  }
  return image
}

export function buildRowGifPreviewArtifacts({ transparent, sourceLayout, profile, animations, frames, options = {} } = {}) {
  const sourceRowPreviewCells = buildSourceLayoutRowPreviewCells(transparent, sourceLayout)
  const rowPreviewCellCleanup = sourceRowPreviewCells ? cleanupCellComponents(sourceRowPreviewCells.cells, options) : null
  const rowPreviewFrames = sourceRowPreviewCells ? normalizeCells(rowPreviewCellCleanup.cells, profile).frames : frames
  const rowPreviews = sourceRowPreviewCells?.previews ?? buildRowPreviewIndex(profile, animations)
  const rowGifBuffers = Object.fromEntries(
    rowPreviews.map((preview) => [
      preview.fileName,
      encodeGifFromRgbaFrames(preview.frames.map((index) => rowPreviewFrames[index].image), { delay: Math.round(1000 / preview.fps) }),
    ])
  )
  return { sourceRowPreviewCells, rowPreviewCellCleanup, rowPreviewFrames, rowPreviews, rowGifBuffers }
}

export async function buildEngineExportArtifacts({ metadataJson, frames, profile, normalizedSheetPng, sourcePng = null, sourceLayout = null } = {}) {
  const godotNpcThumbPng = await buildGodotNpcThumbPng(normalizedSheetPng, profile)
  const godotNpcExport = buildGodotNpcExport({ metadata: metadataJson, spritePng: normalizedSheetPng, thumbPng: godotNpcThumbPng, profile })
  const godotNpcZipBuffer = await buildCharacterPackZip(godotNpcExport.files)
  const rpgmakerExport = await buildRpgmakerExport({ metadata: metadataJson, frames, profile, sourcePng, sourceLayout })
  const rpgmakerZipBuffer = await buildCharacterPackZip(rpgmakerExport.files)
  const ocadExport = await buildOcadExport({ metadata: metadataJson, frames, profile, sourcePng, sourceLayout })
  const ocadZipBuffer = await buildCharacterPackZip(ocadExport.files)
  return {
    godotNpcThumbPng,
    godotNpcExport,
    godotNpcZipBuffer,
    rpgmakerExport,
    rpgmakerZipBuffer,
    ocadExport,
    ocadZipBuffer,
  }
}

export async function encodeComposedSheetPng(frames, profile) {
  return encodeRgbaPng(composeSheet(frames, profile))
}
