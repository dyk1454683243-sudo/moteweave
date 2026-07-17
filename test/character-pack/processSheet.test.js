import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'
import sharp from 'sharp'

import { OCAD_REGIONS } from '../../src/character-pack/exporters/ocadExport.js'
import { processSheetBuffer } from '../../src/character-pack/processSheet.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'

async function createCheckerboardSheet() {
  const width = 128
  const height = 128
  const data = new Uint8ClampedArray(width * height * 4)
  const light = [253, 253, 253]
  const dark = [200, 205, 211]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? light : dark
      const offset = (y * width + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = 255
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = col * 16 + 8
      const foot = row * 16 + 12
      for (let y = foot - 8; y <= foot; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          const offset = (y * width + x) * 4
          data[offset] = 12
          data[offset + 1] = 14
          data[offset + 2] = 24
        }
      }
    }
  }
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function createSheetWithDetachedCrumbs() {
  const width = 128
  const height = 128
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const originX = col * 16
      const originY = row * 16
      for (let y = originY + 5; y <= originY + 13; y++) {
        for (let x = originX + 7; x <= originX + 9; x++) {
          const offset = (y * width + x) * 4
          data[offset] = 20
          data[offset + 1] = 80
          data[offset + 2] = 110
        }
      }
      const crumbOffset = ((originY + 1) * width + originX + 1) * 4
      data[crumbOffset] = 15
      data[crumbOffset + 1] = 15
      data[crumbOffset + 2] = 15
    }
  }
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function createOcadMotionSheet() {
  const width = 252
  const height = 252
  const data = new Uint8ClampedArray(width * height * 4)
  Object.entries(OCAD_REGIONS).forEach(([key, region], index) => {
    const colorSeed = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 19
    const padX = region.w >= 42 ? 4 : 2
    const padY = 3
    for (let y = region.y + padY; y < region.y + region.h - padY; y++) {
      for (let x = region.x + padX; x < region.x + region.w - padX; x++) {
        const offset = (y * width + x) * 4
        data[offset] = (colorSeed * 3) % 255
        data[offset + 1] = (80 + colorSeed * 5) % 255
        data[offset + 2] = (140 + colorSeed * 7) % 255
        data[offset + 3] = 255
      }
    }
  })
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function createOcadMotionSheetWithOffWhiteBackground() {
  const width = 252
  const height = 252
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 238
    data[i + 1] = 239
    data[i + 2] = 240
    data[i + 3] = 255
  }
  Object.entries(OCAD_REGIONS).forEach(([key, region], index) => {
    const colorSeed = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 19
    const padX = region.w >= 42 ? 4 : 2
    const padY = 3
    for (let y = region.y + padY; y < region.y + region.h - padY; y++) {
      for (let x = region.x + padX; x < region.x + region.w - padX; x++) {
        const offset = (y * width + x) * 4
        data[offset] = 20 + ((colorSeed * 3) % 90)
        data[offset + 1] = 40 + ((colorSeed * 5) % 90)
        data[offset + 2] = 90 + ((colorSeed * 7) % 90)
      }
    }
  })
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function createHighResolutionOcadMotionSheet() {
  return sharp(await createOcadMotionSheet())
    .resize(1024, 1024, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
}

async function createGeneratedFixedRegionSheet256WithWhiteBackground() {
  const width = 256
  const height = 256
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  Object.entries(OCAD_REGIONS).forEach(([key, region], index) => {
    const colorSeed = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 23
    const padX = region.w >= 42 ? 4 : 2
    const padY = 3
    for (let y = region.y + padY; y < region.y + region.h - padY; y++) {
      for (let x = region.x + padX; x < region.x + region.w - padX; x++) {
        const offset = (y * width + x) * 4
        data[offset] = 30 + ((colorSeed * 3) % 120)
        data[offset + 1] = 40 + ((colorSeed * 5) % 120)
        data[offset + 2] = 70 + ((colorSeed * 7) % 120)
      }
    }
  })
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function createOcadMotionSheetWithSourceEdgePressure(regionKey = 'die') {
  const source = await createOcadMotionSheet()
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = new Uint8ClampedArray(data)
  const region = OCAD_REGIONS[regionKey]
  for (let x = region.x + 1; x < region.x + region.w - 1; x++) {
    const offset = (region.y * info.width + x) * 4
    pixels[offset] = 20
    pixels[offset + 1] = 40
    pixels[offset + 2] = 90
    pixels[offset + 3] = 255
  }
  return sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

async function createOcadMotionSheetWithDuplicateSourceAction(action = 'walkdown') {
  const source = await createOcadMotionSheet()
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = new Uint8ClampedArray(data)
  const keys = Object.keys(OCAD_REGIONS).filter((key) => key.startsWith(action))
  for (const key of keys) {
    const region = OCAD_REGIONS[key]
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const offset = (y * info.width + x) * 4
        pixels[offset] = 0
        pixels[offset + 1] = 0
        pixels[offset + 2] = 0
        pixels[offset + 3] = 0
      }
    }
    const padX = region.w >= 42 ? 7 : 4
    const padY = 6
    for (let y = region.y + padY; y < region.y + region.h - padY; y++) {
      for (let x = region.x + padX; x < region.x + region.w - padX; x++) {
        const offset = (y * info.width + x) * 4
        pixels[offset] = 90
        pixels[offset + 1] = 110
        pixels[offset + 2] = 180
        pixels[offset + 3] = 255
      }
    }
  }
  return sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

async function createOcadMotionSheetWithSourceQualityIssues() {
  const source = await createOcadMotionSheet()
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = new Uint8ClampedArray(data)

  const emptyRegion = OCAD_REGIONS.climb3
  for (let y = emptyRegion.y; y < emptyRegion.y + emptyRegion.h; y++) {
    for (let x = emptyRegion.x; x < emptyRegion.x + emptyRegion.w; x++) {
      pixels[(y * info.width + x) * 4 + 3] = 0
    }
  }

  const haloRegion = OCAD_REGIONS.idleup
  for (let x = haloRegion.x + 4; x < haloRegion.x + haloRegion.w - 4; x++) {
    const offset = ((haloRegion.y + 3) * info.width + x) * 4
    pixels[offset] = 252
    pixels[offset + 1] = 252
    pixels[offset + 2] = 252
    pixels[offset + 3] = 255
  }

  const edgeRegion = OCAD_REGIONS.die
  for (let x = edgeRegion.x + 1; x < edgeRegion.x + edgeRegion.w - 1; x++) {
    const offset = (edgeRegion.y * info.width + x) * 4
    pixels[offset] = 20
    pixels[offset + 1] = 40
    pixels[offset + 2] = 90
    pixels[offset + 3] = 255
  }

  return sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

test('processSheetBuffer turns fixture into a valid character pack', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
  })
  assert.equal(result.animationsJson.profile, 'topdown_rpg_v0')
  assert.equal(result.debugReport.validation.status, 'pass')
  assert.equal(result.editorMetadataJson.sheet, 'normalized_sheet.png')
  assert.ok(result.editorMetadataJson.frame_tags.some((tag) => tag.name === 'walk_down' && tag.from === 16 && tag.to === 19))
  assert.ok(result.editorMetadataJson.attachments.some((point) => point.name === 'feet' && point.frame === 0))
  assert.equal(result.debugReport.validation.frame_count, 64)
  assert.ok(Array.isArray(result.debugReport.validation.metrics.duplicate_frames))
  assert.equal(typeof result.debugReport.validation.metrics.halo_score, 'number')
  assert.equal(result.debugReport.validation.metrics.walk_cycles.walk_down.passed, true)
  assert.deepEqual(result.debugReport.inspection_preview.target_size, { w: 256, h: 256 })
  assert.equal(result.debugReport.inspection_preview.placement, 'center_bottom')
  assert.equal(result.debugReport.inspection_preview.scale_mode, 'action_stable_nearest')
  assert.equal(result.debugReport.inspection_preview.action_count, 16)
  assert.equal(result.debugReport.grid.correction.method, 'projection_minima')
  assert.ok(Array.isArray(result.rowPreviews))
  assert.equal(result.rowPreviews.length, 16)
  assert.equal(result.inspectionPreviews.length, 16)
  assert.deepEqual(
    result.rowPreviews.map((item) => item.fileName),
    [
      'idle_down.gif',
      'idle_up.gif',
      'idle_left.gif',
      'idle_right.gif',
      'walk_down.gif',
      'walk_up.gif',
      'walk_left.gif',
      'walk_right.gif',
      'attack_down.gif',
      'attack_up.gif',
      'attack_left.gif',
      'attack_right.gif',
      'hurt.gif',
      'happy.gif',
      'sit.gif',
      'talk.gif',
    ]
  )
  assert.deepEqual(result.rowPreviews.find((item) => item.name === 'walk_right').frames, [28, 29, 30, 31])
  assert.ok(Buffer.isBuffer(result.files.normalizedSheetPng))
  assert.ok(Buffer.isBuffer(result.files.multiResolutionSheets[64]))
  const sheet64Meta = await sharp(result.files.multiResolutionSheets[64]).metadata()
  assert.deepEqual({ width: sheet64Meta.width, height: sheet64Meta.height }, { width: 512, height: 512 })
  const inspectionSheetMeta = await sharp(result.files.inspectionSheetPng).metadata()
  assert.deepEqual({ width: inspectionSheetMeta.width, height: inspectionSheetMeta.height }, { width: 1024, height: 4096 })
  const inspectionStripMeta = await sharp(result.files.inspectionStripPngBuffers['inspection_strips/walk_right.png']).metadata()
  assert.deepEqual({ width: inspectionStripMeta.width, height: inspectionStripMeta.height }, { width: 1024, height: 256 })
  assert.equal(result.files.inspectionIndexJson.mode, 'inspection_preview_v1')
  assert.equal(result.files.inspectionIndexJson.actions.find((action) => action.name === 'walk_right').frame_count, 4)
  assert.ok(Buffer.isBuffer(result.files.inspectionGifBuffers['inspection_gifs/walk_right.gif']))
  assert.ok(Buffer.isBuffer(result.files.sourcePng))
  assert.ok(Buffer.isBuffer(result.files.debugOverlayPng))
  assert.ok(Buffer.isBuffer(result.files.onionSkinOverlayPng))
  assert.ok(Buffer.isBuffer(result.files.rowGifBuffers['walk_right.gif']))
  assert.ok(Buffer.isBuffer(result.files.zipBuffer))
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file('editor_metadata.json'))
  assert.ok(zip.file('inspection_index.json'))
  assert.ok(zip.file('inspection_sheet.png'))
  assert.ok(zip.file('inspection_gifs/walk_right.gif'))
  assert.ok(zip.file('inspection_strips/walk_right.png'))
  assert.ok(zip.file('multi_resolution.json'))
  assert.ok(zip.file('normalized_sheet_64.png'))
  const editorMetadata = JSON.parse(await zip.file('editor_metadata.json').async('string'))
  assert.equal(editorMetadata.profile, 'topdown_rpg_v0')
  const multiResolution = JSON.parse(await zip.file('multi_resolution.json').async('string'))
  assert.deepEqual(
    multiResolution.sheets.map((sheet) => sheet.frame_size),
    [96, 64, 48, 32, 16]
  )
})

