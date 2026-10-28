# Optional Godot SpriteFrames .tres export

**Status:** Proposed. Not implemented.
**Date:** 2026-10-28
**Issue:** [#13](https://github.com/dyk1454683243-sudo/moteweave/issues/13)

No exporter, golden fixture, download, or `.tres` artifact exists. `README.md`
and the public site still list Godot `.tres` export as not implemented. This
note does not change that.

## Decision

Add a compatibility exporter that writes a Godot 4 `SpriteFrames` text
resource from the normalized sheet and `animations.json`. The exporter sits
beside the RPGMaker and OCAD exporters. It leaves the normalized pack and the
current `godot_npc_pack.zip` path alone.

The normalized pack stays the source of truth:

```text
normalized_sheet.png
animations.json
```

`buildAnimationsJson` in `src/character-pack/packageBuilder.js` writes
`animations.json`. `buildAnimations` in `src/character-pack/animations.js`
fills each clip from `TOPDOWN_RPG_V0` in `src/character-pack/profile.js`.

Playback fields on each clip:

```text
fps      number
loop     boolean
mode     "loop" | "once" | "pingpong"
frames   frame indexes, playback order
flip_h   boolean
```

Frame indexes are absolute cells on the uniform grid. For the current
profile, index `i` is column `i % 8` and row `floor(i / 8)` on a 768×768
sheet of 96×96 cells. `animations.json` also carries `sheet`,
`frame_size`, `sheet_size`, and `anchor`. Fixed-region jobs may add
`source_layout` and extra clip keys such as `label`, `source_actions`,
`ui_hidden`, and `semantic_status`. Those extra keys describe provenance.
They do not change `fps`, `loop`, `mode`, or `frames`.

## What the exporter reads

Inputs:

```text
animations.json
the PNG named by animations.json.sheet
metadata.json id, for the pack folder only
```

Today `sheet` is `normalized_sheet.png`. The PNG copied into the pack is that
file's bytes. The exporter does not rebuild a 144×192 or 252×252 sheet, and
it does not read row GIF previews, `editor_metadata.json`, or `npc.json`.

`npc.json` is a different slice of the same profile. Its clips are
`row` / `from` / `to`, and the sheet has one `defaultFps` of `8`
(`src/character-pack/exporters/godotNpcExport.js`). `animations.json` stores
a fps on every clip. `walk_down` is fps `10` there, and `defaultFps` does
not apply. The `.tres` speed comes from `animations.json`.

`source_actions[].flip_h` records a flip already baked into the normalized
cell. The exporter reads only the clip's own `flip_h`. `buildAnimations`
sets that field to `false` for every current clip.

## SpriteFrames mapping

Godot 4 `SpriteFrames` is the target resource. The runbook
`docs/runbooks/godot-npc-plugin-import.md` asks for a Godot 4 project and
does not pin a minor version. Regions use the texture's top-left origin, Y
down, which matches the normalized sheet.

For each clip, in `animations.json` key order:

| `animations.json` | `SpriteFrames` |
| --- | --- |
| clip name | animation name (`StringName`) |
| `fps` | speed, in frames per second |
| `frames` | ordered atlas frames |
| each frame index | one `AtlasTexture` region |
| (no per-frame timing) | relative duration `1.0` on every frame |

Region for frame index `i`, with margin `0` and spacing `0`:

```text
columns = sheet_size.w / frame_size.w
rows    = sheet_size.h / frame_size.h
x = (i % columns) * frame_size.w
y = floor(i / columns) * frame_size.h
region = Rect2(x, y, frame_size.w, frame_size.h)
```

`sheet_size` must divide evenly by `frame_size` on both axes. Both sizes
must be positive integers. Every index must fall inside `columns * rows`.
Repeated indexes stay in order. One `AtlasTexture` is emitted per distinct
index, in first-seen order, and later clips reuse it.

`mode` and `loop` must agree:

```text
mode "loop" and loop true  -> play forward and repeat
mode "once" and loop false -> play forward once
```

Any other pair fails. `mode` `"pingpong"` fails in this exporter. The
current profile never emits it. `flip_h: true` fails. A clip with an empty
`frames` list fails. `fps` must be a finite number greater than `0`.

Clip names in the current profile match `[A-Za-z0-9_]+`. A name outside that
set fails until escaping is specified. `ui_hidden` clips are still exported.
The exporter does not add a `default` animation.

`anchor` stays in `animations.json`. `SpriteFrames` has no anchor field, and
this exporter does not write a `.tscn` or an `AnimatedSprite2D` offset.

### Current `topdown_rpg_v0` clips

These are the values `buildAnimations` writes today. The exporter follows
the JSON it is given if a later profile changes them.

```text
idle_down     frames  0-3   fps  8  loop
idle_up       frames  4-7   fps  8  loop
idle_left     frames  8-11  fps  8  loop
idle_right    frames 12-15  fps  8  loop
walk_down     frames 16-19  fps 10  loop
walk_up       frames 20-23  fps 10  loop
walk_left     frames 24-27  fps 10  loop
walk_right    frames 28-31  fps 10  loop
attack_down   frames 32-35  fps 12  once
attack_up     frames 36-39  fps 12  once
attack_left   frames 40-43  fps 12  once
attack_right  frames 44-47  fps 12  once
hurt          frames 48-51  fps  6  once
happy         frames 52-55  fps  6  loop
sit           frames 56-59  fps  4  loop
talk          frames 60-63  fps  6  loop
```

Examples at 96×96:

```text
walk_down frame 16    -> Rect2(0, 192, 96, 96)    speed 10, repeating
attack_right frame 44 -> Rect2(384, 480, 96, 96)  speed 12, once
```

Smaller sheets in `multi_resolution.json` keep the same indexes and use
different pixel sizes. This exporter uses only `animations.json.sheet` and
the `frame_size` / `sheet_size` in that file.

## Pack layout

Same layering as `rpgmaker_v0` and `ocad_v0`: a module under
`src/character-pack/exporters/`, invoked from `buildEngineExportArtifacts`
in `src/character-pack/processArtifacts.js`, zipped with
`buildCharacterPackZip`, and published only when
`artifactManifest.js` publishes release artifacts. Diagnostic jobs that
withhold `godot_npc_pack.zip`, `rpgmaker_pack.zip`, and `ocad_pack.zip`
withhold this zip too.

Proposed module and profile id:

```text
src/character-pack/exporters/godotSpriteFramesExport.js
godot_spriteframes_v0
```

Proposed entry point: `buildGodotSpriteFramesExport`. It returns a `files`
map, as the other exporters do. `metadata.id` is required, as it is for
`buildGodotNpcJson`.

Proposed artifact:

```text
godot_spriteframes_pack.zip
  moteweave/spriteframes/<metadata.id>/godot_spriteframes.tres
  moteweave/spriteframes/<metadata.id>/normalized_sheet.png
```

The same two paths are copied into `character_pack.zip`. They do not sit
under `AI资源库/一图全动作/<metadata.id>/`, which remains the NPC plugin
folder. The filename `godot_spriteframes.tres` is the name already reserved
in `docs/protocols/godot-npc-json.md`.

Unzip at the Godot project root, then assign the `.tres` to an
`AnimatedSprite2D` `sprite_frames` property. The texture path inside the
resource is:

```text
res://moteweave/spriteframes/<metadata.id>/normalized_sheet.png
```

The NPC plugin pack is unchanged. Its zip is still `godot_npc_pack.zip`,
and its entries are still:

```text
AI资源库/一图全动作/<metadata.id>/npc.json
AI资源库/一图全动作/<metadata.id>/sprite.png
AI资源库/一图全动作/<metadata.id>/thumb.png
```

`sprite.png` in that pack is the normalized sheet for the plugin. The
SpriteFrames pack keeps the name `normalized_sheet.png` so it matches
`animations.json.sheet`.

This exporter does not write `.tscn` files, plugin code, or `.png.import`
sidecars.

### Text shape

Public Godot 4 `.tres` files use `format=3`, one `Texture2D` ext resource,
one `AtlasTexture` sub-resource per region, and an `animations` array whose
entries carry `frames`, `loop`, `name`, and `speed`. A sketch of that shape,
for `walk_down` only:

```text
[gd_resource type="SpriteFrames" format=3]

[ext_resource type="Texture2D" path="res://moteweave/spriteframes/<id>/normalized_sheet.png" id="1_sheet"]

[sub_resource type="AtlasTexture" id="AtlasTexture_16"]
atlas = ExtResource("1_sheet")
region = Rect2(0, 192, 96, 96)

[resource]
animations = [{
"frames": [{ "duration": 1.0, "texture": SubResource("AtlasTexture_16") }],
"loop": true,
"name": &"walk_down",
"speed": 10.0
}]
```

That sketch is not a byte contract. The golden fixture will pin the writer's
exact text. A later Godot re-save is evidence that the file loads. Godot
rewrites ids and uids, so the fixture does not have to match a re-saved file
byte for byte.

## Open questions

1. **Serialized loop field.** Godot 4.7's `SpriteFrames` API has
   `loop_mode` (`LOOP_NONE`, `LOOP_LINEAR`, `LOOP_PINGPONG`) and deprecates
   the boolean `loop`. Older Godot 4 text files still store `"loop": true`
   and `"speed"`. This repo has not saved a `.tres` from a pinned editor, so
   the exact keys, `load_steps`, `uid` lines, and numeric spelling stay
   unset until the golden fixture.
2. **Ping-pong.** `animations.json` reserves `mode: "pingpong"`. Godot 4.7
   can represent it as `LOOP_PINGPONG`. This exporter rejects it until the
   fixture shows the field the pinned editor writes.
3. **Filtering.** Cells have no spacing. A filtered atlas can bleed into the
   next cell. Whether the first pack sets `AtlasTexture.filter_clip`, ships
   a nearest-filter `.png.import`, or only documents the project setting is
   undecided.
4. **`default` animation.** The sketch omits Godot's empty `default` clip.
   Whether a pinned Godot 4 build loads a file that has only the sixteen
   profile clips is undecided.
5. **Multi-resolution packs and a loose job-root `.tres`.** Both are out of
   this artifact. The first pack is the zip above, plus the same two paths
   inside `character_pack.zip`.

## Next step

Implement the exporter and a golden fixture. The fixture should cover the
`walk_down` and `attack_right` regions and speeds above, a `mode` / `loop`
mismatch, `flip_h: true`, and `pingpong`. It should also show that
`godot_npc_pack.zip` still contains only the three NPC paths.

`README.md` and the website mention `.tres` export only after that evidence
exists.
