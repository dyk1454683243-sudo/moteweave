# P0-P2 Technical Upgrade Plan

**Date:** 2026-06-11  
**Status:** Active  
**Scope:** Technical follow-up after v0.4 scene/tile and project-pack release closure.

This plan records implementation order and claim boundaries. It does not approve
bulk deletion of scratch files, broad UI redesign, or unverified live provider
quality claims.

## 2026-07-16 Priority Insert

The current Character/Motion hardening sequence is tracked in
`docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`.
Its approved execution order is:

1. P0 Generation Release Gate. `Implemented and provider-free focused-verified on 2026-07-16.`
2. P0 Motion Source Correctness & Safety. `Implemented and provider-free
   guarded-verified on 2026-07-16.`

The project lead subsequently authorized sequential implementation of C, D,
then E. Pixel Grid v2 is complete in implementation commit `0a6353a`; Motion
Selection v2 is complete in implementation commit `f6a6a03` after guarded
verification and final read-only review found no remaining Blocker/High. Guided
Motion Source UI/HUD is complete in implementation commit `493f609`; its final
guarded browser/full-suite verification and two read-only reviews found no
remaining Blocker/High.
Semantic blocking and adaptive Provider candidate spending remain experiments
with separate benchmark and explicit budget requirements.

## P0: Motion Source Correctness And Safety v1

Status: implemented and guarded-verified on 2026-07-16; closed in the
independent B commit.

This P0 block corrects existing Motion Source authority and resource boundaries.
It is provider-free and does not add source generation, semantic judgment, or
automatic quota spending.

### B1: Explicit Selection Authority

- New UI/API requests use `selection_mode: "auto" | "manual"`.
- Auto is the default Preview -> Build authority and sends no
  `selected_frame_indexes`.
- Preview frames are candidates, not implicit manual selections.
- Manual requires a non-empty, integer, in-range, duplicate-free ordered list.
- The first selection/removal/reorder edit enters Manual; Restore Auto clears
  the manual list.
- Missing legacy mode infers Manual only from a non-empty index list and Auto
  otherwise. Explicit Auto plus indexes is rejected.
- Build evidence records both requested and effective mode.

### B2: Raw Upload, Identity, And Lifecycle

- Browser media uses
  `POST /api/motion-source/uploads?source_name=...&operation_id=...` with raw
  File bytes. The server streams to a private spool file while computing SHA-256
  and byte length; the new UI performs no Motion Base64 conversion.
- Limits are 200 MiB video, 64 MiB GIF/ZIP, 32 MiB raster, and 16 MiB total for
  migration-only legacy Motion JSON.
- The current process admits 16 live uploads/active writes, 512 MiB of live plus
  reserved upload capacity, 1024 upload-operation records, and a separate 1024
  Motion lifecycle bindings.
- Upload and operation release are idempotent. Release intent can arrive before
  descriptor commit, active references defer unlink, and an exact bound
  operation can replay after release while released bytes cannot start a new
  operation. Legacy Base64 operations release their internal upload and replay
  only after identical bytes/options are verified.
- Analyze, Preview, and Build resolve `source_upload_id` plus expected
  `source_identity`.
- Source identity, client `operation_id`, canonical `options_hash`, job id, and
  browser `source_epoch` must agree before artifacts render.
- Same operation/source/options returns the original job in the current process;
  conflicting operation reuse fails.
- Upload and operation handles are session-only. A server restart requires
  source re-selection/re-upload; no durable recovery claim is made.
- Poll abort stops observation only. Queued/active Cancel changes server work.
  `poll_timeout` preserves the exact job id, and Resume polls that job without
  re-enqueueing.
- Cancel is idempotent and Motion-scoped. A cancelled job remains terminal
  `failed_post_processing` with `failure_status: "cancelled"` and
  `motion_source_lifecycle: "cancelled"`.
- Browser/API `inputPath`, `videoOutputDir`, `ffmpegPath`, `rembgPath`, and
  equivalent local/tool paths fail as `client_path_not_allowed`; CLI paths
  remain under local shell authority.

### B3: Decode And External Tool Safety

- Decode ceilings are 256 ZIP entries, 256 MiB total uncompressed ZIP payload,
  240 GIF/sequence pages, 16,777,216 pixels per frame, and 256 MiB aggregate
  decoded RGBA before sampling.
