# Scene Tile Raw Output Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce scene tile correction dependency by making raw provider source sheets behave more like independent reusable dual-grid tile inventories before WFC, LDtk auto-layer rules, or map-editor expansion.

**Architecture:** Keep the current scene/tile pipeline intact: provider output still flows through prompt contract, tile ingestion, strict quality gates, correction matrix, scene reports, and live-gate evidence. This pass changes the provider-facing contract and evidence summaries first; it does not add new arrangement/export scope.

**Tech Stack:** Node.js ESM, `node:test`, existing scene pack modules under `src/scene-pack/`, existing CLI in `scripts/character-pack-cli.mjs`, Markdown runbooks and roadmap docs.

---

## Evidence Baseline

Current manual external Gemini matrix:

- Matrix artifact: `generated/scene-tile-correction-matrix/gemini_manual_scene_tile_raw_style_edge_matrix_20260617/scene_tile_correction_matrix.json`
- `raw`: `0 / 5` pass.
- `style_snap`: `1 / 5` pass.
- `style_snap_edge_aware`: `5 / 5` pass.
- Raw blockers:
  - `tile.source_atlas_continuity`: `5 / 5`
  - `tile.self_loop_mismatch`: `4 / 5`
  - `tile.visual_seam_mismatch`: `4 / 5`
- Style snap clears `source_atlas_structure` in `5 / 5`.
- Edge-aware conditioning clears `visual_seams` and `tile_self_loops` in `4 / 5`, but visible mutation warnings remain in `4 / 5`.

## File Structure

- Modify `src/scene-pack/tilePromptContracts.js`: upgrade the prompt contract to a raw-inventory-focused version and add explicit anti-continuity and self-loop proof rules.
- Modify `test/scene-pack/tilePromptContracts.test.js`: lock the new contract version and prompt strings.
- Modify `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`: add a `raw_quality_readiness` summary derived from raw variant status, raw blocker taxonomy, and transition evidence.
- Modify `test/scene-pack/sceneTileCorrectionMatrix.test.js`: cover positive and negative raw readiness cases.
- Modify `scripts/character-pack-cli.mjs`: expose `raw_quality_readiness` from `benchmark scene-tile-correction-matrix`.
- Modify `test/character-pack/cli.test.js`: assert CLI JSON includes raw readiness.
- Modify `docs/protocols/scene-tile-prompt-contract.md`: document the new prompt contract version and validation expectations.
- Modify `docs/protocols/scene-tile-live-generation.md`: document matrix readiness interpretation.
- Modify `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`: update the decision boundary after the matrix is rerun.
- Modify `docs/roadmap/p0-p2-technical-upgrade-plan.md`: record the raw-quality pass status and next gate.
- Modify `docs/roadmap/technology-reference-roadmap.md`: add one tracking note when the pass is implemented.

## Non-Goals

- Do not add WFC.
- Do not add LDtk auto-layer rules.
- Do not add map-editor UI.
- Do not loosen strict raw tile gates to make current samples pass.
- Do not commit manual Gemini images or generated matrix artifacts.
- Do not change provider key handling.

### Task 1: Upgrade Scene Tile Prompt Contract To Raw Inventory v0.4

**Files:**
- Modify: `src/scene-pack/tilePromptContracts.js`
- Modify: `test/scene-pack/tilePromptContracts.test.js`
- Modify: `test/scene-pack/tileGenerate.test.js` (downstream contract-version metadata assertion)
- Modify: `test/character-pack/cli.test.js` (downstream contract-version metadata assertion)
- Modify: `docs/protocols/scene-tile-prompt-contract.md`

- [x] **Step 1: Write the failing prompt contract test**

In `test/scene-pack/tilePromptContracts.test.js`, change the version assertion and add raw inventory assertions:

```js
assert.equal(contract.contract_version, 'scene_tile_prompt_contract_v0_4')
assert.ok(contract.validation_contract.expectations.includes('source_cells_independent_after_shuffle'))
assert.ok(contract.validation_contract.expectations.includes('no_cross_cell_terrain_continuity'))
assert.ok(contract.validation_contract.expectations.includes('self_loop_edges_visible_in_each_tile'))
assert.match(prompt, /would still read correctly if the 16 cells were shuffled/i)
assert.match(prompt, /no terrain stroke may continue from one source cell into the neighboring source cell/i)
assert.match(prompt, /prove self-loop readiness inside each tile/i)
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test test/scene-pack/tilePromptContracts.test.js
```

Expected: failure mentioning `scene_tile_prompt_contract_v0_4` or missing prompt text.

- [x] **Step 3: Implement the minimal prompt contract upgrade**

In `src/scene-pack/tilePromptContracts.js`, change the version and add the new rules:

```js
export const SCENE_TILE_PROMPT_CONTRACT_VERSION = 'scene_tile_prompt_contract_v0_4'
```

Append these strings to `RAW_STRUCTURE_RULES`:

```js
'Design every central runtime tile so it would still read correctly if the 16 source cells were shuffled into a different order.',
'No terrain stroke may continue from one source cell into the neighboring source cell; source-cell borders are layout dividers, not world-space edges.',
'Keep large paths, cracks, rivers, cliffs, shadows, and texture bands fully contained inside one runtime tile unless the same motif is intentionally repeated on all compatible edge signatures.',
```

Append this string to `SEAM_RULES`:

```js
'Prove self-loop readiness inside each tile: north must repeat against south, west must repeat against east, and no unique edge mark should reveal the repeat.',
```

Append these strings to `VALIDATION_EXPECTATIONS`:

```js
'source_cells_independent_after_shuffle',
'no_cross_cell_terrain_continuity',
'self_loop_edges_visible_in_each_tile',
```

- [x] **Step 4: Update the prompt protocol doc**

In `docs/protocols/scene-tile-prompt-contract.md`, change:

```text
scene_tile_prompt_contract_v0_3
```

to:

```text
scene_tile_prompt_contract_v0_4
```

Add under `## Raw Structure Rules`:

```markdown
- each tile must still read correctly if the atlas cells are shuffled,
- source-cell borders are layout dividers, not world-space edges,
- large terrain motifs must stay inside one runtime tile unless repeated by
  edge signature across compatible masks.
```

- [x] **Step 5: Run focused verification**

Run:

```bash
node --test test/scene-pack/tilePromptContracts.test.js
```

