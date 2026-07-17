# Scene Tile Raw Quality Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scene tile raw-output quality diagnosable and actionable before WFC, LDtk auto-layer rules, or map-editor expansion.

**Architecture:** Reuse the existing scene tile quality gate details instead of adding a second detector. The correction matrix becomes the evidence hub: it summarizes raw per-sample seam, self-loop, source-atlas, and duplicate-tile diagnostics, then prompt v0.5 and manual prompt packs target those exact failure modes.

**Tech Stack:** Node.js ESM, `node:test`, existing `src/scene-pack/` modules, `scripts/character-pack-cli.mjs`, Markdown protocols/roadmaps.

---

## Evidence Baseline

Current manual external scene matrix:

- Artifact: `generated/scene-tile-correction-matrix/gemini_manual_scene_tile_raw_quality_readiness_20260617/scene_tile_correction_matrix.json`
- `raw_quality_readiness.status`: `not_ready`
- `raw`: `0 / 5` pass
- `style_snap`: `1 / 5` pass
- `style_snap_edge_aware`: `5 / 5` pass
- Raw blockers:
  - `tile.source_atlas_continuity`: `5 / 5`
  - `tile.self_loop_mismatch`: `4 / 5`
  - `tile.visual_seam_mismatch`: `4 / 5`
- Correction-masked blockers:
  - `correction_masks_visual_seams`
  - `correction_masks_self_loops`

## Post-Plan Handoff Addendum

After the v0.5 manual re-test images were supplied, the original files were
JPEG-encoded `1024x1024` images with `.png` names. A normalized diagnostic run
still reported raw readiness `not_ready`.

The active prompt/handoff layer has therefore moved to
`scene_tile_prompt_contract_v0_6`:

- provider-facing prompts no longer include visible `Mask placement: mask 0:
  row ...` coordinate lists,
- prompts explicitly require a true `192x192` PNG source sheet and forbid
  preview-scale or JPEG-encoded `.png` outputs,
- `benchmark scene-tile-manual-prompts` writes `manual_handoff.md`,
- `benchmark scene-tile-manual-retest` now reports `invalid_inputs` with
  actual format and size before matrix execution.

The next contract-compliant manual re-test should use
`/tmp/scene-tile-gemini-v06-sheets/`.

## File Structure

- Modify `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`: add raw diagnostics summary and markdown section.
- Modify `test/scene-pack/sceneTileCorrectionMatrix.test.js`: assert raw diagnostics for clean and mismatched sheets.
- Modify `scripts/character-pack-cli.mjs`: expose raw diagnostics in correction matrix CLI output and add a provider-free manual prompt pack command.
- Modify `test/character-pack/cli.test.js`: cover raw diagnostics output and manual prompt pack command.
- Modify `src/scene-pack/tilePromptContracts.js`: upgrade provider-facing scene tile prompt contract to v0.5.
- Modify `test/scene-pack/tilePromptContracts.test.js`, `test/scene-pack/tileGenerate.test.js`, `test/serverOpenRouter.test.js`, and relevant CLI assertions: lock v0.5 metadata and prompt text.
- Create `src/scene-pack/benchmark/sceneTileManualPromptPack.js`: build deterministic manual prompt packs for the default five scene cases.
- Create `test/scene-pack/sceneTileManualPromptPack.test.js`: cover prompt pack case selection, v0.5 prompt metadata, and expected input filenames.
- Modify `docs/protocols/scene-tile-prompt-contract.md`: document v0.5.
- Modify `docs/protocols/scene-tile-live-generation.md`: document raw diagnostics and manual prompt pack workflow.
- Modify `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`: record the new decision gate and current blocked-by-new-images state if new v0.5 images are absent.
- Modify `docs/roadmap/p0-p2-technical-upgrade-plan.md` and `docs/roadmap/technology-reference-roadmap.md`: track the raw-quality closure block.
- Modify this plan file as tasks are completed.

## Non-Goals

