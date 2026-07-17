# Scene Pack Module Map

`src/scene-pack/` owns scene and tile generation contracts. It stays separate
from `src/character-pack/` so character normalization/export behavior does not
silently inherit scene assumptions.

## Modules

```text
tileProfile.js
  Defines the first padded 16-tile dual-grid profile, source regions, atlas metadata, edge compatibility, and profile validation.

tileArrangement.js
  Builds row-major tile maps, validates shared-edge compatibility, and exports an LDtk-style JSON skeleton.

ldtkProjectExport.js
  Exports validated tile maps as single-level LDtk project JSON with tileset, tile layer, entity layer, and entity field definitions.

scenePreview.js
  Builds deterministic provider-free dual-grid preview maps and matching scene/LDtk export payloads for the UI.

tileSheetIngestion.js
  Validates real padded 192x192 tile sheets, extracts 16 central runtime tiles, runs quality gates, and builds scene pack artifact payloads.

tileQualityGate.js
  Measures visual seam deltas, self-loop readiness, palette/style drift, and tile quality taxonomy.

tilePromptContracts.js
  Builds the prompt contract for the padded dual-grid tile source sheet and provider-free dry-run inspection.

tileGenerate.js
  Calls the configured image provider for one guarded live tile sheet smoke, then routes the result through tile sheet ingestion.

zipExport.js
  Packages scene, tile, quality, project, tileset, prompt, and generation artifacts into a scene pack ZIP.

artifactManifest.js
  Maps scene pack artifact filenames to stable generated URLs for CLI and UI consumers.

artifactWriter.js
  Writes scene pack artifacts to a job directory and reports quality-gate status for downstream workflows.
```
