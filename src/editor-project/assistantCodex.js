import { composerReplySchema, parseComposerReply } from './assistantActions.js'
import { spawn } from 'node:child_process'
import { readFile, lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { parsePixelEditProposal } from './pixelEditProposal.js'
import { PIXEL_TOOLS, pixelArgumentCorrection, pixelToolDiagnostic } from './pixelToolSession.js'

// Official account state belongs to Codex, never to project JSON or the browser.
export const CODEX_ASSISTANT_MODEL = 'gpt-6.1-sol'
export const CODEX_ASSISTANT_VERSION = '0.160.0'
export const CODEX_ASSISTANT_SUPPORTED_VERSIONS = Object.freeze(['0.160.0', '0.162.0-alpha.2', '0.162.0-alpha.17.2', '0.163.0-alpha.10.2', '0.163.0-alpha.11.1'])
export const ASTRA_PIXEL_MODEL = 'gpt-6-astra'
export const CODEX_ASSISTANT_PROFILE = path.join(homedir(), '.local/share/gametool/codex-assistant')
const CLI = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const GUARD = fileURLToPath(new URL('../../scripts/run-with-resource-guard.mjs', import.meta.url))
const PROFILE_CONFIG = '# GameTool local assistant profile. Credentials are managed only by official Codex login.\n'
  + '# Runtime restrictions are supplied explicitly by the approved connector.\n'
  + 'model_provider = "openai"\ncli_auth_credentials_store = "file"\n'
const REPLY_SCHEMA = Object.freeze({
  type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false,
})
const rectSchema = { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'],
  properties: Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, { type: 'integer' }])) }
const colorSchema = { type: 'array', minItems: 4, maxItems: 4, items: { type: 'integer', minimum: 0, maximum: 255 } }
const pointSchema = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'integer' }, y: { type: 'integer' } } }
const PROPOSAL_SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'operation'],
  properties: { reply: { type: 'string' }, operation: { anyOf: [{ type: 'null' },
    ...[['erase', []], ['fill-rect', ['color']], ['replace-color', ['from', 'to']]].map(([type, colors]) => ({
      type: 'object', additionalProperties: false, required: ['type', 'rect', ...colors],
      properties: { type: { type: 'string', enum: [type] }, rect: rectSchema,
        ...Object.fromEntries(colors.map(key => [key, colorSchema])) },
    })),
    ...Object.entries({
      pencil: { points: { type: 'array', minItems: 1, maxItems: 2048, items: pointSchema }, color: colorSchema },
      eraser: { points: { type: 'array', minItems: 1, maxItems: 2048, items: pointSchema } },
      line: { start: pointSchema, end: pointSchema, color: colorSchema },
      rectangle: { start: pointSchema, end: pointSchema, color: colorSchema },
      'flood-fill': { seed: pointSchema, color: colorSchema },
      text: { at: pointSchema, text: { type: 'string', maxLength: 160 }, size: { type: 'integer', minimum: 6, maximum: 96 }, color: colorSchema },
    }).map(([type, properties]) => ({ type: 'object', additionalProperties: false,
      required: ['type', 'rect', ...Object.keys(properties)], properties: { type: { type: 'string', enum: [type] }, rect: rectSchema, ...properties } })),
  ] } } }
const DRAWING_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['reply', 'drawing'],
  properties: { reply: { type: 'string' }, drawing: { anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false, required: ['size', 'palette', 'rects'],
    properties: { size: { type: 'integer', enum: [32, 64] },
      palette: { type: 'array', items: { type: 'string' } },
      rects: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } },
  }] } },
})

export function codexCliVersionSupported(banner) {
  const text = String(banner || '').trim()
  return CODEX_ASSISTANT_SUPPORTED_VERSIONS.some(version => text === `codex-cli ${version}`)
}

