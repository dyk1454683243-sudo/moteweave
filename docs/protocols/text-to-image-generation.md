# Text-To-Image Generation Protocol

**Status:** Implemented for local CLI/API/UI entrypoints.  
**Scope:** Character text-to-image generation before downstream game-engine export.

This protocol separates art-quality text-to-image work from strict production
sheet generation. Both modes may use the same provider/model, but they optimize
different contracts.

## Modes

### `production_sheet_v0`

Default mode. Generates a provider image that must satisfy the selected source
layout, then routes the selected candidate through `processSheetBuffer()`.

- Default source layout: `fixed_region_motion_v0`.
- Default image size: `2K`.
- Default candidate count: `1`.
- Uses the structural template unless `--disable-template` is passed.
- Writes normal character-pack artifacts such as `normalized_sheet.png`,
  `debug_report.json`, `source_quality_report.json`, Row GIF previews, engine
  export ZIPs, `prompt.txt`, and `generation.json`.
- `generation.json.candidate_selection` records all candidate scores and the
  diagnostic and release-selected candidates.
- Publishes ZIP/engine artifacts only when `generation_release_gate_v1` passes
  strict validation, applicable source-quality, and quality-closure evidence.

### `quality_character_v0`

Generates a single high-quality pixel character image without forcing sprite
sheet layout or template obedience.

- Default image size: `2K`.
- Default candidate count: `1`.
- Does not upload the structural template.
- Writes `source.png`, `t2i_result.png`, `candidate_<n>.png`,
  `t2i_report.json`, `prompt.txt`, `generation.json`, and `t2i_pack.zip`.
- Runs default pixel finishing: removable-background preparation, palette snap,
  alpha outline strengthening, and nearest-neighbor downsample.
- Records production-spec metrics for the finished image, including visible
  pixel count, subject bbox ratios, center offset, and edge margin.
- Publishes `t2i_pack.zip` only when the versioned Quality Character hard gate
  passes. The gate reuses the owned golden-review composition thresholds; it is
  not a semantic character judge.

## Structured Prompt Fields

Both modes accept the same structured prompt fields. CLI supports either
`--prompt-field key=value` or named flags where present.

Recognized fields:

- `identity`
- `body`
- `outfit`
- `colors`
- `equipment`
- `style`
- `background`
- `outputType`

These fields are compiled into provider-facing prompt text while preserving the
original free-form `description` as the user subject.

## Neutral Character Presets

The shipped presets are implementation-owned, neutral prompt helpers:

- `rpg_humanoid_v0`
- `animal_companion_v0`
- `monster_creature_v0`
- `xianxia_hero_v0`
- `chibi_big_pixel_v0`
- `two_to_one_character_v0`

`two_to_one_character_v0` defaults quality-character mode to `2:1` unless the
caller explicitly passes an aspect ratio.

## Generation Options

Provider-independent options are normalized before each provider call:

- `candidateCount` / `candidate_count`: default `1`, max `8`
- `seed`: offset by candidate index so candidates are reproducible but distinct
- `temperature`
- `topP` / `top_p`
- `topK` / `top_k`
- `qualityTier` / `quality_tier`: recorded for audit; providers may ignore it

Candidate count is implemented as multiple provider requests, not as a provider
specific `n` parameter. This keeps OpenRouter-compatible and Gemini providers on
the same selection path.
Normal one-click generation should keep the default at `1`; use `4` or more only
when intentionally spending quota on candidate comparison, benchmark evidence, or
release review.

## Provider Fallback

When no provider preset is explicitly selected, generation starts with the
configured default preset and then falls back to the next available configured
preset in the same provider family if the default request fails. Cross-provider
fallback is disabled by default so an OpenRouter route cannot silently consume
native Gemini quota. Set `CHARACTER_ALLOW_CROSS_PROVIDER_FALLBACK=1` to opt in.
Each successful generation records `provider_attempts` with the attempted preset
ids, models, status, and sanitized errors.

When `--provider-preset` or an API `providerPresetId` is explicit, fallback is
disabled. The request must use that exact preset and fail visibly if the preset
or route is unhealthy.

## Candidate Selection

`production_sheet_v0` scores processed candidates from validation status,
warnings, blocking errors, duplicate-motion metrics, halo score, edge pressure,
and fixed-region source-quality metrics. For `fixed_region_motion_v0`, source
quality includes per-region occupancy, visible bounds, background/halo residue,
source edge pressure, source-layout alignment, and source-action motion. Expected
single-region static reuse is recorded separately from true multi-frame
source-action collapse.

`quality_character_v0` scores finished single-image candidates from visible
pixel count, unique color count, palette mutation ratio, outline mutation ratio,
and production-spec metrics such as bbox size, center offset, and edge margin.
This score is a local ranking signal, not an external art-quality claim.

## Release Eligibility

