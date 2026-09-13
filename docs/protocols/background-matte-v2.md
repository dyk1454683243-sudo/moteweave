# Background Matte V2 Protocol

**Status:** Provider-free implementation active; V2 is the sealed default only
for `full_sheet_fixed_region_v1` after provenance-bound human acceptance of
Preview 07 on 2026-08-10. Preview 05 was superseded because Shoulder
reclassification perturbed neighboring Alpha solves, and Preview 06 was
explicitly rejected for remaining visible white specks. Preview 07 applies the
approved clean-first 618-pixel Fringe hard clear, including the accepted
one-pixel skin loss. Its Scope, Alpha, Artifact, provenance, and zero-resource
gates pass; strict topdown remains gated.

## Purpose And Boundaries

`deterministic_pixel_matte_v2` removes a high-confidence flat or near-flat
background from a decoded RGBA image without a Provider, network request,
downloaded model, or external matte engine. It is preprocessing only. The
three-atlas workflow remains the sole action-repair technology.

The first release supports white, off-white, black, gray, and other single-color
backgrounds. Checkerboard and complex backgrounds are not supported. Automatic
input that is complex, unknown, or low confidence is returned unchanged at the
pixel level as `passthrough_review`; it is not sent to a legacy algorithm.
An input with Alpha zero and nonzero hidden RGB fails the Alpha Integrity gate
instead of being silently changed or published as passthrough.

The formal product paths are strict fixed-region generation after human
approval of provider-free V2 evidence, and `background-remove-preview`, which
is always provider-free and diagnostic. Ordinary upload receives only canonical
option binding and Alpha provenance in this phase. Legacy generation, Quality
Character, strict topdown, Motion Source, and action repair retain their
existing policies. Legacy flood and edge-palette behavior is reachable only
through an explicit legacy mode.

The formal CLI Preview accepts V2/`auto`, Native Alpha, passthrough, and the two
explicit Legacy modes. `dual_matte` is rejected because this single-input entry
has no paired black source; it must never fall back to Flood.

## Canonical Modes And Provenance

External aliases are normalized by one parser. Unknown explicit values fail
closed. The parser distinguishes legacy `auto` from strict/preview V2 selection;
it must not silently reinterpret an unknown value as flood.

Alpha provenance is one of:

```text
opaque
native
provider
staging
deterministic
dual
calibrated
unknown
already_processed
```

Decode evidence records the detected format, dimensions, whether input Alpha is
present and meaningful, and whether the codec is lossy. Requested, canonical,
recipe, parameter, and provenance values are persisted in Debug/Preview
evidence. A strict generated image already processed at full resolution is
marked `already_processed`; downstream stages may only zero RGB under zero
Alpha, measure quality, and apply target-size hard Alpha.

## Background Analysis

Analysis uses immutable decoded RGBA bytes. The edge band is one percent of the
shorter dimension, clamped to 2–32 pixels, with at most 65,536 deterministic
samples. Color distance is computed in Oklab.

A background is eligible only when one cluster covers at least 90 percent of
valid edge samples, at least three corner blocks agree with that cluster, and
the cluster's Oklab P95 distance is at most 0.04. Failure of any condition
produces `passthrough_review`, an unchanged RGBA result, and review reasons. It
does not run V2 or Legacy automatically.

## Immutable Contract Masks

Before any pixel mutation, the implementation freezes exactly four one-byte
per-pixel masks derived from the immutable decoded source:

```text
Sure Background
Unknown Band
Sure Foreground
Allowed Mutation = Sure Background UNION Unknown Band
```

The current classification revision is
`exterior_background_reachability_v1_shoulder_singleton_v1_fringe_hard_clear_v1`.
It derives two 4-neighbor floods and two nonrecursive source-only refinements
from the immutable source before the four contract Masks are frozen:

1. `core_sure_background` starts at the image boundary and accepts only pixels
   within `sureDistance = min(0.04, max(0.012, backgroundP95 * 1.5))` of the
   accepted background model.
2. `exterior_background_candidate` starts from that core and accepts pixels
   within the already-approved analysis ceiling of `0.04`. This is a weak,
   exterior-reachability candidate Mask, not permission to mutate by color
   alone.