test('processSheetBuffer records tuning controls for background tolerance and anchor offset', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Tuned Sample Hero',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
    backgroundTolerance: 36,
    anchorOffset: { x: 3, y: -2 },
  })

  assert.equal(result.debugReport.background_options.tolerance, 36)
  assert.equal(result.debugReport.background_options.matte_residue_cleanup, true)
  assert.equal(result.debugReport.background_options.edge_decontamination, true)
  assert.deepEqual(result.debugReport.anchor_tuning.offset, { x: 3, y: -2 })
  assert.deepEqual(result.debugReport.anchor_tuning.effective_anchor, { x: 51, y: 86, mode: 'feet-center' })
  assert.deepEqual(result.animationsJson.anchor, { x: 51, y: 86 })
})

test('processSheetBuffer records pixel style report only when explicitly requested', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const base = await processSheetBuffer(source, {
    name: 'Style Report Off',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
  })
  assert.equal(base.debugReport.pixel_style, undefined)

  const result = await processSheetBuffer(source, {
    name: 'Style Report On',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
    styleReport: true,
    styleMaxColors: 8,
  })

  assert.equal(result.debugReport.pixel_style.mode, 'report_only')
  assert.equal(result.debugReport.pixel_style.palette.max_colors, 8)
  assert.ok(result.debugReport.pixel_style.palette.colors.length <= 8)
  assert.equal(typeof result.debugReport.pixel_style.metrics.off_palette_ratio, 'number')
  assert.equal(result.debugReport.pixel_style.output_mutation, 'none')
})

