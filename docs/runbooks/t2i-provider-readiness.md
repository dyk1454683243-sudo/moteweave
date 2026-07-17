# T2I Provider Readiness Runbook

**Status:** Draft for the next live API window
**Scope:** Character text-to-image only. No scene/tile live generation.

Use this runbook when provider credentials or route availability are unstable.
The goal is to avoid spending live provider budget until the provider route,
prompt contract, and candidate budget are known.

## Current State

- Character text-to-image uses server-side provider presets; browser code never
  receives provider keys.
- `quality_character_v0` generates one single character image, does not upload
  the structural template, and runs local pixel finishing afterward.
- `production_sheet_v0` generates a full sheet, uploads the selected layout
  template, and then routes the selected candidate through `processSheetBuffer`.
- Provider policy or terms blocks are classified as:
  - `failure_status: provider_route_blocked`
  - `retry_hint: switch_provider_preset`
- When `provider_route_blocked` occurs, candidate generation stops after the
  first blocked provider request.
- `benchmark t2i-golden` live currently exercises the
  `quality_character_v0` path only. Use `generate --t2i-mode production_sheet_v0`
  for production-sheet route smokes until the benchmark supports production
  sheet generation directly.

## Provider Route Matrix

| Route | Config mechanism | Provider family | T2I path | First tomorrow check | Risk |
|---|---|---|---|---|---|
| OpenRouter default | `OPENROUTER_API_KEY`, optional `OPENROUTER_IMAGE_MODEL`, `OPENROUTER_BASE_URL` | `openrouter` | chat completions with `modalities: ["image", "text"]` | 1-case `quality_character_v0`, candidate 1 | Previously produced provider terms block on image route. Do not raise candidate count if blocked. |
| OpenRouter preset | `CHARACTER_PROVIDER_PRESETS` item with `provider: "openrouter"` and `apiKeyEnv` | `openrouter` | same OpenRouter image route, selected by `--provider-preset` / `providerPresetId` | 1-case `quality_character_v0`, candidate 1, explicit preset | Explicit preset disables fallback. Good for isolating a route, but failures are strict. |
| Gemini native preset | `CHARACTER_PROVIDER_PRESETS` item with `provider: "gemini"` and `apiKeyEnv` | `gemini` | Gemini `:generateContent` with image response modality | 1-case `quality_character_v0`, candidate 1, explicit preset | Avoids OpenRouter route policy, but depends on native Gemini quota and model availability. |
| Implicit same-family fallback | Multiple available presets, no explicit provider preset | same provider family only | default preset then same-family fallback | Use only after explicit route smokes pass | Cross-provider fallback is disabled unless `CHARACTER_ALLOW_CROSS_PROVIDER_FALLBACK=1`. |

Recommended preset shape:

```json
[
  {
    "id": "openrouter-image",
    "label": "OpenRouter image route",
    "provider": "openrouter",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "model": "google/gemini-2.5-flash-image",
    "image_size": "2K"
  },
  {
    "id": "gemini-native-image",
    "label": "Gemini native image route",
    "provider": "gemini",
    "apiKeyEnv": "GEMINI_API_KEY",
    "model": "gemini-3.1-flash-image-preview",
    "image_size": "2K"
  }
]
```

Keep real keys in `.env` only. Do not commit `.env`.

Provider selection rules:

- `CHARACTER_PROVIDER_PRESETS` is server-side JSON. `/api/gemini-state`
  exposes preset id, label, model, provider family, and availability; it does
  not expose API keys.
- `--provider-preset` and `providerPresetId` pin one route and disable fallback.
- Without an explicit preset, fallback is same-provider-family only unless
  `CHARACTER_ALLOW_CROSS_PROVIDER_FALLBACK=1`.
- `maxProviderCalls` is checked before every provider attempt. Failed fallback
  attempts still spend call budget.
- Any HTTP `403`, provider terms message, or provider policy message is
  classified as `provider_route_blocked`.

## Static Prompt Audit

These provider-free commands were run on 2026-06-11 and wrote prompt samples to
`/tmp/ai-character-pack-tool-static-prompts` and
`/tmp/game-tools-t2i-prompt-audit`.

```bash
npm run character-pack -- generate \
  --dry-run-prompt \
  --description "silver swordswoman, dark blue cloak, slender one-handed sword, gold shoulder armor, compact small body" \
  --t2i-mode quality_character_v0 \
  --character-preset rpg_humanoid_v0 \
  --image-size 2K \
  --candidate-count 4 \
  --output-dir /tmp/ai-character-pack-tool-static-prompts \
  --job-id quality_silver_swordswoman_static
```