Ranking and release are separate:

- `selected_index` is the highest-scoring processed diagnostic candidate.
- `release_selected_index` is the highest-scoring candidate whose
  `generation_release_gate_v1.release_ready` is true.
- A lower-scoring eligible candidate is published instead of a higher-scoring
  blocked candidate.
- If processed candidates exist but none are eligible,
  `release_selected_index` is null, `artifact_disposition` is
  `diagnostic_only`, and the job/CLI result is `failed_quality_gate` with
  `failure_status: generation_release_gate_failed`.
- Diagnostic-only runs keep source/result, gate, debug, prompt, generation, and
  the candidate evidence supported by the mode. Quality Character keeps its
  `candidate_<n>.png` files; Production Sheet keeps the selected diagnostic
  source/result and candidate report, not every generated candidate image. No
  mode writes or exposes Character/T2I ZIPs or engine export packages.
- If no candidate reaches local processing, existing `failed_model_error`
  Provider/route/budget taxonomy remains authoritative. Local processing or
  writer exceptions remain `failed_post_processing`.

Artifact job directories are single-assignment. Reusing the same `job_id` under
the same output directory fails before any artifact is written, preserving the
existing run and preventing stale release files from being attributed to a new
diagnostic-only result.

`production_sheet_v0` uses policy `strict_live_generation_v1`: validation must
be clean `pass`; fixed-region source quality must be clean `pass`; and
`quality_closure.release_ready` must be true. Non-fixed layouts record source
quality as not applicable. Missing required evidence fails closed.

`quality_character_v0` blocks empty subjects, score below `600`, visible pixels
above `220000`, bbox width above `0.72`, height above `0.86`, area above `0.42`,
center offset above `0.10`, or edge margin below `0.035`. Equality passes. Soft
visible/color/palette/outline signals remain warnings. This proves only local
non-empty, composition, and processing constraints; it does not prove identity,
pose, anatomy, action, or art quality.

## Golden Benchmark

`benchmark t2i-golden` provides a fixed 20-case prompt set with Chinese and
English descriptions.

Dry-run plan:

```bash
npm run character-pack -- benchmark t2i-golden --dry-run-plan
```

Live run:

```bash
npm run character-pack -- benchmark t2i-golden \
  --sample-size 20 \
  --candidate-count 4 \
  --t2i-mode quality_character_v0 \
  --image-size 2K \
  --max-provider-calls 80 \
  --yes
```

The live run writes per-case raw images, finished images, candidate PNGs,
prompts, generation metadata, candidate scores, and an aggregate report.
Each benchmark item records both diagnostic and release-selected indexes/scores;
offline review evaluates the release-selected candidate when one exists, while
retaining the diagnostic selection as separate ranking evidence.
Dry-run plans report `planned_provider_calls`. Live runs require
`--max-provider-calls` at or above that plan, and the cap counts every real
provider attempt, including fallback retries.
By default the benchmark stops after the first case where all candidates fail,
writes the partial report, and records the failure as `failed_all_candidates`.
Raise `--max-case-failures` only when intentionally collecting more provider
failure data.
Non-retryable provider route failures, such as provider policy or terms blocks,
are recorded as `provider_route_blocked` with `retry_hint:
switch_provider_preset`; the candidate loop stops after the first blocked call
so the remaining candidate budget is not spent on a route that cannot serve the
request.
Release-gate failures are recorded as completed diagnostic cases and do not
masquerade as Provider failures. They do not increase Provider calls or trigger
automatic retry.

Offline review:

```bash
npm run character-pack -- benchmark t2i-golden-review \
  --run-dir generated/t2i-golden-benchmarks/<run_id>
```

This reads only the explicitly provided `t2i_golden_report.json`, checks the
recorded source/result/prompt/generation/candidate artifacts, and writes
`t2i_golden_review.json`, `t2i_golden_review.md`, and
`t2i_golden_review.html`. The review layer reports usable rate, a configurable
quality gate, per-case issues, issue taxonomy, and a local candidate gallery
without spending provider quota.

The review JSON also includes `closure_analysis`. This maps observed issues to
technical owners instead of making a generic art-quality claim:

- `artifact_and_provider_reliability`: provider failures, failed items, or
  missing source/result/prompt/generation files.
- `prompt_scale_contract`: subject scale, bbox, centering, visible-pixel, and
  edge-margin failures.
- `pixel_finishing_calibration`: palette snap, outline, and unique-color
  finishing failures.
- `candidate_selection_and_sampling`: selected-candidate score or sampling
  evidence that local ranking needs attention.

Use `closure_analysis.priority_actions` as the next-work queue. `P0` means the
issue is blocking or widespread enough to fix before drawing art-quality
conclusions; `P1` means it is a real next iteration item; `P2` means monitor the
gate after future provider, prompt, or finishing changes.