- ZIP central-directory declarations and actual chunk-counted inflated bytes
  are both checked; at most 64 entries are extracted/sampled.
- Browser/API FFmpeg and rembg work uses one Motion media queue with concurrency
  `1`.
- FFmpeg extraction is bounded to 1536 MiB process-tree RSS and 120 seconds.
- One rembg frame is bounded to 1536 MiB and 45 seconds; the full rembg stage is
  bounded to 1536 MiB and 180 seconds.
- The supervisor samples the process tree at least once per second, owns the
  process group on POSIX, propagates AbortSignal, captures bounded diagnostic
  tails, performs bounded SIGTERM/SIGKILL termination, and does not retry.
- JSZip/Sharp/GIF/image cancellation is cooperative between explicit
  checkpoints. Windows guarded external-tool work fails closed before spawn as
  `external_tool_monitor_failed`.
- FFmpeg uses dynamic `bounded_scale_v1` normalization and caps extracted PNGs
  at 80 MiB per frame and 320 MiB total.
- Stable boundary evidence includes `decode_budget_exceeded`,
  `external_tool_timeout`, `external_tool_rss_limit`,
  `external_tool_cancelled`, `external_tool_spawn_failed`,
  `client_path_not_allowed`, and `use_motion_source_upload`.

This block bundles or downloads no FFmpeg, rembg, Python, model weight, plugin,
code, or asset. It makes no Provider call.

Motion Selection v2—registration before scoring, global near-duplicate
clustering, periodicity, action phases, and temporal matte—is block D and is not
included. The Guided Motion Source UI/HUD—wizard/onboarding, expanded evidence
HUD, and broader future-capability messaging—is block E and is not included.
Both were subsequently implemented under their separate approved contracts.

Done when:

- untouched Preview -> Build demonstrably uses Auto;
- Manual is explicit, ordered, validated, and reversible;
- new browser uploads are raw and identity-bound;
- stale jobs cannot update a different source;
- poll abort, Cancel, and Resume remain truthful;
- hostile decode/tool work fails within fixed ceilings with stable evidence and
  no retry;
- guarded focused, full, and self-hosted local smoke verification completes
  without a Provider call or a leaked tracked server/smoke/external-tool
  process;
- B is committed independently from A. D and E were later delivered in their
  own independently verified commits.

Completion evidence: the final full run passed `1357 / 1357` tests in
`135.864s`, at `831568 KiB` peak process-tree RSS and `5` peak processes. The
self-hosted local smoke passed in `3.741s`, at `708432 KiB` peak RSS and `3`
peak processes, and left no tracked smoke/server process.

Final C/D/E closure evidence: the guarded full suite passed `1431 / 1431` in
`151.804s`, at `846,256 KiB` peak RSS and `6` peak processes. The final
resource-bounded Chrome matrix passed in `11.734s`, at `1,630,048 KiB` peak
RSS and `11` peak processes, with 1440/1024/800/390 layout checks and
fail-closed stale/missing/unreadable artifact coverage. No Provider was called.
The final independent local smoke passed in `3.867s`, at `735,920 KiB` peak
RSS and `3` peak processes.

## P0: Release And Repository Readiness

Status: complete on 2026-07-17 under
`docs/superpowers/plans/2026-07-17-public-preview-release-readiness.md`.

Public source-preview and website cutover completed on 2026-07-17: the
history-independent `dyk1454683243-sudo/moteweave` mirror is public with
protected `main`; serial Node 22/24 CI, authenticated and anonymous install,
release verification, full tests, provider-free smoke, and source-archive
checks passed. The `v0.5.0-preview.1` tag and source-only prerelease are live.
The Git-integrated production site at `https://moteweave.pages.dev/` serves
protected `main` commit `34f44d472b2f56f12d2a2884243a51b47d5f8179` and
passed its production checks. The retained `https://gametool.pages.dev/`
project provides a verified path-preserving HTTP `302` transition. Provider
calls remained `0`.

- Release `v0.5.0-preview.1` as a source-only GitHub prerelease from a new,
  history-free public snapshot repository.
- Keep the private repository as the Preview engineering source of truth and
  treat the public repository as a reviewed release mirror.
- Use the approved `MoteWeave` / `moteweave` brand across the source Preview,
  while retaining separate explicit approvals for public repository visibility,
  final tag creation, and the new Pages deployment.
