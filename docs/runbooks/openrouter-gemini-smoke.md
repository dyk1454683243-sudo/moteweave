# OpenRouter Gemini Smoke Test

This runbook verifies the live OpenRouter Gemini image-generation path end to end.

It proves:

- the backend can read `OPENROUTER_API_KEY`
- `/api/gemini-state` reports the OpenRouter provider as available
- `/api/generate-character` sends a template-guided request to OpenRouter
- the generated source image is post-processed into the character-pack pipeline
- `normalized_sheet.png`, `debug_report.json`, row GIF previews, and `character_pack.zip` are produced

## Local UI/API Smoke

Before spending an OpenRouter request, verify the local page and post-processing API:

```bash
npm start
npm run smoke:local
```

This checks the tab markup, OpenRouter provider state endpoint, and the local GIF builder endpoint. It does not require an API key.

## Configure

Create a local `.env` from `.env.example` and set:

```text
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
OPENROUTER_IMAGE_SIZE=2K
OPENROUTER_IMAGE_ASPECT_RATIO=1:1
```

The `.env` file is ignored by git. Do not commit API keys.

## Restart Server

The server reads `.env` at startup, so restart it after editing the file:

```bash
npm start
```

Confirm the provider state:

```bash
curl -s http://localhost:4173/api/gemini-state
```

Expected shape:

```json
{
  "available": true,
  "implemented": true,
  "provider": "openrouter",
  "model": "google/gemini-2.5-flash-image"
}
```

## Run Smoke Test

In another terminal:

```bash
npm run smoke:openrouter
```

The script submits a small `fixed_region_motion_v0` character generation job by default, waits for it, and checks the required output URLs. Set `OPENROUTER_SMOKE_PRESET=topdown_rpg_v0` when intentionally testing the focused 8x8 path.

Expected successful output includes:

```json
{
  "status": "done",
  "provider": {
    "available": true,
    "implemented": true,
    "provider": "openrouter"
  },
  "source_url": "/generated/.../source.png",
  "normalized_sheet_url": "/generated/.../normalized_sheet.png",
  "debug_report_url": "/generated/.../debug_report.json",
  "row_gif_count": 21,
  "zip_url": "/generated/.../character_pack.zip",
  "validation": "pass or warning"
}
```

`validation` may be `"warning"` for model-quality issues such as mild drift or halo. A `"fail"` status means the generated sheet was not game-ready and should be regenerated or inspected.

## Optional Parameters

Use a smaller image size for a cheaper smoke test:

```bash
OPENROUTER_SMOKE_IMAGE_SIZE=1K npm run smoke:openrouter
```

Change the test prompt:

```bash
OPENROUTER_SMOKE_DESCRIPTION="a tiny blue-robed wizard with a wooden staff" npm run smoke:openrouter
```

Point at another local server:

```bash
CHARACTER_TOOL_URL=http://localhost:4187 npm run smoke:openrouter
```

## Failure Meanings

- Exit `2`: the running server does not have `OPENROUTER_API_KEY`; configure `.env` and restart `npm start`.
- `failed_model_error`: OpenRouter rejected the request, the model name is unavailable, quota is exhausted, or the response did not include an image.
- `failed_post_processing`: OpenRouter returned an image, but the sheet could not be sliced or normalized into a valid character pack.

For `failed_post_processing`, inspect:

- `source.png`
- `debug_report.json`
- `debug_overlay.png`
- `onion_skin_overlay.png`

These artifacts show whether the issue came from the model layout, background cleanup, grid slicing, anchor normalization, or validation.
