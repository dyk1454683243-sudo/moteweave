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

const FIGMA_TILE_CURRENT_NODE_IDS = Object.freeze([
  '603:4360',
  '909:6025',
  '909:7644',
  '910:4970',
  '911:4977',
  '911:6385',
])

const FIGMA_TILE_CURRENT_OVERRIDE_NODE_IDS = Object.freeze([
  '997:5491',
])

const FIGMA_TILE_ARCHIVE_NODE_IDS = Object.freeze([
  '912:5088',
  '913:5095',
  '913:5234',
  '914:5109',
  '918:5310',
  '997:6498',
])

const TILE_CURRENT_LOCAL_PHASES = Object.freeze(['empty', 'ready', 'building', 'complete', 'failed', 'stale'])
const TILE_ARCHIVE_AI_PHASES = Object.freeze(['ai_setup', 'ai_plan_ready', 'ai_running', 'ai_review', 'ai_failed'])
const TILE_PHASES = Object.freeze([...TILE_CURRENT_LOCAL_PHASES, ...TILE_ARCHIVE_AI_PHASES])

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

function attributeValue(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''
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
  assert.match(app, /if \(route === 'scene'\) return 'tiles'/)
  assert.match(app, /tiles: 'MoteWeave · 地图工作室'/)
  assert.match(app, /tiles: 'MoteWeave · Map Studio'/)
  assert.match(app, /else if \(activeRoute === 'tiles'\) renderStudioTilesLanguage\(\)/)
  assert.match(app, /tilesInitializationPromise = Promise\.resolve\(initStudioTiles\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)
  assert.doesNotMatch(tilesHtml(html), /tiles-legacy-link|\?tab=two-point-five-d|tiles\.legacy/)

  const currentSource = attributeValue(opening, 'data-design-source')
  const currentOverrideSource = attributeValue(opening, 'data-ux-design-source')
  const archiveInventory = attributeValue(opening, 'data-design-archive-inventory')
  const figmaPrefix = 'figma:ro8w6TKkpd969zW2V5bmkx/'

  assert.equal(currentSource, `${figmaPrefix}${FIGMA_TILE_CURRENT_NODE_IDS.join(',')}`)
  assert.equal(currentOverrideSource, `${figmaPrefix}${FIGMA_TILE_CURRENT_OVERRIDE_NODE_IDS.join(',')}`)
  assert.equal(archiveInventory, `${figmaPrefix}${FIGMA_TILE_ARCHIVE_NODE_IDS.join(',')}`)

  for (const nodeId of FIGMA_TILE_CURRENT_NODE_IDS) {
    assert.match(currentSource, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const nodeId of FIGMA_TILE_CURRENT_OVERRIDE_NODE_IDS) {
    assert.match(currentOverrideSource, new RegExp(nodeId.replace(':', '\\:')))
  }
  for (const nodeId of FIGMA_TILE_ARCHIVE_NODE_IDS) {
    assert.doesNotMatch(currentSource, new RegExp(nodeId.replace(':', '\\:')))
    assert.doesNotMatch(currentOverrideSource, new RegExp(nodeId.replace(':', '\\:')))
    assert.match(archiveInventory, new RegExp(nodeId.replace(':', '\\:')))
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
test('Tiles Current exposes six local phases and retains five AI phases as hidden inventory', async () => {
  const [html, view, api, cli] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
    readFile('src/ui/studio/tilesApi.js', 'utf8'),
    readFile('scripts/character-pack-cli.mjs', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  for (const phase of TILE_CURRENT_LOCAL_PHASES) {
    assert.match(tiles, new RegExp(`data-tiles-copy-phase="[^"]*\\b${phase}\\b`))
    assert.match(tiles, new RegExp(`data-tiles-panel="[^"]*\\b${phase}\\b`))
  }
  for (const phase of TILE_ARCHIVE_AI_PHASES) {
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
  assert.match(cli, /positional\[1\] === 'material-source-benchmark'/)
  assert.match(cli, /positional\[1\] === 'material-source-benchmark-review'/)
})

test('Tiles Current uses natural bilingual task copy without local Provider noise', async () => {
  const [html, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  const expected = {
    en: {
      'tiles.status.empty': 'Ready to edit',
      'tiles.status.ready': 'Edits ready',
      'tiles.status.building': 'Building tileset',
      'tiles.status.complete': 'Verified · download ready',
      'tiles.status.failed': 'Build did not complete',
      'tiles.status.stale': 'Input changed · rebuild required',
      'tiles.job.pill.building': 'Building',
      'tiles.job.pill.complete': 'Verified',
      'tiles.job.pill.stale': 'Rebuild required',
      'tiles.job.pill.failed': 'Build failed',
      'tiles.runtime.localPreview': 'Local preview',
      'tiles.runtime.localBuilding': 'Current build in progress',
      'tiles.runtime.localComplete': 'Verified outputs ready',
      'tiles.runtime.localFailed': 'Build did not complete',
      'tiles.runtime.localStale': 'Old result locked',
      'tiles.stageMetrics.localBuilding': '{status} · task {job}',
      'tiles.stageMetrics.localComplete': '18 artifact classes verified',
      'tiles.stageMetrics.localFailed': '{status} · task {job}',
      'tiles.stageMetrics.localStale': 'Current input needs a new build',
      'tiles.binding.zeroRequests': 'Procedural/local source · not submitted',
      'tiles.binding.notSubmitted': 'Build not started',
      'tiles.jobStatus.done': 'Complete',
      'tiles.jobStatus.post_processing': 'Post-processing',
      'tiles.jobStatus.failed_post_processing': 'Post-processing failed',
      'tiles.jobStatus.failed_model_error': 'Model failed',
      'tiles.jobStatus.failed_safety_filter': 'Safety filter blocked',
      'tiles.jobStatus.unknown': 'Status unavailable',
    },
    zh: {
      'tiles.status.empty': '等待编辑',
      'tiles.status.ready': '编辑已就绪',
      'tiles.status.building': '正在构建图块集',
      'tiles.status.complete': '验证通过 · 可下载',
      'tiles.status.failed': '构建未完成',
      'tiles.status.stale': '输入已变更 · 需要重建',
      'tiles.job.pill.building': '构建中',
      'tiles.job.pill.complete': '已验证',
      'tiles.job.pill.stale': '需要重建',
      'tiles.job.pill.failed': '构建失败',
      'tiles.runtime.localPreview': '本地预览',
      'tiles.runtime.localBuilding': '当前构建正在进行',
      'tiles.runtime.localComplete': '已验证产物可下载',
      'tiles.runtime.localFailed': '构建未完成',
      'tiles.runtime.localStale': '旧结果已锁定',
      'tiles.stageMetrics.localBuilding': '{status} · 任务 {job}',
      'tiles.stageMetrics.localComplete': '18 类产物已验证',
      'tiles.stageMetrics.localFailed': '{status} · 任务 {job}',
      'tiles.stageMetrics.localStale': '当前输入需要重新构建',
      'tiles.binding.zeroRequests': '程序化/本地来源 · 尚未提交',
      'tiles.binding.notSubmitted': '尚未开始构建',
      'tiles.jobStatus.done': '已完成',
      'tiles.jobStatus.post_processing': '后处理中',
      'tiles.jobStatus.failed_post_processing': '后处理失败',
      'tiles.jobStatus.failed_model_error': '模型失败',
      'tiles.jobStatus.failed_safety_filter': '安全过滤阻断',
      'tiles.jobStatus.unknown': '状态不可用',
    },
  }

  for (const language of ['en', 'zh']) {
    const actual = Object.fromEntries(Object.keys(expected[language]).map((key) => [key, STUDIO_TRANSLATIONS[language][key]]))
    assert.deepEqual(actual, expected[language])
    const visibleCopy = Object.values(actual).join('\n')
    assert.doesNotMatch(visibleCopy, /\b(?:empty|done|post_processing|failed_[a-z_]+)\b/i)
    assert.doesNotMatch(visibleCopy, /Provider/i)
  }

  assert.match(tiles, /<option value="empty" data-studio-i18n="tiles\.field\.borderEmpty">空白边界<\/option>/)
  assert.match(tiles, /<option value="none" data-studio-i18n="tiles\.field\.borderNone">不限制边界<\/option>/)
  assert.match(tiles, /<option value="constraint" data-studio-i18n="tiles\.field\.solverConstraint">约束求解<\/option>/)
  assert.match(tiles, /<option value="seeded" data-studio-i18n="tiles\.field\.solverSeeded">种子生成<\/option>/)
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.borderEmpty'], 'Empty border')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.borderNone'], 'Unconstrained border')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.field.borderEmpty'], '空白边界')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.field.borderNone'], '不限制边界')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.solverConstraint'], 'Constraint solver')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.solverSeeded'], 'Seeded generation')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.field.solverConstraint'], '约束求解')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.field.solverSeeded'], '种子生成')

  const localBindingWriter = view.match(/function renderLocalBinding\(state\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(localBindingWriter, /Provider|0 Provider/)
  assert.doesNotMatch(localBindingWriter, /toUpperCase\(\)/)
})

test('Tiles Figma geometry and empty-media boundaries are preserved in HTML/CSS', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.match(css, /\.tiles-workspace\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\)/)
  assert.match(css, /\.tiles-stage\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\) auto/)
  assert.match(css, /\.tiles-file-picker\s*\{[^}]*height:\s*52px/)
  assert.match(css, /\.tiles-field-grid :is\(input, select, output\)\s*\{[^}]*height:\s*32px/)
  assert.match(css, /\.tiles-ai-binding \{[^}]*width:\s*248px[^}]*min-height:\s*132px/)
  assert.match(css, /\.tiles-primary\s*\{[^}]*left:\s*0[^}]*right:\s*0[^}]*width:\s*auto\s*!important[^}]*min-height:\s*var\(--studio-module-cta-min-height\)/)
  assert.match(css, /\.tiles-output-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.tiles-output-card\s*\{[^}]*height:\s*auto/)
  assert.doesNotMatch(css, /\.tiles-output-card\s*\{[^}]*width:\s*178px[^}]*height:\s*72px/)
  assert.doesNotMatch(css, /\.tiles-output-dock \{[^}]*overflow-x:\s*auto/)
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
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.tiles-topbar\s*\{[^}]*height:\s*76px[\s\S]*?#studio-tiles-mode-local\s*\{[^}]*top:\s*auto[\s\S]*?#studio-tiles-mode-ai\s*\{[^}]*top:\s*auto/)

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

