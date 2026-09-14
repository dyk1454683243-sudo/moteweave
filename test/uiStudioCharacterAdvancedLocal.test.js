import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  addAdvancedCutLine,
  advancedLocalInputFingerprint,
  bindAdvancedBlackMatteSettings,
  buildAdvancedLocalCharacterOptions,
  canCommitAdvancedBlackMatteSelection,
  createAdvancedLocalSettings,
  invalidateAdvancedLocalResultState,
  makeEvenAdvancedCutLines,
  moveAdvancedCutLine,
  normalizeAdvancedCutLines,
  StudioCharacterAdvancedLocalError,
  validateAdvancedLocalSourceFile,
} from '../src/ui/studio/characterAdvancedLocal.js'

function imageFile({ name = 'hero.jpg', type = 'image/jpeg', size = 4, lastModified = 1 } = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4])
  return {
    name,
    type,
    size,
    lastModified,
    async arrayBuffer() { return bytes.buffer.slice(0) },
  }
}

test('advanced local accepts maintained PNG, WebP, and JPEG sources only', () => {
  for (const [name, type] of [
    ['hero.png', 'image/png'],
    ['hero.webp', 'image/webp'],
    ['hero.jpg', 'image/jpeg'],
    ['hero.jpeg', 'image/jpeg'],
  ]) assert.equal(validateAdvancedLocalSourceFile(imageFile({ name, type })).name, name)
  assert.throws(
    () => validateAdvancedLocalSourceFile(imageFile({ name: 'hero.gif', type: 'image/gif' })),
    (error) => error instanceof StudioCharacterAdvancedLocalError && error.code === 'source_type_invalid',
  )
})

