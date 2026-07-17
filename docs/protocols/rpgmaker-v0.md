# rpgmaker_v0 Protocol

`rpgmaker_v0` is a compatibility export derived from either the normalized
`topdown_rpg_v0` runtime sheet or, when available, the fixed-region source
sheet.

## Sheet

```text
size: 144x192
grid: 3 columns x 4 rows
frame: 48x48
rows: down, left, right, up
plugin playback: 0, 1, 2, 1
```

## Source Mapping

```text
walk_down  -> row 0
walk_left  -> row 1
walk_right -> row 2
walk_up    -> row 3
```

The first export samples source columns `0, 1, 2` from each four-frame walk loop. The NPC plugin's RPGMaker generator adds the fourth playback frame by repeating source column `1`.

For fixed-region source jobs, the exporter uses the source-native walking
regions before falling back to normalized runtime frames:

```text
walkdown0..2 -> row 0
walkL0..2    -> row 1
flip walkL0..2 horizontally -> row 2
walkup0..2   -> row 3
```

This mirrors the same neutral 3-row conversion pattern: down, left, derived
right, then up shifted into the fourth 48px row.

## Import Path

```text
AI资源库/RPGMAKER/<character_id>_rpgmaker/NPC.json
AI资源库/RPGMAKER/<character_id>_rpgmaker/sprite.png
AI资源库/RPGMAKER/<character_id>_rpgmaker/thumb.png
```
