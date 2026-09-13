import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

import {
  createInitialTilesState,
  deriveTilesPresentation,
  localTilesResultIsCurrent,
} from '../src/ui/studio/tilesView.js'
import {
  appendTwoPointFiveDOperation,
  buildTwoPointFiveDCornerGrid,
  createTwoPointFiveDBinding,
  normalizeTwoPointFiveDOptions,
  twoPointFiveDMaskFromGrid,
  twoPointFiveDOptionsKey,
} from '../src/ui/twoPointFiveD/core.js'
import { STUDIO_TRANSLATIONS } from '../src/ui/studio/settingsView.js'
import { TILES_LOCAL_ARTIFACT_FIELDS } from '../src/ui/studio/tilesApi.js'
import { applyTwoPointFiveDMapEditorWorkflow } from '../src/two-point-five-d/mapEditorWorkflow.js'
import { buildTwoPointFiveDAtlasPlan } from '../src/two-point-five-d/terrainAutotileBuilder.js'
import { solveTwoPointFiveDConstraintMap } from '../src/two-point-five-d/terrainRuleMapBuilder.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../src/two-point-five-d/tilesetContract.js'

const FIGMA_TILE_NODE_IDS = Object.freeze([
  '603:4360',
  '909:6025',
  '909:7644',
  '910:4970',
  '911:4977',
  '911:6385',
  '912:5088',
  '913:5095',
  '913:5234',
  '914:5109',
  '918:5310',
])

const TILE_PHASES = Object.freeze([
  'empty', 'ready', 'building', 'complete', 'failed', 'stale',
  'ai_setup', 'ai_plan_ready', 'ai_running', 'ai_review', 'ai_failed',
])

function verifiedLocalTilesJob(id = 'job_tiles_1') {
  return {
    id,
    type: 'two_point_five_d_tileset',
    status: 'done',
    validation_status: 'pass',
    tile_map_status: 'pass',
    map_editor_workflow_status: 'pass',
    ldtk_project_status: 'pass',
    ldtk_workflow_validation_status: 'pass',
    workflow_release_evidence_status: 'pass',
    workflow_release_ready: true,
    consumer_package_audit_status: 'pass',
    import_validation_status: 'pass',
    release_demo_pack_status: 'pass',
    release_demo_release_ready: true,
    external_import_smoke_status: 'pass',
    external_roundtrip_validation_status: 'not_run',
    external_roundtrip_ready: true,
    ...Object.fromEntries(Object.entries(TILES_LOCAL_ARTIFACT_FIELDS).map(([field, file]) => [field, `/generated/${id}/${file}`])),
  }
}

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function tilesHtml(html) {
  const start = html.indexOf('id="studio-tiles-view"')
  const end = html.indexOf('id="studio-scene-view"', start)
  assert.ok(start >= 0 && end > start, 'Studio Tiles view is missing')
  return html.slice(start, end)
}

test('Tiles Studio is the sole internal Figma-backed Tiles route', async () => {
  const [html, app] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
  ])
  const opening = openingTagForId(html, 'studio-tiles-view')
  assert.match(opening, /data-studio-view="tiles"[^>]*data-tiles-phase="empty"[^>]*data-tiles-mode="local"[^>]*hidden/)
  assert.match(html, /href="#tiles" data-studio-route="tiles"/)
  assert.match(app, /import \{ initStudioTiles, renderStudioTilesLanguage \} from '\.\/tilesView\.js'/)
  assert.match(app, /const STUDIO_ROUTES = Object\.freeze\(\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\)/)
  assert.match(app, /tiles: 'MoteWeave · 图块工作室'/)
  assert.match(app, /tiles: 'MoteWeave · Tiles Studio'/)
  assert.match(app, /else if \(activeRoute === 'tiles'\) renderStudioTilesLanguage\(\)/)
  assert.match(app, /tilesInitializationPromise = Promise\.resolve\(initStudioTiles\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)
  assert.doesNotMatch(tilesHtml(html), /tiles-legacy-link|\?tab=two-point-five-d|tiles\.legacy/)

  for (const nodeId of FIGMA_TILE_NODE_IDS) {
    assert.match(opening, new RegExp(nodeId.replace(':', '\\:')))
  }
  assert.doesNotMatch(opening, /54:1883/, 'Archive is reference-only, not a live Studio phase')
})

