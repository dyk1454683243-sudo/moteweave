# Motion Source Productization Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented on main. The original core/CLI evidence scope landed as
`feat: add motion source set apply evidence`; the follow-up API/UI entry landed
as `feat: wire motion source set apply api ui`.

**Goal:** Turn the existing Motion Source Phase A pieces into a guarded multi-strip apply and evidence route that can assemble reviewed action strips into one character sheet without claiming AI video or full motion planning.

**Architecture:** Keep the feature provider-free and deterministic. Add a pure
`src/motion-source/sourceSetApplier.js` core that validates a
`motion_source_set_v1` manifest, runs the existing identity gate, applies each
reviewed strip through the existing single-action applier, and writes explicit
review evidence. CLI/runbook coverage landed first; browser and server entry
were added after the core evidence contract was stable.

**Tech Stack:** Node.js ESM, `node:test`, existing `src/motion-source/*` modules, existing character-pack image helpers, `scripts/character-pack-cli.mjs`, Markdown runbooks and roadmap docs.

---

## Current Baseline

Already implemented:

- `motion_source_contract_v1`
- source analysis for GIF/ZIP/single-image/video-file metadata
- deterministic frame selection
- single-action strip builder
- single-action strip applier
- `motion_source_set_v1` validation
- identity consistency gate
- CLI/API/UI entries for analyze, build-strip, apply-strip, and analyze-set
- guarded apply-set core, CLI, API, and browser UI entry
- encoded GIF/ZIP e2e regression

The productization gap identified by this plan is now closed for provider-free
reviewed local strips: `apply-set` can turn identity-consistent strips into a
combined character sheet and an auditable
`motion_source_set_apply_report_v1`.

## Scope

In scope:

- pure source-set apply core;
- CLI command `motion-source apply-set`;
- local API endpoint `POST /api/apply-motion-source-set`;
- browser `Motion Source` tab `Apply Set` action;
- deterministic report artifacts;
- docs/protocol status alignment;
- runbook evidence using synthetic local PNG strips;
- full test coverage with provider-free fixtures.

Out of scope:

- provider or AI video calls;
- arbitrary new browser workflows beyond the guarded `Apply Set` action;
- arbitrary new server endpoints beyond `POST /api/apply-motion-source-set`;
- automatic semantic judgment for arbitrary actions;
- blending or interpolating pixel-art frames;
- bundling editor, FFmpeg, or third-party binaries.

## File Structure

- Create `src/motion-source/sourceSetApplier.js`
  - Pure core. Inputs are a base normalized sheet, a manifest object, and already-loaded strip images keyed by action/source id. It performs validation, identity gating, sequential apply, and report construction.
- Create `test/motion-source/sourceSetApplier.test.js`
  - Focused unit tests for success, identity failure, missing strip, and per-action apply failure.
- Modify `scripts/character-pack-cli.mjs`
  - Add `motion-source apply-set`.
  - Add repeated `--strip action=path` parsing through existing `optionList()`.
  - Write `applied_normalized_sheet.png`, `motion_source_set_apply_report.json`, `motion_source_set_report.json`, and `identity_consistency_report.json`.
- Modify `test/character-pack/cli.test.js`
  - Add a CLI regression for repeated `--strip` specs and report files.
- Modify `docs/protocols/motion-source-pipeline.md`
  - Change Multi-Action Source Set from planned extension to implemented guarded core plus apply-set productization.
  - Add `motion_source_set_apply_report_v1`.
- Create `docs/runbooks/motion-source-productization-evidence.md`
  - Record local review commands, expected artifacts, and claim boundaries.
- Modify `docs/roadmap/technology-reference-roadmap.md`
  - Record that guarded multi-strip apply is the next Motion Source productization evidence layer.
- Modify `docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md`
  - Add a ledger row for guarded source-set apply.

## Report Contract

`motion_source_set_apply_report_v1` must be JSON-safe:

