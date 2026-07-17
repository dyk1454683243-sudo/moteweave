import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { processSheetBuffer } from '../../src/character-pack/processSheet.js'
import * as editorProject from '../../src/editor-project/index.js'

const {
  createDefaultCharacterProcessingRecipe,
  recipeToCharacterProcessingOptions,
  validateCharacterWorkbenchRecipe,
  validateProcessingRecipe,
} = editorProject

function mutateRecipe(mutate) {
  const recipe = createDefaultCharacterProcessingRecipe()
  mutate(recipe)
  return recipe
}

const workbenchBlockingCases = [
  {
    name: 'pipeline contract',
    code: 'unknown_pipeline_contract',
    mutate: (recipe) => { recipe.pipeline_contract = 'character_pack_process_v2' },
  },
  {
    name: 'requested alpha cleanup',
    code: 'unsupported_workbench_background_mode',
    mutate: (recipe) => { recipe.background.mode = 'alpha_cleanup' },
  },
  {
    name: 'background tolerance 81',
    code: 'invalid_background_tolerance',
    mutate: (recipe) => { recipe.background.tolerance = 81 },
  },
  {
    name: 'minimum alpha 81',
    code: 'invalid_cleanup_min_alpha',
    mutate: (recipe) => { recipe.cleanup.min_alpha = 81 },
  },
  {
    name: 'minimum area 65',
    code: 'invalid_cleanup_min_area',
    mutate: (recipe) => { recipe.cleanup.min_area = 65 },
  },
  {
    name: 'minimum area ratio 0.251',
    code: 'invalid_cleanup_min_area_ratio',
    mutate: (recipe) => { recipe.cleanup.min_area_ratio = 0.251 },
  },
  {
    name: 'motion shift 5',
    code: 'invalid_motion_max_shift',
    mutate: (recipe) => { recipe.correction.motion_max_shift = 5 },
  },
  {
    name: 'style report off',
    code: 'style_report_required',
    mutate: (recipe) => { recipe.style_report.enabled = false },
  },
  {
    name: 'non-canonical output sizes',
    code: 'invalid_output_frame_sizes',
    mutate: (recipe) => { recipe.outputs = { frame_sizes: [96, 64, 32, 16] } },
  },
  {
    name: 'non-character target',
    code: 'workbench_requires_character_pack',
    mutate: (recipe) => { recipe.target_pipeline = 'motion_source' },
  },
  {
    name: 'invalid implementation revision',
    code: 'invalid_implementation_revision',
    mutate: (recipe) => { recipe.implementation_revision = 'build id with spaces' },
  },
  {
    name: 'enabled fixed-region staging',
    code: 'workbench_staging_must_be_disabled',
    mutate: (recipe) => {
      recipe.fixed_region_staging = {
        enabled: true,
        mode: 'fixed_region_256_crop',
        stage_size: 256,
        crop_right: 4,
        crop_bottom: 4,
        matte_tolerance: 40,
      }
    },
  },
  {
    name: 'anchor x outside Workbench range',
    code: 'invalid_anchor_x',
    mutate: (recipe) => { recipe.anchor_offset.x = 17 },
  },
]

for (const { name, code, mutate } of workbenchBlockingCases) {
  test(`Character Workbench blocks ${name} with ${code}`, () => {
    const result = validateCharacterWorkbenchRecipe(mutateRecipe(mutate))

    assert.equal(result.status, 'fail')
    assert.ok(result.blocking_errors.includes(code), JSON.stringify(result.blocking_errors))
  })
}

const nonStringImplementationRevisions = [
  { name: 'number', value: 123 },
  { name: 'boolean', value: true },
  { name: 'array', value: ['build_1'] },
]

for (const { name, value } of nonStringImplementationRevisions) {
  test(`Character Workbench rejects ${name} implementation revisions`, () => {
    const recipe = createDefaultCharacterProcessingRecipe()
    recipe.implementation_revision = value

    const result = validateCharacterWorkbenchRecipe(recipe)

    assert.ok(
      result.blocking_errors.includes('invalid_implementation_revision'),
      JSON.stringify(result.blocking_errors),
    )
  })
}

test('Character Workbench accepts a validated string implementation revision', () => {
  const recipe = createDefaultCharacterProcessingRecipe()
  recipe.implementation_revision = 'build_1'

  const result = validateCharacterWorkbenchRecipe(recipe)

  assert.equal(result.status, 'pass', JSON.stringify(result.blocking_errors))
})

