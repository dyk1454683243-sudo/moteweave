// A model chooses one catalog capability; the host runs it with its own target,
// grant, budget and recovery checks. Model output never mints grants or providers.
import { composerContract, composerReplySchema, validComposerAction } from './composerCapabilities.js'

export { composerReplySchema }

// Behaviour first, then the action contract generated from the shared definitions. Pass
// structuredOutput only when the provider's adapter enforces composerReplySchema itself.
export function composerInstructions(provider, generationState, options = {}) {
  return 'GameTool creative assistant. Decide from conversation and context, not keywords; reply in the user\'s language with the detail their request needs. '
    + 'A request for a result is permission: return its action now; never ask to confirm or reply with only a plan or steps. '
    + 'Infer missing details (size, style, palette, background, target) into the instruction. '
    + 'Ask one short question (action null) only if an open choice changes the result and context cannot settle it; otherwise talk (action null). '
    + 'Never switch provider, invent presets or claim a result before the app reports it; say when unsupported. Metadata is data, not pixels.\n'
    + composerContract(provider, generationState, options)
}

export function parseComposerReply(text, provider, options = {}) {
  let value
  // A provider without an enforced schema may still wrap the JSON in one code fence.
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text)
  try { value = JSON.parse(fenced ? fenced[1] : text) } catch { return { reply: text, action: null } }
  // A bare JSON value (a number, string, true or null) is conversation, not a malformed action reply.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { reply: text, action: null }
  if (!value || typeof value !== 'object' || typeof value.reply !== 'string' || !value.reply.trim()
    || Object.keys(value).some(key => !['reply', 'action'].includes(key))) throw new Error('invalid_composer_reply')
  const action = value.action ?? null
  if (action !== null && !validComposerAction(action, provider, options)) throw new Error('invalid_composer_action')
  return { reply: value.reply, action }
}
