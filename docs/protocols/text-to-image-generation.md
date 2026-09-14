# Text-To-Image Generation Protocol

**Status:** Implemented; Background Matte V2 is active for strict fixed-region
generation, while strict topdown Review remains gated pending an authoritative
Structure.
**Scope:** Character text-to-image generation before downstream game-engine export.

This protocol separates art-quality text-to-image work from strict production
sheet generation. Both modes may use the same provider/model, but they optimize
different contracts.

## Strict Full-Sheet Profiles

Two opt-in Profiles add a sealed one-call path without changing legacy request
meaning:

- `full_sheet_fixed_region_v1` uses `fixed_region_motion_v0`.
- `full_sheet_topdown_v1` uses `topdown_rpg_v0`.

Profile registration does not imply that a layout is currently callable. The
fixed-region Profile has a sealed authoritative Structure. The topdown Profile
currently fails provider-free Review because its only maintained geometry image
is a generic robot placeholder and is not approved as an exact-outline input.

Both Profiles are immutable `production_sheet_v0` contracts:

- Gemini Native (`route_kind: google_native`) only;
- exact `1:1`, `2K` provider output;
- `1024x1024` derived reference boards;
- one candidate and `maxProviderCalls: 1`;
- no retry, Provider fallback, model fallback, or route switch;
- optional strong Identity input;
- required `subject_count_gate_v1` evidence for human review; detector results
  never accept or reject the candidate automatically.

An unknown Profile or explicit Provider Preset is rejected. Requests without a
Profile continue through the legacy path with their prior mode, candidate, and
fallback semantics.

The reviewed Preset must also advertise native image-size support for its exact
model. The immutable Provider block stores a SHA-256 of the exact request
endpoint assembled from the Preset base URL and model; it never stores the raw
endpoint or API key. A model that would silently omit `imageSize: 2K` is rejected
before Review is written.

### Provider-free Review

`POST /api/generate-character/review` is the formal pre-call entry. It performs
no Provider request and writes an immutable Review directory containing:

```text
generation_review.json
generation_request_manifest.json
generation_reference_manifest.json
generation_prompt.txt
structure_reference.png
identity_reference.png    # only when supplied
palette_reference.png     # only when supplied
```

The request manifest records the actual System Instruction and ordered task
parts, Profile, exact Provider Preset, route, model, `2K`/`1:1` configuration,
candidate and call limits, original-input hashes, derived-reference hashes,
stable Plan Hash, and Reference Manifest Hash. The Review response reports
`provider_calls_used: 0` and `estimated_provider_calls: 1`; the estimate is the
cost of a later separately confirmed live request, not a call made by Review.
No API key is stored or returned.

The reference order is fixed:

1. Structure: an authoritative, layout-specific exact-outline reference. The
   fixed-region source is color-remapped without changing alpha geometry,
   padded from 252px to 256px only on the right and bottom, and resized 4x with
   nearest-neighbor sampling. Its reviewed 1024px PNG hash is sealed. The
   server must not synthesize a guide, substitute another layout, or send a
   generic block/robot placeholder. A strict Profile with no approved
   authoritative Structure fails during Review and consumes zero calls.
2. Identity, when supplied: background-isolated, alpha-bbox cropped, and placed
   once on a 1024px transparent board. Inputs that cannot be isolated as one
   significant subject fail before a call.
3. Palette, when supplied: extracted colors rendered as pure swatches. The
   original person or object silhouette is not sent.

### Sealed Live Request

A Profile request to `POST /api/generate-character` must submit all of:

```json
{
  "generationProfileId": "full_sheet_fixed_region_v1",
  "reviewedRunId": "<review id>",
  "expectedPlanHash": "<64 hex characters>",
  "expectedReferenceManifestSha256": "<64 hex characters>",
  "confirmLiveGeneration": true,
  "maxProviderCalls": 1
}
```

The server validates the Review once before queueing and again immediately
before generation. It rechecks the Profile definition, exact Preset and model,
route capabilities, optional supplied inputs, prompt hash, reference manifest,
the Provider endpoint hash, and every saved reference byte hash. Any stale hash, changed request field,
changed image, changed Preset/model, or missing artifact fails before the
Provider call and consumes zero calls. A valid request sends the exact stored
text and exact stored derived images rather than rebuilding them.

### Raw Provider Output

For a strict `full_sheet_*` live request, the single Provider image is written
to the job directory immediately after the response and before image decode,
background removal, calibration, resizing, or Sheet processing. The file is
named `raw_provider_output.<ext>` from its detected image MIME type and contains
the exact Provider bytes without re-encoding.

`generation.json.raw_provider_output` records its filename, SHA-256, byte
length, declared and detected MIME types, actual decoded dimensions, and
`processing: none`. The job exposes `raw_provider_output_url`. Final artifact
writing verifies that the already-written bytes are unchanged instead of
overwriting them. A mismatch is a post-processing integrity failure.