test('generic processing-recipe validation preserves a documented non-character target', () => {
  const recipe = createDefaultCharacterProcessingRecipe()
  recipe.target_pipeline = 'motion_source'
  recipe.pipeline_contract = 'motion_source_process_v0'
  delete recipe.fixed_region_staging
  delete recipe.style_report
  recipe.outputs = { frame_sizes: [32] }

  const result = validateProcessingRecipe(recipe)

  assert.equal(result.status, 'pass', JSON.stringify(result.blocking_errors))
  assert.equal(result.metrics.output_frame_size_count, 1)
})

test('generic processing-recipe validation rejects an absolute source file name', () => {
  const recipe = createDefaultCharacterProcessingRecipe()
  recipe.source.file_name = '/absolute/source.png'

  const result = validateProcessingRecipe(recipe)

  assert.ok(result.blocking_errors.includes('unsafe_source_file_name'))
})

const invalidGenericOutputCases = [
  { name: 'legacy scales', outputs: { scales: [1, 0] } },
  { name: 'frame sizes', outputs: { frame_sizes: [96, 0] } },
]

for (const { name, outputs } of invalidGenericOutputCases) {
  test(`generic processing-recipe validation rejects invalid ${name}`, () => {
    const recipe = createDefaultCharacterProcessingRecipe()
    recipe.outputs = outputs

    const result = validateProcessingRecipe(recipe)

    assert.ok(result.blocking_errors.includes('invalid_output_scales'))
    assert.equal(result.metrics.output_scale_count, 0)
    assert.equal(result.metrics.output_frame_size_count, 0)
  })
}

function recipeWithStyleBudgets({ pixelFinishingEnabled, pixelMaxColors = 8, styleMaxColors }) {
  return createDefaultCharacterProcessingRecipe({
    createdFrom: {
      pixel_finishing: { enabled: pixelFinishingEnabled, max_colors: pixelMaxColors },
      style_report: { enabled: true, max_colors: styleMaxColors },
    },
  })
}

const styleBudgetValidationCases = [
  {
    name: 'finishing enabled with lower style budget',
    pixelFinishingEnabled: true,
    styleMaxColors: 4,
    expectedCode: 'style_report_budget_must_match_pixel_finishing',
  },
  {
    name: 'finishing enabled with higher style budget',
    pixelFinishingEnabled: true,
    styleMaxColors: 32,
    expectedCode: 'style_report_budget_must_match_pixel_finishing',
  },
  {
    name: 'finishing enabled with matching budget',
    pixelFinishingEnabled: true,
    styleMaxColors: 8,
  },
  {
    name: 'finishing disabled with lower report-only budget',
    pixelFinishingEnabled: false,
    styleMaxColors: 4,
  },
  {
    name: 'finishing disabled with higher report-only budget',
    pixelFinishingEnabled: false,
    styleMaxColors: 32,
  },
]

for (const { name, pixelFinishingEnabled, styleMaxColors, expectedCode } of styleBudgetValidationCases) {
  test(`Character Workbench validates ${name}`, () => {
    const recipe = recipeWithStyleBudgets({ pixelFinishingEnabled, styleMaxColors })

    const result = validateCharacterWorkbenchRecipe(recipe)

    if (expectedCode) {
      assert.equal(result.status, 'fail')
      assert.ok(result.blocking_errors.includes(expectedCode), JSON.stringify(result.blocking_errors))
    } else {
      assert.equal(result.status, 'pass', JSON.stringify(result.blocking_errors))
    }
  })
}

test('dual matte mapping requires a separately resolved managed black matte buffer', () => {
  const recipe = createDefaultCharacterProcessingRecipe({
    blackMatteArtifactRef: 'workspace/assets/hero-black.png',
    createdFrom: { background: { mode: 'dual_matte' } },
  })

  assert.throws(
    () => recipeToCharacterProcessingOptions(recipe),
    /dual_matte requires a resolved managed black matte/,
  )

  const blackSourceBuffer = Buffer.from('managed-black-matte')
  const options = recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer })
  assert.equal(options.blackSourceBuffer, blackSourceBuffer)
})

