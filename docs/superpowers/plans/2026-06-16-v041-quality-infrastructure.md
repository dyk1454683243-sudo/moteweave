# v0.4.1 Quality Infrastructure Plan

**Date:** 2026-06-16
**Status:** Implemented
**Scope:** Inserted engineering-quality block after character generation cleanup and GitHub publication, before the next scene/tile deepening block.

## Goal

Move the project from "features are available" to "quality is measurable,
repeatable, and publishable." This block does not replace the selected
scene/tile direction. It creates a quality and provider configuration layer so
future scene, tile, and character work can be evaluated without relying on chat
memory or one-off manual checks.

## Route Position

```text
v0.4 current closure
-> character T2I cleanup, background cleanup, local image benchmark, GitHub publication
-> v0.4.1 Quality Infrastructure
-> v0.5 / next major scene-tile deepening
```

## P0: Local Golden Set And Gate Layers

Status: implemented for provider-free local image gates on 2026-06-16.

Build a neutral, repository-safe local quality set and split gates by use:

- `smoke`: fast provider-free sanity check for common regressions.
- `local-golden`: local image quality regression using controlled fixtures.
- `release`: fuller publish-before-merge gate that includes docs/readiness checks.
- `live`: quota-spending gate, always opt-in and never required for local CI.

Requirements:

- Golden samples must avoid named-IP, unlicensed, or local-only assets.
- Local-only named-IP samples may remain ignored on disk but must not appear in
  tracked manifests or public release claims.
- Each gate must define pass/warning/fail interpretation before it is used for
  release claims.

Done when:

- CLI commands and docs name each gate layer. `Done: benchmark local-images
  supports --gate-layer smoke|local-golden|release, and live is reserved for
  explicit quota-spending commands. package.json exposes quality:smoke,
  quality:local-golden, and quality:release.`
- The tracked local manifest only references publishable samples. `Done:
  manifest validation rejects non-repository-safe source_rights values.`
- Release notes can cite provider-free gate results without implying live model
  quality. `Done: local image reports now include gate_layer, quality_gate,
  sample count, interpretation, and claim_boundary.`

## P1: User Provider And Model Configuration

Status: implemented for current OpenRouter-compatible and Gemini-native routes
on 2026-06-16. Follow-up on 2026-06-16 added a browser-session provider form
for local web runs.

Let the user provide API keys and model names locally while the pipeline keeps a
single internal generation contract.

Requirements:

- API keys stay in `.env`, shell environment, or another local-only storage path.
- The browser/client never receives raw provider secrets.
- Users can provide provider type and model name without code changes.
- Supported first classes:
  - OpenRouter-compatible chat/image route
  - Gemini native image route
  - OpenAI-compatible image route, if/when an adapter is added
- All adapters normalize outputs into the same internal shape:
  - image buffer
  - provider id/type
  - model name
  - generation options
  - provider metadata
  - error taxonomy

Done when:

- The config contract is documented. `Done: .env.example,
  docs/runbooks/character-pack-cli.md, and docs/protocols/local-api-boundaries.md
  document CHARACTER_IMAGE_PROVIDER / CHARACTER_IMAGE_MODEL, key handling, and
  advanced CHARACTER_PROVIDER_PRESETS.`
- Existing OpenRouter/Gemini paths use the same provider selection surface.
  `Done: providerConfig supports simple CHARACTER_IMAGE_* defaults and advanced
  presets for OpenRouter-compatible and Gemini-native routes.`
- The local web UI can accept a provider type, model, and API key without
  editing `.env`.
  `Done: POST /api/provider-config stores a browser-session override in the
  running local Node server, returns only sanitized provider_state, and clears
  the raw key from the browser input after saving.`
- Unknown or blocked provider routes fail with actionable, non-secret errors.
  `Done: unsupported provider config reports a configuration_error without
  echoing raw provider values or keys; existing provider route blocks keep
  provider_route_blocked / switch_provider_preset taxonomy.`

## P2: Live Benchmark Through The Unified Adapter

Status: implemented for text-to-image golden benchmark evidence on 2026-06-16.

Connect quota-spending benchmark runs to the same user provider/model config
layer.

Requirements:

- Live benchmark commands require explicit quota consent.
- Reports record provider type, model name, generation options, and failure taxonomy.
- Results can compare model/config variants without changing benchmark case definitions.
- Live results are stored as evidence, not broad quality claims unless sample size
  and pass criteria support that claim.

Done when:

- A dry-run plan shows expected calls and selected provider/model. `Done:
  benchmark t2i-golden --dry-run-plan reports planned_provider_calls and
  sanitized provider_config.`
- A live run can execute from user config and write comparable reports. `Done:
  benchmark t2i-golden live reports include provider_config,
  generation_options, provider_call_budget, and per-case candidate evidence.`
- Provider route failures are separated from image-quality failures. `Done:
  t2i_golden_report.json includes failure_taxonomy, with provider route blocks
  classified as provider.route_blocked and provider/model failures separated
  from later offline image-quality review issues.`

## P3: Visual Gallery And Release Report

Status: implemented for provider-free local image gates on 2026-06-16.

Make quality evidence easy to inspect.

Requirements:

- Local benchmark reports aggregate per-sample status, warnings, before/after
  previews, and key metrics.
- Gallery/report paths should be deterministic inside each run directory.
- Reports should make it clear whether a result is provider-free, live, or mixed.

Done when:

- The local quality report can be opened and reviewed without digging through
  individual output folders. `Done: benchmark local-images writes
  local_image_benchmark.html with run mode, gate checks, sample cards,
  before/after previews, warnings, blocking errors, and key metrics.`
- Release readiness points to the latest local-golden/release gate artifacts.
  `Done: runbook instructs release notes to cite the exact quality:release run
  id, sample count, quality gate status, and HTML/JSON report paths.`

## Claim Boundaries

- Do not claim parity with external tools from a small or local-only sample set.
- Do not claim live generation quality without live runs against the same gates.
- Do not commit local named-IP samples or generated outputs.
- Do not expose API keys to UI/client code.

## Tracking Notes

- This plan is a route insertion. It is allowed to delay scene/tile deepening,
  but it does not cancel it.
- Any new provider adapter must pass the existing IP, attribution, and secret
  handling rules in `AGENTS.md`.
- Implemented on 2026-06-16 across P0-P3 with provider-free local gates,
  user-selected provider/model config, t2i live benchmark evidence, and local
  visual quality reports.