test('processSheetBuffer applies pixel finishing before row previews and reports deterministic metrics', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Pixel Finished Sample Hero',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'flood',
    pixelFinishing: true,
    pixelFinishingMaxColors: 8,
    pixelFinishingOutline: true,
    pixelFinishingOutlineMode: 'inner',
  })

  assert.equal(result.debugReport.pixel_style.mode, 'pixel_finishing_v1')
  assert.equal(result.debugReport.pixel_style.palette.max_colors, 8)
  assert.equal(result.debugReport.pixel_style.outline.mode, 'inner')
  assert.equal(typeof result.debugReport.pixel_style.changed_pixel_ratio, 'number')
  assert.equal(typeof result.debugReport.pixel_style.alpha_cleanup.removed_pixel_count, 'number')
  assert.equal(typeof result.debugReport.pixel_style.halo_residue.after.near_white_edge_pixels, 'number')
  assert.deepEqual(result.debugReport.pixel_style.grid.cell_size, { w: 96, h: 96 })
  assert.equal(result.debugReport.pixel_style.scale.method, 'nearest_neighbor_exports')
  assert.ok(Buffer.isBuffer(result.files.rowGifBuffers['walk_down.gif']))
  const metadata = await sharp(result.files.normalizedSheetPng).metadata()
  assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 768, height: 768 })
})

