# Godot NPC Plugin Import Runbook

Use this to verify the phase 1 loop:

```text
web tool -> generated ZIP -> Godot NPC plugin scan -> drag into scene
```

## Prerequisites

- A Godot 4 project.
- The free NPC plugin installed under `addons/npc_library_tool`.
- The plugin enabled in Godot project settings.
- A generated `godot_npc_pack.zip` from this tool.

## Steps

1. Start this tool:

   ```bash
   npm start
   ```

2. Upload or generate a character in the Character Pack workflow.

3. Download `Godot NPC ZIP`.

4. Unzip it into the Godot project root so the files appear under:

   ```text
   res://AI资源库/一图全动作/<character_id>/
     npc.json
     sprite.png
     thumb.png
   ```

5. Open or refocus Godot and wait for the PNG import pass to finish.

6. Open the NPC plugin dock and scan `一图全动作`.

7. Select the generated character. The card preview should use the JSON grid animations.

8. Drag the character into a 2D scene. The spawned node should have a playable `AnimatedSprite2D` using `sprite.png`.

## Expected Result

- The character appears in the dock.
- `npc.json` has no missing-root-field errors.
- Preview can play at least `idle_down` or `walk_down`.
- Dragging into a scene creates a visible NPC node.

## Troubleshooting

If the character does not appear:

- Confirm the folder is under `res://AI资源库/一图全动作`, not inside `addons`.
- Confirm the file is named `npc.json` or `NPC.json`.
- Confirm `npc.json.assets.spritePath` is `./sprite.png`.
- Confirm Godot has imported `sprite.png`.

If preview says OCAD slicing failed:

- Check `npc.json.ext.spritesheetSlice`.
- It must be:

  ```json
  { "spritesheetSlice": "json_grid" }
  ```

If animation frames are offset:

- Confirm `spritesheet.frameWidth` and `frameHeight` are both `96`.
- Confirm `columns` and `rows` are both `8`.
- Inspect `normalized_sheet.png` and `debug_overlay.png` from the same job.