Static finding:

- `quality_character_v0` prompt does not include structural template-image wording.
- It asks for one centered full-body character, not a sheet or grid.
- It has explicit scale constraints: roughly 35-60% canvas height and 20-50%
  canvas width.
- Alpha mode says to use true transparency if the provider supports it, otherwise
  pure white `#ffffff`. This is lower policy risk than a structural image route,
  but should be checked visually for simulated checkerboard or fake alpha.
- Main quality risk is ordinary prompt interpretation, not provider route
  control-image policy.

Production-sheet dry-run:

```bash
npm run character-pack -- generate \
  --dry-run-prompt \
  --description "blue wizard with crescent hat, tiny staff, readable robe silhouette" \
  --t2i-mode production_sheet_v0 \
  --preset fixed_region_motion_v0 \
  --image-size 2K \
  --candidate-count 4 \
  --output-dir /tmp/ai-character-pack-tool-static-prompts \
  --job-id production_blue_wizard_static
```

Static finding:

- `production_sheet_v0` prompt explicitly says `structural layout template`.
- It uploads a structural template and asks the provider to preserve fixed
  regions and action layout.
- This is correct for sheet generation, but it is the higher policy/route-block
  risk. Do not use this route as the first API smoke after credentials recover.

Additional prompt audit commands:

```bash
npm run character-pack -- generate \
  --description "silver swordswoman, deep blue cloak, slender one-handed sword, gold shoulder armor, small body" \
  --t2i-mode quality_character_v0 \
  --character-preset two_to_one_character_v0 \
  --background-mode alpha \
  --prompt-field "outfit=blue cloak and gold shoulder armor" \
  --dry-run-prompt \
  --output-dir /tmp/game-tools-t2i-prompt-audit \
  --job-id quality_character_v0_alpha
```

```bash
npm run character-pack -- generate \
  --description "hooded merchant, layered scarf, small satchel, warm readable palette" \
  --t2i-mode production_sheet_v0 \
  --preset fixed_region_motion_v0 \
  --dry-run-prompt \
  --output-dir /tmp/game-tools-t2i-prompt-audit \
  --job-id production_sheet_v0_ocad_template
```

```bash
npm run character-pack -- generate \
  --description "blue wizard with crescent hat, tiny staff, readable robe silhouette" \
  --t2i-mode production_sheet_v0 \
  --preset topdown_rpg_v0 \
  --dry-run-prompt \
  --output-dir /tmp/game-tools-t2i-prompt-audit \
  --job-id production_sheet_v0_topdown_template
```

```bash
npm run character-pack -- generate \
  --description "hooded merchant, layered scarf, small satchel, warm readable palette" \
  --t2i-mode production_sheet_v0 \
  --preset fixed_region_motion_v0 \
  --disable-template \
  --dry-run-prompt \
  --output-dir /tmp/game-tools-t2i-prompt-audit \
  --job-id production_sheet_v0_ocad_no_template
```

Then inspect:

```bash
rg -n "ControlNet|provided image|template|transparent|pure white|35-60|20-50|grid structure|fixed-region" /tmp/game-tools-t2i-prompt-audit
```

Observed static risks:

- `production_sheet_v0` with template emits `Strictly use the provided image as
  a structural layout template`.
- `production_sheet_v0 --disable-template` still emits `provided image`,
  `template`, and `attached template layout` wording in the prompt. Split the
  future production contract into layout-spec rules and attached-template-image
  rules.
- OCAD is a non-uniform fixed-region layout, but shared structural wording still
  says `grid structure`. Use layout-specific wording later: `cell grid` for
  `topdown_rpg_v0`, `fixed regions` for `fixed_region_motion_v0`.
- Production background language mentions white, black, or transparent before
  requiring white. Prefer one hard rule per mode: flat pure white `#ffffff`, or
  true alpha when alpha mode is explicitly selected and supported.
- `quality_character_v0` prompt target scale is stricter than the current
  scoring penalty thresholds. Future tuning should use target plus hard-max
  wording, or align scoring thresholds with the prompt.
- A useful provider-free follow-up is
  `benchmark t2i-golden --dry-run-prompts`, which does not exist yet. It should
  write one prompt folder per golden case.

## Four-Case Live Gate Plan

