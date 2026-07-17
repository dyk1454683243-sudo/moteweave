# topdown_rpg_v0 Protocol

`topdown_rpg_v0` is the internal source of truth for the first character-pack workflow.

## Sheet

```text
grid: 8 columns x 8 rows
frame: 96x96
sheet: 768x768
frame count: 64
anchor: x=48 y=88
baseline: y=88
```

## Animation Layout

```text
row 0 col 0-3: idle_down
row 0 col 4-7: idle_up
row 1 col 0-3: idle_left
row 1 col 4-7: idle_right
row 2 col 0-3: walk_down
row 2 col 4-7: walk_up
row 3 col 0-3: walk_left
row 3 col 4-7: walk_right
row 4 col 0-3: attack_down
row 4 col 4-7: attack_up
row 5 col 0-3: attack_left
row 5 col 4-7: attack_right
row 6 col 0-3: hurt
row 6 col 4-7: happy
row 7 col 0-3: sit
row 7 col 4-7: talk
```

All animations use explicitly drawn frames. The profile does not synthesize left/right directions with horizontal flipping.

The same ranges are exported as `editor_metadata.json.frame_tags`:

```text
idle_down: 0-3
idle_up: 4-7
idle_left: 8-11
idle_right: 12-15
walk_down: 16-19
walk_up: 20-23
walk_left: 24-27
walk_right: 28-31
attack_down: 32-35
attack_up: 36-39
attack_left: 40-43
attack_right: 44-47
hurt: 48-51
happy: 52-55
sit: 56-59
talk: 60-63
```

Frame-space editor attachments use the profile anchor as the default `feet` point:

```text
feet: x=48 y=88
```

## Row GIF Preview Contract

For `topdown_rpg_v0` sources, Row GIF previews use the runtime animation names above:

```text
idle_down / idle_up / idle_left / idle_right
walk_down / walk_up / walk_left / walk_right
attack_down / attack_up / attack_left / attack_right
hurt / happy / sit / talk
```

This is intentionally different from OCAD fixed-region source previews. OCAD-mode names such as `rundown`, `climb`, `attract_left`, `defence`, and `die` must not be inferred back into the 8x8 preview protocol.

## Generation Template

The current primary 8x8 generation constraint image is:

```text
templates/motion_template_ocha_8x8.png
```

This template is used as an equal-cell pose/action/control reference, not as a style reference and not as a character identity reference. Its job is to bias the image provider toward the standard `topdown_rpg_v0` 8x8 sheet layout.

When the non-uniform OCAD source layout is selected, the generation constraint image switches to:

```text
templates/fixed_region_motion_template_v1.png
```

In that mode, source action semantics such as `attractL`, `item`, `defence`, `die`, and `climb` are preserved in `debug_report.json` while the normalized runtime sheet keeps the `topdown_rpg_v0` animation names above.

Historical auxiliary templates are not part of the active runtime or generation contract. Current template selection is defined in `src/character-pack/templateStore.js`.

## Executable Source Of Truth

The executable profile lives in:

```text
src/character-pack/profile.js
```

Docs describe the contract, but tests should verify generated artifacts against the code profile.
