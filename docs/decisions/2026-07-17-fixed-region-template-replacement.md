# Decision: Fixed-Region Template Replacement

Date: 2026-07-17

Status: Accepted

## Context

The active fixed-region generation template was a tracked `252 x 252` binary
whose original authorship and redistribution permission could not be proven from
the repository. The same file served both the canonical
`fixed_region_motion_v0` layout id and the readable legacy alias
`ocad_motion_v0`.

The fixed-region geometry, action keys, anchors, normalized runtime mapping, and
legacy alias are established interoperability contracts. The artwork in the
constraint image is not.

## Decision

Replace the binary with
`templates/fixed_region_motion_template_v1.png`, generated deterministically by
`scripts/create-fixed-region-motion-assets.mjs`.

The new template:

- uses the canonical `FIXED_REGION_SOURCE_REGIONS` table rather than a copied
  second geometry definition;
- is transparent `252 x 252` RGBA;
- contains original neutral grayscale block mannequins;
- contains no copied character art, weapon, prop, text, logo, or grid label;
- keeps every source region occupied and padded;
- gives multi-frame actions deterministic pose/phase differences.

Both `fixed_region_motion_v0` and `ocad_motion_v0` load the new file. No protocol
id, region key, source action, anchor, crop rule, runtime animation, or export
format changes.

The related tracked AI/template-derived golden is replaced by the deterministic
repository-owned `fixed_region_sample_hero.png`.

## Historical Evidence

Older benchmark and decision records may retain the former template filename to
describe what was actually tested at that time. Those records are historical
evidence only. The former template and its derived AI fixture are excluded from
the public source snapshot and are not claimed as repository-owned assets.

## Quality Boundary

Provider-free structure and processing tests must pass before release. The
effect of the new template on live Provider generation quality is unverified.
Any live comparison requires a separately approved Provider-call budget and
must not block the source-only Preview.