Provider-free dry-run plan:

```bash
npm run character-pack -- benchmark t2i-golden \
  --dry-run-plan \
  --case-id silver_swordswoman_zh \
  --case-id blue_wizard_en \
  --case-id clockwork_guard_en \
  --case-id xianxia_swordsman_zh \
  --candidate-count 4 \
  --t2i-mode quality_character_v0 \
  --image-size 2K
```

Observed dry-run plan:

- cases: 4
- candidate count: 4
- planned provider calls: 16
- mode: `quality_character_v0`
- image size: `2K`
- aspect ratio: `1:1`

Chosen cases:

| Case | Why it is included |
|---|---|
| `silver_swordswoman_zh` | Chinese prompt, humanoid, cloak, weapon, metallic accent. |
| `blue_wizard_en` | English prompt, readable silhouette, hat and staff. |
| `clockwork_guard_en` | Non-cloth armor plates, glow core, sturdy compact body. |
| `xianxia_swordsman_zh` | Chinese fantasy costume, back sword, flowing elements that must stay compact. |

## Tomorrow Execution Order

Run these in order. Stop at the first route-blocking failure and switch provider
preset before increasing candidate count.

### 1. Provider state smoke

Start the local server and check `/api/gemini-state` from the browser or CLI.
Confirm at least one preset is `available: true` and that the selected preset is
the one you intend to test.

### 2. One-call quality smoke

Use an explicit provider preset. Replace `<preset-id>` with the route being
tested.

```bash
npm run character-pack -- benchmark t2i-golden \
  --case-id silver_swordswoman_zh \
  --candidate-count 1 \
  --t2i-mode quality_character_v0 \
  --image-size 2K \
  --provider-preset <preset-id> \
  --max-provider-calls 1 \
  --output-dir /tmp/t2i-live-smoke \
  --run-id <preset-id>_quality_1case \
  --yes
```

Expected decision:

- If status is `provider_route_blocked`, stop using that preset for this route.
- If status is provider quota or auth failure, fix credentials/quota before any
  benchmark.
- If status is `done`, continue to the 4-case gate.

### 3. Four-case quality gate

```bash
npm run character-pack -- benchmark t2i-golden \
  --case-id silver_swordswoman_zh \
  --case-id blue_wizard_en \
  --case-id clockwork_guard_en \
  --case-id xianxia_swordsman_zh \
  --candidate-count 4 \
  --t2i-mode quality_character_v0 \
  --image-size 2K \
  --provider-preset <preset-id> \
  --max-provider-calls 16 \
  --output-dir /tmp/t2i-live-gates \
  --run-id <preset-id>_quality_4case \
  --yes
```

### 4. Offline review

```bash
npm run character-pack -- benchmark t2i-golden-review \
  --run-dir /tmp/t2i-live-gates/<preset-id>_quality_4case
```

Read `t2i_golden_review.json` and follow
`closure_analysis.primary_action`:

- `artifact_and_provider_reliability`: do not change prompt yet; fix provider,
  route, quota, or artifact failure.
- `prompt_scale_contract`: tune the prompt contract around subject scale,
  bbox, centering, and margins.
- `pixel_finishing_calibration`: tune palette snap, outline, downsample, or
  finishing thresholds.
- `candidate_selection_and_sampling`: inspect candidate scores and sampling
  settings before prompt work.

### 5. Production-sheet route smoke

Only after `quality_character_v0` route is known healthy, run a 1-call
`production_sheet_v0` smoke with `generate`. Do not use
`benchmark t2i-golden --t2i-mode production_sheet_v0` for this check yet; live
benchmark execution currently exercises the quality-character path.

```bash
npm run character-pack -- generate \
  --description "blue wizard with crescent hat, tiny staff, readable robe silhouette" \
  --t2i-mode production_sheet_v0 \
  --preset fixed_region_motion_v0 \
  --candidate-count 1 \
  --image-size 2K \
  --provider-preset <preset-id> \
  --max-provider-calls 1 \
  --output-dir /tmp/t2i-live-smoke \
  --job-id <preset-id>_production_1case \
  --yes
```

## Stop Rules

- Do not rerun the same provider route with higher candidate count after
  `provider_route_blocked`.
- Do not compare image quality until the route produces at least one completed
  candidate.
- Do not change prompt wording based on a provider route block alone; first
  confirm whether another preset can serve the same request.
- Do not use `production_sheet_v0` as the first live smoke after an API outage.