3. From the complete provisional Sure Foreground snapshot, derive Shoulder
   candidates whose source Alpha is at least the hard-Alpha threshold, whose
   background distance is greater than the weak distance, and whose distance is
   at most
   `shoulderDistance = min(spillDistance, weakDistance + backgroundP95)`.
   Compute all 8-connected components of that candidate snapshot. Only a
   one-pixel component whose 8-neighbor ring contains at least two pixels from
   the unchanged base `exterior_background_candidate` Mask becomes
   `exterior_shoulder_singleton`. The classification is one-shot and
   nonrecursive: selected pixels never seed either flood or another Shoulder
   decision.
4. From that same complete provisional Sure Foreground snapshot `P`, derive
   `exterior_fringe_hard_clear` pixelwise as
   `P AND hardSourceAlpha AND shoulderDistance < backgroundDistance <=
   spillDistance AND ring8(baseExterior) >= 1`. This range is disjoint from the
   Shoulder range. It has no component-size veto: every pixel must independently
   satisfy the predicate. The classification is one-shot and nonrecursive;
   selected Shoulder or Fringe pixels never seed either flood or another
   decision. The complete provisional snapshot is separately frozen as
   `foreground_sampling_authority`; it is not one of the four contract Masks
   and grants no mutation permission.

Sure Background is `core_sure_background`. Unknown Band is the union of the
existing foreground-side boundary band, whose width is
`clamp(round(sourceScale * 1.25), 2, 16)`, and
`exterior_background_candidate - core_sure_background`, plus
`exterior_shoulder_singleton` and `exterior_fringe_hard_clear`. Every other
pixel is Sure Foreground. The base 4-neighbor floods remain byte-identical;
8-neighbor inspection is limited to the two frozen, one-shot refinements. This
reclassifies JPEG-fragmented exterior background without opening a recursive
path through a non-background contour. Pixels outside the exact Shoulder and
approved Fringe predicates remain Sure Foreground and immutable. Foreground
detail preservation remains mandatory outside that Fringe predicate; for the
provenance-bound Raw used at the human gate, the sole known semantic exception
is the explicitly accepted skin pixel at `(719,824)`.

The derived sampling authority has the mandatory identity
`foreground_sampling_authority = Sure Foreground UNION
exterior_shoulder_singleton UNION exterior_fringe_hard_clear`. It preserves the
pre-reclassification local foreground sample set for Alpha estimation, so the
two one-shot classifications can change only their selected output pixels. It
cannot change the four contract Masks, Allowed Mutation,
background-supported clearing, or Scope authority.

Each Mask hash is SHA-256 over canonical bytes containing width, height, and the
one-byte-per-pixel mask. The source Hash and background-analysis Hash are also
recorded. Scope validation always uses these frozen masks. Any mask derived
after mutation is diagnostic only and cannot prove compliance.

Required integrity conditions are:

```text
sure_foreground_changed_pixels == 0
outside_allowed_mutation_mask_changed_pixels == 0
unclassified_pixel_count == 0
sure_background_remaining_visible_pixels == 0
sure_background_nonzero_rgb_pixels == 0
background_supported_clear_remaining_visible_pixels == 0
background_supported_clear_nonzero_rgb_pixels == 0
```

A Mask, Alpha, Scope, Artifact, or Hash contradiction is an execution failure.

## Deterministic Matte Algorithm

For an eligible flat background, the immutable order is:

```text
Immutable Trimap
-> Alpha Estimation
-> Foreground RGB Reconstruction
```

Sure Background becomes transparent black. Sure Foreground bytes remain
unchanged. Unknown pixels are solved in linear RGB:

1. Search inward for 3–9 samples from the frozen
   `foreground_sampling_authority` within at most twice the Unknown Band radius
   and estimate local foreground color. This authority is the provisional Sure
   Foreground snapshot defined above; selected Shoulder and Fringe pixels remain
   available only for sampling continuity and are still cleared before any
   Alpha solve.
