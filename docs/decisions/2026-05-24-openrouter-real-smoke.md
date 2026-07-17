# OpenRouter Real Smoke Result

Date: 2026-05-24

## Decision

Keep the OpenRouter path enabled as the v0.2 live generation provider, but do not treat one successful smoke run as a full quality benchmark.

## Evidence

Command:

```bash
CHARACTER_TOOL_URL=http://localhost:4274 OPENROUTER_SMOKE_IMAGE_SIZE=1K npm run smoke:openrouter
```

Result:

```text
status: done
provider: openrouter
model: google/gemini-3.1-flash-image-preview
job_id: job_mpjyr21b_ukmoxd
row_gif_count: 16
validation: pass
```

The generated source image entered the same post-processing pipeline as uploads and produced:

```text
source.png
normalized_sheet.png
debug_report.json
16 row GIF previews
character_pack.zip
```

## Boundaries

This verifies that a real provider call can complete end to end. It does not prove prompt quality, template robustness, style consistency, or benchmark reliability across many character descriptions.

## Next Benchmark Gate

Before changing the template strategy, adding ControlNet, or building auto-correction heuristics from assumptions, run a larger sample:

```text
20-30 character descriptions
5 generated variants each if budget allows
summary metrics: validation status, halo score, duplicate frames, walk motion, direction consistency, action motion, failed modes
```
