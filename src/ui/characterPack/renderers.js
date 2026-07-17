import { state } from '../appState.js'
import { $ } from '../dom.js'
import { t } from '../i18n.js'
import { clearActionRepairPlan, syncActionRepairControls } from './repairControls.js'

const MAX_GALLERY_ROW_GIFS = 8

const GALLERY_DISPLAY_LABELS = Object.freeze({
  idledown: '待机下',
  'idle down': '待机下',
  idle_down: '待机下',
  idleup: '待机上',
  'idle up': '待机上',
  idle_up: '待机上',
  idleL: '待机左',
  'idle left': '待机左',
  idle_left: '待机左',
  idle_right: '待机右',
  walkdown: '行走下',
  'walk down': '行走下',
  walk_down: '行走下',
  walkup: '行走上',
  'walk up': '行走上',
  walk_up: '行走上',
  walkL: '行走左',
  'walk left': '行走左',
  walk_left: '行走左',
  walk_right: '行走右',
  rundown: '奔跑下',
  'run down': '奔跑下',
  runup: '奔跑上',
  'run up': '奔跑上',
  runL: '奔跑左',
  'run left': '奔跑左',
  climb: '爬行',
  attractL: '攻击左',
  'attract left': '攻击左',
  defence: '防御',
  die: '倒地',
  item: '开心',
  happy: '开心',
  jump: '跳跃',
  sitdown: '坐下',
  'sit down': '坐下',
  sit: '坐下',
  talk: '说话',
  hurt: '受击',
})

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function previewKeyFromName(name) {
  return String(name ?? '').split('/').pop().replace(/\.gif$/i, '')
}

function galleryDisplayLabel(preview = {}) {
  const candidates = [
    preview.animation,
    previewKeyFromName(preview.name),
    previewKeyFromName(preview.file),
    preview.label,
  ].filter(Boolean)
  for (const value of candidates) {
    const label = GALLERY_DISPLAY_LABELS[String(value)]
    if (label) return label
  }
  return preview.label || previewKeyFromName(preview.name) || 'GIF'
}

function renderStatusBadge(status, fallback = 'unknown') {
  const label = escapeHtml(status || fallback)
  return `<span class="benchmark-status" data-status="${label}">${label}</span>`
}

function renderTaxonomyBadges(taxonomy) {
  const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories.slice(0, 3) : []
  if (!categories.length) return ''
  return `<div class="benchmark-taxonomy">${categories
    .map((category) => {
      const severity = escapeHtml(category.severity || 'info')
      const label = `${category.id}${category.count > 1 ? ` x${category.count}` : ''}`
      const examples = Array.isArray(category.examples) && category.examples.length ? ` title="${escapeHtml(category.examples.join(', '))}"` : ''
      return `<span class="benchmark-taxonomy-badge benchmark-taxonomy-badge--${severity}"${examples}>${escapeHtml(label)}</span>`
    })
    .join('')}</div>`
}