This raw file is distinct from `source.png`: `source.png` is the derived,
background-processed and layout-calibrated production source. The raw file is
kept for `review_required`, diagnostic, and released production-Sheet results;
it is review evidence and is never an automatic acceptance signal. Legacy
multi-candidate production requests retain only the exact raw bytes of the
candidate selected for publication or diagnosis.

### Background Removal And Downscale Stages

Fixed-region production generation keeps background removal and layout sizing
as two explicit deterministic stages:

```text
raw_provider_output.<ext>
-> background removal at the decoded Provider dimensions
-> background_removed_provider_output.png
-> nearest-neighbor staging to 256x256
-> fixed-region calibration and 252x252 production source.png
```

`background_removed_provider_output.png` is a full-resolution RGBA PNG. It is
written before staging, resizing, fixed-region calibration, or Sheet
normalization. `generation.json.background_removed_provider_output` records its
filename, PNG MIME type, dimensions, byte length, SHA-256,
`processing: background_removal_only`, background-removal mode/warnings, and
the exact source raw filename/SHA-256. The job exposes
`background_removed_provider_output_url`.

The pre-calibration Subject Count report and fixed-region staging reuse this
same in-memory background-removal result; the strict path does not independently
remove the same background a second time. The later low-resolution processing
may still perform deterministic alpha cleanup, but it must not substitute a
new matte-removal input or change the saved full-resolution artifact.

The rejected enclosed-light-component cleanup is not part of this protocol and
must not be reachable from strict generation or Preview. Background Matte V2 is
specified separately in `docs/protocols/background-matte-v2.md`. Following the
human acceptance of provenance-bound Preview 07 on 2026-08-10,
`full_sheet_fixed_region_v1` seals and defaults to
`deterministic_pixel_matte_v2`. Strict topdown remains unactivated pending its
separate authoritative Structure and provider-free acceptance gates.

The intermediate PNG remains review evidence for `review_required`, diagnostic,
and released results. A later human-accepted publication copies and revalidates
the same bytes and records their hash in `manual_acceptance.json`. Historical
immutable Jobs created before this contract are not rewritten and may not have
this file.

For an existing saved Provider image, the repository-native provider-free
preview entry is:

```bash
npm run character-pack -- background-remove-preview \
  --input <raw-provider-image> \
  --output-dir <output-root> \
  --job-id <new-preview-id>
```

It is a repository CLI entry, not an HTTP API. It writes
`background_removed_provider_output.png` at the input dimensions plus
`background_removal_preview.json`, returns `preview_ready`, and defaults to the
formal `deterministic_pixel_matte_v2` recipe. V2 also writes the frozen Mask,
quality/review, six-background, Spill, Alpha, and reconstruction evidence
defined by `docs/protocols/background-matte-v2.md`. The report binds the exact
file hashes and the complete zero-Provider/zero-network resource contract.
Artifact URLs are derived from the actual preview directory: output beneath the
repository `generated/` root uses its resolvable `/generated/...` route, while
an explicitly selected local output root uses exact `file:` URLs.
The entry performs no resize, Provider request, release, human-decision
mutation, or source-Job mutation. It rejects oversized/multi-frame input,
unknown or unsupported paired modes, and reuse of an existing preview
directory before writing output.

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
- Writes the selected Provider response unchanged as
  `raw_provider_output.<ext>`; this is the pre-background-removal image, while
  `source.png` remains the processed production source.
- For fixed-region generation, also writes the full-resolution transparent
  `background_removed_provider_output.png` before the independent resize and
  calibration stage.
- `generation.json.candidate_selection` records all candidate scores and the
  diagnostic and release-selected candidates.
- Legacy requests retain their existing automatic release policy. Strict
  full-sheet Profiles retain all Validation, Source Quality, Quality Closure,
  and Subject Count evidence but finish as `review_required`; ZIP/engine
  artifacts remain unpublished until an explicit human acceptance. No UI is
  added; the provider-free manual acceptance route described below persists the
  decision and publishes a new immutable artifact directory.

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

Strict full-sheet Profiles always select the exact reviewed Gemini Native
Preset, so fallback is disabled even when the legacy default route has fallback
configured.

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

Ranking, review, and release are separate. For strict `full_sheet_*` Profiles:

- a successful Provider response plus successful local processing produces
  `status: done`, `artifact_disposition: review_required`,
  `manual_review_required: true`, `human_decision_status: pending`, and
  `release_ready: false`;
- Validation, Source Quality, Quality Closure, and Subject Count classifications
  are `automated_review_findings` and visual review artifacts, not acceptance or
  rejection decisions;
- the system preserves the source, normalized Sheet, reports, Overlays, prompt,
  exact raw Provider image, generation evidence, and inspection previews
  without exposing release ZIPs;
