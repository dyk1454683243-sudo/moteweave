# Project Pack Module Map

`src/project-pack/` owns cross-pack project contracts that combine character and
scene outputs. It should stay small until scene assets have real generated
artifacts to package.

## Modules

```text
projectManifest.js
  Builds and validates the first character + scene + shared style project manifest.

projectPack.js
  Builds a project-level result from existing character and scene pack outputs.

zipExport.js
  Packages project, character, and scene artifacts into one project pack ZIP.

artifactManifest.js
  Maps project pack artifact filenames to stable generated URLs.

artifactWriter.js
  Writes project pack artifacts to a job directory and reports validation status.

artifactLoader.js
  Loads existing generated character and scene artifact directories for CLI/API combine flows.
```