- Do not add WFC.
- Do not add LDtk auto-layer rules.
- Do not loosen strict raw gates.
- Do not commit generated matrix artifacts, manual Gemini images, `/tmp` files, or `.agents/`.
- Do not change UI.
- Do not change provider key handling.

### Task 1: Add Raw Quality Diagnostics To Correction Matrix

**Files:**
- Modify: `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`
- Modify: `test/scene-pack/sceneTileCorrectionMatrix.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`
- Modify: `docs/protocols/scene-tile-live-generation.md`

- [x] **Step 1: Write failing matrix diagnostics assertions**

In `test/scene-pack/sceneTileCorrectionMatrix.test.js`, add clean-sheet assertions:

```js
assert.equal(result.summary.raw_quality_diagnostics.status, 'pass')
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.visual_seam_failures, 0)
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.self_loop_failures, 0)
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.source_atlas_continuities, 0)
assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].sample_id, 'forest_case')
```

In the mismatched-sheet test, add:

```js
assert.equal(result.summary.raw_quality_diagnostics.status, 'fail')
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.visual_seam_failures, 4)
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.self_loop_failures, 32)
assert.equal(result.summary.raw_quality_diagnostics.issue_counts.source_atlas_continuities, 0)
assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].sample_id, 'rough_case')
assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].visual_seam_failure_count, 4)
assert.equal(result.summary.raw_quality_diagnostics.per_sample[0].self_loop_failure_count, 32)
assert.equal(result.summary.raw_quality_diagnostics.worst_visual_seams[0].sample_id, 'rough_case')
assert.equal(result.summary.raw_quality_diagnostics.worst_self_loops[0].sample_id, 'rough_case')
```

- [x] **Step 2: Run focused test and verify failure**

```bash
node --test test/scene-pack/sceneTileCorrectionMatrix.test.js
```

Expected: failure because `raw_quality_diagnostics` is undefined.

- [x] **Step 3: Implement raw diagnostics summary**

In `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`, add helpers near `buildRawQualityReadiness()`:

```js
function gateById(item, id) {
  return item.quality_gate?.gates?.find((gate) => gate.id === id) ?? null
}

function buildRawQualityDiagnostics(items) {
  const rawItems = items.filter((item) => item.variant_id === 'raw')
  const perSample = []
  const visualSeams = []
  const selfLoops = []
  const sourceAtlasContinuities = []
  const duplicateTilePairs = []

  for (const item of rawItems) {
    const visualGate = gateById(item, 'visual_seams')
    const selfLoopGate = gateById(item, 'tile_self_loops')
    const sourceGate = gateById(item, 'source_atlas_structure')
    const distinctnessGate = gateById(item, 'tile_distinctness')
    const failedPairs = visualGate?.details?.failed_pairs ?? []
    const failedTiles = selfLoopGate?.details?.failed_tiles ?? []
    const continuousBoundaries = sourceGate?.details?.continuous_boundaries ?? []
    const duplicatePairs = distinctnessGate?.details?.duplicate_pairs ?? []

    for (const pair of failedPairs) visualSeams.push({ sample_id: item.sample_id, ...pair })
    for (const tile of failedTiles) selfLoops.push({ sample_id: item.sample_id, ...tile })
    for (const boundary of continuousBoundaries) sourceAtlasContinuities.push({ sample_id: item.sample_id, ...boundary })
    for (const pair of duplicatePairs) duplicateTilePairs.push({ sample_id: item.sample_id, ...pair })

    perSample.push({
      sample_id: item.sample_id,
      status: normalizeStatus(item.quality_gate?.status),
      visual_seam_failure_count: failedPairs.length,
      self_loop_failure_count: failedTiles.length,
      source_atlas_continuity_count: continuousBoundaries.length,
      duplicate_runtime_tile_pair_count: duplicatePairs.length,
      max_visual_seam_delta: visualGate?.observed?.max_edge_delta ?? 0,
      max_self_loop_delta: selfLoopGate?.observed?.max_edge_delta ?? 0,
      continuous_source_boundary_ids: continuousBoundaries.slice(0, 8).map((boundary) => boundary.id),
    })
  }

  const issueCounts = {
    visual_seam_failures: visualSeams.length,
    self_loop_failures: selfLoops.length,
    source_atlas_continuities: sourceAtlasContinuities.length,
    duplicate_runtime_tile_pairs: duplicateTilePairs.length,
  }

  return {
    schema_version: 1,
    status: Object.values(issueCounts).some((count) => count > 0) ? 'fail' : 'pass',
    sample_count: rawItems.length,
    issue_counts: issueCounts,
    per_sample: perSample.sort((a, b) => a.sample_id.localeCompare(b.sample_id)),
    worst_visual_seams: visualSeams.sort((a, b) => b.average_delta - a.average_delta).slice(0, 12),
    worst_self_loops: selfLoops.sort((a, b) => b.average_delta - a.average_delta).slice(0, 12),
    continuous_source_boundaries: sourceAtlasContinuities.slice(0, 24),
    duplicate_runtime_tile_pairs: duplicateTilePairs.slice(0, 24),
  }
}
```

