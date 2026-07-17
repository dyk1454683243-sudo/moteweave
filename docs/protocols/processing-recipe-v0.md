# Processing Recipe Protocol v0

**Status:** Character Workbench core binding active; other targets reserved
**Owner:** Editor Workspace and existing processing pipelines  
**Introduced:** 2026-06-22

## Purpose

`processing_recipe_v0` records user-visible processing choices so the
Character Workbench can re-run the existing Character Pack pipeline in a
traceable way.

A recipe does not mutate old artifacts. It describes a new processing job that
produces new artifacts, which the user may accept as a new asset revision.

The Character Workbench factory, strict validator, and Character Pack option
adapter described below are active. Reprocess job submission, legacy migration,
hash orchestration, and acceptance are separate work; non-character target
values remain protocol reservations rather than active Workbench routes.

## Character Processing Recipe Shape

```json
{
  "version": "processing_recipe_v0",
  "target_pipeline": "character_pack",
  "pipeline_contract": "character_pack_process_v1",
  "implementation_revision": null,
  "source": {
    "file_name": "source.png",
    "source_layout": "topdown_rpg_v0",
    "source_job_id": "job_xxx",
    "asset_id": "asset_character_sample_hero",
    "black_matte_artifact_ref": null
  },
  "background": {
    "mode": "auto",
    "tolerance": 24
  },
  "cleanup": {
    "component_cleanup": true,
    "min_alpha": 18,
    "min_area": 4,
    "min_area_ratio": 0
  },
  "fixed_region_staging": {
    "enabled": false,
    "mode": null,
    "stage_size": null,
    "crop_right": null,
    "crop_bottom": null,
    "matte_tolerance": null
  },
  "grid": {
    "manual_overrides": null
  },
  "anchor_offset": {
    "x": 0,
    "y": 0
  },
  "frame_adjustments": {},
  "locked_animations": [],
  "correction": {
    "auto_correct": true,
    "motion_stabilize": true,
    "motion_max_shift": 2
  },
  "pixel_finishing": {
    "enabled": false,
    "max_colors": 16,
    "outline": true,
    "outline_mode": "outer"
  },
  "style_report": {
    "enabled": true,
    "max_colors": 16
  },
  "outputs": {
    "frame_sizes": [96, 64, 48, 32, 16]
  }
}
```

## Recipe Flow

```text
user edits draft controls
-> build processing_recipe_v0
-> submit existing processing endpoint or future repair endpoint
-> poll real job
-> receive new artifact set
-> compare before/after quality
-> user accepts or rejects the new asset revision
```

Rejecting a repair must not change the current project asset.

Accepting a repair should create or select a new asset revision that references
the new job artifacts.

## Target Pipelines

Initial values:

- `character_pack`
- `motion_source`
- `scene_pack`
- `two_point_five_d`

Only `character_pack` has an active Character Workbench validator and option
adapter. Other values reserve a shared protocol shape and may omit Workbench-
specific style or fixed-region staging sections. The common
`validateProcessingRecipe()` validator must therefore remain broader than
`validateCharacterWorkbenchRecipe()`.

## Existing Parameter Mapping

The active Character Workbench adapter maps only to live
`processSheetBuffer()` option names:

- `source.source_layout` -> `sourceLayout`
- `background.mode` -> `backgroundMode`
- `background.tolerance` -> `backgroundTolerance`
- `cleanup.component_cleanup` -> `componentCleanup`
- `cleanup.min_alpha` -> `cleanupMinAlpha`
- `cleanup.min_area` -> `componentCleanupMinArea`
- `cleanup.min_area_ratio` -> `componentCleanupMinAreaRatio`
- `grid.manual_overrides` -> `manualOverrides`
- `anchor_offset` -> `anchorOffset`
- `frame_adjustments` -> `frameAdjustments`
- `locked_animations` -> `lockedAnimations`
- `correction.auto_correct` -> `autoCorrect`
- `correction.motion_stabilize` -> `motionStabilize`
- `correction.motion_max_shift` -> `motionStabilizationMaxShift`
- `pixel_finishing.enabled` -> `pixelFinishing`
- `pixel_finishing.max_colors` -> `pixelFinishingMaxColors`
- `pixel_finishing.outline` -> `pixelFinishingOutline`
- `pixel_finishing.outline_mode` -> `pixelFinishingOutlineMode`
- `style_report.max_colors` -> `styleMaxColors`
- `outputs.frame_sizes` -> `outputFrameSizes`

The existing pipeline has two mutually exclusive style paths. When
`pixel_finishing.enabled` is `true`, Pixel Finishing produces the style evidence
and its report uses `pixel_finishing.max_colors`; `styleMaxColors` is not a
second independently consumed budget in that branch. The Workbench contract
therefore requires `style_report.max_colors` to equal
`pixel_finishing.max_colors`, otherwise it rejects the Recipe with
`style_report_budget_must_match_pixel_finishing`. When Pixel Finishing is
disabled, `style_report.max_colors` remains an independent, pipeline-effective
budget for the report-only style path and does not mutate the output image.

