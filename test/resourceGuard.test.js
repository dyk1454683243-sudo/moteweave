import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { runGuardedTool, EXTERNAL_TOOL_FAILURE } from '../src/motion-source/guardedToolRunner.js'

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

function startGuard(argumentsList, { safetyTimeoutMs = 2000, env = {} } = {}) {
  const child = spawn(process.execPath, [guardPath, ...argumentsList], {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      ...env,
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
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
    timeout: 1000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL',
  })
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

test('resource guard kills descendants spawned after SIGTERM begins', async () => {
  const token = `resource-guard-late-${process.pid}-${Date.now()}`
  const lateProgram = [
    "process.on('SIGTERM', () => {})",
    'setInterval(() => {}, 1000)',
  ].join('; ')
  const parentProgram = [
    "import { spawn } from 'node:child_process'",
    `process.on('SIGTERM', () => { spawn(process.execPath, ['-e', ${JSON.stringify(lateProgram)}, ${JSON.stringify(token)}], { stdio: 'ignore' }) })`,
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
  ], { safetyTimeoutMs: 3000 })

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

test('resource guard does not kill an unrelated process', async () => {
  const token = `resource-guard-unrelated-${process.pid}-${Date.now()}`
  const unrelated = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    token,
  ], { stdio: 'ignore' })
  try {
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
    await delay(100)
    let remainingPids = []
    try {
      remainingPids = await findProcessIdsByToken(token)
    } catch {
      remainingPids = [unrelated.pid]
    }
    assert.equal(result.reachedSafetyTimeout, false)
    assert.equal(result.code, 124)
    assert.ok(remainingPids.includes(unrelated.pid), remainingPids.join(','))
  } finally {
    try {
      unrelated.kill('SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
})

async function fakePsDirectory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'resource-guard-ps-'))
  const psPath = path.join(dir, 'ps')
  await writeFile(psPath, '#!/bin/sh\nexit 1\n')
  await chmod(psPath, 0o755)
  return dir
}

test('resource guard does not treat a finished command as monitor failure when ps later fails', async () => {
  const psDir = await fakePsDirectory()
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '5000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    'process.exit(0)',
  ], { env: { PATH: `${psDir}${path.delimiter}${process.env.PATH}` } })

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 0)
  assert.match(result.stderr, /reason=command/)
  assert.doesNotMatch(result.stderr, /process monitoring failed/)
})

test('resource guard fails live monitoring when ps cannot snapshot a running tree', async () => {
  const psDir = await fakePsDirectory()
  const result = await runGuard([
    '--max-old-space-mib', '128',
    '--max-rss-mib', '256',
    '--timeout-ms', '2000',
    '--poll-ms', '25',
    '--',
    process.execPath,
    '-e',
    'setInterval(() => {}, 1000)',
  ], { env: { PATH: `${psDir}${path.delimiter}${process.env.PATH}` }, safetyTimeoutMs: 4000 })

  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 125)
  assert.match(result.stderr, /process monitoring failed/)
})

test('resource guard stops a live tree when the sampler hangs without extending its deadline', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'resource-guard-slow-ps-'))
  const psPath = path.join(dir, 'ps')
  // exec keeps the hanging sampler in the exact process killed at its deadline.
  await writeFile(psPath, '#!/bin/sh\nexec /bin/sleep 10\n')
  await chmod(psPath, 0o755)
  const startedAt = Date.now()
  const result = await runGuard([
    '--max-old-space-mib', '128', '--max-rss-mib', '256',
    '--timeout-ms', '5000', '--poll-ms', '25', '--', process.execPath,
    '-e', 'setInterval(() => {}, 1000)',
  ], { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, safetyTimeoutMs: 2500 })
  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 125)
  assert.match(result.stderr, /process monitoring failed/)
  assert.match(result.stderr, /snapshot=topology elapsed=\d+ms budget=\d+ms stdout-bytes=0/)
  assert.ok(Date.now() - startedAt < 2000, result.stderr)
})

test('resource guard cancels a pending sampler as soon as the command exits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'resource-guard-cancel-ps-'))
  const psPath = path.join(dir, 'ps')
  const ready = path.join(dir, 'ready')
  await writeFile(psPath, '#!/bin/sh\necho $$ > "$SAMPLER_READY"\nexec /bin/sleep 10\n')
  await chmod(psPath, 0o755)
  const startedAt = Date.now()
  const result = await runGuard([
    '--max-old-space-mib', '128', '--max-rss-mib', '256',
    '--timeout-ms', '5000', '--poll-ms', '25', '--', process.execPath,
    '-e', "const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(process.env.SAMPLER_READY)) { clearInterval(timer); process.exit(0) } }, 5)",
  ], { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}`, SAMPLER_READY: ready }, safetyTimeoutMs: 2000 })
  assert.equal(result.reachedSafetyTimeout, false)
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.stderr, /process monitoring failed/)
  assert.ok(Date.now() - startedAt < 900, result.stderr)
  const samplerPid = Number((await readFile(ready, 'utf8')).trim())
  assert.throws(() => process.kill(samplerPid, 0), { code: 'ESRCH' })
})

for (const runner of ['command guard', 'external tool guard']) {
  test(`${runner} cleans detached descendants discovered before an RSS sampling timeout`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'resource-guard-detached-'))
    const marker = path.join(dir, 'descendant.pid')
    const psPath = path.join(dir, 'ps')
    await writeFile(psPath, `#!/bin/sh
if [ "$1" = '-axo' ]; then
  while [ ! -f '${marker}' ]; do /bin/sleep 0.01; done
  exec /bin/ps "$@"
fi
exec /bin/sleep 10
`)
    await chmod(psPath, 0o755)
    const descendant = [
      "const { writeFileSync } = require('node:fs')",
      "process.on('SIGTERM', () => {})",
      `writeFileSync(${JSON.stringify(marker)}, String(process.pid))`,
      'setInterval(() => {}, 1000)',
    ].join(';')
    const program = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' })`,
      'setInterval(() => {}, 1000)',
    ].join(';')
    const originalPath = process.env.PATH
    const fixturePath = `${dir}${path.delimiter}${originalPath}`
    let descendantPid
    try {
      if (runner === 'command guard') {
        const result = await runGuard([
          '--max-old-space-mib', '128', '--max-rss-mib', '256',
          '--timeout-ms', '5000', '--poll-ms', '25', '--', process.execPath, '-e', program,
        ], { env: { PATH: fixturePath }, safetyTimeoutMs: 3000 })
        assert.equal(result.reachedSafetyTimeout, false)
        assert.equal(result.code, 125)
      } else {
        process.env.PATH = fixturePath
        await assert.rejects(runGuardedTool(process.execPath, ['-e', program], {
          maxRssMiB: 256, timeoutMs: 3000, pollIntervalMs: 25, terminationGraceMs: 100,
        }), (error) => error.code === EXTERNAL_TOOL_FAILURE.MONITOR_FAILED)
      }
      descendantPid = Number(await readFile(marker, 'utf8'))
      await delay(150)
      assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' })
    } finally {
      process.env.PATH = originalPath
      descendantPid ??= Number(await readFile(marker, 'utf8').catch(() => '0'))
      if (descendantPid > 0) killExactProcesses([descendantPid])
    }
  })
}

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
