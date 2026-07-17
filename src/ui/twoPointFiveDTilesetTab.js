import { state } from './appState.js'
import { applyProviderState } from './characterPack/providerStatus.js'
import { $, showToast } from './dom.js'
import {
  fetchProviderState,
  initProviderConfigSurface,
  setProviderText,
} from './providerConfig.js'
import {
  buildTwoPointFiveDTileset,
  fetchJsonArtifact,
  planTwoPointFiveDMaterialSourceBenchmark,
  runTwoPointFiveDMaterialSourceBenchmark,
  waitForTwoPointFiveDJob,
} from './twoPointFiveD/api.js'
import { buildTwoPointFiveDMaterialSourceBenchmarkReview } from '../two-point-five-d/materialSourceBenchmarkReviewCore.js'

const CELL = 56
const PAD = 28

let activeTool = 'paint'
let dragStart = null
let tilesetBenchmarkProviderReady = false

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function setTilesetStatus(message, status = 'idle') {
  const statusEl = $('#tileset-status')
  statusEl.textContent = message
  statusEl.dataset.status = status
}

function readTilesetOptions() {
  return {
    mapSolver: $('#tileset-map-solver').value,
    mapBorder: $('#tileset-map-border').value,
    mapWidth: Number($('#tileset-map-width').value),
    mapHeight: Number($('#tileset-map-height').value),
    mapSeed: Number($('#tileset-seed').value),
    mapDensity: Number($('#tileset-density').value),
    editorOperations: state.twoPointFiveD.operations,
  }
}

function readBenchmarkOptions() {
  const candidateCount = Number($('#tileset-benchmark-candidate-count')?.value ?? 4)
  const maxProviderCalls = Number($('#tileset-benchmark-max-calls')?.value ?? candidateCount)
  const imageSize = $('#tileset-benchmark-image-size')?.value || '1K'
  return {
    description: ($('#tileset-benchmark-description')?.value || '').trim(),
    candidateCount,
    imageSize,
    sourceImageSize: imageSize,
    imageConfig: {
      image_size: imageSize,
      aspect_ratio: '1:1',
    },
    maxProviderCalls,
    options: readTilesetOptions(),
  }
}

function syncBenchmarkRunButton() {
  const button = $('#tileset-run-benchmark')
  if (!button) return
  const confirmed = Boolean($('#tileset-benchmark-confirm-live')?.checked)
  const maxProviderCalls = Number($('#tileset-benchmark-max-calls')?.value)
  button.disabled = !tilesetBenchmarkProviderReady || !confirmed || !Number.isFinite(maxProviderCalls) || maxProviderCalls < 1
}

function setBenchmarkStatus(message) {
  setProviderText('#tileset-benchmark-status', message)
}

function applyTilesetProviderState(provider) {
  tilesetBenchmarkProviderReady = Boolean(provider.implemented && provider.available && provider.status !== 'configuration_error')
  setProviderText(
    '#tileset-provider-config-status',
    provider.runtime_configured
      ? 'Browser session provider active'
      : (provider.available ? 'Local environment provider active' : 'Local session provider not set')
  )
  if (!provider.implemented) {
    setProviderText('#tileset-provider-state', 'AI source benchmark not implemented')
  } else if (provider.status === 'validating') {
    setProviderText('#tileset-provider-state', 'Checking provider state...')
  } else if (provider.status === 'configuration_error') {
    setProviderText('#tileset-provider-state', `Provider config error: ${provider.error || 'check settings'}`)
  } else if (provider.available) {
    setProviderText('#tileset-provider-state', 'Material source benchmark provider ready')
  } else {
    setProviderText('#tileset-provider-state', 'Material source benchmark not configured')
  }
  syncBenchmarkRunButton()
}

async function refreshTilesetProviderState() {
  try {
    const provider = await fetchProviderState()
    applyTilesetProviderState(provider)
    applyProviderState(provider)
  } catch {
    tilesetBenchmarkProviderReady = false
    setProviderText('#tileset-provider-state', 'Provider state unavailable')
    syncBenchmarkRunButton()
  }
}