- only an explicit human decision may accept the candidate. Until a formal
  acceptance record exists, the candidate remains `review_required`; formal
  rejection is deferred;
- Provider/route failure, sealed Review mismatch, undecodable output, processing
  exceptions, and missing or malformed mandatory review evidence remain
  execution failures.

### Provider-free manual acceptance

`POST /api/generate-character/:jobId/accept` is the formal human acceptance
entry for a strict `full_sheet_*` result. The common body is:

```json
{
  "confirmManualAcceptance": true,
  "expectedPlanHash": "<64 hex characters>",
  "expectedReferenceManifestSha256": "<64 hex characters>",
  "expectedRawProviderOutputSha256": "<64 hex characters>",
  "expectedSourceSha256": "<64 hex characters>",
  "expectedNormalizedSheetSha256": "<64 hex characters>",
  "humanReviewedIssueCount": 0
}
```

When `generation.json.background_removed_provider_output` is present, the
request must additionally include:

```json
{
  "expectedBackgroundRemovedProviderOutputSha256": "<64 hex characters>"
}
```

The field is therefore mandatory for new fixed-region Jobs that declare the
full-resolution intermediate. It must be omitted or `null` for topdown Jobs,
which do not create this fixed-region staging artifact, and for immutable
historical Jobs created before the staged-artifact contract.

The route is provider-free and always reports a Provider call budget of zero.
It accepts only a complete `review_required` candidate with one successful
sealed live attempt and intact mandatory evidence. The original Review package
is reopened so its Plan, Reference Manifest, Prompt text/hash, Profile, and
Provider bindings remain authoritative. Exact raw Provider bytes,
full-resolution background-removed PNG for new fixed-region Jobs, processed
source, normalized Sheet, and their hashes must all match the human-reviewed
values. A sealed V2 Profile requires the full-resolution output and eleven-file
evidence set even if `generation.json` is missing its self-declaration.

Acceptance never mutates the source Job. The server deterministically rebuilds
the release packages from the saved `source.png`, verifies that rebuilt source
and normalized image hashes are byte-for-byte identical to the reviewed
artifacts, and writes a new single-assignment directory named
`accepted_v1_<sourceJobId>`. The new release contains
`manual_acceptance.json`, an accepted `generation_release_gate.json`, the exact
raw Provider image and Prompt, and the ordinary Character Pack and engine ZIPs.
The acceptance manifest records the Prompt hash and each engine ZIP's exact
SHA-256 and byte length. Automated findings remain evidence; they are not
rewritten as human judgements.

The complete publication is written under a unique staging id and atomically
renamed only after every file and package succeeds. Same-Job acceptance is
serialized in-process, so concurrent identical requests resolve to one new
publication and one verified idempotent response; a partial staging directory
is never treated as accepted output.

Repeating the same acceptance is idempotent only after the original Review,
standalone and zipped Prompt, Character Pack, every engine ZIP, and any V2
standalone/ZIP copy are revalidated. A different decision count, stale hash,
changed artifact, malformed evidence, or conflicting publication fails closed
and consumes zero Provider calls. This contract implements acceptance only; it
does not add an automatic decision, UI, rejection workflow, retry, or new
generation call.

Legacy generation and Quality Character retain their existing ranking and
automatic gate behavior:

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

For legacy `production_sheet_v0` requests without a strict `full_sheet_*`
Profile, policy `strict_live_generation_v1` keeps its existing automatic
release behavior: validation must be clean `pass`; fixed-region source quality
must be clean `pass`; and
quality closure must use mode `character_frame_quality_closure_v1`, have clean
`pass` status, set `release_ready` true, and contain exactly one passing gate
for each canonical id: `background_halo`, `alignment_consistency`,
`motion_consistency`, and `prop_side_consistency`. Non-fixed layouts record
source quality as not applicable. Missing or unsupported closure mode, empty,
duplicate, incomplete, or non-passing gate evidence, and all other missing
required evidence fail closed.

For strict `full_sheet_*` Profiles, non-passing but well-formed visual evidence
is recorded only in `automated_review_findings`. Missing, duplicate, invalid,
or unsupported mandatory evidence remains an execution-integrity failure.

Strict full-sheet Profiles additionally require `subject_count_gate_v1` at the
background-processed pre-calibration source, calibrated source, and normalized
frame stages. `blocked`, `needs_review`, and `empty` are heuristic severity
labels shown to the human reviewer; they do not produce
`failed_quality_gate`, prevent a later human acceptance, or start repair.
Allowed equipment edge contact remains a lower-severity advisory. The
Provider-free reports and overlays are written as:

```text
source_subject_count_report.json
source_subject_count_overlay.png
normalized_subject_count_report.json
normalized_subject_count_overlay.png
```

The gate may publish `suggested_region_keys` for the existing three-atlas
action-repair flow, but it never submits a repair, expands a selection, decides
the image is good or bad, or claims semantic identity verification.

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