```json
{
  "schema_version": 1,
  "mode": "motion_source_set_apply_report_v1",
  "status": "done",
  "source_set_status": "pass",
  "identity_status": "pass",
  "can_apply_multi_strip": true,
  "profile_id": "topdown_rpg_v0",
  "applied_actions": [
    {
      "runtime_action": "idle_down",
      "source_id": "idle_down",
      "status": "done",
      "source_strip_frame_count": 4,
      "target_frame_count": 4,
      "resample_strategy": "exact"
    }
  ],
  "skipped_actions": [],
  "warnings": [],
  "blocking_errors": [],
  "validation": {
    "status": "pass",
    "blocking_errors": [],
    "warnings": []
  }
}
```

Failure must be explicit:

- source-set validation failure: `status: "fail"`, `can_apply_multi_strip: false`;
- identity gate failure: `status: "fail"`, `blocking_errors` include `identity_mismatch:<action>`;
- missing strip: `blocking_errors` include `missing_motion_strip:<source_id>`;
- single-action apply failure: `blocking_errors` include `apply_motion_strip_failed:<action>:<reason>`.

### Task 0: Align Protocol And Roadmap Status

**Files:**
- Modify: `docs/protocols/motion-source-pipeline.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`
- Modify: `docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md`

- [ ] **Step 1: Update protocol status**

In `docs/protocols/motion-source-pipeline.md`, replace this sentence:

```markdown
**Status:** Planned extension. This section is a product/technical contract for the next implementation batch; it is not an implemented runtime capability yet.
```

With:

```markdown
**Status:** Guarded validation and guarded set apply are implemented for CLI,
local API, and browser UI. AI video generation and arbitrary full-motion
planning remain deferred.
```

Add a new subsection after the identity gate paragraph:

```markdown
### Guarded Set Apply

`motion_source_set_apply_report_v1` records whether reviewed strips were applied
to one normalized character sheet. The operation must run source-set validation
and identity consistency before applying any strip. If either gate fails, no
strip is applied and the report status is `fail`.

The first public command is provider-free:

```bash
npm run character-pack -- motion-source apply-set \
  --sheet normalized_sheet.png \
  --manifest motion_source_set.json \
  --strip idle_down=idle_down_strip.png \
  --strip walk_down=walk_down_strip.png
```

Each `--strip` value maps a source id or runtime action to a reviewed
`normalized_motion_strip.png`. Missing mappings are blocking errors. The command
writes `applied_normalized_sheet.png`,
`motion_source_set_apply_report.json`,
`motion_source_set_report.json`, and `identity_consistency_report.json`.
```

- [ ] **Step 2: Update roadmap note**

In `docs/roadmap/technology-reference-roadmap.md`, append this sentence to the Motion Source paragraph near the existing encoded GIF/ZIP regression note:

```markdown
The next Motion Source productization evidence layer is guarded multi-strip
apply: reuse `motion_source_set_v1` plus the identity gate to assemble reviewed
single-action strips into one normalized sheet, with an explicit set-apply
report and no provider or AI-video dependency.
```

- [ ] **Step 3: Update implementation ledger**

In `docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md`, add this row to the Implementation Ledger:

```markdown
| Guarded source-set apply | Planned in `2026-06-23-motion-source-productization-evidence` | `src/motion-source/sourceSetApplier.js`, `motion_source_set_apply_report_v1` | Applies reviewed identity-consistent strips into one sheet; still not AI video generation or arbitrary full-motion planning. |
```

- [ ] **Step 4: Verify docs**

Run:

```bash
git diff --check -- docs/protocols/motion-source-pipeline.md docs/roadmap/technology-reference-roadmap.md docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md
```

Expected: no output.

### Task 1: Add Source-Set Apply Core

**Files:**
- Create: `src/motion-source/sourceSetApplier.js`
- Create: `test/motion-source/sourceSetApplier.test.js`

- [ ] **Step 1: Write the failing core tests**

