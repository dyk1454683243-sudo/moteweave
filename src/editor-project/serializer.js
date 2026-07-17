import { clonePlain } from './safety.js'
import { validateEditorProject } from './validation.js'

export function parseEditorProjectJson(json, { validate = true } = {}) {
  const project = JSON.parse(json)
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
      const error = new Error(`Invalid editor project: ${result.blocking_errors.join(', ')}`)
      error.validation = result
      throw error
    }
  }
  const json = JSON.stringify(copy, null, 2)
  return trailingNewline ? `${json}\n` : json
}

export function roundTripEditorProject(project) {
  return parseEditorProjectJson(serializeEditorProject(project))
}
