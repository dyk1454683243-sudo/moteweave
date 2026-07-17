# OpenRouter Real Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project three: a repeatable real-generation quality loop for OpenRouter character-pack output.

**Architecture:** Add a benchmark runner that can call the existing OpenRouter provider, route generated images through the existing character-pack pipeline, write per-item artifacts, and summarize pass/warning/fail quality metrics. Keep the runner injectable so tests use fixture images instead of live network calls.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing `processSheetBuffer`, existing OpenRouter provider, JSON and Markdown report files.

---

### Task 1: Live Benchmark Runner

**Files:**
- Create: `src/character-pack/benchmark/openRouterBenchmark.js`
- Test: `test/character-pack/openRouterBenchmark.test.js`

- [ ] **Step 1: Write failing tests**

Test expected behavior:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { runOpenRouterCharacterBenchmark } from '../../src/character-pack/benchmark/openRouterBenchmark.js'

test('runOpenRouterCharacterBenchmark writes JSON and Markdown reports from generated sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-benchmark-'))
  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const result = await runOpenRouterCharacterBenchmark({
    cases: [{ id: 'wizard', description: 'a blue robed wizard with a wooden staff' }],
    variantsPerCase: 1,
    outputDir: root,
    runId: 'openrouter_bench_test',
    generateSource: async () => ({
      buffer: fixture,
      provider: 'openrouter',
      model: 'mock/image',
      prompt: 'mock prompt',
      inputImages: { template: true, reference: false },
      templateName: 'motion_template_ocad_primary.png',
      referenceName: null,
    }),
  })

  assert.equal(result.run_id, 'openrouter_bench_test')
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.validation.pass, 1)
  assert.equal(result.items[0].generation.template_file, 'motion_template_ocad_primary.png')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/character-pack/openRouterBenchmark.test.js
```

Expected: FAIL because `openRouterBenchmark.js` does not exist.

- [ ] **Step 3: Implement runner**

Create `runOpenRouterCharacterBenchmark()` with dependency injection for `generateSource`, `processSheet`, `loadTemplate`, and optional Godot probe.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/character-pack/openRouterBenchmark.test.js
```

Expected: PASS.

### Task 2: CLI And Runbook

**Files:**
- Create: `scripts/benchmark-openrouter-character-pack.mjs`
- Modify: `package.json`
- Create: `docs/runbooks/openrouter-real-benchmark.md`
- Create: `docs/protocols/openrouter-benchmark-report.md`

- [ ] **Step 1: Add script entry**

Add:

```json
"benchmark:openrouter": "node scripts/benchmark-openrouter-character-pack.mjs"
```

- [ ] **Step 2: Add CLI**

The CLI must load `.env`, require an API key for live runs, accept `--sample-size`, `--variants`, `--yes`, and write `benchmark_report.json` plus `benchmark_report.md`.

- [ ] **Step 3: Document usage**

Document cheap smoke-like usage:

```bash
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --yes
```

Document full project-three gate:

```bash
npm run benchmark:openrouter -- --sample-size 20 --variants 1 --yes
```

### Task 3: Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run focused tests**

```bash
node --test test/character-pack/openRouterBenchmark.test.js
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

- [ ] **Step 3: Run one live benchmark sample if key is configured**

```bash
npm run benchmark:openrouter -- --sample-size 1 --variants 1 --yes
```

Expected: report is written. If provider or model fails, the report should preserve the failure as benchmark data instead of crashing before report output.
