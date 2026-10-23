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

const FIGMA_SCENE_CURRENT_NODE_IDS = Object.freeze([
  '650:3694',
  '946:4572',
  '946:4702',
  '946:4832',
  '977:5069',
  '1119:5324',
])

const FIGMA_SCENE_ARCHIVE_NODE_IDS = Object.freeze([
  '603:5380',
])

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function attributeValue(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''
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
  assert.match(html, /href="#scene" data-studio-route="scene" hidden/)
  assert.match(app, /import \{ initStudioScene, refreshStudioSceneLiveReadiness, renderStudioSceneLanguage \} from '\.\/sceneView\.js'/)
  assert.match(app, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]/)
  assert.match(app, /scene: 'MoteWeave · 地图工作室'/)
  assert.match(app, /scene: 'MoteWeave · Map Studio'/)
  assert.match(app, /if \(route === 'scene'\) return 'tiles'/)
  assert.match(app, /sceneInitializationPromise = Promise\.resolve\(initStudioScene\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)
  assert.match(sceneHtml(html), /id="studio-scene-prompt-open"[^>]*aria-controls="studio-scene-prompt-drawer"[^>]*aria-expanded="false"/)
  assert.match(sceneHtml(html), /id="studio-scene-prompt-drawer"[^>]*aria-modal="true"[^>]*977:5069[^>]*hidden/)
  assert.doesNotMatch(sceneHtml(html), /scene-legacy-link|href="\/legacy\?tab=prompts"/)
  assert.match(promptAssistant, /buildScenePrompt/)
  assert.match(redirect, /prompts:\s*'tiles'/)
  assert.match(html, /href="#project" data-studio-route="project"/)
  assert.doesNotMatch(html, /href="\/legacy\?tab=project-pack"/)

  const currentSource = attributeValue(opening, 'data-design-source')
  const archiveInventory = attributeValue(opening, 'data-design-archive-inventory')
  const figmaPrefix = 'figma:ro8w6TKkpd969zW2V5bmkx/'

  assert.equal(currentSource, `${figmaPrefix}${FIGMA_SCENE_CURRENT_NODE_IDS.join(',')}`)
  assert.equal(archiveInventory, `${figmaPrefix}${FIGMA_SCENE_ARCHIVE_NODE_IDS.join(',')}`)
  for (const nodeId of FIGMA_SCENE_CURRENT_NODE_IDS) {
    assert.ok(currentSource.includes(nodeId), `Current source missing ${nodeId}`)
    assert.ok(!archiveInventory.includes(nodeId), `Archive inventory must not include Current ${nodeId}`)
  }
  for (const nodeId of FIGMA_SCENE_ARCHIVE_NODE_IDS) {
    assert.ok(!currentSource.includes(nodeId), `Current source must not include Archive ${nodeId}`)
    assert.ok(archiveInventory.includes(nodeId), `Archive inventory missing ${nodeId}`)
  }
  assert.doesNotMatch(opening, /56:135/, 'Archive is reference-only, not a live Scene state')
})

test('maintained Scene HTML and CSS keep Current and Archive Scene provenance separate', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const cssLines = css.split('\n')
  const currentLine = cssLines.find((line) => line.includes('Scene Studio Current frames:')) ?? ''
  const archiveLine = cssLines.find((line) => line.includes('Scene Archive / Historical v2')) ?? ''
  assert.match(currentLine, /Scene Studio Current frames:/)
  assert.match(archiveLine, /Scene Archive \/ Historical v2 · NOT CURRENT/)
  assert.match(currentLine, /Does not include 603:5380/)
  const listedCurrentIds = [...(currentLine.split('Does not include')[0].matchAll(/\d+:\d+/g) ?? [])].map((match) => match[0])
  const listedArchiveIds = [...(archiveLine.matchAll(/\d+:\d+/g) ?? [])].map((match) => match[0])
  assert.deepEqual(listedCurrentIds, [...FIGMA_SCENE_CURRENT_NODE_IDS])
  assert.deepEqual(listedArchiveIds, [...FIGMA_SCENE_ARCHIVE_NODE_IDS])
  for (const nodeId of FIGMA_SCENE_CURRENT_NODE_IDS) {
    assert.ok(!listedArchiveIds.includes(nodeId), `Archive CSS IDs must not include Current ${nodeId}`)
  }
  assert.ok(!listedCurrentIds.includes('603:5380'), 'Current CSS ID set must not include 603:5380')
  assert.ok(listedArchiveIds.includes('603:5380'), 'Archive CSS ID set must include 603:5380')
  assert.match(html, /data-design-archive-inventory="figma:ro8w6TKkpd969zW2V5bmkx\/603:5380"/)
  assert.doesNotMatch(html, /data-design-source="[^"]*603:5380/)
  const opening = openingTagForId(html, 'studio-scene-view')
  assert.equal(
    attributeValue(opening, 'data-design-source'),
    `figma:ro8w6TKkpd969zW2V5bmkx/${FIGMA_SCENE_CURRENT_NODE_IDS.join(',')}`,
  )
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
  assert.match(api, /\/api\/gemini-state/)
  assert.match(api, /\/api\/jobs\//)
  assert.match(api, /route_kind === 'google_native'/)
  assert.match(scene, /id="studio-scene-gemini-lock"[^>]*hidden/)
  assert.match(view, /refreshStudioSceneLiveReadiness/)
  assert.doesNotMatch(view, /setInterval\(/)
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
  assert.equal(SCENE_COPY.zh.candidateBinding, '{count} 次生成')
  assert.equal(SCENE_COPY.en.candidateBinding, '{count} generation(s)')
})