export function assistantConnectionError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function codexAssistantArguments({ image = false, pixelDrawing = false, pixelTools = false, model = pixelTools ? ASTRA_PIXEL_MODEL : CODEX_ASSISTANT_MODEL } = {}) {
  const config = [
    'model_provider="gametool_openai"', `model="${model}"`,
    'notify=[]', 'web_search="disabled"', 'project_doc_max_bytes=0',
    'cloud.skills.enabled=false', 'features.unbounded_connection_retries=false',
    'tools.experimental_request_user_input.enabled=false',
    'model_providers.gametool_openai.name="OpenAI"',
    'model_providers.gametool_openai.wire_api="responses"',
    'model_providers.gametool_openai.requires_openai_auth=true',
    'model_providers.gametool_openai.request_max_retries=0',
    'model_providers.gametool_openai.stream_max_retries=0',
    'model_providers.gametool_openai.supports_websockets=false',
    ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'hooks',
      'multi_agent', 'multi_agent_v2', 'image_generation', 'imagegenext', 'memories',
      'memory_tool', 'code_mode', 'code_mode_only', 'request_permissions_tool',
      'sleep_tool', 'token_budget', 'current_time_reminder'].map(key => `features.${key}=false`),
    ...(image ? ['features.image_generation=true'] : []),
    // Inline reference bytes must not be echoed in native notifications. Keep the output ceiling unchanged.
    ...(image || pixelDrawing || pixelTools ? ['features.omit_app_server_notification_media=true'] : []),
  ]
  return ['app-server', '--stdio', '--strict-config', ...config.flatMap(value => ['-c', value])]
}

export function codexAssistantEnvironment(env = process.env) {
  // In particular, do not inherit API keys, provider URL overrides, or developer config.
  return { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, LANG: 'en_US.UTF-8', CODEX_HOME: CODEX_ASSISTANT_PROFILE }
}

async function checkProfile() {
  try {
    const info = await lstat(CODEX_ASSISTANT_PROFILE)
    const config = path.join(CODEX_ASSISTANT_PROFILE, 'config.toml')
    const configInfo = await lstat(config)
    if (!info.isDirectory() || (info.mode & 0o077) || !configInfo.isFile() || configInfo.size > 4096
      || await readFile(config, 'utf8') !== PROFILE_CONFIG) throw new Error('changed')
  } catch { throw assistantConnectionError('assistant_profile_unavailable') }
}

function guardedSpawn(args, { timeoutMs, spawnImpl }) {
  return spawnImpl(process.execPath, [GUARD,
    '--max-old-space-mib', '1024', '--max-rss-mib', '1536',
    '--timeout-ms', String(timeoutMs), '--poll-ms', '500', '--', CLI, ...args,
  ], { cwd: CODEX_ASSISTANT_PROFILE, env: codexAssistantEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
}

async function checkVersion(spawnImpl) {
  const child = guardedSpawn(['--version'], { timeoutMs: 5000, spawnImpl })
  let output = '', exceeded = false
  child.stdin.on('error', () => child.kill('SIGTERM'))
  child.stdin.end()
  child.stderr.on('data', () => {})
  child.stdout.on('data', chunk => {
    if (output.length + chunk.length > 4096) { exceeded = true; child.kill('SIGTERM'); return }
    output += chunk.toString('utf8')
  })
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(assistantConnectionError('assistant_unavailable')))
    child.once('close', code => {
      if (exceeded || code !== 0 || !codexCliVersionSupported(output)) {
        reject(assistantConnectionError('assistant_version_unverified'))
      } else resolve()
    })
  })
}

/** One official operation; login cache survives this bounded process, with no logout.
 * A message is never retried here. The official client alone owns approved 401 recovery.
 * threadId is internal state supplied by the host, not an arbitrary browser parameter.
 */
export async function runCodexAssistant({ message, threadId = null, signal, pixelDrawing = false, pixelProposal = false, composerActions = false, composerPresetId = null, referenceDataUrl = null, pixelTools = null, model = pixelTools ? ASTRA_PIXEL_MODEL : CODEX_ASSISTANT_MODEL } = {}, dependencies = {}) {
  return runCodexNative({ message, threadId, signal, pixelDrawing, pixelProposal, composerActions, composerPresetId, referenceDataUrl, pixelTools, model }, dependencies)
}
// Composer turns pass composerReplySchema as the strict output schema (see turn/start below), so
// the instructions can carry field meanings without restating every allowed value.
runCodexAssistant.enforcesComposerSchema = true

