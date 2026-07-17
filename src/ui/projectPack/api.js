const TERMINAL_JOB_STATUSES = new Set(['done', 'failed_project_pack', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'])

export async function buildProjectPack({ projectId, characterJobId, sceneJobId }) {
  const response = await fetch('/api/project-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      characterJobId,
      sceneJobId,
    }),
  })
  if (!response.ok) throw new Error(`project pack failed: ${response.status}`)
  return response.json()
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`)
  if (!response.ok) throw new Error(`project pack poll failed: ${response.status}`)
  return response.json()
}

export async function waitForProjectPackJob(job, onUpdate = () => {}) {
  let current = job
  onUpdate(current)
  for (let i = 0; current.id && !TERMINAL_JOB_STATUSES.has(current.status) && i < 160; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    current = await pollJob(current.id)
    onUpdate(current)
  }
  return current
}
