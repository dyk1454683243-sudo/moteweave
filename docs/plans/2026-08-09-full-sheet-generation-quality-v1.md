# Full-Sheet Generation Quality V1 + Background Matte V2

**Status:** Fixed-region implemented; Background Matte V2 is active by default
only for `full_sheet_fixed_region_v1` after explicit provider-free human
acceptance of Preview 07 on 2026-08-10. Strict topdown remains gated pending an
authoritative Structure.
**Branch:** `codex/full-sheet-generation-quality-v1-clean`
**Baseline:** `origin/main` at `6df23e5`; clean replay of the 22 plan commits,
excluding the mixed Carbon UI and unrelated action-repair history from the
superseded branch

## Outcome

Provide a strict, reviewable, one-call full-sheet generation contract for each
maintained character source layout while preserving the existing three-atlas
action repair as the only repair technology. A layout is callable only after
its authoritative exact-outline Structure has been approved.

This plan does not authorize a live Provider call and does not change UI. The
Background Matte V2 work through provider-free human inspection has a fixed
external-resource budget of zero Provider calls, zero network requests, zero
model downloads, and zero external matte engines. It
does not restore local reprocessing, drawing tools, masked single-frame AI, the
retired multi-case repair path, automatic repair, candidate feedback, retry,
fallback, or a second repair API.

## Product Boundaries

- One Provider call produces one complete Sheet.
- `full_sheet_fixed_region_v1` is callable through its strict Gemini Native
  Profile over `production_sheet_v0`; `full_sheet_topdown_v1` remains
  registered but its Review is blocked until an authoritative Structure is
  approved.
- Requests without a Profile retain their legacy semantics.
- Pixel Grid P0 remains deterministic post-processing with regression coverage.
  Existing Background P0 remains the legacy baseline; V2 became the strict
  fixed-region preprocessing default only after provider-free human acceptance.
- Both layouts continue through the same Identity Anchor, Pose Guide, Empty
  Output, Review, scoped extraction, and explicit Accept repair contract.
- Subject Count can suggest region keys but cannot invoke or expand repair.
- Capability and semantic identity remain review truths; a local heuristic must
  not claim that identity is verified.
- All automated visual analysis is review evidence only. A successfully
  generated and processed strict Sheet enters `review_required`; automation
  cannot accept or reject its visual and semantic quality. The current product
  persists explicit acceptance only; Reject is deferred.
- Exact Provider output bytes are written as `raw_provider_output.<ext>` before
  background removal or calibration, with URL, MIME, dimensions, byte length,
  and SHA-256 evidence; `source.png` remains explicitly derived.
- Fixed-region background removal is reviewable before resizing: the decoded
  Provider image is background-isolated once at its original dimensions and
  saved as `background_removed_provider_output.png`; Subject Count and the
  later 256/252 staging path reuse that same result.
- A saved raw Provider image can be inspected through the provider-free
  `background-remove-preview` CLI without resizing, publishing, or mutating its
  source Job.

## Background Matte V2 Scope

Background Matte V2 is deterministic preprocessing, not a second repair
technology. Its normative algorithm, immutable mutation masks, evidence, and
failure semantics are defined by
`docs/protocols/background-matte-v2.md`. This Full-Sheet plan remains the
product and execution contract.

The first release handles only high-confidence flat or near-flat white,
off-white, black, gray, or single-color backgrounds. Checkerboard and complex
backgrounds are deferred. Unknown, complex, or low-confidence automatic input
is returned unchanged with review evidence; it never falls back automatically
to a legacy algorithm. Legacy flood and edge-palette algorithms run only when
explicitly selected.

| Path | V2 policy | Release policy |
|---|---|---|
| `full_sheet_fixed_region_v1` | active by default after provider-free human acceptance of Preview 07; the sealed Review records the V2 recipe | existing `done + review_required`, followed by the existing manual Accept |
| `background-remove-preview` | formal provider-free V2 inspection entry | `preview_ready`; diagnostic artifacts only |
| legacy generation | legacy `auto` meaning unchanged; explicit legacy modes retained | existing release semantics |
| Quality Character | default algorithm unchanged | existing release semantics |
| ordinary upload | mode/parameter binding and Alpha provenance only | existing release semantics |
| strict topdown | not enabled for V2 in this phase | authoritative Structure gate remains |
| Motion Source and three-atlas repair | unchanged | existing contracts remain |