test('processSheetBuffer accepts legacy fixed-region source layout alias', async () => {
  const source = await createOcadMotionSheet()
  const result = await processSheetBuffer(source, {
    name: 'Ocad Source',
    description: 'fixed-region one image motion sheet',
    sourceFileName: 'ocad_motion_source.png',
    backgroundMode: 'passthrough',
    sourceLayout: LEGACY_OCAD_MOTION_LAYOUT_ID,
  })

  assert.equal(result.debugReport.source_layout.id, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.debugReport.source_layout.kind, 'fixed_regions')
  assert.equal(result.debugReport.validation.frame_count, 64)
  assert.notEqual(result.debugReport.validation.status, 'fail')
  assert.equal(result.debugReport.grid.correction.method, 'fixed_regions')
  assert.equal(result.debugReport.normalization.auto_correction.enabled, true)
  assert.equal(result.debugReport.normalization.motion_stabilization.enabled, true)
  assert.equal(typeof result.debugReport.normalization.motion_stabilization.applied_count, 'number')
  assert.equal(result.animationsJson.source_layout.id, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.animationsJson.animations.attack_down.label, 'item')
  assert.equal(result.animationsJson.animations.attack_up.label, 'climb')
  assert.equal(result.animationsJson.animations.attack_left.label, 'attract left')
  assert.equal(result.animationsJson.animations.hurt.label, 'defence / die')
  assert.equal(result.animationsJson.animations.attack_down.ui_hidden, true)
  assert.equal(result.animationsJson.animations.attack_up.ui_hidden, true)
  assert.equal(result.animationsJson.animations.attack_left.ui_hidden, true)
  assert.equal(result.animationsJson.animations.attack_right.ui_hidden, true)
  assert.equal(result.animationsJson.animations.hurt.ui_hidden, true)
  assert.deepEqual(
    result.rowPreviews.map((item) => item.fileName),
    [
      'attractL.gif',
      'climb.gif',
      'defence.gif',
      'die.gif',
      'idleL.gif',
      'idledown.gif',
      'idleup.gif',
      'item.gif',
      'jump.gif',
      'runL.gif',
      'rundown.gif',
      'runup.gif',
      'sitdown.gif',
      'walkL.gif',
      'walkdown.gif',
      'walkup.gif',
    ]
  )
  assert.equal(result.rowPreviews.some((item) => /^attack_/.test(item.name) || /^attack_/.test(item.fileName) || /^attack_/.test(item.label)), false)
  assert.equal(result.rowPreviews.some((item) => item.name === 'hurt' || item.fileName === 'hurt.gif' || item.label === 'hurt'), false)
  assert.equal(result.rowPreviews.find((item) => item.name === 'attack_down'), undefined)
  assert.equal(result.rowPreviews.find((item) => item.name === 'attack_up'), undefined)
  assert.equal(result.rowPreviews.find((item) => item.name === 'hurt'), undefined)
  assert.equal(result.rowPreviews.find((item) => item.name === 'climb').fileName, 'climb.gif')
  assert.equal(result.rowPreviews.find((item) => item.name === 'climb').frames.length, 6)
  assert.equal(result.rowPreviews.find((item) => item.name === 'attractL').frames.length, 8)
  assert.equal(result.rowPreviews.find((item) => item.name === 'item').frames.length, 2)
  assert.equal(result.rowPreviews.find((item) => item.fileName === 'jump.gif').frames.length, 2)
  assert.ok(result.debugReport.frames.filter((frame) => frame.runtime_action === 'idle_left').every((frame) => frame.source_frame.region_key === 'idleL' && frame.source_frame.flip_h === false))
  assert.ok(result.debugReport.frames.filter((frame) => frame.runtime_action === 'idle_right').every((frame) => frame.source_frame.region_key === 'idleL' && frame.source_frame.flip_h === true))
  assert.equal(result.debugReport.frames[0].source_frame.layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.animationsJson.animations.happy.display_label, 'happy')
  assert.equal(result.animationsJson.animations.happy.semantic_status, 'visual_static_alias')
  assert.equal(result.animationsJson.animations.talk.semantic_status, 'visual_static_alias')
  assert.equal(result.animationsJson.animations.talk.display_label, 'talk')
  assert.equal(result.rowPreviews.find((item) => item.name === 'happy'), undefined)
  assert.equal(result.rowPreviews.find((item) => item.name === 'talk'), undefined)
  assert.ok(result.debugReport.frames.filter((frame) => frame.runtime_action === 'happy').every((frame) => frame.source_frame.region_key === 'item1'))
  assert.ok(result.debugReport.frames.filter((frame) => frame.runtime_action === 'talk').every((frame) => frame.source_frame.region_key === 'item0'))
  assert.equal(result.editorMetadataJson.frames.frame_036.source.layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.editorMetadataJson.frames.frame_036.source.region_key, 'climb0')
  assert.equal(result.files.rowGifBuffers['talk.gif'], undefined)
  assert.equal(result.files.rowGifBuffers['happy.gif'], undefined)
  assert.ok(Buffer.isBuffer(result.files.rowGifBuffers['climb.gif']))
  assert.ok(Buffer.isBuffer(result.files.rowGifBuffers['jump.gif']))
  assert.ok(Buffer.isBuffer(result.files.rowGifBuffers['item.gif']))
  assert.equal(result.files.rowGifBuffers['attack_down.gif'], undefined)
  assert.equal(result.files.rowGifBuffers['attack_up.gif'], undefined)
  assert.equal(result.files.rowGifBuffers['idle_down_item_use_approx.gif'], undefined)
  assert.equal(result.debugReport.inspection_preview.action_count, 16)
  assert.ok(Buffer.isBuffer(result.files.inspectionGifBuffers['inspection_gifs/climb.gif']))
  assert.ok(Buffer.isBuffer(result.files.inspectionGifBuffers['inspection_gifs/attractL.gif']))
  assert.equal(result.inspectionPreviews.find((item) => item.animation === 'climb').frame_size.w, 256)
  assert.ok(result.debugReport.source_layout.actions.some((action) => action.action === 'attractL' && action.label === 'attract left'))
  assert.ok(result.debugReport.source_layout.actions.some((action) => action.action === 'defence' && action.label === 'defence'))
  assert.deepEqual(result.debugReport.frames[0].source_frame.template_anchor, {
    x: 10,
    y: 41,
    mode: 'template-foot-center',
    source: 'fixed_region_motion_v0_template',
  })
  assert.equal(result.debugReport.frames[40].source_frame.template_motion.family, 'interact')
  assert.deepEqual(
    result.debugReport.frames
      .filter((frame) => [0, 36, 40].includes(frame.index))
      .map((frame) => ({
        index: frame.index,
        runtime: frame.runtime_action,
        source: frame.source_frame.action,
        label: frame.source_frame.label,
      })),
    [
      { index: 0, runtime: 'idle_down', source: 'idledown', label: 'idle down' },
      { index: 36, runtime: 'attack_up', source: 'climb', label: 'climb' },
      { index: 40, runtime: 'attack_left', source: 'attractL', label: 'attract left' },
    ]
  )
  assert.ok(Buffer.isBuffer(result.files.sourceLayoutOverlayPng))
  assert.equal(result.animationsJson.profile, 'topdown_rpg_v0')
  assert.ok(Buffer.isBuffer(result.files.normalizedSheetPng))
  assert.ok(Buffer.isBuffer(result.files.ocadZipBuffer))
})

