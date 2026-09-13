const CONTROLLED_EDITOR_ERROR_CODES = new Set([
  'accept_conflict',
  'accept_outcome_ambiguous',
  'action_repair_unavailable',
  'artifact_integrity_failed',
  'artifact_not_found',
  'asset_in_use',
  'asset_not_found',
  'asset_revision_conflict',
  'editor_project_error',
  'identity_mismatch',
  'invalid_accept_request',
  'invalid_implementation_revision',
  'invalid_json',
  'invalid_managed_metadata',
  'invalid_managed_sheet',
  'invalid_managed_source',
  'invalid_operation_identity',
  'invalid_operation_lookup',
  'invalid_recipe',
  'job_not_found',
  'job_not_ready',
  'missing_expected_revision',
  'missing_project',
  'missing_source_layout',
  'noncanonical_recipe',
  'not_found',
  'request_too_large',
  'preview_stale',
  'profile_conflict',
  'provider_configuration_error',
  'provider_unavailable',
  'project_id_mismatch',
  'project_not_found',
  'quality_blocked',
  'revision_conflict',
  'revision_not_found',
  'specialized_accept_required',
  'stale_plan',
  'unexpected_request_field',
  'unsafe_artifact_path',
  'unsupported_profile',
  'warning_confirmation_required',
])

function errorBodyObject(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

export class EditorApiError extends Error {
  constructor({ status, body }) {
    const normalized = errorBodyObject(body)
    const controlledCode = CONTROLLED_EDITOR_ERROR_CODES.has(normalized.error)
    const reason = typeof normalized.reason === 'string' && normalized.reason
      ? normalized.reason
      : controlledCode
        ? normalized.error
        : `request failed: ${status}`
    super(reason)
    this.name = 'EditorApiError'
    this.status = status
    this.code = controlledCode
      ? normalized.error
      : 'editor_request_failed'
    this.details = normalized.details && typeof normalized.details === 'object' && !Array.isArray(normalized.details)
      ? normalized.details
      : null
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch (error) {
      if (response.ok) throw error
    }
  }
  if (!response.ok) throw new EditorApiError({ status: response.status, body })
  return body
}

export async function createEditorProject({ id, name }) {
  return jsonRequest('/api/editor/projects', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  })
}

export async function loadEditorProject(projectId) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(projectId)}`)
}

export async function saveEditorProject(project, expectedRevision) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ project, expectedRevision }),
  })
}

export async function autosaveEditorProject(project) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(project.id)}/autosave`, {
    method: 'POST',
    body: JSON.stringify({ project }),
  })
}

export async function importGeneratedJob({ projectId, expectedRevision, expectedAssetRevisionId, kind, jobId, assetId }) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(projectId)}/import-job`, {
    method: 'POST',
    body: JSON.stringify({
      expectedRevision,
      expectedAssetRevisionId: expectedAssetRevisionId || undefined,
      kind,
      jobId,
      assetId: assetId || undefined,
    }),
  })
}

export function acceptFixedRegionActionRepairCandidate(input, { signal } = {}) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/action-repair/${encodeURIComponent(input.jobId)}/accept`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      expectedAssetRevisionId: input.expectedAssetRevisionId,
      expectedPlanHash: input.expectedPlanHash,
    }),
  })
}

export async function unlinkEditorAsset({ projectId, expectedRevision, assetId }) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/unlink`, {
    method: 'POST',
    body: JSON.stringify({ expectedRevision }),
  })
}

export async function deleteEditorAsset({ projectId, expectedRevision, assetId }) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision }),
  })
}

export async function exportEditorProjectPack({ projectId, expectedRevision }) {
  return jsonRequest(`/api/editor/projects/${encodeURIComponent(projectId)}/export-pack`, {
    method: 'POST',
    body: JSON.stringify({ expectedRevision }),
  })
}

export async function fetchEditorArtifactJson(url) {
  const artifactUrl = String(url ?? '')
  if (!artifactUrl.startsWith('/api/editor/artifact?')) {
    throw new Error('editor artifact URL is outside the controlled workspace route')
  }
  return jsonRequest(artifactUrl, { method: 'GET' })
}

export async function repairCharacterAction(options = {}) {
  return jsonRequest('/api/repair-character-action', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function fetchJob(jobId, { signal } = {}) {
  return jsonRequest(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    signal,
  })
}

const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_project_pack',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])

export async function waitForJob(job, onUpdate = () => {}) {
  let current = job
  onUpdate(current)
  for (let index = 0; current?.id && !TERMINAL_JOB_STATUSES.has(current.status) && index < 240; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    current = await fetchJob(current.id)
    onUpdate(current)
  }
  return current
}
