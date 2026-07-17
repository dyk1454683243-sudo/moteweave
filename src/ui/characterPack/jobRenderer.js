import { state } from '../appState.js'
import { fetchJson, setPreviewImage } from '../dom.js'
import { drawCharacterPackPlaceholder, startPlayablePreview } from './playablePreviewWidget.js'
import { formatJobStatus, setCharacterPackStatus } from './controls.js'
import { renderDownloadLinks, renderQualityReport } from './renderers.js'
import { refreshBenchmarkGallery } from './benchmarkGalleryView.js'
import { syncActionRepairControls } from './repairControls.js'

export async function renderCharacterPackJob(job) {
  state.characterPack.job = job
  if (job?.id && document.querySelector('#project-pack-character-job')) {
    document.querySelector('#project-pack-character-job').value = job.id
  }
  const statusLabel = formatJobStatus(job)
  setCharacterPackStatus(statusLabel, job.status)
  if (job.source_layout_overlay_url) setPreviewImage('#character-pack-source-preview', job.source_layout_overlay_url)
  setPreviewImage('#character-pack-normalized-preview', job.normalized_sheet_url ?? job.t2i_result_url ?? job.source_url)
  setPreviewImage('#character-pack-debug-preview', job.debug_overlay_url)
  if (job.debug_report_url) {
    const report = await fetchJson(job.debug_report_url)
    state.characterPack.debugReport = report
    renderQualityReport(report)
  }
  let frameCounts = {}
  if (job.animations_url) {
    try {
      const animations = await fetchJson(job.animations_url)
      frameCounts = Object.fromEntries(
        Object.entries(animations.animations ?? {}).map(([name, animation]) => [name, animation.frames?.length ?? 0])
      )
    } catch {
      frameCounts = {}
    }
  }
  renderDownloadLinks(job, frameCounts)
  syncActionRepairControls(job)
  if (job.status === 'done' && job.normalized_sheet_url && job.animations_url) {
    await startPlayablePreview(job)
    syncActionRepairControls(job)
  } else {
    drawCharacterPackPlaceholder(statusLabel)
  }
  refreshBenchmarkGallery()
}
