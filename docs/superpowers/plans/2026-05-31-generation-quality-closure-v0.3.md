# Generation Quality Closure v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden prompt contracts and benchmark reporting so real generation failures are classified, visible, and actionable.

**Architecture:** Upgrade prompt contracts in the existing contract compiler, add a shared taxonomy module, then wire that taxonomy into processor reports, OpenRouter benchmark summaries, processed-sample summaries, and the local gallery. Keep raw validator messages intact and add taxonomy as structured metadata beside them.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing character-pack processor, OpenRouter benchmark runner, local HTTP server, browser JavaScript, CSS.

---

### Task 1: Prompt Contract v1.1

**Files:**
- Modify: `src/character-pack/promptContracts.js`
- Modify: `test/character-pack/promptContracts.test.js`
- Modify: `docs/protocols/prompt-contracts.md`

- [ ] **Step 1: Write failing prompt contract tests**

Add these assertions to `test/character-pack/promptContracts.test.js`:

```js
assert.equal(contract.contract_version, 'character_prompt_contract_v1_1')
assert.ok(contract.validation_contract.expectations.includes('no_empty_cells'))
assert.ok(contract.validation_contract.expectations.includes('no_cropped_or_edge_cut_character'))
assert.ok(contract.validation_contract.expectations.includes('layout_template_has_priority_over_reference_images'))
assert.match(prompt, /Every required cell must contain one visible complete character pose/i)
assert.match(prompt, /no cell may be blank, empty, white-only, transparent-only, or background-only/i)
assert.match(prompt, /Do not use a one-image fixed-region motion layout/i)
```

For the OCAD test, add:

```js
assert.equal(contract.contract_version, 'character_prompt_contract_v1_1')
assert.ok(contract.validation_contract.expectations.includes('no_empty_cells'))
assert.match(prompt, /Every required fixed region must contain the complete character pose/i)
assert.match(prompt, /Do not subdivide the sheet into 8x8 equal cells/i)
assert.doesNotMatch(prompt, /Rows: idle down\/up/i)
assert.doesNotMatch(prompt, /exactly 64 cells total/i)
```

For provider image guidance, add:

```js
assert.match(prompt, /written layout contract and structural template override all reference and palette images/i)
assert.match(prompt, /reference images must not override layout/i)
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/character-pack/promptContracts.test.js
```

Expected: FAIL because the contract is still `character_prompt_contract_v1` and the new wording is absent.

- [ ] **Step 3: Implement v1.1 wording**

In `src/character-pack/promptContracts.js`:

```js
export const PROMPT_CONTRACT_VERSION = 'character_prompt_contract_v1_1'
```

Add shared validation expectations:

```js
const COMPLETENESS_EXPECTATIONS = [
  'no_empty_cells',
  'no_blank_or_near_blank_cells',
  'no_cropped_or_edge_cut_character',
  'full_body_visible_in_every_cell',
  'minimum_character_occupancy_per_cell',
  'maximum_edge_pressure_per_cell',
  'consistent_cell_scale',
  'consistent_cell_padding',
  'no_partial_body_closeups',
  'layout_template_has_priority_over_reference_images',
  'reference_images_must_not_override_layout',
]
```

Merge them into each layout contract's `validation_contract.expectations`.

Add topdown prompt lines:

```text
Every required cell must contain one visible complete character pose; no cell may be blank, empty, white-only, transparent-only, or background-only.
The full character body must remain inside each cell with clear padding on all sides; do not crop heads, feet, hands, hair, clothing, or pose silhouettes at cell boundaries.
Do not draw only a head, torso, limb, close-up, silhouette fragment, or partial body in any required frame.
Do not use a one-image fixed-region motion layout, OCAD-style region map, wide action strips, non-uniform regions, or variable-width cells.
The 8x8 grid contract overrides any attached image if the image appears to suggest a different layout.
```

Add OCAD prompt lines:

```text
Every required fixed region must contain the complete character pose for that source action; no required region may be blank, empty, white-only, transparent-only, or background-only.
Keep each pose inside its assigned fixed region with clear padding; do not crop heads, feet, hands, hair, clothing, or pose silhouettes at region boundaries.
Do not subdivide the sheet into 8x8 equal cells, runtime rows, attack rows, hurt rows, or 64 uniform frames.
For wide regions such as attract/interact and die/downed, use the available region width but keep the whole body visible.
```