function renderSummary(summary = {}) {
  const validation = summary.validation ?? {}
  const items = [
    ['total', summary.total],
    ['pass', validation.pass],
    ['warning', validation.warning],
    ['fail', validation.fail],
  ]
  return `<div class="benchmark-summary">${items
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${formatCount(value)}</span>`)
    .join('')}</div>`
}

function renderAssetThumb(label, url) {
  if (!url) return ''
  const safeLabel = escapeHtml(label)
  const safeUrl = escapeHtml(url)
  return `
    <figure class="benchmark-thumb">
      <img src="${safeUrl}" alt="${safeLabel}" loading="lazy" />
      <figcaption>${safeLabel}</figcaption>
    </figure>
  `
}

function renderGalleryLinks(item) {
  const links = [
    ['prompt.txt', item.prompt_url],
    ['debug_report.json', item.debug_report_url],
  ].filter(([, url]) => Boolean(url))
  if (!links.length) return ''
  return `<div class="benchmark-links">${links
    .map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join('')}</div>`
}

function renderRowGifPreviews(previews = []) {
  if (!Array.isArray(previews) || !previews.length) return ''
  const visiblePreviews = previews.filter((preview) => preview?.url).slice(0, MAX_GALLERY_ROW_GIFS)
  const hiddenCount = Math.max(0, previews.length - visiblePreviews.length)
  return `
    <div class="benchmark-row-gifs">
      ${visiblePreviews
        .map(
          (preview) => `
            <figure class="gif-preview-card">
              <img src="${escapeHtml(preview.url)}" alt="${escapeHtml(preview.label ?? preview.name ?? 'Row GIF')} preview" loading="lazy" />
              <figcaption>${escapeHtml(preview.label ?? preview.name ?? 'Row GIF')}</figcaption>
              <a href="${escapeHtml(preview.url)}" download>下载 GIF</a>
            </figure>
          `
        )
        .join('')}
      ${hiddenCount ? `<p class="benchmark-more">+${hiddenCount} GIFs</p>` : ''}
    </div>
  `
}

function renderBenchmarkItem(item) {
  const title = item.case_id ? `${item.case_id} v${item.variant ?? '?'}` : item.id || 'benchmark item'
  const thumbs = [renderAssetThumb('source', item.source_url), renderAssetThumb('normalized', item.normalized_sheet_url)].filter(Boolean).join('')
  return `
    <article class="benchmark-item-card">
      <div class="benchmark-item-head">
        <h5>${escapeHtml(title)}</h5>
        <div>
          ${renderStatusBadge(item.status)}
          ${renderStatusBadge(item.validation_status, 'validation')}
        </div>
      </div>
      ${thumbs ? `<div class="benchmark-thumbs">${thumbs}</div>` : ''}
      ${renderTaxonomyBadges(item.failure_taxonomy)}
      ${renderGalleryLinks(item)}
      ${renderRowGifPreviews(item.row_gif_previews)}
    </article>
  `
}

export function renderBenchmarkGallery(gallery) {
  const container = $('#character-pack-benchmark-gallery')
  const status = $('#character-pack-benchmark-status')
  if (!container || !status) return
  if (gallery?.loading) {
    status.textContent = '刷新中'
    container.innerHTML = '<p class="benchmark-empty">加载中...</p>'
    return
  }
  if (gallery?.error) {
    status.textContent = '不可用'
    container.innerHTML = `<p class="benchmark-empty">${escapeHtml(gallery.error)}</p>`
    return
  }
  const runs = Array.isArray(gallery?.runs) ? gallery.runs : []
  status.textContent = runs.length ? `${runs.length} runs` : '暂无记录'
  if (!runs.length) {
    container.innerHTML = '<p class="benchmark-empty">暂无 benchmark 记录。</p>'
    return
  }
  container.innerHTML = runs
    .map(
      (run) => `
        <article class="benchmark-run-card">
          <div class="benchmark-run-head">
            <div>
              <h4>${escapeHtml(run.run_id ?? 'benchmark run')}</h4>
              <p>${escapeHtml(run.created_at ?? '')}${run.preset ? ` · ${escapeHtml(run.preset)}` : ''}${
                run.truncated_items ? ` · ${formatCount(run.visible_item_count)}/${formatCount(run.item_count)} items` : ''
              }</p>
            </div>
            ${renderSummary(run.summary)}
          </div>
          <div class="benchmark-item-grid">
            ${(Array.isArray(run.items) ? run.items : []).map(renderBenchmarkItem).join('')}
          </div>
        </article>
      `
    )
    .join('')
}

const QR_ICONS = {
  download:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  triangleAlert:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  circleCheck:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  circleX:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  wandSparkles:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>',
  shieldCheck:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
}

const QR_BADGES = {
  pass: { cls: 'is-pass', icon: QR_ICONS.circleCheck, label: 'PASS' },
  warning: { cls: 'is-warning', icon: QR_ICONS.triangleAlert, label: 'WARNING' },
  fail: { cls: 'is-fail', icon: QR_ICONS.circleX, label: 'FAIL' },
}

const QR_DEFAULT_TAXONOMY = ['motion.duplicate_frames', 'structure.cropped', 'structure.empty_frame']

export function renderQualityReport(report) {
  const validation = report.validation ?? {}
  const status = ['pass', 'warning', 'fail'].includes(validation.status) ? validation.status : 'fail'
  const badge = QR_BADGES[status]
  const warnings = validation.warnings ?? []
  const errors = validation.blocking_errors ?? []
  const frameCount = formatCount(validation.frame_count ?? report.frames?.length ?? 0)
  const errorFrames = new Set(
    errors.map((message) => String(message).match(/^frame_(\d+)_/)?.[1]).filter(Boolean)
  ).size
  const usableRate = frameCount ? Math.round(((frameCount - errorFrames) / frameCount) * 100) : 0
  const normalization = report.normalization ?? {}
  const repaired =
    formatCount(normalization.auto_correction?.applied_count) +
    formatCount(normalization.motion_stabilization?.applied_count) +
    formatCount(normalization.manual_adjustments?.applied_count)
  const taxonomy = new Map(QR_DEFAULT_TAXONOMY.map((id) => [id, { count: 0, severity: 'info' }]))
  for (const category of validation.failure_taxonomy?.categories ?? []) {
    taxonomy.set(category.id, { count: formatCount(category.count), severity: category.severity ?? 'warning' })
  }
  const taxonomyRows = [...taxonomy.entries()]
    .map(([id, info]) => {
      const countClass = info.count === 0 ? 'is-zero' : info.severity === 'error' ? 'is-error' : 'is-warn'
      return `
        <div class="qr-tax-row">
          <span class="qr-tax-cat">${escapeHtml(id)}</span>
          <span class="qr-count ${countClass}">${info.count}</span>
        </div>
      `
    })
    .join('')
  const gate =
    status === 'pass'
      ? { icon: QR_ICONS.shieldCheck, cls: 'qr-icon-green', text: 'Importable — passed quality gate' }
      : status === 'warning'
        ? { icon: QR_ICONS.triangleAlert, cls: 'qr-icon-amber', text: 'Usable with warnings — review taxonomy' }
        : { icon: QR_ICONS.circleX, cls: 'qr-icon-red', text: 'Blocked — failed quality gate' }
  const usableClass = usableRate >= 90 ? 'is-good' : usableRate >= 60 ? '' : 'is-bad'
  const detailItems = [...errors, ...warnings]
  const container = $('#character-pack-quality')
  container.classList.add('is-visible')
  container.innerHTML = `
    <div class="qr-head">
      <span class="qr-title">QUALITY REPORT</span>
      <span class="qr-badge ${badge.cls}">${badge.icon}${badge.label}</span>
    </div>
    <div class="qr-divider"></div>
    <div class="qr-metrics">
      <div class="qr-metric">
        <span class="qr-metric-label">Usable rate</span>
        <span class="qr-metric-value ${usableClass}">${usableRate}%</span>
      </div>
      <div class="qr-metric">
        <span class="qr-metric-label">Frames</span>
        <span class="qr-metric-value">${frameCount - errorFrames} / ${frameCount}</span>
      </div>
      <div class="qr-metric">
        <span class="qr-metric-label">Repaired</span>
        <span class="qr-metric-value">${repaired}</span>
      </div>
    </div>
    <div class="qr-tax">
      <span class="qr-tax-title">FAILURE TAXONOMY</span>
      ${taxonomyRows}
    </div>
    <div class="qr-divider"></div>
    <div class="qr-line"><span class="qr-icon-teal">${QR_ICONS.wandSparkles}</span>${repaired} frames auto-repaired to pass</div>
    <div class="qr-line qr-gate"><span class="${gate.cls}">${gate.icon}</span>${escapeHtml(gate.text)}</div>
    ${
      detailItems.length
        ? `<details class="qr-details"><summary>Details (${detailItems.length})</summary><ul>${detailItems
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join('')}</ul></details>`
        : ''
    }
  `
}

function formatDiagnosticValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  }
  return String(value)
}

function renderDiagnosticRows(rows) {
  const rendered = rows
    .map(([label, value]) => [label, formatDiagnosticValue(value)])
    .filter(([, value]) => value !== null)
  if (!rendered.length) return ''
  return `<dl class="generation-diagnostics-list">${rendered
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')}</dl>`
}