test('processSheetBuffer records fixed-region source quality and separates expected static reuse', async () => {
  const source = await createOcadMotionSheetWithDuplicateSourceAction('walkdown')
  const result = await processSheetBuffer(source, {
    name: 'Source Motion Quality',
    description: 'fixed-region sheet with duplicate walkdown source frames',
    sourceFileName: 'fixed_region_duplicate_motion.png',
    backgroundMode: 'passthrough',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
  })

  const report = result.debugReport.source_quality
  assert.equal(report.mode, 'fixed_region_source_quality_v1')
  assert.equal(report.source_layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(report.status, 'warning')
  assert.equal(report.summary.duplicate_motion_action_count, 1)
  assert.equal(report.summary.expected_static_action_count > 0, true)
  assert.equal(report.warnings.includes('source_action_low_motion:walkdown'), true)
  assert.equal(result.debugReport.validation.warnings.includes('source_action_low_motion:walkdown'), true)
  assert.equal(result.debugReport.validation.status, 'warning')

  const walkdown = report.action_motion.actions.find((item) => item.action === 'walkdown')
  assert.equal(walkdown.expected_motion, true)
  assert.equal(walkdown.passed, false)
  assert.equal(walkdown.unique_frame_hash_count, 1)

  const idledown = report.action_motion.expected_static_reuse.find((item) => item.action === 'idledown')
  assert.equal(idledown.expected_motion, false)
  assert.equal(idledown.passed, true)

  assert.ok(Buffer.isBuffer(result.files.sourceQualityReportJson))
  const persisted = JSON.parse(result.files.sourceQualityReportJson.toString('utf8'))
  assert.equal(persisted.summary.duplicate_motion_action_count, 1)
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file('source_quality_report.json'))
})

