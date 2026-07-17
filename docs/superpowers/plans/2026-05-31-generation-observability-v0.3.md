# Generation Observability v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0.3 generation observability block: structured prompt contracts, prompt metadata, and a local benchmark gallery for real generated character sheets.

**Architecture:** Add a focused prompt-contract module used by the existing provider, preserve contract metadata in generated artifacts, then add a local gallery index over existing benchmark artifact folders. Keep benchmark writing and gallery reading separated so tests can use temporary folders and no live model calls.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing local HTTP server, existing character-pack benchmark artifacts, browser JavaScript, CSS.

---

### Task 1: Prompt Contract Module

**Files:**
- Create: `src/character-pack/promptContracts.js`
- Test: `test/character-pack/promptContracts.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/character-pack/promptContracts.test.js` with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCharacterPromptContract,
  compileCharacterPromptContract,
  compileProviderPrompt,
  PROMPT_CONTRACT_VERSION,
} from '../../src/character-pack/promptContracts.js'

test('topdown prompt contract keeps the 8x8 layout protocol isolated', () => {
  const contract = buildCharacterPromptContract({ description: 'silver swordswoman', preset: 'topdown_rpg_v0' })
  const prompt = compileCharacterPromptContract(contract)

  assert.equal(contract.contract_version, PROMPT_CONTRACT_VERSION)
  assert.equal(contract.preset, 'topdown_rpg_v0')
  assert.equal(contract.layout_contract.kind, 'uniform_grid')
  assert.match(prompt, /exactly 8 columns by 8 rows/i)
  assert.match(prompt, /exactly 64 cells total/i)
  assert.match(prompt, /Rows: idle down\/up, idle left\/right/i)
  assert.doesNotMatch(prompt, /non-uniform fixed-region/i)
  assert.doesNotMatch(prompt, /idledown/i)
  assert.doesNotMatch(prompt, /attractL/i)
})

test('OCAD prompt contract keeps fixed-region source semantics isolated', () => {
  const contract = buildCharacterPromptContract({ description: 'green ranger', preset: 'ocad_motion_v0' })
  const prompt = compileCharacterPromptContract(contract)

  assert.equal(contract.preset, 'ocad_motion_v0')
  assert.equal(contract.layout_contract.kind, 'fixed_regions')
  assert.match(prompt, /252x252/i)
  assert.match(prompt, /non-uniform fixed-region/i)
  assert.match(prompt, /idledown/i)
  assert.match(prompt, /attractL/i)
  assert.match(prompt, /right-facing runtime frames are synthesized/i)
  assert.doesNotMatch(prompt, /exactly 8 columns by 8 rows/i)
})

test('provider prompt compilation adds image guidance without changing the base contract', () => {
  const contract = buildCharacterPromptContract({ description: 'blue wizard', preset: 'topdown_rpg_v0' })
  const prompt = compileProviderPrompt({
    contract,
    templateImage: { buffer: Buffer.from('template') },
    referenceImage: { buffer: Buffer.from('reference') },
    paletteImage: { buffer: Buffer.from('palette') },
  })

  assert.match(prompt, /strict structural 8x8 ControlNet-style template/i)
  assert.match(prompt, /weak appearance reference/i)
  assert.match(prompt, /palette\/style reference only/i)
  assert.equal(contract.subject, 'blue wizard')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/character-pack/promptContracts.test.js
```

Expected: FAIL because `src/character-pack/promptContracts.js` does not exist.

- [ ] **Step 3: Implement prompt contracts**

Create `src/character-pack/promptContracts.js` exporting:

```js
export const PROMPT_CONTRACT_SCHEMA_VERSION = 1
export const PROMPT_CONTRACT_VERSION = 'character_prompt_contract_v1'

export function buildCharacterPromptContract({ description = '', preset = 'topdown_rpg_v0' } = {}) {}
export function compileCharacterPromptContract(contract) {}
export function compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage } = {}) {}
export function summarizePromptContract(contract) {}
```

Implementation requirements:

- Default subject is `a readable fantasy pixel RPG character`.
- Unknown presets fall back to `topdown_rpg_v0` in the same way the current prompt builder does.
- Topdown `layout_contract.kind` is `uniform_grid`.
- OCAD `layout_contract.kind` is `fixed_regions`.
- Shared negative constraints forbid layout drift, props outside the character silhouette, scenery, text, labels, UI, borders, frame numbers, and watermarks.
- `summarizePromptContract()` returns only metadata safe for `generation.json`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/character-pack/promptContracts.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/character-pack/promptContracts.js test/character-pack/promptContracts.test.js
git commit -m "feat: add character prompt contracts"
```

Expected: commit includes only the prompt contract module and its tests.

### Task 2: Provider Integration And Generation Metadata

