# Three-atlas Action Repair v1

This protocol productizes selected action-slot correction for both managed
Character Pack source templates: `topdown_rpg_v0` (8×8 standard sequence
frames) and `fixed_region_motion_v0` (fixed-region action source). Both use the
same identity-anchor, pose-guide, empty-output, Review, one-call, extraction,
scope, and manual-acceptance contract. Only template geometry and source-slot
mapping differ. It covers wrong pose, wrong facing, wrong stride phase,
incorrect hand or foot placement, unwanted held weapons or props, and
equivalent action defects.

It is separate from the formal eight-case Frame Repair Quality Gate. Planning,
atlas construction, extraction, masking, hashing, and pixel-scope validation are
provider-free. A live operation has exactly one provider call and no retry.

## Exclusive product routing

`POST /api/repair-character-action` accepts only managed `topdown_rpg_v0` or
`fixed_region_motion_v0` source actions and always applies the sealed
`action_repair_atlas` contract. Any other source layout, an unrecognized source
action, a stale Review binding, or a contract mismatch is rejected before
provider dispatch. There is no generic animation-strip repair fallback.

| Source layout | Repair-sheet geometry | Pose template |
| --- | --- | --- |
| `topdown_rpg_v0` | normalized 768×768 8×8 sheet; 96×96 exact slots | `motion_template_ocha_8x8.png` (256×256 8×8 geometry) |
| `fixed_region_motion_v0` | authoritative 252×252 fixed-region sheet | `motion_template_ocad_primary.png` (252×252 fixed regions) |

The managed Editor Repair workspace is the product entry for action correction.
The transient Character Pack screen does not expose a second action-repair path.
The former local Recipe/Build Preview/Accept reprocess path and the former
single-frame/eight-case paths are retired and unregistered; neither can be
selected as a fallback. Benchmark quality-closure tooling remains isolated from
this product route.

## Selection authority

The user selects output frames in the Repair filmstrip. Managed
`debug_report.json` evidence maps each output frame to its authoritative
`source_frame.region_key`. Repeated or horizontally mirrored output frames that
share one source region are linked and selected together.

The request contains the exact deduplicated `regionKeys` and their source
actions. Selection must not expand to neighboring regions or to every region in
an action. One call supports at most 30 selected source regions; the current
confirmed 26-slot batch fits one atlas.

## Reference contract

All three references are 1024×1024 PNG atlases:

| File | Provider role | Allowed content |
| --- | --- | --- |
| `identity_anchor_atlas.png` | `verified_character_identity_only` | Verified-correct, unselected crops from the current authoritative repair sheet, with optional verified normalized crops; selected regions are excluded. |
| `pose_guide_atlas.png` | `per_slot_pose_and_facing_only` | Grayscale structural crops from the repository motion template in the target coordinate slots. |
| `empty_output_atlas.png` | `independent_transparent_output_geometry` | A newly created coordinate board with transparent target interiors and control slots; it is not a modified character sheet. |

The provider must not receive:

- a full authoritative repair sheet or full normalized sheet;
- a selected wrong character crop;
- a source sheet with characters punched out;
- a previous provider candidate or repaired image;
- synthetic control characters or unrelated baselines.

Identity anchors define species, anatomy, face, hair, costume, proportions,
palette, outline, lighting, and pixel density. Pose guides define only pose,
facing, stride phase, hand and foot placement, scale, and baseline. A guide must
never override character identity.

## Atlas layout and provider output

The board has six columns. Its row count is
`ceil(selected_region_count / 6) + 1`, within the fixed 1024×1024 canvas.
Selected slots occupy source-selection order. Remaining cells are controls and
must stay empty.

The provider returns exactly one square action atlas. Every selected slot must
contain one complete, separated, full-body version of the identity-anchor
character in the corresponding guide pose. The output must not contain labels,
numbers, a visible grid, duplicate limbs, trails, scenery, shadows, or content
in control cells.

`equipmentPolicy` is one of:

- `none` (default): correct the complete action and return an empty-hands body
  with no held weapon, shield, tool, prop, projectile, detached effect, or
  weapon-like streak;
- `preserve`: retain only equipment already approved by the parent identity;
- `separate`: return an equipment-free body candidate and local review-only
  equipment separation evidence.

## Mandatory pre-call review

Before the live request, the product shows and verifies:

- target asset id and active parent revision id;
- exact selected source region keys;
- the source-region mask in the selected layout geometry (768×768 or 252×252)
  as the same exact full-slot rectangles;
- the three reference roles and artifact links;
- `source_target_regions_holed: false`;
- provider preset, provider, and model;
- 1024×1024 reference dimensions and requested provider image size;
- `estimated_provider_calls: 1`;
- review-only output and separate manual acceptance.

Any mismatch blocks the request before quota is consumed.

The provider-free Review writes
`fixed_region_action_repair_review.json`. Its canonical SHA-256 binds the
project id, asset id, active parent revision, parent source job, source sheet,
normalized sheet, motion template, exact selected regions, instruction,
equipment policy, atlas layout/evidence, ordered three-reference manifest,
provider preset/provider/model, image configuration, and the one-call budget.
The live request must repeat `reviewedRunId`, `expectedPlanHash`, and
`expectedReferenceManifestSha256`. The server rebuilds the same provider-free
evidence and compares all hashes, then dispatches the exact three PNG files
written by that Review. It does not rebuild a different provider input inside
the live job. A mismatch is stale and consumes zero calls.

## Local extraction and scope

After the one provider response is durably checkpointed, local code:

1. decodes the atlas with a 4096×4096 maximum;
2. removes flat edge background per cell;
3. removes only small disconnected alpha components;
4. verifies one significant subject in every target cell;
5. normalizes each subject against verified identity scale/baseline and template
   bounds;
6. writes a transparent provider-source image in the selected repair-sheet
   geometry containing only selected regions;
7. copies the complete selected rectangles into a clone of the authoritative
   parent repair sheet;
8. compares parent and candidate pixel by pixel and requires
   `outside_selected_changed_pixels === 0`;
9. runs provider-free completeness and equipment checks.

For action correction, the grayscale pose template is the silhouette envelope
for protrusion detection because the parent pose is known to be wrong and may
have a different limb outline. The parent region remains the separate change
reference used to prove that `none` / `separate` actually changed parent-visible
content. This prevents a legitimate corrected arm or leg position from being
classified as a newly introduced weapon merely because it differs from the
wrong parent pose.

An empty target, multiple significant subjects, decode error, equipment failure,
or scope failure terminalizes the operation. There is no retry, model switch,
fallback request, diagnostic provider call, or candidate feedback.

## Candidate and acceptance lifecycle

A passing response creates a review-only candidate job. It does not create an
asset revision. The UI exposes the raw atlas, extracted candidate, scope report,
and local validation evidence.

Only a later explicit **Accept candidate as revision** action imports the
already-generated job. Acceptance performs no provider call and must supply the
expected parent asset revision id. If the active asset revision changed after
generation, acceptance fails with `asset_revision_conflict`; the candidate is
not imported.

Acceptance uses only the specialized route:

```http
POST /api/editor/projects/:projectId/assets/:assetId/action-repair/:jobId/accept
```

```json
{
  "expectedRevision": 4,
  "expectedAssetRevisionId": "rev_001",
  "expectedPlanHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

The live job writes `fixed_region_action_repair_acceptance_manifest.json` only
after one used call, successful atlas extraction, provider-free equipment pass,
zero out-of-scope changed pixels, and a completed Character Pack. The manifest
hashes every explicit candidate and Character Pack file. Specialized Accept
captures and re-hashes those exact bytes, copies the captured bytes into one
immutable child revision inside the project mutation lock, and then marks the
job accepted. Exact replay returns the existing child revision. The general
`import-job` route rejects this job type and its persistent Review marker with
`specialized_accept_required`.

## Required artifacts

```text
fixed_region_source_repair_plan.json
fixed_region_action_repair_review.json
selected_prompt.txt
identity_anchor_atlas.png
pose_guide_atlas.png
empty_output_atlas.png
raw_provider_repair_atlas.png
background_removed_provider_atlas.png
atlas_extraction_report.json
extracted_frames/<region_key>.png
normalized_provider_source_sheet.png
candidate_scoped_review_only.png
source_scope_report.json
candidate_validation_report.json
equipment_quality_report.json
fixed_region_source_repair_summary.json
fixed_region_action_repair_acceptance_manifest.json
```

The summary records `provider_calls_used`, `automatic_retry: false`,
`candidate_feedback: false`, `accepted: false`, selected region keys, and the
manual-confirmation requirement.