function initTilesetProviderConfigControls() {
  initProviderConfigSurface({
    providerSelector: '#tileset-runtime-provider',
    modelSelector: '#tileset-runtime-model',
    baseUrlFieldSelector: '#tileset-runtime-base-url-field',
    baseUrlSelector: '#tileset-runtime-base-url',
    apiKeySelector: '#tileset-runtime-api-key',
    toggleSelector: '#tileset-toggle-api-key',
    saveSelector: '#tileset-save-provider-config',
    clearSelector: '#tileset-clear-provider-config',
    statusSelector: '#tileset-provider-config-status',
    onProviderState(provider) {
      applyTilesetProviderState(provider)
      applyProviderState(provider)
    },
  })
  refreshTilesetProviderState()
}

function renderBenchmarkLinks(links = []) {
  const container = $('#tileset-benchmark-links')
  const available = links.filter((item) => item.href)
  container.innerHTML = links.map((item) => `
    <div class="tileset-export-row ${item.href ? '' : 'is-empty'}">
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.format)}</small></span>
      ${item.href ? `<a href="${escapeHtml(item.href)}" target="_blank" rel="noreferrer" download>Download</a>` : '<em>After run</em>'}
    </div>
  `).join('')
  return available.length
}

function renderBenchmarkMetrics({ calls = '—', candidates = '—', usable = '—' } = {}) {
  $('#tileset-benchmark-metrics').innerHTML = `
    <span><small>Calls</small><b>${escapeHtml(calls)}</b></span>
    <span><small>Candidates</small><b>${escapeHtml(candidates)}</b></span>
    <span><small>Usable</small><b>${escapeHtml(usable)}</b></span>
  `
}

function renderBenchmarkIdle() {
  $('#tileset-benchmark-result-status').textContent = 'NOT RUN'
  renderBenchmarkMetrics()
  renderBenchmarkLinks([])
  $('#tileset-benchmark-summary').innerHTML = '<p>Generate a dry-run plan before spending provider quota.</p>'
}

function renderBenchmarkPlan(plan) {
  state.twoPointFiveD.benchmark = plan
  $('#tileset-benchmark-result-status').textContent = 'PLAN'
  renderBenchmarkMetrics({
    calls: plan.estimated_provider_calls ?? '—',
    candidates: plan.candidate_count ?? '—',
    usable: 'not run',
  })
  renderBenchmarkLinks([
    { name: 'Dry-run plan', format: 'material_source_benchmark_plan.json', href: plan.plan_url },
  ])
  $('#tileset-benchmark-summary').innerHTML = `
    <p>Cases: <strong>${escapeHtml((plan.case_ids ?? []).join(', ') || '—')}</strong></p>
    <p>${escapeHtml(plan.claim_boundary ?? 'Provider raw sources only; local deterministic code owns final tileset structure.')}</p>
  `
}

const BENCHMARK_ACTION_LABELS = Object.freeze({
  fix_provider_route: 'Fix provider route',
  improve_material_extraction: 'Improve material extraction',
  improve_source_normalization: 'Improve source normalization',
  inspect_report: 'Inspect report',
  review_warning_taxonomy: 'Review warning taxonomy',
  run_larger_sample: 'Run larger sample',
})

