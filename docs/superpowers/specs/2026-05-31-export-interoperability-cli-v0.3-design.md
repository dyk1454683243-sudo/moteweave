# Export Interoperability And CLI v0.3 Design

## Goal

Make generated character packs easier to inspect, edit, and automate after the reliability and benchmark loop is in place.

This block turns a validated pack into a workflow artifact:

```text
source / generated image -> normalized sheet -> runtime exports -> editor metadata -> CLI automation
```

## Product Outcome

A user should be able to:

- Open `normalized_sheet.png` with a neighboring metadata file that describes animation frame ranges and attachment points.
- Inspect neutral frame tags, slices, and per-frame attachment metadata without relying on `debug_report.json`.
- Run process/generate/benchmark flows from the command line for repeatable local work.
- Use the web app and CLI without duplicate artifact-writing behavior.

## Scope

### In Scope

- Add a neutral `editor_metadata.json` artifact.
- Include frame tags for every runtime animation range.
- Include frame-space slices and attachment points derived from normalized frame geometry.
- Preserve source-layout provenance for fixed-region OCAD-derived frames.
- Expose `editor_metadata.json` in `character_pack.zip`, generated artifact manifests, and local URLs.
- Add stable CLI entry points for process, generate, and benchmark flows.
- Keep existing benchmark scripts working as aliases or specialized wrappers.
- Update protocols, runbooks, and attribution notes for public format compatibility.
- Add focused tests and full `npm test` verification.

### Out Of Scope

- Building a full pixel editor.
- Editor plugin code or scripting integration.
- Per-frame repair, inpainting, or layer decomposition.
- A full public package manager or cloud workflow.
- Replacing existing Godot, RPG Maker, or OCAD exports.

## Naming And IP Guardrails

Code identifiers and file names must stay neutral:

```text
editor_metadata.json
buildEditorMetadataJson()
frame_tags
attachments
slices
```

Documentation may use neutral compatibility wording such as `Aseprite-compatible JSON`, but product names must not become module names, package names, function names, generated identifiers, or marketing claims.

No external source code or bundled assets are used. The metadata builder is original code that emits a small interoperable JSON shape.

## Architecture

### Editor Metadata

Add a builder in `src/character-pack/packageBuilder.js`:

```text
buildEditorMetadataJson({ metadata, animationsJson, frames, profile, sourceLayout })
```

The output is independent of `debug_report.json`:

```json
{
  "version": "0.1",
  "profile": "topdown_rpg_v0",
  "sheet": "normalized_sheet.png",
  "frame_size": { "w": 96, "h": 96 },
  "sheet_size": { "w": 768, "h": 768 },
  "frame_tags": [
    { "name": "walk_down", "from": 16, "to": 19, "fps": 10, "loop": true, "mode": "loop", "direction": "forward" }
  ],
  "frames": {
    "frame_016": {
      "index": 16,
      "frame": { "x": 0, "y": 192, "w": 96, "h": 96 },
      "duration": 100,
      "runtime_action": "walk_down",
      "source": { "layout": "topdown_rpg_v0" }
    }
  },
  "attachments": [
    { "name": "feet", "frame": 16, "point": { "x": 48, "y": 88 }, "space": "frame" }
  ],
  "slices": [
    { "name": "frame_016_bounds", "frame": 16, "rect": { "x": 42, "y": 40, "w": 13, "h": 49 }, "space": "frame" }
  ]
}
```

Attachment defaults:

- `feet`: `frame.normalized_anchor` or `profile.anchor`.
- `head`: top-center of `frame.normalized_bbox`.
- `hand_left` and `hand_right`: conservative bbox-side points.
- `source_feet`: `frame.source_anchor`, when available.

For fixed-region sources, each frame entry should include `source.layout`, `source.region_key`, `source.action`, and `source.flip_h`.

### Artifact Writing

Extract server artifact writing into a shared module:

```text
src/character-pack/artifactWriter.js
  writeCharacterPackArtifacts({ jobId, outputDir, result })
```

The server can keep job status handling, but both server and CLI should use the same manifest-writing path.

### CLI

Add a stable command script:

```text
scripts/character-pack-cli.mjs
```

Supported commands:

```text
process
generate
benchmark openrouter
benchmark processed
```

Minimum stable examples:

```bash
npm run character-pack -- process --input test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png --output-dir generated/cli --name sample_hero --background-mode flood
npm run character-pack -- generate --description "blue wizard" --preset topdown_rpg_v0 --image-size 1K --yes
npm run character-pack -- benchmark openrouter --sample-size 1 --variants 1 --preset topdown_rpg_v0 --yes
npm run character-pack -- benchmark processed --root-dir generated --limit 30
```

Generate command must refuse live provider quota unless `--yes` is passed. A `--dry-run-prompt` mode should write or print the compiled prompt metadata without calling a provider.

## Acceptance Criteria

- `processSheetBuffer()` returns `editorMetadataJson`.
- `character_pack.zip` contains `editor_metadata.json`.
- `buildCharacterPackArtifactManifest()` exposes `editor_metadata.json` and `editor_metadata_url`.
- `editor_metadata.json.frame_tags` covers every runtime animation range.
- `editor_metadata.json.attachments` includes frame-space `feet` points for every frame.
- `editor_metadata.json.slices` includes normalized bounds slices when a frame has a visible bbox.
- Fixed-region OCAD-derived frames include source provenance in editor metadata.
- CLI `process` writes the same artifact family as the web path, including `editor_metadata.json`.
- CLI `generate --dry-run-prompt` does not call a live provider and records prompt contract metadata.
- CLI benchmark subcommands forward to existing benchmark engines with explicit options.
- Protocol/runbook docs describe the new artifact and CLI flows.
- `ATTRIBUTIONS.md` records the public editor metadata format compatibility, without implying endorsement.
- Focused tests and full `npm test` pass before completion.

## Commit Strategy

Use coherent commits:

1. `docs: plan export interoperability cli`
2. `feat: add editor metadata artifact`
3. `feat: add character pack cli`
4. `docs: document editor metadata and cli`

If a slice expands, commit after that slice has focused tests and no unrelated files staged.