- Integrate the website/A-E baseline and Frame Repair Live Quality Gate into one
  private release commit before any export.
- Replace assets without provable redistribution evidence, neutralize named-IP
  fixture identifiers, remove real workstation paths, and require provenance
  for every active binary asset.
- Keep `package.json` private, support Node 22/24, and add deterministic
  `release:check` and `release:export` commands.
- Run release verification without Provider calls or bundled third-party
  binaries.
- Use `docs/runbooks/github-release-readiness.md` before visibility changes,
  tagging, or website cutover.

Done when:

- the final display name, package/repository slug, and Pages project name have
  explicit project-lead approval;
- both release-source branch heads are ancestors of one verified private release
  commit;
- the public snapshot contains no unproven asset, real secret, personal path,
  ignored artifact directory, untracked scratch file, or private Git history;
- README, package metadata, lockfile, CHANGELOG, website metadata, and
  `v0.5.0-preview.1` agree;
- guarded Node 22/24 tests, release checks, site checks, and local smoke pass
  provider-free from a fresh exported snapshot;
- the new repository passes private clean-clone review before explicit approval
  changes it to public;
- the final-brand website links only to the real public repository and
  prerelease;
- the final-brand Git-integrated Pages production deployment is built from
  protected `main`, returns HTTP `200`, and passes repository/Release CTA,
  canonical URL, OG metadata, security-header, responsive-layout, and
  capability-boundary checks;
- the retained legacy Pages project returns a verified path-preserving HTTP
  `302` transition for both root and nested paths, with no reverse redirect.

## P1: Scene Quality Evidence And API Boundaries

Status: started.

- Add provider-free scene tile report aggregation from explicit scene artifact
  directories.
- Use that report format for scene live gates through
  `benchmark scene-tile-live-gate`.
- Keep live generation guarded by explicit quota consent.
- Keep live scene tile generation behind explicit quota confirmation in CLI,
  local API, and browser flows. Upload/ingest remains the safe provider-free
  path; live generation evidence must cite sample size and gate policy.
- Strengthen raw tile quality gates before claiming WFC or production scene
  generation readiness. `Done for the first policy layer: duplicate referenced
  runtime tiles and continuous source-atlas structure now default to warn but
  can be strict release/live gate failures.`
- Add multi-candidate scene tile generation and selection evidence so live gates
  can report whether failures were isolated candidates or the selected output.
  `Done for the evidence layer: scene tile generation accepts bounded candidate
  counts, selects by deterministic quality score, writes candidate evidence, and
  aggregates candidate-selection taxonomy in live reports.`

Done when:

- Scene report JSON/Markdown can summarize pass, warning, fail, gate status, and
  failure taxonomy across explicit artifact dirs. `Done; reports now also
  summarize sample size, raw tile policy, and correction paths.`
- A dry-run/live scene gate runner exists and records its plan, per-case
  artifacts, and summary report. `Done; live gate plans default to strict raw
  tile policy and account for candidate count in estimated provider calls.`
- API docs distinguish upload/ingest, CLI live generation, and project-pack
  composition boundaries. `Done for current local API boundaries, including raw
  tile policy, quota-confirmed browser live generation, and explicit
  candidate-count behavior.`

## P2: Longer-Horizon Architecture

Status: started with shared style validation signals.

- WFC or stronger rule arrangement after raw tile quality improves. Candidate
  selection evidence is now available, but WFC readiness is still unclaimed
  until strict live gate samples show reliable selected outputs.
- Multi-level LDtk/world export, auto-layer rules, and entity placement UI.
  Single-level LDtk export remains the shipped boundary; auto-layer rules are
  still future work.
- Shared style contract enforcement across character, scene, and later props.
  The first project-pack validation signals now warn on missing style evidence
  and palette mismatch. Strict mode can now turn those warnings into a
  `style_contract_failed` project-pack failure for release gates.
- Per-frame or masked repair workflow for mostly-good character sheets.
- v0.5 Editor Workspace direction from the user-provided editor/canvas plan:
  introduce a persistent editor project protocol, artifact registry, scene
  authoring workspace, asset library, layer inspector, timeline, visual repair,
  and later interaction/playtest/scene-flow features in staged increments. This
  is accepted as the next longer-horizon product direction, but it must not
  replace the current artifact-first character/scene pipelines until each stage
  has its own protocol, tests, and UI contract. See
  `docs/decisions/2026-06-22-editor-workspace-direction.md` and
  `docs/superpowers/plans/2026-06-22-editor-workspace-v0-plan.md`.