test('advanced local normalizes every maintained process-sheet option and real output scale', () => {
  const file = imageFile()
  const blackFile = imageFile({ name: 'hero-black.png', type: 'image/png' })
  const dimensions = { width: 768, height: 768 }
  const settings = {
    ...createAdvancedLocalSettings(dimensions),
    sourceLayout: 'fixed_region_motion_v0',
    backgroundMode: 'dual_matte',
    backgroundTolerance: 30,
    anchorOffset: { x: 2, y: -3 },
    frameAdjustments: { 7: { dx: 1, dy: -2 } },
    lockedAnimations: ['idle_down', 'walk_left'],
    motionMaxShift: 4,
    pixelFinishing: true,
    pixelFinishingMaxColors: 24,
    pixelFinishingOutlineMode: 'both',
    exportScales: [1, 3, 4],
  }
  const options = buildAdvancedLocalCharacterOptions({
    file,
    blackFile,
    blackDimensions: dimensions,
    dimensions,
    name: 'Hero',
    settings,
  })
  assert.equal(options.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(options.backgroundMode, 'dual_matte')
  assert.deepEqual(options.anchorOffset, { x: 2, y: -3 })
  assert.deepEqual(options.frameAdjustments, [{ frame: 7, dx: 1, dy: -2 }])
  assert.deepEqual(options.lockedAnimations, ['idle_down', 'walk_left'])
  assert.equal(options.motionStabilizationMaxShift, 4)
  assert.equal(options.pixelFinishing, true)
  assert.equal(options.styleReport, true)
  assert.deepEqual(options.outputFrameSizes, [96, 288, 384])
  assert.equal(options.export2x, false)
  assert.equal(options.fixedRegionSourceStaging, 'fixed_region_256_crop')
  assert.equal(options.fixedRegionStageSize, 256)
  assert.equal(options.fixedRegionCropRight, 4)
  assert.equal(options.fixedRegionCropBottom, 4)
  assert.equal(options.manualOverrides, null)
})

test('advanced local binds dual-matte dimensions and manual cut-line structure', () => {
  const file = imageFile()
  const settings = createAdvancedLocalSettings({ width: 800, height: 640 })
  assert.throws(
    () => buildAdvancedLocalCharacterOptions({
      file,
      blackFile: imageFile({ name: 'black.png', type: 'image/png' }),
      blackDimensions: { width: 799, height: 640 },
      dimensions: { width: 800, height: 640 },
      name: 'Hero',
      settings: { ...settings, backgroundMode: 'dual_matte' },
    }),
    (error) => error.code === 'black_matte_dimensions_mismatch',
  )
  const cuts = makeEvenAdvancedCutLines(800, 640)
  assert.deepEqual(normalizeAdvancedCutLines(cuts), cuts)
  const options = buildAdvancedLocalCharacterOptions({
    file,
    dimensions: { width: 800, height: 640 },
    name: 'Hero',
    settings: { ...settings, manualCutLinesEnabled: true, manualCutLines: cuts },
  })
  assert.equal(options.manualOverrides.columns.length, 9)
  assert.equal(options.manualOverrides.rows.length, 9)
  assert.throws(
    () => normalizeAdvancedCutLines({ ...cuts, verticalLines: cuts.verticalLines.slice(1) }),
    (error) => error.code === 'cut_line_count_invalid',
  )
})

test('advanced local cut-line helpers add and clamp browser-local positions', () => {
  let cuts = { width: 80, height: 80, verticalLines: [], horizontalLines: [] }
  for (let index = 0; index < 7; index += 1) cuts = addAdvancedCutLine(cuts, 'vertical')
  assert.equal(cuts.verticalLines.length, 7)
  const moved = moveAdvancedCutLine(cuts, 'vertical', 3, -100)
  assert.equal(moved.verticalLines[3], moved.verticalLines[2] + 1)
})

test('advanced local fingerprint includes the input epoch even for identical file metadata', () => {
  const file = imageFile()
  const options = { sourceLayout: 'topdown_rpg_v0' }
  assert.notEqual(
    advancedLocalInputFingerprint({ file, options, inputEpoch: 1 }),
    advancedLocalInputFingerprint({ file, options, inputEpoch: 2 }),
  )
})

test('choosing a black-matte source atomically binds the only mode that submits it', () => {
  const settings = bindAdvancedBlackMatteSettings(createAdvancedLocalSettings())
  assert.equal(settings.backgroundMode, 'dual_matte')
  assert.equal(canCommitAdvancedBlackMatteSelection({
    selectionEpoch: 4,
    currentSelectionEpoch: 4,
    backgroundMode: settings.backgroundMode,
  }), true)
  assert.equal(canCommitAdvancedBlackMatteSelection({
    selectionEpoch: 4,
    currentSelectionEpoch: 5,
    backgroundMode: 'auto',
  }), false)
  assert.equal(canCommitAdvancedBlackMatteSelection({
    selectionEpoch: 4,
    currentSelectionEpoch: 4,
    backgroundMode: 'auto',
  }), false)
})

test('advanced parameter invalidation immediately revokes prior release and Project binding', () => {
  const complete = {
    phase: 'complete',
    busy: null,
    file: imageFile(),
    inputEpoch: 8,
    binding: { inputKey: 'old' },
    job: { id: 'job_old', status: 'done' },
    result: { job: { id: 'job_old', zip_url: '/generated/job_old/character_pack.zip' } },
    failureReport: { validation: { status: 'pass' } },
    error: 'old',
  }
  const invalidated = invalidateAdvancedLocalResultState(complete, {
    advancedSettings: { backgroundTolerance: 25 },
  })
  assert.equal(invalidated.phase, 'ready')
  assert.equal(invalidated.inputEpoch, 9)
  assert.equal(invalidated.binding, null)
  assert.equal(invalidated.job, null)
  assert.equal(invalidated.result, null)
  assert.equal(invalidated.failureReport, null)
})

test('Studio advanced local UI follows the Current Figma states without legacy controllers or new APIs', async () => {
  const [html, css, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
  ])
  for (const nodeId of ['971:4596', '971:4831', '971:5066']) assert.match(html, new RegExp(nodeId.replace(':', '\\:')))
  for (const id of [
    'character-advanced-entry',
    'character-advanced-config',
    'character-advanced-calibration',
    'character-advanced-cuts',
    'character-advanced-black-file',
    'character-advanced-layout',
    'character-advanced-run',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /id="character-local-file"[^>]*image\/jpeg/)
  assert.match(html, /id="character-advanced-entry"[^>]*aria-controls="character-advanced-config character-advanced-calibration character-advanced-cuts"[^>]*aria-expanded="false"/)
  assert.match(html, /id="character-local-stage-title" tabindex="-1"/)
  assert.match(css, /\.character-advanced-overlay \{[^}]*left: 300px[^}]*width: 520px/s)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.character-advanced-overlay, \.character-advanced-full \{[^}]*position: relative[^}]*width: 100%/)
  assert.match(view, /stageTemplateCalibrationSource\(decoded\)/)
  assert.match(view, /calibrateFixedRegionTemplateImage\(staged\.image\)/)
  assert.match(view, /sourceSelectionEpoch/)
  assert.match(view, /blackSelectionEpoch/)
  assert.match(view, /advancedSettings: bindAdvancedBlackMatteSettings\(state\.advancedSettings\)/)
  assert.match(view, /state\.advancedSettings\.backgroundMode === 'dual_matte'/)
  assert.match(view, /canCommitAdvancedBlackMatteSelection\(\{/)
  assert.match(view, /setState\(beginLocalCharacterRunState\(state, binding\)\)/)
  assert.match(view, /clearSource\(\{ processingMode: 'standard', advancedPanel: null \}\)/)
  assert.match(view, /entry\.setAttribute\('aria-expanded', String\(Boolean\(panel\)\)\)/)
  assert.match(view, /queueMicrotask\(\(\) => byId\(headingId\)\?\.focus\(\)\)/)
  assert.match(view, /state\.binding\?\.inputKey !== currentKey/)
  assert.match(view, /advancedProfileFixed: 'Fixed-region motion source'/)
  assert.match(view, /advancedProfileFixed: '固定区域动作源图'/)
  assert.match(view, /advancedProfileTopdown: 'Standard RPG topdown · 8 × 8'/)
  assert.match(view, /advancedProfileTopdown: '标准 RPG 俯视 · 8 × 8'/)
  assert.match(view, /localT\('calibrationReportRegions'\)/)
  assert.match(api, /submitAdvancedLocalCharacterJob/)
  assert.match(api, /requestStudioCharacterJson\('\/api\/process-sheet'/)
  assert.match(css, /\.character-advanced-matte \.character-local-file:focus-visible \+ label/)
  assert.doesNotMatch(`${view}\n${api}`, /characterPackTab|characterPack\/workflows|\/api\/generate-character/)
})