Implementation proceeds in these bounded phases:

1. Remove the rejected enclosed-light-component heuristic without reverting
   Raw output, full-resolution intermediate, split resize, Preview, or Accept.
2. Canonicalize mode/parameter binding and Alpha provenance while preserving
   Profile-specific and legacy defaults.
3. Freeze Sure Background, Unknown Band, Sure Foreground, and Allowed Mutation
   masks from immutable decoded RGBA before any pixel mutation.
4. Apply the fixed Oklab analysis, linear-RGB Alpha solve, and foreground RGB
   reconstruction contract for high-confidence flat backgrounds.
5. Publish background quality, review, contract-mask, preview, and spill
   evidence without creating a second human-decision state.
6. Run guarded synthetic and saved-Raw provider-free validation. Switch the
   strict fixed-region Profile default only after the human user accepts the
   actual preview evidence.

External-resource accounting for every phase is immutable:

```yaml
estimated_provider_calls: 0
max_provider_calls: 0
provider_calls_used: 0
network_requests_allowed: false
model_downloads_allowed: false
external_matte_engines_allowed: false
```

## Strict Generation Profiles

Both Profiles seal:

```text
mode                 production_sheet_v0
route                google_native
provider             gemini
aspect ratio         1:1
provider image size  2K
reference size       1024x1024
candidate count      1
max provider calls   1
automatic retry      false
provider fallback    false
model fallback       false
identity reference   optional strong authority
subject gate         subject_count_gate_v1
```

Unknown Profile or explicit Preset ids fail instead of falling back.

## Provider-free Review Contract

`POST /api/generate-character/review` builds the exact pre-call package and
uses zero Provider calls. It persists:

- actual System Instruction and ordered task sections;
- actual derived Structure, optional Identity, and optional Palette PNGs;
- Profile, exact Provider Preset, route, model, image settings, and call budget;
- `generation_request_manifest.json`;
- `generation_reference_manifest.json`;
- stable Plan Hash and Reference Manifest Hash;
- `estimated_provider_calls: 1` and `provider_calls_used: 0`.

A live Profile request must include `generationProfileId`, `reviewedRunId`, both
expected hashes, `confirmLiveGeneration: true`, and `maxProviderCalls: 1`.
The server validates the sealed package before queueing and again immediately
before generation. It sends the saved text and saved derived images. A stale
hash, changed Profile, Preset, model, option, prompt input, image, or saved byte
fails before the call.

Provider attempt evidence records sequence, Provider, neutral route kind,
Preset, model, status, and budget before/after without exposing an API key.

## Prompt And Reference Roles

Prompt contract `character_prompt_contract_v1_18` enforces:

- one character identity across the whole Sheet;
- Structure controls layout, slot, pose, facing, proportion, scale, spacing,
  and baseline only;
- Identity, when present, is the sole appearance authority;
- structured text is the sole identity authority when Identity is absent;
- Palette is a pure-swatch finish guide only;
- the written Equipment Policy has final priority;
- each required slot contains one complete subject and no second person, extra
  head, duplicate, person fragment, or template-character mixture.

The Gemini Native request order is System Instruction, Task, Structure text and
image, Identity text and optional image, Palette text and optional image, then
the final Output Contract.

Reference derivation is local and provenance-preserving:

- Structure uses only a sealed layout-specific authoritative exact-outline
  reference. Fixed-region 252px input is color-remapped without changing alpha
  geometry, padded to 256px on the right and bottom, then resized
  nearest-neighbor. Generic block/robot placeholders, cross-layout
  substitution, and locally synthesized guides are forbidden. Until an
  authoritative topdown Structure is approved, its strict Review fails before
  Provider dispatch with zero calls.
- Identity is background-isolated, alpha-bbox cropped, and placed once on a
  transparent board. Unreliable or multi-subject inputs fail before a call.
- Palette is extracted into pure color blocks with no source silhouette.
- Manifests keep both original-input and derived-image hashes. Derived boards
  are labeled as derived artifacts, never user originals.

