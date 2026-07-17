# Character Finishing Workbench v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-free, non-destructive Character Finishing Workbench to `/editor` that builds one real local Character Pack preview and accepts that exact job as an immutable child revision.

**Architecture:** Keep Recipe drafting, canonicalization, hashing, preview freshness, and acceptance policy in pure Editor modules. Route server-owned source resolution and reprocessing through the existing shared Character Pack queue, write Recipe/context evidence beside standard artifacts, and serialize every formal project mutation behind one project-keyed lock. Extract the Repair UI from `shell.js` into a focused Canvas workbench with a full-height Recipe panel and a bottom horizontal filmstrip while preserving the existing AI Action Repair flow.

**Tech Stack:** Node.js ESM, `node:test`, existing `sharp` and Character Pack pipeline, plain DOM/CSS, Canvas 2D, Web Crypto, existing local HTTP server and Editor project store; no new runtime dependency.

---

## Execution Contract

- Approved design: `docs/superpowers/specs/2026-07-10-character-finishing-workbench-v1-design.md` at commit `b17080e481dc6c9409612906e9a8d45043d4f360`.
- Design ancestors: `36eefaf` Visual Repair Workspace, `58176ce` Editor shell module split, and `89cf7b2` Editor Canvas Playtest MVP.
- Before implementation, read `AGENTS.md`, `docs/guardrails/ui-implementation-guardrails.md`, `docs/guardrails/editor-workspace-guardrails.md`, the approved design, and this entire plan.
- Use `superpowers:using-git-worktrees` before Task 1. Create `codex/character-finishing-workbench-v1` from the plan-bearing `main`; verify that `b17080e` is an ancestor. Do not implement directly on `main`.
- The existing untracked `.superpowers/` directory and `* 2.js` / `* 2.md` files are unrelated user files. Never stage, edit, move, or delete them.
- Do not scan `output/`, `generated/`, or unrelated artifact directories. Tests may create isolated temporary generated/workspace roots.
- Do not modify protected Character Pack processing files, validators, failure taxonomy, providers, exporters, profiles, or the job-status enum. In particular, do not edit `src/character-pack/processSheet.js` or any module it calls. This plan may import and exercise those modules as existing dependencies.
- Do not copy code, UI, wording, or assets from an external product. No new attribution is expected because this is an original implementation using only repository-owned behavior and existing dependencies. If execution adds any outside dependency or algorithm, stop and update `ATTRIBUTIONS.md` only after explicit scope approval.
- Treat every numbered task as an Editor phase. Before each commit, run its
  focused tests and the complete `npm test` suite, and record the actual
  pass/fail count. Tasks 2, 8, 9, 10, and 11 touch `src/ui/`, so they must also
  run `npm run smoke:local` before commit. Do not advance on a failure.
- Complete one task, inspect `git status --short`, stage only that task's named files, and make the listed semantic commit before continuing.

## Capability Truth And Fixed Deviations

| Item | v1 truth |
| --- | --- |
| Local Preview | Real provider-free Character Pack processing job; one click creates one job. |
| Accept | Imports the already-previewed job; never processes twice. |
| Fixed-region staging | Read-only provenance and canonicalized off because managed `source.png` is post-staging. |
| Pixel Grid Refinement | Hidden or disabled as `Coming later`; no active control. |
| `dual_matte` | Active only in original-source mode with a validated managed black-matte file resolved to a Buffer. |
| Output sizes | Fixed `[96, 64, 48, 32, 16]`; no active v1 control. |
| AI Action Repair | Existing quota-confirmed provider flow remains separate and collapsed. |
| Desktop Repair layout | Focused Repair mode temporarily hides Asset Library and global Inspector to give the approved Canvas/Recipe/filmstrip layout enough width; leaving Repair restores both. This is a recorded shell adaptation. |
| Mobile Repair layout | Recipe becomes an accessible drawer; precise drag editing may recommend a pointer device. |
| Resizing/virtualization | No splitters, user-resizable filmstrip, or sequence virtualization in v1. |

## Parameter Binding Table

Every processing value must be present in this table and covered by a binding test. A newly discovered option requires a documented contract decision before it can reach `processSheetBuffer()`.

| Concern | Recipe or server source | Processing option | v1 value/control |
| --- | --- | --- | --- |
| Asset name | project asset | `name` | Server-derived, read-only. |
| Description | managed `metadata.json` | `description` | Server-derived through a safe allowlist. |
| Runtime profile | validated asset plus managed metadata/animations | `profile` | Server-resolved registered profile. |
| Creation time | preview job clock | `createdAt` | Server timestamp. |
| Source provenance | parent metadata plus chosen managed input | `source` | Server-built `derived_revision`. |
| Generation provenance | parent metadata | `generation` | Sanitized allowlist; no prompt or secret. |
| Source layout | `source.source_layout` | `sourceLayout` | Immutable identity. |
| Background | `background.mode` | `backgroundMode` | `auto`, `passthrough`, `flood`, `edge_palette`, conditional `dual_matte`; reject requested `alpha_cleanup`. |
| Tolerance | `background.tolerance` | `backgroundTolerance` | Integer `0..80`, default `24`. |
| Black matte | managed artifact reference | `blackSourceBuffer` | Resolved Buffer only. |
| Component cleanup | `cleanup.component_cleanup` | `componentCleanup` | Boolean, default `true`. |
| Minimum alpha | `cleanup.min_alpha` | `cleanupMinAlpha` | Integer `0..80`, default `18`. |
| Minimum area | `cleanup.min_area` | `componentCleanupMinArea` | Integer `1..64`, default `4`. |
| Minimum ratio | `cleanup.min_area_ratio` | `componentCleanupMinAreaRatio` | Number `0..0.25`, default `0`. |
| Fixed staging | canonical disabled object | `fixedRegionSourceStaging` and tuning fields | Always `off` with null tuning fields. |
| Cut lines | `grid.manual_overrides` | `manualOverrides` | Compatible uniform grid only. |
| Anchor | `anchor_offset` | `anchorOffset` | Integer x/y `-16..16`. |
| Frame nudge | `frame_adjustments` | `frameAdjustments` | Valid frame keys, integer dx/dy `-16..16`. |
| Locked clips | `locked_animations` | `lockedAnimations` | Unique profile-ordered ids. |
| Auto correction | `correction.auto_correct` | `autoCorrect` | Boolean, default `true`. |
| Motion stabilization | `correction.motion_stabilize` | `motionStabilize` | Boolean, default `true`. |
| Motion max shift | `correction.motion_max_shift` | `motionStabilizationMaxShift` | Integer `0..4`, default `2`. |
| Pixel finishing | `pixel_finishing.enabled` | `pixelFinishing` | Boolean, default `false`. |
| Palette budget | `pixel_finishing.max_colors` | `pixelFinishingMaxColors` | Integer `1..256`, default `16`. |
| Outline | `pixel_finishing.outline` | `pixelFinishingOutline` | Boolean, active with finishing. |
| Outline mode | `pixel_finishing.outline_mode` | `pixelFinishingOutlineMode` | `outer`, `inner`, `both`, `none`. |
| Style report | `style_report.enabled` | `styleReport` | Forced `true`. |
| Style budget | `style_report.max_colors` | `styleMaxColors` | Integer `1..256`, default `16`. |
| Output sizes | `outputs.frame_sizes` | `outputFrameSizes` | Exact `[96,64,48,32,16]`. |
| Matte residue cleanup | documented fixed default | `matteResidueCleanup`, `matteResidueTolerance`, `matteResiduePasses` | `true`, `40`, `2`. |
| Edge decontamination | documented fixed default | `edgeDecontamination`, `edgeDecontaminationMaxDistance`, `edgeDecontaminationStrength` | `true`, `112`, `0.55`. |
| Outline color | documented fixed default | `pixelFinishingOutlineColor` | `[24,24,32]`. |
| Source preprocessing | documented fixed default | `sourcePreprocess` | `true`. |
| Prompt | no Recipe field | `promptText` | Never supplied. |
| Style enforcement | unsupported | none | No control and no silent option. |
| Pixel Grid Refinement | unsupported by this processing entry | none | Hidden/disabled. |

## File Structure

### New production modules

- `src/editor-project/repairRecipe.js` — migration, active-revision rebinding, draft updates, source-aware canonicalization, and diagnostics.
- `src/editor-project/repairRecipeSerialization.js` — browser-safe recursive-key canonicalization and UTF-8 bytes with no Node-only import.
- `src/editor-project/repairRecipeHash.js` — synchronous server SHA-256 adapter over shared canonical bytes.
- `src/editor-project/repairState.js` — preview status, freshness, acceptance, and filmstrip selection models.
- `src/editor-project/characterReprocessService.js` — provider-free shared-queue job execution and standard artifact/evidence writing.
- `src/editor-project/characterReprocessCoordinator.js` — managed source/metadata resolution, Recipe authority, submission, and exact-job acceptance checks.
- `src/ui/editor/repairHash.js` — browser Web Crypto digest over the shared canonical bytes.
- `src/ui/editor/artifactClient.js` — controlled Editor/generated artifact loading and decode cache.
- `src/ui/editor/repairPreviewLifecycle.js` — selection token, polling, cancellation, and late-result protection.
- `src/ui/editor/repairComparisonRenderer.js` — Canvas frame extraction, comparison modes, overlays, zoom/pan, and nearest-neighbor drawing.
- `src/ui/editor/repairEvidence.js` — pure quality metric and diagnostic normalization.
- `src/ui/editor/repairWorkbenchPanel.js` — stable DOM mount, Recipe controls, filmstrip, actions, drawer, and ARIA state.
- `src/ui/editor/repairWorkbenchController.js` — local session loading, draft validation, preview hydration, playback, and exact Accept orchestration; keeps `shell.js` below its size guard.

### Existing production files to modify

- `src/editor-project/constants.js`, `recipes.js`, `validation.js`, `index.js`
- `src/editor-project/paths.js`, `projectStore.js`, `artifactRegistry.js`, `apiHandler.js`
- `server.js`
- `src/ui/editor/state.js`, `api.js`, `shell.js`, `editor.css`
- `docs/protocols/processing-recipe-v0.md`
- `docs/protocols/local-api-boundaries.md`
- `docs/protocols/character-pack-artifacts.md`
- `scripts/smoke-local-ui.mjs`

### New focused tests

- `test/editor-project/editorRepairRecipePipelineBinding.test.js`
- `test/editor-project/editorRepairRecipe.test.js`
- `test/editor-project/editorRepairRecipeHash.test.js`
- `test/editor-project/editorRepairState.test.js`
- `test/editor-project/editorManagedArtifactPaths.test.js`
- `test/editor-project/editorCharacterReprocessService.test.js`
- `test/editor-project/editorCharacterReprocessApi.test.js`
- `test/editor-project/editorCharacterReprocessServerWiring.test.js`
- `test/editor-project/editorRepairArtifactClient.test.js`
- `test/editor-project/editorRepairPreviewLifecycle.test.js`
- `test/editor-project/editorRepairComparisonRenderer.test.js`
- `test/editor-project/editorRepairWorkbenchState.test.js`
- `test/editor-project/editorRepairWorkbenchPanel.test.js`
- `test/editor-project/editorRepairWorkbenchController.test.js`

### Existing tests to extend

- `test/editor-project/editorProjectCore.test.js`
- `test/editor-project/editorProjectStore.test.js`
- `test/editor-project/editorArtifactRegistry.test.js`
- `test/editor-project/editorProjectApi.test.js`
- `test/editor-project/editorShellStructure.test.js`
- `test/localSmokeScript.test.js`

### Closeout record

- `docs/runbooks/character-finishing-workbench-v1.md` — design lineage, deviations, binding audit, test counts, browser evidence, and residual risks.

## Task 1: Make The Recipe Contract Pipeline-Effective

**Files:**

- Modify: `src/editor-project/constants.js`
- Modify: `src/editor-project/recipes.js`
- Modify: `src/editor-project/validation.js`
- Modify: `src/editor-project/index.js`
- Modify: `test/editor-project/editorProjectCore.test.js`
- Create: `test/editor-project/editorRepairRecipePipelineBinding.test.js`
- Modify: `docs/protocols/processing-recipe-v0.md`
- Modify: `docs/protocols/character-pack-artifacts.md`

- [ ] **Step 1: Write failing protocol and adapter tests.**

Add literal assertions that the default Recipe has no `outputs.scales`, always enables style evidence, and maps only live pipeline names:

```js
test('Workbench Recipe maps canonical fields and fixed defaults to live processing options', () => {
  const blackSourceBuffer = Buffer.from('managed-black-matte')
  const recipe = createDefaultCharacterProcessingRecipe({
    sourceJobId: 'job_hero',
    assetId: 'asset_hero',
    createdFrom: {
      correction: { motion_max_shift: 3 },
      outputs: { frame_sizes: [96, 64, 48, 32, 16] },
    },
  })
  const options = recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer })

  assert.deepEqual(recipe.outputs, { frame_sizes: [96, 64, 48, 32, 16] })
  assert.equal(recipe.style_report.enabled, true)
  assert.equal(options.motionStabilizationMaxShift, 3)
  assert.deepEqual(options.outputFrameSizes, [96, 64, 48, 32, 16])
  assert.equal(options.blackSourceBuffer, blackSourceBuffer)
  assert.deepEqual(options.pixelFinishingOutlineColor, [24, 24, 32])
  assert.equal(options.matteResidueCleanup, true)
  assert.equal(options.matteResidueTolerance, 40)
  assert.equal(options.matteResiduePasses, 2)
  assert.equal(options.edgeDecontamination, true)
  assert.equal(options.edgeDecontaminationMaxDistance, 112)
  assert.equal(options.edgeDecontaminationStrength, 0.55)
  assert.equal(options.sourcePreprocess, true)
  assert.equal(options.promptText, undefined)
  assert.equal('motionMaxShift' in options, false)
  assert.equal('outputScales' in options, false)
})
```

Add table-driven Workbench-validator cases for `pipeline_contract`, requested
`alpha_cleanup`, tolerance `81`, minimum alpha `81`, minimum area `65`, ratio
`0.251`, motion shift `5`, style report off, and a non-canonical output-size
list. Every case must assert its stable blocking code. Add a regression proving
the protocol-level `validateProcessingRecipe()` does not reject a documented
non-character target merely because it lacks Character Workbench-only style,
staging, or output constraints.

- [ ] **Step 2: Run the focused test and confirm failure.**

Run:

```bash
node --test test/editor-project/editorProjectCore.test.js test/editor-project/editorRepairRecipePipelineBinding.test.js
```

Expected: FAIL because the default still emits `outputs.scales`, the adapter emits disconnected names, and validation accepts domains forbidden by the Workbench.

- [ ] **Step 3: Replace disconnected constants and adapter fields.**

Add immutable constants and make the adapter require the orchestrator-resolved black matte:

```js
export const CHARACTER_REPAIR_OUTPUT_FRAME_SIZES = Object.freeze([96, 64, 48, 32, 16])
export const CHARACTER_RECIPE_INPUT_BACKGROUND_MODES = Object.freeze([
  'auto',
  'passthrough',
  'flood',
  'dual_matte',
  'edge_palette',
])
export const IMPLEMENTATION_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
```

`recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer = null } = {})` must emit `motionStabilizationMaxShift`, `outputFrameSizes`, the fixed defaults from the binding table, and no `promptText`. It must never turn `source.black_matte_artifact_ref` into `blackSourceBuffer` itself.

Replace the mapper body with this complete return object:

```js
export function recipeToCharacterProcessingOptions(recipe, { blackSourceBuffer = null } = {}) {
  if (recipe.background.mode === 'dual_matte' && (!recipe.source.black_matte_artifact_ref || !Buffer.isBuffer(blackSourceBuffer))) {
    throw new TypeError('dual_matte requires a resolved managed black matte')
  }
  return {
    sourceLayout: recipe.source.source_layout,
    backgroundMode: recipe.background.mode,
    backgroundTolerance: recipe.background.tolerance,
    blackSourceBuffer,
    matteResidueCleanup: true,
    matteResidueTolerance: 40,
    matteResiduePasses: 2,
    edgeDecontamination: true,
    edgeDecontaminationMaxDistance: 112,
    edgeDecontaminationStrength: 0.55,
    sourcePreprocess: true,
    componentCleanup: recipe.cleanup.component_cleanup,
    cleanupMinAlpha: recipe.cleanup.min_alpha,
    componentCleanupMinArea: recipe.cleanup.min_area,
    componentCleanupMinAreaRatio: recipe.cleanup.min_area_ratio,
    fixedRegionSourceStaging: 'off',
    fixedRegionStageSize: null,
    fixedRegionCropRight: null,
    fixedRegionCropBottom: null,
    fixedRegionMatteTolerance: null,
    manualOverrides: clonePlain(recipe.grid.manual_overrides),
    anchorOffset: clonePlain(recipe.anchor_offset),
    frameAdjustments: clonePlain(recipe.frame_adjustments),
    lockedAnimations: [...recipe.locked_animations],
    autoCorrect: recipe.correction.auto_correct,
    motionStabilize: recipe.correction.motion_stabilize,
    motionStabilizationMaxShift: recipe.correction.motion_max_shift,
    pixelFinishing: recipe.pixel_finishing.enabled,
    pixelFinishingMaxColors: recipe.pixel_finishing.max_colors,
    pixelFinishingOutline: recipe.pixel_finishing.outline,
    pixelFinishingOutlineMode: recipe.pixel_finishing.outline_mode,
    pixelFinishingOutlineColor: [24, 24, 32],
    styleReport: true,
    styleMaxColors: recipe.style_report.max_colors,
    outputFrameSizes: [...CHARACTER_REPAIR_OUTPUT_FRAME_SIZES],
  }
}
```

- [ ] **Step 4: Add a Character Workbench validator without narrowing the generic protocol.**

Keep `validateProcessingRecipe()` as the common protocol/safety validator and
add `validateCharacterWorkbenchRecipe(recipe, context = {})` for route-level
strictness. The Workbench validator requires `target_pipeline ===
'character_pack'`, `pipeline_contract === 'character_pack_process_v1'`,
`implementation_revision` to be null or a validated server build id,
Workbench input modes only, all numeric domains from the binding table,
`style_report.enabled === true`, and the exact output-size list. Keep
source-size/profile-dependent checks for Task 2. The route and acceptance path
must call the strict validator; future documented targets retain the generic
validator.

Add this strict wrapper after `validateProcessingRecipe()`; the existing
`makeResult()` and `pushUnique()` helpers remain private in the same file:

```js
// Replace the generic validator's legacy outputs-only block with this
// compatibility branch before adding the strict Workbench wrapper.
const hasLegacyScales = Array.isArray(recipe.outputs?.scales) && recipe.outputs.scales.every(isPositiveInteger)
const hasFrameSizes = Array.isArray(recipe.outputs?.frame_sizes) && recipe.outputs.frame_sizes.every(isPositiveInteger)
if (!hasLegacyScales && !hasFrameSizes) pushUnique(errors, 'invalid_output_scales')

// Generic result metrics preserve legacy information and expose the public
// frame-size format without requiring either target to use the other.
return makeResult(errors, warnings, {
  output_scale_count: hasLegacyScales ? recipe.outputs.scales.length : 0,
  output_frame_size_count: hasFrameSizes ? recipe.outputs.frame_sizes.length : 0,
})

export function validateCharacterWorkbenchRecipe(recipe) {
  const protocol = validateProcessingRecipe(recipe)
  const errors = [...protocol.blocking_errors]
  const warnings = [...protocol.warnings]

  if (recipe?.target_pipeline !== 'character_pack') pushUnique(errors, 'workbench_requires_character_pack')
  if (recipe?.pipeline_contract !== CHARACTER_PROCESSING_CONTRACT) pushUnique(errors, 'unknown_pipeline_contract')
  if (
    recipe?.implementation_revision !== null &&
    !IMPLEMENTATION_REVISION_PATTERN.test(String(recipe?.implementation_revision ?? ''))
  ) pushUnique(errors, 'invalid_implementation_revision')
  if (!CHARACTER_RECIPE_INPUT_BACKGROUND_MODES.includes(recipe?.background?.mode)) {
    pushUnique(errors, 'unsupported_workbench_background_mode')
  }
  if (!Number.isInteger(recipe?.background?.tolerance) || recipe.background.tolerance < 0 || recipe.background.tolerance > 80) {
    pushUnique(errors, 'invalid_background_tolerance')
  }
  if (!Number.isInteger(recipe?.cleanup?.min_alpha) || recipe.cleanup.min_alpha < 0 || recipe.cleanup.min_alpha > 80) {
    pushUnique(errors, 'invalid_cleanup_min_alpha')
  }
  if (!Number.isInteger(recipe?.cleanup?.min_area) || recipe.cleanup.min_area < 1 || recipe.cleanup.min_area > 64) {
    pushUnique(errors, 'invalid_cleanup_min_area')
  }
  if (!isFiniteNumber(recipe?.cleanup?.min_area_ratio) || recipe.cleanup.min_area_ratio < 0 || recipe.cleanup.min_area_ratio > 0.25) {
    pushUnique(errors, 'invalid_cleanup_min_area_ratio')
  }
  if (!Number.isInteger(recipe?.correction?.motion_max_shift) || recipe.correction.motion_max_shift < 0 || recipe.correction.motion_max_shift > 4) {
    pushUnique(errors, 'invalid_motion_max_shift')
  }
  const staging = recipe?.fixed_region_staging
  if (
    staging?.enabled !== false ||
    staging?.mode !== null ||
    staging?.stage_size !== null ||
    staging?.crop_right !== null ||
    staging?.crop_bottom !== null ||
    staging?.matte_tolerance !== null
  ) pushUnique(errors, 'workbench_staging_must_be_disabled')
  for (const axis of ['x', 'y']) {
    const value = recipe?.anchor_offset?.[axis]
    if (!Number.isInteger(value) || value < -16 || value > 16) pushUnique(errors, `invalid_anchor_${axis}`)
  }
  if (recipe?.style_report?.enabled !== true) pushUnique(errors, 'style_report_required')
  if (JSON.stringify(recipe?.outputs?.frame_sizes) !== JSON.stringify(CHARACTER_REPAIR_OUTPUT_FRAME_SIZES)) {
    pushUnique(errors, 'invalid_output_frame_sizes')
  }
  return makeResult(errors, warnings, { output_frame_size_count: recipe?.outputs?.frame_sizes?.length ?? 0 })
}
```

- [ ] **Step 5: Add a real stabilization behavior test without editing the pipeline.**

Build a controlled drifting 8x8 sheet in the new test, pass the Recipe adapter output to the existing `processSheetBuffer()`, and assert the real debug report differs between max shift `0` and `2`:

```js
const off = await processSheetBuffer(sourcePng, recipeToCharacterProcessingOptions(recipeWithShift(0)))
const on = await processSheetBuffer(sourcePng, recipeToCharacterProcessingOptions(recipeWithShift(2)))

assert.equal(off.debugReport.normalization.motion_stabilization.applied_count, 0)
assert.ok(on.debugReport.normalization.motion_stabilization.applied_count > 0)
assert.ok(on.debugReport.normalization.motion_stabilization.corrections.some(({ dx, dy }) => dx !== 0 || dy !== 0))
```

Generate the fixture in memory with `sharp`, set `auto_correct` false in both
Recipes so the stabilization stage owns the observed correction, and do not
add a binary fixture or modify `src/character-pack/*`.

- [ ] **Step 6: Update protocol docs in the same verified unit.**

Replace `outputs.scales` / `outputScales` with `outputs.frame_sizes` / `outputFrameSizes`, record the legacy migration diagnostic, live numeric domains, conditional `dual_matte`, rejected requested `alpha_cleanup`, fixed staging-off rule, fixed defaults, and the two-hash ownership model. Mark only the Character Workbench portion active after the code and tests pass.

- [ ] **Step 7: Run focused tests and contract hygiene.**

Run:

```bash
node --test test/editor-project/editorProjectCore.test.js test/editor-project/editorRepairRecipePipelineBinding.test.js
npm test
git diff --check
```

Expected: focused and full suites PASS; record the full-suite count. The
behavior test proves `motionStabilizationMaxShift` reaches the real pipeline,
the non-character regression stays green, and no protected pipeline file
changed.

- [ ] **Step 8: Commit the contract unit.**

```bash
git status --short
git add src/editor-project/constants.js src/editor-project/recipes.js src/editor-project/validation.js src/editor-project/index.js test/editor-project/editorProjectCore.test.js test/editor-project/editorRepairRecipePipelineBinding.test.js docs/protocols/processing-recipe-v0.md docs/protocols/character-pack-artifacts.md
git commit -m "feat: bind repair recipes to character processing"
```

## Task 2: Add Draft Migration, Canonicalization, Hashing, And Pure State

**Files:**

- Create: `src/editor-project/repairRecipe.js`
- Create: `src/editor-project/repairRecipeSerialization.js`
- Create: `src/editor-project/repairRecipeHash.js`
- Create: `src/editor-project/repairState.js`
- Modify: `src/editor-project/index.js`
- Create: `src/ui/editor/repairHash.js`
- Create: `test/editor-project/editorRepairRecipe.test.js`
- Create: `test/editor-project/editorRepairRecipeHash.test.js`
- Create: `test/editor-project/editorRepairState.test.js`

- [ ] **Step 1: Write failing draft construction and migration tests.**

Cover these exact cases:

- no historical Recipe uses documented defaults and active revision identity;
- a valid historical Recipe inherits only editable sections, rebinds the current asset/job/layout/file/black-matte identity, forces staging off, style report on, implementation revision null, and remains clean;
- `outputs.scales` produces `[96,64,48,32,16]` plus `legacy_output_scales_migrated`, without reinterpreting the old scale values;
- normalized-sheet fallback uses authoritative `topdown_rpg_v0`, disables manual cut lines and `dual_matte`, and records `normalized_sheet_fallback`;
- a resolved fixed-region source layout requires `grid.manual_overrides: null`, emits `manual_grid_unavailable_for_fixed_regions`, and never forwards cut lines;
- update patches cannot change immutable source identity;
- source-aware validation rejects malformed cut boundaries, invalid frame keys, out-of-range nudges, unknown locked animations, and conditional `dual_matte` violations; duplicate known locks canonicalize to one profile-ordered entry.

Use the public boundary exactly:

```js
const draft = createRepairRecipeDraft({
  asset,
  revision,
  loadedRecipe,
  sourceContext: {
    inputMode: 'managed_source',
    sourceLayout: 'topdown_rpg_v0',
    sourceLayoutKind: 'uniform_grid',
    sourceSize: { width: 768, height: 768 },
    sourceFileName: 'source.png',
    blackMatteArtifactRef: null,
  },
})

assert.equal(draft.recipe.source.asset_id, 'asset_hero')
assert.equal(draft.recipe.source.source_job_id, 'job_parent')
assert.deepEqual(draft.recipe.fixed_region_staging, {
  enabled: false,
  mode: null,
  stage_size: null,
  crop_right: null,
  crop_bottom: null,
  matte_tolerance: null,
})
assert.equal(draft.dirty, false)
assert.equal(draft.fieldOrigins['background.tolerance'], loadedRecipe ? 'inherited' : 'default')
assert.equal(draft.fieldOrigins['style_report.enabled'], 'forced')
assert.equal(draft.fieldOrigins['fixed_region_staging'], 'provenance')
```

- [ ] **Step 2: Write failing full/settings hash golden vectors.**

The test fixture must be a literal plain object, not output from the production factory. Recursively sort object keys, preserve array order, serialize with compact `JSON.stringify`, and hash UTF-8 bytes. Use this complete canonical Recipe:

```js
const CANONICAL_REPAIR_RECIPE = {
  version: 'processing_recipe_v0',
  target_pipeline: 'character_pack',
  pipeline_contract: 'character_pack_process_v1',
  implementation_revision: '8aa1b0d',
  source: {
    file_name: 'source.png',
    source_layout: 'topdown_rpg_v0',
    source_job_id: 'job_hero',
    asset_id: 'asset_hero',
    black_matte_artifact_ref: null,
  },
  background: { mode: 'auto', tolerance: 24 },
  cleanup: { component_cleanup: true, min_alpha: 18, min_area: 4, min_area_ratio: 0 },
  fixed_region_staging: {
    enabled: false,
    mode: null,
    stage_size: null,
    crop_right: null,
    crop_bottom: null,
    matte_tolerance: null,
  },
  grid: { manual_overrides: null },
  anchor_offset: { x: 0, y: 0 },
  frame_adjustments: {},
  locked_animations: [],
  correction: { auto_correct: true, motion_stabilize: true, motion_max_shift: 2 },
  pixel_finishing: { enabled: false, max_colors: 16, outline: true, outline_mode: 'outer' },
  style_report: { enabled: true, max_colors: 16 },
  outputs: { frame_sizes: [96, 64, 48, 32, 16] },
}

assert.equal(
  hashRepairRecipe(serializeCanonicalRecipe(CANONICAL_REPAIR_RECIPE)),
  'd409d6fa4c5bb415e5e31dfb8e15e4323ff5268727a4ef95930ca1604b7f2233'
)
assert.equal(
  hashRepairRecipe(serializeCanonicalRecipe(createDraftSettingsHashInput(CANONICAL_REPAIR_RECIPE))),
  '10460fa71084d4bb10ba9a649c2135fe1ce9c4c5244125fe7c7c42ec135fb782'
)
```

Also assert the browser `hashRepairRecipeBytes()` returns both literals. Run that test only when `globalThis.crypto?.subtle` exists; Node versions used by the repository expose it.

- [ ] **Step 3: Write failing preview and acceptance state tests.**

Exercise `no_preview`, `dirty`, `queued`, `processing`, `ready`, `stale`, `warning`, `blocked_quality`, `failed`, and `accepted`. The critical distinction is:

```js
assert.deepEqual(
  getRepairPreviewFreshness({
    currentDraftSettingsHash: SETTINGS_HASH,
    submittedDraftSettingsHash: SETTINGS_HASH,
    selection,
    submittedSelection: selection,
    job: { status: 'failed_post_processing' },
    artifacts: completeArtifacts,
    validation: { status: 'fail' },
  }),
  { state: 'blocked_quality', fresh: true, inspectable: true }
)
assert.equal(
  getRepairAcceptanceState({
    previewState: 'blocked_quality',
    underlyingJobStatus: 'failed_post_processing',
    qualityStatus: 'fail',
  }).canAccept,
  false
)
```

Add a filmstrip model test for selected-frame bounds, first/last, play/pause, fps duration, and horizontal arrow navigation only when the filmstrip owns focus.

Model warning confirmation as `{ jobId, recipeHash, confirmed }`, not a loose
boolean. Confirming warning job A must not authorize warning job B. A new
Build, preview replacement, draft edit, selection switch, Discard, successful
Accept, or hash mismatch clears confirmation.

- [ ] **Step 4: Run the three new tests and confirm missing-module failure.**

```bash
node --test test/editor-project/editorRepairRecipe.test.js test/editor-project/editorRepairRecipeHash.test.js test/editor-project/editorRepairState.test.js
```

Expected: FAIL because the pure boundaries do not exist.

- [ ] **Step 5: Implement legacy migration.**

Add these exact constants/helpers and migration body to `repairRecipe.js`:

```js
import { CHARACTER_REPAIR_OUTPUT_FRAME_SIZES } from './constants.js'
import { createDefaultCharacterProcessingRecipe } from './recipes.js'
import { clonePlain, isPlainObject } from './safety.js'
import { validateCharacterWorkbenchRecipe } from './validation.js'

const FORCED_STAGING_OFF = Object.freeze({
  enabled: false,
  mode: null,
  stage_size: null,
  crop_right: null,
  crop_bottom: null,
  matte_tolerance: null,
})

const EDITABLE_INHERIT_PATHS = Object.freeze([
  'background.mode',
  'background.tolerance',
  'cleanup.component_cleanup',
  'cleanup.min_alpha',
  'cleanup.min_area',
  'cleanup.min_area_ratio',
  'grid.manual_overrides',
  'anchor_offset.x',
  'anchor_offset.y',
  'frame_adjustments',
  'locked_animations',
  'correction.auto_correct',
  'correction.motion_stabilize',
  'correction.motion_max_shift',
  'pixel_finishing.enabled',
  'pixel_finishing.max_colors',
  'pixel_finishing.outline',
  'pixel_finishing.outline_mode',
  'style_report.max_colors',
])

function hasOwnPath(value, pathValue) {
  let cursor = value
  for (const part of pathValue.split('.')) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, part)) return false
    cursor = cursor[part]
  }
  return true
}

function projectEditableRecipe(source) {
  const projected = {}
  for (const pathValue of EDITABLE_INHERIT_PATHS) {
    if (!hasOwnPath(source, pathValue)) continue
    const parts = pathValue.split('.')
    const value = parts.reduce((cursor, part) => cursor[part], source)
    let target = projected
    for (const part of parts.slice(0, -1)) target = target[part] ??= {}
    target[parts.at(-1)] = clonePlain(value)
  }
  return projected
}

export function migrateCharacterProcessingRecipe(recipe) {
  const source = isPlainObject(recipe) ? clonePlain(recipe) : {}
  const diagnostics = []
  if (Array.isArray(source.outputs?.scales) && !Array.isArray(source.outputs?.frame_sizes)) {
    diagnostics.push('legacy_output_scales_migrated')
  }
  const inheritedPaths = EDITABLE_INHERIT_PATHS.filter((pathValue) => hasOwnPath(source, pathValue))
  const migrated = createDefaultCharacterProcessingRecipe({ createdFrom: projectEditableRecipe(source) })
  migrated.implementation_revision = null
  migrated.fixed_region_staging = clonePlain(FORCED_STAGING_OFF)
  migrated.style_report = {
    enabled: true,
    max_colors: Number.isInteger(source.style_report?.max_colors)
      ? source.style_report.max_colors
      : migrated.pixel_finishing.max_colors,
  }
  migrated.outputs = { frame_sizes: [...CHARACTER_REPAIR_OUTPUT_FRAME_SIZES] }
  return { recipe: migrated, diagnostics, inheritedPaths }
}
```

Run only the migration tests and expect PASS.

- [ ] **Step 6: Implement active-revision rebinding and field origins.**

Add this complete constructor and the literal field-origin surface used by
Task 10's binding table:

```js
const VISIBLE_REPAIR_PATHS = Object.freeze([
  'source.source_layout',
  'background.mode',
  'background.tolerance',
  'cleanup.component_cleanup',
  'cleanup.min_alpha',
  'cleanup.min_area',
  'cleanup.min_area_ratio',
  'fixed_region_staging',
  'grid.manual_overrides',
  'anchor_offset.x',
  'anchor_offset.y',
  'frame_adjustments',
  'locked_animations',
  'correction.auto_correct',
  'correction.motion_stabilize',
  'correction.motion_max_shift',
  'pixel_finishing.enabled',
  'pixel_finishing.max_colors',
  'pixel_finishing.outline',
  'pixel_finishing.outline_mode',
  'style_report.enabled',
  'style_report.max_colors',
  'outputs.frame_sizes',
])

function freezeClone(value) {
  const cloned = clonePlain(value)
  const visit = (item) => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item
    for (const child of Object.values(item)) visit(child)
    return Object.freeze(item)
  }
  return visit(cloned)
}

export function createRepairRecipeDraft({ asset, revision, loadedRecipe, sourceContext }) {
  const migrated = migrateCharacterProcessingRecipe(loadedRecipe)
  const recipe = migrated.recipe
  recipe.source = {
    file_name: sourceContext.sourceFileName,
    source_layout: sourceContext.sourceLayout,
    source_job_id: revision.source_job_id,
    asset_id: asset.id,
    black_matte_artifact_ref: sourceContext.blackMatteArtifactRef ?? null,
  }
  const inheritedManualGrid = clonePlain(recipe.grid.manual_overrides)
  recipe.grid.manual_overrides = sourceContext.inputMode === 'managed_source' && sourceContext.sourceLayoutKind === 'uniform_grid'
    ? inheritedManualGrid
    : null
  if (sourceContext.inputMode === 'normalized_sheet_fallback') migrated.diagnostics.push('normalized_sheet_fallback')
  if (inheritedManualGrid != null && (sourceContext.inputMode !== 'managed_source' || sourceContext.sourceLayoutKind !== 'uniform_grid')) {
    migrated.diagnostics.push('manual_grid_unavailable_for_fixed_regions')
  }
  if (recipe.background.mode === 'dual_matte' && (sourceContext.inputMode !== 'managed_source' || !sourceContext.blackMatteArtifactRef)) {
    recipe.background.mode = 'auto'
    migrated.diagnostics.push('dual_matte_unavailable_for_input')
  }
  const inheritedPaths = new Set(migrated.inheritedPaths)
  const fieldOrigins = Object.fromEntries(VISIBLE_REPAIR_PATHS.map((path) => [path, inheritedPaths.has(path) ? 'inherited' : 'default']))
  fieldOrigins['style_report.enabled'] = 'forced'
  fieldOrigins['outputs.frame_sizes'] = 'forced'
  fieldOrigins.fixed_region_staging = 'provenance'
  fieldOrigins['source.source_layout'] = 'provenance'
  const openingRecipe = freezeClone(recipe)
  return {
    recipe: clonePlain(openingRecipe),
    openingRecipe,
    fieldOrigins: freezeClone(fieldOrigins),
    provenance: freezeClone({ fixedRegionStaging: loadedRecipe?.fixed_region_staging ?? null }),
    diagnostics: [...migrated.diagnostics],
    dirty: false,
    hashStatus: 'pending',
    openingDraftSettingsHash: null,
    currentDraftSettingsHash: null,
  }
}
```

- [ ] **Step 7: Implement one-path draft updates.**

Use `{ path, value }` as the only patch shape; this makes every UI binding
auditable and prevents source identity edits:

```js
const EDITABLE_REPAIR_PATH = /^(background\.(mode|tolerance)|cleanup\.(component_cleanup|min_alpha|min_area|min_area_ratio)|grid\.manual_overrides|anchor_offset\.(x|y)|frame_adjustments\.[0-9]+\.(dx|dy)|locked_animations|correction\.(auto_correct|motion_stabilize|motion_max_shift)|pixel_finishing\.(enabled|max_colors|outline|outline_mode)|style_report\.max_colors)$/

function setPlainPath(target, pathValue, value) {
  const parts = pathValue.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts.at(-1)] = clonePlain(value)
}

export function updateRepairRecipeDraft(draft, patch) {
  if (!isPlainObject(patch) || !EDITABLE_REPAIR_PATH.test(String(patch.path ?? ''))) {
    throw new TypeError('repair patch path is not editable')
  }
  const recipe = clonePlain(draft.recipe)
  const frameMatch = String(patch.path).match(/^frame_adjustments\.([0-9]+)\.(dx|dy)$/)
  if (frameMatch && !isPlainObject(recipe.frame_adjustments[frameMatch[1]])) {
    recipe.frame_adjustments[frameMatch[1]] = { dx: 0, dy: 0 }
  }
  setPlainPath(recipe, patch.path, patch.value)
  recipe.implementation_revision = null
  return { ...draft, recipe, dirty: true, hashStatus: 'pending' }
}

export function applyRepairDraftSettingsHash(draft, hash, { initialize = false } = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(hash ?? ''))) throw new TypeError('draft settings hash is invalid')
  const openingDraftSettingsHash = initialize ? hash : draft.openingDraftSettingsHash
  if (!openingDraftSettingsHash) throw new TypeError('opening draft settings hash is not initialized')
  return {
    ...draft,
    openingDraftSettingsHash,
    currentDraftSettingsHash: hash,
    dirty: hash !== openingDraftSettingsHash,
    hashStatus: 'ready',
  }
}
```

- [ ] **Step 8: Implement source-aware canonicalization.**

Add the strict helpers below; `profile.animations` is the existing ordered
profile array and `profile.grid` supplies the counts:

```js
export class RepairRecipeError extends Error {
  constructor(codes) {
    super(codes.join(','))
    this.name = 'RepairRecipeError'
    this.code = 'invalid_recipe'
    this.codes = [...codes]
  }
}

function canonicalGrid(value, { sourceSize, profile, inputMode, sourceLayoutKind }) {
  if (inputMode !== 'managed_source' || sourceLayoutKind !== 'uniform_grid') {
    if (value != null) throw new RepairRecipeError(['manual_grid_unavailable_for_fixed_regions'])
    return null
  }
  if (value == null) return null
  const axes = [
    ['columns', profile.grid.columns, sourceSize.width],
    ['rows', profile.grid.rows, sourceSize.height],
  ]
  for (const [key, count, end] of axes) {
    const points = value[key]
    if (!Array.isArray(points) || points.length !== count + 1 || points[0] !== 0 || points.at(-1) !== end) {
      throw new RepairRecipeError([`invalid_manual_${key}`])
    }
    if (!points.every(Number.isInteger) || points.some((point, index) => index && point <= points[index - 1])) {
      throw new RepairRecipeError([`invalid_manual_${key}`])
    }
  }
  return { columns: [...value.columns], rows: [...value.rows] }
}

function canonicalFrameAdjustments(value, frameCount) {
  const entries = []
  for (const [key, item] of Object.entries(value ?? {})) {
    const frame = Number(key)
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount || !isPlainObject(item)) {
      throw new RepairRecipeError(['invalid_frame_adjustments'])
    }
    const keys = Object.keys(item).sort()
    if (keys.join(',') !== 'dx,dy' || !Number.isInteger(item.dx) || !Number.isInteger(item.dy) || Math.abs(item.dx) > 16 || Math.abs(item.dy) > 16) {
      throw new RepairRecipeError(['invalid_frame_adjustments'])
    }
    if (item.dx || item.dy) entries.push([String(frame), { dx: item.dx, dy: item.dy }])
  }
  return Object.fromEntries(entries.sort((a, b) => Number(a[0]) - Number(b[0])))
}

export function canonicalizeRepairRecipe(recipe, context) {
  const next = clonePlain(recipe)
  next.grid.manual_overrides = canonicalGrid(next.grid.manual_overrides, context)
  next.frame_adjustments = canonicalFrameAdjustments(next.frame_adjustments, context.profile.grid.columns * context.profile.grid.rows)
  const requestedLocks = new Set(next.locked_animations)
  const orderedIds = context.profile.animations.map((animation) => animation.name)
  if ([...requestedLocks].some((id) => !orderedIds.includes(id))) throw new RepairRecipeError(['unknown_locked_animation'])
  next.locked_animations = orderedIds.filter((id) => requestedLocks.has(id))
  if (next.background.mode === 'dual_matte' && (context.inputMode !== 'managed_source' || !context.hasBlackMatte)) {
    throw new RepairRecipeError(['dual_matte_requires_managed_black_matte'])
  }
  const validation = validateCharacterWorkbenchRecipe(next)
  if (validation.status === 'fail') throw new RepairRecipeError(validation.blocking_errors)
  return next
}

export function withRepairImplementationRevision(canonicalDraftRecipe, implementationRevision) {
  if (canonicalDraftRecipe?.implementation_revision !== null) {
    throw new RepairRecipeError(['draft_implementation_revision_must_be_null'])
  }
  const next = clonePlain(canonicalDraftRecipe)
  next.implementation_revision = implementationRevision
  const validation = validateCharacterWorkbenchRecipe(next)
  if (validation.status === 'fail') throw new RepairRecipeError(validation.blocking_errors)
  return next
}

export function validateRepairRecipeDraft(draft, context) {
  try {
    return { status: 'pass', blocking_errors: [], canonical: canonicalizeRepairRecipe(draft.recipe, context) }
  } catch (error) {
    if (!(error instanceof RepairRecipeError)) throw error
    return { status: 'fail', blocking_errors: [...error.codes], canonical: null }
  }
}
```

- [ ] **Step 9: Implement shared bytes and two platform hash adapters.**

`repairRecipeSerialization.js` owns recursive key sorting and UTF-8 bytes and
has no Node-only import. The Node and browser hash adapters both consume those
shared canonical bytes: `repairRecipeHash.js` uses `node:crypto`, while
`repairHash.js` uses `crypto.subtle.digest('SHA-256', bytes)` plus lower-case hex.
The browser import graph must contain no `node:crypto` reference.

Use these complete modules:

```js
// src/editor-project/repairRecipeSerialization.js
function sortPlain(value) {
  if (Array.isArray(value)) return value.map(sortPlain)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlain(value[key])]))
}

export function serializeCanonicalRecipe(recipe) {
  return new TextEncoder().encode(JSON.stringify(sortPlain(recipe)))
}

export function createDraftSettingsHashInput(recipe) {
  return { ...structuredClone(recipe), implementation_revision: null }
}
```

```js
// src/editor-project/repairRecipeHash.js
import { createHash } from 'node:crypto'

export function hashRepairRecipe(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
```

```js
// src/ui/editor/repairHash.js
export async function hashRepairRecipeBytes(bytes, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 10: Implement pure freshness and acceptance state.**

`getRepairPreviewFreshness()` compares only the server-returned `draft_settings_hash` and the selected project/asset/revision identity. `getRepairAcceptanceState()` requires underlying job status `done`, current freshness, matching full hash, complete artifacts, and pass or explicitly confirmed warning. A fail or missing report never becomes acceptable.

```js
const ACTIVE_REPROCESS_STATUSES = new Set(['planning', 'queued', 'processing', 'post_processing'])
const TERMINAL_REPROCESS_FAILURES = new Set(['failed', 'failed_model_error', 'failed_safety_filter', 'not_found'])

function sameRepairSelection(left, right) {
  return Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
}

export function getRepairPreviewFreshness(input) {
  const fresh = sameRepairSelection(input.selection, input.submittedSelection) &&
    input.currentDraftSettingsHash === input.submittedDraftSettingsHash
  const quality = input.validation?.status ?? 'unknown'
  const complete = input.artifacts?.complete === true
  if (input.accepted === true) return { state: 'accepted', fresh: true, inspectable: true }
  if (!input.job) return { state: input.draftDirty ? 'dirty' : 'no_preview', fresh: false, inspectable: false }
  if (!fresh) return { state: 'stale', fresh: false, inspectable: complete }
  if (input.job.status === 'queued') return { state: 'queued', fresh: true, inspectable: false }
  if (ACTIVE_REPROCESS_STATUSES.has(input.job.status)) return { state: 'processing', fresh: true, inspectable: false }
  if (TERMINAL_REPROCESS_FAILURES.has(input.job.status)) return { state: 'failed', fresh: true, inspectable: complete }
  if (input.job.status === 'failed_post_processing') {
    return complete && quality === 'fail'
      ? { state: 'blocked_quality', fresh: true, inspectable: true }
      : { state: 'failed', fresh: true, inspectable: false }
  }
  if (input.job.status !== 'done' || !complete || !['pass', 'warning'].includes(quality)) {
    return { state: 'failed', fresh: true, inspectable: complete }
  }
  return { state: quality === 'warning' ? 'warning' : 'ready', fresh: true, inspectable: true }
}

export function getRepairAcceptanceState(input) {
  const warningConfirmed = input.warningConfirmation?.confirmed === true &&
    input.warningConfirmation.jobId === input.jobId &&
    input.warningConfirmation.recipeHash === input.recipeHash
  if (input.underlyingJobStatus !== 'done') return { canAccept: false, reason: 'job_not_done' }
  if (input.hashesMatch !== true) return { canAccept: false, reason: 'preview_hash_mismatch' }
  if (input.previewState === 'warning' && !warningConfirmed) return { canAccept: false, reason: 'warning_confirmation_required' }
  if (!['ready', 'warning'].includes(input.previewState)) return { canAccept: false, reason: 'preview_not_acceptable' }
  return { canAccept: true, reason: null }
}

export function getRepairFilmstripDurationMs(frameCount, fps) {
  return Number.isInteger(frameCount) && frameCount > 0 && Number.isFinite(fps) && fps > 0
    ? (frameCount * 1000) / fps
    : 0
}
```

- [ ] **Step 11: Implement the filmstrip reducer.**

```js
export function reduceRepairFilmstrip(state, event) {
  const frames = state.frames
  if (!frames.length) return { ...state, selectedIndex: 0, playing: false }
  if (event.type === 'toggle_play') return { ...state, playing: !state.playing }
  if (event.type === 'first') return { ...state, selectedIndex: 0 }
  if (event.type === 'last') return { ...state, selectedIndex: frames.length - 1 }
  if (event.type === 'select') {
    return { ...state, selectedIndex: Math.max(0, Math.min(frames.length - 1, event.index)) }
  }
  if (event.type === 'tick' && state.playing) {
    return { ...state, selectedIndex: (state.selectedIndex + 1) % frames.length }
  }
  if (event.type === 'arrow' && event.filmstripFocused) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    return { ...state, selectedIndex: Math.max(0, Math.min(frames.length - 1, state.selectedIndex + delta)) }
  }
  return state
}
```

- [ ] **Step 12: Run focused tests and export-surface checks.**

Add only these browser-safe exports to `src/editor-project/index.js`;
coordinator code imports the Node hash adapter directly so it can never leak
into the browser graph:

```js
export * from './repairRecipe.js'
export * from './repairRecipeSerialization.js'
export * from './repairState.js'
```

```bash
node --test test/editor-project/editorRepairRecipe.test.js test/editor-project/editorRepairRecipeHash.test.js test/editor-project/editorRepairState.test.js
npm test
npm run smoke:local
git diff --check
```

Expected: focused/full suites and smoke PASS; record the full-suite count.
Both literal hashes, the fixed-region cut-line rule, warning-confirmation
identity, and every state transition are stable.

- [ ] **Step 13: Commit the pure domain unit.**

```bash
git status --short
git add src/editor-project/repairRecipe.js src/editor-project/repairRecipeSerialization.js src/editor-project/repairRecipeHash.js src/editor-project/repairState.js src/editor-project/index.js src/ui/editor/repairHash.js test/editor-project/editorRepairRecipe.test.js test/editor-project/editorRepairRecipeHash.test.js test/editor-project/editorRepairState.test.js
git commit -m "feat: add repair draft and preview state contracts"
```

## Task 3: Harden Managed And Generated Artifact Resolution

**Files:**

- Modify: `src/editor-project/paths.js`
- Modify: `src/editor-project/apiHandler.js`
- Modify: `server.js`
- Create: `test/editor-project/editorManagedArtifactPaths.test.js`
- Modify: `test/editor-project/editorProjectApi.test.js`
- Modify: `test/editor-project/editorWorkspaceV0Acceptance.test.js`

- [ ] **Step 1: Write failing path-resolution security tests.**

Create isolated roots with `mkdtemp`, one valid regular file, a directory, an absolute path, a traversal path, a missing file, an in-root symlink, and a symlink that targets an outside file. Also replace the entire revision directory and the entire job directory with external symlinks; both must fail because the exact root is itself outside its controlled workspace/generated root. Test both managed revisions and generated jobs:

```js
await assert.rejects(
  resolveManagedRevisionArtifactFile({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    revision: {
      id: 'rev_001',
      artifacts: {
        sheet: 'workspace/projects/project_demo/assets/asset_hero/rev_001/escape.png',
      },
    },
    artifactKey: 'sheet',
    projectRoot: root,
    workspaceRoot,
  }),
  (error) => error.code === 'unsafe_artifact_path'
)
```

Accept an in-root symlink only when `realpath` still lands inside the exact
revision/job root and the target is a regular file. Reject every symlink whose
real target escapes that root. Apply the same rule to API serving and
processing input.

For the HTTP route, create a real project whose revision records one valid
artifact, then assert that exact path returns 200. Assert 400/404 for
`project.json`, `project.backup.json`, `autosave.json`, an unrecorded file in
the same revision directory, a recorded path whose parsed project/asset/
revision identity disagrees with the record, and a forged revision/project.
Access to another legitimate project's recorded artifact is allowed because
this local API has no project-session authorization boundary.

- [ ] **Step 2: Confirm the focused test fails.**

```bash
node --test test/editor-project/editorManagedArtifactPaths.test.js test/editor-project/editorProjectApi.test.js
```

Expected: FAIL because current resolution is lexical/exists-only and accepts directories or escaping symlinks.

- [ ] **Step 3: Implement one shared async containment primitive.**

Add these helpers to `paths.js` (with `realpath` and `stat` imported from
`node:fs/promises`):

```js
function codedPathError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function assertContained(rootPath, candidatePath, code) {
  const relative = path.relative(rootPath, candidatePath)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return candidatePath
  throw codedPathError(code, 'artifact escapes its controlled root')
}

export async function resolveContainedRegularFile({ controlledRootPath, rootPath, candidatePath, errorCode }) {
  const lexicalControlledRoot = path.resolve(controlledRootPath)
  const lexicalRoot = assertContained(lexicalControlledRoot, path.resolve(rootPath), errorCode)
  const lexicalCandidate = assertContained(lexicalRoot, path.resolve(candidatePath), errorCode)
  let realControlledRoot
  let realRoot
  let realCandidate
  try {
    ;[realControlledRoot, realRoot, realCandidate] = await Promise.all([
      realpath(lexicalControlledRoot),
      realpath(lexicalRoot),
      realpath(lexicalCandidate),
    ])
  } catch {
    throw codedPathError('artifact_not_found', 'artifact file does not exist')
  }
  assertContained(realControlledRoot, realRoot, errorCode)
  assertContained(realRoot, realCandidate, errorCode)
  const fileStat = await stat(realCandidate)
  if (!fileStat.isFile()) throw codedPathError(errorCode, 'artifact must be a regular file')
  return realCandidate
}

export async function resolveManagedRevisionArtifactFile({
  projectId,
  assetId,
  revision,
  artifactKey,
  projectRoot = process.cwd(),
  workspaceRoot,
}) {
  const recorded = artifactKey === 'processing_recipe'
    ? revision?.processing_recipe_ref
    : revision?.artifacts?.[artifactKey]
  if (!recorded || !isSafeRelativePath(recorded)) {
    throw codedPathError('unsafe_artifact_path', 'artifact key is not recorded on this revision')
  }
  const paths = resolveManagedAssetRevisionPaths({
    projectId,
    assetId,
    revisionId: revision.id,
    projectRoot,
    workspaceRoot,
  })
  return resolveContainedRegularFile({
    controlledRootPath: workspaceRoot,
    rootPath: paths.revisionDir,
    candidatePath: path.resolve(projectRoot, recorded),
    errorCode: 'unsafe_artifact_path',
  })
}

export async function resolveGeneratedJobArtifactFile({ jobId, fileName, allowedFiles, generatedDir }) {
  if (!allowedFiles?.has(fileName) || !isSafeRelativePath(fileName)) {
    throw codedPathError('unsafe_artifact_path', 'generated artifact is not allowlisted')
  }
  const jobDir = resolveGeneratedJobDir(jobId, { generatedDir })
  return resolveContainedRegularFile({
    controlledRootPath: generatedDir,
    rootPath: jobDir,
    candidatePath: path.resolve(jobDir, fileName),
    errorCode: 'unsafe_artifact_path',
  })
}
```

Export `resolveContainedRegularFile()`, `resolveManagedRevisionArtifactFile()`,
and `resolveGeneratedJobArtifactFile()`. The generic primitive remains an
internal-server boundary used only after a caller has established a registered
workspace claim; browser/API callers never receive a free-path interface. The managed function receives a loaded
revision plus `artifactKey`, selects the path from `revision.artifacts[key]`
or the explicit `processing_recipe_ref` key, and never accepts a free path in
its public interface. It then proves the parsed project/asset/revision match
the requested identity and applies exact-root containment. Generated evidence
resolution requires a known filename/key and containment under that exact job
directory. Neither opens Recipe `source.file_name`.

- [ ] **Step 4: Route the Editor artifact GET helper through the hardened primitive.**

Preserve `/api/editor/artifact?path=...`, but treat `path` only as a lookup
claim. For an asset path, parse project/asset/revision, load that project, and
require an exact match in that revision's artifact values or
`processing_recipe_ref` before hardened resolution. For project-pack exports,
add one process-local `createEditorArtifactAccessRegistry()`; the export route
registers only the exact paths it just minted, and the GET route requires a
registry hit. Inject one registry instance from `server.js`. This preserves
the existing export inspector while denying project/autosave/backup and other
unregistered workspace files.

Remove the now-unused `existsSync` import and replace the paths import in
`apiHandler.js` with this exact block:

```js
import {
  projectRelativePath,
  resolveContainedRegularFile,
  resolveEditorProjectPaths,
  resolveManagedRevisionArtifactFile,
} from './paths.js'
```

Add this registry and resolver to `apiHandler.js`:

```js
export function createEditorArtifactAccessRegistry() {
  const exportedPaths = new Set()
  return Object.freeze({
    register(values) {
      for (const value of values) exportedPaths.add(String(value))
    },
    has(value) {
      return exportedPaths.has(String(value))
    },
  })
}

function findRecordedAssetArtifact(project, claimedPath) {
  for (const asset of Object.values(project.assets ?? {})) {
    for (const revision of Object.values(asset.revisions ?? {})) {
      if (revision.processing_recipe_ref === claimedPath) {
        return { asset, revision, artifactKey: 'processing_recipe' }
      }
      for (const [artifactKey, recorded] of Object.entries(revision.artifacts ?? {})) {
        if (recorded === claimedPath) return { asset, revision, artifactKey }
      }
    }
  }
  return null
}

