# Generation Observability v0.3 Design

## Goal

Make AI character generation measurable before adding broader editing or extraction features.

The v0.3 block turns prompt wording, real-generation benchmark runs, Row GIF previews, and debug reports into one repeatable loop:

```text
prompt contract -> provider prompt -> generated source -> post-process -> validation -> artifacts -> local gallery
```

## Product Outcome

A user should be able to generate or benchmark character sheets and answer:

```text
Which layout was requested?
Which prompt contract version was used?
Which provider/model/config produced this sheet?
Did validation pass, warn, or fail?
Which Row GIFs prove the motion result?
Which warnings or blocking errors explain the failure?
```

This is a production-mode reliability layer, not a new public platform surface.

## Scope

### In Scope

- Structured prompt contracts for `topdown_rpg_v0` and `ocad_motion_v0`.
- Provider prompt compilation that keeps layout, identity, style, negative constraints, and validation expectations separate in code.
- Prompt contract metadata saved into generation artifacts and benchmark reports.
- A local benchmark gallery API that reads benchmark runs from the local artifact store.
- A local UI panel that lists benchmark runs and items with source, normalized sheet, Row GIF previews, status, prompt, and debug links.
- Tests that prove 8x8 and OCAD prompt protocols stay separate.
- Protocol and runbook updates for the new contract/gallery loop.

### Out Of Scope

- Asset extraction from arbitrary UI, prop, or scene sheets.
- Per-frame masked repair or inpainting.
- Multi-reference weighted fusion.
- Community sharing, auth, billing, cloud storage, or public benchmark publishing.
- New model training, LoRA, embeddings, or scraping pipelines.
- A full prompt A/B comparison editor. v0.3 records prompt versions and exposes enough metadata for manual comparison.

## Architecture

### Prompt Contracts

Prompt contracts are structured JavaScript objects compiled into provider-facing text.

```text
src/character-pack/promptContracts.js
  buildCharacterPromptContract()
  compileCharacterPromptContract()
  compileProviderPrompt()
```

The provider keeps its current public entry points but delegates wording to the contract module:

```text
src/character-pack/providers/geminiProvider.js
  buildOpenRouterCharacterPrompt()
  generateCharacterSource()
```

The contract object records:

```text
schema_version
contract_version
preset
subject
layout_contract
identity_contract
style_contract
negative_contract
validation_contract
```

### Generation Metadata

Generated artifacts should preserve prompt contract identity in:

```text
generation.json
metadata.json.generation
benchmark_report.json.items[].generation
```

Minimum fields:

```text
prompt_contract.schema_version
prompt_contract.contract_version
prompt_contract.preset
prompt_contract.layout_id
prompt_contract.validation_expectations
```

### Benchmark Gallery

The gallery reads existing local benchmark output without changing the benchmark writer's artifact layout:

```text
generated/openrouter-benchmarks/<run_id>/benchmark_report.json
generated/openrouter-benchmarks/<run_id>/items/<case_id>_v<variant>/
```

The backend returns a compact index for UI browsing:

```text
GET /api/benchmark-gallery
```

Response:

```json
{
  "runs": [
    {
      "run_id": "openrouter_bench_20260531_010203",
      "created_at": "2026-05-31T01:02:03.000Z",
      "preset": "topdown_rpg_v0",
      "summary": { "total": 2, "validation": { "pass": 1, "warning": 1, "fail": 0 } },
      "items": [
        {
          "id": "blue_wizard_v1",
          "case_id": "blue_wizard",
          "variant": 1,
          "status": "done",
          "validation_status": "pass",
          "source_url": "/generated/openrouter-benchmarks/openrouter_bench_20260531_010203/items/blue_wizard_v1/source.png",
          "normalized_sheet_url": "/generated/openrouter-benchmarks/openrouter_bench_20260531_010203/items/blue_wizard_v1/normalized_sheet.png",
          "prompt_url": "/generated/openrouter-benchmarks/openrouter_bench_20260531_010203/items/blue_wizard_v1/prompt.txt",
          "debug_report_url": "/generated/openrouter-benchmarks/openrouter_bench_20260531_010203/items/blue_wizard_v1/debug_report.json",
          "row_gif_previews": []
        }
      ]
    }
  ]
}
```

The endpoint is local-only by virtue of the existing local server. It scans only known benchmark roots and ignores unrelated generated folders.

## Acceptance Criteria

- `buildCharacterPromptContract({ preset: 'topdown_rpg_v0' })` returns a structured contract with 8x8 layout requirements and no OCAD fixed-region action names.
- `buildCharacterPromptContract({ preset: 'ocad_motion_v0' })` returns OCAD fixed-region requirements and does not claim the output is exactly 8 columns by 8 rows.
- Provider prompt text still includes strict structural template guidance, pure white background guidance, and prop/layout drift negative constraints.
- Provider prompt text adds image guidance from the same contract compiler for template, reference, and palette images.
- `generateCharacterSource()` returns prompt contract metadata.
- Server generation artifacts include prompt contract metadata in `generation.json`.
- OpenRouter benchmark items include prompt contract metadata when the provider returns it.
- `GET /api/benchmark-gallery` returns a compact run/item index from local benchmark reports.
- The UI exposes a local benchmark gallery panel without requiring a live provider key.
- Tests cover prompt contracts, provider integration, gallery indexing, and existing generation behavior.
- Full `npm test` passes before a feature-complete commit.

## Commit Strategy

Use small coherent commits:

1. `docs: add generation observability v0.3 plan`
2. `feat: add character prompt contracts`
3. `feat: expose local benchmark gallery`
4. `docs: document prompt contracts and benchmark gallery`

If a slice spans more files than expected, commit after that slice passes focused tests.
