# Prompt Contracts Protocol

Prompt contracts separate production layout requirements from provider-specific wording.

The contract is the source of truth for prompt structure. Provider code compiles it into text for a model request, but the underlying layout, identity, style, negative constraints, and validation expectations remain inspectable as metadata.

The default AI generation preset is `fixed_region_motion_v0`.
`topdown_rpg_v0` remains a supported explicit contract for uploaded 8x8
sheets, compatibility checks, and focused topdown repair work.
`ocad_motion_v0` is accepted only as a legacy alias for historical metadata.

Quality-character text-to-image uses a separate single-image contract:
`quality_character_prompt_contract_v1_0`. It is not a sheet layout contract.
It asks for one centered full-body sprite-source character with generous
padding, neutral idle pose, compact production scale, and enough simplification
to remain readable when downscaled to a 96x96 RPG sprite.

## Contract Metadata

```json
{
  "schema_version": 1,
  "contract_version": "character_prompt_contract_v1_15",
  "preset": "topdown_rpg_v0",
  "layout_id": "topdown_rpg_v0",
  "layout_kind": "uniform_grid",
  "validation_expectations": [
    "exact_8x8_grid",
    "exact_64_cells",
    "stable_feet_center_anchor",
    "consistent_character_identity",
    "pure_background",
    "no_extra_props_or_scenery",
    "no_empty_cells",
    "no_blank_or_near_blank_cells",
    "no_cropped_or_edge_cut_character",
    "full_body_visible_in_every_cell",
    "minimum_character_occupancy_per_cell",
    "maximum_edge_pressure_per_cell",
    "consistent_cell_scale",
    "consistent_cell_padding",
    "no_partial_body_closeups",
    "explicit_row_column_segment_map",
    "template_empty_cells_must_be_filled",
    "layout_template_has_priority_over_reference_images",
    "reference_images_must_not_override_layout",
    "compact_horizontal_attack_rows"
  ]
}
```

## v1.15 Fixed-region Action Direction Lock

`character_prompt_contract_v1_15` keeps the v1.14 clean-silhouette rules and
tightens fixed-region generation after a live single-candidate review exposed
cross-action pose leakage that pixel-only checks could not classify.

The fixed-region provider prompt now:

- Requires one-for-one replacement of every template pose in its original
  fixed region; poses may not move, swap, or leak into adjacent action groups.
- Fixes down actions to a front view, up actions to a back view, and `idleL`,
  `walkL`, `runL`, and `attractL` to a screen-left view.
- Requires one camera view and facing direction across every numbered action,
  including all six walk, run, and climb regions.
- Forbids inferring action boundaries from whitespace, sprite size, or nearby
  poses.

Direction consistency and action-boundary correctness remain explicit manual
review requirements. Local occupancy, edge-pressure, halo, and duplicate checks
do not prove those semantic properties.

## v1.10 Fixed-region Character-Only Motion Source

`character_prompt_contract_v1_10` keeps the v1.9 empty-hands base-layer
constraint and clarifies that fixed-region generation is a character-only body
motion source. Each fixed region may contain only the character silhouette,
costume, hair, and body-attached accessories.

Provider prompts now forbid separate objects, environmental surfaces,
interaction targets, helper marks, shadows, scenery, and background elements in
all fixed regions. The climb source regions are explicitly body motion in empty
space: no ladder, rope, wall, cliff, pole, stairs, platform, handhold, scenery,
or support object.

## v1.9 Fixed-region Empty-Hands Base Layer

`character_prompt_contract_v1_9` keeps the v1.8 template-first generation flow
and tightens the fixed-region source sheet into an empty-hands body-action base
layer. Provider prompts now forbid held weapons, shields, tools, props,
projectiles, muzzle flashes, spell effects, and detached attack arcs in every
fixed region, including item, attract/interact, defence, jump, and action-like
poses.

If a character identity normally implies equipment, the base sheet may only keep
it as compact costume detail or a sheathed/back-mounted silhouette when the
written request explicitly asks for it. Weapon and effect variants should be
added later through action-specific repair or strip workflows, not baked into
the base fixed-region source.

