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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function selectMarkup(html, id) {
  return html.match(new RegExp(`<select id="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1] ?? ''
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
  assert.equal(createAdvancedLocalSettings().sourceLayout, 'fixed_region_motion_v0')
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
  const settings = {
    ...createAdvancedLocalSettings({ width: 800, height: 640 }),
    sourceLayout: 'topdown_rpg_v0',
  }
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

test('advanced local presents bilingual option labels without changing maintained enum values', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
  ])
  const background = [
    ['auto', 'advancedBackgroundAuto', '自动检测', 'Automatic'],
    ['flood', 'advancedBackgroundFlood', '纯色连通去背', 'Solid-color flood removal'],
    ['edge_palette', 'advancedBackgroundEdgePalette', '边缘取色去背', 'Edge-palette removal'],
    ['alpha', 'advancedBackgroundAlpha', '透明通道清理', 'Alpha cleanup'],
    ['dual_matte', 'advancedBackgroundDualMatte', '黑白底配对', 'White/black matte pair'],
  ]
  const outline = [
    ['outer', 'advancedOutlineOuter', '外描边', 'Outer outline'],
    ['inner', 'advancedOutlineInner', '内描边', 'Inner outline'],
    ['both', 'advancedOutlineBoth', '内外描边', 'Inner + outer outline'],
  ]
  const animationLocks = [
    ['idle_down', 'advancedLockIdleDown', '待机 · 向下', 'Idle · Down'],
    ['idle_up', 'advancedLockIdleUp', '待机 · 向上', 'Idle · Up'],
    ['idle_left', 'advancedLockIdleLeft', '待机 · 向左', 'Idle · Left'],
    ['idle_right', 'advancedLockIdleRight', '待机 · 向右', 'Idle · Right'],
    ['walk_down', 'advancedLockWalkDown', '行走 · 向下', 'Walk · Down'],
    ['walk_up', 'advancedLockWalkUp', '行走 · 向上', 'Walk · Up'],
    ['walk_left', 'advancedLockWalkLeft', '行走 · 向左', 'Walk · Left'],
    ['walk_right', 'advancedLockWalkRight', '行走 · 向右', 'Walk · Right'],
    ['attack_down', 'advancedLockAttackDown', '攻击 · 向下', 'Attack · Down'],
    ['attack_up', 'advancedLockAttackUp', '攻击 · 向上', 'Attack · Up'],
    ['attack_left', 'advancedLockAttackLeft', '攻击 · 向左', 'Attack · Left'],
    ['attack_right', 'advancedLockAttackRight', '攻击 · 向右', 'Attack · Right'],
    ['hurt', 'advancedLockHurt', '受伤', 'Hurt'],
    ['happy', 'advancedLockHappy', '开心', 'Happy'],
    ['sit', 'advancedLockSit', '坐下', 'Sit'],
    ['talk', 'advancedLockTalk', '说话', 'Talk'],
  ]
  for (const [id, key, zh, en] of background) {
    assert.match(selectMarkup(html, 'character-advanced-background-mode'), new RegExp(`value="${id}"[^>]*data-character-advanced-copy="${key}"[^>]*>${zh}<`))
    assert.match(view, new RegExp(`${key}: '${escapeRegExp(en)}'`))
  }
  for (const [id, key, zh, en] of outline) {
    assert.match(selectMarkup(html, 'character-advanced-outline-mode'), new RegExp(`value="${id}"[^>]*data-character-advanced-copy="${key}"[^>]*>${zh}<`))
    assert.match(view, new RegExp(`${key}: '${escapeRegExp(en)}'`))
  }
  for (const [value, key, zh, en] of animationLocks) {
    assert.match(view, new RegExp(`\\['${value}', '${key}'\\]`))
    assert.match(view, new RegExp(`${key}: '${escapeRegExp(zh)}'`))
    assert.match(view, new RegExp(`${key}: '${escapeRegExp(en)}'`))
  }
  assert.match(view, /option\.value = name/)
  assert.match(view, /option\.dataset\.characterAdvancedCopy = copyKey/)
  assert.doesNotMatch(view, /option\.textContent = name/)
  assert.match(view, /advancedFrameOption: 'Frame \{index\}'/)
  assert.match(view, /advancedFrameOption: '帧 \{index\}'/)
  assert.match(view, /for \(let index = 0; index < 64; index \+= 1\)/)
  assert.match(view, /option\.value = String\(index\)/)
  assert.match(view, /node\.textContent = localT\('advancedFrameOption'/)
  assert.match(view, /selectedOptions[^\n]*map\(\(option\) => option\.value\)/)
  assert.match(view, /backgroundMode: byId\('character-advanced-background-mode'\)\?\.value/)
  assert.match(view, /pixelFinishingOutlineMode: byId\('character-advanced-outline-mode'\)\?\.value/)
})

test('Studio advanced local UI follows the Current Figma states without legacy controllers or new APIs', async () => {
  const [html, css, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
  ])
  const characterOpening = html.match(/<div\s+id="studio-character-view"[\s\S]*?>/)?.[0] ?? ''
  const currentSource = characterOpening.match(/data-design-source="([^"]+)"/)?.[1] ?? ''
  const inventorySource = characterOpening.match(/data-design-inventory="([^"]+)"/)?.[1] ?? ''
  assert.match(currentSource, /971\:4596/)
  for (const nodeId of ['971:4831', '971:5066']) {
    assert.match(inventorySource, new RegExp(nodeId.replace(':', '\\:')))
    assert.doesNotMatch(currentSource, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const id of [
    'character-advanced-config',
    'character-advanced-calibration',
    'character-advanced-cuts',
    'character-advanced-black-file',
    'character-advanced-layout',
    'character-local-primary',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /value="fixed_region_motion_v0"[^>]*selected/)
  assert.match(html, /id="character-local-profile-title"[^>]*>固定区域动作源图/)
  assert.match(html, /id="character-local-file"[^>]*image\/jpeg/)
  assert.doesNotMatch(html, /id="character-advanced-entry"/)
  assert.doesNotMatch(html, /id="character-advanced-run"/)
  assert.doesNotMatch(html, /id="character-advanced-back-standard"/)
  assert.doesNotMatch(html, /id="character-advanced-config"[^>]*hidden/)
  assert.match(html, /id="character-local-stage-title" tabindex="-1"/)
  assert.doesNotMatch(html, /class="character-local-advanced"|data-character-local-copy="advanced(?:Help|Cleanup|Anchor|Motion|Export)?"/)
  assert.doesNotMatch(css, /\.character-local-advanced/)
  assert.doesNotMatch(view, /advanced: 'Advanced defaults'|advanced: '高级默认值'|advancedHelp:|advancedCleanup:|advancedAnchor:|advancedMotion:|advancedExport:/)
  for (const id of [
    'character-advanced-component-cleanup',
    'character-advanced-pixel-finishing',
    'character-advanced-outline',
    'character-advanced-auto-correct',
    'character-advanced-motion-stabilize',
  ]) assert.match(html, new RegExp(`id="${id}" class="studio-checkbox" type="checkbox"`))
  assert.match(css, /\.studio-checkbox \{[^}]*appearance: none[^}]*width: 16px !important[^}]*height: 16px !important[^}]*border: 1px solid #2e3340[^}]*border-radius: 3px[^}]*background: #222633/s)
  assert.match(css, /\.character-advanced-checks label:has\(\.studio-checkbox\) \{[^}]*font-size: 12px/)
  assert.match(css, /\.studio-checkbox:checked \{[^}]*background: var\(--brand\)/)
  assert.match(css, /\.studio-checkbox:checked::after \{[^}]*opacity: 1/)
  assert.match(css, /\.studio-checkbox:focus-visible \{[^}]*outline: 2px solid #3d8dbf/)
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*\.studio-checkbox \{ appearance: auto/)
  for (const id of [
    'character-advanced-export-1x',
    'character-advanced-export-2x',
    'character-advanced-export-3x',
    'character-advanced-export-4x',
  ]) assert.match(html, new RegExp(`id="${id}" type="checkbox"`))
  assert.match(html, /id="character-advanced-export-1x"[^>]*checked/)
  assert.match(html, /id="character-advanced-export-2x"[^>]*checked/)
  assert.doesNotMatch(html, /id="character-advanced-export-[34]x"[^>]*checked/)
  assert.doesNotMatch(html, /id="character-advanced-export-\dx" class="studio-checkbox"/)
  assert.match(css, /\.character-advanced-scales label \{[^}]*width: 64px[^}]*height: 28px[^}]*border-radius: 14px[^}]*background: #252526/)
  assert.match(css, /\.character-advanced-scales input \{[^}]*clip: rect\(0, 0, 0, 0\)/)
  assert.match(css, /\.character-advanced-scales label:has\(:checked\) \{[^}]*background: #264f78/)
  assert.match(html, /class="character-local-panel"[\s\S]*id="character-advanced-config" class="character-advanced-config"[\s\S]*id="character-local-primary"/)
  assert.doesNotMatch(html, /id="character-advanced-config"[^>]*character-advanced-overlay/)
  assert.match(css, /\.character-local-workspace \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\)/)
  assert.doesNotMatch(css, /data-character-advanced-panel="config"/)
  assert.match(css, /\.character-advanced-config \.character-advanced-scroll \{[^}]*position: relative[^}]*inset: auto/)
  assert.doesNotMatch(view, /primary\.hidden/)
  assert.match(view, /processingMode: 'advanced'/)
  assert.match(html, /class="character-advanced-actions character-local-operator-tools" hidden/)
  assert.match(html, /id="character-advanced-calibration-open"/)
  assert.match(html, /id="character-advanced-cuts-open"/)
  assert.match(html, /id="character-advanced-auto-grid"/)
  assert.match(css, /\.character-local-operator-tools,\s*#character-advanced-calibration,\s*#character-advanced-cuts \{[^}]*display: none !important/)
  assert.match(view, /setHidden\('character-advanced-calibration', panel !== 'calibration'\)/)
  assert.doesNotMatch(view, /setHidden\('character-advanced-config'/)
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
  assert.match(view, /queueMicrotask\(\(\) => byId\('character-advanced-title'\)\?\.focus\(\)\)/)
  assert.match(view, /queueMicrotask\(\(\) => byId\(headingId\)\?\.focus\(\)\)/)
  assert.match(view, /state\.binding\?\.inputKey !== currentKey/)
  assert.match(view, /componentCleanup: inputChecked\('character-advanced-component-cleanup', true\)/)
  assert.match(view, /pixelFinishing: inputChecked\('character-advanced-pixel-finishing', false\)/)
  assert.match(view, /pixelFinishingOutline: inputChecked\('character-advanced-outline', true\)/)
  assert.match(view, /autoCorrect: inputChecked\('character-advanced-auto-correct', true\)/)
  assert.match(view, /motionStabilize: inputChecked\('character-advanced-motion-stabilize', true\)/)
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
