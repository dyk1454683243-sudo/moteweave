# Source Layouts

Source layouts describe how an uploaded or generated sprite sheet is sliced before it is normalized into the runtime character-pack profile.

The runtime output contract is still:

```text
normalized_sheet.png + animations.json
profile: topdown_rpg_v0
```

## topdown_rpg_v0

```text
kind: uniform_grid
input: 8 columns x 8 rows
manual cut lines: supported
```

This remains the default upload/manual-slicing path. It uses equal cells, optional projection correction, and optional manual cut-line overrides.

## fixed_region_motion_v0

```text
kind: fixed_regions
input: one-image fixed-region motion sheet
nominal sheet: 252x252
manual cut lines: ignored
legacy alias: ocad_motion_v0
```

This layout slices the source image using the fixed region table, including wider regions for long actions like `die` and `attractL`. The source can be scaled from 252x252 as long as the same relative region layout is preserved.

`ocad_motion_v0` is accepted only as a legacy alias for old fixtures, reports,
and saved metadata. New UI selections, CLI defaults, prompt contracts, debug
reports, and generation metadata should write `fixed_region_motion_v0`.

After the 20-case generation quality gate, this is the default AI generation layout. Generated fixed-region sources are still normalized into the `topdown_rpg_v0` runtime profile, so existing exporters keep the same runtime contract while generation avoids the sparse 8x8 sheet as its first target.

Processing still normalizes fixed-region source regions into `topdown_rpg_v0` as an internal compatibility layer for existing validators and exporters. User-facing Row GIF previews are source-layout-native and do not expose those compatibility slot names. For example, the source `climb` sequence is previewed as `climb.gif`, not as `attack_up.gif`.

The source template keeps fixed-region action semantics even when the internal runtime action names differ:

```text
idledown / idleup / idleL   -> idle directions
walkdown / walkup / walkL   -> walk directions
rundown / runup / runL      -> run directions
item                        -> item/action use
attractL                    -> left-facing attract/interact action
jump                        -> jump / celebratory motion
sitdown                     -> sit
defence                     -> defence / guard
die                         -> downed / death pose
climb                       -> climb
```

`debug_report.json` records both sides for every frame:

```text
frames[].source_frame.action       # fixed-region source action, such as attractL
frames[].source_frame.label        # readable meaning, such as attract left
frames[].runtime_action            # internal topdown_rpg_v0 action, such as attack_left
frames[].source_frame.template_anchor
frames[].source_frame.template_motion
```

`animations.json` also carries layout-aware labels on runtime animation entries. Fixed-region compatibility entries such as internal `attack_up` are marked `ui_hidden` so the control UI does not present them as native fixed-region actions.

The fixed-region source action list stays source-native. The two `item`
sub-regions are grouped as one two-frame `item.gif` preview. Runtime aliases
such as `talk` and `happy` remain available only inside the normalized
`topdown_rpg_v0` compatibility layer and debug metadata; they are not exposed
as fixed-region source actions.

Fixed-region Row GIF previews use their own protocol. They include only the fixed-region source actions:

```text
idledown / idleup / idleL
walkdown / walkup / walkL
rundown / runup / runL
climb / attractL
defence / die / item / jump / sitdown
```

They intentionally do not emit derived or runtime compatibility names such as
`idle_right.gif`, `walk_right.gif`, `attract_right.gif`, `attack_down.gif`,
`attack_up.gif`, `attack_left.gif`, `attack_right.gif`, `hurt.gif`,
`talk.gif`, or `happy.gif`; those are compatibility concepts, not fixed-region
template descriptions.

Every processed job emits `source_layout_overlay.png`. For fixed-region layouts this draws the scaled region table over the original source image, so drift or wrong action mapping can be inspected before looking at the normalized 8x8 sheet.

Fixed-region jobs also emit `source_quality_report.json` and
`debug_report.source_quality`. The report checks source-level per-region
occupancy, visible bounds, background/halo residue, edge pressure, and
source-layout alignment before runtime normalization. It also checks multi-frame
source actions such as walk, run, climb, jump, item, and attract/interact for
real frame-to-frame motion. Expected single-region static reuse, such as idle,
defence, die, and sit source poses, is recorded separately from duplicate-motion
debt.

Fixed regions carry a template anchor hint before normalization. This anchor comes from the source region table, not from the generated silhouette, so wide poses and weapon frames do not redefine the body center during the first paste into `topdown_rpg_v0`.

Provider repair for fixed-region jobs is source-region-native. A selected repair
request patches the backed-up `source.png` first, copies only the selected
source-action regions from the provider result, then re-runs the normal
processing/export path. This keeps unselected regions protected even if a
provider changes the rest of the returned full sheet. Multiple selected source
actions may share one provider call; the local apply step still limits changes
to the selected region keys.

After normalization, `normalization.auto_correction` may apply conservative frame translations when an otherwise valid frame is off the feet-center anchor or baseline. Then `normalization.motion_stabilization` can apply tiny animation-group shifts to reduce 1-2px frame drift. Motions marked `template_motion.stabilizable: false` are skipped so death, item, sit, and interact poses keep their intentional offsets.
