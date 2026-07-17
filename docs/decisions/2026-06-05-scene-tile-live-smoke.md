# Scene Tile Live Smoke

**Date:** 2026-06-05
**Status:** Recorded

## Context

After provider-free tile sheet ingestion, v0.4 needed one live smoke to verify
that the scene tile prompt, provider adapter, PNG decode, source-sheet
normalization, quality gate, LDtk export, and scene pack artifact writer work as
one chain.

This was intentionally not a benchmark and not a prompt-quality closure pass.

## Implementation

Added:

- `src/scene-pack/tileGenerate.js`
- `scene tile-generate --yes`
- `docs/protocols/scene-tile-live-generation.md`

The live path:

1. Compiles `scene_tile_prompt_contract_v0_1`.
2. Calls the selected configured image provider.
3. Decodes the returned provider image.
4. Nearest-neighbor resizes provider output to the exact `192x192`
   `topdown_tile_dual_grid_v0` source sheet when needed.
5. Routes the normalized source sheet through `buildScenePackFromTileSheet()`.
6. Writes `prompt.txt`, `generation.json`, `scene.json`, `tile_atlas.json`,
   `tile_map.json`, `quality_gate.json`, `project.ldtk`, `tileset.png`, and
   `scene_pack.zip`.

## Live Attempts

### `scene_tile_live_smoke_20260605_01`

- Provider preset: `gemini31`
- Provider: OpenRouter
- Model: `google/gemini-3.1-flash-image-preview`
- Image config: `1K`, `1:1`
- Result: no artifacts
- Failure: network-level `fetch failed`

### `scene_tile_live_smoke_20260605_02`

- Provider preset: `gemini-native`
- Provider: Gemini API
- Model: `gemini-3.1-flash-image-preview`
- Image config: `1K`, `1:1`
- Result: no artifacts
- Failure: quota exceeded before image generation

### `scene_tile_live_smoke_20260605_03`

- Provider preset: `gemini25`
- Provider: OpenRouter
- Model: `google/gemini-2.5-flash-image`
- Image config: `1K`, `1:1`
- Provider source size: `1024x1024`
- Normalized source size: `192x192`
- Resize method: nearest-neighbor
- Artifact directory: `generated/cli/scene_tile_live_smoke_20260605_03`
- CLI status: `failed_quality_gate`
- Quality status: `fail`
- Blocking errors:
  - `tile.visual_seam_mismatch`
  - `tile.self_loop_mismatch`
- Visual seams: `30 / 38` checked pairs failed, max edge delta `94.1667`
- Self loops: `32 / 32` checked axes failed, max edge delta `93.2333`

The provider produced a recognizable `4x4` tile sheet, but the tiles were not
seam-ready. Diagonal paths and rock/grass texture transitions did not continue
cleanly across shared edges, and repeated single tiles produced hard seams.

## Decision

The live scene tile plumbing is usable as a smoke gate: it can call a provider,
normalize provider output to the profile source size, write all expected
artifacts, and preserve failed quality diagnostics.

The tile generation quality itself is not ready. The next quality work should
target seam and self-loop generation before adding WFC, map editing, or broader
scene-pack product claims.

## Follow-Up

Recommended next unit:

- Strengthen the scene tile prompt contract around edge-continuity and
  self-loop-compatible texture fields.
- Add a tiny live/pseudo-live comparison using the same quality metrics before
  any 20-case tile benchmark.
- Consider a minimal provider-free edge-conditioning prototype only if prompt
  strengthening cannot reduce `visual_seams` and `tile_self_loops`.

Do not build a full image repair or inpainting system yet.
