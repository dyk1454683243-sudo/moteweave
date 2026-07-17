# Editor Metadata Protocol

`editor_metadata.json` is a neutral companion file for `normalized_sheet.png`.

It records animation frame ranges, per-frame rectangles, attachment points, and visible bounds in a shape that sprite editors and pipeline scripts can consume without depending on `debug_report.json`.

## Location

```text
editor_metadata.json
character_pack.zip/editor_metadata.json
```

The local artifact API also exposes:

```text
editor_metadata_url
```

## Top Level

```json
{
  "version": "0.1",
  "id": "npc_20260531_120000_sample_hero",
  "profile": "topdown_rpg_v0",
  "sheet": "normalized_sheet.png",
  "frame_size": { "w": 96, "h": 96 },
  "sheet_size": { "w": 768, "h": 768 },
  "frame_tags": [],
  "frames": {},
  "attachments": [],
  "slices": []
}
```

## Frame Tags

`frame_tags` describes runtime animation ranges:

```json
{
  "name": "walk_down",
  "from": 16,
  "to": 19,
  "fps": 10,
  "loop": true,
  "mode": "loop",
  "direction": "forward"
}
```

These tags are Aseprite-compatible in spirit: they preserve animation names and contiguous frame ranges for editor import workflows. The implementation is original and does not copy editor code.

## Frames

`frames` is keyed by zero-padded frame ids:

```json
{
  "frame_016": {
    "index": 16,
    "frame": { "x": 0, "y": 192, "w": 96, "h": 96 },
    "duration": 100,
    "runtime_action": "walk_down",
    "source": { "layout": "topdown_rpg_v0", "runtime_action": "walk_down" }
  }
}
```

For fixed-region OCAD-derived frames, `source` may include:

```text
layout
runtime_action
action
region_key
frame
flip_h
```

## Attachments

Attachments are frame-space points:

```json
{
  "name": "feet",
  "frame": 16,
  "point": { "x": 48, "y": 88 },
  "space": "frame"
}
```

Default attachments:

```text
feet
head
hand_left
hand_right
source_feet
```

`source_feet` is emitted only when source-frame anchor information exists.

## Slices

Slices are frame-space rectangles:

```json
{
  "name": "frame_016_bounds",
  "frame": 16,
  "rect": { "x": 42, "y": 40, "w": 13, "h": 49 },
  "space": "frame"
}
```

Bounds slices are emitted only when a normalized visible bbox exists.

## Compatibility Rules

- `editor_metadata.json` is a stable workflow artifact, not a debug report.
- Importers should use `frame_tags`, `attachments`, and `slices` first, and inspect `debug_report.json` only when troubleshooting.
- New attachment names should be additive and should not break existing importers.