function formatRate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Math.round(number * 1000) / 10}%`
}

function formatCountGroup(counts = {}) {
  return `pass ${counts.pass ?? 0} · warn ${counts.warning ?? 0} · fail ${counts.fail ?? 0} · err ${counts.error ?? 0}`
}

function renderBenchmarkSelectedCases(selectedCases = []) {
  if (!selectedCases.length) return '<p>No selected candidate rows were written.</p>'
  return `
    <div class="tileset-review-case-list">
      ${selectedCases.map((item) => `
        <div class="tileset-review-case">
          <span>
            <b>${escapeHtml(item.case_id)}</b>
            <small>${escapeHtml(item.selection_reason || 'No selection reason recorded')}</small>
          </span>
          <span class="tileset-review-status" data-status="${escapeHtml(item.selected_status)}">${escapeHtml(item.selected_status)}</span>
          <small>${escapeHtml(item.selected_candidate_id ?? 'none')} · warnings ${escapeHtml(item.warning_count)} · blockers ${escapeHtml(item.blocking_error_count)}</small>
        </div>
      `).join('')}
    </div>
  `
}

function renderBenchmarkTopIssues(topIssues = []) {
  if (!topIssues.length) return '<p>No top issues in this benchmark report.</p>'
  return `
    <ul class="tileset-review-issue-list">
      ${topIssues.slice(0, 8).map((issue) => `
        <li>
          <span>
            <b>${escapeHtml(issue.id)}</b>
            <small>${escapeHtml((issue.examples ?? []).join(', ') || 'no examples')}</small>
          </span>
          <strong>${escapeHtml(issue.count)}</strong>
        </li>
      `).join('')}
    </ul>
  `
}

function renderBenchmarkReportSummary(report) {
  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const actionLabel = BENCHMARK_ACTION_LABELS[review.decision.next_action] ?? review.decision.next_action
  $('#tileset-benchmark-summary').innerHTML = `
    <div class="tileset-review-decision" data-status="${escapeHtml(review.status)}">
      <span class="tileset-review-pill" data-status="${escapeHtml(review.status)}">${escapeHtml(review.status)}</span>
      <div>
        <strong>${escapeHtml(actionLabel)}</strong>
        <p>${escapeHtml(review.decision.rationale)}</p>
      </div>
      <small>${escapeHtml(review.decision.priority)} · release ${review.release_ready ? 'ready' : 'not ready'}</small>
    </div>
    <div class="tileset-review-grid">
      <span><small>Selected usable</small><b>${escapeHtml(formatRate(review.summary.selected_usable_rate))}</b></span>
      <span><small>Selected pass</small><b>${escapeHtml(formatRate(review.summary.selected_pass_rate))}</b></span>
      <span><small>Selected status</small><b>${escapeHtml(formatCountGroup(review.summary.selected_counts))}</b></span>
      <span><small>Provider errors</small><b>${escapeHtml(review.summary.provider_error_count)}</b></span>
    </div>
    <h4>Selected Candidates</h4>
    ${renderBenchmarkSelectedCases(review.selected_cases)}
    <h4>Top Issues</h4>
    ${renderBenchmarkTopIssues(review.top_issues)}
    <p class="tileset-review-boundary">${escapeHtml(review.claim_boundary)}</p>
  `
}

async function renderBenchmarkJob(job) {
  state.twoPointFiveD.benchmark = job
  $('#tileset-benchmark-result-status').textContent = String(job?.benchmark_status ?? job?.status ?? 'idle').toUpperCase()
  const budget = job?.provider_call_budget
  renderBenchmarkMetrics({
    calls: budget ? `${budget.used_provider_calls ?? 0}/${budget.max_provider_calls ?? '—'}` : (job?.estimated_provider_calls ?? '—'),
    candidates: job?.candidate_count ?? '—',
    usable: job?.selected_usable_rate ?? '—',
  })
  renderBenchmarkLinks([
    { name: 'Benchmark plan', format: 'material_source_benchmark_plan.json', href: job?.material_source_benchmark_plan_url },
    { name: 'Benchmark report', format: 'material_source_benchmark.json', href: job?.material_source_benchmark_url },
    { name: 'Benchmark notes', format: 'material_source_benchmark.md', href: job?.material_source_benchmark_md_url },
  ])
  if (!job?.material_source_benchmark_url) {
    $('#tileset-benchmark-summary').innerHTML = job?.reason
      ? `<p>${escapeHtml(job.reason)}</p>`
      : '<p>Benchmark is waiting for provider candidates.</p>'
    return
  }
  try {
    const report = await fetchJsonArtifact(job.material_source_benchmark_url)
    renderBenchmarkReportSummary(report)
  } catch (error) {
    $('#tileset-benchmark-summary').innerHTML = `<p>${escapeHtml(error.message || String(error))}</p>`
  }
}

function safePreviewDimensions(options = readTilesetOptions()) {
  return {
    width: Number.isFinite(options.mapWidth) && options.mapWidth > 0 ? Math.floor(options.mapWidth) : 8,
    height: Number.isFinite(options.mapHeight) && options.mapHeight > 0 ? Math.floor(options.mapHeight) : 6,
  }
}

function seededUnit(x, y, seed) {
  let value = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed, 1442695041)) >>> 0
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

function buildPreviewCornerGrid() {
  const options = readTilesetOptions()
  const { width, height } = safePreviewDimensions(options)
  const density = Math.max(0, Math.min(1, options.mapDensity))
  const seed = Number.isFinite(options.mapSeed) ? options.mapSeed : 170617
  const grid = Array.from({ length: height + 1 }, (_, y) => (
    Array.from({ length: width + 1 }, (_, x) => {
      if (options.mapBorder === 'empty' && (x === 0 || y === 0 || x === width || y === height)) return false
      return seededUnit(x, y, seed) < density
    })
  ))
  for (const operation of state.twoPointFiveD.operations) {
    if (operation.type === 'paint_terrain_rect' || operation.type === 'erase_terrain_rect') {
      const solid = operation.type === 'paint_terrain_rect'
      for (let y = operation.y; y <= operation.y + operation.h; y += 1) {
        for (let x = operation.x; x <= operation.x + operation.w; x += 1) {
          if (grid[y]?.[x] !== undefined) grid[y][x] = solid
        }
      }
    }
    if (operation.type === 'set_corner' && grid[operation.y]?.[operation.x] !== undefined) {
      grid[operation.y][operation.x] = Boolean(operation.solid)
    }
  }
  return { grid, width, height }
}

function maskFromGrid(grid, x, y) {
  return (grid[y][x] ? 1 : 0)
    | (grid[y][x + 1] ? 2 : 0)
    | (grid[y + 1][x + 1] ? 4 : 0)
    | (grid[y + 1][x] ? 8 : 0)
}

function drawTopQuadrant(ctx, x, y, size, corner, solid) {
  const center = [x + size / 2, y + size / 2]
  const points = {
    nw: [[x, y], [x + size / 2, y], center, [x, y + size / 2]],
    ne: [[x + size / 2, y], [x + size, y], [x + size, y + size / 2], center],
    se: [center, [x + size, y + size / 2], [x + size, y + size], [x + size / 2, y + size]],
    sw: [[x, y + size / 2], center, [x + size / 2, y + size], [x, y + size]],
  }
  ctx.fillStyle = solid ? '#5fae5a' : '#263f4b'
  ctx.beginPath()
  ctx.moveTo(points[corner][0][0], points[corner][0][1])
  for (const point of points[corner].slice(1)) ctx.lineTo(point[0], point[1])
  ctx.closePath()
  ctx.fill()
}

function drawPreviewTile(ctx, mask, x, y) {
  const topSize = 42
  const topX = x + 7
  const topY = y + 6
  ctx.fillStyle = '#101820'
  ctx.fillRect(x + 5, y + 42, 46, 8)
  if (mask) {
    ctx.fillStyle = '#6e4b32'
    ctx.fillRect(topX, topY + 30, topSize, 16)
    ctx.fillStyle = '#563927'
    ctx.fillRect(topX, topY + 44, topSize, 4)
  }
  ctx.fillStyle = '#17202a'
  ctx.fillRect(topX, topY, topSize, topSize)
  drawTopQuadrant(ctx, topX, topY, topSize, 'nw', Boolean(mask & 1))
  drawTopQuadrant(ctx, topX, topY, topSize, 'ne', Boolean(mask & 2))
  drawTopQuadrant(ctx, topX, topY, topSize, 'se', Boolean(mask & 4))
  drawTopQuadrant(ctx, topX, topY, topSize, 'sw', Boolean(mask & 8))
  ctx.strokeStyle = '#1b2420'
  ctx.lineWidth = 1
  ctx.strokeRect(topX + 0.5, topY + 0.5, topSize - 1, topSize - 1)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
}

function drawCornerControls(ctx, grid, width, height) {
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      ctx.fillStyle = grid[y][x] ? '#14b8a6' : '#334155'
      ctx.fillRect(PAD + x * CELL - 3, PAD + y * CELL - 3, 6, 6)
    }
  }
}

function renderTilesetPreview() {
  const canvas = $('#tileset-editor-canvas')
  const { grid, width, height } = buildPreviewCornerGrid()
  canvas.width = PAD * 2 + width * CELL
  canvas.height = PAD * 2 + height * CELL + 28
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#050608'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      drawPreviewTile(ctx, maskFromGrid(grid, x, y), PAD + x * CELL, PAD + y * CELL)
    }
  }
  drawCornerControls(ctx, grid, width, height)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '12px system-ui'
  ctx.fillText(`${width} x ${height} · ${state.twoPointFiveD.operations.length} edits · ${activeTool}`, PAD, canvas.height - 10)
  renderOperationList()
}

function canvasPoint(event) {
  const canvas = $('#tileset-editor-canvas')
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width) - PAD,
    y: (event.clientY - rect.top) * (canvas.height / rect.height) - PAD,
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function cellFromEvent(event) {
  const point = canvasPoint(event)
  const options = readTilesetOptions()
  const { width, height } = safePreviewDimensions(options)
  return {
    x: clamp(Math.floor(point.x / CELL), 0, width - 1),
    y: clamp(Math.floor(point.y / CELL), 0, height - 1),
  }
}

function cornerFromEvent(event) {
  const point = canvasPoint(event)
  const options = readTilesetOptions()
  const { width, height } = safePreviewDimensions(options)
  return {
    x: clamp(Math.round(point.x / CELL), 0, width),
    y: clamp(Math.round(point.y / CELL), 0, height),
  }
}

function pushOperation(operation) {
  state.twoPointFiveD.operations.push(operation)
  renderTilesetPreview()
}

function handleCanvasPointerDown(event) {
  if (activeTool === 'corner-solid' || activeTool === 'corner-empty') {
    const corner = cornerFromEvent(event)
    pushOperation({
      type: 'set_corner',
      x: corner.x,
      y: corner.y,
      solid: activeTool === 'corner-solid',
    })
    return
  }
  dragStart = cellFromEvent(event)
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function handleCanvasPointerUp(event) {
  if (!dragStart) return
  const end = cellFromEvent(event)
  const x = Math.min(dragStart.x, end.x)
  const y = Math.min(dragStart.y, end.y)
  const w = Math.abs(dragStart.x - end.x) + 1
  const h = Math.abs(dragStart.y - end.y) + 1
  pushOperation({
    type: activeTool === 'erase' ? 'erase_terrain_rect' : 'paint_terrain_rect',
    x,
    y,
    w,
    h,
  })
  dragStart = null
}

function renderOperationList() {
  const list = $('#tileset-operation-list')
  if (!state.twoPointFiveD.operations.length) {
    list.innerHTML = '<li>No queued edits</li>'
    return
  }
  list.innerHTML = state.twoPointFiveD.operations
    .slice(-6)
    .map((operation, index) => {
      const label = operation.type === 'set_corner'
        ? `${operation.type} ${operation.x},${operation.y} ${operation.solid ? 'solid' : 'empty'}`
        : `${operation.type} ${operation.x},${operation.y} ${operation.w}x${operation.h}`
      return `<li><span>${state.twoPointFiveD.operations.length - Math.min(6, state.twoPointFiveD.operations.length) + index + 1}</span>${escapeHtml(label)}</li>`
    })
    .join('')
}

function renderExportLinks(job) {
  const rows = [
    ['Strict atlas', 'strict_atlas.png', job?.strict_atlas_png_url],
    ['Runtime atlas', 'runtime_padded_atlas.png', job?.runtime_padded_atlas_png_url],
    ['Map preview', 'map_editor_preview.png', job?.map_editor_preview_png_url],
    ['Tiled JSON', 'tileset.tiled.json', job?.tiled_json_url],
    ['Tiled TSX', 'tileset.tsx', job?.tiled_tsx_url],
    ['LDtk Project', 'project.ldtk', job?.ldtk_project_url],
    ['LDtk readiness', 'ldtk_workflow_validation.json', job?.ldtk_workflow_validation_url],
    ['Release evidence', 'workflow_release_evidence.json', job?.workflow_release_evidence_url],
    ['Evidence notes', 'workflow_release_evidence.md', job?.workflow_release_evidence_md_url],
    ['Package audit', 'consumer_package_audit.json', job?.consumer_package_audit_url],
    ['Import validation', 'import_validation.json', job?.import_validation_url],
    ['Demo manifest', 'release_demo_manifest.json', job?.release_demo_manifest_url],
    ['Demo README', 'release_demo_README.md', job?.release_demo_readme_url],
    ['Demo pack', 'release_demo_pack.zip', job?.release_demo_pack_zip_url],
    ['Tool probe', 'external_tool_probe.json', job?.external_tool_probe_url],
    ['Import smoke', 'external_import_smoke.json', job?.external_import_smoke_url],
    ['Round-trip evidence', 'external_roundtrip_validation.json', job?.external_roundtrip_validation_url],
    ['Round-trip checklist', 'external_roundtrip_checklist.md', job?.external_roundtrip_checklist_md_url],
  ]
  const available = rows.filter(([, , href]) => href)
  $('#tileset-export-count').textContent = String(available.length)
  $('#tileset-export-links').innerHTML = rows.map(([name, format, href]) => `
    <div class="tileset-export-row ${href ? '' : 'is-empty'}">
      <span><b>${escapeHtml(name)}</b><small>${escapeHtml(format)}</small></span>
      ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download>Download</a>` : '<em>After build</em>'}
    </div>
  `).join('')
}

