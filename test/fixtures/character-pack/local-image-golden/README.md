# Local Image Golden Fixtures

This directory is the controlled offline image set for character image quality
gates. It is intentionally separate from legacy compatibility fixtures.

`../topdown_rpg_v0_sample_hero.png` is not part of this gate. Keep it available for
the older process-sheet tests that already depend on it, but do not use it as a
baseline for new local-image quality work.

## Purpose

- Run provider-free image quality checks when live image APIs are unavailable.
- Keep input images reviewed, named, and documented before they become test
  fixtures.
- Separate single-character images, full sheets, OCAD sheets, and known-bad
  cases so benchmark results are comparable.

## Directory Layout

- `single-character/`: one-character source images for pixel finishing, bbox,
  background, scale, palette, and outline checks.
- `topdown-sheet/`: uniform grid sprite sheets for topdown layout validation.
- `ocad-sheet/`: fixed-region OCAD motion sheets for region slicing and motion
  duplicate diagnostics.
- `bad-cases/`: intentional failures such as dirty backgrounds, edge-cropped
  characters, oversized subjects, blank cells, or duplicate motion frames.

## Fixture Rules

- Add only images that are original, user-provided, or clearly licensed for
  repository test use.
- Do not bulk-copy from `generated/` or `output/`. Promote a generated image only
  after manual review and manifest entry.
- Every committed image must have a matching entry in `manifest.json`.
- Keep file names stable, lowercase, and descriptive:
  `kind_subject_variant.png`.
- Make the file extension match the encoded format, such as `.png` for PNG and
  `.jpg` for JPEG.
- Prefer small fixture files. If a test needs large local samples, keep those
  outside the repository and document the path in a runbook instead.
- `ocad-sheet/fixed_region_sample_hero.png` is repository-owned and
  deterministically regenerated together with the active fixed-region template:

  ```bash
  npm run guard:focused -- node scripts/create-fixed-region-motion-assets.mjs
  ```

## CLI

Validate the manifest without running scoring:

```bash
npm run character-pack -- benchmark local-images-validate
```

Add one reviewed local image:

```bash
npm run character-pack -- benchmark local-images-add \
  --input /absolute/path/to/image.png \
  --id single_warrior_concept \
  --kind single_character \
  --profile quality_character_v0 \
  --source-rights user_provided_for_repository_test_use \
  --expected-check baseline_quality \
  --notes "clean single-character source"
```

Run the current manifest:

```bash
npm run character-pack -- benchmark local-images \
  --output-dir generated/local-image-benchmarks \
  --run-id local_image_check \
  --gate-layer local-golden
```

Provider-free gate layers:

- `smoke`: fast local regression sanity check; no provider quota.
- `local-golden`: default controlled local fixture gate.
- `release`: stricter publish-before-merge local fixture gate.
- `live`: quota-spending provider gate; do not use it with this provider-free
  fixture command.

Each run writes `local_image_benchmark.json`, `local_image_benchmark.md`, and
`local_image_benchmark.html`. Use the HTML report for visual review of gate
status, before/after previews, warnings, blocking errors, and key metrics.

Compare background cleanup modes:

```bash
npm run character-pack -- benchmark local-images \
  --background-sweep \
  --run-id local_background_check
```

Filter examples:

```bash
npm run character-pack -- benchmark local-images --kind single_character
npm run character-pack -- benchmark local-images --id sample_id
```

## Manifest Fields

Each sample entry should include:

- `id`: stable fixture id used by tests and reports.
- `file`: path relative to this directory.
- `kind`: `single_character`, `topdown_sheet`, `ocad_sheet`, or `bad_case`.
- `profile`: expected processing profile, such as `quality_character_v0`,
  `topdown_rpg_v0`, or `fixed_region_motion_v0`. Historical
  `ocad_motion_v0` entries are retained only to cover the legacy alias path.
- `source_rights`: short note such as `original`,
  `user_provided_for_repository_test_use`, or `cc0`.
- `sha256`: SHA-256 hash of the committed image file.
- `image`: encoded image metadata with `width`, `height`, and `format`.
- `expected_checks`: checks the fixture is intended to exercise.
- `notes`: short human-readable context.

`source_rights` must be repository-safe and publishable for test use. Allowed
values are `original`, `test_generated`, `generated_by_ai_from_template`, `cc0`,
`public_domain`, `user_provided_for_repository_test_use`, and
`user_provided_with_repository_test_rights`. Keep local-only or named-IP samples
outside tracked manifests.