## Subject Count And Release

`subject_count_gate_v1` runs after background processing before calibration,
after calibration, and on normalized frames. It uses alpha-thresholded
8-neighbor components without global morphology. It distinguishes small, thin,
and low-fill equipment from person-scale second components, records action
contour anomalies, and never mutates input pixels.

Formal outputs are the source and normalized JSON reports and colored Overlay
PNGs defined by `docs/protocols/subject-count-gate-v1.md`.

`blocked`, `needs_review`, and `empty` are retained as detector severity labels,
not candidate decisions. Subject Count, missing-slot, layout, crop, action,
equipment, Validation, Source Quality, and Quality Closure findings remain
visible in reports and Overlays, but they do not turn a successfully processed
strict Sheet into `failed_quality_gate` and do not decide Ready. The candidate
is stored as `review_required`, with `release_ready: false`, until an explicit
human decision. Minor pose or weapon-hold differences do not automatically
become repair targets.

The existing provider-free
`POST /api/generate-character/:jobId/accept` endpoint is the sole human
acceptance authority. It persists `manual_acceptance.json` and publishes a new
immutable accepted directory without mutating the source Job. The current
formal transition is `pending -> accepted`; Reject and UI remain deferred.
Background review evidence may recommend inspection but cannot record an
acceptance or rejection state.

Provider failure, sealed-Review mismatch, undecodable output, processing
exceptions, or missing/malformed mandatory review evidence remain execution
integrity failures and may fail automatically. This boundary does not convert
uncertain images into automatic passes.

Rejected or unaccepted images may be used only for explicit Provider-free
diagnosis and never as an input, baseline, repair source, or Provider feedback.

## Sole Repair Path

No new repair endpoint is added. The formal endpoints remain:

```text
POST /api/repair-character-action
POST /api/editor/.../action-repair/:jobId/accept
```

Single-slot, single-action, and multi-slot selections all use the same
three-atlas contract. The candidate remains review-only until explicit Accept,
and selected-region patching must preserve every unselected source pixel.

## Implementation Surface

- `src/character-pack/generationProfiles.js`
- `src/character-pack/generationReferenceBoards.js`
- `src/character-pack/generationReview.js`
- `src/character-pack/subjectCountGate.js`
- `src/character-pack/backgroundMatteV2.js`
- background mode/provenance, preview, artifact-manifest, and focused test
  updates required by `docs/protocols/background-matte-v2.md`
- prompt, Provider adapter/config, generation, release-gate, process, manifest,
  server routing, and focused test updates required to connect those modules.

No UI layout, Editor UI, or HTML file belongs to this plan. An existing UI
control may be touched only if its request binding is demonstrably wrong; no
new control or product surface is authorized.

## Completion Gates

Provider-free focused tests must prove Profile immutability, exact Preset
selection, Review hashes and reference order, optional Identity behavior,
three-tone Structure, single-subject Identity, swatch-only Palette, Gemini
System Instruction/interleaving, call budget, Subject Count thresholds,
non-mutation, advisory equipment, and that automated visual findings produce
`review_required` rather than automatic acceptance or rejection. Ready remains
reserved for explicit human acceptance through the existing manual-acceptance
contract.

Background Matte V2 focused tests must prove immutable pre-mutation Mask hashes,
zero Sure Foreground mutation, zero out-of-scope mutation, complete pixel
classification, transparent RGB zeroing, flat-background removal, preservation
of light foreground details and one-pixel silhouette features outside the exact
approved Fringe predicate, low-confidence passthrough, exterior-background
reachability without crossing dark one-pixel contours, background-supported
clearing of the exact exterior-reachable, Shoulder Singleton, and Fringe
subsets, transparent-black output for every background-supported-clear pixel,
stable Alpha-solver sampling from the complete provisional Sure Foreground
snapshot, independent fail-closed reporting for both unexpectedly visible
exterior pixels and hard-visible background-like Sure Foreground pixels touching
the exterior classification, hard-output
idempotence, legacy-policy isolation, and zero Provider calls. The formal
preview must publish the full-resolution result, six-background review board,
spill overlay, review/quality reports, and contract-mask evidence for a
provenance-bound saved Raw input. The exact formal evidence set remains eleven
files.