function renderResultMetrics(job) {
  $('#tileset-result-status').textContent = String(job?.status ?? 'idle').toUpperCase()
  $('#tileset-result-metrics').innerHTML = `
    <span><small>Validation</small><b>${escapeHtml(job?.validation_status ?? '—')}</b></span>
    <span><small>LDtk</small><b>${escapeHtml(job?.ldtk_workflow_validation_status ?? job?.ldtk_project_status ?? '—')}</b></span>
    <span><small>Import</small><b>${escapeHtml(job?.import_validation_status ?? '—')}</b></span>
    <span><small>Round-trip</small><b>${escapeHtml(job?.external_roundtrip_validation_status ?? '—')}</b></span>
    <span><small>Editor ops</small><b>${escapeHtml(job?.map_editor_operation_count ?? state.twoPointFiveD.operations.length)}</b></span>
  `
}

async function renderEvidence(job) {
  $('#tileset-evidence-status').textContent = job?.workflow_release_evidence_status ?? '—'
  if (!job?.workflow_release_evidence_url) {
    $('#tileset-evidence-summary').innerHTML = '<p>Build a tileset to produce workflow evidence.</p>'
    return
  }
  try {
    const evidence = await fetchJsonArtifact(job.workflow_release_evidence_url)
    $('#tileset-evidence-status').textContent = evidence.status
    $('#tileset-evidence-summary').innerHTML = `
      <p>Release ready: <strong>${evidence.release_ready ? 'yes' : 'no'}</strong></p>
      <p>Required checks: ${escapeHtml(evidence.summary?.required_count ?? '—')} · warnings: ${escapeHtml(evidence.summary?.warning_count ?? '—')}</p>
      <p>${escapeHtml(evidence.claim_boundary)}</p>
    `
  } catch (error) {
    $('#tileset-evidence-summary').innerHTML = `<p>${escapeHtml(error.message || String(error))}</p>`
  }
}

