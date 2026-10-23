import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'

export const ANTIGRAVITY_ASSISTANT_MODEL = 'gemini-3.8-flash-low'
export const ANTIGRAVITY_ASSISTANT_VERSION = '1.2.14'
export const ANTIGRAVITY_ASSISTANT_PROFILE = path.join(homedir(), '.local/share/gametool/antigravity-assistant')
export const ANTIGRAVITY_ASSISTANT_WORKDIR = path.join(ANTIGRAVITY_ASSISTANT_PROFILE, 'workdir')
const AGENT = 'gametool-text-proposal'
const CLI = path.join(homedir(), '.local/bin/agy')
const GUARD = fileURLToPath(new URL('../../scripts/run-with-resource-guard.mjs', import.meta.url))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The approved official agent configuration, not an inferred permission from init.tools.
export const ANTIGRAVITY_AGENT_DEFINITION = '---\nname: gametool-text-proposal\n'
  + 'description: Text-only structured proposal assistant.\nmainAgent: true\nsubagent: false\n'
  + 'tools: []\ninheritCustomizations: false\nexcludeDefaultComponents: true\n---\n\n'
  + 'Return structured text proposals only. Do not execute actions.\n'
const fail = code => Object.assign(new Error(code), { code })

export function antigravityAssistantEnvironment(env = process.env) {
  // Preserve native login without importing API keys, provider overrides or NODE_OPTIONS.
  return { HOME: env.HOME, PATH: env.PATH, TMPDIR: env.TMPDIR, LANG: 'en_US.UTF-8' }
}

export async function prepareAntigravityProfile() {
  try {
    for (const dir of [ANTIGRAVITY_ASSISTANT_PROFILE, ANTIGRAVITY_ASSISTANT_WORKDIR,
      path.join(ANTIGRAVITY_ASSISTANT_WORKDIR, '.agents'), path.join(ANTIGRAVITY_ASSISTANT_WORKDIR, '.agents/agents')]) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const info = await lstat(dir)
      if (!info.isDirectory() || (info.mode & 0o077)) throw new Error()
    }
    const file = path.join(ANTIGRAVITY_ASSISTANT_WORKDIR, '.agents/agents', `${AGENT}.md`)
    try { await writeFile(file, ANTIGRAVITY_AGENT_DEFINITION, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    const info = await lstat(file)
    if (!info.isFile() || (info.mode & 0o077) || info.size > 4096
      || await readFile(file, 'utf8') !== ANTIGRAVITY_AGENT_DEFINITION) throw new Error()
  } catch { throw fail('assistant_profile_unavailable') }
}

export function antigravityAssistantArguments(threadId = null) {
  return ['--agent', AGENT, '--model', ANTIGRAVITY_ASSISTANT_MODEL,
    '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--disable-slash-commands', '--print-timeout', '50s',
    ...(threadId ? ['--conversation', threadId] : [])]
}

function runProcess(args, { signal, timeoutMs = 60_000, spawnImpl, onLine }) {
  if (signal?.aborted) return Promise.reject(fail('assistant_cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [GUARD, '--max-old-space-mib', '1024',
      '--max-rss-mib', '1536', '--timeout-ms', String(timeoutMs), '--poll-ms', '500', '--', CLI, ...args],
    { cwd: ANTIGRAVITY_ASSISTANT_WORKDIR, env: antigravityAssistantEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    const decoder = new StringDecoder('utf8')
    let output = '', buffer = '', bytes = 0, errorBytes = 0, failure = null
    const stop = code => { if (!failure) { failure = fail(code); child.kill('SIGTERM') } }
    const abort = () => stop('assistant_cancelled')
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdin.on('error', () => stop('assistant_request_failed'))
    if (!onLine) child.stdin.end()
    const consume = line => {
      if (failure || !line.trim()) return
      try { onLine(line, child) } catch (error) { stop(error.code || 'assistant_invalid_protocol') }
    }
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (!onLine && bytes > 64 * 1024) return stop('assistant_output_limit')
      const text = decoder.write(chunk)
      if (!onLine) { output += text; return }
      buffer += text
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
      }
    })
    // Discard native diagnostics: they can contain account and prompt data.
    child.stderr.on('data', chunk => { errorBytes += chunk.length })
    child.once('error', () => stop('assistant_unavailable'))
    child.once('close', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort)
      if (onLine) consume(buffer + decoder.end())
      else output += decoder.end()
      if (failure || code !== 0 || exitSignal) reject(Object.assign(failure || fail('assistant_request_failed'),
        { exitCode: Number.isInteger(code) ? code : null, stdoutBytes: bytes, stderrBytes: errorBytes }))
      else resolve(output)
    })
  })
}

export function assertAntigravityHooks(report) {
  if (report?.status !== 'SUCCESS' || report.num_turns !== 0 || report.command?.name !== 'hooks'
    || !Array.isArray(report.command?.data?.hooks) || report.command.data.hooks.length !== 0) {
    throw fail('assistant_configuration_changed')
  }
}

