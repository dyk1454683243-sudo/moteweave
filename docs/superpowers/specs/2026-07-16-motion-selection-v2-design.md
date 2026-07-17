# Motion Selection v2 Design

**Date:** 2026-07-16
**Status:** Implemented and guarded-verified in `f6a6a03`
**Owner:** Project lead
**Target surface:** Provider-free Motion Source automatic frame selection

## 1. Decision Summary

Motion Selection v2 adds a versioned, opt-in automatic selector. It registers
frames for analysis, clusters near-duplicates across the complete sequence,
estimates temporal periodicity, and selects temporal action phases. It does not
change manually selected frames, call a Provider, or mutate source pixels during
registration.

Legacy requests continue to use `motion_selection_v1_compat`. The Guided Motion
Source flow in E may explicitly bind to `motion_selection_recipe_v2`; omission,
`null`, or `false` remains v1-compatible.

## 2. Source Of Truth And Lineage

Normative sources:

- `docs/superpowers/plans/2026-07-16-character-production-quality-master-plan.md`
- `docs/protocols/motion-source-pipeline.md`
- `src/video-sprite/frameExtractor.js`
- `src/motion-source/frameSelector.js`
- `src/motion-source/stripBuilder.js`
- `src/motion-source/sourceSet.js`

The implementation baseline is commit `cfa74b8` on
`codex/frame-repair-live-quality-gate`.

No external source code, UI, algorithm implementation, prompt, or asset is
copied. The design uses original deterministic image-analysis code and public
mathematical concepts only.

## 3. Verified Baseline Gaps

1. `sampleFrames()` preserves only images. After stride sampling,
   `original_index` is the candidate-array index rather than the raw source
   frame index, and timestamp/duration evidence is lost.
2. Exact duplicates are global, but near-duplicates are compared only with
   `previousDistinct`.
3. Loop evidence compares only the first and last frames. A static sequence can
   look like a perfect loop, while a valid repeated cycle whose last extracted
   frame is not the closing frame can be missed.
4. Source Set examples declare `loop_expected`, but normalization drops it.
5. Automatic selection has no recipe/version contract. Unknown future options
   could affect the operation hash while being silently ignored by execution.
6. A target shortfall currently emits only `too_few_distinct_frames`; the outer
   strip report may still claim `done`.

## 4. Goals

1. Preserve sampled-candidate identity and raw-source provenance end to end.
2. Register translation jitter before similarity scoring without changing
   emitted source or normalized pixels.
3. Use conservative complete-link global clustering.
4. Detect static sequences before periodicity.
5. Score lag self-similarity, reject clear harmonic aliases, and abstain on
   unresolved ambiguity.
6. Select uniform temporal phases for loops and monotonic start-to-end phases
   for one-shot actions.
7. Keep every rejection, fallback, and target shortfall reviewable.
8. Keep temporal matte evidence diagnostic-only.

## 5. Non-Goals

- Semantic recognition of attack, takeoff, impact, landing, or other named
  action phases.
- Optical flow, learned pose estimation, or model inference.
- Pixel mutation during registration.
- Temporal alpha repair or automatic rembg invocation.
- Fabricating or duplicating frames to satisfy a target count.
- Guided UI changes; those belong to E.
- Changing Pixel Grid ordering or recipe behavior delivered by C.

## 6. Recipe Contract

Canonical recipe ids:

| Recipe | Behavior |
| --- | --- |
| `motion_selection_v1_compat` | Existing exact/previous-distinct filtering, first/last loop evidence, and motion-aware windows |
| `motion_selection_recipe_v2` | Provenance, analysis registration, global complete-link clusters, periodicity, and phase selection |

Canonical request shape:

```json
{
  "motion_selection": {
    "recipe": "motion_selection_recipe_v2",
    "loop_expectation": "auto",
    "temporal_matte": "evidence_only"
  }
}
```

Rules:

- `loop_expectation` is exactly `auto`, `loop`, or `once`.
- `temporal_matte` is exactly `disabled` or `evidence_only`.
- Registration, cluster, periodicity, and matte thresholds are fixed internal
  recipe constants, not public tuning controls.
- Unknown recipes, fields, or enum values fail before operation claim/queue.
- Camel/snake aliases are canonicalized before operation hashing.
- Omitted, `null`, or `false` selection settings canonicalize to the same v1
  operation options.

## 7. Frame Provenance

`extractFrames()` retains its compatible `frames` array and adds an aligned
`frame_provenance` array. Each record contains:

- `candidate_index`: sampled index used by Preview and Manual selection;
- `raw_index`: pre-stride source order;
- `timestamp_ms`: exact or derived time when available, otherwise `null`;
- `duration_ms`: exact or derived duration when available, otherwise `null`;
- `timing_source`: `exact`, `derived_sampling`, or `unavailable`;
- `source_entry`: ZIP entry name or extracted video frame name when available.

`original_index` remains the candidate index. It is not redefined. Selector,
Preview, `selected_frames.json`, normalized-frame evidence, and
`frames_index.json` add raw provenance beside the compatible index.

GIF page delays are exact only when decoder metadata supplies them. Video times
derived from the configured FFmpeg sampling rate are labeled
`derived_sampling`; they are not presented as original PTS. ZIP/image sources
without timing metadata use `null`.