function candidateForIndex(selection, index) {
  const source = selection ?? {}
  const candidates = Array.isArray(source.candidates) ? source.candidates : []
  return candidates.find((candidate) => candidate.index === index) ?? null
}

function selectedCandidate(selection) {
  const source = selection ?? {}
  const candidates = Array.isArray(source.candidates) ? source.candidates : []
  return candidateForIndex(source, source.selected_index) ?? candidates[0] ?? null
}

function releaseEvidence(job = {}) {
  const selection = job.candidate_selection ?? {}
  const releaseReadiness = [
    job.release_ready,
    job.release_gate?.release_ready,
    selection.release_ready,
  ].filter((value) => typeof value === 'boolean')
  const artifactDispositions = [
    job.artifact_disposition,
    selection.artifact_disposition,
  ].filter((value) => typeof value === 'string' && value)
  const releaseReady = releaseReadiness.includes(false)
    ? false
    : releaseReadiness.includes(true) ? true : null
  return {
    releaseReady,
    releaseStatus:
      job.release_gate?.status ??
      (releaseReady === true ? 'ready' : releaseReady === false ? 'blocked' : null),
    releaseSelectedIndex: job.release_selected_index ?? selection.release_selected_index,
    releaseSelectedScore: job.release_selected_score ?? selection.release_selected_score,
    artifactDisposition: artifactDispositions.includes('diagnostic_only')
      ? 'diagnostic_only'
      : artifactDispositions[0] ?? null,
  }
}

