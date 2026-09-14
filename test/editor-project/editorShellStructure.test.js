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
  const exportPanel = await text('src/ui/editor/exportPanel.js')
  const domControls = await text('src/ui/editor/domControls.js')
  const sceneCanvas = await text('src/ui/editor/sceneCanvas.js')
  const sceneRenderer = await text('src/ui/editor/sceneRenderer.js')
  const sceneRenderLifecycle = await text('src/ui/editor/sceneRenderLifecycle.js')
  const playtestPanel = await text('src/ui/editor/playtestPanel.js')
  const animationRuntime = await text('src/editor-project/animationRuntime.js')
  const app = await text('src/editor-app.js')
  const combined = [api, shell, exportPanel, domControls, sceneCanvas, sceneRenderer, sceneRenderLifecycle, playtestPanel, animationRuntime, app].join('\n')

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
  assert.doesNotMatch(shell, /repair_target_animation_reference_url|repaired_animation_strip_url|repaired_normalized_sheet_url|repair_validation_report_url/)
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
  assert.match(css, /\.editor-repair-action-filmstrip/)
  assert.match(css, /\.editor-repair-action-frame/)
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
  assert.match(shell, /createAiActionRepairWorkflow/)
  assert.match(shell, /function ensureAiActionRepairWorkflow\(\)/)
  assert.doesNotMatch(shell, /async function runRepairAction|async function acceptRepairActionCandidate/)
  assert.match(shell, /function closeRepairSession\(reason\)/)
  assert.match(shell, /closeRepairSession\('project_switch'\)/)
  assert.match(shell, /closeRepairSession\(editorState\.project \? 'selection_cleared' : 'project_switch'\)/)
  assert.match(shell, /dataset\.workspaceMode = 'repair'/)
  assert.match(shell, /delete elements\.main\.dataset\.workspaceMode/)
  assert.match(shell, /delete elements\.stagePanel\.dataset\.workspaceMode/)
  assert.doesNotMatch(shell, /buildCharacterReprocessPreview|acceptCharacterReprocessPreview|createRepairPreviewLifecycle/)
  assert.match(controller, /async function openAsset/)
  assert.match(controller, /buildFrameBatchRepairTargets/)
  assert.match(controller, /toggleFrameBatchRepairRegion/)
  assert.doesNotMatch(controller, /reprocess|Recipe|buildPreview|acceptPreview/i)
  assert.match(panel, /createRepairWorkbenchPanel/)
  assert.match(panel, /Three-atlas action repair/)
  assert.doesNotMatch(panel, /Processing Recipe|Build Preview|Accept as revision/)

  assert.match(css, /\.editor-main\[data-workspace-mode="repair"\]/)
  assert.match(css, /\.editor-stage-panel\[data-workspace-mode="repair"\]/)
  assert.match(css, /\.editor-repair-action-only/)
  assert.match(css, /\.editor-repair-action-filmstrip/)
  assert.match(css, /@media \(max-width: 760px\)/)
})

test('editor shell exposes only the three-atlas action repair product runtime', async () => {
  const api = await text('src/ui/editor/api.js')
  const shell = await text('src/ui/editor/shell.js')
  const workbench = await text('src/ui/editor/repairWorkbenchPanel.js')
  const runtime = [api, shell, workbench].join('\n')

  for (const marker of [
    'createFrameRepairLifecycle', 'createFrameRepairController', 'frameRepairController',
    'planCharacterFrameRepair', 'generateCharacterFrameRepair', 'recoverCharacterFrameRepair',
    'acceptCharacterFrameRepair', 'fetchCharacterProviderState',
    'createFrameRepairQualityGateRuntime', 'ensureFrameRepairQualityGate',
  ]) assert.doesNotMatch(runtime, new RegExp(marker))
  assert.match(shell, /createAiActionRepairWorkflow/)
  assert.match(shell, /function runRepairAction\(\)/)
  assert.doesNotMatch(workbench, /from '\.\/frameRepairPanel\.js'/)
  assert.doesNotMatch(workbench, /from '\.\/frameRepairQualityGatePanel\.js'/)
  assert.match(workbench, /dataset\.batchRepairRegion/)
  assert.match(workbench, /renderAiAction/)
  assert.doesNotMatch(runtime, /\/reprocess|editor_character_reprocess/)
})

test('editor shell does not initialize the retired single-frame quality-gate runtime', async () => {
  const shell = await text('src/ui/editor/shell.js')
  assert.equal((shell.match(/createFrameRepairQualityGateRuntime\(\{/g) ?? []).length, 0)
  assert.doesNotMatch(shell, /adoptQualityGateProject|frameRepairQualityGate|ensureFrameRepairQualityGate/)
  assert.ok(shell.split('\n').length < 3000, 'editor shell must remain below 3000 lines')
})

test('Repair responsive styles contain no retired single-frame surfaces', async () => {
  const css = await text('src/ui/editor/editor.css')
  for (const marker of [
    '.editor-frame-repair-rail', '.editor-frame-repair-steps', '.editor-frame-repair-step',
    '.editor-frame-repair-stage-content',
    '.editor-frame-repair-mask-tools', '.editor-frame-repair-call-summary',
    '.editor-frame-repair-quality', '.editor-frame-repair-diagnostic',
    '.editor-frame-repair-quality-gate', '.editor-quality-gate-',
  ]) assert.doesNotMatch(css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(css, /\.editor-repair-action-frame:has\(input:checked\)/)
  assert.match(css, /@media \(max-width: 760px\)/)
})
