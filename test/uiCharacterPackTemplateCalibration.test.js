import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
} from '../src/character-pack/fixedRegionGeometry.js'
import {
  calibrateFixedRegionTemplateImage,
  FIXED_REGION_TEMPLATE_VISIBLE_BOUNDS_V0,
  removeTopLeftConnectedMatte,
  stageTemplateCalibrationSource,
  TEMPLATE_CALIBRATION_CROP_SIZE,
  TEMPLATE_CALIBRATION_MODE,
  TEMPLATE_CALIBRATION_STAGE_SIZE,
} from '../src/ui/characterPack/templateCalibrationCore.js'

function blankRgba(width, height, color = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data.set(color, index * 4)
  }
  return { width, height, data }
}

function setPixel(image, x, y, color) {
  image.data.set(color, (y * image.width + x) * 4)
}

function alphaBounds(image) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0
    ? null
    : { x: minX, y: minY, right: maxX, bottom: maxY }
}

function countColor(image, color) {
  let count = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      image.data[offset] === color[0] &&
      image.data[offset + 1] === color[1] &&
      image.data[offset + 2] === color[2] &&
      image.data[offset + 3] === color[3]
    ) {
      count++
    }
  }
  return count
}

test('template calibration visible bounds cover every fixed region and remain local', () => {
  assert.deepEqual(
    Object.keys(FIXED_REGION_TEMPLATE_VISIBLE_BOUNDS_V0).sort(),
    Object.keys(FIXED_REGION_SOURCE_REGIONS).sort()
  )
  for (const [key, bounds] of Object.entries(FIXED_REGION_TEMPLATE_VISIBLE_BOUNDS_V0)) {
    const region = FIXED_REGION_SOURCE_REGIONS[key]
    assert.ok(bounds.x >= 0 && bounds.y >= 0, `${key} starts outside its region`)
    assert.ok(bounds.x + bounds.w <= region.w, `${key} exceeds region width`)
    assert.ok(bounds.y + bounds.h <= region.h, `${key} exceeds region height`)
  }
})

test('UI template calibration re-exports the shared character-pack implementation', async () => {
  const controller = await readFile('src/ui/characterPack/templateCalibrationCore.js', 'utf8')
  assert.match(controller, /from '\.\.\/\.\.\/character-pack\/fixedRegionCalibration\.js'/)
  assert.doesNotMatch(controller, /function calibrateFixedRegionTemplateImage/)
})

test('template calibration staging removes only the connected top-left matte', () => {
  const source = blankRgba(3, 3, [255, 255, 255, 255])
  setPixel(source, 1, 1, [20, 30, 40, 255])
  const matte = removeTopLeftConnectedMatte(source, { tolerance: 10 })

  assert.equal(matte.removedPixels, 8)
  assert.equal(matte.image.data[(1 * 3 + 1) * 4 + 3], 255)
  assert.equal(matte.image.data[3], 0)

  const staged = stageTemplateCalibrationSource(source)
  assert.equal(staged.image.width, TEMPLATE_CALIBRATION_CROP_SIZE)
  assert.equal(staged.image.height, TEMPLATE_CALIBRATION_CROP_SIZE)
  assert.deepEqual(staged.report.stage_size, {
    w: TEMPLATE_CALIBRATION_STAGE_SIZE,
    h: TEMPLATE_CALIBRATION_STAGE_SIZE,
  })
  assert.equal(staged.report.matte_applied, true)

  const stagedWithoutMatte = stageTemplateCalibrationSource(source, {
    removeConnectedMatte: false,
  })
  assert.equal(stagedWithoutMatte.report.matte_applied, false)
  assert.equal(stagedWithoutMatte.report.matte_removed_pixels, 0)
  assert.equal(stagedWithoutMatte.image.data[3], 255)
})

test('template calibration preserves disconnected pose details while removing isolated noise', () => {
  const source = blankRgba(
    FIXED_REGION_SOURCE_SHEET.w,
    FIXED_REGION_SOURCE_SHEET.h
  )
  const region = FIXED_REGION_SOURCE_REGIONS.idledown
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 3; x++) {
      setPixel(source, region.x + x, region.y + y, [30, 120, 70, 255])
    }
  }
  setPixel(source, region.x + 10, region.y, [210, 90, 40, 255])
  setPixel(source, region.x + 11, region.y, [210, 90, 40, 255])
  setPixel(source, region.x + region.w - 1, region.y, [255, 0, 0, 255])

  const result = calibrateFixedRegionTemplateImage(source)
  const bounds = alphaBounds(result.image)

  assert.equal(result.report.mode, TEMPLATE_CALIBRATION_MODE)
  assert.equal(result.report.calibrated_region_count, 1)
  assert.equal(result.report.missing_region_count, 59)
  assert.equal(result.report.removed_component_count, 1)
  assert.equal(result.report.removed_pixel_count, 1)
  assert.ok(countColor(result.image, [210, 90, 40, 255]) > 0)
  assert.equal(countColor(result.image, [255, 0, 0, 255]), 0)
  assert.ok(bounds)
  assert.ok(bounds.x >= region.x + 5)
  assert.ok(bounds.right <= region.x + 16)
  assert.ok(bounds.y >= region.y + 8)
  assert.ok(bounds.bottom <= region.y + 37)

  for (let y = TEMPLATE_CALIBRATION_CROP_SIZE; y < result.image.height; y++) {
    for (let x = 0; x < result.image.width; x++) {
      assert.equal(result.image.data[(y * result.image.width + x) * 4 + 3], 0)
    }
  }
  for (let y = 0; y < result.image.height; y++) {
    for (let x = TEMPLATE_CALIBRATION_CROP_SIZE; x < result.image.width; x++) {
      assert.equal(result.image.data[(y * result.image.width + x) * 4 + 3], 0)
    }
  }
})

test('Studio Advanced Local owns calibration preview, confirmation, and stale-operation guards', async () => {
  const [html, view, advanced] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterAdvancedLocal.js', 'utf8'),
  ])

  assert.match(html, /id="character-advanced-calibration"/)
  assert.match(html, /id="character-calibration-build"/)
  assert.match(html, /id="character-calibration-use"/)
  assert.match(view, /calibrateFixedRegionTemplateImage/)
  assert.match(view, /stageTemplateCalibrationSource/)
  assert.match(view, /calibrationEpoch/)
  assert.match(view, /operationEpoch/)
  assert.match(advanced, /invalidateAdvancedLocalResult/)
  assert.doesNotMatch(advanced, /\bfetch\s*\(/)
})