async function resolveRegisteredWorkspaceArtifact(rawPath, options) {
  const claimedPath = String(rawPath ?? '').replaceAll('\\', '/')
  if (!isSafeRelativePath(claimedPath)) {
    const error = new Error('artifact path must be a safe project-relative path')
    error.code = 'unsafe_artifact_path'
    throw error
  }
  const prefix = projectRelativePath(options.workspaceRoot, { projectRoot: options.projectRoot })
  const match = claimedPath.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/projects/([^/]+)/`))
  if (!match) throw Object.assign(new Error('artifact path is not registered'), { code: 'artifact_not_found' })
  const projectId = match[1]
  const { project } = await loadEditorProject({ projectId, ...options })
  const found = findRecordedAssetArtifact(project, claimedPath)
  if (found) {
    return resolveManagedRevisionArtifactFile({
      projectId,
      assetId: found.asset.id,
      revision: found.revision,
      artifactKey: found.artifactKey,
      ...options,
    })
  }
  if (options.artifactAccessRegistry.has(claimedPath)) {
    return resolveContainedRegularFile({
      controlledRootPath: options.workspaceRoot,
      rootPath: options.workspaceRoot,
      candidatePath: path.resolve(options.projectRoot, claimedPath),
      errorCode: 'unsafe_artifact_path',
    })
  }
  throw Object.assign(new Error('artifact path is not registered'), { code: 'artifact_not_found' })
}
```

Extend the handler options and replace the GET/export snippets exactly:

```js
export async function handleEditorProjectApi(req, res, {
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
  generatedDir = path.join(projectRoot, 'generated'),
  artifactAccessRegistry,
} = {}) {
  if (!artifactAccessRegistry) throw new TypeError('artifactAccessRegistry is required')
}

if (req.method === 'GET' && url.pathname === '/api/editor/artifact') {
  const filePath = await resolveRegisteredWorkspaceArtifact(url.searchParams.get('path'), {
    projectRoot,
    workspaceRoot,
    generatedDir,
    artifactAccessRegistry,
  })
  return sendFile(res, filePath)
}

const exported = await writeEditorProjectPackArtifacts({
  project: loaded.project,
  projectRoot,
  workspaceRoot,
  exportId: body.exportId ?? body.export_id,
  now,
})
artifactAccessRegistry.register(Object.values(exported.artifacts))
return sendJson(res, 200, {
  export: {
    id: exported.export_id,
    status: exported.status,
    artifacts: exported.artifacts,
    urls: artifactUrls(exported.artifacts),
    validation: exported.pack.validationReport,
    review_status: exported.pack.reviewStatus,
  },
})
```

Create exactly one registry per server lifetime. In `server.js`, change the
import and injection to:

```js
import {
  createEditorArtifactAccessRegistry,
  handleEditorProjectApi,
} from './src/editor-project/apiHandler.js'

const editorArtifactAccessRegistry = createEditorArtifactAccessRegistry()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (url.pathname.startsWith('/api/editor/')) {
    return handleEditorProjectApi(req, res, {
      projectRoot: __dirname,
      workspaceRoot: editorWorkspaceDir,
      generatedDir: editorGeneratedDir,
      artifactAccessRegistry: editorArtifactAccessRegistry,
    })
  }
  // unchanged non-Editor routes follow
})
```

Test helpers that construct a server must likewise create one registry before
their request handler and reuse it for all requests; never instantiate it per
request.

- [ ] **Step 5: Re-run security and regression tests.**

```bash
node --test test/editor-project/editorManagedArtifactPaths.test.js test/editor-project/editorProjectApi.test.js test/editor-project/editorWorkspaceV0Acceptance.test.js
npm test
git diff --check
```

Expected: focused/full suites PASS; record the full-suite count. Absolute,
traversal, unknown key, unregistered file, project JSON, directory, missing
file, identity mismatch, and external-symlink targets are rejected, while the
current export inspector regression remains green.

- [ ] **Step 6: Commit the path-safety unit.**

```bash
git status --short
git add src/editor-project/paths.js src/editor-project/apiHandler.js server.js test/editor-project/editorManagedArtifactPaths.test.js test/editor-project/editorProjectApi.test.js test/editor-project/editorWorkspaceV0Acceptance.test.js
git commit -m "fix: harden editor artifact path resolution"
```

## Task 4: Serialize Formal Project Mutations

**Files:**

- Modify: `src/editor-project/projectStore.js`
- Modify: `src/editor-project/apiHandler.js`
- Modify: `test/editor-project/editorProjectStore.test.js`
- Modify: `test/editor-project/editorProjectApi.test.js`

- [ ] **Step 1: Write failing lock and compound-mutation tests.**

Start two `mutateEditorProject()` calls for the same project/revision behind a barrier. Assert exactly one succeeds, one rejects with `revision_conflict`, the persisted revision increments once, and no mutation callback runs against stale state. Also assert different project ids can proceed concurrently.

```js
const results = await Promise.allSettled([
  mutateEditorProject({ projectId: 'project_demo', expectedRevision: 1, projectRoot: root, mutate: renameA }),
  mutateEditorProject({ projectId: 'project_demo', expectedRevision: 1, projectRoot: root, mutate: renameB }),
])

assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
assert.equal((await loadEditorProject({ projectId: 'project_demo', projectRoot: root })).project.revision, 2)
```

- [ ] **Step 2: Run tests and confirm the race.**

```bash
node --test test/editor-project/editorProjectStore.test.js test/editor-project/editorProjectApi.test.js
```

Expected: FAIL because load/import/unlink/delete/save are separate critical sections.

- [ ] **Step 3: Implement a real-root plus project-id keyed in-process lock.**

Export `withEditorProjectMutationLock({ projectId, workspaceRoot }, task)` and
`mutateEditorProject({ projectId, expectedRevision, projectRoot,
workspaceRoot, now, mutate })` as the only public compound-mutation entry
points.

Resolve the workspace root before deriving the key. Keep a private `saveEditorProjectUnlocked()` so public formal saves acquire the lock once and compound mutations do not deadlock. Autosave remains separate and must not increment the formal revision.

Use this complete lock/mutation implementation in `projectStore.js`:

```js
import path from 'node:path'
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'

const projectMutationTails = new Map()

export async function withEditorProjectMutationLock({ projectId, workspaceRoot }, task) {
  await mkdir(workspaceRoot, { recursive: true })
  const key = `${await realpath(workspaceRoot)}\0${projectId}`
  const previous = projectMutationTails.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  projectMutationTails.set(key, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (projectMutationTails.get(key) === tail) projectMutationTails.delete(key)
  }
}

export async function mutateEditorProject({
  projectId,
  expectedRevision,
  projectRoot = process.cwd(),
  workspaceRoot = path.join(projectRoot, 'workspace'),
  now = new Date(),
  mutate,
}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    if (loaded.project.revision !== expectedRevision) {
      throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
        expected_revision: expectedRevision,
        current_revision: loaded.project.revision,
      })
    }
    const nextProject = await mutate(clonePlain(loaded.project))
    return saveEditorProjectUnlocked({
      project: nextProject,
      projectRoot,
      workspaceRoot,
      expectedRevision,
      now,
    })
  })
}
```

Rename the current function body to `saveEditorProjectUnlocked()`. Public
`saveEditorProject()` calls it directly only for autosave; formal saves wrap it
with `withEditorProjectMutationLock()`.

- [ ] **Step 4: Convert formal API mutations to the compound boundary.**

Formal PUT, general import, unlink, delete, and later specialized Accept must acquire the same lock, reload after acquisition, verify expected revision, derive the next project, and save before release. Keep export read-only and keep existing response bodies/statuses stable.

Use this route pattern for each compound mutation; only the pure callback
differs:

```js
const saved = await mutateEditorProject({
  projectId,
  expectedRevision,
  projectRoot,
  workspaceRoot,
  mutate: async (project) => {
    const imported = await importGeneratedJobAsAsset({
      project,
      kind: body.kind,
      jobId: body.jobId ?? body.job_id,
      generatedDir,
      projectRoot,
      workspaceRoot,
      assetId: body.assetId ?? body.asset_id,
      name: body.name,
      productionStatus: body.productionStatus ?? body.production_status,
      readyOverrideReason: body.readyOverrideReason ?? body.ready_override_reason,
    })
    return imported.project
  },
})
```

- [ ] **Step 5: Re-run the focused suite.**

```bash
node --test test/editor-project/editorProjectStore.test.js test/editor-project/editorProjectApi.test.js
npm test
git diff --check
```

Expected: focused/full suites PASS; record the full-suite count. One
concurrent formal mutation wins without deadlock.

- [ ] **Step 6: Commit the mutation unit.**

```bash
git status --short
git add src/editor-project/projectStore.js src/editor-project/apiHandler.js test/editor-project/editorProjectStore.test.js test/editor-project/editorProjectApi.test.js
git commit -m "fix: serialize editor project mutations"
```

## Task 5: Add Exclusive Reprocess Revision Import

**Files:**

- Modify: `src/editor-project/artifactRegistry.js`
- Modify: `test/editor-project/editorArtifactRegistry.test.js`

- [ ] **Step 1: Write failing specialized import tests.**

Create a complete temporary Character Pack job with:

- standard required artifacts;
- `multi_resolution.json` and sheets for 96/64/48/32/16;
- `processing_recipe.json`;
- `editor_reprocess_context.json` whose type is `editor_character_reprocess`.

Assert the specialized importer:

- creates a child of the current active revision;
- copies every known file with no-overwrite semantics;
- when the parent exposes a validated managed black matte, captures that input
  into the accepted child as the dedicated `artifacts.black_matte` entry;
- sets `processing_recipe_ref` to the managed Recipe;
- registers `reprocess_context`, `multi_resolution`, and the five sheet artifacts;
- keeps the source job untouched;
- copies bytes whose SHA-256 values exactly match the verified source manifest;
- rejects a pre-existing target/orphan directory and chooses a later never-existing revision id;
- rejects calls through the general importer when the new context marker is present.

```js
await assert.rejects(
  importGeneratedJobAsAsset({ project, kind: 'character_pack', jobId, generatedDir, projectRoot: root }),
  (error) => error.code === 'specialized_accept_required'
)

const imported = await importAcceptedCharacterReprocessAsAsset({
  project,
  assetId: 'asset_hero',
  jobId,
  generatedDir,
  projectRoot: root,
  workspaceRoot,
  verifiedContext,
  verifiedRecipe,
  verifiedArtifactManifest,
})
assert.equal(imported.revision.parent_revision_id, 'rev_001')
assert.match(imported.revision.processing_recipe_ref, /processing_recipe\.json$/)
assert.match(imported.revision.artifacts.black_matte, /input_black_matte\.png$/)
```

- [ ] **Step 2: Confirm current recursive copy behavior fails the contract.**

```bash
node --test test/editor-project/editorArtifactRegistry.test.js
```

Expected: FAIL because the registry has no specialized context, no exclusive reservation, and can overwrite a revision directory.

- [ ] **Step 3: Extend known Character artifact mappings.**

Add controlled names for `multi_resolution`, `sheet_96`, `sheet_64`, `sheet_48`, `sheet_32`, `sheet_16`, `processing_recipe`, and `reprocess_context`. Continue copying only known files plus existing explicit row/inspection previews.

Extend the literal mapping exactly:

```js
const CHARACTER_REPROCESS_ARTIFACT_FILES = Object.freeze({
  ...CHARACTER_ARTIFACT_FILES,
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  black_matte: 'input_black_matte.png',
  processing_recipe: 'processing_recipe.json',
  reprocess_context: 'editor_reprocess_context.json',
})
```

- [ ] **Step 4: Add exclusive target reservation and copy.**

Choose a revision id absent from both project state and disk. Reserve its final directory with non-recursive exclusive `mkdir`; if it already exists, never reuse it and advance to the next candidate. Write every entry from the Accept-owned, single-read `{ key, content, size, sha256 }` manifest with `flag: 'wx'`, then hash each managed target and require the same size and SHA-256 before returning the next project. Captured bytes—not a second read of a mutable job path—are the import source. A short write or target mismatch throws `artifact_integrity_failed` before project JSON changes. Never delete or reuse the orphaned directory automatically.

Add these complete helpers (import `mkdir`, `readFile`, `realpath`, `stat`,
`writeFile` and `createHash`):

```js
async function assertManagedDirectory({ controlledRoot, directory }) {
  const [realControlledRoot, realDirectory] = await Promise.all([
    realpath(controlledRoot),
    realpath(directory),
  ])
  const relative = path.relative(realControlledRoot, realDirectory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('managed directory escapes workspace'), { code: 'unsafe_artifact_path' })
  }
  return realDirectory
}

async function sha256File(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function reserveRevisionDirectory({ project, asset, projectRoot, workspaceRoot }) {
  const basePaths = resolveManagedAssetRevisionPaths({
    projectId: project.id,
    assetId: asset.id,
    revisionId: 'rev_001',
    projectRoot,
    workspaceRoot,
  })
  await mkdir(basePaths.assetDir, { recursive: true })
  await assertManagedDirectory({ controlledRoot: workspaceRoot, directory: basePaths.assetDir })
  for (let number = 1; number < 1_000_000; number += 1) {
    const revisionId = `rev_${String(number).padStart(3, '0')}`
    if (asset.revisions?.[revisionId]) continue
    const paths = resolveManagedAssetRevisionPaths({
      projectId: project.id,
      assetId: asset.id,
      revisionId,
      projectRoot,
      workspaceRoot,
    })
    try {
      await mkdir(paths.revisionDir)
      await assertManagedDirectory({ controlledRoot: workspaceRoot, directory: paths.revisionDir })
      return { revisionId, paths }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw Object.assign(new Error('no revision id is available'), { code: 'revision_id_exhausted' })
}

async function copyVerifiedManifest({ manifest, paths }) {
  const artifacts = {}
  for (const entry of manifest) {
    const fileName = CHARACTER_REPROCESS_ARTIFACT_FILES[entry.key]
    if (!fileName) throw Object.assign(new Error(`unknown artifact key: ${entry.key}`), { code: 'artifact_integrity_failed' })
    if (!Buffer.isBuffer(entry.content) || entry.content.byteLength !== entry.size) {
      throw Object.assign(new Error('captured artifact size mismatch'), { code: 'artifact_integrity_failed' })
    }
    const capturedHash = createHash('sha256').update(entry.content).digest('hex')
    if (capturedHash !== entry.sha256) throw Object.assign(new Error('captured artifact hash mismatch'), { code: 'artifact_integrity_failed' })
    const targetPath = path.join(paths.revisionDir, fileName)
    await writeFile(targetPath, entry.content, { flag: 'wx' })
    const [targetStat, targetHash] = await Promise.all([stat(targetPath), sha256File(targetPath)])
    if (targetStat.size !== entry.size || targetHash !== entry.sha256) {
      throw Object.assign(new Error('copied artifact hash mismatch'), { code: 'artifact_integrity_failed' })
    }
    artifacts[entry.key] = `${paths.relativeRevisionDir}/${fileName}`
  }
  return artifacts
}
```

- [ ] **Step 5: Add the narrow importer and protect the general one.**

Export `importAcceptedCharacterReprocessAsAsset()` with verified Recipe/context inputs. General `importGeneratedJobAsAsset()` must inspect only the known context filename for the requested job and reject the reprocess marker with `specialized_accept_required`; legacy jobs remain byte-for-byte behavior-compatible. Both marker inspection and specialized import must resolve files through `resolveGeneratedJobArtifactFile()` rather than joining request values directly.

Use this complete specialized importer body:

```js
export async function importAcceptedCharacterReprocessAsAsset({
  project,
  assetId,
  jobId,
  projectRoot = process.cwd(),
  workspaceRoot,
  verifiedContext,
  verifiedRecipe,
  verifiedArtifactManifest,
  now = new Date(),
}) {
  const nextProject = clonePlain(project)
  const asset = nextProject.assets?.[assetId]
  if (!asset || asset.kind !== 'character_pack') {
    throw Object.assign(new Error('character asset not found'), { code: 'asset_not_found' })
  }
  if (asset.active_revision_id !== verifiedContext.parent_revision_id || jobId !== verifiedContext.preview_job_id) {
    throw Object.assign(new Error('accepted job identity changed'), { code: 'asset_revision_conflict' })
  }
  const parentRevision = asset.revisions[asset.active_revision_id]
  if (
    verifiedRecipe.source.asset_id !== assetId ||
    verifiedRecipe.source.source_job_id !== parentRevision.source_job_id ||
    verifiedRecipe.source.source_layout !== verifiedContext.authoritative_source_layout
  ) {
    throw Object.assign(new Error('verified Recipe identity changed'), { code: 'identity_mismatch' })
  }
  const reserved = await reserveRevisionDirectory({ project: nextProject, asset, projectRoot, workspaceRoot })
  const artifacts = await copyVerifiedManifest({ manifest: verifiedArtifactManifest, paths: reserved.paths })
  const metadata = await readImportMetadata('character_pack', reserved.paths.revisionDir)
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const revision = createAssetRevision({
    id: reserved.revisionId,
    sourceJobId: jobId,
    parentRevisionId: asset.active_revision_id,
    createdAt,
    qualityStatus: metadata.quality_status,
    productionStatus: metadata.quality_status === 'pass' ? 'ready' : 'review_required',
    artifacts,
    processingRecipeRef: artifacts.processing_recipe,
  })
  asset.active_revision_id = revision.id
  asset.revisions[revision.id] = revision
  asset.clips = metadata.clips
  return { project: nextProject, asset, revision, source_dir: reserved.paths.revisionDir }
}
```

Before the legacy importer reads metadata, attempt to resolve and parse the
known context filename. If its `job_type` is `editor_character_reprocess`,
throw a coded `specialized_accept_required` error; ignore only
`artifact_not_found`, not malformed context.

Add a test that hashes a source manifest, changes one source file before copy,
and proves the target hash check fails, project JSON is unchanged, and the
orphan directory is never selected by a later import.

At this registry layer, test only the available low-level round trip: import a
verified manifest containing `black_matte`, assert the child owns
`input_black_matte.png`, then pass the copied historical Recipe plus child to
`createRepairRecipeDraft()` and assert its fixed matte ref is rebound to the
child's dedicated `artifacts.black_matte`. Never accept a match against an
arbitrary `Object.values(revision.artifacts)` entry. Task 7 owns the full
Preview → Accept → reopen → Preview integration test after service/coordinator
exist.

- [ ] **Step 6: Re-run registry tests.**

```bash
node --test test/editor-project/editorArtifactRegistry.test.js
npm test
git diff --check
```

Expected: focused/full suites PASS; record the full-suite count, including
post-copy hash verification, orphan no-reuse, and legacy-import regressions.

- [ ] **Step 7: Commit the immutable import unit.**

```bash
git status --short
git add src/editor-project/artifactRegistry.js test/editor-project/editorArtifactRegistry.test.js
git commit -m "feat: import accepted repair jobs immutably"
```

## Task 6: Create The Provider-Free Shared-Queue Reprocess Service

**Files:**

- Create: `src/editor-project/characterReprocessService.js`
- Modify: `src/editor-project/index.js`
- Create: `test/editor-project/editorCharacterReprocessService.test.js`

- [ ] **Step 1: Write failing injected-service tests.**

Use spies for the queue, job store, processor, low-level Character artifact
writer, and evidence writer. Assert:

- `enqueue()` calls the injected process-wide queue exactly once;
- it creates `type: 'editor_character_reprocess'` with public hashes and selection identity;
- the queued function changes status to existing `post_processing`, calls `processSheet(sourceBuffer, effectiveOptions)` once, writes standard artifacts and then evidence once, and preserves the low-level writer's returned terminal status;
- `effectiveOptions.createdAt` equals the new job's `created_at` even when the caller supplied another value;
- the service adds `job_type`, `preview_job_id`, and `submitted_at` after job creation; the caller cannot override them and all three job/context/url identities agree;
- a Recipe with a managed black-matte ref requires a real private Buffer,
  writes `input_black_matte.png` before sealing, and publishes its hash only in
  the integrity manifest; a missing/mismatched Buffer fails before queueing;
- a barrier-held evidence write leaves the public job `post_processing`; terminal status and evidence URLs appear only after both evidence files are complete;
- an evidence write failure publishes `failed_post_processing` with `artifact_integrity_failed`, no Recipe/context URLs, and a state that cannot be interpreted as `blocked_quality`;
- no provider, env, prompt, token, raw Recipe Buffer, source Buffer, or processing options leak into public job state;
- neither source nor black-matte Buffers leak into public job state;
- processor/writer failures map to existing `failed_post_processing` without adding a status;
- a pre-existing job-directory symlink to an external directory fails during
  reservation and leaves the external directory byte-empty;
- service construction has no provider dependency.

```js
const service = createCharacterReprocessService({
  generatedDir,
  jobQueue,
  createJob,
  getJob,
  updateJob,
  processSheet,
  writeCharacterArtifacts,
  writeEvidence,
})
const summary = service.enqueue({
  sourceBuffer,
  processOptions: { ...processOptions, createdAt: 'client-value-must-not-win' },
  canonicalRecipe,
  reprocessContextBase,
})

assert.equal(summary.type, 'editor_character_reprocess')
assert.equal(jobQueue.tasks.length, 1)
assert.equal(summary.sourceBuffer, undefined)
assert.equal(summary.blackSourceBuffer, undefined)
assert.equal(summary.processOptions, undefined)
assert.equal(summary.promptText, undefined)
```

- [ ] **Step 2: Run and confirm the missing service.**

```bash
node --test test/editor-project/editorCharacterReprocessService.test.js
```

Expected: FAIL because `characterReprocessService.js` does not exist.

- [ ] **Step 3: Implement the injected service boundary.**

Expose only `createCharacterReprocessService({ generatedDir, jobQueue,
createJob, getJob, updateJob, processSheet, writeCharacterArtifacts,
writeEvidence })`. Its
returned public methods are `enqueue({ sourceBuffer, processOptions,
canonicalRecipe, reprocessContextBase, blackSourceBuffer })` and
`getJob(jobId)`. `blackSourceBuffer` is private closure data and is required
exactly when the canonical Recipe records a managed black-matte reference.

Also export `writeCharacterReprocessEvidence({ generatedDir, job,
canonicalRecipe, reprocessContext })` from the same module. It resolves the
exact job directory through `resolveGeneratedJobDir()`, writes only the two
fixed evidence filenames with `flag: 'wx'`, and returns their controlled
`/generated/<job-id>/...` URLs. `server.js` injects this function bound to the
real `generatedDir`; no evidence business rule lives in the route handler.

The service owns orchestration, not Recipe validation or path selection. It
creates the job first, then constructs private effective values:

```js
const effectiveOptions = {
  ...processOptions,
  createdAt: job.created_at,
}
const reprocessContext = {
  ...reprocessContextBase,
  job_type: 'editor_character_reprocess',
  preview_job_id: job.id,
  submitted_at: job.created_at,
}
```

`reprocessContextBase` is strict and cannot contain those three server-owned
keys. Capture buffers/options in the queued closure. Call the injected low-level
`writeCharacterPackArtifacts` adapter, which returns status/URLs but does not
update job state. Then write `processing_recipe.json` and
`editor_reprocess_context.json` with exclusive `wx` semantics. Only after both
writes succeed may one final `updateJob` publish `done` or the low-level
`failed_post_processing` plus `processing_recipe_url` and
`reprocess_context_url`. Store only public job type, ids, hashes,
implementation revision, status, artifact URLs, a sealed size/SHA-256 manifest,
reason, and retry hint.

Use this complete service implementation:

```js
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveGeneratedJobDir } from './paths.js'

export const CHARACTER_REPROCESS_INTEGRITY_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  sheet: 'normalized_sheet.png',
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  processing_recipe: 'processing_recipe.json',
  reprocess_context: 'editor_reprocess_context.json',
  zip: 'character_pack.zip',
})

export const CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES = Object.freeze({
  black_matte: 'input_black_matte.png',
})

async function assertGeneratedJobDirectory(generatedDir, jobDir) {
  const [realGenerated, realJob] = await Promise.all([realpath(generatedDir), realpath(jobDir)])
  const relative = path.relative(realGenerated, realJob)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('job directory escapes generated root'), { code: 'unsafe_artifact_path' })
  }
}

async function sealCharacterReprocessArtifacts(jobDir, { hasBlackMatte }) {
  const entries = []
  const files = hasBlackMatte
    ? { ...CHARACTER_REPROCESS_INTEGRITY_FILES, ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  for (const [key, fileName] of Object.entries(files)) {
    const content = await readFile(path.join(jobDir, fileName))
    entries.push({
      key,
      file_name: fileName,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  return entries
}

export async function writeCharacterReprocessEvidence({
  generatedDir,
  job,
  canonicalRecipe,
  reprocessContext,
  blackSourceBuffer = null,
}) {
  const jobDir = resolveGeneratedJobDir(job.id, { generatedDir })
  await assertGeneratedJobDirectory(generatedDir, jobDir)
  const hasBlackMatteRef = Boolean(canonicalRecipe.source.black_matte_artifact_ref)
  if (hasBlackMatteRef !== Buffer.isBuffer(blackSourceBuffer)) {
    throw Object.assign(new Error('black matte evidence does not match Recipe authority'), { code: 'artifact_integrity_failed' })
  }
  if (hasBlackMatteRef) {
    await writeFile(path.join(jobDir, 'input_black_matte.png'), blackSourceBuffer, { flag: 'wx' })
  }
  const recipePath = path.join(jobDir, 'processing_recipe.json')
  const contextPath = path.join(jobDir, 'editor_reprocess_context.json')
  await writeFile(recipePath, `${JSON.stringify(canonicalRecipe, null, 2)}\n`, { flag: 'wx' })
  await writeFile(contextPath, `${JSON.stringify(reprocessContext, null, 2)}\n`, { flag: 'wx' })
  const artifactIntegrityManifest = await sealCharacterReprocessArtifacts(jobDir, { hasBlackMatte: hasBlackMatteRef })
  return {
    processing_recipe_url: `/generated/${job.id}/processing_recipe.json`,
    reprocess_context_url: `/generated/${job.id}/editor_reprocess_context.json`,
    artifact_integrity_manifest: artifactIntegrityManifest,
  }
}

export function createCharacterReprocessService({
  generatedDir,
  jobQueue,
  createJob,
  getJob,
  updateJob,
  processSheet,
  writeCharacterArtifacts,
  writeEvidence,
}) {
  function enqueue({ sourceBuffer, processOptions, canonicalRecipe, reprocessContextBase, blackSourceBuffer = null }) {
    const hasBlackMatteRef = Boolean(canonicalRecipe.source.black_matte_artifact_ref)
    if (hasBlackMatteRef !== Buffer.isBuffer(blackSourceBuffer)) {
      throw Object.assign(new Error('black matte input does not match Recipe authority'), { code: 'invalid_recipe' })
    }
    const job = createJob({
      type: 'editor_character_reprocess',
      project_id: reprocessContextBase.project_id,
      asset_id: reprocessContextBase.asset_id,
      parent_revision_id: reprocessContextBase.parent_revision_id,
      recipe_hash: reprocessContextBase.recipe_hash,
      draft_settings_hash: reprocessContextBase.draft_settings_hash,
      implementation_revision: reprocessContextBase.implementation_revision,
    })
    const effectiveOptions = { ...processOptions, createdAt: job.created_at }
    const reprocessContext = {
      ...reprocessContextBase,
      job_type: 'editor_character_reprocess',
      preview_job_id: job.id,
      submitted_at: job.created_at,
    }
    jobQueue.enqueue(async () => {
      updateJob(job.id, { status: 'post_processing' })
      let phase = 'reservation'
      try {
        const jobDir = resolveGeneratedJobDir(job.id, { generatedDir })
        await mkdir(generatedDir, { recursive: true })
        await mkdir(jobDir)
        await assertGeneratedJobDirectory(generatedDir, jobDir)
        phase = 'processing'
        const result = await processSheet(sourceBuffer, effectiveOptions)
        phase = 'artifacts'
        const written = await writeCharacterArtifacts({ job, result })
        phase = 'evidence'
        const evidenceUrls = await writeEvidence({
          job,
          canonicalRecipe,
          reprocessContext,
          blackSourceBuffer,
        })
        updateJob(job.id, {
          status: written.status,
          ...written.urls,
          ...evidenceUrls,
          reason: written.reason,
          retry_hint: written.retry_hint,
        })
      } catch (error) {
        updateJob(job.id, {
          status: 'failed_post_processing',
          reason: phase === 'evidence' ? 'artifact_integrity_failed' : String(error.message || error),
          retry_hint: 'inspect_editor_character_reprocess',
        })
      }
    }, (error) => {
      updateJob(job.id, {
        status: 'failed_post_processing',
        reason: String(error.message || error),
        retry_hint: 'inspect_editor_character_reprocess',
      })
    })
    return getJob(job.id)
  }
  return Object.freeze({ enqueue, getJob })
}
```

- [ ] **Step 4: Run service tests and verify no provider symbols.**

```bash
node --test test/editor-project/editorCharacterReprocessService.test.js
rg -n "provider|apiKey|api_key|promptText" src/editor-project/characterReprocessService.js
npm test
git diff --check
```

Expected: focused/full suites PASS and the search has no production match;
record the full-suite count. The barrier proves terminal state is published
only after complete evidence.

- [ ] **Step 5: Commit the service unit.**

```bash
git status --short
git add src/editor-project/characterReprocessService.js src/editor-project/index.js test/editor-project/editorCharacterReprocessService.test.js
git commit -m "feat: add local character reprocess service"
```

## Task 7: Add Server Authority, Reprocess API, And Exact Acceptance

**Files:**

- Create: `src/editor-project/characterReprocessCoordinator.js`
- Modify: `src/editor-project/apiHandler.js`
- Modify: `src/editor-project/index.js`
- Modify: `server.js`
- Create: `test/editor-project/editorCharacterReprocessApi.test.js`
- Create: `test/editor-project/editorCharacterReprocessServerWiring.test.js`
- Modify: `test/editor-project/editorProjectApi.test.js`
- Modify: `docs/protocols/local-api-boundaries.md`
- Modify: `docs/protocols/character-pack-artifacts.md`

- [ ] **Step 1: Write failing Preview API authority tests.**

Build a real temporary managed revision with known source, animations, metadata, debug report, optional Recipe, and optional black matte. Inject a fake reprocess service and call:

```http
POST /api/editor/projects/project_demo/assets/asset_hero/reprocess
```

with:

```js
{
  expectedRevision: 1,
  expectedAssetRevisionId: 'rev_001',
  recipe: recipeCandidate,
}
```

Assert 202 plus stable job id, server `recipe_hash`, `draft_settings_hash`, and canonical Recipe echo. Assert the coordinator:

- resolves Recipe, debug report, then animations in source-layout authority order;
- treats a missing, malformed, generic-valid-but-Workbench-invalid, or
  unregistered-layout optional Recipe as a diagnosed fallback (unsafe paths
  still block), and similarly skips an invalid/missing debug layout before
  validating the animations candidate;
- never uses `asset.profile` as the source layout;
- uses managed `source` or labels explicit `normalized_sheet_fallback`;
- captures the selected input once into a Buffer, derives dimensions and
  SHA-256 from those exact bytes, and queues that same Buffer even if the
  managed path is replaced immediately after authority resolution;
- rejects missing/unsafe input, changed asset revision, project conflict, source asset/job/layout mismatch, unknown/conflicting profile, malformed or secret-bearing metadata, and client implementation revision;
- derives `name`, `description`, registered profile, `derived_revision` source, and safe generation fields server-side, while the service binds `createdAt` to the created job timestamp;
- supplies a real Buffer for valid `dual_matte` and rejects raw/reference-string fallbacks;
- resolves black matte only from the active revision's dedicated
  `artifacts.black_matte` key, never by matching an arbitrary artifact value;
- preserves a real pipeline warning when an otherwise valid dual-matte pair is inconsistent instead of rewriting the requested mode;
- never passes prompt/provider configuration.

Include an end-to-end `dual_matte` round-trip fixture: Preview → Accept →
reload the accepted child → Preview again. Both Previews must receive the exact
managed matte bytes, the child must own `artifacts.black_matte`, and the second
canonical Recipe must be rebound to that child ref while the first accepted
Recipe remains byte-exact evidence.

The preview request has the exact top-level key set
`expectedRevision`, `expectedAssetRevisionId`, and `recipe`. Reject unknown or
alias keys rather than ignoring them. Add one negative case for each of
`source_path`, `source_base64`, `providerKey`, `apiKey`, `prompt`, `script`,
`module`, and `options`, at both the request root and a nested Recipe object
where applicable. A rejection occurs before `createJob()`.

Sanitized generation provenance has this exact recursive allowlist; omit all
other non-secret provenance fields and block the entire Preview when any
secret-like key/value is present in required metadata:

```js
const SAFE_GENERATION_FIELDS = {
  scalar: ['mode', 'provider', 'provider_preset_id', 'provider_label', 'model'],
  image_config: ['image_size', 'aspect_ratio'],
  files: ['template_file', 'reference_file', 'palette_file'],
  prompt_contract: ['contract_version', 'layout_id', 'profile', 'profile_id', 'mode'],
}
```

File-like provenance values must be safe basenames, not paths. Never copy
`prompt_file`, prompt text, input image paths, provider attempts, raw response,
headers, tokens, or candidate payloads.

- [ ] **Step 2: Write failing job evidence and status-interpretation tests.**

Assert one queued task writes standard Character Pack artifacts plus exact `processing_recipe.json` and `editor_reprocess_context.json`. The context must contain job type/id, project and submission revision, asset and parent revision, input mode, recorded managed artifact key/reference, authoritative layout, both hashes, and implementation revision. Modify each evidence file after completion and assert later acceptance rejects it.

Define `editor_reprocess_context_v0` as an exact no-extra-key object:

```js
{
  version: 'editor_reprocess_context_v0',
  job_type: 'editor_character_reprocess',
  preview_job_id: 'job_preview',
  submitted_at: '2026-07-10T00:00:00.000Z',
  project_id: 'project_demo',
  project_revision: 1,
  asset_id: 'asset_hero',
  parent_revision_id: 'rev_001',
  input_mode: 'managed_source',
  input_artifact_key: 'source',
  input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_001/source.png',
  input_artifact_sha256: SOURCE_SHA256,
  black_matte_artifact_sha256: null,
  authoritative_source_layout: 'topdown_rpg_v0',
  recipe_hash: RECIPE_HASH,
  draft_settings_hash: SETTINGS_HASH,
  implementation_revision: 'package-0.4.0',
}
```

`input_mode` is `managed_source` or `normalized_sheet_fallback`, and its key
must be `source` or `sheet` respectively. Validate exact types, safe ids/hash
formats, timestamp, cross-field identities, and absence of extra keys. Read
Recipe/context back as strict plain JSON. The Recipe must already equal the
strict Workbench canonical object; if canonicalization would remove, reorder,
default, clamp, or reinterpret a semantic value, reject it instead of silently
accepting a normalized replacement. JSON object property order itself is not
semantic.

The coordinator's `reprocessContextBase` is exactly the same object minus
`job_type`, `preview_job_id`, and `submitted_at`; those keys are forbidden in
the base and added only by the service after `createJob()`.

Assert generated `metadata.json.created_at`, the public job's `created_at`, and
context `submitted_at` are the same timestamp. A request/caller `createdAt`
value must never survive into processing metadata.

For every reprocess job, the base integrity set is exactly: `source.png`,
`source_layout_overlay.png`, `normalized_sheet.png`, `multi_resolution.json`,
`normalized_sheet_96.png`, `normalized_sheet_64.png`,
`normalized_sheet_48.png`, `normalized_sheet_32.png`,
`normalized_sheet_16.png`, `animations.json`, `metadata.json`,
`editor_metadata.json`, `debug_report.json`, `debug_overlay.png`,
`onion_skin_overlay.png`, `processing_recipe.json`,
`editor_reprocess_context.json`, and `character_pack.zip`. When—and only
when—the canonical Recipe records a managed black-matte ref, the exact set
also contains `input_black_matte.png` under the dedicated `black_matte` key;
its presence must agree with the Recipe before acceptance. Optional source
quality, inspection, Row GIF, and engine-export files may be imported only
through existing known mappings, but they do not replace a missing base or
conditional integrity file.

Test `failed_post_processing` twice: complete artifacts plus a valid fail report derives `blocked_quality`; incomplete artifacts derives `failed`. Neither is acceptable.

- [ ] **Step 3: Write failing specialized Accept tests.**

Call:

```http
POST /api/editor/projects/project_demo/assets/asset_hero/reprocess/job_preview/accept
```

with:

```js
{
  expectedRevision: 1,
  expectedAssetRevisionId: 'rev_001',
  expectedRecipeHash: RECIPE_HASH,
  warningConfirmed: false,
}
```

The Accept body allows exactly `expectedRevision`,
`expectedAssetRevisionId`, `expectedRecipeHash`, and `warningConfirmed`; reject
missing, alias, or extra fields before entering the mutation lock.

Cover pass success, warning blocked until confirmation, fail/unknown blocked,
job not `done`, non-reprocess type, context job-id mismatch, full hash mismatch,
`draft_settings_hash` supplied in place of full hash, Recipe/context tampering,
active revision change, current project revision change, copy failure, and save
failure. Every failure leaves project JSON and the old revision byte-identical.

Create two valid jobs whose every integrity file contains a different sentinel.
Fire simultaneous accepts from revision 1 and assert exactly one 200, one 409,
one new project revision, and one immutable child. Compute SHA-256 for every
winning/losing source and managed target; every target must match the winning
job and none may contain losing bytes. Re-hash both source jobs and the parent
revision to prove they did not change.

Add two single-read race tests. First pause before Accept captures bytes, modify
one source job artifact, and require the sealed completion digest comparison to
throw `artifact_integrity_failed` with unchanged project JSON. Then pause after
Accept has captured and verified `{ key, content, size, sha256 }`, modify the
source path, resume, and require the managed target to match the captured
sealed bytes—not the later mutation. Any reserved orphan remains explicit and
never reused or auto-deleted.

Add parent-input races as well: replace the managed source immediately after
Preview authority capture and prove processing still receives the captured
Buffer; then replace the source or black matte after Preview completion but
before Accept and require the context SHA-256 comparison to reject the stale
parent identity without changing project JSON.

- [ ] **Step 4: Write the general-import bypass regression.**

Submit the same reprocess job to `/import-job` and assert `specialized_accept_required`; submit a legacy Character Pack job and assert its existing import response remains successful. The API must reject from the injected job-store `type` even if the generated context file was removed or modified; the registry's context-marker check is defense in depth.

- [ ] **Step 5: Run the API tests and confirm failure.**

```bash
node --test test/editor-project/editorCharacterReprocessApi.test.js test/editor-project/editorProjectApi.test.js
```

Expected: FAIL because neither route nor coordinator exists.

- [ ] **Step 6: Implement strict request, Recipe, context, and metadata schemas.**

Add one coded coordinator error class and pure exact-key helpers. Reject an
unknown key before reading an artifact or creating a job. Implement
`validateEditorReprocessContext()` against the literal schema above and
`sanitizeParentGeneration()` against `SAFE_GENERATION_FIELDS`. Run:

```bash
node --test --test-name-pattern="reprocess envelope|reprocess context|generation allowlist" test/editor-project/editorCharacterReprocessApi.test.js
```

Expected: PASS; rejected envelopes enqueue zero jobs.

Use these exact helpers in `characterReprocessCoordinator.js`:

```js
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { resolveSourceLayout } from '../character-pack/sourceLayouts.js'
import { IMPLEMENTATION_REVISION_PATTERN } from './constants.js'
import { importAcceptedCharacterReprocessAsAsset } from './artifactRegistry.js'
import { resolveGeneratedJobArtifactFile, resolveManagedRevisionArtifactFile } from './paths.js'
import { EditorProjectStoreError, loadEditorProject, mutateEditorProject } from './projectStore.js'
import {
  canonicalizeRepairRecipe,
  createRepairRecipeDraft,
  validateRepairRecipeDraft,
  withRepairImplementationRevision,
} from './repairRecipe.js'
import { hashRepairRecipe } from './repairRecipeHash.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from './repairRecipeSerialization.js'
import { recipeToCharacterProcessingOptions } from './recipes.js'
import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isIsoTimestamp,
  isPlainObject,
  isSafeRelativePath,
  isValidId,
  isValidJobId,
} from './safety.js'
import { validateProcessingRecipe } from './validation.js'

export class CharacterReprocessError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CharacterReprocessError'
    this.code = code
    this.details = details
  }
}

function assertExactKeys(value, allowed, code) {
  if (!isPlainObject(value)) throw new CharacterReprocessError(code, 'expected a plain JSON object')
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw new CharacterReprocessError('unexpected_request_field', 'request contains unsupported fields', { fields: unexpected })
}

function assertPreviewRequest(body) {
  assertExactKeys(body, ['expectedRevision', 'expectedAssetRevisionId', 'recipe'], 'invalid_reprocess_request')
  if (!Number.isInteger(body.expectedRevision)) throw new CharacterReprocessError('invalid_reprocess_request', 'expectedRevision must be an integer')
  if (!isValidId(body.expectedAssetRevisionId)) throw new CharacterReprocessError('invalid_reprocess_request', 'expectedAssetRevisionId is invalid')
  if (body.recipe?.implementation_revision !== null) throw new CharacterReprocessError('invalid_recipe', 'implementation_revision must be null')
  if (findBase64PayloadPaths(body).length || findSecretLikePaths(body).length) {
    throw new CharacterReprocessError('invalid_reprocess_request', 'embedded binary or secret-like fields are forbidden')
  }
  assertRepairRecipeExactKeys(body.recipe)
}

function assertRepairRecipeExactKeys(recipe) {
  assertExactKeys(recipe, [
    'version', 'target_pipeline', 'pipeline_contract', 'implementation_revision',
    'source', 'background', 'cleanup', 'fixed_region_staging', 'grid',
    'anchor_offset', 'frame_adjustments', 'locked_animations', 'correction',
    'pixel_finishing', 'style_report', 'outputs',
  ], 'invalid_recipe')
  assertExactKeys(recipe.source, ['file_name', 'source_layout', 'source_job_id', 'asset_id', 'black_matte_artifact_ref'], 'invalid_recipe')
  assertExactKeys(recipe.background, ['mode', 'tolerance'], 'invalid_recipe')
  assertExactKeys(recipe.cleanup, ['component_cleanup', 'min_alpha', 'min_area', 'min_area_ratio'], 'invalid_recipe')
  assertExactKeys(recipe.fixed_region_staging, ['enabled', 'mode', 'stage_size', 'crop_right', 'crop_bottom', 'matte_tolerance'], 'invalid_recipe')
  assertExactKeys(recipe.grid, ['manual_overrides'], 'invalid_recipe')
  assertExactKeys(recipe.anchor_offset, ['x', 'y'], 'invalid_recipe')
  assertExactKeys(recipe.correction, ['auto_correct', 'motion_stabilize', 'motion_max_shift'], 'invalid_recipe')
  assertExactKeys(recipe.pixel_finishing, ['enabled', 'max_colors', 'outline', 'outline_mode'], 'invalid_recipe')
  assertExactKeys(recipe.style_report, ['enabled', 'max_colors'], 'invalid_recipe')
  assertExactKeys(recipe.outputs, ['frame_sizes'], 'invalid_recipe')
  for (const item of Object.values(recipe.frame_adjustments ?? {})) assertExactKeys(item, ['dx', 'dy'], 'invalid_recipe')
  if (recipe.grid.manual_overrides != null) assertExactKeys(recipe.grid.manual_overrides, ['columns', 'rows'], 'invalid_recipe')
}

function safeBasename(value) {
  if (value == null) return null
  const text = String(value)
  return text === path.posix.basename(text) && isSafeRelativePath(text) ? text : null
}

function sanitizeParentGeneration(metadata) {
  if (findSecretLikePaths(metadata).length) throw new CharacterReprocessError('invalid_managed_metadata', 'managed metadata contains secret-like fields')
  const source = isPlainObject(metadata.generation) ? metadata.generation : {}
  const result = {}
  for (const key of SAFE_GENERATION_FIELDS.scalar) if (source[key] != null) result[key] = String(source[key])
  result.image_config = Object.fromEntries(SAFE_GENERATION_FIELDS.image_config.filter((key) => source.image_config?.[key] != null).map((key) => [key, String(source.image_config[key])]))
  for (const key of SAFE_GENERATION_FIELDS.files) {
    const file = safeBasename(source[key])
    if (file) result[key] = file
  }
  result.prompt_contract = Object.fromEntries(SAFE_GENERATION_FIELDS.prompt_contract.filter((key) => source.prompt_contract?.[key] != null).map((key) => [key, String(source.prompt_contract[key])]))
  return result
}

export function validateEditorReprocessContext(value) {
  const keys = [
    'version', 'job_type', 'preview_job_id', 'submitted_at', 'project_id',
    'project_revision', 'asset_id', 'parent_revision_id', 'input_mode',
    'input_artifact_key', 'input_artifact_ref', 'input_artifact_sha256',
    'black_matte_artifact_sha256', 'authoritative_source_layout',
    'recipe_hash', 'draft_settings_hash', 'implementation_revision',
  ]
  assertExactKeys(value, keys, 'invalid_reprocess_context')
  const hash = /^[a-f0-9]{64}$/
  if (
    value.version !== 'editor_reprocess_context_v0' ||
    value.job_type !== 'editor_character_reprocess' ||
    typeof value.preview_job_id !== 'string' ||
    !isValidJobId(value.preview_job_id) ||
    !isIsoTimestamp(value.submitted_at) ||
    !isValidId(value.project_id) ||
    !Number.isInteger(value.project_revision) ||
    !isValidId(value.asset_id) ||
    !isValidId(value.parent_revision_id) ||
    !['managed_source', 'normalized_sheet_fallback'].includes(value.input_mode) ||
    value.input_artifact_key !== (value.input_mode === 'managed_source' ? 'source' : 'sheet') ||
    !isSafeRelativePath(value.input_artifact_ref) ||
    !hash.test(value.input_artifact_sha256) ||
    !(value.black_matte_artifact_sha256 === null || hash.test(value.black_matte_artifact_sha256)) ||
    !hash.test(value.recipe_hash) ||
    !hash.test(value.draft_settings_hash) ||
    !IMPLEMENTATION_REVISION_PATTERN.test(value.implementation_revision)
  ) throw new CharacterReprocessError('invalid_reprocess_context', 'reprocess context failed validation')
  return clonePlain(value)
}
```

- [ ] **Step 7: Implement managed input, layout, profile, and metadata authority.**

Resolve the active revision's valid Recipe, debug report, and animations in
the approved source-layout order. Resolve `source`, then explicit sheet
fallback; read dimensions only after registered-path validation. Validate
asset profile agreement with managed metadata/animations and build safe
description/source/generation provenance. Resolve black matte only from the
selected revision and return a Buffer. Run:

```bash
node --test --test-name-pattern="managed source authority|normalized sheet fallback|dual matte|metadata authority" test/editor-project/editorCharacterReprocessApi.test.js
```

Expected: PASS with no provider or prompt dependency.

Implement the resolver with this body; malformed optional Recipe/layout
evidence falls through to the next authority, while required metadata remains
blocking:

```js
async function readManagedJson({ project, asset, revision, artifactKey, paths }) {
  const filePath = await resolveManagedRevisionArtifactFile({
    projectId: project.id,
    assetId: asset.id,
    revision,
    artifactKey,
    ...paths,
  })
  const text = await readFile(filePath, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new CharacterReprocessError('invalid_managed_metadata', `${artifactKey} is not valid JSON`)
  }
}

async function loadOptionalManagedJson(input) {
  const recorded = input.artifactKey === 'processing_recipe'
    ? input.revision.processing_recipe_ref
    : input.revision.artifacts?.[input.artifactKey]
  if (!recorded) return { value: null, diagnostic: `${input.artifactKey}_missing` }
  try {
    return { value: await readManagedJson(input), diagnostic: null }
  } catch (error) {
    if (!['artifact_not_found', 'invalid_managed_metadata'].includes(error.code)) throw error
    return { value: null, diagnostic: `${input.artifactKey}_${error.code}` }
  }
}

function registeredLayoutCandidate(layoutId, { inputMode, profile }) {
  if (!layoutId) return null
  try {
    const layout = resolveSourceLayout(layoutId)
    if (layout.profile && layout.profile !== profile.id) return null
    if (inputMode === 'normalized_sheet_fallback' && layout.id !== TOPDOWN_RPG_V0.id) return null
    return layout
  } catch {
    return null
  }
}

async function loadValidOptionalParentRecipe({
  project,
  asset,
  revision,
  paths,
  input,
  blackMatteRef,
}) {
  if (!revision.processing_recipe_ref) return { value: null, layout: null, diagnostic: 'processing_recipe_missing' }
  const loaded = await loadOptionalManagedJson({ project, asset, revision, artifactKey: 'processing_recipe', paths })
  if (!loaded.value) return { ...loaded, layout: null }
  if (validateProcessingRecipe(loaded.value).status === 'fail') {
    return { value: null, layout: null, diagnostic: 'processing_recipe_invalid' }
  }
  const layout = registeredLayoutCandidate(loaded.value.source?.source_layout, {
    inputMode: input.inputMode,
    profile: TOPDOWN_RPG_V0,
  })
  if (!layout) return { value: null, layout: null, diagnostic: 'processing_recipe_layout_invalid' }
  const sourceContext = {
    inputMode: input.inputMode,
    sourceLayout: layout.id,
    sourceLayoutKind: layout.kind,
    sourceFileName: path.posix.basename(input.artifactRef),
    sourceSize: input.sourceSize,
    blackMatteArtifactRef: blackMatteRef,
  }
  const reboundDraft = createRepairRecipeDraft({ asset, revision, loadedRecipe: loaded.value, sourceContext })
  const strict = validateRepairRecipeDraft(reboundDraft, {
    profile: TOPDOWN_RPG_V0,
    sourceSize: input.sourceSize,
    inputMode: input.inputMode,
    sourceLayoutKind: layout.kind,
    hasBlackMatte: Boolean(blackMatteRef),
    implementationRevision: null,
  })
  if (strict.status === 'fail') {
    return { value: null, layout: null, diagnostic: 'processing_recipe_workbench_invalid' }
  }
  return { value: loaded.value, layout, diagnostic: loaded.diagnostic }
}

async function resolveAuthoritativeLayout({ project, asset, revision, paths, input, parentRecipeLoad }) {
  if (input.inputMode === 'normalized_sheet_fallback') return TOPDOWN_RPG_V0
  if (parentRecipeLoad.layout) return parentRecipeLoad.layout
  const debugLoad = await loadOptionalManagedJson({ project, asset, revision, artifactKey: 'debug_report', paths })
  const debugLayout = registeredLayoutCandidate(debugLoad.value?.source_layout?.id, {
    inputMode: input.inputMode,
    profile: TOPDOWN_RPG_V0,
  })
  if (debugLayout) return debugLayout
  const animations = await readManagedJson({ project, asset, revision, artifactKey: 'animations', paths })
  const animationLayout = registeredLayoutCandidate(animations.source_layout?.id, {
    inputMode: input.inputMode,
    profile: TOPDOWN_RPG_V0,
  })
  if (animationLayout) return animationLayout
  throw new CharacterReprocessError('missing_source_layout', 'no registered compatible source-layout authority is available')
}

async function resolveManagedReprocessInput({ project, asset, revision, paths }) {
  let inputMode = 'managed_source'
  let artifactKey = 'source'
  if (!revision.artifacts?.source) {
    inputMode = 'normalized_sheet_fallback'
    artifactKey = 'sheet'
  }
  if (!revision.artifacts?.[artifactKey]) throw new CharacterReprocessError('artifact_not_found', 'no managed reprocess input is available')
  const filePath = await resolveManagedRevisionArtifactFile({
    projectId: project.id,
    assetId: asset.id,
    revision,
    artifactKey,
    ...paths,
  })
  const sourceBuffer = await readFile(filePath)
  const image = await sharp(sourceBuffer).metadata()
  if (!image.width || !image.height) throw new CharacterReprocessError('invalid_managed_source', 'managed input has no image dimensions')
  return {
    inputMode,
    artifactKey,
    artifactRef: revision.artifacts[artifactKey],
    filePath,
    sourceBuffer,
    sha256: createHash('sha256').update(sourceBuffer).digest('hex'),
    sourceSize: { width: image.width, height: image.height },
  }
}

async function resolveReprocessAuthority({ project, asset, revision, paths }) {
  if (asset.profile !== TOPDOWN_RPG_V0.id) throw new CharacterReprocessError('unsupported_profile', 'Workbench v1 requires topdown_rpg_v0')
  const [metadata, animations, input] = await Promise.all([
    readManagedJson({ project, asset, revision, artifactKey: 'metadata', paths }),
    readManagedJson({ project, asset, revision, artifactKey: 'animations', paths }),
    resolveManagedReprocessInput({ project, asset, revision, paths }),
  ])
  if (metadata.profile !== asset.profile || animations.profile !== asset.profile) {
    throw new CharacterReprocessError('profile_conflict', 'asset and managed metadata profiles disagree')
  }
  const blackMatteRef = revision.artifacts?.black_matte ?? null
  const blackMattePath = blackMatteRef
    ? await resolveManagedRevisionArtifactFile({ projectId: project.id, assetId: asset.id, revision, artifactKey: 'black_matte', ...paths })
    : null
  const blackSourceBuffer = blackMattePath ? await readFile(blackMattePath) : null
  const parentRecipeLoad = await loadValidOptionalParentRecipe({
    project,
    asset,
    revision,
    paths,
    input,
    blackMatteRef,
  })
  const sourceLayout = await resolveAuthoritativeLayout({
    project,
    asset,
    revision,
    paths,
    input,
    parentRecipeLoad,
  })
  return {
    input,
    sourceLayout,
    profile: TOPDOWN_RPG_V0,
    metadata,
    animations,
    blackMatteRef,
    blackSourceBuffer,
    blackMatteSha256: blackSourceBuffer ? createHash('sha256').update(blackSourceBuffer).digest('hex') : null,
    diagnostics: [parentRecipeLoad.diagnostic].filter(Boolean),
    generation: sanitizeParentGeneration(metadata),
  }
}
```

- [ ] **Step 8: Implement coordinator submission authority.**

Export `createCharacterReprocessCoordinator({ projectRoot, workspaceRoot,
generatedDir, implementationRevision, reprocessService })`. Its public methods
are `submitCharacterReprocessPreview(request)` and
`acceptCharacterReprocessPreview(request)`.

Submission composes the results from Steps 6–7, migrates and canonicalizes the
full Recipe, sets the server build revision, recomputes both hashes, maps
options, and enqueues once with `reprocessContextBase`. It must not set
`createdAt`; the service binds that value to the job clock after job creation.
A validation error prevents job creation. Run the Preview-success test alone
and assert one queue entry plus the exact canonical echo.

Use this factory/submission body:

```js
export function createCharacterReprocessCoordinator({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  reprocessService,
}) {
  const paths = { projectRoot, workspaceRoot }

  async function submitCharacterReprocessPreview({ projectId, assetId, body }) {
    assertPreviewRequest(body)
    const { project } = await loadEditorProject({ projectId, ...paths })
    if (project.revision !== body.expectedRevision) {
      throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
        expected_revision: body.expectedRevision,
        current_revision: project.revision,
      })
    }
    const asset = project.assets?.[assetId]
    if (!asset || asset.kind !== 'character_pack') throw new CharacterReprocessError('asset_not_found', 'character asset not found')
    if (asset.active_revision_id !== body.expectedAssetRevisionId) {
      throw new CharacterReprocessError('asset_revision_conflict', 'active asset revision changed')
    }
    const revision = asset.revisions[asset.active_revision_id]
    const authority = await resolveReprocessAuthority({ project, asset, revision, paths })
    const expectedSource = {
      asset_id: asset.id,
      source_job_id: revision.source_job_id,
      source_layout: authority.sourceLayout.id,
      file_name: path.posix.basename(authority.input.artifactRef),
      black_matte_artifact_ref: authority.blackMatteRef,
    }
    for (const [key, expected] of Object.entries(expectedSource)) {
      if (body.recipe?.source?.[key] !== expected) throw new CharacterReprocessError('identity_mismatch', `Recipe source.${key} changed`)
    }
    const canonicalDraftRecipe = canonicalizeRepairRecipe(body.recipe, {
      profile: authority.profile,
      sourceSize: authority.input.sourceSize,
      inputMode: authority.input.inputMode,
      sourceLayoutKind: authority.sourceLayout.kind,
      hasBlackMatte: Boolean(authority.blackSourceBuffer),
    })
    if (canonicalDraftRecipe.implementation_revision !== null) {
      throw new CharacterReprocessError('invalid_recipe', 'Preview draft implementation_revision must be null')
    }
    const canonicalRecipe = withRepairImplementationRevision(canonicalDraftRecipe, implementationRevision)
    const recipeHash = hashRepairRecipe(serializeCanonicalRecipe(canonicalRecipe))
    const draftSettingsHash = hashRepairRecipe(serializeCanonicalRecipe(createDraftSettingsHashInput(canonicalRecipe)))
    const processOptions = {
      ...recipeToCharacterProcessingOptions(canonicalRecipe, { blackSourceBuffer: authority.blackSourceBuffer }),
      name: asset.name,
      description: String(authority.metadata.description ?? ''),
      profile: authority.profile,
      sourceFileName: path.posix.basename(authority.input.artifactRef),
      source: {
        type: 'derived_revision',
        file_name: path.posix.basename(authority.input.artifactRef),
        parent_project_id: project.id,
        parent_asset_id: asset.id,
        parent_revision_id: revision.id,
        parent_job_id: revision.source_job_id,
      },
      generation: authority.generation,
    }
    const reprocessContextBase = {
      version: 'editor_reprocess_context_v0',
      project_id: project.id,
      project_revision: project.revision,
      asset_id: asset.id,
      parent_revision_id: revision.id,
      input_mode: authority.input.inputMode,
      input_artifact_key: authority.input.artifactKey,
      input_artifact_ref: authority.input.artifactRef,
      input_artifact_sha256: authority.input.sha256,
      black_matte_artifact_sha256: authority.blackMatteSha256,
      authoritative_source_layout: authority.sourceLayout.id,
      recipe_hash: recipeHash,
      draft_settings_hash: draftSettingsHash,
      implementation_revision: implementationRevision,
    }
    const job = reprocessService.enqueue({
      sourceBuffer: authority.input.sourceBuffer,
      blackSourceBuffer: authority.blackSourceBuffer,
      processOptions,
      canonicalRecipe,
      reprocessContextBase,
    })
    return {
      ...job,
      recipe_hash: recipeHash,
      draft_settings_hash: draftSettingsHash,
      canonical_recipe: canonicalRecipe,
    }
  }

  async function acceptCharacterReprocessPreview(request) {
    return acceptVerifiedCharacterReprocess({ ...request, projectRoot, workspaceRoot, generatedDir, reprocessService })
  }

  return Object.freeze({ submitCharacterReprocessPreview, acceptCharacterReprocessPreview })
}
```

- [ ] **Step 9: Implement evidence writing and integrity verification.**

Inject the low-level `writeCharacterPackArtifacts`, not the existing
`server.js::writeJobArtifacts` helper that publishes terminal state. The
service writes standard artifacts, then writes the canonical Recipe/context
exclusively into the same real `generatedDir` job directory served at
`/generated`, then publishes terminal state once. Read both evidence files
back during acceptance, enforce the exact schemas, recompute full/settings
hashes, and compare against the job record, context, and request. Do not use
`editorGeneratedDir` as a hidden second queue output root; pass a separate
`reprocessGeneratedDir: generatedDir` to the Editor handler while retaining
the legacy import directory option.

Run the evidence-order tests and require the job to remain non-terminal at the
writer barrier.

- [ ] **Step 10: Implement exact acceptance inside the shared mutation lock.**

After lock acquisition, reload and repeat all project/revision/job/context/hash/artifact/quality checks. Hash the complete integrity set into the verified manifest, call `importAcceptedCharacterReprocessAsAsset()` with that manifest, require post-copy target hashes to match, and only then save through the unlocked part of `mutateEditorProject()`. Pass uses normal `ready`; warning plus confirmation bound to this job id and full Recipe hash uses `review_required`; fail/unknown never imports. The response returns the saved project, active asset, accepted revision, and `accepted: true`.

Add these helpers and acceptance body:

```js
import {
  CHARACTER_REPROCESS_INTEGRITY_FILES,
  CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
} from './characterReprocessService.js'

function parseManifestJson(manifest, key) {
  const entry = manifest.find((item) => item.key === key)
  if (!entry) throw new CharacterReprocessError('artifact_integrity_failed', `${key} is missing`)
  try {
    return JSON.parse(entry.content.toString('utf8'))
  } catch {
    throw new CharacterReprocessError('artifact_integrity_failed', `${key} is not valid JSON`)
  }
}

async function buildVerifiedArtifactManifest(job, generatedDir) {
  const sealed = new Map((job.artifact_integrity_manifest ?? []).map((entry) => [entry.key, entry]))
  const hasBlackMatte = sealed.has('black_matte')
  const expectedFiles = hasBlackMatte
    ? { ...CHARACTER_REPROCESS_INTEGRITY_FILES, ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  if (
    sealed.size !== Object.keys(expectedFiles).length ||
    [...sealed.keys()].some((key) => !(key in expectedFiles))
  ) {
    throw new CharacterReprocessError('artifact_integrity_failed', 'sealed artifact manifest is incomplete')
  }
  const manifest = []
  for (const [key, fileName] of Object.entries(expectedFiles)) {
    const expected = sealed.get(key)
    if (expected?.file_name !== fileName || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
      throw new CharacterReprocessError('artifact_integrity_failed', 'sealed artifact entry is invalid')
    }
    const sourcePath = await resolveGeneratedJobArtifactFile({
      jobId: job.id,
      fileName,
      allowedFiles: new Set(Object.values(expectedFiles)),
      generatedDir,
    })
    const content = await readFile(sourcePath)
    const sha256 = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== expected.size || sha256 !== expected.sha256) {
      throw new CharacterReprocessError('artifact_integrity_failed', `${fileName} changed after job completion`)
    }
    manifest.push({ key, content, size: expected.size, sha256: expected.sha256 })
  }
  return manifest
}

async function acceptVerifiedCharacterReprocess({
  projectId,
  assetId,
  jobId,
  body,
  projectRoot,
  workspaceRoot,
  generatedDir,
  reprocessService,
}) {
  assertExactKeys(body, ['expectedRevision', 'expectedAssetRevisionId', 'expectedRecipeHash', 'warningConfirmed'], 'invalid_accept_request')
  if (
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    typeof body.expectedAssetRevisionId !== 'string' ||
    !body.expectedAssetRevisionId ||
    !/^[a-f0-9]{64}$/.test(body.expectedRecipeHash) ||
    typeof body.warningConfirmed !== 'boolean'
  ) {
    throw new CharacterReprocessError('invalid_accept_request', 'accept request fields are invalid')
  }
  let acceptedRevisionId = null
  const saved = await mutateEditorProject({
    projectId,
    expectedRevision: body.expectedRevision,
    projectRoot,
    workspaceRoot,
    mutate: async (project) => {
      const asset = project.assets?.[assetId]
      if (!asset) throw new CharacterReprocessError('asset_not_found', 'asset not found')
      if (asset.active_revision_id !== body.expectedAssetRevisionId) {
        throw new CharacterReprocessError('asset_revision_conflict', 'active revision changed')
      }
      const job = reprocessService.getJob(jobId)
      if (!job || job.type !== 'editor_character_reprocess') throw new CharacterReprocessError('job_not_found', 'reprocess job not found')
      if (job.status !== 'done') throw new CharacterReprocessError('quality_blocked', 'only a completed pass/warning job can be accepted')
      if (
        job.project_id !== projectId ||
        job.asset_id !== assetId ||
        job.parent_revision_id !== asset.active_revision_id
      ) throw new CharacterReprocessError('identity_mismatch', 'job identity does not match the active asset')
      const manifest = await buildVerifiedArtifactManifest(job, generatedDir)
      const recipe = parseManifestJson(manifest, 'processing_recipe')
      const context = parseManifestJson(manifest, 'reprocess_context')
      const report = parseManifestJson(manifest, 'debug_report')
      const hasCapturedBlackMatte = manifest.some((entry) => entry.key === 'black_matte')
      if (Boolean(recipe.source?.black_matte_artifact_ref) !== hasCapturedBlackMatte) {
        throw new CharacterReprocessError('artifact_integrity_failed', 'Recipe black matte authority does not match captured artifacts')
      }
      validateEditorReprocessContext(context)
      assertRepairRecipeExactKeys(recipe)
      if (
        context.preview_job_id !== jobId ||
        context.submitted_at !== job.created_at ||
        context.project_id !== projectId ||
        context.project_revision !== project.revision ||
        context.asset_id !== assetId ||
        context.parent_revision_id !== asset.active_revision_id ||
        context.recipe_hash !== job.recipe_hash ||
        context.draft_settings_hash !== job.draft_settings_hash ||
        context.implementation_revision !== job.implementation_revision ||
        context.recipe_hash !== body.expectedRecipeHash
      ) throw new CharacterReprocessError('preview_stale', 'job context no longer matches the project')
      const authority = await resolveReprocessAuthority({
        project,
        asset,
        revision: asset.revisions[asset.active_revision_id],
        paths: { projectRoot, workspaceRoot },
      })
      const canonical = canonicalizeRepairRecipe(recipe, {
        profile: authority.profile,
        sourceSize: authority.input.sourceSize,
        inputMode: authority.input.inputMode,
        sourceLayoutKind: authority.sourceLayout.kind,
        hasBlackMatte: Boolean(authority.blackSourceBuffer),
      })
      if (canonical.implementation_revision !== context.implementation_revision) {
        throw new CharacterReprocessError('identity_mismatch', 'stored implementation revision changed')
      }
      if (
        context.input_mode !== authority.input.inputMode ||
        context.input_artifact_key !== authority.input.artifactKey ||
        context.input_artifact_ref !== authority.input.artifactRef ||
        context.input_artifact_sha256 !== authority.input.sha256 ||
        context.black_matte_artifact_sha256 !== authority.blackMatteSha256 ||
        context.authoritative_source_layout !== authority.sourceLayout.id ||
        canonical.source.asset_id !== asset.id ||
        canonical.source.source_job_id !== asset.revisions[asset.active_revision_id].source_job_id ||
        canonical.source.source_layout !== authority.sourceLayout.id ||
        canonical.source.black_matte_artifact_ref !== authority.blackMatteRef
      ) throw new CharacterReprocessError('identity_mismatch', 'stored input identity changed')
      if (Buffer.compare(Buffer.from(serializeCanonicalRecipe(recipe)), Buffer.from(serializeCanonicalRecipe(canonical))) !== 0) {
        throw new CharacterReprocessError('noncanonical_recipe', 'stored Recipe is not canonical')
      }
      const recipeHash = hashRepairRecipe(serializeCanonicalRecipe(canonical))
      const settingsHash = hashRepairRecipe(serializeCanonicalRecipe(createDraftSettingsHashInput(canonical)))
      if (recipeHash !== context.recipe_hash || settingsHash !== context.draft_settings_hash || recipeHash !== body.expectedRecipeHash) {
        throw new CharacterReprocessError('artifact_integrity_failed', 'Recipe hashes do not match')
      }
      const quality = report.validation?.status ?? 'unknown'
      if (quality === 'warning' && body.warningConfirmed !== true) {
        throw new CharacterReprocessError('warning_confirmation_required', 'warning confirmation is required')
      }
      if (!['pass', 'warning'].includes(quality)) throw new CharacterReprocessError('quality_blocked', 'quality does not allow acceptance')
      const imported = await importAcceptedCharacterReprocessAsAsset({
        project,
        assetId,
        jobId,
        projectRoot,
        workspaceRoot,
        verifiedContext: context,
        verifiedRecipe: canonical,
        verifiedArtifactManifest: manifest,
      })
      acceptedRevisionId = imported.revision.id
      return imported.project
    },
  })
  const asset = saved.project.assets[assetId]
  return {
    project: saved.project,
    asset,
    revision: asset.revisions[acceptedRevisionId],
    accepted: true,
  }
}
```

Run:

```bash
node --test --test-name-pattern="specialized accept|concurrent accepts|verify-to-copy|copy failure|save failure" test/editor-project/editorCharacterReprocessApi.test.js
```

Expected: PASS; every failed path preserves project JSON and exactly one
concurrent request wins.

- [ ] **Step 11: Add controlled HTTP errors without changing legacy statuses.**

Use stable codes and mappings:

| HTTP | Codes |
| --- | --- |
| 400 | `invalid_reprocess_request`, `invalid_recipe`, `invalid_accept_request`, `noncanonical_recipe`, `invalid_reprocess_context`, `unexpected_request_field`, `identity_mismatch`, `unsafe_artifact_path`, `specialized_accept_required` |
| 404 | `project_not_found`, `asset_not_found`, `revision_not_found`, `job_not_found`, `artifact_not_found` |
| 409 | `revision_conflict`, `asset_revision_conflict`, `preview_stale`, `accept_conflict` |
| 422 | `quality_blocked`, `warning_confirmation_required`, `artifact_integrity_failed` |
| 503 | `reprocess_unavailable` |

Keep the existing job status enum and existing endpoint response shapes unchanged.

Add these route branches inside the existing assets block and extend
`statusForError()` with the literal map:

```js
const CHARACTER_REPROCESS_ERROR_STATUS = Object.freeze({
  invalid_reprocess_request: 400,
  invalid_recipe: 400,
  invalid_accept_request: 400,
  noncanonical_recipe: 400,
  invalid_reprocess_context: 400,
  unexpected_request_field: 400,
  identity_mismatch: 400,
  unsafe_artifact_path: 400,
  specialized_accept_required: 400,
  project_not_found: 404,
  asset_not_found: 404,
  revision_not_found: 404,
  job_not_found: 404,
  artifact_not_found: 404,
  revision_conflict: 409,
  asset_revision_conflict: 409,
  preview_stale: 409,
  accept_conflict: 409,
  quality_blocked: 422,
  warning_confirmation_required: 422,
  artifact_integrity_failed: 422,
  reprocess_unavailable: 503,
})

function statusForError(error) {
  if (CHARACTER_REPROCESS_ERROR_STATUS[error?.code]) return CHARACTER_REPROCESS_ERROR_STATUS[error.code]
  if (error?.code === 'invalid_json') return 400
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_not_found') return 404
  if (error instanceof EditorAssetLibraryError && error.code === 'asset_in_use') return 409
  if (error instanceof EditorProjectStoreError && error.code === 'project_not_found') return 404
  if (error instanceof EditorProjectStoreError && error.code === 'revision_conflict') return 409
  return 400
}

if (req.method === 'POST' && parts[6] === 'reprocess' && parts.length === 7) {
  if (!characterReprocessCoordinator) {
    return sendJson(res, 503, { error: 'reprocess_unavailable', reason: 'local character reprocess is unavailable' })
  }
  const body = await readJsonBody(req)
  const result = await characterReprocessCoordinator.submitCharacterReprocessPreview({ projectId, assetId, body })
  return sendJson(res, 202, result)
}

if (req.method === 'POST' && parts[6] === 'reprocess' && parts[7] && parts[8] === 'accept' && parts.length === 9) {
  if (!characterReprocessCoordinator) {
    return sendJson(res, 503, { error: 'reprocess_unavailable', reason: 'local character reprocess is unavailable' })
  }
  const body = await readJsonBody(req)
  const result = await characterReprocessCoordinator.acceptCharacterReprocessPreview({
    projectId,
    assetId,
    jobId: parts[7],
    body,
  })
  return sendJson(res, 200, result)
}
```

Before the existing general import mutation, call `getJob(jobId)` from the
injected reprocess service; if its type is `editor_character_reprocess`, throw
`specialized_accept_required` before copying.

- [ ] **Step 12: Wire only injected dependencies in `server.js`.**

Construct one service from the existing `jobQueue`, `createJob`, `getJob`, `updateJob`, `processSheetBuffer`, and standard artifact writer. Inject coordinator/service plus `generatedDir` into `handleEditorProjectApi()`. Do not create a queue, load provider env, or duplicate job persistence in the Editor handler.

Resolve one implementation build id at server startup, never from the request.
Use `GAMETOOL_BUILD_REVISION`, then `GIT_COMMIT_SHA`, then the checked-in
package version as `package-<version>`. A configured value is trimmed and must
match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`; an explicitly blank, control-
character, or overlong configured value fails startup with
`invalid_implementation_revision` rather than silently falling through. Inject
the fixed value into the coordinator and do not run a Git subprocess per
request. Reuse `IMPLEMENTATION_REVISION_PATTERN`; do not define a second
domain. `editorCharacterReprocessServerWiring.test.js` tests env priority,
fallback, invalid values, reuse of the one existing `jobQueue`, use of the
low-level writer, and absence of another `createJobQueue()` call.

Add this resolver to the coordinator module:

```js
export function resolveImplementationRevision({ env = process.env, packageVersion }) {
  const configuredKey = env.GAMETOOL_BUILD_REVISION != null
    ? 'GAMETOOL_BUILD_REVISION'
    : env.GIT_COMMIT_SHA != null
      ? 'GIT_COMMIT_SHA'
      : null
  const raw = configuredKey ? env[configuredKey] : `package-${packageVersion}`
  const value = String(raw).trim()
  if (!IMPLEMENTATION_REVISION_PATTERN.test(value)) {
    throw new CharacterReprocessError('invalid_implementation_revision', `${configuredKey ?? 'package version'} is invalid`)
  }
  return value
}
```

Wire production dependencies once in `server.js`:

```js
const packageVersion = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version
const implementationRevision = resolveImplementationRevision({ env: process.env, packageVersion })
const editorArtifactAccessRegistry = createEditorArtifactAccessRegistry()
const characterReprocessService = createCharacterReprocessService({
  generatedDir,
  jobQueue,
  createJob,
  getJob,
  updateJob,
  processSheet: processSheetBuffer,
  writeCharacterArtifacts: ({ job, result }) => writeCharacterPackArtifacts({
    jobId: job.id,
    outputDir: generatedDir,
    result,
  }),
  writeEvidence: (input) => writeCharacterReprocessEvidence({ generatedDir, ...input }),
})
const characterReprocessCoordinator = createCharacterReprocessCoordinator({
  projectRoot: __dirname,
  workspaceRoot: editorWorkspaceDir,
  generatedDir,
  implementationRevision,
  reprocessService: characterReprocessService,
})
```

Pass `artifactAccessRegistry: editorArtifactAccessRegistry`,
`characterReprocessCoordinator`, `reprocessService:
characterReprocessService`, and `reprocessGeneratedDir: generatedDir` in the
existing `handleEditorProjectApi()` options. Keep legacy `generatedDir:
editorGeneratedDir` for general imports.

- [ ] **Step 13: Document the two routes and evidence files.**

Record request/response shapes, server-authoritative metadata, source fallback semantics, full-vs-settings hash authority, status derivation, specialized-only acceptance, mutation serialization, no-overwrite behavior, and artifact safety. Preserve all legacy endpoint documentation.

- [ ] **Step 14: Run API, registry, service, and store regressions.**

```bash
node --test test/editor-project/editorCharacterReprocessApi.test.js test/editor-project/editorCharacterReprocessServerWiring.test.js test/editor-project/editorCharacterReprocessService.test.js test/editor-project/editorManagedArtifactPaths.test.js test/editor-project/editorArtifactRegistry.test.js test/editor-project/editorProjectStore.test.js test/editor-project/editorProjectApi.test.js
npm test
git diff --check
```

Expected: focused/full suites PASS with the actual full-suite count recorded,
including terminal-after-evidence ordering, exact schemas, post-copy hashes,
exactly-one concurrent Accept success, stable server wiring, and no provider
call.

- [ ] **Step 15: Commit the backend slice.**

```bash
git status --short
git add src/editor-project/characterReprocessCoordinator.js src/editor-project/apiHandler.js src/editor-project/index.js server.js test/editor-project/editorCharacterReprocessApi.test.js test/editor-project/editorCharacterReprocessServerWiring.test.js test/editor-project/editorProjectApi.test.js docs/protocols/local-api-boundaries.md docs/protocols/character-pack-artifacts.md
git commit -m "feat: add exact character preview acceptance"
```

## Task 8: Add UI API, Artifact Cache, And Preview Lifecycle

**Files:**

- Modify: `src/ui/editor/api.js`
- Create: `src/ui/editor/artifactClient.js`
- Create: `src/ui/editor/repairPreviewLifecycle.js`
- Modify: `src/ui/editor/state.js`
- Create: `test/editor-project/editorRepairArtifactClient.test.js`
- Create: `test/editor-project/editorRepairPreviewLifecycle.test.js`
- Create: `test/editor-project/editorRepairWorkbenchState.test.js`

- [ ] **Step 1: Write failing API request-shape tests.**

Stub `fetch` and assert:

```js
await buildCharacterReprocessPreview({
  projectId: 'project_demo',
  assetId: 'asset_hero',
  expectedRevision: 4,
  expectedAssetRevisionId: 'rev_003',
  recipe,
})

await acceptCharacterReprocessPreview({
  projectId: 'project_demo',
  assetId: 'asset_hero',
  jobId: 'job_preview',
  expectedRevision: 4,
  expectedAssetRevisionId: 'rev_003',
  expectedRecipeHash: RECIPE_HASH,
  warningConfirmed: true,
})
```

Verify encoded URLs and exact JSON bodies. Extend `jsonRequest()` to retain controlled `error`, `status`, and `details` fields in a typed UI error rather than collapsing everything to a message.

- [ ] **Step 2: Write failing controlled-artifact cache tests.**

Allow only `/api/editor/artifact?...` URLs derived from recorded project refs
and generated URLs that occur in the selected job summary's explicit
allowlist. Merely matching `/generated/<job>/<file>` is insufficient. Reject a
different job id, unlisted known-looking filename, absolute URL, traversal,
query-based generated path, data URL, and unknown root. Assert JSON/image
requests are deduplicated by `{identity, controlledUrl}` and
`clearRepairArtifactCache(identity)` removes only that revision/job cache.
Return a recorded-but-realpath-escaping managed symlink response with JSON
`{ error: 'unsafe_artifact_path', reason, details }` and assert the client
preserves that exact controlled code/details for the Workbench's blocking
unsafe-path state. Unknown server codes must collapse to
`artifact_request_failed`, never become arbitrary UI state.
Stub `createImageBitmap` or an injected decoder; no real browser dependency is
required.

- [ ] **Step 3: Write failing lifecycle and late-result tests.**

Use injected timers/fetchers and deferred promises. Cover all four asynchronous
boundaries:

1. allocate selection/request generation before the initial Build fetch; Build
   A then Build B, resolve B before A, and adopt only B;
2. switch project/asset/revision before A's initial 202, poll, or image load
   resolves; none may mutate the active workspace, though the server job may
   continue; reject A's artifact promise after switching to B and assert B does
   not enter an error state;
3. start Accept for project A, switch to project B, then resolve A success and
   error separately; neither may replace/mutate project B, and success only
   announces that A can be reloaded;
4. start draft digest A then B, resolve B before A, and adopt only B when both
   selection token and `draftHashGeneration` match.

Also start valid digest A, apply invalid edit B without starting another
digest, then resolve A; B's `invalidateDraft()` generation must prevent A's
hash from being written onto the invalid draft.

Assert `stop()` clears timer and aborts client fetch, only one poll is active,
terminal `blocked_quality` remains inspectable, and teardown performs no
project mutation. Controller integration cases for terminal
`failed_model_error`, `failed_safety_filter`, and `not_found` must retain each
job's exact `reason` and `retry_hint` in the typed error/diagnostics rather
than replacing them with a generic processing message.

For specialized Accept, assert the first call synchronously emits
`accept_started`, immediately disables the action, and a same-selection
double-click returns the same lifecycle Promise with exactly one POST; the
controller's synchronous acceptance guard makes the second panel handler
return `null`, so `onProjectAccepted()` runs exactly once. Changing
selection or calling `stop()` must not pass/abort an Accept signal; late
success calls `onLateAccept({ outcomeUnknown: false })`, while a late network
failure calls it with `outcomeUnknown: true` so the old project can be reloaded
to verify the formal mutation. An Accept for a different selection/payload
gets its own keyed operation rather than reusing the old Promise; backend
revision locking remains the authority if those formal mutations conflict.

```js
const lifecycle = createRepairPreviewLifecycle({ fetchJob, schedule, cancel, onUpdate })
const tokenA = lifecycle.setSelection(selectionA)
lifecycle.setSelection(selectionB)
resolveJobA({ id: 'job_a', status: 'done' })

assert.equal(lifecycle.isCurrent(tokenA), false)
assert.deepEqual(updates, [])
```

- [ ] **Step 4: Write failing state-separation tests.**

Replace the flat AI-only `repair` object with separate `local` and `aiAction`
branches. `local.draft.recipe.implementation_revision` is always null.
`local.preview.submittedCanonicalRecipe` stores the server echo read-only;
`local.preview.submittedDraftSettingsHash` stores the authoritative freshness
hash. Never merge the echo into the editable draft. Add Build → edit → Build
again coverage proving both request bodies still carry null implementation
revision. Model warning confirmation as `{ jobId, recipeHash, confirmed }` and
clear it on edit, new Build, job replacement, selection change, Discard, or
Accept. Assert all local draft/preview/view state stays ephemeral and never
appears when serializing `editorState.project`; existing provider preset, plan,
job, and quota flow remain in `aiAction`.
Recipe/view edits must also leave the shell's project `dirty` flag and scene
command histories unchanged until a successful server-side Accept response is
adopted.

- [ ] **Step 5: Run focused UI-foundation tests.**

```bash
node --test test/editor-project/editorRepairArtifactClient.test.js test/editor-project/editorRepairPreviewLifecycle.test.js test/editor-project/editorRepairWorkbenchState.test.js
```

Expected: FAIL because the client/lifecycle modules and split state do not exist.

- [ ] **Step 6: Implement explicit UI API functions.**

Add `buildCharacterReprocessPreview()` and `acceptCharacterReprocessPreview()` without changing `repairCharacterAction()` or `waitForJob()`. Local Preview uses the new token-aware lifecycle and never calls general `importGeneratedJob()`.

Every edit immediately increments `draftHashGeneration`, marks an existing
Preview optimistically stale, and starts a digest. Adopt the digest only if its
generation and selection token still match. Allocate the Build/Accept request
generation and `AbortController` before calling `fetch`.

Replace `jsonRequest()` error construction and add the two functions exactly:

```js
export class EditorApiError extends Error {
  constructor({ status, body }) {
    super(body.reason || body.error || `request failed: ${status}`)
    this.name = 'EditorApiError'
    this.status = status
    this.code = body.error ?? 'editor_request_failed'
    this.details = body.details ?? null
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new EditorApiError({ status: response.status, body })
  return body
}

export function buildCharacterReprocessPreview(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/reprocess`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      expectedAssetRevisionId: input.expectedAssetRevisionId,
      recipe: input.recipe,
    }),
  })
}

export function acceptCharacterReprocessPreview(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/reprocess/${encodeURIComponent(input.jobId)}/accept`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      expectedAssetRevisionId: input.expectedAssetRevisionId,
      expectedRecipeHash: input.expectedRecipeHash,
      warningConfirmed: input.warningConfirmed === true,
    }),
  })
}
```

- [ ] **Step 7: Implement controlled loading and revision/job caches.**

Keep fetch and decode outside RAF. Cache promises so simultaneous consumers share one request/decode. Evict rejected entries. Key managed assets by asset/revision/control URL and generated evidence by job/control URL.

Create `artifactClient.js` with this complete factory:

```js
function assertControlledUrl(url, allowedManagedUrls, allowedGeneratedUrls) {
  const value = String(url ?? '')
  if (value.startsWith('/api/editor/artifact?path=') && allowedManagedUrls.has(value)) return value
  if (value.startsWith('/generated/') && allowedGeneratedUrls.has(value)) return value
  const error = new Error('repair artifact URL is outside the controlled allowlist')
  error.code = 'unsafe_artifact_path'
  throw error
}

