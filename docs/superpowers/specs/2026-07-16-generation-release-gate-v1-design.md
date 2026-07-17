# Generation Release Gate v1 Design

**Date:** 2026-07-16  
**Status:** Implemented and provider-free focused-verified on 2026-07-16
**Owner:** Project lead  
**Target surface:** Character Pack live text-to-image generation

## 1. Decision Summary

Add one versioned, deterministic release gate to both live Character generation
modes. Candidate scores continue to rank evidence; they no longer grant release
authority. The gate enforces the validation, source-quality, quality-closure,
and Quality Character composition evidence that the repository already owns.

When Provider generation and local processing succeed but no candidate passes,
the job becomes `failed_quality_gate`. Diagnostic evidence remains available,
but ZIP and engine-export artifacts are not written or exposed as releasable
downloads. Provider, route, budget, and processing failures keep their existing
distinct semantics.

This design does not add a semantic model, Provider call, prompt change, repair
loop, or adaptive candidate policy.

## 2. Source Of Truth

The implementation extends, but does not replace:

- `docs/protocols/text-to-image-generation.md`
- `docs/protocols/character-pack-artifacts.md`
- `docs/protocols/local-api-boundaries.md`
- `docs/superpowers/specs/2026-05-31-generation-quality-closure-v0.3-design.md`
- `src/character-pack/textToImageGeneration.js`
- `src/character-pack/processReport.js`
- `src/character-pack/sourceQualityGate.js`
- `src/character-pack/qualityClosureGate.js`
- `src/character-pack/benchmark/t2iGoldenReview.js`

`AGENTS.md`, the UI implementation guardrails, and the master plan remain
mandatory. The externally supplied suggestion page is advisory only and does
not contribute code, algorithms, UI, prompts, or assets.

## 3. Problem Statement

Production Sheet selection currently treats a processed result as publishable
even when its evidence is blocking. The artifact writer checks validation only
after full release-looking artifacts exist, does not enforce
`quality_closure.release_ready`, and can expose ZIP/export URLs for a blocked
result. Quality Character marks every successfully finished candidate as pass
and writes a successful report regardless of its existing composition metrics.

Consequently, `selected_index`, `done`, and downloadable exports can overstate
what the evidence proves.

## 4. Goals

1. Separate candidate ranking from release eligibility.
2. Make existing Production Sheet evidence authoritative for live generation.
3. Give Quality Character a deterministic runtime hard gate derived from the
   owned offline-review policy.
4. Preserve diagnostics for blocked runs without publishing release artifacts.
5. Keep Provider call counts, fallback behavior, budgets, and retry behavior
   unchanged.
6. Align core, writer, API job, CLI, benchmark, and browser status semantics.
7. Keep all implementation verification Provider-free.

## 5. Non-Goals

- Prompt-contract, template, source-layout, Provider adapter, or model changes.
- Semantic identity, limb-count, pose, action, costume, or style recognition.
- A second quality scorer or learned validator.
- Automatic local repair, Provider retry, fallback, candidate expansion, or
  additional Provider spend.
- Pixel Grid v2, Motion Source changes, or a new generation UI layout.
- Changing the provider-free `/api/process-sheet` acceptance policy.

## 6. Canonical Gate Contract

Every successfully processed live candidate receives:

```json
{
  "schema_version": 1,
  "mode": "generation_release_gate_v1",
  "generation_mode": "production_sheet_v0",
  "policy": "strict_live_generation_v1",
  "status": "pass",
  "release_ready": true,
  "blocking_errors": [],
  "warnings": [],
  "evidence": {}
}
```

Requirements:

- `status` is exactly `pass` or `fail`.
- `release_ready` is true only when `status === "pass"` and blockers are empty.
- Stable machine-readable reason codes are deduplicated and ordered by policy.
- Evidence contains only existing local measurements and applicability facts.
- A missing required measurement is a blocker, not zero and not a silent pass.
- Thresholds and policy names are versioned and shared by runtime and benchmark
  review to prevent drift.

## 7. Production Sheet Policy

For `production_sheet_v0`, a candidate is release-ready only when:

1. Provider output and `processSheetBuffer()` completed.
2. `debug_report.validation` exists, has `status: "pass"`, and has no warnings
   or blocking errors.
3. If the source layout supports source-quality evidence,
   `debug_report.source_quality` exists, has `status: "pass"`, and has no
   warnings or blocking errors.
4. If the source layout does not support source-quality evidence, the gate
   records `source_quality_applicability: "not_applicable"`; `null` alone is not
   treated as missing required evidence.
5. `debug_report.quality_closure` exists and has
   `release_ready: true`, `status: "pass"`, and no warning/fail gates.

The strict live policy intentionally blocks warning-level generation results.
It does not change provider-free upload processing. If false positives emerge,
they are addressed through a separately versioned policy backed by owned
benchmark evidence, not by silently weakening v1.

## 8. Quality Character Policy

The Quality Character gate reuses the thresholds currently owned by the golden
review. The following are blocking:

| Reason | Blocking condition |
| --- | --- |
| `quality_character_empty` | No bbox or visible pixel count is zero |
| `quality_character_score_below_warning` | Candidate score is below `600` |
| `quality_character_visible_area_too_large` | Visible pixels exceed `220000` |
| `quality_character_bbox_too_wide` | Bbox width ratio exceeds `0.72` |
| `quality_character_bbox_too_tall` | Bbox height ratio exceeds `0.86` |
| `quality_character_bbox_too_large` | Bbox area ratio exceeds `0.42` |
| `quality_character_off_center` | Center offset ratio exceeds `0.10` |
| `quality_character_edge_margin_too_small` | Edge margin ratio is below `0.035` |

Boundary equality passes. Missing hard-gate metrics fail closed. Low visible
pixel count, low unique color count, high palette-change ratio, high outline
ratio, and score below the usable threshold remain warning evidence unless they
also cause one of the hard conditions above.

The gate proves only local non-empty, composition, and processing constraints.
It does not prove that the character is semantically correct, full-bodied,
identity-consistent, or free of extra limbs.

## 9. Candidate Selection

Each candidate record adds `release_gate` and `release_ready`.

- `selected_index` remains the highest-scoring processed diagnostic candidate
  for compatibility with existing review/report code.
- `release_selected_index` is the highest-scoring release-ready candidate.
- Successful publication uses only `release_selected_index`.
- If a lower-scoring candidate is eligible and the diagnostic winner is not,
  the eligible candidate is published.
- If no candidate is eligible but at least one was processed, the diagnostic
  winner supplies inspection evidence and `release_selected_index` is null.
- If no candidate was processed, existing Provider/route failure selection and
  taxonomy remain authoritative.

Selection reports add:

```json
{
  "release_ready": false,
  "selected_index": 1,
  "release_selected_index": null,
  "artifact_disposition": "diagnostic_only"
}
```

The values of `candidate_count`, generation options, Provider attempts, and
Provider-call budgets are unchanged.

## 10. Artifact And Job Semantics

| Outcome | Job status | Failure status | Artifact disposition |
| --- | --- | --- | --- |
| Release candidate exists and writer succeeds | `done` | null | `release` |
| Processed candidates exist but none pass | `failed_quality_gate` | `generation_release_gate_failed` | `diagnostic_only` |
| Provider/route/budget prevents all processed candidates | `failed_model_error` | Existing Provider taxonomy | `none` or existing diagnostics |
| Local processing/writing throws | `failed_post_processing` | Existing processing taxonomy | Partial diagnostics only |

For `diagnostic_only`:

- Write the selected source/result image, gate report, debug report,
  source-quality report when present, prompt/generation metadata, and candidate
  images that already exist.
- Do not write or expose Character Pack ZIP, Quality Character ZIP, engine packs,
  or any download URL that implies release authority.
- The browser may render diagnostics and reason codes. Export controls stay
  disabled.
- `retry_hint` is `inspect_generation_evidence`.

`failed_quality_gate` is a terminal status already used by other repository
surfaces. Character Pack pollers must add it to their terminal set.

## 11. Evidence Consistency

- Character metadata and debug reports must reference the same combined
  validation blockers. Source-quality blockers must not disappear when raw
  validation metadata is serialized.
- The selected result's `generation.json`, candidate selection, gate report, API
  fields, and browser diagnostics must agree on both selected indexes and
  release readiness.
- The gate report is the publication authority; score alone is never sufficient.

## 12. UI Contract

This is a behavior correction, not a redesign.

- A release-ready job renders the existing real artifacts and export controls.
- A `failed_quality_gate` job stops polling immediately, shows a concise
  “diagnostic only / not releasable” state, reason, gate evidence, and Provider
  budget, and keeps all export controls disabled.
- The UI must distinguish the diagnostic candidate from the release-selected
  candidate.
- No semantic claim or inactive future repair action is displayed.
- Existing loading, focus, mobile report-only behavior, and accessibility
  conventions remain unchanged.

## 13. Compatibility And Migration

- No request field is required and no Provider behavior changes.
- Response fields are additive except that blocked jobs no longer return release
  ZIP/export URLs and may now terminate as `failed_quality_gate` instead of
  `done` or `failed_post_processing`.
- Existing consumers that treat all non-`done` states as failure remain safe.
  Pollers must recognize `failed_quality_gate` as terminal.
- Existing `selected_index` remains populated for diagnostics; new consumers use
  `release_selected_index` for publication.
- Historical artifacts remain readable and are not rewritten.

## 14. Acceptance Criteria

- A high-scoring blocked candidate cannot beat a lower-scoring eligible one for
  release.
- An all-blocked run has no release-selected candidate, terminates as
  `failed_quality_gate`, and exposes no ZIP/engine export URL.
- Production source-quality applicability is correct for fixed-region and
  topdown layouts.
- Missing required evidence fails closed.
- Every Quality Character hard threshold has passing boundary and failing
  out-of-bound tests; soft warnings do not silently become semantic blockers.
- Provider all-fail and local processing failures retain their current distinct
  statuses.
- CLI/benchmark collection can record a gate failure without aborting the whole
  provider-free evidence run.
- Character UI stops polling and disables exports for a gate failure.
- Focused and final guarded tests make no live Provider call.