test('Tiles empty copy no longer uses a decorative person and outputs use human labels', async () => {
  const [html, css, view] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.doesNotMatch(tiles, /tiles-pixel-person/)
  assert.doesNotMatch(css, /tiles-pixel-person/)
  assert.match(tiles, /class="tiles-empty-copy"/)
  assert.doesNotMatch(css, /\.tiles-empty-panel > div:last-child/)
  assert.match(tiles, /data-studio-i18n="tiles\.empty\.title">把地形素材变成可编辑的地图/)
  assert.match(tiles, /data-studio-i18n="tiles\.empty\.body">确认地形素材和地图大小/)
  assert.match(tiles, /data-studio-i18n="tiles\.empty\.truth">图块结构由本地规则生成，不会自动调用 AI。/)
  assert.match(tiles, /data-studio-i18n="tiles\.contractTitle">地图设置/)
  assert.match(tiles, /data-studio-i18n="tiles\.field\.width">宽度（格）/)
  assert.match(tiles, /data-studio-i18n="tiles\.field\.height">高度（格）/)
  assert.match(tiles, /data-studio-i18n="tiles\.field\.densityHelp">控制地图中地形的覆盖程度/)
  assert.match(tiles, /data-studio-i18n="tiles\.primary\.empty">开始编辑地图/)
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.empty.title'], 'Turn terrain material into an editable map')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.empty.body'], 'Confirm the terrain material and map size, then start editing. The built-in default material is used when no image is uploaded.')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.empty.truth'], 'Tile structure is generated by local rules. AI is not called automatically.')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.contractTitle'], 'Map settings')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.width'], 'Width (cells)')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.height'], 'Height (cells)')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.densityHelp'], 'Controls how much of the map is covered by terrain.')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.primary.empty'], 'Start editing the map')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.empty.title'], '把地形素材变成可编辑的地图')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.contractTitle'], '地图设置')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.primary.empty'], '开始编辑地图')
  assert.match(tiles, /data-studio-i18n="tiles\.output\.localTitle">构建产物/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.localLede"/)
  assert.doesNotMatch(tilesHtml(html).split('data-tiles-output-mode="local"')[1].split('data-tiles-output-mode="ai"')[0], />\s*ATLAS\s*</)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.atlas\.name">图块集/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.atlas\.purpose">游戏地图使用的图块图片/)
  assert.match(tiles, /<code class="tiles-output-file">strict_atlas\.png<\/code>/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.map\.name">地图预览/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.map\.purpose">查看本次地图拼接效果/)
  assert.match(tiles, /<code class="tiles-output-file">map_editor_preview\.png<\/code>/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.tiled\.name">地图工程文件/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.tiled\.purpose">可在 Tiled 中继续编辑（两个文件）/)
  assert.match(tiles, /<code class="tiles-output-file">tileset\.tiled\.json \+ tileset\.tsx<\/code>/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.pack\.name">完整导出包/)
  assert.match(tiles, /data-studio-i18n="tiles\.output\.pack\.purpose">汇总本次构建的可交付结果/)
  assert.match(tiles, /<code class="tiles-output-file">release_demo_pack\.zip<\/code>/)
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.localTitle'], 'Build outputs')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.localTitle'], '构建产物')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.atlas.name'], 'Tileset image')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.empty'], 'Not built yet')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.ready'], 'Ready to build')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.building'], 'Generating')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.complete'], 'Download')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.failed'], 'Not generated')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.output.state.stale'], 'Rebuild required')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.empty'], '尚未构建')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.ready'], '等待构建')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.building'], '正在生成')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.complete'], '可下载')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.failed'], '未生成')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.output.state.stale'], '需重新构建')
  assert.match(view, /tiles\.output\.state\.complete/)
  assert.match(view, /tiles\.output\.state\.building/)
  assert.match(view, /tiles\.output\.state\.failed/)
  assert.match(view, /tiles\.output\.state\.stale/)
  assert.match(view, /tiles\.output\.state\.ready/)
  assert.match(view, /tiles\.output\.state\.empty/)
  assert.match(view, /state\.mode === 'local' && state\.phase === 'complete' && localTilesResultIsCurrent\(state\)/)
  assert.match(css, /@media \(max-width: 1771px\)[\s\S]*?\.tiles-output-grid \{[^}]*grid-template-columns:\s*1fr 1fr/)
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*?\.tiles-output-grid,[\s\S]*?grid-template-columns:\s*1fr/)
})

