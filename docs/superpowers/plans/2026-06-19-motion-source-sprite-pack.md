# Motion Source Sprite Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Motion Source track that converts user-provided GIFs, frame ZIPs, single images, and optional local videos into reviewed single-action strips, then applies those strips to the existing character-pack validator/export pipeline.

**Architecture:** Keep text-to-image character generation and 2.5D tilesets intact. The new track treats motion media as raw source only: local code extracts frames, selects key frames, removes background, normalizes anchors, builds a strip, and then reuses existing character-pack validation/export. Public contracts and generated metadata use neutral `motion_source` naming; external tools are optional local interoperability points.

**Tech Stack:** Node.js ESM, `node:test`, `sharp`, `jszip`, existing `src/character-pack/*` image/normalization/export modules, optional system `FFMPEG_PATH`, optional local editor CLI, browser UI and local job API after the core strip path is verified.

---

## Source Evidence And Decision

The current provider-first character route has two practical limits:

- one-shot multi-action sheets have low real-world success because many poses/regions must all be correct in one generated image,
- background cleanup failures multiply across every frame when white/near-white edge residue survives flood cleanup.

The new route avoids making AI own the final sheet structure. It starts from motion sources supplied by the user, then makes the deterministic local pipeline responsible for structure, cleanup, alignment, validation, and export.

Phase A does not generate the source image or video itself. If the user creates a source with an external AI tool, the prompt must ask for a flat, explicit key-color background or true transparency. The local pipeline then treats that file as raw source, not as a clean asset.

External reference research should remain a design input only. Do not copy source code, assets, binaries, templates, or product naming from other tools. Any optional third-party dependency added later must be checked against `AGENTS.md` and recorded in `ATTRIBUTIONS.md`.

## Optimized Scope

The screenshot plan proposed a direct "video -> complete sprite sheet -> engine export" path. This plan narrows the first milestone:

```text
motion source -> single-action strip -> apply strip to existing character sheet -> existing validator/export
```

This smaller path is better for the current codebase because:

- `topdown_rpg_v0` already owns frame order, exports, metadata, and row GIFs,
- existing runtime actions currently use 4-frame rows, so an 8-frame motion source must be resampled or rejected explicitly,
- a single-action strip can be validated, repaired, manually reviewed, and repeated per action without pretending the whole character pack is solved at once,
- UI/API work can render real artifacts from a stable core instead of becoming a front-end shell around unfinished processing.

## Quality Risk Addendum

The 2026-06-19 review added eight quality risks that must be represented in the plan before implementation:

| Risk | Priority | Plan Response |
|---|---:|---|
| Source frame count does not match the target profile frame count | Highest | Default to `target_frame_count_mismatch`; add explicit `resample_strategy` only with mapping evidence. |
| Frame selector becomes the highest-risk new logic | High | Build selector before apply-strip; test duplicate filtering, motion delta, loop similarity, and selected/rejected evidence with synthetic and real local inputs. |
| Per-frame foot anchoring causes vertical jitter | High | Normalize using an action-level global baseline by default; keep per-frame foot evidence diagnostic. |
| Corrupted or mislabeled source files reach deep decoders | Medium | Source analyzer must reject bad magic bytes before Sharp/FFmpeg work. |
| Chroma/flood cleanup depends on source background quality | Medium | Expose key color, tolerance, defringe, and before/after matte preview in API/UI once the core builder exists. |
| Walking cycles can have horizontal foot-anchor wobble | Medium | Stabilize horizontal anchor from bbox center while vertical baseline follows action-level feet/contact evidence. |
| Source prompt leaves the background ambiguous | Medium | Document and validate the source background contract: transparent alpha or flat solid key color, no gradients, scenery, shadows, or reused edge colors. |
| Multiple action videos drift apart from the same character identity | High | Add `motion_source_set_v1` and an `identity_consistency_gate` before multi-strip apply. |

This addendum changes the implementation order slightly: Task 1 must include corrupt-source analysis, Task 2 must be treated as a quality gate rather than a helper, Task 3 must solve stable action-level baseline normalization, Task 4 must reject or explicitly map frame-count mismatches, and Task 4A must block multi-action set assembly unless identity consistency passes.

## Phase Board

