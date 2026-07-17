# Export Interoperability And CLI v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editor-friendly metadata and stable CLI entry points so character packs can be edited and automated outside the web UI.

**Architecture:** Keep export metadata generation inside the existing package builder, route all artifact writing through a shared manifest writer, and add a single CLI script with process/generate/benchmark subcommands. Use neutral code identifiers while documenting compatibility in protocols and attribution notes.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSZip, Sharp, existing character-pack processor/provider/benchmark modules, filesystem-based local artifacts.

---

### Task 1: Editor Metadata Builder

**Files:**
- Modify: `src/character-pack/packageBuilder.js`
- Modify: `test/character-pack/packageBuilder.test.js`

- [ ] **Step 1: Write failing metadata builder tests**

Add tests that import `buildEditorMetadataJson` and assert:

```js
const metadata = buildEditorMetadataJson({
  metadata: { id: 'pack' },
  animationsJson: buildAnimationsJson(TOPDOWN_RPG_V0),
  frames: [
    {
      index: 16,
      normalized_bbox: { x: 42, y: 40, w: 13, h: 49, right: 54, bottom: 88, centerX: 48.5, centerY: 64.5 },
      normalized_anchor: { x: 48, y: 88 },
      source_anchor: { x: 8, y: 12 },
      source_meta: { source_layout: 'topdown_rpg_v0', runtime_action: 'walk_down' },
    },
  ],
  profile: TOPDOWN_RPG_V0,
})

assert.equal(metadata.sheet, 'normalized_sheet.png')
assert.deepEqual(metadata.frame_size, { w: 96, h: 96 })
assert.ok(metadata.frame_tags.some((tag) => tag.name === 'walk_down' && tag.from === 16 && tag.to === 19))
assert.equal(metadata.frames.frame_016.runtime_action, 'walk_down')
assert.deepEqual(metadata.frames.frame_016.frame, { x: 0, y: 192, w: 96, h: 96 })
assert.ok(metadata.attachments.some((point) => point.name === 'feet' && point.frame === 16 && point.point.x === 48 && point.point.y === 88))
assert.ok(metadata.slices.some((slice) => slice.name === 'frame_016_bounds' && slice.rect.x === 42))
```

Add an OCAD provenance assertion:

```js
assert.equal(metadata.frames.frame_036.source.layout, 'ocad_motion_v0')
assert.equal(metadata.frames.frame_036.source.region_key, 'climb0')
assert.equal(metadata.frames.frame_036.source.flip_h, false)
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/character-pack/packageBuilder.test.js
```

Expected: FAIL because `buildEditorMetadataJson` does not exist.

- [ ] **Step 3: Implement metadata builder**

In `src/character-pack/packageBuilder.js`, export:

```js
export function buildEditorMetadataJson({ metadata, animationsJson, frames = [], profile = TOPDOWN_RPG_V0, sourceLayout = null } = {}) {}
```

Implementation rules:

- Build `frame_tags` from `animationsJson.animations`.
- `from` is the first animation frame index and `to` is the last.
- `direction` is always `forward`.
- `duration` per frame is `Math.round(1000 / fps)` using the matching animation fps.
- `frames` is a hash keyed as `frame_000`.
- Sheet-space frame rectangle is `{ x: col * frame.w, y: row * frame.h, w: frame.w, h: frame.h }`.
- `attachments` includes `feet`, `head`, `hand_left`, `hand_right`, and optional `source_feet`.
- `slices` includes a `frame_NNN_bounds` entry when `normalized_bbox` exists.
- OCAD/fixed-region source provenance comes from `frame.source_meta`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node --test test/character-pack/packageBuilder.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/character-pack/packageBuilder.js test/character-pack/packageBuilder.test.js
git commit -m "feat: add editor metadata builder"
```

Expected: commit includes only builder code and tests.

### Task 2: Artifact Integration

**Files:**
- Modify: `src/character-pack/processSheet.js`
- Modify: `src/character-pack/artifactManifest.js`
- Modify: `test/character-pack/processSheet.test.js`
- Modify: `test/character-pack/artifactManifest.test.js`

- [ ] **Step 1: Write failing integration tests**

In `test/character-pack/processSheet.test.js`, extend the fixture pack test:

```js
assert.equal(result.editorMetadataJson.sheet, 'normalized_sheet.png')
assert.ok(result.editorMetadataJson.frame_tags.some((tag) => tag.name === 'walk_down'))
assert.ok(result.editorMetadataJson.attachments.some((point) => point.name === 'feet'))

