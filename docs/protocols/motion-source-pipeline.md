# Motion Source Pipeline

**Date:** 2026-06-19  
**Status:** Active; Motion Source Correctness and Safety v1 baseline
**Scope:** Local, deterministic conversion from user-provided motion sources into character sprite-pack artifacts.

This protocol defines the third character-production track:

```text
motion source -> selected frames -> normalized single-action strip -> existing character-pack validation/export
```

The track is parallel to text-to-image generation. It does not replace the current provider-based character flow, and it does not require a provider key.

## Claim Boundary

- AI image or video models may provide raw motion/style sources later, but they do not own the final sprite-sheet structure.
- Phase A does not generate source images or videos. It consumes user-provided motion sources and makes them verifiable.
- Local deterministic code owns frame extraction, selection, background cleanup, alignment, strip composition, validation, and export.
- Raw sources are not clean assets until they pass local normalization and validation.
- v1 targets one action at a time. Full multi-action character packs are assembled by applying reviewed strips into the existing normalized sheet profile.
- Multi-action work should use short per-action sources grouped by a shared `motion_source_set_v1`, not one long AI-generated video that tries to contain the whole action library.
- External binaries are optional local tools. The project does not bundle video encoders, editor binaries, model weights, or commercial art assets.
- Browser/API Motion Source work is provider-free. It must not call an image or
  video Provider, spend quota, or expose Provider settings as part of this flow.
- Browser/API callers do not own local input, output, FFmpeg, or rembg paths.
  Explicit local paths remain a CLI-only operator capability.
- Motion Selection v2 registration/periodicity work and the Guided Motion
  Source UI/HUD are separate D/E blocks. They are not part of this v1 safety
  baseline.

## Contract

The first public contract is `motion_source_contract_v1`.

```json
{
  "contract_version": "motion_source_contract_v1",
  "source_kind": "gif",
  "runtime_action": "walk_down",
  "target_frame_count": 8,
  "sampling": {
    "fps": 12,
    "stride": 1,
    "max_frames": 64,
    "start_sec": 0,
    "end_sec": null
  },
  "frame_size": {
    "source": "auto",
    "normalized_cell": [96, 96],
    "strip_layout": "horizontal"
  },
  "anchor_policy": {
    "pivot": "bottom_center",
    "baseline": "global_bbox_bottom",
    "static_offset_y": 0,
    "padding_px": 6,
    "max_anchor_drift_px": 2
  },
  "background": {
    "mode": "auto_flood",
    "source_requirement": "flat_solid_key_color_or_alpha",
    "key_color": [255, 255, 255],
    "tolerance": 24,
    "defringe": true,
    "protect_internal_light_pixels": true
  },
  "pixel_style": {
    "palette_snap": false,
    "max_colors": 32,
    "nearest_resize": true
  },
  "output_profile": {
    "target_profile": "topdown_rpg_v0",
    "apply_mode": "single_action_strip",
    "resample_strategy": "reject_mismatch"
  }
}
```

Allowed `source_kind` values:

- `gif`
- `frame_sequence_zip`
- `single_image`
- `video_file`

`video_file` requires a local FFmpeg-compatible binary discovered from `FFMPEG_PATH` or the system `PATH`. When unavailable, the API must return an actionable error and keep GIF/ZIP/single-image support available.

The analyzer must sniff cheap file signatures before sending data into Sharp or FFmpeg. A renamed text file such as `source.gif` with no GIF header must fail as `corrupt_or_unsupported_source` instead of reaching a deeper decoder error.

## Source Authoring Background Contract

Motion sources created manually or through external AI tools must make the background explicit. The source prompt or capture setup should not leave the background to the model.

Preferred source backgrounds:

- existing transparent alpha,
- a flat, single-color chroma background such as pure green, magenta, or blue,
- a flat white background only when the character has no white hair, white clothing, light outline, or pale props touching the silhouette.

Forbidden or warning-level backgrounds:

- gradients,
- shadows or contact shadows baked into the background,
- textured floors or scenery,
- checkerboard transparency previews flattened into the image,
- colors that also appear on the character edge.

The cleanup stage can still accept `[255, 255, 255]` as a default key color for backward compatibility, but new motion sources should prefer a high-contrast chroma key that is not present on the character. CLI/API/UI entry points must expose key color, tolerance, and defringe as real processing parameters before asking the user to rely on this workflow.

## Multi-Action Source Set

**Status:** Guarded validation and guarded set apply are implemented for CLI,
local API, and browser UI. AI video generation and arbitrary full-motion
planning remain deferred.

For one to three simple actions, a single short motion source can be acceptable if the actions are visibly separated and repeated cleanly. For larger action libraries, the default workflow should be a set of short clips that share the same identity contract.

Do not rely on a long AI-generated video to preserve identity across an entire action library. Long clips are more likely to drift in face, clothing, proportions, props, camera angle, or outline style.

The set-level contract is `motion_source_set_v1`:

```json
{
  "contract_version": "motion_source_set_v1",
  "identity_anchor": {
    "reference_image": "character_reference.png",
    "style_brief": "pixel art, same outfit, same proportions, right-facing side view",
    "projection": "topdown_rpg_v0",
    "direction": "right",
    "background": {
      "source_requirement": "flat_solid_key_color_or_alpha",
      "key_color": [0, 255, 0]
    }
  },
  "sources": [
    {
      "runtime_action": "walk_right",
      "source": "walk_right.mp4",
      "recommended_duration_sec": [2, 4],
      "target_frame_count": 8,
      "loop_expected": true
    },
    {
      "runtime_action": "jump_right",
      "source": "jump_right.mp4",
      "recommended_duration_sec": [1.5, 3],
      "target_frame_count": 8,
      "loop_expected": false
    }
  ]
}
```

`loop_expected: true` normalizes to `loop_expectation: "loop"`;
`false` normalizes to `"once"`; absence normalizes to `"auto"`. New manifests
may send `loop_expectation` directly. Supplying both forms with conflicting
meaning is a validation failure.

Recommended source durations:

| Action Type | Source Duration | Target Frames | Notes |
|---|---:|---:|---|
| `idle` | `2-4s` | `4-8` | repeat the loop at least twice when possible |
| `walk` / `run` | `2-4s` | `4-8` | prefer one clean cycle repeated twice |
| `jump` | `1.5-3s` | `6-12` | include takeoff, apex, and landing |
| `attack` | `1-2s` | `4-8` | avoid motion blur and camera shake |
| `hurt` | `~1s` | `2-4` | non-looping |
| `death` / `fall` | `2-4s` | `6-12` | non-looping |

Before applying strips from multiple sources to one character pack, the pipeline must run an identity consistency gate. At minimum it should compare:

- palette and dominant color deltas,
- silhouette height/width ratio,
- bbox size and baseline,
- facing direction and camera/projection,
- visible outfit color regions,
- prop side and anchor stability where detectable.

If a strip fails identity consistency, it must not be silently applied to the same character sheet. Report `identity_mismatch` with reviewed evidence and ask for regeneration or manual repair.

### Guarded Set Apply

`motion_source_set_apply_report_v1` records whether reviewed strips were applied
to one normalized character sheet. The operation must run source-set validation
and identity consistency before applying any strip. If either gate fails, no
strip is applied and the report status is `fail`.

The provider-free CLI entry is:

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
The local API mirrors this through `POST /api/apply-motion-source-set`, and the
browser `Motion Source` tab exposes the same operation as `Apply Set` after a
target sheet, source-set manifest, and reviewed strips are selected.

## Correctness And Safety v1 Contract

### Selection Authority

New browser/API Build requests make selection authority explicit:

```json
{
  "selection_mode": "auto",
  "selected_frame_indexes": null
}
```

The canonical rules are:

- `selection_mode` is exactly `auto` or `manual`.
- The browser defaults to `auto`. Preview frames are selectable candidates,
  not evidence that the user has manually selected every frame.
- `auto` omits `selected_frame_indexes`. A non-empty list conflicts with
  explicit `auto` and must fail before extraction or strip building.
- `manual` requires a non-empty, ordered, duplicate-free list of integer frame
  indexes within the preview range.
- The first user selection/removal/reorder edit switches the browser to
  `manual`.
- Restore Auto clears manual indexes and returns selection authority to the
  deterministic selector.
- Preview metadata records `default_selection_mode: "auto"`. A legacy
  per-frame `selected` field is migration-only and is not selection authority.
- Build evidence records both requested and effective selection modes.

Legacy requests without `selection_mode` infer `manual` only when they include a
non-empty index list; otherwise they infer `auto`. Explicit contradictory new
requests return a controlled 4xx error rather than silently guessing.

### Raw Upload And Identity Binding

The browser sends media once as raw bytes:

```text
POST /api/motion-source/uploads?source_name=<url-encoded>&operation_id=<id>
Content-Type: <browser File type or application/octet-stream>
Body: raw File bytes
```

The server streams the request into one private server-owned spool file while
computing SHA-256 and byte length. It must not convert the browser File to
Base64 or buffer the complete upload as JSON.

| Input family | Maximum request bytes |
| --- | ---: |
| Video | 200 MiB |
| GIF or frame-sequence ZIP | 64 MiB |
| Single raster image | 32 MiB |
| Legacy Motion JSON request | 16 MiB total body |

`Content-Length` is an early rejection hint, not the authority. The streamed
byte counter and format sniffing decide whether the descriptor is usable.
Legacy Base64 Motion requests remain migration-only below 16 MiB and return
`use_motion_source_upload` when the source must use the raw upload route.

The current server process admits at most 16 live uploads or active writes and
512 MiB of live plus reserved upload capacity. The upload-operation ledger is
capped at 1024 entries, and the Motion lifecycle independently caps operation
bindings at 1024. Capacity exhaustion returns a controlled 507 error.

`DELETE /api/motion-source/uploads/:uploadId` marks only the named upload for
release. If queued/active work or another non-terminal Motion operation still
references it, the response is `released: false, pending: true` and physical
unlink is deferred until those references clear. Release restores upload-count
and byte capacity while retaining operation-ledger identity for exact replay.
The UI normally requests release by upload operation id through
`DELETE /api/motion-source/upload-operations/:operationId`; this records the
intent even when the upload response has not produced a descriptor yet. Source
changes make at most four release attempts; each request, including response
parsing, has a 3-second client deadline. Server unlink failures separately
receive bounded retries after 250, 1000, and 4000 ms.

Analyze, Preview, and Build resolve `source_upload_id` plus the expected
`source_identity`. Every operation has a client-generated `operation_id`; the
server binds it to the canonical source and options hash for the current
process. Reuse is exact: the same operation id, operation type, upload id,
source identity, and canonical options hash return the original current-process
job. Conflicting reuse fails. An already-bound operation remains replayable
after its upload file is released, but released bytes cannot start a new
operation.

Migration-only Base64 requests use an internal operation-scoped upload that is
released after worker completion. Exact legacy replay must resend identical
source bytes and options under the same operation id; the bytes are verified
and discarded before the original job is returned.

Job/artifact responses echo `source_identity`, `operation_id`, and
`options_hash`. The browser also owns a local `source_epoch` that increments
when the selected File changes. A result may render only when source identity,
operation id, job id, and browser epoch still match current state.

Upload descriptors, operation recovery, and job identity are session-only.
After a local server restart, the user must select/upload the source again; v1
does not claim durable cross-process recovery.

### Polling, Cancellation, And Resume

These operations are intentionally different:

1. Poll abort stops browser observation and leaves server work unchanged.
2. Queued cancel marks the Motion operation cancelled before heavy work starts.
3. Active cancel aborts the Motion operation. ZIP, GIF, image, JSZip, and Sharp
   work observes cancellation cooperatively at explicit checkpoints and cannot
   preempt one library call already in progress. On POSIX, an active FFmpeg or
   rembg process is terminated as one detached process group with verified
   SIGTERM/SIGKILL escalation. On Windows, guarded external-tool execution
   fails closed before spawn as `external_tool_monitor_failed`.

A polling deadline returns `poll_timeout` with the exact job id and exposes
Resume. Resume continues `GET /api/jobs/:id` for that job; it never enqueues a
replacement. Selecting another source aborts old observation and blocks stale
rendering.

Cancellation is idempotent and Motion-scoped. v1 preserves the shared terminal
job taxonomy by projecting cancellation as:

```json
{
  "status": "failed_post_processing",
  "failure_status": "cancelled",
  "motion_source_lifecycle": "cancelled",
  "retry_hint": "resume_with_new_operation"
}
```

### Decode And External Tool Budgets

Compressed input is not trusted merely because upload bytes are within the
request ceiling. Decode must also enforce:

- at most 256 ZIP entries;
- at most 256 MiB total uncompressed ZIP payload;
- at most 240 GIF pages or decoded frames;
- at most 16,777,216 pixels in one decoded frame;
- at most 256 MiB aggregate decoded RGBA before sampling;
- at most 64 extracted and 64 sampled frames.

Before `JSZip.loadAsync`, ZIP inputs undergo EOCD and central-directory
preflight. Zip64, multi-disk archives, malformed directory bounds/counts, and
declared entry/uncompressed-byte overruns fail before inflation. Each actual
entry inflation is then consumed chunk-by-chunk, including non-image entries;
actual uncompressed bytes are counted and the JSZip worker is paused as soon as
the total budget is exceeded, so forged declarations do not defer the limit
until `Buffer.concat`.

Browser/API FFmpeg and rembg work shares one dedicated Motion media queue with
concurrency `1`. Executable paths come only from server configuration or
`PATH`; requests containing `inputPath`, `videoOutputDir`, `ffmpegPath`,
`rembgPath`, or equivalent client path fields fail as
`client_path_not_allowed`.

| Tool boundary | Process-tree RSS | Wall-clock |
| --- | ---: | ---: |
| FFmpeg extraction | 1536 MiB | 120 seconds |
| One rembg frame | 1536 MiB | 45 seconds |
| Total rembg stage | 1536 MiB | 180 seconds |

On POSIX, the supervisor samples the whole process tree at least once per
second, owns a detached process group, captures only bounded diagnostic tails,
sends SIGTERM then bounded SIGKILL escalation, verifies group exit, and never
retries automatically. Windows fails closed before spawn until equivalent
whole-tree supervision exists. FFmpeg uses `-nostdin`, bounded frames/time, and
at most two worker threads. Its aspect-ratio-preserving `bounded_scale_v1`
maximum dimension is derived from planned frame count, per-frame pixels, and
aggregate RGBA, capped at 4096. Extracted PNGs are stat-bounded to 80 MiB per
frame and 320 MiB total; Preview/Build evidence records normalization and
output-byte totals. Stable safety codes include `decode_budget_exceeded`,
`external_tool_timeout`,
`external_tool_rss_limit`, `external_tool_cancelled`,
`external_tool_spawn_failed`, `external_tool_failed`,
`external_tool_monitor_failed`, `client_path_not_allowed`, and
`use_motion_source_upload`.

## Pipeline Stages

### 1. Analyze Source

Input:

- source name,
- browser/API `source_upload_id` plus expected `source_identity`, or an explicit
  local CLI path,
- optional contract overrides.

Output:

```json
{
  "source_kind": "gif",
  "frame_count_raw": 24,
  "dimensions": [512, 512],
  "requires_external_binary": false,
  "warnings": []
}
```

The analyzer should not mutate pixels.

### 2. Extract Frames