**Files:**
- Modify: `src/character-pack/providers/geminiProvider.js`
- Modify: `server.js`
- Modify: `src/character-pack/benchmark/openRouterBenchmark.js`
- Test: `test/character-pack/geminiProvider.test.js`
- Test: `test/serverOpenRouter.test.js`
- Test: `test/character-pack/openRouterBenchmark.test.js`

- [ ] **Step 1: Write failing provider metadata tests**

Extend `test/character-pack/geminiProvider.test.js` so `generateCharacterSource()` assertions include:

```js
assert.equal(result.promptContract.contract_version, 'character_prompt_contract_v1')
assert.equal(result.promptContract.preset, 'topdown_rpg_v0')
assert.equal(result.promptContract.layout_id, 'topdown_rpg_v0')
```

Extend the OCAD prompt test to assert:

```js
assert.doesNotMatch(prompt, /Rows: idle down\/up/)
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/character-pack/geminiProvider.test.js
```

Expected: FAIL because provider results do not return `promptContract`.

- [ ] **Step 3: Wire provider to prompt contracts**

In `src/character-pack/providers/geminiProvider.js`:

- Import `buildCharacterPromptContract`, `compileCharacterPromptContract`, `compileProviderPrompt`, and `summarizePromptContract`.
- Make `buildOpenRouterCharacterPrompt()` build and compile a contract.
- Replace local image guidance wording in `buildProviderPromptText()` with `compileProviderPrompt()`.
- Create the contract once in `generateCharacterSource()` and pass the compiled prompt to provider request builders.
- Add `promptContract: summarizePromptContract(contract)` to `generationResult()`.

- [ ] **Step 4: Persist metadata through server and benchmark**

In `server.js`, add this field to the `generation` object passed to `processSheetBuffer()`:

```js
prompt_contract: generated.promptContract,
```

In `src/character-pack/benchmark/openRouterBenchmark.js`, add the same field to each benchmark item generation object and the processing generation metadata:

```js
prompt_contract: generated.promptContract,
```

- [ ] **Step 5: Verify focused tests**

Run:

```bash
node --test test/character-pack/geminiProvider.test.js test/serverOpenRouter.test.js test/character-pack/openRouterBenchmark.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add src/character-pack/providers/geminiProvider.js server.js src/character-pack/benchmark/openRouterBenchmark.js test/character-pack/geminiProvider.test.js test/serverOpenRouter.test.js test/character-pack/openRouterBenchmark.test.js
git commit -m "feat: persist prompt contract metadata"
```

Expected: commit contains provider integration and tests only.

### Task 3: Local Benchmark Gallery Backend

**Files:**
- Create: `src/character-pack/benchmark/benchmarkGallery.js`
- Modify: `server.js`
- Test: `test/character-pack/benchmarkGallery.test.js`
- Test: `test/serverOpenRouter.test.js`

- [ ] **Step 1: Write failing gallery tests**

Create `test/character-pack/benchmarkGallery.test.js` with a temporary `generated/openrouter-benchmarks` fixture. The test should write one `benchmark_report.json` and assert:

```js
assert.equal(gallery.runs.length, 1)
assert.equal(gallery.runs[0].run_id, 'openrouter_bench_test')
assert.equal(gallery.runs[0].items[0].source_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/source.png')
assert.equal(gallery.runs[0].items[0].prompt_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/prompt.txt')
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/character-pack/benchmarkGallery.test.js
```

Expected: FAIL because `benchmarkGallery.js` does not exist.

- [ ] **Step 3: Implement gallery indexer**

Create `buildBenchmarkGallery({ generatedDir })` that:

- Reads only `openrouter-benchmarks` under the provided generated root.
- Ignores missing roots by returning `{ runs: [] }`.
- Reads each run's `benchmark_report.json`.
- Sorts runs newest first by `created_at`.
- Maps item artifacts to local URLs without checking every file on disk.
- Preserves `row_gif_previews` from item artifacts when available.
- Includes compact fields: `run_id`, `created_at`, `preset`, `template_file`, `image_config`, `summary`, `items`.

- [ ] **Step 4: Add server endpoint**

In `server.js`, add:

```js
if (req.method === 'GET' && url.pathname === '/api/benchmark-gallery') {
  return sendJson(res, 200, await buildBenchmarkGallery({ generatedDir }))
}
```