const zip = await JSZip.loadAsync(result.files.zipBuffer)
assert.ok(zip.file('editor_metadata.json'))
const editorMetadata = JSON.parse(await zip.file('editor_metadata.json').async('string'))
assert.equal(editorMetadata.profile, 'topdown_rpg_v0')
```

In `test/character-pack/artifactManifest.test.js`, assert:

```js
assert.ok(manifest.files.some((file) => file.name === 'editor_metadata.json'))
assert.equal(manifest.urls.editor_metadata_url, '/generated/job_123/editor_metadata.json')
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: FAIL because the artifact is not wired through.

- [ ] **Step 3: Wire `editor_metadata.json` into processing**

In `src/character-pack/processSheet.js`:

- Import `buildEditorMetadataJson`.
- Build `editorMetadataJson` after `metadataJson`.
- Add it to `character_pack.zip`.
- Return it as `editorMetadataJson`.
- Add it to `result.files` as `editorMetadataJson`.

In `src/character-pack/artifactManifest.js`:

- Add `editor_metadata.json` next to `animations.json`.
- Add `editor_metadata_url`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/character-pack/packageBuilder.test.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/character-pack/processSheet.js src/character-pack/artifactManifest.js test/character-pack/processSheet.test.js test/character-pack/artifactManifest.test.js
git commit -m "feat: export editor metadata artifact"
```

Expected: commit contains only artifact integration.

### Task 3: Shared Artifact Writer

**Files:**
- Create: `src/character-pack/artifactWriter.js`
- Modify: `server.js`
- Create: `test/character-pack/artifactWriter.test.js`

- [ ] **Step 1: Write failing writer tests**

Create a temp directory, call:

```js
await writeCharacterPackArtifacts({
  jobId: 'job_cli',
  outputDir,
  result,
})
```

Assert:

```js
assert.equal(summary.job_id, 'job_cli')
assert.equal(summary.status, 'done')
assert.ok(summary.urls.editor_metadata_url.endsWith('/editor_metadata.json'))
assert.ok(await fileExists(path.join(outputDir, 'job_cli', 'editor_metadata.json')))
```

- [ ] **Step 2: Implement writer**

Create `src/character-pack/artifactWriter.js`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildCharacterPackArtifactManifest } from './artifactManifest.js'

export async function writeCharacterPackArtifacts({ jobId, outputDir, result } = {}) {}
```

Return:

```json
{
  "job_id": "job_cli",
  "dir": "/abs/path/job_cli",
  "status": "done",
  "reason": null,
  "retry_hint": null,
  "urls": {}
}
```

Status is `failed_post_processing` when `result.debugReport.validation.status === 'fail'`.

- [ ] **Step 3: Refactor server**

In `server.js`, remove the local artifact writer and import the shared writer. Keep `updateJob()` in server:

```js
const written = await writeCharacterPackArtifacts({ jobId: job.id, outputDir: generatedDir, result })
updateJob(job.id, {
  status: written.status,
  ...written.urls,
  reason: written.reason,
  retry_hint: written.retry_hint,
})
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/character-pack/artifactWriter.test.js test/serverOpenRouter.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/character-pack/artifactWriter.js server.js test/character-pack/artifactWriter.test.js
git commit -m "refactor: share character artifact writer"
```

Expected: commit contains the shared writer and server refactor.

### Task 4: Stable CLI

**Files:**
- Create: `scripts/character-pack-cli.mjs`
- Modify: `package.json`
- Create: `test/character-pack/cli.test.js`
- Optionally Create: `src/character-pack/cliOptions.js`

- [ ] **Step 1: Write CLI behavior tests**

Use temp dirs and fixture PNGs. Test process command:

```bash
node scripts/character-pack-cli.mjs process --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png --output-dir <tmp> --job-id cli_process --name sample_hero --background-mode flood
```

Assert stdout JSON has:

```js
assert.equal(result.command, 'process')
assert.equal(result.job_id, 'cli_process')
assert.equal(result.status, 'done')
assert.ok(result.urls.editor_metadata_url)
```

Assert files exist:

```js
editor_metadata.json
normalized_sheet.png
debug_report.json
character_pack.zip
```

Test dry-run generate:

```bash
node scripts/character-pack-cli.mjs generate --description "blue wizard" --preset topdown_rpg_v0 --dry-run-prompt --output-dir <tmp> --job-id cli_prompt
```

Assert no provider call is needed and `prompt.txt` plus `generation.json` exist.

- [ ] **Step 2: Implement CLI parser**

Implement a small hand-rolled parser that supports:

```text
process --input --output-dir --job-id --name --description --source-layout --background-mode --black-source --background-tolerance --anchor-offset-x --anchor-offset-y --disable-auto-correct --disable-motion-stabilization --locked-animation
generate --description --preset --provider-preset --image-size --aspect-ratio --reference-image --palette-image --disable-template --background-mode --output-dir --job-id --yes --dry-run-prompt
benchmark openrouter --sample-size --variants --preset --image-size --aspect-ratio --output-dir --run-id --background-mode --godot --yes
benchmark processed --root-dir --output-dir --run-id --limit
```

Use `processSheetBuffer`, `generateCharacterSource`, `loadTemplateImage`, `writeCharacterPackArtifacts`, and existing benchmark modules.

- [ ] **Step 3: Add npm scripts**

In `package.json`, add:

```json
"character-pack": "node scripts/character-pack-cli.mjs",
"character-pack:process": "node scripts/character-pack-cli.mjs process",
"character-pack:generate": "node scripts/character-pack-cli.mjs generate",
"character-pack:benchmark": "node scripts/character-pack-cli.mjs benchmark"
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/character-pack/cli.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add scripts/character-pack-cli.mjs package.json test/character-pack/cli.test.js
git commit -m "feat: add character pack cli"
```

Expected: commit includes CLI script, package scripts, and tests.

### Task 5: Docs, Attribution, And Verification

**Files:**
- Modify: `ATTRIBUTIONS.md`
- Modify: `docs/protocols/character-pack-artifacts.md`
- Modify: `docs/protocols/topdown_rpg_v0.md`
- Create: `docs/protocols/editor-metadata.md`
- Create: `docs/runbooks/character-pack-cli.md`
- Modify: `docs/runbooks/character-pack-benchmark.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Update protocols**

Add `docs/protocols/editor-metadata.md` describing:

```text
editor_metadata.json
frame_tags
frames
attachments
slices
source provenance
neutral Aseprite-compatible metadata wording
```

Update `docs/protocols/character-pack-artifacts.md` to list `editor_metadata.json`.

- [ ] **Step 2: Update runbooks**

Create `docs/runbooks/character-pack-cli.md` with exact examples for:

```bash
npm run character-pack -- process ...
npm run character-pack -- generate --dry-run-prompt ...
npm run character-pack -- benchmark openrouter ...
npm run character-pack -- benchmark processed ...
```

Update benchmark runbooks with the stable CLI route.

- [ ] **Step 3: Update attribution**

In `ATTRIBUTIONS.md`, add a small public-format note:

```text
Editor metadata JSON compatibility: the project emits original metadata with frame tag and slice concepts for interoperability with sprite editors that support JSON spritesheet metadata. No third-party source code or assets are bundled.
```

Use neutral wording and do not imply partnership or endorsement.

- [ ] **Step 4: Full verification**

Run:

```bash
npm test
git diff --check
npm run character-pack -- process --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png --output-dir generated/cli-smoke --job-id cli_smoke --background-mode flood
```

Expected: tests pass, whitespace check passes, and CLI smoke outputs JSON with `status = done` and `editor_metadata_url`.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add ATTRIBUTIONS.md docs/protocols/editor-metadata.md docs/protocols/character-pack-artifacts.md docs/protocols/topdown_rpg_v0.md docs/runbooks/character-pack-cli.md docs/runbooks/character-pack-benchmark.md README.md
git commit -m "docs: document editor metadata and cli"
```

Expected: commit includes only documentation and attribution updates.