test('legacy root shell is retired while maintained Tiles core and APIs stay reachable', async () => {
  const [core, api, studioHtml] = await Promise.all([
    readFile('src/ui/twoPointFiveD/core.js', 'utf8'),
    readFile('src/ui/studio/tilesApi.js', 'utf8'),
    readFile('src/ui/studio/studio.html', 'utf8'),
  ])

  await assert.rejects(access('index.html'), { code: 'ENOENT' })
  await assert.rejects(access('src/app.js'), { code: 'ENOENT' })
  await assert.rejects(access('src/ui/appState.js'), { code: 'ENOENT' })
  assert.match(studioHtml, /id="studio-tiles-view"/)
  assert.match(core, /export function buildTwoPointFiveDCornerGrid/)
  assert.match(api, /\/api\/build-two-point-five-d-tileset/)
  assert.match(api, /\/api\/two-point-five-d-material-source-benchmark/)
})
test('Tiles Studio exposes exactly the eleven Current Figma phases without fake capabilities', async () => {
  const [html, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
    readFile('src/ui/studio/tilesApi.js', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  for (const phase of TILE_PHASES) {
    assert.match(tiles, new RegExp(`data-tiles-copy-phase="[^"]*\\b${phase}\\b`))
    assert.match(tiles, new RegExp(`data-tiles-panel="[^"]*\\b${phase}\\b`))
  }
  const sourcePhases = [...view.matchAll(/^\s*'([a-z_]+)',?$/gm)].map((match) => match[1])
  const declared = sourcePhases.slice(0, TILE_PHASES.length)
  assert.deepEqual(declared, TILE_PHASES)

  assert.doesNotMatch(tiles, /(?:WASD|修复台|自动修复|OpenRouter|完整资源包|生成场景)/i)
  assert.doesNotMatch(tiles, /<(?:button|a)[^>]*(?:cancel|retry-live|resubmit)/i)
  assert.doesNotMatch(api, /\/api\/(?:generate-character|generate-scene-tiles|project-pack)/)
  assert.match(api, /\/api\/build-two-point-five-d-tileset/)
  assert.match(api, /\/api\/two-point-five-d-material-source-benchmark/)
  assert.match(api, /\/api\/gemini-state/)
  assert.equal((api.match(/confirm_live_generation:\s*true/g) ?? []).length, 1)
  assert.match(api, /dryRunPlan:\s*true/)
  assert.match(view, /buildTwoPointFiveDMaterialSourceBenchmarkReview\(report\)/)
})

test('Tiles Figma geometry and empty-media boundaries are preserved in HTML/CSS', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.match(css, /\.tiles-workspace\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\)/)
  assert.match(css, /\.tiles-stage\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 896px\) 104px/)
  assert.match(css, /\.tiles-file-picker\s*\{[^}]*height:\s*76px/)
  assert.match(css, /\.tiles-field-grid :is\(input, select, output\)\s*\{[^}]*height:\s*32px/)
  assert.match(css, /\.tiles-binding-summary,[^}]*width:\s*248px[^}]*min-height:\s*132px/)
  assert.match(css, /\.tiles-primary\s*\{[^}]*width:\s*248px[^}]*height:\s*48px/)
  assert.match(css, /\.tiles-output-card\s*\{[^}]*width:\s*178px[^}]*height:\s*72px/)
  assert.match(css, /\.tiles-main\[data-tiles-phase="ready"\] \.tiles-editor-panel::before\s*\{[^}]*width:\s*940px[^}]*height:\s*650px/)
  assert.match(css, /\.tiles-main\[data-tiles-phase="ready"\] \.tiles-map-layout\s*\{[^}]*grid-template-columns:\s*520px 276px[^}]*gap:\s*30px/)
  assert.match(css, /\.tiles-main:is\(\[data-tiles-phase="building"\],\[data-tiles-phase="complete"\],\[data-tiles-phase="stale"\]\) \.tiles-job-card\s*\{[^}]*width:\s*400px[^}]*height:\s*310px/)
  assert.match(css, /\.tiles-failed-panel\s*\{[^}]*width:\s*716px[^}]*height:\s*300px/)
  assert.match(css, /\.tiles-ai-plan-panel\s*\{[^}]*width:\s*1156px[^}]*height:\s*470px/)
  assert.match(css, /\.tiles-ai-review-panel\s*\{[^}]*width:\s*1328px[^}]*height:\s*650px/)
  assert.match(css, /\.tiles-ai-failed-panel\s*\{[^}]*width:\s*1156px[^}]*height:\s*470px/)
  assert.match(css, /\.tiles-ai-review-grid\s*\{[^}]*grid-template-columns:\s*620px 636px[^}]*gap:\s*24px/)
  assert.match(css, /\.tiles-job-card p\s*\{[^}]*white-space:\s*pre-line/)
  assert.match(css, /@media \(max-width: 1771px\)/)
  assert.match(css, /@media \(max-width: 1083px\)/)
  assert.match(css, /@media \(max-width: 860px\)/)
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.tiles-topbar\s*\{[^}]*height:\s*76px[\s\S]*?#studio-tiles-mode-local\s*\{[^}]*top:\s*44px[\s\S]*?#studio-tiles-mode-ai\s*\{[^}]*top:\s*44px/)

  const preview = openingTagForId(tiles, 'studio-tiles-result-preview')
  assert.match(preview, /\bhidden\b/)
  assert.doesNotMatch(preview, /\bsrc\s*=/)
  for (const id of [
    'studio-tiles-output-atlas', 'studio-tiles-output-map', 'studio-tiles-output-tiled',
    'studio-tiles-output-pack', 'studio-tiles-output-plan', 'studio-tiles-output-report',
    'studio-tiles-output-notes',
  ]) {
    const tag = openingTagForId(tiles, id)
    assert.match(tag, /aria-disabled="true"/)
    assert.doesNotMatch(tag, /\bhref\s*=/)
  }
  assert.match(css, /\.tiles-binding-copy > span\s*\{(?![^}]*display:\s*flex\s*!important)/)
  assert.match(css, /\.tiles-main\[data-tiles-phase="empty"\] \.tiles-binding-copy/)
})

