#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const optionDefinitions = new Map([
  ['--max-old-space-mib', ['maxOldSpaceMiB', 1024]],
  ['--max-rss-mib', ['maxRssMiB', 1536]],
  ['--timeout-ms', ['timeoutMs', 60_000]],
  ['--poll-ms', ['pollMs', 500]],
])

function parseArguments(argv) {
  const separatorIndex = argv.indexOf('--', 2)
  if (separatorIndex < 0 || separatorIndex === argv.length - 1) {
    throw new Error('expected a command after --')
  }

  const options = Object.fromEntries(
    [...optionDefinitions.values()].map(([key, fallback]) => [key, fallback]),
  )
  const seen = new Set()
  const optionArguments = argv.slice(2, separatorIndex)
  for (let index = 0; index < optionArguments.length; index += 2) {
    const name = optionArguments[index]
    const definition = optionDefinitions.get(name)
    if (!definition) throw new Error(`unknown option: ${name}`)
    if (seen.has(name)) throw new Error(`duplicate option: ${name}`)
    const rawValue = optionArguments[index + 1]
    if (!/^\d+$/.test(rawValue ?? '')) {
      throw new Error(`invalid value for ${name}: ${rawValue ?? '<missing>'}`)
    }
    const parsedValue = Number(rawValue)
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
      throw new Error(`invalid value for ${name}: ${rawValue}`)
    }
    const [key] = definition
    options[key] = parsedValue
    seen.add(name)
  }
  if (options.pollMs < 25 || options.pollMs > 1000) {
    throw new Error('--poll-ms must be between 25 and 1000')
  }

  return {
    ...options,
    commandArguments: argv.slice(separatorIndex + 1),
  }
}

async function readProcessTree(rootPid) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss='], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 1000,
  })
  const processes = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, parentPid, rssKiB]) => (
      Number.isSafeInteger(pid)
      && Number.isSafeInteger(parentPid)
      && Number.isFinite(rssKiB)
    ))
  const childrenByParent = new Map()
  const rssByPid = new Map()
  for (const [pid, parentPid, rssKiB] of processes) {
    rssByPid.set(pid, rssKiB)
    const children = childrenByParent.get(parentPid) ?? []
    children.push(pid)
    childrenByParent.set(parentPid, children)
  }

  const pids = []
  const pending = [rootPid]
  const visited = new Set()
  while (pending.length > 0) {
    const pid = pending.shift()
    if (visited.has(pid)) continue
    visited.add(pid)
    if (!rssByPid.has(pid)) continue
    pids.push(pid)
    pending.push(...(childrenByParent.get(pid) ?? []))
  }

  return {
    pids,
    rssKiB: pids.reduce((total, pid) => total + (rssByPid.get(pid) ?? 0), 0),
  }
}