async function renderTilesetJob(job) {
  state.twoPointFiveD.job = job
  renderResultMetrics(job)
  renderExportLinks(job)
  await renderEvidence(job)
  const preview = $('#tileset-map-preview')
  if (job?.map_editor_preview_png_url) {
    preview.hidden = false
    preview.src = job.map_editor_preview_png_url
    $('#tileset-preview-caption').textContent = 'Validated map editor preview from local pipeline.'
  } else {
    preview.hidden = true
    preview.removeAttribute('src')
    $('#tileset-preview-caption').textContent = 'Build to view validated map preview.'
  }
}

async function handlePlanBenchmark() {
  const button = $('#tileset-plan-benchmark')
  const options = readBenchmarkOptions()
  if (!options.description) {
    setBenchmarkStatus('Material brief is required')
    showToast('Material brief is required')
    return
  }
  if (button) button.disabled = true
  setBenchmarkStatus('Writing dry-run benchmark plan...')
  try {
    const plan = await planTwoPointFiveDMaterialSourceBenchmark(options)
    renderBenchmarkPlan(plan)
    setBenchmarkStatus(`Dry-run plan ready: ${plan.estimated_provider_calls} planned calls`)
    showToast('2.5D benchmark plan ready')
  } catch (error) {
    setBenchmarkStatus(error.message || String(error))
    showToast(error.message || String(error))
  } finally {
    if (button) button.disabled = false
    syncBenchmarkRunButton()
  }
}

