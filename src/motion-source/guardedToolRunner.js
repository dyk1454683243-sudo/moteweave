import { spawn } from 'node:child_process'
import { readProcessTree } from '../processTreeSnapshot.js'

export const EXTERNAL_TOOL_FAILURE = Object.freeze({
  TIMEOUT: 'external_tool_timeout',
  RSS_LIMIT: 'external_tool_rss_limit',
  CANCELLED: 'external_tool_cancelled',
  SPAWN_FAILED: 'external_tool_spawn_failed',
  FAILED: 'external_tool_failed',
  MONITOR_FAILED: 'external_tool_monitor_failed',
})

export const DEFAULT_GUARDED_TOOL_LIMITS = Object.freeze({
  maxRssMiB: 1536,
  timeoutMs: 120_000,
  pollIntervalMs: 1000,
  terminationGraceMs: 250,
  maxOutputBytes: 16 * 1024,
})

const activeProcessGroups = new Map()
let parentCleanupInstalled = false

export class ExternalToolError extends Error {
  constructor(code, message, evidence = {}) {
    super(message)
    this.name = 'ExternalToolError'
    this.code = code
    this.failure_status = code
    Object.assign(this, evidence)
  }
}

export function createExternalToolError(code, message, evidence = {}) {
  return new ExternalToolError(code, message, evidence)
}

export function throwIfExternalToolAborted(signal, evidence = {}) {
  if (!signal?.aborted) return
  throw createExternalToolError(
    EXTERNAL_TOOL_FAILURE.CANCELLED,
    'external tool operation cancelled',
    evidence
  )
}

