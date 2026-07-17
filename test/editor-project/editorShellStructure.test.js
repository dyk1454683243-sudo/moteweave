import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function text(pathname) {
  return readFile(pathname, 'utf8')
}

test('editor shell keeps the parallel workspace layout and old app link', async () => {
  const html = await text('editor.html')

  for (const expected of [
    'data-editor-shell',
    'href="/"',
    'Asset Library',
    'Scene Stage',
    'Inspector',
    'Layers',
    'Timeline',
    'Flow',
    'Repair',
    'Playtest',
    'Export',
    'Quality',
    'Logs',
    'Export Pack',
    './src/editor-app.js',
    './src/ui/editor/editor.css',
    'id="editor-scene-canvas"',
    'id="editor-playtest-hud"',
    'id="editor-playtest-hud-clip"',
    'id="editor-playtest-hud-direction"',
    'id="editor-playtest-hud-coordinates"',
    'id="editor-playtest-hud-stop"',
    'id="editor-stage-live"',
    'tabindex="0"',
  ]) {
    assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('editor shell marks future-only controls as disabled', async () => {
  const html = await text('editor.html')

  assert.match(html, /<button id="editor-export-project-pack" class="secondary" type="button" disabled>Export Pack<\/button>/)
  assert.doesNotMatch(html, /Export - Coming later/)

  for (const expected of [
    'id="editor-undo-project"',
    'id="editor-redo-project"',
    'id="editor-playback-toggle"',
    'aria-pressed="false"',
    'data-editor-panel="flow"',
    'data-editor-panel="repair"',
    'data-editor-panel="export"',
    'id="editor-tool-select"',
    'id="editor-toggle-grid"',
    'id="editor-toggle-snap"',
    'id="editor-snap-size"',
  ]) {
    assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('editor shell only talks to the editor API and does not inject raw SVG or provider secrets', async () => {
  const api = await text('src/ui/editor/api.js')
  const shell = await text('src/ui/editor/shell.js')
  const qualityGateShell = await text('src/ui/editor/frameRepairQualityGateShell.js')
  const exportPanel = await text('src/ui/editor/exportPanel.js')
  const domControls = await text('src/ui/editor/domControls.js')
  const sceneCanvas = await text('src/ui/editor/sceneCanvas.js')
  const sceneRenderer = await text('src/ui/editor/sceneRenderer.js')
  const sceneRenderLifecycle = await text('src/ui/editor/sceneRenderLifecycle.js')
  const playtestPanel = await text('src/ui/editor/playtestPanel.js')
  const animationRuntime = await text('src/editor-project/animationRuntime.js')
  const app = await text('src/editor-app.js')
  const combined = [api, shell, qualityGateShell, exportPanel, domControls, sceneCanvas, sceneRenderer, sceneRenderLifecycle, playtestPanel, animationRuntime, app].join('\n')

  assert.match(api, /\/api\/editor\/projects/)
  assert.match(api, /\/import-job/)
  assert.match(api, /\/export-pack/)
  assert.match(api, /\/assets\/\$\{encodeURIComponent\(assetId\)\}\/unlink/)
  assert.match(api, /\/api\/repair-character-action/)
  assert.match(api, /\/api\/jobs\/\$\{encodeURIComponent\(jobId\)\}/)
  assert.match(shell, /buildAssetLibraryEntry/)
  assert.match(shell, /buildSceneFlowBoard/)
  assert.match(shell, /exportEditorProjectPack/)
  assert.match(shell, /fetchEditorArtifactJson/)
  assert.match(shell, /renderExportPanel/)
  assert.match(shell, /triggerInteractions/)
  assert.match(shell, /createInteractionRuntimeState/)
  assert.match(shell, /tickPlaytestController/)
  assert.match(shell, /transitionPlaytestControllerScene/)
  assert.match(shell, /playtestControllerScene\(targetScene\)/)
  assert.match(shell, /editorState\.project\?\.scenes\?\.\[editorState\.playtest\.runtime\?\.activeSceneId\] \?\? activeScene\(\)/)
  assert.match(shell, /target scene has no compatible visible player layer/)
  assert.match(shell, /renderEditorSceneFrame/)
  assert.match(shell, /createSceneRenderLifecycle/)
  assert.match(shell, /getPlaytestPanelState/)
  assert.match(shell, /if \(!availability\.canStart\)/)
  assert.match(sceneRenderLifecycle, /loadSceneRenderAssets/)
  assert.match(shell, /Export later/)
  assert.match(shell, /from '\.\/domControls\.js'/)
  assert.match(shell, /from '\.\/exportPanel\.js'/)
  assert.ok(shell.split('\n').length < 3000)
  assert.match(exportPanel, /review_status/)
  assert.match(exportPanel, /Handoff Inspector/)
  assert.match(exportPanel, /Unsupported Items/)
  assert.match(exportPanel, /Scene \/ Layer Export Preview/)
  assert.match(exportPanel, /Review Checklist/)
  assert.match(domControls, /export function button/)
  assert.doesNotMatch(combined, /innerHTML/)
  assert.doesNotMatch(combined, /localStorage/)
  assert.doesNotMatch(combined, /apiKey|api_key|CHARACTER_IMAGE_API_KEY/)
  assert.doesNotMatch(combined, /\/generated\/|\/output\//)
  assert.doesNotMatch(combined, /globalFrame|activeFrame|currentFrame/)
  assert.doesNotMatch(playtestPanel, /Collision|Shadow|Surface audio|Touch joystick|Gamepad|Y-sort/)
})

test('editor shell styles use responsive panels without new UI dependencies', async () => {
  const css = await text('src/ui/editor/editor.css')
  const app = await text('src/editor-app.js')

  assert.match(css, /\.editor-main/)
  assert.match(css, /\.editor-stage-world/)
  assert.match(css, /\.editor-scene-canvas/)
  assert.match(css, /\.editor-playtest-hud/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /\.editor-layer-anchor/)
  assert.match(css, /\.editor-asset-thumb/)
  assert.match(css, /\.editor-asset-metas/)
  assert.match(css, /\.editor-interaction-zone/)
  assert.match(css, /\.editor-playtest-controls/)
  assert.match(css, /\.editor-resize-handle/)
  assert.match(css, /\.editor-timeline-row/)
  assert.match(css, /\.editor-flow-board/)
  assert.match(css, /\.editor-flow-card/)
  assert.match(css, /\.editor-playback-fields/)
  assert.match(css, /\.editor-repair-grid/)
  assert.match(css, /\.editor-repair-card/)
  assert.match(css, /\.editor-export-console/)
  assert.match(css, /\.editor-handoff-inspector/)
  assert.match(css, /\.editor-unsupported-items/)
  assert.match(css, /\.editor-export-preview/)
  assert.match(css, /\.editor-review-checklist/)
  assert.match(css, /@media \(max-width: 1080px\)/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.doesNotMatch(app, /react|pixi|konva|phaser/i)
})

test('editor shell delegates the focused Repair workbench and restores workspace mode', async () => {
  const shell = await text('src/ui/editor/shell.js')
  const controller = await text('src/ui/editor/repairWorkbenchController.js')
  const panel = await text('src/ui/editor/repairWorkbenchPanel.js')
  const css = await text('src/ui/editor/editor.css')

  assert.ok(shell.split('\n').length < 3000, 'editor shell must remain below 3000 lines')
  assert.match(shell, /createRepairWorkbenchController/)
  assert.match(shell, /createRepairWorkbenchPanel/)
  assert.match(shell, /const acceptedAssetId = result\.asset\?\.id \?\? editorState\.selectedAssetId/)
  assert.match(shell, /result\.project\?\.assets\?\.\[acceptedAssetId\]/)
  assert.match(shell, /function closeRepairSession\(reason\)/)
  assert.match(shell, /closeRepairSession\('project_switch'\)/)
  assert.match(shell, /closeRepairSession\(editorState\.project \? 'selection_cleared' : 'project_switch'\)/)
  assert.match(shell, /dataset\.workspaceMode = 'repair'/)
  assert.match(shell, /delete elements\.main\.dataset\.workspaceMode/)
  assert.match(shell, /delete elements\.stagePanel\.dataset\.workspaceMode/)
  assert.doesNotMatch(shell, /async function openRepairForAsset|function handleRepairLifecycleUpdate|function dispatchRepairFilmstrip/)
  assert.match(controller, /async function openRepairForAsset/)
  assert.match(controller, /function handleRepairLifecycleUpdate/)
  assert.match(controller, /function dispatchRepairFilmstrip/)
  assert.match(panel, /createRepairWorkbenchPanel/)

  assert.match(css, /\.editor-main\[data-workspace-mode="repair"\]/)
  assert.match(css, /\.editor-stage-panel\[data-workspace-mode="repair"\]/)
  assert.match(css, /grid-template-areas:\s*"header header"\s*"canvas recipe"\s*"filmstrip recipe"\s*"quality quality"/)
  assert.match(css, /minmax\(280px, 1fr\)/)
  assert.match(css, /overflow-x:\s*auto/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /\.editor-repair-recipe-backdrop:not\(\[hidden\]\)\s*\{[^}]*height:\s*auto/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})

test('editor shell wires one specialized Frame Repair lifecycle/controller and no general import path', async () => {
  const shell = await text('src/ui/editor/shell.js')
  const api = await text('src/ui/editor/api.js')
  const panel = await text('src/ui/editor/frameRepairPanel.js')
  const workbench = await text('src/ui/editor/repairWorkbenchPanel.js')

  for (const marker of [
    'createFrameRepairLifecycle', 'createFrameRepairController', 'frameRepairController',
    'planCharacterFrameRepair', 'generateCharacterFrameRepair', 'recoverCharacterFrameRepair',
    'acceptCharacterFrameRepair', 'fetchCharacterProviderState', 'handleLifecycleUpdate',
  ]) assert.match(shell, new RegExp(marker))
  assert.match(shell, /frameRepairController:\s*targetedFrameRepair/)
  assert.match(shell, /targetedFrameRepair\?\.dispose/)
  assert.match(api, /\/frame-repair\/plan/)
  assert.match(api, /\/frame-repair\/operations\//)
  assert.match(api, /\/frame-repair\/\$\{encodeURIComponent\(input\.jobId\)\}\/accept/)
  assert.doesNotMatch(panel, /importGeneratedJob|repairCharacterAction/)
  assert.match(workbench, /Repair Frame/)
})

test('editor shell owns one bounded Frame Repair Quality Gate runtime', async () => {
  const shell = await text('src/ui/editor/shell.js')
  const runtime = await text('src/ui/editor/frameRepairQualityGateShell.js')
  const workbench = await text('src/ui/editor/repairWorkbenchPanel.js')
  const css = await text('src/ui/editor/editor.css')

  assert.equal((shell.match(/createFrameRepairQualityGateRuntime\(\{/g) ?? []).length, 1)
  assert.equal((runtime.match(/createFrameRepairQualityGateController\(\{/g) ?? []).length, 1)
  for (const marker of [
    'setupFrameRepairQualityGate', 'planFrameRepairQualityGate', 'startFrameRepairQualityGate',
    'fetchFrameRepairQualityGate', 'recordFrameRepairQualityGateReview',
    'recordFrameRepairQualityGateOutcome', 'finalizeFrameRepairQualityGate',
    'attachPanel', 'reopen', 'handleProjectSwitch', 'dispose',
  ]) assert.match(runtime, new RegExp(marker))
  assert.match(runtime, /const DESKTOP_REVIEW_QUERY = '\(min-width: 761px\)'/)
  assert.equal((runtime.match(/addEventListener\?\.\('change', onMediaChange\)/g) ?? []).length, 1)
  assert.equal((runtime.match(/removeEventListener\?\.\('change', onMediaChange\)/g) ?? []).length, 1)
  assert.match(runtime, /identity: `quality-gate:\$\{session\.id\}`/)
  assert.match(runtime, /url,\s*allowedGeneratedUrls,/)
  assert.match(runtime, /function reopen\(\)[\s\S]*controller\.rehydrate\(\)/)
  assert.match(runtime, /active\?\.blind\?\.a === 'after'/)
  assert.doesNotMatch(runtime, /runAll|autoNext|automaticNext|retry|batch/i)
  assert.match(shell, /adoptProject: adoptQualityGateProject/)
  assert.match(shell, /frameRepairQualityGate\?\.handleProjectSwitch\(\)/)
  assert.match(shell, /frameRepairQualityGate\?\.dispose\(\)/)
  assert.match(shell, /ensureFrameRepairQualityGate\(\)\.attachPanel\(repairWorkbench\)/)
  assert.match(shell, /ensureFrameRepairQualityGate\(\)\.reopen\(\)/)
  assert.doesNotMatch(shell, /handleAction\('rehydrate'\)/)
  assert.match(workbench, /if \(opened\) void handleQualityGateAction\('rehydrate'\)/)
  assert.ok(shell.split('\n').length < 3000, 'editor shell must remain below 3000 lines')

  assert.match(css, /\.editor-repair-workbench\[data-quality-gate-workspace="true"\][^{]*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.editor-frame-repair-quality-gate\[data-view="review"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(18rem, 24rem\)/)
  assert.match(css, /grid-template-areas:\s*"session session"\s*"canvas evidence"\s*"progress progress"/)
  assert.match(css, /\.editor-frame-repair-quality-gate\s*\{[^}]*block-size:\s*100%[^}]*max-block-size:\s*100%[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow:\s*hidden/)
  assert.match(css, /\.editor-quality-gate-progress\s*\{[^}]*overflow-x:\s*auto/)
  assert.match(css, /\.editor-quality-gate-actions\s*\{[^}]*position:\s*sticky/)
  assert.doesNotMatch(css, /\.editor-(?:frame-repair-)?quality-gate[^,{]*\{[^}]*position:\s*fixed/)
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*\.editor-frame-repair-quality-gate\[data-view="review"\]/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.editor-repair-workbench\[data-quality-gate-workspace="true"\]/)
})

test('Frame Repair responsive styles preserve the existing drawer and bounded horizontal layout', async () => {
  const css = await text('src/ui/editor/editor.css')
  for (const marker of [
    '.editor-frame-repair-rail', '.editor-frame-repair-steps', '.editor-frame-repair-step',
    '.editor-frame-repair-stage-content',
    '.editor-frame-repair-mask-tools', '.editor-frame-repair-call-summary',
    '.editor-frame-repair-quality', '.editor-frame-repair-diagnostic',
    '.editor-repair-frame-option[data-repaired="true"]',
  ]) assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(css, /\.editor-frame-repair-step\[aria-current="step"\]/)
  assert.match(css, /\.editor-frame-repair-diagnostic\[data-tone="unknown"\]/)
  assert.match(css, /grid-template-rows:\s*auto auto auto minmax\(0, 1fr\)/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