Update provider image guidance with:

```text
The written layout contract and structural template override all reference and palette images. Reference images must not override layout, frame count, cell boundaries, or fixed-region positions.
```

- [ ] **Step 4: Update protocol docs**

In `docs/protocols/prompt-contracts.md`, update the contract metadata example to v1.1 and list the added expectations. Add a short `v1.1 Quality Rules` section that states:

```text
v1.1 adds explicit non-empty, no-crop, full-body, padding, and template-priority rules. It does not change the supported layout ids.
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/character-pack/promptContracts.test.js test/character-pack/geminiProvider.test.js test/serverOpenRouter.test.js test/character-pack/openRouterBenchmark.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add src/character-pack/promptContracts.js test/character-pack/promptContracts.test.js docs/protocols/prompt-contracts.md
git commit -m "feat: harden prompt contract quality rules"
```

Expected: commit includes only prompt-contract implementation, tests, and protocol docs.

### Task 2: Shared Failure Taxonomy

**Files:**
- Create: `src/character-pack/failureTaxonomy.js`
- Create: `test/character-pack/failureTaxonomy.test.js`
- Modify: `src/character-pack/processSheet.js`
- Modify: `test/character-pack/processSheet.test.js`

- [ ] **Step 1: Write taxonomy unit tests**

Create `test/character-pack/failureTaxonomy.test.js` with cases:

```js
assert.equal(classifyValidationMessages({ blocking_errors: ['frame_6_empty'] }).primary, 'structure.empty_frame')
assert.equal(classifyValidationMessages({ blocking_errors: ['frame_2_cropped'] }).primary, 'structure.cropped')
assert.equal(classifyValidationMessages({ blocking_errors: ['frame_count_mismatch'] }).primary, 'structure.frame_count')
assert.equal(classifyValidationMessages({ warnings: ['walk_down_low_motion'] }).primary, 'motion.low_motion')
assert.equal(classifyValidationMessages({ warnings: ['frame_1_anchor_drift'] }).primary, 'alignment.anchor_drift')
assert.equal(classifyValidationMessages({ warnings: ['frame_1_baseline_drift'] }).primary, 'alignment.baseline_drift')
assert.equal(classifyValidationMessages({ warnings: ['halo_score_high'] }).primary, 'background.halo')
assert.equal(classifyValidationMessages({ warnings: ['edge_pressure_high'] }).primary, 'composition.edge_pressure')
assert.equal(classifyValidationMessages({ warnings: ['source_region_edge_pressure_high'] }).primary, 'layout.source_region_edge_pressure')
assert.equal(classifyValidationMessages({ warnings: ['dual_matte_inconsistent'] }).primary, 'background.dual_matte')
assert.equal(classifyBenchmarkItem({ failure: { mode: 'model_error' } }).primary, 'provider.model_error')
assert.equal(classifyBenchmarkItem({ failure: { mode: 'post_processing' } }).primary, 'pipeline.post_processing')
assert.equal(classifyBenchmarkItem({ failure: { mode: 'unexpected_error' } }).primary, 'pipeline.unexpected_error')
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/character-pack/failureTaxonomy.test.js
```

Expected: FAIL because `src/character-pack/failureTaxonomy.js` does not exist.

- [ ] **Step 3: Implement taxonomy module**

Create `src/character-pack/failureTaxonomy.js` exporting:

```js
export function classifyValidationMessages({ status, warnings = [], blocking_errors = [], metrics = {} } = {}) {}
export function classifyBenchmarkItem(item = {}) {}
export function summarizeFailureTaxonomy(items = []) {}
```

Return this shape:

```json
{
  "primary": "structure.empty_frame",
  "severity": "error",
  "categories": [
    { "id": "structure.empty_frame", "severity": "error", "count": 1, "examples": ["frame_6_empty"] }
  ]
}
```

Severity order:

```text
error > warning > info
```

Primary category is the highest-severity category; ties keep first-seen order.

- [ ] **Step 4: Attach taxonomy to processor reports**

In `src/character-pack/processSheet.js`, after background warnings are merged into `validationWithBackground`, add:

```js
validationWithBackground.failure_taxonomy = classifyValidationMessages(validationWithBackground)
```

Import `classifyValidationMessages` from `failureTaxonomy.js`.

- [ ] **Step 5: Add processor coverage**

Extend `test/character-pack/processSheet.test.js` so a report containing merged background/source warnings asserts:

```js
assert.ok(debugReport.validation.failure_taxonomy)
assert.ok(debugReport.validation.failure_taxonomy.categories.some((category) => category.id === 'layout.source_region_edge_pressure'))
```

Use existing process-sheet fixtures in the test file; do not introduce external image assets.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/character-pack/failureTaxonomy.test.js test/character-pack/processSheet.test.js test/character-pack/validator.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git status --short
git add src/character-pack/failureTaxonomy.js test/character-pack/failureTaxonomy.test.js src/character-pack/processSheet.js test/character-pack/processSheet.test.js
git commit -m "feat: add character failure taxonomy"
```

Expected: commit includes taxonomy module, processor wiring, and tests.

### Task 3: Benchmark Taxonomy Reporting

**Files:**
- Modify: `src/character-pack/benchmark/openRouterBenchmark.js`
- Modify: `src/character-pack/benchmark/processedSampleBenchmark.js`
- Modify: `test/character-pack/openRouterBenchmark.test.js`
- Modify: `test/character-pack/processedSampleBenchmark.test.js`

- [ ] **Step 1: Write OpenRouter benchmark tests**

Extend `test/character-pack/openRouterBenchmark.test.js` with summary coverage:

```js
const summary = summarizeOpenRouterBenchmark([
  { validation: { status: 'fail', blocking_errors: ['frame_6_empty'], warnings: [] }, failure: { mode: 'post_processing', reason: 'frame_6_empty' } },
  { validation: { status: 'warning', blocking_errors: [], warnings: ['halo_score_high'] } },
  { validation: { status: 'unknown' }, failure: { mode: 'model_error', reason: 'provider rejected request' } },
])

assert.equal(summary.failure_taxonomy.top_categories[0].id, 'structure.empty_frame')
assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'background.halo'))
assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'provider.model_error'))
```

Add a generated failed item test asserting:

```js
assert.equal(item.failure_taxonomy.primary, 'structure.empty_frame')
```

- [ ] **Step 2: Wire OpenRouter item and summary taxonomy**

In `src/character-pack/benchmark/openRouterBenchmark.js`:

```js
import { classifyBenchmarkItem, summarizeFailureTaxonomy } from '../failureTaxonomy.js'
```

Before pushing each benchmark item:

```js
item.failure_taxonomy = classifyBenchmarkItem(item)
```

In `summarizeOpenRouterBenchmark(items)`:

```js
failure_taxonomy: summarizeFailureTaxonomy(items),
```

Keep existing `top_warnings`, `top_blocking_errors`, `failures`, `pass_rate`, and `usable_rate` fields unchanged.

- [ ] **Step 3: Replace processed-sample substring classifier**

In `src/character-pack/benchmark/processedSampleBenchmark.js`, remove the local substring-only classifier and derive `failure_modes` from `classifyBenchmarkItem()` or `classifyValidationMessages()`.

Preserve existing output keys:

```text
cropped_frames
empty_frames
low_motion
halo
edge_pressure
```

by mapping:

```text
structure.cropped -> cropped_frames
structure.empty_frame -> empty_frames
motion.low_motion -> low_motion
background.halo -> halo
composition.edge_pressure -> edge_pressure
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/character-pack/openRouterBenchmark.test.js test/character-pack/processedSampleBenchmark.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/character-pack/benchmark/openRouterBenchmark.js src/character-pack/benchmark/processedSampleBenchmark.js test/character-pack/openRouterBenchmark.test.js test/character-pack/processedSampleBenchmark.test.js
git commit -m "feat: summarize benchmark failure taxonomy"
```

Expected: commit includes benchmark taxonomy reporting only.

### Task 4: Local Gallery Taxonomy Display

**Files:**
- Modify: `src/character-pack/benchmark/benchmarkGallery.js`
- Modify: `src/ui/characterPack/renderers.js`
- Modify: `src/ui/characterPack/styles.css`
- Modify: `test/character-pack/benchmarkGallery.test.js`

- [ ] **Step 1: Write gallery pass-through test**

In `test/character-pack/benchmarkGallery.test.js`, add a report item with:

```json
{
  "failure_taxonomy": {
    "primary": "structure.empty_frame",
    "severity": "error",
    "categories": [
      { "id": "structure.empty_frame", "severity": "error", "count": 1, "examples": ["frame_6_empty"] }
    ]
  }
}
```

Assert:

```js
assert.equal(item.failure_taxonomy.primary, 'structure.empty_frame')
assert.equal(item.failure_taxonomy.categories[0].examples[0], 'frame_6_empty')
```

- [ ] **Step 2: Pass taxonomy through gallery API**

In `src/character-pack/benchmark/benchmarkGallery.js`, include:

```js
failure_taxonomy: item.failure_taxonomy ?? item.validation?.failure_taxonomy ?? null,
```

inside the compact item object.

- [ ] **Step 3: Render taxonomy badges**

In `src/ui/characterPack/renderers.js`, add a compact row in each benchmark item card:

```js
const taxonomy = item.failure_taxonomy
const taxonomyBadges = taxonomy?.categories?.slice(0, 3).map((category) => `
  <span class="benchmark-taxonomy-badge benchmark-taxonomy-badge--${escapeHtml(category.severity || 'info')}">
    ${escapeHtml(category.id)}${category.count > 1 ? ` x${category.count}` : ''}
  </span>
`).join('') || ''
```

Render the row only when `taxonomyBadges` is non-empty.

- [ ] **Step 4: Style badges**

In `src/ui/characterPack/styles.css`, add compact badge styling that does not change card layout:

```css
.benchmark-taxonomy {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 22px;
}
```

Add severity modifiers for `error`, `warning`, and `info`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/character-pack/benchmarkGallery.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add src/character-pack/benchmark/benchmarkGallery.js src/ui/characterPack/renderers.js src/ui/characterPack/styles.css test/character-pack/benchmarkGallery.test.js
git commit -m "feat: show benchmark failure taxonomy"
```