test('processSheetBuffer reports fixed-region source occupancy halo edge pressure and layout alignment', async () => {
  const source = await createOcadMotionSheetWithSourceQualityIssues()
  const result = await processSheetBuffer(source, {
    name: 'Source Quality Issues',
    description: 'fixed-region sheet with source-level quality issues',
    sourceFileName: 'fixed_region_source_quality_issues.png',
    backgroundMode: 'passthrough',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
  })

  const report = result.debugReport.source_quality
  assert.equal(report.status, 'fail')
  assert.equal(report.layout_alignment.passed, true)
  assert.deepEqual(report.layout_alignment.expected_size, { w: 252, h: 252 })
  assert.deepEqual(report.layout_alignment.actual_size, { w: 252, h: 252 })
  assert.equal(report.summary.empty_region_count, 1)
  assert.equal(report.summary.halo_region_count >= 1, true)
  assert.equal(report.summary.edge_pressure_severe_region_count >= 1, true)
  assert.equal(report.blocking_errors.includes('source_region_empty:climb3'), true)
  assert.equal(report.warnings.some((message) => message.startsWith('source_region_halo:idleup')), true)
  assert.equal(report.warnings.includes('source_region_edge_pressure:die'), true)

  const empty = report.regions.find((region) => region.region_key === 'climb3')
  assert.equal(empty.occupancy.visible_pixel_count, 0)
  assert.equal(empty.occupancy.passed, false)

  const halo = report.regions.find((region) => region.region_key === 'idleup')
  assert.equal(halo.background_residue.near_white_edge_pixels > 0, true)
  assert.equal(halo.background_residue.passed, false)

  assert.equal(result.debugReport.validation.blocking_errors.includes('source_region_empty:climb3'), true)
  assert.equal(result.debugReport.validation.failure_taxonomy.primary, 'source.empty_region')
  assert.equal(result.metadataJson.quality.blocking_errors.includes('source_region_empty:climb3'), true)
})

test('processSheetBuffer downscales high-resolution fixed-region sheets before slicing', async () => {
  const source = await createHighResolutionOcadMotionSheet()
  const result = await processSheetBuffer(source, {
    name: 'High Res Ocad Source',
    description: 'high-resolution fixed-region motion sheet',
    sourceFileName: 'ocad_motion_source_1024.png',
    backgroundMode: 'passthrough',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
  })

  assert.deepEqual(result.debugReport.source_preprocess, {
    applied: true,
    method: 'fixed_region_resize',
    input_size: { w: 1024, h: 1024 },
    output_size: { w: 252, h: 252 },
    source_layout: FIXED_REGION_MOTION_LAYOUT_ID,
  })
  assert.deepEqual(result.debugReport.frames[0].source_frame.rect, { x: 189, y: 126, w: 21, h: 42 })
  assert.equal(result.debugReport.grid.source_cell_size.w, 21)
  assert.equal(result.debugReport.grid.source_cell_size.h, 42)
  const sourceMeta = await sharp(result.files.sourcePng).metadata()
  assert.equal(sourceMeta.width, 252)
  assert.equal(sourceMeta.height, 252)
  assert.equal(result.debugReport.validation.frame_count, 64)
  assert.notEqual(result.debugReport.validation.status, 'fail')
})

test('processSheetBuffer stages generated fixed-region sheets through 256 matte and 252 crop', async () => {
  const source = await createGeneratedFixedRegionSheet256WithWhiteBackground()
  const result = await processSheetBuffer(source, {
    name: 'Generated Fixed Region Source',
    description: 'generated fixed-region motion sheet',
    sourceFileName: 'generated_fixed_region_256.png',
    backgroundMode: 'auto',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
    fixedRegionSourceStaging: 'fixed_region_256_crop',
  })

  assert.equal(result.debugReport.source_staging.applied, true)
  assert.equal(result.debugReport.source_staging.method, 'fixed_region_256_crop')
  assert.deepEqual(result.debugReport.source_staging.input_size, { w: 256, h: 256 })
  assert.deepEqual(result.debugReport.source_staging.stage_size, { w: 256, h: 256 })
  assert.deepEqual(result.debugReport.source_staging.output_size, { w: 252, h: 252 })
  assert.equal(result.debugReport.source_staging.source_layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.deepEqual(result.debugReport.source_staging.crop, { right: 4, bottom: 4 })
  assert.equal(result.debugReport.source_staging.matte.method, 'top_left_connected')
  assert.equal(result.debugReport.source_staging.matte.tolerance, 80)
  assert.ok(result.debugReport.source_staging.matte.removed_pixels > 10000)
  assert.equal(result.debugReport.source_preprocess.applied, false)
  assert.equal(result.debugReport.background_mode, 'alpha_cleanup')
  const sourceMeta = await sharp(result.files.sourcePng).metadata()
  assert.equal(sourceMeta.width, 252)
  assert.equal(sourceMeta.height, 252)
  const firstPixel = await sharp(result.files.sourcePng).ensureAlpha().raw().toBuffer()
  assert.equal(firstPixel[3], 0)
  assert.equal(result.debugReport.validation.frame_count, 64)
})

test('processSheetBuffer records source-region edge pressure as source quality warning even when runtime frames fit', async () => {
  const source = await createOcadMotionSheetWithSourceEdgePressure('die')
  const result = await processSheetBuffer(source, {
    name: 'Source Edge Pressure',
    description: 'fixed-region sheet with content touching a source boundary',
    sourceFileName: 'ocad_motion_edge_pressure.png',
    backgroundMode: 'passthrough',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
  })

  const metric = result.debugReport.validation.metrics.source_region_edge_pressure
  assert.equal(metric.source_layout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(metric.severe_region_count, 1)
  assert.equal(metric.pressured_region_count, 1)
  assert.deepEqual(metric.severe_regions, ['die'])
  assert.equal(result.debugReport.validation.metrics.edge_pressure.severe_frame_count, 0)
  assert.equal(result.debugReport.validation.warnings.includes('source_region_edge_pressure_high'), false)
  assert.equal(result.debugReport.validation.warnings.includes('source_region_edge_pressure:die'), true)
  assert.equal(result.debugReport.validation.failure_taxonomy.primary, 'source.edge_pressure')
  assert.equal(result.debugReport.validation.status, 'warning')
  assert.deepEqual(
    metric.pressured_regions.map((item) => ({
      key: item.region_key,
      edges: item.edges,
      top: item.margins.top,
    })),
    [{ key: 'die', edges: ['top'], top: 0 }]
  )
})

test('processSheetBuffer wires dual matte and includes debug artifacts in zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const blackSource = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const pixels = new Uint8ClampedArray(data)
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) {
          pixels[i] = 0
          pixels[i + 1] = 0
          pixels[i + 2] = 0
        }
      }
      return sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
    })

  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    sourceFileName: 'topdown_rpg_v0_sample_hero.png',
    backgroundMode: 'dual_matte',
    blackSourceBuffer: blackSource,
  })

  assert.equal(result.debugReport.requested_background_mode, 'dual_matte')
  assert.equal(result.debugReport.background_mode, 'dual_matte')
  assert.equal(result.debugReport.validation.dual_matte_inconsistent, false)
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file('source.png'))
  assert.ok(zip.file('debug_overlay.png'))
  assert.ok(zip.file('onion_skin_overlay.png'))
})