- Runtime/game-engine API and hosted product concerns only after local quality
  gates are stronger.

Done when:

- Each item has its own design/protocol document before implementation.
- Third-party format, training-data, and attribution implications are reviewed
  under `AGENTS.md`.
- No P2 item is presented as shipped until code, tests, and docs prove it.

## v0.4.1 Quality Infrastructure Insert

Status: implemented on 2026-06-16.

This was an inserted engineering-quality block after the character
text-to-image cleanup, background cleanup, local image benchmark, and first
GitHub publication work. It is now complete, so the next deeper scene/tile unit
can resume.

- P0: Define neutral local golden image sets and layered gates: smoke, local
  golden, release, and live.
- P1: Add user-configured provider/model settings while keeping API keys
  local-only and out of browser-visible state.
- P2: Route live benchmark runs through the unified adapter with explicit quota
  consent and provider/model metadata.
- P3: Produce visual gallery and release reports that separate provider-free
  evidence from live-provider evidence.

Completed evidence:

- The active benchmark commands can run against local images without consuming
  provider quota.
- Live runs use the same adapter contract as local/dry runs and record model,
  provider, options, and failure taxonomy.
- Release notes can cite the exact gate layer and sample size behind each
  quality claim.
- Tracked manifests avoid named-IP or third-party samples; local-only samples
  stay ignored.

See `docs/superpowers/plans/2026-06-16-v041-quality-infrastructure.md` for the
dedicated plan.

## Scene Tile Candidate Evidence Block

Status: implemented on 2026-06-17.

This block resumes the v0.4 scene/tile direction after v0.4.1 quality
infrastructure. It does not ship WFC, LDtk auto-layer rules, or a new map editor
surface. It makes live scene tile evidence more useful before those decisions:

- `scene tile-generate` supports bounded multi-candidate generation.
- The selected candidate is chosen by quality status, blocking errors, warnings,
  seam/self-loop deltas, duplicate referenced tiles, source-atlas continuity,
  and candidate index tie-break.
- Candidate evidence is written beside the selected top-level scene pack and
  included in the ZIP.
- Live gate plans count provider calls as cases times candidate count.
- Scene tile reports summarize selected status, candidate count, selection
  reason, and failed-candidate taxonomy.

The next scene/tile decision should use strict live gate evidence from this
block to decide whether raw tile structure is strong enough for LDtk auto-layer
rules, WFC/rule arrangement expansion, or another quality pass.

Strict gate attempt on 2026-06-17:

- Planned `5` default cases with `4` candidates each under strict raw tile
  policy.
- Dry-run evidence recorded `20` estimated provider calls.
- Live image evidence was blocked before generation: OpenRouter routes returned
  provider route/TOS blocks and the native Gemini route had no usable quota.
- `--max-provider-calls` is now required for scene tile live generation and
  live gates, with provider-call budget accounting per candidate.
- Provider failures before image generation now write `live_gate_blocker.json`
  and `live_gate_review.json` so blocked live gates have machine-readable
  evidence and an explicit no-WFC/no-LDtk-auto-layer decision boundary.
- Manual external Gemini images for the same five scene themes were later
  ingested provider-free with strict raw tile policy, style snap, and
  edge-aware conditioning. The corrected structural gate passed `5 / 5`, with
  no duplicate runtime tiles, no source-atlas continuity, no visual seam
  failures, and no self-loop failures. This advances evidence review, but it is
  not the original `5 x 4` live gate because it has one image per case, no
  candidate-selection distribution, no failed-candidate taxonomy, and no
  unified provider metadata.
- Scene tile reports now expose `summary.correction_dependency`. Recomputing the
  five manual external samples records dependency level `high`, style snap
  changed-pixel ratio average `0.9952`, edge-conditioning changed-pixel ratio
  average `0.0971`, and visible edge-conditioning mutation warnings in `4 / 5`
  samples.
- `benchmark scene-tile-correction-matrix` now runs the same source sheet
  through `raw`, `style_snap`, and `style_snap_edge_aware` variants without
  provider quota, writing standard scene artifacts plus a matrix summary and a
  normal scene tile report.