async function artifactHttpError(response) {
  let body = {}
  try {
    const text = await response.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {}
  }
  const controlledCode = ['artifact_not_found', 'unsafe_artifact_path'].includes(body.error)
    ? body.error
    : 'artifact_request_failed'
  const error = new Error(body.reason || `artifact request failed: ${response.status}`)
  error.name = 'RepairArtifactError'
  error.status = response.status
  error.code = controlledCode
  error.details = body.details ?? null
  return error
}

export function createRepairArtifactClient({
  fetchImpl = globalThis.fetch,
  decodeImage = (blob) => createImageBitmap(blob),
} = {}) {
  const cache = new Map()
  const identities = new Map()

  function remember(identity, key) {
    if (!identities.has(identity)) identities.set(identity, new Set())
    identities.get(identity).add(key)
  }

  function cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, loader) {
    const controlledUrl = assertControlledUrl(url, allowedManagedUrls, allowedGeneratedUrls)
    const key = `${identity}\0${controlledUrl}`
    if (!cache.has(key)) {
      const promise = Promise.resolve().then(() => loader(controlledUrl)).catch((error) => {
        cache.delete(key)
        identities.get(identity)?.delete(key)
        throw error
      })
      cache.set(key, promise)
      remember(identity, key)
    }
    return cache.get(key)
  }

  function loadJson({ identity, url, allowedManagedUrls = new Set(), allowedGeneratedUrls = new Set(), signal }) {
    return cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, async (controlledUrl) => {
      const response = await fetchImpl(controlledUrl, { signal })
      if (!response.ok) throw await artifactHttpError(response)
      return response.json()
    })
  }

  function loadImage({ identity, url, allowedManagedUrls = new Set(), allowedGeneratedUrls = new Set(), signal }) {
    return cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, async (controlledUrl) => {
      const response = await fetchImpl(controlledUrl, { signal })
      if (!response.ok) throw await artifactHttpError(response)
      return decodeImage(await response.blob())
    })
  }

  function clear(identity) {
    for (const key of identities.get(identity) ?? []) cache.delete(key)
    identities.delete(identity)
  }

  return Object.freeze({ loadJson, loadImage, clearRepairArtifactCache: clear })
}
```

- [ ] **Step 8: Implement lifecycle cleanup and UI state split.**

Use `AbortController` for cancellable Build/artifact reads plus monotonic
selection, Build, Accept, and draft-hash generations. Once specialized Accept
has been sent, never abort it: it may already have committed server-side.
Token-guard adoption and route late success/unknown outcomes to a reload
notice. Clear polling/image adoption and warning
confirmation on project load, project create, asset change, active revision
change, panel exit, Discard, and shell teardown. Keep completed stale jobs
inspectable by explicit state, not by allowing stale callbacks to mutate the
new selection.

Create `repairPreviewLifecycle.js` from this implementation:

```js
const TERMINAL = new Set(['done', 'failed', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter', 'not_found'])

export function createRepairPreviewLifecycle({
  buildPreview,
  acceptPreview,
  fetchJob,
  hashDraft,
  schedule = (callback) => setTimeout(callback, 500),
  cancel = clearTimeout,
  onUpdate = () => {},
  onLateAccept = () => {},
  onInvalidate = () => {},
}) {
  let selection = null
  let selectionToken = 0
  let buildGeneration = 0
  let acceptGeneration = 0
  let draftHashGeneration = 0
  let pollWait = null
  let buildController = null
  const acceptOperations = new Map()

  const sameSelection = (left, right) => Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
  const current = (token, expected = selection) => token === selectionToken && sameSelection(expected, selection)
  const currentBuild = (token, generation, expected = selection) => current(token, expected) && generation === buildGeneration

  function clearPollWait() {
    if (!pollWait) return
    cancel(pollWait.timer)
    pollWait.resolve(false)
    pollWait = null
  }

  function waitForPoll() {
    return new Promise((resolve) => {
      const finish = (ready) => {
        if (pollWait?.resolve === finish) pollWait = null
        resolve(ready)
      }
      pollWait = { timer: schedule(() => finish(true)), resolve: finish }
    })
  }

  function setSelection(next) {
    if (sameSelection(selection, next)) return selectionToken
    selection = structuredClone(next)
    selectionToken += 1
    buildGeneration += 1
    acceptGeneration += 1
    draftHashGeneration += 1
    buildController?.abort()
    clearPollWait()
    onInvalidate()
    return selectionToken
  }

  async function poll(job, token, expectedSelection, generation) {
    let currentJob = job
    while (current(token, expectedSelection) && generation === buildGeneration && currentJob?.id && !TERMINAL.has(currentJob.status)) {
      if (!await waitForPoll()) return null
      const next = await fetchJob(currentJob.id)
      if (!current(token, expectedSelection) || generation !== buildGeneration) return null
      currentJob = next
      onUpdate({ type: 'job', job: currentJob, buildGeneration: generation })
    }
    return current(token, expectedSelection) && generation === buildGeneration ? currentJob : null
  }

  async function build(payload) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const generation = ++buildGeneration
    buildController?.abort()
    clearPollWait()
    buildController = new AbortController()
    onInvalidate()
    onUpdate({ type: 'build_started' })
    try {
      const result = await buildPreview(payload, { signal: buildController.signal })
      if (!current(token, expectedSelection) || generation !== buildGeneration) return null
      onUpdate({ type: 'preview_created', preview: result, buildGeneration: generation })
      await poll(result, token, expectedSelection, generation)
      return result
    } catch (error) {
      if (error?.name !== 'AbortError' && current(token, expectedSelection) && generation === buildGeneration) {
        onUpdate({ type: 'error', phase: 'build', error })
      }
      return null
    }
  }

  function invalidateDraft() {
    const generation = ++draftHashGeneration
    onUpdate({ type: 'draft_optimistically_stale' })
    return generation
  }

  async function digestDraft(bytes, { generation: suppliedGeneration } = {}) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const generation = suppliedGeneration ?? invalidateDraft()
    try {
      const hash = await hashDraft(bytes)
      if (!current(token, expectedSelection) || generation !== draftHashGeneration) return null
      onUpdate({ type: 'draft_hash', hash })
      return hash
    } catch (error) {
      if (current(token, expectedSelection) && generation === draftHashGeneration) {
        onUpdate({ type: 'error', phase: 'draft_hash', error })
      }
      return null
    }
  }

  function accept(payload) {
    const token = selectionToken
    const expectedSelection = structuredClone(selection)
    const operationKey = JSON.stringify([
      expectedSelection?.projectId,
      expectedSelection?.projectRevision,
      expectedSelection?.assetId,
      expectedSelection?.revisionId,
      payload.jobId,
      payload.expectedRecipeHash,
    ])
    if (acceptOperations.has(operationKey)) return acceptOperations.get(operationKey)
    const generation = ++acceptGeneration
    onUpdate({ type: 'accept_started', acceptGeneration: generation })
    const operation = Promise.resolve().then(async () => {
      try {
        const result = await acceptPreview(payload)
        if (!current(token, expectedSelection) || generation !== acceptGeneration) {
          onLateAccept({ result, selection: expectedSelection, outcomeUnknown: false })
          return null
        }
        onUpdate({ type: 'accepted', result })
        return result
      } catch (error) {
        if (!current(token, expectedSelection) || generation !== acceptGeneration) {
          onLateAccept({ error, selection: expectedSelection, outcomeUnknown: true })
          return null
        }
        onUpdate({ type: 'error', phase: 'accept', error })
        return null
      }
    })
    let tracked
    tracked = operation.finally(() => {
      if (acceptOperations.get(operationKey) === tracked) acceptOperations.delete(operationKey)
    })
    acceptOperations.set(operationKey, tracked)
    return tracked
  }

  function stop() {
    selectionToken += 1
    buildGeneration += 1
    acceptGeneration += 1
    draftHashGeneration += 1
    buildController?.abort()
    clearPollWait()
    onInvalidate()
  }

  return Object.freeze({
    setSelection,
    build,
    digestDraft,
    invalidateDraft,
    accept,
    stop,
    isCurrent: current,
    isCurrentBuild: currentBuild,
    capture: () => ({ token: selectionToken, buildGeneration, selection: structuredClone(selection) }),
  })
}
```

Add this factory to `state.js` and set `editorState.repair.local` from it:

```js
export function createEmptyLocalRepairState() {
  return {
    selection: null,
    sourceContext: null,
    profile: null,
    draft: null,
    validationContext: null,
    lastValidCanonical: null,
    validation: { status: 'fail', blocking_errors: ['repair_not_open'], invalidPaths: [] },
    draftHashGeneration: 0,
    currentDraftSettingsHash: null,
    preview: null,
    previewModel: { state: 'no_preview', frames: [], modeAvailability: {}, acceptance: { canAccept: false, reason: 'no_preview' }, diagnostics: [] },
    acceptInFlight: false,
    warningConfirmation: null,
    filmstrip: { frames: [], selectedIndex: 0, playing: false },
    renderFrame: null,
    differenceCache: new Map(),
    view: {
      clipId: '',
      frameIndex: null,
      mode: 'before',
      zoom: 1,
      pan: { x: 0, y: 0 },
      overlays: { cuts: true, anchor: true, baseline: true, bbox: true, debug: false },
    },
    status: 'idle',
    message: '',
    diagnostics: [],
    error: null,
    openGeneration: 0,
  }
}

repair: {
  local: createEmptyLocalRepairState(),
  aiAction: {
    selectedAction: '',
    providerPresetId: '',
    imageSize: '1K',
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
    assetId: null,
    revisionId: null,
  },
},
```

- [ ] **Step 9: Re-run focused tests.**

```bash
node --test test/editor-project/editorRepairArtifactClient.test.js test/editor-project/editorRepairPreviewLifecycle.test.js test/editor-project/editorRepairWorkbenchState.test.js
npm test
npm run smoke:local
git diff --check
```

Expected: focused/full suites and smoke PASS with the full-suite count
recorded. Tests prove one Build call, exact generated URL allowlisting,
out-of-order Build/digest/poll/image/Accept protection, warning identity, null
editable implementation revision, and project-state isolation.

- [ ] **Step 10: Commit the UI foundation.**

```bash
git status --short
git add src/ui/editor/api.js src/ui/editor/artifactClient.js src/ui/editor/repairPreviewLifecycle.js src/ui/editor/state.js test/editor-project/editorRepairArtifactClient.test.js test/editor-project/editorRepairPreviewLifecycle.test.js test/editor-project/editorRepairWorkbenchState.test.js
git commit -m "feat: add repair preview client lifecycle"
```

## Task 9: Build Canvas Comparison, Filmstrip Model, And Evidence Normalization

**Files:**

- Create: `src/ui/editor/repairComparisonRenderer.js`
- Create: `src/ui/editor/repairEvidence.js`
- Create: `test/editor-project/editorRepairComparisonRenderer.test.js`
- Modify: `test/editor-project/editorRepairState.test.js`

- [ ] **Step 1: Write failing sprite-frame extraction tests.**

Use fake Canvas contexts and decoded image dimensions. Given frame size 96x96 and sheet width 768, assert frame 10 crops from `(192, 96, 96, 96)`. Cover invalid frame index, incompatible source/preview sizes, per-frame nudge, anchor, cut line, baseline, bbox, and debug overlays.

Treat the active revision's managed `sheet` as Before and the selected Preview
job's `normalized_sheet_url` as After. Source-layout and debug images are
overlay/evidence inputs, not substitutes for either side of the comparison.

```js
const crop = resolveSheetFrameRect({
  frameIndex: 10,
  frameSize: { w: 96, h: 96 },
  sheetSize: { w: 768, h: 768 },
})
assert.deepEqual(crop, { sx: 192, sy: 96, sw: 96, sh: 96 })
```

- [ ] **Step 2: Write failing mode-availability and pixel-composition tests.**

Assert Before/After require their real frame, Split/Difference require equal dimensions, and Onion requires both frames. Difference must compute real absolute per-channel deltas; Onion must use configured opacity; Split must obey a clamped divider. Missing frames return a textual diagnostic and must not draw fabricated pixels.

- [ ] **Step 3: Write failing renderer performance tests.**

Assert each draw sets `imageSmoothingEnabled = false`, reads precomputed viewport values, and invokes no fetch, decode, `getBoundingClientRect`, `offsetWidth`, or ResizeObserver callback from the animation callback. Only the selected clip/frame sequence advances.

Add a literal large-workspace case so the user-visible empty-space regression
cannot return:

```js
assert.deepEqual(
  computeRepairViewport({
    canvasWidth: 960,
    canvasHeight: 600,
    frameSize: { w: 96, h: 96 },
    zoom: 1,
    pan: { x: 0, y: 0 },
  }),
  { x: 192, y: 12, w: 576, h: 576 }
)
```

Also assert zoom/pan update only cached viewport input, Difference is drawn
through the same centered/scaled `drawImage` path, and no raw 96×96
`putImageData` is placed at the Canvas origin.

- [ ] **Step 4: Write failing evidence normalization tests.**

Map real report fields into:

```js
{
  validationStatus,
  failureTaxonomy,
  uniqueColors,
  paletteChangedRatio,
  haloBefore,
  haloAfter,
  residueBefore,
  residueAfter,
  outlineRatio,
  componentCleanup,
  anchor,
  baseline,
  motionStabilization,
  sourceStaging,
  warnings,
  missingMetrics,
}
```

Missing fields must yield documented `metric_unavailable` diagnostics, never zero. Preserve a blocking failure as blocking.

Add a real `frame_adjustments` case that is valid but would crop visible pixels.
Normalize its report as non-blocking `would_crop` evidence with frame id,
requested dx/dy, and the unapplied reason. It must remain visible to the panel,
must not be promoted to a validation failure, and must not be dropped as a
zero/no-op.

Use real report field names in the fixture:

```js
const evidence = normalizeRepairEvidence({
  pixel_style: {
    metrics: { after: { unique_color_count: 12 } },
    palette_snap: { changed_pixel_ratio: 0.125 },
    halo_residue: {
      before: { near_white_edge_pixels: 7, semi_transparent_edge_pixels: 5 },
      after: { near_white_edge_pixels: 1, semi_transparent_edge_pixels: 2 },
    },
    outline: { outline_pixel_ratio: 0.04 },
    component_cleanup: { removed_components: 3 },
  },
  validation: {
    status: 'warning',
    blocking_errors: [],
    warnings: ['frame_3_cropped'],
    failure_taxonomy: { categories: [{ id: 'structure.cropped' }] },
  },
  frames: [{
    index: 3,
    normalized_bbox: { x: 2, y: 4, w: 90, h: 90 },
    normalized_anchor: { x: 47, y: 88 },
    warnings: ['frame_3_cropped'],
    manual_adjustment: { applied: false, reason: 'would_crop', dx: 4, dy: 0 },
  }],
})

