#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readProcessTree } from '../src/processTreeSnapshot.js'

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

function signalProcesses(pids, signal) {
  for (const pid of [...pids].reverse()) {
    try {
      process.kill(pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function signalProcessGroup(processGroupId, signal) {
  if (!processGroupId) return false
  try {
    process.kill(-processGroupId, signal)
    return true
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
    return false
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
  const isolatedProcessGroup = process.platform !== 'win32'
  const child = spawn(command, args, {
    env: buildChildEnvironment(maxOldSpaceMiB),
    stdio: 'inherit',
    detached: isolatedProcessGroup,
  })
  let terminationReason = null
  let forceKillTimer = null
  let monitorTimer = null
  const monitorAbort = new AbortController()
  let lastKnownPids = child.pid ? [child.pid] : []
  const processGroupId = isolatedProcessGroup ? child.pid : null
  let peakRssKiB = 0
  let peakProcessCount = 0
  let requestedSignal = null
  let spawnFailed = false
  const signalExitCodes = new Map([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])

  function signalGuardedTree(signal) {
    if (isolatedProcessGroup) {
      signalProcessGroup(processGroupId, signal)
    }
    signalProcesses(lastKnownPids, signal)
  }

  async function terminate(reason) {
    if (terminationReason) return
    terminationReason = reason
    monitorAbort.abort()
    // Never delay termination behind the monitor that may itself have failed.
    signalGuardedTree('SIGTERM')
    forceKillTimer = setTimeout(() => {
      try {
        signalGuardedTree('SIGKILL')
      } catch (error) {
        console.error(`resource-guard: forced cleanup failed: ${error.message}`)
      }
    }, 100)
  }

  function childAlreadyExited() {
    return child.exitCode !== null || child.signalCode !== null
  }

  function waitForChildExitObservation() {
    if (childAlreadyExited()) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      let immediate = null
      const finish = (exited) => {
        if (settled) return
        settled = true
        if (immediate) clearImmediate(immediate)
        child.removeListener('exit', onExit)
        child.removeListener('close', onClose)
        resolve(exited)
      }
      const onExit = () => finish(true)
      const onClose = () => finish(true)
      child.once('exit', onExit)
      child.once('close', onClose)
      immediate = setImmediate(() => finish(childAlreadyExited()))
    })
  }

  function reapGuardedTree() {
    if (spawnFailed) return
    try {
      if (isolatedProcessGroup) signalProcessGroup(processGroupId, 'SIGKILL')
      if (!childAlreadyExited()) {
        signalGuardedTree('SIGKILL')
        return
      }
      signalProcesses(lastKnownPids.filter((pid) => pid !== child.pid), 'SIGKILL')
    } catch (error) {
      console.error(`resource-guard: exit cleanup failed: ${error.message}`)
    }
  }

  async function monitor() {
    if (terminationReason || childAlreadyExited()) return
    const sampledAt = performance.now()
    try {
      const snapshot = await readProcessTree(child.pid, {
        onDiscover: (pids) => { lastKnownPids = pids },
        signal: monitorAbort.signal,
      })
      if (terminationReason || childAlreadyExited()) return
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
      // A failed ps can race with the child's exit/close events. Give that
      // lifecycle transition one event-loop turn before fail-closed monitor
      // termination; a still-live child remains a monitor failure.
      if (terminationReason || await waitForChildExitObservation()) return
      // Keep the failure attributable: a slow `ps` (timeout -> killed/SIGTERM) and a spawn failure
      // (EAGAIN/ENOMEM) need different responses, and the message alone does not say which it was.
      const detail = [`code=${error.code ?? ''}`, `signal=${error.signal ?? ''}`, `killed=${error.killed ?? ''}`,
        `errno=${error.errno ?? ''}`, `stderr=${String(error.stderr ?? '').trim().slice(0, 200)}`].join(' ')
      console.error(`resource-guard: process monitoring failed: ${error.message} (${detail})`)
      await terminate('monitor')
      return
    }
    monitorTimer = setTimeout(monitor, Math.max(0, pollMs - (performance.now() - sampledAt)))
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
          signalGuardedTree('SIGKILL')
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
    monitorAbort.abort()
    clearTimeout(timeout)
    if (monitorTimer) clearTimeout(monitorTimer)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    removeSignalHandlers()
    console.error(`resource-guard: failed to start command: ${error.message}`)
    process.exitCode = 70
  })
  child.once('exit', () => monitorAbort.abort())
  child.once('close', (code, signal) => {
    monitorAbort.abort()
    clearTimeout(timeout)
    if (monitorTimer) clearTimeout(monitorTimer)
    if (forceKillTimer) {
      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }
    removeSignalHandlers()
    reapGuardedTree()
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