In `summarizeMatrixItems()`, include:

```js
raw_quality_diagnostics: buildRawQualityDiagnostics(items),
```

In `markdownForMatrix()`, add a `## Raw Diagnostics` table using `matrix.summary.raw_quality_diagnostics.per_sample`.

- [x] **Step 4: Expose diagnostics from CLI**

In `commandBenchmarkSceneTileCorrectionMatrix()`, include:

```js
raw_quality_diagnostics: result.summary.raw_quality_diagnostics,
```

In `test/character-pack/cli.test.js`, add:

```js
assert.equal(result.raw_quality_diagnostics.status, 'pass')
```

- [x] **Step 5: Update protocol docs**

In `docs/protocols/scene-tile-live-generation.md`, update the matrix paragraph to say the summary includes `raw_quality_diagnostics` with per-sample counts for visual seams, self-loops, source-atlas continuity, and duplicate runtime tile pairs.

- [x] **Step 6: Run focused verification**

```bash
node --test test/scene-pack/sceneTileCorrectionMatrix.test.js test/character-pack/cli.test.js
git diff --check
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add src/scene-pack/benchmark/sceneTileCorrectionMatrix.js test/scene-pack/sceneTileCorrectionMatrix.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js docs/protocols/scene-tile-live-generation.md docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md
git commit -m "feat: add scene tile raw diagnostics"
```

### Task 2: Upgrade Scene Tile Prompt Contract To v0.5

**Files:**
- Modify: `src/scene-pack/tilePromptContracts.js`
- Modify: `test/scene-pack/tilePromptContracts.test.js`
- Modify: `test/scene-pack/tileGenerate.test.js`
- Modify: `test/character-pack/cli.test.js`
- Modify: `test/serverOpenRouter.test.js`
- Modify: `docs/protocols/scene-tile-prompt-contract.md`

- [x] **Step 1: Write failing v0.5 prompt assertions**

In `test/scene-pack/tilePromptContracts.test.js`, change version assertions to:

```js
assert.equal(contract.contract_version, 'scene_tile_prompt_contract_v0_5')
```

Add expectations:

```js
assert.ok(contract.validation_contract.expectations.includes('no_atlas_scale_composition'))
assert.ok(contract.validation_contract.expectations.includes('edge_signature_motifs_repeated_not_continued'))
assert.ok(contract.validation_contract.expectations.includes('self_loop_edges_have_no_unique_marks'))
```

Add prompt assertions:

```js
assert.match(prompt, /Do not use the 4x4 atlas position to create gradients, lighting, camera depth, or composition across rows or columns/i)
assert.match(prompt, /repeat the same edge motif on every tile with the same compatible edge signature/i)
assert.match(prompt, /no unique edge marks, corners, or color jumps on opposite borders/i)
```

- [x] **Step 2: Run focused test and verify failure**

```bash
node --test test/scene-pack/tilePromptContracts.test.js
```

Expected: failure mentioning `scene_tile_prompt_contract_v0_5` or missing prompt text.