| Phase | Name | Status | Exit Criteria |
|---|---|---:|---|
| 0 | Plan, protocol, ledger | Done | Plan/protocol/roadmap docs exist and distinguish implemented vs planned work. |
| 1 | Contract and source analysis | Done | `motion_source_contract_v1` is validated; GIF/ZIP/single-image analysis is provider-free. |
| 2 | Single-action strip MVP | Done | GIF/ZIP/single-image source builds `normalized_motion_strip.png` plus report/contact sheet. |
| 3 | Apply strip to existing sheet | Done | Reviewed strip can replace one runtime action and pass existing character-pack validation/export. |
| 3A | Multi-action source set identity gate | Done | Short per-action sources can be grouped only when the identity gate passes. |
| 4 | Optional local video extraction | API/UI preview and build entry done | `FFMPEG_PATH` or system binary extracts video frames for browser/API preview and strip building; CLI video entry remains optional follow-up. |
| 5 | API and browser entry | Done | Local job endpoints exist, and the `Motion Source` tab renders real job artifacts without touching provider keys. |
| 6 | Editor handoff | Done | Neutral editor JSON/handoff manifest export and same-size strip re-import contract are tested; optional local editor invocation skips when `SPRITE_EDITOR_PATH` is absent. |
| B | AI video source | Deferred | A future provider source may create raw video, then reuse Phase A; no Phase A dependency on AI video APIs. |

## Implementation Ledger

| Work Item | Status | Evidence | Notes |
|---|---:|---|---|
| Flood defringe/white-edge cleanup bridge | Done | Commit `7e2ac32` (`fix: defringe flood background cleanup`) | This is a prerequisite for per-frame motion cleanup. |
| GIF/ZIP/single-image frame extraction | Done | Commit `615f70f` (`feat: add video-sprite frame extractor (zip/gif, no ffmpeg)`) | Existing module and tests live under `src/video-sprite/` and `test/video-sprite/`. |
| Local FFmpeg video extraction | Extractor done early | `src/video-sprite/frameExtractor.js`, `test/video-sprite/frameExtractor.test.js` | External-binary-only FFmpeg runner is implemented behind injectable tests; no CLI/API/UI entry yet. |
| Motion Source protocol | Done by this plan | `docs/protocols/motion-source-pipeline.md` | Planned contract, stages, artifacts, validation gates. |
| Motion Source plan and record table | Done by this plan | This file | Track future execution with checkbox tasks and ledger updates. |
| Motion source contract and analyzer | Done | `src/motion-source/contract.js`, `src/motion-source/sourceAnalyzer.js`, `test/motion-source/contract.test.js`, `test/motion-source/sourceAnalyzer.test.js` | Contract defaults/validation and provider-free source analysis are implemented. |
| Deterministic frame selector | Done | `src/motion-source/frameSelector.js`, `test/motion-source/frameSelector.test.js` | Duplicate filtering, stable 8-frame sampling, selected/rejected evidence, motion deltas, and loop warnings are implemented. |
| Single-action strip builder | Done | `src/motion-source/stripBuilder.js`, `test/motion-source/stripBuilder.test.js`, `scripts/character-pack-cli.mjs` | Builds `normalized_motion_strip.png`, `motion_contact_sheet.png`, `motion_source_report.json`, and `selected_frames.json` from extracted motion frames. |
| Apply strip into `topdown_rpg_v0` | Done | `src/motion-source/stripApplier.js`, `test/motion-source/stripApplier.test.js`, `scripts/character-pack-cli.mjs` | Replaces one runtime action, rejects frame-count mismatch by default, and records nearest-keyframe mapping when explicitly requested. |
| Motion source set identity gate | Done | `src/motion-source/sourceSet.js`, `src/motion-source/identityConsistencyGate.js`, `scripts/character-pack-cli.mjs` | Validates `motion_source_set_v1`, writes identity consistency reports, and blocks multi-strip apply when deterministic visual evidence fails. |
| Guarded source-set apply | Done | `src/motion-source/sourceSetApplier.js`, `test/motion-source/sourceSetApplier.test.js`, `motion_source_set_apply_report_v1` | Applies reviewed identity-consistent strips into one sheet; still not AI video generation or arbitrary full-motion planning. |
| API endpoints | Done | `server.js`, `test/motion-source/api.test.js` | Provider-free endpoints cover analyze, build-strip, apply-strip, analyze-set, and apply-set with job artifacts. |
| Browser tab | Done | `src/ui/motionSource/api.js`, `src/ui/motionSourceTab.js`, `index.html`, `src/v8.css`, `scripts/smoke-local-ui.mjs` | Parallel `Motion Source` entry calls provider-free jobs, renders artifact URLs only after real jobs, exposes frame preview, manual selection/reorder, generic sequence exports, `Apply Set`, and keeps old character generation reachable. |
| Video sequence exports and optional matting | Done | `src/motion-source/framePreview.js`, `src/motion-source/externalMatting.js`, `server.js`, `test/motion-source/api.test.js` | API/UI now support frame-preview jobs, manual selected frame indexes, `video_frames_sheet.png`, `frames_index.json`, `frames.zip`, FFmpeg/rembg status, and optional user-installed rembg/U2Net matting without bundling binaries or model weights. |
| Editor handoff | Done | `src/motion-source/editorJson.js`, `src/motion-source/editorHandoff.js`, `test/motion-source/editorJson.test.js`, `test/motion-source/editorHandoff.test.js` | Exports neutral JSON-array frame metadata, same-size re-import manifest, artifact writer, and optional local editor command bridge without bundling editor binaries. |
| Encoded GIF/ZIP workflow regression | Done | `test/motion-source/e2eRegression.test.js` | Temporary encoded GIF/ZIP inputs now exercise analyze, extraction, strip build, identity gate, apply-strip, validation, and editor handoff without committing motion-source fixture media. |
| AI video provider source | Deferred | None | Do not implement until Phase A is stable. |