assert.equal(evidence.uniqueColors, 12)
assert.equal(evidence.paletteChangedRatio, 0.125)
assert.equal(evidence.haloBefore, 7)
assert.equal(evidence.residueAfter, 2)
assert.equal(evidence.outlineRatio, 0.04)
assert.deepEqual(evidence.failureTaxonomy, ['structure.cropped'])
assert.deepEqual(evidence.framesByIndex['3'].anchor, { x: 47, y: 88 })
assert.deepEqual(evidence.manualAdjustments.wouldCrop, [{ frame: 3, dx: 4, dy: 0, reason: 'would_crop' }])
```

- [ ] **Step 5: Run focused tests and confirm failure.**

```bash
node --test test/editor-project/editorRepairComparisonRenderer.test.js test/editor-project/editorRepairState.test.js
```

Expected: FAIL because renderer/evidence modules do not exist.

- [ ] **Step 6: Implement pure geometry and comparison helpers.**

Export `resolveSheetFrameRect(input)`,
`getRepairComparisonAvailability(input)`, `buildRepairOverlayCommands(input)`,
`renderRepairComparisonFrame(ctx, frame)`, and
`createRepairComparisonRenderer({ canvas, requestFrame, cancelFrame })`.

The lifecycle owns a `ResizeObserver` outside RAF, stores backing-store dimensions, and schedules another draw only while the selected clip is playing or view state changes. Pan and discrete zoom update cached transforms.

Use these complete pure/render boundaries:

```js
export function resolveSheetFrameRect({ frameIndex, frameSize, sheetSize }) {
  const columns = Math.floor(sheetSize.w / frameSize.w)
  const rows = Math.floor(sheetSize.h / frameSize.h)
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= columns * rows) throw new RangeError('frame index is outside the sheet')
  return {
    sx: (frameIndex % columns) * frameSize.w,
    sy: Math.floor(frameIndex / columns) * frameSize.h,
    sw: frameSize.w,
    sh: frameSize.h,
  }
}

export function getRepairComparisonAvailability({ before, after }) {
  const sameSize = Boolean(before && after && before.width === after.width && before.height === after.height)
  return {
    before: { enabled: Boolean(before), reason: before ? null : 'before_frame_unavailable' },
    after: { enabled: Boolean(after), reason: after ? null : 'after_frame_unavailable' },
    split: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
    difference: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
    onion: { enabled: sameSize, reason: sameSize ? null : 'comparison_size_mismatch' },
  }
}

export function readRepairFramePixels(source, rect, documentRef = document) {
  const canvas = documentRef.createElement('canvas')
  canvas.width = rect.sw
  canvas.height = rect.sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
  return ctx.getImageData(0, 0, rect.sw, rect.sh)
}

export function buildDifferencePixels(before, after, createImageData = (data, width, height) => new ImageData(data, width, height)) {
  if (before.width !== after.width || before.height !== after.height) throw new Error('comparison_size_mismatch')
  const data = new Uint8ClampedArray(before.data.length)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.abs(before.data[index] - after.data[index])
    data[index + 1] = Math.abs(before.data[index + 1] - after.data[index + 1])
    data[index + 2] = Math.abs(before.data[index + 2] - after.data[index + 2])
    data[index + 3] = 255
  }
  return createImageData(data, before.width, before.height)
}

export function createRepairDifferenceSource(imageData, documentRef = document) {
  const canvas = documentRef.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  canvas.getContext('2d').putImageData(imageData, 0, 0)
  return canvas
}

export function computeRepairViewport({ canvasWidth, canvasHeight, frameSize, zoom = 1, pan = { x: 0, y: 0 } }) {
  const fitScale = Math.max(1, Math.floor(Math.min(canvasWidth / frameSize.w, canvasHeight / frameSize.h)))
  const scale = Math.max(1, Math.floor(fitScale * Math.max(0.25, Math.min(4, zoom))))
  const w = frameSize.w * scale
  const h = frameSize.h * scale
  return {
    x: Math.round((canvasWidth - w) / 2 + pan.x),
    y: Math.round((canvasHeight - h) / 2 + pan.y),
    w,
    h,
  }
}

export function buildRepairOverlayCommands({ anchor, baselineY, bbox, cutColumns = [], cutRows = [] }) {
  return [
    ...cutColumns.map((x) => ({ type: 'line', x1: x, y1: 0, x2: x, y2: 'height', style: 'cut' })),
    ...cutRows.map((y) => ({ type: 'line', x1: 0, y1: y, x2: 'width', y2: y, style: 'cut' })),
    ...(anchor ? [{ type: 'anchor', x: anchor.x, y: anchor.y }] : []),
    ...(Number.isFinite(baselineY) ? [{ type: 'line', x1: 0, y1: baselineY, x2: 'width', y2: baselineY, style: 'baseline' }] : []),
    ...(bbox ? [{ type: 'rect', ...bbox, style: 'bbox' }] : []),
  ]
}

export function renderRepairComparisonFrame(ctx, frame) {
  const { width, height } = ctx.canvas
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  if (!frame.beforeRect && !frame.afterRect) {
    if (frame.emptyMessage) {
      ctx.fillStyle = '#8b93a7'
      ctx.textAlign = 'center'
      ctx.fillText(frame.emptyMessage, width / 2, height / 2)
    }
    return
  }
  const draw = (source, rect, alpha = 1, clipWidth = width) => {
    if (!source || !rect) return
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.rect(0, 0, clipWidth, height)
    ctx.clip()
    ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, frame.viewport.x, frame.viewport.y, frame.viewport.w, frame.viewport.h)
    ctx.restore()
  }
  if (frame.mode === 'before') draw(frame.before, frame.beforeRect)
  if (frame.mode === 'after') draw(frame.after, frame.afterRect)
  if (frame.mode === 'split') {
    const divider = Math.max(0, Math.min(1, frame.split)) * width
    draw(frame.before, frame.beforeRect, 1, divider)
    ctx.save()
    ctx.translate(divider, 0)
    ctx.beginPath()
    ctx.rect(0, 0, width - divider, height)
    ctx.clip()
    ctx.translate(-divider, 0)
    draw(frame.after, frame.afterRect)
    ctx.restore()
  }
  if (frame.mode === 'onion') {
    draw(frame.before, frame.beforeRect)
    draw(frame.after, frame.afterRect, frame.onionAlpha)
  }
  if (frame.mode === 'difference' && frame.differenceSource) draw(frame.differenceSource, {
    sx: 0,
    sy: 0,
    sw: frame.differenceSource.width,
    sh: frame.differenceSource.height,
  })
  for (const command of frame.overlayCommands) frame.drawOverlay(ctx, command, frame.viewport)
}

export function createRepairComparisonRenderer({ canvas, requestFrame, cancelFrame, observeResize, pixelRatio = globalThis.devicePixelRatio ?? 1 }) {
  const ctx = canvas.getContext('2d')
  let model = null
  let raf = null
  const draw = () => {
    raf = null
    if (!model) return
    const viewport = computeRepairViewport({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      frameSize: model.frameSize,
      zoom: model.zoom,
      pan: model.pan,
    })
    renderRepairComparisonFrame(ctx, { ...model, viewport })
    if (model.playing) raf = requestFrame(draw)
  }
  const schedule = () => { if (raf == null) raf = requestFrame(draw) }
  const resizeObserver = observeResize(({ width, height }) => {
    canvas.width = Math.max(1, Math.round(width * pixelRatio))
    canvas.height = Math.max(1, Math.round(height * pixelRatio))
    schedule()
  })
  return Object.freeze({
    render(next) { model = next; schedule() },
    destroy() { if (raf != null) cancelFrame(raf); resizeObserver.disconnect(); model = null },
  })
}
```

- [ ] **Step 7: Implement report normalization and filmstrip timing.**

Keep report parsing pure and source-aware. Frame duration is `1000 / fps`; first/last and left/right clamp to real clip frames. Do not add sequence virtualization.

Create `repairEvidence.js` with an explicit null-preserving mapper:

```js
const metric = (value, missingMetrics, name) => {
  if (value == null) {
    missingMetrics.push(name)
    return null
  }
  return value
}

export function normalizeRepairEvidence(report = {}) {
  const missingMetrics = []
  const style = report.pixel_style ?? {}
  const validation = report.validation ?? {}
  const manual = report.normalization?.manual_adjustments ?? {}
  const frames = report.frames ?? []
  const wouldCrop = frames
    .filter((frame) => frame.manual_adjustment?.reason === 'would_crop')
    .map((frame) => ({ frame: frame.index, dx: frame.manual_adjustment.dx, dy: frame.manual_adjustment.dy, reason: 'would_crop' }))
  const styleMetrics = style.metrics?.after ?? style.metrics ?? {}
  const taxonomy = validation.failure_taxonomy?.categories?.map((item) => item.id) ?? validation.blocking_errors ?? []
  return {
    validationStatus: validation.status ?? 'unknown',
    failureTaxonomy: [...taxonomy],
    uniqueColors: metric(styleMetrics.unique_color_count, missingMetrics, 'unique_color_count'),
    paletteChangedRatio: metric(style.palette_snap?.changed_pixel_ratio ?? style.changed_pixel_ratio, missingMetrics, 'palette_changed_pixel_ratio'),
    haloBefore: metric(style.halo_residue?.before?.near_white_edge_pixels, missingMetrics, 'halo_before'),
    haloAfter: metric(style.halo_residue?.after?.near_white_edge_pixels, missingMetrics, 'halo_after'),
    residueBefore: metric(style.halo_residue?.before?.semi_transparent_edge_pixels, missingMetrics, 'residue_before'),
    residueAfter: metric(style.halo_residue?.after?.semi_transparent_edge_pixels, missingMetrics, 'residue_after'),
    outlineRatio: metric(style.outline?.outline_pixel_ratio, missingMetrics, 'outline_ratio'),
    componentCleanup: style.component_cleanup ?? report.component_cleanup ?? null,
    anchor: report.anchor_tuning ?? null,
    baseline: report.anchor_tuning?.effective_anchor?.y ?? report.anchor_tuning?.base_anchor?.y ?? null,
    motionStabilization: report.normalization?.motion_stabilization ?? null,
    sourceStaging: report.source_staging ?? null,
    framesByIndex: Object.fromEntries(frames.map((frame) => [String(frame.index), {
      bbox: frame.normalized_bbox ?? null,
      anchor: frame.normalized_anchor ?? null,
      warnings: [...(frame.warnings ?? [])],
    }])),
    manualAdjustments: { ...manual, wouldCrop },
    warnings: [...new Set([...(validation.warnings ?? []), ...(report.background_warnings ?? [])])],
    missingMetrics: missingMetrics.map((name) => ({ code: 'metric_unavailable', metric: name })),
  }
}
```

- [ ] **Step 8: Re-run renderer tests.**

```bash
node --test test/editor-project/editorRepairComparisonRenderer.test.js test/editor-project/editorRepairState.test.js
npm test
npm run smoke:local
git diff --check
```

Expected: focused/full suites and smoke PASS with the full-suite count
recorded, exact crop coordinates, visible `would_crop` evidence, honest
unavailable modes, nearest-neighbor draws, and no work source inside RAF.

- [ ] **Step 9: Commit the renderer unit.**

```bash
git status --short
git add src/ui/editor/repairComparisonRenderer.js src/ui/editor/repairEvidence.js test/editor-project/editorRepairComparisonRenderer.test.js test/editor-project/editorRepairState.test.js
git commit -m "feat: render repair comparison evidence"
```

## Task 10: Extract And Mount The Focused Repair Workbench

**Files:**

- Create: `src/ui/editor/repairWorkbenchPanel.js`
- Create: `src/ui/editor/repairWorkbenchController.js`
- Modify: `src/ui/editor/shell.js`
- Modify: `src/ui/editor/editor.css`
- Create: `test/editor-project/editorRepairWorkbenchPanel.test.js`
- Create: `test/editor-project/editorRepairWorkbenchController.test.js`
- Modify: `test/editor-project/editorShellStructure.test.js`

- [ ] **Step 1: Write failing structure and capability-truth tests.**

Assert `shell.js` imports the new panel and remains under 3000 lines. Source/DOM-factory tests must find:

- stable workbench root, header status, comparison Canvas, mode controls, overlay controls, full-height Recipe region, horizontal filmstrip, quality/actions region, and live status;
- Geometry, Cleanup, Pixel Finishing, Advanced correction, and separate AI Action Repair sections;
- Build, Accept, Reset, Discard, warning confirmation, play/pause, first/last;
- no active Pixel Grid Refinement or fixed-region staging control;
- read-only historical fixed-region staging evidence when the parent report contains it;
- conditional `dual_matte` reason;
- no brush/eraser/pixel editor, Style Enforcement control, provider key, raw generated path, or general import call.

Use exported pure view-model and DOM-mount functions with the repository's existing fake-element pattern. Do not add jsdom.

Pin the controller extraction with executable source assertions rather than a
prose-only size target:

```js
const shellSource = await readFile('src/ui/editor/shell.js', 'utf8')
const controllerSource = await readFile('src/ui/editor/repairWorkbenchController.js', 'utf8')
assert.ok(shellSource.split('\n').length < 3000, 'editor shell must remain below 3000 lines')
assert.match(shellSource, /createRepairWorkbenchController/)
assert.doesNotMatch(shellSource, /async function openRepairForAsset|function handleRepairLifecycleUpdate|function dispatchRepairFilmstrip/)
assert.match(controllerSource, /async function openRepairForAsset/)
assert.match(controllerSource, /function handleRepairLifecycleUpdate/)
assert.match(controllerSource, /function dispatchRepairFilmstrip/)
```

- [ ] **Step 2: Write failing focused-layout and restoration tests.**

When Repair opens on a compatible asset, assert `data-workspace-mode="repair"` is set on `.editor-main` and `.editor-stage-panel`, the normal Scene toolbar/stage are visually removed from the layout, and the bottom panel occupies the central workspace. Desktop hides Asset Library/global Inspector only in Repair mode. Discard or switching tabs removes the mode and restores prior shell visibility and selection.

- [ ] **Step 3: Write failing Recipe control binding tests.**

Every active control must update the named Recipe field and only local overlays or stale state. No `input`, `change`, nudge, frame selection, play tick, zoom, or pan event may call Build. Build calls the new endpoint once with a complete Recipe. Accept calls specialized Accept with full server hash. Reset restores the immutable opening snapshot. Discard changes no project JSON.

Drive one table test from this exact UI contract:

| Selector | Recipe path | Default/domain | Enable/provenance | Local effect |
| --- | --- | --- | --- | --- |
| `[data-repair-field="source-layout"]` | `source.source_layout` | server-derived authority | Read-only `Provenance` | No edit/path lookup. |
| `[data-repair-field="input-mode"]` | reprocess context | managed source or explicit fallback | Read-only `Provenance` | Disables incompatible controls. |
| `[data-repair-control="grid-mode"]` | `grid.manual_overrides` | `Auto`/`Manual` | Uniform 8x8 managed source only | Overlay + stale. |
| `[data-repair-control="grid-x"]` ×7 | `grid.manual_overrides.columns[1..7]` | Strict integers between fixed `0` and real width | Manual uniform grid only | Overlay + stale. |
| `[data-repair-control="grid-y"]` ×7 | `grid.manual_overrides.rows[1..7]` | Strict integers between fixed `0` and real height | Manual uniform grid only | Overlay + stale. |
| `[data-repair-control="anchor-x"]` | `anchor_offset.x` | `0`, integer `-16..16` | Active | Overlay + stale. |
| `[data-repair-control="anchor-y"]` | `anchor_offset.y` | `0`, integer `-16..16` | Active | Overlay + stale. |
| `[data-repair-control="frame-dx"]` | selected `frame_adjustments.<index>.dx` | `0`, integer `-16..16` | Valid selected real frame | Overlay + stale. |
| `[data-repair-control="frame-dy"]` | selected `frame_adjustments.<index>.dy` | `0`, integer `-16..16` | Valid selected real frame | Overlay + stale. |
| `[data-repair-control="background-mode"]` | `background.mode` | `auto` | Workbench modes; conditional `dual_matte` | Stale. |
| `[data-repair-control="background-tolerance"]` | `background.tolerance` | `24`, integer `0..80` | Active except passthrough explanation | Stale. |
| `[data-repair-control="component-cleanup"]` | `cleanup.component_cleanup` | `true` | Active | Stale. |
| `[data-repair-control="cleanup-min-alpha"]` | `cleanup.min_alpha` | `18`, integer `0..80` | Advanced | Stale. |
| `[data-repair-control="cleanup-min-area"]` | `cleanup.min_area` | `4`, integer `1..64` | Advanced | Stale. |
| `[data-repair-control="cleanup-min-ratio"]` | `cleanup.min_area_ratio` | `0`, number `0..0.25` | Advanced | Stale. |
| `[data-repair-control="pixel-enabled"]` | `pixel_finishing.enabled` | `false` | Active | Stale. |
| `[data-repair-control="pixel-max-colors"]` | `pixel_finishing.max_colors` | `16`, integer `1..256` | Finishing enabled | Stale. |
| `[data-repair-control="pixel-outline"]` | `pixel_finishing.outline` | `true` | Finishing enabled | Stale. |
| `[data-repair-control="pixel-outline-mode"]` | `pixel_finishing.outline_mode` | `outer` | Finishing + outline enabled | Stale. |
| `[data-repair-control="auto-correct"]` | `correction.auto_correct` | `true` | Advanced | Stale. |
| `[data-repair-control="motion-stabilize"]` | `correction.motion_stabilize` | `true` | Advanced | Stale. |
| `[data-repair-control="motion-max-shift"]` | `correction.motion_max_shift` | `2`, integer `0..4` | Motion stabilization enabled | Stale. |
| `[data-repair-control="locked-animations"]` | `locked_animations` | inherited unique list | Profile animation ids | Stale. |
| `[data-repair-control="style-enabled"]` | `style_report.enabled` | forced `true` | Read-only `Forced` | No edit. |
| `[data-repair-control="style-max-colors"]` | `style_report.max_colors` | `16`, integer `1..256` | Active report budget | Stale. |
| `[data-repair-control="output-sizes"]` | `outputs.frame_sizes` | forced `[96,64,48,32,16]` | Read-only `Forced` | No edit. |
| `[data-repair-evidence="fixed-staging"]` | historical report only | parent values | Read-only `Provenance`; processing forced off | No edit. |
| Pixel Grid Refinement | none | unavailable | Hidden/disabled `Coming later` | No option. |
| AI Action Repair | separate `repair.aiAction` | existing provider flow | Collapsed and quota-confirmed | Never edits local Recipe. |

Each row also asserts a provenance badge: `Default` when no historical Recipe
supplied the editable value, `Inherited` when a valid parent Recipe supplied
it, `Forced` for Workbench invariants, and `Provenance` for read-only parent
evidence. Fixed-region layouts and normalized-sheet fallback disable Manual
grid with a reason. Numeric grid controls keep fixed start/end boundaries,
require strict increase and real dimensions, update the Canvas overlay
immediately, and never POST. Form-arrow keys edit their input and never move
the filmstrip.

- [ ] **Step 4: Write failing accessibility and filmstrip tests.**

Assert:

- header exposes the real asset name, active revision id, immutable-current-revision status, and every preview state label;
- mode/overlay buttons expose `aria-pressed`;
- preview state and async results use `aria-live`;
- disabled controls include an accessible reason;
- the comparison Canvas is focusable, has an accessible evidence label, and has a visible focus ring;
- long names retain full accessible text;
- filmstrip uses listbox/option or an equivalent roving-tabindex pattern;
- an accessible clip selector lists every real `asset.clips` entry, preserves
  long names, switches frames/playback/rendering locally with zero POST, and
  leaves an empty clip in a truthful no-frame state;
- filmstrip exposes real selected clip name, frame count, fps-derived total duration, and current frame position;
- left/right frame keys run only while the filmstrip owns focus and never from input/select/textarea/contenteditable;
- selection change calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` once, not every animation tick;
- focus rings exist.
- fixed-region sources generate no synthetic uniform cut commands; Cuts is
  disabled with the explicit reason while anchor/baseline/real evidence remain
  available.

Add a `would_crop` panel assertion that shows the requested frame/dx/dy and
non-applied reason as evidence without changing the blocking status.
Add a 64-frame evidence case and assert the quality bar renders a count plus
one first-frame summary rather than 64 JSON records; at the 1440×900 layout
fixture the Canvas row must retain at least 280 CSS pixels of height.
Dispatch a real `change` event on the clip selector in the fake-DOM test and
assert frames/index/playback/render update once with zero lifecycle/API calls.
Cover both an initially empty clip and switching from a populated clip to an
empty one: `frameIndex` is `null`, frame nudge is disabled with a reason, the
Canvas draws only the textual diagnostic, and no sheet frame 0 crop occurs.
Then switch to a second populated clip whose frames start above 0 and prove
frame nudge uses `local.filmstrip.frames` as its truth source. With After
hydrated, switch across two frames and assert Difference is recomputed/cached
for the selected sheet rect; round-trip through an empty clip must clear the
visible Difference and restore the correct cached frame on return.

- [ ] **Step 5: Run panel and shell tests and confirm failure.**

```bash
node --test test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorShellStructure.test.js
```

Expected: FAIL because the current Repair UI is AI-centric, inline in `shell.js`, and constrained to 220px.

- [ ] **Step 6: Implement one stable workbench mount.**

Expose `createRepairWorkbenchPanel({ root, documentRef, lifecycle,
createRenderer, onProjectAccepted, announce })`. Its returned methods are
`open(context)`, `render(viewModel)`, `close(reason)`, and `destroy()`.

Create DOM once, retain element references, update properties/text/classes without `innerHTML`, and destroy listeners/RAF/ResizeObserver/polls on teardown. Keep AI controls inside a separate collapsed details region backed by `editorState.repair.aiAction` and the existing `planRepairAction()` / `runRepairAction()` behavior.

Create the stable shell with this code in `repairWorkbenchPanel.js`:

```js
import {
  buildRepairOverlayCommands,
  getRepairComparisonAvailability,
  resolveSheetFrameRect,
} from './repairComparisonRenderer.js'

function node(documentRef, tag, className, text = '') {
  const value = documentRef.createElement(tag)
  if (className) value.className = className
  value.textContent = text
  return value
}

function labeledValue(documentRef, label) {
  const wrap = node(documentRef, 'div', 'editor-repair-header-value')
  const title = node(documentRef, 'span', '', label)
  const value = node(documentRef, 'strong')
  wrap.append(title, value)
  return { wrap, value }
}

export function createRepairWorkbenchPanel({
  root,
  documentRef = document,
  lifecycle,
  createRenderer,
  onProjectAccepted,
  announce,
}) {
  const workbench = node(documentRef, 'section', 'editor-repair-workbench')
  const header = node(documentRef, 'header', 'editor-repair-header')
  const assetName = labeledValue(documentRef, 'Asset')
  const revisionId = labeledValue(documentRef, 'Revision')
  const immutable = labeledValue(documentRef, 'Current')
  const previewState = labeledValue(documentRef, 'Preview')
  previewState.value.setAttribute('aria-live', 'polite')
  header.append(assetName.wrap, revisionId.wrap, immutable.wrap, previewState.wrap)

  const canvasRegion = node(documentRef, 'section', 'editor-repair-canvas-region')
  const stateBanner = node(documentRef, 'div', 'editor-repair-state-banner')
  stateBanner.setAttribute('aria-live', 'polite')
  stateBanner.hidden = true
  const modes = node(documentRef, 'div', 'editor-repair-modes')
  for (const mode of ['before', 'after', 'split', 'difference', 'onion']) {
    const control = node(documentRef, 'button', 'secondary', mode[0].toUpperCase() + mode.slice(1))
    control.type = 'button'
    control.dataset.repairMode = mode
    control.setAttribute('aria-pressed', 'false')
    modes.append(control)
  }
  const overlays = node(documentRef, 'div', 'editor-repair-overlays')
  for (const [overlay, label] of [
    ['cuts', 'Cuts'],
    ['anchor', 'Anchor'],
    ['baseline', 'Baseline'],
    ['bbox', 'Bounds'],
    ['debug', 'Debug'],
  ]) {
    const control = node(documentRef, 'button', 'secondary', label)
    control.type = 'button'
    control.dataset.repairOverlay = overlay
    control.setAttribute('aria-pressed', 'false')
    overlays.append(control)
  }
  const zoomControls = node(documentRef, 'div', 'editor-repair-zoom-controls')
  const zoomOut = node(documentRef, 'button', 'secondary', 'Zoom out')
  const zoomReset = node(documentRef, 'button', 'secondary', 'Fit')
  const zoomIn = node(documentRef, 'button', 'secondary', 'Zoom in')
  const zoomValue = node(documentRef, 'output', 'editor-repair-zoom-value', '100%')
  for (const control of [zoomOut, zoomReset, zoomIn]) control.type = 'button'
  zoomControls.append(zoomOut, zoomReset, zoomIn, zoomValue)
  const canvas = node(documentRef, 'canvas', 'editor-repair-canvas')
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'Before and after Character Pack frame evidence')
  canvasRegion.append(stateBanner, modes, overlays, zoomControls, canvas)

  const recipe = node(documentRef, 'aside', 'editor-repair-recipe')
  recipe.id = 'editor-repair-recipe'
  recipe.setAttribute('aria-label', 'Processing Recipe')
  const recipeBody = node(documentRef, 'div', 'editor-repair-recipe-body')
  const aiAction = node(documentRef, 'details', 'editor-repair-ai-action')
  const aiActionBody = node(documentRef, 'div', 'editor-repair-ai-action-body')
  aiAction.append(node(documentRef, 'summary', '', 'AI Action Repair'), aiActionBody)
  recipe.append(recipeBody, aiAction)

  const filmstrip = node(documentRef, 'section', 'editor-repair-filmstrip')
  const filmstripToolbar = node(documentRef, 'div', 'editor-repair-filmstrip-toolbar')
  const filmstripClipLabel = node(documentRef, 'label', 'editor-repair-filmstrip-clip-label')
  filmstripClipLabel.append(node(documentRef, 'span', '', 'Clip'))
  const filmstripClip = node(documentRef, 'select', 'editor-repair-filmstrip-clip')
  filmstripClip.dataset.repairControl = 'filmstrip-clip'
  filmstripClipLabel.append(filmstripClip)
  const filmstripFirst = node(documentRef, 'button', 'secondary', 'First')
  const filmstripPlay = node(documentRef, 'button', 'secondary', 'Play')
  const filmstripLast = node(documentRef, 'button', 'secondary', 'Last')
  const filmstripMeta = node(documentRef, 'output', 'editor-repair-filmstrip-meta')
  for (const control of [filmstripFirst, filmstripPlay, filmstripLast]) control.type = 'button'
  filmstripToolbar.append(filmstripClipLabel, filmstripFirst, filmstripPlay, filmstripLast, filmstripMeta)
  const filmstripFrames = node(documentRef, 'div', 'editor-repair-filmstrip-frames')
  filmstripFrames.tabIndex = 0
  filmstripFrames.setAttribute('role', 'listbox')
  filmstripFrames.setAttribute('aria-label', 'Selected clip frames')
  filmstrip.append(filmstripToolbar, filmstripFrames)

  const quality = node(documentRef, 'section', 'editor-repair-quality')
  const qualityMetrics = node(documentRef, 'dl', 'editor-repair-quality-metrics')
  const diagnostics = node(documentRef, 'div', 'editor-repair-diagnostics')
  diagnostics.setAttribute('aria-live', 'polite')
  const warningLabel = node(documentRef, 'label', 'editor-repair-warning-confirmation')
  const warningConfirmation = node(documentRef, 'input')
  warningConfirmation.type = 'checkbox'
  warningConfirmation.dataset.repairControl = 'warning-confirmation'
  warningLabel.append(warningConfirmation, node(documentRef, 'span', '', 'I reviewed this warning preview'))
  warningLabel.hidden = true
  const reset = node(documentRef, 'button', 'secondary', 'Reset draft')
  const build = node(documentRef, 'button', '', 'Build Preview')
  const accept = node(documentRef, 'button', '', 'Accept as revision')
  const discard = node(documentRef, 'button', 'secondary', 'Discard session')
  for (const control of [reset, build, accept, discard]) control.type = 'button'
  quality.append(qualityMetrics, diagnostics, warningLabel, reset, build, accept, discard)
  workbench.append(header, canvasRegion, recipe, filmstrip, quality)
  root.replaceChildren(workbench)

  const renderer = createRenderer(canvas)
  let context = null
  let lastScrolledFrame = null
  let lastAiActionRenderKey = null
  let lastAnnouncedPreviewState = null
  let panPointer = null
  const listeners = []
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }
  listen(modes, 'click', (event) => {
    const mode = event.target.closest?.('[data-repair-mode]')?.dataset.repairMode
    if (mode) context?.setView({ mode })
  })
  listen(overlays, 'click', (event) => {
    const overlay = event.target.closest?.('[data-repair-overlay]')?.dataset.repairOverlay
    if (!overlay || !context) return
    const viewModel = context.viewModel()
    context.setView({ overlays: { ...viewModel.overlays, [overlay]: !viewModel.overlays[overlay] } })
  })
  const changeZoom = (factor) => {
    if (!context) return
    const viewModel = context.viewModel()
    context.setView({ zoom: Math.max(0.25, Math.min(4, viewModel.zoom * factor)) })
  }
  listen(zoomOut, 'click', () => changeZoom(0.5))
  listen(zoomIn, 'click', () => changeZoom(2))
  listen(zoomReset, 'click', () => context?.setView({ zoom: 1, pan: { x: 0, y: 0 } }))
  listen(canvas, 'wheel', (event) => {
    event.preventDefault()
    changeZoom(event.deltaY > 0 ? 0.5 : 2)
  })
  listen(canvas, 'pointerdown', (event) => {
    if (!context) return
    panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: context.viewModel().pan }
    canvas.setPointerCapture?.(event.pointerId)
  })
  listen(canvas, 'pointermove', (event) => {
    if (!panPointer || panPointer.id !== event.pointerId) return
    context?.setView({
      pan: {
        x: panPointer.pan.x + event.clientX - panPointer.x,
        y: panPointer.pan.y + event.clientY - panPointer.y,
      },
    })
  })
  const endPan = (event) => {
    if (panPointer?.id === event.pointerId) panPointer = null
  }
  listen(canvas, 'pointerup', endPan)
  listen(canvas, 'pointercancel', endPan)
  listen(reset, 'click', () => context?.resetDraft())
  listen(build, 'click', () => context?.buildPreview())
  listen(accept, 'click', async () => {
    const result = await context?.acceptPreview()
    if (result) onProjectAccepted(result)
  })
  listen(discard, 'click', () => context?.discard())
  listen(warningConfirmation, 'change', () => context?.confirmWarning(warningConfirmation.checked))
  listen(filmstripFirst, 'click', () => context?.handleFilmstripAction('first'))
  listen(filmstripPlay, 'click', () => context?.handleFilmstripAction('toggle_play'))
  listen(filmstripLast, 'click', () => context?.handleFilmstripAction('last'))
  listen(filmstripFrames, 'click', (event) => {
    const option = event.target.closest?.('[data-frame-option]')
    if (option) context?.selectFilmstripFrame(Number(option.dataset.frameOption))
  })
  listen(filmstripFrames, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(event.key)) return
    event.preventDefault()
    context?.handleFilmstripKey(event.key)
  })

  function renderQualityEvidence(viewModel) {
    const rows = viewModel.qualityRows.flatMap(({ label, value }) => [
      node(documentRef, 'dt', '', label),
      node(documentRef, 'dd', '', value == null ? 'Unavailable' : String(value)),
    ])
    qualityMetrics.replaceChildren(...rows)
    qualityMetrics.setAttribute('aria-label', 'Preview quality and Canvas evidence')
  }

  function render(viewModel) {
    assetName.value.textContent = viewModel.assetName
    assetName.value.title = viewModel.assetName
    revisionId.value.textContent = viewModel.revisionId
    revisionId.value.title = viewModel.revisionId
    immutable.value.textContent = viewModel.immutableLabel
    previewState.value.textContent = viewModel.previewState
    for (const control of modes.querySelectorAll('[data-repair-mode]')) {
      const mode = control.dataset.repairMode
      const availability = viewModel.modeAvailability[mode] ?? { enabled: false, reason: 'mode_unavailable' }
      control.disabled = !availability.enabled
      control.title = availability.reason ?? ''
      control.setAttribute('aria-label', availability.reason ? `${mode}: unavailable (${availability.reason})` : mode)
      control.setAttribute('aria-pressed', String(viewModel.mode === mode))
    }
    for (const control of overlays.querySelectorAll('[data-repair-overlay]')) {
      const overlay = control.dataset.repairOverlay
      const availability = viewModel.overlayAvailability[overlay]
      control.disabled = !availability.enabled
      control.title = availability.reason ?? ''
      control.setAttribute('aria-label', availability.reason ? `${overlay}: unavailable (${availability.reason})` : overlay)
      control.setAttribute('aria-pressed', String(viewModel.overlays[overlay] === true))
    }
    reset.disabled = !viewModel.canReset
    build.disabled = !viewModel.canBuild
    accept.disabled = !viewModel.canAccept
    accept.title = viewModel.acceptReason ?? ''
    diagnostics.textContent = viewModel.diagnosticText
    renderQualityEvidence(viewModel)
    warningLabel.hidden = !viewModel.warningRequired
    warningConfirmation.checked = viewModel.warningConfirmed
    zoomValue.value = `${Math.round(viewModel.zoom * 100)}%`
    zoomValue.textContent = zoomValue.value
    renderer.render(viewModel.renderFrame)
    if (viewModel.previewState !== lastAnnouncedPreviewState) {
      lastAnnouncedPreviewState = viewModel.previewState
      announce(`Repair preview state: ${viewModel.previewState}`)
    }
    renderGeometry(viewModel)
    renderRecipeControls(viewModel)
    renderFilmstrip(viewModel)
    if (viewModel.aiActionRenderKey !== lastAiActionRenderKey) {
      lastAiActionRenderKey = viewModel.aiActionRenderKey
      context?.renderAiAction(aiActionBody)
    }
  }

  return Object.freeze({
    open(nextContext) {
      if (workbench.parentNode !== root) root.replaceChildren(workbench)
      context = nextContext
      workbench.hidden = false
      closeRecipeDrawer({ restoreFocus: false })
      lifecycle.setSelection(nextContext.selection)
      render(nextContext.viewModel())
    },
    render,
    close(reason) {
      lifecycle.stop()
      closeRecipeDrawer({ restoreFocus: false })
      context?.onClose(reason)
      context = null
      lastScrolledFrame = null
      workbench.hidden = true
    },
    destroy() {
      lifecycle.stop()
      closeRecipeDrawer({ restoreFocus: false })
      renderer.destroy()
      for (const remove of listeners.splice(0)) remove()
      root.replaceChildren()
    },
  })
}
```

- [ ] **Step 7: Implement Geometry controls as one local-only slice.**

Wire Auto/Manual grid mode, seven X boundaries, seven Y boundaries, anchor
x/y, and selected-frame dx/dy through `updateRepairRecipeDraft()`. Construct
the full arrays as `[0, ...sevenValues, sourceDimension]`; never submit a
partial array. On invalid ordering, retain the typed draft value for form
feedback, mark the Recipe invalid/stale, draw the last valid overlay, and
disable Build with the stable validator reason. Run the panel test filtered to
Geometry before continuing:

```bash
node --test --test-name-pattern="Repair Geometry" test/editor-project/editorRepairWorkbenchPanel.test.js
```

Expected: PASS with zero Build fetches.

Add this Geometry builder inside the panel factory and call
`renderGeometry(viewModel)` from `render()`:

```js
function numberControl(label, pathValue, min, max) {
  const wrap = node(documentRef, 'label', 'editor-repair-field')
  wrap.append(node(documentRef, 'span', '', label))
  const input = node(documentRef, 'input')
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.step = '1'
  input.dataset.repairPath = pathValue
  const origin = node(documentRef, 'small', 'editor-repair-origin')
  const reason = node(documentRef, 'small', 'editor-repair-control-reason')
  reason.id = `editor-repair-reason-${pathValue.replaceAll('.', '-')}`
  reason.hidden = true
  input.setAttribute('aria-describedby', reason.id)
  wrap.append(input, origin, reason)
  return { wrap, input, origin, reason }
}

const geometry = node(documentRef, 'section', 'editor-repair-recipe-section')
geometry.append(node(documentRef, 'h3', '', 'Geometry'))
const sourceLayoutValue = node(documentRef, 'output', 'editor-repair-provenance-value')
sourceLayoutValue.dataset.repairField = 'source-layout'
const inputModeValue = node(documentRef, 'output', 'editor-repair-provenance-value')
inputModeValue.dataset.repairField = 'input-mode'
geometry.append(sourceLayoutValue, inputModeValue)
const gridMode = node(documentRef, 'select')
gridMode.dataset.repairControl = 'grid-mode'
const gridOrigin = node(documentRef, 'small', 'editor-repair-origin', 'Default')
const gridReason = node(documentRef, 'small', 'editor-repair-control-reason')
gridReason.id = 'editor-repair-reason-grid-mode'
gridReason.hidden = true
gridMode.setAttribute('aria-describedby', gridReason.id)
for (const [value, label] of [['auto', 'Auto'], ['manual', 'Manual']]) {
  const option = node(documentRef, 'option', '', label)
  option.value = value
  gridMode.append(option)
}
geometry.append(gridMode, gridOrigin, gridReason)
const gridInputs = { columns: [], rows: [] }
for (const [axis, label] of [['columns', 'X'], ['rows', 'Y']]) {
  const group = node(documentRef, 'div', 'editor-repair-grid-boundaries')
  for (let index = 1; index <= 7; index += 1) {
    const field = numberControl(`${label}${index}`, `grid.${axis}.${index}`, 1, Number.MAX_SAFE_INTEGER)
    field.input.dataset.repairControl = axis === 'columns' ? 'grid-x' : 'grid-y'
    field.input.dataset.boundaryAxis = axis
    field.input.dataset.boundaryIndex = String(index)
    gridInputs[axis].push(field)
    group.append(field.wrap)
  }
  geometry.append(group)
}
const anchorX = numberControl('Anchor X', 'anchor_offset.x', -16, 16)
const anchorY = numberControl('Anchor Y', 'anchor_offset.y', -16, 16)
const frameDx = numberControl('Frame dx', 'selected_frame.dx', -16, 16)
const frameDy = numberControl('Frame dy', 'selected_frame.dy', -16, 16)
anchorX.input.dataset.repairControl = 'anchor-x'
anchorY.input.dataset.repairControl = 'anchor-y'
frameDx.input.dataset.repairControl = 'frame-dx'
frameDy.input.dataset.repairControl = 'frame-dy'
geometry.append(anchorX.wrap, anchorY.wrap, frameDx.wrap, frameDy.wrap)
recipeBody.append(geometry)

function manualOverridesFromInputs(viewModel) {
  return {
    columns: [0, ...gridInputs.columns.map((field) => Number(field.input.value)), viewModel.sourceSize.width],
    rows: [0, ...gridInputs.rows.map((field) => Number(field.input.value)), viewModel.sourceSize.height],
  }
}

listen(gridMode, 'change', () => {
  context.patchDraft({
    path: 'grid.manual_overrides',
    value: gridMode.value === 'manual' ? manualOverridesFromInputs(context.viewModel()) : null,
  })
})
for (const field of [...gridInputs.columns, ...gridInputs.rows]) {
  listen(field.input, 'input', () => context.patchDraft({ path: 'grid.manual_overrides', value: manualOverridesFromInputs(context.viewModel()) }))
}
for (const field of [anchorX, anchorY]) {
  listen(field.input, 'input', () => context.patchDraft({ path: field.input.dataset.repairPath, value: Number(field.input.value) }))
}
for (const [field, component] of [[frameDx, 'dx'], [frameDy, 'dy']]) {
  listen(field.input, 'input', () => context.patchDraft({ path: `frame_adjustments.${context.viewModel().frameIndex}.${component}`, value: Number(field.input.value) }))
}

function renderGeometry(viewModel) {
  const manual = viewModel.recipe.grid.manual_overrides
  sourceLayoutValue.value = `${viewModel.recipe.source.source_layout} · Provenance`
  sourceLayoutValue.textContent = `Source layout · ${sourceLayoutValue.value}`
  inputModeValue.value = `${viewModel.inputMode} · Provenance`
  inputModeValue.textContent = `Input mode · ${inputModeValue.value}`
  gridMode.value = manual ? 'manual' : 'auto'
  gridMode.disabled = !viewModel.manualGrid.enabled
  gridMode.title = viewModel.manualGrid.reason ?? ''
  gridReason.textContent = viewModel.manualGrid.reason ?? ''
  gridReason.hidden = !viewModel.manualGrid.reason
  gridOrigin.textContent = (viewModel.fieldOrigins['grid.manual_overrides'] ?? 'default').replace(/^./, (value) => value.toUpperCase())
  const boundaryDisabledReason = !viewModel.manualGrid.enabled
    ? viewModel.manualGrid.reason
    : !manual
      ? 'Switch Grid mode to Manual to edit boundaries'
      : null
  for (const axis of ['columns', 'rows']) {
    gridInputs[axis].forEach((field, offset) => {
      const { input, reason } = field
      input.max = String(axis === 'columns' ? viewModel.sourceSize.width - 1 : viewModel.sourceSize.height - 1)
      input.value = String((manual?.[axis] ?? viewModel.autoGrid[axis])[offset + 1])
      input.disabled = !manual || !viewModel.manualGrid.enabled
      input.title = boundaryDisabledReason ?? ''
      reason.textContent = boundaryDisabledReason ?? ''
      reason.hidden = !boundaryDisabledReason
      input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('grid.manual_overrides')))
    })
  }
  anchorX.input.value = String(viewModel.recipe.anchor_offset.x)
  anchorY.input.value = String(viewModel.recipe.anchor_offset.y)
  frameDx.input.value = String(viewModel.selectedFrameAdjustment.dx)
  frameDy.input.value = String(viewModel.selectedFrameAdjustment.dy)
  frameDx.input.disabled = !viewModel.hasSelectedFrame
  frameDy.input.disabled = !viewModel.hasSelectedFrame
  for (const field of [frameDx, frameDy]) {
    const reason = viewModel.hasSelectedFrame ? null : 'Select a real clip frame to edit its offset'
    field.input.title = reason ?? ''
    field.reason.textContent = reason ?? ''
    field.reason.hidden = !reason
  }
  anchorX.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('anchor_offset.x')))
  anchorY.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('anchor_offset.y')))
  frameDx.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('frame_adjustments')))
  frameDy.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('frame_adjustments')))
  anchorX.origin.textContent = viewModel.fieldOrigins['anchor_offset.x'] === 'inherited' ? 'Inherited' : 'Default'
  anchorY.origin.textContent = viewModel.fieldOrigins['anchor_offset.y'] === 'inherited' ? 'Inherited' : 'Default'
  frameDx.origin.textContent = viewModel.fieldOrigins.frame_adjustments === 'inherited' ? 'Inherited' : 'Default'
  frameDy.origin.textContent = frameDx.origin.textContent
}
```

- [ ] **Step 8: Implement Cleanup, Pixel Finishing, And Advanced controls.**

Wire every remaining active row in the binding matrix with its exact numeric
attributes and enable condition. Disabling finishing retains its draft child
values but stops exposing them as active controls; disabling outline disables
mode; disabling stabilization disables max shift. Render Default/Inherited/
Forced/Provenance badges from the draft constructor's field-origin map. Run:

```bash
node --test --test-name-pattern="Repair Recipe bindings" test/editor-project/editorRepairWorkbenchPanel.test.js
```

Expected: PASS; every row changes only its named Recipe path and freshness.

Add the literal specs and generic binder; call `renderRecipeControls()` from
`render()` after `renderGeometry()`:

```js
const RECIPE_CONTROL_SPECS = Object.freeze([
  { section: 'Cleanup', control: 'background-mode', path: 'background.mode', type: 'select', options: ['auto', 'passthrough', 'flood', 'edge_palette', 'dual_matte'] },
  { section: 'Cleanup', control: 'background-tolerance', path: 'background.tolerance', type: 'number', min: 0, max: 80, step: 1 },
  { section: 'Cleanup', control: 'component-cleanup', path: 'cleanup.component_cleanup', type: 'checkbox' },
  { section: 'Cleanup', control: 'cleanup-min-alpha', path: 'cleanup.min_alpha', type: 'number', min: 0, max: 80, step: 1 },
  { section: 'Cleanup', control: 'cleanup-min-area', path: 'cleanup.min_area', type: 'number', min: 1, max: 64, step: 1 },
  { section: 'Cleanup', control: 'cleanup-min-ratio', path: 'cleanup.min_area_ratio', type: 'number', min: 0, max: 0.25, step: 0.01 },
  { section: 'Pixel Finishing', control: 'pixel-enabled', path: 'pixel_finishing.enabled', type: 'checkbox' },
  { section: 'Pixel Finishing', control: 'pixel-max-colors', path: 'pixel_finishing.max_colors', type: 'number', min: 1, max: 256, step: 1 },
  { section: 'Pixel Finishing', control: 'pixel-outline', path: 'pixel_finishing.outline', type: 'checkbox' },
  { section: 'Pixel Finishing', control: 'pixel-outline-mode', path: 'pixel_finishing.outline_mode', type: 'select', options: ['outer', 'inner', 'both', 'none'] },
  { section: 'Advanced correction', control: 'auto-correct', path: 'correction.auto_correct', type: 'checkbox' },
  { section: 'Advanced correction', control: 'motion-stabilize', path: 'correction.motion_stabilize', type: 'checkbox' },
  { section: 'Advanced correction', control: 'motion-max-shift', path: 'correction.motion_max_shift', type: 'number', min: 0, max: 4, step: 1 },
  { section: 'Advanced correction', control: 'locked-animations', path: 'locked_animations', type: 'multiple' },
  { section: 'Advanced correction', control: 'style-max-colors', path: 'style_report.max_colors', type: 'number', min: 1, max: 256, step: 1 },
])

function getPlainPath(value, pathValue) {
  return pathValue.split('.').reduce((cursor, part) => cursor?.[part], value)
}

const REPAIR_ERROR_PATHS = Object.freeze({
  invalid_background_tolerance: ['background.tolerance'],
  invalid_cleanup_min_alpha: ['cleanup.min_alpha'],
  invalid_cleanup_min_area: ['cleanup.min_area'],
  invalid_cleanup_min_area_ratio: ['cleanup.min_area_ratio'],
  invalid_motion_max_shift: ['correction.motion_max_shift'],
  invalid_anchor_x: ['anchor_offset.x'],
  invalid_anchor_y: ['anchor_offset.y'],
  invalid_manual_columns: ['grid.manual_overrides'],
  invalid_manual_rows: ['grid.manual_overrides'],
  invalid_frame_adjustments: ['frame_adjustments'],
  manual_grid_unavailable_for_fixed_regions: ['grid.manual_overrides'],
  dual_matte_requires_managed_black_matte: ['background.mode'],
  unknown_locked_animation: ['locked_animations'],
  style_report_required: ['style_report.enabled'],
  invalid_output_frame_sizes: ['outputs.frame_sizes'],
  workbench_staging_must_be_disabled: ['fixed_region_staging'],
})

export function repairInvalidPaths(blockingErrors = []) {
  return [...new Set(blockingErrors.flatMap((code) => REPAIR_ERROR_PATHS[code] ?? []))]
}
```

Continue inside `createRepairWorkbenchPanel()` with the DOM binder:

```js

const recipeControls = new Map()
const sections = new Map()
for (const spec of RECIPE_CONTROL_SPECS) {
  if (!sections.has(spec.section)) {
    const section = node(documentRef, 'section', 'editor-repair-recipe-section')
    section.append(node(documentRef, 'h3', '', spec.section))
    sections.set(spec.section, section)
    recipeBody.append(section)
  }
  const label = node(documentRef, 'label', 'editor-repair-field')
  label.append(node(documentRef, 'span', '', spec.control.replaceAll('-', ' ')))
  const control = node(documentRef, spec.type === 'select' || spec.type === 'multiple' ? 'select' : 'input')
  control.dataset.repairControl = spec.control
  control.dataset.repairPath = spec.path
  if (spec.type === 'checkbox') control.type = 'checkbox'
  if (spec.type === 'number') {
    control.type = 'number'
    control.min = String(spec.min)
    control.max = String(spec.max)
    control.step = String(spec.step)
  }
  if (spec.type === 'multiple') control.multiple = true
  for (const value of spec.options ?? []) {
    const option = node(documentRef, 'option', '', value)
    option.value = value
    control.append(option)
  }
  const origin = node(documentRef, 'small', 'editor-repair-origin')
  const reason = node(documentRef, 'small', 'editor-repair-control-reason')
  reason.id = `editor-repair-reason-${spec.control}`
  reason.hidden = true
  control.setAttribute('aria-describedby', reason.id)
  label.append(control, origin, reason)
  sections.get(spec.section).append(label)
  recipeControls.set(spec.path, { spec, control, origin, reason })
  listen(control, spec.type === 'number' ? 'input' : 'change', () => {
    const value = spec.type === 'checkbox'
      ? control.checked
      : spec.type === 'number'
        ? Number(control.value)
        : spec.type === 'multiple'
          ? [...control.selectedOptions].map((option) => option.value)
          : control.value
    context.patchDraft({ path: spec.path, value })
  })
}

const forcedEvidence = node(documentRef, 'section', 'editor-repair-recipe-section')
const styleEnabled = node(documentRef, 'output')
styleEnabled.dataset.repairControl = 'style-enabled'
const outputSizes = node(documentRef, 'output')
outputSizes.dataset.repairControl = 'output-sizes'
const fixedStaging = node(documentRef, 'output')
fixedStaging.dataset.repairEvidence = 'fixed-staging'
const pixelGrid = node(documentRef, 'button', 'secondary', 'Pixel Grid Refinement · Coming later')
pixelGrid.type = 'button'
pixelGrid.disabled = true
forcedEvidence.append(styleEnabled, outputSizes, fixedStaging, pixelGrid)
recipeBody.append(forcedEvidence)

function renderRecipeControls(viewModel) {
  for (const [pathValue, entry] of recipeControls) {
    if (entry.spec.type === 'multiple') {
      if (!entry.control.options.length) {
        for (const animation of viewModel.profileAnimations) {
          const option = node(documentRef, 'option', '', animation.label)
          option.value = animation.id
          entry.control.append(option)
        }
      }
      const selected = new Set(getPlainPath(viewModel.recipe, pathValue))
      for (const option of entry.control.options) option.selected = selected.has(option.value)
    } else if (entry.spec.type === 'checkbox') {
      entry.control.checked = getPlainPath(viewModel.recipe, pathValue) === true
    } else {
      entry.control.value = String(getPlainPath(viewModel.recipe, pathValue))
    }
    const availability = viewModel.controlAvailability[pathValue] ?? { enabled: true, reason: null }
    entry.control.disabled = !availability.enabled
    entry.control.title = availability.reason ?? ''
    entry.reason.textContent = availability.reason ?? ''
    entry.reason.hidden = !availability.reason
    entry.control.setAttribute('aria-invalid', String(viewModel.invalidPaths.has(pathValue)))
    const originValue = viewModel.fieldOrigins[pathValue] ?? 'default'
    entry.origin.textContent = originValue[0].toUpperCase() + originValue.slice(1)
  }
  const dualMatte = recipeControls.get('background.mode').control.querySelector('option[value="dual_matte"]')
  dualMatte.disabled = !viewModel.dualMatte.enabled
  dualMatte.title = viewModel.dualMatte.reason ?? ''
  styleEnabled.value = 'Style report enabled · Forced'
  styleEnabled.textContent = styleEnabled.value
  outputSizes.value = `${viewModel.recipe.outputs.frame_sizes.join(', ')} · Forced`
  outputSizes.textContent = outputSizes.value
  fixedStaging.value = viewModel.fixedStagingProvenance
  fixedStaging.textContent = viewModel.fixedStagingProvenance
}

export function buildRepairWorkbenchViewModel({
  local,
  aiAction,
  asset,
  revision,
  sourceContext,
  profile,
  validation,
  previewModel,
  renderFrame,
}) {
  const recipe = local.draft.recipe
  const finishing = recipe.pixel_finishing.enabled
  const outline = finishing && recipe.pixel_finishing.outline
  const motion = recipe.correction.motion_stabilize
  const passthrough = recipe.background.mode === 'passthrough'
  const clipEntries = Object.entries(asset.clips ?? {}).map(([id, value]) => ({ ...value, id }))
  const clip = clipEntries.find((item) => item.id === local.view.clipId) ?? clipEntries[0] ?? { id: '', frames: [], fps: 1 }
  const frameSize = profile.frame
  const sheetSize = { w: sourceContext.beforeImage.width, h: sourceContext.beforeImage.height }
  const filmstripItems = local.filmstrip.frames.map((frameIndex, index) => ({
    index,
    frameIndex,
    source: sourceContext.beforeImage,
    rect: resolveSheetFrameRect({ frameIndex, frameSize, sheetSize }),
  }))
  const commandOverlay = (command) => command.overlay ?? (
    command.type === 'anchor' ? 'anchor' :
      command.style === 'baseline' ? 'baseline' :
        command.style === 'bbox' ? 'bbox' :
          command.style === 'debug' ? 'debug' : 'cuts'
  )
  const overlayAvailability = Object.fromEntries(
    ['cuts', 'anchor', 'baseline', 'bbox', 'debug'].map((overlay) => {
      const enabled = renderFrame.overlayCommands.some((command) => commandOverlay(command) === overlay)
      const reason = enabled
        ? null
        : overlay === 'cuts' && sourceContext.sourceLayoutKind === 'fixed_regions'
          ? 'Cut overlay is unavailable for fixed-region sources; no uniform grid is fabricated'
          : `${overlay}_overlay_unavailable`
      return [overlay, { enabled, reason }]
    })
  )
  const visibleOverlayCommands = renderFrame.overlayCommands.filter((command) => local.view.overlays[commandOverlay(command)] === true)
  const evidence = previewModel.evidence ?? {}
  const ratio = (value) => value == null ? null : `${(value * 100).toFixed(1)}%`
  const wouldCrop = evidence.manualAdjustments?.wouldCrop ?? []
  const qualityRows = [
    { label: 'Validation', value: evidence.validationStatus ?? 'Not built' },
    { label: 'Blocking taxonomy', value: evidence.failureTaxonomy?.join(', ') || 'None' },
    { label: 'Unique colors', value: evidence.uniqueColors ?? null },
    { label: 'Palette changed', value: ratio(evidence.paletteChangedRatio) },
    { label: 'Halo pixels before / after', value: evidence.haloBefore == null || evidence.haloAfter == null ? null : `${evidence.haloBefore} / ${evidence.haloAfter}` },
    { label: 'Residue pixels before / after', value: evidence.residueBefore == null || evidence.residueAfter == null ? null : `${evidence.residueBefore} / ${evidence.residueAfter}` },
    { label: 'Outline ratio', value: ratio(evidence.outlineRatio) },
    { label: 'Components removed', value: evidence.componentCleanup?.removed_components ?? null },
    { label: 'Anchor / baseline', value: evidence.anchor || evidence.baseline ? `${JSON.stringify(evidence.anchor ?? {})} / ${JSON.stringify(evidence.baseline ?? {})}` : null },
    { label: 'Motion stabilization', value: evidence.motionStabilization == null ? null : `${evidence.motionStabilization.applied_count ?? 0} applied` },
    { label: 'Would crop', value: wouldCrop.length ? `${wouldCrop.length} frame(s); first: frame ${wouldCrop[0].frame}, dx ${wouldCrop[0].dx}, dy ${wouldCrop[0].dy}` : 'None' },
  ]
  const controlAvailability = {
    'background.tolerance': { enabled: !passthrough, reason: passthrough ? 'Passthrough does not use tolerance' : null },
    'pixel_finishing.max_colors': { enabled: finishing, reason: finishing ? null : 'Enable Pixel Finishing first' },
    'pixel_finishing.outline': { enabled: finishing, reason: finishing ? null : 'Enable Pixel Finishing first' },
    'pixel_finishing.outline_mode': { enabled: outline, reason: outline ? null : 'Enable finishing and outline first' },
    'correction.motion_max_shift': { enabled: motion, reason: motion ? null : 'Enable motion stabilization first' },
  }
  const adjustment = recipe.frame_adjustments?.[String(local.view.frameIndex)] ?? { dx: 0, dy: 0 }
  return {
    assetName: asset.name,
    revisionId: revision.id,
    immutableLabel: 'Immutable current revision',
    previewState: previewModel.state,
    mode: local.view.mode,
    zoom: local.view.zoom,
    pan: { ...local.view.pan },
    modeAvailability: previewModel.modeAvailability,
    overlays: { ...local.view.overlays },
    overlayAvailability,
    recipe,
    fieldOrigins: local.draft.fieldOrigins,
    sourceSize: sourceContext.sourceSize,
    inputMode: sourceContext.inputMode,
    autoGrid: sourceContext.autoGrid,
    manualGrid: sourceContext.manualGrid,
    invalidPaths: new Set(validation.invalidPaths ?? []),
    frameIndex: local.view.frameIndex,
    selectedFrameAdjustment: adjustment,
    hasSelectedFrame: local.filmstrip.frames.includes(local.view.frameIndex),
    profileAnimations: profile.animations.map((animation) => ({ id: animation.name, label: animation.name })),
    controlAvailability,
    dualMatte: sourceContext.dualMatte,
    fixedStagingProvenance: local.draft.provenance.fixedRegionStaging
      ? `Parent staging · Provenance · ${JSON.stringify(local.draft.provenance.fixedRegionStaging)}`
      : 'Parent staging · Provenance · none',
    canReset: !local.acceptInFlight && local.draft.dirty,
    canBuild: !local.acceptInFlight && validation.status !== 'fail' && !['queued', 'processing', 'accepting'].includes(previewModel.state),
    canAccept: !local.acceptInFlight && previewModel.acceptance.canAccept,
    acceptReason: previewModel.acceptance.reason,
    warningRequired: previewModel.state === 'warning',
    warningConfirmed: local.warningConfirmation?.confirmed === true &&
      local.warningConfirmation.jobId === local.preview?.jobId &&
      local.warningConfirmation.recipeHash === local.preview?.recipeHash,
    filmstrip: {
      clipId: clip.id,
      clips: clipEntries.map((item) => ({
        id: item.id,
        label: item.label ?? item.name ?? item.id,
        frameCount: item.frames?.length ?? 0,
      })),
      fps: clip.fps,
      durationMs: clip.frames.length ? (clip.frames.length * 1000) / clip.fps : 0,
      selectedIndex: local.filmstrip.selectedIndex,
      playing: local.filmstrip.playing,
      items: filmstripItems,
    },
    qualityRows,
    aiActionRenderKey: JSON.stringify([
      aiAction.assetId,
      aiAction.revisionId,
      aiAction.selectedAction,
      aiAction.providerPresetId,
      aiAction.imageSize,
      aiAction.status,
      aiAction.message,
      aiAction.plan?.can_run ?? null,
      aiAction.job?.id ?? null,
    ]),
    diagnosticText: previewModel.diagnostics.map((item) => item.message ?? item.code).join(' · '),
    renderFrame: {
      ...renderFrame,
      frameSize,
      zoom: local.view.zoom,
      pan: local.view.pan,
      overlayCommands: visibleOverlayCommands,
    },
  }
}
```

- [ ] **Step 9: Render the real bottom filmstrip.**

Add this renderer inside `createRepairWorkbenchPanel()`. It reuses already
decoded sheet images, performs no fetch/decode/layout read, exposes one real
option per selected-clip frame, and scrolls only when the selected frame
actually changes:

```js
function drawFilmstripThumbnail(canvas, item) {
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(
    item.source,
    item.rect.sx,
    item.rect.sy,
    item.rect.sw,
    item.rect.sh,
    0,
    0,
    canvas.width,
    canvas.height,
  )
}

const filmstripOptions = new Map()

function renderFilmstrip(viewModel) {
  const model = viewModel.filmstrip
  const clipSignature = JSON.stringify(model.clips)
  if (filmstripClip.dataset.signature !== clipSignature) {
    filmstripClip.dataset.signature = clipSignature
    filmstripClip.replaceChildren(...model.clips.map((clip) => {
      const option = node(documentRef, 'option')
      option.value = clip.id
      option.textContent = `${clip.label} · ${clip.frameCount}`
      return option
    }))
  }
  filmstripClip.disabled = model.clips.length === 0
  filmstripClip.value = model.clipId
  filmstripFirst.disabled = !model.items.length || model.selectedIndex === 0
  filmstripLast.disabled = !model.items.length || model.selectedIndex === model.items.length - 1
  filmstripPlay.disabled = model.items.length < 2
  filmstripPlay.textContent = model.playing ? 'Pause' : 'Play'
  filmstripPlay.setAttribute('aria-pressed', String(model.playing))
  const currentPosition = model.items.length ? model.selectedIndex + 1 : 0
  filmstripMeta.value = `${model.clipId || 'No clip'} · ${model.items.length} frames · ${(model.durationMs / 1000).toFixed(2)}s · ${currentPosition}/${model.items.length}`
  filmstripMeta.textContent = filmstripMeta.value

  const desiredKeys = new Set()
  const options = model.items.map((item) => {
    const key = `${model.clipId}:${item.index}:${item.frameIndex}`
    desiredKeys.add(key)
    let entry = filmstripOptions.get(key)
    if (!entry) {
      const option = node(documentRef, 'button', 'editor-repair-frame-option')
      option.type = 'button'
      const thumbnail = node(documentRef, 'canvas', 'editor-repair-frame-thumbnail')
      thumbnail.width = 48
      thumbnail.height = 48
      thumbnail.setAttribute('aria-hidden', 'true')
      const label = node(documentRef, 'span')
      option.append(thumbnail, label)
      entry = { option, thumbnail, label }
      filmstripOptions.set(key, entry)
    }
    const { option, thumbnail, label } = entry
    option.dataset.frameOption = String(item.index)
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(item.index === model.selectedIndex))
    option.setAttribute('aria-label', `${model.clipId} frame ${item.index + 1}, sheet frame ${item.frameIndex}`)
    option.tabIndex = item.index === model.selectedIndex ? 0 : -1
    drawFilmstripThumbnail(thumbnail, item)
    label.textContent = String(item.index + 1)
    return option
  })
  for (const [key, entry] of filmstripOptions) {
    if (!desiredKeys.has(key)) {
      entry.option.remove()
      filmstripOptions.delete(key)
    }
  }
  options.forEach((option, index) => {
    if (filmstripFrames.children[index] !== option) {
      filmstripFrames.insertBefore(option, filmstripFrames.children[index] ?? null)
    }
  })

  const scrollKey = `${model.clipId}:${model.selectedIndex}`
  if (scrollKey !== lastScrolledFrame) {
    lastScrolledFrame = scrollKey
    options[model.selectedIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}
```

Wire the selector once with the other stable panel listeners; it changes only
ephemeral review state and never calls lifecycle Build:

```js
listen(filmstripClip, 'change', () => {
  context?.selectClip(filmstripClip.value)
})
```

Run the filmstrip-only tests and expect PASS:

```bash
node --test --test-name-pattern="Repair filmstrip" test/editor-project/editorRepairWorkbenchPanel.test.js
```

- [ ] **Step 10: Extract current Repair ownership from `shell.js`.**

Move comparison/Recipe presentation into the panel and all local-session
loading, draft validation, playback, Preview polling/hydration, and Accept
orchestration into `repairWorkbenchController.js`. Keep shell responsibilities
to panel switching, constructing the controller, adopting a returned project
through `acceptProject()`, logs/toasts, and existing AI callbacks. The existing
inline Repair renderer/evidence/placeholder Recipe code is deleted, which—along
with the controller extraction—keeps `shell.js` below 3000 lines.

Use this ownership boundary; do not paste the long session functions later in
this task into `shell.js`:

| Module | Exact ownership |
| --- | --- |
| `repairWorkbenchPanel.js` | DOM, controls, view model, Canvas/filmstrip/quality rendering, drawer and accessibility. |
| `repairWorkbenchController.js` | `repairSelection`, draft patch/reset, open generation, managed artifact loading, playback timer, lifecycle events, freshness, hydration, Build/Accept payloads, and disposal. |
| `shell.js` | `ensureRepairWorkbench`, active-panel mode, `acceptProject(result.project)`, selection/log rendering, and `renderExistingAiActionRepair`. |

Create the controller with this exact public boundary; the named private
functions are the complete bodies supplied later in Steps 10 and 13 and must
be declared inside this factory before the return:

```js
export function createRepairWorkbenchController({
  state,
  profile,
  artifactClient,
  lifecycle,
  getSelectedAsset,
  requestRender,
  addLog,
  renderAiActionContent,
}) {
  const editorState = state
  const selectedRepairAsset = getSelectedAsset
  const renderAll = requestRender
  const addEditorLog = addLog
  const repairArtifactClient = artifactClient
  const repairPreviewLifecycle = lifecycle
  const TOPDOWN_RPG_V0 = profile
  let repairWorkbench = null
  let repairPlaybackTimer = null
  let repairOpenGeneration = 0

  function attach(panel) {
    repairWorkbench = panel
  }

  function dispose() {
    clearLocalRepairAsyncWork()
    repairWorkbench = null
  }

  return Object.freeze({
    attach,
    dispose,
    openAsset: openRepairForAsset,
    contextFor: repairWorkbenchContext,
    handleLifecycleUpdate: handleRepairLifecycleUpdate,
  })
}
```

`openRepairForAsset()` initializes from real artifacts and never treats
`asset.profile` as layout authority. The shell constructs one controller,
calls `attach(panel)` after the stable panel is created, uses
`contextFor(asset, revision)` when rendering, and calls `dispose()` from
`cleanupEditorShell()`.

Put these imports with the private session bodies in
`repairWorkbenchController.js`:

```js
import {
  applyRepairDraftSettingsHash,
  createRepairRecipeDraft,
  updateRepairRecipeDraft,
  validateRepairRecipeDraft,
} from '../../editor-project/repairRecipe.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from '../../editor-project/repairRecipeSerialization.js'
import {
  getRepairAcceptanceState,
  getRepairPreviewFreshness,
  reduceRepairFilmstrip,
} from '../../editor-project/repairState.js'
import { validateProcessingRecipe } from '../../editor-project/validation.js'
import { hashRepairRecipeBytes } from './repairHash.js'
import { normalizeRepairEvidence } from './repairEvidence.js'
import {
  buildDifferencePixels,
  createRepairDifferenceSource,
  getRepairComparisonAvailability,
  readRepairFramePixels,
  resolveSheetFrameRect,
} from './repairComparisonRenderer.js'
import {
  buildRepairDraftOverlayCommands,
  buildRepairWorkbenchViewModel,
  createInitialRepairRenderFrame,
  createNoPreviewModel,
  repairInvalidPaths,
} from './repairWorkbenchPanel.js'
import { createEmptyLocalRepairState } from './state.js'
import { resolveSourceLayout } from '../../character-pack/sourceLayouts.js'
```

In `shell.js`, import only the setup/mount boundaries and retain its existing
DOM helpers and AI flow imports:

```js
import { TOPDOWN_RPG_V0 } from '../../character-pack/profile.js'
import {
  acceptCharacterReprocessPreview,
  buildCharacterReprocessPreview,
  fetchJob,
} from './api.js'
import { createRepairArtifactClient } from './artifactClient.js'
import { hashRepairRecipeBytes } from './repairHash.js'
import { createRepairPreviewLifecycle } from './repairPreviewLifecycle.js'
import { createRepairComparisonRenderer } from './repairComparisonRenderer.js'
import { createRepairWorkbenchController } from './repairWorkbenchController.js'
import { createRepairWorkbenchPanel } from './repairWorkbenchPanel.js'

const elements = {
  main: document.querySelector('.editor-main'),
  stagePanel: document.querySelector('.editor-stage-panel'),
  panelBody: document.querySelector('#editor-panel-body'),
  stageLive: document.querySelector('#editor-stage-live'),
}

function clear(node) {
  node.replaceChildren()
}

let repairWorkbench = null
let repairController = null

function ensureRepairController() {
  if (repairController) return repairController
  repairController = createRepairWorkbenchController({
    state: editorState,
    profile: TOPDOWN_RPG_V0,
    artifactClient: repairArtifactClient,
    lifecycle: repairPreviewLifecycle,
    getSelectedAsset: selectedRepairAsset,
    requestRender: renderAll,
    addLog: addEditorLog,
    renderAiActionContent: renderExistingAiActionRepair,
  })
  return repairController
}

function ensureRepairWorkbench() {
  if (repairWorkbench) return repairWorkbench
  repairWorkbench = createRepairWorkbenchPanel({
    root: elements.panelBody,
    lifecycle: repairPreviewLifecycle,
    createRenderer: (canvas) => createRepairComparisonRenderer({
      canvas,
      requestFrame: requestAnimationFrame,
      cancelFrame: cancelAnimationFrame,
      observeResize: (callback) => {
        const observer = new ResizeObserver((entries) => callback(entries[0].contentRect))
        observer.observe(canvas)
        return observer
      },
    }),
    onProjectAccepted: (result) => {
      acceptProject(result.project)
      editorState.selectedAssetId = result.asset.id
      editorState.selectedLayerId = null
      editorState.activePanel = 'repair'
      void ensureRepairController().openAsset(result.asset)
    },
    announce: (message) => { elements.stageLive.textContent = message },
  })
  ensureRepairController().attach(repairWorkbench)
  return repairWorkbench
}

```

Place the following selection/context body inside
`createRepairWorkbenchController()` before its return:

```js
function repairSelection(asset, revision) {
  return {
    projectId: editorState.project.id,
    projectRevision: editorState.project.revision,
    assetId: asset.id,
    revisionId: revision.id,
  }
}

function repairWorkbenchContext(asset, revision) {
  const local = editorState.repair.local
  return {
    selection: repairSelection(asset, revision),
    viewModel: () => buildRepairWorkbenchViewModel({
      local,
      aiAction: editorState.repair.aiAction,
      asset,
      revision,
      sourceContext: local.sourceContext,
      profile: local.profile,
      validation: local.validation,
      previewModel: local.previewModel,
      renderFrame: local.renderFrame,
    }),
    setView(patch) {
      local.view = { ...local.view, ...patch }
      local.renderFrame = { ...local.renderFrame, mode: local.view.mode }
      repairWorkbench.render(this.viewModel())
    },
    patchDraft(patch) {
      const draftHashGeneration = repairPreviewLifecycle.invalidateDraft()
      const nextDraft = updateRepairRecipeDraft(local.draft, patch)
      const validation = validateRepairRecipeDraft(nextDraft, local.validationContext)
      local.draft = nextDraft
      local.validation = {
        ...validation,
        invalidPaths: repairInvalidPaths(validation.blocking_errors),
      }
      local.warningConfirmation = null
      local.previewModel = { ...local.previewModel, state: local.preview ? 'stale' : 'dirty' }
      if (validation.status !== 'fail') {
        local.lastValidCanonical = validation.canonical
        local.renderFrame = {
          ...local.renderFrame,
          overlayCommands: buildRepairDraftOverlayCommands({
            recipe: validation.canonical,
            profile: local.profile,
            frameIndex: local.view.frameIndex,
            sourceSize: local.sourceContext.sourceSize,
            sourceLayoutKind: local.sourceContext.sourceLayoutKind,
            bbox: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.bbox ?? null,
            debugAnchor: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.anchor ?? null,
          }),
        }
        void repairPreviewLifecycle.digestDraft(
          serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical)),
          { generation: draftHashGeneration },
        )
      }
      repairWorkbench.render(this.viewModel())
    },
    resetDraft() { resetLocalRepairDraft(); repairWorkbench.render(this.viewModel()) },
    buildPreview() { return buildLocalRepairPreview() },
    acceptPreview() { return acceptLocalRepairPreview() },
    discard() { discardLocalRepairSession() },
    handleFilmstripKey(key) { dispatchRepairFilmstrip({ type: filmstripEventTypeForKey(key), key, filmstripFocused: true }) },
    handleFilmstripAction(type) { dispatchRepairFilmstrip({ type }) },
    selectClip(clipId) { selectRepairClip(clipId) },
    selectFilmstripFrame(index) { dispatchRepairFilmstrip({ type: 'select', index }) },
    confirmWarning(confirmed) { confirmLocalRepairWarning(confirmed) },
    renderAiAction(container) { renderAiActionContent(container) },
    onClose() { clearLocalRepairAsyncWork() },
  }
}

```

Continue the small shell adapter with:

```js

function renderRepairPanel() {
  const asset = selectedRepairAsset()
  const revision = asset?.revisions?.[asset.active_revision_id]
  if (!asset || asset.kind !== 'character_pack' || !revision) {
    renderRepairUnavailableState(elements.panelBody, asset)
    return
  }
  const local = editorState.repair.local
  const selectionMatches = local.selection?.projectId === editorState.project.id &&
    local.selection?.projectRevision === editorState.project.revision &&
    local.selection?.assetId === asset.id &&
    local.selection?.revisionId === revision.id
  if (!selectionMatches || !local.draft) {
    if (local.status === 'idle' || !selectionMatches) void ensureRepairController().openAsset(asset)
    const status = document.createElement('div')
    status.className = 'editor-repair-load-state'
    status.dataset.status = local.status
    status.setAttribute('aria-live', 'polite')
    status.textContent = local.message || (local.status === 'failed' ? 'Repair could not be opened.' : 'Loading managed Character Pack artifacts…')
    elements.panelBody.replaceChildren(status)
    return
  }
  const panel = ensureRepairWorkbench()
  panel.open(ensureRepairController().contextFor(asset, revision))
}

function renderBottomPanel() {
  if (editorState.activePanel === 'repair') {
    elements.main.dataset.workspaceMode = 'repair'
    elements.stagePanel.dataset.workspaceMode = 'repair'
    renderRepairPanel()
    return
  }
  repairWorkbench?.close('panel_switch')
  delete elements.main.dataset.workspaceMode
  delete elements.stagePanel.dataset.workspaceMode
  clear(elements.panelBody)
  PANEL_RENDERERS[editorState.activePanel]?.()
}
```

