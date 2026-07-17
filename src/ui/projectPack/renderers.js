import { fetchJson } from '../dom.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function setText(selector, text, status) {
  const element = document.querySelector(selector)
  if (!element) return
  element.textContent = text
  if (status) element.dataset.status = status
}

export function renderProjectPackStatus(job) {
  const label = job?.reason ? `${job.status}: ${job.reason}` : job?.status ?? 'idle'
  setText('#project-pack-status', label, job?.status)
  setText('#project-pack-result-status', label, job?.status)
}

export async function renderProjectPackResult(job) {
  renderProjectPackStatus(job)
  const summary = document.querySelector('#project-pack-summary')
  const links = document.querySelector('#project-pack-links')
  if (!summary || !links) return
  const validation = job.project_validation_url ? await fetchJson(job.project_validation_url) : null
  const manifest = job.project_manifest_url ? await fetchJson(job.project_manifest_url) : null
  summary.innerHTML = validation
    ? `
      <span><strong>Status</strong>${escapeHtml(validation.status)}</span>
      <span><strong>Character</strong>${escapeHtml(validation.metrics?.character_status ?? 'unknown')}</span>
      <span><strong>Scene</strong>${escapeHtml(validation.metrics?.scene_status ?? 'unknown')}</span>
      <span><strong>Warnings</strong>${validation.warnings?.length ?? 0}</span>
      <span><strong>Project</strong>${escapeHtml(manifest?.project_id ?? 'unknown')}</span>
    `
    : '<span><strong>Status</strong>waiting</span>'
  const items = [
    ['project_manifest.json', job.project_manifest_url],
    ['project_validation.json', job.project_validation_url],
    ['project_pack.zip', job.project_pack_zip_url ?? job.zip_url],
  ].filter(([, href]) => href)
  links.innerHTML = items.map(([label, href]) => `<a href="${escapeHtml(href)}" download>${escapeHtml(label)}</a>`).join('')
}