test('the maintained map options and corner editor have zero silent bindings', () => {
  const defaults = normalizeTwoPointFiveDOptions()
  assert.deepEqual(defaults, {
    mapSolver: 'constraint',
    mapBorder: 'empty',
    mapWidth: 8,
    mapHeight: 6,
    mapSeed: 170617,
    mapDensity: 0.55,
    editorOperations: [],
  })
  const painted = appendTwoPointFiveDOperation(defaults, {
    type: 'paint_terrain_rect', x: 2, y: 1, w: 2, h: 2,
  })
  const corner = appendTwoPointFiveDOperation(painted, {
    type: 'set_corner', x: 3, y: 2, solid: false,
  })
  assert.equal(corner.editorOperations.length, 2)
  const preview = buildTwoPointFiveDCornerGrid(corner)
  assert.equal(preview.width, 8)
  assert.equal(preview.height, 6)
  assert.ok(twoPointFiveDMaskFromGrid(preview.grid, 2, 1) >= 0)
  assert.notEqual(twoPointFiveDOptionsKey(defaults), twoPointFiveDOptionsKey(corner))
})

test('Tiles preview uses the same maintained constraint solver and editor workflow as the build', () => {
  const options = appendTwoPointFiveDOperation(normalizeTwoPointFiveDOptions({
    mapSolver: 'constraint',
    mapBorder: 'empty',
    mapWidth: 8,
    mapHeight: 6,
    mapSeed: 170617,
    mapDensity: 0.55,
  }), { type: 'set_corner', x: 3, y: 2, solid: true })
  const plan = buildTwoPointFiveDAtlasPlan(DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT)
  const solved = solveTwoPointFiveDConstraintMap({
    plan,
    width: options.mapWidth,
    height: options.mapHeight,
    seed: options.mapSeed,
    density: options.mapDensity,
    constraints: { border: options.mapBorder },
  })
  assert.equal(solved.status, 'pass')
  const maintained = applyTwoPointFiveDMapEditorWorkflow({
    plan,
    map: solved.map,
    operations: options.editorOperations,
    sessionId: 'test_preview_binding',
  }).map
  const preview = buildTwoPointFiveDCornerGrid(options)
  const previewMasks = []
  for (let y = 0; y < preview.height; y += 1) {
    for (let x = 0; x < preview.width; x += 1) {
      previewMasks.push(twoPointFiveDMaskFromGrid(preview.grid, x, y))
    }
  }
  assert.deepEqual(previewMasks, maintained.cells.map((cell) => cell.mask))
})