Import `buildBenchmarkGallery`.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
node --test test/character-pack/benchmarkGallery.test.js test/serverOpenRouter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add src/character-pack/benchmark/benchmarkGallery.js server.js test/character-pack/benchmarkGallery.test.js test/serverOpenRouter.test.js
git commit -m "feat: add local benchmark gallery api"
```

Expected: commit contains gallery backend and tests only.

### Task 4: Local Benchmark Gallery UI

**Files:**
- Modify: `index.html`
- Modify: `src/ui/appState.js`
- Modify: `src/ui/characterPack/api.js`
- Modify: `src/ui/characterPack/renderers.js`
- Modify: `src/ui/characterPackTab.js`
- Modify: `src/styles.css`
- Test: `test/localSmokeScript.test.js`

- [ ] **Step 1: Add API helper**

In `src/ui/characterPack/api.js`, add:

```js
export async function fetchBenchmarkGallery() {
  const response = await fetch('/api/benchmark-gallery')
  if (!response.ok) throw new Error(`benchmark gallery failed: ${response.status}`)
  return response.json()
}
```

- [ ] **Step 2: Add state fields**

In `src/ui/appState.js`, add:

```js
benchmarkGallery: {
  runs: [],
  selectedRunId: null,
},
```

inside `characterPack`.

- [ ] **Step 3: Add markup**

In `index.html`, add a compact gallery panel below `character-pack-links`:

```html
<section class="benchmark-gallery-panel" aria-label="本地 benchmark gallery">
  <div class="panel-title compact-title">
    <h3>Benchmark Gallery</h3>
    <button id="character-pack-refresh-gallery" type="button" class="secondary">刷新</button>
  </div>
  <div id="character-pack-benchmark-gallery" class="benchmark-gallery-list">暂无 benchmark 记录。</div>
</section>
```

- [ ] **Step 4: Add renderer**

In `src/ui/characterPack/renderers.js`, add `renderBenchmarkGallery(gallery)` that:

- Shows run summary badges.
- Shows each item status, validation status, source image, normalized sheet image, prompt/debug links, and Row GIF thumbnails when present.
- Does not use in-app explanatory text about how the feature works.

- [ ] **Step 5: Wire refresh behavior**

In `src/ui/characterPackTab.js`:

- Import `fetchBenchmarkGallery`.
- Import `renderBenchmarkGallery`.
- Add `refreshBenchmarkGallery()` called during init and after job render.
- Add click handler for `#character-pack-refresh-gallery`.

- [ ] **Step 6: Style gallery**

In `src/styles.css`, add responsive styles for:

```text
.benchmark-gallery-panel
.benchmark-gallery-list
.benchmark-run-card
.benchmark-item-grid
.benchmark-item-card
```

Keep cards at `8px` radius or less.

- [ ] **Step 7: Verify smoke test**

Run:

```bash
node --test test/localSmokeScript.test.js
```

Expected: PASS after updating the smoke fixture if it checks for expected DOM ids.

- [ ] **Step 8: Commit**

Run:

```bash
git status --short
git add index.html src/ui/appState.js src/ui/characterPack/api.js src/ui/characterPack/renderers.js src/ui/characterPackTab.js src/styles.css test/localSmokeScript.test.js
git commit -m "feat: show local benchmark gallery"
```

Expected: commit contains UI only.

### Task 5: Protocol Docs And Final Verification

**Files:**
- Create: `docs/protocols/prompt-contracts.md`
- Modify: `docs/protocols/openrouter-benchmark-report.md`
- Modify: `docs/runbooks/openrouter-real-benchmark.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`

- [ ] **Step 1: Document prompt contracts**

Create `docs/protocols/prompt-contracts.md` with:

```markdown
# Prompt Contracts Protocol

Prompt contracts separate production layout requirements from provider-specific wording.

## Contract Metadata

schema_version, contract_version, preset, layout_id, validation_expectations

## Supported Layouts

topdown_rpg_v0 uses uniform_grid and exactly 8 columns by 8 rows.
ocad_motion_v0 uses fixed_regions and preserves original source action names.

## Artifact Locations

generation.json.prompt_contract
metadata.json.generation.prompt_contract
benchmark_report.json.items[].generation.prompt_contract
```

- [ ] **Step 2: Update benchmark protocol**

In `docs/protocols/openrouter-benchmark-report.md`, add `generation.prompt_contract` to item fields and describe `/api/benchmark-gallery`.

- [ ] **Step 3: Update runbook**

In `docs/runbooks/openrouter-real-benchmark.md`, add a gallery inspection step:

```bash
npm start
open http://localhost:4173/
```

Then inspect the Character Pack benchmark gallery panel for Row GIFs and failure modes.

- [ ] **Step 4: Update roadmap status**

In `docs/roadmap/technology-reference-roadmap.md`, note that prompt contracts and local benchmark gallery have entered implementation under v0.3.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
git diff --check
```

Expected: `npm test` exits 0 and `git diff --check` exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add docs/protocols/prompt-contracts.md docs/protocols/openrouter-benchmark-report.md docs/runbooks/openrouter-real-benchmark.md docs/roadmap/technology-reference-roadmap.md
git commit -m "docs: document generation observability workflow"
```

Expected: commit contains docs only.

### Final Completion Audit

- [ ] Re-read `docs/superpowers/specs/2026-05-31-generation-observability-v0.3-design.md`.
- [ ] Confirm every acceptance criterion maps to code, tests, docs, or UI.
- [ ] Run `npm test`.
- [ ] Run `git status --short`.
- [ ] Report commits and verification evidence.