// Internal native image entry. Not a browser-selectable tool or text-assistant option.
export async function runCodexNative({ message, threadId = null, signal, image = false, pixelDrawing = false, pixelProposal = false, composerActions = false, composerPresetId = null, referenceDataUrl = null, pixelTools = null, model = pixelTools ? ASTRA_PIXEL_MODEL : CODEX_ASSISTANT_MODEL } = {}, dependencies = {}) {
  // Browser text is capped at 4000; the host adds bounded selected-object metadata.
  if (message !== undefined && (typeof message !== 'string' || !message.trim() || message.length > 6000)) {
    throw assistantConnectionError('invalid_assistant_message')
  }
  if (threadId !== null && (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(threadId))) {
    throw assistantConnectionError('invalid_assistant_thread')
  }
  if (signal?.aborted) throw assistantConnectionError('assistant_cancelled')
  if (typeof pixelDrawing !== 'boolean' || (pixelDrawing && (image || threadId))) throw assistantConnectionError('invalid_image_request')
  if (typeof pixelProposal !== 'boolean' || (pixelProposal && (pixelDrawing || image))) throw assistantConnectionError('invalid_assistant_message')
  if (typeof composerActions !== 'boolean' || (composerActions && (image || pixelDrawing || pixelProposal || pixelTools))) throw assistantConnectionError('invalid_assistant_message')
  if (pixelTools !== null && (typeof pixelTools?.call !== 'function' || image || pixelDrawing || pixelProposal || threadId)) throw assistantConnectionError('invalid_assistant_message')
  if (![CODEX_ASSISTANT_MODEL, ASTRA_PIXEL_MODEL].includes(model) || (pixelTools && model !== ASTRA_PIXEL_MODEL)
    || ((image || pixelDrawing || pixelProposal) && model !== CODEX_ASSISTANT_MODEL)) throw assistantConnectionError('invalid_assistant_message')
  const startedAt = Date.now()
  const knownItem = value => ['agentMessage', 'userMessage', 'reasoning', 'dynamicToolCall', 'imageGeneration'].includes(value) ? value : 'other'
  const toolCounts = () => pixelTools?.status?.() || { calls: toolIds.size, drawing_batches: 0, argument_corrections: 0 }
  function diagnose(error, fields = {}) {
    if (!pixelTools || !error) return error
    const snapshot = toolCounts()
    if (!error.diagnostic) error.diagnostic = pixelToolDiagnostic({
      reason: fields.reason || (['assistant_login_required', 'assistant_model_unavailable', 'assistant_model_mismatch', 'assistant_profile_unavailable', 'assistant_configuration_changed', 'assistant_version_unverified'].includes(error.code) ? 'authorization' : 'internal'),
      rule: fields.rule || 'internal',
      terminal: fields.terminal !== false,
      elapsed_ms: Date.now() - startedAt,
      item_type: fields.item_type || 'other',
      ...snapshot,
      ...fields,
    })
    else error.diagnostic = pixelToolDiagnostic({ ...snapshot, ...error.diagnostic,
      ...(snapshot.last_argument_rejection ? { last_argument_rejection: snapshot.last_argument_rejection } : {}) })
    return error
  }
  if (referenceDataUrl !== null && (!(image || pixelDrawing || pixelTools) || typeof referenceDataUrl !== 'string'
    || referenceDataUrl.length > 12 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(referenceDataUrl))) {
    throw assistantConnectionError('invalid_image_request')
  }
  const spawnImpl = dependencies.spawnImpl || spawn
  await (dependencies.checkProfile || checkProfile)()
  await checkVersion(spawnImpl)
  if (signal?.aborted) throw assistantConnectionError('assistant_cancelled')
  if (image && threadId) throw assistantConnectionError('invalid_assistant_thread')
  const child = guardedSpawn(codexAssistantArguments({ image, pixelDrawing, pixelTools: Boolean(pixelTools), model }), { timeoutMs: message === undefined ? 25_000 : image || pixelTools ? 180_000 : 90_000, spawnImpl })
  const pending = new Map()
  const decoder = new StringDecoder('utf8')
  let nextId = 1, buffer = '', reply = '', activeThread = null
  let result = null, failure = null, stopping = false, turnStartRequests = 0
  let imageCallId = null
  let activeTurn = null, toolQueue = Promise.resolve(), pendingTools = 0
  const toolIds = new Set()
  let resolveClosed, rejectClosed
  const closed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject })
  // Attach immediately: a failing child can close before initialization has finished.
  closed.catch(() => {})
  function stop(error = null) {
    if (stopping) return
    stopping = true
    failure = diagnose(error)
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error || assistantConnectionError('assistant_closed')) }
    pending.clear()
    child.stdin.end()
    child.kill('SIGTERM') // Existing supervisor terminates and reaps the complete child tree.
  }
  const abort = () => stop(assistantConnectionError('assistant_cancelled'))
  signal?.addEventListener('abort', abort, { once: true })
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        stop(assistantConnectionError('assistant_protocol_timeout'))
      }, 20_000)
      pending.set(id, { resolve, reject, timer, method })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  child.stdin.on('error', () => stop(assistantConnectionError('assistant_unavailable')))
  child.once('error', () => stop(assistantConnectionError('assistant_unavailable')))
  // Drain diagnostics without retaining them or counting them against the reply.
  // The process-tree memory and time supervisor remains the resource boundary.
  child.stderr.resume()
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk)
    while (!stopping && buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (!line.trim()) continue
      let event
      try { event = JSON.parse(line) } catch { stop(assistantConnectionError('assistant_invalid_protocol')); break }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        stop(assistantConnectionError('assistant_invalid_protocol')); break
      }
      if (event.id !== undefined && event.method) {
        const params = event.params
        const activeTools = Array.isArray(pixelTools?.tools) ? pixelTools.tools : PIXEL_TOOLS
        const allowlisted = activeTools.some(tool => tool.name === params?.tool)
        const identityFailure = !pixelTools || event.method !== 'item/tool/call' || params?.threadId !== activeThread || !activeTurn
          || params.turnId !== activeTurn || params.namespace != null || !allowlisted
          || typeof params.callId !== 'string' || !params.callId || params.callId.length > 200
          || toolIds.has(params.callId)
        if (identityFailure || toolIds.size >= 9) {
          child.stdin.write(`${JSON.stringify({ id: event.id, error: { code: -32601, message: 'Tool not authorized' } })}\n`)
          const budget = !identityFailure && toolIds.size >= 9
          stop(diagnose(assistantConnectionError('assistant_tool_blocked'), budget
            ? { reason: 'budget', rule: 'call_limit', terminal: true }
            : { reason: params?.namespace != null ? 'authorization' : !allowlisted ? 'authorization' : 'authorization', rule: params?.namespace != null ? 'namespace' : !allowlisted ? 'tool_identity' : toolIds.has(params?.callId) ? 'duplicate_call' : 'turn_identity', terminal: true }))
        } else {
          toolIds.add(params.callId); pendingTools++
          toolQueue = toolQueue.then(async () => {
            let output
            try {
              if (!stopping) output = await pixelTools.call(params.tool, params.arguments)
            } catch (error) {
              if (stopping) return
              if (error?.code === 'pixel_tool_invalid_arguments' && error.recoverable === true) {
                output = { success: false, contentItems: [{ type: 'inputText', text: pixelArgumentCorrection(error.diagnostic) }] }
              } else {
                const wrapped = error?.code === 'assistant_context_changed' ? error : assistantConnectionError('assistant_tool_blocked')
                if (error?.diagnostic) wrapped.diagnostic = error.diagnostic
                stop(diagnose(wrapped, error?.diagnostic))
                return
              }
            } finally { pendingTools-- }
            if (!stopping && output) child.stdin.write(`${JSON.stringify({ id: event.id, result: output })}\n`)
          }).catch(error => stop(diagnose(error?.code ? error : assistantConnectionError('assistant_tool_blocked'), { reason: 'internal', rule: 'internal', terminal: true })))
        }
      } else if (pending.has(event.id)) {
        const entry = pending.get(event.id)
        pending.delete(event.id); clearTimeout(entry.timer)
        if (event.error) entry.reject(assistantConnectionError('assistant_request_failed'))
        else {
          // A tool request can follow this response in the very same stdout chunk.
          if (entry.method === 'turn/start') activeTurn = event.result?.turn?.id || null
          entry.resolve(event.result)
        }
      } else if (event.params?.threadId === activeThread && activeThread) {
        const item = event.params.item
        if (event.method === 'turn/plan/updated'
          || (item?.type && !['agentMessage', 'userMessage', 'reasoning', ...(image ? ['imageGeneration'] : []), ...(pixelTools ? ['dynamicToolCall'] : [])].includes(item.type))) {
          stop(diagnose(assistantConnectionError('assistant_tool_blocked'), event.method === 'turn/plan/updated'
            ? { reason: 'prohibited', rule: 'plan_event', terminal: true, item_type: 'other' }
            : { reason: 'unsupported', rule: 'item_type', terminal: true, item_type: knownItem(item?.type) }))
        } else if (image && item?.type === 'imageGeneration') {
          if (!/^[a-zA-Z0-9_-]{1,200}$/.test(item.id || '') || (imageCallId && item.id !== imageCallId)) {
            stop(assistantConnectionError('image_tool_limit'))
          } else {
            imageCallId = item.id
            if (event.method === 'item/completed') {
              if (item.status !== 'completed' || item.failure || item.result !== '' || typeof item.savedPath !== 'string') {
                stop(assistantConnectionError('image_native_failed'))
              } else {
                result = { provider: 'codex', model: 'gpt-image-2', savedPath: item.savedPath,
                  threadId: activeThread, imageCallId, observedToolCalls: 1, turnStartRequests }
                // Stop the supervised tree after the first image. Native internals are not a hard one-call API.
                stop()
              }
            }
          }
        } else if (event.method === 'item/completed' && item?.type === 'agentMessage') {
          reply = typeof item.text === 'string' ? item.text : ''
        } else if (event.method === 'turn/completed') {
          if (image) { stop(assistantConnectionError('image_native_failed')); continue }
          try {
            const parsed = JSON.parse(reply)
            if (composerActions) parseComposerReply(reply, model === ASTRA_PIXEL_MODEL ? 'astra' : 'codex', { selectedPresetId: composerPresetId })
            if (pixelProposal) parsePixelEditProposal(reply, 1024, 1024)
            if (pendingTools || event.params.turn?.status !== 'completed' || Object.keys(parsed).length !== (pixelDrawing || pixelProposal || composerActions ? 2 : 1)
              || (pixelDrawing && !Object.hasOwn(parsed, 'drawing'))
              || typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('invalid')
            result = { status: 'completed', provider: 'codex', model,
              threadId: activeThread, reply: pixelDrawing || pixelProposal || composerActions ? reply : parsed.reply, turnStartRequests,
              ...(pixelTools ? { observedToolCalls: toolIds.size } : {}) }
            stop()
          } catch { stop(Object.assign(assistantConnectionError('assistant_response_failed'), { definitive: event.params.turn?.status === 'completed' })) }
        }
      }
    }
  })
  child.once('close', (code, signalName) => {
    signal?.removeEventListener('abort', abort)
    const cleanExit = !signalName && (code === 0 || (stopping && result && code === 143))
    if (!stopping) {
      const timedOut = Boolean(pixelTools) && Date.now() - startedAt >= 180000
      stop(diagnose(assistantConnectionError('assistant_unavailable'), timedOut ? { reason: 'timeout', rule: 'time_limit', terminal: true } : { reason: 'internal', rule: 'internal', terminal: true }))
    }
    if (failure || !result || !cleanExit) rejectClosed(failure || assistantConnectionError('assistant_unavailable'))
    else resolveClosed(result)
  })
  try {
    await rpc('initialize', { clientInfo: { name: 'gametool_assistant', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    const account = await rpc('account/read', { refreshToken: false })
    if (account.account?.type !== 'chatgpt') throw assistantConnectionError('assistant_login_required')
    const models = await rpc('model/list', { includeHidden: false, limit: 50 })
    if (!models.data?.some(entry => entry.model === model)) throw assistantConnectionError('assistant_model_unavailable')
    if (image) {
      const capability = await rpc('modelProvider/capabilities/read', {})
      if (capability.imageGeneration !== true) throw assistantConnectionError('image_unavailable')
    }
    if (message === undefined) {
      result = { status: 'ready', provider: 'codex', model, turnStartRequests: 0 }
      stop()
    } else {
      const config = { model, modelProvider: 'gametool_openai',
        environments: [], approvalPolicy: 'never', sandbox: 'read-only',
        allowProviderModelFallback: false }
      const dynamicTools = pixelTools ? (Array.isArray(pixelTools.tools) ? pixelTools.tools : PIXEL_TOOLS) : []
      const thread = await rpc(threadId ? 'thread/resume' : 'thread/start', threadId
        ? { ...config, threadId } : { ...config, ephemeral: Boolean(pixelTools), dynamicTools, selectedCapabilityRoots: [] })
      if (thread.model !== model) throw assistantConnectionError('assistant_model_mismatch')
      activeThread = thread.thread.id
      turnStartRequests++
      const started = await rpc('turn/start', { threadId: activeThread, environments: [], effort: pixelTools ? 'high' : 'low',
        input: [{ type: 'text', text: message }, ...(referenceDataUrl ? [{ type: 'image', url: referenceDataUrl }] : [])],
        ...(image ? {} : { outputSchema: pixelDrawing ? DRAWING_SCHEMA : pixelProposal ? PROPOSAL_SCHEMA
          : composerActions ? composerReplySchema(model === ASTRA_PIXEL_MODEL ? 'astra' : 'codex', { selectedPresetId: composerPresetId }) : REPLY_SCHEMA }) })
      activeTurn = started?.turn?.id || null
    }
  } catch (error) { if (!stopping) stop(error.code ? error : assistantConnectionError('assistant_request_failed')) }
  return closed
}