export function isCharacterPackReleaseBlocked(job = {}) {
  const evidence = releaseEvidence(job)
  const gate = job.release_gate
  const canonicalPolicy = gate?.generation_mode === 'production_sheet_v0'
    ? 'strict_live_generation_v1'
    : gate?.generation_mode === 'quality_character_v0'
      ? 'golden_review_hard_thresholds_v1'
      : null
  const malformedOrBlockedGate = gate != null && !(
    gate.schema_version === 1 &&
    gate.mode === 'generation_release_gate_v1' &&
    canonicalPolicy !== null &&
    gate.policy === canonicalPolicy &&
    gate.status === 'pass' &&
    gate.release_ready === true &&
    Array.isArray(gate.blocking_errors) &&
    gate.blocking_errors.length === 0 &&
    Array.isArray(gate.warnings) &&
    gate.evidence != null &&
    typeof gate.evidence === 'object' &&
    !Array.isArray(gate.evidence) &&
    job.release_ready === true &&
    job.artifact_disposition === 'release'
  )
  return (
    job.status === 'failed_quality_gate' ||
    malformedOrBlockedGate ||
    evidence.releaseStatus === 'fail' ||
    evidence.releaseReady === false ||
    evidence.artifactDisposition === 'diagnostic_only'
  )
}

