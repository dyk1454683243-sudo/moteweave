import { state } from './appState.js'
import { $, showToast } from './dom.js'
import { buildProjectPack, waitForProjectPackJob } from './projectPack/api.js'
import { renderProjectPackResult, renderProjectPackStatus } from './projectPack/renderers.js'

function syncCurrentJobs() {
  const characterJob = state.characterPack.job
  const sceneJob = state.scenePack.job
  if (characterJob?.id) $('#project-pack-character-job').value = characterJob.id
  if (sceneJob?.id) $('#project-pack-scene-job').value = sceneJob.id
  showToast('已同步当前角色/场景结果')
}

async function handleBuildProjectPack() {
  const button = $('#project-pack-build')
  button.disabled = true
  try {
    let job = await buildProjectPack({
      projectId: $('#project-pack-id').value,
      characterJobId: $('#project-pack-character-job').value,
      sceneJobId: $('#project-pack-scene-job').value,
    })
    job = await waitForProjectPackJob(job, renderProjectPackStatus)
    state.projectPack.job = job
    await renderProjectPackResult(job)
    showToast(job.status === 'done' ? '项目包已生成' : '项目包生成失败')
  } catch (error) {
    renderProjectPackStatus({ status: 'failed_post_processing', reason: error.message || String(error) })
    showToast(error.message || String(error))
  } finally {
    button.disabled = false
  }
}

export function initProjectPackTab() {
  $('#project-pack-sync-current').addEventListener('click', syncCurrentJobs)
  $('#project-pack-build').addEventListener('click', handleBuildProjectPack)
}