Regression coverage must include legacy generation, three-atlas repair,
background P0, and Pixel Grid. Final verification is:

```text
npm test
npm run smoke:local
git diff --check
independent read-only review of Provider Adapter, Review hashes,
Subject Count, Release Gate, and three-atlas boundaries
```

The formal Review endpoint must be exercised for every Profile that has an
approved authoritative Structure, and the saved prompt, reference PNGs, model,
dimensions, hashes, and budget inspected. A Profile without that source must
return a pre-call failure with zero calls used. A future live fixed-region call
and any future topdown call each require separate explicit authorization;
failure never triggers retry or model/route substitution.

UI work is a separate Figma-first task after backend acceptance. No production
UI changes are allowed until that design is reviewed and approved.

## Verification Record

Initial Provider-free implementation completed on 2026-08-09:

- guarded focused regression: 132 tests passed;
- guarded full `npm test`: exit 0, peak process-tree RSS 827552 KiB;
- guarded `npm run smoke:local`: exit 0, including exclusive three-atlas
  repair wiring and absence of retired repair runtimes;
- `git diff --check`: clean;
- independent read-only review: no remaining P0/P1;
- formal fixed-region Review run `full_sheet_fixed_review_v1_20260809_02`:
  Plan Hash `631fd4a07fec3d4fe8189649aa6df542290a82fca5019694870e91d9d344f7b4`;
- the former topdown Review
  `full_sheet_topdown_review_v1_20260809_02` used a generic robot placeholder
  and is explicitly invalidated as acceptance evidence; the current strict
  entry rejects that input before Provider dispatch with zero calls.

Subsequent user-authorized fixed-region live evidence:

- sealed Review `full_sheet_fixed_review_v1_20260809_03` dispatched exactly one
  Gemini Native call to `gemini-3.1-flash-image-preview`;
- job `job_mslctyff_c1wbcp` recorded Provider success and budget `1/1`;
- the immutable historical job used the then-current automatic policy and
  recorded `failed_quality_gate` after heuristic findings; it is not rewritten;
- the later human-decision policy changes future successfully processed strict
  Sheets to `done + review_required`, while retaining the same reports and
  preventing automatic release.

Human-decision policy verification on 2026-08-09:

- guarded focused regression: 66 tests passed;
- guarded full `npm test`: 995 tests passed, exit 0, peak process-tree RSS
  833424 KiB;
- guarded `npm run smoke:local`: exit 0, peak process-tree RSS 726112 KiB;
- Provider-free projection of historical job `job_mslctyff_c1wbcp`: detector
  status `needs_review`, `manual_review_required: true`, human decision
  `pending`, zero integrity blockers, and zero added Provider calls;
- independent implementation and documentation review: no remaining P0/P1.

Raw Provider output preservation added on 2026-08-09:

- strict live generation writes the exact single Provider response before any
  background or layout processing;
- the final writer verifies the prewritten bytes and rejects mismatches rather
  than replacing the original;
- Provider-free focused coverage verifies raw byte identity, direct job URL,
  MIME, SHA-256, byte length, and write-before-process ordering.
- guarded related regression: 52 tests passed;
- guarded full `npm test`: 997 tests passed, exit 0, peak process-tree RSS
  822752 KiB;
- guarded `npm run smoke:local`: exit 0, peak process-tree RSS 685408 KiB;
- external Provider calls used by this implementation and verification: 0.

Background Matte V2 provider-free implementation verified on 2026-08-10:

- the rejected enclosed-component heuristic is no longer reachable; V2 uses
  frozen pre-mutation Masks, deterministic linear-RGB Alpha/foreground solving,
  low-confidence preservation, and an idempotent Hard Alpha stage;
- the formal CLI Preview publishes the exact eleven-file evidence set with a
  complete zero-resource contract, exact hashes, and URLs bound to its actual
  Artifact directory;
- existing manual Accept adds no request field or decision state. It validates
  V2 evidence against the exact source Job, deterministically rebuilds all
  eleven files from the bound Raw, preserves byte-identical standalone and
  Character Pack ZIP copies, and revalidates them on idempotent replay;