async function createDriftingEightByEightSheet() {
  const cellSize = 8
  const width = cellSize * 8
  const height = cellSize * 8
  const data = new Uint8ClampedArray(width * height * 4)

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const originX = col * cellSize
      const originY = row * cellSize
      const upperBodyX = col % 2 === 0 ? 1 : 2
      for (let y = 0; y <= 4; y++) {
        for (let x = upperBodyX; x < upperBodyX + 5; x++) {
          const offset = ((originY + y) * width + originX + x) * 4
          data[offset] = 42
          data[offset + 1] = 108
          data[offset + 2] = 74
          data[offset + 3] = 255
        }
      }
      for (let y = 5; y < cellSize; y++) {
        const offset = ((originY + y) * width + originX + 3) * 4
        data[offset] = 42
        data[offset + 1] = 108
        data[offset + 2] = 74
        data[offset + 3] = 255
      }
    }
  }

  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

function recipeWithShift(motionMaxShift) {
  const boundaries = Array.from({ length: 9 }, (_, index) => index * 8)
  return createDefaultCharacterProcessingRecipe({
    createdFrom: {
      background: { mode: 'passthrough', tolerance: 0 },
      grid: { manual_overrides: { columns: boundaries, rows: boundaries } },
      correction: {
        auto_correct: false,
        motion_stabilize: true,
        motion_max_shift: motionMaxShift,
      },
    },
  })
}

function configureRecipeForEightByEightSheet(recipe) {
  const boundaries = Array.from({ length: 9 }, (_, index) => index * 8)
  recipe.background = { mode: 'passthrough', tolerance: 0 }
  recipe.grid.manual_overrides = { columns: boundaries, rows: boundaries }
  recipe.correction.auto_correct = false
  recipe.correction.motion_stabilize = false
  return recipe
}

test('Workbench Recipe motion shift controls real character-sheet stabilization', async () => {
  const sourcePng = await createDriftingEightByEightSheet()

  const off = await processSheetBuffer(
    sourcePng,
    recipeToCharacterProcessingOptions(recipeWithShift(0)),
  )
  const on = await processSheetBuffer(
    sourcePng,
    recipeToCharacterProcessingOptions(recipeWithShift(2)),
  )

  assert.equal(off.debugReport.normalization.motion_stabilization.applied_count, 0)
  assert.ok(on.debugReport.normalization.motion_stabilization.applied_count > 0)
  assert.ok(on.debugReport.normalization.motion_stabilization.corrections.some(({ dx, dy }) => dx !== 0 || dy !== 0))
})

test('Workbench style budgets remain pipeline-effective across finishing and report-only modes', async () => {
  const sourcePng = await createDriftingEightByEightSheet()
  const finishingRecipe = configureRecipeForEightByEightSheet(recipeWithStyleBudgets({
    pixelFinishingEnabled: true,
    styleMaxColors: 8,
  }))
  assert.equal(validateCharacterWorkbenchRecipe(finishingRecipe).status, 'pass')

  const finishingOptions = recipeToCharacterProcessingOptions(finishingRecipe)
  const finishing = await processSheetBuffer(sourcePng, finishingOptions)

  assert.equal(finishingOptions.pixelFinishingMaxColors, 8)
  assert.equal(finishingOptions.styleMaxColors, 8)
  assert.equal(finishing.debugReport.pixel_style.mode, 'pixel_finishing_v1')
  assert.equal(finishing.debugReport.pixel_style.palette.max_colors, 8)
  assert.ok(finishing.debugReport.pixel_style.palette.colors.length <= 8)

  for (const styleMaxColors of [4, 32]) {
    const reportOnlyRecipe = configureRecipeForEightByEightSheet(recipeWithStyleBudgets({
      pixelFinishingEnabled: false,
      styleMaxColors,
    }))
    assert.equal(validateCharacterWorkbenchRecipe(reportOnlyRecipe).status, 'pass')

    const reportOnly = await processSheetBuffer(
      sourcePng,
      recipeToCharacterProcessingOptions(reportOnlyRecipe),
    )

    assert.equal(reportOnly.debugReport.pixel_style.mode, 'report_only')
    assert.equal(reportOnly.debugReport.pixel_style.palette.max_colors, styleMaxColors)
    assert.ok(reportOnly.debugReport.pixel_style.palette.colors.length <= styleMaxColors)
    assert.equal(reportOnly.debugReport.pixel_style.output_mutation, 'none')
  }
})