Create `test/motion-source/sourceSetApplier.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { applyMotionSourceSet } from '../../src/motion-source/sourceSetApplier.js'

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeSheet() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 40, y: 40, w: 16, h: 49 }, [60, 60, 60, 255])
  for (let frameIndex = 0; frameIndex < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frameIndex += 1) {
    const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
    const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
        sheet.data[dst] = cell.data[src]
        sheet.data[dst + 1] = cell.data[src + 1]
        sheet.data[dst + 2] = cell.data[src + 2]
        sheet.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return sheet
}

function makeStrip({ color = [120, 80, 160, 255], frameCount = 4, y = 42, facingDirection = 'down' } = {}) {
  const strip = blankImage(TOPDOWN_RPG_V0.frame.w * frameCount, TOPDOWN_RPG_V0.frame.h)
  for (let index = 0; index < frameCount; index += 1) {
    const dx = index % 2 ? 2 : -2
    paintRect(strip, { x: index * TOPDOWN_RPG_V0.frame.w + 39 + dx, y, w: 18, h: 46 }, color)
    paintRect(strip, { x: index * TOPDOWN_RPG_V0.frame.w + 43 - dx, y: y + 43, w: 4, h: 3 }, color)
  }
  return {
    id: 'strip',
    runtime_action: 'strip',
    image: strip,
    facing_direction: facingDirection,
  }
}

function manifest() {
  return {
    contract_version: 'motion_source_set_v1',
    identity_anchor: { source_id: 'idle_down', facing_direction: 'down' },
    background: { source_requirement: 'flat_solid_key_color', key_color: [255, 255, 255] },
    sources: [
      { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 4, facing_direction: 'down' },
      { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 4, facing_direction: 'down' },
    ],
  }
}

test('applies identity-passing strips in manifest order', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip({ color: [120, 80, 160, 255] }), id: 'idle_down', runtime_action: 'idle_down' },
      { ...makeStrip({ color: [124, 82, 158, 255] }), id: 'walk_down', runtime_action: 'walk_down' },
    ],
  })

  assert.equal(result.report.status, 'done')
  assert.equal(result.report.can_apply_multi_strip, true)
  assert.deepEqual(result.report.blocking_errors, [])
  assert.deepEqual(result.report.applied_actions.map((item) => item.runtime_action), ['idle_down', 'walk_down'])
  assert.equal(result.appliedSheet.width, TOPDOWN_RPG_V0.sheet.w)
  assert.equal(result.appliedSheet.height, TOPDOWN_RPG_V0.sheet.h)
})

test('does not apply when identity consistency fails', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip({ color: [120, 80, 160, 255] }), id: 'idle_down', runtime_action: 'idle_down' },
      { ...makeStrip({ color: [20, 220, 40, 255] }), id: 'walk_down', runtime_action: 'walk_down' },
    ],
    identityThresholds: { max_palette_delta: 24 },
  })

  assert.equal(result.report.status, 'fail')
  assert.equal(result.report.can_apply_multi_strip, false)
  assert.ok(result.report.blocking_errors.includes('identity_mismatch:walk_down'))
  assert.deepEqual(result.report.applied_actions, [])
})

test('reports missing strips by source id before applying anything', async () => {
  const result = await applyMotionSourceSet({
    sheet: makeSheet(),
    manifest: manifest(),
    strips: [
      { ...makeStrip(), id: 'idle_down', runtime_action: 'idle_down' },
    ],
  })

  assert.equal(result.report.status, 'fail')
  assert.ok(result.report.blocking_errors.includes('missing_motion_strip:walk_down'))
  assert.deepEqual(result.report.applied_actions, [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/motion-source/sourceSetApplier.test.js
```

Expected: FAIL with `Cannot find module` or missing export for `sourceSetApplier.js`.

- [ ] **Step 3: Implement the core**

Create `src/motion-source/sourceSetApplier.js`:

```js
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { validateNormalizedFrames } from '../character-pack/validator.js'
import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { pixelOffset } from '../character-pack/imageMath.js'
import { detectAlphaBBox } from '../character-pack/normalizer.js'
import { validateMotionSourceSetManifest } from './sourceSet.js'
import { evaluateIdentityConsistency } from './identityConsistencyGate.js'
import { applyMotionStrip } from './stripApplier.js'

function stripKey(strip) {
  return [strip.id, strip.runtime_action].filter(Boolean).map(String)
}

function indexStrips(strips = []) {
  const map = new Map()
  for (const strip of strips) {
    for (const key of stripKey(strip)) map.set(key, strip)
  }
  return map
}

function cellRegionForFrame(frameIndex, profile) {
  const col = frameIndex % profile.grid.columns
  const row = Math.floor(frameIndex / profile.grid.columns)
  return {
    x: col * profile.frame.w,
    y: row * profile.frame.h,
    w: profile.frame.w,
    h: profile.frame.h,
    row,
    col,
  }
}

function copySheetCell(sheet, frameIndex, profile) {
  const region = cellRegionForFrame(frameIndex, profile)
  const image = {
    width: profile.frame.w,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4),
  }
  for (let y = 0; y < profile.frame.h; y += 1) {
    for (let x = 0; x < profile.frame.w; x += 1) {
      const src = pixelOffset(sheet.width, region.x + x, region.y + y)
      const dst = pixelOffset(image.width, x, y)
      image.data[dst] = sheet.data[src]
      image.data[dst + 1] = sheet.data[src + 1]
      image.data[dst + 2] = sheet.data[src + 2]
      image.data[dst + 3] = sheet.data[src + 3]
    }
  }
  return image
}

function framesFromSheet(sheet, profile) {
  const frameCount = profile.grid.columns * profile.grid.rows
  return Array.from({ length: frameCount }, (_, index) => {
    const image = copySheetCell(sheet, index, profile)
    const bbox = detectAlphaBBox(image)
    return {
      index,
      image,
      normalized_bbox: bbox,
      normalized_anchor: bbox ? { ...profile.anchor } : null,
      source_anchor: null,
      source_bbox: bbox,
      warnings: bbox ? [] : ['empty_frame'],
    }
  })
}

function failReport({ setReport, identityReport, blockingErrors, warnings = [], profile }) {
  return {
    schema_version: 1,
    mode: 'motion_source_set_apply_report_v1',
    status: 'fail',
    source_set_status: setReport?.status ?? 'fail',
    identity_status: identityReport?.status ?? 'skipped',
    can_apply_multi_strip: false,
    profile_id: profile.id,
    applied_actions: [],
    skipped_actions: [],
    warnings: [...new Set([...(setReport?.warnings ?? []), ...(identityReport?.warnings ?? []), ...warnings])],
    blocking_errors: [...new Set([...(setReport?.blocking_errors ?? []), ...(identityReport?.blocking_errors ?? []), ...blockingErrors])],
    validation: { status: 'not_run', blocking_errors: [], warnings: [] },
  }
}

export async function applyMotionSourceSet({
  sheet,
  manifest,
  strips = [],
  profile = TOPDOWN_RPG_V0,
  resampleStrategy = 'reject_mismatch',
  identityThresholds,
} = {}) {
  const setReport = validateMotionSourceSetManifest(manifest)
  if (!setReport.normalized_manifest) {
    return { appliedSheet: sheet, appliedNormalizedSheetPng: null, setReport, identityReport: null, report: failReport({ setReport, blockingErrors: [], profile }) }
  }

  const normalized = setReport.normalized_manifest
  const stripMap = indexStrips(strips)
  const orderedStrips = []
  const missing = []
  for (const source of normalized.sources) {
    const strip = stripMap.get(source.id) ?? stripMap.get(source.runtime_action)
    if (!strip) missing.push(`missing_motion_strip:${source.id}`)
    else orderedStrips.push({ ...strip, id: source.id, runtime_action: source.runtime_action, facing_direction: source.facing_direction ?? strip.facing_direction })
  }
  if (missing.length) {
    return { appliedSheet: sheet, appliedNormalizedSheetPng: null, setReport, identityReport: null, report: failReport({ setReport, blockingErrors: missing, profile }) }
  }

  const anchorSource = normalized.sources.find((source) => source.id === normalized.identity_anchor.source_id || source.runtime_action === normalized.identity_anchor.source_id)
  const identityReport = evaluateIdentityConsistency(orderedStrips, {
    identityAnchor: {
      ...normalized.identity_anchor,
      facing_direction: normalized.identity_anchor.facing_direction ?? anchorSource?.facing_direction,
    },
    thresholds: identityThresholds ?? manifest.identity_thresholds,
  })
  if (identityReport.status === 'fail') {
    return { appliedSheet: sheet, appliedNormalizedSheetPng: null, setReport, identityReport, report: failReport({ setReport, identityReport, blockingErrors: [], profile }) }
  }

  let currentSheet = sheet
  const appliedActions = []
  for (const source of normalized.sources) {
    const strip = stripMap.get(source.id) ?? stripMap.get(source.runtime_action)
    try {
      const applied = await applyMotionStrip({
        sheet: currentSheet,
        strip: strip.image ?? strip.strip ?? strip,
        action: source.runtime_action,
        profile,
        resampleStrategy,
      })
      currentSheet = applied.appliedSheet
      appliedActions.push({
        runtime_action: source.runtime_action,
        source_id: source.id,
        status: applied.report.status,
        source_strip_frame_count: applied.report.source_strip_frame_count,
        target_frame_count: applied.report.target_frame_count,
        resample_strategy: applied.report.resample_strategy,
      })
    } catch (error) {
      return {
        appliedSheet: sheet,
        appliedNormalizedSheetPng: null,
        setReport,
        identityReport,
        report: failReport({
          setReport,
          identityReport,
          blockingErrors: [`apply_motion_strip_failed:${source.runtime_action}:${error.message || String(error)}`],
          profile,
        }),
      }
    }
  }

  const frames = framesFromSheet(currentSheet, profile)
  const validation = validateNormalizedFrames(frames, profile)
  const report = {
    schema_version: 1,
    mode: 'motion_source_set_apply_report_v1',
    status: validation.blocking_errors.length ? 'warning' : 'done',
    source_set_status: setReport.status,
    identity_status: identityReport.status,
    can_apply_multi_strip: identityReport.can_apply_multi_strip,
    profile_id: profile.id,
    applied_actions: appliedActions,
    skipped_actions: [],
    warnings: [...new Set([...(setReport.warnings ?? []), ...(identityReport.warnings ?? []), ...(validation.warnings ?? [])])],
    blocking_errors: validation.blocking_errors,
    validation: {
      status: validation.status,
      blocking_errors: validation.blocking_errors,
      warnings: validation.warnings,
    },
  }

  return {
    appliedSheet: currentSheet,
    appliedNormalizedSheetPng: await encodeRgbaPng(currentSheet),
    setReport,
    identityReport,
    report,
  }
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
node --test test/motion-source/sourceSetApplier.test.js
```