- guarded focused regression: 90 tests passed for V2/CLI and 26 tests passed for
  V2 evidence, generation review, and manual Accept integration; the final
  deterministic-replay repair passed a six-test evidence/Accept regression;
- guarded full `npm test`: 1041 tests passed, exit 0, peak process-tree RSS
  823824 KiB;
- guarded `npm run smoke:local`: exit 0, peak process-tree RSS 715664 KiB;
- `git diff --check`: clean, and independent algorithm, CLI, Artifact, Accept,
  and documentation reviews found no remaining P0/P1;
- Provider calls, network requests, model downloads, and external matte engines
  used by this implementation and verification: 0.

The first provenance-bound human sample did not satisfy the gate on 2026-08-10:

- the user supplied the authoritative 2048 x 2048 JPEG Raw at
  `$HOME/Library/Containers/at.EternalStorms.Yoink/Data/Documents/YoinkPromisedFiles.noIndex/yoinkFilePromiseCreationFolder146A6B97-440D-43B8-9B4F-F02C7063E240/add146A6B97-440D-43B8-9B4F-F02C7063E240/download.jpg`;
- Raw file SHA-256:
  `650242a5e15d3fc02bae1fe91987ea747754ba255ecf94c00b6fc9b35df573ef`;
- formal provider-free Preview run
  `background_matte_v2_fixed_region_raw_20260810_01` retained the original
  dimensions and produced the exact eleven-file evidence set under
  `generated/background-matte-v2-human-review/`;
- automated evidence reported `4,860` low-confidence Unknown Band pixels and
  `4,396` possible spill pixels. A bounded read-only pixel audit found `7,314`
  visible near-neutral white residual pixels across `1,642` small components:
  `4,483` were in Unknown Band and `2,831` had been frozen into Sure
  Foreground. A later user-supplied black-background visual target proved that
  this color-only split cannot label all `2,831` Sure Foreground pixels as
  defects: `2,140` target near-white pixels are intentional eyes/highlights or
  other preserved details. The verified defect remains the large population of
  exterior-background white specks. The target is visual review evidence only;
  its opaque black pixels and derived masks must never enter Matte execution;
- the approved minimal correction stays within Matte V2. It adds strong/weak
  4-neighbor exterior reachability before Mask freeze, moves only externally
  reachable weak background candidates into Unknown, clears that exact
  background-supported subset, preserves all non-exterior low-confidence pixels,
  and fails closed to `needs_review` when exterior-background-like pixels remain.
  It does not add a V3, component deletion, external Matte, twelfth Artifact, or
  Profile activation;
- the user explicitly withdrew the earlier conversational acceptance. The
  Preview remains rejected diagnostic evidence: it is not an accepted baseline,
  generation reference, repair input, or activation authority;
- strict fixed-region V2 is not active. A corrected provider-free run over the
  same provenance-bound Raw must pass a new human review before activation;
- Provider calls, API calls, network requests, model downloads, and external
  matte engines used by the Preview and rejection handling: 0;
- guarded rejection-handling regression: 35 focused tests and 1,041 full-suite
  tests passed; `npm run smoke:local` passed with peak process-tree RSS 696480
  KiB, and `git diff --check` was clean;
- independent read-only review confirmed both the visible-residue diagnosis and
  restoration of the pre-activation strict Profile contract.

The corrected provider-free evidence run is now available for a new human gate:

- the final formal run is
  `background_matte_v2_fixed_region_raw_20260810_04`; it used the same immutable
  Raw, retained `2048 x 2048`, used zero Provider/API/network/model/external
  Matte resources, and left the exact sealed V2 evidence set at eleven files;
- the output SHA-256 is
  `eac677bc26c24eb9e542da98ce33e9a226dc367b4f3f7f9cc61be5b242c73c5a`.
  Strong/weak exterior reachability cleared `25,686` background-supported
  Unknown pixels while preserving all non-exterior low-confidence pixels and
  changing zero Sure Foreground pixels;
