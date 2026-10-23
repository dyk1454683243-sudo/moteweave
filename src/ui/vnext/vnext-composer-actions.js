// Routes a model-chosen capability to the UI operation that runs it. Capability ids and
// provider support come from the shared catalog (src/editor-project/composerCapabilities.js),
// so adding a capability means one definition there and one handler registered here.
// A clear user request is the permission: handlers execute and report results; they do
// not open approval steps. Target, revision, budget and recovery checks stay in each handler.
import { COMPOSER_ACTIONS, composerActionsFor } from '../../editor-project/composerCapabilities.js'

export function createComposerActionRouter(handlers = {}) {
  const missing = COMPOSER_ACTIONS.filter(action => typeof handlers[action.id] !== 'function').map(action => action.id)
  const unknown = Object.keys(handlers).filter(id => !COMPOSER_ACTIONS.some(action => action.id === id))
  if (missing.length || unknown.length) {
    throw new Error(`Composer handlers must match the capability catalog (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`)
  }
  const supports = (type, provider, options = {}) => composerActionsFor(provider, options).some(action => action.id === type)
  return {
    supports,
    async run(action, context) {
      if (!action || !supports(action.type, context?.provider, { selectedPresetId: context?.selectedPresetId })) return { handled: false }
      await handlers[action.type](action, context)
      return { handled: true }
    },
  }
}