GIF, ZIP, and single-image sources use project dependencies already present in the repository. Video sources use an external binary only when explicitly available.

Frame extraction output is an ordered RGBA frame list plus metadata:

```json
{
  "frame_count_raw": 24,
  "frame_count_sampled": 12,
  "sampling": {
    "fps": 12,
    "stride": 2,
    "max_frames": 12
  }
}
```

Browser/API preview jobs may write review-only artifacts before strict strip
building:

```text
frame_preview_sheet.png
frame_preview_index.json
frame_previews/frame_00001.png
```

Preview metadata defaults to automatic authority. If the user manually selects,
removes, or reorders preview frames, the build request must switch to
`selection_mode: "manual"`, send explicit `selected_frame_indexes`, and preserve
their requested order in strip evidence. An untouched Preview -> Build path
must send `selection_mode: "auto"` without indexes.

`frame_preview_index.json` uses
`mode: "motion_frame_preview_index_v2"`. The compatible `source_index` and
`output_index` remain candidate indexes for Manual selection. Each entry also
records `raw_index`, nullable timestamp/duration evidence, timing source, and
the ZIP/video source entry when available. Derived video sampling time is
labeled `derived_sampling`; it is not claimed as original PTS.

### 3. Clean Background

Default cleanup is local and deterministic:

- flood/chroma background removal,
- edge matte residue cleanup,
- edge color decontamination,
- small alpha component cleanup,
- white-edge halo scoring before and after cleanup.

Deep matting tools may be added later as optional local enhancements, but they are not a default dependency for pixel-art motion sources.

### 4. Select Frames

The automatic selector consumes cleaned frames. v1 selection is deterministic
and explainable:

- remove exact or near-duplicate frames,
- prefer frames with meaningful alpha/bbox motion,
- select `target_frame_count` frames across the usable range,
- report loop start/end similarity,
- report when the selected clip is not a clean loop,
- keep rejected-frame reasons reviewable.

The selector must emit `selected_frames.json`.

Motion Selection v2 is an explicit recipe:

```json
{
  "motion_selection": {
    "recipe": "motion_selection_recipe_v2",
    "loop_expectation": "auto",
    "temporal_matte": "evidence_only"
  }
}
```

Omitted, `null`, `false`, or explicit `motion_selection_v1_compat` preserves the
v1 selector. Unknown recipes, keys, or enum values fail before operation
queueing and hashing. Equivalent camel/snake aliases canonicalize to one
operation hash.

The v2 automatic selector:

- retains candidate and raw-source provenance after stride sampling;
- creates an analysis-only raster whose longest side is at most 64 pixels;
- performs a fixed, bounded integer translation registration without changing
  emitted pixels;
- caches registered pair evidence and uses conservative complete-link global
  near-duplicate clusters across at most 64 candidates;
- applies a static gate before lag self-similarity;
- reports credible periods, rejected integer-multiple harmonics, and unresolved
  harmonic ambiguity;
- treats phases as temporal positions, not semantic action labels;
- uses one credible cycle for `loop`, a monotonic full span for `once`, and
  chooses between them from evidence for `auto`.

Manual selection is a hard bypass. Registration, clustering, periodicity,
phase selection, and temporal matte report `not_run_manual_authority`, and the
requested candidate order is unchanged.

Temporal matte v2 is `disabled` or `evidence_only`. Evidence-only mode measures
registered alpha occupancy/flicker, does not modify pixels, does not influence
selection, does not block the job, and does not invoke an external tool.

`selected_frames.json` is `motion_selection_report_v2` for v2. It retains
`selected`, `rejected`, `loop`, and `warnings`, and adds provenance,
registration, clusters, static/period evidence, phase selection, temporal matte,
and target outcome. When unique phases are fewer than the requested count, no
frame is fabricated: the selection status is `insufficient_target`, the outer
Motion report is `warning`, and review artifacts remain available.

### 5. Optional Pixel Grid Refinement