## v1.8 Fixed-region Template-First Generation

`character_prompt_contract_v1_8` changes fixed-region provider wording from a
literal `252x252` output target to a template-first square-image target. The
provider should preserve the attached template's relative fixed-region layout,
poses, action order, facing directions, scale, and spacing; local
post-processing owns the hard resize to `256x256`, top-left connected matte, and
final right/bottom crop to the `252x252` source sheet.

This keeps model output compatible with `1K` / `2K` provider sizes while still
producing the same fixed-region source layout after local normalization.

## v1.7 Fixed-region Naming Boundary

`character_prompt_contract_v1_7` changes provider-facing template wording from
`ControlNet-style template` to the neutral `structural layout template` while
preserving the same layout constraints.

`character_prompt_contract_v1_6` changed the default fixed-region layout id to
`fixed_region_motion_v0`. New prompt summaries and generation metadata should
write the neutral id. Historical `ocad_motion_v0` inputs are normalized as a
legacy alias.

The compiled fixed-region prompt uses neutral layout wording such as
"fixed-region motion source layout" while preserving source action names like
`idledown`, `walkdown`, `attractL`, and `defence`.

## v1.5 Fixed-region Static Source Reuse Boundary

`character_prompt_contract_v1_5` kept the same supported layout ids as v1.4 and clarified that fixed-region single-region static actions are one source pose, not four source animation frames.

For the fixed-region layout, the compiled prompt:

- Treats `idledown`, `idleup`, `idleL`, `defence`, `die`, `sitdown`, and `item` as single source poses.
- States that repeated runtime frames from those regions are expected static-source reuse, not duplicate motion debt.
- Forbids drawing internal mini-frame strips inside one fixed region.
- Keeps multi-frame action requirements on `walkdown`, `walkup`, `walkL`, `rundown`, `runup`, `runL`, `climb`, `attractL`, and `jump`.

This keeps the prompt honest about what the fixed-region source layout can express and prevents provider prompts or reports from implying that every runtime loop has four independent source regions.

## v1.4 OCAD Motion Reuse Classification

`character_prompt_contract_v1_4` keeps the same supported layout ids as v1.3 and adds an OCAD-specific motion distinction:

- Static single-region OCAD actions (`idledown`, `idleup`, `idleL`, `defence`, `die`, `sitdown`, and `item`) may be reused as repeated runtime frames after normalization.
- Multi-frame OCAD actions (`walkdown`, `walkup`, `walkL`, `rundown`, `runup`, `runL`, `climb`, `attractL`, and `jump`) must have distinct frame-to-frame motion phases across their numbered source regions.
- Providers must not draw internal mini-frame strips inside a single fixed region.

The matching benchmark report layer separates expected source-region reuse from unexpected duplicate motion.

## v1.3 Horizontal Attack Compactness

`character_prompt_contract_v1_3` keeps the same supported layout ids as v1.2 and adds a topdown-specific guard for the horizontal attack rows observed in the `topdown_quality_live_2case_20260601` live gate.

For `topdown_rpg_v0`, the compiled prompt now:

- Names frames 40-43 (`attack_left`) and 44-47 (`attack_right`) as high-risk horizontal attack cells.
- Requires clear left and right padding in those cells.
- Tells the provider to keep weapons, staffs, shields, tools, capes, spell effects, and stretched arms compact by shortening, tucking, or angling them close to the body.
- Forbids requested character props from touching or crossing cell edges in horizontal attack cells.

## v1.2 Topdown Template Guard

`character_prompt_contract_v1_2` keeps the same supported layout ids as v1.1 and adds a topdown-specific guard for structural templates that contain empty-looking or cropped placeholder cells.

For `topdown_rpg_v0`, the compiled prompt now:

- States that every row is two required 4-frame animation segments.
- Emits the exact row/column map, such as `row 0 columns 4-7 = idle up`.
- Tells the provider that empty-looking template slots are placeholders that must be replaced with complete character poses.
- Treats missing cells, cropped placeholder art, wide gaps, and uneven columns in the template as template defects, not output permissions.

