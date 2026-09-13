import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  SCENE_COPY,
  SCENE_PHASES,
  buildSceneLocalPreview,
  createInitialSceneState,
  deriveScenePresentation,
  sceneResultIsCurrent,
} from '../src/ui/studio/sceneView.js'

const FIGMA_SCENE_NODE_IDS = Object.freeze([
  '650:3694',
  '603:5380',
  '946:4572',
  '946:4702',
  '946:4832',
  '977:5069',
])

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function sceneHtml(html) {
  const start = html.indexOf('id="studio-scene-view"')
  const end = html.indexOf('id="studio-project-view"', start)
  assert.ok(start >= 0 && end > start, 'Studio Scene view is missing')
  return html.slice(start, end)
}

test('Scene Studio is the internal Figma-backed route with the migrated prompt helper', async () => {
  const [html, app, promptAssistant, redirect] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
    readFile('src/ui/studio/promptAssistantView.js', 'utf8'),
    readFile('src/server/legacyStudioRedirect.js', 'utf8'),
  ])
  const opening = openingTagForId(html, 'studio-scene-view')
  assert.match(opening, /data-studio-view="scene"[^>]*data-scene-phase="empty"[^>]*data-scene-mode="local"[^>]*hidden/)
  assert.match(html, /href="#scene" data-studio-route="scene"/)
  assert.match(app, /import \{ initStudioScene, renderStudioSceneLanguage \} from '\.\/sceneView\.js'/)
  assert.match(app, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]/)
  assert.match(app, /scene: 'MoteWeave · 场景工坊'/)
  assert.match(app, /scene: 'MoteWeave · Scene Studio'/)
  assert.match(app, /else if \(activeRoute === 'scene'\) renderStudioSceneLanguage\(\)/)
  assert.match(app, /sceneInitializationPromise = Promise\.resolve\(initStudioScene\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)
  assert.match(sceneHtml(html), /id="studio-scene-prompt-open"[^>]*aria-controls="studio-scene-prompt-drawer"[^>]*aria-expanded="false"/)
  assert.match(sceneHtml(html), /id="studio-scene-prompt-drawer"[^>]*aria-modal="true"[^>]*977:5069[^>]*hidden/)
  assert.doesNotMatch(sceneHtml(html), /scene-legacy-link|href="\/legacy\?tab=prompts"/)
  assert.match(promptAssistant, /buildScenePrompt/)
  assert.match(redirect, /prompts:\s*'scene'/)
  assert.match(redirect, /\?open=scene-prompt#scene/)
  assert.match(html, /href="#project" data-studio-route="project"/)
  assert.doesNotMatch(html, /href="\/legacy\?tab=project-pack"/)

  for (const nodeId of FIGMA_SCENE_NODE_IDS) assert.match(opening, new RegExp(nodeId.replace(':', '\\:')))
  assert.doesNotMatch(opening, /56:135/, 'Archive is reference-only, not a live Scene state')
})

