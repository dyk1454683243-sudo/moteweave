# Decision: Public Brand Selection

Date: 2026-07-17

Status: Accepted
Display name: MoteWeave
Slug: moteweave
Repository: https://github.com/dyk1454683243-sudo/moteweave.git
Pages project: moteweave
Homepage: https://moteweave.pages.dev/

## Context

The source Preview needs one distinctive product name across the package,
repository, website, release metadata, and optional Provider attribution
headers. `AI Character Pack Tool` and `GameTool` were temporary working names
and must not ship as the active public brand.

The project lead explicitly approved `MoteWeave` on 2026-07-17 after reviewing
the name's intended meaning: small visual units or pixels (`mote`) combined into
a coherent, game-ready asset workflow (`weave`).

The preliminary naming review found no obvious conflicting project surface in
the checked public channels. That review is not a trademark opinion or a
guarantee of registration rights.

## Decision

- Use `MoteWeave` as the Preview display name.
- Use `moteweave` as the package, GitHub repository, and Cloudflare Pages slug.
- Use the repository and homepage values recorded above in public metadata.
- Regenerate public brand artwork from deterministic repository-owned code.
- Keep public visibility, release creation, and website cutover behind their
  separate explicit approval gates.

Existing asset protocols, layout ids, JSON schemas, and editor recovery storage
keys are compatibility identifiers rather than product branding. They remain
unchanged unless a separately approved migration preserves existing data.

## Consequences

- Active product surfaces must contain `MoteWeave` and must not retain the
  temporary public names.
- A rename before public visibility remains possible through a superseding
  decision and regenerated metadata/artwork.
- A rename after public visibility would also require repository, Pages,
  canonical URL, documentation, and link migration.
- This decision supersedes
  `docs/decisions/2026-05-25-project-rename-plan.md`.