test('Tiles Current clips the left flow explainer and keeps phase copy inventory', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.match(tiles, /class="tiles-flow-header tiles-phase-copy"/)
  assert.match(tiles, /id="studio-tiles-phase-title"/)
  assert.match(tiles, /id="studio-tiles-phase-label"/)
  assert.match(tiles, /id="studio-tiles-phase-summary"/)
  assert.match(tiles, /aria-labelledby="studio-tiles-phase-title"/)
  assert.match(css, /\.tiles-flow-header \{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
  assert.match(css, /\.tiles-source-section \{ top: 16px;/)
  assert.match(css, /\.tiles-contract-section \{ top: 176px;/)
  assert.match(css, /\.tiles-ai-binding \{[^}]*top:\s*304px;/)
  assert.match(css, /\.tiles-ai-brief \{ top: 24px;/)
})

test('Tiles Current clips the local binding summary and keeps writers', async () => {
  const [html, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.match(tiles, /class="tiles-binding-summary"/)
  assert.match(tiles, /id="studio-tiles-binding-title"/)
  assert.match(tiles, /aria-labelledby="studio-tiles-binding-title"/)
  assert.match(tiles, /id="studio-tiles-binding-empty"/)
  assert.match(tiles, /id="studio-tiles-binding-ready"/)
  assert.match(tiles, /id="studio-tiles-binding-building"/)
  assert.match(tiles, /id="studio-tiles-binding-complete"/)
  assert.match(tiles, /id="studio-tiles-binding-failed"/)
  assert.match(tiles, /id="studio-tiles-binding-stale"/)
  assert.match(css, /\.tiles-binding-summary \{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/)
})

test('Tiles Current hides Provider material evaluation and keeps APIs as inventory', async () => {
  const [html, css, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
    readFile('src/ui/studio/tilesApi.js', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  assert.match(tiles, /id="studio-tiles-mode-ai"/)
  assert.match(tiles, /data-tiles-mode-panel="ai"/)
  assert.match(tiles, /class="tiles-ai-controls"/)
  assert.match(tiles, /class="tiles-ai-plan-panel"/)
  assert.match(tiles, /class="tiles-ai-review-panel"/)
  assert.match(tiles, /class="tiles-ai-failed-panel"/)
  assert.match(css, /#studio-tiles-mode-local,\s*#studio-tiles-mode-ai,\s*\.tiles-ai-controls,\s*\.tiles-ai-plan-panel,\s*\.tiles-ai-review-panel,\s*\.tiles-ai-failed-panel,\s*\.tiles-main \[data-tiles-output-mode="ai"\] \{[^}]*display:\s*none !important/)
  assert.match(view, /if \(state\.mode !== 'local'\) state\.mode = 'local'/)
  assert.match(view, /if \(!state \|\| mode !== 'local' \|\| state\.busy\) return/)
  assert.match(api, /\/api\/two-point-five-d-material-source-benchmark/)
  assert.match(api, /\/api\/build-two-point-five-d-tileset/)
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

test('Tiles and Scene unify into one Map workspace without fake AI generation', async () => {
  const [html, css, view, app] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
    readFile('src/ui/studio/tilesView.js', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
  ])
  const tiles = tilesHtml(html)
  const railStart = html.indexOf('<aside class="icon-rail"')
  const railEnd = html.indexOf('</aside>', railStart)
  const rail = html.slice(railStart, railEnd)
  assert.match(rail, /data-studio-i18n="nav\.tiles">地图</)
  assert.match(rail, /href="#scene"[^>]*hidden/)
  assert.match(css, /\.rail-item\[data-studio-route="scene"\] \{ display: none !important; \}/)
  assert.match(app, /if \(route === 'scene'\) return 'tiles'/)
  assert.equal(STUDIO_TRANSLATIONS.zh['nav.tiles'], '地图')
  assert.equal(STUDIO_TRANSLATIONS.en['nav.tiles'], 'Map')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.headerTitle'], '地图工作室')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.headerTitle'], 'Map Studio')
  assert.match(tiles, /data-studio-i18n="tiles\.sourceTitle">地形素材/)
  assert.match(tiles, /id="studio-tiles-use-default"/)
  assert.match(tiles, /data-studio-i18n="tiles\.sourceDefault">使用默认素材/)
  assert.match(tiles, /class="tiles-advanced-settings"/)
  assert.match(tiles, /data-studio-i18n="tiles\.field\.seedHelp">用于复现相同自动布局/)
  assert.match(css, /\.tiles-main:not\(\[data-tiles-phase="complete"\]\) \.tiles-output-grid\[data-tiles-output-mode="local"\] \{[^}]*display:\s*none/)
  assert.match(view, /function renderSourceControls\(state\)/)
  assert.match(view, /studio-tiles-use-default/)
  assert.match(view, /tilesState\.sourceFile = null/)
  assert.match(view, /if \(!\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes\(file\.type\)\)[\s\S]*return/)
  assert.doesNotMatch(view, /fetch\s*\(/)
  assert.match(view, /if \(!state \|\| mode !== 'local' \|\| state\.busy\) return/)
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.sourceDefault'], '使用默认素材')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.sourceDefault'], 'Use default material')
  assert.equal(STUDIO_TRANSLATIONS.zh['tiles.field.seedHelp'], '用于复现相同自动布局')
  assert.equal(STUDIO_TRANSLATIONS.en['tiles.field.seedHelp'], 'Reproduces the same automatic layout')
  assert.doesNotMatch(tiles, /可选：选择材质源图片/)
})