2. For each channel where `abs(F - B) >= 0.05`, solve Alpha from the standard
   foreground-over-background equation.
3. Require at least two valid channels and a channel-estimate MAD no greater
   than 0.10.
4. For a high-confidence solve, clamp Alpha and reconstruct foreground RGB from
   the original composite, estimated background, and solved Alpha.
5. Before mutation, freeze the derived `background_supported_clear` Mask as the
   disjoint union of the exterior-reachable Unknown subset and
   `exterior_shoulder_singleton` and `exterior_fringe_hard_clear`. Exterior
   reachability proves the first subset; the adaptive Shoulder range, one-pixel
   8-component, and at least two base Exterior ring pixels prove the second;
   the approved `(shoulderDistance, spillDistance]` source range and at least
   one base Exterior ring pixel prove the third. These pixels become transparent
   black without being reported as an Alpha solve.
6. For every low-confidence Unknown pixel outside the frozen
   `background_supported_clear` union, including insufficient foreground
   samples, insufficient Alpha channels, or high channel MAD, preserve the
   original RGBA pixel unchanged and record its count and review reason.

The following deterministic accounting identity is mandatory:

```text
unknown.total ==
  unknown.solved +
  unknown.background_supported_cleared +
  unknown.low_confidence
```

The implementation also freezes and hashes `protected_light_foreground`, the
weak-background-color pixels that are not exterior reachable and remain Sure
Foreground. It separately freezes and hashes `exterior_shoulder_singleton`,
including its adaptive distance and nonrecursive component/ring contract. Both
are evidence; neither is derived from the post-mutation output.
It freezes and hashes `exterior_fringe_hard_clear`, including its lower and
upper distance bounds, 8-neighbor base-Exterior support, and one-shot
nonrecursive contract. It is derived only from immutable source and the frozen
pre-mutation classification; the audit target, coordinates, processed output,
and post-output residue detector never participate.
It also freezes and hashes `foreground_sampling_authority` and its identity
with final Sure Foreground plus the Shoulder and Fringe subsets. This
sampling-only Mask is never an output mutation authority.

This contract forbids neighbor-average recoloring, erosion, mask shrink,
enclosed-light deletion, legacy decontamination, external models, and any
allegedly equivalent replacement algorithm.

The full-resolution matte may retain soft Alpha in the Unknown Band. Pixels
with Alpha zero must have RGB `[0,0,0]`. After geometry staging, production
output applies hard Alpha at threshold 0.5 and zeroes transparent RGB again. A
V2 hard-pixel output processed again by V2 must be pixel-identical.
An already hard, transparent-black `0/255` Alpha image therefore takes an
idempotent already-processed branch before edge-background analysis; this
protects characters, weapons, holes, and hair that touch the canvas boundary.

## Evidence

V2 produces:

```text
background_removed_provider_output.png
background_quality.json
background_review.json
background_contract_masks.json
background_preview.png
background_spill_overlay.png
```

Review/debug runs additionally expose Sure Background, Unknown Band, Sure
Foreground, estimated Alpha, and reconstructed Foreground images.
`background_preview.png` is a 2x3 comparison over Checker, White, Black, Gray,
Magenta, and Green.

`background_review.json` contains only recommendation, reasons, confidence,
affected regions, artifact URLs, algorithm id, and artifact Hashes. It must not
contain an acceptance status, human-decision status, acceptance/rejection time,
or a second Accept/Reject protocol.
Its URLs must resolve to the directory that actually contains the sealed
artifacts: `/generated/...` for repository-served output and exact `file:` URLs
for an explicitly selected local CLI output root. Manual Accept binds every
saved URL to the exact source Job prefix; another Job or local directory is an
Artifact Integrity failure.

The complete formal evidence set is exactly:

```text
background_removed_provider_output.png
background_quality.json
background_review.json
background_contract_masks.json
background_preview.png
background_spill_overlay.png
background_sure_background_mask.png
background_unknown_band_mask.png
background_sure_foreground_mask.png
background_alpha_estimate.png
background_foreground_reconstruction.png
```