## 8. Registration

Registration is analysis-only.

- Input is resampled deterministically to a longest-side analysis raster of at
  most 64 pixels.
- A fixed integer translation search is bounded by the recipe. Request options
  cannot raise the raster, search radius, frame count, or comparison budget.
- Bounding-box alignment provides the initial translation; a small local search
  minimizes registered alpha/color residual against a deterministic reference.
- Empty or unreliable frames receive zero translation and
  `status: not_applicable`.
- Reports preserve raw bbox centers/bottoms, the applied analysis shift,
  similarity/residual, and fallback status.
- Registration never changes the frame later sent to cleanup, Pixel Grid,
  normalization, or export.

## 9. Global Near-Duplicate Clustering

V2 compares registered analysis frames across the full sampled sequence.

- Exact hashes remain explainable evidence.
- Near-duplicate grouping uses complete-link admission: a candidate may join a
  cluster only when it meets the fixed threshold against every current member.
- Pair evidence is cached, so a 64-frame input performs at most 2,016 global
  frame-pair comparisons.
- Cluster tie-breaks are deterministic: strongest weakest-link similarity,
  then earliest representative.
- Each cluster records its representative, members, weakest similarity, and
  rejection mapping.

Complete-link is required to avoid transitive over-merging when `A≈B`,
`B≈C`, but `A≉C`.

## 10. Periodicity And Harmonics

Periodicity runs after the static gate and reuses cached registered similarity.

- Static or effectively one-cluster input returns
  `status: not_applicable_static`.
- Candidate lags require at least two comparable pairs.
- Every bounded lag through half the sequence is scored by mean registered
  self-similarity, coverage, and phase diversity.
- A period is declared only when evidence passes the fixed v2 confidence floor.
- Clear integer-multiple harmonics with repeated phase clusters are rejected in
  favor of the smaller fundamental period.
- If half/full-period symmetry cannot be resolved conservatively, the result is
  `ambiguous_harmonic`; Auto must abstain from loop selection.
- “Phase” means a temporal position in a cycle or one-shot span. It is not a
  semantic action label.

## 11. Loop, Once, And Auto

- `loop`: use one credible period, select uniformly across one cycle, and omit
  the closing duplicate. If no credible period exists, fall back to monotonic
  selection with `loop_period_not_confident`.
- `once`: preserve monotonic start-to-end order, include boundary phases when
  available, never wrap, and do not warn merely because endpoints differ.
- `auto`: use loop phase selection only with credible unambiguous periodicity;
  otherwise use once selection.

Legacy Source Set `loop_expected: true` maps to `loop`; `false` maps to `once`;
absence maps to `auto`. A manifest that supplies conflicting legacy and new
expectations fails validation.

## 12. Manual Authority

Manual selection remains a hard bypass.

- User order and candidate indexes are preserved exactly.
- Registration, clustering, periodicity, phase selection, and temporal matte
  report `not_run_manual_authority`.
- V2 cannot replace, reorder, reject, or supplement manual frames.
- Existing Auto/Manual conflict errors and legacy inference remain unchanged.

## 13. Temporal Matte Evidence

The first temporal matte path is `evidence_only`.

- It measures registered alpha occupancy and temporal flicker on the bounded
  analysis raster.
- It records stable-foreground and variable-occupancy ratios.
- It does not modify alpha, affect selected indexes, change strip bytes, add a
  blocking error, or invoke an external tool.
- Its report explicitly warns that action motion and matte instability are
  confounded until an owned benchmark establishes useful thresholds.

## 14. Target Shortfall Policy

V2 never fabricates frames.

- `target_satisfied` is true only when selected count equals the requested
  target.
- A shortfall returns `frame_selection.status: insufficient_target`,
  `shortfall_count`, and warning `insufficient_distinct_phases`.
- The local job may complete and retain its review artifacts, but the outer
  Motion report is `warning`, not `done`.
- Apply/export consumers remain responsible for their existing exact-count or
  explicit-resampling contract.
- Static or insufficient evidence makes periodicity `not_applicable`; it does
  not manufacture a loop.

This is the approved refinement of the older “match or blocking mismatch”
language: selection remains diagnosable and non-destructive, while apply/export
continues to enforce its own frame-count boundary.

## 15. Report Contract

For v2, `selected_frames.json` is
`mode: motion_selection_report_v2`, `schema_version: 2`. Existing
`selected`, `rejected`, `loop`, and `warnings` keys remain.

It adds:

- canonical recipe and effective settings;
- provenance;
- registration evidence;
- clusters;
- static gate and periodicity candidates;
- harmonic decisions;
- phase-selection mode and chosen cycle/span;
- temporal matte evidence;
- target outcome.

The outer `motion_source_strip_report_v1` remains compatible and embeds the v2
selection report.

## 16. Safety And Verification

- V2 rejects more than 64 candidate frames.
- Analysis raster and pair/search work are fixed and bounded.
- Cancellation is observed between registration, pair, clustering, periodicity,
  matte, cleanup, and encoding stages.
- Only guarded, serial, provider-free tests may run.
- Required fixtures cover translation jitter, non-adjacent duplicates,
  complete-link chains, static input, clean periods, harmonic ambiguity,
  loop/once/auto, manual bypass, temporal-matte byte invariance, provenance, and
  target shortfall.