test('local output ownership and all primary actions are fail-closed', () => {
  const state = createInitialTilesState()
  assert.deepEqual(deriveTilesPresentation(state), {
    phase: 'empty', isAi: false, action: 'edit', busy: false,
  })
  state.localPhase = state.phase = 'ready'
  assert.equal(deriveTilesPresentation(state).action, 'build')
  state.localPhase = state.phase = 'building'
  assert.equal(deriveTilesPresentation(state).action, 'blocked')
  state.job = { id: 'job_tiles_1' }
  state.localPollInterrupted = true
  assert.equal(deriveTilesPresentation(state).action, 'resume_local')

  state.optionsKey = twoPointFiveDOptionsKey(state.options)
  state.binding = createTwoPointFiveDBinding({ sourceEpoch: 0, optionsKey: state.optionsKey, jobId: 'job_tiles_1' })
  state.resultJob = verifiedLocalTilesJob('job_tiles_1')
  assert.equal(localTilesResultIsCurrent(state), true)
  state.sourceEpoch += 1
  assert.equal(localTilesResultIsCurrent(state), false)

  state.mode = 'ai'
  state.aiPhase = state.phase = 'ai_setup'
  assert.equal(deriveTilesPresentation(state).action, 'plan')
  state.aiPhase = state.phase = 'ai_plan_ready'
  assert.equal(deriveTilesPresentation(state).action, 'run')
  state.ai.consumed = true
  state.aiPhase = state.phase = 'ai_running'
  assert.equal(deriveTilesPresentation(state).action, 'blocked')
  state.ai.job = { id: 'job_benchmark_1' }
  state.ai.pollInterrupted = true
  assert.equal(deriveTilesPresentation(state).action, 'resume_ai')
  state.aiPhase = state.phase = 'ai_review'
  assert.equal(deriveTilesPresentation(state).action, 'return_local')
  state.aiPhase = state.phase = 'ai_failed'
  assert.equal(deriveTilesPresentation(state).action, 'replan_ai')
})

