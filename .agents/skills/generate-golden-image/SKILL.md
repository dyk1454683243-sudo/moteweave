---
name: generate-golden-image
description: >-
  Standardized workflow for generating, reviewing, and committing golden benchmark test images.
---

# Generate Golden Image

## Overview
This skill implements the strict workflow required by the `local-image-golden` test suite. It enforces that all benchmark images are generated correctly, manually reviewed by the user, and securely ingested into the manifest with proper metadata (such as `sha256`, dimensions, format) using the project's official CLI.

## Workflow

### 0. IP & Rights Gate (MANDATORY, before generation)
Run this check *before* generating anything. It is a hard gate, not a reminder.

- **Block known commercial IP by default.** If the requested image type, id, prompt, or template describes a recognizable copyrighted character, franchise, or brand (for example named anime/game/film characters such as Naruto, Pokémon, Mario, Marvel/DC heroes), do NOT generate it for the committed test set. AI generation does **not** wash copyright: an AI rendering of a known character is still a derivative work, so `--source-rights generated_by_ai` does not make it safe to redistribute. This follows `AGENTS.md` Rule 3.
- **Use original descriptions instead.** Steer the user toward original character/terrain descriptions (e.g. "silver-haired swordswoman, navy cloak" rather than a named character). The committed golden set must be original or CC0/public-domain.
- **Temporary local-only exception.** A user may explicitly authorize a named-IP image *for local testing only, to be deleted after testing*. In that case:
  - the image MUST stay out of the repository (it is already covered by the `ocad_*.jpg` ignore rule in `.gitignore`; verify the file lands on an ignored path and `git status` does not show it),
  - never `git add` the manifest entry that points at it, and never push it,
  - record the authorization is temporary and the file is to be deleted after testing.
- **When unsure, stop and ask the human user** before generating. Do not guess that something is "probably fine".

### 1. Clarify Inputs
- If the user hasn't specified the image type, use your `ask_question` tool to ask which kind of image they want to generate: `single_character`, `topdown_sheet`, `ocad_sheet`, or `bad_case`.
- Also clarify if they want to use a structural template (e.g. from `templates/`) to guide the layout.

### 2. Generate Image
- Use your `generate_image` tool.
- Pass the appropriate descriptive text prompt.
- If a template was selected, supply its absolute path to the `ImagePaths` argument of the `generate_image` tool.
  - **Template-Specific Restrictions**: If the user selects the `fixed_region_motion_template_v1.png` template, you MUST explicitly instruct the image generator not to generate any weapons, props, or skills (e.g., "DO NOT GENERATE ANY WEAPONS OR PROPS. Empty hands only"). This ensures the generated character strictly matches the unarmed silhouettes of this specific template.

### 3. Manual Review (MANDATORY)
- Do NOT commit the image directly to the codebase.
- Use your `write_to_file` tool to create an artifact (e.g. `image_review.md` in your brain directory) that displays the newly generated image.
- Set `RequestFeedback: true` on the artifact so the user can review it.
- Stop execution and wait for the user to explicitly approve the image.

### 4. Standardized Addition
- Once the user explicitly approves the image in the review step, you must use the repository's standard CLI script to add it.
- Use your `run_command` tool to execute:
  ```bash
  npm run character-pack -- benchmark local-images-add \
    --input <absolute_path_to_generated_image> \
    --id <stable_id_for_the_image> \
    --kind <single_character|topdown_sheet|ocad_sheet|bad_case> \
    --profile <processing_profile> \
    --source-rights generated_by_ai_from_template \
    --expected-check <check_name> \
    --notes "<description of image and background type>"
  ```
- `--source-rights generated_by_ai_from_template` records *how* the pixels were produced; it is **not** a copyright clearance. It is only valid for original or public-domain subjects that passed the Step 0 gate. Never use it to launder a named-IP image into the committed set.

## Common Mistakes
- **Skipping manual review**: Do not immediately commit the generated image. You must pause for user approval.
- **Manually editing manifest.json**: Always use the `local-images-add` CLI to avoid skipping the `sha256` and physical dimension generation steps.
- **Using IP/Copyrighted characters**: Enforce the Step 0 IP & Rights Gate. Named commercial characters are blocked from the committed set by default; only a user-authorized, gitignored, delete-after-testing local exception is allowed. Do not treat `generated_by_ai_from_template` as a copyright waiver.