- [x] **Step 3: Implement v0.5 prompt contract**

In `src/scene-pack/tilePromptContracts.js`:

```js
export const SCENE_TILE_PROMPT_CONTRACT_VERSION = 'scene_tile_prompt_contract_v0_5'
```

Append to `RAW_STRUCTURE_RULES`:

```js
'Do not use the 4x4 atlas position to create gradients, lighting, camera depth, or composition across rows or columns.',
'Before drawing each source cell, imagine it being copied into a separate tile palette drawer; no road, river, cliff, shadow, highlight, or texture band may rely on adjacent source cells to finish its shape.',
```

Append to `SEAM_RULES`:

```js
'When an edge needs a motif, repeat the same edge motif on every tile with the same compatible edge signature instead of continuing a unique line across the atlas.',
'Place no unique edge marks, corners, or color jumps on opposite borders that would reveal the self-loop repeat.',
```

Append to `VALIDATION_EXPECTATIONS`:

```js
'no_atlas_scale_composition',
'edge_signature_motifs_repeated_not_continued',
'self_loop_edges_have_no_unique_marks',
```

- [x] **Step 4: Update downstream version assertions**

Change every scene tile prompt metadata assertion from v0.4 to v0.5 in:

```bash
rg "scene_tile_prompt_contract_v0_4" test src scripts docs
```

Only update scene tile prompt contract references; do not change unrelated character prompt contract references.

- [x] **Step 5: Update prompt protocol docs**

In `docs/protocols/scene-tile-prompt-contract.md`, update current version to `scene_tile_prompt_contract_v0_5`, add the three validation expectations, and add raw/seam bullets matching the new rule strings.

- [x] **Step 6: Run focused verification**

```bash
node --test test/scene-pack/tilePromptContracts.test.js test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
git diff --check
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add src/scene-pack/tilePromptContracts.js test/scene-pack/tilePromptContracts.test.js test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js docs/protocols/scene-tile-prompt-contract.md docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md
git commit -m "feat: harden scene tile prompt contract"
```

### Task 3: Add Manual Gemini v0.5 Prompt Pack And Re-Test Entry

**Files:**
- Create: `src/scene-pack/benchmark/sceneTileManualPromptPack.js`
- Create: `test/scene-pack/sceneTileManualPromptPack.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`
- Modify: `docs/protocols/scene-tile-live-generation.md`
- Modify: `docs/runbooks/scene-tile-strict-gate-readiness.md`

- [x] **Step 1: Write failing manual prompt pack module tests**

Create `test/scene-pack/sceneTileManualPromptPack.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSceneTileManualPromptPack } from '../../src/scene-pack/benchmark/sceneTileManualPromptPack.js'

test('buildSceneTileManualPromptPack compiles v0.5 prompts for default scene cases', () => {
  const pack = buildSceneTileManualPromptPack({
    runId: 'manual_v05',
    outputDir: 'tmp/manual-prompts',
    sampleSize: 2,
  })

  assert.equal(pack.mode, 'scene_tile_manual_prompt_pack_v0')
  assert.equal(pack.run_id, 'manual_v05')
  assert.equal(pack.output_dir, 'tmp/manual-prompts/manual_v05')
  assert.equal(pack.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_5')
  assert.deepEqual(pack.cases.map((item) => item.id), ['mossy_forest_ground', 'dry_cliff_path'])
  assert.equal(pack.cases[0].prompt_file, 'mossy_forest_ground/prompt.txt')
  assert.equal(pack.cases[0].expected_input_filename, 'mossy_forest_ground_192.png')
  assert.match(pack.cases[0].prompt, /repeat the same edge motif/i)
})
```

- [x] **Step 2: Run focused module test and verify failure**

```bash
node --test test/scene-pack/sceneTileManualPromptPack.test.js
```

Expected: module not found.

- [x] **Step 3: Implement manual prompt pack builder**

Create `src/scene-pack/benchmark/sceneTileManualPromptPack.js`:

```js
import path from 'node:path'

import {
  buildSceneTilePromptContract,
  compileSceneTilePromptContract,
  summarizeSceneTilePromptContract,
} from '../tilePromptContracts.js'
import { selectSceneTileGateCases } from './sceneTileLiveGate.js'

function safePathSegment(value, fallback = 'scene') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

export function buildSceneTileManualPromptPack({
  runId = 'scene_tile_manual_prompts',
  outputDir = 'generated/scene-tile-manual-prompts',
  caseIds = [],
  sampleSize,
} = {}) {
  const cases = selectSceneTileGateCases({ caseIds, sampleSize })
  const promptCases = cases.map((item) => {
    const id = safePathSegment(item.id)
    const contract = buildSceneTilePromptContract({ description: item.description })
    const prompt = compileSceneTilePromptContract(contract)
    return {
      id,
      description: item.description,
      prompt,
      prompt_file: `${id}/prompt.txt`,
      generation_file: `${id}/generation.json`,
      expected_input_filename: `${id}_192.png`,
      prompt_contract: summarizeSceneTilePromptContract(contract),
    }
  })
  const promptContract = promptCases[0]?.prompt_contract ?? summarizeSceneTilePromptContract(buildSceneTilePromptContract())
  return {
    schema_version: 1,
    mode: 'scene_tile_manual_prompt_pack_v0',
    run_id: runId,
    output_dir: path.join(outputDir, runId),
    prompt_contract: promptContract,
    cases: promptCases,
  }
}
```

- [x] **Step 4: Add CLI command**

In `scripts/character-pack-cli.mjs`, import `buildSceneTileManualPromptPack`, add `commandBenchmarkSceneTileManualPrompts(options)`, write:

```text
manual_prompt_pack.json
<case>/prompt.txt
<case>/generation.json
```

Return:

```js
{
  command: 'benchmark scene-tile-manual-prompts',
  mode: pack.mode,
  run_id: pack.run_id,
  output_dir: pack.output_dir,
  prompt_contract: pack.prompt_contract,
  case_ids: pack.cases.map((item) => item.id),
  prompt_files: pack.cases.map((item) => path.join(pack.output_dir, item.prompt_file)),
  expected_input_files: pack.cases.map((item) => item.expected_input_filename),
  pack_file: path.join(pack.output_dir, 'manual_prompt_pack.json'),
}
```

Add route:

```js
if (command === 'benchmark' && positional[1] === 'scene-tile-manual-prompts') return commandBenchmarkSceneTileManualPrompts(options)
```

- [x] **Step 5: Add CLI test**

In `test/character-pack/cli.test.js`, add:

```js
test('character pack CLI benchmark scene-tile-manual-prompts writes provider-free prompts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-manual-prompts-'))
  const result = await runCli([
    'benchmark',
    'scene-tile-manual-prompts',
    '--output-dir',
    outputDir,
    '--run-id',
    'manual_prompts',
    '--sample-size',
    '2',
  ])

  assert.equal(result.command, 'benchmark scene-tile-manual-prompts')
  assert.equal(result.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_5')
  assert.deepEqual(result.case_ids, ['mossy_forest_ground', 'dry_cliff_path'])
  assert.equal(await exists(path.join(outputDir, 'manual_prompts', 'manual_prompt_pack.json')), true)
  assert.match(await readFile(path.join(outputDir, 'manual_prompts', 'mossy_forest_ground', 'prompt.txt'), 'utf8'), /no unique edge marks/i)
})
```

- [x] **Step 6: Update runbooks/docs**

Document this provider-free command:

```bash
npm run character-pack -- benchmark scene-tile-manual-prompts \
  --output-dir generated/scene-tile-manual-prompts \
  --run-id gemini_manual_scene_tile_prompt_v05_20260617 \
  --sample-size 5
```

State that returned images should be normalized to 192x192 PNG files named by `expected_input_filename`, then passed to `benchmark scene-tile-correction-matrix`.

- [x] **Step 7: Run focused verification**