Add the Workbench teardown to the existing shell cleanup before it returns:

```js
repairController?.dispose()
repairController = null
repairWorkbench?.destroy()
repairWorkbench = null
```

Move existing `planRepairAction()` / `runRepairAction()` DOM creation behind
`renderExistingAiActionRepair(container)` without changing their request,
quota confirmation, provider preset, or general-import behavior. In the panel
`render()` call `context.renderAiAction(aiAction)` only when its state changed,
not on animation RAF.

Inside `createRepairWorkbenchController()`, add this artifact-backed private
`openRepairForAsset()` initializer:

```js
function managedArtifactUrl(ref) {
  return `/api/editor/artifact?path=${encodeURIComponent(ref)}`
}

async function optionalManagedJson(identity, ref, allowedManagedUrls) {
  if (!ref) return { value: null, diagnostic: null }
  try {
    return {
      value: await repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(ref), allowedManagedUrls }),
      diagnostic: null,
    }
  } catch (error) {
    if (error?.status === 404 || error?.code === 'artifact_not_found') return { value: null, diagnostic: null }
    if (error instanceof SyntaxError) return { value: null, diagnostic: 'invalid_parent_recipe_defaulted' }
    throw error
  }
}

function uniformBoundaries(size, count) {
  return Array.from({ length: count + 1 }, (_, index) => Math.round((size * index) / count))
}

function repairLayoutCandidate(layoutId, inputMode) {
  if (!layoutId) return null
  try {
    const layout = resolveSourceLayout(layoutId)
    if (layout.profile && layout.profile !== TOPDOWN_RPG_V0.id) return null
    if (inputMode === 'normalized_sheet_fallback' && layout.id !== TOPDOWN_RPG_V0.id) return null
    return layout
  } catch {
    return null
  }
}

function createRepairSourceContext({ inputMode, layout, revision, inputImage, beforeImage, blackMatteImage }) {
  const blackMatteRef = blackMatteImage ? revision.artifacts.black_matte : null
  return {
    inputMode,
    sourceLayout: layout.id,
    sourceLayoutKind: layout.kind,
    sourceFileName: (revision.artifacts.source ?? revision.artifacts.sheet).split('/').at(-1),
    sourceSize: { width: inputImage.width, height: inputImage.height },
    blackMatteArtifactRef: blackMatteRef,
    beforeImage,
    autoGrid: {
      columns: uniformBoundaries(inputImage.width, TOPDOWN_RPG_V0.grid.columns),
      rows: uniformBoundaries(inputImage.height, TOPDOWN_RPG_V0.grid.rows),
    },
    manualGrid: {
      enabled: inputMode === 'managed_source' && layout.kind === 'uniform_grid',
      reason: inputMode !== 'managed_source'
        ? 'Manual cuts are unavailable for normalized-sheet fallback'
        : layout.kind !== 'uniform_grid'
          ? 'Manual cuts are unavailable for fixed-region sources'
          : null,
    },
    dualMatte: {
      enabled: inputMode === 'managed_source' && Boolean(blackMatteRef),
      reason: inputMode !== 'managed_source'
        ? 'Dual matte is unavailable for normalized-sheet fallback'
        : !blackMatteRef
          ? 'No valid managed black matte is recorded'
          : null,
    },
  }
}

async function openRepairForAsset(asset) {
  const revision = asset?.revisions?.[asset.active_revision_id]
  if (!editorState.project || asset?.kind !== 'character_pack' || !revision) return
  clearLocalRepairAsyncWork()
  const generation = ++repairOpenGeneration
  const loading = createEmptyLocalRepairState()
  loading.openGeneration = generation
  loading.selection = repairSelection(asset, revision)
  loading.status = 'loading'
  loading.message = 'Loading managed Character Pack artifacts…'
  editorState.repair.local = loading
  editorState.selectedAssetId = asset.id
  editorState.selectedLayerId = null
  editorState.activePanel = 'repair'
  repairPreviewLifecycle.setSelection(loading.selection)
  renderAll()
  const identity = `${asset.id}:${revision.id}`
  const allowedManagedUrls = new Set(
    [revision.processing_recipe_ref, ...Object.values(revision.artifacts ?? {})]
      .filter(Boolean)
      .map(managedArtifactUrl)
  )
  let recipeLoad
  let debugLoad
  let animations
  let beforeImage
  let inputImage
  let blackMatteImage
  try {
    ;[recipeLoad, debugLoad, animations, beforeImage, inputImage, blackMatteImage] = await Promise.all([
      optionalManagedJson(identity, revision.processing_recipe_ref, allowedManagedUrls),
      optionalManagedJson(identity, revision.artifacts.debug_report, allowedManagedUrls),
      repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(revision.artifacts.animations), allowedManagedUrls }),
      repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.sheet), allowedManagedUrls }),
      repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.source ?? revision.artifacts.sheet), allowedManagedUrls }),
      revision.artifacts.black_matte
        ? repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.black_matte), allowedManagedUrls })
        : Promise.resolve(null),
    ])
  } catch (error) {
    if (editorState.repair.local.openGeneration !== generation) return
    editorState.repair.local.status = 'failed'
    editorState.repair.local.error = error
    editorState.repair.local.message = `${error.code ?? 'artifact_load_failed'}: ${error.message || error}`
    renderAll()
    return
  }
  if (editorState.repair.local.openGeneration !== generation) return
  try {
  const inputMode = revision.artifacts.source ? 'managed_source' : 'normalized_sheet_fallback'
  let loadedRecipe = recipeLoad.value
  let parentRecipeDiagnostic = recipeLoad.diagnostic
  if (loadedRecipe && validateProcessingRecipe(loadedRecipe).status === 'fail') {
    loadedRecipe = null
    parentRecipeDiagnostic = 'invalid_parent_recipe_defaulted'
  }
  const recipeLayout = repairLayoutCandidate(loadedRecipe?.source?.source_layout, inputMode)
  if (loadedRecipe && !recipeLayout) {
    loadedRecipe = null
    parentRecipeDiagnostic = 'invalid_parent_recipe_layout_defaulted'
  }
  const debugLayout = repairLayoutCandidate(debugLoad.value?.source_layout?.id, inputMode)
  const animationLayout = repairLayoutCandidate(animations.source_layout?.id, inputMode)
  const sourceDiagnostics = [debugLoad.diagnostic]
  if (debugLoad.value?.source_layout?.id && !debugLayout) sourceDiagnostics.push('debug_source_layout_invalid')
  if (animations.source_layout?.id && !animationLayout) sourceDiagnostics.push('animations_source_layout_invalid')
  const fallbackLayout = inputMode === 'normalized_sheet_fallback'
    ? resolveSourceLayout(TOPDOWN_RPG_V0.id)
    : debugLayout ?? animationLayout
  let selectedLayout = recipeLayout ?? fallbackLayout
  if (!selectedLayout) throw Object.assign(new Error('No registered compatible source layout is available'), { code: 'missing_source_layout' })
  let sourceContext = createRepairSourceContext({ inputMode, layout: selectedLayout, revision, inputImage, beforeImage, blackMatteImage })
  let draft = createRepairRecipeDraft({ asset, revision, loadedRecipe, sourceContext })
  if (parentRecipeDiagnostic) draft.diagnostics.push(parentRecipeDiagnostic)
  draft.diagnostics.push(...sourceDiagnostics.filter(Boolean))
  let validationContext = {
    profile: TOPDOWN_RPG_V0,
    sourceSize: sourceContext.sourceSize,
    inputMode,
    sourceLayoutKind: sourceContext.sourceLayoutKind,
    hasBlackMatte: sourceContext.dualMatte.enabled,
    implementationRevision: null,
  }
  let validation = validateRepairRecipeDraft(draft, validationContext)
  if (loadedRecipe && validation.status === 'fail') {
    selectedLayout = fallbackLayout
    if (!selectedLayout) throw Object.assign(new Error('No valid fallback source layout is available'), { code: 'missing_source_layout' })
    sourceContext = createRepairSourceContext({ inputMode, layout: selectedLayout, revision, inputImage, beforeImage, blackMatteImage })
    validationContext = {
      ...validationContext,
      sourceSize: sourceContext.sourceSize,
      sourceLayoutKind: sourceContext.sourceLayoutKind,
      hasBlackMatte: sourceContext.dualMatte.enabled,
    }
    draft = createRepairRecipeDraft({ asset, revision, loadedRecipe: null, sourceContext })
    draft.diagnostics.push('invalid_parent_recipe_defaulted')
    draft.diagnostics.push(...sourceDiagnostics.filter(Boolean))
    validation = validateRepairRecipeDraft(draft, validationContext)
  }
  const clipId = Object.keys(asset.clips)[0] ?? ''
  const frames = asset.clips[clipId]?.frames ?? []
  const local = createEmptyLocalRepairState()
  local.openGeneration = generation
  local.selection = repairSelection(asset, revision)
  local.sourceContext = sourceContext
  local.profile = TOPDOWN_RPG_V0
  local.validationContext = validationContext
  local.validation = { ...validation, invalidPaths: repairInvalidPaths(validation.blocking_errors) }
  local.lastValidCanonical = validation.canonical
  const initialDraftSettingsHash = await hashRepairRecipeBytes(
    serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical ?? draft.recipe))
  )
  if (editorState.repair.local.openGeneration !== generation) return
  local.draft = applyRepairDraftSettingsHash(draft, initialDraftSettingsHash, { initialize: true })
  local.currentDraftSettingsHash = initialDraftSettingsHash
  local.filmstrip = { frames: [...frames], selectedIndex: 0, playing: false }
  local.view.clipId = clipId
  local.view.frameIndex = frames[0] ?? null
  local.renderFrame = createInitialRepairRenderFrame({ local, beforeImage })
  local.previewModel = createNoPreviewModel({ beforeImage, frames })
  local.status = 'idle'
  local.message = ''
  editorState.repair.local = local
  renderAll()
  } catch (error) {
    if (editorState.repair.local.openGeneration !== generation) return
    editorState.repair.local.status = 'failed'
    editorState.repair.local.error = error
    editorState.repair.local.message = `${error.code ?? 'repair_initialization_failed'}: ${error.message || error}`
    renderAll()
  }
}
```

Add these two pure initializers to `repairWorkbenchPanel.js`:

```js
export function createNoPreviewModel({ beforeImage, frames }) {
  const hasFrame = frames.length > 0
  return {
    state: 'no_preview',
    frames: [...frames],
    modeAvailability: getRepairComparisonAvailability({ before: hasFrame ? beforeImage : null, after: null }),
    acceptance: { canAccept: false, reason: 'no_preview' },
    diagnostics: hasFrame
      ? [{ code: 'no_preview', message: 'Build Preview to compare processed output.' }]
      : [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }],
  }
}

export function buildRepairDraftOverlayCommands({
  recipe,
  profile,
  frameIndex,
  sourceSize = profile.sheet,
  sourceLayoutKind = 'uniform_grid',
  bbox = null,
  debugAnchor = null,
}) {
  if (!Number.isInteger(frameIndex)) return []
  const adjustment = recipe.frame_adjustments?.[String(frameIndex)] ?? { dx: 0, dy: 0 }
  const grid = sourceLayoutKind === 'uniform_grid' ? recipe.grid.manual_overrides ?? {
    columns: Array.from({ length: profile.grid.columns + 1 }, (_, index) => Math.round((sourceSize.width * index) / profile.grid.columns)),
    rows: Array.from({ length: profile.grid.rows + 1 }, (_, index) => Math.round((sourceSize.height * index) / profile.grid.rows)),
  } : null
  const inset = { x: 4, y: 4, w: 28, h: 28 }
  const cutCommands = grid ? [
    ...grid.columns.map((value) => {
      const x = inset.x + (value / sourceSize.width) * inset.w
      return { type: 'line', x1: x, y1: inset.y, x2: x, y2: inset.y + inset.h, style: 'cut', overlay: 'cuts' }
    }),
    ...grid.rows.map((value) => {
      const y = inset.y + (value / sourceSize.height) * inset.h
      return { type: 'line', x1: inset.x, y1: y, x2: inset.x + inset.w, y2: y, style: 'cut', overlay: 'cuts' }
    }),
  ] : []
  return [...buildRepairOverlayCommands({
    anchor: {
      x: profile.anchor.x + recipe.anchor_offset.x + adjustment.dx,
      y: profile.anchor.y + recipe.anchor_offset.y + adjustment.dy,
    },
    baselineY: profile.baselineY + recipe.anchor_offset.y + adjustment.dy,
    bbox,
  }), ...cutCommands, ...(debugAnchor ? [{ type: 'anchor', x: debugAnchor.x, y: debugAnchor.y, style: 'debug', overlay: 'debug' }] : [])]
}

export function createInitialRepairRenderFrame({ local, beforeImage }) {
  const frameSize = local.profile.frame
  const hasFrame = Number.isInteger(local.view.frameIndex)
  const beforeRect = hasFrame ? resolveSheetFrameRect({
    frameIndex: local.view.frameIndex,
    frameSize,
    sheetSize: { w: beforeImage.width, h: beforeImage.height },
  }) : null
  const drawOverlay = (ctx, command, viewport) => {
    const scaleX = viewport.w / frameSize.w
    const scaleY = viewport.h / frameSize.h
    const x = (value) => viewport.x + (value === 'width' ? frameSize.w : value) * scaleX
    const y = (value) => viewport.y + (value === 'height' ? frameSize.h : value) * scaleY
    ctx.save()
    ctx.strokeStyle = command.style === 'baseline' ? '#75f0d3' : command.style === 'bbox' ? '#f3cc7f' : '#ffaaa4'
    ctx.lineWidth = 1
    if (command.type === 'line') {
      ctx.beginPath()
      ctx.moveTo(x(command.x1), y(command.y1))
      ctx.lineTo(x(command.x2), y(command.y2))
      ctx.stroke()
    }
    if (command.type === 'rect') ctx.strokeRect(x(command.x), y(command.y), command.w * scaleX, command.h * scaleY)
    if (command.type === 'anchor') {
      ctx.beginPath()
      ctx.arc(x(command.x), y(command.y), 3, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
  return {
    mode: 'before',
    before: hasFrame ? beforeImage : null,
    after: null,
    afterSheet: null,
    beforeRect,
    afterRect: null,
    split: 0.5,
    onionAlpha: 0.5,
    viewport: { x: 0, y: 0, w: frameSize.w, h: frameSize.h },
    differenceImageData: null,
    differenceSource: null,
    frameSize,
    zoom: local.view.zoom,
    pan: local.view.pan,
    playing: false,
    emptyMessage: hasFrame ? null : 'The selected clip has no frames to display.',
    overlayCommands: buildRepairDraftOverlayCommands({
      recipe: local.draft.recipe,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
    }),
    drawOverlay,
  }
}
```

- [ ] **Step 11: Implement the approved desktop grid.**

In focused Repair mode collapse the normal Stage rows and let the bottom panel
become the work area before applying the internal grid:

```css
.editor-main[data-workspace-mode="repair"] {
  grid-template-columns: minmax(0, 1fr);
}

.editor-main[data-workspace-mode="repair"] > .editor-asset-panel,
.editor-main[data-workspace-mode="repair"] > .editor-inspector-panel,
.editor-stage-panel[data-workspace-mode="repair"] > .editor-stage-toolbar,
.editor-stage-panel[data-workspace-mode="repair"] > .editor-stage {
  display: none;
}

.editor-stage-panel[data-workspace-mode="repair"] {
  grid-template-rows: minmax(0, 1fr);
}

.editor-stage-panel[data-workspace-mode="repair"] > .editor-bottom-panel {
  grid-row: 1;
  grid-template-rows: 42px minmax(0, 1fr);
}

.editor-stage-panel[data-workspace-mode="repair"] .editor-panel-body {
  overflow: hidden;
  padding: 0;
}
```

Then use this central grid:

```css
.editor-repair-workbench {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  grid-template-rows: auto minmax(280px, 1fr) minmax(116px, auto) auto;
  grid-template-areas:
    "header header"
    "canvas recipe"
    "filmstrip recipe"
    "quality quality";
}

.editor-repair-canvas-region,
.editor-repair-recipe,
.editor-repair-filmstrip,
.editor-repair-quality {
  min-width: 0;
  min-height: 0;
}

.editor-repair-header { grid-area: header; }
.editor-repair-canvas-region { grid-area: canvas; }
.editor-repair-recipe { grid-area: recipe; }
.editor-repair-filmstrip { grid-area: filmstrip; }
.editor-repair-quality { grid-area: quality; }

.editor-repair-header {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--editor-border, #d5d9e0);
}

.editor-repair-header-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-repair-canvas-region {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--editor-canvas-surface, #eef2f7);
}

.editor-repair-modes,
.editor-repair-overlays,
.editor-repair-zoom-controls,
.editor-repair-filmstrip-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
}

.editor-repair-canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  image-rendering: pixelated;
}

.editor-repair-recipe {
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--editor-border, #d5d9e0);
  background: var(--editor-panel, #fff);
}

.editor-repair-recipe-section {
  display: grid;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--editor-border, #d5d9e0);
}

.editor-repair-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(88px, 120px);
  gap: 4px 8px;
  align-items: center;
}

.editor-repair-origin {
  justify-self: end;
  border-radius: 999px;
  padding: 1px 6px;
  background: var(--editor-badge, #edf1f7);
  font-size: 11px;
}

.editor-repair-control-reason {
  grid-column: 1 / -1;
  color: var(--editor-muted, #667085);
}

.editor-repair-filmstrip {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.editor-repair-filmstrip-frames {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

.editor-repair-frame-option {
  flex: 0 0 auto;
  border: 1px solid transparent;
  padding: 4px;
}

.editor-repair-frame-option[aria-selected="true"] {
  border-color: var(--editor-accent, #276ee8);
  background: var(--editor-selected, #e8f0ff);
}

.editor-repair-frame-thumbnail {
  display: block;
  width: 48px;
  height: 48px;
  image-rendering: pixelated;
}

.editor-repair-canvas:focus-visible,
.editor-repair-filmstrip-frames:focus-visible,
.editor-repair-frame-option:focus-visible,
.editor-repair-workbench button:focus-visible,
.editor-repair-workbench input:focus-visible,
.editor-repair-workbench select:focus-visible {
  outline: 2px solid var(--editor-focus, #74a7ff);
  outline-offset: 2px;
}

.editor-repair-quality {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--editor-border, #d5d9e0);
  background: var(--editor-panel, #fff);
}

.editor-repair-quality-metrics {
  display: grid;
  grid-template-columns: repeat(2, auto minmax(0, 1fr));
  gap: 2px 8px;
  flex: 1 1 520px;
  min-width: 0;
  margin: 0;
}

.editor-repair-diagnostics,
.editor-repair-warning-confirmation {
  flex: 1 1 100%;
}

.editor-repair-load-state {
  display: grid;
  place-items: center;
  min-height: 240px;
  padding: 24px;
}
```

The central work area grows with viewport height. At 1440x900 a long Recipe
must scroll to its final AI Action section without clipping the Canvas,
filmstrip, or action bar. Filmstrip overflow remains internal and horizontal;
no page-level horizontal overflow is allowed.

- [ ] **Step 12: Implement the mobile Recipe drawer.**

At `max-width: 760px`, stack header, Canvas, filmstrip, and actions. Add a focusable Recipe trigger with `aria-expanded`/`aria-controls`; opening traps focus within the drawer, Escape closes it, and focus returns to the trigger. Closing Repair must also close the drawer. Keep action buttons reachable without horizontal scrolling.

Add the trigger immediately after `header` creation and the drawer handlers
inside the panel factory:

```js
const recipeTrigger = node(documentRef, 'button', 'secondary editor-repair-recipe-trigger', 'Recipe')
recipeTrigger.type = 'button'
recipeTrigger.setAttribute('aria-controls', 'editor-repair-recipe')
recipeTrigger.setAttribute('aria-expanded', 'false')
header.append(recipeTrigger)
const recipeClose = node(documentRef, 'button', 'secondary editor-repair-recipe-close', 'Close Recipe')
recipeClose.type = 'button'
recipe.prepend(recipeClose)
const recipeBackdrop = node(documentRef, 'button', 'editor-repair-recipe-backdrop', 'Close Recipe')
recipeBackdrop.type = 'button'
recipeBackdrop.hidden = true
recipeBackdrop.setAttribute('aria-label', 'Close Processing Recipe')
workbench.append(recipeBackdrop)

function recipeFocusable() {
  return [...recipe.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')]
}

function closeRecipeDrawer({ restoreFocus = true } = {}) {
  const narrow = documentRef.defaultView?.matchMedia?.('(max-width: 760px)').matches === true
  workbench.dataset.recipeOpen = 'false'
  recipeTrigger.setAttribute('aria-expanded', 'false')
  recipe.removeAttribute('role')
  recipe.removeAttribute('aria-modal')
  if (narrow) recipe.setAttribute('aria-hidden', 'true')
  else recipe.removeAttribute('aria-hidden')
  recipe.inert = narrow
  recipeBackdrop.hidden = true
  canvasRegion.inert = false
  filmstrip.inert = false
  quality.inert = false
  if (restoreFocus) recipeTrigger.focus()
}

function openRecipeDrawer() {
  workbench.dataset.recipeOpen = 'true'
  recipeTrigger.setAttribute('aria-expanded', 'true')
  recipe.setAttribute('role', 'dialog')
  recipe.setAttribute('aria-modal', 'true')
  recipe.removeAttribute('aria-hidden')
  recipe.inert = false
  recipeBackdrop.hidden = false
  canvasRegion.inert = true
  filmstrip.inert = true
  quality.inert = true
  ;(recipeFocusable()[0] ?? recipe).focus()
}

listen(recipeTrigger, 'click', openRecipeDrawer)
listen(recipeClose, 'click', () => closeRecipeDrawer())
listen(recipeBackdrop, 'click', () => closeRecipeDrawer())
listen(recipe, 'keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeRecipeDrawer()
    return
  }
  if (event.key !== 'Tab' || workbench.dataset.recipeOpen !== 'true') return
  const focusable = recipeFocusable()
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last.focus() }
  if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first.focus() }
})
```

Call `closeRecipeDrawer({ restoreFocus: false })` from `close()` and
`destroy()`. Add:

```css
.editor-repair-recipe-trigger,
.editor-repair-recipe-close,
.editor-repair-recipe-backdrop {
  display: none;
}

@media (max-width: 760px) {
  .editor-repair-workbench {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(280px, 1fr) minmax(116px, auto) auto;
    grid-template-areas: "header" "canvas" "filmstrip" "quality";
  }

  .editor-repair-recipe-trigger,
  .editor-repair-recipe-close {
    display: inline-flex;
  }

  .editor-repair-recipe-backdrop:not([hidden]) {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 49;
    border: 0;
    background: rgb(0 0 0 / 45%);
    color: transparent;
  }

  .editor-repair-recipe {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 50;
    width: min(92vw, 360px);
    transform: translateX(100%);
    transition: transform 160ms ease;
  }

  .editor-repair-workbench[data-recipe-open="true"] .editor-repair-recipe {
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .editor-repair-recipe { transition: none; }
}
```

- [ ] **Step 13: Wire Preview, review, Reset, Accept, and Discard truthfully.**

Store the server canonical echo only in
`local.preview.submittedCanonicalRecipe`; keep
`local.draft.recipe.implementation_revision` null. Freshness adopts only the
server `draft_settings_hash`, so an unchanged draft remains fresh despite the
server implementation revision. Editing any processing field immediately
marks stale and disables Accept. Warning confirmation stores this Preview's job
id and full Recipe hash; job replacement clears it. `blocked_quality` shows
real evidence with a disabled Accept. Reset may restore freshness only when its
settings and selection match the Preview.

A successful Accept replaces the loaded project and opens the child revision
only if the current selection token still matches the request's expected
project/asset/revision. A late success after switching context announces that
the old project was accepted and can be reloaded, but never overwrites the new
workspace; a late error is likewise scoped to the old request. No second
processing call occurs.

Create the lifecycle in `shell.js` through a two-phase proxy, then place every
session function after the initialization snippet inside
`createRepairWorkbenchController()`:

```js
const repairArtifactClient = createRepairArtifactClient()
const repairPreviewLifecycle = createRepairPreviewLifecycle({
  buildPreview: buildCharacterReprocessPreview,
  acceptPreview: acceptCharacterReprocessPreview,
  fetchJob,
  hashDraft: hashRepairRecipeBytes,
  onUpdate: (event) => repairController?.handleLifecycleUpdate(event),
  onLateAccept: ({ selection, outcomeUnknown, error }) => addEditorLog(
    outcomeUnknown
      ? `Repair Accept outcome for ${selection.projectId} is unknown (${error?.message ?? 'network error'}); reload that project before retrying.`
      : `Repair accepted for ${selection.projectId}; reload that project to view it.`
  ),
  onInvalidate: () => { editorState.repair.local.warningConfirmation = null },
})

function handleRepairLifecycleUpdate(event) {
  const local = editorState.repair.local
  if (event.type === 'build_started') {
    local.status = 'queued'
    local.previewModel = { ...local.previewModel, state: 'queued', acceptance: { canAccept: false, reason: 'job_not_done' } }
    local.warningConfirmation = null
  }
  if (event.type === 'preview_created') {
    local.differenceCache.clear()
    local.preview = {
      jobId: event.preview.id,
      buildGeneration: event.buildGeneration,
      recipeHash: event.preview.recipe_hash,
      submittedDraftSettingsHash: event.preview.draft_settings_hash,
      submittedCanonicalRecipe: structuredClone(event.preview.canonical_recipe),
      selection: structuredClone(local.selection),
      job: event.preview,
    }
    local.previewModel = {
      ...local.previewModel,
      state: event.preview.status === 'queued' ? 'queued' : 'processing',
      acceptance: { canAccept: false, reason: 'job_not_done' },
    }
    if (['done', 'failed_post_processing'].includes(event.preview.status)) {
      hydrateCurrentRepairPreview(event.preview, local.preview.selection)
    }
  }
  if (
    event.type === 'job' &&
    local.preview?.jobId === event.job.id &&
    local.preview?.buildGeneration === event.buildGeneration
  ) {
    local.preview.job = event.job
    local.status = event.job.status
    if (['done', 'failed_post_processing'].includes(event.job.status)) {
      hydrateCurrentRepairPreview(event.job, local.preview.selection)
    } else if (['failed', 'failed_model_error', 'failed_safety_filter', 'not_found'].includes(event.job.status)) {
      const reason = event.job.reason || 'Preview processing failed'
      const error = Object.assign(new Error(reason), {
        name: 'RepairJobError',
        code: event.job.status,
        details: {
          reason,
          retry_hint: event.job.retry_hint ?? null,
        },
      })
      local.error = error
      local.message = `${error.code}: ${error.message}`
      local.previewModel = {
        ...local.previewModel,
        state: 'failed',
        acceptance: { canAccept: false, reason: event.job.status },
        diagnostics: [
          ...(local.previewModel.diagnostics ?? []),
          { code: event.job.status, message: reason, retry_hint: event.job.retry_hint ?? null },
        ],
      }
    } else {
      local.previewModel = { ...local.previewModel, state: event.job.status === 'queued' ? 'queued' : 'processing' }
    }
  }
  if (event.type === 'draft_optimistically_stale') {
    local.previewModel = { ...local.previewModel, state: local.preview ? 'stale' : 'dirty' }
  }
  if (event.type === 'draft_hash') {
    local.currentDraftSettingsHash = event.hash
    local.draft = applyRepairDraftSettingsHash(local.draft, event.hash)
    recomputeLocalRepairState()
  }
  if (event.type === 'accept_started') {
    local.acceptInFlight = true
    local.previewModel = {
      ...local.previewModel,
      state: 'accepting',
      acceptance: { canAccept: false, reason: 'accept_in_flight' },
    }
  }
  if (event.type === 'accepted') {
    local.acceptInFlight = false
    local.previewModel = { ...local.previewModel, state: 'accepted', acceptance: { canAccept: false, reason: 'already_accepted' } }
    local.warningConfirmation = null
  }
  if (event.type === 'error') {
    if (event.phase === 'accept') local.acceptInFlight = false
    local.status = 'failed'
    local.message = `${event.error?.code ?? `${event.phase}_failed`}: ${event.error?.message ?? event.error}`
    local.previewModel = { ...local.previewModel, state: 'failed', acceptance: { canAccept: false, reason: 'preview_failed' } }
  }
  const asset = selectedRepairAsset()
  if (asset) repairWorkbench?.render(repairWorkbenchContext(asset, asset.revisions[asset.active_revision_id]).viewModel())
}

function hydrateCurrentRepairPreview(job, expectedSelection) {
  const capture = repairPreviewLifecycle.capture()
  void hydrateRepairPreview(job, expectedSelection).catch((error) => {
    if (
      repairPreviewLifecycle.isCurrentBuild(capture.token, capture.buildGeneration, expectedSelection) &&
      editorState.repair.local.preview?.jobId === job.id
    ) {
      handleRepairLifecycleUpdate({ type: 'error', phase: 'artifact_hydration', error })
    }
  })
}

async function buildLocalRepairPreview() {
  const local = editorState.repair.local
  if (local.validation.status === 'fail') return null
  local.draft.recipe.implementation_revision = null
  return repairPreviewLifecycle.build({
    projectId: editorState.project.id,
    assetId: local.selection.assetId,
    expectedRevision: local.selection.projectRevision,
    expectedAssetRevisionId: local.selection.revisionId,
    recipe: structuredClone(local.draft.recipe),
  })
}

async function acceptLocalRepairPreview() {
  const local = editorState.repair.local
  const preview = local.preview
  if (!preview || !local.previewModel.acceptance.canAccept) return null
  return repairPreviewLifecycle.accept({
    projectId: local.selection.projectId,
    assetId: local.selection.assetId,
    jobId: preview.jobId,
    expectedRevision: local.selection.projectRevision,
    expectedAssetRevisionId: local.selection.revisionId,
    expectedRecipeHash: preview.recipeHash,
    warningConfirmed: local.warningConfirmation?.confirmed === true &&
      local.warningConfirmation.jobId === preview.jobId &&
      local.warningConfirmation.recipeHash === preview.recipeHash,
  })
}

function resetLocalRepairDraft() {
  const local = editorState.repair.local
  local.draft = { ...local.draft, recipe: structuredClone(local.draft.openingRecipe), hashStatus: 'pending' }
  const validation = validateRepairRecipeDraft(local.draft, local.validationContext)
  local.validation = { ...validation, invalidPaths: repairInvalidPaths(validation.blocking_errors) }
  local.lastValidCanonical = validation.canonical
  local.renderFrame = {
    ...local.renderFrame,
    overlayCommands: buildRepairDraftOverlayCommands({
      recipe: validation.canonical,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
      bbox: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.bbox ?? null,
      debugAnchor: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.anchor ?? null,
    }),
  }
  local.warningConfirmation = null
  void repairPreviewLifecycle.digestDraft(serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical)))
}

function recomputeLocalRepairState() {
  const local = editorState.repair.local
  if (!local.preview) return
  const freshness = getRepairPreviewFreshness({
    currentDraftSettingsHash: local.currentDraftSettingsHash,
    submittedDraftSettingsHash: local.preview.submittedDraftSettingsHash,
    selection: local.selection,
    submittedSelection: local.preview.selection,
    job: local.preview.job,
    artifacts: { complete: local.previewModel.evidence != null },
    validation: { status: local.previewModel.evidence?.validationStatus ?? 'unknown' },
  })
  local.previewModel.state = freshness.state
  local.previewModel.acceptance = getRepairAcceptanceState({
    previewState: freshness.state,
    underlyingJobStatus: local.preview.job.status,
    jobId: local.preview.jobId,
    recipeHash: local.preview.recipeHash,
    warningConfirmation: local.warningConfirmation,
    hashesMatch: local.preview.job.recipe_hash === local.preview.recipeHash,
  })
}

function filmstripEventTypeForKey(key) {
  return key === 'Home' ? 'first' : key === 'End' ? 'last' : key === ' ' ? 'toggle_play' : 'arrow'
}

function repairDifferenceForFrame({ local, beforeRect, afterRect, afterSheet }) {
  if (!beforeRect || !afterRect || !afterSheet || !Number.isInteger(local.view.frameIndex)) {
    return { imageData: null, source: null }
  }
  const key = `${local.preview?.jobId ?? 'no-preview'}:${local.view.frameIndex}`
  if (!local.differenceCache.has(key)) {
    const imageData = buildDifferencePixels(
      readRepairFramePixels(local.sourceContext.beforeImage, beforeRect),
      readRepairFramePixels(afterSheet, afterRect),
    )
    local.differenceCache.set(key, {
      imageData,
      source: createRepairDifferenceSource(imageData),
    })
  }
  return local.differenceCache.get(key)
}

function syncRepairSelectedFrame() {
  const local = editorState.repair.local
  local.view.frameIndex = local.filmstrip.frames[local.filmstrip.selectedIndex] ?? null
  const frameSize = local.profile.frame
  const before = local.sourceContext.beforeImage
  const hasFrame = Number.isInteger(local.view.frameIndex)
  const afterSheet = local.renderFrame.afterSheet ?? local.renderFrame.after
  const beforeRect = hasFrame ? resolveSheetFrameRect({
    frameIndex: local.view.frameIndex,
    frameSize,
    sheetSize: { w: before.width, h: before.height },
  }) : null
  const afterRect = hasFrame && afterSheet ? resolveSheetFrameRect({
    frameIndex: local.view.frameIndex,
    frameSize,
    sheetSize: { w: afterSheet.width, h: afterSheet.height },
  }) : null
  const difference = repairDifferenceForFrame({ local, beforeRect, afterRect, afterSheet })
  local.renderFrame = {
    ...local.renderFrame,
    mode: local.view.mode,
    playing: false,
    before: hasFrame ? before : null,
    after: hasFrame ? afterSheet : null,
    afterSheet,
    emptyMessage: hasFrame ? null : 'The selected clip has no frames to display.',
    beforeRect,
    afterRect,
    differenceImageData: difference.imageData,
    differenceSource: difference.source,
    overlayCommands: buildRepairDraftOverlayCommands({
      recipe: local.lastValidCanonical ?? local.draft.recipe,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
      bbox: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.bbox ?? null,
      debugAnchor: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.anchor ?? null,
    }),
  }
}

function stopRepairPlaybackTimer() {
  if (repairPlaybackTimer != null) clearTimeout(repairPlaybackTimer)
  repairPlaybackTimer = null
}

function scheduleRepairPlayback() {
  stopRepairPlaybackTimer()
  const local = editorState.repair.local
  if (!local.filmstrip.playing) return
  const clip = selectedRepairAsset()?.clips?.[local.view.clipId]
  if (!clip?.fps || local.filmstrip.frames.length < 2) return
  repairPlaybackTimer = setTimeout(() => {
    repairPlaybackTimer = null
    dispatchRepairFilmstrip({ type: 'tick' })
  }, 1000 / clip.fps)
}

function dispatchRepairFilmstrip(event) {
  const local = editorState.repair.local
  local.filmstrip = reduceRepairFilmstrip(local.filmstrip, event)
  syncRepairSelectedFrame()
  const asset = selectedRepairAsset()
  if (asset) repairWorkbench?.render(repairWorkbenchContext(asset, asset.revisions[asset.active_revision_id]).viewModel())
  scheduleRepairPlayback()
}

function selectRepairClip(clipId) {
  const asset = selectedRepairAsset()
  const clip = asset?.clips?.[clipId]
  if (!clip) return
  stopRepairPlaybackTimer()
  const local = editorState.repair.local
  const frames = Array.isArray(clip.frames) ? [...clip.frames] : []
  local.view.clipId = clipId
  local.view.frameIndex = frames[0] ?? null
  local.filmstrip = { frames, selectedIndex: 0, playing: false }
  syncRepairSelectedFrame()
  const hasFrame = frames.length > 0
  local.previewModel = {
    ...local.previewModel,
    frames,
    modeAvailability: getRepairComparisonAvailability({
      before: hasFrame ? local.sourceContext.beforeImage : null,
      after: hasFrame ? local.renderFrame.afterSheet : null,
    }),
    diagnostics: [
      ...(local.previewModel.diagnostics ?? []).filter((item) => item.code !== 'selected_clip_has_no_frames'),
      ...(!hasFrame ? [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }] : []),
    ],
  }
  repairWorkbench?.render(repairWorkbenchContext(asset, asset.revisions[asset.active_revision_id]).viewModel())
}

function confirmLocalRepairWarning(confirmed) {
  const local = editorState.repair.local
  if (local.previewModel.state !== 'warning' || !local.preview) return
  local.warningConfirmation = confirmed ? {
    jobId: local.preview.jobId,
    recipeHash: local.preview.recipeHash,
    confirmed: true,
  } : null
  recomputeLocalRepairState()
  const asset = selectedRepairAsset()
  if (asset) repairWorkbench?.render(repairWorkbenchContext(asset, asset.revisions[asset.active_revision_id]).viewModel())
}

function clearLocalRepairAsyncWork() {
  repairPreviewLifecycle.stop()
  repairOpenGeneration += 1
  stopRepairPlaybackTimer()
  const local = editorState.repair.local
  if (local.selection) repairArtifactClient.clearRepairArtifactCache(`${local.selection.assetId}:${local.selection.revisionId}`)
}

function discardLocalRepairSession() {
  clearLocalRepairAsyncWork()
  editorState.repair.local = createEmptyLocalRepairState()
  editorState.activePanel = 'layers'
  renderAll()
}

function renderRepairUnavailableState(root, asset) {
  clear(root)
  const message = document.createElement('p')
  message.textContent = asset ? 'Repair is available for Character Pack assets.' : 'Select a Character Pack asset to begin.'
  root.append(message)
}

function renderExistingAiActionRepair(container) {
  clear(container)
  const ai = editorState.repair.aiAction
  const { revision, actions } = repairContext()
  const action = ai.selectedAction || actions[0] || ''
  const body = document.createElement('div')
  body.className = 'editor-repair-ai-action-body'
  body.append(
    selectControl('action', action, actions.length ? actions : [''], {
      disabled: !actions.length || ['planning', 'running'].includes(ai.status),
      onChange: (value) => { ai.selectedAction = value; ai.plan = null; ai.job = null; renderAll() },
    }),
    selectControl('image size', ai.imageSize, ['1K', '2K'], {
      disabled: ['planning', 'running'].includes(ai.status),
      onChange: (value) => { ai.imageSize = value; ai.plan = null; renderAll() },
    }),
  )
  const provider = document.createElement('label')
  provider.className = 'editor-field'
  const providerLabel = document.createElement('span')
  providerLabel.textContent = 'provider preset'
  const providerInput = document.createElement('input')
  providerInput.type = 'text'
  providerInput.value = ai.providerPresetId
  providerInput.placeholder = 'default'
  providerInput.disabled = ['planning', 'running'].includes(ai.status)
  providerInput.addEventListener('change', () => { ai.providerPresetId = providerInput.value.trim(); ai.plan = null; renderAll() })
  provider.append(providerLabel, providerInput)
  body.append(provider)
  const actionsRow = document.createElement('div')
  actionsRow.className = 'editor-row-actions'
  const canPlan = Boolean(revision?.source_job_id && action)
  const planButton = button('Plan', 'secondary', !canPlan || ['planning', 'running'].includes(ai.status))
  planButton.addEventListener('click', planRepairAction)
  const runButton = button('Run & import revision', '', !ai.plan?.can_run || ai.status === 'running')
  runButton.addEventListener('click', runRepairAction)
  actionsRow.append(planButton, runButton)
  body.append(actionsRow)
  container.append(body)
  renderRepairPlan(body)
}
```