test('Scene Studio exposes the real state and recovery matrix without fake controls or results', async () => {
  const [html, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/sceneView.js', 'utf8'),
    readFile('src/ui/studio/sceneApi.js', 'utf8'),
  ])
  const scene = sceneHtml(html)
  assert.deepEqual(SCENE_PHASES, [
    'empty', 'ready', 'running', 'complete', 'quality_failed', 'failed',
    'poll_paused', 'stale', 'submission_unknown',
  ])
  for (const phase of SCENE_PHASES) {
    assert.match(view, new RegExp(`['"]${phase}['"]`))
    assert.match(scene, new RegExp(`data-scene-panel="[^"]*\\b${phase}\\b`))
  }
  assert.doesNotMatch(scene, /<(?:button|a)[^>]*(?:WASD|repair|修复|cancel|重试|retry|Soon)/i)
  assert.doesNotMatch(scene, /Tiled|Godot TileMap|Unity Tilemap/)
  assert.doesNotMatch(view, /scenePackPreview|state\.scenePack|project-pack|projectPack/)
  assert.doesNotMatch(api, /project-pack|generate-character|two-point-five-d/)
  assert.match(api, /\/api\/process-scene-tiles/)
  assert.match(api, /\/api\/generate-scene-tiles/)
  assert.match(api, /\/api\/jobs\//)
  assert.equal((api.match(/confirm_live_generation:\s*true/g) ?? []).length, 1)
  assert.match(view, /button\.disabled = !state\.serviceAvailable \|\| state\.busy !== null/)
  assert.match(view, /if \(!state \|\| state\.busy \|\| !state\.serviceAvailable\) return/)
  assert.match(view, /state\.optionsValid = false[\s\S]*state\.options = readOptions\(\)[\s\S]*state\.optionsValid = true/)
  assert.match(view, /const confirmedLiveSubmission = state\.liveConfirmed[\s\S]*resetLiveConfirmation\(state\)[\s\S]*confirmed: confirmedLiveSubmission/)
  assert.match(scene, /accept="image\/png,image\/webp,image\/jpeg,\.png,\.webp,\.jpg,\.jpeg"/)

  const exportTag = openingTagForId(scene, 'studio-scene-export')
  assert.match(exportTag, /\bdisabled\b/)
  const artifactNav = openingTagForId(scene, 'studio-scene-artifacts')
  assert.doesNotMatch(artifactNav, /\bhref\s*=/)
  assert.doesNotMatch(scene, /<img[^>]+src=/)
  assert.doesNotMatch(await readFile('src/ui/studio/studio.css', 'utf8'), /content:\s*["']No current artifacts["']/)
  assert.deepEqual(Object.keys(SCENE_COPY.zh).sort(), Object.keys(SCENE_COPY.en).sort())
  assert.equal(SCENE_COPY.zh.candidateBinding, '{count} 个候选')
})

test('Scene geometry preserves the Figma shell and has a real narrow layout', async () => {
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  assert.match(css, /\.scene-workspace\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,1fr\)/)
  assert.match(css, /\.scene-stage\s*\{[^}]*grid-template-rows:\s*36px minmax\(0,1fr\) 44px/)
  assert.match(css, /\.scene-file-picker\s*\{[^}]*height:\s*76px/)
  assert.match(css, /\.scene-preview-panel\s*\{[^}]*width:\s*min\(1160px,calc\(100% - 80px\)\)[^}]*grid-template-columns:\s*minmax\(0,1fr\) 340px/)
  assert.match(css, /\.scene-empty-panel, \.scene-running-panel\s*\{[^}]*width:\s*480px[^}]*min-height:\s*126px/)
  assert.match(css, /\.scene-stage-note\s*\{[^}]*height|\.scene-stage-note\s*\{[^}]*align-items:\s*center/)
  assert.match(css, /@media \(max-width: 900px\)/)
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.scene-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)[\s\S]*?\.scene-preview-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/)
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.scene-topbar \.scene-language\s*\{[^}]*display:\s*inline-flex/)
})

test('Scene state gates submissions, same-Job resume, stale output, and verified release', () => {
  const fileModeState = createInitialSceneState({ serviceAvailable: false })
  fileModeState.sourceFile = { name: 'scene.png' }
  fileModeState.phase = 'ready'
  assert.equal(deriveScenePresentation(fileModeState).action, 'blocked')

  const state = createInitialSceneState()
  assert.deepEqual(deriveScenePresentation(state), { phase: 'empty', action: 'blocked', busy: false, mode: 'local' })
  state.sourceFile = { name: 'scene.png' }
  state.phase = 'ready'
  assert.equal(deriveScenePresentation(state).action, 'process')
  state.phase = 'running'
  assert.equal(deriveScenePresentation(state).action, 'blocked')
  state.phase = 'poll_paused'
  state.job = { id: 'job_scene_1' }
  assert.equal(deriveScenePresentation(state).action, 'resume')

  state.mode = 'live'
  state.phase = 'ready'
  state.description = 'mossy path'
  state.liveConfirmed = false
  assert.equal(deriveScenePresentation(state).action, 'blocked')
  state.liveConfirmed = true
  assert.equal(deriveScenePresentation(state).action, 'generate')
  state.phase = 'submission_unknown'
  assert.equal(deriveScenePresentation(state).action, 'blocked')

  state.mode = 'local'
  state.phase = 'complete'
  state.resultVerified = true
  state.resultJob = { id: 'job_scene_1', status: 'done' }
  state.binding = {
    jobId: 'job_scene_1',
    inputKey: JSON.stringify({ mode: 'local', sourceEpoch: state.sourceEpoch, optionsKey: state.optionsKey }),
  }
  assert.equal(sceneResultIsCurrent(state), true)
  state.phase = 'failed'
  assert.equal(sceneResultIsCurrent(state), false)
  state.phase = 'complete'
  state.optionsValid = false
  assert.equal(sceneResultIsCurrent(state), false)
  assert.equal(deriveScenePresentation(state).action, 'blocked')
  state.optionsValid = true
  state.sourceEpoch += 1
  assert.equal(sceneResultIsCurrent(state), false)
})

test('local Scene preview uses the maintained ingestion, arrangement, and quality code', () => {
  const width = 192
  const height = 192
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 72
    data[index + 1] = 104
    data[index + 2] = 78
    data[index + 3] = 255
  }
  const bundle = buildSceneLocalPreview({ width, height, data })
  assert.equal(bundle.map.width, 6)
  assert.equal(bundle.map.height, 4)
  assert.equal(Object.keys(bundle.tiles).length, 16)
  assert.ok(['pass', 'warning', 'fail'].includes(bundle.qualityGate.status))
  assert.equal(bundle.sceneJson.levels.length, 1)
})
