# Subject Count Gate V1 Protocol

**Status:** Implemented.
**Mode:** `subject_count_gate_v1`
**Scope:** Provider-free human-review evidence for strict full-sheet generation.

This gate detects empty slots, likely second people, and ambiguous person-scale
fragments without changing the generated pixels. It is a local structural gate,
not an identity, anatomy, action-quality, art-quality, acceptance, or rejection
judge. The mode name remains `subject_count_gate_v1` for compatibility; all
statuses are heuristic signal levels for a human reviewer.

## Stages

Strict full-sheet Profiles run the gate at three points:

1. background-processed provider output before fixed-region calibration;
2. calibrated/background-processed source layout;
3. normalized runtime frames.

The source report contains the first two stage reports. The normalized report
contains the third. Input and output pixel hashes must match at every analyzed
cell; the overlay is a separate review artifact.

## Component Extraction

- Foreground is `alpha > 8`.
- Components use 8-neighbor connectivity.
- Minimum component area is
  `max(4, frame_area * 0.0005)`, rounded up to a whole pixel.
- The gate performs no global dilation, erosion, or morphological closing.
  Nearby people therefore cannot be merged merely because their silhouettes
  almost touch.
- The largest component is the provisional main subject.

For every retained secondary component the report records area, bbox, fill
ratio, slenderness, area and height ratios to the main subject, and normalized
center distance.

## Equipment-aware Classification

Classification happens before person thresholds:

- Thin components are accessories when slenderness is at most `0.22`, or when
  both fill ratio is at most `0.20` and slenderness is at most `0.35`.
- Components below the review scale (`area ratio < 0.18`) are treated as small
  accessories/noise rather than people.
- A diagonal or irregular low-fill component is treated as equipment when its
  area ratio is below `0.30` and its bbox fill ratio is at most `0.30`. This
  prevents an ordinary separated sword or attack implement from being
  classified as a second person solely because its diagonal bbox is tall.
- Equipment touching the cell edge is recorded as an advisory. It does not
  itself block release.

These rules do not merge a filled body-scale component simply because it is
close to the main body.

## Status Thresholds

A retained secondary component is `second_subject` when either:

- area ratio is at least `0.45`; or
- area ratio is at least `0.30`, height ratio is at least `0.45`, and normalized
  center distance is at least `0.12`.

A component is `suspicious` when it is not classified as equipment and either:

- area ratio is in `[0.18, 0.30)` with height ratio at least `0.45`; or
- area ratio is at least `0.30` with height ratio at least `0.45` but it does
  not meet the high-confidence distance condition.

The gate also compares main-component foreground area and bbox width with the
median for the same action when at least three comparable cells exist. Using
foreground area prevents a thin connected sword from looking person-scale only
because its bbox is wide. Death, hurt, and seated actions are exempt from this
contour comparison. A component with at least `2.0x` median foreground area and
`1.7x` median width receives the compatibility `blocked` detector label for a
connected-multi-subject contour signal. A component with at least `1.45x` area
and `1.35x` width receives the `needs_review` detector label.

Cell statuses are detector severities, not candidate decisions:

- `pass`: no strong additional-subject signal was detected; this does not prove
  that the image is correct.
- `needs_review`: the detector found a medium-strength ambiguous signal.
- `blocked`: compatibility detector label for a high-strength signal; it does not
  mean that a human rejected the candidate.
- `empty`: the detector did not find a retained foreground component; a human
  still makes the visual determination.

None of these visual statuses may automatically accept or reject a candidate,
produce `failed_quality_gate`, prevent later human acceptance, start repair, or
spend Provider quota. A successfully processed strict Sheet remains
`review_required` regardless of detector severity. Missing or malformed review
evidence is an execution-integrity error rather than a claim that the image is
visually bad. The review package requires exactly one
`pre_calibration_source`, one `calibrated_source`, and one `normalized_frames`
report.

## Reports And Overlays

Formal artifacts are:

```text
source_subject_count_report.json
source_subject_count_overlay.png
normalized_subject_count_report.json
normalized_subject_count_overlay.png
```

Overlay boxes use fixed colors:

- green: main subject;
- yellow: accessory/equipment;
- red: high-strength second-subject or connected-contour signal;
- orange: suspicious component or contour.

Reports include summary counts, compatibility `blocking_errors`, warnings,
equipment-edge advisories, `suggested_region_keys`, and
`needs_review_region_keys`. In this protocol, `blocking_errors` is a retained
detector field and has no automatic release or rejection authority.
Suggested keys are evidence only. They may be shown to the operator or passed
as an explicit starting suggestion for the existing three-atlas action-repair
flow, but they must never start a repair, expand a selection, or spend Provider
quota automatically.

## Provenance Boundary

Failed, rejected, and unaccepted generated sheets may be used only for explicit
Provider-free diagnosis. They are not identity inputs, palette inputs,
structure inputs, accepted baselines, repair inputs, or Provider feedback.
The gate does not claim that a passing sheet has consistent identity; semantic
identity remains a human Review gate.