Expected: PASS.

- [ ] **Step 5: Run related tests**

Run:

```bash
node --test test/motion-source/sourceSet.test.js test/motion-source/identityConsistencyGate.test.js test/motion-source/stripApplier.test.js test/motion-source/sourceSetApplier.test.js
```

Expected: PASS.

### Task 2: Add CLI `motion-source apply-set`

**Files:**
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`

- [ ] **Step 1: Write the failing CLI test**

In `test/character-pack/cli.test.js`, add a test near the existing motion-source CLI tests:

```js
test('character pack CLI motion-source apply-set writes guarded multi-strip artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-set-'))
  const outputDir = path.join(root, 'out')
  const sheetPath = path.join(root, 'normalized_sheet.png')
  const idleStripPath = path.join(root, 'idle_down.png')
  const walkStripPath = path.join(root, 'walk_down.png')
  const manifestPath = path.join(root, 'motion_source_set.json')

  await writeFile(sheetPath, await makeFullSheetPng())
  await writeFile(idleStripPath, await makeMotionApplyStripPng(4, [120, 80, 160, 255]))
  await writeFile(walkStripPath, await makeMotionApplyStripPng(4, [124, 82, 158, 255]))
  await writeFile(manifestPath, JSON.stringify({
    contract_version: 'motion_source_set_v1',
    identity_anchor: { source_id: 'idle_down', facing_direction: 'down' },
    background: { source_requirement: 'flat_solid_key_color', key_color: [255, 255, 255] },
    sources: [
      { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 4, facing_direction: 'down' },
      { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 4, facing_direction: 'down' },
    ],
  }, null, 2))

  const result = await runCli([
    'motion-source',
    'apply-set',
    '--sheet',
    sheetPath,
    '--manifest',
    manifestPath,
    '--strip',
    `idle_down=${idleStripPath}`,
    '--strip',
    `walk_down=${walkStripPath}`,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_set_apply',
  ])

  const jobDir = path.join(outputDir, 'motion_set_apply')
  const report = JSON.parse(await readFile(path.join(jobDir, 'motion_source_set_apply_report.json'), 'utf8'))

  assert.equal(result.command, 'motion-source apply-set')
  assert.equal(result.status, 'done')
  assert.equal(result.can_apply_multi_strip, true)
  assert.equal(report.mode, 'motion_source_set_apply_report_v1')
  assert.deepEqual(report.applied_actions.map((item) => item.runtime_action), ['idle_down', 'walk_down'])
  assert.equal(await exists(path.join(jobDir, 'applied_normalized_sheet.png')), true)
  assert.equal(await exists(path.join(jobDir, 'motion_source_set_report.json')), true)
  assert.equal(await exists(path.join(jobDir, 'identity_consistency_report.json')), true)
})
```

If `makeMotionApplyStripPng` currently accepts only one argument, extend that helper in the same test file so the second color argument defaults to the existing color.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/character-pack/cli.test.js
```