## v1.1 Quality Rules

`character_prompt_contract_v1_1` adds explicit non-empty, no-crop, full-body, padding, edge-pressure, and template-priority rules. It does not change the supported layout ids.

## Supported Layouts

### `topdown_rpg_v0`

- `layout_kind`: `uniform_grid`
- Output must be exactly 8 columns by 8 rows.
- Output must contain exactly 64 cells total.
- Every required cell must contain one complete visible character pose.
- No cell may be blank, background-only, or a partial-body close-up.
- The full body must stay inside each equal cell with clear padding.
- Runtime rows remain the internal 8x8 animation protocol:

```text
idle down/up
idle left/right
walk down/up
walk left/right
attack down/up
attack left/right
hurt/happy
sit/talk
```

Each row is compiled as two explicit 4-frame segments:

```text
row 0 columns 0-3 = idle down; row 0 columns 4-7 = idle up
row 1 columns 0-3 = idle left; row 1 columns 4-7 = idle right
row 2 columns 0-3 = walk down; row 2 columns 4-7 = walk up
row 3 columns 0-3 = walk left; row 3 columns 4-7 = walk right
row 4 columns 0-3 = attack down; row 4 columns 4-7 = attack up
row 5 columns 0-3 = attack left; row 5 columns 4-7 = attack right
row 6 columns 0-3 = hurt; row 6 columns 4-7 = happy
row 7 columns 0-3 = sit; row 7 columns 4-7 = talk
```

This contract must not include fixed-region source action names.

### `fixed_region_motion_v0`

- `layout_kind`: `fixed_regions`
- Provider output is one square image that preserves the attached template's
  relative fixed-region source layout. Local post-processing hard-scales that
  image to `256x256`, removes the connected top-left background, and crops the
  right/bottom 4 pixels to the final `252x252` source sheet.
- Every required fixed region must contain the complete visible character pose for that source action.
- No required region may be blank, background-only, or a partial-body close-up.
- Each pose must stay inside its assigned fixed region with clear padding.
- Every template pose is replaced one-for-one in place; a generated pose must
  not be moved, swapped, borrowed, or duplicated across action boundaries.
- `idledown`, `walkdown`, and `rundown` face toward the viewer; `idleup`,
  `walkup`, and `runup` face away; `idleL`, `walkL`, `runL`, and `attractL`
  face screen-left. A numbered action keeps that view across all of its source
  regions.
- The sheet must not be subdivided into 8x8 equal cells, runtime rows, attack rows, hurt rows, or 64 uniform frames.
- Source actions preserve their original template meanings:

```text
idledown, idleup, idleL, walkdown, walkup, walkL, rundown, runup, runL, climb, attractL, defence, die, item, jump, sitdown
```

Right-facing runtime frames are synthesized later by flipping the left-facing source regions. This contract must not claim that the generated source is exactly 8 columns by 8 rows.

The prompt contract records `manual_fixed_region_direction_consistency` and
`manual_fixed_region_action_boundary_review` in `validation_expectations`.
They require inspection-strip or equivalent human review and are not satisfied
by the pixel-only source quality report.

Legacy alias: `ocad_motion_v0` is readable by current code, but new prompt
contracts should emit `fixed_region_motion_v0`.

## Artifact Locations

Prompt contract metadata is saved in:

```text
generation.json.prompt_contract
metadata.json.generation.prompt_contract
benchmark_report.json.items[].generation.prompt_contract
```

The full compiled provider prompt is saved in:

```text
prompt.txt
```

## Provider Image Roles

The compiled provider prompt treats attached images as role-specific inputs:

- Template image: strict structural control only.
- Reference image: weak appearance reference only.
- Palette image: palette/style reference only.

The written layout contract and structural template override all reference and palette images. Reference and palette images must not override layout, frame count, cell boundaries, or fixed-region positions.

## Compatibility Rules

- Prompt contracts are provider-agnostic.
- Provider code may change transport details, but it should not fork layout wording outside the contract compiler.
- New layouts need a contract test that proves they do not leak another layout's source action names or grid claims.