Expected: all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/scene-pack/tilePromptContracts.js test/scene-pack/tilePromptContracts.test.js test/scene-pack/tileGenerate.test.js test/character-pack/cli.test.js docs/protocols/scene-tile-prompt-contract.md docs/superpowers/plans/2026-06-17-scene-tile-raw-output-quality-pass.md
git commit -m "feat: tighten scene tile raw prompt contract"
```

### Task 2: Add Raw Quality Readiness To Correction Matrix

**Files:**
- Modify: `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`
- Modify: `test/scene-pack/sceneTileCorrectionMatrix.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`
- Modify: `docs/protocols/scene-tile-live-generation.md`

- [x] **Step 1: Write readiness assertions in the matrix test**

In the existing passing-sheet test in `test/scene-pack/sceneTileCorrectionMatrix.test.js`, add:

```js
assert.equal(result.summary.raw_quality_readiness.status, 'ready')
assert.deepEqual(result.summary.raw_quality_readiness.blockers, [])
```

In the existing mismatched-sheet test, add:

```js
assert.equal(result.summary.raw_quality_readiness.status, 'not_ready')
assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_variant_failures'))
assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_visual_seam_failures'))
assert.ok(result.summary.raw_quality_readiness.blockers.includes('raw_self_loop_failures'))
```

- [x] **Step 2: Run focused tests and verify they fail**

Run:

```bash
node --test test/scene-pack/sceneTileCorrectionMatrix.test.js
```

Expected: failure because `raw_quality_readiness` is not defined.

- [x] **Step 3: Implement readiness summary**

In `src/scene-pack/benchmark/sceneTileCorrectionMatrix.js`, add this function near `summarizeMatrixItems()`:

```js
function buildRawQualityReadiness({ byVariant, blockerTaxonomyByVariant, gateTransitions }) {
  const raw = byVariant.find((variant) => variant.id === 'raw')
  const rawBlockers = blockerTaxonomyByVariant.find((item) => item.variant_id === 'raw')?.top_categories ?? []
  const rawGateTransitions = gateTransitions.raw_to_style_snap_edge_aware ?? []
  const blockers = []
  if (!raw || raw.validation.fail > 0 || raw.validation.warning > 0 || raw.validation.unknown > 0) blockers.push('raw_variant_failures')
  if (rawBlockers.some((item) => item.id === 'tile.source_atlas_continuity')) blockers.push('raw_source_atlas_continuity')
  if (rawBlockers.some((item) => item.id === 'tile.visual_seam_mismatch')) blockers.push('raw_visual_seam_failures')
  if (rawBlockers.some((item) => item.id === 'tile.self_loop_mismatch')) blockers.push('raw_self_loop_failures')
  if (rawGateTransitions.some((gate) => gate.id === 'visual_seams' && gate.improved > 0)) blockers.push('correction_masks_visual_seams')
  if (rawGateTransitions.some((gate) => gate.id === 'tile_self_loops' && gate.improved > 0)) blockers.push('correction_masks_self_loops')
  return {
    status: blockers.length ? 'not_ready' : 'ready',
    blockers,
    raw_validation: raw?.validation ?? { pass: 0, warning: 0, fail: 0, unknown: 0 },
  }
}
```

In `summarizeMatrixItems()`, compute the existing summaries once and return `raw_quality_readiness`:

```js
const gateTransitions = summarizeGateTransitions([...bySample.values()])
const blockerTaxonomyByVariant = buildVariantIssueTaxonomy(items)
const blockerTransitions = summarizeIssueTransitions([...bySample.values()])
```

Then include:

```js
gate_transitions: gateTransitions,
blocker_taxonomy_by_variant: blockerTaxonomyByVariant,
blocker_transitions: blockerTransitions,
raw_quality_readiness: buildRawQualityReadiness({
  byVariant,
  blockerTaxonomyByVariant,
  gateTransitions,
}),
```

- [x] **Step 4: Expose readiness from CLI**

In `scripts/character-pack-cli.mjs`, add to `commandBenchmarkSceneTileCorrectionMatrix()` return value:

```js
raw_quality_readiness: result.summary.raw_quality_readiness,
```

In `test/character-pack/cli.test.js`, add:

```js
assert.equal(result.raw_quality_readiness.status, 'ready')
```

- [x] **Step 5: Update protocol docs**

In `docs/protocols/scene-tile-live-generation.md`, extend the matrix summary sentence:

```markdown
Its summary includes `raw_quality_readiness`, variant validation,
`gate_transitions`, `blocker_taxonomy_by_variant`, and `blocker_transitions`
so raw-output quality work can target the gates that local correction is
currently masking.
```

- [x] **Step 6: Run focused verification**

Run:

```bash
node --test test/scene-pack/sceneTileCorrectionMatrix.test.js test/character-pack/cli.test.js
```

Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/scene-pack/benchmark/sceneTileCorrectionMatrix.js test/scene-pack/sceneTileCorrectionMatrix.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js docs/protocols/scene-tile-live-generation.md
git commit -m "feat: report scene tile raw readiness"
```

### Task 3: Re-Run Manual External Matrix And Update Decision Evidence

**Files:**
- Modify: `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`
- Modify: `docs/roadmap/p0-p2-technical-upgrade-plan.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`

- [x] **Step 1: Re-run the five-sample provider-free matrix**

Run:

```bash
npm run character-pack -- benchmark scene-tile-correction-matrix \
  --output-dir generated/scene-tile-correction-matrix \
  --run-id gemini_manual_scene_tile_raw_quality_readiness_20260617 \
  --input /tmp/scene-tile-gemini-sheets/mossy_forest_192.png --id mossy_forest \
  --input /tmp/scene-tile-gemini-sheets/dry_rocky_192.png --id dry_rocky \
  --input /tmp/scene-tile-gemini-sheets/snowy_ruins_192.png --id snowy_ruins \
  --input /tmp/scene-tile-gemini-sheets/wet_cave_192.png --id wet_cave \
  --input /tmp/scene-tile-gemini-sheets/village_dirt_192.png --id village_dirt \
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

Expected:

- `raw_quality_readiness.status`: `not_ready`
- `raw_quality_readiness.blockers` includes:
  - `raw_variant_failures`
  - `raw_source_atlas_continuity`
  - `raw_visual_seam_failures`
  - `raw_self_loop_failures`
  - `correction_masks_visual_seams`
  - `correction_masks_self_loops`

- [x] **Step 2: Update the decision doc**

In `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`, add under the matrix result list:

```markdown
- Raw readiness: `not_ready`.
- Raw readiness blockers:
  `raw_variant_failures`, `raw_source_atlas_continuity`,
  `raw_visual_seam_failures`, `raw_self_loop_failures`,
  `correction_masks_visual_seams`, and `correction_masks_self_loops`.
```

- [x] **Step 3: Update the roadmap plan**

In `docs/roadmap/p0-p2-technical-upgrade-plan.md`, add under the strict gate attempt notes:

```markdown
- Raw readiness is explicitly `not_ready` for the manual external matrix until
  raw variant failures and correction-masked seam/self-loop blockers are reduced.
```

- [x] **Step 4: Update the technology roadmap**

In `docs/roadmap/technology-reference-roadmap.md`, add one tracking row:

```markdown
| 2026-06-17 (later) | Added raw-readiness interpretation for scene tile correction matrices; the manual external sample remains `not_ready`, so WFC/LDtk expansion stays gated. |
```

- [x] **Step 5: Run docs/code verification**

Run:

```bash
git diff --check
node --test test/scene-pack/sceneTileCorrectionMatrix.test.js test/character-pack/cli.test.js
npm test
```

Expected:

- `git diff --check` exits with no output.
- Focused tests pass.
- Full test suite passes.

- [x] **Step 6: Commit**

```bash
git add docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md docs/roadmap/p0-p2-technical-upgrade-plan.md docs/roadmap/technology-reference-roadmap.md
git commit -m "docs: record scene tile raw readiness"
```

## Release And Claim Boundary

This plan only makes raw-output quality measurable and improves the prompt contract. It does not claim that scene tiles are ready for WFC, LDtk auto-layer rules, or map-editor expansion.

The next block may proceed to WFC or LDtk auto-layer only after one of these is true:

- the original live `5 x 4` strict gate returns selected candidates whose raw readiness is `ready`, or
- a later documented decision accepts a smaller gated scope with explicit limitations.

## Verification Summary For Implementers

Always run before final commit:

```bash
git diff --check
node --test test/scene-pack/tilePromptContracts.test.js test/scene-pack/sceneTileCorrectionMatrix.test.js test/scene-pack/sceneTileReport.test.js test/scene-pack/sceneTileLiveGate.test.js test/character-pack/cli.test.js
npm test
```

Do not stage:

- `.agents/`
- `.env`
- files under `generated/`
- manual Gemini scratch images under `/tmp` or `<home>/.gemini/`

## Self-Review

- Spec coverage: the plan covers raw prompt contract tightening, provider-free matrix readiness, manual external evidence rerun, and decision/roadmap updates. It keeps WFC/LDtk gated.
- Placeholder scan: the plan contains no unresolved placeholder markers or unspecified test commands.
- Type consistency: the new field name is consistently `raw_quality_readiness`; blocker ids are exact strings used in tests, CLI output, and docs.