function renderCandidateDetails(selection) {
  const source = selection ?? {}
  const candidates = Array.isArray(source.candidates) ? source.candidates.slice(0, 6) : []
  if (!candidates.length) return ''
  return `<details class="generation-candidate-details"><summary>Candidates (${candidates.length})</summary><ul>${candidates
    .map((candidate) => {
      const score = formatDiagnosticValue(candidate.score)
      const suffix = candidate.reason || candidate.status || (score ? `score ${score}` : 'candidate')
      const roles = [
        candidate.index === source.selected_index ? 'diagnostic' : null,
        candidate.index === source.release_selected_index ? 'release' : null,
      ].filter(Boolean)
      const roleLabel = roles.length ? ` [${roles.join(', ')}]` : ''
      return `<li>#${escapeHtml(candidate.index ?? '?')}${escapeHtml(roleLabel)} ${escapeHtml(suffix)}</li>`
    })
    .join('')}</ul></details>`
}

function renderGenerationDiagnostics(job = {}) {
  const budget = job.provider_call_budget
  const selection = job.candidate_selection
  const qualityMetrics = job.quality_spec?.metrics
  const selected = selectedCandidate(selection)
  const release = releaseEvidence(job)
  const releaseSelected = candidateForIndex(selection, release.releaseSelectedIndex)
  const hasDiagnostics =
    budget ||
    selection ||
    qualityMetrics ||
    job.failure_status ||
    job.retry_hint ||
    release.releaseStatus ||
    release.artifactDisposition
  if (!hasDiagnostics) return ''
  const statusLabel = job.failure_status || selection?.mode || job.status || 'generation'
  const rows = [
    ['Calls', budget ? `${budget.used_provider_calls ?? 0}/${budget.max_provider_calls ?? budget.planned_provider_calls ?? '?'}` : null],
    ['Planned', budget?.planned_provider_calls],
    ['Diagnostic candidate', selection ? `${selection.selected_index ?? '?'} / ${selection.candidate_count ?? '?'}` : null],
    ['Diagnostic score', selection?.selected_score ?? selected?.score],
    ['Diagnostic status', selected?.status],
    [
      'Release candidate',
      release.releaseSelectedIndex !== null && release.releaseSelectedIndex !== undefined
        ? `${release.releaseSelectedIndex} / ${selection?.candidate_count ?? '?'}`
        : null,
    ],
    ['Release score', release.releaseSelectedScore ?? releaseSelected?.score],
    ['Release status', release.releaseStatus],
    ['Release ready', release.releaseReady],
    ['Artifact disposition', release.artifactDisposition],
    ['Retry', job.retry_hint],
    ['Reason', job.reason],
    ['Visible px', qualityMetrics?.visible_pixel_count ?? selected?.metrics?.visible_pixel_count],
    ['BBox area', qualityMetrics?.bbox_area_ratio ?? selected?.metrics?.bbox_area_ratio],
    ['Center offset', qualityMetrics?.center_offset_ratio ?? selected?.metrics?.center_offset_ratio],
    ['Edge margin', qualityMetrics?.edge_margin_ratio ?? selected?.metrics?.edge_margin_ratio],
  ]
  return `
    <div class="gallery-card generation-diagnostics-card" data-generation-diagnostics="true">
      <div class="gcard-meta">
        <span class="gcard-name">Generation</span>
        <span class="gcard-frames">${escapeHtml(statusLabel)}</span>
      </div>
      ${renderDiagnosticRows(rows)}
      ${renderCandidateDetails(selection)}
    </div>
  `
}

function renderRepairResultCard(job = {}) {
  if (
    !job.repaired_animation_strip_url &&
    !job.repaired_source_sheet_url &&
    !job.inspection_sheet_url &&
    !job.repair_validation_report_url &&
    !job.repair_summary_url
  ) return ''
  const animation = Array.isArray(job.selected_source_actions) && job.selected_source_actions.length
    ? job.selected_source_actions.join(', ')
    : job.selected_animation ?? 'repaired_action'
  const selectedActions = Array.isArray(job.selected_source_actions) ? job.selected_source_actions : [job.selected_animation].filter(Boolean)
  const inspectionPreview = (job.inspection_gif_previews ?? []).find((preview) => selectedActions.includes(preview.animation))
  const previewUrl = job.repaired_animation_strip_url ?? inspectionPreview?.url ?? job.repaired_source_sheet_url ?? job.inspection_sheet_url
  const links = [
    ['Strip', job.repaired_animation_strip_url],
    ['Inspection', inspectionPreview?.url],
    ['Inspection Sheet', job.inspection_sheet_url],
    ['Source', job.repaired_source_sheet_url],
    ['Sheet', job.repaired_normalized_sheet_url],
    ['Report', job.repair_validation_report_url ?? job.repair_summary_url],
  ].filter(([, url]) => Boolean(url))
  return `
    <div class="gallery-card repair-result-card" data-animation="${escapeHtml(animation)}">
      ${
        previewUrl
          ? `<div class="gcard-preview"><img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(animation)} repaired result" loading="lazy" /></div>`
          : ''
      }
      <div class="gcard-meta">
        <span class="gcard-name">${escapeHtml(animation)}</span>
        <span class="gcard-frames">Repaired</span>
      </div>
      <div class="repair-result-links">
        ${links.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`).join('')}
      </div>
    </div>
  `
}