async function handleRunBenchmark() {
  const button = $('#tileset-run-benchmark')
  const options = readBenchmarkOptions()
  if (!options.description) {
    setBenchmarkStatus('Material brief is required')
    showToast('Material brief is required')
    return
  }
  if (!$('#tileset-benchmark-confirm-live')?.checked) {
    setBenchmarkStatus('Confirm live quota before running')
    showToast('Confirm live quota before running')
    return
  }
  if (!tilesetBenchmarkProviderReady) {
    setBenchmarkStatus('Provider is not configured')
    showToast('Provider is not configured')
    return
  }
  if (options.maxProviderCalls < options.candidateCount) {
    setBenchmarkStatus('Max calls must cover candidate count')
    showToast('Max calls must cover candidate count')
    return
  }
  if (button) button.disabled = true
  setBenchmarkStatus('Submitting live benchmark...')
  try {
    let job = await runTwoPointFiveDMaterialSourceBenchmark(options)
    job = await waitForTwoPointFiveDJob(job, (current) => {
      setBenchmarkStatus(current.status)
      renderBenchmarkJob(current).catch(() => {})
    })
    await renderBenchmarkJob(job)
    if (job.status !== 'done') {
      setBenchmarkStatus(job.reason ?? 'Benchmark failed')
      showToast(job.reason ?? '2.5D benchmark failed')
      return
    }
    setBenchmarkStatus('Benchmark report ready')
    showToast('2.5D material-source benchmark ready')
  } catch (error) {
    setBenchmarkStatus(error.message || String(error))
    showToast(error.message || String(error))
  } finally {
    if (button) button.disabled = false
    syncBenchmarkRunButton()
  }
}