function positiveNumber(value, fallback, label) {
  const resolved = value ?? fallback
  const number = Number(resolved)
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive finite number`)
  }
  return number
}

function normalizeOptions(options = {}) {
  const maxRssMiB = positiveNumber(
    options.maxRssMiB,
    DEFAULT_GUARDED_TOOL_LIMITS.maxRssMiB,
    'maxRssMiB'
  )
  const timeoutMs = positiveNumber(
    options.timeoutMs,
    DEFAULT_GUARDED_TOOL_LIMITS.timeoutMs,
    'timeoutMs'
  )
  const pollIntervalMs = positiveNumber(
    options.pollIntervalMs,
    DEFAULT_GUARDED_TOOL_LIMITS.pollIntervalMs,
    'pollIntervalMs'
  )
  const terminationGraceMs = positiveNumber(
    options.terminationGraceMs,
    DEFAULT_GUARDED_TOOL_LIMITS.terminationGraceMs,
    'terminationGraceMs'
  )
  const maxOutputBytes = Math.floor(positiveNumber(
    options.maxOutputBytes,
    DEFAULT_GUARDED_TOOL_LIMITS.maxOutputBytes,
    'maxOutputBytes'
  ))
  if (pollIntervalMs < 10 || pollIntervalMs > 1000) {
    throw new TypeError('pollIntervalMs must be between 10 and 1000')
  }
  if (terminationGraceMs > 5000) {
    throw new TypeError('terminationGraceMs must not exceed 5000')
  }
  if (maxOutputBytes > 1024 * 1024) {
    throw new TypeError('maxOutputBytes must not exceed 1048576')
  }
  const deadlineAt = options.deadlineAt === undefined || options.deadlineAt === null
    ? null
    : Number(options.deadlineAt)
  if (deadlineAt !== null && (!Number.isFinite(deadlineAt) || deadlineAt <= 0)) {
    throw new TypeError('deadlineAt must be a positive finite epoch timestamp')
  }
  return {
    maxRssKiB: Math.floor(maxRssMiB * 1024),
    maxRssMiB,
    timeoutMs: Math.floor(timeoutMs),
    pollIntervalMs: Math.floor(pollIntervalMs),
    terminationGraceMs: Math.floor(terminationGraceMs),
    maxOutputBytes,
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    tool: options.tool ?? 'external_tool',
    deadlineAt,
  }
}

class ByteTail {
  constructor(maxBytes) {
    this.maxBytes = maxBytes
    this.buffer = Buffer.alloc(0)
  }

  append(chunk) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (next.length >= this.maxBytes) {
      this.buffer = Buffer.from(next.subarray(next.length - this.maxBytes))
      return
    }
    const combined = Buffer.concat([this.buffer, next])
    this.buffer = combined.length > this.maxBytes
      ? Buffer.from(combined.subarray(combined.length - this.maxBytes))
      : combined
  }

  text() {
    return this.buffer
      .toString('utf8')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  }
}

function signalProcessGroup(rootPid, signal) {
  try {
    process.kill(-rootPid, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function processGroupExists(rootPid) {
  try {
    process.kill(-rootPid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function knownProcessesExist(pids) {
  return pids.some((pid) => {
    try { process.kill(pid, 0); return true } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  })
}

function signalKnownProcesses(pids, signal) {
  for (const pid of [...pids].reverse()) {
    try { process.kill(pid, signal) } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

async function waitForProcessGroupExit(rootPid, timeoutMs, pids = []) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  const treeExists = () => processGroupExists(rootPid) || knownProcessesExist(pids)
  while (treeExists() && Date.now() < deadline) {
    await wait(Math.min(25, Math.max(1, deadline - Date.now())))
  }
  return !treeExists()
}

async function terminateProcessGroup(rootPid, graceMs, pids = []) {
  const groupExisted = signalProcessGroup(rootPid, 'SIGTERM')
  const descendantsExisted = knownProcessesExist(pids)
  signalKnownProcesses(pids, 'SIGTERM')
  if (!groupExisted && !descendantsExisted) return { termination_signal: null }
  if (await waitForProcessGroupExit(rootPid, graceMs, pids)) {
    return { termination_signal: 'SIGTERM' }
  }
  signalProcessGroup(rootPid, 'SIGKILL')
  signalKnownProcesses(pids, 'SIGKILL')
  const killWaitMs = Math.max(250, Math.min(2000, graceMs * 4))
  if (!await waitForProcessGroupExit(rootPid, killWaitMs, pids)) {
    throw new Error(`external tool process group ${rootPid} survived SIGKILL`)
  }
  return { termination_signal: 'SIGKILL' }
}

function forceKillActiveGroups() {
  for (const [rootPid, tree] of activeProcessGroups) {
    try {
      signalProcessGroup(rootPid, 'SIGKILL')
      signalKnownProcesses(tree.pids, 'SIGKILL')
    } catch {
      // Parent shutdown cleanup is best effort and must not mask the parent exit.
    }
  }
}

function installParentCleanup() {
  if (parentCleanupInstalled) return
  parentCleanupInstalled = true
  process.once('exit', forceKillActiveGroups)
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const handler = () => {
      forceKillActiveGroups()
      process.removeListener(signal, handler)
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exit(128)
      }
    }
    process.on(signal, handler)
  }
}

class SingleConcurrencyQueue {
  constructor() {
    this.active = false
    this.pending = []
  }

  run(task, { signal, cancelError }) {
    if (signal?.aborted) return Promise.reject(cancelError())
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, signal, cancelError, abortHandler: null }
      this.pending.push(item)
      if (signal) {
        item.abortHandler = () => {
          const index = this.pending.indexOf(item)
          if (index < 0) return
          this.pending.splice(index, 1)
          signal.removeEventListener('abort', item.abortHandler)
          reject(cancelError())
        }
        signal.addEventListener('abort', item.abortHandler, { once: true })
        if (signal.aborted) {
          item.abortHandler()
          return
        }
      }
      this.pump()
    })
  }

  pump() {
    if (this.active) return
    const item = this.pending.shift()
    if (!item) return
    this.active = true
    if (item.signal && item.abortHandler) {
      item.signal.removeEventListener('abort', item.abortHandler)
    }
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active = false
        this.pump()
      })
  }
}

const mediaToolQueue = new SingleConcurrencyQueue()

function terminationError(reason, diagnostics) {
  if (reason === EXTERNAL_TOOL_FAILURE.TIMEOUT) {
    return createExternalToolError(reason, 'external tool exceeded its wall-clock deadline', diagnostics)
  }
  if (reason === EXTERNAL_TOOL_FAILURE.RSS_LIMIT) {
    return createExternalToolError(reason, 'external tool exceeded its process-tree RSS ceiling', diagnostics)
  }
  if (reason === EXTERNAL_TOOL_FAILURE.CANCELLED) {
    return createExternalToolError(reason, 'external tool operation cancelled', diagnostics)
  }
  return createExternalToolError(reason, 'external tool process monitoring failed', diagnostics)
}

async function runSpawnedTool(command, args, options) {
  if (process.platform === 'win32') {
    throw createExternalToolError(
      EXTERNAL_TOOL_FAILURE.MONITOR_FAILED,
      'guarded external tools require POSIX process-group supervision',
      { tool: options.tool ?? 'external_tool', platform: process.platform }
    )
  }
  const limits = normalizeOptions(options)
  throwIfExternalToolAborted(limits.signal, { tool: limits.tool })
  const remainingDeadlineMs = limits.deadlineAt === null
    ? Infinity
    : limits.deadlineAt - Date.now()
  if (remainingDeadlineMs <= 0) {
    throw createExternalToolError(
      EXTERNAL_TOOL_FAILURE.TIMEOUT,
      'external tool absolute deadline expired before launch',
      {
        tool: limits.tool,
        deadline_at: limits.deadlineAt,
        before_launch: true,
      }
    )
  }
  const effectiveTimeoutMs = Math.max(
    1,
    Math.floor(Math.min(limits.timeoutMs, remainingDeadlineMs))
  )
  installParentCleanup()

  const stdoutTail = new ByteTail(limits.maxOutputBytes)
  const stderrTail = new ByteTail(limits.maxOutputBytes)
  const startedAt = Date.now()
  let child
  try {
    child = spawn(command, args, {
      cwd: limits.cwd,
      env: limits.env ?? process.env,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw createExternalToolError(
      EXTERNAL_TOOL_FAILURE.SPAWN_FAILED,
      `failed to start external tool: ${error?.message || error}`,
      { tool: limits.tool }
    )
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let monitorTimer = null
    let monitorAbort = null
    let timeoutTimer = null
    let termination = null
    let terminationCleanup = null
    let peakRssKiB = 0
    let peakProcessCount = 0
    const knownTree = { pids: child.pid ? [child.pid] : [] }

    if (child.pid) activeProcessGroups.set(child.pid, knownTree)
    child.stdout?.on('data', (chunk) => stdoutTail.append(chunk))
    child.stderr?.on('data', (chunk) => stderrTail.append(chunk))

    const diagnostics = (extra = {}) => ({
      tool: limits.tool,
      stderr_tail: stderrTail.text(),
      stdout_tail: stdoutTail.text(),
      peak_rss_kib: peakRssKiB,
      peak_process_count: peakProcessCount,
      elapsed_ms: Date.now() - startedAt,
      deadline_at: limits.deadlineAt,
      timeout_ms: effectiveTimeoutMs,
      ...extra,
    })

    const clearLifecycle = () => {
      if (monitorTimer) clearTimeout(monitorTimer)
      monitorAbort?.abort()
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (limits.signal && abortHandler) limits.signal.removeEventListener('abort', abortHandler)
      if (child.pid) activeProcessGroups.delete(child.pid)
    }

    const finish = async (code, signal) => {
      if (settled) return
      settled = true
      let terminationEvidence = null
      if (terminationCleanup) {
        try {
          terminationEvidence = await terminationCleanup
        } catch (error) {
          clearLifecycle()
          reject(createExternalToolError(
            EXTERNAL_TOOL_FAILURE.MONITOR_FAILED,
            'external tool process-group termination could not be verified',
            diagnostics({
              exit_code: code,
              signal: signal ?? null,
              termination_reason: termination,
              cleanup_error: String(error?.message || error),
            })
          ))
          return
        }
      }
      clearLifecycle()
      const evidence = diagnostics({
        exit_code: code,
        signal: signal ?? terminationEvidence?.termination_signal ?? null,
      })
      if (termination) {
        reject(terminationError(termination, evidence))
        return
      }
      try {
        if (
          child.pid &&
          (processGroupExists(child.pid) || knownProcessesExist(knownTree.pids))
        ) {
          await terminateProcessGroup(child.pid, limits.terminationGraceMs, knownTree.pids)
        }
      } catch (error) {
        reject(createExternalToolError(
          EXTERNAL_TOOL_FAILURE.MONITOR_FAILED,
          'external tool descendant cleanup failed',
          diagnostics({
            exit_code: code,
            signal: signal ?? null,
            cleanup_error: String(error?.message || error),
          })
        ))
        return
      }
      if (code === 0) {
        resolve(evidence)
        return
      }
      reject(createExternalToolError(
        EXTERNAL_TOOL_FAILURE.FAILED,
        `external tool exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`,
        evidence
      ))
    }

    const failTerminationVerification = (error) => {
      if (settled) return
      settled = true
      clearLifecycle()
      reject(createExternalToolError(
        EXTERNAL_TOOL_FAILURE.MONITOR_FAILED,
        'external tool process-group termination could not be verified',
        diagnostics({
          termination_reason: termination,
          cleanup_error: String(error?.message || error),
        })
      ))
    }

    const requestTermination = (reason) => {
      if (termination || settled) return
      termination = reason
      if (monitorTimer) clearTimeout(monitorTimer)
      monitorAbort?.abort()
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (child.pid) {
        terminationCleanup = terminateProcessGroup(
          child.pid,
          limits.terminationGraceMs,
          knownTree.pids
        )
        void terminationCleanup.catch(failTerminationVerification)
      }
    }

    const monitor = async () => {
      if (termination || settled || child.exitCode !== null || child.signalCode !== null) return
      const sampledAt = performance.now()
      const currentAbort = new AbortController()
      monitorAbort = currentAbort
      try {
        const snapshot = await readProcessTree(child.pid, {
          onDiscover: (pids) => { knownTree.pids = pids },
          signal: currentAbort.signal,
        })
        peakRssKiB = Math.max(peakRssKiB, snapshot.rssKiB)
        peakProcessCount = Math.max(peakProcessCount, snapshot.pids.length)
        if (snapshot.rssKiB > limits.maxRssKiB) {
          requestTermination(EXTERNAL_TOOL_FAILURE.RSS_LIMIT)
          return
        }
      } catch {
        if (currentAbort.signal.aborted || settled || child.exitCode !== null || child.signalCode !== null) return
        requestTermination(EXTERNAL_TOOL_FAILURE.MONITOR_FAILED)
        return
      } finally {
        if (monitorAbort === currentAbort) monitorAbort = null
      }
      if (termination || settled || child.exitCode !== null || child.signalCode !== null) return
      monitorTimer = setTimeout(() => void monitor(), Math.max(0, limits.pollIntervalMs - (performance.now() - sampledAt)))
      monitorTimer.unref()
    }

    child.once('exit', () => {
      if (monitorTimer) clearTimeout(monitorTimer)
      monitorAbort?.abort()
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearLifecycle()
      reject(createExternalToolError(
        EXTERNAL_TOOL_FAILURE.SPAWN_FAILED,
        `failed to start external tool: ${error?.message || error}`,
        diagnostics()
      ))
    })
    child.once('close', (code, signal) => {
      void finish(code, signal)
    })

    const abortHandler = () => requestTermination(EXTERNAL_TOOL_FAILURE.CANCELLED)
    if (limits.signal) limits.signal.addEventListener('abort', abortHandler, { once: true })
    if (limits.signal?.aborted) requestTermination(EXTERNAL_TOOL_FAILURE.CANCELLED)
    timeoutTimer = setTimeout(
      () => requestTermination(EXTERNAL_TOOL_FAILURE.TIMEOUT),
      effectiveTimeoutMs
    )
    timeoutTimer.unref()
    if (child.pid) void monitor()
  })
}

export function runGuardedTool(command, args = [], options = {}) {
  const cancelError = () => createExternalToolError(
    EXTERNAL_TOOL_FAILURE.CANCELLED,
    'external tool operation cancelled before launch',
    { tool: options.tool ?? 'external_tool' }
  )
  return mediaToolQueue.run(
    () => runSpawnedTool(command, args, options),
    { signal: options.signal, cancelError }
  )
}