Pixel Grid remains disabled by default. New browser/API calls may choose one
implemented v2 recipe:

- `pixel_grid_v2_balanced`;
- `pixel_grid_v2_detail_safe`;
- `pixel_grid_v2_oklab`.

The selected cleaned source-coordinate frames are refined as one sequence before
normalization. The report records sequence cell/phase consensus, harmonic
rejections, detail protection, palette distance, bounded sample counts, and
outline-last evidence. Motion executes the async refiner with the job
`AbortSignal`; it yields and observes cancellation between sampled detection
frames and selected refinement frames. Motion strip cleanup and per-frame
artifact encoding also check the same signal between frames.
Legacy direct/CLI options without a recipe retain `pixel_grid_v1_compat`.
Motion v1 compatibility also retains its original execution order:
normalize selected frames first, then refine those normalized frames. Only v2
uses source-coordinate refinement and the grid-aware normalization gate.

The server canonicalizes the recipe before operation hashing. Unknown recipe or
option keys fail before queueing. The browser exposes one disabled-by-default
recipe select; it does not expose thresholds or future semantic controls.
Recipe-only v2 requests use the canonical `2..32` cell-size range. Fixed
pixel/comparison/cell ceilings cannot be raised by the request; exceeding one
returns unchanged frames with `passthrough_refinement_budget`.

### 6. Normalize Strip

Each selected frame is normalized to the target cell:

- default cell: `96 x 96`,
- pivot: bottom center,
- baseline: global visible-bottom/contact line across the selected action,
- padding: fixed contract value,
- resize: nearest neighbor,
- when Pixel Grid v2 is refined, scale is quantized to an integer normalized
  cell size and placement aligns to that cell multiple without moving the
  visible bottom above the declared baseline.

If a positive integer normalized cell or baseline-preserving phase cannot be
satisfied, the final strip is rebuilt from the cleaned source frames. The
effective Pixel Grid status becomes
`passthrough_normalization_incompatible`; final shared-grid, outline, and
per-frame refinement claims are cleared. Attempted frame/sequence/outline
evidence is retained only under `pixel_grid_refinement.source_refinement`.
Pixel Grid warnings are also promoted to the top-level Motion report and job
warning list, so an explicit recipe passthrough cannot appear as warning-free
success.

Per-frame `auto_feet` anchoring is allowed only as diagnostic evidence. The normalized strip should use a stable action-level baseline by default so a walking cycle does not bounce when each frame has a slightly different detected foot point. `static_offset_y` is a manual override for jump, hover, or deliberate off-ground motions.

Output:

```text
normalized_motion_strip.png
motion_source_report.json
motion_contact_sheet.png
selected_frames.json
video_frames_sheet.png
frames_index.json
frames.zip
```

### 6. Apply Strip

`apply-strip` pastes a reviewed strip into a target action row/slots in an existing character sheet profile.

For `topdown_rpg_v0`, current runtime actions use 4-frame rows. If a motion source produces 8 selected frames, v1 must either:

- resample the strip to the target action frame count with an explicit strategy, or
- write an explicit `target_frame_count_mismatch` validation error.

The default v1 `resample_strategy` is `reject_mismatch`. If later enabled, `nearest_keyframes` must preserve phase symmetry and report the source indexes used for each target frame. Do not silently drop every other frame without recording the mapping, because uneven source timing can make walk cycles limp or jump. Pixel-art interpolation/blend resampling is not the default because it can create soft or ghosted frames.

After apply, the existing character-pack validator, row GIF previews, metadata, and exports remain the source of truth.

### 7. Export And Preview

Expected v1 artifacts:

```text
motion_source_report.json
motion_contact_sheet.png
selected_frames.json
normalized_motion_strip.png
video_frames_sheet.png
frames_index.json
frames.zip
applied_normalized_sheet.png
apply_motion_strip_report.json
```

When routed through the existing character-pack export path, the final pack still owns:

```text
normalized_sheet.png
animations.json
metadata.json
editor_metadata.json
debug_report.json
<animation>.gif
character_pack.zip
```

Editor handoff artifacts are optional and must be neutral interoperability outputs, for example:

```text
editor_frames.json
editor_handoff_manifest.json
```

The docs may say "exports Aseprite-compatible JSON" in body text, but module names and generated identifiers should remain project-neutral.

For guarded multi-strip review, use
`docs/runbooks/motion-source-productization-evidence.md` and cite the generated
`motion_source_set_apply_report.json`.

## Public Interfaces

CLI:

```bash
npm run character-pack -- motion-source build-strip <input> --action walk_down --frames 8
npm run character-pack -- motion-source apply-strip --sheet <normalized_sheet.png> --strip <strip.png> --action walk_down
npm run character-pack -- motion-source apply-set --sheet <normalized_sheet.png> --manifest <motion_source_set.json> --strip idle_down=<strip.png>
```

API:

```text
POST /api/motion-source/uploads
DELETE /api/motion-source/uploads/:uploadId
DELETE /api/motion-source/upload-operations/:operationId
POST /api/analyze-motion-source
POST /api/preview-motion-frames
POST /api/build-motion-strip
POST /api/apply-motion-strip
POST /api/analyze-motion-source-set
POST /api/apply-motion-source-set
POST /api/motion-source/jobs/:jobId/cancel
GET  /api/jobs/:jobId
```

UI:

- use the parallel `Motion Source` tab,
- upload GIF, frame ZIP, single image, or video when local FFmpeg is available,
- default Preview -> Build to automatic selection authority,
- expose explicit Auto/Manual selection plus Restore Auto,
- preview extracted candidates and allow reviewed manual frame selection before
  strict strip building,
- show source name, byte size, digest prefix, and current selection mode,
- request bounded release of the prior upload operation when the selected File
  changes; `pending: true` is expected while server work still references it,
- expose Cancel only for the current browser-owned cancellable Motion job and
  Resume only for the exact same-process job/identity,
- render only real job artifacts,
- show source report, preview frames, contact sheet, selected frames, strip
  preview, generic sequence exports, identity evidence, set-apply report, and
  apply result,
- keep provider-key settings out of this flow.

## Validation Requirements

Minimum v1 gates:

- no provider calls during motion-source processing,
- browser media uses the bounded raw upload route rather than Base64 JSON,
- source identity, operation id, options hash, job id, and browser epoch agree
  before rendering,
- automatic selection sends no manual indexes; manual indexes are explicit,
  valid, ordered, and duplicate-free,
- poll abort, cancellation, and Resume retain their distinct semantics,
- decode and external-tool breaches fail once with stable evidence and no retry,
- browser/API client path and executable path fields are rejected,
- extracted frame count is nonzero,
- automatic selection either satisfies the target or reports
  `insufficient_target` and a warning without fabricating frames; apply/export
  still rejects or explicitly resamples target-count mismatches,
- normalized strip dimensions equal `cell_width * frame_count` by `cell_height`,
- every selected frame has visible alpha content,
- bottom-center anchor drift is under the configured threshold,
- selected-frame evidence includes duplicate filtering and loop similarity,
- mismatched source/target frame counts are rejected or mapped with explicit resampling metadata,
- multi-source action sets pass identity consistency before strips are applied to one character pack,
- halo score does not regress after cleanup,
- corrupted or mislabeled inputs fail during analysis with a clear error,
- apply-strip preserves the target character profile dimensions,
- final character-pack validation still runs.

## Roadmap Boundary

The local Motion Source workflow is not:

- a claim that one-shot AI sheet generation is solved,
- a hosted video-generation integration,
- semantic action-phase recognition, optical flow, learned pose estimation, or
  temporal alpha repair,
- the Guided Motion Source UI/HUD redesign,
- a full multi-action motion planner,
- an unattended external editor round trip,
- a bundled third-party binary workflow.
