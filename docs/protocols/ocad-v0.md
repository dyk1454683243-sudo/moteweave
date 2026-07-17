# ocad_v0 Protocol

`ocad_v0` is a compatibility layout for the NPC plugin's bundled OCAD slicer.

## Sheet

```text
size: 252x252
layoutVersion: yituquan_v1
spritesheetSlice: not json_grid
```

The sprite places normalized source frames into the plugin's fixed `Rect2i` regions. It is not a claim that the art was originally authored for native OCAD.

## Minimum Verified Animations

```text
idledown
walkdown
walkL
walkup
```

The exporter also fills the plugin's remaining OCAD regions with the closest available `topdown_rpg_v0` actions so the generated sheet is useful beyond the minimum probe.

## Source Action Semantics

The OCAD template uses its own source action names. These names do not need to match the internal runtime names exactly, but their meaning must be preserved:

```text
idledown / idleup / idleL
walkdown / walkup / walkL
rundown / runup / runL
item
attractL
jump
sitdown
defence
die
climb
```

When an OCAD source sheet is normalized into `topdown_rpg_v0`, `debug_report.json` keeps both `source_frame.action` and `runtime_action` so the template semantics remain auditable.

## Row GIF Preview Contract

OCAD Row GIF previews are source-layout-native. They show the OCAD template
actions, not the internal 8x8 runtime slot names used during normalization.

```text
idledown / idleup / idleL
walkdown / walkup / walkL
rundown / runup / runL
climb / attractL
defence / die / item / jump / sitdown
```

The preview contract intentionally does not emit derived or runtime
compatibility names such as `idle_right.gif`, `walk_right.gif`,
`attract_right.gif`, `attack_down.gif`, `attack_up.gif`, `attack_left.gif`,
`attack_right.gif`, `hurt.gif`, `talk.gif`, or `happy.gif`. In this protocol,
`climb.gif` remains the source `climb` action, `item.gif` groups `item0` and
`item1`, and `sitdown.gif` uses the source `sitdown` region.

This boundary is separate from `topdown_rpg_v0`: the normalized sheet may still carry runtime compatibility slots such as `attack_up`, but those names are hidden from OCAD-mode Row GIF previews.

When the processed job has a fixed-region `source.png` at the expected
`252x252` size, the OCAD export uses that source sheet directly for
`sprite.png`. Older or normalized-only jobs still fall back to reconstructing
the fixed-region sheet from `topdown_rpg_v0` runtime frames.

## Import Path

```text
AI资源库/一图全动作/<character_id>_ocad/npc.json
AI资源库/一图全动作/<character_id>_ocad/sprite.png
AI资源库/一图全动作/<character_id>_ocad/thumb.png
```