Generation evidence records filename, MIME type, byte length, and SHA-256 for
all eleven files. Existing manual Accept adds no request field: it revalidates
the sealed list and decoded source/output hashes, reruns the deterministic V2
recipe from the bound Raw, and requires every one of the eleven Artifact bytes
to match that replay. It then preserves the same eleven files in the accepted
directory and Character Pack ZIP. Idempotent replay rechecks the deterministic
result plus both standalone and ZIP copies before returning the existing
publication.

The accepted publication additionally seals sorted filename, SHA-256, and byte-
length tables for every static standalone release file and every static
Character Pack entry. The three engine ZIP records must match their entries in
the standalone table. Because acceptance, gate, generation, and metadata files
contain dynamic acceptance identity, they are not placed in the static tables:
their standalone and ZIP bytes must match exactly on replay, while a separate
SHA-256 seals the canonical `metadata.json` projection without `generation` and
`metadata.generation` must equal the accepted generation evidence. Replay loads
the Character Pack with CRC validation, rejects a missing or extra entry, and
rechecks every sealed static entry before returning `already_accepted`.
`character_pack.zip` itself is excluded from the standalone static table because
an archive cannot contain a hash of its own final bytes.

Spill, lossy-source, low-confidence, and contour-change findings are review
evidence. A lossy decoded source makes automatic quality `needs_review` even
when no visible-background residue remains. The visible-background-residue
detector is deliberately independent from the pixels that the Matte must clear.
Its diagnostic Mask is the union of:

- any still-visible pixel inside `exterior_background_candidate`; and
- any hard-visible Sure Foreground pixel whose immutable Raw color is within
  the existing spill distance of the accepted background and whose 8-neighbor
  ring touches `exterior_background_candidate`.

The hard-visible threshold is the existing hard-Alpha threshold (`128` under
the V2 defaults). The spill distance is the existing boundary diagnostic
distance (`max(0.06, 2 * oklab_p95_max_distance)`, or `0.08` under the V2
defaults). Eight-neighbor inspection is diagnostic only; the authoritative
background floods remain four-neighbor. This detector never expands
`background_supported_clear`, Allowed Mutation, or the pixels modified by the
Matte. It may conservatively flag a real light edge for human review, but it
cannot delete that edge.

The quality report counts visible pixels, hard-visible pixels, 8-connected
components, protected-light overlap, and Sure Background / Unknown / Sure
Foreground buckets. Any reported visible background-like pixel makes the
automatic quality status `needs_review` and blocks strict activation until
human review. These visual findings do not decide human acceptance. Decode,
Artifact, Alpha, Scope, and Hash integrity contradictions fail execution.

The derived classification, Shoulder Singleton, Fringe Hard Clear, clear,
protected-light, and visible-residue Mask hashes and bounding boxes live inside
the existing JSON and Spill Overlay. The Overlay JSON legend distinguishes the
Fringe subset from visible residue, spill, low-confidence, solved Unknown,
Shoulder Singleton, other background-supported clear, protected-light, and Sure
Background categories. These additions remain inside the exact eleven-file set;
they do not add a twelfth Artifact or another human-decision state.

## Human Decision And Resource Contract

Strict fixed-region processing continues to finish as
`done + review_required`, `release_ready: false`, and
`human_decision_status: pending`. The existing
`POST /api/generate-character/:jobId/accept` endpoint and
`manual_acceptance.json` remain the only human acceptance authority. V2 adds no
Accept field, Reject route, UI, or competing decision state.

Implementation and provider-free evidence generation are fixed at:

```yaml
estimated_provider_calls: 0
max_provider_calls: 0
provider_calls_used: 0
network_requests_allowed: false
model_downloads_allowed: false
external_matte_engines_allowed: false
```

The Preview report also records `network_requests_used: 0`. Before decoding, it
rejects empty inputs, files over 64 MiB, multi-frame images, and images over
4,194,304 pixels (maximum dimension 4,096). These are execution limits, not a
resize instruction; accepted Preview output retains the decoded input size.

An unaccepted saved Raw image may be used only as provenance-bound diagnostic
input. It cannot become a Golden, generation reference, identity input, repair
input, or accepted success baseline.