- Running that matrix on the five manual external samples produced `raw`
  `0 / 5` pass, `style_snap` `1 / 5` pass, and
  `style_snap_edge_aware` `5 / 5` pass. The observed raw blockers were visual
  seam mismatch, self-loop mismatch, and source-atlas continuity.
- The matrix now records gate and blocker transitions. On the five manual
  samples, style snap cleared `source_atlas_structure` in `5 / 5`, while
  `visual_seams` and `tile_self_loops` stayed blocked in `4 / 5` until
  edge-aware conditioning.
- Raw readiness is explicitly `not_ready` for the manual external matrix until
  raw variant failures and correction-masked seam/self-loop blockers are
  reduced.
- Raw-quality closure has started with correction-matrix raw diagnostics,
  `scene_tile_prompt_contract_v0_6`, and a provider-free manual prompt pack.
  The v0.5 external Gemini images were supplied, but the original files were
  JPEG-encoded `1024x1024` images with `.png` names, so the manual retest
  helper rejected them with `source_sheet_size_mismatch`. A normalized
  `192x192` PNG diagnostic run completed, but raw readiness remained
  `not_ready` with `0 / 5` raw validation pass, `41` visual seam failures,
  `98` self-loop failures, and `33` source-atlas continuities. WFC and LDtk
  auto-layer work remain gated until a contract-compliant manual matrix or a
  live `5 x 4` gate reaches raw readiness. The v0.6 hardening removes visible
  mask-placement coordinate lists from the provider prompt, adds explicit true
  PNG/`192x192` output rules, writes `manual_handoff.md`, and makes the manual
  retest helper return `invalid_inputs` for JPEG-encoded or wrongly sized
  files before matrix execution.

Next scene/tile block:

- Reduce correction dependency before WFC or LDtk auto-layer rules.
- Tighten the external-image handoff so prompt instructions, file format,
  dimensions, and helper validation all agree before a manual result can be
  counted as raw-ready evidence.
- Measure raw-vs-corrected deltas for manual external scene samples and any
  future provider samples.
- Tune the prompt contract, raw-structure gate, or local correction thresholds
  so pass results depend less on heavy palette snap and visible edge mutation.
- Keep WFC, LDtk auto-layer rules, and map-editor expansion gated until either
  the original live `5 x 4` gate succeeds or raw/corrected evidence shows the
  source sheets are stable enough without large post-generation mutation.
- Execution plan:
  `docs/superpowers/plans/2026-06-17-scene-tile-raw-output-quality-pass.md`.
- Raw-quality closure plan:
  `docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md`.

See `docs/decisions/2026-06-17-scene-tile-strict-evidence-gate.md`.

## T2I Quality Parity Sprint

Status: implemented for local CLI/API/UI paths; live quality claims still
require benchmark runs.

### P0: Text-To-Image Quality Baseline

- Default text-to-image image size is now `2K` across CLI/server/UI paths.
- Default text-to-image candidate count is now `1`, capped at `8`; larger
  multi-candidate sweeps are explicit quality/benchmark choices.
- `production_sheet_v0` remains the default export-oriented mode and routes the
  selected candidate through `processSheetBuffer()`.
- `quality_character_v0` generates one high-quality character image without a
  structural sheet template and writes single-image T2I artifacts.
- `benchmark t2i-golden` defines a fixed 20-case Chinese/English prompt set and
  can write provider-free dry-run plans or live per-case evidence.

### P1: Structured Prompt And Pixel Finishing

- Structured prompt fields are supported by CLI/API/provider prompt contracts.
- Neutral character presets are implemented for humanoid, animal, monster,
  xianxia, chibi big-pixel, and 2:1 character art cases.
- Background mode is compiled into the provider prompt instead of being only a
  post-processing option.
- Quality-character mode applies default pixel finishing: background cleanup,
  palette snap, alpha outline strengthening, and nearest-neighbor downsample.

### P2: Provider-Agnostic Generation Options

- Provider calls now accept normalized generation options: candidate count,
  seed, temperature, top-p, top-k, and quality tier metadata.
- Candidate count is implemented as repeated provider requests plus local
  scoring, not as a provider-specific `n` field.
- OpenRouter-compatible and Gemini adapters receive explicit sampling fields
  only when the caller provides them.

See `docs/protocols/text-to-image-generation.md` for the current contract.

## Commercial Naming And Character Source Quality Reset

Status: P0 neutral naming implemented; P1 source-quality gate implemented.

