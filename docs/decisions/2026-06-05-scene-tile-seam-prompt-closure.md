# Scene Tile Seam Prompt Closure

**Date:** 2026-06-05
**Status:** Recorded

## Context

The first live scene tile smoke proved the provider and artifact chain worked,
but `scene_tile_prompt_contract_v0_1` failed the tile quality gate:

- run id: `scene_tile_live_smoke_20260605_03`
- provider preset: `gemini25`
- provider/model: OpenRouter `google/gemini-2.5-flash-image`
- image config: `1K`, `1:1`
- status: `failed_quality_gate`
- blocking errors:
  - `tile.visual_seam_mismatch`
  - `tile.self_loop_mismatch`
- visual seams: `30 / 38` failed, max edge delta `94.1667`
- self loops: `32 / 32` failed, max edge delta `93.2333`

Visual audit showed the model could produce a recognizable `4x4` sheet, but it
drew independent mini-scenes rather than seam-constrained tiles.

## Change

Upgraded the prompt contract to:

```text
scene_tile_prompt_contract_v0_2
```

The source profile did not change. The prompt now adds focused seam/self-loop
constraints:

- every central `32x32` runtime tile has an outer `3 px` loopable border band,
- first and last pixel columns must be compatible for horizontal repeats,
- first and last pixel rows must be compatible for vertical repeats,
- tiles with the same edge signature must use the same terrain material, color
  ramp, texture density, and transition shape along the shared edge,
- the `16` cells are one seamless tile system, not separate mini-scenes,
- diagonal paths and rock veins may not terminate at tile edges unless the
  matching neighbor edge continues them.

## Verification

Focused tests:

```bash
node --test test/scene-pack/tilePromptContracts.test.js test/scene-pack/tileGenerate.test.js test/scene-pack/tileSheetIngestion.test.js test/scene-pack/tileQualityGate.test.js test/character-pack/cli.test.js
```

Result: `31` pass, `0` fail.

## Live Smoke Results

All runs used:

- provider preset: `gemini25`
- provider/model: OpenRouter `google/gemini-2.5-flash-image`
- image config: `1K`, `1:1`
- source postprocess: provider `1024x1024` to profile `192x192`, nearest-neighbor
- prompt subject: `mossy cliff path terrain tiles, grass, stone edge, dirt transition`

| Run id | Contract | Status | Visual seams | Visual max delta | Self-loop axes | Self-loop max delta |
|---|---|---|---:|---:|---:|---:|
| `scene_tile_live_smoke_20260605_03` | `v0_1` | `fail` | `30 / 38` | `94.1667` | `32 / 32` | `93.2333` |
| `scene_tile_live_smoke_v02_20260605_01` | `v0_2` | `fail` | `30 / 38` | `191.8333` | `32 / 32` | `191.8667` |
| `scene_tile_live_smoke_v02_20260605_02` | `v0_2` | `fail` | `38 / 38` | `87.8` | `32 / 32` | `71.2333` |

## Decision

Prompt-only seam strengthening did not close the quality gate.

`v0_2` is still worth keeping because it makes the provider contract and
metadata more explicit, and the second v0.2 smoke reduced maximum edge deltas.
However, failure counts remain unacceptable and one run regressed badly. The
dominant issue is not source sheet layout anymore; it is edge-conditioned tile
content.

## Next Step

Do not move to WFC, map editor, or broad scene-pack claims yet.

Recommended next unit:

- design a minimal provider-free edge-conditioning prototype that can locally
  align or synthesize simple border bands for generated tiles,
- keep it opt-in/reportable until it proves it improves `visual_seams` and
  `tile_self_loops`,
- rerun the same smoke gate before considering a larger tile benchmark.

Avoid a full inpainting or repair system until the smallest edge-conditioning
prototype has been tested.
