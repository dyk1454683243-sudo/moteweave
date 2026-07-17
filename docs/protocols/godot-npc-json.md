# Godot NPC Plugin JSON Export

This protocol targets an ecosystem-compatible free Godot NPC plugin export. We do not vendor or replace the plugin runtime. We emit files that the plugin can scan and instantiate.

## Folder Contract

The plugin scans:

```text
res://AI资源库/一图全动作
```

Our ZIP contains:

```text
AI资源库/一图全动作/<character_id>/
  npc.json
  sprite.png
  thumb.png
```

After unzipping into a Godot project root, the files should resolve as:

```text
res://AI资源库/一图全动作/<character_id>/npc.json
res://AI资源库/一图全动作/<character_id>/sprite.png
res://AI资源库/一图全动作/<character_id>/thumb.png
```

## npc.json Shape

Required top-level fields:

```text
schemaVersion
meta
assets
spritesheet
gameplay
ext
```

The current exporter uses:

```json
{
  "schemaVersion": 1,
  "assets": {
    "spritePath": "./sprite.png",
    "thumbPath": "./thumb.png"
  },
  "spritesheet": {
    "layoutVersion": "json_grid",
    "frameWidth": 96,
    "frameHeight": 96,
    "columns": 8,
    "rows": 8,
    "margin": 0,
    "spacing": 0,
    "defaultFps": 8,
    "animations": {
      "walk_down": { "row": 2, "from": 0, "to": 3, "loop": true }
    }
  },
  "ext": {
    "spritesheetSlice": "json_grid"
  }
}
```

`ext.spritesheetSlice = "json_grid"` is important. Without it, the plugin may prefer its OCAD fixed-region slicer for `一图全动作`, which does not match our 768x768 uniform grid.

## Why json_grid First

Our current internal profile is already a uniform 8x8 grid. The free plugin supports JSON grid slicing for preview and spawn fallback. That lets us complete the first engine-import loop without immediately converting to OCAD's 252x252 non-uniform layout.

Future exporters may add:

```text
ocad_v0
rpgmaker_v0
godot_spriteframes.tres
```