`source.black_matte_artifact_ref` is a managed reference, never a Buffer and
never a path for the adapter to read. For `dual_matte`, orchestration must first
validate and resolve that managed artifact, then pass its Buffer separately as
`blackSourceBuffer`. The adapter rejects `dual_matte` when either the reference
or resolved Buffer is missing.

The v1 adapter always supplies these non-editable, pipeline-effective defaults:

- matte residue cleanup enabled, tolerance `40`, passes `2`;
- edge decontamination enabled, max distance `112`, strength `0.55`;
- source preprocessing enabled;
- fixed-region staging `off`, with all staging tuning values `null`;
- Pixel Finishing outline color `[24, 24, 32]`;
- style evidence enabled;
- output frame sizes `[96, 64, 48, 32, 16]`;
- no `promptText`.

Any future UI must document parameters it exposes and parameters it keeps as
defaults.

`pipeline_contract` names the processing contract. It is intentionally separate
from product version numbers such as package version or release milestone.
`implementation_revision` may record a git SHA or build id for diagnostics, but
local drafts may keep it `null`. A non-null revision must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.

## Legacy Output Migration

The generic protocol validator accepts either legacy positive-integer
`outputs.scales` or positive-integer `outputs.frame_sizes`. Character Workbench
execution accepts only the canonical frame-size list above.

A future Workbench ingress migration may open a legacy Recipe that contains
only `outputs.scales`; it must replace that field with the fixed v1 frame sizes
and surface the stable diagnostic `legacy_output_scales_migrated`. Scale values
must not be reinterpreted as frame sizes. The active strict validator does not
silently migrate legacy input; migration must occur before strict validation.

## Two-Hash Ownership

Workbench orchestration uses two lowercase-hex SHA-256 identities over
recursively key-sorted plain JSON, preserving array order and using compact
`JSON.stringify` bytes:

- `recipe_hash` covers the full server-canonical Recipe, including the
  server-owned `implementation_revision`. It owns processing evidence and
  acceptance identity.
- `draft_settings_hash` covers the same canonical Recipe after forcing only
  `implementation_revision` to `null`. It owns editable draft dirty, stale,
  and Reset comparisons; it has no acceptance authority.

The server is authoritative for both hashes. A UI may calculate a provisional
`draft_settings_hash`, but it must never supply or override the implementation
revision and its digest must not be trusted for acceptance. Hash computation
and job ownership are recorded here as the protocol model and are not activated
by the core binding alone.

## Validation Rules

Common protocol validation rejects recipes when:

- version is unknown;
- target pipeline is unknown;
- source layout is unknown;
- file paths are absolute or contain `..`;
- background mode is unknown;
- tolerance is outside accepted pipeline bounds;
- cleanup thresholds are outside accepted pipeline bounds;
- present fixed-region staging values are inconsistent, such as enabled staging
  without a stage size;
- anchor or frame adjustment values are not finite numbers;
- motion max shift is negative;
- pixel finishing max colors is invalid;
- a present style report has invalid fields;
- neither valid legacy output scales nor valid output frame sizes are present;
- raw provider keys, tokens, or base64 image payloads appear in the JSON.

The active Character Workbench wrapper additionally requires:

- `target_pipeline === "character_pack"` and
  `pipeline_contract === "character_pack_process_v1"`;
- `implementation_revision` is `null` or a validated build id;
- a requested background mode in `auto`, `passthrough`, `flood`, `dual_matte`,
  or `edge_palette`; requested `alpha_cleanup` is rejected even though `auto`
  may report it as the selected result;
- integer background tolerance `0..80`;
- integer cleanup minimum alpha `0..80`;
- integer cleanup minimum area `1..64`;
- finite cleanup minimum-area ratio `0..0.25`;
- integer motion maximum shift `0..4`;
- integer anchor offsets `-16..16` on both axes;
- fixed-region staging exactly disabled with all tuning fields `null`;
- style reporting enabled and style/pixel palette budgets in `1..256`;
- when Pixel Finishing is enabled, the style-report palette budget exactly
  matches the Pixel Finishing palette budget; when it is disabled, the
  style-report budget independently controls report-only evidence;
- `outputs.frame_sizes` exactly `[96, 64, 48, 32, 16]`.

Source/profile-dependent validation is intentionally deferred to the managed
input orchestration boundary. This validator does not narrow generic,
documented non-character Recipes merely for lacking Character Workbench style,
staging, or fixed output-size requirements.

## Non-goals

- No direct provider call in the recipe itself.
- No in-place artifact mutation.
- No hidden pipeline parameter changes.
- No free-form script execution.