Expected: FAIL because `motion-source apply-set` is not routed.

- [ ] **Step 3: Implement strip spec parsing**

In `scripts/character-pack-cli.mjs`, import the new core:

```js
import { applyMotionSourceSet } from '../src/motion-source/sourceSetApplier.js'
```

Add this helper near `resolveManifestAssetPath`:

```js
function parseStripSpecs(specs) {
  return specs.map((spec) => {
    const text = String(spec)
    const separator = text.indexOf('=')
    if (separator <= 0 || separator === text.length - 1) {
      throw new Error('--strip must use source_id_or_action=path')
    }
    return {
      id: text.slice(0, separator).trim(),
      path: text.slice(separator + 1).trim(),
    }
  })
}
```

- [ ] **Step 4: Implement CLI command**

Add `commandMotionSourceApplySet(options)` near `commandMotionSourceAnalyzeSet`:

```js
async function commandMotionSourceApplySet(options) {
  const sheetPath = option(options, 'sheet')
  const manifestPath = option(options, 'manifest')
  if (!sheetPath) throw new Error('motion-source apply-set requires --sheet')
  if (!manifestPath) throw new Error('motion-source apply-set requires --manifest')
  const stripSpecs = parseStripSpecs(optionList(options, 'strip'))
  if (!stripSpecs.length) throw new Error('motion-source apply-set requires at least one --strip action=path')

  const outputDir = option(options, 'output-dir', 'generated/cli')
  const jobId = option(options, 'job-id', makeJobId('motion_source_set_apply'))
  const manifest = JSON.parse(await readFile(String(manifestPath), 'utf8'))
  const sheet = await loadRgba(await readFile(String(sheetPath)))
  const strips = await Promise.all(stripSpecs.map(async (spec) => ({
    id: spec.id,
    runtime_action: spec.id,
    image: await loadRgba(await readFile(spec.path)),
  })))
  const result = await applyMotionSourceSet({
    sheet,
    manifest,
    strips,
    resampleStrategy: option(options, 'resample-strategy', 'reject_mismatch'),
    identityThresholds: manifest.identity_thresholds,
  })

  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  if (result.appliedNormalizedSheetPng) {
    await writeFile(path.join(jobDir, 'applied_normalized_sheet.png'), result.appliedNormalizedSheetPng)
  }
  await writeFile(path.join(jobDir, 'motion_source_set_apply_report.json'), JSON.stringify(result.report, null, 2))
  await writeFile(path.join(jobDir, 'motion_source_set_report.json'), JSON.stringify(result.setReport, null, 2))
  await writeFile(path.join(jobDir, 'identity_consistency_report.json'), JSON.stringify(result.identityReport ?? {
    schema_version: 1,
    mode: 'identity_consistency_report_v1',
    status: 'skipped',
    can_apply_multi_strip: false,
    warnings: ['identity_gate_not_run'],
    blocking_errors: result.report.blocking_errors,
  }, null, 2))

  return {
    command: 'motion-source apply-set',
    job_id: jobId,
    output_dir: jobDir,
    status: result.report.status,
    can_apply_multi_strip: result.report.can_apply_multi_strip,
    applied_actions: result.report.applied_actions,
    warnings: result.report.warnings,
    blocking_errors: result.report.blocking_errors,
    urls: {
      applied_normalized_sheet_url: result.appliedNormalizedSheetPng ? `/generated/${jobId}/applied_normalized_sheet.png` : null,
      motion_source_set_apply_report_url: `/generated/${jobId}/motion_source_set_apply_report.json`,
      motion_source_set_report_url: `/generated/${jobId}/motion_source_set_report.json`,
      identity_consistency_report_url: `/generated/${jobId}/identity_consistency_report.json`,
    },
  }
}
```

