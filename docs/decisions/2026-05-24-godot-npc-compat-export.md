# Godot NPC Compatibility Export

## Decision

Use the existing web character-pack pipeline as the source of truth, and add a Godot NPC plugin exporter on top of it.

Do not vendor, fork, or directly adopt the NPC plugin runtime as our core pipeline.

## Rationale

Our project owns the first half of the workflow:

```text
AI generation or upload
-> background cleanup
-> slicing
-> normalization
-> validation
-> debug artifacts
-> browser preview
```

The NPC plugin already owns useful Godot-side behavior:

```text
scan library
-> preview NPCs
-> drag into scene
-> runtime dialogue/shop/AI/path behavior
```

The highest-leverage connection is a compatibility export:

```text
AI资源库/一图全动作/<character_id>/npc.json
AI资源库/一图全动作/<character_id>/sprite.png
AI资源库/一图全动作/<character_id>/thumb.png
```

## Chosen First Format

Use `json_grid` first:

```json
{
  "spritesheet": { "layoutVersion": "json_grid" },
  "ext": { "spritesheetSlice": "json_grid" }
}
```

This matches our current 768x768 uniform grid and avoids pretending that the sprite is already in the plugin's OCAD 252x252 non-uniform layout.

## Consequence

Phase 1 proves the end-to-end engine-import loop. It does not claim full OCAD parity, RPGMaker parity, or complete NPC behavior semantics.