test('Scene Current lets the operator choose 1 to 8 live generations', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/sceneView.js', 'utf8'),
  ])
  const scene = sceneHtml(html)
  const select = scene.match(/<select id="studio-scene-candidates">([\s\S]*?)<\/select>/)?.[1] ?? ''
  assert.match(scene, /id="studio-scene-candidates"/)
  assert.doesNotMatch(scene, /<input id="studio-scene-candidates"/)
  assert.equal((select.match(/<option value="/g) ?? []).length, 8)
  assert.match(select, /<option value="1" selected>1<\/option>/)
  assert.match(select, /<option value="8">8<\/option>/)
  assert.equal(SCENE_COPY.zh.candidateCount, '生成次数')
  assert.equal(SCENE_COPY.en.candidateCount, 'Generation count')
  assert.equal(SCENE_COPY.zh.providerNote, '可选择 1 到 8 次。每次生成消耗 1 次原生 Gemini 调用。')
  assert.equal(SCENE_COPY.en.providerNote, 'Choose 1 to 8 generations. Each generation uses one native Gemini call.')
  assert.match(view, /sceneState\.candidateCount = count/)
  assert.match(view, /SCENE_MAX_CANDIDATES/)
})

test('Scene advanced labels are bilingual while option values stay as enums', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const scene = sceneHtml(html)
  assert.equal(SCENE_COPY.zh.styleSnap, '调色板对齐')
  assert.equal(SCENE_COPY.zh.edgeCondition, '边缘条件')
  assert.equal(SCENE_COPY.zh.advancedHint, '调色板对齐 · 边缘条件')
  assert.equal(SCENE_COPY.zh.edgeModeAware, '边缘感知 v1')
  assert.equal(SCENE_COPY.zh.edgeModeGlobal, '全局 v0')
  assert.equal(SCENE_COPY.zh.rawPolicyWarn, '警告')
  assert.equal(SCENE_COPY.zh.rawPolicyStrict, '严格')
  assert.equal(SCENE_COPY.en.styleSnap, 'Palette snap')
  assert.equal(SCENE_COPY.en.edgeCondition, 'Edge condition')
  assert.match(scene, /<small data-scene-copy="advancedHint">/)
  assert.match(scene, /<option value="edge-aware-v1" data-scene-copy="edgeModeAware">/)
  assert.match(scene, /<option value="global-v0" data-scene-copy="edgeModeGlobal">/)
  assert.match(scene, /<option value="warn" data-scene-copy="rawPolicyWarn">/)
  assert.match(scene, /<option value="strict" data-scene-copy="rawPolicyStrict">/)
  assert.doesNotMatch(scene, /<span data-scene-copy="styleSnap">Palette snap<\/span>/)
  assert.doesNotMatch(scene, /<span data-scene-copy="edgeCondition">Edge condition<\/span>/)
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
  assert.doesNotMatch(css, /\.scene-topbar > strong\s*\{[^}]*flex-basis:\s*auto/)
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.scene-mode-group\s*\{[^}]*left:\s*132px;[^}]*top:\s*42px;/)
  assert.doesNotMatch(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.scene-mode-group\s*\{[^}]*left:\s*16px;/)
  assert.match(css, /\.scene-topbar > \.crumb\s*\{[^}]*overflow:\s*visible/)
  assert.match(css, /\.scene-topbar > \.status-badge\s*\{[^}]*max-width:\s*none/)
  assert.match(css, /\.scene-topbar > \.status-badge\s*\{[^}]*overflow:\s*visible/)
  assert.match(css, /@media \(max-width: 1180px\)\s*\{[\s\S]*?\.scene-topbar > \.crumb, \.scene-topbar > #studio-scene-status \{ display: none;/)
  assert.equal(SCENE_COPY.en.geminiLockedCrumb, '· Native Gemini unavailable')
  assert.equal(SCENE_COPY.en.geminiLockedStatus, 'Online generation locked')
  assert.equal(SCENE_COPY.zh.geminiLockedCrumb, '· 原生 Gemini 不可用')
  assert.equal(SCENE_COPY.zh.geminiLockedStatus, '在线生成已锁定')
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
  assert.equal(deriveScenePresentation(state).action, 'blocked')
  state.geminiStatus = 'ready'
  state.geminiPreset = { id: 'gemini_native_1' }
  assert.equal(deriveScenePresentation(state).action, 'generate')
  state.geminiStatus = 'unavailable'
  assert.equal(deriveScenePresentation(state).action, 'blocked')
  state.mode = 'local'
  state.sourceFile = { name: 'scene.png' }
  state.geminiStatus = 'unavailable'
  assert.equal(deriveScenePresentation(state).action, 'process')
  state.mode = 'live'
  state.geminiStatus = 'ready'
  state.geminiPreset = { id: 'gemini_native_1' }
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

test('Scene Current clips the left flow explainer and keeps phase copy inventory', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const scene = sceneHtml(html)
  assert.match(scene, /class="scene-flow-header"/)
  assert.match(scene, /id="studio-scene-phase-title"/)
  assert.match(scene, /id="studio-scene-phase-pill"/)
  assert.match(scene, /id="studio-scene-phase-summary"/)
  assert.match(scene, /class="scene-steps"/)
  assert.match(scene, /aria-labelledby="studio-scene-phase-title"/)
  assert.match(scene, /class="scene-truth-callout"/)
  assert.match(scene, /id="studio-scene-truth-title"/)
  assert.match(scene, /id="studio-scene-truth-copy"/)
  assert.match(scene, /class="technical-disclosure scene-capability-disclosure"/)
  assert.match(css, /\.scene-flow-header \{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
  assert.match(css, /\.scene-truth-callout \{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
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