Replace the old flat-state helpers with these complete nested-state versions;
the request, quota confirmation, polling, and legacy general import stay
byte-for-byte equivalent at their external boundaries:

```js
function resetRepairStateForSelection(asset = selectedRepairAsset()) {
  const revision = assetRevision(asset)
  const ai = editorState.repair.aiAction
  const sameTarget = ai.assetId === (asset?.id ?? null) && ai.revisionId === (revision?.id ?? null)
  if (sameTarget) return
  editorState.repair.aiAction = {
    ...ai,
    selectedAction: Object.keys(asset?.clips ?? {})[0] ?? '',
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
    assetId: asset?.id ?? null,
    revisionId: revision?.id ?? null,
  }
}

function preferredRepairAction() {
  const { actions } = repairContext()
  const ai = editorState.repair.aiAction
  return actions.includes(ai.selectedAction) ? ai.selectedAction : actions[0] ?? ''
}

function renderRepairPlan(wrap) {
  const ai = editorState.repair.aiAction
  const { plan, job } = ai
  if (!plan && !job && !ai.message) return
  const status = document.createElement('div')
  status.className = 'editor-repair-status'
  status.dataset.status = ai.status
  status.append(
    keyValue('status', ai.message || ai.status),
    keyValue('selected', plan?.selected_animation ?? job?.selected_animation ?? preferredRepairAction()),
    keyValue('provider calls', plan?.estimated_provider_calls ?? job?.estimated_provider_calls ?? '-'),
    linkList([
      ['plan', plan?.repair_plan_url ?? job?.repair_plan_url],
      ['prompt', plan?.repair_prompt_url ?? job?.repair_prompt_url],
      ['target', plan?.repair_target_animation_reference_url ?? job?.repair_target_animation_reference_url],
      ['summary', job?.repair_summary_url],
      ['repaired strip', job?.repaired_animation_strip_url],
      ['repaired sheet', job?.repaired_normalized_sheet_url ?? job?.repaired_source_sheet_url],
      ['validation', job?.repair_validation_report_url],
    ]),
  )
  wrap.append(status)
}

function repairRequest({ live = false } = {}) {
  const ai = editorState.repair.aiAction
  const { revision } = repairContext()
  const action = preferredRepairAction()
  return {
    jobId: revision?.source_job_id,
    animation: action,
    actions: action ? [action] : [],
    providerPresetId: ai.providerPresetId || undefined,
    imageConfig: { image_size: ai.imageSize || '1K' },
    ...(live ? { confirm_live_generation: true, maxProviderCalls: 1 } : { dryRunPlan: true }),
  }
}

async function planRepairAction() {
  const { asset, revision } = repairContext()
  const action = preferredRepairAction()
  if (!asset || !revision?.source_job_id || !action) return
  Object.assign(editorState.repair.aiAction, { status: 'planning', message: 'planning repair' })
  renderAll()
  try {
    const plan = await repairCharacterAction(repairRequest())
    editorState.repair.aiAction = {
      ...editorState.repair.aiAction,
      selectedAction: action,
      plan,
      job: null,
      importResult: null,
      status: plan.can_run ? 'planned' : 'blocked',
      message: plan.can_run ? 'repair plan ready' : plan.preflight?.errors?.[0] ?? 'repair plan blocked',
      assetId: asset.id,
      revisionId: revision.id,
    }
    addEditorLog(`Repair plan: ${action}`)
  } catch (error) {
    Object.assign(editorState.repair.aiAction, { status: 'error', message: error.message || String(error) })
    addEditorLog(editorState.repair.aiAction.message)
  }
  renderAll()
}

async function runRepairAction() {
  let { asset, revision } = repairContext()
  const action = preferredRepairAction()
  if (!asset || !revision?.source_job_id || !action || !editorState.repair.aiAction.plan?.can_run) return
  if (!window.confirm(`${action} will use one provider call and import a new asset revision. Continue?`)) return
  if (editorState.dirty) {
    const saved = await saveCurrentProject()
    if (!saved) return
    asset = editorState.project.assets?.[asset.id]
    revision = assetRevision(asset)
  }
  Object.assign(editorState.repair.aiAction, { status: 'running', message: 'repair job queued' })
  renderAll()
  try {
    let job = await repairCharacterAction(repairRequest({ live: true }))
    job = await waitForJob(job, (current) => {
      Object.assign(editorState.repair.aiAction, { job: current, message: current.status ?? 'running' })
      renderAll()
    })
    editorState.repair.aiAction.job = job
    if (job.status !== 'done') {
      Object.assign(editorState.repair.aiAction, { status: 'error', message: job.reason || job.status || 'repair failed' })
      addEditorLog(editorState.repair.aiAction.message)
      renderAll()
      return
    }
    const imported = await importGeneratedJob({
      projectId: editorState.project.id,
      expectedRevision: editorState.project.revision,
      kind: 'character_pack',
      jobId: job.id,
      assetId: asset.id,
    })
    const previousAi = { ...editorState.repair.aiAction, selectedAction: action }
    acceptProject(imported.project)
    editorState.selectedAssetId = asset.id
    editorState.selectedLayerId = null
    editorState.activePanel = 'repair'
    editorState.repair.aiAction = {
      ...editorState.repair.aiAction,
      selectedAction: previousAi.selectedAction,
      providerPresetId: previousAi.providerPresetId,
      imageSize: previousAi.imageSize,
      plan: null,
      job,
      importResult: imported,
      status: 'imported',
      message: `imported ${imported.revision.id}`,
      assetId: asset.id,
      revisionId: imported.revision.id,
    }
    addEditorLog(`Repair imported: ${asset.id} ${imported.revision.id}`)
  } catch (error) {
    Object.assign(editorState.repair.aiAction, { status: 'error', message: error.message || String(error) })
    addEditorLog(editorState.repair.aiAction.message)
  }
  renderAll()
}
```

In `renderRepairEvidence()`, replace its imported-revision read with:

```js
const importedRevision = editorState.repair.aiAction.importResult?.revision
```

In `acceptProject()`, replace only its old flat Repair reset with:

```js
editorState.repair = {
  local: createEmptyLocalRepairState(),
  aiAction: {
    ...editorState.repair.aiAction,
    selectedAction: '',
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
    assetId: null,
    revisionId: null,
  },
}
```

Add this token-guarded hydration function:

```js
const PREVIEW_ARTIFACT_FILES = Object.freeze({
  normalized_sheet_url: 'normalized_sheet.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  debug_report_url: 'debug_report.json',
  processing_recipe_url: 'processing_recipe.json',
  reprocess_context_url: 'editor_reprocess_context.json',
})

function explicitPreviewArtifactUrls(job) {
  const entries = Object.entries(PREVIEW_ARTIFACT_FILES).map(([key, fileName]) => [key, job?.[key], fileName])
  if (entries.some(([, value, fileName]) => value !== `/generated/${job.id}/${fileName}`)) {
    throw Object.assign(new Error('preview artifact set is incomplete'), { code: 'artifact_integrity_failed' })
  }
  return {
    byKey: Object.fromEntries(entries.map(([key, value]) => [key, value])),
    allowlist: new Set(entries.map(([, value]) => value)),
  }
}

async function hydrateRepairPreview(job, expectedSelection) {
  const capture = repairPreviewLifecycle.capture()
  if (JSON.stringify(capture.selection) !== JSON.stringify(expectedSelection)) return
  const controlled = explicitPreviewArtifactUrls(job)
  const identity = `job:${job.id}`
  const [report, afterImage, previewAnimations] = await Promise.all([
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.debug_report_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadImage({ identity, url: controlled.byKey.normalized_sheet_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.animations_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.metadata_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.editor_metadata_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.processing_recipe_url, allowedGeneratedUrls: controlled.allowlist }),
    repairArtifactClient.loadJson({ identity, url: controlled.byKey.reprocess_context_url, allowedGeneratedUrls: controlled.allowlist }),
  ])
  if (
    !repairPreviewLifecycle.isCurrentBuild(capture.token, capture.buildGeneration, expectedSelection) ||
    editorState.repair.local.preview?.jobId !== job.id
  ) return
  const local = editorState.repair.local
  const evidence = normalizeRepairEvidence(report)
  const complete = true
  const clip = previewAnimations.animations?.[local.view.clipId]
  if (clip && Array.isArray(clip.frames)) {
    local.filmstrip = {
      frames: [...clip.frames],
      selectedIndex: clip.frames.length ? Math.min(local.filmstrip.selectedIndex, clip.frames.length - 1) : 0,
      playing: clip.frames.length > 1 && local.filmstrip.playing,
    }
    local.view.frameIndex = local.filmstrip.frames[local.filmstrip.selectedIndex] ?? null
  }
  const hasFrame = Number.isInteger(local.view.frameIndex)
  const frameSize = local.profile.frame
  const beforeRect = hasFrame ? resolveSheetFrameRect({
    frameIndex: local.view.frameIndex,
    frameSize,
    sheetSize: { w: local.sourceContext.beforeImage.width, h: local.sourceContext.beforeImage.height },
  }) : null
  const afterRect = hasFrame ? resolveSheetFrameRect({
    frameIndex: local.view.frameIndex,
    frameSize,
    sheetSize: { w: afterImage.width, h: afterImage.height },
  }) : null
  const difference = repairDifferenceForFrame({ local, beforeRect, afterRect, afterSheet: afterImage })
  const freshness = getRepairPreviewFreshness({
    currentDraftSettingsHash: local.currentDraftSettingsHash,
    submittedDraftSettingsHash: local.preview.submittedDraftSettingsHash,
    selection: local.selection,
    submittedSelection: local.preview.selection,
    job,
    artifacts: { complete },
    validation: { status: evidence.validationStatus },
  })
  const acceptance = getRepairAcceptanceState({
    previewState: freshness.state,
    underlyingJobStatus: job.status,
    jobId: job.id,
    recipeHash: local.preview.recipeHash,
    warningConfirmation: local.warningConfirmation,
    hashesMatch: job.recipe_hash === local.preview.recipeHash,
  })
  local.renderFrame = {
    ...local.renderFrame,
    before: hasFrame ? local.sourceContext.beforeImage : null,
    after: hasFrame ? afterImage : null,
    afterSheet: afterImage,
    emptyMessage: hasFrame ? null : 'The selected clip has no frames to display.',
    beforeRect,
    afterRect,
    differenceImageData: difference.imageData,
    differenceSource: difference.source,
    overlayCommands: buildRepairDraftOverlayCommands({
      recipe: local.lastValidCanonical,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
      bbox: evidence.framesByIndex?.[String(local.view.frameIndex)]?.bbox ?? null,
      debugAnchor: evidence.framesByIndex?.[String(local.view.frameIndex)]?.anchor ?? null,
    }),
  }
  local.previewModel = {
    ...local.previewModel,
    state: freshness.state,
    acceptance,
    evidence,
    modeAvailability: getRepairComparisonAvailability({
      before: hasFrame ? local.sourceContext.beforeImage : null,
      after: hasFrame ? afterImage : null,
    }),
    diagnostics: [
      ...evidence.missingMetrics,
      ...evidence.warnings.map((code) => ({ code })),
      ...(!hasFrame ? [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }] : []),
    ],
  }
  repairWorkbench?.render(repairWorkbenchContext(selectedRepairAsset(), selectedRepairAsset().revisions[selectedRepairAsset().active_revision_id]).viewModel())
}
```

- [ ] **Step 14: Run panel, shell, state, and renderer tests.**

```bash
node --test test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorShellStructure.test.js test/editor-project/editorRepairWorkbenchState.test.js test/editor-project/editorRepairComparisonRenderer.test.js test/editor-project/editorRepairPreviewLifecycle.test.js
npm test
npm run smoke:local
git diff --check
```

Expected: focused/full suites and smoke PASS with the full-suite count
recorded; `shell.js` remains below 3000 lines, long Recipe content is
scrollable, async adoption is selection-safe, and local/AI flows are separate.

- [ ] **Step 15: Commit the workbench UI unit.**

```bash
git status --short
git add src/ui/editor/repairWorkbenchPanel.js src/ui/editor/repairWorkbenchController.js src/ui/editor/shell.js src/ui/editor/editor.css test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorShellStructure.test.js
git commit -m "feat: add focused character finishing workbench"
```

## Task 11: Close UI States, Smoke Coverage, And Browser Verification

**Files:**

- Modify: `src/ui/editor/repairWorkbenchPanel.js`
- Modify: `src/ui/editor/repairWorkbenchController.js`
- Modify: `src/ui/editor/shell.js`
- Modify: `src/ui/editor/repairPreviewLifecycle.js`
- Modify: `src/ui/editor/editor.css`
- Modify: `test/editor-project/editorRepairWorkbenchPanel.test.js`
- Modify: `test/editor-project/editorRepairWorkbenchController.test.js`
- Modify: `test/editor-project/editorRepairPreviewLifecycle.test.js`
- Modify: `scripts/smoke-local-ui.mjs`
- Modify: `test/localSmokeScript.test.js`
- Create: `docs/runbooks/character-finishing-workbench-v1.md`

- [ ] **Step 1: Add failing state-matrix tests.**

Cover no project, no asset, unsupported kind, missing/unsafe source, invalid Recipe, loading draft artifacts, queued, processing, ready, stale, warning confirmation, blocked quality, failed processing, project conflict, asset revision conflict, selection switch, accepted, and teardown. Each state must name its visible message, enabled actions, live announcement, retained draft behavior, and project-mutation expectation.

Use this literal matrix rather than snapshots:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRepairUiStateModel } from '../../src/ui/editor/repairWorkbenchPanel.js'

const CASES = [
  ['no_project', 'Load a project to use Repair.', [], false],
  ['no_asset', 'Select a Character Pack asset to begin.', [], false],
  ['unsupported_asset', 'Repair is available for Character Pack assets.', [], false],
  ['loading', 'Loading managed Character Pack artifacts…', [], false],
  ['missing_artifact', 'A required managed artifact is unavailable.', ['retry'], false],
  ['unsafe_artifact_path', 'A managed artifact path was rejected.', [], false],
  ['no_preview', 'Build Preview to compare processed output.', ['build', 'discard'], true],
  ['dirty', 'Recipe has unbuilt changes.', ['build', 'reset', 'discard'], true],
  ['invalid_recipe', 'Fix the highlighted Recipe fields before building.', ['reset', 'discard'], true],
  ['queued', 'Preview queued.', ['discard'], true],
  ['processing', 'Preview processing.', ['discard'], true],
  ['ready', 'Preview ready for review.', ['build', 'accept', 'reset', 'discard'], true],
  ['stale', 'Recipe changed after this Preview.', ['build', 'reset', 'discard'], true],
  ['warning', 'Review and confirm warnings before accepting.', ['build', 'accept', 'confirm_warning', 'reset', 'discard'], true],
  ['accepting', 'Accepting revision… Keep this project open until the outcome is known.', [], true],
  ['blocked_quality', 'Preview failed the quality gate and cannot be accepted.', ['build', 'reset', 'discard'], true],
  ['failed', 'Preview processing failed. Your draft is unchanged.', ['build', 'reset', 'discard'], true],
  ['revision_conflict', 'The project changed. Reload before building or accepting.', ['discard'], true],
  ['asset_revision_conflict', 'The active asset revision changed. Reopen Repair.', ['discard'], true],
  ['selection_switched', 'Repair context changed; late results were ignored.', [], false],
  ['accepted', 'Preview accepted as a new immutable revision.', ['discard'], false],
  ['teardown', '', [], false],
]

for (const [state, message, actions, retainsDraft] of CASES) {
  test(`Repair UI state ${state}`, () => {
    const model = buildRepairUiStateModel({ state })
    assert.equal(model.message, message)
    assert.deepEqual(model.actions, actions)
    assert.equal(model.retainsDraft, retainsDraft)
    assert.equal(model.mutatesProject, state === 'accepted')
    assert.equal(model.announcement, message)
  })
}
```

- [ ] **Step 2: Add failing local smoke assertions.**

Extend the smoke script's existing `/` and `/editor` route checks with module
markers for the workbench. Do not claim Node fetch opened Repair; runtime DOM,
button truth, and project fixtures belong to the fake-DOM and real-browser
steps. The smoke must not call a provider or accept a revision.

Keep Node smoke within what it can truthfully observe: route/module/API markers.
Add these exact assertions after the existing `/` and `/editor` responses;
fake-DOM tests and Step 6 real-browser checks own interactive behavior:

```js
assertCondition(htmlResponse.status === 200, 'homepage route failed')
assertCondition(editorResponse.status === 200, 'editor route failed')
assertCondition(editorHtml.includes('id="editor-panel-body"'), 'editor panel body marker is missing')
assertCondition(editorHtml.includes('./src/editor-app.js'), 'editor app module marker is missing')

const repairPanelResponse = await fetch(`${baseUrl}/src/ui/editor/repairWorkbenchPanel.js`)
assertCondition(repairPanelResponse.ok, `repair panel module returned ${repairPanelResponse.status}`)
const repairPanelSource = await repairPanelResponse.text()
for (const marker of [
  'editor-repair-workbench',
  'dataset.repairMode',
  'editor-repair-filmstrip-frames',
  'editor-repair-recipe-trigger',
  'Build Preview',
  'Accept as revision',
  'AI Action Repair',
]) {
  assertCondition(repairPanelSource.includes(marker), `repair panel marker is missing: ${marker}`)
}

const editorApiModuleResponse = await fetch(`${baseUrl}/src/ui/editor/api.js`)
assertCondition(editorApiModuleResponse.ok, `editor API module returned ${editorApiModuleResponse.status}`)
const editorApiSource = await editorApiModuleResponse.text()
assertCondition(editorApiSource.includes('/reprocess'), 'reprocess API client marker is missing')
```

- [ ] **Step 3: Run focused tests and confirm missing state coverage.**

```bash
node --test test/editor-project/editorRepairWorkbenchPanel.test.js test/localSmokeScript.test.js
```

Expected: FAIL on at least the new state matrix or smoke assertions.

- [ ] **Step 4: Complete loading, empty, failure, and recovery views.**

Keep the draft on processing failure; preserve current active revision on every failure; show controlled backend error code/details; expose textual equivalents for Canvas evidence; clear busy state after abort; and keep stale/blocked real artifacts inspectable. Never retry local processing or a provider implicitly, and never display a blocking failure as a warning.

Add this top-level pure state table to `repairWorkbenchPanel.js`:

```js
const REPAIR_UI_STATES = Object.freeze({
  no_project: ['Load a project to use Repair.', [], false],
  no_asset: ['Select a Character Pack asset to begin.', [], false],
  unsupported_asset: ['Repair is available for Character Pack assets.', [], false],
  loading: ['Loading managed Character Pack artifacts…', [], false],
  missing_artifact: ['A required managed artifact is unavailable.', ['retry'], false],
  unsafe_artifact_path: ['A managed artifact path was rejected.', [], false],
  no_preview: ['Build Preview to compare processed output.', ['build', 'discard'], true],
  dirty: ['Recipe has unbuilt changes.', ['build', 'reset', 'discard'], true],
  invalid_recipe: ['Fix the highlighted Recipe fields before building.', ['reset', 'discard'], true],
  queued: ['Preview queued.', ['discard'], true],
  processing: ['Preview processing.', ['discard'], true],
  ready: ['Preview ready for review.', ['build', 'accept', 'reset', 'discard'], true],
  stale: ['Recipe changed after this Preview.', ['build', 'reset', 'discard'], true],
  warning: ['Review and confirm warnings before accepting.', ['build', 'accept', 'confirm_warning', 'reset', 'discard'], true],
  accepting: ['Accepting revision… Keep this project open until the outcome is known.', [], true],
  blocked_quality: ['Preview failed the quality gate and cannot be accepted.', ['build', 'reset', 'discard'], true],
  failed: ['Preview processing failed. Your draft is unchanged.', ['build', 'reset', 'discard'], true],
  revision_conflict: ['The project changed. Reload before building or accepting.', ['discard'], true],
  asset_revision_conflict: ['The active asset revision changed. Reopen Repair.', ['discard'], true],
  selection_switched: ['Repair context changed; late results were ignored.', [], false],
  accepted: ['Preview accepted as a new immutable revision.', ['discard'], false],
  teardown: ['', [], false],
})

export function buildRepairUiStateModel({
  state,
  errorCode = null,
  details = null,
  draftDirty = false,
  canBuild = false,
  canAccept = false,
  warningConfirmed = false,
}) {
  const [message, actions, retainsDraft] = REPAIR_UI_STATES[state] ?? REPAIR_UI_STATES.failed
  const allowed = new Set(actions)
  return {
    state,
    message,
    actions: [...actions],
    retainsDraft,
    mutatesProject: state === 'accepted',
    announcement: message,
    errorText: errorCode ? `${errorCode}${details ? `: ${details}` : ''}` : '',
    actionAvailability: {
      retry: allowed.has('retry'),
      build: allowed.has('build') && canBuild,
      accept: allowed.has('accept') && canAccept,
      reset: allowed.has('reset') && draftDirty,
      discard: allowed.has('discard'),
      confirmWarning: allowed.has('confirm_warning') && !warningConfirmed,
    },
    tone: ['blocked_quality', 'failed', 'revision_conflict', 'asset_revision_conflict', 'unsafe_artifact_path'].includes(state)
      ? 'blocking'
      : state === 'warning' ? 'warning' : 'neutral',
  }
}
```

Use the stable `stateBanner` created with the Canvas region in Task 10 and add
this renderer without remounting the workbench:

```js
function renderStateBanner(viewModel) {
  const state = buildRepairUiStateModel({
    state: viewModel.uiState,
    errorCode: viewModel.errorCode,
    details: viewModel.errorDetails,
    draftDirty: viewModel.canReset,
    canBuild: viewModel.canBuild,
    canAccept: viewModel.canAccept,
    warningConfirmed: viewModel.warningConfirmed,
  })
  stateBanner.dataset.tone = state.tone
  stateBanner.textContent = [state.message, state.errorText].filter(Boolean).join(' ')
  stateBanner.hidden = !stateBanner.textContent
  return state
}
```

Call it at the end of `render()` and let the state model own final action
availability:

```js
const uiState = renderStateBanner(viewModel)
reset.disabled = !uiState.actionAvailability.reset
build.disabled = !uiState.actionAvailability.build
accept.disabled = !uiState.actionAvailability.accept
discard.disabled = !uiState.actionAvailability.discard
warningLabel.hidden = !viewModel.warningRequired
warningConfirmation.disabled = !uiState.actionAvailability.confirmWarning && !viewModel.warningConfirmed
```

Extend the view
model return with these exact fields:

```js
uiState: validation.status === 'fail' ? 'invalid_recipe' : previewModel.state,
errorCode: local.error?.code ?? null,
errorDetails: local.error?.details ? JSON.stringify(local.error.details) : local.message,
```

Replace the shell's unavailable-state helper so it uses the same truth table
and offers retry only for a missing artifact, never for an unsafe path:

```js
import { buildRepairUiStateModel } from './repairWorkbenchPanel.js'

function renderRepairUnavailableState(root, asset) {
  const state = !editorState.project ? 'no_project' : !asset ? 'no_asset' : 'unsupported_asset'
  const model = buildRepairUiStateModel({ state })
  const message = document.createElement('p')
  message.className = 'editor-repair-state-banner'
  message.setAttribute('aria-live', 'polite')
  message.textContent = model.message
  root.replaceChildren(message)
}

function renderRepairLoadState(root, asset, local) {
  const state = local.status === 'loading'
    ? 'loading'
    : local.error?.code === 'artifact_not_found'
      ? 'missing_artifact'
      : local.error?.code === 'unsafe_artifact_path'
        ? 'unsafe_artifact_path'
        : 'failed'
  const model = buildRepairUiStateModel({
    state,
    errorCode: local.error?.code,
    details: local.error?.message,
  })
  const wrap = document.createElement('div')
  wrap.className = 'editor-repair-load-state'
  wrap.dataset.status = state
  wrap.setAttribute('aria-live', 'polite')
  const message = document.createElement('p')
  message.textContent = [model.message, model.errorText].filter(Boolean).join(' ')
  wrap.append(message)
  if (model.actionAvailability.retry) {
    const retry = button('Retry', 'secondary')
    retry.addEventListener('click', () => { void ensureRepairController().openAsset(asset) })
    wrap.append(retry)
  }
  root.replaceChildren(wrap)
}
```

Replace the `!selectionMatches || !local.draft` body in
`renderRepairPanel()` with:

```js
if (!selectionMatches || !local.draft) {
  if (local.status === 'idle' || !selectionMatches) void ensureRepairController().openAsset(asset)
  renderRepairLoadState(elements.panelBody, asset, editorState.repair.local)
  return
}
```

Both initialization catch blocks must retain the typed error before rendering:

```js
editorState.repair.local.status = 'failed'
editorState.repair.local.error = error
editorState.repair.local.message = `${error.code ?? 'repair_initialization_failed'}: ${error.message || error}`
renderAll()
```

In lifecycle error handling, retain the typed error and map only known conflict
codes; all other processing failures remain blocking `failed`:

```js
local.error = event.error
if (event.phase === 'accept') local.acceptInFlight = false
const errorState = event.error?.code === 'revision_conflict'
  ? 'revision_conflict'
  : event.error?.code === 'asset_revision_conflict'
    ? 'asset_revision_conflict'
    : event.error?.code === 'unsafe_artifact_path'
      ? 'unsafe_artifact_path'
      : event.error?.code === 'artifact_not_found'
        ? 'missing_artifact'
        : 'failed'
local.previewModel = {
  ...local.previewModel,
  state: errorState,
  acceptance: { canAccept: false, reason: event.error?.code ?? 'preview_failed' },
}
```

- [ ] **Step 5: Run automated UI regression and local smoke.**

```bash
node --test test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorShellStructure.test.js test/localSmokeScript.test.js
npm run smoke:local
```

Expected: PASS; old `/`, `/editor`, Playtest, Export, and existing AI Repair remain reachable. Record the actual smoke output in the runbook.

- [ ] **Step 6: Start one isolated browser fixture.**

Use the browser-control workflow, start the verified local server, load one real
imported Character Pack revision, open Repair, and record project revision,
active asset revision, history length, and current Network request count. Do
not Accept yet. Keep the same fixture for Steps 7–10; never stage its generated
or browser-cache files.

- [ ] **Step 7: Verify the 1440×900 desktop workspace.**

Set `1440x900`. Confirm no page overflow or obscured section, the centered
nearest-neighbor Canvas consumes remaining height rather than leaving the
reported lower-page void, the full-height Recipe scrolls through Advanced and
AI Action Repair, and Canvas/filmstrip/actions remain visible. Exercise zoom,
pan, mode/overlay buttons, long names, focus rings, and increasing filmstrip
frames. Capture one screenshot path and the computed overflow result.

- [ ] **Step 8: Verify the 2048×963 wide workspace.**

Set `2048x963`. Confirm the Canvas expands and remains centered instead of
staying 300×150 or 96×96 at top-left; Recipe width remains bounded; filmstrip
overflow remains internal; action and quality bars do not stretch into empty
detached regions. Capture one screenshot and record Canvas CSS/backing size
plus its computed viewport.

- [ ] **Step 9: Verify the 390×844 mobile drawer.**

Set `390x844`. Confirm Canvas is above the filmstrip, action buttons remain
reachable without horizontal page scroll, Recipe trigger opens a modal drawer,
focus is trapped, Escape/backdrop closes, focus returns, reduced-motion rules
are present, and hardware-pointer precision guidance does not block review.
Capture closed/open drawer screenshots and the horizontal-overflow result.

- [ ] **Step 10: Verify Network, state mutation, and RAF behavior.**

At desktop size, edit tolerance/anchor/grid and confirm zero POST. Build once
and require exactly one reprocess POST. Inspect pass/warning/fail truth, fixed
staging/Pixel Grid/conditional `dual_matte`, and Console errors. Accept one
eligible exact job and require one specialized Accept POST, no general import,
and exactly one project/active-revision/history transition. Compare the
pre-Accept snapshot from Step 6. Use the renderer instrumentation test plus
Performance/Network observation to confirm no fetch, decode, or layout read in
animation RAF. Record all observed counts and any skipped check with a reason.

- [ ] **Step 11: Record the design-to-implementation contract.**

The runbook must contain:

- source spec and commits `b17080e`, `36eefaf`, `58176ce`, `89cf7b2`;
- a `1:1 Matches` section naming every matched layout, content, interaction, state, and accessibility requirement;
- desktop sidebar-hiding adaptation and mobile drawer behavior;
- no splitters/virtualization in v1;
- fixed staging, Pixel Grid, output size, style-report, and conditional `dual_matte` truth;
- a `Capability Truth` section listing design-and-implemented, design-but-unavailable, implemented-but-not-represented, and future-only items; write `None` with evidence when a category is empty;
- an `API And Capability Impact` section covering the two new routes, unchanged existing routes, provider/quota impact, project-format impact, and renderer/dependency impact;
- an `Authorization And Offline States` section recording that this local workspace has no account/permission model and whether offline/unauthorized/no-permission states are not applicable; do not invent UI for an inapplicable state;
- full parameter binding table with a test/file reference for each row;
- confirmation that protected Character Pack contracts were not modified;
- browser matrix, screenshots, commands, test counts, skipped checks with reasons, and residual risks.

Create the runbook from this literal skeleton and fill every cell with observed
evidence rather than expected values:

```md
# Character Finishing Workbench v1 Verification

## Source Design

- Spec: docs/superpowers/specs/2026-07-10-character-finishing-workbench-v1-design.md
- Lineage: b17080e, 36eefaf, 58176ce, 89cf7b2

## 1:1 Matches

| Requirement | Evidence | Result |
| --- | --- | --- |
| Desktop focused layout | screenshot/path + DOM/CSS test | |
| Centered fill Canvas | screenshot/path + viewport test | |
| Bottom filmstrip | screenshot/path + panel test | |
| Mobile Recipe drawer | screenshot/path + a11y test | |
| State/action truth | state-matrix test | |

## Recorded Deviations

| Deviation | Reason | Approval/source |
| --- | --- | --- |
| Desktop hides global sidebars only in Repair | Width required by approved spec | b17080e |
| No splitters or virtualization in v1 | Explicit v1 boundary | b17080e |

## Capability Truth

| Category | Items and evidence |
| --- | --- |
| Design and implemented | |
| Design but unavailable | |
| Implemented but not represented | None — verify against changed-file audit |
| Future only | Pixel Grid Refinement; splitters; virtualization |

## API And Capability Impact

| Area | Observed impact |
| --- | --- |
| New routes | POST Preview; POST exact Accept |
| Existing routes | |
| Provider/quota | Local Preview: none; separate AI flow unchanged |
| Project format | |
| Renderer/dependencies | Canvas 2D; no new runtime dependency |

## Authorization And Offline States

This local workspace has no account/permission model. Record offline behavior
observed; mark unauthorized/no-permission N/A without inventing UI.

## Parameter Binding Audit

| Recipe field | Processing option | Control/default/provenance | Test |
| --- | --- | --- | --- |

## Browser Matrix

| Viewport | Screenshot(s) | Overflow | Console | Notes |
| --- | --- | --- | --- | --- |
| 1440×900 | | | | |
| 2048×963 | | | | |
| 390×844 | | | | |

## Network And Mutation Evidence

| Action | POST count/routes | Project revision | Asset revision | History |
| --- | --- | --- | --- | --- |

## Verification Commands

| Command | Result/count |
| --- | --- |

## Protected Boundaries And Residual Risks

- Protected Character Pack processing files changed: No
- Skipped checks and reasons:
- Residual risks:
```

- [ ] **Step 12: Re-run UI tests after browser-found fixes.**

```bash
node --test test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorShellStructure.test.js test/editor-project/editorRepairComparisonRenderer.test.js test/editor-project/editorRepairPreviewLifecycle.test.js test/localSmokeScript.test.js
npm test
npm run smoke:local
git diff --check
```

Expected: focused/full suites and smoke PASS with the actual full-suite count
recorded and the runbook matching observed behavior.

- [ ] **Step 13: Commit the verified UI closeout.**

```bash
git status --short
git add src/ui/editor/repairWorkbenchPanel.js src/ui/editor/repairWorkbenchController.js src/ui/editor/repairPreviewLifecycle.js src/ui/editor/shell.js src/ui/editor/editor.css test/editor-project/editorRepairWorkbenchPanel.test.js test/editor-project/editorRepairWorkbenchController.test.js test/editor-project/editorRepairPreviewLifecycle.test.js scripts/smoke-local-ui.mjs test/localSmokeScript.test.js docs/runbooks/character-finishing-workbench-v1.md
git commit -m "test: verify character finishing workbench"
```

## Task 12: Full Regression, Contract Audit, And Handoff

**Files:**

- Modify only if evidence requires a correction: files already named by Tasks 1–11
- Modify: `docs/runbooks/character-finishing-workbench-v1.md`

- [ ] **Step 1: Audit changed files against scope and protected boundaries.**

```bash
git status --short
git diff --name-only b17080e...HEAD
git diff --name-only b17080e...HEAD -- src/character-pack
git diff --check
```

Expected: only planned Editor/UI/docs/tests/server files changed; the `src/character-pack` command prints nothing. Unrelated untracked `.superpowers/` and duplicate `* 2.*` files remain untouched and unstaged.

- [ ] **Step 2: Run unfinished-marker, naming, and external-copy audits.**

```bash
rg -n "T""BD|T""ODO|F""IXME|Coming soon|mock data" src/editor-project src/ui/editor docs/runbooks/character-finishing-workbench-v1.md
rg -n "Ronin|FrameRonin|PixelLab|Pixelab|PXL|alternative|replacement" src/editor-project src/ui/editor docs/runbooks/character-finishing-workbench-v1.md
rg -n "apiKey|api_key|CHARACTER_IMAGE_API_KEY|source_base64|promptText" src/editor-project/characterReprocessService.js src/editor-project/characterReprocessCoordinator.js src/ui/editor
```

Expected: no unfinished/mock or restricted-brand matches. Secret/base64/prompt matches are limited to explicit negative tests or preserved existing AI Action Repair code; document each preserved line in the runbook.

- [ ] **Step 3: Run all focused Editor and Character binding tests.**

```bash
node --test test/editor-project/*.test.js test/character-pack/processSheet.test.js test/character-pack/motionStabilizer.test.js
```

Expected: PASS. Record the actual tests/pass/fail count.

- [ ] **Step 4: Run the full suite and smoke.**

```bash
npm test
npm run smoke:local
```

Expected: PASS. Record the actual full-suite count and distinguish these local results from independent CI.

- [ ] **Step 5: Perform the 30-second acceptance sequence one final time.**

Open a real Character Pack revision, edit anchor or tolerance, confirm no request occurs, Build once, inspect real Before/After plus quality evidence, Accept the exact pass job, and confirm one child revision with managed Recipe/context appears. Repeat warning/fail checks without accepting fail output. Confirm old project/revision/generated artifacts remain byte-identical.

- [ ] **Step 6: Complete the runbook audit tables.**

For every binding-table row, list Recipe/server source, exact processing option, test name, and result. List all deviations and state whether each is user-approved, capability-driven, or responsive-layout adaptation. State explicitly that no external code/UI/assets were copied and no dependency was added.

- [ ] **Step 7: Commit only if the final audit changed the runbook or fixed a verified defect.**

```bash
git status --short
git add docs/runbooks/character-finishing-workbench-v1.md
git commit -m "docs: close character finishing workbench v1"
```

If a verified defect required code changes, return to its owning task, add a regression test, run that task's focused command, and include only those named files in a separate semantic fix commit before the runbook commit.

- [ ] **Step 8: Request code review and finish the branch.**

Use `superpowers:requesting-code-review`, address only evidence-backed findings, rerun the affected focused tests plus `npm test` and `npm run smoke:local`, then use `superpowers:finishing-a-development-branch`. Do not merge or push unless the user explicitly asks.

## Completion Checklist

- [ ] One explicit Build creates one provider-free job on the shared queue.
- [ ] The canonical Recipe executed, returned, hashed, written, and accepted is the same pipeline-effective object.
- [ ] Full `recipe_hash` binds evidence and acceptance; revision-neutral `draft_settings_hash` binds dirty/stale/Reset UI behavior.
- [ ] The server controls input paths, source identity, profile, metadata, implementation revision, provenance, and black-matte Buffer resolution.
- [ ] Pass/warning/fail/unknown and `failed_post_processing` states follow the approved acceptance policy.
- [ ] Exactly one concurrent Accept succeeds; revision storage is exclusive and never overwritten or cleaned automatically.
- [ ] Canvas, bottom filmstrip, desktop focused layout, and mobile Recipe drawer match the approved design contract.
- [ ] Every active control is connected; unavailable capabilities are hidden, disabled, or clearly labeled.
- [ ] AI Action Repair, old `/`, existing APIs, providers, pipelines, validators, exporters, project packs, Playtest, and Editor save flows regress cleanly.
- [ ] No protected Character Pack source file, external asset, runtime dependency, or unrelated user file changed.
- [ ] Focused tests, full `npm test`, local smoke, browser matrix, binding audit, and runbook all pass and contain actual evidence.
