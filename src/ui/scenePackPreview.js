import { applyPixelStyleCorrection } from '../character-pack/stylePipeline.js'
import { buildScenePreviewBundle } from '../scene-pack/scenePreview.js'
import { conditionTileSheetEdges } from '../scene-pack/tileEdgeConditioning.js'
import { buildScenePackFromTileSheet } from '../scene-pack/tileSheetIngestion.js'
import { getTileCorners } from '../scene-pack/tileProfile.js'
import { state } from './appState.js'
import { $, fileToBase64, loadImage, showToast } from './dom.js'

const TILE_SIZE = 32
const LAND = '#7fa35a'
const LAND_DARK = '#557543'
const WATER = '#365e6c'
const WATER_DARK = '#263f4b'
const GRID = 'rgba(38, 48, 47, 0.38)'
const TERMINAL_JOB_STATUSES = new Set(['done', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'])

let uploadedTileset = {
  file: null,
  source: null,
  url: null,
}
let currentSceneJob = null

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function setSceneStatus(message, status = 'idle') {
  const statusEl = $('#scene-preview-status')
  statusEl.textContent = message
  statusEl.dataset.status = status
  const banner = $('#scene-generation-banner')
  if (banner) banner.textContent = status === 'fail' ? 'SCENE GENERATION NEEDS REVIEW' : message === 'ready' ? 'SCENE PREVIEW READY' : String(message).toUpperCase()
}

function readPreviewOptions() {
  const styleSnap = $('#scene-preview-style-snap').checked
  const edgeCondition = $('#scene-preview-edge-condition').checked
  return {
    projectId: 'scene_preview_project',
    identifier: 'scene_preview',
    width: Number($('#scene-preview-width').value),
    height: Number($('#scene-preview-height').value),
    pattern: $('#scene-preview-pattern').value,
    seed: Number($('#scene-preview-seed').value),
    density: Number($('#scene-preview-density').value),
    styleCorrection: styleSnap
      ? {
        mode: 'palette_snap',
        maxColors: Number($('#scene-preview-style-max-colors').value),
      }
      : undefined,
    edgeConditioning: edgeCondition
      ? {
        enabled: true,
        band: Number($('#scene-preview-edge-band').value),
        mode: $('#scene-preview-edge-condition-mode').value,
      }
      : undefined,
    tilesetRelPath: 'scene/tileset.png',
  }
}

function readServerSceneOptions() {
  const options = readPreviewOptions()
  return {
    projectId: options.projectId,
    identifier: options.identifier,
    width: options.width,
    height: options.height,
    pattern: options.pattern,
    seed: options.seed,
    density: options.density,
    styleSnap: Boolean(options.styleCorrection),
    styleMaxColors: options.styleCorrection?.maxColors,
    edgeCondition: Boolean(options.edgeConditioning),
    edgeBand: options.edgeConditioning?.band,
    edgeConditionMode: options.edgeConditioning?.mode,
    tilesetRelPath: 'tileset.png',
  }
}

function readSceneDescription() {
  const view = $('#scene-view')?.selectedOptions?.[0]?.textContent?.trim()
  return [
    view ? `Perspective: ${view}` : '',
    $('#scene-theme')?.value,
    $('#scene-composition')?.value,
    $('#scene-style')?.value,
    $('#scene-output')?.value,
  ].filter(Boolean).join('\n')
}

function drawTriangle(ctx, points, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (const point of points.slice(1)) ctx.lineTo(point[0], point[1])
  ctx.closePath()
  ctx.fill()
}

function drawTile(ctx, cell, scale) {
  const x = cell.x * TILE_SIZE * scale
  const y = cell.y * TILE_SIZE * scale
  const size = TILE_SIZE * scale
  const center = [x + size / 2, y + size / 2]
  const corners = getTileCorners(cell.mask)
  const points = {
    nw: [x, y],
    ne: [x + size, y],
    se: [x + size, y + size],
    sw: [x, y + size],
  }
  const quadrants = [
    ['nw', [points.nw, points.ne, center, points.sw]],
    ['ne', [points.ne, points.se, center, points.nw]],
    ['se', [points.se, points.sw, center, points.ne]],
    ['sw', [points.sw, points.nw, center, points.se]],
  ]

  ctx.fillStyle = WATER
  ctx.fillRect(x, y, size, size)
  for (const [corner, polygon] of quadrants) {
    drawTriangle(ctx, polygon, corners[corner] ? LAND : WATER)
  }
  ctx.fillStyle = LAND_DARK
  ctx.fillRect(x + size * 0.38, y + size * 0.38, size * 0.24, size * 0.24)
  ctx.strokeStyle = GRID
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
}

function imageElementToRgba(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    data: pixels.data,
  }
}

function drawRuntimeTile(ctx, tile, x, y, size) {
  const tileCanvas = document.createElement('canvas')
  tileCanvas.width = tile.width
  tileCanvas.height = tile.height
  const tileCtx = tileCanvas.getContext('2d')
  tileCtx.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tileCanvas, x, y, size, size)
  ctx.strokeStyle = GRID
  ctx.lineWidth = Math.max(1, size / TILE_SIZE)
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
}