```bash
node --test test/scene-pack/sceneTileManualPromptPack.test.js test/character-pack/cli.test.js
git diff --check
```

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/scene-pack/benchmark/sceneTileManualPromptPack.js test/scene-pack/sceneTileManualPromptPack.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js docs/protocols/scene-tile-live-generation.md docs/runbooks/scene-tile-strict-gate-readiness.md docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md
git commit -m "feat: add scene tile manual prompt pack"
```

### Task 4: Run Available Re-Test Evidence And Record Decision Gate

**Files:**
- Modify: `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`
- Modify: `docs/roadmap/p0-p2-technical-upgrade-plan.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md`

- [x] **Step 1: Generate v0.5 manual prompt pack**

Run:

```bash
npm run character-pack -- benchmark scene-tile-manual-prompts \
  --output-dir generated/scene-tile-manual-prompts \
  --run-id gemini_manual_scene_tile_prompt_v05_20260617 \
  --sample-size 5
```

Expected: JSON output with five case ids and `scene_tile_prompt_contract_v0_5`.

- [x] **Step 2: Check for new manual v0.5 images**

Check only the explicit expected input directory:

```bash
ls -l /tmp/scene-tile-gemini-v05-sheets
```

Expected if the user has supplied new images:

```text
mossy_forest_ground_192.png
dry_cliff_path_192.png
snowy_ruins_floor_192.png
wet_cave_floor_192.png
village_dirt_road_192.png
```

If the directory or files are missing, do not mark the full 1-4 goal complete. Record the prompt pack as ready and the v0.5 re-test as pending external images.

- [x] **Step 3: Run v0.5 matrix if images exist**
  External images were supplied under `/tmp/scene-tile-gemini-v05-sheets/`, but
  the original files were JPEG-encoded `1024x1024` images with `.png` names.
  The manual retest helper rejected the original inputs with
  `source_sheet_size_mismatch`, so they do not count as contract-compliant raw
  v0.5 evidence.

If the files exist, run:

```bash
npm run character-pack -- benchmark scene-tile-correction-matrix \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id gemini_manual_scene_tile_v05_raw_quality_20260617 \
  --input /tmp/scene-tile-gemini-v05-sheets/mossy_forest_ground_192.png --id mossy_forest_ground \
  --input /tmp/scene-tile-gemini-v05-sheets/dry_cliff_path_192.png --id dry_cliff_path \
  --input /tmp/scene-tile-gemini-v05-sheets/snowy_ruins_floor_192.png --id snowy_ruins_floor \
  --input /tmp/scene-tile-gemini-v05-sheets/wet_cave_floor_192.png --id wet_cave_floor \
  --input /tmp/scene-tile-gemini-v05-sheets/village_dirt_road_192.png --id village_dirt_road \
  --width 3 \
  --height 3 \
  --pattern rule \
  --seed 7 \
  --density 0.55 \
  --raw-tile-policy strict \
  --style-max-colors 16 \
  --edge-band 3 \
  --edge-condition-mode edge-aware-v1
```

Expected decision data:

- If `raw_quality_readiness.status` is `ready`, WFC/LDtk can become the next candidate block.
- If `raw_quality_readiness.status` is `not_ready`, continue raw-quality closure and use `raw_quality_diagnostics` as the next target list.

Actual follow-up diagnostic:

```bash
npm run character-pack -- benchmark scene-tile-manual-retest \
  --input-dir /tmp/scene-tile-gemini-v05-sheets-normalized \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id gemini_manual_scene_tile_v05_raw_quality_20260617_normalized \
  --sample-size 5
```

Result:

- Normalized matrix:
  `generated/scene-tile-correction-matrix/gemini_manual_scene_tile_v05_raw_quality_20260617_normalized/scene_tile_correction_matrix.json`
- `raw_quality_readiness.status`: `not_ready`
- Raw validation: `0` pass, `0` warning, `5` fail
- Raw diagnostics: `41` visual seam failures, `98` self-loop failures, `33`
  source-atlas continuities, and `0` duplicate runtime tile pairs
- Decision: continue raw-quality closure; WFC and LDtk auto-layer expansion
  remain gated.

- [x] **Step 4: Record decision gate**

In `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`, add a section:

```markdown
## Raw Quality Closure v0.5 Gate