## File Structure

Planned code paths:

- Modify `src/video-sprite/frameExtractor.js`: keep the existing GIF/ZIP/single-image extractor working; finish or remove the local FFmpeg draft in Phase 4.
- Create `src/motion-source/contract.js`: validate `motion_source_contract_v1` defaults and overrides.
- Create `src/motion-source/sourceAnalyzer.js`: detect source kind and report whether optional local binaries are required.
- Create `src/motion-source/frameSelector.js`: deterministic duplicate filtering, motion scoring, loop evidence, and frame selection.
- Create `src/motion-source/stripBuilder.js`: background cleanup, frame normalization, contact sheet, report, and strip PNG output.
- Create `src/motion-source/stripApplier.js`: paste a strip into one runtime action in an existing character sheet/profile.
- Create `src/motion-source/sourceSet.js`: parse and validate `motion_source_set_v1` manifests.
- Create `src/motion-source/identityConsistencyGate.js`: compare strips/sources against a shared identity anchor before multi-action apply.
- Create `src/motion-source/editorJson.js`: emit neutral editor JSON compatible with common sprite editors.
- Create `src/motion-source/editorHandoff.js`: optional local editor CLI handoff using a user-configured path.
- Modify `scripts/character-pack-cli.mjs`: add `motion-source analyze`, `build-strip`, `apply-strip`, and `analyze-set`.
- Modify `server.js`: add local job handlers after CLI/core modules pass.
- Create `src/ui/motionSource/api.js`: browser API wrapper for real job endpoints.
- Create `src/ui/motionSourceTab.js`: parallel UI entry for Motion Source jobs.
- Modify `src/app.js` and `index.html`: register the tab after core API is stable.

Planned tests:

- Create `test/motion-source/contract.test.js`.
- Create `test/motion-source/sourceAnalyzer.test.js`.
- Create `test/motion-source/frameSelector.test.js`.
- Create `test/motion-source/stripBuilder.test.js`.
- Create `test/motion-source/stripApplier.test.js`.
- Create `test/motion-source/sourceSet.test.js`.
- Create `test/motion-source/identityConsistencyGate.test.js`.
- Create `test/motion-source/editorJson.test.js`.
- Extend `test/video-sprite/frameExtractor.test.js` for Phase 4 FFmpeg mocks.
- Extend `test/character-pack/cli.test.js` for CLI command dispatch.
- Add API/UI tests only after the server endpoints exist.

## Non-Goals

- Do not remove the existing AI character-generation entry.
- Do not claim one-shot AI sequence sheets are solved.
- Do not call a provider during Phase A.
- Do not bundle FFmpeg, editor binaries, model weights, or third-party art.
- Do not make optional local tools required for GIF/ZIP/single-image support.
- Do not add AI video generation in Phase A.
- Do not use restricted product or competitor names in file names, class names, function names, metadata identifiers, or public titles.

### Task 0: Land Plan, Protocol, And Roadmap Tracking

**Files:**
- Create: `docs/protocols/motion-source-pipeline.md`
- Create: `docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md`
- Modify: `docs/roadmap/technology-reference-roadmap.md`

- [x] **Step 1: Record the protocol**

Create `docs/protocols/motion-source-pipeline.md` with:

- `motion_source_contract_v1`,
- source kinds,
- pipeline stages,
- expected artifacts,
- validation requirements,
- public CLI/API/UI interface plan,
- claim boundaries.

- [x] **Step 2: Record this implementation plan and ledger**

Create this file and include:

- source decision,
- optimized scope,
- phase board,
- implementation ledger,
- file structure,
- task list.

- [x] **Step 3: Update the roadmap note**

Add a dated note to `docs/roadmap/technology-reference-roadmap.md` that the next character-production direction is the Motion Source track and that Phase A remains provider-free.

- [x] **Step 4: Verify docs-only diff**

Run:

```bash
git diff --check -- docs/protocols/motion-source-pipeline.md docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md docs/roadmap/technology-reference-roadmap.md
```

Expected: no output.

- [x] **Step 5: Commit docs only**

Run:

```bash
git status --short
git add docs/protocols/motion-source-pipeline.md docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md docs/roadmap/technology-reference-roadmap.md
git commit -m "docs: plan motion source sprite pack track"
```

Expected: commit stages only docs files; any unrelated `src/video-sprite/frameExtractor.js` draft remains unstaged.

### Task 1: Add Motion Source Contract And Analyzer

**Files:**
- Create: `src/motion-source/contract.js`
- Create: `src/motion-source/sourceAnalyzer.js`
- Create: `test/motion-source/contract.test.js`
- Create: `test/motion-source/sourceAnalyzer.test.js`

- [x] **Step 1: Write contract tests**

Add tests that assert:

- default contract version is `motion_source_contract_v1`,
- default action is `walk_down`,
- default target frames is `8`,
- default normalized cell is `[96, 96]`,
- default baseline is `global_bbox_bottom`,
- default `static_offset_y` is `0`,
- default `resample_strategy` is `reject_mismatch`,
- default background `source_requirement` is `flat_solid_key_color_or_alpha`,
- invalid `source_kind` throws `unsupported_motion_source_kind`,
- invalid `target_frame_count` throws `invalid_target_frame_count`.

Run:

```bash
node --test test/motion-source/contract.test.js
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement contract defaults and validation**

Implement exports:

```js
export const MOTION_SOURCE_CONTRACT_VERSION = 'motion_source_contract_v1'

