import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

import {
  characterPackJobStatusKey,
  characterPackResultState,
} from '../src/ui/characterPack/resultState.js'

const RETIRED_CHARACTER_CONTROLLERS = [
  'src/ui/characterPackTab.js',
  'src/ui/characterPack/api.js',
  'src/ui/characterPack/controls.js',
  'src/ui/characterPack/cutLineEditor.js',
  'src/ui/characterPack/jobRenderer.js',
  'src/ui/characterPack/playablePreviewWidget.js',
  'src/ui/characterPack/providerStatus.js',
  'src/ui/characterPack/renderers.js',
  'src/ui/characterPack/templateCalibration.js',
  'src/ui/characterPack/workflows.js',
]

test('retired Character DOM controllers are absent while maintained pure logic remains', async () => {
  for (const path of RETIRED_CHARACTER_CONTROLLERS) {
    await assert.rejects(access(path), { code: 'ENOENT' })
  }
  const [calibrationCore, resultState] = await Promise.all([
    readFile('src/ui/characterPack/templateCalibrationCore.js', 'utf8'),
    readFile('src/ui/characterPack/resultState.js', 'utf8'),
  ])
  assert.match(calibrationCore, /fixedRegionCalibration\.js/)
  assert.match(resultState, /characterPackResultState/)
  assert.equal(characterPackResultState({ status: 'failed_quality_gate' }), 'failed')
  assert.equal(
    characterPackJobStatusKey({ status: 'done', failure_status: 'failed_validation' }),
    'character.result.failed.title',
  )
})

test('Studio Character owns the maintained local, strict, and compatibility API surfaces', async () => {
  const [html, localView, localApi, strictApi, compatApi, settings] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/characterLocalView.js', 'utf8'),
    readFile('src/ui/studio/characterLocalApi.js', 'utf8'),
    readFile('src/ui/studio/characterApi.js', 'utf8'),
    readFile('src/ui/studio/characterCompatApi.js', 'utf8'),
    readFile('src/ui/studio/settingsView.js', 'utf8'),
  ])
  for (const id of [
    'studio-character-view',
    'character-local-workspace',
    'character-ai-workspace',
    'character-compat-workspace',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(localApi, /'\/api\/process-sheet'/)
  assert.match(strictApi, /'\/api\/generate-character\/review'/)
  assert.match(strictApi, /`\/api\/generate-character\/\$\{encodeURIComponent\(jobId\)\}\/accept`/)
  assert.match(compatApi, /'\/api\/generate-character'/)
  assert.match(localView, /templateCalibrationCore\.js/)
  assert.match(settings, /initProviderConfigSurface/)
  assert.doesNotMatch(html, /href="\/legacy|data-tab="character-pack"/)
})