Expected: commit includes gallery API pass-through, UI rendering, styling, and tests.

### Task 5: Verification And Benchmark Gate

**Files:**
- Create: `docs/decisions/2026-05-31-generation-quality-closure-benchmark.md`
- Modify if needed: `docs/runbooks/openrouter-character-benchmark.md`

- [ ] **Step 1: Run full static and unit verification**

Run:

```bash
npm test
git diff --check
```

Expected: `npm test` passes all tests and `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Run a small real benchmark gate**

If the environment has a valid provider key, run:

```bash
node scripts/benchmark-openrouter-character-pack.mjs --samples 1 --variants 1 --preset topdown_rpg_v0
```

If the script supports OCAD preset selection and the first run is stable enough to continue, run:

```bash
node scripts/benchmark-openrouter-character-pack.mjs --samples 1 --variants 1 --preset ocad_motion_v0
```

Expected: benchmark artifacts are written under the existing OpenRouter benchmark root and reports include `prompt_contract.contract_version = character_prompt_contract_v1_1` plus `failure_taxonomy`.

- [ ] **Step 3: Record benchmark result**

Create `docs/decisions/2026-05-31-generation-quality-closure-benchmark.md` with:

```markdown
# Generation Quality Closure Benchmark Gate

## Runs

- `<run_id>`: preset `<preset>`, samples `<n>`, variants `<n>`, result `<pass|warning|fail|blocked>`.

## Observations

- Prompt contract version observed: `character_prompt_contract_v1_1`.
- Failure taxonomy observed: `<category ids or none>`.
- Gallery evidence: Row GIF previews and debug reports were available for manual inspection.

## Follow-Up

- Keep prompt-only hardening separate from future repair/inpainting work.
```

If provider credentials are missing, record `blocked` with the exact command attempted and the missing environment variable name.

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: tests pass, whitespace check passes, and only intended docs or source changes are dirty.

- [ ] **Step 5: Commit verification note**

Run:

```bash
git status --short
git add docs/decisions/2026-05-31-generation-quality-closure-benchmark.md docs/runbooks/openrouter-character-benchmark.md
git commit -m "docs: record generation quality benchmark gate"
```

Expected: commit records the benchmark gate and any runbook adjustment.
