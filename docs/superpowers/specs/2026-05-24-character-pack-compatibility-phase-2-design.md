# Character Pack Compatibility Phase 2 Design

## Goal

Project 2 turns the phase 1 Godot NPC compatibility loop into a broader, measurable compatibility layer.

Phase 1 proved:

```text
topdown_rpg_v0 source
-> normalized_sheet.png
-> json_grid npc.json
-> Godot NPC plugin scan
-> JSON-grid SpriteFrames
```

Phase 2 adds:

```text
rpgmaker_v0 export
-> benchmark harness
-> validator improvements
-> ocad_v0 export
```

The priority is stable engine handoff, not a new visual product surface.

## Product Outcome

A user should be able to process a real character sheet and download a compatibility bundle with:

```text
character_pack.zip
godot_npc_pack.zip
rpgmaker_pack.zip
ocad_pack.zip
benchmark_report.json
```

The product message becomes:

```text
Generate once, inspect quality, then export to browser runtime, Godot NPC JSON grid, RPGMaker, or OCAD-style plugin profile.
```

## Scope

### In Scope

- Add `rpgmaker_v0` export for four-direction RPG Maker running sprites.
- Add a benchmark harness that runs known fixtures and real generated sheets through the same processing/export checks.
- Strengthen validation around Godot-visible issues:
  - direction consistency
  - action semantics
  - background residue
  - weak motion in key loops
  - exporter-specific fit checks
- Add `ocad_v0` export after the benchmark and validation layers are in place.
- Update protocol docs and runbooks so future work has clear entry points.
- Expose new download links in the existing Character Pack UI only after the backend artifacts exist.

### Out Of Scope

- Scene/tile/parallax asset generation.
- Full game editor workflows.
- Full dialogue/shop/AI authoring UI.
- Replacing or vendoring the NPC plugin runtime.
- Claiming full visual parity with official OCAD-authored source art.
- Public deployment, auth, billing, or durable cloud storage.

## Current Constraints

The internal source of truth remains:

```text
topdown_rpg_v0
768x768 sheet
8x8 grid
96x96 frames
16 animations
4 frames per animation
```

The free NPC plugin's relevant profiles are different:

```text
json_grid
  arbitrary uniform grid described in npc.json
  already works in phase 1

rpgmaker_v1
  144x192 sheet
  3 columns x 4 rows
  48x48 frames
  row order: down, left, right, up
  playback frame order: 0, 1, 2, 1

yituquan_v1 / OCAD
  252x252 sheet
  fixed non-uniform Rect2i table
  animation names include idledown, idleL, idleup, walkdown, walkL, walkup, rundown, runL, runup, attractL, item, jump, defence, sitdown, climb, die
```

Because OCAD is a fixed non-uniform target, it cannot be implemented as a simple resize of `normalized_sheet.png`.

## Recommended Order

### 1. RPGMaker Export First

`rpgmaker_v0` should be the first implementation slice.

Reasons:

- The target format is small and deterministic.
- It exercises exporter architecture without the OCAD layout complexity.
- It adds an immediately understandable engine-facing artifact.
- It gives benchmark and validator code a second export target to inspect.

The export maps our existing walk animations:

```text
walk_down  -> RPGMaker row 0
walk_left  -> RPGMaker row 1
walk_right -> RPGMaker row 2
walk_up    -> RPGMaker row 3
```

Each row uses three rendered frames derived from the four-frame source walk loop. The exported 3-column sheet should choose source frames that preserve alternating foot motion. The initial rule is:

```text
source columns: 0, 1, 2
plugin playback: 0, 1, 2, 1
```

If benchmark shows this reads poorly, a follow-up change can switch to a different frame sampling rule.

### 2. Benchmark Harness

Add a repeatable local benchmark command before OCAD work.

The benchmark should process a fixed list of image inputs and write one JSON report per run:

```text
generated/benchmarks/<run_id>/benchmark_report.json
```

The report should include:

```text
input file
job id or run id
processing status
validation status
warnings
blocking errors
background mode
halo score
duplicate frame groups
walk cycle metrics
export availability:
  json_grid
  rpgmaker_v0
  ocad_v0
Godot probe result when available
```

The first benchmark set should include:

```text
test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png
<input-file>
```

Additional real AI outputs can be added one at a time. The benchmark should not require a live OpenRouter call.

### 3. Validator Improvements

The validator should continue returning `pass`, `warning`, or `fail`, but it should also expose more specific metrics.

Add checks for:

```text
direction_consistency
  left/right/up/down groups should have stable silhouette size and baseline.

action_motion
  attack and walk groups should show meaningful pixel delta.

background_residue
  near-white edge residue and isolated background fragments should become warnings.

export_fit
  rpgmaker_v0 and ocad_v0 should report whether frames can be sampled without severe cropping or scale loss.
```

Validator improvements should be advisory at first. They should produce warnings and metrics, not block export unless the existing blocking conditions already fail.

### 4. OCAD Export Last

`ocad_v0` should be implemented only after the benchmark and validator improvements exist.

OCAD export should produce:

```text
ocad_pack.zip
AI资源库/一图全动作/<character_id>_ocad/
  npc.json
  sprite.png
  thumb.png
```

The OCAD `npc.json` should use:

```text
spritesheet.layoutVersion = "yituquan_v1"
ext.spritesheetSlice omitted or not set to "json_grid"
```

The OCAD `sprite.png` should be 252x252 and place sampled frames into the plugin's fixed regions.

The first OCAD mapping should favor stable visible behavior over complete semantic coverage:

```text
idledown <- idle_down representative frame
idleL    <- idle_left representative frame
idleup   <- idle_up representative frame
walkdown <- walk_down frames
walkL    <- walk_left frames
walkup   <- walk_up frames
rundown  <- walk_down frames reused initially
runL     <- walk_left frames reused initially
runup    <- walk_up frames reused initially
attractL <- attack_left frames where possible
sitdown  <- sit representative frame
die      <- hurt representative frame
item     <- happy or talk representative frames
jump/defence/climb <- representative safe fallback frames
```

The export should be explicit that `ocad_v0` is a compatibility layout, not a claim that the source art was authored in native OCAD style.

## Architecture

Keep the phase 1 separation:

```text
processSheetBuffer()
  owns loading, background cleanup, slicing, normalization, validation, and core artifacts

exporters/
  own compatibility exports from normalized frames/sheets and metadata

validators/
  remain pure data/image checks

benchmarks/
  own repeatable local evaluation and generated reports
```

New modules should stay under `src/character-pack/`:

```text
src/character-pack/exporters/rpgmakerExport.js
src/character-pack/exporters/ocadExport.js
src/character-pack/exporters/exportProfiles.js
src/character-pack/benchmark/benchmarkRunner.js
src/character-pack/benchmark/godotProbe.js
```

If `processSheet.js` grows too much while adding exporters, extract artifact assembly into a separate module instead of adding more inline zip-building code.

## Data Flow

The normalized processing path remains the only image-processing path:

```text
source image
-> processSheetBuffer()
-> normalized frames
-> normalized_sheet.png
-> metadata/debug report
-> json_grid exporter
-> rpgmaker exporter
-> ocad exporter
```

RPGMaker and OCAD exporters consume normalized frames, not raw source cells. This keeps background cleanup, anchor normalization, and validation consistent across all formats.

## UI

The existing Character Pack result area should add links only when the backend has produced the artifacts:

```text
Godot NPC ZIP
RPGMaker ZIP
OCAD ZIP
Benchmark report
```

No new large UI screen is needed for project 2. The UI should avoid explaining every format inline. Detailed import instructions belong in runbooks.

## Documentation

Add or update:

```text
docs/protocols/rpgmaker-v0.md
docs/protocols/ocad-v0.md
docs/protocols/character-pack-benchmark-report.md
docs/runbooks/rpgmaker-import.md
docs/runbooks/ocad-plugin-import.md
docs/runbooks/character-pack-benchmark.md
README.md
src/character-pack/README.md
```

The docs should make a strict distinction between:

```text
internal runtime format
json_grid Godot plugin compatibility
RPGMaker compatibility
OCAD compatibility
```

## Testing

Use TDD for each implementation slice.

Required test coverage:

```text
rpgmakerExport.test.js
  emits 144x192 PNG
  emits NPC.json/npc.json fields compatible with plugin behavior
  maps down/left/right/up rows correctly

benchmarkRunner.test.js
  writes stable benchmark report shape
  handles fixture inputs without live provider calls

validator.test.js
  adds direction consistency metrics
  adds action motion metrics
  adds background residue metrics

ocadExport.test.js
  emits 252x252 PNG
  places frames inside fixed OCAD regions
  emits yituquan_v1 npc.json without json_grid override
```

Required integration checks:

```text
npm test

Godot headless probe for:
  json_grid export
  rpgmaker_v0 export
  ocad_v0 export
```

The Godot probe can reuse the phase 1 approach:

```text
install plugin into temporary probe project
unpack export zip
run plugin repository scan
load sprite texture after import
ask plugin slicer to produce SpriteFrames
verify expected animation exists and frame count is non-zero
```

## Acceptance Criteria

Project 2 is complete only when all of these are true:

1. `rpgmaker_pack.zip` is produced for processed character sheets.
2. `rpgmaker_pack.zip` contains a 144x192 sprite and plugin-readable JSON.
3. The plugin's RPGMaker slicer can produce `rundown`, `runleft`, `runright`, and `runup`.
4. A local benchmark command runs without a live provider key.
5. Benchmark reports include processing, validation, export, and Godot probe results.
6. Validator reports new direction, action, residue, and export-fit metrics.
7. `ocad_pack.zip` is produced for processed character sheets.
8. `ocad_pack.zip` contains a 252x252 sprite and plugin-readable `yituquan_v1` JSON.
9. The plugin's OCAD slicer can produce at least `idledown`, `walkdown`, `walkL`, and `walkup`.
10. The existing phase 1 `godot_npc_pack.zip` behavior remains intact.
11. `npm test` passes.
12. Docs and runbooks explain how to use each export and how to run benchmark checks.

## Risks

### OCAD Visual Fidelity

OCAD's 252x252 layout uses narrow 21x42 and wider 28x42 / 42x42 / 63x42 regions. Our 96x96 normalized frames may lose detail when downsampled.

Mitigation:

- Implement OCAD after benchmark/validator.
- Treat OCAD as compatibility export, not visual parity.
- Add export-fit metrics so low-confidence exports are visible.

### Source Animation Semantics

The model or user-provided source may put non-matching actions in rows. Exporters cannot infer perfect semantics from broken source art.

Mitigation:

- Strengthen validator warnings.
- Keep debug overlays and GIFs visible.
- Do not block export unless the source fails core processing.

### UI Creep

Export formats could tempt a larger UI redesign.

Mitigation:

- Add download links only.
- Put format explanations in docs and runbooks.

## Non-Goals For Completion

Project 2 completion does not require:

- Generating new art from OpenRouter.
- Producing commercial-quality OCAD-native art.
- Editing or modifying the NPC plugin.
- Shipping a public hosted version.
- Adding scene/tile/parallax generation.