/** Official text connector. Native session IDs are server-owned. No wrapper retries. */
export async function runAntigravityAssistant({ message, threadId = null, signal } = {}, dependencies = {}) {
  if (typeof message !== 'string' || !message.trim() || message.length > 6000) throw fail('invalid_assistant_message')
  if (threadId !== null && (typeof threadId !== 'string' || !UUID.test(threadId))) throw fail('invalid_assistant_thread')
  if (signal?.aborted) throw fail('assistant_cancelled')
  const spawnImpl = dependencies.spawnImpl || spawn
  const reportFailure = value => {
    try { (dependencies.reportFailure || (data => console.warn('assistant-diagnostic', JSON.stringify(data))))(value) } catch { /* diagnostics cannot change execution */ }
  }
  let phase = 'profile'
  const preflightAt = Date.now()
  try {
    await (dependencies.prepareProfile || prepareAntigravityProfile)()
    phase = 'version'
    const version = await runProcess(['--version'], { signal, spawnImpl, timeoutMs: 5000 })
    if (!new RegExp(`(?:^|\\s)${ANTIGRAVITY_ASSISTANT_VERSION.replaceAll('.', '\\.')}($|\\s)`).test(version.trim())) {
      throw fail('assistant_version_unverified')
    }
    phase = 'hooks'
    try {
      const hooks = await runProcess(['--agent', AGENT, '--model', ANTIGRAVITY_ASSISTANT_MODEL,
        '-p', '/hooks', '--output-format', 'json', '--print-timeout', '20s'], { signal, spawnImpl })
      assertAntigravityHooks(JSON.parse(hooks))
    } catch (error) {
      if (error.code === 'assistant_cancelled') throw error
      throw fail('assistant_configuration_changed')
    }
  } catch (error) {
    reportFailure({ provider: 'antigravity', phase, resume: threadId !== null, stdinMessageAttempted: false,
      code: error.code, elapsedMs: Date.now() - preflightAt, exitCode: error.exitCode ?? null,
      stdoutBytes: error.stdoutBytes ?? 0, stderrBytes: error.stderrBytes ?? 0 })
    throw error
  }
  let initialized = false, nativeId = null, result = null, terminalStatus = null, stepCount = 0
  let lastEvent = null, lastStep = null, resultShape = null
  const startedAt = Date.now()
  try { await runProcess(antigravityAssistantArguments(threadId), { signal, spawnImpl, onLine(line, child) {
    const event = JSON.parse(line)
    lastEvent = ['init', 'step_update', 'result', 'error'].includes(event?.event) ? event.event : 'unknown'
    if (event?.event === 'init') {
      if (initialized) throw fail('assistant_invalid_protocol')
      if (event.init?.agent !== AGENT || event.init?.model !== ANTIGRAVITY_ASSISTANT_MODEL
        || event.init?.cwd !== ANTIGRAVITY_ASSISTANT_WORKDIR || event.init?.permission_mode !== 'request-review'
        || typeof event.conversation_id !== 'string' || !UUID.test(event.conversation_id)
        || (threadId && event.conversation_id !== threadId)) {
        throw fail('assistant_configuration_changed')
      }
      initialized = true; nativeId = event.conversation_id
      // init.tools is a global inventory, not proof of the model's effective tool schema.
      child.stdin.end(`${JSON.stringify({ event: 'user', message: { content: message } })}\n`)
    } else if (event?.event === 'step_update') {
      stepCount++
      const step = event.step_update
      lastStep = ['user_input', 'agent_response', 'checkpoint', 'system_message', 'error_message', 'tool'].includes(step?.step_type) ? step.step_type : 'unknown'
      if (step?.step_type === 'tool' || step?.tool_info || step?.subagent_info || step?.tool_name) throw fail('assistant_tool_blocked')
      // Native resume can announce system context before the reply (upstream issue #1048).
      // It is progress data, never instructions or a successful response. Keep all
      // unknown/error steps and tool-bearing messages fail-closed.
      const resumeNotice = threadId && step?.step_type === 'system_message'
        && ['ACTIVE', 'DONE'].includes(step.state)
        && !['tool_info', 'subagent_info', 'tool_name'].some(key => Object.hasOwn(step, key))
      if (!initialized || result || step?.conversation_id !== nativeId
        || (!resumeNotice && !['user_input', 'agent_response', 'checkpoint'].includes(step?.step_type))) throw fail('assistant_invalid_protocol')
    } else if (event?.event === 'result') {
      const value = event.result
      terminalStatus = ['SUCCESS', 'ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID', 'WAITING', 'RUNNING'].includes(value?.status)
        ? value.status : 'UNKNOWN'
      resultShape = { conversationMatches: value?.conversation_id === nativeId,
        turns: Number.isSafeInteger(value?.num_turns) ? value.num_turns : null,
        responseChars: typeof value?.response === 'string' ? value.response.length : null }
      if (!initialized || result || value?.conversation_id !== nativeId || value.status !== 'SUCCESS'
        || !Number.isInteger(value.num_turns) || value.num_turns < 1 || (!threadId && value.num_turns !== 1)
        || typeof value.response !== 'string' || !value.response.trim()) {
        throw fail('assistant_response_failed')
      }
      result = { status: 'completed', provider: 'antigravity', requestedModel: ANTIGRAVITY_ASSISTANT_MODEL,
        reply: value.response, threadId: nativeId, naturalExit: true }
    } else throw fail('assistant_invalid_protocol')
  } })
    if (!result) throw fail('assistant_response_failed')
  } catch (error) {
    // One bounded, content-free diagnostic. Never log prompts, native IDs, replies or native stderr.
    const report = { provider: 'antigravity', phase: 'chat', resume: threadId !== null, stdinMessageAttempted: initialized,
      code: error.code, terminalStatus, stepCount, lastEvent, lastStep, resultShape, elapsedMs: Date.now() - startedAt,
      exitCode: error.exitCode ?? null, stdoutBytes: error.stdoutBytes ?? 0, stderrBytes: error.stderrBytes ?? 0 }
    reportFailure(report)
    throw error
  }
  return result
}