function drawScenePreview(canvas, bundle) {
  const scale = Math.max(2, Math.floor(Math.min(4, 384 / (bundle.map.width * TILE_SIZE))))
  canvas.width = bundle.map.width * TILE_SIZE * scale
  canvas.height = bundle.map.height * TILE_SIZE * scale
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = WATER_DARK
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const cell of bundle.map.cells) {
    const tile = bundle.tiles?.[cell.mask]
    if (tile) drawRuntimeTile(ctx, tile, cell.x * TILE_SIZE * scale, cell.y * TILE_SIZE * scale, TILE_SIZE * scale)
    else drawTile(ctx, cell, scale)
  }
}

function countTaxonomy(qualityGate, match) {
  return (qualityGate?.failure_taxonomy ?? [])
    .filter((item) => item.category?.includes(match))
    .reduce((sum, item) => sum + Number(item.count ?? 0), 0)
}

function sceneTaxonomyRows(qualityGate) {
  const actualRows = (qualityGate?.failure_taxonomy ?? [])
    .filter((item) => Number(item.count ?? 0) > 0)
    .map((item) => ({ category: item.category, count: Number(item.count ?? 0) }))
  const fallbackRows = [
    { category: 'tile.visual_seam_mismatch', count: 0 },
    { category: 'tile.duplicate_runtime_tile', count: 0 },
    { category: 'tile.style_drift', count: 0 },
  ].filter((fallback) => !actualRows.some((row) => row.category === fallback.category))
  return [...actualRows, ...fallbackRows].slice(0, 3)
}

function hideSceneQualityReport() {
  const card = $('#scene-preview-export-summary')
  card.hidden = true
  card.innerHTML = ''
}

function showSceneQualityReport() {
  $('#scene-preview-export-summary').hidden = false
}

function renderSummary(bundle, report = {}) {
  const mode = report.mode ?? (bundle.tiles ? 'sheet' : 'synthetic')
  const corrections = [
    bundle.styleCorrection ? 'style' : null,
    bundle.edgeConditioning ? 'edge' : null,
  ].filter(Boolean).join('+') || 'none'
  const qualityGate = report.qualityGate ?? bundle.qualityGate
  const status = report.status ?? qualityGate?.status ?? bundle.status
  const seamFails = countTaxonomy(qualityGate, 'seam')
  const statusClass = status === 'pass' ? 'is-pass' : status === 'warning' ? 'is-warning' : 'is-fail'
  const taxonomyRows = sceneTaxonomyRows(qualityGate)
  const observedTileCount = qualityGate?.metrics?.metadata_seams?.observed?.tile_count
  const tileCount = observedTileCount ?? bundle.metrics?.tile_count ?? '—'
  const variantCount = bundle.metrics?.unique_mask_count ?? '—'
  const ldtkVersion = bundle.ldtkProjectJson?.jsonVersion ?? '—'
  showSceneQualityReport()
  $('#scene-preview-export-summary').innerHTML = `
    <div class="scene-quality-head">
      <span>QUALITY REPORT</span>
      <strong class="${statusClass}">${escapeHtml(status).toUpperCase()}</strong>
    </div>
    <div class="scene-quality-divider"></div>
    <div class="scene-quality-metrics">
      <span><small>Tile coverage</small><b class="${status === 'fail' ? '' : 'is-good'}">${escapeHtml(tileCount)}/${escapeHtml(tileCount)}</b></span>
      <span><small>Seam fails</small><b class="${seamFails ? 'is-bad' : 'is-good'}">${escapeHtml(seamFails)}</b></span>
      <span><small>Variants</small><b>${escapeHtml(variantCount)}</b></span>
    </div>
    <div class="scene-quality-taxonomy">
      <span>FAILURE TAXONOMY</span>
      ${taxonomyRows.map((row) => `<p><em>${escapeHtml(row.category)}</em><strong class="${row.count ? 'is-warn' : 'is-zero'}">${escapeHtml(row.count)}</strong></p>`).join('')}
    </div>
    <div class="scene-quality-divider"></div>
    <p class="scene-quality-note">Source: ${escapeHtml(mode)} · Fix: ${escapeHtml(corrections)} · LDtk ${escapeHtml(ldtkVersion)}</p>
    <p class="scene-quality-note ${status === 'pass' ? 'is-good' : ''}">Tileable ${status === 'pass' ? '— passed quality gate' : '— review required'}</p>
  `
}