- the independent visible-residue gate reports `628` conservative Sure
  Foreground review candidates across `151` 8-connected components. It includes
  all five confirmed background white specks, overlaps none of the `2,347`
  protected-light pixels, and never mutates its candidates. Target comparison
  remains post-run audit only and never enters the Matte;
- the output still contains those five confirmed single-pixel specks. Therefore
  automated quality correctly remains `needs_review`, this Preview is not an
  accepted baseline, and strict fixed-region V2 remains inactive pending the
  user's explicit review decision;
- guarded verification after the final evidence repair passed `36/36` affected
  focused tests, `1045/1045` full-suite tests, and `npm run smoke:local`.
  Independent read-only review reported no remaining P0, P1, or P2 finding.

The user approved one further minimal V2 classification refinement for Preview
05 after the five remaining specks were traced to source colors immediately
outside the fixed weak ceiling:

- the strong/core and weak/exterior 4-neighbor floods remain unchanged;
- `shoulderDistance` is derived only from existing evidence as
  `min(spillDistance, weakDistance + backgroundP95)`;
- a complete provisional Sure Foreground snapshot supplies source pixels above
  the weak distance and at or below that adaptive Shoulder distance. Only an
  8-connected one-pixel component with at least two neighbors in the unchanged
  base Exterior candidate Mask is reclassified into Unknown;
- the decision is one-shot and nonrecursive. It does not use the review target,
  coordinates, the processed output, a new color threshold, a component
  deletion pass, or the post-output residue detector;
- the selected Shoulder subset joins `background_supported_clear`, is recorded
  inside the existing JSON and Spill Overlay, and does not create a twelfth
  evidence Artifact or a new human-decision state;
- Alpha estimation uses a separately frozen sampling-only authority equal to
  the complete provisional Sure Foreground snapshot, with the enforced identity
  `final Sure Foreground UNION exterior_shoulder_singleton`. This prevents the
  one-shot classification from perturbing neighboring Unknown solves without
  changing the four contract Masks or mutation authority;
- strict fixed-region V2 remains inactive until a newer formal provider-free
  Preview is generated from the same immutable Raw and the user explicitly
  accepts its displayed evidence.

The first formal Shoulder run, Preview 05, is superseded diagnostic evidence:
its ten selected Shoulder pixels were correctly cleared, but removing those
pixels from the Alpha solver's foreground sample set also changed twelve
neighboring Unknown solves. It must not be presented for human acceptance or
used as strict activation authority. Preview 06 must prove that its decoded
output differs from Preview 04 at exactly the selected Shoulder pixels.

Corrected provider-free Preview 06 passed that gate on 2026-08-10:

- the formal job is `background_matte_v2_fixed_region_raw_20260810_06` under
  `generated/background-matte-v2-human-review/`; it used the same immutable Raw
  with file SHA-256
  `650242a5e15d3fc02bae1fe91987ea747754ba255ecf94c00b6fc9b35df573ef`,
  retained `2048 x 2048`, and published exactly the sealed eleven-file evidence
  set plus the auxiliary CLI receipt;
- output file SHA-256 is
  `c7ff0dcaf675123e538c9444e4e9128153527f605e8509112f94dd5c8e442f91`.
  Preview 04 to Preview 06 decoded RGBA differs at exactly the ten selected
  Shoulder pixels, all ten become transparent black, and no other output pixel
  changes;
- Alpha Estimate and Foreground Reconstruction are byte-identical to Preview
  04. Solved-Unknown and low-confidence Mask hashes are also unchanged. The
  frozen sampling authority is exactly the Preview 04 Sure Foreground snapshot;
- all five confirmed background specks become transparent. All `2,347`
  protected-light pixels, the target's `2,140` near-white details, its `68`
  unprotected near-white details, and both reviewed real single-pixel highlights
  remain visible and unchanged. The target was used only after formal execution
  for read-only audit;
- Scope and Alpha Integrity pass. Automated status remains `needs_review` for
  `618` conservative visible-background candidates and `632` possible-spill
  diagnostics, so Preview 06 is not accepted and strict V2 remains inactive;
- guarded verification passed `110/110` directly affected tests, the full
  `npm test`, and `npm run smoke:local`. Independent read-only code and Artifact
  reviews found no P0, P1, or P2;