async function handleBuildTileset() {
  const button = $('#tileset-build')
  button.disabled = true
  setTilesetStatus('queued', 'generating')
  try {
    let job = await buildTwoPointFiveDTileset({
      materialSourceFile: $('#tileset-material-source').files?.[0] ?? null,
      options: readTilesetOptions(),
    })
    job = await waitForTwoPointFiveDJob(job, (current) => {
      setTilesetStatus(current.status, current.status === 'done' ? 'done' : 'generating')
      renderResultMetrics(current)
    })
    await renderTilesetJob(job)
    if (job.status !== 'done') {
      setTilesetStatus('failed', 'fail')
      showToast(job.reason ?? '2.5D tileset build failed')
      return
    }
    setTilesetStatus('done', 'done')
    showToast('2.5D tileset workflow evidence ready')
  } catch (error) {
    setTilesetStatus('failed', 'fail')
    showToast(error.message || String(error))
  } finally {
    button.disabled = false
  }
}

function syncMaterialMode() {
  const file = $('#tileset-material-source').files?.[0]
  $('#tileset-material-mode').textContent = file ? 'manual source' : 'procedural'
}

function syncDensityValue() {
  const value = Number($('#tileset-density').value)
  $('#tileset-density-value').textContent = Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, '') : '0'
}

