import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const guardPath = fileURLToPath(new URL('../scripts/run-with-resource-guard.mjs', import.meta.url))
const execFileAsync = promisify(execFile)

function terminateTestProcessGroup(child) {
  try {
    if (process.platform === 'win32') {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    else process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function startGuard(argumentsList, { safetyTimeoutMs = 2000 } = {}) {
  const child = spawn(process.execPath, [guardPath, ...argumentsList], {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    let reachedSafetyTimeout = false
    const safetyTimer = setTimeout(() => {
      reachedSafetyTimeout = true
      terminateTestProcessGroup(child)
    }, safetyTimeoutMs)
    safetyTimer.unref()
    child.once('error', (error) => {
      clearTimeout(safetyTimer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(safetyTimer)
      resolve({ code, signal, stdout, stderr, reachedSafetyTimeout })
    })
  })
  return { child, result }
}

function runGuard(argumentsList, options) {
  return startGuard(argumentsList, options).result
}

async function findProcessIdsByToken(token) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='])
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match) => match?.[2]?.includes(token))
    .map((match) => Number(match[1]))
}

function killExactProcesses(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

test('resource guard preserves the command exit status', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '100',
    '--',
    process.execPath,
    '-e',
    'process.exit(7)',
  ])

  assert.equal(result.code, 7)
  assert.equal(result.signal, null)
  assert.equal(result.reachedSafetyTimeout, false)
})

test('resource guard terminates a command that exceeds its timeout', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '150',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    'setInterval(() => {}, 1000)',
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 124)
  assert.equal(result.signal, null)
  assert.match(result.stderr, /timeout exceeded/i)
})

test('resource guard terminates a process tree that exceeds its RSS ceiling', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '16',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    'setInterval(() => {}, 1000)',
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 137)
  assert.equal(result.signal, null)
  assert.match(result.stderr, /RSS limit exceeded/i)
})

test('resource guard applies the requested V8 old-space ceiling to Node children', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '--input-type=module',
    '-e',
    "import v8 from 'node:v8'; console.log(v8.getHeapStatistics().heap_size_limit)",
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 0)
  assert.ok(Number(result.stdout.trim()) <= 256 * 1024 * 1024, result.stdout)
})

test('resource guard force-kills descendants that ignore graceful termination', async () => {
  const token = `resource-guard-descendant-${process.pid}-${Date.now()}`
  const parentProgram = [
    "import { spawn } from 'node:child_process'",
    `spawn(process.execPath, ['-e', ${JSON.stringify(
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    )}, ${JSON.stringify(token)}], { stdio: 'ignore' })`,
    'setInterval(() => {}, 1000)',
  ].join('; ')

  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '150',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '--input-type=module',
    '-e',
    parentProgram,
  ])

  await delay(250)
  const remainingPids = await findProcessIdsByToken(token)
  try {
    assert.equal(result.reachedSafetyTimeout, false)
    assert.equal(result.code, 124)
    assert.deepEqual(remainingPids, [])
  } finally {
    killExactProcesses(remainingPids)
  }
})

test('resource guard rejects an invalid limit before starting the command', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '0',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    "console.log('SHOULD_NOT_RUN')",
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 64)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /invalid value.*--max-rss-mib/i)
})

test('resource guard rejects a polling interval slower than one second', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '1001',
    '--',
    process.execPath,
    '-e',
    "console.log('SHOULD_NOT_RUN')",
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 64)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--poll-ms.*between 25 and 1000/i)
})

test('package test and local smoke scripts always run through the resource guard', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  ))

  assert.match(packageJson.scripts.test, /run-with-resource-guard\.mjs/)
  assert.match(packageJson.scripts.test, /--test-concurrency=1/)
  assert.match(packageJson.scripts['test:focused'], /run-with-resource-guard\.mjs/)
  assert.match(packageJson.scripts['test:focused'], /--max-old-space-mib 1024/)
  assert.match(packageJson.scripts['smoke:local'], /run-with-resource-guard\.mjs/)
  assert.match(packageJson.scripts['smoke:local'], /--max-rss-mib 4096/)
})

test('resource guard reports its limits, elapsed time, and peak process-tree RSS', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    'setTimeout(() => {}, 100)',
  ])

  assert.equal(result.code, 0)
  assert.match(result.stderr, /resource-guard: start .*old-space=128 MiB.*RSS=256 MiB/i)
  assert.match(result.stderr, /resource-guard: complete .*elapsed=\d+ ms.*peak-RSS=\d+ KiB/i)
})

test('resource guard cleans up its process tree when the guard receives SIGTERM', async () => {
  const token = `resource-guard-signal-${process.pid}-${Date.now()}`
  const execution = startGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    token,
  ], { safetyTimeoutMs: 3000 })

  await delay(150)
  execution.child.kill('SIGTERM')
  const result = await execution.result
  await delay(250)
  const remainingPids = await findProcessIdsByToken(token)
  try {
    assert.equal(result.reachedSafetyTimeout, false)
    assert.equal(result.signal, null)
    assert.equal(result.code, 143)
    assert.deepEqual(remainingPids, [])
  } finally {
    killExactProcesses(remainingPids)
    terminateTestProcessGroup(execution.child)
  }
})

test('resource guard counts descendant RSS instead of checking only the root process', async () => {
  const childProgram = 'setInterval(() => {}, 1000)'
  const parentProgram = [
    "import { spawn } from 'node:child_process'",
    `spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { stdio: 'ignore' })`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { stdio: 'ignore' })`,
    'setInterval(() => {}, 1000)',
  ].join('; ')
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '96',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '--input-type=module',
    '-e',
    parentProgram,
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 137)
  assert.match(result.stderr, /RSS limit exceeded: .*processes=3/i)
})

test('resource guard reports a stable error when the command cannot be started', async () => {
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    '/definitely-missing/resource-guard-command',
  ])

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.signal, null)
  assert.equal(result.code, 70)
  assert.match(result.stderr, /failed to start command/i)
})