- Provider calls, API calls, network requests, model downloads, and external
  Matte engines used by Preview 06 and its verification: `0`.

The user explicitly rejected Preview 06 after visual inspection still found
white specks. Passing the technical evidence gates did not satisfy the human
quality gate. Preview 06 remains isolated diagnostic evidence and is not an
accepted baseline, generation reference, repair input, or strict activation
authority.

A bounded post-run audit then proved that the sealed Preview 06 visible-residue
set contains exactly `618` immutable-Raw pixels. Against the audit-only visual
target, `617` map to audit-target background and one maps to real skin foreground
at `(719,824)`. All 618 satisfy the same source-only predicate:

```text
complete provisional Sure Foreground
AND source Alpha >= hard threshold
AND shoulderDistance < Raw-to-background Oklab distance <= spillDistance
AND at least one 8-neighbor in the unchanged base Exterior candidate Mask
```

The target and coordinate were used only for post-run audit labeling;
they are forbidden as algorithm inputs, test fixtures, thresholds, or runtime
branches. On 2026-08-10 the user explicitly approved a clean-first revision that
hard-clears all 618 predicate matches, including the known one-pixel skin loss
and the cyan-marked foreground pixel. The implementation must:

- derive `exterior_fringe_hard_clear` from immutable Raw and the complete
  provisional Sure Foreground snapshot before the four contract Masks freeze;
- select pixels independently with no component-size veto, using the existing
  `(shoulderDistance, spillDistance]` interval and at least one 8-neighbor in
  the unchanged base Exterior Mask;
- remain one-shot and nonrecursive, with selected Fringe pixels never becoming
  flood or refinement seeds;
- add Fringe to Unknown and to the disjoint `background_supported_clear` union,
  while keeping Alpha sampling bound to the complete provisional snapshot with
  identity `final Sure Foreground UNION exterior_shoulder_singleton UNION
  exterior_fringe_hard_clear`;
- require every background-supported-clear output pixel to be transparent
  black, publish Fringe count, canonical Mask hash, bounds, and Overlay evidence
  inside the existing eleven Artifacts, and leave all pixels outside the exact
  approved predicate under the prior preservation contract.

This is an explicit, Raw-specific acceptance of one known foreground-pixel loss,
not a general permission to clear other foreground or weaken the Scope gate.
Provider/API calls, network requests, model downloads, and external Matte
engines remain fixed at zero. Strict fixed-region V2 stays inactive until a new
formal provider-free Preview from the same immutable Raw passes technical audit
and the user explicitly accepts its displayed evidence.

Formal clean-first Preview 07 was generated and independently audited on
2026-08-10:

- the formal job is `background_matte_v2_fixed_region_raw_20260810_07` under
  `generated/background-matte-v2-human-review/`; it retained `2048 x 2048`,
  published exactly eleven sealed Artifacts plus the auxiliary receipt, and used
  zero Provider/API/network/model/external-Matte resources;
- the Raw file SHA-256 remains
  `650242a5e15d3fc02bae1fe91987ea747754ba255ecf94c00b6fc9b35df573ef`;
  output file SHA-256 is
  `8601f6281deda65afaa86b74a05c61fa62294b5ef7db13d545da6dc184630161`;
- Preview 06 to Preview 07 decoded RGBA differs at exactly `618` pixels. The
  change set exactly equals `exterior_fringe_hard_clear`, whose canonical Mask
  SHA-256 is
  `fe86a60520b53035256ad15db172d7af5429d308306c11267cd26d00a4e4c8c0`;
  all 618 become transparent black and no pixel outside that Mask changes;
- post-run target labeling confirms `617` selected pixels on audit-target
  background and the one explicitly accepted foreground pixel `(719,824)`.
  The target and coordinate did not participate in Matte execution or
  pre-mutation classification;
- the sampling authority remains `1,465,136` pixels with SHA-256
  `aed601e14abcd558b0ae9b8d92da228750471f49846ba8fa87c0e78cd825a032`.
  Alpha Estimate and Foreground Reconstruction are byte-identical to Preview 06,
  and solved/low-confidence Mask semantics remain unchanged;