function signalProcesses(pids, signal) {
  for (const pid of [...pids].reverse()) {
    try {
      process.kill(pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function buildChildEnvironment(maxOldSpaceMiB) {
  const existingNodeOptions = process.env.NODE_OPTIONS ?? ''
  const withoutExistingHeapLimit = existingNodeOptions
    .replace(/(^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)\d+(?=\s|$)/g, ' ')
    .trim()
  return {
    ...process.env,
    NODE_OPTIONS: [
      withoutExistingHeapLimit,
      `--max-old-space-size=${maxOldSpaceMiB}`,
    ].filter(Boolean).join(' '),
  }
}

let configuration = null
try {
  configuration = parseArguments(process.argv)
} catch (error) {
  console.error(`resource-guard: ${error.message}`)
  process.exitCode = 64
}

if (configuration) {
  const {
    commandArguments,
    maxOldSpaceMiB,
    maxRssMiB,
    pollMs,
    timeoutMs,
  } = configuration
  const maxRssKiB = maxRssMiB * 1024
  const [command, ...args] = commandArguments
  const startedAt = Date.now()
  console.error(
    `resource-guard: start command=${command} old-space=${maxOldSpaceMiB} MiB `
    + `RSS=${maxRssMiB} MiB timeout=${timeoutMs} ms poll=${pollMs} ms`,
  )
  const child = spawn(command, args, {
    env: buildChildEnvironment(maxOldSpaceMiB),
    stdio: 'inherit',
  })
  let terminationReason = null
  let forceKillTimer = null
  let monitorTimer = null
  let lastKnownPids = child.pid ? [child.pid] : []
  let peakRssKiB = 0
  let peakProcessCount = 0
  let requestedSignal = null
  let spawnFailed = false
  const signalExitCodes = new Map([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])

  async function terminate(reason) {
    if (terminationReason) return
    terminationReason = reason
    let pids = lastKnownPids
    try {
      const snapshot = await readProcessTree(child.pid)
      if (snapshot.pids.length > 0) pids = snapshot.pids
    } catch {
      // The last successful snapshot remains the safest bounded fallback.
    }
    signalProcesses(pids, 'SIGTERM')
    forceKillTimer = setTimeout(() => {
      try {
        signalProcesses(pids, 'SIGKILL')
      } catch (error) {
        console.error(`resource-guard: forced cleanup failed: ${error.message}`)
      }
    }, 100)
  }

  async function monitor() {
    if (terminationReason || child.exitCode !== null || child.signalCode !== null) return
    try {
      const snapshot = await readProcessTree(child.pid)
      if (snapshot.pids.length > 0) lastKnownPids = snapshot.pids
      peakRssKiB = Math.max(peakRssKiB, snapshot.rssKiB)
      peakProcessCount = Math.max(peakProcessCount, snapshot.pids.length)
      if (snapshot.rssKiB > maxRssKiB) {
        console.error(
          `resource-guard: RSS limit exceeded: ${snapshot.rssKiB} KiB > ${maxRssKiB} KiB `
          + `processes=${snapshot.pids.length}`,
        )
        await terminate('rss')
        return
      }
    } catch (error) {
      console.error(`resource-guard: process monitoring failed: ${error.message}`)
      await terminate('monitor')
      return
    }
    monitorTimer = setTimeout(monitor, pollMs)
    monitorTimer.unref()
  }

  const timeout = setTimeout(() => {
    console.error(`resource-guard: timeout exceeded after ${timeoutMs} ms`)
    void terminate('timeout')
  }, timeoutMs)
  timeout.unref()
  void monitor()

  const signalHandlers = new Map()
  for (const signal of signalExitCodes.keys()) {
    const handler = () => {
      if (requestedSignal) {
        try {
          signalProcesses(lastKnownPids, 'SIGKILL')
        } catch (error) {
          console.error(`resource-guard: repeated-signal cleanup failed: ${error.message}`)
        }
        return
      }
      requestedSignal = signal
      console.error(`resource-guard: received ${signal}; terminating process tree`)
      void terminate('signal')
    }
    signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }

  function removeSignalHandlers() {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
  }

  child.once('error', (error) => {
    spawnFailed = true
    clearTimeout(timeout)
    if (monitorTimer) clearTimeout(monitorTimer)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    removeSignalHandlers()
    console.error(`resource-guard: failed to start command: ${error.message}`)
    process.exitCode = 70
  })
  child.once('close', (code, signal) => {
    clearTimeout(timeout)
    if (monitorTimer) clearTimeout(monitorTimer)
    if (!terminationReason && forceKillTimer) clearTimeout(forceKillTimer)
    removeSignalHandlers()
    let exitCode
    if (spawnFailed) exitCode = 70
    else if (terminationReason === 'timeout') exitCode = 124
    else if (terminationReason === 'rss') exitCode = 137
    else if (terminationReason === 'monitor') exitCode = 125
    else if (terminationReason === 'signal') exitCode = signalExitCodes.get(requestedSignal) ?? 128
    else exitCode = code ?? (signal ? 128 : 70)
    process.exitCode = exitCode
    console.error(
      `resource-guard: complete exit=${exitCode} `
      + `reason=${spawnFailed ? 'spawn-error' : terminationReason ?? 'command'} `
      + `elapsed=${Date.now() - startedAt} ms peak-RSS=${peakRssKiB} KiB `
      + `peak-processes=${peakProcessCount}`,
    )
  })
}
