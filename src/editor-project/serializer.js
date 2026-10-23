import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { clonePlain } from './safety.js'
import { isPixelEditorProject, spriteDocumentError } from './spriteDocumentValidation.js'
import { validateEditorProject } from './validation.js'

function assertSerializedSize(project, json) {
  if (!isPixelEditorProject(project)) return json
  if (Buffer.byteLength(json, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes) {
    throw spriteDocumentError('resource_limit', 'project JSON exceeds 2MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes,
    })
  }
  return json
}

export function parseEditorProjectJson(json, { validate = true } = {}) {
  const project = JSON.parse(json)
  assertSerializedSize(project, typeof json === 'string' ? json : JSON.stringify(project))
  if (!validate) return project
  const result = validateEditorProject(project)
  if (result.status === 'fail') {
    const error = new Error(`Invalid editor project: ${result.blocking_errors.join(', ')}`)
    error.validation = result
    throw error
  }
  return project
}

export function serializeEditorProject(project, { validate = true, trailingNewline = true } = {}) {
  const copy = clonePlain(project)
  if (validate) {
    const result = validateEditorProject(copy)
    if (result.status === 'fail') {
      if (isPixelEditorProject(copy) && result.blocking_errors.includes('project_resource_limit')) {
        throw spriteDocumentError('resource_limit', 'project JSON exceeds 2MiB', { limit: SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes })
      }
      const error = new Error(`Invalid editor project: ${result.blocking_errors.join(', ')}`)
      error.validation = result
      throw error
    }
  }
  const json = JSON.stringify(copy, null, 2)
  const serialized = trailingNewline ? `${json}\n` : json
  return assertSerializedSize(copy, serialized)
}

export function roundTripEditorProject(project) {
  return parseEditorProjectJson(serializeEditorProject(project))
}