- Scope and Alpha Integrity pass. The formal visible-residue detector reports
  zero pixels and zero components; possible-spill diagnostics fall to `14`.
  A broader audit-only target-background/light-color heuristic still flags `60`
  pixels, so this run enters visual inspection rather than automatic acceptance;
- guarded focused verification passed `41/41` algorithm/evidence tests, `4/4`
  formal Preview CLI tests, and `32/32` background-policy/Profile/Review/runtime
  isolation tests. Independent code review found no P0, P1, or P2;
- the user explicitly accepted Preview 07 after inspecting the displayed Raw,
  full-size output, six-base board, Spill Overlay, and Mask evidence. That
  acceptance satisfies the provider-free activation gate for this exact
  provenance-bound method and Raw.

Following that acceptance, only `full_sheet_fixed_region_v1` seals and defaults
to `deterministic_pixel_matte_v2`. Strict topdown remains unactivated pending
its separate authoritative Structure gate. Legacy generation, ordinary upload,
Quality Character, Prompt source, Provider Adapter, Motion Source, and the
three-atlas repair workflow retain their prior contracts. The accepted Preview
does not automatically accept any future generated Sheet: each strict job still
finishes `done + review_required` and uses the existing manual Accept flow.

Fixed-region activation verification completed on 2026-08-10:

- guarded activation-focused regression passed `63/63` tests; a further
  dependency-boundary reproducer covering the formal CLI, lossy JPEG Matte
  evidence, and process guards passed `85/85` tests;
- guarded full `npm test` passed `1059/1059`, exit 0, with peak process-tree RSS
  `813584 KiB`;
- guarded `npm run smoke:local` passed, exit 0, with peak process-tree RSS
  `714992 KiB`;
- independent read-only activation review found no P0/P1 after restoring the
  Provider-preflight URL assertion and disabling legacy connected-matte during
  V2 fixed-region calibration;
- Provider calls, API calls, network requests, model downloads, and external
  Matte engines used by activation and verification: `0`.

PR #34 merge-readiness integrity review completed on 2026-08-10:

- Review verification and the one permitted Provider dispatch now consume one
  immutable environment snapshot. Canonical Gemini Native endpoints remain
  bound to the sealed Preset model, including optional trailing slashes and
  `models/`-prefixed model ids; malformed full endpoints fail before dispatch;
- Raw Provider MIME evidence keeps declared and byte-detected values separate.
  A missing Provider declaration remains `null` rather than being reported as
  a declared PNG;
- manual Accept reopens the sealed Review package and verifies the request,
  reference manifest, Prompt, and every referenced PNG byte hash. It applies
  the Background Matte evidence policy from the sealed Profile snapshot, so
  historical pre-V2 fixed-region Jobs remain valid while the current V2 Profile
  fails closed on missing evidence;
- manual acceptance seals the exact static standalone release manifest and the
  exact static Character Pack entry set as sorted filename, SHA-256, and byte-
  length tables. The three engine ZIP records are cross-bound to their
  standalone release entries, and the non-generation projection of
  `metadata.json` has its own SHA-256;
- idempotent replay rechecks every sealed standalone file, validates all ZIP
  CRCs and the exact Character Pack entry set, rechecks every sealed static ZIP
  entry, requires the four dynamic acceptance/gate/generation/metadata copies
  to match their standalone bytes, and binds `metadata.generation` to the
  accepted generation evidence;
- the provider-free Preview CLI opens one regular-file handle, rejects inputs
  above `64 MiB` before allocation/read, reuses one immutable Buffer for
  metadata/decode/hash/Matte, and rejects animated or over-budget images before
  creating a Job directory;
- guarded publication-integrity verification passed `31/31`; guarded full
  `npm test` passed `1056/1056`, exit 0, with peak process-tree RSS
  `805568 KiB`; after the final ZIP-directory exact-set repair, its focused
  server regression passed `3/3`; guarded `npm run smoke:local` passed, exit 0,
  with peak process-tree RSS `734128 KiB`;
- independent read-only Provider/CLI and Accept reviews found no remaining P0,
  P1, or P2;
- Provider calls, API calls, model downloads, and external Matte engines used
  by this merge-readiness remediation and verification: `0`.