export function createMotionSourceContract(overrides = {}) {
  const contract = {
    contract_version: MOTION_SOURCE_CONTRACT_VERSION,
    source_kind: overrides.source_kind ?? 'gif',
    runtime_action: overrides.runtime_action ?? 'walk_down',
    target_frame_count: overrides.target_frame_count ?? 8,
    sampling: {
      fps: overrides.sampling?.fps ?? 12,
      stride: overrides.sampling?.stride ?? 1,
      max_frames: overrides.sampling?.max_frames ?? 64,
      start_sec: overrides.sampling?.start_sec ?? 0,
      end_sec: overrides.sampling?.end_sec ?? null,
    },
    frame_size: {
      normalized_cell: overrides.frame_size?.normalized_cell ?? [96, 96],
      strip_layout: overrides.frame_size?.strip_layout ?? 'horizontal',
    },
    anchor_policy: {
      pivot: overrides.anchor_policy?.pivot ?? 'bottom_center',
      baseline: overrides.anchor_policy?.baseline ?? 'global_bbox_bottom',
      static_offset_y: overrides.anchor_policy?.static_offset_y ?? 0,
      padding_px: overrides.anchor_policy?.padding_px ?? 6,
      max_anchor_drift_px: overrides.anchor_policy?.max_anchor_drift_px ?? 2,
    },
    background: {
      mode: overrides.background?.mode ?? 'auto_flood',
      source_requirement: overrides.background?.source_requirement ?? 'flat_solid_key_color_or_alpha',
      key_color: overrides.background?.key_color ?? [255, 255, 255],
      tolerance: overrides.background?.tolerance ?? 24,
      defringe: overrides.background?.defringe ?? true,
      protect_internal_light_pixels: overrides.background?.protect_internal_light_pixels ?? true,
    },
    pixel_style: {
      palette_snap: overrides.pixel_style?.palette_snap ?? false,
      max_colors: overrides.pixel_style?.max_colors ?? 32,
      nearest_resize: overrides.pixel_style?.nearest_resize ?? true,
    },
    output_profile: {
      target_profile: overrides.output_profile?.target_profile ?? 'topdown_rpg_v0',
      apply_mode: overrides.output_profile?.apply_mode ?? 'single_action_strip',
      resample_strategy: overrides.output_profile?.resample_strategy ?? 'reject_mismatch',
    },
  }
  validateMotionSourceContract(contract)
  return contract
}
```

Also export `validateMotionSourceContract(contract)` and validate allowed source kinds, positive integer frame counts, `[w, h]` cell tuples, baseline values, background source requirements, and resample strategies.

- [x] **Step 3: Write analyzer tests**

Add tests that assert:

- `.gif` returns `source_kind: 'gif'`,
- `.zip` returns `source_kind: 'frame_sequence_zip'`,
- `.png` returns `source_kind: 'single_image'`,
- `.mp4` returns `source_kind: 'video_file'` and `requires_external_binary: true`,
- missing FFmpeg produces `available: false` but does not block GIF/ZIP analysis,
- `notes.txt` renamed to `fake.gif` returns `corrupt_or_unsupported_source`,
- a buffer with ZIP magic bytes and a misleading `.gif` name is classified by signature rather than extension.

Run:

```bash
node --test test/motion-source/sourceAnalyzer.test.js
```

Expected: FAIL because the analyzer does not exist.

- [x] **Step 4: Implement analyzer**

Implement `analyzeMotionSource({ name, buffer, ffmpegPath, env })` by reusing the existing frame-source kind detection where possible and returning a JSON-safe object:

```js
{
  source_kind,
  name,
  byte_length,
  requires_external_binary,
  external_binary: { kind: 'ffmpeg', path, available },
  warnings
}
```

Do not execute FFmpeg in the analyzer; only probe path availability when a path is provided. Sniff magic bytes before calling Sharp or FFmpeg so corrupted uploads fail with a controlled analyzer error.

- [x] **Step 5: Verify and commit**

Run:

```bash
node --test test/motion-source/contract.test.js test/motion-source/sourceAnalyzer.test.js
npm test
git add src/motion-source/contract.js src/motion-source/sourceAnalyzer.js test/motion-source/contract.test.js test/motion-source/sourceAnalyzer.test.js
git commit -m "feat: add motion source contract analyzer"
```

### Task 2: Build Deterministic Frame Selector

**Files:**
- Create: `src/motion-source/frameSelector.js`
- Create: `test/motion-source/frameSelector.test.js`

- [x] **Step 1: Write selector tests**

Add tests for:

- exact duplicate frames are removed,
- 12 input frames select 8 frames in stable order,
- all selected indexes refer to original frame indexes,
- loop similarity is reported,
- non-looping clips return a `loop_not_seamless` warning,
- bbox/motion deltas are recorded for selected and rejected frames,
- too few distinct frames returns a warning instead of fabricating frames.

Run:

```bash
node --test test/motion-source/frameSelector.test.js
```

Expected: FAIL because the selector does not exist.

- [x] **Step 2: Implement selector**

Implement:

```js
export function selectMotionFrames(frames, { targetFrameCount = 8 } = {}) {
  // Return { selected, rejected, loop, warnings }.
}
```

Use deterministic RGBA hashes for duplicate filtering, simple bbox/motion deltas for ranking, loop start/end similarity, and evenly spaced picks across the non-duplicate range. Keep the first selected frame before later selected frames in output order. Treat this module as a quality gate: it must emit enough evidence to explain why a strip looks uneven.

- [x] **Step 3: Verify and commit**

Run:

```bash
node --test test/motion-source/frameSelector.test.js
npm test
git add src/motion-source/frameSelector.js test/motion-source/frameSelector.test.js
git commit -m "feat: select motion source frames"
```

### Task 3: Build Single-Action Strip MVP

**Files:**
- Create: `src/motion-source/stripBuilder.js`
- Create: `test/motion-source/stripBuilder.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`

- [x] **Step 1: Write strip-builder tests**

Use synthetic frames with a solid subject on a white or chroma background. Assert:

- output strip width is `96 * selected_frame_count`,
- output strip height is `96`,
- halo score after cleanup is lower than before cleanup,
- flat chroma backgrounds are removed without relying on the default white key,
- flattened checkerboard or gradient backgrounds produce source warnings,
- global baseline stays stable across walking frames with alternating feet,
- `static_offset_y` shifts the action-level baseline predictably,
- horizontal centering uses bbox center rather than alternating foot x positions,
- contact sheet is produced,
- `motion_source_report.json` includes selected/rejected frame evidence.

Run:

```bash
node --test test/motion-source/stripBuilder.test.js
```

Expected: FAIL because the builder does not exist.

- [x] **Step 2: Implement strip builder**

Implement `buildMotionStrip({ frames, contract })` with these dependencies:

- existing background cleanup from `src/character-pack/sourcePreparation.js` and `backgroundRemoval.js`,
- existing RGBA encode helpers from `src/character-pack/imageCodec.js`,
- existing bbox/anchor utilities where available,
- an action-level baseline computed from selected-frame visible bottoms,
- nearest-neighbor normalization to the contract cell size.

Return buffers plus JSON-safe reports; do not write files inside this pure builder.

- [x] **Step 3: Add CLI build-strip command**

Add:

```bash
npm run character-pack -- motion-source build-strip <input> --action walk_down --frames 8
```

The CLI writes:

```text
motion_source_report.json
motion_contact_sheet.png
selected_frames.json
normalized_motion_strip.png
```

- [x] **Step 4: Verify and commit**

Run:

```bash
node --test test/motion-source/stripBuilder.test.js test/character-pack/cli.test.js
npm test
git add src/motion-source/stripBuilder.js test/motion-source/stripBuilder.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js
git commit -m "feat: build motion source strips"
```

### Task 4: Apply Strip Into Existing Character Sheet

**Files:**
- Create: `src/motion-source/stripApplier.js`
- Create: `test/motion-source/stripApplier.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`

- [x] **Step 1: Write apply tests**

Add tests that assert:

- a 4-frame strip replaces one 4-frame runtime action,
- an 8-frame strip targeting a 4-frame action is rejected by default with `target_frame_count_mismatch`,
- `--resample-strategy nearest_keyframes` maps source frames to target frames and records source indexes,
- resampling never blends pixel-art frames by default,
- output sheet dimensions match the source profile,
- existing character-pack validation can run on the applied sheet.

Run:

```bash
node --test test/motion-source/stripApplier.test.js
```

Expected: FAIL because the applier does not exist.

- [x] **Step 2: Implement applier**

Implement `applyMotionStrip({ sheet, strip, action, profile, frameMapping })`:

- load the target profile,
- resolve the runtime action frame indexes,
- validate strip cell size,
- resample or reject mismatched frame counts according to the contract,
- write `resample_mapping` in `apply_motion_strip_report.json` whenever source and target counts differ,
- paste the strip cells into the target frames,
- return `applied_normalized_sheet.png` and `apply_motion_strip_report.json`.

- [x] **Step 3: Add CLI apply-strip command**

Add:

```bash
npm run character-pack -- motion-source apply-strip --sheet <normalized_sheet.png> --strip <normalized_motion_strip.png> --action walk_down --resample-strategy reject_mismatch
```

- [x] **Step 4: Verify and commit**

Run:

```bash
node --test test/motion-source/stripApplier.test.js test/character-pack/cli.test.js
npm test
git add src/motion-source/stripApplier.js test/motion-source/stripApplier.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js
git commit -m "feat: apply motion strips to character sheets"
```

### Task 4A: Add Motion Source Set And Identity Gate

**Files:**
- Create: `src/motion-source/sourceSet.js`
- Create: `src/motion-source/identityConsistencyGate.js`
- Create: `test/motion-source/sourceSet.test.js`
- Create: `test/motion-source/identityConsistencyGate.test.js`
- Modify: `scripts/character-pack-cli.mjs`
- Modify: `test/character-pack/cli.test.js`

- [x] **Step 1: Write source-set contract tests**

Add tests that assert:

- `motion_source_set_v1` requires one `identity_anchor`,
- every source has a `runtime_action`, `source`, and positive `target_frame_count`,
- duplicate runtime actions are rejected,
- recommended durations are ordered `[min, max]` tuples,
- missing or ambiguous background requirements produce warnings.

Run:

```bash
node --test test/motion-source/sourceSet.test.js
```

Expected: FAIL because the source-set module does not exist.

- [x] **Step 2: Implement source-set validation**

Implement:

```js
export const MOTION_SOURCE_SET_CONTRACT_VERSION = 'motion_source_set_v1'