This block prevents the next character-generation work from deepening a naming
debt. The project already has a working `252 x 252` fixed-region source path,
but the current internal/public id is too close to adjacent tool terminology for
commercial packaging. Rename planning should happen before more UI, API,
metadata, or docs are built on that id.

### P0: Neutral Fixed-region Naming

Status: implemented and verified in code/UI/docs.

- Introduce a neutral project-owned source-layout id, preferably
  `fixed_region_motion_v0`, for the existing `252 x 252` fixed-region motion
  source layout.
- Keep the old id as a temporary backwards-compatible alias only. Existing test
  fixtures, historical reports, and old generated metadata must remain readable.
- Move defaults, UI labels, new docs, CLI help, newly written metadata, and
  provider prompt summaries toward neutral naming.
- Preserve factual compatibility wording for exports, but do not use adjacent
  tool names as product, file, class, function, API-mode, or generated metadata
  identifiers.

Implementation note: new defaults, UI option values, prompt-contract metadata,
debug reports, editor metadata, benchmark summaries, and provider prompts now
write `fixed_region_motion_v0`. Historical `ocad_motion_v0` inputs remain
readable through an explicit legacy alias.

### P1: Character Fixed-region Source Quality Gate

Status: implemented on 2026-06-18.

- Add source-level validation before normalized runtime-frame validation:
  per-region occupancy, visible bounds, edge pressure, background/halo residue,
  and source-layout alignment against the fixed region table. `Done; persisted
  as debug_report.source_quality and source_quality_report.json.`
- Add action-motion checks at the fixed-region source level so multi-frame
  source actions such as walk, run, climb, jump, and interact/attract cannot
  pass with identical or nearly identical frames. `Done; warnings such as
  source_action_low_motion:<action> prevent a clean pass.`
- Keep expected static-region reuse separate from true duplicate-motion debt.
  `Done; action_motion.expected_static_reuse is separate from
  duplicate_motion_actions.`
- Feed these metrics into production-sheet candidate selection so live Gemini or
  OpenRouter runs choose the best raw source instead of merely the first
  processable image. `Done; production-sheet scoring penalizes source-quality
  warnings, blockers, halo, edge pressure, empty regions, and duplicate source
  motion.`
- Persist the source-quality report next to `source_layout_overlay.png`,
  `debug_report.json`, Row GIF previews, and generation metadata. `Done;
  artifact manifests expose source_quality_report_url.`

### P1: Background / Halo Closure For Live Character Sources

- Benchmark current API outputs with the existing local image and live
  generation gates before changing thresholds.
- Compare `white`, `edge_palette`, and provider alpha-capable background modes
  using the same halo and residue metrics.
- Tighten matte residue and edge-color decontamination only when evidence shows
  it reduces white edges without deleting character pixels.
- Local fixed-region upload now stages the source through the same controlled
  `256 x 256` crop/matte cleanup used by the generation path, and the workspace
  preview now prefers transparent inspection artifacts over raw uploaded
  sources. Remaining work is evidence tuning, not a separate local-upload
  background-removal feature.

### P2: Region Repair Tasks

- Generate a repair manifest for mostly-good sheets where only a few fixed
  regions fail occupancy, halo, edge-pressure, or source-action-motion checks.
  `Done for selected-action repair planning and artifact writing.`
- Keep this provider-agnostic at first: write prompts, masks, region crops, and
  validation expectations without requiring a specific API to repair the image.
  `Done for dry-run repair plans and local evidence.`
- Only wire live repair calls after the provider route and quota guard are
  proven through dry-run and fixture tests. `Done for one selected action with
  explicit confirmation and provider-call budget.`
- Keep the first shipped repair loop user-selected. Do not add automatic
  semantic action/facing judgment, multi-action replacement, or masked whole-sheet
  rewriting until the one-action workflow has stronger quality evidence.

### Scene/Tile Boundary During This Reset

- Do not reopen broad scene WFC, multi-level worlds, or saved editor
  round-trip automation while the character naming/quality reset is active.
- The next scene/tile work remains the raw-quality closure path already
  recorded in `docs/superpowers/plans/2026-06-17-scene-tile-raw-quality-closure.md`.
- Resume scene expansion only when raw/corrected evidence shows less reliance on
  heavy style snap and visible edge mutation, or when a strict live `5 x 4`
  provider gate reaches raw readiness.