Route it in `main()`:

```js
if (command === 'motion-source' && positional[1] === 'apply-set') return commandMotionSourceApplySet(options)
```

Update the usage string to include `motion-source apply-set`.

- [ ] **Step 5: Run CLI test**

Run:

```bash
node --test test/character-pack/cli.test.js
```

Expected: PASS.

### Task 3: Add Productization Evidence Runbook

**Files:**
- Create: `docs/runbooks/motion-source-productization-evidence.md`
- Modify: `docs/protocols/motion-source-pipeline.md`

- [ ] **Step 1: Create runbook**

Create `docs/runbooks/motion-source-productization-evidence.md`:

```markdown
# Motion Source Productization Evidence

**Status:** Current guarded provider-free multi-strip apply review.

Use this runbook after `motion-source build-strip` has produced reviewed
`normalized_motion_strip.png` files for two or more actions belonging to the
same character identity.

## Claim Boundary

This route proves local deterministic set assembly only. It does not call a
provider, generate AI video, judge semantic action quality automatically, or
claim arbitrary full-action-library readiness.

## Required Inputs

- `normalized_sheet.png` from an existing character pack;
- `motion_source_set_v1` manifest;
- one reviewed `normalized_motion_strip.png` per source id or runtime action;
- source-set identity gate configured through the manifest.

## Command

```bash
npm run character-pack -- motion-source apply-set \
  --sheet <normalized_sheet.png> \
  --manifest <motion_source_set.json> \
  --strip idle_down=<idle_strip.png> \
  --strip walk_down=<walk_strip.png> \
  --output-dir generated/cli \
  --job-id motion_source_set_apply_review
```

## Expected Artifacts

- `applied_normalized_sheet.png`
- `motion_source_set_apply_report.json`
- `motion_source_set_report.json`
- `identity_consistency_report.json`

## Review Checklist

- `motion_source_set_apply_report.json.status` is `done` or explicitly explains
  why it is `fail`.
- `can_apply_multi_strip` is true before any strip application is accepted.
- `applied_actions` lists every intended runtime action in manifest order.
- `blocking_errors` is empty for release evidence.
- The final sheet still passes existing character-pack validation.
- The reviewer inspects the applied sheet and generated Row GIFs before making
  quality claims.
```

- [ ] **Step 2: Link runbook from protocol**

In `docs/protocols/motion-source-pipeline.md`, add this sentence under `Export And Preview`:

```markdown
For guarded multi-strip review, use
`docs/runbooks/motion-source-productization-evidence.md` and cite the generated
`motion_source_set_apply_report.json`.
```

- [ ] **Step 3: Verify docs**

Run:

```bash
git diff --check -- docs/runbooks/motion-source-productization-evidence.md docs/protocols/motion-source-pipeline.md
```

Expected: no output.

### Task 4: Final Verification And Commit

**Files:**
- All files touched by Tasks 0-3.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test test/motion-source/sourceSet.test.js test/motion-source/identityConsistencyGate.test.js test/motion-source/stripApplier.test.js test/motion-source/sourceSetApplier.test.js test/character-pack/cli.test.js
```

Expected: PASS.

- [ ] **Step 2: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass. Report the exact pass/fail count.

- [ ] **Step 4: Inspect status**

Run:

```bash
git status --short
```

Expected: only files from this plan are modified or added.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/protocols/motion-source-pipeline.md docs/roadmap/technology-reference-roadmap.md docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md docs/runbooks/motion-source-productization-evidence.md src/motion-source/sourceSetApplier.js test/motion-source/sourceSetApplier.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js
git commit -m "feat: add motion source set apply evidence"
```

## Self-Review

- Spec coverage: The plan covers protocol alignment, core set apply, CLI access, evidence artifacts, runbook review, focused tests, full test suite, and commit.
- Placeholder scan: No task uses unspecified files or open-ended implementation directions.
- Type consistency: The core, CLI, protocol, and report contract all use `motion_source_set_apply_report_v1`, `applyMotionSourceSet`, `can_apply_multi_strip`, `applied_actions`, `warnings`, and `blocking_errors`.
