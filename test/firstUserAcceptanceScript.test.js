import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('first-user acceptance is guarded, provider-free, and covers the complete local journey', async () => {
  const [client, runner, packageJson, ci] = await Promise.all([
    readFile('scripts/first-user-acceptance.mjs', 'utf8'),
    readFile('scripts/run-first-user-acceptance.mjs', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('.github/workflows/ci.yml', 'utf8'),
  ])

  for (const endpoint of [
    '/api/process-sheet',
    '/api/motion-source/uploads',
    '/api/preview-motion-frames',
    '/api/build-motion-strip',
    '/api/apply-motion-strip',
  ]) assert.match(client, new RegExp(endpoint.replaceAll('/', '\\/')))
  assert.match(client, /selection_mode:\s*'auto'/)
  assert.match(client, /motion_selection_recipe_v2/)
  assert.match(client, /pixel_grid_v2_balanced/)
  assert.match(client, /acceptanceLoopbackUrl/)
  assert.match(client, /zip_url/)
  assert.match(client, /godot_npc_zip_url/)
  assert.match(client, /rpgmaker_zip_url/)
  assert.match(client, /ocad_zip_url/)
  assert.doesNotMatch(client, /postJson\('\/api\/generate-character'/)
  assert.doesNotMatch(client, /postJson\([^\n]*(?:repair|provider)/i)
  for (const key of [
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'CHARACTER_IMAGE_API_KEY',
    'CHARACTER_IMAGE_API_KEY_ENV',
    'CHARACTER_PROVIDER_PRESETS',
    'OPENROUTER_PROVIDER_PRESETS',
  ]) assert.match(runner, new RegExp(`${key}: ''`))
  assert.match(runner, /detached:\s*true/)
  assert.match(runner, /stopProcessGroup/)
  assert.match(packageJson.scripts['first-user:local'], /run-with-resource-guard\.mjs/)
  assert.match(ci, /Run provider-free first-user acceptance on primary Node/)
  assert.match(ci, /if:\s*matrix\.node == 24[\s\S]*run:\s*npm run first-user:local/)
})
