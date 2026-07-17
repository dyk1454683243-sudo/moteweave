import { EDITOR_PROJECT_VERSION } from './constants.js'
import { clonePlain } from './safety.js'
import { validateEditorProject } from './validation.js'

export function migrateEditorProject(input, { validate = true } = {}) {
  const originalVersion = input?.version ?? null
  if (originalVersion !== EDITOR_PROJECT_VERSION) {
    return {
      project: null,
      diagnostics: {
        original_version: originalVersion,
        target_version: EDITOR_PROJECT_VERSION,
        migrated: false,
        blocking_errors: ['unknown_project_version'],
      },
    }
  }

  const project = clonePlain(input)
  const validation = validate ? validateEditorProject(project) : { blocking_errors: [] }
  return {
    project,
    diagnostics: {
      original_version: originalVersion,
      target_version: EDITOR_PROJECT_VERSION,
      migrated: false,
      blocking_errors: validation.blocking_errors,
    },
  }
}