- Prompt pack: `generated/scene-tile-manual-prompts/gemini_manual_scene_tile_prompt_v05_20260617/manual_prompt_pack.json`
- Prompt contract: `scene_tile_prompt_contract_v0_5`
- Re-test image status: pending external Gemini images under `/tmp/scene-tile-gemini-v05-sheets/`.
- Decision: WFC and LDtk auto-layer expansion remain gated until the v0.5 manual matrix or a live `5 x 4` gate shows `raw_quality_readiness.status` is `ready`.
```

If the matrix was run, replace the pending image line with the matrix artifact path, raw readiness status, blocker list, and diagnostics counts.

- [x] **Step 5: Update roadmap notes**

In `docs/roadmap/p0-p2-technical-upgrade-plan.md`, add a raw-quality closure note that v0.5 diagnostics/prompt/manual prompt pack are implemented and WFC/LDtk remains gated until v0.5 re-test evidence passes.

In `docs/roadmap/technology-reference-roadmap.md`, add an update log row for the raw diagnostics/prompt pack block.

- [x] **Step 6: Run final verification**

```bash
git diff --check
node --test test/scene-pack/tilePromptContracts.test.js test/scene-pack/sceneTileCorrectionMatrix.test.js test/scene-pack/sceneTileManualPromptPack.test.js test/character-pack/cli.test.js test/serverOpenRouter.test.js
npm test
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md docs/roadmap/p0-p2-technical-upgrade-plan.md docs/roadmap/technology-reference-roadmap.md docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md
git commit -m "docs: gate scene tile raw quality closure"
```

### Continuation Helper: Manual Re-Test Runner

**Files:**
- Modify: `src/scene-pack/benchmark/sceneTileManualPromptPack.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/scene-pack/sceneTileManualPromptPack.test.js`
- Modify: `test/character-pack/cli.test.js`
- Modify: `docs/protocols/scene-tile-live-generation.md`
- Modify: `docs/runbooks/scene-tile-strict-gate-readiness.md`

- [x] **Step 1: Add input inspection**

`inspectSceneTileManualRetestInputs()` checks the expected v0.5 filenames under
`/tmp/scene-tile-gemini-v05-sheets/` and returns `missing_inputs` when images
are absent.

- [x] **Step 2: Add CLI runner**

`benchmark scene-tile-manual-retest` writes `manual_retest_status.json`; when
all inputs exist, it runs `runSceneTileCorrectionMatrix()` with the standard
strict raw-quality options.

- [x] **Step 3: Verify helper**

```bash
node --test test/scene-pack/sceneTileManualPromptPack.test.js test/character-pack/cli.test.js
git diff --check
```

Expected: all pass.

## Completion Boundary

This goal is complete only when:

- Raw diagnostics are available in correction matrix JSON, Markdown, and CLI output.
- Scene tile prompt contract is v0.5 and all scene tile metadata tests expect v0.5.
- A provider-free manual prompt pack command writes five v0.5 prompts and expected input filenames.
- Decision docs state whether v0.5 re-test images are present. If images are absent, WFC/LDtk remain gated and the goal remains active until the user supplies images or accepts the pending-external-image boundary explicitly.
- If images are present but fail the source-sheet contract, the original-input
  failure and any normalized diagnostic result are recorded separately.
- `npm test` passes.

## Self-Review

- Spec coverage: the plan covers the requested 1-4 sequence: diagnostics, prompt v0.5, manual Gemini re-test entry, and decision gate. It explicitly keeps WFC/LDtk out of scope.
- Placeholder scan: no task contains TBD/TODO placeholders; external-image absence has an explicit handling path.
- Type consistency: new fields are consistently named `raw_quality_diagnostics`, `raw_quality_readiness`, and `scene_tile_manual_prompt_pack_v0`.