test('processSheetBuffer includes Godot NPC plugin import pack in the zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const basePath = 'AI资源库/一图全动作/npc_20260524_010203_sample_hero'
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file(`${basePath}/sprite.png`))
  assert.ok(zip.file(`${basePath}/thumb.png`))
  const npcJson = JSON.parse(await zip.file(`${basePath}/npc.json`).async('string'))
  assert.equal(npcJson.assets.spritePath, './sprite.png')
  assert.equal(npcJson.spritesheet.layoutVersion, 'json_grid')
  assert.equal(npcJson.ext.spritesheetSlice, 'json_grid')
  assert.equal(npcJson.spritesheet.animations.walk_right.row, 3)
  assert.ok(Buffer.isBuffer(result.files.godotNpcZipBuffer))
})

test('processSheetBuffer includes RPGMaker import pack in the zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const basePath = 'AI资源库/RPGMAKER/npc_20260524_010203_sample_hero_rpgmaker'
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file(`${basePath}/NPC.json`))
  assert.ok(zip.file(`${basePath}/sprite.png`))
  assert.ok(zip.file(`${basePath}/thumb.png`))
  const npcJson = JSON.parse(await zip.file(`${basePath}/NPC.json`).async('string'))
  assert.equal(npcJson.spritesheet.layoutVersion, 'rpgmaker_v1')
  assert.equal(npcJson.spritesheet.frameWidth, 48)
  assert.equal(npcJson.spritesheet.frameHeight, 48)
  assert.ok(Buffer.isBuffer(result.files.rpgmakerZipBuffer))
})

test('processSheetBuffer includes OCAD import pack in the zip', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const basePath = 'AI资源库/一图全动作/npc_20260524_010203_sample_hero_ocad'
  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.ok(zip.file(`${basePath}/npc.json`))
  assert.ok(zip.file(`${basePath}/sprite.png`))
  assert.ok(zip.file(`${basePath}/thumb.png`))
  const npcJson = JSON.parse(await zip.file(`${basePath}/npc.json`).async('string'))
  assert.equal(npcJson.spritesheet.layoutVersion, 'yituquan_v1')
  assert.equal(npcJson.ext.spritesheetSlice, undefined)
  assert.ok(Buffer.isBuffer(result.files.ocadZipBuffer))
})