function closeSceneExportModal() {
  const scrim = $('#scene-preview-export-scrim')
  if (scrim) scrim.hidden = true
}

function sceneExportRows(job) {
  return [
    ['LDtk', 'project.ldtk', job?.ldtk_project_url],
    ['PNG Tileset', 'tileset.png', job?.tileset_url],
    ['Tile JSON', 'index + edge masks', job?.tile_atlas_url],
    ['Scene JSON', 'scene map', job?.scene_url],
    ['Quality Gate', 'quality_gate.json', job?.quality_gate_url],
    ['Scene Pack', 'scene_pack.zip', job?.scene_pack_zip_url ?? job?.zip_url],
  ]
}

function sceneExportAvailable(job) {
  return sceneExportRows(job).filter(([, , href]) => href)
}

function resetSceneResultState() {
  currentSceneJob = null
  closeSceneExportModal()
  hideSceneQualityReport()
  renderSceneLinks(null)
}

function openSceneExportModal() {
  if (!currentSceneJob || sceneExportAvailable(currentSceneJob).length === 0) return
  renderSceneLinks(currentSceneJob)
  $('#scene-preview-export-scrim').hidden = false
}

async function fetchJsonArtifact(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function renderJobQualityReport(job, mode) {
  let bundle
  try {
    bundle = buildCurrentBundle()
  } catch {
    bundle = null
  }
  if (!bundle) {
    hideSceneQualityReport()
    return
  }
  const qualityGate = await fetchJsonArtifact(job?.quality_gate_url)
  const status = qualityGate?.status ?? (job?.status === 'done' ? 'pass' : 'fail')
  renderSummary(bundle, { mode, qualityGate, status })
}

function prepareSceneSource(source, options) {
  const corrected = options.styleCorrection ? applyPixelStyleCorrection(source, options.styleCorrection) : null
  const sourceBeforeEdgeConditioning = corrected?.image ?? source
  const conditioned = options.edgeConditioning ? conditionTileSheetEdges(sourceBeforeEdgeConditioning, options.edgeConditioning) : null
  return {
    source: conditioned?.source ?? sourceBeforeEdgeConditioning,
    styleCorrectionReport: corrected?.report,
    edgeConditioningReport: conditioned?.report,
  }
}

function buildCurrentBundle() {
  const options = readPreviewOptions()
  if (!uploadedTileset.source) return buildScenePreviewBundle(options)
  const prepared = prepareSceneSource(uploadedTileset.source, options)
  return buildScenePackFromTileSheet({
    source: prepared.source,
    projectId: options.projectId,
    identifier: options.identifier,
    width: options.width,
    height: options.height,
    pattern: options.pattern,
    seed: options.seed,
    density: options.density,
    tilesetRelPath: 'tileset.png',
    styleCorrectionReport: prepared.styleCorrectionReport,
    edgeConditioningReport: prepared.edgeConditioningReport,
  })
}

function renderScenePackPreview() {
  try {
    const bundle = buildCurrentBundle()
    drawScenePreview($('#scene-preview-canvas'), bundle)
    setSceneStatus(`${bundle.map.width} x ${bundle.map.height}`, 'done')
  } catch (error) {
    setSceneStatus('invalid', 'fail')
    hideSceneQualityReport()
  }
}

function renderSceneLinks(job) {
  const rows = sceneExportRows(job)
  const available = sceneExportAvailable(job)
  const fallbackDownload = available[available.length - 1]?.[2]
  const status = job?.status ?? 'waiting'
  const exportOpenButton = $('#scene-preview-export-open')
  const exportStatus = $('#scene-preview-export-status')
  const exportAll = $('#scene-preview-export-all')
  exportOpenButton.disabled = available.length === 0
  exportStatus.textContent = status
  $('#scene-preview-links').innerHTML = `
    ${rows.map(([name, format, href]) => `
      <div class="scene-export-row ${href ? '' : 'is-empty'}">
        <span><b>${escapeHtml(name)}</b><small>${escapeHtml(format)}</small></span>
        ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download aria-label="Download ${escapeHtml(name)}">Download</a>` : '<em>After process</em>'}
      </div>
    `).join('')}
    <div class="scene-export-row is-soon"><span><b>Tiled</b><small>.tmx + .tsx</small></span><em>Soon</em></div>
    <div class="scene-export-row is-soon"><span><b>Godot TileMap</b><small>.tres</small></span><em>Soon</em></div>
    <div class="scene-export-row is-soon"><span><b>Unity Tilemap</b><small>tilemap asset</small></span><em>Soon</em></div>
  `
  exportAll.className = `scene-export-all ${available.length ? '' : 'is-disabled'}`
  exportAll.textContent = `Download Available (${available.length})`
  if (available.length) {
    exportAll.href = job.scene_pack_zip_url ?? job.zip_url ?? fallbackDownload
    exportAll.target = '_blank'
    exportAll.rel = 'noreferrer'
    exportAll.download = ''
  } else {
    exportAll.removeAttribute('href')
    exportAll.removeAttribute('target')
    exportAll.removeAttribute('rel')
    exportAll.removeAttribute('download')
  }
}

async function waitForSceneJob(job) {
  let current = job
  for (let i = 0; current.id && !TERMINAL_JOB_STATUSES.has(current.status) && i < 160; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const response = await fetch(`/api/jobs/${current.id}`)
    if (!response.ok) throw new Error(`scene job poll failed: ${response.status}`)
    current = await response.json()
  }
  return current
}

async function handleTilesetUpload() {
  const file = $('#scene-preview-tileset-file').files?.[0] ?? null
  if (uploadedTileset.url) URL.revokeObjectURL(uploadedTileset.url)
  uploadedTileset = { file: null, source: null, url: null }
  $('#scene-preview-process').disabled = true
  resetSceneResultState()
  if (!file) {
    renderScenePackPreview()
    return
  }
  const loaded = await loadImage(file)
  uploadedTileset = {
    file,
    source: imageElementToRgba(loaded.image),
    url: loaded.url,
  }
  $('#scene-preview-process').disabled = false
  renderScenePackPreview()
}

async function processUploadedTileset() {
  if (!uploadedTileset.file) return
  const button = $('#scene-preview-process')
  button.disabled = true
  resetSceneResultState()
  setSceneStatus('processing', 'generating')
  try {
    const response = await fetch('/api/process-scene-tiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source_base64: await fileToBase64(uploadedTileset.file),
        source_name: uploadedTileset.file.name,
        options: readServerSceneOptions(),
      }),
    })
    if (!response.ok) throw new Error(`scene tile ingest failed: ${response.status}`)
    const job = await waitForSceneJob(await response.json())
    setSceneStatus(job.status, job.status === 'done' ? 'done' : 'fail')
    state.scenePack.job = job
    if (job.id && $('#project-pack-scene-job')) $('#project-pack-scene-job').value = job.id
    currentSceneJob = job
    renderSceneLinks(job)
    await renderJobQualityReport(job, 'sheet')
    if (job.status !== 'done') {
      showToast(job.reason ?? `scene tile ingest ${job.status}`)
      return
    }
    showToast('场景 Tile 已导出')
  } catch (error) {
    setSceneStatus('failed', 'fail')
    showToast(error.message || String(error))
  } finally {
    button.disabled = !uploadedTileset.file
  }
}

async function generateSceneTileset() {
  const button = $('#scene-preview-generate-live')
  const processButton = $('#scene-preview-process')
  button.disabled = true
  processButton.disabled = true
  resetSceneResultState()
  setSceneStatus('queued', 'generating')
  renderSceneLinks({ status: 'queued' })
  try {
    const response = await fetch('/api/generate-scene-tiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm_live_generation: true,
        description: readSceneDescription(),
        options: readServerSceneOptions(),
      }),
    })
    if (!response.ok) {
      let reason = `scene generation failed: ${response.status}`
      try {
        const error = await response.json()
        reason = error.reason || error.error || reason
      } catch {}
      throw new Error(reason)
    }
    const job = await waitForSceneJob(await response.json())
    setSceneStatus(job.status, job.status === 'done' ? 'done' : 'fail')
    state.scenePack.job = job
    if (job.id && $('#project-pack-scene-job')) $('#project-pack-scene-job').value = job.id
    currentSceneJob = job
    renderSceneLinks(job)
    await renderJobQualityReport(job, 'generated')
    if (job.status !== 'done') {
      showToast(job.reason ?? `scene tile generation ${job.status}`)
      return
    }
    showToast('场景 Tile 已生成')
  } catch (error) {
    setSceneStatus('failed', 'fail')
    renderSceneLinks({ status: 'failed' })
    showToast(error.message || String(error))
  } finally {
    button.disabled = false
    processButton.disabled = !uploadedTileset.file
  }
}

function syncScenePatternSegments() {
  const selected = $('#scene-preview-pattern').value
  for (const button of document.querySelectorAll('[data-scene-pattern]')) {
    button.classList.toggle('active', button.dataset.scenePattern === selected)
  }
}

function syncSceneDensityValue() {
  const value = Number($('#scene-preview-density').value)
  $('#scene-preview-density-value').textContent = Number.isFinite(value)
    ? value.toFixed(2).replace(/\.?0+$/, '')
    : '0'
}

function previewSettingsChanged() {
  resetSceneResultState()
  syncScenePatternSegments()
  syncSceneDensityValue()
  renderScenePackPreview()
}

export function initScenePackPreview() {
  for (const selector of [
    '#scene-preview-width',
    '#scene-preview-height',
    '#scene-preview-pattern',
    '#scene-preview-seed',
    '#scene-preview-density',
    '#scene-preview-style-snap',
    '#scene-preview-style-max-colors',
    '#scene-preview-edge-condition',
    '#scene-preview-edge-band',
    '#scene-preview-edge-condition-mode',
  ]) {
    $(selector).addEventListener('input', previewSettingsChanged)
    $(selector).addEventListener('change', previewSettingsChanged)
  }
  for (const button of document.querySelectorAll('[data-scene-pattern]')) {
    button.addEventListener('click', () => {
      $('#scene-preview-pattern').value = button.dataset.scenePattern
      previewSettingsChanged()
    })
  }
  $('#scene-preview-seed-randomize').addEventListener('click', () => {
    $('#scene-preview-seed').value = String(Math.floor(Math.random() * 100000))
    previewSettingsChanged()
  })
  $('#scene-preview-tileset-file').addEventListener('change', () => {
    handleTilesetUpload().catch((error) => {
      $('#scene-preview-status').textContent = 'invalid'
      $('#scene-preview-status').dataset.status = 'fail'
      $('#scene-preview-process').disabled = true
      hideSceneQualityReport()
      showToast(error.message || String(error))
    })
  })
  $('#scene-preview-render').addEventListener('click', renderScenePackPreview)
  $('#scene-preview-export-open').addEventListener('click', openSceneExportModal)
  $('#scene-preview-export-close').addEventListener('click', closeSceneExportModal)
  $('#scene-preview-export-scrim').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeSceneExportModal()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSceneExportModal()
  })
  $('#scene-preview-process').addEventListener('click', () => processUploadedTileset())
  $('#scene-preview-generate-live')?.addEventListener('click', () => generateSceneTileset())
  syncScenePatternSegments()
  syncSceneDensityValue()
  renderSceneLinks(null)
  hideSceneQualityReport()
  renderScenePackPreview()
}