export function renderDownloadLinks(job, frameCounts = {}) {
  const releaseBlocked = isCharacterPackReleaseBlocked(job)
  let available = 0
  for (const row of document.querySelectorAll('#character-pack-export-rows .export-row[data-export-key]')) {
    const url = releaseBlocked ? null : job[row.dataset.exportKey]
    const link = row.querySelector('.export-dl')
    if (url) {
      link.href = url
      link.hidden = false
      row.classList.remove('is-empty')
      available += 1
    } else {
      link.removeAttribute('href')
      link.hidden = true
      row.classList.add('is-empty')
    }
  }
  const allButton = $('#character-pack-export-all')
  if (allButton) {
    const zipUrl = releaseBlocked ? null : job.zip_url
    allButton.disabled = !zipUrl
    allButton.dataset.zipUrl = zipUrl ?? ''
    const allButtonLabel = $('#character-pack-export-all-label')
    allButtonLabel.dataset.i18nVarCount = String(available)
    allButtonLabel.textContent = t('character.export.downloadAvailable', { count: available })
  }
  const gifLinks = releaseBlocked
    ? []
    : (job.inspection_gif_previews?.length
        ? job.inspection_gif_previews
        : (job.row_gif_previews ?? (job.row_gif_urls ?? []).map((url) => ({ name: url.split('/').pop(), url })))).map(
        (preview) => ({
          name: preview.name,
          url: preview.url,
          runtimeUrl: preview.runtime_url,
          stripUrl: preview.strip_url,
          animation: preview.animation,
          frameCount: preview.frame_count,
          label: galleryDisplayLabel(preview),
        })
      )
  const linksContainer = $('#character-pack-links')
  linksContainer.innerHTML = [
    renderGenerationDiagnostics(job),
    releaseBlocked ? '' : renderRepairResultCard(job),
    ...gifLinks.map(({ name, label, url, runtimeUrl, stripUrl, animation: previewAnimation, frameCount: previewFrameCount }) => {
      const animation = previewAnimation || name.replace(/\.gif$/i, '')
      const frameCount = previewFrameCount ?? frameCounts[animation]
      const framesLabel = frameCount ? `${frameCount} Frames` : 'GIF'
      const repairChecked = state.characterPack.repairActions?.includes(animation)
      return `
        <div class="gallery-card" data-animation="${escapeHtml(animation)}">
          <div class="gcard-preview"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)} preview" loading="lazy" /></div>
          <div class="gcard-meta">
            <span class="gcard-name">${escapeHtml(label)}</span>
            <span class="gcard-frames">${escapeHtml(framesLabel)}</span>
          </div>
          <label class="gcard-repair-pick" title="加入本次修复">
            <input type="checkbox" data-repair-action="${escapeHtml(animation)}" ${repairChecked ? 'checked' : ''} />
            <span>Repair</span>
          </label>
          <div class="gcard-download-row">
            <a class="gcard-download" href="${escapeHtml(url)}" download>Download</a>
            ${stripUrl ? `<a class="gcard-download secondary" href="${escapeHtml(stripUrl)}" download>Strip</a>` : ''}
            ${runtimeUrl ? `<a class="gcard-download secondary" href="${escapeHtml(runtimeUrl)}" download>Runtime</a>` : ''}
          </div>
        </div>
      `
    }),
  ]
    .filter(Boolean)
    .join('')
  linksContainer.querySelectorAll('.gallery-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.gcard-download') || event.target.closest('.gcard-repair-pick')) return
      const select = $('#character-pack-animation')
      const animation = card.dataset.animation
      if (select && [...select.options].some((option) => option.value === animation)) {
        select.value = animation
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      linksContainer.querySelectorAll('.gallery-card').forEach((item) => item.classList.toggle('is-selected', item === card))
    })
  })
  linksContainer.querySelectorAll('[data-repair-action]').forEach((input) => {
    input.addEventListener('change', () => {
      const selected = [...linksContainer.querySelectorAll('[data-repair-action]:checked')]
        .map((item) => item.dataset.repairAction)
        .filter(Boolean)
      state.characterPack.repairActions = [...new Set(selected)]
      clearActionRepairPlan()
      syncActionRepairControls()
    })
  })
}

export function initExportModal() {
  const scrim = $('#character-pack-export-scrim')
  const openButton = $('#character-pack-export-open')
  const closeButton = $('#character-pack-export-close')
  const allButton = $('#character-pack-export-all')
  if (!scrim || !openButton) return
  openButton.addEventListener('click', () => {
    scrim.hidden = false
  })
  closeButton?.addEventListener('click', () => {
    scrim.hidden = true
  })
  scrim.addEventListener('click', (event) => {
    if (event.target === scrim) scrim.hidden = true
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !scrim.hidden) scrim.hidden = true
  })
  allButton?.addEventListener('click', () => {
    const zipUrl = allButton.dataset.zipUrl
    if (!zipUrl) return
    const anchor = document.createElement('a')
    anchor.href = zipUrl
    anchor.download = ''
    anchor.click()
  })
}