test('fixed-region exports keep source-native OCAD sheet and mirror RPG Maker right row', async () => {
  const source = await createOcadMotionSheet()
  const result = await processSheetBuffer(source, {
    name: 'Fixed Native',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
    backgroundMode: 'passthrough',
    autoCorrect: false,
    motionStabilize: false,
    componentCleanup: false,
    createdAt: '2026-05-24T01:02:03+08:00',
  })

  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  const ocadPath = 'AI资源库/一图全动作/npc_20260524_010203_fixed_native_ocad/sprite.png'
  const ocadSprite = await zip.file(ocadPath).async('nodebuffer')
  const sourceRaw = await sharp(result.files.sourcePng).ensureAlpha().raw().toBuffer()
  const ocadRaw = await sharp(ocadSprite).ensureAlpha().raw().toBuffer()
  assert.deepEqual(ocadRaw, sourceRaw)

  const rpgPath = 'AI资源库/RPGMAKER/npc_20260524_010203_fixed_native_rpgmaker/sprite.png'
  const rpgSprite = await zip.file(rpgPath).async('nodebuffer')
  const rpgRaw = await sharp(rpgSprite).ensureAlpha().raw().toBuffer()
  const cell = 48
  const sheetWidth = 144
  for (let col = 0; col < 3; col += 1) {
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const left = ((cell + y) * sheetWidth + col * cell + x) * 4
        const right = ((cell * 2 + y) * sheetWidth + col * cell + (cell - 1 - x)) * 4
        assert.deepEqual([...rpgRaw.slice(right, right + 4)], [...rpgRaw.slice(left, left + 4)])
      }
    }
  }
})

test('processSheetBuffer auto-removes fake transparent checkerboard backgrounds', async () => {
  const source = await createCheckerboardSheet()
  const result = await processSheetBuffer(source, {
    name: 'Checker',
    description: 'fake transparent background',
    backgroundMode: 'auto',
  })

  const raw = await sharp(result.files.normalizedSheetPng).ensureAlpha().raw().toBuffer()
  assert.equal(result.debugReport.background_mode, 'edge_palette')
  assert.equal(raw[3], 0)
})

test('processSheetBuffer auto-selects edge palette when validation beats plain flood', async () => {
  const source = await createOcadMotionSheetWithOffWhiteBackground()
  const result = await processSheetBuffer(source, {
    name: 'Ocad Off White',
    sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
    backgroundMode: 'auto',
  })

  assert.equal(result.debugReport.requested_background_mode, 'auto')
  assert.equal(result.debugReport.background_mode, 'edge_palette')
  assert.equal(result.debugReport.background_selection.method, 'validation_candidate_score')
  assert.equal(result.debugReport.background_selection.selected_mode, 'edge_palette')
  const flood = result.debugReport.background_selection.candidates.find((item) => item.selected_mode === 'flood')
  const edgePalette = result.debugReport.background_selection.candidates.find((item) => item.selected_mode === 'edge_palette')
  assert.ok(flood)
  assert.ok(edgePalette)
  assert.ok(edgePalette.score < flood.score)
  assert.ok(
    edgePalette.metrics.source_region_severe_count < flood.metrics.source_region_severe_count ||
      edgePalette.metrics.edge_pressure_severe_frames < flood.metrics.edge_pressure_severe_frames
  )
})

test('processSheetBuffer removes tiny detached components inside each sliced cell', async () => {
  const source = await createSheetWithDetachedCrumbs()
  const result = await processSheetBuffer(source, {
    name: 'Crumb Cleaner',
    backgroundMode: 'flood',
    componentCleanupMinArea: 3,
  })

  assert.equal(result.debugReport.component_cleanup.enabled, true)
  assert.equal(result.debugReport.component_cleanup.removed_components, 64)
  assert.equal(result.debugReport.component_cleanup.removed_pixels, 64)
})

test('processSheetBuffer applies manual frame nudges and locks selected motion groups', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Manual Nudge',
    backgroundMode: 'flood',
    frameAdjustments: [{ frame: 0, dx: 1, dy: -1 }],
    lockedAnimations: ['idle_down'],
  })

  assert.equal(result.debugReport.normalization.motion_stabilization.locked_animations[0], 'idle_down')
  assert.equal(result.debugReport.normalization.manual_adjustments.applied_count, 1)
  assert.deepEqual(
    result.debugReport.normalization.manual_adjustments.corrections.map(({ frame, dx, dy }) => ({ frame, dx, dy })),
    [{ frame: 0, dx: 1, dy: -1 }]
  )
  assert.equal(result.debugReport.frames[0].manual_adjustment.applied, true)
})

test('processSheetBuffer records generation prompt artifacts when provided', async () => {
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await processSheetBuffer(source, {
    name: 'Sample Hero',
    description: 'silver hair sword fighter',
    backgroundMode: 'flood',
    promptText: 'Create a strict 8x8 sprite sheet.',
    generation: {
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-image',
      image_config: { image_size: '2K' },
    },
  })

  assert.equal(result.files.promptTxt.toString('utf8'), 'Create a strict 8x8 sprite sheet.')
  assert.equal(JSON.parse(result.files.generationJson.toString('utf8')).provider, 'openrouter')

  const zip = await JSZip.loadAsync(result.files.zipBuffer)
  assert.equal(await zip.file('prompt.txt').async('string'), 'Create a strict 8x8 sprite sheet.')
  assert.equal(JSON.parse(await zip.file('generation.json').async('string')).model, 'google/gemini-2.5-flash-image')
})