test('Tiles view binds stale, same-Job observation, Gemini planning, and real artifacts', async () => {
  const view = await readFile('src/ui/studio/tilesView.js', 'utf8')
  assert.match(view, /if \(state\.resultJob\) setLocalPhase\(state, 'stale'\)/)
  assert.match(view, /twoPointFiveDBindingIsCurrent\(state\.binding, currentSnapshot\(state\)\)/)
  assert.match(view, /state\.binding = createTwoPointFiveDBinding\(\{[\s\S]*jobId: terminal\.id/)
  assert.match(view, /pollTilesJob\(job, \{[\s\S]*kind: 'local'/)
  assert.match(view, /pollTilesJob\(job, \{[\s\S]*kind: 'benchmark'/)
  assert.match(view, /state\.ai\.consumed = true[\s\S]*postTilesBenchmarkRun\(state\.ai\.plan/)
  assert.match(view, /error\?\.code === 'poll_interrupted'/)
  assert.match(view, /state\.ai\.lockedUnknownSubmission = true/)
  assert.match(view, /setAiPhase\(state, 'ai_failed'\)/)
  assert.match(view, /state\.ai\.error = new Error\(terminal\.reason \|\| terminal\.status\)[\s\S]*state\.ai\.job = terminal|state\.ai\.job = terminal[\s\S]*setAiPhase\(state, 'ai_failed'\)/)
  assert.match(view, /else if \(action === 'replan_ai'\) replanBenchmark\(\)/)
  assert.match(view, /function invalidateAiPlan\(state\)[\s\S]*state\.ai\.plan = null[\s\S]*setAiPhase\(state, 'ai_setup'\)/)
  assert.match(view, /function aiAuthorityMustBePreserved\(state\)[\s\S]*state\.ai\.lockedUnknownSubmission[\s\S]*state\.aiPhase === 'ai_running'/)
  assert.match(view, /invalidateLocalResult\(state\)[\s\S]*invalidateAiPlan\(state\)/)
  assert.match(view, /expectedBenchmark:\s*\{[\s\S]*expectedRunId:[\s\S]*providerPresetId:[\s\S]*candidateCount:/)
  assert.match(view, /expectedProviderConfig:\s*state\.ai\.plan\.sealed_provider_config/)
  assert.match(view, /tilesBenchmarkSubmissionIsDefiniteRejection\(error\)/)
  assert.match(view, /state\.ai\.lockedUnknownSubmission && !state\.ai\.job[\s\S]*tiles\.runtime\.submissionUnknown/)
  assert.match(view, /button\.disabled = state\.busy !== null/)
  assert.match(view, /tilesState\.resultImageFailed = true[\s\S]*setLocalPhase\(tilesState, 'failed'\)/)
  assert.match(view, /state\.phase === 'complete' && localTilesResultIsCurrent\(state\)/)
  assert.match(view, /secondaryField:\s*'tiled_tsx_url'/)
  assert.match(view, /triggerTilesDownload\(primaryUrl, 'tileset\.tiled\.json'\)[\s\S]*triggerTilesDownload\(secondaryUrl/)
  assert.match(view, /dataset\.userEdited = 'true'/)
  assert.match(view, /state\.ai\.request\?\.description\) description\.value = state\.ai\.request\.description/)
  assert.match(view, /tiles\.editor\.canvasDynamicLabel/)
  assert.match(view, /tiles\.stageMetrics\.aiFailed/)
  assert.match(view, /tiles\.stageMetrics\.localComplete/)
  assert.doesNotMatch(view, /(?:mock|placeholder|sampleResult|historicalResult)/i)
})

test('Tiles visible and ARIA copy is fully bilingual', async () => {
  const html = await readFile('src/ui/studio/studio.html', 'utf8')
  const tiles = tilesHtml(html)
  assert.deepEqual(
    Object.keys(STUDIO_TRANSLATIONS.en).filter((key) => key.startsWith('tiles.')).sort(),
    Object.keys(STUDIO_TRANSLATIONS.zh).filter((key) => key.startsWith('tiles.')).sort(),
  )
  const markers = [...tiles.matchAll(/data-studio-i18n(?:-aria-label|-placeholder|-alt)?="([^"]+)"/g)]
    .map((match) => match[1])
  for (const key of markers) {
    assert.equal(typeof STUDIO_TRANSLATIONS.en[key], 'string', `missing English ${key}`)
    assert.equal(typeof STUDIO_TRANSLATIONS.zh[key], 'string', `missing Chinese ${key}`)
  }
  for (const key of [
    'tiles.primary.resumeSameJob', 'tiles.ai.providerReady', 'tiles.error.previewUnavailable',
    'tiles.runtime.submissionUnknown', 'tiles.error.sourceSize', 'tiles.output.generating',
    'tiles.output.locked', 'tiles.output.downloadable', 'tiles.output.viewable',
    'tiles.jobStatus.failed_model_error', 'tiles.jobStatus.failed_post_processing',
    'tiles.crumb.aiFailed', 'tiles.phase.aiFailedTitle', 'tiles.primary.aiReplan',
    'tiles.output.truth.aiFailed', 'tiles.ai.descriptionDefault', 'tiles.ai.plan.subjectValue',
    'tiles.runtime.aiFailed', 'tiles.stageMetrics.localFailed',
    'tiles.editor.canvasDynamicLabel',
  ]) {
    assert.equal(typeof STUDIO_TRANSLATIONS.en[key], 'string')
    assert.equal(typeof STUDIO_TRANSLATIONS.zh[key], 'string')
  }
})