export function validateMotionSourceSetManifest(manifest) {
  // Return { status, normalized_manifest, warnings, blocking_errors }.
}
```

Keep the manifest JSON-safe and neutral. Do not load or decode media in this validator; only validate the set structure and identity anchor.

- [x] **Step 3: Write identity gate tests**

Create synthetic strips that share a palette and bbox shape, plus one mismatched strip with changed dominant colors or silhouette ratio. Assert:

- matching strips return `status: 'pass'`,
- mismatched strips return `status: 'fail'` with `identity_mismatch`,
- report includes palette delta, silhouette ratio delta, bbox/baseline delta, and direction check,
- a failed identity gate blocks multi-strip apply.

Run:

```bash
node --test test/motion-source/identityConsistencyGate.test.js
```

Expected: FAIL because the identity gate does not exist.

- [x] **Step 4: Implement identity consistency gate**

Implement:

```js
export function evaluateIdentityConsistency(strips, { identityAnchor, thresholds } = {}) {
  // Return { status, metrics, warnings, blocking_errors, per_strip }.
}
```

Use provider-free image evidence only:

- dominant palette comparison,
- visible bbox dimensions,
- baseline position,
- silhouette occupancy ratio,
- optional facing-direction metadata when present.

Do not claim semantic facial identity recognition. This gate is a deterministic visual consistency guard for pixel-art strips.

- [x] **Step 5: Add CLI set analysis command**

Add:

```bash
npm run character-pack -- motion-source analyze-set <manifest.json>
```

It writes:

```text
motion_source_set_report.json
identity_consistency_report.json
```

- [x] **Step 6: Verify and commit**

Run:

```bash
node --test test/motion-source/sourceSet.test.js test/motion-source/identityConsistencyGate.test.js test/character-pack/cli.test.js
npm test
git add src/motion-source/sourceSet.js src/motion-source/identityConsistencyGate.js test/motion-source/sourceSet.test.js test/motion-source/identityConsistencyGate.test.js scripts/character-pack-cli.mjs test/character-pack/cli.test.js
git commit -m "feat: validate motion source identity sets"
```

### Task 5: Finish Optional Local Video Extraction

**Files:**
- Modify: `src/video-sprite/frameExtractor.js`
- Modify: `test/video-sprite/frameExtractor.test.js`

- [x] **Step 1: Decide the paused FFmpeg draft**

Run:

```bash
git diff -- src/video-sprite/frameExtractor.js
```

If the draft matches this plan, keep and complete it. If it has diverged, manually edit the file with `apply_patch`; do not use destructive reset commands.

- [x] **Step 2: Write FFmpeg mock tests**

Add tests that assert:

- video extraction requires `inputPath` and `outputDir`,
- the runner receives `FFMPEG_PATH` when supplied,
- generated args include `-vf fps=<N>`,
- runner failure returns an actionable `ffmpeg frame extraction failed` error,
- no FFmpeg call is made for GIF/ZIP/single-image sources.

- [x] **Step 3: Complete implementation**

Keep the implementation external-binary only:

- no bundled FFmpeg,
- no new binary dependency,
- output frames written to a caller-provided temp directory,
- frame PNGs loaded back through existing image codec utilities.

- [x] **Step 4: Verify and commit**

Run:

```bash
node --test test/video-sprite/frameExtractor.test.js
npm test
git add src/video-sprite/frameExtractor.js test/video-sprite/frameExtractor.test.js
git commit -m "feat: support optional local video frame extraction"
```

### Task 6: Add Local API Endpoints

**Files:**
- Modify: `server.js`
- Create: `test/motion-source/api.test.js`

- [x] **Step 1: Write API tests**

Add local server tests for:

- `POST /api/analyze-motion-source`,
- `POST /api/build-motion-strip`,
- `POST /api/apply-motion-strip`,
- `POST /api/analyze-motion-source-set`,
- `/api/jobs/:id` reaches `done`,
- returned artifact URLs point to real generated files,
- corrupted or mislabeled uploads return controlled validation errors,
- build/apply options forward `background.tolerance`, `background.defringe`, `anchor_policy.static_offset_y`, and `output_profile.resample_strategy`,
- source-set jobs return `identity_consistency_report.json` and block mismatched strips,
- provider config and provider keys are not read or required.

- [x] **Step 2: Implement endpoints**

Mirror the existing job pattern used by local pack/tileset jobs:

- parse source base64 and options,
- enqueue work,
- write artifacts into a job folder,
- expose only artifact paths and non-secret metadata.

- [x] **Step 3: Verify and commit**

Run:

```bash
node --test test/motion-source/api.test.js
npm test
git add server.js test/motion-source/api.test.js
git commit -m "feat: add motion source local api"
```

### Task 7: Add Parallel Browser Entry

**Files:**
- Create: `src/ui/motionSource/api.js`
- Create: `src/ui/motionSourceTab.js`
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `src/v8.css`

- [x] **Step 1: Re-read UI guardrails**

Before touching UI files, read:

```bash
sed -n '1,240p' docs/guardrails/ui-implementation-guardrails.md
```

- [x] **Step 2: Add UI tests or browser smoke**

Use the repository's existing UI verification style. Assert:

- existing character-generation tab remains reachable,
- new Motion Source tab is parallel, not replacing old flows,
- upload controls are disabled or explanatory when required local video support is unavailable,
- results render only after a real job returns artifacts.

- [x] **Step 3: Implement UI**

Add controls for:

- source file upload,
- optional source-set manifest upload,
- action,
- target frames,
- stride/FPS,
- background key color,
- background preset swatches for white, green, magenta, and blue,
- tolerance,
- defringe toggle,
- static vertical offset,
- resample strategy,
- build strip,
- apply strip.

Show:

- source report,
- background cleanup before/after preview when available,
- contact sheet,
- selected-frame list,
- identity consistency report for multi-source sets,
- normalized strip preview,
- apply result links.

- [x] **Step 4: Verify and commit**

Run:

```bash
node --test test/localSmokeScript.test.js
npm test
git add src/ui/motionSource/api.js src/ui/motionSourceTab.js src/app.js src/ui/appState.js index.html src/v8.css scripts/smoke-local-ui.mjs docs/superpowers/plans/2026-06-19-motion-source-sprite-pack.md docs/roadmap/technology-reference-roadmap.md
git commit -m "feat: add motion source browser entry"
```

### Task 8: Add Editor Handoff

**Files:**
- Create: `src/motion-source/editorJson.js`
- Create: `src/motion-source/editorHandoff.js`
- Create: `test/motion-source/editorJson.test.js`
- Create: `test/motion-source/editorHandoff.test.js`
- Modify: `ATTRIBUTIONS.md` only if a new dependency is actually added.

- [x] **Step 1: Write editor JSON tests**

Assert:

- `frames` is an array,
- each frame has `frame: { x, y, w, h }`,
- `meta.size` matches the sheet,
- `meta.frameTags` includes the action name and frame range.

- [x] **Step 2: Implement neutral editor JSON**

Use neutral module names and generated identifiers. Body docs may describe the output as Aseprite-compatible JSON.

- [x] **Step 3: Add optional local editor handoff**

Use a user-configured path such as `SPRITE_EDITOR_PATH`. If absent, skip the handoff and keep the local compose output as the default result.

- [x] **Step 4: Verify and commit**

Run:

```bash
node --test test/motion-source/editorJson.test.js test/motion-source/editorHandoff.test.js
npm test
git add src/motion-source/editorJson.js src/motion-source/editorHandoff.js test/motion-source/editorJson.test.js test/motion-source/editorHandoff.test.js
git commit -m "feat: add motion source editor handoff"
```

## Release Readiness Checklist

- [x] Phase A does not call providers.
- [x] GIF/ZIP/single-image path works without FFmpeg.
- [x] Encoded GIF/ZIP regression covers the provider-free strip workflow end to end without committed media fixtures.
- [x] Video path reports local FFmpeg status and runs preview/build when FFmpeg is available.
- [x] Corrupted or mislabeled source files fail during analyzer preflight.
- [x] Mismatched source/target frame counts are rejected or mapped with explicit resampling evidence.
- [x] Multiple action sources pass `identity_consistency_gate` before entering one character pack.
- [x] Guarded source-set apply is available through CLI, API, and browser UI without provider calls.
- [x] Walking strips use stable action-level vertical baselines.
- [x] Background tolerance and defringe settings are exposed only when wired to real processing.
- [x] Source authoring guidance clearly requires alpha or a flat solid key-color background.
- [x] No third-party binary or model weight is bundled.
- [x] New generated identifiers use `motion_source` or other neutral names.
- [x] Existing AI character generation still works.
- [x] Existing 2.5D tileset path still works.
- [x] `npm test` passes.
- [x] Docs distinguish implemented, draft, planned, and deferred work.

## Execution Handoff

Recommended execution order:

1. Finish Task 0 docs commit.
2. Execute Tasks 1-4 as the first single-action MVP batch.
3. Review actual strip quality with local GIF/ZIP samples.
4. Execute Task 4A before allowing multiple action sources into one character pack.
5. Add API/UI only after CLI artifacts and identity reports are real and validated. `Done`