function syncBenchmarkCallBudget() {
  const count = Number($('#tileset-benchmark-candidate-count')?.value ?? 1)
  const maxInput = $('#tileset-benchmark-max-calls')
  const current = Number(maxInput?.value)
  if (maxInput && Number.isFinite(count) && (!Number.isFinite(current) || current < count)) {
    maxInput.value = String(count)
  }
  syncBenchmarkRunButton()
}

function setActiveTool(tool) {
  activeTool = tool
  for (const button of document.querySelectorAll('[data-tileset-tool]')) {
    button.classList.toggle('active', button.dataset.tilesetTool === tool)
  }
  renderTilesetPreview()
}

function resetEditorPreview() {
  state.twoPointFiveD.operations = []
  renderTilesetPreview()
  renderTilesetJob(state.twoPointFiveD.job).catch(() => {})
}

export function initTwoPointFiveDTilesetTab() {
  if (!$('#two-point-five-d')) return
  initTilesetProviderConfigControls()
  for (const selector of [
    '#tileset-map-width',
    '#tileset-map-height',
    '#tileset-map-solver',
    '#tileset-map-border',
    '#tileset-seed',
    '#tileset-density',
  ]) {
    $(selector).addEventListener('input', () => {
      syncDensityValue()
      renderTilesetPreview()
    })
    $(selector).addEventListener('change', () => {
      syncDensityValue()
      renderTilesetPreview()
    })
  }
  $('#tileset-material-source').addEventListener('change', syncMaterialMode)
  for (const button of document.querySelectorAll('[data-tileset-tool]')) {
    button.addEventListener('click', () => setActiveTool(button.dataset.tilesetTool))
  }
  $('#tileset-editor-canvas').addEventListener('pointerdown', handleCanvasPointerDown)
  $('#tileset-editor-canvas').addEventListener('pointerup', handleCanvasPointerUp)
  $('#tileset-editor-canvas').addEventListener('pointerleave', () => { dragStart = null })
  $('#tileset-clear-edits').addEventListener('click', resetEditorPreview)
  $('#tileset-reset-preview').addEventListener('click', renderTilesetPreview)
  $('#tileset-refresh-preview').addEventListener('click', renderTilesetPreview)
  $('#tileset-build').addEventListener('click', handleBuildTileset)
  $('#tileset-plan-benchmark').addEventListener('click', handlePlanBenchmark)
  $('#tileset-run-benchmark').addEventListener('click', handleRunBenchmark)
  $('#tileset-benchmark-candidate-count').addEventListener('change', syncBenchmarkCallBudget)
  $('#tileset-benchmark-max-calls').addEventListener('input', syncBenchmarkRunButton)
  $('#tileset-benchmark-confirm-live').addEventListener('change', syncBenchmarkRunButton)
  syncMaterialMode()
  syncDensityValue()
  syncBenchmarkCallBudget()
  renderExportLinks(null)
  renderResultMetrics(null)
  renderEvidence(null)
  renderBenchmarkIdle()
  renderTilesetPreview()
}
